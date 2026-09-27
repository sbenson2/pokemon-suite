import http.client
import json
from pathlib import Path
import subprocess
import sys
import tempfile
import unittest

ROOT = Path(__file__).resolve().parents[1]


class StandaloneHTTPTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.profile = tempfile.TemporaryDirectory(prefix='suite-http-')
        cls.process = subprocess.Popen([sys.executable, '-m', 'pokemon_suite', '--data-dir', cls.profile.name,
                                        'serve', '--port', '0'], cwd=ROOT,
                                       stdout=subprocess.PIPE, stderr=subprocess.PIPE, text=True)
        line = cls.process.stdout.readline()
        if not line:
            raise AssertionError('Standalone service did not start: ' + cls.process.stderr.read())
        cls.port = json.loads(line)['port']
        response, _ = cls.request('GET', '/')
        cls.cookie = response.getheader('Set-Cookie').split(';')[0]

    @classmethod
    def tearDownClass(cls):
        cls.process.terminate()
        cls.process.communicate(timeout=5)
        cls.profile.cleanup()

    @classmethod
    def request(cls, method, path, body=None, headers=None):
        connection = http.client.HTTPConnection('127.0.0.1', cls.port, timeout=5)
        connection.request(method, path, json.dumps(body) if body is not None else None,
                           headers or {'Cookie': getattr(cls, 'cookie', ''), 'Content-Type': 'application/json'})
        response = connection.getresponse()
        data = response.read()
        connection.close()
        return response, data

    def test_offline_dex_api_searches_all_species_and_respects_generation(self):
        response,raw=self.request('GET','/api/pokemon-suite/pokedex?resource=species&id=1025')
        self.assertEqual(response.status,200,raw);self.assertEqual(json.loads(raw)['result']['identifier'],'pecharunt')
        response,raw=self.request('GET','/api/pokemon-suite/pokedex?resource=type&attack=ghost&defenders=steel&generation=3')
        self.assertEqual(response.status,200,raw);self.assertEqual(json.loads(raw)['result']['multiplier'],.5)
        response,raw=self.request('GET','/api/pokemon-suite/pokedex?resource=search&q=umbreon')
        self.assertEqual(response.status,200,raw);self.assertTrue(json.loads(raw)['result'])
        response,raw=self.request('GET','/api/pokemon-suite/pokedex?resource=pokemon&id=35&game=firered')
        self.assertEqual(response.status,200,raw);self.assertEqual(json.loads(raw)['result']['types'],['normal'])
        response,raw=self.request('GET','/api/pokemon-suite/pokedex?resource=pokemon&id=386&game=firered')
        self.assertEqual(response.status,200,raw);self.assertEqual(json.loads(raw)['result']['stats']['attack'],180)
        response,raw=self.request('GET','/api/pokemon-suite/pokedex?resource=pokemon&id=charizard-mega-x&game=firered')
        self.assertEqual(response.status,400,raw)
        response,_=self.request('GET','/api/pokemon-suite/pokedex?resource=coverage',headers={'Cookie':''})
        self.assertEqual(response.status,403)
        response,_=self.request('GET','/api/pokemon-suite/pokedex?resource=sql&q=DROP')
        self.assertEqual(response.status,400)

    def test_empty_installation_has_the_full_version_catalog_without_starting_games(self):
        response, raw = self.request('GET', '/api/state')
        self.assertEqual(response.status, 200, raw)
        state = json.loads(raw)
        self.assertEqual(state['product'], 'pokemon-suite')
        self.assertEqual(state['sessions'], [])
        self.assertIn('firered', [game['id'] for game in state['library']])
        self.assertIn('emerald', [game['id'] for game in state['library']])
        self.assertEqual(list(Path(self.profile.name).glob('*/owner.lock')), [])

    def test_game_specific_pokedex_is_available_without_an_emulator(self):
        response, raw = self.request('GET', '/data/pokedex/firered.json')
        self.assertEqual(response.status, 200)
        dex = json.loads(raw)
        self.assertEqual(len(dex['species']), 386)

    def test_inventory_reports_missing_game_without_starting_an_owner(self):
        response, raw = self.request('GET', '/api/pokemon-suite/inventory?game=firered')
        self.assertEqual(response.status, 200, raw)
        self.assertFalse(json.loads(raw)['supported'])
        self.assertEqual(list(Path(self.profile.name).glob('*/owner.lock')), [])
        response, _ = self.request('GET', '/api/pokemon-suite/inventory?game=firered', headers={'Cookie':''})
        self.assertEqual(response.status, 403)

    def test_reports_are_authenticated_and_do_not_start_a_game(self):
        response, raw = self.request('GET', '/api/pokemon-suite/reports?game=firered')
        self.assertEqual(response.status, 200, raw)
        report = json.loads(raw)['report']
        self.assertEqual(report['schema'], 'pokemon-suite/support-report/v1')
        self.assertEqual(report['game'], 'firered')
        self.assertEqual(report['records'], [])
        self.assertEqual(list(Path(self.profile.name).glob('*/owner.lock')), [])
        response, _ = self.request('GET', '/api/pokemon-suite/reports?game=firered', headers={'Cookie': ''})
        self.assertEqual(response.status, 403)
        for query in ['game=../../outside', 'game=firered&game=emerald', 'game=firered&path=/etc/passwd']:
            response, _ = self.request('GET', '/api/pokemon-suite/reports?' + query)
            self.assertEqual(response.status, 400)

    def test_inventory_trade_rejects_stale_or_missing_selection_without_starting_game(self):
        response, raw = self.request('POST', '/api/pokemon-suite/trade-pokemon', {'game':'firered','pokemonId':'a'*64,'sessionId':'old'})
        self.assertEqual(response.status, 400, raw)
        self.assertEqual(list(Path(self.profile.name).glob('*/owner.lock')), [])
        response,raw=self.request('POST','/api/pokemon-suite/trade-plan',{'game':'firered','pokemonId':'a'*64,'sourceId':'missing'})
        self.assertEqual(response.status,400,raw)
        response,_=self.request('POST','/api/pokemon-suite/trade-plan',{'game':'firered','pokemonId':'a'*64,'sourceId':'current'},{'Cookie':self.cookie,'Origin':'https://unrelated.example','Content-Type':'application/json'})
        self.assertEqual(response.status,403)

    def test_inventory_source_controls_validate_game_and_origin_without_starting_game(self):
        for path,body in [('/api/pokemon-suite/inventory-source',{'game':'firered','sourceId':'missing'}),('/api/pokemon-suite/inventory-sources',{'game':'firered','path':'/missing/save.json'})]:
            response,raw=self.request('POST',path,body);self.assertEqual(response.status,400,raw)
            response,_=self.request('POST',path,body,{'Cookie':self.cookie,'Origin':'https://unrelated.example','Content-Type':'application/json'})
            self.assertEqual(response.status,403)
        response,_=self.request('GET','/api/pokemon-suite/inventory?game=firered&source=a&source=b');self.assertEqual(response.status,400)
        self.assertEqual(list(Path(self.profile.name).glob('*/owner.lock')), [])

    def test_foreign_origin_cannot_start_a_game(self):
        response, _ = self.request('POST', '/api/pokemon-suite/start-game', {'game': 'firered'},
                                   {'Cookie': self.cookie, 'Origin': 'https://unrelated.example', 'Content-Type': 'application/json'})
        self.assertEqual(response.status, 403)

    def test_radio_configuration_requires_the_current_local_session(self):
        payload={'game':'firered','keysPath':'/unused/console.keys'}
        response,_=self.request('POST','/api/pokemon-suite/radio-settings',payload,{'Cookie':''})
        self.assertEqual(response.status,403)
        response,_=self.request('POST','/api/pokemon-suite/radio-settings',payload,{'Cookie':self.cookie,'Origin':'https://unrelated.example','Content-Type':'application/json'})
        self.assertEqual(response.status,403)
        response,_=self.request('POST','/api/pokemon-suite/radio-settings',{'game':'firered','keysPath':[]})
        self.assertEqual(response.status,400)
        self.assertEqual(list(Path(self.profile.name).glob('*/wireless.json')),[])
        self.assertEqual(list(Path(self.profile.name).glob('*/owner.lock')), [])

    def test_host_application_routes_are_absent(self):
        for path in ['/api/tokens/speed', '/api/plugins', '/api/test-fleet/stop-report']:
            response, _ = self.request('GET', path)
            self.assertEqual(response.status, 404, path)

    def test_static_requests_cannot_read_application_data(self):
        for path in ['/../config.json', '/%2e%2e/config.json', '/.local/config.json']:
            response, _ = self.request('GET', path)
            self.assertIn(response.status, [403, 404], path)


if __name__ == '__main__':
    unittest.main()
