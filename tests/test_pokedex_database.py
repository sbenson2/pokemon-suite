import importlib.util
import json
from pathlib import Path
import sqlite3
import tempfile
import unittest

class OfflineDexTests(unittest.TestCase):
    def dex(self):
        from pokemon_suite import pokedex_database
        return pokedex_database.Pokedex()
    def test_national_species_and_forms_are_queryable_offline(self):
        d=self.dex();coverage=d.coverage()
        self.assertGreaterEqual(coverage['tables']['pokemon_species'],1025)
        self.assertGreaterEqual(coverage['tables']['pokemon'],1351)
        self.assertEqual(d.species(1025)['identifier'],'pecharunt')
        self.assertEqual(d.species('umbreon')['id'],197)
        self.assertTrue(any('mega' in p['identifier'] for p in d.forms(6)))
    def test_game_history_does_not_give_firered_fairy_types(self):
        d=self.dex()
        self.assertEqual(d.pokemon(35,generation=3)['types'],['normal'])
        self.assertEqual(d.pokemon(35,generation=6)['types'],['fairy'])
        self.assertEqual(d.type_matchup('ghost',['steel'],generation=3),.5)
        self.assertEqual(d.type_matchup('ghost',['steel'],generation=6),1)
        self.assertEqual(d.type_matchup('electric',['water','ground'],generation=3),0)
        with self.assertRaisesRegex(ValueError,'generation'):d.type_matchup('fairy',['dragon'],generation=3)
    def test_profiles_link_stats_abilities_items_moves_and_evolution_conditions(self):
        d=self.dex();p=d.pokemon(25,generation=3,version_group='firered-leafgreen')
        self.assertEqual(p['stats']['speed'],90)
        self.assertEqual(p['abilities'],['static'])
        self.assertTrue(any(m['move_id']==85 for m in p['learnset']))
        self.assertTrue(d.evolutions(197))
        item=d.item('light-ball');self.assertEqual(item['identifier'],'light-ball')
        self.assertTrue(item['game_indices'])
        self.assertTrue(d.search('umbreon'))
    def test_sql_is_readonly_and_data_integrity_is_reported(self):
        d=self.dex()
        with d.connection() as c:
            with self.assertRaises(sqlite3.OperationalError):c.execute('DELETE FROM pokemon_species')
        self.assertEqual(d.coverage()['integrity'],'ok')
    def test_generation_two_has_no_abilities_and_generation_four_changes_damage_class(self):
        d=self.dex();self.assertEqual(d.pokemon(25,generation=2)['abilities'],[])
        self.assertEqual(d.move('shadow-ball',generation=3)['damage_class'],'physical')
        self.assertEqual(d.move('shadow-ball',generation=4)['damage_class'],'special')
    def test_forms_and_special_stat_respect_the_selected_game(self):
        d=self.dex()
        with self.assertRaisesRegex(ValueError,'generation'):d.pokemon('charizard-mega-x',generation=3)
        p=d.pokemon(25,generation=1)
        self.assertEqual(p['stats']['special'],50)
        self.assertNotIn('special-defense',p['stats'])
        self.assertEqual(d.pokemon(386,game='firered')['stats']['attack'],180)
        self.assertEqual(d.pokemon(386,game='leafgreen')['stats']['defense'],160)
        self.assertFalse(any('mega' in p['identifier'] for p in d.forms(6,game='firered')))
    def test_farming_profiles_include_all_moves_and_native_held_effects(self):
        from pokemon_suite.pokemon_farming import catalog
        for game in ['firered','leafgreen','emerald']:
            profile=catalog(game)
            self.assertEqual(len(profile['moves']),354)
            self.assertEqual(next(m for m in profile['moves'] if m['id']==354)['name'],'Psycho Boost')
            self.assertEqual(next(i for i in profile['heldItems'] if i['nativeId']==202)['heldEffect']['name'],'HOLD_EFFECT_LIGHT_BALL')
            self.assertEqual(profile['reference']['schema'],'pokemon-suite/pokedex/v1')
