import assert from 'node:assert/strict';
import test from 'node:test';
import {scoreBattleMoves,selectSurvivalSupportMove,selectCapturePreparationMove,maximumCredibleIncomingDamage} from '../src/player/battle-model.js';

const moves={
  138:{id:138,name:'MOVE_DREAM_EATER',power:100,accuracy:100,type:'TYPE_PSYCHIC',effect:'EFFECT_DREAM_EATER'},
  325:{id:325,name:'MOVE_SHADOW_PUNCH',power:60,accuracy:0,type:'TYPE_GHOST',effect:'EFFECT_ALWAYS_HIT'},
  173:{id:173,power:40,accuracy:100,type:'TYPE_NORMAL',effect:'EFFECT_SNORE'},
  252:{id:252,power:40,accuracy:100,type:'TYPE_NORMAL',effect:'EFFECT_FAKE_OUT'},
  95:{id:95,power:0,accuracy:60,type:'TYPE_PSYCHIC',effect:'EFFECT_SLEEP'},
  73:{id:73,power:0,accuracy:90,type:'TYPE_GRASS',effect:'EFFECT_LEECH_SEED'},
  86:{id:86,power:0,accuracy:100,type:'TYPE_ELECTRIC',effect:'EFFECT_PARALYZE'},
};
const mechanics={moves,species:{93:{types:['TYPE_GHOST','TYPE_POISON']},72:{types:['TYPE_WATER','TYPE_POISON']}}};
const attacker={species:93,level:48,hp:107,maxHp:116,moves:[138,325],pp:[7,20],status1:0,status2:0,stats:{attack:60,spAttack:130}};
const defender={species:72,level:5,hp:19,maxHp:19,status1:0,status2:0,stats:{defense:10,spDefense:15}};
const rank=(a={},d={})=>scoreBattleMoves({mechanics,player:{...attacker,...a},opponent:{...defender,...d}});

test('Dream Eater is never chosen against an awake or unobserved target',()=>{
  for(const status1 of [0,8,16,32,64,128,undefined]) {
    const choices=rank({}, {status1});
    assert.equal(choices.some(m=>m.moveId===138),false,`status ${status1}`);
    assert.equal(choices[0].moveId,325);
  }
});
test('Dream Eater becomes usable only while the target sleeps without a substitute',()=>{
  assert.equal(rank({}, {status1:3})[0].moveId,138);
  assert.equal(rank({}, {status1:3,status2:1<<24}).some(m=>m.moveId===138),false);
  assert.equal(rank({}, {status1:0}).some(m=>m.moveId===138),false,'re-evaluate after waking');
});
test('Snore and Fake Out require the correct user state',()=>{
  const a={moves:[173,252,325],pp:[10,10,10],moveState:{isFirstTurn:false}};
  assert.deepEqual(rank(a).map(m=>m.moveId),[325]);
  assert.ok(rank({...a,status1:3}).some(m=>m.moveId===173));
  assert.ok(rank({...a,moveState:{isFirstTurn:true}}).some(m=>m.moveId===252));
  assert.equal(rank({...a,status1:1}).some(m=>m.moveId===173),false,'Snore fails after the user wakes this turn');
  assert.equal(rank({...a,status1:2,ability:48}).some(m=>m.moveId===173),false,'Early Bird removes two sleep turns');
});
test('support and capture decisions do not repeat conditions already applied or blocked by an ability',()=>{
  const player={...attacker,moves:[95,73,86],pp:[10,10,10]};
  const slots=new Set([0,1,2]);
  assert.equal(selectSurvivalSupportMove({mechanics,player,opponent:{...defender,status1:3,status3:4},selectableMoveSlots:slots}),null);
  assert.equal(selectCapturePreparationMove({mechanics,player:{...player,moves:[95]},opponent:{...defender,ability:15},selectableMoveSlots:slots}),null,'observed Insomnia');
});

test('variable-power moves use live friendship and HP instead of sentinel power',()=>{
  for(const [effect,patch,minimum] of [
    ['EFFECT_RETURN',{friendship:255},100],
    ['EFFECT_FRUSTRATION',{friendship:0},100],
    ['EFFECT_FLAIL',{hp:1,maxHp:100},190],
    ['EFFECT_ERUPTION',{hp:100,maxHp:100},140],
  ]) {
    const m={...mechanics,moves:{1:{id:1,effect,power:1,accuracy:100,type:'TYPE_NORMAL'}}};
    const result=scoreBattleMoves({mechanics:m,player:{...attacker,moves:[1],pp:[10],stats:{attack:100,spAttack:100},...patch},opponent:{...defender,stats:{defense:100,spDefense:100}}});
    assert.ok(result[0]?.score>=minimum,effect);
  }
});

test('Spit Up and Focus Punch cannot assume their prerequisites',()=>{
  for(const effect of ['EFFECT_SPIT_UP','EFFECT_FOCUS_PUNCH']) {
    const m={...mechanics,moves:{1:{id:1,effect,power:effect==='EFFECT_SPIT_UP'?100:150,accuracy:100,type:'TYPE_NORMAL'}}};
    assert.deepEqual(scoreBattleMoves({mechanics:m,player:{...attacker,moves:[1],pp:[10],moveState:{stockpileCount:0}},opponent:defender}),[],effect);
  }
});

test('sleep-dependent moves are not treated as unconditional upgrades when learning',async()=>{
  const {moveLearningReadiness}=await import('../src/player/move-knowledge.js');
  assert.equal(moveLearningReadiness({move:moves[138],pokemon:attacker,mechanics}).usable,false);
  assert.equal(moveLearningReadiness({move:moves[138],pokemon:{...attacker,moves:[95,325]},mechanics}).usable,true);
});

test('incoming threat estimates distinguish impossible Dream Eater from a sleeping target',()=>{
  const source={...attacker,moves:[138],pp:[10]};
  assert.equal(maximumCredibleIncomingDamage({mechanics,attacker:source,defender}),0);
  assert.ok(maximumCredibleIncomingDamage({mechanics,attacker:source,defender:{...defender,status1:3}})>0);
  assert.equal(maximumCredibleIncomingDamage({mechanics,attacker:source,defender:{...defender,status1:undefined}}),null,'unknown sleep cannot prove safety');
});

test('survival bounds account for Flail becoming stronger after damage',()=>{
  const m={...mechanics,moves:{175:{id:175,power:1,accuracy:100,type:'TYPE_NORMAL',effect:'EFFECT_FLAIL'}}};
  const source={...attacker,moves:[175],pp:[10],hp:116};
  assert.equal(maximumCredibleIncomingDamage({mechanics:m,attacker:source,defender}),maximumCredibleIncomingDamage({mechanics:m,attacker:{...source,hp:1},defender}));
});

test('every FireRed move has an explicit rule classification and unknown effects are rejected',async()=>{
  const {moveCatalog,describeMove,evaluateMoveUse}=await import('../src/player/move-knowledge.js');
  assert.deepEqual(moveCatalog.moves.map(m=>m.id),Array.from({length:354},(_,i)=>i+1));
  assert.equal(new Set(moveCatalog.moves.map(m=>m.effect)).size,198);
  for(const m of moveCatalog.moves){
    const rule=describeMove(m);assert.equal(rule.known,true,m.name);
    assert.ok(['damage','support','requires-plan'].includes(rule.planning),m.name);
    assert.ok(m.type&&m.target&&Number.isInteger(m.pp)&&Number.isInteger(m.accuracy),m.name);
  }
  assert.equal(evaluateMoveUse({move:{id:999,effect:'EFFECT_UNKNOWN',power:200},attacker,defender}).usable,false);
});

test('generation-three status immunities, substitutes, stat limits and safe stockpiling are explicit',async()=>{
  const {evaluateMoveUse}=await import('../src/player/move-knowledge.js');
  const use=(effect,a={},t={})=>evaluateMoveUse({move:{effect,power:0,type:'TYPE_NORMAL'},attacker:{...attacker,...a},defender:{...defender,...t},mechanics}).usable;
  for(const ability of [15,72])assert.equal(use('EFFECT_SLEEP',{}, {ability}),false);
  assert.equal(use('EFFECT_SLEEP',{}, {types:['TYPE_GRASS']}),true,'Gen III has no Grass powder immunity');
  assert.equal(use('EFFECT_SLEEP',{}, {sideStatus:32}),false);
  assert.equal(use('EFFECT_POISON',{}, {types:['TYPE_STEEL']}),false);
  assert.equal(use('EFFECT_POISON',{}, {ability:17}),false);
  assert.equal(use('EFFECT_PARALYZE',{}, {ability:7}),false);
  assert.equal(use('EFFECT_PARALYZE',{}, {types:['TYPE_ELECTRIC']}),true,'Gen III Electric types can be paralyzed');
  assert.equal(use('EFFECT_WILL_O_WISP',{}, {types:['TYPE_FIRE']}),false);
  assert.equal(use('EFFECT_CONFUSE',{}, {ability:20}),false);
  assert.equal(use('EFFECT_CONFUSE',{}, {status2:1<<24}),false);
  assert.equal(use('EFFECT_RESTORE_HP',{hp:116}),false);
  assert.equal(use('EFFECT_DEFENSE_DOWN',{}, {statStages:{defense:0}}),false);
  assert.equal(use('EFFECT_DEFENSE_DOWN',{}, {ability:29}),false);
  assert.equal(use('EFFECT_ATTACK_UP',{statStages:{attack:12}}),false);
  assert.equal(use('EFFECT_SWALLOW',{moveState:{stockpileCount:0}}),false);
  assert.equal(use('EFFECT_SWALLOW',{moveState:{stockpileCount:2}}),true);
  assert.equal(use('EFFECT_STOCKPILE',{moveState:{stockpileCount:3}}),false);
});
