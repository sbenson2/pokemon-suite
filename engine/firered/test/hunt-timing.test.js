import test from 'node:test';import assert from 'node:assert/strict';
const mod=await import('../src/suite/hunt-timing.js').catch(e=>{if(e.code==='ERR_MODULE_NOT_FOUND')return {};throw e;});
test('hunt timing includes calculation waits, freezes pauses and excludes worker downtime',()=>{
 assert.equal(typeof mod.updateHuntTiming,'function');
 const s={id:'hunt',phase:'planning-rng',elapsedMs:2000};
 mod.updateHuntTiming(s,{now:10000,running:true,sessionId:'a'});
 let t=mod.updateHuntTiming(s,{now:15000,running:true,sessionId:'a'});assert.equal(t.elapsedMs,7000);assert.equal(t.phaseElapsedMs,5000);
 s.phase='timing-shiny';t=mod.updateHuntTiming(s,{now:17000,running:true,sessionId:'a'});assert.equal(t.stages['planning-rng'],7000);assert.equal(t.phaseElapsedMs,0);
 mod.updateHuntTiming(s,{now:18000,running:false,sessionId:'a'});
 t=mod.updateHuntTiming(s,{now:99999,running:false,sessionId:'a'});assert.equal(t.elapsedMs,10000);
 t=mod.updateHuntTiming(s,{now:200000,running:true,sessionId:'b'});assert.equal(t.elapsedMs,10000);
 t=mod.updateHuntTiming(s,{now:202000,running:true,sessionId:'b'});assert.equal(t.elapsedMs,12000);assert.equal(t.phaseElapsedMs,3000);
});
test('a completed catch does not start counting again during a later trade',()=>{
 const s={phase:'capturing',elapsedMs:0};mod.updateHuntTiming(s,{now:1000,running:true,sessionId:'a'});
 s.phase='complete';s.status='complete';mod.updateHuntTiming(s,{now:5000,running:true,sessionId:'a'});
 assert.equal(mod.updateHuntTiming(s,{now:99000,running:true,sessionId:'a'}).elapsedMs,4000);
});
