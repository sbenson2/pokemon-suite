import unittest
import tempfile
from pathlib import Path
from pokemon_suite.pokemon_farming import FarmingRequests
from pokemon_suite.pokemon_sessions import hunt_capability

class RoamerHuntTests(unittest.TestCase):
    def request(self):
        return dict(game='firered',speciesId=245,quantity=1,shiny='required',locationId='any',encounterLevel={'min':50,'max':50},moves=[],heldItemId=None,finalLevel=None,ball={'id':'any','requirement':'preferred'})

    def test_suicune_has_a_roaming_executor_instead_of_a_grass_route(self):
        result=hunt_capability(self.request())
        self.assertTrue(result['supported'],result.get('reason'))
        self.assertEqual(result['method'],'roamer')
        self.assertEqual(result['setup'],'current-game')

    def test_roaming_request_does_not_promise_multiple_unique_releases(self):
        r=self.request();r['quantity']=2
        result=hunt_capability(r)
        self.assertFalse(result['supported'])
        self.assertIn('one',result['reason'].lower())

    def test_farming_preview_hands_the_roaming_route_to_the_executor(self):
        r=self.request();r.update(schema='pokemon-suite/farming-request/v1',natures=[],gender='any',abilityId=None,minIvs={},minDvs={},limits={'minBalls':10,'maxSpend':999999,'maxMinutes':1440,'maxEncounters':100000},afterCompletion='stop-save')
        class Executor:
            capability=staticmethod(hunt_capability)
        with tempfile.TemporaryDirectory() as directory:
            plan=FarmingRequests(Path(directory),Executor()).preview(r)
            self.assertTrue(plan['canStart'])
            self.assertEqual(plan['route']['method'],'roamer')
            self.assertIn('Celio', ' '.join(plan['steps']))

    def test_explicit_retry_is_not_saved_as_permission_for_future_automatic_starts(self):
        r=self.request();r.update(schema='pokemon-suite/farming-request/v1',natures=[],gender='any',abilityId=None,minIvs={},minDvs={},limits={'minBalls':10,'maxSpend':999999,'maxMinutes':1440,'maxEncounters':100000},afterCompletion='stop-save')
        class Executor:
            capability=staticmethod(hunt_capability)
            def start(self, record):return {'command':record}
        with tempfile.TemporaryDirectory() as directory:
            farming=FarmingRequests(Path(directory),Executor())
            record=farming.save(r,'suicune-retry-test')
            explicit=farming.start(record['id'],retry_blocked_policy=True)['command']
            self.assertIs(explicit.get('retryBlockedPolicy'),True)
            self.assertNotIn('retryBlockedPolicy',farming.get(record['id']))
            automatic=farming.start(record['id'])['command']
            self.assertNotIn('retryBlockedPolicy',automatic)

if __name__=='__main__':unittest.main()
