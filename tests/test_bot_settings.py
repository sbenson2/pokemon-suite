"""Bot settings: the opt-in question-mark Mail Rare Candy supply reaches the FireRed worker."""
import json
from pathlib import Path
import tempfile
import unittest
from unittest import mock

from pokemon_suite.pokemon_bot_settings import defaults, read, validate, write
from pokemon_suite.pokemon_sessions import SuiteSessions


class RareCandySupplySettingTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        self.root = Path(self.temp.name)

    def test_supply_is_off_by_default_and_for_existing_settings_files(self):
        self.assertIs(defaults()['qmmRareCandySupply'], False)
        self.assertIs(read(self.root, 'firered')['preferences']['qmmRareCandySupply'], False)
        legacy = {key: value for key, value in defaults().items() if key not in ('qmmRareCandySupply', 'collectionStages')}
        (self.root / 'firered').mkdir()
        (self.root / 'firered' / 'bot-settings.json').write_text(json.dumps({'preferences': legacy}))
        self.assertIs(read(self.root, 'firered')['preferences']['qmmRareCandySupply'], False)

    def test_enabling_writes_the_file_the_firered_worker_reads(self):
        written = write(self.root, 'firered', {**defaults(), 'qmmRareCandySupply': True})
        self.assertIs(written['preferences']['qmmRareCandySupply'], True)
        # engine/firered/src/suite/session-worker.js qmmSupplyOption() reads this path and key.
        stored = json.loads((self.root / 'firered' / 'bot-settings.json').read_text())
        self.assertEqual(stored['schema'], 'pokemon-suite/bot-settings/v1')
        self.assertIs(stored['preferences']['qmmRareCandySupply'], True)

    def test_only_a_boolean_for_firered_is_accepted(self):
        with self.assertRaises(ValueError):
            validate('firered', {**defaults(), 'qmmRareCandySupply': 'yes'})
        with self.assertRaises(ValueError):
            validate('emerald', {**defaults(), 'qmmRareCandySupply': True})
        self.assertIs(validate('emerald', defaults())['qmmRareCandySupply'], False)


class LeagueTrainingSettingTests(unittest.TestCase):
    """League Exp. Share training: on by default; turning it off then on is the owner's resume."""
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        self.root = Path(self.temp.name)

    def stored(self):
        return json.loads((self.root / 'firered' / 'bot-settings.json').read_text())

    def test_league_training_defaults_on_for_new_and_legacy_files(self):
        self.assertIs(defaults()['leagueExpShareTraining'], True)
        self.assertIs(read(self.root, 'firered')['preferences']['leagueExpShareTraining'], True)
        legacy = {key: value for key, value in defaults().items() if key != 'leagueExpShareTraining'}
        (self.root / 'firered').mkdir()
        (self.root / 'firered' / 'bot-settings.json').write_text(json.dumps({'preferences': legacy}))
        self.assertIs(read(self.root, 'firered')['preferences']['leagueExpShareTraining'], True)
        self.assertIs(validate('emerald', defaults())['leagueExpShareTraining'], True)

    def test_turning_it_off_then_on_stamps_the_resume_and_other_saves_keep_it(self):
        stamps = iter(['2026-09-26T05:00:00.000Z', '2026-09-26T06:00:00.000Z', '2026-09-26T07:00:00.000Z'])
        with mock.patch('pokemon_suite.pokemon_bot_settings.utc_now', side_effect=lambda: next(stamps)):
            write(self.root, 'firered', defaults())
            self.assertNotIn('leagueExpShareResumedAt', self.stored(), 'on to on is not a resume')
            write(self.root, 'firered', {**defaults(), 'leagueExpShareTraining': False})
            self.assertNotIn('leagueExpShareResumedAt', self.stored())
            write(self.root, 'firered', defaults())
            self.assertEqual(self.stored()['leagueExpShareResumedAt'], '2026-09-26T05:00:00.000Z')
            # engine/firered/src/suite/session-worker.js leagueTrainingOption() reads these keys.
            self.assertIs(self.stored()['leagueExpShareTraining'], True)
            write(self.root, 'firered', {**defaults(), 'shiny': 'required'})
            self.assertEqual(self.stored()['leagueExpShareResumedAt'], '2026-09-26T05:00:00.000Z', 'on to on keeps the stamp')
            write(self.root, 'firered', {**defaults(), 'leagueExpShareTraining': False})
            self.assertEqual(self.stored()['leagueExpShareResumedAt'], '2026-09-26T05:00:00.000Z', 'off keeps the stamp')
            write(self.root, 'firered', defaults())
            self.assertEqual(self.stored()['leagueExpShareResumedAt'], '2026-09-26T06:00:00.000Z')
        self.assertNotIn('leagueExpShareResumedAt', read(self.root, 'firered')['preferences'])

    def test_an_unreadable_previous_file_is_never_a_resume(self):
        (self.root / 'firered').mkdir()
        (self.root / 'firered' / 'bot-settings.json').write_text('{')
        write(self.root, 'firered', defaults())
        self.assertNotIn('leagueExpShareResumedAt', self.stored())

    def test_the_file_keeps_the_setting_beside_the_preferences_an_older_host_reads(self):
        # The previous host's validate() requires exactly its own preference keys.
        older = set(defaults()) - {'leagueExpShareTraining'}
        write(self.root, 'firered', {**defaults(), 'leagueExpShareTraining': False})
        self.assertEqual(set(self.stored()['preferences']), older)
        self.assertIs(self.stored()['leagueExpShareTraining'], False)
        self.assertIs(read(self.root, 'firered')['preferences']['leagueExpShareTraining'], False, 'the API still shows it with the preferences')
        write(self.root, 'emerald', defaults())
        self.assertEqual(set(json.loads((self.root / 'emerald' / 'bot-settings.json').read_text())['preferences']), older)

    def test_a_save_without_the_setting_keeps_it_and_never_resumes(self):
        # A Bot settings page opened before the setting existed sends no such key.
        stale = {key: value for key, value in defaults().items() if key != 'leagueExpShareTraining'}
        with mock.patch('pokemon_suite.pokemon_bot_settings.utc_now', return_value='2026-09-26T05:00:00.000Z'):
            write(self.root, 'firered', {**defaults(), 'leagueExpShareTraining': False})
            saved = write(self.root, 'firered', {**stale, 'shiny': 'required'})
        self.assertIs(saved['preferences']['leagueExpShareTraining'], False, 'off stays off')
        self.assertEqual(saved['preferences']['shiny'], 'required')
        self.assertNotIn('leagueExpShareResumedAt', self.stored(), 'no resume')
        write(self.root, 'firered', defaults())
        write(self.root, 'firered', stale)
        self.assertIs(self.stored()['leagueExpShareTraining'], True, 'on stays on')

    def test_a_non_boolean_is_rejected(self):
        for value in ('yes', None, 1):
            with self.assertRaisesRegex(ValueError, 'Choose whether League training is on'):
                validate('firered', {**defaults(), 'leagueExpShareTraining': value})


class LiveSettingsPushTests(unittest.TestCase):
    """A saved League training change reaches a running FireRed owner; nothing else is sent."""
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        self.root = Path(self.temp.name)
        (self.root / 'config.json').write_text(json.dumps({'games': {'firered': {'port': 1}, 'emerald': {'port': 2}}}))
        self.sessions = SuiteSessions(self.root)
        self.live = {'firered': {'schema': 'pokemon-suite/session/v1', 'game': 'firered', 'sessionId': 'red'},
                     'emerald': {'schema': 'pokemon-suite/session/v1', 'game': 'emerald', 'sessionId': 'green'}}
        self.commands = []
        self.failure = None
        self.sessions._live = lambda game: self.live.get(game)
        def command(game, body, session_id=None, idle_only=False):
            self.assertIs(idle_only, True, 'a settings push never replaces a pending command')
            self.commands.append((game, body, session_id))
            if self.failure:
                raise ValueError(self.failure)
            return self.live[game]
        self.sessions.command = command

    def save(self, game, **changes):
        return self.sessions.save_bot_settings(game, {**defaults(), **changes})

    def test_a_league_training_change_is_pushed_to_the_live_firered_owner_only(self):
        push = ('firered', {'type': 'bot-settings-changed'}, 'red')
        self.save('firered', leagueExpShareTraining=False)
        self.assertEqual(self.commands, [push])
        self.save('firered', leagueExpShareTraining=False, shiny='required')
        self.assertEqual(self.commands, [push], 'an unrelated change is not pushed')
        self.save('firered')
        self.assertEqual(self.commands, [push, push], 'the resume is pushed')
        self.save('emerald', leagueExpShareTraining=False)
        self.assertEqual(len(self.commands), 2, 'only FireRed has League training')

    def test_the_save_says_what_happened_to_league_training(self):
        self.assertEqual(self.save('firered', leagueExpShareTraining=False)['notice'], 'League training is off. The running game has the change.')
        self.assertNotIn('notice', self.save('firered', leagueExpShareTraining=False, shiny='required'))
        self.failure = 'The game has not acknowledged this command yet. Refresh its status before retrying.'
        self.assertEqual(self.save('firered')['notice'],
                         'League training will resume at the next free moment outside the League. The game reads the change when postgame work next starts.')

    def test_a_save_from_a_page_without_the_setting_sends_nothing(self):
        self.save('firered', leagueExpShareTraining=False)
        self.sessions.save_bot_settings('firered', {key: value for key, value in defaults().items() if key != 'leagueExpShareTraining'})
        self.assertEqual(len(self.commands), 1)
        self.assertIs(read(self.root, 'firered')['preferences']['leagueExpShareTraining'], False)

    def test_no_live_owner_or_a_failed_push_keeps_the_saved_setting(self):
        self.live['firered'] = None
        self.assertIs(self.save('firered', leagueExpShareTraining=False)['preferences']['leagueExpShareTraining'], False)
        self.assertEqual(self.commands, [])
        self.live['firered'] = {'schema': 'pokemon-suite/session/v1', 'game': 'emerald', 'sessionId': 'red'}
        self.save('firered')
        self.assertEqual(self.commands, [], 'another owner on the port is never commanded')
        self.live['firered'] = {'schema': 'pokemon-suite/session/v1', 'game': 'firered', 'sessionId': 'red'}
        self.failure = 'The game is held for a verified update. Finish its handoff before other commands.'
        self.assertIs(self.save('firered', leagueExpShareTraining=False)['preferences']['leagueExpShareTraining'], False)
        self.assertEqual(len(self.commands), 1)
        self.assertIs(read(self.root, 'firered')['preferences']['leagueExpShareTraining'], False)


class CommandSlotTests(unittest.TestCase):
    """The host has one command slot: a settings push waits for an idle slot instead of replacing a command."""
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        self.root = Path(self.temp.name)
        (self.root / 'config.json').write_text(json.dumps({'games': {'firered': {'port': 1}}}))
        (self.root / 'firered').mkdir()
        self.sessions = SuiteSessions(self.root)
        self.live = {'schema': 'pokemon-suite/session/v1', 'game': 'firered', 'sessionId': 'red', 'lastCommand': 'earlier'}
        self.sessions._live = lambda game: self.live

    def test_an_unacknowledged_stop_is_never_replaced_by_a_settings_push(self):
        stop = {'type': 'set-bot', 'enabled': False, 'sessionId': 'red', 'commandId': 'stop-1'}
        (self.root / 'firered' / 'command.json').write_text(json.dumps(stop))
        saved = self.sessions.save_bot_settings('firered', {**defaults(), 'leagueExpShareTraining': False})
        self.assertEqual(json.loads((self.root / 'firered' / 'command.json').read_text()), stop)
        self.assertIs(saved['preferences']['leagueExpShareTraining'], False)
        self.assertEqual(saved['notice'], 'League training is off. The game reads the change when postgame work next starts.')
        self.assertIsNone(self.sessions.command('firered', {'type': 'bot-settings-changed'}, session_id='red', idle_only=True))


if __name__ == '__main__':
    unittest.main()
