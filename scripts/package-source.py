"""Export the reviewed public source tree without modifying development resources."""
import argparse
import hashlib
import json
import os
from pathlib import Path, PurePosixPath
import tempfile
import zipfile

ROOTS=('pokemon_suite','engine/firered/src','engine/firered/test','engine/firered/test-support',
       'engine/firered/research','engine/shared/shared','engine/shared/games','native','macos','scripts','tests','docs','licenses','.github')
FILES=('LICENSE','README.md','SECURITY.md','THIRD_PARTY_NOTICES.md','DATA_SOURCES.md','package.json','.gitignore',
       'engine/firered/package.json','engine/shared/package.json')
DENIED={'.git','.local','.private','private','__pycache__','node_modules','bin','obj'}
EXTENSIONS={'.gba','.gb','.gbc','.nds','.3ds','.cia','.nsp','.xci','.sav','.state','.keys','.pyc','.log',
            '.bin','.inc','.sym','.mp4','.wasm','.dll','.dylib','.so','.exe','.rom','.bios','.zip','.7z','.srm','.rtc','.gz','.app','.icns'}
EXCLUDED=('macos/Runtime/','macos/cache/','engine/shared/vendor/','pokemon_suite/static/assets/firered/','pokemon_suite/static/assets/pokedex/',
          'pokemon_suite/static/assets/pokemon/items/','pokemon_suite/static/assets/pokemon/ui/',
          'pokemon_suite/static/assets/pokemon/console-startup/','docs/release-audit/')
EXCLUDED_FILES={'docs/source-extraction.json','scripts/extract-source.py',
                'pokemon_suite/static/assets/pokemon/hardware/gba-front.svg',
                'pokemon_suite/static/assets/pokemon/hardware/gbc-front.svg'}
PHOTOS={'gb-photo.png','gb-pocket-photo.png','gb-light-photo.png','gbc-photo.png','gba-photo.png','gba-sp-photo.png','gb-micro-photo.png'}
CATALOGS={'pokemon_suite/static/data/pokedex/'+game+'.json' for game in ('firered','leafgreen','emerald','crystal')}
MANIFEST='release/manifest.json'


def digest(data):
    return hashlib.sha256(data).hexdigest()


def eligible(name):
    path=PurePosixPath(name)
    if path.is_absolute() or '..' in path.parts or '\\' in name or name!=path.as_posix():return False
    if any(part in DENIED or (part.startswith('.') and part not in {'.github','.gitignore'}) for part in path.parts):return False
    if name in EXCLUDED_FILES or name.startswith(EXCLUDED) or path.suffix.lower() in EXTENSIONS:return False
    readme_image=path.parent.as_posix()=='docs/images' and path.suffix.lower() in {'.png','.gif'}
    if path.suffix.lower()=='.png' and not readme_image and not (name.startswith('pokemon_suite/static/assets/pokemon/hardware/') and path.name in PHOTOS):return False
    return name in FILES or any(name.startswith(folder+'/') for folder in ROOTS)


def candidates(root):
    paths={root/name for name in FILES}
    for directory in ROOTS:paths.update((root/directory).rglob('*'))
    return {p.relative_to(root).as_posix() for p in paths if (p.is_file() or p.is_symlink()) and eligible(p.relative_to(root).as_posix())}


def public_content(name, data):
    if name in CATALOGS:
        def facts(value):
            if isinstance(value,dict):return {k:facts(v) for k,v in value.items() if k not in {'description','genus','flavorText','flavor_text','flavor_text_entries'}}
            if isinstance(value,list):return [facts(v) for v in value]
            return value
        catalog=facts(json.loads(data));catalog.pop('revision',None)
        catalog['artwork']='local-rom-required'
        game=PurePosixPath(name).stem
        for species in catalog.get('species',[]):
            base=f'api/rom-art/{game}/pokemon/{species["id"]}.png'
            if 'sprite' in species:species['sprite']=base
            if 'shinySprite' in species:species['shinySprite']=base+'?shiny=1'
        catalog['revision']='facts-'+digest(json.dumps(catalog,sort_keys=True,separators=(',',':')).encode())[:20]
        return (json.dumps(catalog,ensure_ascii=False,separators=(',',':'))+'\n').encode()
    if name=='pokemon_suite/static/data/champions.json':
        return (json.dumps({'schema':'pokemon-suite/champions-recommendations/v1','availability':'not-bundled',
                            'revision':'custom-requests-v1','presets':[]},sort_keys=True)+'\n').encode()
    return data


def reviewed_files(root):
    path=root/MANIFEST
    if not path.is_file() or path.is_symlink():raise ValueError('Missing reviewed release manifest.')
    ledger=json.loads(path.read_text())
    if ledger.get('schema')!='pokemon-suite/release-files/v1':raise ValueError('Unknown release manifest schema.')
    files={};entries=ledger.get('files',[])
    for entry in entries:
        name=entry['path'];p=root/name
        if not eligible(name):raise ValueError('Release manifest contains an excluded or restricted file: '+name)
        if name in files:raise ValueError('Duplicate release manifest path: '+name)
        if any((root/Path(*PurePosixPath(name).parts[:i])).is_symlink() for i in range(1,len(PurePosixPath(name).parts)+1)):
            raise ValueError('Release source must not be a symlink: '+name)
        if not p.is_file():raise ValueError('Missing reviewed file: '+name)
        raw=p.read_bytes()
        if digest(raw)!=entry['sha256']:raise ValueError('File changed since release review: '+name)
        files[name]=public_content(name,raw)
    unknown=candidates(root)-set(files)
    if unknown:raise ValueError('Unreviewed release files: '+', '.join(sorted(unknown)))
    if 'LICENSE' not in files:raise ValueError('The reviewed release must include LICENSE.')
    files[MANIFEST]=(json.dumps({'schema':ledger['schema'],'files':[
        {'path':name,'sha256':digest(data)} for name,data in sorted(files.items())]},indent=2)+'\n').encode()
    return files


def package_source(root,target):
    root=Path(root).resolve();target=Path(target).resolve()
    if target.suffix.lower()!='.zip':raise ValueError('Choose a ZIP output path.')
    files=reviewed_files(root)
    target.parent.mkdir(parents=True,exist_ok=True)
    manifest=[]
    descriptor,temporary=tempfile.mkstemp(prefix='suite-source-',suffix='.zip',dir=target.parent);os.close(descriptor)
    checksum=target.with_suffix(target.suffix+'.sha256')
    checksum_temporary=None
    try:
        with zipfile.ZipFile(temporary,'w',zipfile.ZIP_DEFLATED,compresslevel=6) as archive:
            for name,data in sorted(files.items()):
                archive.writestr('pokemon-suite/'+name,data)
                manifest.append({'path':name,'bytes':len(data),'sha256':digest(data)})
            archive.writestr('pokemon-suite/PACKAGE-MANIFEST.json',json.dumps(manifest,indent=2)+'\n')
        sha256=digest(Path(temporary).read_bytes())
        descriptor,checksum_temporary=tempfile.mkstemp(prefix='suite-checksum-',dir=target.parent)
        with os.fdopen(descriptor,'w') as stream:
            stream.write(sha256+'  '+target.name+'\n')
        os.replace(temporary,target)
        os.replace(checksum_temporary,checksum)
    finally:
        if os.path.exists(temporary):os.unlink(temporary)
        if checksum_temporary and os.path.exists(checksum_temporary):os.unlink(checksum_temporary)
    return {'archive':str(target),'checksum':str(checksum),'files':len(manifest),'bytes':target.stat().st_size,'sha256':sha256}


if __name__=='__main__':
    parser=argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--output',type=Path,default=Path('dist/pokemon-suite-0.1.0-rc.6-source.zip'))
    args=parser.parse_args()
    try:print(json.dumps(package_source(Path(__file__).resolve().parents[1],args.output),indent=2))
    except (ValueError,OSError,KeyError) as error:parser.exit(1,str(error)+'\n')
