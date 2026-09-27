import {encounterFingerprint} from '../player/encounter-tracker.js';
import {partyFullyRestored} from '../player/recovery.js';
import {nativeTradeFinished} from './native-trade-host.js';

export function assertOwnedTradeReady({observation:o,mission,capture,campaign,running=false,localBusy=false,nativeTrade,wireless}) {
 if(campaign&&campaign.status!=='complete')throw Error('Finish the story run or load another save before trading.');
 if(running)throw Error('Stop the current bot task before preparing a trade.');
 if(localBusy)throw Error('Finish the reserved evolution round trip before trading.');
 if(!nativeTradeFinished(nativeTrade))throw Error('Finish or resolve the current exchange first.');
 if(wireless?.remotePlayers!==0)throw Error('Leave the active link room before selecting another Pokémon.');
 if(capture&&!capture.nativeSaveVerified||mission?.protected&&mission.status!=='complete')throw Error('Save the protected encounter before preparing a trade.');
 const encounter=o?.playerMemory?.encounter;
 const ordinaryBattle=o?.emulator?.inBattle&&(encounter?.kind==='trainer'||encounter?.validity==='valid'&&encounter.pokemon?.shiny===false);
 if(o?.phase!=='stable'||o.emulator?.mode!=='overworld'&&!ordinaryBattle||o.playerMemory?.trainer?.partyValidity!=='valid'||o.playerMemory?.trainer?.storage?.validity!=='valid')throw Error('Finish the protected encounter or return to the field before preparing a trade.');
 if(!ordinaryBattle&&Object.values(o.playerMemory.ui??{}).some(Boolean))throw Error('Close the current menu before preparing a trade.');
}

// Continue the caught individual's save using normal travel, PC, nurse and
// SAVE inputs. This task never restores the hunt anchor or rewrites a Pokémon.
export class TradePreparation {
 constructor({receipt,center,nurseIndex,mechanics,state=null}) {
  if(!receipt?.fingerprint || !['saved-awaiting-partner','owned-awaiting-save'].includes(receipt.state))throw new Error('Trade preparation needs a verified, saved capture or an owned individual awaiting its native save.');
  if(state && (state.requestId!==receipt.requestId || state.fingerprint!==receipt.fingerprint))throw new Error('Trade preparation belongs to another capture.');
  this.mechanics=mechanics;
  this.state=state?structuredClone(state):{requestId:receipt.requestId,fingerprint:receipt.fingerprint,center,nurseIndex,phase:'party',saveBaseline:null};
 }
 inspect(o) {
  const s=this.state,m=o.playerMemory??{},t=m.trainer??{},ui=m.ui??{};
  const policy=(id,target)=>({kind:'policy',objective:{id,target,dialogue:'advance',choice:'yes',deferOptionalDetours:true}});
  const stop=reason=>({kind:'stop',reason});
  if(o.phase!=='stable')return {kind:'wait'};
  // Let the central player's encounter guard handle any new encounter safely.
  if(o.emulator?.inBattle)return policy('trade-reach-center',{kind:'map',map:s.center});
  if(t.partyValidity!=='valid'||t.storage?.validity!=='valid')return {kind:'wait'};
  // A traded Mail holder carries its Mail record; never start a trade with party Mail.
  if((t.party??[]).some(p=>Number(p.heldItem)>=121&&Number(p.heldItem)<=132))return stop('Take Mail off every party Pokémon before trading.');
  const party=t.party??[],stored=t.storage.pokemon??[],all=[...party,...stored];
  const matches=all.filter(p=>encounterFingerprint(p)===s.fingerprint);
  if(!ui.storage && matches.length!==1)return stop('The saved capture is missing or duplicated. Trade preparation stopped.');
  const member=party.find(p=>encounterFingerprint(p)===s.fingerprint);
  if(s.phase==='party') {
   const species=JSON.parse(s.fingerprint)[0];
   if(!member || m.map?.id!==s.center || ui.storage) {
    return policy('trade-withdraw-capture',{kind:'party-roster',map:s.center,minimumPartySize:Math.max(2,Math.min(6,party.length+(member?0:1))),maximumPartySize:6,requiredFingerprints:[s.fingerprint],requiredFamilies:party.filter(p=>p.moves?.includes(19)).map(p=>[p.species])});
   }
   s.phase='healing';
  }
  if(!member)return stop('The captured individual is no longer in the trade party.');
  if(s.phase==='healing') {
   if(m.map?.id!==s.center || !partyFullyRestored(m,this.mechanics) || ui.fieldDialog || ui.choiceMenu || o.emulator?.mode!=='overworld')return policy('trade-heal-party',{kind:'object',map:s.center,index:s.nurseIndex});
   if(!Number.isSafeInteger(m.gameStats?.savedGame)||!o.sram?.sha256)return stop('Native save baseline unavailable.');
   s.saveBaseline={counter:m.gameStats.savedGame,sha256:o.sram.sha256};s.phase='saving';
  }
  if(s.phase==='saving') {
   if(['error','saving-error'].includes(ui.saveDialog?.stage))return stop('The native save failed.');
   if(m.gameStats?.savedGame>s.saveBaseline.counter+1)return stop('The native save counter changed unexpectedly.');
   const verified=m.saveAttemptStatus===1 && m.gameStats?.savedGame===s.saveBaseline.counter+1 && o.sram?.sha256!==s.saveBaseline.sha256;
   if(!verified || o.emulator?.mode!=='overworld' || ui.saveDialog || ui.startMenu || ui.fieldDialog || ui.choiceMenu)return policy('trade-save-at-center',{kind:'save-game',map:s.center,saveVerified:verified});
   if(m.map?.id!==s.center || !partyFullyRestored(m,this.mechanics))return stop('The saved trade party is not ready at the Pokémon Center.');
   s.phase='ready';s.pokemon=structuredClone(member);s.nativeSaveVerified=true;
  }
  return {kind:'ready',pokemon:s.pokemon};
 }
}
