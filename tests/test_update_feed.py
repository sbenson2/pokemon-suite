from datetime import datetime,timedelta,timezone
import json
from pathlib import Path
import tempfile
import unittest
from urllib.parse import urlsplit
from tuf.api.metadata import Metadata,Root,Targets,Snapshot,Timestamp,TargetFile,MetaFile
from tuf.api.exceptions import DownloadHTTPError
from tuf.ngclient.fetcher import FetcherInterface
from securesystemslib.signer import CryptoSigner
from cryptography.hazmat.primitives.asymmetric.ed25519 import Ed25519PrivateKey
from test_packages import package

class MemoryFetcher(FetcherInterface):
 def __init__(self,files):self.files=files
 def _fetch(self,url):
  name=urlsplit(url).path.lstrip('/')
  if name not in self.files:raise DownloadHTTPError('missing',404)
  yield self.files[name]

def repository(root,expired=False,keys=None):
 expires=datetime.now(timezone.utc)+timedelta(days=-1 if expired else 1)
 keys=keys or {r:CryptoSigner.generate_ed25519() for r in ('root','targets','snapshot','timestamp')}
 trust=Metadata(Root(expires=datetime.now(timezone.utc)+timedelta(days=365),consistent_snapshot=False))
 for role,key in keys.items():trust.signed.add_key(key.public_key,role)
 trust.sign(keys['root']);files={'metadata/root.json':trust.to_bytes(),'metadata/1.root.json':trust.to_bytes()}
 payload=package(root,Ed25519PrivateKey.generate()).read_bytes()
 targets={'engine.pksuite':payload,'catalog.json':json.dumps({'schema':'pokemon-suite/feed/v1','packages':[{'id':'test-engine','version':'1.0.0','target':'engine.pksuite'}]}).encode()}
 m=Metadata(Targets(expires=expires,targets={p:TargetFile.from_data(p,b) for p,b in targets.items()}));m.sign(keys['targets']);files['metadata/targets.json']=m.to_bytes()
 s=Metadata(Snapshot(expires=expires,meta={'targets.json':MetaFile.from_data(1,m.to_bytes(),['sha256'])}));s.sign(keys['snapshot']);files['metadata/snapshot.json']=s.to_bytes()
 t=Metadata(Timestamp(expires=expires,snapshot_meta=MetaFile.from_data(1,s.to_bytes(),['sha256'])));t.sign(keys['timestamp']);files['metadata/timestamp.json']=t.to_bytes()
 files.update({'targets/'+p:b for p,b in targets.items()});return files

class FeedTests(unittest.TestCase):
 def setUp(self):
  from pokemon_suite.update_feed import UpdateFeed
  self.tmp=tempfile.TemporaryDirectory();self.addCleanup(self.tmp.cleanup);self.root=Path(self.tmp.name)
  self.keys={r:CryptoSigner.generate_ed25519() for r in ('root','targets','snapshot','timestamp')}
  self.files=repository(self.root,keys=self.keys);self.feed=UpdateFeed(self.root/'profile',fetcher=MemoryFetcher(self.files))
  self.feed.configure('https://updates.example/',self.files['metadata/root.json'])
 def test_tuf_verified_target_can_be_installed_without_a_separate_local_signer(self):
  self.assertEqual(self.feed.check()['packages'][0]['version'],'1.0.0')
  self.assertEqual(self.feed.install('engine.pksuite')['version'],'1.0.0')
 def test_expired_metadata_and_tampered_target_fail_closed(self):
  self.feed.check();self.files['targets/engine.pksuite']+=b'changed'
  with self.assertRaises(Exception):self.feed.install('engine.pksuite')
  self.assertEqual(self.feed.store.status()['installed'],[])
  from pokemon_suite.update_feed import UpdateFeed
  expired=repository(self.root,expired=True,keys=self.keys)
  other=UpdateFeed(self.root/'expired-client',fetcher=MemoryFetcher(expired));other.configure('https://updates.example/',expired['metadata/root.json'])
  with self.assertRaisesRegex(Exception,'expired'):other.check()
 def test_plain_http_is_only_available_for_explicit_loopback_development(self):
  with self.assertRaisesRegex(ValueError,'HTTPS'):self.feed.configure('http://example.com/',self.files['metadata/root.json'])
