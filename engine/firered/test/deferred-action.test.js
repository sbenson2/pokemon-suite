import test from 'node:test';
import assert from 'node:assert/strict';
import {createCentralPlayer} from '../src/player/delegator.js';
import {createPolicyAdvisors} from '../src/player/advisors.js';

const objective={id:'retained-gift-offer',target:{kind:'object',map:'MAP_SAFFRON_CITY_DOJO',index:5},choice:'yes',deferOptionalDetours:true};
const planner={select:()=>objective,selectCollection:()=>null,selectTraining:()=>null,state:()=>({objective})};
const open=initialState=>createCentralPlayer({campaignPlanner:planner,initialState,
  advisors:createPolicyAdvisors({campaignPlanner:planner})});
const observation=frame=>({frame,captureId:`menu-${frame}`,phase:'stable',phaseReasons:[],
  sram:{frame,captureId:`menu-${frame}`,sha256:'unchanged-save'},
  emulator:{frame,captureId:`menu-${frame}`,mode:'overworld',inputReady:true,inBattle:false},
  playerMemory:{frame,captureId:`menu-${frame}`,map:{id:'MAP_SAFFRON_CITY_DOJO'},position:{x:5,y:4},
    scripts:{fieldControlsLocked:true},trainer:{party:[],usablePartyCount:1},
    ui:{choiceMenu:{cursor:0,minCursor:0,maxCursor:1,selected:'yes'}}}});
const wait=()=>({kind:'wait',reason:'waiting-for-verified-generation',holdFrames:1});

test('deferred confirmations do not consume the menu retry budget and survive player restoration',()=>{
  let player=open();
  for(let frame=0;frame<150;frame++){
    const decision=player.decide(observation(frame),{beforeAction:wait});
    assert.equal(decision.kind,'resample');assert.deepEqual(decision.action.buttons,[]);
    assert.equal(decision.action.holdFrames,1);assert.equal(decision.action.releaseFrames,0);
    assert.equal(player.state().transactionRecovery.blocked,null);
    player=open(JSON.parse(JSON.stringify(player.state())));
  }
  const ready=player.decide(observation(151));
  assert.equal(ready.kind,'act');assert.deepEqual(ready.action.buttons,['a']);
  assert.equal(ready.winner.recommendation.objective,objective.id);
});

test('a deliberate wait preserves earlier failed-input evidence instead of clearing real menu loops',()=>{
  let player=open();
  for(let frame=0;frame<30;frame++)assert.equal(player.decide(observation(frame)).kind,'act');
  const previous=structuredClone(player.state().transactionRecovery);
  for(let frame=30;frame<150;frame++)player.decide(observation(frame),{beforeAction:wait});
  assert.deepEqual(player.state().transactionRecovery,previous);
  player=open(JSON.parse(JSON.stringify(player.state())));
  player.decide(observation(151));
  assert.equal(player.decide(observation(152)).reason,'menu-transaction-recovery');
  for(let frame=153;frame<260;frame++)player.decide(observation(frame));
  assert.equal(player.decide(observation(260),{beforeAction:wait}).kind,'blocked','a wait cannot bypass a persisted safety stop');
});

test('the execution owner may only defer with a bounded neutral wait or stop',()=>{
  for(const value of [{kind:'wait',reason:'timing',holdFrames:0},{kind:'wait',reason:'timing',holdFrames:601},
    {kind:'wait',reason:'timing',holdFrames:1,buttons:['a']},{kind:'act',reason:'injected'}]){
    assert.throws(()=>open().decide(observation(1),{beforeAction:()=>value}),/defer|wait|action/i);
  }
  const stopped=open().decide(observation(2),{beforeAction:()=>({kind:'stop',reason:'rng-evidence-unavailable'})});
  assert.equal(stopped.kind,'blocked');assert.deepEqual(stopped.action.buttons,[]);
});
