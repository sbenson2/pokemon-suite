"""Status transport failures must not become emulator lifecycle events."""
import json
import os
from pathlib import Path
import tempfile
import threading
import time
import unittest
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer

from pokemon_suite.pokemon_sessions import SuiteSessions


class SessionLivenessTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        self.root = Path(self.temp.name)
        self.live = {'schema': 'pokemon-suite/session/v1', 'game': 'emerald',
                     'sessionId': 'original', 'pid': os.getpid(), 'state': 'running',
                     'frame': 100, 'spectator': {'party': [{'species': 1}]}}
        self.delay = 0
        self.payload = None
        fixture = self

        class Handler(BaseHTTPRequestHandler):
            def do_GET(self):
                body = fixture.payload if fixture.payload is not None else json.dumps(fixture.live).encode()
                time.sleep(fixture.delay)
                try:
                    self.send_response(200)
                    self.send_header('Content-Length', str(len(body)))
                    self.end_headers()
                    self.wfile.write(body)
                except (BrokenPipeError, ConnectionResetError):
                    pass

            def log_message(self, *args):
                pass

        self.server = ThreadingHTTPServer(('127.0.0.1', 0), Handler)
        thread = threading.Thread(target=self.server.serve_forever, daemon=True)
        thread.start()
        self.addCleanup(self.server.server_close)
        self.addCleanup(self.server.shutdown)
        (self.root / 'config.json').write_text(json.dumps({'games': {'emerald': {'port': self.server.server_port}}}))
        (self.root / 'emerald').mkdir()
        self.owner = self.root / 'emerald/owner.lock'
        self.owner.write_text(json.dumps({'pid': os.getpid()}))
        self.sessions = SuiteSessions(self.root)

    def test_complete_status_larger_than_256kb_keeps_the_running_game_visible(self):
        self.live['campaign'] = {'checkpoints': ['checkpoint details' * 18000]}
        snapshot = self.sessions.snapshots()[0]
        self.assertEqual(snapshot['state'], 'running')
        self.assertEqual(snapshot['sessionId'], 'original')
        self.assertEqual(snapshot['campaign'], self.live['campaign'])

    def test_timeout_keeps_same_owner_screen_then_recovers_fresh_telemetry(self):
        self.sessions.snapshots()
        self.delay = .7
        stale = self.sessions.snapshots()[0]
        self.assertEqual(stale['state'], 'reconnecting')
        self.assertEqual(stale['sessionId'], 'original')
        self.assertEqual(stale['spectator']['party'], [{'species': 1}])
        self.assertEqual(stale['connection']['lastState'], 'running')
        # Cached display data must never authorize a bot command or update.
        self.assertIsNone(self.sessions._live('emerald'))
        self.delay = 0
        self.live['frame'] = 200
        recovered = self.sessions.snapshots()[0]
        self.assertEqual(recovered['state'], 'running')
        self.assertEqual(recovered['frame'], 200)
        self.assertEqual(recovered['connection']['state'], 'connected')

    def test_invalid_status_and_first_poll_with_live_owner_are_reconnecting(self):
        self.payload = b'{incomplete'
        snapshot = self.sessions.snapshots()[0]
        self.assertEqual(snapshot['state'], 'reconnecting')
        self.assertNotIn('sessionId', snapshot)
        self.assertIsNone(self.sessions._live('emerald'))

    def test_closed_or_missing_owner_does_not_keep_a_cached_game_running(self):
        self.sessions.snapshots()
        self.live['state'] = 'closed'
        self.assertEqual(self.sessions.snapshots()[0]['state'], 'closed')
        self.payload = b'invalid'
        self.assertEqual(self.sessions.snapshots()[0]['state'], 'closed')
        self.owner.unlink()
        self.payload = b'invalid'
        stopped = self.sessions.snapshots()[0]
        self.assertEqual(stopped['state'], 'offline')
        self.assertNotIn('sessionId', stopped)

    def test_another_owner_cannot_inherit_cached_party_or_session_identity(self):
        self.sessions.snapshots()
        self.owner.write_text(json.dumps({'pid': os.getppid()}))
        self.payload = b'invalid'
        snapshot = self.sessions.snapshots()[0]
        self.assertEqual(snapshot['state'], 'reconnecting')
        self.assertNotIn('sessionId', snapshot)
        self.assertNotIn('spectator', snapshot)

    def test_replacement_session_does_not_inherit_the_previous_game_telemetry(self):
        self.sessions.snapshots()
        self.live.update(sessionId='replacement', frame=1, spectator={'party': []})
        snapshot = self.sessions.snapshots()[0]
        self.assertEqual(snapshot['sessionId'], 'replacement')
        self.assertEqual(snapshot['spectator']['party'], [])

    def test_excessive_payload_is_rejected_without_reporting_a_live_owner_stopped(self):
        self.payload = b' ' * (5 * 1024 * 1024)
        self.assertIsNone(self.sessions._live('emerald'))
        self.assertEqual(self.sessions.snapshots()[0]['state'], 'reconnecting')
