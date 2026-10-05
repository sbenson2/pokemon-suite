import assert from 'node:assert/strict';
import {setImmediate as yieldIO} from 'node:timers/promises';
import {createFireRedObserver} from '../engine/firered/src/evidence/fire-red-observer.js';
import {createPostgameController} from '../engine/firered/src/suite/postgame.js';
import {readPostgameEvidence} from '../engine/firered/src/suite/postgame-agenda.js';
import {continueNativeSaveAsync} from '../engine/firered/src/suite/native-cold-boot.js';
import * as breeding from '../engine/firered/src/suite/native-breeding.js';
import {encounterFingerprint as fingerprint} from '../engine/firered/src/player/encounter-tracker.js';

// Live September 28 (build 123): this save's only Eevee is shiny, and shinies
// are never evolved, so Vaporeon, Jolteon and Flareon had no source and the
// owner stood still. From the preserved checkpoint, with the fishing catches
// deferred through the agenda's own per-species retry records (they have their
// own case), the retained owner must:
// - entry: start a breed-to-evolve Day Care task with the shiny Eevee as its
//   protected parent and a plain partner (Ditto), withdrawing the shiny only
//   early in the cartridge's 128-step friendship cycle;
// - completion: receive the Egg, withdraw both parents, store the shiny back in
//   the PC before hatching, hatch a plain Eevee and verify a native save; the
//   shiny keeps its identity, moves, item and friendship (only the Day Care's
//   own experience is added);
// - handoff: evolve the hatchling, never the shiny, with a Thunder, Water or
//   Fire Stone and verify that native save.
// Restarts: at the Day Care deposit menu, after the first withdrawal, while
// hatching, and during the evolution. A cold Continue proves both saves.
const NATIVE_FRAMES_PER_SECOND=59.7275,EEVEE=133;
export async function replayBreedToEvolve({session,saved,inputs,createSession,fixture={}}){
 const retained=structuredClone(saved.metadata.session.postgame);
 assert.equal(retained.status,'dependency','start at the live stop');
 let now=Date.parse(saved.updatedAt);
 const dex=retained.agenda.workflows.dex??={};dex.failed??={};
 // Isolate the Eevee line: the fishing catches and the other local routes keep
 // ordinary retry records, as the national-ember replay isolates Slugma.
 for(const id of [98,99,211,182,186,212,108,124,238,360,138])dex.failed[id]={reason:'Deferred in this isolated breed-to-evolve replay.',attempts:1,retryAt:Date.parse('2100-01-01T00:00:00Z')};
 const open=state=>createPostgameController({...inputs,mechanics:inputs.battle,state,clock:()=>now});
 let controller=open(structuredClone(retained));
 const observer=createFireRedObserver({session,...inputs,runId:'breed-to-evolve',storyWatch:controller.storyWatch()});
 const capture=()=>{const raw=observer.capture();return {...raw,playerMemory:{...raw.playerMemory,postgameEvidence:readPostgameEvidence(session,inputs.runtime,raw)}};};
 const before=capture(),t0=before.playerMemory.trainer;
 const eevees=[...t0.party,...t0.storage.pokemon].filter(p=>p.species===EEVEE&&!p.isEgg);
 assert.equal(eevees.length,1);assert.equal(eevees[0].shiny,true,'the only Eevee is shiny');
 const shiny=eevees[0],shinyId=fingerprint(shiny),originals=[...t0.party,...t0.storage.pokemon].map(fingerprint);
 const restarted=new Set(),withdrawnAt=[];let last='',acquisitionReceipt=null,evolution=null,saves=before.playerMemory.gameStats.savedGame;
 const restart=point=>{if(!restarted.has(point)){controller=open(JSON.parse(JSON.stringify(controller.state())));restarted.add(point);}};
 const held=(o,id)=>{const t=o.playerMemory.trainer;return t.party.some(p=>fingerprint(p)===id)?'party':t.storage.pokemon.some(p=>fingerprint(p)===id)?'pc':
  o.playerMemory.postgameEvidence?.acquisition?.daycare?.parents?.some(p=>fingerprint(p)===id)?'daycare':null;};
 let shinyWhere='pc';
 for(let i=0;i<400000;i++){
  const o=capture(),m=o.playerMemory,d=controller.decide(o),state=controller.state(),a=state.acquisition;
  const where=held(o,shinyId);
  if(where&&where!==shinyWhere){
   // The PC menus take no steps: the walk begins at the next field observation.
   if(shinyWhere==='pc'&&where==='party')withdrawnAt.push({frame:o.frame,counter:null});
   shinyWhere=where;
  }
  const leg=withdrawnAt.at(-1),counter=m.postgameEvidence?.acquisition?.happinessStepCounter;
  if(leg&&leg.counter===null&&shinyWhere==='party'&&o.phase==='stable'&&Number.isInteger(counter))Object.assign(leg,{counter,walkFrame:o.frame});
  const trace=JSON.stringify([m.map?.id,a?.phase??state.dexEvolution?.phase,d.kind,d.winner?.recommendation?.kind??null,state.objective?.id,shinyWhere,m.postgameEvidence?.acquisition?.daycare?.parents?.map(p=>p.steps)]);
  if(process.env.SUITE_REPLAY_TRACE==='1'&&trace!==last){console.log('# breed-to-evolve '+o.frame+' '+trace);last=trace;}
  assert.notEqual(d.kind,'blocked',d.reason);
  if(i===0){
   assert.equal(d.kind,'postgame-acquisition-started',JSON.stringify({kind:d.kind,reason:d.reason}));
   assert.equal(a.kind,'breeding');assert.equal(a.speciesId,EEVEE);assert.equal(a.protectedParent.fingerprint,shinyId);
   assert.ok([134,135,136].includes(a.evolutionTarget));assert.equal(a.parents.find(p=>fingerprint(p)!==shinyId).species,132,'Ditto is the partner');
   console.log('# breed-to-evolve start '+JSON.stringify({frame:o.frame,target:a.evolutionTarget,counter:m.postgameEvidence.acquisition.happinessStepCounter}));
  }
  // Restarts across the transaction.
  if(m.ui?.party?.menuType===6)restart('deposit-menu');
  if(a?.egg&&a.parentsReturned?.length===1)restart('withdrawal');
  if(a?.phase==='hatching'&&shinyWhere==='pc')restart('hatching');
  if(state.dexEvolution&&state.dexEvolution.phase!=='preparing')restart('evolution');
  if(d.kind==='capture-saved'){controller.acknowledgeCapture();continue;}
  if(d.kind==='acquisition-saved'){
   const r=d.receipt;acquisitionReceipt=r;
   assert.ok(restarted.has('deposit-menu')&&restarted.has('withdrawal')&&restarted.has('hatching'),'the Day Care transaction survived every restart');
   assert.equal(r.nativeSaveVerified,true);assert.equal(r.pokemon.species,EEVEE);assert.equal(r.pokemon.isEgg,false);assert.equal(r.matched,true);
   assert.notEqual(r.fingerprint,shinyId);
   const p=r.protectedParent;
   assert.equal(p.fingerprint,shinyId);assert.equal(p.after.location,'pc','the shiny is back in the PC');
   assert.deepEqual(p.after.moves,p.before.moves,'its moves are unchanged');assert.equal(p.after.heldItem,p.before.heldItem);
   assert.equal(p.after.friendship,p.before.friendship,'its friendship is unchanged');assert.equal(p.after.shiny,true);
   assert.equal(p.after.experience-p.before.experience,p.daycareSteps,'only the Day Care steps were added as experience');
   assert.ok(p.daycareSteps<=p.budget,'withdrawn before the next move-learning level');
   assert.ok(withdrawnAt.length>=1&&withdrawnAt.every(x=>x.counter<=breeding.PROTECTED_WALK_ALIGNMENT),'the shiny left the PC early in the friendship cycle: '+JSON.stringify(withdrawnAt));
   assert.equal(m.gameStats.savedGame,saves+1);saves=m.gameStats.savedGame;
   const cold=await createSession();
   try{
    cold.loadSram(session.saveSram());
    const loaded=await continueNativeSaveAsync(cold,createFireRedObserver({session:cold,...inputs,runId:'breed-to-evolve-cold',storyWatch:controller.storyWatch()}));
    const lt=loaded.playerMemory.trainer,everyone=[...lt.party,...lt.storage.pokemon];
    assert.equal(everyone.filter(x=>fingerprint(x)===r.fingerprint&&!x.isEgg).length,1,'the hatched Eevee is saved');
    const kept=lt.storage.pokemon.find(x=>fingerprint(x)===shinyId);
    assert.ok(kept&&kept.shiny===true&&JSON.stringify(kept.moves)===JSON.stringify(shiny.moves),'the shiny Eevee is saved in the PC with its moves');
    for(const id of originals)assert.equal(everyone.filter(x=>fingerprint(x)===id).length,1,'every original individual is kept');
   }finally{cold.close();}
   controller.acknowledgeAcquisition();
   console.log('# breed-to-evolve hatched '+JSON.stringify({frame:o.frame,hatchling:r.pokemon.personality,shiny:r.pokemon.shiny,daycareSteps:p.daycareSteps,budget:p.budget,withdrawnAt}));
   continue;
  }
  if(d.kind==='postgame-evolution-started'){
   const e=controller.state().dexEvolution;
   assert.ok(acquisitionReceipt,'the evolution follows the hatch');
   assert.equal(fingerprint(e.originalPokemon),acquisitionReceipt.fingerprint,'the hatchling evolves, never the shiny');
   assert.ok([134,135,136].includes(e.request.speciesId));evolution=e.request.speciesId;
   continue;
  }
  if(d.kind==='dex-evolution-saved'){
   const r=d.receipt;
   assert.ok(restarted.has('evolution'),'the evolution survived a restart');
   assert.equal(r.nativeSaveVerified,true);
   assert.ok(m.trainer.pokedex.ownedSpecies.includes(evolution),'the Eeveelution is registered');
   const cold=await createSession();
   try{
    cold.loadSram(session.saveSram());
    const loaded=await continueNativeSaveAsync(cold,createFireRedObserver({session:cold,...inputs,runId:'breed-to-evolve-cold-evolution',storyWatch:controller.storyWatch()}));
    const lt=loaded.playerMemory.trainer,everyone=[...lt.party,...lt.storage.pokemon];
    assert.ok(everyone.some(x=>x.species===evolution&&x.personality===acquisitionReceipt.pokemon.personality),'the evolved hatchling is saved');
    assert.ok(lt.pokedex.ownedSpecies.includes(evolution));
    const kept=everyone.find(x=>fingerprint(x)===shinyId);assert.ok(kept?.species===EEVEE&&kept.shiny,'the shiny is still an Eevee');
   }finally{cold.close();}
   controller.acknowledgeDexEvolution();
   console.log('# breed-to-evolve verified '+JSON.stringify({frame:o.frame,frames:o.frame-before.frame,evolution,restarts:[...restarted]}));
   return {before,after:o};
  }
  const action=d.action??{buttons:[],holdFrames:8};
  const start=session.frame;
  for(let j=0;j<(action.holdFrames??1);j++)session.step(action.buttons??[]);
  for(let j=0;j<(action.releaseFrames??0);j++)session.step([]);
  now+=(session.frame-start)*1000/NATIVE_FRAMES_PER_SECOND;
  if(i%200===0)await yieldIO();
 }
 throw Error('The breed-to-evolve transaction did not finish within the native replay bound.');
}
