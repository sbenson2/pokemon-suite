import assert from 'node:assert/strict';
import test from 'node:test';
import {readFileSync} from 'node:fs';
import {createPolicyAdvisors} from '../src/player/advisors.js';
import * as battleModel from '../src/player/battle-model.js';

// Native Champion rematch (postgame-league-champion-tactics): Dragonite against
// the Champion's Gyarados. FireRed's trainer AI commits its action for the
// turn, and zeroes the trainer item it uses, before the player's action menu
// is answered; an item acts before any move. gChosenActionByBattler was read
// natively at every decision: at turn 7 (Gyarados 37/244) the Champion had
// committed a Full Restore ([255,1,...]) and Gyarados was back at 229 on turn 8;
// at turn 11 (36/244) it had chosen a move ([255,0,...]) and Wing Attack
// finished it. The same held for Lorelei (turn 47) and Lance (turn 21).
const fixture=JSON.parse(readFileSync(new URL('../test-support/league-heal-finish.json',import.meta.url)));
const {mechanics}=fixture;
const observed=label=>structuredClone(fixture.observations.find(x=>x.label===label).observation);
const WING_ATTACK=17,GYARADOS=130;
const world={maps:[]};
const objective={id:'postgame-league-rematch-champion',importantBattle:true,battleCategory:'champion',target:{kind:'object',map:'MAP_POKEMON_LEAGUE_CHAMPIONS_ROOM',index:0}};
const advise=o=>createPolicyAdvisors({mechanics,world,campaignPlanner:{select:()=>objective,selectTraining:()=>null}}).find(a=>a.id==='battle').advise(o)?.recommendation;
const moveStage=o=>{o.playerMemory.ui={...o.playerMemory.ui,battle:{...o.playerMemory.ui.battle,stage:'move',cursor:0}};return o;};
function finisher(o){
  const m=o.playerMemory,b=battleModel.battleDecisionState(m,m.ui);
  return battleModel.finishingBattleMove({mechanics,player:b.player,opponent:b.opponent,weather:b.weather,battle:b,selectableMoveSlots:new Set([0,1,2,3])});
}
// Turn 11 with the Champion's committed Full Restore of turn 7.
function healing(){
  const o=observed('gyarados-dragonite-turn11');
  o.playerMemory.battle.chosenActions=[...observed('gyarados-dragonite-turn7-confused').playerMemory.battle.chosenActions];
  return o;
}

test('the trainer heals before a weak finisher: no finish that a Full Restore undoes',()=>{
  const o=healing(),b=o.playerMemory.battle;
  assert.equal(b.opponent.species,GYARADOS);assert.deepEqual(b.chosenActions,[255,1,255,255]);
  // Without the heal the higher-PP Wing Attack (31 PP) would "finish" 36 HP.
  assert.equal(finisher(o),null,'nothing knocks out the Full-Restored Gyarados');
  const action=advise(o);
  assert.notEqual(action?.objective,'finish-current-opponent',JSON.stringify(action));
  const move=advise(moveStage(healing()));
  assert.equal(move?.kind,'choose-battle-move');
  assert.notEqual(move.objective,'finish-current-opponent',JSON.stringify(move));
  assert.notEqual(move.targetMoveId,WING_ATTACK,'not the weaker high-PP finisher: '+JSON.stringify(move));
});

test('a trainer that chose a move is finished as before',()=>{
  const o=observed('gyarados-dragonite-turn11');
  assert.deepEqual(o.playerMemory.battle.chosenActions,[255,0,255,255]);
  assert.equal(finisher(o)?.moveId,WING_ATTACK);
  assert.equal(advise(moveStage(o))?.targetMoveId,WING_ATTACK);
});

test('an unobserved trainer action keeps the established finisher',()=>{
  const o=healing();delete o.playerMemory.battle.chosenActions;
  assert.equal(finisher(o)?.moveId,WING_ATTACK);
});

test('the heal model reads only the opponent battler\'s committed item action',()=>{
  const heal=battleModel.trainerHealBeforeMove;
  assert.equal(typeof heal,'function');
  const battle=(actions,hp=30)=>({chosenActions:actions,opponent:{battler:1,species:130,hp,maxHp:244}});
  assert.deepEqual(heal({battle:battle([255,1,255,255])}),{action:'item',hp:244});
  assert.equal(heal({battle:battle([255,0,255,255])}),null,'a move');
  assert.equal(heal({battle:battle([1,0,255,255])}),null,'our own item use is not the opponent\'s');
  assert.equal(heal({battle:battle([255,2,255,255])}),null,'a switch');
  assert.equal(heal({battle:{opponent:{battler:1,hp:30,maxHp:244}}}),null,'unobserved');
  assert.equal(heal({battle:battle([255,1,255,255],0)}),null,'fainted');
});

test('the documented Champion loop: Charizard is not "finished" by Wing Attack into its Full Restores',()=>{
  // Pre-battle-sense replay, turn 14: the recorded decision was finish-current-opponent
  // with Wing Attack every turn while Charizard went 51, 50, 50, 48, 61.
  const entry=fixture.observations.find(x=>x.label==='charizard-dragonite-loop-turn14');
  assert.deepEqual(entry.loopHp,[51,50,50,48,61]);
  assert.equal(entry.recordedRecommendation.objective,'finish-current-opponent');
  const o=observed('charizard-dragonite-loop-turn14'),b=o.playerMemory.battle;
  const healed=battleModel.trainerHealBeforeMove({battle:battleModel.battleDecisionState(o.playerMemory,o.playerMemory.ui)});
  assert.equal(healed?.hp,b.opponent.maxHp);
  const finish=finisher(o);
  assert.ok(finish===null||finish.estimatedMinimumDamage>=b.opponent.maxHp,JSON.stringify(finish));
  assert.notEqual(finish?.moveId,WING_ATTACK);
  assert.notEqual(advise(o)?.objective,'finish-current-opponent');
  const move=advise(moveStage(observed('charizard-dragonite-loop-turn14')));
  assert.notEqual(move?.targetMoveId,WING_ATTACK,'not the weaker high-PP move: '+JSON.stringify(move));
  // On a turn the Champion attacks, the same state is finished as before.
  const attacking=observed('charizard-dragonite-loop-turn14');attacking.playerMemory.battle.chosenActions=[255,0,255,255];
  assert.equal(finisher(attacking)?.moveId,WING_ATTACK);
});
