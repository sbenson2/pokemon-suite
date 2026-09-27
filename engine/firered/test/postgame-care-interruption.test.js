import test from 'node:test';
import assert from 'node:assert/strict';
import {postgameCareObjective} from '../src/suite/postgame-care.js';
import {campaignNavigationRecommendation,createCampaignPlanner,selectRecoveryObjective} from '../src/player/campaign.js';
import {createPostgameController} from '../src/suite/postgame.js';

const center='MAP_INDIGO_PLATEAU_POKEMON_CENTER_1F';
const itemIds=[2,3,19,20,24,23,84];
const names=['ITEM_ULTRA_BALL','ITEM_GREAT_BALL','ITEM_FULL_RESTORE','ITEM_MAX_POTION','ITEM_REVIVE','ITEM_FULL_HEAL','ITEM_MAX_REPEL'];
const story={scripts:[{label:'Shop',instructions:[{op:'pokemart',args:['Stock']}]},{label:'Stock',instructions:names.map(name=>({op:'.2byte',args:[name]}))}],symbols:{items:Object.fromEntries(names.map((name,index)=>[name,{value:itemIds[index]}]))}};
const world={maps:[{id:center,objectEvents:[{script:'Shop'},{script:'IndigoPlateau_PokemonCenter_1F_EventScript_Nurse'}]}]};
const mechanics={moves:[{id:33,pp:35,power:40,type:'TYPE_NORMAL',effect:'EFFECT_HIT'}],species:[]};
const observe=()=>({phase:'stable',emulator:{mode:'overworld',inBattle:false},playerMemory:{map:{id:center},ui:{},storyState:{flagIds:{2092:true}},trainer:{partyValidity:'valid',money:200000,party:[{slot:0,validity:'valid',species:22,hp:180,maxHp:180,status1:0,moves:[33],pp:[35],ppBonuses:0}],bag:{items:[{itemId:20,quantity:2},{itemId:24,quantity:20}],pokeBalls:[{itemId:2,quantity:83},{itemId:3,quantity:9},{itemId:4,quantity:11}]}}}});
const select=(o,state,maxSpend=150000)=>postgameCareObjective(o,{world,story,mechanics,state,maxSpend});
const route23='MAP_ROUTE23',viridian='MAP_VIRIDIAN_CITY_POKEMON_CENTER_1F',celadon='MAP_CELADON_CITY_POKEMON_CENTER_1F';
function walkableMap(id,{warps=[],objects=[]}={}){
 return {id,warpEvents:warps,objectEvents:objects,layout:{width:5,height:5,cells:Array.from({length:25},(_,i)=>({x:i%5,y:Math.floor(i/5),collision:0,elevation:3,behaviorName:warps.some(w=>w.x===i%5&&w.y===Math.floor(i/5))?'MB_REGULAR_WARP':'MB_NORMAL'}))}};
}
const healerWorld={maps:[
 walkableMap(route23,{warps:[{x:1,y:1,dest_map:viridian,dest_warp_id:'0'}]}),
 walkableMap(viridian,{warps:[{x:1,y:1,dest_map:route23,dest_warp_id:'0'}],objects:[{x:2,y:2,script:'ViridianCity_PokemonCenter_1F_EventScript_Nurse'}]}),
 walkableMap(celadon,{objects:[{x:2,y:2,script:'CeladonCity_PokemonCenter_1F_EventScript_Nurse'}]}),
]};
const navigableCenterWorld={maps:[walkableMap(center,{objects:[
 {x:2,y:2,script:'Shop'},
 {x:2,y:3,script:'IndigoPlateau_PokemonCenter_1F_EventScript_Nurse'},
]})]};
const coLocatedCareWorld={maps:[
 walkableMap(route23,{warps:[
  {x:1,y:1,dest_map:viridian,dest_warp_id:'0'},
  {x:4,y:4,dest_map:center,dest_warp_id:'0'},
 ]}),
 walkableMap(viridian,{warps:[{x:0,y:0,dest_map:route23,dest_warp_id:'0'}],objects:[
  {x:2,y:2,script:'ViridianCity_PokemonCenter_1F_EventScript_Nurse'},
 ]}),
 walkableMap(center,{warps:[{x:0,y:0,dest_map:route23,dest_warp_id:'1'}],objects:[
  {x:2,y:2,script:'Shop'},
  {x:2,y:3,script:'IndigoPlateau_PokemonCenter_1F_EventScript_Nurse'},
 ]}),
]};
const selectAtCenter=(o,state)=>postgameCareObjective(o,{world:navigableCenterWorld,story,mechanics,state,maxSpend:150000});
function setQuantity(o,id,quantity){
 const pocket=id<=12?'pokeBalls':'items',entries=o.playerMemory.trainer.bag[pocket];
 const entry=entries.find(item=>item.itemId===id);
 if(entry)entry.quantity=quantity;else entries.push({itemId:id,quantity});
}

test('field treatment suspends a partial basket and resumes its exact absolute targets after a restart',()=>{
 const o=observe();let state={};const basket=select(o,state);
 assert.equal(basket.target.kind,'purchase-items');
 setQuantity(o,20,10);o.playerMemory.trainer.money-=20000;o.playerMemory.trainer.party[0].hp=93;
 const treatment=select(o,state);
 assert.equal(treatment.target.kind,'heal-with-items');
 assert.deepEqual(state.suspendedShopping.objective,basket);
 assert.equal(state.spent??0,0);
 o.playerMemory.ui.party={stage:'message',itemId:20};
 state=JSON.parse(JSON.stringify(state));
 assert.deepEqual(select(o,state),treatment,'the open item menu owns the native transaction');
 o.playerMemory.trainer.party[0].hp=180;setQuantity(o,20,9);
 o.playerMemory.ui={};
 assert.deepEqual(select(o,state),basket,'using purchased medicine keeps the original absolute basket');
 assert.equal(state.spent??0,0);
 o.playerMemory.trainer.money=190000;
 assert.deepEqual(select(o,state),basket,'an observed cash gain does not erase earlier purchases');
 for(const item of basket.target.items)setQuantity(o,item.itemId,item.quantity);
 o.playerMemory.trainer.money=77700;
 o.playerMemory.ui.mart={stage:'purchase-result'};
 assert.deepEqual(select(o,state),basket);
 o.playerMemory.ui={};
 assert.equal(select(o,state),null);
 assert.equal(state.spent,132300,'charge observed spending once, including replacement medicine');
 assert.equal(state.suspendedShopping,null);
 state=JSON.parse(JSON.stringify(state));
 assert.equal(select(o,state),null);
 assert.equal(state.spent,132300);
});

test('a basket keeps ownership during a mart, battle, and save transaction',()=>{
 const o=observe(),state={},basket=select(o,state);
 o.playerMemory.trainer.party[0].hp=93;
 o.playerMemory.ui.mart={stage:'choose-item'};
 assert.deepEqual(select(o,state),basket);
 assert.equal(state.suspendedShopping,undefined);
 o.playerMemory.ui={};o.emulator.inBattle=true;
 assert.equal(select(o,state),null);
 assert.equal(state.active.kind,'shop');
 o.emulator.inBattle=false;o.playerMemory.ui.saveDialog={stage:'saving'};
 assert.equal(select(o,state),null);
 assert.equal(state.active.kind,'shop');
 o.playerMemory.ui={};
 assert.equal(select(o,state).target.kind,'heal-with-items');
});

test('field care waits for ready overworld input before interrupting shopping',()=>{
 const o=observe(),state={},basket=select(o,state);
 o.playerMemory.trainer.party[0].hp=93;o.emulator.inputReady=false;
 assert.deepEqual(select(o,state),basket);
 assert.equal(state.suspendedShopping,undefined);
 o.emulator.inputReady=true;
 assert.equal(select(o,state).target.kind,'heal-with-items');
});

test('a legacy basket can finish within its original budget plus the medicine used for care',()=>{
 const o=observe(),state={},basket=select(o,state);
 for(const field of ['startingMoney','lastObservedMoney','observedSpent'])delete state.active[field];
 setQuantity(o,20,10);o.playerMemory.trainer.money=180000;o.playerMemory.trainer.party[0].hp=93;
 assert.equal(select(o,state,132300)?.target.kind,'heal-with-items');
 o.playerMemory.trainer.party[0].hp=180;setQuantity(o,20,9);
 assert.deepEqual(select(o,state,132300),basket);
 assert.equal(state.spent??0,0);
});

test('care keeps an over-budget basket suspended instead of authorizing another purchase',()=>{
 const o=observe(),state={};const basket=select(o,state);
 setQuantity(o,20,10);o.playerMemory.trainer.money=180000;o.playerMemory.trainer.party[0].hp=93;
 assert.equal(select(o,state,129800)?.target.kind,'heal-with-items');
 o.playerMemory.trainer.party[0].hp=180;setQuantity(o,20,9);
 const blocked=select(o,state,129800);
 assert.equal(blocked.target.kind,'stop-for-review');
 assert.deepEqual(state.suspendedShopping.objective,basket);
 assert.equal(state.active,null);
});

test('a reconstructed basket retains its original spending cap when the caller omits it',()=>{
 const o=observe();let state={};select(o,state,129800);
 setQuantity(o,20,10);o.playerMemory.trainer.money=180000;o.playerMemory.trainer.party[0].hp=93;
 select(o,state,129800);
 o.playerMemory.trainer.party[0].hp=180;setQuantity(o,20,9);
 state=JSON.parse(JSON.stringify(state));
 const result=postgameCareObjective(o,{world,story,mechanics,state});
 assert.equal(result.target.kind,'stop-for-review');assert.ok(state.suspendedShopping);
});
test('script-locked overworld cannot interrupt a retained purchase',()=>{
 const o=observe(),state={},basket=select(o,state);
 o.playerMemory.trainer.party[0].hp=93;o.playerMemory.scripts={fieldControlsLocked:true};
 assert.deepEqual(select(o,state),basket);assert.equal(state.suspendedShopping,undefined);
});

test('a running switch script keeps the retained healer until its field effects finish',()=>{
 const o=observe(),state={},basket=select(o,state);
 o.playerMemory.trainer.party[0].pp=[0];
 state.suspendedShopping=state.active;
 state.active={kind:'center',objective:{id:'restore-postgame-party',taskKind:'recovery',
  target:{kind:'object',map:celadon,index:0},dialogue:'advance',choice:'yes',deferOptionalDetours:true}};
 o.playerMemory.map.id=route23;o.playerMemory.position={x:1,y:2};
 o.playerMemory.scripts={globalStatus:'running',globalMode:'bytecode',fieldControlsLocked:false};
 const pending=postgameCareObjective(o,{world:healerWorld,story,mechanics,state,maxSpend:150000});
 assert.equal(pending.target.map,celadon);
 assert.deepEqual(state.suspendedShopping.objective,basket);
 assert.equal(state.spent??0,0);
 o.playerMemory.scripts={globalStatus:'shutdown',globalMode:'stopped',fieldControlsLocked:false};
 const settled=postgameCareObjective(o,{world:healerWorld,story,mechanics,state,maxSpend:150000});
 assert.equal(settled.target.map,viridian);
 assert.deepEqual(state.suspendedShopping.objective,basket);
 assert.equal(state.spent??0,0);
});

test('a capable party defers isolated paralysis until its retained center shopping trip arrives',()=>{
 const o=observe(),state={};o.playerMemory.position={x:1,y:2};
 const basket=selectAtCenter(o,state);
 o.playerMemory.trainer.party[0].status1=64;
 for(let slot=1;slot<6;slot++)o.playerMemory.trainer.party.push({slot,validity:'valid',species:22,hp:180,maxHp:180,status1:0,moves:[33],pp:[35],ppBonuses:0});
 assert.deepEqual(selectAtCenter(o,state),basket);
 assert.equal(state.active.kind,'shop');
 assert.ok(!state.suspendedShopping);
 state.suspendedShopping=state.active;
 state.active={kind:'center',objective:{id:'restore-postgame-party',taskKind:'recovery',target:{kind:'object',map:center,index:1}}};
 const resumed=postgameCareObjective(o,{world:navigableCenterWorld,story,mechanics,state:JSON.parse(JSON.stringify(state)),maxSpend:150000});
 assert.deepEqual(resumed,basket,'a reconstructed redundant detour resumes the same purchase');
 assert.equal(o.playerMemory.trainer.party[0].status1,64,'no cartridge recovery is fabricated');
});

test('a retained center basket still treats dangerous status or an inadequate travelling party',()=>{
 for(const {status,ready} of [{status:8,ready:5},{status:64,ready:0}]){
  const o=observe(),state={};o.playerMemory.position={x:1,y:2};selectAtCenter(o,state);
  o.playerMemory.trainer.party[0].status1=status;
  for(let slot=1;slot<=ready;slot++)o.playerMemory.trainer.party.push({slot,validity:'valid',species:22,hp:180,maxHp:180,status1:0,moves:[33],pp:[35],ppBonuses:0});
  assert.equal(selectAtCenter(o,state).id,'restore-postgame-party');
  assert.equal(state.active.kind,'center');
  assert.ok(state.suspendedShopping);
 }
});

test('retained center shopping uses its verified nurse route when five healthy attackers can travel',()=>{
 const o=observe(),state={};setQuantity(o,20,0);
 const basket=select(o,state);o.playerMemory.map.id=route23;o.playerMemory.position={x:1,y:2};
 o.playerMemory.trainer.party[0].hp=93;
 for(let slot=1;slot<6;slot++)o.playerMemory.trainer.party.push({slot,validity:'valid',species:22,hp:180,maxHp:180,status1:0,moves:[33],pp:[35],ppBonuses:0});
 assert.equal(selectRecoveryObjective({world:coLocatedCareWorld,story,observation:o})?.target.map,viridian);
 const care=postgameCareObjective(o,{world:coLocatedCareWorld,story,mechanics,state,maxSpend:150000});
 assert.equal(care.id,'restore-postgame-party');
 assert.deepEqual(care.target,{kind:'object',map:center,index:1});
 assert.ok(campaignNavigationRecommendation({world:coLocatedCareWorld,observation:o,objective:care}));
 assert.deepEqual(state.suspendedShopping.objective,basket);
 state.active=JSON.parse(JSON.stringify(state.active));
 o.playerMemory.map.id=center;o.playerMemory.position={x:1,y:2};o.playerMemory.trainer.party[0].hp=180;
 assert.deepEqual(postgameCareObjective(o,{world:coLocatedCareWorld,story,mechanics,state,maxSpend:150000}),basket);
 assert.equal(state.spent??0,0);
});

test('basket nurse preference yields to the closest healer when travel capacity is inadequate',()=>{
 const o=observe(),state={};setQuantity(o,20,0);select(o,state);
 o.playerMemory.map.id=route23;o.playerMemory.position={x:1,y:2};o.playerMemory.trainer.party[0].hp=93;
 const care=postgameCareObjective(o,{world:coLocatedCareWorld,story,mechanics,state,maxSpend:150000});
 assert.equal(care.target.map,viridian);
 assert.ok(state.suspendedShopping);
});

test('medicine or balls consumed during an active trip cannot authorize spending above its retained cap',()=>{
 const o=observe(),state={};setQuantity(o,2,0);const basket=select(o,state,1800);
 const ball=basket.target.items.find(i=>i.itemId===2);setQuantity(o,2,ball.quantity);o.playerMemory.trainer.money-=1200;
 o.playerMemory.ui.mart={stage:'purchase-result'};select(o,state,1800);
 o.playerMemory.ui={};setQuantity(o,2,ball.quantity-1);
 const decision=postgameCareObjective(o,{world,story,mechanics,state});
 assert.equal(decision.target.kind,'stop-for-review');assert.equal(state.active.kind,'shop');
});

test('a retained cave healer retargets at Route 23 and resumes the same Revive-replacement basket',()=>{
 const o=observe();setQuantity(o,24,18);let state={};const basket=select(o,state);
 o.playerMemory.trainer.party[0].hp=0;
 assert.equal(select(o,state).target.kind,'heal-with-items');
 assert.deepEqual(state.suspendedShopping.objective,basket);
 o.playerMemory.trainer.party[0].hp=150;o.playerMemory.trainer.party[0].pp=[0];
 setQuantity(o,24,17);
 o.playerMemory.map.id=route23;o.playerMemory.position={x:1,y:2};
 // The retained Celadon target came from Victory Road's one-step exit fallback.
 state.active={kind:'center',objective:{id:'restore-postgame-party',taskKind:'recovery',target:{kind:'object',map:celadon,index:0},dialogue:'advance',choice:'yes',deferOptionalDetours:true}};
 const planner=createCampaignPlanner({world:healerWorld,campaign:{objectives:[]}});
 assert.equal(planner.routeMetrics(o,state.active.objective.target),null);
 assert.equal(campaignNavigationRecommendation({world:healerWorld,observation:o,objective:state.active.objective}),null);
 assert.equal(selectRecoveryObjective({world:healerWorld,observation:o})?.target.map,viridian);
 o.playerMemory.ui.party={stage:'message'};
 assert.equal(postgameCareObjective(o,{world:healerWorld,story,mechanics,state,maxSpend:150000}).target.map,celadon);
 o.playerMemory.ui={};o.emulator.inputReady=false;
 assert.equal(postgameCareObjective(o,{world:healerWorld,story,mechanics,state,maxSpend:150000}).target.map,celadon);
 o.emulator.inputReady=true;o.playerMemory.scripts={fieldControlsLocked:true};
 assert.equal(postgameCareObjective(o,{world:healerWorld,story,mechanics,state,maxSpend:150000}).target.map,celadon);
 o.playerMemory.scripts={};
 const held=structuredClone(state.suspendedShopping);
 state=JSON.parse(JSON.stringify(state));
 const retargeted=postgameCareObjective(o,{world:healerWorld,story,mechanics,state,maxSpend:150000});
 assert.equal(retargeted.target.map,viridian);
 assert.ok(campaignNavigationRecommendation({world:healerWorld,observation:o,objective:retargeted}));
 assert.deepEqual(state.suspendedShopping,held);
 assert.equal(state.suspendedShopping.extraCost,1500);
 assert.equal(state.suspendedShopping.spendingLimit,150000);
 assert.deepEqual(postgameCareObjective(o,{world:healerWorld,story,mechanics,state,maxSpend:150000}),retargeted);
 o.playerMemory.trainer.party[0].hp=180;o.playerMemory.trainer.party[0].pp=[35];
 assert.deepEqual(select(o,state),basket);
 assert.equal(state.spent??0,0);
 assert.equal(state.active.objective.target.items.find(i=>i.itemId===24).quantity,basket.target.items.find(i=>i.itemId===24).quantity);
 for(const item of basket.target.items)setQuantity(o,item.itemId,item.quantity);
 o.playerMemory.trainer.money=65700;
 assert.equal(select(o,state),null);
 assert.equal(state.spent,134300);
});

test('an unreachable retained healer with no replacement stops while keeping the suspended basket',()=>{
 const o=observe(),state={},basket=select(o,state);
 o.playerMemory.trainer.party[0].pp=[0];
 state.suspendedShopping=state.active;state.active={kind:'center',objective:{id:'restore-postgame-party',taskKind:'recovery',target:{kind:'object',map:celadon,index:0}}};
 o.playerMemory.map.id=route23;o.playerMemory.position={x:1,y:2};
 const isolated={maps:healerWorld.maps.filter(m=>m.id!==viridian)};
 const stopped=postgameCareObjective(o,{world:isolated,story,mechanics,state,maxSpend:150000});
 assert.equal(stopped.target.kind,'stop-for-review');
 assert.deepEqual(state.suspendedShopping.objective,basket);
 assert.equal(state.active.objective.target.map,celadon);
 assert.equal(state.spent??0,0);
});

test('controller uses the retargeted nurse without renewing the care watchdog',()=>{
 const o=observe(),care={},basket=select(o,care);
 o.playerMemory.trainer.party[0].pp=[0];
 care.suspendedShopping=care.active;care.active={kind:'center',objective:{id:'restore-postgame-party',taskKind:'recovery',target:{kind:'object',map:celadon,index:0},dialogue:'advance',choice:'yes',deferOptionalDetours:true}};
 o.playerMemory.map.id=route23;o.playerMemory.position={x:1,y:2};
 o.playerMemory.storyState.flagIds[2112]=true;o.playerMemory.storyState.flagIds[2116]=true;
 o.playerMemory.storyState.variableIds={};o.playerMemory.gameStats={savedGame:5};
 o.playerMemory.trainer.partyCount=1;o.playerMemory.trainer.usablePartyCount=1;
 o.playerMemory.trainer.pokedex={ownedSpecies:[]};o.playerMemory.trainer.storage={validity:'valid',pokemon:[],boxCounts:Array(14).fill(0)};
 o.emulator.inputReady=true;o.captureId='healer-retarget';o.frame=100;o.phaseReasons=[];o.sram={sha256:'saved'};
 for(const part of [o.emulator,o.playerMemory,o.sram])Object.assign(part,{captureId:o.captureId,frame:o.frame});
 const controller=createPostgameController({world:{data:healerWorld},story:{data:story},mechanics:{data:mechanics},clock:()=>1000,
  state:{schema:'pokemon-suite/postgame/v1',preparation:{phase:'complete'},agenda:{enabled:true,failures:{}},objective:care.active.objective,fieldCare:care,watchdog:{owner:'postgame-maintenance',idleMs:120000,lastAt:1000,retries:2,seen:[]}}});
 const decision=controller.decide(o),after=controller.state();
 assert.equal(after.fieldCare.active.objective.target.map,viridian);
 assert.equal((after.pendingObjective??after.objective)?.target.map,viridian);
 assert.deepEqual(after.fieldCare.suspendedShopping.objective,basket);
 assert.equal(after.watchdog.idleMs,120000);
 assert.equal(after.watchdog.retries,2);
 assert.equal(decision.winner?.recommendation?.targetMap,viridian);
});
