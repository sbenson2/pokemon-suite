import http.client
import json
from pathlib import Path
import tempfile
import threading
import unittest
from unittest.mock import patch
import socket

from pokemon_suite.server import SuiteServer
from pokemon_suite.pokemon_sessions import SuiteSessions


class DesktopServiceTests(unittest.TestCase):
    def test_companion_listener_is_owned_and_closed_by_the_desktop_service(self):
        with tempfile.TemporaryDirectory() as temporary, patch('pokemon_suite.companion.network_addresses',return_value=[('tailscale','100.101.102.103')]):
            server=SuiteServer(temporary,0);server.desktop=True
            thread=threading.Thread(target=server.serve_forever,daemon=True);thread.start()
            connection=http.client.HTTPConnection('127.0.0.1',server.server_port,timeout=5)
            port=None
            try:
                connection.request('GET','/');response=connection.getresponse();cookie=response.getheader('Set-Cookie').split(';')[0];response.read()
                connection.request('GET','/api/companion',headers={'Cookie':cookie});response=connection.getresponse();body=response.read()
                self.assertEqual(response.status,200,body)
                self.assertFalse(json.loads(body)['enabled'])
                server.companion.port=0
                connection.request('POST','/api/companion','{"enabled":true}',{'Cookie':cookie,'Content-Type':'application/json'})
                response=connection.getresponse();body=json.load(response);self.assertEqual(response.status,200,body)
                port=body['port'];self.assertTrue(body['running'])
                self.assertEqual(server.companion.server.upstream_port,server.server_port)
            finally:connection.close();server.shutdown();server.server_close()
            with self.assertRaises(OSError):socket.create_connection(('127.0.0.1',port),timeout=.5)

    def test_app_quit_closes_its_http_service_after_all_games_are_closed(self):
        with tempfile.TemporaryDirectory() as temporary:
            server = SuiteServer(temporary, 0)
            server.desktop = True
            thread = threading.Thread(target=server.serve_forever, daemon=True)
            thread.start()
            connection = http.client.HTTPConnection('127.0.0.1', server.server_port, timeout=3)
            try:
                connection.request('GET', '/')
                response = connection.getresponse()
                cookie = response.getheader('Set-Cookie').split(';')[0]
                response.read()
                connection.request('POST', '/api/desktop/quit', '{}', {'Cookie': cookie, 'Content-Type': 'application/json'})
                response = connection.getresponse()
                body = response.read()
                self.assertEqual(response.status, 200, body)
                thread.join(3)
                self.assertFalse(thread.is_alive(), 'Quit must end the app-owned service.')
            finally:
                connection.close()
                server.shutdown()
                server.server_close()

    def test_browser_service_does_not_expose_app_quit(self):
        with tempfile.TemporaryDirectory() as temporary:
            server = SuiteServer(temporary, 0)
            thread = threading.Thread(target=server.serve_forever, daemon=True)
            thread.start()
            connection = http.client.HTTPConnection('127.0.0.1', server.server_port, timeout=3)
            try:
                connection.request('GET', '/')
                response = connection.getresponse(); cookie = response.getheader('Set-Cookie').split(';')[0]; response.read()
                connection.request('POST', '/api/desktop/quit', '{}', {'Cookie': cookie, 'Content-Type': 'application/json'})
                response = connection.getresponse(); response.read()
                self.assertEqual(response.status, 404)
                self.assertTrue(thread.is_alive())
            finally:
                connection.close(); server.shutdown(); server.server_close()

    def test_app_runtime_uses_bundled_engine_without_rewriting_the_users_configuration(self):
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary)
            raw = {'games': {}, 'worker': '/previous/worker.js', 'researchBots': '/previous/shared', 'node': '/previous/node', 'userNote': 'keep'}
            path = root/'config.json'; path.write_text(json.dumps(raw)); original = path.read_bytes()
            sessions = SuiteSessions(root)
            sessions.runtime_overrides = {'worker': '/application/worker.js', 'researchBots': '/application/shared', 'node': '/application/node'}
            self.assertEqual(sessions.config()['worker'], '/application/worker.js')
            executable = json.loads(sessions.execution_config_path().read_text())
            self.assertEqual(executable['node'], '/application/node')
            self.assertEqual(executable['userNote'], 'keep')
            self.assertEqual(path.read_bytes(), original)

    def test_app_quit_preserves_a_linked_game_that_has_only_paused(self):
        from pokemon_suite.desktop import close_sessions
        class LinkedOwner:
            def snapshots(self):
                return [{'game':'firered', 'sessionId':'linked', 'state':'running'}]
            def stop_game(self, game, session_id):
                self.stopped = (game, session_id)
                return {'game':game, 'state':'paused', 'localEvolution':{'phase':'trading'}}
        owner = LinkedOwner()
        with self.assertRaisesRegex(ValueError, 'still open|trade|paused'):
            close_sessions(owner)
        self.assertEqual(owner.stopped, ('firered','linked'))


    def test_desktop_diagnostics_check_the_bundled_runtime_instead_of_stale_host_paths(self):
        from pokemon_suite.bootstrap import doctor
        import shutil
        with tempfile.TemporaryDirectory() as temporary:
            Path(temporary, 'config.json').write_text(json.dumps({'games': {}, 'node': '/removed/host/node'}))
            result = doctor(temporary, runtime_overrides={'node': shutil.which('node')})
            self.assertEqual(result['issues'], [])

    def test_background_bot_workers_inherit_the_native_runtime(self):
        from unittest.mock import patch
        import shutil
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary)
            (root/'config.json').write_text(json.dumps({'games': {}, 'node': '/removed/host/node'}))
            with patch.dict('os.environ', {'POKEMON_SUITE_DESKTOP_NODE': shutil.which('node')}):
                sessions = SuiteSessions(root)
            self.assertEqual(sessions.config()['node'], str(Path(shutil.which('node')).resolve()))

    def test_collection_helpers_stop_when_their_native_parent_exits(self):
        from pokemon_suite.desktop import desktop_parent_alive
        import subprocess
        import sys
        child = subprocess.Popen([sys.executable, '-c', 'import sys; sys.stdin.read()'], stdin=subprocess.PIPE)
        try:
            self.assertTrue(desktop_parent_alive(str(child.pid)))
        finally:
            child.stdin.close(); child.wait(timeout=3)
        self.assertFalse(desktop_parent_alive(str(child.pid)))
        self.assertTrue(desktop_parent_alive(''))
