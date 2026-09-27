import assert from 'node:assert/strict';
import {createPostgameController} from '../engine/firered/src/suite/postgame.js';
import {createFireRedObserver} from '../engine/firered/src/evidence/fire-red-observer.js';
import {readPostgameEvidence} from '../engine/firered/src/suite/postgame-agenda.js';
import {continueNativeSaveAsync} from '../engine/firered/src/suite/native-cold-boot.js';

export async function replayRecoveryStorage({session,saved,inputs,createSession}){
 const open=state=>createPostgameController({...inputs,mechanics:inputs.battle,state});
 let controller=open(saved.metadata.postgame);controller.resume();
 const observer=createFireRedObserver({session,...inputs,runId:'recovery-storage',storyWatch:controller.storyWatch()});
 const capture=()=>{const raw=observer.capture();return {...raw,playerMemory:{...raw.playerMemory,postgameEvidence:readPostgameEvidence(session,inputs.runtime,raw)}};};
 const before=capture(),source=saved.metadata.postgame.dexEvolution.originalPokemon,commitment=structuredClone(saved.metadata.campaign.record);
 assert.equal(saved.metadata.postgame.planner.tasks.blocked.reason,'recovery-member-unavailable');
 let restarted=false,restored=false,last='';
 for(let n=0;n<25000;n++){
  const o=capture(),d=controller.decide(o),state=controller.state();
  const trace=JSON.stringify([d.kind,d.reason,d.winner?.recommendation?.objective,o.playerMemory.map.id,state.planner.tasks?.recovery?.phase]);
  if(process.env.SUITE_REPLAY_TRACE==='1'&&trace!==last){console.log('# recovery '+o.frame+' '+trace);last=trace;}
  assert.notEqual(d.kind,'blocked',d.reason);
  if(state.planner.tasks?.recovery?.phase==='reassembling')restored=true;
  if(!restarted&&o.playerMemory.ui.storage){controller=open(JSON.parse(JSON.stringify(state)));restarted=true;}
  if(d.kind==='dex-evolution-saved'){
   assert.ok(restored&&restarted);assert.equal(d.receipt.nativeSaveVerified,true);
   assert.equal(d.receipt.pokemon.personality,source.personality);assert.equal(d.receipt.pokemon.species,26);assert.deepEqual(d.receipt.pokemon.ivs,source.ivs);
   assert.ok(o.playerMemory.gameStats.heals>before.playerMemory.gameStats.heals);
   assert.equal(state.planner.tasks.recovery,null);assert.deepEqual(saved.metadata.campaign.record,commitment);
   const cold=await createSession();
   try{
    cold.loadSram(session.saveSram());const check=createFireRedObserver({session:cold,...inputs,runId:'recovery-storage-cold-save'});
    const loaded=await continueNativeSaveAsync(cold,check),p=loaded.playerMemory.trainer.party.find(p=>p.personality===source.personality&&p.otId===source.otId);
    assert.equal(p?.species,26);assert.deepEqual(p.ivs,source.ivs);
   }finally{cold.close();}
   controller.acknowledgeDexEvolution();assert.equal(controller.canYield(o),true);return {before,after:o};
  }
  if(d.kind==='capture-saved'){controller.acknowledgeCapture();continue;}
  const a=d.action??{buttons:[],holdFrames:8};for(let i=0;i<(a.holdFrames??1);i++)session.step(a.buttons??[]);for(let i=0;i<(a.releaseFrames??0);i++)session.step([]);
 }
 throw Error('The retained recovery and subsequent evolution did not finish.');
}
