import assert from 'node:assert/strict';
import {mkdtempSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {SaveVault} from '../engine/firered/src/suite/save-vault.js';
import {createPostgameController} from '../engine/firered/src/suite/postgame.js';
import {createFireRedObserver} from '../engine/firered/src/evidence/fire-red-observer.js';
import {readPostgameEvidence,isLeagueChallengeMap} from '../engine/firered/src/suite/postgame-agenda.js';
import {continueNativeSaveAsync} from '../engine/firered/src/suite/native-cold-boot.js';
import {encounterFingerprint} from '../engine/firered/src/player/encounter-tracker.js';

// Authentic postgame checkpoints: one exhausted after beating Lorelei, one
// entering with normally purchased medicine. No native inventory/state edits.
export async function replayLeagueOwnership({session,saved,inputs,createSession,fixture}){
 const original=structuredClone(saved.metadata.session.postgame);
 let clock=original.watchdog?.lastAt??Date.now();
 const open=state=>createPostgameController({...inputs,mechanics:inputs.battle,state,clock:()=>clock});
 let controller=open(original);controller.resume();
 const observer=createFireRedObserver({session,...inputs,runId:'league-ownership',storyWatch:controller.storyWatch()});
 const capture=()=>{const o=observer.capture();return {...o,playerMemory:{...o.playerMemory,postgameEvidence:readPostgameEvidence(session,inputs.runtime,o)}};};
 const before=capture(),identities=o=>[...o.playerMemory.trainer.party,...o.playerMemory.trainer.storage.pokemon].map(encounterFingerprint).sort();
 const originals=identities(before),restarts=new Set();let last='';
 assert.equal(before.playerMemory.map.id,'MAP_POKEMON_LEAGUE_LORELEIS_ROOM');
 assert.equal(before.playerMemory.storyState.flagIds[2092],true);
 assert.equal(before.playerMemory.storyState.flagIds[2116],true);
 try{for(let n=0;n<40000;n++){
  const o=capture(),m=o.playerMemory,decision=controller.decide(o),state=controller.state();
  const job=state.objective;
  const trace=JSON.stringify([m.map.id,decision.kind,job?.id,m.battleOutcome,m.ui.saveDialog?.stage]);
  if(trace!==last){console.log('# league-ownership '+o.frame+' '+trace);last=trace;}
  if(job?.target?.map)assert.ok(isLeagueChallengeMap(job.target.map),'The one-way challenge scheduled outside work: '+JSON.stringify(job));
  assert.equal(state.agenda.active,'league-rematch');
  assert.deepEqual(state.agenda.failures['league-rematch'],original.agenda.failures['league-rematch'],'the owned challenge cannot defer to an unreachable route or erase a retained failure');
  const free=o.phase==='stable'&&o.emulator.mode==='overworld'&&!o.emulator.inBattle&&!Object.values(m.ui??{}).some(Boolean);
  const point=m.ui.saveDialog?'save':o.emulator.inBattle?'battle':job?.target.kind==='heal-with-items'?'recovery':null;
  if(point&&!restarts.has(point)){controller=open(JSON.parse(JSON.stringify(state)));restarts.add(point);}
  const stopped=fixture.exhausted&&decision.kind==='blocked';
  const advanced=!fixture.exhausted&&free&&m.map.id==='MAP_POKEMON_LEAGUE_BRUNOS_ROOM';
  if(stopped||advanced){
   if(stopped){
    assert.equal(decision.reason,'league-recovery-supplies-exhausted');
    assert.equal(m.map.id,'MAP_POKEMON_LEAGUE_LORELEIS_ROOM');
    controller=open(JSON.parse(JSON.stringify(state)));controller.resume();
    const again=controller.decide(o);assert.equal(again.kind,'blocked');assert.equal(again.reason,decision.reason);
    restarts.add('shortage');
   }else{
    assert.equal(m.storyState.flagIds[1208],true);
    assert.ok(m.trainer.party.every(p=>p.hp===p.maxHp&&p.status1===0),'the next opponent receives the healed team');
    assert.ok(restarts.has('battle')&&restarts.has('recovery'));
   }
   assert.ok(restarts.has('save'),'the owned native save survived controller reconstruction');
   assert.ok(m.gameStats.savedGame>before.playerMemory.gameStats.savedGame);
   assert.deepEqual(identities(o),originals);
   const cold=await createSession();
   try{
    cold.loadSram(session.saveSram());
    const reader=createFireRedObserver({session:cold,...inputs,runId:'league-ownership-cold',storyWatch:controller.storyWatch()});
    const loaded=await continueNativeSaveAsync(cold,reader);
    assert.deepEqual(identities(loaded),originals);
    assert.equal(loaded.playerMemory.storyState.flagIds[1208],true);
    assert.equal(loaded.playerMemory.map.id,'MAP_POKEMON_LEAGUE_LORELEIS_ROOM');
    if(!fixture.exhausted)assert.ok(loaded.playerMemory.trainer.party.every(p=>p.hp===p.maxHp&&p.status1===0));
   }finally{cold.close();}
   controller.requestHandoff();assert.equal(controller.decide(o).kind,'handoff');
   assert.deepEqual(saved.metadata.session.postgame,original);
   console.log('# league-ownership verified '+JSON.stringify({exhausted:Boolean(fixture.exhausted),counter:m.gameStats.savedGame,coldContinue:true,restarts:[...restarts],originalIndividuals:originals.length}));
   return {before,after:o};
  }
  assert.notEqual(decision.kind,'blocked',decision.reason);
  const action=decision.action??{buttons:[],holdFrames:8};
  for(let i=0;i<(action.holdFrames??1);i++){session.step(action.buttons??[]);clock+=1000/60;}
  for(let i=0;i<(action.releaseFrames??0);i++){session.step([]);clock+=1000/60;}
 }
 throw Error('The League boundary did not finish its owned recovery/save and handoff.');
 }finally{
  if(process.env.SUITE_REPLAY_KEEP==='1'){
   const root=mkdtempSync(join(tmpdir(),'suite-league-ownership-'));
   new SaveVault(root,saved.identity).write(session.saveState(),session.saveSram(),{...saved.metadata,frame:session.frame,reason:'league-ownership-replay',session:{...saved.metadata.session,postgame:controller.state()}});
   console.log('# retained '+root);
  }
 }
}
