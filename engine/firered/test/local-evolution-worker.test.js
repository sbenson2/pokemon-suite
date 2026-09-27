import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,mkdirSync,writeFileSync,readFileSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {createLocalEvolutionWorker,checkpointLocalEvolution} from '../src/suite/local-evolution-worker.js';
import {SaveVault} from '../src/suite/save-vault.js';
import {createNativeLocalLink} from '../src/suite/native-local-link.js';
import {setTimeout as sleep} from 'node:timers/promises';

function fixture(t,phase){
 const directory=mkdtempSync(join(tmpdir(),'evolution-peer-'));t.after(()=>rmSync(directory,{recursive:true,force:true}));
 mkdirSync(join(directory,'emerald'));
 const peer=enabled=>writeFileSync(join(directory,'emerald','status.json'),JSON.stringify({game:'emerald',bot:{enabled}}));peer(false);
 const worker=createLocalEvolutionWorker({game:'firered',config:{directory},state:{requestId:'peer-recovery',phase},hooks:{enabled:()=>true,finishEngine(){},persist(){},progress(){}}});
 return {worker,peer};
}
test('a cleared completed exchange stays cleared through a later hunt checkpoint and restart',async t=>{
 const directory=mkdtempSync(join(tmpdir(),'evolution-checkpoint-'));t.after(()=>rmSync(directory,{recursive:true,force:true}));
 const loaded={requestId:'old-golem',phase:'reconciling'};
 const worker=createLocalEvolutionWorker({game:'firered',config:{directory},state:{...loaded,phase:'complete'},hooks:{
  enabled:()=>true,fireRedState:()=>({evolution:{requestId:'new-clefairy'},preparation:{phase:'preparing'}}),
 }});
 await worker.poll();assert.equal(worker.state(),null);
 const vault=new SaveVault(join(directory,'saves'),{game:'firered'});
 vault.write(Buffer.from('current Cycling Road state'),Buffer.from('current native save'),{
  localEvolution:checkpointLocalEvolution(worker,loaded),
 });
 const restarted=createLocalEvolutionWorker({game:'firered',config:{directory},state:vault.read().metadata.localEvolution,hooks:{}});
 assert.equal(restarted.status(),null,'restarting a later hunt must not resurrect the earlier link recovery');
 assert.equal(restarted.busy(),false);
});

test('an early checkpoint preserves an unfinished exchange before the local worker is initialized',()=>{
 const loaded={requestId:'current-exchange',phase:'trading',pairId:'same-pair'};
 assert.deepEqual(checkpointLocalEvolution(null,loaded),loaded);
});
test('an unlinked evolution waits for a stopped companion and automatically resumes the same reservation',async t=>{
 const {worker,peer}=fixture(t,'waiting-for-evolution');
 await worker.poll();assert.equal(worker.state().phase,'waiting-for-peer');
 await worker.poll();assert.equal(worker.state().peerPausedPhase,'waiting-for-evolution');
 peer(true);await worker.poll();assert.equal(worker.state().phase,'waiting-for-evolution');
 assert.equal(worker.state().requestId,'peer-recovery');assert.equal(worker.state().reason,null);
});
test('a user pause during the peer wait retains the original unlinked phase',async t=>{
 const {worker,peer}=fixture(t,'waiting-for-evolution');
 await worker.poll();await worker.stop('User paused the Suite.');worker.resume();
 peer(true);await worker.poll();assert.equal(worker.state().phase,'waiting-for-evolution');
});
test('an interrupted exchange still requires reconciliation instead of starting another trade',async t=>{
 const {worker,peer}=fixture(t,'trading');
 await worker.poll();assert.equal(worker.state().phase,'waiting');
 peer(true);await worker.poll();assert.equal(worker.state().phase,'waiting');
 assert.match(worker.state().reason,/reconcil/i);
});

test('resuming a blocked exchange retains the actual reason for reconciliation',async t=>{
 const {worker}=fixture(t,'trading');await worker.poll();const reason=worker.state().reason;
 await worker.stop('Stopped by you.');worker.resume();
 assert.equal(worker.state().phase,'waiting');assert.equal(worker.state().reason,reason);
});

test('pausing and resuming a live paired trade keeps its authenticated link and resumes game execution',async t=>{
 const directory=mkdtempSync(join(tmpdir(),'evolution-pause-'));t.after(()=>rmSync(directory,{recursive:true,force:true}));
 for(const name of ['emerald','evolution-pairs'])mkdirSync(join(directory,name));
 const source={validity:'valid',species:75,personality:1,otId:2,ivs:{hp:1,attack:2,defense:3,speed:4,spAttack:5,spDefense:6}},fingerprint='[75,1,2,1,2,3,4,5,6]';
 const pair={requestId:'pause-test',pairId:'old-pair',leg:'outbound',phase:'connecting',center:'MAP_CENTER_1F',leaderTrainerId:2,reservation:{source,sourceFingerprint:fingerprint,partnerFingerprint:'[385,7,8,1,2,3,4,5,6]'}};
 const proof=game=>({game,requestId:pair.requestId,pairId:pair.pairId,leg:pair.leg,outcome:'not-committed',nativeSaveVerified:true,savedSramSha256:'a'.repeat(64)});
 const peer=enabled=>writeFileSync(join(directory,'emerald','status.json'),JSON.stringify({game:'emerald',bot:{enabled},localEvolution:{phase:'reconciling',restartProof:proof('emerald')}}));peer(true);
 writeFileSync(join(directory,'evolution-pairs','pause-test.json'),JSON.stringify(pair));
 const peripheral=()=>({status:()=>({attached:true,epoch:1,dropped:0,mode:0}),subscribe:()=>()=>{},receive(){}});
 let release=null,starts=0,observes=0;
 const worker=createLocalEvolutionWorker({game:'firered',config:{directory},coreManifest:{native_rfu:true},session:{readMemory:()=>Uint8Array.of(0),attachWireless:peripheral},
  inputs:{runtime:{data:{symbols:{gWirelessCommType:{address:1},gReceivedRemoteLinkPlayers:{address:2}}}},world:{data:{maps:[{id:'MAP_CENTER_2F',objectEvents:[{script:'Common_EventScript_DirectCornerAttendant',x:9,y:2}]}]}}},
  state:{requestId:pair.requestId,pairId:pair.pairId,leg:'outbound',phase:'reconciling',restartProof:proof('firered')},
  hooks:{enabled:()=>true,
   observe:()=>({playerMemory:{trainer:{party:[source],partyValidity:++observes===1?'valid':'unknown'}}}),
   pause:async()=>{},persist(){},progress(){},startEngine(){starts++;},
   finishEngine(){release?.();release=null;},
   engine:()=>({execute:()=>new Promise(resolve=>{release=resolve;})})}});
 t.after(()=>worker.stop('Test ended',{shutdown:true}));
 await worker.poll();const next=JSON.parse(readFileSync(join(directory,'evolution-pairs','pause-test.json')));
 const guest=await createNativeLocalLink({role:'guest',game:'emerald',peerGame:'firered',pairId:next.pairId,token:next.token,port:next.port,peripheral:peripheral()});t.after(()=>guest.close());
 for(let i=0;i<100&&!guest.status().available;i++)await sleep(10);
 await worker.poll();assert.equal(worker.state().phase,'trading');assert.equal(starts,1);
 await worker.stop('Stopped by you.');await sleep(20);
 assert.equal(guest.status().available,true,'Pausing game execution must not disconnect its partner');
 worker.resume();assert.equal(worker.state().phase,'trading');assert.equal(starts,2);
 peer(false);await worker.poll();assert.equal(worker.state().phase,'waiting-for-peer');assert.equal(guest.status().available,true);
 peer(true);await worker.poll();assert.equal(worker.state().phase,'trading');assert.equal(starts,3);
});
