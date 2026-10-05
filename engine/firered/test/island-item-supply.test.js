import test from 'node:test';
import assert from 'node:assert/strict';
import {createCampaignPlanner} from '../src/player/campaign.js';
import {resolveFireRedTravel} from '../src/suite/fire-red-link-quest.js';

// The Sun Stone (Six Island Ruin Valley), Metal Coat (Five Island Memorial
// Pillar) and Lax Incense (Five Island Lost Cave) are item balls on the Sevii
// Islands. Item preparation measured routes only within the current island's
// graph, so from Kanto every Sevii item looked unreachable and Bellossom,
// Scizor and Wynaut stayed out of reach. The Seagallop leg is planned by
// resolveFireRedTravel; the item is measured from its island's ferry landing.
const room=(id,{width=10,height=10,warps=[],objects=[]}={})=>({id,properties:{},connections:[],warpEvents:warps,coordEvents:[],backgroundEvents:[],objectEvents:objects,
 layout:{id,width,height,cells:Array.from({length:width*height},(_,i)=>({x:i%width,y:Math.floor(i/width),collision:0,elevation:3,encounterType:0,
  behaviorName:warps.some(w=>w.x===i%width&&w.y===Math.floor(i/width))?'MB_LADDER':'MB_NORMAL'}))}});
const ball={graphics_id:'OBJ_EVENT_GFX_ITEM_BALL',x:5,y:2,elevation:3,script:'SixIsland_RuinValley_EventScript_ItemSunStone',flag:'FLAG_HIDE_SIX_ISLAND_RUIN_VALLEY_SUN_STONE'};
const world={data:{maps:[
 room('MAP_LAVENDER_TOWN'),
 room('MAP_SIX_ISLAND_HARBOR',{warps:[{x:9,y:9,dest_map:'MAP_SIX_ISLAND_RUIN_VALLEY',dest_warp_id:'0'}]}),
 room('MAP_SIX_ISLAND_RUIN_VALLEY',{warps:[{x:0,y:9,dest_map:'MAP_SIX_ISLAND_HARBOR',dest_warp_id:'0'}],objects:[ball]}),
],wildEncounters:[]}};
const story={data:{symbols:{flags:{FLAG_HIDE_SIX_ISLAND_RUIN_VALLEY_SUN_STONE:{value:486}},items:{ITEM_SUN_STONE:{value:93}}},
 scripts:[{label:'SixIsland_RuinValley_EventScript_ItemSunStone',instructions:[{op:'finditem',args:['ITEM_SUN_STONE']}]}]}};
const observation=(map,flag=false)=>({phase:'stable',frame:1,emulator:{mode:'overworld'},playerMemory:{map:{id:map},position:{x:2,y:2},ui:{},
 storyState:{flagIds:{486:flag,2092:true,2112:true,2116:true},variableIds:{}},trainer:{money:500000,partyValidity:'valid',party:[],bag:{items:[],keyItems:[]}}}});

test('an item ball on another island is collectible through the Seagallop leg',()=>{
 const planner=createCampaignPlanner({campaign:{objectives:[]},world,story,mechanics:{data:{species:[]}}});
 const objective=planner.selectItemPreparation(observation('MAP_LAVENDER_TOWN'),93);
 assert.deepEqual(objective?.target,{kind:'object',map:'MAP_SIX_ISLAND_RUIN_VALLEY',index:0});
 assert.deepEqual(objective.completion,{kind:'flag-set',id:486});
 assert.equal(resolveFireRedTravel(objective,observation('MAP_VERMILION_CITY'),world).target.kind,'seagallop-destination','the next leg is the ferry');
 assert.equal(planner.selectItemPreparation(observation('MAP_LAVENDER_TOWN',true),93),null,'a collected item ball is never chased');
 const unwatched=observation('MAP_LAVENDER_TOWN');delete unwatched.playerMemory.storyState.flagIds[486];
 assert.equal(planner.selectItemPreparation(unwatched,93),null,'an unverified flag is never assumed clear across the ferry');
});
