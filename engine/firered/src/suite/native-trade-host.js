import {encounterFingerprint} from '../player/encounter-tracker.js';
import {readNativeTradeUi,inspectNativeTradeRoom,inspectNativeTradeExit,readNativeMenuCursor} from './native-trade-room.js';
import {decodeBoxPokemonRecord} from '../evidence/pokemon-record.js';

export function nativeTradeFinished(state){
 return !state||state.phase==='complete'||state.phase==='cancelled'&&state.cancellation?.exitVerified===true&&!state.exchangeStarted||
  state.phase==='interrupted'&&state.completion?.nativeSaveVerified===true&&state.completion?.saveHandshakeVerified===true&&state.recovery?.fieldVerified===true;
}

export function assertNativeTradeCanStop(state){
 if(state?.exchangeStarted&&!nativeTradeFinished(state))throw Error('The exchange has started. Finish its save and exit handshake before stopping the lobby.');
}

export function readNativeWirelessStatus(session,runtime){
 const symbols=runtime?.data?.symbols??{};
 const adapter=symbols.gWirelessCommType,players=symbols.gReceivedRemoteLinkPlayers;
 if(!adapter||!players)return {validity:'unknown'};
 const status={validity:'valid',wirelessCommType:session.readMemory(adapter.address,1)[0],remotePlayers:session.readMemory(players.address,1)[0]};
 if(symbols.gLinkPlayers?.size===140&&status.remotePlayers){
  const records=session.readMemory(symbols.gLinkPlayers.address,56);
  status.linkVersions=[records[0],records[28]]; // native u16 version & 0xff
  // link.h: progressFlagsCopy at 0x12 is the byte CanTradeSelectedMon uses.
  status.linkPlayers=[0,1].map(i=>({version:records[i*28],nationalDex:Boolean(records[i*28+18]&15)}));
  if(symbols.gLocalLinkPlayerId){const id=session.readMemory(symbols.gLocalLinkPlayerId.address,1)[0];if(id<2)status.localPlayer=id;}
 }
 if([2476,3316].includes(symbols.gRfu?.size)){
  const b=session.readMemory(symbols.gRfu.address,0x102),v=new DataView(b.buffer,b.byteOffset,b.byteLength);
  status.standby={round:v.getUint16(0x100,true),callbackActive:v.getUint32(0,true)!==0,errorState:b[0xee]};
 }
 const structures=runtime?.data?.structures??{};
 const stats=structures.SaveBlock1?.fields?.gameStats?.offset,key=structures.SaveBlock2?.fields?.encryptionKey?.offset;
 if(symbols.gSaveBlock1Ptr&&symbols.gSaveBlock2Ptr&&Number.isInteger(stats)&&Number.isInteger(key)){
  const word=address=>{const b=session.readMemory(address,4);return new DataView(b.buffer,b.byteOffset,4).getUint32(0,true);};
  const save1=word(symbols.gSaveBlock1Ptr.address),save2=word(symbols.gSaveBlock2Ptr.address);
  if(save1>=0x02000000&&save1+stats+88<=0x02040000&&save2>=0x02000000&&save2+key+4<=0x02040000){
   // FireRed GAME_STAT_POKEMON_TRADES = 21; native encrypted counter.
   status.tradeCount=(word(save1+stats+21*4)^word(save2+key))>>>0;
  }
 }
 if(symbols.gTasks?.size===640&&symbols.Task_TryBecomeLinkLeader){
  const tasks=session.readMemory(symbols.gTasks.address,640),view=new DataView(tasks.buffer,tasks.byteOffset,tasks.byteLength);
  for(let offset=0;offset<640;offset+=40){
   if(tasks[offset+4]&&(view.getUint32(offset,true)&~1)===(symbols.Task_TryBecomeLinkLeader.address&~1)){
    // WirelessLink_Leader is stored in gTasks[].data: three pointers, then
    // state/textState. Confirmed against the native membership prompt.
    status.leader={state:tasks[offset+20],textState:tasks[offset+21],cursor:readNativeMenuCursor(session,runtime)};
    break;
   }
  }
 }
 const ui=readNativeTradeUi(session,runtime);
 if(ui.tradeMenu?.callback===3&&symbols.gEnemyParty?.size===600){
  const bytes=session.readMemory(symbols.gEnemyParty.address,600);status.partnerParty=Array.from({length:6},(_,i)=>decodeBoxPokemonRecord(bytes,i*100));
 }
 return {...status,...ui};
}

const view=b=>new DataView(b.buffer,b.byteOffset,b.byteLength);
const ewram=(p,n)=>p>=0x02000000&&p+n<=0x02040000;
// The guest's native group list (union_room.h WirelessLink_Group, RfuPlayer
// and list_menu.h ListMenu share their layout in FireRed and Emerald). Read-only.
export function readNativeLinkGroup(session,symbols){
 if(!symbols?.gTasks||!symbols.Task_TryJoinLinkGroup||!symbols.sWirelessLinkMain)return null;
 const tasks=session.readMemory(symbols.gTasks.address,640),v=view(tasks);
 const id=Array.from({length:16},(_,i)=>i).find(i=>tasks[i*40+4]&&(v.getUint32(i*40,true)&~1)===(symbols.Task_TryJoinLinkGroup.address&~1));
 if(id===undefined)return null;
 const address=view(session.readMemory(symbols.sWirelessLinkMain.address,4)).getUint32(0,true);
 if(address!==symbols.gTasks.address+id*40+8)return null;
 const b=tasks.subarray(id*40+8,id*40+40),state=b[8],result={state,textState:b[9],cursor:null,leaders:[]};
 if(state!==3)return result;
 const playersPointer=view(b).getUint32(0,true),listId=b[14];
 if(!ewram(playersPointer,16*32)||listId>=16||!tasks[listId*40+4])return result;
 const list=view(tasks.subarray(listId*40+8,listId*40+40));
 result.cursor=list.getUint16(24,true)+list.getUint16(26,true);
 if(result.cursor>=16){result.cursor=null;return result;}
 const players=session.readMemory(playersPointer,16*32),pv=view(players);
 result.leaders=Array.from({length:16},(_,index)=>{const offset=index*32;return {index,trainerId:pv.getUint16(offset+2,true),version:(pv.getUint16(offset,true)>>>10)&15,active:(players[offset+26]&3)===1&&!(players[offset+10]&128)};});
 return result;
}
// FireRed's trade evolution scene (evolution_scene.c Task_TradeEvolutionScene
// tState = data[0]) and text printer 0 (text.h: active at 27, state at 28).
export function readTradeEvolutionScene(session,symbols){
 if(!symbols?.gTasks||!symbols.Task_TradeEvolutionScene||!symbols.sTextPrinters)return null;
 const tasks=session.readMemory(symbols.gTasks.address,640),v=view(tasks);
 const id=Array.from({length:16},(_,i)=>i).find(i=>tasks[i*40+4]&&(v.getUint32(i*40,true)&~1)===(symbols.Task_TradeEvolutionScene.address&~1));
 if(id===undefined)return null;
 const printer=session.readMemory(symbols.sTextPrinters.address,29);
 return {state:v.getInt16(id*40+8,true),textPrinter:{active:Boolean(printer[27]),state:printer[28]}};
}

// Native trade intent belongs to the running game. No Pokémon export, alternate
// party, external trade simulator, or save editing is part of this workflow.
export class FireRedNativeTradeHost {
 constructor({world,center,fingerprint,state=null,game='firered',role='leader',peerTrainerId=null,expectedPartnerFingerprint=null}){
  // A FireRed guest is the invisible second FireRed owner joining the source
  // FireRed leader; it must name that leader's distinct trainer ID.
  if(!(game==='firered'&&role==='leader'||['emerald','firered'].includes(game)&&role==='guest'&&Number.isInteger(peerTrainerId)&&peerTrainerId>=0&&peerTrainerId<=65535))throw Error('Unsupported native trade participant.');
  const map=center.replace(/_1F$/,'_2F');
  const floor=world.data.maps.find(m=>m.id===map);
  const index=floor?.objectEvents.findIndex(o=>o.script==='Common_EventScript_DirectCornerAttendant');
  if(!(index>=0))throw new Error('This Pokémon Center has no verified Direct Corner route.');
  this.attendant=floor.objectEvents[index];
  this.world=world;
  if(state&&(state.game!==undefined&&state.game!==game||state.role!==undefined&&state.role!==role||state.expectedPartnerFingerprint!==undefined&&state.expectedPartnerFingerprint!==expectedPartnerFingerprint))throw Error('The native trade reservation changed.');
  this.state={map,index,fingerprint,phase:'traveling',...state,game,mode:'native',role,peerTrainerId,expectedPartnerFingerprint,advertising:false};
  if(this.state.fingerprint!==fingerprint||this.state.map!==map)throw new Error('This trade task belongs to another game save.');
 }
 cancel(reason='Trade cancelled.'){
  assertNativeTradeCanStop(this.state);
  if(nativeTradeFinished(this.state))return;
  this.state.cancellation??={reason};this.state.reason=this.state.cancellation.reason;
  this.state.phase='cancelling-trade';this.state.advertising=false;
 }
 retry(reason,now=Date.now()){
  const s=this.state;
  s.retries=(s.retries??0)+1;s.lastFailure=reason;s.reason=reason;
  s.retryAt=now+Math.min(30000,3000*2**Math.min(s.retries-1,4));
  s.phase='retry-wait';s.advertising=false;s.radio=null;
  return {kind:'retry',reason};
 }
 reconnected(){
  this.setupStartedAt=null;this.joinStartedAt=null;
  Object.assign(this.state,{phase:'traveling',advertising:false,radio:null,wireless:null,reason:null,retryAt:null,serviceMenuClosed:false});
 }
 checkSetupTimeout(now=Date.now()){
  const s=this.state;
  // LDN association alone is not a game connection. A peer can remain here
  // forever after a failed Pia join, making an otherwise visible lobby busy.
  // Only retry before session admission; native membership prompts and all
  // accepted exchanges keep their existing, peer-aware completion path.
  const joining=s.phase==='player-connected'&&s.radio?.connected===true&&s.radio?.link?.session===false
   &&s.wireless?.remotePlayers===0&&!s.exchangeStarted&&!s.cancellation;
  if(joining){
   this.joinStartedAt??=now;
   if(now-this.joinStartedAt>60000)return this.retry('The Switch session handshake stalled. Reopening the lobby.',now);
  }else this.joinStartedAt=null;
  const settingUp=['traveling','checking-wireless','choosing-role','starting-leader','searching-leader'].includes(this.state.phase);
  if(!settingUp||this.state.exchangeStarted){this.setupStartedAt=null;return null;}
  this.setupStartedAt??=now;
  return now-this.setupStartedAt>5*60000?this.retry('Native trade setup timed out.',now):null;
 }
 inspect(o,wireless,radio=null,now=Date.now()){
  const s=this.state,m=o.playerMemory??{},ui=m.ui??{};
  const stop=(phase,reason)=>{s.phase=phase;s.reason=reason;s.advertising=false;return {kind:'stop',reason};};
  const input=(buttons)=>({kind:'input',action:{buttons,holdFrames:3,releaseFrames:30}});
  if(s.phase==='complete')return {kind:'complete'};
  if(s.phase==='cancelled')return nativeTradeFinished(s)?{kind:'cancelled',reason:s.cancellation.reason}:stop('cancel-exit-incomplete','The cancelled trade has no verified room exit.');
  if(['trade-outcome-unresolved','saved-exit-incomplete','cancel-exit-incomplete','interrupted','recovering-saved-trade'].includes(s.phase))return {kind:'stop',reason:s.reason??'The exchange is saved, but its normal exit was interrupted. It must not be repeated.'};
  if(s.phase==='retry-wait')return {kind:now>=s.retryAt?'reconnect':'wait'};
  s.radio=radio;s.wireless=wireless;
  const callback=o.emulator?.callback2;
  const exchanging=['CB2_LinkTrade','CB2_UpdateLinkTrade','CB2_WaitTradeComplete','CB2_TryLinkTradeEvolution','CB2_SaveAndEndTrade','CB2_SaveAndEndWirelessTrade','CB2_FreeTradeAnim'].includes(callback)
   ||(callback==='CB2_TradeMenu'&&[9,10,13,16].includes(wireless?.tradeMenu?.callback));
  if(exchanging)s.exchangeStarted=true;
  // Sample throughout the animation, before saving starts. Switch Direct Corner
  // then completes five save standbys plus the reconstructed-menu standby.
  if(['CB2_LinkTrade','CB2_UpdateLinkTrade','CB2_WaitTradeComplete','CB2_TryLinkTradeEvolution'].includes(callback)&&Number.isInteger(wireless?.standby?.round))s.saveStandbyStart=wireless.standby.round;
  const linkError=['CB2_LinkError','CB2_PrintErrorMessage'].includes(o.emulator?.callback2);
  if(m.trainer?.partyValidity!=='valid')return {kind:'wait'};
  const party=m.trainer.party.map(encounterFingerprint),matches=party.filter(p=>p===s.fingerprint).length;
  if(matches===1&&!s.partyBefore){s.partyBefore=party;s.tradeCountBefore=Number.isInteger(wireless?.tradeCount)?wireless.tradeCount:null;}
  if(matches!==1){
   const slot=s.partyBefore?.indexOf(s.fingerprint),oneReplacement=matches===0&&slot>=0&&party.length===s.partyBefore.length&&party[slot]&&party.every((p,i)=>i===slot||p===s.partyBefore[i]);
   if(!oneReplacement)return stop('identity-unavailable','The prepared trade party changed unexpectedly. Its current state is preserved.');
   const savedCallback=callback==='CB2_SaveAndEndTrade'&&[5,6,7,8,9].includes(o.emulator.mainState)||s.game==='emerald'&&callback==='CB2_SaveAndEndWirelessTrade'&&[9,10,11,12].includes(o.emulator.mainState);
   // trade_scene.c commits the final sector signature before states 5–9.
   if(savedCallback&&Number.isInteger(s.tradeCountBefore)&&wireless?.tradeCount===s.tradeCountBefore+1&&o.sram?.sha256){
    s.completion={...s.completion,receivedFingerprint:party[slot],tradeCount:wireless.tradeCount,sramSha256:o.sram.sha256};
   }
   const standby=wireless?.standby;
   const saveRounds=Number.isInteger(s.saveStandbyStart)&&Number.isInteger(standby?.round)?(standby.round-s.saveStandbyStart+65536)%65536:null;
   // The peer-aware compatibility ROM retains Emerald's stock sequence. The
   // Switch Direct Corner path still requires its additional save barrier.
   const expectedRounds=wireless?.linkVersions?.includes(3)?5:6;
   if(s.completion&&callback==='CB2_TradeMenu'&&wireless?.tradeMenu?.callback===0&&wireless.remotePlayers===1&&saveRounds===expectedRounds&&standby.callbackActive===false&&standby.errorState===0&&!radio?.reason&&!linkError){
    s.completion.saveHandshakeVerified=true;s.completion.saveStandbyRounds=saveRounds;
    this.exitMenuReadyFrame??=o.frame;
   }
   if(s.completion?.saveHandshakeVerified&&callback==='CB2_Overworld'&&m.map?.id===s.map&&wireless?.remotePlayers===0&&!linkError&&!m.scripts?.fieldControlsLocked&&!o.emulator.paletteFadeActive){
    s.completion.handshakeVerified=true;s.completion.linkClosedVerified=true;return {kind:'verify-complete'};
   }
   // Radio departure can precede the last few frames of the native room exit.
   // Let that epilogue finish; this never resets or reopens an exchange.
   if(s.completion?.saveHandshakeVerified&&radio?.reason&&!linkError){
    this.linkExitFailureAt??=now;
    if(now-this.linkExitFailureAt<3000){s.phase='leaving-trade';return {kind:'wait'};}
   }
   if(radio?.reason||linkError)return stop('trade-outcome-unresolved',s.completion?'The received Pokémon is saved locally, but the final link handshake or normal exit is not verified. Preserving this game for inspection.':'The party changed during the exchange, but its completed native save is not verified. Preserving this game for inspection.');
   if(s.completion?.saveHandshakeVerified){
    // The peer must finish creating its own input handler before receiving Cancel.
    if(callback==='CB2_TradeMenu'&&wireless?.tradeMenu?.callback===0&&o.frame-this.exitMenuReadyFrame<300){s.phase='finishing-trade';return {kind:'wait'};}
    const next=inspectNativeTradeExit(o,wireless,this.world);s.phase=next.phase;return next;
   }
   // Emerald's trade evolution text contains a native page wait. The peer is
   // already waiting in SaveAndEndTrade; neutral frames cannot dismiss it.
   // Only acknowledge message states, never cancel evolution or choose a move.
   const evolution=m.activeTasks?.find(t=>t.function==='Task_TradeEvolutionScene');
   if(s.game==='emerald'&&callback==='CB2_TradeEvolutionSceneUpdate'&&ui.fieldDialog&&
     [1,13,14,18,19].includes(evolution?.data?.[0])&&!ui.choiceMenu){
    s.phase='finishing-trade';return input(['a']);
   }
   // A FireRed guest receives the evolving Pokémon. Its scene is read natively
   // (same states as Emerald); only a waiting message page is acknowledged.
   const scene=wireless?.evolutionScene;
   if(s.game==='firered'&&s.role==='guest'&&callback==='CB2_TradeEvolutionSceneUpdate'&&[1,13,14,18,19].includes(scene?.state)&&
     scene.textPrinter?.active&&[1,2,3].includes(scene.textPrinter.state)&&!ui.choiceMenu){
    s.phase='finishing-trade';return input(['a']);
   }
   s.phase='finishing-trade';return {kind:'wait'};
  }
  if(m.trainer.party.length<2)return stop('party-unavailable','The native trade needs at least two Pokémon in this game’s party.');
  if(!s.exchangeStarted&&!s.cancellation&&callback==='CB2_TradeMenu'&&wireless?.tradeMenu){
   const offered=m.trainer.party[party.indexOf(s.fingerprint)],local=wireless.linkPlayers?.[wireless.localPlayer],partner=wireless.linkPlayers?.[wireless.localPlayer^1];
   const nonKanto=offered.species>151;
   if(nonKanto&&local?.nationalDex===false)this.cancel('This game needs the National Pokédex to trade this Pokémon.');
   else if(nonKanto&&partner?.nationalDex===false&&![1,2].includes(partner.version))this.cancel('Your partner needs the National Pokédex to receive this Pokémon.');
   else if(wireless.tradeMenu.callback===8)this.cancel('The game rejected or cancelled this trade. Choose another Pokémon or task.');
  }
  if(s.cancellation&&!s.exchangeStarted){
   if(JSON.stringify(party)!==JSON.stringify(s.partyBefore)||Number.isInteger(s.tradeCountBefore)&&wireless?.tradeCount!==s.tradeCountBefore)
    return stop('cancel-exit-incomplete','The party or trade count changed during cancellation. Its outcome needs verification.');
   if(callback==='CB2_Overworld'&&m.map?.id===s.map&&wireless?.remotePlayers===0&&!linkError&&!m.scripts?.fieldControlsLocked&&!o.emulator.paletteFadeActive&&!Object.values(ui).some(Boolean)){
    s.cancellation.exitVerified=true;s.phase='cancelled';s.reason=s.cancellation.reason;s.advertising=false;
    return {kind:'cancelled',reason:s.reason};
   }
   if(linkError)return stop('cancel-exit-incomplete','The connection ended before the cancelled trade left its room.');
   if(radio?.reason){
    this.linkExitFailureAt??=now;
    if(now-this.linkExitFailureAt>=3000)return stop('cancel-exit-incomplete','The radio disconnected before cancellation finished.');
   }
   const next=inspectNativeTradeExit(o,wireless,this.world);s.phase='cancelling-trade';return next;
  }
  if(s.exchangeStarted&&(linkError||radio?.reason))return stop('trade-outcome-unresolved','The link ended after the exchange started. Preserving the game; the partner may have received the Pokémon.');
  if(linkError)return this.retry('FireRed reported a communication error.',now);
  if(radio?.reason)return this.retry(radio.reason,now);
  if(s.exchangeStarted){s.phase='finishing-trade';return {kind:'wait'};}
  if(m.map?.id==='MAP_TRADE_CENTER'&&wireless?.remotePlayers===1&&radio?.available&&radio?.link?.session){
   if(s.expectedPartnerFingerprint&&wireless.tradeMenu?.callback===3){
    const partner=wireless.partnerParty?.[wireless.tradeMenu.partnerSlot-6];
    if(partner?.validity!=='valid')return {kind:'wait'};
    if(encounterFingerprint(partner)!==s.expectedPartnerFingerprint)return stop('partner-pokemon-mismatch','The partner offered a different Pokémon than the reserved local trade.');
   }
   const next=inspectNativeTradeRoom(o,wireless,this.world,party.indexOf(s.fingerprint));
   s.phase=next.phase;s.advertising=false;
   if(next.reason)s.reason=next.reason;
   return next;
  }
  // The stock script calls IsWirelessAdapterConnected before opening this menu.
  // Counter interaction occurs two tiles below the source-derived attendant.
  const atCounter=m.map?.id===s.map&&m.position?.x===this.attendant.x&&m.position?.y===this.attendant.y+2;
  if(s.role==='guest'&&(wireless?.guest||s.phase==='searching-leader')){
   s.phase='searching-leader';s.advertising=false;
   const guest=wireless?.guest,leaders=guest?.leaders?.filter(p=>p.active&&p.trainerId===s.peerTrainerId&&[4,5].includes(p.version))??[];
   if(atCounter&&radio?.available&&radio?.link?.session&&guest?.state===3&&leaders.length===1&&Number.isInteger(guest.cursor)){
    return input([guest.cursor===leaders[0].index?'a':guest.cursor<leaders[0].index?'down':'up']);
   }
   return {kind:'wait'};
  }
  if(['starting-leader','waiting-for-player','player-connected'].includes(s.phase)
   ||(atCounter&&wireless?.wirelessCommType===1&&radio?.adapter?.mode===1)){
   s.radio=radio;s.advertising=!!radio?.advertising;
   if(radio?.available)s.reason=null;
   s.phase=radio?.connected?'player-connected':s.advertising?'waiting-for-player':'starting-leader';
   s.wireless=wireless;
   // union_room.c: states 11/16 handle membership Yes/No. This cannot
   // select a party member or confirm an exchange in the trade screen.
   const leader=wireless?.leader;
   if(atCounter&&radio?.available&&radio?.link?.session&&Number.isInteger(radio.link.adapterClient)
    &&[11,16].includes(leader?.state)&&leader.textState===1&&[0,1].includes(leader.cursor)){
    return input(leader.cursor===0?['a']:['up']);
   }
   return {kind:'wait'};
  }
  const nativeSave=atCounter&&wireless?.wirelessCommType===1&&radio?.available&&m.activeTasks?.some(t=>['task50_save_game','SaveGameTask'].includes(t.function));
  if(nativeSave){s.phase='choosing-role';s.serviceMenuClosed=true;return input(['a']);}
  if(o.phase!=='stable')return {kind:'wait'};
  if(s.phase==='choosing-role'){
   if(!ui.choiceMenu)s.serviceMenuClosed=true;
   if(s.serviceMenuClosed&&ui.choiceMenu?.maxCursor===2){
    const roleIndex=s.role==='guest'?0:1;
    if(ui.choiceMenu.cursor!==roleIndex)return input(ui.choiceMenu.cursor<roleIndex?['down']:['up']);
    s.phase=s.role==='guest'?'searching-leader':'starting-leader';return input(['a']);
   }
   return input(['a']); // native Trade confirmation and the native Save dialog
  }
  if(atCounter&&ui.choiceMenu?.maxCursor>=2){
   s.wireless=wireless;
   if(wireless.validity!=='valid')return stop('wireless-unknown','The game’s wireless adapter status could not be verified.');
   if(wireless.wirelessCommType!==1)return stop('wireless-unavailable','At the upstairs Direct Corner. FireRed detects no Wireless Adapter in the current Suite emulator, so Leader hosting is unavailable.');
   if(!radio)return stop('transport-unavailable','The game detects a Wireless Adapter, but this Suite session has no native connection to the Switch radio. It is not advertising a Leader.');
   if(!radio.available)return {kind:'wait'};
   s.phase='choosing-role';s.serviceMenuClosed=false;s.reason=null;
   return input(['a']);
  }
  s.phase=m.map?.id===s.map?'checking-wireless':'traveling';
  return {kind:'policy',objective:{id:'native-trade-leader',target:{kind:'object',map:s.map,index:s.index},dialogue:'advance',choice:'yes',deferOptionalDetours:true}};
 }
}
