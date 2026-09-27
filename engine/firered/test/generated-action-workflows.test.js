import assert from 'node:assert/strict';
import test from 'node:test';
import {createCentralPlayer} from '../src/player/delegator.js';
import {createTransactionRecovery} from '../src/player/transaction-recovery.js';
import {interruptionSchedule} from '../test-support/interruption-schedule.js';

function observed(frame,party,ui,activeSlot=0,phase='stable') {
  const captureId=`generated-${frame}`;
  return {captureId,frame,phase,phaseReasons:phase==='stable'?[]:['callback-change'],
    emulator:{captureId,frame,mode:'battle',inBattle:true,inputReady:phase==='stable'},
    sram:{captureId,frame,sha256:'unchanged'},playerMemory:{captureId,frame,sha256:`ram-${frame}`,
      map:{id:'MAP_ROUTE1'},position:{x:4,y:7},trainer:{party,partyCount:party.length,usablePartyCount:party.length},
      battle:{playerPartySlot:activeSlot,player:{...party[activeSlot]},opponent:{species:19,hp:20,maxHp:20}},ui}};
}

for(let seed=1;seed<=64;seed++)test(`committed switch keeps identity through reordered duplicates and interruptions (seed ${seed})`,()=>{
  const schedule=interruptionSchedule(seed),trace=[];
  // Same species, level, stats and moves; only cartridge identity distinguishes
  // these members. Vary the initial slot and the native menu's temporary order.
  let party=Array.from({length:6},(_,slot)=>({slot,species:6,level:40,hp:100,maxHp:100,moves:[10,19],personality:100+slot,otId:1}));
  const targetSlot=1+seed%5,targetId=100+targetSlot;
  const advisor={id:'battle',advise:o=>({advisor:'battle',observationId:o.captureId,
    recommendation:o.playerMemory.ui.battle
      ? {kind:'choose-battle-command',targetCommand:'pokemon',targetPartySlot:targetSlot,targetSpecies:6,objective:'committed-switch'}
      : {kind:'choose-party-member',targetPartySlot:0,targetSpecies:6,objective:'competing-policy'},
    confidence:1,constraints:[],vetoes:[],evidenceRefs:[]})};
  let player=createCentralPlayer({advisors:[advisor]}),frame=100;
  const restore=()=>{player=createCentralPlayer({advisors:[],initialState:JSON.parse(JSON.stringify(player.state()))});};
  const step=(ui,activeSlot=0)=>{
    const faults=schedule();trace.push({frame,ui,activeSlot,...faults});
    if(faults.restartBefore)restore();
    for(let i=0;i<faults.transitionSamples;i++) {
      const result=player.decide(observed(++frame,party,ui,activeSlot,'transition'));
      assert.equal(result.kind,'resample');assert.deepEqual(result.action.buttons,[]);
    }
    const result=player.decide(observed(++frame,party,ui,activeSlot));
    if(faults.restartAfter)restore();
    return result;
  };
  try {
    // Commit before the generated cuts; the originating advisor is then absent.
    const first=player.decide(observed(frame,party,{battle:{stage:'action',cursor:2,selected:'pokemon'}}));
    assert.deepEqual(first.action.buttons,['a']);
    restore();
    const opening=step({battle:{stage:'action',cursor:2,selected:'pokemon'}});
    assert.equal(opening.winner?.recommendation.objective,'committed-switch','an identical active species is not the target');
    const rotate=1+seed%5;
    party=[...party.slice(rotate),...party.slice(0,rotate)].map((p,slot)=>({...p,slot}));
    const active=party.findIndex(p=>p.personality===100),destination=party.findIndex(p=>p.personality===targetId);
    const selected=step({party:{stage:'choose-pokemon',cursor:destination,selectedPartySlot:destination}},active);
    assert.equal(selected.winner?.recommendation.targetPartySlot,destination);
    assert.equal(selected.winner?.recommendation.objective,'committed-switch');
    assert.deepEqual(selected.action.buttons,['a']);
    const confirmed=step({party:{stage:'selection-menu',cursor:destination,selectedPartySlot:destination,action:'shift',actionCursor:0}},active);
    assert.deepEqual(confirmed.action.buttons,['a']);
    assert.equal(confirmed.winner?.recommendation.objective,'committed-switch');
    step({battle:{stage:'move',cursor:0}},destination);
    assert.equal(player.state().workflow,null,'release ownership only after native target activation');
    assert.deepEqual(party.map(p=>p.personality).sort((a,b)=>a-b),[100,101,102,103,104,105]);
  } catch(error) {error.message+=`\nReplay seed ${seed}: ${JSON.stringify(trace)}`;throw error;}
});

for(let period=9;period<=16;period++)test(`longer menu cycles remain bounded with transitions and restarts (period ${period})`,()=>{
  const next=interruptionSchedule(period);let guard=createTransactionRecovery(),recovery;
  const restart=()=>{guard=createTransactionRecovery(JSON.parse(JSON.stringify(guard.state())));};
  for(let step=0;step<210;step++) {
    const faults=next();if(faults.restartBefore)restart();
    const o={frame:step*8,phase:'stable',emulator:{mode:'bag-menu',inputReady:true},playerMemory:{
      map:{id:'MAP_ROUTE1'},position:{x:4,y:7},trainer:{bag:{items:[{itemId:13,quantity:1}]}},
      ui:{bag:{stage:'list',pocket:0,cursor:step%period}}}};
    const decision={kind:'act',winner:{recommendation:{kind:'choose-bag-item',objective:'heal-party'}},action:{buttons:['down']}};
    for(let i=0;i<faults.transitionSamples;i++)assert.equal(guard.observe({...o,phase:'transition'},decision),null);
    recovery=guard.observe(o,decision);
    if(faults.restartAfter)restart();
    if(recovery?.action==='stop')break;
  }
  assert.equal(recovery?.action,'stop',`cycle ${period} cannot keep renewing the same transaction`);
  assert.equal(recovery.objective,'heal-party');
});
