import test from 'node:test';
import assert from 'node:assert/strict';
import {resolveFireRedTravel,fireRedIsland,fireRedPokemonCenter} from '../src/suite/fire-red-link-quest.js';
const target={id:'prepare-sweet-scent',target:{kind:'party-roster',map:'MAP_CERULEAN_CITY_POKEMON_CENTER_1F',requiredFamilies:[[43]]},deferOptionalDetours:true};
const at=map=>({playerMemory:{map:{id:map}}});
test('Trainer Tower interiors belong to Seven Island for arrival, departure and healing',()=>{
 for(const suffix of ['LOBBY','ELEVATOR','ROOF',...Array.from({length:8},(_,i)=>`${i+1}F`)]){
  const map='MAP_TRAINER_TOWER_'+suffix;
  assert.equal(fireRedIsland(map),7,map);
  assert.equal(fireRedPokemonCenter(map),'MAP_SEVEN_ISLAND_POKEMON_CENTER_1F');
  const visit={id:'tower',target:{kind:'map-arrival',map}};
  assert.equal(resolveFireRedTravel(visit,at('MAP_SEVEN_ISLAND')),visit);
  assert.equal(resolveFireRedTravel(visit,at('MAP_FOUR_ISLAND_HARBOR')).target.map,'MAP_SEVEN_ISLAND');
  assert.equal(resolveFireRedTravel(target,at(map)).target.map,'MAP_SEVEN_ISLAND');
 }
});
test('a current-game hunt leaves an island Center through the harbor before Kanto travel',()=>{
 assert.deepEqual(resolveFireRedTravel(target,at('MAP_ONE_ISLAND_POKEMON_CENTER_2F')).target,{kind:'map',map:'MAP_ONE_ISLAND'});
 assert.deepEqual(resolveFireRedTravel(target,at('MAP_ONE_ISLAND')).target,{kind:'seagallop-destination',map:'MAP_VERMILION_CITY'});
 assert.deepEqual(resolveFireRedTravel(target,at('MAP_ONE_ISLAND_HARBOR')).target,{kind:'seagallop-destination',map:'MAP_VERMILION_CITY'});
 assert.equal(resolveFireRedTravel(target,at('MAP_VERMILION_CITY')),target);
});
test('Sevii hunts cross via the proper departure port without rewriting local objectives',()=>{
 const hunt={id:'hunt-hoppip',target:{kind:'encounter-zone',map:'MAP_FIVE_ISLAND_MEMORIAL_PILLAR'}};
 assert.equal(resolveFireRedTravel(hunt,at('MAP_ROUTE1')).target.map,'MAP_VERMILION_CITY');
 assert.equal(resolveFireRedTravel(hunt,at('MAP_VERMILION_CITY')).target.kind,'seagallop-destination');
 assert.equal(resolveFireRedTravel(hunt,at('MAP_FIVE_ISLAND')),hunt);
});
const names=['VERMILION_CITY','ONE_ISLAND','TWO_ISLAND','THREE_ISLAND','FOUR_ISLAND','FIVE_ISLAND','SIX_ISLAND','SEVEN_ISLAND'];
const ferryWorld={maps:names.slice(1).map(name=>({id:`MAP_${name}_HARBOR`,warpEvents:[{dest_map:`MAP_${name}${name==='THREE_ISLAND'?'_PORT':''}`}]}))};
test('Three Island restocking keeps the ferry destination through its intermediate port',()=>{
 const purchase={id:'hunt-stock-balls',target:{kind:'purchase-items',map:'MAP_VIRIDIAN_CITY_MART',items:[{itemId:4,quantity:13}]}};
 for(const map of ['MAP_THREE_ISLAND','MAP_THREE_ISLAND_PORT','MAP_THREE_ISLAND_HARBOR']){
  const resolved=resolveFireRedTravel(purchase,at(map),ferryWorld);
  assert.deepEqual(resolved.target,{kind:'seagallop-destination',map:'MAP_VERMILION_CITY'},map);
 }
 assert.equal(resolveFireRedTravel(purchase,at('MAP_VERMILION_CITY'),ferryWorld),purchase);
});
test('every island departure keeps its destination across the cartridge-defined harbor entrance',()=>{
 for(let origin=1;origin<names.length;origin++)for(let destination=0;destination<names.length;destination++){
  if(origin===destination)continue;
  const entrance=ferryWorld.maps[origin-1].warpEvents[0].dest_map;
  const goal={id:'cross-island',target:{kind:'map',map:`MAP_${names[destination]}`}};
  for(const map of [`MAP_${names[origin]}`,entrance,`MAP_${names[origin]}_HARBOR`])assert.deepEqual(resolveFireRedTravel(goal,at(map),ferryWorld).target,{kind:'seagallop-destination',map:goal.target.map});
 }
});
test('arrival and local island errands retain the requested objective at the port',()=>{
 const hunt={id:'hunt-venomoth',target:{kind:'encounter-zone',map:'MAP_THREE_ISLAND_BERRY_FOREST'}};
 for(const map of ['MAP_THREE_ISLAND_HARBOR','MAP_THREE_ISLAND_PORT','MAP_THREE_ISLAND'])assert.equal(resolveFireRedTravel(hunt,at(map),ferryWorld),hunt);
});
