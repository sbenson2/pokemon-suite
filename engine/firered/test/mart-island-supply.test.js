import test from 'node:test';
import assert from 'node:assert/strict';
import {createCampaignPlanner} from '../src/player/campaign.js';
import {resolveFireRedTravel} from '../src/suite/fire-red-link-quest.js';

// Live October 1: the main save hatched a plain Eevee at the Four Island Day Care
// and then stood idle: "2 more are possible in this save but need a workflow the
// bot does not have yet: flareon, …". FireRed sells the Fire Stone only at the
// Celadon Department Store 4F (pret pokefirered data/maps/
// CeladonCity_DepartmentStore_4F/scripts.inc), and Mt. Ember's two are off the
// navigation graph. Item preparation measured marts only on the current
// island, so from the Sevii Islands no purchase was ever offered. Like an item
// ball, a mart on another island is reached by the Seagallop leg
// resolveFireRedTravel plans, measured from that island's ferry landing.
const room=(id,{width=10,height=10,warps=[],objects=[]}={})=>({id,properties:{},connections:[],warpEvents:warps,coordEvents:[],backgroundEvents:[],objectEvents:objects,
 layout:{id,width,height,cells:Array.from({length:width*height},(_,i)=>({x:i%width,y:Math.floor(i/width),collision:0,elevation:3,encounterType:0,
  behaviorName:warps.some(w=>w.x===i%width&&w.y===Math.floor(i/width))?'MB_LADDER':'MB_NORMAL'}))}});
const clerk={graphics_id:'OBJ_EVENT_GFX_CLERK',x:5,y:2,elevation:3,script:'CeladonCity_DepartmentStore_4F_EventScript_Clerk',flag:'0'};
const STORE='MAP_CELADON_CITY_DEPARTMENT_STORE_4F';
const world={data:{maps:[
 room('MAP_FOUR_ISLAND'),
 room('MAP_VERMILION_CITY',{width:30,height:40,warps:[{x:23,y:33,dest_map:STORE,dest_warp_id:'0'}]}),
 room(STORE,{warps:[{x:0,y:9,dest_map:'MAP_VERMILION_CITY',dest_warp_id:'0'}],objects:[clerk]}),
 room('MAP_LAVENDER_TOWN'),
],wildEncounters:[]}};
const story={data:{symbols:{items:{ITEM_POKE_DOLL:{value:80},ITEM_RETRO_MAIL:{value:132},ITEM_FIRE_STONE:{value:95}}},
 scripts:[
  {label:'CeladonCity_DepartmentStore_4F_EventScript_Clerk',instructions:[{op:'pokemart',args:['CeladonCity_DepartmentStore_4F_Items']}]},
  {label:'CeladonCity_DepartmentStore_4F_Items',instructions:[{op:'.2byte',args:['ITEM_POKE_DOLL']},{op:'.2byte',args:['ITEM_RETRO_MAIL']},{op:'.2byte',args:['ITEM_FIRE_STONE']},{op:'.2byte',args:['ITEM_NONE']}]},
 ]}};
const observation=(map,money=500000)=>({phase:'stable',frame:1,emulator:{mode:'overworld'},playerMemory:{map:{id:map},position:{x:2,y:2},ui:{},
 storyState:{flagIds:{2092:true,2112:true,2116:true},variableIds:{}},trainer:{money,partyValidity:'valid',party:[],bag:{items:[],keyItems:[]}}}});
const planner=()=>createCampaignPlanner({campaign:{objectives:[]},world,story,mechanics:{data:{species:[]}}});

test('a Fire Stone sold in Kanto is offered from the Sevii Islands through the Seagallop leg',()=>{
 const objective=planner().selectItemPreparation(observation('MAP_FOUR_ISLAND'),95);
 assert.deepEqual(objective?.target,{kind:'purchase-items',map:STORE,objectIndex:0,items:[{itemId:95,quantity:1,unitPrice:2100,stockIndex:2}]});
 assert.equal(objective.identityEvolution,true);
 const leg=resolveFireRedTravel(objective,observation('MAP_FOUR_ISLAND_HARBOR'),world);
 assert.equal(leg.target.kind,'seagallop-destination','the next leg is the ferry');
 assert.equal(leg.target.map,'MAP_VERMILION_CITY');
});

test('in Kanto the same clerk is measured on the local graph',()=>{
 const objective=planner().selectItemPreparation(observation('MAP_VERMILION_CITY'),95);
 assert.deepEqual(objective?.target,{kind:'purchase-items',map:STORE,objectIndex:0,items:[{itemId:95,quantity:1,unitPrice:2100,stockIndex:2}]});
 assert.equal(resolveFireRedTravel(objective,observation('MAP_VERMILION_CITY'),world),objective,'no ferry leg inside Kanto');
});

test('the cross-island purchase keeps the money and reachability checks',()=>{
 assert.equal(planner().selectItemPreparation(observation('MAP_FOUR_ISLAND',2000),95),null,'not enough money for one stone');
 // In Kanto the clerk is measured on the local graph; a disconnected map is not
 // a ferry crossing, so it stays unreachable.
 assert.equal(planner().selectItemPreparation(observation('MAP_LAVENDER_TOWN'),95),null);
});
