"""Validated intake into Suite-owned resources; no developer save is required."""
import hashlib
import json
from pathlib import Path
import shutil
import uuid

from .bootstrap import initialize
from . import game_resources
from .suite_save_store import atomic_file

FIRERED_SHA1='dd5945db9b930750cb39d00c84da8571feebf417'
# LeafGreen US revision 1: pret leafgreen_rev1.sha1 (build 124).
LEAFGREEN_SHA1='7862c67bdecbe21d1d69ce082ce34327e1c6ed5e'
# The FRLG bot cartridges share one intake. Each has its own verified image,
# pinned pack, config key and default port.
FRLG={'firered':{'title':'FireRed','cartridge':'firered-rev1','release':'pokemon-firered-suite','port':17639},
      'leafgreen':{'title':'LeafGreen','cartridge':'leafgreen-rev1','release':'pokemon-leafgreen-suite','port':17640}}


def _verified_sha1(game):
    # Read at call time: the module constants are the one reviewed source.
    return {'firered':FIRERED_SHA1,'leafgreen':LEAFGREEN_SHA1}[game]


def install_firered(directory, rom, resources=None, port=17639):
    # Without a resource folder, the Mac app's bundled pack is used.
    return _install_frlg('firered',directory,rom,resources,port)


def install_leafgreen(directory, rom, resources=None, port=None):
    return _install_frlg('leafgreen',directory,rom,resources,port)


def install_frlg(directory, rom, resources=None, port=None):
    """The one Add flow: the verified image itself says which game it is."""
    rom=Path(rom).expanduser().resolve()
    if not rom.is_file() or rom.stat().st_size>32*1024*1024:raise ValueError('Choose a raw verified FireRed or LeafGreen game image, up to 32 MiB.')
    digest=hashlib.sha1(rom.read_bytes()).hexdigest()
    game=next((g for g in FRLG if digest==_verified_sha1(g)),None)
    if game is None:raise ValueError('This bot requires the verified FireRed or LeafGreen US revision 1 cartridge. The selected image does not match.')
    return _install_frlg(game,directory,rom,resources,port)


def _manual_entry_to_replace(game, directory, existing, rom):
    """A never-played manual-play entry of this exact cartridge may become the bot profile.

    Manual play (libretro) keeps a different save store in <directory>/<game>;
    once it holds anything, the entry and its saves are preserved untouched.
    """
    if game!='leafgreen' or not existing.exists():return None
    entry=json.loads(existing.read_text()).get('games',{}).get(game)
    if not isinstance(entry,dict) or entry.get('backend')!='libretro':return None
    if not rom.is_file() or (entry.get('cartridge') or {}).get('sha256')!=hashlib.sha256(rom.read_bytes()).hexdigest():return None
    folder=directory/game
    if folder.exists() and any(folder.iterdir()):
        raise ValueError('LeafGreen already has manual-play saves. They are preserved; this library keeps LeafGreen for manual play.')
    return entry


def _install_frlg(game, directory, rom, resources, port):
    spec=FRLG[game];title=spec['title']
    directory=Path(directory).expanduser().resolve()
    rom=Path(rom).expanduser().resolve()
    existing=directory/'config.json'
    replacing=_manual_entry_to_replace(game,directory,existing,rom)
    if replacing is None and existing.exists() and game in json.loads(existing.read_text()).get('games',{}):
        raise ValueError(f'{title} is already configured. Its current profile has been preserved.')
    if port is None and replacing is not None and type(replacing.get('port')) is int:port=replacing['port']
    automatic=port is None
    port=spec['port'] if automatic else port
    if type(port) is not int or not 1024<=port<=65535:raise ValueError('Choose a game port between 1024 and 65535.')
    if not rom.is_file() or rom.stat().st_size>32*1024*1024:raise ValueError(f'Choose a raw verified {title} game image, up to 32 MiB.')
    digest=hashlib.sha1(rom.read_bytes()).hexdigest()
    if digest!=_verified_sha1(game):raise ValueError(f'This bot requires the verified {title} US revision 1 cartridge. The selected image does not match.')
    if resources is None:
        resources=game_resources.bundled_pack(game)
        try:game_resources.verify_pack(resources,game)
        except ValueError as error:raise ValueError(f'{error} Reinstall Pokémon Suite.') from None
    else:resources=Path(resources).expanduser().resolve()
    manifest=json.loads((resources/'core/build-manifest.json').read_text())
    for filename,key in [('mgba.js','mgba_js_sha256'),('mgba.wasm','mgba_wasm_sha256')]:
        if hashlib.sha256((resources/'core'/filename).read_bytes()).hexdigest()!=manifest.get(key):
            raise ValueError('The emulator resource checksum did not match: '+filename)
    for key in ['runtime','world','story','battle']:
        if not isinstance(json.loads((resources/(key+'.json')).read_text()),dict):raise ValueError('Invalid bot knowledge file: '+key)
    config=initialize(directory)
    others={name:cfg for name,cfg in config['games'].items() if not (replacing is not None and name==game)}
    if automatic:
        while any(cfg.get('port')==port for cfg in others.values()) and port<65535:port+=1
    if any(cfg.get('port')==port for cfg in others.values()):raise ValueError('This port is already assigned to another game.')
    asset=directory/'resources'/(game+'-'+uuid.uuid4().hex)
    (asset/'core').mkdir(parents=True)
    try:
        for name in ['build-manifest.json','mgba.js','mgba.wasm']:shutil.copyfile(resources/'core'/name,asset/'core'/name)
        target=asset/'cartridge.gba';shutil.copyfile(rom,target)
        inputs={'rom':str(target),'core':str(asset/'core')}
        for key in ['runtime','world','story','battle']:
            shutil.copyfile(resources/(key+'.json'),asset/(key+'.json'));inputs[key]=str(asset/(key+'.json'))
        config['games'][game]={'cartridge':{'id':spec['cartridge'],'path':str(target),'bytes':target.stat().st_size,'sha1':digest},
            'core':str(asset/'core'),'inputs':inputs,'port':port,'release':spec['release']}
        atomic_file(existing,(json.dumps(config,indent=2)+'\n').encode())
    except Exception:
        shutil.rmtree(asset);raise
    return {'ok':True,'game':game,'message':f'{title} is installed. First launch creates a new save.'}
