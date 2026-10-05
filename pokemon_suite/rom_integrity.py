"""Reviewed ROM identities for release qualification, independent of local manifests.

Only hashes and patch boundaries ship here, never ROM bytes. Adding a profile
requires a source review and fresh regression verification.
"""
import hashlib
import json
from pathlib import Path


FIRERED_ROMS = {
    'firered-rev1': {
        'bytes': 16777216,
        'sha1': 'dd5945db9b930750cb39d00c84da8571feebf417',
        'sha256': '729041b940afe031302d630fdbe57c0c145f3f7b6d9b8eca5e98678d0ca4d059',
        'ranges': (),
    },
    'firered-rev1-peer-trade-v2': {
        'bytes': 16777216,
        'sha1': '85a259c7b7a74d4f2322e5b9f89d22a53dfd6fce',
        'sha256': '59e5c4e120a223f5a2339195f69906f47855ff283382e0d6e1d50830a0bea1e8',
        # File offsets, end exclusive (GBA addresses minus 0x08000000).
        'ranges': (
            (0x04e91c, 0x04e924),  # Wait for link task before cancel-exit callback.
            (0x053f70, 0x053f74),  # Save state 42 peer synchronization.
            (0x053f74, 0x053f78),  # Save state 43 peer synchronization.
            (0x053f78, 0x053f7c),  # Save state 44 peer synchronization.
            (0xf00000, 0xf00070),  # Compatibility routines in unused padding.
        ),
    },
}


# LeafGreen US revision 1 (build 124): pret leafgreen_rev1, unmodified. There is
# no reviewed LeafGreen patch, native link cartridge or partner.
LEAFGREEN_ROMS = {
    'leafgreen-rev1': {
        'bytes': 16777216,
        'sha1': '7862c67bdecbe21d1d69ce082ce34327e1c6ed5e',
        'sha256': '2f978f635b9593f6ca26ec42481c53a6b39f6cddd894ad5c062c1419fac58825',
        'ranges': (),
    },
}


STOCK_PARTNER_ROMS = {'emerald': {'id':'emerald-us','bytes':16777216,
    'sha1':'f3ae088181bf583e55daf962a92bb46f4f1d07b7',
    'sha256':'a9dec84dfe7f62ab2220bafaef7479da0929d066ece16a6885f6226db19085af'}}


def verify_stock_partner(game,config):
    policy=STOCK_PARTNER_ROMS.get(game);rom=config.get('cartridge',{})
    if not policy or any(rom.get(k)!=policy[k] for k in ('id','bytes','sha1')) or not Path(rom.get('path','')).is_absolute():
        raise ValueError('The partner ROM has no matching reviewed stock profile.')
    data=Path(rom['path']).read_bytes()
    if len(data)!=policy['bytes'] or hashlib.sha256(data).hexdigest()!=policy['sha256']:
        raise ValueError('The partner ROM differs from its reviewed stock fingerprint.')
    return {'game':game,'profile':policy['id'],'romSha256':policy['sha256']}


def verify_firered_partner(owner, config, main, cartridge, profile, rom_sha256):
    """A second FireRed owner may only run this case's reviewed cartridges.

    It is a declared partner (title firered, role partner) whose base and
    native cartridges are byte-for-byte the same reviewed entries as the case's
    own FireRed; it can never introduce a cartridge of its own.
    """
    partner = (config.get('games') or {}).get(owner)
    if not isinstance(owner, str) or owner == 'firered' or not isinstance(partner, dict) or partner.get('title') != 'firered' or partner.get('role') != 'partner':
        raise ValueError('The FireRed partner owner is not a declared FireRed partner.')
    keys = ('id', 'path', 'bytes', 'sha1')
    same = lambda a, b: isinstance(a, dict) and all(a.get(k) == b.get(k) for k in keys)
    native = (partner.get('nativeRadio') or {}).get('cartridge')
    if not same(partner.get('cartridge'), main['cartridge']) or not same(native, cartridge):
        raise ValueError('The FireRed partner cartridge differs from the reviewed ROMs of its case.')
    return {'game': 'firered', 'owner': owner, 'profile': profile, 'romSha256': rom_sha256}


def compare_roms(original, candidate, base_policy, patch_policy):
    """Compare all bytes, then require the exact reviewed patch fingerprint.

    Policies come from reviewed source, never the cartridge's sidecar/config.
    Checking the whole fingerprint also protects instructions inside a range.
    """
    base_hash = hashlib.sha256(original).hexdigest()
    if len(original) != base_policy['bytes'] or base_hash != base_policy['sha256']:
        raise ValueError('The original ROM does not match the reviewed baseline.')
    if len(candidate) != len(original) or len(candidate) != patch_policy['bytes']:
        raise ValueError('The candidate ROM size differs from the reviewed ROM.')
    cursor = changed = 0
    for start, end in patch_policy['ranges']:
        if not cursor <= start < end <= len(original):
            raise ValueError('Invalid reviewed ROM patch boundaries.')
        if original[cursor:start] != candidate[cursor:start]:
            raise ValueError('ROM changes exist outside the approved trade patch ranges.')
        changed += sum(a != b for a, b in zip(original[start:end], candidate[start:end]))
        cursor = end
    if original[cursor:] != candidate[cursor:]:
        raise ValueError('ROM changes exist outside the approved trade patch ranges.')
    candidate_hash = hashlib.sha256(candidate).hexdigest()
    if candidate_hash != patch_policy['sha256']:
        raise ValueError('The candidate does not match the approved ROM fingerprint, including patch instructions.')
    return {'baseSha256': base_hash, 'romSha256': candidate_hash, 'changedBytes': changed}


def _verify_leafgreen_case(case, config_path):
    """A LeafGreen replay runs only the reviewed stock image, never a link or partner."""
    if case['nativeRadio'] is not False or case.get('partnerGame') or case.get('partnerOwner'):
        raise ValueError('No reviewed LeafGreen ROM policy exists for a native link or partner replay.')
    config_bytes = config_path.read_bytes()
    base = json.loads(config_bytes)['games']['leafgreen']['cartridge']
    policy = LEAFGREEN_ROMS['leafgreen-rev1']
    if base['id'] != 'leafgreen-rev1':
        raise ValueError('The configured ROM profile has no reviewed approval for this LeafGreen replay.')
    if not Path(base['path']).is_absolute():
        raise ValueError('ROM verification requires absolute cartridge paths.')
    original = Path(base['path']).read_bytes()
    audit = compare_roms(original, original, policy, policy)
    if base.get('bytes') != policy['bytes'] or base.get('sha1') != policy['sha1']:
        raise ValueError('The configured ROM identity differs from the reviewed fingerprint.')
    return {'id': case['id'], 'game': 'leafgreen', 'nativeRadio': False, 'profile': 'leafgreen-rev1',
            'configSha256': hashlib.sha256(config_bytes).hexdigest(), **audit}


def verify_corpus_roms(corpus_path):
    """Audit the exact base/candidate selected by each FireRed native replay."""
    corpus_path = Path(corpus_path).resolve()
    corpus = json.loads(corpus_path.read_bytes())
    cases = corpus.get('cases')
    if corpus.get('schema') != 'pokemon-suite/native-regressions/v1' or not isinstance(cases, list) or not cases:
        raise ValueError('ROM verification needs a nonempty native regression corpus.')
    results, seen, checked = [], set(), {}
    for case in cases:
        if not isinstance(case, dict) or not isinstance(case.get('id'), str) or case['id'] in seen:
            raise ValueError('ROM verification needs unique case identifiers.')
        seen.add(case['id'])
        if case.get('game') == 'leafgreen' and type(case.get('nativeRadio')) is bool:
            try:
                results.append(_verify_leafgreen_case(case, (corpus_path.parent/case['config']).resolve()))
            except (KeyError, TypeError) as error:
                raise ValueError('The native regression ROM configuration is incomplete.') from error
            continue
        if case.get('game', 'firered') != 'firered' or type(case.get('nativeRadio')) is not bool:
            raise ValueError('No reviewed ROM policy exists for this game or replay mode.')
        try:
            config_path = (corpus_path.parent/case['config']).resolve()
            config_bytes = config_path.read_bytes()
            config_hash = hashlib.sha256(config_bytes).hexdigest()
            cfg = json.loads(config_bytes)['games']['firered']
            profile = 'firered-rev1-peer-trade-v2' if case['nativeRadio'] else 'firered-rev1'
            base = cfg['cartridge']
            cartridge = cfg['nativeRadio']['cartridge'] if case['nativeRadio'] else base
            if base['id'] != 'firered-rev1' or cartridge['id'] != profile:
                raise ValueError('The configured ROM profile has no reviewed approval for this replay mode.')
            # The native runner uses paths from the source snapshot's cwd.
            # Require absolute local ROM paths to prevent differing resolution.
            if not Path(base['path']).is_absolute() or not Path(cartridge['path']).is_absolute():
                raise ValueError('ROM verification requires absolute cartridge paths.')
            key = (config_path, config_hash, profile)
            if key not in checked:
                original = Path(base['path']).read_bytes()
                candidate = Path(cartridge['path']).read_bytes() if case['nativeRadio'] else original
                audit = compare_roms(original, candidate, FIRERED_ROMS['firered-rev1'], FIRERED_ROMS[profile])
                for declared, expected in ((base, FIRERED_ROMS['firered-rev1']), (cartridge, FIRERED_ROMS[profile])):
                    if declared.get('bytes') != expected['bytes'] or declared.get('sha1') != expected['sha1']:
                        raise ValueError('The configured ROM identity differs from the reviewed fingerprint.')
                checked[key] = audit
            if case.get('partnerGame') and case.get('partnerOwner'):
                raise ValueError('A native replay case names one partner.')
            partner = ({'partner': verify_stock_partner(case['partnerGame'], json.loads(config_bytes)['games'][case['partnerGame']])} if case.get('partnerGame') else
                       {'partner': verify_firered_partner(case['partnerOwner'], json.loads(config_bytes), cfg, cartridge, profile, checked[key]['romSha256'])} if case.get('partnerOwner') else {})
            if case.get('partnerOwner') and not case['nativeRadio']:
                raise ValueError('A FireRed partner case needs the reviewed native link cartridge.')
            results.append({'id': case['id'], 'game': 'firered', 'nativeRadio': case['nativeRadio'],
                            'profile': profile, 'configSha256': config_hash, **checked[key], **partner})
        except (KeyError, TypeError) as error:
            raise ValueError('The native regression ROM configuration is incomplete.') from error
    return {'schema': 'pokemon-suite/rom-integrity/v1', 'cases': results}
