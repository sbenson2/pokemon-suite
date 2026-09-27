import test from 'node:test';
import assert from 'node:assert/strict';
import { readTownMapPosition } from '../src/presentation/region-map.js';
import { createSpectatorStatus } from '../src/presentation/player-status.js';
const map=(id,section,width,height,type='MAP_TYPE_ROUTE',number=1)=>({id,group:3,number,properties:{region_map_section:section,map_type:type},layout:{width,height}});
function read(current,position={x:0,y:0},warp=null){
 const save=new Uint8Array(64),fields={escapeWarp:{offset:36},dynamicWarp:{offset:20}};
 if(warp){save[36]=warp.map.group;save[37]=warp.map.number;const v=new DataView(save.buffer);v.setInt16(40,warp.x,true);v.setInt16(42,warp.y,true);}
 return readTownMapPosition({map:current,position,save,fields,resolveMap:(g,n)=>warp?.map.group===g&&warp?.map.number===n?warp.map:null});
}
test('Town Map route divisions and Route 21 halves match the game',()=>{
 const route=map('MAP_ROUTE1','MAPSEC_ROUTE_1',20,36);
 assert.deepEqual(read(route,{x:4,y:3}),{region:'kanto',x:4,y:9});
 assert.deepEqual(read(route,{x:4,y:30}),{region:'kanto',x:4,y:10});
 assert.deepEqual(read(map('MAP_ROUTE21_NORTH','MAPSEC_ROUTE_21',20,50,'MAP_TYPE_OCEAN_ROUTE',39)),{region:'kanto',x:4,y:12});
 assert.deepEqual(read(map('MAP_ROUTE21_SOUTH','MAPSEC_ROUTE_21',20,50,'MAP_TYPE_OCEAN_ROUTE',40)),{region:'kanto',x:4,y:13});
});
test('Caves use the observed escape entrance, not an invented section center',()=>{
 const cave=map('MAP_MT_MOON_1F','MAPSEC_MT_MOON',40,36,'MAP_TYPE_UNDERGROUND');
 const entry=map('MAP_ROUTE4','MAPSEC_ROUTE_4',90,18);
 assert.deepEqual(read(cave,{x:1,y:1},{map:entry,x:88,y:5}),{region:'kanto',x:13,y:3});
 assert.equal(read(cave),null);
});
test('Sevii and fixed landmark overrides match in-game placement',()=>{
 for(const [section,region,x,y] of [['MAPSEC_SILPH_CO','kanto',14,6],['MAPSEC_MT_EMBER','sevii-123',2,3],['MAPSEC_ROCKET_WAREHOUSE','sevii-45',17,11],['MAPSEC_MONEAN_CHAMBER','sevii-67',9,12]]){
  assert.deepEqual(read(map('MAP_DUNGEON',section,10,10,'MAP_TYPE_INDOOR')),{region,x,y});
 }
});
test('Unavailable metadata stays unknown and presentation does not mutate observations',()=>{
 assert.equal(read(map('MAP_UNKNOWN','MAPSEC_NONE',0,0)),null);
 const observation={playerMemory:{townMap:{region:'sevii-123',x:2,y:3},trainer:{gender:'GIRL'}}};
 const before=structuredClone(observation);
 assert.deepEqual(createSpectatorStatus({observation}).map.townMap,{region:'sevii-123',x:2,y:3});
 assert.deepEqual(observation,before);
});
