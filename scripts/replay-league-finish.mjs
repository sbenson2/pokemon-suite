import assert from 'node:assert/strict';
import {mkdtempSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {SaveVault} from '../engine/firered/src/suite/save-vault.js';
import {createPostgameController} from '../engine/firered/src/suite/postgame.js';
import {createFireRedObserver} from '../engine/firered/src/evidence/fire-red-observer.js';
import {readPostgameEvidence,POSTGAME_WATCH} from '../engine/firered/src/suite/postgame-agenda.js';
import {continueNativeSaveAsync} from '../engine/firered/src/suite/native-cold-boot.js';

// The real stopped rematch after Lance. Finish through the Champion, credits,
// playable field and cold cartridge Continue; merely selecting a route is insufficient.
export async function replayLeagueFinish({session,saved,inputs,createSession}){
 const original=structuredClone(saved.metadata.session.postgame);
 let clock=original.watchdog?.lastAt??Date.now();
 const open=state=>createPostgameController({...inputs,mechanics:inputs.battle,state,clock:()=>clock});
 let controller=open(original);controller.resume();
 const observer=createFireRedObserver({session,...inputs,runId:'league-finish',storyWatch:controller.storyWatch()});
 const capture=()=>{const o=observer.capture();return {...o,playerMemory:{...o.playerMemory,postgameEvidence:readPostgameEvidence(session,inputs.runtime,o)}};};
 const individuals=o=>[...o.playerMemory.trainer.party,...o.playerMemory.trainer.storage.pokemon]
  .filter(p=>p.validity==='valid').map(p=>JSON.stringify([p.personality,p.otId,p.ivs])).sort();
 const before=capture(),originals=individuals(before),restarts=new Set();let last='';
 assert.equal(before.playerMemory.map.id,'MAP_POKEMON_LEAGUE_LANCES_ROOM');
 assert.equal(before.playerMemory.storyState.flagIds[1211],true);
 assert.equal(before.playerMemory.storyState.flagIds[2116],true);
 try{for(let n=0;n<40000;n++){
  const o=capture(),m=o.playerMemory,decision=controller.decide(o),state=controller.state();
  const trace=JSON.stringify([m.map?.id,o.emulator.mode,decision.kind==='blocked'?decision.reason:null,state.objective?.id,m.gameStats?.leagueEntries]);
  if(trace!==last){console.log('# league-finish '+o.frame+' '+trace);last=trace;}
  const point=o.emulator.inBattle?'champion-battle':o.emulator.mode==='hall-of-fame'?'hall-of-fame':m.ui.saveDialog?'handoff-save':m.map.id==='MAP_POKEMON_LEAGUE_CHAMPIONS_ROOM'?'champion-entry':null;
  if(point&&!restarts.has(point)){controller=open(JSON.parse(JSON.stringify(state)));restarts.add(point);}
  const receipt=state.agenda.workflows?.league?.receipt;
  const free=o.phase==='stable'&&o.emulator.mode==='overworld'&&!o.emulator.inBattle&&!Object.values(m.ui??{}).some(Boolean);
  // Hall of Fame saves automatically without incrementing the manual save
  // statistic. Finish the controller's subsequent owned save before handoff.
  if(receipt?.nativeSaveVerified&&!state.save&&free){
   assert.ok(m.gameStats.leagueEntries>before.playerMemory.gameStats.leagueEntries);
   assert.ok(m.gameStats.savedGame>before.playerMemory.gameStats.savedGame);
   assert.equal(o.emulator.mode,'overworld');assert.equal(o.emulator.inBattle,false);
   assert.ok(restarts.has('champion-entry')&&restarts.has('champion-battle')&&restarts.has('hall-of-fame')&&restarts.has('handoff-save'));
   assert.deepEqual(individuals(o),originals);
   const cold=await createSession();
   try{
    cold.loadSram(session.saveSram());
    const reader=createFireRedObserver({session:cold,...inputs,runId:'league-finish-cold',storyWatch:POSTGAME_WATCH});
    const loaded=await continueNativeSaveAsync(cold,reader);
    assert.equal(loaded.playerMemory.gameStats.leagueEntries,m.gameStats.leagueEntries);
    assert.equal(loaded.playerMemory.storyState.flagIds[2116],true);
    assert.ok(loaded.playerMemory.gameStats.savedGame>before.playerMemory.gameStats.savedGame);
    assert.deepEqual(individuals(loaded),originals);
   }finally{cold.close();}
   assert.deepEqual(saved.metadata.session.postgame,original);
   console.log('# league-finish verified '+JSON.stringify({receipt,coldContinue:true,restarts:[...restarts],originalIndividuals:originals.length}));
   return {before,after:o};
  }
  assert.notEqual(decision.kind,'blocked',decision.reason);
  if(!receipt)assert.notEqual(state.objective?.target?.kind,'await-postgame-dependency','The owned rematch cannot defer before its receipt.');
  const action=decision.action??{buttons:[],holdFrames:8};
  for(let i=0;i<(action.holdFrames??1);i++){session.step(action.buttons??[]);clock+=1000/60;}
  for(let i=0;i<(action.releaseFrames??0);i++){session.step([]);clock+=1000/60;}
 }
 throw Error('The stronger League did not complete its Champion, native save and playable-field handoff.');
 }finally{
  if(process.env.SUITE_REPLAY_KEEP==='1'){
   const root=mkdtempSync(join(tmpdir(),'suite-league-finish-'));
   new SaveVault(root,saved.identity).write(session.saveState(),session.saveSram(),{...saved.metadata,frame:session.frame,reason:'league-finish-replay',session:{...saved.metadata.session,postgame:controller.state()}});
   console.log('# retained '+root);
  }
 }
}
