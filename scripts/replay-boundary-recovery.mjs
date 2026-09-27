import assert from 'node:assert/strict';
import {createPostgameController} from '../engine/firered/src/suite/postgame.js';
import {createFireRedObserver} from '../engine/firered/src/evidence/fire-red-observer.js';
import {readPostgameEvidence} from '../engine/firered/src/suite/postgame-agenda.js';
import {continueNativeSaveAsync} from '../engine/firered/src/suite/native-cold-boot.js';
import {encounterFingerprint} from '../engine/firered/src/player/encounter-tracker.js';

export async function replayBoundaryRecovery({session,saved,inputs,createSession}){
 let now=saved.metadata.session.postgame.watchdog.lastAt;
 const open=state=>createPostgameController({...inputs,mechanics:inputs.battle,state,clock:()=>now});
 let controller=open(saved.metadata.session.postgame);
 const observer=createFireRedObserver({session,...inputs,runId:'funding-recovery',storyWatch:controller.storyWatch()});
 const capture=()=>{const raw=observer.capture();return {...raw,playerMemory:{...raw.playerMemory,postgameEvidence:readPostgameEvidence(session,inputs.runtime,raw)}};};
 const before=capture(),request=structuredClone(controller.state().acquisition);
 const identities=o=>[...o.playerMemory.trainer.party,...o.playerMemory.trainer.storage.pokemon].map(encounterFingerprint).sort();
 const original=identities(before),coins=before.playerMemory.postgameEvidence.acquisition.coins,money=before.playerMemory.trainer.money;
 assert.equal(request.dirty,true);assert.ok(controller.state().watchdog.idleMs>=300000);assert.equal(before.playerMemory.map.id,'MAP_ROUTE15');
 assert.equal(before.emulator.inBattle,true);assert.equal(before.playerMemory.encounter.pokemon.shiny,false);
 let suspended=false,resumed=false,restartedSave=false,restartedRoute=false,restartedBattle=false,moved=false,battled=false;
 let after=before;
 for(let n=0;n<12000;n++){
  const o=capture();after=o;now+=20;
  const decision=controller.decide(o),state=controller.state();
  if(n%100===0)console.log('# boundary-step '+JSON.stringify({n,frame:o.frame,map:o.playerMemory.map.id,position:o.playerMemory.position,kind:decision.kind,reason:decision.reason,objective:state.objective?.id,phase:state.acquisition?.phase,suspension:Boolean(state.acquisition?.suspension),watchdog:state.watchdog.idleMs}));
  assert.notEqual(decision.kind,'blocked',decision.reason);
  if(!restartedBattle&&state.watchdog.boundary&&o.emulator.inBattle){controller=open(JSON.parse(JSON.stringify(state)));restartedBattle=true;}

  if(!restartedSave&&state.acquisition?.suspension){controller=open(JSON.parse(JSON.stringify(state)));restartedSave=true;}
  if(!suspended&&state.deferredAcquisitions?.length){
   const retained=state.deferredAcquisitions[0];assert.equal(retained.state.requestId,request.requestId);assert.equal(retained.state.suspension.receipt.nativeSaveVerified,true);
   assert.equal(o.playerMemory.postgameEvidence.acquisition.coins,coins);assert.equal(o.playerMemory.trainer.money,money);assert.deepEqual(identities(o),original);
   const cold=await createSession();
   try{
    cold.loadSram(session.saveSram());const coldObserver=createFireRedObserver({session:cold,...inputs,runId:'funding-cold',storyWatch:controller.storyWatch()});
    const loaded=await continueNativeSaveAsync(cold,coldObserver);
    const evidence=readPostgameEvidence(cold,inputs.runtime,loaded);
    assert.equal(evidence.acquisition.coins,coins);assert.equal(loaded.playerMemory.trainer.money,money);assert.deepEqual(identities(loaded),original);
   }finally{cold.close();}
   suspended=true;controller=open(JSON.parse(JSON.stringify(state)));now+=300001;
   controller.beginAcquisition({kind:request.kind,speciesId:request.speciesId,requestId:request.requestId});
   assert.equal(controller.state().acquisition.requestId,request.requestId);assert.equal(controller.state().deferredAcquisitions.length,0);
   resumed=true;console.log('# boundary '+JSON.stringify({suspended,coldContinue:true,coins,money,frame:o.frame}));continue;
  }
  if(resumed&&(o.playerMemory.map.id!==before.playerMemory.map.id||JSON.stringify(o.playerMemory.position)!==JSON.stringify(before.playerMemory.position))){
   moved=true;if(!restartedRoute){controller=open(JSON.parse(JSON.stringify(state)));restartedRoute=true;}
  }
  if(resumed&&o.emulator.inBattle) battled=true;
  if(resumed&&moved&&battled&&o.phase==='stable'&&!o.emulator.inBattle&&o.playerMemory.trainer.money>money){
   for(const id of original)assert.ok(identities(o).includes(id));
   assert.equal(o.playerMemory.postgameEvidence.acquisition.coins,coins);assert.ok(restartedBattle&&restartedSave&&restartedRoute);
   console.log('# boundary '+JSON.stringify({resumed,moved,battled,restartedBattle,earned:o.playerMemory.trainer.money-money,frame:o.frame}));return {before,after:o};
  }
  if(decision.kind==='capture-saved'){controller.acknowledgeCapture();continue;}
  if(decision.kind==='acquisition-saved')throw Error('The regression must prove funding before the prize is purchased.');
  const action=decision.action??{buttons:[],holdFrames:8};
  for(let i=0;i<(action.holdFrames??1);i++)session.step(action.buttons??[]);
  for(let i=0;i<(action.releaseFrames??0);i++)session.step([]);
 }
 throw Error('Funding did not suspend, resume, resume a route and earn money within the native replay bound: '+JSON.stringify({suspended,resumed,moved,battled,frame:after.frame,objective:controller.state().objective}));
}
