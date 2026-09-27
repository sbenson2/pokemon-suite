import base64
import hashlib
import json
from pathlib import Path
import tempfile
import unittest
import zipfile

from cryptography.hazmat.primitives.asymmetric.ed25519 import Ed25519PrivateKey
from cryptography.hazmat.primitives.serialization import Encoding, PublicFormat


def package(root, key, *, version='1.0.0', files=None, extra=None, corrupt=False):
    files = files or {'engine/worker.js': b'process.stdout.write("ready")'}
    manifest = {'schema': 'pokemon-suite/package/v1', 'id': 'test-engine', 'version': version,
                'kind': 'engine', 'hostApi': 1, 'workerProtocol': 1, 'games': ['firered', 'emerald'],
                'platforms': ['any'], 'dependencies': [], 'stateSchemas': ['pokemon-suite/campaign-state/v1'],
                'entrypoints': {'worker': 'engine/worker.js'},
                'files': [{'path': p, 'bytes': len(b), 'sha256': hashlib.sha256(b).hexdigest()} for p, b in files.items()],
                **(extra or {})}
    if 'verification' not in manifest:
        manifest['verification'] = passing_proof(manifest['files'])
    raw = (json.dumps(manifest, sort_keys=True, separators=(',', ':'))+'\n').encode()
    pub = key.public_key().public_bytes(Encoding.Raw, PublicFormat.Raw)
    signature = {'keyId': hashlib.sha256(pub).hexdigest(), 'signature': base64.b64encode(key.sign(b'pokemon-suite-package/v1\n'+raw)).decode()}
    path = root/(version+'.pksuite')
    with zipfile.ZipFile(path, 'w') as z:
        z.writestr('manifest.json', raw); z.writestr('signature.json', json.dumps(signature))
        for p, b in files.items(): z.writestr(p, b+b'changed' if corrupt else b)
    return path


def passing_proof(files):
    # Synthetic evidence belongs only to these signed transport fixtures.
    inventory = sorted(files, key=lambda e: e['path'])
    return {'schema': 'pokemon-suite/bot-verification/v1', 'status': 'passed',
            'sourceSha256': '1'*64,
            'payloadSha256': hashlib.sha256(json.dumps(inventory, sort_keys=True, separators=(',', ':')).encode()).hexdigest(),
            'checks': [{'id': name, 'tests': 1, 'passed': 1, 'failed': 0, 'skipped': 0}
                       for name in ['rom-integrity', 'engine', 'host', 'adapters', 'native-replays']]}


class PackageTests(unittest.TestCase):
    def setUp(self):
        from pokemon_suite.packages import PackageStore
        self.tmp = tempfile.TemporaryDirectory(); self.addCleanup(self.tmp.cleanup)
        self.root = Path(self.tmp.name); self.key = Ed25519PrivateKey.generate()
        self.store = PackageStore(self.root/'profile')
        pub = self.key.public_key().public_bytes(Encoding.Raw, PublicFormat.Raw)
        self.store.trust_key(base64.b64encode(pub).decode(), label='Local test release key')

    def test_verified_package_is_immutable_and_resolves_its_executable(self):
        installed = self.store.install(package(self.root, self.key))
        self.store.activate('firered', installed['digest'])
        resolved = self.store.resolve('firered')
        self.assertEqual(Path(resolved['worker']).read_bytes(), b'process.stdout.write("ready")')
        self.assertEqual(resolved['lock']['packages'][0]['version'], '1.0.0')
        with self.assertRaisesRegex(ValueError, 'immutable|version'):
            self.store.install(package(self.root, self.key, files={'engine/worker.js': b'changed'}))

    def test_unknown_signer_cannot_install_executable_code(self):
        with self.assertRaisesRegex(ValueError, 'trusted|signature'):
            self.store.install(package(self.root, Ed25519PrivateKey.generate()))
        self.assertEqual(self.store.status()['installed'], [])

    def test_changed_payload_cannot_activate_even_when_the_manifest_is_signed(self):
        with self.assertRaisesRegex(ValueError, 'checksum|size'):
            self.store.install(package(self.root, self.key, corrupt=True))
        self.assertIsNone(self.store.resolve('firered'))

    def test_path_escape_and_case_collisions_are_rejected_before_extraction(self):
        for files in [{'../outside': b'x'}, {'engine/X.js': b'x', 'engine/x.js': b'y'}]:
            with self.subTest(files=files), self.assertRaises(ValueError):
                self.store.install(package(self.root, self.key, files=files))
        self.assertFalse((self.root/'outside').exists())

    def test_incompatible_host_and_missing_dependency_keep_the_active_version(self):
        good = self.store.install(package(self.root, self.key)); self.store.activate('firered', good['digest'])
        for version, extra in [('2.0.0', {'hostApi': 2}), ('3.0.0', {'dependencies': [{'id': 'missing', 'version': '1.0.0', 'digest': '0'*64}]})]:
            candidate = self.store.install(package(self.root, self.key, version=version, extra=extra))
            with self.assertRaises(ValueError): self.store.activate('firered', candidate['digest'])
            self.assertEqual(self.store.resolve('firered')['lock']['packages'][0]['version'], '1.0.0')

    def test_an_active_package_is_reverified_before_execution(self):
        good = self.store.install(package(self.root, self.key)); self.store.activate('firered', good['digest'])
        resolved = self.store.resolve('firered'); Path(resolved['worker']).write_text('tampered')
        with self.assertRaisesRegex(ValueError, 'checksum|size'):
            self.store.resolve('firered')

    def test_a_run_lock_retains_the_old_engine_after_a_new_default_is_activated(self):
        first = self.store.install(package(self.root, self.key)); self.store.activate('firered', first['digest'])
        lock = self.store.resolve('firered')['lock']
        second = self.store.install(package(self.root, self.key, version='1.0.1')); self.store.activate('firered', second['digest'])
        self.assertEqual(self.store.resolve('firered', lock=lock)['lock']['packages'][0]['version'], '1.0.0')
        self.assertEqual(self.store.resolve('firered')['lock']['packages'][0]['version'], '1.0.1')


if __name__ == '__main__': unittest.main()

class PackageBoundaryTests(unittest.TestCase):
    setUp = PackageTests.setUp
    def test_a_directory_cannot_masquerade_as_a_worker(self):
        with self.assertRaisesRegex(ValueError,'file'):
            self.store.install(package(self.root,self.key,extra={'entrypoints':{'worker':'engine'}}))
    def test_symlinks_cannot_redirect_installed_code(self):
        if not hasattr(__import__('os'),'symlink'):self.skipTest('No symlink API')
        receipt=self.store.install(package(self.root,self.key));self.store.activate('firered',receipt['digest'])
        path=Path(self.store.resolve('firered')['worker']);data=path.read_bytes();path.unlink()
        dest=self.root/'redirect.js';dest.write_bytes(data)
        try:path.symlink_to(dest)
        except OSError:self.skipTest('Symlinks require privileges on this host')
        with self.assertRaisesRegex(ValueError,'symbolic'):self.store.resolve('firered')

class RegressionGateTests(unittest.TestCase):
    setUp = PackageTests.setUp

    def test_an_engine_without_regression_evidence_cannot_be_installed(self):
        with self.assertRaisesRegex(ValueError, 'regression'):
            self.store.install(package(self.root, self.key, extra={'verification': None}))
        self.assertEqual(self.store.status()['installed'], [])

    def test_a_signed_but_failed_regression_report_cannot_be_installed(self):
        proof = {'schema': 'pokemon-suite/bot-verification/v1', 'status': 'failed'}
        with self.assertRaisesRegex(ValueError, 'regression'):
            self.store.install(package(self.root, self.key, extra={'verification': proof}))
        self.assertEqual(self.store.status()['installed'], [])

    def test_a_report_for_other_code_cannot_authorize_this_engine(self):
        files = [{'path': 'engine/worker.js', 'bytes': 3, 'sha256': hashlib.sha256(b'old').hexdigest()}]
        with self.assertRaisesRegex(ValueError, 'regression'):
            self.store.install(package(self.root, self.key, extra={'verification': passing_proof(files)}))
        self.assertEqual(self.store.status()['installed'], [])
