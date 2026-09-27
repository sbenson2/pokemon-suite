import test from 'node:test';
import assert from 'node:assert/strict';
import {qualifyRngWithCalibration} from '../src/rng/timing-calibration.js';
const stale=()=>Error('Teachy TV rate changed; recalibration required');
test('stale cached timing triggers one fresh native qualification before returning its plan',async()=>{
 let calls=0;const progress=[];
 const result=await qualifyRngWithCalibration({profile:{teachyRate:42},onProgress:e=>progress.push(e),qualify:async profile=>{
  calls++;if(profile)throw stale();return {verified:true,verifiedRepeats:2};
 }});
 assert.equal(result.verifiedRepeats,2);assert.equal(calls,2);assert.equal(progress[0].phase,'recalibrating');
});
test('an unstable fresh calibration stops after one retry instead of looping',async()=>{
 let calls=0;await assert.rejects(qualifyRngWithCalibration({profile:{teachyRate:42},qualify:async()=>{calls++;throw stale();}}),/rate changed/);assert.equal(calls,2);
});
test('Stop, a source mismatch, and an already fresh calibration never start another trial',async()=>{
 for(const options of [{profile:{teachyRate:42},signal:{aborted:true},error:stale()},{profile:{teachyRate:42},error:Error('RNG qualification source changed')},{profile:null,error:stale()}]){
  let calls=0;await assert.rejects(qualifyRngWithCalibration({...options,qualify:async()=>{calls++;throw options.error;}}),e=>e===options.error);assert.equal(calls,1);
 }
});
