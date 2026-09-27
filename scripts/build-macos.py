"""Build a self-contained macOS app from reviewed source and pinned runtimes."""
import argparse
import hashlib
import importlib.util
import json
import os
from pathlib import Path
import platform
import plistlib
import shutil
import subprocess
import tarfile
import tempfile
import urllib.request
import zipfile

ROOT = Path(__file__).resolve().parents[1]


def copy_radio_runtime(source,target,notices=None):
    import sys
    sys.path.insert(0,str(ROOT))
    from pokemon_suite.radio_appliance import verify_runtime
    source=Path(source);target=Path(target)
    if target.exists():raise ValueError('The radio destination already exists.')
    verify_runtime(source)
    manifest=json.loads((source/'radio-manifest.json').read_text())
    forbidden={'.keys','.sav','.srm','.gba','.gb','.gbc','.nds','.3ds','.nsp','.xci'}
    if any(Path(e['path']).suffix.lower() in forbidden for e in manifest['files']):
        raise ValueError('Console keys, games and saves cannot be bundled with the radio runtime.')
    target.mkdir(parents=True)
    for entry in manifest['files']:
        dest=target/entry['path'];dest.parent.mkdir(parents=True,exist_ok=True)
        shutil.copy2(source/entry['path'],dest)
    shutil.copy2(source/'radio-manifest.json',target/'radio-manifest.json')
    # Binary-distribution notices and the source offer ship beside the
    # verified runtime folder, which holds only its manifest's files.
    if notices is not None:shutil.copytree(notices,target.parent/'RadioHost-licenses')


def copy_game_resources(source,target):
    # The pinned FireRed pack: the user supplies only the ROM.
    import sys
    sys.path.insert(0,str(ROOT))
    from pokemon_suite.game_resources import FIRERED_FILES,verify_pack
    source=verify_pack(source);target=Path(target)
    if target.exists():raise ValueError('The game resources destination already exists.')
    for name in FIRERED_FILES:
        destination=target/'firered'/name;destination.parent.mkdir(parents=True,exist_ok=True)
        shutil.copyfile(source/name,destination)
    verify_pack(target/'firered')


def exporter():
    spec = importlib.util.spec_from_file_location('suite_export', ROOT/'scripts/package-source.py')
    module = importlib.util.module_from_spec(spec); spec.loader.exec_module(module)
    return module


def runtime_archive(entry, kind, cache):
    cache.mkdir(parents=True, exist_ok=True)
    suffix = '.whl' if entry['url'].endswith('.whl') else '.tar.gz'
    path = cache/f'{kind}-{entry["sha256"]}{suffix}'
    if not path.is_file():
        temporary = path.with_suffix('.download')
        try:
            with urllib.request.urlopen(entry['url'], timeout=60) as source, temporary.open('wb') as target:
                shutil.copyfileobj(source, target)
            if hashlib.sha256(temporary.read_bytes()).hexdigest() != entry['sha256']:
                raise ValueError(f'{kind} runtime checksum mismatch')
            temporary.replace(path)
        finally:
            temporary.unlink(missing_ok=True)
    if hashlib.sha256(path.read_bytes()).hexdigest() != entry['sha256']:
        raise ValueError(f'Cached {kind} runtime checksum mismatch')
    return path


def bundle_engine(files,target,proof,*,previous=None,version=None):
    from pokemon_suite.package_builder import build_package
    from pokemon_suite.packages import PackageStore,MAX_BYTES
    from pokemon_suite.bot_verification import file_inventory,require_bot_verification
    games=['firered','emerald','crystal']
    entrypoints={'worker':'engine/firered/src/suite/session-worker.js','researchBots':'engine/shared','campaignPlanner':'engine/firered/src/suite/campaign-run.js'}
    require_bot_verification({'kind':'engine','files':file_inventory(files),'verification':proof})
    if (previous is None)==(version is None):raise ValueError('Reuse an unchanged --engine-package or supply a new --engine-version.')
    if previous is not None:
        # Host/UI verification changes must not republish an immutable engine
        # version. Validate every byte against the reviewed current engine, then
        # retain the original capsule and its original verification receipt.
        with Path(previous).open('rb') as source:raw=source.read(MAX_BYTES+1)
        if len(raw)>MAX_BYTES:raise ValueError('Engine package exceeds the size limit.')
        checksum=hashlib.sha256(raw).hexdigest()
        with tempfile.TemporaryDirectory(prefix='suite-engine-reuse-') as directory:
            directory=Path(directory);capsule=directory/'engine.pksuite';capsule.write_bytes(raw)
            store=PackageStore(directory/'validation')
            receipt=store.install(capsule,verified_sha256=checksum,source='mac-build-input')
            manifest=store.verify(receipt['digest'])
            if manifest['id']!='suite-engine' or manifest['kind']!='engine' or sorted(manifest['games'])!=sorted(games) or manifest['entrypoints']!=entrypoints or sorted(manifest['files'],key=lambda e:e['path'])!=file_inventory(files):
                raise ValueError('The engine package differs from the reviewed engine. Build a new engine version.')
        with Path(target).open('xb') as destination:destination.write(raw)
        return {'path':str(target),'sha256':checksum,'digest':receipt['digest'],'manifest':manifest}
    return build_package(files,target,identifier='suite-engine',version=version,kind='engine',games=games,entrypoints=entrypoints,verification=proof)


def build(output, cache, arch, *, feed_url=None, public_key=None, signing_identity='-', radio_runtime=None, verification=None, engine_package=None, engine_version=None, firered_resources=None):
    if platform.system() != 'Darwin': raise ValueError('Build the Mac app on macOS with Xcode installed.')
    if arch != platform.machine(): raise ValueError('Build on the matching Mac architecture; cross-architecture builds are not qualified.')
    files = exporter().reviewed_files(ROOT)
    import sys
    sys.path.insert(0, str(ROOT))
    from pokemon_suite.bot_verification import verified_payload
    if verification is None:raise ValueError('Run scripts/verify-bot.py and supply --verification before building a bot update.')
    engine_files={p:b for p,b in files.items() if p.startswith(('engine/firered/src/','engine/shared/')) or p=='engine/firered/package.json'}
    proof=verified_payload(engine_files,files,json.loads(Path(verification).read_text()))
    if (engine_package is None)==(engine_version is None):raise ValueError('Reuse an unchanged --engine-package or supply a new --engine-version.')
    if firered_resources is None:raise ValueError('Supply --firered-resources: the app ships the pinned FireRed bot resources.')
    from pokemon_suite.game_resources import verify_pack
    verify_pack(firered_resources)
    lock = json.loads(files['macos/runtime-lock.json'])
    update_lock=json.loads(files['macos/update-runtime-lock.json'])[arch]
    if not isinstance(update_lock,list):raise ValueError(update_lock['reason'])
    update_archives=[runtime_archive(entry,entry['name'],cache) for entry in update_lock]
    archives = {kind: runtime_archive(lock[arch][kind], kind, cache) for kind in ('python', 'node', 'pillow')}
    output = output.resolve()
    if output.exists(): raise ValueError('Output already exists. Choose a new build folder to preserve the previous app.')
    subprocess.run(['swift', 'build', '-c', 'release', '--package-path', str(ROOT/'macos')], check=True)
    if exporter().reviewed_files(ROOT)!=files:raise ValueError('Source changed during the verified Mac build.')
    binary = ROOT/'macos/.build/release/PokemonSuite'
    output.parent.mkdir(parents=True, exist_ok=True)
    with tempfile.TemporaryDirectory(prefix='suite-mac-', dir=output.parent) as temporary:
        stage = Path(temporary); app = stage/'Pokémon Suite.app'; contents = app/'Contents'
        executable = contents/'MacOS'; executable.mkdir(parents=True)
        resources = contents/'Resources'; suite = resources/'Suite'; suite.mkdir(parents=True)
        for name, data in files.items():
            target = suite/name; target.parent.mkdir(parents=True, exist_ok=True); target.write_bytes(data)
        shutil.copy2(binary, executable/'PokemonSuite')
        framework=ROOT/'macos/.build/release/Sparkle.framework'
        if not framework.exists():raise ValueError('The pinned Sparkle framework is missing from the Swift build.')
        frameworks=contents/'Frameworks';frameworks.mkdir()
        subprocess.run(['ditto',str(framework),str(frameworks/'Sparkle.framework')],check=True)
        import sys
        sys.path.insert(0,str(ROOT))
        component=bundle_engine(engine_files,suite/'bundled-engine.pksuite',proof,previous=engine_package,version=engine_version)
        (suite/'bundled-engine.json').write_text(json.dumps({'sha256':component['sha256']}))
        runtime = resources/'Runtime'; runtime.mkdir()
        with tarfile.open(archives['python']) as archive:
            archive.extractall(runtime, filter='data')
        with tarfile.open(archives['node']) as archive:
            prefix = f'node-v{lock["nodeVersion"]}-darwin-{"arm64" if arch == "arm64" else "x64"}'
            for name in ('bin/node', 'LICENSE'):
                member = archive.getmember(prefix+'/'+name)
                if not member.isfile(): raise ValueError('Unexpected Node runtime archive entry.')
                target = runtime/'node'/name; target.parent.mkdir(parents=True, exist_ok=True)
                target.write_bytes(archive.extractfile(member).read()); target.chmod(0o755 if name == 'bin/node' else 0o644)
        with zipfile.ZipFile(archives['pillow']) as wheel:
            for name in wheel.namelist():
                if Path(name).is_absolute() or '..' in Path(name).parts:
                    raise ValueError('Invalid Pillow wheel path.')
            wheel.extractall(runtime/'python/lib/python3.13/site-packages')
        for archive_path in update_archives:
            with zipfile.ZipFile(archive_path) as wheel:
                if any(Path(n).is_absolute() or '..' in Path(n).parts for n in wheel.namelist()):raise ValueError('Invalid update library wheel path.')
                wheel.extractall(runtime/'python/lib/python3.13/site-packages')
        shutil.copytree(ROOT/'licenses/update-runtime',runtime/'update-licenses')
        shutil.copytree(ROOT/'licenses/python-runtime', runtime/'python-licenses')
        shutil.copy2(ROOT/'macos/runtime-lock.json', runtime/'runtime-lock.json')
        if radio_runtime:copy_radio_runtime(radio_runtime,runtime/'RadioHost',notices=ROOT/'licenses/radio/app')
        copy_game_resources(firered_resources,resources/'GameResources')
        shutil.copytree(ROOT/'licenses/mgba',resources/'GameResources/licenses/mgba')
        iconset = stage/'Suite.iconset'
        subprocess.run(['swift', str(ROOT/'macos/Assets/Icon.swift'), str(iconset)], check=True)
        subprocess.run(['iconutil', '-c', 'icns', str(iconset), '-o', str(resources/'Suite.icns')], check=True)
        info = {
            'CFBundleDevelopmentRegion': 'en', 'CFBundleExecutable': 'PokemonSuite',
            'CFBundleIdentifier': 'org.pokemonsuite.mac', 'CFBundleName': 'Pokémon Suite',
            'CFBundleDisplayName': 'Pokémon Suite', 'CFBundlePackageType': 'APPL',
            'CFBundleShortVersionString': '0.1.0', 'CFBundleVersion': '62',
            'NSRemovableVolumesUsageDescription': 'Read your selected game cartridges and their artwork from your ROM collection.',
            'NSMicrophoneUsageDescription': 'Hear the request you speak to the bot after you click the microphone in Ask the bot.',
            'NSSpeechRecognitionUsageDescription': 'Turn your spoken bot request into text on this Mac. Your voice is never sent to a server.',
            'CFBundleIconFile': 'Suite', 'LSMinimumSystemVersion': '14.0',
            'LSApplicationCategoryType': 'public.app-category.games',
            'NSHighResolutionCapable': True,
            'NSAppTransportSecurity': {'NSAllowsLocalNetworking': True},
            'NSHumanReadableCopyright': 'Pokémon Suite contributors. MIT licensed. Independent compatibility software.',
        }
        if feed_url or public_key:
            import base64
            from urllib.parse import urlsplit
            if not feed_url or urlsplit(feed_url).scheme!='https' or not public_key or len(base64.b64decode(public_key,validate=True))!=32:raise ValueError('App updates need an HTTPS feed and a 32-byte public Ed25519 key.')
            info.update(SUFeedURL=feed_url,SUPublicEDKey=public_key,SUEnableAutomaticChecks=True,SUAutomaticallyUpdate=False)
        (contents/'Info.plist').write_bytes(plistlib.dumps(info))
        magic = {b'\xcf\xfa\xed\xfe', b'\xce\xfa\xed\xfe', b'\xca\xfe\xba\xbe', b'\xca\xfe\xba\xbf'}
        for path in runtime.rglob('*'):
            if path.is_symlink() or not path.is_file(): continue
            with path.open('rb') as stream: is_macho = stream.read(4) in magic
            if is_macho:
                extra=[]
                if path==runtime/'RadioHost/bin/qemu-system-aarch64':
                    entitlement=stage/'radio-hypervisor.plist'
                    entitlement.write_bytes(plistlib.dumps({'com.apple.security.hypervisor':True}))
                    extra=['--entitlements',str(entitlement)]
                subprocess.run(['codesign', '--force', '--sign', signing_identity, '--timestamp=none', *extra, str(path)], check=True, stdout=subprocess.DEVNULL)
        if radio_runtime:
            radio_root=runtime/'RadioHost';radio_manifest=radio_root/'radio-manifest.json'
            manifest=json.loads(radio_manifest.read_text())
            for entry in manifest['files']:
                payload=(radio_root/entry['path']).read_bytes();entry.update(sha256=hashlib.sha256(payload).hexdigest(),bytes=len(payload))
            radio_manifest.write_text(json.dumps(manifest,indent=2)+'\n')
        for nested in sorted((frameworks/'Sparkle.framework').rglob('*.xpc'),key=lambda p:len(p.parts),reverse=True):
            subprocess.run(['codesign','--force','--sign',signing_identity,'--timestamp=none',str(nested)],check=True)
        subprocess.run(['codesign','--force','--sign',signing_identity,'--timestamp=none',str(frameworks/'Sparkle.framework')],check=True)
        subprocess.run(['codesign', '--force', '--sign', signing_identity, '--timestamp=none', str(app)], check=True)
        subprocess.run(['codesign', '--verify', '--deep', '--strict', str(app)], check=True)
        output.mkdir()
        shutil.move(str(app), output/app.name)
    app = output/'Pokémon Suite.app'
    archive = output/f'pokemon-suite-0.1.0-macos-{arch}.zip'
    subprocess.run(['ditto', '-c', '-k', '--sequesterRsrc', '--keepParent', str(app), str(archive)], check=True)
    sha = hashlib.sha256(archive.read_bytes()).hexdigest()
    archive.with_suffix('.zip.sha256').write_text(sha+'  '+archive.name+'\n')
    # The same pinned pack, for running from source (attached to the release).
    pack = output/'pokemon-suite-0.1.0-firered-resources.zip'
    subprocess.run(['ditto', '-c', '-k', '--norsrc', str(app/'Contents/Resources/GameResources'), str(pack)], check=True)
    pack.with_suffix('.zip.sha256').write_text(hashlib.sha256(pack.read_bytes()).hexdigest()+'  '+pack.name+'\n')
    result = {'app': str(app), 'archive': str(archive), 'sha256': sha, 'resources': str(pack), 'architecture': arch, 'signing': 'ad-hoc' if signing_identity=='-' else signing_identity, 'notarized': False}
    (output/'build.json').write_text(json.dumps(result, indent=2)+'\n')
    return result


if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--output', type=Path, default=ROOT/'dist/macos-0.1.0')
    parser.add_argument('--runtime-cache', type=Path, default=ROOT/'.private/macos-app/runtime-cache')
    parser.add_argument('--arch', choices=['arm64', 'x86_64'], default=platform.machine())
    parser.add_argument('--feed-url')
    parser.add_argument('--public-key')
    parser.add_argument('--signing-identity',default='-')
    parser.add_argument('--radio-runtime',type=Path)
    parser.add_argument('--firered-resources',type=Path,required=True,help='Folder holding the pinned FireRed core and knowledge (see pokemon_suite/game_resources.py)')
    parser.add_argument('--verification',type=Path,required=True)
    engine=parser.add_mutually_exclusive_group(required=True)
    engine.add_argument('--engine-package',type=Path,help='Reuse an existing capsule only when its engine files exactly match reviewed source.')
    engine.add_argument('--engine-version',help='Explicit new immutable version when publishing changed engine code.')
    args = parser.parse_args()
    try: print(json.dumps(build(args.output, args.runtime_cache, args.arch,feed_url=args.feed_url,public_key=args.public_key,signing_identity=args.signing_identity,radio_runtime=args.radio_runtime,verification=args.verification,engine_package=args.engine_package,engine_version=args.engine_version,firered_resources=args.firered_resources), indent=2))
    except (ValueError, OSError, subprocess.SubprocessError) as error: parser.exit(1, str(error)+'\n')
