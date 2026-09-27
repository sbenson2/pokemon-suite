import assert from 'node:assert/strict';
import {createCentralPlayer} from '../engine/firered/src/player/delegator.js';
import {createPolicyAdvisors} from '../engine/firered/src/player/advisors.js';
import {createCampaignPlanner} from '../engine/firered/src/player/campaign.js';
import {battleDecisionState} from '../engine/firered/src/player/battle-model.js';
import {createFireRedObserver} from '../engine/firered/src/evidence/fire-red-observer.js';
import {createAutonomousEmulator} from '../engine/firered/src/emulator/autonomous-emulator.js';
import {createPlannerClient} from '../engine/firered/src/suite/planner-client.js';

export async function replayTransform({session,saved,inputs,createSession}){
 let result;
 for(const speed of [1,5,10]){
  const active=speed===1?session:await createSession();
  try{
   active.loadSram(saved.sram);active.loadState(saved.state);
   result=await replayAtSpeed({session:active,saved,inputs,createSession,speed});
  }finally{if(active!==session)active.close();}
 }
 return result;
}

async function replayAtSpeed({session,saved,inputs,createSession,speed}){
 const objective={id:'train-native-ditto',target:{kind:'roster-training'},minimumCoreLevel:24,coreSpecies:[132],completion:{kind:'party-member-minimum-level',species:[132],level:24}};
 const planner=createCampaignPlanner({...inputs,mechanics:inputs.battle,campaign:{objectives:[objective]}});
 const local=initialState=>createCentralPlayer({campaignPlanner:planner,mechanics:inputs.battle,initialState,
  advisors:createPolicyAdvisors({world:inputs.world,mechanics:inputs.battle,campaignPlanner:planner})});
 const gate=new SharedArrayBuffer(4);if(speed===10)Atomics.store(new Int32Array(gate),0,1);
 const open=initialState=>{
  const base=local(initialState??null);if(speed!==10)return base;
  const state={...base.state(),...(initialState?.plannerSupervision?{plannerSupervision:initialState.plannerSupervision}:{})};
  // A fresh worker's first decision (clone the knowledge, build the planner,
  // plan) measured 0.84-1.57 s on builds 116 and 117. The deadline must clear
  // that cold start; the injected hang never answers, so it is still caught.
  return createPlannerClient({module:new URL('../engine/firered/test-support/native-transform-planner.js',import.meta.url).href,
   options:{...inputs,mechanics:inputs.battle,objective,gate,state},snapshot:{state,storyWatch:planner.storyWatch(),campaignStatus:planner.campaignStatus()},timeoutMs:5000});
 };
 let player=open();
 const observer=createFireRedObserver({session,...inputs,runId:'native-transform',storyWatch:planner.storyWatch()});
 observer.capture();const before=observer.capture();assert.equal(before.playerMemory.battle.player.species,132);
 assert.equal(before.playerMemory.ui.battle.stage,'move');
 const original=before.playerMemory.trainer.party[0],enemy=before.playerMemory.battle.opponent;
 let now=0,id=0;const jobs=new Map();
 const emulator=createAutonomousEmulator({session,emulationSpeed:speed,frameExact:true,videoFramesPerSecond:1,
  clock:()=>now,schedule(callback,delay){const key=++id;jobs.set(key,{callback,at:now+delay});return key;},cancel:key=>jobs.delete(key),
  actionObservation:()=>observer.capture(),controllerState:()=>observer.captureControllerState()});
 let transformed=false,attacked=false,restarted=false,selected=false,after=before,last='';
 try{for(let step=0;step<5000;step++){
  after=observer.capture();const m=after.playerMemory,decision=await player.decide(after),r=decision.winner?.recommendation;
  assert.notEqual(decision.kind,'blocked',decision.reason);
  if(step===0)assert.equal(r?.targetMoveId,144,'the native sole-Ditto move menu must select Transform');
  if(r?.targetMoveId===144&&decision.action.buttons.includes('a'))selected=true;
  if(after.phase==='stable'&&(m.battle?.player?.status2&(1<<21))){
   transformed=true;const b=battleDecisionState(m,m.ui);assert.equal(b.playerPartySlot,0);
   assert.equal(b.player.species,enemy.species);assert.equal(b.player.level,original.level);assert.equal(b.player.maxHp,original.maxHp);
   assert.deepEqual(b.player.moves,enemy.moves);
   if(!restarted){
    assert.ok(b.player.pp.filter((_,i)=>enemy.moves[i]).every(pp=>pp===5));
    const checkpoint=JSON.parse(JSON.stringify(player.state()));await player.close?.();player=open(checkpoint);restarted=true;
   }
   if(r?.kind==='choose-battle-move')assert.equal(b.player.moves[r.targetMoveSlot],r.targetMoveId);
   if(b.player.pp.some((pp,i)=>enemy.moves[i]&&pp<5))attacked=true;
  }
  if(transformed&&after.phase==='stable'&&!after.emulator.inBattle&&after.emulator.mode==='overworld'&&!Object.values(m.ui).some(Boolean)){
   assert.ok(selected&&restarted&&attacked);
   const member=m.trainer.party[0];assert.equal(member.species,132);assert.equal(member.personality,original.personality);
   assert.deepEqual(member.moves,[144,0,0,0]);assert.equal(member.pp[0],9);assert.ok(member.experience>original.experience,'native victory awards XP');
   assert.equal(after.sram.sha256,before.sram.sha256);
   const replica=await createSession();try{
    replica.loadSram(session.saveSram());replica.loadState(session.saveState());
    const check=createFireRedObserver({session:replica,...inputs,runId:'transform-restored',storyWatch:planner.storyWatch()});check.capture();
    const restored=open(JSON.parse(JSON.stringify(player.state())));
    try{assert.notEqual((await restored.decide(check.capture())).kind,'blocked');}finally{await restored.close?.();}
   }finally{replica.close();}
   const plannerRestarts=player.state().plannerSupervision?.history.filter(r=>r.status==='restarted').length??0;
   assert.equal(plannerRestarts,speed===10?1:0);
   console.log('# transform-evidence '+JSON.stringify({speed,startFrame:before.frame,endFrame:after.frame,opponent:enemy.species,selected,transformed,restarted,plannerRestarts,attacked,experience:member.experience-original.experience}));
   return {before,after};
  }
  if(process.env.SUITE_REPLAY_TRACE==='1'){
   const trace=JSON.stringify([after.phase,m.ui.battle?.stage,r?.kind,r?.targetMoveId,m.battle?.player?.hp,m.battle?.opponent?.hp]);
   if(trace!==last){console.log('# transform '+step+' '+trace);last=trace;}
  }
  let done=false,result,error;emulator.execute(decision.action??{buttons:[],holdFrames:8,releaseFrames:0}).then(r=>{result=r;done=true;},e=>{error=e;done=true;});
  for(let n=0;n<10000&&!done;n++){
   await Promise.resolve();if(done)break;const [key,job]=[...jobs].sort((a,b)=>a[1].at-b[1].at)[0]??[];assert.ok(job);jobs.delete(key);now=job.at;job.callback();
  }
  assert.ok(done);if(error)throw error;await player.observeExecution({observation:after,decision,execution:result});
 }
 throw Error('Native Transform did not complete a battle and field handoff.');
 }finally{emulator.close();await player.close?.();}
}
