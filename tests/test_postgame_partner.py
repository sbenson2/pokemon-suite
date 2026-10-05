import json
from pathlib import Path
import tempfile
import threading
import unittest
from pokemon_suite.postgame_partner import PostgamePartners

class Sessions:
    def __init__(self, directory):
        self.directory=Path(directory);self.lock=threading.RLock();self.commands=[]
        self.source={'game':'firered','sessionId':'red','bot':{'enabled':True,'runScope':'postgame','preparation':{'automatic':True,'requestId':'dex-partner-1','phase':'waiting-for-transfer'}},'localEvolution':None}
        self.peer={'game':'emerald','sessionId':'green','bot':{'enabled':True,'awaitingCommand':True},'control':{'mode':'bot','manualSessionCount':0},'gameProgress':{'leagueComplete':True}}
    def configured(self,game):return True
    def _live(self,game):return self.source if game=='firered' else self.peer
    def command(self,game,body,session_id=None):
        self.commands.append((game,body,session_id))
        if game=='emerald':self.peer['bot'].update(mode='evolution-partner',preparation={'requestId':body['requestId'],'phase':'preparing'})
        else:self.source['bot']['preparation']={'phase':'complete'}

class PartnerTests(unittest.TestCase):
    def test_prepares_only_the_matching_idle_companion_and_restarts_idempotently(self):
        with tempfile.TemporaryDirectory() as root:
            sessions=Sessions(root);coordinator=PostgamePartners(sessions);coordinator.tick()
            self.assertEqual(sessions.commands,[('emerald',{'type':'prepare-partner','requestId':'dex-partner-1','automatic':True},'green')])
            PostgamePartners(sessions).tick();self.assertEqual(len(sessions.commands),1)
            availability=json.loads((Path(root)/'firered/partner-availability.json').read_text());self.assertTrue(availability['available'])
    def test_manual_disabled_other_task_or_update_owner_is_never_replaced(self):
        for change in [lambda s:s.peer['control'].update(mode='manual'),lambda s:s.peer['bot'].update(enabled=False),lambda s:s.peer['bot'].update(awaitingCommand=False,mode='campaign'),lambda s:s.peer.update(runtime={'update':{'held':True}})]:
            with tempfile.TemporaryDirectory() as root:
                s=Sessions(root);change(s);PostgamePartners(s).tick()
                self.assertFalse(any(game=='emerald' for game,_,_ in s.commands));self.assertEqual(s.commands[0][1]['type'],'defer-partner-evolution')
    def test_stop_and_explicit_farming_requests_remain_authoritative(self):
        for change in [lambda s:s.source['bot'].update(enabled=False),lambda s:s.source['bot']['preparation'].update(automatic=False),lambda s:s.source.update(localEvolution={'phase':'trading'})]:
            with tempfile.TemporaryDirectory() as root:
                s=Sessions(root);change(s);PostgamePartners(s).tick();self.assertEqual(s.commands,[])
    def test_a_library_without_any_partner_game_says_none_is_set_up(self):
        # A new user's library has FireRed only: no Emerald and no FireRed
        # partner. The deferral must not ask them to start an Emerald bot.
        with tempfile.TemporaryDirectory() as root:
            s=Sessions(root);s.configured=lambda game:game=='firered';PostgamePartners(s).tick()
            (game,body,_),=s.commands
            self.assertEqual((game,body['type']),('firered','defer-partner-evolution'))
            self.assertNotIn('Emerald',body['reason']);self.assertIn('No trade partner game is set up',body['reason'])
            availability=json.loads((Path(root)/'firered/partner-availability.json').read_text())
            self.assertEqual((availability['available'],availability['reason']),(False,body['reason']))
