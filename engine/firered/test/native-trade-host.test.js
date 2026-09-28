import test from 'node:test';
import assert from 'node:assert/strict';
import {FireRedNativeTradeHost,readNativeWirelessStatus,assertNativeTradeCanStop} from '../src/suite/native-trade-host.js';
import * as coldBoot from '../src/suite/native-cold-boot.js';
import {readNativeTradeUi,inspectNativeTradeExit} from '../src/suite/native-trade-room.js';
const fingerprint='[143,1845228247,2161188857,27,30,25,20,20,21]';
const pokemon={validity:'valid',species:143,personality:1845228247,otId:2161188857,ivs:{hp:27,attack:30,defense:25,speed:20,spAttack:20,spDefense:21}};
const map='MAP_LAVENDER_TOWN_POKEMON_CENTER_2F';
const world={data:{maps:[{id:map,objectEvents:[{script:'Other'},{script:'Common_EventScript_DirectCornerAttendant',x:10,y:2}]}]}};
const observation=()=>({phase:'stable',emulator:{mode:'overworld'},playerMemory:{map:{id:'MAP_LAVENDER_TOWN_POKEMON_CENTER_1F'},position:{x:7,y:4},trainer:{partyValidity:'valid',party:[pokemon,{validity:'valid',species:18}]},ui:{}}});
const create=()=>new FireRedNativeTradeHost({world,center:'MAP_LAVENDER_TOWN_POKEMON_CENTER_1F',fingerprint});

test('a native rejection leaves the room instead of offering the same Pokémon again',()=>{
 const task=create(),o=observation();o.emulator.callback2='CB2_TradeMenu';o.playerMemory.map.id='MAP_TRADE_CENTER';
 const w={tradeCount:5,remotePlayers:1,tradeMenu:{callback:8,cursor:0,partyCount:2,neighbors:[[12,0,0,0]]}};
 assert.deepEqual(task.inspect(o,w,{available:true,link:{session:true}}).action?.buttons,['a']);
 assert.equal(task.state.phase,'cancelling-trade');
 assert.equal(task.state.exchangeStarted,undefined);
 w.tradeMenu.callback=0;
 assert.deepEqual(task.inspect(o,w,{available:true,link:{session:true}}).action?.buttons,['up']);
 w.tradeMenu.cursor=12;assert.deepEqual(task.inspect(o,w).action?.buttons,['a']);
 w.tradeMenu.callback=4;w.tradeMenu.menuCursor=1;assert.deepEqual(task.inspect(o,w).action?.buttons,['up']);
 w.tradeMenu.menuCursor=0;assert.deepEqual(task.inspect(o,w).action?.buttons,['a']);
 o.emulator.callback2='CB2_Overworld';o.playerMemory.map.id=map;o.playerMemory.scripts={fieldControlsLocked:true};
 assert.equal(task.inspect(o,{remotePlayers:0,tradeCount:5}).kind,'wait');
 o.playerMemory.scripts.fieldControlsLocked=false;
 assert.equal(task.inspect(o,{remotePlayers:0,tradeCount:5}).kind,'cancelled');
 assert.equal(task.state.phase,'cancelled');assert.equal(task.state.cancellation.exitVerified,true);
 assert.equal(task.state.completion,undefined,'a cancellation is not a successful exchange');
 assert.equal(task.inspect(o,{remotePlayers:0,tradeCount:5}).kind,'cancelled','the same intent must stay terminal');
});

test('a missing partner National Dex cancels a non-Kanto offer but permits a Kanto shiny',()=>{
 for(const species of [197,113]){
  const offered={...pokemon,species,shiny:true},id=JSON.stringify([species,1845228247,2161188857,27,30,25,20,20,21]);
  const task=new FireRedNativeTradeHost({world,center:'MAP_LAVENDER_TOWN_POKEMON_CENTER_1F',fingerprint:id});
  const o=observation();o.playerMemory.trainer.party[0]=offered;o.emulator.callback2='CB2_TradeMenu';o.playerMemory.map.id='MAP_TRADE_CENTER';
  const w={remotePlayers:1,tradeCount:5,linkPlayers:[{version:4,nationalDex:true},{version:5,nationalDex:false}],localPlayer:0,tradeMenu:{callback:1,cursor:0,partyCount:2,menuCursor:1}};
  const next=task.inspect(o,w,{available:true,link:{session:true}});
  assert.deepEqual(next.action?.buttons,species===197?['b']:['a']);
  if(species===197){assert.equal(task.state.phase,'cancelling-trade');assert.match(task.state.reason,/National Pokédex/);}
  else assert.equal(task.state.cancellation,undefined);
 }
});

test('cancellation never retries a failed exit or interrupts an exchange that has started',()=>{
 const task=create(),o=observation();task.inspect(o,{tradeCount:5});
 assert.equal(typeof task.cancel,'function');task.cancel('Stopped by you.');
 o.emulator.callback2='CB2_LinkError';
 assert.equal(task.inspect(o,{tradeCount:5,remotePlayers:1},{reason:'Disconnected'}).kind,'stop');
 assert.equal(task.state.phase,'cancel-exit-incomplete');assert.equal(task.state.retries,undefined);
 const started=create();started.state.exchangeStarted=true;
 assert.throws(()=>started.cancel('Stop'),/exchange/);
 const changed=create();changed.inspect(observation(),{tradeCount:5});changed.cancel('Stop');
 const field=observation();field.emulator.callback2='CB2_Overworld';field.playerMemory.map.id=map;
 assert.equal(changed.inspect(field,{remotePlayers:0,tradeCount:6}).kind,'stop');
 assert.equal(changed.state.cancellation.exitVerified,undefined);
});

test('a cancelled trade survives Continue without reopening or fabricating a receipt',()=>{
 const task=create(),o=observation();task.inspect(o,{tradeCount:5});
 const cancelled={...task.state,phase:'cancelled',cancellation:{reason:'Partner cannot receive this Pokémon.',exitVerified:true}};
 assert.equal(coldBoot.validateNativeTradeContinuation(o,{tradeCount:5},cancelled),'cancelled');
 assert.throws(()=>coldBoot.validateNativeTradeContinuation(o,{tradeCount:6},cancelled),/count/);
 assert.throws(()=>coldBoot.validateNativeTradeContinuation(o,{tradeCount:5},{...cancelled,exchangeStarted:true}),/exchange/);
});

test('wireless compatibility reads each partner’s copied progress byte',()=>{
 const symbols={gWirelessCommType:{address:1},gReceivedRemoteLinkPlayers:{address:2},gLinkPlayers:{address:100,size:140},gLocalLinkPlayerId:{address:300,size:1}};
 const bytes=new Uint8Array(56);bytes[0]=4;bytes[16]=0;bytes[18]=17;bytes[28]=5;bytes[44]=17;bytes[46]=0;
 const session={readMemory(address,size){if(address===100){assert.equal(size,56);return bytes;}return Uint8Array.of(address===300?0:1);}};
 const w=readNativeWirelessStatus(session,{data:{symbols}});
 assert.equal(w.localPlayer,0);assert.equal(w.linkPlayers?.[0].nationalDex,true);assert.equal(w.linkPlayers?.[1].nationalDex,false);
});

test('lobby cancellation waits for an exchange and its save handshake to finish',()=>{
 for(const state of [null,{phase:'waiting',exchangeStarted:false},{phase:'complete',exchangeStarted:true}])assert.doesNotThrow(()=>assertNativeTradeCanStop(state));
 for(const phase of ['saving','leaving','saved-exit-incomplete','trade-outcome-unresolved'])assert.throws(()=>assertNativeTradeCanStop({phase,exchangeStarted:true}),/exchange/);
});

test('acknowledges Emerald trade evolution text so both games can reach their native saves',()=>{
 const task=new FireRedNativeTradeHost({world,center:'MAP_LAVENDER_TOWN_POKEMON_CENTER_1F',fingerprint,game:'emerald',role:'guest',peerTrainerId:123});
 const o=observation();task.inspect(o,{tradeCount:2});task.state.exchangeStarted=true;
 o.playerMemory.trainer.party[0]={...pokemon,species:76,personality:123};
 o.emulator.callback2='CB2_TradeEvolutionSceneUpdate';o.playerMemory.ui.fieldDialog={stage:'awaiting-page'};
 o.playerMemory.activeTasks=[{function:'Task_TradeEvolutionScene',data:[13,75,76]}];
 assert.deepEqual(task.inspect(o,{tradeCount:2},{available:true}).action?.buttons,['a']);
 assert.equal(task.state.completion,undefined);
 o.playerMemory.activeTasks[0].data[0]=20; // move replacement is a separate decision
 assert.equal(task.inspect(o,{tradeCount:2},{available:true}).action,undefined);
 o.playerMemory.activeTasks[0].data[0]=13;o.playerMemory.ui.fieldDialog=null;
 assert.equal(task.inspect(o,{tradeCount:2},{available:true}).action,undefined);
});

test('the normal room exit acknowledges the partner-leaving message before its link barrier can finish',()=>{
 const o=observation();o.emulator.callback2='CB2_Overworld';o.playerMemory.map.id='MAP_TRADE_CENTER';o.playerMemory.scripts={fieldControlsLocked:true};o.playerMemory.ui.fieldDialog={stage:'awaiting-page'};
 const w={room:{localPlayer:0,position:{x:5,y:8},movementMode:0,linkState:129,players:[]}};
 assert.deepEqual(inspectNativeTradeExit(o,w,world).action?.buttons,['a']);
 o.playerMemory.ui.fieldDialog=null;assert.equal(inspectNativeTradeExit(o,w,world).kind,'wait');
});

test('the trade stays active until the upstairs return scene releases field controls',()=>{
 const task=create(),o=observation();task.inspect(o,{tradeCount:0});
 o.playerMemory.trainer.party[0]={...pokemon,personality:3};task.state.completion={saveHandshakeVerified:true};
 o.emulator.callback2='CB2_Overworld';o.playerMemory.map.id=map;o.playerMemory.scripts={fieldControlsLocked:true};
 assert.equal(task.inspect(o,{remotePlayers:0}).kind,'wait');o.playerMemory.scripts.fieldControlsLocked=false;
 assert.equal(task.inspect(o,{remotePlayers:0}).kind,'verify-complete');
});

test('Emerald joins the reserved native leader and never chooses a different advertised trainer',()=>{
 const task=new FireRedNativeTradeHost({world,center:'MAP_LAVENDER_TOWN_POKEMON_CENTER_1F',fingerprint,game:'emerald',role:'guest',peerTrainerId:123});
 const o=observation();o.playerMemory.map.id=map;o.playerMemory.position={x:10,y:4};o.playerMemory.ui.choiceMenu={maxCursor:3,cursor:0};
 const w={validity:'valid',wirelessCommType:1,remotePlayers:0},radio={available:true,adapter:{mode:0},link:{session:'pair'}};
 task.inspect(o,w,radio);o.playerMemory.ui.choiceMenu=null;task.inspect(o,w,radio);o.playerMemory.ui.choiceMenu={maxCursor:2,cursor:0};
 assert.deepEqual(task.inspect(o,w,radio).action?.buttons,['a']);assert.equal(task.state.role,'guest');
 w.guest={state:3,cursor:0,leaders:[{index:0,trainerId:999,version:4,active:true},{index:1,trainerId:123,version:4,active:true}]};
 assert.deepEqual(task.inspect(o,w,radio).action?.buttons,['down']);w.guest.cursor=1;assert.deepEqual(task.inspect(o,w,radio).action?.buttons,['a']);
 w.guest.leaders[1].trainerId=999;assert.equal(task.inspect(o,w,radio).kind,'wait');
});

test('Emerald cannot call a partially written wireless trade save complete',()=>{
 const task=new FireRedNativeTradeHost({world,center:'MAP_LAVENDER_TOWN_POKEMON_CENTER_1F',fingerprint,game:'emerald',role:'guest',peerTrainerId:123});
 const o=observation();task.inspect(o,{tradeCount:7});o.playerMemory.trainer.party[0]={...pokemon,personality:123};o.emulator.callback2='CB2_SaveAndEndWirelessTrade';o.emulator.mainState=8;o.sram={sha256:'native-save'};
 task.inspect(o,{tradeCount:8});assert.equal(task.state.completion,undefined);
 o.emulator.mainState=9;task.inspect(o,{tradeCount:8});assert.equal(task.state.completion?.tradeCount,8);assert.equal(task.state.completion?.handshakeVerified,undefined);
});

test('Emerald Direct Corner uses the common save callback and commits its signature before state five',()=>{
 const task=new FireRedNativeTradeHost({world,center:'MAP_LAVENDER_TOWN_POKEMON_CENTER_1F',fingerprint,game:'emerald',role:'guest',peerTrainerId:123});
 const o=observation();task.inspect(o,{tradeCount:7});o.playerMemory.trainer.party[0]={...pokemon,personality:123};o.emulator.callback2='CB2_SaveAndEndTrade';o.emulator.mainState=42;o.sram={sha256:'direct-corner-save'};
 task.inspect(o,{tradeCount:8});assert.equal(task.state.completion,undefined);
 o.emulator.mainState=5;task.inspect(o,{tradeCount:8});assert.equal(task.state.completion?.tradeCount,8);
});
world.data.maps.push({id:'MAP_TRADE_CENTER',warpEvents:[{x:5,y:8}],coordEvents:[{script:'TradeCenter_EventScript_Chair0',x:4,y:5},{script:'TradeCenter_EventScript_Chair1',x:7,y:5}],objectEvents:[],layout:{cells:[
 {x:5,y:8,collision:0},{x:5,y:7,collision:0},{x:4,y:7,collision:0},{x:4,y:6,collision:0},{x:4,y:5,collision:0},
]}});
test('uses this game’s Direct Corner attendant and keeps the captured individual in its live party',()=>{
 const task=create(),o=observation();assert.deepEqual(task.inspect(o,{}).objective.target,{kind:'object',map,index:1});
 o.playerMemory.trainer.party=[];assert.equal(task.inspect(o,{}).kind,'stop');
});
test('reports missing wireless support at the native menu instead of entering a cable trade or claiming Leader',()=>{
 const task=create(),o=observation();o.playerMemory.map.id=map;o.playerMemory.position={x:10,y:4};o.playerMemory.ui.choiceMenu={minCursor:0,maxCursor:2,columns:1};
 const next=task.inspect(o,{validity:'valid',wirelessCommType:0,remotePlayers:0});
 assert.equal(next.kind,'stop');assert.equal(task.state.phase,'wireless-unavailable');assert.equal(task.state.advertising,false);assert.equal(task.state.role,'leader');
});
test('an emulated adapter flag alone is not proof of Switch advertising',()=>{
 const task=create(),o=observation();o.playerMemory.map.id=map;o.playerMemory.position={x:10,y:4};o.playerMemory.ui.choiceMenu={minCursor:0,maxCursor:2,columns:1};
 const next=task.inspect(o,{validity:'valid',wirelessCommType:1,remotePlayers:0});
 assert.equal(next.kind,'stop');assert.equal(task.state.phase,'transport-unavailable');assert.equal(task.state.advertising,false);
});
test('does not mistake another upstairs menu for the Direct Corner check',()=>{
 const task=create(),o=observation();o.playerMemory.map.id=map;o.playerMemory.position={x:6,y:4};o.playerMemory.ui.choiceMenu={minCursor:0,maxCursor:2,columns:1};
 assert.equal(task.inspect(o,{validity:'valid',wirelessCommType:0}).kind,'policy');
});
test('wireless status is read from pinned memory symbols, and missing data stays unknown',()=>{
 const runtime={data:{symbols:{gWirelessCommType:{address:0x03003f3c},gReceivedRemoteLinkPlayers:{address:0x03003f64}}}};
 const session={readMemory(address,bytes){assert.equal(bytes,1);return Uint8Array.of(address===0x03003f3c?0:0);}};
 assert.deepEqual(readNativeWirelessStatus(session,runtime),{validity:'valid',wirelessCommType:0,remotePlayers:0});
 assert.equal(readNativeWirelessStatus(session,{data:{symbols:{}}}).validity,'unknown');
});
test('restoring a saved host intent never claims that the radio is still advertising',()=>{
 const task=new FireRedNativeTradeHost({world,center:'MAP_LAVENDER_TOWN_POKEMON_CENTER_1F',fingerprint,state:{fingerprint,map,advertising:true}});
 assert.equal(task.state.advertising,false);
});
test('native radio support follows Trade, then the ROM’s Leader choice and keeps waiting without confirming a trade',()=>{
 const task=create(),o=observation(),wireless={validity:'valid',wirelessCommType:1,remotePlayers:0};
 o.playerMemory.map.id=map;o.playerMemory.position={x:10,y:4};o.playerMemory.ui.choiceMenu={maxCursor:2,cursor:0};
 const radio={available:true,advertising:false,adapter:{mode:0}};
 assert.deepEqual(task.inspect(o,wireless,radio).action.buttons,['a']);
 o.playerMemory.ui.choiceMenu=null;task.inspect(o,wireless,radio);
 o.playerMemory.ui.choiceMenu={maxCursor:2,cursor:0};
 assert.deepEqual(task.inspect(o,wireless,radio).action.buttons,['down']);
 o.playerMemory.ui.choiceMenu.cursor=1;
 assert.deepEqual(task.inspect(o,wireless,radio).action.buttons,['a']);
 radio.adapter.mode=1;radio.advertising=true;
 assert.equal(task.inspect(o,wireless,radio).kind,'wait');
 assert.equal(task.state.advertising,true);assert.equal(task.state.phase,'waiting-for-player');
 radio.available=false;radio.advertising=false;radio.reason='radio disconnected';
 assert.equal(task.inspect(o,wireless,radio,1000).kind,'retry');assert.equal(task.state.advertising,false);
});
test('advances the script-owned native Save prompt even though the overworld observer marks it as a transition',()=>{
 const task=create(),o=observation();o.phase='transition';o.playerMemory.map.id=map;o.playerMemory.position={x:10,y:4};
 o.playerMemory.activeTasks=[{function:'task50_save_game'}];
 const next=task.inspect(o,{validity:'valid',wirelessCommType:1},{available:true,advertising:false,adapter:{mode:0}});
 assert.equal(next.kind,'input');assert.deepEqual(next.action.buttons,['a']);assert.equal(task.state.phase,'choosing-role');
});

test('clears the previous radio error when the native Leader resumes advertising',()=>{
 const task=create(),o=observation();
 task.state.phase='radio-unavailable';task.state.reason='Native radio status expired.';
 o.playerMemory.map.id=map;o.playerMemory.position={x:10,y:4};
 const next=task.inspect(o,{validity:'valid',wirelessCommType:1},{available:true,advertising:true,adapter:{mode:1},reason:null});
 assert.equal(next.kind,'wait');
 assert.equal(task.state.phase,'waiting-for-player');
 assert.equal(task.state.reason,null);
});

test('accepts a connected player only at the native Leader membership prompt',()=>{
 const task=create(),o=observation();o.phase='transition';
 o.playerMemory.map.id=map;o.playerMemory.position={x:10,y:4};
 const radio={available:true,connected:true,adapter:{mode:1},link:{session:true,adapterClient:58839}};
 const wireless={validity:'valid',wirelessCommType:1,leader:{state:11,textState:1,cursor:0}};
 assert.deepEqual(task.inspect(o,wireless,radio).action?.buttons,['a']);
 wireless.leader.cursor=1;
 assert.deepEqual(task.inspect(o,wireless,radio).action?.buttons,['up']);
 for(const state of [7,13,20,26]){
  wireless.leader.state=state;
  assert.equal(task.inspect(o,wireless,radio).kind,'wait');
 }
 wireless.leader.state=11;radio.link.session=false;
 assert.equal(task.inspect(o,wireless,radio).kind,'wait');
});

test('reads the Leader prompt state from its active native task, not a generic Yes/No menu',()=>{
 const symbols={gWirelessCommType:{address:100},gReceivedRemoteLinkPlayers:{address:101},
  gTasks:{address:200,size:640},Task_TryBecomeLinkLeader:{address:0x08115ae0},sMenu:{address:900,size:4},
  'sMenu@0x0203ade4':{address:920,size:12,sourceName:'sMenu'}};
 const tasks=new Uint8Array(640),view=new DataView(tasks.buffer),offset=3*40;
 view.setUint32(offset,0x08115ae1,true);tasks[offset+4]=1;
 tasks[offset+20]=11;tasks[offset+21]=1;
 const session={readMemory(address,size){
  if(address===200){assert.equal(size,640);return tasks;}
  if(address===900)return Uint8Array.of(0,0,0,0);
  if(address===920){assert.equal(size,12);return Uint8Array.of(0,0,1,0,1,0,0,0,0,0,0,0);}
  return Uint8Array.of(address===100?1:0);
 }};
 assert.deepEqual(readNativeWirelessStatus(session,{data:{symbols}}).leader,{state:11,textState:1,cursor:1});
 tasks[offset+4]=0;
 assert.equal(readNativeWirelessStatus(session,{data:{symbols}}).leader,undefined);
});

test('retries the native communication error even when the radio still reports connected',()=>{
 for(const callback2 of ['CB2_LinkError','CB2_PrintErrorMessage']){
  const task=create(),o=observation();task.state.phase='player-connected';
  o.emulator.callback2=callback2;
  assert.equal(task.inspect(o,{}, {available:true,connected:true,advertising:true},1000).kind,'retry');
  assert.equal(task.state.phase,'retry-wait');
  assert.equal(task.state.advertising,false);
 }
});

test('reconnects repeatedly after backoff, retaining the prepared individual and retry count',()=>{
 const task=create(),o=observation();
 assert.equal(task.inspect(o,{}, {reason:'Switch left during native link'},1000).kind,'retry');
 assert.equal(task.inspect(o,{},null,2000).kind,'wait');
 assert.equal(task.inspect(o,{},null,4000).kind,'reconnect');
 task.reconnected();
 assert.equal(task.state.fingerprint,fingerprint);assert.equal(task.state.retries,1);
 assert.equal(task.inspect(o,{},null,4001).kind,'policy');
 assert.equal(task.inspect(o,{}, {reason:'Native radio status expired.'},5000).kind,'retry');
 assert.equal(task.inspect(o,{},null,10000).kind,'wait');
 assert.equal(task.inspect(o,{},null,11000).kind,'reconnect');
 task.reconnected();assert.equal(task.state.retries,2);
 for(let n=0;n<20;n++){
  task.inspect(o,{}, {reason:'Switch disconnected'},20000+n*31000);
  assert.equal(task.inspect(o,{},null,50000+n*31000).kind,'reconnect');
  task.reconnected();
 }
 assert.equal(task.state.retries,22);
});

test('never resets a changed party or an unfinished native trade save after disconnection',()=>{
 const task=create(),o=observation();
 task.inspect(o,{tradeCount:2});
 o.playerMemory.trainer.party[0]={...pokemon,personality:22,otId:33};
 o.emulator.callback2='CB2_SaveAndEndTrade';o.emulator.mainState=52;
 assert.equal(task.inspect(o,{tradeCount:3},{available:true,connected:true}).kind,'wait');
 assert.equal(task.inspect(o,{tradeCount:3},{reason:'Switch disconnected'}).kind,'stop');
 assert.equal(task.state.phase,'trade-outcome-unresolved');
});

test('keeps the connection through the saved trade, return menu, and native exit handshake',()=>{
 const task=create(),o=observation();task.inspect(o,{tradeCount:2});
 o.emulator.callback2='CB2_UpdateLinkTrade';
 task.inspect(o,{tradeCount:2,standby:{round:5,callbackActive:false}});
 o.playerMemory.trainer.party[0]={...pokemon,personality:22,otId:33};
 o.emulator.callback2='CB2_SaveAndEndTrade';o.emulator.mainState=50;o.sram={sha256:'new-save'};
 assert.equal(task.inspect(o,{tradeCount:3},{connected:true}).kind,'wait');
 o.emulator.mainState=5;
 assert.equal(task.inspect(o,{tradeCount:3},{connected:true}).kind,'wait');
 for(const callback2 of ['CB2_FreeTradeAnim','CB2_StartCreateTradeMenu','CB2_CreateTradeMenu']){
  o.emulator.callback2=callback2;
  assert.equal(task.inspect(o,{tradeCount:3,remotePlayers:1},{connected:true}).kind,'wait');
 }
 o.emulator.callback2='CB2_TradeMenu';
 const menu={callback:0,cursor:12,partyCount:2,neighbors:[]};
 const wireless={tradeCount:3,remotePlayers:1,tradeMenu:menu,standby:{round:10,callbackActive:false,errorState:0}};
 o.frame=1000;
 assert.equal(task.inspect(o,wireless,{connected:true}).kind,'wait','stock five-round return must not count as the Switch completing its save');
 assert.equal(task.state.completion.handshakeVerified,undefined);
 wireless.standby.round=11;
 assert.equal(task.inspect(o,wireless,{connected:true}).kind,'wait','let the partner finish its menu handoff');
 o.frame=1300;
 assert.deepEqual(task.inspect(o,wireless,{connected:true}).action?.buttons,['a']);
 assert.equal(task.state.completion.saveHandshakeVerified,true);
 assert.equal(task.state.completion.handshakeVerified,undefined,'normal link exit still has to finish');
 menu.callback=4;menu.menuCursor=1;
 assert.deepEqual(task.inspect(o,wireless,{connected:true}).action?.buttons,['up']);
 menu.menuCursor=0;assert.deepEqual(task.inspect(o,wireless,{connected:true}).action?.buttons,['a']);
 menu.callback=100;assert.equal(task.inspect(o,wireless,{connected:true}).kind,'wait');
 o.emulator.callback2='CB2_Overworld';o.playerMemory.map.id='MAP_TRADE_CENTER';
 wireless.room={localPlayer:0,position:{x:4,y:5},movementMode:0,linkState:128,players:[]};
 assert.deepEqual(task.inspect(o,wireless,{connected:true}).action?.buttons,['down']);
 wireless.room.position={x:5,y:8};
 assert.deepEqual(task.inspect(o,wireless,{connected:true}).action?.buttons,['down']);
 o.playerMemory.ui.choiceMenu={minCursor:0,maxCursor:1,cursor:1};
 assert.deepEqual(task.inspect(o,wireless,{connected:true}).action?.buttons,['up']);
 o.playerMemory.ui.choiceMenu.cursor=0;
 assert.deepEqual(task.inspect(o,wireless,{connected:true}).action?.buttons,['a']);
 o.emulator.callback2='CB2_LoadMap';
 assert.equal(task.inspect(o,wireless,{reason:'Switch left during native link'},1000).kind,'wait');
 o.emulator.callback2='CB2_Overworld';
 o.playerMemory.ui.choiceMenu=null;o.playerMemory.map.id=map;wireless.remotePlayers=0;
 assert.equal(task.inspect(o,wireless,{connected:false,reason:'Switch left during native link'},1100).kind,'verify-complete');
 assert.equal(task.state.completion.linkClosedVerified,true);
 assert.equal(task.state.completion.handshakeVerified,true);
 assert.equal(task.state.completion.tradeCount,3);
 assert.equal(task.state.completion.receivedFingerprint,'[143,22,33,27,30,25,20,20,21]');
});

test('an Emerald native peer uses five save/menu rounds and still requires normal exit',()=>{
 const task=create(),o=observation();task.inspect(o,{tradeCount:2});
 o.emulator.callback2='CB2_UpdateLinkTrade';task.inspect(o,{tradeCount:2,standby:{round:5,callbackActive:false}});
 o.playerMemory.trainer.party[0]={...pokemon,personality:22,otId:33};
 o.emulator.callback2='CB2_SaveAndEndTrade';o.emulator.mainState=5;o.sram={sha256:'new-save'};
 task.inspect(o,{tradeCount:3},{connected:true});
 o.emulator.callback2='CB2_TradeMenu';o.frame=1000;
 const wireless={tradeCount:3,remotePlayers:1,linkVersions:[4,3],tradeMenu:{callback:0,cursor:12,partyCount:2,neighbors:[]},standby:{round:9,callbackActive:false,errorState:0}};
 task.inspect(o,wireless,{connected:true});assert.equal(task.state.completion.saveHandshakeVerified,undefined);
 wireless.standby.round=10;task.inspect(o,wireless,{connected:true});
 assert.equal(task.state.completion.saveHandshakeVerified,true);
 assert.equal(task.state.completion.saveStandbyRounds,5);
 assert.equal(task.state.completion.handshakeVerified,undefined);
});

test('reads the native LinkPlayer versions from both slots before selecting the save protocol',()=>{
 const symbols={gWirelessCommType:{address:100},gReceivedRemoteLinkPlayers:{address:101},gLinkPlayers:{address:200,size:140}};
 const players=new Uint8Array(56);players[0]=4;players[1]=0x80;players[28]=3;players[29]=0x40;
 const session={readMemory(address,size){if(address===200){assert.equal(size,56);return players;}return Uint8Array.of(1);}};
 assert.deepEqual(readNativeWirelessStatus(session,{data:{symbols}}).linkVersions,[4,3]);
});

test('a committed exchange opens as saved-exit-incomplete after disconnection, never as ready to trade again',()=>{
 const o=observation(),task=create();task.inspect(o,{tradeCount:2});
 o.playerMemory.trainer.party[0]={...pokemon,personality:22,otId:33};
 task.state.exchangeStarted=true;
 task.state.completion={receivedFingerprint:'[143,22,33,27,30,25,20,20,21]',tradeCount:3,handshakeVerified:true};
 assert.equal(coldBoot.validateNativeTradeContinuation(o,{tradeCount:3},task.state),'saved-exit-incomplete');
 task.state.phase='saved-exit-incomplete';
 assert.equal(task.inspect(o,{tradeCount:3},{available:true}).kind,'stop');
 assert.equal(task.state.retries,undefined);
 assert.throws(()=>coldBoot.validateNativeTradeContinuation(o,{tradeCount:2},task.state),/completed|verified/);
});

test('reads native RFU standby rounds and active task without inferring them from a party menu',()=>{
 const symbols={gWirelessCommType:{address:100},gReceivedRemoteLinkPlayers:{address:101},gRfu:{address:200,size:2476}};
 const data=new Uint8Array(0x102),view=new DataView(data.buffer);view.setUint16(0x100,11,true);
 const session={readMemory(address,size){if(address===200){assert.equal(size,0x102);return data;}return Uint8Array.of(1);}};
 assert.deepEqual(readNativeWirelessStatus(session,{data:{symbols}}).standby,{round:11,callbackActive:false,errorState:0});
 view.setUint32(0,0x080f1235,true);data[0xee]=1;
 assert.deepEqual(readNativeWirelessStatus(session,{data:{symbols}}).standby,{round:11,callbackActive:true,errorState:1});
});

test('preserves a locally committed save without claiming the partner finished when the handshake is lost',()=>{
 const task=create(),o=observation();task.inspect(o,{tradeCount:2});
 o.playerMemory.trainer.party[0]={...pokemon,personality:22,otId:33};
 o.emulator.callback2='CB2_SaveAndEndTrade';o.emulator.mainState=5;o.sram={sha256:'committed-save'};
 assert.equal(task.inspect(o,{tradeCount:3},{reason:'Switch left during native link'}).kind,'stop');
 assert.equal(task.state.phase,'trade-outcome-unresolved');
 assert.equal(task.state.retries,undefined);
});

test('native SRAM continuation rejects a substituted party and verifies a completed exchange before stopping retries',()=>{
 assert.equal(typeof coldBoot.validateNativeTradeContinuation,'function');
 const o=observation(),state={fingerprint,partyBefore:[fingerprint,'[18,null,null,null,null,null,null,null,null]'],tradeCountBefore:2};
 assert.equal(coldBoot.validateNativeTradeContinuation(o,{tradeCount:2},state),'ready');
 o.playerMemory.trainer.party[0]={...pokemon,personality:22,otId:33};
 assert.throws(()=>coldBoot.validateNativeTradeContinuation(o,{tradeCount:3},state),/prepared|verified/);
 state.completion={receivedFingerprint:'[143,22,33,27,30,25,20,20,21]',tradeCount:3,handshakeVerified:true,linkClosedVerified:true};
 assert.equal(coldBoot.validateNativeTradeContinuation(o,{tradeCount:3},state),'complete');
 assert.throws(()=>coldBoot.validateNativeTradeContinuation(o,{tradeCount:2},state),/completed|verified/);
 o.playerMemory.trainer.party[1]={...pokemon,personality:44};
 assert.throws(()=>coldBoot.validateNativeTradeContinuation(o,{tradeCount:3},state),/party/);
});

test('a long wait for the Switch never expires the timer inside the exchange or save handshake',()=>{
 const task=create();task.state.phase='starting-leader';
 assert.equal(task.checkSetupTimeout(0),null);
 task.state.phase='waiting-for-player';assert.equal(task.checkSetupTimeout(600000),null);
 for(const phase of ['walking-to-seat','selecting-pokemon','offering-pokemon','confirming-trade','waiting-for-trade','finishing-trade','leaving-trade']){
  task.state.phase=phase;assert.equal(task.checkSetupTimeout(900000),null);
 }
 task.state.phase='traveling';assert.equal(task.checkSetupTimeout(1000000),null);
 assert.equal(task.checkSetupTimeout(1300001).kind,'retry');
});

test('a reopened radio gets a fresh setup deadline after an earlier timeout',()=>{
 const task=create();task.state.phase='starting-leader';
 assert.equal(task.checkSetupTimeout(0),null);
 assert.equal(task.checkSetupTimeout(300001)?.kind,'retry');
 task.reconnected();
 assert.equal(task.checkSetupTimeout(330001),null);
 assert.equal(task.checkSetupTimeout(630001),null);
 assert.equal(task.checkSetupTimeout(630002)?.kind,'retry');
});

test('disconnect during the animation never resets and reoffers an apparently unchanged party',()=>{
 const task=create(),o=observation();task.inspect(o,{tradeCount:0});
 o.emulator.callback2='CB2_UpdateLinkTrade';o.playerMemory.map.id='MAP_TRADE_CENTER';
 assert.equal(task.inspect(o,{tradeCount:0,remotePlayers:1},{available:true,connected:true,link:{session:true}}).kind,'wait');
 assert.equal(task.state.phase,'finishing-trade');assert.equal(task.state.exchangeStarted,true);
 assert.equal(task.inspect(o,{tradeCount:0},{reason:'Switch left during native link'}).kind,'stop');
 assert.equal(task.state.phase,'trade-outcome-unresolved');assert.equal(task.state.retries,undefined);
 assert.throws(()=>coldBoot.validateNativeTradeContinuation(o,{tradeCount:0},task.state),/outcome|exchange/i);
});

test('reads the ROM encrypted trade counter without treating a missing save pointer as zero trades',()=>{
 const symbols={gWirelessCommType:{address:100},gReceivedRemoteLinkPlayers:{address:101},gSaveBlock1Ptr:{address:200},gSaveBlock2Ptr:{address:204}};
 const structures={SaveBlock1:{fields:{gameStats:{offset:4608}}},SaveBlock2:{fields:{encryptionKey:{offset:3872}}}};
 const memory=new Map([[100,1],[101,1],[200,0x02001000],[204,0x02008000],[0x02002254,0x11223346],[0x02008f20,0x11223344]]);
 const session={readMemory(address,size){const b=new Uint8Array(size);if(size===4)new DataView(b.buffer).setUint32(0,memory.get(address),true);else b[0]=memory.get(address);return b;}};
 assert.equal(readNativeWirelessStatus(session,{data:{symbols,structures}}).tradeCount,2);
 memory.set(200,0);assert.equal(readNativeWirelessStatus(session,{data:{symbols,structures}}).tradeCount,undefined);
});

test('walks from the link-room entrance to its native trade seat instead of waiting for the partner to time out',()=>{
 const task=create(),o=observation();task.state.phase='player-connected';o.emulator.callback2='CB2_Overworld';o.playerMemory.map.id='MAP_TRADE_CENTER';
 const room={localPlayer:0,position:{x:5,y:8},movementMode:0,linkState:128,players:[]};
 const wireless={remotePlayers:1,room},radio={available:true,connected:true,link:{session:true}};
 assert.deepEqual(task.inspect(o,wireless,radio).action?.buttons,['up']);
 room.position={x:5,y:7};assert.deepEqual(task.inspect(o,wireless,radio).action?.buttons,['left']);
 room.movementMode=1;assert.equal(task.inspect(o,wireless,radio).kind,'wait');
 room.movementMode=0;room.position={x:4,y:5};room.linkState=130;
 assert.equal(task.inspect(o,wireless,radio).kind,'wait');
 assert.equal(task.state.phase,'waiting-at-seat');
});

test('selects and offers only the prepared individual, then confirms the native trade prompt',()=>{
 const task=create(),o=observation();task.state.phase='player-connected';
 o.emulator.callback2='CB2_TradeMenu';o.playerMemory.map.id='MAP_TRADE_CENTER';
 const menu={callback:0,cursor:0,partyCount:2,menuCursor:0,selectedSlot:0,partnerSlot:6,drawStates:[5,5],neighbors:[]};
 const w={remotePlayers:1,tradeMenu:menu},radio={available:true,connected:true,link:{session:true}};
 assert.deepEqual(task.inspect(o,w,radio).action?.buttons,['a']);
 menu.callback=1;assert.deepEqual(task.inspect(o,w,radio).action?.buttons,['down']);
 menu.menuCursor=1;assert.deepEqual(task.inspect(o,w,radio).action?.buttons,['a']);
 menu.callback=5;assert.equal(task.inspect(o,w,radio).kind,'wait');
 menu.callback=3;assert.deepEqual(task.inspect(o,w,radio).action?.buttons,['up']);
 menu.menuCursor=0;assert.deepEqual(task.inspect(o,w,radio).action?.buttons,['a']);
 menu.selectedSlot=1;assert.equal(task.inspect(o,w,radio).kind,'stop');
});

test('a reserved local pair verifies the offered partner individual before either game confirms',()=>{
 const task=new FireRedNativeTradeHost({world,center:'MAP_LAVENDER_TOWN_POKEMON_CENTER_1F',fingerprint,expectedPartnerFingerprint:fingerprint});
 const o=observation();o.emulator.callback2='CB2_TradeMenu';o.playerMemory.map.id='MAP_TRADE_CENTER';
 const w={remotePlayers:1,tradeMenu:{callback:3,cursor:0,partyCount:2,selectedSlot:0,partnerSlot:6,drawStates:[5,5],menuCursor:0},partnerParty:[{...pokemon,personality:3}]},radio={available:true,link:{session:'pair'}};
 assert.equal(task.inspect(o,w,radio).kind,'stop');assert.equal(task.state.exchangeStarted,undefined);
});

test('uses the ROM cursor transitions to reach the exact capture, and never selects the partner’s Pokémon',()=>{
 const task=create(),o=observation();o.emulator.callback2='CB2_TradeMenu';o.playerMemory.map.id='MAP_TRADE_CENTER';
 o.playerMemory.trainer.party=[{validity:'valid',species:18},{...pokemon}];
 const menu={callback:0,cursor:6,partyCount:2,neighbors:Array.from({length:13},()=>[0,0,0,0])};
 menu.neighbors[6]=[8,8,1,7];
 assert.deepEqual(task.inspect(o,{remotePlayers:1,tradeMenu:menu},{available:true,connected:true,link:{session:true}}).action?.buttons,['left']);
});

test('reads the link avatar and native trade menu from their own memory layouts',()=>{
 const blocks=new Map(),symbols={};let address=100;
 const put=(name,bytes)=>{symbols[name]={address,size:bytes.length};blocks.set(address,bytes);address+=bytes.length+16;return bytes;};
 const u32=n=>{const b=new Uint8Array(4);new DataView(b.buffer).setUint32(0,n,true);return b;};
 put('gLocalLinkPlayerId',Uint8Array.of(0));
 const links=put('gLinkPlayerObjectEvents',new Uint8Array(16));links.set([1,0,2,0,1,1,3,1]);
 put('sPlayerLinkStates',Uint8Array.of(128,130,0,0));
 const objects=put('gObjectEvents',new Uint8Array(576));objects[72]=objects[108]=1;
 const objView=new DataView(objects.buffer);objView.setInt16(88,12,true);objView.setInt16(90,15,true);objView.setInt16(124,14,true);objView.setInt16(126,12,true);
 const main=put('gMain',new Uint8Array(16));main.set(u32(0x0804d64d),4);symbols.CB2_TradeMenu={address:0x0804d64c};
 put('sTradeMenu',u32(0x02001000));put('sMenu',Uint8Array.of(0,0,0,0));
 put('sMenu@0x0203ade4',Uint8Array.of(0,0,1,0,1,0,0,0,0,0,0,0));symbols['sMenu@0x0203ade4'].sourceName='sMenu';
 const menu=new Uint8Array(128);menu[53]=5;menu[54]=menu[55]=6;menu.fill(1,56,69);menu[111]=3;menu[116]=menu[117]=5;menu[118]=5;menu[119]=8;blocks.set(0x02001000,menu);
 const table=put('sCursorMoveDestinations',new Uint8Array(312));table[0]=4;table[6]=2;table[12]=6;table[18]=1;
 const session={readMemory(address,size){const b=blocks.get(address);assert.ok(b&&b.length===size);return b;}};
 let status=readNativeTradeUi(session,{data:{symbols}});
 assert.deepEqual(status.room.position,{x:5,y:8});assert.equal(status.room.players[1].linkState,130);
 assert.deepEqual(status.tradeMenu,{cursor:5,partyCount:6,callback:3,menuCursor:1,selectedSlot:5,partnerSlot:8,drawStates:[5,5],neighbors:Array.from({length:13},(_,i)=>i===0?[4,2,6,1]:[0,0,0,0])});
 main.set(u32(0x08000001),4);assert.equal(readNativeTradeUi(session,{data:{symbols}}).tradeMenu,undefined);
});

test('cancels a Direct Corner leader lobby through the ROM inputs before verifying its field exit',()=>{
 const task=create(),o=observation();o.emulator.callback2='CB2_Overworld';o.playerMemory.map.id=map;
 o.playerMemory.scripts={fieldControlsLocked:true};
 const w={tradeCount:6,remotePlayers:0,leader:{state:6,textState:0,cursor:1}};
 task.inspect(o,w);task.cancel('Stopped by you.');
 assert.deepEqual(task.inspect(o,w).action?.buttons,['b']);
 w.leader.state=19;assert.equal(task.inspect(o,w).kind,'wait');
 w.leader.state=20;assert.equal(task.inspect(o,w).kind,'wait');
 w.leader.textState=1;assert.deepEqual(task.inspect(o,w).action?.buttons,['up']);
 w.leader.cursor=0;assert.deepEqual(task.inspect(o,w).action?.buttons,['a']);
 for(const state of [11,16]){w.leader.state=state;assert.deepEqual(task.inspect(o,w).action?.buttons,['b']);}
 w.leader.state=23;assert.equal(task.inspect(o,w).kind,'wait');
 delete w.leader;o.playerMemory.ui.fieldDialog={stage:'awaiting-input'};
 assert.deepEqual(task.inspect(o,w).action?.buttons,['a']);
 o.playerMemory.scripts.fieldControlsLocked=false;o.playerMemory.ui={};
 assert.equal(task.inspect(o,w).kind,'cancelled');assert.equal(task.state.cancellation.exitVerified,true);
 assert.equal(task.state.exchangeStarted,undefined);
});

test('backs out of the attendant role menu returned by a cancelled leader lobby',()=>{
 const o=observation();o.emulator.callback2='CB2_Overworld';o.playerMemory.map.id=map;
 o.playerMemory.scripts={fieldControlsLocked:true};
 o.playerMemory.ui={choiceMenu:{minCursor:0,maxCursor:2,cursor:0}};
 assert.deepEqual(inspectNativeTradeExit(o,{remotePlayers:0},world).action?.buttons,['b']);
 o.playerMemory.map.id='MAP_TRADE_CENTER';
 assert.equal(inspectNativeTradeExit(o,{remotePlayers:0},world).action,undefined);
});

test('acknowledges the attendant farewell only when the native script waits for A or B',()=>{
 const o=observation();o.emulator.callback2='CB2_Overworld';o.playerMemory.map.id=map;
 o.playerMemory.scripts={fieldControlsLocked:true,globalNative:'WaitForAorBPress'};
 o.playerMemory.ui.fieldDialog={type:'hidden',stage:'awaiting-close',textPrinter:{active:false}};
 assert.deepEqual(inspectNativeTradeExit(o,{remotePlayers:0},world).action?.buttons,['a']);
 o.playerMemory.scripts.globalNative='WaitForLink';
 assert.equal(inspectNativeTradeExit(o,{remotePlayers:0},world).action,undefined);
});


test('an associated Switch that never finishes its session handshake reopens the lobby',()=>{
 const task=create();Object.assign(task.state,{phase:'player-connected',radio:{connected:true,link:{net:true,session:false}},wireless:{remotePlayers:0}});
 assert.equal(task.checkSetupTimeout(0),null);
 assert.equal(task.checkSetupTimeout(30000),null);
 assert.equal(task.checkSetupTimeout(120000)?.kind,'retry');
 assert.equal(task.state.phase,'retry-wait');assert.equal(task.state.retries,1);
});

test('join recovery never interrupts membership approval, cancellation, or an exchange',()=>{
 for(const extra of [{radio:{connected:true,link:{net:true,session:true}}},{exchangeStarted:true},{cancellation:{reason:'Stopped'}}]){
  const task=create();Object.assign(task.state,{phase:'player-connected',radio:{connected:true,link:{net:true,session:false}},wireless:{remotePlayers:0}});
  assert.equal(task.checkSetupTimeout(0),null);Object.assign(task.state,extra);
  assert.equal(task.checkSetupTimeout(120000),null);assert.equal(task.state.retries,undefined);
 }
});

test('a new association receives its own join deadline after an interrupted attempt',()=>{
 const task=create();Object.assign(task.state,{phase:'player-connected',radio:{connected:true,link:{net:true,session:false}},wireless:{remotePlayers:0}});
 assert.equal(task.checkSetupTimeout(0),null);
 task.state.phase='waiting-for-player';assert.equal(task.checkSetupTimeout(50000),null);
 task.state.phase='player-connected';assert.equal(task.checkSetupTimeout(120000),null);
 assert.equal(task.checkSetupTimeout(240000)?.kind,'retry');
});


test('an interrupted saved trade is terminal only after verified return to the field',()=>{
 const recovered={phase:'interrupted',exchangeStarted:true,completion:{nativeSaveVerified:true,saveHandshakeVerified:true},recovery:{fieldVerified:true}};
 assert.doesNotThrow(()=>assertNativeTradeCanStop(recovered));
 for(const state of [{...recovered,recovery:{}},{...recovered,completion:{}},{...recovered,phase:'trade-outcome-unresolved'}])assert.throws(()=>assertNativeTradeCanStop(state));
});

test('a recovered exchange cannot resume its old trade controller or offer again',()=>{
 const task=create();Object.assign(task.state,{phase:'interrupted',exchangeStarted:true,completion:{nativeSaveVerified:true,saveHandshakeVerified:true},recovery:{fieldVerified:true}});
 assert.equal(task.inspect({emulator:{callback2:'CB2_TradeMenu'},playerMemory:{}},{remotePlayers:0}).kind,'stop');
 assert.equal(task.state.phase,'interrupted');
});

test('an unexpected party change still stops, and keeps what the check saw for diagnosis',()=>{
 // Gate 118-02: the FireRed partner stopped with "The prepared trade party changed unexpectedly" in the
 // outbound trade menu, before any exchange. The stop kept no record of the party it saw.
 const task=create(),o=observation();o.emulator.callback2='CB2_TradeMenu';o.emulator.mainState=7;o.frame=88006;o.playerMemory.map.id='MAP_TRADE_CENTER';
 const w={tradeCount:5,remotePlayers:1,tradeMenu:{callback:2,cursor:0,partyCount:2}};
 task.inspect(o,w,{available:true,link:{session:true}});
 assert.equal(task.state.partyBefore.length,2);
 o.playerMemory.trainer.party=[{validity:'valid',species:25},{validity:'valid',species:26}];
 const d=task.inspect(o,w,{available:true,link:{session:true}});
 assert.deepEqual([d.kind,task.state.phase],['stop','identity-unavailable'],'the safety stop is unchanged');
 const {observed,...rest}=task.state.identityCheck;
 assert.deepEqual(rest,{frame:88006,callback2:'CB2_TradeMenu',mainState:7,tradeMenuCallback:2,partyValidity:'valid',
  before:task.state.partyBefore,prepared:fingerprint});
 assert.equal(observed.length,2);assert.ok(!observed.includes(fingerprint));
});
