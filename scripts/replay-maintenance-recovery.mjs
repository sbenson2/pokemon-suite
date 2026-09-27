import assert from 'node:assert/strict';
import {createPostgameController} from '../engine/firered/src/suite/postgame.js';
import {createFireRedObserver} from '../engine/firered/src/evidence/fire-red-observer.js';
import {readPostgameEvidence} from '../engine/firered/src/suite/postgame-agenda.js';
import {continueNativeSaveAsync} from '../engine/firered/src/suite/native-cold-boot.js';
import {encounterFingerprint} from '../engine/firered/src/player/encounter-tracker.js';
import {SaveVault} from '../engine/firered/src/suite/save-vault.js';
import {mkdirSync,writeFileSync} from 'node:fs';
import {resolve} from 'node:path';

export async function replayMaintenanceRecovery({session,saved,inputs,createSession}){
 let now=Date.parse(saved.updatedAt??'2026-09-18T22:02:24Z');
 const open=state=>createPostgameController({...inputs,mechanics:inputs.battle,state,clock:()=>now});
 let controller=open(saved.metadata.session.postgame);
 const observer=createFireRedObserver({session,...inputs,runId:'maintenance-recovery',storyWatch:controller.storyWatch()});
 const capture=()=>{const raw=observer.capture();return {...raw,playerMemory:{...raw.playerMemory,postgameEvidence:readPostgameEvidence(session,inputs.runtime,raw)}};};
 const before=capture(),initial=before.playerMemory.trainer;
 const quantity=(t,id)=>Object.values(t.bag).flat().filter(x=>x.itemId===id).reduce((n,x)=>n+x.quantity,0);
 const identities=t=>[...t.party,...t.storage.pokemon].map(encounterFingerprint).sort();
 const original=identities(initial);
 const retain=(status,reason)=>{
  if(!process.env.SUITE_MAINTENANCE_REPLAY_OUTPUT)return;
  const root=resolve(process.env.SUITE_MAINTENANCE_REPLAY_OUTPUT);mkdirSync(root,{recursive:true});
  const record=new SaveVault(root,saved.identity).write(session.saveState(),session.saveSram(),{
   ...saved.metadata,frame:session.frame,reason,session:{...saved.metadata.session,postgame:controller.state()}});
  writeFileSync(resolve(root,'result.json'),JSON.stringify({status,reason,frame:session.frame,stateSha256:record.stateSha256,sramSha256:record.sramSha256},null,2)+'\n');
 };
 try{
 assert.equal(before.playerMemory.map.id,'MAP_VICTORY_ROAD_2F');
 assert.deepEqual(before.playerMemory.position,{x:34,y:19});
 assert.equal(controller.state().agenda.active,null);
 assert.equal(controller.state().objective.id,'stock-postgame-supplies');
 assert.equal(before.playerMemory.storyState.flags.FLAG_HIDE_VICTORY_ROAD_2F_BOULDER,true);
 // With input effects deliberately withheld, valid advice must still time out.
 const frozen=open(saved.metadata.session.postgame);let stopped;
 for(let i=0;i<8;i++){now+=5000;stopped=frozen.decide(before);if(stopped.kind==='blocked')break;}
 assert.equal(stopped.kind,'blocked','an ownerless maintenance action must not run indefinitely');
 assert.match(stopped.reason,/progress/);
 controller=open(saved.metadata.session.postgame);
 let restartRoute=false,restartPurchase=false,lastMap=null,purchaseSave=null;
 const wallDeadline=Date.now()+600000;
 for(let n=0;n<18000&&Date.now()<wallDeadline;n++){
  const o=capture(),m=o.playerMemory;now+=20;
  const d=controller.decide(o),state=controller.state();
  assert.notEqual(d.kind,'blocked',d.reason);
  if(m.map.id!==lastMap){console.log('# maintenance '+JSON.stringify({frame:o.frame,map:m.map.id,position:m.position,objective:state.objective?.id}));lastMap=m.map.id;}
  if(!restartRoute&&m.map.id==='MAP_VICTORY_ROAD_3F'){controller=open(JSON.parse(JSON.stringify(state)));restartRoute=true;}
  if(!restartPurchase&&quantity(m.trainer,2)>quantity(initial,2)){controller=open(JSON.parse(JSON.stringify(state)));restartPurchase=true;}
  if(!purchaseSave&&quantity(m.trainer,2)>=4&&quantity(m.trainer,23)>=1)
   purchaseSave={count:m.gameStats.savedGame,sha256:o.sram.sha256};
  if(restartRoute&&restartPurchase&&purchaseSave&&quantity(m.trainer,2)>=4&&quantity(m.trainer,23)>=1&&
     m.gameStats.savedGame>purchaseSave.count&&o.sram.sha256!==purchaseSave.sha256&&
     o.emulator.mode==='overworld'&&!o.emulator.inBattle&&m.saveAttemptStatus===1){
   assert.equal(m.trainer.money,initial.money-1800);assert.deepEqual(identities(m.trainer),original);
   const cold=await createSession();
   try{
    cold.loadSram(session.saveSram());const coldObserver=createFireRedObserver({session:cold,...inputs,runId:'maintenance-cold',storyWatch:controller.storyWatch()});
    const loaded=await continueNativeSaveAsync(cold,coldObserver),t=loaded.playerMemory.trainer;
    assert.equal(quantity(t,2),quantity(m.trainer,2));assert.equal(quantity(t,23),quantity(m.trainer,23));assert.equal(t.money,m.trainer.money);assert.deepEqual(identities(t),original);
   }finally{cold.close();}
   retain('passed','maintenance-purchased-saved-cold-verified');
   console.log('# maintenance '+JSON.stringify({purchased:true,coldContinue:true,restartRoute,restartPurchase,money:m.trainer.money,ultraBalls:quantity(m.trainer,2),fullHeals:quantity(m.trainer,23),frame:o.frame}));return {before,after:o};
  }
  if(d.kind==='capture-saved'){controller.acknowledgeCapture();continue;}
  const action=d.action??{buttons:[],holdFrames:8};
  for(let i=0;i<(action.holdFrames??1);i++)session.step(action.buttons??[]);
  for(let i=0;i<(action.releaseFrames??0);i++)session.step([]);
 }
 throw Error('Maintenance did not reach the shop, restock and save within its replay bound.');
 }catch(error){retain('failed',error.message);throw error;}
}
