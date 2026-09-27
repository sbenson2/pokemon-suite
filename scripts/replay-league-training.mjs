import assert from 'node:assert/strict';
import {mkdtempSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {setImmediate as yieldIO} from 'node:timers/promises';
import {createPostgameController,canYieldPostgame} from '../engine/firered/src/suite/postgame.js';
import {PostgameAgenda,postgameChecklist,readPostgameEvidence,isLeagueChallengeMap,POSTGAME_WATCH} from '../engine/firered/src/suite/postgame-agenda.js';
import {createFireRedObserver} from '../engine/firered/src/evidence/fire-red-observer.js';
import {battleDecisionState} from '../engine/firered/src/player/battle-model.js';
import {continueNativeSaveAsync} from '../engine/firered/src/suite/native-cold-boot.js';
import {encounterFingerprint} from '../engine/firered/src/player/encounter-tracker.js';
import {SaveVault,atomicJson} from '../engine/firered/src/suite/save-vault.js';

// The live pick-up of League Exp. Share training (a private copy of the live
// hunt checkpoint, Four Island, Hall of Fame entry 200). The save still carries
// the build-106 hold {battler-fainted, entry 101, Agatha's room}: no class, so
// it is never re-armed on its own. The trainee Gloom (L53) is boxed; Oddish
// holds the Exp. Share in the party. The replay isolates league-training (other
// goals deferred, as replay-league-record.mjs does) and runs the full controller.
// A: owner setting on without a resume: the controller notes when it first saw
//    the old record, the checklist shows the paused entry and nothing runs (no
//    selection, no save).
// B: reopened with the owner's resume stamp (newer than that first sighting): the
//    hold is released, the driver composes Gloom with the Exp. Share behind five
//    L100 battlers, opens a native cycle as the round starts, plays one League
//    round that trains it (restarts at the battle and Hall of Fame points), saves
//    it natively, counts the run and plans Gloom again.
const AGATHA='MAP_POKEMON_LEAGUE_AGATHAS_ROOM',LORELEI='MAP_POKEMON_LEAGUE_LORELEIS_ROOM',EXP_SHARE=182,FLY=19;
const LEGACY={reason:'battler-fainted',leagueEntries:101,frame:16496570,map:AGATHA};
const PAUSED='Paused after a battler fainted at Hall of Fame entry 101. To resume, turn League training off in Bot settings and save, then turn it on and save again.';
const legacyKept=(h,what)=>{const {firstSeenAt,...kept}=h??{};assert.deepEqual(kept,LEGACY,what);assert.match(firstSeenAt??'',/^\d{4}-\d\d-\d\dT/,`${what}: first sighting recorded`);return firstSeenAt;};

export async function replayLeagueTraining({session,saved,inputs,createSession,maxWallMs=900000}){
 const original=structuredClone(saved.metadata.session.postgame),s0=original.agenda.workflows.leagueExpShare,trainee=s0.trainee,teamPlan=original.fieldTeamPlan;
 assert.deepEqual(s0.disabled,LEGACY,'start from the live legacy hold');assert.ok(!s0.history,'no hold history or resume yet');
 let now=original.watchdog?.lastAt??Date.now();
 const storyWatch=createPostgameController({...inputs,mechanics:inputs.battle,state:original}).storyWatch();
 const observer=createFireRedObserver({session,...inputs,runId:'league-training',storyWatch});
 const capture=()=>{const raw=observer.capture();return {...raw,playerMemory:{...raw.playerMemory,postgameEvidence:readPostgameEvidence(session,inputs.runtime,raw)}};};
 let before=capture();for(let i=0;before.phase!=='stable'&&i<240;i++){session.step([]);before=capture();}
 assert.equal(canYieldPostgame(original,before),true,'isolate this goal only at an unowned field boundary');
 const same=(p,t)=>Boolean(p&&t)&&Number(p.personality)===Number(t.personality)&&Number(p.otId)===Number(t.otId);
 const ids=o=>[...o.playerMemory.trainer.party,...o.playerMemory.trainer.storage.pokemon].filter(p=>p.validity==='valid').map(encounterFingerprint).sort();
 const all=o=>[...o.playerMemory.trainer.party,...o.playerMemory.trainer.storage.pokemon];
 const originalIds=ids(before),baseline=before.playerMemory.gameStats.leagueEntries,gloom0=all(before).find(p=>same(p,trainee));
 assert.ok(gloom0&&!before.playerMemory.trainer.party.some(p=>same(p,trainee)),'the trainee Gloom starts boxed');
 assert.equal(before.sram.sha256,saved.sramSha256);
 // Isolation: every other checklist goal is deferred; native counters, receipts,
 // individuals and existing failure records are kept.
 const seed=structuredClone(original);seed.objective=null;seed.player=null;seed.agenda.active=null;seed.agenda.enabled=true;
 for(const e of postgameChecklist(before,seed.agenda.workflows,teamPlan))if(e.id!=='league-training'){
  const old=seed.agenda.failures[e.id]??{};
  seed.agenda.failures[e.id]={...old,retryAt:Math.max(old.retryAt??0,now+86400000),reason:old.reason??'Other goals are deferred in the isolated League training replay.'};
 }
 const open=(state,leagueTraining)=>createPostgameController({...inputs,mechanics:inputs.battle,state,clock:()=>now,leagueTraining});
 const free=o=>o.phase==='stable'&&o.emulator.mode==='overworld'&&!o.emulator.inBattle&&!Object.values(o.playerMemory.ui??{}).some(Boolean);
 const run=decision=>{const action=decision.action??{buttons:[],holdFrames:8};
  for(let i=0;i<(action.holdFrames??1);i++){session.step(action.buttons??[]);now+=1000/60;}
  for(let i=0;i<(action.releaseFrames??0);i++){session.step([]);now+=1000/60;}};
 const entryOf=(o,w)=>postgameChecklist(o,w,teamPlan).find(e=>e.id==='league-training');
 const root=process.env.SUITE_REPLAY_OUTPUT??mkdtempSync(join(tmpdir(),'suite-league-training-'));
 let controller=open(seed,{enabled:true,resumedAt:null}),last='',result,after,idle=null;
 try{
  // A: the owner setting is on (the default) but was never resumed.
  for(let n=0,decisions=0;n<2000&&!idle;n++){
   const o=capture(),d=controller.decide(o),s=controller.state(),w=s.agenda.workflows;
   const trace=JSON.stringify(['idle',o.playerMemory.map.id,d.kind,s.objective?.id??null,s.agenda.active]);
   if(trace!==last){console.log('# league-training '+o.frame+' '+trace);last=trace;}
   assert.notEqual(d.kind,'blocked',d.reason);
   assert.notEqual(s.agenda.active,'league-training','a held entry is never selected');
   assert.ok(!/^postgame-league-/.test(s.objective?.id??''),'no League objective runs while held: '+s.objective?.id);
   assert.equal(o.sram.sha256,saved.sramSha256,'nothing is saved while held');
   if(free(o)&&++decisions>=20){
    const entry=entryOf(o,w),les=w.leagueExpShare;
    assert.equal(entry?.status,'pending','league-training is listed as pending');assert.equal(entry.executable,false);assert.equal(les.demand?.known,true);
    assert.equal(entry.reason,PAUSED);assert.equal(entry.paused,true);
    assert.equal(les.demand.plan.reason,'disabled:battler-fainted');legacyKept(les.disabled,'the legacy hold is kept');
    assert.ok(!les.history?.some(e=>e.kind==='resumed'),'nothing resumed it');
    assert.equal(new PostgameAgenda(structuredClone(s.agenda)).select(o,now),null,'the isolated agenda has nothing to run');
    idle={frame:o.frame,decisions,entry,state:JSON.parse(JSON.stringify(s))};
    console.log('# league-training idle '+JSON.stringify({frame:o.frame,decisions,entry,plan:les.demand.plan}));
   }
   run(d);
   if(n%100===0)await yieldIO();
  }
  assert.ok(idle,'the held entry must settle at a stable field boundary');
  // B: the owner turned the setting off and on (Bot settings stamps the resume);
  // the worker reopens the controller from JSON with it.
  const owner={enabled:true,resumedAt:new Date(now).toISOString()},seenAt=idle.state.agenda.workflows.leagueExpShare.disabled.firstSeenAt;
  assert.ok(Date.parse(owner.resumedAt)>Date.parse(seenAt),'the resume is newer than the first sighting');
  controller=open(idle.state,owner);
  const restarts=new Set(),entered=[],battles=new Set(),until=Date.now()+maxWallMs;
  let resumed=null,cycle=null,composed=null,hof=null,lastTrainer=null;
  for(let n=0;n<200000&&Date.now()<until;n++){
   const o=capture(),m=o.playerMemory,map=m.map?.id??'',d=controller.decide(o),s=controller.state(),w=s.agenda.workflows,les=w.leagueExpShare??{},training=w.training;
   const trace=JSON.stringify([map,s.objective?.id??null,o.emulator.mode,m.gameStats?.leagueEntries,s.agenda.active,training?.cycle?.baseline?.leagueEntries??null,les.round?(les.round.faints?.length??0):null,d.kind==='blocked'?d.reason:null]);
   if(trace!==last){console.log('# league-training '+o.frame+' '+trace);last=trace;}
   assert.notEqual(d.kind,'blocked',d.reason);
   assert.equal(les.disabled,undefined,`no hold during the trained round (${JSON.stringify(les.disabled??null)})`);
   if(!resumed&&les.history?.some(e=>e.kind==='resumed')){
    resumed=les.history.find(e=>e.kind==='resumed');
    assert.equal(legacyKept(resumed.hold,'the released hold'),seenAt);assert.equal(resumed.resumedAt,owner.resumedAt);
    console.log('# league-training resumed '+JSON.stringify({frame:o.frame,resumed,demand:les.demand&&{plan:les.demand.plan,label:les.demand.label}}));
   }
   if(!cycle&&training?.cycle){
    cycle={frame:o.frame,objective:s.objective?.id??null,baseline:training.cycle.baseline};
    console.log('# league-training cycle '+JSON.stringify(cycle));
    assert.ok(resumed,'no cycle before the resume');assert.ok(!composed,'the cycle opens before Lorelei\'s room');
    assert.equal(cycle.baseline.leagueEntries,baseline,'a native League cycle opens at the current Hall of Fame count');
    assert.deepEqual([cycle.baseline.savedGame,cycle.baseline.sha256],[m.gameStats.savedGame,o.sram.sha256],'the baseline is the native save at the round start');
    assert.equal(les.active,true,'the cycle opens with the trainee round');assert.ok(same(les.trainee,trainee));
   }
   if(/^postgame-league-rematch-(battle|intermission|travel)/.test(s.objective?.id??'')&&(isLeagueChallengeMap(map)||/battle-0$/.test(s.objective.id)))
    assert.ok(same(s.objective.expShareTrainee,trainee),`${s.objective.id} names the passive trainee Gloom`);
   // The composed party, checked where the round begins.
   if(!composed&&map===LORELEI&&free(o)&&m.trainer.partyValidity==='valid'){
    const party=m.trainer.party,g=party.find(p=>same(p,trainee)),battlers=party.filter(p=>!same(p,trainee));
    composed={frame:o.frame,party:party.map(p=>({slot:p.slot,species:p.species,level:p.level,heldItem:p.heldItem})),round:les.round??null};
    console.log('# league-training composed '+JSON.stringify(composed));
    assert.ok(resumed&&cycle,'the hold was released and the cycle opened before the round');
    assert.equal(party.length,6);assert.ok(g&&g.heldItem===EXP_SHARE,'Gloom holds the Exp. Share');assert.notEqual(Number(g.slot),0,'the trainee does not lead');
    assert.ok(battlers.every(p=>p.level===100&&teamPlan.permanentFamilies.some(f=>f.map(Number).includes(Number(p.species)))),'five L100 permanent-team battlers');
    assert.ok(party.some(p=>p.moves?.includes(FLY)),'a Fly user stays in the party');
    assert.equal(les.round?.leagueEntries,baseline,'the round opened at the current count');
   }
   if(o.emulator.inBattle){
    const b=battleDecisionState(m,m.ui??{});
    if(b?.trainerId&&b.trainerId!==lastTrainer){battles.add(b.trainerId);lastTrainer=b.trainerId;}
    const active=m.trainer.party.find(p=>Number(p.slot)===Number(b?.playerPartySlot));
    const isTrainee=active?same(active,trainee):Number(b?.player?.species)===Number(gloom0.species)&&m.trainer.party.filter(p=>p.species===gloom0.species).length===1;
    if(isTrainee&&Number(b?.player?.hp)>0)entered.push({frame:o.frame,turn:b.turn,trainerId:b.trainerId});
   }
   if(!hof&&o.emulator.mode==='hall-of-fame'){
    const g=m.trainer.party.find(p=>same(p,trainee));
    hof={frame:o.frame,leagueEntries:m.gameStats?.leagueEntries??null,experience:g?.experience,level:g?.level,heldItem:g?.heldItem,battles:[...battles]};
    console.log('# league-training hall-of-fame '+JSON.stringify(hof));
    assert.ok(composed,'the round began with the composed party');assert.deepEqual(entered,[],'the passive trainee never entered battle');
    assert.ok(g&&g.experience>gloom0.experience&&g.heldItem===EXP_SHARE,'Gloom gained Exp. Share experience and still holds it');
   }
   // Controller restarts at the retained points of the round.
   const point=o.emulator.inBattle?'battle':o.emulator.mode==='hall-of-fame'?'hall-of-fame':isLeagueChallengeMap(map)&&free(o)?'league-room':training?.cycle&&resumed&&!composed?'preparation':null;
   if(point&&!restarts.has(point)){controller=open(JSON.parse(JSON.stringify(s)),owner);restarts.add(point);}
   const receipt=training?.lastRun??training?.cycle?.receipt;
   if(receipt?.nativeSaveVerified&&receipt.leagueEntries>baseline&&controller.canYield(o)){
    const round=les.history.filter(e=>e.kind==='round').at(-1),key=`${trainee.personality}:${trainee.otId}`,g=all(o).find(p=>same(p,trainee));
    const summary={startFrame:before.frame,endFrame:o.frame,map,resumed,cycle,composed,hof,battles:[...battles],entered,restarts:[...restarts],
     training:{lastRun:training.lastRun,runs:training.runs,byTrainee:training.byTrainee,cycle:training.cycle},round,lastPlan:les.lastPlan,
     trainee:g&&{level:g.level,experience:g.experience,heldItem:g.heldItem},steps:n};
    console.log('# league-training-summary '+JSON.stringify(summary));
    assert.ok(restarts.has('battle')&&restarts.has('hall-of-fame'),'restarts at the battle and Hall of Fame points');
    assert.deepEqual(entered,[],'the passive trainee never entered battle');assert.ok(hof,'the Hall of Fame was reached');
    assert.equal(training.lastRun?.nativeSaveVerified,true);assert.equal(training.lastRun.leagueEntries,baseline+1);
    assert.equal(training.runs,1);assert.equal(training.byTrainee?.[key],1);
    assert.equal(training.cycle,undefined,'the next cycle opens when the next round starts');
    assert.equal(round?.baseline,baseline);assert.equal(round.leagueEntries,baseline+1);assert.equal(round.won,true);
    assert.ok(same(round.trainee,trainee)&&round.expGain>0,`the judged round trained Gloom (${round.expGain})`);
    assert.equal(les.round,undefined);assert.equal(les.active,false);assert.equal(les.disabled,undefined);
    assert.equal(les.lastPlan?.active,true,`training continues (${les.lastPlan?.reason})`);assert.ok(same(les.lastPlan.trainee,trainee),'with Gloom');
    assert.deepEqual(ids(o),originalIds,'the same individuals');
    const cold=await createSession();
    try{
     cold.loadSram(session.saveSram());
     const reader=createFireRedObserver({session:cold,...inputs,runId:'league-training-cold',storyWatch:POSTGAME_WATCH});
     const loaded=await continueNativeSaveAsync(cold,reader);
     assert.equal(loaded.playerMemory.gameStats.leagueEntries,baseline+1);assert.deepEqual(ids(loaded),originalIds);
    }finally{cold.close();}
    result={status:'passed',leagueBefore:baseline,leagueAfter:m.gameStats.leagueEntries,idle:{frame:idle.frame,decisions:idle.decisions,reason:idle.entry.reason},
     resumed,receipt:training.lastRun,expGain:round.expGain,restarts:[...restarts],coldContinue:true,originalIndividuals:originalIds.length};after=o;break;
   }
   run(d);
   if(n%100===0)await yieldIO();
  }
  assert.ok(result,`the trained League round must return with its native victory saved within ${maxWallMs} ms`);
  console.log('# league-training verified '+JSON.stringify(result));return {before,after};
 }catch(error){result={status:'failed',error:error.stack};throw error;}
 finally{
  new SaveVault(root,saved.identity).write(session.saveState(),session.saveSram(),{...saved.metadata,frame:session.frame,reason:'league-training-replay',session:{...saved.metadata.session,postgame:controller.state()}});
  atomicJson(join(root,'result.json'),result??{status:'incomplete'});console.log('# retained '+root);
 }
}
