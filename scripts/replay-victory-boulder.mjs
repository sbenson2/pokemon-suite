import assert from 'node:assert/strict';
import {createCampaignController} from '../engine/firered/src/suite/campaign-run.js';
import {createFireRedObserver} from '../engine/firered/src/evidence/fire-red-observer.js';
import {createAutonomousEmulator} from '../engine/firered/src/emulator/autonomous-emulator.js';

export async function replayVictoryBoulder({session,saved,inputs}) {
  const original=saved.metadata.campaign;
  assert.equal(original.state.reason,'no-meaningful-progress');
  assert.equal(original.state.objective.id,'victory-road-drop-boulder');
  const open=state=>createCampaignController({...inputs,mechanics:inputs.battle,
    record:original.record,state,clock:()=>0});
  let controller=open(original.state);
  const observer=createFireRedObserver({session,...inputs,runId:'campaign-victory-boulder',storyWatch:controller.storyWatch()});
  const before=observer.capture(),identity=p=>JSON.stringify([p.otId,p.personality]);
  assert.equal(before.playerMemory.map.id,'MAP_VICTORY_ROAD_3F');
  assert.deepEqual(before.playerMemory.position,{x:37,y:10});
  const identities=before.playerMemory.trainer.party.map(identity).sort();
  let now=0,nextId=0;const ticks=new Map();
  const emulator=createAutonomousEmulator({session,emulationSpeed:10,frameExact:true,videoFramesPerSecond:1,
    actionObservation:()=>observer.capture(),controllerState:()=>observer.captureControllerState(),clock:()=>now,
    schedule:(callback,delay)=>{const id=++nextId;ticks.set(id,{callback,at:now+delay});return id;},
    cancel:id=>ticks.delete(id)});
  controller.resume({retryBlockedPolicy:true});
  let passage=false,restarted=false,dropped=false,exitSwitch=false,last='',unsupportedSince=null;
  try {
    for(let i=0;i<12000;i++) {
      const after=observer.capture(),m=after.playerMemory,decision=controller.decide(after);
      const r=decision.winner?.recommendation;
      assert.notEqual(decision.kind,'blocked',decision.reason);
      const free=after.phase==='stable'&&after.emulator.mode==='overworld'&&!after.emulator.inBattle&&!Object.values(m.ui).some(Boolean);
      if(free) {
        // The native switch script starts shortly after the boulder settles.
        // Allow that brief handoff, but reject the original stationary wait.
        if(r?.kind==='wait-for-supported-objective') {
          unsupportedSince??=after.frame;
          assert.ok(after.frame-unsupportedSince<120,'the interrupted puzzle needs an executable approach');
        } else unsupportedSince=null;
        if(m.map.id==='MAP_VICTORY_ROAD_3F') {
          const boulder=m.objectEvents.find(o=>o.localId===9);
          if(boulder?.current.x===33&&boulder?.current.y===13)passage=true;
          if(m.storyState.flagIds[88]===false)dropped=true;
        }
        if(m.map.id==='MAP_VICTORY_ROAD_2F'&&m.storyState.variableIds[0x4066]===100)exitSwitch=true;
        if(passage&&!restarted) {
          controller=open(JSON.parse(JSON.stringify(controller.state())));restarted=true;
        }
        const trace=JSON.stringify([m.map.id,m.position,r?.kind,r?.objective,r?.victoryRoadPhase]);
        if(process.env.SUITE_REPLAY_TRACE==='1'&&trace!==last){console.log('# victory-boulder '+after.frame+' '+trace);last=trace;}
        if(m.map.id==='MAP_INDIGO_PLATEAU_POKEMON_CENTER_1F'&&exitSwitch) {
          assert.ok(passage&&restarted&&dropped,'reopen the passage, restart, and complete the native drop');
          assert.notEqual(controller.state().objective?.id,'victory-road-drop-boulder','hand back to League preparation');
          assert.notEqual(controller.state().objective?.id,'victory-road-second-floor-switch-two');
          assert.deepEqual(m.trainer.party.map(identity).sort(),identities);
          assert.deepEqual(controller.record,original.record);
          assert.equal(after.sram.sha256,before.sram.sha256,'complete the puzzle through controller input');
          return {before,after};
        }
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
    throw Error('The interrupted Victory Road puzzle did not complete its drop, exit switch and League handoff.');
  } finally {emulator.close();}
}
