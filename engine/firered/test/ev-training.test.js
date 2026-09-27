import test from 'node:test';
import assert from 'node:assert/strict';
import {PlayerTask} from '../src/suite/player-task.js';
import {encounterFingerprint} from '../src/player/encounter-tracker.js';
import {campaignTaskFixture} from '../test-support/campaign-task-fixture.js';
import {createPolicyAdvisors} from '../src/player/advisors.js';

const evs={hp:0,attack:0,defense:0,speed:0,spAttack:0,spDefense:0};
const member={validity:'valid',species:5,personality:101,otId:700,slot:0,level:33,experience:30000,hp:87,maxHp:87,
  ivs:{hp:31,attack:0,defense:31,speed:31,spAttack:31,spDefense:31},evs,pokerus:0,heldItem:0,moves:[33],pp:[35],status1:0};
function fixture(patch={}){
  const f=campaignTaskFixture();
  Object.assign(f.mechanics.species[0],{evYield_HP:0,evYield_Attack:0,evYield_Defense:0,evYield_Speed:1,evYield_SpAttack:0,evYield_SpDefense:0});
  f.route.layout.cells.forEach(c=>{c.encounterType=1;c.behaviorName='MB_TALL_GRASS';});
  f.world.wildEncounters=[{map:f.route.id,land_mons:{encounter_rate:30,mons:Array.from({length:12},()=>({species:'SPECIES_DIGLETT',min_level:14,max_level:14}))}}];
  const o=f.observation(100,{members:[{...structuredClone(member),...patch}],responses:false});o.emulator.inputReady=true;
  o.playerMemory.gameStats={savedGame:5};o.playerMemory.saveAttemptStatus=1;
  const request={id:'effort',kind:'ev-training',fingerprint:encounterFingerprint(member),evs:{...evs,speed:2},ivRanges:{attack:{min:0,max:0}}};
  const open=(state=null)=>new PlayerTask({request,state,world:f.world,mechanics:f.mechanics,planner:f.open().planner});
  return {o,request,open,mechanics:f.mechanics};
}
test('competitive task validates fixed IVs and existing EVs before it starts moving',()=>{
  const f=fixture({evs:{...evs,attack:1}});let task;
  assert.doesNotThrow(()=>{task=f.open();});
  assert.match(task.inspect(f.o).reason,/cannot remove/i);
  const g=fixture();g.request.ivRanges={speed:{min:0,max:0}};
  assert.match(g.open().inspect(g.o).reason,/IV.*fixed/i);
});
test('EV training retains the individual across restart and verifies its exact spread in a native save',()=>{
  const f=fixture();let task;
  assert.doesNotThrow(()=>{task=f.open();});
  const first=task.inspect(f.o);assert.equal(first.objective.target.kind,'encounter-zone');
  assert.deepEqual(first.objective.evTraining.allowedSpecies,[50]);
  f.o.playerMemory.trainer.party[0].evs={...evs,speed:1};f.o.frame=200;
  task=f.open(structuredClone(task.state));assert.equal(task.inspect(f.o).kind,'policy');
  f.o.playerMemory.trainer.party[0].evs.speed=2;f.o.frame=300;
  assert.equal(task.inspect(f.o).objective.target.kind,'save-game');
  assert.notEqual(task.inspect(f.o).kind,'complete');
  f.o.playerMemory.gameStats.savedGame=6;f.o.sram.sha256='saved';
  task=f.open(structuredClone(task.state));
  const result=task.inspect(f.o);assert.equal(result.kind,'complete');
  assert.equal(result.receipt.nativeSaveVerified,true);assert.equal(result.receipt.evs.speed,2);
});
test('cured Pokérus and Macho Brace are accounted for before a KO can overshoot',()=>{
  const f=fixture({pokerus:0x20,heldItem:181});let task;
  assert.doesNotThrow(()=>{task=f.open();});
  assert.equal(task.inspect(f.o).objective.target.kind,'take-held-item');
  f.o.playerMemory.trainer.party[0].heldItem=0;
  assert.deepEqual(task.inspect(f.o).objective.evTraining.allowedSpecies,[50]);
  f.request.evs.speed=1;
  assert.match(f.open().inspect(f.o).reason,/reachable|exact|Pokérus/i);
});
test('EV training exits an unwanted encounter and keeps the exit through a restored move menu',()=>{
  const f=fixture(),task=f.open(),objective=task.inspect(f.o).objective;
  f.o.emulator={mode:'battle',inBattle:true,inputReady:true};f.o.playerMemory.battleTypeFlags=0;
  f.o.playerMemory.battle={player:{...member},playerPartySlot:0,opponent:{species:16,level:10,hp:30,maxHp:30,shiny:false},sentPartyMasks:[1,0]};
  f.o.playerMemory.ui={battle:{stage:'action',cursor:0}};
  const advise=()=>createPolicyAdvisors({mechanics:f.mechanics,campaignPlanner:{select:()=>objective,selectTraining:()=>null}}).find(a=>a.id==='battle').advise(f.o)?.recommendation;
  assert.equal(advise()?.targetCommand,'run');
  f.o.playerMemory.ui.battle.stage='move';
  assert.equal(advise()?.kind,'cancel-battle-move-for-run');
  f.o.playerMemory.battleTypeFlags=8;
  assert.equal(advise()?.kind,'stop-for-review');
});
test('EV contamination and level 100 stop preparation without claiming completion',()=>{
  const f=fixture();let task;
  assert.doesNotThrow(()=>{task=f.open();});task.inspect(f.o);
  f.o.playerMemory.trainer.party[0].evs={...evs,speed:3};
  assert.equal(task.inspect(f.o).kind,'stop');
  const g=fixture({level:100});assert.match(g.open().inspect(g.o).reason,/100/);
});
test('EV preparation preserves the selected evolution stage instead of accepting an incidental evolution',()=>{
  const f=fixture(),task=f.open(),objective=task.inspect(f.o).objective;
  f.o.playerMemory.ui={evolution:{stage:'evolving'}};
  const advice=createPolicyAdvisors({mechanics:f.mechanics,campaignPlanner:{select:()=>objective,selectTraining:()=>null}})
    .find(a=>a.id==='quest').advise(f.o)?.recommendation;
  assert.equal(advice?.kind,'cancel-conflicting-menu');
});
test('owned vitamins respect the Gen III 100-EV cap and the exact requested target',()=>{
  const f=fixture({evs:{...evs,speed:95}});f.request.evs.speed=100;
  f.o.playerMemory.trainer.bag.items=[{itemId:66,quantity:1}];
  assert.equal(f.open().inspect(f.o).objective.target.kind,'use-party-item');
  assert.equal(f.open().inspect(f.o).objective.target.itemId,66);
  f.request.evs.speed=99;
  assert.equal(f.open().inspect(f.o).objective.target.kind,'encounter-zone');
});
test('a freely held Macho Brace is equipped from owned items only when a doubled gain fits',()=>{
  const f=fixture();f.o.playerMemory.trainer.bag.items=[{itemId:181,quantity:1}];
  assert.equal(f.open().inspect(f.o).objective.target.kind,'give-held-item');
  f.request.evs.speed=1;
  assert.equal(f.open().inspect(f.o).objective.target.kind,'encounter-zone');
});
test('Pokérus parity planning reserves the last vitamin for its 100-EV cap',()=>{
  const f=fixture({evs:{...evs,speed:1},pokerus:0x20});f.request.evs.speed=100;
  f.o.playerMemory.trainer.bag.items=[{itemId:66,quantity:1}];
  assert.equal(f.open().inspect(f.o).objective.target.kind,'encounter-zone','do not spend the only parity-correcting vitamin early');
  f.o.playerMemory.trainer.party[0].evs.speed=91;
  assert.equal(f.open().inspect(f.o).objective.target.kind,'use-party-item');
  f.o.playerMemory.trainer.party[0].evs.speed=99;
  assert.equal(f.open().inspect(f.o).objective.target.kind,'use-party-item','the vitamin can supply a single EV when a doubled KO cannot');
});
test('a vitamin does not make a reachable Pokérus target unreachable at the 100-EV cap',()=>{
  const f=fixture({evs:{...evs,speed:91},pokerus:0x20});f.request.evs.speed=101;
  f.o.playerMemory.trainer.bag.items=[{itemId:66,quantity:1}];
  assert.equal(f.open().inspect(f.o).objective.target.kind,'encounter-zone');
});
