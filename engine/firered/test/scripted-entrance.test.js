import test from 'node:test';
import assert from 'node:assert/strict';
import {campaignNavigationRecommendation} from '../src/player/campaign.js';

function fixture({inside,outside,flag}){
 const center='MAP_TEST_CENTER';
 const map=(id,warps,doors={},objects=[])=>({id,properties:{},warpEvents:warps,connections:[],objectEvents:objects,coordEvents:[],layout:{id,width:5,height:5,cells:Array.from({length:25},(_,i)=>({x:i%5,y:Math.floor(i/5),collision:doors[i%5+','+Math.floor(i/5)]?1:0,elevation:3,behaviorName:doors[i%5+','+Math.floor(i/5)]??(i===22?'MB_SOUTH_ARROW_WARP':'MB_NORMAL')}))}});
 const maps=[map(center,[{x:2,y:4,dest_map:outside,dest_warp_id:'0'}]),
  map(outside,[{x:1,y:1,dest_map:center,dest_warp_id:'0'},{x:3,y:1,dest_map:inside,dest_warp_id:'0'}],{'1,1':'MB_WARP_DOOR','3,1':'MB_NORMAL'}),
  map(inside,[{x:2,y:4,dest_map:outside,dest_warp_id:'1'}],{},[{x:2,y:1,elevation:3,flag:'0',script:'Test_Objective'}])];
 const world={data:{maps}},objective={id:'retained-quest',target:{kind:'object',map:inside,index:0}};
 const o={phase:'stable',emulator:{mode:'overworld',inBattle:false},playerMemory:{map:{id:center},position:{x:2,y:2},storyState:{flagIds:{[flag]:true},flags:{},variableIds:{},variables:{}},trainer:{party:[],bag:{}}}};
 const decide=()=>campaignNavigationRecommendation({world,observation:o,objective});
 return {o,maps,objective,decide,center};
}

for(const entry of [
 {inside:'MAP_FIVE_ISLAND_ROCKET_WAREHOUSE',outside:'MAP_FIVE_ISLAND_MEADOW',flag:726},
 {inside:'MAP_SIX_ISLAND_DOTTED_HOLE_1F',outside:'MAP_SIX_ISLAND_RUIN_VALLEY',flag:739},
]){
 test('an unlocked scripted entrance stages a return from another map: '+entry.inside,()=>{
  const {o,maps,objective,decide}=fixture(entry),original=structuredClone(objective);
  const leave=decide();assert.equal(leave?.kind,'move-toward');assert.equal(leave.direction,'south');
  assert.equal(leave.objective,objective.id);assert.equal(leave.transit.destinationMap,entry.outside);
  // Being on the exterior is not proof the door is open. Use the cartridge grid.
  o.playerMemory.map.id=entry.outside;o.playerMemory.position={x:1,y:2};
  assert.equal(decide(),null,'do not invent an open door from the flag alone');
  o.playerMemory.mapGrid=structuredClone(maps[1].layout);
  o.playerMemory.mapGrid.cells.find(c=>c.x===3&&c.y===1).behaviorName='MB_WARP_DOOR';
  const enter=decide();assert.equal(enter?.kind,'move-toward');assert.equal(enter.transit.destinationMap,entry.inside);
  o.playerMemory.map.id=entry.inside;o.playerMemory.position={x:2,y:2};delete o.playerMemory.mapGrid;
  assert.equal(decide()?.kind,'interact-with-object');
  assert.deepEqual(objective,original,'approach routing must not replace the owning quest');
 });
 test('an unverified or locked entrance is not offered as a route: '+entry.inside,()=>{
  const {o,decide}=fixture(entry);
  for(const value of [false,undefined]){o.playerMemory.storyState.flagIds[entry.flag]=value;assert.equal(decide(),null);}
 });
}

test('a verified ordinary route into the target retains priority over entrance staging',()=>{
 const entry={inside:'MAP_FIVE_ISLAND_ROCKET_WAREHOUSE',outside:'MAP_FIVE_ISLAND_MEADOW',flag:726};
 const {maps,decide}=fixture(entry);
 maps[1].layout.cells.find(c=>c.x===3&&c.y===1).behaviorName='MB_WARP_DOOR';
 assert.equal(decide()?.targetMap,entry.inside);
});

test('an unreachable interior target cannot cause an exit and reentry loop',()=>{
 const entry={inside:'MAP_SIX_ISLAND_DOTTED_HOLE_SAPPHIRE_ROOM',outside:'MAP_SIX_ISLAND_RUIN_VALLEY',flag:739};
 const {o,maps,decide}=fixture(entry);
 o.playerMemory.map.id=entry.inside;o.playerMemory.position={x:2,y:3};
 o.playerMemory.mapGrid=structuredClone(maps[2].layout);
 for(const cell of o.playerMemory.mapGrid.cells)if(cell.y===2)cell.collision=1;
 assert.equal(decide(),null,'the live interior obstruction needs its own route');
});

// Mt. Ember: MtEmber_Exterior_OnLoad opens the Ruby Path cave door at (42,39)
// once VAR_MAP_SCENE_ONE_ISLAND_POKEMON_CENTER_1F (0x4076) is at least 4. The
// static exterior still has the closed tile, and the only way into every Ruby
// Path floor is that door. B3F's ladder sits behind a Strength boulder.
function emberFixture(options={}){
 const value=Object.hasOwn(options,'value')?options.value:4;
 const center='MAP_ONE_ISLAND_KINDLE_ROAD',outside='MAP_MT_EMBER_EXTERIOR',entry='MAP_MT_EMBER_RUBY_PATH_1F';
 const b2f='MAP_MT_EMBER_RUBY_PATH_B2F',b3f='MAP_MT_EMBER_RUBY_PATH_B3F';
 const map=(id,warps,cells={},objects=[],grass=false)=>({id,properties:{},warpEvents:warps,connections:[],objectEvents:objects,coordEvents:[],
  layout:{id,width:5,height:5,cells:Array.from({length:25},(_,i)=>{const x=i%5,y=Math.floor(i/5),cell=cells[x+','+y];
   return {x,y,collision:cell?.collision??0,elevation:3,encounterType:grass&&y>=2&&!cell?1:0,behaviorName:cell?.behavior??(i===22?'MB_SOUTH_ARROW_WARP':'MB_NORMAL')};})}});
 const wall={behavior:'MB_NORMAL',collision:1},ladder={behavior:'MB_LADDER',collision:0};
 const maps=[
  map(center,[{x:2,y:4,dest_map:outside,dest_warp_id:'0'}]),
  map(outside,[{x:1,y:1,dest_map:center,dest_warp_id:'0'},{x:3,y:1,dest_map:entry,dest_warp_id:'0'}],{'1,1':{behavior:'MB_WARP_DOOR',collision:1},'3,1':wall}),
  map(entry,[{x:2,y:4,dest_map:outside,dest_warp_id:'1'},{x:2,y:0,dest_map:b2f,dest_warp_id:'0'}],{'2,0':ladder}),
  // B2F: the B3F ladder (4,0) is enclosed by a wall (3,0) and a boulder (4,1).
  map(b2f,[{x:0,y:0,dest_map:entry,dest_warp_id:'1'},{x:4,y:0,dest_map:b3f,dest_warp_id:'0'}],{'0,0':ladder,'4,0':ladder,'3,0':wall},
   [{x:4,y:1,elevation:3,graphics_id:'OBJ_EVENT_GFX_PUSHABLE_BOULDER',script:'MtEmber_RubyPath_B2F_EventScript_Boulder'}],true),
  map(b3f,[{x:0,y:0,dest_map:b2f,dest_warp_id:'1'}],{'0,0':ladder},[],true),
 ];
 const world={data:{maps}};
 const o={phase:'stable',emulator:{mode:'overworld',inBattle:false},playerMemory:{map:{id:center},position:{x:2,y:2},
  storyState:{flagIds:{},flags:{},variableIds:value===undefined?{}:{[0x4076]:value},variables:{}},trainer:{party:[],bag:{}}}};
 const hunt=map=>({id:'hunt-requested-pokemon',target:{kind:'encounter-zone',map}});
 const decide=(objective=hunt(b2f))=>campaignNavigationRecommendation({world,observation:o,objective});
 return {o,maps,decide,hunt,center,outside,entry,b2f,b3f};
}

test('the variable-gated Mt. Ember cave entrance stages a Ruby Path hunt from another map',()=>{
 const {o,maps,decide,hunt,outside,entry,b2f}=emberFixture(),objective=hunt(b2f),original=structuredClone(objective);
 const leave=decide(objective);
 assert.equal(leave?.kind,'move-toward');assert.equal(leave.direction,'south');
 assert.equal(leave.objective,objective.id);assert.equal(leave.transit.destinationMap,outside);
 // Standing on the exterior does not prove the door is open. Use the live grid.
 o.playerMemory.map.id=outside;o.playerMemory.position={x:1,y:2};
 assert.equal(decide(objective),null,'do not invent an open cave door from the scene variable alone');
 o.playerMemory.mapGrid=structuredClone(maps[1].layout);
 Object.assign(o.playerMemory.mapGrid.cells.find(c=>c.x===3&&c.y===1),{behaviorName:'MB_CAVE_DOOR',collision:0});
 const enter=decide(objective);
 assert.equal(enter?.kind,'move-toward');assert.equal(enter.transit.destinationMap,entry);assert.equal(enter.targetMap,b2f);
 o.playerMemory.map.id=entry;o.playerMemory.position={x:2,y:3};delete o.playerMemory.mapGrid;
 assert.equal(decide(objective)?.transit?.destinationMap,b2f,'the ordinary Ruby Path graph continues below the entrance');
 assert.deepEqual(objective,original,'approach routing must not replace the owning hunt');
});

test('a closed or unread Mt. Ember scene variable is not offered as a route',()=>{
 for(const value of [3,undefined,null]){
  const {decide}=emberFixture({value});
  assert.equal(decide(),null,'0x4076 '+value);
 }
});

test('a Ruby Path target behind a static Strength boulder does not stage the trip',()=>{
 const {o,decide,hunt,b2f,b3f}=emberFixture();
 assert.equal(decide(hunt(b3f)),null,'B3F is unreachable from the entrance landing, so do not walk to Mt. Ember and stall');
 o.playerMemory.map.id=b2f;o.playerMemory.position={x:0,y:2};
 assert.equal(decide(hunt(b3f)),null,'the boulder still bounds the live B2F route');
});
