import test from 'node:test';
import assert from 'node:assert/strict';
const module=await import('../src/suite/national-dex-agenda.js').catch(e=>{if(e.code==='ERR_MODULE_NOT_FOUND')return {};throw e;});
const world={data:{maps:[{id:'MAP_ROUTE1'},{id:'MAP_SAFARI_ZONE_CENTER'},{id:'MAP_SEVEN_ISLAND_TANOBY_RUINS_MONEAN_CHAMBER'}],wildEncounters:[
 {map:'MAP_ROUTE1',base_label:'Route1_FireRed',land_mons:{encounter_rate:25,mons:Array(12).fill({species:'SPECIES_RATTATA',min_level:3,max_level:5})}},
 {map:'MAP_SAFARI_ZONE_CENTER',base_label:'Safari_FireRed',land_mons:{encounter_rate:30,mons:Array(12).fill({species:'SPECIES_CHANSEY',min_level:23,max_level:23})}},
 {map:'MAP_ROUTE1',base_label:'Route1_LeafGreen',land_mons:{encounter_rate:25,mons:Array(12).fill({species:'SPECIES_SANDSHREW',min_level:3,max_level:5})}},
 {map:'MAP_SEVEN_ISLAND_TANOBY_RUINS_MONEAN_CHAMBER',base_label:'Monean_FireRed',land_mons:{encounter_rate:7,mons:Array(12).fill({species:'SPECIES_UNOWN',min_level:25,max_level:25})}},
]}};
const mechanics={data:{species:[{id:19,name:'SPECIES_RATTATA'},{id:27,name:'SPECIES_SANDSHREW'},{id:113,name:'SPECIES_CHANSEY'},{id:201,name:'SPECIES_UNOWN'}]}};
const o=()=>({phase:'stable',emulator:{mode:'overworld'},playerMemory:{map:{id:'MAP_ROUTE1'},storyState:{flagIds:{2092:true,2112:true,2116:true,2121:false}},trainer:{partyValidity:'valid',party:[],storage:{validity:'valid',pokemon:[],boxCounts:Array(14).fill(0)},bag:{},pokedex:{ownedSpecies:[]}}}});
test('National Dex selection includes rare and Safari species, excludes the other version, and never invents a route',()=>{
 assert.equal(typeof module.selectNationalDexCapture,'function');
 const obs=o();let task=module.selectNationalDexCapture({o:obs,world,mechanics});
 assert.equal(task.request.speciesId,19);assert.equal(task.request.shiny,'any');
 obs.playerMemory.trainer.pokedex.ownedSpecies=[19];task=module.selectNationalDexCapture({o:obs,world,mechanics});
 assert.equal(task.request.speciesId,113);assert.equal(task.route.method,'safari-land');
 obs.playerMemory.trainer.pokedex.ownedSpecies.push(113);assert.equal(module.selectNationalDexCapture({o:obs,world,mechanics}),null);
 obs.playerMemory.storyState.flagIds[2121]=true;assert.equal(module.selectNationalDexCapture({o:obs,world,mechanics}).request.speciesId,201);
});
test('the complete collection keeps a chosen species through route changes and retries alternatives after a failed hunt',()=>{
 const obs=o(),state={};let task=module.selectNationalDexCapture({o:obs,world,mechanics,state});
 obs.playerMemory.map.id='MAP_SAFARI_ZONE_CENTER';
 assert.equal(module.selectNationalDexCapture({o:obs,world,mechanics,state}).request.speciesId,task.request.speciesId);
 state.failed={19:{retryAt:10000}};
 assert.equal(module.selectNationalDexCapture({o:obs,world,mechanics,state,now:100}).request.speciesId,113);
});
test('National Dex collection waits for storage reserves and verified unlocks',()=>{
 const obs=o();obs.playerMemory.trainer.storage.boxCounts=Array(14).fill(30);
 assert.equal(module.selectNationalDexCapture({o:obs,world,mechanics}),null);
 obs.playerMemory.trainer.storage.boxCounts=Array(14).fill(0);obs.playerMemory.storyState.flagIds[2116]=false;
 assert.equal(module.selectNationalDexCapture({o:obs,world,mechanics}),null);
});

test('every missing species keeps its actual local, evolution, or partner dependency',()=>{
 assert.equal(typeof module.nationalDexSources,'function');
 const obs=o();obs.playerMemory.trainer.pokedex.ownedSpecies=[19];
 const rows=module.nationalDexSources({o:obs,world,mechanics});assert.equal(rows.length,386);
 const row=id=>rows.find(x=>x.speciesId===id);
 assert.equal(row(19).status,'complete');assert.equal(row(113).method,'safari-land');
 assert.equal(row(197).method,'partner-evolution');assert.equal(row(68).method,'trade-evolution');
 assert.equal(row(151).method,'event-source');assert.equal(row(27).method,'partner-source');
 assert.ok(rows.every(x=>x.reason));
});

// Slugma lives only inside the Ruby Path. Its door opens through a map-load
// script (0x4076 >= 4), and B3F plus the stair loop behind it are cut off from
// the entrance by Strength boulders. The live bot re-picked the 100% B3F table
// fourteen times and stalled at One Island Harbor on every attempt.
function emberWorld(){
 const map=(id,{width=5,height=5,warps=[],cells={},objects=[],grass=false}={})=>({id,properties:{},warpEvents:warps,connections:[],objectEvents:objects,coordEvents:[],
  layout:{id,width,height,cells:Array.from({length:width*height},(_,i)=>{const x=i%width,y=Math.floor(i/width),cell=cells[x+','+y];
   return {x,y,collision:cell?.collision??0,elevation:3,encounterType:grass&&y>=2&&!cell?1:0,behaviorName:cell?.behavior??'MB_NORMAL'};})}});
 const wall={behavior:'MB_NORMAL',collision:1},ladder={behavior:'MB_LADDER',collision:0},arrow={behavior:'MB_SOUTH_ARROW_WARP',collision:0};
 const P='MAP_MT_EMBER_RUBY_PATH_';
 const maps=[
  map('MAP_ONE_ISLAND_HARBOR',{width:9,height:6,warps:[{x:8,y:0,dest_map:'MAP_ONE_ISLAND_KINDLE_ROAD',dest_warp_id:'0'}],cells:{'8,0':ladder}}),
  map('MAP_ONE_ISLAND_KINDLE_ROAD',{warps:[{x:2,y:4,dest_map:'MAP_MT_EMBER_EXTERIOR',dest_warp_id:'0'},{x:0,y:0,dest_map:'MAP_ONE_ISLAND_HARBOR',dest_warp_id:'0'}],cells:{'2,4':arrow,'0,0':ladder}}),
  map('MAP_MT_EMBER_EXTERIOR',{warps:[{x:1,y:1,dest_map:'MAP_ONE_ISLAND_KINDLE_ROAD',dest_warp_id:'0'},{x:3,y:1,dest_map:P+'1F',dest_warp_id:'0'}],cells:{'1,1':{behavior:'MB_WARP_DOOR',collision:1},'3,1':wall}}),
  map(P+'1F',{warps:[{x:2,y:4,dest_map:'MAP_MT_EMBER_EXTERIOR',dest_warp_id:'1'},{x:2,y:0,dest_map:P+'B1F',dest_warp_id:'0'}],cells:{'2,4':arrow,'2,0':ladder}}),
  map(P+'B1F',{warps:[{x:0,y:0,dest_map:P+'1F',dest_warp_id:'1'},{x:4,y:0,dest_map:P+'B2F',dest_warp_id:'0'}],cells:{'0,0':ladder,'4,0':ladder},grass:true}),
  map(P+'B2F',{warps:[{x:0,y:0,dest_map:P+'B1F',dest_warp_id:'1'},{x:4,y:0,dest_map:P+'B3F',dest_warp_id:'0'}],cells:{'0,0':ladder,'4,0':ladder,'3,0':wall},
   objects:[{x:4,y:1,elevation:3,graphics_id:'OBJ_EVENT_GFX_PUSHABLE_BOULDER'}],grass:true}),
  map(P+'B3F',{warps:[{x:0,y:0,dest_map:P+'B2F',dest_warp_id:'1'},{x:4,y:0,dest_map:P+'B1F_STAIRS',dest_warp_id:'0'}],cells:{'0,0':ladder,'4,0':ladder},grass:true}),
  map(P+'B1F_STAIRS',{warps:[{x:0,y:0,dest_map:P+'B3F',dest_warp_id:'1'}],cells:{'0,0':ladder},grass:true}),
 ];
 const table=(map,slugmaSlots,rate=7)=>({map,base_label:map+'_FireRed',land_mons:{encounter_rate:rate,mons:Array.from({length:12},(_,i)=>({species:slugmaSlots.includes(i)?'SPECIES_SLUGMA':'SPECIES_GEODUDE',min_level:30,max_level:30}))}});
 return {data:{maps,wildEncounters:[table(P+'B3F',[0,1,2,3,4,5,6,7,8,9,10,11]),table(P+'B2F',[0,1,2,3]),table(P+'B1F_STAIRS',[0,1,2,3]),table(P+'B1F',[2,3,4])]}};
}
const emberMechanics={data:{species:[{id:74,name:'SPECIES_GEODUDE'},{id:218,name:'SPECIES_SLUGMA'}]}};
const emberObservation=(map,position,value=6)=>{const obs=o();obs.playerMemory.map.id=map;obs.playerMemory.position=position;
 obs.playerMemory.storyState.variableIds={[0x4076]:value};obs.playerMemory.trainer.pokedex.ownedSpecies=[74];return obs;};

test('a National Dex hunt picks an encounter floor that navigation can reach',()=>{
 const world=emberWorld(),P='MAP_MT_EMBER_RUBY_PATH_';
 for(const [map,position] of [['MAP_ONE_ISLAND_KINDLE_ROAD',{x:2,y:2}],['MAP_CELADON_CITY',{x:10,y:10}]]){
  const task=module.selectNationalDexCapture({o:emberObservation(map,position),world,mechanics:emberMechanics});
  assert.equal(task?.request.speciesId,218,map);
  assert.equal(task.route.map,P+'B2F','the 100% B3F table is behind boulders; B2F is the best reachable floor (from '+map+')');
 }
 assert.equal(module.selectNationalDexCapture({o:emberObservation('MAP_ONE_ISLAND_KINDLE_ROAD',{x:2,y:2},3),world,mechanics:emberMechanics}),null,
  'a closed cave door leaves no reachable Slugma floor');
});

test('a failed encounter floor does not hide the species on its other reachable floors',()=>{
 const world=emberWorld(),P='MAP_MT_EMBER_RUBY_PATH_',obs=emberObservation('MAP_ONE_ISLAND_KINDLE_ROAD',{x:2,y:2});
 const state={failed:{['218:'+P+'B2F']:{retryAt:10000}}};
 const task=module.selectNationalDexCapture({o:obs,world,mechanics:emberMechanics,state,now:100});
 assert.equal(task?.request.speciesId,218);
 assert.equal(task.route.map,P+'B1F','never the unreachable B1F stair loop');
 assert.deepEqual(state.target,{speciesId:218,map:P+'B1F'});
 assert.equal(module.selectNationalDexCapture({o:obs,world,mechanics:emberMechanics,state,now:10001}).route.map,P+'B1F','a retained reachable target is kept');
 state.target=null;
 assert.equal(module.selectNationalDexCapture({o:obs,world,mechanics:emberMechanics,state,now:10001}).route.map,P+'B2F','the expired floor is eligible again');
 assert.equal(module.selectNationalDexCapture({o:obs,world,mechanics:emberMechanics,state:{failed:{218:{retryAt:10000}}},now:100}),null,
  'a species-wide retry still defers every floor');
});

// Altering Cave has nine FireRed tables; the cartridge uses only the one that
// VAR_ALTERING_CAVE_WILD_SET (0x4024) selects (src/wild_encounter.c
// GetCurrentMapWildMonHeaderId), and 0 or an out-of-range value means table 1
// (Zubat). Mareep and the other species of tables 2-9 need a Mystery Gift event.
test('Altering Cave offers only the encounter table its wild-set variable selects',()=>{
 const cave='MAP_SIX_ISLAND_ALTERING_CAVE',table=(label,species)=>({map:cave,base_label:label,land_mons:{encounter_rate:7,mons:Array(12).fill({species,min_level:23,max_level:23})}});
 const world={data:{maps:[{id:cave}],wildEncounters:[table('sSixIslandAlteringCave_FireRed','SPECIES_ZUBAT'),
  table('sSixIslandAlteringCave_2_FireRed','SPECIES_MAREEP'),table('sSixIslandAlteringCave_3_FireRed','SPECIES_PINECO'),
  table('sSixIslandAlteringCave_LeafGreen','SPECIES_SMEARGLE')]}};
 const mechanics={data:{species:[{id:41,name:'SPECIES_ZUBAT'},{id:179,name:'SPECIES_MAREEP'},{id:204,name:'SPECIES_PINECO'},{id:235,name:'SPECIES_SMEARGLE'}]}};
 const select=(value,failed={})=>{const obs=o();obs.playerMemory.map.id='MAP_SIX_ISLAND';
  if(value!==undefined)obs.playerMemory.storyState.variableIds={[0x4024]:value};
  return module.selectNationalDexCapture({o:obs,world,mechanics,state:{failed},now:100});};
 for(const value of [undefined,0,9,65535]){
  const task=select(value);
  assert.equal(task?.request.speciesId,41,'table 1 (Zubat) for 0x4024='+value);
  assert.equal(select(value,{41:{retryAt:10000}}),null,'Mareep and Pineco are only in inactive tables (0x4024='+value+')');
 }
 assert.equal(select(1)?.request.speciesId,179,'0x4024=1 selects table 2 (Mareep)');
 assert.equal(select(1,{179:{retryAt:10000}}),null,'with table 2 active, Zubat and Pineco are not offered');
 assert.equal(select(2)?.request.speciesId,204,'0x4024=2 selects table 3 (Pineco)');
});

// A scripted entrance (a door the static exterior keeps closed) proves only
// that its interior map is entered. An exact query, as the National Dex
// selector makes, must reach the target cells from the entrance's authored
// landing; an entrance without one proves nothing about them.
test('a scripted entrance answers exact reachability from its landing, never from entering the map',async()=>{
 const {campaignTargetReachable}=await import('../src/player/campaign.js');
 const P='MAP_MT_EMBER_RUBY_PATH_',world=emberWorld(),start=emberObservation('MAP_ONE_ISLAND_KINDLE_ROAD',{x:2,y:2});
 // Wall off B1F's grass (rows 2-4) from both of its ladders on row 0.
 for(const cell of world.data.maps.find(m=>m.id===P+'B1F').layout.cells)if(cell.y===1)cell.collision=1;
 const ember=(map,exact)=>campaignTargetReachable({world,observation:start,target:{kind:'encounter-zone',map},origins:[{map:'MAP_ONE_ISLAND_KINDLE_ROAD',position:{x:2,y:2}}],exact});
 assert.equal(ember(P+'B1F',false),true,'B1F is entered through the opened door');
 assert.equal(ember(P+'B1F',true),false,'B1F grass is walled off from both ladders');
 assert.equal(ember(P+'B2F',true),true,'B2F grass is reachable from the landing');
 // Dotted Hole has no authored landing: its unlocked door proves only the map.
 const hole='MAP_SIX_ISLAND_DOTTED_HOLE_1F',valley='MAP_SIX_ISLAND_RUIN_VALLEY';
 const floor=id=>({id,properties:{},warpEvents:[],connections:[],objectEvents:[],coordEvents:[],
  layout:{id,width:3,height:3,cells:Array.from({length:9},(_,i)=>({x:i%3,y:Math.floor(i/3),collision:0,elevation:3,encounterType:1,behaviorName:'MB_NORMAL'}))}});
 const obs=emberObservation(valley,{x:1,y:1});obs.playerMemory.storyState.flagIds[739]=true;
 const dotted=exact=>campaignTargetReachable({world:{data:{maps:[floor(valley),floor(hole)],wildEncounters:[]}},observation:obs,
  target:{kind:'encounter-zone',map:hole},origins:[{map:valley,position:{x:1,y:1}}],exact});
 assert.equal(dotted(false),true,'the unlocked door stages the hole');
 assert.equal(dotted(true),false,'without a landing the exact target is unproven');
});
