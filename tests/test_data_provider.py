import json
from pathlib import Path
import tempfile
import unittest
from test_packages import package
from cryptography.hazmat.primitives.asymmetric.ed25519 import Ed25519PrivateKey

class DataProviderTests(unittest.TestCase):
    def setUp(self):
        from pokemon_suite.data_provider import DataProvider
        self.tmp=tempfile.TemporaryDirectory();self.addCleanup(self.tmp.cleanup)
        self.root=Path(self.tmp.name);self.provider=DataProvider(self.root)
    def test_profiles_and_pinned_requests_keep_their_own_revision(self):
        import base64
        from cryptography.hazmat.primitives.serialization import Encoding,PublicFormat
        from pokemon_suite.data_provider import DataProvider
        from pokemon_suite.packages import PackageStore
        store=PackageStore(self.root);key=Ed25519PrivateKey.generate()
        store.trust_key(base64.b64encode(key.public_key().public_bytes(Encoding.Raw,PublicFormat.Raw)).decode(),label='Test data')
        with self.provider.snapshot() as original:
            first=original.read('pokedex/firered.json','firered');lock=original.lock()
        changed={**first,'testRevision':'new-data'}
        p=package(self.root,key,files={'data/pokedex/firered.json':json.dumps(changed).encode()},extra={'id':'test-data','kind':'data','entrypoints':{'data':'data'}})
        receipt=store.install(p);store.activate('firered',receipt['digest'])
        with self.provider.snapshot() as current:self.assertEqual(current.read('pokedex/firered.json','firered')['testRevision'],'new-data')
        with self.provider.snapshot(lock) as pinned:self.assertNotIn('testRevision',pinned.read('pokedex/firered.json','firered'))
        with DataProvider(self.root/'second-profile').snapshot() as other:self.assertNotIn('testRevision',other.read('pokedex/firered.json','firered'))
    def test_a_missing_or_changed_pinned_fact_fails_instead_of_falling_back(self):
        with self.provider.snapshot() as s:s.read('pokedex/firered.json','firered');lock=s.lock()
        entry=next(iter(lock['files'].values()));(self.root/'data-cache'/entry).write_bytes(b'{}')
        with self.provider.snapshot(lock) as s:
            with self.assertRaisesRegex(ValueError,'checksum'):s.read('pokedex/firered.json','firered')
    def test_invalid_game_projection_is_not_used(self):
        from pokemon_suite.data_provider import validate_data
        with self.assertRaisesRegex(ValueError,'species|projection'):validate_data('pokedex/firered.json',{'species':[{'id':1},{'id':1}],'nationalCount':386},'firered')
    def test_binary_pokedex_is_pinned_and_detects_later_corruption(self):
        import sqlite3
        from pokemon_suite.data_provider import DataSnapshot
        self.assertTrue(hasattr(DataSnapshot,'resource_path'),'offline databases need the same revision pinning as JSON facts')
        with self.provider.snapshot() as s:
            path=s.resource_path('pokedex/master.sqlite3','firered');lock=s.lock()
            with sqlite3.connect('file:'+str(path)+'?mode=ro',uri=True) as db:self.assertGreater(db.execute('SELECT COUNT(*) FROM pokemon_species').fetchone()[0],1000)
        path.write_bytes(b'corrupt')
        with self.provider.snapshot(lock) as s:
            with self.assertRaisesRegex(ValueError,'checksum'):s.resource_path('pokedex/master.sqlite3','firered')
