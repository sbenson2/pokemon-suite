"""FireRed bot resources shipped inside the Mac app; the user supplies only the ROM.

The pack is the pinned mGBA WASM core and the game knowledge the bot plans with
(runtime symbols, world structure, story scripts and battle data), extracted
from pret/pokefirered c75f3523 for FireRed US revision 1. It holds no ROM
bytes, artwork, text or saves. Every file is pinned here: a changed, missing,
extra or linked file is refused before intake copies anything.
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


def verify_pack(folder):
    folder=Path(folder)
    if folder.is_symlink() or not folder.is_dir():raise ValueError('The FireRed bot resources are missing.')
    found=set()
    for path in folder.rglob('*'):
        name=path.relative_to(folder).as_posix()
        if path.is_symlink():raise ValueError('The FireRed bot resources contain a link: '+name)
        if path.is_file():found.add(name)
    if found!=set(FIRERED_FILES):
        difference=sorted(found^set(FIRERED_FILES))
        raise ValueError('The FireRed bot resources do not match this version: '+', '.join(difference[:5]))
    for name,expected in FIRERED_FILES.items():
        if hashlib.sha256((folder/name).read_bytes()).hexdigest()!=expected:
            raise ValueError('The FireRed bot resource checksum did not match: '+name)
    return folder


def bundled_firered(environ=None):
    value=(os.environ if environ is None else environ).get(ENVIRONMENT,'')
    if not value:
        raise ValueError('This copy of Pokémon Suite does not include the FireRed bot resources. '
                         'Choose a bot resource folder, or use the Mac app.')
    return Path(value)/'firered'
