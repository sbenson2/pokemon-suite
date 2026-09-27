import assert from 'node:assert/strict';
import {createPostgameController} from '../engine/firered/src/suite/postgame.js';
import {createFireRedObserver} from '../engine/firered/src/evidence/fire-red-observer.js';
import {readPostgameEvidence} from '../engine/firered/src/suite/postgame-agenda.js';
import {createCentralPlayer} from '../engine/firered/src/player/delegator.js';
import {createPolicyAdvisors} from '../engine/firered/src/player/advisors.js';
import {continueNativeSaveAsync} from '../engine/firered/src/suite/native-cold-boot.js';

export async function replayPostgameEvolution({session,saved,inputs,fixture={},createSession}){
 const original=structuredClone(saved.metadata.postgame);
 const open=state=>createPostgameController({...inputs,mechanics:inputs.battle,state});
 let controller=open(original);
 const observer=createFireRedObserver({session,...inputs,runId:'postgame-evolution-route',storyWatch:controller.storyWatch()});
 const capture=()=>{const o=observer.capture();return {...o,playerMemory:{...o.playerMemory,postgameEvidence:readPostgameEvidence(session,inputs.runtime,o)}};};
 const before=capture(),source=original.dexEvolution.originalPokemon;
 let after=before,restarted=false,last='',leftForest=false,interruption=null;
 const free=o=>o.phase==='stable'&&o.emulator.mode==='overworld'&&!o.emulator.inBattle&&!Object.values(o.playerMemory.ui??{}).some(Boolean);
 const execute=action=>{
  for(let n=0;n<(action.holdFrames??1);n++)session.step(action.buttons??[]);
  for(let n=0;n<(action.releaseFrames??0);n++)session.step([]);
 };
 assert.equal(before.playerMemory.map.id,'MAP_VIRIDIAN_FOREST');
 assert.equal(controller.decide(before).winner?.recommendation.objective,'fly-to-MAPSEC_CELADON_CITY');
 for(let i=0;i<16000;i++){
  after=capture();const decision=controller.decide(after),state=controller.state(),m=after.playerMemory;
  const trace=JSON.stringify([state.objective?.id,decision.kind,decision.reason,decision.winner?.recommendation?.kind,m.map?.id,m.ui?.storage?.stage,m.ui?.party?.stage]);
  if(process.env.SUITE_REPLAY_TRACE==='1'&&trace!==last){console.log('# evolution '+after.frame+' '+trace);last=trace;}
  assert.notEqual(decision.kind,'blocked',decision.reason);
  assert.notEqual(decision.winner?.recommendation?.kind,'wait-for-supported-objective','the evolution must retain an executable action');
  assert.deepEqual(saved.metadata.postgame,original,'the regression checkpoint is immutable');
  if(m.map.id!==before.playerMemory.map.id)leftForest=true;
  if(!restarted&&m.ui?.storage){controller=open(JSON.parse(JSON.stringify(state)));restarted=true;}
  if(fixture.interruptEvolutionSave&&!interruption&&state.dexEvolution?.baseline&&state.dexEvolution.phase==='evolving'&&free(after)){
   const baseline={counter:m.gameStats.savedGame,sha256:after.sram.sha256};let objective=null,done=false;
   const planner={select:()=>objective,selectCollection:()=>null,selectTraining:()=>null,state:()=>({objective})};
   const saving=createCentralPlayer({advisors:createPolicyAdvisors({world:inputs.world,mechanics:inputs.battle,campaignPlanner:planner}),campaignPlanner:planner,mechanics:inputs.battle});
   for(let n=0;n<1500;n++){
    const o=capture(),verified=o.playerMemory.gameStats?.savedGame===baseline.counter+1&&o.sram.sha256!==baseline.sha256;
    if(verified&&free(o)){interruption={counter:o.playerMemory.gameStats.savedGame,sha256:o.sram.sha256,frame:o.frame};done=true;break;}
    objective={id:'intervening-native-save',target:{kind:'save-game',map:o.playerMemory.map.id,saveVerified:verified},deferOptionalDetours:true,identityEvolution:true};
    const d=saving.decide(o);assert.notEqual(d.kind,'blocked',d.reason);execute(d.action??{buttons:[],holdFrames:8});
   }
   assert.ok(done,'the intervening save must complete through native menus');
   controller=open(JSON.parse(JSON.stringify(state)));continue;
  }
  if(decision.kind==='dex-evolution-saved'){
   const evolved=m.trainer.party.find(p=>p.personality===source.personality&&p.otId===source.otId);
   assert.equal(evolved?.species,14);assert.deepEqual(evolved.ivs,source.ivs);
   assert.ok(leftForest&&restarted,'travel and PC transaction must both run and survive restart');
   assert.ok(m.trainer.pokedex.ownedSpecies.includes(14));
   assert.ok(m.gameStats.savedGame>before.playerMemory.gameStats.savedGame);
   assert.notEqual(after.sram.sha256,before.sram.sha256);
   if(fixture.interruptEvolutionSave){
    assert.ok(interruption,'test a native save between preparation and evolution');
    assert.notEqual(after.sram.sha256,interruption.sha256,'an earlier save cannot certify the evolution');
    assert.ok(m.gameStats.savedGame>interruption.counter);
    assert.equal(decision.receipt.nativeSaveAfterEvolution,true);
    const cold=await createSession();
    try{
     cold.loadSram(session.saveSram());
     const coldObserver=createFireRedObserver({session:cold,...inputs,runId:'evolution-native-save-proof',storyWatch:controller.storyWatch()});
     const loaded=await continueNativeSaveAsync(cold,coldObserver);
     const persisted=[...loaded.playerMemory.trainer.party,...loaded.playerMemory.trainer.storage.pokemon].find(p=>p.personality===source.personality&&p.otId===source.otId);
     assert.equal(persisted?.species,14,'cold Continue must contain the evolved individual');
     assert.deepEqual(persisted.ivs,source.ivs);assert.ok(loaded.playerMemory.trainer.pokedex.ownedSpecies.includes(14));
    }finally{cold.close();}
   }
   controller.acknowledgeDexEvolution();
   controller=open(JSON.parse(JSON.stringify(controller.state())));
   assert.equal(controller.state().dexEvolution,null);
   controller.requestHandoff();assert.equal(controller.decide(after).kind,'handoff');
   return {before,after};
  }
  if(decision.kind==='capture-saved')controller.acknowledgeCapture();
  else{
   const action=decision.action??{buttons:[],holdFrames:8};
   execute(action);
  }
 }
 throw Error('The owned evolution did not finish its native save and safe handoff.');
}
