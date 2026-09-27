import test from 'node:test';
import assert from 'node:assert/strict';
import {createSuiteMission} from '../src/suite/mission.js';
import {requiresTimedCapture} from '../src/rng/protected-capture-plan.js';
import {readPostgameEvidence} from '../src/suite/postgame-agenda.js';
import {assertAtomicObservation} from '../src/foundation.js';
import {resolveFireRedTravel} from '../src/suite/fire-red-link-quest.js';
const request={game:'firered',speciesId:245,quantity:1,locationId:'any',shiny:'required',natures:[],gender:'any',abilityId:null,ball:{id:'any',requirement:'preferred'},minIvs:{},moves:[],heldItemId:null,finalLevel:null,encounterLevel:{min:50,max:50},limits:{minBalls:10,maxSpend:999999,maxMinutes:1440,maxEncounters:100000}};
const world={data:{maps:[{id:'MAP_ONE_ISLAND_POKEMON_CENTER_1F',objectEvents:[{script:'OneIsland_PokemonCenter_1F_EventScript_Celio'}]},{id:'MAP_ROUTE1',group:3,number:19}]}};
const make=state=>createSuiteMission({id:'suicune',request,world,route:{method:'roamer'},state});
const observation=()=>({frame:100,phase:'stable',sram:{sha256:'before'},emulator:{mode:'overworld',inBattle:false,inputReady:true},playerMemory:{map:{id:'MAP_ONE_ISLAND_POKEMON_CENTER_1F'},ui:{},gameStats:{savedGame:4},saveAttemptStatus:1,storyState:{flagIds:{2092:true,2112:true,2116:false,732:true},variableIds:{16433:2}},postgameEvidence:{roamer:{species:0,active:false,personality:0}},trainer:{otId:123,partyValidity:'valid',party:[{validity:'valid',species:6,hp:100,maxHp:100,moves:[19],pp:[15]}],storage:{validity:'valid',boxCounts:Array(14).fill(0)},bag:{pokeBalls:[{itemId:2,quantity:40}]},money:100000}}});

test('National Dex pursuit accepts an existing ordinary roamer for each native starter without rerolling it',()=>{
 for(const [starter,species] of [[0,244],[1,243],[2,245]]){
  const m=createSuiteMission({id:'native-roamer-'+species,request:{...request,speciesId:species,shiny:'any'},world,route:{method:'roamer'}}),o=observation();
  o.playerMemory.storyState.variableIds[0x4031]=starter;o.playerMemory.storyState.flagIds[2116]=true;
  o.playerMemory.postgameEvidence.roamer={species,active:true,shiny:false,personality:123,location:{group:3,number:19}};
  m.initialize(o);assert.equal(m.state.phase,'saving-release');
  m.inspect(o);o.playerMemory.gameStats.savedGame++;o.sram.sha256='native-release';m.inspect(o);
  assert.equal(m.state.phase,'tracking');assert.equal(m.state.resets,0);
  o.emulator.inBattle=true;o.playerMemory.encounter={kind:'wild',pokemon:{validity:'valid',species,shiny:false,personality:123}};
  assert.equal(m.inspect(o).kind,'protect');
  assert.equal(m.matches({...o.playerMemory.encounter.pokemon,personality:124}),false);
 }
});
test('Suicune rejects Squirtle saves and an already generated non-shiny instead of resetting encounters',()=>{
 const o=observation();o.playerMemory.storyState.variableIds[16433]=1;
 assert.throws(()=>make().initialize(o),/Charmander/);
 o.playerMemory.storyState.variableIds[16433]=2;o.playerMemory.postgameEvidence.roamer={species:245,active:true,shiny:false};
 assert.throws(()=>make().initialize(o),/already.*non-shiny/);
});
test('roamer generation is anchored in a native save and only Celio’s final release text starts RNG timing',()=>{
 const m=make(),o=observation();m.initialize(o);
 assert.equal(m.inspect(o).objective.target.kind,'object');
 assert.equal(m.beforeInteraction(o,{winner:{recommendation:{kind:'interact-with-object',objective:'release-suicune'}}}),true);
 assert.equal(m.inspect(o).objective.target.kind,'save-game');
 o.playerMemory.gameStats.savedGame=5;o.sram.sha256='anchor';assert.equal(m.inspect(o).kind,'anchor');m.state.anchor={stateSha256:'anchor'};
 const d={winner:{recommendation:{kind:'acknowledge-cartridge-prompt'}},action:{buttons:['a']}};
 o.playerMemory.ui.fieldDialog={stage:'awaiting-page'};
 assert.equal(m.generationTrigger(o,d),false);
 o.playerMemory.postgameEvidence.celioFinalText=true;assert.equal(m.generationTrigger(o,d),true);
 o.playerMemory.postgameEvidence.roamer={species:245,active:true,shiny:false,personality:777};
 assert.deepEqual(m.inspect(o).pokemon.personality,777);assert.equal(m.inspect(o).kind,'reset');
});
test('a shiny release is saved before pursuit and never rolled again after an incidental shiny',()=>{
 const m=make(),o=observation();m.initialize(o);m.state.phase='hunting';m.state.anchor={stateSha256:'anchor'};
 o.playerMemory.storyState.flagIds[2116]=true;o.playerMemory.postgameEvidence.roamer={species:245,active:true,shiny:true,personality:777,location:{group:3,number:19}};
 assert.equal(m.inspect(o).objective.target.kind,'save-game');
 o.playerMemory.gameStats.savedGame=5;o.sram.sha256='released';m.inspect(o);
 assert.equal(m.state.phase,'tracking');assert.equal(m.state.release.nativeSaveVerified,true);
 o.playerMemory.map.id='MAP_ROUTE1';assert.equal(m.inspect(o).objective.target.kind,'encounter-zone');
 o.playerMemory.postgameEvidence.roamer.location.number=20;assert.equal(m.inspect(o).objective.target.map,'MAP_PALLET_TOWN');
 const p={validity:'valid',species:16,personality:888,otId:123,shiny:true,ivs:{hp:1,attack:1,defense:1,speed:1,spAttack:1,spDefense:1}};
 o.emulator.inBattle=true;o.playerMemory.encounter={kind:'wild',pokemon:p};assert.equal(m.inspect(o).kind,'protect');
 m.acceptSavedCapture({nativeSaveVerified:true,savedSramSha256:'incidental',fingerprint:'pidgey',pokemon:p});
 assert.equal(m.state.phase,'tracking');assert.equal(m.state.release.personality,777);assert.equal(m.state.protected,false);
 assert.notEqual(m.inspect({...o,emulator:{...o.emulator,inBattle:false}}).kind,'reset');
});
test('roamer flee mechanics require first-ball qualification even with a healthy catcher and plentiful balls',()=>{
 const o=observation();o.emulator.inBattle=true;o.playerMemory.battleTypeFlags=1028;
 o.playerMemory.encounter={pokemon:{validity:'valid',species:245,shiny:true,moves:[55],pp:[20]}};
 assert.equal(requiresTimedCapture(o,{moves:[{id:55,effect:'EFFECT_HIT'}]}),true);
 o.playerMemory.battleTypeFlags=1036;assert.equal(requiresTimedCapture(o,{moves:[]}),false);
});
test('roamer preparation survives restart and yields before Sapphire delivery, after its menus finish',()=>{
 const args={id:'suicune',request,route:{method:'roamer'},world:{data:{...world.data,wildEncounters:[]}},story:{data:{scripts:[]}},mechanics:{data:{species:[]}}};
 let m=createSuiteMission(args),o=observation();o.playerMemory.storyState.flagIds[732]=false;
 m.initialize(o);assert.ok(m.preparationController(o));m.checkpoint();
 m=createSuiteMission({...args,state:m.state});assert.equal(m.preparationController(o).state().preparation.requestId,'suicune');
 o.playerMemory.storyState.flagIds[732]=true;o.playerMemory.ui.fieldDialog={stage:'awaiting-page'};
 assert.ok(m.preparationController(o));
 o.playerMemory.ui={};assert.equal(m.preparationController(o),null);assert.equal(m.state.phase,'traveling');
});
test('read-only roamer evidence identifies the live route and Celio’s final message',()=>{
 const ram=Buffer.alloc(8192);ram.writeUInt32LE(1000,4);ram.writeUInt32LE(2000,8);
 ram.writeUInt32LE(777,1004);ram.writeUInt16LE(245,1008);ram[1012]=50;ram[1019]=1;
 ram[3000]=3;ram[3001]=19;ram.writeUInt32LE(0x081a1df5,4100);
 const runtime={data:{symbols:{gSaveBlock1Ptr:{address:4},gSaveBlock2Ptr:{address:8},sRoamerLocation:{address:3000},sGlobalScriptContext:{address:4000},OneIsland_PokemonCenter_1F_Text_ManagedToLinkWithHoennThankYou:{address:0x081a1df5}},structures:{SaveBlock1:{fields:{roamer:{offset:0},trainerTower:{offset:40}}},SaveBlock2:{fields:{encryptionKey:{offset:4}}}}}};
 const session={readMemory:(a,n)=>ram.subarray(a,a+n)};
 const r=readPostgameEvidence(session,runtime,observation());
 const o=observation();o.captureId='roamer-observation';for(const part of [o.emulator,o.sram,o.playerMemory])Object.assign(part,{captureId:o.captureId,frame:o.frame});
 o.playerMemory.postgameEvidence=r;assert.doesNotThrow(()=>assertAtomicObservation(o));
 assert.deepEqual(r.roamer.location,{group:3,number:19});assert.equal(r.roamer.personality,777);assert.equal(r.celioFinalText,true);
 ram.writeUInt32LE(0,4100);assert.equal(readPostgameEvidence(session,runtime,observation()).celioFinalText,false);
});

test('roamer supplies retain their destination through Fly, purchase completion, and restart',()=>{
 let m=make(),o=observation();o.playerMemory.map.id='MAP_VERMILION_CITY';
 o.playerMemory.trainer.bag.pokeBalls=[{itemId:2,quantity:3}];
 assert.equal(m.inspect(o).objective.target.map,'MAP_FUCHSIA_CITY_MART');
 for(const [mode,ui] of [
  ['start-menu',{startMenu:{order:['pokedex','pokemon','bag']}}],
  ['party',{party:{stage:'choose-pokemon'}}],
  ['fly-map',{flyMap:{}}],
  ['mart',{mart:{stage:'quantity'}}],
 ]){
  m=make(m.state);o.emulator.mode=mode;o.playerMemory.ui=ui;
  if(mode==='mart')o.playerMemory.map.id='MAP_FUCHSIA_CITY_MART';
  const next=m.inspect(o);
  assert.equal(next.objective.target.kind,'purchase-items',mode);
  assert.equal(resolveFireRedTravel(next.objective,o,world).target.map,'MAP_FUCHSIA_CITY_MART',mode);
 }
 // Money/inventory update before the clerk's final dialogue and menu exit.
 o.playerMemory.trainer.bag.pokeBalls[0].quantity=30;o.playerMemory.trainer.money=0;
 assert.equal(m.inspect(o).objective.target.kind,'purchase-items');
 o.emulator.mode='modal';o.playerMemory.ui={fieldDialog:{stage:'awaiting-page'}};
 m=make(m.state);assert.equal(m.inspect(o).objective.target.kind,'purchase-items');
 o.emulator.mode='overworld';o.playerMemory.ui={};
 assert.equal(m.inspect(o).objective.target.map,'MAP_ONE_ISLAND_POKEMON_CENTER_1F');
});

test('roamer supply target remains in force after a partial purchase crosses the low-ball threshold',()=>{
 const m=make(),o=observation();o.playerMemory.trainer.bag.pokeBalls=[{itemId:2,quantity:3}];
 m.inspect(o);o.playerMemory.trainer.bag.pokeBalls[0].quantity=12;
 assert.equal(m.inspect(o).objective.target.kind,'purchase-items');
 o.playerMemory.trainer.bag.pokeBalls[0].quantity=30;
 assert.equal(m.inspect(o).objective.target.kind,'object');
});

test('roamer healing keeps the nurse through the healing animation, farewell, and restart',()=>{
 const nurseWorld=structuredClone(world);nurseWorld.data.maps[0].objectEvents.push({script:'OneIsland_PokemonCenter_1F_EventScript_Nurse'});
 const args={id:'suicune',request,world:nurseWorld,route:{method:'roamer'}};
 let m=createSuiteMission(args),o=observation();o.playerMemory.trainer.party[0].hp=1;
 assert.equal(m.inspect(o).objective.id,'restore-postgame-party');
 o.emulator.mode='modal';o.playerMemory.ui={fieldDialog:{stage:'awaiting-page'}};
 assert.equal(m.inspect(o).objective.id,'restore-postgame-party');
 o.playerMemory.trainer.party[0].hp=100;m=createSuiteMission({...args,state:m.state});
 assert.equal(m.inspect(o).objective.id,'restore-postgame-party');
 o.emulator.mode='overworld';o.playerMemory.ui={};
 assert.equal(m.inspect(o).objective.id,'release-suicune');
});

test('interacting with the nurse in Celio’s building must not anchor a roamer release',()=>{
 const m=make(),o=observation();m.inspect(o);
 assert.equal(m.beforeInteraction(o,{winner:{recommendation:{kind:'interact-with-object',objective:'restore-postgame-party'}}}),false);
 assert.equal(m.state.phase,'traveling');
 assert.equal(m.beforeInteraction(o,{winner:{recommendation:{kind:'interact-with-object',objective:'release-suicune'}}}),true);
});

test('ordinary roamer flight hands back to tracking only with the same active uncaught native identity, across restart',()=>{
 const o=observation(),p={validity:'valid',species:245,shiny:false,personality:777,otId:123,ivs:{hp:1,attack:1,defense:1,speed:1,spAttack:1,spDefense:1}};
 const args={id:'ordinary',request:{...request,shiny:'any'},world,route:{method:'roamer'}};
 let m=createSuiteMission(args);Object.assign(m.state,{phase:'tracking',elapsedMs:55000,release:{species:245,active:true,shiny:false,personality:777,nativeSaveVerified:true}});
 o.emulator.inBattle=true;o.playerMemory.encounter={kind:'wild',validity:'valid',pokemon:p};
 assert.equal(m.inspect(o).kind,'protect');assert.equal(m.state.encounters,1);
 m=createSuiteMission({...args,state:m.state});m.inspect(o);assert.equal(m.state.encounters,1,'same retained battle counts once');
 const evidence={pokemon:p,fingerprint:JSON.stringify([245,777,123,1,1,1,1,1,1]),before:{party:0,storage:0},caught:false,nativeSaveVerified:false};
 m.state.protectedAnchor={stateSha256:'anchor',sramSha256:'before'};
 o.emulator.inBattle=false;o.playerMemory.encounter=null;o.playerMemory.battleOutcome=6;o.playerMemory.trainer.storage.pokemon=[];
 o.playerMemory.postgameEvidence.roamer={species:245,active:true,shiny:false,personality:777,location:{group:3,number:19}};
 for(const mutate of [x=>x.playerMemory.postgameEvidence.roamer.active=false,x=>x.playerMemory.postgameEvidence.roamer.personality++,x=>x.playerMemory.battleOutcome=4,x=>x.sram.sha256='changed',x=>x.playerMemory.trainer.storage.validity='unknown',x=>x.playerMemory.trainer.storage.pokemon=[p],x=>x.playerMemory.postgameEvidence.roamer.location={},x=>x.sram.sha256=undefined]){
  const bad=structuredClone(o);mutate(bad);const held=createSuiteMission({...args,state:m.state});assert.equal(held.inspect(bad,{captureEvidence:evidence}).kind,'capture');assert.equal(held.state.protected,true);
 }
 assert.equal(m.inspect(o,{captureEvidence:evidence}).kind,'roamer-fled');assert.equal(m.state.protected,false);assert.equal(m.state.elapsedMs,55000);assert.equal(m.state.phase,'tracking');
 m=createSuiteMission({...args,state:m.state});assert.equal(m.inspect(o).kind,'policy');
 o.emulator.inBattle=true;o.playerMemory.encounter={kind:'wild',validity:'valid',pokemon:p};assert.equal(m.inspect(o).kind,'protect');assert.equal(m.state.encounters,2,'same individual in a new battle is another encounter');
});

test('requested ordinary roaming battle qualifies its first throw without broadening ordinary wild capture',()=>{
 const o=observation();o.emulator.inBattle=true;o.playerMemory.battleTypeFlags=1028;o.playerMemory.encounter={pokemon:{validity:'valid',species:244,shiny:false}};
 assert.equal(requiresTimedCapture(o,{}, {requestedRoamer:true}),true);
 assert.equal(requiresTimedCapture(o,{}),false);
 o.playerMemory.battleTypeFlags=4;assert.equal(requiresTimedCapture(o,{}, {requestedRoamer:true}),false);
});
