"""Read-only, bounded support bundles for the native app and browser client."""
from __future__ import annotations

from datetime import datetime, timezone
import json
import os
from pathlib import Path
import stat

from .pokemon_main_series import MAIN_GAMES

_MAX_BYTES = 2 * 1024 * 1024
_CREDENTIAL_KEYS = {'password', 'authorization', 'cookie', 'setcookie', 'token',
                    'accesstoken', 'refreshtoken', 'bearertoken', 'clientsecret',
                    'privatekey', 'ownerkey', 'ownertoken', 'apikey'}


def _redact(value):
    if isinstance(value, dict):
        return {key: '[redacted]' if ''.join(c for c in key.lower() if c.isalnum()) in _CREDENTIAL_KEYS
                else _redact(item) for key, item in value.items()}
    if isinstance(value, list):
        return [_redact(item) for item in value]
    return value


def support_report(directory: Path, game: str, session: dict | None) -> dict:
    if game not in MAIN_GAMES:
        raise ValueError('Choose a supported game for its report.')
    folder = Path(directory) / game
    records, issues, candidates = [], [], []
    # Reports never follow user-supplied paths or references inside a report.
    if folder.is_symlink():
        issues.append('The game report directory is a symbolic link and was skipped.')
    else:
        recovery = folder / 'recovery-reports'
        if recovery.is_symlink():
            issues.append('The recovery report directory is a symbolic link and was skipped.')
        elif recovery.is_dir():
            candidates.extend(recovery.glob('*.json'))
        for name in ('recovery-report.json', 'campaign-report.json'):
            path = folder / name
            if path.exists() or path.is_symlink():
                candidates.append(path)
        def modified(path):
            try:
                return path.lstat().st_mtime
            except OSError:
                return 0
        candidates.sort(key=modified, reverse=True)
        seen = set()
        for path in candidates[:20]:
            try:
                if path.is_symlink():
                    raise ValueError('symbolic link')
                with os.fdopen(os.open(path, os.O_RDONLY | getattr(os, 'O_NOFOLLOW', 0) | getattr(os, 'O_NONBLOCK', 0)), 'rb') as stream:
                    info = os.fstat(stream.fileno())
                    if not stat.S_ISREG(info.st_mode):
                        raise ValueError('not a regular file')
                    raw = stream.read(_MAX_BYTES + 1)
                if len(raw) > _MAX_BYTES:
                    raise ValueError('larger than 2 MiB')
                details = json.loads(raw)
                if not isinstance(details, dict):
                    raise ValueError('not a report object')
                signature = json.dumps(details, sort_keys=True)
                if signature in seen:
                    continue
                seen.add(signature)
                run = details.get('run') or {}
                records.append({'id': str(path.relative_to(folder)),
                                'createdAt': details.get('at') or run.get('updatedAt') or datetime.fromtimestamp(info.st_mtime, timezone.utc).isoformat(),
                                'reason': details.get('reason') or run.get('reason') or 'Campaign report',
                                'details': _redact(details)})
            except (OSError, ValueError, RecursionError) as error:
                issues.append(f'{path.name}: skipped ({error}).')
    current = _redact(session or {})
    if current.get('state') in {'blocked', 'failed'} and current.get('decision', {}).get('reason'):
        records.insert(0, {'id': 'current-' + str(current.get('sessionId', game)),
                           'createdAt': current.get('updatedAt') or datetime.now(timezone.utc).isoformat(),
                           'reason': current['decision']['reason'],
                           'details': {key: current[key] for key in ('state', 'frame', 'map', 'position', 'decision', 'decisionFeed', 'campaign', 'recovery', 'runtime') if key in current}})
    reason = records[0]['reason'] if records else current.get('decision', {}).get('reason') or 'Review the current game and recent decisions.'
    return {'schema': 'pokemon-suite/support-report/v1', 'game': game,
            'createdAt': datetime.now(timezone.utc).isoformat(), 'session': current,
            'records': records, 'issues': issues,
            'repairPrompt': f'Investigate the attached Pokémon Suite report for {MAIN_GAMES[game]["title"]}. '
                            f'Observed issue: {reason}\n'
                            'Trace the decision history, recovery evidence, and engine version to the root cause. '
                            'Fix the shared behavior and add a regression test covering the failure. '
                            'Preserve the current save and any in-progress catch or trade. '
                            'Verify the fix before resuming automation; describe any remaining limitations.'}
