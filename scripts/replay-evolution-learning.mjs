import assert from 'node:assert/strict';
import {createPostgameController} from '../engine/firered/src/suite/postgame.js';
import {createFireRedObserver} from '../engine/firered/src/evidence/fire-red-observer.js';
import {readPostgameEvidence} from '../engine/firered/src/suite/postgame-agenda.js';
import {continueNativeSaveAsync} from '../engine/firered/src/suite/native-cold-boot.js';
import {encounterFingerprint} from '../engine/firered/src/player/encounter-tracker.js';

// Native Venomoth review checkpoint: the summary move picker retains inBattle
// after victory and evolution. No state edits or manual menu inputs are used.
export async function replayEvolutionLearning({session,saved,inputs,createSession}) {
 const original=structuredClone(saved.metadata.session.postgame);
 let clock=original.watchdog.lastAt;
 const open=state=>createPostgameController({...inputs,mechanics:inputs.battle,state,clock:()=>clock});
 let controller=open(original);
 const observer=createFireRedObserver({session,...inputs,runId:'evolution-move-learning',storyWatch:controller.storyWatch()});
 const capture=()=>{const o=observer.capture();return {...o,playerMemory:{...o.playerMemory,postgameEvidence:readPostgameEvidence(session,inputs.runtime,o)}};};
 const before=capture(),source=original.dexEvolution.originalPokemon;
 const identities=o=>[...o.playerMemory.trainer.party,...o.playerMemory.trainer.storage.pokemon].map(encounterFingerprint).sort();
 const originalIdentities=identities(before),restarts=new Set();
 assert.equal(before.emulator.inBattle,true);assert.equal(before.emulator.mode,'battle');
 assert.equal(before.playerMemory.battleOutcome,1);assert.equal(before.playerMemory.ui.moveLearning.stage,'forget-move');
 assert.equal(before.playerMemory.ui.moveLearning.moveId,16);
 assert.equal(before.playerMemory.trainer.party[0].species,49);
 let last='';
 for(let n=0;n<2500;n++){
  const o=capture(),decision=controller.decide(o),state=controller.state(),m=o.playerMemory;
  const trace=JSON.stringify([decision.kind,decision.reason,m.ui?.moveLearning?.stage,m.ui?.evolution?.stage,m.ui?.saveDialog?.stage,state.dexEvolution?.phase]);
  if(trace!==last){console.log('# evolution-learning '+o.frame+' '+trace);last=trace;}
  assert.notEqual(decision.kind,'blocked',decision.reason);
  assert.notEqual(decision.winner?.recommendation?.kind,'wait-for-supported-objective');
  const point=m.ui.moveLearning?'learning':m.ui.saveDialog?'save':null;
  if(point&&!restarts.has(point)){controller=open(JSON.parse(JSON.stringify(state)));restarts.add(point);}
  if(decision.kind==='dex-evolution-saved'){
   assert.equal(decision.receipt.nativeSaveAfterEvolution,true);
   assert.equal(decision.receipt.nativeSaveVerified,true);
   assert.equal(decision.receipt.pokemon.species,49);
   assert.equal(decision.receipt.pokemon.personality,source.personality);
   assert.equal(decision.receipt.pokemon.otId,source.otId);
   assert.deepEqual(decision.receipt.pokemon.ivs,source.ivs);
   assert.ok(m.gameStats.savedGame>before.playerMemory.gameStats.savedGame);
   assert.notEqual(o.sram.sha256,before.sram.sha256);
   assert.deepEqual(identities(o),originalIdentities);
   assert.deepEqual([...restarts].sort(),['learning','save']);
   const cold=await createSession();
   try{
    cold.loadSram(session.saveSram());
    const coldObserver=createFireRedObserver({session:cold,...inputs,runId:'evolution-learning-cold',storyWatch:controller.storyWatch()});
    const loaded=await continueNativeSaveAsync(cold,coldObserver);
    assert.deepEqual(identities(loaded),originalIdentities,'cold Continue must retain every original individual');
    assert.ok(loaded.playerMemory.trainer.pokedex.ownedSpecies.includes(49));
    const evolved=loaded.playerMemory.trainer.party.find(p=>p.personality===source.personality&&p.otId===source.otId);
    assert.equal(evolved?.species,49);assert.deepEqual(evolved.moves,decision.receipt.pokemon.moves);
   }finally{cold.close();}
   controller.acknowledgeDexEvolution();controller=open(JSON.parse(JSON.stringify(controller.state())));
   assert.equal(controller.state().dexEvolution,null);
   const next=controller.decide(o);
   assert.notEqual(next.kind,'blocked',next.reason);
   assert.notEqual(controller.state().dexEvolution?.requestId,original.dexEvolution.requestId,'the agenda cannot restart the saved evolution');
   controller.requestHandoff();assert.equal(controller.decide(o).kind,'handoff');
   assert.deepEqual(saved.metadata.session.postgame,original);
   console.log('# evolution-learning verified '+JSON.stringify({savedFrame:o.frame,counter:m.gameStats.savedGame,originalIndividuals:originalIdentities.length,coldContinue:true,restarts:[...restarts]}));
   return {before,after:o};
  }
  const action=decision.action??{buttons:[],holdFrames:8};
  for(let i=0;i<(action.holdFrames??1);i++){session.step(action.buttons??[]);clock+=1000/60;}
  for(let i=0;i<(action.releaseFrames??0);i++){session.step([]);clock+=1000/60;}
 }
 throw Error('Post-evolution learning did not finish its native save and agenda handoff.');
}
