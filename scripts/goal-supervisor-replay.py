"""Native replay driver: the real goal supervisor over an isolated Suite runtime.

Used by the goal replays (scripts/replay-goal-*.mjs). The replay owns the game
worker; this process runs the host side exactly as the Suite server does
(SuiteSessions over the owner's status port, the single request database and
GoalSupervisor.tick). It prints one JSON line per goal change.

  python scripts/goal-supervisor-replay.py <suite-root> <goal.json> [<seed.json>]

<seed.json> optionally restores persisted execution state (a supervisor restart
in the middle of a goal), e.g. a campaign it had already started.
"""
import json
from pathlib import Path
import sys
import time

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from pokemon_suite.pokemon_farming import suite_requests  # noqa: E402
from pokemon_suite.pokemon_goals import GoalSupervisor  # noqa: E402
from pokemon_suite.pokemon_sessions import SuiteSessions  # noqa: E402


def main():
    root = Path(sys.argv[1])
    goal = json.loads(Path(sys.argv[2]).read_text())
    seed = json.loads(Path(sys.argv[3]).read_text()) if len(sys.argv) > 3 else None
    sessions = SuiteSessions(root)
    supervisor = GoalSupervisor(sessions, suite_requests(root, sessions))
    created = supervisor.submit(goal)
    if seed:
        def restore(stored):
            stored['status'] = seed.get('status', stored['status'])
            stored['execution'].update(seed['execution'])
        supervisor.store.update(created['id'], restore)
    print(json.dumps({'event': 'submitted', 'id': created['id']}), flush=True)
    last = None
    while True:
        supervisor.tick()
        current = supervisor.store.get(created['id'])
        view = json.dumps({k: current.get(k) for k in ('status', 'progress', 'execution', 'question', 'result')}, sort_keys=True)
        if view != last:
            print(json.dumps({'event': 'goal', 'goal': current, 'supervisorError': supervisor.error}), flush=True)
            last = view
        time.sleep(0.5)


if __name__ == '__main__':
    main()
