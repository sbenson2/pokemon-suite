import assert from 'node:assert/strict';
import {createCampaignController} from '../engine/firered/src/suite/campaign-run.js';
import {createFireRedObserver} from '../engine/firered/src/evidence/fire-red-observer.js';
import {createAutonomousEmulator} from '../engine/firered/src/emulator/autonomous-emulator.js';
import {createEmulatorRequestHandler} from '../engine/firered/src/emulator/autonomous-emulator-worker-runtime.js';
import {interruptionSchedule} from '../engine/firered/test-support/interruption-schedule.js';

const identity=p=>JSON.stringify([p.otId,p.personality]);
const free=o=>o.phase==='stable'&&o.emulator.mode==='overworld'&&!o.emulator.inBattle&&!Object.values(o.playerMemory.ui).some(Boolean);
const bagContents=bag=>Object.fromEntries(Object.entries(bag).map(([pocket,items])=>[pocket,[...items].sort((a,b)=>a.itemId-b.itemId)]));

// Exercise actual native menus/routes through the production input writer.
// Reconstruct only controller state; never fabricate an observation, edit game
// memory, or restore an earlier game frame to undo a failed action.
export async function replayCampaignInterruptions({session,saved,inputs,createSession}) {
  const original=saved.metadata.campaign;
  const teaching=original.state.objective.id==='teach-fly';
  const battleTraining=original.state.objective.id==='elite-four-lorelei';
  assert.ok(teaching||battleTraining||original.state.objective.id==='victory-road-drop-boulder');
  let firstBefore,lastAfter;const variants=[];
  for(const [index,speed] of [1,5,10].entries()) {
    const seed=0xf17000+index+(teaching?0:battleTraining?200:100),schedule=interruptionSchedule(seed);
    const native=index===0?session:await createSession();
    if(index>0){native.loadSram(saved.sram);native.loadState(saved.state);}
    let now=0,nextId=0;const ticks=new Map();
    const clock={clock:()=>now,schedule(callback,delay){const id=++nextId;ticks.set(id,{callback,at:now+delay});return id;},cancel:id=>ticks.delete(id)};
    const open=state=>createCampaignController({...inputs,mechanics:inputs.battle,record:original.record,state,clock:()=>0});
    let controller=open(original.state);
    controller.resume({retryBlockedPolicy:!battleTraining});
    const observer=createFireRedObserver({session:native,...inputs,runId:`interruptions-${seed}`,storyWatch:controller.storyWatch()});
    const before=observer.capture(),initial=new Map(before.playerMemory.trainer.party.map(p=>[identity(p),p]));
    firstBefore??=before;
    const recipient=before.playerMemory.trainer.party.find(p=>p.species===6);
    if(teaching)assert.ok(recipient&&!recipient.moves.includes(19));
    const emulator=createAutonomousEmulator({session:native,...clock,emulationSpeed:speed,frameExact:true,
      videoFramesPerSecond:1,actionObservation:()=>observer.capture(),controllerState:()=>observer.captureControllerState()});
    const handler=createEmulatorRequestHandler({emulator,session:native,observer});
    const execute=async action=>{
      let done=false,result,error;
      handler('execute',action).then(r=>{result=r;done=true;},e=>{error=e;done=true;});
      for(let tick=0;tick<10000&&!done;tick++) {
        // Drain worker promise forwarding before advancing the virtual clock.
        for(let n=0;n<4;n++)await Promise.resolve();
        if(done)break;
        const [id,task]=[...ticks].sort((a,b)=>a[1].at-b[1].at)[0]??[];
        assert.ok(task,'native execution must have a scheduled completion');
        ticks.delete(id);now=task.at;task.callback();
      }
      assert.ok(done,'an action must finish within its execution budget');
      if(error)throw error;return result;
    };
    let restarts=0,pauses=0,rejected=0,selected=false,passage=false,dropped=false,exitSwitch=false,reached=false,battled=false;
    const restart=()=>{controller=open(JSON.parse(JSON.stringify(controller.state())));restarts++;};
    const trace=[];
    try {
      for(let step=0;step<12000;step++) {
        const faults=schedule();if(faults.restartBefore)restart();
        const observed=observer.capture(),m=observed.playerMemory;
        if(observed.emulator.inBattle)battled=true;
        if(faults.pause) {
          controller.pause('qualification interruption');
          assert.deepEqual(controller.decide(observed).action.buttons,[],'a paused owner cannot input');
          restart();controller.resume();pauses++;
        }
        const decision=controller.decide(observed),r=decision.winner?.recommendation;
        trace.push({frame:observed.frame,map:m.map.id,position:m.position,mode:observed.emulator.mode,
          action:r?.kind,objective:r?.objective,phase:observed.phase,...faults});
        if(trace.length>24)trace.shift();
        assert.notEqual(decision.kind,'blocked',decision.reason);
        if(teaching&&m.ui.party?.itemId===340&&r?.kind==='choose-party-member') {
          assert.equal(identity(m.trainer.party[r.targetPartySlot]),identity(recipient));selected=true;
        }
        if(free(observed)) {
          if(!teaching&&!battleTraining) {
            const boulder=m.objectEvents.find(o=>o.localId===9);
            if(m.map.id==='MAP_VICTORY_ROAD_3F'&&boulder?.current.x===33&&boulder?.current.y===13)passage=true;
            if(m.storyState.flagIds[88]===false)dropped=true;
            if(m.map.id==='MAP_VICTORY_ROAD_2F'&&m.storyState.variableIds[0x4066]===100)exitSwitch=true;
          }
          const complete=teaching
            ? selected&&m.trainer.party.find(p=>identity(p)===identity(recipient))?.moves.includes(19)
            : battleTraining?battled&&m.trainer.party.some(p=>p.experience>initial.get(identity(p))?.experience)
            : passage&&dropped&&exitSwitch&&m.map.id==='MAP_INDIGO_PLATEAU_POKEMON_CENTER_1F';
          if(complete) {
            if(battleTraining)assert.equal(controller.state().objective?.id,'elite-four-lorelei','retain the campaign after battle');
            else assert.notEqual(controller.state().objective?.id,original.state.objective.id,'hand off the completed transaction');
            assert.deepEqual(m.trainer.party.map(identity).sort(),[...initial.keys()].sort());
            assert.deepEqual(controller.record,original.record);
            assert.equal(observed.sram.sha256,before.sram.sha256);
            if(teaching) {
              assert.deepEqual(bagContents(m.trainer.bag),bagContents(before.playerMemory.trainer.bag));
              for(const p of m.trainer.party) {
                assert.equal(p.experience,initial.get(identity(p)).experience);
                if(identity(p)!==identity(recipient))assert.deepEqual(p.moves,initial.get(identity(p)).moves);
              }
            }
            assert.ok(restarts>0&&pauses>0);
            variants.push({seed,speed,steps:step,restarts,pauses,rejected,battled,startFrame:before.frame,endFrame:observed.frame});
            lastAfter=observed;reached=true;break;
          }
        }
        const result=await execute(decision.action??{buttons:[],holdFrames:8,releaseFrames:0});
        controller.observeExecution({observation:observed,decision,execution:result});
        if(faults.restartAfter)restart(); // Before observing the action's result.
        if(result.interrupted==='stale-observation') {
          rejected++;
          // Only the controller may choose how to advance after rejection.
          // Injecting neutral frames here would hide a live frame-clock deadlock.
        }
      }
      assert.ok(reached,'the native transaction must complete and resume its parent campaign');
    } catch(error) {
      error.message+=`\nReplay seed ${seed}, speed ${speed}, recent events: ${JSON.stringify(trace)}`;throw error;
    } finally {emulator.close();if(index>0)native.close();}
  }
  console.log('# interruption-evidence '+JSON.stringify({objective:original.state.objective.id,variants}));
  return {before:firstBefore,after:lastAfter};
}
