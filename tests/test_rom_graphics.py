"""Original synthetic cartridge graphics; no game assets in test fixtures."""
import hashlib
import json
from pathlib import Path
import struct
import tempfile
import threading
import time
import unittest
import zipfile
from unittest.mock import patch

from pokemon_suite.bootstrap import initialize
from pokemon_suite.rom_art import RomArtwork, artwork_request
from pokemon_suite.server import STATIC
from tests.test_rom_art import fixture_rom, png_pixels


def ds_fixture():
    data = bytearray(0xA000)
    data[12:16] = b'IREO'
    struct.pack_into('<I', data, 0x68, 0x9000)
    struct.pack_into('<H', data, 0x9000, 1)
    data[0x9020:0x9220] = b'\x11' * 512
    data[0x9020] = 0x10
    data[0x9040] = 0x22
    struct.pack_into('<3H', data, 0x9220, 0, 31, 992)
    return bytes(data)


def three_ds_fixture(encrypted=False):
    data = bytearray(0x10000)
    data[0x100:0x104] = b'NCSD'
    struct.pack_into('<II', data, 0x120, 0x20, 0x60)
    ncch = 0x4000
    data[ncch+0x100:ncch+0x104] = b'NCCH'
    data[ncch+0x150:ncch+0x15a] = b'CTR-P-A2AA'
    data[ncch+0x18f] = 0 if encrypted else 4
    struct.pack_into('<II', data, ncch+0x1a0, 1, 0x20)
    exefs = ncch+0x200
    data[exefs:exefs+4] = b'icon'
    struct.pack_into('<II', data, exefs+8, 0, 0x36c0)
    smdh = exefs+0x200
    data[smdh:smdh+4] = b'SMDH'
    # RGB565 Morton order: x1=1, y1=2, x8=64, y8=384.
    for index, color in [(0, 0xf800), (1, 0x07e0), (2, 0x001f), (64, 0xffff), (384, 0xffe0)]:
        struct.pack_into('<H', data, smdh+0x24c0+index*2, color)
    return bytes(data)


class GraphicsTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        self.profile = Path(self.temp.name)
        self.config = initialize(self.profile)
        self.art = RomArtwork(self.profile, STATIC)

    def source(self, game, data, suffix, zipped=False):
        path = self.profile / (game + ('.zip' if zipped else suffix))
        if zipped:
            with zipfile.ZipFile(path, 'w', zipfile.ZIP_DEFLATED) as archive:
                archive.writestr('__MACOSX/._game'+suffix, b'ignored')
                archive.writestr('folder/game'+suffix, data)
        else: path.write_bytes(data)
        self.config.setdefault('library', {})[game] = {'source': str(path)}
        (self.profile/'config.json').write_text(json.dumps(self.config))
        return path

    def test_zip_matches_raw_and_replacement_removal_invalidate(self):
        raw = fixture_rom()
        self.source('firered', raw, '.gba', True)
        first = self.art.image('firered', 'pokemon', '1')
        self.source('firered', raw, '.gba')
        self.assertEqual(first, self.art.image('firered', 'pokemon', '1'))
        archive = self.source('firered', fixture_rom(color=992), '.gba', True)
        self.assertNotEqual(first, self.art.image('firered', 'pokemon', '1'))
        archive.unlink()
        self.assertEqual(self.art.status('firered')['artwork'], 'unavailable')

    def test_wrong_game_and_ambiguous_archive_fail_even_after_cache_hit(self):
        path = self.source('firered', fixture_rom(), '.gba', True)
        self.art.image('firered', 'pokemon', '1')
        self.config['library']['emerald'] = {'source': str(path)}
        (self.profile/'config.json').write_text(json.dumps(self.config))
        self.assertEqual(self.art.status('emerald')['artwork'], 'unavailable')
        with zipfile.ZipFile(path, 'a') as archive: archive.writestr('another.gba', fixture_rom())
        self.assertEqual(self.art.status('firered')['artwork'], 'unavailable')

    def test_ds_banner_from_zip_uses_native_tiles_and_reports_limited_coverage(self):
        self.source('black2', ds_fixture(), '.nds', True)
        size, pixels = png_pixels(self.art.image('black2', 'game', 'icon'))
        self.assertEqual(size, (32, 32))
        self.assertEqual(pixels[:8], bytes([0,0,0,0,255,0,0,255]))
        self.assertEqual(pixels[32:36], bytes([0,255,0,255]))
        self.assertEqual(self.art.status('black2')['assets'], ['game'])
        self.assertIsNone(self.art.status('black2').get('sha256'))
        with self.assertRaises(ValueError): self.art.image('black2', 'pokemon', '1')
        self.assertEqual(artwork_request('/api/rom-art/black2/game/icon.png'), ('black2','game','icon'))

    def test_3ds_smdh_pixels_morton_order_and_selected_game_validation(self):
        path = self.source('ultra-sun', three_ds_fixture(), '.3ds')
        size, pixels = png_pixels(self.art.image('ultra-sun', 'game', 'icon'))
        self.assertEqual(size, (48,48))
        for x,y,color in [(0,0,(255,0,0)),(1,0,(0,255,0)),(0,1,(0,0,255)),(8,0,(255,255,255)),(0,8,(255,255,0))]:
            self.assertEqual(pixels[(y*48+x)*4:(y*48+x)*4+4], bytes((*color,255)))
        self.config['library']['ultra-moon'] = {'source': str(path)}
        (self.profile/'config.json').write_text(json.dumps(self.config))
        self.assertEqual(self.art.status('ultra-moon')['artwork'], 'unavailable')
        self.assertEqual(artwork_request('/api/rom-art/ultra-sun/game/icon.png'), ('ultra-sun','game','icon'))
        self.assertIsNone(artwork_request('/api/rom-art/not-a-game/game/icon.png'))

    def test_encrypted_and_out_of_bounds_containers_report_reason(self):
        self.source('ultra-sun', three_ds_fixture(encrypted=True), '.3ds')
        self.assertIn('encrypted', self.art.status('ultra-sun')['message'].lower())
        data = bytearray(ds_fixture()); struct.pack_into('<I', data, 0x68, len(data)+512)
        self.source('black2', data, '.nds')
        self.assertEqual(self.art.status('black2')['artwork'], 'unavailable')

    def test_selecting_rom_folder_is_atomic_and_preserves_installed_games(self):
        from pokemon_suite.pokemon_sessions import SuiteSessions
        sessions = SuiteSessions(self.profile)
        original = json.loads((self.profile/'config.json').read_text())
        with self.assertRaises(ValueError): sessions.scan_library(str(self.profile/'missing'))
        self.assertEqual(json.loads((self.profile/'config.json').read_text()), original)
        folder = self.profile/'roms'; (folder/'gba').mkdir(parents=True)
        (folder/'gba/Pokemon - FireRed Version.gba').write_bytes(fixture_rom())
        sessions.scan_library(str(folder))
        updated = json.loads((self.profile/'config.json').read_text())
        self.assertEqual(updated['games'], original['games'])
        self.assertEqual(updated['libraryRoot'], str(folder.resolve()))
        self.assertIn('firered', updated['library'])

    def test_crystal_compression_commands_and_corrupt_references(self):
        from pokemon_suite.crystal_graphics import decompress
        # Literal, repeat-byte, alternating bytes, zeros, forward, bit-flip,
        # reverse, and long literal. Back-references may overlap.
        data = bytes([2, 1, 2, 3, 0x21, 9, 0x42, 4, 5, 0x61,
                      0x82, 0, 0, 0xa0, 0, 0, 0xc2, 0, 2, 0xe0, 32]) + bytes(range(33)) + b'\xff'
        self.assertEqual(decompress(data, 0), bytes([1,2,3,9,9,4,5,4,0,0,1,2,3,128,3,2,1])+bytes(range(33)))
        self.assertEqual(decompress(b'\x00\x05\x83\x80\xff', 0), bytes([5]*5))
        for invalid in [b'\x80\x80\xff', b'\x03\x00', b'\xc1\x00\x00\xff', b'\xe3\xff']:
            with self.assertRaises(ValueError): decompress(invalid, 0)
        with self.assertRaises(ValueError): decompress(b'\x7f\xff', 0, limit=16)

    def test_crystal_two_bit_pixels_use_column_major_tiles(self):
        from pokemon_suite.crystal_graphics import tiles_png
        data = bytearray(64)
        data[0] = 0x40  # first tile: transparent, color 1
        data[16+1] = 0x80  # next tile is below, color 2
        size, pixels = png_pixels(tiles_png(data, struct.pack('<HH',31,992), 16,16))
        self.assertEqual(size, (16,16))
        self.assertEqual(pixels[:8], bytes([0,0,0,0,255,0,0,255]))
        self.assertEqual(pixels[8*16*4:8*16*4+4], bytes([0,255,0,255]))
        with self.assertRaises(ValueError): tiles_png(data[:10], bytes(4),16,16)

    def test_crystal_names_include_digits_and_player_portraits_are_uncompressed(self):
        from pokemon_suite.crystal_graphics import CrystalArtwork, LAYOUTS
        data = bytearray(0x10000)
        data[0x1000:0x1000+2510] = bytes([0x50])*2510
        name = bytes(0x80+ord(c)-65 for c in 'PORYGON')+bytes([0xf8,0x50])
        data[0x1000+2320:0x1000+2320+len(name)] = name
        data[0x9000:0x9000+784] = bytes([0x40,0])*392
        data[0xa000:0xa004] = struct.pack('<2H',31,992)
        layout = {'names':0x1000,'male':0x9000,'male_palette':0xa000}
        with patch.dict(LAYOUTS, {hashlib.sha1(data).hexdigest():layout}):
            reader = CrystalArtwork(data)
            self.assertEqual(reader.species['porygon2'],233)
            self.assertEqual(png_pixels(reader.auxiliary('trainer','male'))[1][4:8],bytes([255,0,0,255]))

    def test_hash_bound_ruby_layout_and_individual_badge_tiles(self):
        from pokemon_suite.rom_art import GbaArtwork, AUXILIARY_LAYOUTS, LEGACY_GBA_LAYOUTS
        raw = fixture_rom(code=b'AXVE')
        digest = hashlib.sha1(raw).hexdigest()
        with self.assertRaises(ValueError): GbaArtwork(raw)
        with patch.dict(LEGACY_GBA_LAYOUTS, {digest: {'front':0x400,'back':0x1200,'normal':0x2000,'shiny':0x2e00,'names':0x5000}}):
            self.assertEqual(png_pixels(GbaArtwork(raw).pokemon('bulbasaur'))[1][4:8], bytes([255,0,0,255]))
        data = bytearray(fixture_rom())
        data[0xa000:0xa020] = struct.pack('<16H', 0,31,992,*([0]*13))
        reader = GbaArtwork(data)
        with patch.dict(AUXILIARY_LAYOUTS, {reader.sha1: {'badges':0x7000,'badge_palette':0xa000}}):
            self.assertEqual(png_pixels(reader.auxiliary('badges','0'))[0], (16,16))
            self.assertEqual(reader.assets, ['pokemon','game','badges'])

    def test_library_artwork_checks_do_not_block_on_a_drive_permission_prompt(self):
        entered, release = threading.Event(), threading.Event()
        def waiting(game):
            entered.set(); release.wait(3)
            return {'game':game,'artwork':'unavailable','assets':[]}
        with patch.object(self.art, 'status', side_effect=waiting):
            try:
                started = time.monotonic()
                result = self.art.snapshot(['firered'])
                self.assertLess(time.monotonic()-started, 0.2)
                self.assertEqual(result['firered']['artwork'], 'checking')
                self.assertTrue(entered.wait(1))
                self.assertEqual(self.art.snapshot(['firered'])['firered']['artwork'], 'checking')
            finally: release.set()
