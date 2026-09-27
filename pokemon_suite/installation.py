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


def install_firered(directory, rom, resources=None, port=17639):
    # Without a resource folder, the Mac app's bundled pack is used.
    directory=Path(directory).expanduser().resolve()
    rom=Path(rom).expanduser().resolve()
    existing=directory/'config.json'
    if existing.exists() and 'firered' in json.loads(existing.read_text()).get('games',{}):
        raise ValueError('FireRed is already configured. Its current profile has been preserved.')
    if type(port) is not int or not 1024<=port<=65535:raise ValueError('Choose a game port between 1024 and 65535.')
    if not rom.is_file() or rom.stat().st_size>32*1024*1024:raise ValueError('Choose a raw verified FireRed game image, up to 32 MiB.')
    digest=hashlib.sha1(rom.read_bytes()).hexdigest()
    if digest!=FIRERED_SHA1:raise ValueError('This bot requires the verified FireRed US revision 1 cartridge. The selected image does not match.')
    if resources is None:
        resources=game_resources.bundled_firered()
        try:game_resources.verify_pack(resources)
        except ValueError as error:raise ValueError(f'{error} Reinstall Pokémon Suite.') from None
    else:resources=Path(resources).expanduser().resolve()
    manifest=json.loads((resources/'core/build-manifest.json').read_text())
    for filename,key in [('mgba.js','mgba_js_sha256'),('mgba.wasm','mgba_wasm_sha256')]:
        if hashlib.sha256((resources/'core'/filename).read_bytes()).hexdigest()!=manifest.get(key):
            raise ValueError('The emulator resource checksum did not match: '+filename)
    for key in ['runtime','world','story','battle']:
        if not isinstance(json.loads((resources/(key+'.json')).read_text()),dict):raise ValueError('Invalid bot knowledge file: '+key)
    config=initialize(directory)
    if any(cfg.get('port')==port for cfg in config['games'].values()):raise ValueError('This port is already assigned to another game.')
    asset=directory/'resources'/('firered-'+uuid.uuid4().hex)
    (asset/'core').mkdir(parents=True)
    try:
        for name in ['build-manifest.json','mgba.js','mgba.wasm']:shutil.copyfile(resources/'core'/name,asset/'core'/name)
        target=asset/'cartridge.gba';shutil.copyfile(rom,target)
        inputs={'rom':str(target),'core':str(asset/'core')}
        for key in ['runtime','world','story','battle']:
            shutil.copyfile(resources/(key+'.json'),asset/(key+'.json'));inputs[key]=str(asset/(key+'.json'))
        config['games']['firered']={'cartridge':{'id':'firered-rev1','path':str(target),'bytes':target.stat().st_size,'sha1':digest},
            'core':str(asset/'core'),'inputs':inputs,'port':port,'release':'pokemon-firered-suite'}
        atomic_file(existing,(json.dumps(config,indent=2)+'\n').encode())
    except Exception:
        shutil.rmtree(asset);raise
    return {'ok':True,'game':'firered','message':'FireRed is installed. First launch creates a new save.'}
