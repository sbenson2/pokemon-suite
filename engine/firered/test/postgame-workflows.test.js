import test from 'node:test';
import assert from 'node:assert/strict';
import {resolvePostgameObjective} from '../src/suite/postgame-agenda.js';
import {readPostgameEvidence} from '../src/suite/postgame-agenda.js';
import {createPostgameController} from '../src/suite/postgame.js';
import {observeTrainerTower} from '../src/suite/postgame-workflows.js';
const mon=(slot=0)=>({slot,species:9,personality:slot+100,otId:10,validity:'valid',shiny:false,isEgg:false,hp:100,maxHp:100,status1:0,friendship:255,moves:[57,70],pp:[15,15],ivs:{hp:1,attack:2,defense:3,speed:4,spAttack:5,spDefense:6}});
const observe=()=>({phase:'stable',frame:100,emulator:{mode:'overworld',inBattle:false,inputReady:true},sram:{sha256:'a'.repeat(64)},playerMemory:{map:{id:'MAP_FIVE_ISLAND_WATER_LABYRINTH'},position:{x:1,y:1},ui:{},storyState:{flagIds:{2092:true,2112:true,2116:true,730:false,731:false},variableIds:{0x4082:0,0x400e:0,0x400f:1}},gameStats:{savedGame:10},trainer:{partyValidity:'valid',party:[mon()],pokedex:{ownedSpecies:[9]},storage:{validity:'valid',pokemon:[],boxCounts:Array(14).fill(0)},money:10000,bag:{}},postgameEvidence:{trainerTower:Array.from({length:4},(_,i)=>({challenge:i,receivedPrize:false,floorsCleared:0,hasLost:false}))}}});
const world={data:{maps:[
 {id:'MAP_FIVE_ISLAND_WATER_LABYRINTH',objectEvents:[{script:'FiveIsland_WaterLabyrinth_EventScript_EggGentleman'}]},
 {id:'MAP_CELADON_CITY_DEPARTMENT_STORE_ROOF',backgroundEvents:[{script:'CeladonCity_DepartmentStore_Roof_EventScript_VendingMachine'}]},
 {id:'MAP_FIVE_ISLAND_MEMORIAL_PILLAR',backgroundEvents:[{script:'FiveIsland_MemorialPillar_EventScript_Memorial'}]},
 {id:'MAP_TRAINER_TOWER_LOBBY',objectEvents:[{script:'TrainerTower_Lobby_EventScript_Nurse'}],coordEvents:[{script:'TrainerTower_Lobby_EventScript_EntryTrigger',x:9,y:7}]},
 {id:'MAP_TRAINER_TOWER_1F',coordEvents:[{script:'TrainerTower_EventScript_SingleBattleTrigger',x:10,y:13},{script:'TrainerTower_EventScript_DoubleBattleTriggerBottom',x:9,y:13}]},
 {id:'MAP_TRAINER_TOWER_ROOF',objectEvents:[{script:'TrainerTower_EventScript_Owner'}]},
]}};
const mechanics={data:{moves:[{id:57,pp:15},{id:70,pp:15}]}};

test('Togepi raises real friendship, selects that lead, frees a slot, then receives its single native Egg',()=>{
 const o=observe(),state={};o.playerMemory.trainer.party[0].friendship=254;
 let d=resolvePostgameObjective('togepi',o,world,state,{mechanics});assert.equal(d.target.kind,'friendship-walk');
 o.playerMemory.trainer.party=[mon(),mon(1)];o.playerMemory.trainer.party[0].friendship=50;
 d=resolvePostgameObjective('togepi',o,world,state,{mechanics});assert.equal(d.target.kind,'lead-party-member');
 o.playerMemory.trainer.party=Array.from({length:6},(_,i)=>mon(i));
 d=resolvePostgameObjective('togepi',o,world,state,{mechanics});assert.equal(d.target.kind,'party-roster');assert.equal(d.target.maximumPartySize,5);
 o.playerMemory.trainer.party.pop();
 d=resolvePostgameObjective('togepi',o,world,state,{mechanics});assert.equal(d.target.kind,'object');assert.equal(d.target.index,0);
});

test('a Togepi Egg stays identified across hatch and restart and needs a native save before handoff',()=>{
 const o=observe();o.playerMemory.storyState.flagIds[730]=true;
 const egg={...mon(1),species:175,isEgg:true};o.playerMemory.trainer.party.push(egg);
 let state={},d=resolvePostgameObjective('togepi',o,world,state,{mechanics});assert.equal(d.target.kind,'friendship-walk');
 state=structuredClone(state);egg.isEgg=false;o.playerMemory.trainer.pokedex.ownedSpecies.push(175);
 d=resolvePostgameObjective('togepi',o,world,state,{mechanics});assert.equal(d.target.kind,'save-game');
 o.playerMemory.gameStats.savedGame++;o.playerMemory.saveAttemptStatus=1;o.sram.sha256='b'.repeat(64);
 assert.equal(resolvePostgameObjective('togepi',o,world,state,{mechanics}),null);
 assert.equal(state.togepi.receipt.nativeSaveVerified,true);
});

test('Memorial Pillar obtains Lemonade from the native vending machine before the tribute',()=>{
 const o=observe();o.playerMemory.map.id='MAP_CELADON_CITY_DEPARTMENT_STORE_ROOF';
 let d=resolvePostgameObjective('memorial-pillar',o,world,{},{});
 assert.equal(d.target.kind,'background');assert.equal(d.choiceByRows[4],2);
 o.playerMemory.trainer.bag.items=[{itemId:28,quantity:1}];o.playerMemory.map.id='MAP_FIVE_ISLAND_MEMORIAL_PILLAR';
 d=resolvePostgameObjective('memorial-pillar',o,world,{},{});assert.equal(d.target.map,o.playerMemory.map.id);
});

test('Trainer Tower follows its native selected mode and floor clear counters through restart',()=>{
 const o=observe();o.playerMemory.trainer.party.push(mon(1));o.playerMemory.map.id='MAP_TRAINER_TOWER_LOBBY';let state={};
 let d=resolvePostgameObjective('trainer-tower',o,world,state,{mechanics});assert.equal(d.target.kind,'walk-to');assert.deepEqual(d.choiceByRows,{3:0,5:0});
 o.playerMemory.postgameEvidence.trainerTower[0].receivedPrize=true;
 state={};d=resolvePostgameObjective('trainer-tower',o,world,state,{mechanics});assert.equal(d.choiceByRows[5],1);
 o.playerMemory.storyState.variableIds[0x4082]=1;o.playerMemory.map.id='MAP_TRAINER_TOWER_1F';
 o.playerMemory.postgameEvidence.trainerTowerChallenge=1;o.playerMemory.storyState.variableIds[0x400e]=1;o.playerMemory.storyState.variableIds[0x400f]=0;
 state=structuredClone(state);d=resolvePostgameObjective('trainer-tower',o,world,state,{mechanics});assert.equal(d.target.kind,'walk-to');assert.equal(d.target.x,9);
 o.playerMemory.postgameEvidence.trainerTower[1].floorsCleared=1;
 d=resolvePostgameObjective('trainer-tower',o,world,state,{mechanics});assert.equal(d.target.map,'MAP_TRAINER_TOWER_2F');
});

test('Trainer Tower preserves each same-roster defeat and tries unattempted native modes',()=>{
 const o=observe(),state={};
 o.playerMemory.map.id='MAP_TRAINER_TOWER_LOBBY';
 o.playerMemory.trainer.party=Array.from({length:6},(_,i)=>({...mon(i),species:[150,149,67,53,55,3][i],level:86}));
 o.playerMemory.postgameEvidence.trainerTower[0].receivedPrize=true;
 const choose=()=>resolvePostgameObjective('trainer-tower',o,world,state,{mechanics});
 const lose=mode=>{
  o.playerMemory.map.id='MAP_TRAINER_TOWER_2F';
  o.playerMemory.postgameEvidence.trainerTowerChallenge=mode;
  o.playerMemory.storyState.variableIds[0x4082]=1;
  o.emulator.inBattle=true;o.playerMemory.battleOutcome=0;
  observeTrainerTower(o,state);
  o.emulator.inBattle=false;o.playerMemory.battleOutcome=2;
  o.frame++;observeTrainerTower(o,state);
  o.playerMemory.map.id='MAP_TRAINER_TOWER_LOBBY';
  o.playerMemory.storyState.variableIds[0x4082]=0;
  o.playerMemory.battleOutcome=1;
 };
 assert.equal(choose().choiceByRows[5],1);
 lose(1);
 assert.equal(choose().choiceByRows[5],2,'Double loss must not block Knockout');
 lose(2);
 const restarted=structuredClone(state);
 assert.deepEqual(Object.keys(restarted.tower.defeats).sort(),['1','2']);
 assert.equal(resolvePostgameObjective('trainer-tower',o,world,restarted,{mechanics}).choiceByRows[5],3,
  'a restarted controller may still attempt Mixed');
 state.tower=restarted.tower;
 lose(3);
 assert.equal(choose().target.kind,'stop-for-review','all three unchanged-team defeats block repeated attempts');
 assert.deepEqual(Object.keys(state.tower.defeats).sort(),['1','2','3']);
 o.playerMemory.trainer.party[0].moves=[89];
 assert.equal(choose().choiceByRows[5],1,'a changed team can retry its earliest pending mode');
 assert.deepEqual(Object.keys(state.tower.defeats).sort(),['1','2','3'],
  'new eligibility does not erase previous native defeat proof');
 lose(1);
 assert.equal(state.tower.defeats[1].length,2,'separate team versions retain separate defeat proofs');
 o.playerMemory.trainer.party[0].moves=[57,70];
 assert.equal(choose().target.kind,'stop-for-review','returning to a previously defeated team does not reset protection');
});

test('a cleared Tower floor returns to the lobby nurse before the next battle when HP or PP is spent',()=>{
 const o=observe(),state={};
 o.playerMemory.trainer.party=[mon(),mon(1)];
 o.playerMemory.map.id='MAP_TRAINER_TOWER_1F';
 o.playerMemory.storyState.variableIds[0x4082]=1;
 o.playerMemory.postgameEvidence.trainerTowerChallenge=1;
 o.playerMemory.postgameEvidence.trainerTower[0].receivedPrize=true;
 o.playerMemory.postgameEvidence.trainerTower[1].floorsCleared=1;
 o.playerMemory.trainer.party[0].hp=80;
 let d=resolvePostgameObjective('trainer-tower',o,world,state,{mechanics});
 assert.deepEqual(d.target,{kind:'object',map:'MAP_TRAINER_TOWER_LOBBY',index:0});
 o.playerMemory.trainer.party[0].hp=100;
 o.playerMemory.trainer.party[0].pp[0]=14;
 d=resolvePostgameObjective('trainer-tower',o,world,state,{mechanics});
 assert.deepEqual(d.target,{kind:'object',map:'MAP_TRAINER_TOWER_LOBBY',index:0});
 o.playerMemory.trainer.party[0].pp[0]=15;
 d=resolvePostgameObjective('trainer-tower',o,world,state,{mechanics});
 assert.equal(d.target.map,'MAP_TRAINER_TOWER_2F');
 o.playerMemory.map.id='MAP_TRAINER_TOWER_8F';
 o.playerMemory.postgameEvidence.trainerTower[1].floorsCleared=7;
 o.playerMemory.trainer.party[0].hp=80;
 d=resolvePostgameObjective('trainer-tower',o,world,state,{mechanics});
 assert.equal(d.target.map,'MAP_TRAINER_TOWER_LOBBY','recover before the final battle too');
 o.playerMemory.postgameEvidence.trainerTower[1].floorsCleared=8;
 d=resolvePostgameObjective('trainer-tower',o,world,state,{mechanics});
 assert.equal(d.target.map,'MAP_TRAINER_TOWER_ROOF','the completed final battle does not require another nurse trip');
 o.playerMemory.trainer.party=Array.from({length:6},(_,i)=>({...mon(i),hp:i<3?0:100}));
 d=resolvePostgameObjective('trainer-tower',o,world,state,{mechanics});
 assert.equal(d.target.map,'MAP_TRAINER_TOWER_ROOF','low ready count after 8F clear must not delay the prize');
});

test('Trainer Tower prepares a balanced saved roster instead of scaling five members to one level-100 outlier',()=>{
 const o=observe(),state={};
 const teamPlan={permanentFamilies:[[3],[149],[53],[55],[67],[22]]};
 o.playerMemory.map.id='MAP_SEVEN_ISLAND_TRAINER_TOWER';
 o.playerMemory.trainer.party=[3,149,53,55,67,22].map((species,i)=>({...mon(i),species,level:i===5?100:i===1?79:77,experience:i===5?1000000:i===1?617430:460807}));
 o.playerMemory.trainer.storage.pokemon=[{...mon(7),species:150,level:undefined,experience:428750}];
 const d=resolvePostgameObjective('trainer-tower',o,world,state,{mechanics,teamPlan});
 assert.deepEqual(d.preferredFamilies,[[3],[149],[53],[55],[67],[150]]);
 assert.equal(d.battleTeamTargetLevel,79);
 assert.equal(d.target.map,'MAP_TRAINER_TOWER_LOBBY');
 const boxed=o.playerMemory.trainer.party.pop();
 o.playerMemory.trainer.storage.pokemon.push(boxed);
 const betweenPcActions=resolvePostgameObjective('trainer-tower',o,world,state,{mechanics,teamPlan});
 assert.deepEqual(betweenPcActions.preferredFamilies,d.preferredFamilies,'the saved roster choice must survive the intermediate five-member party');
 assert.equal(betweenPcActions.battleTeamTargetLevel,79);
 o.playerMemory.trainer.storage.pokemon[0].experience=100000;
 o.playerMemory.trainer.party.push(o.playerMemory.trainer.storage.pokemon.pop());
 const withoutQualifiedReserve=resolvePostgameObjective('trainer-tower',o,world,{}, {mechanics,teamPlan});
 assert.equal(withoutQualifiedReserve.preferredFamilies,undefined,'a weak reserve cannot replace the battle team');
 assert.equal(withoutQualifiedReserve.battleTeamTargetLevel,100);
 const later=observe();
 later.playerMemory.map.id='MAP_SEVEN_ISLAND_TRAINER_TOWER';
 later.playerMemory.trainer.party=[3,149,53,55,67,22].map((species,i)=>({...mon(i),species,level:i===5?100:i===1?82:79,experience:i===5?1000000:i===1?689670:498021}));
 later.playerMemory.trainer.storage.pokemon=[{...mon(7),species:150,level:undefined,experience:428750}];
 const afterCoreTraining=resolvePostgameObjective('trainer-tower',later,world,{}, {mechanics,teamPlan});
 assert.deepEqual(afterCoreTraining.preferredFamilies,[[3],[149],[53],[55],[67],[150]],'the boxed reserve remains eligible while the installed owner trains the core');
 assert.equal(afterCoreTraining.battleTeamTargetLevel,82);
});

test('egg hatching waits for animation and declines only its verified native nickname prompt',()=>{
 const runtime={data:{symbols:{sEggHatchData:{address:0x03000e74}}}},bytes=Buffer.alloc(16);bytes[2]=10;bytes[4]=1;bytes.writeUInt16LE(175,12);
 const session={readMemory(a,n){if(a===0x03000e74){const p=Buffer.alloc(4);p.writeUInt32LE(0x02001000);return p;}return bytes.subarray(0,n);}};
 const o=observe();o.phase='transition';o.emulator.callback2='CB2_EggHatch_1';o.playerMemory.postgameEvidence=readPostgameEvidence(session,runtime,o);
 const p=createPostgameController({world,story:{data:{scripts:[]}},mechanics});p.beginAdventure();
 assert.deepEqual(p.decide(o).action.buttons,['b']);
 o.playerMemory.postgameEvidence.eggHatch.stage=6;assert.deepEqual(p.decide(o).action.buttons,[]);
 o.playerMemory.postgameEvidence.eggHatch=null;assert.notDeepEqual(p.decide(o).action?.buttons,['b']);
});

test('missing FireRed Game Corner prizes schedule a native acquisition instead of exhausting local collection',()=>{
 const o=observe();o.playerMemory.trainer.pokedex.ownedSpecies=[63,35,147,123];
 const d=resolvePostgameObjective('game-corner',o,world,{},{});
 assert.equal(d?.target.kind,'postgame-acquire');
 assert.equal(d.acquisition.kind,'game-corner');assert.equal(d.acquisition.speciesId,137);
 o.playerMemory.trainer.pokedex.ownedSpecies.push(137);
 assert.equal(resolvePostgameObjective('game-corner',o,world,{},{}),null);
});
