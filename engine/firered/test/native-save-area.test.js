import assert from 'node:assert/strict';
import test from 'node:test';
import {createPolicyAdvisors} from '../src/player/advisors.js';

const safariOrder=['retire','pokedex','pokemon','bag','player','option','exit'];
const normalOrder=['pokedex','pokemon','bag','player','save','option','exit'];
const objective={id:'retain-evolution-save',target:{kind:'save-game',saveVerified:false},identityEvolution:true,deferOptionalDetours:true};
function observation(ui={},map='MAP_SAFARI_ZONE_CENTER') {
 return {captureId:'save-area',frame:100,phase:'stable',phaseReasons:[],
  emulator:{captureId:'save-area',frame:100,mode:'overworld',inputReady:true,inBattle:false},
  sram:{captureId:'save-area',frame:100,sha256:'before'},playerMemory:{captureId:'save-area',frame:100,map:{id:map},position:{x:28,y:15},ui,
   safari:{validity:'valid',balls:30,steps:577},fieldHeap:{validity:'valid',largestFreeBlock:67408},
   trainer:{partyValidity:'valid',party:[{species:45,slot:0,level:25,hp:62,maxHp:76,moves:[77,78,79,51],pp:[35,30,15,27]}],bag:{}},
   storyState:{flagIds:{}},gameStats:{savedGame:81},saveAttemptStatus:1}};
}
function advice(o,goal=objective){
 const campaignPlanner={select:()=>goal};
 return createPolicyAdvisors({campaignPlanner}).find(a=>a.id==='quest').advise(o)?.recommendation;
}
test('any retained save retires from each Safari area instead of treating its menu as a fatal missing Save',()=>{
 for(const map of ['MAP_SAFARI_ZONE_CENTER','MAP_SAFARI_ZONE_EAST','MAP_SAFARI_ZONE_NORTH','MAP_SAFARI_ZONE_WEST','MAP_SAFARI_ZONE_CENTER_REST_HOUSE']){
  const o=observation({startMenu:{cursor:3,order:safariOrder}},map);
  assert.equal(advice(o)?.targetItem,'retire');assert.equal(advice(o)?.targetIndex,0);
  assert.equal(advice(o,structuredClone(objective))?.objective,objective.id,'the save retains ownership across reconstruction');
 }
});
test('a save confirms retirement before acknowledging its accompanying text',()=>{
 const o=observation({choiceMenu:{cursor:1,maxCursor:1},fieldDialog:{stage:'awaiting-close'}});
 assert.equal(advice(o)?.kind,'choose-menu-option');assert.equal(advice(o)?.targetOption,'yes');
 assert.equal(advice(observation({fieldDialog:{stage:'awaiting-close'}}))?.kind,'acknowledge-cartridge-prompt');
});
test('a save drains other Safari menus and opens the exit menu from the field',()=>{
 for(const ui of [{bag:{stage:'list'}},{party:{stage:'list'}}])assert.equal(advice(observation(ui))?.kind,'close-menu');
 assert.equal(advice(observation())?.kind,'open-start-menu');
});
test('after Safari retirement the same save selects Save at the entrance',()=>{
 const r=advice(observation({startMenu:{cursor:0,order:normalOrder}},'MAP_FUCHSIA_CITY_SAFARI_ZONE_ENTRANCE'));
 assert.equal(r?.targetItem,'save');assert.equal(r?.targetIndex,4);assert.equal(r?.objective,objective.id);
});
test('an in-progress native save is never replaced by retirement',()=>{
 assert.equal(advice(observation({saveDialog:{stage:'saving'}}))?.kind,'wait-for-supported-objective');
 assert.equal(advice(observation({saveDialog:{stage:'success'}}),{...objective,target:{kind:'save-game',saveVerified:true}})?.kind,'acknowledge-cartridge-prompt');
});
test('unknown missing Save menus still stop and an explicit stop never retires',()=>{
 assert.equal(advice(observation({startMenu:{cursor:0,order:['pokemon','exit']}},'MAP_CELADON_CITY'))?.kind,'stop-for-review');
 assert.equal(advice(observation({startMenu:{cursor:0,order:safariOrder}}),{id:'stop',target:{kind:'stop-for-review',reason:'preserve-source'}})?.reason,'preserve-source');
});
