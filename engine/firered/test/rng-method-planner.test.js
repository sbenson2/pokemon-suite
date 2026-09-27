import test from 'node:test';
import assert from 'node:assert/strict';
import * as rng from '../src/rng/fire-red-rng.js';

test('fast RNG advancement agrees with cartridge arithmetic including wraparound and large waits',()=>{
 assert.equal(typeof rng.advanceMainRng,'function');
 for(const n of [0,1,2,314,10000]){
  let reference=0xdeadbeefn;for(let i=0;i<n;i++)reference=(reference*1103515245n+24691n)&0xffffffffn;
  assert.equal(rng.advanceMainRng(0xdeadbeef,n),Number(reference));
 }
 assert.equal(rng.advanceMainRng(123,4294967296),123);
 assert.throws(()=>rng.advanceMainRng(1,-1));
});
test('land calibration identifies a real generation boundary and refuses incompatible species',()=>{
 assert.equal(typeof rng.findLandDelays,'function');
 const slots=Array.from({length:12},()=>({species:16,minLevel:3,maxLevel:3}));
 const input={state:2676765209,otId:0,slots,pokemon:{species:16,level:3,personality:2565724235},maxAdvances:3};
 assert.ok(rng.findLandDelays(input).includes(0));
 assert.deepEqual(rng.findLandDelays({...input,pokemon:{...input.pokemon,species:113}}),[]);
});
test('RNG method selection includes setup, calibration, and success costs; unverified speed cannot win',()=>{
 assert.equal(typeof rng.rankRngMethods,'function');
 const options=[
  {method:'current-state',qualified:true,setupFrames:0,waitFrames:5000,calibrationFrames:0,hitProbability:1},
  {method:'teachy-tv',qualified:true,setupFrames:400,waitFrames:30,calibrationFrames:20,hitProbability:1},
  {method:'title-seed',qualified:true,setupFrames:3000,waitFrames:10,calibrationFrames:100,hitProbability:1},
  {method:'seed-search',qualified:false,setupFrames:0,waitFrames:1,calibrationFrames:0,hitProbability:1},
  {method:'random-encounters',qualified:true,setupFrames:0,waitFrames:1000000,calibrationFrames:0,hitProbability:1}];
 assert.equal(rng.rankRngMethods(options)[0].method,'teachy-tv');
 assert.equal(rng.rankRngMethods([{...options[0],waitFrames:10},options[1]])[0].method,'current-state');
 assert.equal(rng.rankRngMethods([{...options[1],hitProbability:.01},options[0]])[0].method,'current-state');
 assert.throws(()=>rng.rankRngMethods([{...options[0],waitFrames:NaN}]));
});
test('coarse RNG waits stop short of the target and never assume one RNG call equals one frame',()=>{
 assert.equal(typeof rng.rngWaitFrames,'function');
 assert.equal(rng.rngWaitFrames({remaining:1000,callsPerFrame:314,reserve:400,maxFrames:600}),1);
 assert.equal(rng.rngWaitFrames({remaining:315,callsPerFrame:314,reserve:400,maxFrames:600}),0);
 assert.equal(rng.rngWaitFrames({remaining:123,callsPerFrame:2,reserve:0,maxFrames:600}),61);
 assert.throws(()=>rng.rngWaitFrames({remaining:100,callsPerFrame:0}));
});
test('strategy choice minimizes time to a caught shiny, including preparation and failed captures',()=>{
 const common={qualified:true,calibrationFrames:0,setupFrames:10,waitFrames:10,hitProbability:1};
 const methods=[{...common,method:'safari',catchProbability:.1,captureFrames:20,preparationFrames:100},
  {...common,method:'static',catchProbability:1,captureFrames:60,preparationFrames:200}];
 assert.equal(rng.rankRngMethods(methods)[0].method,'static');
 assert.equal(rng.rankRngMethods(methods)[0].expectedFrames,280);
 assert.throws(()=>rng.rankRngMethods([{...common,catchProbability:0}]));
});
test('wild estimates use the requested species and game encounter slots, not Chansey odds',()=>{
 const slots=Array.from({length:12},(_,i)=>({species:i===9?113:16,minLevel:26,maxLevel:26}));
 assert.equal(rng.landSpeciesProbability(slots,113),.04);
 assert.equal(rng.landSpeciesProbability(slots,16),.96);
 assert.equal(rng.landSpeciesProbability(slots,143),0);
 slots[0].species=113;
 assert.equal(rng.landSpeciesProbability(slots,113),.24);
});
