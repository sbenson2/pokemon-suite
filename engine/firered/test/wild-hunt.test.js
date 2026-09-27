import test from 'node:test';
import assert from 'node:assert/strict';
import {createSuiteMission} from '../src/suite/mission.js';
import {createPolicyAdvisors} from '../src/player/advisors.js';

const request={game:'firered',speciesId:32,quantity:3,shiny:'required',locationId:'10:297:1:',natures:[],gender:'any',abilityId:null,minIvs:{},moves:[],heldItemId:null,finalLevel:null,ball:{id:'any',requirement:'required'},encounterLevel:{min:1,max:100},limits:{maxEncounters:1000,maxMinutes:60,minBalls:10,maxSpend:5000},afterCompletion:'stop-save'};
const route={map:'MAP_ROUTE3',locationId:request.locationId,speciesId:32,nativeSpecies:32,name:'Nidoran♂',method:'wild-land',minLevel:6,maxLevel:7};
const mechanics={data:{species:[{id:32,name:'SPECIES_NIDORAN_M',genderRatio:'MON_MALE',abilities:['ABILITY_POISON_POINT','ABILITY_NONE']}]}};
const world={data:{wildEncounters:[{map:'MAP_ROUTE3',base_label:'sRoute3_FireRed',land_mons:{mons:[{species:'SPECIES_NIDORAN_M',min_level:6,max_level:7}]}}]}};
const make=(delta={})=>createSuiteMission({id:'nidoran-batch',request:{...request,...delta},route,world,mechanics});
const observation=()=>({phase:'stable',emulator:{inBattle:false,mode:'overworld'},playerMemory:{map:{id:'MAP_ROUTE3'},ui:{},trainer:{partyValidity:'valid',party:[{species:43,moves:[230],hp:30,maxHp:30}],money:10000,bag:{pokeBalls:[{itemId:2,quantity:60}]},storage:{validity:'valid',boxCounts:Array(14).fill(0)}}}});
const receipt=(personality,species=32)=>({nativeSaveVerified:true,fingerprint:`${species}:${personality}`,savedSramSha256:`saved-${personality}`,pokemon:{validity:'valid',isEgg:false,personality,otId:42,species,shiny:true}});

test('an Unown hunt rejects a form that cannot appear in the selected native chamber',()=>{
 const map='MAP_SEVEN_ISLAND_TANOBY_RUINS_MONEAN_CHAMBER',request2={...request,speciesId:201,locationId:'any'};
 const args={id:'unown',request:request2,world:{data:{wildEncounters:[{map,base_label:'Monean_FireRed',land_mons:{mons:[{species:'SPECIES_UNOWN',min_level:25,max_level:25}]}}]}},mechanics:{data:{species:[{id:201,name:'SPECIES_UNOWN'}]}}};
 const route={map,speciesId:201,nativeSpecies:201,method:'wild-land',unownForm:27};
 assert.doesNotThrow(()=>createSuiteMission({...args,route}));
 assert.throws(()=>createSuiteMission({...args,route:{...route,unownForm:26}}),/form.*chamber/i);
});

test('a supported Unown chamber uses normal native encounters instead of the unsupported land RNG planner',()=>{
 const map='MAP_SEVEN_ISLAND_TANOBY_RUINS_MONEAN_CHAMBER',request2={...request,speciesId:201,locationId:'any',shiny:'any'};
 const world2={data:{wildEncounters:[{map,base_label:'Monean_FireRed',land_mons:{mons:[{species:'SPECIES_UNOWN',min_level:25,max_level:25}]}}]}};
 const m=createSuiteMission({id:'unown-normal',request:request2,route:{map,speciesId:201,nativeSpecies:201,method:'wild-land',unownForm:27},world:world2,mechanics:{data:{species:[{id:201,name:'SPECIES_UNOWN'}]}}});
 const o=observation();o.playerMemory.map.id=map;m.initialize(o);
 const next=m.inspect(o);assert.equal(next.kind,'policy');assert.equal(next.objective.id,'hunt-requested-pokemon');
});

test('ordinary wild encounters use the central escape, trap and replacement policy',()=>{
 const m=make(),o=observation();m.initialize(o);o.emulator.inBattle=true;
 o.playerMemory.encounter={kind:'wild',validity:'valid',pokemon:{...receipt(10,202).pokemon,shiny:false}};
 o.playerMemory.battleTypeFlags=4;o.playerMemory.battle={opponent:{ability:23}};
 for(const ui of [{battle:{stage:'action'}},{battle:{stage:'message'}},{party:{stage:'choose-pokemon'}},{choiceMenu:{cursor:0}}]){
  o.playerMemory.ui=ui;assert.equal(m.inspect(o).kind,'policy','the hunt must not bypass native battle legality');
 }
 assert.equal(m.captureRequirements().fightTrappedNonTargets,true);
 o.playerMemory.encounter.pokemon.shiny=true;
 assert.equal(m.inspect(o).kind,'protect','a shiny trapper still takes capture priority');
});

test('Nidoran batch uses its selected land route and optimized ordinary capture controls',()=>{
 const m=make(),o=observation();m.initialize(o);
 assert.equal(m.state.method,'wild-land');assert.equal(m.inspect(o).kind,'rng');
 assert.deepEqual(m.capturePolicy().targets[0].required.species,[32]);
 assert.equal(m.captureRequirements().safari,false);assert.equal(m.captureRequirements().optimizeCapture,true);
});

test('RNG planning waits for the arrival or battle fade to finish at the hunt map',()=>{
 const m=make(),o=observation();m.initialize(o);
 o.phase='transition';o.phaseReasons=['palette-fade','script-lock','transient-task'];
 o.emulator.paletteFadeActive=true;
 assert.equal(m.inspect(o).kind,'wait','advance the native fade before holding a planning checkpoint');
 o.phase='unknown';assert.equal(m.inspect(o).kind,'wait');
 o.phase='stable';o.phaseReasons=[];o.emulator.paletteFadeActive=false;
 assert.equal(m.inspect(o).kind,'rng');
});

test('the transition guard still protects an incidental shiny before waiting',()=>{
 const m=make(),o=observation();m.initialize(o);
 o.phase='transition';o.emulator.inBattle=true;
 o.playerMemory.encounter={kind:'wild',validity:'valid',pokemon:receipt(12,25).pokemon};
 assert.equal(m.inspect(o).kind,'protect');
 assert.equal(m.state.protected,true);
});

test('a restored but unpainted framebuffer gets a neutral wait before RNG planning',()=>{
 const m=make(),o=observation();m.initialize(o);
 const rgba=new Uint8Array([0,0,0,255,0,0,0,255]);
 const videoFrame=()=>({width:2,height:1,rgba});
 assert.equal(m.inspect(o,{videoFrame}).kind,'wait','opaque black is not a painted game scene');
 rgba[4]=90;assert.equal(m.inspect(o,{videoFrame}).kind,'rng');
});
test('wild routes are checked against this cartridge table and the requested location',()=>{
 assert.throws(()=>createSuiteMission({id:'bad',request,route:{...route,map:'MAP_ROUTE1'},world,mechanics}),/table/);
 assert.throws(()=>make({locationId:'10:330:1:'}),/location/);
 assert.throws(()=>make({moves:[156]}),/as caught/);
});
test('each new capture must be natively saved and only three distinct target identities complete the batch',()=>{
 const m=make();m.initialize(observation());m.state.elapsedMs=12345;m.state.encounters=7;
 assert.throws(()=>m.acceptSavedCapture({...receipt(1),nativeSaveVerified:false}),/save/);
 assert.equal(m.acceptSavedCapture(receipt(99,25)).complete,false);assert.equal(m.state.caught,0);
 assert.equal(m.acceptSavedCapture(receipt(1)).complete,false);assert.equal(m.state.caught,1);
 assert.equal(m.acceptSavedCapture(receipt(1)).complete,false);assert.equal(m.state.caught,1);
 const resumed=createSuiteMission({id:'nidoran-batch',request,state:m.state,world,mechanics});
 assert.equal(resumed.acceptSavedCapture(receipt(2)).complete,false);
 assert.equal(resumed.acceptSavedCapture(receipt(3)).complete,true);assert.equal(resumed.state.caught,3);
 assert.equal(resumed.state.elapsedMs,12345);assert.equal(resumed.state.encounters,7);
});
test('ordinary matching targets and every incidental shiny are protected before resource limits',()=>{
 const m=make({shiny:'any',gender:'male'}),o=observation();m.initialize(o);
 o.emulator.inBattle=true;o.playerMemory.encounter={kind:'wild',validity:'valid',pokemon:{...receipt(1).pokemon,shiny:false}};
 assert.equal(m.inspect(o).kind,'protect');
 const shiny=make();shiny.initialize(observation());shiny.state.elapsedMs=99999999;
 o.playerMemory.encounter.pokemon=receipt(2,25).pokemon;
 assert.equal(shiny.inspect(o).kind,'protect');
});
test('ordinary land supplies respect a required ball and spending limit',()=>{
 const m=make({ball:{id:'great-ball',requirement:'required'}}),o=observation();m.initialize(o);
 assert.equal(m.inspect(o).objective.target.kind,'purchase-items');
 assert.equal(m.inspect(o).objective.target.items[0].itemId,3);
 assert.ok(m.inspect(o).objective.target.items[0].quantity*600<=5000);
});
test('postgame mixed shopping survives a restart and completes a shop before moving on',()=>{
 const shopWorld={data:{...world.data,maps:[{id:'MAP_VIRIDIAN_CITY_MART',objectEvents:[{script:'clerk'}]}]}};
 const story={data:{symbols:{items:{ITEM_POKE_BALL:{value:4}}},scripts:[{label:'clerk',instructions:[{op:'pokemart',args:['stock']}]},{label:'stock',instructions:[{op:'.2byte',args:['ITEM_POKE_BALL']}]}]}};
 const args={id:'mixed-supply',request:{...request,ball:{id:'any',requirement:'preferred'},limits:{...request.limits,maxSpend:10000}},route,world:shopWorld,story,mechanics};
 let m=createSuiteMission(args),o=observation();o.playerMemory.storyState={flagIds:{2092:true,2116:true,2118:true},variableIds:{0x4078:4}};o.playerMemory.trainer.money=44000;o.playerMemory.trainer.bag.pokeBalls=[{itemId:4,quantity:13}];m.initialize(o);
 const first=m.inspect(o);assert.equal(first.objective.target.map,'MAP_TWO_ISLAND');assert.ok(m.state.ballSupply.steps.some(s=>s.items.some(i=>i.itemId===10)));
 m=createSuiteMission({...args,state:JSON.parse(JSON.stringify(m.state))});o.playerMemory.map.id='MAP_TWO_ISLAND';
 const purchase=m.inspect(o);assert.equal(purchase.objective.target.kind,'purchase-items');
 for(const item of purchase.objective.target.items)o.playerMemory.trainer.bag.pokeBalls.push({itemId:item.itemId,quantity:item.quantity});
 o.playerMemory.ui.mart={stage:'main-menu'};assert.equal(m.inspect(o).objective.target.map,'MAP_TWO_ISLAND');
 o.playerMemory.ui={};o.emulator.callback2='CB2_BuyMenu';assert.equal(m.inspect(o).objective.target.map,'MAP_TWO_ISLAND','inventory arrives before the native shop payment finishes');
 o.emulator.callback2='CB2_Overworld';assert.equal(m.inspect(o).objective.target.map,'MAP_ROUTE3');
});
test('bulk supplies earn their funding before shopping and keep the target across restart',()=>{
 const shopWorld={data:{...world.data,maps:[{id:'MAP_VIRIDIAN_CITY_MART',objectEvents:[{script:'clerk'}]}]}};
 const story={data:{symbols:{items:{ITEM_POKE_BALL:{value:4}}},scripts:[{label:'clerk',instructions:[{op:'pokemart',args:['stock']}]},{label:'stock',instructions:[{op:'.2byte',args:['ITEM_POKE_BALL']}]}]}};
 const fundingPlanner={selectIncomePreparation:()=>({id:'fund-capture-supplies',target:{kind:'object',map:'MAP_ROUTE11',index:0}}),selectRecovery:()=>({id:'recover-party',target:{kind:'object',map:'MAP_VIRIDIAN_CITY_POKEMON_CENTER_1F',index:1}})};
 const args={id:'bulk-funding',request:{...request,ball:{id:'any',requirement:'preferred'},limits:{...request.limits,maxSpend:999999}},route,world:shopWorld,story,mechanics,fundingPlanner};
 let m=createSuiteMission(args),o=observation();o.playerMemory.storyState={flagIds:{2092:true,2116:true,2118:true},variableIds:{0x4078:4}};o.playerMemory.trainer.money=10000;o.playerMemory.trainer.party=[{slot:0,species:18,level:67,hp:90,maxHp:200,moves:[19,230],pp:[15,20]}];m.initialize(o);
 const initial=m.inspect(o);assert.equal(initial.kind,'policy');assert.equal(initial.objective.id,'recover-party');assert.equal(m.state.phase,'funding-balls');assert.ok(m.state.ballFunding.targetMoney>250000);
 o.playerMemory.trainer.party[0].hp=200;o.phase='transition';assert.equal(m.inspect(o).objective?.id,'recover-party','finish the healing interaction during its final transition');o.phase='stable';
 const target=m.state.ballFunding.targetMoney;m=createSuiteMission({...args,state:JSON.parse(JSON.stringify(m.state))});m.state.ballFunding.healed=true;m.state.ballFunding.healing=null;m.state.ballFunding.objective=null;o.playerMemory.trainer.party[0].hp=200;
 o.phase='transition';assert.equal(m.inspect(o).kind,'wait');o.phase='stable';
 assert.equal(m.inspect(o).objective.id,'fund-capture-supplies');assert.equal(m.state.ballFunding.targetMoney,target);
 o.emulator.inBattle=true;o.playerMemory.encounter={kind:'trainer'};assert.equal(m.inspect(o).objective?.id,'fund-capture-supplies');assert.equal(m.state.phase,'funding-balls');o.emulator.inBattle=false;o.playerMemory.encounter=null;
 o.playerMemory.trainer.money=target;o.playerMemory.map.id='MAP_TWO_ISLAND';
 assert.equal(m.inspect(o).objective.target.kind,'purchase-items');assert.equal(m.state.ballFunding.status,'funded');
});

// Two same-species individuals are not interchangeable field-move carriers.
for(const species of [43,44,69]) test(`Sweet Scent preparation withdraws the exact capable individual of species ${species}`,()=>{
 const m=make(),o=observation();m.initialize(o);o.captureId='sweet-scent-pc';o.frame=100;
 const ivs={hp:19,attack:6,defense:14,speed:17,spAttack:5,spDefense:0};
 const wrong={slot:0,species,validity:'valid',isEgg:false,personality:11,otId:42,ivs,level:35,hp:96,maxHp:96,moves:[78,79,51,236],shiny:true};
 const capable={...wrong,personality:22,box:4,slot:13,moves:[71,230,77,78],shiny:false};
 const t=o.playerMemory.trainer;t.party=[wrong];t.storage.pokemon=[capable];
 o.playerMemory.map.id='MAP_CERULEAN_CITY_POKEMON_CENTER_1F';o.emulator.mode='storage';
 o.playerMemory.ui.storage={stage:'pc-menu',option:0,selected:'withdraw'};
 const advise=()=>{const objective=m.inspect(o).objective;return createPolicyAdvisors({mechanics,world:{maps:[]},campaignPlanner:{select:()=>objective}}).flatMap(a=>a.advise(o)??[]).find(p=>p.advisor==='quest')?.recommendation;};
 assert.equal(advise()?.targetOption,'withdraw','a same-species party member without Sweet Scent must not close the PC');
 o.playerMemory.ui.storage={stage:'box',boxOption:'withdraw',currentBox:4,cursorArea:'box',cursorPosition:0};
 assert.equal(advise()?.targetBoxSlot,13,'withdraw the observed move carrier, not any Gloom');
 const resumed=createSuiteMission({id:'nidoran-batch',request,route,world,mechanics,state:m.state});
 assert.deepEqual(resumed.inspect(o).objective.target.requiredFingerprints,[`[${species},22,42,19,6,14,17,5,0]`]);
 t.party.push({...capable,slot:1});t.storage.pokemon=[];
 o.playerMemory.ui.storage={stage:'pc-menu',option:0,selected:'withdraw'};
 assert.equal(advise()?.kind,'exit-storage','leave the PC after the capable individual reaches the party');
 o.playerMemory.ui={};o.emulator.mode='overworld';
 assert.equal(m.inspect(o).objective.target.map,'MAP_ROUTE3');
});
