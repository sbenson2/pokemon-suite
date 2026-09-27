import test from 'node:test';
import assert from 'node:assert/strict';
import {inspectSavedTradeRecovery,settleNativeLinkError} from '../src/suite/native-trade-recovery.js';
const before={validity:'valid',species:52,personality:1,otId:2,ivs:{hp:1,attack:1,defense:1,speed:1,spAttack:1,spDefense:1}},after={...before,species:113};
const state=()=>({phase:'trade-outcome-unresolved',map:'MAP_LAVENDER_TOWN_POKEMON_CENTER_2F',fingerprint:'[52,1,2,1,1,1,1,1,1]',partyBefore:['[52,1,2,1,1,1,1,1,1]'],exchangeStarted:true,completion:{receivedFingerprint:'[113,1,2,1,1,1,1,1,1]',tradeCount:8,saveHandshakeVerified:true}});
const observation=()=>({frame:100,phase:'stable',emulator:{callback2:'CB2_PrintErrorMessage',mainState:0,mode:'unknown'},playerMemory:{map:{id:'MAP_TRADE_CENTER'},trainer:{partyValidity:'valid',party:[after]},scripts:{fieldControlsLocked:false},ui:{}}});
const wireless={remotePlayers:0,wirelessCommType:1,tradeCount:8};
test('native error screen is allowed to paint without buttons, save changes or soft reset',()=>{
 let callback='CB2_LinkError',stage=0,frames=0;const session={step:b=>{assert.deepEqual(b,[]);frames++;if(callback==='CB2_LinkError')callback='CB2_PrintErrorMessage';else stage++;}};
 const observe=()=>({emulator:{callback2:callback,mainState:stage}});
 settleNativeLinkError(session,observe);assert.equal(callback,'CB2_PrintErrorMessage');assert.ok(stage>=1);assert.ok(frames<=4);
 callback='CB2_SaveAndEndTrade';frames=0;settleNativeLinkError(session,observe);assert.equal(frames,0);
});
test('a saved exchange verifies before using the native registration-counter return and never becomes a successful exit',()=>{
 const s=state(),o=observation();assert.equal(inspectSavedTradeRecovery(o,wireless,s).kind,'verify-save');
 s.completion.nativeSaveVerified=true;s.recovery={startedFrame:100};
 assert.equal(inspectSavedTradeRecovery(o,wireless,s).kind,'wait');o.emulator.mainState=160;
 assert.deepEqual(inspectSavedTradeRecovery(o,wireless,s).action.buttons,['a']);
 o.emulator={callback2:'CB2_Overworld',mode:'overworld',paletteFadeActive:false};o.playerMemory.map.id=s.map;
 assert.equal(inspectSavedTradeRecovery(o,wireless,s).kind,'recovered');
 assert.equal(s.completion.handshakeVerified,undefined);assert.equal(s.completion.linkClosedVerified,undefined);
});
test('unsaved, changed-party, active-link and unknown error states cannot release the trade',()=>{
 const o=observation();
 const unsafe=[{...state(),completion:null},{...state(),completion:{...state().completion,saveHandshakeVerified:false}}];
 for(const s of unsafe)assert.equal(inspectSavedTradeRecovery(o,wireless,s),null);
 assert.equal(inspectSavedTradeRecovery(o,{...wireless,remotePlayers:1},state()),null);
 o.playerMemory.trainer.party=[before];assert.equal(inspectSavedTradeRecovery(o,wireless,state()).kind,'blocked');
});

test('slow error-screen drawing may take several VBlanks and still paints before pausing',()=>{
 let frames=0;const session={step:b=>{assert.deepEqual(b,[]);frames++;}};
 settleNativeLinkError(session,()=>({emulator:{callback2:'CB2_PrintErrorMessage',mainState:frames<12?0:2}}));
 assert.equal(frames,12);
});
test('native ReloadSave may clear party memory during transition without permitting another A or a false completion',()=>{
 const s=state(),o=observation();s.completion.nativeSaveVerified=true;s.recovery={startedFrame:100,returnRequested:true};
 o.phase='transition';o.emulator.mainState=160;o.playerMemory.trainer={partyValidity:'invalid',party:[]};
 assert.equal(inspectSavedTradeRecovery(o,wireless,s).kind,'wait');
 o.phase='stable';o.emulator.callback2='CB2_Overworld';o.playerMemory.map.id=s.map;
 assert.equal(inspectSavedTradeRecovery(o,wireless,s).kind,'blocked');
});
