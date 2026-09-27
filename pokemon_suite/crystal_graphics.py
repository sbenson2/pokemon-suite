"""Original Crystal LZ3 and two-bit tile readers, exact-revision qualified."""
import hashlib
import struct
from .rom_art import png, slug

LAYOUTS = {
    'f2f52230b536214ef7c9924f483392993e226cfb': {
        'names': 0x53384, 'base': 0x51424, 'pictures': 0x120000,
        'unown': 0x124000, 'palettes': 0xA8CE,
        'male': 0x888A9, 'female': 0x88BB9, 'male_palette': 0xB0CE, 'female_palette': 0xB0D2,
    },
}


def decompress(data, offset, limit=16384):
    cursor = offset
    output = bytearray()
    def take(n):
        nonlocal cursor
        if cursor < 0 or cursor+n > len(data): raise ValueError('Incomplete Crystal compressed graphics.')
        value = data[cursor:cursor+n]; cursor += n
        return value
    while True:
        control = take(1)[0]
        if control == 255: return bytes(output)
        command, count = control >> 5, (control & 31)+1
        if command == 7:
            command = (control >> 2) & 7
            count = ((control & 3) << 8 | take(1)[0])+1
        if command > 6 or len(output)+count > limit: raise ValueError('Invalid or oversized Crystal graphics command.')
        if command == 0: output.extend(take(count))
        elif command == 1: output.extend(take(1)*count)
        elif command == 2:
            pair = take(2); output.extend((pair*((count+1)//2))[:count])
        elif command == 3: output.extend(bytes(count))
        else:
            first = take(1)[0]
            source = len(output)-(first & 127)-1 if first & 128 else first << 8 | take(1)[0]
            for i in range(count):
                index = source-i if command == 6 else source+i
                if not 0 <= index < len(output): raise ValueError('Invalid Crystal graphics back-reference.')
                value = output[index]
                if command == 5: value = int(f'{value:08b}'[::-1], 2)
                output.append(value)


def tiles_png(data, palette, width, height):
    if width % 8 or height % 8 or len(data) < width*height//4 or len(palette) != 4:
        raise ValueError('Incomplete Crystal tiles or palette.')
    colors = [bytes(4)]
    for value in struct.unpack('<2H', palette):
        colors.append(bytes([*(((value >> bit) & 31)*255//31 for bit in (0,5,10)),255]))
    colors.append(bytes([0,0,0,255]))
    pixels = bytearray()
    for y in range(height):
        for x in range(width):
            tile = (x//8)*(height//8)+y//8
            lo, hi = data[tile*16+(y%8)*2:tile*16+(y%8)*2+2]
            bit = 7-x%8
            pixels.extend(colors[(lo >> bit & 1) | ((hi >> bit & 1) << 1)])
    return png(width,height,pixels)


class CrystalArtwork:
    game = 'crystal'
    assets = ['pokemon','game','trainer']

    def __init__(self, data):
        self.data = bytes(data)
        self.sha1 = hashlib.sha1(data).hexdigest()
        self.sha256 = self.fingerprint = hashlib.sha256(data).hexdigest()
        self.layout = LAYOUTS.get(self.sha1)
        if not self.layout: raise ValueError('This Crystal revision has not been qualified for artwork.')
        self.species = {}
        punctuation = {0x7f:' ',0xe8:'.',0xe3:'-',0xe0:"'",0xef:'♂',0xf5:'♀'}
        for index in range(1,252):
            name = []
            for byte in self.read(self.layout['names']+(index-1)*10,10):
                if byte == 0x50: break
                name.append(chr(byte-0x80+65) if 0x80 <= byte <= 0x99 else str(byte-0xf6) if 0xf6 <= byte <= 0xff else punctuation.get(byte,'?'))
            self.species[slug(''.join(name))] = index

    def read(self, offset, count):
        if offset < 0 or offset+count > len(self.data): raise ValueError('Crystal artwork points outside the cartridge.')
        return self.data[offset:offset+count]

    def pokemon(self, name, shiny=False, back=False):
        index = self.species.get(slug(name))
        if index is None: raise ValueError('This Pokémon is not in Crystal.')
        table = self.layout['unown'] if index == 201 else self.layout['pictures']+(index-1)*6
        bank, low, high = self.read(table+(3 if back else 0),3)
        address = low | high << 8
        if not 0x4000 <= address < 0x8000: raise ValueError('Invalid Crystal picture pointer.')
        offset = (bank+0x36)*0x4000+(address & 0x3fff)
        dimension = 6 if back else self.read(self.layout['base']+(index-1)*32+17,1)[0] & 15
        if dimension not in {5,6,7}: raise ValueError('Invalid Crystal picture dimensions.')
        palette = self.read(self.layout['palettes']+index*8+(4 if shiny else 0),4)
        return tiles_png(decompress(self.data,offset),palette,dimension*8,dimension*8)

    def auxiliary(self, kind, key):
        if kind == 'game' and key == 'icon': return self.pokemon('suicune')
        if kind == 'trainer' and key in {'male','female'}:
            return tiles_png(self.read(self.layout[key],56*56//4),self.read(self.layout[key+'_palette'],4),56,56)
        raise ValueError('This Crystal artwork category is not yet supported.')
