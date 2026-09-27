import assert from 'node:assert/strict';
import {setImmediate as yieldIO} from 'node:timers/promises';
import {createFireRedObserver} from '../engine/firered/src/evidence/fire-red-observer.js';
import {createPostgameController,canYieldPostgame} from '../engine/firered/src/suite/postgame.js';
import {postgameChecklist,readPostgameEvidence} from '../engine/firered/src/suite/postgame-agenda.js';
import {selectFameChecker} from '../engine/firered/src/suite/postgame-collection-extras.js';
import {continueNativeSaveAsync} from '../engine/firered/src/suite/native-cold-boot.js';
import {encounterFingerprint} from '../engine/firered/src/player/encounter-tracker.js';

const facts=o=>o.playerMemory.postgameEvidence?.fameChecker?.reduce((n,p)=>n+p.entries.toString(2).replaceAll('0','').length,0)??null;
const individuals=o=>[...(o.playerMemory.trainer?.party??[]),...(o.playerMemory.trainer?.storage?.pokemon??[])]
 .filter(p=>p.validity==='valid').map(encounterFingerprint).sort();
const party=o=>(o.playerMemory.trainer?.party??[]).filter(p=>p.validity==='valid').map(encounterFingerprint);

// The corpus supplies a ROM-verified, already-loaded session and an independent
// session factory. This runner performs only native controls and native reads.
export async function replayFameChecker({session,saved,inputs,createSession,fixture={}}){
 const variant=fixture.fameCase??fixture.variant??'fact';
 const expectFact=Array.isArray(fixture.expectFact)?fixture.expectFact:null;
 if(expectFact)assert.ok(variant==='fact'&&expectFact.length===2&&expectFact.every(Number.isInteger),'expectFact is [person, index] for a fact case');
 assert.ok(['fact','cut-sign','togetic-comment','cut-gym-trainer'].includes(variant),'Fame replay requires a fact, cut-sign, cut-gym-trainer, or Togetic-comment fixture');
 let state=structuredClone(saved.metadata.session?.postgame??saved.metadata.postgame);
 assert.ok(state?.agenda?.enabled,'retain a post-League controller checkpoint');
 const signKey='MAP_CELADON_CITY:background:7',togeticKey='MAP_FIVE_ISLAND_WATER_LABYRINTH:object:0',tamiaKey='MAP_CELADON_CITY_GYM:object:3';
 let now=Math.max(Date.now(),(state.agenda.failures?.['fame-checker']?.retryAt??0)+1,
  (state.agenda.workflows?.fame?.failed?.[signKey]?.retryAt??0)+1,
  (state.agenda.workflows?.fame?.failed?.[togeticKey]?.retryAt??0)+1,
  (state.agenda.workflows?.fame?.failed?.[tamiaKey]?.retryAt??0)+1);
 const open=s=>createPostgameController({...inputs,mechanics:inputs.battle,state:s,clock:()=>now});
 const probe=open(state),observer=createFireRedObserver({session,...inputs,runId:'fame-checker-replay',storyWatch:probe.storyWatch()});
 const capture=()=>{const raw=observer.capture();return {...raw,playerMemory:{...raw.playerMemory,postgameEvidence:readPostgameEvidence(session,inputs.runtime,raw)}};};
 observer.capture();let before=capture();
 // A retained checkpoint may be inside the success menu of an already-owned
 // native save, or (the live Sept 25 Pewter save) inside the field dialog of the
 // interrupted objective. Let its own controller finish that interaction before
 // isolating another source; the yield boundary below is still required.
 if(!canYieldPostgame(state,before)){
  const settled=open(state),until=Date.now()+30000;
  for(let i=0;i<1200&&Date.now()<until&&!canYieldPostgame(settled.state(),before);i++){
   now=Math.max(now,Date.now());
   const d=settled.decide(before);assert.notEqual(d.kind,'blocked',d.reason);
   const action=d.action??{buttons:[],holdFrames:8};
   for(let j=0;j<(action.holdFrames??1);j++)session.step(action.buttons??[]);
   for(let j=0;j<(action.releaseFrames??0);j++)session.step([]);
   before=capture();if(i%100===0)await yieldIO();
  }
  state=settled.state();
 }
 assert.equal(canYieldPostgame(state,before),true,'isolate Fame only at an unowned native field boundary');
 assert.equal(before.playerMemory.postgameEvidence?.fameChecker?.length,16);
 const original=individuals(before),originalParty=party(before),first=facts(before),firstSave=before.playerMemory.gameStats.savedGame;
 state.objective=null;state.player=null;state.pendingObjective=null;state.save=null;state.agenda.active='fame-checker';
 state.agenda.progress=null;state.agenda.semantic=null;state.agenda.failures??={};state.agenda.workflows??={};
 const fame=state.agenda.workflows.fame??={};
 if(variant==='fact'&&fixture.targetKey)fame.active=fixture.targetKey;
 if(variant==='cut-sign'){
  fame.active=signKey;
  assert.equal(first,27,'Cut fixture starts before the Celadon Gym sign fact');
  assert.equal(before.playerMemory.trainer.storage.pokemon.some(p=>p.validity==='valid'&&p.moves?.includes(15)),true);
 }
 // Live Sept 23: Tamia (Erika fact bit 3) failed twice with "No executable route";
 // the Celadon Gym yard is behind a Cut tree and no party member knew Cut.
 if(variant==='cut-gym-trainer'){
  fame.active=tamiaKey;
  assert.equal(before.playerMemory.postgameEvidence.fameChecker[5].entries&8,0,'Tamia\'s Erika fact starts missing');
  assert.equal(before.playerMemory.trainer.party.some(p=>p.moves?.includes(15)),false,'the live party has no Cut user');
  assert.equal(before.playerMemory.trainer.storage.pokemon.some(p=>p.validity==='valid'&&!p.isEgg&&p.moves?.includes(15)),true,'a Cut user waits in the PC');
  // The checkpoint also retains the waiting, clean Onix partner trade that
  // postgame-held-item-partner owns. Set it aside the way the controller's own
  // deferPartnerEvolution does, past this isolated replay's window.
  if(state.dexEvolution){
   assert.ok(!state.dexEvolution.dirty,'only a clean evolution transaction may be set aside');
   state.deferredEvolutions=[...(state.deferredEvolutions??[]),{state:state.dexEvolution,retryAt:now+86400000,reason:'Other work is deferred in this isolated Fame replay.'}];
   state.dexEvolution=null;state.preparation={kind:'postgame',phase:'complete'};state.status='running';state.reason=null;
  }
 }
 if(variant==='togetic-comment'){
  fame.active=togeticKey;
  assert.equal(before.playerMemory.postgameEvidence.fameChecker[1].entries&4,0,'Daisy comment starts missing');
  assert.ok(before.playerMemory.trainer.storage.pokemon.some(p=>p.validity==='valid'&&[175,176].includes(p.species)&&p.otId===before.playerMemory.trainer.otId));
 }
 for(const entry of postgameChecklist(before,state.agenda.workflows))if(entry.id!=='fame-checker'&&entry.status!=='complete'){
  const old=state.agenda.failures[entry.id]??{};
  state.agenda.failures[entry.id]={...old,retryAt:now+86400000,reason:old.reason??'Other work is deferred in this isolated Fame replay.'};
 }
 let controller=open(state);controller.resume();
 const deadline=Date.now()+600000;let result=null,last='',after=null,firstFactSave=null,restoreSave=null;
 for(let i=0;i<100000&&Date.now()<deadline;i++){
  now=Math.max(now,Date.now());
  const o=capture(),m=o.playerMemory,d=controller.decide(o),work=controller.state(),current=facts(o),saves=m.gameStats?.savedGame;
  if(current>first&&firstFactSave===null)firstFactSave=saves;
  const trace=JSON.stringify([m.map?.id,work.objective?.id,current,saves,d.kind==='blocked'?d.reason:null]);
  if(trace!==last){console.log('# fame '+o.frame+' '+trace);last=trace;}
  assert.notEqual(d.kind,'blocked',d.reason);
  const preserved=original.every(fp=>individuals(o).includes(fp));
  const borrowed=['cut-sign','togetic-comment','cut-gym-trainer'].includes(variant);
  const partyBack=JSON.stringify(party(o).sort())===JSON.stringify([...originalParty].sort());
  const restored=!borrowed||partyBack&&
   !work.agenda.workflows.fame?.cutRoster&&!work.agenda.workflows.fame?.temporaryRoster;
  const targetFact=variant==='cut-sign'?Boolean(m.postgameEvidence?.fameChecker?.[5]?.entries&1):
   variant==='cut-gym-trainer'?Boolean(m.postgameEvidence?.fameChecker?.[5]?.entries&8):
   variant==='togetic-comment'?Boolean(m.postgameEvidence?.fameChecker?.[1]?.entries&4):
   // An optional [person, index] names the exact fact a 'fact' case must gain
   // (Sept 25: Brock 2 from the Pewter Fat Man, never the Museum Guide).
   expectFact?Boolean(m.postgameEvidence?.fameChecker?.[expectFact[0]]?.entries&(1<<expectFact[1])):true;
  if(borrowed&&targetFact&&partyBack&&restoreSave===null)restoreSave=saves;
  if(current>first&&saves>firstFactSave&&preserved&&restored&&targetFact&&o.phase==='stable'&&
     (!borrowed||saves>restoreSave)){
   const cold=await createSession();
   try{
    cold.loadSram(session.saveSram());
    const reader=createFireRedObserver({session:cold,...inputs,runId:'fame-checker-cold',storyWatch:controller.storyWatch()});
    const loaded=await continueNativeSaveAsync(cold,reader);
    const native={...loaded,playerMemory:{...loaded.playerMemory,postgameEvidence:readPostgameEvidence(cold,inputs.runtime,loaded)}};
    assert.equal(facts(native),current,'new Fame fact must survive an independent cold Continue');
    assert.ok(original.every(fp=>individuals(native).includes(fp)),'all original Pokémon survive the native save');
    if(expectFact)assert.ok(native.playerMemory.postgameEvidence.fameChecker[expectFact[0]].entries&(1<<expectFact[1]),'the expected native Fame fact survives');
    if(borrowed){
     if(variant==='cut-sign')assert.ok(native.playerMemory.postgameEvidence.fameChecker[5].entries&1,'the native Gym sign fact survives');
     else if(variant==='cut-gym-trainer')assert.ok(native.playerMemory.postgameEvidence.fameChecker[5].entries&8,'the native Tamia fact survives');
     else assert.ok(native.playerMemory.postgameEvidence.fameChecker[1].entries&4,'the native Daisy comment survives');
     assert.deepEqual(party(native).sort(),[...originalParty].sort(),'the original battle roster returns after the borrowed member');
    }
    const next=selectFameChecker(native,inputs.world,structuredClone(work.agenda.workflows.fame??{}),now);
    assert.ok(next,'another missing native Fame source remains schedulable');
    controller=open(JSON.parse(JSON.stringify(work)));controller.resume();
    const handoff=controller.decide(o);
    assert.notEqual(handoff.kind,'blocked',handoff.reason);
    result={status:'passed',variant,factsBefore:first,factsAfter:current,savedGameBefore:firstSave,savedGameAfter:saves,
     originalIndividuals:original.length,rosterRestored:restored,coldContinue:true,next:next.id,controllerDecision:handoff.kind};
    after=o;break;
   }finally{cold.close();}
  }
  if(d.kind==='capture-saved'){controller.acknowledgeCapture();continue;}
  assert.ok(!['postgame-hunt','postgame-evolution-started','postgame-acquisition-started'].includes(d.kind),'Fame replay selected unrelated work');
  const action=d.action??{buttons:[],holdFrames:8};
  for(let j=0;j<(action.holdFrames??1);j++)session.step(action.buttons??[]);
  for(let j=0;j<(action.releaseFrames??0);j++)session.step([]);
  if(i%100===0)await yieldIO();
 }
 assert.ok(result,`Fame ${variant} did not gain, save, and cold-verify a native fact within ten minutes`);
 console.log('# fame verified '+JSON.stringify(result));return {before,after};
}
