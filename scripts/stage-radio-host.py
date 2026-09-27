"""Stage a local, relocatable QEMU prototype; not a public release builder."""
import argparse
import hashlib
import json
from pathlib import Path
import plistlib
import shutil
import subprocess
import tempfile


def dependencies(path):
    output = subprocess.check_output(['otool', '-L', str(path)], text=True)
    result = {}
    for line in output.splitlines()[1:]:
        name = line.strip().split(' (', 1)[0]
        if name.startswith(('/usr/lib/', '/System/Library/')):
            continue
        if not name.startswith('/'):
            raise ValueError('Prototype requires resolved absolute dependencies: ' + name)
        resolved = Path(name).resolve(strict=True)
        if resolved != path:
            result[name] = resolved
    return result


def stage(executable, output):
    output = Path(output).absolute()
    if output.exists():
        raise ValueError('Output already exists; choose a new staging directory')
    executable = Path(executable).resolve(strict=True)
    closure, pending = {}, [executable]
    names = {}
    while pending:
        path = pending.pop()
        if path in closure:
            continue
        if path.name in names and names[path.name] != path:
            raise ValueError('Conflicting library names: ' + path.name)
        names[path.name] = path
        closure[path] = dependencies(path)
        pending.extend(closure[path].values())
    output.parent.mkdir(parents=True, exist_ok=True)
    with tempfile.TemporaryDirectory(prefix='radio-stage-', dir=output.parent) as directory:
        root = Path(directory)
        (root / 'bin').mkdir()
        (root / 'lib').mkdir()
        destinations = {path: root / ('bin' if path == executable else 'lib') / path.name for path in closure}
        for source, target in destinations.items():
            shutil.copy2(source, target)
            target.chmod(0o755)
        for source, deps in closure.items():
            target = destinations[source]
            changes = []
            if source != executable:
                changes.extend(['-id', '@loader_path/' + target.name])
            for original, dependency in deps.items():
                relative = '@loader_path/' + ('../lib/' if source == executable else '') + destinations[dependency].name
                changes.extend(['-change', original, relative])
            if changes:
                subprocess.run(['install_name_tool', *changes, str(target)], check=True, capture_output=True)
        entitlement = root / 'hypervisor.plist'
        entitlement.write_bytes(plistlib.dumps({'com.apple.security.hypervisor': True}))
        for source, target in destinations.items():
            extra = ['--entitlements', str(entitlement)] if source == executable else []
            subprocess.run(['codesign', '--force', '--sign', '-', '--timestamp=none', *extra, str(target)],
                           check=True, capture_output=True)
            subprocess.run(['codesign', '--verify', '--strict', str(target)], check=True, capture_output=True)
            links = subprocess.check_output(['otool', '-L', str(target)], text=True)
            for line in links.splitlines()[1:]:
                name = line.strip().split(' (', 1)[0]
                if not name.startswith(('@loader_path/', '/usr/lib/', '/System/Library/')):
                    raise ValueError('Unrelocated native dependency: ' + name)
        manifest = {'schema': 'pokemon-suite/radio-host-prototype/v1', 'signing': 'ad-hoc',
                    'notarized': False, 'releaseReady': False,
                    'files': [{'path': target.relative_to(root).as_posix(), 'bytes': target.stat().st_size,
                               'sha256': hashlib.sha256(target.read_bytes()).hexdigest()}
                              for target in sorted(destinations.values())]}
        (root / 'host-manifest.json').write_text(json.dumps(manifest, indent=2) + '\n')
        root.rename(output)
    return output / 'bin' / executable.name


if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--qemu', type=Path, required=True)
    parser.add_argument('--output', type=Path, required=True)
    args = parser.parse_args()
    try:
        print(stage(args.qemu, args.output))
    except (OSError, ValueError, subprocess.SubprocessError) as error:
        parser.exit(1, str(error) + '\n')
