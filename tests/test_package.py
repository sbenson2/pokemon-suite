from pathlib import Path
import hashlib
import json
import importlib.util
import tempfile
import unittest
import zipfile

ROOT=Path(__file__).resolve().parents[1]

class PackageTests(unittest.TestCase):
    def module(self):
        spec=importlib.util.spec_from_file_location('package_source',ROOT/'scripts/package-source.py')
        module=importlib.util.module_from_spec(spec);spec.loader.exec_module(module)
        return module

    def approve(self, root, names):
        manifest=root/'release/manifest.json';manifest.parent.mkdir(parents=True,exist_ok=True)
        manifest.write_text(json.dumps({'schema':'pokemon-suite/release-files/v1','files':[
            {'path':name,'sha256':hashlib.sha256((root/name).read_bytes()).hexdigest()} for name in names]}))

    def test_release_uses_an_allowlist_and_never_includes_user_games_or_profiles(self):
        spec=importlib.util.spec_from_file_location('package_source',ROOT/'scripts/package-source.py')
        module=importlib.util.module_from_spec(spec);spec.loader.exec_module(module)
        with tempfile.TemporaryDirectory() as temporary:
            root=Path(temporary)
            for name in ['README.md','pokemon_suite/__init__.py','pokemon_suite/static/index.html','engine/firered/src/owner.js','.local/profile/config.json','engine/firered/private/secret.json','pokemon_suite/static/accidental.gba','pokemon_suite/static/prod.keys']:
                path=root/name;path.parent.mkdir(parents=True,exist_ok=True);path.write_text('fixture')
            (root/'LICENSE').write_text('license fixture')
            self.approve(root,['README.md','LICENSE','pokemon_suite/__init__.py','pokemon_suite/static/index.html','engine/firered/src/owner.js'])
            target=root/'bundle.zip';module.package_source(root,target)
            with zipfile.ZipFile(target) as archive:
                names=archive.namelist()
                self.assertIn('pokemon-suite/pokemon_suite/static/index.html',names)
                self.assertIn('pokemon-suite/engine/firered/src/owner.js',names)
                self.assertFalse(any('.local' in name or 'secret' in name or name.endswith(('.gba','.keys')) for name in names))

    def test_readme_images_are_exported_but_other_images_are_not(self):
        exporter=self.module()
        for name in ['docs/images/hero.gif','docs/images/iphone-live.png','docs/images/icon.png']:
            self.assertTrue(exporter.eligible(name),name)
        for name in ['docs/other/shot.png','pokemon_suite/static/assets/pokedex/firered/1.png','docs/images/nested/x.png','docs/images/game.gba']:
            self.assertFalse(exporter.eligible(name),name)

    def test_release_excludes_game_art_and_vendor_bytes_even_if_they_are_present_locally(self):
        with tempfile.TemporaryDirectory() as temporary:
            root=Path(temporary)
            names=['LICENSE','pokemon_suite/static/assets/suite/species.svg','pokemon_suite/static/assets/pokemon/hardware/gba-photo.png']
            held=['pokemon_suite/static/assets/pokedex/firered/1.png','pokemon_suite/static/assets/pokemon/console-startup/gba.mp4','engine/shared/vendor/pokeemerald/data/maps/example.bin','pokemon_suite/static/assets/pokemon/hardware/gba-front.svg']
            for name in names+held:
                p=root/name;p.parent.mkdir(parents=True,exist_ok=True);p.write_text('fixture')
            self.approve(root,names)
            self.module().package_source(root,root/'bundle.zip')
            with zipfile.ZipFile(root/'bundle.zip') as z:
                self.assertIn('pokemon-suite/LICENSE',z.namelist())
                for name in held:self.assertNotIn('pokemon-suite/'+name,z.namelist())
                self.assertEqual((root/held[0]).read_text(),'fixture')

    def test_unknown_or_changed_source_blocks_packaging_before_replacing_an_existing_artifact(self):
        with tempfile.TemporaryDirectory() as temporary:
            root=Path(temporary);(root/'LICENSE').write_text('license fixture')
            (root/'pokemon_suite').mkdir();p=root/'pokemon_suite/new.py';p.write_text('original')
            self.approve(root,['LICENSE','pokemon_suite/new.py']);target=root/'bundle.zip';target.write_bytes(b'previous build')
            checksum=target.with_suffix('.zip.sha256');checksum.write_text('previous checksum')
            p.write_text('changed')
            with self.assertRaisesRegex(ValueError,'review|changed|hash'):self.module().package_source(root,target)
            self.assertEqual(target.read_bytes(),b'previous build')
            self.assertEqual(checksum.read_text(),'previous checksum')
            p.write_text('original');(root/'pokemon_suite/unknown.py').write_text('unreviewed')
            with self.assertRaisesRegex(ValueError,'review|Unknown'):self.module().package_source(root,target)
            self.assertEqual(target.read_bytes(),b'previous build')
            self.assertEqual(checksum.read_text(),'previous checksum')

    def test_every_export_refreshes_its_checksum_after_reviewed_source_changes(self):
        with tempfile.TemporaryDirectory() as temporary:
            root=Path(temporary);(root/'LICENSE').write_text('license fixture')
            (root/'README.md').write_text('first reviewed bot')
            target=root/'bundle.zip';checksum=target.with_suffix('.zip.sha256')
            self.approve(root,['LICENSE','README.md'])
            first=self.module().package_source(root,target)
            self.assertTrue(checksum.is_file(),'A release must ship its matching checksum automatically.')
            self.assertEqual(checksum.read_text(),first['sha256']+'  bundle.zip\n')
            (root/'README.md').write_text('updated reviewed bot')
            self.approve(root,['LICENSE','README.md'])
            second=self.module().package_source(root,target)
            self.assertNotEqual(first['sha256'],second['sha256'])
            self.assertEqual(checksum.read_text(),hashlib.sha256(target.read_bytes()).hexdigest()+'  bundle.zip\n')
            with zipfile.ZipFile(target) as archive:
                self.assertEqual(archive.read('pokemon-suite/README.md'),b'updated reviewed bot')

    def test_public_catalog_preserves_facts_without_game_prose_and_can_be_repackaged(self):
        with tempfile.TemporaryDirectory() as temporary:
            root=Path(temporary);(root/'LICENSE').write_text('license fixture')
            path='pokemon_suite/static/data/pokedex/firered.json';p=root/path;p.parent.mkdir(parents=True)
            p.write_text(json.dumps({'schema':'test','revision':'old','species':[{'id':1,'name':'Bulbasaur','sprite':'assets/pokedex/1.png','shinySprite':'assets/pokedex/shiny/1.png','description':'game prose','genus':'game category','stats':{'hp':45},'abilities':[{'id':65,'description':'ability prose'}]}]}))
            self.approve(root,['LICENSE',path]);self.module().package_source(root,root/'bundle.zip')
            with zipfile.ZipFile(root/'bundle.zip') as z:
                public=json.loads(z.read('pokemon-suite/'+path))
                self.assertEqual(public['species'][0]['stats'],{'hp':45})
                self.assertEqual(public['species'][0]['sprite'],'api/rom-art/firered/pokemon/1.png')
                self.assertEqual(public['species'][0]['shinySprite'],'api/rom-art/firered/pokemon/1.png?shiny=1')
                self.assertEqual(public['artwork'],'local-rom-required')
                self.assertNotIn('description',public['species'][0]);self.assertNotIn('genus',public['species'][0])
                self.assertNotIn('description',public['species'][0]['abilities'][0])
                z.extractall(root/'unpacked')
            self.module().package_source(root/'unpacked/pokemon-suite',root/'again.zip')
            with zipfile.ZipFile(root/'again.zip') as z:self.assertEqual(json.loads(z.read('pokemon-suite/'+path)),public)
            self.assertIn('game prose',p.read_text())

    def test_manifest_cannot_authorize_symlinks_or_a_restricted_asset(self):
        with tempfile.TemporaryDirectory() as temporary:
            root=Path(temporary);(root/'LICENSE').write_text('license fixture')
            path='pokemon_suite/static/assets/pokedex/firered/1.png';p=root/path;p.parent.mkdir(parents=True);p.write_bytes(b'private')
            self.approve(root,['LICENSE',path])
            with self.assertRaisesRegex(ValueError,'excluded|restricted'):self.module().package_source(root,root/'bundle.zip')
            if hasattr(Path,'symlink_to'):
                p.unlink();outside=root/'outside';outside.write_bytes(b'private')
                p=root/'pokemon_suite/linked.py'
                try:p.symlink_to(outside)
                except OSError:return
                self.approve(root,['LICENSE','pokemon_suite/linked.py'])
                with self.assertRaises(ValueError):self.module().package_source(root,root/'bundle.zip')

    def test_native_sources_are_reviewed_but_build_products_and_runtime_downloads_are_excluded(self):
        module = self.module()
        self.assertTrue(module.eligible('macos/Sources/PokemonSuiteMac/SuiteApp.swift'))
        self.assertTrue(module.eligible('macos/runtime-lock.json'))
        for path in ['macos/.build/arm64-apple-macosx/debug/PokemonSuite', 'macos/Runtime/python/bin/python3', 'macos/game.gba', 'macos/cache/node.tar.gz']:
            self.assertFalse(module.eligible(path), path)
