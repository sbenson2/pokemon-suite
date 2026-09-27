import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,readFileSync,rmSync,statSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {BATTLE_TAPE_SCHEMA,battleTapeFromEnvironment,battleTurnRecord,createBattleTape} from '../src/player/battle-tape.js';
import {createPolicyAdvisors} from '../src/player/advisors.js';
import {createCentralPlayer} from '../src/player/delegator.js';

// Laya L2 groundwork: an opt-in record of each battle choice with the facts the
// advisor saw and its scored move options. It is off unless a tape path is
// given and never changes a decision.
const mechanics={
 species:{1:{types:['TYPE_NORMAL']},2:{types:['TYPE_NORMAL']},4:{types:['TYPE_FIRE']}},
 moves:{1:{id:1,power:40,accuracy:100,type:'TYPE_NORMAL'},2:{id:2,power:90,accuracy:100,type:'TYPE_FIRE'},3:{id:3,power:0,accuracy:100,type:'TYPE_NORMAL'}},
};
const active={battler:0,species:4,level:30,hp:70,maxHp:90,status1:0,moves:[1,2,3],pp:[30,15,20],stats:{attack:60,spAttack:70},types:['TYPE_FIRE']};
const foe={battler:1,species:2,level:28,hp:40,maxHp:80,status1:0,stats:{defense:50,spDefense:50},types:['TYPE_NORMAL']};
function observation({ui={battle:{stage:'move',battler:0,cursor:1,selectedMoveId:2}},mode='battle',frame=500,player=active,opponent=foe}={}){
 const captureId='capture-'+frame;
 return {captureId,frame,phase:'stable',phaseReasons:[],emulator:{captureId,frame,mode,inputReady:true,callback2:mode==='battle'?'CB2_BattleMain':'CB2_Overworld'},
  sram:{captureId,frame,sha256:'sram'},
  playerMemory:{captureId,frame,sha256:'memory',map:{id:'MAP_ROUTE4'},position:{x:1,y:1},battleTypeFlags:0,
   trainer:{usablePartyCount:2,party:[{slot:0,species:4,level:30,hp:player.hp,maxHp:90,status:0},{slot:1,species:1,level:25,hp:0,maxHp:60,status:0}]},
   battle:mode==='battle'?{player,opponent,battlers:[player,opponent],battlerPartyIndexes:[0,0],playerPartySlot:0}:null,
   ui:{battle:null,party:null,fieldDialog:null,choiceMenu:null,startMenu:null,saveDialog:null,moveLearning:null,levelUp:null,evolution:null,blackout:null,newGame:null,...ui}}};
}
const decided=recommendation=>({kind:'act',reason:'battle',winner:{advisor:'battle',recommendation}});

test('a battle move choice records the facts, the scored options and the choice',()=>{
 const record=battleTurnRecord({observation:observation(),decision:decided({kind:'choose-battle-move',targetMoveId:2,targetMoveSlot:1,objective:'win'}),mechanics});
 assert.equal(record.schema,BATTLE_TAPE_SCHEMA);
 assert.equal(record.frame,500);assert.equal(record.map,'MAP_ROUTE4');
 assert.deepEqual(record.player,{species:4,level:30,hp:70,maxHp:90,status1:0,types:['TYPE_FIRE'],moves:[1,2,3],pp:[30,15,20],stats:{attack:60,spAttack:70}});
 assert.deepEqual(record.opponents.map(o=>[o.species,o.hp,o.maxHp]),[[2,40,80]]);
 assert.deepEqual(record.party.map(p=>[p.slot,p.species,p.hp]),[[0,4,70],[1,1,0]]);
 assert.deepEqual(record.options.map(o=>o.moveId),[2,1],'damaging moves, best first; a status move has no damage score');
 assert.ok(record.options[0].score>record.options[1].score);
 assert.deepEqual(record.choice,{kind:'move',moveId:2,moveSlot:1,objective:'win'});
 assert.equal(record.advisor,'battle');
});

test('only final battle choices are recorded: a move, a switch, an item or running',()=>{
 const at=(recommendation,options)=>battleTurnRecord({observation:observation(options),decision:decided(recommendation),mechanics});
 assert.deepEqual(at({kind:'choose-party-member',targetPartySlot:1,targetSpecies:1},{ui:{party:{stage:'choose-pokemon'}}}).choice,{kind:'switch',partySlot:1,species:1,objective:null});
 assert.deepEqual(at({kind:'choose-bag-item',targetItemId:13},{ui:{bag:{stage:'list'}}}).choice,{kind:'item',itemId:13,objective:null});
 assert.deepEqual(at({kind:'choose-battle-command',targetCommand:'run'},{ui:{battle:{stage:'action',battler:0}}}).choice,{kind:'run',objective:null});
 for(const command of ['fight','bag','pokemon'])assert.equal(at({kind:'choose-battle-command',targetCommand:command}),null,command);
 assert.equal(at({kind:'acknowledge-cartridge-prompt'}),null);
 assert.equal(at({kind:'choose-party-member',targetPartySlot:1},{mode:'overworld'}),null,'field menus are not battles');
 assert.equal(battleTurnRecord({observation:observation(),decision:{kind:'resample',winner:null},mechanics}),null);
});

test('each choice carries its context: a turn, a free shift, a forced replacement or an item target',()=>{
 const at=(recommendation,options)=>battleTurnRecord({observation:observation(options),decision:decided(recommendation),mechanics});
 assert.equal(at({kind:'choose-battle-move',targetMoveId:2,targetMoveSlot:1}).context,'turn');
 const announced={...foe,hp:0};
 const shift={ui:{party:{stage:'choose-pokemon'}},opponent:announced};
 const withAnnouncement=options=>{const o=observation(options);o.playerMemory.battle.announcedOpponentName='DEWGONG';return o;};
 const keep=battleTurnRecord({observation:withAnnouncement(shift),decision:decided({kind:'retain-active-pokemon',announcedOpponentName:'DEWGONG'}),mechanics});
 assert.deepEqual([keep.context,keep.choice.kind,keep.announcedOpponent],['shift','keep','DEWGONG']);
 // The shift is decided at the yes/no prompt; the party menu after a yes is not a second choice.
 const prompt={ui:{choiceMenu:{selected:'yes'}},opponent:announced};
 const swap=battleTurnRecord({observation:withAnnouncement(prompt),decision:decided({kind:'choose-menu-option',targetOption:'yes',targetPartySlot:1,targetSpecies:1,objective:'counter-announced-opponent'}),mechanics});
 assert.deepEqual([swap.context,swap.choice],['shift',{kind:'switch',partySlot:1,species:1,objective:'counter-announced-opponent'}]);
 const stay=battleTurnRecord({observation:withAnnouncement(prompt),decision:decided({kind:'choose-menu-option',targetOption:'no'}),mechanics});
 assert.deepEqual([stay.context,stay.choice],['shift',{kind:'keep',objective:null}]);
 assert.equal(battleTurnRecord({observation:withAnnouncement(shift),decision:decided({kind:'choose-party-member',targetPartySlot:1,targetSpecies:1,objective:'counter-announced-opponent'}),mechanics}),null);
 assert.equal(at({kind:'choose-menu-option',targetOption:'no'},{ui:{choiceMenu:{selected:'no'}}}),null,'other yes/no prompts are not battle choices');
 assert.equal(at({kind:'retain-active-pokemon'},{ui:{party:{stage:'selection-menu'}}}),null,'retaining outside a shift is a menu correction');
 const fainted=at({kind:'choose-party-member',targetPartySlot:1,targetSpecies:1},{ui:{party:{stage:'choose-pokemon'}},player:{...active,hp:0}});
 assert.deepEqual([fainted.context,fainted.choice.kind],['forced','switch']);
 const potion=at({kind:'choose-party-member',targetPartySlot:0,targetSpecies:4,objective:'restore-active-pokemon'},{ui:{party:{stage:'choose-pokemon',itemId:22}}});
 assert.deepEqual([potion.context,potion.choice],['item-target',{kind:'item-target',partySlot:0,objective:'restore-active-pokemon'}]);
});

test('the tape appends one line per new choice, skips repeats, and stops at its size cap',()=>{
 const directory=mkdtempSync(join(tmpdir(),'battle-tape-'));
 try{
  const path=join(directory,'tape.ndjson'),tape=createBattleTape(path);
  const move=battleTurnRecord({observation:observation(),decision:decided({kind:'choose-battle-move',targetMoveId:2,targetMoveSlot:1}),mechanics});
  tape(move);tape({...move,frame:501});
  tape(battleTurnRecord({observation:observation({frame:900,player:{...active,pp:[30,14,20]}}),decision:decided({kind:'choose-battle-move',targetMoveId:2,targetMoveSlot:1}),mechanics}));
  const lines=readFileSync(path,'utf8').trim().split('\n').map(line=>JSON.parse(line));
  assert.deepEqual(lines.map(line=>line.frame),[500,900],'the same choice in the same state is written once; a new turn is new');
  const capped=join(directory,'capped.ndjson'),small=createBattleTape(capped,{maxBytes:1});
  small(move);small({...move,player:{...move.player,hp:1}});
  const written=readFileSync(capped,'utf8').trim().split('\n').map(line=>JSON.parse(line));
  assert.deepEqual(written.map(line=>line.truncated??false),[false,true]);
  assert.equal(statSync(capped).size,readFileSync(capped).length);
 }finally{rmSync(directory,{recursive:true,force:true});}
});

test('the tape is off unless POKEMON_SUITE_BATTLE_TAPE names a file',()=>{
 assert.equal(battleTapeFromEnvironment({}),null);
 assert.equal(battleTapeFromEnvironment({POKEMON_SUITE_BATTLE_TAPE:''}),null);
 assert.equal(typeof battleTapeFromEnvironment({POKEMON_SUITE_BATTLE_TAPE:join(tmpdir(),'unused.ndjson')}),'function');
});

test('the central player makes the same decision with or without a tape',()=>{
 const records=[];
 const make=battleTape=>createCentralPlayer({advisors:createPolicyAdvisors({mechanics}),mechanics,battleTape});
 const plain=make(null).decide(observation()),taped=make(record=>records.push(record)).decide(observation());
 assert.deepEqual(taped,plain);
 assert.equal(plain.winner?.recommendation?.kind,'choose-battle-move');
 assert.equal(records.length,1);assert.equal(records[0].choice.moveId,plain.winner.recommendation.targetMoveId);
 const failing=make(()=>{throw new Error('disk full');}).decide(observation());
 assert.deepEqual(failing,plain,'a failing tape never changes or stops a decision');
});
