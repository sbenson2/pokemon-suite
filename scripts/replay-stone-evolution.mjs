import assert from 'node:assert/strict';
import {setImmediate as yieldIO} from 'node:timers/promises';
import {createFireRedObserver} from '../engine/firered/src/evidence/fire-red-observer.js';
import {createPostgameController} from '../engine/firered/src/suite/postgame.js';
import {readPostgameEvidence} from '../engine/firered/src/suite/postgame-agenda.js';
import {continueNativeSaveAsync} from '../engine/firered/src/suite/native-cold-boot.js';
import {ruinValleySunStoneStep,RUIN_VALLEY,SUN_STONE} from '../engine/firered/src/suite/ruin-valley-route.js';
import {nationalSpeciesId} from '../engine/firered/src/evidence/gen3-national-species.js';
import {encounterFingerprint as fingerprint} from '../engine/firered/src/player/encounter-tracker.js';

// Live October 1 (engine 125.1): the main save stopped with "2 more are possible
// in this save but need a workflow the bot does not have yet: flareon,
// bellossom". From that exact stop (an engine-125 exhausted record), the
// retained owner must evaluate the collection again and:
// - Flareon (stoneEvolution.speciesId 136): evolve the plain hatched Eevee with
//   a Fire Stone bought at the Celadon Department Store 4F, reached from Four
//   Island over the Seagallop;
// - Bellossom (182): take Six Island's Ruin Valley Sun Stone behind its three
//   Strength boulders on the reviewed push order, then raise the plain PC
//   Oddish to Gloom and use the stone. The League trainee Gloom stays as is.
// Entry: the owned evolution starts from the plain individual, never a shiny.
// Completion: the species is registered and a native save is verified.
// Handoff: a cold Continue proves the evolved individual, the consumed stone and
// every original individual. Restarts at the named points (a fresh controller
// from the serialized state, as the worker's update handoff does).
const NATIVE_FRAMES_PER_SECOND=59.7275;
const bagCount=(o,id)=>Object.values(o.playerMemory.trainer.bag??{}).flat().reduce((n,i)=>n+(i?.itemId===id?Number(i.quantity)||0:0),0);
const same=(a,b)=>a&&b&&a.personality===b.personality&&a.otId===b.otId;
export async function replayStoneEvolution({session,saved,inputs,createSession,fixture={}}){
 const spec=fixture.stoneEvolution;
 assert.ok([136,182].includes(spec?.speciesId)&&Number.isInteger(spec.itemId)&&Array.isArray(spec.from),'a stone evolution case names its species, stone and source forms');
 const retained=structuredClone(saved.metadata.session.postgame);
 assert.equal(retained.status,'dependency','start at the live finished stop');
 const dex=retained.agenda.workflows.dex??={};
 assert.ok(dex.exhausted&&dex.exhausted.workflows===undefined,'the live save carries the engine-125 exhausted record');
 dex.failed??={};
 // Isolate this species: the other new local routes keep ordinary retry records.
 for(const id of spec.defer??[])dex.failed[id]={reason:'Deferred in this isolated stone-evolution replay.',attempts:1,retryAt:Date.parse('2100-01-01T00:00:00Z')};
 let now=Date.parse(saved.updatedAt);
 const open=state=>createPostgameController({...inputs,mechanics:inputs.battle,state,clock:()=>now});
 let controller=open(structuredClone(retained));
 const observer=createFireRedObserver({session,...inputs,runId:'stone-evolution-'+spec.speciesId,storyWatch:controller.storyWatch()});
 const capture=()=>{const raw=observer.capture();return {...raw,playerMemory:{...raw.playerMemory,postgameEvidence:readPostgameEvidence(session,inputs.runtime,raw)}};};
 const before=capture(),t0=before.playerMemory.trainer,everyone0=[...t0.party,...t0.storage.pokemon];
 assert.ok(!t0.pokedex.ownedSpecies.includes(spec.speciesId),'the species is missing at the stop');
 assert.equal(bagCount(before,spec.itemId),0,'the stone is not stocked at the stop');
 const shinies=everyone0.filter(p=>p.shiny).map(p=>({fp:fingerprint(p),species:p.species,heldItem:p.heldItem,moves:JSON.stringify(p.moves)}));
 const restarts=new Set(),wanted=new Set(fixture.restarts??[]);
 const restart=point=>{if(wanted.has(point)&&!restarts.has(point)){controller=open(JSON.parse(JSON.stringify(controller.state())));restarts.add(point);}};
 let source=null,stocked=false,martSeen=false,pushes=new Set(),last='';
 const startFrame=session.frame,bound=Number(fixture.maxFrames??900000);
 for(let i=0;session.frame-startFrame<bound;i++){
  const o=capture(),m=o.playerMemory,d=controller.decide(o),state=controller.state();
  const step=m.map?.id===RUIN_VALLEY&&o.phase==='stable'?ruinValleySunStoneStep(o):null;
  if(step?.kind==='push')pushes.add(step.step);
  const trace=JSON.stringify([m.map?.id,d.kind,d.winner?.recommendation?.kind??null,state.objective?.id??state.preparation?.phase,state.dexEvolution?.phase??null,bagCount(o,spec.itemId),step?.kind==='push'?step.step:step?.kind??null]);
  if(process.env.SUITE_REPLAY_TRACE==='1'&&trace!==last){console.log('# stone-evolution '+o.frame+' '+trace);last=trace;}
  assert.notEqual(d.kind,'blocked',d.reason);
  assert.notEqual(state.objective?.target?.kind,'await-postgame-dependency','The collection stayed finished: '+state.objective?.target?.reason);
  assert.ok(!['postgame-hunt','postgame-acquisition-started','power-cycle'].includes(d.kind),'this isolated case only travels, collects or buys, and evolves: '+d.kind);
  if(m.ui?.mart){martSeen=true;restart('mart');}
  if(step?.kind==='push'&&step.step===2)restart('boulders');
  if(bagCount(o,spec.itemId)>0){stocked=true;restart('stocked');}
  if(state.dexEvolution&&['evolving','saving'].includes(state.dexEvolution.phase))restart('evolution');
  if(d.kind==='capture-saved'){controller.acknowledgeCapture();continue;}
  if(d.kind==='postgame-evolution-started'){
   const e=controller.state().dexEvolution;
   assert.equal(e.request.speciesId,spec.speciesId,'the owned evolution of this species starts');
   source=e.originalPokemon;
   assert.equal(source.shiny,false,'a plain individual, never a shiny');
   assert.ok(spec.from.includes(nationalSpeciesId(source.species)),'the evolution starts from '+spec.from.join('/'));
   console.log('# stone-evolution start '+JSON.stringify({frame:o.frame,species:source.species,personality:source.personality,level:source.level,stocked}));
   continue;
  }
  if(d.kind==='dex-evolution-saved'){
   const r=d.receipt;
   assert.ok(source,'the evolution was started by this owner');
   assert.equal(r.nativeSaveVerified,true);assert.equal(nationalSpeciesId(r.pokemon.species),spec.speciesId);assert.ok(same(r.pokemon,source),'the same individual evolved');
   assert.ok(m.trainer.pokedex.ownedSpecies.includes(spec.speciesId),'the species is registered');
   assert.ok(stocked,'the stone reached the Bag before the evolution');
   assert.equal(bagCount(o,spec.itemId),0,'the stone was consumed');
   if(spec.itemId===95)assert.ok(martSeen,'the Fire Stone was bought at the mart');
   if(spec.itemId===SUN_STONE.itemId){assert.equal(m.storyState.flagIds[SUN_STONE.flagId],true,'the Ruin Valley ball was collected');assert.deepEqual([...pushes].sort(),[0,1,2,3],'all four reviewed pushes were made');}
   for(const point of wanted)assert.ok(restarts.has(point),'restarted at '+point);
   const cold=await createSession();
   try{
    cold.loadSram(session.saveSram());
    const loaded=await continueNativeSaveAsync(cold,createFireRedObserver({session:cold,...inputs,runId:'stone-evolution-cold',storyWatch:controller.storyWatch()}));
    const lt=loaded.playerMemory.trainer,everyone=[...lt.party,...lt.storage.pokemon];
    assert.ok(lt.pokedex.ownedSpecies.includes(spec.speciesId),'the registration is saved');
    assert.equal(everyone.filter(p=>same(p,source)&&nationalSpeciesId(p.species)===spec.speciesId).length,1,'the evolved individual is saved');
    assert.equal(bagCount(loaded,spec.itemId),0,'the saved Bag holds no leftover stone');
    for(const p of everyone0)assert.equal(everyone.filter(q=>same(q,p)).length,1,'every original individual is kept');
    for(const s of shinies){const kept=everyone.find(p=>fingerprint(p)===s.fp);assert.ok(kept&&kept.species===s.species&&kept.heldItem===s.heldItem&&JSON.stringify(kept.moves)===s.moves,'every shiny is unchanged');}
   }finally{cold.close();}
   controller.acknowledgeDexEvolution();
   console.log('# stone-evolution verified '+JSON.stringify({speciesId:spec.speciesId,frame:o.frame,frames:o.frame-before.frame,source:{species:source.species,level:source.level},restarts:[...restarts],pushes:[...pushes].sort()}));
   return {before,after:o};
  }
  const action=d.action??{buttons:[],holdFrames:8};
  const start=session.frame;
  for(let j=0;j<(action.holdFrames??1);j++)session.step(action.buttons??[]);
  for(let j=0;j<(action.releaseFrames??0);j++)session.step([]);
  now+=(session.frame-start)*1000/NATIVE_FRAMES_PER_SECOND;
  if(i%200===0)await yieldIO();
 }
 throw Error('The stone evolution did not finish within the native replay bound.');
}
