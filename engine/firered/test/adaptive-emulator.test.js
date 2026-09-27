import assert from 'node:assert/strict';
import test from 'node:test';
import {createAutonomousEmulator} from '../src/emulator/autonomous-emulator.js';

function harness({frameCost=0,...options}={}) {
 let now=0,serial=0;const tasks=new Map(),inputs=[],frames=[];
 const scheduler={clock:()=>now,schedule:(fn,delay)=>{const id=++serial;tasks.set(id,{fn,at:now+Math.max(0,delay)});return id;},cancel:id=>tasks.delete(id)};
 const session={frame:0,step(buttons){inputs.push([...buttons]);this.frame++;now+=frameCost;},releaseButtons(){},
  videoFrame:()=>({width:1,height:1,rgba:new Uint8Array(4)})};
 const emulator=createAutonomousEmulator({session,...scheduler,emulationSpeed:10,adaptiveTiming:true,frameExact:true,...options});
 emulator.subscribe(f=>frames.push({at:now,sequence:f.sequence}));
 return {emulator,session,inputs,frames,now:()=>now,
  async advance(ms){const end=now+ms;let guard=0;
   while(true){await Promise.resolve();await Promise.resolve();await Promise.resolve();
    const next=[...tasks.entries()].sort((a,b)=>a[1].at-b[1].at)[0];
    if(!next||next[1].at>end)break;
    assert.ok(++guard<100000,'scheduler must yield instead of spinning');tasks.delete(next[0]);now=Math.max(now,next[1].at);next[1].fn();
   }now=Math.max(now,end);await Promise.resolve();
  }};
}

test('short approved menu edges reach the requested speed without waiting for a display tick',async()=>{
 const h=harness();let completed=false;
 try {
  const sequence=(async()=>{for(let i=0;i<100;i++)await h.emulator.execute({buttons:['a'],holdFrames:1,releaseFrames:1});completed=true;})();
  await h.advance(400);
  assert.equal(completed,true,'200 approved frames should complete in under 400ms at 10x');
  await sequence;assert.equal(h.session.frame,200);
  assert.deepEqual(h.inputs,Array.from({length:200},(_,i)=>i%2?[]:['a']));
  assert.ok(h.frames.length<=26,'fast cartridge execution must not flood the display');
 }finally{h.emulator.close();}
});

for(const speed of [1,5,8,10])test(`adaptive ${speed}x honors exact waits and never advances while waiting for a decision`,async()=>{
 const h=harness({emulationSpeed:speed});
 try{
  await h.advance(1000);assert.equal(h.session.frame,0);
  const action=h.emulator.execute({buttons:[],holdFrames:81,releaseFrames:0});
  await h.advance(1600/speed);await action;
  assert.equal(h.session.frame,81);
  await h.advance(5000);assert.equal(h.session.frame,81);
  const press=h.emulator.execute({buttons:['a'],holdFrames:1,releaseFrames:1});
  await h.advance(50);await press;assert.equal(h.session.frame,83);
  assert.deepEqual(h.inputs.slice(-2),[['a'],[]]);
 }finally{h.emulator.close();}
});

test('adaptive speed changes preserve an in-flight button lease and its release',async()=>{
 const h=harness({emulationSpeed:5});
 try{
  assert.equal(typeof h.emulator.setEmulationSpeed,'function');
  const action=h.emulator.execute({buttons:['up','b'],holdFrames:31,releaseFrames:2});
  await h.advance(30);const before=h.session.frame;
  h.emulator.setEmulationSpeed(10);assert.equal(h.session.frame,before);
  await h.advance(160);await action;
  assert.equal(h.session.frame,33);
  assert.deepEqual(h.inputs.slice(0,31),Array.from({length:31},()=>['up','b']));
  assert.deepEqual(h.inputs.slice(31),[[],[]]);
  assert.equal(h.emulator.controlState().configuredEmulationSpeed,10);
 }finally{h.emulator.close();}
});

test('manual takeover stays at 1x after accelerated play and drops pending bot input',async()=>{
 const h=harness();
 try{
  const action=h.emulator.execute({buttons:['a'],holdFrames:600,releaseFrames:0});await h.advance(40);
  h.emulator.setControlMode('manual');assert.equal((await action).interrupted,'manual-control');
  const frame=h.session.frame;await h.advance(1000);
  assert.ok(h.session.frame-frame>=58&&h.session.frame-frame<=60);
  assert.ok(h.inputs.slice(frame).every(b=>b.length===0));
  assert.equal(h.emulator.controlState().effectiveEmulationSpeed,1);
 }finally{h.emulator.close();}
});

test('radio waits discard elapsed frame allowance instead of bursting on reconnect',async()=>{
 let allowed=false;const h=harness({canAdvanceFrame:()=>allowed});
 try{
  const action=h.emulator.execute({buttons:['a'],holdFrames:100,releaseFrames:0});
  await h.advance(4000);assert.equal(h.session.frame,0);
  allowed=true;await h.advance(10);assert.ok(h.session.frame<=6);
  h.emulator.pause('radio-test-stop');await action;
  const frame=h.session.frame;await h.advance(1000);assert.equal(h.session.frame,frame);
 }finally{h.emulator.close();}
});

test('the governor reduces its target under load and reports measured cartridge throughput',async()=>{
 const h=harness({frameCost:4,frameExact:false});
 try{
  await h.advance(3000);
  const control=h.emulator.controlState(),metrics=h.emulator.metrics();
  assert.ok(control.effectiveEmulationSpeed<5,'a 4ms frame cannot sustain 10x');
  assert.ok(control.effectiveEmulationSpeed>=1);
  assert.ok(metrics.achievedEmulationSpeed>1&&metrics.achievedEmulationSpeed<5);
  assert.ok(h.frames.length<190);
 }finally{h.emulator.close();}
});

test('a paused executor reports zero measured speed without forgetting its configured cap',async()=>{
 const h=harness({frameExact:false});
 try{
  await h.advance(1100);assert.ok(h.emulator.metrics().achievedEmulationSpeed>0);
  h.emulator.pause('inspection');
  assert.equal(h.emulator.metrics().achievedEmulationSpeed,0);
  assert.equal(h.emulator.controlState().achievedEmulationSpeed,0);
  assert.equal(h.emulator.controlState().configuredEmulationSpeed,10);
 }finally{h.emulator.close();}
});

test('an unexpected encounter interrupts a 10× held input on the exact callback boundary',async()=>{
 const h=harness({controllerState:()=>({inBattle:h.session.frame>=3,callback2:h.session.frame>=3?'BattleMainCB2':'CB2_Overworld'})});
 try{
  const action=h.emulator.execute({kind:'bounded',buttons:['a'],holdFrames:30,releaseFrames:1});
  await h.advance(100);assert.equal((await action).interrupted,'cartridge-boundary-changed');
  assert.deepEqual(h.inputs,[['a'],['a'],['a']]);
 }finally{h.emulator.close();}
});
