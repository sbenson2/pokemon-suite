"""Standalone, loopback-owned Suite HTTP service and emulator feed relay."""
from http import HTTPStatus
from http.cookies import SimpleCookie
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
import http.client
import json
import mimetypes
import re
from pathlib import Path
import secrets
import threading
from urllib.parse import urlsplit, unquote, parse_qs

from .bootstrap import initialize, doctor
from .http_routes import SuiteRoutes
from .pokemon_sessions import SuiteSessions
from .postgame_partner import PostgamePartners
from .pokemon_farming import suite_requests
from .pokemon_goals import GoalSupervisor
from .suite_save_store import atomic_file
from .static_assets import fallback_icon
from .rom_art import RomArtwork, artwork_request
from .updates import UpdateManager
from .update_feed import UpdateFeed
from .data_provider import DataProvider
from .trading import TradingLibrary
from .companion import CompanionSharing

STATIC = Path(__file__).parent / 'static'


class SuiteServer(ThreadingHTTPServer):
    daemon_threads = True
    # A page load opens about thirty connections at once; the default listen
    # backlog of five made macOS reset some, so browsers lost scripts. 128 is
    # the macOS default kern.ipc.somaxconn.
    request_queue_size = 128

    def __init__(self, directory, port=0):
        self.directory = Path(directory).resolve()
        initialize(self.directory)
        self.pokemon_sessions = SuiteSessions(self.directory)
        self.trading = TradingLibrary(self.pokemon_sessions)
        # One request database (the collection's legacy rows are merged once).
        self.pokemon_farming = suite_requests(self.directory, self.pokemon_sessions)
        self.rom_art = RomArtwork(self.directory, STATIC)
        self.updates = UpdateManager(self.pokemon_sessions)
        self.update_feed = UpdateFeed(self.directory)
        self.updates.start()
        self.desktop = False
        self.token = secrets.token_urlsafe(32)
        super().__init__(('127.0.0.1', port), Handler)
        self.companion = CompanionSharing(self.directory/'companion',self.server_port)
        self.postgame_partners = PostgamePartners(self.pokemon_sessions)
        self.postgame_partners.start()
        self.goals = GoalSupervisor(self.pokemon_sessions, self.pokemon_farming, self.trading)
        self.goals.start()
        # Laya loads with the host (a restart or deploy used to leave the next requests rule-only); never blocks startup.
        self.prewarm = threading.Thread(target=self._prewarm_requests, name='laya-prewarm', daemon=True)
        self.prewarm.start()

    def _prewarm_requests(self):
        from .pokemon_requests import prewarm
        prewarm(self)

    def server_close(self):
        if getattr(self,'goals',None):self.goals.close()
        if getattr(self,'prewarm',None):self.prewarm.join(5)  # a warm-up still starting Laya is closed below, not left running
        if getattr(self,'pokemon_requests',None):self.pokemon_requests.close()
        if getattr(self,'postgame_partners',None):self.postgame_partners.close()
        if getattr(self,'companion',None):self.companion.close()
        self.updates.close()
        super().server_close()

    def state(self):
        sessions = self.pokemon_sessions.snapshots()
        library = self.pokemon_sessions.library(sessions)
        selection = self.directory / 'interface.json'
        selected = json.loads(selection.read_text()).get('game') if selection.exists() else None
        packs = []
        for entry in library:
            if entry['status'] != 'installed':
                continue
            packs.append({'id': entry['release'], 'name': entry['title'],
                          'releaseIds': [entry['release']], 'game': {**entry, 'id': entry['cartridgeId']}})
        current = next((s for s in sessions if s['game'] == selected), None)
        pack = next((p for p in packs if p['game']['id'] == 'pokemon-' + str(selected)), None)
        cards = [{**p, 'id': p['game']['id']} for p in packs]
        return {'product': 'pokemon-suite', 'version': '0.2.0', 'controlAvailable': True,
                'selected': pack['id'] if pack else '', 'packs': packs, 'cartridges': cards,
                'library': library, 'sessions': sessions, 'session': current,
                'software':{**self.updates.status(),'feed':self.update_feed.status()},
                'diagnostics': doctor(self.directory, self.pokemon_sessions.runtime_overrides),
                'artwork': self.rom_art.snapshot([entry['id'] for entry in sorted(library, key=lambda e: e['status'] != 'installed')])}


class Handler(SuiteRoutes, BaseHTTPRequestHandler):
    def handle(self):
        try:
            super().handle()
        except (BrokenPipeError, ConnectionResetError):
            # A closed browser cannot receive an error response; other failures
            # still propagate to the HTTP server's ordinary error reporting.
            pass

    def log_message(self, *_):
        pass

    def _valid_host(self):
        return self.headers.get('Host') in {f'127.0.0.1:{self.server.server_port}', f'localhost:{self.server.server_port}'}

    def _authenticated(self):
        try:
            cookie = SimpleCookie(self.headers.get('Cookie', ''))
            token = cookie.get('pokemon-suite-session')
            return bool(token and secrets.compare_digest(token.value, self.server.token))
        except Exception:
            return False

    def _control_request(self):
        return self._valid_host() and self._authenticated()

    def _json(self, status, data, head=False):
        body = json.dumps(data).encode()
        self.send_response(status)
        self.send_header('Content-Type', 'application/json')
        self.send_header('Cache-Control', 'no-store')
        self.send_header('Content-Length', str(len(body)))
        self.end_headers()
        if not head:
            self.wfile.write(body)

    def _error(self, status, message):
        self._json(status, {'ok': False, 'error': message})

    def do_GET(self):
        if not self._valid_host():
            return self._error(403, 'Use the local Pokémon Suite address.')
        parsed = urlsplit(self.path)
        path = unquote(parsed.path)
        if path.startswith('/api/') or path.startswith('/game/'):
            if not self._authenticated():
                return self._error(403, 'Open Pokémon Suite to connect to this session.')
            if path == '/api/state':
                return self._json(200, self.server.state())
            if path == '/api/companion' and self.server.desktop:
                return self._json(200, self.server.companion.status())
            if path == '/api/doctor':
                return self._json(200, doctor(self.server.directory, self.server.pokemon_sessions.runtime_overrides))
            if path == '/api/presentation-assets':
                return self._json(200, {'recordings': {}})
            if path == '/api/rom-art-status':
                game = parse_qs(parsed.query).get('game', [''])[0]
                return self._json(200, self.server.rom_art.status(game))
            if path.startswith('/api/rom-art/'):
                request = artwork_request(path)
                return self._artwork(request, parsed) if request else self._error(404, 'Artwork not found.')
            if path.startswith('/game/'):
                return self._game_feed(path)
            if self.route_get(path, parsed) is not False:
                return
            return self._error(404, 'Endpoint not found.')
        parts = Path(path).parts
        if any(part in {'.', '..'} or part.startswith('.') for part in parts if part != '/'):
            return self._error(404, 'File not found.')
        catalog = re.fullmatch(r'/data/pokedex/(firered|leafgreen|emerald|crystal)\.json', path)
        if catalog:
            if not self._authenticated(): return self._error(403, 'Open Pokémon Suite to load local game resources.')
            with DataProvider(self.server.directory).snapshot():
                return self._json(200, self.server.rom_art.catalog(catalog[1]))
        if path.startswith('/assets/pokemon/console-startup/'):
            return self._error(404, 'Startup output comes from the emulator.')
        selection = self.server.directory / 'interface.json'
        selected = json.loads(selection.read_text()).get('game', 'firered') if selection.exists() else 'firered'
        selected = parse_qs(parsed.query).get('game', [selected])[0]
        request = artwork_request(path, selected)
        if request:
            return self._artwork(request, parsed, fallback_icon(path))
        target = (STATIC / (path.lstrip('/') or 'index.html')).resolve()
        if not target.is_relative_to(STATIC.resolve()):
            return self._error(404, 'File not found.')
        if not target.is_file():
            icon=fallback_icon(path)
            target=STATIC/'assets/suite'/f'{icon}.svg' if icon else target
            if not target.is_file():return self._error(404, 'File not found.')
        body = target.read_bytes()
        self.send_response(200)
        self.send_header('Content-Type', mimetypes.guess_type(target)[0] or 'application/octet-stream')
        self.send_header('Content-Length', str(len(body)))
        self.send_header('X-Content-Type-Options', 'nosniff')
        self.send_header('Referrer-Policy', 'no-referrer')
        if target.name == 'index.html':
            self.send_header('Set-Cookie', f'pokemon-suite-session={self.server.token}; HttpOnly; SameSite=Strict; Path=/')
            self.send_header('Cache-Control', 'no-store')
        self.end_headers()
        self.wfile.write(body)

    def _artwork(self, request, parsed, fallback=None):
        game, kind, key, *flags = request
        query = parse_qs(parsed.query)
        shiny = bool(flags and flags[0]) or query.get('shiny') == ['1']
        back = bool(len(flags) > 1 and flags[1]) or query.get('back') == ['1']
        try:
            # Legacy static URLs may show the software's neutral icon publicly.
            # They never open a cartridge before session authentication. API
            # artwork routes are additionally protected by do_GET above.
            if not self._authenticated(): raise ValueError('Local cartridge artwork requires the current session.')
            body = self.server.rom_art.image(game, kind, key, shiny, back)
            mime = 'image/png'
        except (OSError, ValueError, KeyError):
            name = fallback or {'pokemon': 'species', 'trainer': 'trainer', 'item': 'item', 'badges': 'badges'}.get(kind, 'category')
            body = (STATIC / 'assets/suite' / (name + '.svg')).read_bytes()
            mime = 'image/svg+xml'
        self.send_response(200)
        self.send_header('Content-Type', mime)
        self.send_header('Content-Length', str(len(body)))
        self.send_header('Cache-Control', 'no-store')
        self.send_header('X-Content-Type-Options', 'nosniff')
        self.end_headers()
        self.wfile.write(body)

    def do_POST(self):
        origin = self.headers.get('Origin')
        allowed = {f'http://127.0.0.1:{self.server.server_port}', f'http://localhost:{self.server.server_port}'}
        if not self._control_request() or origin and origin not in allowed:
            return self._error(403, 'Control requires the current Pokémon Suite session.')
        try:
            length = int(self.headers.get('Content-Length', '0'))
            if not 0 < length <= 128 * 1024:
                raise ValueError('Invalid request size.')
            payload = json.loads(self.rfile.read(length))
            if not isinstance(payload, dict):
                raise ValueError('Expected a request object.')
            path = urlsplit(self.path).path
            if path == '/api/companion' and self.server.desktop:
                if set(payload)!={'enabled'} or type(payload['enabled']) is not bool:raise ValueError('Choose whether companion sharing is enabled.')
                return self._json(200,self.server.companion.set_enabled(payload['enabled']))
            if path == '/api/desktop/quit' and self.server.desktop:
                if payload:raise ValueError('Quit takes no parameters.')
                from .desktop import close_sessions
                close_sessions(self.server.pokemon_sessions)
                self._json(200, {'ok': True})
                threading.Thread(target=self.server.shutdown, daemon=True).start()
                return
            if path == '/api/install/firered':
                from .installation import install_firered
                # The Mac app sends only the ROM; its bundled bot resources are used.
                if set(payload) not in ({'rom'},{'rom','resources'}) or any(not isinstance(value,str) for value in payload.values()):
                    raise ValueError('Choose a game image on this computer.')
                with self.server.pokemon_sessions.lock:
                    result=install_firered(self.server.directory,payload['rom'],payload.get('resources') or None)
                return self._json(200,result)
            if path == '/api/install/frlg':
                # LeafGreen (build 124): the Mac app's one Add flow for either
                # FRLG cartridge; the verified image says which game it is.
                from .installation import install_frlg
                if set(payload)!={'rom'} or not isinstance(payload['rom'],str):
                    raise ValueError('Choose a game image on this computer.')
                with self.server.pokemon_sessions.lock:
                    result=install_frlg(self.server.directory,payload['rom'])
                return self._json(200,result)
            if path == '/api/select':
                game = payload.get('game')
                if set(payload) != {'game'} or not self.server.pokemon_sessions.configured(game):
                    raise ValueError('Choose an installed game.')
                atomic_file(self.server.directory / 'interface.json', json.dumps({'game': game}).encode())
                return self._json(200, {'ok': True})
            if self.route_post(path, payload) is not False:
                return
            self._error(404, 'Endpoint not found.')
        except (ValueError, TypeError, KeyError, OSError) as error:
            self._error(400, str(error))

    def _game_feed(self, path):
        parts = path.strip('/').split('/')
        if len(parts) != 3 or parts[2] not in {'frame', 'stream', 'audio', 'health', 'status'}:
            return self._error(404, 'Game feed not found.')
        _, game, endpoint = parts
        config = self.server.pokemon_sessions.config()['games'].get(game)
        if not config:
            return self._error(404, 'Game is not installed.')
        connection = http.client.HTTPConnection('127.0.0.1', config['port'], timeout=5)
        started = False
        try:
            connection.request('GET', '/' + endpoint)
            response = connection.getresponse()
            self.send_response(response.status)
            for key in ['Content-Type', 'Content-Encoding', 'Content-Length', 'X-Frame-Width', 'X-Frame-Height', 'X-Frame-Sequence']:
                value = response.getheader(key)
                if value is not None:
                    self.send_header(key, value)
            self.send_header('Cache-Control', 'no-store')
            self.end_headers()
            started = True
            while data := response.read1(64 * 1024):
                self.wfile.write(data)
                self.wfile.flush()
        except (OSError, http.client.HTTPException):
            if not started:
                self._error(503, 'The game is not streaming. Start it from ROMs or Live game.')
        finally:
            connection.close()
