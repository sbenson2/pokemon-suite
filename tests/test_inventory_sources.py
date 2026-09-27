import json
from pathlib import Path
import tempfile
import unittest
from types import SimpleNamespace
from pokemon_suite.inventory_sources import InventorySources


class InventorySourceTests(unittest.TestCase):
    def fixture(self, root, name, game='firered'):
        library=root/name;folder=library/game/'save-profiles';folder.mkdir(parents=True)
        (library/'config.json').write_text(json.dumps({'directory':str(library),'games':{game:{}}}))
        metadata=folder/'archive-a.json';metadata.write_text(json.dumps({'id':'archive-a','label':'Postgame collection'}))
        (folder/'archive-a').mkdir();(folder/'archive-a/current.json').write_text('{}')
        return library,metadata

    def test_links_external_collection_and_remembers_selection_without_copying_or_switching_save(self):
        with tempfile.TemporaryDirectory() as temp:
            root=Path(temp);current=root/'current';current.mkdir();legacy,record=self.fixture(root,'legacy')
            active=current/'firered/active-hunt.json';active.parent.mkdir();active.write_text('{"id":"paused-campaign"}')
            sources=InventorySources(SimpleNamespace(directory=current))
            before={p:p.read_bytes() for p in legacy.rglob('*') if p.is_file()}
            item=sources.record('firered',str(record));sources.link('firered',item)
            reread=InventorySources(SimpleNamespace(directory=current))
            self.assertEqual(reread.resolve('firered')['id'],item['id'])
            self.assertEqual(reread.resolve('firered')['library'],str(legacy.resolve()))
            self.assertEqual([x['kind'] for x in reread.list('firered')],['current','saved'])
            self.assertEqual({p:p.read_bytes() for p in legacy.rglob('*') if p.is_file()},before)
            self.assertEqual(json.loads(active.read_text())['id'],'paused-campaign')
            self.assertFalse((current/'firered/save-profiles').exists())
            reread.select('firered','current');self.assertEqual(reread.resolve('firered')['id'],'current')

    def test_local_archives_are_discovered_and_wrong_game_or_changed_identity_is_rejected(self):
        with tempfile.TemporaryDirectory() as temp:
            root=Path(temp);current,record=self.fixture(root,'current')
            sources=InventorySources(SimpleNamespace(directory=current))
            self.assertEqual(len(sources.list('firered')),2)
            with self.assertRaises(ValueError):sources.record('emerald',str(record))
            with self.assertRaises(ValueError):sources.select('firered','../arbitrary')
            record.write_text('{"id":"../escape"}')
            with self.assertRaises(ValueError):sources.record('firered',str(record))

    def test_missing_selected_archive_stays_unavailable_instead_of_showing_the_fresh_campaign(self):
        with tempfile.TemporaryDirectory() as temp:
            root=Path(temp);current=root/'current';current.mkdir();legacy,record=self.fixture(root,'legacy')
            sources=InventorySources(SimpleNamespace(directory=current));item=sources.record('firered',str(record));sources.link('firered',item)
            record.unlink()
            selected=sources.resolve('firered')
            self.assertEqual(selected['id'],item['id']);self.assertIn('error',selected)

    def test_a_removed_local_archive_can_be_replaced_using_the_current_game_selector(self):
        with tempfile.TemporaryDirectory() as temp:
            current,record=self.fixture(Path(temp),'current')
            sources=InventorySources(SimpleNamespace(directory=current));item=sources.record('firered',str(record))
            sources.select('firered',item['id']);record.unlink()
            self.assertIn('error',sources.resolve('firered'))
            sources.select('firered','current');self.assertEqual(sources.resolve('firered')['kind'],'current')
