// Start the owning game's native save with ordinary Continue/quest-log inputs.
// An RFU network connection cannot be restored from an emulator snapshot.
import {encounterFingerprint} from '../player/encounter-tracker.js';

export function validateNativeEvolutionContinuation(o,wireless,preparation,baseline){
 if(preparation?.phase!=='ready'||preparation.nativeSaveVerified!==true||!preparation.fingerprint)throw new Error('The evolution source does not have a verified prepared native save.');
 const m=o.playerMemory,party=m?.trainer?.party?.map(encounterFingerprint);
 if(m?.trainer?.partyValidity!=='valid'||!Array.isArray(baseline?.party)||JSON.stringify(party)!==JSON.stringify(baseline.party)||party.filter(p=>p===preparation.fingerprint).length!==1)throw new Error('The prepared source and whole native party could not be verified.');
 if(!Number.isSafeInteger(baseline.savedGame)||!Number.isSafeInteger(preparation.saveBaseline?.counter)||baseline.savedGame<=preparation.saveBaseline.counter||m.gameStats?.savedGame!==baseline.savedGame||!Number.isSafeInteger(baseline.tradeCount)||wireless.tradeCount!==baseline.tradeCount)throw new Error('The prepared native save or trade counter changed.');
 return 'ready-for-evolution-transfer';
}

export function validateNativeTradeContinuation(o,wireless,state){
 const trainer=o.playerMemory?.trainer;
 if(trainer?.partyValidity!=='valid')throw new Error('The native save party could not be verified.');
 const party=trainer.party.map(encounterFingerprint),before=state.partyBefore;
 if(state.completion){
  const slot=before?.indexOf(state.fingerprint);
  if(!(slot>=0)||party.length!==before.length||party.some((p,i)=>i!==slot&&p!==before[i]))throw new Error('The completed trade party could not be verified.');
  if(party.includes(state.fingerprint)||party[slot]!==state.completion.receivedFingerprint||wireless.tradeCount!==state.completion.tradeCount)throw new Error('The completed exchange is not verified in this game’s native save.');
  if(!state.completion.handshakeVerified||!state.completion.linkClosedVerified)return 'saved-exit-incomplete';
  return 'complete';
 }
 if(state.exchangeStarted)throw new Error('The previous exchange started but its outcome is unresolved. Verify the partner’s party before reconnecting.');
 if(party.filter(p=>p===state.fingerprint).length!==1||(before&&JSON.stringify(party)!==JSON.stringify(before)))throw new Error('The native save no longer contains the verified prepared party.');
 if(Number.isInteger(state.tradeCountBefore)&&wireless.tradeCount!==state.tradeCountBefore)throw new Error('The native trade count changed; its outcome must be verified before reconnecting.');
 if(state.phase==='cancelled'&&state.cancellation?.exitVerified===true)return 'cancelled';
 return 'ready';
}

// One shared policy for explicit tasks, postgame resume, and native link boots.
// FireRed has one native save in the currently selected Suite game/profile.
export function inspectNativeSaveContinuation(o){
 const m=o.playerMemory??{},ui=m.ui??{},boot=['boot','unknown'].includes(o.emulator?.mode);
 if(!boot&&!m.questLog?.playback)return null;
 const wait=reason=>({kind:'resample',reason,action:{buttons:[],holdFrames:12,releaseFrames:0}});
 const press=(button,reason)=>({kind:'act',reason,action:{buttons:[button],holdFrames:1,releaseFrames:29}});
 if(m.questLog?.playback)return press('b','Finish the saved game’s quest-log replay.');
 if(ui.newGame)return {kind:'blocked',reason:'The current game entered New Game instead of its saved Continue entry. Choose its existing save before starting this task.'};
 const menu=ui.mainMenu;
 if(menu?.stage==='save-error')return {kind:'blocked',reason:'The cartridge reports a save error. Its current save is preserved for inspection.'};
 if(o.phase!=='stable'||o.emulator.paletteFadeActive)return wait('Waiting for the console menu to finish loading.');
 if(menu?.stage==='choose-save'){
  if(menu.saveStatus!==1||!menu.continueAvailable)return {kind:'blocked',reason:'This game has no verified Continue save. Choose an existing save profile before starting the bot.'};
  const target=menu.options?.indexOf('continue');
  if(!(target>=0)||!Number.isInteger(menu.cursor)||menu.cursor<0||menu.cursor>=menu.options.length)return wait('Waiting to verify the saved-game menu cursor.');
  return press(menu.cursor===target?'a':menu.cursor>target?'up':'down',menu.cursor===target?'Continue the selected game’s existing save.':'Select Continue in the saved-game menu.');
 }
 if(o.emulator.callback2==='CB2_MainMenu')return wait('Waiting for the saved-game menu.');
 if(/^(?:CB2_.*TitleScreen|CB2_.*Copyright|CB2_.*Intro)/.test(o.emulator.callback2??''))return press('a','Open the selected game’s saved-game menu.');
 return wait('Waiting for the selected game’s Continue menu.');
}

function* nativeSaveContinuation(session,observer){
 for(let n=0;n<6000;n++){
  const o=observer.capture();
  if(o.emulator.mode==='overworld'&&o.phase==='stable'&&!o.playerMemory.questLog?.playback)return o;
  const next=inspectNativeSaveContinuation(o);
  if(next?.kind==='blocked')throw new Error(next.reason);
  session.step(n%30===0?next?.action?.buttons??[]:[]);
  yield;
 }
 throw new Error('The native save did not reach a playable state.');
}

export function continueNativeSave(session,observer){
 const steps=nativeSaveContinuation(session,observer);let step;
 do{step=steps.next();}while(!step.done);
 return step.value;
}

export async function continueNativeSaveAsync(session,observer){
 const steps=nativeSaveContinuation(session,observer);let step,n=0;
 do{step=steps.next();if(!step.done&&++n%12===0)await new Promise(resolve=>setImmediate(resolve));}while(!step.done);
 return step.value;
}
