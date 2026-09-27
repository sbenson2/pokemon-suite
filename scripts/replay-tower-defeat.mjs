import assert from 'node:assert/strict';
import {createPostgameController} from '../engine/firered/src/suite/postgame.js';
import {createFireRedObserver} from '../engine/firered/src/evidence/fire-red-observer.js';
import {readPostgameEvidence} from '../engine/firered/src/suite/postgame-agenda.js';
import {continueNativeSaveAsync} from '../engine/firered/src/suite/native-cold-boot.js';
import {encounterFingerprint} from '../engine/firered/src/player/encounter-tracker.js';

// The original utility-party Tower battle, reached with build87's ordinary
// controls. Finish that battle; never manufacture a loss or edit its party.
export async function replayTowerDefeat({session,saved,inputs,createSession}){
 const original=structuredClone(saved.metadata.session.postgame);
 let clock=original.watchdog.lastAt;
 const open=state=>createPostgameController({...inputs,mechanics:inputs.battle,state,clock:()=>clock});
 let controller=open(original);controller.resume();
 const observer=createFireRedObserver({session,...inputs,runId:'tower-defeat',storyWatch:controller.storyWatch()});
 const capture=()=>{const o=observer.capture();return {...o,playerMemory:{...o.playerMemory,postgameEvidence:readPostgameEvidence(session,inputs.runtime,o)}};};
 const before=capture(),identities=o=>[...o.playerMemory.trainer.party,...o.playerMemory.trainer.storage.pokemon].map(encounterFingerprint).sort();
 const originals=identities(before),restarts=new Set();let saving=false,defeat,last='';
 assert.equal(before.playerMemory.map.id,'MAP_TRAINER_TOWER_1F');assert.ok(before.emulator.inBattle);
 for(let n=0;n<20000;n++){
  const o=capture(),m=o.playerMemory,decision=controller.decide(o),state=controller.state();
  const trace=JSON.stringify([m.map.id,decision.kind,state.objective?.id,m.battleOutcome,state.agenda.workflows.tower?.defeat]);
  if(trace!==last){console.log('# tower-defeat '+o.frame+' '+trace);last=trace;}
  assert.notEqual(decision.kind,'blocked',decision.reason);
  const tower=state.agenda.workflows.tower;
  const point=tower?.defeat&&!restarts.has('defeat')?'defeat':tower?.battleRoster&&!restarts.has('battle')?'battle':saving&&m.ui.saveDialog?'save':null;
  if(point&&!restarts.has(point)){controller=open(JSON.parse(JSON.stringify(state)));restarts.add(point);}
  const free=o.phase==='stable'&&o.emulator.mode==='overworld'&&!o.emulator.inBattle&&!Object.values(m.ui??{}).some(Boolean);
  if(!saving&&free&&m.map.id==='MAP_TRAINER_TOWER_LOBBY'&&m.storyState.variableIds[0x4082]===0&&tower?.defeat){
   assert.equal(m.postgameEvidence.trainerTower[tower.defeat.mode].hasLost,false,'the native lobby really cleared its temporary flag');
   assert.deepEqual(identities(o),originals);defeat=structuredClone(tower.defeat);
   controller.beginPlayerTask({id:'save-tower-defeat',kind:'save'});saving=true;continue;
  }
  if(saving&&decision.kind==='player-task-complete'){
   assert.equal(decision.receipt.nativeSaveVerified,true);assert.ok(restarts.has('battle')&&restarts.has('defeat')&&restarts.has('save'));
   assert.deepEqual(state.agenda.workflows.tower.defeat,defeat);
   const cold=await createSession();
   try{
    cold.loadSram(session.saveSram());
    const reader=createFireRedObserver({session:cold,...inputs,runId:'tower-defeat-cold',storyWatch:controller.storyWatch()});
    const loaded=await continueNativeSaveAsync(cold,reader);assert.deepEqual(identities(loaded),originals);
    assert.equal(loaded.playerMemory.map.id,'MAP_TRAINER_TOWER_LOBBY');
   }finally{cold.close();}
   controller.requestHandoff();assert.equal(controller.decide(o).kind,'handoff');
   controller=open(JSON.parse(JSON.stringify(controller.state())));controller.resume();
   assert.deepEqual(controller.state().agenda.workflows.tower.defeat,defeat);
   assert.deepEqual(saved.metadata.session.postgame,original);
   console.log('# tower-defeat verified '+JSON.stringify({counter:m.gameStats.savedGame,defeat,coldContinue:true,restarts:[...restarts]}));
   return {before,after:o};
  }
  const action=decision.action??{buttons:[],holdFrames:8};
  for(let i=0;i<(action.holdFrames??1);i++){session.step(action.buttons??[]);clock+=1000/60;}
  for(let i=0;i<(action.releaseFrames??0);i++){session.step([]);clock+=1000/60;}
 }
 throw Error('The native Tower defeat did not retain its outcome through lobby recovery, save and restart.');
}
