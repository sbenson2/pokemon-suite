import test from 'node:test';
import assert from 'node:assert/strict';
import {fieldRecoveryObjective} from '../src/suite/field-recovery.js';
import {nextRecoveryTreatment} from '../src/player/recovery.js';
import {battleRecoveryPlan} from '../src/player/battle-model.js';
import {StaticMission} from '../src/suite/static-mission.js';
import {createPolicyAdvisors} from '../src/player/advisors.js';
import {createCentralPlayer} from '../src/player/delegator.js';
import {RoamerMission} from '../src/suite/roamer-mission.js';
import {createPostgameController} from '../src/suite/postgame.js';

const center='MAP_INDIGO_PLATEAU_POKEMON_CENTER_1F';
const stock=['ITEM_ULTRA_BALL','ITEM_GREAT_BALL','ITEM_FULL_RESTORE','ITEM_MAX_POTION','ITEM_REVIVE','ITEM_FULL_HEAL','ITEM_MAX_REPEL'];
const story={scripts:[{label:'Shop',instructions:[{op:'pokemart',args:['Stock']}]},{label:'Stock',instructions:stock.map(name=>({op:'.2byte',args:[name]}))}],symbols:{items:Object.fromEntries(stock.map((name,i)=>[name,{value:[2,3,19,20,24,23,84][i]}]))}};
const world={maps:[{id:center,objectEvents:[{script:'Shop'},{script:'IndigoPlateau_PokemonCenter_1F_EventScript_Nurse'}]}]};
const mechanics={moves:[{id:33,pp:35,power:40,type:'TYPE_NORMAL',effect:'EFFECT_HIT'}],species:[]};
const observation=()=>({phase:'stable',emulator:{inBattle:false,mode:'overworld',inputReady:true},playerMemory:{map:{id:center},ui:{},storyState:{flagIds:{2092:true}},trainer:{partyValidity:'valid',money:103731,party:[{slot:0,validity:'valid',species:22,hp:180,maxHp:180,status1:0,moves:[33],pp:[35],ppBonuses:0}],bag:{items:[{itemId:20,quantity:2},{itemId:24,quantity:20}],pokeBalls:[{itemId:2,quantity:83},{itemId:3,quantity:9},{itemId:4,quantity:11}]}}}});
const select=(o,state={},options={})=>fieldRecoveryObjective(o,world,mechanics,{state,story,...options});
const quantity=(o,id)=>Object.values(o.playerMemory.trainer.bag).flat().find(x=>x.itemId===id)?.quantity??0;
const prepared=()=>{const o=observation();o.playerMemory.trainer.bag.items=[{itemId:20,quantity:20},{itemId:19,quantity:10},{itemId:23,quantity:15},{itemId:24,quantity:20},{itemId:84,quantity:30}];return o;};

test('a rich postgame party buys a useful medicine basket without consuming its cash reserve',()=>{
 const o=observation(),job=select(o);assert.ok(job,'postgame needs a shopping objective');
 assert.equal(job.target.kind,'purchase-items');assert.equal(job.target.map,center);
 assert.equal(job.target.items.find(i=>i.itemId===20)?.quantity,20);
 assert.ok(job.target.items.some(i=>i.itemId===19&&i.quantity>=5));
 assert.ok(job.target.items.some(i=>i.itemId===23&&i.quantity>=5));
 const cost=job.target.items.reduce((n,i)=>n+(i.quantity-quantity(o,i.itemId))*i.unitPrice,0);
 assert.ok(cost>50000&&cost<=93731);assert.ok(job.target.items.every(i=>![1,25,34,35,36,37].includes(i.itemId)));
});
test('the chosen shopping list survives a restart and the purchase result before yielding',()=>{
 const o=observation();let state={};const job=select(o,state);assert.ok(job);
 o.playerMemory.trainer.bag.items[0].quantity=10;o.playerMemory.trainer.money-=20000;
 state=JSON.parse(JSON.stringify(state));assert.deepEqual(select(o,state).target,job.target);
 for(const item of job.target.items){const pocket=item.itemId<=12?'pokeBalls':'items',entries=o.playerMemory.trainer.bag[pocket],current=entries.find(i=>i.itemId===item.itemId);if(current)current.quantity=item.quantity;else entries.push({itemId:item.itemId,quantity:item.quantity});}
 o.playerMemory.ui.mart={stage:'purchase-result'};assert.deepEqual(select(o,state).target,job.target);
 o.playerMemory.ui={};assert.equal(select(o,state),null,'finish the basket before continuing the original journey');
});
test('minor HP and PP use does not turn a stocked journey into a healer loop',()=>{
 const o=prepared();o.playerMemory.trainer.party[0].hp=179;o.playerMemory.trainer.party[0].pp=[34];
 assert.equal(select(o),null);
 assert.equal(nextRecoveryTreatment(o.playerMemory,mechanics,{travel:true}),null);
});
test('substantial travel damage uses an owned Max Potion and retains the menu until it closes',()=>{
 const o=prepared();o.playerMemory.trainer.party[0].hp=93;let state={};
 const job=select(o,state);assert.equal(job?.target.kind,'heal-with-items');assert.equal(job.target.travel,true);
 assert.equal(nextRecoveryTreatment(o.playerMemory,mechanics,{travel:true}).itemId,20);
 o.playerMemory.trainer.party[0].hp=180;o.playerMemory.trainer.bag.items[0].quantity--;
 o.playerMemory.ui.party={stage:'message',itemId:20};state=JSON.parse(JSON.stringify(state));assert.deepEqual(select(o,state),job);
 o.playerMemory.ui={};assert.equal(select(o,state),null);
});
test('stock thresholds avoid a shop trip after using one bottle',()=>{
 const o=prepared();o.playerMemory.trainer.bag.items[0].quantity=19;
 assert.equal(select(o),null);
});
test('a pile of weak Potions cannot substitute for postgame healing reserves',()=>{
 const o=prepared();o.playerMemory.trainer.bag.items=o.playerMemory.trainer.bag.items.filter(i=>![19,20].includes(i.itemId));
 o.playerMemory.trainer.bag.items.push({itemId:13,quantity:99});
 assert.equal(select(o)?.target.items.find(i=>i.itemId===20)?.quantity,20);
});
test('shopping respects League completion, available money, a hunt spending limit and a full item pocket',()=>{
 const o=observation();o.playerMemory.storyState.flagIds[2092]=false;assert.equal(select(o),null);
 o.playerMemory.storyState.flagIds[2092]=true;o.playerMemory.trainer.money=1000;assert.equal(select(o),null);
 o.playerMemory.trainer.money=103731;assert.equal(select(o,{}, {maxSpend:0}),null);
 o.playerMemory.trainer.bag.items=Array.from({length:42},(_,i)=>({itemId:100+i,quantity:1}));
 const job=select(o);assert.ok(!job||job.target.items.every(i=>i.itemId<=12),'full medicine pockets cannot start impossible purchases');
});
test('postgame care cannot replace a battle or save transaction',()=>{
 const o=observation();o.emulator.inBattle=true;assert.equal(select(o),null);
 o.emulator.inBattle=false;o.playerMemory.ui.saveDialog={stage:'saving'};assert.equal(select(o),null);
});
test('owned Max Potions are usable by the existing battle recovery policy',()=>{
 const o=prepared(),p=o.playerMemory.trainer.party[0];p.hp=10;
 const battle={player:{...p},opponent:{species:150,hp:100,maxHp:100,status1:0}};
 assert.equal(battleRecoveryPlan(o.playerMemory,battle,mechanics)?.itemId,20);
});

test('a legendary hunt owns its supply trip across restoration before approaching the encounter',()=>{
 const request={game:'firered',speciesId:150,quantity:1,locationId:'any',shiny:'required',ball:{id:'any',requirement:'preferred'},encounterLevel:{min:1,max:100},limits:{maxSpend:999999,maxMinutes:120,maxEncounters:1000}};
 const w={maps:[...world.maps,{id:'MAP_CERULEAN_CAVE_B1F',objectEvents:[{script:'CeruleanCave_B1F_EventScript_Mewtwo'}]}]};
 const args={id:'legendary-supply-test',request,world:w,story,mechanics};let mission=new StaticMission(args);const o=observation();
 const first=mission.inspect(o);assert.equal(first.objective.target.kind,'purchase-items');
 mission=new StaticMission({...args,state:JSON.parse(JSON.stringify(mission.state))});
 o.playerMemory.trainer.bag.items[0].quantity=10;o.playerMemory.ui.mart={stage:'purchase-result'};
 assert.deepEqual(mission.inspect(o).objective.target,first.objective.target);
 mission.state.protected=true;o.emulator.inBattle=true;assert.equal(mission.inspect(o).kind,'capture','owned captures must retain priority over provisioning');
});

test('a healthy status-only utility member cannot cause endless center visits',()=>{
 const o=prepared();o.playerMemory.trainer.party[0].moves=[45];o.playerMemory.trainer.party[0].pp=[40];
 const data={moves:[...mechanics.moves,{id:45,pp:40,power:0,effect:'EFFECT_ATTACK_DOWN'}]};
 const w={maps:[...world.maps,{id:'MAP_CELADON_CITY_POKEMON_CENTER_1F',objectEvents:[{script:'CeladonCity_PokemonCenter_1F_EventScript_Nurse'}]}]};
 assert.equal(fieldRecoveryObjective(o,w,data,{state:{},story}),null);
});
test('travel medicine stays assigned to the member needing treatment inside the party picker',()=>{
 const o=prepared(),p=o.playerMemory.trainer.party[0];p.hp=400;p.maxHp=500;
 o.playerMemory.trainer.party.push({...p,slot:1,species:116,hp:20,maxHp:60});
 o.playerMemory.ui.party={stage:'select',itemId:20,selectedPartySlot:0};
 Object.assign(o,{captureId:'travel-treatment',frame:1,phaseReasons:[]});
 o.sram={};for(const field of ['emulator','playerMemory','sram'])Object.assign(o[field],{captureId:o.captureId,frame:o.frame});
 const objective={id:'travel-care',target:{kind:'heal-with-items',travel:true},taskKind:'recovery'};
 const planner={select:()=>objective,selectCollection:()=>null,selectTraining:()=>null,selectBattleSquad:()=>[],campaignStatus:()=>({objective:objective.id}),state:()=>({})};
 const player=createCentralPlayer({campaignPlanner:planner,mechanics,advisors:createPolicyAdvisors({campaignPlanner:planner,mechanics})});
 assert.equal(player.decide(o).winner?.recommendation.targetPartySlot,1);
});

test('pre-release roamer supplies retain their reserved 30-ball trip through completion',()=>{
 const w={maps:[...world.maps,{id:'MAP_ONE_ISLAND_POKEMON_CENTER_1F',objectEvents:[{script:'OneIsland_PokemonCenter_1F_EventScript_Celio'}]}]};
 const request={game:'firered',speciesId:245,quantity:1,locationId:'any',shiny:'required',ball:{id:'any',requirement:'preferred'},encounterLevel:{min:1,max:100},limits:{maxSpend:999999,maxMinutes:120,maxEncounters:1000}};
 const args={id:'roamer-supply-test',request,world:w,story,mechanics};let mission=new RoamerMission(args);mission.state.phase='traveling';
 const o=observation();o.playerMemory.trainer.bag.pokeBalls=[{itemId:2,quantity:2}];
 const first=mission.inspect(o);assert.equal(first.objective.id,'roamer-stock-balls');assert.equal(first.objective.target.items[0].quantity,30);
 mission=new RoamerMission({...args,state:JSON.parse(JSON.stringify(mission.state))});
 o.playerMemory.trainer.bag.pokeBalls[0].quantity=30;o.playerMemory.ui.mart={stage:'purchase-result'};
 assert.deepEqual(mission.inspect(o),first);o.playerMemory.ui={};assert.equal(mission.inspect(o).objective.id,'release-suicune');
});

test('postgame shopping retains its basket while using the native ferry from an island',()=>{
 const o=observation(),care={};const job=select(o,care);
 Object.assign(o,{captureId:'supply-ferry',frame:1,phaseReasons:[],sram:{sha256:'before'}});
 for(const field of ['emulator','playerMemory','sram'])Object.assign(o[field],{captureId:o.captureId,frame:o.frame});
 const m=o.playerMemory;m.map.id='MAP_FOUR_ISLAND_HARBOR';m.position={x:5,y:4};m.ui={choiceMenu:{kind:'multichoice',cursor:3,maxCursor:4}};
 m.storyState.variableIds={0x4076:5,0x4071:4,0x8005:0};m.trainer.storage={validity:'valid',pokemon:[]};m.trainer.pokedex={ownedSpecies:[]};
 const args={world:{data:{...world,wildEncounters:[]}},story,mechanics};
 let controller=createPostgameController({...args,state:{schema:'pokemon-suite/postgame/v1',objective:job,fieldCare:care}});
 for(let i=0;i<2;i++){
  const d=controller.decide(o);assert.equal(d.winner?.recommendation.objective,'sevii-sail-0');
  assert.equal(d.winner.recommendation.targetIndex,0);
  assert.deepEqual(controller.state().fieldCare.active.objective.target,job.target);
  controller=createPostgameController({...args,state:JSON.parse(JSON.stringify(controller.state()))});
 }
});
