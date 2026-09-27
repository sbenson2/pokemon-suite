import test from 'node:test';
import assert from 'node:assert/strict';
import {selectFireRedLinkQuest,seagallopChoiceIndex,saveFireRedLinkUnlock,resolveFireRedLinkQuest} from '../src/suite/fire-red-link-quest.js';
const o=(flags={},vars={})=>({phase:'stable',emulator:{mode:'overworld'},playerMemory:{map:{id:'MAP_ONE_ISLAND'},position:{x:12,y:12},storyState:{flagIds:{2112:true,...flags},variableIds:{16502:4,16511:2,...vars}},trainer:{party:[{species:9,moves:[57,127]},{species:34,moves:[15,70]}],bag:{keyItems:[{itemId:370,quantity:1}],tmhm:[{itemId:345,quantity:1}]}}}});
test('Waterfall selects an ordinary utility from storage and never teaches the main team',()=>{
 const observation=o({733:true},{16502:5}),state={};
 const pokemon=(species,personality,moves)=>({species,personality,moves,otId:123,validity:'valid',shiny:false,ivs:{hp:1,attack:1,defense:1,speed:1,spAttack:1,spDefense:1}});
 observation.playerMemory.trainer.party=[pokemon(9,10,[57]),pokemon(22,20,[19])];
 const donor=pokemon(118,30,[64]);
 observation.playerMemory.trainer.storage={validity:'valid',pokemon:[{...donor,shiny:true,personality:40},donor]};
 const plan={starterFamily:[7,8,9],permanentFamilies:[[21,22]],utilityAcquisitions:[]};
 const next=selectFireRedLinkQuest(observation,state,plan);
 assert.equal(next.target.kind,'party-roster');assert.deepEqual(next.target.requiredFingerprints,['[118,30,123,1,1,1,1,1,1]']);
 observation.playerMemory.trainer.party.push(donor);
 assert.deepEqual(selectFireRedLinkQuest(observation,state,plan).target.partySpecies,[118]);
 assert.deepEqual(state.utilitySpecies,[118]);
 observation.playerMemory.trainer.party.pop();observation.playerMemory.trainer.storage.pokemon=[];
 assert.equal(selectFireRedLinkQuest(observation,{},plan).target.kind,'stop-for-review');
});
test('Celio must request the Ruby before the Mt Ember battles and collection',()=>{
 let d=selectFireRedLinkQuest(o({}, {16502:3}));assert.equal(d.target.map,'MAP_ONE_ISLAND_POKEMON_CENTER_1F');assert.equal(d.script,'OneIsland_PokemonCenter_1F_EventScript_Celio');
 d=selectFireRedLinkQuest(o());assert.equal(d.script,'MtEmber_Exterior_EventScript_Grunt1');
 d=selectFireRedLinkQuest(o({1817:true,1818:true}));assert.equal(d.script,'MtEmber_RubyPath_B5F_EventScript_Ruby');
 d=selectFireRedLinkQuest(o({733:true}));assert.equal(d.script,'OneIsland_PokemonCenter_1F_EventScript_Celio');
});
test('the Sapphire path includes Lorelei, the Braille Cut door, the theft, and the warehouse',()=>{
 const flags={733:true,1817:true,1818:true},vars={16502:5};
 const upperCave=o(flags,vars);upperCave.playerMemory.map.id='MAP_FOUR_ISLAND_ICEFALL_CAVE_BACK';
 assert.equal(selectFireRedLinkQuest(upperCave).script,'FourIsland_IcefallCave_Back_EventScript_LoreleiRocketsScene');
 flags[142]=true;assert.equal(selectFireRedLinkQuest(o(flags,vars)).target.moveId,15);
 flags[739]=true;assert.equal(selectFireRedLinkQuest(o(flags,vars)).script,'SixIsland_DottedHole_SapphireRoom_EventScript_Sapphire');
 flags[728]=true;assert.equal(selectFireRedLinkQuest(o(flags,vars)).script,'FiveIsland_Meadow_EventScript_WarehouseDoor');
 flags[726]=true;assert.equal(selectFireRedLinkQuest(o(flags,vars)).script,'FiveIsland_RocketWarehouse_EventScript_Admin1');
 flags[1823]=true;assert.equal(selectFireRedLinkQuest(o(flags,vars)).script,'FiveIsland_RocketWarehouse_EventScript_Admin2');
 flags[725]=true;assert.equal(selectFireRedLinkQuest(o(flags,vars)).script,'FiveIsland_RocketWarehouse_EventScript_Gideon');
 flags[732]=true;flags[724]=true;assert.equal(selectFireRedLinkQuest(o(flags,vars)).script,'OneIsland_PokemonCenter_1F_EventScript_Celio');
 flags[2116]=true;assert.equal(selectFireRedLinkQuest(o(flags,vars)),null);
});
test('the optional Lorelei conversation is completed before Celio permanently hides her',()=>{
 const flags={2112:true,2116:false,732:true,725:true,724:false,140:false},vars={16502:5};
 const state={};
 assert.equal(selectFireRedLinkQuest(o(flags,vars),state).script,'FourIsland_LoreleisHouse_EventScript_Lorelei');
 assert.equal(selectFireRedLinkQuest(o(flags,vars),JSON.parse(JSON.stringify(state))).script,'FourIsland_LoreleisHouse_EventScript_Lorelei');
 flags[724]=true;
 assert.equal(selectFireRedLinkQuest(o(flags,vars),state).script,'OneIsland_PokemonCenter_1F_EventScript_Celio');
 flags[2116]=true;assert.equal(selectFireRedLinkQuest(o(flags,vars),state),null);
});
test('Rainbow Pass menus account for the omitted origin and the Other page',()=>{
 assert.equal(seagallopChoiceIndex({origin:0,page:0,destination:1,rainbow:true}),0);
 assert.equal(seagallopChoiceIndex({origin:1,page:0,destination:4,rainbow:true}),3);
 assert.equal(seagallopChoiceIndex({origin:1,page:0,destination:6,rainbow:true}),4);
 assert.equal(seagallopChoiceIndex({origin:1,page:1,destination:6,rainbow:true}),1);
 assert.equal(seagallopChoiceIndex({origin:6,page:1,destination:5,rainbow:true}),1);
 assert.equal(seagallopChoiceIndex({origin:6,page:1,destination:1,rainbow:true}),3);
 assert.equal(seagallopChoiceIndex({origin:1,destination:0,rainbow:false,kantoUnlocked:true}),0);
 assert.equal(seagallopChoiceIndex({origin:1,destination:2,rainbow:false,kantoUnlocked:false}),0);
 assert.equal(seagallopChoiceIndex({origin:1,destination:4,rainbow:false}),null);
});

test('the Braille door withdraws an existing Cut user before requesting its field move',()=>{
 const observation=o({733:true,142:true},{16502:5});
 observation.playerMemory.trainer.party=[{species:9,moves:[57,127]}];
 observation.playerMemory.trainer.storage={validity:'valid',pokemon:[{validity:'valid',species:43,personality:123,otId:456,moves:[15],ivs:{hp:1,attack:2,defense:3,speed:4,spAttack:5,spDefense:6}}]};
 const selected=selectFireRedLinkQuest(observation);
 assert.equal(selected.target.kind,'party-roster');
 assert.deepEqual(selected.target.requiredFingerprints,['[43,123,456,1,2,3,4,5,6]']);
});

test('Celio’s link flag is followed by a verified native save before any transfer',()=>{
 const observation=o({2116:true}),state={};observation.sram={sha256:'before'};observation.playerMemory.gameStats={savedGame:8};observation.playerMemory.ui={};observation.playerMemory.saveAttemptStatus=1;
 assert.equal(saveFireRedLinkUnlock(observation,state).objective.target.saveVerified,false);
 observation.playerMemory.gameStats.savedGame=9;observation.sram.sha256='after';observation.playerMemory.ui.saveDialog={stage:'success'};
 assert.equal(saveFireRedLinkUnlock(observation,state).kind,'policy');
 observation.playerMemory.ui={};assert.equal(saveFireRedLinkUnlock(observation,state).kind,'ready');
 assert.equal(state.nativeLinkSave.savedSramSha256,'after');
});

test('cross-island travel exposes the current harbor town to Fly before opening the ferry menu',()=>{
 const observation=o({}, {16502:3});observation.playerMemory.map.id='MAP_PALLET_TOWN';
 const world={maps:[{id:'MAP_ONE_ISLAND_POKEMON_CENTER_1F',objectEvents:[{script:'OneIsland_PokemonCenter_1F_EventScript_Celio'}]}]};
 let target=resolveFireRedLinkQuest(world,observation).target;
 assert.deepEqual(target,{kind:'map',map:'MAP_VERMILION_CITY'});
 observation.playerMemory.map.id='MAP_VERMILION_CITY';target=resolveFireRedLinkQuest(world,observation).target;
 assert.equal(target.kind,'seagallop-destination');assert.equal(target.map,'MAP_ONE_ISLAND');
});

test('the Ruby descent navigates its opened entrance and each floor before targeting the gem',()=>{
 const observation=o({1817:true,1818:true});
 for(const [from,to] of [['EXTERIOR','RUBY_PATH_1F'],['RUBY_PATH_1F','RUBY_PATH_B1F'],['RUBY_PATH_B1F','RUBY_PATH_B2F'],['RUBY_PATH_B2F','RUBY_PATH_B3F'],['RUBY_PATH_B3F','RUBY_PATH_B4F'],['RUBY_PATH_B4F','RUBY_PATH_B5F']]){
  observation.playerMemory.map.id='MAP_MT_EMBER_'+from;
  observation.playerMemory.objectEventTemplates=from==='RUBY_PATH_B2F'?[{localId:1,current:{x:11,y:3}},{localId:2,current:{x:13,y:5}},{localId:3,current:{x:12,y:1}}]:[{localId:1,current:{x:11,y:5}},{localId:10,current:{x:6,y:13}}];
  assert.equal(selectFireRedLinkQuest(observation).target.map,'MAP_MT_EMBER_'+to);
 }
});

test('Ruby boulders are positioned in order from observed live or persisted positions',()=>{
 const observation=o({1817:true,1818:true});observation.playerMemory.map.id='MAP_MT_EMBER_RUBY_PATH_B2F';
 const objects=observation.playerMemory.objectEventTemplates=[{localId:1,current:{x:9,y:3}},{localId:2,current:{x:12,y:5}},{localId:3,current:{x:12,y:2}}];
 for(const [index,x,y] of [[0,11,3],[1,13,5],[2,12,1]]){
  const step=selectFireRedLinkQuest(observation);assert.equal(step.target.kind,'push-boulder');assert.equal(step.target.objectIndex,index);assert.deepEqual([step.target.x,step.target.y],[x,y]);objects[index].current={x,y};
 }
 assert.equal(selectFireRedLinkQuest(observation).target.map,'MAP_MT_EMBER_RUBY_PATH_B3F');
});

test('Ruby floor progress survives a completed boulder leaving the camera and resets on reentry',()=>{
 const observation=o({1817:true,1818:true}),state={};
 observation.playerMemory.map.id='MAP_MT_EMBER_RUBY_PATH_B3F';
 observation.playerMemory.objectEventTemplates=[{localId:1,current:{x:10,y:4}},{localId:10,current:{x:15,y:13}}];
 observation.playerMemory.objectEvents=[{localId:1,current:{x:11,y:5}}];
 assert.equal(selectFireRedLinkQuest(observation,state).target.objectIndex,9);
 observation.playerMemory.objectEvents=[{localId:10,current:{x:15,y:13}}];
 assert.equal(selectFireRedLinkQuest(observation,state).target.objectIndex,9);
 observation.playerMemory.map.id='MAP_MT_EMBER_RUBY_PATH_B4F';selectFireRedLinkQuest(observation,state);
 observation.playerMemory.map.id='MAP_MT_EMBER_RUBY_PATH_B3F';
 assert.equal(selectFireRedLinkQuest(observation,state).target.objectIndex,0);
});

test('the collected Ruby leaves by the return stairs and opens the B3F passage from the west',()=>{
 const observation=o({733:true,1817:true,1818:true});
 for(const [from,to] of [['B5F','B4F'],['B4F','B3F'],['B1F_STAIRS','B2F_STAIRS'],['B2F_STAIRS','1F'],['1F',null]]){
  observation.playerMemory.map.id='MAP_MT_EMBER_RUBY_PATH_'+from;
  assert.equal(selectFireRedLinkQuest(observation).target.map,to?'MAP_MT_EMBER_RUBY_PATH_'+to:'MAP_MT_EMBER_EXTERIOR');
 }
 observation.playerMemory.map.id='MAP_MT_EMBER_RUBY_PATH_B3F';
 observation.playerMemory.objectEvents=[{localId:10,current:{x:15,y:13}},{localId:3,current:{x:28,y:8}},{localId:2,current:{x:26,y:12}}];
 let next=selectFireRedLinkQuest(observation);assert.equal(next.target.objectIndex,9);assert.deepEqual([next.target.x,next.target.y],[18,13]);
 observation.playerMemory.objectEvents[0].current.x=18;
 next=selectFireRedLinkQuest(observation);assert.equal(next.target.objectIndex,2);assert.deepEqual([next.target.x,next.target.y],[29,8]);
 observation.playerMemory.objectEvents[1].current.x=29;
 next=selectFireRedLinkQuest(observation);assert.equal(next.target.objectIndex,1);assert.deepEqual([next.target.x,next.target.y],[25,12]);
 observation.playerMemory.objectEvents[2].current.x=25;
 assert.equal(selectFireRedLinkQuest(observation).target.map,'MAP_MT_EMBER_RUBY_PATH_B1F_STAIRS');
});

test('Waterfall acquisition routes through both cracked-ice falls and the basement slide',()=>{
 const observation=o({733:true},{16502:5}),state={};observation.playerMemory.trainer.party=[{species:9,moves:[57]}];observation.playerMemory.trainer.bag={};
 observation.playerMemory.map.id='MAP_FOUR_ISLAND_ICEFALL_CAVE_1F';observation.playerMemory.position={x:3,y:17};
 let next=selectFireRedLinkQuest(observation,state);assert.equal(next.target.kind,'walk-to');assert.deepEqual([next.target.x,next.target.y],[8,3]);
 observation.playerMemory.position={x:8,y:3};next=selectFireRedLinkQuest(observation,state);assert.deepEqual([next.target.x,next.target.y],[7,3]);
 observation.playerMemory.map.id='MAP_FOUR_ISLAND_ICEFALL_CAVE_B1F';observation.playerMemory.position={x:8,y:3};assert.equal(selectFireRedLinkQuest(observation,state).target.index,1);
 observation.playerMemory.map.id='MAP_FOUR_ISLAND_ICEFALL_CAVE_1F';observation.playerMemory.position={x:12,y:3};next=selectFireRedLinkQuest(observation,state);assert.deepEqual([next.target.x,next.target.y],[16,9]);
 observation.playerMemory.map.id='MAP_FOUR_ISLAND_ICEFALL_CAVE_B1F';observation.playerMemory.position={x:16,y:9};
 for(const [x,y] of [[16,6],[19,6],[19,13],[17,13],[17,14]]){next=selectFireRedLinkQuest(observation,state);assert.deepEqual([next.target.x,next.target.y],[x,y]);observation.playerMemory.position={x,y};}
 assert.equal(selectFireRedLinkQuest(observation,state).target.index,2);
 observation.playerMemory.map.id='MAP_FOUR_ISLAND_ICEFALL_CAVE_1F';observation.playerMemory.position={x:15,y:16};assert.equal(selectFireRedLinkQuest(observation,state).script,'FourIsland_IcefallCave_1F_EventScript_ItemHM07');
});

test('Lorelei’s scene accepts equivalent trigger tiles when the first tile is unreachable',()=>{
 const observation=o({733:true},{16502:5});
 observation.playerMemory.map.id='MAP_FOUR_ISLAND_ICEFALL_CAVE_BACK';
 const next=selectFireRedLinkQuest(observation);assert.equal(next.target.kind,'trigger');assert.equal(next.target.equivalentTriggers,true);
});

 test('the warehouse password resolves to its real background event before entry',()=>{
 const observation=o({733:true,142:true,739:true,728:true},{16502:5});observation.playerMemory.map.id='MAP_FIVE_ISLAND';
 const world={maps:[{id:'MAP_FIVE_ISLAND_MEADOW',backgroundEvents:[{script:'FiveIsland_Meadow_EventScript_WarehouseDoor'}]}]};
 const next=resolveFireRedLinkQuest(world,observation);assert.equal(next.target.kind,'background');assert.equal(next.target.index,0);
});

test('the Lorelei route approaches Waterfall from the Center or another map before targeting the upper cave',()=>{
 const observed=o({733:true},{16502:5});
 for(const [map,x,y,expected] of [
  ['MAP_FOUR_ISLAND_POKEMON_CENTER_1F',11,2,'field-move-at'],
  ['MAP_FOUR_ISLAND',12,12,'field-move-at'],
  ['MAP_ONE_ISLAND',12,12,'field-move-at'],
  ['MAP_FOUR_ISLAND_ICEFALL_CAVE_ENTRANCE',17,21,'field-move-at'],
  ['MAP_FOUR_ISLAND_ICEFALL_CAVE_ENTRANCE',17,10,'trigger'],
  ['MAP_FOUR_ISLAND_ICEFALL_CAVE_1F',16,17,'field-move-at'],
  ['MAP_FOUR_ISLAND_ICEFALL_CAVE_1F',6,5,'trigger'],
  ['MAP_FOUR_ISLAND_ICEFALL_CAVE_BACK',4,7,'trigger'],
 ]){
  observed.playerMemory.map.id=map;observed.playerMemory.position={x,y};
  const next=selectFireRedLinkQuest(observed);
  assert.equal(next.target.kind,expected,map+' must resolve the required side of the waterfall');
  if(expected==='field-move-at')assert.deepEqual([next.target.map,next.target.x,next.target.y,next.target.moveId],['MAP_FOUR_ISLAND_ICEFALL_CAVE_ENTRANCE',17,21,127]);
 }
});
