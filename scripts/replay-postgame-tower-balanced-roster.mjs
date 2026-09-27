import assert from 'node:assert/strict';
import {createPostgameController} from '../engine/firered/src/suite/postgame.js';
import {createFireRedObserver} from '../engine/firered/src/evidence/fire-red-observer.js';
import {postgameChecklist,readPostgameEvidence} from '../engine/firered/src/suite/postgame-agenda.js';
import {continueNativeSaveAsync} from '../engine/firered/src/suite/native-cold-boot.js';
import {encounterFingerprint} from '../engine/firered/src/player/encounter-tracker.js';

// The retained post-League save has five level-77–79 members, a level-100
// Fearow and a boxed Mewtwo. Tower opponents scale to the highest party level.
// This replay proves the native PC substitution, retained objective, save and
// cold Continue; the separate Tower prize remains an independent goal.
export async function replayPostgameTowerBalancedRoster({session,saved,inputs,createSession}){
 const original=structuredClone(saved.metadata.session.postgame);
 let controller=createPostgameController({...inputs,mechanics:inputs.battle,state:original});
 const observer=createFireRedObserver({session,...inputs,runId:'postgame-tower-balanced-roster',storyWatch:controller.storyWatch()});
 const capture=()=>{const o=observer.capture();return {...o,playerMemory:{...o.playerMemory,postgameEvidence:readPostgameEvidence(session,inputs.runtime,o)}};};
 const all=o=>[...o.playerMemory.trainer.party,...o.playerMemory.trainer.storage.pokemon].filter(p=>p.validity==='valid');
 const identities=o=>all(o).map(encounterFingerprint).sort();
 const before=capture(),t=before.playerMemory.trainer,originalIds=identities(before);
 assert.equal(before.phase,'stable');
 assert.equal(t.party.length,6);
 assert.equal(t.party.find(p=>p.species===22)?.level,100);
 assert.ok(t.storage.pokemon.some(p=>p.species===150&&p.validity==='valid'));
 assert.equal(originalIds.length,65);
 assert.ok(t.party.filter(p=>p.species!==22).every(p=>p.level>=77&&p.level<=79));
 const state=controller.state();
 for(const entry of postgameChecklist(before)){
  if(entry.id!=='trainer-tower'&&entry.status!=='complete')state.agenda.failures[entry.id]={reason:'Isolated Tower roster regression.',attempts:0,retryAt:Date.now()+86400000};
 }
 if(state.agenda.failures['trainer-tower']?.reason?.startsWith('Isolated '))delete state.agenda.failures['trainer-tower'];
 else assert.ok(!state.agenda.failures['trainer-tower']||state.agenda.failures['trainer-tower'].retryAt<=Date.now(),
  'The Tower has a genuine retained cooldown.');
 controller=createPostgameController({...inputs,mechanics:inputs.battle,state});
 if(state.agenda.enabled)controller.resume();else controller.beginAdventure();
 let sawPreferred=false,sawFive=false,restartedAtPc=false,balancedSaveBaseline=null,last='';
 for(let n=0;n<20000;n++){
  const o=capture(),m=o.playerMemory,d=controller.decide(o),s=controller.state();
  assert.notEqual(d.kind,'blocked',d.reason);
  assert.notEqual(s.objective?.target?.kind,'await-postgame-dependency','Tower preparation was deferred.');
  const roster=s.agenda?.workflows?.tower?.balancedRoster;
  if(roster){
   sawPreferred=true;
   assert.deepEqual(roster.preferredFamilies.map(f=>f[0]).sort((a,b)=>a-b),[3,53,55,67,149,150]);
   assert.equal(roster.targetLevel,79);
  }
  if(m.trainer.party.length===5){sawFive=true;assert.ok(roster,'The roster choice disappeared between PC actions.');}
  const balanced=m.trainer.party.length===6&&m.trainer.party.some(p=>p.species===150)&&!m.trainer.party.some(p=>p.species===22);
  if(balanced&&balancedSaveBaseline===null)balancedSaveBaseline=m.gameStats.savedGame;
  const free=o.phase==='stable'&&o.emulator.mode==='overworld'&&!o.emulator.inBattle&&!Object.values(m.ui??{}).some(Boolean);
  if(balanced&&free&&m.gameStats.savedGame>balancedSaveBaseline){
   assert.ok(sawPreferred&&sawFive&&restartedAtPc);
   assert.ok(m.trainer.storage.pokemon.some(p=>p.species===22));
   assert.deepEqual(identities(o),originalIds);
   const cold=await createSession();
   try{
    cold.loadSram(session.saveSram());
    const reader=createFireRedObserver({session:cold,...inputs,runId:'tower-balanced-roster-cold',storyWatch:controller.storyWatch()});
    const loaded=await continueNativeSaveAsync(cold,reader);
    assert.deepEqual(identities(loaded),originalIds);
    assert.deepEqual(loaded.playerMemory.trainer.party.map(p=>p.species).sort((a,b)=>a-b),[3,53,55,67,149,150]);
    assert.ok(loaded.playerMemory.trainer.storage.pokemon.some(p=>p.species===22));
    assert.equal(loaded.playerMemory.gameStats.savedGame,m.gameStats.savedGame);
   }finally{cold.close();}
   controller.requestHandoff();assert.equal(controller.decide(o).kind,'handoff');
   controller=createPostgameController({...inputs,mechanics:inputs.battle,state:JSON.parse(JSON.stringify(controller.state()))});
   controller.resume();assert.notEqual(controller.decide(o).kind,'blocked');
   assert.deepEqual(saved.metadata.session.postgame,original);
   console.log('# tower-balanced-roster verified '+JSON.stringify({frame:o.frame,savedGame:m.gameStats.savedGame,party:m.trainer.party.map(p=>[p.species,p.level]),originalIndividuals:originalIds.length,restartedAtPc,coldContinue:true}));
   return {before,after:o};
  }
  const trace=JSON.stringify([m.map.id,s.objective?.id,m.trainer.party.map(p=>[p.species,p.level]).sort((a,b)=>a[0]-b[0])]);
  if(trace!==last){console.log('# tower-balanced-roster '+o.frame+' '+trace);last=trace;}
  if(d.kind==='capture-saved'){controller.acknowledgeCapture();continue;}
  if(m.ui?.storage&&!restartedAtPc){controller=createPostgameController({...inputs,mechanics:inputs.battle,state:JSON.parse(JSON.stringify(s))});restartedAtPc=true;continue;}
  const a=d.action??{buttons:[],holdFrames:8};
  for(let i=0;i<(a.holdFrames??1);i++)session.step(a.buttons??[]);
  for(let i=0;i<(a.releaseFrames??0);i++)session.step([]);
 }
 throw Error('The balanced Tower party did not finish a native PC transaction and save within the replay budget.');
}
