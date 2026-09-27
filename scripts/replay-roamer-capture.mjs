import assert from 'node:assert/strict';
import {resolve,dirname} from 'node:path';
import {SaveVault} from '../engine/firered/src/suite/save-vault.js';
import {createSuiteMission} from '../engine/firered/src/suite/mission.js';
import {createFireRedObserver} from '../engine/firered/src/evidence/fire-red-observer.js';
import {createCampaignPlanner} from '../engine/firered/src/player/campaign.js';
import {createPolicyAdvisors} from '../engine/firered/src/player/advisors.js';
import {createCentralPlayer} from '../engine/firered/src/player/delegator.js';
import {readPostgameEvidence,POSTGAME_WATCH} from '../engine/firered/src/suite/postgame-agenda.js';
import {assessRecovery} from '../engine/firered/src/suite/recovery.js';
import {requiresTimedCapture,buildProtectedCapturePlan,executeProtectedCapturePlan} from '../engine/firered/src/rng/protected-capture-plan.js';
import {continueNativeSaveAsync} from '../engine/firered/src/suite/native-cold-boot.js';
import {encounterFingerprint} from '../engine/firered/src/player/encounter-tracker.js';
export async function replayRoamerCapture({session,saved,inputs,createSession,fixture,corpusPath}){
 const state=saved.metadata.session;
 const make=checkpoint=>createSuiteMission({...inputs,mechanics:inputs.battle,id:state.id,request:state.request,state:checkpoint});
 let mission=make(state.mission);
 const planner=createCampaignPlanner({...inputs,mechanics:inputs.battle});
 const watch={flags:[...planner.storyWatch().flags,...POSTGAME_WATCH.flags],variables:POSTGAME_WATCH.variables};
 const observeFor=(session,id)=>{
  const observer=createFireRedObserver({session,...inputs,runId:id,observeRng:true,storyWatch:watch});
  const capture=()=>{const o=observer.capture();return {...o,playerMemory:{...o.playerMemory,postgameEvidence:readPostgameEvidence(session,inputs.runtime,o)}};};
  capture.observer=observer;return capture;
 };
 const observe=observeFor(session,'roamer-native');const before=observe();
 const evidence=state.player?.encounterSafety?.capture??state.captureEvidence;
 assert.equal(before.playerMemory.battleOutcome,6);
 assert.equal(assessRecovery({enabled:true,running:false,mission:mission.state,evidence,wireless:{remotePlayers:0},observation:before}).action,'resume-mission');
 assert.equal(mission.inspect(before,{captureEvidence:evidence}).kind,'roamer-fled');
 mission=make(mission.state);assert.equal(mission.inspect(before).intentionalRoamerSearch,true);
 assert.equal(mission.state.elapsedMs,state.mission.elapsedMs);assert.equal(mission.state.encounters,1);
 // A separate preserved encounter entry tests first-ball qualification. This
 // restore occurs only in the private replay, not in ordinary flight recovery.
 const folder=dirname(resolve(dirname(corpusPath),fixture.checkpoint));
 const source=state.mission.protectedAnchor,entry=new SaveVault(folder,saved.identity).read(source);
 session.loadSram(entry.sram);session.loadState(entry.state);mission=make(state.mission);
 const captureObserve=observeFor(session,'roamer-entry');
 const start=captureObserve(),originals=[...start.playerMemory.trainer.party,...start.playerMemory.trainer.storage.pokemon].map(encounterFingerprint).filter(Boolean);
 assert.equal(start.playerMemory.encounter.pokemon.shiny,false);
 assert.equal(requiresTimedCapture(start,inputs.battle,{requestedRoamer:mission.matches(start.playerMemory.encounter.pokemon)}),true);
 const reopen=initialState=>createCentralPlayer({campaignPlanner:planner,advisors:createPolicyAdvisors({world:inputs.world,mechanics:inputs.battle,campaignPlanner:planner}),mechanics:inputs.battle,initialState,huntConfig:mission.capturePolicy(),captureRequirements:mission.captureRequirements()});
 let player=reopen(null);player.decide(start);
 const plan=await buildProtectedCapturePlan({source,mechanics:inputs.battle,allowOrdinary:true,openTrial:async()=>{
  const trial=await createSession();trial.loadSram(entry.sram);trial.loadState(entry.state);const capture=observeFor(trial,'roamer-trial');return {session:trial,observer:capture.observer,commit:source,capture};
 },onProgress:p=>{if(p.attempt%32===0)console.log('# roamer-plan '+JSON.stringify(p));}});
 assert.ok(plan.verified&&plan.verifiedRepeats>=2);
 const execute=async a=>{for(let n=0;n<(a.holdFrames??1);n++)session.step(a.buttons??[]);for(let n=0;n<(a.releaseFrames??0);n++)session.step([]);};
 assert.equal((await executeProtectedCapturePlan({plan,source,observe:captureObserve,execute})).status,'caught');
 player=reopen(player.state());let after,restarted=false;
 for(let n=0;n<5000;n++){
  after=captureObserve();const decision=player.decide(after),proof=player.state().encounterSafety?.capture;
  if(after.playerMemory.ui.saveDialog&&!restarted){player=reopen(player.state());restarted=true;}
  if(proof?.nativeSaveVerified){assert.equal(mission.acceptSavedCapture(proof).complete,true);assert.equal(proof.pokemon.personality,evidence.pokemon.personality);break;}
  assert.notEqual(decision.kind,'blocked',decision.reason);await execute(decision.action??{buttons:[],holdFrames:2});
 }
 assert.equal(mission.state.caught,1);assert.ok(restarted,'native save survives controller restart');
 const cold=await createSession();
 try{
  cold.loadSram(session.saveSram());const loaded=await continueNativeSaveAsync(cold,createFireRedObserver({session:cold,...inputs,runId:'roamer-cold',storyWatch:watch}));
  const owned=[...loaded.playerMemory.trainer.party,...loaded.playerMemory.trainer.storage.pokemon].map(encounterFingerprint);
  assert.ok(owned.includes(evidence.fingerprint));for(const id of originals)assert.ok(owned.includes(id));
 }finally{cold.close();}
 console.log('# roamer '+JSON.stringify({ordinaryFlightVerified:true,personality:evidence.pokemon.personality,verifiedRepeats:plan.verifiedRepeats,nativeSaveVerified:true,coldContinue:true}));
 return {before,after};
}
