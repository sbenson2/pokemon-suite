import test from 'node:test';
import assert from 'node:assert/strict';
import {selectNationalDexCapture,FIRE_RED_RODS} from '../src/suite/national-dex-agenda.js';
import {createSuiteMission} from '../src/suite/mission.js';

// Live September 28 (build 123): Krabby and Qwilfish were listed as local
// fishing catches, but no National Dex path fished, so the owner stood still.
const slots=(n,fill,at={})=>Array.from({length:n},(_,i)=>({species:at[i]??fill,min_level:5,max_level:15}));
const giver=(id,script)=>({id,objectEvents:[{script:'0x0'},{script}].slice(1)});
const world={data:{maps:[{id:'MAP_ROUTE12'},{id:'MAP_FIVE_ISLAND_MEADOW'},
 giver('MAP_VERMILION_CITY_HOUSE1','VermilionCity_House1_EventScript_FishingGuru'),giver('MAP_FUCHSIA_CITY_HOUSE2','FuchsiaCity_House2_EventScript_FishingGurusBrother'),
 giver('MAP_ROUTE12_FISHING_HOUSE','Route12_FishingHouse_EventScript_FishingGuruBrother')],wildEncounters:[
 {map:'MAP_ROUTE12',base_label:'sRoute12_FireRed',fishing_mons:{encounter_rate:60,mons:slots(10,'SPECIES_MAGIKARP',{4:'SPECIES_KRABBY'})}},
 {map:'MAP_ROUTE12',base_label:'sRoute12_LeafGreen',fishing_mons:{encounter_rate:60,mons:slots(10,'SPECIES_MAGIKARP',{9:'SPECIES_QWILFISH'})}},
 {map:'MAP_FIVE_ISLAND_MEADOW',base_label:'sFiveIslandMeadow_FireRed',fishing_mons:{encounter_rate:20,mons:slots(10,'SPECIES_MAGIKARP',{6:'SPECIES_QWILFISH'})}},
]}};
const mechanics={data:{species:[{id:98,name:'SPECIES_KRABBY'},{id:129,name:'SPECIES_MAGIKARP'},{id:211,name:'SPECIES_QWILFISH'}]}};
function observation({rods=[264],flags={}}={}){
 return {phase:'stable',frame:1,emulator:{mode:'overworld',inBattle:false},playerMemory:{map:{id:'MAP_LAVENDER_TOWN'},position:{x:5,y:5},ui:{},
  storyState:{flagIds:{2092:true,2112:true,2116:true,576:false,580:false,597:true,...flags},variableIds:{}},
  trainer:{partyValidity:'valid',party:[{slot:0,species:22,validity:'valid',hp:100,maxHp:100,moves:[19]}],money:500000,
   storage:{validity:'valid',boxCounts:Array(14).fill(0),pokemon:[]},
   bag:{keyItems:rods.map(itemId=>({itemId,quantity:1})),items:[],pokeBalls:[{itemId:4,quantity:60}]},pokedex:{ownedSpecies:[129]}}}};
}

test('the National Dex selector fishes a missing species with the rod its table slot needs',()=>{
 assert.deepEqual(FIRE_RED_RODS.map(r=>[r.itemId,r.start,r.end,r.flagId]),[[262,0,2,576],[263,2,5,580],[264,5,10,597]]);
 const state={},task=selectNationalDexCapture({o:observation(),world,mechanics,state});
 assert.equal(task?.target.kind,'postgame-hunt');
 assert.deepEqual([task.request.speciesId,task.route.method,task.route.map,task.route.rodItemId],[98,'fishing','MAP_ROUTE12',263],
  'Krabby (Good Rod, 20% of a 60-rate table) outranks Qwilfish (Super Rod, 40% of a 20-rate table)');
 assert.equal(task.request.shiny,'any');
 assert.deepEqual(state.target,{speciesId:98,map:'MAP_ROUTE12'});
 const next=selectNationalDexCapture({o:observation(),world,mechanics,state:{failed:{98:{retryAt:Date.now()+60000}}}});
 assert.deepEqual([next.request.speciesId,next.route.map,next.route.rodItemId],[211,'MAP_FIVE_ISLAND_MEADOW',264],'the LeafGreen Route 12 table is never used');
});

test('a rod that is neither owned nor still obtainable never produces a fishing hunt',()=>{
 // The Good Rod gift is flagged as received, yet the Bag has no Good Rod: do not invent one.
 const o=observation({rods:[],flags:{580:true,597:true}});
 assert.equal(selectNationalDexCapture({o,world,mechanics,state:{}}),null);
});

const route={speciesId:98,nativeSpecies:98,map:'MAP_ROUTE12',method:'fishing',rodItemId:263,name:'krabby'};
const request={schema:'pokemon-suite/farming-request/v1',game:'firered',speciesId:98,quantity:1,locationId:'any',shiny:'any',natures:[],gender:'any',abilityId:null,
 ball:{id:'any',requirement:'preferred'},minIvs:{},minDvs:{},encounterLevel:{min:1,max:100},finalLevel:null,moves:[],heldItemId:null,
 limits:{maxEncounters:10000,maxMinutes:120,minBalls:10,maxSpend:999999},afterCompletion:'stop-save'};
const mission=(state=null,r=route)=>createSuiteMission({id:'postgame-national-collection-krabby',request,route:r,state,world,mechanics});

test('a fishing hunt collects a missing rod from its giver, then fishes without Sweet Scent or land RNG',()=>{
 let m=mission();const o=observation({rods:[264]});m.initialize(o);
 assert.equal(m.state.method,'fishing');
 assert.ok(m.storyWatch().flags.includes(580),'the Good Rod gift flag is watched');
 let next=m.inspect(o);
 assert.equal(next.kind,'policy');assert.deepEqual(next.objective.target,{kind:'object',map:'MAP_FUCHSIA_CITY_HOUSE2',index:0});
 assert.equal(next.objective.choice,'yes');assert.deepEqual(next.objective.completion,{kind:'flag-set',id:580});
 m=mission(JSON.parse(JSON.stringify(m.state)));
 o.playerMemory.trainer.bag.keyItems.push({itemId:263,quantity:1});o.playerMemory.storyState.flagIds[580]=true;
 next=m.inspect(o);
 assert.deepEqual(next.objective?.target,{kind:'fishing-zone',map:'MAP_ROUTE12',rodItemId:263});assert.equal(m.state.phase,'traveling');
 o.playerMemory.map.id='MAP_ROUTE12';next=m.inspect(o);
 assert.notEqual(next.kind,'rng','fishing encounters have no land RNG plan');
 assert.deepEqual(next.objective?.target,{kind:'fishing-zone',map:'MAP_ROUTE12',rodItemId:263});assert.equal(m.state.phase,'hunting');
 assert.deepEqual(m.capturePolicy().targets[0].required.species,[98]);assert.equal(m.capturePolicy().area,'MAP_ROUTE12');
});

test('a fishing hunt protects the requested bite and escapes from others',()=>{
 const m=mission(),o=observation({rods:[263,264],flags:{580:true}});m.initialize(o);
 o.playerMemory.map.id='MAP_ROUTE12';o.emulator.inBattle=true;o.playerMemory.battleTypeFlags=0;
 o.playerMemory.encounter={kind:'wild',validity:'valid',pokemon:{validity:'valid',species:129,personality:5,otId:1,shiny:false,isEgg:false}};
 assert.equal(m.inspect(o).kind,'policy');
 o.playerMemory.encounter={kind:'wild',validity:'valid',pokemon:{validity:'valid',species:98,personality:6,otId:1,shiny:false,isEgg:false,ivs:{hp:1,attack:1,defense:1,speed:1,spAttack:1,spDefense:1},nature:{id:0}}};
 o.emulator.inBattle=false;m.inspect(o);o.emulator.inBattle=true;
 assert.equal(m.inspect(o).kind,'protect');
});

test('a fishing route must name a rod whose native table slot holds the species',()=>{
 assert.throws(()=>mission(null,{...route,rodItemId:264}),/fishing/i,'Krabby is not in the Route 12 Super Rod slots');
 assert.throws(()=>mission(null,{...route,rodItemId:999}),/rod/i);
 assert.doesNotThrow(()=>mission(null,{...route,speciesId:98}));
});
