"""Decode artwork from the configured local cartridge; never download game assets.

The GBA Pokémon interoperability header supplies the graphics tables. Format
references and the limits of the supported readers are in docs/ROM-RESOURCES.md.
Only decoded PNGs in bounded process memory are cached, keyed by ROM identity.
"""
from collections import OrderedDict
import hashlib
import json
from pathlib import Path
import re
import queue
import struct
import threading
import time
import unicodedata
import zlib
import zipfile

from .pokemon_main_series import MAIN_GAMES


GAMES = {b'BPRE': 'firered', b'BPGE': 'leafgreen', b'BPEE': 'emerald', b'AXVE': 'ruby', b'AXPE': 'sapphire'}
# Ruby/Sapphire predate the interoperability header. Only exact qualified ROMs
# use these numeric table locations; hacks and other revisions fail explicitly.
LEGACY_GBA_LAYOUTS = {
    '5b64eacf892920518db4ec664e62a086dd5f5bc8': {'front':0x1E836C, 'back':0x1E980C, 'normal':0x1EA5CC, 'shiny':0x1EB38C, 'names':0x1F7184},
    '89b45fb172e6b55d51fc0e61989775187f6fe63c': {'front':0x1E82FC, 'back':0x1E979C, 'normal':0x1EA55C, 'shiny':0x1EB31C, 'names':0x1F7114},
}
# Numeric format locations only, qualified against exact cartridge SHA-1s.
# These are not extracted graphics or executable game code.
AUXILIARY_LAYOUTS = {
    '7862c67bdecbe21d1d69ce082ce34327e1c6ed5e': {
        'trainers': 0x2395C8, 'trainer_palettes': 0x239A68, 'male': 135, 'female': 136,
        'items': 0x3D4140, 'item_count': 376, 'badges': 0x3CD494, 'badge_palette': 0x3CD16C,
    },
    'dd5945db9b930750cb39d00c84da8571feebf417': {
        'trainers': 0x2395EC, 'trainer_palettes': 0x239A8C, 'male': 135, 'female': 136,
        'items': 0x3D4304, 'item_count': 376, 'badges': 0x3CD658, 'badge_palette': 0x3CD350,
        'region_map': {'tiles': 0x3EF68C, 'palette': 0x3EF34C,
                       'maps': {'kanto': 0x3F090C, 'sevii-123': 0x3F0B6C, 'sevii-45': 0x3F0C7C, 'sevii-67': 0x3F0D60},
                       'heads': {'male': (0x3EF594, 0x3EF2EC), 'female': (0x3EF60C, 0x3EF30C)}},
        'categories': {'abc': (0xE9C16C, 0xE9C14C), 'type': (0x442C30, 0x443610),
                       'grassland': (0x44152C, 0x443510), 'rare': (0x441DC4, 0x443570)},
    },
    'f3ae088181bf583e55daf962a92bb46f4f1d07b7': {
        'trainers': 0x305654, 'trainer_palettes': 0x30593C, 'male': 71, 'female': 72,
        'items': 0x614410, 'item_count': 378, 'badges': 0x56F5CC, 'badge_palette': 0x56F4EC,
        'logo': (0xDDE690, 0xDE0644, 0xDDE258),
    },
}


def slug(name):
    name = name.lower().replace('♀', '-f').replace('♂', '-m').replace("'", '').replace('’', '')
    name = unicodedata.normalize('NFKD', name).encode('ascii', 'ignore').decode()
    return re.sub(r'[^a-z0-9]+', '-', name).strip('-')


def game_text(data):
    text = []
    punctuation = {0: ' ', 0xAD: '.', 0xAE: '-', 0xB4: "'", 0xB5: '♂', 0xB6: '♀', 0xBA: '/'}
    for byte in data:
        if byte == 255: break
        if 0xBB <= byte <= 0xD4: text.append(chr(ord('A') + byte - 0xBB))
        elif 0xD5 <= byte <= 0xEE: text.append(chr(ord('a') + byte - 0xD5))
        elif 0xA1 <= byte <= 0xAA: text.append(str(byte - 0xA1))
        else: text.append(punctuation.get(byte, '?'))
    return ''.join(text).strip()


def png(width, height, pixels):
    def chunk(kind, data):
        return struct.pack('>I', len(data)) + kind + data + struct.pack('>I', zlib.crc32(kind + data))
    rows = b''.join(b'\0' + pixels[y * width * 4:(y + 1) * width * 4] for y in range(height))
    return (b'\x89PNG\r\n\x1a\n' + chunk(b'IHDR', struct.pack('>IIBBBBB', width, height, 8, 6, 0, 0, 0))
            + chunk(b'IDAT', zlib.compress(rows)) + chunk(b'IEND', b''))


class GbaArtwork:
    def __init__(self, data):
        self.data = bytes(data)
        data = self.data
        if not 0x200 <= len(data) <= 32 * 1024 * 1024:
            raise ValueError('A raw supported GBA ROM is required.')
        self.game = GAMES.get(data[0xAC:0xB0])
        if not self.game or data[0xBD] != (-sum(data[0xA0:0xBD]) - 0x19) & 255:
            raise ValueError('An English Pokémon GBA cartridge with a valid header is required.')
        self.sha256 = hashlib.sha256(data).hexdigest()
        self.fingerprint = self.sha256
        self.sha1 = hashlib.sha1(data).hexdigest()
        if self.game in {'ruby', 'sapphire'}:
            layout = LEGACY_GBA_LAYOUTS.get(self.sha1)
            if not layout: raise ValueError('This Ruby/Sapphire revision has not been qualified for artwork.')
            for name in ('front', 'back', 'normal', 'shiny'):
                self.read(layout[name], 412*8); setattr(self, name, layout[name])
            names = layout['names']; self.read(names, 412*11)
        else:
            if self.u32(0x104) != 2: raise ValueError('This artwork reader requires the English interoperability header.')
            self.front = self.pointer(0x128, 412 * 8)
            self.back = self.pointer(0x12C, 412 * 8)
            self.normal = self.pointer(0x130, 412 * 8)
            self.shiny = self.pointer(0x134, 412 * 8)
            names = self.pointer(0x144, 412 * 11)
        self.species = {}
        for index in range(1, 412):
            name = slug(game_text(self.read(names + index * 11, 11)))
            if name and not 252 <= index <= 276:
                self.species.setdefault(name, index)

    @property
    def assets(self):
        layout = AUXILIARY_LAYOUTS.get(self.sha1, {})
        return ['pokemon', 'game'] + [kind for kind, field in [('trainer', 'trainers'), ('item', 'items'), ('badges', 'badges'), ('category', 'categories'), ('logo', 'logo'), ('map', 'region_map')] if field in layout]

    def read(self, offset, size):
        if offset < 0 or size < 0 or offset + size > len(self.data):
            raise ValueError('Artwork data points outside this ROM.')
        return self.data[offset:offset + size]

    def u32(self, offset):
        return int.from_bytes(self.read(offset, 4), 'little')

    def pointer(self, offset, size=1):
        target = self.u32(offset) - 0x08000000
        self.read(target, size)
        return target

    def decompress(self, offset, limit=16384):
        header = self.read(offset, 4)
        length = int.from_bytes(header[1:], 'little')
        if header[0] != 0x10 or not 0 < length <= limit:
            raise ValueError('Unsupported or oversized compressed artwork.')
        cursor = offset + 4; output = bytearray()
        while len(output) < length:
            flags = self.read(cursor, 1)[0]; cursor += 1
            for bit in range(7, -1, -1):
                if len(output) == length: break
                if flags & (1 << bit):
                    a, b = self.read(cursor, 2); cursor += 2
                    count = (a >> 4) + 3; distance = ((a & 15) << 8 | b) + 1
                    if distance > len(output) or count > length - len(output):
                        raise ValueError('Invalid compressed artwork back-reference.')
                    for _ in range(count): output.append(output[-distance])
                else:
                    output.extend(self.read(cursor, 1)); cursor += 1
        return bytes(output)

    def tiles_png(self, tiles, palette, width, height):
        if len(tiles) < width * height // 2 or len(palette) < 32:
            raise ValueError('Incomplete artwork tiles or palette.')
        colors = []
        for index, value in enumerate(struct.unpack('<16H', palette[:32])):
            colors.append(bytes([*((((value >> shift) & 31) << 3 | ((value >> shift) & 31) >> 2) for shift in (0, 5, 10)), 255]) if index else b'\0\0\0\0')
        pixels = bytearray()
        for y in range(height):
            for x in range(width):
                tile = (y // 8) * (width // 8) + x // 8
                byte = tiles[tile * 32 + (y % 8) * 4 + (x % 8) // 2]
                pixels.extend(colors[(byte >> (4 * (x % 2))) & 15])
        return png(width, height, pixels)

    def pokemon(self, name, shiny=False, back=False):
        index = self.species.get(slug(name))
        if index is None: raise ValueError('This species is not in the selected ROM.')
        tiles = self.decompress(self.pointer((self.back if back else self.front) + index * 8))
        palette = self.decompress(self.pointer((self.shiny if shiny else self.normal) + index * 8), 128)
        return self.tiles_png(tiles, palette, 64, 64)

    def auxiliary(self, kind, key):
        if kind == 'game' and key == 'icon':
            return self.pokemon({'firered': 'charizard', 'leafgreen': 'venusaur', 'emerald': 'rayquaza', 'ruby': 'groudon', 'sapphire': 'kyogre'}[self.game])
        layout = AUXILIARY_LAYOUTS.get(self.sha1)
        if not layout: raise ValueError('Auxiliary artwork is not qualified for this ROM revision.')
        if kind == 'map' and 'region_map' in layout:
            region = layout['region_map']
            if key in region.get('heads', {}):
                tiles, palette = region['heads'][key]
                return self.tiles_png(self.decompress(tiles), self.read(palette, 32), 16, 16)
            if key in region.get('maps', {}):
                from .region_map_art import region_map_png
                return region_map_png(self.decompress(region['tiles']),
                                      self.decompress(region['maps'][key]), self.read(region['palette'], 160))
        if kind == 'logo' and key == 'pokemon' and 'logo' in layout:
            from .cartridge_label import affine_logo
            tiles, tilemap, palette = layout['logo']
            return affine_logo(self.decompress(tiles), self.decompress(tilemap), self.read(palette, 480))
        if kind == 'trainer' and key in {'male', 'female'}:
            index = layout[key]
            return self.tiles_png(self.decompress(self.pointer(layout['trainers'] + index * 8)),
                                  self.decompress(self.pointer(layout['trainer_palettes'] + index * 8), 32), 64, 64)
        if kind == 'item' and key.isdecimal() and 0 < int(key) < layout['item_count']:
            offset = layout['items'] + int(key) * 8
            return self.tiles_png(self.decompress(self.pointer(offset)),
                                  self.decompress(self.pointer(offset + 4), 32), 24, 24)
        if kind == 'badges' and key.isdecimal() and 0 <= int(key) < 8:
            tiles = self.decompress(layout['badges'])
            index = int(key)
            # The 128×16 sheet has two rows of sixteen 8×8 tiles.
            selected = tiles[index*64:index*64+64] + tiles[512+index*64:512+index*64+64]
            return self.tiles_png(selected, self.read(layout['badge_palette'], 32), 16, 16)
        if kind == 'badges' and key == 'all':
            return self.tiles_png(self.decompress(layout['badges']), self.read(layout['badge_palette'], 32), 128, 16)
        if kind == 'category' and key in layout.get('categories', {}):
            tiles, palette = layout['categories'][key]
            return self.tiles_png(self.decompress(tiles), self.read(palette, 32), 64, 48)
        raise ValueError('This artwork is not in the selected ROM.')


class RomArtwork:
    def __init__(self, directory, static):
        self.directory = Path(directory)
        self.static = Path(static)
        self.lock = threading.RLock()
        self.readers = OrderedDict()
        self.images = OrderedDict()
        self._checks = queue.Queue()
        self._pending = set()
        self._statuses = {}
        self._workers_started = False

    def snapshot(self, games):
        """Never block the library or game controls on cartridge I/O or macOS
        permission prompts. The explicit asset request still validates its ROM.
        Workers are daemon threads so a disconnected drive cannot prevent quit.
        """
        with self.lock:
            if not self._workers_started:
                self._workers_started = True
                for _ in range(3): threading.Thread(target=self._check_artwork, daemon=True).start()
            result = {}
            for game in games:
                checked, value = self._statuses.get(game, (0, {'game':game, 'artwork':'checking', 'assets':[], 'message':'Checking your local ROM…'}))
                result[game] = value
                if game not in self._pending and time.monotonic()-checked >= 2:
                    self._pending.add(game); self._checks.put(game)
            return result

    def _check_artwork(self):
        while True:
            game = self._checks.get()
            try:
                value = self.status(game)
                with self.lock: self._statuses[game] = (time.monotonic(), value)
            finally:
                with self.lock: self._pending.discard(game)
                self._checks.task_done()

    def reader(self, game):
        from .cartridge_graphics import CartridgeSource, CartridgeIcon
        if game not in MAIN_GAMES: raise ValueError('Unknown main-series game.')
        config = json.loads((self.directory / 'config.json').read_text())
        entry = config.get('games', {}).get(game, {})
        source = (entry.get('cartridge', {}).get('path') or entry.get('inputs', {}).get('rom')
                  or config.get('library', {}).get(game, {}).get('source'))
        if not source: raise ValueError('Add this game ROM to load its artwork.')
        path = Path(source).expanduser()
        stat = path.stat()
        if not path.is_file(): raise ValueError('The configured ROM is not a file.')
        platform = MAIN_GAMES[game]['platform']
        if platform not in {'gba', 'nds', '3ds'} and game != 'crystal':
            raise ValueError('Artwork extraction for this platform is not yet supported.')
        key = (game, str(path.resolve()), stat.st_ino, stat.st_size, stat.st_mtime_ns, stat.st_ctime_ns)
        with self.lock: cached = self.readers.get(key)
        if cached is None:
            try:
                with CartridgeSource(path, platform) as source:
                    if game == 'crystal':
                        from .crystal_graphics import CrystalArtwork
                        reader = CrystalArtwork(source.read(0, source.size))
                    else:
                        reader = GbaArtwork(source.read(0, source.size)) if platform == 'gba' else CartridgeIcon(source, platform)
                if reader.game != game: raise ValueError('The ROM does not match the selected game.')
                cached = reader
            except (ValueError, OSError, zipfile.BadZipFile, RuntimeError, zlib.error, EOFError, NotImplementedError) as error:
                cached = str(error)
        with self.lock:
            self.readers[key] = cached
            self.readers.move_to_end(key)
            while len(self.readers) > 32 or sum(len(getattr(r, 'data', b'')) for r in self.readers.values()) > 160 * 1024 * 1024:
                self.readers.popitem(last=False)
        if isinstance(cached, str): raise ValueError(cached)
        return cached

    def status(self, game):
        try:
            reader = self.reader(game)
            return {'game': game, 'artwork': 'local-rom', 'sha256': reader.sha256,
                    'fingerprint': reader.fingerprint, 'assets': reader.assets,
                    'message': 'Artwork read from your local ROM.' if 'pokemon' in reader.assets else 'Game mascot and native launcher icon read from your ROM.' if 'mascot' in reader.assets else 'Native game icon available. Pokémon and item graphics are not yet supported.'}
        except (OSError, ValueError, KeyError) as error:
            return {'game': game, 'artwork': 'unavailable',
                    'assets': [], 'message': str(error) if not isinstance(error, OSError) else 'The ROM is unavailable. Reconnect its drive or choose its folder again.'}

    def catalog(self, game):
        if game not in {'firered', 'leafgreen', 'emerald', 'crystal'}: raise ValueError('Unknown Pokédex.')
        from .data_provider import read_data
        catalog = read_data('pokedex/'+game+'.json',game)
        # Game prose is not supplied by the software. Factual catalogs remain usable
        # before a ROM is installed; all visual resources use the local reader.
        def facts(value):
            if isinstance(value, dict):
                return {key: facts(item) for key, item in value.items()
                        if key not in {'description', 'genus', 'flavorText', 'flavor_text', 'flavor_text_entries'}}
            if isinstance(value, list): return [facts(item) for item in value]
            return value
        catalog = facts(catalog)
        catalog.update(self.snapshot([game])[game])
        for species in catalog.get('species', []):
            base = f'api/rom-art/{game}/pokemon/{species["id"]}.png'
            species['sprite'] = base
            species['shinySprite'] = base + '?shiny=1'
        return catalog

    def image(self, game, kind, key, shiny=False, back=False):
        reader = self.reader(game)
        with self.lock:
            cache_key = (reader.fingerprint, kind, key, shiny, back)
            if cache_key not in self.images:
                if kind == 'pokemon' and key.isdecimal():
                    if 'pokemon' not in reader.assets: raise ValueError('Pokémon graphics for this platform are not yet supported.')
                    catalog_game = 'firered' if game in {'ruby', 'sapphire'} else game
                    species = json.loads((self.static / 'data/pokedex' / (catalog_game + '.json')).read_text())['species']
                    match = next((s for s in species if s['id'] == int(key)), None)
                    if match is None: raise ValueError('Unknown National Pokédex number.')
                    key = match['name']
                if kind == 'item' and not key.isdecimal():
                    items = json.loads((self.static / 'data/pokedex/firered-items.json').read_text())['items']
                    match = next((item for item in items if slug(item['name']) == slug(key)), None)
                    if match is None: raise ValueError('Unknown item.')
                    key = str(match['id'])
                self.images[cache_key] = reader.pokemon(key, shiny=shiny, back=back) if kind == 'pokemon' else reader.auxiliary(kind, key)
                while len(self.images) > 256: self.images.popitem(last=False)
            self.images.move_to_end(cache_key)
            return self.images[cache_key]


def artwork_request(path, selected='firered'):
    match = re.fullmatch(r'/api/rom-art/([a-z0-9-]+)/([a-z]+)/([a-z0-9-]+)\.png', path)
    if match and match[1] in MAIN_GAMES: return match.groups()
    match = re.fullmatch(r'/assets/pokedex/(firered|leafgreen|emerald|crystal)/(shiny/)?(\d+)\.png', path)
    if match: return match[1], 'pokemon', match[3], bool(match[2])
    match = re.fullmatch(r'/assets/firered/pokemon/([a-z0-9_-]+)-(front|back)(-shiny)?\.png', path)
    if match: return 'firered', 'pokemon', match[1], bool(match[3]), match[2] == 'back'
    match = re.fullmatch(r'/assets/pokemon/items/([a-z0-9_]+)\.png', path)
    if match: return selected, 'item', match[1]
    match = re.fullmatch(r'/assets/firered/ui/(red|leaf)-trainer\.png', path)
    if match: return 'firered', 'trainer', 'female' if match[1] == 'leaf' else 'male'
    if path in {'/assets/firered/ui/badges.png', '/assets/firered/ui/badges-transparent.png'}:
        return 'firered', 'badges', 'all'
    match = re.fullmatch(r'/assets/pokemon/ui/cat_icon_(abc|type|grassland|rare)\.png', path)
    if match: return selected, 'category', match[1]
    if path.startswith(('/assets/firered/', '/assets/pokedex/', '/assets/pokemon/items/', '/assets/pokemon/ui/')) and path.endswith(('.png', '.svg')):
        return selected, 'unavailable', 'unavailable'
    return None
