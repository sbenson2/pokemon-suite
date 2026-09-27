"""L1.2 gate-failure triage: the labelled gate failures, run folders and stage logs.

tests/data/gate-failure-labels.jsonl holds every failed gate of Sept 22-24 (13 failures),
each with the inputs the triage read from its run folder and the diagnosis recorded in
.private/postgame-finish-20260920/WORKING.md. The triage only advises; it never passes a run.
"""
import importlib.util
import io
import json
from contextlib import redirect_stdout
from pathlib import Path
import tempfile
import unittest

ROOT = Path(__file__).resolve().parents[1]
spec = importlib.util.spec_from_file_location('gate_triage', ROOT / 'scripts/gate_triage.py')
gt = importlib.util.module_from_spec(spec)
spec.loader.exec_module(gt)
DATA = Path(__file__).resolve().parent / 'data' / 'gate-failure-labels.jsonl'
SETTLE = "AssertionError [ERR_ASSERTION]: Expected values to be strictly equal:\n+ actual - expected\n\n+ 'transition'\n- 'stable'\n"


def binary(label):
    return 'retry' if label in gt.RETRYABLE else 'investigate'


class LabelledFailures(unittest.TestCase):
    def setUp(self):
        self.rows = [json.loads(line) for line in DATA.read_text().splitlines() if line.strip()]

    def score(self, before):
        """(3-way hits, binary hits, regressions advised to retry)."""
        hits = binary_hits = unsafe = 0
        for row in self.rows:
            got = gt.classify(row, row, families_before=('gate-verification-' + row['run']) if before else None)['class']
            hits += got == row['label']
            binary_hits += binary(got) == binary(row['label'])
            unsafe += row['label'] == 'regression' and got in gt.RETRYABLE
        return hits, binary_hits, unsafe

    def test_the_labelled_set_covers_every_failed_gate(self):
        self.assertEqual(len(self.rows), 13)
        self.assertEqual({row['label'] for row in self.rows}, set(gt.CLASSES))
        self.assertFalse(any('/Users/' in row['error'] for row in self.rows))

    def test_scores_with_only_earlier_families(self):
        # Each family answers only for runs after the one that showed it, as it would have live.
        self.assertEqual(self.score(before=True), (9, 9, 0))
        # A constant "regression" answer: 6 of 13 either way.
        self.assertEqual(sum(row['label'] == 'regression' for row in self.rows), 6)

    def test_scores_with_every_family(self):
        # Families were written from these same failures, so this is training accuracy.
        self.assertEqual(self.score(before=False), (9, 12, 0))

    def test_a_failure_already_seen_on_the_identical_source_is_a_regression(self):
        for row in self.rows:
            if row['reproduced']:
                self.assertEqual(gt.classify(row, row)['class'], 'regression', row['run'])
        settle = {'stage': 'native-replays', 'case': 'x', 'test': None, 'error': SETTLE}
        self.assertEqual(gt.classify(settle, {})['class'], 'race/flake')
        self.assertEqual(gt.classify(settle, {'reproduced': True})['class'], 'regression')

    def test_a_partner_link_heartbeat_under_load_is_known_but_a_changed_party_is_a_finding(self):
        heartbeat = {'stage': 'native-replays', 'case': 'postgame-firered-partner-restart', 'test': None,
                     'error': 'firered-partner: The received Pokémon is saved locally, but the final link handshake or '
                              'normal exit is not verified. Preserving this game for inspection.'}
        result = gt.classify(heartbeat, {})
        self.assertEqual((result['class'], result['family']), ('known-flaky', 'firered-partner-heartbeat-load'))
        self.assertEqual(gt.classify(heartbeat, {}, families_before='gate-verification-117-01')['class'], 'regression',
                         'the family only answers after the gate that first showed it')
        self.assertEqual(gt.classify(heartbeat, {'reproduced': True})['class'], 'regression')
        party = {'stage': 'native-replays', 'case': 'postgame-firered-partner-stall', 'test': None,
                 'error': 'firered-partner: The prepared trade party changed unexpectedly. Its current state is preserved.'}
        self.assertEqual(gt.classify(party, {})['class'], 'regression', 'first seen in 118-02; investigate, never auto-retry')

    def test_rom_integrity_is_never_retryable(self):
        verdict = gt.classify({'stage': 'rom-integrity', 'case': None, 'test': None, 'error': 'ENOTEMPTY'}, {})
        self.assertEqual(verdict['class'], 'regression')
        self.assertIn('never retried', verdict['reasons'][0])


class RunFolders(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.root = Path(self.temp.name)

    def tearDown(self):
        self.temp.cleanup()

    def run_folder(self, name, status, source, at, cases=(), checks=None, logs=None):
        folder = self.root / name
        folder.mkdir()
        failed = sum(not passed for _, passed, _ in cases)
        report = {'status': status, 'receipt': status == 'passed', 'sourceSha256': source, 'corpusSha256': 'corpus',
                  'completedAt': '2026-09-24T%s:00:00+00:00' % at,
                  'checks': checks if checks is not None else [{'id': 'native-replays', 'failed': failed}]}
        (folder / 'report.json').write_text(json.dumps(report))
        evidence = [{'id': case, 'pass': passed, **({} if passed else {'error': error})} for case, passed, error in cases]
        (folder / 'case-evidence.json').write_text(json.dumps({'cases': evidence}))
        for stage, text in (logs or {}).items():
            (folder / ('%s.log' % stage)).write_text(text)
        return folder

    def test_new_cases_families_and_identical_source_repeats(self):
        self.run_folder('gate-a', 'passed', 'one', '01', [('settles', True, None)])
        new = self.run_folder('gate-b', 'failed', 'two', '02', [('settles', False, SETTLE), ('fresh', False, 'boom')])
        again = self.run_folder('gate-c', 'failed', 'two', '03', [('settles', True, None), ('fresh', False, 'boom')])
        before = {path: path.stat().st_mtime_ns for path in self.root.rglob('*')}
        first = {f['case']: f for f in gt.triage(new)['failures']}
        self.assertEqual((first['settles']['class'], first['settles']['family']), ('race/flake', 'settle-transition'))
        self.assertEqual(first['fresh']['class'], 'regression')
        self.assertIn('did not have this case', first['fresh']['reasons'][0])
        self.assertEqual(gt.triage(new)['next']['action'], 'investigate')
        repeat = gt.triage(again)
        self.assertEqual([(f['case'], f['class']) for f in repeat['failures']], [('fresh', 'regression')])
        self.assertIn('identical source', repeat['failures'][0]['reasons'][0])
        # Reading only: nothing in any run folder changed.
        self.assertEqual({path: path.stat().st_mtime_ns for path in self.root.rglob('*')}, before)

    def test_a_retry_names_the_run_to_resume_from(self):
        self.run_folder('gate-a', 'passed', 'one', '01', [('settles', True, None)])
        failed = self.run_folder('gate-b', 'failed', 'two', '02', [('settles', False, SETTLE)])
        result = gt.triage(failed)
        self.assertEqual(result['next']['action'], 'retry')
        self.assertEqual(result['next']['args'], ['--resume-from', str(failed.resolve()), '--first', 'settles'])
        out = io.StringIO()
        with redirect_stdout(out):
            self.assertEqual(gt.main([str(failed)]), 0)
        text = out.getvalue()
        self.assertIn('advice only; the run still failed', text)
        self.assertIn('A second failure on the identical source is a regression', text)

    def test_stage_logs(self):
        tap = ('ok 1 - keeps saves\nnot ok 2 - stop report drains\n  ---\n  duration_ms: 1041.9\n'
               "  error: \"ENOTEMPTY: directory not empty, rmdir '/private/var/folders/x/T/stop-1'\"\n  code: 'ENOTEMPTY'\n  ...\n")
        host_ok = 'test_keeps_state (test_x.Case.test_keeps_state) ... ok\n\nRan 1 test in 0.1s\n\nOK\n'
        host_fail = ('test_keeps_state (test_x.Case.test_keeps_state) ... FAIL\n\n' + '=' * 70 + '\n'
                     'FAIL: test_keeps_state (test_x.Case.test_keeps_state)\n' + '-' * 70 + '\n'
                     'Traceback (most recent call last):\n  File "t.py", line 3\nAssertionError: 1 != 2\n\n'
                     + '-' * 70 + '\nRan 1 test in 0.1s\n\nFAILED (failures=1)\n')
        self.run_folder('gate-a', 'passed', 'one', '01', checks=[], logs={'host': host_ok})
        engine = self.run_folder('gate-b', 'failed', 'two', '02', checks=[{'id': 'engine', 'failed': 1}], logs={'engine': tap})
        host = self.run_folder('gate-c', 'failed', 'three', '03', checks=[{'id': 'host', 'failed': 1}], logs={'host': host_fail})
        stalled = self.run_folder('gate-d', 'failed', 'four', '04', checks=[{'id': 'host', 'failed': 0}],
                                  logs={'host': host_ok, 'adapters': 'ok 7 - a paired replay\n  ---\n'})
        rom = self.run_folder('gate-e', 'failed', 'five', '05', checks=[{'id': 'rom-integrity', 'failed': 1}])
        verdicts = {name: [(f['stage'], f['test'], f['class']) for f in gt.triage(folder)['failures']]
                    for name, folder in [('engine', engine), ('host', host), ('stalled', stalled), ('rom', rom)]}
        self.assertEqual(verdicts['engine'], [('engine', 'stop report drains', 'race/flake')])
        self.assertEqual(verdicts['host'], [('host', 'test_keeps_state (test_x.Case.test_keeps_state)', 'regression')])
        self.assertEqual(gt.triage(host)['failures'][0]['error'], 'AssertionError: 1 != 2')
        self.assertEqual(verdicts['stalled'], [('adapters', None, 'regression')])
        self.assertEqual(verdicts['rom'], [('rom-integrity', None, 'regression')])
        self.assertIn('stopped without its summary', gt.triage(stalled)['failures'][0]['reasons'][0])
        # A run stopped during the native stage (for example at the outer deadline) has no summary line either.
        killed = self.run_folder('gate-f', 'failed', 'six', '06', [('settles', True, None)], checks=[{'id': 'host', 'failed': 0}],
                                 logs={'native-replays': 'ok 1 - settles\n# firered-partner 78690 [null]\n'})
        self.assertEqual([(f['stage'], f['class']) for f in gt.triage(killed)['failures']], [('native-replays', 'regression')])


if __name__ == '__main__':
    unittest.main()
