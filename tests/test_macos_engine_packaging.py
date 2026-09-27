import hashlib
import importlib.util
from pathlib import Path
import tempfile
import unittest

from pokemon_suite.package_builder import build_package
from pokemon_suite.packages import PackageStore
from pokemon_suite.bot_verification import file_inventory
from test_packages import passing_proof

spec=importlib.util.spec_from_file_location('mac_builder',Path(__file__).resolve().parents[1]/'scripts/build-macos.py')
builder=importlib.util.module_from_spec(spec);spec.loader.exec_module(builder)


class EnginePackagingTests(unittest.TestCase):
    def setUp(self):
        self.temp=tempfile.TemporaryDirectory();self.addCleanup(self.temp.cleanup);self.root=Path(self.temp.name)
        self.files={'engine/firered/src/suite/session-worker.js':b'worker','engine/shared/helper.js':b'helper','engine/firered/src/suite/campaign-run.js':b'planner'}
        self.proof=passing_proof(file_inventory(self.files))
        self.old=self.root/'published.pksuite'
        build_package(self.files,self.old,identifier='suite-engine',version='0.1.0-build.45',kind='engine',games=['firered','emerald','crystal'],entrypoints={'worker':'engine/firered/src/suite/session-worker.js','researchBots':'engine/shared','campaignPlanner':'engine/firered/src/suite/campaign-run.js'},verification=self.proof)

    def test_ui_release_reuses_engine_identity_and_opens_existing_library(self):
        store=PackageStore(self.root/'profile')
        original=store.install(self.old,verified_sha256=hashlib.sha256(self.old.read_bytes()).hexdigest())
        target=self.root/'bundled.pksuite'
        newer_proof={**self.proof,'sourceSha256':'2'*64}
        result=builder.bundle_engine(self.files,target,newer_proof,previous=self.old)
        try:installed=store.install(target,verified_sha256=result['sha256'])
        except ValueError as error:self.fail(f'The UI update cannot reopen its existing library: {error}')
        self.assertEqual(installed['digest'],original['digest'])
        self.assertEqual(target.read_bytes(),self.old.read_bytes())

    def test_changed_engine_cannot_reuse_an_old_package(self):
        changed={**self.files,'engine/shared/helper.js':b'changed'}
        with self.assertRaises(ValueError):
            builder.bundle_engine(changed,self.root/'changed.pksuite',passing_proof(file_inventory(changed)),previous=self.old)

    def test_new_engine_requires_an_explicit_release_version(self):
        with self.assertRaises(ValueError):
            builder.bundle_engine(self.files,self.root/'unversioned.pksuite',self.proof)
