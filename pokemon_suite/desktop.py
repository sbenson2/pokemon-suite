"""Native application lifecycle; closing a window does not stop game owners."""
from pathlib import Path
import os
import sys
import threading

from .paths import ROOT
from .processes import assert_process_alive


def runtime_overrides(node):
    node = Path(node).resolve()
    if not node.is_file():
        raise ValueError('The bundled bot runtime is missing. Reinstall Pokémon Suite.')
    result={'worker': str(ROOT/'engine/firered/src/suite/session-worker.js'),
            'researchBots': str(ROOT/'engine/shared'), 'node': str(node)}
    if os.environ.get('POKEMON_SUITE_RADIO_RUNTIME'):
        result['radioRuntime']={'root':os.environ['POKEMON_SUITE_RADIO_RUNTIME'],
                                'python':sys.executable,'bridge':str(ROOT/'pokemon_suite/radio_appliance.py')}
    return result


def close_sessions(sessions):
    """Use each existing owner's save/close protocol; never force-kill a game."""
    # Invisible FireRed partner owners are closed too, addressed by owner key.
    everyone = lambda: sessions.snapshots() + (sessions.partner_snapshots() if hasattr(sessions, 'partner_snapshots') else [])
    with getattr(sessions, 'lock', threading.RLock()):
        for live in everyone():
            if not live.get('sessionId') or live.get('state') in {'offline', 'closed'}:
                continue
            result = sessions.stop_game(live.get('owner', live['game']), live['sessionId'])
            if result.get('state') != 'closed':
                raise ValueError(f"{live['game'].title()} is still open or paused for a trade. Finish its linked task before quitting.")
        remaining = [s for s in everyone() if s.get('sessionId') and s.get('state') not in {'offline', 'closed'}]
        if remaining:
            raise ValueError('A game is still open. Finish saving or trading before quitting.')


def watch_parent(server, stream):
    # EOF means the native host crashed. Try the ordinary save/close path; if a
    # linked transaction cannot close, its owner and save remain for next launch.
    def watch():
        stream.read()
        try:
            close_sessions(server.pokemon_sessions)
        except (ValueError, OSError):
            pass
        server.shutdown()
    threading.Thread(target=watch, daemon=True).start()


def desktop_parent_alive(parent=None):
    """Background collection helpers belong to the native app that launched them."""
    parent = os.environ.get('POKEMON_SUITE_DESKTOP_PARENT_PID', '') if parent is None else parent
    if not parent:
        return True  # The browser service retains its existing helper lifecycle.
    try:
        pid = int(parent)
        if pid <= 1:
            return False
        assert_process_alive(pid)
        return True
    except ProcessLookupError:
        return False
    except PermissionError:
        return True
    except ValueError:
        return False
