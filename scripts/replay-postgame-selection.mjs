import assert from 'node:assert/strict';
import {createPostgameController} from '../engine/firered/src/suite/postgame.js';
import {createFireRedObserver} from '../engine/firered/src/evidence/fire-red-observer.js';
import {readPostgameEvidence} from '../engine/firered/src/suite/postgame-agenda.js';
import {continueNativeSaveAsync} from '../engine/firered/src/suite/native-cold-boot.js';
import {createCampaignPlanner} from '../engine/firered/src/player/campaign.js';
import {createPolicyAdvisors} from '../engine/firered/src/player/advisors.js';
import {createCentralPlayer} from '../engine/firered/src/player/delegator.js';

export async function replayPostgameSelection({session,saved,inputs,createSession}){
 const original=structuredClone(saved.metadata.postgame),campaign=structuredClone(saved.metadata.campaign.record);
 const open=state=>createPostgameController({...inputs,mechanics:inputs.battle,state});let controller=open(original);
 const observer=createFireRedObserver({session,...inputs,runId:'postgame-selection',storyWatch:controller.storyWatch()});
 const capture=()=>{const o=observer.capture();return {...o,playerMemory:{...o.playerMemory,postgameEvidence:readPostgameEvidence(session,inputs.runtime,o)}};};
 const before=capture();assert.equal(before.playerMemory.trainer.pokedex.ownedSpecies.length,52);
 assert.equal(before.playerMemory.map.id,'MAP_CELADON_CITY_POKEMON_CENTER_1F');
 assert.equal(original.objective,null);
 // The post-League supply prerequisite now precedes the formerly immediate
 // fallback evolution. Keep the original evolution, identity, restart and
 // native-save assertions after qualifying this real shopping transaction.
 const free=o=>o.phase==='stable'&&o.emulator.mode==='overworld'&&!o.emulator.inBattle&&!Object.values(o.playerMemory.ui??{}).some(Boolean);
 const step=d=>{const a=d.action??{buttons:[],holdFrames:8};for(let n=0;n<(a.holdFrames??1);n++)session.step(a.buttons??[]);for(let n=0;n<(a.releaseFrames??0);n++)session.step([]);};
 let supplied=false,supplyRestart=false,supplySeen=false;
 for(let i=0;i<8000;i++){
  const o=capture(),d=controller.decide(o),state=controller.state();
  if(supplySeen&&state.fieldCare.spent>0&&!state.fieldCare.active&&free(o)){supplied=true;break;}
  assert.notEqual(d.kind,'blocked',d.reason);
  assert.ok(['stock-postgame-supplies','restore-postgame-party','restore-postgame-party-with-items','postgame-save'].includes(state.objective?.id),'only the new supply prerequisite may precede the original selection');
  supplySeen||=state.objective?.id==='stock-postgame-supplies';
  if(!supplyRestart&&o.playerMemory.ui.mart?.stage==='purchase-result'){
   controller=open(JSON.parse(JSON.stringify(state)));supplyRestart=true;
  }
  step(d);
 }
 assert.ok(supplied&&supplySeen&&supplyRestart,'finish the supply trip across a menu restart');
 const stocked=capture();assert.ok(stocked.playerMemory.trainer.money>=10000&&stocked.playerMemory.trainer.money<before.playerMemory.trainer.money);
 // Local acquisition ranking depends on location. Return by ordinary input
 // to the historical Celadon selection boundary, then reconstruct its retained
 // controller. No native state is restored or edited after the shopping trip.
 const target={id:'return-to-selection-checkpoint',target:{kind:'map-arrival',map:before.playerMemory.map.id},deferOptionalDetours:true};
 const planner={...createCampaignPlanner({...inputs,mechanics:inputs.battle}),select:()=>target,selectCollection:()=>null,selectTraining:()=>null,selectBattleSquad:()=>[],campaignStatus:()=>({objective:target.id}),state:()=>({objective:target})};
 const traveler=createCentralPlayer({campaignPlanner:planner,mechanics:inputs.battle,advisors:createPolicyAdvisors({campaignPlanner:planner,world:inputs.world,mechanics:inputs.battle})});
 let returned=false;
 for(let i=0;i<5000;i++){const o=capture();if(free(o)&&o.playerMemory.map.id===before.playerMemory.map.id){returned=true;break;}const d=traveler.decide(o);assert.notEqual(d.kind,'blocked',d.reason);step(d);}
 assert.ok(returned,'return to the original selection location through gameplay');
 controller=open(original);assert.equal(controller.decide(capture()).kind,'postgame-evolution-started');
 const selected=structuredClone(controller.state().dexEvolution);assert.equal(selected.request.speciesId,17);
 const source=selected.originalPokemon,identity=p=>JSON.stringify([p.personality,p.otId,...Object.values(p.ivs)]);
 const all=o=>[...o.playerMemory.trainer.party,...o.playerMemory.trainer.storage.pokemon].filter(p=>p.validity==='valid');
 const protectedBefore=all(before).map(identity).sort();let restarted=false,leftCenter=false,last='';
 for(let i=0;i<24000;i++){
  const after=capture(),d=controller.decide(after),state=controller.state(),m=after.playerMemory;
  assert.notEqual(d.kind,'blocked',d.reason);assert.notEqual(d.winner?.recommendation?.kind,'wait-for-supported-objective');
  assert.notEqual(state.objective?.target.kind,'await-postgame-dependency','the selected native route must remain executable');
  if(m.map.id!==before.playerMemory.map.id)leftCenter=true;
  if(!restarted&&m.ui?.storage){controller=open(JSON.parse(JSON.stringify(state)));restarted=true;}
  const trace=JSON.stringify([m.map.id,state.objective?.id,d.kind,d.reason,d.winner?.recommendation?.kind,m.ui?.storage?.stage]);
  if(process.env.SUITE_REPLAY_TRACE==='1'&&trace!==last){console.log('# selection '+after.frame+' '+trace);last=trace;}
  assert.deepEqual(saved.metadata.campaign.record,campaign);
  if(d.kind==='capture-saved'){controller.acknowledgeCapture();continue;}
  if(d.kind==='dex-evolution-saved'){
   assert.ok(restarted&&leftCenter);assert.equal(d.receipt.pokemon.species,17);
   assert.equal(d.receipt.pokemon.personality,source.personality);assert.equal(d.receipt.pokemon.otId,source.otId);assert.deepEqual(d.receipt.pokemon.ivs,source.ivs);
   assert.equal(d.receipt.nativeSaveAfterEvolution,true);assert.equal(d.receipt.nativeSaveVerified,true);
   for(const fingerprint of protectedBefore)assert.ok(all(after).some(p=>identity(p)===fingerprint),'every original individual remains in the game');
   assert.ok(m.trainer.pokedex.ownedSpecies.includes(17));assert.ok(m.gameStats.savedGame>before.playerMemory.gameStats.savedGame);assert.ok(free(after));
   const cold=await createSession();
   try{cold.loadSram(session.saveSram());const watch=createFireRedObserver({session:cold,...inputs,runId:'selection-cold',storyWatch:controller.storyWatch()});const loaded=await continueNativeSaveAsync(cold,watch);const p=all(loaded).find(p=>p.personality===source.personality&&p.otId===source.otId);assert.equal(p?.species,17);assert.deepEqual(p.ivs,source.ivs);assert.ok(loaded.playerMemory.trainer.pokedex.ownedSpecies.includes(17));}finally{cold.close();}
   controller.acknowledgeDexEvolution();controller=open(JSON.parse(JSON.stringify(controller.state())));
   const next=controller.decide(after);assert.ok(controller.state().dexEvolution||controller.state().objective,'a saved acquisition hands off to another explicit objective');
   assert.notEqual(controller.state().objective?.target.kind,'await-postgame-dependency','more local sources are available');
   assert.ok(['act','resample','postgame-evolution-started','postgame-hunt','postgame-acquisition-started'].includes(next.kind));
   controller.requestHandoff();assert.equal(controller.decide(after).kind,'handoff');
   return {before,after};
  }
  const action=d.action??{buttons:[],holdFrames:8};
  for(let n=0;n<(action.holdFrames??1);n++)session.step(action.buttons??[]);
  for(let n=0;n<(action.releaseFrames??0);n++)session.step([]);
 }
 throw Error('The stalled checklist did not finish its fallback acquisition and saved handoff.');
}
