"""A second FireRed owner serves trade evolutions as an invisible partner."""
import json
from pathlib import Path
import tempfile
import threading
import unittest

from pokemon_suite.pokemon_sessions import SuiteSessions
from pokemon_suite.postgame_partner import PostgamePartners


class Owners(SuiteSessions):
    """Real SuiteSessions with each owner's status served from memory."""
    def __init__(self, directory, games):
        super().__init__(directory)
        (directory/'config.json').write_text(json.dumps({'directory': str(directory), 'games': games}))
        for owner in games:(directory/owner).mkdir(exist_ok=True)
        self.status = {}
        self.sent = []

    def _live(self, game):
        live = self.status.get(game)
        path = self.directory/game/'command.json'
        if live and path.exists():
            command = json.loads(path.read_text())
            if command['commandId'] != live.get('lastCommand'):
                self.sent.append((game, {k: v for k, v in command.items() if k not in {'commandId', 'sessionId'}}))
                live['lastCommand'] = command['commandId']
                if command['type'] == 'set-bot':
                    live.setdefault('bot', {})['enabled'] = command['enabled']
                    live['control'] = {'mode': 'bot', 'paused': True}
        return live


GAMES = {'firered': {'port': 1}, 'firered-partner': {'title': 'firered', 'role': 'partner', 'port': 2}}


def status(owner, title='firered', **extra):
    return {'schema': 'pokemon-suite/session/v1', 'game': title, 'owner': owner, 'sessionId': owner + '-session', **extra}


class FireRedPartnerOwnerTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        self.root = Path(self.temp.name)

    def test_owner_keys_are_distinct_from_the_cartridge_title_and_the_partner_is_invisible(self):
        s = Owners(self.root, GAMES)
        self.assertEqual(s.title('firered-partner'), 'firered')
        self.assertEqual(s.title('firered'), 'firered')
        self.assertEqual(s.partner_owners(), [('firered-partner', 'firered')])
        s.status['firered-partner'] = status('firered-partner', bot={'enabled': True, 'awaitingCommand': True, 'mode': 'evolution-partner'})
        s.status['firered'] = status('firered', bot={'enabled': True})
        # Commands reach the partner's own mailbox and identity, never the main FireRed owner.
        s.command('firered-partner', {'type': 'set-bot', 'enabled': True}, session_id='firered-partner-session')
        self.assertTrue((self.root/'firered-partner/command.json').exists())
        self.assertFalse((self.root/'firered/command.json').exists())
        # A status whose owner differs is another emulator's port.
        s.status['firered-partner'] = status('firered')
        with self.assertRaises(ValueError):
            s.command('firered-partner', {'type': 'set-bot', 'enabled': True}, session_id='firered-session')
        s.status['firered-partner'] = status('firered-partner', bot={'enabled': True})
        # Invisible: no library/session tile, and never assigned tasks.
        self.assertEqual([x.get('owner', x['game']) for x in s.snapshots()], ['firered'])
        self.assertEqual([x['owner'] for x in s.partner_snapshots()], ['firered-partner'])
        for action in ('start', 'collection', 'postgame', 'new-save', 'open-trade'):
            with self.assertRaisesRegex(ValueError, 'never assigned tasks'):
                s.player_task('firered-partner', action, {})

    def test_stopping_or_pausing_the_source_also_pauses_its_paired_firered_partner(self):
        s = Owners(self.root, GAMES)
        local = {'requestId': 'team-partner-10-2-68', 'phase': 'waiting-for-evolution'}
        s.status['firered'] = status('firered', bot={'enabled': True, 'preparation': {'requestId': local['requestId']}}, localEvolution=local)
        s.status['firered-partner'] = status('firered-partner', bot={'enabled': True, 'mode': 'evolution-partner', 'preparation': {'requestId': local['requestId']}}, localEvolution=dict(local))
        s.set_bot('firered', False)
        self.assertEqual([(g, b['type'], b.get('enabled')) for g, b in s.sent], [('firered', 'set-bot', False), ('firered-partner', 'set-bot', False)])
        s.sent.clear()
        s.status['firered']['bot']['enabled'] = True
        s.stop_game('firered', 'firered-session')
        self.assertEqual([g for g, _ in s.sent], ['firered', 'firered-partner'])


class Coordinator:
    def __init__(self, root, games):
        self.directory = Path(root);self.lock = threading.RLock();self.commands = [];self.games = games
        self.source = {'game': 'firered', 'owner': 'firered', 'sessionId': 'red', 'gameProgress': {'trainerId': 10933},
                       'bot': {'enabled': True, 'runScope': 'postgame', 'preparation': {'automatic': True, 'requestId': 'team-partner-1', 'phase': 'waiting-for-transfer', 'partnerOwner': 'firered-partner'}}, 'localEvolution': None}
        self.partner = {'game': 'firered', 'owner': 'firered-partner', 'sessionId': 'shiny', 'gameProgress': {'trainerId': 8185, 'leagueComplete': False},
                        'bot': {'enabled': True, 'awaitingCommand': True, 'mode': 'evolution-partner'}, 'control': {'mode': 'manual', 'paused': True, 'manualSessionCount': 0}}
    def config(self): return {'games': self.games}
    def configured(self, game): return game in self.games
    def partner_owners(self): return SuiteSessions.partner_owners(self)
    def _live(self, game): return {'firered': self.source, 'firered-partner': self.partner}.get(game)
    def command(self, game, body, session_id=None):
        self.commands.append((game, body, session_id))
        if game == 'firered-partner': self.partner['bot'].update(awaitingCommand=False, preparation={'requestId': body['requestId'], 'phase': 'ready-for-transfer'})
        else: self.source['bot']['preparation'] = {'phase': 'complete'}


class FireRedPartnerCoordinatorTests(unittest.TestCase):
    def test_only_the_firered_partner_is_prepared_with_its_source_owner_and_listed_as_available(self):
        with tempfile.TemporaryDirectory() as root:
            s = Coordinator(root, GAMES);PostgamePartners(s).tick()
            self.assertEqual(s.commands, [('firered-partner', {'type': 'prepare-partner', 'requestId': 'team-partner-1', 'automatic': True, 'sourceOwner': 'firered'}, 'shiny')])
            availability = json.loads((Path(root)/'firered/partner-availability.json').read_text())
            self.assertTrue(availability['available'])
            self.assertEqual(availability['partners'], [{'owner': 'firered-partner', 'title': 'firered'}])
            PostgamePartners(s).tick();self.assertEqual(len(s.commands), 1)

    def test_an_automatic_player_task_prepares_its_selected_firered_partner(self):
        """A task-scoped evolution owns the same verified transfer contract as the checklist."""
        with tempfile.TemporaryDirectory() as root:
            s = Coordinator(root, GAMES)
            s.source['bot']['runScope'] = 'task'

            PostgamePartners(s).tick()

            self.assertEqual(s.commands, [('firered-partner', {
                'type': 'prepare-partner',
                'requestId': 'team-partner-1',
                'automatic': True,
                'sourceOwner': 'firered',
            }, 'shiny')])
            PostgamePartners(s).tick()
            self.assertEqual(len(s.commands), 1, 'reconstructing the coordinator remains idempotent')

    def test_a_task_scoped_request_keeps_the_transaction_guards(self):
        for change in [
            lambda s: s.source['bot'].update(enabled=False),
            lambda s: s.source['bot']['preparation'].update(automatic=False),
            lambda s: s.source.update(localEvolution={'phase': 'trading'}),
        ]:
            with tempfile.TemporaryDirectory() as root:
                s = Coordinator(root, GAMES)
                s.source['bot']['runScope'] = 'task'
                change(s)

                PostgamePartners(s).tick()

                self.assertEqual(s.commands, [])

    def test_a_partner_sharing_the_source_trainer_id_or_waiting_is_unavailable_and_the_evolution_defers(self):
        for change, pattern in [(lambda s: s.partner['gameProgress'].update(trainerId=10933), 'trainer ID'),
                                (lambda s: s.partner['bot'].update(awaitingCommand=False, preparation={'requestId': 'team-partner-1', 'phase': 'waiting', 'reason': 'Save the FireRed partner in this Pokémon Center before it serves a trade.'}), 'Save the FireRed partner'),
                                (lambda s: s.partner['bot'].update(enabled=False), 'stopped')]:
            with tempfile.TemporaryDirectory() as root:
                s = Coordinator(root, GAMES);change(s);PostgamePartners(s).tick()
                self.assertEqual([(g, b['type']) for g, b, _ in s.commands], [('firered', 'defer-partner-evolution')])
                self.assertRegex(s.commands[0][1]['reason'], pattern)
                availability = json.loads((Path(root)/'firered/partner-availability.json').read_text())
                self.assertFalse(availability['available']);self.assertEqual(availability['partners'], [])

    def test_an_emerald_request_never_prepares_the_firered_partner(self):
        with tempfile.TemporaryDirectory() as root:
            s = Coordinator(root, GAMES);del s.source['bot']['preparation']['partnerOwner'];PostgamePartners(s).tick()
            self.assertEqual([(g, b['type']) for g, b, _ in s.commands], [('firered', 'defer-partner-evolution')])


if __name__ == '__main__':
    unittest.main()
