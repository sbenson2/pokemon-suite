"""Hand-built cartridge fixtures contain original test pixels, never game assets."""
import hashlib
import http.client
import importlib.util
import json
from pathlib import Path
import struct
import tempfile
import threading
import time
import unittest
import zlib
from unittest.mock import patch

from pokemon_suite.bootstrap import initialize
from pokemon_suite.server import SuiteServer


def fixture_rom(code=b'BPRE', color=31):
    rom = bytearray(0x10000)
    rom[0xAC:0xB0] = code
    rom[0xBD] = (-sum(rom[0xA0:0xBD]) - 0x19) & 255
    struct.pack_into('<II', rom, 0x100, 4 if code == b'BPRE' else 3, 2)
    for offset, target in [(0x128, 0x400), (0x12C, 0x1200), (0x130, 0x2000),
                           (0x134, 0x2E00), (0x144, 0x5000)]:
        struct.pack_into('<I', rom, offset, 0x08000000 + target)

    def compressed(at, data):
        out = bytearray(b'\x10' + len(data).to_bytes(3, 'little'))
        for start in range(0, len(data), 8):
            out.append(0)
            out.extend(data[start:start + 8])
        rom[at:at + len(out)] = out

    for table, data_at in [(0x400, 0x7000), (0x1200, 0x8000),
                           (0x2000, 0x9000), (0x2E00, 0x9100)]:
        for index in [1, 277]:
            struct.pack_into('<IHH', rom, table + index * 8, 0x08000000 + data_at, 2048, index)
    for index, name in [(1, 'BULBASAUR'), (277, 'TREECKO')]:
        encoded = bytes(0xBB + ord(c) - ord('A') for c in name) + b'\xff'
        rom[0x5000 + index * 11:0x5000 + index * 11 + len(encoded)] = encoded
    # First pixel transparent, second normal red; next tile green.
    pixels = bytearray(b'\x11' * 2048)
    pixels[0] = 0x10
    pixels[32] = 0x22
    compressed(0x7000, pixels)
    compressed(0x8000, b'\x22' * 2048)
    compressed(0x9000, struct.pack('<16H', 0, color, 992, *([0] * 13)))
    compressed(0x9100, struct.pack('<16H', 0, 31744, 992, *([0] * 13)))
    return bytes(rom)


def png_pixels(data):
    assert data[:8] == b'\x89PNG\r\n\x1a\n'
    chunks = []; position = 8; size = None
    while position < len(data):
        length = int.from_bytes(data[position:position + 4], 'big')
        kind = data[position + 4:position + 8]
        chunk = data[position + 8:position + 8 + length]
        if kind == b'IHDR': size = struct.unpack('>II', chunk[:8])
        if kind == b'IDAT': chunks.append(chunk)
        position += length + 12
    raw = zlib.decompress(b''.join(chunks))
    width, height = size
    rows = [raw[y * (width * 4 + 1):(y + 1) * (width * 4 + 1)] for y in range(height)]
    assert all(row[0] == 0 for row in rows)
    return size, b''.join(row[1:] for row in rows)


class RomArtTests(unittest.TestCase):
    def reader(self, data):
        self.assertIsNotNone(importlib.util.find_spec('pokemon_suite.rom_art'), 'The ROM artwork reader is missing')
        from pokemon_suite.rom_art import GbaArtwork
        return GbaArtwork(data)

    def test_actual_rom_pixels_palettes_tile_order_and_hoenn_species_mapping(self):
        reader = self.reader(fixture_rom())
        size, pixels = png_pixels(reader.pokemon('bulbasaur'))
        self.assertEqual(size, (64, 64))
        self.assertEqual(pixels[:8], b'\0\0\0\0\xff\0\0\xff')
        self.assertEqual(pixels[8 * 4:9 * 4], b'\0\xff\0\xff')
        self.assertEqual(png_pixels(reader.pokemon('bulbasaur', shiny=True))[1][4:8], b'\0\0\xff\xff')
        self.assertEqual(png_pixels(reader.pokemon('bulbasaur', back=True))[1][:4], b'\0\xff\0\xff')
        self.assertEqual(reader.pokemon('treecko'), reader.pokemon('bulbasaur'))

    def test_invalid_header_pointers_and_compression_do_not_read_outside_rom(self):
        with self.assertRaises(ValueError): self.reader(b'not a game')
        data = bytearray(fixture_rom()); struct.pack_into('<I', data, 0x128, 0x02000000)
        with self.assertRaises(ValueError): self.reader(data)
        data = bytearray(fixture_rom()); data[0x7004:0x7007] = b'\x80\x00\x00'
        with self.assertRaises(ValueError): self.reader(data).pokemon('bulbasaur')
        data = bytearray(fixture_rom()); data[0x7001:0x7004] = b'\xff\xff\xff'
        with self.assertRaises(ValueError): self.reader(data).pokemon('bulbasaur')

    def test_typographic_species_names_and_multi_palette_species_are_supported(self):
        reader = self.reader(fixture_rom())
        reader.species['farfetchd'] = 1
        self.assertEqual(reader.pokemon('Farfetch’d'), reader.pokemon('bulbasaur'))
        data = bytearray(fixture_rom())
        # Castform stores four palettes in one compressed block.
        palette = struct.pack('<16H', 0, 31, 992, *([0] * 13)) * 4
        encoded = b'\x10\x80\0\0' + b''.join(b'\0' + palette[i:i + 8] for i in range(0, 128, 8))
        data[0x9000:0x9000 + len(encoded)] = encoded
        self.assertEqual(png_pixels(self.reader(data).pokemon('bulbasaur'))[1][4:8], b'\xff\0\0\xff')

    def test_auxiliary_assets_use_only_a_matching_rom_layout(self):
        reader = self.reader(fixture_rom())
        self.assertTrue(hasattr(reader, 'auxiliary'), 'Trainer, item and badge ROM readers are missing')
        with self.assertRaises(ValueError): reader.auxiliary('trainer', 'male')
        from pokemon_suite.rom_art import AUXILIARY_LAYOUTS
        layout = {'trainers': 0x400, 'trainer_palettes': 0x2000, 'male': 1, 'female': 277,
                  'items': 0xA100, 'item_count': 3, 'badges': 0x7000, 'badge_palette': 0xA000}
        data = bytearray(fixture_rom()); data[0xA000:0xA020] = struct.pack('<16H', 0, 31, 992, *([0] * 13))
        struct.pack_into('<II', data, 0xA110, 0x08007000, 0x08009000)
        reader = self.reader(data)
        with patch.dict(AUXILIARY_LAYOUTS, {reader.sha1: layout}):
            self.assertEqual(png_pixels(reader.auxiliary('trainer', 'male'))[0], (64, 64))
            self.assertEqual(png_pixels(reader.auxiliary('badges', 'all'))[0], (128, 16))
            self.assertEqual(png_pixels(reader.auxiliary('item', '2'))[0], (24, 24))
            layout['categories'] = {'type': (0x7000, 0xA000)}
            self.assertEqual(png_pixels(reader.auxiliary('category', 'type'))[0], (64, 48))

    def test_http_reads_selected_local_rom_and_cache_never_masks_replacement_or_removal(self):
        with tempfile.TemporaryDirectory() as temporary:
            profile = Path(temporary); rom = profile / 'game.gba'; rom.write_bytes(fixture_rom())
            config = initialize(profile)
            config['games']['firered'] = {'cartridge': {'path': str(rom)}}
            (profile / 'config.json').write_text(json.dumps(config))
            server = SuiteServer(profile); thread = threading.Thread(target=server.serve_forever, daemon=True); thread.start()
            def get(path, authenticated=True):
                connection = http.client.HTTPConnection('127.0.0.1', server.server_port)
                headers = {'Cookie': 'pokemon-suite-session=' + server.token} if authenticated else {}
                connection.request('GET', path, headers=headers)
                response = connection.getresponse(); body = response.read(); connection.close()
                return response.status, response.getheader('Content-Type'), body
            try:
                status, mime, first = get('/api/rom-art/firered/pokemon/1.png')
                self.assertEqual(status, 200)
                self.assertEqual(mime, 'image/png')
                self.assertEqual(png_pixels(first)[0], (64, 64))
                self.assertEqual(get('/api/rom-art/firered/pokemon/1.png', False)[0], 403)
                self.assertEqual(get('/api/rom-art/emerald/pokemon/1.png')[1], 'image/svg+xml')
                self.assertEqual(get('/api/rom-art/firered/pokemon/../../config.json')[0], 404)
                def catalog_with_status(expected):
                    until = time.monotonic()+4
                    while True:
                        catalog = json.loads(get('/data/pokedex/firered.json')[2])
                        if catalog['artwork'] == expected or time.monotonic() >= until: return catalog
                        time.sleep(0.05)
                catalog = catalog_with_status('local-rom')
                self.assertEqual(catalog['artwork'], 'local-rom')
                self.assertIn('api/rom-art/firered/pokemon/1.png', catalog['species'][0]['sprite'])
                rom.write_bytes(fixture_rom(color=992))
                second = get('/api/rom-art/firered/pokemon/1.png')[2]
                self.assertNotEqual(first, second)
                config['games'] = {}
                config['library'] = {'firered': {'source': str(rom)}}
                (profile / 'config.json').write_text(json.dumps(config))
                self.assertEqual(get('/api/rom-art/firered/pokemon/1.png')[2], second)
                rom.unlink()
                self.assertEqual(get('/api/rom-art/firered/pokemon/1.png')[1], 'image/svg+xml')
                self.assertEqual(catalog_with_status('unavailable')['artwork'], 'unavailable')
                # The installed development PNG must not bypass the ROM boundary.
                self.assertEqual(get('/assets/pokedex/firered/1.png')[1], 'image/svg+xml')
            finally:
                server.shutdown(); server.server_close(); thread.join()
