import assert from 'node:assert/strict';
import {createCampaignController} from '../engine/firered/src/suite/campaign-run.js';
import {createFireRedObserver} from '../engine/firered/src/evidence/fire-red-observer.js';
import {createAutonomousEmulator} from '../engine/firered/src/emulator/autonomous-emulator.js';

// Run the production input leases against the native core without wall-clock
// sleeps. Fixed virtual presentation ticks retain the same 10x frame batches.
function scheduler() {
  let now=0,nextId=0;const tasks=new Map();
  return {clock:()=>now,
    schedule(callback,delay){const id=++nextId;tasks.set(id,{callback,at:now+delay});return id;},
    cancel:id=>tasks.delete(id),
    tick(){const entry=[...tasks].sort((a,b)=>a[1].at-b[1].at)[0];assert.ok(entry,'the emulator has a scheduled tick');
      tasks.delete(entry[0]);now=entry[1].at;entry[1].callback();},
  };
}

export async function replayCyclingRoute({session,saved,inputs}) {
  const original=saved.metadata.campaign;
  assert.equal(original.state.reason,'no-meaningful-progress');
  assert.equal(original.state.objective.id,'badge-soul');
  const open=state=>createCampaignController({...inputs,mechanics:inputs.battle,record:original.record,state,clock:()=>0});
  let controller=open(original.state),restarted=false,last='';
  const observer=createFireRedObserver({session,...inputs,runId:'campaign-cycling-route',storyWatch:controller.storyWatch()});
  const before=observer.capture(),clock=scheduler();
  assert.equal(before.playerMemory.map.id,'MAP_ROUTE17');
  assert.deepEqual(before.playerMemory.position,{x:16,y:159});
  assert.equal(before.playerMemory.storyState.flagIds[1486],false,'William has not been beaten');
  const identity=p=>JSON.stringify([p.otId,p.personality]);
  const initial=new Map(before.playerMemory.trainer.party.map(p=>[identity(p),p.experience]));
  controller.resume({retryBlockedPolicy:true});
  const emulator=createAutonomousEmulator({session,...clock,emulationSpeed:10,frameExact:true,
    videoFramesPerSecond:1,actionObservation:()=>observer.capture(),controllerState:()=>observer.captureControllerState()});
  let approached=false,battled=false,after=before,routeSeen=false;
  try {
    for(let i=0;i<2600;i++) {
      after=observer.capture();const m=after.playerMemory,decision=controller.decide(after),r=decision.winner?.recommendation;
      assert.notEqual(decision.kind,'blocked',decision.reason);
      assert.equal(controller.state().objective?.id,'badge-soul','retain Koga and the selected training task');
      if(!routeSeen&&decision.action?.movementLease?.kind==='route-plan') {
        assert.equal(r.targetMap,'MAP_ROUTE17');
        assert.ok(decision.action.buttons.includes('b'),'a route entering a later Cycling Road slope needs its brake from the start');
        routeSeen=true;
      }
      if(m.map.id==='MAP_ROUTE17'&&m.position.y<158)approached=true;
      if(approached&&!restarted&&after.phase==='stable'&&!after.emulator.inBattle) {
        controller=open(JSON.parse(JSON.stringify(controller.state())));restarted=true;
      }
      if(after.emulator.inBattle&&m.battle?.trainerId===206)battled=true;
      const trace=JSON.stringify([after.emulator.mode,m.position,r?.kind,r?.objective,decision.action?.buttons]);
      if(process.env.SUITE_REPLAY_TRACE==='1'&&trace!==last){console.log('# cycling '+after.frame+' '+trace);last=trace;}
      const free=after.phase==='stable'&&after.emulator.mode==='overworld'&&!after.emulator.inBattle&&!Object.values(m.ui).some(Boolean);
      if(free&&m.storyState.flagIds[1486]===true) {
        assert.ok(routeSeen&&approached&&restarted&&battled,'cross the slope, reconstruct the controller and complete the intended trainer');
        assert.ok(m.trainer.party.some(p=>p.experience>initial.get(identity(p))),'earn native experience after the route');
        assert.deepEqual(m.trainer.party.map(identity).sort(),[...initial.keys()].sort());
        assert.deepEqual(controller.record,original.record);
        assert.equal(after.sram.sha256,before.sram.sha256,'no save edits recover navigation');
        return {before,after};
      }
      let finished=false,result,error;
      emulator.execute(decision.action??{buttons:[],holdFrames:8,releaseFrames:0})
        .then(value=>{result=value;finished=true;},value=>{error=value;finished=true;});
      for(let n=0;n<5000&&!finished;n++){clock.tick();await Promise.resolve();}
      assert.ok(finished,'each movement lease finishes within its frame budget');
      if(error)throw error;
      controller.observeExecution({observation:after,decision,execution:result});
    }
    throw Error('Cycling Road did not finish the trainer approach, battle and campaign handoff.');
  } finally {emulator.close();}
}
