"""Immutable, verified software/data packages outside the application bundle."""
from contextlib import contextmanager
import base64
import hashlib
import json
import io
from pathlib import Path, PurePosixPath
import platform
import re
import stat
import tempfile
import zipfile

from .file_lock import flock, LOCK_EX
from .suite_save_store import atomic_file

HOST_API = 1
WORKER_PROTOCOL = 1
DOMAIN = b'pokemon-suite-package/v1\n'
IDENTIFIER = re.compile(r'[a-z][a-z0-9.-]{0,79}\Z')
VERSION = re.compile(r'(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)(?:[-+][A-Za-z0-9.+-]+)?\Z')
DIGEST = re.compile(r'[a-f0-9]{64}\Z')
KINDS = {'engine', 'planner', 'data', 'game', 'emulator'}
MAX_BYTES = 512 * 1024 * 1024
MAX_FILES = 10000


def digest(data):
    return hashlib.sha256(data).hexdigest()


def path_name(value):
    if not isinstance(value, str) or not value or len(value) > 300:
        raise ValueError('Invalid package path.')
    p = PurePosixPath(value)
    reserved = {'CON', 'PRN', 'AUX', 'NUL', *(f'COM{i}' for i in range(10)), *(f'LPT{i}' for i in range(10))}
    if p.is_absolute() or p.as_posix() != value or any(
        x in {'.', '..'} or x.endswith((' ', '.')) or x.split('.')[0].upper() in reserved for x in p.parts
    ) or any(ord(c) < 32 or c in '\\:' for c in value):
        raise ValueError('Invalid package path.')
    return value


def validate_manifest(m):
    if not isinstance(m, dict) or m.get('schema') != 'pokemon-suite/package/v1':
        raise ValueError('Unknown package schema.')
    if not IDENTIFIER.fullmatch(m.get('id', '')) or not VERSION.fullmatch(m.get('version', '')) or m.get('kind') not in KINDS:
        raise ValueError('Invalid package identity or version.')
    for key in ('hostApi', 'workerProtocol'):
        if type(m.get(key)) is not int or m[key] < 1:
            raise ValueError('A package must declare its host and worker protocols.')
    for key in ('games', 'platforms', 'stateSchemas'):
        if not isinstance(m.get(key), list) or not all(isinstance(x, str) and x for x in m[key]):
            raise ValueError('Invalid package compatibility declaration.')
    files = m.get('files')
    if not isinstance(files, list) or not 1 <= len(files) <= MAX_FILES:
        raise ValueError('Invalid package file inventory.')
    names = set(); total = 0
    for entry in files:
        name = path_name(entry.get('path'))
        if name.casefold() in names or name in {'manifest.json', 'signature.json', 'receipt.json'}:
            raise ValueError('Duplicate or reserved package path.')
        names.add(name.casefold())
        if type(entry.get('bytes')) is not int or not 0 <= entry['bytes'] <= 128*1024*1024 or not DIGEST.fullmatch(entry.get('sha256', '')):
            raise ValueError('Invalid package file size or checksum.')
        total += entry['bytes']
    if total > MAX_BYTES:
        raise ValueError('Package exceeds the installed size limit.')
    if not isinstance(m.get('entrypoints', {}), dict):
        raise ValueError('Invalid package entrypoints.')
    for name in m.get('entrypoints', {}).values():
        path_name(name)
        if not any(e['path'] == name or e['path'].startswith(name+'/') for e in files):
            raise ValueError('Package entrypoint is not in its file inventory.')
    if m['kind'] == 'engine' and 'worker' not in m.get('entrypoints', {}):
        raise ValueError('An engine package needs a worker entrypoint.')
    if m['kind'] == 'engine' and not any(e['path'] == m['entrypoints']['worker'] for e in files):
        raise ValueError('An engine worker entrypoint must be a file.')
    if m['kind'] == 'planner' and not any(e['path'] == m.get('entrypoints', {}).get('campaignPlanner') for e in files):
        raise ValueError('A planner package needs a campaignPlanner module entrypoint.')
    if m['kind']=='game' and (not isinstance(m.get('romSha1s'),list) or not m['romSha1s'] or any(not isinstance(v,str) or not re.fullmatch('[a-f0-9]{40}',v) for v in m['romSha1s'])):
        raise ValueError('Game packages must identify exact cartridge revisions.')
    if m['kind']=='emulator' and m.get('backend') not in {'wasm','libretro'}:
        raise ValueError('Choose the supported emulator host adapter.')
    if not isinstance(m.get('dependencies'), list):
        raise ValueError('Invalid package dependency graph.')
    for dep in m['dependencies']:
        if not IDENTIFIER.fullmatch(dep.get('id', '')) or not VERSION.fullmatch(dep.get('version', '')) or not DIGEST.fullmatch(dep.get('digest', '')):
            raise ValueError('Invalid pinned package dependency.')
    return m


class PackageStore:
    def __init__(self, directory):
        self.profile = Path(directory)
        self.directory = self.profile/'packages'
        self.objects = self.directory/'objects'

    @contextmanager
    def exclusive(self):
        self.directory.mkdir(parents=True, exist_ok=True, mode=0o700)
        with (self.directory/'store.lock').open('a+b') as lock:
            flock(lock, LOCK_EX)
            yield

    def _json(self, path, fallback):
        try:
            return json.loads(path.read_text())
        except FileNotFoundError:
            return fallback

    def trust_key(self, public_key, *, label):
        raw = base64.b64decode(public_key, validate=True)
        if len(raw) != 32 or not isinstance(label, str) or not label.strip():
            raise ValueError('Choose a named Ed25519 public release key.')
        with self.exclusive():
            path = self.directory/'trusted-keys.json'
            keys = self._json(path, {})
            keys[digest(raw)] = {'publicKey': public_key, 'label': label}
            atomic_file(path, (json.dumps(keys, indent=2)+'\n').encode())
        return digest(raw)

    def install(self, archive, *, verified_sha256=None, source='local-signed-package'):
        """verified_sha256 is supplied only by the trusted TUF client, not HTTP input."""
        archive = Path(archive)
        if archive.stat().st_size > MAX_BYTES:
            raise ValueError('Package archive exceeds the size limit.')
        with archive.open('rb') as source_file:
            archive_bytes = source_file.read(MAX_BYTES+1)
        if len(archive_bytes) > MAX_BYTES:
            raise ValueError('Package archive exceeds the size limit.')
        archive_hash = digest(archive_bytes)
        if verified_sha256 is not None and archive_hash != verified_sha256:
            raise ValueError('The verified package archive checksum changed.')
        with self.exclusive(), zipfile.ZipFile(io.BytesIO(archive_bytes)) as z:
            entries = z.infolist()
            if len(entries) > MAX_FILES+2 or sum(e.file_size for e in entries) > MAX_BYTES+2*1024*1024:
                raise ValueError('Package archive exceeds the size limit.')
            folded = set()
            for e in entries:
                name = path_name(e.filename)
                if name.casefold() in folded or e.is_dir() or stat.S_ISLNK(e.external_attr >> 16):
                    raise ValueError('Duplicate, directory, or symbolic-link package entry.')
                folded.add(name.casefold())
            if 'manifest.json' not in z.namelist() or z.getinfo('manifest.json').file_size > 2*1024*1024:
                raise ValueError('Missing or oversized package manifest.')
            raw = z.read('manifest.json')
            if verified_sha256 is None:
                self._signature(raw, z.read('signature.json') if 'signature.json' in z.namelist() else b'{}')
            manifest = validate_manifest(json.loads(raw))
            from .bot_verification import require_bot_verification
            require_bot_verification(manifest)
            expected = {x['path'] for x in manifest['files']} | {'manifest.json'}
            if 'signature.json' in z.namelist():
                expected.add('signature.json')
            if set(z.namelist()) != expected:
                raise ValueError('Package contains files outside its signed inventory.')
            identity = digest(raw)
            for installed in self.status()['installed']:
                if (installed['id'], installed['version']) == (manifest['id'], manifest['version']) and installed['digest'] != identity:
                    raise ValueError('A published package version is immutable. Publish a new version.')
            self.objects.mkdir(exist_ok=True)
            target = self.objects/identity
            with tempfile.TemporaryDirectory(prefix='.stage-', dir=self.objects) as tmp:
                stage = Path(tmp)
                for entry in manifest['files']:
                    if z.getinfo(entry['path']).file_size != entry['bytes']:
                        raise ValueError('Package file size mismatch.')
                    data = z.read(entry['path'])
                    if digest(data) != entry['sha256']:
                        raise ValueError('Package file checksum mismatch.')
                    dest = stage/entry['path']; dest.parent.mkdir(parents=True, exist_ok=True)
                    dest.write_bytes(data)
                (stage/'manifest.json').write_bytes(raw)
                receipt = {'id': manifest['id'], 'version': manifest['version'], 'kind': manifest['kind'],
                           'digest': identity, 'games': manifest['games'], 'source': source, 'archiveSha256': archive_hash}
                (stage/'receipt.json').write_text(json.dumps(receipt, indent=2)+'\n')
                if target.exists():
                    self.verify(identity)
                else:
                    stage.rename(target)
            return receipt

    def _signature(self, raw, signature):
        try:
            from cryptography.hazmat.primitives.asymmetric.ed25519 import Ed25519PublicKey
            from cryptography.exceptions import InvalidSignature
        except ImportError as error:
            raise ValueError('Install the Suite update dependencies before importing a signed package.') from error
        try:
            signature = json.loads(signature)
            key = self._json(self.directory/'trusted-keys.json', {}).get(signature.get('keyId'))
            if not key:
                raise ValueError('The package was not signed by a trusted release key.')
            pub = base64.b64decode(key['publicKey'], validate=True)
            Ed25519PublicKey.from_public_bytes(pub).verify(base64.b64decode(signature['signature'], validate=True), DOMAIN+raw)
        except (KeyError, InvalidSignature) as error:
            raise ValueError('The package signature could not be verified.') from error

    def verify(self, identity):
        if not isinstance(identity, str) or not DIGEST.fullmatch(identity):
            raise ValueError('Invalid package checksum.')
        directory = self.objects/identity
        if directory.is_symlink():
            raise ValueError('Package directory must not be a symbolic link.')
        try:
            raw = (directory/'manifest.json').read_bytes()
        except FileNotFoundError as error:
            raise ValueError('A required package is not installed.') from error
        if digest(raw) != identity:
            raise ValueError('Installed package manifest checksum mismatch.')
        manifest = validate_manifest(json.loads(raw))
        for entry in manifest['files']:
            relative = Path(entry['path']); path = directory/relative
            if any((directory/Path(*relative.parts[:i])).is_symlink() for i in range(1, len(relative.parts)+1)):
                raise ValueError('Installed package files must not be symbolic links.')
            if not path.is_file() or path.stat().st_size != entry['bytes'] or digest(path.read_bytes()) != entry['sha256']:
                raise ValueError('Installed package file size or checksum mismatch.')
        return manifest

    def _graph(self, identity, game, seen=None):
        seen = set() if seen is None else seen
        if identity in seen or len(seen) > 64:
            raise ValueError('Cyclic or oversized package dependency graph.')
        seen = {*seen, identity}; manifest = self.verify(identity)
        host = f'{sys_platform()}-{platform.machine().lower()}'
        if manifest['hostApi'] != HOST_API or manifest['workerProtocol'] != WORKER_PROTOCOL:
            raise ValueError('This package requires a different Suite host or worker protocol.')
        if 'any' not in manifest['platforms'] and host not in manifest['platforms']:
            raise ValueError('This package is not compatible with this operating system and CPU.')
        if game not in manifest['games']:
            raise ValueError('This package does not support the selected game.')
        graph = [{'id': manifest['id'], 'version': manifest['version'], 'digest': identity, 'kind': manifest['kind']}]
        for dep in manifest['dependencies']:
            children = self._graph(dep['digest'], game, seen)
            if children[0]['id'] != dep['id'] or children[0]['version'] != dep['version']:
                raise ValueError('A package dependency identity changed.')
            for child in children:
                prior = next((p for p in graph if p['id'] == child['id']), None)
                if prior and prior != child:
                    raise ValueError('Conflicting package dependency versions.')
                if not prior:
                    graph.append(child)
        return graph

    def activate(self, game, identity):
        with self.exclusive():
            graph = self._graph(identity, game)
            path = self.directory/'active.json'; active = self._json(path, {})
            active[f'{graph[0]["kind"]}:{game}'] = identity
            atomic_file(path, (json.dumps(active, indent=2)+'\n').encode())
        return self.resolve(game, kind=graph[0]['kind'])

    def resolve(self, game, *, kind='engine', lock=None):
        if lock is not None:
            if lock.get('schema') != 'pokemon-suite/run-lock/v1' or lock.get('game') != game or not lock.get('packages'):
                raise ValueError('Invalid pinned run package graph.')
            identity = lock['packages'][0]['digest']
        else:
            identity = self._json(self.directory/'active.json', {}).get(f'{kind}:{game}')
        if identity is None:
            return None
        graph = self._graph(identity, game)
        if graph[0]['kind'] != kind or lock is not None and lock['packages'] != graph:
            raise ValueError('The pinned run package graph changed.')
        manifest = self.verify(identity); directory = self.objects/identity
        return {'lock': {'schema': 'pokemon-suite/run-lock/v1', 'game': game, 'packages': graph},
                'manifest': manifest, 'directory': str(directory),
                **{k: str(directory/v) for k, v in manifest.get('entrypoints', {}).items()}}

    def status(self):
        installed = []
        if self.objects.exists():
            for path in self.objects.iterdir():
                if DIGEST.fullmatch(path.name) and not path.is_symlink():
                    receipt = self._json(path/'receipt.json', None)
                    if receipt:
                        installed.append(receipt)
        return {'schema': 'pokemon-suite/packages/v1', 'hostApi': HOST_API, 'workerProtocol': WORKER_PROTOCOL,
                'installed': sorted(installed, key=lambda x: (x['id'], x['version'])),
                'active': self._json(self.directory/'active.json', {}),
                'trustedKeys': [{'keyId': k, 'label': v['label']} for k, v in self._json(self.directory/'trusted-keys.json', {}).items()]}


def sys_platform():
    import sys
    return sys.platform
