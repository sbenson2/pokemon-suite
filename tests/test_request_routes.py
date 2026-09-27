"""G3: /api/pokemon-suite/requests/{interpret,commit} routes."""
import copy
import http.client
import json
from pathlib import Path
import subprocess
import sys
import tempfile
import unittest

from pokemon_suite import pokemon_requests as pr
from pokemon_suite.http_routes import SuiteRoutes

ROOT = Path(__file__).resolve().parents[1]
CONTEXT = json.loads((Path(__file__).resolve().parent / 'data' / 'request-context.json').read_text())


class Goals:
    def __init__(self):
        self.created = []

    def submit(self, goal):
        self.created.append(goal)
        return {**goal, 'id': 'goal-%d' % len(self.created), 'status': 'queued'}


class Server:
    pass


class Handler(SuiteRoutes):
    """SuiteRoutes with the HTTP handler's response and auth helpers recorded."""
    def __init__(self, server, control=True):
        self.server = server
        self.control = control
        self.responses = []

    def _control_request(self):
        return self.control

    def _authenticated(self):
        return self.control

    def _json(self, status, data, head=False):
        self.responses.append((int(status), data))

    def _error(self, status, message):
        self._json(status, {'ok': False, 'error': message})


def server(goals=True):
    s = Server()
    if goals:
        s.goals = Goals()
    s.pokemon_requests = pr.RequestService(s, interpreter=pr.Interpreter(), context_provider=lambda: copy.deepcopy(CONTEXT))
    return s


class RequestRoutes(unittest.TestCase):
    def test_interpret_then_commit(self):
        s = server()
        handler = Handler(s)
        handler.route_post('/api/pokemon-suite/requests/interpret', {'text': 'get me a shiny mewtwo', 'via': 'typed'})
        status, body = handler.responses[-1]
        self.assertEqual(status, 200, body)
        self.assertTrue(body['ok'])
        self.assertTrue(body['understood'])
        self.assertEqual(body['goal']['steps'][0]['request']['speciesId'], 150)
        handler.route_post('/api/pokemon-suite/requests/commit', {'draftId': body['draftId'], 'idempotencyKey': 'route-key-0001'})
        status, committed = handler.responses[-1]
        self.assertEqual(status, 200, committed)
        self.assertEqual(committed['goal']['status'], 'queued')
        self.assertEqual(s.goals.created[0]['idempotencyKey'], 'route-key-0001')

    def test_errors_map_to_http_statuses(self):
        handler = Handler(server(goals=False))
        handler.route_post('/api/pokemon-suite/requests/interpret', {'text': 'heal', 'via': 'typed'})
        draft = handler.responses[-1][1]
        handler.route_post('/api/pokemon-suite/requests/commit', {'draftId': draft['draftId'], 'idempotencyKey': 'route-key-0002'})
        status, body = handler.responses[-1]
        self.assertEqual(status, 503)
        self.assertIn('goal supervisor unavailable', body['error'])
        handler.route_post('/api/pokemon-suite/requests/interpret', {'text': 5})
        self.assertEqual(handler.responses[-1][0], 400)

    def test_requires_the_control_session(self):
        handler = Handler(server(), control=False)
        handler.route_post('/api/pokemon-suite/requests/interpret', {'text': 'heal', 'via': 'typed'})
        self.assertEqual(handler.responses[-1][0], 403)

    def test_other_routes_are_untouched(self):
        handler = Handler(server())
        self.assertIs(handler.route_post('/api/pokemon-suite/not-a-route', {}), False)

    def test_warm_starts_laya_and_returns_at_once(self):
        class Agent:
            def __init__(self):
                self.starts = 0

            def start(self):
                self.starts += 1

            def ready(self):
                return False

            def failed(self):
                return False
        s, agent = server(), Agent()
        s.pokemon_requests = pr.RequestService(s, interpreter=pr.Interpreter(classifier=pr.LayaClassifier(agent_factory=lambda: agent)),
                                               context_provider=lambda: copy.deepcopy(CONTEXT))
        handler = Handler(s)
        handler.route_post('/api/pokemon-suite/requests/warm', {})
        self.assertEqual(handler.responses[-1], (200, {'ok': True, 'laya': 'loading'}))
        self.assertEqual(agent.starts, 1)
        handler.route_post('/api/pokemon-suite/requests/warm', {'text': 'heal'})
        self.assertEqual(handler.responses[-1][0], 400)
        plain = Handler(server())
        plain.route_post('/api/pokemon-suite/requests/warm', {})
        self.assertEqual(plain.responses[-1], (200, {'ok': True, 'laya': 'off'}), 'no Laya configured')
        denied = Handler(server(), control=False)
        denied.route_post('/api/pokemon-suite/requests/warm', {})
        self.assertEqual(denied.responses[-1][0], 403)

    def test_cancel_drops_the_draft_and_interpret_names_the_client(self):
        s = server()
        seen, interpret = [], s.pokemon_requests.interpret
        s.pokemon_requests.interpret = lambda payload, client='': seen.append(client) or interpret(payload, client=client)
        handler = Handler(s)
        handler.route_post('/api/pokemon-suite/requests/interpret', {'text': 'heal', 'via': 'typed'})
        draft = handler.responses[-1][1]
        handler.headers = {'User-Agent': 'PokemonSuite/1 CFNetwork/1.0'}  # the Mac app
        handler.route_post('/api/pokemon-suite/requests/interpret', {'text': 'heal', 'via': 'typed'})
        handler.headers = {'Origin': 'http://127.0.0.1:8123'}  # the companion relay sends no user agent
        handler.route_post('/api/pokemon-suite/requests/interpret', {'text': 'heal', 'via': 'typed'})
        self.assertEqual(seen, ['', 'PokemonSuite/1 CFNetwork/1.0', 'http://127.0.0.1:8123'])
        handler.route_post('/api/pokemon-suite/requests/cancel', {'draftId': draft['draftId']})
        self.assertEqual(handler.responses[-1], (200, {'ok': True, 'cancelled': True}))
        handler.route_post('/api/pokemon-suite/requests/commit', {'draftId': draft['draftId'], 'idempotencyKey': 'route-key-0003'})
        self.assertEqual(handler.responses[-1][0], 404, 'a cancelled draft cannot be committed')
        handler.route_post('/api/pokemon-suite/requests/cancel', {'text': 'heal'})
        self.assertEqual(handler.responses[-1][0], 400)
        denied = Handler(s, control=False)
        denied.route_post('/api/pokemon-suite/requests/cancel', {'draftId': draft['draftId']})
        self.assertEqual(denied.responses[-1][0], 403)


class StandaloneRequestRoutes(unittest.TestCase):
    """The real service: authenticated, and interpreting never starts a game."""
    @classmethod
    def setUpClass(cls):
        cls.profile = tempfile.TemporaryDirectory(prefix='suite-requests-')
        cls.process = subprocess.Popen([sys.executable, '-m', 'pokemon_suite', '--data-dir', cls.profile.name, 'serve', '--port', '0'], cwd=ROOT,
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
        connection = http.client.HTTPConnection('127.0.0.1', cls.port, timeout=10)
        connection.request(method, path, json.dumps(body) if body is not None else None,
                           headers or {'Cookie': getattr(cls, 'cookie', ''), 'Content-Type': 'application/json'})
        response = connection.getresponse()
        data = response.read()
        connection.close()
        return response, data

    def test_interpret_requires_the_session_cookie(self):
        response, _ = self.request('POST', '/api/pokemon-suite/requests/interpret', {'text': 'heal', 'via': 'typed'}, {'Cookie': '', 'Content-Type': 'application/json'})
        self.assertEqual(response.status, 403)
        response, _ = self.request('POST', '/api/pokemon-suite/requests/interpret', {'text': 'heal', 'via': 'typed'},
                                   {'Cookie': self.cookie, 'Origin': 'https://unrelated.example', 'Content-Type': 'application/json'})
        self.assertEqual(response.status, 403)

    def test_interpret_on_an_empty_installation(self):
        response, raw = self.request('POST', '/api/pokemon-suite/requests/interpret', {'text': 'heal then save', 'via': 'typed'})
        body = json.loads(raw)
        self.assertEqual(response.status, 200, body)
        self.assertTrue(body['understood'], body)
        self.assertEqual([s['task']['kind'] for s in body['goal']['steps']], ['heal', 'save'])
        response, raw = self.request('POST', '/api/pokemon-suite/requests/interpret', {'text': "what's my team", 'via': 'voice'})
        body = json.loads(raw)
        self.assertEqual(response.status, 200, body)
        self.assertIn('not running', body['answer'].lower())
        response, raw = self.request('POST', '/api/pokemon-suite/requests/interpret', {'text': 'make me a sandwich', 'via': 'typed'})
        self.assertFalse(json.loads(raw)['understood'])

    def test_cancel_on_an_empty_installation(self):
        _, raw = self.request('POST', '/api/pokemon-suite/requests/interpret', {'text': 'heal', 'via': 'typed'})
        response, raw = self.request('POST', '/api/pokemon-suite/requests/cancel', {'draftId': json.loads(raw)['draftId']})
        self.assertEqual((response.status, json.loads(raw)), (200, {'ok': True, 'cancelled': True}))

    def test_warm_on_an_empty_installation(self):
        response, raw = self.request('POST', '/api/pokemon-suite/requests/warm', {})
        self.assertEqual(response.status, 200, raw)
        self.assertEqual(json.loads(raw), {'ok': True, 'laya': 'off'})
        response, _ = self.request('POST', '/api/pokemon-suite/requests/warm', {}, {'Cookie': '', 'Content-Type': 'application/json'})
        self.assertEqual(response.status, 403)


class CompanionRelayTests(unittest.TestCase):
    def test_companion_relays_request_endpoints_for_ios(self):
        from pokemon_suite.companion import allowed_route
        self.assertTrue(allowed_route('POST', '/api/pokemon-suite/requests/interpret'))
        self.assertTrue(allowed_route('POST', '/api/pokemon-suite/requests/commit'))
        self.assertTrue(allowed_route('POST', '/api/pokemon-suite/requests/warm'), 'clients warm Laya when Ask opens or the mic is tapped')
        self.assertTrue(allowed_route('POST', '/api/pokemon-suite/requests/cancel'), 'Cancel on a proposed request is a logged outcome')
        self.assertFalse(allowed_route('GET', '/api/pokemon-suite/requests/warm'))
        self.assertFalse(allowed_route('GET', '/api/pokemon-suite/requests/interpret'))


if __name__ == '__main__':
    unittest.main()
