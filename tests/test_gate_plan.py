import hashlib
import importlib.util
import json
import os
from pathlib import Path
import signal
import sys
import tempfile
import time
import unittest
from unittest.mock import patch

from pokemon_suite.bot_verification import file_inventory, inventory_digest

MINUTE = 60_000
REGRESSIONS = 'engine/firered/test-support/native-regressions.json'


def runner():
    spec = importlib.util.spec_from_file_location('verify_bot', Path(__file__).resolve().parents[1]/'scripts/verify-bot.py')
    module = importlib.util.module_from_spec(spec); spec.loader.exec_module(module)
    return module


def previous_run(directory, durations, **report):
    directory.mkdir(parents=True, exist_ok=True)
    (directory/'report.json').write_text(json.dumps({**report, 'checks': [{'id': 'native-replays', 'durations': [
        {'id': key, 'ms': value, 'reused': False} for key, value in durations.items()]}]}))
    return directory


class GatePlanTests(unittest.TestCase):
    def test_named_exclusive_cases_run_before_lanes(self):
        plan = runner().native_plan(['a', 'x1', 'b', 'x2', 'c'], exclusive=['x1', 'x2'], first=['x2', 'b'],
                                    order_from=None, lanes=3)
        self.assertEqual([(p['name'], p['mode'], p['cases']) for p in plan['phases']], [
            ('exclusive-first', 'serial', ['x2']),
            ('lanes', 'lanes', ['b', 'a', 'c']),
            ('exclusive', 'serial', ['x1'])])
        # Every selected case is scheduled exactly once.
        self.assertEqual(sorted(c for p in plan['phases'] for c in p['cases']), ['a', 'b', 'c', 'x1', 'x2'])

    def test_scheduling_lists_only_name_required_cases(self):
        regressions = json.loads((Path(__file__).resolve().parents[1]/REGRESSIONS).read_text())
        required = set(regressions['required'])
        self.assertTrue(regressions['exclusive'], 'the wall-clock cases are listed')
        self.assertLessEqual(set(regressions['exclusive']), required)
        self.assertLessEqual(set(regressions['releaseOnly']), required)

    def test_budget_scales_with_durations(self):
        module = runner()
        with tempfile.TemporaryDirectory() as temp:
            previous = previous_run(Path(temp)/'previous', {'long': 40*MINUTE, 'mid': 20*MINUTE, 'short': MINUTE,
                                                            'serial': 10*MINUTE})
            plan = module.native_plan(['long', 'mid', 'short', 'new', 'serial'], exclusive=['serial'], first=[],
                                      order_from=previous, lanes=2)
        # A case with no recorded duration counts as fifteen minutes.
        self.assertEqual(plan['estimates']['new'], 15*MINUTE)
        # Lanes: longest first onto the least loaded lane: 40 | 20+15+1 -> 40.
        # The serial exclusive case adds its 10 minutes.
        self.assertEqual(plan['estimateMs'], 50*MINUTE)
        self.assertEqual(plan['budgetMs'], int(1.5*50*MINUTE) + 10*MINUTE)
        # Watchdog: three times the recorded time, never under fifteen minutes.
        self.assertEqual(plan['watchdogs']['long'], 120*MINUTE)
        self.assertEqual(plan['watchdogs']['short'], 15*MINUTE)
        self.assertEqual(plan['watchdogs']['new'], 45*MINUTE)
        # The corpus grows: more recorded work means a larger budget.
        with tempfile.TemporaryDirectory() as temp:
            previous = previous_run(Path(temp)/'previous', {f'case-{n}': 10*MINUTE for n in range(12)})
            small = module.native_plan([f'case-{n}' for n in range(6)], [], [], previous, 3)
            large = module.native_plan([f'case-{n}' for n in range(12)], [], [], previous, 3)
        self.assertLess(small['budgetMs'], large['budgetMs'])

    def test_plan_only_writes_the_plan_without_running_any_suite(self):
        module = runner()
        with tempfile.TemporaryDirectory() as temp:
            root = Path(temp)
            corpus = root/'corpus.json'
            corpus.write_text(json.dumps({'schema': 'pokemon-suite/native-regressions/v1',
                                          'cases': [{'id': 'a'}, {'id': 'x'}]}))
            files = {REGRESSIONS: json.dumps({'required': ['a', 'x'], 'exclusive': ['x'], 'releaseOnly': []}).encode()}
            with patch.object(module, 'reviewed', return_value=files), \
                 patch.object(module, 'run_check', side_effect=AssertionError('no suite may run for --plan-only')), \
                 patch.object(module, 'verify_corpus_roms', side_effect=AssertionError('no ROM check for --plan-only')):
                plan = module.verify(root, corpus, root/'plan', lanes=3, plan_only=True)
            written = json.loads((root/'plan/gate-plan.json').read_text())
        self.assertEqual(plan, written)
        self.assertEqual([p['name'] for p in written['phases']], ['lanes', 'exclusive'])
        self.assertEqual(written['maxFailures'], 3)

    def test_a_killed_run_writes_an_interrupted_report(self):
        module = runner()
        with tempfile.TemporaryDirectory() as temp:
            root = Path(temp)
            corpus = root/'corpus.json'
            corpus.write_text(json.dumps({'schema': 'pokemon-suite/native-regressions/v1', 'cases': [{'id': 'a'}]}))
            files = {REGRESSIONS: json.dumps({'required': ['a']}).encode()}

            def checks(identifier, command, cwd, output, timeout=None):
                if identifier == 'engine':
                    return {'id': 'engine', 'tests': 3, 'passed': 3, 'failed': 0, 'skipped': 0, 'logSha256': '0'*64}
                # The gate wrapper's deadline (or an operator) stops the run here.
                os.kill(os.getpid(), signal.SIGTERM)
                raise AssertionError('SIGTERM must interrupt the run')

            with patch.object(module, 'reviewed', return_value=files), \
                 patch.object(module, 'verify_corpus_roms', return_value={'cases': [{'id': 'a'}]}), \
                 patch.object(module, 'run_check', side_effect=checks):
                with self.assertRaises(module.Interrupted):
                    module.verify(root, corpus, root/'run')
            report = json.loads((root/'run/report.json').read_text())
            journal = [json.loads(line) for line in (root/'run/checks.jsonl').read_text().splitlines()]
            manifest = json.loads((root/'run/run-manifest.json').read_text())
        self.assertEqual((report['status'], report['interrupted']), ('failed', True))
        self.assertEqual([c['id'] for c in journal], ['rom-integrity', 'engine'])
        self.assertEqual(manifest['sourceSha256'], report['sourceSha256'])
        # The default SIGTERM disposition is restored after the run.
        self.assertIs(signal.getsignal(signal.SIGTERM), signal.SIG_DFL)

    def test_resume_from_an_interrupted_run_reuses_only_its_passed_cases(self):
        module = runner()
        with tempfile.TemporaryDirectory() as temp:
            root = Path(temp)
            corpus = root/'corpus.json'
            corpus_bytes = json.dumps({'schema': 'pokemon-suite/native-regressions/v1',
                                       'cases': [{'id': 'a'}, {'id': 'b'}, {'id': 'c'}]}).encode()
            corpus.write_bytes(corpus_bytes)
            files = {REGRESSIONS: json.dumps({'required': ['a', 'b', 'c']}).encode()}
            donor = root/'donor'; donor.mkdir()
            (donor/'report.json').write_text(json.dumps({
                'status': 'failed', 'interrupted': True,
                'sourceSha256': inventory_digest(file_inventory(files)),
                'corpusSha256': hashlib.sha256(corpus_bytes).hexdigest()}))
            evidence = {'romSha1': 'r', 'coreSha256': 'c', 'seedStateSha256': 's'}
            # The interrupted donor has only its journal; no final case-evidence.json.
            (donor/'case-evidence.jsonl').write_text('\n'.join(json.dumps(e) for e in [
                {'id': 'a', 'pass': True, 'reused': False, 'evidence': {**evidence, 'id': 'a'}},
                {'id': 'b', 'pass': False, 'error': 'replay failed'},
                {'id': 'c', 'pass': True, 'reused': True, 'evidence': {**evidence, 'id': 'c'}}]) + '\n')
            seen = {}

            def checks(identifier, command, cwd, output, timeout=None):
                if identifier == 'native-replays':
                    seen['reuse'] = json.loads(Path(command[command.index('--reuse')+1]).read_text())
                return {'id': identifier, 'tests': 1, 'passed': 1, 'failed': 0, 'skipped': 0, 'logSha256': '0'*64}

            with patch.object(module, 'reviewed', return_value=files), \
                 patch.object(module, 'verify_corpus_roms', return_value={'cases': []}), \
                 patch.object(module, 'run_check', side_effect=checks):
                module.verify(root, corpus, root/'resumed', resume_from=donor)
            self.assertEqual(sorted(e['id'] for e in seen['reuse']['cases']), ['a', 'c'])
            self.assertTrue(all(e['pass'] is True for e in seen['reuse']['cases']))
            # A donor of another source is never reused.
            (donor/'report.json').write_text(json.dumps({'status': 'failed', 'interrupted': True,
                                                        'sourceSha256': 'other', 'corpusSha256': 'other'}))
            with patch.object(module, 'reviewed', return_value=files), \
                 patch.object(module, 'run_check', side_effect=AssertionError('no suite may run')):
                with self.assertRaisesRegex(ValueError, 'same reviewed source'):
                    module.verify(root, corpus, root/'refused', resume_from=donor)

    def test_the_native_suite_deadline_comes_from_the_plan(self):
        module = runner()
        with tempfile.TemporaryDirectory() as temp:
            output = Path(temp)
            self.assertEqual(module.check_deadline('native-replays', output), module.SUITE_TIMEOUT_SECONDS)
            (output/'gate-plan.json').write_text(json.dumps({'budgetMs': 1500}))
            self.assertEqual(module.check_deadline('native-replays', output), 1.5)
            self.assertEqual(module.check_deadline('host', output), module.SUITE_TIMEOUT_SECONDS)
            # Past the budget the check fails, and the whole process group stops:
            # the replay workers and any owner they spawned.
            marker = output/'grandchild.pid'
            script = ('import subprocess,sys,time;'
                      f'child=subprocess.Popen([sys.executable,"-c","import time;time.sleep(60)"]);open({str(marker)!r},"w").write(str(child.pid));'
                      'time.sleep(60)')
            started = time.monotonic()
            check = module.run_check('native-replays', [sys.executable, '-c', script], output, output)
            self.assertLess(time.monotonic() - started, 40)
            self.assertEqual(check['failed'], 1)
            self.assertIn('exceeded its', (output/'native-replays.log').read_text())
            grandchild = int(marker.read_text())
            for _ in range(50):
                try: os.kill(grandchild, 0)
                except ProcessLookupError: break
                time.sleep(0.1)
            else:
                self.fail('the spawned grandchild outlived the check')


class GateWrapperDeadlineTests(unittest.TestCase):
    def test_the_outer_deadline_follows_the_plan(self):
        scripts = Path(__file__).resolve().parents[1]/'scripts'
        sys.path.insert(0, str(scripts))
        try:
            spec = importlib.util.spec_from_file_location('run_gate', scripts/'run-gate.py')
            module = importlib.util.module_from_spec(spec); spec.loader.exec_module(module)
        finally:
            sys.path.remove(str(scripts))
        with tempfile.TemporaryDirectory() as temp:
            plan = Path(temp)/'gate-plan.json'
            self.assertIsNone(module.plan_deadline(plan))
            plan.write_text(json.dumps({'budgetMs': 90*MINUTE}))
            self.assertEqual(module.plan_deadline(plan), 90*60 + module.PLAN_SUITE_ALLOWANCE)
            plan.write_text('{"budgetMs": ')
            self.assertIsNone(module.plan_deadline(plan))


class TriageJournalTests(unittest.TestCase):
    def test_triage_reads_the_case_journal_of_an_interrupted_run(self):
        scripts = Path(__file__).resolve().parents[1]/'scripts'
        sys.path.insert(0, str(scripts))
        try:
            import gate_triage
        finally:
            sys.path.remove(str(scripts))
        with tempfile.TemporaryDirectory() as temp:
            folder = Path(temp)/'gate-verification-1-01'; folder.mkdir()
            (folder/'report.json').write_text(json.dumps({'status': 'failed', 'interrupted': True, 'checks': []}))
            (folder/'case-evidence.jsonl').write_text('\n'.join(json.dumps(e) for e in [
                {'id': 'a', 'pass': True, 'evidence': {'id': 'a'}},
                {'id': 'b', 'pass': False, 'error': 'AssertionError: the hunt never ended'}]) + '\n{"id": "c", "pass')
            run = gate_triage.read_run(folder)
        self.assertEqual(run['passedCases'], {'a'})
        self.assertEqual([(f['case'], f['stage']) for f in run['failures']], [('b', 'native-replays')])


if __name__ == '__main__':
    unittest.main()
