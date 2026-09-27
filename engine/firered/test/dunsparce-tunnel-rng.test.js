import test from 'node:test';
import assert from 'node:assert/strict';
import {rngMenuIntent} from '../src/rng/input-methods.js';
import {buildWildRngPlan} from '../src/rng/wild-search.js';
import {campaignNavigationRecommendation,campaignTargetReachable,createCampaignPlanner} from '../src/player/campaign.js';
import {selectNationalDexCapture} from '../src/suite/national-dex-agenda.js';

// Live Sept 25-26 (about 195 hunts): the National Dex collection hunted
// Dunsparce on Three Isle Port. Its only land cells are a grass pocket that the
// cartridge reaches through the Dunsparce Tunnel, whose ON_TRANSITION script
// installs LAYOUT_THREE_ISLAND_DUNSPARCE_TUNNEL_DUG_OUT once
// IsNationalPokedexEnabled() (FLAG_SYS_NATIONAL_DEX 2112 and VAR_NATIONAL_DEX
// 0x404E == 0x6258). The static knowledge keeps the walled layout, so every RNG
// trial waited at the harbor door until "RNG menu navigation exceeded its budget".
// Rows below are the knowledge cells of both maps (legend: collision,
// elevation, behavior, encounter type); they match the pinned world file cell
// for cell.
const LEGEND={'#':[1,0,'MB_NORMAL',0],'.':[0,3,'MB_NORMAL',0],G:[1,0,'MB_FAST_WATER',2],D:[0,3,'MB_ROCK_STAIRS',0],v:[0,3,'MB_SAND',0],
 W:[0,3,'MB_CAVE_DOOR',0],w:[0,3,'MB_TALL_GRASS',1],s:[0,3,'MB_SOUTH_ARROW_WARP',0],n:[1,3,'MB_OCEAN_WATER',2],m:[1,3,'MB_NORMAL',0],
 a:[1,0,'MB_OCEAN_WATER',2],b:[1,0,'MB_CAVE',1],c:[0,3,'MB_CAVE',1],d:[1,0,'MB_NORMAL',1],e:[0,3,'MB_SOUTH_ARROW_WARP',1],f:[1,0,'MB_IMPASSABLE_NORTH',1]};
const PORT_ROWS=['##########...##############################GGGGG','##########DDD##############################GGGGG','##########...##############################GGGGG','##########vvv##############################GGGGG',
 '##########vvv###W##########################GGGGG','########vvvvvvvvvv#GGGGGGGGG##########W###GGGGGG','########vvvvvvvvvv#GGGGGGGGG#..wwwwww....#GGGGGG','########vvvvvvvvvv#GGGGGGGGG#..wwwwww....#GGGGGG',
 '########vvvvvvvvvv#GGGGGGGGG##..wwww.....#GGGGGG','GGGGGGG#vvvvvvvvvv#GGGGGGGGGG#...........#GGGGGG','GGGGGGG#vvvvvvvvvv#GGGGGGGGGG#############GGGGGG','GGGGGGG#vvvvvvvv###GGGGGGGGGGGGGGGGGGGGGGGGGGGGG',
 'GGGGGGG####vvv###GGGGGGGGGGGGGGGGGGGGGGGGGGGGGGG','GGGGGGGGGGG.s.GGGGGGGGGGGGGGGGGGGGGGGGGGGGGGGGGG','GGGGGGGGGnm###maGGGGGGGGGGGGGGGGGGGGGGGGGGGGGGGG','GGGGGGGGGa#####aGGGGGGGGGGGGGGGGGGGGGGGGGGGGGGGG',
 'GGGGGGGGGa#####aGGGGGGGGGGGGGGGGGGGGGGGGGGGGGGGG','GGGGGGGGGaaaaaaaGGGGGGGGGGGGGGGGGGGGGGGGGGGGGGGG','GGGGGGGGGaaaaaaaGGGGGGGGGGGGGGGGGGGGGGGGGGGGGGGG','GGGGGGGGGGGGGGGGGGGGGGGGGGGGGGGGGGGGGGGGGGGGGGGG'];
const TUNNEL_ROWS=['########bbbbbbbbbbbbbbbbbbbbbb','######b###bbbbbbbbbbbbbbbbbbbb','####c###bdbbbbbbbbbbbbbbbbbbbb','##cccccdbdbbbbbbbbbbbbbbbbbbbb',
 '##cec#fbbdbbbbbbbbbbbbbbbbbbbb','dfdddbbb#bbbbbbbbbbbbbbbbbbbbb','fffffbbbbbbbbbbbbbbbbbbbbbbbbb'];
const PORT='MAP_THREE_ISLAND_PORT',TUNNEL='MAP_THREE_ISLAND_DUNSPARCE_TUNNEL',HARBOR='MAP_THREE_ISLAND_HARBOR';
// The authored tunnel layout (blockData sha256) the dug-out variant was derived against.
const WALLED_TUNNEL='3cb95cee7aa66b33fe98ab6b709649d90c8c1b76dae496c3a741b33bb530704b';
const layout=(rows,extra={})=>({width:rows[0].length,height:rows.length,...extra,cells:rows.flatMap((row,y)=>[...row].map((ch,x)=>{
 const [collision,elevation,behaviorName,encounterType]=LEGEND[ch];return {x,y,collision,elevation,behaviorName,encounterType,terrain:encounterType===2?2:0};}))});
const world=({tunnelLayout=WALLED_TUNNEL}={})=>({maps:[
 {id:PORT,properties:{map_type:'MAP_TYPE_ROUTE'},connections:[],objectEvents:[],backgroundEvents:[],coordEvents:[],layout:layout(PORT_ROWS,{id:'LAYOUT_THREE_ISLAND_PORT'}),
  warpEvents:[{x:16,y:4,elevation:0,dest_map:TUNNEL,dest_warp_id:'0'},{x:38,y:5,elevation:3,dest_map:TUNNEL,dest_warp_id:'1'},{x:12,y:13,elevation:3,dest_map:HARBOR,dest_warp_id:'0'}]},
 {id:TUNNEL,properties:{map_type:'MAP_TYPE_UNDERGROUND'},connections:[],objectEvents:[],backgroundEvents:[],coordEvents:[],
  layout:layout(TUNNEL_ROWS,{id:'LAYOUT_THREE_ISLAND_DUNSPARCE_TUNNEL',blockDataSha256:tunnelLayout}),
  warpEvents:[{x:3,y:4,elevation:3,dest_map:PORT,dest_warp_id:'0'},{x:25,y:5,elevation:3,dest_map:PORT,dest_warp_id:'1'}]}],
 wildEncounters:[{map:PORT,base_label:'sThreeIslandPort_FireRed',land_mons:{encounter_rate:1,mons:Array.from({length:12},()=>({species:'SPECIES_DUNSPARCE',min_level:15,max_level:15}))}}]});
// nationalDex sets both halves of IsNationalPokedexEnabled(); flag/variable override
// one (variable null: the observation does not read VAR_NATIONAL_DEX).
const observation=({map=PORT,x=12,y=13,nationalDex=true,flag=nationalDex,variable=nationalDex?0x6258:0,ui={},frame=0}={})=>({captureId:`capture-${frame}`,frame,phase:'stable',phaseReasons:[],
 emulator:{captureId:`capture-${frame}`,frame,mode:'overworld',inBattle:false,inputReady:true,callback2:'CB2_Overworld'},sram:{captureId:`capture-${frame}`,frame,sha256:'sram'},
 playerMemory:{captureId:`capture-${frame}`,frame,sha256:`memory-${frame}`,map:{id:map},position:{x,y},ui,encounter:null,objectEvents:[],avatar:{surfing:false},rng:{validity:'valid',mainState:0x1234},
  storyState:{flags:{},flagIds:{2092:true,2112:flag,2116:true},variableIds:variable===null?{}:{0x404e:variable}},
  trainer:{otId:1,money:1000,partyValidity:'valid',party:[{slot:0,species:43,level:30,hp:80,maxHp:80,moves:[230,71],pp:[20,25],validity:'valid'}],bag:{keyItems:[],pokeBalls:[{itemId:4,quantity:20}]},
   storage:{validity:'valid',pokemon:[],boxCounts:Array(14).fill(0)},pokedex:{ownedSpecies:[43]}}}});
const hunt={id:'rng-encounter-setup',target:{kind:'encounter-zone',map:PORT},dialogue:'advance',choice:'yes',deferOptionalDetours:true};
const reachable=(w,o,from={map:PORT,position:{x:12,y:13}})=>campaignTargetReachable({world:w,observation:o,target:hunt.target,origins:[from],exact:true});
const grass=(x,y)=>PORT_ROWS[y]?.[x]==='w';
const mechanics={species:{206:{id:206,name:'SPECIES_DUNSPARCE'},43:{id:43,name:'SPECIES_ODDISH'}},moves:{},trainers:[]};
const sweetScentReady={party:{stage:'selection-menu',selectedPartySlot:0,actions:['summary','sweet-scent','cancel'],actionCursor:1}};

test('RNG Sweet Scent opens its menu only on an encounter cell of the hunted map',()=>{
 const w=world(),at=(map,x,y,ui)=>observation({map,x,y,ui}),intent=o=>rngMenuIntent(o,{goal:'sweet-scent',world:w,area:PORT});
 // The tunnel's cave floor is encounter type 1, but the tunnel has no wild table.
 assert.equal(intent(at(TUNNEL,3,4)).kind,'navigate');
 assert.equal(intent(at(TUNNEL,3,4,{startMenu:{order:['pokedex','pokemon','bag']}})).recommendation?.kind,'close-menu');
 assert.equal(intent(at(TUNNEL,3,4,sweetScentReady)).recommendation?.kind,'close-menu','never use Sweet Scent outside the hunted map');
 assert.equal(intent(at(PORT,12,13)).kind,'navigate');
 assert.equal(intent(at(PORT,33,6)).recommendation?.kind,'open-start-menu');
 assert.equal(intent(at(PORT,33,6,sweetScentReady)).kind,'ready');
});

test('the navigation graph digs out the Dunsparce Tunnel only when the cartridge would',()=>{
 // The RNG trial observer is built from the campaign story watch alone
 // (session-worker.js), so the watch must read both halves of the switch.
 const watch=createCampaignPlanner({world:world(),story:{symbols:{},scripts:[]},mechanics}).storyWatch();
 assert.ok(watch.flags.includes(2112),'FLAG_SYS_NATIONAL_DEX is observed');
 assert.ok(watch.variables.includes(0x404e),'VAR_NATIONAL_DEX is observed');
 const w=world();
 const route=campaignNavigationRecommendation({world:w,observation:observation(),objective:hunt});
 assert.deepEqual(route?.transit&&{map:route.transit.destinationMap,x:route.transit.x,y:route.transit.y},{map:TUNNEL,x:16,y:4},JSON.stringify(route));
 assert.equal(reachable(w,observation()),true);
 // IsNationalPokedexEnabled() needs the flag and VAR_NATIONAL_DEX == 0x6258;
 // otherwise the cartridge keeps the walled tunnel and the pocket is closed.
 for(const early of [observation({nationalDex:false}),observation({variable:0}),observation({variable:null}),observation({flag:false})]){
  const state=JSON.stringify(early.playerMemory.storyState);
  assert.equal(campaignNavigationRecommendation({world:w,observation:early,objective:hunt}),null,state);
  assert.equal(reachable(w,early),false,state);
 }
 // The variant replaces only the exact authored layout it was derived from.
 const other=world({tunnelLayout:'0'.repeat(64)});
 assert.equal(campaignNavigationRecommendation({world:other,observation:observation(),objective:hunt}),null);
 assert.equal(reachable(other,observation()),false);
});

test('a Three Isle Port hunt walks the dug-out tunnel into the grass pocket',()=>{
 const w=world(),next=o=>campaignNavigationRecommendation({world:w,observation:o,objective:hunt});
 // Inside the tunnel (west landing and midway) the route continues to the east
 // exit, never back out of the west entrance.
 for(const x of [3,15]){
  const inside=next(observation({map:TUNNEL,x,y:4}));
  assert.deepEqual(inside?.transit&&{map:inside.transit.destinationMap,x:inside.transit.x,y:inside.transit.y},{map:PORT,x:25,y:5},JSON.stringify(inside));
 }
 // From the east exit's landing the route ends on a Port grass cell.
 const pocket=next(observation({x:38,y:5}));
 assert.equal(pocket?.transit,undefined,JSON.stringify(pocket));
 assert.equal(pocket?.targetMap,PORT);assert.ok(grass(pocket.target?.x,pocket.target?.y),JSON.stringify(pocket?.target));
});

test('an RNG trial with no executable route to the encounter cells stops within a bounded wait',async()=>{
 const w=world(),source={stateSha256:'s',sramSha256:'r'};let frames=0,trials=0;
 const openTrial=async()=>{trials++;const session={frame:0,step(){this.frame++;frames++;},saveState:()=>new Uint8Array(1),saveSram:()=>new Uint8Array(1),loadState(){},loadSram(){},close(){}};
  // The walled tunnel (no National Dex yet) leaves the grass pocket unreachable.
  const observer={capture:()=>observation({nationalDex:false,frame:session.frame})};
  return {session,observer,inputs:{world:w,story:{symbols:{},scripts:[]},battle:mechanics},commit:source};};
 await assert.rejects(buildWildRngPlan({game:'firered',area:PORT,speciesId:206,request:{shiny:'any'},source,openTrial,profile:null}),
  /^Error: RNG setup has no executable route to an encounter cell of MAP_THREE_ISLAND_PORT$/);
 assert.equal(trials,1);assert.ok(frames>1800&&frames<=2000,`the trial waited ${frames} frames`);
});

test('a brief unsupported wait in an RNG trial keeps going to the Sweet Scent menu',async()=>{
 // A moving NPC can close a corridor for a few seconds. Under 1800 frames the
 // trial waits it out; here the route opens after 1000 frames and the player
 // is then ready on a Port grass cell, so planning reaches its next phase.
 const w=world(),source={stateSha256:'s',sramSha256:'r'};let frames=0,trials=0;
 const openTrial=async()=>{trials++;const session={frame:0,step(){this.frame++;frames++;},saveState:()=>new Uint8Array(1),saveSram:()=>new Uint8Array(1),loadState(){},loadSram(){},close(){}};
  const observer={capture:()=>session.frame<1000?observation({nationalDex:false,frame:session.frame}):observation({x:33,y:6,ui:sweetScentReady,frame:session.frame})};
  return {session,observer,inputs:{world:w,story:{symbols:{},scripts:[]},battle:mechanics},commit:source};};
 // The fake cartridge's RNG never advances, so the first calibration step is the next stop.
 await assert.rejects(buildWildRngPlan({game:'firered',area:PORT,speciesId:206,request:{shiny:'any'},source,openTrial,profile:null}),/Sweet Scent menu RNG rate is not measurable/);
 assert.equal(trials,1);assert.ok(frames>1000,`the trial waited ${frames} frames`);
});

test('the National Dex selector hunts only a table whose encounter cells navigation reaches',()=>{
 const pick=(w,o)=>{const task=selectNationalDexCapture({o,world:w,mechanics:{data:{species:[{id:206,name:'SPECIES_DUNSPARCE'},{id:43,name:'SPECIES_ODDISH'}]}},state:{failed:{}}});
  return task&&[task.request.speciesId,task.route.map];};
 // With the dug-out tunnel the Port's grass is reachable from the ferry landing.
 assert.deepEqual(pick(world(),observation()),[206,PORT]);
 // Reaching the Port map is not reaching its grass: a walled pocket (the
 // authored tunnel, or an observation that cannot prove the National Dex
 // layout) is not hunted.
 assert.equal(pick(world({tunnelLayout:'0'.repeat(64)}),observation()),null,'the walled pocket is never selected');
 assert.equal(pick(world(),observation({variable:null})),null,'without VAR_NATIONAL_DEX the dug-out layout is unproven');
});
