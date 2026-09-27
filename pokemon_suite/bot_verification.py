"""Release evidence for exact bot payloads; legacy run locks remain readable."""
import hashlib
import json
import re

CHECKS = frozenset({'rom-integrity', 'engine', 'host', 'adapters', 'native-replays'})


def inventory_digest(entries):
    inventory = sorted(({k: e[k] for k in ('path', 'bytes', 'sha256')} for e in entries), key=lambda e: e['path'])
    return hashlib.sha256(json.dumps(inventory, sort_keys=True, separators=(',', ':')).encode()).hexdigest()


def file_inventory(files):
    return [{'path': p, 'bytes': len(b), 'sha256': hashlib.sha256(b).hexdigest()} for p, b in sorted(files.items())]


def require_bot_verification(manifest):
    if manifest['kind'] not in {'engine', 'planner'}:
        return
    proof = manifest.get('verification')
    if not isinstance(proof, dict) or proof.get('schema') != 'pokemon-suite/bot-verification/v1' or proof.get('status') != 'passed':
        raise ValueError('This bot package needs passing regression verification before installation.')
    if proof.get('receipt') is False:
        raise ValueError('This regression verification is a development selection, not a release receipt.')
    if proof.get('payloadSha256') != inventory_digest(manifest['files']):
        raise ValueError('The regression verification belongs to different bot code.')
    if not isinstance(proof.get('sourceSha256'), str) or not re.fullmatch('[a-f0-9]{64}', proof['sourceSha256']):
        raise ValueError('The regression source identity is missing.')
    checks = proof.get('checks')
    if not isinstance(checks, list) or len(checks) != len(CHECKS) or {c.get('id') for c in checks if isinstance(c, dict)} != CHECKS:
        raise ValueError('The regression verification is missing a required suite.')
    for check in checks:
        if any(type(check.get(k)) is not int or check[k] < 0 for k in ('tests', 'passed', 'failed', 'skipped')) or check['failed'] or not check['passed'] or check['tests'] != check['passed'] + check['skipped']:
            raise ValueError('A required regression suite failed or did not execute.')
        if check['id'] in {'rom-integrity', 'native-replays'} and check['skipped']:
            raise ValueError('Required ROM integrity and native regression checks cannot be skipped.')


def verified_payload(files, source_files, report):
    """Builders reject stale reports, including changes to tests and host code."""
    proof = {**report, 'payloadSha256': inventory_digest(file_inventory(files))}
    require_bot_verification({'kind': 'engine', 'files': file_inventory(files), 'verification': proof})
    if proof['sourceSha256'] != inventory_digest(file_inventory(source_files)):
        raise ValueError('Source changed after regression verification. Run verify-bot again.')
    return proof
