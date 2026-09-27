import assert from 'node:assert/strict';
import {createPostgameController} from '../engine/firered/src/suite/postgame.js';
import {createFireRedObserver} from '../engine/firered/src/evidence/fire-red-observer.js';
import {readPostgameEvidence} from '../engine/firered/src/suite/postgame-agenda.js';
import {encounterFingerprint} from '../engine/firered/src/player/encounter-tracker.js';
import {mkdtempSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {SaveVault} from '../engine/firered/src/suite/save-vault.js';

// Retained native Icefall checkpoint after the Venomoth save. Exercise the
// owner's actual travel decisions and reconstruct it during the ferry trip.
export async function replayPostgameTravel({session,saved,inputs,fixture}){
 const original=structuredClone(saved.metadata.session.postgame);
 let clock=original.watchdog.lastAt;
 const open=state=>createPostgameController({...inputs,mechanics:inputs.battle,state,clock:()=>clock});
 let controller=open(original);
 const requestId=fixture.acquisition?'native-island-prize-travel':null;
 const destination=fixture.acquisition?'MAP_CELADON_CITY_GAME_CORNER':'MAP_TRAINER_TOWER_LOBBY';
 if(!fixture.acquisition)controller.beginPlayerTask({id:'native-tower-travel',kind:'travel',map:destination});
 const observer=createFireRedObserver({session,...inputs,runId:fixture.id,storyWatch:controller.storyWatch()});
 const capture=()=>{const o=observer.capture();return {...o,playerMemory:{...o.playerMemory,postgameEvidence:readPostgameEvidence(session,inputs.runtime,o)}};};
 const before=capture(),identities=o=>[...o.playerMemory.trainer.party,...o.playerMemory.trainer.storage.pokemon].map(encounterFingerprint).sort();
 const originals=identities(before),maps=new Set(),restarts=new Set();let last='';
 assert.equal(before.playerMemory.map.id,fixture.acquisition?'MAP_FOUR_ISLAND_ICEFALL_CAVE_ENTRANCE':'MAP_VERMILION_CITY');
 try{for(let n=0;n<18000;n++){
  const o=capture(),m=o.playerMemory,decision=controller.decide(o),state=controller.state();maps.add(m.map?.id);
  const trace=JSON.stringify([m.map?.id,decision.kind,decision.reason,decision.winner?.recommendation.kind,state.objective?.id]);
  if(trace!==last){console.log('# postgame-travel '+o.frame+' '+trace);last=trace;}
  assert.notEqual(decision.kind,'blocked',decision.reason);
  assert.notEqual(decision.winner?.recommendation.kind,'wait-for-supported-objective',JSON.stringify({map:m.map,position:m.position,target:state.objective}));
  if(decision.kind==='dex-evolution-saved'){
   assert.ok(decision.receipt.nativeSaveVerified);controller.acknowledgeDexEvolution();
   controller.beginAcquisition({kind:'game-corner',requestId,speciesId:123});continue;
  }
  const free=o.phase==='stable'&&o.emulator.mode==='overworld'&&!o.emulator.inBattle&&!Object.values(m.ui??{}).some(Boolean);
  if(free&&m.map.id===destination&&(fixture.acquisition||decision.kind==='player-task-complete')){
   assert.ok(maps.has(fixture.acquisition?'MAP_FOUR_ISLAND_HARBOR':'MAP_VERMILION_CITY'));
   assert.ok(maps.has(fixture.acquisition?'MAP_VERMILION_CITY':'MAP_SEVEN_ISLAND'));
   assert.ok(restarts.has('ferry'));
   const retained=identities(o);for(const fp of originals)assert.ok(retained.includes(fp),'travel preserves every individual');
   if(requestId)assert.equal(state.acquisition.requestId,requestId);
   else{
    assert.equal(decision.receipt.nativeSaveVerified,true);
    assert.ok(m.gameStats.savedGame>before.playerMemory.gameStats.savedGame);
    assert.notEqual(o.sram.sha256,before.sram.sha256);
   }
   controller.requestHandoff();assert.equal(controller.decide(o).kind,'handoff');
   controller=open(JSON.parse(JSON.stringify(controller.state())));controller.resume();
   assert.notEqual(controller.decide(o).kind,'blocked');
   assert.deepEqual(saved.metadata.session.postgame,original);
   return {before,after:o};
  }
  if(m.map?.id===(fixture.acquisition?'MAP_FOUR_ISLAND_HARBOR':'MAP_VERMILION_CITY')&&m.ui?.choiceMenu&&!restarts.has('ferry')){
   controller=open(JSON.parse(JSON.stringify(state)));restarts.add('ferry');
  }
  if(decision.kind==='capture-saved'){controller.acknowledgeCapture();continue;}
  const action=decision.action??{buttons:[],holdFrames:8};
  for(let i=0;i<(action.holdFrames??1);i++){session.step(action.buttons??[]);clock+=1000/60;}
  for(let i=0;i<(action.releaseFrames??0);i++){session.step([]);clock+=1000/60;}
 }}finally{
  if(process.env.SUITE_REPLAY_KEEP==='1'){
   const root=mkdtempSync(join(tmpdir(),'suite-postgame-travel-'));
   new SaveVault(root,saved.identity).write(session.saveState(),session.saveSram(),{...saved.metadata,frame:session.frame,reason:'native-travel-replay',session:{...saved.metadata.session,postgame:controller.state()}});
   console.log('# retained '+root);
  }
 }
 throw Error('The retained postgame owner did not complete its ferry journey to '+destination);
}
