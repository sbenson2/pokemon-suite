import assert from 'node:assert/strict';
import {createPostgameController} from '../engine/firered/src/suite/postgame.js';
import {createFireRedObserver} from '../engine/firered/src/evidence/fire-red-observer.js';
import {readPostgameEvidence} from '../engine/firered/src/suite/postgame-agenda.js';
import {continueNativeSaveAsync} from '../engine/firered/src/suite/native-cold-boot.js';
import {encounterFingerprint} from '../engine/firered/src/player/encounter-tracker.js';

// Live checkpoint, September 22: Skiploom trains toward Jumpluff at level 27.
// Its native save holds the level-23 start of that task. The recorded run
// trained it directly against level 6–16 wild Pokémon at the Memorial Pillar,
// about 36k frames per level (≈145k for these four). From a cold Continue the
// task must bring the boxed Exp. Share, switch-train behind its strongest
// escort against higher-level opponents, keep the trainee conscious, evolve and
// save natively within that recorded budget.
const RECORDED_FRAMES=145000;
const count=(o,id)=>Object.values(o.playerMemory.trainer.bag??{}).flat().reduce((n,i)=>n+(i?.itemId===id?i.quantity:0),0);

export async function replayEvolutionAcceleration({saved,inputs,createSession}){
 const original=structuredClone(saved.metadata.session.postgame);
 let clock=original.watchdog?.lastAt??0;
 const open=state=>createPostgameController({...inputs,mechanics:inputs.battle,state,clock:()=>clock});
 let controller=open(original);
 const source=original.dexEvolution.originalPokemon;
 const core=await createSession();
 // The live owner's frame count runs on across its checkpoints, and its
 // trackers reject frames that go backwards. A cold boot restarts the core's
 // counter, so this replay continues the checkpoint's timeline.
 const offset=Number(saved.metadata.frame)||0;
 const session=new Proxy(core,{get:(t,k)=>k==='frame'?t.frame+offset:typeof t[k]==='function'?t[k].bind(t):t[k]});
 try{
  session.loadSram(saved.sram);
  const observer=createFireRedObserver({session,...inputs,runId:'evolution-acceleration',storyWatch:controller.storyWatch()});
  const capture=()=>{const o=observer.capture();return {...o,playerMemory:{...o.playerMemory,postgameEvidence:readPostgameEvidence(session,inputs.runtime,o)}};};
  await continueNativeSaveAsync(session,observer);
  const trainee=o=>o.playerMemory.trainer.party.find(p=>p.personality===source.personality&&p.otId===source.otId);
  const others=o=>[...o.playerMemory.trainer.party,...o.playerMemory.trainer.storage.pokemon]
   .filter(p=>!(p.personality===source.personality&&p.otId===source.otId)).map(encounterFingerprint).sort();
  const before=capture(),originalOthers=others(before);
  assert.equal(trainee(before)?.species,188);assert.equal(trainee(before).level,23);
  assert.equal(count(before,182),0,'the Exp. Share starts on a boxed Pokémon');
  assert.ok(before.playerMemory.trainer.storage.pokemon.some(p=>p.heldItem===182));
  let last='',sawShare=false,escorted=false,restarted=false;
  for(let n=0;n<400000;n++){
   const o=capture(),m=o.playerMemory,t=trainee(o);
   assert.ok(o.frame-before.frame<=RECORDED_FRAMES,`the evolution exceeded the recorded ${RECORDED_FRAMES}-frame direct-training budget`);
   if(t&&t.species===188){
    assert.ok(t.hp>0||o.emulator.mode!=='overworld','the trainee must not faint');
    sawShare||=t.heldItem===182;
    const enemy=Math.max(0,...(m.battle?.enemyParty??[]).map(p=>p.level));
    if(o.emulator.mode==='battle'&&enemy>t.level+2&&t.heldItem===182)escorted=true;
   }
   const decision=controller.decide(o),state=controller.state();
   const trace=JSON.stringify([decision.kind,decision.reason,m.map?.id,t?.species,t?.level,t?.heldItem,decision.winner?.recommendation?.objective,state.dexEvolution?.phase]);
   if(trace!==last){console.log('# evolution-acceleration '+o.frame+' '+trace);last=trace;}
   assert.notEqual(decision.kind,'blocked',decision.reason);
   assert.notEqual(decision.winner?.recommendation?.kind,'wait-for-supported-objective');
   // A restart in the middle of escorted training must resume the same plan.
   if(escorted&&!restarted&&o.emulator.mode==='overworld'){controller=open(JSON.parse(JSON.stringify(state)));restarted=true;}
   if(decision.kind==='dex-evolution-saved'){
    const r=decision.receipt;
    assert.equal(r.pokemon.species,189);assert.equal(r.pokemon.personality,source.personality);
    assert.equal(r.pokemon.otId,source.otId);assert.deepEqual(r.pokemon.ivs,source.ivs);
    assert.equal(r.nativeSaveAfterEvolution,true);assert.equal(r.nativeSaveVerified,true);
    assert.ok(sawShare,'the trainee carried the Exp. Share');
    assert.ok(escorted,'the trainee trained behind an escort above its own level');
    assert.ok(restarted,'the escorted plan survived a controller restart');
    assert.equal(count(o,182),1,'the Exp. Share returns to the bag for the next trainee');
    assert.equal(t?.heldItem??0,0);
    assert.deepEqual(others(o),originalOthers,'every other individual is preserved');
    assert.ok(m.gameStats.savedGame>before.playerMemory.gameStats.savedGame);
    const cold=await createSession();
    try{
     cold.loadSram(session.saveSram());
     const coldObserver=createFireRedObserver({session:cold,...inputs,runId:'evolution-acceleration-cold',storyWatch:controller.storyWatch()});
     const loaded=await continueNativeSaveAsync(cold,coldObserver);
     assert.equal(trainee(loaded)?.species,189,'cold Continue contains Jumpluff');
     assert.equal(count(loaded,182),1);
     assert.deepEqual(others(loaded),originalOthers);
    }finally{cold.close();}
    assert.deepEqual(saved.metadata.session.postgame,original,'the regression checkpoint is immutable');
    console.log('# evolution-acceleration verified '+JSON.stringify({frames:o.frame-before.frame,recordedFrames:RECORDED_FRAMES,level:t?.level,savedFrame:o.frame,coldContinue:true}));
    return {before,after:o};
   }
   const action=decision.action??{buttons:[],holdFrames:8};
   for(let i=0;i<(action.holdFrames??1);i++){session.step(action.buttons??[]);clock+=1000/60;}
   for(let i=0;i<(action.releaseFrames??0);i++){session.step([]);clock+=1000/60;}
  }
  throw Error('The accelerated evolution did not finish.');
 }finally{core.close();}
}
