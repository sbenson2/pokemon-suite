import assert from 'node:assert/strict';
import {mkdtempSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {setImmediate as yieldIO} from 'node:timers/promises';
import {createPostgameController,canYieldPostgame} from '../engine/firered/src/suite/postgame.js';
import {postgameChecklist,readPostgameEvidence,POSTGAME_WATCH} from '../engine/firered/src/suite/postgame-agenda.js';
import {createFireRedObserver} from '../engine/firered/src/evidence/fire-red-observer.js';
import {continueNativeSaveAsync} from '../engine/firered/src/suite/native-cold-boot.js';
import {encounterFingerprint} from '../engine/firered/src/player/encounter-tracker.js';
import {SaveVault,atomicJson} from '../engine/firered/src/suite/save-vault.js';

export async function replayLeagueRecord({session,saved,inputs,createSession,maxWallMs=900000}){
 const seed=structuredClone(saved.metadata.session.postgame);
 const originalReceipt=structuredClone(seed.agenda.workflows.league.receipt);
 assert.equal(originalReceipt.nativeSaveVerified,true,'start after a proven stronger League victory');
 let now=seed.watchdog?.lastAt??Date.now();
 const storyWatch=createPostgameController({...inputs,mechanics:inputs.battle,state:seed}).storyWatch();
 const observer=createFireRedObserver({session,...inputs,runId:'league-record',storyWatch});
 const capture=()=>{const raw=observer.capture();return {...raw,playerMemory:{...raw.playerMemory,postgameEvidence:readPostgameEvidence(session,inputs.runtime,raw)}};};
 let before=capture();for(let i=0;before.phase!=='stable'&&i<240;i++){session.step([]);before=capture();}
 assert.equal(canYieldPostgame(seed,before),true,'isolate this goal only at an unowned field boundary');
 // The isolated controller selects this agenda goal; all native counters,
 // original receipts, individuals and pre-existing failure records are kept.
 seed.objective=null;seed.player=null;seed.agenda.active='hall-sticker';seed.agenda.enabled=true;
 for(const e of postgameChecklist(before,seed.agenda.workflows))if(e.id!=='hall-sticker'){
  const old=seed.agenda.failures[e.id]??{};
  seed.agenda.failures[e.id]={...old,retryAt:Math.max(old.retryAt??0,now+86400000),reason:old.reason??'Other goals are deferred in the isolated Hall record replay.'};
 }
 const open=state=>createPostgameController({...inputs,mechanics:inputs.battle,state,clock:()=>now});
 let controller=open(seed);controller.resume();
 const root=process.env.SUITE_REPLAY_OUTPUT??mkdtempSync(join(tmpdir(),'suite-league-record-'));
 const ids=o=>[...o.playerMemory.trainer.party,...o.playerMemory.trainer.storage.pokemon].filter(p=>p.validity==='valid').map(encounterFingerprint).sort();
 const originalIds=ids(before),baseline=before.playerMemory.gameStats.leagueEntries,restarts=new Set(),until=Date.now()+maxWallMs;
 let last='',result,after;
 try{
  for(let n=0;n<90000&&Date.now()<until;n++){
   const o=capture(),m=o.playerMemory,d=controller.decide(o),s=controller.state(),record=s.agenda.workflows.records?.['hall-sticker'];
   const trace=JSON.stringify([m.map.id,s.objective?.id,o.emulator.mode,m.gameStats?.leagueEntries,m.storyState?.variableIds?.[0x4049],d.kind==='blocked'?d.reason:null]);
   if(trace!==last){console.log('# league-record '+o.frame+' '+trace);last=trace;}
   assert.notEqual(d.kind,'blocked',d.reason);
   assert.deepEqual(s.agenda.workflows.league.receipt,originalReceipt,'repeat runs preserve the first rematch receipt');
   const point=record?.claim?.save?.linkSave?'claim-save':o.emulator.inBattle?'repeat-battle':o.emulator.mode==='hall-of-fame'?'repeat-hall-of-fame':record?.cycle?'repeat-preparation':null;
   if(point&&!restarts.has(point)){controller=open(JSON.parse(JSON.stringify(s)));restarts.add(point);}
   const receipt=record?.lastRun??record?.cycle?.receipt;
   if(receipt?.nativeSaveVerified&&receipt.leagueEntries>baseline&&controller.canYield(o)){
    assert.deepEqual(ids(o),originalIds);assert.ok(restarts.has('repeat-battle')&&restarts.has('repeat-hall-of-fame'));
    if(baseline+1<200){
     assert.equal(record.lastRun?.leagueEntries,baseline+1);
     assert.equal(record.cycle?.baseline.leagueEntries,baseline+1,'the restarted agenda must schedule its next native run');
    }
    const cold=await createSession();
    try{
     cold.loadSram(session.saveSram());
     const reader=createFireRedObserver({session:cold,...inputs,runId:'league-record-cold',storyWatch:POSTGAME_WATCH});
     const loaded=await continueNativeSaveAsync(cold,reader);
     assert.equal(loaded.playerMemory.gameStats.leagueEntries,baseline+1);assert.deepEqual(ids(loaded),originalIds);
     assert.equal(loaded.playerMemory.storyState.variableIds[0x4049],m.storyState.variableIds[0x4049]);
    }finally{cold.close();}
    result={status:'passed',leagueBefore:baseline,leagueAfter:m.gameStats.leagueEntries,stickerLevel:m.storyState.variableIds[0x4049],receipt,restarts:[...restarts],coldContinue:true,originalIndividuals:originalIds.length};after=o;break;
   }
   const action=d.action??{buttons:[],holdFrames:8};
   for(let i=0;i<(action.holdFrames??1);i++){session.step(action.buttons??[]);now+=1000/60;}
   for(let i=0;i<(action.releaseFrames??0);i++){session.step([]);now+=1000/60;}
   if(n%100===0)await yieldIO();
  }
  assert.ok(result,`the repeated League run must return with its native victory saved within ${maxWallMs} ms`);
  console.log('# league-record verified '+JSON.stringify(result));return {before,after};
 }catch(error){result={status:'failed',error:error.stack};throw error;}
 finally{
  new SaveVault(root,saved.identity).write(session.saveState(),session.saveSram(),{...saved.metadata,frame:session.frame,reason:'league-record-replay',session:{...saved.metadata.session,postgame:controller.state()}});
  atomicJson(join(root,'result.json'),result??{status:'incomplete'});console.log('# retained '+root);
 }
}
