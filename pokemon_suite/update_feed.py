"""TUF verifies release metadata, expiration, rollback and downloaded targets."""
import hashlib
import json
from pathlib import Path
from urllib.parse import urlsplit
from .packages import PackageStore,path_name
from .suite_save_store import atomic_file

class UpdateFeed:
 def __init__(self,directory,*,fetcher=None):
  self.store=PackageStore(directory);self.directory=Path(directory)/'packages/feed';self.fetcher=fetcher
 def configure(self,url,root):
  from tuf.api.metadata import Metadata,Root
  parsed=urlsplit(url)
  if parsed.username or parsed.password or parsed.query or parsed.fragment or not parsed.hostname or (parsed.scheme!='https' and not (parsed.scheme=='http' and parsed.hostname in {'127.0.0.1','localhost','::1'})):
   raise ValueError('Use an HTTPS release feed, or a loopback address for local development.')
  if len(root)>1024*1024:raise ValueError('The trusted root is too large.')
  metadata=Metadata.from_bytes(root)
  if not isinstance(metadata.signed,Root):raise ValueError('Choose a TUF root metadata file from the release maintainer.')
  metadata.verify_delegate('root',metadata)
  identity=hashlib.sha256(root).hexdigest();config={'url':url.rstrip('/')+'/','rootSha256':identity}
  with self.store.exclusive():
   self.directory.mkdir(parents=True,exist_ok=True,mode=0o700)
   atomic_file(self.directory/(identity+'.root.json'),root)
   atomic_file(self.directory/'config.json',json.dumps(config).encode())
  return config
 def status(self):
  try:config=json.loads((self.directory/'config.json').read_text())
  except FileNotFoundError:return {'configured':False,'message':'No public release feed is configured. Signed local packages can be imported.'}
  return {'configured':True,**config}
 def _updater(self):
  from tuf.ngclient import Updater
  status=self.status()
  if not status['configured']:raise ValueError(status['message'])
  raw=(self.directory/(status['rootSha256']+'.root.json')).read_bytes()
  if hashlib.sha256(raw).hexdigest()!=status['rootSha256']:raise ValueError('The trusted root checksum changed.')
  # Separate trust domains. Changing channels cannot reuse another root's cache.
  domain=hashlib.sha256((status['url']+status['rootSha256']).encode()).hexdigest()
  metadata=self.directory/domain/'metadata';targets=self.directory/domain/'targets'
  metadata.mkdir(parents=True,exist_ok=True);targets.mkdir(exist_ok=True)
  return Updater(str(metadata),status['url']+'metadata/',str(targets),status['url']+'targets/',fetcher=self.fetcher,bootstrap=raw)
 def _catalog(self,updater):
  updater.refresh();info=updater.get_targetinfo('catalog.json')
  if not info or info.length>2*1024*1024:raise ValueError('The verified feed catalog is missing or too large.')
  data=json.loads(Path(updater.download_target(info)).read_bytes())
  if not isinstance(data,dict) or data.get('schema')!='pokemon-suite/feed/v1' or not isinstance(data.get('packages'),list):raise ValueError('Unsupported release catalog.')
  if len(data['packages'])>1000:raise ValueError('The release catalog exceeds the package limit.')
  for p in data['packages']:path_name(p['target'])
  return data
 def check(self):
  with self.store.exclusive():return self._catalog(self._updater())
 def install(self,target):
  path_name(target)
  # Serialize metadata refresh, but release the store lock before installation.
  with self.store.exclusive():
   updater=self._updater();catalog=self._catalog(updater)
   if not any(p['target']==target for p in catalog['packages']):raise ValueError('Choose a package in the verified release catalog.')
   info=updater.get_targetinfo(target)
   if not info or info.length>512*1024*1024 or 'sha256' not in info.hashes:raise ValueError('Invalid verified package target.')
   path=updater.download_target(info)
  return self.store.install(path,verified_sha256=info.hashes['sha256'],source='tuf:'+self.status()['url'])
