import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {resolvePostgameObjective} from '../src/suite/postgame-agenda.js';
import {createCampaignPlanner} from '../src/player/campaign.js';
import {ruinValleySunStoneStep,RUIN_VALLEY,RUIN_VALLEY_PUSHES,SUN_STONE} from '../src/suite/ruin-valley-route.js';

// Live October 1: "2 more are possible in this save but need a workflow the bot
// does not have yet: …, bellossom". The only FireRed Sun Stone is the Six Island
// Ruin Valley item ball (object 16 at (43,32), FLAG_HIDE_SIX_ISLAND_RUIN_VALLEY_SUN_STONE
// 0x1E6), walled by the Strength boulders 11 (41,32), 12 (41,33) and 13 (42,33)
// (pret pokefirered c75f3523 data/maps/SixIsland_RuinValley/map.json). Pushing
// 11 east, 12 south, 13 east, then 11 north opens (42,32) beside the ball; every
// other order walls the pocket. Each push is chosen from the live boulders.
const mon=(species,personality,more={})=>({species,personality,otId:456,validity:'valid',shiny:false,isEgg:false,level:20,experience:8000,heldItem:0,friendship:70,hp:40,maxHp:40,status1:0,
 moves:[33],pp:[35],ivs:{hp:1,attack:2,defense:3,speed:4,spAttack:5,spDefense:6},...more});
const boulders=(positions)=>Object.entries(positions).map(([index,[x,y]])=>({localId:Number(index)+1,player:false,current:{x,y}}));
const START={11:[41,32],12:[41,33],13:[42,33]};
const observation=({map=RUIN_VALLEY,objects=boulders(START),party=[mon(55,1,{slot:0,level:100,moves:[57,70]})],storage=[],bag={items:[]},flag486=false}={})=>({
 frame:100,phase:'stable',sram:{sha256:'saved'},emulator:{mode:'overworld',inputReady:true,inBattle:false},
 playerMemory:{map:{id:map},position:{x:40,y:31},ui:{},objectEvents:objects,storyState:{flagIds:{486:flag486,2092:true,2112:true,2116:true},variableIds:{}},gameStats:{savedGame:10},
  trainer:{partyValidity:'valid',party,usablePartyCount:party.length,money:100000,bag,pokedex:{ownedSpecies:[21,22,43,44,45,54,55,66,67,68]},
   storage:{validity:'valid',pokemon:storage,boxCounts:Array(14).fill(0),unknownSlots:0}}}});

test('the reviewed push order matches the cartridge map',()=>{
 const map=JSON.parse(readFileSync(new URL('../test-support/ruin-valley-map.json',import.meta.url)));
 for(const index of [11,12,13])assert.equal(map.object_events[index].graphics_id,'OBJ_EVENT_GFX_PUSHABLE_BOULDER');
 assert.deepEqual([11,12,13].map(i=>[map.object_events[i].x,map.object_events[i].y]),[START[11],START[12],START[13]]);
 const ball=map.object_events[SUN_STONE.objectIndex];
 assert.equal(ball.script,'SixIsland_RuinValley_EventScript_ItemSunStone');assert.deepEqual([ball.x,ball.y],[43,32]);
 assert.deepEqual(RUIN_VALLEY_PUSHES.map(p=>[p.index,p.from.x,p.from.y,p.to.x,p.to.y]),[[11,41,32,42,32],[12,41,33,41,34],[13,42,33,43,33],[11,42,32,42,31]]);
});

test('each live layout selects the next push, then the ball',()=>{
 const layouts=[START,{...START,11:[42,32]},{...START,11:[42,32],12:[41,34]},{11:[42,32],12:[41,34],13:[43,33]}];
 layouts.forEach((layout,step)=>{
  const next=ruinValleySunStoneStep(observation({objects:boulders(layout)}));
  assert.equal(next.kind,'push');assert.equal(next.step,step);assert.deepEqual(next.push,RUIN_VALLEY_PUSHES[step]);
 });
 const solved=ruinValleySunStoneStep(observation({objects:boulders({11:[42,31],12:[41,34],13:[43,33]})}));
 assert.deepEqual(solved,{kind:'collect',target:{kind:'object',map:RUIN_VALLEY,index:16},completion:{kind:'flag-set',id:486}});
});

test('an unreviewed layout leaves the map to restore the boulders, and an unseen one is approached',()=>{
 assert.deepEqual(ruinValleySunStoneStep(observation({objects:boulders({...START,13:[42,34]})})),{kind:'reset',map:'MAP_SIX_ISLAND_WATER_PATH'});
 assert.equal(ruinValleySunStoneStep(observation({objects:boulders({11:[41,32],12:[41,33]})})).kind,'read','all three boulders must be live');
 assert.deepEqual(ruinValleySunStoneStep(observation({map:'MAP_SIX_ISLAND'})),{kind:'reach',map:RUIN_VALLEY});
});

const args={world:{data:{maps:[],wildEncounters:[]}},mechanics:{data:{species:[43,44,45,55,182].map(id=>({id,name:'SPECIES_'+id,growthRate:'GROWTH_MEDIUM_SLOW'}))}}};
const oddish=mon(43,77,{box:8,slot:20,level:12,experience:973});
const resolve=o=>resolvePostgameObjective('national-collection',o,args.world,{},{mechanics:args.mechanics});

test('a missing Bellossom with a plain Oddish takes the walled Sun Stone route',()=>{
 const pushed=resolve(observation({storage:[oddish]}));
 assert.equal(pushed.target.kind,'push-boulder',JSON.stringify(pushed.target));
 assert.deepEqual([pushed.target.map,pushed.target.objectIndex,pushed.target.x,pushed.target.y],[RUIN_VALLEY,11,42,32]);
 assert.deepEqual(pushed.authoredBoulderPath,[{x:41,y:32},{x:42,y:32}]);
 const away=resolve(observation({map:'MAP_FOUR_ISLAND_POKEMON_CENTER_1F',storage:[oddish]}));
 assert.deepEqual(away.target,{kind:'map-arrival',map:RUIN_VALLEY});
 const solved=resolve(observation({objects:boulders({11:[42,31],12:[41,34],13:[43,33]}),storage:[oddish]}));
 assert.deepEqual([solved.target.kind,solved.target.index,solved.completion?.id],['object',16,486]);
});

test('the route needs a Strength user and stops when the Sun Stone is gone or not needed',()=>{
 const strength=mon(68,9,{box:1,slot:3,level:100,moves:[70]});
 const roster=resolve(observation({party:[mon(22,1,{slot:0,level:100,moves:[19]})],storage:[oddish,strength]}));
 assert.equal(roster.target.kind,'party-roster');assert.deepEqual(roster.target.requiredFingerprints.length,1);
 const none=resolve(observation({party:[mon(22,1,{slot:0,level:100,moves:[19]})],storage:[oddish]}));
 assert.equal(none.target.kind,'collection-exhausted','without a Strength user the walled stone is not offered');
 assert.match(none.target.reason,/need a workflow the bot does not have yet: .*\b(bellossom|182)\b/i);
 assert.notEqual(resolve(observation({storage:[oddish],flag486:true})).target.kind,'push-boulder','a collected ball is never chased');
 assert.notEqual(resolve(observation({storage:[]})).target.kind,'push-boulder','no plain Oddish or Gloom, no detour');
});

test('with the Sun Stone in the Bag the Bellossom evolution itself is selected',()=>{
 const r=resolve(observation({storage:[oddish],bag:{items:[{itemId:93,quantity:1}]},flag486:true}));
 assert.equal(r.target.kind,'postgame-evolve');assert.equal(r.evolution.request.speciesId,182);
});

// Live October 4 (first native run of this route): standing in Ruin Valley, the
// planner's coarse graph treated the walled ball as reachable, so the owned
// evolution started early and its supply chased the ball through the boulders
// (as gate-verification-124-01 did from Six Island's harbor). The walled ball is
// never an ordinary supply; only the reviewed route above collects it.
test('Ruin Valley\'s walled Sun Stone is never an ordinary item supply',()=>{
 const room=(id,objects=[])=>({id,properties:{},connections:[],warpEvents:[],coordEvents:[],backgroundEvents:[],objectEvents:objects,
  layout:{id,width:48,height:40,cells:Array.from({length:48*40},(_,i)=>({x:i%48,y:Math.floor(i/48),collision:0,elevation:3,encounterType:0,behaviorName:'MB_NORMAL'}))}});
 const filler=i=>({graphics_id:'OBJ_EVENT_GFX_HIKER',x:i,y:0,elevation:3,script:'SixIsland_RuinValley_EventScript_Filler'+i,flag:'0'});
 const ball={graphics_id:'OBJ_EVENT_GFX_ITEM_BALL',x:43,y:32,elevation:3,script:'SixIsland_RuinValley_EventScript_ItemSunStone',flag:'FLAG_HIDE_SIX_ISLAND_RUIN_VALLEY_SUN_STONE'};
 const world={data:{maps:[room(RUIN_VALLEY,[...Array.from({length:16},(_,i)=>filler(i)),ball])],wildEncounters:[]}};
 const story={data:{symbols:{flags:{FLAG_HIDE_SIX_ISLAND_RUIN_VALLEY_SUN_STONE:{value:486}},items:{ITEM_SUN_STONE:{value:93}}},
  scripts:[{label:'SixIsland_RuinValley_EventScript_ItemSunStone',instructions:[{op:'finditem',args:['ITEM_SUN_STONE']}]}]}};
 const planner=createCampaignPlanner({campaign:{objectives:[]},world,story,mechanics:{data:{species:[]}}});
 const o={phase:'stable',frame:1,emulator:{mode:'overworld'},playerMemory:{map:{id:RUIN_VALLEY},position:{x:42,y:32},ui:{},
  storyState:{flagIds:{486:false,2092:true,2112:true,2116:true},variableIds:{}},trainer:{money:500000,partyValidity:'valid',party:[],bag:{items:[],keyItems:[]}}}};
 assert.equal(planner.selectItemPreparation(o,93),null);
});
