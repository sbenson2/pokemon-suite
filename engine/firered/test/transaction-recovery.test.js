import assert from "node:assert/strict";
import test from "node:test";
import { createTransactionRecovery } from "../src/player/transaction-recovery.js";

test('repeated field-choice inputs replan promptly without guessing an answer or resetting after restart',()=>{
  let guard=createTransactionRecovery(),result;const actions=[];
  const observed={frame:100,phase:'stable',emulator:{mode:'overworld',inputReady:true},playerMemory:{
    map:{id:'MAP_CINNABAR_ISLAND'},position:{x:20,y:5},scripts:{fieldControlsLocked:true},
    ui:{choiceMenu:{cursor:0,minCursor:0,maxCursor:1,selected:'yes'}},
  }};
  for(let i=0;i<100;i++){
    result=guard.observe(observed,{kind:'act',winner:{recommendation:{kind:'open-start-menu',objective:'retained-travel'}},action:{buttons:['start']}});
    if(result)actions.push(result.action);
    assert.notEqual(result?.action,'unwind-menu','an unknown Yes/No must not be cancelled or accepted by guessing');
    if(result?.action==='stop')break;
    guard=createTransactionRecovery(JSON.parse(JSON.stringify(guard.state())));
  }
  assert.deepEqual(actions,['replan','replan','stop']);
  assert.equal(result.objective,'retained-travel');
});
test('field-choice detection does not add generic recovery to saves or link trades',()=>{
  for(const scenario of ['save','trade']){
    const guard=createTransactionRecovery();
    const observed={phase:'stable',emulator:{mode:'overworld'},playerMemory:{
      map:{id:scenario==='trade'?'MAP_UNION_ROOM':'MAP_ROUTE1'},
      ui:{choiceMenu:{cursor:0,minCursor:0,maxCursor:1},...(scenario==='save'?{saveDialog:{stage:'confirm-save'}}:{})},
    }};
    for(let i=0;i<110;i++)assert.equal(guard.observe(observed,{kind:'act',action:{buttons:[]}}),null);
  }
});

test("forced faint replacement cannot be cancelled by transaction recovery", () => {
  const guard = createTransactionRecovery();
  const observed = { phase: "stable", emulator: { mode: "battle" }, playerMemory: {
    battle: { player: { hp: 0 }, opponent: { hp: 100 } },
    ui: { party: { stage: "choose-pokemon", cursor: 0 } },
  } };
  let recovery;
  for (let index = 0; index < 100; index += 1) {
    recovery = guard.observe(observed, { kind: "act", action: { buttons: ["a"] } });
    assert.notEqual(recovery?.action, "unwind-menu");
  }
  assert.equal(recovery?.action, "stop");
});

test("long productive recharge patrols do not trigger a menu safety stop", () => {
  const guard = createTransactionRecovery();
  for (let index = 0; index < 400; index += 1) {
    assert.equal(guard.observe({ phase: "stable", emulator: { mode: "overworld" }, playerMemory: {
      position: { x: index % 10, y: 10 }, vsSeeker: { steps: index % 100 }, ui: {},
    } }, { kind: "act", action: { buttons: ["left"] } }), null);
  }
  assert.equal(guard.blocked(), null);
});

test('a stalled PC transaction is bounded even when the policy submits only neutral input',()=>{
 const guard=createTransactionRecovery();
 const observed={phase:'stable',emulator:{mode:'storage'},playerMemory:{
  map:{id:'MAP_VIRIDIAN_CITY_POKEMON_CENTER_1F'},position:{x:11,y:2},
  trainer:{party:[{slot:0,species:7,hp:22}],storage:{pokemon:[]}},
  ui:{storage:{stage:'pc-menu',option:0,selected:'withdraw'}},
 }};
 let recovery;
 for(let i=0;i<100;i++){
  recovery=guard.observe(observed,{kind:'act',winner:{recommendation:{kind:'withhold-unsafe-decision',reason:'no-safe-party-member-to-deposit'}},action:{buttons:[]}});
  assert.notEqual(recovery?.action,'unwind-menu','never cancel an unverified PC carrying state');
 }
 assert.equal(recovery?.action,'stop');
});

test('real PC occupancy changes count as progress even when the same menu action repeats',()=>{
 const guard=createTransactionRecovery();
 for(let i=0;i<120;i++)assert.equal(guard.observe({phase:'stable',emulator:{mode:'storage'},playerMemory:{
  trainer:{party:[],storage:{pokemon:[{box:Math.floor(i/30),slot:i%30,species:25,personality:123}]}},
  ui:{storage:{stage:'storage-main',cursorPosition:0}},
 }},{kind:'act',action:{buttons:['a']}}),null);
});

function fieldParty(party, { stage = "choose-pokemon", phase = "stable", mode = "party" } = {}) {
  return { phase, emulator: { mode, inputReady: true }, playerMemory: {
    trainer: { party }, ui: { party: { stage, menuType: 0, cursor: 0 } },
  } };
}
const orderDecision = { kind: "act", action: { buttons: ["a"] } };
const reorderMembers = [
  { slot: 0, species: 7, personality: 123, otId: 1, level: 10, hp: 30 },
  { slot: 1, species: 7, personality: 456, otId: 1, level: 10, hp: 30 },
];
const swappedMembers = [{ ...reorderMembers[1], slot: 0 }, { ...reorderMembers[0], slot: 1 }];

test("every completed field party reorder exits the menu before another allocation cycle", () => {
  let guard = createTransactionRecovery();
  guard.observe(fieldParty(reorderMembers), orderDecision);
  assert.equal(guard.observe(fieldParty(swappedMembers, { phase: "transition" }), orderDecision), null);
  assert.equal(guard.observe(fieldParty(swappedMembers), orderDecision)?.action, "unwind-menu");
  guard = createTransactionRecovery(JSON.parse(JSON.stringify(guard.state())));
  assert.equal(guard.observe(fieldParty(swappedMembers), orderDecision)?.action, "unwind-menu");
  assert.equal(guard.blocked(), null);
  guard.observe({ phase: "stable", emulator: { mode: "overworld" }, playerMemory: {
    trainer: { party: swappedMembers }, ui: {},
  } }, orderDecision);
  assert.equal(guard.observe(fieldParty(swappedMembers), orderDecision), null,
    "a later party visit starts a new transaction");
});

test("party reorder protection waits for readiness and excludes battle, trade and item changes", () => {
  for (const mode of ["battle", "in-game-trade"]) {
    const guard = createTransactionRecovery();
    guard.observe(fieldParty(reorderMembers, { mode }), orderDecision);
    assert.equal(guard.observe(fieldParty(swappedMembers, { mode }), orderDecision), null);
  }
  const guard = createTransactionRecovery();
  guard.observe(fieldParty(reorderMembers), orderDecision);
  assert.equal(guard.observe(fieldParty(reorderMembers.map(p => ({ ...p, hp: p.hp + 1 }))), orderDecision), null);
  const notReady = fieldParty(swappedMembers);
  notReady.emulator.inputReady = false;
  assert.equal(guard.observe(notReady, orderDecision), null);
  assert.equal(guard.observe(fieldParty(swappedMembers), orderDecision)?.action, "unwind-menu");
});
