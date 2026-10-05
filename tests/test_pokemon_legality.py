"""Read-only Gen III legality checker against real, legitimately caught Pokémon and altered copies."""
import copy
import json
import random
import unittest
from pathlib import Path

from pokemon_suite import gen3_rules as rules
from pokemon_suite import pokemon_legality as legality

SAMPLE = json.loads((Path(__file__).resolve().parent / 'data' / 'builder-legal-sample.json').read_text())


def by_species(species, rows=None, **fields):
    for record in rows or SAMPLE['detailed']:
        if record['nationalSpeciesId'] == species and all(record.get(k) == v for k, v in fields.items()):
            return copy.deepcopy(record)
    raise AssertionError(f'No fixture record for species {species}')


def verdict(record):
    return legality.check(record, record.get('fixtureSaveOtId'))


def severities(result, category):
    return {c['severity'] for c in result['checks'] if c['category'] == category}


def static_record(species, level, mapsec, fateful, seed=1):
    """A Method 1 static encounter generated like CreateMon, for encounters the saves lack."""
    state = seed
    out = []
    for _ in range(4):
        state = rules.next_state(state)
        out.append(state >> 16)
    personality = out[1] << 16 | out[0]
    a, b = out[2] & 0x7FFF, out[3] & 0x7FFF
    ivs = {'hp': a & 31, 'attack': a >> 5 & 31, 'defense': a >> 10 & 31, 'speed': b & 31, 'spAttack': b >> 5 & 31, 'spDefense': b >> 10 & 31}
    ot = 0x12345678
    from pokemon_suite.pokemon_builder_knowledge import knowledge
    k = knowledge()
    two = k.ability_count(species) > 1
    return {'validity': 'valid', 'personality': personality, 'otId': ot, 'nature': {'id': personality % 25},
            'shiny': rules.shiny_value(personality, ot) < 8, 'species': species, 'nationalSpeciesId': species, 'heldItem': 0,
            'experience': rules.experience(k.growth(species), level), 'ppBonuses': 0, 'friendship': 0,
            'evs': {s: 0 for s in rules.STATS}, 'pokerus': 0, 'moves': [k.species(species)['learnset'][0]['moveId'], 0, 0, 0],
            'pp': [5, 0, 0, 0], 'ivs': ivs, 'isEgg': False, 'abilityNum': personality & 1 if two else 0, 'metLevel': level,
            'metLocation': mapsec, 'metGame': 4, 'ball': 4, 'otGender': 0, 'language': 2, 'ribbons': 0, 'fatefulEncounter': fateful,
            'fixtureSaveOtId': ot}


class LegitimatePokemon(unittest.TestCase):
    def test_every_legitimately_caught_sample_is_legal(self):
        for record in SAMPLE['detailed'] + SAMPLE['basic']:
            result = verdict(record)
            self.assertEqual(result['verdict'], 'legal', (record['nationalSpeciesId'], result['summary']))
            self.assertTrue(result['readOnly'])
            self.assertFalse([c for c in result['checks'] if c['severity'] in ('invalid', 'fishy')])

    def test_sample_covers_the_encounter_kinds(self):
        kinds = {verdict(r)['encounter']['kind'] for r in SAMPLE['detailed']}
        self.assertLessEqual({'wild', 'static', 'gift', 'hatched', 'gift-egg', 'trade', 'roamer'}, kinds)

    def test_wild_catches_reproduce_their_slot(self):
        frames = [c for r in SAMPLE['detailed'] for c in verdict(r)['checks'] if c['id'] == 'rng-frame']
        self.assertTrue(frames)
        self.assertEqual({c['severity'] for c in frames}, {'valid'})

    def test_records_without_met_data_are_matched_by_species_and_level(self):
        result = verdict(SAMPLE['basic'][0])
        self.assertEqual(result['verdict'], 'legal')
        self.assertIn('met location', result['limits'][0])

    def test_pkhex_categories_and_citations(self):
        result = verdict(SAMPLE['detailed'][0])
        allowed = {'GameOrigin', 'Encounter', 'PID', 'IVs', 'Ability', 'Nature', 'Shiny', 'Level', 'Evolution', 'EVs', 'Ball',
                   'CurrentMove', 'Trainer', 'Fateful', 'Ribbon', 'Form', 'Language', 'HeldItem', 'Misc'}
        self.assertLessEqual({c['category'] for c in result['checks']}, allowed)
        self.assertIn('CheckIdentifier.cs', result['citations']['categories'])


class AlteredPokemon(unittest.TestCase):
    def test_changed_ivs_break_the_pid_correlation(self):
        record = by_species(SAMPLE['detailed'][0]['nationalSpeciesId'])
        record['ivs'] = {s: 31 for s in rules.STATS}
        result = verdict(record)
        self.assertEqual(result['verdict'], 'illegal')
        self.assertIn('invalid', severities(result, 'PID'))

    def test_ev_limits(self):
        record = copy.deepcopy(SAMPLE['detailed'][0])
        record['evs'] = {'hp': 255, 'attack': 255, 'defense': 1, 'speed': 0, 'spAttack': 0, 'spDefense': 0}
        self.assertIn('invalid', severities(verdict(record), 'EVs'))
        record['evs'] = {s: 85 for s in rules.STATS}
        self.assertIn('fishy', severities(verdict(record), 'EVs'))

    def test_untrained_pokemon_cannot_hold_battle_evs(self):
        record = next(copy.deepcopy(r) for r in SAMPLE['detailed'] if r['metLevel'] > 0 and 'level' not in r
                      and r['experience'] > 0 and r['metLocation'] != 254)
        from pokemon_suite.pokemon_builder_knowledge import knowledge
        record['experience'] = rules.experience(knowledge().growth(record['nationalSpeciesId']), record['metLevel'])
        record['evs'] = dict({s: 0 for s in rules.STATS}, speed=150)
        self.assertIn('invalid', severities(verdict(record), 'EVs'))

    def test_safari_ball_outside_the_safari_zone(self):
        record = next(copy.deepcopy(r) for r in SAMPLE['detailed'] if r['ball'] in (2, 3, 4) and r['metLevel'] > 0
                      and verdict(r)['encounter']['kind'] == 'wild')
        record['ball'] = 5
        self.assertIn('invalid', severities(verdict(record), 'Ball'))

    def test_hatched_pokemon_are_in_poke_balls(self):
        record = next(copy.deepcopy(r) for r in SAMPLE['detailed'] if r['metLevel'] == 0)
        record['ball'] = 2
        self.assertIn('invalid', severities(verdict(record), 'Ball'))

    def test_hatch_location_is_in_kanto_or_sevii(self):
        record = next(copy.deepcopy(r) for r in SAMPLE['detailed'] if r['metLevel'] == 0)
        self.assertEqual(verdict(record)['verdict'], 'legal')
        record['metLocation'] = 0x10  # a Hoenn section number
        self.assertIn('invalid', severities(verdict(record), 'Encounter'))

    def test_egg_move_on_a_wild_catch(self):
        from pokemon_suite.pokemon_builder_knowledge import knowledge
        k = knowledge()
        for record in SAMPLE['detailed']:
            if verdict(record)['encounter']['kind'] != 'wild':
                continue
            eggs = [m for m, sources in k.learn_sources(record['nationalSpeciesId']).items()
                    if all(s['method'] == 'egg' for s in sources)]
            if eggs:
                altered = copy.deepcopy(record)
                altered['moves'] = [eggs[0], *[m for m in altered['moves'] if m][:3]][:4]
                altered['moves'] += [0] * (4 - len(altered['moves']))
                altered['pp'] = [1, 1, 1, 1]
                result = verdict(altered)
                self.assertIn('invalid', severities(result, 'CurrentMove'))
                self.assertTrue(any('Egg move' in c['message'] for c in result['checks']))
                return
        self.fail('No wild sample with an Egg move to test.')

    def test_moves_duplicates_gaps_and_pp(self):
        record = copy.deepcopy(SAMPLE['detailed'][0])
        first = record['moves'][0]
        record['moves'] = [first, first, 0, 0]
        self.assertIn('invalid', severities(verdict(record), 'CurrentMove'))
        record = copy.deepcopy(SAMPLE['detailed'][0])
        record['moves'] = [0, record['moves'][0], 0, 0]
        self.assertIn('invalid', severities(verdict(record), 'CurrentMove'))
        record = copy.deepcopy(SAMPLE['detailed'][0])
        record['pp'][0] = 99
        self.assertIn('invalid', severities(verdict(record), 'CurrentMove'))

    def test_level_below_an_evolution_level(self):
        record = next(copy.deepcopy(r) for r in SAMPLE['detailed'] if r['nationalSpeciesId'] in (6, 9, 3) and r['metLevel'] == 5)
        from pokemon_suite.pokemon_builder_knowledge import knowledge
        record['experience'] = rules.experience(knowledge().growth(record['nationalSpeciesId']), 20)
        record.pop('level', None)
        record['evs'] = {s: 0 for s in rules.STATS}
        record['moves'] = [record['moves'][0], 0, 0, 0]
        result = verdict(record)
        self.assertIn('invalid', severities(result, 'Evolution'))

    def test_ability_slot_must_follow_the_pid(self):
        from pokemon_suite.pokemon_builder_knowledge import knowledge
        k = knowledge()
        record = next(copy.deepcopy(r) for r in SAMPLE['detailed'] if k.ability_count(r['nationalSpeciesId']) > 1 and r['metLevel'] > 0
                      and r['metLocation'] != 254)
        record['abilityNum'] ^= 1
        self.assertIn('invalid', severities(verdict(record), 'Ability'))

    def test_in_game_trade_values_are_fixed(self):
        record = next(copy.deepcopy(r) for r in SAMPLE['detailed'] if r['metLocation'] == 254)
        self.assertEqual(verdict(record)['verdict'], 'legal')
        record['ivs']['hp'] = (record['ivs']['hp'] + 1) % 32
        result = verdict(record)
        self.assertEqual(result['verdict'], 'illegal')
        self.assertTrue(any('fixed values' in c['message'] for c in result['checks']))

    def test_roamer_ivs_are_truncated(self):
        record = next(copy.deepcopy(r) for r in SAMPLE['detailed'] if r['nationalSpeciesId'] in (243, 244, 245))
        record['ivs']['spDefense'] = 20
        self.assertEqual(verdict(record)['verdict'], 'illegal')

    def test_hatched_legendary(self):
        record = static_record(150, 70, 0x8D, False)
        self.assertEqual(verdict(record)['verdict'], 'legal')
        record['metLevel'] = 0
        result = verdict(record)
        self.assertEqual(result['verdict'], 'illegal')
        self.assertTrue(any('Egg' in c['message'] for c in result['checks']))

    def test_event_island_legendaries_need_the_fateful_flag(self):
        record = static_record(386, 30, 0xBB, True, seed=99)
        self.assertEqual(verdict(record)['verdict'], 'legal', verdict(record)['summary'])
        record['fatefulEncounter'] = False
        self.assertIn('invalid', severities(verdict(record), 'Fateful'))
        mewtwo = static_record(150, 70, 0x8D, True)
        self.assertIn('invalid', severities(verdict(mewtwo), 'Fateful'))

    def test_static_encounters_use_method_1(self):
        record = static_record(150, 70, 0x8D, False, seed=5)
        state, out = 5, []
        for _ in range(5):
            state = rules.next_state(state)
            out.append(state >> 16)
        a, b = out[3] & 0x7FFF, out[4] & 0x7FFF  # Method 2 IV words
        record['ivs'] = {'hp': a & 31, 'attack': a >> 5 & 31, 'defense': a >> 10 & 31, 'speed': b & 31, 'spAttack': b >> 5 & 31, 'spDefense': b >> 10 & 31}
        self.assertIn('invalid', severities(verdict(record), 'PID'))

    def test_wrong_location_or_level(self):
        record = static_record(150, 70, 0x8D, False)
        record['metLocation'] = 0x65
        self.assertEqual(verdict(record)['verdict'], 'illegal')
        record = static_record(150, 69, 0x8D, False)
        self.assertEqual(verdict(record)['verdict'], 'illegal')

    def test_inconsistent_nature_and_shiny_flags(self):
        record = copy.deepcopy(SAMPLE['detailed'][0])
        record['nature'] = {'id': (record['personality'] + 1) % 25}
        self.assertIn('invalid', severities(verdict(record), 'Nature'))
        record = copy.deepcopy(SAMPLE['detailed'][0])
        record['shiny'] = not record['shiny']
        self.assertIn('invalid', severities(verdict(record), 'Shiny'))

    def test_ribbons_and_pokerus(self):
        record = copy.deepcopy(SAMPLE['detailed'][0])
        record['ribbons'] = 1 << 24  # National Ribbon on a FireRed catch
        self.assertIn('invalid', severities(verdict(record), 'Ribbon'))
        record['ribbons'] = 1 << 20  # Marine Ribbon: event-only
        self.assertIn('fishy', severities(verdict(record), 'Ribbon'))
        record['ribbons'] = 0
        record['pokerus'] = 0x0F  # days with no strain
        self.assertIn('invalid', severities(verdict(record), 'Misc'))

    def test_unknown_origin_game_and_eggs(self):
        record = copy.deepcopy(SAMPLE['detailed'][0])
        record['metGame'] = 15
        self.assertEqual(verdict(record)['verdict'], 'unknown')
        record['metGame'] = 9
        self.assertEqual(verdict(record)['verdict'], 'illegal')
        egg = dict(copy.deepcopy(SAMPLE['detailed'][0]), isEgg=True)
        self.assertEqual(verdict(egg)['verdict'], 'unknown')

    def test_batch_counts(self):
        inventory = {'game': 'firered', 'pokemon': copy.deepcopy(SAMPLE['basic']), 'trainerOtId': SAMPLE['basic'][0]['fixtureSaveOtId']}
        result = legality.check_inventory(inventory)
        self.assertEqual(result['counts']['legal'], len(SAMPLE['basic']))
        self.assertEqual(legality.save_ot_id(inventory), SAMPLE['basic'][0]['fixtureSaveOtId'])

    def test_random_records_are_not_legal(self):
        rng = random.Random(2)
        base = copy.deepcopy(SAMPLE['detailed'][0])
        legal = 0
        for _ in range(40):
            record = dict(base, personality=rng.getrandbits(32))
            record['nature'] = {'id': record['personality'] % 25}
            record['shiny'] = rules.shiny_value(record['personality'], record['otId']) < 8
            legal += verdict(record)['verdict'] == 'legal'
        self.assertEqual(legal, 0)


if __name__ == '__main__':
    unittest.main()
