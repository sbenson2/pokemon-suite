import assert from 'node:assert/strict';
import {createPostgameController} from '../engine/firered/src/suite/postgame.js';
import {createFireRedObserver} from '../engine/firered/src/evidence/fire-red-observer.js';
import {readPostgameEvidence} from '../engine/firered/src/suite/postgame-agenda.js';
import {createAutonomousEmulator} from '../engine/firered/src/emulator/autonomous-emulator.js';
import {encounterFingerprint} from '../engine/firered/src/player/encounter-tracker.js';

// Live September 23 stop: an Elite Four rematch turn against Lorelei's Lapras
// needed Bag and Pokémon commands. FireRed ignores directional input for about
// 12 frames after the action menu reopens; the live loop learned those ignored
// presses as rejected cursor edges and stopped with repeated-menu-transaction.
// The postgame checklist restarts from the retained stop, and the frame-exact
// live execution loop (with receipts) must win the battle and reach Bruno.
const FRAME_BUDGET=60000;

export async function replayLeagueMenuSettle({session,saved,inputs}){
 const original=structuredClone(saved.metadata.session.postgame);
 let clock=original.watchdog?.lastAt??0;
 const open=state=>createPostgameController({...inputs,mechanics:inputs.battle,state,clock:()=>clock});
 let controller=open(original);
 const observer=createFireRedObserver({session,...inputs,runId:'league-menu-settle',storyWatch:controller.storyWatch()});
 const capture=()=>{const o=observer.capture();return {...o,playerMemory:{...o.playerMemory,postgameEvidence:readPostgameEvidence(session,inputs.runtime,o)}};};
 const identities=o=>[...o.playerMemory.trainer.party,...o.playerMemory.trainer.storage.pokemon].map(encounterFingerprint).sort();
 const before=capture(),originals=identities(before);
 assert.equal(before.playerMemory.map.id,'MAP_POKEMON_LEAGUE_LORELEIS_ROOM');
 assert.equal(before.emulator.mode,'battle');
 assert.equal(controller.decide(before).reason,'repeated-menu-transaction','the checkpoint retains the live stop');
 // The Bot settings postgame checklist restarts from the retained state.
 controller=open(controller.state());await controller.beginAdventure(null);
 let now=0,id=0;const jobs=new Map();
 const emulator=createAutonomousEmulator({session,emulationSpeed:10,frameExact:true,videoFramesPerSecond:1,
  clock:()=>now,schedule(callback,delay){const key=++id;jobs.set(key,{callback,at:now+delay});return key;},cancel:key=>jobs.delete(key),
  actionObservation:()=>observer.capture(),controllerState:()=>observer.captureControllerState()});
 let last='';
 try{
  for(let n=0;n<40000;n++){
   const o=capture(),m=o.playerMemory;
   assert.ok(o.frame-before.frame<=FRAME_BUDGET,'Lorelei was not defeated within the frame budget');
   const decision=controller.decide(o);
   const trace=JSON.stringify([decision.kind,decision.reason,m.map.id,o.emulator.mode,m.ui?.battle?.stage,decision.winner?.recommendation?.kind]);
   if(trace!==last){console.log('# league-menu-settle '+o.frame+' '+trace);last=trace;}
   assert.notEqual(decision.kind,'blocked',decision.reason);
   if(m.map.id==='MAP_POKEMON_LEAGUE_BRUNOS_ROOM'&&o.emulator.mode==='overworld'){
    const history=controller.state().player?.menuRouteRecovery?.history??[];
    assert.ok(!history.some(e=>e.outcome==='edge-rejected'),'settling presses were not learned as rejected edges');
    assert.deepEqual(identities(o),originals,'every individual is preserved');
    console.log('# league-menu-settle verified '+JSON.stringify({frames:o.frame-before.frame,map:m.map.id}));
    return {before,after:o};
   }
   let done=false,result,error;
   emulator.execute(decision.action??{buttons:[],holdFrames:8,releaseFrames:0}).then(r=>{result=r;done=true;},e=>{error=e;done=true;});
   for(let k=0;k<100000&&!done;k++){
    await Promise.resolve();if(done)break;
    const [key,job]=[...jobs].sort((a,b)=>a[1].at-b[1].at)[0]??[];assert.ok(job);jobs.delete(key);now=job.at;clock=now;job.callback();
   }
   assert.ok(done);if(error)throw error;
   await controller.observeExecution({observation:o,decision,execution:result});
  }
  throw Error('The League battle did not finish.');
 }finally{emulator.close();}
}
