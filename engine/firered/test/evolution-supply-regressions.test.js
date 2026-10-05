import test from 'node:test';
import assert from 'node:assert/strict';
import {createCampaignPlanner} from '../src/player/campaign.js';
import {createPostgameController} from '../src/suite/postgame.js';
import {FireRedEvolutionTask,ownedDexEvolutionOptions} from '../src/suite/fire-red-evolution.js';
import {encounterFingerprint} from '../src/player/encounter-tracker.js';

// Gate gate-verification-124-01 (build 124): from the Rare Candy checkpoints the
// owner (1) chose the new Oddish → Gloom → Bellossom chain ahead of the Diglett
// it was levelling, (2) accepted the Ruin Valley Sun Stone as a supply although
// Strength boulders wall it off, then stopped as `blocked` at Six Island's
// harbor, and (3) opened the Rare Candy supply while the last candy's level-up
// was still on screen, so the supply's menu closer pressed B at "Stop trying
// to teach …?".

// (1) A walled-off island item ball is not a verified supply. Ruin Valley's Sun
// Stone (43,32) sits behind Strength boulders at (41,32), (41,33) and (42,33):
// the valley can be entered, the ball cannot be reached.
const cells=(width,height,wall)=>Array.from({length:width*height},(_,i)=>{const x=i%width,y=Math.floor(i/width);
 return {x,y,collision:wall(x,y)?1:0,elevation:3,encounterType:0,behaviorName:'MB_NORMAL'};});
const room=(id,{width=10,height=10,warps=[],objects=[],wall=()=>false}={})=>({id,properties:{},connections:[],warpEvents:warps,coordEvents:[],backgroundEvents:[],objectEvents:objects,
 layout:{id,width,height,cells:cells(width,height,wall).map(c=>warps.some(w=>w.x===c.x&&w.y===c.y)?{...c,collision:0,behaviorName:'MB_LADDER'}:c)}});
const ball={graphics_id:'OBJ_EVENT_GFX_ITEM_BALL',x:7,y:2,elevation:3,script:'SixIsland_RuinValley_EventScript_ItemSunStone',flag:'FLAG_HIDE_SIX_ISLAND_RUIN_VALLEY_SUN_STONE'};
const islandWorld=walled=>({data:{maps:[
 room('MAP_LAVENDER_TOWN'),
 room('MAP_SIX_ISLAND_HARBOR',{warps:[{x:9,y:9,dest_map:'MAP_SIX_ISLAND_RUIN_VALLEY',dest_warp_id:'0'}]}),
 room('MAP_SIX_ISLAND_RUIN_VALLEY',{warps:[{x:0,y:9,dest_map:'MAP_SIX_ISLAND_HARBOR',dest_warp_id:'0'}],objects:[ball],wall:(x)=>walled&&x===4}),
],wildEncounters:[]}});
const story={data:{symbols:{flags:{FLAG_HIDE_SIX_ISLAND_RUIN_VALLEY_SUN_STONE:{value:486}},items:{ITEM_SUN_STONE:{value:93}}},
 scripts:[{label:'SixIsland_RuinValley_EventScript_ItemSunStone',instructions:[{op:'finditem',args:['ITEM_SUN_STONE']}]}]}};
const at=map=>({phase:'stable',frame:1,emulator:{mode:'overworld'},playerMemory:{map:{id:map},position:{x:8,y:5},ui:{},
 storyState:{flagIds:{486:false,2092:true,2112:true,2116:true},variableIds:{}},trainer:{money:500000,partyValidity:'valid',party:[],bag:{items:[],keyItems:[]}}}});

test('an island item ball walled off from every entrance is not a verified supply, from Kanto or from its harbor',()=>{
 const open=createCampaignPlanner({campaign:{objectives:[]},world:islandWorld(false),story,mechanics:{data:{species:[]}}});
 assert.equal(open.selectItemPreparation(at('MAP_LAVENDER_TOWN'),93)?.target.map,'MAP_SIX_ISLAND_RUIN_VALLEY','a reachable ball across the ferry stays a supply');
 assert.equal(open.selectItemPreparation(at('MAP_SIX_ISLAND_HARBOR'),93)?.target.map,'MAP_SIX_ISLAND_RUIN_VALLEY','and the same ball is a supply at its harbor');
 const walled=createCampaignPlanner({campaign:{objectives:[]},world:islandWorld(true),story,mechanics:{data:{species:[]}}});
 assert.equal(walled.selectItemPreparation(at('MAP_SIX_ISLAND_HARBOR'),93),null,'standing on the island, the walled ball has no route');
 assert.equal(walled.selectItemPreparation(at('MAP_LAVENDER_TOWN'),93),null,'from Kanto it must not look reachable either (entering the map is not reaching the ball)');
});

// (2) The candy flow owns its prompts until the field is free.
const mon=(species,extra={})=>({validity:'valid',species,personality:123,otId:456,shiny:true,level:20,friendship:70,heldItem:0,slot:0,hp:70,maxHp:70,status1:0,
 moves:[33],pp:[35],ivs:{hp:20,attack:20,defense:20,speed:20,spAttack:20,spDefense:20},evs:{hp:0,attack:0,defense:0,speed:0,spAttack:0,spDefense:0},...extra});
const observe=(party,{items=[],mode='overworld',ui={}}={})=>({phase:'stable',frame:100,emulator:{mode,inBattle:false,inputReady:true},sram:{sha256:'before'},
 playerMemory:{map:{id:'MAP_CELADON_CITY_POKEMON_CENTER_1F'},position:{x:7,y:8},ui,storyState:{flagIds:{2112:true}},gameStats:{savedGame:7},saveAttemptStatus:1,
  trainer:{money:10000,partyValidity:'valid',party,storage:{validity:'valid',pokemon:[]},bag:{items}}}});
const larvitar=level=>mon(246,{level,experienceProgress:{current:1000,levelStart:1000,nextLevel:1900,remaining:900},experience:1000});

test('the last Rare Candy’s level-up and move prompts finish before a Rare Candy supply takes over',()=>{
 const task=new FireRedEvolutionTask({requestId:'dex-456-123-247',sourceId:'owned-national-dex',pokemon:larvitar(20),
  steps:[{kind:'evolve',game:'firered',fromSpecies:246,speciesId:247},{kind:'verify',game:'firered',speciesId:247}],request:{game:'firered',speciesId:247,shiny:'required',quantity:1}});
 const options={renewableCandies:true,canSupply:id=>id===68};
 const first=task.inspect(observe([larvitar(20)],{items:[{itemId:68,quantity:1}]}),options);
 assert.equal(first.objective?.target.kind,'use-party-item','the last candy is used');
 for(const ui of [{levelUp:{stage:'stats-page-1'}},{levelUp:{stage:'move-check'}},{moveLearning:{stage:'confirm-stop-learning',partySlot:0,moveId:44,itemId:68,cursor:0}}]){
  const next=task.inspect(observe([larvitar(21)],{mode:'party',ui}),options);
  assert.notEqual(next.kind,'supply',`no supply while ${JSON.stringify(ui)} is on screen`);
  assert.equal(next.kind,'policy');
 }
 assert.equal(task.inspect(observe([larvitar(21)]),options).kind,'supply','from the free field the supply starts');
});

// The guard covers only this task's own item use. A supply's own menus (a mart
// purchase, an item ball's message, the travel-lead party reorder before a
// ferry) stay with the supply objective, or the owner undoes the supply it is
// running (verify-fix-1/2: the bred Eevee's Thunder Stone trip looped as
// "repeated-menu-transaction").
test('a supply that is under way keeps its own menus; only this task’s item-use prompts wait',()=>{
 const pikachu=mon(25,{shiny:false,level:30});
 const task=new FireRedEvolutionTask({requestId:'dex-456-123-26',sourceId:'owned-national-dex',pokemon:pikachu,
  steps:[{kind:'evolve',game:'firered',fromSpecies:25,speciesId:26},{kind:'verify',game:'firered',speciesId:26}],request:{game:'firered',speciesId:26,shiny:'any',quantity:1}});
 assert.equal(task.inspect(observe([pikachu],{mode:'mart',ui:{shop:{stage:'buy-list'}}})).kind,'supply','buying the Thunder Stone continues');
 assert.equal(task.inspect(observe([pikachu],{ui:{fieldDialog:{stage:'message'}}})).kind,'supply','an item ball message continues');
 assert.equal(task.inspect(observe([pikachu],{mode:'party',ui:{party:{stage:'choose-switch-target'}}})).kind,'supply','the travel-lead reorder continues');
 assert.equal(task.inspect(observe([pikachu])).kind,'supply');
});

// (3) A national Dex evolution never blocks the owner on a missing supply.
const args={world:{data:{maps:[],wildEncounters:[]}},story:{data:{scripts:[]}},mechanics:{data:{species:[]}}};
const gloom=mon(44,{shiny:false,level:30,slot:0});
test('a national Dex evolution whose item has no verified supply is retained for retry instead of blocking the owner',()=>{
 let now=1000;const c0=createPostgameController(args);c0.beginAdventure();const state=c0.state();
 state.dexEvolution=new FireRedEvolutionTask({requestId:'dex-456-123-182',sourceId:'owned-national-dex',pokemon:gloom,
  steps:[{kind:'evolve',game:'firered',fromSpecies:44,speciesId:182},{kind:'verify',game:'firered',speciesId:182}],request:{game:'firered',speciesId:182,shiny:'any',quantity:1}}).state;
 const o={captureId:'supply',frame:100,phase:'stable',phaseReasons:[],sram:{sha256:'before'},
  emulator:{mode:'overworld',inBattle:false,inputReady:true},playerMemory:{map:{id:'MAP_SIX_ISLAND_HARBOR'},position:{x:8,y:5},ui:{},
   storyState:{flagIds:{2092:true,2112:true},variableIds:{}},gameStats:{savedGame:7},saveAttemptStatus:1,
   trainer:{partyValidity:'valid',party:[gloom],usablePartyCount:1,pokedex:{ownedSpecies:[43,44]},bag:{},storage:{validity:'valid',pokemon:[],boxCounts:Array(14).fill(0)}}}};
 for(const part of [o.sram,o.emulator,o.playerMemory])Object.assign(part,{frame:o.frame,captureId:o.captureId});
 const c=createPostgameController({...args,state,clock:()=>now});
 const d=c.decide(o);
 assert.notEqual(d.kind,'blocked',d.reason);
 const after=c.state();
 assert.equal(after.dexEvolution,null,'the evolution yields');
 assert.equal(after.deferredEvolutions.length,1,'and is retained, not discarded');
 assert.equal(encounterFingerprint(after.deferredEvolutions[0].state.originalPokemon),encounterFingerprint(gloom));
 assert.ok(after.deferredEvolutions[0].retryAt>now);
 assert.match(after.deferredEvolutions[0].reason,/Sun Stone/);
});

// (4) A two-step chain is ranked by its whole cost, after a shorter direct level-up.
test('a two-step evolution chain ranks after a direct level-up that needs fewer levels',()=>{
 const diglett=mon(50,{shiny:false,level:21,personality:1});
 const oddish=mon(43,{shiny:false,level:5,personality:2,slot:null});
 const trainer={partyValidity:'valid',party:[diglett],storage:{validity:'valid',pokemon:[oddish]},pokedex:{ownedSpecies:[43,44,45,50]},bag:{items:[]}};
 const options=ownedDexEvolutionOptions({trainer,scope:'national',chains:true,canSupply:()=>true});
 assert.deepEqual(options.map(x=>x.rule.speciesId),[51,182],'Dugtrio (5 levels) before Bellossom (16 levels and a Sun Stone)');
 assert.ok(options[1].chain,'the Bellossom route is the chain');
 const near=ownedDexEvolutionOptions({trainer:{...trainer,storage:{validity:'valid',pokemon:[{...oddish,level:18}]}},scope:'national',chains:true,canSupply:()=>true});
 assert.deepEqual(near.map(x=>x.rule.speciesId),[51,182],'a chain costs its levels plus its item trip (3 + 2 > 5)');
 const stocked=ownedDexEvolutionOptions({trainer:{...trainer,bag:{items:[{itemId:93,quantity:1}]},storage:{validity:'valid',pokemon:[{...oddish,level:19}]}},scope:'national',chains:true,canSupply:()=>false});
 assert.deepEqual(stocked.map(x=>x.rule.speciesId),[182,51],'two levels and a stocked stone beat five levels');
});
