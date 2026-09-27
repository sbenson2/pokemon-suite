"""Run regression suites on an immutable reviewed export, including private native saves."""
import argparse
from datetime import datetime, timezone
import hashlib
import importlib.util
import json
import os
from pathlib import Path
import re
import shutil
import subprocess
import sys
import tempfile

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))
from pokemon_suite.bot_verification import file_inventory, inventory_digest
from pokemon_suite.rom_integrity import verify_corpus_roms


def reviewed(root):
    spec = importlib.util.spec_from_file_location('verified_export', root/'scripts/package-source.py')
    module = importlib.util.module_from_spec(spec); spec.loader.exec_module(module)
    return module.reviewed_files(root)


def validate_corpus(definition, required):
    cases = definition.get('cases')
    if definition.get('schema') != 'pokemon-suite/native-regressions/v1' or not isinstance(cases, list) or not cases:
        raise ValueError('Provide a nonempty native regression corpus with preserved checkpoints.')
    identifiers = [case.get('id') for case in cases if isinstance(case, dict)]
    if len(identifiers) != len(cases) or any(not isinstance(i, str) for i in identifiers) or len(set(identifiers)) != len(cases):
        raise ValueError('Native regression cases need unique identifiers.')
    if not set(required).issubset(identifiers):
        raise ValueError('The native regression corpus is missing previously required cases: '+', '.join(sorted(set(required)-set(identifiers))))


def run_check(identifier, command, root, output):
    log = output/(identifier+'.log')
    with log.open('w') as stream:
        result = subprocess.run(command, cwd=root, stdout=stream, stderr=subprocess.STDOUT,
                                # Native coverage includes two real-time wireless exchanges; the
                                # native corpus also exercises full provisioning trips before the
                                # historical postgame handoffs. Bound the aggregate replay
                                # process separately from the unchanged gameplay watchdogs.
                                env={**os.environ, 'PYTHON': sys.executable},
                                # Retain the complete historical corpus plus Tower rewards,
                                # Fame/Cut, Unown, and native repeat-and-claim records.
                                # Their individual gameplay and replay bounds still apply.
                                # The native corpus is 86 real replays and a loaded
                                # host can stretch the longest hunts; the outer
                                # runner still enforces its own three-hour cap.
                                timeout=10200 if identifier == 'native-replays' else 1800)
    text = log.read_text()
    if identifier == 'host':
        count = re.search(r'Ran (\d+) tests?', text)
        skip = re.search(r'OK \(skipped=(\d+)\)', text)
        failures = sum(int(n) for n in re.findall(r'(?:failures|errors)=(\d+)', text))
    else:
        count = re.search(r'^# tests (\d+)$', text, re.M)
        skip = re.search(r'^# skipped (\d+)$', text, re.M)
        failures = sum(int(n) for n in re.findall(r'^# (?:fail|cancelled) (\d+)$', text, re.M))
    total = int(count[1]) if count else 0
    skipped = int(skip[1]) if skip else 0
    failed = max(failures, int(result.returncode != 0 or total <= skipped))
    check = {'id': identifier, 'tests': total, 'passed': max(0, total-skipped-failed),
            'failed': failed, 'skipped': skipped, 'logSha256': hashlib.sha256(log.read_bytes()).hexdigest()}
    if identifier == 'native-replays':
        durations = []
        for line in text.splitlines():
            if not line.startswith('# timing '): continue
            entry = json.loads(line[len('# timing '):])
            durations.append({'id': entry.get('id'), 'ms': entry.get('ms'), 'reused': entry.get('reused') is True})
        check['durations'] = sorted(durations, key=lambda e: -(e['ms'] or 0))
        check['reused'] = sum(1 for entry in durations if entry['reused'])
    return check


def native_order(first, order_from):
    """Fail-fast ordering input for replay-bot: named cases, then recorded durations."""
    durations = {}
    if order_from:
        previous = json.loads((order_from/'report.json').read_text())
        native = next((c for c in previous.get('checks', []) if c.get('id') == 'native-replays'), {})
        durations = {e['id']: e['ms'] for e in native.get('durations', []) if not e.get('reused') and isinstance(e.get('ms'), int)}
    return {'first': list(first), 'durations': durations}


def verify(root, corpus, output, cases=None, resume_from=None, lanes=1, first=None, order_from=None):
    files = reviewed(root)
    corpus = corpus.resolve(); corpus_bytes = corpus.read_bytes()
    definition = json.loads(corpus_bytes)
    required = json.loads(files['engine/firered/test-support/native-regressions.json'])['required']
    validate_corpus(definition, required)
    cases = list(cases or [])
    identifiers = [case['id'] for case in definition['cases']]
    if cases and not set(cases).issubset(identifiers):
        raise ValueError('Selected native cases are not part of this corpus: '+', '.join(sorted(set(cases)-set(identifiers))))
    first = list(first or [])
    if not set(first).issubset(identifiers):
        raise ValueError('Cases named to run first are not part of this corpus: '+', '.join(sorted(set(first)-set(identifiers))))
    if lanes < 1:
        raise ValueError('Use at least one replay lane.')
    source_sha = inventory_digest(file_inventory(files))
    corpus_sha = hashlib.sha256(corpus_bytes).hexdigest()
    reuse_evidence = None
    if resume_from:
        # A reused pass is only offered for byte-identical reviewed source and
        # corpus; the replay still rechecks each ROM, core and checkpoint hash.
        previous = json.loads((resume_from/'report.json').read_text())
        if previous.get('sourceSha256') != source_sha or previous.get('corpusSha256') != corpus_sha:
            raise ValueError('Evidence reuse requires the same reviewed source and corpus as the previous run.')
        reuse_evidence = resume_from/'case-evidence.json'
        if not reuse_evidence.exists():
            raise ValueError('The previous run has no per-case evidence to reuse.')
    node = shutil.which('node')
    if not node: raise ValueError('Node 22 or newer is required for bot verification.')
    output.mkdir(parents=True, exist_ok=False)
    report = {'schema': 'pokemon-suite/bot-verification/v1', 'status': 'failed',
              'sourceSha256': source_sha,
              'corpusSha256': corpus_sha, 'checks': [], 'receipt': not cases,
              'selection': cases or None, 'reusedCases': [], 'lanes': lanes,
              'order': {'first': first, 'durationsFrom': str(order_from) if order_from else None},
              'completedAt': None, 'nativeScenarios': [c['id'] for c in definition['cases']]}
    rom_check = {'id': 'rom-integrity', 'tests': 1, 'passed': 0, 'failed': 1, 'skipped': 0}
    rom_log = output/'rom-integrity.log'
    rom_receipt_path = output/'rom-integrity.json'
    try:
        print('Verifying rom-integrity…', flush=True)
        report['checks'].append(rom_check)
        evidence = verify_corpus_roms(corpus)
        receipt_bytes = (json.dumps(evidence, indent=2)+'\n').encode()
        rom_receipt_path.write_bytes(receipt_bytes)
        rom_log.write_text('Approved ROMs verified before replay.\n'+receipt_bytes.decode())
        count = len(evidence['cases'])
        rom_check.update(tests=count, passed=count, failed=0)
        with tempfile.TemporaryDirectory(prefix='verified-source-', dir=output) as temp:
            snapshot = Path(temp)
            for name, data in files.items():
                p = snapshot/name; p.parent.mkdir(parents=True, exist_ok=True); p.write_bytes(data)
            engine_root = snapshot/'engine/firered'
            engine_tests = sorted(str(p.relative_to(engine_root)) for p in (engine_root/'test').glob('*.test.js'))
            # The standalone Mac adapters and browser UI; the retired standalone
            # iOS engine has its own npm dependency/build qualification.
            adapters = ['tests/'+name+'.test.mjs' for name in ('cold-save', 'adapter-resources', 'rom-art', 'browser', 'replay-rom-inputs', 'request-ask', 'stop-triage-card', 'laya-export-battles')]
            native = [node, 'scripts/replay-bot.mjs', str(corpus), str(rom_receipt_path.resolve()),
                      '--evidence-out', str((output/'case-evidence.json').resolve())]
            if cases: native += ['--only', ','.join(cases)]
            if reuse_evidence: native += ['--reuse', str(reuse_evidence.resolve())]
            # Lanes and order change only scheduling: every selected case still
            # runs to its own verified end state.
            if lanes > 1: native += ['--lanes', str(lanes)]
            if first or order_from:
                order_file = output/'native-order.json'
                order_file.write_text(json.dumps(native_order(first, order_from), indent=2)+'\n')
                native += ['--order', str(order_file.resolve())]
            commands = [
                # Bound test-file parallelism so local servers and short
                # finalization deadlines are not starved by the full suite.
                ('engine', [node, '--test', '--test-concurrency=2', '--test-reporter=tap', *engine_tests]),
                ('host', [sys.executable, '-m', 'unittest', 'discover', '-s', 'tests', '-v']),
                ('adapters', [node, '--test', '--test-concurrency=2', '--test-reporter=tap', *adapters]),
                ('native-replays', native),
            ]
            for identifier, command in commands:
                print(f'Verifying {identifier}…', flush=True)
                check = run_check(identifier, command, engine_root if identifier == 'engine' else snapshot, output); report['checks'].append(check)
                if check['failed'] or identifier == 'native-replays' and check['skipped']:
                    raise ValueError(f'{identifier} regression verification failed. See {output/(identifier+".log")}')
            evidence_file = output/'case-evidence.json'
            if evidence_file.exists():
                report['reusedCases'] = sorted(
                    entry['id'] for entry in json.loads(evidence_file.read_text()).get('cases', [])
                    if entry.get('reused') is True)
            if reviewed(snapshot) != files or reviewed(root) != files or corpus.read_bytes() != corpus_bytes:
                raise ValueError('Source or regression corpus changed during verification.')
            # Re-read all local ROMs/configs; a file changed after a successful
            # preflight cannot leave a passing release receipt behind.
            rom_check.update(passed=0, failed=count)
            if verify_corpus_roms(corpus) != evidence or rom_receipt_path.read_bytes() != receipt_bytes:
                raise ValueError('ROM verification inputs or evidence changed during the run.')
            rom_check.update(passed=count, failed=0)
            with rom_log.open('a') as log:
                log.write('ROMs, configurations and replay receipt unchanged after all suites.\n')
            report['status'] = 'passed'
    except (ValueError, OSError) as error:
        with rom_log.open('a') as log:
            log.write(str(error)+'\n')
        raise
    finally:
        if rom_log.exists():
            rom_check['logSha256'] = hashlib.sha256(rom_log.read_bytes()).hexdigest()
        report['completedAt'] = datetime.now(timezone.utc).isoformat()
        (output/'report.json').write_text(json.dumps(report, indent=2)+'\n')
    return report


if __name__ == '__main__':
    p = argparse.ArgumentParser(description=__doc__)
    p.add_argument('--corpus', type=Path, required=True)
    p.add_argument('--output', type=Path, required=True)
    p.add_argument('--cases', default='',
                   help='Comma-separated native case ids for a development run; the report is not a release receipt.')
    p.add_argument('--resume-from', type=Path, default=None,
                   help='Reuse per-case passes from a previous run with identical source and corpus.')
    p.add_argument('--lanes', type=int, default=1,
                   help='Parallel native replay processes; real-time link cases still run alone afterward.')
    p.add_argument('--first', default='',
                   help='Comma-separated native case ids to run first, such as those covering the change.')
    p.add_argument('--order-from', type=Path, default=None,
                   help='A previous run whose recorded durations schedule the longest cases first.')
    a = p.parse_args()
    try: print(json.dumps(verify(ROOT, a.corpus, a.output.resolve(),
        cases=[c for c in a.cases.split(',') if c.strip()],
        resume_from=a.resume_from.resolve() if a.resume_from else None, lanes=a.lanes,
        first=[c.strip() for c in a.first.split(',') if c.strip()],
        order_from=a.order_from.resolve() if a.order_from else None), indent=2))
    except (ValueError, OSError, subprocess.SubprocessError) as error: p.exit(1, str(error)+'\n')
