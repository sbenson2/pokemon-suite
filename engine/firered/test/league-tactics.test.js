import assert from 'node:assert/strict';
import test from 'node:test';
import {readFileSync} from 'node:fs';
import {createPolicyAdvisors} from '../src/player/advisors.js';
import {battleRecoveryPlan,matchupIsMateriallyBetter} from '../src/player/battle-model.js';

const fixture=JSON.parse(readFileSync(new URL('../test-support/league-tactics.json',import.meta.url)));
const {mechanics}=fixture;
const observed=frame=>structuredClone(fixture.observations.find(x=>x.frame===frame).observation);
function recommend(o) {
  const objective=fixture.observations.find(x=>x.frame===o.frame)?.objective??fixture.observations[0].objective;
  return createPolicyAdvisors({mechanics,world:{maps:[]},campaignPlanner:{select:()=>objective,selectTraining:()=>null}})
    .find(a=>a.id==='battle').advise(o)?.recommendation;
}
function player(o,patch) {
  const m=o.playerMemory,b=m.battle;
  Object.assign(b.player,patch);Object.assign(b.battlers[b.player.battler],patch);
  Object.assign(m.trainer.party.find(p=>p.species===b.player.species),patch);
}
function opponent(o,patch) {
  const b=o.playerMemory.battle;Object.assign(b.opponent,patch);Object.assign(b.battlers[b.opponent.battler],patch);
}

test('coverage alone cannot pay for switching to a lower utility counter',()=>{
  assert.equal(matchupIsMateriallyBetter({best:{score:80},active:{score:100},coverageUpgrade:true},1.35),false);
  assert.equal(matchupIsMateriallyBetter({best:{score:140},active:{score:100},coverageUpgrade:true},1.35),true);
});
test('a free shift can select a safe coverage specialist without paying an attack turn',()=>{
  const matchup={best:{score:80},active:{score:100},coverageUpgrade:true};
  assert.equal(matchupIsMateriallyBetter({...matchup,freeShift:true},1.15),true);
  assert.equal(matchupIsMateriallyBetter(matchup,1.15),false);
});
for(const frame of [10292206,10294010])test(`the retained Lance turn at ${frame} keeps Charizard instead of starting a Seadra bounce`,()=>{
  assert.equal(recommend(observed(frame)).targetCommand,'fight');
});
test('the retained Dewgong turn finishes its remaining 14 HP instead of spending a turn on Sing',()=>{
  const r=recommend(observed(10186554));assert.equal(r.kind,'choose-battle-move');assert.equal(r.targetMoveId,1);
});
test('a healthy bulky opponent still allows the sleep strategy',()=>{
  const o=observed(10186554);opponent(o,{hp:171});assert.equal(recommend(o).targetMoveId,47);
});
test('a faster unconfused attacker finishes a low-HP opponent before buying another healing turn',()=>{
  const o=observed(10200820);player(o,{status2:0});
  assert.equal(recommend(o).targetCommand,'fight');
  o.playerMemory.ui={battle:{stage:'move',cursor:0,battler:0}};
  assert.equal(recommend(o).targetMoveId,17,'Wing Attack is accurate and preserves scarce Flamethrower PP');
});
test('an item already committed by the cartridge still completes before a finishing attack',()=>{
  const o=observed(10200820);player(o,{status2:0});o.playerMemory.ui={party:{stage:'choose-pokemon',itemId:20,cursor:0}};
  const r=recommend(o);assert.equal(r.kind,'choose-party-member');assert.equal(r.targetSpecies,6);
  assert.equal(r.objective,'restore-active-pokemon');
});
for(const [label,change] of [
  ['confusion',o=>player(o,{status2:3})],
  ['paralysis',o=>player(o,{status1:64})],
  ['faster opponent',o=>opponent(o,{stats:{...o.playerMemory.battle.opponent.stats,speed:300}})],
  ['unknown speed',o=>opponent(o,{stats:{...o.playerMemory.battle.opponent.stats,speed:0}})],
  ['Quick Claw',o=>opponent(o,{item:183})],
  ['Focus Band',o=>opponent(o,{item:196})],
  ['a Substitute',o=>opponent(o,{status2:1<<24,moveState:{...o.playerMemory.battle.opponent.moveState,substituteHp:50}})],
  ['priority attack',o=>{mechanics.moves[999]={id:999,name:'MOVE_QUICK_ATTACK',type:'TYPE_NORMAL',power:40,accuracy:100,priority:1,effect:'EFFECT_QUICK_ATTACK'};opponent(o,{moves:[999,57],pp:[10,10]});}],
])test(`a claimed finishing attack does not discard healing with ${label}`,()=>{
  try {
    const o=observed(10200820);player(o,{status2:0});change(o);assert.equal(recommend(o).targetCommand,'bag');
  }finally{delete mechanics.moves[999];}
});
test('a finishing move must have PP and work against the observed target',()=>{
  const o=observed(10186554);player(o,{pp:[10,10,0,10]});assert.notEqual(recommend(o).targetMoveId,1);
  const ghost=observed(10186554);opponent(ghost,{species:94,types:[7,3]});assert.notEqual(recommend(ghost).targetMoveId,1);
});
test('when both Water attacks finish, use Surf instead of risking a Hydro Pump miss',()=>{
  const o=observed(10289906);player(o,{moves:[56,57,0,0],pp:[5,15,0,0]});opponent(o,{hp:5});
  o.playerMemory.ui={battle:{stage:'move',cursor:0,battler:0}};
  assert.equal(recommend(o).targetMoveId,57);
});
test('confusion and low health use one Full Restore instead of preserving confusion with Max Potions',()=>{
  const o=observed(10200820),m=o.playerMemory;
  assert.equal(battleRecoveryPlan(m,m.battle,mechanics).itemId,19);
});
test('healthy confusion is cured with Full Heal and does not require a major status bit',()=>{
  const o=observed(10200820);player(o,{hp:182});
  assert.equal(battleRecoveryPlan(o.playerMemory,o.playerMemory.battle,mechanics)?.itemId,23);
});
test('confusion prefers a cure for both conditions over an antidote that leaves it confused',()=>{
  const o=observed(10200820);player(o,{hp:182,status1:8});o.playerMemory.trainer.bag.items.push({itemId:14,quantity:3});
  assert.equal(battleRecoveryPlan(o.playerMemory,o.playerMemory.battle,mechanics)?.itemId,23);
});
test('a voluntary switch cannot send Graveler into a lethal Surf when Wigglytuff can survive',()=>{
  const o=observed(10200820),m=o.playerMemory;player(o,{hp:1,status2:0});
  const slowbro=m.battle.enemyParty.find(p=>p.species===80);
  opponent(o,{...slowbro,types:mechanics.species[80].types,status2:0,status3:0,ability:12});
  m.trainer.bag.items=[];
  for(const p of m.trainer.party)if(![6,75,40].includes(p.species))p.hp=0;
  m.trainer.party.find(p=>p.species===40).hp=139;
  const r=recommend(o);assert.equal(r.targetCommand,'pokemon');
  assert.equal(m.trainer.party.find(p=>p.slot===r.targetPartySlot)?.species,40);
});
