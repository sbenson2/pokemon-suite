"""FRLG bot resources shipped inside the Mac app; the user supplies only the ROM.

Each pack is the pinned mGBA WASM core and the game knowledge the bot plans with
(runtime symbols, world structure, story scripts and battle data), extracted
from pret/pokefirered c75f3523: FireRed from its firered_rev1 build and
LeafGreen from its leafgreen_rev1 build of the same source. Both packs use the
same core. They hold no ROM bytes, artwork, text or saves. Every file is pinned
here: a changed, missing, extra or linked file is refused before intake copies
anything.
"""
import hashlib
import os
from pathlib import Path

ENVIRONMENT='POKEMON_SUITE_GAME_RESOURCES'
FIRERED_FILES={
    'core/build-manifest.json':'c12f752a52285ae43418de15eba338a500d922887f0b132084ff557732c44693',
    'core/mgba.js':'b2ff314b6777105c3665a44e4dbf26c09ac252ecaca6f1fbb49bb050d206754e',
    'core/mgba.wasm':'297047c0852e2f05eb44b190b0a08134d5e74473ac3ece84277601a8e572e8e4',
    'runtime.json':'b5920926b32059c715de21eaa72e43c09931ecf9b5fdeac2563b9e204a920346',
    'world.json':'d70e4eeda26b6784939973bbac2f5cae0d04a12f1cb6bff6659479ad7e12f41b',
    'story.json':'eff9c5db923d8ec4f0b1b8896a85d4551f2a58cebc9415b4c8e9937596740c77',
    'battle.json':'b61618b0ec5ae9921e4c82f4cbcc060aa4095e07c060c7f478c754624baf68a0',
}
# LeafGreen US revision 1 (pret `make leafgreen_rev1`, SHA-1 7862c67b…). Same
# core as FireRed; its own symbols and wild tables. Story and battle data are
# the same source facts as FireRed's, in LeafGreen-named envelopes.
LEAFGREEN_FILES={
    'core/build-manifest.json':'c12f752a52285ae43418de15eba338a500d922887f0b132084ff557732c44693',
    'core/mgba.js':'b2ff314b6777105c3665a44e4dbf26c09ac252ecaca6f1fbb49bb050d206754e',
    'core/mgba.wasm':'297047c0852e2f05eb44b190b0a08134d5e74473ac3ece84277601a8e572e8e4',
    'runtime.json':'ad727e752299800f4157190440d4644006aa418a438bb023692cabfe3dc96ee3',
    'world.json':'6661188c838143e856a9c6e8f0a2c7663df8b7731971fa0f05112ad653ef37bb',
    'story.json':'22294f4924e38baec22de2ba5a7973376048df177190710666eedcd6a7b0d30a',
    'battle.json':'8ee851823e66a11d4587f3874c922d4794ebb4aedff56d2f6e33616aec6ad005',
}
TITLES={'firered':'FireRed','leafgreen':'LeafGreen'}


def pinned_files(game='firered'):
    # Read at call time, so each version's pins stay the one source of truth.
    if game not in TITLES:raise ValueError('Only FireRed and LeafGreen have bot resources.')
    return globals()[game.upper()+'_FILES']


def verify_pack(folder, game='firered'):
    files=pinned_files(game);title=TITLES[game]
    folder=Path(folder)
    if folder.is_symlink() or not folder.is_dir():raise ValueError(f'The {title} bot resources are missing.')
    found=set()
    for path in folder.rglob('*'):
        name=path.relative_to(folder).as_posix()
        if path.is_symlink():raise ValueError(f'The {title} bot resources contain a link: '+name)
        if path.is_file():found.add(name)
    if found!=set(files):
        difference=sorted(found^set(files))
        raise ValueError(f'The {title} bot resources do not match this version: '+', '.join(difference[:5]))
    for name,expected in files.items():
        if hashlib.sha256((folder/name).read_bytes()).hexdigest()!=expected:
            raise ValueError(f'The {title} bot resource checksum did not match: '+name)
    return folder


def bundled_pack(game, environ=None):
    pinned_files(game)
    value=(os.environ if environ is None else environ).get(ENVIRONMENT,'')
    if not value:
        raise ValueError(f'This copy of Pokémon Suite does not include the {TITLES[game]} bot resources. '
                         'Choose a bot resource folder, or use the Mac app.')
    return Path(value)/game


def bundled_firered(environ=None):
    return bundled_pack('firered',environ)


def bundled_leafgreen(environ=None):
    return bundled_pack('leafgreen',environ)
