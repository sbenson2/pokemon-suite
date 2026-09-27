"""Bounded local cartridge input and native DS/3DS launcher icons.

No extraction to disk, keys, external image service, or emulator dependency.
Large cartridges are read by range; their fingerprint covers the decoded icon
and identifying header, and is deliberately not called a whole-ROM checksum.
"""
from contextlib import ExitStack
import hashlib
from pathlib import Path
import struct
import zipfile

from .pokemon_main_series import MAIN_GAMES
from .rom_art import GbaArtwork, png


class CartridgeSource:
    def __init__(self, path, platform):
        self.path = Path(path)
        self.platform = platform
        self.stack = ExitStack()

    def __enter__(self):
        extensions = {'.3ds', '.cci'} if self.platform == '3ds' else {'.'+self.platform}
        limit = {'gb': 8, 'gbc': 8, 'gba': 32, 'nds': 512, '3ds': 8192}[self.platform] * 1024 * 1024
        try:
            if self.path.suffix.lower() == '.zip':
                archive = self.stack.enter_context(zipfile.ZipFile(self.path))
                members = [m for m in archive.infolist() if not m.is_dir()
                           and not any(p.startswith(('._', '__MACOSX')) for p in Path(m.filename).parts)
                           and Path(m.filename).suffix.lower() in extensions]
                if len(members) != 1: raise ValueError('Choose an archive containing exactly one game ROM.')
                self.size = members[0].file_size
                if not 0 < self.size <= limit: raise ValueError('Cartridge size is outside the supported range.')
                self.stream = self.stack.enter_context(archive.open(members[0]))
                self.zipped = True
            else:
                if self.path.suffix.lower() not in extensions: raise ValueError('Use a raw cartridge or a ZIP containing one ROM.')
                self.stream = self.stack.enter_context(self.path.open('rb'))
                self.size = self.path.stat().st_size
                if not 0 < self.size <= limit: raise ValueError('Cartridge size is outside the supported range.')
                self.zipped = False
            return self
        except Exception:
            self.stack.close()
            raise

    def __exit__(self, *args):
        return self.stack.__exit__(*args)

    def read(self, offset, count, *, limit=32 * 1024 * 1024):
        if offset < 0 or count < 0 or offset + count > self.size:
            raise ValueError('Artwork points outside the cartridge.')
        # ZIP seek inflates preceding bytes. Refuse unbounded work on a corrupt
        # header; retail launcher metadata is near the start of these images.
        if self.zipped and offset + count > limit:
            raise ValueError('This archive’s artwork requires a raw cartridge for bounded access.')
        self.stream.seek(offset)
        data = self.stream.read(count)
        if len(data) != count: raise ValueError('Incomplete cartridge artwork.')
        return data


PRODUCTS_3DS = {'EKJ': 'x', 'EK2': 'y', 'ECR': 'omega-ruby', 'ECL': 'alpha-sapphire',
                'BND': 'sun', 'BNE': 'moon', 'A2A': 'ultra-sun', 'A2B': 'ultra-moon'}


class CartridgeIcon:
    assets = ['game']
    sha256 = None

    def __init__(self, source, platform):
        self.assets = ['game']
        self.mascot = None
        header = source.read(0, 512)
        if platform == 'nds':
            self.game = next((g for g, d in MAIN_GAMES.items() if d['platform'] == 'nds'
                              and d['header'].encode() == header[12:16]), None)
            if not self.game: raise ValueError('Unrecognized DS cartridge identity.')
            offset = struct.unpack_from('<I', header, 0x68)[0]
            banner = source.read(offset, 0x240)
            if offset < 512 or struct.unpack_from('<H', banner)[0] not in {1, 2, 3, 0x103}:
                raise ValueError('Unsupported DS banner format.')
            self.icon = GbaArtwork.tiles_png(None, banner[0x20:0x220], banner[0x220:0x240], 32, 32)
            # A malformed or unfamiliar battle archive must not hide the
            # otherwise usable launcher icon. Coverage remains explicit.
            from .ds_mascot import load_mascot
            try:
                self.mascot = load_mascot(source, self.game)
                self.assets.append('mascot')
            except (ValueError, OSError, struct.error):
                pass
        else:
            if header[0x100:0x104] != b'NCSD': raise ValueError('A decrypted NCSD cartridge is required for its icon.')
            partition, sectors = struct.unpack_from('<II', header, 0x120)
            base, partition_size = partition * 512, sectors * 512
            if base < 512 or partition_size < 512 or base + partition_size > source.size:
                raise ValueError('Invalid 3DS cartridge partition.')
            ncch = source.read(base, 512)
            if ncch[0x100:0x104] != b'NCCH': raise ValueError('The 3DS application partition is missing.')
            if not ncch[0x18f] & 4: raise ValueError('This 3DS cartridge is encrypted; its artwork cannot be read by this reader.')
            product = ncch[0x150:0x160].rstrip(b'\0').decode('ascii', errors='replace')
            self.game = PRODUCTS_3DS.get(product[6:9]) if product.startswith('CTR-P-') else None
            if not self.game: raise ValueError('Unrecognized 3DS cartridge identity.')
            exefs_sector, exefs_sectors = struct.unpack_from('<II', ncch, 0x1a0)
            exefs, exefs_size = exefs_sector * 512, exefs_sectors * 512
            if exefs < 512 or exefs_size < 512 or exefs + exefs_size > partition_size:
                raise ValueError('Invalid 3DS executable filesystem.')
            entries = source.read(base+exefs, 512)
            icons = [struct.unpack_from('<II', entries, i*16+8) for i in range(10)
                     if entries[i*16:i*16+8].rstrip(b'\0') == b'icon']
            if len(icons) != 1: raise ValueError('The cartridge has no unique native icon.')
            offset, size = icons[0]
            if size < 0x36c0 or offset + 512 + size > exefs_size:
                raise ValueError('Invalid 3DS icon bounds.')
            smdh = source.read(base+exefs+512+offset, 0x36c0)
            if smdh[:4] != b'SMDH': raise ValueError('Unsupported 3DS icon format.')
            pixels = bytearray()
            for y in range(48):
                for x in range(48):
                    morton = sum(((x >> bit) & 1) << (2*bit) | ((y >> bit) & 1) << (2*bit+1) for bit in range(3))
                    index = ((y//8)*6+x//8)*64 + morton
                    value = struct.unpack_from('<H', smdh, 0x24c0+index*2)[0]
                    r, g, b = value >> 11, (value >> 5) & 63, value & 31
                    pixels.extend((r*255//31, g*255//63, b*255//31, 255))
            self.icon = png(48, 48, pixels)
            header += ncch
        self.fingerprint = hashlib.sha256(header + self.icon + (self.mascot or b'')).hexdigest()

    def auxiliary(self, kind, key):
        if (kind, key) == ('mascot', 'front') and self.mascot: return self.mascot
        if (kind, key) != ('game', 'icon'): raise ValueError('Only the cartridge’s native game icon is supported for this platform.')
        return self.icon

    def pokemon(self, *args, **kwargs):
        raise ValueError('Pokémon graphics for this platform are not yet supported.')
