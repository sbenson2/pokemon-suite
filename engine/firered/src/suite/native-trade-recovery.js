import {validateNativeTradeContinuation,inspectNativeSaveContinuation} from './native-cold-boot.js';

// Paint the ROM's error message before pausing. Never press A here: that
// advances out of the error handler and needs separate native-save proof.
export function settleNativeLinkError(session,observe){
 for(let n=0;n<120;n++){
  const {callback2,mainState}=observe().emulator;
  if(callback2!=='CB2_LinkError'&&(callback2!=='CB2_PrintErrorMessage'||mainState>=2))break;
  session.step([]);
 }
}

export function inspectSavedTradeRecovery(o,wireless,state){
 if(!state||!['trade-outcome-unresolved','saved-exit-incomplete','recovering-saved-trade'].includes(state.phase)||
    state.game==='emerald'||!state.completion?.saveHandshakeVerified||state.recovery?.failed||wireless.remotePlayers!==0)return null;
 const blocked=reason=>({kind:'blocked',reason});
 const callback=o.emulator?.callback2;
 const errorScreen=['CB2_LinkError','CB2_PrintErrorMessage'].includes(callback);
 const field=callback==='CB2_Overworld'&&o.playerMemory.map?.id===state.map&&o.phase==='stable'&&
  !o.emulator.paletteFadeActive&&!o.playerMemory.scripts?.fieldControlsLocked&&!Object.values(o.playerMemory.ui??{}).some(Boolean);
 if(o.playerMemory.ui?.newGame)return blocked('Recovery entered New Game instead of the received Pokémon’s save.');
 if(state.recovery&&o.frame-state.recovery.startedFrame>3600)return blocked('The saved trade did not return to the registration counter. Its current state is preserved.');
 // ReloadSave clears and reloads the save blocks before its field callback.
 // Wait through that transition; revalidate the party before releasing it.
 if(state.recovery?.returnRequested&&!field){
  if(o.playerMemory.questLog?.playback){
   const next=inspectNativeSaveContinuation(o);
   if(next?.kind==='act')return {kind:'input',action:next.action};
  }
  return {kind:'wait'};
 }
 try{validateNativeTradeContinuation(o,wireless,state);}catch(error){return blocked(error.message);}
 if(!state.completion.nativeSaveVerified)return errorScreen||field?{kind:'verify-save'}:null;
 if(field)return {kind:'recovered'};
 if(!state.recovery)return null;
 if(callback==='CB2_PrintErrorMessage'){
  if(wireless.wirelessCommType!==1)return blocked('This link error cannot return directly to the verified saved game.');
  if(o.emulator.mainState===160){state.recovery.returnRequested=true;return {kind:'input',action:{buttons:['a'],holdFrames:1,releaseFrames:29}};}
 }
 if(o.playerMemory.questLog?.playback){
  const next=inspectNativeSaveContinuation(o);
  if(next?.kind==='act')return {kind:'input',action:next.action};
 }
 return {kind:'wait'};
}
