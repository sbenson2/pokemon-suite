"""An engine update applied to a title owner also moves its declared trade partners.

A FireRed trade partner runs FireRed's packages (resolved by title) from its own
owner directory and its own runtime-selection.json. The updater only targets
title owners, so each partner must follow its title's engine: re-pinned when it
is not running, handed off through the journaled checkpoint when it is live and
idle, and never while a paired exchange is in progress.
"""
import base64
import json
from pathlib import Path
import tempfile
import threading
import unittest

from cryptography.hazmat.primitives.asymmetric.ed25519 import Ed25519PrivateKey
from cryptography.hazmat.primitives.serialization import Encoding, PublicFormat

from test_packages import package
from pokemon_suite.pokemon_sessions import SuiteSessions
from pokemon_suite.updates import UpdateManager

GAMES = {'firered': {'port': 1}, 'emerald': {'port': 3},
         'firered-partner': {'title': 'firered', 'role': 'partner', 'port': 2}}
LOCK = 'pokemon-suite/run-lock/v1'


def lock(graph):
    return {'schema': LOCK, 'game': 'firered', 'packages': graph}


class Owners(SuiteSessions):
    """Real owner/title/partner configuration; each owner's worker is simulated.

    prepare-update holds only at the worker's own idle boundary (no local
    evolution in progress), exactly like updateBoundary in the engine.
    """
    def __init__(self, directory):
        super().__init__(directory)
        (directory/'config.json').write_text(json.dumps({'directory': str(directory), 'games': GAMES}))
        for owner in GAMES: (directory/owner).mkdir(exist_ok=True)
        self.lock = threading.RLock()
        self.status = {}; self.commands = []; self.launches = []; self.retired = []; self.checkpoints = {}

    def _live(self, game): return self.status.get(game)
    def _owner_pid(self, game): return 42 if game in self.status else None

    def command(self, game, body, session_id=None):
        live = self.status[game]
        if session_id != live['sessionId']: raise ValueError('Owner changed')
        self.commands.append((game, body['type']))
        update = live['runtime']['update']
        if body['type'] == 'prepare-update':
            busy = (live.get('localEvolution') or {}).get('phase') not in (None, 'complete')
            update.update(id=body['updateId'], held=not busy, checkpoint={'id': body['updateId'], 'frame': 7} if not busy else None)
        elif body['type'] == 'resume-update':
            if not update['held'] or update['checkpoint']['id'] != body['updateId']: raise ValueError('Not held')
            update['held'] = False
        return live

    def ensure(self, game, *, manual=False, update_hold=False):
        selection = json.loads((self.directory/game/'runtime-selection.json').read_text())
        self.launches.append((game, selection['lock'], update_hold))
        # The relaunched owner keeps its saved bot policy (a partner idles for commands).
        extra = {'bot': {'enabled': True, 'awaitingCommand': True, 'status': 'ready', 'mode': 'evolution-partner'}} if game == 'firered-partner' else {}
        self.status[game] = owner_status(game, selection['lock'], session=game+'-next',
                                         update={'id': None, 'held': update_hold, 'checkpoint': self.checkpoints.get(game)}, **extra)
        return self.status[game]


def owner_status(owner, run_lock, *, session=None, update=None, **extra):
    return {'schema': 'pokemon-suite/session/v1', 'game': 'firered' if owner != 'emerald' else 'emerald', 'owner': owner,
            'sessionId': session or owner+'-session',
            'runtime': {'protocol': 1, 'lock': run_lock, 'update': update or {'id': None, 'held': False, 'checkpoint': None}}, **extra}


def idle_partner(run_lock):
    return owner_status('firered-partner', run_lock, bot={'enabled': True, 'awaitingCommand': True, 'status': 'ready', 'mode': 'evolution-partner'},
                        localEvolution=None)


class PartnerUpdateTests(unittest.TestCase):
    def setUp(self):
        tmp = tempfile.TemporaryDirectory(); self.addCleanup(tmp.cleanup)
        self.root = Path(tmp.name); self.sessions = Owners(self.root)
        self.manager = UpdateManager(self.sessions); self.manager.start = lambda: None
        key = Ed25519PrivateKey.generate()
        self.manager.store.trust_key(base64.b64encode(key.public_key().public_bytes(Encoding.Raw, PublicFormat.Raw)).decode(), label='Test')
        self.old = self.manager.store.install(package(self.root, key, version='1.0.0'))['digest']
        self.new = self.manager.store.install(package(self.root, key, version='1.0.1', files={'engine/worker.js': b'process.stdout.write("new")'}))['digest']
        self.manager.store.activate('firered', self.old)
        self.old_lock = lock(self.manager.store._graph(self.old, 'firered'))
        self.new_lock = lock(self.manager.store._graph(self.new, 'firered'))
        # Both owners were launched on the old engine and pinned it.
        for owner in ('firered', 'firered-partner'):
            self.select(owner, {'lock': self.old_lock, 'bundledWorker': f'/old/{owner}/session-worker.js', 'componentLocks': {}, 'plannerLock': None})
        self.emerald = {'lock': None, 'bundledWorker': '/bundled/emerald.js', 'componentLocks': {}, 'plannerLock': None}
        self.select('emerald', self.emerald)

    def select(self, owner, value): (self.root/owner/'runtime-selection.json').write_text(json.dumps(value))
    def selection(self, owner): return json.loads((self.root/owner/'runtime-selection.json').read_text())
    def partner_rows(self): return [r for r in self.manager.journal.recent() if r['game'] == 'firered-partner']
    def run_rows(self, limit=12):
        for _ in range(limit):
            rows = [r for r in self.manager.journal.recent() if r['state'] in {'waiting', 'checkpointed', 'activating', 'healthy'}]
            if not rows: return
            for row in rows: self.manager.step(row)

    def test_a_stopped_partner_is_repinned_with_its_title_engine_update(self):
        row = self.manager.apply('firered', self.new, 'title-update-1')
        self.assertEqual(row['state'], 'activated')
        self.assertEqual(self.selection('firered')['lock'], self.new_lock)
        # Base: the partner kept the old pin and would launch the old engine.
        partner = self.selection('firered-partner')
        self.assertEqual(partner['lock'], self.new_lock, 'the partner follows its title engine')
        self.assertEqual({k: partner[k] for k in ('bundledWorker', 'componentLocks', 'plannerLock')},
                         {'bundledWorker': '/old/firered-partner/session-worker.js', 'componentLocks': {}, 'plannerLock': None})
        self.assertEqual(self.manager.journal.get(row['id'])['detail']['partners'], {'firered-partner': {'state': 'pinned'}})
        # The partner's next launch resolves exactly the updated graph by title.
        package = self.manager.store.resolve('firered', lock=partner['lock'])
        self.assertEqual(package['lock']['packages'][0]['digest'], self.new)
        # Another title and its owner are untouched.
        self.assertEqual(self.selection('emerald'), self.emerald)
        self.assertEqual(self.sessions.commands, [])

    def test_a_live_idle_partner_is_handed_off_through_its_own_checkpoint(self):
        self.sessions.status['firered-partner'] = idle_partner(self.old_lock)
        self.sessions.checkpoints['firered-partner'] = None
        retire = self.manager._retire
        def retired(game, session_id):
            self.assertTrue(self.sessions.status[game]['runtime']['update']['held'], 'retired only while held at its checkpoint')
            self.sessions.checkpoints[game] = self.sessions.status[game]['runtime']['update']['checkpoint']
            self.sessions.retired.append(game); del self.sessions.status[game]
        self.manager._retire = retired
        row = self.manager.apply('firered', self.new, 'title-update-2')
        self.assertEqual(row['state'], 'activated')
        rows = self.partner_rows()
        self.assertEqual(len(rows), 1, 'a live partner gets a journaled handoff')
        self.assertEqual((rows[0]['state'], rows[0]['target']), ('waiting', self.new))
        # Its selection is unchanged until the checkpoint (rollback keeps the previous pin).
        self.assertEqual(self.selection('firered-partner')['lock'], self.old_lock)
        self.run_rows()
        done = self.manager.journal.get(rows[0]['id'])
        self.assertEqual(done['state'], 'resumed')
        self.assertEqual(done['detail']['previous']['lock'], self.old_lock)
        self.assertEqual(self.sessions.retired, ['firered-partner'])
        self.assertEqual(self.sessions.launches, [('firered-partner', self.new_lock, True)])
        self.assertEqual(self.selection('firered-partner')['lock'], self.new_lock)
        self.assertEqual(self.sessions.status['firered-partner']['runtime']['update']['held'], False)
        self.assertEqual(self.sessions.commands, [('firered-partner', 'prepare-update'), ('firered-partner', 'resume-update')])
        # The partner never changes the title's active package.
        self.assertEqual(self.manager.store.status()['active']['engine:firered'], self.new)
        self.manager._retire = retire

    def test_a_partner_in_a_paired_exchange_is_never_handed_off_until_it_is_idle(self):
        busy = idle_partner(self.old_lock)
        busy['bot'].update(awaitingCommand=False, status='running', preparation={'requestId': 'team-partner-1', 'phase': 'ready-for-transfer'})
        busy['localEvolution'] = {'requestId': 'team-partner-1', 'phase': 'waiting-for-evolution'}
        self.sessions.status['firered-partner'] = busy
        self.manager.apply('firered', self.new, 'title-update-3')
        [row] = self.partner_rows()
        for _ in range(3): self.manager.step(self.manager.journal.get(row['id']))
        self.assertEqual(self.manager.journal.get(row['id'])['state'], 'waiting')
        self.assertEqual(self.sessions.commands, [], 'no update command reaches a partner during an exchange')
        self.assertEqual(self.selection('firered-partner')['lock'], self.old_lock)
        # The exchange finished and the partner idles again: now it hands off.
        self.sessions.status['firered-partner'] = idle_partner(self.old_lock)
        def retired(game, session_id):
            self.sessions.checkpoints[game] = self.sessions.status[game]['runtime']['update']['checkpoint']; del self.sessions.status[game]
        self.manager._retire = retired
        self.run_rows()
        self.assertEqual(self.manager.journal.get(row['id'])['state'], 'resumed')
        self.assertEqual(self.selection('firered-partner')['lock'], self.new_lock)

    def test_a_partner_that_stops_during_its_handoff_finishes_it_after_its_next_launch(self):
        busy = idle_partner(self.old_lock); busy['localEvolution'] = {'requestId': 'team-partner-2', 'phase': 'joining'}
        busy['bot']['awaitingCommand'] = False
        self.sessions.status['firered-partner'] = busy
        self.manager.apply('firered', self.new, 'title-update-4')
        [row] = self.partner_rows()
        del self.sessions.status['firered-partner']
        self.manager.step(self.manager.journal.get(row['id']))
        self.assertEqual(self.manager.journal.get(row['id'])['state'], 'waiting', 'the handoff waits for the next launch')
        self.assertEqual(self.selection('firered-partner')['lock'], self.old_lock)
        # It was held at this checkpoint just before it stopped: the next launch
        # starts held from its saved checkpoint and the same handoff resumes it.
        checkpoint = {'id': row['id'], 'frame': 9}
        self.sessions.status['firered-partner'] = idle_partner(self.old_lock)
        self.sessions.status['firered-partner']['runtime']['update'] = {'id': row['id'], 'held': True, 'checkpoint': checkpoint}
        def retired(game, session_id):
            self.sessions.checkpoints[game] = self.sessions.status[game]['runtime']['update']['checkpoint']; del self.sessions.status[game]
        self.manager._retire = retired
        self.run_rows()
        self.assertEqual(self.manager.journal.get(row['id'])['state'], 'resumed')
        self.assertEqual(self.selection('firered-partner')['lock'], self.new_lock)
        self.assertEqual(self.sessions.status['firered-partner']['runtime']['update']['held'], False)

    def test_a_newer_title_update_supersedes_or_follows_an_earlier_partner_handoff(self):
        key = Ed25519PrivateKey.generate()
        self.manager.store.trust_key(base64.b64encode(key.public_key().public_bytes(Encoding.Raw, PublicFormat.Raw)).decode(), label='Test 2')
        newest = self.manager.store.install(package(self.root, key, version='1.0.2', files={'engine/worker.js': b'process.stdout.write("newest")'}))['digest']
        newest_lock = lock(self.manager.store._graph(newest, 'firered'))
        busy = idle_partner(self.old_lock); busy['localEvolution'] = {'requestId': 'team-partner-3', 'phase': 'waiting-for-evolution'}
        busy['bot']['awaitingCommand'] = False
        self.sessions.status['firered-partner'] = busy
        self.manager.apply('firered', self.new, 'title-update-6')
        [first] = self.partner_rows()
        # A newer title engine replaces a handoff the partner has not held for.
        self.manager.apply('firered', newest, 'title-update-7')
        rows = {r['target']: r for r in self.partner_rows()}
        self.assertEqual(rows[self.new]['state'], 'cancelled')
        self.assertEqual(rows[newest]['state'], 'waiting')
        # Held for an earlier handoff: that one finishes first, then the partner follows again.
        self.sessions.status['firered-partner'] = idle_partner(self.old_lock)
        self.manager.step(self.manager.journal.get(rows[newest]['id']))  # prepare-update: held
        third = self.manager.store.install(package(self.root, key, version='1.0.3', files={'engine/worker.js': b'process.stdout.write("third")'}))['digest']
        third_lock = lock(self.manager.store._graph(third, 'firered'))
        applied = self.manager.apply('firered', third, 'title-update-8')
        self.assertEqual(applied['detail']['partners']['firered-partner']['state'], 'deferred')
        def retired(game, session_id):
            self.sessions.checkpoints[game] = self.sessions.status[game]['runtime']['update']['checkpoint']; del self.sessions.status[game]
        self.manager._retire = retired
        for _ in range(6):
            if self.manager.journal.get(rows[newest]['id'])['state'] == 'resumed': break
            self.manager.step(self.manager.journal.get(rows[newest]['id']))
        self.assertEqual(self.manager.journal.get(rows[newest]['id'])['state'], 'resumed')
        # The earlier partner handoff never moves the title's active package back.
        self.assertEqual(self.manager.store.status()['active']['engine:firered'], third)
        self.run_rows(limit=20)
        states = sorted((r['target'], r['state']) for r in self.partner_rows())
        self.assertEqual(states, sorted([(self.new, 'cancelled'), (newest, 'resumed'), (third, 'resumed')]))
        self.assertEqual(self.selection('firered-partner')['lock'], third_lock)
        self.assertEqual(self.selection('firered')['lock'], third_lock)
        # An earlier partner handoff never moves the title's active package back.
        self.assertEqual(self.manager.store.status()['active']['engine:firered'], third)

    def test_a_live_title_update_moves_its_partner_after_the_title_resumes(self):
        self.sessions.status['firered'] = owner_status('firered', self.old_lock)
        def retired(game, session_id):
            self.sessions.checkpoints[game] = self.sessions.status[game]['runtime']['update']['checkpoint']; del self.sessions.status[game]
        self.manager._retire = retired
        row = self.manager.apply('firered', self.new, 'title-update-5')
        self.assertEqual(row['state'], 'waiting')
        self.manager.step(self.manager.journal.get(row['id']))  # prepare-update: held at the idle field
        for _ in range(4):
            if self.manager.journal.get(row['id'])['state'] in {'resumed', 'failed', 'rolled-back'}: break
            # Not followed before the title's own handoff has resumed.
            self.assertEqual(self.selection('firered-partner')['lock'], self.old_lock)
            self.manager.step(self.manager.journal.get(row['id']))
        done = self.manager.journal.get(row['id'])
        self.assertEqual(done['state'], 'resumed')
        self.assertEqual(self.selection('firered')['lock'], self.new_lock)
        self.assertEqual(self.selection('firered-partner')['lock'], self.new_lock)
        self.assertEqual(done['detail']['partners'], {'firered-partner': {'state': 'pinned'}})

    def test_the_updater_still_refuses_to_target_a_partner_owner_directly(self):
        with self.assertRaisesRegex(ValueError, 'follows'):
            self.manager.apply('firered-partner', self.new, 'partner-direct-1')
        self.assertEqual(self.manager.journal.recent(), [])
        self.assertEqual(self.selection('firered-partner')['lock'], self.old_lock)


if __name__ == '__main__':
    unittest.main()
