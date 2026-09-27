import assert from 'node:assert/strict';
import {campaignPostgameHandoff} from '../engine/firered/src/suite/campaign-continuation.js';
import {createPostgameController} from '../engine/firered/src/suite/postgame.js';
import {createFireRedObserver} from '../engine/firered/src/evidence/fire-red-observer.js';
import {readPostgameEvidence,postgamePresentation} from '../engine/firered/src/suite/postgame-agenda.js';

export async function replayPostgameHandoff({session,saved,inputs}){
 const original=structuredClone(saved.metadata.campaign);
 const receipt=campaignPostgameHandoff({...original,policy:{enabled:true,awaitingCommand:false}});
 assert.ok(receipt,'the original completed run must qualify without rewriting its old settings');
 const open=state=>createPostgameController({...inputs,mechanics:inputs.battle,state});
 let controller=open(null);controller.beginAdventure(receipt);
 const observer=createFireRedObserver({session,...inputs,runId:'campaign-postgame-handoff',storyWatch:controller.storyWatch()});
 const capture=()=>{const o=observer.capture();return {...o,playerMemory:{...o.playerMemory,postgameEvidence:readPostgameEvidence(session,inputs.runtime,o)}};};
 const before=capture();let after=before,restarted=false,last='';
 const initialPresentation=postgamePresentation(before,null);
 assert.equal(initialPresentation.progress.active,null,'startup must accept a completed campaign with no postgame agenda');
 assert.equal(initialPresentation.progress.dex.known,true);
 for(let i=0;i<4000;i++){
  after=capture();const decision=controller.decide(after),state=controller.state(),m=after.playerMemory;
  const trace=JSON.stringify([state.preparation?.phase,state.objective?.id,decision.kind,decision.reason,m.map?.id,m.ui?.party?.stage,m.ui?.saveDialog?.stage]);
  if(process.env.SUITE_REPLAY_TRACE==='1'&&trace!==last){console.log('# postgame '+after.frame+' '+trace);last=trace;}
  assert.notEqual(decision.kind,'blocked',decision.reason);
  assert.deepEqual(saved.metadata.campaign,original,'never replace the completed campaign or benchmark');
  assert.deepEqual(state.agenda.continuation,receipt);
  if(!restarted&&Object.values(m.ui??{}).some(Boolean)){
   controller=open(JSON.parse(JSON.stringify(state)));restarted=true;
   assert.deepEqual(controller.state().preparation,state.preparation);
  }
  const free=after.phase==='stable'&&after.emulator.mode==='overworld'&&!after.emulator.inBattle&&!Object.values(m.ui??{}).some(Boolean);
  const nativeProgress=m.gameStats?.savedGame>before.playerMemory.gameStats?.savedGame&&after.sram.sha256!==before.sram.sha256;
  if(restarted&&free&&nativeProgress){
   assert.equal(m.saveAttemptStatus,1);
   assert.ok(m.trainer.pokedex.ownedSpecies.length>before.playerMemory.trainer.pokedex.ownedSpecies.length,'require a newly registered native catch, not only a bookkeeping save');
   assert.equal(decision.kind,'capture-saved');assert.equal(decision.capture.nativeSaveVerified,true);
   assert.ok(controller.state().preparation,'postgame owns the next prerequisite');
   assert.deepEqual(controller.state().fieldTeamPlan.permanentFamilies,original.record.teamPlan.permanentFamilies);
   controller.requestHandoff();assert.equal(controller.decide(after).kind,'handoff','manual/queued work retains a safe handoff');
   return {before,after};
  }
  if(decision.kind==='dex-evolution-saved')controller.acknowledgeDexEvolution();
  else if(decision.kind==='capture-saved')controller.acknowledgeCapture();
  else{
   const action=decision.action??{buttons:[],holdFrames:8};
   for(let n=0;n<(action.holdFrames??1);n++)session.step(action.buttons??[]);
   for(let n=0;n<(action.releaseFrames??0);n++)session.step([]);
  }
 }
 throw Error('Postgame did not survive reconstruction and finish a native prerequisite save.');
}
