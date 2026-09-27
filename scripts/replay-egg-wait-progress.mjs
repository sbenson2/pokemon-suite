import assert from 'node:assert/strict';
import {setImmediate as yieldIO} from 'node:timers/promises';
import {createFireRedObserver} from '../engine/firered/src/evidence/fire-red-observer.js';
import {createPostgameController} from '../engine/firered/src/suite/postgame.js';
import {observePostgameProgress} from '../engine/firered/src/suite/postgame-watchdog.js';
import {readPostgameEvidence} from '../engine/firered/src/suite/postgame-agenda.js';
import {continueNativeSaveAsync} from '../engine/firered/src/suite/native-cold-boot.js';
import {encounterFingerprint as fingerprint} from '../engine/firered/src/player/encounter-tracker.js';

// Live hatch postgame-egg-sticker-hatch-113-39882228 (2026-09-26): a Rattata x
// Donphan pair from one trainer (a 20% native roll every 256 daycare steps)
// needed 19 rolls. The owner walked the whole wait, the five-minute watchdog saw
// no evidence change, and its 120-second boundary blocked the dirty breeding
// acquisition. This case starts from the live autosave after 12 failed rolls,
// with the owner's watchdog as retained then (279 s idle since the deposit). A
// watchdog that does not count the Day Care's rolls opens its boundary about 21
// paced seconds later, before the next roll. One that counts them sees the
// owner's roll count for the first time on its first decision, so an update
// installed mid-wait credits the rolls made since the deposit once; after that
// only a new roll renews the budget, about every 118 paced seconds. The watchdog
// clock advances with emulated frames at the cartridge's native rate (an owner
// at 1x, where a false trip is likeliest), so the outcome does not depend on
// this machine's speed or load.
const NATIVE_FRAMES_PER_SECOND=59.7275;
const valid=o=>[...o.playerMemory.trainer.party,...o.playerMemory.trainer.storage.pokemon].filter(p=>p.validity==='valid');
const party=o=>o.playerMemory.trainer.party.filter(p=>p.validity==='valid').map(fingerprint).sort();
const rollsOf=o=>{const second=o.playerMemory.postgameEvidence?.acquisition?.daycare?.parents?.find(p=>p.slot===1);return Number.isSafeInteger(second?.steps)?Math.floor((second.steps+1)/256):null;};

export async function replayEggWaitProgress({session,saved,inputs,createSession,fixture={}}){
 const fps=fixture.watchdogFramesPerSecond??NATIVE_FRAMES_PER_SECOND;
 const retained=structuredClone(saved.metadata.session.postgame),requestId=retained.acquisition?.requestId;
 assert.equal(retained.acquisition?.kind,'breeding','start at the retained breeding request');
 assert.equal(retained.acquisition.phase,'waiting-for-egg','start while the deposited parents wait for an Egg');
 assert.ok(retained.acquisition.dirty&&retained.acquisition.deposited,'the parents are deposited and owned');
 assert.ok(retained.watchdog?.owner===requestId&&retained.watchdog.idleMs>=250000&&!retained.watchdog.boundary,'start with the retained, nearly spent progress budget');
 let now=Date.parse(saved.updatedAt);
 const open=state=>createPostgameController({...inputs,mechanics:inputs.battle,state,clock:()=>now});
 const observer=createFireRedObserver({session,...inputs,runId:'egg-wait-progress',storyWatch:open(structuredClone(retained)).storyWatch()});
 const capture=()=>{const raw=observer.capture();return {...raw,playerMemory:{...raw.playerMemory,postgameEvidence:readPostgameEvidence(session,inputs.runtime,raw)}};};
 const before=capture(),daycare=before.playerMemory.postgameEvidence?.acquisition?.daycare;
 assert.equal(before.phase,'stable');
 assert.equal(daycare?.parents?.length,2,'both parents are in the Day Care');
 assert.ok(daycare.pendingEgg===false&&!daycare.offspringPersonality,'no Egg is pending yet');
 // The retained owner had seen this cartridge state since the deposit (its
 // evidence is constant in every post-deposit autosave). Re-express that in this
 // engine's observation space, without the owner's native roll term; the lists
 // stored in the checkpoint came from an earlier engine.
 const base={};observePostgameProgress(base,before,requestId,now,null);
 Object.assign(retained.watchdog,{seen:base.seen,storySeen:base.storySeen,storyIds:base.storyIds});
 let controller=open(retained);
 const startRolls=rollsOf(before),originalParty=[...retained.acquisition.originalParty].sort();
 const original=[...valid(before),...daycare.parents].map(fingerprint).sort();
 const eggs=before.playerMemory.gameStats.eggsHatched,saves=before.playerMemory.gameStats.savedGame;
 const started=now,restarted=new Set();
 let rolls=startRolls,eggRoll=null,eggAt=null,received=false,last='';
 console.log('# egg-wait-progress start '+JSON.stringify({frame:before.frame,rolls:startRolls,idleMs:retained.watchdog.idleMs,fps}));
 for(let i=0;i<500000;i++){
  const o=capture(),m=o.playerMemory,d=controller.decide(o),state=controller.state(),a=state.acquisition;
  if(a?.phase==='waiting-for-egg')rolls=Math.max(rolls,rollsOf(o)??rolls);
  if(eggAt==null&&m.postgameEvidence?.acquisition?.daycare?.pendingEgg===true){eggAt=now;eggRoll=rollsOf(o);console.log('# egg-wait-progress egg '+JSON.stringify({frame:o.frame,roll:eggRoll,waitMs:Math.round(now-started)}));}
  received||=a?.egg!=null;
  const trace=JSON.stringify([m.map?.id,a?.phase,rolls,m.gameStats?.eggsHatched,d.kind,Math.round((state.watchdog?.idleMs??0)/1000)]);
  if(process.env.SUITE_REPLAY_TRACE==='1'&&trace!==last){console.log('# egg-wait-progress '+o.frame+' '+trace);last=trace;}
  assert.notEqual(d.kind,'blocked',d.reason);
  assert.equal(state.watchdog?.boundary,undefined,`no progress-timeout boundary during the owned hatch (${a?.phase}, ${rolls} native rolls)`);
  // The owner restarts (update handoff) after its first decision in the wait and again during the hatch.
  const point=a?.phase==='waiting-for-egg'&&i>0?'waiting':a?.phase==='hatching'?'hatching':null;
  if(point&&!restarted.has(point)){controller=open(JSON.parse(JSON.stringify(state)));restarted.add(point);}
  if(d.kind==='acquisition-saved'){
   assert.ok(received&&eggAt!=null,'the native Egg was received from the Day Care Man');
   assert.ok(restarted.has('waiting')&&restarted.has('hatching'),'both owner restarts were exercised');
   assert.equal(d.receipt.nativeSaveVerified,true);assert.equal(d.receipt.requestedSpecies,19);assert.equal(d.receipt.pokemon.isEgg,false);
   assert.equal(m.gameStats.eggsHatched,eggs+1);assert.equal(m.gameStats.savedGame,saves+1);
   assert.deepEqual(party(o),originalParty,'the original travelling party returns after breeding');
   assert.ok(original.every(id=>valid(o).some(p=>fingerprint(p)===id)),'every original individual, both parents included, is retained');
   const cold=await createSession();
   try{
    cold.loadSram(session.saveSram());
    const reader=createFireRedObserver({session:cold,...inputs,runId:'egg-wait-progress-cold',storyWatch:controller.storyWatch()});
    const native=await continueNativeSaveAsync(cold,reader);
    assert.equal(native.playerMemory.gameStats.eggsHatched,eggs+1);
    assert.deepEqual(party(native),originalParty);
    assert.ok(original.every(id=>valid(native).some(p=>fingerprint(p)===id)));
    assert.equal(valid(native).filter(p=>fingerprint(p)===d.receipt.fingerprint&&!p.isEgg).length,1);
   }finally{cold.close();}
   // Coverage, reported rather than asserted: the replayed draws decide how many
   // more rolls the Egg takes; beyond five paced minutes only per-roll credit
   // carries the wait.
   console.log('# egg-wait-progress verified '+JSON.stringify({startRolls,eggRoll,waitMs:Math.round(eggAt-started),creditedPastTimeout:eggAt-started>300000,frame:o.frame,sram:o.sram.sha256}));
   return {before,after:o,state};
  }
  const action=d.action??{buttons:[],holdFrames:8};
  const start=session.frame;
  for(let j=0;j<(action.holdFrames??1);j++)session.step(action.buttons??[]);
  for(let j=0;j<(action.releaseFrames??0);j++)session.step([]);
  now+=(session.frame-start)*1000/fps;
  if(i%200===0)await yieldIO();
 }
 throw Error('The retained breeding request did not hatch and save within the native replay bound.');
}
