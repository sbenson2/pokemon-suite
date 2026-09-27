import test from 'node:test';
import assert from 'node:assert/strict';
import {createPolicyAdvisors} from '../src/player/advisors.js';

function fixture(source='MAP_FIVE_ISLAND',section='MAPSEC_FIVE_ISLAND'){
 const map=(id,region)=>({id,properties:{map_type:'MAP_TYPE_CITY',region_map_section:region},objectEvents:[],warpEvents:[],connections:[],layout:{id,width:3,height:3,cells:Array.from({length:9},(_,i)=>({x:i%3,y:Math.floor(i/3),elevation:3,collision:0,behaviorName:'MB_NORMAL'}))}});
 const arrival=map('MAP_VERMILION_CITY','MAPSEC_VERMILION_CITY'),center=map('MAP_VERMILION_CITY_POKEMON_CENTER_1F','MAPSEC_VERMILION_CITY');
 arrival.warpEvents=[{x:1,y:1,dest_map:center.id,dest_warp_id:'0'}];
 center.warpEvents=[{x:1,y:1,dest_map:arrival.id,dest_warp_id:'0'}];
 arrival.layout.cells[4].behaviorName='MB_WARP_DOOR';
 center.layout.cells[4].behaviorName='MB_SOUTH_ARROW_WARP';
 const world={maps:[map(source,section),arrival,center]};
 const objective={id:'retain-ferry-destination',target:{kind:'seagallop-destination',map:'MAP_VERMILION_CITY'},deferOptionalDetours:true};
 const planner={select:()=>objective,selectCollection:()=>null,selectTraining:()=>null};
 const quest=createPolicyAdvisors({world,campaignPlanner:planner,mechanics:{species:[]}}).find(a=>a.id==='quest');
 const o={frame:10,captureId:'region',phase:'stable',phaseReasons:[],emulator:{frame:10,captureId:'region',mode:'overworld',inputReady:true,inBattle:false},playerMemory:{frame:10,captureId:'region',map:{id:source},position:{x:1,y:1},ui:{},storyState:{flagIds:{2082:true,2197:true}},trainer:{partyCount:1,usablePartyCount:1,party:[{slot:0,validity:'valid',species:22,moves:[19],hp:60,maxHp:60}],bag:{}}}};
 return {o,objective,advise:()=>quest.advise(o)?.recommendation};
}

for(const [source,section] of [
 ['MAP_ONE_ISLAND','MAPSEC_ONE_ISLAND'],['MAP_FIVE_ISLAND','MAPSEC_FIVE_ISLAND'],['MAP_SIX_ISLAND','MAPSEC_SIX_ISLAND'],
 ['MAP_MT_EMBER_EXTERIOR','MAPSEC_MT_EMBER'],['MAP_TRAINER_TOWER_LOBBY','MAPSEC_TRAINER_TOWER'],
 ['MAP_BIRTH_ISLAND_EXTERIOR','MAPSEC_BIRTH_ISLAND'],['MAP_NAVEL_ROCK_EXTERIOR','MAPSEC_NAVEL_ROCK'],
])test('Kanto Fly shortcuts cannot override a ferry from '+source,()=>{
 const {o,objective,advise}=fixture(source,section);
 assert.notEqual(advise()?.kind,'open-start-menu');
 o.emulator.mode='fly-map';o.playerMemory.ui={flyMap:{stage:'selection',cursor:{x:14,y:9},selectedMapsec:0,selectedMapsecType:0}};
 const cancel=advise();assert.equal(cancel?.kind,'close-menu');assert.equal(cancel.objective,objective.id);
});

test('Kanto travel keeps its valid visited Fly shortcut',()=>{
 const {o,advise}=fixture('MAP_PEWTER_CITY','MAPSEC_PEWTER_CITY');
 assert.equal(advise()?.kind,'open-start-menu');
 o.emulator.mode='fly-map';o.playerMemory.ui={flyMap:{stage:'selection',cursor:{x:14,y:9},selectedMapsec:0,selectedMapsecType:3}};
 assert.equal(advise()?.targetMapSection,'MAPSEC_VERMILION_CITY');
});
