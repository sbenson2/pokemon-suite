"""One support/readiness contract for library, clients, and task preflight.

Implementation support is not qualification of an unattended campaign. Live
owner reports can restrict readiness, but cannot invent an implementation.
"""
from pathlib import Path
import sys

SCHEMA = 'pokemon-suite/capabilities/v1'
DEX_GAMES = frozenset({'firered', 'leafgreen', 'emerald', 'crystal'})
FIRERED_SHA1 = 'dd5945db9b930750cb39d00c84da8571feebf417'
# LeafGreen US revision 1 (build 124). The FRLG family shares one engine; a
# LeafGreen bot profile runs the story campaign. Captures, trades and
# evolution partners are not qualified on LeafGreen yet.
LEAFGREEN_SHA1 = '7862c67bdecbe21d1d69ce082ce34327e1c6ed5e'
FRLG_CARTRIDGES = {'firered': ('FireRed', FIRERED_SHA1), 'leafgreen': ('LeafGreen', LEAFGREEN_SHA1)}
FEATURES = ('play', 'audio', 'input', 'touch', 'nativeSave', 'checkpoint',
            'telemetry', 'campaign', 'companion', 'travel', 'battle', 'heal',
            'save', 'storage', 'capture.land', 'capture.safari', 'capture.static',
            'capture.gift', 'capture.fishing', 'evolution', 'trade', 'dex')


def _file(value):
    try:
        return isinstance(value, str) and Path(value).is_file()
    except OSError:
        return False


def game_features(game, descriptor, config=None, live=None, *, dex_available=None):
    backend = (config or {}).get('backend', 'wasm')
    configured = config is not None
    implemented = set()
    if backend in {'libretro', 'desktop'} or game in {'firered', 'leafgreen', 'emerald', 'crystal'}:
        implemented.update({'play', 'audio', 'input', 'nativeSave', 'save'})
        if backend != 'desktop':
            implemented.add('checkpoint')
        if descriptor['platform'] in {'nds', '3ds'}:
            implemented.add('touch')
    if backend == 'wasm' and game in {'firered', 'emerald'}:
        implemented.update({'telemetry', 'trade'})
        if game == 'firered' and (config or {}).get('role') == 'partner':
            # A second FireRed save serves trade evolutions only; it never plays tasks.
            implemented.update({'companion', 'evolution'})
        elif game == 'firered':
            implemented.update({'campaign', 'travel', 'battle', 'heal', 'storage',
                                'capture.land', 'capture.safari', 'capture.static',
                                'capture.gift', 'evolution'})
        else:
            implemented.update({'companion', 'evolution'})
    if backend == 'wasm' and game == 'leafgreen':
        implemented.update({'telemetry', 'campaign', 'travel', 'battle', 'heal', 'storage'})
    if (dex_available if dex_available is not None else game in DEX_GAMES):
        implemented.add('dex')
    runtime_ready = configured
    runtime_reason = None if configured else 'Install this game and its emulator resources.'
    if configured:
        cartridge = config.get('cartridge', {})
        rom = cartridge.get('path') if isinstance(cartridge, dict) else None
        rom = rom or config.get('rom')
        if not rom or not _file(rom):
            runtime_ready = False
            runtime_reason = 'The configured game image is unavailable. Reconnect its storage or update its location.'
        core = config.get('core')
        if core and not (_file(core) if backend == 'libretro' else _file(str(Path(core)/'build-manifest.json'))):
            runtime_ready = False
            runtime_reason = 'The configured emulator resources are unavailable.'
        if backend == 'desktop' and sys.platform != 'darwin':
            runtime_ready = False
            runtime_reason = 'This desktop capture adapter has not been implemented for this operating system.'
    result = {}
    automation = implemented - {'play', 'audio', 'input', 'touch', 'nativeSave', 'checkpoint', 'save', 'dex'}
    for name in FEATURES:
        supported = name in implemented
        ready = supported and (name == 'dex' or runtime_ready)
        reason = None if ready else runtime_reason if supported else 'This game adapter does not implement this feature.'
        readiness = 'ready' if ready else 'needs-setup' if supported else 'blocked'
        if name in automation and configured:
            if game in FRLG_CARTRIDGES and (config.get('cartridge') or {}).get('sha1') != FRLG_CARTRIDGES[game][1]:
                readiness = 'needs-setup'; reason = f'Automation requires the verified {FRLG_CARTRIDGES[game][0]} US revision 1 cartridge.'
            if game in FRLG_CARTRIDGES and not all(_file(config.get('inputs', {}).get(k)) for k in ('runtime', 'world', 'story', 'battle')):
                readiness = 'needs-setup'; reason = 'Install the matching runtime, world, story, and battle resources.'
        if supported and live and live.get('capabilities', {}).get(name) is False:
            readiness = 'blocked'; reason = live.get('message') or 'The current game owner cannot provide this feature.'
        result[name] = {'support': 'experimental' if supported else 'unimplemented',
                        'readiness': readiness, 'reason': reason, 'provider': f'{backend}:{game}',
                        'qualification': None}
    return result


def legacy_capabilities(features):
    ready = lambda name: features[name]['support'] != 'unimplemented' and features[name]['readiness'] == 'ready'
    return {**{name: ready(name) for name in ('play', 'audio', 'input', 'touch', 'nativeSave', 'checkpoint', 'trade', 'dex')},
            'bot': ready('campaign') or ready('companion'),
            'hunt': any(ready(name) for name in FEATURES if name.startswith('capture.'))}


def require_feature(game, config, feature, live=None):
    from .pokemon_main_series import MAIN_GAMES
    if game not in MAIN_GAMES or feature not in FEATURES:
        raise ValueError('Choose an implemented game feature.')
    status = game_features(game, MAIN_GAMES[game], config, live)[feature]
    if status['support'] == 'unimplemented' or status['readiness'] != 'ready':
        raise ValueError(status['reason'] or 'This game feature is unavailable.')
    return status
