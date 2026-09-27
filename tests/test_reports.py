import json
from pathlib import Path
import tempfile
import unittest

from pokemon_suite.reports import support_report


class ReportTests(unittest.TestCase):
    def test_current_stop_takes_priority_over_an_older_recovery_report(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory); (root / 'firered').mkdir()
            (root / 'firered/recovery-report.json').write_text('{"reason":"older issue"}')
            report = support_report(root, 'firered', {'sessionId':'active', 'state':'blocked', 'frame':5678, 'decision':{'reason':'repeated-menu-transaction'}})
            self.assertEqual(report['records'][0]['reason'], 'repeated-menu-transaction')
            self.assertEqual(report['records'][0]['details']['frame'], 5678)
            self.assertIn('repeated-menu-transaction', report['repairPrompt'])

    def test_report_includes_recovery_evidence_and_decision_history(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            folder = root / 'firered/recovery-reports'
            folder.mkdir(parents=True)
            (folder / 'stalled.json').write_text(json.dumps({'schema': 'pokemon-suite/recovery-report/v1', 'at': '2026-09-11T10:00:00Z', 'reason': 'No menu progress', 'frame': 1234, 'recovery': {'attempt': 2}}))
            session = {'game': 'firered', 'state': 'blocked', 'decisionFeed': {'entries': [{'decision': {'kind': 'wait'}}]}, 'runtime': {'engineVersion': 'test-version'}}
            result = support_report(root, 'firered', session)
            self.assertEqual(result['session']['decisionFeed']['entries'][0]['decision']['kind'], 'wait')
            self.assertEqual(result['records'][0]['reason'], 'No menu progress')
            self.assertEqual(result['records'][0]['details']['frame'], 1234)
            self.assertIn('No menu progress', result['repairPrompt'])

    def test_report_does_not_follow_linked_files_or_include_unbounded_payloads(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            folder = root / 'firered/recovery-reports'
            folder.mkdir(parents=True)
            outside = root / 'outside.json'
            outside.write_text('{"password":"do-not-export"}')
            (folder / 'linked.json').symlink_to(outside)
            (folder / 'oversized.json').write_bytes(b' ' * (2 * 1024 * 1024 + 1))
            result = support_report(root, 'firered', None)
            self.assertEqual(result['records'], [])
            self.assertEqual(len(result['issues']), 2)
            self.assertNotIn('do-not-export', json.dumps(result))
            with self.assertRaises(ValueError):
                support_report(root, '../outside', None)

    def test_credentials_are_redacted_without_destroying_pokemon_identity(self):
        with tempfile.TemporaryDirectory() as directory:
            session = {'bot': {'authorization': 'Bearer private', 'nested': {'accessToken': 'secret'}}, 'pokemon': {'secretId': 1234}}
            result = support_report(Path(directory), 'firered', session)
            encoded = json.dumps(result)
            self.assertNotIn('Bearer private', encoded)
            self.assertNotIn('"accessToken": "secret"', encoded)
            self.assertEqual(result['session']['pokemon']['secretId'], 1234)


if __name__ == '__main__':
    unittest.main()
