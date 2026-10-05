"""Competitive builder: bundled facts, per-species guidance, step plans and the host routes."""
import copy
import json
import os
import tempfile
import unittest
from pathlib import Path
from types import SimpleNamespace
from urllib.parse import urlparse

from pokemon_suite import gen3_rules as rules
from pokemon_suite.companion import allowed_route
from pokemon_suite.http_routes import SuiteRoutes
from pokemon_suite.pokemon_build_plan import PlanError, normalize_target, plan
from pokemon_suite.pokemon_builder_knowledge import knowledge
from pokemon_suite.pokemon_player_tasks import validate_effort_task
from pokemon_suite.pokemon_set_guidance import guidance, movepool

ROOT = Path(__file__).resolve().parents[1]
DATA = ROOT / 'pokemon_suite/static/data/pokedex'
SAMPLE = json.loads((Path(__file__).resolve().parent / 'data' / 'builder-legal-sample.json').read_text())
RESOURCES = os.environ.get('POKEMON_SUITE_GAME_RESOURCES')


class Facts(unittest.TestCase):
    def setUp(self):
        self.facts = json.loads((DATA / 'firered-builder.json').read_text())

    def test_met_location_numbers(self):
        names = self.facts['metLocations']
        self.assertEqual(names['88']['id'], 'MAPSEC_PALLET_TOWN')
        self.assertEqual(names['101']['id'], 'MAPSEC_ROUTE_1')
        self.assertEqual(names['136']['id'], 'MAPSEC_KANTO_SAFARI_ZONE')
        self.assertEqual(names['196']['id'], 'MAPSEC_SPECIAL_AREA')
        self.assertEqual(names['254']['name'], 'In-game trade')

    def test_every_species_has_growth_and_the_tables_are_consistent(self):
        self.assertEqual(len(self.facts['growth']), 386)
        self.assertEqual(len(self.facts['moves']), 354)
        for table in self.facts['wildTables']:
            expected = {'land': 12, 'water': 5, 'rock-smash': 5, 'fishing': 10}[table['area']]
            self.assertEqual(len(table['slots']), expected, table['map'])
            self.assertTrue(0x58 <= table['mapsec'] <= 0xC4)
        self.assertEqual(self.facts['slotThresholds']['land'][-1], 100)

    def test_trades_match_the_pokedex(self):
        dex = json.loads((DATA / 'firered.json').read_text())
        traded = {s['id'] for s in dex['species'] for e in s['encounters'] if e['method'] == 'npc-trade'}
        self.assertEqual({t['species'] for t in self.facts['trades'] if 'firered' in t['games']}, traded)

    def test_native_move_data_overrides_later_generations(self):
        k = knowledge()
        self.assertEqual(k.move(156)['pp'], 10)  # Rest: 10 PP in Gen III
        self.assertEqual(k.move(247)['category'], 'physical')  # Shadow Ball: Ghost is physical in Gen III
        self.assertEqual(k.move(242)['category'], 'special')  # Crunch: Dark is special
        self.assertEqual(k.multiplier('fire', ['grass', 'steel']), 4.0)
        self.assertEqual(k.multiplier('normal', ['ghost']), 0.0)

    def test_obtainable_items(self):
        k = knowledge()
        self.assertTrue(k.facts['balls']['6']['firered'])  # Net Ball
        self.assertFalse(k.facts['balls']['7']['firered'])  # Dive Ball: trade only
        self.assertIn('200', k.facts['items'])  # Leftovers

    @unittest.skipUnless(RESOURCES, 'Set POKEMON_SUITE_GAME_RESOURCES to rebuild the facts from the knowledge pack.')
    def test_facts_rebuild_from_the_knowledge_pack(self):
        import importlib.util
        spec = importlib.util.spec_from_file_location('build_builder_facts', ROOT / 'scripts/build-builder-facts.py')
        module = importlib.util.module_from_spec(spec)
        spec.loader.exec_module(module)
        with tempfile.TemporaryDirectory() as folder:
            out = Path(folder) / 'facts.json'
            module.build(Path(RESOURCES) / 'firered', out)
            self.assertEqual(json.loads(out.read_text())['revision'], self.facts['revision'])


class Guidance(unittest.TestCase):
    def test_every_species_gets_explained_sets(self):
        k = knowledge()
        for species in range(1, 387):
            result = guidance(species, k)
            self.assertTrue(result['sets'], species)
            pool = movepool(species, k)
            for entry in result['sets']:
                self.assertLessEqual(sum(entry['evs'].values()), 510)
                self.assertTrue(all(0 <= v <= 252 for v in entry['evs'].values()))
                self.assertIn(entry['nature']['name'], rules.NATURE_NAMES)
                ids = [m['id'] for m in entry['moves']]
                self.assertEqual(len(ids), len(set(ids)), (species, ids))
                self.assertTrue(all(m in pool for m in ids), (species, ids))
                self.assertTrue(all(m['why'] for m in entry['moves']))
                self.assertTrue(entry['why'] and entry['item']['why'] and entry['evsWhy'])
                normalize_target(_target(entry, species), k)

    def test_gen_iii_categories_follow_type(self):
        gengar = guidance(94)
        special = next(s for s in gengar['sets'] if s['role'] in ('special', 'special-tank'))
        self.assertNotIn('Shadow Ball', [m['name'] for m in special['moves']])
        self.assertTrue(all(m['category'] in ('special', 'status') for m in special['moves']))

    def test_roles_follow_the_stats(self):
        self.assertEqual(guidance(242)['sets'][0]['role'], 'special-wall')  # Blissey
        self.assertEqual(guidance(65)['sets'][0]['nature']['name'], 'Timid')  # Alakazam
        self.assertIn(guidance(68)['sets'][0]['role'], ('physical', 'physical-tank'))  # Machamp
        self.assertEqual(guidance(201)['sets'][0]['moves'][0]['id'], 237)  # Unown knows only Hidden Power

    def test_no_third_party_set_data(self):
        text = (ROOT / 'pokemon_suite/pokemon_set_guidance.py').read_text().lower()
        self.assertNotIn('smogon', text)


def _target(entry, species):
    return {'speciesId': species, 'nature': entry['nature']['id'], 'abilitySlot': None, 'ivs': {}, 'hiddenPower': entry['hiddenPower'],
            'evs': entry['evs'], 'moves': [m['id'] for m in entry['moves']], 'heldItem': entry['item']['nativeId'], 'level': 100,
            'shiny': 'any'}


def sample(species=None, **fields):
    for record in SAMPLE['detailed']:
        if (species is None or record['nationalSpeciesId'] == species) and all(record.get(k) == v for k, v in fields.items()):
            return copy.deepcopy(record)
    raise AssertionError('missing fixture record')


class Plans(unittest.TestCase):
    def target_for(self, record, **changes):
        nature = rules.nature(record['personality'])['name'].lower()
        known = [m for m in record['moves'] if m]
        value = {'speciesId': record['nationalSpeciesId'], 'nature': nature, 'evs': dict(record['evs']), 'moves': known,
                 'level': rules.level_for_experience(knowledge().growth(record['nationalSpeciesId']), record['experience'])}
        value.update(changes)
        return value

    def test_matching_target_is_ready(self):
        record = sample()
        result = plan(record, self.target_for(record), save_ot_id=record['fixtureSaveOtId'])
        self.assertEqual(result['status'], 'ready', result['steps'])
        self.assertEqual(result['legality']['verdict'], 'legal')

    def test_ev_training_is_the_executable_step(self):
        record = next(copy.deepcopy(r) for r in SAMPLE['detailed'] if sum(r['evs'].values()) == 0 and 'level' not in r
                      and rules.level_for_experience(knowledge().growth(r['nationalSpeciesId']), r['experience']) < 100)
        evs = dict({s: 0 for s in rules.STATS}, speed=252, attack=252, hp=4)
        result = plan(record, self.target_for(record, evs=evs), save_ot_id=record['fixtureSaveOtId'])
        step = next(s for s in result['steps'] if s['kind'] == 'ev-training')
        self.assertTrue(step['executable'])
        self.assertEqual(step['action']['path'], '/api/pokemon-suite/player-tasks')
        validate_effort_task(step['action']['body']['task'])
        vitamins = [s for s in result['steps'] if s['id'].startswith('get-vitamin')]
        self.assertTrue(vitamins and all(s['action']['body']['task']['kind'] == 'item' for s in vitamins))
        self.assertEqual(result['status'], 'changes')

    def test_ev_training_is_manual_outside_the_current_save_or_at_level_100(self):
        record = next(copy.deepcopy(r) for r in SAMPLE['detailed'] if sum(r['evs'].values()) == 0)
        evs = dict({s: 0 for s in rules.STATS}, speed=252)
        result = plan(record, self.target_for(record, evs=evs), source_id='saved-profile')
        step = next(s for s in result['steps'] if s['kind'] == 'ev-training')
        self.assertFalse(step['executable'])
        self.assertIn('current game', step['manual'])

    def test_fixed_traits_offer_a_new_individual(self):
        record = sample()
        other = next(n for n in rules.NATURE_NAMES if n != rules.nature(record['personality'])['name'])
        hidden = next(t for t in rules.HIDDEN_POWER_TYPES if t != rules.hidden_power(record['ivs'])['type'])
        result = plan(record, self.target_for(record, nature=other.lower(), hiddenPower={'type': hidden}))
        self.assertEqual(result['status'], 'new-individual')
        goal = result['newIndividual']['goal']
        self.assertEqual(goal['schema'], 'pokemon-suite/goal/v1')
        request = goal['steps'][0]['request']
        self.assertEqual(request['natures'], [other.lower()])
        self.assertEqual(request['hiddenPower'], {'type': hidden})
        self.assertEqual(result['newIndividual']['commit']['path'], '/api/pokemon-suite/requests/commit')

    def test_evs_above_the_target_block(self):
        record = next(copy.deepcopy(r) for r in SAMPLE['detailed'] if r['evs']['hp'] > 0)
        result = plan(record, self.target_for(record, evs={s: 0 for s in rules.STATS}))
        self.assertTrue(any('cannot lower EVs' in b for b in result['blockers']))

    def test_moves_and_evolution_are_manual(self):
        k = knowledge()
        record = next(copy.deepcopy(r) for r in SAMPLE['detailed'] if k.descendants(r['nationalSpeciesId']))
        final = k.descendants(record['nationalSpeciesId'])[0]
        known = set(record['moves'])
        tm = next(m for m, s in movepool(final, k).items() if s['method'] == 'machine' and m not in known)
        result = plan(record, self.target_for(record, speciesId=final, moves=[tm]))
        kinds = {s['kind']: s for s in result['steps']}
        self.assertFalse(kinds['evolve']['executable'])
        self.assertIn('in the game', kinds['evolve']['manual'])
        self.assertTrue(any(s['kind'] == 'move' and not s['executable'] for s in result['steps']))

    def test_target_validation(self):
        with self.assertRaises(PlanError):
            normalize_target({'speciesId': 6, 'evs': dict({s: 0 for s in rules.STATS}, hp=255, attack=255, speed=1)})
        with self.assertRaises(PlanError):
            normalize_target({'speciesId': 6, 'moves': [57]})  # Charizard cannot learn Surf
        with self.assertRaises(PlanError):
            normalize_target({'speciesId': 6, 'nature': 'grumpy'})
        self.assertEqual(normalize_target({'speciesId': 6})['level'], 100)


class Trading:
    def __init__(self, inventory):
        self.value = inventory

    def inventory(self, game, source):
        return copy.deepcopy(self.value)


class Handler(SuiteRoutes):
    def __init__(self, server):
        self.server, self.responses = server, []

    def _authenticated(self):
        return True

    def _control_request(self):
        return True

    def _json(self, status, data, head=False):
        self.responses.append((int(status), data))

    def _error(self, status, message):
        self._json(status, {'ok': False, 'error': message})


class Routes(unittest.TestCase):
    def setUp(self):
        self.folder = tempfile.TemporaryDirectory()
        records = [dict(r) for r in SAMPLE['basic']]
        inventory = {'game': 'firered', 'supported': True, 'validity': 'valid', 'sourceId': 'current', 'isActiveSave': True,
                     'pokemon': records, 'trainerOtId': records[0]['fixtureSaveOtId']}
        self.record = records[0]
        self.handler = Handler(SimpleNamespace(directory=Path(self.folder.name), trading=Trading(inventory)))

    def tearDown(self):
        self.folder.cleanup()

    def get(self, target):
        parsed = urlparse(target)
        self.handler.route_get(parsed.path, parsed)
        return self.handler.responses[-1]

    def test_guidance_individual_and_legality(self):
        status, body = self.get('/api/pokemon-suite/builder/guidance?species=6')
        self.assertEqual((status, body['guidance']['name']), (200, 'Charizard'))
        self.assertIn('target', body['guidance']['sets'][0])
        status, body = self.get(f'/api/pokemon-suite/builder/individual?game=firered&source=current&pokemon={self.record["id"]}')
        self.assertEqual(status, 200, body)
        self.assertEqual(body['legality']['verdict'], 'legal')
        self.assertEqual({f['id'] for f in body['fixed']} >= {'nature', 'ivs', 'ability', 'shiny', 'trainer', 'met'}, True)
        status, body = self.get('/api/pokemon-suite/builder/legality?game=firered&source=current')
        self.assertEqual(body['counts']['legal'], len(SAMPLE['basic']))
        status, body = self.get('/api/pokemon-suite/builder/guidance?species=999')
        self.assertEqual(status, 400)

    def test_plan_and_request_are_read_only_posts(self):
        target = {'speciesId': self.record['nationalSpeciesId'], 'evs': {s: 0 for s in rules.STATS}}
        self.handler.route_post('/api/pokemon-suite/builder/plan', {'game': 'firered', 'sourceId': 'current', 'pokemonId': self.record['id'], 'target': target})
        status, body = self.handler.responses[-1]
        self.assertEqual(status, 200, body)
        self.assertTrue(body['plan']['readOnly'])
        self.handler.route_post('/api/pokemon-suite/builder/request', {'target': {'speciesId': 63, 'nature': 'timid', 'hiddenPower': {'type': 'fire'}}})
        status, body = self.handler.responses[-1]
        self.assertEqual(body['newIndividual']['goal']['steps'][0]['request']['hiddenPower'], {'type': 'fire'})
        self.handler.route_post('/api/pokemon-suite/builder/plan', {'game': 'firered'})
        self.assertEqual(self.handler.responses[-1][0], 400)

    def test_companion_can_use_the_builder(self):
        for path in ('/api/pokemon-suite/builder/guidance?species=6', '/api/pokemon-suite/builder/individual',
                     '/api/pokemon-suite/builder/legality'):
            self.assertTrue(allowed_route('GET', path))
        for path in ('/api/pokemon-suite/builder/plan', '/api/pokemon-suite/builder/request'):
            self.assertTrue(allowed_route('POST', path))


if __name__ == '__main__':
    unittest.main()
