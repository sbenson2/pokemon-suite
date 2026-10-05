"""L1.2 gate-failure triage: advice for a failed bot regression gate.

Reads one verify-bot output folder (report.json, case-evidence.json and the
stage logs) and the earlier runs next to it, and puts each failure in one class:

  known-flaky  a registered family that has failed this way before and passed
               when the identical source ran again;
  race/flake   a timing or environment signature (a temporary-folder cleanup
               race, a wall-clock budget, a harness settle race);
  regression   everything else, and always: ROM integrity, a failure that
               already happened on the identical source and corpus, a case or
               test that the last passing run did not have, or a stage that
               stopped without its summary.

It is advice only and reads nothing but files. It never turns a failed run into
a pass: the next run still has to pass every check, and verify-bot's
--resume-from reuses passed cases only for identical reviewed source and corpus.

Deterministic rules decide. There is no Laya consult: the labelled set
(tests/data/gate-failure-labels.jsonl) has 13 failures, too few to calibrate
one, and L1.1 measured zero-shot Laya at a constant's accuracy on stop triage.
"""
from __future__ import annotations

import argparse
import json
from pathlib import Path
import re
import sys

SCHEMA = 'pokemon-suite/gate-triage/v1'
CLASSES = ('known-flaky', 'race/flake', 'regression')
RETRYABLE = {'known-flaky', 'race/flake'}
STAGES = ('rom-integrity', 'engine', 'host', 'adapters', 'native-replays')

# Families diagnosed in earlier gates (.private/postgame-finish-20260920/WORKING.md).
# `since` is the run that first showed the family; the labelled-set score only
# lets a family answer for later runs.
FAMILIES = {
    'income-chain-budget': {
        'title': 'Game Corner income chain under load', 'class': 'known-flaky', 'since': '102-01',
        'case': 'postgame-income-chain', 'match': None,
        'advice': 'It missed its twenty-minute budget at load 83/102 (gate 105-01) and once sampled a save that was '
                  'still being written (102-01; the replay now waits for a cold Continue). Retry at normal load.'},
    'settle-transition': {
        'title': 'Stop-time checkpoint taken mid-action', 'class': 'race/flake', 'since': '106-01',
        'case': None, 'match': r"\+ 'transition'\s+- 'stable'",
        'advice': "The replay's final check loaded a stop-time checkpoint caught mid-action (phase 'transition'). "
                  'Stop the owner through its update boundary (prepare-update, then wait for update.held), as '
                  'postgame-supply-replan and goal-supervisor-postgame-handoff do.'},
    'worker-resume-load': {
        'title': 'Postgame owner resumed too slowly under load', 'class': 'known-flaky', 'since': '108-01',
        'case': 'postgame-worker-resume', 'match': r'did not resume',
        'advice': 'At a 15-minute load average near 28 the owner advanced only 28 frames; a quiet recheck of the '
                  'same source passed (gate 108-01).'},
    'transform-planner-restart': {
        'title': 'Extra planner-timeout restart under load', 'class': 'known-flaky', 'since': '98-01',
        'case': 'campaign-transform', 'match': r'2 !== 1',
        'advice': 'Under host load it saw one extra planner-timeout restart and passed twice alone (gate 98-01). It '
                  'has run in the exclusive serial phase since, so a repeat there deserves a closer look.'},
    'firered-partner-heartbeat-load': {
        'title': 'FireRed partner link heartbeat expired under load', 'class': 'known-flaky', 'since': '117-01',
        # Build 126 merged the restart case into the link-faults trade (its fault 2), so both ids belong here.
        'case': ('postgame-firered-partner-restart', 'postgame-firered-partner-link-faults'),
        'match': r'final link handshake or normal exit is not verified',
        'advice': 'The log first shows "The local partner heartbeat expired". It failed at load 119 (117-01) and while '
                  'screen recording and video encoding ran beside the gate (118-01); it passed quietly in 117-02, '
                  '117-03 and 118-02. Retry at load below 20 with nothing else running.'},
    'rfu-queue-overflow': {
        'title': 'Wireless link queue overflowed', 'class': 'regression', 'since': '105-02',
        'case': None, 'match': r'Native wireless queue overflowed',
        'advice': 'Build 106 paired the two owners’ frame clocks (pause at +16 frames) and recovers before an '
                  'exchange. An overflow now means that pacing broke.'},
}
# Generic timing and environment signatures (class race/flake).
RACES = (
    (r'ENOTEMPTY|EBUSY|directory not empty', 'a temporary-folder cleanup race'),
    (r'within the native replay budget|within \w+ minutes|timed out|deadline exceeded', 'a wall-clock budget ran out'),
)


def run_key(name):
    """Sort key for run names such as gate-verification-105-02: (105, 2)."""
    numbers = [int(n) for n in re.findall(r'\d+', str(name))]
    return tuple(numbers[-2:]) if numbers else ()


def message_head(text, limit=400):
    """The failure message without stack frames or local paths."""
    lines = [line.rstrip() for line in str(text or '').splitlines()]
    kept = [line for line in lines if line.strip() and not line.strip().startswith('at ')]
    head = '\n'.join(kept)
    head = re.sub(r'(?:file://)?/[^\s\'"]*?/(scripts|engine|tests|pokemon_suite)/', r'\1/', head)
    return head[:limit]


def classify(failure, context, families_before=None):
    """Class, family and reasons for one failure.

    failure: {stage, case, test, error}. context: {reproduced, isNew, stalled}
    (isNew is None when no earlier run passed). families_before: a run name;
    only families first seen before it may answer (used to score history).
    """
    stage, case, test = failure.get('stage'), failure.get('case'), failure.get('test')
    error = str(failure.get('error') or '')
    if stage == 'rom-integrity':
        return {'class': 'regression', 'family': None,
                'reasons': ['ROM integrity failed. It is mandatory and is never retried.']}
    if context.get('reproduced'):
        return {'class': 'regression', 'family': None,
                'reasons': ['It already failed the same way on the identical source and corpus.']}
    if context.get('stalled'):
        return {'class': 'regression', 'family': None,
                'reasons': ['The stage stopped without its summary (a hang or a crash). Run its command alone to see '
                            'whether it stops again.']}
    if context.get('isNew'):
        return {'class': 'regression', 'family': None,
                'reasons': ['The last passing run did not have this %s, so its first failure is a finding. Read the '
                            'log before any retry.' % ('case' if case else 'test')]}
    for name, family in FAMILIES.items():
        if families_before is not None and run_key(family['since']) >= run_key(families_before):
            continue
        cases = family['case'] if isinstance(family['case'], (tuple, list)) else (family['case'],)
        if family['case'] and case not in cases:
            continue
        if family['match'] and not re.search(family['match'], error):
            continue
        return {'class': family['class'], 'family': name,
                'reasons': ['%s (family %s, first seen in gate %s).' % (family['title'], name, family['since'])]}
    for pattern, reason in RACES:
        if re.search(pattern, error):
            return {'class': 'race/flake', 'family': None, 'reasons': ['The message shows %s.' % reason]}
    return {'class': 'regression', 'family': None,
            'reasons': ['No timing or environment signature and no registered family.']}


def _json(path):
    try:
        return json.loads(Path(path).read_text())
    except (OSError, ValueError):
        return None


def _tap_failures(text):
    """Failing tests in node --test output: (name, error)."""
    lines = text.splitlines()
    found = []
    for index, line in enumerate(lines):
        match = re.match(r'\s*not ok \d+ - (.*)', line)
        if not match:
            continue
        error = ''
        for at in range(index + 1, min(index + 40, len(lines))):
            if re.match(r'\s*(not )?ok \d+ - ', lines[at]):
                break
            value = re.match(r'\s*error: (.*)', lines[at])
            if value:
                error = value.group(1).strip().strip('"\'')
                if error in ('|-', '|', '>-', '>'):
                    error = next((l.strip() for l in lines[at + 1:at + 6] if l.strip()), '')
                break
        found.append((match.group(1).strip(), error))
    # A failing parent (a file or a describe block) only reports "N subtests failed".
    inner = [(name, error) for name, error in found if not re.search(r'subtests? failed', error)]
    return inner or found


def _unittest_failures(text):
    """Failing tests in unittest -v output: (name, last traceback line)."""
    found = []
    for block in re.split(r'^={20,}$', text, flags=re.M)[1:]:
        header = re.match(r'\s*(FAIL|ERROR): (\S+) \(([^)]*)\)', block)
        if not header:
            continue
        parts = re.split(r'^-{20,}$', block, flags=re.M)
        body = [line for line in (parts[1] if len(parts) > 1 else '').splitlines() if line.strip()]
        found.append(('%s (%s)' % (header.group(2), header.group(3)), body[-1].strip() if body else header.group(1)))
    return found


def _finished(text, stage):
    if stage == 'host':
        return re.search(r'^Ran \d+ tests? in ', text, re.M) is not None
    return re.search(r'^# (?:tests|pass) \d+', text, re.M) is not None


def read_run(folder):
    """What one verify-bot output folder says about its failures."""
    folder = Path(folder)
    report = _json(folder / 'report.json') or {}
    checks = {check.get('id'): check for check in report.get('checks') or []}
    evidence = _json(folder / 'case-evidence.json') or {}
    cases = evidence.get('cases') if isinstance(evidence, dict) else evidence
    cases = cases if isinstance(cases, list) else []
    journal = folder / 'case-evidence.jsonl'
    if journal.exists():
        # One durable line per finished case, kept even when the run was
        # interrupted before it wrote case-evidence.json.
        by_id = {c.get('id'): c for c in cases if isinstance(c, dict)}
        for line in journal.read_text(errors='replace').splitlines():
            try:
                entry = json.loads(line)
            except ValueError:
                continue
            if isinstance(entry, dict):
                by_id[entry.get('id')] = entry
        cases = list(by_id.values())
    run = {'folder': folder, 'name': folder.name, 'status': report.get('status'),
           'source': report.get('sourceSha256'), 'corpus': report.get('corpusSha256'),
           'completedAt': report.get('completedAt') or '',
           'passedCases': {c.get('id') for c in cases if c.get('pass')}, 'failures': []}
    if run['status'] == 'passed':
        return run
    for stage in STAGES:
        check = checks.get(stage)
        log = folder / ('%s.log' % stage)
        text = log.read_text(errors='replace') if log.exists() else ''
        if stage == 'native-replays':
            failed_cases = [c for c in cases if not c.get('pass')]
            for c in failed_cases:
                run['failures'].append({'stage': stage, 'case': c.get('id'), 'test': None, 'error': message_head(c.get('error'))})
            if failed_cases:
                continue
            if check is not None and check.get('failed'):
                tail = [line for line in text.splitlines() if re.match(r'(\w*Error\b|AssertionError)', line)]
                run['failures'].append({'stage': stage, 'case': None, 'test': None,
                                        'error': message_head(tail[-1] if tail else 'The native replays failed.')})
            elif check is None and text and not _finished(text, stage):
                last = next((line for line in reversed(text.splitlines()) if line.strip()), '')
                run['failures'].append({'stage': stage, 'case': None, 'test': None, 'stalled': True,
                                        'error': 'The native-replays stage stopped without its summary; last line: %s' % message_head(last, 160)})
            continue
        if check is None and not text:
            continue
        if check is not None and not check.get('failed'):
            continue
        tests = _unittest_failures(text) if stage == 'host' else _tap_failures(text)
        if stage == 'rom-integrity' and not tests:
            tests = [(None, 'ROM integrity reported %s failed.' % (check or {}).get('failed'))]
        if tests:
            for name, error in tests:
                run['failures'].append({'stage': stage, 'case': None, 'test': name, 'error': message_head(error)})
        elif not _finished(text, stage):
            last = next((line for line in reversed(text.splitlines()) if line.strip()), '')
            run['failures'].append({'stage': stage, 'case': None, 'test': None, 'stalled': True,
                                    'error': 'The %s stage stopped without its summary; last line: %s' % (stage, message_head(last, 160))})
        else:
            run['failures'].append({'stage': stage, 'case': None, 'test': None, 'error': 'The %s stage failed.' % stage})
    return run


def earlier_runs(folder, history=None):
    """Completed runs beside `folder` (or in `history`) that finished before it."""
    folder = Path(folder).resolve()
    this = read_run(folder)
    runs = []
    for other in sorted(Path(history or folder.parent).glob('*/report.json')):
        if other.parent.resolve() == folder:
            continue
        run = read_run(other.parent)
        if run['completedAt'] and this['completedAt'] and run['completedAt'] >= this['completedAt']:
            continue
        runs.append(run)
    return this, sorted(runs, key=lambda r: r['completedAt'])


def _load_peak(folder):
    samples = Path(str(folder) + '.load.jsonl')
    if not samples.exists():
        return None
    values = []
    for line in samples.read_text().splitlines():
        try:
            values.append(json.loads(line))
        except ValueError:
            pass
    return max(values, key=lambda s: s.get('load5', 0)) if values else None


def triage(folder, history=None):
    """Advice for every failure in one run. Reads files only."""
    this, before = earlier_runs(folder, history)
    reference = next((r for r in reversed(before) if r['status'] == 'passed'), None)
    reference_logs = {}
    result = {'schema': SCHEMA, 'run': this['name'], 'status': this['status'], 'advisory': True,
              'reference': reference and reference['name'], 'failures': []}
    for failure in this['failures']:
        key = failure['case'] or failure['test']
        reproduced = key is not None and any(
            r['source'] == this['source'] and r['corpus'] == this['corpus']
            and any((f['case'] or f['test']) == key for f in r['failures']) for r in before)
        is_new = None
        if reference and failure['case']:
            is_new = failure['case'] not in reference['passedCases']
        elif reference and failure['test'] and failure['stage'] in STAGES[1:4]:
            if failure['stage'] not in reference_logs:
                log = reference['folder'] / ('%s.log' % failure['stage'])
                reference_logs[failure['stage']] = log.read_text(errors='replace') if log.exists() else None
            text = reference_logs[failure['stage']]
            is_new = None if text is None else failure['test'].split(' (')[0] not in text
        verdict = classify(failure, {'reproduced': reproduced, 'isNew': is_new, 'stalled': failure.get('stalled')})
        family = FAMILIES.get(verdict['family']) if verdict['family'] else None
        result['failures'].append({**{k: failure[k] for k in ('stage', 'case', 'test', 'error')}, **verdict,
                                   'advice': family['advice'] if family else None})
    failures = result['failures']
    peak = _load_peak(folder)
    if peak:
        result['loadPeak'] = peak
    if not failures:
        result['next'] = {'action': 'investigate', 'text': 'The run failed without a failure this triage can read. '
                          'Open report.json and the stage logs.'}
    elif all(f['class'] in RETRYABLE for f in failures):
        first = sorted({f['case'] for f in failures if f['case']})
        args = ['--resume-from', str(Path(folder).resolve())] + (['--first', ','.join(first)] if first else [])
        result['next'] = {'action': 'retry', 'args': args,
                          'text': 'Retry on the identical source: %s. A second failure on the identical source is a '
                                  'regression.' % ' '.join(args)}
    else:
        first = sorted({f['case'] for f in failures if f['case']})
        result['next'] = {'action': 'investigate',
                          'text': 'Investigate before any retry. Write the failing test first, fix it, re-freeze the '
                                  'source, then start a new gate%s.' % (' with --first ' + ','.join(first) if first else '')}
    return result


def lines(result):
    """The advisory as printable lines."""
    out = ['Gate triage for %s (advice only; the run still failed):' % result['run']]
    for failure in result['failures']:
        what = failure['case'] or failure['test'] or 'the stage'
        out.append('- %s %s: %s' % (failure['stage'], what, failure['class']))
        out.append('  error: %s' % failure['error'].replace('\n', ' ')[:300])
        out += ['  why: %s' % reason for reason in failure['reasons']]
        if failure.get('advice'):
            out.append('  advice: %s' % failure['advice'])
    if result.get('loadPeak'):
        peak = result['loadPeak']
        out.append('Peak 5-minute load average during the run: %s at %s.' % (peak.get('load5'), peak.get('at')))
    out.append('Next: %s' % result['next']['text'])
    return out


def main(argv=None):
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument('run', type=Path, help='A verify-bot output folder.')
    parser.add_argument('--history', type=Path, default=None, help='Folder of earlier runs (default: beside the run).')
    parser.add_argument('--json', action='store_true')
    args = parser.parse_args(argv)
    result = triage(args.run, args.history)
    print(json.dumps(result, indent=2, default=str) if args.json else '\n'.join(lines(result)))
    return 0


if __name__ == '__main__':
    sys.exit(main())
