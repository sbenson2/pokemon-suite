import test from 'node:test';
import assert from 'node:assert/strict';
import {selectNpcTrade,FIRE_RED_NPC_TRADES} from '../src/suite/native-npc-trade.js';
import {createPostgameAcquisition,selectOwnedBreeding} from '../src/suite/native-acquisition.js';
import {ownedDexEvolutionOptions,partnerEvolutionNeeds,selectOwnedPartnerEvolution} from '../src/suite/fire-red-evolution.js';
import {nationalDexSources} from '../src/suite/national-dex-agenda.js';
import {resolvePostgameObjective} from '../src/suite/postgame-agenda.js';
import {encounterFingerprint as fingerprint} from '../src/player/encounter-tracker.js';

// Research pass, September 28: this save can still register Jynx (ZYNX, Cerulean)
// and Lickitung (MARC, Route 18) through FireRed's own in-game trades, then
// Smoochum by breeding the Jynx; Bellossom with the Ruin Valley Sun Stone;
// Politoed and Scizor with the Sevault Canyon King's Rock and the Memorial
// Pillar Metal Coat through a FireRed-to-FireRed partner round trip; and
// Wynaut with the Lost Cave Lax Incense. The League-trained Gloom stays as trained.
const mon=(species,personality,more={})=>({species,personality,otId:77,validity:'valid',isEgg:false,shiny:false,level:30,experience:27000,heldItem:0,friendship:70,hp:50,maxHp:50,moves:[33],
 ivs:{hp:1,attack:2,defense:3,speed:4,spAttack:5,spDefense:6},...more});
const trainer=({party=[mon(22,1,{slot:0,moves:[19]}),mon(55,2,{slot:1,level:100,heldItem:182})],stored=[],owned=[22,55,61,43,44,132]}={})=>({partyValidity:'valid',party,
 storage:{validity:'valid',pokemon:stored,boxCounts:[stored.length,...Array(13).fill(0)]},bag:{items:[],keyItems:[]},money:500000,pokedex:{ownedSpecies:owned}});

test('FireRed in-game trades register a missing species with a plain spare, never a teammate',()=>{
 assert.deepEqual(FIRE_RED_NPC_TRADES.find(t=>t.key==='zynx'),{key:'zynx',received:124,requested:61,map:'MAP_CERULEAN_CITY_HOUSE3',script:'CeruleanCity_House3_EventScript_Dontae',flagId:0x24A});
 const flags={0x24A:false,0x257:false};
 assert.deepEqual(selectNpcTrade({trainer:trainer(),flags}),{trade:FIRE_RED_NPC_TRADES[0],source:null},'no spare Poliwhirl yet: catch one first');
 const spare=mon(61,9,{box:0,slot:0});
 assert.equal(fingerprint(selectNpcTrade({trainer:trainer({stored:[spare]}),flags}).source),fingerprint(spare));
 assert.equal(selectNpcTrade({trainer:trainer({stored:[{...spare,shiny:true}]}),flags}).source,null,'never a shiny');
 assert.equal(selectNpcTrade({trainer:trainer({stored:[{...spare,heldItem:5}]}),flags}).source,null,'never an item holder');
 assert.equal(selectNpcTrade({trainer:trainer({stored:[spare]}),flags,protectedFingerprints:[fingerprint(spare)]}).source,null,'never a reserved one');
 const marc=selectNpcTrade({trainer:trainer({owned:[22,55,61,43,44,132,124]}),flags});
 assert.equal(marc.trade.key,'marc');assert.equal(marc.source,null,'the team Golduck in the party is never offered');
 assert.equal(selectNpcTrade({trainer:trainer(),flags:{0x24A:true,0x257:true}}),null,'a used trade is gone');
});

const world={data:{maps:[{id:'MAP_CERULEAN_CITY_HOUSE3',objectEvents:[{script:'CeruleanCity_House3_EventScript_OldWoman'},{script:'CeruleanCity_House3_EventScript_Dontae'}]}]}};
const observation=t=>({phase:'stable',frame:1,emulator:{mode:'overworld',inBattle:false},sram:{sha256:'a'.repeat(64)},playerMemory:{map:{id:'MAP_CERULEAN_CITY_HOUSE3'},ui:{},gameStats:{savedGame:5},
 storyState:{flagIds:{0x24A:false}},trainer:t}});
test('an in-game trade carries only its spare, trades it, restores the team and saves',()=>{
 const spare=mon(61,9,{box:0,slot:0}),golduck=mon(55,2,{slot:1,level:100,heldItem:182});
 const t=trainer({stored:[spare],party:[mon(22,1,{slot:0,moves:[19]}),golduck]});
 const create=state=>createPostgameAcquisition({kind:'npc-trade',requestId:'jynx',tradeKey:'zynx',source:spare,world,state});
 let task=create();const o=observation(t);
 let next=task.inspect(o);
 assert.equal(next.objective.target.kind,'party-roster');assert.deepEqual(next.objective.target.requiredFingerprints,[fingerprint(spare)]);
 t.party.push({...t.storage.pokemon.shift(),slot:2});t.storage.boxCounts[0]=0;
 task=create(JSON.parse(JSON.stringify(task.state)));next=task.inspect(o);
 assert.deepEqual(next.objective.target,{kind:'in-game-trade',map:'MAP_CERULEAN_CITY_HOUSE3',index:1,requestedSpecies:61,receivedSpecies:124});
 assert.equal(next.objective.choice,'yes');
 // The cartridge swaps the party slot and sets FLAG_DID_ZYNX_TRADE.
 t.party[2]=mon(124,4444,{otId:31337,slot:2,level:20});t.pokedex.ownedSpecies.push(124);o.playerMemory.storyState.flagIds[0x24A]=true;
 task=create(JSON.parse(JSON.stringify(task.state)));next=task.inspect(o);
 assert.equal(next.objective.target.kind,'save-game');assert.equal(task.state.dirty,true);
 o.playerMemory.gameStats.savedGame=6;o.playerMemory.saveAttemptStatus=1;o.sram.sha256='b'.repeat(64);
 const done=task.inspect(o);assert.equal(done.kind,'complete');
 assert.equal(done.receipt.pokemon.species,124);assert.equal(done.receipt.sent.fingerprint,fingerprint(spare));assert.equal(done.receipt.nativeSaveVerified,true);
});
test("an in-game trade keeps its travel objective while Fly's Start menu is open",()=>{
 const spare=mon(61,9,{slot:2}),t=trainer({party:[mon(22,1,{slot:0,moves:[19]}),mon(55,2,{slot:1}),spare]});
 const task=createPostgameAcquisition({kind:'npc-trade',requestId:'jynx',tradeKey:'zynx',source:spare,world});
 const o=observation(t);
 assert.equal(task.inspect(o).kind,'policy','the reserved trade begins from the field');
 o.emulator.mode='start-menu';
 o.playerMemory.ui.startMenu={cursor:1,count:7,order:['pokedex','pokemon','bag','player','save','option','exit'],selected:'pokemon'};
 const resumed=task.inspect(o);
 assert.equal(resumed.kind,'policy','the task must hand the open Fly menu back to the central planner');
 assert.equal(resumed.objective.id,'acquire-jynx-trade');
 assert.equal(resumed.objective.target.map,'MAP_CERULEAN_CITY_HOUSE3');
});
test("an in-game trade keeps its travel objective while Fly's map is open",()=>{
 const spare=mon(61,9,{slot:2}),t=trainer({party:[mon(22,1,{slot:0,moves:[19]}),mon(55,2,{slot:1}),spare]});
 const task=createPostgameAcquisition({kind:'npc-trade',requestId:'jynx',tradeKey:'zynx',source:spare,world});
 const o=observation(t);assert.equal(task.inspect(o).kind,'policy');
 o.emulator.mode='fly-map';o.playerMemory.ui.flyMap={stage:'selection',cursor:{x:11,y:6},selectedMapsec:94,selectedMapsecType:2,selectedDungeonType:0};
 const resumed=task.inspect(o);
 assert.equal(resumed.kind,'policy','the retained task must hand Fly-map selection back to the central planner');
 assert.equal(resumed.objective.id,'acquire-jynx-trade');
 assert.equal(resumed.objective.target.map,'MAP_CERULEAN_CITY_HOUSE3');
});
test('an in-game trade retains every other planner-owned travel and trader surface',()=>{
 const surfaces=[
  ['Start menu','start-menu',{startMenu:{cursor:1,order:['pokedex','pokemon','bag','player','save','option','exit']}}],
  ['party picker','party',{party:{stage:'choose-pokemon'}}],
  ['party action menu','party',{party:{stage:'selection-menu'}}],
  ['party message','party',{party:{stage:'message'}}],
  ['trader dialogue','overworld',{fieldDialog:{stage:'awaiting-page'}}],
  ['trader choice','overworld',{choiceMenu:{cursor:0,minCursor:0,maxCursor:1,selected:'yes'}}],
 ];
 for(const [name,mode,ui] of surfaces){
  const spare=mon(61,9,{slot:2}),t=trainer({party:[mon(22,1,{slot:0,moves:[19]}),mon(55,2,{slot:1}),spare]});
  const task=createPostgameAcquisition({kind:'npc-trade',requestId:'jynx',tradeKey:'zynx',source:spare,world}),o=observation(t);
  assert.equal(task.inspect(o).kind,'policy');o.emulator.mode=mode;o.playerMemory.ui=ui;
  const resumed=task.inspect(o);assert.equal(resumed.kind,'policy',name);assert.equal(resumed.objective.target.map,'MAP_CERULEAN_CITY_HOUSE3',name);
 }
});
test('an in-game trade retains post-trade team restoration across transitions and menus',()=>{
 const spare=mon(61,9,{box:0,slot:0}),original=[mon(22,1,{slot:0,moves:[19]}),mon(55,2,{slot:1}),mon(149,3,{slot:2}),mon(68,4,{slot:3}),mon(52,5,{slot:4}),mon(99,6,{slot:5})];
 const t=trainer({party:original,stored:[spare]}),create=state=>createPostgameAcquisition({kind:'npc-trade',requestId:'jynx',tradeKey:'zynx',source:spare,world,state}),o=observation(t);
 let task=create(),next=task.inspect(o);assert.equal(next.objective.id,'acquire-jynx-party');
 const missing=t.party.pop();t.storage.pokemon=[{...missing,box:0,slot:0}];t.storage.boxCounts[0]=1;t.party.push({...spare,box:undefined,slot:5});
 task=create(structuredClone(task.state));next=task.inspect(o);assert.equal(next.objective.id,'acquire-jynx-trade');
 t.party[5]=mon(124,4444,{otId:31337,slot:5,level:20});t.pokedex.ownedSpecies.push(124);o.playerMemory.storyState.flagIds[0x24A]=true;
 task=create(structuredClone(task.state));o.playerMemory.ui={fieldDialog:{stage:'awaiting-page'}};
 assert.equal(task.inspect(o).objective.id,'acquire-jynx-finish-dialogue','finish the native trade dialogue before starting restoration');
 o.playerMemory.ui={};next=task.inspect(o);assert.equal(next.objective.id,'acquire-jynx-restore-team');
 o.phase='transition';next=task.inspect(o);assert.equal(next.objective.id,'acquire-jynx-restore-team','transitions retain the owned restoration');
 o.phase='stable';o.emulator.mode='start-menu';o.playerMemory.ui={startMenu:{cursor:1,order:['pokedex','pokemon','bag','player','save','option','exit']}};
 next=task.inspect(o);assert.equal(next.objective.id,'acquire-jynx-restore-team','menus retain the owned restoration');
});
test('an in-game trade removes received Mail before restoring a full original team',()=>{
 const spare=mon(61,9,{box:0,slot:0}),original=[mon(22,1,{slot:0,moves:[19]}),mon(55,2,{slot:1}),mon(149,3,{slot:2}),mon(68,4,{slot:3}),mon(52,5,{slot:4}),mon(99,6,{slot:5})];
 const originalFingerprints=original.map(fingerprint),t=trainer({party:original,stored:[spare]}),create=state=>createPostgameAcquisition({kind:'npc-trade',requestId:'jynx',tradeKey:'zynx',source:spare,world,state}),o=observation(t);
 let task=create();task.inspect(o);
 const missing=t.party.pop();t.storage.pokemon=[{...missing,box:8,slot:18}];t.storage.boxCounts=[...Array(8).fill(0),1,...Array(5).fill(0)];t.party.push({...spare,box:undefined,slot:5});
 task=create(structuredClone(task.state));task.inspect(o);
 const jynx=mon(124,4444,{otId:31337,slot:5,level:20,heldItem:131});t.party[5]=jynx;t.pokedex.ownedSpecies.push(124);o.playerMemory.storyState.flagIds[0x24A]=true;
 task=create(structuredClone(task.state));let next=task.inspect(o);
 assert.deepEqual(next.objective.target,{kind:'take-held-item',map:'MAP_CERULEAN_CITY_HOUSE3',fingerprint:fingerprint(jynx),itemId:131,preserveLetter:true},'the received letter must move to the PC before Jynx can be stored');
 jynx.heldItem=0;next=task.inspect(o);
 assert.equal(next.objective.id,'acquire-jynx-restore-team');
 assert.deepEqual(next.objective.target.requiredFingerprints,originalFingerprints);
});
test('an in-game trade stores a same-species teammate so the picker offers only the spare',()=>{
 const spare=mon(55,9,{box:0,slot:0}),golduck=mon(55,2,{slot:1,level:100,heldItem:182});
 const t=trainer({stored:[],party:[mon(22,1,{slot:0,moves:[19]}),golduck,{...spare,slot:2}]});
 const task=createPostgameAcquisition({kind:'npc-trade',requestId:'lickitung',tradeKey:'marc',source:spare,world:{data:{maps:[]}}});
 const o=observation(t);o.playerMemory.storyState.flagIds={0x257:false};
 const next=task.inspect(o);
 assert.equal(next.objective.target.kind,'party-roster');assert.deepEqual(next.objective.target.excludedFingerprints,[fingerprint(golduck)]);
});

const pct=n=>({call:'PERCENT_FEMALE',args:[n]});
const facts=[[61,'POLIWHIRL',['WATER_1'],pct(50)],[124,'JYNX',['HUMAN_LIKE'],'MON_FEMALE'],[238,'SMOOCHUM',['UNDISCOVERED'],'MON_FEMALE'],[108,'LICKITUNG',['MONSTER'],pct(50)],
 [55,'GOLDUCK',['WATER_1','FIELD'],pct(50)],[186,'POLITOED',['WATER_1'],pct(50)],[123,'SCYTHER',['BUG'],pct(50)],[212,'SCIZOR',['BUG'],pct(50)],[132,'DITTO',['DITTO'],'MON_GENDERLESS'],
 [43,'ODDISH',['GRASS'],pct(50)],[44,'GLOOM',['GRASS'],pct(50)],[182,'BELLOSSOM',['GRASS'],pct(50)],[202,'WOBBUFFET',['AMORPHOUS'],pct(50)],[360,'WYNAUT',['UNDISCOVERED'],pct(50)]];
const mechanics={data:{species:facts.map(([id,name,groups,genderRatio])=>({id,name:'SPECIES_'+name,eggGroups:groups.map(g=>'EGG_GROUP_'+g),genderRatio,growthRate:'GROWTH_MEDIUM_FAST'}))}};
const sourcesWorld={data:{maps:[],wildEncounters:[{map:'MAP_ROUTE6',base_label:'sRoute6_FireRed',fishing_mons:{encounter_rate:20,mons:Array.from({length:10},(_,i)=>({species:i===6?'SPECIES_POLIWHIRL':'SPECIES_MAGIKARP',min_level:20,max_level:30}))}}]}};
test('the collection lists in-game trades, their Eggs and FireRed partner trade evolutions as local work',()=>{
 const t=trainer({stored:[mon(123,70,{box:0,slot:0}),mon(132,71,{box:0,slot:1})],owned:[22,55,61,123,132,43,44]});
 const o={phase:'stable',frame:1,emulator:{mode:'overworld'},playerMemory:{map:{id:'MAP_LAVENDER_TOWN'},storyState:{flagIds:{0x24A:false,0x257:false,0x1E7:false,0x1E0:false,2116:true},variableIds:{}},trainer:t}};
 const rows=nationalDexSources({o,world:sourcesWorld,mechanics}),row=id=>rows.find(r=>r.speciesId===id);
 assert.equal(row(124).method,'npc-trade');assert.equal(row(124).status,'local');assert.equal(row(108).method,'npc-trade');
 assert.equal(row(238).status,'local');assert.match(row(238).reason,/Jynx/i);
 assert.equal(row(186).status,'local');assert.equal(row(186).category,'firered-partner');assert.match(row(186).reason,/King/);
 assert.equal(row(212).status,'local');assert.equal(row(212).category,'firered-partner');
 o.playerMemory.storyState.flagIds[0x1E0]=true;
 assert.equal(nationalDexSources({o,world:sourcesWorld,mechanics}).find(r=>r.speciesId===212).status,'external','a collected and spent Metal Coat leaves no source');
});

test('trade evolutions prefer the FireRed partner and first collect a missing held item or catch a spare',()=>{
 const partners={available:true,partners:[{owner:'emerald',title:'emerald'},{owner:'firered-partner',title:'firered'}]};
 const t=trainer({stored:[mon(123,70,{box:0,slot:0})],owned:[22,55,61,123,65,68,76,94,208,230,233]});
 t.bag.items=[{itemId:199,quantity:1}];
 const scizor=selectOwnedPartnerEvolution({trainer:t,partnerAvailable:partners,preferFireRed:true});
 assert.equal(scizor.request.speciesId,212);assert.equal(scizor.steps.find(s=>s.kind==='trade').partner,'firered-partner','the evolution happens in FireRed');
 t.bag.items=[];
 const scyther=partnerEvolutionNeeds({trainer:t,partnerAvailable:partners,canSupply:id=>id===199});
 assert.deepEqual([scyther.rule.speciesId,scyther.itemId,scyther.source],[212,199,t.storage.pokemon[0]],'Scizor waits for the collectible Metal Coat');
 const politoed=partnerEvolutionNeeds({trainer:{...t,storage:{...t.storage,pokemon:[]}},partnerAvailable:partners,canSupply:()=>true});
 assert.equal(politoed.rule.speciesId,186);assert.equal(politoed.itemId,187,'the King’s Rock is collected first');
 assert.equal(partnerEvolutionNeeds({trainer:t,partnerAvailable:false,canSupply:()=>true}),null,'no partner ready, no detour');
});

test('Bellossom evolves a plain Oddish through Gloom and never the League-trained Gloom',()=>{
 const gloom=mon(44,2148015641,{slot:1,level:100}),oddish=mon(43,5,{box:8,slot:6,level:null});
 const t=trainer({party:[mon(22,1,{slot:0,moves:[19]}),gloom],stored:[oddish],owned:[22,43,44,45]});
 const direct=ownedDexEvolutionOptions({trainer:t,scope:'national',canSupply:id=>id===93});
 assert.equal(direct.find(x=>x.rule.speciesId===182)?.pokemon.species,44,'without protection the party Gloom would be used');
 const chained=ownedDexEvolutionOptions({trainer:t,scope:'national',canSupply:id=>id===93,protectedFingerprints:[fingerprint(gloom)],chains:true}).find(x=>x.rule.speciesId===182);
 assert.equal(chained.pokemon.species,43);assert.deepEqual(chained.chain.map(r=>[r.fromSpecies,r.speciesId]),[[43,44],[44,182]]);
 const o={phase:'stable',frame:1,emulator:{mode:'overworld'},playerMemory:{map:{id:'MAP_LAVENDER_TOWN'},storyState:{flagIds:{2092:true,2112:true,2116:true},variableIds:{}},trainer:t,postgameEvidence:{}}};
 const r=resolvePostgameObjective('national-collection',o,{data:{maps:[],wildEncounters:[]}},{leagueExpShare:{completed:['[2148015641,77]']}},
  {mechanics:{data:{species:[]}},planner:{selectItemPreparation:(_,id)=>id===93?{id:'sun',target:{kind:'object',map:'MAP_SIX_ISLAND_RUIN_VALLEY',index:16}}:null}});
 assert.equal(r.target.kind,'postgame-evolve');assert.equal(r.evolution.pokemon.species,43,'the League-trained Gloom stays as trained');
 assert.deepEqual(r.evolution.steps.map(s=>s.kind),['evolve','evolve','verify']);
});

test('Wynaut breeds once the Lost Cave Lax Incense is collected',()=>{
 const t=trainer({stored:[mon(202,5,{box:0,slot:0}),mon(132,6,{box:0,slot:1})],owned:[22,55,202,132]});
 assert.equal(selectOwnedBreeding({trainer:t,mechanics}),null,'no incense, no Wynaut');
 const choice=selectOwnedBreeding({trainer:t,mechanics,canSupply:id=>id===221});
 assert.equal(choice.speciesId,360);assert.equal(choice.itemId,221);
 const daycare={data:{maps:[{id:'MAP_FOUR_ISLAND_POKEMON_DAY_CARE',objectEvents:[{script:'FourIsland_PokemonDayCare_EventScript_DaycareWoman'}]}]}};
 const supply={id:'lax',target:{kind:'object',map:'MAP_FIVE_ISLAND_LOST_CAVE_ROOM11',index:0},completion:{kind:'flag-set',id:505}};
 const task=createPostgameAcquisition({kind:'breeding',requestId:'wynaut',...choice,world:daycare,mechanics,planner:{selectItemPreparation:(_,id)=>id===221?supply:null}});
 const o={phase:'stable',frame:1,emulator:{mode:'overworld',inBattle:false},sram:{sha256:'a'},playerMemory:{map:{id:'MAP_FOUR_ISLAND_POKEMON_CENTER_1F'},ui:{},gameStats:{savedGame:1},trainer:t,
  postgameEvidence:{acquisition:{daycare:{validity:'valid',parents:[],pendingEgg:false,offspringPersonality:0}}}}};
 const next=task.inspect(o);
 assert.deepEqual(next.objective?.target,supply.target,'the incense is collected before either parent leaves the PC');
 assert.notEqual(task.state.dirty,true);
});

test('the National Dex checklist catches a plain spare for an in-game trade, stores it, then trades it',()=>{
 const flags={2092:true,2112:true,2116:true,0x24A:false,597:true,576:false,580:false};
 const o=t=>({phase:'stable',frame:1,emulator:{mode:'overworld'},playerMemory:{map:{id:'MAP_LAVENDER_TOWN'},position:{x:1,y:1},storyState:{flagIds:{...flags},variableIds:{}},trainer:t,postgameEvidence:{}}});
 const t=trainer({owned:[22,55,61,43,44,132]});t.bag.keyItems=[{itemId:264,quantity:1}];
 const world={data:{maps:[{id:'MAP_CERULEAN_CITY_HOUSE3'},{id:'MAP_ROUTE6'}],wildEncounters:sourcesWorld.data.wildEncounters}};
 const context={mechanics,teamPlan:{permanentFamilies:[[21,22],[54,55]]}};
 const hunt=resolvePostgameObjective('national-collection',o(t),world,{},context);
 assert.equal(hunt.target.kind,'postgame-hunt');assert.deepEqual([hunt.request.speciesId,hunt.route.method,hunt.route.rodItemId],[61,'fishing',264],'a Super Rod Poliwhirl for ZYNX');
 const carried=mon(61,9,{slot:2,level:25});t.party.push(carried);
 const store=resolvePostgameObjective('national-collection',o(t),world,{},context);
 assert.equal(store.target.kind,'party-roster');assert.deepEqual(store.target.excludedFingerprints,[fingerprint(carried)]);
 t.party.pop();t.storage.pokemon.push({...carried,box:0,slot:0});
 const trade=resolvePostgameObjective('national-collection',o(t),world,{},context);
 assert.equal(trade.target.kind,'postgame-acquire');assert.equal(trade.acquisition.kind,'npc-trade');assert.equal(trade.acquisition.tradeKey,'zynx');
});
