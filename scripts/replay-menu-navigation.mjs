import assert from 'node:assert/strict';
import {createCampaignController} from '../engine/firered/src/suite/campaign-run.js';
import {createFireRedObserver} from '../engine/firered/src/evidence/fire-red-observer.js';
import {createAutonomousEmulator} from '../engine/firered/src/emulator/autonomous-emulator.js';

const identity=p=>JSON.stringify([p.otId,p.personality]);
const free=o=>o.phase==='stable'&&o.emulator.mode==='overworld'&&!o.emulator.inBattle&&!Object.values(o.playerMemory.ui).some(Boolean);

export async function replayMenuNavigation({session,saved,inputs,createSession}){
  const original=saved.metadata.campaign;
  assert.equal(original.state.reason,'repeated-menu-transaction');
  assert.equal(original.state.objective.id,'master-native-119-capture');
  const open=state=>createCampaignController({...inputs,mechanics:inputs.battle,record:original.record,state,clock:()=>0});
  let controller=open(original.state);
  const observer=createFireRedObserver({session,...inputs,runId:'menu-route-recovery',storyWatch:controller.storyWatch()});
  observer.capture();const before=observer.capture(),initial=new Set(before.playerMemory.trainer.party.map(identity));
  assert.equal(before.playerMemory.ui.battle.cursor,1);
  assert.deepEqual(before.playerMemory.battle.player.moves,[10,78,15,0]);
  const target=before.playerMemory.encounter.pokemon;
  assert.equal(target.species,118);
  controller.resume({retryBlockedPolicy:true});
  let now=0,id=0,dropRight=false,dropped=0;const jobs=new Map();
  // A controlled delivery fault, below the real guarded executor. It advances
  // neutral cartridge frames in place of one direction, never edits ROM/RAM.
  const transport={get frame(){return session.frame;},videoFrame:()=>session.videoFrame(),
    releaseButtons:()=>session.releaseButtons?.(),
    step(buttons){if(dropRight&&buttons.includes('right')){dropped++;session.step([]);}else session.step(buttons);}};
  const emulator=createAutonomousEmulator({session:transport,emulationSpeed:10,frameExact:true,videoFramesPerSecond:1,
    clock:()=>now,schedule(callback,delay){const n=++id;jobs.set(n,{callback,at:now+delay});return n;},cancel:n=>jobs.delete(n),
    actionObservation:()=>observer.capture(),controllerState:()=>observer.captureControllerState()});
  let restartedMove=false,restartedPending=false,restartedCapture=false,cutConfirmed=false,ballSpent=false,sawAlternate=false;
  let after=before,lastTrace='',steps=0;
  const balls=o=>o.playerMemory.trainer.bag.pokeBalls.reduce((n,b)=>n+b.quantity,0);
  try{
    for(;steps<12000;steps++){
      after=observer.capture();const m=after.playerMemory,decision=controller.decide(after),r=decision.winner?.recommendation;
      if(process.env.SUITE_REPLAY_TRACE==='1'){
        const trace=JSON.stringify([after.emulator.mode,m.ui.battle?.stage,m.ui.battle?.cursor,m.battle?.turn,r?.kind,r?.objective,decision.reason]);
        if(trace!==lastTrace){console.log('# menu-replay '+after.frame+' '+trace);lastTrace=trace;}
      }
      assert.notEqual(decision.kind,'blocked',decision.reason);
      if(decision.kind==='capture-saved'){controller.acknowledgeCapture(decision.capture.fingerprint);continue;}
      if(m.battle?.player?.species===46&&m.battle.player.pp[2]<30&&m.battle.player.moveState?.lastMove===15)cutConfirmed=true;
      if(decision.reason==='menu-route-recovery')sawAlternate=true;
      if(balls(after)<balls(before))ballSpent=true;
      const caught=m.trainer.party.find(p=>identity(p)===identity(target));
      if(caught&&!restartedCapture){controller=open(JSON.parse(JSON.stringify(controller.state())));restartedCapture=true;}
      if(free(after)&&caught&&controller.state().objective?.id!==original.state.objective.id){
        assert.ok(restartedMove&&restartedPending&&restartedCapture&&cutConfirmed&&ballSpent&&sawAlternate&&dropped>=3,
          JSON.stringify({restartedMove,restartedPending,restartedCapture,cutConfirmed,ballSpent,sawAlternate,dropped}));
        assert.deepEqual(controller.record,original.record);
        for(const p of initial)assert.ok(m.trainer.party.some(q=>identity(q)===p),'preserve the original party');
        assert.equal(controller.state().player.transactionRecovery.blocked,null);
        assert.ok(controller.state().player.menuRouteRecovery.history.some(e=>e.outcome==='cursor-confirmed'));
        // Save/reload the owning emulator checkpoint, including controller
        // evidence. This is checkpoint persistence, not a fabricated native save.
        const state=session.saveState(),sram=session.saveSram(),replica=await createSession();
        try{
          replica.loadSram(sram);replica.loadState(state);
          const restored=open(JSON.parse(JSON.stringify(controller.state())));
          const check=createFireRedObserver({session:replica,...inputs,runId:'menu-reloaded',storyWatch:restored.storyWatch()});
          check.capture();const observed=check.capture();
          assert.ok(observed.playerMemory.trainer.party.some(p=>identity(p)===identity(target)));
          assert.equal(observed.sram.sha256,after.sram.sha256);
          assert.equal(restored.state().objective.id,controller.state().objective.id);
          assert.notEqual(restored.decide(observed).kind,'blocked');
        }finally{replica.close();}
        console.log('# menu-recovery-evidence '+JSON.stringify({startFrame:before.frame,endFrame:after.frame,steps,dropped,
          cutConfirmed,ballSpent,sawAlternate,restartedMove,restartedPending,restartedCapture,
          nextObjective:controller.state().objective.id,caughtSpecies:caught.species,
          recovery:controller.state().player.menuRouteRecovery.history}));
        return {before,after};
      }
      dropRight=r?.kind==='choose-battle-command'&&r.targetCommand==='bag'&&m.ui.battle?.stage==='action'&&m.ui.battle.cursor===0;
      let done=false,result,error;
      emulator.execute(decision.action??{buttons:[],holdFrames:8,releaseFrames:0}).then(r=>{result=r;done=true;},e=>{error=e;done=true;});
      for(let n=0;n<10000&&!done;n++){
        await Promise.resolve();if(done)break;
        const [key,job]=[...jobs].sort((a,b)=>a[1].at-b[1].at)[0]??[];
        assert.ok(job,'the guarded action remains scheduled');jobs.delete(key);now=job.at;job.callback();
      }
      assert.ok(done);if(error)throw error;
      controller.observeExecution({observation:after,decision,execution:result});
      if(!restartedMove&&m.ui.battle?.stage==='move'){
        controller=open(JSON.parse(JSON.stringify(controller.state())));restartedMove=true;
      }
      if(!restartedPending&&dropped>=2){
        controller=open(JSON.parse(JSON.stringify(controller.state())));restartedPending=true;
      }
    }
    throw Error('The native capture did not recover, checkpoint and hand off.');
  }finally{emulator.close();}
}
