import test from 'node:test';
import assert from 'node:assert/strict';
import * as lifecycle from '../src/suite/console-power.js';

test('start loads the current save and waits without resetting it or resuming a task',async()=>{
 const calls=[];
 assert.equal(typeof lifecycle.startCommandReady,'function');
 await lifecycle.startCommandReady({}, {
  stop:async()=>calls.push('stop'),checkpoint:()=>calls.push('checkpoint'),
  continueSave:()=>calls.push('continue'),ready:()=>calls.push('ready'),
  reset:()=>calls.push('reset'),resumeTask:()=>calls.push('task'),
 });
 assert.deepEqual(calls,['stop','checkpoint','continue','ready']);
});
test('command-ready owners cannot run background automation after a restart',()=>{
 assert.equal(typeof lifecycle.canAutomate,'function');
 assert.equal(lifecycle.canAutomate({enabled:true,awaitingCommand:true}),false);
 assert.equal(lifecycle.canAutomate({enabled:false}),false);
 assert.equal(lifecycle.canAutomate({enabled:true,awaitingCommand:false}),true);
 assert.equal(lifecycle.canAutomate({enabled:true}),true);
});
test('start preserves unfinished captures and linked transactions for explicit resume',async()=>{
 assert.equal(typeof lifecycle.startCommandReady,'function');
 for(const state of [{local:{phase:'trading'}},{trade:{phase:'standby'}},{capture:{nativeSaveVerified:false}},{remotePlayers:1}]){
  let touched=false;
  await assert.rejects(lifecycle.startCommandReady(state,{stop:()=>{touched=true;}}),/Resume|Finish|Save/);
  assert.equal(touched,false);
 }
});
test('a failed save continuation never reports command readiness',async()=>{
 assert.equal(typeof lifecycle.startCommandReady,'function');
 let ready=false;
 await assert.rejects(lifecycle.startCommandReady({}, {stop:()=>{},checkpoint:()=>{},continueSave:()=>{throw Error('No Continue save');},ready:()=>{ready=true;}}),/No Continue/);
 assert.equal(ready,false);
});
