"""Native software-rendering adapter; all emulator calls stay on the owner thread."""
import ctypes as C
from pathlib import Path
import time

BUTTONS={'b':0,'y':1,'select':2,'start':3,'up':4,'down':5,'left':6,'right':7,'a':8,'x':9,'l':10,'r':11}

class InputState:
    def __init__(self,platform):self.platform=platform;self.buttons=[];self.touch={'x':0,'y':0,'pressed':False};self.expires=0
    def update(self,value,now=None):
        now=time.monotonic() if now is None else now
        allowed=set(BUTTONS) if self.platform=='nds' else set(BUTTONS)-{'x','y'}
        buttons=value.get('buttons',self.buttons);touch=value.get('touch',self.touch)
        if not isinstance(buttons,list) or any(b not in allowed for b in buttons):raise ValueError('Invalid buttons for this game hardware.')
        if 'touch' in value:
            if self.platform!='nds' or not isinstance(touch,dict) or set(touch)!={'x','y','pressed'}:raise ValueError('This game has no supported touchscreen.')
            if type(touch['pressed']) is not bool or any(type(touch[k]) is not int or not 0<=touch[k]<=limit for k,limit in [('x',255),('y',191)]):raise ValueError('Touch coordinates must be inside the lower DS screen.')
        self.buttons=sorted(set(buttons));self.touch=dict(touch);self.expires=now+1
        return self.snapshot(now)
    def snapshot(self,now=None):
        now=time.monotonic() if now is None else now
        if now>=self.expires:self.buttons=[];self.touch['pressed']=False
        return {'buttons':list(self.buttons),'touch':dict(self.touch)}

class LibretroCore:
    def __init__(self,bridge,core,rom,directory):
        self.library=C.CDLL(str(bridge));self.closed=False
        for name in ['width','height']:getattr(self.library,'suite_'+name).restype=C.c_uint
        for name in ['fps','sample_rate']:getattr(self.library,'suite_'+name).restype=C.c_double
        for name in ['pixels','audio','sram']:getattr(self.library,'suite_'+name).restype=C.c_void_p
        for name in ['audio_bytes','sram_size','state_size']:getattr(self.library,'suite_'+name).restype=C.c_size_t
        self.library.suite_error.restype=C.c_char_p
        self.library.suite_open.argtypes=[C.c_char_p]*4
        self.library.suite_run.argtypes=[C.c_uint,C.c_int16,C.c_int16,C.c_int]
        for name in ['serialize','unserialize']:getattr(self.library,'suite_'+name).argtypes=[C.c_void_p,C.c_size_t]
        directory=Path(directory);directory.mkdir(parents=True,exist_ok=True,mode=0o700)
        system=directory/'system';system.mkdir(exist_ok=True,mode=0o700)
        if not self.library.suite_open(*[str(p).encode() for p in [core,rom,directory,system]]):
            message=self.library.suite_error().decode();self.close();raise ValueError(message)
        # The bridge already owns this loaded core. dlopen resolves the same
        # library instance; retro_reset is the standard libretro reset entry.
        self._core_api=C.CDLL(str(core));self._core_api.retro_reset.argtypes=[];self._core_api.retro_reset.restype=None
    @property
    def width(self):return self.library.suite_width()
    @property
    def height(self):return self.library.suite_height()
    @property
    def fps(self):return self.library.suite_fps()
    @property
    def sample_rate(self):return int(self.library.suite_sample_rate())
    def run(self,inputs):
        mask=sum(1<<BUTTONS[b] for b in inputs.get('buttons',[]));touch=inputs.get('touch',{})
        # libretro pointer coordinates cover the whole stacked framebuffer.
        x=round(touch.get('x',0)/255*65534-32767)
        y=round((touch.get('y',0)+192)/383*65534-32767)
        self.library.suite_run(mask,x,y,int(touch.get('pressed',False)))
    def frame(self):return C.string_at(self.library.suite_pixels(),self.width*self.height*4)
    def audio(self):return C.string_at(self.library.suite_audio(),self.library.suite_audio_bytes())
    def sram(self):
        size=self.library.suite_sram_size();ptr=self.library.suite_sram()
        return C.string_at(ptr,size) if ptr and size else b''
    def serialize(self):
        size=self.library.suite_state_size()
        if not 0<size<=64*1024*1024:raise ValueError('Core does not support bounded save checkpoints.')
        out=C.create_string_buffer(size)
        if not self.library.suite_serialize(out,size):raise ValueError('Core checkpoint serialization failed.')
        return out.raw
    def restore(self,state,sram):
        if not self.library.suite_unserialize(state,len(state)):raise ValueError('Core rejected the saved checkpoint. No new save was started.')
        size=self.library.suite_sram_size();ptr=self.library.suite_sram()
        if sram:
            if len(sram)!=size or not ptr:raise ValueError('Native cartridge save size does not match the core.')
            C.memmove(ptr,sram,size)
    def reset(self):
        self._core_api.retro_reset()
    def close(self):
        if not self.closed:self.library.suite_close();self.closed=True
