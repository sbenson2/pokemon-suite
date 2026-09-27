"""Hand-made Nitro fixtures exercise local mascot decoding, not copyrighted art."""
import struct
import tempfile
from pathlib import Path
import unittest
from tests.test_rom_art import png_pixels


def chunk(magic, payload):
    return magic + struct.pack('<I', len(payload) + 8) + payload


def nitro(magic, blocks):
    body = b''.join(blocks)
    return magic + struct.pack('<HHIHH', 0xfffe, 0x100, 16+len(body), 16, len(blocks)) + body


def sprite(reverse=False, generation=4):
    width, height = (160,80) if generation == 4 else (8,8)
    raw = bytearray(width*height//2)
    raw[4] = 0x21
    if generation == 4:
        words=list(struct.unpack('<'+'H'*(len(raw)//2),raw)); seed=7
        for i in (range(len(words)-1,-1,-1) if reverse else range(len(words))):
            words[i] ^= seed
            seed=(seed*0x41c64e6d+0x6073)&0xffff
        raw=struct.pack('<'+'H'*len(words),*words)
    ncgr=nitro(b'RGCN',[chunk(b'RAHC',struct.pack('<HHIIIII',height//8,width//8,3,0,1,len(raw),24)+raw)])
    palette=struct.pack('<16H',0,31,992,*([0]*13))
    nclr=nitro(b'RLCN',[chunk(b'TTLP',struct.pack('<IIII',3,0,len(palette),16)+palette)])
    return ncgr,nclr


class MascotTests(unittest.TestCase):
    def test_gen5_static_obj_quadrants_and_retail_template_header(self):
        from pokemon_suite.ds_mascot import decode_sprite
        raw=bytearray(4608)
        for offset in [0,2048,3072,4096]:raw[offset]=0x11
        graphics=nitro(b'RGCN',[chunk(b'RAHC',struct.pack('<HHIIIII',12,12,3,0,0,4608,24)+raw)])
        graphics=bytearray(graphics);struct.pack_into('<I',graphics,8,0x2030);struct.pack_into('<I',graphics,20,0x2020)
        _,palette=sprite(generation=5)
        size,pixels=png_pixels(decode_sprite(graphics,palette,5))
        self.assertEqual(size,(96,96))
        for x,y in [(0,0),(64,0),(0,64),(64,64)]:
            self.assertEqual(pixels[(y*96+x)*4:(y*96+x)*4+4],bytes([255,0,0,255]))

    def test_cartridge_resolves_mascot_file_and_bad_archive_keeps_banner(self):
        from tests.test_rom_graphics import ds_fixture
        from pokemon_suite.cartridge_graphics import CartridgeSource,CartridgeIcon
        graphics,palette=sprite(reverse=True)
        table=bytearray(4+484*6*8);struct.pack_into('<H',table,0,484*6)
        struct.pack_into('<II',table,4+(483*6+3)*8,0,len(graphics))
        struct.pack_into('<II',table,4+(483*6+4)*8,len(graphics),len(graphics)+len(palette))
        archive=nitro(b'NARC',[chunk(b'BTAF',table),chunk(b'BTNF',bytes(8)),chunk(b'GMIF',graphics+palette)])
        root=b'\x88poketool\x01\xf0\0'; child=b'\x87pokegra\x02\xf0\0'; leaf=b'\x0cpokegra.narc\0'
        fnt=struct.pack('<IHHIHHIHH',24,0,3,24+len(root),0,0xf000,24+len(root)+len(child),0,0xf001)+root+child+leaf
        data=bytearray(ds_fixture())+bytearray(0x10000+len(archive)-len(ds_fixture()))
        data[12:16]=b'ADAE';struct.pack_into('<IIII',data,0x40,0x600,len(fnt),0x800,8)
        data[0x600:0x600+len(fnt)]=fnt;struct.pack_into('<II',data,0x800,0x10000,len(data));data[0x10000:]=archive
        with tempfile.TemporaryDirectory() as tmp:
            path=Path(tmp)/'game.nds';path.write_bytes(data)
            with CartridgeSource(path,'nds') as source:reader=CartridgeIcon(source,'nds')
            self.assertIn('mascot',reader.assets)
            self.assertEqual(png_pixels(reader.auxiliary('mascot','front'))[0],(80,80))
            # The same banner stays usable when its unrelated battle archive is damaged.
            data[0x10000]=0;path.write_bytes(data)
            with CartridgeSource(path,'nds') as source:damaged=CartridgeIcon(source,'nds')
            self.assertEqual(damaged.assets,['game']);self.assertEqual(reader.icon,damaged.icon)
            self.assertNotEqual(reader.fingerprint,damaged.fingerprint)

    def test_affine_logo_places_tiles_and_trims_only_transparent_margin(self):
        from pokemon_suite.cartridge_label import affine_logo
        tiles=bytes(64)+bytes([1])*64
        palette=struct.pack('<HH',0,31)
        size,pixels=png_pixels(affine_logo(tiles,bytes([0,1,0,0]),palette,2))
        self.assertEqual(size,(8,8))
        self.assertEqual(pixels,bytes([255,0,0,255])*64)
        with self.assertRaises(ValueError):affine_logo(tiles,bytes([0,4,0,0]),palette,2)

    def test_lz11_literals_overlapping_copy_and_invalid_reference(self):
        from pokemon_suite.ds_mascot import decompress
        self.assertEqual(decompress(bytes.fromhex('110800002061625001')), b'abababab')
        with self.assertRaises(ValueError): decompress(bytes.fromhex('11080000806100'))
        with self.assertRaises(ValueError): decompress(bytes.fromhex('11ffffff00'))

    def test_gen4_encryption_direction_and_first_frame(self):
        from pokemon_suite.ds_mascot import decode_sprite
        for reverse in (False,True):
            size,pixels=png_pixels(decode_sprite(*sprite(reverse),generation=4,reverse=reverse))
            self.assertEqual(size,(80,80))
            self.assertEqual(pixels[8*4:10*4],bytes([255,0,0,255,0,255,0,255]))
            self.assertEqual(pixels[:4],bytes(4))

    def test_gen5_static_pixels_and_invalid_dimensions(self):
        from pokemon_suite.ds_mascot import decode_sprite
        ncgr,nclr=sprite(generation=5)
        size,pixels=png_pixels(decode_sprite(ncgr,nclr,generation=5))
        self.assertEqual(size,(8,8))
        self.assertEqual(pixels[8*4:10*4],bytes([255,0,0,255,0,255,0,255]))
        malformed=bytearray(ncgr);struct.pack_into('<H',malformed,24,0xffff)
        with self.assertRaises(ValueError):decode_sprite(malformed,nclr,generation=5)
        with self.assertRaises(ValueError):decode_sprite(ncgr[:-1],nclr,generation=5)

    def test_narc_members_cannot_escape_archive(self):
        from pokemon_suite.ds_mascot import narc_member
        archive=nitro(b'NARC',[chunk(b'BTAF',struct.pack('<HHII',1,0,0,4)),chunk(b'BTNF',bytes(8)),chunk(b'GMIF',b'test')])
        self.assertEqual(narc_member(archive,0),b'test')
        with self.assertRaises(ValueError):narc_member(archive,1)
        bad=bytearray(archive);struct.pack_into('<I',bad,32,400)
        with self.assertRaises(ValueError):narc_member(bad,0)

if __name__=='__main__':unittest.main()
