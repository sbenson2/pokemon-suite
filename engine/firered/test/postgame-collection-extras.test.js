import test from 'node:test';
import assert from 'node:assert/strict';
import fame from '../src/suite/postgame-fame-facts.json' with {type:'json'};
import {selectFameChecker,selectUnownForm} from '../src/suite/postgame-collection-extras.js';

test('the source catalog covers exactly six native facts for each of sixteen people',()=>{
 const facts=new Set(fame.targets.flatMap(t=>t.entries.map(([p,i])=>`${p}:${i}`)));
 assert.equal(facts.size,96);
 for(let p=0;p<16;p++)for(let i=0;i<6;i++)assert.ok(facts.has(`${p}:${i}`));
});
test('Fame Checker retains its native target on restart and defers a failed event',()=>{
 const target=fame.targets.find(t=>t.kind==='object'),events=[];
 events[target.index]={script:target.script};
 const world={maps:[{id:target.map,objectEvents:events}]};
 const o={playerMemory:{map:{id:target.map},postgameEvidence:{fameChecker:Array.from({length:16},()=>({entries:0}))}}};
 const state={active:target.map+':object:'+target.index},first=selectFameChecker(o,world,state,100);
 assert.equal(first.target.index,target.index);
 assert.deepEqual(selectFameChecker(o,world,structuredClone(state),101),first);
 state.failed={[state.active]:{retryAt:1000}};
 assert.notEqual(selectFameChecker(o,world,state,102)?.id,first.id);
 o.playerMemory.postgameEvidence.fameChecker.forEach(r=>r.entries=63);
 assert.equal(selectFameChecker(o,world,state,1001),null);
});
test('Unown form collection routes the two rare symbols to their actual chambers and reserves storage',()=>{
 const o={playerMemory:{map:{id:'MAP_SEVEN_ISLAND_TANOBY_RUINS_MONEAN_CHAMBER'},storyState:{flagIds:{2121:true}},trainer:{partyValidity:'valid',party:Array(6).fill({}),storage:{validity:'valid',unknownSlots:0,boxCounts:Array(14).fill(0)}},postgameEvidence:{unownForms:Array.from({length:26},(_,i)=>i)}}};
 let route=selectUnownForm(o).route;assert.equal(route.unownForm,27);assert.ok(route.map.includes('MONEAN'));
 o.playerMemory.postgameEvidence.unownForms.push(27);
 route=selectUnownForm(o).route;assert.equal(route.unownForm,26);assert.ok(route.map.includes('VIAPOIS'));
 o.playerMemory.postgameEvidence.unownForms.push(26);assert.equal(selectUnownForm(o),null);
 o.playerMemory.postgameEvidence.unownForms=[];o.playerMemory.trainer.storage.boxCounts=Array(14).fill(30);assert.equal(selectUnownForm(o),null);
});
