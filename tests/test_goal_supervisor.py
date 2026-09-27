"""Goal supervisor (G2): a request becomes a goal the bot pursues end to end.

The supervisor executes goal steps in order through the Suite's existing
controls (player tasks, farming requests, campaign preview/start, trades). The
FireRed owner is simulated in memory; every command body it receives is the one
the real worker would receive.
"""
import json
import sqlite3
import tempfile
import time
import unittest
import uuid
from pathlib import Path
from types import SimpleNamespace
from unittest import mock

from pokemon_suite.pokemon_farming import FarmingRequests
from pokemon_suite.pokemon_sessions import SuiteSessions

KEY = 'goal-key-0001'


def request(species=150, **extra):
    value = dict(schema='pokemon-suite/farming-request/v1', game='firered', speciesId=species, quantity=1, shiny='required',
                 locationId='any', natures=[], gender='any', abilityId=None, ball={'id': 'any', 'requirement': 'preferred'},
                 minIvs={}, minDvs={}, encounterLevel={'min': 1, 'max': 100}, finalLevel=None, moves=[], heldItemId=None,
                 limits={'minBalls': 10, 'maxSpend': 999999, 'maxMinutes': 240, 'maxEncounters': 1000}, afterCompletion='stop-save')
    value.update(extra)
    return value


GATES = {'leagueComplete': (2092, 'Enter the Hall of Fame', 'Hall of Fame'),
         'nationalDex': (2112, 'Unlock the National Pokédex', 'National Pokédex'),
         'canLinkNationally': (2116, 'Complete Celio’s Ruby and Sapphire quest', 'Celio’s link (Ruby and Sapphire quest)')}


def statics(league=True, dex=True, link=True, used=()):
    """gameProgress.statics as the G1 engine reports it."""
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


def owner(league=True, dex=True, link=True, used=(), **extra):
    live = {'schema': 'pokemon-suite/session/v1', 'game': 'firered', 'owner': 'firered', 'sessionId': 'red', 'state': 'ready', 'mode': 'overworld',
            'bot': {'enabled': True, 'awaitingCommand': True, 'runScope': 'task'},
            'gameProgress': {'game': 'firered', 'leagueComplete': league, 'nationalDex': dex, 'canLinkNationally': link, 'eeveeGiftAvailable': False,
                             'statics': statics(league, dex, link, used)},
            'postgame': {'enabled': False, 'priorityTarget': None, 'priorityHistory': []},
            'storage': {'known': True, 'canStart': True}, 'collection': [], 'mission': None, 'pendingHunt': None, 'newProfile': False}
    live.update(extra)
    return live


class Game(SuiteSessions):
    """A real SuiteSessions whose FireRed owner lives in memory."""
    def __init__(self, directory, live):
        super().__init__(directory)
        (directory/'config.json').write_text(json.dumps({'directory': str(directory), 'games': {'firered': {'port': 1}}}))
        (directory/'firered').mkdir(exist_ok=True)
        self.live = live
        self.sent = []

    def _live(self, game):
        return self.live if game == 'firered' else None

    def ensure(self, game, *, manual=False, update_hold=False):
        self.launched = getattr(self, 'launched', 0) + (self.live is None)
        if self.live is None:
            self.live = owner()
        return self.live

    def command(self, game, body, session_id=None):
        self.sent.append(json.loads(json.dumps(body)))
        live, bot, kind = self.live, self.live['bot'], body['type']
        if kind == 'start-campaign':
            live['campaign'] = {'id': body['previewId'], 'status': 'running', 'reason': None, 'objective': None,
                                'storyProgress': {'badges': {'earned': 0, 'known': 8, 'total': 8}}}
            bot.update(enabled=True, awaitingCommand=False, runScope='campaign')
        elif kind == 'postgame-goal':
            bot.update(enabled=True, awaitingCommand=False, runScope='postgame')
            live['postgame']['enabled'] = True
            if 'priorityTarget' in body:
                previous, target = live['postgame']['priorityTarget'], body['priorityTarget']
                if previous and (target is None or previous.get('requestId') != target.get('requestId')):
                    live['postgame']['priorityHistory'].append({**previous, 'outcome': 'cleared' if target is None else 'replaced'})
                live['postgame']['priorityTarget'] = None if target is None else {'schema': 'pokemon-suite/postgame-priority/v1', 'id': 'mewtwo', **target}
        elif kind == 'start':
            live['mission'] = {'id': body['record']['id'], 'state': 'running', 'phase': 'hunting', 'speciesId': body['record']['request']['speciesId'],
                               'encounters': 0, 'caught': 0}
            bot.update(enabled=True, awaitingCommand=False, runScope=body.get('runScope', 'task'))
        elif kind == 'player-task':
            bot.update(enabled=True, awaitingCommand=False, runScope='task',
                       preparation={'requestId': body['request']['id'], 'kind': body['request']['kind'], 'phase': 'working'})
        elif kind == 'set-bot':
            bot.update(enabled=body['enabled'], awaitingCommand=False, **({'runScope': body['runScope']} if 'runScope' in body else {}))
        elif kind == 'stop':
            bot.update(enabled=False)
            if (live.get('mission') or {}).get('id') == body.get('id'):
                live['mission']['state'] = 'paused'
        elif kind == 'start-bot':
            bot.update(enabled=True, awaitingCommand=True, runScope='task')
        return live


def resolve_campaign(sessions, game, action, settings=None):
    """The engine CLI's preview result (roster planning is outside this test)."""
    run = 'run-' + str(uuid.uuid4())
    return {'record': {'id': run, 'settings': {'label': 'x', 'starter': 'random', 'afterCampaign': 'postgame', 'trainerName': None, **settings}},
            'preview': {'id': run, 'settings': settings}}


class GoalTestCase(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        self.root = Path(self.temp.name)/'pokemon-suite'
        self.root.mkdir()
        for target, value in (('pokemon_suite.capabilities.require_feature', {'readiness': 'ready'}),):
            patcher = mock.patch(target, return_value=value)
            patcher.start();self.addCleanup(patcher.stop)
        patcher = mock.patch('pokemon_suite.pokemon_campaigns.resolve', side_effect=resolve_campaign)
        self.resolve = patcher.start();self.addCleanup(patcher.stop)
        patcher = mock.patch('pokemon_suite.pokemon_sessions.subprocess.Popen')
        self.popen = patcher.start();self.addCleanup(patcher.stop)
        # Player-task options read the cartridge's world data; tasks here need none.
        patcher = mock.patch('pokemon_suite.pokemon_player_tasks.options', return_value={'supported': True, 'locations': [], 'items': [], 'profiles': []})
        patcher.start();self.addCleanup(patcher.stop)
        self.now = 1_800_000_000.0

    def fresh(self):
        """A separate Suite runtime (and owner) inside the same test."""
        self.game = None
        self.root = Path(tempfile.mkdtemp(dir=self.temp.name))/'pokemon-suite'
        self.root.mkdir()

    def supervisor(self, live):
        from pokemon_suite.pokemon_goals import GoalSupervisor
        self.game = getattr(self, 'game', None) or Game(self.root, live)
        self.farming = FarmingRequests(self.root/'farming', self.game)
        return GoalSupervisor(self.game, self.farming, clock=lambda: self.now)

    def goal(self, *steps, **fields):
        value = {'schema': 'pokemon-suite/goal/v1', 'source': {'text': 'get me a shiny Mewtwo', 'via': 'typed', 'interpreter': {'parser': 'deterministic', 'confidence': 0.97}},
                 'game': 'firered', 'save': {'mode': 'current-if-able', 'trainerName': None, 'starter': None, 'label': None},
                 'steps': list(steps) or [{'kind': 'farming', 'request': request(150)}], 'then': 'standing-goals', 'idempotencyKey': KEY}
        value.update(fields)
        return value

    def ticks(self, supervisor, n=1):
        for _ in range(n):
            self.now += 1
            supervisor.tick()
        return supervisor.store.get(self.goal_id)

    def submit(self, supervisor, value):
        goal = supervisor.submit(value)
        self.goal_id = goal['id']
        return goal

    def types(self):
        return [body['type'] for body in self.game.sent]


class GoalValidationTests(GoalTestCase):
    def test_goal_is_validated_queued_and_idempotent(self):
        supervisor = self.supervisor(owner())
        goal = self.submit(supervisor, self.goal())
        self.assertEqual(goal['schema'], 'pokemon-suite/goal/v1')
        self.assertEqual(goal['status'], 'queued')
        self.assertEqual(goal['progress']['step'], 0)
        self.assertEqual(goal['idempotencyKey'], KEY)
        uuid.UUID(goal['id'])
        # Retrying the same commit returns the same goal, never a second one.
        self.assertEqual(supervisor.submit(self.goal())['id'], goal['id'])
        self.assertEqual(len(supervisor.goals()['goals']), 1)
        with self.assertRaisesRegex(ValueError, 'identifier was already used'):
            supervisor.submit(self.goal(steps=[{'kind': 'farming', 'request': request(144)}]))
        self.assertEqual(self.game.sent, [], 'validation never controls the game')

    def test_invalid_goals_are_rejected_with_reasons(self):
        supervisor = self.supervisor(owner())
        bad = [
            ({'idempotencyKey': 'short'}, 'identifier'),
            ({'game': 'emerald'}, 'FireRed'),
            ({'steps': []}, 'step'),
            ({'steps': [{'kind': 'teleport'}]}, 'step'),
            ({'then': 'forever'}, 'after'),
            ({'save': {'mode': 'another'}}, 'save'),
            ({'save': {'mode': 'new', 'trainerName': 'NOVABELL'}}, 'trainer name'),
            ({'save': {'mode': 'new', 'trainerName': 'SH4WN'}}, 'trainer name'),
            ({'save': {'mode': 'new', 'starter': 'pikachu'}}, 'starter'),
            ({'steps': [{'kind': 'farming', 'request': request(150, quantity=0)}]}, 'Quantity'),
            ({'steps': [{'kind': 'postgame', 'priorityTarget': {'speciesId': 25}}]}, 'static'),
            ({'steps': [{'kind': 'campaign', 'settings': {'starter': 'squirtle'}}], 'save': {'mode': 'current'}}, 'new save'),
            ({'steps': [{'kind': 'farming', 'request': request(16, shiny='any')}, {'kind': 'campaign', 'settings': {}}]}, 'first'),
            ({'steps': [{'kind': 'campaign', 'settings': {'trainerName': 'TOOLONGNAME'}}]}, 'trainer name'),
            ({'steps': [{'kind': 'player-task', 'action': 'teleport'}]}, 'task'),
            ({'steps': [{'kind': 'collection', 'goal': 'everything'}]}, 'collection'),
            ({'steps': [{'kind': 'trade', 'via': 'trade-shiny', 'payload': {'shinyId': 'nope'}}]}, 'shiny'),
            ({'steps': [{'kind': 'status', 'question': 'weather'}]}, 'question'),
            ({'source': {'text': 'x' * 2001}}, 'text'),
        ]
        for change, message in bad:
            with self.subTest(change=change):
                with self.assertRaisesRegex(ValueError, f'(?i){message}'):
                    supervisor.submit(self.goal(**change))
        self.assertEqual(supervisor.goals()['goals'], [])

    def test_goals_persist_atomically_across_store_instances(self):
        from pokemon_suite.pokemon_goals import GoalStore
        supervisor = self.supervisor(owner())
        goal = self.submit(supervisor, self.goal())
        stored = json.loads((self.root/'goals.json').read_text())
        self.assertEqual(stored['schema'], 'pokemon-suite/goals/v1')
        self.assertEqual(stored['goals'][0]['id'], goal['id'])
        self.assertEqual(GoalStore(self.root).get(goal['id'])['status'], 'queued')
        self.assertFalse(list(self.root.glob('goals.json.*')), 'no temporary files remain')


class SaveResolutionTests(GoalTestCase):
    def test_reachable_goal_runs_on_the_current_save_without_a_new_save(self):
        supervisor = self.supervisor(owner())
        self.submit(supervisor, self.goal())
        goal = self.ticks(supervisor, 3)
        self.assertEqual(goal['execution']['save']['decision'], 'current')
        self.assertNotIn('start-campaign', self.types())
        self.assertNotIn('new-save', self.types())
        start = next(body for body in self.game.sent if body['type'] == 'start')
        rid = goal['execution']['steps'][0]['requestId']
        self.assertEqual(start['record']['id'], rid, 'the hunt runs under its saved farming request')
        self.assertEqual(start['record']['route']['method'], 'static')
        self.assertEqual(self.farming.get(rid)['request']['speciesId'], 150)
        self.assertEqual(goal['status'], 'running')

    def test_unreachable_goal_waits_for_the_owner_when_a_new_save_was_not_requested(self):
        supervisor = self.supervisor(owner(used=(150,)))
        self.submit(supervisor, self.goal())
        goal = self.ticks(supervisor, 3)
        self.assertEqual(goal['status'], 'waiting')
        self.assertEqual(goal['progress']['phase'], 'needs-decision')
        self.assertRegex(goal['progress']['detail'], 'Mewtwo.*(used|already)')
        self.assertIn('new-save', [c['id'] for c in goal['question']['choices']])
        self.assertEqual(self.game.sent, [], 'nothing is started and no save is replaced')
        self.assertIsNone(supervisor.store.active(), 'a goal waiting for the owner does not block later goals')

    def test_new_save_goal_backs_up_through_the_campaign_start_flow(self):
        supervisor = self.supervisor(owner())
        self.submit(supervisor, self.goal(save={'mode': 'new', 'trainerName': 'NOVA', 'starter': 'squirtle', 'label': 'Shiny Mewtwo run'}))
        goal = self.ticks(supervisor, 3)
        self.assertEqual(goal['execution']['save']['decision'], 'new')
        settings = self.resolve.call_args_list[0].args[3]
        self.assertEqual(settings, {'label': 'Shiny Mewtwo run', 'starter': 'squirtle', 'trainerName': 'NOVA', 'afterCampaign': 'postgame'})
        started = [body for body in self.game.sent if body['type'] == 'start-campaign']
        self.assertEqual(len(started), 1, 'the existing start-campaign flow creates the new save (and backs up the current one)')
        self.assertNotIn('new-save', self.types(), 'no second, unreviewed save switch')
        review = json.loads((self.root/'firered/run-previews'/f"{started[0]['previewId']}.json").read_text())
        self.assertTrue(review['started'])
        plan = goal['execution']['plan']
        self.assertEqual([s['kind'] for s in plan], ['campaign', 'farming'])
        self.assertEqual(goal['progress']['phase'], 'campaign')

    def test_no_save_starts_a_new_game_when_the_current_save_cannot_reach_the_goal(self):
        blank = owner(league=False, dex=False, link=False, newProfile=True)
        supervisor = self.supervisor(blank)
        self.submit(supervisor, self.goal())
        goal = self.ticks(supervisor, 3)
        self.assertEqual(goal['execution']['save']['decision'], 'new')
        self.assertIn('start-campaign', self.types())

    def test_current_save_without_hall_of_fame_or_campaign_needs_a_decision(self):
        supervisor = self.supervisor(owner(league=False, dex=False, link=False))
        self.submit(supervisor, self.goal())
        goal = self.ticks(supervisor, 2)
        self.assertEqual(goal['progress']['phase'], 'needs-decision')
        self.assertRegex(goal['progress']['detail'], 'Hall of Fame')
        self.assertEqual(self.game.sent, [])


class ChainTests(GoalTestCase):
    def test_steps_execute_in_order_with_existing_controls(self):
        # Planning the whole collection previews every species; not under test here.
        patcher = mock.patch('pokemon_suite.pokemon_shiny_sweep.ShinySweep.start', return_value={'enabled': True, 'goal': 'supported'})
        patcher.start();self.addCleanup(patcher.stop)
        live = owner()
        supervisor = self.supervisor(live)
        self.submit(supervisor, self.goal({'kind': 'player-task', 'action': 'start', 'task': {'kind': 'heal'}},
                                          {'kind': 'farming', 'request': request(16, shiny='any')},
                                          {'kind': 'collection', 'goal': 'supported'}, then='await-command'))
        goal = self.ticks(supervisor, 3)
        self.assertEqual(self.types(), ['player-task'])
        task_id = self.game.sent[0]['request']['id']
        self.assertEqual(goal['execution']['steps'][0]['taskId'], task_id)
        self.ticks(supervisor, 2)
        self.assertEqual(self.types(), ['player-task'], 'the next step waits for the task receipt')
        (self.root/'firered'/f'player-task-{task_id}.json').write_text(json.dumps({'request': {'id': task_id}}))
        live['bot'].update(awaitingCommand=True, preparation=None)
        goal = self.ticks(supervisor, 2)
        self.assertEqual(goal['execution']['steps'][0]['status'], 'done')
        self.assertEqual(self.types(), ['player-task', 'start'])
        rid = goal['execution']['steps'][1]['requestId']
        self.assertEqual(self.game.sent[1]['record']['id'], rid)
        self.ticks(supervisor, 2)
        self.assertEqual(self.types(), ['player-task', 'start'], 'the collection waits for the hunt')
        live['mission'].update(state='complete', caught=1)
        live['bot'].update(awaitingCommand=True)
        goal = self.ticks(supervisor, 3)
        self.assertEqual(self.types(), ['player-task', 'start', 'set-bot'])
        self.assertEqual(self.game.sent[2], {'type': 'set-bot', 'enabled': True, 'runScope': 'collection'})
        self.popen.assert_called_once()
        goal = self.ticks(supervisor, 2)
        self.assertEqual(goal['status'], 'done')
        self.assertEqual([s['status'] for s in goal['execution']['steps']], ['done', 'done', 'done'])

    def test_campaign_hands_off_to_postgame_with_the_priority_target(self):
        live = owner()
        supervisor = self.supervisor(live)
        self.submit(supervisor, self.goal(save={'mode': 'new', 'trainerName': 'NOVA', 'starter': 'squirtle', 'label': None}))
        goal = self.ticks(supervisor, 3)
        run = goal['execution']['steps'][0]['campaignId']
        # The fresh save plays the story. Nothing else is started meanwhile.
        live.update(gameProgress={'game': 'firered', 'leagueComplete': False, 'nationalDex': False, 'canLinkNationally': False,
                                  'statics': statics(False, False, False)})
        live['campaign']['storyProgress']['badges']['earned'] = 5
        goal = self.ticks(supervisor, 5)
        self.assertEqual(self.types(), ['start-campaign'])
        self.assertEqual(goal['progress']['phase'], 'campaign')
        self.assertRegex(goal['progress']['detail'], '5/8')
        # Hall of Fame: the engine continues into postgame (afterCampaign).
        live['campaign'].update(status='complete')
        live['bot'].update(enabled=True, awaitingCommand=False, runScope='postgame')
        live['postgame']['enabled'] = True
        live.update(gameProgress={'game': 'firered', 'leagueComplete': True, 'nationalDex': False, 'canLinkNationally': False,
                                  'statics': statics(True, False, False)})
        goal = self.ticks(supervisor, 3)
        self.assertEqual(goal['execution']['steps'][0]['status'], 'done')
        handoff = [body for body in self.game.sent if body['type'] == 'postgame-goal']
        self.assertEqual(len(handoff), 1)
        rid = goal['execution']['steps'][1]['requestId']
        self.assertEqual(handoff[0]['priorityTarget'], {'speciesId': 150, 'shiny': 'required', 'requestId': rid, 'request': self.farming.get(rid)['request']})
        self.assertEqual(goal['execution']['steps'][1]['mode'], 'priority')
        self.assertEqual(live['campaign']['id'], run)
        goal = self.ticks(supervisor, 3)
        self.assertEqual(len([b for b in self.game.sent if b['type'] == 'postgame-goal']), 1, 'the target is sent once')
        self.assertEqual(goal['status'], 'running')
        # The agenda satisfies the prerequisites, hunts and saves a shiny Mewtwo.
        live['postgame']['priorityHistory'].append({**live['postgame']['priorityTarget'], 'outcome': 'used'})
        live['postgame']['priorityTarget'] = None
        live['collection'].append({'id': 'a' * 64, 'requestId': rid, 'nativeSaveVerified': True, 'owned': True, 'nationalSpeciesId': 150,
                                   'pokemon': {'species': 150, 'shiny': True}})
        goal = self.ticks(supervisor, 3)
        self.assertEqual(goal['status'], 'done')
        self.assertRegex(goal['result']['summary'], 'Mewtwo')
        self.assertEqual(len(self.game.sent), 2, 'the checklist already continues; standing goals need no command')

    def test_hunt_queued_during_an_unfinished_campaign_starts_after_it(self):
        live = owner(league=False, dex=False, link=False,
                     campaign={'id': 'run-00000000-0000-0000-0000-000000000000', 'status': 'running', 'storyProgress': {'badges': {'earned': 7}}})
        live['bot'].update(awaitingCommand=False, runScope='campaign')
        supervisor = self.supervisor(live)
        self.submit(supervisor, self.goal({'kind': 'farming', 'request': request(16, shiny='any')}))
        goal = self.ticks(supervisor, 6)
        self.assertEqual(goal['execution']['save']['decision'], 'current')
        self.assertEqual(self.types(), [], 'the engine refuses tasks during a campaign; the goal holds instead')
        self.assertEqual(goal['status'], 'waiting')
        self.assertEqual(goal['progress']['phase'], 'after-campaign')
        live['campaign']['status'] = 'complete'
        live['bot'].update(awaitingCommand=True, runScope='task')
        goal = self.ticks(supervisor, 2)
        self.assertEqual(self.types(), ['start'])
        self.assertEqual(self.game.sent[0]['record']['request']['speciesId'], 16)
        self.assertEqual(goal['status'], 'running')

    def test_every_task_step_waits_for_an_unfinished_campaign(self):
        # The engine refuses tasks, trades and the checklist during a story campaign,
        # and Start bot would resume the campaign: such steps are held, not retried.
        live = owner(league=False, dex=False, link=False,
                     campaign={'id': 'run-00000000-0000-0000-0000-000000000001', 'status': 'running', 'storyProgress': {'badges': {'earned': 3}}})
        live['bot'].update(awaitingCommand=False, runScope='campaign')
        supervisor = self.supervisor(live)
        self.submit(supervisor, self.goal({'kind': 'player-task', 'action': 'start', 'task': {'kind': 'heal'}},
                                          {'kind': 'trade', 'via': 'trade-shiny', 'payload': {'shinyId': 'd' * 64}}))
        goal = self.ticks(supervisor, 5)
        self.assertEqual(self.types(), [])
        self.assertEqual((goal['status'], goal['progress']['phase']), ('waiting', 'after-campaign'))
        self.assertIsNone(goal['execution']['lastError'], 'nothing was refused')
        live['campaign']['status'] = 'complete'
        live['bot'].update(awaitingCommand=True, runScope='task')
        self.ticks(supervisor, 2)
        self.assertEqual(self.types(), ['player-task'])

    def test_finished_goal_resumes_standing_goals_or_waits_for_commands(self):
        for then, expected in (('standing-goals', ['start', 'postgame-goal']), ('await-command', ['start'])):
            with self.subTest(then=then):
                self.fresh()
                live = owner()
                supervisor = self.supervisor(live)
                self.submit(supervisor, self.goal({'kind': 'farming', 'request': request(144, shiny='any')}, then=then,
                                                  idempotencyKey=f'goal-{then}'))
                self.ticks(supervisor, 3)
                live['mission'].update(state='complete', caught=1)
                live['bot'].update(awaitingCommand=True)
                goal = self.ticks(supervisor, 3)
                self.assertEqual(goal['status'], 'done')
                self.assertEqual(self.types(), expected)
                if then == 'standing-goals':
                    self.assertNotIn('priorityTarget', self.game.sent[-1], 'the plain checklist keeps any saved target')

    def test_the_collection_that_was_running_resumes_after_the_goal(self):
        patcher = mock.patch('pokemon_suite.pokemon_shiny_sweep.ShinySweep.start', return_value={'enabled': True, 'goal': 'national-dex'})
        patcher.start();self.addCleanup(patcher.stop)
        live = owner()
        live['bot'].update(awaitingCommand=False, runScope='collection')
        (self.root/'firered').mkdir(exist_ok=True)
        (self.root/'firered/shiny-sweep.json').write_text(json.dumps({'schema': 'pokemon-suite/shiny-sweep/v1', 'id': 'sweep', 'enabled': True, 'goal': 'national-dex',
                                                                      'active': None, 'deferred': [], 'completed': [], 'candidates': [], 'targets': []}))
        supervisor = self.supervisor(live)
        self.submit(supervisor, self.goal({'kind': 'farming', 'request': request(16, shiny='any')}))
        self.ticks(supervisor, 3)
        self.assertEqual(self.types(), ['start'])
        self.assertFalse(json.loads((self.root/'firered/shiny-sweep.json').read_text())['enabled'], 'the hunt paused the collection')
        live['mission'].update(state='complete', caught=1)
        live['bot'].update(awaitingCommand=True, runScope='task')
        goal = self.ticks(supervisor, 3)
        self.assertEqual(goal['status'], 'done')
        self.assertEqual(self.game.sent[-1], {'type': 'set-bot', 'enabled': True, 'runScope': 'collection'})
        self.assertEqual(goal['execution']['standing']['action'], 'collection')

    def test_status_and_trade_steps_use_live_state_and_the_trade_controls(self):
        live = owner()
        live['observation'] = {'party': [{'species': 150, 'level': 70}, {'species': 6, 'level': 55}]}
        supervisor = self.supervisor(live)
        shiny = 'c' * 64

        def trade_shiny(game, identifier):
            self.game.sent.append({'type': 'trade-shiny', 'shinyId': identifier})
            live['nativeTrade'] = {'fingerprint': 'fp', 'phase': 'advertising'}
            return live
        self.game.trade_shiny = trade_shiny
        self.submit(supervisor, self.goal({'kind': 'status', 'question': 'team'}, {'kind': 'trade', 'via': 'trade-shiny', 'payload': {'shinyId': shiny}},
                                          then='await-command'))
        goal = self.ticks(supervisor, 2)
        self.assertEqual(goal['execution']['steps'][0]['answer'], 'Team: Mewtwo Lv 70, Charizard Lv 55')
        goal = self.ticks(supervisor, 2)
        self.assertEqual(self.game.sent, [{'type': 'trade-shiny', 'shinyId': shiny}])
        self.assertEqual(goal['progress']['phase'], 'trade')
        live['nativeTrade'] = {'fingerprint': 'fp', 'phase': 'complete', 'completion': {'nativeSaveVerified': True}}
        goal = self.ticks(supervisor, 2)
        self.assertEqual(goal['status'], 'done')
        self.assertEqual(len(self.game.sent), 1)

    def test_a_postgame_safety_stop_is_reported_not_overridden(self):
        # Native finding (goal-supervisor-postgame-handoff): on a fresh Hall of
        # Fame save the checklist's own supply trip can stop for review before
        # the priority target runs. The goal must say so and send nothing.
        live = owner(dex=False, link=False)
        live['bot'].update(awaitingCommand=False, runScope='postgame')
        supervisor = self.supervisor(live)
        self.submit(supervisor, self.goal())
        self.ticks(supervisor, 3)
        self.assertEqual(self.types(), ['postgame-goal'])
        reason = 'The retained supply basket exceeds the remaining spending limit or cash reserve.'
        live['bot'].update(status='blocked', reason=reason, objective={'id': 'postgame-supply-budget', 'target': {'kind': 'stop-for-review', 'reason': reason}})
        goal = self.ticks(supervisor, 4)
        self.assertEqual(self.types(), ['postgame-goal'], 'a safety stop is never overridden')
        self.assertEqual((goal['status'], goal['progress']['phase']), ('waiting', 'attention'))
        self.assertIn(reason, goal['progress']['detail'])
        live['bot'].update(status='running', reason=None, objective={'id': 'postgame-hunt-mewtwo'})
        goal = self.ticks(supervisor, 1)
        self.assertEqual((goal['status'], goal['progress']['phase']), ('running', 'postgame-priority'))

    def test_a_stopped_bot_is_never_restarted_by_the_goal(self):
        live = owner()
        supervisor = self.supervisor(live)
        self.submit(supervisor, self.goal({'kind': 'farming', 'request': request(144, shiny='any')}))
        self.ticks(supervisor, 3)
        live['bot'].update(enabled=False, awaitingCommand=False)
        live['mission'].update(state='paused')
        goal = self.ticks(supervisor, 4)
        self.assertEqual(self.types(), ['start'])
        self.assertEqual(goal['progress']['phase'], 'paused')
        self.assertRegex(goal['progress']['detail'], 'Stopped by you')
        live['bot'].update(enabled=True, awaitingCommand=False)
        live['mission'].update(state='running')
        self.assertEqual(self.ticks(supervisor)['progress']['phase'], 'hunting', 'Start bot resumes the goal')
        # The postgame priority path: a stop while the agenda holds the target.
        self.fresh()
        other = owner(dex=False, link=False)
        supervisor = self.supervisor(other)
        self.submit(supervisor, self.goal(idempotencyKey='goal-key-0003'))
        self.ticks(supervisor, 3)
        self.assertEqual(self.types(), ['postgame-goal'])
        other['bot'].update(enabled=False)
        goal = self.ticks(supervisor, 4)
        self.assertEqual(self.types(), ['postgame-goal'])
        self.assertEqual((goal['status'], goal['progress']['phase']), ('waiting', 'paused'))


class SaveIdentityTests(GoalTestCase):
    def test_a_goal_never_continues_on_another_save_or_relaunches_a_closed_game(self):
        live = owner()
        live['gameProgress']['trainerId'] = 111
        supervisor = self.supervisor(live)
        self.submit(supervisor, self.goal({'kind': 'farming', 'request': request(144, shiny='any')}))
        goal = self.ticks(supervisor, 3)
        self.assertEqual(goal['execution']['save']['trainerId'], 111)
        self.assertEqual(self.types(), ['start'])
        # The owner restores a different save and the bot is idle: nothing restarts there.
        live['mission'] = None
        live['bot'].update(awaitingCommand=True)
        live['gameProgress']['trainerId'] = 222
        goal = self.ticks(supervisor, 3)
        self.assertEqual(self.types(), ['start'])
        self.assertEqual((goal['status'], goal['progress']['phase']), ('waiting', 'other-save'))
        # The owner closes the game: the goal waits and never relaunches it.
        self.game.live = None
        launched = getattr(self.game, 'launched', 0)
        goal = self.ticks(supervisor, 3)
        self.assertEqual(goal['progress']['phase'], 'game-offline')
        self.assertEqual(getattr(self.game, 'launched', 0), launched)
        # Back on the goal's save, an idle bot resumes the goal's hunt.
        self.game.live = live
        live['gameProgress']['trainerId'] = 111
        goal = self.ticks(supervisor, 2)
        self.assertEqual(self.types(), ['start', 'start'])
        self.assertEqual(goal['status'], 'running')


def ev_task(fingerprint):
    return {'kind': 'ev-training', 'fingerprint': fingerprint, 'evs': {'hp': 0, 'attack': 252, 'defense': 0, 'speed': 252, 'spAttack': 0, 'spDefense': 4},
            'ivRanges': {}}


class StepReferenceTests(GoalTestCase):
    """"catch a jolly Scyther then EV train it 252 attack 252 speed": step results feed later steps."""

    def hunt_receipt(self, rid, captures, evidence=None):
        """The hunt's own native save receipt, as the owner persists it (metadata.session)."""
        folder = self.root/'firered/hunts'/rid/'native-radio/saves'
        folder.mkdir(parents=True)
        (folder/'current.json').write_text(json.dumps({'schema': 'pokemon-suite/checkpoint/v1', 'metadata': {'session': {
            'id': rid, 'request': {}, 'mission': {'id': rid, 'status': 'complete', **({'captures': captures} if captures is not None else {})},
            'captureEvidence': evidence}}}))

    def test_catch_then_ev_train_uses_the_capture_receipt_fingerprint(self):
        live = owner()
        supervisor = self.supervisor(live)
        scyther = request(123, shiny='any', natures=['jolly'])
        goal = self.submit(supervisor, self.goal({'kind': 'farming', 'request': scyther},
                                                 {'kind': 'player-task', 'action': 'start', 'task': ev_task({'$ref': 'steps[0].result.fingerprint'})}))
        self.assertEqual(goal['steps'][1]['task']['fingerprint'], {'$ref': 'steps[0].result.fingerprint'}, 'the reference is stored as written')
        goal = self.ticks(supervisor, 3)
        self.assertEqual(self.types(), ['start'])
        rid = goal['execution']['steps'][0]['requestId']
        identity = '[123,3141592653,2718281828,31,30,29,28,27,26]'
        pokemon = {'species': 123, 'personality': 3141592653, 'otId': 2718281828, 'shiny': False, 'nature': {'id': 13, 'name': 'Jolly'},
                   'ivs': {'hp': 31, 'attack': 30, 'defense': 29, 'speed': 28, 'spAttack': 27, 'spDefense': 26}}
        self.hunt_receipt(rid, [{'fingerprint': '[10,1,2,0,0,0,0,0,0]', 'pokemon': {'species': 10}, 'savedSramSha256': 'e' * 64, 'target': False},
                                {'fingerprint': identity, 'pokemon': pokemon, 'savedSramSha256': 'f' * 64, 'target': True}])
        live['mission'].update(state='complete', caught=1)
        live['bot'].update(awaitingCommand=True)
        goal = self.ticks(supervisor, 1)
        result = goal['execution']['steps'][0]['result']
        self.assertEqual(result['fingerprint'], identity, 'the target capture, not the incidental one')
        self.assertEqual((result['species'], result['personality'], result['nature'], result['identity'][0]), (123, 3141592653, 'Jolly', 123))
        self.assertEqual(result['source'], 'hunt-save')
        goal = self.ticks(supervisor, 2)
        task = next(body for body in self.game.sent if body['type'] == 'player-task')['request']
        self.assertEqual(task['kind'], 'ev-training')
        self.assertEqual(task['fingerprint'], identity)
        self.assertEqual(goal['execution']['plan'][1]['task']['fingerprint'], identity)
        self.assertEqual(goal['steps'][1]['task']['fingerprint'], {'$ref': 'steps[0].result.fingerprint'})

    def test_invalid_references_are_rejected_at_submit(self):
        supervisor = self.supervisor(owner())
        hunt = {'kind': 'farming', 'request': request(123, shiny='any')}
        bad = [
            ([hunt, {'kind': 'player-task', 'action': 'start', 'task': ev_task({'$ref': 'steps[1].result.fingerprint'})}], 'earlier'),
            ([{'kind': 'player-task', 'action': 'start', 'task': ev_task({'$ref': 'steps[1].result.fingerprint'})}, hunt], 'earlier'),
            ([hunt, {'kind': 'player-task', 'action': 'start', 'task': ev_task({'$ref': 'steps[0].result.color'})}], 'color'),
            ([hunt, {'kind': 'player-task', 'action': 'start', 'task': ev_task({'$ref': 'steps[0].fingerprint'})}], 'reference'),
            ([hunt, {'kind': 'player-task', 'action': 'start', 'task': ev_task({'$ref': 'steps[0].result.fingerprint', 'x': 1})}], 'reference'),
            ([{'kind': 'status', 'question': 'team'}, {'kind': 'player-task', 'action': 'start', 'task': ev_task({'$ref': 'steps[0].result.fingerprint'})}], 'fingerprint'),
            ([hunt, {'kind': 'player-task', 'action': 'start', 'task': ev_task({'$ref': 'steps[0].result.name'})}], 'individual|identity'),
            ([hunt, {'kind': 'player-task', 'action': 'start', 'task': ev_task({'$ref': 'steps[0].result.fingerprint'}), '$ref': 'steps[0].result.name'}], 'reference|unsupported'),
        ]
        for steps, message in bad:
            with self.subTest(steps=steps):
                with self.assertRaisesRegex(ValueError, f'(?i){message}'):
                    supervisor.submit(self.goal(*steps))
        self.assertEqual(supervisor.goals()['goals'], [])
        ok = supervisor.submit(self.goal(hunt, {'kind': 'player-task', 'action': 'start', 'task': ev_task({'$ref': 'steps[0].result.captures.0.fingerprint'})}))
        self.assertEqual(ok['status'], 'queued')

    def test_a_missing_result_waits_instead_of_guessing(self):
        live = owner()
        supervisor = self.supervisor(live)
        self.submit(supervisor, self.goal({'kind': 'farming', 'request': request(123, shiny='any')},
                                          {'kind': 'player-task', 'action': 'start', 'task': ev_task({'$ref': 'steps[0].result.fingerprint'})}))
        goal = self.ticks(supervisor, 3)
        rid = goal['execution']['steps'][0]['requestId']
        # The hunt reports completion, but no capture receipt identifies the individual.
        live['mission'].update(state='complete', caught=1)
        live['bot'].update(awaitingCommand=True)
        goal = self.ticks(supervisor, 4)
        self.assertEqual(goal['execution']['steps'][0]['status'], 'done')
        self.assertNotIn('fingerprint', goal['execution']['steps'][0]['result'])
        self.assertEqual((goal['status'], goal['progress']['phase']), ('waiting', 'needs-result'))
        self.assertRegex(goal['progress']['detail'], 'fingerprint')
        self.assertEqual(self.types(), ['start'], 'nothing is sent with a guessed value')
        # The receipt appears (for example after a reconnect): the goal continues.
        self.hunt_receipt(rid, None, {'nativeSaveVerified': True, 'fingerprint': '[123,5,6,1,2,3,4,5,6]', 'pokemon': {'species': 123, 'personality': 5, 'otId': 6},
                                    'savedSramSha256': 'a' * 64})
        goal = self.ticks(supervisor, 2)
        self.assertEqual(next(b for b in self.game.sent if b['type'] == 'player-task')['request']['fingerprint'], '[123,5,6,1,2,3,4,5,6]')


class CancelTests(GoalTestCase):
    def test_cancel_queued_goal_sends_nothing(self):
        supervisor = self.supervisor(owner())
        goal = self.submit(supervisor, self.goal())
        self.assertEqual(supervisor.cancel(goal['id'])['status'], 'cancelled')
        self.ticks(supervisor, 3)
        self.assertEqual(self.game.sent, [])
        with self.assertRaisesRegex(ValueError, 'finished|cancelled'):
            supervisor.cancel(goal['id'])
        with self.assertRaisesRegex(ValueError, 'not found'):
            supervisor.cancel(str(uuid.uuid4()))

    def test_cancel_running_priority_goal_withdraws_only_its_own_target(self):
        live = owner(dex=False, link=False)
        live['bot'].update(awaitingCommand=False, runScope='postgame')
        live['postgame']['enabled'] = True
        supervisor = self.supervisor(live)
        goal = self.submit(supervisor, self.goal())
        goal = self.ticks(supervisor, 3)
        self.assertEqual(self.types(), ['postgame-goal'])
        supervisor.cancel(goal['id'])
        goal = self.ticks(supervisor, 2)
        self.assertEqual(self.game.sent[-1], {'type': 'postgame-goal', 'priorityTarget': None})
        self.assertEqual(goal['execution']['withdraw']['status'], 'done')
        self.ticks(supervisor, 2)
        self.assertEqual(len(self.game.sent), 2, 'withdrawal happens once')
        # A target that another command replaced is left alone.
        self.fresh()
        other = owner(dex=False, link=False)
        other['bot'].update(awaitingCommand=False, runScope='postgame')
        supervisor = self.supervisor(other)
        goal = self.submit(supervisor, self.goal(idempotencyKey='goal-key-0002'))
        self.ticks(supervisor, 3)
        other['postgame']['priorityTarget'] = {'speciesId': 144, 'requestId': 'someone-else'}
        supervisor.cancel(goal['id'])
        self.ticks(supervisor, 2)
        self.assertEqual(self.types(), ['postgame-goal'])


class FinishListenerTests(GoalTestCase):
    """The request log appends each request goal's final status: listeners hear a goal once, when it leaves the open states."""
    def test_final_status_reaches_listeners_once_and_the_draft_id_is_kept(self):
        live = owner()
        live['observation'] = {'party': [{'species': 150, 'level': 70}]}
        supervisor = self.supervisor(live)
        finished = []
        supervisor.on_finish(lambda goal: 1 / 0)  # a failing listener never breaks the supervisor
        supervisor.on_finish(finished.append)
        draft = 'a' * 32
        goal = self.submit(supervisor, self.goal(source={'text': 'get me a shiny Mewtwo', 'via': 'voice', 'draftId': draft}))
        self.assertEqual(goal['source']['draftId'], draft)
        self.assertEqual(supervisor.store.get(goal['id'])['source']['draftId'], draft, 'kept in goals.json across restarts')
        self.ticks(supervisor, 3)
        self.assertEqual(finished, [], 'running and waiting are not final')
        self.assertEqual(supervisor.cancel(goal['id'])['status'], 'cancelled')
        self.ticks(supervisor, 3)  # the withdrawal updates the cancelled goal again
        self.assertEqual([(g['id'], g['status'], g['source']['draftId']) for g in finished], [(goal['id'], 'cancelled', draft)])
        answered = self.submit(supervisor, self.goal({'kind': 'status', 'question': 'team'}, idempotencyKey='goal-key-0002', then='await-command'))
        self.assertNotIn('draftId', answered['source'], 'a goal posted without a draft keeps the old source shape')
        self.assertEqual(self.ticks(supervisor, 4)['status'], 'done')
        self.assertEqual([(g['id'], g['status']) for g in finished[1:]], [(answered['id'], 'done')])
        self.assertEqual(finished[1]['result']['summary'], 'Team: Mewtwo Lv 70')
        with self.assertRaisesRegex(ValueError, '(?i)draft'):
            supervisor.submit(self.goal(idempotencyKey='goal-key-0003', source={'text': 'x', 'draftId': 'not-a-draft'}))

    def test_a_committed_request_logs_its_goal_final_status(self):
        """End to end: interpret -> commit -> this supervisor -> the goal's final status in requests.ndjson."""
        from pokemon_suite import pokemon_requests as pr
        context = (Path(__file__).resolve().parent/'data'/'request-context.json').read_text()
        (self.root/'request-interpreter.json').write_text(json.dumps({'log': True}))
        supervisor = self.supervisor(owner())
        service = pr.RequestService(SimpleNamespace(directory=self.root, goals=supervisor), interpreter=pr.Interpreter(), context_provider=lambda: json.loads(context))
        draft = service.interpret({'text': 'get me a shiny mewtwo', 'via': 'voice'})
        goal = service.commit({'draftId': draft['draftId'], 'idempotencyKey': 'request-key-0001'})['goal']
        self.assertEqual(goal['source']['draftId'], draft['draftId'])
        supervisor.cancel(goal['id'])
        rows = [json.loads(line) for line in (self.root/'requests'/'requests.ndjson').read_text().splitlines()]
        self.assertEqual([(r.get('event'), r['draftId']) for r in rows], [(None, draft['draftId']), ('committed', draft['draftId']), ('goal', draft['draftId'])])
        self.assertEqual((rows[1]['goalId'], rows[2]['goalId'], rows[2]['status']), (goal['id'], goal['id'], 'cancelled'))


class RestartTests(GoalTestCase):
    def test_supervisor_restart_resumes_without_duplicate_side_effects(self):
        live = owner()
        supervisor = self.supervisor(live)
        self.submit(supervisor, self.goal(save={'mode': 'new', 'trainerName': None, 'starter': None, 'label': None}))
        self.ticks(supervisor, 3)
        self.assertEqual(self.types(), ['start-campaign'])
        restarted = self.supervisor(live)
        self.ticks(restarted, 4)
        self.assertEqual(self.types(), ['start-campaign'], 'no second preview or new save after a restart')
        self.assertEqual(self.resolve.call_count, 1)
        live['campaign']['status'] = 'complete'
        live['bot'].update(awaitingCommand=True, runScope='task')
        goal = self.ticks(restarted, 3)
        self.assertEqual(self.types(), ['start-campaign', 'start'])
        again = self.supervisor(live)
        goal = self.ticks(again, 4)
        self.assertEqual(self.types(), ['start-campaign', 'start'], 'a running hunt is monitored, not restarted')
        live['mission'].update(state='complete', caught=1)
        live['collection'].append({'id': 'b' * 64, 'requestId': goal['execution']['steps'][1]['requestId'], 'nativeSaveVerified': True,
                                   'owned': True, 'nationalSpeciesId': 150, 'pokemon': {'species': 150, 'shiny': True}})
        goal = self.ticks(self.supervisor(live), 3)
        self.assertEqual(goal['status'], 'done')


class StatusTests(GoalTestCase):
    def test_goal_status_is_published_in_the_session_payload_and_goal_list(self):
        live = owner()
        supervisor = self.supervisor(live)
        self.submit(supervisor, self.goal())
        self.ticks(supervisor, 3)
        with mock.patch.object(Game, '_display_snapshot', lambda _self, game: dict(live)):
            session = next(s for s in self.game.snapshots() if s['game'] == 'firered')
        active = session['goals']['active']
        self.assertEqual(active['id'], self.goal_id)
        self.assertEqual(active['text'], 'get me a shiny Mewtwo')
        self.assertEqual(active['kind'], 'farming')
        self.assertEqual((active['step'], active['steps']), (0, 1))
        self.assertTrue(active['phase'] and active['detail'])
        listing = supervisor.goals()
        self.assertEqual(listing['active'], self.goal_id)
        self.assertEqual(listing['goals'][0]['progress']['phase'], active['phase'])


class RouteTests(GoalTestCase):
    def handler(self, supervisor):
        from pokemon_suite.http_routes import SuiteRoutes

        class Handler(SuiteRoutes):
            def __init__(self, server):
                self.server, self.responses = server, []
            def _json(self, status, data, head=False):
                self.responses.append((int(status), data))
            def _error(self, status, message):
                self.responses.append((int(status), {'ok': False, 'error': message}))
            def _authenticated(self):
                return True
            def _control_request(self):
                return True
        return Handler(SimpleNamespace(goals=supervisor, pokemon_sessions=self.game, pokemon_farming=self.farming))

    def test_goal_endpoints_validate_queue_list_and_cancel(self):
        supervisor = self.supervisor(owner())
        http = self.handler(supervisor)
        http.route_post('/api/pokemon-suite/goals', self.goal())
        status, body = http.responses[-1]
        self.assertEqual((status, body['ok'], body['goal']['status']), (200, True, 'queued'))
        http.route_post('/api/pokemon-suite/goals', self.goal(game='crystal'))
        self.assertEqual(http.responses[-1][0], 400)
        http.route_get('/api/pokemon-suite/goals', SimpleNamespace(query=''))
        status, listing = http.responses[-1]
        self.assertEqual((status, [g['id'] for g in listing['goals']]), (200, [body['goal']['id']]))
        http.route_post('/api/pokemon-suite/goals/cancel', {'id': body['goal']['id']})
        self.assertEqual(http.responses[-1][1]['goal']['status'], 'cancelled')
        http.route_post('/api/pokemon-suite/goals/cancel', {'id': body['goal']['id'], 'extra': 1})
        self.assertEqual(http.responses[-1][0], 400)

    def test_companion_relays_goal_endpoints_for_ios(self):
        from pokemon_suite.companion import allowed_route
        self.assertTrue(allowed_route('GET', '/api/pokemon-suite/goals'))
        self.assertTrue(allowed_route('POST', '/api/pokemon-suite/goals'))
        self.assertTrue(allowed_route('POST', '/api/pokemon-suite/goals/cancel'))


class FarmingDatabaseTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        self.runtime = Path(self.temp.name)
        self.suite = self.runtime/'pokemon-suite'
        self.suite.mkdir()

    def rows(self, path):
        db = sqlite3.connect(path)
        try:
            return {row[0]: row[1] for row in db.execute('SELECT id, idempotency FROM requests')}
        finally:
            db.close()

    def seed(self, directory, rows):
        with FarmingRequests(directory).connection() as db:
            for identifier, key in rows:
                db.execute('INSERT INTO requests VALUES (?,?,?,?,?)', (identifier, key, 'digest', json.dumps({'id': identifier, 'request': {'game': 'firered'}}), time.time()))

    def test_legacy_requests_migrate_once_with_backups(self):
        from pokemon_suite.pokemon_farming import migrate_legacy_requests, suite_requests
        legacy = self.runtime/'pokemon-farming'
        self.seed(legacy, [('sweep-a', 'sweep-key-000a'), ('sweep-b', 'sweep-key-000b')])
        self.seed(self.suite/'farming', [('server-1', 'server-key-0001')])
        before = (legacy/'requests.sqlite3').read_bytes()
        result = migrate_legacy_requests(self.suite)
        self.assertEqual(result['migrated'], 2)
        self.assertEqual(self.rows(self.suite/'farming/requests.sqlite3'), {'server-1': 'server-key-0001', 'sweep-a': 'sweep-key-000a', 'sweep-b': 'sweep-key-000b'})
        backups = sorted((self.suite/'farming/backups').iterdir())
        self.assertEqual(len(backups), 2, 'both databases are backed up before the merge')
        self.assertEqual(self.rows(next(p for p in backups if 'legacy' in p.name)), {'sweep-a': 'sweep-key-000a', 'sweep-b': 'sweep-key-000b'})
        self.assertEqual(self.rows(next(p for p in backups if 'legacy' not in p.name)), {'server-1': 'server-key-0001'})
        self.assertEqual((legacy/'requests.sqlite3').read_bytes(), before, 'the legacy database is left untouched')
        # Idempotent: a second run (every open) copies nothing and backs up nothing.
        self.assertEqual(migrate_legacy_requests(self.suite)['migrated'], 0)
        self.assertEqual(len(list((self.suite/'farming/backups').iterdir())), 2)
        self.assertEqual(suite_requests(self.suite).get('sweep-a')['id'], 'sweep-a')
        self.assertEqual(suite_requests(self.suite).path, self.suite/'farming/requests.sqlite3')

    def test_migration_keeps_existing_rows_and_skips_conflicting_identities(self):
        from pokemon_suite.pokemon_farming import migrate_legacy_requests
        legacy = self.runtime/'pokemon-farming'
        self.seed(legacy, [('same-id', 'legacy-key-001'), ('other-id', 'shared-key-001'), ('fresh-id', 'fresh-key-0001')])
        self.seed(self.suite/'farming', [('same-id', 'server-key-001'), ('server-id', 'shared-key-001')])
        result = migrate_legacy_requests(self.suite)
        self.assertEqual(result['migrated'], 1)
        self.assertEqual(sorted(c['id'] for c in result['skipped']), ['other-id', 'same-id'])
        self.assertEqual(self.rows(self.suite/'farming/requests.sqlite3'), {'same-id': 'server-key-001', 'server-id': 'shared-key-001', 'fresh-id': 'fresh-key-0001'})
        # A later legacy write (an old collection process) is merged on the next open.
        self.seed(legacy, [('late-id', 'late-key-0001')])
        self.assertEqual(migrate_legacy_requests(self.suite)['migrated'], 1)
        self.assertIn('late-id', self.rows(self.suite/'farming/requests.sqlite3'))

    def test_collection_requests_keep_their_own_list_and_limit_in_the_shared_database(self):
        # The collection's automatic requests were never in the Pokémon requests
        # list (they lived in the legacy database). Sharing one database must not
        # flood that list (each entry is re-planned) or let 500 collection rows
        # block the owner's own requests.
        from pokemon_suite.pokemon_shiny_sweep import shiny_request
        farming = FarmingRequests(self.suite/'farming')
        mine = farming.save(request(16, shiny='any'), 'owner-request-01')
        sweep = farming.save(shiny_request(19), 'sweep-abc-19')
        self.assertEqual([r['id'] for r in farming.list_requests()], [mine['id']])
        self.assertEqual(farming.get(sweep['id'])['request']['speciesId'], 19)
        with farming.connection() as db:
            for n in range(499):
                db.execute('INSERT INTO requests VALUES (?,?,?,?,?)', (f'fill-{n}', f'sweep-fill-{n}', 'digest', json.dumps({'id': f'fill-{n}'}), 0))
        self.assertEqual(farming.save(request(16, shiny='required'), 'owner-request-02')['request']['shiny'], 'required')
        with self.assertRaisesRegex(ValueError, 'Remove a saved request'):
            farming.save(shiny_request(21), 'sweep-abc-21')

    def test_missing_legacy_database_is_a_no_op(self):
        from pokemon_suite.pokemon_farming import migrate_legacy_requests
        self.assertEqual(migrate_legacy_requests(self.suite)['migrated'], 0)
        self.assertFalse((self.runtime/'pokemon-farming').exists())

    def test_the_collection_process_uses_the_server_request_database(self):
        from pokemon_suite import pokemon_shiny_sweep
        self.assertEqual(pokemon_shiny_sweep.collection_requests(self.suite, None).path, self.suite/'farming/requests.sqlite3')

    def test_player_tasks_use_the_server_request_database(self):
        opened = []

        class Recording(FarmingRequests):
            def __init__(self, directory, executor=None):
                opened.append(Path(directory));super().__init__(directory, executor)
        sessions = SuiteSessions(self.suite)
        (self.suite/'config.json').write_text(json.dumps({'directory': str(self.suite), 'games': {'firered': {'port': 1}}}))
        with mock.patch('pokemon_suite.pokemon_farming.FarmingRequests', Recording), \
             mock.patch('pokemon_suite.capabilities.require_feature', return_value={'readiness': 'ready'}), \
             mock.patch.object(SuiteSessions, 'set_bot', return_value={'bot': {}}):
            sessions.player_task('firered', 'resume')
        self.assertEqual(opened, [self.suite/'farming'])


if __name__ == '__main__':
    unittest.main()
