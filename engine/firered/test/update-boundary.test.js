import test from 'node:test';import assert from 'node:assert/strict';
import {updateBoundary} from '../src/suite/update-boundary.js';
const field={game:'firered',observation:{phase:'stable',emulator:{mode:'overworld',inBattle:false},playerMemory:{ui:{}}}};
test('handoff requires an idle field and excludes every transactional owner',()=>{
 assert.equal(updateBoundary(field).ready,true);
 for(const extra of [{captureTiming:true},{localBusy:true},{nativeTrade:{phase:'waiting'}},{mission:{status:'running'}},{postgameActive:true},{observation:{...field.observation,emulator:{mode:'battle',inBattle:true}}},{observation:{...field.observation,playerMemory:{ui:{pc:true}}}}])assert.equal(updateBoundary({...field,...extra}).ready,false);
 assert.equal(updateBoundary({...field,nativeTrade:{phase:'complete'}}).ready,true);
});
test('a durable postgame owner yields only when its own capture and save guards allow the handoff',()=>{
 assert.equal(updateBoundary({...field,postgameActive:true,postgameYieldReady:true}).ready,true);
 for(const extra of [{postgameYieldReady:false},{localBusy:true},{captureTiming:true},{mission:{status:'running'}},{emeraldActive:true},
  {observation:{...field.observation,playerMemory:{ui:{saveDialog:{stage:'saving'}}}}}]){
  assert.equal(updateBoundary({...field,postgameActive:true,postgameYieldReady:true,...extra}).ready,false);
 }
});
