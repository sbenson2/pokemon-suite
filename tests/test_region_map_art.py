"""Synthetic map pixels and palettes; no Nintendo assets in test fixtures."""
import struct
import unittest
from unittest.mock import patch
from test_rom_art import fixture_rom, png_pixels
from pokemon_suite.rom_art import GbaArtwork, AUXILIARY_LAYOUTS

class RegionMapArtTests(unittest.TestCase):
    def test_map_uses_tile_order_flips_palette_banks_and_opaque_background(self):
        rom=bytearray(fixture_rom())
        def lz(at,data):
            value=b'\x10'+len(data).to_bytes(3,'little')+b''.join(b'\0'+data[i:i+8] for i in range(0,len(data),8))
            rom[at:at+len(value)]=value
        tile=bytearray(32);tile[0]=0x21;tile[3]=0x30;tile[28]=0x04
        lz(0xA000,tile)
        banks=[0]*(5*16);banks[0]=31;banks[1]=992;banks[2]=31744;banks[3]=32767;banks[4]=1023;banks[17]=31744
        rom[0xA100:0xA1A0]=struct.pack('<80H',*banks)
        cells=[0]*600;cells[1]=0x400;cells[2]=0x800;cells[3]=0x1000
        lz(0xB000,struct.pack('<600H',*cells))
        reader=GbaArtwork(rom)
        layout={'region_map':{'tiles':0xA000,'palette':0xA100,'maps':{'kanto':0xB000}}}
        with patch.dict(AUXILIARY_LAYOUTS,{reader.sha1:layout}):
            size,pixels=png_pixels(reader.auxiliary('map','kanto'))
            self.assertEqual(size,(240,160))
            def pixel(x,y):return pixels[(y*240+x)*4:(y*240+x+1)*4]
            self.assertEqual(pixel(0,0),b'\0\xff\0\xff')
            self.assertEqual(pixel(1,0),b'\0\0\xff\xff')
            self.assertEqual(pixel(2,0),b'\xff\0\0\xff','Background palette zero is opaque')
            self.assertEqual(pixel(8,0),b'\xff\xff\xff\xff','Horizontal flip')
            self.assertEqual(pixel(16,0),b'\xff\xff\0\xff','Vertical flip')
            self.assertEqual(pixel(24,0),b'\0\0\xff\xff','Palette bank one')
            with self.assertRaises(ValueError):reader.auxiliary('map','made-up')

    def test_map_and_heads_require_qualified_rom_and_heads_keep_transparency(self):
        rom=bytearray(fixture_rom());rom[0xA100:0xA120]=struct.pack('<16H',0,31,*([0]*14))
        reader=GbaArtwork(rom)
        with self.assertRaises(ValueError):reader.auxiliary('map','kanto')
        with self.assertRaises(ValueError):reader.auxiliary('map','female')
        layout={'region_map':{'heads':{'female':(0x7000,0xA100)}}}
        with patch.dict(AUXILIARY_LAYOUTS,{reader.sha1:layout}):
            size,pixels=png_pixels(reader.auxiliary('map','female'))
            self.assertEqual(size,(16,16));self.assertEqual(pixels[:4],b'\0\0\0\0')
            self.assertEqual(pixels[4:8],b'\xff\0\0\xff')
            with self.assertRaises(ValueError):reader.auxiliary('map','male')
