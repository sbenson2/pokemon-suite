import test from 'node:test';
import assert from 'node:assert/strict';
import {postgameCareObjective} from '../src/suite/postgame-care.js';
import {createPostgameController} from '../src/suite/postgame.js';

// The completed-campaign save (G2 control, see NOTES): after the Hall of Fame
// the automatic postgame plans its supply basket at the League clerk from
// money − 10,000 (30,548 → 17 Ultra Balls = 20,400 of 20,548), then catches
// National Dex species on the way with those Ultra Balls. The retained
// basket's absolute target (7 + 17 = 24) now costs more than the reserve
// allows, and care stopped for review although nothing was ever bought.
const center='MAP_INDIGO_PLATEAU_POKEMON_CENTER_1F',store='MAP_CELADON_CITY_DEPARTMENT_STORE_2F';
const itemIds=[2,3,19,20,24,23,84];
const names=['ITEM_ULTRA_BALL','ITEM_GREAT_BALL','ITEM_FULL_RESTORE','ITEM_MAX_POTION','ITEM_REVIVE','ITEM_FULL_HEAL','ITEM_MAX_REPEL'];
const story={scripts:[
 {label:'Shop',instructions:[{op:'pokemart',args:['Stock']}]},{label:'Stock',instructions:names.map(name=>({op:'.2byte',args:[name]}))},
 // A second verified mart with another stock order (an alternate destination).
 {label:'Store',instructions:[{op:'pokemart',args:['StoreStock']}]},{label:'StoreStock',instructions:[...names].reverse().map(name=>({op:'.2byte',args:[name]}))},
],symbols:{items:Object.fromEntries(names.map((name,index)=>[name,{value:itemIds[index]}]))}};
const world={maps:[
 {id:center,objectEvents:[{script:'Shop'},{script:'IndigoPlateau_PokemonCenter_1F_EventScript_Nurse'}]},
 {id:store,objectEvents:[{script:'Other'},{script:'Store'}]},
]};
const mechanics={moves:[{id:33,pp:35,power:40,type:'TYPE_NORMAL',effect:'EFFECT_HIT'}],species:[]};
const member=slot=>({slot,validity:'valid',species:22,hp:180,maxHp:180,status1:0,moves:[33],pp:[35],ppBonuses:0});
// The checkpoint's bag: medicine above every threshold, 7 Ultra Balls.
function observe({money=30548,map='MAP_PALLET_TOWN'}={}){
 return {phase:'stable',emulator:{mode:'overworld',inBattle:false,inputReady:true},playerMemory:{map:{id:map},ui:{},
  storyState:{flagIds:{2092:true}},trainer:{partyValidity:'valid',money,party:[0,1,2,3,4,5].map(member),
  bag:{items:[{itemId:94,quantity:2},{itemId:24,quantity:37},{itemId:20,quantity:11},{itemId:23,quantity:47}],
   pokeBalls:[{itemId:4,quantity:11},{itemId:3,quantity:10},{itemId:2,quantity:7}]}}}};
}
const count=(o,id)=>Object.values(o.playerMemory.trainer.bag).flat().filter(i=>i.itemId===id).reduce((n,i)=>n+i.quantity,0);
function setQuantity(o,id,quantity){
 const pocket=id<=12?'pokeBalls':'items',entries=o.playerMemory.trainer.bag[pocket];
 const entry=entries.find(item=>item.itemId===id);
 if(entry)entry.quantity=quantity;else entries.push({itemId:id,quantity});
}
const select=(o,state,maxSpend)=>postgameCareObjective(o,{world,story,mechanics,state,...(maxSpend===undefined?{}:{maxSpend})});
const remaining=(objective,o)=>objective.target.items.reduce((n,i)=>n+Math.max(0,i.quantity-count(o,i.itemId))*i.unitPrice,0);
const ultra=objective=>objective.target.items.find(i=>i.itemId===2);
// Throwing balls on the way happens in battle; care decides again in the free overworld.
function throwBalls(o,state,n,maxSpend){
 o.emulator.inBattle=true;assert.equal(select(o,state,maxSpend),null,'care never acts during the capture battle');
 setQuantity(o,2,count(o,2)-n);o.emulator.inBattle=false;
}

test('a basket planned to the cash reserve is re-derived from the current stock when its balls are thrown on the way',()=>{
 const o=observe();let state={};
 const planned=select(o,state);
 assert.deepEqual(planned.target.items,[{itemId:2,quantity:24,stockIndex:0,unitPrice:1200}]);
 assert.equal(state.active.cost,20400);
 o.playerMemory.map.id='MAP_ROUTE22';throwBalls(o,state,1);
 const decision=select(o,state);
 assert.equal(decision.target.kind,'purchase-items','no stop for review: nothing was bought yet');
 assert.equal(decision.target.map,center);
 assert.deepEqual(decision.target.items,[{itemId:2,quantity:23,stockIndex:0,unitPrice:1200}],'the same 17 balls from the current 6');
 assert.ok(remaining(decision,o)<=o.playerMemory.trainer.money-10000,'the cash reserve is kept');
 assert.equal(state.active.cost,20400);assert.equal(state.active.observedSpent,0);
 assert.equal(state.active.lastObservedMoney,30548);assert.equal(state.active.spendingLimit,null);
 assert.deepEqual(state.active.objective,decision);
 // More catches, then a restart: the re-derived plan is durable state.
 throwBalls(o,state,4);state=JSON.parse(JSON.stringify(state));
 const again=select(o,state);
 assert.equal(ultra(again).quantity,19);assert.equal(state.active.cost,20400);
 // Prize money on the way does not require another plan: the basket fits.
 const richer=structuredClone(o);richer.playerMemory.trainer.money+=1200;
 assert.deepEqual(select(richer,structuredClone(state)),again);
 // Buying it at the clerk completes it once, within the reserve.
 setQuantity(o,2,19);o.playerMemory.trainer.money-=20400;o.playerMemory.ui.mart={stage:'purchase-result'};
 assert.deepEqual(select(o,state),again,'the open mart owns the transaction');
 o.playerMemory.ui={};
 assert.equal(select(o,state),null);
 assert.equal(state.spent,20400);assert.equal(state.active,null);
 assert.ok(o.playerMemory.trainer.money>=10000);
});

test('the re-derived basket stays within the spending limit, including the cap retained across a restart',()=>{
 const o=observe({money:200000});setQuantity(o,20,0);setQuantity(o,23,0);setQuantity(o,24,0);
 let state={spent:1000};
 const planned=select(o,state,30000);
 assert.ok(state.active.cost<=29000&&state.active.cost>29000-1200,'the first plan fills the remaining cap');
 assert.equal(state.active.spendingLimit,30000);
 throwBalls(o,state,3,30000);
 state=JSON.parse(JSON.stringify(state));
 // The caller omits the cap after a restart; the basket keeps its own.
 const decision=postgameCareObjective(o,{world,story,mechanics,state});
 assert.equal(decision.target.kind,'purchase-items');
 assert.notDeepEqual(decision.target.items,planned.target.items);
 assert.ok(remaining(decision,o)<=30000-1000,'never above the spending limit');
 assert.ok(remaining(decision,o)<=o.playerMemory.trainer.money-10000,'never below the cash reserve');
 assert.equal(state.active.spendingLimit,30000);assert.equal(state.active.cost,remaining(decision,o));
});

test('a stale basket still stops for review when no purchase fits the remaining limits',()=>{
 // (a) The reserve: a resumed basket whose balance other tasks spent meanwhile
 // (resumeShoppingRoute restarts its ledger from the new balance). 500 buys
 // none of the planner's supplies (the cheapest needed item costs 600).
 {
  const o=observe({money:10500});let state={};
  state.active={kind:'shop',cost:20400,spendingLimit:null,startingMoney:30548,lastObservedMoney:10500,observedSpent:0,
   objective:{id:'stock-postgame-supplies',target:{kind:'purchase-items',map:center,objectIndex:0,items:[{itemId:2,quantity:24,stockIndex:0,unitPrice:1200}]},
    taskKind:'recovery',dialogue:'advance',choice:'yes',deferOptionalDetours:true}};
  const held=structuredClone(state.active);
  const decision=select(o,state);
  assert.equal(decision.target.kind,'stop-for-review');
  assert.match(decision.target.reason,/spending limit or cash reserve/);
  assert.deepEqual(state.active,held,'the retained basket is kept unchanged for review');
 }
 // (b) A legacy basket has no spending ledger, and (c) a ledger without its
 // observed balance cannot see purchases: nothing proves they bought nothing.
 for(const fields of [['startingMoney','lastObservedMoney','observedSpent'],['lastObservedMoney']]){
  const o=observe();let state={};select(o,state);
  for(const field of fields)delete state.active[field];
  throwBalls(o,state,1);
  const held=structuredClone(state.active);
  const decision=select(o,state);
  assert.equal(decision.target.kind,'stop-for-review');assert.deepEqual(state.active,held);
 }
});

test('after money was spent on a basket its shortfall still stops instead of re-planning',()=>{
 const o=observe({money:40000});setQuantity(o,2,0);
 let state={};select(o,state);
 const first=ultra(state.active.objective).quantity;assert.ok(first>1);
 // One purchase at the clerk, then balls are thrown before the rest is bought.
 setQuantity(o,2,1);o.playerMemory.trainer.money-=1200;o.playerMemory.ui.mart={stage:'purchase-result'};select(o,state);
 o.playerMemory.ui={};
 assert.equal(state.active.observedSpent,1200);
 setQuantity(o,2,0);
 const held=structuredClone(state.active);
 const decision=select(o,state);
 assert.equal(decision.target.kind,'stop-for-review');assert.deepEqual(state.active,held);
});

test('a basket suspended for care is re-derived when it resumes after balls and medicine were used',()=>{
 const o=observe();let state={};select(o,state);
 o.playerMemory.trainer.party[0].hp=60;
 assert.equal(select(o,state).target.kind,'heal-with-items');
 assert.ok(state.suspendedShopping);
 o.playerMemory.trainer.party[0].hp=180;setQuantity(o,20,10);throwBalls(o,state,2);
 state=JSON.parse(JSON.stringify(state));
 o.emulator.inBattle=false;
 const resumed=select(o,state);
 assert.equal(resumed.target.kind,'purchase-items');
 assert.equal(state.suspendedShopping,null);assert.equal(state.active.kind,'shop');
 assert.ok(remaining(resumed,o)<=o.playerMemory.trainer.money-10000);
 assert.equal(ultra(resumed).quantity,5+17);
 assert.equal(state.active.careCounts,undefined);assert.equal(state.active.extraCost,undefined);
});

test('a re-derived basket keeps the destination and stock slots its route recovery chose',()=>{
 const o=observe();let state={};select(o,state);
 const target=state.active.objective.target;
 // rejectShoppingRoute moved the retained basket to another verified mart.
 Object.assign(target,{map:store,objectIndex:1,items:target.items.map(i=>({...i,stockIndex:names.length-1-itemIds.indexOf(i.itemId)}))});
 throwBalls(o,state,1);
 const decision=select(o,state);
 assert.equal(decision.target.kind,'purchase-items');
 assert.equal(decision.target.map,store);assert.equal(decision.target.objectIndex,1);
 assert.deepEqual(decision.target.items,[{itemId:2,quantity:23,stockIndex:names.length-1,unitPrice:1200}]);
});

test('the postgame controller continues the supply trip with the re-derived basket instead of stopping',()=>{
 const o=observe({map:center});o.playerMemory.position={x:1,y:1};
 const care={};select(o,care);setQuantity(o,2,6);
 Object.assign(o,{captureId:'supply-replan',frame:100,phaseReasons:[],sram:{sha256:'saved'}});
 Object.assign(o.playerMemory,{avatar:{facing:'north'},gameStats:{savedGame:5},storyState:{flagIds:{2092:true,2112:true,2116:true},variableIds:{}}});
 Object.assign(o.playerMemory.trainer,{partyCount:6,usablePartyCount:6,pokedex:{ownedSpecies:[]},storage:{validity:'valid',pokemon:[],boxCounts:Array(14).fill(0)}});
 for(const part of [o.emulator,o.playerMemory,o.sram])Object.assign(part,{captureId:o.captureId,frame:o.frame});
 const walkable={id:center,warpEvents:[],connections:[],objectEvents:[{x:1,y:3,script:'Shop'},{x:3,y:3,script:'IndigoPlateau_PokemonCenter_1F_EventScript_Nurse'}],
  layout:{width:5,height:5,cells:Array.from({length:25},(_,i)=>({x:i%5,y:Math.floor(i/5),collision:0,elevation:3,behaviorName:'MB_NORMAL'}))}};
 const controller=createPostgameController({world:{data:{maps:[walkable,world.maps[1]],wildEncounters:[]}},story:{data:story},mechanics:{data:mechanics},clock:()=>1000,
  state:{schema:'pokemon-suite/postgame/v1',preparation:{phase:'complete'},agenda:{enabled:true,failures:{}},objective:care.active.objective,fieldCare:care,
   watchdog:{owner:'postgame-maintenance',idleMs:0,lastAt:1000,retries:0,seen:[]}}});
 const decision=controller.decide(o),after=controller.state();
 assert.equal(decision.kind,'act',JSON.stringify({reason:decision.reason,status:after.status,why:after.reason}));
 assert.equal(decision.winner?.recommendation?.targetMap,center,'it walks on to the clerk');
 assert.equal(after.status,'running');
 assert.equal(after.fieldCare.active.kind,'shop');
 assert.deepEqual(after.fieldCare.active.objective.target.items,[{itemId:2,quantity:23,stockIndex:0,unitPrice:1200}]);
 assert.equal((after.pendingObjective??after.objective)?.id,'stock-postgame-supplies');
 assert.deepEqual((after.pendingObjective??after.objective).target.items,after.fieldCare.active.objective.target.items);
});
