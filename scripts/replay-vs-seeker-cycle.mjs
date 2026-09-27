import assert from 'node:assert/strict';
import {createCampaignController} from '../engine/firered/src/suite/campaign-run.js';
import {createFireRedObserver} from '../engine/firered/src/evidence/fire-red-observer.js';
import {createAutonomousEmulator} from '../engine/firered/src/emulator/autonomous-emulator.js';

export async function replayVsSeekerCycle({session,saved,inputs}) {
  const original=saved.metadata.campaign;
  assert.equal(original.state.reason,'no-meaningful-progress');
  assert.equal(original.state.objective.id,'badge-soul');
  const open=state=>createCampaignController({...inputs,mechanics:inputs.battle,record:original.record,state,clock:()=>0});
  let controller=open(original.state);
  const observer=createFireRedObserver({session,...inputs,runId:'campaign-vs-seeker-cycle',storyWatch:controller.storyWatch()});
  const before=observer.capture(),identity=p=>JSON.stringify([p.otId,p.personality]);
  assert.equal(before.emulator.mode,'bag');
  assert.deepEqual(before.playerMemory.position,{x:39,y:10});
  const initial=new Map(before.playerMemory.trainer.party.map(p=>[identity(p),p.experience]));
  let now=0,nextId=0;const ticks=new Map();
  const emulator=createAutonomousEmulator({session,emulationSpeed:10,frameExact:true,videoFramesPerSecond:1,
    actionObservation:()=>observer.capture(),controllerState:()=>observer.captureControllerState(),clock:()=>now,
    schedule:(callback,delay)=>{const id=++nextId;ticks.set(id,{callback,at:now+delay});return id;},
    cancel:id=>ticks.delete(id)});
  controller.resume({retryBlockedPolicy:true});
  let after=before,activations=0,previousBattery=100,initialMenuRestart=false,freshMenuRestart=false;
  let batchMap=null,batchExperience=null,rematchBattled=false,last='',finishedBattles=0,wasBattle=false;
  try {
    for(let i=0;i<15000;i++) {
      after=observer.capture();const m=after.playerMemory,decision=controller.decide(after),r=decision.winner?.recommendation;
      assert.notEqual(decision.kind,'blocked',decision.reason);
      assert.equal(controller.state().objective?.id,'badge-soul','retain the campaign goal');
      const responders=m.vsSeeker.rematchEntries.flatMap((n,localId)=>n>0?[[localId,n]]:[]);
      if(m.vsSeeker.batterySteps<previousBattery) {
        activations++;
        if(activations>=2) {
          assert.notDeepEqual({map:m.map.id,...m.position},{map:'MAP_ROUTE18',x:39,y:10},
            'do not repeat an activation whose responders require a map exit');
          if(responders.length) {
            batchMap=m.map.id;
            batchExperience=new Map(m.trainer.party.map(p=>[identity(p),p.experience]));
          }
        }
      }
      previousBattery=m.vsSeeker.batterySteps;
      if(batchMap) {
        assert.equal(m.map.id,batchMap,'keep the fresh response batch on its native map');
        if(after.emulator.inBattle)rematchBattled=true;
      }
      if(wasBattle&&!after.emulator.inBattle)finishedBattles++;
      wasBattle=after.emulator.inBattle;
      const free=after.phase==='stable'&&after.emulator.mode==='overworld'&&!after.emulator.inBattle&&!Object.values(m.ui).some(Boolean);
      if(!initialMenuRestart&&activations===1&&free) {
        controller=open(JSON.parse(JSON.stringify(controller.state())));initialMenuRestart=true;
      }
      if(initialMenuRestart&&!freshMenuRestart&&r?.kind==='choose-bag-context-action'&&r?.targetAction==='use'&&r?.objective?.includes('vs-seeker')) {
        controller=open(JSON.parse(JSON.stringify(controller.state())));freshMenuRestart=true;
      }
      const trace=JSON.stringify([after.emulator.mode,m.map.id,m.position,m.vsSeeker.batterySteps,responders,r?.kind,r?.objective]);
      if(process.env.SUITE_REPLAY_TRACE==='1'&&trace!==last&&after.phase==='stable') {console.log('# rematch '+after.frame+' '+trace);last=trace;}
      // A completed battle may require the existing health/PP recovery policy
      // before further responses. Verify the productive battle and its field
      // handoff; never force the party to stay when recovery is necessary.
      if(free&&batchMap&&rematchBattled&&m.trainer.party.some(p=>p.experience>batchExperience.get(identity(p)))) {
        assert.ok(initialMenuRestart&&freshMenuRestart&&finishedBattles>0,'survive menu/controller restart and finish real battles');
        assert.ok(m.trainer.party.some(p=>p.experience>initial.get(identity(p))),'earn native battle XP');
        assert.deepEqual(m.trainer.party.map(identity).sort(),[...initial.keys()].sort());
        assert.deepEqual(controller.record,original.record);
        assert.equal(after.sram.sha256,before.sram.sha256,'recover through controller input without changing saved SRAM');
        return {before,after};
      }
      let finished=false,result,error;
      emulator.execute(decision.action??{buttons:[],holdFrames:8,releaseFrames:0})
        .then(value=>{result=value;finished=true;},value=>{error=value;finished=true;});
      for(let n=0;n<5000&&!finished;n++) {
        const [id,tick]=[...ticks].sort((a,b)=>a[1].at-b[1].at)[0]??[];
        assert.ok(tick,'the production emulator schedules input completion');
        ticks.delete(id);now=tick.at;tick.callback();await Promise.resolve();
      }
      assert.ok(finished,'the production action completes within its frame budget');
      if(error)throw error;
      controller.observeExecution({observation:after,decision,execution:result});
    }
    throw Error('Vs. Seeker recovery did not complete a fresh activation and its response battles.');
  } finally {emulator.close();}
}
