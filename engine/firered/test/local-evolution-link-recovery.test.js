import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,mkdirSync,writeFileSync,readFileSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {setTimeout as sleep} from 'node:timers/promises';
import {createLocalEvolutionWorker} from '../src/suite/local-evolution-worker.js';
import {createNativeLocalLink} from '../src/suite/native-local-link.js';

// September 23 (gate 105): the FireRed partner's native RFU receive FIFO
// overflowed while both owners were still in the trade menu. The overflow
// stop stays; before the exchange starts, the owner cold-boots its unchanged
// native save, proves the original party and trade count, and waits for the
// other owner's proof so the source can retry the leg (at most three times).
const MAP='MAP_LAVENDER_TOWN_POKEMON_CENTER_2F',CENTER='MAP_LAVENDER_TOWN_POKEMON_CENTER_1F';
const world={data:{maps:[{id:MAP,objectEvents:[{script:'Common_EventScript_DirectCornerAttendant',x:10,y:2}]}]}};
const ivs={hp:1,attack:2,defense:3,speed:4,spAttack:5,spDefense:6};
const source={validity:'valid',species:75,personality:1,otId:2,ivs},other={validity:'valid',species:22,personality:9,otId:2,ivs};
const fingerprint='[75,1,2,1,2,3,4,5,6]';
// Native memory the wireless reader uses: adapter present, no remote players,
// and GAME_STAT_POKEMON_TRADES = 7 behind the save-block encryption key.
const KEY=0x1234abcd,symbols={gWirelessCommType:{address:0x03000000},gReceivedRemoteLinkPlayers:{address:0x03000010},gSaveBlock1Ptr:{address:0x03000020},gSaveBlock2Ptr:{address:0x03000030}};
const structures={SaveBlock1:{fields:{gameStats:{offset:0x100}}},SaveBlock2:{fields:{encryptionKey:{offset:0x10}}}};
const le=n=>{const b=Buffer.alloc(4);b.writeUInt32LE(n>>>0);return Uint8Array.from(b);};
const memory=new Map([[0x03000000,Uint8Array.of(1)],[0x03000010,Uint8Array.of(0)],[0x03000020,le(0x02000000)],[0x03000030,le(0x02010000)],[0x02000000+0x100+21*4,le(7^KEY)],[0x02010000+0x10,le(KEY)]]);
const session={readMemory:(address,size)=>memory.get(address)?.slice(0,size)??new Uint8Array(size)};
const inputs={runtime:{data:{symbols,structures}},world};
const peripheral=(mode=1)=>({status:()=>({attached:true,epoch:1,dropped:0,mode}),subscribe:()=>()=>{},receive(){}});
const atCounter=(callback2='CB2_Overworld',party=[source,other])=>({frame:1,phase:'stable',emulator:{mode:'overworld',callback2},
 playerMemory:{map:{id:MAP},position:{x:10,y:4},ui:{},scripts:{},trainer:{trainerId:2,partyValidity:'valid',party}}});
const coldBoot=(party=[source,other],tradeCount=7)=>({observation:atCounter('CB2_Overworld',party),wireless:{validity:'valid',remotePlayers:0,tradeCount},sramSha256:'b'.repeat(64)});
const OVERFLOW='Native wireless queue overflowed; stop the link.';

async function trading(t,{observe=()=>atCounter(),execute,restartNative,restarts=0}={}){
 const directory=mkdtempSync(join(tmpdir(),'evolution-link-recovery-'));t.after(()=>rmSync(directory,{recursive:true,force:true}));
 for(const name of ['emerald','evolution-pairs'])mkdirSync(join(directory,name));
 const pair={requestId:'overflow-test',pairId:'old-pair',leg:'outbound',phase:'connecting',center:CENTER,leaderTrainerId:2,restarts,
  reservation:{source,sourceFingerprint:fingerprint,partnerFingerprint:'[385,7,8,1,2,3,4,5,6]'}};
 const proof=game=>({game,requestId:pair.requestId,pairId:pair.pairId,leg:pair.leg,outcome:'not-committed',nativeSaveVerified:true,savedSramSha256:'a'.repeat(64)});
 writeFileSync(join(directory,'emerald','status.json'),JSON.stringify({game:'emerald',bot:{enabled:true},localEvolution:{phase:'reconciling',restartProof:proof('emerald')}}));
 writeFileSync(join(directory,'evolution-pairs','overflow-test.json'),JSON.stringify(pair));
 const calls={restarts:0,finished:[],persisted:[]};
 const worker=createLocalEvolutionWorker({game:'firered',config:{directory},coreManifest:{native_rfu:true},session:{...session,attachWireless:()=>peripheral()},inputs,
  state:{requestId:pair.requestId,pairId:pair.pairId,leg:'outbound',phase:'reconciling',restartProof:proof('firered')},
  hooks:{enabled:()=>true,observe,pause:async()=>{},persist:reason=>calls.persisted.push(reason),progress(){},startEngine(){},
   finishEngine:reason=>calls.finished.push(reason),engine:()=>({execute}),
   ...(restartNative?{restartNative:async reason=>{calls.restarts++;calls.reason=reason;return restartNative();}}:{})}});
 t.after(()=>worker.stop('Test ended',{shutdown:true}));
 await worker.poll();
 const next=JSON.parse(readFileSync(join(directory,'evolution-pairs','overflow-test.json')));
 const guest=await createNativeLocalLink({role:'guest',game:'emerald',peerGame:'firered',pairId:next.pairId,token:next.token,port:next.port,peripheral:peripheral(3)});t.after(()=>guest.close());
 for(let i=0;i<100&&!guest.status().available;i++)await sleep(10);
 await worker.poll();
 return {worker,guest,calls,directory};
}
async function settle(worker,phases){for(let i=0;i<200&&!phases.includes(worker.state()?.phase);i++)await sleep(10);}

test('a native wireless overflow before the exchange starts cold-boots and proves the uncommitted save instead of stopping for good',async t=>{
 let first=true;
 const {worker,guest,calls}=await trading(t,{
  execute:()=>first?(first=false,Promise.reject(Error(OVERFLOW))):new Promise(()=>{}),
  restartNative:()=>coldBoot()});
 await settle(worker,['reconciling','waiting']);
 const state=worker.state();
 assert.equal(state.phase,'reconciling',state.reason);
 assert.equal(calls.restarts,1,'the owner restarts its own native game once');
 assert.match(calls.reason,/overflowed/);
 assert.equal(state.restartProof.outcome,'not-committed');
 assert.equal(state.restartProof.pairId,state.pairId);
 assert.equal(state.restartProof.tradeCount,7);
 assert.equal(state.restartProof.savedSramSha256,'b'.repeat(64));
 assert.ok(calls.finished.length>0,'game execution stopped before the restart');
 await settle({state:()=>({phase:guest.status().reason?'closed':'open'})},['closed']);
 assert.ok(guest.status().reason,'the failed link is closed so the other owner reconciles too');
});

test('an overflow after the exchange started keeps the preserving stop and never restarts the game',async t=>{
 let first=true;
 const {worker,calls}=await trading(t,{observe:()=>atCounter('CB2_LinkTrade'),
  execute:()=>first?(first=false,Promise.reject(Error(OVERFLOW))):new Promise(()=>{}),
  restartNative:()=>coldBoot()});
 await settle(worker,['reconciling','waiting']);
 assert.equal(worker.state().phase,'waiting');
 assert.match(worker.state().reason,/overflowed/);
 assert.equal(calls.restarts,0);
 assert.equal(worker.state().trade.exchangeStarted,true);
});

test('the other owner\'s link failure before the exchange also restarts and proves instead of waiting for a manual restart',async t=>{
 const {worker,guest,calls}=await trading(t,{execute:()=>sleep(5).then(()=>({})),restartNative:()=>coldBoot()});
 await sleep(30);assert.equal(worker.state().phase,'trading');
 guest.close();
 await settle(worker,['reconciling','waiting']);
 assert.equal(worker.state().phase,'reconciling',worker.state().reason);
 assert.equal(calls.restarts,1);
 assert.match(calls.reason,/partner disconnected/);
});

test('a cold boot that does not hold the original party and trade count stays stopped for review',async t=>{
 for(const [label,boot] of [['party',coldBoot([other,source])],['trade count',coldBoot(undefined,8)]]){
  let first=true;
  const {worker,calls}=await trading(t,{execute:()=>first?(first=false,Promise.reject(Error(OVERFLOW))):new Promise(()=>{}),restartNative:()=>boot});
  await settle(worker,['reconciling','waiting']);
  assert.equal(worker.state().phase,'waiting',label);
  assert.equal(worker.state().restartProof??null,null,label);
  assert.equal(calls.restarts,1,label);
 }
});

test('a user pause while the owner restarts keeps the pause and resumes into reconciliation',async t=>{
 let first=true,release;
 const booted=new Promise(resolve=>{release=resolve;});
 const {worker}=await trading(t,{execute:()=>first?(first=false,Promise.reject(Error(OVERFLOW))):new Promise(()=>{}),restartNative:()=>booted.then(()=>coldBoot())});
 await sleep(20);
 const stopping=worker.stop('Stopped by you.');release();await stopping;
 assert.equal(worker.state().phase,'paused');assert.equal(worker.state().pausedPhase,'reconciling');
 assert.equal(worker.state().restartProof.outcome,'not-committed');
 worker.resume();assert.equal(worker.state().phase,'reconciling');
});

test('verified retries are bounded: the fourth attempt stops for review instead of reopening the link',async t=>{
 let first=true;
 const directory=mkdtempSync(join(tmpdir(),'evolution-link-bounded-'));t.after(()=>rmSync(directory,{recursive:true,force:true}));
 for(const name of ['emerald','evolution-pairs'])mkdirSync(join(directory,name));
 const pair={requestId:'bounded',pairId:'third-pair',leg:'outbound',phase:'connecting',center:CENTER,leaderTrainerId:2,restarts:3,reservation:{source,sourceFingerprint:fingerprint,partnerFingerprint:'[385,7,8,1,2,3,4,5,6]'}};
 const proof=game=>({game,requestId:pair.requestId,pairId:pair.pairId,leg:pair.leg,outcome:'not-committed',nativeSaveVerified:true,savedSramSha256:'a'.repeat(64)});
 writeFileSync(join(directory,'emerald','status.json'),JSON.stringify({game:'emerald',bot:{enabled:true},localEvolution:{phase:'reconciling',restartProof:proof('emerald')}}));
 writeFileSync(join(directory,'evolution-pairs','bounded.json'),JSON.stringify(pair));
 const worker=createLocalEvolutionWorker({game:'firered',config:{directory},coreManifest:{native_rfu:true},session:{...session,attachWireless:()=>peripheral()},inputs,
  state:{requestId:pair.requestId,pairId:pair.pairId,leg:'outbound',phase:'reconciling',restartProof:proof('firered')},
  hooks:{enabled:()=>true,observe:()=>atCounter(),pause:async()=>{},persist(){},progress(){},startEngine(){},finishEngine(){},
   engine:()=>({execute:()=>first?(first=false,Promise.reject(Error(OVERFLOW))):new Promise(()=>{})}),restartNative:async()=>coldBoot()}});
 t.after(()=>worker.stop('Test ended',{shutdown:true}));
 await worker.poll();
 assert.equal(worker.state().phase,'waiting');
 assert.match(worker.state().reason,/three verified retries/);
 assert.equal(JSON.parse(readFileSync(join(directory,'evolution-pairs','bounded.json'))).pairId,'third-pair','no fourth link is opened');
});

// Both FireRed owners in one process: the partner's FIFO overflows in the
// trade menu, both owners restart and prove their saves in-process, and the
// source reopens the same leg once with both proofs as evidence.
test('two FireRed owners recover an overflow before the exchange and retry the same leg once',async t=>{
 const {FireRedEvolutionTask,selectTeamPartnerEvolution}=await import('../src/suite/fire-red-evolution.js');
 const {partnerHoldings}=await import('../src/suite/local-evolution.js');
 const mon=(species,personality,extra={})=>({validity:'valid',species,personality,otId:10,shiny:false,isEgg:false,heldItem:0,level:70,moves:[84],ivs,...extra});
 const machoke=mon(67,2,{level:93}),placeholder=mon(82,500,{otId:2161188857}),blastoise=mon(9,501,{otId:2161188857,moves:[57]});
 const sourceParty=[mon(22,1),machoke],partnerParty=[blastoise,placeholder];
 const directory=mkdtempSync(join(tmpdir(),'firered-pair-recovery-'));t.after(()=>rmSync(directory,{recursive:true,force:true}));
 for(const name of ['firered','firered-partner','core'])mkdirSync(join(directory,name));
 writeFileSync(join(directory,'core','build-manifest.json'),JSON.stringify({native_rfu:true}));
 const config={directory,games:{firered:{core:join(directory,'core')},'firered-partner':{title:'firered',role:'partner',core:join(directory,'core')}}};
 const route=selectTeamPartnerEvolution({trainer:{partyValidity:'valid',party:sourceParty,storage:{validity:'valid',pokemon:[]},bag:{}},partnerAvailable:{available:true,partners:[{owner:'firered-partner',title:'firered'}]},teamPlan:{permanentFamilies:[[66,67,68],[21,22]]}});
 const evolution=new FireRedEvolutionTask(route).state;
 const partnerTrainer={trainerId:8185,partyValidity:'valid',party:partnerParty,storage:{validity:'valid',pokemon:[]}};
 const preparation={requestId:route.requestId,owner:'firered-partner',sourceOwner:'firered',phase:'ready-for-transfer',center:CENTER,trainerId:8185,pokedex:true,nationalDex:true,transferCandidate:placeholder,holdings:partnerHoldings(partnerTrainer)};
 const workers={},restarts={firered:0,'firered-partner':0};
 let ended=false;
 const publish=owner=>{if(!ended)writeFileSync(join(directory,owner,'status.json'),JSON.stringify({game:'firered',owner,bot:{enabled:true,...(owner==='firered-partner'?{preparation}:{})},localEvolution:workers[owner]?.status()??null}));};
 const view=(trainerId,party,extra={})=>{const o=atCounter('CB2_Overworld',party);o.playerMemory.trainer={...o.playerMemory.trainer,trainerId,storage:{validity:'valid',pokemon:[]}};Object.assign(o.playerMemory,extra);return o;};
 let failPartner=false;
 const hooks=(owner,extra)=>({enabled:()=>true,pause:async()=>{},persist:()=>publish(owner),progress:()=>publish(owner),startEngine(){},finishEngine(){},
  engine:()=>({execute:()=>owner==='firered-partner'&&failPartner?(failPartner=false,Promise.reject(Error(OVERFLOW))):sleep(2).then(()=>({}))}),
  restartNative:async()=>{restarts[owner]++;const boot=coldBoot(owner==='firered'?sourceParty:partnerParty);boot.observation=view(owner==='firered'?10933:8185,owner==='firered'?sourceParty:partnerParty);boot.sramSha256=(owner==='firered'?'c':'d').repeat(64);return boot;},...extra});
 const fakeSession={...session,attachWireless:()=>peripheral(1)};
 workers.firered=createLocalEvolutionWorker({game:'firered',owner:'firered',role:'source',config,session:fakeSession,coreManifest:{native_rfu:true},inputs,hooks:hooks('firered',{
  observe:()=>view(10933,sourceParty,{storyState:{flagIds:{2092:true,2112:true}}}),
  fireRedState:()=>({dexEvolution:evolution,preparation:{phase:'waiting-for-transfer',tradePreparation:{pokemon:machoke,center:CENTER}}})})});
 workers['firered-partner']=createLocalEvolutionWorker({game:'firered',owner:'firered-partner',role:'partner',config,session:fakeSession,coreManifest:{native_rfu:true},inputs,hooks:hooks('firered-partner',{
  observe:()=>view(8185,partnerParty),companionState:()=>preparation})});
 t.after(async()=>{ended=true;for(const w of Object.values(workers))await w.stop('Test ended',{shutdown:true});});
 publish('firered');publish('firered-partner');
 const pairPath=join(directory,'evolution-pairs',`${route.requestId}.json`);
 const until=async(check,label)=>{for(let i=0;i<400;i++){if(check())return;await workers.firered.poll();await workers['firered-partner'].poll();publish('firered');publish('firered-partner');await sleep(5);}assert.fail(label+' '+JSON.stringify(Object.fromEntries(Object.entries(workers).map(([k,w])=>[k,w.status()]))));};
 await until(()=>workers.firered.state()?.phase==='trading'&&workers['firered-partner'].state()?.phase==='trading','both owners trade');
 const first=JSON.parse(readFileSync(pairPath));
 failPartner=true;
 await until(()=>JSON.parse(readFileSync(pairPath)).restarts===1,'the source reopens the leg once');
 const retried=JSON.parse(readFileSync(pairPath));
 assert.equal(retried.previousPairId,first.pairId);assert.notEqual(retried.pairId,first.pairId);assert.equal(retried.leg,'outbound');
 assert.equal(retried.restartEvidence.source.savedSramSha256,'c'.repeat(64));assert.equal(retried.restartEvidence.partner.savedSramSha256,'d'.repeat(64));
 assert.deepEqual(restarts,{firered:1,'firered-partner':1},'each owner restarted its own game once');
 await until(()=>workers.firered.state()?.phase==='trading'&&workers['firered-partner'].state()?.phase==='trading'&&workers['firered-partner'].state().pairId===retried.pairId,'both owners trade the retried leg');
});
