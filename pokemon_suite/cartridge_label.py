"""Local title-logo tilemap decoding for the cartridge label renderer."""
import struct
from .rom_art import png


def affine_logo(tiles, tilemap, palette, columns=32):
    if not 1<=columns<=32 or len(tilemap)%columns or not 0<len(tilemap)<=1024 or len(palette)%2:
        raise ValueError('Invalid title-logo layout.')
    colors=[bytes([*((v>>s&31)*255//31 for s in (0,5,10)),255]) if i else bytes(4)
            for i,(v,) in enumerate(struct.iter_unpack('<H',palette))]
    width=columns*8;height=len(tilemap)//columns*8
    pixels=bytearray();xs=[];ys=[]
    for y in range(height):
        for x in range(width):
            tile=tilemap[(y//8)*columns+x//8];offset=tile*64+(y%8)*8+x%8
            if offset>=len(tiles) or tiles[offset]>=len(colors):raise ValueError('Title-logo pixels exceed their tables.')
            index=tiles[offset];pixels.extend(colors[index])
            if index:xs.append(x);ys.append(y)
    if not xs:raise ValueError('The title logo is empty.')
    left,right,top,bottom=min(xs),max(xs)+1,min(ys),max(ys)+1
    cropped=b''.join(pixels[(y*width+left)*4:(y*width+right)*4] for y in range(top,bottom))
    return png(right-left,bottom-top,cropped)
