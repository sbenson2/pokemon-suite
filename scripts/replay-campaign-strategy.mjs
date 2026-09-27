import assert from 'node:assert/strict';
import {createCampaignController} from '../engine/firered/src/suite/campaign-run.js';
import {createFireRedObserver} from '../engine/firered/src/evidence/fire-red-observer.js';
import {createAutonomousEmulator} from '../engine/firered/src/emulator/autonomous-emulator.js';
import {recoveryFieldReady} from '../engine/firered/src/suite/campaign-recovery.js';

// Reuse the real interrupted rematch checkpoint. Advance only the supervisory
// test clock to inject inactivity; all cartridge changes use normal inputs.
export async function replayCampaignStrategy({session,saved,inputs,createSession}){
 const original=saved.metadata.campaign;let campaignNow=0;
 const open=state=>createCampaignController({...inputs,mechanics:inputs.battle,record:original.record,state,clock:()=>campaignNow});
 let controller=open(original.state);controller.resume({retryBlockedPolicy:true});
 const observer=createFireRedObserver({session,...inputs,runId:'native-strategy-recovery',storyWatch:controller.storyWatch()});
 observer.capture();const before=observer.capture(),identity=p=>JSON.stringify([p.otId,p.personality]);
 const task=original.state.player.campaignPlanner.tasks.training;
 const trainee=before.playerMemory.trainer.party.find(p=>identity(p)===task.member);
 assert.ok(trainee);let injected=false,restarted=false,changed=null,after=before,last='',activated=false,trainerBattle=false;
 let now=0,id=0;const jobs=new Map();
 const emulator=createAutonomousEmulator({session,emulationSpeed:10,frameExact:true,videoFramesPerSecond:1,
  clock:()=>now,schedule(callback,delay){const key=++id;jobs.set(key,{callback,at:now+delay});return key;},cancel:key=>jobs.delete(key),
  actionObservation:()=>observer.capture(),controllerState:()=>observer.captureControllerState()});
 try{for(let step=0;step<18000;step++){
  after=observer.capture();
  if(!injected&&recoveryFieldReady(after)){
   campaignNow+=60001;injected=true;
  }
  const decision=controller.decide(after),state=controller.state(),m=after.playerMemory,r=decision.winner?.recommendation;
  assert.notEqual(decision.kind,'blocked',decision.reason);assert.deepEqual(controller.record,original.record);
  if(injected&&!changed&&state.recovery.current.action==='replan-task'){
   changed=state.recovery.current.strategy;assert.equal(changed.kind,'alternate-training');
   assert.notDeepEqual(changed.from,changed.to);assert.equal(state.recovery.current.status,'verifying');
   controller=open(JSON.parse(JSON.stringify(state)));restarted=true;
   assert.equal(controller.state().player.campaignPlanner.tasks.training.member,task.member);
  }
  if(changed&&m.vsSeeker?.batterySteps<100)activated=true;
  if(activated&&after.emulator.inBattle&&(m.battleTypeFlags&8))trainerBattle=true;
  if(changed&&trainerBattle&&state.recovery.current.status==='recovered'&&recoveryFieldReady(after)){
   const member=m.trainer.party.find(p=>identity(p)===task.member);
   assert.ok(member.experience>trainee.experience);assert.ok(restarted);
   assert.equal(state.supervision.automaticRecoveries.length,1);
   assert.equal(after.sram.sha256,before.sram.sha256);
   const replica=await createSession();try{
    replica.loadSram(session.saveSram());replica.loadState(session.saveState());
    const check=createFireRedObserver({session:replica,...inputs,runId:'strategy-reloaded',storyWatch:controller.storyWatch()});check.capture();
    assert.notEqual(open(JSON.parse(JSON.stringify(state))).decide(check.capture()).kind,'blocked');
   }finally{replica.close();}
   console.log('# strategy-evidence '+JSON.stringify({startFrame:before.frame,endFrame:after.frame,from:changed.from,to:changed.to,experience:member.experience-trainee.experience,restarted,verified:true}));
   return {before,after};
  }
  if(process.env.SUITE_REPLAY_TRACE==='1'){
   const trace=JSON.stringify([m.map.id,m.position,after.emulator.mode,r?.kind,r?.objective,state.recovery.current?.status,changed?.to]);
   if(trace!==last&&after.phase==='stable'){console.log('# strategy '+step+' '+trace);last=trace;}
  }
  let done=false,result,error;emulator.execute(decision.action??{buttons:[],holdFrames:8,releaseFrames:0}).then(r=>{result=r;done=true;},e=>{error=e;done=true;});
  for(let n=0;n<10000&&!done;n++){
   await Promise.resolve();if(done)break;const [key,job]=[...jobs].sort((a,b)=>a[1].at-b[1].at)[0]??[];assert.ok(job);jobs.delete(key);now=job.at;job.callback();
  }
  assert.ok(done);if(error)throw error;controller.observeExecution({observation:after,decision,execution:result});
 }
 throw Error('The alternate task strategy did not achieve native trainee progress and a field handoff.');
 }finally{emulator.close();}
}
