import json
import os
from pathlib import Path
import subprocess
import sys
import tempfile
import unittest

ROOT = Path(__file__).resolve().parents[1]


class StandaloneBootstrapTests(unittest.TestCase):
    def test_empty_profile_bootstraps_without_any_host_installation(self):
        with tempfile.TemporaryDirectory(prefix='suite profile ') as temporary:
            home = Path(temporary)
            result = subprocess.run(
                [sys.executable, '-m', 'pokemon_suite', '--data-dir', str(home / 'profile'), 'init'],
                cwd=ROOT, capture_output=True, text=True,
                env={**os.environ, 'POKEMON_SUITE_DATA': str(home / 'profile')},
            )
            self.assertEqual(result.returncode, 0, result.stderr)
            config = json.loads((home / 'profile' / 'config.json').read_text())
            self.assertEqual(config['games'], {})
            self.assertEqual(config['directory'], str((home / 'profile').resolve()))
            self.assertTrue(Path(config['worker']).is_relative_to(ROOT))
            self.assertTrue(Path(config['researchBots']).is_relative_to(ROOT))
            self.assertFalse((home / '.agentland').exists())

    def test_initialization_preserves_existing_user_configuration(self):
        with tempfile.TemporaryDirectory() as temporary:
            target = Path(temporary) / 'config.json'
            original = b'{"games": {}, "userNote": "Keep this"}\n'
            target.write_bytes(original)
            result = subprocess.run([sys.executable, '-m', 'pokemon_suite', '--data-dir', temporary, 'init'],
                                    cwd=ROOT, capture_output=True, text=True)
            self.assertEqual(result.returncode, 0, result.stderr)
            self.assertEqual(target.read_bytes(), original)

    def test_diagnostics_can_load_the_product_from_an_empty_profile(self):
        with tempfile.TemporaryDirectory() as temporary:
            result = subprocess.run([sys.executable, '-m', 'pokemon_suite', '--data-dir', temporary, 'doctor'],
                                    cwd=ROOT, capture_output=True, text=True)
            self.assertEqual(result.returncode, 0, result.stderr)
            report = json.loads(result.stdout)
            self.assertEqual(report['product'], 'pokemon-suite')
            self.assertEqual(report['configuredGames'], 0)
            self.assertEqual(report['status'], 'ready-for-game-setup')
            self.assertFalse((Path(temporary) / 'config.json').exists(), 'doctor is read-only')


if __name__ == '__main__':
    unittest.main()
