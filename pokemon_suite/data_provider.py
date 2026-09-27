"""Profile-scoped immutable game facts, pinned for each saved task.

JSON projections remain the import/export format. The provider boundary allows
compiled indexes without changing planners, or conflating native and Dex IDs.
"""
from contextlib import contextmanager
from contextvars import ContextVar
from copy import deepcopy
from functools import wraps, lru_cache
import hashlib
import json
from pathlib import Path
from .packages import PackageStore, DIGEST, path_name
from .suite_save_store import atomic_file

CURRENT = ContextVar('pokemon_suite_data', default=None)
BUNDLED = Path(__file__).parent/'static/data'


@lru_cache(maxsize=32)
def _blob_digest(path,signature):
    with Path(path).open('rb') as stream:return hashlib.file_digest(stream,'sha256').hexdigest()

@lru_cache(maxsize=32)
def _checked_blob(path, digest, signature):
    with Path(path).open('rb') as stream:
        if hashlib.file_digest(stream,'sha256').hexdigest()!=digest:raise ValueError('Pinned game data checksum mismatch.')
    return Path(path)


def validate_data(name, value, game):
    if not isinstance(value, dict):
        raise ValueError('A data projection must be an object.')
    if name == f'pokedex/{game}.json':
        species=value.get('species');count=value.get('nationalCount')
        if type(count) is not int or not isinstance(species,list) or not species:
            raise ValueError('Invalid species projection.')
        ids=[s.get('id') for s in species if isinstance(s,dict)]
        if len(ids)!=len(species) or any(type(i) is not int or not 1<=i<=count for i in ids) or len(set(ids))!=len(ids):
            raise ValueError('Invalid or duplicate species identifiers in the game projection.')
        if any(not isinstance(s.get('encounters'),list) or not isinstance(s.get('learnset'),list) for s in species):
            raise ValueError('Species projections need encounter and learnset lists.')
    elif name.endswith('evolution-rules.json') and not isinstance(value.get('games'),dict):
        raise ValueError('Evolution data needs explicit game projections.')
    elif name.endswith('hunt-routes.json') and not isinstance(value.get('routes'),list):
        raise ValueError('Encounter data needs a route list.')
    return value


class DataSnapshot:
    def __init__(self, provider, lock=None):
        self.provider=provider;self.pinned=lock is not None;self.files={};self.values={};self.packages={}
        if lock is not None:
            if not isinstance(lock,dict) or lock.get('schema')!='pokemon-suite/data-lock/v1' or not isinstance(lock.get('files'),dict):
                raise ValueError('Invalid saved data revision.')
            if any(not isinstance(v,str) or not DIGEST.fullmatch(v) for v in lock['files'].values()):raise ValueError('Invalid data checksum.')
            self.files=dict(lock['files'])
    def read(self,name,game='firered'):
        path_name(name);key=f'{game}:{name}'
        if key in self.values:return deepcopy(self.values[key])
        cache=self.provider.directory/'data-cache'
        if self.pinned:
            if key not in self.files:raise ValueError('The saved task does not include this game data. Review a new request.')
            try:raw=(cache/self.files[key]).read_bytes()
            except FileNotFoundError as error:raise ValueError('The pinned game data is missing. Restore its data cache before resuming.') from error
            if hashlib.sha256(raw).hexdigest()!=self.files[key]:raise ValueError('Pinned game data checksum mismatch.')
        else:
            if game not in self.packages:self.packages[game]=self.provider.packages.resolve(game,kind='data')
            package=self.packages[game]
            path=Path(package['data'])/name if package and 'data' in package else BUNDLED/name
            if package and path.is_relative_to(Path(package['directory'])):
                inventory={e['path'] for e in package['manifest']['files']}
                if path.relative_to(package['directory']).as_posix() not in inventory:path=BUNDLED/name
            # Partial packages may explicitly replace only a subset of facts.
            if not path.is_file() and package:path=BUNDLED/name
            raw=path.read_bytes();self.files[key]=hashlib.sha256(raw).hexdigest()
        value=validate_data(name,json.loads(raw),game)
        if not self.pinned:
            cache.mkdir(parents=True,exist_ok=True,mode=0o700)
            dest=cache/self.files[key]
            if not dest.exists():atomic_file(dest,raw)
        self.values[key]=value
        return deepcopy(value)
    def resource_path(self,name,game='firered'):
        """Pin binary resources without parsing or retaining a database in memory."""
        path_name(name);key=f'{game}:{name}';cache=self.provider.directory/'data-cache'
        if key not in self.files:
            if self.pinned:raise ValueError('The saved task does not include this game data.')
            package=self.provider.packages.resolve(game,kind='data')
            source=Path(package['data'])/name if package and 'data' in package else BUNDLED/name
            if package and source.is_relative_to(Path(package['directory'])):
                inventory={entry['path'] for entry in package['manifest']['files']}
                if source.relative_to(package['directory']).as_posix() not in inventory:source=BUNDLED/name
            if not source.is_file() and package:source=BUNDLED/name
            stat=source.stat();digest=_blob_digest(str(source),(stat.st_ino,stat.st_size,stat.st_mtime_ns,stat.st_ctime_ns));self.files[key]=digest
            cache.mkdir(parents=True,exist_ok=True,mode=0o700)
            if not (cache/digest).exists():atomic_file(cache/digest,source.read_bytes())
        target=cache/self.files[key]
        try:stat=target.stat()
        except FileNotFoundError as error:raise ValueError('Pinned game data is missing.') from error
        return _checked_blob(str(target),self.files[key],(stat.st_ino,stat.st_size,stat.st_mtime_ns,stat.st_ctime_ns))
    def lock(self):return {'schema':'pokemon-suite/data-lock/v1','files':dict(self.files)}


class DataProvider:
    def __init__(self,directory):
        self.directory=Path(directory);self.packages=PackageStore(directory)
    @contextmanager
    def snapshot(self,lock=None):
        snapshot=DataSnapshot(self,lock);token=CURRENT.set(snapshot)
        try:yield snapshot
        finally:CURRENT.reset(token)


def read_data(name,game='firered'):
    snapshot=CURRENT.get()
    if snapshot:return snapshot.read(name,game)
    return validate_data(name,json.loads((BUNDLED/name).read_text()),game)


def with_game_data(method):
    """One coherent revision for nested planning and executor preflight calls."""
    @wraps(method)
    def wrapped(self,*args,**kwargs):
        if CURRENT.get() is not None:return method(self,*args,**kwargs)
        directory=getattr(self.executor,'directory',self.directory)
        lock=None
        if method.__name__=='start' and args:lock=self.get(args[0]).get('plan',{}).get('dataLock')
        with DataProvider(directory).snapshot(lock):return method(self,*args,**kwargs)
    return wrapped
