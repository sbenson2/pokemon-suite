"""Decode qualified cartridge Town Map backgrounds without shipping game pixels."""
import struct
from .rom_art import png


def region_map_png(tiles, tilemap, palette):
    # FireRed stores a packed 30×20 tilemap before copying it into 32-wide VRAM.
    width, height = 240, 160
    if len(tilemap) != 1200 or len(palette) != 160 or not tiles or len(tiles) % 32:
        raise ValueError('Incomplete Town Map tiles, layout or palette.')
    colors = [bytes([*((((v >> shift) & 31) << 3 | ((v >> shift) & 31) >> 2) for shift in (0, 5, 10)), 255])
              for v in struct.unpack('<80H', palette)]
    entries = struct.unpack('<600H', tilemap)
    pixels = bytearray(width * height * 4)
    for index, entry in enumerate(entries):
        tile, bank = entry & 1023, entry >> 12
        if (tile + 1) * 32 > len(tiles) or bank >= 5:
            raise ValueError('Town Map references an unavailable tile or palette.')
        left, top = index % 30 * 8, index // 30 * 8
        for y in range(8):
            sy = 7-y if entry & 0x800 else y
            for x in range(8):
                sx = 7-x if entry & 0x400 else x
                byte = tiles[tile*32+sy*4+sx//2]
                color = colors[bank*16+((byte >> (4*(sx%2))) & 15)]
                offset = ((top+y)*width+left+x)*4
                pixels[offset:offset+4] = color
    return png(width, height, pixels)
