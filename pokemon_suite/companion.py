"""Opt-in TLS companion for a running loopback Suite service.

The desktop owns all saves and game processes. This relay never replays a
command and never exposes file import, app quit, or software installation.
"""
import argparse
import base64
import hashlib
import http.client
import ipaddress
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
import json
import os
from pathlib import Path
import re
import secrets
import socket
import ssl
import subprocess
import threading
import time
from urllib.parse import urlsplit

GET_PATHS = {'/api/pokemon-suite/pokedex', '/api/state', '/data/champions.json', '/api/pokemon-suite/inventory', '/api/pokemon-suite/player-tasks',
             '/api/pokemon-suite/bot-settings', '/api/pokemon-suite/campaign-runs',
             '/api/pokemon-suite/sessions', '/api/pokemon-suite/shinies', '/api/pokemon-suite/reports', '/api/pokemon-farming/requests',
             '/api/pokemon-suite/goals', '/api/pokemon-suite/bank', '/api/pokemon-suite/builder/guidance',
             '/api/pokemon-suite/builder/individual', '/api/pokemon-suite/builder/legality'}
POST_PATHS = {'/api/pokemon-suite/builder/plan', '/api/pokemon-suite/builder/request', '/api/select', '/api/pokemon-suite/start-game', '/api/pokemon-suite/stop-game',
              '/api/pokemon-suite/save', '/api/pokemon-suite/input', '/api/pokemon-suite/player-tasks',
              '/api/pokemon-suite/bot-settings', '/api/pokemon-suite/inventory-source',
              '/api/pokemon-suite/trade-plan', '/api/pokemon-suite/trade-pokemon',
              '/api/pokemon-suite/check-radio', '/api/pokemon-suite/stop-trade',
              '/api/pokemon-suite/campaign-runs/preview', '/api/pokemon-suite/campaign-runs/start',
              '/api/pokemon-farming/preview', '/api/pokemon-farming/requests',
              '/api/pokemon-farming/start', '/api/pokemon-farming/stop', '/api/pokemon-farming/remove',
              '/api/pokemon-suite/goals', '/api/pokemon-suite/goals/cancel',
              '/api/pokemon-suite/requests/interpret', '/api/pokemon-suite/requests/select', '/api/pokemon-suite/requests/commit', '/api/pokemon-suite/requests/cancel',
              '/api/pokemon-suite/requests/warm'}

def allowed_route(method, target):
    parsed = urlsplit(target)
    if parsed.scheme or parsed.netloc or parsed.fragment or '%' in parsed.path or '..' in parsed.path or not target.startswith('/'):
        return False
    if method == 'POST': return parsed.path in POST_PATHS
    if method != 'GET': return False
    return parsed.path in GET_PATHS or bool(re.fullmatch(
        r'/(?:data/pokedex/(?:firered|leafgreen|emerald|crystal)\.json|api/rom-art/[a-z0-9-]+/[a-z]+/[a-z0-9-]+\.png|game/[a-z0-9-]+/(?:stream|audio|frame|health|status))', parsed.path))

class CompanionServer(ThreadingHTTPServer):
    daemon_threads = True
    def __init__(self, address, upstream_port, token, tls_context=None):
        self.upstream_port, self.token = int(upstream_port), token
        self.tls_context = tls_context
        self.clients=set();self.clients_lock=threading.Lock()
        super().__init__(address, CompanionHandler)
    def get_request(self):
        connection, address = super().get_request()
        connection.settimeout(15)
        if self.tls_context:
            connection = self.tls_context.wrap_socket(connection, server_side=True, do_handshake_on_connect=False)
        with self.clients_lock:self.clients.add(connection)
        return connection, address
    def shutdown_request(self, request):
        with self.clients_lock:self.clients.discard(request)
        super().shutdown_request(request)
    def server_close(self):
        super().server_close()
        with self.clients_lock:clients=list(self.clients);self.clients.clear()
        for connection in clients:
            try:connection.shutdown(socket.SHUT_RDWR)
            except OSError:pass
            connection.close()
    def process_request_thread(self, request, client_address):
        if self.tls_context:
            try: request.do_handshake()
            except OSError:
                self.shutdown_request(request)
                return
        super().process_request_thread(request, client_address)

class CompanionHandler(BaseHTTPRequestHandler):
    def log_message(self, *_): pass  # Pairing credentials never enter request logs.
    def handle(self):
        try:super().handle()
        except (ConnectionError,TimeoutError):pass  # Stop Sharing also closes existing clients.
    def do_GET(self): self.forward()
    def do_POST(self): self.forward()
    def fail(self, status, message):
        body = json.dumps({'error': message}).encode()
        self.send_response(status); self.send_header('Content-Type', 'application/json')
        self.send_header('Content-Length', str(len(body))); self.end_headers(); self.wfile.write(body)
    def forward(self):
        self.connection.settimeout(15)
        if not secrets.compare_digest(self.headers.get('Authorization',''), 'Bearer ' + self.server.token):
            return self.fail(401, 'Connect using the code from your Mac.')
        if self.headers.get('Origin') or not allowed_route(self.command, self.path):
            return self.fail(403, 'This action is only available on the Mac.')
        body = None
        if self.command == 'POST':
            try:
                length = int(self.headers.get('Content-Length','0'))
                if not 0 < length <= 128 * 1024: raise ValueError()
                body = self.rfile.read(length)
                if not isinstance(json.loads(body),dict): raise ValueError()
            except (ValueError, OSError): return self.fail(400, 'Invalid command.')
        upstream = http.client.HTTPConnection('127.0.0.1', self.server.upstream_port, timeout=120)
        sent = False
        try:
            # Resolve the current local session; never send its cookie remotely.
            upstream.request('GET','/')
            root = upstream.getresponse(); cookie = root.getheader('Set-Cookie','').split(';')[0]; root.read()
            if root.status != 200 or not cookie.startswith('pokemon-suite-session='):
                return self.fail(503,'Open Pokémon Suite on your Mac.')
            headers = {'Cookie':cookie, 'Origin':f'http://127.0.0.1:{self.server.upstream_port}'}
            if body is not None: headers['Content-Type']='application/json'
            upstream.request(self.command,self.path,body,headers)
            response=upstream.getresponse()
            self.send_response(response.status)
            for name in ['Content-Type','Content-Length','Content-Encoding','X-Frame-Width','X-Frame-Height','X-Frame-Sequence']:
                value=response.getheader(name)
                if value is not None: self.send_header(name,value)
            self.send_header('Cache-Control','no-store');self.end_headers();sent=True
            while chunk:=response.read1(64*1024): self.wfile.write(chunk);self.wfile.flush()
        except (OSError,http.client.HTTPException):
            if not sent: self.fail(503,'The Mac connection stopped. Check its current state before trying the action again.')
        finally: upstream.close()

def local_address():
    for interface in ['en0','en1']:
        result=subprocess.run(['/usr/sbin/ipconfig','getifaddr',interface],capture_output=True,text=True)
        if result.returncode==0 and result.stdout.strip(): return result.stdout.strip()
    raise ValueError('Connect the Mac to your local network first.')

def network_addresses():
    addresses = []
    # App builds and CLI installations can use different daemons. Prefer the
    # native app; never change its login, routes, Serve or tailnet policy.
    for executable in [Path('/Applications/Tailscale.app/Contents/MacOS/Tailscale'),
                       Path.home()/'Applications/Tailscale.app/Contents/MacOS/Tailscale',
                       Path('/opt/homebrew/bin/tailscale'), Path('/usr/local/bin/tailscale')]:
        if not os.access(executable, os.X_OK): continue
        try:
            result = subprocess.run([str(executable), 'status', '--json'], capture_output=True, text=True, timeout=3)
            if result.returncode != 0: continue
            status = json.loads(result.stdout)
            if not isinstance(status, dict) or status.get('BackendState') != 'Running': continue
            device = status.get('Self') or {}
            if not isinstance(device, dict) or device.get('Online') is not True or device.get('Expired'): continue
            for candidate in device.get('TailscaleIPs') or []:
                try: address = ipaddress.ip_address(candidate)
                except ValueError: continue
                if address.version == 4 and address in ipaddress.ip_network('100.64.0.0/10'):
                    addresses.append(('tailscale', str(address)))
                    break
            if addresses: break
        except (OSError, subprocess.TimeoutExpired, ValueError): continue
    try: addresses.append(('local', local_address()))
    except (OSError, ValueError): pass
    if not addresses:
        raise ValueError('Connect Tailscale or join a local network on this Mac. Sharing reconnects automatically.')
    return addresses

class CompanionSharing:
    """A listener owned by exactly one running Mac service, not a child process."""
    def __init__(self, directory, upstream_port, port=55443, address=None):
        self.directory=Path(directory)
        self.upstream_port=int(upstream_port);self.port=port
        self.server=None;self.thread=None;self.lock=threading.RLock()
        self.connections=[];self.network_error=None;self.checked_at=0
        self.address=address

    def restore(self):
        path=self.directory/'settings.json'
        try:
            settings=json.loads(path.read_text()) if path.exists() else {}
            if not isinstance(settings,dict):raise ValueError('Invalid companion sharing settings.')
            if settings.get('enabled') is True:self.set_enabled(True)
        except (OSError,ValueError) as error:self.network_error=str(error)

    def set_enabled(self, enabled):
        if type(enabled) is not bool:raise ValueError('Choose whether companion sharing is enabled.')
        from .suite_save_store import atomic_file
        with self.lock:
            self.directory.mkdir(parents=True,exist_ok=True,mode=0o700)
            if enabled and self.server is None:
                cert,key=self.directory/'certificate.pem',self.directory/'key.pem'
                if cert.exists()!=key.exists():raise ValueError('The saved companion certificate is incomplete. Restore its matching certificate and key.')
                if not cert.exists():
                    subprocess.run(['/usr/bin/openssl','req','-x509','-newkey','rsa:2048','-nodes','-keyout',str(key),'-out',str(cert),'-days','365','-subj','/CN=Pokemon Suite Companion'],check=True,stdout=subprocess.DEVNULL,stderr=subprocess.DEVNULL)
                    os.chmod(key,0o600)
                token_path=self.directory/'token'
                if not token_path.exists():atomic_file(token_path,secrets.token_hex(32).encode())
                token=token_path.read_text().strip()
                if not re.fullmatch('[a-f0-9]{64}',token):raise ValueError('Invalid companion credential.')
                context=ssl.SSLContext(ssl.PROTOCOL_TLS_SERVER);context.minimum_version=ssl.TLSVersion.TLSv1_2
                context.load_cert_chain(cert,key)
                server=CompanionServer(('0.0.0.0',self.port),self.upstream_port,token,tls_context=context)
                self.server=server
                self.thread=threading.Thread(target=server.serve_forever,daemon=True,name='suite-companion')
                self.thread.start()
            elif not enabled:self.close()
            atomic_file(self.directory/'settings.json',json.dumps({'enabled':enabled}).encode())
            return self.status(refresh=True)

    def status(self, refresh=False):
        from .suite_save_store import atomic_file
        with self.lock:
            if self.server and (refresh or time.monotonic()-self.checked_at>15):
                self.checked_at=time.monotonic();self.network_error=None
                try:addresses=[('local',self.address)] if self.address else network_addresses()
                except (OSError,ValueError) as error:addresses=[];self.network_error=str(error)
                self.connections=[]
                cert=self.directory/'certificate.pem'
                fingerprint=hashlib.sha256(ssl.PEM_cert_to_DER_cert(cert.read_text())).hexdigest()
                for network,host in addresses:
                    pairing={'version':1,'name':socket.gethostname().removesuffix('.local'),'url':f'https://{host}:{self.server.server_port}',
                             'token':self.server.token,'certificateSHA256':fingerprint}
                    code='pokesuite:'+base64.urlsafe_b64encode(json.dumps(pairing,separators=(',',':')).encode()).decode()
                    if not self.connections:atomic_file(self.directory/'connection.json',json.dumps(pairing).encode())
                    self.connections.append({'network':network,'url':pairing['url'],'code':code,'name':pairing['name']})
            first=self.connections[0] if self.connections else {}
            return {'enabled':self.server is not None,'running':self.server is not None and self.thread.is_alive(),
                    'port':self.server.server_port if self.server else None,**first,'connections':self.connections,'error':self.network_error}

    def close(self):
        with self.lock:
            if self.server:
                self.server.shutdown();self.server.server_close();self.thread.join(timeout=2)
            self.server=None;self.thread=None;self.connections=[];self.network_error=None

def main():
    parser=argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--upstream-port',type=int,required=True)
    parser.add_argument('--directory',type=Path,required=True)
    parser.add_argument('--port',type=int,default=0)
    parser.add_argument('--address')
    args=parser.parse_args()
    sharing=CompanionSharing(args.directory,args.upstream_port,port=args.port,address=args.address)
    sharing.set_enabled(True)
    info=sharing.status(refresh=True)
    print(json.dumps(info),flush=True)
    try:
        while sharing.thread.is_alive(): sharing.thread.join(timeout=1)
    finally: sharing.close()

if __name__=='__main__':
    try: main()
    except (OSError, ValueError) as error:
        print(json.dumps({'error':str(error)}),flush=True)
        raise SystemExit(1)
