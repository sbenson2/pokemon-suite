"""Persistent per-game playback owner. Viewer disconnects do not reset the game."""
import hashlib
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
import json
import os
from .processes import assert_process_alive
from pathlib import Path
import queue
import signal
import struct
import sys
import threading
import time
import uuid
from datetime import datetime, timezone

from pokemon_suite.pokemon_main_series import MAIN_GAMES
from pokemon_suite.suite_libretro import LibretroCore, InputState
from pokemon_suite.suite_save_store import SaveStore, atomic_file

def utc():return datetime.now(timezone.utc).isoformat()
def file_hash(path):
    with Path(path).open('rb') as f:return hashlib.file_digest(f,'sha256').hexdigest()

class CommandMailbox:
    """A new owner accepts commands issued after its launch, once each."""
    def __init__(self,path):
        self.path=Path(path)
        self.last_id=self._read().get('commandId')
    def _read(self):
        try:return json.loads(self.path.read_text())
        except FileNotFoundError:return {}
    def poll(self):
        command=self._read();identifier=command.get('commandId')
        if not identifier or identifier==self.last_id:return None
        self.last_id=identifier
        return command

def run(config_path,game):
    config=json.loads(Path(config_path).read_text());cfg=config['games'][game];descriptor=MAIN_GAMES[game]
    if cfg.get('backend')!='libretro':raise ValueError('This is not a configured native playback session.')
    directory=Path(config['directory'])/game;directory.mkdir(parents=True,exist_ok=True,mode=0o700)
    lock=directory/'owner.lock'
    if lock.exists():
        previous=json.loads(lock.read_text())
        try:assert_process_alive(previous['pid'])
        except ProcessLookupError:lock.unlink()
        else:raise ValueError('This game already has an owner.')
    fd=os.open(lock,os.O_CREAT|os.O_EXCL|os.O_WRONLY,0o600)
    with os.fdopen(fd,'w') as f:json.dump({'pid':os.getpid(),'game':game},f)
    core=None;server=None;stopping=threading.Event();condition=threading.Condition()
    audio_clients=set();latest={'frame':0,'rgba':b''};input_state=InputState(descriptor['platform']);input_lock=threading.Lock()
    session_id=uuid.uuid4().hex
    status={'schema':'pokemon-suite/session/v1','game':game,'descriptor':{k:v for k,v in descriptor.items() if k!='header'},
        'sessionId':session_id,'runId':game+'-'+session_id[:8],'state':'loading','updatedAt':utc(),'frame':0,
        'emulationSpeed':1,'mode':'manual','capabilities':{'play':True,'touch':descriptor['platform']=='nds','bot':False,'hunt':False,'checkpoint':True,'speed':False},
        'control':{'mode':'manual','manualButtons':[]},'save':None,'lastCommand':None}
    def shutdown(*_):stopping.set()
    signal.signal(signal.SIGTERM,shutdown);signal.signal(signal.SIGINT,shutdown)

    class Handler(BaseHTTPRequestHandler):
        protocol_version='HTTP/1.1'
        def log_message(self,*args):pass
        def send_json(self,value,code=200):
            data=json.dumps(value).encode();self.send_response(code);self.send_header('Content-Type','application/json');self.send_header('Content-Length',str(len(data)));self.send_header('Cache-Control','no-store');self.end_headers();self.wfile.write(data)
        def do_GET(self):
            if self.path=='/status':self.send_json(status);return
            if self.path=='/health':
                self.send_json({'ok':True,'game':game,'audio':{'path':'/audio','format':'s16le','channels':2,'tempo':1,'sampleRate':core.sample_rate}});return
            if self.path not in {'/stream','/audio','/frame'}:self.send_json({'error':'Not found'},404);return
            self.send_response(200);self.send_header('Content-Type','application/octet-stream');self.send_header('Connection','close');self.end_headers()
            self.close_connection=True;self.connection.settimeout(2)
            try:
                if self.path=='/frame':self.wfile.write(latest['rgba']);return
                if self.path=='/stream':
                    sequence=-1
                    while not stopping.is_set():
                        with condition:
                            condition.wait_for(lambda:latest['frame']!=sequence or stopping.is_set(),timeout=1)
                            sequence=latest['frame'];pixels=latest['rgba']
                        if not pixels:continue
                        packet=struct.pack('>4sHHII',b'MRF1',core.width,core.height,len(pixels),sequence&0xffffffff)
                        self.wfile.write(packet+pixels);self.wfile.flush()
                else:
                    audio=queue.Queue(maxsize=30)
                    with condition:audio_clients.add(audio)
                    try:
                        while not stopping.is_set():
                            try:chunk=audio.get(timeout=1)
                            except queue.Empty:continue
                            self.wfile.write(chunk);self.wfile.flush()
                    finally:
                        with condition:audio_clients.discard(audio)
            except (OSError,TimeoutError):pass
        def do_POST(self):
            try:
                if self.headers.get('Origin'):raise ValueError('Use the authenticated Suite control endpoint.')
                length=int(self.headers.get('Content-Length','0'))
                if not 0<length<=4096:raise ValueError('Invalid input payload size.')
                value=json.loads(self.rfile.read(length))
                if self.path=='/control/input':
                    if not isinstance(value,dict) or set(value)-{'buttons','touch'}:raise ValueError('Invalid input payload.')
                    with input_lock:inputs=input_state.update(value)
                elif self.path=='/control/mode':
                    if value!={'mode':'manual'}:raise ValueError('This game has no qualified bot yet.')
                    with input_lock:inputs=input_state.update({'buttons':[]})
                else:raise ValueError('Unsupported game control.')
                self.send_json({'mode':'manual','manualButtons':inputs['buttons'],'touch':inputs['touch']})
            except (ValueError,TypeError,KeyError) as e:self.send_json({'error':str(e)},400)

    try:
        mailbox=CommandMailbox(directory/'command.json')
        for path,expected in [(cfg['cartridge']['path'],cfg['cartridge']['sha256']),(cfg['core'],cfg['coreSha256']),(cfg['bridge'],cfg['bridgeSha256'])]:
            if not Path(path).is_file() or file_hash(path)!=expected:raise ValueError('Game or emulator identity failed verification. The current save is unchanged.')
        identity={'game':game,'romSha256':cfg['cartridge']['sha256'],'coreSha256':cfg['coreSha256']}
        store=SaveStore(directory/'saves',identity);saved=store.read()
        core=LibretroCore(Path(cfg['bridge']),Path(cfg['core']),Path(cfg['cartridge']['path']),directory/'native')
        frame=0;presentation=None
        if saved:core.restore(saved['state'],saved['sram']);frame=saved['metadata'].get('frame',0);status['save']={k:v for k,v in saved.items() if k not in {'state','sram'}}
        def checkpoint(reason):
            record=store.commit(core.serialize(),core.sram(),{'frame':frame,'reason':reason})
            status['save']=record
            return record
        server=ThreadingHTTPServer(('127.0.0.1',cfg['port']),Handler);server.daemon_threads=True
        threading.Thread(target=server.serve_forever,daemon=True).start()
        status['state']='running';started=time.monotonic();next_frame=started;last_save=started;last_stat=started;stat_frame=frame
        next_command=0
        while not stopping.is_set():
            with input_lock:inputs=input_state.snapshot()
            if not presentation:core.run(inputs);frame+=1
            now=time.monotonic()
            with condition:
                latest.update(frame=frame,rgba=core.frame());audio=core.audio() if not presentation else b''
                for client in audio_clients:
                    try:client.put_nowait(audio)
                    except queue.Full:
                        try:client.get_nowait()
                        except queue.Empty:pass
                        client.put_nowait(audio)
                condition.notify_all()
            if now>=next_command:
                next_command=now+.1
                command=mailbox.poll()
                if command:
                    status['commandError']=None
                    try:
                        if command['type']=='save':checkpoint('requested-checkpoint')
                        elif command['type']=='manual-game':
                            if command.get('boot') is not True:raise ValueError('Choose a console restart.')
                            if command.get('presentationId') is not None and (not isinstance(command['presentationId'],str) or len(command['presentationId'])!=32):raise ValueError('Invalid console presentation.')
                            checkpoint('before-console-boot')
                            with input_lock:input_state.update({'buttons':[]})
                            core.reset();core.run({});frame=1;stat_frame=1;last_stat=now
                            presentation={'id':command['presentationId'],'phase':'waiting'} if command.get('presentationId') else None
                            status.update(frame=frame,state='running',consolePresentation=presentation,control={'mode':'manual','manualButtons':[],'paused':bool(presentation)})
                        elif command['type']=='console-presented':
                            if not presentation or command.get('presentationId')!=presentation['id']:raise ValueError('The console startup changed. Refresh its viewer.')
                            presentation=None;status['consolePresentation']=None;status['control']['paused']=False
                        elif command['type']=='shutdown':
                            if command.get('sessionId')!=session_id:raise ValueError('The game session changed before closing.')
                            shutdown()
                        else:raise ValueError('This playback session has no qualified bot task executor.')
                    except ValueError as e:status['commandError']=str(e)
                    status['lastCommand']=command['commandId']
            if now-last_save>=60:
                checkpoint('automatic-checkpoint');last_save=now
            if now-last_stat>=.25:
                status.update(frame=frame,updatedAt=utc(),sourceFps=round((frame-stat_frame)/(now-last_stat),3),nativeFps=core.fps,
                    control={'mode':'manual','manualButtons':inputs['buttons'],'paused':bool(presentation)},video={'width':core.width,'height':core.height,'layout':descriptor['screenLayout']})
                last_stat=now;stat_frame=frame
            next_frame+=1/core.fps
            if now-next_frame>.1:next_frame=now
            stopping.wait(max(0,next_frame-time.monotonic()))
        checkpoint('owner-shutdown');status['state']='stopped'
    finally:
        stopping.set()
        if server:server.shutdown();server.server_close()
        if core:core.close()
        if lock.exists() and json.loads(lock.read_text()).get('pid')==os.getpid():lock.unlink()

if __name__=='__main__':run(*sys.argv[1:])
