"""Per-game desktop emulator profiles, controllers and native-save backups."""
import configparser
from datetime import datetime, timezone
import hashlib
import json
import math
import os
from .processes import assert_process_alive
from pathlib import Path
import shutil
import tempfile
import time

from .pokemon_main_series import MAIN_GAMES
from .suite_save_store import atomic_file

KEYS = {
    '3ds': {'a':0,'b':1,'x':6,'y':7,'up':17,'left':3,'down':5,'right':4,
            'l':12,'r':13,'zl':18,'zr':19,'start':46,'select':45,
            'ls-up':126,'ls-down':125,'ls-left':123,'ls-right':124,
            'rs-up':34,'rs-down':40,'rs-left':38,'rs-right':37},
    'switch': {'a':6,'b':7,'x':8,'y':9,'up':126,'left':123,'down':125,'right':124,
               'l':14,'r':32,'zl':12,'zr':31,'start':24,'select':27,'l3':3,'r3':4,
               'ls-up':13,'ls-down':1,'ls-left':0,'ls-right':2,
               'rs-up':34,'rs-down':40,'rs-left':38,'rs-right':37},
}


def check_engine_owner(path):
    path=Path(path)
    if not path.exists():return
    record=json.loads(path.read_text());pid=record.get('pid')
    if type(pid) is not int or pid<=1:raise ValueError('Invalid native engine owner record.')
    try:assert_process_alive(pid)
    except ProcessLookupError:path.unlink();return
    raise ValueError('An existing emulator still owns this native save. Close that game before starting another owner.')


class DesktopInput:
    def __init__(self, platform):
        if platform not in KEYS:raise ValueError('Unsupported desktop game hardware.')
        self.platform=platform
        self.buttons=[]
        self.axes=[0,0,0,0]
        self.tap_until={}
        self.touch={'x':0,'y':0,'pressed':False}
        self.expires=0

    def update(self, value, now=None):
        now=time.monotonic() if now is None else now
        if not isinstance(value,dict) or set(value)-{'buttons','touch','axes'}:
            raise ValueError('Invalid controller input.')
        buttons=value.get('buttons',[])
        if not isinstance(buttons,list) or any(not isinstance(b,str) or b not in KEYS[self.platform] for b in buttons):
            raise ValueError('Invalid buttons for this game hardware.')
        touch=value.get('touch',{'x':0,'y':0,'pressed':False})
        if 'touch' in value:
            if self.platform!='3ds' or not isinstance(touch,dict) or set(touch)!={'x','y','pressed'}:
                raise ValueError('This game has no supported touchscreen.')
            if type(touch['pressed']) is not bool or any(type(touch[k]) is not int or not 0<=touch[k]<=limit for k,limit in [('x',319),('y',239)]):
                raise ValueError('Touch must be inside the lower 3DS screen.')
        axes=value.get('axes',[0,0,0,0])
        if not isinstance(axes,list) or len(axes)!=4 or any(type(v) not in (int,float) or not math.isfinite(v) or abs(v)>1 for v in axes):
            raise ValueError('Use four controller axes between -1 and 1.')
        for button in set(buttons)-set(self.buttons):self.tap_until[button]=now+.05
        self.buttons=sorted(set(buttons));self.touch=dict(touch);self.axes=list(axes);self.expires=now+1
        return self.snapshot(now)

    def snapshot(self, now=None):
        now=time.monotonic() if now is None else now
        if now>=self.expires:self.buttons=[];self.touch['pressed']=False;self.axes=[0,0,0,0];self.tap_until={}
        self.tap_until={b:until for b,until in self.tap_until.items() if until>now}
        visible=sorted(set(self.buttons)|set(self.tap_until))
        return {'buttons':visible,'keys':sorted(KEYS[self.platform][b] for b in visible),'touch':dict(self.touch),'axes':list(self.axes)}


def prepare_launch(game, cfg, directory):
    platform=MAIN_GAMES[game]['platform'];directory=Path(directory)
    if (platform,cfg['engine']) not in {('3ds','azahar'),('switch','ryubing')}:
        raise ValueError('The emulator does not match this game hardware.')
    identity={'game':game,'romSha256':cfg['cartridge']['sha256'],'engine':cfg['engine']}
    directory.mkdir(parents=True,exist_ok=True,mode=0o700)
    marker=directory/'profile.json'
    if marker.exists() and json.loads(marker.read_text())!=identity:
        raise ValueError('Desktop save profile identity does not match this game.')
    if not marker.exists():atomic_file(marker,json.dumps(identity).encode())
    env={}
    if platform=='3ds':
        for key,folder in [('XDG_DATA_HOME','data'),('XDG_CONFIG_HOME','config'),('XDG_CACHE_HOME','cache')]:
            env[key]=str(directory/folder)
            (directory/folder/'azahar-emu').mkdir(parents=True,exist_ok=True,mode=0o700)
        path=directory/'config/azahar-emu/qt-config.ini'
        settings=configparser.ConfigParser(interpolation=None,strict=False)
        settings.optionxform=str
        if path.exists():settings.read(path)
        options={
            'Renderer':{'frame_limit':'100','use_vsync':'true','resolution_factor':'1'},
            'Core':{'cpu_clock_percentage':'100'},
            'Miscellaneous':{'check_for_update_on_start':'false'},
            'Layout':{'layout_option':'0','swap_screen':'false','custom_layout':'false'},
            'UI':{'confirmClose':'false','showStatusBar':'false','singleWindowMode':'true',
                  'fullscreen':'false','pauseWhenInBackground':'false','muteWhenInBackground':'false',
                  'enable_discord_presence':'false','firstStart':'false'},
            'Audio':{'volume':'1','output_type':'0','enable_audio_stretching':'true'},
        }
        for section,values in options.items():
            if not settings.has_section(section):settings.add_section(section)
            for key,value in values.items():
                settings.set(section,key,value);settings.set(section,key+'\\default','false')
        import io
        buffer=io.StringIO();settings.write(buffer,space_around_delimiters=False)
        atomic_file(path,buffer.getvalue().encode())
        command=[cfg['executable'],'-w',cfg['cartridge']['path']]
        video={'width':400,'height':480,'windowWidth':800,'windowHeight':988,'titlebar':28}
    else:
        # Apple hypervisor froze Violet; keep the JIT backend at native timing.
        command=[cfg['executable'],'--no-gui','--root-data-dir',str(directory),
                 '--disable-docked-mode','--resolution-scale','1','--vsync-mode','Switch',
                 '--use-hypervisor','false',
                 '--disable-stub-logs','--input-id-1','0','--input-profile-1','default',cfg['cartridge']['path']]
        video={'width':1280,'height':720,'windowWidth':1280,'windowHeight':748,'titlebar':28}
    return {'command':command,'env':env,'video':video,'identity':identity}


class NativeSaveBackup:
    """Back up native save files after the owner has quiesced game writes.

    No firmware, encryption keys, caches or emulator checkpoints are included.
    A filesystem snapshot does not certify game progress or native save validity.
    """
    def __init__(self,directory,profile,platform,identity):
        self.directory=Path(directory);self.profile=Path(profile)
        self.platform=platform;self.identity=identity

    def files(self):
        roots=['data/azahar-emu/sdmc'] if self.platform=='3ds' else ['bis/user/save']
        result=[]
        for root in roots:
            folder=self.profile/root
            if not folder.exists():continue
            for path in sorted(folder.rglob('*')):
                if path.is_symlink():raise ValueError('Native save folders cannot contain symbolic links.')
                if path.is_file():result.append(path)
        return result

    def commit(self):
        current=self.directory/'current.json';previous=None
        if current.exists():
            previous=json.loads(current.read_text())
            if previous['identity']!=self.identity:raise ValueError('Native backup identity does not match the selected game.')
        files=self.files()
        if not any(p.name not in {'.lock','ExtraData0','ExtraData1'} and p.stat().st_size for p in files):
            raise ValueError('No in-game save data exists yet. Save inside the game first.')
        limit=1024*1024*1024
        if sum(p.stat().st_size for p in files)>limit:raise ValueError('Native save backup exceeds its size limit.')
        self.directory.mkdir(parents=True,exist_ok=True,mode=0o700)
        staging=Path(tempfile.mkdtemp(prefix='.backup-',dir=self.directory))
        try:
            records=[];total=0
            for path in files:
                before=path.stat();relative=path.relative_to(self.profile)
                target=staging/relative;target.parent.mkdir(parents=True,exist_ok=True)
                digest=hashlib.sha256()
                with path.open('rb') as source,target.open('wb') as out:
                    while chunk:=source.read(1024*1024):
                        total+=len(chunk)
                        if total>limit:raise ValueError('Native save backup exceeds its size limit.')
                        digest.update(chunk);out.write(chunk)
                after=path.stat()
                if (before.st_size,before.st_mtime_ns)!=(after.st_size,after.st_mtime_ns):
                    raise ValueError('The game is still writing its save. Wait for saving to finish.')
                records.append({'path':str(relative),'bytes':after.st_size,'sha256':digest.hexdigest()})
            digest=hashlib.sha256(json.dumps(records,sort_keys=True).encode()).hexdigest()
            target=self.directory/('snapshot-'+digest)
            if target.exists():shutil.rmtree(staging)
            else:staging.rename(target)
            record={'schema':'pokemon-suite/native-backup/v1','identity':self.identity,
                    'updatedAt':datetime.now(timezone.utc).isoformat(),'digest':digest,
                    'fileCount':len(records),'bytes':total,'files':records,'nativeSaveVerified':False}
            if previous:atomic_file(self.directory/'previous.json',json.dumps(previous).encode())
            atomic_file(current,json.dumps(record).encode())
            keep={digest,previous['digest'] if previous else digest}
            for folder in self.directory.glob('snapshot-*'):
                if folder.name[9:] not in keep:shutil.rmtree(folder)
            return record
        finally:
            if staging.exists():shutil.rmtree(staging)
