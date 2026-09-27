import test from 'node:test';
import assert from 'node:assert/strict';
const mod=await import('../src/suite/ball-supplies.js').catch(e=>{if(e.code==='ERR_MODULE_NOT_FOUND')return {};throw e;});
const shops=[{map:'MAP_VIRIDIAN_CITY_MART',objectIndex:0,ballStock:[{itemId:4,stockIndex:0}]},{map:'MAP_CINNABAR_ISLAND_MART',objectIndex:0,ballStock:[{itemId:2,stockIndex:0},{itemId:3,stockIndex:1}]}];
const observation=()=>({phase:'stable',emulator:{mode:'overworld',inBattle:false},playerMemory:{map:{id:'MAP_ROUTE12'},ui:{},storyState:{flagIds:{2116:true,2118:true,669:false,670:false,671:false},variableIds:{0x4078:1}},trainer:{money:44000,bag:{pokeBalls:[{itemId:4,quantity:13}]},pokedex:{ownedSpecies:[143]}}}});
test('a funded hunt stocks every purchasable FireRed ball type instead of only cheap balls',()=>{
 assert.equal(typeof mod.planFireRedBallSupply,'function');
 const o=observation(),plan=mod.planFireRedBallSupply({observation:o,shops,budget:10000,opponent:{species:143,level:30}});
 const items=plan.steps.flatMap(s=>s.items);assert.deepEqual(new Set(items.map(p=>p.itemId)),new Set([2,3,9,10]));
 assert.ok(plan.cost<=10000);assert.ok(o.playerMemory.trainer.money-plan.cost>=10000);
 const rare=plan.steps.find(s=>s.map==='MAP_TWO_ISLAND');assert.ok(rare);assert.deepEqual(rare.items.filter(x=>[9,10].includes(x.itemId)).map(x=>x.stockIndex),[1,2]);
 assert.equal(new Set(plan.steps.map(s=>s.map)).size,plan.steps.length,'group purchases by shop');
});
test('budget, reserve and game unlocks constrain optional stock without inventing purchasable balls',()=>{
 const o=observation();o.playerMemory.trainer.money=11000;o.playerMemory.storyState.flagIds[2116]=false;
 const plan=mod.planFireRedBallSupply({observation:o,shops,budget:10000});assert.ok(plan.cost<=1000);assert.ok(plan.steps.flatMap(s=>s.items).every(i=>[2,3,4].includes(i.itemId)));
 o.playerMemory.trainer.money=9000;assert.equal(mod.planFireRedBallSupply({observation:o,shops,budget:10000}),null);
 o.playerMemory.trainer.money=44000;assert.equal(mod.planFireRedBallSupply({observation:o,shops,budget:0}),null);
});
test('a funded supply trip fills each available ball type to 99 without buying extra stacks',()=>{
 const o=observation();o.playerMemory.trainer.money=500000;
 const plan=mod.planFireRedBallSupply({observation:o,shops,budget:490000});
 assert.equal(plan.cost,393400);
 assert.deepEqual(plan.steps.flatMap(s=>s.items).map(i=>i.quantity),[99,99,99,99,99]);
 o.playerMemory.trainer.bag.pokeBalls=[2,3,4,9,10].map(itemId=>({itemId,quantity:99}));
 assert.equal(mod.planFireRedBallSupply({observation:o,shops,budget:490000}),null);
});
test('limited cash favors premium breadth before more ordinary balls',()=>{
 const o=observation();o.playerMemory.trainer.bag.pokeBalls=[{itemId:4,quantity:20},{itemId:3,quantity:5},{itemId:2,quantity:3},{itemId:9,quantity:8},{itemId:10,quantity:5}];
 o.playerMemory.trainer.money=30000;
 const plan=mod.planFireRedBallSupply({observation:o,shops,budget:999999});assert.ok(plan);const items=plan.steps.flatMap(s=>s.items);
 assert.ok(plan.cost<=20000);assert.ok(items.filter(i=>[2,9,10].includes(i.itemId)).length===3);
 assert.ok(items.every(i=>![3,4].includes(i.itemId)),'existing cheap stock must not dilute the premium purchase');
});
test('a stocked bag is used down to the refill threshold instead of shopping after every throw',()=>{
 const o=observation();o.playerMemory.trainer.bag.pokeBalls=[2,3,4,9,10].map(itemId=>({itemId,quantity:98}));
 assert.equal(mod.planFireRedBallSupply({observation:o,shops,budget:10000}),null);
 o.playerMemory.trainer.bag.pokeBalls[0].quantity=49;
 assert.ok(mod.planFireRedBallSupply({observation:o,shops,budget:10000}));
});
test('Two Island shop upgrades use the actual visit flags and finish each shop interaction',()=>{
 assert.equal(typeof mod.fireRedBallShopUpgrade,'function');const o=observation();o.playerMemory.map.id='MAP_TWO_ISLAND';
 assert.equal(mod.fireRedBallShopUpgrade(o).objective.target.kind,'object');
 o.playerMemory.storyState.flagIds[669]=true;o.playerMemory.ui.mart={stage:'main-menu'};
 assert.equal(mod.fireRedBallShopUpgrade(o).recommendation.kind,'close-menu');
 o.playerMemory.ui={};assert.equal(mod.fireRedBallShopUpgrade(o).objective.target.map,'MAP_TWO_ISLAND_CAPE_BRINK');
 o.playerMemory.map.id='MAP_TWO_ISLAND_CAPE_BRINK';assert.equal(mod.fireRedBallShopUpgrade(o).objective.target.map,'MAP_TWO_ISLAND');
 o.playerMemory.map.id='MAP_TWO_ISLAND';o.playerMemory.storyState.flagIds[670]=true;o.playerMemory.storyState.flagIds[671]=true;o.playerMemory.storyState.variableIds[0x4078]=4;
 assert.equal(mod.fireRedBallShopUpgrade(o),null);
});
