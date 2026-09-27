import importlib
import json
from pathlib import Path
import platform
import shutil
import sys
import subprocess

from .paths import ROOT
from .suite_save_store import atomic_file


def initialize(directory):
    directory = Path(directory).expanduser().resolve()
    directory.mkdir(parents=True, exist_ok=True)
    target = directory / 'config.json'
    if target.exists():
        return json.loads(target.read_text())
    config = {
        'schema': 'pokemon-suite/config/v1', 'directory': str(directory),
        'worker': str(ROOT / 'engine/firered/src/suite/session-worker.js'),
        'researchBots': str(ROOT / 'engine/shared'),
        'node': shutil.which('node') or 'node', 'games': {}, 'library': {},
    }
    atomic_file(target, (json.dumps(config, indent=2) + '\n').encode())
    return config


def doctor(directory, runtime_overrides=None):
    # Loading the actual product modules catches missing extracted dependencies.
    for module in ['pokemon_sessions', 'pokemon_farming', 'pokemon_campaigns', 'pokemon_bot_settings', 'pokemon_evolution']:
        importlib.import_module('.' + module, __package__)
    path = Path(directory) / 'config.json'
    config = json.loads(path.read_text()) if path.exists() else {'games': {}}
    config.update(runtime_overrides or {})
    node = config.get('node') or shutil.which('node')
    issues = []
    if not node or not shutil.which(node):
        issues.append('Install Node.js 22 or later, or use a distribution with its Node runtime included.')
    else:
        try:
            version=subprocess.run([node,'--version'],capture_output=True,text=True,timeout=3,check=True).stdout.strip()
            if int(version.lstrip('v').split('.')[0])<22:issues.append('Node.js 22 or later is required; found '+version)
        except (OSError,ValueError,subprocess.SubprocessError):issues.append('The configured Node.js runtime did not answer its version check.')
    for game,cfg in config['games'].items():
        if cfg.get('backend')=='desktop' and sys.platform!='darwin':
            issues.append(f'{game}: the extracted desktop capture adapter is currently macOS-only; a native adapter for this OS is required.')
    resources = [ROOT / 'engine/firered/src/suite/session-worker.js', ROOT / 'engine/shared/shared/cartridge.js']
    issues.extend('Missing application resource: ' + str(p.relative_to(ROOT)) for p in resources if not p.is_file())
    return {'product': 'pokemon-suite', 'version': '0.1.0', 'host': {'os': sys.platform, 'architecture': platform.machine()},
            'configuredGames': len(config['games']), 'status': 'needs-setup' if issues else 'ready' if config['games'] else 'ready-for-game-setup',
            'issues': issues, 'dataDirectory': str(Path(directory).resolve())}
