import json
from pathlib import Path
import tempfile
import unittest
from unittest.mock import patch
from pokemon_suite.pokemon_sessions import SuiteSessions

class AdapterLaunchTests(unittest.TestCase):
    def test_private_adapter_inputs_survive_bundled_worker_selection_and_launch_modes(self):
        for manual,held in [(False,False),(True,False),(False,True),(True,True)]:
            with tempfile.TemporaryDirectory() as directory:
                root=Path(directory);assets=root/'local-inputs';assets.mkdir()
                config={'directory':str(root),'node':'node','worker':'/packaged/worker.js','games':{'emerald':{'port':19100,'adapterData':str(assets)}}}
                path=root/'config.json';path.write_text(json.dumps(config));original=path.read_bytes();sessions=SuiteSessions(root)
                ready={'schema':'pokemon-suite/session/v1','game':'emerald','sessionId':'ready'}
                with patch.object(sessions,'_live',side_effect=[None,ready]),patch.object(sessions,'execution_config_path',return_value=path),patch('pokemon_suite.pokemon_sessions.subprocess.Popen') as launch:
                    self.assertEqual(sessions.ensure('emerald',manual=manual,update_hold=held),ready)
                env=launch.call_args.kwargs.get('env',{})
                self.assertEqual(env.get('POKEMON_SUITE_ADAPTER_DATA'),str(assets.resolve()))
                if manual:self.assertEqual(env['POKEMON_SUITE_MANUAL_LAUNCH'],'1')
                if held:self.assertEqual(env['POKEMON_SUITE_UPDATE_HOLD'],'1')
                self.assertEqual(path.read_bytes(),original)

    def test_missing_configured_adapter_data_fails_before_a_worker_is_launched(self):
        with tempfile.TemporaryDirectory() as directory:
            root=Path(directory);config={'node':'node','worker':'/packaged/worker.js','games':{'emerald':{'port':19100,'adapterData':str(root/'missing')}}};path=root/'config.json';path.write_text(json.dumps(config));sessions=SuiteSessions(root)
            with patch.object(sessions,'_live',return_value=None),patch.object(sessions,'execution_config_path',return_value=path),patch('pokemon_suite.pokemon_sessions.subprocess.Popen') as launch:
                with self.assertRaisesRegex(ValueError,'adapter data'):sessions.ensure('emerald')
                launch.assert_not_called()
