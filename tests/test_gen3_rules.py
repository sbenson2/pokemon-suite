"""Gen III rules for the competitive builder: experience, natures, Hidden Power and PID/IV methods."""
import random
import sqlite3
import unittest
from pathlib import Path

from pokemon_suite import gen3_rules as rules

ROOT = Path(__file__).resolve().parents[1]
GROWTH_IDS = {1: 'slow', 2: 'medium-fast', 3: 'fast', 4: 'medium-slow', 5: 'erratic', 6: 'fluctuating'}  # PokéAPI growth_rates


def generate(seed, method='Method 1', unown=False):
    """PID and IVs as the cartridge draws them from `seed` (the state before the first call)."""
    outputs, state = [], seed
    for _ in range(6):
        state = rules.next_state(state)
        outputs.append(state >> 16)
    first, second = outputs[0], outputs[1]
    if method == 'Method 3':
        second = outputs[2]
    personality = (first << 16 | second) if unown else (second << 16 | first)
    words = {'Method 1': (2, 3), 'Method 2': (3, 4), 'Method 4': (2, 4), 'Method 3': (3, 4)}[method]
    a, b = outputs[words[0]] & 0x7FFF, outputs[words[1]] & 0x7FFF
    ivs = {'hp': a & 31, 'attack': a >> 5 & 31, 'defense': a >> 10 & 31, 'speed': b & 31, 'spAttack': b >> 5 & 31, 'spDefense': b >> 10 & 31}
    return personality, ivs


class ExperienceTests(unittest.TestCase):
    def test_growth_tables_match_the_offline_pokedex(self):
        db = sqlite3.connect((ROOT / 'pokemon_suite/static/data/pokedex/master.sqlite3').as_uri() + '?mode=ro', uri=True)
        try:
            rows = db.execute('SELECT growth_rate_id, level, experience FROM experience').fetchall()
        finally:
            db.close()
        checked = 0
        for growth_id, level, points in rows:
            if level >= 2:  # pret hard-codes level 1 as 1 experience point; PokéAPI lists 0.
                self.assertEqual(rules.experience(GROWTH_IDS[growth_id], level), points, (growth_id, level))
                checked += 1
        self.assertEqual(checked, 6 * 99)
        self.assertEqual(rules.experience('medium-slow', 1), 1)

    def test_level_from_experience(self):
        self.assertEqual(rules.level_for_experience('medium-fast', 1_000_000), 100)
        self.assertEqual(rules.level_for_experience('medium-fast', 999_999), 99)
        self.assertEqual(rules.level_for_experience('erratic', 600_000), 100)
        self.assertEqual(rules.level_for_experience('fluctuating', rules.experience('fluctuating', 37)), 37)


class TraitTests(unittest.TestCase):
    def test_natures_follow_the_pid(self):
        self.assertEqual(rules.nature(3)['name'], 'Adamant')
        self.assertEqual((rules.nature(3)['raised'], rules.nature(3)['lowered']), ('attack', 'spAttack'))
        self.assertEqual(rules.nature(10)['name'], 'Timid')
        self.assertIsNone(rules.nature(24)['raised'])
        self.assertEqual(rules.nature_by_name('modest')['id'], 15)

    def test_hidden_power_type_and_power(self):
        perfect = {s: 31 for s in rules.STATS}
        self.assertEqual(rules.hidden_power(perfect), {'type': 'dark', 'power': 70})
        fire = dict(perfect, attack=30, spAttack=30, speed=30)
        self.assertEqual(rules.hidden_power(fire)['type'], 'fire')
        for kind in rules.HIDDEN_POWER_TYPES:
            for parity in rules.hidden_power_parities(kind)[:3]:
                self.assertEqual(rules.hidden_power({s: 30 + parity[s] for s in rules.STATS})['type'], kind)

    def test_shiny_gender_unown_and_wurmple(self):
        self.assertEqual(rules.shiny_value(0x00000007, 0), 7)
        self.assertEqual(rules.gender(0x10, 4), 'female')
        self.assertEqual(rules.gender(0x90, 4), 'male')
        self.assertEqual(rules.gender(0x90, -1), 'genderless')
        self.assertEqual(rules.unown_letter(0), 0)
        self.assertEqual(rules.wurmple_branch(0x00040000), 266)
        self.assertEqual(rules.wurmple_branch(0x00050000), 268)

    def test_stat_formula(self):
        adamant = rules.nature(3)
        self.assertEqual(rules.stat_value('attack', 100, 31, 252, 100, adamant), 328)
        self.assertEqual(rules.stat_value('hp', 100, 31, 252, 100, adamant), 404)
        self.assertEqual(rules.stat_value('hp', 1, 31, 252, 100, adamant, shedinja=True), 1)


class RngTests(unittest.TestCase):
    def test_window_solver_matches_brute_force(self):
        rng = random.Random(7)
        for _ in range(3000):
            m = rng.randint(2, 300)
            a, low = rng.randint(0, 2 * m), rng.randint(0, m - 1)
            high = rng.randint(low, m - 1)
            expected = next((x for x in range(m) if low <= a * x % m <= high), None)
            self.assertEqual(rules._first_in_window(a, m, low, high), expected)

    def test_state_recovery_from_two_outputs(self):
        rng = random.Random(3)
        for _ in range(5):
            state = rng.getrandbits(32)
            after = rules.next_state(state)
            self.assertIn(state, rules.states_for_outputs(state >> 16, after >> 16, 1))
            self.assertIn(state, rules.states_for_outputs(state >> 16, rules.next_state(after) >> 16, 2))
            self.assertEqual(rules.previous_state(after), state)

    def test_methods_are_detected(self):
        rng = random.Random(11)
        for method in ('Method 1', 'Method 2', 'Method 4', 'Method 3'):
            for _ in range(20):
                personality, ivs = generate(rng.getrandbits(32), method)
                found = rules.pid_iv_correlations(personality, ivs)
                self.assertIn(method, {f['method'] for f in found if f['family'] == 'standard'})
        personality, ivs = generate(rng.getrandbits(32), 'Method 1', unown=True)
        self.assertIn(('Method 1', 'unown'), {(f['method'], f['family']) for f in rules.pid_iv_correlations(personality, ivs)})

    def test_roamer_truncation_is_recognized(self):
        rng = random.Random(5)
        personality, ivs = generate(rng.getrandbits(32))
        word = ivs['hp'] | ivs['attack'] << 5
        truncated = {'hp': word & 31, 'attack': word >> 5 & 7, 'defense': 0, 'speed': 0, 'spAttack': 0, 'spDefense': 0}
        methods = {f['method'] for f in rules.pid_iv_correlations(personality, truncated)}
        self.assertIn('Method 1 (roamer)', methods)

    def test_random_values_rarely_correlate(self):
        rng = random.Random(13)
        hits = sum(bool(rules.pid_iv_correlations(rng.getrandbits(32), {s: rng.randint(0, 31) for s in rules.STATS})) for _ in range(200))
        self.assertLessEqual(hits, 1)

    def test_wild_frame_walks_back_to_the_slot_and_level(self):
        """Replay src/wild_encounter.c land generation and recover its slot and level rolls."""
        rng = random.Random(17)
        for _ in range(30):
            state = rng.getrandbits(32)
            draws = []

            def draw():
                nonlocal state
                state = rules.next_state(state)
                draws.append(state)
                return state >> 16
            slot_roll, level_roll, nature = draw(), draw(), draw() % 25
            while True:
                low = draw()
                pid_state = draws[-1]
                personality = draw() << 16 | low
                if personality % 25 == nature:
                    break
            frames = list(rules.wild_frames(pid_state, personality))
            self.assertIn((slot_roll, level_roll), {(f[0], f[1]) for f in frames if f[2] == 0})


if __name__ == '__main__':
    unittest.main()
