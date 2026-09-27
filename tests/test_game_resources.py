import hashlib
import http.client
import importlib.util
import json
import os
from pathlib import Path
import tempfile
import threading
import unittest
from unittest.mock import patch

from pokemon_suite import game_resources
from pokemon_suite.installation import install_firered

script=Path(__file__).resolve().parents[1]/'scripts/build-macos.py'
spec=importlib.util.spec_from_file_location('mac_builder',script);builder=importlib.util.module_from_spec(spec);spec.loader.exec_module(builder)

# The Mac app ships the pinned FireRed bot resources, so the user supplies only
# the cartridge. A fixture pack stands in for the real core and knowledge.
CONTENT={'core/mgba.js':b'core-js','core/mgba.wasm':b'core-wasm',
         'runtime.json':b'{"runtime":1}','world.json':b'{"world":1}','story.json':b'{"story":1}','battle.json':b'{"battle":1}'}
CONTENT['core/build-manifest.json']=json.dumps({'mgba_js_sha256':hashlib.sha256(b'core-js').hexdigest(),
                                                'mgba_wasm_sha256':hashlib.sha256(b'core-wasm').hexdigest()}).encode()
PINS={path:hashlib.sha256(data).hexdigest() for path,data in CONTENT.items()}
ROM=b'owned-cartridge'


def write_pack(folder):
    for path,data in CONTENT.items():
        target=Path(folder)/path;target.parent.mkdir(parents=True,exist_ok=True);target.write_bytes(data)
    return Path(folder)


class GameResourceTests(unittest.TestCase):
    def setUp(self):
        self.temp=tempfile.TemporaryDirectory();self.addCleanup(self.temp.cleanup);self.root=Path(self.temp.name).resolve()
        for target,value in [('pokemon_suite.game_resources.FIRERED_FILES',PINS),
                             ('pokemon_suite.installation.FIRERED_SHA1',hashlib.sha1(ROM).hexdigest())]:
            patcher=patch(target,value);patcher.start();self.addCleanup(patcher.stop)
        self.bundle=self.root/'GameResources';write_pack(self.bundle/'firered')
        self.rom=self.root/'FireRed.gba';self.rom.write_bytes(ROM)

    def test_the_pinned_pack_is_accepted(self):
        self.assertEqual(game_resources.verify_pack(self.bundle/'firered'),self.bundle/'firered')

    def test_a_changed_missing_extra_or_linked_file_is_refused(self):
        def fresh(name):return write_pack(self.root/name)
        changed=fresh('changed');(changed/'world.json').write_bytes(b'{"world":2}')
        missing=fresh('missing');(missing/'battle.json').unlink()
        extra=fresh('extra');(extra/'sitecustomize.py').write_text('import os')
        save=fresh('save');(save/'core/firered.sav').write_bytes(b'save')
        linked=fresh('linked');(linked/'story.json').unlink();(linked/'story.json').symlink_to(self.bundle/'firered/story.json')
        for folder in [changed,missing,extra,save,linked]:
            with self.subTest(folder=folder.name),self.assertRaises(ValueError):game_resources.verify_pack(folder)

    def test_the_bundle_location_comes_from_the_app(self):
        with self.assertRaisesRegex(ValueError,'does not include the FireRed bot resources'):game_resources.bundled_firered({})
        self.assertEqual(game_resources.bundled_firered({'POKEMON_SUITE_GAME_RESOURCES':str(self.bundle)}),self.bundle/'firered')

    def test_rom_only_intake_copies_the_bundled_pack_into_the_profile(self):
        profile=self.root/'profile'
        with patch.dict(os.environ,{'POKEMON_SUITE_GAME_RESOURCES':str(self.bundle)}):
            result=install_firered(profile,self.rom)
        self.assertEqual(result['game'],'firered')
        game=json.loads((profile/'config.json').read_text())['games']['firered']
        self.assertTrue(Path(game['core']).is_relative_to(profile),'an app update or move never strands the installed game')
        for key in ['runtime','world','story','battle']:
            self.assertEqual(Path(game['inputs'][key]).read_bytes(),CONTENT[key+'.json'])
        self.assertEqual((Path(game['core'])/'mgba.wasm').read_bytes(),b'core-wasm')
        self.assertEqual(Path(game['cartridge']['path']).read_bytes(),ROM)

    def test_rom_only_intake_refuses_a_damaged_bundle_without_creating_a_profile(self):
        (self.bundle/'firered/runtime.json').write_bytes(b'{"runtime":"edited"}')
        profile=self.root/'profile'
        with patch.dict(os.environ,{'POKEMON_SUITE_GAME_RESOURCES':str(self.bundle)}),self.assertRaisesRegex(ValueError,'Reinstall'):
            install_firered(profile,self.rom)
        self.assertFalse(profile.exists())

    def test_rom_only_intake_without_a_bundle_names_the_resource_folder(self):
        profile=self.root/'profile'
        with patch.dict(os.environ,{},clear=True),self.assertRaisesRegex(ValueError,'resource folder'):install_firered(profile,self.rom)
        self.assertFalse(profile.exists())

    def test_the_app_route_accepts_only_the_game_image(self):
        from pokemon_suite.server import SuiteServer
        profile=self.root/'profile'
        with patch.dict(os.environ,{'POKEMON_SUITE_GAME_RESOURCES':str(self.bundle)}):
            server=SuiteServer(profile,0);thread=threading.Thread(target=server.serve_forever,daemon=True);thread.start()
            connection=http.client.HTTPConnection('127.0.0.1',server.server_port,timeout=5)
            try:
                connection.request('GET','/');response=connection.getresponse();cookie=response.getheader('Set-Cookie').split(';')[0];response.read()
                def post(body):
                    connection.request('POST','/api/install/firered',json.dumps(body),{'Cookie':cookie,'Content-Type':'application/json'})
                    response=connection.getresponse();return response.status,json.loads(response.read())
                status,body=post({'rom':str(self.rom),'extra':'x'});self.assertEqual(status,400,body)
                status,body=post({'rom':str(self.rom),'resources':''});self.assertEqual(status,200,body)
                self.assertIn('firered',json.loads((profile/'config.json').read_text())['games'])
            finally:connection.close();server.shutdown();server.server_close()

    def test_the_mac_build_copies_only_the_pinned_pack(self):
        source=write_pack(self.root/'source');(source/'notes.txt').write_text('private')
        with self.assertRaises(ValueError):builder.copy_game_resources(source,self.root/'refused')
        (source/'notes.txt').unlink()
        target=self.root/'app/GameResources';builder.copy_game_resources(source,target)
        self.assertEqual(game_resources.verify_pack(target/'firered'),target/'firered')
        with self.assertRaises(ValueError):builder.copy_game_resources(source,target)


if __name__=='__main__':unittest.main()
