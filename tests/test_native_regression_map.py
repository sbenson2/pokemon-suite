"""The native regression corpus may merge or move cases only with a written map.

engine/firered/test-support/native-regression-map.json records the full case list
before the first consolidation (build 126, 143 cases) and, for every case no longer
required, the case that now covers it and where each of its assertions went.
"""
import hashlib
import json
import unittest
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
SUPPORT = ROOT / 'engine/firered/test-support'


def load(name):
    return json.loads((SUPPORT / name).read_text())


class NativeRegressionMapTests(unittest.TestCase):
    def setUp(self):
        self.map = load('native-regression-map.json')
        self.required = load('native-regressions.json')['required']

    def test_baseline_is_the_recorded_143_case_list(self):
        baseline = self.map['baseline']
        self.assertEqual(self.map['schema'], 'pokemon-suite/native-regression-map/v1')
        self.assertEqual(len(baseline['ids']), baseline['count'])
        self.assertEqual(len(set(baseline['ids'])), baseline['count'], 'the baseline has no duplicates')
        listed = '\n'.join(sorted(baseline['ids'])).encode()
        self.assertEqual(hashlib.sha256(listed).hexdigest(), baseline['sha256'], 'the baseline list is unchanged')

    def test_every_baseline_case_is_required_or_mapped(self):
        retired = [entry['id'] for entry in self.map['retired']]
        moved = [entry['id'] for entry in self.map.get('moved', [])]
        self.assertEqual(len(self.required), len(set(self.required)), 'the required list has no duplicates')
        gone = set(retired) | set(moved)
        self.assertFalse(gone & set(self.required), 'a mapped case is no longer required')
        self.assertEqual(set(self.map['baseline']['ids']) - set(self.required), gone,
                         'every baseline case is either still required or has a map entry')
        new = set(self.required) - set(self.map['baseline']['ids'])
        for entry in self.map['retired']:
            self.assertIn(entry['replacedBy'], self.required, entry['id'] + ' is replaced by a required case')
        self.assertTrue(all(isinstance(case, str) and case for case in new))

    def test_every_retired_assertion_lives_on_in_its_replacement(self):
        for entry in self.map['retired']:
            script = (ROOT / entry['script']).read_text().replace("\\'", "'")  # JS source escapes apostrophes
            self.assertTrue(entry['assertions'], entry['id'] + ' maps its assertions')
            for assertion in entry['assertions']:
                self.assertIn(assertion['new'], script, f"{entry['id']}: '{assertion['new']}' is checked by {entry['script']}")
            self.assertTrue(entry['reason'].strip(), entry['id'] + ' says why it was merged')


if __name__ == '__main__':
    unittest.main()
