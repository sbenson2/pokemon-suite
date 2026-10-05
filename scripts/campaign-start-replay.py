"""Native replay driver: the real host campaign flow over an isolated Suite runtime.

Used by scripts/replay-leafgreen-new-game.mjs (build 124). The replay owns the
game worker; this process runs the host side exactly as the Suite server does:
SuiteSessions over the owner's status port, then the reviewed campaign options,
preview and start (pokemon_suite/pokemon_campaigns.py), which run the engine's
campaign-config-cli.js. It prints one JSON line.

  python scripts/campaign-start-replay.py <suite-root> <game> <settings.json>
"""
import json
from pathlib import Path
import sys

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from pokemon_suite import pokemon_campaigns  # noqa: E402
from pokemon_suite.pokemon_sessions import SuiteSessions  # noqa: E402


def main():
    root, game = Path(sys.argv[1]), sys.argv[2]
    settings = json.loads(Path(sys.argv[3]).read_text())
    sessions = SuiteSessions(root)
    offered = pokemon_campaigns.options(sessions, game)
    if not offered.get('supported'):
        raise SystemExit(offered.get('reason') or 'Campaigns are unavailable for this game.')
    reviewed = pokemon_campaigns.preview(sessions, game, settings)
    live = pokemon_campaigns.start(sessions, game, reviewed['preview']['id'])
    print(json.dumps({'options': {k: offered.get(k) for k in ('defaults', 'starters', 'poolScope')},
                      'preview': reviewed['preview'], 'campaign': live.get('campaign'),
                      'bot': live.get('bot'), 'gameProgress': live.get('gameProgress')}), flush=True)


if __name__ == '__main__':
    main()
