"""The Bank: every species, owned individuals across saves, and "Get it" through the same goals as Ask.

Parity: a Bank selection and its typed phrase produce the same goal (tests/data/bank-parity.json,
whose selections the Swift tests check the configurator sends). The interpreter is the deterministic
one (no Laya), so the comparison is stable.
"""
import copy
import hashlib
import json
from pathlib import Path
import unittest
from unittest import mock

from pokemon_suite import pokemon_bank as pb
from pokemon_suite import pokemon_requests as pr
from pokemon_suite.companion import allowed_route

from test_goal_supervisor import Game, GoalTestCase, owner
from pokemon_suite.pokemon_farming import FarmingRequests
from test_request_routes import Goals, Handler, Server

DATA = Path(__file__).resolve().parent / 'data'
CONTEXT = json.loads((DATA / 'request-context.json').read_text())
PARITY = json.loads((DATA / 'bank-parity.json').read_text())['cases']
# What the goal supervisor runs: everything but the draft's own id, time and request source (typed words vs the Bank's summary).
EXECUTED = ('schema', 'game', 'save', 'steps', 'then', 'status', 'progress', 'idempotencyKey')


def typed(text, **extra):
    return pr.Interpreter(**extra).interpret(text, via='typed', context=copy.deepcopy(CONTEXT))


def selected(selection, answers=None, **extra):
    return pr.Interpreter(**extra).select(selection, context=copy.deepcopy(CONTEXT), answers=answers)


def executed(goal):
    return {k: goal[k] for k in EXECUTED}


class BankParity(unittest.TestCase):
    def test_every_bank_selection_matches_its_typed_phrase(self):
        self.assertGreaterEqual(len(PARITY), 8)
        for case in PARITY:
            with self.subTest(case=case['id']):
                spoken, bank = typed(case['phrase']), selected(case['selection'])
                if case.get('refused'):
                    self.assertFalse(spoken['understood'] or bank['understood'])
                    self.assertIsNone(spoken['goal']);self.assertIsNone(bank['goal'])
                    self.assertEqual(bank['message'], spoken['message'])
                    continue
                self.assertTrue(spoken['understood'], spoken['message']);self.assertTrue(bank['understood'], bank['message'])
                self.assertEqual(executed(bank['goal']), executed(spoken['goal']))
                self.assertEqual(json.dumps(executed(bank['goal']), sort_keys=True), json.dumps(executed(spoken['goal']), sort_keys=True))
                self.assertEqual(bank['summary'], spoken['summary'])
                self.assertEqual(bank['confirmation'], spoken['confirmation'])
                self.assertEqual((bank['parser'], spoken['parser']), ('deterministic', 'deterministic'))
                self.assertEqual(bank['goal']['source']['via'], 'ui')
                self.assertEqual(spoken['goal']['source']['via'], 'typed')

    def test_the_example_shiny_timid_abra(self):
        """Abra + shiny + Timid == "get me a shiny timid abra"."""
        bank = selected({'speciesId': 63, 'shiny': True, 'natures': ['timid']})
        spoken = typed('get me a shiny timid abra')
        self.assertEqual(executed(bank['goal']), executed(spoken['goal']))
        request = bank['goal']['steps'][0]['request']
        self.assertEqual((request['speciesId'], request['shiny'], request['natures']), (63, 'required', ['timid']))
        self.assertEqual(bank['goal']['source']['text'], 'Catch shiny Timid Abra')

    def test_send_to_switch_is_the_catch_then_one_trade_per_caught_pokemon(self):
        bank = selected({'speciesId': 63, 'shiny': True, 'destination': 'switch'})
        steps = bank['goal']['steps']
        self.assertEqual([s['kind'] for s in steps], ['farming', 'trade'])
        self.assertEqual(steps[1], {'kind': 'trade', 'via': 'trade-pokemon', 'payload': {'pokemonId': {'$ref': 'steps[0].result.captures.0.pokemonId'}, 'sourceId': 'current'}})
        self.assertEqual(bank['goal']['then'], 'await-command')
        self.assertTrue(bank['confirmation']['required'], 'a trade asks before running')
        self.assertIn('Switch', bank['summary'])
        for phrase in ('catch a shiny abra and send it to the switch', 'catch a shiny abra then trade it', 'catch a shiny abra and trade it to my nintendo switch'):
            with self.subTest(phrase=phrase):
                self.assertEqual(executed(typed(phrase)['goal']), executed(bank['goal']))
        several = selected({'speciesId': 63, 'quantity': 3, 'destination': 'switch'})
        self.assertEqual([s['kind'] for s in several['goal']['steps']], ['farming', 'trade', 'trade', 'trade'])
        self.assertEqual([s['payload']['pokemonId'] for s in several['goal']['steps'][1:]],
                         [{'$ref': f'steps[0].result.captures.{k}.pokemonId'} for k in range(3)], 'one at a time, each by its own caught individual')
        self.assertEqual(several['confirmation']['reasons'], ['Trades the 3 Abra, one at a time, away to the Switch after they are caught and saved.'])
        self.assertEqual(len(selected({'speciesId': 63, 'quantity': 9, 'destination': 'switch'})['goal']['steps']), 10, 'a goal holds up to 10 steps')
        refused = selected({'speciesId': 63, 'quantity': 10, 'destination': 'switch'})
        self.assertIsNone(refused['goal'])
        self.assertIn('up to 9 Abra', refused['message'])

    def test_phrases_that_are_not_a_destination_keep_their_old_meaning(self):
        self.assertIn('level 40', typed('catch a pikachu and send it to level 40')['message'])
        self.assertEqual([s['kind'] for s in typed('trade my kadabra')['goal']['steps']], ['trade'])
        self.assertEqual([s['kind'] for s in typed('get me a shiny timid abra')['goal']['steps']], ['farming'])

    def test_selection_fields_are_validated_with_reasons(self):
        bad = [({'speciesId': 999}, 'isn’t in FireRed'), ({'speciesId': '63'}, 'Choose a Pokémon'), ({'speciesId': 63, 'color': 'red'}, 'Choose a Pokémon'),
               ({'speciesId': 63, 'abilityId': 22}, 'Synchronize, Inner Focus'), ({'speciesId': 63, 'natures': ['grumpy']}, 'natures'),
               ({'speciesId': 63, 'minIvs': {'speed': 32}}, 'IVs'), ({'speciesId': 63, 'minIvs': {'luck': 3}}, 'IVs'),
               ({'speciesId': 63, 'minIvs': {'speed': 20}, 'maxIvs': {'speed': 10}}, 'maximum IV'), ({'speciesId': 63, 'hiddenPower': 'normal'}, 'Hidden Power'),
               ({'speciesId': 63, 'quantity': 0}, 'quantity'), ({'speciesId': 63, 'quantity': 100}, 'quantity'), ({'speciesId': 63, 'shiny': 'yes'}, 'shiny'),
               ({'speciesId': 63, 'gender': 'female', 'destination': 'box'}, 'where the Pokémon goes'), ({'speciesId': 81, 'gender': 'female'}, 'gender is not possible')]
        for selection, message in bad:
            with self.subTest(selection=selection):
                result = selected(selection)
                self.assertFalse(result['understood'])
                self.assertIsNone(result['goal'])
                self.assertIn(message, result['message'])

    def test_the_preview_and_its_questions_are_asks(self):
        """The Bank gets Ask's preview (limitations) and its clarifications, answered the same way."""
        def preview(request):
            if request['ball']['id'] != 'safari-ball':
                raise ValueError('The required Poké Ball is incompatible with this acquisition method. Safari encounters require a Safari Ball.')
            return {'canStart': True, 'state': 'ready-to-verify', 'limitations': ['Continue the current game and prepare the selected encounter route.'],
                    'pokemon': {'name': 'Chansey'}}
        interpreter = pr.Interpreter(preview=preview)
        context = dict(CONTEXT, botSettings=dict(CONTEXT['botSettings'], ball={'id': 'ultra-ball', 'requirement': 'required'}))
        bank = interpreter.select({'speciesId': 113}, context=copy.deepcopy(context))
        spoken = interpreter.interpret('catch a chansey', context=copy.deepcopy(context))
        self.assertEqual(bank['clarification']['id'], '0:ball')
        self.assertEqual(bank['clarification'], spoken['clarification'])
        answered = interpreter.select({'speciesId': 113}, context=copy.deepcopy(context), answers={'0:ball': 'safari-ball'})
        self.assertEqual(answered['goal']['steps'][0]['request']['ball'], {'id': 'safari-ball', 'requirement': 'required'})
        self.assertEqual(answered['preview'][0]['limitations'], ['Continue the current game and prepare the selected encounter route.'])
        spoken = interpreter.interpret('catch a chansey', context=copy.deepcopy(context), answers={'0:ball': 'safari-ball'})
        self.assertEqual(executed(answered['goal']), executed(spoken['goal']))


def service(goals=True, **extra):
    s = Server()
    if goals:
        s.goals = Goals()
    s.pokemon_requests = pr.RequestService(s, interpreter=pr.Interpreter(**extra), context_provider=lambda: copy.deepcopy(CONTEXT))
    return s


class BankRequestRoutes(unittest.TestCase):
    def test_select_then_the_same_commit(self):
        s = service()
        handler = Handler(s)
        handler.route_post('/api/pokemon-suite/requests/select', {'selection': {'speciesId': 63, 'shiny': True, 'natures': ['timid']}})
        status, draft = handler.responses[-1]
        self.assertEqual(status, 200, draft)
        self.assertTrue(draft['understood'])
        self.assertRegex(draft['draftId'], '^[a-f0-9]{32}$')
        handler.route_post('/api/pokemon-suite/requests/commit', {'draftId': draft['draftId'], 'idempotencyKey': 'bank-key-0001'})
        status, committed = handler.responses[-1]
        self.assertEqual(status, 200, committed)
        handler.route_post('/api/pokemon-suite/requests/interpret', {'text': 'get me a shiny timid abra', 'via': 'typed'})
        spoken = handler.responses[-1][1]
        handler.route_post('/api/pokemon-suite/requests/commit', {'draftId': spoken['draftId'], 'idempotencyKey': 'ask-key-0001'})
        bank_goal, ask_goal = s.goals.created
        self.assertEqual({k: v for k, v in bank_goal.items() if k not in ('id', 'createdAt', 'source', 'idempotencyKey')},
                         {k: v for k, v in ask_goal.items() if k not in ('id', 'createdAt', 'source', 'idempotencyKey')})
        self.assertEqual(bank_goal['source']['draftId'], draft['draftId'])
        self.assertEqual(bank_goal['source']['via'], 'ui')

    def test_a_trade_waits_for_the_owners_confirmation(self):
        s = service()
        handler = Handler(s)
        handler.route_post('/api/pokemon-suite/requests/select', {'selection': {'speciesId': 150, 'shiny': True, 'destination': 'switch'}})
        draft = handler.responses[-1][1]
        self.assertTrue(draft['confirmation']['required'])
        handler.route_post('/api/pokemon-suite/requests/commit', {'draftId': draft['draftId'], 'idempotencyKey': 'bank-key-0002'})
        self.assertEqual(handler.responses[-1][0], 409)
        self.assertEqual(s.goals.created, [])
        handler.route_post('/api/pokemon-suite/requests/commit', {'draftId': draft['draftId'], 'idempotencyKey': 'bank-key-0002', 'answers': {'confirm': 'yes'}})
        self.assertEqual(handler.responses[-1][0], 200)
        self.assertEqual([s_['kind'] for s_ in s.goals.created[0]['steps']], ['farming', 'trade'])

    def test_answers_at_commit_are_applied_to_the_selection_not_reread_as_text(self):
        def preview(request):
            if request['ball']['id'] != 'safari-ball':
                raise ValueError('Safari encounters require a Safari Ball.')
            return {'canStart': True, 'limitations': []}
        s = service(preview=preview)
        s.pokemon_requests.context_provider = lambda: dict(copy.deepcopy(CONTEXT), botSettings=dict(CONTEXT['botSettings'], ball={'id': 'ultra-ball', 'requirement': 'required'}))
        handler = Handler(s)
        handler.route_post('/api/pokemon-suite/requests/select', {'selection': {'speciesId': 113, 'shiny': True}})
        draft = handler.responses[-1][1]
        self.assertEqual(draft['clarification']['id'], '0:ball')
        handler.route_post('/api/pokemon-suite/requests/commit', {'draftId': draft['draftId'], 'idempotencyKey': 'bank-key-0003', 'answers': {'0:ball': 'safari-ball'}})
        self.assertEqual(handler.responses[-1][0], 200, handler.responses[-1])
        request = s.goals.created[0]['steps'][0]['request']
        self.assertEqual((request['speciesId'], request['shiny'], request['ball']['id']), (113, 'required', 'safari-ball'))

    def test_select_rejects_other_payloads_and_needs_the_control_session(self):
        handler = Handler(service())
        for payload in ({}, {'selection': 63}, {'selection': {'speciesId': 63}, 'text': 'abra'}, {'selection': {'speciesId': 63}, 'answers': 'yes'}):
            with self.subTest(payload=payload):
                handler.route_post('/api/pokemon-suite/requests/select', payload)
                self.assertEqual(handler.responses[-1][0], 400)
        denied = Handler(service(), control=False)
        denied.route_post('/api/pokemon-suite/requests/select', {'selection': {'speciesId': 63}})
        self.assertEqual(denied.responses[-1][0], 403)

    def test_the_companion_relays_the_bank(self):
        self.assertTrue(allowed_route('GET', '/api/pokemon-suite/bank?game=firered&species=63'))
        self.assertTrue(allowed_route('POST', '/api/pokemon-suite/requests/select'))
        self.assertFalse(allowed_route('POST', '/api/pokemon-suite/bank'))


class Routes(unittest.TestCase):
    def test_every_species_has_a_classified_route(self):
        table = pb.routes()
        self.assertEqual(sorted(table), list(range(1, 387)))
        for sid, route in table.items():
            self.assertIn(route['category'], pb.LABELS, sid)
            self.assertTrue(route['detail'] and route['label'], sid)
            self.assertEqual(route['obtainable'], route['category'] != 'external', sid)

    def test_examples_follow_the_engines_source_rules(self):
        table = pb.routes()
        expect = {63: ('wild', True), 1: ('gift', False), 2: ('evolution', False), 65: ('partner-trade', False), 124: ('gift', False),
                  150: ('static', True), 143: ('static', True), 133: ('gift', True), 243: ('static', False), 172: ('breeding', False),
                  151: ('external', False), 386: ('external', False), 252: ('external', False), 253: ('external', False), 196: ('partner-trade', False)}
        for sid, (category, hunt) in expect.items():
            with self.subTest(species=sid):
                self.assertEqual((table[sid]['category'], table[sid]['hunt']), (category, hunt))
        self.assertIn('Kadabra', table[65]['detail'])
        self.assertEqual((table[124]['label'], table[124]['detail']), ('In-game trade', 'Cerulean City (Give Poliwhirl in a Trade)'))
        self.assertEqual((table[243]['label'], table[150]['detail']), ('Roaming', 'Cerulean Cave (B1F)'))
        self.assertIn('Emerald', table[196]['detail'])
        self.assertIn('Treecko', table[253]['detail'])
        self.assertIn('Pikachu', table[172]['detail'])
        self.assertEqual(table[151]['detail'], pb.EXTERNAL[151])


def fingerprint(species, personality):
    return json.dumps([species, personality, 7, 1, 2, 3, 4, 5, 6], separators=(',', ':'))


def mon(species, personality, *, slot=0, box=None, shiny=False, egg=False, level=None, experience=None, nature='Timid', blocked=None):
    fp = fingerprint(species, personality)
    record = {'id': hashlib.sha256(('firered:' + fp).encode()).hexdigest(), 'fingerprint': fp, 'species': species, 'nationalSpeciesId': species,
              'personality': personality, 'shiny': shiny, 'isEgg': egg, 'natureName': nature, 'nickname': None,
              'ivs': {'hp': 1, 'attack': 2, 'defense': 3, 'speed': 4, 'spAttack': 5, 'spDefense': 6},
              'location': {'kind': 'box', 'box': box, 'slot': slot} if box is not None else {'kind': 'party', 'slot': slot},
              'canTrade': blocked is None, 'canPrepare': True, 'tradeReason': blocked}
    if level is not None:
        record['level'] = level
    if experience is not None:
        record['experience'] = experience
    return record


BROWSING = 'You are browsing a preserved save. Load this collection as the active game before preparing a trade.'


class Trading:
    """TradingLibrary's two read methods over fixed saves (the current game and a preserved one belonging to Nova)."""
    def __init__(self):
        self.sources = self
        self.inventories = {
            'current': {'validity': 'valid', 'isActiveSave': True, 'sessionId': 'rio-session', 'tradeReason': None, 'radio': {'ready': True},
                        'trade': None, 'preparation': None,
                        'pokemon': [mon(63, 11, level=20, shiny=True), mon(63, 12, box=0, slot=4, experience=560), mon(25, 13, box=1),
                                    mon(63, 14, box=2, egg=True)]},
            'nova': {'validity': 'valid', 'isActiveSave': False, 'tradeReason': BROWSING,
                     'pokemon': [mon(63, 11, level=19, shiny=True, blocked=BROWSING), mon(63, 21, box=3, experience=0, nature='Bold', blocked=BROWSING)]},
            'broken': {'validity': 'unknown', 'reason': 'The saved PC inventory could not be read.', 'pokemon': []}}
        self.read = []

    def list(self, game):
        return [{'id': 'current', 'label': 'Current game', 'kind': 'current'}, {'id': 'nova', 'label': 'Nova’s postgame', 'kind': 'saved'},
                {'id': 'broken', 'label': 'Rio test run', 'kind': 'saved'}, {'id': 'gone', 'label': 'Saved game unavailable', 'kind': 'saved', 'error': 'The selected save is unavailable.'}]

    def inventory(self, game, source_id=None):
        self.read.append(source_id)
        return copy.deepcopy(self.inventories[source_id])


class Aggregation(unittest.TestCase):
    def test_owned_counts_cover_every_save_once_per_individual(self):
        trading = Trading()
        result = pb.bank(trading, 'firered')
        self.assertEqual(result['schema'], 'pokemon-suite/bank/v1')
        self.assertEqual(trading.read, ['current', 'nova', 'broken'], 'every readable save, never the unavailable one')
        abra = next(s for s in result['species'] if s['id'] == 63)
        self.assertEqual((abra['owned'], abra['shiny'], abra['copies'], abra['current'], abra['saves']), (3, 1, 4, 2, 2),
                         'the same individual in two saves counts once; the Egg is not counted')
        self.assertEqual(abra['route']['category'], 'wild')
        self.assertEqual(next(s for s in result['species'] if s['id'] == 25)['owned'], 1)
        self.assertEqual(next(s for s in result['species'] if s['id'] == 1)['owned'], 0)
        self.assertEqual(len(result['species']), 386)
        self.assertEqual([(s['id'], s['status']) for s in result['saves']], [('current', 'valid'), ('nova', 'valid'), ('broken', 'unavailable'), ('gone', 'unavailable')])
        self.assertEqual((result['saves'][0]['count'], result['saves'][0]['shiny']), (3, 1))
        self.assertEqual(result['saves'][2]['reason'], 'The saved PC inventory could not be read.')
        self.assertEqual(result['totals']['owned'], 2)

    def test_individuals_keep_their_save_and_only_the_active_save_can_send(self):
        result = pb.bank(Trading(), 'firered', 63)
        rows = [(p['saveLabel'], p['location'].get('box'), p['shiny'], p['level'], p['canPrepare'], p['copies']) for p in result['pokemon']]
        self.assertEqual(rows, [('Current game', None, True, 20, True, 2), ('Current game', 0, False, 10, True, 1), ('Current game', 2, False, None, True, 1),
                                ('Nova’s postgame', None, True, 19, False, 2), ('Nova’s postgame', 3, False, 1, False, 1)])
        preserved = result['pokemon'][3]
        self.assertEqual((preserved['sourceId'], preserved['isActiveSave'], preserved['canTrade'], preserved['tradeReason']), ('nova', False, False, BROWSING))
        self.assertEqual(result['sessionId'], 'rio-session')
        self.assertEqual(result['route']['category'], 'wild')
        self.assertEqual([s.get('count') for s in result['saves']], [2, 2, None, None], 'Abra in each save, Eggs aside')

    def test_other_games_and_numbers_are_refused(self):
        for game, species in (('emerald', None), ('firered', 0), ('firered', 387), ('firered', '63')):
            with self.subTest(game=game, species=species):
                with self.assertRaises(ValueError):
                    pb.bank(Trading(), game, species)

    def test_the_route_reads_and_validates(self):
        s = Server()
        s.trading = Trading()
        handler = Handler(s)
        self.assertIsNone(handler.route_get('/api/pokemon-suite/bank', mock.Mock(query='game=firered')))
        status, body = handler.responses[-1]
        self.assertEqual(status, 200)
        self.assertEqual(len(body['species']), 386)
        handler.route_get('/api/pokemon-suite/bank', mock.Mock(query='game=firered&species=63'))
        self.assertEqual(len(handler.responses[-1][1]['pokemon']), 5)
        for query in ('game=firered&species=abra', 'game=firered&species=63&species=64', 'game=firered&save=nova', '', 'game=crystal'):
            with self.subTest(query=query):
                handler.route_get('/api/pokemon-suite/bank', mock.Mock(query=query))
                self.assertEqual(handler.responses[-1][0], 400)
        denied = Handler(s, control=False)
        denied.route_get('/api/pokemon-suite/bank', mock.Mock(query='game=firered'))
        self.assertEqual(denied.responses[-1][0], 403)


class RepeatLoads(unittest.TestCase):
    """A preserved save's inventory is read once and reused until its save file changes; the current game is always read."""

    def test_saved_inventories_are_reused_until_their_save_changes(self):
        import os
        import tempfile
        with tempfile.TemporaryDirectory() as temp:
            library = Path(temp)/'nova-library'
            (library/'firered'/'save-profiles'/'nova-1').mkdir(parents=True)
            (library/'config.json').write_text('{"games": {"firered": {}}}')
            record = library/'firered'/'save-profiles'/'nova-1.json'
            record.write_text('{"id": "nova-1", "label": "Nova’s postgame"}')
            save = library/'firered'/'save-profiles'/'nova-1'/'current.json'
            save.write_text('{"frame": 1}')
            trading = Trading()
            sources = [{'id': 'current', 'label': 'Current game', 'kind': 'current'},
                       {'id': 'nova', 'label': 'Nova’s postgame', 'kind': 'saved', 'library': str(library), 'profileId': 'nova-1', 'recordPath': str(record)}]
            trading.list = lambda game: copy.deepcopy(sources)
            first = pb.bank(trading, 'firered')
            self.assertEqual(trading.read, ['current', 'nova'])
            self.assertEqual(pb.bank(trading, 'firered'), first)
            pb.bank(trading, 'firered', 63)
            self.assertEqual(trading.read, ['current', 'nova', 'current', 'current'], 'the preserved save is not read again')
            # The save changes (a new checkpoint is written): it is read again, and the new contents are shown.
            trading.inventories['nova']['pokemon'].append(mon(63, 99, box=5, blocked=BROWSING))
            save.write_text('{"frame": 2, "more": true}')
            os.utime(save, ns=(save.stat().st_atime_ns, save.stat().st_mtime_ns + 1_000_000))
            again = pb.bank(trading, 'firered')
            self.assertEqual(trading.read[-2:], ['current', 'nova'])
            self.assertEqual(next(s for s in again['species'] if s['id'] == 63)['owned'], 4)
            # A save that can no longer be read is not served from the cache.
            save.unlink()
            trading.inventories['nova'] = {'validity': 'unknown', 'reason': 'The saved profile is missing its checkpoint.', 'pokemon': []}
            gone = pb.bank(trading, 'firered')
            self.assertEqual(trading.read[-1], 'nova')
            self.assertEqual(gone['saves'][1]['status'], 'unavailable')


class SendToSwitchGoal(GoalTestCase):
    """The Bank's "Send to the Switch" goal runs as its steps say: the hunt, then a trade of each Pokémon it caught."""

    def test_the_trade_steps_use_the_inventory_id_of_each_caught_pokemon(self):
        from pokemon_suite.pokemon_goals import GoalSupervisor, inventory_id
        live = owner()
        traded = []

        class Trading:
            def trade(self, game, identifier, session_id, source_id='current'):
                traded.append(identifier)
                live['nativeTrade'] = {'fingerprint': f'trade-{len(traded)}', 'phase': 'advertising'}
                return live
        self.game = Game(self.root, live)
        supervisor = GoalSupervisor(self.game, FarmingRequests(self.root/'farming', self.game), Trading(), clock=lambda: self.now)
        draft = selected({'speciesId': 63, 'natures': ['timid'], 'quantity': 2, 'destination': 'switch'})
        goal = self.submit(supervisor, {**{k: draft['goal'][k] for k in pr.SUBMIT_FIELDS if k in draft['goal']}, 'idempotencyKey': 'bank-goal-0001'})
        self.assertEqual([s['kind'] for s in goal['steps']], ['farming', 'trade', 'trade'])
        goal = self.ticks(supervisor, 3)
        rid = goal['execution']['steps'][0]['requestId']
        identities = ['[63,3141592653,2718281828,31,30,29,28,27,26]', '[63,1618033988,2718281828,1,2,3,4,5,6]']
        folder = self.root/'firered/hunts'/rid/'native-radio/saves'
        folder.mkdir(parents=True)
        captures = [{'fingerprint': f, 'pokemon': {'species': 63, 'shiny': False, 'nature': {'id': 10, 'name': 'Timid'}}, 'savedSramSha256': 'f' * 64, 'target': True}
                    for f in identities]
        (folder/'current.json').write_text(json.dumps({'schema': 'pokemon-suite/checkpoint/v1', 'metadata': {'session': {
            'id': rid, 'request': {}, 'mission': {'id': rid, 'status': 'complete', 'captures': captures}}}}))
        live['mission'].update(state='complete', caught=2)
        live['bot'].update(awaitingCommand=True)
        goal = self.ticks(supervisor, 3)
        self.assertEqual(traded, [inventory_id('firered', identities[0])])
        self.assertEqual(goal['progress']['phase'], 'trade')
        live['nativeTrade'].update(phase='complete', completion={'nativeSaveVerified': True})
        goal = self.ticks(supervisor, 2)
        self.assertEqual(traded, [inventory_id('firered', f) for f in identities], 'the next trade starts only after the first is verified')


if __name__ == '__main__':
    unittest.main()
