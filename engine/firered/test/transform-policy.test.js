import test from 'node:test';
import assert from 'node:assert/strict';
import {describeMove,evaluateMoveUse} from '../src/player/move-knowledge.js';
import {battleDecisionState,selectSurvivalSupportMove} from '../src/player/battle-model.js';
import {createPolicyAdvisors} from '../src/player/advisors.js';
import {hasUsableAttackingPp} from '../src/player/recovery.js';

const moves=Object.fromEntries([33,144].map(id=>[id,describeMove(id)]));
const mechanics={moves,species:{132:{types:['TYPE_NORMAL']},19:{types:['TYPE_NORMAL']}}};
const stats={attack:65,defense:65,spAttack:65,spDefense:65,speed:65};
const ditto={slot:0,battler:0,species:132,personality:12,level:35,hp:100,maxHp:100,moves:[144,0,0,0],pp:[10,0,0,0],stats,status1:0,status2:0,status3:0};
const foe={battler:1,species:19,level:30,hp:75,maxHp:75,moves:[33,0,0,0],pp:[35,0,0,0],stats,status1:0,status2:0,status3:0};

for(const battleTypeFlags of [4,12])test(`a sole healthy Ditto selects Transform, then a copied attack with its native PP (battle ${battleTypeFlags})`,()=>{
 const advisor=createPolicyAdvisors({mechanics}).find(a=>a.id==='battle');
 const advise=player=>advisor.advise({captureId:'transform-test',frame:100,phase:'stable',emulator:{mode:'battle',inBattle:true,inputReady:true},
  playerMemory:{map:{id:'MAP_ROUTE15'},battleTypeFlags,trainer:{party:[ditto],usablePartyCount:1,bag:{}},
   battle:{player,opponent:foe,playerPartySlot:0,battlerPartyIndexes:[0,0],battlers:[player,foe]},
   ui:{battle:{stage:'move',battler:0,cursor:0,selectedMoveId:player.moves[0]}}}})?.recommendation;
 assert.equal(advise(ditto)?.targetMoveId,144);
 const transformed={...ditto,species:19,status2:1<<21,moves:[33,0,0,0],pp:[5,0,0,0]};
 assert.equal(advise(transformed)?.targetMoveId,33);
 assert.equal(advise({...transformed,pp:[0,0,0,0]})?.targetMoveId,undefined,'copied PP is authoritative');
});

test('field and league PP checks recognize Transform as preparation for attacking',()=>{
 assert.equal(hasUsableAttackingPp(ditto,mechanics),true);
 assert.equal(hasUsableAttackingPp({...ditto,pp:[0,0,0,0]},mechanics),false);
});

test('a sole Ditto can spend a turn while a trainer target is airborne, then Transform when it returns',()=>{
 const advisor=createPolicyAdvisors({mechanics}).find(a=>a.id==='battle');
 const o={captureId:'hidden-target',frame:1,phase:'stable',emulator:{mode:'battle',inBattle:true,inputReady:true},
  playerMemory:{map:{id:'MAP_ROUTE15'},battleTypeFlags:12,trainer:{party:[ditto],usablePartyCount:1,bag:{}},
   battle:{player:ditto,opponent:{...foe,status3:1<<6},playerPartySlot:0},ui:{battle:{stage:'move',battler:0,cursor:0,selectedMoveId:144}}}};
 assert.equal(advisor.advise(o)?.recommendation.targetMoveId,144,'the only legal move spends a turn; it does not pretend Transform can succeed yet');
 o.playerMemory.battle.opponent.status3=0;
 assert.equal(advisor.advise(o)?.recommendation.targetMoveId,144);
});

test('Transform rejects native failure states and never loops by copying another Transform',()=>{
 const choose=(player=ditto,opponent=foe)=>selectSurvivalSupportMove({mechanics,player,opponent,selectableMoveSlots:new Set([0])});
 assert.equal(choose()?.moveId,144);
 for(const opponent of [{...foe,status2:1<<21},{...foe,status3:1<<6},{...foe,status3:1<<7},{...foe,status3:1<<18},
   {...foe,moves:[144],pp:[10]},{...foe,status2:undefined},{...foe,status3:undefined}])assert.equal(choose(ditto,opponent),null);
 assert.equal(choose({...ditto,status2:1<<21}),null,'a copied Transform is not a productive plan');
 assert.equal(evaluateMoveUse({move:moves[144],attacker:ditto,defender:{...foe,status2:1<<24},mechanics}).usable,true,
  'Gen III Transform has no substitute check in its battle script');
});

test('a transformed battler retains its indexed party identity even beside the copied species',()=>{
 const player={...ditto,species:19,status2:1<<21,moves:[33],pp:[5]};
 const partner={...foe,battler:2};
 const state=battleDecisionState({battleTypeFlags:13,trainer:{party:[ditto,{slot:1,species:19}]},
  battle:{player,opponent:foe,battlers:[player,foe,partner],battlerPartyIndexes:[0,0,1],playerPartySlot:0}},
  {battle:{stage:'move',battler:0}});
 assert.equal(state.playerPartySlot,0);
 assert.deepEqual(state.activePlayerPartySlots,[0,1]);
});
