import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,writeFileSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {pathToFileURL} from 'node:url';
import {createPlannerClient} from '../src/suite/planner-client.js';
import {createCampaignRun,createCampaignController} from '../src/suite/campaign-run.js';
import {createFireRedRosterContext} from '../src/player/fire-red-roster.js';
import {rosterContextFixture} from '../test-support/roster-context-fixture.js';

test('the isolated real planner publishes story evidence for a paused viewer and retains it through a transition and worker replacement',async t=>{
 const record=createCampaignRun({settings:{starter:'bulbasaur',seedMode:'replay',seed:1,teamSeed:1},rosterContext:createFireRedRosterContext(rosterContextFixture())});
 const local=createCampaignController({record});local.pause();
 const options={module:new URL('../src/suite/campaign-run.js',import.meta.url).href,options:{record,state:local.state()},snapshot:{state:local.state(),storyWatch:local.storyWatch(),campaignStatus:local.campaignStatus()}};
 const client=createPlannerClient(options);t.after(()=>client.close());await client.ready();
 const o={frame:10,phase:'stable',emulator:{mode:'overworld'},playerMemory:{map:{id:'MAP_CINNABAR_ISLAND'},storyState:{flagIds:{2080:true,2081:true,2082:true,2083:true,2084:true,2085:false,2086:false,2087:false},variableIds:{}},trainer:{party:[],bag:{}}}};
 const state=client.state();client.storyProgress(o);await client.ready();
 const progress=client.storyProgress(o);assert.equal(progress.badges.earned,5);assert.equal(progress.location,'Cinnabar Island');
 assert.deepEqual(client.state(),state,'a public observation cannot change campaign state or resume input');
 client.storyProgress({...o,frame:11,phase:'transition'});await client.ready();assert.deepEqual(client.storyProgress(),progress);
 const next=createPlannerClient({...options,options:{record,state:client.state()}});t.after(()=>next.close());await next.ready();
 next.storyProgress(o);await next.ready();assert.deepEqual(next.storyProgress(),progress);
});

test('planner commands are ordered and state survives a worker replacement',async t=>{
 const dir=mkdtempSync(join(tmpdir(),'suite-planner-'));t.after(()=>rmSync(dir,{recursive:true,force:true}));
 const file=join(dir,'planner.mjs');writeFileSync(file,`export function createCampaignController({state}){let n=state?.n??0;return {state:()=>({n}),storyWatch:()=>({flags:[]}),campaignStatus:()=>({}),decide:()=>({kind:'act',n:++n,action:{buttons:[]}}),observeExecution:()=>{n+=10},pause:()=>{},resume:()=>{},wait:()=>{},acknowledgeCapture:()=>{}}}`);
 const options={module:pathToFileURL(file).href,options:{},snapshot:{state:{n:2},storyWatch:{flags:[]},campaignStatus:{}}};
 const first=createPlannerClient(options);t.after(()=>first.close());
 assert.equal((await first.decide({})).n,3);
 await first.observeExecution({});
 const saved=first.state();assert.equal(saved.n,13);
 await first.close();
 const next=createPlannerClient({...options,options:{state:saved},snapshot:{...options.snapshot,state:saved}});t.after(()=>next.close());
 assert.equal((await next.decide({})).n,14);
});
test('a hung planner rejects within its deadline and cannot later produce input',async t=>{
 const dir=mkdtempSync(join(tmpdir(),'suite-planner-'));t.after(()=>rmSync(dir,{recursive:true,force:true}));
 const file=join(dir,'hung.mjs');writeFileSync(file,`export function createCampaignController(){return {state:()=>({}),storyWatch:()=>({flags:[]}),campaignStatus:()=>({}),decide:()=>{while(true){}}}}`);
 const worker=createPlannerClient({module:pathToFileURL(file).href,options:{},snapshot:{state:{},storyWatch:{flags:[]},campaignStatus:{}},timeoutMs:200});t.after(()=>worker.close());
 await assert.rejects(worker.decide({}),/deadline/);
 await assert.rejects(worker.decide({}),/closed|deadline/);
});

test('planner timing measures execution separately from round trips without changing ordered state',async t=>{
 const dir=mkdtempSync(join(tmpdir(),'suite-planner-metrics-'));t.after(()=>rmSync(dir,{recursive:true,force:true}));
 const file=join(dir,'planner.mjs');writeFileSync(file,`export function createCampaignController(){let n=0;return {state:()=>({n,status:'running',hasStarted:true,supervision:{elapsedMs:n}}),storyWatch:()=>({flags:[]}),campaignStatus:()=>({}),decide:()=>({kind:'act',n:++n}),observeExecution:()=>{n+=10}}}`);
 const worker=createPlannerClient({module:pathToFileURL(file).href,options:{},snapshot:{state:{},storyWatch:{},campaignStatus:{}}});t.after(()=>worker.close());
 await worker.decide({});await worker.observeExecution({});
 assert.equal(typeof worker.metrics,'function');assert.equal(typeof worker.benchmarkState,'function');
 const metrics=worker.metrics();assert.equal(metrics.calls,2);
 assert.ok(metrics.computeMs>=0&&metrics.snapshotMs>=0&&metrics.roundTripMs>=metrics.computeMs);
 const snapshot=worker.benchmarkState();assert.equal(snapshot.supervision.elapsedMs,11);
 snapshot.supervision.elapsedMs=999;assert.equal(worker.state().supervision.elapsedMs,11);
});

function faultPlanner(t){
 const dir=mkdtempSync(join(tmpdir(),'suite-planner-recovery-'));t.after(()=>rmSync(dir,{recursive:true,force:true}));
 const file=join(dir,'planner.mjs');
 writeFileSync(file,`export function createCampaignController({state,gate}){let n=state?.n??0,status=state?.status??'running';
 const fault=()=>{if(Atomics.sub(new Int32Array(gate),0,1)>0)while(true){}};
 return {state:()=>({n,status,objective:{id:'same-goal'},player:{workflow:{kind:'save-game'}}}),storyWatch:()=>({}),campaignStatus:()=>({}),
 decide:()=>{fault();return {kind:'act',n:++n,action:{buttons:['a']}}},observeExecution:()=>{fault();n+=10},pause:()=>{status='paused'},resume:()=>{status='running'}}}`);
 const gate=new SharedArrayBuffer(4);
 return {gate,config:{module:pathToFileURL(file).href,options:{gate},snapshot:{state:{n:2,status:'running',objective:{id:'same-goal'},player:{workflow:{kind:'save-game'}}},storyWatch:{},campaignStatus:{}},timeoutMs:250,restartLimit:2}};
}

test('the owner recovers a hung planner from its acknowledged snapshot and replays feedback once',async t=>{
 const {gate,config}=faultPlanner(t),client=createPlannerClient(config);t.after(()=>client.close());await client.ready();
 Atomics.store(new Int32Array(gate),0,1);
 assert.equal((await client.decide({frame:10})).n,3);
 Atomics.store(new Int32Array(gate),0,1);
 await client.observeExecution({observation:{frame:10},execution:{status:'complete'}});
 assert.equal(client.state().n,13,'retry feedback against the pre-feedback snapshot; never replay game input');
 assert.equal(client.state().player.workflow.kind,'save-game');
 assert.equal(client.state().plannerSupervision.history.filter(r=>r.status==='restarted').length,2);
 assert.equal((await client.decide({frame:11})).n,14);
});

test('pause during a planner timeout cancels the pending decision and does not auto-resume',async t=>{
 const {gate,config}=faultPlanner(t),client=createPlannerClient(config);t.after(()=>client.close());await client.ready();
 Atomics.store(new Int32Array(gate),0,1);
 const pending=client.decide({frame:10});
 await new Promise(resolve=>setTimeout(resolve,25));client.pause();
 const result=await pending;
 assert.equal(result.kind,'resample');assert.deepEqual(result.action.buttons,[]);
 await client.ready();assert.equal(client.state().status,'paused');assert.equal(client.state().n,2);
});

test('repeated planner hangs exhaust a persistent incident budget across owner reconstruction',async t=>{
 const {gate,config}=faultPlanner(t),client=createPlannerClient(config);t.after(()=>client.close());
 Atomics.store(new Int32Array(gate),0,100);
 await assert.rejects(client.decide({frame:10}),/deadline/);
 const state=client.state();assert.equal(state.plannerSupervision.history.filter(r=>r.status==='restarted').length,2);
 await client.close();
 const restored=createPlannerClient({...config,options:{gate,state},snapshot:{...config.snapshot,state}});t.after(()=>restored.close());
 await assert.rejects(restored.decide({frame:10}),/deadline/);
 assert.equal(restored.state().plannerSupervision.history.filter(r=>r.status==='restarted').length,2);
});

test('the real postgame planner serializes commands and preserves handoff ownership across replacement',async t=>{
 const {createPostgameController}=await import('../src/suite/postgame.js');
 const options={world:{data:{maps:[],wildEncounters:[]}},story:{data:{scripts:[]}},mechanics:{data:{species:[]}}};
 const local=createPostgameController(options);
 const config={kind:'postgame',module:new URL('../src/suite/postgame.js',import.meta.url).href,options,snapshot:{state:local.state(),storyWatch:local.storyWatch()}};
 const client=createPlannerClient(config);t.after(()=>client.close());
 await client.command('beginAdventure');
 await client.command('requestHandoff');
 const state=client.state();assert.equal(state.agenda.enabled,true);
 const next=createPlannerClient({...config,options:{...options,state},snapshot:{...config.snapshot,state}});t.after(()=>next.close());
 const o={frame:1,phase:'stable',emulator:{mode:'overworld',inBattle:false},playerMemory:{map:{id:'MAP_TEST'},ui:{},trainer:{partyValidity:'valid',party:[]},storyState:{flagIds:{2092:true}}}};
 const result=await next.decide(o);assert.equal(result.kind,'handoff');
});

test('slow postgame planning leaves host timers responsive and late input is cancelled on pause',async t=>{
 const dir=mkdtempSync(join(tmpdir(),'suite-postgame-planner-'));t.after(()=>rmSync(dir,{recursive:true,force:true}));
 const file=join(dir,'planner.mjs');writeFileSync(file,`export function createPostgameController(){return {state:()=>({schema:'pokemon-suite/postgame/v1'}),storyWatch:()=>({flags:[]}),decide:()=>{const until=Date.now()+250;while(Date.now()<until){};return {kind:'act',action:{buttons:['a']}}},wait:()=>{}}}`);
 const client=createPlannerClient({kind:'postgame',module:pathToFileURL(file).href,options:{},snapshot:{state:{},storyWatch:{flags:[]}}});t.after(()=>client.close());await client.ready();
 let fired=false;const pending=client.decide({});await new Promise(r=>setTimeout(()=>{fired=true;r();},30));
 assert.equal(fired,true);client.wait('Paused for review');
 assert.notEqual((await pending).kind,'act');assert.equal(client.state().reason,'Paused for review');
});

test('postgame worker facade retains hunt reservations and reports protected yield boundaries',async t=>{
 const {createPostgameClient}=await import('../src/suite/postgame-client.js');
 const args={world:{data:{maps:[],wildEncounters:[]}},story:{data:{scripts:[]}},mechanics:{data:{species:[]}}};
 const client=createPostgameClient(args);t.after(()=>client.close());await client.beginAdventure();
 const record={id:'retained-hunt',postgameObjective:'eevee',request:{speciesId:133}};
 await client.recordHunt('eevee',record);assert.equal(client.state().agenda.hunts.eevee.id,'retained-hunt');
 await client.completeHunt('eevee','wrong-hunt');assert.equal(client.state().agenda.hunts.eevee.id,'retained-hunt');
 const next=createPostgameClient({...args,state:client.state()});t.after(()=>next.close());await next.ready();
 await next.completeHunt('eevee','retained-hunt');assert.equal(next.state().agenda.hunts.eevee,undefined);
 const o={phase:'stable',emulator:{mode:'overworld',inBattle:false},playerMemory:{ui:{}}};
 assert.equal(next.canYield(o),true);assert.equal(next.canYield({...o,emulator:{mode:'battle',inBattle:true}}),false);
 const state=next.state();state.save={count:1};const saving=createPostgameClient({...args,state});t.after(()=>saving.close());assert.equal(saving.canYield(o),false);
});

test('partner availability publication is nonblocking and coalesces unchanged polls',async t=>{
 const {createPostgameClient}=await import('../src/suite/postgame-client.js');
 const c=createPostgameClient({world:{data:{maps:[],wildEncounters:[]}},story:{data:{scripts:[]}},mechanics:{data:{species:[]}}});t.after(()=>c.close());
 await c.ready();const before=c.metrics().calls;
 for(let i=0;i<100;i++)assert.equal(c.publishPartnerAvailability(false),undefined,'polling must not await the decision queue');
 await c.ready();assert.equal(c.metrics().calls-before,2,'one publication plus the verification barrier');
 c.publishPartnerAvailability(true);await c.ready();assert.equal(c.metrics().calls-before,4,'a changed availability is delivered');
});

test('an accepted resuming postgame command clears the previous dependency wait',async t=>{
 const {createPostgameClient}=await import('../src/suite/postgame-client.js');
 const args={world:{data:{maps:[],wildEncounters:[]}},story:{data:{scripts:[]}},mechanics:{data:{species:[]}}};
 const c=createPostgameClient(args);t.after(()=>c.close());c.wait('Waiting for a dependency.');await c.ready();assert.equal(c.state().status,'waiting');
 await c.beginAdventure();assert.equal(c.state().status,'running','the acknowledged owner resume must release the old host wait');
});

test('a failed resuming command and a newer pause both retain host control',async t=>{
 const dir=mkdtempSync(join(tmpdir(),'suite-resuming-command-'));t.after(()=>rmSync(dir,{recursive:true,force:true}));
 const file=join(dir,'planner.mjs');writeFileSync(file,`export function createPostgameController(){let status='running';return {state:()=>({status}),storyWatch:()=>({flags:[]}),wait:()=>{status='waiting'},beginAdventure:(fail)=>{if(fail)throw Error('Owned transaction cannot yield');const until=Date.now()+150;while(Date.now()<until){};status='running'}}}`);
 const c=createPlannerClient({kind:'postgame',module:pathToFileURL(file).href,options:{},snapshot:{state:{},storyWatch:{}},resumingCommands:['beginAdventure']});t.after(()=>c.close());
 c.wait('Original wait');await c.ready();await assert.rejects(c.command('beginAdventure',true),/cannot yield/);assert.equal(c.state().reason,'Original wait');
 const pending=c.command('beginAdventure',false);await new Promise(r=>setTimeout(r,25));c.wait('Newer user pause');await pending;
 assert.equal(c.state().status,'waiting');assert.equal(c.state().reason,'Newer user pause');await c.ready();assert.equal(c.state().status,'waiting');
});
