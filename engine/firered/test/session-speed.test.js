import assert from 'node:assert/strict';
import test from 'node:test';

async function timing(options) {
 const m=await import('../src/suite/session-speed.js').catch(e=>{if(e.code==='ERR_MODULE_NOT_FOUND')return {};throw e;});
 assert.equal(typeof m.sessionTiming,'function');return m.sessionTiming(options);
}
test('solo FireRed uses adaptive 10× with explicit lower caps supported',async()=>{
 assert.deepEqual(await timing({game:'firered'}),{emulationSpeed:10,adaptiveTiming:true});
 assert.deepEqual(await timing({game:'firered',speed:5}),{emulationSpeed:5,adaptiveTiming:true});
});
test('manual and radio sessions retain native pacing and local exchanges retain their qualified clock',async()=>{
 for(const options of [{manual:true},{radio:true},{speed:1}])assert.deepEqual(await timing({game:'firered',...options}),{emulationSpeed:1,adaptiveTiming:false});
 assert.deepEqual(await timing({game:'firered',local:true,speed:5}),{emulationSpeed:5,adaptiveTiming:false});
 for(const game of ['emerald','crystal'])assert.deepEqual(await timing({game}),{emulationSpeed:5,adaptiveTiming:false});
});
test('invalid speed caps are rejected before a session takes input',async()=>{
 for(const speed of [0,11,NaN,'10'])await assert.rejects(()=>timing({game:'firered',speed}),/speed/);
});
test('hunt duration uses measured throughput and falls back to the current target when idle',async()=>{
 const {estimatedEmulationSeconds}=await import('../src/suite/session-speed.js');
 assert.equal(typeof estimatedEmulationSeconds,'function');
 assert.equal(estimatedEmulationSeconds(5972.75,{achievedEmulationSpeed:6.25,effectiveEmulationSpeed:10}),16);
 assert.equal(estimatedEmulationSeconds(5972.75,{achievedEmulationSpeed:0,effectiveEmulationSpeed:10}),10);
 assert.equal(estimatedEmulationSeconds(5972.75,{effectiveEmulationSpeed:1}),100);
});
