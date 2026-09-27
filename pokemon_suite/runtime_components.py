"""Apply verified component entrypoints while preserving cartridge identity."""
from .packages import PackageStore


def apply_component(config,game,resolved):
    manifest=resolved['manifest'];kind=manifest['kind'];cfg=config['games'][game]
    if kind=='game':
        if (cfg.get('cartridge') or {}).get('sha1') not in manifest.get('romSha1s',[]):
            raise ValueError('The game resource package does not match this exact cartridge revision.')
        if cfg.get('backend','wasm')!='wasm':raise ValueError('This game resource contract requires the WASM game adapter.')
        required=('runtime','world','story','battle')
        if any(k not in resolved for k in required):raise ValueError('The game package is missing a required observation or mechanics resource.')
        cfg['inputs']={**cfg.get('inputs',{}),**{k:resolved[k] for k in required}}
    elif kind=='emulator':
        backend=cfg.get('backend','wasm')
        if manifest.get('backend')!=backend:raise ValueError('This emulator component belongs to another host adapter.')
        if 'core' not in resolved:raise ValueError('The emulator package is missing its core entrypoint.')
        cfg['core']=resolved['core']
        if backend=='libretro':
            import hashlib
            from pathlib import Path
            cfg['coreSha256']=hashlib.sha256(Path(resolved['core']).read_bytes()).hexdigest()
            if 'bridge' in resolved:
                cfg['bridge']=resolved['bridge'];cfg['bridgeSha256']=hashlib.sha256(Path(resolved['bridge']).read_bytes()).hexdigest()
        elif backend!='wasm':raise ValueError('Desktop emulators use their own native application updater.')
    elif kind=='planner':config.update(campaignPlanner=resolved['campaignPlanner'],plannerLock=resolved['lock'])
    elif kind=='engine':
        config.update({k:resolved[k] for k in ('worker','researchBots','campaignPlanner') if k in resolved})
        config['runtimeLock']=resolved['lock']
    else:raise ValueError('Data is selected by the revision-aware provider.')
    return config
