import test from 'node:test';
import assert from 'node:assert/strict';
import {PlayerTask} from '../src/suite/player-task.js';
const world={data:{maps:[{id:'MAP_PALLET_TOWN',objectEvents:[]},{id:'MAP_VIRIDIAN_CITY',objectEvents:[]}]}};
const observation=(map='MAP_PALLET_TOWN')=>({frame:1,phase:'stable',emulator:{mode:'overworld',inBattle:false,inputReady:true},sram:{sha256:'before'},playerMemory:{map:{id:map},position:{x:3,y:4},ui:{},trainer:{partyValidity:'valid',party:[],bag:{items:[]}},gameStats:{savedGame:5},saveAttemptStatus:1}});
test('a travel task stops at its destination only after the native save verifies',()=>{
 const task=new PlayerTask({request:{id:'walk',kind:'travel',map:'MAP_VIRIDIAN_CITY'},world});
 assert.equal(task.inspect(observation()).objective.target.map,'MAP_VIRIDIAN_CITY');
 const arrived=observation('MAP_VIRIDIAN_CITY');
 assert.equal(task.inspect(arrived).objective.target.kind,'save-game');
 assert.notEqual(task.inspect(arrived).kind,'complete');
 arrived.playerMemory.gameStats.savedGame=6;arrived.sram.sha256='saved';
 const restored=new PlayerTask({state:structuredClone(task.state),world});
 assert.equal(restored.inspect(arrived).kind,'complete');
});
test('collecting an item means acquiring the requested additional quantity',()=>{
 const o=observation();o.playerMemory.trainer.bag.items=[{itemId:68,quantity:2}];
 const task=new PlayerTask({request:{id:'candy',kind:'item',itemId:68,quantity:3},world,planner:{selectItemPreparation:()=>({id:'find-candy',target:{kind:'object',map:'MAP_PALLET_TOWN',index:0}})}});
 assert.equal(task.inspect(o).objective.id,'find-candy');
 o.playerMemory.trainer.bag.items[0].quantity=4;assert.equal(task.inspect(o).objective.id,'find-candy');
 o.playerMemory.trainer.bag.items[0].quantity=5;assert.equal(task.inspect(o).objective.target.kind,'save-game');
});
test('a task does not mark an arrival during battle or a menu transition',()=>{
 const task=new PlayerTask({request:{id:'walk',kind:'travel',map:'MAP_PALLET_TOWN'},world});
 const o=observation();o.emulator.inBattle=true;o.emulator.mode='battle';
 assert.notEqual(task.inspect(o).kind,'complete');assert.notEqual(task.state.phase,'saving');
});
test('unreachable item supply reports the actual limit instead of collecting something else',()=>{
 const task=new PlayerTask({request:{id:'candy',kind:'item',itemId:68,quantity:1},world,planner:{selectItemPreparation:()=>null}});
 assert.equal(task.inspect(observation()).kind,'stop');
});
