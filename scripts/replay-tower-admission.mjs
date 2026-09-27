// Continue a copied native Tower checkpoint through admission, recovery and rewards.
// The caller owns cartridge verification, session lifetime and the immutable seed.
import assert from 'node:assert/strict';
import {appendFileSync,mkdirSync,mkdtempSync,writeFileSync} from 'node:fs';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import {SaveVault} from '../engine/firered/src/suite/save-vault.js';
import {createFireRedObserver} from '../engine/firered/src/evidence/fire-red-observer.js';
import {createPostgameController} from '../engine/firered/src/suite/postgame.js';
import {readPostgameEvidence} from '../engine/firered/src/suite/postgame-agenda.js';
import {continueNativeSaveAsync} from '../engine/firered/src/suite/native-cold-boot.js';
import {encounterFingerprint} from '../engine/firered/src/player/encounter-tracker.js';
import {partyFullyRestored} from '../engine/firered/src/player/recovery.js';

export async function replayTowerAdmission({session,saved,inputs,createSession,fixture={},artifactDirectory=null,identity=saved?.identity}){
const phase=fixture.phase??'first-floor';
assert.ok(['first-floor','single-prize','next-mode','mode-prize','double-recovery'].includes(phase),
 'Unknown Trainer Tower replay phase.');
const mode=phase==='double-recovery'?1:
 phase==='mode-prize'||phase==='next-mode'?Number(fixture.mode??1):0;
assert.ok(!['mode-prize','next-mode'].includes(phase)||Number.isInteger(mode)&&mode>=1&&mode<=3,
 'A later Tower mode replay needs --mode=1, 2, or 3.');
const prizePhase=phase==='single-prize'||phase==='mode-prize';
const diagnose=fixture.diagnose===true;
assert.ok(!diagnose||phase==='mode-prize'&&mode===1,'Diagnostic capture is limited to Double mode.');
assert.ok(session&&saved?.metadata?.session?.postgame&&inputs?.battle&&typeof createSession==='function',
 'Tower replay needs a loaded session, saved controller state, verified inputs and a cold-session factory.');
if(!artifactDirectory&&process.env.SUITE_REPLAY_KEEP==='1'){
 artifactDirectory=mkdtempSync(join(tmpdir(),'suite-tower-'+phase+'-'));
 console.log('# retained private Tower replay '+artifactDirectory);
}
if(artifactDirectory)mkdirSync(artifactDirectory,{recursive:true});
let controller=createPostgameController({...inputs,mechanics:inputs.battle,state:structuredClone(saved.metadata.session.postgame)});
controller.resume();
const observer=createFireRedObserver({session,...inputs,runId:fixture.runId??'tower-admission-'+phase,storyWatch:controller.storyWatch()});
const capture=(native,reader)=>{const observation=reader.capture();return {...observation,playerMemory:{...observation.playerMemory,
 postgameEvidence:readPostgameEvidence(native,inputs.runtime,observation)}};};
const members=observation=>[...(observation.playerMemory.trainer.party??[]),
 ...(observation.playerMemory.trainer.storage?.pokemon??[])].filter(p=>p.validity==='valid');
const identities=observation=>members(observation).map(encounterFingerprint).sort();
const before=capture(session,observer),originalIds=identities(before),initialFrame=session.frame;
assert.equal(before.playerMemory.trainer.partyValidity,'valid');
assert.equal(before.playerMemory.trainer.storage?.validity,'valid');
assert.ok(originalIds.length>=6,'The copied checkpoint must expose its complete party and storage.');
const initialSavedGame=before.playerMemory.gameStats.savedGame;
const startedAt=Date.now(),deadline=startedAt+(fixture.timeoutMs??(prizePhase?15*60*1000:3*60*1000));
const maxFrames=fixture.maxFrames??(prizePhase?1_000_000:180_000);
const maxDecisions=fixture.maxDecisions??(prizePhase?180_000:40_000);
const log=artifactDirectory&&join(artifactDirectory,'events.ndjson');if(log)writeFileSync(log,'');
const trace=event=>{if(log)appendFileSync(log,JSON.stringify(event)+'\n');};
const battleLog=diagnose&&artifactDirectory&&join(artifactDirectory,'battle.ndjson');if(battleLog)writeFileSync(battleLog,'');
let result={status:'timeout'},steps=0,last='',restarted=false,sawFirstFloor=false,
 firstFloorCleared=false,sawSecondFloor=false,targetPrize=false,exits=0,previousMap=null,
 maxFloorsCleared=0,observedLoss=false,recordedDefeat=null,prizeSaveBaseline=null,prizeSramHash=null,
 sawModeChoice=false,diagnosticAnchor=false,sawNurseObjective=false,sawChallengeLobby=false,
 sawRestoredLobby=false,after;
try{
 while(Date.now()<deadline&&session.frame-initialFrame<maxFrames&&steps++<maxDecisions){
  const o=capture(session,observer),m=o.playerMemory;
  if(o.phase==='stable'&&m.trainer.partyValidity==='valid'&&m.trainer.storage?.validity==='valid'&&
     JSON.stringify(identities(o))!==JSON.stringify(originalIds)){
   result={status:'identity-loss',frame:o.frame};break;
  }
  if(m.map.id==='MAP_TRAINER_TOWER_1F')sawFirstFloor=true;
  if(m.postgameEvidence?.trainerTower?.[mode]?.floorsCleared>=1)firstFloorCleared=true;
  if(m.map.id==='MAP_TRAINER_TOWER_2F')sawSecondFloor=true;
  if(phase==='double-recovery'&&firstFloorCleared&&m.map.id==='MAP_TRAINER_TOWER_LOBBY'&&
     m.storyState?.variableIds?.[0x4082]===1){
   sawChallengeLobby=true;
   if(partyFullyRestored(m,inputs.battle))sawRestoredLobby=true;
  }
  if(diagnose&&!diagnosticAnchor&&m.map.id==='MAP_TRAINER_TOWER_2F'&&o.emulator.inBattle){
   if(artifactDirectory&&identity)new SaveVault(join(artifactDirectory,'battle-anchor'),identity).write(
    session.saveState(),session.saveSram(),{...saved.metadata,frame:session.frame,
     reason:'isolated-double-loss-battle-anchor',session:{...saved.metadata.session,postgame:controller.state()}});
   diagnosticAnchor=true;
  }
  if(m.postgameEvidence?.trainerTower?.[mode]?.receivedPrize)targetPrize=true;
  if(prizePhase&&targetPrize&&prizeSaveBaseline===null&&o.phase==='stable'){
   prizeSaveBaseline=m.gameStats.savedGame;prizeSramHash=o.sram?.sha256;
   if(artifactDirectory&&identity)new SaveVault(join(artifactDirectory,'prize-pending'),identity).write(
    session.saveState(),session.saveSram(),{...saved.metadata,frame:session.frame,
     reason:'isolated-tower-prize-before-save',session:{...saved.metadata.session,postgame:controller.state()}});
   trace({frame:o.frame,event:'native-prize-observed',savedGame:prizeSaveBaseline});
  }
  maxFloorsCleared=Math.max(maxFloorsCleared,m.postgameEvidence?.trainerTower?.[mode]?.floorsCleared??0);
  if(m.postgameEvidence?.trainerTower?.[mode]?.hasLost)observedLoss=true;
  recordedDefeat??=controller.state().agenda?.workflows?.tower?.defeat??null;
  if(previousMap==='MAP_TRAINER_TOWER_LOBBY'&&m.map.id==='MAP_SEVEN_ISLAND_TRAINER_TOWER')exits++;
  previousMap=m.map.id;
  if(!restarted&&sawFirstFloor&&o.phase==='stable'&&!o.emulator.inBattle){
   controller=createPostgameController({...inputs,mechanics:inputs.battle,state:JSON.parse(JSON.stringify(controller.state()))});
   controller.resume();restarted=true;
   trace({frame:o.frame,event:'controller-restart',map:m.map.id});
  }
  if(phase==='first-floor'&&sawFirstFloor&&firstFloorCleared&&sawSecondFloor&&restarted&&
     o.phase==='stable'&&m.trainer.partyValidity==='valid'&&m.trainer.storage?.validity==='valid'){
   result={status:'first-floor-complete',frame:o.frame};break;
  }
  if(phase==='next-mode'&&o.phase==='stable'&&m.map.id==='MAP_TRAINER_TOWER_1F'&&
     m.storyState?.variableIds?.[0x4082]===1&&m.postgameEvidence?.trainerTowerChallenge===mode&&
     m.postgameEvidence?.trainerTower?.[0]?.receivedPrize===true&&restarted){
   result={status:'next-mode-admitted',frame:o.frame,activeMode:mode,sawModeChoice};break;
  }
  if(phase==='double-recovery'&&sawNurseObjective&&sawChallengeLobby&&sawRestoredLobby&&
     o.phase==='stable'&&m.map.id==='MAP_TRAINER_TOWER_2F'&&
     m.storyState?.variableIds?.[0x4082]===1&&m.postgameEvidence?.trainerTowerChallenge===1&&
     m.postgameEvidence?.trainerTower?.[1]?.floorsCleared===1&&partyFullyRestored(m,inputs.battle)){
   result={status:'double-recovery-retained',frame:o.frame,activeMode:1,floorsCleared:1};break;
  }
  if(prizePhase&&targetPrize&&m.gameStats.savedGame>prizeSaveBaseline&&
     o.sram?.sha256!==prizeSramHash&&
     m.saveAttemptStatus===1&&o.phase==='stable'&&o.emulator.mode==='overworld'&&
     !Object.values(m.ui??{}).some(Boolean)){
   const cold=await createSession();
   try{
    cold.loadSram(session.saveSram());
    const coldObserver=createFireRedObserver({session:cold,...inputs,runId:'tower-admission-cold',storyWatch:controller.storyWatch()});
    const loaded=await continueNativeSaveAsync(cold,coldObserver);
    const verified={...loaded,playerMemory:{...loaded.playerMemory,postgameEvidence:readPostgameEvidence(cold,inputs.runtime,loaded)}};
    assert.deepEqual(identities(verified),originalIds,'Cold Continue must retain every individual.');
    const coldPrize=verified.playerMemory.postgameEvidence?.trainerTower?.[mode]?.receivedPrize;
    result={status:coldPrize?(mode===0?'single-prize-saved':'mode-prize-saved'):'prize-save-not-retained',frame:o.frame,mode,
     coldContinue:true,coldPrize,savedGame:m.gameStats.savedGame};
   }finally{cold.close();}
   break;
  }
  if(prizePhase&&exits>=1&&!targetPrize&&o.phase==='stable'&&m.map.id==='MAP_SEVEN_ISLAND_TRAINER_TOWER'){
   result={status:'exited-before-prize',frame:o.frame,maxFloorsCleared,observedLoss,recordedDefeat};break;
  }
  const decision=controller.decide(o),state=controller.state(),rec=decision.winner?.recommendation;
  if(phase==='double-recovery'&&firstFloorCleared&&state.objective?.target?.map==='MAP_TRAINER_TOWER_LOBBY'&&
     state.objective?.target?.kind==='object')sawNurseObjective=true;
  if(battleLog&&m.map.id==='MAP_TRAINER_TOWER_2F'&&o.emulator.inBattle&&decision.kind==='act'){
   appendFileSync(battleLog,JSON.stringify({frame:o.frame,rec,action:decision.action,
    ui:{battle:m.ui?.battle,party:m.ui?.party,bag:m.ui?.bag,choiceMenu:m.ui?.choiceMenu},
    activeBattler:m.activeBattler,battleMenuBattler:m.battleMenuBattler,battleTypeFlags:m.battleTypeFlags,
    battle:{player:m.battle?.player,opponent:m.battle?.opponent,battlers:m.battle?.battlers,
     battlerPartyIndexes:m.battle?.battlerPartyIndexes,absentBattlerFlags:m.battle?.absentBattlerFlags,
     turn:m.battle?.turn,messageText:m.battle?.messageText},
    party:m.trainer.party.map(p=>({slot:p.slot,species:p.species,hp:p.hp,maxHp:p.maxHp,pp:p.pp,status1:p.status1})),
    bagItems:m.trainer.bag?.items?.filter(i=>[24,25,19,20,21].includes(i.itemId))})+'\n');
  }
  if(state.objective?.id==='postgame-trainer-tower-choose-mode'&&state.objective.choiceByRows?.[5]===mode)
   sawModeChoice=true;
  const event={frame:o.frame,map:m.map.id,started:m.storyState?.variableIds?.[0x4082],
   floor:m.postgameEvidence?.trainerTower?.[mode]?.floorsCleared,prize:m.postgameEvidence?.trainerTower?.[mode]?.receivedPrize,
   hasLost:m.postgameEvidence?.trainerTower?.[mode]?.hasLost,battleOutcome:m.battleOutcome,
   defeat:state.agenda?.workflows?.tower?.defeat?.mode,
   savedGame:m.gameStats?.savedGame,objective:state.objective?.id,target:state.objective?.target?.map,
   decision:decision.kind,reason:decision.reason,recommendation:rec?.kind,recommendationObjective:rec?.objective};
  const signature=JSON.stringify([event.map,event.started,event.floor,event.prize,event.savedGame,
   event.objective,event.decision,event.reason,event.recommendation,event.recommendationObjective]);
  if(signature!==last){trace(event);last=signature;}
  if(decision.kind==='blocked') {result={status:'blocked',frame:o.frame,reason:decision.reason};break;}
  if(prizePhase&&m.storyState?.variableIds?.[0x4082]===1&&
     /^MAP_TRAINER_TOWER_([1-8]F|LOBBY)$/.test(m.map.id)&&
     rec?.objective==='recover-training-party'){
   result={status:'external-recovery-request',frame:o.frame,storyObjective:state.objective,
    recommendation:rec,party:m.trainer.party.map(p=>({species:p.species,level:p.level,hp:p.hp,
     maxHp:p.maxHp,pp:p.pp,moves:p.moves,status1:p.status1})),tower:state.agenda?.workflows?.tower};break;
  }
  if(rec?.objective==='prepare-postgame-trainer-tower-roster'&&
     /^MAP_TRAINER_TOWER_([1-8]F|LOBBY)$/.test(m.map.id)&&m.storyState?.variableIds?.[0x4082]===1){
   result={status:'roster-detour-after-admission',frame:o.frame};break;
  }
  if(decision.kind==='capture-saved'){controller.acknowledgeCapture();continue;}
  const action=decision.action??{buttons:[],holdFrames:8};
  for(let n=0;n<(action.holdFrames??1);n++)session.step(action.buttons??[]);
  for(let n=0;n<(action.releaseFrames??0);n++)session.step([]);
 }
}catch(error){result={status:'error',error:error.stack};}
finally{
 after=capture(session,observer);
 result={...result,phase,mode,elapsedMs:Date.now()-startedAt,
  initialFrame,finalFrame:session.frame,steps,restarted,sawFirstFloor,firstFloorCleared,sawSecondFloor,
  targetPrize,exits,maxFloorsCleared,observedLoss,recordedDefeat,prizeSaveBaseline,sawModeChoice,
  initialSavedGame,finalSavedGame:after.playerMemory.gameStats?.savedGame,
  finalPhase:after.phase,partyValidity:after.playerMemory.trainer.partyValidity,
  storageValidity:after.playerMemory.trainer.storage?.validity,
  identitiesPreserved:after.phase==='stable'&&after.playerMemory.trainer.partyValidity==='valid'&&
   after.playerMemory.trainer.storage?.validity==='valid'&&JSON.stringify(identities(after))===JSON.stringify(originalIds),
  sawNurseObjective,sawChallengeLobby,sawRestoredLobby,
  ...(diagnose?{diagnosticAnchor,battleLog}: {})};
 if(artifactDirectory&&identity&&['first-floor-complete','single-prize-saved','mode-prize-saved','next-mode-admitted','double-recovery-retained','prize-save-not-retained','blocked','timeout','roster-detour-after-admission','exited-before-prize','external-recovery-request'].includes(result.status)){
  const commit=new SaveVault(artifactDirectory,identity).write(session.saveState(),session.saveSram(),
   {...saved.metadata,frame:session.frame,reason:'isolated-tower-'+phase,
    session:{...saved.metadata.session,postgame:controller.state()}});
  result.outputCheckpoint=join(artifactDirectory,'current.json');result.outputStateSha256=commit.stateSha256;
 }
 if(artifactDirectory)writeFileSync(join(artifactDirectory,'result.json'),JSON.stringify(result,null,2)+'\n');
}
const expected=phase==='first-floor'?'first-floor-complete'
 :phase==='next-mode'?'next-mode-admitted'
 :phase==='double-recovery'?'double-recovery-retained'
 :phase==='single-prize'?'single-prize-saved':'mode-prize-saved';
assert.equal(result.status,expected,`Native Tower ${phase} did not reach its required boundary.`);
assert.equal(result.identitiesPreserved,true,'Native Tower replay lost a party or storage identity.');
assert.equal(result.restarted,true,'Native Tower replay did not survive a controller restart.');
if(prizePhase){
 assert.equal(result.coldContinue,true,'Tower prize lacks a cold Continue check.');
 assert.equal(result.coldPrize,true,'Tower prize was not retained by cold Continue.');
 assert.ok(result.finalSavedGame>result.prizeSaveBaseline,'Tower prize lacks a later native save.');
}
return {before,after,result};
}
