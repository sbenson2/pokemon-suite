"""G3: deterministic interpreter accuracy on the labeled phrasing corpora.

request-phrasings.jsonl was written before the interpreter. About a quarter
of it is a held-out split (sha1(text) % 4 == 0) that was not used while
tuning. FLOORS were fixed before the interpreter existed.

request-phrasings-blind.jsonl holds two sets written by independent agents
from the spec only (never seeing the parser or the corpus). blind1-a/b and
blind2-a were used for tuning after being scored once; blind2-b was never
tuned on (unseen when last measured: intent .66, FA 0). BLIND_FLOORS are
regression floors below the measured values, not targets; to measure
generalization again, write a new blind set (these are all seen now).
"""
import copy
import json
import re
import unittest
from pathlib import Path

from pokemon_suite import pokemon_requests as pr

DATA = Path(__file__).resolve().parent / 'data'
ROWS = [json.loads(line) for line in (DATA / 'request-phrasings.jsonl').read_text().splitlines() if line.strip()]
BLIND = [json.loads(line) for line in (DATA / 'request-phrasings-blind.jsonl').read_text().splitlines() if line.strip()]
CONTEXT = json.loads((DATA / 'request-context.json').read_text())

FLOORS = {
    'dev': {'intent': 0.92, 'slots': 0.92, 'false_accept': 0.05, 'clarify': 0.60},
    'holdout': {'intent': 0.85, 'slots': 0.85, 'false_accept': 0.10, 'clarify': 0.50},
}
BLIND_FLOORS = {
    'blind1-a': {'intent': 0.95, 'slots': 0.95, 'false_accept': 0.03, 'clarify': 0.80},
    'blind1-b': {'intent': 0.95, 'slots': 0.95, 'false_accept': 0.03, 'clarify': 0.80},
    'blind2-a': {'intent': 0.90, 'slots': 0.95, 'false_accept': 0.03, 'clarify': 0.80},
    'blind2-b': {'intent': 0.60, 'slots': 0.90, 'false_accept': 0.05, 'clarify': 0.60},
}


class PhrasingCorpus(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        interpreter = pr.Interpreter()
        run = lambda text: interpreter.interpret(text, via='typed', context=copy.deepcopy(CONTEXT))
        cls.metrics = {split: pr.corpus_metrics([r for r in ROWS if r['split'] == split], run) for split in ('dev', 'holdout')}
        cls.blind = {split: pr.corpus_metrics([r for r in BLIND if r['split'] == split], run) for split in BLIND_FLOORS}

    def test_corpus_shape(self):
        self.assertGreaterEqual(len(ROWS), 600)
        negatives = [r for r in ROWS if r['expect'].get('understood') is False and 'clarify' not in r['expect']]
        self.assertGreaterEqual(len(negatives), 80)
        self.assertEqual(len({r['text'].lower() for r in ROWS}), len(ROWS))
        families = {r['family'] for r in ROWS}
        for family in ['catch', 'catch-static', 'travel', 'item', 'heal', 'save-game', 'multi', 'new-game', 'save-new', 'save-restore',
                       'bot-start', 'bot-resume', 'bot-stop', 'game-stop', 'postgame', 'collection', 'trade', 'settings', 'ev-training',
                       'status', 'help', 'unsupported', 'nonsense']:
            self.assertIn(family, families)
        holdout = sum(r['split'] == 'holdout' for r in ROWS) / len(ROWS)
        self.assertTrue(0.15 < holdout < 0.35, holdout)

    def test_no_new_corpus_row_repeats_a_blind_row(self):
        """A phrasing in both files is tuned on as dev data and still scored as blind (release-1 review). The rows written before the
        blind sets (p0001-p0665) keep the common phrasings they share with seen blind rows; rows added since must not. Ids only."""
        norm = lambda text: ' '.join(re.sub(r"[^\w\s]", ' ', text.lower().replace("'", '')).split())
        blind = {norm(r['text']) for r in BLIND}
        self.assertEqual([r['id'] for r in ROWS if int(r['id'][1:]) > 665 and norm(r['text']) in blind], [])

    def test_blind_regression_floors(self):
        self.assertEqual(len(BLIND), 461)
        for split, floors in BLIND_FLOORS.items():
            m = self.blind[split]
            with self.subTest(split=split):
                self.assertGreaterEqual(m['intent_accuracy'], floors['intent'], m['failures'][:10])
                self.assertGreaterEqual(m['slot_accuracy'], floors['slots'], m['failures'][:10])
                self.assertLessEqual(m['false_accept_rate'], floors['false_accept'], m['false_accepts'][:10])
                self.assertGreaterEqual(m['clarify_accuracy'], floors['clarify'], m['failures'][:10])

    def test_accuracy_floors(self):
        for split, floors in FLOORS.items():
            m = self.metrics[split]
            with self.subTest(split=split):
                self.assertGreaterEqual(m['intent_accuracy'], floors['intent'], m['failures'][:10])
                self.assertGreaterEqual(m['slot_accuracy'], floors['slots'], m['failures'][:10])
                self.assertLessEqual(m['false_accept_rate'], floors['false_accept'], m['false_accepts'][:10])
                self.assertGreaterEqual(m['clarify_accuracy'], floors['clarify'], m['failures'][:10])


if __name__ == '__main__':
    unittest.main()
