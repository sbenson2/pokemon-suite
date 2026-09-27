import assert from 'node:assert/strict';
import {createCampaignController} from '../engine/firered/src/suite/campaign-run.js';
import {createFireRedObserver} from '../engine/firered/src/evidence/fire-red-observer.js';
import {createAutonomousEmulator} from '../engine/firered/src/emulator/autonomous-emulator.js';

const identity=p=>JSON.stringify([p.otId,p.personality]);
const free=o=>o.phase==='stable'&&o.emulator.mode==='overworld'&&!o.emulator.inBattle&&
  !o.playerMemory.scripts?.fieldControlsLocked&&!Object.values(o.playerMemory.ui).some(Boolean);

export async function replayFieldDialogue({session,saved,inputs,createSession}){
  const original=saved.metadata.campaign;
  assert.equal(original.state.objective.id,'badge-earth');
  assert.equal(original.state.task.kind,'training');
  const open=state=>createCampaignController({...inputs,mechanics:inputs.battle,record:original.record,state,clock:()=>0});
  let controller=open(original.state);
  const observer=createFireRedObserver({session,...inputs,runId:'field-dialogue-recovery',storyWatch:controller.storyWatch()});
  observer.capture();const before=observer.capture();
  assert.equal(before.playerMemory.map.id,'MAP_CINNABAR_ISLAND');
  assert.equal(before.playerMemory.scripts.fieldControlsLocked,true);
  assert.equal(before.playerMemory.ui.choiceMenu.selected,'yes');
  controller.resume();
  let first=controller.decide(before);
  // The preserved owner had already consumed over five minutes under the old
  // deadline. Adopt the shorter policy without discarding its clock evidence;
  // only the supported, recorded reviewed retry permits this repaired replay.
  assert.equal(first.kind,'blocked');assert.equal(first.reason,'no-meaningful-progress');
  assert.equal(controller.state().supervision.progressTimeoutMs,300000);
  assert.ok(controller.state().supervision.idleMs>=300000);
  controller.resume({retryBlockedPolicy:true});first=controller.decide(before);
  assert.equal(first.winner?.recommendation.kind,'choose-menu-option');
  assert.equal(first.winner?.recommendation.targetOption,'no');
  assert.equal(first.winner?.recommendation.objective,'badge-earth');
  let now=0,id=0;const jobs=new Map();
  const emulator=createAutonomousEmulator({session,emulationSpeed:10,frameExact:true,videoFramesPerSecond:1,
    clock:()=>now,schedule(callback,delay){const n=++id;jobs.set(n,{callback,at:now+delay});return n;},cancel:n=>jobs.delete(n),
    actionObservation:()=>observer.capture(),controllerState:()=>observer.captureControllerState()});
  const originalParty=before.playerMemory.trainer.party.map(p=>({identity:identity(p),species:p.species,experience:p.experience,moves:p.moves}));
  let after=before,restartedChoice=false,restartedFlight=false,declined=false,released=false,flew=false,steps=0,lastTrace='';
  try{
    for(;steps<6000;steps++){
      after=observer.capture();const m=after.playerMemory,decision=controller.decide(after),r=decision.winner?.recommendation;
      if(process.env.SUITE_REPLAY_TRACE==='1'){
        const trace=JSON.stringify([m.map.id,after.emulator.mode,m.scripts?.fieldControlsLocked,m.ui.choiceMenu,m.ui.fieldDialog?.stage,r,decision.reason]);
        if(trace!==lastTrace){console.log('# dialogue-replay '+after.frame+' '+trace);lastTrace=trace;}
      }
      assert.notEqual(decision.kind,'blocked',decision.reason);
      assert.equal(controller.state().objective.id,'badge-earth');
      assert.equal(controller.state().task.id,original.state.task.id,'retain the exact interrupted training member and parent');
      assert.ok(!decision.action?.buttons.includes('start')||free(after),'Start cannot preempt a native field modal');
      if(m.ui.choiceMenu&&r?.kind==='choose-menu-option'){
        assert.equal(r.targetOption,'no');
        if(decision.action.buttons.includes('a')){assert.equal(m.ui.choiceMenu.selected,'no');declined=true;}
      }
      if(declined&&free(after)&&m.map.id==='MAP_CINNABAR_ISLAND')released=true;
      if(r?.kind==='choose-fly-destination')flew=true;
      if(released&&flew&&free(after)&&m.map.id==='MAP_VIRIDIAN_CITY'){
        assert.ok(restartedChoice&&restartedFlight&&declined);
        assert.deepEqual(controller.record,original.record);
        assert.deepEqual(m.trainer.party.map(p=>({identity:identity(p),species:p.species,experience:p.experience,moves:p.moves})),originalParty);
        assert.equal(after.sram.sha256,before.sram.sha256);
        assert.equal(controller.state().player.transactionRecovery.blocked,null);
        assert.equal(controller.state().supervision.reviewedRetries.length,(original.state.supervision.reviewedRetries?.length??0)+1);
        const replica=await createSession();
        try{
          replica.loadSram(session.saveSram());replica.loadState(session.saveState());
          const restored=open(JSON.parse(JSON.stringify(controller.state())));
          const check=createFireRedObserver({session:replica,...inputs,runId:'field-dialogue-reloaded',storyWatch:restored.storyWatch()});
          check.capture();const o=check.capture();
          assert.ok(free(o));assert.equal(o.playerMemory.map.id,'MAP_VIRIDIAN_CITY');
          assert.notEqual(restored.decide(o).kind,'blocked');
          assert.equal(restored.state().task.id,original.state.task.id);
        }finally{replica.close();}
        console.log('# dialogue-recovery-evidence '+JSON.stringify({startFrame:before.frame,endFrame:after.frame,steps,
          declined,released,flew,restartedChoice,restartedFlight,objective:controller.state().objective.id,
          training:controller.state().task.id,timeoutMs:controller.state().supervision.progressTimeoutMs,
          reviewedRetries:controller.state().supervision.reviewedRetries}));
        return {before,after};
      }
      let done=false,result,error;
      emulator.execute(decision.action??{buttons:[],holdFrames:8,releaseFrames:0}).then(r=>{result=r;done=true;},e=>{error=e;done=true;});
      for(let n=0;n<10000&&!done;n++){
        await Promise.resolve();if(done)break;
        const [key,job]=[...jobs].sort((a,b)=>a[1].at-b[1].at)[0]??[];
        assert.ok(job);jobs.delete(key);now=job.at;job.callback();
      }
      assert.ok(done);if(error)throw error;
      controller.observeExecution({observation:after,decision,execution:result});
      if(!restartedChoice&&m.ui.choiceMenu){controller=open(JSON.parse(JSON.stringify(controller.state())));restartedChoice=true;}
      if(!restartedFlight&&m.ui.flyMap){controller=open(JSON.parse(JSON.stringify(controller.state())));restartedFlight=true;}
    }
    throw Error('Bill dialogue did not release field control and hand back to campaign travel.');
  }finally{emulator.close();}
}
