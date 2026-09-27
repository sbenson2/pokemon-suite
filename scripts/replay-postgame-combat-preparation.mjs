import assert from 'node:assert/strict';
import {createPostgameController} from '../engine/firered/src/suite/postgame.js';
import {createFireRedObserver} from '../engine/firered/src/evidence/fire-red-observer.js';
import {postgameChecklist,readPostgameEvidence} from '../engine/firered/src/suite/postgame-agenda.js';
import {continueNativeSaveAsync} from '../engine/firered/src/suite/native-cold-boot.js';
import {encounterFingerprint} from '../engine/firered/src/player/encounter-tracker.js';
import {mkdtempSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {SaveVault} from '../engine/firered/src/suite/save-vault.js';

// Retained Tower arrival with an evolution/collection party. This qualifies
// native PC assembly and productive preparation, not a Tower prize or full run.
export async function replayPostgameCombatPreparation({session,saved,inputs,createSession}){
 const original=structuredClone(saved.metadata.session.postgame);
 let clock=original.watchdog.lastAt;
 const open=state=>createPostgameController({...inputs,mechanics:inputs.battle,state,clock:()=>clock});
 let controller=open(original);
 const observer=createFireRedObserver({session,...inputs,runId:'postgame-combat-preparation',storyWatch:controller.storyWatch()});
 const capture=()=>{const o=observer.capture();return {...o,playerMemory:{...o.playerMemory,postgameEvidence:readPostgameEvidence(session,inputs.runtime,o)}};};
 const before=capture(),all=o=>[...o.playerMemory.trainer.party,...o.playerMemory.trainer.storage.pokemon];
 const identities=o=>all(o).map(encounterFingerprint).sort(),originalIds=identities(before);
 const initialXp=new Map(all(before).map(p=>[encounterFingerprint(p),p.experience]));
 const families=original.fieldTeamPlan.permanentFamilies;
 assert.equal(families.length,6);
 assert.equal(before.playerMemory.map.id,'MAP_TRAINER_TOWER_LOBBY');
 const isolated=controller.state();
 for(const entry of postgameChecklist(before))if(entry.id!=='trainer-tower')
  isolated.agenda.failures[entry.id]={reason:'Isolated native combat preparation replay.',attempts:0,retryAt:clock+86400000};
 controller=open(isolated);controller.beginAdventure();
 const restarts=new Set();let saving=false,last='',preparedXp;
 try{
  for(let n=0;n<40000;n++){
   const o=capture(),m=o.playerMemory,decision=controller.decide(o),state=controller.state();
   const trace=JSON.stringify([m.map.id,decision.kind,state.objective?.id,m.trainer.party.map(p=>[p.species,p.level,p.experience])]);
   if(trace!==last){console.log('# combat-preparation '+o.frame+' '+trace);last=trace;}
   assert.notEqual(decision.kind,'blocked',decision.reason);
   assert.notEqual(state.objective?.target?.kind,'await-postgame-dependency','preparation must earn native XP');
   assert.notEqual(state.objective?.id,'stock-postgame-supplies','generic shopping cannot interrupt the challenge preparation budget');
   assert.notEqual(m.storyState.variableIds[0x4082],1,'the unprepared party must not enter a scaled Tower battle');
   const free=o.phase==='stable'&&o.emulator.mode==='overworld'&&!o.emulator.inBattle&&!Object.values(m.ui??{}).some(Boolean);
   const point=m.ui.storage?'pc':m.ui.saveDialog&&saving?'save':o.emulator.inBattle&&state.objective?.battleTeamTargetLevel>0?'training':null;
   if(point&&!restarts.has(point)){controller=open(JSON.parse(JSON.stringify(state)));restarts.add(point);}
   const assembled=families.every(f=>m.trainer.party.some(p=>f.includes(p.species)));
   const trained=m.trainer.party.filter(p=>p.level<93&&p.experience>initialXp.get(encounterFingerprint(p)));
   if(!saving&&free&&assembled&&trained.length&&m.gameStats.trainerBattles>before.playerMemory.gameStats.trainerBattles){
    assert.ok(restarts.has('pc'));assert.ok(restarts.has('training'));
    preparedXp=new Map(trained.map(p=>[encounterFingerprint(p),p.experience]));
    controller.beginPlayerTask({id:'save-combat-preparation',kind:'save'});saving=true;continue;
   }
   if(saving&&decision.kind==='player-task-complete'){
    assert.equal(decision.receipt.nativeSaveVerified,true);assert.ok(restarts.has('save'));
    assert.deepEqual(identities(o),originalIds);
    const cold=await createSession();
    try{
     cold.loadSram(session.saveSram());
     const reader=createFireRedObserver({session:cold,...inputs,runId:'combat-preparation-cold',storyWatch:controller.storyWatch()});
     const loaded=await continueNativeSaveAsync(cold,reader);
     assert.deepEqual(identities(loaded),originalIds);
     assert.ok(families.every(f=>loaded.playerMemory.trainer.party.some(p=>f.includes(p.species))));
     for(const [identity,xp] of preparedXp)assert.equal(all(loaded).find(p=>encounterFingerprint(p)===identity)?.experience,xp);
    }finally{cold.close();}
    controller.requestHandoff();assert.equal(controller.decide(o).kind,'handoff');
    controller=open(JSON.parse(JSON.stringify(controller.state())));controller.resume();
    assert.notEqual(controller.decide(o).kind,'blocked');
    assert.deepEqual(saved.metadata.session.postgame,original);
    console.log('# combat-preparation verified '+JSON.stringify({counter:m.gameStats.savedGame,party:m.trainer.party.map(p=>[p.species,p.level,p.experience]),originalIndividuals:originalIds.length,coldContinue:true,restarts:[...restarts]}));
    return {before,after:o};
   }
   if(decision.kind==='capture-saved'){controller.acknowledgeCapture();continue;}
   const action=decision.action??{buttons:[],holdFrames:8};
   for(let i=0;i<(action.holdFrames??1);i++){session.step(action.buttons??[]);clock+=1000/60;}
   for(let i=0;i<(action.releaseFrames??0);i++){session.step([]);clock+=1000/60;}
  }
  throw Error('Tower preparation did not assemble the team, earn XP and save within its replay budget.');
 }finally{
  if(process.env.SUITE_REPLAY_KEEP==='1'){
   const root=mkdtempSync(join(tmpdir(),'suite-combat-preparation-'));
   new SaveVault(root,saved.identity).write(session.saveState(),session.saveSram(),{...saved.metadata,frame:session.frame,reason:'combat-preparation-replay',session:{...saved.metadata.session,postgame:controller.state()}});
   console.log('# retained '+root);
  }
 }
}
