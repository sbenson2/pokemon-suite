import copy
import importlib.util
import hashlib
import json
from pathlib import Path
import tempfile
import unittest
from unittest.mock import patch

from pokemon_suite.bot_verification import file_inventory, inventory_digest, require_bot_verification, verified_payload
from test_packages import passing_proof


class BotVerificationTests(unittest.TestCase):
    def setUp(self):
        self.files = {'engine/worker.js': b'worker'}
        self.source = {**self.files, 'test/worker.js': b'behavior test'}
        self.proof = passing_proof(file_inventory(self.files))
        self.proof['sourceSha256'] = inventory_digest(file_inventory(self.source))

    def test_tests_or_host_changes_invalidate_the_previous_report(self):
        self.assertEqual(verified_payload(self.files, self.source, self.proof), self.proof)
        for change in [{'test/worker.js': b'changed'}, {'host.py': b'new host'}]:
            with self.subTest(change=change), self.assertRaisesRegex(ValueError, 'Source changed'):
                verified_payload(self.files, {**self.source, **change}, self.proof)

    def test_a_missing_failed_or_skipped_native_suite_is_not_a_pass(self):
        for mutation in ['missing', 'failed', 'empty', 'skipped', 'duplicate']:
            proof = copy.deepcopy(self.proof)
            if mutation == 'missing': proof['checks'].pop()
            elif mutation == 'duplicate': proof['checks'][-1] = copy.deepcopy(proof['checks'][0])
            else:
                proof['checks'][-1].update(tests=0, passed=0)
                if mutation == 'failed': proof['checks'][-1].update(tests=1, failed=1)
                if mutation == 'skipped': proof['checks'][-1].update(tests=2, passed=1, skipped=1)
            with self.subTest(mutation=mutation), self.assertRaisesRegex(ValueError, 'regression'):
                require_bot_verification({'kind': 'engine', 'files': file_inventory(self.files), 'verification': proof})

    def test_planner_updates_have_the_same_gate(self):
        with self.assertRaisesRegex(ValueError, 'regression'):
            require_bot_verification({'kind': 'planner', 'files': file_inventory(self.files)})

    def test_rom_integrity_is_required_even_when_all_behavior_suites_pass(self):
        proof = copy.deepcopy(self.proof)
        proof['checks'] = [c for c in proof['checks'] if c['id'] != 'rom-integrity']
        for kind in ('engine', 'planner'):
            with self.subTest(kind=kind), self.assertRaisesRegex(ValueError, 'required suite'):
                require_bot_verification({'kind': kind, 'files': file_inventory(self.files), 'verification': proof})

    def test_rom_integrity_cannot_be_skipped(self):
        proof = copy.deepcopy(self.proof)
        proof['checks'] = [c for c in proof['checks'] if c['id'] != 'rom-integrity']
        proof['checks'].insert(0, {'id': 'rom-integrity', 'tests': 2, 'passed': 1, 'failed': 0, 'skipped': 1})
        with self.assertRaisesRegex(ValueError, 'cannot be skipped'):
            require_bot_verification({'kind': 'engine', 'files': file_inventory(self.files), 'verification': proof})

    def test_a_development_selection_is_not_a_release_receipt(self):
        proof = copy.deepcopy(self.proof)
        proof['receipt'] = False
        with self.assertRaisesRegex(ValueError, 'development selection'):
            require_bot_verification({'kind': 'engine', 'files': file_inventory(self.files), 'verification': proof})
        proof['receipt'] = True
        require_bot_verification({'kind': 'engine', 'files': file_inventory(self.files), 'verification': proof})

    def test_modified_rom_stops_the_gate_before_any_emulator_runs(self):
        spec = importlib.util.spec_from_file_location('verify_bot', Path(__file__).resolve().parents[1]/'scripts/verify-bot.py')
        runner = importlib.util.module_from_spec(spec); spec.loader.exec_module(runner)
        with tempfile.TemporaryDirectory() as temp:
            root = Path(temp)
            rom = root/'game.gba'; rom.write_bytes(b'not an approved ROM')
            config = {'games': {'firered': {'cartridge': {'id': 'firered-rev1', 'path': str(rom),
                      'bytes': rom.stat().st_size, 'sha1': hashlib.sha1(rom.read_bytes()).hexdigest()}}}}
            (root/'config.json').write_text(json.dumps(config))
            corpus = root/'corpus.json'
            corpus.write_text(json.dumps({'schema': 'pokemon-suite/native-regressions/v1', 'cases':
                [{'id': 'test', 'config': 'config.json', 'nativeRadio': False}]}))
            files = {'engine/firered/test-support/native-regressions.json': b'{"required":["test"]}'}
            # A full engine/browser run is expensive and must be unreachable here.
            with patch.object(runner, 'reviewed', return_value=files), patch.object(runner, 'run_check',
                    side_effect=AssertionError('An unapproved ROM reached the behavior suites')):
                with self.assertRaisesRegex(ValueError, 'ROM'):
                    runner.verify(root, corpus, root/'verification')
            report = json.loads((root/'verification/report.json').read_text())
            self.assertEqual(report['status'], 'failed')
            self.assertEqual(report['checks'][0]['id'], 'rom-integrity')
            self.assertEqual(report['checks'][0]['failed'], 1)

    def test_a_new_checkpoint_cannot_replace_older_required_regressions(self):
        spec = importlib.util.spec_from_file_location('verify_bot', Path(__file__).resolve().parents[1]/'scripts/verify-bot.py')
        runner = importlib.util.module_from_spec(spec); spec.loader.exec_module(runner)
        corpus = {'schema': 'pokemon-suite/native-regressions/v1', 'cases': [{'id': 'new-pc-fix'}]}
        with self.assertRaisesRegex(ValueError, 'previously required'):
            runner.validate_corpus(corpus, ['older-save-fix', 'new-pc-fix'])
        corpus['cases'].append({'id': 'older-save-fix'})
        runner.validate_corpus(corpus, ['older-save-fix', 'new-pc-fix'])
        corpus['cases'].append({'id': 'new-pc-fix'})
        with self.assertRaisesRegex(ValueError, 'unique'):
            runner.validate_corpus(corpus, ['older-save-fix', 'new-pc-fix'])

    def _runner(self):
        spec = importlib.util.spec_from_file_location('verify_bot', Path(__file__).resolve().parents[1]/'scripts/verify-bot.py')
        runner = importlib.util.module_from_spec(spec); spec.loader.exec_module(runner)
        return runner

    def test_native_order_uses_fresh_recorded_durations_and_named_cases(self):
        runner = self._runner()
        with tempfile.TemporaryDirectory() as temp:
            previous = Path(temp)
            (previous/'report.json').write_text(json.dumps({'checks': [{'id': 'engine'}, {'id': 'native-replays', 'durations': [
                {'id': 'long', 'ms': 900, 'reused': False}, {'id': 'short', 'ms': 5, 'reused': False},
                {'id': 'reused', 'ms': 0, 'reused': True}, {'id': 'unknown', 'ms': None, 'reused': False}]}]}))
            self.assertEqual(runner.native_order(['short'], previous), {'first': ['short'], 'durations': {'long': 900, 'short': 5}})
        self.assertEqual(runner.native_order([], None), {'first': [], 'durations': {}})

    def test_scheduling_options_are_checked_before_any_suite_runs(self):
        runner = self._runner()
        with tempfile.TemporaryDirectory() as temp:
            root = Path(temp)
            corpus = root/'corpus.json'
            corpus.write_text(json.dumps({'schema': 'pokemon-suite/native-regressions/v1', 'cases': [{'id': 'test'}]}))
            files = {'engine/firered/test-support/native-regressions.json': b'{"required":["test"]}'}
            with patch.object(runner, 'reviewed', return_value=files), patch.object(runner, 'run_check',
                    side_effect=AssertionError('A suite ran before the options were validated')):
                with self.assertRaisesRegex(ValueError, 'run first'):
                    runner.verify(root, corpus, root/'first', first=['missing'])
                with self.assertRaisesRegex(ValueError, 'at least one'):
                    runner.verify(root, corpus, root/'lanes', lanes=0)
            self.assertFalse((root/'first').exists())
            self.assertFalse((root/'lanes').exists())
