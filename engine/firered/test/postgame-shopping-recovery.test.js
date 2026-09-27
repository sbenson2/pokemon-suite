import test from 'node:test';
import assert from 'node:assert/strict';
import {createCampaignPlanner} from '../src/player/campaign.js';
import * as shopping from '../src/suite/postgame-shopping.js';
const map=(id,script='Shop')=>({id,objectEvents:[{x:1,y:1,script}],warpEvents:[],connections:[],layout:{width:4,height:4,cells:Array.from({length:16},(_,i)=>({x:i%4,y:Math.floor(i/4),collision:0,elevation:3,behaviorName:'MB_NORMAL'}))}});
function setup(){
 const maps=['MAP_ORIGIN','MAP_A','MAP_B','MAP_ISOLATED','MAP_PARTIAL'].map(id=>map(id,id==='MAP_PARTIAL'?'Partial':'Shop'));
 maps[0].connections=[{direction:'east',map:'MAP_A',offset:0},{direction:'west',map:'MAP_B',offset:0},{direction:'north',map:'MAP_PARTIAL',offset:0}];
 const world={maps},story={scripts:[{label:'Shop',instructions:[{op:'pokemart',args:['Stock']}]},{label:'Partial',instructions:[{op:'pokemart',args:['One']}]},{label:'Stock',instructions:['BALL','HEAL'].map(x=>({op:'.2byte',args:[x]}))},{label:'One',instructions:[{op:'.2byte',args:['BALL']}]}],symbols:{items:{BALL:{value:2},HEAL:{value:23}}}};
 const planner=createCampaignPlanner({world,story,campaign:{objectives:[]}});
 const o={phase:'stable',emulator:{mode:'overworld',inBattle:false},playerMemory:{map:{id:'MAP_ORIGIN'},position:{x:1,y:2},avatar:{facing:'north'},ui:{},storyState:{flagIds:{}},trainer:{bag:{pokeBalls:[{itemId:2,quantity:1}],items:[]},party:[],money:50000}}};
 const state={active:{kind:'shop',cost:3000,objective:{id:'stock-postgame-supplies',target:{kind:'purchase-items',map:'MAP_ORIGIN',objectIndex:0,items:[{itemId:2,quantity:3,stockIndex:0,unitPrice:1200},{itemId:23,quantity:1,stockIndex:1,unitPrice:600}]}}}};
 return {world,story,planner,o,state};
}
test('failed shopping routes retain the basket and select only reachable fully stocked alternatives',()=>{
 const x=setup(),basket=structuredClone(x.state.active.objective.target.items);
 assert.equal(typeof shopping.rejectShoppingRoute,'function');
 const result=shopping.rejectShoppingRoute(x.o,{...x,now:1000,reason:'route failed'});
 assert.equal(result.kind,'alternate');assert.equal(result.objective.target.map,'MAP_B','shorter local approach wins');
 assert.deepEqual(result.objective.target.items,basket);assert.equal(x.state.active.cost,3000);
 assert.equal(x.state.routeFailures.MAP_ORIGIN.attempts,1);
 x.state=JSON.parse(JSON.stringify(x.state));
 const next=shopping.rejectShoppingRoute(x.o,{...x,now:2000,reason:'route failed'});
 assert.equal(next.objective.target.map,'MAP_A','failed destination stays excluded after reconstruction');
 const last=shopping.rejectShoppingRoute(x.o,{...x,now:3000,reason:'route failed'});
 assert.equal(last.kind,'deferred');assert.deepEqual(x.state.deferredShopping.task.objective.target.items,basket);
 assert.equal(x.state.active,null);
});
test('shopping recovery refuses unfinished native interactions without recording a failure',()=>{
 for(const ui of [{mart:{stage:'purchase-result'}},{saveDialog:{stage:'writing'}},{party:{stage:'message'}}]){
  const x=setup();x.o.playerMemory.ui=ui;
  assert.equal(typeof shopping.rejectShoppingRoute,'function');
  assert.equal(shopping.rejectShoppingRoute(x.o,{...x,now:1000,reason:'route failed'}),null);
  assert.equal(x.state.routeFailures,undefined);assert.ok(x.state.active);
 }
});

test('exhausted shopping survives restarts and requires relevant change after cooldown',()=>{
 const x=setup();shopping.rejectShoppingRoute(x.o,{...x,now:1000,reason:'budget exhausted',exhausted:true});
 x.state=JSON.parse(JSON.stringify(x.state));
 x.o.playerMemory.trainer.party=[];x.o.playerMemory.gameStats={savedGame:100};
 assert.equal(shopping.resumeShoppingRoute(x.o,{...x,now:500000}),false,'saving or restarting cannot renew budget');
 assert.equal(x.state.routeFailures.MAP_ORIGIN.attempts,1);
 x.o.playerMemory.trainer.pokedex={ownedSpecies:[1]};
 assert.equal(shopping.resumeShoppingRoute(x.o,{...x,now:500000}),true,'new collection progress allows later retry');
 assert.equal(x.state.active.objective.target.items[0].quantity,3);
});

test('deferred basket accounting excludes purchases made by other tasks before resumption',()=>{
 const x=setup();Object.assign(x.state.active,{lastObservedMoney:50000,observedSpent:1200});
 shopping.rejectShoppingRoute(x.o,{...x,now:1000,reason:'budget exhausted',exhausted:true});
 x.o.playerMemory.trainer.money=40000;x.o.playerMemory.trainer.pokedex={ownedSpecies:[1]};
 assert.equal(shopping.resumeShoppingRoute(x.o,{...x,now:500000}),true);
 assert.equal(x.state.active.observedSpent,1200);
 assert.equal(x.state.active.lastObservedMoney,40000,'resume the same spend ledger from the new native balance');
});

async function resumedController(active=null){
 const {createPostgameController}=await import('../src/suite/postgame.js');
 const x=setup();shopping.rejectShoppingRoute(x.o,{...x,now:1000,reason:'route unavailable',exhausted:true});
 x.state.deferredShopping.exhausted=false;x.state.deferredShopping.budget={owner:'postgame-maintenance',idleMs:200000,lastAt:1000,seen:[],retries:1};
 const o=x.o;Object.assign(o,{captureId:'resume',frame:100,phaseReasons:[],sram:{sha256:'saved'}});o.emulator.inputReady=true;
 Object.assign(o.playerMemory,{storyState:{flagIds:{2092:true,2112:true,2116:true},variableIds:{}},gameStats:{savedGame:7}});
 Object.assign(o.playerMemory.trainer,{partyValidity:'valid',usablePartyCount:0,pokedex:{ownedSpecies:[]},storage:{validity:'valid',pokemon:[],boxCounts:Array(14).fill(0)}});
 for(const p of [o.emulator,o.playerMemory,o.sram])Object.assign(p,{captureId:'resume',frame:100});
 const c=createPostgameController({world:{data:x.world},story:{data:x.story},mechanics:{data:{species:[],moves:[]}},clock:()=>500000,
  state:{schema:'pokemon-suite/postgame/v1',preparation:{phase:'complete'},agenda:{enabled:true,active,failures:{}},fieldCare:x.state}});
 return {c,o};
}
test('resuming a deferred supply trip preserves its consumed parent budget',async()=>{
 const {c,o}=await resumedController();c.decide(o);
 assert.equal(c.state().watchdog.idleMs,200000);
 assert.equal(c.state().watchdog.retries,1);
});
test('a deferred basket cannot preempt an egg record recovery reserve',async()=>{
 const {c,o}=await resumedController('egg-sticker');c.decide(o);
 assert.ok(c.state().fieldCare.deferredShopping);
 assert.equal(c.state().fieldCare.active,null);
});

test('an automatic hunt return restores the deferred basket, failures and spending from its shared agenda',async()=>{
 const {createPostgameController}=await import('../src/suite/postgame.js');
 const {c,o}=await resumedController('egg-sticker');c.decide(o);
 const before=c.state();before.fieldCare.spent=1200;
 const inputs={world:{data:{maps:[],wildEncounters:[]}},story:{data:{scripts:[]}},mechanics:{data:{species:[]}}};
 const original=createPostgameController({...inputs,state:before}).state();
 const returned=createPostgameController({...inputs,state:{schema:'pokemon-suite/postgame/v1',agenda:JSON.parse(JSON.stringify(original.agenda))}}).state();
 assert.deepEqual(returned.fieldCare,original.fieldCare);
 assert.equal(returned.fieldCare.spent,1200);
 assert.equal(returned.fieldCare.routeFailures.MAP_ORIGIN.attempts,1);
});
