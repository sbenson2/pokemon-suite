import test from 'node:test';
import assert from 'node:assert/strict';
import {manualConsoleStart} from '../src/suite/console-power.js';

test('console power checkpoints before resetting and leaves the bot disabled at the title',async()=>{
 const events=[];let enabled=true,mode='bot';
 await manualConsoleStart({boot:true,local:null,trade:null,capture:null}, {
  stop:async()=>{events.push('stop');enabled=false;},
  checkpoint:()=>events.push('checkpoint'),
  reset:()=>events.push('reset'),
  manual:()=>{mode='manual';events.push('manual');},
 });
 assert.deepEqual(events,['stop','checkpoint','reset','manual']);
 assert.equal(enabled,false);assert.equal(mode,'manual');
});
test('taking manual control preserves the current game frame',async()=>{
 let frame=1200;
 await manualConsoleStart({boot:false},{stop:async()=>{},checkpoint:()=>{},reset:()=>{frame=0;},manual:()=>{}});
 assert.equal(frame,1200);
});
test('power cannot reset a reserved link or an unsaved shiny',async()=>{
 for(const state of [{local:{phase:'trading'}},{trade:{phase:'standby'}},{capture:{nativeSaveVerified:false}},{remotePlayers:1}]){
  let touched=false;
  await assert.rejects(manualConsoleStart({boot:true,...state},{stop:async()=>{touched=true;}}),/Finish|Save/);
  assert.equal(touched,false);
 }
});
test('a presentation gate rejects stale viewers and resumes once after the exact boot',async()=>{
 const {ConsolePresentationGate}=await import('../src/suite/console-power.js');
 const gate=new ConsolePresentationGate();let resumed=0;
 gate.begin('a'.repeat(32));
 assert.throws(()=>gate.finish('b'.repeat(32),()=>resumed++),/changed/);
 assert.equal(resumed,0);assert.equal(gate.status().phase,'waiting');
 gate.finish('a'.repeat(32),()=>resumed++);
 assert.equal(resumed,1);assert.equal(gate.status(),null);
 assert.throws(()=>gate.finish('a'.repeat(32),()=>resumed++),/changed/);
});
