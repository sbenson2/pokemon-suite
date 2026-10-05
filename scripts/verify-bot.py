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
import signal
import subprocess
import sys
import tempfile
import threading

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


REGRESSIONS = 'engine/firered/test-support/native-regressions.json'
MINUTE_MS = 60_000
# A case without a recorded duration (usually new) is planned as fifteen minutes.
DEFAULT_CASE_MS = 15*MINUTE_MS
# Unit and adapter suites keep their fixed bound; the native suite's bound
# comes from the gate plan, which scales with the corpus.
SUITE_TIMEOUT_SECONDS = 1800


class Interrupted(Exception):
    """The run was stopped (SIGTERM). Passed cases stay reusable with --resume-from."""


def stop_group(process, grace=20):
    """Stop a check and everything it started (replay workers, spawned owners)."""
    for sig in (signal.SIGTERM, signal.SIGKILL):
        if process.poll() is not None:
            return
        try:
            os.killpg(process.pid, sig)
        except ProcessLookupError:
            return
        try:
            process.wait(timeout=grace)
        except subprocess.TimeoutExpired:
            continue


def journal(path, entry):
    """Append one JSON line and make it durable before the run continues."""
    with path.open('a') as stream:
        stream.write(json.dumps(entry, sort_keys=True)+'\n')
        stream.flush()
        os.fsync(stream.fileno())


def check_deadline(identifier, output):
    """Seconds a check may run: the native suite's budget from this run's gate
    plan (it scales with the corpus); a fixed bound for the other suites."""
    plan = output/'gate-plan.json'
    if identifier == 'native-replays' and plan.exists():
        return json.loads(plan.read_text())['budgetMs']/1000
    return SUITE_TIMEOUT_SECONDS


def run_check(identifier, command, root, output):
    log = output/(identifier+'.log')
    limit = check_deadline(identifier, output)
    with log.open('w') as stream:
        # Each check runs in its own process group so a deadline or an interrupt
        # also stops the replay workers and the owners they spawned.
        process = subprocess.Popen(command, cwd=root, stdout=stream, stderr=subprocess.STDOUT,
                                   env={**os.environ, 'PYTHON': sys.executable}, start_new_session=True)
        try:
            returncode = process.wait(timeout=limit)
        except subprocess.TimeoutExpired:
            stop_group(process)
            stream.write(f'\n# {identifier} exceeded its {round(limit)} s deadline from the gate plan\n')
            returncode = process.returncode if process.returncode is not None else -signal.SIGKILL
        except BaseException:
            stop_group(process)
            raise
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
    failed = max(failures, int(returncode != 0 or total <= skipped))
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


def native_plan(case_ids, exclusive, first, order_from, lanes, max_failures=3):
    """Schedule and time limits for the native replays (written as gate-plan.json).

    Phases: exclusive cases named in --first, then the parallel lanes, then the
    remaining exclusive (wall-clock paced) cases, alone. Within a phase: named
    cases first, then cases without a recorded duration, then longest first.
    The aggregate budget and each case's watchdog scale with recorded durations,
    so a growing corpus never outruns a fixed deadline. Only scheduling changes:
    every case still runs to its own verified end state.
    """
    order = native_order(first, order_from)
    durations, first = order['durations'], list(order['first'])
    def rank(case):
        if case in first: return (0, first.index(case))
        if case not in durations: return (1, 0)
        return (2, -durations[case])
    ordered = sorted(case_ids, key=rank)
    exclusive = set(exclusive)
    phases = [{'name': name, 'mode': mode, 'cases': members} for name, mode, members in (
        ('exclusive-first', 'serial', [c for c in ordered if c in exclusive and c in first]),
        ('lanes', 'lanes', [c for c in ordered if c not in exclusive]),
        ('exclusive', 'serial', [c for c in ordered if c in exclusive and c not in first])) if members]
    estimates = {case: durations.get(case, DEFAULT_CASE_MS) for case in ordered}
    watchdogs = {case: max(3*estimates[case], DEFAULT_CASE_MS) for case in ordered}
    total = 0
    for phase in phases:
        if phase['mode'] == 'serial':
            total += sum(estimates[c] for c in phase['cases'])
        else:
            loads = [0]*max(1, lanes)
            for case in phase['cases']:
                loads[loads.index(min(loads))] += estimates[case]
            total += max(loads)
    return {'schema': 'pokemon-suite/gate-plan/v1', 'lanes': lanes, 'maxFailures': max_failures,
            'first': first, 'durationsFrom': str(order_from) if order_from else None,
            'phases': phases, 'estimates': estimates, 'watchdogs': watchdogs,
            'estimateMs': total, 'budgetMs': int(1.5*total) + 10*MINUTE_MS}


def donor_passes(donor):
    """Passed cases of an earlier run: its per-case journal (kept even when the
    run was interrupted) and its final evidence file, if it got that far."""
    entries, found = {}, False
    final, lines = donor/'case-evidence.json', donor/'case-evidence.jsonl'
    if final.exists():
        found = True
        for entry in json.loads(final.read_text()).get('cases', []):
            entries[entry.get('id')] = entry
    if lines.exists():
        found = True
        for line in lines.read_text().splitlines():
            try: entry = json.loads(line)
            except json.JSONDecodeError: continue  # a line cut off by the interruption
            entries[entry.get('id')] = entry
    if not found:
        raise ValueError('The previous run has no per-case evidence to reuse.')
    return [{'id': e['id'], 'pass': True, 'reused': e.get('reused') is True, 'evidence': e['evidence']}
            for e in entries.values() if e.get('pass') is True and isinstance(e.get('evidence'), dict)]


def verify(root, corpus, output, cases=None, resume_from=None, lanes=1, first=None, order_from=None,
           max_failures=3, plan_only=False):
    files = reviewed(root)
    corpus = corpus.resolve(); corpus_bytes = corpus.read_bytes()
    definition = json.loads(corpus_bytes)
    regressions = json.loads(files[REGRESSIONS])
    required = regressions['required']
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
    if max_failures < 1:
        raise ValueError('Allow at least one native failure before new cases stop.')
    plan = native_plan(cases or identifiers, regressions.get('exclusive', []), [c for c in first if not cases or c in cases],
                       order_from, lanes, max_failures)
    if plan_only:
        output.mkdir(parents=True, exist_ok=True)
        (output/'gate-plan.json').write_text(json.dumps(plan, indent=2)+'\n')
        return plan
    source_sha = inventory_digest(file_inventory(files))
    corpus_sha = hashlib.sha256(corpus_bytes).hexdigest()
    donor = None
    if resume_from:
        # A reused pass is only offered for byte-identical reviewed source and
        # corpus; the replay still rechecks each ROM, core and checkpoint hash.
        # An interrupted or failed donor is fine: only its passed cases are reused.
        previous = json.loads((resume_from/'report.json').read_text())
        if previous.get('sourceSha256') != source_sha or previous.get('corpusSha256') != corpus_sha:
            raise ValueError('Evidence reuse requires the same reviewed source and corpus as the previous run.')
        donor = donor_passes(resume_from)
    node = shutil.which('node')
    if not node: raise ValueError('Node 22 or newer is required for bot verification.')
    output.mkdir(parents=True, exist_ok=False)
    plan_file = output/'gate-plan.json'
    plan_bytes = (json.dumps(plan, indent=2)+'\n').encode()
    plan_file.write_bytes(plan_bytes)
    reuse_file = None
    if donor is not None:
        reuse_file = output/'reuse-evidence.json'
        reuse_file.write_text(json.dumps({'schema': 'pokemon-suite/case-evidence/v1', 'from': str(resume_from),
                                          'cases': donor}, indent=2)+'\n')
    checks_journal = output/'checks.jsonl'
    (output/'run-manifest.json').write_text(json.dumps({
        'schema': 'pokemon-suite/gate-run/v1', 'startedAt': datetime.now(timezone.utc).isoformat(),
        'sourceSha256': source_sha, 'corpusSha256': corpus_sha, 'corpus': str(corpus),
        'selection': cases or None, 'lanes': lanes, 'maxFailures': max_failures,
        'first': first, 'orderFrom': str(order_from) if order_from else None,
        'resumeFrom': str(resume_from) if resume_from else None,
        'planSha256': hashlib.sha256(plan_bytes).hexdigest(),
        'estimateMs': plan['estimateMs'], 'budgetMs': plan['budgetMs']}, indent=2)+'\n')
    report = {'schema': 'pokemon-suite/bot-verification/v1', 'status': 'failed',
              'sourceSha256': source_sha,
              'corpusSha256': corpus_sha, 'checks': [], 'receipt': not cases,
              'selection': cases or None, 'reusedCases': [], 'lanes': lanes,
              'order': {'first': first, 'durationsFrom': str(order_from) if order_from else None},
              'plan': {'estimateMs': plan['estimateMs'], 'budgetMs': plan['budgetMs'], 'maxFailures': max_failures},
              'interrupted': False,
              'completedAt': None, 'nativeScenarios': [c['id'] for c in definition['cases']]}
    rom_check = {'id': 'rom-integrity', 'tests': 1, 'passed': 0, 'failed': 1, 'skipped': 0}
    rom_log = output/'rom-integrity.log'
    rom_receipt_path = output/'rom-integrity.json'
    def interrupt(signum, frame):
        raise Interrupted(f'Stopped by signal {signum}; passed cases stay reusable with --resume-from.')
    handles_signals = threading.current_thread() is threading.main_thread()
    previous_handler = signal.signal(signal.SIGTERM, interrupt) if handles_signals else None
    try:
        print('Verifying rom-integrity…', flush=True)
        report['checks'].append(rom_check)
        evidence = verify_corpus_roms(corpus)
        receipt_bytes = (json.dumps(evidence, indent=2)+'\n').encode()
        rom_receipt_path.write_bytes(receipt_bytes)
        rom_log.write_text('Approved ROMs verified before replay.\n'+receipt_bytes.decode())
        count = len(evidence['cases'])
        rom_check.update(tests=count, passed=count, failed=0)
        journal(checks_journal, rom_check)
        with tempfile.TemporaryDirectory(prefix='verified-source-', dir=output) as temp:
            snapshot = Path(temp)
            for name, data in files.items():
                p = snapshot/name; p.parent.mkdir(parents=True, exist_ok=True); p.write_bytes(data)
            engine_root = snapshot/'engine/firered'
            engine_tests = sorted(str(p.relative_to(engine_root)) for p in (engine_root/'test').glob('*.test.js'))
            # The standalone Mac adapters and browser UI; the retired standalone
            # iOS engine has its own npm dependency/build qualification.
            adapters = ['tests/'+name+'.test.mjs' for name in ('cold-save', 'adapter-resources', 'rom-art', 'browser', 'replay-rom-inputs', 'request-ask', 'stop-triage-card', 'laya-export-battles', 'replay-runner')]
            # The plan carries the lanes, phases, per-case watchdogs and the failure
            # limit. Scheduling never changes what a case verifies: every selected
            # case still runs to its own verified end state.
            native = [node, 'scripts/replay-bot.mjs', str(corpus), str(rom_receipt_path.resolve()),
                      '--evidence-out', str((output/'case-evidence.json').resolve()),
                      '--evidence-journal', str((output/'case-evidence.jsonl').resolve()),
                      '--case-log-dir', str((output/'native').resolve()),
                      '--plan', str(plan_file.resolve())]
            if cases: native += ['--only', ','.join(cases)]
            if reuse_file: native += ['--reuse', str(reuse_file.resolve())]
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
                check = run_check(identifier, command, engine_root if identifier == 'engine' else snapshot, output)
                report['checks'].append(check)
                journal(checks_journal, check)
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
    except Interrupted as error:
        report['interrupted'] = True
        with rom_log.open('a') as log:
            log.write(str(error)+'\n')
        raise
    except (ValueError, OSError) as error:
        with rom_log.open('a') as log:
            log.write(str(error)+'\n')
        raise
    finally:
        # Write the report even if another stop request arrives meanwhile.
        if handles_signals: signal.signal(signal.SIGTERM, signal.SIG_IGN)
        try:
            if rom_log.exists():
                rom_check['logSha256'] = hashlib.sha256(rom_log.read_bytes()).hexdigest()
            report['completedAt'] = datetime.now(timezone.utc).isoformat()
            (output/'report.json').write_text(json.dumps(report, indent=2)+'\n')
        finally:
            if handles_signals: signal.signal(signal.SIGTERM, previous_handler)
    return report


if __name__ == '__main__':
    p = argparse.ArgumentParser(description=__doc__)
    p.add_argument('--corpus', type=Path, required=True)
    p.add_argument('--output', type=Path, required=True)
    p.add_argument('--cases', default='',
                   help='Comma-separated native case ids for a development run; the report is not a release receipt.')
    p.add_argument('--resume-from', type=Path, default=None,
                   help='Reuse per-case passes from a previous run (interrupted or failed) with identical source and corpus.')
    p.add_argument('--lanes', type=int, default=1,
                   help='Parallel native replay processes; real-time link cases still run alone afterward.')
    p.add_argument('--first', default='',
                   help='Comma-separated native case ids to run first, such as those covering the change.')
    p.add_argument('--order-from', type=Path, default=None,
                   help='A previous run whose recorded durations schedule the longest cases first and size the time limits.')
    p.add_argument('--max-failures', type=int, default=3,
                   help='Native failures after which no new case starts (cases already running finish).')
    p.add_argument('--plan-only', action='store_true',
                   help='Write gate-plan.json (phases, estimate, budget, watchdogs) without running anything.')
    a = p.parse_args()
    try:
        result = verify(ROOT, a.corpus, a.output.resolve(),
            cases=[c for c in a.cases.split(',') if c.strip()],
            resume_from=a.resume_from.resolve() if a.resume_from else None, lanes=a.lanes,
            first=[c.strip() for c in a.first.split(',') if c.strip()],
            order_from=a.order_from.resolve() if a.order_from else None,
            max_failures=a.max_failures, plan_only=a.plan_only)
        if a.plan_only:
            print(json.dumps({'plan': str(a.output.resolve()/'gate-plan.json'), 'lanes': result['lanes'],
                              'phases': [{'name': ph['name'], 'mode': ph['mode'], 'cases': len(ph['cases'])} for ph in result['phases']],
                              'estimateMinutes': round(result['estimateMs']/MINUTE_MS, 1),
                              'budgetMinutes': round(result['budgetMs']/MINUTE_MS, 1)}, indent=2))
        else:
            print(json.dumps(result, indent=2))
    except Interrupted as error: p.exit(1, str(error)+'\n')
    except (ValueError, OSError, subprocess.SubprocessError) as error: p.exit(1, str(error)+'\n')
