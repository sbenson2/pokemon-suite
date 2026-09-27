import http.client
import socket
import ssl
import subprocess
import json
import tempfile
import threading
import unittest
from unittest.mock import patch
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path

from pokemon_suite.companion import CompanionServer, allowed_route
from pokemon_suite import companion


class CompanionTests(unittest.TestCase):
    def test_sharing_restarts_with_the_current_mac_service_and_keeps_pairing(self):
        self.assertTrue(hasattr(companion,'CompanionSharing'),'Sharing must belong to the running Mac service')
        class Upstream(BaseHTTPRequestHandler):
            def log_message(self,*args): pass
            def do_GET(self):
                self.send_response(200)
                if self.path=='/':self.send_header('Set-Cookie','pokemon-suite-session=local; HttpOnly')
                self.end_headers()
                if self.path!='/':self.wfile.write(json.dumps({'hostPort':self.server.server_port}).encode())
        hosts=[ThreadingHTTPServer(('127.0.0.1',0),Upstream) for _ in range(2)]
        for host in hosts:threading.Thread(target=host.serve_forever,daemon=True).start()
        with tempfile.TemporaryDirectory() as tmp, patch.object(companion,'network_addresses',return_value=[('tailscale','100.101.102.103')]):
            sharing=companion.CompanionSharing(Path(tmp),hosts[0].server_port,port=0)
            try:
                first=sharing.set_enabled(True);port=first['port']
                pairing=json.loads((Path(tmp)/'connection.json').read_text())
                def get():
                    client=http.client.HTTPSConnection('127.0.0.1',port,context=ssl._create_unverified_context(),timeout=3)
                    client.request('GET','/api/state',headers={'Authorization':'Bearer '+pairing['token']})
                    r=client.getresponse();result=(r.status,json.load(r));client.close();return result
                self.assertEqual(get(),(200,{'hostPort':hosts[0].server_port}))
                sharing.close()
                with self.assertRaises(OSError):socket.create_connection(('127.0.0.1',port),timeout=.5)
                sharing=companion.CompanionSharing(Path(tmp),hosts[1].server_port,port=port)
                sharing.restore()
                second=json.loads((Path(tmp)/'connection.json').read_text())
                self.assertEqual(second,pairing,'App restarts must not require pairing again')
                self.assertEqual(get(),(200,{'hostPort':hosts[1].server_port}))
                sharing.set_enabled(False)
                sharing.restore();self.assertFalse(sharing.status()['enabled'])
            finally:
                sharing.close()
                for host in hosts:host.shutdown();host.server_close()

    def test_temporarily_missing_network_does_not_disable_existing_sharing(self):
        self.assertTrue(hasattr(companion,'CompanionSharing'))
        with tempfile.TemporaryDirectory() as tmp, patch.object(companion,'network_addresses',side_effect=ValueError('No network')):
            sharing=companion.CompanionSharing(Path(tmp),1,port=0)
            try:
                state=sharing.set_enabled(True)
                self.assertTrue(state['enabled']);self.assertEqual(state['connections'],[])
                with patch.object(companion,'network_addresses',return_value=[('tailscale','100.101.102.103')]):
                    restored=sharing.status(refresh=True)
                self.assertEqual(restored['connections'][0]['network'],'tailscale')
                self.assertTrue(restored['running'])
            finally:sharing.close()

    def test_stopping_sharing_disconnects_existing_tls_clients(self):
        with tempfile.TemporaryDirectory() as tmp, patch.object(companion,'network_addresses',return_value=[('local','127.0.0.1')]):
            sharing=companion.CompanionSharing(Path(tmp),1,port=0)
            try:
                state=sharing.set_enabled(True)
                client=ssl._create_unverified_context().wrap_socket(socket.create_connection(('127.0.0.1',state['port']),timeout=2),server_hostname='localhost')
                sharing.set_enabled(False)
                self.assertEqual(client.recv(1),b'','Stop Sharing must close the already connected phone too')
                client.close()
            finally:sharing.close()

    def test_pairing_prefers_connected_tailscale_without_needing_wifi(self):
        status = {'BackendState': 'Running', 'Self': {'Online': True, 'TailscaleIPs': ['fd7a:115c:a1e0::1', '100.101.102.103']}}
        with patch.object(companion.os, 'access', return_value=True), patch.object(companion.subprocess, 'run', return_value=subprocess.CompletedProcess([], 0, json.dumps(status), '')), patch.object(companion, 'local_address', return_value='192.168.1.2'):
            self.assertEqual(companion.network_addresses(), [('tailscale', '100.101.102.103'), ('local', '192.168.1.2')])
        with patch.object(companion.os, 'access', return_value=True), patch.object(companion.subprocess, 'run', return_value=subprocess.CompletedProcess([], 0, json.dumps(status), '')), patch.object(companion, 'local_address', side_effect=ValueError('No Wi-Fi')):
            self.assertEqual(companion.network_addresses(), [('tailscale', '100.101.102.103')])

    def test_local_pairing_remains_available_when_tailscale_is_offline_or_invalid(self):
        for status in [
            {'BackendState': 'Stopped', 'Self': {'Online': True, 'TailscaleIPs': ['100.101.102.103']}},
            {'BackendState': 'Running', 'Self': {'Online': False, 'TailscaleIPs': ['100.101.102.103']}},
            {'BackendState': 'Running', 'Self': {'Online': True, 'TailscaleIPs': ['192.168.1.2', 'bad']}},
            {'BackendState': 'Running', 'Self': {'Online': True, 'Expired': True, 'TailscaleIPs': ['100.101.102.103']}},
            None,
        ]:
            with self.subTest(status=status), patch.object(companion.os, 'access', return_value=True), patch.object(companion.subprocess, 'run', return_value=subprocess.CompletedProcess([], 0, json.dumps(status), '')), patch.object(companion, 'local_address', return_value='192.168.1.2'):
                self.assertEqual(companion.network_addresses(), [('local', '192.168.1.2')])

    def test_unresponsive_tailscale_does_not_prevent_local_pairing(self):
        with patch.object(companion.os, 'access', return_value=True), patch.object(companion.subprocess, 'run', side_effect=subprocess.TimeoutExpired('tailscale', 3)), patch.object(companion, 'local_address', return_value='192.168.1.2'):
            self.assertEqual(companion.network_addresses(), [('local', '192.168.1.2')])

    def test_route_boundary_excludes_host_files_and_installation(self):
        for path in ['/api/state', '/api/pokemon-suite/inventory?game=firered', '/api/rom-art/firered/pokemon/56.png?shiny=1', '/game/firered/stream']:
            self.assertTrue(allowed_route('GET', path), path)
        for path in ['/api/companion', '/api/desktop/quit', '/api/install/firered', '/api/pokemon-suite/updates', '/api/pokemon-suite/inventory-sources', '//evil/api/state', '/api/state/../desktop/quit', '/api/%73tate']:
            self.assertFalse(allowed_route('POST', path), path)
            self.assertFalse(allowed_route('GET', path), path)

    def test_authentication_and_forwarding_preserve_one_command(self):
        requests = []
        class Upstream(BaseHTTPRequestHandler):
            def log_message(self, *args): pass
            def do_GET(self):
                if self.path == '/':
                    self.send_response(200); self.send_header('Set-Cookie', 'pokemon-suite-session=local-secret; HttpOnly'); self.end_headers(); return
                requests.append((self.command,self.path,self.headers.get('Cookie'),None))
                self.send_response(200); self.send_header('Content-Type','application/json'); self.end_headers(); self.wfile.write(b'{"library":[]}')
            def do_POST(self):
                body=self.rfile.read(int(self.headers['Content-Length']))
                requests.append((self.command,self.path,self.headers.get('Cookie'),json.loads(body)))
                self.send_response(409); self.end_headers(); self.wfile.write(b'{"error":"Trade in progress"}')
        upstream=ThreadingHTTPServer(('127.0.0.1',0),Upstream)
        server=CompanionServer(('127.0.0.1',0),upstream.server_port,'t'*64)
        for item in [upstream,server]: threading.Thread(target=item.serve_forever,daemon=True).start()
        def request(method,path,token=None,body=None):
            conn=http.client.HTTPConnection(*server.server_address,timeout=3)
            headers={'Authorization':'Bearer '+token} if token else {}
            if body: headers['Content-Type']='application/json'
            conn.request(method,path,json.dumps(body) if body else None,headers)
            response=conn.getresponse(); result=(response.status,response.read(),dict(response.getheaders()));conn.close();return result
        try:
            self.assertEqual(request('GET','/api/state')[0],401)
            self.assertEqual(request('GET','/api/state','wrong')[0],401)
            self.assertEqual(requests,[])
            status,body,headers=request('GET','/api/state','t'*64)
            self.assertEqual((status,json.loads(body)),(200,{'library':[]}))
            self.assertNotIn('Set-Cookie',headers)
            status,body,_=request('POST','/api/pokemon-suite/stop-game','t'*64,{'game':'firered'})
            self.assertEqual(status,409)
            self.assertEqual(json.loads(body)['error'],'Trade in progress')
            self.assertEqual(requests,[('GET','/api/state','pokemon-suite-session=local-secret',None),('POST','/api/pokemon-suite/stop-game','pokemon-suite-session=local-secret',{'game':'firered'})])
            self.assertEqual(request('POST','/api/desktop/quit','t'*64,{'quit':True})[0],403)
            self.assertEqual(len(requests),2)
        finally:
            for item in [server,upstream]: item.shutdown();item.server_close()

    def test_idle_tls_client_does_not_block_another_connection(self):
        with tempfile.TemporaryDirectory() as tmp:
            cert,key=Path(tmp)/'cert.pem',Path(tmp)/'key.pem'
            subprocess.run(['/usr/bin/openssl','req','-x509','-newkey','rsa:2048','-nodes','-keyout',str(key),'-out',str(cert),'-days','1','-subj','/CN=localhost'],check=True,stdout=subprocess.DEVNULL,stderr=subprocess.DEVNULL)
            context=ssl.SSLContext(ssl.PROTOCOL_TLS_SERVER);context.load_cert_chain(cert,key)
            server=CompanionServer(('127.0.0.1',0),1,'t'*64,tls_context=context)
            threading.Thread(target=server.serve_forever,daemon=True).start()
            idle=socket.create_connection(server.server_address,timeout=2)
            try:
                client=http.client.HTTPSConnection(*server.server_address,timeout=2,context=ssl._create_unverified_context())
                client.request('GET','/api/state');response=client.getresponse()
                self.assertEqual(response.status,401);response.read();client.close()
            finally: idle.close();server.shutdown();server.server_close()

if __name__=='__main__': unittest.main()
