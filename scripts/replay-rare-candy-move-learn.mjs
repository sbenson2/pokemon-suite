import assert from 'node:assert/strict';
import {createPostgameController} from '../engine/firered/src/suite/postgame.js';
import {createFireRedObserver} from '../engine/firered/src/evidence/fire-red-observer.js';
import {readPostgameEvidence} from '../engine/firered/src/suite/postgame-agenda.js';
import {continueNativeSaveAsync} from '../engine/firered/src/suite/native-cold-boot.js';
import {encounterFingerprint} from '../engine/firered/src/player/encounter-tracker.js';

// Live September 24 (build 107). A Rare Candy took the Dex target Diglett to
// Lv 21 inside the party menu; the move policy declined Fury Swipes and FireRed
// asked "Stop trying to teach FURY SWIPES?". That party-menu prompt was not
// observed, so the owner waited on a "party transition" until its 120-second
// boundary stopped it (retained/). Install 107 resumed the stop through the
// postgame checklist, which dropped the evolution task; after that and a host
// restart the owner idled in the same prompt with "Current task list is
// exhausted" (resumed/). From each checkpoint, resumed as the Bot switch does,
// the owner must answer the prompt, keep using its candies through the rest of
// the level-ups (Mud-Slap at 25), let Diglett evolve at 26 without cancelling,
// save natively, close every menu and continue the postgame.
const DIGLETT=50,DUGTRIO=51,FURY_SWIPES=154,RARE_CANDY=68,EVOLUTION_LEVEL=26;
const count=(o,id)=>Object.values(o.playerMemory.trainer.bag??{}).flat().reduce((n,i)=>n+(i?.itemId===id?i.quantity:0),0);
const free=o=>o.phase==='stable'&&o.emulator.mode==='overworld'&&!o.emulator.inBattle&&!Object.values(o.playerMemory.ui??{}).some(Boolean);
const trace=process.env.SUITE_REPLAY_TRACE==='1';

export async function replayRareCandyMoveLearn({session,saved,inputs,createSession,fixture}){
 const retained=fixture.target==='postgame-rare-candy-move-learn';
 const original=structuredClone(saved.metadata.session.postgame);
 let clock=Math.max(original.watchdog?.lastAt??0,original.watchdog?.boundary?.lastAt??0);
 const open=state=>createPostgameController({...inputs,mechanics:inputs.battle,state,clock:()=>clock,qmmSupply:{enabled:original.qmmEnabled===true}});
 let controller=open(structuredClone(original));
 const observer=createFireRedObserver({session,...inputs,runId:fixture.id,storyWatch:controller.storyWatch()});
 const capture=()=>{const o=observer.capture();return {...o,playerMemory:{...o.playerMemory,postgameEvidence:readPostgameEvidence(session,inputs.runtime,o)}};};
 const before=capture(),bm=before.playerMemory;
 const target=bm.trainer.party.filter(p=>p.species===DIGLETT);
 assert.equal(target.length,1,'the checkpoint holds one party Diglett');
 const source=target[0],same=p=>p.personality===source.personality&&p.otId===source.otId;
 const others=o=>[...o.playerMemory.trainer.party,...o.playerMemory.trainer.storage.pokemon].filter(p=>!same(p)).map(encounterFingerprint).sort();
 const originalOthers=others(before),candies=count(before,RARE_CANDY);
 // The stuck screen itself (cartridge facts): the party menu's stop-learning Yes/No.
 const stopPrompt=o=>o.emulator.callback2==='CB2_UpdatePartyMenu'&&o.playerMemory.activeTasks.some(t=>t.function==='Task_HandleStopLearningMoveYesNoInput');
 assert.ok(stopPrompt(before));assert.deepEqual(bm.activeTasks.map(t=>t.function),['Task_HandleStopLearningMoveYesNoInput']);
 assert.equal(source.level,21);assert.deepEqual(source.moves,[10,45,222,91]);
 if(retained){
  assert.equal(original.dexEvolution?.originalPokemon?.personality,source.personality,'the retained owner still owns this evolution');
  assert.equal(original.objective?.target?.kind,'use-party-item');
  assert.ok(original.watchdog.boundary.elapsedMs>=120000,'the retained stop exhausted its boundary');
 }else{
  assert.equal(original.dexEvolution,null,'the checklist resume dropped the evolution task');
  assert.equal(original.objective,null);
 }
 assert.equal(original.status,'waiting');
 // The Bot switch (set-bot enabled) resumes a waiting owner with resume().
 controller.resume();
 let last='',answered=false,restarted=false,evolutionScene=false,evolutionSaved=null,idleInMenu=0,after=before,stopAnswers=0,promptIdle=0;
 const levels=new Set();
 for(let n=0;n<60000;n++){
  const o=capture(),m=o.playerMemory,d=[...m.trainer.party,...(m.trainer.storage?.pokemon??[])].find(same);
  if(d){levels.add(d.level);assert.ok(d.species===DIGLETT||d.species===DUGTRIO,'the individual keeps its family');}
  const decision=controller.decide(o),state=controller.state();
  const buttons=decision.action?.buttons??[];
  const line=JSON.stringify([decision.kind,decision.reason,decision.winner?.recommendation?.kind,decision.winner?.recommendation?.objective,m.map?.id,o.emulator.mode,m.ui?.party?.stage,m.ui?.moveLearning?.stage,m.ui?.levelUp?.stage,d?.species,d?.level,d?.moves,state.objective?.id,state.dexEvolution?.phase]);
  if(trace&&line!==last){console.log('# rare-candy '+o.frame+' '+line);last=line;}
  assert.notEqual(decision.kind,'blocked',decision.reason);
  assert.notEqual(decision.winner?.recommendation?.kind,'wait-for-supported-objective');
  // Build 107 never pressed anything here ("party transition" / "Current
  // task list is exhausted") until its 120-second boundary stopped the owner.
  if(!answered&&stopPrompt(o)){
   promptIdle=buttons.length?0:promptIdle+(decision.action?.holdFrames??1)+(decision.action?.releaseFrames??0);
   assert.ok(promptIdle<600,`the owner does not answer "Stop trying to teach FURY SWIPES?" (${decision.kind}: ${decision.reason})`);
   if(buttons.length)assert.deepEqual(m.ui.moveLearning,{stage:'confirm-stop-learning',partySlot:source.slot,moveId:FURY_SWIPES,itemId:RARE_CANDY,cursor:m.ui.moveLearning?.cursor,selected:m.ui.moveLearning?.selected});
  }
  if(m.ui.moveLearning?.stage==='confirm-stop-learning'){
   // Declining is final: YES to "Stop trying to teach".
   assert.deepEqual(buttons,[m.ui.moveLearning.cursor===0?'a':'up'],'answer the stop-learning prompt with YES');
   stopAnswers++;
  }
  if(!answered&&!m.activeTasks.some(t=>t.function==='Task_HandleStopLearningMoveYesNoInput')){
   answered=true;assert.ok(!d.moves.includes(FURY_SWIPES),'the declined move is not learned');
  }
  // No idle wait while a native menu or prompt is on screen.
  if(decision.kind==='resample'&&/task list is exhausted/.test(decision.reason??'')&&o.emulator.mode!=='overworld'){
   idleInMenu++;assert.ok(idleInMenu<20,'the owner idles inside a menu');
  }else idleInMenu=0;
  // FireRed's B cancels the evolution; an identity evolution must complete.
  if(o.emulator.mode==='evolution'){
   evolutionScene=true;
   if(!m.ui.moveLearning)assert.ok(!buttons.includes('b'),'never cancel the identity evolution');
  }
  // Restart the owner inside the next candy's level-up (worker relaunch).
  if(answered&&!restarted&&m.ui.levelUp){controller=open(JSON.parse(JSON.stringify(state)));restarted=true;continue;}
  if(decision.kind==='postgame-evolution-started'){continue;}
  if(decision.kind==='dex-evolution-saved'){
   const r=decision.receipt;
   assert.equal(r.pokemon.species,DUGTRIO);assert.equal(r.pokemon.personality,source.personality);assert.equal(r.pokemon.otId,source.otId);
   assert.deepEqual(r.pokemon.ivs,source.ivs);assert.equal(r.nativeSaveVerified,true);assert.equal(r.nativeSaveAfterEvolution,true);
   assert.ok(r.pokemon.level>=EVOLUTION_LEVEL);
   assert.ok(evolutionScene,'the evolution ran in FireRed’s own scene');
   assert.ok(restarted,'the candy transaction survived an owner restart');
   assert.deepEqual(others(o),originalOthers,'every other individual is preserved');
   assert.equal(count(o,RARE_CANDY),candies-(r.pokemon.level-21),'one Rare Candy per level, none wasted');
   assert.ok(m.gameStats.savedGame>bm.gameStats.savedGame);assert.notEqual(o.sram.sha256,before.sram.sha256);
   assert.equal(r.savedSramSha256,o.sram.sha256);
   evolutionSaved={frame:o.frame,level:r.pokemon.level,moves:r.pokemon.moves,savedGame:m.gameStats.savedGame,sram:o.sram.sha256};
   const cold=await createSession();
   try{
    cold.loadSram(session.saveSram());
    const coldObserver=createFireRedObserver({session:cold,...inputs,runId:fixture.id+'-cold',storyWatch:controller.storyWatch()});
    const loaded=await continueNativeSaveAsync(cold,coldObserver);
    const persisted=[...loaded.playerMemory.trainer.party,...loaded.playerMemory.trainer.storage.pokemon].find(same);
    assert.equal(persisted?.species,DUGTRIO,'cold Continue contains Dugtrio');assert.deepEqual(persisted.ivs,source.ivs);
    assert.ok(loaded.playerMemory.trainer.pokedex.ownedSpecies.includes(DUGTRIO));
    assert.deepEqual(others(loaded),originalOthers);
   }finally{cold.close();}
   controller.acknowledgeDexEvolution();
   controller=open(JSON.parse(JSON.stringify(controller.state())));
   continue;
  }
  if(decision.kind==='capture-saved'){controller.acknowledgeCapture();continue;}
  // The postgame continues on its own after the evolution: a field decision
  // for another objective (or a handoff to a hunt/task) with no menu left.
  if(evolutionSaved&&free(o)&&(['postgame-hunt','postgame-acquisition-started','postgame-evolution-started','handoff'].includes(decision.kind)||
    decision.kind==='act'&&state.objective&&!/evolution-dex-/.test(state.objective.id))){
   assert.ok(answered);assert.ok(stopAnswers>=1);
   console.log('# rare-candy verified '+JSON.stringify({case:fixture.id,frames:o.frame-before.frame,levels:[...levels].sort((a,b)=>a-b),
    evolutionSaved,next:decision.kind==='act'?state.objective.id:decision.kind,restarted,stopAnswers}));
   after=o;return {before,after};
  }
  if(!decision.action){assert.fail(`unexpected decision ${decision.kind}: ${decision.reason}`);}
  for(let i=0;i<(decision.action.holdFrames??1);i++){session.step(decision.action.buttons??[]);clock+=1000/60;}
  for(let i=0;i<(decision.action.releaseFrames??0);i++){session.step([]);clock+=1000/60;}
 }
 throw Error(`The Rare Candy evolution did not finish (answered=${answered}, levels=${[...levels]}, evolutionScene=${evolutionScene}, saved=${Boolean(evolutionSaved)}).`);
}
