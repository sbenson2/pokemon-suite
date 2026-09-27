import test from 'node:test';
import assert from 'node:assert/strict';
import * as rng from '../src/rng/fire-red-rng.js';

test('static PID prediction follows the cartridge two-draw order and trainer shiny XOR',()=>{
 assert.equal(typeof rng.predictStaticGeneration,'function');
 const p=rng.predictStaticGeneration({state:0,otId:0});
 assert.equal(p.personality,3917348864); // 0xe97e0000: first draw is the low word.
 assert.equal(p.shiny,false);
 assert.equal(rng.predictStaticGeneration({state:0,otId:3917348864}).shiny,true);
 assert.equal(rng.predictStaticGeneration({state:0,otId:(3917348864^8)>>>0}).shiny,false);
 assert.throws(()=>rng.predictStaticGeneration({state:0,otId:null}));
});

test('static timing calibrates from observed PID and searches a shiny confirmation seed',()=>{
 assert.equal(typeof rng.findStaticDelay,'function');
 const delay=rng.findStaticDelay({state:0,personality:833639025,maxAdvances:20});
 // seed after two calls generates low 0x5271, high 0x31b0.
 assert.equal(delay,2);
 assert.equal(rng.findStaticDelay({state:0,personality:833639025,maxAdvances:2}),null);
 const result=rng.planStaticShiny({state:0,otId:833639025,delay:2,maxAdvances:1});
 assert.equal(result.advances,0);
 assert.equal(result.confirmationState,0);
 assert.equal(result.pokemon.personality,833639025);
 assert.equal(rng.planStaticShiny({state:0,otId:0,delay:0,maxAdvances:1}),null);
 assert.throws(()=>rng.planStaticShiny({state:0,otId:0,delay:-1}));
});

test('RNG distance detects skipped advances and never treats RNG calls as frames',()=>{
 assert.equal(typeof rng.mainRngDistance,'function');
 assert.equal(rng.mainRngDistance(0,3917380458,3),2);
 assert.equal(rng.mainRngDistance(0,3917380458,1),null);
 assert.equal(rng.mainRngDistance(0,0,1),0);
});
test('static RNG prefers requested traits but retains a shiny fallback inside its search budget',()=>{
 const first=rng.planStaticShiny({state:0,otId:0,delay:0});
 const preferred=rng.planStaticShiny({state:0,otId:0,delay:0,matches:p=>p.personality!==first.pokemon.personality});
 assert.ok(preferred.advances>first.advances);assert.equal(preferred.traitsMatched,true);
 const fallback=rng.planStaticShiny({state:0,otId:0,delay:0,matches:()=>false});
 assert.equal(fallback.pokemon.personality,first.pokemon.personality);assert.equal(fallback.traitsMatched,false);
 assert.deepEqual(rng.predictStaticGeneration({state:0,otId:0}).ivs,{hp:17,attack:19,defense:20,speed:16,spAttack:13,spDefense:12});
});
