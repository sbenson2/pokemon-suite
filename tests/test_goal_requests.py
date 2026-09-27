"""Goal-request foundations (G1): static targets, story gates and priority."""
import json
import tempfile
import unittest
from pathlib import Path
from unittest import mock

from pokemon_suite.pokemon_farming import FarmingRequests, catalog, GAMES
from pokemon_suite.pokemon_sessions import SuiteSessions, hunt_capability


def request(species=150, **extra):
    value = dict(schema='pokemon-suite/farming-request/v1', game='firered', speciesId=species, quantity=1, shiny='required',
                 locationId='any', natures=[], gender='any', abilityId=None, ball={'id': 'any', 'requirement': 'preferred'},
                 minIvs={}, minDvs={}, encounterLevel={'min': 1, 'max': 100}, finalLevel=None, moves=[], heldItemId=None,
                 limits={'minBalls': 10, 'maxSpend': 999999, 'maxMinutes': 120, 'maxEncounters': 1000}, afterCompletion='stop-save')
    value.update(extra)
    return value


GATES = {'leagueComplete': (2092, 'Enter the Hall of Fame', 'Hall of Fame'),
         'nationalDex': (2112, 'Unlock the National Pokédex', 'National Pokédex'),
         'canLinkNationally': (2116, 'Complete Celio’s Ruby and Sapphire quest', 'Celio’s link (Ruby and Sapphire quest)')}


def statics(league=True, dex=True, link=True, used=()):
    """The engine's gameProgress.statics for a save with these story flags."""
    known = {'leagueComplete': league, 'nationalDex': dex, 'canLinkNationally': link}
    result = []
    for key, species, name, gates in (('mewtwo', 150, 'Mewtwo', ['leagueComplete', 'nationalDex', 'canLinkNationally']),
                                      ('articuno', 144, 'Articuno', ['leagueComplete']), ('zapdos', 145, 'Zapdos', ['leagueComplete']),
                                      ('moltres', 146, 'Moltres', ['leagueComplete']), ('snorlax', 143, 'Snorlax', ['leagueComplete'])):
        requirements = [{'key': g, 'flag': GATES[g][0], 'label': GATES[g][1], 'need': GATES[g][2], 'met': known[g]} for g in gates]
        missing = [r['need'] for r in requirements if r['met'] is False]
        consumed = species in used
        result.append({'id': key, 'speciesId': species, 'name': name, 'method': 'snorlax' if species == 143 else 'static', 'used': consumed,
                       'owned': consumed, 'requirements': requirements, 'missing': missing,
                       'available': False if consumed or missing else True,
                       'status': 'used' if consumed else 'needs-prerequisites' if missing else 'available'})
    return result


class Owner(SuiteSessions):
    """Real SuiteSessions whose FireRed owner status is served from memory."""
    def __init__(self, directory, live):
        super().__init__(directory)
        (directory/'config.json').write_text(json.dumps({'directory': str(directory), 'games': {'firered': {'port': 1}}}))
        (directory/'firered').mkdir(exist_ok=True)
        self.live = live
        self.sent = []

    def _live(self, game):
        return self.live if game == 'firered' else None

    def ensure(self, game, *, manual=False, update_hold=False):
        return self.live

    def command(self, game, body, session_id=None):
        self.sent.append((game, body))
        return self.live


def live(**progress):
    return {'schema': 'pokemon-suite/session/v1', 'game': 'firered', 'owner': 'firered', 'sessionId': 'red',
            'bot': {'enabled': True, 'awaitingCommand': True, 'runScope': 'task'},
            'gameProgress': {'game': 'firered', 'leagueComplete': True, 'nationalDex': True, 'canLinkNationally': True, **progress}}


class StaticCapabilityTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        self.root = Path(self.temp.name)
        patcher = mock.patch('pokemon_suite.capabilities.require_feature', return_value={'readiness': 'ready'})
        patcher.start();self.addCleanup(patcher.stop)

    def test_legendary_static_requests_have_an_engine_static_route(self):
        result = hunt_capability(request(150))
        self.assertTrue(result['supported'], result.get('reason'))
        self.assertEqual(result['method'], 'static')
        self.assertEqual(result['setup'], 'current-game')
        self.assertEqual(result['route']['method'], 'static')
        self.assertEqual((result['route']['map'], result['route']['flag'], result['route']['level']), ('MAP_CERULEAN_CAVE_B1F', 700, 70))
        self.assertEqual([r['key'] for r in result['requires']], ['leagueComplete', 'nationalDex', 'canLinkNationally'])
        for species in (144, 145, 146):
            bird = hunt_capability(request(species, shiny='any'))
            self.assertTrue(bird['supported'], bird.get('reason'))
            self.assertEqual(bird['route']['method'], 'static')
            self.assertEqual([r['key'] for r in bird['requires']], ['leagueComplete'])
        self.assertIn('one', hunt_capability(request(150, quantity=2))['reason'].lower())
        self.assertIn('Ultra', hunt_capability(request(150, ball={'id': 'master-ball', 'requirement': 'required'}))['reason'])
        self.assertIn('level 70', hunt_capability(request(150, encounterLevel={'min': 1, 'max': 50}))['reason'])
        self.assertIn('any location', hunt_capability(request(150, locationId='10:325:20:'))['reason'])
        # Event-island statics have no engine executor.
        self.assertFalse(hunt_capability(request(249))['supported'])

    def test_saved_requests_pinned_to_older_game_data_still_resolve_static_routes(self):
        from pokemon_suite.data_provider import DataProvider
        with DataProvider(self.root).snapshot({'schema': 'pokemon-suite/data-lock/v1', 'files': {}}):
            self.assertEqual(hunt_capability(request(150))['method'], 'static')

    def test_static_projection_matches_the_pokedex_catalog(self):
        from pokemon_suite.pokemon_hunt_routes import static_encounters
        species = {s['id']: s for s in catalog('firered')['species']}
        encounters = static_encounters()
        self.assertEqual([e['speciesId'] for e in encounters], [150, 144, 145, 146])
        for e in encounters:
            native = next(x for x in species[e['speciesId']]['encounters'] if x['method'] == 'static')
            self.assertEqual((e['locationId'], e['location'], e['level'], e['name']), (native['id'], native['location'], native['minLevel'], species[e['speciesId']]['name']))

    def test_post_league_save_can_start_a_shiny_mewtwo_but_a_pre_league_save_needs_the_hall_of_fame(self):
        post = Owner(self.root, live(statics=statics()))
        farming = FarmingRequests(self.root/'farming', post)
        plan = farming.preview(request(150))
        self.assertTrue(plan['canStart'], plan['limitations'])
        self.assertEqual(plan['route']['method'], 'static')
        self.assertIn('Cerulean Cave', ' '.join(plan['steps']))
        self.assertEqual([p['state'] for p in plan['prerequisites']], ['ready', 'ready', 'ready'])

        pre = Owner(self.root, live(leagueComplete=False, nationalDex=False, canLinkNationally=False, statics=statics(False, False, False)))
        plan = FarmingRequests(self.root/'farming', pre).preview(request(150))
        self.assertFalse(plan['canStart'])
        self.assertIn('needs', plan['limitations'][0])
        self.assertIn('Hall of Fame', plan['limitations'][0])
        self.assertEqual({p['key']: p['state'] for p in plan['prerequisites']}, {'leagueComplete': 'pending', 'nationalDex': 'pending', 'canLinkNationally': 'pending'})
        # The acquisition route carries the same story gates for the goal supervisor.
        self.assertEqual([p['key'] for p in plan['acquisition']['prerequisites']], ['leagueComplete', 'nationalDex', 'canLinkNationally'])
        self.assertIn('Enter the Hall of Fame — not completed in the current game.', plan['limitations'])

        league = Owner(self.root, live(nationalDex=False, canLinkNationally=False, statics=statics(True, False, False)))
        plan = FarmingRequests(self.root/'farming', league).preview(request(144))
        self.assertTrue(plan['canStart'], plan['limitations'])

    def test_a_used_static_is_reported_instead_of_offered_again(self):
        used = Owner(self.root, live(statics=statics(used=(150,))))
        result = used.capability(request(150))
        self.assertFalse(result['supported'])
        self.assertIn('already', result['reason'])
        plan = FarmingRequests(self.root/'farming', used).preview(request(150))
        self.assertFalse(plan['canStart'])
        self.assertIn('already', plan['limitations'][0])
        self.assertNotIn('static', [r['source']['method'] for r in [plan.get('acquisition')] if r and r['source']['game'] == 'firered'])

    def test_acquisition_routes_report_story_prerequisites_for_engine_statics(self):
        from pokemon_suite.pokemon_acquisition import acquisition_routes
        from pokemon_suite.pokemon_hunt_routes import static_encounters
        catalogs = {game: catalog(game) for game in GAMES}
        index = {e['speciesId']: e for e in static_encounters()}
        route = next(r for r in acquisition_routes(request(150), catalogs, None, statics=index) if r['source']['method'] == 'static')
        self.assertEqual([p['key'] for p in route['prerequisites']], ['leagueComplete', 'nationalDex', 'canLinkNationally'])
        self.assertEqual(route['prerequisites'][0]['label'], 'Enter the Hall of Fame')
        route = next(r for r in acquisition_routes(request(145), catalogs, None, statics=index) if r['source']['method'] == 'static')
        self.assertEqual([p['key'] for p in route['prerequisites']], ['leagueComplete'])
        # Without engine knowledge the catalog route stays ungated, as before.
        route = next(r for r in acquisition_routes(request(145), catalogs, None) if r['source']['method'] == 'static')
        self.assertEqual(route['prerequisites'], [])


class PriorityTargetTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        self.root = Path(self.temp.name)
        patcher = mock.patch('pokemon_suite.capabilities.require_feature', return_value={'readiness': 'ready'})
        patcher.start();self.addCleanup(patcher.stop)

    def test_postgame_task_passes_a_priority_target_through_to_the_owner(self):
        owner = Owner(self.root, live(statics=statics()))
        owner.player_task('firered', 'postgame', {'priorityTarget': {'speciesId': 150, 'shiny': 'required', 'requestId': 'goal-1'}})
        self.assertEqual(owner.sent[-1], ('firered', {'type': 'postgame-goal', 'priorityTarget': {'speciesId': 150, 'shiny': 'required', 'requestId': 'goal-1'}}))
        owner.player_task('firered', 'postgame', None)
        self.assertEqual(owner.sent[-1], ('firered', {'type': 'postgame-goal'}), 'the plain checklist keeps its durable target')
        owner.player_task('firered', 'postgame', {'priorityTarget': None})
        self.assertEqual(owner.sent[-1], ('firered', {'type': 'postgame-goal', 'priorityTarget': None}))
        for bad in ({'priorityTarget': {'speciesId': '150'}}, {'priorityTarget': {'speciesId': 150, 'shiny': 'maybe'}},
                    {'priorityTarget': {'speciesId': 150, 'requestId': '../x'}}, {'priorityTarget': {'speciesId': 150, 'extra': 1}}, {'other': 1}):
            with self.assertRaises(ValueError):
                owner.player_task('firered', 'postgame', bad)

    def test_a_static_farming_request_during_postgame_becomes_the_agenda_priority(self):
        running = live(statics=statics())
        running['bot'] = {'enabled': True, 'awaitingCommand': False, 'runScope': 'postgame', 'activity': 'postgame'}
        owner = Owner(self.root, running)
        record = {'id': 'mewtwo-request-1', 'request': request(150)}
        result = owner.start(record)
        game, body = owner.sent[-1]
        self.assertEqual(body['type'], 'postgame-goal')
        self.assertEqual(body['priorityTarget'], {'speciesId': 150, 'shiny': 'required', 'requestId': 'mewtwo-request-1', 'request': record['request']})
        self.assertEqual(result['stage'], 'postgame-priority')
        # Outside the postgame checklist the request remains an ordinary current-game hunt.
        idle = Owner(self.root, live(statics=statics()))
        idle.start(record)
        game, body = idle.sent[-1]
        self.assertEqual(body['type'], 'start')
        self.assertEqual(body['record']['route']['method'], 'static')


if __name__ == '__main__':
    unittest.main()
