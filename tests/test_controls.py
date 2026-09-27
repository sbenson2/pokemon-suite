import json
from pathlib import Path
import tempfile
import unittest
from unittest.mock import patch, MagicMock
from pokemon_suite.pokemon_sessions import SuiteSessions


class ControlTests(unittest.TestCase):
    def test_hunt_retry_permission_is_forwarded_only_for_the_requested_start(self):
        with tempfile.TemporaryDirectory() as root:
            root=Path(root);(root/'config.json').write_text(json.dumps({'games':{'firered':{}}}))
            owner=SuiteSessions(root)
            record={'id':'hunt-a','request':{'game':'firered'}}
            live={'mission':{'id':'hunt-a'}}
            with patch.object(owner,'_live',return_value=live),patch.object(owner,'command',side_effect=lambda game,body:body):
                result=owner.start({**record,'retryBlockedPolicy':True})['session']
                self.assertIs(result.get('retryBlockedPolicy'),True)
                automatic=owner.start(record)['session']
                self.assertFalse(automatic.get('retryBlockedPolicy',False))
                self.assertNotIn('retryBlockedPolicy',automatic['record'])

    def test_stop_lobby_preserves_active_exchange_and_targets_observed_session(self):
        with tempfile.TemporaryDirectory() as root:
            root=Path(root);(root/'config.json').write_text(json.dumps({'games':{'firered':{'port':17639}}}))
            owner=SuiteSessions(root)
            live={'sessionId':'current','runId':'hunt-a','nativeTrade':{'phase':'saving','exchangeStarted':True}}
            with patch.object(owner,'_live',return_value=live),patch.object(owner,'command') as command:
                with self.assertRaisesRegex(ValueError,'exchange'):owner.stop_trade('firered')
                command.assert_not_called()
                live['nativeTrade']={'phase':'waiting','exchangeStarted':False}
                owner.stop_trade('firered')
                command.assert_called_once_with('firered',{'type':'stop','id':'hunt-a'},session_id='current')

    def test_firered_uses_its_owner_input_endpoint(self):
        with tempfile.TemporaryDirectory() as root:
            root=Path(root);(root/'config.json').write_text(json.dumps({'games':{'firered':{'port':17639}}}))
            owner=SuiteSessions(root)
            live={'schema':'pokemon-suite/session/v1','game':'firered','sessionId':'current'}
            response=MagicMock(status=200);response.read.return_value=b'{"mode":"manual","manualButtons":["UP","LEFT"]}'
            connection=MagicMock();connection.getresponse.return_value=response
            with patch.object(owner,'_live',return_value=live),patch('http.client.HTTPConnection',return_value=connection):
                result=owner.input('firered',{'buttons':['UP','LEFT']})
            self.assertEqual(result['manualButtons'],['UP','LEFT'])
            self.assertEqual(connection.request.call_args.args[:2],('POST','/control/input'))
            self.assertEqual(json.loads(connection.request.call_args.args[2]),{'buttons':['up','left']})
