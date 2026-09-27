import assert from 'node:assert/strict';
import {setImmediate as yieldIO} from 'node:timers/promises';
import {createFireRedObserver} from '../engine/firered/src/evidence/fire-red-observer.js';
import {createPostgameController,canYieldPostgame} from '../engine/firered/src/suite/postgame.js';
import {postgameChecklist,readPostgameEvidence,resolvePostgameObjective} from '../engine/firered/src/suite/postgame-agenda.js';
import {selectOwnedBreeding} from '../engine/firered/src/suite/native-breeding.js';
import {continueNativeSaveAsync} from '../engine/firered/src/suite/native-cold-boot.js';
import {encounterFingerprint} from '../engine/firered/src/player/encounter-tracker.js';

const ids=o=>[...(o.playerMemory.trainer?.party??[]),...(o.playerMemory.trainer?.storage?.pokemon??[])]
 .filter(p=>p.validity==='valid').map(encounterFingerprint).sort();
const retainedIds=o=>[...ids(o),...(o.playerMemory.postgameEvidence?.acquisition?.daycare?.parents??[])
 .filter(p=>p.validity==='valid').map(encounterFingerprint)];
const party=o=>(o.playerMemory.trainer?.party??[]).filter(p=>p.validity==='valid').map(encounterFingerprint);

// `recordKind` is `egg-claim` or `egg-repeat`. The caller owns ROM integrity,
// session loading, and the independent cold session factory.
export async function replayPostgameRecords({session,saved,inputs,createSession,fixture={},maxWallMs=null}){
 const kind=fixture.recordKind??fixture.variant;
 assert.ok(['egg-claim','egg-repeat'].includes(kind),'Egg replay requires a claim or repeat fixture');
 const state=structuredClone(saved.metadata.session?.postgame??saved.metadata.postgame);
 assert.ok(state?.agenda?.enabled,'retain a post-League controller checkpoint');
 let now=Math.max(Date.now(),(state.agenda.failures?.['egg-sticker']?.retryAt??0)+1);
 const open=s=>createPostgameController({...inputs,mechanics:inputs.battle,state:s,clock:()=>now});
 const observer=createFireRedObserver({session,...inputs,runId:'egg-record-replay',storyWatch:open(state).storyWatch()});
 const capture=()=>{const raw=observer.capture();return {...raw,playerMemory:{...raw.playerMemory,postgameEvidence:readPostgameEvidence(session,inputs.runtime,raw)}};};
 observer.capture();const before=capture(),original=ids(before),originalParty=party(before),m=before.playerMemory;
 assert.equal(before.phase,'stable');assert.equal(m.trainer.partyValidity,'valid');assert.equal(m.trainer.storage.validity,'valid');
 assert.ok(m.trainer.money>=20000,'native daycare recovery reserve must exist before a repeat');
 if(kind==='egg-claim')assert.equal(m.storyState.variableIds[0x404a],0);
 else{
  assert.ok(m.storyState.variableIds[0x404a]>=1&&m.gameStats.eggsHatched>=1);
  assert.ok(selectOwnedBreeding({trainer:m.trainer,mechanics:inputs.battle,allowOwned:true}),'an owned-species pair must be available');
 }
 const first={eggs:m.gameStats.eggsHatched,sticker:m.storyState.variableIds[0x404a],savedGame:m.gameStats.savedGame};
 if(canYieldPostgame(state,before)){
  state.objective=null;state.player=null;state.pendingObjective=null;state.save=null;
  state.agenda.active=null;state.agenda.progress=null;state.agenda.semantic=null;state.agenda.failures??={};
 }else{
  assert.equal(kind,'egg-repeat','only a saved claim may still own a transaction at the repeat seed');
  assert.ok(state.agenda.workflows?.records?.['egg-sticker']?.claim?.save?.linkSave||state.acquisition?.phase==='saving',
   'continue the retained Egg claim or acquisition save without clearing its native receipt');
 }
 // The retained fixture records finite cooldowns for other goals. Re-defer them
 // against this run's clock so an expired fixture retryAt cannot outrank the
 // retained Egg transaction; no engine deadline or assertion is weakened.
 state.agenda.failures??={};
 for(const entry of postgameChecklist(before,state.agenda.workflows))if(entry.id!=='egg-sticker'&&entry.status!=='complete'){
  const old=state.agenda.failures[entry.id]??{};
  state.agenda.failures[entry.id]={...old,retryAt:now+86400000,reason:old.reason??'Other goals are deferred in this isolated Egg replay.'};
 }
 let controller=open(state);controller.resume();
 const deadline=Date.now()+(maxWallMs??(kind==='egg-claim'?180000:600000));
 let result=null,after=null,last='',progressSave=null;
 for(let i=0;i<100000&&Date.now()<deadline;i++){
  now=Math.max(now,Date.now());
  const o=capture(),mem=o.playerMemory,d=controller.decide(o),work=controller.state();
  const eggs=mem.gameStats?.eggsHatched,sticker=mem.storyState?.variableIds?.[0x404a],saves=mem.gameStats?.savedGame;
  const progressed=kind==='egg-claim'?sticker>first.sticker:eggs>first.eggs;
  if(progressed&&progressSave===null)progressSave=saves;
  const trace=JSON.stringify([mem.map?.id,work.objective?.id,work.acquisition?.phase,eggs,sticker,saves,d.kind==='blocked'?d.reason:null]);
  if(trace!==last){console.log('# egg-record '+o.frame+' '+trace);last=trace;}
  assert.notEqual(d.kind,'blocked',d.reason);
  if(o.phase==='stable'&&mem.trainer?.partyValidity==='valid'&&mem.trainer?.storage?.validity==='valid'&&
     (work.acquisition?.phase==='preparing'||mem.postgameEvidence?.acquisition?.daycare?.validity==='valid'))
   assert.ok(original.every(id=>retainedIds(o).includes(id)),'original individuals remain in party, PC, or native daycare');
  const restored=kind==='egg-claim'||JSON.stringify(party(o).sort())===JSON.stringify([...originalParty].sort());
  if(progressed&&saves>progressSave&&restored&&o.phase==='stable'&&mem.trainer.partyValidity==='valid'&&mem.trainer.storage.validity==='valid'){
   const cold=await createSession();
   try{
    cold.loadSram(session.saveSram());
    const reader=createFireRedObserver({session:cold,...inputs,runId:'egg-record-cold',storyWatch:controller.storyWatch()});
    const native=await continueNativeSaveAsync(cold,reader);
    assert.equal(native.playerMemory.gameStats.eggsHatched,eggs);
    assert.equal(native.playerMemory.storyState.variableIds[0x404a],sticker);
    assert.ok(original.every(id=>ids(native).includes(id)));
    if(kind==='egg-repeat')assert.deepEqual(party(native).sort(),[...originalParty].sort(),'the original battle roster returns after breeding');
    controller=open(JSON.parse(JSON.stringify(work)));controller.resume();
    let next=null,handoffObservation=o;
    if(kind==='egg-repeat'){
     const handoffUntil=Date.now()+30000;
     for(let j=0;j<5000&&Date.now()<handoffUntil;j++){
      now=Math.max(now,Date.now());
      const decision=controller.decide(handoffObservation);
      assert.notEqual(decision.kind,'blocked',decision.reason);
      if(decision.kind==='acquisition-saved'){controller.acknowledgeAcquisition();continue;}
      if(decision.kind==='postgame-acquisition-started'){
       next=controller.state().acquisition;
       assert.equal(next?.kind,'breeding');break;
      }
      const action=decision.action??{buttons:[],holdFrames:8};
      for(let k=0;k<(action.holdFrames??1);k++)session.step(action.buttons??[]);
      for(let k=0;k<(action.releaseFrames??0);k++)session.step([]);
      handoffObservation=capture();if(j%100===0)await yieldIO();
     }
     assert.ok(next,'a restarted controller must schedule the next owned hatch');
    }else{
     controller.decide(o);
     next=resolvePostgameObjective('egg-sticker',o,inputs.world,
      structuredClone(controller.state().agenda.workflows??{}),{mechanics:inputs.battle});
    }
    result={status:'passed',kind,eggsBefore:first.eggs,eggsAfter:eggs,stickerBefore:first.sticker,stickerAfter:sticker,
     savedGameBefore:first.savedGame,savedGameAfter:saves,originalIndividuals:original.length,
     individualsAfter:ids(o).length,rosterRestored:restored,coldContinue:true,next:next?.requestId??next?.id??null};
    after=o;break;
   }finally{cold.close();}
  }
  if(d.kind==='acquisition-saved'){controller.acknowledgeAcquisition();continue;}
  if(d.kind==='capture-saved'){controller.acknowledgeCapture();continue;}
  if(d.kind==='postgame-acquisition-started')continue;
  assert.ok(!['postgame-hunt','postgame-evolution-started'].includes(d.kind),'Egg replay selected unrelated work');
  const action=d.action??{buttons:[],holdFrames:8};
  for(let j=0;j<(action.holdFrames??1);j++)session.step(action.buttons??[]);
  for(let j=0;j<(action.releaseFrames??0);j++)session.step([]);
  if(i%100===0)await yieldIO();
 }
 assert.ok(result,`Egg ${kind} did not gain, save, and cold-verify native progress within its deadline`);
 console.log('# egg-record verified '+JSON.stringify(result));return {before,after,state:controller.state()};
}
