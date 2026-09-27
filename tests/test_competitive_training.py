import tempfile
import unittest
from pathlib import Path
from pokemon_suite.pokemon_farming import FarmingRequests
from pokemon_suite.pokemon_sessions import hunt_capability
from pokemon_suite import pokemon_player_tasks

class CompetitiveTrainingTests(unittest.TestCase):
    def request(self):
        return dict(schema='pokemon-suite/farming-request/v1',game='firered',speciesId=143,quantity=1,shiny='required',locationId='any',
                    natures=[],gender='any',abilityId=None,ball={'id':'any','requirement':'preferred'},minIvs={},maxIvs={'attack':0},minDvs={},
                    encounterLevel={'min':1,'max':100},finalLevel=None,moves=[],heldItemId=None,
                    limits={'minBalls':10,'maxSpend':5000,'maxMinutes':60,'maxEncounters':1000},afterCompletion='stop-save')

    def test_farming_preserves_maximum_iv_intent_and_rejects_impossible_ranges(self):
        class Executor:
            capability=staticmethod(hunt_capability)
        with tempfile.TemporaryDirectory() as directory:
            farming=FarmingRequests(Path(directory),Executor())
            value=self.request()
            try: result=farming.preview(value)
            except ValueError as error:self.fail(str(error))
            self.assertEqual(result['request']['maxIvs'],{'attack':0})
            self.assertEqual(result['rng']['traits']['maxIvs'],{'attack':0})
            value['minIvs']={'attack':31}
            with self.assertRaisesRegex(ValueError,'maximum|range'):farming.preview(value)

    def test_farming_carries_a_hidden_power_type_and_refuses_one_it_cannot_honor(self):
        class Executor:
            capability=staticmethod(hunt_capability)
        with tempfile.TemporaryDirectory() as directory:
            farming=FarmingRequests(Path(directory),Executor())
            value={**self.request(),'hiddenPower':{'type':'fire'}}
            try: result=farming.preview(value)
            except ValueError as error:self.fail(str(error))
            self.assertEqual(result['request']['hiddenPower'],{'type':'fire'})
            self.assertEqual(result['rng']['traits']['hiddenPower'],{'type':'fire'})
            self.assertEqual(farming.preview({**value,'hiddenPower':{'type':'ice','minPower':70}})['request']['hiddenPower'],{'type':'ice','minPower':70})
            for wrong in [{'type':'normal'},{'type':'fire','minPower':71},{'type':'fire','minPower':29},{'minPower':70},{'type':'fire','ivs':1},'fire']:
                with self.assertRaisesRegex(ValueError,'Hidden Power'):farming.preview({**value,'hiddenPower':wrong})
            with self.assertRaisesRegex(ValueError,'Hidden Power'):farming.preview({**value,'game':'emerald','speciesId':263})
            # The roaming Suicune keeps only part of its IVs, and its hunt ignores traits.
            suicune={**value,'speciesId':245,'maxIvs':{},'encounterLevel':{'min':50,'max':50}}
            self.assertEqual(hunt_capability({k:v for k,v in suicune.items() if k!='hiddenPower'})['supported'],True)
            refused=hunt_capability(suicune)
            self.assertFalse(refused['supported']);self.assertIn('Hidden Power',refused['reason'])
            # The preview leads with the executor's own reason, not the generic acquisition note.
            shown=farming.preview(suicune)
            self.assertFalse(shown['canStart']);self.assertIn('Hidden Power',shown['limitations'][0])

    def test_source_ev_targets_are_separate_from_champions_and_validated(self):
        value={'kind':'ev-training','fingerprint':'[5,101,700,31,0,31,31,31,31]',
               'evs':{'hp':4,'attack':0,'defense':0,'speed':252,'spAttack':252,'spDefense':0},'ivRanges':{'attack':{'min':0,'max':0}}}
        self.assertTrue(hasattr(pokemon_player_tasks,'validate_effort_task'))
        result=pokemon_player_tasks.validate_effort_task(value)
        self.assertEqual(result['evs']['speed'],252)
        value['evs']['hp']=255
        with self.assertRaisesRegex(ValueError,'510'):pokemon_player_tasks.validate_effort_task(value)

    def test_training_picker_uses_current_owned_individuals_and_excludes_duplicate_identities(self):
        from types import SimpleNamespace
        library=SimpleNamespace(_snapshot=lambda game:{'validity':'valid','pokemon':[
            {'fingerprint':'a','nationalSpeciesId':4,'isEgg':False,'identityConflict':False,'evs':{'speed':3}},
            {'fingerprint':'b','nationalSpeciesId':7,'identityConflict':True},
            {'fingerprint':'c','nationalSpeciesId':1,'isEgg':True}]})
        self.assertTrue(hasattr(pokemon_player_tasks,'effort_inventory'))
        result=pokemon_player_tasks.effort_inventory(library,'firered')
        self.assertEqual([p['fingerprint'] for p in result['pokemon']],['a'])
        self.assertEqual(result['pokemon'][0]['name'],'Charmander')
        with self.assertRaises(ValueError):pokemon_player_tasks.effort_inventory(library,'emerald')

if __name__=='__main__':unittest.main()
