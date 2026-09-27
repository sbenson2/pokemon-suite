import assert from 'node:assert/strict';
import {createCampaignController} from '../engine/firered/src/suite/campaign-run.js';
import {createFireRedObserver} from '../engine/firered/src/evidence/fire-red-observer.js';
import {createAutonomousEmulator} from '../engine/firered/src/emulator/autonomous-emulator.js';

const identity=p=>JSON.stringify([p.otId,p.personality]);
const free=o=>o.phase==='stable'&&o.emulator.mode==='overworld'&&!o.emulator.inBattle&&
  !o.playerMemory.scripts?.fieldControlsLocked&&!Object.values(o.playerMemory.ui).some(Boolean);

export async function replayMovingRematch({session,saved,inputs,createSession}) {
  const original=saved.metadata.campaign;
  assert.equal(original.state.reason,'repeated-menu-transaction');
  assert.equal(original.state.objective.id,'elite-four-lorelei');
  const open=state=>createCampaignController({...inputs,mechanics:inputs.battle,record:original.record,state,clock:()=>0});
  let controller=open(original.state);controller.resume({retryBlockedPolicy:true});
  const observer=createFireRedObserver({session,...inputs,runId:'moving-rematch',storyWatch:controller.storyWatch()});
  observer.capture();const before=observer.capture();
  assert.equal(before.playerMemory.map.id,'MAP_ROUTE21_NORTH');
  assert.equal(before.emulator.mode,'start-menu');
  assert.deepEqual(before.playerMemory.position,{x:16,y:41});
  const initial=new Map(before.playerMemory.trainer.party.map(p=>[identity(p),p.experience]));
  let now=0,id=0;const jobs=new Map();
  const emulator=createAutonomousEmulator({session,emulationSpeed:10,frameExact:true,videoFramesPerSecond:1,
    clock:()=>now,schedule(callback,delay){const n=++id;jobs.set(n,{callback,at:now+delay});return n;},cancel:n=>jobs.delete(n),
    actionObservation:()=>observer.capture(),controllerState:()=>observer.captureControllerState()});
  let after=before,restartedExit=false,restartedUse=false,restartedBattle=false,
    relocated=false,activated=false,battled=false,partnerMove=null,partnerUsedMove=false,last='',steps=0;
  try {
    for(;steps<18000;steps++) {
      after=observer.capture();const m=after.playerMemory,decision=controller.decide(after),r=decision.winner?.recommendation;
      assert.notEqual(decision.kind,'blocked',decision.reason);
      assert.equal(controller.state().objective.id,original.state.objective.id);
      assert.equal(controller.state().supervision.progressTimeoutMs,300000);
      if(r?.objective?.includes('vs-seeker')&&['open-start-menu','choose-start-menu-item','choose-bag-item','choose-bag-context-action'].includes(r.kind)) {
        const localIds=decision.winner.evidenceRefs.filter(e=>e.startsWith('cartridge:rematch-local-id:')).map(e=>Number(e.split(':').at(-1)));
        assert.ok(localIds.length>0);
        for(const localId of localIds) {
          const trainer=m.objectEvents.find(e=>!e.player&&e.localId===localId&&e.map.group===m.map.group&&e.map.number===m.map.number);
          assert.ok(trainer&&Math.abs(trainer.current.x-m.position.x)<=7&&Math.abs(trainer.current.y-m.position.y)<=5,
            'never repeat item activation against a trainer outside native visibility');
        }
      }
      if(m.position.x!==16||m.position.y!==41)relocated=true;
      if(m.vsSeeker.batterySteps<100)activated=true;
      if(activated&&after.emulator.inBattle)battled=true;
      if(r?.kind==='choose-battle-move'&&m.ui.battle?.battler===2&&decision.action?.buttons.includes('a')) {
        const partner=m.battle.battlers[2];
        assert.equal(partner.moves[r.targetMoveSlot],r.targetMoveId);
        partnerMove??={species:partner.species,slot:r.targetMoveSlot,move:r.targetMoveId,pp:partner.pp[r.targetMoveSlot]};
      }
      if(partnerMove&&m.trainer.party.some(p=>p.species===partnerMove.species&&
        p.moves[partnerMove.slot]===partnerMove.move&&p.pp[partnerMove.slot]<partnerMove.pp))partnerUsedMove=true;
      if(process.env.SUITE_REPLAY_TRACE==='1') {
        const trace=JSON.stringify([m.map.id,after.emulator.mode,m.position,m.vsSeeker.batterySteps,r?.kind,r?.objective]);
        if(trace!==last&&after.phase==='stable'){console.log('# moving-rematch '+after.frame+' '+trace);last=trace;}
      }
      if(battled&&free(after)&&m.trainer.party.some(p=>p.experience>initial.get(identity(p)))) {
        assert.ok(relocated&&restartedExit&&restartedUse&&restartedBattle&&partnerUsedMove);
        assert.equal(r?.kind,'move-toward','hand control to the next field task after the battle');
        assert.deepEqual(m.trainer.party.map(identity).sort(),[...initial.keys()].sort());
        assert.deepEqual(controller.record,original.record);
        assert.equal(after.sram.sha256,before.sram.sha256);
        assert.equal(controller.state().player.transactionRecovery.blocked,null);
        const replica=await createSession();
        try {
          replica.loadSram(session.saveSram());replica.loadState(session.saveState());
          const restored=open(JSON.parse(JSON.stringify(controller.state())));
          const check=createFireRedObserver({session:replica,...inputs,runId:'moving-rematch-reloaded',storyWatch:restored.storyWatch()});
          check.capture();const o=check.capture();
          assert.ok(free(o));assert.notEqual(restored.decide(o).kind,'blocked');
          assert.equal(restored.state().objective.id,original.state.objective.id);
        }finally{replica.close();}
        console.log('# moving-rematch-evidence '+JSON.stringify({startFrame:before.frame,endFrame:after.frame,steps,relocated,activated,battled,restartedExit,restartedUse,restartedBattle,partnerUsedMove,handoff:r.objective}));
        return {before,after};
      }
      let done=false,result,error;
      emulator.execute(decision.action??{buttons:[],holdFrames:8,releaseFrames:0}).then(r=>{result=r;done=true;},e=>{error=e;done=true;});
      for(let n=0;n<10000&&!done;n++) {
        await Promise.resolve();if(done)break;
        const [key,job]=[...jobs].sort((a,b)=>a[1].at-b[1].at)[0]??[];
        assert.ok(job);jobs.delete(key);now=job.at;job.callback();
      }
      assert.ok(done);if(error)throw error;
      controller.observeExecution({observation:after,decision,execution:result});
      if(!restartedExit&&r?.kind==='close-menu'){controller=open(JSON.parse(JSON.stringify(controller.state())));restartedExit=true;}
      if(!restartedUse&&r?.kind==='choose-bag-context-action'&&r?.objective?.includes('vs-seeker')){controller=open(JSON.parse(JSON.stringify(controller.state())));restartedUse=true;}
      if(!restartedBattle&&r?.kind==='choose-battle-move'&&m.ui.battle?.battler===2){controller=open(JSON.parse(JSON.stringify(controller.state())));restartedBattle=true;}
    }
    throw Error('Moving-trainer recovery did not complete a productive native rematch and field handoff.');
  }finally{emulator.close();}
}
