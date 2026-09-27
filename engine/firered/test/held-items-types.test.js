import test from 'node:test';
import assert from 'node:assert/strict';
import catalog from '../src/data/move-catalog.js';
import {scoreBattleMoves,maximumCredibleIncomingDamage,captureMoveMaximumCriticalDamage,selectCapturePreparationMove} from '../src/player/battle-model.js';
import {battleMoveAccuracy} from '../src/player/battle-modifiers.js';
const types={3:['GRASS','POISON'],6:['FIRE','FLYING'],25:['ELECTRIC'],39:['NORMAL'],93:['GHOST','POISON'],105:['GROUND'],113:['NORMAL'],129:['WATER'],132:['NORMAL'],143:['NORMAL'],184:['WATER']};
const mechanics={moves:Object.fromEntries(catalog.moves.map(m=>[m.id,m])),species:Object.fromEntries(Object.entries(types).map(([id,ts])=>[id,{types:ts.map(t=>'TYPE_'+t)}])),typeChart:[
 {attackingType:'TYPE_NORMAL',defendingType:'TYPE_GHOST',multiplier:0},
 {attackingType:'TYPE_ELECTRIC',defendingType:'TYPE_GROUND',multiplier:0},
 {attackingType:'TYPE_ELECTRIC',defendingType:'TYPE_WATER',multiplier:20},
]};
const stats={attack:100,defense:100,spAttack:100,spDefense:100,speed:100};
const mon=(species,move=1,extra={})=>({species,level:50,hp:200,maxHp:200,stats,moves:[move],pp:[20],status1:0,status2:0,status3:0,ability:0,item:0,...extra});
const score=(p,o=mon(113))=>scoreBattleMoves({mechanics,player:p,opponent:o})[0];
for(const [name,p,item,expected] of [['Choice Band',mon(39),186,90],['Thick Club',mon(105,125),224,165.75],['Light Ball',mon(25,84),202,120],['Charcoal',mon(6,52),215,66]])test(`${name} changes the appropriate Gen III offensive stat`,()=>{
 assert.ok(Math.abs(score({...p,item}).score-expected)<1e-8);
});
test('species-restricted items and Gen III Light Ball do not boost the wrong attacks',()=>{
 assert.equal(score(mon(39,1,{item:224})).score,60);
 assert.equal(score(mon(25,1,{item:202})).score,40);
 assert.equal(score(mon(6,52,{item:186})).score,60);
 assert.equal(score(mon(39,1,{item:0,heldItem:186})).score,60,'observed consumed/removed battle item takes precedence');
 assert.equal(score({...mon(39),item:undefined,heldItem:186}).score,90,'party forecasts recognize heldItem');
});
test('capture weakening rejects a lethal critical hit boosted by a held item',()=>{
 const player=mon(105,125,{item:224}),opponent=mon(113,1,{hp:120});
 assert.equal(selectCapturePreparationMove({mechanics,player,opponent,selectableMoveSlots:new Set([0])}),null);
 assert.ok(captureMoveMaximumCriticalDamage({mechanics,player,opponent,move:mechanics.moves[125]})>=177);
});
test('BrightPowder and Lax Incense affect accuracy while Swift bypasses them',()=>{
 for(const [item,want]of [[179,.9],[221,.95]])assert.equal(battleMoveAccuracy({move:mechanics.moves[1],attacker:mon(39),defender:mon(113,1,{item})}),want);
 assert.equal(battleMoveAccuracy({move:mechanics.moves[129],attacker:mon(39),defender:mon(113,1,{item:179})}),1);
});
test('Foresight removes Ghost immunity for ordinary and fixed-damage attacks',()=>{
 assert.equal(score(mon(39),mon(93,1,{status2:1<<29})).effectiveness,1);
 assert.equal(score(mon(39),mon(93)).effectiveness,0);
});
test('capture bounds use changed target types and incoming bounds use changed STAB',()=>{
 assert.equal(captureMoveMaximumCriticalDamage({mechanics,player:mon(25,84),opponent:mon(129,1,{types:[4,4]}),move:mechanics.moves[84]}),0);
 assert.equal(maximumCredibleIncomingDamage({mechanics,attacker:mon(25,1,{types:[0,0]}),defender:mon(113)}),29);
});
for(const [name,p,o,want]of [
 ['Thick Fat',mon(6,52),mon(143,1,{ability:47}),30],
 ['Huge Power',mon(184,1,{ability:37}),mon(113),80],
 ['Reflect',mon(39),mon(113,1,{sideStatus:1}),30],
 ['Light Screen',mon(6,52),mon(113,1,{sideStatus:2}),30],
 ['Overgrow',mon(3,75,{ability:65,hp:60}),mon(113),117.5625],
])test(`${name} is included in move ranking`,()=>assert.ok(Math.abs(score(p,o).score-want)<1e-8));
test('a critical capture bound ignores screens but retains defender item effects',()=>{
 assert.equal(captureMoveMaximumCriticalDamage({mechanics,player:mon(39),opponent:mon(113,1,{sideStatus:1}),move:mechanics.moves[1]}),57);
 assert.ok(captureMoveMaximumCriticalDamage({mechanics,player:mon(39),opponent:mon(132,1,{item:223}),move:mechanics.moves[1]})<57);
});

import {heldItem,describeHeldItem,itemCatalog,heldItemEvents,heldCriticalStage} from '../src/player/held-items.js';
import {battleSpeed,battleTurnOrder} from '../src/player/battle-modifiers.js';
test('every native held effect has a trigger and unsupported custom berries remain unknown',()=>{
 for(const row of itemCatalog.items.filter(i=>!i.reserved))assert.equal(describeHeldItem(row.id).known,true,row.name);
 assert.equal(heldItem({item:175}).known,false);
 assert.equal(captureMoveMaximumCriticalDamage({mechanics,player:mon(39,1,{item:175}),opponent:mon(113),move:mechanics.moves[1]}),null);
});
test('held healing distinguishes Leftovers, Shell Bell, berries and zero HP',()=>{
 assert.deepEqual(heldItemEvents(mon(39,1,{hp:50,maxHp:160,item:200})),[{kind:'heal',amount:10,consume:false}]);
 assert.deepEqual(heldItemEvents(mon(39,1,{hp:50,maxHp:160,item:219}),{damageDealt:80}),[{kind:'heal',amount:10,consume:false}]);
 assert.equal(heldItemEvents(mon(39,1,{hp:0,item:200})).length,0);
 assert.ok(heldItemEvents(mon(39,1,{hp:50,item:139})).some(e=>e.kind==='heal'&&e.consume));
 assert.ok(heldItemEvents(mon(39,1,{status1:64,item:141})).some(e=>e.kind==='cure-status'&&e.consume));
});
test('Quick Claw remains uncertain and Macho Brace and paralysis change turn order',()=>{
 assert.equal(battleSpeed(mon(39,1,{item:181,status1:64})),12);
 assert.equal(battleTurnOrder({attacker:mon(39,1,{item:183,stats:{...stats,speed:40}}),defender:mon(113),move:mechanics.moves[1]}).firstChance,.2);
 assert.equal(battleTurnOrder({attacker:mon(39,1,{item:183,stats:{...stats,speed:40}}),defender:mon(113),move:mechanics.moves[1]}).guaranteed,false);
 assert.equal(heldCriticalStage(mon(113,1,{item:222})),2);
});
test('both Quick Claws share the native turn roll and can produce a speed tie',()=>{
 assert.equal(battleTurnOrder({attacker:mon(39,1,{item:183,stats:{...stats,speed:40}}),defender:mon(113,1,{item:183}),move:mechanics.moves[1]}).firstChance,.1);
});
test('party ability slots affect offensive forecasts and observed abilities override them',()=>{
 const m={...mechanics,species:{...mechanics.species,184:{types:['TYPE_WATER'],abilities:['ABILITY_THICK_FAT','ABILITY_HUGE_POWER']}}};
 const p=mon(184,1,{ability:undefined,abilityNum:1});
 assert.equal(scoreBattleMoves({mechanics:m,player:p,opponent:mon(113)})[0].score,80);
 assert.equal(scoreBattleMoves({mechanics:m,player:{...p,ability:0},opponent:mon(113)})[0].score,40);
});
test('weather suppression on another battler applies to damage and speed forecasts',()=>{
 assert.equal(scoreBattleMoves({mechanics,player:mon(6,52,{weatherSuppressed:true}),opponent:mon(113),weather:96})[0].score,60);
 assert.equal(battleSpeed(mon(39,1,{ability:33,battleWeather:1,weatherSuppressed:true})),100);
});
test('Brick Break removes screens before damage and Charge affects capture bounds',()=>{
 assert.equal(score(mon(39,280),mon(113,1,{sideStatus:1})).score,75);
 const player=mon(25,84,{status3:1<<9}),opponent=mon(113);
 assert.ok(captureMoveMaximumCriticalDamage({mechanics,player,opponent,move:mechanics.moves[84]})>=captureMoveMaximumCriticalDamage({mechanics,player:{...player,status3:0},opponent,move:mechanics.moves[84]})*1.9);
});
