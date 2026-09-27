import json
from pathlib import Path
import tempfile
import unittest
from pokemon_suite.trading import trade_blocker, radio_arguments, TradingLibrary
from types import SimpleNamespace
from unittest.mock import Mock, patch


class TradingTests(unittest.TestCase):
    def test_local_appliance_requires_a_compatible_game_owner(self):
        live={'state':'ready','tradeSupport':{'inventory':True,'nativeRadio':True,'inventoryReady':True}}
        self.assertIn('update',trade_blocker('firered',live,{'ready':True,'transport':'appliance'}).lower())
        live['tradeSupport']['radioAppliance']=True
        self.assertIsNone(trade_blocker('firered',live,{'ready':True,'transport':'appliance'}))

    def test_local_radio_is_detected_automatically_without_an_ssh_check(self):
        with tempfile.TemporaryDirectory() as d:
            sessions=SimpleNamespace(directory=Path(d),config=lambda:{'games':{'firered':{}},'radioRuntime':{'root':'/app/radio'}})
            library=TradingLibrary(sessions)
            with patch('pokemon_suite.radio_appliance.readiness',return_value={'ready':True,'configured':True,'state':'ready'}), \
                 patch('pokemon_suite.trading.subprocess.run',side_effect=AssertionError('Unexpected SSH probe')):
                result=library.radio_status('firered')
            self.assertTrue(result['ready'])
            self.assertEqual(library.radio_config('firered')['transport'],'appliance')

    def test_selected_key_file_preserves_existing_radio_options(self):
        with tempfile.TemporaryDirectory() as d:
            root=Path(d);(root/'firered').mkdir();settings=root/'firered/wireless.json'
            settings.write_text(json.dumps({'host':'user@host','bindAddress':'192.168.64.1'}))
            keys=root/'console.keys';keys.write_text('\n'.join(k+' = '+'00'*16 for k in ['master_key_00','master_key_12','aes_kek_generation_source','aes_key_generation_source']))
            sessions=SimpleNamespace(directory=root,config=lambda:{'games':{'firered':{}}})
            library=TradingLibrary(sessions)
            library.set_radio_keys('firered',str(keys))
            saved=json.loads(settings.read_text())
            self.assertEqual(saved['host'],'user@host')
            self.assertEqual(saved['keysPath'],str(keys.resolve()))
            self.assertEqual(saved['transport'],'appliance')

    def test_game_close_accepts_only_a_cancelled_trade_with_verified_exit(self):
        from pokemon_suite.pokemon_sessions import SuiteSessions
        for verified in [False,True]:
            with tempfile.TemporaryDirectory() as temporary:
                root=Path(temporary);folder=root/'firered';folder.mkdir()
                (folder/'owner.lock').write_text(json.dumps({'pid':123,'game':'firered'}))
                live={'schema':'pokemon-suite/session/v1','game':'firered','sessionId':'owner','state':'paused','bot':{'enabled':False},'control':{'mode':'bot','paused':True},'nativeTrade':{'phase':'cancelled','cancellation':{'exitVerified':verified}}}
                owner=SuiteSessions(root);owner.config=lambda:{'games':{'firered':{}}};owner.pause_collection=lambda *args:None
                def current(game):
                    if game!='firered':return None
                    if (folder/'command.json').exists():
                        (folder/'owner.lock').unlink(missing_ok=True);return None
                    return live
                owner._live=current;owner.command=lambda *args,**kwargs:live
                result=owner.stop_game('firered','owner')
                self.assertEqual(result['state'],'closed' if verified else 'paused')
                self.assertEqual((folder/'command.json').exists(),verified)

    def test_a_cancelled_exchange_allows_a_new_selection_only_after_verified_exit(self):
        live={'state':'ready','tradeSupport':{'inventory':True,'nativeRadio':True,'inventoryReady':True},'nativeTrade':{'phase':'cancelled','cancellation':{'exitVerified':True}}}
        self.assertIsNone(trade_blocker('firered',live,{'ready':True}))
        live['nativeTrade']['cancellation']['exitVerified']=False
        self.assertIsNotNone(trade_blocker('firered',live,{'ready':True}))
        live['nativeTrade']['cancellation']['exitVerified']=True
        live['nativeTrade']['exchangeStarted']=True
        self.assertIsNotNone(trade_blocker('firered',live,{'ready':True}))

    def test_owned_inventory_can_prepare_without_a_completed_hunt_but_not_with_an_unsaved_capture(self):
        live={'sessionId':'a','state':'paused','tradeSupport':{'inventory':True,'nativeRadio':True,'missionReady':False,'inventoryReady':True}}
        self.assertIsNone(trade_blocker('firered',live,{'ready':True}))
        live['tradeSupport'].update(inventoryReady=False,inventoryReason='Save the protected encounter first.')
        self.assertIn('protected',trade_blocker('firered',live,{'ready':True}))

    def test_saved_trade_plan_loads_the_owning_library_and_rejects_a_changed_individual(self):
        with tempfile.TemporaryDirectory() as temporary:
            root=Path(temporary).resolve();current=root/'current';current.mkdir()
            legacy=root/'collection';folder=legacy/'firered/save-profiles';folder.mkdir(parents=True)
            (legacy/'config.json').write_text(json.dumps({'games':{'firered':{}}}))
            record=folder/'aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee.json'
            record.write_text(json.dumps({'id':record.stem,'label':'Collection'}))
            (folder/record.stem).mkdir();(folder/record.stem/'current.json').write_text('{}')
            sessions=SimpleNamespace(directory=current,config=lambda:{'games':{'firered':{}}},_live=lambda game:None)
            library=TradingLibrary(sessions);source=library.sources.record('firered',str(record));library.sources.link('firered',source)
            library.radio_status=lambda game:{'ready':False,'configured':True}
            library._snapshot=lambda game,source:{'game':game,'validity':'valid','pokemon':[{'id':'a'*64,'species':197,'nationalSpeciesId':197,'shiny':True}]}
            result=library.inventory('firered')
            self.assertTrue(result['pokemon'][0]['canPrepare'])
            self.assertFalse(result['pokemon'][0]['canTrade'])
            plan=library.trade_plan('firered','a'*64,source['id'])
            self.assertEqual(plan['load'],{'libraryPath':str(legacy),'profileId':record.stem})
            self.assertEqual(plan['pokemonId'],'a'*64)
            with self.assertRaises(ValueError):library.trade_plan('firered','b'*64,source['id'])
            with self.assertRaises(ValueError):library.trade_plan('firered','a'*64,'missing-source')
            self.assertFalse((current/'firered/active-hunt.json').exists())

    def test_archived_inventory_cannot_inherit_the_current_game_trade_session(self):
        sessions=SimpleNamespace(directory=Path('/unused'),config=lambda:{'games':{'firered':{}}},_live=Mock())
        library=TradingLibrary(sessions)
        source={'id':'saved-a','kind':'saved','label':'Shiny collection'}
        library.sources=SimpleNamespace(resolve=lambda *args:source,list=lambda game:[source])
        library.radio_status=lambda game:{'ready':True}
        library._snapshot=lambda game,source:{'game':game,'validity':'valid','pokemon':[{'id':'a'*64,'species':197,'nationalSpeciesId':197,'shiny':True}]}
        result=library.inventory('firered')
        self.assertEqual(result['saveLabel'],'Shiny collection')
        self.assertTrue(result['pokemon'][0]['shiny']);self.assertFalse(result['pokemon'][0]['canTrade'])
        self.assertIsNone(result['sessionId']);self.assertIsNone(result['trade']);sessions._live.assert_not_called()

    def test_missing_radio_and_story_ownership_are_not_reported_as_trade_ready(self):
        live={'sessionId':'a','state':'ready','tradeSupport':{'inventory':True,'nativeRadio':True,'missionReady':True}}
        self.assertIsNone(trade_blocker('firered',live,{'ready':True}))
        self.assertIsNotNone(trade_blocker('emerald',live,{'ready':True}))
        self.assertIn('story',trade_blocker('firered',{**live,'campaign':{'status':'running'}},{'ready':True}).lower())
        self.assertIsNotNone(trade_blocker('firered',None,{'ready':True}))
        self.assertIn('radio',trade_blocker('firered',live,{'ready':False}).lower())
        self.assertIsNotNone(trade_blocker('firered',{**live,'nativeTrade':{'phase':'saving','exchangeStarted':True}},{'ready':True}))

    def test_radio_binding_remains_an_argument_and_rejects_invalid_hosts(self):
        with tempfile.TemporaryDirectory() as root:
            known=Path(root)/'known_hosts';known.write_text('test-host-key')
            args=radio_arguments({'host':'user@192.168.64.2','knownHosts':str(known),'bindAddress':'192.168.64.1'})
            self.assertEqual(args[args.index('-b')+1],'192.168.64.1')
            self.assertIn('StrictHostKeyChecking=yes',args)
            for update in [{'host':'-oProxyCommand=evil'},{'bindAddress':'192.168.64.1;echo bad'},{'knownHosts':'missing'}]:
                with self.assertRaises(ValueError):radio_arguments({'host':'user@192.168.64.2','knownHosts':str(known),**update})

    def test_selected_individual_is_revalidated_and_sent_to_its_own_session(self):
        class Sessions:
            directory=Path('/unused')
            def command(self,game,command,session_id=None):return {'game':game,'command':command,'sessionId':session_id}
        library=TradingLibrary(Sessions())
        # Snapshot/transport access is the external boundary; command payload is real.
        library.inventory=lambda game,source_id=None:{'sessionId':'owner-a','pokemon':[{'id':'a'*64,'canTrade':True}]}
        value=library.trade('firered','a'*64,'owner-a')
        self.assertEqual(value['command'],{'type':'trade-pokemon','pokemonId':'a'*64})
        self.assertEqual(value['sessionId'],'owner-a')
        with self.assertRaises(ValueError):library.trade('firered','a'*64,'owner-b')
        with self.assertRaises(ValueError):library.trade('firered','b'*64,'owner-a')
        with self.assertRaisesRegex(ValueError,'active'):library.trade('firered','a'*64,'owner-a',source_id='archived-save')


class InterruptedTradeLifecycleTests(unittest.TestCase):
    def test_saved_interruption_requires_field_and_native_save_proof_before_releasing_owner(self):
        from pokemon_suite.trade_state import native_trade_finished
        state={'phase':'interrupted','exchangeStarted':True,'completion':{'nativeSaveVerified':True,'saveHandshakeVerified':True},'recovery':{'fieldVerified':True}}
        self.assertTrue(native_trade_finished(state))
        for value in [{**state,'recovery':{}},{**state,'completion':{}},{**state,'phase':'trade-outcome-unresolved'}]:self.assertFalse(native_trade_finished(value))
