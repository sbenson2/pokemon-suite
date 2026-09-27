import test from 'node:test';
import assert from 'node:assert/strict';
import {directTrainingPlan} from '../src/player/battle-model.js';

const mechanics={species:{93:{types:['TYPE_GHOST','TYPE_POISON']},90:{types:['TYPE_WATER']},17:{types:['TYPE_NORMAL','TYPE_FLYING']}},
  moves:{101:{id:101,type:'TYPE_GHOST',power:1,accuracy:100,effect:'EFFECT_LEVEL_DAMAGE'},
    138:{id:138,type:'TYPE_PSYCHIC',power:100,accuracy:100,effect:'EFFECT_DREAM_EATER'},
    33:{id:33,type:'TYPE_NORMAL',power:35,accuracy:95,effect:'EFFECT_HIT'}},
  typeChart:[{attackingType:'TYPE_GHOST',defendingType:'TYPE_NORMAL',multiplier:0},
    {attackingType:'TYPE_NORMAL',defendingType:'TYPE_GHOST',multiplier:0}]};
const member={species:93,level:51,hp:100,maxHp:124,status1:0,moves:[138,101],pp:[15,15],
  stats:{attack:63,defense:74,spAttack:126,spDefense:74}};
const opponent={species:90,level:30,hp:70,maxHp:70,status1:0,moves:[33],pp:[35],
  stats:{attack:50,defense:70,spAttack:30,spDefense:30}};
const plan=(a={},b={})=>directTrainingPlan({mechanics,member:{...member,...a},opponent:{...opponent,...b}});

test('a capable Haunter uses its fixed-damage attack without needing a sleep partner',()=>{
  assert.equal(plan()?.moveId,101);
  assert.equal(plan()?.turns,2,'Night Shade is 51 HP, not multiplied by STAB');
  assert.equal(plan({}, {hp:103,maxHp:103}),null,'three hits do not qualify for short direct training');
});
test('level advantage cannot overcome Normal immunity or Dream Eater prerequisites',()=>{
  assert.equal(plan({}, {species:17}),null);
  assert.equal(plan({moves:[138],pp:[15]}),null);
});
test('direct training requires enough PP, known incoming attacks and a healthy awake trainee',()=>{
  for(const patch of [{pp:[15,1]},{hp:25},{status1:2},{status2:1}])assert.equal(plan(patch),null);
  assert.equal(plan({}, {moves:undefined}),null);
});
