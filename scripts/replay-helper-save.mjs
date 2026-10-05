import assert from 'node:assert/strict';
import {createCampaignController} from '../engine/firered/src/suite/campaign-run.js';
import {createFireRedObserver} from '../engine/firered/src/evidence/fire-red-observer.js';
import {encounterFingerprint} from '../engine/firered/src/player/encounter-tracker.js';
import {nationalSpeciesId} from '../engine/firered/src/evidence/gen3-national-species.js';

// Extra saves: a helper FireRed save is the ordinary story campaign with the
// needed one-per-save choice and a goal. These cases play the owner's real
// campaign checkpoints with the helper choices, controller inputs only.
const ITEM_HELIX_FOSSIL=357,ITEM_DOME_FOSSIL=358;
const items=o=>Object.values(o.playerMemory.trainer.bag??{}).flat();
const has=(o,id)=>items(o).some(i=>i?.itemId===id&&i.quantity>0);
const step=(session,decision)=>{const action=decision.action??{buttons:[],holdFrames:8};for(let n=0;n<(action.holdFrames??1);n++)session.step(action.buttons??[]);for(let n=0;n<(action.releaseFrames??0);n++)session.step([]);};
const helperRecord=(record,settings)=>({...record,settings:{...record.settings,afterCampaign:'wait',...settings}});
// A historical checkpoint may carry an idle supervision stop; a reviewed retry clears it.
function openHelper({saved,inputs,settings}){
 const original=saved.metadata.campaign,record=helperRecord(original.record,settings);
 const open=state=>createCampaignController({...inputs,mechanics:inputs.battle,record,state,clock:()=>0});
 return {original,record,open};
}

// September 28: every owned FireRed save took the Helix Fossil, so a helper
// save must take the Dome Fossil. From Mt. Moon B2F before either fossil
// (preserved from the campaign-home-healing checkpoint by the default campaign),
// a helper record choosing the Dome Fossil beats the Super Nerd and takes the
// Dome Fossil; the Helix Fossil stays behind, and a controller restart keeps the choice.
export function replayHelperDomeFossil({session,saved,inputs}){
 const {original,record,open}=openHelper({saved,inputs,settings:{fossil:'dome'}});
 let controller=open(original.state),restarted=false,last='';
 const observer=createFireRedObserver({session,...inputs,runId:'helper-dome-fossil',storyWatch:{flags:[...new Set([...controller.storyWatch().flags,562,626,627])],variables:controller.storyWatch().variables}});
 const before=observer.capture(),f0=before.playerMemory.storyState.flagIds;
 assert.equal(before.playerMemory.map.id,'MAP_MT_MOON_B2F');
 assert.deepEqual([f0[562],f0[626],f0[627]],[false,false,false],'neither fossil has been taken');
 for(let i=0;i<20000;i++){
  const after=observer.capture(),f=after.playerMemory.storyState.flagIds;
  if(f[562]===true&&after.phase==='stable'&&after.emulator.mode==='overworld'&&!Object.values(after.playerMemory.ui).some(Boolean)){
   assert.equal(f[626],true,'FLAG_GOT_DOME_FOSSIL');assert.equal(f[627],false,'the Helix Fossil stays behind');
   assert.ok(has(after,ITEM_DOME_FOSSIL),'the Dome Fossil is in the key items');assert.ok(!has(after,ITEM_HELIX_FOSSIL));
   assert.ok(restarted,'the choice survived a controller restart');
   assert.equal(after.sram.sha256,before.sram.sha256,'taking the fossil does not write a native save');
   assert.deepEqual(controller.record,record);
   return {before,after};
  }
  const decision=controller.decide(after);
  const trace=JSON.stringify([after.playerMemory.map?.id,controller.state().objective?.id,decision.kind,decision.reason]);
  if(trace!==last){console.log('# helper-dome-fossil '+after.frame+' '+trace);last=trace;}
  assert.notEqual(decision.kind,'blocked',decision.reason);
  assert.notEqual(f[627],true,'the helper never takes the Helix Fossil');
  if(!restarted&&i>20&&after.phase==='stable'&&after.emulator.mode==='overworld'&&!after.emulator.inBattle&&!Object.values(after.playerMemory.ui).some(Boolean)){
   controller=open(JSON.parse(JSON.stringify(controller.state())));restarted=true;
  }
  step(session,decision);
 }
 throw Error('The helper save did not take the Dome Fossil.');
}

// The fossil helper's goal: from the owner's Cinnabar Island campaign
// checkpoint (Helix Fossil still in the bag, before Sabrina), the helper record
// with a fossil goal hands the fossil to the Cinnabar Lab, walks out and back,
// receives the revived Pokémon, saves it in the party at the Cinnabar Pokémon
// Center (a Direct Corner upstairs) and stops with its goal receipt. The Dome
// Fossil route differs only by the object index and flags; this checkpoint
// holds the Helix Fossil every owned save took.
export function replayHelperFossilGoal({session,saved,inputs}){
 const {original,open}=openHelper({saved,inputs,settings:{fossil:'helix',helperGoal:{kind:'fossil',fossil:'helix'}}});
 assert.equal(original.state.objective.id,'badge-marsh');
 let controller=open(original.state),restarted=false,handedIn=false,last='';
 const observer=createFireRedObserver({session,...inputs,runId:'helper-fossil-goal',storyWatch:controller.storyWatch()});
 const before=observer.capture(),f0=before.playerMemory.storyState.flagIds;
 assert.equal(before.playerMemory.map.id,'MAP_CINNABAR_ISLAND');
 assert.deepEqual([f0[627],f0[749]],[true,false],'the Helix Fossil is still unrevived');
 assert.ok(has(before,ITEM_HELIX_FOSSIL));
 const first=controller.decide(before);
 if(first.kind==='blocked'){assert.equal(first.reason,'no-meaningful-progress');controller.resume({retryBlockedPolicy:true});}
 for(let i=0;i<30000;i++){
  const after=observer.capture(),m=after.playerMemory;
  const decision=controller.decide(after);
  const trace=JSON.stringify([m.map?.id,controller.state().objective?.id,decision.kind,decision.reason,m.storyState.variableIds?.[0x406A]]);
  if(trace!==last){console.log('# helper-fossil-goal '+after.frame+' '+trace);last=trace;}
  if(decision.kind==='campaign-complete'){
   const receipt=decision.helperGoal,state=controller.state();
   assert.equal(state.status,'complete');assert.deepEqual(state.completion.helperGoal,receipt);
   assert.equal(receipt.species,138);assert.equal(receipt.center,'MAP_CINNABAR_ISLAND_POKEMON_CENTER_1F');
   assert.deepEqual(receipt.grants,[receipt.fingerprint]);
   assert.equal(m.storyState.flagIds[749],true,'FLAG_REVIVED_HELIX');assert.ok(!has(after,ITEM_HELIX_FOSSIL),'the fossil was handed in');
   const omanyte=m.trainer.party.find(p=>encounterFingerprint(p)===receipt.fingerprint);
   assert.equal(nationalSpeciesId(omanyte?.species),138,'the revived Pokémon is in the party');assert.equal(omanyte.otId,m.trainer.otId);
   assert.equal(m.map.id,'MAP_CINNABAR_ISLAND_POKEMON_CENTER_1F');
   assert.equal(receipt.savedSramSha256,after.sram.sha256);assert.notEqual(after.sram.sha256,before.sram.sha256,'the goal was saved natively');
   assert.equal(m.storyState.flagIds[2085],false,'the helper stopped before Sabrina');
   assert.ok(restarted,'the goal survived a controller restart');
   return {before,after};
  }
  assert.notEqual(decision.kind,'blocked',decision.reason);
  handedIn||=m.storyState.variableIds?.[0x406A]>=1;
  if(!restarted&&handedIn&&m.map.id==='MAP_CINNABAR_ISLAND_POKEMON_LAB_ENTRANCE'){controller=open(JSON.parse(JSON.stringify(controller.state())));restarted=true;}
  step(session,decision);
 }
 throw Error('The helper save did not revive and park its fossil.');
}

// An archived FireRed save must be saved in a Pokémon Center with a Direct
// Corner before it can lend anything (the partner is never given tasks). The
// archived FIRE save (TID 32589, Charmander start, post-League, saved in
// Pallet Town, Charizard in its party) is parked by the ordinary travel player
// task: it walks to the Viridian City Center and saves there. The parked
// native save is then ready to lend its Charizard to the main save.
export async function replayHelperPark({session,saved,inputs,createSession}){
 const {createPostgameController}=await import('../engine/firered/src/suite/postgame.js');
 const {readPostgameEvidence}=await import('../engine/firered/src/suite/postgame-agenda.js');
 const {continueNativeSave}=await import('../engine/firered/src/suite/native-cold-boot.js');
 const {inspectFireRedPartnerReadiness,FIRERED_PARTNER_WATCH}=await import('../engine/firered/src/suite/firered-partner.js');
 const {emptyPartnerLedger}=await import('../engine/firered/src/suite/extra-save-exchange.js');
 const CENTER='MAP_VIRIDIAN_CITY_POKEMON_CENTER_1F',request={id:'park-08b8c4c8',kind:'travel',map:CENTER};
 const open=state=>createPostgameController({...inputs,mechanics:inputs.battle,state});
 let controller=open(null);controller.beginPlayerTask(request);
 const observer=createFireRedObserver({session,...inputs,runId:'helper-park',storyWatch:controller.storyWatch()});
 const capture=()=>{const o=observer.capture();return {...o,playerMemory:{...o.playerMemory,postgameEvidence:readPostgameEvidence(session,inputs.runtime,o)}};};
 const before=capture(),t0=before.playerMemory.trainer;
 assert.equal(before.playerMemory.map.id,'MAP_PALLET_TOWN');assert.equal(before.playerMemory.storyState.flagIds[2092],true);
 const charizard=t0.party.find(p=>nationalSpeciesId(p.species)===6&&!p.shiny);assert.ok(charizard,'the archived save carries its non-shiny Charizard');
 const identities=o=>[...o.playerMemory.trainer.party,...o.playerMemory.trainer.storage.pokemon].map(encounterFingerprint).sort();
 let restarted=false,last='';
 for(let i=0;i<12000;i++){
  const o=capture(),m=o.playerMemory,decision=controller.decide(o);
  const trace=JSON.stringify([m.map?.id,decision.kind,decision.reason]);if(trace!==last){console.log('# helper-park '+o.frame+' '+trace);last=trace;}
  assert.notEqual(decision.kind,'blocked',decision.reason);
  if(decision.kind==='player-task-complete'){
   assert.equal(decision.receipt.nativeSaveVerified,true);assert.equal(m.map.id,CENTER);
   assert.equal(m.gameStats.savedGame,before.playerMemory.gameStats.savedGame+1);assert.notEqual(o.sram.sha256,before.sram.sha256);
   assert.deepEqual(identities(o),identities(before),'parking keeps every individual');
   assert.ok(restarted,'the park survived a controller restart');
   const check=await createSession();let cold;
   try{check.loadSram(Buffer.from(session.saveSram()));cold=continueNativeSave(check,createFireRedObserver({session:check,...inputs,runId:'helper-park-cold',storyWatch:{flags:[...FIRERED_PARTNER_WATCH.flags],variables:[]}}));}
   finally{check.close();}
   const offer={schema:'pokemon-suite/extra-save-offer/v1',exchangeId:'extra-save-starter-charmander-1',mode:'loan',leg:'open',fingerprint:encounterFingerprint(charizard),expectSource:'[129,1,1,1,1,1,1,1,1]'};
   const ready=inspectFireRedPartnerReadiness({live:o,saved:cold,world:inputs.world,owner:'firered-partner-2',requestId:'extra-save-starter-charmander-1-open',sramSha256:o.sram.sha256,offer,ledger:emptyPartnerLedger()});
   assert.equal(ready.phase,'ready-for-transfer',ready.reason);assert.equal(ready.center,CENTER);
   assert.equal(encounterFingerprint(ready.transferCandidate),encounterFingerprint(charizard),'the parked save lends its Charizard');
   return {before,after:o};
  }
  // Reconstruct the owner once it has left Pallet Town (it may fly or walk).
  if(!restarted&&m.map?.id!=='MAP_PALLET_TOWN'&&o.phase==='stable'&&o.emulator.mode==='overworld'&&!o.emulator.inBattle&&!Object.values(m.ui??{}).some(Boolean)){controller=open(JSON.parse(JSON.stringify(controller.state())));restarted=true;}
  step(session,decision);
 }
 throw Error('The archived save did not park in the Viridian City Pokémon Center.');
}
