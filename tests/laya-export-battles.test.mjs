import test from 'node:test';
import assert from 'node:assert/strict';
import {battleNames,exportRecord,exportTapes,ROW_SCHEMA} from '../scripts/laya-export-battles.mjs';

// Battle tapes become Laya rows: a readable state, one choice question over
// every legal action, and the advisor's own choice as the label.
const mechanics={species:[{id:6,name:'SPECIES_CHARIZARD'},{id:22,name:'SPECIES_FEAROW'},{id:55,name:'SPECIES_GOLDUCK'},{id:25,name:'SPECIES_PIKACHU'}],
 moves:[{id:53,name:'MOVE_FLAMETHROWER'},{id:163,name:'MOVE_SLASH'},{id:89,name:'MOVE_EARTHQUAKE'}]};
const names=battleNames(mechanics);
const record=(changes={})=>({schema:'pokemon-suite/battle-turn/v1',frame:900,map:'MAP_POKEMON_LEAGUE_CHAMPIONS_ROOM',battleTypeFlags:8,
 player:{species:6,level:75,hp:180,maxHp:220,status1:0,types:['TYPE_FIRE','TYPE_FLYING'],moves:[53,163,89],pp:[10,0,5]},playerPartySlot:0,
 opponents:[{species:55,level:50,hp:60,maxHp:150,status1:64,types:['TYPE_WATER']}],
 party:[{slot:0,species:6,level:75,hp:180,maxHp:220},{slot:1,species:22,level:60,hp:120,maxHp:160},{slot:2,species:25,level:40,hp:0,maxHp:90}],
 options:[{moveId:53,moveSlot:0,score:0.4}],choice:{kind:'move',moveId:89,moveSlot:2,objective:null},advisor:'battle',reason:'battle',...changes});

test('names come from the battle knowledge',()=>{
 assert.equal(names.species(6),'Charizard');assert.equal(names.move(53),'Flamethrower');assert.equal(names.type('TYPE_WATER'),'Water');
 assert.equal(names.species(999),'Pokémon #999');
});

test('a recorded move becomes a choice over every legal action, labelled with the advisor’s pick',()=>{
 const {row}=exportRecord(record(),names,'tape.ndjson');
 assert.equal(row.schema,ROW_SCHEMA);
 assert.deepEqual(row.questions[0].options,['Use Flamethrower','Use Earthquake','Switch to Fearow'],
  'no zero-PP move, no fainted switch, and no Run in a trainer battle');
 assert.equal(row.questions[0].options[row.label.action],'Use Earthquake');
 assert.match(row.state,/^You: Charizard L75 HP 180\/220 Fire\/Flying$/m);
 assert.match(row.state,/^Moves: Flamethrower \(PP 10\), Slash \(PP 0\), Earthquake \(PP 5\)$/m);
 assert.match(row.state,/^Foe: Golduck L50 HP 60\/150 paralyzed Water$/m);
 assert.match(row.state,/^Bench: Fearow L60 120\/160, Pikachu L40 fainted$/m);
 assert.match(row.state,/Trainer battle\.$/);
 assert.equal(row.meta.source,'tape.ndjson');assert.equal(row.meta.context,'turn');
 const wild=exportRecord(record({battleTypeFlags:0,choice:{kind:'run',objective:null}}),names).row;
 assert.equal(wild.questions[0].options.at(-1),'Run');assert.equal(wild.label.action,wild.questions[0].options.length-1);
 const swap=exportRecord(record({choice:{kind:'switch',partySlot:1,species:22,objective:null}}),names).row;
 assert.equal(swap.questions[0].options[swap.label.action],'Switch to Fearow');
});

test('live battle memory types and stat stages read naturally',()=>{
 const live=exportRecord(record({player:{species:6,level:75,hp:180,maxHp:220,status1:0,types:[10,2],moves:[53],pp:[10],statStages:{attack:8,defense:6,speed:5,spAttack:6,spDefense:6,accuracy:6,evasion:6}},
  opponents:[{species:55,level:50,hp:60,maxHp:150,status1:0,types:[11,11]}],choice:{kind:'move',moveId:53,moveSlot:0,objective:null}}),names).row;
 assert.match(live.state,/^You: Charizard L75 HP 180\/220 Fire\/Flying Atk \+2 Spe -1$/m);
 assert.match(live.state,/^Foe: Golduck L50 HP 60\/150 Water$/m,'a single type is shown once');
});

test('a free shift offers keep or switch, and a forced replacement offers switches only',()=>{
 const shift=exportRecord(record({context:'shift',announcedOpponent:'DEWGONG',choice:{kind:'keep',objective:null}}),names).row;
 assert.deepEqual(shift.questions[0].options,['Keep Charizard in','Switch to Fearow']);assert.equal(shift.label.action,0);
 assert.match(shift.state,/The trainer is about to send out Dewgong\./);
 const forced=exportRecord(record({context:'forced',player:{species:6,level:75,hp:0,maxHp:220,moves:[53],pp:[10]},choice:{kind:'switch',partySlot:1,species:22,objective:null}}),names).row;
 assert.deepEqual(forced.questions[0].options,['Switch to Fearow']);
 assert.match(forced.state,/choose a replacement/);
 assert.deepEqual(exportRecord(record({context:'item-target',choice:{kind:'item-target',partySlot:0,objective:'restore-active-pokemon'}}),names),{skipped:'item'});
});

test('records that would leak or cannot be labelled are skipped',()=>{
 assert.deepEqual(exportRecord(record({choice:{kind:'item',itemId:19,objective:null}}),names),{skipped:'item'});
 assert.deepEqual(exportRecord(record({choice:{kind:'move',moveId:163,moveSlot:1,objective:null}}),names),{skipped:'choice-not-offered'},'a zero-PP move is not a legal option');
 assert.deepEqual(exportRecord({schema:'pokemon-suite/battle-turn/v1',truncated:true},names),{skipped:'not-a-turn'});
});

test('tapes export once per distinct row with a summary',()=>{
 const line=JSON.stringify(record());
 const {rows,summary}=exportTapes([{source:'a',text:[line,line,'{bad',JSON.stringify(record({choice:{kind:'item',itemId:19}}))].join('\n')}],names);
 assert.equal(rows.length,1);
 assert.deepEqual(summary,{rows:1,kinds:{move:1},skipped:{'bad-json':1,item:1}});
});
