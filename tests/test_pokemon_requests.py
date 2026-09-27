"""G3: natural-language requests -> Goal v1 drafts (interpreter, policy, commit, Laya adapter)."""
import copy
import hashlib
import json
import tempfile
import unittest
from pathlib import Path

from pokemon_suite import pokemon_requests as pr
from pokemon_suite import pokemon_stop_triage as st

from test_stop_triage import rare_candy, released_hunt

DATA = Path(__file__).resolve().parent / 'data'
CONTEXT = json.loads((DATA / 'request-context.json').read_text())


def context():
    return copy.deepcopy(CONTEXT)


def interpreter(**extra):
    return pr.Interpreter(**extra)


def ask(text, answers=None, **extra):
    return interpreter(**extra).interpret(text, via='typed', context=context(), answers=answers)


def kinds(result):
    return [s['kind'] for s in result['goal']['steps']]


class GoalRequestExamples(unittest.TestCase):
    def test_shiny_mewtwo_is_a_priority_static_target_on_the_current_save_if_able(self):
        r = ask('get me a shiny mewtwo')
        self.assertTrue(r['understood'], r)
        self.assertEqual(r['parser'], 'deterministic')
        goal = r['goal']
        self.assertEqual(goal['schema'], 'pokemon-suite/goal/v1')
        self.assertEqual(goal['status'], 'draft')
        self.assertEqual(goal['game'], 'firered')
        self.assertEqual(goal['save']['mode'], 'current-if-able')
        self.assertEqual(goal['source']['text'], 'get me a shiny mewtwo')
        self.assertEqual(goal['source']['via'], 'typed')
        self.assertEqual(goal['source']['interpreter']['parser'], 'deterministic')
        # A static target is a farming step; the goal supervisor (G2) turns it
        # into the postgame priorityTarget (G1) when the checklist owns the save.
        self.assertEqual(kinds(r), ['farming'])
        request = goal['steps'][0]['request']
        self.assertEqual(request['schema'], 'pokemon-suite/farming-request/v1')
        self.assertEqual(request['speciesId'], 150)
        self.assertEqual(request['shiny'], 'required')
        self.assertEqual(request['quantity'], 1)
        self.assertEqual(request['locationId'], 'any')
        self.assertTrue(request['encounterLevel']['min'] <= 70 <= request['encounterLevel']['max'])
        self.assertEqual(goal['then'], 'standing-goals')
        self.assertFalse(r['confirmation']['required'])
        self.assertIn('Mewtwo', r['summary'])
        self.assertIn('shiny', r['summary'].lower())

    def test_new_game_as_named_trainer_with_starter_then_target(self):
        r = ask('start a new game as NOVA with squirtle and catch me a shiny charizard')
        self.assertTrue(r['understood'], r)
        save = r['goal']['save']
        self.assertEqual((save['mode'], save['trainerName'], save['starter']), ('new', 'NOVA', 'squirtle'))
        self.assertEqual(kinds(r), ['campaign', 'farming'])
        settings = r['goal']['steps'][0]['settings']
        self.assertEqual(settings['starter'], 'squirtle')
        self.assertEqual(settings['trainerName'], 'NOVA')
        self.assertEqual(settings['afterCampaign'], 'postgame')
        request = r['goal']['steps'][1]['request']
        self.assertEqual((request['speciesId'], request['shiny']), (6, 'required'))
        self.assertTrue(r['confirmation']['required'])
        self.assertTrue(any('new save' in reason.lower() for reason in r['confirmation']['reasons']))

    def test_multi_clause_request_becomes_ordered_player_tasks(self):
        r = ask('heal then go to cinnabar and save')
        self.assertTrue(r['understood'], r)
        steps = r['goal']['steps']
        self.assertEqual(kinds(r), ['player-task'] * 3)
        self.assertEqual([s['action'] for s in steps], ['start'] * 3)
        self.assertEqual([s['task']['kind'] for s in steps], ['heal', 'travel', 'save'])
        self.assertEqual(steps[1]['task']['map'], 'MAP_CINNABAR_ISLAND')
        self.assertEqual(r['goal']['then'], 'await-command')
        self.assertEqual([c['intent'] for c in r['clauses']], ['heal', 'travel', 'save-game'])

    def test_quantity_nature_and_ball(self):
        r = ask('catch 3 adamant abras in ultra balls')
        self.assertTrue(r['understood'], r)
        self.assertEqual(kinds(r), ['farming'])
        request = r['goal']['steps'][0]['request']
        self.assertEqual(request['schema'], 'pokemon-suite/farming-request/v1')
        self.assertEqual(request['speciesId'], 63)
        self.assertEqual(request['quantity'], 3)
        self.assertEqual(request['natures'], ['adamant'])
        self.assertEqual(request['ball'], {'id': 'ultra-ball', 'requirement': 'required'})
        # Unspecified settings come from the owner's bot defaults.
        self.assertEqual(request['limits'], CONTEXT['botSettings']['limits'])
        self.assertEqual(request['shiny'], 'any')

    def test_exact_mew_is_not_mewtwo(self):
        r = ask('get me a mew')
        self.assertTrue(r['understood'], r)
        self.assertIsNone(r.get('clarification'))
        self.assertEqual(r['clauses'][0]['slots']['species'], 151)

    def test_ambiguous_mew_prefix_asks_and_the_answer_resolves_it(self):
        r = ask('catch a mewt')
        self.assertFalse(r['understood'])
        clarification = r['clarification']
        self.assertEqual(clarification['slot'], 'species')
        choices = {c['id'] for c in clarification['choices']}
        self.assertTrue({'150', '151'} <= choices, clarification)
        self.assertIsNone(r['goal'])
        answered = ask('catch a mewt', answers={clarification['id']: '150'})
        self.assertTrue(answered['understood'], answered)
        self.assertEqual(answered['clauses'][0]['slots']['species'], 150)
        # A free-text answer is resolved against the same vocabulary.
        typed = ask('catch a mewt', answers={clarification['id']: 'mew'})
        self.assertEqual(typed['clauses'][0]['slots']['species'], 151)

    def test_typos_and_homophones(self):
        r = ask('get me a shiney pikachoo')
        self.assertTrue(r['understood'], r)
        slots = r['clauses'][0]['slots']
        self.assertEqual((slots['species'], slots['shiny']), (25, 'required'))
        speech = ask('shiny hunt mew two')
        self.assertEqual(speech['clauses'][0]['slots']['species'], 150)
        pokey = ask('hey bot catch a shiny pokey mon called eevee')
        self.assertEqual(pokey['clauses'][0]['slots']['species'], 133)

    def test_status_question_is_answered_from_the_live_payload(self):
        r = ask("what's my team")
        self.assertTrue(r['understood'], r)
        self.assertIsNone(r['goal'])
        self.assertIn('Fearow', r['answer'])
        self.assertIn('Dragonite', r['answer'])
        self.assertIn('Lv100', r['answer'].replace(' ', ''))
        where = ask('where are you')
        self.assertIn('Cerulean City', where['answer'])
        hunt = ask("how's the hunt going")
        self.assertIn('Slugma', hunt['answer'])
        offline = interpreter().interpret("what's my team", context={})
        self.assertTrue(offline['understood'])
        self.assertIn('not running', offline['answer'].lower())

    def test_nonsense_is_rejected_with_nearest_supported_actions(self):
        r = ask('make me a sandwich')
        self.assertFalse(r['understood'])
        self.assertIsNone(r['goal'])
        self.assertIsNone(r.get('clarification'))
        self.assertTrue(r['message'])
        self.assertGreaterEqual(len(r['suggestions']), 2)
        for text in ['', '   ', 'asdfghjkl', 'catch the bus', 'save the world', 'tell me a joke']:
            with self.subTest(text=text):
                result = ask(text)
                self.assertFalse(result['understood'], result)
                self.assertIsNone(result['goal'])

    def test_known_unsupported_actions_explain_themselves(self):
        release = ask('release my magikarp')
        self.assertFalse(release['understood'])
        self.assertEqual(release['unsupported'], 'release')
        self.assertIn('never released', release['message'].lower())
        cheat = ask('give me infinite rare candies')
        self.assertEqual(cheat['unsupported'], 'cheat')
        later = ask('get me a garchomp')
        self.assertEqual(later['unsupported'], 'species-not-in-game')
        self.assertIn('Garchomp', later['message'])

    def test_destructive_steps_require_confirmation(self):
        for text in ['trade my shiny charizard', 'make a new save called Nuzlocke', 'restore my Main save', 'start a new game',
                     'i want a shiny mewtwo on a new save']:
            with self.subTest(text=text):
                r = ask(text)
                self.assertTrue(r['understood'], r)
                self.assertTrue(r['confirmation']['required'], r['confirmation'])
        trade = ask('trade my shiny charizard')
        # G2's trade step contract: trade-shiny {shinyId}; trade-pokemon {pokemonId, sourceId: current}.
        self.assertEqual(trade['goal']['steps'], [{'kind': 'trade', 'via': 'trade-shiny', 'payload': {'shinyId': '1' * 64}}])
        pc = ask('trade my kadabra')
        self.assertEqual(pc['goal']['steps'], [{'kind': 'trade', 'via': 'trade-pokemon', 'payload': {'pokemonId': 'aaaa' + '0' * 59 + '1', 'sourceId': 'current'}}])
        for text in ['heal', 'catch a pikachu', 'stop the bot']:
            with self.subTest(text=text):
                self.assertFalse(ask(text)['confirmation']['required'])

    def test_duplicate_shinies_ask_which_one(self):
        r = ask('trade my shiny pikachu')
        self.assertEqual(r['clarification']['slot'], 'shiny')
        self.assertEqual({c['id'] for c in r['clarification']['choices']}, {'2' * 64, '3' * 64})
        chosen = ask('trade my shiny pikachu', answers={r['clarification']['id']: '3' * 64})
        self.assertEqual(chosen['goal']['steps'][0]['payload']['shinyId'], '3' * 64)

    def test_bot_control_and_other_families(self):
        cases = {
            'stop the bot': ('player-task', {'action': 'stop'}),
            'resume': ('player-task', {'action': 'resume'}),
            'start the bot': ('player-task', {'action': 'ready'}),
            'close the game': ('player-task', {'action': 'stop-game'}),
            'do the postgame': ('postgame', {}),
            'complete the shiny national dex': ('collection', {'goal': 'national-dex'}),
            'buy 5 rare candies': ('player-task', {'action': 'start'}),
        }
        for text, (kind, fields) in cases.items():
            with self.subTest(text=text):
                r = ask(text)
                self.assertTrue(r['understood'], r)
                step = r['goal']['steps'][0]
                self.assertEqual(step['kind'], kind)
                for key, value in fields.items():
                    self.assertEqual(step[key], value)
        item = ask('buy 5 rare candies')['goal']['steps'][0]['task']
        self.assertEqual((item['kind'], item['itemId'], item['quantity']), ('item', 68, 5))
        ev = ask('ev train my alakazam in special attack and speed')
        task = ev['goal']['steps'][0]['task']
        self.assertEqual(task['kind'], 'ev-training')
        self.assertEqual(task['fingerprint'], '[65,1234,5678,31,31,31,31,31,31]')
        # validate_effort_task() takes all six EV stats; unspecified ones are 0.
        self.assertEqual(task['evs'], {'hp': 0, 'attack': 0, 'defense': 0, 'spAttack': 252, 'spDefense': 0, 'speed': 252})
        self.assertEqual(ev['clauses'][0]['slots']['evs'], {'spAttack': 252, 'speed': 252})

    def test_settings_changes_are_direct_and_partial(self):
        r = ask('set the default ball to ultra ball')
        self.assertTrue(r['understood'], r)
        self.assertIsNone(r['goal'])
        self.assertEqual(r['direct'], [{'kind': 'settings', 'preferences': {'ball': {'id': 'ultra-ball', 'requirement': 'required'}}}])

    def test_preview_and_validation_hooks_are_used(self):
        seen = []

        def preview(request):
            seen.append(request)
            return {'canStart': False, 'state': 'unsupported', 'limitations': ['Mewtwo needs: Hall of Fame.'], 'pokemon': {'name': 'Mewtwo'}}

        r = ask('get me a shiny mewtwo', preview=preview)
        self.assertEqual(seen[0]['speciesId'], 150)
        self.assertEqual(r['preview'][0]['limitations'], ['Mewtwo needs: Hall of Fame.'])
        self.assertTrue(r['understood'])

        def invalid(request):
            raise ValueError('That gender is not possible for this Pokémon.')

        bad = ask('catch a female tauros', preview=invalid)
        self.assertFalse(bad['understood'])
        self.assertIn('gender is not possible', bad['message'])
        self.assertIsNone(bad['goal'])

    def test_safari_only_ball_conflict_becomes_a_choice(self):
        def preview(request):
            if request['ball']['requirement'] == 'required' and request['ball']['id'] not in ('any', 'safari-ball'):
                raise ValueError('The required Poké Ball is incompatible with this acquisition method. Safari encounters require a Safari Ball.')
            return {'canStart': True, 'state': 'ready-to-verify', 'limitations': [], 'pokemon': {'name': 'Dratini'}}

        r = ask('catch a dratini in an ultra ball', preview=preview)
        self.assertFalse(r['understood'])
        self.assertEqual(r['clarification']['slot'], 'ball')
        self.assertEqual([c['id'] for c in r['clarification']['choices']], ['safari-ball', 'any'])
        fixed = ask('catch a dratini in an ultra ball', answers={r['clarification']['id']: 'safari-ball'}, preview=preview)
        self.assertTrue(fixed['understood'], fixed)
        self.assertEqual(fixed['goal']['steps'][0]['request']['ball'], {'id': 'safari-ball', 'requirement': 'required'})

    def test_save_mode_phrases(self):
        self.assertEqual(ask('on my current save get me a shiny zapdos')['goal']['save']['mode'], 'current')
        self.assertEqual(ask('catch a pikachu')['goal']['save']['mode'], 'current-if-able')


class Generalization(unittest.TestCase):
    """Behaviors found with the blind phrasing sets (general rules, not phrase lists)."""
    def test_command_typos_are_fixed_but_vocabulary_words_are_not(self):
        self.assertEqual(ask('cna you catch me a shiny abra')['clauses'][0]['slots']['species'], 63)
        self.assertEqual(ask('savee your progress real quick')['clauses'][0]['intent'], 'save-game')
        travel = ask("can we go to bill's house?")
        self.assertEqual(travel['goal']['steps'][0]['task']['map'], 'MAP_ROUTE25_SEA_COTTAGE', 'bill is not corrected to ball')
        self.assertEqual(pr.correct_commands(['catch', 'the', 'bus']), ['catch', 'the', 'bus'], 'no substitutions in short words')

    def test_status_answers_need_a_question(self):
        self.assertFalse(ask('save money')['understood'])
        self.assertTrue(ask('how much money do we have')['understood'])
        self.assertTrue(ask('found anything yet')['understood'])

    def test_ordering_and_attachment(self):
        self.assertEqual([c['intent'] for c in ask("save the game once you've healed")['clauses']], ['heal', 'save-game'])
        self.assertEqual([c['intent'] for c in ask('catch an articuno and then a moltres')['clauses']], ['catch', 'catch'])
        settings = ask('by default, when a hunt is done, prep the pokemon for trade')
        self.assertEqual(settings['direct'][0]['preferences'], {'afterCompletion': 'prepare-trade'})
        self.assertEqual(ask('get me an adamant scyther w/ perfect IVs')['clauses'][0]['slots']['minIvs']['speed'], 31)

    def test_speech_spellings(self):
        self.assertEqual(ask('e v train machamp in hp and attack')['clauses'][0]['slots']['evs'], {'hp': 252, 'attack': 252})
        self.assertEqual(ask('heel my pokemon')['clauses'][0]['intent'], 'heal')
        self.assertEqual(ask('bye twenty great balls')['goal']['steps'][0]['task']['quantity'], 20)

    def test_non_shiny_trade_uses_the_pc_individual(self):
        r = ask('trade my regular non-shiny pikachu from box 1')
        self.assertEqual(r['goal']['steps'][0]['via'], 'trade-pokemon')
        self.assertEqual(r['goal']['steps'][0]['payload']['pokemonId'], 'aaaa' + '0' * 59 + '2')


class HonestAnswers(unittest.TestCase):
    """Only requests become runnable (laya-nl-20260925): questions and negations never do, and neither does a hunt no executor can start."""

    def test_a_negated_command_queues_nothing(self):
        for text in ["don't catch a pikachu", 'dont catch a pikachu', "i don't want a pikachu", 'never catch a pikachu', 'do not go to cinnabar',
                     "please don't trade my shiny charizard", 'you do not need to heal', "no don't stop",
                     # A negated cancel is no cancel (release-1 review); nor are these lead-ins a request.
                     "don't cancel my goal", 'never cancel the mewtwo hunt', "please don't cancel the mewtwo hunt", "don't abort the hunt",
                     'i do not want to cancel the mewtwo hunt', "actually don't catch a pikachu", "you shouldn't catch a pikachu",
                     "let's not start a new game", 'lets not go to cinnabar', 'better not catch a pikachu', "so, um, don't heal"]:
            with self.subTest(text=text):
                r = ask(text)
                self.assertFalse(r['understood'], r)
                self.assertIsNone(r['goal'])
                self.assertIsNone(r['clarification'])
                self.assertEqual(r['unsupported'], 'negated')
                self.assertIn('nothing was queued', r['message'])
                self.assertIn('cancel that goal', r['suggestions'])
        # Not negations of the command: cancelling, a double negative, a trait of the catch.
        for text, intent in [('never mind the mewtwo', 'goal-cancel'), ("i don't care about the nature, just catch an abra", 'catch'),
                             ("catch a pikachu, doesn't need to be shiny", 'catch')]:
            with self.subTest(text=text):
                self.assertEqual([c['intent'] for c in ask(text)['clauses'] if c['status'] == 'accepted'], [intent])
        partial = ask("heal and don't save")
        self.assertEqual(partial['clarification']['id'], 'partial')
        self.assertIn('nothing was queued', partial['message'])

    def test_a_negation_dictation_punctuated_off_its_verb_still_queues_nothing(self):
        """addsPunctuation can write "Don't, uh, catch a Pikachu.": the bare "don't" belongs to the next words, and one that ends the
        request takes it back (release-1 review)."""
        for text in ["Don't, uh, catch a Pikachu.", "Don't. Catch a Pikachu.", "No, don't, save the game.", "Don't, save the game.",
                     "Don't, um, restore my main save.", "Never, ever, go to Cinnabar.", "Catch a Pikachu. No, don't.",
                     "Go to Cinnabar and save. Actually, no, don't."]:
            with self.subTest(text=text):
                r = interpreter().interpret(text, via='voice', context=context())
                self.assertFalse(r['understood'], r)
                self.assertIsNone(r['goal'])
                self.assertEqual(r['direct'], [])
                self.assertEqual(r['unsupported'], 'negated')
        self.assertEqual(ask("heal, don't save")['clarification']['id'], 'partial', 'a negation with its verb is its own clause, as before')

    def test_keep_going_until_is_not_a_negation(self):
        """"don't stop until you catch a shiny pikachu" asks for the hunt (main queued it); only the stop is negated."""
        for text, want, species in [("don't stop until you catch a shiny pikachu", ['catch'], 25),
                                    ("i don't want you to stop until you catch a shiny pikachu", ['catch'], 25),
                                    ("don't quit until you catch a shiny mewtwo", ['catch'], 150), ('never give up until you catch a shiny abra', ['catch'], 63),
                                    ("keep going and don't stop until you catch a shiny pikachu", ['bot-resume', 'catch'], 25)]:
            with self.subTest(text=text):
                r = ask(text)
                self.assertTrue(r['understood'], r)
                self.assertEqual([c['intent'] for c in r['clauses'] if c['status'] == 'accepted'], want)
                self.assertEqual([s['request']['speciesId'] for s in r['goal']['steps'] if s['kind'] == 'farming'], [species])
        self.assertNotEqual(ask("please don't stop until you find a shiny scyther")['unsupported'], 'negated')
        for text in ["don't stop", "don't stop the bot", 'never stop hunting', "no don't stop"]:
            with self.subTest(text=text):
                r = ask(text)
                self.assertFalse(r['understood'], r)
                self.assertIsNone(r['goal'])

    def test_an_idle_question_asks_before_anything_runs(self):
        # "do i have a kadabra" is answered from the party and PC since stage 5 (AnswerOnlyQuestions), no longer asked about.
        for text, species in [('is there a shiny mewtwo', 150), ('are there any abras on route 24', 63), ('should i catch a pikachu', 25)]:
            with self.subTest(text=text):
                r = ask(text)
                self.assertFalse(r['understood'], r)
                self.assertIsNone(r['goal'])
                clar = r['clarification']
                self.assertEqual((clar['id'], clar['slot']), ('0:question', 'question'))
                self.assertTrue(clar['question'].startswith('Do you want the bot to catch '), clar['question'])
                self.assertEqual([c['id'] for c in clar['choices']], ['yes:catch', 'no'])
                self.assertEqual(ask(text, answers={'0:question': 'yes:heal'})['clarification']['id'], '0:question', 'a yes to another action is no answer')
                yes = ask(text, answers={'0:question': 'yes:catch'})
                self.assertTrue(yes['understood'], yes)
                self.assertEqual(yes['goal']['steps'][0]['request']['speciesId'], species)
                self.assertFalse([r for r in yes['confirmation']['reasons'] if 'want the bot' in r or r.startswith('I read')], 'the yes was the confirmation')
                no = ask(text, answers={'0:question': 'no'})
                self.assertFalse(no['understood'])
                self.assertIsNone(no['goal'])
                self.assertIsNone(no['clarification'])
                self.assertIn('nothing was queued', no['message'].lower())

    def test_polite_requests_and_status_questions_are_unchanged(self):
        for text, intent in [('can you catch a pikachu?', 'catch'), ('can you catch a pikachu', 'catch'), ('could you heal my team?', 'heal'),
                             ('can i have a shiny articuno', 'catch'), ('is it ok to catch a pikachu', 'catch'), ('do i have any shinies', 'status-shinies'), ('is the bot running', 'status-bot'),
                             ('how many badges do i have', 'status-progress'), ('is there a pikachu in my party', 'status-team')]:
            with self.subTest(text=text):
                r = ask(text)
                self.assertTrue(r['understood'], r)
                self.assertEqual([c['intent'] for c in r['clauses'] if c['status'] == 'accepted'], [intent])
                self.assertIsNone(r['clarification'])

    def test_a_hunt_no_executor_can_start_is_understood_but_not_offered_to_run(self):
        limitation = 'Lapras is a one-time gift the bot can’t collect yet.'

        def stuck(request):
            return {'canStart': False, 'state': 'unsupported', 'limitations': [limitation, 'Another note.'], 'pokemon': {'name': 'Lapras'}}

        for text in ('catch a lapras', 'heal then catch a lapras'):
            with self.subTest(text=text):
                r = ask(text, preview=stuck)
                self.assertTrue(r['understood'], r)
                self.assertIsNone(r['goal'])
                self.assertEqual(r['direct'], [])
                self.assertFalse(r['confirmation']['required'])
                self.assertEqual(r['answer'], f'Understood, but the bot can’t run this yet: {limitation}')
                self.assertEqual(r['message'], r['answer'])
                self.assertEqual(r['preview'][-1]['limitations'][0], limitation)
        # The supervisor runs the first stage of an evolution or trade route, so that is still a goal.
        source = ask('get me an alakazam', preview=lambda request: {'canStart': False, 'canStartSource': True, 'limitations': ['The Kadabra step can run now.']})
        self.assertIsNotNone(source['goal'])
        # One-time encounters and the Eevee gift depend on the save: the supervisor checks them and can offer a new save.
        for text in ('get me a shiny mewtwo', 'get me an eevee'):
            with self.subTest(text=text):
                self.assertIsNotNone(ask(text, preview=stuck)['goal'])
        # Only when every farming step is stuck: one that can start keeps the goal (its preview shows the other's limitation).
        mixed = ask('catch an abra and catch a lapras', preview=lambda request: {'canStart': request['speciesId'] == 63, 'limitations': [limitation]})
        self.assertEqual([s['kind'] for s in mixed['goal']['steps']], ['farming', 'farming'])
        both = ask("what's my team and catch a lapras", preview=stuck)
        self.assertIsNone(both['goal'])
        self.assertTrue(both['answer'].endswith(f'Understood, but the bot can’t run this yet: {limitation}'))
        self.assertIn('Fearow', both['answer'], 'the status answer is kept')
        # A preview that could not be read is not a refusal.
        self.assertIsNotNone(ask('catch a lapras', preview=lambda request: 1 / 0)['goal'])


class AnswerOnlyQuestions(unittest.TestCase):
    """Common questions get real answers from data the host already reads (laya-nl-20260925 stage 5); none of them runs anything."""

    def answered(self, text, intent, ctx=None):
        r = interpreter().interpret(text, via='typed', context=context() if ctx is None else ctx)
        self.assertTrue(r['understood'], r)
        self.assertEqual([(c['intent'], c['status']) for c in r['clauses']], [(intent, 'accepted')])
        self.assertIsNone(r['goal'])
        self.assertEqual(r['direct'], [])
        self.assertIsNone(r['clarification'])
        self.assertFalse(r['confirmation']['required'])
        self.assertTrue(r['answer'])
        return r

    @staticmethod
    def stopped(live):
        """The fixture with its owner stopped: the sessions payload carries the compact stop triage (pokemon_stop_triage.attach)."""
        ctx = context()
        ctx['session'] = {**live, 'triage': st.compact(st.classify(st.stop_facts(live=live)))}
        return ctx

    def test_why_it_stopped_is_the_stop_triage_with_its_proven_safe_fix(self):
        ctx = self.stopped(released_hunt(102))
        triage = ctx['session']['triage']
        action = triage['suggestedAction']
        self.assertTrue(action['safe'], 'precondition: code proved the resume safe')
        for text in ('why did it stop', 'what happened', 'why is the bot stuck', 'why did you stop?', 'what went wrong'):
            with self.subTest(text=text):
                r = self.answered(text, 'status-stop', ctx)
                self.assertTrue(r['answer'].startswith(f"Stopped: {triage['title']}. {triage['explanation']}"), r['answer'])
                self.assertIn('The stop card offers a one-tap fix: Resume the bot.', r['answer'], 'Ask shows no button: the stop card has it')
                # The existing one-tap action: POST /api/pokemon-suite/player-tasks with the token; confirm() re-derives it from fresh state.
                self.assertEqual(r['offer'], {'label': action['label'], 'confirm': action['confirm'],
                                              'playerTask': {'game': 'firered', 'action': 'resume', 'triage': action['token']}})
        unsafe = self.answered('why did it stop', 'status-stop', self.stopped(rare_candy(107)))
        self.assertIn('Unrecognised prompt in the party menu', unsafe['answer'])
        self.assertIn('Install engine build 108 or later', unsafe['answer'])
        self.assertNotIn('offer', unsafe, 'no proven-safe fix: nothing to tap')
        running = self.answered('why did it stop', 'status-stop')  # the fixture's bot is running its checklist
        self.assertTrue(running['answer'].startswith('The bot is not stopped.'), running['answer'])
        self.assertNotIn('offer', running)
        self.assertIn('not running', interpreter().interpret('why did it stop', context={})['answer'].lower())
        service = pr.RequestService(type('Server', (), {})(), interpreter=pr.Interpreter(), context_provider=lambda: ctx)
        draft = service.interpret({'text': 'why did it stop', 'via': 'voice'})
        with self.assertRaisesRegex(pr.RequestError, 'Nothing to run'):
            service.commit({'draftId': draft['draftId'], 'idempotencyKey': 'key-why-0001', 'answers': {'confirm': 'yes'}})

    def test_do_i_have_says_yes_or_no_and_where(self):
        for text, where in [('do i have a kadabra', 'Box 2, slot 3'), ('is there a kadabra in my pc', 'Box 2, slot 3'), ('do you have a kadabra?', 'Box 2, slot 3'),
                            ('is pikachu in my pc', 'Box 1, slot 1'), ('do i have a dragonite', 'party slot 3'), ('where is my alakazam', 'party slot 6'),
                            ('where is drake', 'party slot 3')]:
            with self.subTest(text=text):
                r = self.answered(text, 'status-owned')
                self.assertTrue(r['answer'].startswith('Yes: '), r['answer'])
                self.assertIn(where, r['answer'])
        self.assertEqual(ask('do i have a kadabra')['clauses'][0]['slots'], {'species': 64})
        self.assertEqual(self.answered('do i have a kadabra', 'status-owned')['answer'], 'Yes: Kadabra (Box 2, slot 3).')
        self.assertEqual(self.answered('where is drake', 'status-owned')['answer'], 'Yes: Drake (Dragonite, party slot 3).')
        self.assertEqual(self.answered('do i have a mewtwo', 'status-owned')['answer'], 'No Mewtwo in the party or PC.')
        self.assertEqual(self.answered('do i have a charizard', 'status-owned')['answer'],
                         'No Charizard in the party or PC. The shiny collection has 1 saved shiny Charizard.')
        self.assertIn('also has 2 saved shiny Pikachu', self.answered('is pikachu in my pc', 'status-owned')['answer'])
        self.assertEqual(self.answered("what's in my pc", 'status-owned')['answer'], 'PC: 2 Pokémon — Kadabra (Box 2, slot 3), Pikachu (Box 1, slot 1).')
        self.assertEqual(interpreter().interpret('do i have a kadabra', context={})['answer'], 'I can’t read the party or PC right now.')

    def test_the_live_party_is_fresher_than_the_pc_read(self):
        """The PC read is the last save (dict locations, 0-based); the live party wins for party slots, and alone it answers offline."""
        ctx = context()
        ctx['trainingPokemon'] = []
        ctx['inventory'] = {'pokemon': [{'nationalSpeciesId': 64, 'name': 'Kadabra', 'location': {'kind': 'box', 'box': 1, 'slot': 2}},
                                        {'nationalSpeciesId': 63, 'name': 'Abra', 'location': {'kind': 'party', 'slot': 1}, 'level': 12}]}
        self.assertEqual(self.answered('do i have a kadabra', 'status-owned', ctx)['answer'], 'Yes: Kadabra (Box 2, slot 3).')
        self.assertEqual(self.answered('do i have an abra', 'status-owned', ctx)['answer'], 'No Abra in the party or PC.',
                         'slot 2 of the live party is Golduck now: the older save’s Abra is not reported')
        ctx['session'] = {'game': 'firered', 'state': 'offline'}
        self.assertEqual(self.answered('do i have an abra', 'status-owned', ctx)['answer'], 'Yes: Abra (party slot 2).')
        ctx['inventory'] = None
        self.assertEqual(self.answered('do i have a kadabra', 'status-owned', ctx)['answer'], 'I can’t read the party or PC right now.')
        live = context()
        live['inventory'] = live['trainingPokemon'] = None
        self.assertEqual(self.answered('do i have a kadabra', 'status-owned', live)['answer'], 'No Kadabra in the party; I can’t read the PC right now.')

    def test_level_ivs_and_evs_of_an_owned_pokemon(self):
        self.assertEqual(self.answered('what level is my alakazam', 'status-stats')['answer'], 'Alakazam (party slot 6): Lv60.')
        self.assertEqual(self.answered('what level is drake', 'status-stats')['answer'], 'Drake (Dragonite, party slot 3): Lv100.')
        self.assertEqual(self.answered('show alakazam ivs', 'status-stats')['answer'], 'Alakazam (party slot 6): IVs 31 HP / 31 Atk / 31 Def / 31 SpA / 31 SpD / 31 Spe.')
        self.assertEqual(self.answered('show my dragonite evs', 'status-stats')['answer'],
                         'Drake (Dragonite, party slot 3): EVs 6 HP / 252 Atk / 0 Def / 0 SpA / 0 SpD / 252 Spe (510 total).')
        self.assertEqual(self.answered("what are my kadabra's ivs and evs", 'status-stats')['answer'],
                         'Kadabra (Box 2, slot 3): IVs 12 HP / 5 Atk / 20 Def / 30 SpA / 14 SpD / 28 Spe; EVs 0 HP / 0 Atk / 0 Def / 0 SpA / 0 SpD / 0 Spe (0 total).')
        self.assertEqual(self.answered('what level is my kadabra', 'status-stats')['answer'], 'Kadabra (Box 2, slot 3): level unknown in the PC.')
        self.assertEqual(self.answered('what level is my mewtwo', 'status-stats')['answer'], 'No Mewtwo in the party or PC.')
        self.assertEqual(ask('show alakazam ivs')['clauses'][0]['slots'], {'species': 65})
        which = ask('show me the ivs')
        self.assertEqual((which['clauses'][0]['intent'], which['clarification']['slot']), ('status-stats', 'species'))
        self.assertIn('31 SpA', ask('show me the ivs', answers={which['clarification']['id']: 'alakazam'})['answer'])

    def test_missing_pokedex_entries_and_open_checklist_entries(self):
        dex = self.answered('what pokemon am i missing', 'status-missing')['answer']
        self.assertEqual(dex, 'Pokédex: 116/386 caught, 270 missing: Venusaur, Blastoise, Butterfree, Beedrill, Pidgeot, Raichu, Sandslash, Nidoqueen, '
                              'Nidoking, Clefable and 260 more. Kanto 116/150.')
        for text in ('how many pokedex left', 'how many pokemon do i still need', 'how many pokedex entries are left', 'which pokemon am i missing?'):
            with self.subTest(text=text):
                self.assertTrue(self.answered(text, 'status-missing')['answer'].startswith('Pokédex: 116/386 caught, 270 missing'))
        self.assertEqual(self.answered("what's left on the postgame checklist", 'status-missing')['answer'],
                         '1 postgame checklist entry still open: National Pokédex collection.')
        ctx = context()
        ctx['session']['postgame']['collection'] = [{'speciesId': 3, 'status': 'local'}, {'speciesId': 151, 'status': 'external'}, {'speciesId': 1, 'status': 'complete'}]
        self.assertTrue(self.answered('what pokemon am i missing', 'status-missing', ctx)['answer'].endswith(
            'Kanto 116/150. 1 of them can be caught or evolved on this cartridge.'))
        del ctx['session']['postgame']['progress']['dex']
        self.assertEqual(self.answered('what pokemon am i missing', 'status-missing', ctx)['answer'],
                         'Pokédex: 116/386 caught, 270 left. The list of missing species isn’t visible right now.')

    def test_bag_counts(self):
        for text, answer in [('how many rare candies do i have', '7 × Rare Candy in the bag.'), ('how many ultra balls have i got', '48 × Ultra Ball in the bag.'),
                             ('do i have any potions', 'No Potion in the bag.'), ('how many poke balls are left', '5 × Poke Ball in the bag.'),
                             ('do we have enough full restores', '35 × Full Restore in the bag.')]:
            with self.subTest(text=text):
                self.assertEqual(self.answered(text, 'status-bag')['answer'], answer)
        self.assertEqual(ask('how many rare candies do i have')['clauses'][0]['slots'], {'item': 68})
        bag = self.answered("what's in my bag", 'status-bag')['answer']
        self.assertTrue(bag.startswith('Bag: Full Restore ×35, Revive ×12, Rare Candy ×7, '), bag)
        self.assertIn('Ultra Ball ×48', bag)
        unread = context()
        del unread['bag']
        self.assertEqual(self.answered('how many rare candies do i have', 'status-bag', unread)['answer'],
                         'The bag isn’t readable yet: the save reader returns the party and PC, not the bag.')

    def test_nearby_requests_keep_their_actions(self):
        """The new answers do not take over actions or the existing answers that share their words."""
        for text, intent in [('ev train my alakazam in special attack and speed', 'ev-training'), ('give my dragonite 252 attack and 252 speed evs', 'ev-training'),
                             ('level up my charizard', None), ('catch a jolly scyther with perfect ivs', 'catch'), ('buy 10 ultra balls', 'item'),
                             ('stop the bot', 'bot-stop'), ('is the bot running', 'status-bot'), ('how many shinies do i have', 'status-shinies'),
                             ('how many badges do i have', 'status-progress'), ('how much money do i have', 'status-money'), ('where are you', 'status-location'),
                             ('is there a pikachu in my party', 'status-team'), ('pick up where you left off', 'bot-resume'), ('what saves do i have', 'status-saves'),
                             ('how complete is my pokedex', 'status-progress')]:
            with self.subTest(text=text):
                self.assertEqual([c['intent'] for c in ask(text)['clauses'] if c['status'] == 'accepted'], [intent] if intent else [])
        self.assertEqual(ask('level up my charizard')['unsupported'], 'level-up')
        # No word cue of the new answers switches off catch's verbless reading, and a comma fragment stays with its action.
        for text, species in [('shiny pikachu with perfect ivs', 25), ('a jolly abra with max ivs please', 63), ('a level 50 bulbasaur', 1),
                              ('timid abra, 31 speed ivs', 63), ('catch a pikachu, store it in the pc', 25), ('catch a mewtwo, no matter how many balls it takes', 150)]:
            with self.subTest(text=text):
                r = ask(text)
                self.assertTrue(r['understood'], r['message'])
                self.assertEqual([(c['intent'], c['slots'].get('species')) for c in r['clauses']], [('catch', species)])
        self.assertEqual(ask('grab some rare candies, put them in my bag')['clauses'][0]['intent'], 'item')
        # Where to find one, the shiny collection, a Pokémon an earlier step has not caught yet: not answered from the party and PC.
        self.assertFalse(ask('where is mewtwo')['understood'])
        self.assertFalse(ask('how many shinies are left to catch')['understood'])
        later = ask('catch a timid abra and tell me its ivs')
        self.assertEqual([c['intent'] for c in later['clauses']], ['catch', 'status-stats'])
        self.assertEqual(later['answer'], 'Its level, IVs and EVs are read from the save once the earlier step is done; ask again then.')
        self.assertEqual(later['goal']['steps'][0]['request']['speciesId'], 63)

    def test_live_context_reads_the_bag_with_the_pc(self):
        calls = []

        class Trading:
            def inventory(self, game):
                calls.append(game)
                return {'pokemon': [{'nationalSpeciesId': 64}], 'bag': {'items': [{'itemId': 68, 'quantity': 3}]}}

        class Sessions:
            directory = '/nonexistent'
            snapshots = shinies = lambda self: []

        server = type('Server', (), {'pokemon_sessions': Sessions(), 'trading': Trading()})()
        ctx = pr.Context(pr.live_context(server))
        self.assertEqual(ctx.get('bag'), {'items': [{'itemId': 68, 'quantity': 3}]})
        self.assertEqual(ctx.get('inventory'), [{'nationalSpeciesId': 64}])
        self.assertEqual(calls, ['firered'], 'one PC read per request')

    def test_the_bag_is_not_claimed_until_the_save_reader_returns_it(self):
        """TradingLibrary.inventory returns the party and PC, no bag pockets (release-1 review): a bag question says so and help does not
        offer bag answers yet. The fixture's "bag" stands in for a reader that returns it."""
        class Trading:
            def inventory(self, game):
                return {'pokemon': [{'nationalSpeciesId': 64}]}

        class Sessions:
            directory = '/nonexistent'
            snapshots = shinies = lambda self: []

        server = type('Server', (), {'pokemon_sessions': Sessions(), 'trading': Trading()})()
        self.assertEqual(interpreter().interpret('how many rare candies do i have', context=pr.live_context(server))['answer'], pr.NO_BAG)
        self.assertNotIn('bag', ask('what can you do')['answer'].lower())


SIX = ('hp', 'attack', 'defense', 'spAttack', 'spDefense', 'speed')


def request_of(result, index=0):
    return result['goal']['steps'][index]['request']


class AbilitiesIVsAndEVs(unittest.TestCase):
    """Follow-up: abilities, maximum IVs, ability-first search, catch-then-EV, Hidden Power."""
    def test_ability_goes_into_the_farming_request(self):
        r = ask('catch a levitate gengar')
        self.assertTrue(r['understood'], r)
        self.assertEqual(request_of(r)['abilityId'], 26)
        self.assertEqual(r['clauses'][0]['slots']['ability'], 26)
        self.assertIn('Levitate', r['summary'])
        self.assertEqual(request_of(ask('abra with synchronize'))['abilityId'], 28)
        self.assertEqual(request_of(ask('find me an abra that has inner focus'))['abilityId'], 39)
        self.assertEqual(request_of(ask('catch a gengar with the ability levitaet'))['abilityId'], 26, 'fuzzy ability names')
        self.assertIsNone(request_of(ask('catch an abra'))['abilityId'])

    def test_ability_the_species_cannot_have_asks_with_its_real_abilities(self):
        r = ask('catch a gengar with intimidate')
        self.assertFalse(r['understood'])
        clarification = r['clarification']
        self.assertEqual(clarification['slot'], 'ability')
        self.assertEqual([c['id'] for c in clarification['choices']], ['26', 'any'])
        self.assertIn('Levitate', clarification['question'])
        self.assertIn('Intimidate', clarification['question'])
        chosen = ask('catch a gengar with intimidate', answers={clarification['id']: '26'})
        self.assertEqual(request_of(chosen)['abilityId'], 26)
        anything = ask('catch a gengar with intimidate', answers={clarification['id']: 'any'})
        self.assertIsNone(request_of(anything)['abilityId'])
        later = ask('catch an eevee with adaptability')
        self.assertEqual(later['clarification']['slot'], 'ability')
        self.assertIn('Run Away', later['clarification']['question'])
        self.assertIn('FireRed', later['clarification']['question'])

    def test_ability_first_search_offers_species_ranked_by_availability(self):
        r = ask('find a pokemon with intimidate')
        self.assertFalse(r['understood'])
        clarification = r['clarification']
        self.assertEqual(clarification['slot'], 'species')
        ids = [c['id'] for c in clarification['choices']]
        for sid in ('23', '58', '128', '130'):
            self.assertIn(sid, ids)
        self.assertLess(ids.index('58'), ids.index('130'), 'wild encounters rank before evolution-only routes')
        self.assertNotIn('211', ids)
        for species in ('209', '234', '237', '262', '284', '303', '373'):  # Intimidate users not obtainable in FireRed
            self.assertNotIn(species, ids)
        answered = ask('find a pokemon with intimidate', answers={clarification['id']: '58'})
        self.assertTrue(answered['understood'], answered)
        self.assertEqual((request_of(answered)['speciesId'], request_of(answered)['abilityId']), (58, 22))

    def test_nature_or_iv_only_requests_ask_which_species(self):
        for text in ('catch me an adamant pokemon', 'get a pokemon with perfect ivs', 'hunt something with 31 speed'):
            with self.subTest(text=text):
                r = ask(text)
                self.assertFalse(r['understood'], r)
                self.assertEqual(r['clarification']['slot'], 'species')
        answered = ask('catch me an adamant pokemon', answers={'0:species': 'scyther'})
        self.assertEqual((request_of(answered)['speciesId'], request_of(answered)['natures']), (123, ['adamant']))

    def test_maximum_and_per_stat_ivs(self):
        r = ask('catch a modest abra with 0 attack iv')
        self.assertEqual(request_of(r)['maxIvs'], {'attack': 0})
        self.assertEqual(request_of(r)['minIvs'], {})
        self.assertEqual(request_of(ask('a brave slowpoke with min speed'))['maxIvs'], {'speed': 0})
        low = request_of(ask('catch a timid gastly with low attack'))
        self.assertEqual(low['maxIvs'], {'attack': 5})
        mixed = request_of(ask('catch an abra with 31 speed and 30+ special attack'))
        self.assertEqual(mixed['minIvs'], {'speed': 31, 'specialAttack': 30})
        self.assertNotIn('maxIvs', mixed, 'maxIvs is only sent when asked for')
        both = request_of(ask('catch a quiet slowpoke with 0 speed and 31 hp'))
        self.assertEqual((both['maxIvs'], both['minIvs']), ({'speed': 0}, {'hp': 31}))
        capped = request_of(ask('catch a slowpoke with speed iv at most 10'))
        self.assertEqual(capped['maxIvs'], {'speed': 10})

    def test_catch_then_ev_train_references_the_caught_pokemon(self):
        r = ask('catch a jolly scyther then EV train it 252 attack 252 speed')
        self.assertTrue(r['understood'], r)
        self.assertEqual(kinds(r), ['farming', 'player-task'])
        self.assertEqual(request_of(r)['natures'], ['jolly'])
        task = r['goal']['steps'][1]['task']
        self.assertEqual(task['kind'], 'ev-training')
        self.assertEqual(task['fingerprint'], {'$ref': 'steps[0].result.fingerprint'})
        self.assertEqual(task['evs'], {'hp': 0, 'attack': 252, 'defense': 0, 'spAttack': 0, 'spDefense': 0, 'speed': 252})
        self.assertEqual(task['ivRanges'], {})
        self.assertEqual(r['goal']['steps'][1]['action'], 'start')
        shifted = ask('start a new game with squirtle, catch a jolly scyther, then ev train it max attack and speed')
        self.assertEqual(kinds(shifted), ['campaign', 'farming', 'player-task'])
        self.assertEqual(shifted['goal']['steps'][2]['task']['fingerprint'], {'$ref': 'steps[1].result.fingerprint'})
        inline = ask('catch a jolly scyther with 252 attack and 252 speed evs')
        self.assertEqual(kinds(inline), ['farming', 'player-task'])
        self.assertEqual(request_of(inline)['minIvs'], {}, 'EV numbers are not IVs')
        many = ask('catch 3 scythers then ev train them in attack')
        self.assertFalse(many['understood'])
        self.assertIn('one', many['message'].lower())

    def test_ev_spreads_and_limits(self):
        def evs(text):
            return ask(text)['goal']['steps'][0]['task']['evs']
        self.assertEqual(evs('ev train fearow 252 atk / 252 spe / 4 hp'), {'hp': 4, 'attack': 252, 'defense': 0, 'spAttack': 0, 'spDefense': 0, 'speed': 252})
        self.assertEqual(evs('max attack and speed EVs on machamp'), {'hp': 0, 'attack': 252, 'defense': 0, 'spAttack': 0, 'spDefense': 0, 'speed': 252})
        self.assertEqual(evs('ev train alakazam 252 spa 252 spe 6 hp')['spAttack'], 252)
        over = ask('ev train fearow 255 attack 255 speed 255 hp')
        self.assertFalse(over['understood'])
        self.assertIn('510', over['message'])
        stat = ask('ev train fearow 300 attack')
        self.assertFalse(stat['understood'])
        self.assertIn('255', stat['message'])

    def test_hidden_power_type_becomes_a_hunt_trait(self):
        r = ask('catch a timid abra with hidden power fire')
        self.assertTrue(r['understood'], r)
        self.assertEqual(request_of(r)['natures'], ['timid'])
        self.assertEqual(request_of(r)['hiddenPower'], {'type': 'fire'})
        self.assertEqual(request_of(r)['moves'], [], 'a Hidden Power type is a trait, not a move to teach')
        self.assertIn('Hidden Power Fire', r['summary'])
        self.assertEqual(request_of(ask('get me an ice hidden power abra'))['hiddenPower'], {'type': 'ice'})
        plain = ask('catch an abra that knows hidden power')
        self.assertEqual(request_of(plain)['moves'], [237], 'the move itself is still a normal move request')
        self.assertNotIn('hiddenPower', request_of(plain))


class Normalization(unittest.TestCase):
    def test_numbers_speech_quirks_and_clauses(self):
        self.assertEqual(pr.normalize('Catch THREE Pokey Mon'), 'catch 3 pokemon')
        self.assertEqual(pr.normalize('twenty five shiney ones'), '25 shiny ones')
        self.assertEqual(pr.normalize("What's my team?"), 'what is my team')
        self.assertEqual(pr.split_clauses(pr.normalize('heal then go to cinnabar and save')), ['heal', 'go to cinnabar', 'save'])
        self.assertEqual(pr.split_clauses(pr.normalize('catch a lapras with surf and ice beam')), ['catch a lapras with surf and ice beam'])
        self.assertEqual(pr.split_clauses(pr.normalize('go to route 1 after you heal')), ['heal', 'go to route 1'])


class RunOnRequests(unittest.TestCase):
    """Dictation adds no commas (laya-nl-20260925 stage 4): an unpunctuated request splits at a verb when every piece is a confident step on its own."""

    def voice(self, text):
        return interpreter().interpret(text, via='voice', context=context())

    def test_unpunctuated_steps_split_at_verbs(self):
        for text, want in [('heal my team go to cinnabar and save', ['heal', 'travel', 'save-game']),
                           ('go to pewter heal and save', ['travel', 'heal', 'save-game']),
                           ('go to celadon buy 10 ultra balls then save', ['travel', 'item', 'save-game']),
                           ('heal up go to fuchsia save the game', ['heal', 'travel', 'save-game']),
                           ('save the game stop the bot', ['save-game', 'bot-stop']),
                           ('buy 10 poke balls catch 3 abra', ['item', 'catch']),
                           ('catch a shiny pikachu go to cinnabar', ['catch', 'travel']),
                           ('get me a shiny mewtwo save the game', ['catch', 'save-game']),
                           ('heal tell me my team', ['heal', 'status-team'])]:
            with self.subTest(text=text):
                r = self.voice(text)
                self.assertTrue(r['understood'], r)
                self.assertEqual([c['intent'] for c in r['clauses'] if c['status'] == 'accepted'], want)
                self.assertEqual(len(r['goal']['steps']), len([i for i in want if not i.startswith('status')]))
        heal = self.voice('heal my team go to cinnabar and save')
        self.assertEqual([s['task']['kind'] for s in heal['goal']['steps']], ['heal', 'travel', 'save'])
        self.assertEqual(heal['goal']['steps'][1]['task']['map'], 'MAP_CINNABAR_ISLAND')
        shop = self.voice('buy 10 poke balls catch 3 abra')
        self.assertEqual([c['slots'].get('quantity') for c in shop['clauses']], [10, 3])
        self.assertEqual(shop['clauses'][1]['slots']['species'], 63)
        self.assertEqual(pr.split_clauses(pr.normalize('heal my team go to cinnabar and save')), ['heal my team', 'go to cinnabar', 'save'])

    def test_an_elided_verb_repeats_its_own_step(self):
        r = self.voice('go to celadon buy 5 rare candies and 10 ultra balls')
        self.assertEqual([c['intent'] for c in r['clauses']], ['travel', 'item', 'item'])
        self.assertEqual([(c['slots'].get('item'), c['slots'].get('quantity')) for c in r['clauses'][1:]], [(68, 5), (2, 10)])

    def test_a_later_step_may_point_back_at_the_catch(self):
        r = self.voice('catch a timid abra ev train it in special attack and speed')
        self.assertTrue(r['understood'], r)
        self.assertEqual([c['intent'] for c in r['clauses']], ['catch', 'ev-training'])
        self.assertEqual(r['clauses'][1]['slots']['evs'], {'spAttack': 252, 'speed': 252})
        self.assertEqual(r['clauses'], self.voice('catch a timid abra then ev train it in special attack and speed')['clauses'])

    def test_one_step_phrasings_stay_whole(self):
        one = {'catch a pikachu and name it sparky': 'catch', 'catch a pikachu name it sparky': 'catch', 'catch a pidgey that knows fly': 'catch',
               'catch a rattata with run away': 'catch', 'catch a bulbasaur train it to level 50': 'catch', 'go catch a shiny articuno': 'catch',
               'get me a shiny pikachu': 'catch', 'start a new game as ash pick squirtle': 'new-game', 'buy 5 full restores': 'item',
               'restore my last save': 'save-restore', 'restore my main save': 'save-restore', 'is my team healed': 'heal',
               'what goals are queued': 'status-goals', 'catch a pikachu teach it thunderbolt': 'teach-move'}
        for text, intent in one.items():
            with self.subTest(text=text):
                r = self.voice(text)
                self.assertEqual([c['intent'] for c in r['clauses']], [intent], r['clauses'])
        self.assertEqual(self.voice('catch a pikachu and name it sparky')['clauses'][0]['slots']['nickname'], 'Sparky')
        self.assertEqual(self.voice('catch a pidgey that knows fly')['clauses'][0]['slots']['moves'], [19])
        abra = self.voice('catch 3 abra and 2 kadabra')
        self.assertEqual([(c['intent'], c['slots']['species'], c['slots']['quantity']) for c in abra['clauses']], [('catch', 63, 3), ('catch', 64, 2)])
        self.assertFalse(self.voice('is my team healed')['understood'], 'a question is never split into a question and a heal')

    def test_a_spoken_take_back_is_never_a_cancel_or_an_extra_step(self):
        """"catch a pikachu cancel that" corrects itself; it is no list (release-1 review). A run-on never splits off a cancel (it cancels
        the goal already running, before this request's steps) or a bare "stop"/"wait", nor after "actually", "wait" or "no"."""
        for text in ['catch a pikachu cancel that', 'catch a pikachu actually cancel', 'go to cinnabar actually cancel that', 'catch a pikachu cancel it',
                     'never mind catch a pikachu', 'nevermind save the game', 'never mind go to cinnabar', 'cancel catch a pikachu',
                     'catch a pikachu wait go to cinnabar', 'catch a pikachu actually go to cinnabar', 'catch a pikachu instead go to cinnabar',
                     'catch a pikachu no go to cinnabar', 'catch a pikachu actually stop', 'go to cinnabar actually stop the bot', 'catch a pikachu stop',
                     'stop catch a pikachu', 'catch a pikachu pause']:
            with self.subTest(text=text):
                self.assertEqual(len(pr.split_clauses(pr.normalize(text))), 1)
                r = self.voice(text)
                self.assertNotIn('cancel-goal', [d['kind'] for d in r['direct']])
                self.assertLessEqual(len((r['goal'] or {}).get('steps', [])), 1, r['summary'])
        for text, want in [('save the game stop the bot', ['save-game', 'bot-stop']), ('stop hunting go to cinnabar', ['bot-stop', 'travel']),
                           ('stop the bot catch a pikachu', ['bot-stop', 'catch'])]:
            with self.subTest(text=text):
                self.assertEqual([c['intent'] for c in self.voice(text)['clauses']], want, 'a stop that names what it stops is a step')

    def test_a_run_on_splits_neither_a_scope_nor_a_question(self):
        """"catch a pikachu new save" is not "catch a pikachu new" + "save"; "should i heal my team go to cinnabar" asks about all of it."""
        r = self.voice('catch a pikachu new save')
        self.assertEqual(len(pr.split_clauses(pr.normalize('catch a pikachu new save'))), 1)
        self.assertNotIn('save-game', [c['intent'] for c in r['clauses'] if c['status'] == 'accepted'])
        text = 'should i heal my team go to cinnabar'
        asked = self.voice(text)
        self.assertEqual(asked['clarification']['slot'], 'question')
        yes = interpreter().interpret(text, via='voice', context=context(), answers={'0:question': asked['clarification']['choices'][0]['id']})
        self.assertEqual(len((yes['goal'] or {}).get('steps', [])), 1, 'a yes queues only what the question named')

    def test_a_destructive_step_in_a_run_on_still_needs_confirmation(self):
        for text, want in [('save the game start a new game as ash', ['save-game', 'new-game']),
                           ('restore my main save go to cinnabar', ['save-restore', 'travel']),
                           ('go to cinnabar trade my shiny charizard', ['travel', 'trade-shiny'])]:
            with self.subTest(text=text):
                r = self.voice(text)
                self.assertEqual([c['intent'] for c in r['clauses']], want)
                self.assertTrue(r['confirmation']['required'], r['confirmation'])


class DictatedPunctuation(unittest.TestCase):
    """Dictation adds punctuation (laya-nl-20260925 stage 7, addsPunctuation): capitals, sentence periods and the
    periods Apple writes inside names read exactly like the plain words, and destructive steps are still confirmed."""

    def steps(self, text):
        r = interpreter().interpret(text, via='voice', context=context())
        return r['understood'], [(c['intent'], c['slots']) for c in r['clauses'] if c['status'] == 'accepted'], r['confirmation']['required']

    def test_apple_punctuation_reads_like_the_plain_words(self):
        for spoken, plain in [('Heal my team. Go to Cinnabar and save.', 'heal my team go to cinnabar and save'),
                              ('Go to Pewter City. Heal. Then save.', 'go to pewter city heal then save'),
                              ('Buy 10 Ultra Balls, then save.', 'buy 10 ultra balls then save'),
                              ('Get me a shiny Mewtwo.', 'get me a shiny mewtwo'),
                              ('Catch a Mr. Mime.', 'catch a mr mime'),
                              ('Go to Mt. Moon.', 'go to mt moon'),
                              ('Go to S.S. Anne.', 'go to ss anne'),
                              ('Buy an Exp. Share.', 'buy an exp share'),
                              ('What level is my Alakazam?', 'what level is my alakazam'),
                              ('Trade my Kadabra.', 'trade my kadabra')]:
            with self.subTest(spoken=spoken):
                got, want = self.steps(spoken), self.steps(plain)
                self.assertTrue(want[0] and want[1], want)
                self.assertEqual(got, want)
        self.assertEqual(self.steps('Buy an Exp. Share.')[1], [('item', self.steps('buy an exp share')[1][0][1])])
        self.assertTrue(self.steps('Trade my Kadabra.')[2], 'a trade is confirmed however it was punctuated')

    def test_a_cancel_said_with_anything_else_is_confirmed_as_the_running_goals(self):
        """"Catch a Pikachu. Cancel that.": the cancel stops the goal already running or queued, before this request's steps start, so the
        owner is told and confirms (release-1 review). A cancel said alone is unchanged."""
        for text in ['Catch a Pikachu. Cancel that.', 'Never mind, catch a Pikachu.', 'catch a pikachu and cancel the mewtwo hunt',
                     "What's my team? Never mind."]:
            with self.subTest(text=text):
                r = interpreter().interpret(text, via='voice', context=context())
                self.assertTrue(r['understood'], r)
                self.assertIn('cancel-goal', [d['kind'] for d in r['direct']])
                self.assertTrue(r['confirmation']['required'])
                self.assertTrue(any('already running or queued' in reason for reason in r['confirmation']['reasons']), r['confirmation'])
        for text in ('cancel that goal', 'never mind the mewtwo', 'Cancel the current goal.'):
            with self.subTest(text=text):
                self.assertFalse(interpreter().interpret(text, via='voice', context=context())['confirmation']['required'])


class DraftsAndCommit(unittest.TestCase):
    class Goals:
        """The G2 GoalSupervisor surface used by commit: submit/goals/cancel."""
        def __init__(self):
            self.created = []

        def submit(self, goal):
            self.created.append(goal)
            return {**goal, 'id': 'goal-%d' % len(self.created), 'status': 'queued'}

    class Server:
        pass

    def service(self, goals=True):
        server = self.Server()
        if goals:
            server.goals = self.Goals()
        return pr.RequestService(server, interpreter=pr.Interpreter(), context_provider=lambda: context()), server

    def test_commit_forwards_the_draft_to_the_goal_supervisor(self):
        service, server = self.service()
        draft = service.interpret({'text': 'get me a shiny mewtwo', 'via': 'voice'})
        self.assertTrue(draft['draftId'])
        result = service.commit({'draftId': draft['draftId'], 'idempotencyKey': 'key-12345678'})
        self.assertEqual(result['goal']['status'], 'queued')
        sent = server.goals.created[0]
        self.assertEqual(sent['idempotencyKey'], 'key-12345678')
        self.assertEqual(sent['source']['via'], 'voice')
        self.assertEqual(sent['steps'][0]['request']['speciesId'], 150)
        self.assertNotIn('status', sent, 'the supervisor assigns status and identity')
        # The same idempotency key is not submitted twice.
        again = service.commit({'draftId': draft['draftId'], 'idempotencyKey': 'key-12345678'})
        self.assertEqual(len(server.goals.created), 1)
        self.assertEqual(again['goal']['id'], result['goal']['id'])

    def test_destructive_draft_needs_confirm_answer(self):
        service, server = self.service()
        draft = service.interpret({'text': 'trade my shiny charizard', 'via': 'typed'})
        with self.assertRaisesRegex(pr.RequestError, 'confirm'):
            service.commit({'draftId': draft['draftId'], 'idempotencyKey': 'key-trade-0001'})
        self.assertEqual(server.goals.created, [])
        service.commit({'draftId': draft['draftId'], 'idempotencyKey': 'key-trade-0001', 'answers': {'confirm': 'yes'}})
        self.assertEqual(server.goals.created[0]['steps'][0]['via'], 'trade-shiny')

    def test_missing_supervisor_is_a_clear_error(self):
        service, _ = self.service(goals=False)
        draft = service.interpret({'text': 'heal', 'via': 'typed'})
        with self.assertRaisesRegex(pr.RequestError, 'goal supervisor unavailable') as caught:
            service.commit({'draftId': draft['draftId'], 'idempotencyKey': 'key-heal-0001'})
        self.assertEqual(caught.exception.status, 503)

    def test_commit_validation(self):
        service, _ = self.service()
        with self.assertRaisesRegex(pr.RequestError, 'idempotency'):
            service.commit({'draftId': 'x', 'idempotencyKey': 'bad key'})
        with self.assertRaisesRegex(pr.RequestError, 'draft'):
            service.commit({'draftId': 'missing-draft', 'idempotencyKey': 'key-12345678'})
        with self.assertRaisesRegex(pr.RequestError, 'Nothing to run'):
            draft = service.interpret({'text': "what's my team", 'via': 'typed'})
            service.commit({'draftId': draft['draftId'], 'idempotencyKey': 'key-status-01'})
        stuck = pr.RequestService(self.Server(), interpreter=pr.Interpreter(preview=lambda request: {'canStart': False, 'limitations': ['No route.']}),
                                  context_provider=lambda: context())
        with self.assertRaisesRegex(pr.RequestError, 'Nothing to run'):
            draft = stuck.interpret({'text': 'catch a lapras', 'via': 'typed'})
            stuck.commit({'draftId': draft['draftId'], 'idempotencyKey': 'key-stuck-01', 'answers': {'confirm': 'yes'}})
        for text in ('is there a shiny mewtwo', "don't catch a pikachu"):
            with self.assertRaisesRegex(pr.RequestError, 'understood|clarif'):
                draft = service.interpret({'text': text, 'via': 'voice'})
                service.commit({'draftId': draft['draftId'], 'idempotencyKey': 'key-idle-0001', 'answers': {'confirm': 'yes'}})
        with self.assertRaisesRegex(pr.RequestError, 'understood|clarif'):
            draft = service.interpret({'text': 'catch a mewt', 'via': 'typed'})
            service.commit({'draftId': draft['draftId'], 'idempotencyKey': 'key-mewt-0001'})
        # Answers given at commit resolve the pending clarification.
        draft = service.interpret({'text': 'catch a mewt', 'via': 'typed'})
        result = service.commit({'draftId': draft['draftId'], 'idempotencyKey': 'key-mewt-0002', 'answers': {draft['clarification']['id']: '150'}})
        self.assertEqual(result['goal']['steps'][0]['request']['speciesId'], 150)
        # A client-supplied goal must be Goal v1.
        with self.assertRaisesRegex(pr.RequestError, 'Goal v1'):
            service.commit({'goal': {'schema': 'other'}, 'idempotencyKey': 'key-goal-0001'})

    def test_interpret_payload_validation_and_draft_expiry(self):
        service, _ = self.service()
        with self.assertRaisesRegex(pr.RequestError, 'text'):
            service.interpret({'via': 'typed'})
        with self.assertRaisesRegex(pr.RequestError, 'via'):
            service.interpret({'text': 'heal', 'via': 'telepathy'})
        with self.assertRaisesRegex(pr.RequestError, 'long'):
            service.interpret({'text': 'heal ' * 400, 'via': 'typed'})
        clock = [1000.0]
        store = pr.DraftStore(ttl=60, clock=lambda: clock[0])
        draft_id = store.put({'goal': {'id': 'g'}})
        self.assertEqual(store.get(draft_id)['goal']['id'], 'g')
        clock[0] += 61
        self.assertIsNone(store.get(draft_id))

    def test_cancel_goes_to_the_supervisor_cancel(self):
        cancelled = []

        class Goals(self.Goals):
            def goals(self):
                return {'goals': [{'id': 'old', 'status': 'done', 'createdAt': '2026-09-23T10:00:00Z', 'steps': []},
                                  {'id': 'g-mewtwo', 'status': 'running', 'createdAt': '2026-09-23T11:00:00Z', 'steps': [{'kind': 'farming', 'request': {'speciesId': 150}}]},
                                  {'id': 'g-heal', 'status': 'queued', 'createdAt': '2026-09-23T12:00:00Z', 'steps': [{'kind': 'player-task', 'action': 'start', 'task': {'kind': 'heal'}}]}]}

            def cancel(self, goal_id):
                cancelled.append(goal_id)
                return {'id': goal_id, 'status': 'cancelled'}

        server = self.Server()
        server.goals = Goals()
        service = pr.RequestService(server, interpreter=pr.Interpreter(), context_provider=lambda: context())
        draft = service.interpret({'text': 'never mind the mewtwo', 'via': 'voice'})
        self.assertTrue(draft['understood'], draft)
        self.assertEqual(draft['direct'], [{'kind': 'cancel-goal', 'speciesId': 150}])
        result = service.commit({'draftId': draft['draftId'], 'idempotencyKey': 'key-cancel-01'})
        self.assertEqual(cancelled, ['g-mewtwo'])
        self.assertEqual(result['applied'][0]['goal']['status'], 'cancelled')
        latest = service.interpret({'text': 'cancel that goal', 'via': 'typed'})
        service.commit({'draftId': latest['draftId'], 'idempotencyKey': 'key-cancel-02'})
        self.assertEqual(cancelled[-1], 'g-heal', 'without a target the newest active goal is cancelled')

    def test_request_log_is_opt_in(self):
        with tempfile.TemporaryDirectory() as folder:
            server = self.Server()
            server.directory = Path(folder)
            quiet = pr.RequestService(server, interpreter=pr.Interpreter(), context_provider=lambda: context())
            quiet.interpret({'text': 'heal', 'via': 'typed'})
            self.assertFalse((Path(folder) / 'requests').exists())
            (Path(folder) / 'request-interpreter.json').write_text(json.dumps({'log': True}))
            logged = pr.RequestService(server, interpreter=pr.Interpreter(), context_provider=lambda: context())
            logged.interpret({'text': 'heal then save', 'via': 'voice'})
            entries = [json.loads(line) for line in (Path(folder) / 'requests' / 'requests.ndjson').read_text().splitlines()]
            self.assertEqual(entries[0]['text'], 'heal then save')
            self.assertEqual(entries[0]['intents'], ['heal', 'save-game'])
            self.assertEqual(entries[0]['via'], 'voice')

    def test_service_is_created_once_per_server(self):
        server = self.Server()
        first = pr.service(server)
        self.assertIs(pr.service(server), first)
        self.assertIsNone(first.interpreter.classifier, 'no Laya configuration -> deterministic only')

    def test_settings_commit_writes_through_existing_bot_settings_contract(self):
        written = []

        class Sessions:
            def bot_settings(self, game):
                return {'preferences': copy.deepcopy(CONTEXT['botSettings'])}

            def save_bot_settings(self, game, value):
                written.append((game, value))
                return {'preferences': value}

        server = self.Server()
        server.pokemon_sessions = Sessions()
        service = pr.RequestService(server, interpreter=pr.Interpreter(), context_provider=lambda: context())
        draft = service.interpret({'text': 'always use great balls', 'via': 'typed'})
        service.commit({'draftId': draft['draftId'], 'idempotencyKey': 'key-settings-1'})
        game, value = written[0]
        self.assertEqual(game, 'firered')
        self.assertEqual(value['ball'], {'id': 'great-ball', 'requirement': 'required'})
        self.assertEqual(value['limits'], CONTEXT['botSettings']['limits'])


class RequestOutcomeLog(unittest.TestCase):
    """requests.ndjson is learnable: each interpret row carries its draftId, and the draft's outcome is appended as an event row."""
    class Supervisor(DraftsAndCommit.Goals):
        def __init__(self):
            super().__init__()
            self.listeners = []

        def on_finish(self, listener):
            self.listeners.append(listener)

    def setUp(self):
        folder = tempfile.TemporaryDirectory()
        self.addCleanup(folder.cleanup)
        self.folder = Path(folder.name)
        (self.folder / 'request-interpreter.json').write_text(json.dumps({'log': True}))
        self.clock = [1000.0]

    def service(self, goals=None, **store):
        server = DraftsAndCommit.Server()
        server.directory = self.folder
        server.goals = goals or DraftsAndCommit.Goals()
        drafts = pr.DraftStore(clock=lambda: self.clock[0], **store)
        return pr.RequestService(server, interpreter=pr.Interpreter(), context_provider=lambda: context(), drafts=drafts), server

    def ask(self, service, text, answers=None, client='', after=0):
        self.clock[0] += after
        return service.interpret({'text': text, 'via': 'typed', **({'answers': answers} if answers else {})}, client=client)

    def rows(self, event=None):
        rows = [json.loads(line) for line in (self.folder / 'requests' / 'requests.ndjson').read_text().splitlines()]
        return rows if event is None else [{k: v for k, v in r.items() if k != 'at'} for r in rows if r.get('event') == event]

    def test_interpret_rows_carry_the_draft_id_and_the_commit_is_appended(self):
        service, server = self.service()
        draft = self.ask(service, 'get me a shiny mewtwo', client='Mozilla/5.0 (Macintosh) Safari')
        [row] = self.rows()
        self.assertEqual(row['draftId'], draft['draftId'])
        self.assertNotIn('event', row, 'interpret rows keep their shape')
        self.assertEqual(len(row['client']), 8)
        self.assertNotIn('Mozilla', json.dumps(row), 'the client is a short local hash, never its user agent')
        self.clock[0] += 5
        out = service.commit({'draftId': draft['draftId'], 'idempotencyKey': 'key-log-0001'})
        self.assertEqual(self.rows('committed'), [{'event': 'committed', 'draftId': draft['draftId'], 'afterSeconds': 5.0, 'goalId': out['goal']['id'],
                                                   'applied': [], 'intents': ['catch'], 'confirmed': False}])
        self.assertEqual(server.goals.created[0]['source']['draftId'], draft['draftId'], 'the goal carries its draft, so its final status joins the row')
        service.commit({'draftId': draft['draftId'], 'idempotencyKey': 'key-log-0001'})
        self.assertEqual(len(self.rows('committed')), 1, 'an idempotent retry is not a second outcome')
        self.assertTrue(all('text' not in r for r in self.rows() if 'event' in r), 'outcome rows never repeat the transcript')

    def test_cancel_drops_the_draft_and_a_refused_commit_is_logged(self):
        service, server = self.service()
        draft = self.ask(service, 'trade my shiny charizard')
        with self.assertRaisesRegex(pr.RequestError, 'confirm'):
            service.commit({'draftId': draft['draftId'], 'idempotencyKey': 'key-log-0002'})
        self.assertEqual([(r['draftId'], r['status']) for r in self.rows('commit-refused')], [(draft['draftId'], 409)])
        self.clock[0] += 4
        self.assertEqual(service.cancel({'draftId': draft['draftId']}), {'cancelled': True})
        self.assertEqual(service.cancel({'draftId': draft['draftId']}), {'cancelled': False})
        self.assertEqual(self.rows('cancelled'), [{'event': 'cancelled', 'draftId': draft['draftId'], 'afterSeconds': 4.0}])
        with self.assertRaises(pr.RequestError) as caught:
            service.commit({'draftId': draft['draftId'], 'idempotencyKey': 'key-log-0003', 'answers': {'confirm': 'yes'}})
        self.assertEqual(caught.exception.status, 404)
        self.assertEqual(server.goals.created, [], 'a cancelled draft can no longer run')
        for bad in ({}, {'draftId': 5}, {'draftId': draft['draftId'], 'idempotencyKey': 'key-log-0004'}, None):
            with self.assertRaises(pr.RequestError):
                service.cancel(bad)
        committed = self.ask(service, 'heal')
        service.commit({'draftId': committed['draftId'], 'idempotencyKey': 'key-log-0005'})
        self.assertEqual(service.cancel({'draftId': committed['draftId']}), {'cancelled': False}, 'a committed draft is not cancelled afterwards')
        self.assertEqual(len(self.rows('cancelled')), 1)

    def test_the_clarification_choice_is_logged_from_either_round(self):
        service, _ = self.service()
        first = self.ask(service, 'catch a mewt')
        self.assertEqual(first['clarification']['id'], '0:species')
        second = self.ask(service, 'catch a mewt', answers={'0:species': '150'}, after=3)
        self.assertEqual(self.rows('clarified'), [{'event': 'clarified', 'draftId': first['draftId'], 'afterSeconds': 3.0, 'next': second['draftId'],
                                                   'slot': 'species', 'choice': '150', 'label': 'Mewtwo'}])
        [answered] = [r for r in self.rows() if 'event' not in r and r['draftId'] == second['draftId']]
        self.assertEqual(answered['answers'], {'0:species': '150'}, 'the answered round is its own interpret row')
        # Answered with the commit instead (the commit re-interprets).
        third = self.ask(service, 'catch a mewt', client='other')
        service.commit({'draftId': third['draftId'], 'idempotencyKey': 'key-log-0006', 'answers': {'0:species': '151'}})
        clarified = self.rows('clarified')[-1]
        self.assertEqual((clarified['draftId'], clarified['choice'], clarified['label']), (third['draftId'], '151', 'Mew'))
        self.assertNotIn('next', clarified)
        self.assertEqual(self.rows('committed')[-1]['answers'], {'0:species': '151'})
        self.assertEqual(self.rows('rephrased') + self.rows('superseded'), [])

    def test_a_rephrase_is_a_new_request_from_the_same_client_within_60_seconds(self):
        service, _ = self.service()
        sandwich = self.ask(service, 'make me a sandwich', client='web')
        heal = self.ask(service, 'heal my team', client='web', after=20)
        self.assertEqual(self.rows('rephrased'), [{'event': 'rephrased', 'draftId': sandwich['draftId'], 'afterSeconds': 20.0, 'next': heal['draftId']}])
        self.ask(service, 'save the game', client='mac', after=5)  # another client: not this owner's rephrase
        later = self.ask(service, 'go to cinnabar', client='web', after=90)
        self.assertEqual(self.rows('superseded'), [{'event': 'superseded', 'draftId': heal['draftId'], 'afterSeconds': 95.0, 'next': later['draftId']}])
        self.assertEqual(len(self.rows('rephrased')), 1)
        # An answered question needs nothing more, so the next request is not its rephrase.
        self.ask(service, "what's my team", client='ios')
        self.ask(service, 'heal', client='ios', after=10)
        # Picking an offered suggestion is flagged.
        nonsense = self.ask(service, 'make me a sandwich', client='phone')
        picked = self.ask(service, nonsense['suggestions'][1], client='phone', after=2)
        self.assertEqual(self.rows('rephrased')[-1], {'event': 'rephrased', 'draftId': nonsense['draftId'], 'afterSeconds': 2.0, 'next': picked['draftId'], 'suggestion': True})
        self.assertEqual((len(self.rows('rephrased')), len(self.rows('superseded'))), (2, 1))

    def test_unresolved_drafts_are_logged_when_they_expire_are_evicted_or_the_host_stops(self):
        service, _ = self.service()
        stale = self.ask(service, 'heal', client='a')
        self.ask(service, "what's my team", client='b')  # answered: never an expiry outcome
        self.clock[0] += 15 * 60 + 1
        fresh = self.ask(service, 'save the game', client='c')
        self.assertEqual(self.rows('expired'), [{'event': 'expired', 'draftId': stale['draftId'], 'afterSeconds': 901.0, 'reason': 'ttl'}])
        service.close()
        self.assertEqual(self.rows('expired')[-1], {'event': 'expired', 'draftId': fresh['draftId'], 'afterSeconds': 0.0, 'reason': 'shutdown'})
        small, _ = self.service(limit=1)
        first = self.ask(small, 'heal', client='x')
        self.ask(small, 'save the game', client='y')
        self.assertEqual(self.rows('expired')[-1], {'event': 'expired', 'draftId': first['draftId'], 'afterSeconds': 0.0, 'reason': 'evicted'})
        self.assertEqual(len(self.rows('expired')), 3)

    def test_the_goal_final_status_is_appended_for_request_goals(self):
        supervisor = self.Supervisor()
        service, _ = self.service(goals=supervisor)
        self.assertEqual(len(supervisor.listeners), 1)
        draft = self.ask(service, 'get me a shiny mewtwo')
        out = service.commit({'draftId': draft['draftId'], 'idempotencyKey': 'key-log-0007'})
        finished = {**supervisor.created[0], 'id': out['goal']['id'], 'status': 'done', 'result': {'summary': 'Caught and saved a shiny Mewtwo.', 'step': 0}}
        supervisor.listeners[0](finished)
        self.assertEqual(self.rows('goal'), [{'event': 'goal', 'draftId': draft['draftId'], 'goalId': out['goal']['id'], 'status': 'done',
                                              'summary': 'Caught and saved a shiny Mewtwo.'}])
        supervisor.listeners[0]({'id': 'posted-goal', 'status': 'failed', 'source': {'text': 'x', 'via': 'ui', 'interpreter': None}})
        self.assertEqual(len(self.rows('goal')), 1, 'a goal posted without a draft is not a request outcome')
        quiet = self.Supervisor()
        server = DraftsAndCommit.Server()
        server.goals = quiet
        pr.RequestService(server, interpreter=pr.Interpreter(), context_provider=lambda: context())
        self.assertEqual(quiet.listeners, [], 'no log, no listener')

    def test_outcome_rows_share_the_log_rotation(self):
        log = self.folder / 'requests' / 'requests.ndjson'
        log.parent.mkdir()
        log.write_text('x' * (5 * 1024 * 1024 + 1))
        service, _ = self.service()
        draft = self.ask(service, 'heal')
        self.assertEqual(log.with_suffix('.ndjson.1').stat().st_size, 5 * 1024 * 1024 + 1)
        log.write_text(log.read_text() + 'y' * (5 * 1024 * 1024))
        service.cancel({'draftId': draft['draftId']})
        self.assertEqual([r.get('event') for r in self.rows()], ['cancelled'], 'an outcome row rotates the log like an interpret row')


class FakeAgent:
    def __init__(self, picks=None, noul=0.9):
        self.calls = []
        self.picks = picks or {}
        self.noul = noul

    def predict(self, state, questions):
        self.calls.append((state, questions))
        answers = {}
        for qid, q in questions.items():
            if q['type'] == 'choice':
                keys = list(q['criteria'])
                assert len(keys) <= 50, 'Laya choice questions stay within 50 options'
                pick = self.picks.get(qid, keys[0])
                answers[qid] = {'type': 'choice', 'choice': pick, 'probabilities': {k: (0.9 if k == pick else 0.1 / max(1, len(keys) - 1)) for k in keys}, 'confidence': 0.8}
            else:
                answers[qid] = {'type': 'noul', 'noul': self.noul, 'confidence': max(self.noul, 1 - self.noul)}
        return {'answers': answers}


class LayaAdapter(unittest.TestCase):
    def test_fake_agent_choice_noul_and_entity_tiebreak(self):
        agent = FakeAgent(picks={'intent': 'travel', 'entity': '150'})
        laya = pr.LayaClassifier(agent_factory=lambda: agent)
        self.assertTrue(laya.available())
        options = {intent.id: intent.description for intent in pr.CATALOG}
        self.assertGreater(len(options), 20)
        pick = laya.classify_intent('go to cinnabar', options)
        self.assertEqual(pick['choice'], 'travel')
        self.assertGreater(pick['confidence'], 0)
        self.assertEqual(laya.choose_entity('catch a mewt', 'species', [{'id': '151', 'label': 'Mew'}, {'id': '150', 'label': 'Mewtwo'}])['choice'], '150')
        self.assertAlmostEqual(laya.actionable('make me a sandwich'), 0.9)
        self.assertAlmostEqual(laya.yes_no('yes please', 'Start a new save?'), 0.9)

    def test_more_than_fifty_options_use_two_stages(self):
        agent = FakeAgent()
        laya = pr.LayaClassifier(agent_factory=lambda: agent)
        options = {f'intent-{i}': f'Option {i}' for i in range(120)}
        laya.classify_intent('something', options)
        self.assertTrue(all(len(q['criteria']) <= 50 for _, questions in agent.calls for q in questions.values() if q['type'] == 'choice'))

    def test_interpreter_uses_laya_for_intent_when_available(self):
        agent = FakeAgent(picks={'intent': 'heal'})
        r = interpreter(classifier=pr.LayaClassifier(agent_factory=lambda: agent)).interpret('heal up', context=context())
        self.assertTrue(r['understood'], r)
        self.assertEqual(r['parser'], 'laya')
        self.assertEqual(r['goal']['source']['interpreter']['parser'], 'laya')
        self.assertTrue(agent.calls)

    def test_laya_cannot_accept_a_phrase_the_code_layer_rejects(self):
        agent = FakeAgent(picks={'intent': 'travel'}, noul=0.99)
        r = interpreter(classifier=pr.LayaClassifier(agent_factory=lambda: agent)).interpret('make me a sandwich', context=context())
        self.assertFalse(r['understood'])

    def test_missing_package_or_weights_fall_back_to_deterministic(self):
        def missing():
            raise ImportError('No module named laya')

        laya = pr.LayaClassifier(agent_factory=missing)
        self.assertFalse(laya.available())
        self.assertIn('laya', laya.reason.lower())
        r = interpreter(classifier=laya).interpret('heal', context=context())
        self.assertTrue(r['understood'])
        self.assertEqual(r['parser'], 'deterministic')
        absent = pr.LayaClassifier.from_config({'laya': {'model': '/nonexistent/laya-model'}})
        self.assertFalse(absent.available())
        self.assertIsNone(pr.LayaClassifier.from_config({}))

    def test_pinned_model_hashes_are_verified_before_loading(self):
        with tempfile.TemporaryDirectory() as folder:
            model = Path(folder)
            (model / 'model.safetensors').write_bytes(b'weights')
            (model / 'tokenizer').mkdir()
            (model / 'tokenizer' / 'tokenizer.json').write_bytes(b'{}')
            good = {'model.safetensors': hashlib.sha256(b'weights').hexdigest(), 'tokenizer/tokenizer.json': hashlib.sha256(b'{}').hexdigest()}
            loaded = []
            ok = pr.LayaClassifier(model=str(model), files=good, agent_factory=lambda: loaded.append(1) or FakeAgent())
            self.assertTrue(ok.available(), ok.reason)
            self.assertEqual(loaded, [1])
            bad = pr.LayaClassifier(model=str(model), files={**good, 'model.safetensors': '0' * 64}, agent_factory=lambda: loaded.append(2) or FakeAgent())
            self.assertFalse(bad.available())
            self.assertIn('sha256', bad.reason)
            self.assertEqual(loaded, [1], 'a mismatched model is never loaded')
            unpinned = pr.LayaClassifier(model=str(model), files={}, agent_factory=lambda: FakeAgent())
            self.assertFalse(unpinned.available())
            self.assertIn('pinned', unpinned.reason)
            config = pr.LayaClassifier.from_config({'laya': {'model': str(model), 'files': good, 'device': 'cpu'}})
            self.assertEqual(config.device, 'cpu')
            self.assertEqual(config.files, good)

    def test_pins_follow_huggingface_snapshot_symlinks(self):
        with tempfile.TemporaryDirectory() as folder:
            blobs = Path(folder) / 'blobs'
            blobs.mkdir()
            (blobs / 'abc').write_bytes(b'weights')
            snapshot = Path(folder) / 'snapshots' / 'rev'
            snapshot.mkdir(parents=True)
            (snapshot / 'model.safetensors').symlink_to(Path('../../blobs/abc'))
            pins = {'model.safetensors': hashlib.sha256(b'weights').hexdigest()}
            laya = pr.LayaClassifier(model=str(snapshot), files=pins, agent_factory=lambda: FakeAgent())
            self.assertTrue(laya.available(), laya.reason)
            escape = pr.LayaClassifier(model=str(snapshot), files={'../../blobs/abc': pins['model.safetensors']}, agent_factory=lambda: FakeAgent())
            self.assertFalse(escape.available(), 'pins name files inside the model directory')

    def test_catalog_entries_are_complete(self):
        ids = [entry.id for entry in pr.CATALOG]
        self.assertEqual(len(ids), len(set(ids)))
        self.assertLessEqual(len(ids), 50)
        for entry in pr.CATALOG:
            with self.subTest(entry=entry.id):
                self.assertTrue(entry.description)
                self.assertGreaterEqual(len(entry.examples), 2)
                self.assertIsInstance(entry.slots, dict)
                self.assertTrue(callable(entry.build) or entry.kind in {'status', 'unsupported', 'help'})
        for family in ['catch', 'travel', 'item', 'heal', 'save-game', 'ev-training', 'bot-start', 'bot-resume', 'bot-stop', 'game-stop',
                       'new-game', 'save-new', 'save-restore', 'trade-shiny', 'trade-pokemon', 'settings', 'postgame', 'collection',
                       'status-team', 'status-hunt', 'status-location', 'status-progress', 'status-shinies', 'help']:
            self.assertIn(family, ids)


if __name__ == '__main__':
    unittest.main()


class OwnedPokemonIsNotACatch(unittest.TestCase):
    """blind5 (scored once, then retired) found three runnable misreads: an evolution stone used on 'my' Pokémon and a
    nickname for 'my' Pokémon read as catching that species, and a question about other players read as a status request."""

    def test_an_evolution_stone_on_an_owned_pokemon_is_the_unsupported_evolve(self):
        for text in ['use a moon stone on my clefairy', 'please use the fire stone on my vulpix', 'give a leaf stone to my gloom']:
            r = ask(text)
            self.assertFalse(r['understood'], text)
            self.assertEqual(r.get('unsupported'), 'evolve', text)
        self.assertTrue(ask('buy a thunder stone')['understood'], 'buying a stone is still an item request')

    def test_a_nickname_for_an_owned_pokemon_is_the_unsupported_rename(self):
        for text in ['give my dragonite a nickname', 'nickname my snorlax', 'name my pikachu sparky', 'give my gengar a new nickname']:
            r = ask(text)
            self.assertFalse(r['understood'], text)
            self.assertEqual(r.get('unsupported'), 'rename', text)
        for text in ['catch a pikachu named sparky', 'catch a pikachu and name it sparky']:
            r = ask(text)
            self.assertTrue(r['understood'], text)
            self.assertEqual(request_of(r)['nickname'].lower(), 'sparky', text)

    def test_a_question_about_other_players_is_not_a_request(self):
        for text in ['does anyone even use master balls on zubats', 'do people really bother catching magikarp', 'has anybody beaten the league with a caterpie']:
            r = ask(text)
            self.assertFalse(r['understood'], text)
            self.assertFalse(r.get('goal'), text)
