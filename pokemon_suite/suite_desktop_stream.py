"""Bounded native video/audio framing for the Suite's local desktop engines."""
import array
import struct
from PIL import Image


def exact(stream,size):
    chunks=bytearray()
    while len(chunks)<size:
        value=stream.read(size-len(chunks))
        if not value:raise EOFError('The native game stream closed.')
        chunks.extend(value)
    return bytes(chunks)


def packet(stream):
    kind,size=struct.unpack('>4sI',exact(stream,8))
    limits={b'VID1':3840*2160*4,b'VID2':3840*2160*4+12,b'AUD1':1024*1024,b'AUD2':1024*1024+12,b'REQ1':8192,b'STA1':8192}
    if kind not in limits or not 0<size<=limits[kind]:raise ValueError('Invalid native stream packet.')
    return kind,exact(stream,size)


def video(data,dimensions):
    if len(data)<12:raise ValueError('Incomplete native frame.')
    width,height,flags=struct.unpack('>iii',data[:12])
    if not 0<width<=3840 or not 0<height<=2160 or not 0<=flags<=7 or len(data)!=12+width*height*4:raise ValueError('Invalid native frame dimensions.')
    frame=Image.frombytes('RGBA',(width,height),data[12:],'raw','BGRA' if flags&1 else 'RGBA')
    if flags&2:frame=frame.transpose(Image.Transpose.FLIP_LEFT_RIGHT)
    if flags&4:frame=frame.transpose(Image.Transpose.FLIP_TOP_BOTTOM)
    if frame.size!=dimensions:frame=frame.resize(dimensions,Image.Resampling.BILINEAR)
    return frame.tobytes()


def audio(data):
    if len(data)<12:raise ValueError('Incomplete native audio.')
    fmt,rate,channels=struct.unpack('>iii',data[:12]);data=data[12:]
    if rate!=48000 or channels not in (1,2,6) or fmt not in (2,5):raise ValueError('Unsupported native audio format.')
    sample_bytes=2 if fmt==2 else 4
    if len(data)%(channels*sample_bytes):raise ValueError('Incomplete native audio sample.')
    if fmt==2 and channels==2:return data
    source=array.array('h' if fmt==2 else 'f',data)
    if channels==6:
        import math
        def clip(value):return int(max(-32768,min(32767,value if math.isfinite(value) else 0)))
        gain=32768 if fmt==5 else 1
        mixed=array.array('h')
        for at in range(0,len(source),6):
            left,right,center,lfe,sleft,sright=source[at:at+6]
            mixed.extend([clip(gain*(left+.7071*center+.7071*sleft)),clip(gain*(right+.7071*center+.7071*sright))])
        return mixed.tobytes()
    output=array.array('h')
    for value in source:
        if fmt==5:
            import math
            value=int(max(-32768,min(32767,(value if math.isfinite(value) else 0)*32768)))
        output.append(value)
        if channels==1:output.append(value)
    return output.tobytes()


def switch_input(value):
    buttons=set(value['buttons'])
    order=['a','b','x','y','l3','r3','l','r','zl','zr','start','select','left','up','right','down']
    result={'buttons':sum(1<<i for i,b in enumerate(order) if b in buttons),
        'lx':32767*(('ls-right' in buttons)-('ls-left' in buttons)),
        'ly':32767*(('ls-up' in buttons)-('ls-down' in buttons)),
        'rx':32767*(('rs-right' in buttons)-('rs-left' in buttons)),
        'ry':32767*(('rs-up' in buttons)-('rs-down' in buttons))}
    for key,value,sign in zip(['lx','ly','rx','ry'],value.get('axes',[0,0,0,0]),[1,-1,1,-1]):
        if abs(value)>.12:result[key]=round(32767*value*sign)
    return result
