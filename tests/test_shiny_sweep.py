"""Shiny collection retries of RNG setup stops.

The engine stops an RNG trial that finds no executable route to the hunted
encounter cells after 1800 frames, with a message naming the map, instead of
spending the whole Sweet Scent menu budget ("RNG menu navigation exceeded its
budget", which the sweep already retried). The sweep keeps the same retry,
cooldown and re-plan for the earlier stop; it must not turn it into a
permanent drop.
"""
import json
from pathlib import Path
import tempfile
import time
import unittest

from pokemon_suite.pokemon_shiny_sweep import ShinySweep

BUDGET = 'RNG menu navigation exceeded its budget'
NO_ROUTE = 'RNG setup has no executable route to an encounter cell of MAP_THREE_ISLAND_PORT'


class Farming:
    def __init__(self):
        self.started = []

    def get(self, request_id):
        return {'id': request_id}

    def start(self, request_id):
        self.started.append(request_id)


class Executor:
    def __init__(self, live):
        self.live = live

    def _live(self, game):
        return self.live

    def completed_hunt(self, record):
        return False


def owner(mission=None):
    return {'collection': [], 'bot': {'enabled': True}, 'mode': 'overworld', 'mission': mission or {},
            'storage': {'known': True, 'canStart': True}}


class RngSetupRetryTests(unittest.TestCase):
    def sweep(self, live, **state):
        directory = Path(tempfile.mkdtemp())
        value = {'schema': 'pokemon-suite/shiny-sweep/v1', 'id': 'sweep', 'enabled': True, 'goal': 'national-dex',
                 'status': 'running', 'reason': '', 'active': None, 'deferred': [], 'completed': [], 'candidates': [],
                 'targets': [], 'owned': [], 'lastTransition': None, **state}
        (directory/'shiny-sweep.json').write_text(json.dumps(value))
        return ShinySweep(directory, Farming(), Executor(live))

    def test_a_blocked_hunt_without_a_route_to_its_grass_is_retried_like_the_menu_budget(self):
        for reason in (BUDGET, NO_ROUTE):
            with self.subTest(reason=reason):
                live = owner({'id': 'request-206', 'state': 'blocked', 'reason': reason, 'protected': False})
                sweep = self.sweep(live, active={'speciesId': 206, 'name': 'Dunsparce', 'requestId': 'request-206', 'started': True})
                result = sweep.tick()
                self.assertEqual(result['status'], 'recovering', result['reason'])
                self.assertEqual(result['active']['retry']['reason'], reason)
                self.assertEqual(result['deferred'], [], 'the species is not dropped')

    def test_a_deferred_no_route_stop_gets_a_cooldown_instead_of_a_permanent_drop(self):
        at = time.time() - 60
        item = {'speciesId': 206, 'name': 'Dunsparce', 'requestId': 'request-206', 'reason': NO_ROUTE, 'at': at}
        self.assertEqual(self.sweep(owner(), deferred=[dict(item)]).summary()['lastTransition']['retryAt'], at + 300)
        result = self.sweep(owner(), deferred=[dict(item)]).tick()
        self.assertEqual(result['deferred'][0]['retryAt'], at + 300)
        self.assertEqual(result['status'], 'waiting')
        self.assertIn('Shiny Dunsparce will retry in', result['reason'])


if __name__ == '__main__':
    unittest.main()
