"""LeafGreen as a bot cartridge (build 124).

LeafGreen US revision 1 is pret's leafgreen_rev1 build of the same pokefirered
source as FireRed. It gets its own pinned knowledge pack, the same mandatory
ROM check and the same intake as FireRed; FireRed behavior is unchanged.
"""
import hashlib
import http.client
import json
import os
from pathlib import Path
import tempfile
import threading
import unittest
from unittest.mock import patch

from pokemon_suite import capabilities, game_resources, installation, rom_integrity

LEAFGREEN_SHA1 = '7862c67bdecbe21d1d69ce082ce34327e1c6ed5e'
LEAFGREEN_SHA256 = '2f978f635b9593f6ca26ec42481c53a6b39f6cddd894ad5c062c1419fac58825'

# Fixture bytes, never ROM content: one image stands for each cartridge.
FR_ROM, LG_ROM = b'owned-firered-cartridge', b'owned-leafgreen-cartridge'


def pack_content(tag):
    content = {'core/mgba.js': b'core-js', 'core/mgba.wasm': b'core-wasm',
               'runtime.json': b'{"runtime":"%s"}' % tag, 'world.json': b'{"world":"%s"}' % tag,
               'story.json': b'{"story":1}', 'battle.json': b'{"battle":1}'}
    content['core/build-manifest.json'] = json.dumps({'mgba_js_sha256': hashlib.sha256(b'core-js').hexdigest(),
                                                      'mgba_wasm_sha256': hashlib.sha256(b'core-wasm').hexdigest()}).encode()
    return content


def write_pack(folder, content):
    for path, data in content.items():
        target = Path(folder)/path; target.parent.mkdir(parents=True, exist_ok=True); target.write_bytes(data)
    return Path(folder)


class LeafGreenPackTests(unittest.TestCase):
    def test_the_leafgreen_pack_is_pinned_with_the_firered_core(self):
        pins = game_resources.LEAFGREEN_FILES
        self.assertEqual(set(pins), set(game_resources.FIRERED_FILES))
        for name in ('core/build-manifest.json', 'core/mgba.js', 'core/mgba.wasm'):
            self.assertEqual(pins[name], game_resources.FIRERED_FILES[name], 'LeafGreen runs the same pinned mGBA core')
        self.assertEqual({k: v for k, v in pins.items() if not k.startswith('core/')}, {
            'runtime.json': 'ad727e752299800f4157190440d4644006aa418a438bb023692cabfe3dc96ee3',
            'world.json': '6661188c838143e856a9c6e8f0a2c7663df8b7731971fa0f05112ad653ef37bb',
            'story.json': '22294f4924e38baec22de2ba5a7973376048df177190710666eedcd6a7b0d30a',
            'battle.json': '8ee851823e66a11d4587f3874c922d4794ebb4aedff56d2f6e33616aec6ad005'})
        for name in ('runtime.json', 'world.json', 'story.json', 'battle.json'):
            self.assertNotEqual(pins[name], game_resources.FIRERED_FILES[name], 'each version has its own knowledge')

    def test_each_pack_is_checked_against_its_own_pins(self):
        with tempfile.TemporaryDirectory() as temp:
            root = Path(temp)
            fr, lg = pack_content(b'fr'), pack_content(b'lg')
            pins = {'FIRERED_FILES': {p: hashlib.sha256(d).hexdigest() for p, d in fr.items()},
                    'LEAFGREEN_FILES': {p: hashlib.sha256(d).hexdigest() for p, d in lg.items()}}
            with patch.multiple(game_resources, **pins):
                self.assertEqual(game_resources.verify_pack(write_pack(root/'lg', lg), 'leafgreen'), root/'lg')
                self.assertEqual(game_resources.verify_pack(write_pack(root/'fr', fr)), root/'fr')
                with self.assertRaisesRegex(ValueError, 'LeafGreen bot resource checksum'):
                    game_resources.verify_pack(root/'fr', 'leafgreen')
                with self.assertRaisesRegex(ValueError, 'FireRed bot resource checksum'):
                    game_resources.verify_pack(root/'lg', 'firered')
                with self.assertRaisesRegex(ValueError, 'bot resources'):
                    game_resources.verify_pack(root/'lg', 'emerald')

    def test_the_bundle_location_names_the_leafgreen_pack(self):
        with self.assertRaisesRegex(ValueError, 'does not include the LeafGreen bot resources'):
            game_resources.bundled_leafgreen({})
        self.assertEqual(game_resources.bundled_leafgreen({'POKEMON_SUITE_GAME_RESOURCES': '/App/GameResources'}),
                         Path('/App/GameResources/leafgreen'))
        self.assertEqual(game_resources.bundled_firered({'POKEMON_SUITE_GAME_RESOURCES': '/App/GameResources'}),
                         Path('/App/GameResources/firered'))


class LeafGreenBuildTests(unittest.TestCase):
    def test_the_mac_build_copies_the_leafgreen_pack_beside_firered(self):
        import importlib.util
        script = Path(__file__).resolve().parents[1]/'scripts/build-macos.py'
        spec = importlib.util.spec_from_file_location('mac_builder_lg', script); builder = importlib.util.module_from_spec(spec); spec.loader.exec_module(builder)
        fr, lg = pack_content(b'fr'), pack_content(b'lg')
        pins = {'FIRERED_FILES': {p: hashlib.sha256(d).hexdigest() for p, d in fr.items()},
                'LEAFGREEN_FILES': {p: hashlib.sha256(d).hexdigest() for p, d in lg.items()}}
        with tempfile.TemporaryDirectory() as temp, patch.multiple(game_resources, **pins):
            root = Path(temp); target = root/'app/GameResources'
            builder.copy_game_resources(write_pack(root/'fr', fr), target)
            with self.assertRaises(ValueError):builder.copy_game_resources(root/'fr', target, 'leafgreen')
            builder.copy_game_resources(write_pack(root/'lg', lg), target, 'leafgreen')
            self.assertEqual(game_resources.verify_pack(target/'leafgreen', 'leafgreen'), target/'leafgreen')
            self.assertEqual(game_resources.verify_pack(target/'firered'), target/'firered')
            with self.assertRaises(ValueError):builder.copy_game_resources(root/'lg', target, 'leafgreen')


class LeafGreenIntakeTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory(); self.addCleanup(self.temp.cleanup); self.root = Path(self.temp.name).resolve()
        self.fr, self.lg = pack_content(b'fr'), pack_content(b'lg')
        self.bundle = self.root/'GameResources'
        write_pack(self.bundle/'firered', self.fr); write_pack(self.bundle/'leafgreen', self.lg)
        for target, value in [('pokemon_suite.game_resources.FIRERED_FILES', {p: hashlib.sha256(d).hexdigest() for p, d in self.fr.items()}),
                              ('pokemon_suite.game_resources.LEAFGREEN_FILES', {p: hashlib.sha256(d).hexdigest() for p, d in self.lg.items()}),
                              ('pokemon_suite.installation.FIRERED_SHA1', hashlib.sha1(FR_ROM).hexdigest()),
                              ('pokemon_suite.installation.LEAFGREEN_SHA1', hashlib.sha1(LG_ROM).hexdigest())]:
            patcher = patch(target, value); patcher.start(); self.addCleanup(patcher.stop)
        self.frrom = self.root/'FireRed.gba'; self.frrom.write_bytes(FR_ROM)
        self.lgrom = self.root/'LeafGreen.gba'; self.lgrom.write_bytes(LG_ROM)
        self.env = patch.dict(os.environ, {'POKEMON_SUITE_GAME_RESOURCES': str(self.bundle)}); self.env.start(); self.addCleanup(self.env.stop)

    def config(self, profile):
        return json.loads((Path(profile)/'config.json').read_text())

    def test_leafgreen_intake_copies_its_own_pack_and_verified_cartridge(self):
        profile = self.root/'profile'
        result = installation.install_leafgreen(profile, self.lgrom)
        self.assertEqual(result, {'ok': True, 'game': 'leafgreen', 'message': 'LeafGreen is installed. First launch creates a new save.'})
        game = self.config(profile)['games']['leafgreen']
        self.assertEqual(game['cartridge'], {'id': 'leafgreen-rev1', 'path': game['cartridge']['path'], 'bytes': len(LG_ROM), 'sha1': hashlib.sha1(LG_ROM).hexdigest()})
        self.assertEqual(Path(game['cartridge']['path']).read_bytes(), LG_ROM)
        self.assertEqual(game['release'], 'pokemon-leafgreen-suite')
        self.assertNotIn('backend', game, 'the bot profile runs the pinned mGBA core, not the manual-play backend')
        for key in ('runtime', 'world', 'story', 'battle'):
            self.assertEqual(Path(game['inputs'][key]).read_bytes(), self.lg[key+'.json'])
            self.assertTrue(Path(game['inputs'][key]).is_relative_to(profile))
        self.assertNotEqual(game['port'], 17639, 'FireRed keeps its default port')

    def test_each_intake_accepts_only_its_own_cartridge(self):
        with self.assertRaisesRegex(ValueError, 'verified LeafGreen US revision 1'):installation.install_leafgreen(self.root/'a', self.frrom)
        with self.assertRaisesRegex(ValueError, 'verified FireRed US revision 1'):installation.install_firered(self.root/'b', self.lgrom)
        self.assertFalse((self.root/'a').exists()); self.assertFalse((self.root/'b').exists())

    def test_one_add_flow_recognizes_either_cartridge_by_its_hash(self):
        profile = self.root/'profile'
        self.assertEqual(installation.install_frlg(profile, self.lgrom)['game'], 'leafgreen')
        self.assertEqual(installation.install_frlg(profile, self.frrom)['game'], 'firered')
        games = self.config(profile)['games']
        self.assertEqual(games['firered']['cartridge']['id'], 'firered-rev1')
        self.assertNotEqual(games['firered']['port'], games['leafgreen']['port'])
        other = self.root/'Emerald.gba'; other.write_bytes(b'other')
        with self.assertRaisesRegex(ValueError, 'FireRed or LeafGreen US revision 1'):installation.install_frlg(profile, other)

    def test_a_never_played_manual_leafgreen_entry_becomes_the_bot_profile(self):
        profile = self.root/'profile'; profile.mkdir()
        manual = {'backend': 'libretro', 'cartridge': {'path': str(self.lgrom), 'sha256': hashlib.sha256(LG_ROM).hexdigest(), 'bytes': len(LG_ROM), 'header': 'BPGE'},
                  'core': '/cores/mgba_libretro.dylib', 'port': 17410, 'release': 'pokemon-leafgreen-suite'}
        (profile/'config.json').write_text(json.dumps({'schema': 'pokemon-suite/config/v1', 'directory': str(profile), 'games': {'leafgreen': manual}}))
        installation.install_leafgreen(profile, self.lgrom)
        game = self.config(profile)['games']['leafgreen']
        self.assertEqual(game['cartridge']['id'], 'leafgreen-rev1'); self.assertNotIn('backend', game)
        self.assertEqual(game['port'], 17410, 'the library keeps the game port it already had')

    def test_manual_leafgreen_saves_are_never_replaced(self):
        profile = self.root/'profile'; (profile/'leafgreen'/'saves').mkdir(parents=True)
        (profile/'leafgreen'/'saves'/'current.json').write_text('{}')
        manual = {'backend': 'libretro', 'cartridge': {'path': str(self.lgrom), 'sha256': hashlib.sha256(LG_ROM).hexdigest(), 'bytes': len(LG_ROM)}, 'core': '/c', 'port': 17410}
        (profile/'config.json').write_text(json.dumps({'schema': 'pokemon-suite/config/v1', 'directory': str(profile), 'games': {'leafgreen': manual}}))
        before = (profile/'config.json').read_bytes()
        with self.assertRaisesRegex(ValueError, 'manual-play saves'):installation.install_leafgreen(profile, self.lgrom)
        self.assertEqual((profile/'config.json').read_bytes(), before)
        installed = self.root/'installed'; installation.install_leafgreen(installed, self.lgrom)
        with self.assertRaisesRegex(ValueError, 'LeafGreen is already configured'):installation.install_leafgreen(installed, self.lgrom)

    def test_the_app_route_installs_either_cartridge(self):
        from pokemon_suite.server import SuiteServer
        profile = self.root/'profile'
        server = SuiteServer(profile, 0); thread = threading.Thread(target=server.serve_forever, daemon=True); thread.start()
        connection = http.client.HTTPConnection('127.0.0.1', server.server_port, timeout=5)
        try:
            connection.request('GET', '/'); response = connection.getresponse(); cookie = response.getheader('Set-Cookie').split(';')[0]; response.read()
            def post(path, body):
                connection.request('POST', path, json.dumps(body), {'Cookie': cookie, 'Content-Type': 'application/json'})
                response = connection.getresponse(); return response.status, json.loads(response.read())
            status, body = post('/api/install/frlg', {'rom': str(self.lgrom), 'extra': 'x'}); self.assertEqual(status, 400, body)
            status, body = post('/api/install/frlg', {'rom': str(self.lgrom)}); self.assertEqual((status, body['game']), (200, 'leafgreen'), body)
            status, body = post('/api/install/firered', {'rom': str(self.lgrom)}); self.assertEqual(status, 400, 'the FireRed route stays FireRed-only')
            self.assertEqual(set(self.config(profile)['games']), {'leafgreen'})
        finally:
            connection.close(); server.shutdown(); server.server_close()


class LeafGreenIntegrityTests(unittest.TestCase):
    def test_the_reviewed_leafgreen_profile_has_no_patches(self):
        self.assertEqual(rom_integrity.LEAFGREEN_ROMS, {'leafgreen-rev1': {'bytes': 16777216, 'sha1': LEAFGREEN_SHA1, 'sha256': LEAFGREEN_SHA256, 'ranges': ()}})

    def corpus(self, root, case, cfg):
        (root/'config.json').write_text(json.dumps({'games': cfg}))
        corpus = root/'corpus.json'
        corpus.write_text(json.dumps({'schema': 'pokemon-suite/native-regressions/v1', 'cases': [{'id': 'lg', 'config': 'config.json', **case}]}))
        return corpus

    def test_a_leafgreen_case_is_verified_against_the_reviewed_stock_image(self):
        with tempfile.TemporaryDirectory() as temp:
            root = Path(temp); rom = root/'lg.gba'; rom.write_bytes(LG_ROM)
            policy = {'bytes': len(LG_ROM), 'sha1': hashlib.sha1(LG_ROM).hexdigest(), 'sha256': hashlib.sha256(LG_ROM).hexdigest(), 'ranges': ()}
            cartridge = {'id': 'leafgreen-rev1', 'path': str(rom), 'bytes': policy['bytes'], 'sha1': policy['sha1']}
            with patch.object(rom_integrity, 'LEAFGREEN_ROMS', {'leafgreen-rev1': policy}):
                corpus = self.corpus(root, {'game': 'leafgreen', 'nativeRadio': False}, {'leafgreen': {'cartridge': cartridge}})
                receipt = rom_integrity.verify_corpus_roms(corpus)
                self.assertEqual(receipt['cases'][0] | {'configSha256': None}, {'id': 'lg', 'game': 'leafgreen', 'nativeRadio': False, 'profile': 'leafgreen-rev1',
                    'configSha256': None, 'baseSha256': policy['sha256'], 'romSha256': policy['sha256'], 'changedBytes': 0})
                # No native link cartridge, partner or self-approved change exists for LeafGreen.
                for case, change in (({'game': 'leafgreen', 'nativeRadio': True}, None),
                                     ({'game': 'leafgreen', 'nativeRadio': False, 'partnerGame': 'emerald'}, None),
                                     ({'game': 'leafgreen', 'nativeRadio': False}, lambda: rom.write_bytes(LG_ROM[:-1]+b'!')),
                                     ({'game': 'leafgreen', 'nativeRadio': False}, lambda: cartridge.update(id='firered-rev1'))):
                    rom.write_bytes(LG_ROM)
                    if change: change()
                    corpus = self.corpus(root, case, {'leafgreen': {'cartridge': cartridge}})
                    with self.subTest(case=case), self.assertRaisesRegex(ValueError, 'ROM|partner|LeafGreen'):
                        rom_integrity.verify_corpus_roms(corpus)
                    cartridge['id'] = 'leafgreen-rev1'


class LeafGreenCapabilityTests(unittest.TestCase):
    def config(self, root, sha1=LEAFGREEN_SHA1, inputs=True):
        rom = root/'lg.gba'; rom.write_bytes(b'x'); core = root/'core'; core.mkdir(exist_ok=True); (core/'build-manifest.json').write_text('{}')
        paths = {}
        for key in ('runtime', 'world', 'story', 'battle'):
            (root/(key+'.json')).write_text('{}'); paths[key] = str(root/(key+'.json'))
        return {'cartridge': {'id': 'leafgreen-rev1', 'path': str(rom), 'sha1': sha1}, 'core': str(core), 'inputs': paths if inputs else {}}

    def test_a_verified_leafgreen_bot_profile_runs_the_story_campaign(self):
        from pokemon_suite.pokemon_main_series import MAIN_GAMES
        with tempfile.TemporaryDirectory() as temp:
            features = capabilities.game_features('leafgreen', MAIN_GAMES['leafgreen'], self.config(Path(temp)))
            ready = {k for k, v in features.items() if v['readiness'] == 'ready'}
            self.assertLessEqual({'play', 'campaign', 'travel', 'battle', 'heal', 'storage', 'telemetry'}, ready)
            # Not qualified on LeafGreen in this build: captures, trades and evolution partners.
            for name in ('trade', 'companion', 'evolution', 'capture.land', 'capture.static'):
                self.assertEqual(features[name]['support'], 'unimplemented', name)
            self.assertTrue(capabilities.legacy_capabilities(features)['bot'])

    def test_leafgreen_automation_needs_the_verified_cartridge_and_its_knowledge(self):
        from pokemon_suite.pokemon_main_series import MAIN_GAMES
        with tempfile.TemporaryDirectory() as temp:
            wrong = capabilities.game_features('leafgreen', MAIN_GAMES['leafgreen'], self.config(Path(temp), sha1='0'*40))
            self.assertEqual(wrong['campaign']['readiness'], 'needs-setup')
            self.assertIn('verified LeafGreen US revision 1', wrong['campaign']['reason'])
            self.assertEqual(wrong['play']['readiness'], 'ready', 'manual play is still possible')
        with tempfile.TemporaryDirectory() as temp:
            missing = capabilities.game_features('leafgreen', MAIN_GAMES['leafgreen'], self.config(Path(temp), inputs=False))
            self.assertEqual(missing['campaign']['readiness'], 'needs-setup')

    def test_manual_libretro_leafgreen_stays_manual(self):
        from pokemon_suite.pokemon_main_series import MAIN_GAMES
        with tempfile.TemporaryDirectory() as temp:
            root = Path(temp); rom = root/'lg.gba'; rom.write_bytes(b'x'); core = root/'core.dylib'; core.write_bytes(b'x')
            features = capabilities.game_features('leafgreen', MAIN_GAMES['leafgreen'], {'backend': 'libretro', 'cartridge': {'path': str(rom)}, 'core': str(core)})
            self.assertEqual(features['play']['readiness'], 'ready')
            self.assertEqual(features['campaign']['support'], 'unimplemented')


from pokemon_suite.pokemon_sessions import SuiteSessions


class Owners(SuiteSessions):
    """Real SuiteSessions with owner status served from memory (as in test_firered_partner)."""
    def __init__(self, directory, games):
        directory.mkdir(parents=True, exist_ok=True)
        super().__init__(directory)
        (directory/'config.json').write_text(json.dumps({'directory': str(directory), 'games': games}))
        for owner in games:(directory/owner).mkdir(exist_ok=True)
        self.status, self.sent = {}, []

    def _live(self, game):
        live = self.status.get(game)
        path = self.directory/game/'command.json'
        if live and path.exists():
            command = json.loads(path.read_text())
            if command['commandId'] != live.get('lastCommand'):
                self.sent.append((game, {k: v for k, v in command.items() if k not in {'commandId', 'sessionId'}}))
                live['lastCommand'] = command['commandId']
                if command['type'] == 'set-bot':live.setdefault('bot', {})['enabled'] = command['enabled']
        return live


class LeafGreenSessionTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory(); self.addCleanup(self.temp.cleanup); self.root = Path(self.temp.name).resolve()

    def bot_profile(self):
        rom = self.root/'lg.gba'; rom.write_bytes(b'x'); core = self.root/'core'; core.mkdir(exist_ok=True); (core/'build-manifest.json').write_text('{}')
        inputs = {}
        for key in ('runtime', 'world', 'story', 'battle'):
            (self.root/(key+'.json')).write_text('{}'); inputs[key] = str(self.root/(key+'.json'))
        return {'cartridge': {'id': 'leafgreen-rev1', 'path': str(rom), 'bytes': 1, 'sha1': LEAFGREEN_SHA1}, 'core': str(core), 'inputs': inputs, 'port': 17640}

    def owner(self, **extra):
        return {'schema': 'pokemon-suite/session/v1', 'game': 'leafgreen', 'owner': 'leafgreen', 'sessionId': 'lg-session', **extra}

    def test_start_game_readies_the_leafgreen_bot_or_resumes_its_campaign(self):
        s = Owners(self.root, {'leafgreen': self.bot_profile()})
        s.status['leafgreen'] = self.owner(bot={'enabled': False})
        s.start_game('leafgreen')
        self.assertEqual(s.sent[-1], ('leafgreen', {'type': 'start-bot'}))
        s.status['leafgreen'] = self.owner(bot={'enabled': False}, campaign={'status': 'running'})
        s.start_game('leafgreen')
        self.assertEqual(s.sent[-1], ('leafgreen', {'type': 'resume-campaign'}))

    def test_the_leafgreen_bot_toggle_needs_the_verified_campaign_profile(self):
        s = Owners(self.root, {'leafgreen': self.bot_profile()})
        s.status['leafgreen'] = self.owner(bot={'enabled': False})
        s.set_bot('leafgreen', True)
        self.assertEqual(s.sent[-1], ('leafgreen', {'type': 'set-bot', 'enabled': True}))
        manual = Owners(self.root/'m', {'leafgreen': {'backend': 'libretro', 'cartridge': {'path': str(self.root/'lg.gba')}, 'core': str(self.root/'lg.gba'), 'port': 17410}})
        with self.assertRaises(ValueError):manual.set_bot('leafgreen', True)

    def test_campaign_options_are_offered_only_for_the_leafgreen_bot_profile(self):
        from pokemon_suite import pokemon_campaigns
        s = Owners(self.root, {'leafgreen': self.bot_profile()})
        pokemon_campaigns.check_game(s, 'leafgreen')
        manual = Owners(self.root/'m', {'leafgreen': {'backend': 'libretro', 'cartridge': {'path': 'x'}, 'core': 'x', 'port': 17410}})
        result = pokemon_campaigns.options(manual, 'leafgreen')
        self.assertFalse(result['supported']); self.assertIn('Add FireRed or LeafGreen', result['reason'])
        with self.assertRaises(ValueError):pokemon_campaigns.check_game(manual, 'leafgreen')
        with self.assertRaisesRegex(ValueError, 'FireRed and LeafGreen'):pokemon_campaigns.check_game(s, 'emerald')

    def test_a_leafgreen_bot_owner_accepts_controller_buttons(self):
        s = Owners(self.root, {'leafgreen': self.bot_profile()})
        with self.assertRaisesRegex(ValueError, 'Open this game'):s.input('leafgreen', {'buttons': ['a']})


if __name__ == '__main__':
    unittest.main()
