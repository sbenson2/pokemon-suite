"""Persistent native 3DS/Switch game owner, independent of the Suite viewer."""
from . import file_lock as fcntl
import hashlib
from http.server import BaseHTTPRequestHandler,ThreadingHTTPServer
import json
import os
from .processes import assert_process_alive
from pathlib import Path
import queue
import signal
import socket
import struct
import subprocess
import sys
import tempfile
import threading
import time
import uuid

from .pokemon_main_series import MAIN_GAMES
from .suite_desktop import DesktopInput,NativeSaveBackup,prepare_launch,check_engine_owner
from .suite_desktop_stream import packet,video,audio,switch_input
from .suite_playback_worker import CommandMailbox,utc,file_hash
from .suite_save_store import atomic_file


class DesktopOwner:
    def __init__(self,config,game):
        self.cfg=config['games'][game];self.game=game;self.desc=MAIN_GAMES[game];self.platform=self.desc['platform']
        self.directory=Path(config['directory'])/game;self.directory.mkdir(parents=True,exist_ok=True,mode=0o700)
        self.profile=self.directory/'native';self.stop=threading.Event();self.condition=threading.Condition()
        self.closing=False;self.launch_lock=threading.Lock();self.lifecycle_lock=threading.Lock()
        self.input=DesktopInput(self.platform);self.input_lock=threading.Lock();self.write_lock=threading.Lock()
        self.clients=set();self.pixels=b'';self.sequence=0;self.last_frame=0;self.child=None;self.capture=None;self.connection=None
        self.width,self.height=(400,480) if self.platform=='3ds' else (1280,720)
        session=uuid.uuid4().hex
        self.status={'schema':'pokemon-suite/session/v1','game':game,'descriptor':{k:v for k,v in self.desc.items() if k!='header'},
            'sessionId':session,'runId':game+'-'+session[:8],'ownerPid':os.getpid(),'state':'loading','updatedAt':utc(),'frame':0,'emulationSpeed':1,'mode':'manual',
            'capabilities':{'play':True,'touch':self.platform=='3ds','bot':False,'hunt':False,'trade':False,'checkpoint':False,'nativeSave':True,'speed':False,'closeGame':True,'input':True},
            'control':{'mode':'manual','manualButtons':[]},'save':None,'lastCommand':None,'message':'Verifying the game and opening its native save.',
            'video':{'width':self.width,'height':self.height,'layout':self.desc['screenLayout']},'nativeFps':30,'sourceFps':0,'textRequest':None}
        self.log=(self.directory/'native-engine.log').open('ab')
        self.temp=Path(tempfile.mkdtemp(prefix='pks-'))

    def error(self,error):
        if getattr(self,'closing',False):return
        if isinstance(error,EOFError) and self.status.get('state') in {'awaiting-permission','error'}:return
        self.status.update(state='error',message=str(error),updatedAt=utc())

    def update_video_status(self,now,started):
        if self.status['state'] in {'error','awaiting-permission','closing','closed'} or self.status.get('textRequest'):return
        if now-max(self.last_frame,started)<=10:return
        if self.platform=='3ds' and self.capture:
            try:locked=json.loads((self.temp/'capture.json').read_text()).get('screenLocked') is True
            except (OSError,ValueError):locked=False
            self.status.update(state='awaiting-display',message='Unlock the computer running Pokémon Suite to show the 3DS game. macOS is withholding its window video.' if locked else 'Waiting for the 3DS game window to provide video.')
        elif self.platform=='switch' and self.last_frame:
            self.status.update(state='awaiting-video',message='The Switch game has stopped providing video. Its session is still open; unsaved progress has not been restarted.')

    def emit(self,kind,data):
        if getattr(self,'closing',False):return
        if kind==b'STA1':
            value=json.loads(data)
            if not isinstance(value,dict) or value.get('state') not in {'running','awaiting-permission','error'}:raise ValueError('Invalid native capture status.')
            next_state=value['state']
            if next_state=='running' and self.status.get('state') in {'loading','awaiting-display'}:next_state=self.status['state']
            self.status.update(state=next_state,message=value.get('message') or None)
            if isinstance(value.get('permissions'),dict):
                self.status['permissions']=value['permissions']
                self.status.setdefault('capabilities',{})['input']=value['permissions'].get('accessibility') is True
            return
        if kind in (b'VID1',b'VID2'):
            if kind==b'VID2':data=video(data,(self.width,self.height))
            if len(data)!=self.width*self.height*4:raise ValueError('The game sent a frame with invalid dimensions.')
            with self.condition:
                self.pixels=data;self.sequence+=1;self.last_frame=time.monotonic();self.condition.notify_all()
            self.status.update(state='running',message=self.status.get('message') if self.status.get('permissions',{}).get('accessibility') is False else None)
        elif kind in (b'AUD1',b'AUD2'):
            if kind==b'AUD2':data=audio(data)
            with self.condition:
                for client in self.clients:
                    if client.full():
                        try:client.get_nowait()
                        except queue.Empty:pass
                    client.put_nowait(data)
        elif kind==b'REQ1':
            value=json.loads(data)
            if value is not None and (not isinstance(value,dict) or not isinstance(value.get('id'),str)):raise ValueError('Invalid game text request.')
            self.status['textRequest']=value

    def pump(self,stream,source=None):
        try:
            while not self.stop.is_set():self.emit(*packet(stream))
        except (EOFError,OSError,ValueError) as error:
            if not self.stop.is_set() and (source is None or source is self.capture):self.error(error)

    def launch(self):
        try:
            cfg=self.cfg
            for path,expected in [(cfg['cartridge']['path'],cfg['cartridge']['sha256']),(cfg['executable'],cfg['executableSha256'])]:
                if not Path(path).is_file() or file_hash(path)!=expected:raise ValueError('Game or emulator identity changed. The current save has been preserved.')
            if self.closing:return
            check_engine_owner(self.directory/'engine.json')
            plan=prepare_launch(self.game,cfg,self.profile);self.plan=plan
            self.backup=NativeSaveBackup(self.directory/'native-backups',self.profile,self.platform,plan['identity'])
            saved=self.directory/'native-backups/current.json'
            if saved.exists():self.status['save']=json.loads(saved.read_text())
            env={**os.environ,**plan['env']}
            if self.platform=='switch':
                server=socket.socket(socket.AF_UNIX,socket.SOCK_STREAM);path=self.temp/'native.sock'
                server.bind(str(path));os.chmod(path,0o600);server.listen(1);server.settimeout(1)
                env['POKEMON_SUITE_SOCKET']=str(path)
                env['DYLD_LIBRARY_PATH']=str(Path(cfg['assembly']).parent)
                command=[cfg['executable'],'exec',cfg['assembly'],*plan['command'][1:]]
                with self.launch_lock:
                    if self.closing:return
                    self.child=subprocess.Popen(command,env=env,stdin=subprocess.DEVNULL,stdout=self.log,stderr=self.log,start_new_session=True)
                self.status['enginePid']=self.child.pid
                atomic_file(self.directory/'engine.json',json.dumps({'pid':self.child.pid,'game':self.game}).encode())
                deadline=time.monotonic()+120
                try:
                    while not self.stop.is_set() and time.monotonic()<deadline:
                        if self.child.poll() is not None:raise ValueError('The Switch game exited during startup. See its session log.')
                        try:self.connection,_=server.accept();break
                        except socket.timeout:continue
                    if not self.connection:raise ValueError('The Switch native stream did not connect.')
                finally:server.close()
                self.pump(self.connection.makefile('rb'))
            else:
                # Detach before exec: Azahar warns whenever its parent PID is not launchd.
                # The tiny launcher exits only after recording the exact child PID.
                pidfile=self.temp/'game.pid'
                launch_code='import os,sys,json; p=os.fork(); open(sys.argv[1],"w").write(str(p)) if p else None; sys.exit(0) if p else None; import time; time.sleep(.1); os.execv(sys.argv[2],sys.argv[2:])'
                with self.launch_lock:
                    if self.closing:return
                    subprocess.run([sys.executable,'-c',launch_code,str(pidfile),*plan['command']],env=env,stdin=subprocess.DEVNULL,stdout=self.log,stderr=self.log,check=True,start_new_session=True)
                    self.native_pid=int(pidfile.read_text())
                self.status['enginePid']=self.native_pid
                atomic_file(self.directory/'engine.json',json.dumps({'pid':self.native_pid,'game':self.game}).encode())
                self.start_capture()
        except Exception as error:self.error(error)

    def start_capture(self):
        with self.launch_lock:
            if self.closing:return
            if self.capture and self.capture.poll() is None:self.capture.terminate();self.capture.wait(timeout=3)
            self.status.update(state='loading',message='Connecting to the 3DS game window.')
            v=self.plan['video'];cfg=self.cfg
            command=[cfg['capture'],'--pid',str(self.native_pid),'--width',str(v['width']),'--height',str(v['height']),
                '--window-width',str(v['windowWidth']),'--window-height',str(v['windowHeight']),'--titlebar',str(v['titlebar']),
                '--status',str(self.temp/'capture.json')]
            source=subprocess.Popen(command,stdin=subprocess.PIPE,stdout=subprocess.PIPE,stderr=self.log);self.capture=source
        threading.Thread(target=self.pump,args=(source.stdout,source),daemon=True).start()

    def lifecycle(self,value):
        if set(value)!={'sessionId','action'} or value['sessionId']!=self.status['sessionId']:raise ValueError('The game session changed. Refresh before controlling it.')
        if value['action'] in {'retry-video','permissions'}:
            if self.platform!='3ds':raise ValueError('This game does not use window capture.')
            with self.lifecycle_lock:
                if not hasattr(self,'native_pid'):raise ValueError('The game is still opening.')
                if value['action']=='retry-video' or not self.capture or self.capture.poll() is not None:self.start_capture()
                if value['action']=='permissions':self.send({'requestPermissions':True})
            return dict(self.status)
        if value['action']!='close':raise ValueError('Unknown game action.')
        with self.lifecycle_lock:
            if self.status['state']=='closed':return dict(self.status)
            with self.launch_lock:self.closing=True
            self.status.update(state='closing',message='Closing the game and waiting for its save files to finish writing.')
            try:
                if self.platform=='switch' and self.child and self.child.poll() is None:
                    # New adapters exit their normal event loop. Older versions use
                    # the platform's normal quit request, never a forced kill.
                    self.send({'buttons':0,'quit':True})
                    self.child.wait(timeout=25)
                    if self.child.returncode!=0:raise ValueError('The emulator exited unexpectedly. Its existing saves are preserved.')
                elif hasattr(self,'native_pid') and self.engine_alive():
                    subprocess.run([self.cfg['capture'],'--pid',str(self.native_pid),'--quit'],check=True,stdout=self.log,stderr=self.log,timeout=5)
                    deadline=time.monotonic()+25
                    while self.engine_alive() and time.monotonic()<deadline:time.sleep(.1)
                    if self.engine_alive():raise ValueError('The game did not finish closing. Its session is still open; finish any native dialog and try again.')
                if hasattr(self,'backup'):
                    try:self.status['save']=self.backup.commit()
                    except ValueError as error:
                        if 'No in-game save' not in str(error):self.status['backupWarning']=str(error)
                self.status.update(state='closed',message='Game closed.',sourceFps=0,textRequest=None,updatedAt=utc())
                atomic_file(self.directory/'closed.json',json.dumps(self.status).encode())
                (self.directory/'engine.json').unlink(missing_ok=True)
                # Leave time for the HTTP acknowledgement to reach the host.
                threading.Timer(.5,self.stop.set).start()
                return dict(self.status)
            except (OSError,ValueError,subprocess.SubprocessError) as error:
                self.closing=False
                detail='The emulator did not finish closing within 25 seconds.' if isinstance(error,subprocess.TimeoutExpired) else str(error)
                self.status.update(state='error',message='The game could not close gracefully. Its session was not force-stopped. '+detail)
                raise ValueError(self.status['message']) from error

    def engine_alive(self):
        if self.child:return self.child.poll() is None
        if not hasattr(self,'native_pid'):return False
        try:assert_process_alive(self.native_pid);return True
        except ProcessLookupError:return False

    def poll_native_exit(self):
        if self.closing or not self.status.get('enginePid') or self.engine_alive():return False
        # The player can quit the native app directly. Retire its owner too,
        # so the next Start game cannot reconnect to an already-dead emulator.
        self.lifecycle({'sessionId':self.status['sessionId'],'action':'close'})
        return True

    def send(self,value):
        data=(json.dumps(value)+'\n').encode()
        with self.write_lock:
            if self.connection:self.connection.sendall(data)
            elif self.capture and self.capture.poll() is None:self.capture.stdin.write(data);self.capture.stdin.flush()

    def controls(self,value):
        if set(value)=={'requestId','text'}:
            request=self.status.get('textRequest')
            if not request or value['requestId']!=request['id']:raise ValueError('This game text prompt has already closed.')
            text=value['text']
            if text is not None and (not isinstance(text,str) or not request['min']<=len(text)<=request['max'] or '\0' in text):raise ValueError('Text does not match the game’s required length.')
            self.send(value);return {'mode':'manual','textSubmitted':True}
        with self.input_lock:state=self.input.update(value)
        self.send(switch_input(state) if self.platform=='switch' else state)
        return {'mode':'manual','manualButtons':state['buttons']}

    def run(self):
        owner=self
        class Handler(BaseHTTPRequestHandler):
            protocol_version='HTTP/1.1'
            def log_message(self,*_):pass
            def json(self,value,code=200):
                data=json.dumps(value).encode();self.send_response(code);self.send_header('Content-Type','application/json');self.send_header('Content-Length',str(len(data)));self.send_header('Cache-Control','no-store');self.end_headers();self.wfile.write(data)
            def do_GET(self):
                if self.path=='/status':self.json(owner.status);return
                if self.path=='/health':self.json({'ok':True,'game':owner.game,'audio':{'path':'/audio','format':'s16le','channels':2,'tempo':1,'sampleRate':48000}});return
                if self.path not in {'/frame','/stream','/audio'}:self.json({'error':'Not found'},404);return
                self.send_response(200);self.send_header('Content-Type','application/octet-stream');self.send_header('Connection','close');self.end_headers();self.close_connection=True;self.connection.settimeout(2)
                try:
                    if self.path=='/frame':self.wfile.write(owner.pixels);return
                    if self.path=='/stream':
                        last=-1
                        while not owner.stop.is_set():
                            with owner.condition:
                                owner.condition.wait_for(lambda:owner.sequence!=last or owner.stop.is_set(),timeout=1)
                                frame=owner.pixels;last=owner.sequence
                            if frame:self.wfile.write(struct.pack('>4sHHII',b'MRF1',owner.width,owner.height,len(frame),last&0xffffffff)+frame);self.wfile.flush()
                    else:
                        client=queue.Queue(maxsize=30)
                        with owner.condition:owner.clients.add(client)
                        try:
                            while not owner.stop.is_set():
                                try:chunk=client.get(timeout=1)
                                except queue.Empty:continue
                                self.wfile.write(chunk);self.wfile.flush()
                        finally:
                            with owner.condition:owner.clients.discard(client)
                except (OSError,TimeoutError):pass
            def do_POST(self):
                try:
                    if self.headers.get('Origin'):raise ValueError('Use the authenticated Suite controller.')
                    size=int(self.headers.get('Content-Length','0'))
                    if not 0<size<=8192:raise ValueError('Invalid controller payload size.')
                    value=json.loads(self.rfile.read(size))
                    if self.path=='/control/lifecycle':self.json(owner.lifecycle(value))
                    elif self.path=='/control/input':self.json(owner.controls(value))
                    else:raise ValueError('Unsupported native game control.')
                except (ValueError,TypeError,KeyError,OSError) as error:self.json({'error':str(error)},400)
        lock=(self.directory/'owner.lock').open('a+')
        try:fcntl.flock(lock,fcntl.LOCK_EX|fcntl.LOCK_NB)
        except BlockingIOError:raise ValueError('This game already has a native owner.')
        lock.seek(0);lock.truncate();json.dump({'pid':os.getpid(),'game':self.game},lock);lock.flush()
        server=ThreadingHTTPServer(('127.0.0.1',self.cfg['port']),Handler);server.daemon_threads=True
        threading.Thread(target=server.serve_forever,daemon=True).start()
        mailbox=CommandMailbox(self.directory/'command.json')
        threading.Thread(target=self.launch,daemon=True).start()
        signal.signal(signal.SIGTERM,lambda *_:self.stop.set());signal.signal(signal.SIGINT,lambda *_:self.stop.set())
        started=time.monotonic();last_stat=started;last_sequence=0
        try:
            while not self.stop.wait(.1):
                if self.closing:continue
                if self.poll_native_exit():continue
                with self.input_lock:state=self.input.snapshot()
                try:self.send(switch_input(state) if self.platform=='switch' else state)
                except (OSError,ValueError) as error:self.error(error)
                now=time.monotonic()
                if now-last_stat>=1:
                    self.status.update(updatedAt=utc(),frame=self.sequence,sourceFps=round((self.sequence-last_sequence)/(now-last_stat),2),control={'mode':'manual','manualButtons':state['buttons']})
                    last_sequence=self.sequence;last_stat=now
                    self.update_video_status(now,started)
                command=mailbox.poll()
                if command:
                    self.status['commandError']=None
                    try:
                        if command['type']=='save':
                            if not hasattr(self,'backup'):raise ValueError('Wait for the game to finish loading.')
                            pid=self.child.pid if self.child else self.native_pid
                            os.kill(pid,signal.SIGSTOP)
                            try:self.status['save']=self.backup.commit()
                            finally:os.kill(pid,signal.SIGCONT)
                        elif command['type']=='shutdown':self.stop.set()
                        else:raise ValueError('This game supports manual play. Bot automation is not qualified.')
                    except (ValueError,OSError) as error:self.status['commandError']=str(error)
                    self.status['lastCommand']=command['commandId']
        finally:
            self.stop.set()
            if self.capture:
                try:self.send({'keys':[],'quit':True})
                except OSError:pass
                self.stop.wait(.3)
                self.capture.terminate()
            if hasattr(self,'native_pid'):
                try:
                    os.kill(self.native_pid,signal.SIGTERM)
                    deadline=time.monotonic()+3
                    while time.monotonic()<deadline:
                        assert_process_alive(self.native_pid);time.sleep(.1)
                    os.kill(self.native_pid,signal.SIGKILL)
                except ProcessLookupError:pass
            if self.child:
                self.child.terminate()
                try:self.child.wait(timeout=10)
                except subprocess.TimeoutExpired:self.child.kill();self.child.wait()
            server.shutdown();server.server_close();lock.close()
            self.log.close()
            import shutil
            shutil.rmtree(self.temp,ignore_errors=True)


def run(config_path,game):
    config=json.loads(Path(config_path).read_text())
    if config['games'][game].get('backend')!='desktop':raise ValueError('Not a desktop Suite game.')
    DesktopOwner(config,game).run()


if __name__=='__main__':run(*sys.argv[1:])
