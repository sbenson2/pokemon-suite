import assert from 'node:assert/strict';
import test from 'node:test';

async function open(options={}) {
 const module=await import('../src/suite/campaign-benchmark.js').catch(e=>{if(e.code==='ERR_MODULE_NOT_FOUND')return {};throw e;});
 assert.equal(typeof module.createCampaignBenchmark,'function','campaign benchmarking must be available');
 return module.createCampaignBenchmark({run:{id:'run-test',createdAt:'2026-09-01T00:00:00.000Z',seed:42,teamSeed:'team',commitment:'six'},...options});
}
const observation=(frame,{battle=false,turn=0,slot=0,battles=10,steps=100,mode=battle?'battle':'overworld',play=3600}={})=>({
 frame,phase:'stable',emulator:{mode,inBattle:battle},playerMemory:{map:{id:'MAP_ROUTE20'},position:{x:1,y:1},
  trainer:{party:[],playTime:{hours:Math.floor(play/3600),minutes:Math.floor(play%3600/60),seconds:play%60}},
  gameStats:{battles,steps},battle:battle?{turn,playerPartySlot:slot}:null,ui:{}}});
const campaign=(elapsedMs,extra={})=>({status:'running',hasStarted:true,objective:{id:'rival-route22-late'},task:{kind:'training'},supervision:{elapsedMs},...extra});
const context={sessionId:'owner-a',runtimeLock:{packages:[{version:'50'}]},qualification:{interventions:[]},speed:5};

test('benchmark distinguishes existing campaign time from newly recorded activity and emulated frames',async()=>{
 let now=Date.parse('2026-09-01T10:00:00Z');const b=await open({clock:()=>now});
 b.sample({...context,observation:observation(1000),campaign:campaign(3600000)});
 now+=2000;b.sample({...context,observation:observation(1597,{play:3610,steps:110}),campaign:campaign(3602000)});
 const s=b.summary();assert.equal(s.partial,true);assert.equal(s.baseline.activeRealMs,3600000);
 assert.equal(s.recorded.activeRealMs,2000);assert.equal(s.recorded.frames,597);
 assert.ok(s.recorded.achievedSpeed>4.99&&s.recorded.achievedSpeed<5.01);
 assert.equal(s.activities.travel.activeRealMs,2000);assert.equal(s.purposes.training.activeRealMs,2000);
 assert.equal(s.nativeCounterDelta.steps,10);assert.equal(s.nativePlayTimeSeconds,3610);
 assert.equal(s.campaignActiveRealMs,3602000);
});

test('restarting and changing speed retains accounting without charging offline time as active play',async()=>{
 let now=Date.parse('2026-09-01T10:00:00Z');let b=await open({clock:()=>now});
 b.sample({...context,observation:observation(1000),campaign:campaign(1000)});
 now+=1000;b.sample({...context,observation:observation(1299),campaign:campaign(2000)});
 const saved=b.state();now+=3600000;b=await open({clock:()=>now,state:saved});
 b.sample({...context,sessionId:'owner-b',runtimeLock:{packages:[{version:'51'}]},speed:10,observation:observation(1299),campaign:campaign(2000)});
 now+=1000;b.sample({...context,sessionId:'owner-b',runtimeLock:{packages:[{version:'51'}]},speed:10,observation:observation(1896),campaign:campaign(3000)});
 const s=b.summary();assert.equal(s.recorded.activeRealMs,2000);assert.equal(s.recorded.frames,896);
 assert.equal(s.recorded.wallMs,3602000);assert.equal(s.segments.length,2);
 assert.equal(s.segments[0].frames,299);assert.equal(s.segments[1].frames,597);
 assert.equal(s.segments[0].requestedSpeed,5);assert.equal(s.segments[1].requestedSpeed,10);
});

test('battle observations count actual turns and switches only once across repeated samples',async()=>{
 const b=await open();b.sample({...context,observation:observation(1000),campaign:campaign(0)});
 const battleObservation=(frame,slot,turn)=>{
  const o=observation(frame,{battle:true,battles:11,turn,slot});
  const party=[{slot:0,species:1,personality:10,otId:20,hp:10},{slot:1,species:2,personality:11,otId:20,hp:10}];
  Object.assign(o.playerMemory.trainer,{partyValidity:'valid',party});
  Object.assign(o.playerMemory.battle,{player:{...party[slot],battler:0},opponent:{battler:1,species:3,hp:10},battlerPartyIndexes:[slot,0]});return o;
 };
 b.sample({...context,observation:battleObservation(1001,0,0),campaign:campaign(1)});
 b.sample({...context,observation:battleObservation(1060,1,2),campaign:campaign(100)});
 b.sample({...context,observation:battleObservation(1060,1,2),campaign:campaign(100)});
 assert.equal(b.summary().observed.battleTurns,2);assert.equal(b.summary().observed.partySwitches,1);
 assert.equal(b.summary().nativeCounterDelta.battles,1);
});

test('a declared win cannot finalize the benchmark without the Hall of Fame save and playable postgame',async()=>{
 const b=await open();b.sample({...context,observation:observation(1000),campaign:campaign(0)});
 b.sample({...context,observation:observation(1100),campaign:campaign(1000,{status:'complete',completion:{playablePostgame:true}})});
 assert.equal(b.summary().status,'recording');
 const completion={playablePostgame:true,nativeHallOfFame:{nativeSaveVerified:true,frame:1090,sramSha256:'a'.repeat(64)},frame:1100,sramSha256:'b'.repeat(64)};
 b.sample({...context,observation:observation(1100),campaign:campaign(1000,{status:'complete',completion})});
 assert.equal(b.summary().status,'complete');assert.deepEqual(b.summary().completion,completion);
 b.sample({...context,observation:observation(9999),campaign:campaign(9000)});
 assert.equal(b.summary().recorded.frames,100,'a finished report must not include postgame work');
});

test('a blocked run retains its failure and records a later recovery as an interruption',async()=>{
 const b=await open();b.sample({...context,observation:observation(10),campaign:campaign(0)});
 b.sample({...context,observation:observation(100),campaign:campaign(1000,{status:'blocked',reason:'menu-transaction'})});
 b.sample({...context,observation:observation(100),campaign:campaign(1000,{status:'blocked',reason:'menu-transaction'})});
 b.sample({...context,observation:observation(110),campaign:campaign(1100)});
 assert.equal(b.summary().interruptions.length,1);assert.equal(b.summary().interruptions[0].reason,'menu-transaction');
 assert.equal(b.summary().status,'recording');
});

test('benchmark records computation separately from active wall time and rejects another campaign state',async()=>{
 const b=await open();b.sample({...context,observation:observation(10),campaign:campaign(0)});
 b.measure('observation',3);b.measure('planner',7);b.measure('observation',2);
 assert.deepEqual(b.summary().work.observation,{calls:2,totalMs:5,maxMs:3});
 assert.equal(b.summary().work.planner.totalMs,7);
 await assert.rejects(()=>open({state:{...b.state(),runId:'other'}}),/campaign/);
});

test('manual frames during a paused campaign cannot inflate the bot speed benchmark',async()=>{
 const b=await open();b.sample({...context,observation:observation(100),campaign:campaign(0)});
 b.sample({...context,observation:observation(200),campaign:campaign(1000)});
 b.sample({...context,controlMode:'manual',observation:observation(1200),campaign:campaign(1000,{status:'paused'})});
 b.sample({...context,controlMode:'manual',observation:observation(1800),campaign:campaign(1000,{status:'paused'})});
 b.sample({...context,observation:observation(1800),campaign:campaign(1000)});
 b.sample({...context,observation:observation(1900),campaign:campaign(2000)});
 assert.equal(b.summary().recorded.frames,200);assert.equal(b.summary().recorded.activeRealMs,2000);
 assert.equal(b.summary().outsideAutomation.frames,1600);
});

test('benchmark switch totals agree with individual identity when a battle menu rearranges party slots',async()=>{
 const b=await open();
 const o=observation(100,{battle:true});
 const party=[{slot:0,species:1,personality:10,otId:20,hp:10},{slot:1,species:2,personality:11,otId:20,hp:10}];
 Object.assign(o.playerMemory.trainer,{partyValidity:'valid',party});
 Object.assign(o.playerMemory.battle,{player:{...party[0],battler:0},opponent:{battler:1,species:3,hp:10},battlerPartyIndexes:[0,0]});
 b.sample({...context,observation:o,campaign:campaign(0)});
 const menu=structuredClone(o);menu.frame=200;menu.playerMemory.trainer.party.reverse().forEach((p,i)=>p.slot=i);
 menu.playerMemory.battle.playerPartySlot=1;menu.playerMemory.battle.battlerPartyIndexes[0]=1;
 b.sample({...context,observation:menu,campaign:campaign(100)});
 assert.equal(b.summary().observed.partySwitches,0);
 assert.equal(b.summary().observed.partySwitches,b.summary().diagnostics.totals.switches);
});
