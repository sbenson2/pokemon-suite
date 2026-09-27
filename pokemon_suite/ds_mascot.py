"""Original bounded Nitro reader for game-specific cartridge label mascots.

Reads static battle artwork from the user's DS ROM. The sprite obfuscation is
part of the image format, not console encryption. No assets are distributed.
"""
import struct
from .rom_art import png

# Retail mascots, with distinct fused Kyurem forms for the sequels.
MASCOTS = {'diamond':483, 'pearl':484, 'platinum':487, 'heartgold':250,
           'soulsilver':249, 'black':643, 'white':644, 'black2':744, 'white2':743}


def decompress(data):
    if len(data)<4 or data[0] not in {0x10,0x11}:raise ValueError('Invalid compressed artwork.')
    size=int.from_bytes(data[1:4],'little')
    if not 0<size<=256*1024:raise ValueError('Compressed artwork is too large.')
    output=bytearray();cursor=4
    def take():
        nonlocal cursor
        if cursor>=len(data):raise ValueError('Truncated compressed artwork.')
        value=data[cursor];cursor+=1;return value
    while len(output)<size:
        flags=take()
        for bit in range(7,-1,-1):
            if len(output)==size:break
            if not flags&(1<<bit):output.append(take());continue
            a,b=take(),take()
            if data[0]==0x10:count=(a>>4)+3;distance=((a&15)<<8|b)+1
            elif a>>4==0:
                c=take();count=((a&15)<<4|b>>4)+17;distance=((b&15)<<8|c)+1
            elif a>>4==1:
                c,d=take(),take();count=((a&15)<<12|b<<4|c>>4)+273;distance=((c&15)<<8|d)+1
            else:count=(a>>4)+1;distance=((a&15)<<8|b)+1
            if distance>len(output) or len(output)+count>size:raise ValueError('Invalid compressed artwork reference.')
            for _ in range(count):output.append(output[-distance])
    return bytes(output)


def blocks(data, magic):
    if len(data) < 16 or data[:4] != magic: raise ValueError('Invalid Nitro artwork header.')
    size, start, count = struct.unpack_from('<IHH', data, 8)
    if size != len(data) or start < 16 or start > size or not 0 < count <= 16:
        raise ValueError('Invalid Nitro artwork bounds.')
    result = {}
    for _ in range(count):
        if start+8 > size: raise ValueError('Incomplete Nitro block.')
        length = struct.unpack_from('<I',data,start+4)[0]
        if length < 8 or start+length > size: raise ValueError('Invalid Nitro block size.')
        result[bytes(data[start:start+4])] = data[start+8:start+length]
        start += length
    return result


def narc_member(data, index):
    pieces=blocks(data,b'NARC')
    table=pieces.get(b'BTAF',b''); content=pieces.get(b'GMIF',b'')
    if len(table)<4 or not 0<=index<struct.unpack_from('<H',table)[0] or 4+(index+1)*8>len(table):
        raise ValueError('Missing archive artwork member.')
    begin,end=struct.unpack_from('<II',table,4+index*8)
    if not 0<=begin<=end<=len(content):raise ValueError('Artwork member exceeds archive bounds.')
    return content[begin:end]


def decode_sprite(graphics, palette, generation, reverse=False):
    if graphics[:1] in (b'\x10',b'\x11'):graphics=decompress(graphics)
    # Retail Gen V static 96x96 sprites retain the 128x128 template's
    # container sizes. Accept only that exact, otherwise validated layout.
    if generation==5 and len(graphics)==0x1230 and graphics[:4]==b'RGCN' and graphics[16:20]==b'RAHC' and struct.unpack_from('<I',graphics,8)[0]==0x2030 and struct.unpack_from('<I',graphics,20)[0]==0x2020:
        graphics=bytearray(graphics)
        struct.pack_into('<I',graphics,8,len(graphics));struct.pack_into('<I',graphics,20,len(graphics)-16)
    chars=blocks(graphics,b'RGCN').get(b'RAHC',b'')
    colors=blocks(palette,b'RLCN').get(b'TTLP',b'')
    if len(chars)<24 or len(colors)<16:raise ValueError('Missing sprite or palette block.')
    h,w,depth,_,mode,size,offset=struct.unpack_from('<HHIIIII',chars)
    palette_size,palette_offset=struct.unpack_from('<II',colors,8)
    if depth!=3 or not 1<=w<=32 or not 1<=h<=32 or size!=w*h*32 or offset<24 or offset+size>len(chars):
        raise ValueError('Unsupported sprite dimensions or format.')
    if palette_size<32 or palette_offset<16 or palette_offset+palette_size>len(colors):
        raise ValueError('Invalid sprite palette.')
    raw=chars[offset:offset+size]
    if generation==4:
        words=list(struct.unpack('<'+'H'*(size//2),raw))
        indices=range(len(words)-1,-1,-1) if reverse else range(len(words))
        state=words[-1 if reverse else 0]
        for index in indices:
            words[index]^=state
            state=(state*1103515245+24691)&65535
        raw=struct.pack('<'+'H'*len(words),*words)
    width,height=w*8,h*8
    output_width=80 if generation==4 else width
    if generation==4 and (width,height)!=(160,80):raise ValueError('Unsupported two-frame sprite.')
    rgb=[]
    for n,value in enumerate(struct.unpack_from('<16H',colors,palette_offset)):
        rgb.append(bytes([*((value>>shift&31)*255//31 for shift in (0,5,10)),255]) if n else bytes(4))
    pixels=bytearray()
    for y in range(height):
        for x in range(output_width):
            index=y*width+x if mode&255 else ((y//8)*(width//8)+x//8)*64+(y%8)*8+x%8
            if generation==5 and (width,height)==(96,96) and not mode&255:
                # The static cell consists of 64x64, 32x64, 64x32,
                # and 32x32 OBJ regions, each with its own tile row stride.
                left,top=x<64,y<64
                base=0 if left and top else 4096 if top else 6144 if left else 8192
                stride=8 if left else 4
                xx=x if left else x-64; yy=y if top else y-64
                index=base+((yy//8)*stride+xx//8)*64+(yy%8)*8+xx%8
            value=(raw[index//2]>>(index%2*4))&15
            pixels.extend(rgb[value])
    return png(output_width,height,pixels)


def game_file(source, path):
    """Resolve one NitroFS path; no files are extracted to disk."""
    header=source.read(0,512)
    fnt_offset,fnt_size,fat_offset,fat_size=struct.unpack_from('<IIII',header,0x40)
    if not 8<=fnt_size<=1024*1024 or not 8<=fat_size<=512*1024 or fat_size%8:
        raise ValueError('Invalid cartridge filesystem.')
    fnt=source.read(fnt_offset,fnt_size)
    directory=0; seen=set()
    for component in path.split('/'):
        if directory in seen or directory*8+8>len(fnt):raise ValueError('Invalid cartridge directory.')
        seen.add(directory)
        cursor,index,_=struct.unpack_from('<IHH',fnt,directory*8)
        found=None
        for _ in range(65536):
            if cursor>=len(fnt):raise ValueError('Unterminated cartridge directory.')
            length=fnt[cursor];cursor+=1
            if not length:break
            end=cursor+(length&127)
            if end>len(fnt):raise ValueError('Invalid cartridge filename.')
            name=fnt[cursor:end].decode('ascii',errors='replace');cursor=end
            if length&128:
                if cursor+2>len(fnt):raise ValueError('Invalid subdirectory.')
                target=struct.unpack_from('<H',fnt,cursor)[0]-0xf000;cursor+=2
                if name==component:found=('dir',target)
            else:
                if name==component:found=('file',index)
                index+=1
        if found is None:raise ValueError('This cartridge has no supported mascot archive.')
        if found[0]=='file':
            if component!=path.split('/')[-1] or not 0<=found[1]<fat_size//8:raise ValueError('Invalid cartridge file entry.')
            begin,end=struct.unpack('<II',source.read(fat_offset+found[1]*8,8))
            if not 512<=begin<end<=source.size:raise ValueError('Invalid cartridge file bounds.')
            return begin,end-begin
        directory=found[1]
    raise ValueError('Cartridge artwork path names a directory.')


def load_mascot(source, game):
    generation=5 if game in {'black','white','black2','white2'} else 4
    path='poketool/pokegra/'+('pl_pokegra.narc' if game=='platinum' else 'pokegra.narc') if game in {'diamond','pearl','platinum'} else 'a/0/0/4'
    base,length=game_file(source,path)
    def read(offset,count):
        if offset<0 or count<0 or count>256*1024 or offset+count>length:raise ValueError('Mascot archive read exceeds bounds.')
        return source.read(base+offset,count,limit=512*1024*1024)
    header=read(0,16)
    if header[:4]!=b'NARC' or struct.unpack_from('<I',header,8)[0]!=length:raise ValueError('Invalid mascot archive.')
    cursor=struct.unpack_from('<H',header,12)[0]; total=struct.unpack_from('<H',header,14)[0]
    table=None; content=None
    if not 16<=cursor<=length or not 1<=total<=8:raise ValueError('Invalid mascot archive blocks.')
    for _ in range(total):
        tag,block_size=struct.unpack('<4sI',read(cursor,8))
        if block_size<8 or cursor+block_size>length:raise ValueError('Invalid mascot archive block.')
        if tag==b'BTAF':table=read(cursor+8,block_size-8)
        if tag==b'GMIF':content=(cursor+8,block_size-8)
        cursor+=block_size
    if table is None or len(table)<4 or content is None:raise ValueError('Incomplete mascot archive.')
    count=struct.unpack_from('<H',table)[0]
    def member(index):
        if not 0<=index<count or 4+(index+1)*8>len(table):raise ValueError('Missing mascot member.')
        start,end=struct.unpack_from('<II',table,4+index*8)
        if not 0<=start<end<=content[1]:raise ValueError('Invalid mascot member bounds.')
        return read(content[0]+start,end-start)
    index=MASCOTS[game]*(20 if generation==5 else 6)
    graphics=member(index+(0 if generation==5 else 3))
    palette=member(index+(18 if generation==5 else 4))
    return decode_sprite(graphics,palette,generation,reverse=game in {'diamond','pearl'})
