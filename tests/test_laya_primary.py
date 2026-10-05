"""Laya primary, deterministic code as the fallback (owner decision, Sept 25 2026).

Written before the implementation (fail-first). With a reviewed asset whose calibration
has a primary rule, a clause takes Laya's intent when Laya is confident (calibrated
intent probability >= primary AND "is this a request" probability >= primary_actionable),
even when the code layer scored it low or rejected it. Everything else is unchanged:
entities and slots come from the code layer, builders / validators / the farming preview
decide feasibility, missing or ambiguous slots are asked about, destructive steps are
always confirmed, and an unsure, missing, loading, slow or failing Laya leaves exactly the
deterministic decision. Modes "off" and "shadow" never change a decision.
"""
import copy
import hashlib
import json
import sys
import tempfile
import time
import unittest
from pathlib import Path

from pokemon_suite import laya_runtime as lr
from pokemon_suite import pokemon_requests as pr

from test_laya_runtime import FAKE_SIDECAR, SAMPLE, build_asset, context, det_result, deterministic, stable

DATA = Path(__file__).resolve().parent / 'data'
ROWS = [json.loads(line) for line in (DATA / 'request-phrasings.jsonl').read_text().splitlines() if line.strip()]
BLIND = [r for r in (json.loads(line) for line in (DATA / 'request-phrasings-blind.jsonl').read_text().splitlines() if line.strip()) if r['split'] != 'blind2-b']
FINE_TUNED = 'laya-ml-ft-l06-0762007a-onnx-q8'
DESTRUCTIVE = ('new-game', 'save-new', 'save-restore', 'trade-shiny', 'trade-pokemon')

# Laya primary at 0.9 / 0.9, no temperature (the fake's probabilities are used as they are).
PRIMARY = pr.LayaCalibration(intent_temperature=1.0, weight=0.0, switch_margin=0.0, promote=None, reject=None,
                             entity_temperature=1.0, entity_threshold=0.9, primary=0.9, primary_actionable=0.9)


class Scripted:
    """A fake Laya. script: clause text -> (intent, P(intent), P(actionable)); `default` for other texts.
    Entity questions get a uniform (unsure) answer unless entity_p is given."""

    def __init__(self, script=None, default=(None, 0.0, 0.0), entity_p=None, error=None):
        self.script, self.default, self.entity_p, self.error = dict(script or {}), default, entity_p, error
        self.asked = []

    def predict(self, state, questions):
        if self.error is not None:
            raise self.error
        text = state['request']
        intent, p, act = self.script.get(text, self.default)
        answers = {}
        for qid, q in questions.items():
            self.asked.append((text, qid))
            keys = list(q['criteria'])
            if qid == 'intent':
                pick = intent if intent in keys else keys[0]
                rest = (1.0 - p) / max(1, len(keys) - 1)
                probs = {k: (p if k == pick else rest) for k in keys}
            elif qid == 'actionable':
                probs = {'A': act, 'B': 1.0 - act}
            else:
                probs = {k: (self.entity_p if k == keys[0] else (1.0 - self.entity_p) / max(1, len(keys) - 1)) for k in keys} \
                    if self.entity_p is not None else {k: 1.0 / len(keys) for k in keys}
            best = max(probs, key=probs.get)
            answers[qid] = {'type': 'choice', 'choice': best, 'probabilities': probs, 'confidence': probs[best]}
        return {'answers': answers}


def primary(agent, calibration=PRIMARY, mode='on', **extra):
    return pr.Interpreter(classifier=pr.LayaClassifier(agent_factory=lambda: agent, calibration=calibration, mode=mode, asset_id='test'), **extra)


def intents(result):
    return [c['intent'] for c in result['clauses'] if c['status'] == 'accepted']


class LayaPrimary(unittest.TestCase):
    def test_a_confident_laya_accepts_a_clause_the_code_layer_rejected(self):
        for text, intent, kind in [('the gang looks exhausted', 'heal', 'player-task'),
                                   ('a pikachu would be sweet ngl', 'catch', 'farming')]:
            with self.subTest(text=text):
                self.assertFalse(deterministic(text)['understood'], 'precondition: the code layer rejects it')
                result = primary(Scripted({text: (intent, 0.97, 0.95)})).interpret(text, context=context())
                self.assertTrue(result['understood'], result['message'])
                self.assertEqual(intents(result), [intent])
                self.assertEqual(result['goal']['steps'][0]['kind'], kind)
                self.assertEqual(result['parser'], 'laya')
                decided = result['laya']['primary']
                self.assertEqual([(d['clause'], d['intent']) for d in decided], [(0, intent)])
        catch = primary(Scripted({'a pikachu would be sweet ngl': ('catch', 0.97, 0.95)})).interpret('a pikachu would be sweet ngl', context=context())
        self.assertEqual(catch['goal']['steps'][0]['request']['speciesId'], 25, 'slots come from the code entity layer')

    def test_a_confident_laya_decides_even_where_the_code_layer_accepted_something_else(self):
        result = primary(Scripted({'go to cinnabar': ('heal', 0.99, 0.99)})).interpret('go to cinnabar', context=context())
        self.assertEqual(intents(result), ['heal'])

    def test_laya_reads_each_piece_of_an_unpunctuated_run_on(self):
        """The code layer splits dictation's missing commas before Laya reads a clause (laya-nl-20260925 stage 4)."""
        text = 'heal my team go to cinnabar and save'
        agent = Scripted({'heal my team': ('heal', 0.99, 0.99), 'go to cinnabar': ('travel', 0.99, 0.99), 'save': ('save-game', 0.99, 0.99)})
        result = primary(agent).interpret(text, context=context())
        self.assertEqual(intents(result), ['heal', 'travel', 'save-game'])
        self.assertEqual({t for t, q in agent.asked if q == 'intent'}, {'heal my team', 'go to cinnabar', 'save'})
        self.assertEqual(stable(result), stable(deterministic(text)), 'agreement changes nothing')
        self.assertEqual(stable(primary(Scripted()).interpret(text, context=context())), stable(deterministic(text)))

    def test_agreement_changes_nothing_and_skips_the_actionable_question(self):
        agent = Scripted({'heal up': ('heal', 0.99, 0.99)})
        result = primary(agent).interpret('heal up', context=context())
        self.assertEqual(stable(result), stable(deterministic('heal up')))
        self.assertNotIn(('heal up', 'actionable'), agent.asked)

    def test_an_unsure_laya_leaves_the_deterministic_decision(self):
        texts = SAMPLE + ['the gang looks exhausted', 'go to cinnabar', 'a pikachu would be sweet ngl']
        for label, answer in [('low intent probability', ('heal', 0.6, 0.99)), ('low actionable probability', ('heal', 0.99, 0.5)),
                              ('nothing', (None, 0.0, 0.0))]:
            interp = primary(Scripted(default=answer))
            for text in texts:
                with self.subTest(case=label, text=text):
                    self.assertEqual(stable(interp.interpret(text, context=context())), stable(deterministic(text)))

    def test_an_unavailable_loading_slow_or_failing_laya_falls_back_silently(self):
        texts = SAMPLE + ['the gang looks exhausted']
        for error in (lr.LayaUnavailable('not installed'), lr.LayaWarmingUp('loading'), lr.LayaTimeout('too slow'), RuntimeError('model exploded')):
            interp = primary(Scripted(default=('heal', 0.99, 0.99), error=error))
            for text in texts:
                with self.subTest(error=type(error).__name__, text=text):
                    result = interp.interpret(text, context=context())
                    self.assertEqual(stable(result), stable(deterministic(text)))
                    self.assertNotIn('Laya', result['message'])
                    self.assertTrue(result['laya']['skipped'])

    def test_a_missing_asset_or_an_asset_without_calibration_stays_deterministic(self):
        missing = pr.LayaClassifier.from_config({'laya': {'asset': '/nonexistent/laya-asset', 'mode': 'on'}})
        uncalibrated = pr.LayaClassifier(agent_factory=lambda: Scripted(default=('heal', 0.99, 0.99)), calibration=None, mode='on')
        for classifier in (missing, uncalibrated):
            interp = pr.Interpreter(classifier=classifier)
            for text in ('the gang looks exhausted', 'heal up', 'make me a sandwich'):
                with self.subTest(classifier=classifier.asset_id, text=text):
                    self.assertEqual(stable(interp.interpret(text, context=context())), stable(deterministic(text)))

    def test_nonsense_that_laya_calls_unactionable_is_still_rejected(self):
        """Every code-rejected corpus row, with a Laya certain of an action but sure it is not a request."""
        rejected = [row['text'] for row in ROWS + BLIND if not det_result(row['text'])['understood'] and not det_result(row['text']).get('clarification')]
        self.assertGreater(len(rejected), 50)
        for intent in ('catch', 'travel', 'status-team', 'new-game', 'trade-shiny'):
            interp = primary(Scripted(default=(intent, 1.0, 0.05)))
            for text in rejected:
                with self.subTest(intent=intent, text=text):
                    self.assertFalse(interp.interpret(text, context=context())['understood'])

    def test_destructive_steps_always_ask_the_owner_to_confirm(self):
        for text, intent in [('bring back the speedrun backup', 'save-restore'), ('make a fresh file called spare', 'save-new'),
                             ('my shiny charizard should go to my buddy', 'trade-shiny'), ('the kadabra in my box should go live with my friend', 'trade-pokemon'),
                             ('i want to experience the adventure all over again as bulbasaur', 'new-game')]:
            with self.subTest(text=text):
                self.assertFalse(deterministic(text)['understood'], 'precondition: the code layer rejects it')
                result = primary(Scripted({text: (intent, 0.99, 0.99)})).interpret(text, context=context())
                self.assertTrue(result['understood'], result['message'])
                self.assertEqual(intents(result), [intent])
                self.assertTrue(result['confirmation']['required'])
                self.assertTrue(result['confirmation']['reasons'])

    def test_a_certain_laya_never_skips_a_destructive_confirmation(self):
        for intent in DESTRUCTIVE:
            interp = primary(Scripted(default=(intent, 1.0, 1.0), entity_p=1.0))
            accepted = 0
            for row in ROWS[:250] + BLIND[:120]:
                result = interp.interpret(row['text'], context=context())
                if result['understood'] and set(intents(result)) & set(DESTRUCTIVE):
                    accepted += 1
                    with self.subTest(intent=intent, text=row['text']):
                        self.assertTrue(result['confirmation']['required'])
            self.assertGreater(accepted, 0, intent)

    def test_a_step_laya_rescued_asks_the_owner_to_confirm_what_it_read(self):
        """Only Laya says it is this action (a rescue: the code layer scored it below ACCEPT; or an override): say so and confirm (laya-nl-20260925)."""
        for text, intent, summary in [('heal the world make it a better place', 'heal', 'Heal the team'), ('the gang looks exhausted', 'heal', 'Heal the team'),
                                      ('a pikachu would be sweet ngl', 'catch', 'Catch Pikachu')]:
            with self.subTest(text=text):
                self.assertFalse(deterministic(text)['understood'], 'precondition: the code layer rejects it')
                result = primary(Scripted({text: (intent, 0.99, 0.95)})).interpret(text, context=context())
                self.assertTrue(result['understood'], result['message'])
                self.assertEqual(intents(result), [intent])
                self.assertTrue(result['confirmation']['required'])
                self.assertIn(f'I read “{text}” as “{summary}”. Confirm?', result['confirmation']['reasons'])
                self.assertTrue(result['laya']['primary'][0]['rescue'])
                chosen = primary(Scripted({text: (intent, 0.99, 0.95)})).interpret(text, context=context(), answers={'0:intent': intent})
                self.assertFalse(chosen['confirmation']['required'], 'the owner chose the action: nothing left to confirm')
        clarified = 'wander over to the volcano island'  # rescued, then the code layer asks for the place: confirmed once that is answered
        answered = primary(Scripted({clarified: ('travel', 0.99, 0.99)})).interpret(clarified, context=context(), answers={'0:place': 'MAP_CINNABAR_ISLAND'})
        self.assertTrue(answered['understood'], answered['message'])
        self.assertTrue(any(r.startswith(f'I read “{clarified}” as “Travel to ') for r in answered['confirmation']['reasons']), answered['confirmation'])
        # An override is Laya's reading too (the code layer's own decision may even be a refusal its builder makes: "get me a garchomp").
        for text, intent, summary in [('go to cinnabar', 'heal', 'Heal the team'), ('get me a garchomp', 'heal', 'Heal the team')]:
            with self.subTest(text=text):
                result = primary(Scripted({text: (intent, 0.99, 0.99)})).interpret(text, context=context())
                self.assertEqual(intents(result), [intent])
                self.assertIn(f'I read “{text}” as “{summary}”. Confirm?', result['confirmation']['reasons'])
                self.assertFalse(result['laya']['primary'][0]['rescue'], 'recorded as an override of an accepted code decision')

    def test_no_runnable_step_laya_decided_skips_confirmation(self):
        rejected = [row['text'] for row in ROWS if not det_result(row['text'])['understood'] and not det_result(row['text']).get('clarification')]
        for intent in ('heal', 'catch', 'travel', 'item', 'save-game', 'bot-start', 'goal-cancel', 'settings'):
            interp = primary(Scripted(default=(intent, 0.99, 0.99)))
            rescued = 0
            for text in rejected:
                result = interp.interpret(text, context=context())
                if result['understood'] and (result['goal'] or result['direct']):
                    rescued += 1
                    with self.subTest(intent=intent, text=text):
                        self.assertTrue(result['confirmation']['required'])
                        self.assertTrue(any(r.startswith('I read “') for r in result['confirmation']['reasons']))
            self.assertGreater(rescued, 0, intent)

    def test_a_laya_reading_that_a_fold_merges_or_joins_is_still_confirmed(self):
        """"catch a pikachu, then trade it to level 40": only Laya reads the second clause as a level, and the fold makes it the catch's
        final level; the owner still confirms that reading (release-1 review). The code layer's own fold needs no confirmation."""
        for text in ('catch a pikachu, then trade it to level 40', 'catch a pikachu and send it to level 40', 'catch a pikachu, then evolve it to level 40',
                     'catch a pikachu, then battle it to level 40', 'catch a pikachu, then teach it to level 40'):
            with self.subTest(text=text):
                self.assertFalse(deterministic(text)['understood'], 'precondition: the code layer refuses it')
                result = primary(Scripted({'catch a pikachu': ('catch', 0.99, 0.99)}, default=('level-up', 0.99, 0.99))).interpret(text, context=context())
                self.assertTrue(result['understood'], result['message'])
                self.assertEqual([s['request'].get('finalLevel') for s in result['goal']['steps']], [40])
                self.assertTrue(result['confirmation']['required'])
                self.assertTrue(any(r.startswith('I read “') for r in result['confirmation']['reasons']), result['confirmation'])
        own = primary(Scripted({'catch a bulbasaur': ('catch', 0.99, 0.99)}, default=('level-up', 0.99, 0.99))).interpret(
            'catch a bulbasaur and train it to level 50', context=context())
        self.assertEqual(stable(own), stable(deterministic('catch a bulbasaur and train it to level 50')))
        self.assertFalse(own['confirmation']['required'])
        # The other folds: a Laya reading merged away as a repeat (the travel it replaced is gone), or one that joins two clauses.
        for text, script in [('heal then go to cinnabar and save', {'go to cinnabar': ('heal', 0.99, 0.99)}),
                             ('save the game stop the bot', {'stop the bot': ('save-game', 0.99, 0.99)}),
                             ('give drake 252 attack, 252 speed and 6 hp evs', {'give drake 252 attack': ('ev-training', 0.99, 0.99)})]:
            with self.subTest(text=text):
                result = primary(Scripted(script)).interpret(text, context=context())
                self.assertTrue(result['understood'], result['message'])
                self.assertNotEqual(stable(result), stable(deterministic(text)), 'precondition: Laya changed the request')
                self.assertTrue(result['confirmation']['required'])
                self.assertTrue(any(r.startswith('I read “') for r in result['confirmation']['reasons']), result['confirmation'])

    def test_laya_keeps_an_accepted_code_decision_when_its_action_lacks_the_entity_it_needs(self):
        """Entity veto: "find a master ball" is an item, not a catch with no Pokémon (the corpus replay regressions)."""
        for text, pick, kept in [('find a master ball', 'catch', 'item'), ('find me a moonstone', 'catch', 'item'), ('grab an exp share', 'catch', 'item'),
                                 ('find a sun stone', 'catch', 'item'), ('get me a rare candy', 'catch', 'item'), ('grab a master ball', 'catch', 'item'),
                                 ('go to a pokemon center', 'travel', 'heal'), ('buy 10 ultra balls', 'travel', 'item'), ('catch a pikachu', 'item', 'catch'),
                                 ('heal up', 'trade-pokemon', 'heal')]:
            with self.subTest(text=text):
                self.assertEqual(intents(deterministic(text)), [kept], 'precondition: the code layer accepts it')
                agent = Scripted({text: (pick, 0.99, 0.99)})
                result = primary(agent).interpret(text, context=context())
                self.assertEqual(stable(result), stable(deterministic(text)))
                self.assertEqual([v['intent'] for v in result['laya']['vetoed']], [pick])
                self.assertNotIn((text, 'actionable'), agent.asked, 'a vetoed pick needs no second question')
        # Laya still decides where its action has what it needs, or needs nothing.
        self.assertEqual(intents(primary(Scripted({'go to cinnabar': ('heal', 0.99, 0.99)})).interpret('go to cinnabar', context=context())), ['heal'])
        swapped = primary(Scripted({'catch a pikachu': ('trade-pokemon', 0.99, 0.99)})).interpret('catch a pikachu', context=context())
        self.assertNotIn('vetoed', swapped['laya'])

    def test_questions_and_negations_never_become_runnable_whatever_laya_says(self):
        for text in ["don't catch a pikachu", 'dont catch a pikachu', "i don't want a pikachu", 'never catch a pikachu', 'please do not heal',
                     "don't cancel my goal", "Don't, uh, catch a Pikachu."]:
            for intent in ('catch', 'heal', 'goal-cancel'):
                with self.subTest(text=text, intent=intent):
                    agent = Scripted(default=(intent, 0.99, 0.99))
                    result = primary(agent).interpret(text, context=context())
                    self.assertFalse(result['understood'], result)
                    self.assertIsNone(result['goal'])
                    self.assertEqual(result['unsupported'], 'negated')
                    self.assertEqual(agent.asked, [], 'a negated clause is decided by the code layer alone')
        # "do i have a kadabra" is answered by the code layer alone since stage 5 (test_answer_only_questions_are_the_code_layers_alone).
        for text in ['is there a shiny mewtwo', 'where can i find a pikachu', 'how do i catch a pikachu', 'did you heal the team']:
            for intent in ('catch', 'heal'):
                with self.subTest(text=text, intent=intent):
                    result = primary(Scripted(default=(intent, 0.99, 0.99))).interpret(text, context=context())
                    self.assertFalse(result['understood'], result)
                    self.assertIsNone(result['goal'])
                    self.assertIn(result['clarification']['slot'], ('question', 'species'))
        status = primary(Scripted(default=('status-team', 0.99, 0.99))).interpret('is there a shiny mewtwo', context=context())
        self.assertTrue(status['understood'], 'a question Laya reads as a status question is answered')
        self.assertIsNone(status['goal'])
        self.assertTrue(status['answer'])
        polite = primary(Scripted(default=('catch', 0.99, 0.99))).interpret('can you catch a pikachu?', context=context())
        self.assertTrue(polite['understood'])
        self.assertEqual(intents(polite), ['catch'])

    def test_answer_only_questions_are_the_code_layers_alone(self):
        """Stage 5's answers were added after the fine-tune: Laya's options stay its 38 trained intents (same text, same order), it never
        chooses a new answer, and a clause whose code-layer reading is one of them is never sent to Laya (primary, combination or shadow)."""
        options = [[intent.id, intent.description] for intent in pr.CATALOG if intent.id in pr.LAYA_OPTIONS]
        self.assertEqual(len(options), 38)
        self.assertEqual(hashlib.sha256(json.dumps(options, ensure_ascii=False).encode()).hexdigest(),
                         'a3add9bdd83160505e4d9293b305030fd51747f57b6037d35e2c576026c234cc', 'the calibrated asset’s intent question is frozen')
        self.assertEqual([[k, v] for k, v in pr.LAYA_OPTIONS.items()], options)
        self.assertEqual({intent.id for intent in pr.CATALOG} - set(pr.LAYA_OPTIONS),
                         {'status-stop', 'status-owned', 'status-stats', 'status-missing', 'status-bag', 'story'})

        class Recording(Scripted):
            def predict(self, state, questions):
                self.criteria = getattr(self, 'criteria', []) + [list(q['criteria']) for q in questions.values() if q.get('criteria')]
                return super().predict(state, questions)

        agent = Recording(default=('heal', 0.99, 0.99))
        primary(agent).interpret('the gang looks exhausted', context=context())
        self.assertIn(list(pr.LAYA_OPTIONS), agent.criteria, 'a clause Laya reads gets exactly the trained options')
        combined = pr.LayaCalibration(intent_temperature=1.0, weight=1.0, switch_margin=0.0, promote=0.0, reject=0.5, entity_threshold=0.0)
        for text in ('why did it stop', 'what happened', 'do i have a kadabra', 'is there a kadabra in my pc', 'what level is my alakazam', 'show my dragonite evs',
                     'what pokemon am i missing', "what's left on the postgame checklist", 'how many rare candies do i have', "what's in my bag"):
            self.assertTrue(deterministic(text)['understood'], text)
            for intent in ('catch', 'heal', 'bot-stop', 'status-team', 'trade-pokemon'):
                for calibration, mode in ((PRIMARY, 'on'), (combined, 'on'), (PRIMARY, 'shadow')):
                    with self.subTest(text=text, intent=intent, mode=mode, primary=calibration.primary):
                        agent = Scripted(default=(intent, 0.99, 0.99), entity_p=1.0)
                        result = primary(agent, calibration=calibration, mode=mode).interpret(text, context=context())
                        self.assertEqual(stable(result), stable(deterministic(text)))
                        self.assertEqual(agent.asked, [], 'Laya is not asked about an answer it was never trained on')
        # In a request with an action, the action's clause still goes to Laya; the answer's clause does not.
        agent = Scripted({'heal up': ('heal', 0.99, 0.99)})
        both = primary(agent).interpret('heal up, then tell me why it stopped', context=context())
        self.assertEqual(intents(both), ['heal', 'status-stop'])
        self.assertEqual({t for t, _ in agent.asked}, {'heal up'})

    def test_story_requests_are_the_code_layers_alone(self):
        """"play the story" (build 126) is code-only like stage 5's answers: Laya's options are unchanged and a story clause is never
        sent to Laya, so the Laya-primary app and an app without Laya give the same answer on every save."""
        from test_pokemon_requests import story_context
        combined = pr.LayaCalibration(intent_temperature=1.0, weight=1.0, switch_margin=0.0, promote=0.0, reject=0.5, entity_threshold=0.0)
        for state in ('new', 'mid', 'hof', 'offline'):
            for text in ('play the story', 'beat the elite four', 'beat the game', 'continue the story'):
                expected = stable(pr.Interpreter().interpret(text, via='typed', context=story_context(state)))
                for intent in ('new-game', 'battle', 'bot-resume', 'catch'):
                    for calibration, mode in ((PRIMARY, 'on'), (combined, 'on'), (PRIMARY, 'shadow')):
                        with self.subTest(state=state, text=text, intent=intent, mode=mode, primary=calibration.primary):
                            agent = Scripted(default=(intent, 0.99, 0.99), entity_p=1.0)
                            result = primary(agent, calibration=calibration, mode=mode).interpret(text, context=story_context(state))
                            self.assertEqual(stable(result), expected)
                            self.assertEqual(agent.asked, [], 'Laya is not asked about a story request')

    def test_release_and_other_unsupported_families_stay_honest_refusals(self):
        text = 'let my magikarp go free'
        for intent in ('release', 'cheat', 'evolve'):
            with self.subTest(intent=intent):
                result = primary(Scripted({text: (intent, 0.99, 0.99)})).interpret(text, context=context())
                self.assertFalse(result['understood'])
                self.assertEqual(result['unsupported'], intent)
                self.assertIsNone(result['goal'])

    def test_validators_and_the_preview_still_refuse_infeasible_requests(self):
        lucario = primary(Scripted({'catch a lucario': ('catch', 0.99, 0.99)})).interpret('catch a lucario', context=context())
        self.assertFalse(lucario['understood'])
        self.assertEqual(lucario['unsupported'], 'species-not-in-game')
        potions = 'that 500 potions deal sounds sweet'
        many = primary(Scripted({potions: ('item', 0.99, 0.99)})).interpret(potions, context=context())
        self.assertFalse(many['understood'])
        self.assertIn('1 to 99', many['message'])

        def no_route(request):
            raise ValueError('Pikachu cannot be reached from this save.')
        text = 'a pikachu would be sweet ngl'
        blocked = primary(Scripted({text: ('catch', 0.99, 0.99)}), preview=no_route).interpret(text, context=context())
        self.assertFalse(blocked['understood'])
        self.assertIn('cannot be reached', blocked['message'])

        def safari_only(request):
            raise ValueError('Only Safari Balls work in the Safari Zone (Safari Ball required).')
        safari = primary(Scripted({text: ('catch', 0.99, 0.99)}), preview=safari_only).interpret(text, context=context())
        self.assertFalse(safari['understood'])
        self.assertEqual(safari['clarification']['slot'], 'ball')

    def test_missing_or_ambiguous_slots_still_produce_a_question(self):
        cases = [('catch something cool', 'catch', 'species'), ('wander over to the volcano island', 'travel', 'place'),
                 ('a mewt would be sweet ngl', 'catch', 'species')]
        for text, intent, slot in cases:
            with self.subTest(text=text):
                result = primary(Scripted({text: (intent, 0.99, 0.99)})).interpret(text, context=context())
                self.assertFalse(result['understood'])
                self.assertEqual(result['clarification']['slot'], slot)
        answered = primary(Scripted({'a mewt would be sweet ngl': ('catch', 0.99, 0.99)})).interpret(
            'a mewt would be sweet ngl', context=context(), answers={'0:species': '150'})
        self.assertTrue(answered['understood'])
        self.assertEqual(answered['goal']['steps'][0]['request']['speciesId'], 150)

    def test_the_owners_intent_answer_still_wins(self):
        text = 'the gang looks exhausted'
        result = primary(Scripted({text: ('heal', 0.99, 0.99)})).interpret(text, context=context(), answers={'0:intent': 'none'})
        self.assertFalse(result['understood'])

    def test_shadow_and_off_modes_are_unchanged(self):
        self.assertIsNone(pr.LayaClassifier.from_config({'laya': {'asset': '/nonexistent/laya-asset', 'mode': 'off'}}))
        interp = primary(Scripted(default=('heal', 1.0, 1.0)), mode='shadow')
        for text in SAMPLE + ['the gang looks exhausted', 'go to cinnabar']:
            with self.subTest(text=text):
                result = interp.interpret(text, context=context())
                self.assertEqual(stable(result), stable(deterministic(text)))
                self.assertEqual(result['laya']['mode'], 'shadow')
                self.assertNotIn('primary', result['laya'])

    def test_a_calibration_without_a_primary_rule_keeps_the_reviewed_combination(self):
        """No primary rule -> Laya still never accepts a clause the code layer rejects (the G4 invariant)."""
        combined = pr.LayaCalibration(intent_temperature=1.0, weight=1.0, switch_margin=0.0, promote=0.0, reject=None, entity_threshold=0.0)
        self.assertIsNone(combined.primary)
        self.assertIsNone(combined.primary_actionable)
        for text in ('the gang looks exhausted', 'a pikachu would be sweet ngl', 'make me a sandwich'):
            with self.subTest(text=text):
                self.assertFalse(primary(Scripted(default=('heal', 1.0, 1.0)), calibration=combined).interpret(text, context=context())['understood'])

    def test_a_hanging_sidecar_keeps_the_request_deterministic_within_its_budget(self):
        with tempfile.TemporaryDirectory() as folder:
            root, known = build_asset(Path(folder) / 'asset')
            script = Path(folder) / 'fake_sidecar.py'
            script.write_text(FAKE_SIDECAR)
            agent = lr.SidecarAgent(root, known=known, timeout=0.3, hang_after=30, command=[sys.executable, str(script), 'hang'])
            try:
                agent.start()
                deadline = time.monotonic() + 10
                while not agent.ready() and not agent.failed() and time.monotonic() < deadline:
                    time.sleep(0.02)
                self.assertTrue(agent.ready(), agent.reason)
                interp = primary(agent)
                for text in ('the gang looks exhausted', 'heal up'):
                    with self.subTest(text=text):
                        started = time.monotonic()
                        result = interp.interpret(text, context=context())
                        self.assertLess(time.monotonic() - started, 1.5)
                        self.assertEqual(stable(result), stable(deterministic(text)))
            finally:
                agent.close()

    def test_the_fine_tuned_asset_is_reviewed_and_ships_a_primary_calibration(self):
        entry = lr.LAYA_ASSETS[FINE_TUNED]
        self.assertEqual(entry['files']['model/laya.onnx.data'], '0762007aef74432ae0ab98a765f8188bd5fa0f5a46e80db7b9c17868280bd45a')
        self.assertEqual(entry['runtimeTree'], '657ab0d33fa02a537acdf1e14acf05bb61fc1f5f4088b08712a077d2c14ee2e0')
        cal = pr.LAYA_CALIBRATIONS[FINE_TUNED]
        self.assertEqual(cal.intent_temperature, 0.9)
        self.assertEqual(cal.entity_threshold, 0.9)
        self.assertEqual((cal.weight, cal.promote, cal.reject), (0.0, None, None))
        self.assertIsNotNone(cal.primary)
        self.assertGreaterEqual(cal.primary, pr.ACCEPT)
        self.assertIsNotNone(cal.primary_actionable)
        self.assertGreaterEqual(cal.primary_actionable, 0.5)
        with tempfile.TemporaryDirectory() as folder:
            (Path(folder) / 'asset.json').write_text(json.dumps({'id': FINE_TUNED}))
            on = pr.LayaClassifier.from_config({'laya': {'asset': folder, 'mode': 'on'}})
            shadow = pr.LayaClassifier.from_config({'laya': {'asset': folder, 'mode': 'shadow'}})
        self.assertIs(on.active_calibration(), cal)
        self.assertIsNone(shadow.active_calibration())


if __name__ == '__main__':
    unittest.main()


class QuestionsAboutOtherPlayers(unittest.TestCase):
    def test_a_confident_laya_cannot_turn_a_question_about_other_players_into_an_answer(self):
        # blind5 b5-0487 (scored once, then retired): Laya read an idle question about other players as status-requests.
        for text in ['does anyone even use master balls on zubats', 'do people really bother catching magikarp']:
            with self.subTest(text=text):
                agent = Scripted({text: ('status-requests', 0.99, 0.99)})
                r = primary(agent).interpret(text, context=context())
                self.assertFalse(r['understood'])
                self.assertEqual(intents(r), [])
