import os
from pathlib import Path
import subprocess
import sys
import tempfile
import unittest
from unittest.mock import patch

from pokemon_suite.paths import default_data_directory


class PortabilityTests(unittest.TestCase):
    def test_liveness_probe_never_terminates_the_owner(self):
        from pokemon_suite.processes import assert_process_alive
        process=subprocess.Popen([sys.executable,'-c','import sys;sys.stdin.read()'],stdin=subprocess.PIPE)
        try:
            assert_process_alive(process.pid)
            self.assertIsNone(process.poll())
        finally:
            process.communicate(timeout=5)
        with self.assertRaises(ProcessLookupError):assert_process_alive(process.pid)

    def test_native_user_data_locations(self):
        with patch.dict(os.environ, {'LOCALAPPDATA':'C:/Users/player/AppData/Local','XDG_DATA_HOME':'/data/player'}, clear=True):
            with patch('sys.platform','win32'):
                self.assertEqual(default_data_directory().as_posix(),'C:/Users/player/AppData/Local/PokemonSuite')
            with patch('sys.platform','linux'):
                self.assertEqual(default_data_directory().as_posix(),'/data/player/pokemon-suite')
            with patch('sys.platform','darwin'):
                self.assertTrue(str(default_data_directory()).endswith('Library/Application Support/PokemonSuite'))

    def test_owner_lock_excludes_other_process_and_releases_on_exit(self):
        from pokemon_suite import file_lock
        with tempfile.TemporaryDirectory() as directory:
            path=Path(directory)/'owner.lock'
            code='from pokemon_suite import file_lock as f; import sys; p=open(sys.argv[1],"a+b"); f.flock(p,f.LOCK_EX|f.LOCK_NB)'
            with path.open('a+b') as owner:
                file_lock.flock(owner,file_lock.LOCK_EX)
                blocked=subprocess.run([sys.executable,'-c',code,str(path)],capture_output=True)
                self.assertNotEqual(blocked.returncode,0)
            released=subprocess.run([sys.executable,'-c',code,str(path)],capture_output=True)
            self.assertEqual(released.returncode,0,released.stderr.decode())

    def test_all_worker_modules_import_without_starting_emulators(self):
        import importlib
        for name in ['pokemon_shiny_sweep','suite_desktop_worker','suite_playback_worker']:
            importlib.import_module('pokemon_suite.'+name)
