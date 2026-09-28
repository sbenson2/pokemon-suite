"""L1.1 stop triage: deterministic families, safe one-tap gating, endpoint and sessions payload.

Fixtures are trimmed copies of real live stops (Sept 20-24, see tests/data/stop-triage-labels.jsonl
for the full labeled set and its evidence ids). The triage only reads; it never changes a stop.
"""
import copy
import json
from pathlib import Path
import tempfile
import threading
import time
import unittest

from pokemon_suite import pokemon_stop_triage as st
from pokemon_suite.http_routes import SuiteRoutes

DATA = Path(__file__).resolve().parent / 'data' / 'stop-triage-labels.jsonl'
DEADLINE = 'Recovery could not finish the transition within its 120-second active deadline; the owned task and checkpoint are retained.'
STEP0 = 'The source Pokémon is missing, duplicated, or evolved outside the expected step.'
THREE = 'Three recovery attempts failed. The current game and diagnostic report are preserved.'
SLUGMA = 'postgame-national-collection-3bcc6fca-3f88-42ae-a4d9-924381489bfd'


def live(build=107, **changes):
    """A blocked FireRed postgame owner (the shape of <runtime>/firered/status.json)."""
    value = {
        'schema': 'pokemon-suite/session/v1', 'game': 'firered', 'owner': 'firered', 'sessionId': 'session-1',
        'runId': 'postgame-national-collection-75a910be', 'state': 'blocked', 'frame': 11254198,
        'map': 'MAP_CELADON_CITY_POKEMON_CENTER_1F', 'position': {'x': 11, 'y': 2}, 'mode': 'overworld', 'callback2': 'CB2_Overworld',
        'runtime': {'lock': {'packages': [{'kind': 'engine', 'version': f'0.1.0-build.{build}'}]}},
        'bot': {'enabled': True, 'mode': 'postgame', 'runScope': 'postgame', 'awaitingCommand': False, 'activity': 'ready',
                'status': 'blocked', 'reason': DEADLINE, 'progress': {'status': 'failed', 'task': 'national-collection'},
                'preparation': {'kind': 'postgame', 'phase': 'prerequisites'}},
        'control': {'mode': 'bot', 'paused': True, 'pauseReason': DEADLINE},
        'decision': {'kind': 'blocked', 'reason': DEADLINE},
        'decisionFeed': {'entries': []},
        'mission': {'id': 'postgame-national-collection-75a910be', 'state': 'complete', 'phase': 'complete', 'protected': True,
                    'reason': 'Caught, saved in game, and identity verified.', 'method': 'wild-land'},
        # The last recovery belongs to an earlier, released Slugma hunt.
        'recovery': {'action': 'resume-mission', 'reason': 'repeated-navigation-cycle', 'huntId': SLUGMA, 'status': 'needs-review', 'attempt': 3,
                     'cycle': {'type': 'stationary', 'objective': '["hunt-requested-pokemon",{"kind":"encounter-zone","map":"MAP_MT_EMBER_RUBY_PATH_B3F"}]',
                               'pattern': ['MAP_ONE_ISLAND_HARBOR']}},
        'postgame': {'enabled': True, 'active': 'national-collection', 'hunts': {},
                     'failures': {'national-collection': {'reason': 'repeated-navigation-cycle', 'attempts': 17, 'requiresStateChange': False}}},
        'huntSave': {'frame': 11254198}, 'localEvolution': None, 'nativeTrade': None, 'commandError': None,
    }
    for key, update in changes.items():
        if isinstance(update, dict) and isinstance(value.get(key), dict):
            value[key] = {**value[key], **update}
        else:
            value[key] = update
    return value


def rare_candy(build=107):
    """Sept 24: the Rare Candy "Stop trying to teach FURY SWIPES?" prompt in the party menu."""
    exhausted = {'kind': 'resample', 'reason': 'Current task list is exhausted. Other postgame objectives may remain.'}
    return live(build, mode='party', callback2='CB2_UpdatePartyMenu', decisionFeed={'entries': [
        {'mode': 'party', 'map': 'MAP_CELADON_CITY_POKEMON_CENTER_1F', 'repeats': 205, 'decision': exhausted},
        {'mode': 'party', 'map': 'MAP_CELADON_CITY_POKEMON_CENTER_1F', 'repeats': 1, 'decision': {'kind': 'blocked', 'reason': DEADLINE}},
        {'mode': 'party', 'map': 'MAP_CELADON_CITY_POKEMON_CENTER_1F', 'repeats': 696, 'decision': exhausted},
        {'mode': 'party', 'map': 'MAP_CELADON_CITY_POKEMON_CENTER_1F', 'repeats': 1, 'decision': {'kind': 'blocked', 'reason': DEADLINE}}]})


def slugma(status='recovering', attempt=2, build=104):
    """Sept 22-24: a Mt. Ember Ruby Path Dex hunt loops at One Island Harbor."""
    return live(build, state='recovering' if status == 'recovering' else 'blocked', map='MAP_ONE_ISLAND_HARBOR', frame=10040618,
                runId=SLUGMA, huntSave={'frame': 10040618},
                bot={'status': 'recovering' if status == 'recovering' else 'blocked', 'reason': 'repeated-navigation-cycle', 'activity': 'hunt'},
                decision={'kind': 'blocked', 'reason': 'repeated-navigation-cycle'},
                mission={'id': SLUGMA, 'state': 'running' if status == 'recovering' else 'blocked', 'phase': 'traveling', 'protected': False,
                         'reason': 'repeated-navigation-cycle', 'method': 'wild-land'},
                recovery={'status': status, 'attempt': attempt, 'huntId': SLUGMA})


def step_zero_checkpoint(frame=2216787, index=0, receipts=(), fingerprint=None, dirty=False):
    """The owner's retained checkpoint (hunts/<id>/saves/current.json) at the Sept 23 step-0 stop."""
    evolution = {'schema': 'pokemon-suite/firered-evolution/v1', 'requestId': 'dex-partner-1706568373-2078115889-208',
                 'steps': [{'kind': 'equip-evolution-item', 'game': 'firered', 'item': {'nativeId': 199}},
                           {'kind': 'trade', 'game': 'firered', 'speciesId': 95, 'toGame': 'emerald'}],
                 'index': index, 'phase': 'waiting', 'baseline': None, 'receipts': list(receipts), 'reason': STEP0}
    if fingerprint:
        evolution['currentFingerprint'] = fingerprint
    if dirty:
        evolution['dirty'] = True
    return {'schema': 'pokemon-suite/save/v1', 'metadata': {'frame': frame, 'reason': STEP0, 'session': {
        'id': 'postgame-national-collection-d5c06833',
        'mission': {'id': 'postgame-national-collection-d5c06833', 'status': 'blocked', 'protected': False, 'postgameObjective': 'national-collection'},
        'nativeTrade': None,
        'postgame': {'status': 'waiting', 'reason': STEP0, 'dexEvolution': evolution, 'evolution': None, 'acquisition': None, 'qmm': None,
                     'playerTask': None, 'player': {'encounterSafety': {'capture': None}}}}}}


def step_zero(build=102):
    """Sept 23: held-item partner route (Onix + Metal Coat) stopped at step 0 with nothing changed."""
    return live(build, map='MAP_CELADON_CITY_POKEMON_CENTER_2F', frame=2216787, runId='postgame-national-collection-d5c06833',
                huntSave={'frame': 2216787},
                bot={'reason': STEP0, 'preparation': {'kind': 'postgame', 'phase': 'waiting', 'requestId': 'dex-partner-1706568373-2078115889-208',
                                                      'automatic': True, 'reason': STEP0}},
                decision={'kind': 'blocked', 'reason': STEP0},
                mission={'id': 'postgame-national-collection-d5c06833', 'state': 'blocked', 'phase': 'traveling', 'protected': False,
                         'reason': 'repeated-navigation-cycle'})


def released_hunt(build=102):
    """Sept 23 11:56: a released Slugma hunt kept the checklist from resuming after an exchange pause."""
    return live(build, map='MAP_CELADON_CITY_POKEMON_CENTER_2F', frame=2148149, runId=SLUGMA, huntSave={'frame': 2148149},
                bot={'reason': THREE, 'activity': 'postgame'}, decision={'kind': 'blocked', 'reason': THREE},
                mission={'id': SLUGMA, 'state': 'blocked', 'phase': 'traveling', 'protected': False, 'reason': 'repeated-navigation-cycle'},
                recovery={'status': 'needs-review', 'huntId': SLUGMA})


def classify(value, **kw):
    return st.classify(st.stop_facts(live=value, **kw))


class Families(unittest.TestCase):
    def test_rare_candy_party_menu_prompt_is_the_known_build_108_family(self):
        t = classify(rare_candy())
        self.assertEqual((t['bucket'], t['family']), ('known-bug-family', 'party-menu-move-prompt'))
        self.assertEqual(t['fixedIn'], 108)
        self.assertEqual(t['suggestedAction']['action'], 'none')
        self.assertFalse(t['suggestedAction']['safe'])
        self.assertIn('party menu', t['explanation'])
        self.assertTrue(any('Current task list is exhausted' in e for e in t['evidence']), t['evidence'])
        # The stale Slugma needs-review belongs to another hunt; it does not decide this stop.
        self.assertNotEqual(t['family'], 'mt-ember-ruby-path')

    def test_same_prompt_on_an_engine_with_the_fix_needs_a_code_fix(self):
        t = classify(rare_candy(build=108))
        self.assertEqual((t['bucket'], t['family']), ('needs-code-fix', 'party-menu-move-prompt'))
        self.assertTrue(t['regression'])

    def test_slugma_navigation_loop_recovering_and_exhausted(self):
        for status, attempt in (('recovering', 1), ('recovering', 2), ('needs-review', 3)):
            t = classify(slugma(status, attempt))
            self.assertEqual((t['bucket'], t['family']), ('known-bug-family', 'mt-ember-ruby-path'), (status, attempt))
            self.assertEqual(t['fixedIn'], 105)
            self.assertEqual(t['suggestedAction']['action'], 'none')
            self.assertTrue(any('Mt. Ember' in e or 'MT_EMBER' in e for e in t['evidence']), t['evidence'])

    def test_a_navigation_loop_elsewhere_is_generic(self):
        value = slugma()
        value['recovery']['cycle'] = {'type': 'stationary', 'objective': '["travel",{"map":"MAP_ROUTE21_NORTH"}]', 'pattern': ['MAP_ROUTE21_NORTH']}
        t = classify(value)
        self.assertEqual((t['bucket'], t['family']), ('transient-retry', 'navigation-cycle'))
        value = slugma('needs-review', 3)
        value['recovery']['cycle'] = {'type': 'stationary', 'objective': '["travel",{"map":"MAP_ROUTE21_NORTH"}]', 'pattern': ['MAP_ROUTE21_NORTH']}
        self.assertEqual(classify(value)['bucket'], 'needs-code-fix')

    def test_lorelei_menu_settle(self):
        value = live(96, map='MAP_POKEMON_LEAGUE_LORELEIS_ROOM', mode='battle', callback2='BattleMainCB2',
                     bot={'reason': 'repeated-menu-transaction'}, decision={'kind': 'blocked', 'reason': 'repeated-menu-transaction'},
                     recovery={'reason': 'repeated-menu-transaction', 'status': 'needs-review', 'action': 'resume-postgame', 'huntId': 'x', 'cycle': None})
        t = classify(value)
        self.assertEqual((t['bucket'], t['family'], t['fixedIn']), ('known-bug-family', 'league-menu-settle', 99))

    def test_cycling_road_deadline(self):
        t = classify(live(93, map='MAP_ROUTE17', frame=34666000))
        self.assertEqual((t['bucket'], t['family'], t['fixedIn']), ('known-bug-family', 'cycling-road-pull', 95))

    def test_victory_road_first_floor_route(self):
        reason = 'No executable route to the selected destination.'
        t = classify(live(91, map='MAP_VICTORY_ROAD_1F', bot={'reason': reason}, decision={'kind': 'blocked', 'reason': reason}))
        self.assertEqual((t['bucket'], t['family'], t['fixedIn']), ('known-bug-family', 'victory-road-first-floor', 92))
        t = classify(live(107, map='MAP_CELADON_CITY_GYM', bot={'reason': reason}, decision={'kind': 'blocked', 'reason': reason}))
        self.assertEqual((t['bucket'], t['family']), ('needs-code-fix', 'no-executable-route'))

    def test_step_zero_evolution_stop(self):
        t = classify(step_zero(), checkpoint=step_zero_checkpoint())
        self.assertEqual((t['bucket'], t['family'], t['fixedIn']), ('known-bug-family', 'evolution-step-source-lookup', 103))
        self.assertEqual(t['suggestedAction']['action'], 'postgame-checklist')

    def test_released_hunt(self):
        t = classify(released_hunt(101))
        self.assertEqual((t['bucket'], t['family'], t['fixedIn']), ('known-bug-family', 'released-hunt-holds-checklist', 102))
        self.assertEqual(t['suggestedAction']['action'], 'none')  # resume cannot help before build 102
        t = classify(released_hunt(102))
        self.assertEqual(t['suggestedAction']['action'], 'resume')

    def test_supply_budget_needs_owner(self):
        reason = 'The retained supply basket exceeds the remaining spending limit or cash reserve.'
        t = classify(live(106, bot={'reason': reason}, decision={'kind': 'blocked', 'reason': reason}))
        self.assertEqual((t['bucket'], t['family']), ('needs-owner', 'supply-budget'))

    def test_a_pc_release_safety_stop_is_explained_and_never_actionable(self):
        # Sept 27: the Egg sticker releases its own hatchlings; any unexpected PC change stops for review.
        reason = 'PC release: the PC changed beyond the released hatchling. Keep this save for review.'
        t = classify(live(121, mode='storage', bot={'reason': reason}, decision={'kind': 'blocked', 'reason': reason}))
        self.assertEqual((t['bucket'], t['family']), ('needs-code-fix', 'pc-release'))
        self.assertEqual(t['title'], 'PC release stopped for review')
        self.assertIn('Egg-sticker hatchling', t['explanation'])
        self.assertFalse(t['suggestedAction']['safe'])

    def test_a_full_pc_without_releasable_hatchlings_needs_the_owner(self):
        reason = 'Free PC space while preserving the shiny reserve: no Egg-sticker hatchling can be released safely; owned evolutions remain eligible.'
        t = classify(live(121, bot={'reason': reason}, decision={'kind': 'blocked', 'reason': reason}))
        self.assertEqual((t['bucket'], t['family']), ('needs-owner', 'pc-space'))
        self.assertEqual(t['title'], 'The PC is full')
        self.assertIn('30', t['explanation'])

    def test_trade_outcome_unresolved_is_never_actionable(self):
        reason = 'The received Pokémon is saved locally, but the final link handshake or normal exit is not verified. Preserving the save.'
        t = classify(live(107, map='MAP_TRADE_CENTER', bot={'reason': reason}, decision={'kind': 'blocked', 'reason': reason},
                          nativeTrade={'phase': 'unresolved', 'exchangeStarted': True, 'reason': reason}))
        self.assertEqual((t['bucket'], t['family']), ('needs-owner', 'trade-outcome-unresolved'))
        self.assertFalse(t['suggestedAction']['safe'])

    def test_wireless_overflow(self):
        reason = 'Native wireless queue overflowed; stop the link.'
        before = classify(live(106, bot={'reason': reason}, decision={'kind': 'blocked', 'reason': reason},
                               localEvolution={'phase': 'trading', 'reason': reason}))
        self.assertEqual((before['bucket'], before['family']), ('transient-retry', 'wireless-overflow'))
        after = classify(live(106, bot={'reason': reason}, decision={'kind': 'blocked', 'reason': reason},
                              nativeTrade={'phase': 'trading', 'exchangeStarted': True, 'reason': reason}))
        self.assertEqual(after['bucket'], 'needs-owner')

    def test_league_intermission_save_counter(self):
        reason = 'league-save-counter-changed-unexpectedly'
        t = classify(live(104, map='MAP_POKEMON_LEAGUE_LANCES_ROOM', bot={'reason': reason}, decision={'kind': 'blocked', 'reason': reason}))
        self.assertEqual((t['bucket'], t['family'], t['fixedIn']), ('known-bug-family', 'league-intermission-save', 106))
        # The same stop on the engine that carries the fix is a new case of the family.
        t = classify(live(106, map='MAP_POKEMON_LEAGUE_LANCES_ROOM', bot={'reason': reason}, decision={'kind': 'blocked', 'reason': reason}))
        self.assertEqual((t['bucket'], t['regression']), ('needs-code-fix', True))

    def test_protected_encounter_needs_owner(self):
        reason = 'protected-encounter-lost-or-unverified'
        t = classify(live(80, map='MAP_ROUTE1', bot={'reason': reason}, decision={'kind': 'blocked', 'reason': reason},
                          mission={'state': 'blocked', 'protected': True, 'phase': 'capturing', 'reason': reason}))
        self.assertEqual((t['bucket'], t['family']), ('needs-owner', 'protected-encounter'))
        self.assertEqual(t['suggestedAction']['action'], 'none')

    def test_running_owner_has_no_triage(self):
        self.assertIsNone(classify(live(107, state='running', bot={'status': 'running', 'reason': None}, decision={'kind': 'resample', 'reason': 'x'})))
        self.assertIsNone(classify(live(107, state='ready', bot={'status': 'ready', 'awaitingCommand': True, 'reason': 'Ready for commands.'})))

    def test_unknown_blocked_stop_is_unclassified(self):
        t = classify(live(107, bot={'reason': 'something-new-happened'}, decision={'kind': 'blocked', 'reason': 'something-new-happened'}))
        self.assertEqual((t['bucket'], t['family']), ('needs-code-fix', 'unclassified'))
        self.assertEqual(t['suggestedAction']['action'], 'none')

    def test_output_contract(self):
        t = classify(rare_candy())
        self.assertEqual(t['schema'], st.SCHEMA)
        self.assertIn(t['bucket'], st.BUCKETS)
        self.assertIn(t['suggestedAction']['action'], st.ACTIONS)
        self.assertTrue(set(t['suggestedAction']) >= {'action', 'safe', 'why'})
        self.assertIsInstance(t['explanation'], str)
        json.dumps(t)


class SafeActions(unittest.TestCase):
    """One tap is offered only when code proves the category safe; never auto-executed."""

    def offered(self, value, checkpoint=None):
        t = classify(value, checkpoint=checkpoint)
        return t['suggestedAction']

    def test_step_zero_with_nothing_changed_offers_the_checklist(self):
        a = self.offered(step_zero(), step_zero_checkpoint())
        self.assertTrue(a['safe'])
        self.assertEqual(a['playerTask'], 'postgame')
        self.assertTrue(a['token'])
        self.assertIn('checklist', a['confirm'].lower())

    def test_step_zero_without_a_current_checkpoint_is_not_safe(self):
        self.assertFalse(self.offered(step_zero(), None)['safe'])
        self.assertFalse(self.offered(step_zero(), step_zero_checkpoint(frame=2216000))['safe'])  # older checkpoint

    def test_step_zero_with_anything_changed_is_not_safe(self):
        for checkpoint in (step_zero_checkpoint(index=1), step_zero_checkpoint(receipts=[{'index': 0}]),
                           step_zero_checkpoint(fingerprint='[95,1,2]'), step_zero_checkpoint(dirty=True)):
            self.assertFalse(self.offered(step_zero(), checkpoint)['safe'])

    def test_step_zero_during_a_linked_or_protected_task_is_not_safe(self):
        for change in ({'localEvolution': {'phase': 'trading'}}, {'nativeTrade': {'phase': 'trading', 'exchangeStarted': True}},
                       {'control': {'mode': 'manual'}}, {'commandError': 'The game owner changed.'}, {'state': 'recovering', 'bot': {'status': 'recovering'}}):
            value = step_zero()
            for key, update in change.items():
                value[key] = {**value[key], **update} if isinstance(update, dict) and isinstance(value.get(key), dict) else update
            self.assertFalse(self.offered(value, step_zero_checkpoint())['safe'], change)
        checkpoint = step_zero_checkpoint()
        checkpoint['metadata']['session']['postgame']['player']['encounterSafety']['capture'] = {'nativeSaveVerified': False}
        self.assertFalse(self.offered(step_zero(), checkpoint)['safe'])
        checkpoint = step_zero_checkpoint()
        checkpoint['metadata']['session']['postgame']['qmm'] = {'dirty': True}
        self.assertFalse(self.offered(step_zero(), checkpoint)['safe'])

    def test_only_the_checklists_own_step_is_restarted(self):
        # A player-requested evolution (task scope) that stopped at step 0 is not replaced by the checklist.
        value = step_zero()
        value['bot'] = {**value['bot'], 'runScope': 'task', 'preparation': {**value['bot']['preparation'], 'kind': 'evolution'}}
        self.assertFalse(self.offered(value, step_zero_checkpoint())['safe'])
        value = released_hunt(102)
        value['bot'] = {**value['bot'], 'runScope': 'task'}
        self.assertFalse(self.offered(value)['safe'])

    def test_released_hunt_resume_only_when_released(self):
        self.assertTrue(self.offered(released_hunt(102))['safe'])
        self.assertEqual(self.offered(released_hunt(102))['playerTask'], 'resume')
        for change in ({'mission': {**released_hunt()['mission'], 'protected': True}},
                       {'recovery': {**released_hunt()['recovery'], 'status': 'recovering'}},
                       {'postgame': {**released_hunt()['postgame'], 'hunts': {'national-collection': {'id': SLUGMA}}}},
                       {'postgame': {**released_hunt()['postgame'], 'enabled': False}},
                       {'localEvolution': {'phase': 'waiting-for-partner'}}):
            value = released_hunt(102)
            value.update(change)
            self.assertFalse(self.offered(value)['safe'], change)

    def test_no_other_family_is_ever_safe(self):
        for value in (rare_candy(), slugma(), slugma('needs-review', 3), live(93, map='MAP_ROUTE17'), released_hunt(101)):
            self.assertFalse(self.offered(value)['safe'])

    def test_token_changes_with_the_stop(self):
        a = self.offered(step_zero(), step_zero_checkpoint())['token']
        other = step_zero()
        other['sessionId'] = 'session-2'
        b = self.offered(other, step_zero_checkpoint())['token']
        self.assertNotEqual(a, b)


class RuntimeBase(unittest.TestCase):
    """A temporary data directory with retained files and a fake sessions owner."""

    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.root = Path(self.tmp.name)
        (self.root / 'firered').mkdir()

    def tearDown(self):
        self.tmp.cleanup()

    def write(self, name, value):
        path = self.root / 'firered' / name
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_text(json.dumps(value))
        return path

    def sessions(self, value):
        root = self.root

        class Sessions:
            directory = root

            def __init__(self):
                self.commands = []

            def config(self):
                return {'games': {'firered': {'port': 1}}}

            def _live(self, game):
                return copy.deepcopy(value) if game == 'firered' else None

            def player_task(self, game, action, task=None):
                self.commands.append((game, action, task))
                return {'state': 'running'}
        return Sessions()



class Runtime(RuntimeBase):
    """Reads the retained files of a data directory; never writes them."""

    def test_step_zero_from_the_retained_checkpoint(self):
        self.write('active-hunt.json', {'id': 'postgame-national-collection-d5c06833'})
        self.write('hunts/postgame-national-collection-d5c06833/saves/current.json', step_zero_checkpoint())
        before = {p: p.read_bytes() for p in self.root.rglob('*') if p.is_file()}
        t = st.StopTriage(self.sessions(step_zero())).triage('firered')
        self.assertTrue(t['suggestedAction']['safe'])
        self.assertEqual({p: p.read_bytes() for p in self.root.rglob('*') if p.is_file()}, before)

    def test_native_radio_checkpoint_path(self):
        self.write('active-hunt.json', {'id': 'postgame-national-collection-d5c06833', 'nativeRadio': True})
        self.write('hunts/postgame-national-collection-d5c06833/native-radio/saves/current.json', step_zero_checkpoint())
        self.assertTrue(st.StopTriage(self.sessions(step_zero())).triage('firered')['suggestedAction']['safe'])

    def test_checkpoint_of_another_hunt_is_ignored(self):
        self.write('active-hunt.json', {'id': 'postgame-other'})
        self.write('hunts/postgame-other/saves/current.json', step_zero_checkpoint())
        self.assertFalse(st.StopTriage(self.sessions(step_zero())).triage('firered')['suggestedAction']['safe'])

    def test_recovery_report_is_used_only_when_current(self):
        report = {'schema': 'pokemon-suite/recovery-report/v1', 'sessionId': 'session-1', 'frame': 11254198, 'reason': DEADLINE,
                  'postgame': {'status': 'waiting', 'reason': DEADLINE, 'watchdog': {'reason': 'Progress timeout: finish the owned transaction.'}}}
        self.write('recovery-report.json', report)
        facts = st.StopTriage(self.sessions(rare_candy())).facts('firered')
        self.assertEqual(facts['evidence']['report'], 'current')
        self.write('recovery-report.json', {**report, 'frame': 1})
        self.assertEqual(st.StopTriage(self.sessions(rare_candy())).facts('firered')['evidence']['report'], 'stale')

    def test_confirm_rechecks_the_current_stop(self):
        self.write('active-hunt.json', {'id': 'postgame-national-collection-d5c06833'})
        self.write('hunts/postgame-national-collection-d5c06833/saves/current.json', step_zero_checkpoint())
        sessions = self.sessions(step_zero())
        triage = st.StopTriage(sessions)
        token = triage.triage('firered')['suggestedAction']['token']
        triage.confirm('firered', 'postgame', token)
        with self.assertRaises(ValueError):
            triage.confirm('firered', 'resume', token)
        with self.assertRaises(ValueError):
            triage.confirm('firered', 'postgame', 'stale-token')
        # The checkpoint moved on (an individual changed): the old token is refused.
        self.write('hunts/postgame-national-collection-d5c06833/saves/current.json', step_zero_checkpoint(fingerprint='[95,1]'))
        with self.assertRaises(ValueError):
            triage.confirm('firered', 'postgame', token)

    def test_sessions_payload_attaches_a_compact_triage_only_for_stops(self):
        compact = st.attach(self.root, 'firered', rare_candy())
        self.assertEqual(compact['family'], 'party-menu-move-prompt')
        self.assertLessEqual(set(compact), {'schema', 'bucket', 'family', 'title', 'explanation', 'evidence', 'suggestedAction', 'fixedIn', 'regression'})
        self.assertLessEqual(len(compact['evidence']), 4)
        self.assertIsNone(st.attach(self.root, 'firered', live(state='running', bot={'status': 'running', 'reason': None},
                                                               decision={'kind': 'resample', 'reason': 'x'})))
        self.assertIsNone(st.attach(self.root, 'firered', {'game': 'firered', 'state': 'reconnecting'}))
        # A malformed snapshot never breaks the sessions payload.
        self.assertIsNone(st.attach(self.root, 'firered', {'state': 'blocked', 'bot': 'nonsense'}))

    def test_routine_recovery_with_no_recognised_cause_shows_no_stop_card(self):
        # Sept 27 companion screenshots: mid-battle, the Session card said "Why it stopped · Temporary: Stop not
        # recognised". The owner was only in its routine automatic recovery; nothing had stopped.
        routine = live(state='recovering', mode='battle', callback2='CB2_BattleMain',
                       bot={'enabled': True, 'mode': 'postgame', 'runScope': 'postgame', 'awaitingCommand': False, 'activity': 'postgame',
                            'status': 'recovering', 'reason': None, 'progress': {'status': 'running', 'task': 'national-collection'},
                            'preparation': {'kind': 'postgame', 'phase': 'ready'}},
                       control={'mode': 'bot', 'paused': False}, decision={'kind': 'resample', 'reason': 'Battle in progress'})
        self.assertIsNone(st.attach(self.root, 'firered', routine))
        # A recognised cause during recovery still explains itself, and a real unrecognised stop still shows.
        self.assertIsNotNone(st.attach(self.root, 'firered', slugma()))
        unknown = live(bot={**live()['bot'], 'reason': 'Something no rule knows about.'},
                       decision={'kind': 'blocked', 'reason': 'Something no rule knows about.'}, control={'mode': 'bot', 'paused': True})
        card = st.attach(self.root, 'firered', unknown)
        self.assertEqual((card['family'], card['bucket']), ('unclassified', 'needs-code-fix'))

    def test_laya_shadow_is_logged_and_never_overrides(self):
        class Classifier:
            mode = 'shadow'
            asset_id = 'laya-test'
            calls = []

            def predict(self, state, questions):
                self.calls.append((state, questions))
                assert set(questions) == {'bucket', 'action'}
                assert set(questions['bucket']['criteria']) == set(st.BUCKETS)
                return {'bucket': {'choice': 'needs-owner', 'probabilities': {'needs-owner': .9}, 'confidence': .9},
                        'action': {'choice': 'resume', 'probabilities': {'resume': .8}, 'confidence': .8}}
        log = self.root / 'requests' / 'stop-triage.ndjson'
        classifier = Classifier()
        triage = st.StopTriage(self.sessions(rare_candy()), classifier=lambda: classifier, log_path=log)
        # The endpoint consults in the background (it never waits for Laya); the answer shows from the next call.
        triage.triage('firered', consult=True)
        settle()
        t = triage.triage('firered', consult=True)
        self.assertEqual((t['bucket'], t['suggestedAction']['action']), ('known-bug-family', 'none'))
        self.assertEqual(t['laya']['bucket'], 'needs-owner')
        self.assertFalse(t['laya']['agrees'])
        self.assertEqual(json.loads(log.read_text().splitlines()[-1])['rules']['bucket'], 'known-bug-family')
        triage.triage('firered', consult=True)
        self.assertEqual(len(classifier.calls), 1)  # one consult per distinct stop
        # Laya off or failing: exactly the deterministic answer, no 'laya' key.
        self.assertNotIn('laya', st.StopTriage(self.sessions(rare_candy())).triage('firered', consult=True))

        class Broken(Classifier):
            def predict(self, state, questions):
                raise RuntimeError('sidecar crashed')
        broken = st.StopTriage(self.sessions(rare_candy()), classifier=lambda: Broken())
        self.assertNotIn('laya', broken.triage('firered', consult=True))
        settle()
        t = broken.triage('firered', consult=True)
        self.assertEqual(t['bucket'], 'known-bug-family')
        self.assertIn('skipped', t['laya'])


class ShadowAsync(RuntimeBase):
    def test_background_consult_once_per_live_stop(self):
        import threading
        done = threading.Event()

        class Classifier:
            mode = 'shadow'
            asset_id = 'laya-test'
            calls = 0

            def predict(self, state, questions):
                Classifier.calls += 1
                done.set()
                return {'bucket': {'choice': 'known-bug-family', 'confidence': .5}, 'action': {'choice': 'none', 'confidence': .5}}
        log = self.root / 'requests' / 'stop-triage.ndjson'
        triage = st.StopTriage(self.sessions(rare_candy()), classifier=lambda: Classifier(), log_path=log)
        thread = triage.shadow_async('firered', rare_candy())
        self.assertIsNotNone(thread)
        thread.join(5)
        self.assertTrue(done.is_set())
        self.assertIsNone(triage.shadow_async('firered', rare_candy()))  # the same stop is consulted once
        self.assertIsNone(triage.shadow_async('firered', live(state='running', bot={'status': 'running', 'reason': None})))
        self.assertEqual(Classifier.calls, 1)
        line = json.loads(log.read_text().splitlines()[-1])
        self.assertEqual((line['rules']['family'], line['laya']['agrees']), ('party-menu-move-prompt', True))

    def test_laya_off_schedules_nothing_and_sessions_payload_is_unchanged(self):
        triage = st.StopTriage(self.sessions(rare_candy()), classifier=lambda: None)
        self.assertIsNone(triage.shadow_async('firered', rare_candy()))

        class Server:
            pass
        server = Server()
        server.stop_triage = triage
        sessions = [{**rare_candy(), 'triage': st.attach(self.root, 'firered', rare_candy())}]
        before = copy.deepcopy(sessions)
        st.shadow_sessions(server, sessions)
        self.assertEqual(sessions, before)
        st.shadow_sessions(server, None)
        st.shadow_sessions(object(), sessions)  # a server without sessions never raises


def settle():
    """Wait for every background stop-triage consult to finish."""
    for thread in threading.enumerate():
        if thread.name == 'stop-triage-shadow':
            thread.join(5)


class Recorder:
    """A shadow Laya that counts its consults; `gate` holds each answer until set, `fail` raises instead."""
    mode = 'shadow'
    asset_id = 'laya-test'

    def __init__(self, gate=None, fail=0):
        self.calls, self.gate, self.fail = [], gate, fail

    def predict(self, state, questions):
        self.calls.append(json.loads(state))
        if self.gate is not None:
            self.gate.wait(2)
        if self.fail:
            self.fail -= 1
            raise RuntimeError('Laya is loading; this request uses the deterministic parser.')
        return {'bucket': {'choice': 'needs-owner', 'confidence': .9}, 'action': {'choice': 'none', 'confidence': .8}}


class OneConsultPerStop(RuntimeBase):
    """Sept 25 live log: 275 consults on 275 frames of one recovering stop. The frame moves while the owner
    stays stopped, so a stop is its game, session and reason; the endpoint never waits for Laya."""

    def test_a_stop_is_consulted_once_while_its_frame_moves(self):
        laya = Recorder()
        lookups = []
        log = self.root / 'requests' / 'stop-triage.ndjson'
        triage = st.StopTriage(self.sessions(rare_candy()), classifier=lambda: lookups.append(1) or laya, log_path=log)

        class Server:
            pass
        server = Server()
        server.stop_triage = triage
        for frame in range(11254198, 11254198 + 300, 10):  # sessions polling (shadow_async) and the endpoint, frame after frame
            moved = rare_candy()
            moved.update(frame=frame, huntSave={'frame': frame})
            st.shadow_sessions(server, [{**moved, 'triage': st.attach(self.root, 'firered', moved)}])
            triage.triage('firered', live=moved, consult=True)
            settle()
        self.assertEqual(len(laya.calls), 1)
        self.assertEqual(len(lookups), 1)  # an answered stop does not even look up the classifier again
        self.assertEqual(len(log.read_text().splitlines()), 1)
        # Another session or another reason is another stop.
        triage.shadow_async('firered', live(sessionId='session-2', mode='party'))
        settle()
        triage.shadow_async('firered', live(bot={'reason': THREE}, decision={'kind': 'blocked', 'reason': THREE}))
        settle()
        self.assertEqual(len(laya.calls), 3)
        # 'Automatic resume-mission: X' while recovering is the same stop as X.
        triage.shadow_async('firered', live(bot={'reason': 'Automatic resume-mission: ' + THREE}, frame=1))
        settle()
        self.assertEqual(len(laya.calls), 3)

    def test_the_endpoint_never_waits_for_laya(self):
        gate = threading.Event()
        laya = Recorder(gate=gate)
        triage = st.StopTriage(self.sessions(rare_candy()), classifier=lambda: laya)
        started = time.monotonic()
        t = triage.triage('firered', consult=True)
        self.assertLess(time.monotonic() - started, 1.0)
        self.assertNotIn('laya', t)  # not answered yet: the rules' answer alone
        self.assertEqual(t, st.StopTriage(self.sessions(rare_candy())).triage('firered'))
        self.assertNotIn('laya', triage.triage('firered', consult=True))  # still running: not asked twice
        gate.set()
        settle()
        t = triage.triage('firered', consult=True)
        self.assertEqual((t['bucket'], t['laya']['bucket'], t['laya']['agrees']), ('known-bug-family', 'needs-owner', False))
        self.assertEqual(len(laya.calls), 1)

    def test_the_route_answers_before_laya_does(self):
        gate = threading.Event()
        laya = Recorder(gate=gate)

        class Server:
            pass
        server = Server()
        server.pokemon_sessions = self.sessions(rare_candy())
        server.directory = self.root
        server.stop_triage = st.StopTriage(server.pokemon_sessions, classifier=lambda: laya)
        handler = Handler(server)
        from urllib.parse import urlparse
        started = time.monotonic()
        handler.route_get('/api/pokemon-suite/stop-triage', urlparse('/api/pokemon-suite/stop-triage?game=firered'))
        self.assertLess(time.monotonic() - started, 1.0)
        self.assertEqual(handler.responses[-1][0], 200)
        self.assertEqual(handler.responses[-1][1]['triage']['family'], 'party-menu-move-prompt')
        gate.set()
        settle()
        self.assertEqual(len(laya.calls), 1)

    def test_a_skipped_consult_is_retried_after_a_cool_down(self):
        laya = Recorder(fail=1)
        log = self.root / 'requests' / 'stop-triage.ndjson'
        triage = st.StopTriage(self.sessions(rare_candy()), classifier=lambda: laya, log_path=log)
        triage.shadow_async('firered', rare_candy())
        settle()
        self.assertIn('skipped', json.loads(log.read_text().splitlines()[-1])['laya'])
        self.assertIn('skipped', triage.triage('firered', consult=True)['laya'])  # the last attempt is shown
        moved = rare_candy()
        moved.update(frame=11254999)
        self.assertIsNone(triage.shadow_async('firered', moved))  # loading: not retried on every poll
        self.assertEqual(len(laya.calls), 1)
        triage.RETRY_SKIPPED = 0
        triage.shadow_async('firered', moved).join(5)
        self.assertEqual(len(laya.calls), 2)
        self.assertEqual(triage.triage('firered', consult=True)['laya']['bucket'], 'needs-owner')
        self.assertIsNone(triage.shadow_async('firered', rare_candy()))  # answered: never again
        self.assertEqual(len(laya.calls), 2)
        self.assertEqual(len(log.read_text().splitlines()), 2)

    def test_laya_off_is_looked_up_once_per_cool_down(self):
        lookups = []
        triage = st.StopTriage(self.sessions(rare_candy()), classifier=lambda: lookups.append(1))
        for frame in range(5):
            moved = rare_candy()
            moved.update(frame=frame)
            self.assertIsNone(triage.shadow_async('firered', moved))
            self.assertNotIn('laya', triage.triage('firered', live=moved, consult=True))
        self.assertEqual(len(lookups), 1)
        triage.RETRY_SKIPPED = 0
        self.assertIsNone(triage.shadow_async('firered', rare_candy()))
        self.assertEqual(len(lookups), 2)


class Handler(SuiteRoutes):
    def __init__(self, server):
        self.server = server
        self.responses = []

    def _control_request(self):
        return True

    def _authenticated(self):
        return True

    def _json(self, status, data, head=False):
        self.responses.append((int(status), data))

    def _error(self, status, message):
        self._json(status, {'ok': False, 'error': message})


class Endpoint(RuntimeBase):
    def server(self, value):
        class Server:
            pass
        server = Server()
        server.pokemon_sessions = self.sessions(value)
        server.directory = self.root
        return server

    def test_get_stop_triage(self):
        server = self.server(rare_candy())
        handler = Handler(server)
        from urllib.parse import urlparse
        handler.route_get('/api/pokemon-suite/stop-triage', urlparse('/api/pokemon-suite/stop-triage?game=firered'))
        status, body = handler.responses[-1]
        self.assertEqual(status, 200)
        self.assertEqual(body['triage']['family'], 'party-menu-move-prompt')
        handler.route_get('/api/pokemon-suite/stop-triage', urlparse('/api/pokemon-suite/stop-triage?game=firered&game=emerald'))
        self.assertEqual(handler.responses[-1][0], 400)

    def test_player_task_with_a_triage_token_is_rechecked(self):
        self.write('active-hunt.json', {'id': 'postgame-national-collection-d5c06833'})
        self.write('hunts/postgame-national-collection-d5c06833/saves/current.json', step_zero_checkpoint())
        server = self.server(step_zero())
        handler = Handler(server)
        from urllib.parse import urlparse
        handler.route_get('/api/pokemon-suite/stop-triage', urlparse('/api/pokemon-suite/stop-triage?game=firered'))
        token = handler.responses[-1][1]['triage']['suggestedAction']['token']
        handler.route_post('/api/pokemon-suite/player-tasks', {'game': 'firered', 'action': 'postgame', 'triage': 'stale'})
        self.assertEqual(handler.responses[-1][0], 409)
        self.assertEqual(server.pokemon_sessions.commands, [])
        handler.route_post('/api/pokemon-suite/player-tasks', {'game': 'firered', 'action': 'postgame', 'triage': token})
        self.assertEqual(handler.responses[-1][0], 200)
        self.assertEqual(server.pokemon_sessions.commands, [('firered', 'postgame', None)])
        # Without a token the endpoint behaves exactly as before.
        handler.route_post('/api/pokemon-suite/player-tasks', {'game': 'firered', 'action': 'resume'})
        self.assertEqual(server.pokemon_sessions.commands[-1], ('firered', 'resume', None))


class LabeledSet(unittest.TestCase):
    """Accuracy floors on the hand-labeled live stops (see the JSONL rows' evidence ids)."""

    @classmethod
    def setUpClass(cls):
        cls.rows = [json.loads(line) for line in DATA.read_text().splitlines() if line.strip()]

    def score(self, split):
        rows = [r for r in self.rows if r['split'] == split]
        hits = {'bucket': 0, 'cause': 0, 'action': 0, 'family': 0}
        families = 0
        for row in rows:
            t = st.classify(row['facts'])
            label = row['label']
            self.assertIsNotNone(t, row['id'])
            hits['bucket'] += t['bucket'] == label['bucket']
            hits['cause'] += st.CAUSE[t['bucket']] == st.CAUSE[label['bucket']]
            hits['action'] += t['suggestedAction']['action'] == label['action']
            if label.get('family') in st.FAMILIES:
                families += 1
                hits['family'] += t['family'] == label['family']
        return rows, hits, families

    def test_rows_are_well_formed(self):
        self.assertGreaterEqual(len(self.rows), 100)
        ids = [r['id'] for r in self.rows]
        self.assertEqual(len(ids), len(set(ids)))
        for row in self.rows:
            self.assertIn(row['split'], ('dev', 'holdout'))
            self.assertIn(row['label']['bucket'], st.BUCKETS)
            self.assertIn(row['label']['action'], st.ACTIONS)
            self.assertTrue(row['evidence'], row['id'])
            self.assertEqual(row['facts']['schema'], st.FACTS_SCHEMA)
        # No incident appears in both splits.
        dev = {r['incident'] for r in self.rows if r['split'] == 'dev'}
        self.assertFalse(dev & {r['incident'] for r in self.rows if r['split'] == 'holdout'})

    def test_dev_floor(self):
        rows, hits, families = self.score('dev')
        self.assertGreaterEqual(hits['bucket'] / len(rows), 0.95)
        self.assertGreaterEqual(hits['action'] / len(rows), 0.95)
        self.assertEqual(hits['family'], families)

    def test_holdout_floor(self):
        rows, hits, families = self.score('holdout')
        # Older stops (Sept 7-19): most families are not registered, so the three-way cause
        # (transient / code bug / owner) is the generalization measure.
        self.assertGreaterEqual(hits['cause'] / len(rows), 0.70)

    def test_no_unsafe_one_tap_on_any_labeled_stop(self):
        for row in self.rows:
            action = st.classify(row['facts'])['suggestedAction']
            if action['safe']:
                self.assertTrue(row['label'].get('safe'), row['id'])


if __name__ == '__main__':
    unittest.main()
