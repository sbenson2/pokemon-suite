import assert from 'node:assert/strict';
import test from 'node:test';
import {actionPrecondition,actionPreconditionMatches} from '../src/emulator/action-precondition.js';
import {createEmulatorRequestHandler} from '../src/emulator/autonomous-emulator-worker-runtime.js';
import {createAutonomousEmulator} from '../src/emulator/autonomous-emulator.js';
import {createCentralPlayer} from '../src/player/delegator.js';
import {createMovementRecovery} from '../src/player/movement-recovery.js';
import {createTransactionRecovery} from '../src/player/transaction-recovery.js';

// Literal cartridge facts, independent of the contract's serialization. Each
// mutation changes a fact that made the original input safe to execute.
function observation() {
  return {frame:100,phase:'stable',emulator:{mode:'party',inputReady:true,inBattle:false},playerMemory:{
    map:{id:'MAP_ROUTE1'},position:{x:4,y:7},avatar:{facing:'east',flags:1},
    encounter:{validity:'none'},storyState:{flagIds:{100:false}},
    trainer:{money:1000,partyValidity:'valid',party:[
      {slot:0,personality:7,otId:1,species:6,hp:70,maxHp:100,moves:[10,19],pp:[30,15]},
      {slot:1,personality:8,otId:1,species:6,hp:40,maxHp:100,moves:[10,19],pp:[30,15]},
    ],bag:{items:[{itemId:13,quantity:2}]},storage:{pokemon:[{box:0,slot:0,species:25,personality:9,otId:1}]}},
    battle:{turn:2,playerPartySlot:0,player:{hp:70,status1:0},opponent:{hp:50,status1:0}},
    ui:{party:{stage:'choose-pokemon',cursor:1,menuType:0}},
  }};
}
const changedFacts = [
  ['position', m=>m.position.x++],
  ['facing', m=>m.avatar.facing='west'],
  ['travel mode', m=>m.avatar.flags=4],
  ['story prerequisite', m=>m.storyState.flagIds[100]=true],
  ['same-species party identity', m=>{[m.trainer.party[0].personality,m.trainer.party[1].personality]=[8,7];}],
  ['party validity', m=>m.trainer.partyValidity='invalid'],
  ['fainted recipient', m=>m.trainer.party[1].hp=0],
  ['learned move', m=>m.trainer.party[1].moves[1]=15],
  ['exhausted move', m=>m.trainer.party[1].pp[1]=0],
  ['consumed item', m=>m.trainer.bag.items[0].quantity=0],
  ['insufficient money', m=>m.trainer.money=0],
  ['opponent woke up', m=>m.battle.opponent.status1=1],
  ['active battler fainted', m=>m.battle.player.hp=0],
];

test('fresh animation and capture metadata do not reject otherwise valid input',()=>{
  const before=observation(),after=structuredClone(before);after.frame+=8;
  after.captureId='new-capture';after.playerMemory.sha256='different-unrelated-RAM';
  after.playerMemory.gameStats={playTime:999};after.playerMemory.rng={mainState:1234};
  assert.equal(actionPreconditionMatches(actionPrecondition(before),after),true);
});

test('an owned movement continuation remains executable during its native tile transition',()=>{
  const o=observation();o.phase='transition';o.phaseReasons=['tile-transition'];
  Object.assign(o.emulator,{mode:'overworld',inputReady:false,input:{heldKeysRaw:16}});
  o.playerMemory.ui={};
  const action={kind:'sustained-chord',buttons:['right'],holdFrames:4,releaseFrames:0,reason:'continue-movement-lease-tile-transition'};
  const contract=actionPrecondition(o,action);
  assert.equal(actionPreconditionMatches(contract,o,action),true);
  assert.equal(actionPreconditionMatches(contract,o,{...action,buttons:['a']}),false);
  const battle=structuredClone(o);Object.assign(battle.emulator,{mode:'battle',inBattle:true});
  assert.equal(actionPreconditionMatches(contract,battle,action),false);
  const moved=structuredClone(o);moved.playerMemory.position.x++;
  assert.equal(actionPreconditionMatches(contract,moved,action),false);
  const unowned=structuredClone(o);unowned.emulator.input.heldKeysRaw=0;
  assert.equal(actionPreconditionMatches(actionPrecondition(unowned,action),unowned,action),false);
});

test('Cycling Road may keep only its brake during a verified slope transition',()=>{
  const o=observation();o.phase='transition';o.phaseReasons=['palette-fade'];
  Object.assign(o.emulator,{mode:'overworld',inputReady:false});o.playerMemory.ui={};
  o.playerMemory.avatar.flags=2;
  o.playerMemory.mapGrid={cells:[{x:4,y:7,behaviorName:'MB_CYCLING_ROAD_PULL_DOWN'}]};
  const action={kind:'sustained-chord',buttons:['b'],holdFrames:4,releaseFrames:0,reason:'hold-cycling-road-brake-transition'};
  assert.equal(actionPreconditionMatches(actionPrecondition(o,action),o,action),true);
  const flat=structuredClone(o);flat.playerMemory.mapGrid.cells[0].behaviorName='MB_NORMAL';
  assert.equal(actionPreconditionMatches(actionPrecondition(flat,action),flat,action),false);
});

for (const [name,change] of changedFacts) test(`the input writer rejects stale ${name} before pressing a button`, async()=>{
  const before=observation(),after=structuredClone(before);after.frame++;
  change(after.playerMemory);
  let presses=0;
  const handler=createEmulatorRequestHandler({
    emulator:{execute:async()=>{presses++;return {};},cancel(){},metrics:()=>({})},
    session:{frame:after.frame,saveState(){},saveSram(){},videoFrame(){}},observer:{capture:()=>after},
  });
  const result=await handler('execute',{buttons:['a'],precondition:actionPrecondition(before)});
  assert.equal(result.interrupted,'stale-observation',name);
  assert.equal(presses,0,'stale input must never reach the writer');
});

test('PC selection binds the stored Pokemon identity, not just the box cursor',async()=>{
  const before=observation();before.emulator.mode='storage';
  before.playerMemory.ui={storage:{stage:'storage-main',cursorPosition:0}};
  const after=structuredClone(before);after.frame++;
  after.playerMemory.trainer.storage.pokemon[0].personality=99;
  let presses=0;
  const handler=createEmulatorRequestHandler({emulator:{execute:async()=>{presses++;return {};},metrics:()=>({})},
    session:{frame:101,saveState(){},saveSram(){},videoFrame(){}},observer:{capture:()=>after}});
  const result=await handler('execute',{buttons:['a'],precondition:actionPrecondition(before)});
  assert.equal(result.interrupted,'stale-observation');assert.equal(presses,0);
});

for(const scenario of ['stale','missing-reader','fresh'])test(`the direct emulator enforces the input contract (${scenario})`,async()=>{
  const before=observation(),after=structuredClone(before);if(scenario==='stale')after.playerMemory.position.x++;
  const inputs=[],tasks=new Map();let now=0,id=0;
  const session={frame:100,step(buttons){inputs.push([...buttons]);this.frame++;},
    videoFrame:()=>({width:1,height:1,rgba:new Uint8Array(4)})};
  const emulator=createAutonomousEmulator({session,frameExact:true,clock:()=>now,
    ...(scenario==='missing-reader'?{}:{actionObservation:()=>({...after,frame:session.frame})}),
    schedule:(callback,delay)=>{tasks.set(++id,{callback,at:now+delay});return id;},cancel:id=>tasks.delete(id)});
  try {
    let result,done=false;
    const execution=emulator.execute({buttons:['a'],holdFrames:1,releaseFrames:1,precondition:actionPrecondition(before)})
      .then(r=>{result=r;done=true;});
    for(let i=0;i<20&&!done;i++) {
      await Promise.resolve();if(done)break;
      const [key,task]=[...tasks].sort((a,b)=>a[1].at-b[1].at)[0];tasks.delete(key);now=task.at;task.callback();
    }
    await execution;
    if(scenario==='fresh') {
      assert.deepEqual(inputs,[['a'],[]]);assert.equal(result.endFrame,102);
    } else {
      assert.equal(result.interrupted,'stale-observation');
      assert.deepEqual(inputs,[],'the Mac direct path must not bypass the guard');
      assert.equal(session.frame,100);
    }
  } finally {emulator.close();}
});

test('a rejected input cannot deadlock a frame-owned clock, including across restart',()=>{
  const advisor={id:'quest',advise:o=>({advisor:'quest',observationId:o.captureId,
    recommendation:{kind:'open-start-menu',objective:'heal-party'},confidence:1,constraints:[],vetoes:[],evidenceRefs:[]})};
  const atomic=frame=>{
    const o=field(frame),captureId=`rejected-${frame}`;
    return {...o,captureId,phaseReasons:[],emulator:{...o.emulator,captureId,frame},sram:{captureId,frame,sha256:'sram'},
      playerMemory:{...o.playerMemory,captureId,frame,sha256:'memory'}};
  };
  let player=createCentralPlayer({advisors:[advisor]});
  const o=atomic(100),decision=player.decide(o);
  assert.deepEqual(decision.action.buttons,['start']);
  player.observeExecution({observation:o,decision,execution:{interrupted:'stale-observation',startFrame:100,endFrame:100}});
  player=createCentralPlayer({advisors:[advisor],initialState:JSON.parse(JSON.stringify(player.state()))});
  const wait=player.decide(atomic(100));
  assert.equal(wait.kind,'resample');assert.deepEqual(wait.action.buttons,[]);
  assert.ok(wait.action.holdFrames>0,'neutral frames must let the native state settle');
  assert.deepEqual(player.decide(atomic(102)).action.buttons,['start'],'resume the original goal using fresh facts');
});

for(const retained of ['running','brake'])test(`the executor accepts a proven retained ${retained} input without releasing it`,()=>{
  const navigation={id:'navigation',advise:o=>({advisor:'navigation',observationId:o.captureId,
    recommendation:{kind:'move-toward',direction:'north',useRunningShoes:retained==='running',cyclingRoadSlope:retained==='brake',objective:'reach-next-town'},
    confidence:1,constraints:[],vetoes:[],evidenceRefs:[]})};
  const atomic=(frame,held)=>{
    const o=field(frame),captureId=`owned-${frame}`;
    return {...o,captureId,phaseReasons:[],emulator:{...o.emulator,captureId,frame,inputReady:held===0,input:{heldKeysRaw:held}},
      sram:{captureId,frame,sha256:'sram'},playerMemory:{...o.playerMemory,captureId,frame,sha256:'memory',battle:null}};
  };
  const player=createCentralPlayer({advisors:[navigation]});
  player.decide(atomic(100,0));
  const o=atomic(104,retained==='brake'?2:0x42),decision=player.decide(o);
  assert.deepEqual(decision.action.buttons,['b','up']);
  assert.equal(actionPreconditionMatches(decision.action.precondition,o,decision.action),true,
    'inputReady=false caused by our own held keys is not a conflicting input owner');
  const wrong=structuredClone(o);wrong.emulator.input.heldKeysRaw=0x82;
  assert.equal(actionPreconditionMatches(decision.action.precondition,wrong,decision.action),false);
  const recap=structuredClone(o);recap.playerMemory.questLog={playback:true};
  assert.equal(actionPreconditionMatches(decision.action.precondition,recap,decision.action),false);
});

const menuDecision={kind:'act',winner:{recommendation:{kind:'choose-bag-item',objective:'heal-party',targetItemId:13}},action:{buttons:['a']}};
function bagObservation(frame) {
  const o=observation();o.frame=frame;o.emulator.mode='bag-menu';
  o.playerMemory.ui={bag:{stage:'list',pocket:0,cursor:0}};return o;
}

// Exhaust every cut of the 32-observation loop window. A controller update at
// any of these boundaries must consume the same finite recovery budget.
for(let restartEvery=1;restartEvery<=31;restartEvery++) test(`menu recovery survives reconstruction every ${restartEvery} observations`,()=>{
  let guard=createTransactionRecovery(),result;
  for(let step=1;step<=100;step++) {
    result=guard.observe(bagObservation(step*4),menuDecision);
    if(step%restartEvery===0)guard=createTransactionRecovery(JSON.parse(JSON.stringify(guard.state())));
    if(result?.action==='stop')break;
  }
  assert.equal(result?.action,'stop','restarts cannot erase a repeating transaction');
  assert.equal(result.objective,'heal-party');
  assert.equal(guard.observe(bagObservation(1000),menuDecision)?.action,'stop','the stop stays latched');
});

test('unready menu animation cannot consume a recovery attempt',()=>{
  const guard=createTransactionRecovery();
  for(let i=0;i<150;i++) {
    const o=bagObservation(i);o.emulator.inputReady=false;
    assert.equal(guard.observe(o,menuDecision),null);
  }
  assert.equal(guard.observe(bagObservation(151),menuDecision),null);
});

for(const context of ['save','script-party','trade'])test(`generic menu recovery cannot cancel a ${context} transaction`,()=>{
  const guard=createTransactionRecovery();
  for(let i=0;i<100;i++) {
    const o=observation();o.frame=i*4;
    if(context==='save')o.playerMemory.ui.saveDialog={stage:'saving'};
    if(context==='script-party')Object.assign(o.playerMemory.ui.party,{menuType:3,actionId:11});
    if(context==='trade')o.playerMemory.map.id='MAP_UNION_ROOM';
    assert.notEqual(guard.observe(o,menuDecision)?.action,'unwind-menu');
  }
});

function field(frame=100,x=4) {
  const o=observation();o.frame=frame;o.emulator.mode='overworld';
  o.playerMemory.position={x,y:7};o.playerMemory.ui={};return o;
}
function stalled(o) {
  return {observation:o,execution:{startFrame:o.frame,endFrame:o.frame+60,movementLease:'stalled'},decision:{
    winner:{recommendation:{kind:'move-toward',direction:'east',objective:'reach-next-town'}},
    action:{buttons:['right'],movementLease:{kind:'route-plan',origin:{map:'MAP_ROUTE1',x:4,y:7}}},
  }};
}

for(const interruption of ['restart','transition','both'])test(`failed route evidence survives ${interruption} before the settled observation`,()=>{
  let recovery=createMovementRecovery();
  for(let i=0;i<3;i++) {
    const o=field(100+i*64);recovery.observation(o);recovery.observeExecution(stalled(o));
    if(interruption!=='transition')recovery=createMovementRecovery(JSON.parse(JSON.stringify(recovery.state())));
    if(interruption!=='restart') {
      const moving={...o,phase:'transition'};recovery.observation(moving);
      recovery.observeExecution({observation:moving,decision:{action:{buttons:[]}},execution:{startFrame:o.frame+60,endFrame:o.frame+62}});
    }
    recovery.observation(field(o.frame+64));
  }
  assert.deepEqual(recovery.observation(field(300)).navigationExclusions?.tiles,[{x:5,y:7}]);
});

test('restored route evidence is reconciled against battle or actual movement before excluding a tile',()=>{
  for(const interruption of ['battle','movement']) {
    let recovery=createMovementRecovery();
    for(let i=0;i<4;i++) {
      recovery.observeExecution(stalled(field(i*64)));
      recovery=createMovementRecovery(JSON.parse(JSON.stringify(recovery.state())));
      const after=field(i*64+60,interruption==='movement'?5:4);
      if(interruption==='battle')Object.assign(after.emulator,{mode:'battle',inBattle:true});
      assert.equal(recovery.observation(after).navigationExclusions,undefined);
    }
    assert.equal(recovery.observation(field(400)).navigationExclusions,undefined);
  }
});
