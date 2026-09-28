import assert from 'node:assert/strict';
import {setImmediate as yieldIO} from 'node:timers/promises';
import {createFireRedObserver} from '../engine/firered/src/evidence/fire-red-observer.js';
import {createPostgameController} from '../engine/firered/src/suite/postgame.js';
import {readPostgameEvidence} from '../engine/firered/src/suite/postgame-agenda.js';
import {storageCapacity} from '../engine/firered/src/suite/storage-capacity.js';
import {continueNativeSaveAsync} from '../engine/firered/src/suite/native-cold-boot.js';
import {RELEASE_LABEL,planHatchlingRelease} from '../engine/firered/src/suite/pc-release.js';
import {encounterFingerprint as fingerprint} from '../engine/firered/src/player/encounter-tracker.js';

// Live stop (Sept 27, build 120): 396 of 426 spaces used, so the 30-space shiny
// reserve stopped postgame ("Free PC space while preserving the shiny
// reserve"). 266 of the boxed Pokémon are the Egg sticker's own non-shiny
// level-5 Rattata hatchlings. This case starts from that preserved autosave at
// the Four Island Pokémon Center with a full party and a full PC.
//
// Entry: the unmodified retained owner plans a batch from its own Egg-sticker
// receipts. Restart: the owner reopens (an update handoff) with that retained
// release, whose plan here is bounded to three hatchlings (the last in another
// box) and led by a shiny and a reserved hatchling that must both be refused.
// Completion: three releases through the cartridge's PC menu, each verified
// from the next stable observation, a second restart inside the PC, the exit, a
// verified native save and a cold Continue of that save. Handoff: the acknowledged release continues
// refilling the reserve plus buffer with another batch.
const NATIVE_FRAMES_PER_SECOND=59.7275;
const layout=o=>{const t=o.playerMemory.trainer;return [...t.party.map(p=>`${fingerprint(p)}@party:${p.slot}`),...t.storage.pokemon.map(p=>`${fingerprint(p)}@${p.box}:${p.slot}`)].sort();};
const entry=p=>({fingerprint:fingerprint(p),box:p.box,slot:p.slot,species:p.species,personality:p.personality,otId:p.otId,experience:p.experience,friendship:p.friendship,metLevel:p.metLevel??null});

export async function replayPcRelease({session,saved,inputs,createSession,fixture={}}){
 const count=fixture.releaseCount??3,fps=fixture.watchdogFramesPerSecond??NATIVE_FRAMES_PER_SECOND;
 const retained=structuredClone(saved.metadata.session.postgame);
 assert.equal(retained.status,'dependency','start at the live storage stop');
 assert.match(retained.reason,/Free PC space while preserving the shiny reserve/);
 let now=Date.parse(saved.updatedAt);
 const open=state=>createPostgameController({...inputs,mechanics:inputs.battle,state,clock:()=>now});
 const observer=createFireRedObserver({session,...inputs,runId:'pc-release-hatchlings',storyWatch:open(structuredClone(retained)).storyWatch()});
 const capture=()=>{const raw=observer.capture();return {...raw,playerMemory:{...raw.playerMemory,postgameEvidence:readPostgameEvidence(session,inputs.runtime,raw)}};};
 const before=capture(),t0=before.playerMemory.trainer,space=storageCapacity(t0);
 assert.equal(before.phase,'stable');
 assert.equal(before.playerMemory.map.id,'MAP_FOUR_ISLAND_POKEMON_CENTER_1F');
 assert.equal(t0.party.length,6,'a full party: Withdraw mode is refused, Move mode offers RELEASE');
 assert.ok(space.known&&!space.canStart&&space.free===30,`start with only the shiny reserve free (${space.free})`);
 const shinies=t0.storage.pokemon.filter(p=>p.shiny===true).map(p=>`${fingerprint(p)}@${p.box}:${p.slot}`).sort();
 assert.ok(shinies.length>0,'the PC holds shinies that must stay');
 const layoutBefore=layout(before),partyBefore=t0.party.map(fingerprint),countsBefore=[...t0.storage.boxCounts];

 // Entry: the retained owner starts a release from its own Egg-sticker receipts.
 let controller=open(structuredClone(retained));
 let d=controller.decide(before);
 assert.equal(d.kind,'postgame-acquisition-started',JSON.stringify({kind:d.kind,reason:d.reason}));
 let state=controller.state();
 assert.equal(state.acquisition.kind,'pc-release');
 assert.equal(state.acquisition.plan.length,10,'one batch toward the reserve plus the 20-space buffer');
 const hatchlings=new Map(t0.storage.pokemon.map(p=>[fingerprint(p),p]));
 for(const e of state.acquisition.plan){
  const p=hatchlings.get(e.fingerprint);
  assert.ok(p&&p.species===19&&p.shiny===false&&p.metLevel===0&&p.experience===125&&p.otId===t0.otId,'every planned Pokémon is a non-shiny own hatchling');
 }

 // Restart with the retained release, bounded to `count` hatchlings and led by
 // a shiny and a hatchling another workflow reserves (a League Exp. Share trainee).
 // Its last hatchling is in another box, so the release also scrolls the PC.
 const shiny=t0.storage.pokemon.find(p=>p.shiny===true);
 const [reserved,...rest]=state.acquisition.plan;
 const elsewhere=planHatchlingRelease({trainer:t0,receipts:retained.agenda.acquisitions,mechanics:inputs.battle,count:420}).find(e=>e.box!==t0.storage.currentBox);
 assert.ok(elsewhere,'a hatchling outside the open box');
 const releasing=[...rest.slice(0,count-1),elsewhere];
 state=JSON.parse(JSON.stringify(state));
 state.acquisition.plan=[entry(shiny),reserved,...releasing];
 (state.agenda.workflows.leagueExpShare??={}).trainee={personality:reserved.personality,otId:reserved.otId,species:reserved.species};
 controller=open(state);
 console.log('# pc-release start '+JSON.stringify({frame:before.frame,free:space.free,shinies:shinies.length,plan:state.acquisition.plan.map(e=>[e.box,e.slot,e.species])}));

 let restartedInPc=false,last='',labelled=false,saves=before.playerMemory.gameStats.savedGame;
 for(let i=0;i<60000;i++){
  const o=capture();
  d=controller.decide(o);state=controller.state();
  const a=state.acquisition,stage=o.playerMemory.ui?.storage?.stage??null;
  const trace=JSON.stringify([o.playerMemory.map?.id,o.emulator.mode,stage,a?.released?.length,a?.refused?.length,d.kind,d.winner?.recommendation?.kind??null]);
  if(process.env.SUITE_REPLAY_TRACE==='1'&&trace!==last){console.log('# pc-release '+o.frame+' '+trace);last=trace;}
  assert.notEqual(d.kind,'blocked',d.reason);
  if(a){
   // The injected shiny and reserved hatchling are refused before any input.
   assert.deepEqual(a.refused.slice(0,2).map(e=>[e.fingerprint,e.reason]),[[fingerprint(shiny),'shiny'],[reserved.fingerprint,'protected']]);
   assert.ok(a.released.every(e=>releasing.some(r=>r.fingerprint===e.fingerprint)),'only planned eligible hatchlings are released');
   labelled||=state.objective?.label===RELEASE_LABEL;
  }
  // An update handoff inside the PC, after the first verified release.
  if(!restartedInPc&&a?.released?.length===1&&stage==='storage-main'){controller=open(JSON.parse(JSON.stringify(state)));restartedInPc=true;}
  if(d.kind==='acquisition-saved'){
   const r=d.receipt;
   assert.ok(restartedInPc,'the in-PC restart was exercised');
   assert.ok(labelled,'the release objective carries its Activity label');
   assert.equal(r.method,'pc-release');assert.equal(r.nativeSaveVerified,true);
   assert.deepEqual(r.released.map(e=>e.fingerprint),releasing.map(e=>e.fingerprint),'exactly the planned eligible hatchlings');
   assert.deepEqual(r.refused.map(e=>[e.fingerprint,e.reason]),[[fingerprint(shiny),'shiny'],[reserved.fingerprint,'protected']]);
   assert.equal(o.playerMemory.gameStats.savedGame,saves+1);assert.equal(o.playerMemory.saveAttemptStatus,1);
   assert.notEqual(o.sram.sha256,before.sram.sha256);assert.equal(r.savedSramSha256,o.sram.sha256);
   const gone=new Set(releasing.map(e=>e.fingerprint));
   const verify=(obs,label)=>{
    const t=obs.playerMemory.trainer;
    assert.deepEqual(layout(obs),layoutBefore.filter(x=>!gone.has(x.split('@')[0])),`${label}: only the released hatchlings left; every other Pokémon kept its place`);
    assert.deepEqual(t.party.map(fingerprint),partyBefore,`${label}: the party is unchanged`);
    assert.deepEqual(t.storage.pokemon.filter(p=>p.shiny===true).map(p=>`${fingerprint(p)}@${p.box}:${p.slot}`).sort(),shinies,`${label}: every shiny stays`);
    const expected=[...countsBefore];for(const e of releasing)expected[e.box]--;
    assert.deepEqual(t.storage.boxCounts,expected,`${label}: box counts drop by exactly ${count}`);
    assert.equal(t.storage.boxCounts.reduce((x,y)=>x+y,0),countsBefore.reduce((x,y)=>x+y,0)-count);
    for(const id of gone)assert.ok(![...t.party,...t.storage.pokemon].some(p=>fingerprint(p)===id),`${label}: ${id} is gone`);
    assert.ok([...t.party,...t.storage.pokemon].some(p=>fingerprint(p)===fingerprint(shiny)),`${label}: the refused shiny stays`);
    assert.ok(t.storage.pokemon.some(p=>fingerprint(p)===reserved.fingerprint),`${label}: the reserved hatchling stays`);
   };
   verify(o,'after the save');
   // Cold Continue of the saved SRAM.
   const cold=await createSession();
   try{
    cold.loadSram(session.saveSram());
    const reader=createFireRedObserver({session:cold,...inputs,runId:'pc-release-hatchlings-cold',storyWatch:controller.storyWatch()});
    const native=await continueNativeSaveAsync(cold,reader);
    assert.equal(native.playerMemory.gameStats.savedGame,saves+1,'the cold save is the verified release save');
    verify(native,'cold Continue');
   }finally{cold.close();}
   // Handoff: acknowledge, then the owner keeps refilling toward the buffer.
   controller.acknowledgeAcquisition();
   const after=controller.state();
   assert.equal(after.acquisition,null);
   assert.equal(after.agenda.workflows.pcRelease.receipts.at(-1).savedSramSha256,o.sram.sha256);
   assert.equal(after.agenda.acquisitions.length,retained.agenda.acquisitions.length,'Egg-sticker provenance is unchanged');
   const handoff=controller.decide(capture());
   assert.equal(handoff.kind,'postgame-acquisition-started','the refill continues with the next batch');
   const nextPlan=controller.state().acquisition.plan;
   assert.equal(controller.state().acquisition.kind,'pc-release');
   assert.ok(!nextPlan.some(e=>e.fingerprint===fingerprint(shiny)||gone.has(e.fingerprint)));
   console.log('# pc-release verified '+JSON.stringify({released:r.released.map(e=>[e.box,e.slot]),refused:r.refused.map(e=>e.reason),freeBefore:r.freeBefore,freeAfter:r.freeAfter,frame:o.frame,sram:o.sram.sha256,nextBatch:nextPlan.length}));
   return {before,after:o,state:controller.state()};
  }
  const action=d.action??{buttons:[],holdFrames:8};
  const start=session.frame;
  for(let j=0;j<(action.holdFrames??1);j++)session.step(action.buttons??[]);
  for(let j=0;j<(action.releaseFrames??0);j++)session.step([]);
  now+=(session.frame-start)*1000/fps;
  if(i%200===0)await yieldIO();
 }
 throw Error('The bounded PC release did not finish and save within the native replay bound.');
}
