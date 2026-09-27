import hashlib
import json
from pathlib import Path
import tempfile
import unittest
from unittest.mock import patch


class InstallationTests(unittest.TestCase):
    def test_installed_game_owns_resources_and_preserves_existing_profile(self):
        from pokemon_suite.installation import install_firered
        with tempfile.TemporaryDirectory() as root:
            root=Path(root).resolve();resources=root/'resources';resources.mkdir()
            core=resources/'core';core.mkdir()
            for name,data in [('mgba.js',b'core-js'),('mgba.wasm',b'core-wasm')]: (core/name).write_bytes(data)
            (core/'build-manifest.json').write_text(json.dumps({'mgba_js_sha256':hashlib.sha256(b'core-js').hexdigest(),'mgba_wasm_sha256':hashlib.sha256(b'core-wasm').hexdigest()}))
            for key in ['runtime','world','story','battle']:(resources/(key+'.json')).write_text('{}')
            rom=root/'game.gba';rom.write_bytes(b'owned-cartridge')
            profile=root/'profile'
            with patch('pokemon_suite.installation.FIRERED_SHA1',hashlib.sha1(rom.read_bytes()).hexdigest()):
                result=install_firered(profile,rom,resources,17639)
                cfg=json.loads((profile/'config.json').read_text())
                self.assertEqual(result['game'],'firered')
                self.assertTrue(Path(cfg['games']['firered']['core']).is_relative_to(profile))
                self.assertNotIn('seed',cfg['games']['firered'])
                before=(profile/'config.json').read_bytes()
                with self.assertRaisesRegex(ValueError,'already configured'):install_firered(profile,rom,resources,17639)
                self.assertEqual((profile/'config.json').read_bytes(),before)
                resources.rename(root/'resources-removed')
                rom.unlink()
                self.assertEqual(Path(cfg['games']['firered']['cartridge']['path']).read_bytes(),b'owned-cartridge')
                self.assertTrue(Path(cfg['games']['firered']['inputs']['world']).is_file())

    def test_wrong_rom_does_not_create_a_profile(self):
        from pokemon_suite.installation import install_firered
        with tempfile.TemporaryDirectory() as root:
            root=Path(root);rom=root/'wrong.gba';rom.write_bytes(b'wrong')
            with self.assertRaisesRegex(ValueError,'verified FireRed'):install_firered(root/'profile',rom,root,17639)
            self.assertFalse((root/'profile').exists())
