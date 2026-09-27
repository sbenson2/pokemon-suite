import test from 'node:test';
import assert from 'node:assert/strict';
import * as acquisition from '../src/suite/native-acquisition.js';
const p=(species,id,more={})=>({species,personality:id,otId:10,validity:'valid',isEgg:false,shiny:false,level:30,hp:50,maxHp:50,heldItem:0,moves:[33],ivs:{hp:1,attack:2,defense:3,speed:4,spAttack:5,spDefense:6},...more});
const facts=(id,groups,gender=50)=>({id,eggGroups:groups.map(g=>'EGG_GROUP_'+g),genderRatio:typeof gender==='number'?{call:'PERCENT_FEMALE',args:[gender]}:gender});
const mechanics={data:{species:[facts(26,['FIELD','FAIRY']),facts(19,['FIELD']),facts(132,['DITTO'],'MON_GENDERLESS'),facts(81,['MINERAL'],'MON_GENDERLESS'),facts(150,['UNDISCOVERED'],'MON_GENDERLESS'),facts(29,['MONSTER','FIELD'],'MON_FEMALE'),facts(31,['UNDISCOVERED'],'MON_FEMALE'),facts(202,['AMORPHOUS'])]}};
const trainer=()=>({partyValidity:'valid',party:[p(6,1000,{slot:0,moves:[19]})],storage:{validity:'valid',pokemon:[p(26,1),p(19,200)],boxCounts:[2,...Array(13).fill(0)]},pokedex:{ownedSpecies:[6,26,19]},bag:{},money:50000});
test('breeding selects compatible spare parents for a missing baby and protects the active party and shinies',()=>{
 const t=trainer(),s=acquisition.selectOwnedBreeding?.({trainer:t,mechanics});
 assert.equal(s?.speciesId,172);assert.deepEqual(s.parents.map(p=>p.species),[26,19]);
 t.storage.pokemon[0].shiny=true;assert.equal(acquisition.selectOwnedBreeding?.({trainer:t,mechanics}),null);
 t.storage.pokemon[0].shiny=false;t.party.push(t.storage.pokemon.shift());assert.equal(acquisition.selectOwnedBreeding?.({trainer:t,mechanics}),null);
});
test('native breeding respects genderless Ditto pairs, undiscovered groups, split species and incense',()=>{
 const t=trainer();t.storage.pokemon=[p(81,20),p(132,50)];
 assert.equal(acquisition.selectOwnedBreeding?.({trainer:t,mechanics})?.speciesId,81);
 t.storage.pokemon=[p(150,20),p(132,50)];assert.equal(acquisition.selectOwnedBreeding?.({trainer:t,mechanics}),null);
 t.storage.pokemon=[p(29,20),p(132,50)];t.pokedex.ownedSpecies.push(29);assert.equal(acquisition.selectOwnedBreeding?.({trainer:t,mechanics})?.speciesId,32);
 t.storage.pokemon=[p(31,20),p(132,50)];assert.equal(acquisition.selectOwnedBreeding?.({trainer:t,mechanics}),null);
 t.storage.pokemon=[p(202,20),p(132,50)];t.pokedex.ownedSpecies.push(202);assert.equal(acquisition.selectOwnedBreeding?.({trainer:t,mechanics}),null);
 t.bag.items=[{itemId:221,quantity:1}];assert.equal(acquisition.selectOwnedBreeding?.({trainer:t,mechanics})?.speciesId,360);
});
const world={data:{maps:[{id:'MAP_FOUR_ISLAND_POKEMON_DAY_CARE',objectEvents:[{script:'FourIsland_PokemonDayCare_EventScript_DaycareWoman'}]},{id:'MAP_FOUR_ISLAND',objectEvents:[{script:'FourIsland_EventScript_DaycareMan'}]}]}};
const observation=()=>({phase:'stable',frame:100,emulator:{mode:'overworld',inputReady:true,inBattle:false},sram:{sha256:'a'.repeat(64)},playerMemory:{map:{id:'MAP_FOUR_ISLAND_POKEMON_DAY_CARE'},ui:{},gameStats:{savedGame:10},trainer:trainer(),postgameEvidence:{acquisition:{prompt:null,withdrawalCost:100,selectedParent:0,daycare:{validity:'valid',parents:[],pendingEgg:false,menuCursor:null}}}}});
const create=(state=null)=>acquisition.createPostgameAcquisition({kind:'breeding',requestId:'pichu',speciesId:172,parents:[p(26,1),p(19,200)],world,mechanics,state});
const available=()=>{const o=observation(),t=o.playerMemory.trainer;t.party.push(...t.storage.pokemon.map((p,i)=>({...p,slot:i+1})));t.storage.pokemon=[];return o;};
test('daycare selects only its reserved individual in the correct native party menu',()=>{
 let task;try{task=create();}catch{}const o=available(),m=o.playerMemory;
 assert.equal(task?.inspect(o)?.objective?.target.kind,'object');
 m.ui.party={menuType:6,actionId:0,stage:'choose-pokemon'};
 assert.equal(task.inspect(o).recommendation?.targetPartySlot,1);
 m.postgameEvidence.acquisition.daycare.parents=[m.trainer.party.splice(1,1)[0]];m.trainer.party[1].slot=1;
 task=create(task.state);assert.equal(task.inspect(o).recommendation?.targetSpecies,19);
 m.ui.party.menuType=0;assert.equal(task.inspect(o).recommendation?.kind,'close-menu');
});
test('a restart retains both parents, accepts the egg, verifies withdrawal payments and saves after hatching',()=>{
 let task;try{task=create();}catch{}const o=available(),m=o.playerMemory,a=m.postgameEvidence.acquisition;
 assert.equal(task?.inspect(o)?.kind,'policy');
 a.daycare.parents=m.trainer.party.splice(1);task.inspect(o);
 a.daycare.pendingEgg=true;m.map.id='MAP_FOUR_ISLAND';m.ui.choiceMenu={cursor:0,maxCursor:1};a.prompt='DayCare_Text_DoYouWantEgg';
 assert.equal(task.inspect(o).recommendation?.targetOption,'yes');
 m.trainer.party.push(p(172,99,{isEgg:true,slot:1}));a.daycare.pendingEgg=false;m.ui={};task.inspect(o);task=create(task.state);
 m.map.id='MAP_FOUR_ISLAND_POKEMON_DAY_CARE';m.ui.choiceMenu={cursor:0,maxCursor:1};a.prompt='DayCare_Text_WeCanRaiseOneMore';
 assert.equal(task.inspect(o).recommendation?.targetOption,'no');
 a.prompt='DayCare_Text_ItWillCostX';assert.equal(task.inspect(o).recommendation?.targetOption,'yes');
 m.trainer.party.push({...a.daycare.parents.shift(),slot:2});m.trainer.money-=100;m.ui={};task.inspect(o);
 a.prompt='DayCare_Text_ItWillCostX';m.ui.choiceMenu={cursor:0,maxCursor:1};assert.equal(task.inspect(o).recommendation?.targetOption,'yes');
 m.trainer.party.push({...a.daycare.parents.shift(),slot:3});m.trainer.money-=100;m.ui={};
 assert.equal(task.inspect(o).objective.target.kind,'friendship-walk');
 task=create(task.state);m.gameStats.savedGame=11; // earlier egg save cannot certify hatching
 m.trainer.party[1].isEgg=false;m.trainer.pokedex.ownedSpecies.push(172);
 assert.equal(task.inspect(o).objective.target.kind,'save-game');
 task=create(task.state);m.gameStats.savedGame=12;m.saveAttemptStatus=1;o.sram.sha256='c'.repeat(64);
 const d=task.inspect(o);assert.equal(d.kind,'complete');assert.equal(d.receipt.nativeSaveVerified,true);assert.equal(d.receipt.parentsReturned.length,2);assert.equal(d.receipt.feesPaid,200);
});
test('unknown daycare occupants and unmatched withdrawals cannot be silently accepted',()=>{
 let task;try{task=create();}catch{}const o=available();o.playerMemory.postgameEvidence.acquisition.daycare.parents=[p(133,300)];
 assert.equal(task?.inspect(o)?.kind,'stop');
});

test('parent roster preparation retains ownership through PC and party menus before daycare',()=>{
 const task=create(),o=observation();
 assert.equal(task.inspect(o).objective.target.kind,'party-roster');
 o.playerMemory.ui.storage={stage:'main'};
 assert.equal(task.inspect(o).objective.target.kind,'party-roster');
 const restored=create(task.state);o.playerMemory.ui={party:{menuType:0,stage:'choose-pokemon'}};
 assert.equal(restored.inspect(o).objective.target.kind,'party-roster');
});

test('starting inside an unrelated PC selector prepares the roster instead of answering a daycare question',()=>{
 const task=create(),o=observation();o.playerMemory.map.id='MAP_FOUR_ISLAND_POKEMON_CENTER_1F';o.playerMemory.ui.choiceMenu={cursor:0,maxCursor:4};
 assert.equal(task.inspect(o).objective?.target.kind,'party-roster');
});

test('daycare confirms Store for the reserved parent instead of reopening the party picker',()=>{
 const task=create(),o=available();task.inspect(o);o.playerMemory.ui.party={menuType:6,stage:'selection-menu',selectedPartySlot:1,actions:['store','summary','cancel'],actionCursor:0};
 const r=task.inspect(o).recommendation;assert.equal(r?.kind,'choose-party-action');assert.equal(r.targetAction,'store');assert.equal(r.targetIndex,0);
 o.playerMemory.ui.party.selectedPartySlot=0;assert.equal(task.inspect(o).recommendation.kind,'close-menu');
});

test('breeding restores the original travelling party before its final save',()=>{
 let task=create();const o=observation(),m=o.playerMemory;task.inspect(o);
 const state=structuredClone(task.state),parents=m.trainer.storage.pokemon;
 state.egg=JSON.stringify([172,99,10,1,2,3,4,5,6]);state.deposited=true;state.dirty=true;state.parentsReturned=parents.map(p=>JSON.stringify([p.species,p.personality,p.otId,1,2,3,4,5,6]));state.preparationGoal=null;
 m.trainer.party.push(...parents.map((p,i)=>({...p,slot:i+1})),p(172,99,{slot:3}));m.trainer.storage.pokemon=[];m.trainer.pokedex.ownedSpecies.push(172);
 task=create(state);assert.equal(task.inspect(o).objective.target.kind,'party-roster');
 assert.equal(task.inspect(o).objective.target.maximumPartySize,1);
});

test('breeding earns the withdrawal reserve before committing either parent',()=>{
 const income={id:'fund-daycare',target:{kind:'trainer',map:'MAP_ROUTE15'}};
 const task=acquisition.createPostgameAcquisition({kind:'breeding',requestId:'pichu',speciesId:172,parents:[p(26,1),p(19,200)],world,mechanics,planner:{selectIncomePreparation:()=>income}});
 const o=observation();o.playerMemory.trainer.money=100;
 assert.deepEqual(task.inspect(o),{kind:'policy',objective:income});
 assert.notEqual(task.state.dirty,true);
});

test('the original cartridge requires Sea Incense for Azurill and Lax Incense for Wynaut',()=>{
 const data={data:{species:[...mechanics.data.species,facts(183,['WATER_1','FAIRY'])]}};
 for(const [parent,baby,required,wrong] of [[183,298,220,221],[202,360,221,220]]){
  const t=trainer();t.storage.pokemon=[p(parent,20),p(132,50)];t.pokedex.ownedSpecies.push(parent);
  t.bag.items=[{itemId:wrong,quantity:1}];assert.equal(acquisition.selectOwnedBreeding({trainer:t,mechanics:data}),null);
  t.bag.items=[{itemId:required,quantity:1}];const choice=acquisition.selectOwnedBreeding({trainer:t,mechanics:data});
  assert.equal(choice.speciesId,baby);assert.equal(choice.itemId,required);
 }
});

test('a cartridge-owned daycare write can settle before parent checksums are required',()=>{
 const task=create(),o=observation();o.playerMemory.postgameEvidence.acquisition.daycare.validity='invalid';o.playerMemory.ui.fieldDialog={ready:false};
 assert.equal(task.inspect(o).kind,'wait');
 o.playerMemory.ui={};assert.equal(task.inspect(o).kind,'stop','invalid parents in the free field remain a review stop');
});
