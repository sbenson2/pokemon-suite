"""Laya L2 data collection: an owner-enabled battle tape reaches only the FireRed worker."""
import json
from pathlib import Path
import tempfile
import unittest
from unittest.mock import patch
from pokemon_suite.pokemon_sessions import SuiteSessions


class BattleTapeLaunchTests(unittest.TestCase):
    def launch(self, game, settings):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            config = {'directory': str(root), 'node': 'node', 'worker': '/packaged/worker.js', 'games': {game: {'port': 19100}}}
            path = root/'config.json'; path.write_text(json.dumps(config)); sessions = SuiteSessions(root)
            if settings is not None:
                (root/'battle-tape.json').write_text(settings if isinstance(settings, str) else json.dumps(settings))
            ready = {'schema': 'pokemon-suite/session/v1', 'game': game, 'sessionId': 'ready'}
            with patch.object(sessions, '_live', side_effect=[None, ready]), patch.object(sessions, 'execution_config_path', return_value=path), \
                    patch('pokemon_suite.pokemon_sessions.subprocess.Popen') as launch:
                self.assertEqual(sessions.ensure(game), ready)
            env = launch.call_args.kwargs.get('env') or {}
            return env.get('POKEMON_SUITE_BATTLE_TAPE'), root

    def test_the_tape_is_off_unless_the_owner_enables_it(self):
        for settings in (None, {}, {'enabled': False}, {'enabled': 'yes'}, 'not json', '[]'):
            self.assertIsNone(self.launch('firered', settings)[0], settings)

    def test_an_enabled_tape_goes_to_the_firered_worker_only(self):
        tape, root = self.launch('firered', {'enabled': True})
        self.assertEqual(tape, str(root/'firered'/'battle-tape.ndjson'))
        for game in ('firered-partner', 'emerald'):
            self.assertIsNone(self.launch(game, {'enabled': True})[0], game)


if __name__ == '__main__':
    unittest.main()
