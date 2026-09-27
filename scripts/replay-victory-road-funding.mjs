import assert from 'node:assert/strict';
import {createPostgameController,canYieldPostgame} from '../engine/firered/src/suite/postgame.js';
import {createCampaignPlanner,campaignNavigationRecommendation} from '../engine/firered/src/player/campaign.js';
import {createFireRedObserver} from '../engine/firered/src/evidence/fire-red-observer.js';
import {readPostgameEvidence} from '../engine/firered/src/suite/postgame-agenda.js';
import {continueNativeSaveAsync} from '../engine/firered/src/suite/native-cold-boot.js';
import {encounterFingerprint} from '../engine/firered/src/player/encounter-tracker.js';
import {mkdtempSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {SaveVault} from '../engine/firered/src/suite/save-vault.js';

// A real League preparation checkpoint wrongly deferred in Victory Road's
// final switch pocket. Let its existing retry cooldown elapse; alter no game data.
export async function replayVictoryRoadFunding({session,saved,inputs,createSession}){
 const original=structuredClone(saved.metadata.session.postgame);
 let clock=Math.max(original.watchdog.lastAt,original.agenda.failures['league-rematch'].retryAt+1);
 const open=state=>createPostgameController({...inputs,mechanics:inputs.battle,state,clock:()=>clock});
 let controller=open(original);controller.beginAdventure();
 const observer=createFireRedObserver({session,...inputs,runId:'victory-road-funding',storyWatch:controller.storyWatch()});
 const capture=()=>{const o=observer.capture();return {...o,playerMemory:{...o.playerMemory,postgameEvidence:readPostgameEvidence(session,inputs.runtime,o)}};};
 const before=capture(),identities=o=>[...o.playerMemory.trainer.party,...o.playerMemory.trainer.storage.pokemon].map(encounterFingerprint).sort();
 const originals=identities(before),restarts=new Set();let saving=false,last='';
 assert.equal(before.playerMemory.map.id,'MAP_VICTORY_ROAD_2F');
 assert.deepEqual(before.playerMemory.position,{x:36,y:17});
 const planner=createCampaignPlanner({...inputs,mechanics:inputs.battle,campaign:{objectives:[]},initialState:original.planner});
 const income=planner.selectIncomePreparation(before,clock);
 assert.ok(income,'The income selector must accept the navigator’s authored exit from the native switch pocket.');
 const exit=campaignNavigationRecommendation({world:inputs.world,observation:before,objective:{id:'exit-for-income',target:{kind:'map-arrival',map:'MAP_VERMILION_CITY'}}});
 assert.equal(exit?.victoryRoadPhase,'leave-final-switch-pocket');
 try{
  for(let n=0;n<30000;n++){
   const o=capture(),m=o.playerMemory,decision=controller.decide(o),state=controller.state();
   const trace=JSON.stringify([m.map.id,decision.kind,state.objective?.id,m.trainer.money]);
   if(trace!==last){console.log('# victory-road-funding '+o.frame+' '+trace);last=trace;}
   assert.notEqual(decision.kind,'blocked',decision.reason);
   assert.notEqual(state.objective?.target?.kind,'await-postgame-dependency','a proved cave exit cannot exhaust League funding');
   const free=o.phase==='stable'&&o.emulator.mode==='overworld'&&!o.emulator.inBattle&&!Object.values(m.ui??{}).some(Boolean);
   const point=m.map.id==='MAP_VICTORY_ROAD_3F'&&!restarts.has('cave')?'cave':m.ui.choiceMenu&&m.map.id.endsWith('_HARBOR')?'ferry':saving&&m.ui.saveDialog?'save':null;
   if(point&&!restarts.has(point)){controller=open(JSON.parse(JSON.stringify(state)));restarts.add(point);}
   if(decision.kind==='capture-saved'){controller.acknowledgeCapture();continue;}
   if(!saving&&free&&canYieldPostgame(state,o)&&!m.map.id.startsWith('MAP_VICTORY_ROAD_')&&
      m.trainer.money>before.playerMemory.trainer.money&&m.gameStats.trainerBattles>before.playerMemory.gameStats.trainerBattles){
    assert.ok(restarts.has('cave'));
    controller.beginPlayerTask({id:'save-earned-league-funds',kind:'save'});saving=true;continue;
   }
   if(saving&&decision.kind==='player-task-complete'){
    assert.equal(decision.receipt.nativeSaveVerified,true);assert.ok(restarts.has('save'));
    const kept=identities(o);for(const id of originals)assert.ok(kept.includes(id));
    const cold=await createSession();
    try{
     cold.loadSram(session.saveSram());
     const reader=createFireRedObserver({session:cold,...inputs,runId:'victory-road-funding-cold',storyWatch:controller.storyWatch()});
     const loaded=await continueNativeSaveAsync(cold,reader);assert.deepEqual(identities(loaded),kept);
     assert.equal(loaded.playerMemory.trainer.money,m.trainer.money);
    }finally{cold.close();}
    controller.requestHandoff();assert.equal(controller.decide(o).kind,'handoff');
    assert.deepEqual(saved.metadata.session.postgame,original);
    console.log('# victory-road-funding verified '+JSON.stringify({moneyBefore:before.playerMemory.trainer.money,moneyAfter:m.trainer.money,counter:m.gameStats.savedGame,coldContinue:true,restarts:[...restarts]}));
    return {before,after:o};
   }
   const action=decision.action??{buttons:[],holdFrames:8};
   for(let i=0;i<(action.holdFrames??1);i++){session.step(action.buttons??[]);clock+=1000/60;}
   for(let i=0;i<(action.releaseFrames??0);i++){session.step([]);clock+=1000/60;}
  }
  throw Error('The native cave-to-income route did not earn and save League funds within its replay budget.');
 }finally{
  if(process.env.SUITE_REPLAY_KEEP==='1'){
   const root=mkdtempSync(join(tmpdir(),'suite-victory-road-funding-'));
   new SaveVault(root,saved.identity).write(session.saveState(),session.saveSram(),{...saved.metadata,frame:session.frame,reason:'victory-road-funding-replay',session:{...saved.metadata.session,postgame:controller.state()}});
   console.log('# retained '+root);
  }
 }
}
