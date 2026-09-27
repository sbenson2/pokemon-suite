"""Main-series identities. Playback, game data and bot qualification are separate."""
from contextlib import closing
import hashlib
import os
import re
from pathlib import Path
import tempfile
import zipfile

_GROUPS = [
    ('gb', 1, 'Kanto', [('red','Red','POKEMON RED'),('blue','Blue','POKEMON BLUE'),('yellow','Yellow','POKEMON YELLOW')]),
    ('gb', 1, 'Kanto', [('green','Green (Japan)','POKEMON GREEN')]),
    ('gbc', 2, 'Johto', [('gold','Gold','POKEMON_GLDAAUE'),('silver','Silver','POKEMON_SLVAAXE'),('crystal','Crystal','PM_CRYSTAL')]),
    ('gba', 3, 'Hoenn', [('ruby','Ruby','AXVE'),('sapphire','Sapphire','AXPE'),('emerald','Emerald','BPEE')]),
    ('gba', 3, 'Kanto', [('firered','FireRed','BPRE'),('leafgreen','LeafGreen','BPGE')]),
    ('nds', 4, 'Sinnoh', [('diamond','Diamond','ADAE'),('pearl','Pearl','APAE'),('platinum','Platinum','CPUE')]),
    ('nds', 4, 'Johto', [('heartgold','HeartGold','IPKE'),('soulsilver','SoulSilver','IPGE')]),
    ('nds', 5, 'Unova', [('black','Black','IRBO'),('white','White','IRAO'),('black2','Black 2','IREO'),('white2','White 2','IRDO')]),
    ('3ds', 6, 'Kalos', [('x','X',''),('y','Y','')]),
    ('3ds', 6, 'Hoenn', [('omega-ruby','Omega Ruby',''),('alpha-sapphire','Alpha Sapphire','')]),
    ('3ds', 7, 'Alola', [('sun','Sun',''),('moon','Moon',''),('ultra-sun','Ultra Sun',''),('ultra-moon','Ultra Moon','')]),
    ('switch', 7, 'Kanto', [('lets-go-pikachu',"Let’s Go, Pikachu!",''),('lets-go-eevee',"Let’s Go, Eevee!",'')]),
    ('switch', 8, 'Galar', [('sword','Sword',''),('shield','Shield','')]),
    ('switch', 8, 'Sinnoh', [('brilliant-diamond','Brilliant Diamond',''),('shining-pearl','Shining Pearl','')]),
    ('switch', 8, 'Hisui', [('legends-arceus','Legends: Arceus','')]),
    ('switch', 9, 'Paldea', [('scarlet','Scarlet',''),('violet','Violet','')]),
    ('switch', 9, 'Kalos', [('legends-za','Legends: Z-A','')]),
]
MAIN_GAMES = {game:dict(id=game, title='Pokémon '+label, label=label, platform=platform,
    generation=generation, region=region, header=header,
    engine='melonDS DS' if platform=='nds' else 'Azahar' if platform=='3ds' else 'Ryubing' if platform=='switch' else 'mGBA',
    screenLayout='dual-vertical' if platform in {'nds','3ds'} else 'single')
    for platform,generation,region,entries in _GROUPS for game,label,header in entries}

def scan_library(root):
    """Catalog base versions, preserving update/DLC association and alternate images."""
    root=Path(root)
    if not root.is_dir():raise ValueError('Library storage disconnected. The previous catalog and saves are preserved.')
    result={}
    normalize=lambda s:re.sub('[^a-z0-9]','',s.lower())
    for game,desc in MAIN_GAMES.items():
        folder=root/desc['platform']
        if not folder.is_dir():continue
        wanted=normalize(desc['label'].replace(' (Japan)','').replace('Legends: Z-A','Legends Z A'))
        for path in folder.rglob('*'):
            if not path.is_file() or path.name.startswith('._') or path.suffix.lower() not in {'.gb','.gbc','.gba','.nds','.3ds','.cci','.xci','.nsp','.nsz','.xcz','.zip','.7z'}:continue
            stem=normalize(re.split(r'[\[(]',path.stem)[0]).replace('pokemon','',1).replace('version','')
            if desc['platform']=='switch':
                # Some DLC filenames join the label and title ID without punctuation.
                match=re.search(r'0100[0-9a-fA-F]{12}',path.name)
                if not stem.startswith(wanted):continue
                rest=stem[len(wanted):]
                if rest and not (match or rest.startswith(('theisleofarmor','thecrowntundra'))):continue
                suffix=int(match[0][-3:],16) if match else 0
                kind='updates' if suffix==0x800 else 'dlc' if suffix else 'base'
            else:
                if stem not in {wanted,wanted+'specialpikachuedition'}:continue
                kind='base'
            entry=result.setdefault(game,{'images':[],'updates':[],'dlc':[]})
            item={'path':str(path),'bytes':path.stat().st_size,'modifiedAt':path.stat().st_mtime}
            entry['images' if kind=='base' else kind].append(item)
    # DLC alone does not mean the base game is present.
    for game in list(result):
        entry=result[game]
        if not entry['images']:del result[game];continue
        entry['images'].sort(key=lambda item:(Path(item['path']).suffix.lower() not in {'.xci','.3ds','.nds','.gba','.gbc','.gb'},item['path']))
        entry.update(source=entry['images'][0]['path'],bytes=entry['images'][0]['bytes'])
    return result


def describe_library(config, live_sessions=()):
    from .capabilities import game_features, legacy_capabilities
    live_by_game={x['game']:x for x in live_sessions if x.get('game')}
    result=[]
    for game, descriptor in MAIN_GAMES.items():
        cfg=config.get('games',{}).get(game); source=config.get('library',{}).get(game)
        ready=bool(cfg)
        features=game_features(game,descriptor,cfg,live_by_game.get(game))
        result.append({**{k:v for k,v in descriptor.items() if k!='header'},
            'cartridgeId':'pokemon-'+game, 'release':cfg.get('release') if cfg else None,
            'status':'installed' if ready else 'cataloged' if source else 'missing',
            'reason':None if ready else 'Emulator integration awaiting qualification.' if source else 'Game image not found in the library.',
            'imageCount':len(source.get('images',[])) if source else 0,'updateCount':len(source.get('updates',[])) if source else 0,'dlcCount':len(source.get('dlc',[])) if source else 0,
            'features':features, 'capabilities':legacy_capabilities(features)})
    return result


def prepare_image(game, source, cache):
    """Stream one ROM into a content-addressed cache; never extract archive paths."""
    if game not in MAIN_GAMES:raise ValueError('Unknown main-series game identity.')
    desc=MAIN_GAMES[game]; platform=desc['platform']; source=Path(source)
    if not source.is_file():raise ValueError('Game image missing or storage disconnected. The current save is unchanged.')
    if platform not in {'gb','gbc','gba','nds'}:raise ValueError('This platform needs its own qualified intake adapter.')
    limit=512*1024*1024 if platform=='nds' else 32*1024*1024
    extension='.'+platform
    archive=None
    if source.suffix.lower()=='.zip':
        archive=zipfile.ZipFile(source)
        members=[m for m in archive.infolist() if not m.is_dir() and Path(m.filename).suffix.lower()==extension]
        if len(members)!=1 or not 0<members[0].file_size<=limit:
            archive.close();raise ValueError('The archive must contain one bounded game image.')
        stream=archive.open(members[0])
    else:
        if source.suffix.lower()!=extension or not 0<source.stat().st_size<=limit:raise ValueError('Unsupported game image size or format.')
        stream=source.open('rb')
    temporary=None
    try:
        with closing(stream):
            header=stream.read(512); offset=12 if platform=='nds' else 172 if platform=='gba' else 308
            expected=desc['header'].encode()
            if not header[offset:offset+len(expected)]==expected:raise ValueError('Game image identity does not match the selected game.')
            cache=Path(cache);cache.mkdir(parents=True,exist_ok=True,mode=0o700)
            fd,temporary=tempfile.mkstemp(prefix='.intake-',dir=cache)
            digest=hashlib.sha256();size=0
            with os.fdopen(fd,'wb') as out:
                chunk=header
                while chunk:
                    size+=len(chunk)
                    if size>limit:raise ValueError('Game image exceeds the intake limit.')
                    digest.update(chunk);out.write(chunk);chunk=stream.read(1024*1024)
                out.flush();os.fsync(out.fileno())
            sha=digest.hexdigest();target=cache/(sha+extension)
            verified=False
            if target.exists():
                with target.open('rb') as existing:verified=hashlib.file_digest(existing,'sha256').hexdigest()==sha
            if verified:os.unlink(temporary)
            else:os.replace(temporary,target)
            temporary=None
            return {'path':str(target),'sha256':sha,'bytes':size,'source':str(source),'header':desc['header']}
    finally:
        if archive:archive.close()
        if temporary:os.unlink(temporary)
