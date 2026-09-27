import assert from 'node:assert/strict';
import test from 'node:test';
import {campaignNavigationRecommendation} from '../src/player/campaign.js';

// Two disconnected Route 23 approaches share one map ID. Returning to Kanto
// requires the south approach, reached through the main rooms of the cave.
function fixture() {
  const ids = ['MAP_VICTORY_ROAD_1F','MAP_VICTORY_ROAD_2F','MAP_VICTORY_ROAD_3F','MAP_ROUTE23','MAP_ROUTE20'];
  const maps = ids.map(id => ({id, layout:{width:13,height:7,cells:[]},warpEvents:[]}));
  for (const map of maps) for(let y=0;y<7;y++) for(let x=0;x<13;x++) {
    map.layout.cells.push({x,y,collision:[ids[1],ids[3]].includes(map.id)&&x===6?1:0,elevation:3,behaviorName:'MB_NORMAL'});
  }
  const link=(from,index,x,y,to,dest)=>{
    maps[from].warpEvents[index]={x,y,dest_map:ids[to],dest_warp_id:String(dest)};
    maps[from].layout.cells.find(c=>c.x===x&&c.y===y).behaviorName='MB_LADDER';
  };
  link(0,0,2,2,1,0); link(0,1,4,4,3,0);
  link(1,0,1,4,0,0); link(1,2,2,2,2,1); link(1,3,9,2,2,2); link(1,6,11,4,3,1);
  link(2,1,2,2,1,2); link(2,2,10,2,1,3);
  link(3,0,2,2,0,1); link(3,1,10,2,1,6); link(3,2,2,4,4,0);
  link(4,0,2,2,3,2);
  // Unused cartridge warp slots have no activating tile.
  for(const map of maps) for(let i=0;i<map.warpEvents.length;i++) map.warpEvents[i]??={x:0,y:0,dest_map:'MAP_UNUSED',dest_warp_id:'0'};
  const observation=(map,x,y)=>({phase:'stable',emulator:{mode:'overworld'},playerMemory:{
    map:{id:ids[map]},position:{x,y},storyState:{flagIds:{88:true},variableIds:{0x4066:100,0x4067:100}},trainer:{party:[],bag:{}}}});
  return {world:{maps},observation,ids};
}

test('Victory Road returns through the main rooms for a retained southbound destination',()=>{
  const {world,observation,ids}=fixture();
  const objective={id:'return-to-training',target:{kind:'map-arrival',map:ids[4],x:3,y:3}};
  const navigate=o=>campaignNavigationRecommendation({world,observation:o,objective:structuredClone(objective)});
  const entered=navigate(observation(1,11,4));
  assert.equal(entered?.transit?.destinationMap,ids[2],'leave the north exit pocket through the return ladder');
  const third=navigate(observation(2,10,2));
  assert.equal(third?.transit?.destinationMap,ids[1]);
  assert.equal(third?.transit?.x,2,'cross to the main-room ladder');
  const main=navigate(observation(1,2,2));
  assert.equal(main?.transit?.destinationMap,ids[0],'handoff to normal routing must not bounce back to 3F');
  const first=navigate(observation(0,2,2));
  assert.equal(first?.transit?.destinationMap,ids[3]);
  const outside=navigate(observation(3,2,2));
  assert.equal(outside?.transit?.destinationMap,ids[4]);
  for(const r of [entered,third,main,first,outside]) assert.equal(r.objective,objective.id);
});

test('Victory Road resolves the requested region even when both exits share a map name',()=>{
  const {world,observation,ids}=fixture();
  const target=(x,y)=>({id:'return-to-route',target:{kind:'map-arrival',map:ids[3],x,y}});
  const from=observation(1,10,4);
  const south=campaignNavigationRecommendation({world,observation:from,objective:target(3,3)});
  const north=campaignNavigationRecommendation({world,observation:from,objective:target(10,3)});
  assert.equal(south?.transit?.destinationMap,ids[2]);
  assert.equal(north?.transit?.destinationMap,ids[3]);
});
