"""Extra saves: other owned FireRed saves supply the main save's one-per-save families."""
import hashlib
import json
from pathlib import Path
import tempfile
import threading
import unittest

from pokemon_suite.extra_saves import ExtraSaves, annotate_bank, SOURCES_SCHEMA
from pokemon_suite.postgame_partner import PostgamePartners


def inventory(owner=None, profile=None, lineage='2161188857', label='RED (partner)', **extra):
    kind = 'partner-owner' if owner else 'profile'
    return {'schema': 'pokemon-suite/extra-save-inventory/v1', 'source': {'kind': kind, 'owner': owner, 'profileId': profile, 'label': label, 'saved': True},
            'lineage': lineage, 'trainerId': 8185, 'parked': True, 'valid': True, 'pokemon': [], **extra}


class Sessions:
    def __init__(self, directory, games=None):
        self.directory = Path(directory); self.lock = threading.RLock(); self.commands = []; self.live = {}
        self.games = games or {'firered': {'port': 17340, 'release': 'r', 'cartridge': {'id': 'firered-rev1'}, 'core': '/core', 'inputs': {'world': '/w'},
                                           'nativeRadio': {'cartridge': {'id': 'peer'}, 'core': '/native'}},
                               'firered-partner': {'title': 'firered', 'role': 'partner', 'port': 17342}}
        (self.directory / 'config.json').write_text(json.dumps({'directory': str(self.directory), 'games': self.games}))
        for owner in self.games: (self.directory / owner).mkdir(parents=True, exist_ok=True)
    def config(self): return json.loads((self.directory / 'config.json').read_text())
    def configured(self, game): return game in self.config()['games']
    def partner_owners(self): return [(k, 'firered') for k, c in self.config()['games'].items() if k != 'firered' and c.get('role') == 'partner']
    def _live(self, game): return self.live.get(game)
    def command(self, game, body, session_id=None): self.commands.append((game, body, session_id)); return self.live.get(game) or {}


def profile(root, profile_id, sram=b'sram-bytes', state=b'state-bytes', label='FIRE'):
    folder = root / 'firered' / 'save-profiles' / profile_id; folder.mkdir(parents=True)
    sha = lambda b: hashlib.sha256(b).hexdigest()
    (folder / f'{sha(state)}.state').write_bytes(state); (folder / f'{sha(sram)}.sav').write_bytes(sram)
    record = {'id': profile_id, 'label': label, 'directory': str(folder), 'source': {'identity': {'game': 'firered'}, 'statePath': f'{sha(state)}.state', 'sramPath': f'{sha(sram)}.sav',
              'stateSha256': sha(state), 'sramSha256': sha(sram), 'metadata': {'frame': 12}}}
    (root / 'firered' / 'save-profiles' / f'{profile_id}.json').write_text(json.dumps(record))
    return record


FIRE = '08b8c4c8-5802-4f2f-9aa1-5521fa723563'
OMI = 'abc6db80-ebbb-4083-8ac3-fd55e181b075'


class ExtraSavesTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory(); self.addCleanup(self.temp.cleanup); self.root = Path(self.temp.name)

    def test_sources_combine_live_partner_inventories_with_cached_archived_profiles(self):
        s = Sessions(self.root)
        s.live['firered-partner'] = {'owner': 'firered-partner', 'extraSaveInventory': inventory(owner='firered-partner')}
        record = profile(self.root, FIRE)
        calls = []
        def runner(requests):
            calls.append([r['profileId'] for r in requests])
            return [{'profileId': r['profileId'], 'sramSha256': record['source']['sramSha256'], 'inventory': inventory(profile=r['profileId'], lineage='2739568461', label='FIRE'), 'reason': None} for r in requests]
        extra = ExtraSaves(s, profile_runner=runner)
        doc = extra.publish()
        self.assertEqual(doc['schema'], SOURCES_SCHEMA)
        self.assertEqual([(x['source']['kind'], x['lineage']) for x in doc['sources']], [('partner-owner', '2161188857'), ('profile', '2739568461')])
        written = json.loads((self.root / 'firered/extra-save-sources.json').read_text())
        self.assertEqual(written['sources'], doc['sources'])
        # Profiles are decoded once per native save; an unchanged document is not rewritten.
        mtime = (self.root / 'firered/extra-save-sources.json').stat().st_mtime_ns
        extra.publish()
        self.assertEqual(calls, [[FIRE]])
        self.assertEqual((self.root / 'firered/extra-save-sources.json').stat().st_mtime_ns, mtime)

    def test_a_partner_owner_is_seeded_read_only_from_an_archived_profile_once_per_lineage(self):
        s = Sessions(self.root)
        record = profile(self.root, FIRE)
        extra = ExtraSaves(s, profile_runner=lambda requests: [])
        owner = extra.seed_partner(FIRE, lineage='2739568461')
        self.assertEqual(owner, 'firered-partner-2')
        entry = s.config()['games'][owner]
        self.assertEqual((entry['title'], entry['role'], entry['label']), ('firered', 'partner', 'FIRE'))
        self.assertEqual(entry['nativeRadio'], s.games['firered']['nativeRadio'])
        self.assertNotIn(entry['port'], (17340, 17342))
        seed = entry['seed']
        self.assertEqual(seed['sramSha256'], record['source']['sramSha256'])
        self.assertEqual(Path(seed['sramFilePath']).read_bytes(), b'sram-bytes')
        self.assertFalse(Path(seed['sramFilePath']).stat().st_mode & 0o222, 'the seed copy is read-only')
        self.assertTrue(str(Path(seed['sramFilePath'])).startswith(str(self.root / 'extra-saves' / 'seeds')))
        self.assertEqual(entry['extraSaveSource'], {'profileId': FIRE, 'lineage': '2739568461'})
        # The archive itself is untouched, and a lineage is never seeded twice.
        self.assertEqual((Path(record['directory']) / record['source']['sramPath']).read_bytes(), b'sram-bytes')
        with self.assertRaisesRegex(ValueError, 'already'):
            extra.seed_partner(FIRE, lineage='2739568461')
        with self.assertRaisesRegex(ValueError, 'archived'):
            extra.seed_partner('../../etc', lineage='1')

    def test_progress_names_the_save_what_it_is_doing_and_an_unknown_eta(self):
        s = Sessions(self.root)
        s.live['firered'] = {'owner': 'firered', 'extraSaves': [{'needId': 'starter-squirtle', 'label': 'Squirtle line', 'species': [7, 8, 9], 'route': 'Squirtle line: Borrow Blastoise ...',
                                                                  'save': 'RED (partner)', 'mode': 'borrow and return', 'status': 'ready', 'doing': 'Waiting for the Day Care Egg.', 'eta': 'unknown', 'runtime': 'short'}]}
        s.live['firered-partner'] = {'owner': 'firered-partner', 'extraSaveLedger': {'open': {'exchangeId': 'extra-save-starter-squirtle-100', 'mode': 'loan', 'sourceOwner': 'firered'}, 'grants': 0}}
        rows = ExtraSaves(s, profile_runner=lambda r: []).progress()
        self.assertEqual(rows['rows'][0]['save'], 'RED (partner)')
        self.assertEqual(rows['rows'][0]['doing'], 'Waiting for the Day Care Egg.')
        self.assertEqual(rows['rows'][0]['eta'], 'unknown')
        self.assertEqual(rows['partners'], [{'owner': 'firered-partner', 'lending': 'extra-save-starter-squirtle-100', 'grants': 0}])

    def test_the_bank_route_text_names_the_extra_save_route(self):
        s = Sessions(self.root)
        s.live['firered'] = {'owner': 'firered', 'extraSaves': [{'needId': 'fossil-dome', 'label': 'Kabuto line', 'species': [140, 141], 'route': 'Kabuto line: a helper FireRed save takes the Dome Fossil.',
                                                                  'save': 'Helper save 1 (Squirtle, Dome Fossil)', 'status': 'needs-helper-save', 'doing': 'Waiting for a new helper FireRed save.', 'eta': 'unknown'}]}
        class Trading: sessions = s
        overview = {'species': [{'id': 140, 'route': {'category': 'external', 'detail': 'Requires another starter...'}}, {'id': 25, 'route': {'category': 'wild', 'detail': 'Viridian Forest'}}]}
        result = annotate_bank(Trading(), overview)
        self.assertEqual(result['species'][0]['route']['detail'], 'Kabuto line: a helper FireRed save takes the Dome Fossil. Waiting for a new helper FireRed save. ETA unknown.')
        self.assertEqual(result['species'][0]['route']['extraSave']['save'], 'Helper save 1 (Squirtle, Dome Fossil)')
        self.assertEqual(result['species'][1]['route']['detail'], 'Viridian Forest')
        single = annotate_bank(Trading(), {'speciesId': 141, 'route': {'category': 'external', 'detail': 'x'}})
        self.assertIn('Dome Fossil', single['route']['detail'])


class HelperSaveTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory(); self.addCleanup(self.temp.cleanup); self.root = Path(self.temp.name)

    def rows(self=None):
        return [{'needId': 'fossil-dome', 'label': 'Kabuto line', 'species': [140, 141], 'save': 'Helper save 1 (Squirtle, Dome Fossil)', 'status': 'needs-helper-save', 'runtime': 'medium',
                 'helper': {'saveId': 'helper-1', 'settings': {'starter': 'squirtle', 'fossil': 'dome', 'afterCampaign': 'wait'}, 'goal': {'kind': 'fossil', 'fossil': 'dome'}}},
                {'needId': 'roamer-raikou', 'label': 'Raikou', 'species': [243], 'save': 'Helper save 1 (Squirtle, Dome Fossil)', 'status': 'planned-long', 'runtime': 'long',
                 'helper': {'saveId': 'helper-1', 'settings': {'starter': 'squirtle', 'fossil': 'dome', 'afterCampaign': 'wait'}, 'goal': {'kind': 'roamer', 'species': 243}}},
                {'needId': 'roamer-suicune', 'label': 'Suicune', 'species': [245], 'save': 'Helper save 2 (Charmander)', 'status': 'planned-long', 'runtime': 'long',
                 'helper': {'saveId': 'helper-2', 'settings': {'starter': 'charmander', 'afterCampaign': 'wait'}, 'goal': {'kind': 'roamer', 'species': 245}}}]

    def test_a_helper_save_is_a_new_firered_owner_playing_the_reviewed_story_to_its_goal(self):
        s = Sessions(self.root); s.live['firered'] = {'owner': 'firered', 'extraSaves': self.rows()}
        started = []
        def ensure(owner): started.append(owner); s.live[owner] = {'owner': owner, 'sessionId': owner+'-session'}; return s.live[owner]
        s.ensure = ensure
        settings_seen = []
        def runner(owner, settings):
            settings_seen.append((owner, settings)); return {'record': {'id': 'run-12345678-1234-1234-1234-123456789abc', 'settings': settings}, 'preview': {}}
        result = ExtraSaves(s, profile_runner=lambda r: []).start_helper('helper-1', campaign_runner=runner)
        self.assertEqual(result, {'owner': 'firered-helper-1', 'previewId': 'run-12345678-1234-1234-1234-123456789abc', 'goal': {'kind': 'fossil', 'fossil': 'dome'}})
        entry = s.config()['games']['firered-helper-1']
        self.assertEqual((entry['title'], entry['role'], entry['extraSaveHelper']), ('firered', 'helper', {'saveId': 'helper-1', 'goal': {'kind': 'fossil', 'fossil': 'dome'}}))
        self.assertNotIn('seed', entry, 'a helper starts a new blank FireRed save')
        self.assertEqual(settings_seen, [('firered-helper-1', {'label': 'Helper save 1 (Squirtle, Dome Fossil)', 'starter': 'squirtle', 'afterCampaign': 'wait', 'helperGoal': {'kind': 'fossil', 'fossil': 'dome'}, 'fossil': 'dome'})])
        self.assertTrue((self.root/'firered-helper-1/run-previews/run-12345678-1234-1234-1234-123456789abc.json').exists())
        self.assertEqual(s.commands, [('firered-helper-1', {'type': 'start-campaign', 'previewId': 'run-12345678-1234-1234-1234-123456789abc'}, 'firered-helper-1-session')])
        # Starting again reuses the same helper owner.
        ExtraSaves(s, profile_runner=lambda r: []).start_helper('helper-1', campaign_runner=runner)
        self.assertEqual([k for k in s.config()['games'] if k.startswith('firered-helper')], ['firered-helper-1'])
        with self.assertRaisesRegex(ValueError, 'long postgame'):
            ExtraSaves(s, profile_runner=lambda r: []).start_helper('helper-2', campaign_runner=runner)

    def test_a_helper_that_saved_its_goal_becomes_a_partner_granted_only_that_individual(self):
        s = Sessions(self.root, games={**Sessions(self.root).games, 'firered-helper-1': {'title': 'firered', 'role': 'helper', 'label': 'Helper save 1', 'port': 17350, 'extraSaveHelper': {'saveId': 'helper-1'}}})
        folder = self.root/'firered-helper-1/hunts/run-1/saves'; folder.mkdir(parents=True)
        sha = lambda b: hashlib.sha256(b).hexdigest()
        (folder/f'{sha(b"state")}.state').write_bytes(b'state'); (folder/f'{sha(b"sram")}.sav').write_bytes(b'sram')
        (folder/'current.json').write_text(json.dumps({'statePath': f'{sha(b"state")}.state', 'sramPath': f'{sha(b"sram")}.sav', 'stateSha256': sha(b'state'), 'sramSha256': sha(b'sram'), 'metadata': {'frame': 9}}))
        (self.root/'firered-helper-1/active-hunt.json').write_text(json.dumps({'id': 'run-1', 'manual': True, 'nativeRadio': False}))
        receipt = {'schema': 'pokemon-suite/helper-goal/v1', 'fingerprint': '[140,1,2]', 'grants': ['[140,1,2]'], 'lineage': '4242', 'savedSramSha256': 'f'*64}
        s.live['firered-helper-1'] = {'owner': 'firered-helper-1', 'campaign': {'completion': {'helperGoal': receipt}}}
        self.assertEqual(ExtraSaves(s, profile_runner=lambda r: []).finish_helpers(), [], 'the goal save must be the helper\'s current native save')
        s.live['firered-helper-1']['campaign']['completion']['helperGoal'] = {**receipt, 'savedSramSha256': sha(b'sram')}
        self.assertEqual(ExtraSaves(s, profile_runner=lambda r: []).finish_helpers(), ['firered-partner-2'])
        entry = s.config()['games']['firered-partner-2']
        self.assertEqual((entry['role'], entry['extraSaveGrants'], entry['extraSaveSource']['helperOwner']), ('partner', ['[140,1,2]'], 'firered-helper-1'))
        self.assertEqual(Path(entry['seed']['sramFilePath']).read_bytes(), b'sram')
        self.assertEqual(ExtraSaves(s, profile_runner=lambda r: []).finish_helpers(), [], 'a helper is seeded once')


class HelperIdentityTests(unittest.TestCase):
    """build 126: a helper boots the reviewed native link pair, so its preview names that owner."""
    STOCK, PEER = 'dd5945db9b930750cb39d00c84da8571feebf417', '85a259c7b7a74d4f2322e5b9f89d22a53dfd6fce'

    def setUp(self):
        self.temp = tempfile.TemporaryDirectory(); self.addCleanup(self.temp.cleanup); self.root = Path(self.temp.name)
        self.native_core = self.root/'native-core'; self.native_core.mkdir()
        (self.native_core/'build-manifest.json').write_text(json.dumps({'mgba_wasm_sha256': 'f3ddfa36'+'0'*56}))

    def sessions(self, helper=None):
        native = {'huntId': 'run-main', 'cartridge': {'id': 'firered-rev1-peer-trade-v2', 'sha1': self.PEER}, 'core': str(self.native_core)}
        games = {'firered': {'port': 17339, 'release': 'r', 'cartridge': {'id': 'firered-rev1', 'sha1': self.STOCK}, 'core': '/stock-core', 'inputs': {'world': '/w'}, 'nativeRadio': native},
                 'firered-partner': {'title': 'firered', 'role': 'partner', 'port': 17342}}
        if helper:
            games['firered-helper-1'] = helper
        s = Sessions(self.root, games=games)
        s.live['firered'] = {'owner': 'firered', 'extraSaves': HelperSaveTests.rows(None)}
        def ensure(owner): s.live[owner] = {'owner': owner, 'sessionId': owner+'-session'}; return s.live[owner]
        s.ensure = ensure
        return s

    def test_the_preview_cli_is_asked_for_the_helper_owner(self):
        s = self.sessions()
        seen = []
        import subprocess as sp
        from unittest import mock
        (self.root/'.app-runtime').mkdir()
        cfg_path = self.root/'.app-runtime'/'firered-helper-1.json'
        cfg_path.write_text(json.dumps({'node': 'node', 'worker': str(self.root/'engine/session-worker.js')}))
        s.execution_config_path = lambda owner: cfg_path
        def run(args, input=None, **kwargs):
            seen.append(json.loads(input))
            return sp.CompletedProcess(args, 0, stdout=json.dumps({'record': {'id': 'run-1'}, 'preview': {}}), stderr='')
        with mock.patch('pokemon_suite.extra_saves.subprocess.run', side_effect=run):
            ExtraSaves(s, profile_runner=lambda r: [])._run_campaign_cli('firered-helper-1', {'label': 'x'})
        self.assertEqual(seen, [{'game': 'firered', 'action': 'preview', 'settings': {'label': 'x'}, 'owner': 'firered-helper-1'}])

    def test_a_never_played_blank_save_on_another_cartridge_is_set_aside_before_the_helper_restarts(self):
        helper = {'title': 'firered', 'role': 'helper', 'label': 'Helper save 1', 'port': 17430, 'cartridge': {'id': 'firered-rev1', 'sha1': self.STOCK},
                  'nativeRadio': {'huntId': 'run-main', 'cartridge': {'sha1': self.PEER}, 'core': str(self.native_core)},
                  'extraSaveHelper': {'saveId': 'helper-1', 'goal': {'kind': 'fossil', 'fossil': 'dome'}}}
        s = self.sessions(helper)
        saves = self.root/'firered-helper-1'/'saves'; saves.mkdir(parents=True)
        (saves/'current.json').write_text(json.dumps({'schema': 'pokemon-suite/save/v1', 'identity': {'game': 'firered', 'romSha1': self.STOCK, 'coreSha256': '297047c0'+'0'*56},
                                                     'metadata': {'frame': 5344, 'newProfile': True, 'session': None, 'reason': 'Stopped from Pokémon Suite.'}}))
        runner = lambda owner, settings: {'record': {'id': 'run-12345678-1234-1234-1234-123456789abc'}, 'preview': {}}
        result = ExtraSaves(s, profile_runner=lambda r: []).start_helper('helper-1', campaign_runner=runner)
        self.assertEqual(result['owner'], 'firered-helper-1')
        self.assertFalse((saves/'current.json').exists(), 'the helper boots a new blank save on its link pair')
        retired = [p.name for p in (self.root/'firered-helper-1').iterdir() if p.name.startswith('saves.retired-')]
        self.assertEqual(len(retired), 1); self.assertIn(self.STOCK[:8], retired[0])
        self.assertTrue((self.root/'firered-helper-1'/retired[0]/'current.json').exists(), 'the old blank save is kept, not deleted')
        self.assertNotIn('huntId', s.config()['games']['firered-helper-1'].get('nativeRadio', {}), "the main owner's hunt id is not the helper's")

    def test_a_helper_save_with_progress_on_another_cartridge_is_preserved_for_review(self):
        helper = {'title': 'firered', 'role': 'helper', 'label': 'Helper save 1', 'port': 17430, 'cartridge': {'id': 'firered-rev1', 'sha1': self.STOCK},
                  'nativeRadio': {'cartridge': {'sha1': self.PEER}, 'core': str(self.native_core)}, 'extraSaveHelper': {'saveId': 'helper-1', 'goal': {'kind': 'fossil', 'fossil': 'dome'}}}
        s = self.sessions(helper)
        saves = self.root/'firered-helper-1'/'saves'; saves.mkdir(parents=True)
        (saves/'current.json').write_text(json.dumps({'schema': 'pokemon-suite/save/v1', 'identity': {'game': 'firered', 'romSha1': self.STOCK, 'coreSha256': '297047c0'+'0'*56},
                                                     'metadata': {'frame': 90000, 'newProfile': False, 'campaign': {'record': {}}}}))
        with self.assertRaisesRegex(ValueError, 'preserved for review'):
            ExtraSaves(s, profile_runner=lambda r: []).start_helper('helper-1', campaign_runner=lambda o, st: {'record': {'id': 'run-x'}})
        self.assertTrue((saves/'current.json').exists())


class ParkTests(unittest.TestCase):
    def test_an_archived_save_outside_a_center_is_parked_by_a_helper_then_served_by_one_partner(self):
        with tempfile.TemporaryDirectory() as root:
            root = Path(root); s = Sessions(root)
            record = profile(root, FIRE)
            runner = lambda requests: [{'profileId': FIRE, 'sramSha256': record['source']['sramSha256'], 'inventory': inventory(profile=FIRE, lineage='2739568461', label='FIRE', map='MAP_PALLET_TOWN', parked=False), 'reason': None}]
            def ensure(owner): s.live[owner] = {'owner': owner, 'sessionId': owner+'-session'}; return s.live[owner]
            s.ensure = ensure
            extra = ExtraSaves(s, profile_runner=runner)
            self.assertEqual(ExtraSaves.park_center('MAP_PALLET_TOWN'), 'MAP_VIRIDIAN_CITY_POKEMON_CENTER_1F')
            result = extra.park_profile(FIRE, lineage='2739568461')
            self.assertEqual(result, {'owner': 'firered-helper-1', 'center': 'MAP_VIRIDIAN_CITY_POKEMON_CENTER_1F'})
            helper = s.config()['games']['firered-helper-1']
            self.assertEqual((helper['role'], helper['extraSaveHelper']['park'], helper['seed']['sramSha256']), ('helper', True, record['source']['sramSha256']))
            self.assertEqual(s.commands[-1], ('firered-helper-1', {'type': 'player-task', 'request': {'id': 'park-08b8c4c8', 'kind': 'travel', 'map': 'MAP_VIRIDIAN_CITY_POKEMON_CENTER_1F'}}, 'firered-helper-1-session'))
            # build 126: while its helper prepares it, the archive stays in the plan once, naming that helper,
            # so its rows keep pointing at it instead of moving to another save.
            offered = [x['source'] for x in extra.sources()['sources'] if x['source'].get('profileId') == FIRE]
            self.assertEqual([s.get('helperOwner') for s in offered], ['firered-helper-1'])
            # The helper's travel task saved it in the Center: one partner owner is seeded from that save.
            folder = root/'firered-helper-1/saves'; folder.mkdir(parents=True)
            sha = lambda b: hashlib.sha256(b).hexdigest()
            (folder/f'{sha(b"parked")}.sav').write_bytes(b'parked'); (folder/f'{sha(b"st")}.state').write_bytes(b'st')
            (folder/'current.json').write_text(json.dumps({'statePath': f'{sha(b"st")}.state', 'sramPath': f'{sha(b"parked")}.sav', 'stateSha256': sha(b'st'), 'sramSha256': sha(b'parked'), 'metadata': {'frame': 3}}))
            self.assertEqual(extra.finish_helpers(), [], 'no verified park receipt yet')
            (root/'firered-helper-1/player-task-park-08b8c4c8.json').write_text(json.dumps({'request': {'id': 'park-08b8c4c8', 'kind': 'travel', 'map': 'MAP_VIRIDIAN_CITY_POKEMON_CENTER_1F'}, 'nativeSaveVerified': True, 'savedSramSha256': sha(b'parked')}))
            self.assertEqual(extra.finish_helpers(), ['firered-partner-2'])
            partner = s.config()['games']['firered-partner-2']
            self.assertEqual((partner['role'], partner['seed']['sramSha256'], partner['extraSaveSource']['profileId']), ('partner', sha(b'parked'), FIRE))
            self.assertNotIn('extraSaveGrants', partner, 'an archived save only lends; it never gives its own Pokémon away')
            self.assertEqual(extra.finish_helpers(), [])


def archive_rows(profile_id=FIRE, lineage='2739568461'):
    """Rows as the engine presents them (build 126): source, subject, task with its hunt, and the starting action."""
    source = {'kind': 'profile', 'owner': None, 'profileId': profile_id, 'label': 'FIRE', 'lineage': lineage, 'trainerId': 32589}
    hunt = {'id': 'helper-dojo-107-08b8c4c8', 'request': {'schema': 'pokemon-suite/farming-request/v1', 'game': 'firered', 'speciesId': 107, 'shiny': 'any'},
            'route': {'method': 'gift', 'speciesId': 107, 'map': 'MAP_SAFFRON_CITY_DOJO', 'index': 6}}
    return [{'needId': 'starter-charmander', 'species': [4, 5, 6], 'status': 'needs-partner-owner', 'source': source,
             'subject': {'fingerprint': '[6,1,2739568461]', 'species': 6, 'where': 'party'}, 'start': {'action': 'seed-partner', 'profileId': profile_id}},
            {'needId': 'hitmon', 'species': [106, 107, 236, 237], 'status': 'needs-helper-task', 'source': source,
             'task': {'kind': 'dojo-prize', 'speciesId': 107, 'profileId': profile_id, 'lineage': lineage, 'hunt': hunt}, 'start': {'action': 'start-helper', 'needId': 'hitmon'}}]


class ArchiveTaskTests(unittest.TestCase):
    """build 126: an archived save is prepared in one helper run (its tasks, then a park), then served by one partner."""
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory(); self.addCleanup(self.temp.cleanup); self.root = Path(self.temp.name)
        self.s = Sessions(self.root); self.record = profile(self.root, FIRE)
        self.s.live['firered'] = {'owner': 'firered', 'extraSaves': archive_rows()}
        def ensure(owner): self.s.live.setdefault(owner, {'owner': owner, 'sessionId': owner+'-session'}); return self.s.live[owner]
        self.s.ensure = ensure

    def extra(self, parked=False):
        inv = inventory(profile=FIRE, lineage='2739568461', label='FIRE', map='MAP_VIEW_PALLET' if not parked else 'MAP_VIRIDIAN_CITY_POKEMON_CENTER_1F', parked=parked)
        runner = lambda requests: [{'profileId': FIRE, 'sramSha256': self.record['source']['sramSha256'], 'inventory': inv, 'reason': None}]
        return ExtraSaves(self.s, profile_runner=runner)

    def test_seeding_an_unparked_archive_prepares_it_in_a_helper_first(self):
        result = self.extra().seed_or_park(FIRE, lineage='2739568461')
        self.assertEqual((result['owner'], result['role']), ('firered-helper-1', 'helper'))
        helper = self.s.config()['games']['firered-helper-1']['extraSaveHelper']
        self.assertEqual((helper['park'], helper['profileId']), (True, FIRE))
        self.assertEqual([t['hunt']['id'] for t in helper['tasks']], ['helper-dojo-107-08b8c4c8'], "the lineage's planned helper task runs before it becomes a partner")
        self.assertEqual(helper['center'], 'MAP_CELADON_CITY_POKEMON_CENTER_1F')
        self.assertEqual(self.s.commands[-1], ('firered-helper-1', {'type': 'start', 'record': helper['tasks'][0]['hunt'], 'runScope': 'task'}, 'firered-helper-1-session'))
        self.assertNotIn('firered-partner-2', self.s.config()['games'], 'no partner until the helper parks')
        # The same action again, or the Dojo row's own start, resumes the same helper.
        self.assertEqual(self.extra().seed_or_park(FIRE, lineage='2739568461')['owner'], 'firered-helper-1')
        self.assertEqual(self.extra().start_helper(need_id='hitmon')['owner'], 'firered-helper-1')
        self.assertEqual([k for k in self.s.config()['games'] if k.startswith('firered-')], ['firered-partner', 'firered-helper-1'])

    def test_a_parked_archive_without_tasks_is_seeded_as_a_partner_directly(self):
        self.s.live['firered']['extraSaves'] = archive_rows()[:1]
        result = self.extra(parked=True).seed_or_park(FIRE, lineage='2739568461')
        self.assertEqual((result['owner'], result['role']), ('firered-partner-2', 'partner'))

    def test_a_helper_runs_its_tasks_then_parks_then_becomes_a_partner_granted_the_obtained_individual(self):
        extra = self.extra(); extra.seed_or_park(FIRE, lineage='2739568461')
        owner, hunt = 'firered-helper-1', archive_rows()[1]['task']['hunt']
        self.s.commands.clear()
        self.s.live[owner] = {'owner': owner, 'sessionId': 's2', 'mission': {'id': hunt['id'], 'state': 'running'}, 'bot': {'status': 'running'}}
        extra.advance_helpers(); self.assertEqual(self.s.commands, [], 'a running task is left alone')
        self.s.live[owner]['mission']['state'] = 'complete'; self.s.live[owner]['bot'] = {'status': 'ready', 'awaitingCommand': True}
        extra.advance_helpers()
        park = {'id': 'park-08b8c4c8', 'kind': 'park', 'map': 'MAP_CELADON_CITY_POKEMON_CENTER_1F', 'goals': [{'speciesId': 107}], 'keep': ['[6,1,2739568461]']}
        self.assertEqual(self.s.commands, [(owner, {'type': 'player-task', 'request': park}, 's2')])
        self.s.live[owner]['bot'] = {'status': 'running', 'preparation': {'requestId': 'park-08b8c4c8', 'kind': 'park', 'phase': 'working'}}
        extra.advance_helpers(); self.assertEqual(len(self.s.commands), 1, 'the park task is started once')
        # The park saved the goal in the Center: one partner is seeded from that save, granted only the Hitmonchan.
        sha = lambda b: hashlib.sha256(b).hexdigest()
        folder = self.root/owner/'hunts'/hunt['id']/'saves'; folder.mkdir(parents=True)
        (folder/f'{sha(b"st")}.state').write_bytes(b'st'); (folder/f'{sha(b"parked")}.sav').write_bytes(b'parked')
        (folder/'current.json').write_text(json.dumps({'statePath': f'{sha(b"st")}.state', 'sramPath': f'{sha(b"parked")}.sav', 'stateSha256': sha(b'st'), 'sramSha256': sha(b'parked'), 'metadata': {'frame': 7}}))
        (self.root/owner/'active-hunt.json').write_text(json.dumps({'id': hunt['id'], 'nativeRadio': False}))
        (self.root/owner/'player-task-park-08b8c4c8.json').write_text(json.dumps({'request': park, 'nativeSaveVerified': True, 'savedSramSha256': sha(b'parked'),
                                                                                   'center': park['map'], 'grants': ['[107,9,2739568461]']}))
        self.assertEqual(extra.finish_helpers(), ['firered-partner-2'])
        partner = self.s.config()['games']['firered-partner-2']
        self.assertEqual((partner['seed']['sramSha256'], partner['extraSaveGrants'], partner['extraSaveSource']['profileId']), (sha(b'parked'), ['[107,9,2739568461]'], FIRE))
        self.assertEqual(extra.finish_helpers(), [])
        self.s.commands.clear()
        with self.assertRaisesRegex(ValueError, 'already serves as the partner owner firered-partner-2'):
            extra.seed_or_park(FIRE, lineage='2739568461')
        self.assertEqual(self.s.commands, [], 'the finished helper is not restarted')

    def test_a_task_that_stopped_is_reported_not_restarted(self):
        extra = self.extra(); extra.seed_or_park(FIRE, lineage='2739568461'); self.s.commands.clear()
        hunt = archive_rows()[1]['task']['hunt']
        self.s.live['firered-helper-1'] = {'owner': 'firered-helper-1', 'sessionId': 's3', 'mission': {'id': hunt['id'], 'state': 'blocked', 'reason': 'No verified pre-gift anchor is available.'}}
        extra.advance_helpers()
        self.assertEqual(self.s.commands, [])
        # The owner's explicit start is a reviewed retry of the stopped task.
        extra.start_helper(need_id='hitmon')
        self.assertEqual(self.s.commands, [('firered-helper-1', {'type': 'start', 'record': hunt, 'runScope': 'task', 'retryBlockedPolicy': True}, 's3')])

    def test_an_archive_with_both_tasks_takes_the_dojo_prize_then_its_roaming_dog_then_parks_with_both(self):
        rows = archive_rows()
        roamer = {'id': 'helper-roamer-245-08b8c4c8', 'request': {'speciesId': 245}, 'route': {'method': 'roamer'}}
        rows.append({'needId': 'roamer-suicune', 'species': [245], 'status': 'planned-long', 'source': rows[0]['source'],
                     'task': {'kind': 'roamer-capture', 'speciesId': 245, 'profileId': FIRE, 'lineage': '2739568461', 'hunt': roamer}, 'start': {'action': 'start-helper', 'needId': 'roamer-suicune'}})
        self.s.live['firered']['extraSaves'] = rows
        extra = self.extra(); extra.seed_or_park(FIRE, lineage='2739568461')
        owner, dojo = 'firered-helper-1', rows[1]['task']['hunt']
        self.assertEqual([t['hunt']['id'] for t in self.s.config()['games'][owner]['extraSaveHelper']['tasks']], [dojo['id'], roamer['id']])
        self.assertEqual(self.s.commands[-1][1]['record'], dojo, 'the short Dojo prize first')
        self.s.commands.clear()
        self.s.live[owner] = {'owner': owner, 'sessionId': 's4', 'mission': {'id': dojo['id'], 'state': 'complete'}}
        extra.advance_helpers()
        self.assertEqual(self.s.commands, [(owner, {'type': 'start', 'record': roamer, 'runScope': 'task'}, 's4')], 'then the roaming dog')
        self.s.commands.clear()
        (self.root/owner).mkdir(parents=True, exist_ok=True)
        (self.root/owner/f"archived-{dojo['id']}.json").write_text(json.dumps({'mission': {'status': 'complete'}}))  # the worker archives a finished hunt
        self.s.live[owner]['mission'] = {'id': roamer['id'], 'state': 'complete'}
        extra.advance_helpers()
        self.assertEqual(self.s.commands[0][1]['request']['goals'], [{'speciesId': 107}, {'speciesId': 245}], 'the park keeps both obtained individuals')


class RouteTests(unittest.TestCase):
    def test_progress_route_and_the_owners_explicit_partner_seeding(self):
        import sys
        sys.path.insert(0, str(Path(__file__).resolve().parent))
        from test_request_routes import Handler, Server
        with tempfile.TemporaryDirectory() as root:
            s = Sessions(root)
            profile(Path(root), FIRE)
            s.live['firered'] = {'owner': 'firered', 'extraSaves': [{'needId': 'fossil-dome', 'species': [140, 141], 'route': 'r', 'save': 'Helper save 1', 'status': 'needs-helper-save', 'doing': 'd'}]}
            server = Server(); server.pokemon_sessions = s
            handler = Handler(server)
            from urllib.parse import urlparse
            handler.route_get('/api/pokemon-suite/extra-saves', urlparse('/api/pokemon-suite/extra-saves'))
            status, body = handler.responses[-1]
            self.assertEqual(status, 200); self.assertEqual(body['rows'][0]['save'], 'Helper save 1'); self.assertEqual(body['rows'][0]['eta'], 'unknown')
            handler.route_post('/api/pokemon-suite/extra-saves/seed-partner', {'profileId': FIRE, 'lineage': '2739568461'})
            status, body = handler.responses[-1]
            self.assertEqual((status, body['owner']), (200, 'firered-partner-2'))
            handler.route_post('/api/pokemon-suite/extra-saves/seed-partner', {'profileId': FIRE, 'lineage': '2739568461'})
            self.assertEqual(handler.responses[-1][0], 400)
            denied = Handler(server, control=False)
            denied.route_get('/api/pokemon-suite/extra-saves', urlparse('/api/pokemon-suite/extra-saves'))
            self.assertEqual(denied.responses[-1][0], 403)

class ArchiveRouteTests(unittest.TestCase):
    def test_the_seed_route_prepares_an_unparked_archive_and_start_helper_takes_a_task_row(self):
        import sys
        sys.path.insert(0, str(Path(__file__).resolve().parent))
        from test_request_routes import Handler, Server
        with tempfile.TemporaryDirectory() as root:
            root = Path(root); s = Sessions(root); record = profile(root, FIRE)
            # The coordinator's cached decode says the archive is outside a Center.
            (root/'firered'/'extra-save-profiles.json').write_text(json.dumps({FIRE: {'sramSha256': record['source']['sramSha256'],
                'inventory': inventory(profile=FIRE, lineage='2739568461', label='FIRE', map='MAP_PALLET_TOWN', parked=False), 'reason': None}}))
            s.live['firered'] = {'owner': 'firered', 'extraSaves': archive_rows()}
            started = []
            def ensure(owner): s.live.setdefault(owner, {'owner': owner, 'sessionId': owner+'-session'}); return s.live[owner]
            s.ensure = ensure; s.start_partner = started.append
            server = Server(); server.pokemon_sessions = s
            handler = Handler(server)
            handler.route_post('/api/pokemon-suite/extra-saves/seed-partner', {'profileId': FIRE, 'lineage': '2739568461'})
            status, body = handler.responses[-1]
            self.assertEqual((status, body['owner'], body['role']), (200, 'firered-helper-1', 'helper'))
            self.assertEqual(started, [], 'a helper is not started as a partner')
            handler.route_post('/api/pokemon-suite/extra-saves/start-helper', {'needId': 'hitmon'})
            status, body = handler.responses[-1]
            self.assertEqual((status, body['owner']), (200, 'firered-helper-1'))
            handler.route_post('/api/pokemon-suite/extra-saves/start-helper', {'needId': 'starter-charmander'})
            self.assertEqual(handler.responses[-1][0], 400)
            handler.route_post('/api/pokemon-suite/extra-saves/start-helper', {'needId': 'hitmon', 'saveId': 'helper-1'})
            self.assertEqual(handler.responses[-1][0], 400)


class CoordinatorTests(unittest.TestCase):
    def test_an_extra_save_leg_prepares_only_its_named_partner_with_the_named_offer(self):
        with tempfile.TemporaryDirectory() as root:
            s = Sessions(root)
            offer = {'schema': 'pokemon-suite/extra-save-offer/v1', 'exchangeId': 'extra-save-starter-squirtle-100', 'mode': 'loan', 'leg': 'open', 'fingerprint': '[9]', 'expectSource': '[16]'}
            s.live['firered'] = {'game': 'firered', 'sessionId': 'red', 'gameProgress': {'trainerId': 10933}, 'bot': {'enabled': True, 'runScope': 'postgame',
                                 'preparation': {'automatic': True, 'kind': 'extra-save', 'requestId': 'extra-save-starter-squirtle-100-open', 'phase': 'waiting-for-transfer', 'partnerOwner': 'firered-partner', 'offer': offer}}}
            s.live['firered-partner'] = {'game': 'firered', 'owner': 'firered-partner', 'sessionId': 'blue', 'gameProgress': {'trainerId': 8185},
                                         'bot': {'enabled': True, 'mode': 'evolution-partner', 'awaitingCommand': True}, 'control': {'mode': 'bot', 'manualSessionCount': 0}}
            PostgamePartners(s).tick()
            self.assertEqual(s.commands, [('firered-partner', {'type': 'prepare-partner', 'requestId': 'extra-save-starter-squirtle-100-open', 'automatic': True, 'sourceOwner': 'firered', 'offer': offer}, 'blue')])


if __name__ == '__main__':
    unittest.main()
