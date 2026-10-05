import test from 'node:test';
import assert from 'node:assert/strict';
import {helperTaskHunt,helperTaskAllows} from '../src/suite/extra-save-tasks.js';
import {createSuiteMission} from '../src/suite/mission.js';

// build 126: an archived save's helper tasks are ordinary hunts the host
// starts: the Fighting Dojo prize (a gift) and the roaming dog (RoamerMission:
// National Dex, Celio's link, the release, the capture). The worker accepts a
// helper's hunt only when it is exactly one of the tasks in its config.
const FIRE='08b8c4c8-5802-4f2f-9aa1-5521fa723563';
const world={data:{maps:[{id:'MAP_SAFFRON_CITY_DOJO',objectEvents:[0,1,2,3,4,{script:'SaffronCity_Dojo_EventScript_HitmonleeBall'},{script:'SaffronCity_Dojo_EventScript_HitmonchanBall'}].map(e=>typeof e==='number'?{script:'x'}:e)},
 {id:'MAP_ONE_ISLAND_POKEMON_CENTER_1F',objectEvents:[{script:'OneIsland_PokemonCenter_1F_EventScript_Celio'}]}]}};
test('the Dojo prize and the roaming dog are ordinary hunts for the helper owner',()=>{
 const dojo=helperTaskHunt({kind:'dojo-prize',speciesId:107,profileId:FIRE});
 assert.equal(dojo.id,'helper-dojo-107-08b8c4c8');
 assert.deepEqual([dojo.route.method,dojo.route.map,dojo.route.index,dojo.request.speciesId,dojo.request.shiny],['gift','MAP_SAFFRON_CITY_DOJO',6,107,'any']);
 assert.equal(createSuiteMission({id:dojo.id,request:dojo.request,route:dojo.route,world}).state.method,'gift');
 const roamer=helperTaskHunt({kind:'roamer-capture',speciesId:245,profileId:FIRE});
 assert.equal(roamer.id,'helper-roamer-245-08b8c4c8');
 assert.equal(createSuiteMission({id:roamer.id,request:roamer.request,route:roamer.route,world}).state.method,'roamer');
 assert.throws(()=>helperTaskHunt({kind:'dojo-prize',speciesId:25,profileId:FIRE}),/unsupported/);
 assert.throws(()=>helperTaskHunt({kind:'starter',speciesId:4,profileId:FIRE}),/helper task/);
});
test('a helper accepts only the hunts its configuration names',()=>{
 const dojo=helperTaskHunt({kind:'dojo-prize',speciesId:107,profileId:FIRE}),cfg={extraSaveHelper:{tasks:[{kind:'dojo-prize',speciesId:107,hunt:dojo}]}};
 assert.equal(helperTaskAllows(cfg,{type:'start',record:{id:dojo.id,request:dojo.request,route:dojo.route}}),true);
 assert.equal(helperTaskAllows(cfg,{type:'start',record:{id:dojo.id,request:{...dojo.request,shiny:'required'},route:dojo.route}}),false,'the request must be unchanged');
 assert.equal(helperTaskAllows(cfg,{type:'start',record:{id:'other',request:dojo.request,route:dojo.route}}),false);
 assert.equal(helperTaskAllows({extraSaveHelper:{saveId:'helper-1'}},{type:'start',record:{id:dojo.id,request:dojo.request,route:dojo.route}}),false,'a story helper has no hunt tasks');
 assert.equal(helperTaskAllows({extraSaveHelper:{park:true}},{type:'player-task',request:{id:'park-08b8c4c8',kind:'park',map:'MAP_CELADON_CITY_POKEMON_CENTER_1F',goals:[{speciesId:107}]}}),true);
 assert.equal(helperTaskAllows({extraSaveHelper:{park:true}},{type:'player-task',request:{id:'p',kind:'travel',map:'MAP_VIRIDIAN_CITY_POKEMON_CENTER_1F'}}),true);
 assert.equal(helperTaskAllows({extraSaveHelper:{park:true}},{type:'player-task',request:{id:'p',kind:'item',itemId:68,quantity:1}}),false);
 assert.equal(helperTaskAllows({extraSaveHelper:{saveId:'helper-1'}},{type:'player-task',request:{id:'p',kind:'travel',map:'MAP_PALLET_TOWN'}}),false);
});
