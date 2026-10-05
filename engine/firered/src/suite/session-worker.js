#!/usr/bin/env node
// One emulator owner per Suite game. Viewer lifetime and mission lifetime are independent.
import {readFileSync,existsSync,mkdirSync,openSync,closeSync,writeFileSync,unlinkSync,appendFileSync,statSync,renameSync,readdirSync} from 'node:fs';
import {join,resolve} from 'node:path';
import {pathToFileURL} from 'node:url';
import {randomInt,randomUUID} from 'node:crypto';
import {setTimeout as sleep,setImmediate as yieldToIO} from 'node:timers/promises';
import {SaveVault,atomicJson,digest,saveReference} from './save-vault.js';
import {captureSavePreview,createRestoredVideoSession} from './save-preview.js';
import {ensureInitialSave} from './initial-save.js';
import {manualConsoleStart,ConsolePresentationGate,startCommandReady,canAutomate} from './console-power.js';
import {backupGameProfile,readGameProfile,createGameProfileSelection,createHuntSelection,profileStartsNewGame} from './save-profiles.js';
import {SnorlaxMission,ballCount} from './snorlax-mission.js';
import {SafariMission,readSafariStatus} from './safari-mission.js';
import {WildMission} from './wild-mission.js';
import {createSuiteMission,assertHuntHandoff} from './mission.js';
import {canContinuePostgame} from './postgame.js';
import {createPostgameClient} from './postgame-client.js';
import {leagueTrainingSetting} from './league-exp-share.js';
import {qmmPartyHoldsMail} from './qmm-supply.js';
import {fireRedProgress,createEmeraldProgressReader} from './game-progress.js';
import {releaseBlockedHunt,POSTGAME_WATCH,postgamePresentation,readPostgameEvidence,normalizePriorityTarget} from './postgame-agenda.js';
import {campaignPostgameHandoff,settleCompletedCampaign} from './campaign-continuation.js';
import {collectionStorage,assertCaptureCapacity} from './storage-capacity.js';
import {TradePreparation,assertOwnedTradeReady} from './trade-preparation.js';
import {FireRedNativeTradeHost,readNativeWirelessStatus,assertNativeTradeCanStop,nativeTradeFinished} from './native-trade-host.js';
import {NativeRadioLink} from './native-radio.js';
import {createEmeraldCompanion} from './emerald-companion.js';
import {resolveFireRedTravel,LINK_QUEST_WATCH} from './fire-red-link-quest.js';
import {createLocalEvolutionWorker,checkpointLocalEvolution} from './local-evolution-worker.js';
import {inspectFireRedPartnerReadiness,FIRERED_PARTNER_WATCH} from './firered-partner.js';
// extra-saves: exchanges with other owned FireRed saves.
import {emptyPartnerLedger,applyPartnerLegProof} from './extra-save-exchange.js';
import {describeSaveInventory,EXTRA_SAVE_WATCH} from './extra-saves.js';
import {helperTaskAllows} from './extra-save-tasks.js';// extra-saves (build 126)
import {resolveSuiteOwner,ownerNativePair} from './suite-owner.js';
import {proveUncommittedLocalTrade} from './local-evolution.js';
import {createEmeraldNativeTradeAdapter} from './emerald-native-trade.js';
import {continueNativeSave,continueNativeSaveAsync,inspectNativeSaveContinuation,validateNativeTradeContinuation} from './native-cold-boot.js';
import {inspectSavedTradeRecovery,settleNativeLinkError} from './native-trade-recovery.js';
import {encounterFingerprint} from '../player/encounter-tracker.js';
import {resolveSavedEvolutionSource} from './fire-red-evolution.js';
import {findStaticDelay,planStaticShiny,mainRngDistance,generationWaitFrames} from '../rng/fire-red-rng.js';
import {buildWildRngPlan,executeRngPlan} from '../rng/wild-search.js';
import {buildSafariCapturePlan,executeSafariCapturePlan,canRetrySafariCapture,requestedSafariTarget,resumableSafariTargetStop} from '../rng/safari-capture-plan.js';
import {buildProtectedCapturePlan,executeProtectedCapturePlan,canRetryProtectedCapture,canRetryDepletedCapture,canQualifyPostgameCapture,requiresTimedCapture} from '../rng/protected-capture-plan.js';
import {assessRecovery,createRecoveryLedger,replanAfterRecovery,botHealth} from './recovery.js';
import {observeNavigationCycle,navigationRecoveryProgress} from './navigation-cycle.js';
import {BALL_SHOP_WATCH} from './ball-supplies.js';
import {updateShinyCollection,selectShinyForTrade} from './shiny-collection.js';
import {selectInventoryPokemon} from './pokemon-inventory.js';
import {evaluateRngTraits} from '../rng/target-traits.js';
import {createPinnedMgbaSession} from '../emulator/pinned-mgba.js';
import {createAutonomousEmulator} from '../emulator/autonomous-emulator.js';
import {createFireRedObserver} from '../evidence/fire-red-observer.js';
import {createCampaignPlanner} from '../player/campaign.js';
import {createPolicyAdvisors} from '../player/advisors.js';
import {createCentralPlayer,mapRecommendation} from '../player/delegator.js';
import {createLiveViewServer} from '../player/continuous-player.js';
import {updateHuntTiming} from './hunt-timing.js';
import {createSpectatorStatus} from '../presentation/player-status.js';
import {createDecisionFeedBuffer} from '../emulator/autonomous-emulator-worker-runtime.js';
import {loadSuiteCampaignContext} from './campaign-context.js';
import {restoreCampaignRun,createCampaignController,presentCampaignRun} from './campaign-run.js';
import {createPlannerClient} from './planner-client.js';
import {createCampaignBenchmark} from './campaign-benchmark.js';
import {sessionTiming,estimatedEmulationSeconds} from './session-speed.js';
import {updateBoundary} from './update-boundary.js';
import {isFrlgGame,frlgGame} from '../frlg.js';

const json=p=>JSON.parse(readFileSync(p,'utf8'));
const mapped=o=>({id:o.playerMemory?.map?.id,...o.playerMemory?.position});
// The owner key names this save's directory, lock, port, status and RFU owner
// identity. The title is the cartridge: a second FireRed save is the owner
// 'firered-partner' (for example) with title 'firered'. Save identities keep
// the title, so a banked FireRed save stays compatible with either owner.
const [configPath,ownerKey]=process.argv.slice(2),config=json(configPath);
const {owner,title:game,partner:fireRedPartner,helper:fireRedHelper,cfg,directory}=resolveSuiteOwner(config,ownerKey);mkdirSync(directory,{recursive:true,mode:0o700});
// FRLG family (build 124): FireRed and LeafGreen share this engine, observer and
// story campaign. FireRed-only features keep their game==='firered' checks.
const frlg=isFrlgGame(game);
// Opt-in Rare Candy supply (question-mark Mail), from this game's Bot settings.
// Read when a postgame owner is created, so a change applies to the next task.
function qmmSupplyOption(){
 if(game!=='firered')return {enabled:false};
 try{return {enabled:json(join(directory,'bot-settings.json'))?.preferences?.qmmRareCandySupply===true};}catch{return {enabled:false};}
}
// League Exp. Share training and the owner's resume stamp, from the same file. Read
// when a postgame owner is created; a saved change is pushed (bot-settings-changed).
function leagueTrainingOption(){
 if(game!=='firered')return {enabled:false,resumedAt:null};
 try{return leagueTrainingSetting(json(join(directory,'bot-settings.json')));}catch{return leagueTrainingSetting(null);}
}
const maintenancePath=join(directory,'maintenance.json');
if(existsSync(maintenancePath)&&Date.parse(json(maintenancePath).expiresAt)>Date.now())throw Error('This game is applying a verified native save migration. Its owner will resume when that finishes.');
const lockPath=join(directory,'owner.lock');
if(existsSync(lockPath)){
 const owner=json(lockPath);let alive=true;
 try{process.kill(owner.pid,0);}catch(e){if(e.code==='ESRCH')alive=false;else throw e;}
 if(alive)throw new Error('This game already has a session owner.');
 unlinkSync(lockPath);
}
const lock=openSync(lockPath,'wx',0o600);writeFileSync(lock,JSON.stringify({pid:process.pid}));closeSync(lock);
process.on('exit',()=>{try{if(json(lockPath).pid===process.pid)unlinkSync(lockPath);}catch{}});
const {readVerifiedCartridge}=await import(pathToFileURL(join(config.researchBots,'shared/cartridge.js')));
// A FireRed partner always runs its configured native link pair (the reviewed
// peer-trade cartridge and native RFU core); its saves carry that identity.
const partnerNative=ownerNativePair(cfg,{partner:fireRedPartner,helper:fireRedHelper});// helpers too (build 126)
const cartridge=await readVerifiedCartridge(partnerNative?.cartridge??cfg.cartridge);
const baseCoreManifest=json(join(partnerNative?.core??cfg.core,'build-manifest.json'));
const baseIdentity={game,romSha1:cartridge.identity.sha1,coreSha256:baseCoreManifest.mgba_wasm_sha256};
const gameVault=new SaveVault(join(directory,'saves'),baseIdentity);
const imported=await ensureInitialSave(gameVault,cfg,async()=>frlg
 ?createPinnedMgbaSession({coreDirectory:partnerNative?.core??cfg.core,romBytes:cartridge.bytes,cartridge:cartridge.identity,expected:{mgbaCommit:baseCoreManifest.mgba_commit,wrapperCommit:baseCoreManifest.wrapper_commit,mgbaWasmSha256:baseCoreManifest.mgba_wasm_sha256}})
 :(await import(pathToFileURL(join(config.researchBots,'shared/pinned-mgba.js')))).createPinnedMultiSystemSession({coreDirectory:cfg.core,cartridge,system:game==='crystal'?'gbc':'gba'}));
const activePath=join(directory,'active-hunt.json');
const active=existsSync(activePath)?json(activePath):null;
let manualProfile=active?.manual===true;
if(active&&!/^[a-zA-Z0-9_-]{1,100}$/.test(active.id))throw new Error('Invalid hunt save identifier.');
let usingNativeRadio=game==='firered'&&!fireRedPartner&&!!active&&(active.nativeRadio===true||cfg.nativeRadio?.huntId===active.id);
const nativeCartridge=usingNativeRadio&&cfg.nativeRadio.cartridge?await readVerifiedCartridge(cfg.nativeRadio.cartridge):cartridge;
let coreDirectory=usingNativeRadio?cfg.nativeRadio.core:partnerNative?.core??cfg.core;
let coreManifest=json(join(coreDirectory,'build-manifest.json'));
let identity={game,romSha1:nativeCartridge.identity.sha1,coreSha256:coreManifest.mgba_wasm_sha256};
let vault=active?new SaveVault(join(directory,'hunts',active.id,'saves'),baseIdentity):gameVault;
let saved;
if(usingNativeRadio){
 const nativeVault=new SaveVault(join(directory,'hunts',active.id,'native-radio','saves'),identity);
 saved=nativeVault.current()?nativeVault.read():vault.read();vault=nativeVault;
}else saved=vault.read();
let newProfile=saved.metadata?.newProfile===true;
const makeFireRedSession=async (core,manifest)=>createPinnedMgbaSession({coreDirectory:core,romBytes:nativeCartridge.bytes,cartridge:nativeCartridge.identity,expected:{mgbaCommit:manifest.mgba_commit,wrapperCommit:manifest.wrapper_commit,mgbaWasmSha256:manifest.mgba_wasm_sha256}});
let session=frlg||game==='emerald'&&coreManifest.native_rfu
 ? await makeFireRedSession(coreDirectory,coreManifest)
 : await (await import(pathToFileURL(join(config.researchBots,'shared/pinned-mgba.js')))).createPinnedMultiSystemSession({coreDirectory:cfg.core,cartridge,system:game==='crystal'?'gbc':'gba'});
const nativeLinkSave=usingNativeRadio&&(saved.metadata?.ownedTrade?.nativeTrade||saved.metadata?.session?.nativeTrade&&!saved.metadata?.session?.postgame);
const localNativeResume=coreManifest.native_rfu&&saved.metadata?.localEvolution&&saved.metadata.localEvolution.phase!=='complete';
const restoringState=!localNativeResume&&(!usingNativeRadio||manualProfile||saved.metadata?.session?.postgame||(!nativeLinkSave&&['safari-land','wild-land','fishing','gift','static','roamer','snorlax'].includes(saved.metadata?.session?.mission?.method)));
session.loadSram(saved.sram);if(restoringState)session.loadState(saved.state);
const videoSession=createRestoredVideoSession({session,checkpoint:restoringState?saved:null});
const readEmeraldProgress=game==='emerald'?await createEmeraldProgressReader({researchBots:config.researchBots,session}):null;
const emeraldPresentation=game==='emerald'?await import(pathToFileURL(join(config.researchBots,'games/emerald/player/status.mjs'))):null;
const inputs=frlg?Object.fromEntries(['runtime','world','story','battle'].map(k=>[k,json(cfg.inputs[k])])):null;
const basePlanner=inputs?createCampaignPlanner({world:inputs.world,story:inputs.story,mechanics:inputs.battle}):null;
let observer=null,emulator=null,player=null,objective=null,mission=null,running=false,exiting=false,task=null;
let lastCommand=existsSync(join(directory,'command.json'))?json(join(directory,'command.json')).commandId:null,commandError=null,lastObservation=null,lastDecision=null,sequence=saved.metadata?.session?.decisions??0,lastSave=Date.now(),lastProgress=0;
const decisionFeed=createDecisionFeedBuffer({limit:40});
const sessionId=randomUUID();
let updateHold=process.env.POKEMON_SUITE_UPDATE_HOLD==='1'||Boolean(saved.metadata?.updateCheckpoint),updateRequest=null,updateCheckpoint=saved.metadata?.updateCheckpoint??null;
let runtimeLock=config.runtimeLock??null,plannerLock=config.plannerLock??saved.metadata?.plannerLock??null;
let qualification=saved.metadata?.qualification??{schema:'pokemon-suite/qualification/v1',pinned:true,interventions:[],baseline:'legacy-unqualified'};
let resume=saved.metadata?.session??null;
let ownedTrade=saved.metadata?.ownedTrade?.state??null;
if(ownedTrade)resume={...resume,player:saved.metadata.ownedTrade.player,tradePreparation:saved.metadata.ownedTrade.preparation,nativeTrade:saved.metadata.ownedTrade.nativeTrade};
const tradeState=()=>ownedTrade??mission?.state;
let emeraldRuntime=null,emeraldCompanion=null,emeraldActive=false,companionPreparation=saved.metadata?.companionPreparation??null;
// extra-saves: a FireRed partner's open loan and the individuals it may give away (seeded helper saves).
let extraSaveLedger=fireRedPartner?(saved.metadata?.extraSaveLedger??emptyPartnerLedger(cfg.extraSaveGrants??[])):null,extraSaveSourcesAt=null,extraSaveSourcesOwner=null,lastExtraSaveInventory=null;
let localBridge=null,localActive=false,localFrameInput=null;
// The FireRed source coordinates; Emerald and a FireRed partner owner serve.
const localRole=game==='emerald'||fireRedPartner?'partner':'source';
const botPolicyPath=join(directory,'bot-policy.json');
let botPolicy=existsSync(botPolicyPath)?json(botPolicyPath):{enabled:false,mode:'postgame'};
// A power-on launch must not resume saved or queued automation while the
// Suite waits for this owner to acknowledge its manual boot command.
if(process.env.POKEMON_SUITE_MANUAL_LAUNCH==='1'){
 botPolicy={...botPolicy,enabled:false,consolePowered:false};atomicJson(botPolicyPath,botPolicy);
}
const recoveryPath=join(directory,'recovery.json');
const recovery=createRecoveryLedger(existsSync(recoveryPath)?json(recoveryPath):null);
let interruptedRecovery=recovery.state().current?.status==='recovering'?recovery.state().current:null;
let postgame=null,postgameActive=false;
let campaign=null,campaignActive=false;
function restoreCampaign(record,state=null){
 if(record.romSha1!==identity.romSha1)throw Error('The campaign preview belongs to another cartridge. Review the new run again.');
 const {rosterContext}=loadSuiteCampaignContext(configPath,game,owner);
 restoreCampaignRun(record,rosterContext);
 const options={record,...inputs,mechanics:inputs.battle,state,fieldTeamPlan:rosterContext.createFieldTeamPlan(record.teamPlan)};
 const initial=createCampaignController(options);
 return createPlannerClient({module:config.campaignPlanner?pathToFileURL(config.campaignPlanner).href:new URL('./campaign-run.js',import.meta.url).href,options,
  snapshot:{state:initial.state(),storyWatch:initial.storyWatch(),campaignStatus:initial.campaignStatus()}});
}
if(saved.metadata?.campaign)campaign=restoreCampaign(saved.metadata.campaign.record,saved.metadata.campaign.state);
let benchmark=campaign?createCampaignBenchmark({run:campaign.record,mechanics:inputs.battle,state:saved.metadata?.benchmark??null}):null;
const adventurePath=join(directory,'postgame-agenda.json');
let adventureState=existsSync(adventurePath)?json(adventurePath):null;
let postgameSnapshot=null;
const queuedHuntPath=join(directory,'queued-hunt.json');
let queuedHunt=existsSync(queuedHuntPath)?json(queuedHuntPath):null;
if((resume?.postgame||saved.metadata?.postgame)&&inputs)postgame=createPostgameClient({...inputs,mechanics:inputs.battle,qmmSupply:qmmSupplyOption(),leagueTraining:leagueTrainingOption(),state:resume?.postgame??saved.metadata.postgame});
let tradePreparation=null;
let nativeTrade=null;
let nativeRadio=null;
let captureTiming=false;
const collectionPath=join(directory,'shiny-collection.json');
let collectionRecords=existsSync(collectionPath)?json(collectionPath).records:[];
let captureEvidence=resume?.captureEvidence??resume?.player?.encounterSafety?.capture??null;
if(resume?.request)mission=createSuiteMission({id:resume.id,request:resume.request,state:resume.mission,world:inputs?.world,story:inputs?.story,mechanics:inputs?.battle,fundingPlanner:basePlanner});
if(localNativeResume){
 if(game==='firered'){renewObserver();lastObservation=continueNativeSave(session,observer);}
 else if(game==='emerald'){
  await ensureEmeraldRuntime();for(let n=0;n<6000&&!emeraldRuntime.observe().fieldReady;n++)emeraldRuntime.stepFrame();
  if(!emeraldRuntime.observe().fieldReady)throw Error('The reserved evolution native save did not continue to the field.');
 }
 const local=saved.metadata.localEvolution;
 if(['connecting','trading','waiting','paused','reconciling'].includes(local.phase)&&!local.receipt){
  try{
   const adapter=game==='emerald'?await createEmeraldNativeTradeAdapter({runtime:emeraldRuntime,researchBots:config.researchBots}):null;
   const o=adapter?adapter.capture():lastObservation,w=adapter?adapter.wireless():readNativeWirelessStatus(session,inputs.runtime);
   if(digest(session.saveSram())!==saved.sramSha256)throw Error('The native save changed during restart verification.');
   local.restartProof=proveUncommittedLocalTrade({game,...(local.reservation?.roles?{role:localRole,owner}:{}),state:local,observation:o,wireless:w,sramSha256:saved.sramSha256});
   local.phase='reconciling';local.reason='This native save contains the original party. Waiting for the other owner to verify before retrying the exchange.';
  }catch(error){local.restartProof=null;local.phase='waiting';local.reason=error.message;}
 }
 if(local.phase==='evolving')local.evolutionActivity=null;
}
// mGBA restores machine state before repainting its video buffer. Repaint a
// completed Center save with neutral input so a paused viewer is not black.
if(usingNativeRadio&&!manualProfile&&!resume?.postgame&&(!['safari-land','wild-land','fishing','gift','static','roamer','snorlax'].includes(mission?.state.method)||nativeLinkSave)){
 const loaded=continueNativeSave(session,observer),fingerprint=resume?.tradePreparation?.fingerprint;
 if(!fingerprint)throw new Error('The native radio save must identify its prepared Pokémon.');
 const continuation=validateNativeTradeContinuation(loaded,readNativeWirelessStatus(session,inputs.runtime),resume?.nativeTrade??{fingerprint});
 session.attachWireless();
 if(resume?.nativeTrade)resume.nativeTrade={...resume.nativeTrade,phase:continuation==='ready'?'traveling':continuation,advertising:false,serviceMenuClosed:false,radio:null,reason:null};
 if(continuation==='complete'){tradeState().status='complete';tradeState().phase='native-trade-complete';tradeState().reason='Native trade and saved received Pokémon verified.';}
 if(continuation==='cancelled'){
  tradeState().status='cancelled';tradeState().phase='native-trade-cancelled';
  tradeState().reason=resume.nativeTrade.cancellation.reason;resume.nativeTrade.reason=tradeState().reason;
  botPolicy={...botPolicy,enabled:true,awaitingCommand:true,consolePowered:true,runScope:'task'};atomicJson(botPolicyPath,botPolicy);
 }
 if(continuation==='saved-exit-incomplete'){
  const reason='The received Pokémon is verified in the native save. The previous link exit was interrupted; this exchange will not be repeated.';
  tradeState().status='blocked';tradeState().phase='native-trade-saved-exit-incomplete';tradeState().reason=reason;
  resume.nativeTrade.reason=reason;resume.nativeTrade.completion.nativeSaveVerified=true;
  // Old versions incorrectly used their own return menu as handshake proof.
  resume.nativeTrade.completion.handshakeVerified=false;
 }
 persist('native-radio-cold-boot');
}else if(resume?.tradePreparation?.phase==='ready'&&resume.tradePreparation.nativeSaveVerified){session.step([]);session.step([]);}
if(mission?.state.status==='running'){mission.state.status='paused';mission.state.reason='Session resumed from its saved checkpoint. Resume the hunt to continue.';}
let resumeActiveTask=canAutomate(botPolicy)&&resume?.mission?.status==='running'&&!resume?.postgame&&mission?.state.status==='paused';
if(interruptedRecovery?.huntId===mission?.state.id)resumeActiveTask=false;
function observe(){
 let o=observer?.capture()??null;
 if(o&&frlg)o={...o,playerMemory:{...o.playerMemory,postgameEvidence:readPostgameEvidence(session,inputs.runtime,o)}};
 return o&&(postgameActive||mission?.state.method==='safari-land')?{...o,playerMemory:{...o.playerMemory,safari:readSafariStatus(session,inputs.runtime,o.playerMemory.battleTypeFlags)}}:o;
}
function renewObserver(){
 if(inputs){const watch=campaignActive?campaign.storyWatch():postgameActive?postgame.storyWatch():basePlanner.storyWatch();observer=createFireRedObserver({session,runtime:inputs.runtime,world:inputs.world,story:inputs.story,observeRng:Boolean(mission),runId:mission?.state.id??campaign?.record.id??`suite-${game}`,storyWatch:{...watch,variables:[...new Set([...(watch.variables??[]),...LINK_QUEST_WATCH.variables,...BALL_SHOP_WATCH.variables,...POSTGAME_WATCH.variables,...EXTRA_SAVE_WATCH.variables])],flags:[...new Set([...watch.flags,...LINK_QUEST_WATCH.flags,...BALL_SHOP_WATCH.flags,...POSTGAME_WATCH.flags,...EXTRA_SAVE_WATCH.flags,...(mission?.storyWatch?.().flags??[]),84,128,573,611,2092,2112,2116])]}});}
}
const consolePresentation=new ConsolePresentationGate();
function engine(mode='manual',paused=false,speed){
 consolePresentation.clear();
 emulator?.close();renewObserver();
 emulator=createAutonomousEmulator({session,...sessionTiming({game,speed,manual:mode==='manual',radio:Boolean(nativeRadio),local:localActive}),frameExact:Boolean(campaignActive||localActive||emeraldActive||postgameActive||mission&&(!mission.state.protected||mission.state.method==='roamer'||captureTiming)),botFrameInput:localActive?localFrameInput:emeraldActive?stepEmeraldCompanion:null,canAdvanceFrame:()=>(nativeRadio?.canAdvanceFrame()??true)&&(localBridge?.canAdvanceFrame()??true),controllerState:observer?()=>observer.captureControllerState():null,actionObservation:observer?()=>observe():null,startPaused:paused});
 if(mode==='manual'&&!paused)emulator.setControlMode('manual');
}
function createPlayer(initialState=null,capture=false){
 if(capture&&mission?.state.utilityCapture&&initialState?.encounterSafety?.blocked==='capture-balls-exhausted'&&!initialState.encounterSafety.capture?.caught){
  initialState=structuredClone(initialState);initialState.encounterSafety.blocked=null;
 }
 const planner={...basePlanner,select:()=>objective,selectCollection:()=>null,selectTraining:()=>null,selectBattleSquad:()=>[],campaignStatus:()=>({objective:objective?.id}),state:()=>({mission:mission?.state.id,objective})};
 return createCentralPlayer({advisors:createPolicyAdvisors({world:inputs.world,mechanics:inputs.battle,campaignPlanner:planner}),campaignPlanner:planner,initialState,mechanics:inputs.battle,
  ...(capture||mission instanceof WildMission||mission?.state.method==='roamer'?{huntConfig:mission.capturePolicy(),captureRequirements:mission.captureRequirements()}:{}),});
}
function persist(reason){
 const startedAt=performance.now();sampleBenchmark();flushBenchmarkDiagnostics();
 mission?.checkpoint?.();
 if(lastObservation?.playerMemory?.saveFileStatus===1)newProfile=false;
 const sram=Buffer.from(session.saveSram()),state=Buffer.from(session.saveState());
 const metadata={frame:session.frame,reason,session:mission?{id:mission.state.id,request:mission.request,mission:mission.state,player:player?.state()??resume?.player??null,captureEvidence:captureEvidence??player?.state()?.encounterSafety?.capture??null,tradePreparation:tradePreparation?.state??resume?.tradePreparation??null,nativeTrade:nativeTrade?.state??resume?.nativeTrade??null,decisions:sequence}:null};
 metadata.preview=captureSavePreview({session:videoSession,stateSha256:digest(state)});
 if(metadata.session)metadata.session.postgame=postgame?.state()??null;
 else metadata.postgame=postgame?.state()??null;
 if(postgame?.state().agenda?.enabled){adventureState=structuredClone(postgame.state().agenda);atomicJson(adventurePath,adventureState);}
 metadata.ownedTrade=ownedTrade?{state:ownedTrade,player:player?.state()??resume?.player??null,preparation:tradePreparation?.state??resume?.tradePreparation??null,nativeTrade:nativeTrade?.state??resume?.nativeTrade??null}:null;
 metadata.runtimeLock=runtimeLock;metadata.plannerLock=plannerLock;metadata.runtimeComponents=config.runtimeComponents??{};metadata.qualification=qualification;
 metadata.updateCheckpoint=updateCheckpoint;
 metadata.manualProfile=manualProfile;
 metadata.newProfile=newProfile;
 if(campaign)metadata.campaign={record:campaign.record,state:campaign.state()};
 if(benchmark)metadata.benchmark=benchmark.state();
 metadata.manualControl=emulator?.controlState().mode==='manual';
 if(game==='emerald'||fireRedPartner)metadata.companionPreparation=emeraldCompanion?.state()??companionPreparation;
 if(fireRedPartner)metadata.extraSaveLedger=extraSaveLedger;// extra-saves
 metadata.localEvolution=checkpointLocalEvolution(localBridge,saved.metadata?.localEvolution);
 const commit=vault.write(state,sram,metadata);refreshCollection();lastSave=Date.now();benchmark?.measure('persistence',performance.now()-startedAt);return commit;
}
function sampleBenchmark(){
 if(!benchmark||!campaign||!lastObservation)return;
 benchmark.sample({observation:lastObservation,campaign:campaign.benchmarkState(),sessionId,runtimeLock,
  speed:emulator?.controlState().configuredEmulationSpeed??1,controlMode:emulator?.controlState().mode??'bot',qualification});
}
function flushBenchmarkDiagnostics(){
 const events=benchmark?.pendingEvents()??[];if(!events.length)return;
 try{
  appendFileSync(join(directory,`campaign-diagnostics-${campaign.record.id}.jsonl`),events.map(event=>JSON.stringify({...event,sessionId})).join('\n')+'\n',{mode:0o600});
  benchmark.ackEvents(events.at(-1).sequence);
 }catch(error){benchmark.archiveError(error.message);}
}
function refreshCollection(capture=null,requestId=mission?.state.id,trade=null){
 const current=player?.state()?.encounterSafety?.capture??resume?.player?.encounterSafety?.capture??captureEvidence;
 const enriched=current?.pokemon&&mission?{...current,traits:evaluateRngTraits(current.pokemon,mission.request,inputs?.battle)}:current;
 const records=updateShinyCollection({game,records:collectionRecords,capture:capture??enriched,requestId,observation:lastObservation,trade:trade??nativeTrade?.state??resume?.nativeTrade});
 if(JSON.stringify(records)!==JSON.stringify(collectionRecords)){collectionRecords=records;atomicJson(collectionPath,{schema:'pokemon-suite/shiny-collection/v1',game,records});}
}
function status(){
 if(emeraldRuntime && emeraldRuntime.lastObservation?.frame!==session.frame)emeraldRuntime.observe();
 const o=lastObservation,m=o?.playerMemory;
 const e=emeraldRuntime?.lastObservation,companion=emeraldCompanion?.state()??companionPreparation;
 const local=localBridge?.status(),localBusy=localBridge?.busy();
 const companionReturned=game==='emerald'&&local?.phase==='complete'&&local.requestId===companion?.requestId;
 const recoveryStatus=recovery.state().current,health=botHealth({enabled:botPolicy.enabled,running,mission:mission?.state,postgame:postgameActive||!running?postgame?.state():null,recovery:recoveryStatus?.huntId===mission?.state.id?recoveryStatus:null});
 const huntPreparation=mission?.preparer?.state();
 const agenda=postgame?.state().agenda??(botPolicy.runScope==='postgame'?adventureState:null);
 const manualPlaying=emulator.controlState().mode==='manual'&&!emulator.controlState().paused;
 const campaignState=campaign?.state(),campaignOwner=campaign&&botPolicy.runScope==='campaign';
 let inventoryReason=null;
 if(game==='firered')try{assertOwnedTradeReady({observation:o,mission:mission?.state,capture:postgame?.state().player?.encounterSafety?.capture??player?.state()?.encounterSafety?.capture??captureEvidence,campaign:campaignState,running,localBusy,nativeTrade:nativeTrade?.state??resume?.nativeTrade,wireless:readNativeWirelessStatus(session,inputs.runtime)});}catch(error){inventoryReason=error.message;}
 return decisionFeed.update({runtime:{protocol:1,qualification,components:config.runtimeComponents??{},plannerIsolation:'worker-thread',lock:runtimeLock,plannerLock,update:{id:updateRequest?.id??null,held:updateHold&&Boolean(updateCheckpoint),checkpoint:updateCheckpoint,boundary:updateBoundary({game,observation:o,mission:mission?.state,nativeTrade:nativeTrade?.state,localBusy,captureTiming,postgameActive,postgameYieldReady:postgame?.canYield(o)===true,emeraldActive})}},schema:'pokemon-suite/session/v1',sessionId,pid:process.pid,game,owner,runId:ownedTrade?.id??mission?.state.id??`suite-${game}`,state:botPolicy.enabled&&botPolicy.awaitingCommand?'ready':manualPlaying?'running':frlg?health.status:running?'running':botPolicy.enabled?'ready':mission?.state.status??'viewer',frame:session.frame,emulationSpeed:emulator.controlState().effectiveEmulationSpeed,
  performance:emulator.metrics(),benchmark:benchmark?.summary({compact:true})??null,
  phase:ownedTrade?ownedTrade.phase:localBusy?'evolution-'+local.phase:emeraldActive?'companion-preparation':postgameActive?'postgame':running?mission?.state.phase:mission?.state.status??'manual',decisions:sequence,updatedAt:new Date().toISOString(),map:m?.map?.id??e?.player?.map?.id??null,position:m?.position??e?.player?.position??null,mode:o?.emulator?.mode??e?.emulator?.mode??null,callback2:o?.emulator?.callback2??e?.emulator?.callback2Name??null,
  bot:{...botPolicy,progress:health.progress??null,activity:botPolicy.awaitingCommand?'ready':localBusy?'evolution':emeraldActive?'campaign':postgameActive?'postgame':running?'task':'ready',status:botPolicy.awaitingCommand?'ready':localBusy?local.phase:companion?.phase??health.status,reason:botPolicy.awaitingCommand?'Ready for commands. Choose a task in Bot settings.':localBusy?local.reason:companionReturned?'Evolution returned to FireRed and saved. Ready for the next command.':companion?.reason??health.reason,objective:botPolicy.awaitingCommand?null:companion?.objective??huntPreparation?.objective??postgame?.state().objective??null,captures:huntPreparation?.captures??postgame?.state().captures??0,preparation:companion??huntPreparation?.preparation??postgame?.state().preparation??null},
  recovery:recoveryStatus,
  localEvolution:local??null,
  // extra-saves: the main save's plan rows; a partner's inventory and open loan.
  ...(game==='firered'&&!fireRedPartner?{extraSaves:postgame?.state().agenda?.workflows?.extraSaves?.presentation??adventureState?.workflows?.extraSaves?.presentation??null}:{}),
  // Story flags are read only from a stable field frame (the save blocks move during map loads).
  ...(fireRedPartner?{extraSaveInventory:o?.phase==='stable'?(lastExtraSaveInventory=describeSaveInventory({observation:o,world:inputs.world,source:{kind:'partner-owner',owner,label:cfg.label??owner,grants:extraSaveLedger?.grants??[]},roamer:m?.postgameEvidence?.roamer??null})):lastExtraSaveInventory,
   extraSaveLedger:extraSaveLedger?{open:extraSaveLedger.open?{exchangeId:extraSaveLedger.open.exchangeId,mode:extraSaveLedger.open.mode,sourceOwner:extraSaveLedger.open.sourceOwner}:null,grants:extraSaveLedger.grants.length}:null}:{}),
  lastCommand,commandError,save:{updatedAt:gameVault.current()?.updatedAt,frame:gameVault.current()?.metadata?.frame,imported},
  // A blank New Game profile (no in-game save yet): a goal starts a new game.
  newProfile:frlg?newProfile:null,huntSave:mission?{updatedAt:vault.current()?.updatedAt,frame:vault.current()?.metadata?.frame}:null,
  gameProgress:frlg?fireRedProgress(o,game):readEmeraldProgress?.()??null,
  storage:frlg?collectionStorage(m?.trainer,{scope:botPolicy.runScope,records:collectionRecords,quantity:mission?.request.quantity??0,caught:mission?.state.caught??0}):null,
  postgame:game==='firered'&&o?(postgameSnapshot=postgamePresentation(o,agenda,postgameSnapshot)):null,
  pendingHunt:queuedHunt?{id:queuedHunt.record.id,state:queuedHunt.error?'blocked':'queued',phase:'waiting-for-current-game',caught:0,encounters:0,elapsedMs:0,reason:queuedHunt.error??'Finish the current battle and save, then start this hunt.'}:null,
  tradePreparation:tradePreparation?.state??resume?.tradePreparation??null,
  tradeTask:ownedTrade,tradeSupport:{inventory:true,nativeRadio:usingNativeRadio,missionReady:Boolean(mission?.state.protected),inventoryReady:game==='firered'&&inventoryReason===null,inventoryReason,radioBinding:true,radioAppliance:true},
  collection:collectionRecords.map(r=>({...r,canTrade:Boolean(!localBusy&&r.owned&&r.nativeSaveVerified&&(!running||postgameActive&&postgame.canYield(o))&&usingNativeRadio&&(nativeTradeFinished(nativeTrade?.state??resume?.nativeTrade)||(!(nativeTrade?.state??resume?.nativeTrade)?.exchangeStarted&&(nativeTrade?.state??resume?.nativeTrade)?.fingerprint===r.fingerprint))),tradeAvailable:usingNativeRadio})),
  nativeTrade:nativeTrade?.state??resume?.nativeTrade??null,
  mission:mission?{timing:updateHuntTiming(mission.state,{running:running&&!postgameActive,sessionId}),shiny:mission.request.shiny,name:mission.state.route?.name??null,id:mission.state.id,speciesId:mission.request.speciesId,method:mission.state.method??'static-reset',safari:m?.safari??null,foundSpecies:mission.state.foundSpecies??null,state:running&&!postgameActive?'running':mission.state.status??'paused',phase:mission.state.phase,encounters:mission.state.encounters,resets:mission.state.resets,repeated:mission.state.repeated,elapsedMs:mission.state.elapsedMs,caught:mission.state.caught??(mission.state.status==='complete'?1:0),quantity:mission.request.quantity,reason:mission.state.reason??null,route:mission.state.route?.map,protected:mission.state.protected,limits:mission.request.limits,selectedShiny:mission.state.selectedShiny,capturePlan:mission.state.capturePlan,rng:mission.state.rng?{method:mission.state.rng.method??'calibrated-static',phase:mission.state.rng.phase,delay:mission.state.rng.delay,attempts:mission.state.rng.attempts,lastResult:mission.state.rng.lastResult,remainingAdvances:mission.state.rng.remainingAdvances,estimatedSeconds:mission.state.rng.estimatedSeconds,candidates:mission.state.rng.candidates,reason:mission.state.rng.reason,completed:mission.state.rng.completed,total:mission.state.rng.total,traits:mission.state.rng.traits}:null}:null,
  consolePresentation:consolePresentation.status(),control:emulator?.controlState(),observation:o?{frame:o.frame,phase:o.phase,map:m.map,position:m.position,mode:o.emulator.mode,party:m.trainer?.party?.map(p=>({species:p.species,level:p.level,hp:p.hp,maxHp:p.maxHp})),money:m.trainer?.money}:e?{frame:e.frame,map:e.player?.map,position:e.player?.position,mode:e.emulator.mode,party:e.party.map(p=>({species:p.species,level:p.level,hp:p.hp,maxHp:p.maxHp})),money:e.player?.money}:null,
  spectator:e?emeraldPresentation.createSpectatorStatus({observation:e,tables:emeraldRuntime.tables,campaignStatus:emeraldRuntime.story.status(e),decision:emeraldRuntime.lastDecision}):o?createSpectatorStatus({observation:o,mechanics:inputs.battle,decision:lastDecision,campaignStatus:{activeObjective:{id:postgameActive?(postgame.state().objective?.id??'Ready for commands'):mission?`${mission.request.shiny==='required'?'Shiny ':''}${mission.state.route?.name??(mission.request.speciesId===143?'Snorlax':`Pokémon ${mission.request.speciesId}`)}`:'Manual play'}}}):null,
  winner:lastDecision?.winner??null,
  decision:lastDecision?{sequence,kind:lastDecision.kind,reason:lastDecision.reason,recommendation:lastDecision.winner?.recommendation,action:lastDecision.action}:null,
  ...(campaign?{campaign:presentCampaignRun(campaign.record,campaignState,campaign.storyProgress(o))}:{}),
  ...(campaignOwner?{runId:campaign.record.id,state:campaignActive?'running':campaignState.status,
   phase:campaignState.status,save:{updatedAt:vault.current()?.updatedAt,frame:vault.current()?.metadata?.frame},
   bot:{...botPolicy,progress:health.progress??null,activity:'campaign',status:campaignState.status,reason:campaignState.reason??'Playing the selected story campaign.',objective:campaignState.objective,captures:0,preparation:null},
   spectator:o?createSpectatorStatus({observation:o,mechanics:inputs.battle,decision:lastDecision,campaignStatus:campaign.campaignStatus()}):null}:{}),
 });
}
function progress(){flushBenchmarkDiagnostics();atomicJson(join(directory,'status.json'),status());lastProgress=Date.now();}
function stop(reason,statusName='paused'){
 if(campaignActive){
  running=false;emulator.pause(reason);campaignActive=false;
  if(statusName==='blocked'){campaign.wait(reason);recoveryReport(reason);}else campaign.pause(reason);
  persist(reason);progress();return;
 }
 if(recovery.state().current?.status==='recovering')finishRecovery(statusName==='complete'?'recovered':statusName==='paused'?'cancelled':'failed',reason);
 if(statusName==='blocked')recoveryReport(reason);
 if(emeraldActive){running=false;emulator.pause(reason);emeraldActive=false;persist(reason);progress();return;}
 if(postgameActive){running=false;emulator.pause(reason);postgame.wait(reason);postgameActive=false;persist(reason);progress();return;}
 running=false;emulator.pause(reason);
 nativeRadio?.close();nativeRadio=null;
 if(game==='firered'&&nativeTrade){settleNativeLinkError(session,observe);lastObservation=observe();}
 if(nativeTrade){nativeTrade.state.advertising=false;nativeTrade.state.radio=null;}
 if(ownedTrade){ownedTrade.status=statusName;ownedTrade.reason=reason;botPolicy={...botPolicy,enabled:false,awaitingCommand:false};atomicJson(botPolicyPath,botPolicy);}
 else if(mission){mission.state.status=statusName;mission.state.reason=reason;}
 if(!ownedTrade&&statusName==='complete'&&botPolicy.runScope==='task'&&!mission?.state.continuation){
  botPolicy={...botPolicy,enabled:true,awaitingCommand:true};atomicJson(botPolicyPath,botPolicy);engine('bot',true,1);
 }
 persist(reason);progress();
}
function finishRecovery(state,reason){recovery.finish(state,reason);atomicJson(recoveryPath,recovery.state());interruptedRecovery=null;}
function recoveryReport(reason){
 const report={schema:'pokemon-suite/recovery-report/v1',at:new Date().toISOString(),game,sessionId,reason,mission:mission?.state,postgame:postgame?.state(),campaign:campaign?{record:campaign.record,state:campaign.state()}:null,recovery:recovery.state().current,save:saveReference(vault.current()),frame:session.frame,map:mapped(lastObservation??{}),capture:player?.state()?.encounterSafety?.capture??captureEvidence};
 const reports=join(directory,'recovery-reports');mkdirSync(reports,{recursive:true,mode:0o700});
 atomicJson(join(reports,`${mission?.state.id??game}-${recovery.state().current?.startedAt??Date.now()}.json`),report);
 atomicJson(join(directory,'recovery-report.json'),report);
 console.error(JSON.stringify({event:'suite-recovery-report',game,reason,path:join(directory,'recovery-report.json')}));
}
function recoveryCandidate(){return assessRecovery({enabled:canAutomate(botPolicy),running,manual:emulator.controlState().mode==='manual',localBusy:localBridge?.busy(),mission:mission?.state,postgame:postgame?.state(),evidence:player?.state()?.encounterSafety?.capture??captureEvidence,wireless:readNativeWirelessStatus(session,inputs.runtime),nativeTrade:nativeTrade?.state??resume?.nativeTrade,interruptedRecovery,observation:observe()});}
async function tryAutomaticRecovery(){
 if(recoveryCandidate().action==='none')return;
 await task;
 const candidate=recoveryCandidate(),attempt=recovery.begin({...candidate,startedFrame:session.frame});
 if(!attempt.allowed){
  if(attempt.reason==='attempt-limit'&&recovery.state().current?.status!=='needs-review'){
   finishRecovery('needs-review','Three recovery attempts failed. The current game and diagnostic report are preserved.');recoveryReport('Automatic recovery attempt limit reached.');progress();
  }
  return;
 }
 // Persist the budget and diagnostics before any new game input. A controller
 // crash can resume this incident, but cannot reset its attempt count.
 atomicJson(recoveryPath,recovery.state());interruptedRecovery=null;recoveryReport(`Automatic ${candidate.action}: ${candidate.reason}`);
 if(candidate.action==='resume-postgame'){await startPostgame();return;}
 mission.state.status='running';mission.state.reason=null;running=true;
 player=createPlayer(replanAfterRecovery(player?.state()??resume?.player),mission.state.protected);
 if(candidate.reason==='repeated-navigation-cycle')mission.state.navigationWatch={};
 engine('bot',candidate.action==='retry-capture');progress();
 task=(async()=>{
  try{
   if(candidate.action==='retry-capture')await runSuiteProtectedCapture(mission.state.method==='safari-land');
   if(running)await runMission();
  }catch(error){console.error(error.stack);if(running)stop(error.message,'blocked');}
 })();
}
function verifyRecoveryProgress(o){
 const current=recovery.state().current;
 if(current?.status!=='recovering'||current.action==='retry-capture'||session.frame<(current.startedFrame??session.frame)+60)return;
 if(current.cycle&&!navigationRecoveryProgress(current.cycle,mission?.state.navigationWatch,o))return;
 const capture=postgameActive?postgame.state().player?.encounterSafety?.capture:player?.state()?.encounterSafety?.capture;
 if(o.phase==='stable'&&o.emulator.mode==='overworld'&&!o.emulator.inBattle&&!Object.values(o.playerMemory.ui??{}).some(Boolean)&&(!capture||capture.nativeSaveVerified))finishRecovery('recovered','Native field progress resumed with no unfinished capture or save.');
}
if(game==='emerald'){
 await ensureEmeraldRuntime();
 // State restoration leaves mGBA's presentation buffer empty. Repaint only
 // an idle field checkpoint; reserved evolution and link timing stay intact.
 if(!localNativeResume&&emeraldRuntime.observe().fieldReady){session.step([]);session.step([]);}
 emeraldRuntime.observe();
}
engine('manual',Boolean(botPolicy.awaitingCommand||botPolicy.consolePowered===false||!saved.metadata?.manualControl&&(mission||localNativeResume||game==='emerald')));
if(updateHold)emulator.pause('Verifying updated game worker.');
lastObservation=observe();
// Engines before 109 blocked a requested non-shiny Safari target as unreadable
// before capture planning. At its exact, unsaved protected encounter that stop
// resumes like an interrupted hunt; the capture re-verifies before any input.
if(mission&&resumableSafariTargetStop({observation:lastObservation,state:mission.state,request:mission.request,matches:p=>mission.matches(p),evidence:captureEvidence})){
 mission.state.status='paused';mission.state.reason='Session resumed from its saved checkpoint. Resume the hunt to continue.';
 resumeActiveTask=canAutomate(botPolicy)&&!resume?.postgame&&interruptedRecovery?.huntId!==mission.state.id;
}
// Import saved capture receipts from prior hunts, then reconcile their identities
// against this game's current party and PC. Historical receipts never load saves.
const huntDirectory=join(directory,'hunts');
if(existsSync(huntDirectory))for(const id of readdirSync(huntDirectory).filter(id=>/^[a-zA-Z0-9_-]{1,100}$/.test(id)).slice(0,1000)){
 for(const path of [join(huntDirectory,id,'saves','current.json'),join(huntDirectory,id,'native-radio','saves','current.json')]){
  if(!existsSync(path))continue;
  try{const s=json(path).metadata?.session,candidates=[s?.player?.encounterSafety?.capture,s?.captureEvidence];for(const c of candidates)if(c?.nativeSaveVerified)refreshCollection(c,id,s?.nativeTrade);}catch(error){console.error('Could not read prior shiny receipt:',error.message);}
 }
}
refreshCollection();
const control={controlState:()=>emulator.controlState(),setControlMode(mode){
 if(running&&mode==='manual')throw new Error('Stop the hunt in Farming before taking manual control.');
 if(!running&&mode==='bot')throw new Error('Start or resume a saved hunt from Farming.');
 if(mission&&!running)throw new Error('This hunt is paused with its save preserved. Resume it from Farming.');
 return emulator.setControlMode(mode);
},setManualButtons:buttons=>emulator.setManualButtons(buttons)};
const live=await createLiveViewServer({session:videoSession,audioSource:session,control,getStatus:status,port:cfg.port});
progress();console.log(JSON.stringify({event:'suite-session-ready',game,sessionId,url:live.url,frame:session.frame}));

// Resolve native timing before the central player records a submitted action.
// Waiting keeps the existing menu evidence; it does not spend or reset retries.
function timedAcquisition(o,decision){
 if(mission.request.shiny!=='required'||!((mission instanceof SnorlaxMission&&!mission.state.protected&&mission.state.phase==='hunting'&&
    o.playerMemory.map?.id===mission.state.route.map&&o.playerMemory.ui?.choiceMenu&&
    decision.winner?.recommendation?.kind==='choose-menu-option'&&decision.winner.recommendation.targetOption==='yes'&&decision.action?.buttons?.includes('a'))||mission.generationTrigger?.(o,decision)))return null;
 const sample=o.playerMemory.rng,otId=o.playerMemory.trainer?.otId;
 if(sample?.validity!=='valid'||!Number.isInteger(otId))return {kind:'stop',reason:'The RNG seed or trainer identity could not be read.'};
 let rng=mission.state.rng;
 if(!rng){
  rng=mission.state.rng={phase:'calibrating',delay:null,attempts:0,attemptSeed:null,target:null,boundary:mission.generationBoundary?.()};
 }
 if(!rng.anchor)rng.anchor=saveReference(persist('before-timed-acquisition'));
 if(rng.attemptSeed===null){
  if(rng.delay!==null){
   let distance=rng.target?mainRngDistance(sample.mainState,rng.target.confirmationState,100000):null;
   if(distance===null){rng.target=planStaticShiny({state:sample.mainState,otId,delay:rng.delay,matches:p=>evaluateRngTraits({...p,species:mission.request.speciesId,level:mission.state.route.level??30},mission.request,inputs.battle).matched});distance=rng.target?.advances??null;}
   if(distance===null)return {kind:'stop',reason:'No shiny RNG candidate was found within the bounded search.'};
   rng.remainingAdvances=distance;rng.phase='waiting';
   if(distance>0)return {kind:'wait',reason:'waiting-for-shiny-rng',holdFrames:mission.generationWaitFrames?.(distance)??generationWaitFrames(distance)};
  }
  rng.attemptSeed=sample.mainState;rng.phase='encounter';rng.remainingAdvances=0;
 }
 return null;
}

async function runMission(){
 let tick=Date.now();
 try{
  while(running&&!exiting){
   const now=Date.now();mission.state.elapsedMs+=now-tick;tick=now;
   lastObservation=observe();const o=lastObservation;
   if(!mission.state.protected&&o.phase==='stable'&&o.emulator.mode==='overworld'&&!o.emulator.inBattle&&!Object.values(o.playerMemory.ui??{}).some(Boolean))assertCaptureCapacity(o.playerMemory.trainer,{quantity:Math.max(1,mission.request.quantity-(mission.state.caught??0))});
   verifyRecoveryProgress(o);
   // The completed story player deliberately stops at Hall of Fame. A new,
   // explicit postgame task may acknowledge that screen and roll the credits.
   if(o.emulator.mode==='hall-of-fame'){
    if(mission.state.elapsedMs>=mission.request.limits.maxMinutes*60000){stop('Maximum hunt time reached.','blocked');break;}
    lastDecision={kind:'act',reason:'continue-completed-game',action:{buttons:['a'],holdFrames:1,releaseFrames:59}};
    await emulator.execute(lastDecision.action);
    if(Date.now()-lastSave>30000)persist('postgame-credits');
    if(Date.now()-lastProgress>1000)progress();
    continue;
   }
   const preparing=mission.preparationController?.(o);
   if(preparing){await runHuntPreparation(preparing,o);continue;}
   const next=mission.inspect(o,{videoFrame:()=>session.videoFrame(),captureEvidence:player?.state()?.encounterSafety?.capture??captureEvidence});
   if(next.kind==='roamer-fled'){captureEvidence=null;resume=null;player=createPlayer();persist('verified-roamer-flight');progress();continue;}
   if(next.kind==='gift-found'){
    mission.state.protectedAnchor=saveReference(persist('protected-gift'));player=createPlayer();progress();continue;
   }
   if(next.kind==='gift-saved'){
    captureEvidence=next.capture;refreshCollection(next.capture);mission.state.phase='complete';stop('Gift received, saved in game, and identity verified.','complete');
    if(mission.request.afterCompletion==='prepare-trade')atomicJson(join(directory,`trade-ready-${mission.state.id}.json`),{schema:'pokemon-suite/trade-preparation/v1',requestId:mission.state.id,pokemon:next.capture.pokemon,fingerprint:next.capture.fingerprint,save:vault.current(),competitive:mission.request.competitive??null,state:'saved-awaiting-partner'});
    break;
   }
   if(next.kind==='rng'){await runSuiteWildRng();continue;}
   if(next.kind==='stop'){if(next.protected)mission.state.protected=true;stop(next.reason,'blocked');break;}
   if(next.kind==='wait'){await emulator.execute({buttons:[],holdFrames:8,releaseFrames:0});if(Date.now()-lastProgress>1000)progress();if(Date.now()-lastSave>30000)persist('waiting-progress');continue;}
   if(next.kind==='reset'){
    mission.prepareGenerationReset?.();
    const rng=mission.state.rng,p=next.pokemon??o.playerMemory.encounter.pokemon;
    if(rng?.attemptSeed!==null&&rng?.attemptSeed!==undefined){
     const delay=findStaticDelay({state:rng.attemptSeed,personality:p.personality});
     rng.lastResult={predicted:rng.target?.pokemon.personality??null,observed:p.personality,delay,matched:rng.target?.pokemon.personality===p.personality};
     rng.attempts++;rng.delay=delay;rng.phase=delay===null?'calibrating':'waiting';
     rng.attemptSeed=null;rng.target=null;
     if(delay===null&&rng.attempts-(rng.calibrationStartAttempts??0)>=3){stop('Static RNG timing could not be calibrated. The encounter is preserved.','blocked');break;}
    }
    emulator.close();
    // Retain mission counters; restoring the encounter anchor never rewinds budgets.
    const anchor=vault.read(rng?.anchor??mission.state.anchor);
    session.loadSram(anchor.sram);session.loadState(anchor.state);
    mission.state.lastFingerprint=null;mission.state.resets++;engine('bot');player=createPlayer();
    // Advance a rolling pre-encounter anchor with ordinary neutral frames. This
    // avoids sampling the same few hundred RNG states on every reset.
    if(!rng?.anchor)await emulator.execute({buttons:[],holdFrames:randomInt(64,97),releaseFrames:0});
    if(!running)break;
    if(!rng?.anchor)mission.state.anchor=saveReference(persist('next-natural-rng-anchor'));
    persist('hunt-reset-progress');
    const archived=join(directory,`archived-${mission.state.id}.json`);
    vault.prune([mission.state.anchor,rng?.anchor,mission.state.protectedAnchor,existsSync(archived)?json(archived).save:null]);
    continue;
   }
   if(next.kind==='anchor'){
    player=createPlayer();mission.state.anchor=saveReference(persist('before-static-acquisition'));
    if(mission instanceof SnorlaxMission){
     const prepared=new SaveVault(join(config.directory,'prepared',owner,mission.state.route.map.toLowerCase()),identity);
     prepared.write(Buffer.from(session.saveState()),Buffer.from(session.saveSram()),{ready:true,speciesId:143,route:mission.state.route,nativeSaveVerified:true,frame:session.frame,balls:ballCount(o),strategy:'static-reset',createdFrom:'verified-natural-gameplay'});
     if(mission.state.buildingSetup){mission.state.phase='ready';stop('Prepared Snorlax setup is ready.','complete');break;}
    }
    persist('hunt-anchor-committed');continue;
   }
   if(next.kind==='protect'&&!player?.state()?.encounterSafety?.capture){
    // Commit the exact shiny battle before the first capture action.
    mission.state.protectedAnchor=saveReference(persist('protected-encounter'));
    if(mission.state.rng){const rng=mission.state.rng;const p=next.pokemon;const predicted=rng.target?.pokemon.personality??rng.lastResult?.predicted??null;rng.phase='found';rng.traits=evaluateRngTraits(p,mission.request,inputs.battle);rng.lastResult={predicted,observed:p.personality,matched:predicted===p.personality};}
    engine('bot');player=createPlayer(null,true);
   }
   if(next.objective){
    if(!mission.state.protected&&!next.intentionalRoamerSearch&&!nativeRadio&&!nativeTrade&&!localBridge?.busy()){
     const cycle=observeNavigationCycle({observation:o,objective:next.objective,state:mission.state.navigationWatch??={}});
     if(cycle){mission.state.navigationCycle=cycle;stop(cycle.reason,'blocked');break;}
    }
    objective=resolveFireRedTravel(next.objective,o,inputs.world);
   }
   if(mission.state.method==='safari-land'&&mission.state.protected&&!mission.state.utilityCapture&&mission.state.capturePlan?.completed!==true&&
      !player?.state()?.encounterSafety?.capture?.caught&&!player?.state()?.encounterSafety?.capture?.postCatch){await runSuiteProtectedCapture(true);continue;}
   if(mission.state.protected&&mission.state.capturePlan?.completed!==true&&requiresTimedCapture(o,inputs.battle,{requestedRoamer:mission.state.method==='roamer'&&mission.matches(o.playerMemory.encounter?.pokemon)})&&
      !player?.state()?.encounterSafety?.capture?.caught&&!player?.state()?.encounterSafety?.capture?.postCatch){await runSuiteProtectedCapture(false);continue;}
   const decision=next.kind==='recommendation'?{kind:'act',reason:'Safari hunt control',action:mapRecommendation(next.recommendation,o),winner:{recommendation:next.recommendation}}:player.decide(o,{beforeAction:decision=>timedAcquisition(o,decision)});lastDecision=decision;
   if(decision.reason==='waiting-for-shiny-rng'){
    await emulator.execute(decision.action);
    if(!running)break;
    if(Date.now()-lastSave>10000)persist('rng-wait-progress');
    progress();continue;
   }
   if(mission.beforeInteraction(o,decision)){player=createPlayer();continue;}
   if(decision.kind==='blocked'||decision.kind==='complete'){
    const safety=player.state().encounterSafety;
    if(mission.state.protected&&canQualifyPostgameCapture(o,safety?.capture,decision.reason??safety?.blocked)&&safety.capture.pokemon.shiny){await runSuiteProtectedCapture(false);continue;}
    if(safety?.capture?.nativeSaveVerified&&safety.blocked==='protected-capture-saved'){
     if(mission.state.utilityCapture){
      mission.state.utilityCapture=false;mission.state.protected=false;mission.state.phase='traveling';
      mission.state.utilityReceipt={fingerprint:safety.capture.fingerprint,savedSramSha256:safety.capture.savedSramSha256};
      mission.state.protectedAnchor=null;captureEvidence=null;engine('bot');player=createPlayer();persist('sweet-scent-user-saved');continue;
     }
     if(mission.acceptSavedCapture){
      refreshCollection(safety.capture);
      const batch=mission.acceptSavedCapture(safety.capture);
      if(!batch.complete){captureEvidence=null;resume=null;engine('bot');player=createPlayer();persist('batch-capture-saved');progress();continue;}
     }
     // A timed capture can leave an earlier unsaved receipt in captureEvidence.
     // Commit the player's verified receipt before completion persists it.
     captureEvidence=safety.capture;
     mission.state.phase='complete';stop('Caught, saved in game, and identity verified.','complete');
     if(mission.request.afterCompletion==='prepare-trade')atomicJson(join(directory,`trade-ready-${mission.state.id}.json`),{schema:'pokemon-suite/trade-preparation/v1',requestId:mission.state.id,pokemon:safety.capture.pokemon,fingerprint:safety.capture.fingerprint,save:vault.current(),competitive:mission.request.competitive??null,state:'saved-awaiting-partner'});
    }else stop(decision.reason??safety?.blocked??'The bot stopped for inspection.','blocked');
    break;
   }
   if(++sequence%10===0){
    const log=join(directory,'decisions.ndjson');
    if(existsSync(log)&&statSync(log).size>8*1024*1024)renameSync(log,join(directory,'decisions.previous.ndjson'));
    appendFileSync(log,JSON.stringify({at:new Date().toISOString(),frame:session.frame,requestId:mission.state.id,phase:mission.state.phase,encounters:mission.state.encounters,map:mapped(o),decision:{sequence,kind:decision.kind,reason:decision.reason,recommendation:decision.winner?.recommendation}})+'\n',{mode:0o600});
   }
   const execution=await emulator.execute(decision.action??{buttons:[],holdFrames:8,releaseFrames:0});
   if(!running)break;
   player.observeExecution({observation:o,decision,execution});
   if(Date.now()-lastSave>30000)persist('automatic');
   if(Date.now()-lastProgress>1000)progress();
   await sleep(0);
  }
 }catch(error){console.error(error.stack);if(running)stop(error.message,'blocked');}
}
// The host's partner advertisement (postgame_partner.py rewrites it every tick).
// Only a fresh document counts. A new postgame client starts with no partner.
function publishPartnerAvailability(){
 if(game!=='firered'||fireRedPartner||!postgame)return;
 const path=join(directory,'partner-availability.json'),availability=existsSync(path)?json(path):null;
 const fresh=availability?.available===true&&Date.now()-availability.checkedAt<10000&&Date.now()>=availability.checkedAt;
 postgame.publishPartnerAvailability(fresh&&(Array.isArray(availability.partners)?{available:true,partners:availability.partners}:true));
}
async function startPostgame(){
 await task;
 postgame??=createPostgameClient({...inputs,mechanics:inputs.battle,qmmSupply:qmmSupplyOption(),leagueTraining:leagueTrainingOption(),...(botPolicy.runScope==='postgame'&&existsSync(adventurePath)?{state:{schema:'pokemon-suite/postgame/v1',agenda:json(adventurePath)}}:{})});
 // A hunt closes the client, so this one may be new: its first resolution after
 // the hunt must see a ready partner (commands run in order).
 publishPartnerAvailability();
 if(mission?.state.status==='complete'&&mission.state.postgameObjective){
  await postgame.completeHunt(mission.state.postgameObjective,mission.state.id);
 }
 if(mission?.state.continuation&&!mission.state.continuationStarted){
  await beginEvolution(mission.state.continuation);mission.state.continuationStarted=true;
 }
 await postgame.resume();postgameActive=true;running=true;engine('bot');
 if(queuedHunt&&!queuedHunt.error)await postgame.requestHandoff();
 lastObservation=observe();persist('postgame-continued');progress();task=runPostgame();
}
async function continueCompletedCampaign(){
 // LeafGreen (build 124) has no postgame yet: its run waits for commands.
 if(!campaign||botPolicy.runScope!=='campaign'||game!=='firered')return false;
 const receipt=campaignPostgameHandoff({record:campaign.record,state:campaign.state(),policy:botPolicy});
 if(!receipt)return false;
 // Write the durable controller first. A crash before the policy update can
 // safely repeat this handoff without resetting any postgame transaction.
 if(postgame?.state().agenda?.continuation?.campaignId!==receipt.campaignId){
  await postgame?.close();postgame=createPostgameClient({...inputs,mechanics:inputs.battle,qmmSupply:qmmSupplyOption(),leagueTraining:leagueTrainingOption()});await postgame.beginAdventure(receipt);
 }
 persist('campaign-postgame-handoff');
 botPolicy={...botPolicy,enabled:true,awaitingCommand:false,mode:'postgame',runScope:'postgame'};
 atomicJson(botPolicyPath,botPolicy);return true;
}
async function startCampaign({retryBlockedPolicy=false}={}){
 if(!campaign)throw Error('Choose and review a new campaign first.');
 if(campaignActive)return;
 if(campaign.state().status==='complete')throw Error('This campaign is complete. Choose its next task in Bot settings.');
 await task;
 if(!benchmark||benchmark.summary({compact:true}).runId!==campaign.record.id)benchmark=createCampaignBenchmark({run:campaign.record,mechanics:inputs.battle});
 if(retryBlockedPolicy&&campaign.state().player?.transactionRecovery?.blocked){
  qualification.interventions.push({type:'policy-retry',frame:session.frame,at:new Date().toISOString(),reason:campaign.state().player.transactionRecovery.blocked.reason,runtimeLock,plannerLock});
 }
 if(retryBlockedPolicy&&campaign.state().supervision?.stopReason==='no-meaningful-progress'){
  qualification.interventions.push({type:'policy-retry',frame:session.frame,at:new Date().toISOString(),reason:'no-meaningful-progress',runtimeLock,plannerLock});
 }
 await campaign.resume({retryBlockedPolicy});postgameActive=false;emeraldActive=false;campaignActive=true;running=true;
 botPolicy={...botPolicy,enabled:true,awaitingCommand:false,consolePowered:true,mode:'campaign',runScope:'campaign'};
 atomicJson(botPolicyPath,botPolicy);engine('bot');lastObservation=observe();persist('campaign-started');progress();task=runCampaign();
}
async function runCampaign(){
 try{
  while(running&&campaignActive&&!exiting){
   let measuredAt=performance.now();const o=lastObservation=observe();benchmark.measure('observation',performance.now()-measuredAt);
   if(await holdForUpdate(o))break;
   measuredAt=performance.now();const beforePlanner=campaign.metrics(),decision=await campaign.decide(o);
   benchmark.measure('planner',performance.now()-measuredAt);
   const afterPlanner=campaign.metrics();benchmark.measure('plannerCpu',afterPlanner.computeMs-beforePlanner.computeMs);benchmark.measure('plannerSnapshot',afterPlanner.snapshotMs-beforePlanner.snapshotMs);
   sampleBenchmark();benchmark.decision(decision,{observation:o,campaign:campaign.benchmarkState()});
   if(!running||!campaignActive||exiting||updateHold)break;
   lastDecision=decision;
   if(decision.kind==='capture-saved'){
    captureEvidence=decision.capture;refreshCollection(decision.capture,campaign.record.id);
    await campaign.acknowledgeCapture(decision.capture.fingerprint);persist('campaign-capture-saved');progress();continue;
   }
   if(decision.kind==='campaign-complete'){
    running=false;campaignActive=false;
    engine('bot',true,1);persist('campaign-complete');
    atomicJson(join(directory,'campaign-report.json'),{schema:'pokemon-suite/campaign-report/v1',run:presentCampaignRun(campaign.record,campaign.state()),qualification,runtimeLock,plannerLock,save:saveReference(vault.current()),benchmark:benchmark.summary()});
    atomicJson(join(directory,'campaign-benchmark.json'),benchmark.summary());
    // afterCampaign 'wait' leaves the bot awaiting commands (the handoff is awaited).
    await settleCompletedCampaign({handoff:continueCompletedCampaign,report:error=>console.error(error.stack),
     awaitCommands:()=>{botPolicy={...botPolicy,awaitingCommand:true,runScope:'task'};atomicJson(botPolicyPath,botPolicy);}});
    progress();break;
   }
   if(decision.kind==='blocked'){stop(decision.reason??'The campaign needs review.','blocked');break;}
   measuredAt=performance.now();const execution=await emulator.execute(decision.action??{buttons:[],holdFrames:8,releaseFrames:0});benchmark.measure('execution',performance.now()-measuredAt);
   if(!running)break;
   measuredAt=performance.now();await campaign.observeExecution({observation:o,decision,execution});benchmark.measure('executionFeedback',performance.now()-measuredAt);
   benchmark.execution({observation:o,decision,execution});sequence++;
   if(Date.now()-lastSave>30000)persist('campaign-progress');
   if(Date.now()-lastProgress>1000)progress();
   await yieldToIO();
  }
 }catch(error){console.error(error.stack);campaign.wait(error.message);stop(error.message,'blocked');}
}
async function runPostgame(){
 try{
  while(running&&postgameActive&&!exiting){
   if(queuedHunt&&!queuedHunt.error)await postgame.requestHandoff();
   const o=lastObservation=observe();if(await holdForUpdate(o))break;
   const decision=await postgame.decide(o);if(!running||!postgameActive)break;lastDecision=decision;
   verifyRecoveryProgress(o);
   if(['postgame-evolution-started','postgame-acquisition-started'].includes(decision.kind)){persist('postgame-evolution-started');progress();continue;}
   if(decision.kind==='postgame-complete'){
    if(!decision.receipt?.nativeSaveVerified)throw Error('Postgame completion requires a verified native save.');
    running=false;postgameActive=false;botPolicy={...botPolicy,enabled:true,awaitingCommand:true};atomicJson(botPolicyPath,botPolicy);
    engine('bot',true,1);persist('postgame-complete');progress();break;
   }
   if(decision.kind==='postgame-hunt'){
    const agenda=postgame.state().agenda;
    let prior=agenda.hunts?.[decision.objectiveId]??null;
    // A priority target runs the user's request under its request identity.
    // An older reservation for the same encounter with another request is
    // released (a protected encounter still blocks the handoff at start).
    if(decision.priority&&prior&&(decision.priority.huntId&&prior.id!==decision.priority.huntId||JSON.stringify(prior.request)!==JSON.stringify(decision.request))){await postgame.completeHunt(decision.objectiveId,prior.id);prior=null;}
    const record=prior??{id:decision.priority?.huntId??`postgame-${decision.objectiveId}-${randomUUID()}`,request:decision.request,route:decision.route,postgameObjective:decision.objectiveId};
    await postgame.recordHunt(decision.objectiveId,record);
    queuedHunt={record,runScope:'postgame',error:null};atomicJson(queuedHuntPath,queuedHunt);
    running=false;postgameActive=false;emulator.pause('Starting the next postgame collection task.');persist('postgame-hunt-handoff');progress();break;
   }
   if(decision.kind==='player-task-complete'){
    atomicJson(join(directory,`player-task-${decision.receipt.request.id}.json`),decision.receipt);
    running=false;postgameActive=false;botPolicy={...botPolicy,enabled:true,awaitingCommand:true};atomicJson(botPolicyPath,botPolicy);
    engine('bot',true,1);persist('player-task-complete');progress();break;
   }
   if(decision.kind==='handoff'){running=false;emulator.pause(decision.reason);postgameActive=false;persist('ready-for-queued-hunt');progress();break;}
   if(decision.kind==='capture-saved'){
    captureEvidence=decision.capture;refreshCollection(decision.capture,`postgame-${game}`);await postgame.acknowledgeCapture();persist('postgame-capture-saved');progress();continue;
   }
   if(decision.kind==='acquisition-saved'){
    if(!decision.receipt?.nativeSaveVerified)throw Error('Acquisition completion has no native save receipt.');
    atomicJson(join(directory,`acquisition-${decision.receipt.requestId}.json`),decision.receipt);
    refreshCollection();await postgame.acknowledgeAcquisition();persist('acquisition-native-save-verified');progress();continue;
   }
   if(['evolution-saved','dex-evolution-saved'].includes(decision.kind)){
    if(!decision.receipt?.nativeSaveVerified)throw Error('Evolution completion has no native save receipt.');
    atomicJson(join(directory,`acquisition-${decision.receipt.requestId}.json`),decision.receipt);
    refreshCollection();if(decision.kind==='dex-evolution-saved')await postgame.acknowledgeDexEvolution();else await postgame.acknowledgeEvolution();
    if(decision.kind==='evolution-saved'&&botPolicy.runScope==='task'){
     botPolicy={...botPolicy,enabled:true,awaitingCommand:true};atomicJson(botPolicyPath,botPolicy);running=false;postgameActive=false;engine('bot',true,1);
    }
    persist('evolution-native-save-verified');progress();continue;
   }
   if(decision.kind==='blocked'&&canQualifyPostgameCapture(o,postgame.state().player?.encounterSafety?.capture,decision.reason)){await runPostgameCapture();continue;}
   if(['blocked','complete'].includes(decision.kind)){stop(decision.reason??'Postgame is waiting for review.','blocked');break;}
   if(decision.kind==='power-cycle'){
    // The Mail supply retries its setup battle from the pre-battle native
    // save: switch the console off and on (SRAM is untouched), then Continue.
    persist('qmm-power-cycle');emulator.close();session.reset();renewObserver();engine('bot');progress();continue;
   }
   const execution=await emulator.execute(decision.action??{buttons:[],holdFrames:8,releaseFrames:0});
   if(!running)break;
   await postgame.observeExecution({observation:o,decision,execution});sequence++;
   if(Date.now()-lastSave>30000)persist('postgame-progress');
   if(Date.now()-lastProgress>1000)progress();
   await sleep(0);
  }
 }catch(error){console.error(error.stack);postgame.wait(error.message);stop(error.message,'blocked');}
}
async function runHuntPreparation(controller,o){
 const decision=controller.decide(o);lastDecision=decision;
 const capture=controller.state().player?.encounterSafety?.capture;
 mission.state.protected=Boolean(capture&&!capture.nativeSaveVerified);
 mission.state.reason=decision.reason??controller.state().objective?.id??'Preparing Suicune’s release';
 if(decision.kind==='capture-saved'){
  captureEvidence=decision.capture;refreshCollection(decision.capture);controller.acknowledgeCapture();mission.state.protected=false;
  persist('hunt-preparation-capture-saved');progress();return;
 }
 if(decision.kind==='dex-evolution-saved'){
  if(!decision.receipt?.nativeSaveVerified)throw Error('Preparation evolution needs its native save receipt.');
  atomicJson(join(directory,`acquisition-${decision.receipt.requestId}.json`),decision.receipt);
  refreshCollection();controller.acknowledgeDexEvolution();persist('hunt-preparation-evolution-saved');progress();return;
 }
 if(decision.kind==='blocked'&&canQualifyPostgameCapture(o,capture,decision.reason)){await runPostgameCapture(controller);return;}
 if(['blocked','complete'].includes(decision.kind)){stop(decision.reason??'Suicune preparation needs review.','blocked');return;}
 if(!mission.state.protected&&mission.state.elapsedMs>=mission.request.limits.maxMinutes*60000){stop('Suicune preparation time limit reached.','blocked');return;}
 const execution=await emulator.execute(decision.action??{buttons:[],holdFrames:8,releaseFrames:0});
 if(!running)return;
 controller.observeExecution({observation:o,decision,execution});sequence++;
 if(Date.now()-lastSave>30000)persist('hunt-preparation-progress');
 if(Date.now()-lastProgress>1000)progress();
 await sleep(0);
}
async function runPostgameCapture(controller=postgame){
 if(nativeRadio||nativeTrade||readNativeWirelessStatus(session,inputs.runtime).remotePlayers!==0)throw Error('Finish the link before postgame capture.');
 emulator.pause('Qualifying the current postgame capture');
 const before=observe(),evidence=controller.state().player?.encounterSafety?.capture,reason='capture-battler-survival-unknown';
 if(!canQualifyPostgameCapture(before,evidence,reason))throw Error('The current postgame encounter cannot be verified.');
 const source=persist('postgame-capture-source'),start=vault.read(source),signal={get aborted(){return !running||exiting;}};
 const plan=await buildProtectedCapturePlan({source,mechanics:inputs.battle,signal,allowOrdinary:true,openTrial:async()=>{
  const check=await makeFireRedSession(coreDirectory,coreManifest);check.loadSram(start.sram);check.loadState(start.state);
  return {session:check,observer:createFireRedObserver({session:check,...inputs,runId:'postgame-capture-qualification'}),commit:source};
 },onProgress:()=>{if(Date.now()-lastProgress>500)progress();}});
 if(!running)return;
 if(digest(Buffer.from(session.saveSram()))!==source.sramSha256||!canQualifyPostgameCapture(observe(),evidence,reason)||plan.fingerprint!==evidence.fingerprint)throw Error('The postgame encounter changed during qualification.');
 atomicJson(join(directory,`capture-plan-postgame-${evidence.pokemon.personality}.json`),plan);
 emulator.close();session.loadSram(start.sram);session.loadState(start.state);engine('bot');
 const result=await executeProtectedCapturePlan({plan,source,observe,signal,execute:a=>emulator.execute(a),onProgress:()=>{lastObservation=observe();if(Date.now()-lastProgress>500)progress();}});
 if(!running)return;
 if(result.status!=='caught')throw Error('The postgame capture did not reproduce; its checkpoint is preserved.');
 lastObservation=observe();await controller.resumeVerifiedCapture(lastObservation,evidence.fingerprint);persist('postgame-capture-input-result');
}
async function runSuiteWildRng(){
 if(mission.state.protected||nativeRadio||readNativeWirelessStatus(session,inputs.runtime).remotePlayers>0)throw new Error('Finish the protected encounter or wireless session before RNG planning.');
 const profilePath=join(directory,'rng-profiles.json');
 const profiles=existsSync(profilePath)?json(profilePath):null;
 const profile=profiles?.romSha1===identity.romSha1&&profiles?.coreSha256===identity.coreSha256?profiles.areas?.[mission.state.route.map]:null;
 mission.state.rng={method:'automatic',phase:'planning',reason:'Comparing measured time to a shiny encounter'};
 mission.state.phase='planning-rng';
 // Planning uses isolated trial sessions, then drives the owning cartridge
 // directly. Record a stable field observation first so an escaped ordinary
 // battle cannot leave its identity live across that direct input plan.
 const sourceObservation=observe();
 if(sourceObservation.phase==='stable'&&!sourceObservation.emulator.inBattle){
  const sourceDecision=player.decide(sourceObservation);
  if(sourceDecision.kind==='blocked'||sourceDecision.protectedEncounter){
   stop(sourceDecision.reason??'RNG plan source retains a protected encounter','blocked');return;
  }
 }
 const source=persist('rng-plan-source');
 const start=vault.read(source),planPath=join(directory,`rng-plan-${mission.state.id}.json`);
 let plan=existsSync(planPath)?json(planPath):null;
 const signal={get aborted(){return !running||exiting;}};
 if(!plan?.verified||plan.source.stateSha256!==source.stateSha256||plan.source.sramSha256!==source.sramSha256){
  plan=await buildWildRngPlan({game,area:mission.state.route.map,speciesId:mission.nativeSpecies??mission.request.speciesId,request:mission.request,source,profile,signal,
   openTrial:async()=>{
    const check=await makeFireRedSession(coreDirectory,coreManifest);check.loadSram(start.sram);check.loadState(start.state);
    const observed=createFireRedObserver({session:check,...inputs,observeRng:true,runId:'suite-rng-qualification',storyWatch:basePlanner.storyWatch()});
    return {session:check,observer:observed,inputs,commit:source,capture:()=>{const o=observed.capture();return {...o,playerMemory:{...o.playerMemory,safari:readSafariStatus(check,inputs.runtime,o.emulator.inBattle?o.playerMemory.battleTypeFlags:0)}};}};
   },onProgress:event=>{Object.assign(mission.state.rng,event);mission.state.rng.reason=`${event.method}: ${event.phase}`;if(Date.now()-lastProgress>500)progress();}});
  atomicJson(planPath,plan);
  if(plan.timingProfile)atomicJson(profilePath,{romSha1:identity.romSha1,coreSha256:identity.coreSha256,areas:{...(profiles?.romSha1===identity.romSha1&&profiles?.coreSha256===identity.coreSha256?profiles.areas:{}),[mission.state.route.map]:plan.timingProfile}});
 }
 if(!running)return;
 mission.state.rng={method:plan.method,phase:'executing',delay:plan.delay,attempts:plan.verifiedRepeats,estimatedSeconds:estimatedEmulationSeconds(plan.estimatedFrames,emulator.controlState()),candidates:plan.candidates.map(c=>({method:c.method,expectedSeconds:estimatedEmulationSeconds(c.expectedFrames,emulator.controlState()),qualified:c.qualified,reason:c.reason})),reason:'Shortest verified input plan for this game, location, and shiny target'};
 mission.state.phase='timing-shiny';progress();
 const result=await executeRngPlan({plan,source,observe,signal,execute:action=>emulator.execute(action),
  reset:async()=>{emulator.close();session.reset();renewObserver();engine('bot');mission.state.resets++;},
  onProgress:event=>{Object.assign(mission.state.rng,event);lastObservation=observe();if(Date.now()-lastProgress>500)progress();}});
 if(!running)return;
 mission.state.rng.traits=result.pokemon?evaluateRngTraits(result.pokemon,mission.request,inputs.battle):plan.traits;
 mission.state.rng.lastResult={predicted:plan.pokemon.personality,observed:result.pokemon?.personality??null,matched:result.matched??false};
 mission.state.rng.phase=['protected-shiny','protected-target'].includes(result.status)?'found':'mismatch';persist('rng-input-plan-result');
 if(!['protected-shiny','protected-target'].includes(result.status))stop('The live encounter did not match the verified input plan. The current game is preserved.','blocked');
}
async function runSuiteProtectedCapture(safari=false){
 if(nativeRadio||nativeTrade||readNativeWirelessStatus(session,inputs.runtime).remotePlayers!==0)throw new Error('Protected capture cannot run during a trade');
 emulator.pause('Qualifying protected capture');
 const build=safari?buildSafariCapturePlan:buildProtectedCapturePlan,replay=safari?executeSafariCapturePlan:executeProtectedCapturePlan;
 const retry=safari?canRetrySafariCapture:args=>canRetryProtectedCapture(args)||canRetryDepletedCapture(args);
 const before=observe(),evidence=player?.state()?.encounterSafety?.capture??captureEvidence;
 const ordinaryRoamer=!safari&&mission.state.method==='roamer'&&mission.state.protected&&mission.matches(before.playerMemory.encounter?.pokemon)&&before.playerMemory.encounter?.pokemon?.shiny===false;
 // A requested non-shiny Safari target (National Dex, or shiny "any") uses the
 // same qualified Safari Ball plan; its identity check replaces the shiny one.
 const ordinarySafariTarget=safari&&requestedSafariTarget({observation:before,state:mission.state,request:mission.request,matches:p=>mission.matches(p)});
 const retryingAnchor=!before.emulator.inBattle||!safari&&canRetryDepletedCapture({observation:before,evidence,source:mission.state.protectedAnchor});
 let source;
 if(!retryingAnchor){
  if(before.playerMemory.encounter?.validity!=='valid'||!(before.playerMemory.encounter.pokemon.shiny||ordinaryRoamer||ordinarySafariTarget))throw new Error('The protected encounter is unreadable');
  source=persist('protected-capture-source');
 }else{
  source=mission.state.protectedAnchor;
  if(!retry({observation:before,evidence,source}))throw new Error('Capture retry could not verify that the protected Pokémon remains uncaught and unsaved');
 }
 const start=vault.read(source),signal={get aborted(){return !running||exiting;}};
 mission.state.phase='planning-capture';mission.state.reason='Verifying a capture sequence for the protected encounter';progress();
 const plan=await build({source,mechanics:inputs.battle,signal,allowOrdinary:ordinaryRoamer,nickname:mission.request.nickname??null,openTrial:async()=>{
  const check=await makeFireRedSession(coreDirectory,coreManifest);check.loadSram(start.sram);check.loadState(start.state);
  const observed=createFireRedObserver({session:check,...inputs,runId:'suite-capture-qualification'});
  return {session:check,observer:observed,commit:source,capture:()=>{const o=observed.capture();return {...o,playerMemory:{...o.playerMemory,safari:readSafariStatus(check,inputs.runtime,o.emulator.inBattle?o.playerMemory.battleTypeFlags:0)}};}};
 },onProgress:event=>{mission.state.capturePlan=event;if(Date.now()-lastProgress>500)progress();}});
 if(!running)return;
 const current=observe();
 if(digest(Buffer.from(session.saveSram()))!==before.sram.sha256||(retryingAnchor&&!retry({observation:current,evidence,source}))||plan.fingerprint!==(before.emulator.inBattle?encounterFingerprint(before.playerMemory.encounter.pokemon):evidence.fingerprint))throw Error('The owning encounter or save changed during capture qualification');
 atomicJson(join(directory,`capture-plan-${mission.state.id}.json`),plan);
 // Restore only this owner's uncaught encounter checkpoint, never a trial's
 // captured state or SRAM. The qualifying artifact contains controller inputs.
 emulator.close();session.loadSram(start.sram);session.loadState(start.state);
 captureTiming=true;engine('bot');player=createPlayer(null,true);player.decide(observe());resume=null;
 mission.state.phase='capturing';mission.state.reason=null;
 mission.state.capturePlan={method:safari?'timed-safari-ball':'timed-capture-ball',delay:plan.delay,ballId:plan.ballId,throws:plan.throws,verifiedRepeats:plan.verifiedRepeats,estimatedSeconds:estimatedEmulationSeconds(plan.estimatedFrames,emulator.controlState())};
 const result=await replay({plan,source,observe,signal,execute:a=>emulator.execute(a),onProgress:event=>{Object.assign(mission.state.capturePlan,{completedSteps:event.completed,total:event.total});lastObservation=observe();if(Date.now()-lastProgress>500)progress();}});
 if(!running)return;
 mission.state.capturePlan.completed=result.status==='caught';captureTiming=false;engine('bot');
 lastObservation=observe();captureEvidence=player.state().encounterSafety?.capture;persist('protected-capture-input-result');
 if(result.status!=='caught')stop('The capture replay did not verify the protected Pokémon. Its checkpoint is preserved.','blocked');
}
async function beginEvolution(value){
 if(!value?.requestId||!value?.sourceId||value.request?.game!=='firered'||value.request.quantity!==1||!Array.isArray(value.route?.steps))throw Error('Choose a FireRed evolution request for one saved source.');
 if(postgame?.state().evolution?.requestId===value.requestId){await postgame.resume();return;}
 const observation=observe(),trainer=observation?.playerMemory?.trainer;
 if(trainer?.partyValidity!=='valid'||trainer.storage?.validity!=='valid')throw Error('Verify the current party and storage before evolution.');
 const proofs=collectionRecords.filter(r=>r.requestId===value.sourceId&&r.nativeSaveVerified&&r.owned).map(r=>r.pokemon);
 if(mission?.state.id===value.sourceId&&mission.state.status==='complete'){
  if(mission.state.gift?.pokemon)proofs.push(mission.state.gift.pokemon);
  for(const capture of mission.state.captures??[])if(capture.target!==false&&capture.savedSramSha256)proofs.push(capture.pokemon);
  if(captureEvidence?.nativeSaveVerified)proofs.push(captureEvidence.pokemon);
 }
 const pokemon=resolveSavedEvolutionSource({sourceSpeciesId:value.route.source.speciesId,proofs,trainer});
 postgame??=createPostgameClient({...inputs,mechanics:inputs.battle,qmmSupply:qmmSupplyOption(),leagueTraining:leagueTrainingOption()});
 await postgame.beginEvolution({requestId:value.requestId,sourceId:value.sourceId,pokemon,request:value.request,steps:value.route.steps});await postgame.resume();
}
async function continueBotSave(){
 if(frlg){
  const o=observe();
  if(inspectNativeSaveContinuation(o))lastObservation=await continueNativeSaveAsync(session,observer);
 }else{
  await ensureEmeraldRuntime();
  const {inspectNativeContinue}=await import(pathToFileURL(join(config.researchBots,'games/emerald/player/native-continue.mjs')));
  for(let n=0;n<6000;n++){
   const o=emeraldRuntime.observe();
   if(o.fieldReady||o.emulator.inBattle)return;
   const step=inspectNativeContinue(o);
   if(step?.kind==='stop')throw Error(step.reason);
   session.step(n%30===0&&step?.button?[step.button]:[]);
   if(n%12===0)await new Promise(resolve=>setImmediate(resolve));
  }
  throw Error('The current Emerald save did not reach a playable state.');
 }
}
async function finishBotStart(){
 try{await continueBotSave();engine('bot',true,1);lastObservation=observe();persist('bot-ready');progress();}
 catch(error){botPolicy={...botPolicy,enabled:false,awaitingCommand:false};atomicJson(botPolicyPath,botPolicy);engine('bot',true,1);persist('bot-start-failed');throw error;}
}
async function holdForUpdate(o){
 if(!updateRequest||updateHold)return updateHold;
 const boundary=updateBoundary({game,observation:o,mission:mission?.state,nativeTrade:nativeTrade?.state,localBusy:localBridge?.busy(),captureTiming,postgameActive,postgameYieldReady:postgame?.canYield(o)===true,emeraldActive});
 if(!boundary.ready)return false;
 const checkpoint={id:updateRequest.id,frame:session.frame,wasRunning:running,campaign:campaignActive,campaignId:campaign?.record.id??null,manual:emulator.controlState().mode==='manual',botPolicy:structuredClone(botPolicy)};
 updateHold=true;running=false;campaignActive=false;campaign?.pause('Applying a verified software update.');emulator.pause('Applying a verified software update.');
 try{await campaign?.ready();}catch(error){updateHold=false;updateRequest=null;campaign?.wait(error.message);persist('update-checkpoint-failed');throw error;}
 updateCheckpoint=checkpoint;persist('update-checkpoint');progress();return true;
}
// The invisible FireRed partner is never assigned tasks.
const HELPER_DENIED=new Set(['start','player-task','postgame-goal','trade-pokemon','trade-shiny','prepare-trade','prepare-acquisition','host-trade','defer-partner-evolution','preserve-source','archive','prepare-partner','restore-save']);// extra-saves
const PARTNER_DENIED=new Set(['start','player-task','postgame-goal','trade-pokemon','trade-shiny','restore-save','new-save','start-campaign','resume-campaign','prepare-trade','prepare-acquisition','host-trade','defer-partner-evolution','preserve-source','archive','start-bot']);
async function command(c){
 commandError=null;
 if(c.sessionId&&c.sessionId!==sessionId)throw Error('The game owner changed. Refresh before sending another command.');
 if(fireRedPartner&&PARTNER_DENIED.has(c.type))throw Error('The FireRed trade partner is never assigned tasks. It only serves paired trade evolutions.');
 // extra-saves: a helper FireRed save only plays its reviewed story campaign toward its goal.
 // A parking helper (an archived save seeded to serve as a partner) only travels to a Pokémon Center and saves there.
 if(fireRedHelper&&HELPER_DENIED.has(c.type)&&!helperTaskAllows(cfg,c))throw Error('A helper FireRed save only plays its story campaign toward its goal.');
 if(c.type==='stop'||c.type==='set-bot'&&c.enabled===false)assertNativeTradeCanStop(nativeTrade?.state??resume?.nativeTrade);
 if(c.type==='stop'&&!nativeTradeFinished(nativeTrade?.state??resume?.nativeTrade)){
  if(!tradeState()||c.id!==tradeState().id)throw Error('This is not the current task.');
  return command({type:'set-bot',enabled:false});
 }
 if(ownedTrade&&['player-task','postgame-goal','prepare-acquisition','new-save','restore-save','manual-game','start-bot'].includes(c.type)){
  const previous=nativeTrade?.state??resume?.nativeTrade;
  if(running||!nativeTradeFinished(previous))throw Error('Stop preparation or finish the trade before changing tasks.');
  ownedTrade=null;tradePreparation=null;nativeTrade=null;
  if(resume)resume={...resume,tradePreparation:null,nativeTrade:null,player:null};
 }
 if(c.type==='prepare-update'){
  if(c.sessionId!==sessionId||typeof c.updateId!=='string')throw Error('Choose the current owner and update request.');
  if(updateRequest&&updateRequest.id!==c.updateId)throw Error('Another update already owns this handoff.');
  updateRequest={id:c.updateId};if(!running)await holdForUpdate(observe());progress();return;
 }
 if(c.type==='cancel-update'){
  if(updateHold)throw Error('The game is already checkpointed; finish or recover this update.');
  updateRequest=null;progress();return;
 }
 if(c.type==='replace-planner'){
  if(!updateHold||c.sessionId!==sessionId||!campaign||c.updateId!==(updateCheckpoint?.id??saved.metadata?.updateCheckpoint?.id))throw Error('The campaign must be checkpointed for this planner update.');
  if(c.lock?.schema!=='pokemon-suite/run-lock/v1'||c.lock.game!==game||c.lock.packages?.[0]?.kind!=='planner'||typeof c.module!=='string')throw Error('Choose a verified planner package.');
  const state=campaign.state(),record=campaign.record;
  if(state.schema!=='pokemon-suite/campaign-state/v1')throw Error('This campaign state cannot be handed to the planner.');
  const candidate=createPlannerClient({module:pathToFileURL(c.module).href,options:{record,...inputs,mechanics:inputs.battle,state},snapshot:{state,storyWatch:campaign.storyWatch(),campaignStatus:campaign.campaignStatus()}});
  try{await candidate.ready();if(candidate.state().schema!==state.schema)throw Error('The planner did not accept the campaign state schema.');}
  catch(error){await candidate.close();throw error;}
  const previous=campaign;campaign=candidate;plannerLock=c.lock;await previous.close();persist('planner-replaced');progress();return;
 }
 if(c.type==='resume-update'){
  if(!updateHold||c.sessionId!==sessionId)throw Error('This owner is not waiting for an update.');
  const checkpoint=updateCheckpoint??saved.metadata?.updateCheckpoint;
  if(!checkpoint||checkpoint.id!==c.updateId)throw Error('The saved update checkpoint changed.');
  if(!qualification.interventions.some(i=>i.updateId===c.updateId))qualification.interventions.push({updateId:c.updateId,frame:session.frame,at:new Date().toISOString(),runtimeLock,plannerLock});
  updateHold=false;updateRequest=null;updateCheckpoint=null;
  if(checkpoint.campaign&&checkpoint.wasRunning)await startCampaign();
  else {engine(checkpoint.manual?'manual':'bot',!checkpoint.wasRunning&&!checkpoint.manual,checkpoint.manual?1:5);persist('update-resumed');progress();}
  return;
 }
 if(updateHold&&c.type!=='shutdown')throw Error('The game is held for a verified update. Finish its handoff before other commands.');
 if(c.type==='shutdown'){
  if(c.sessionId!==sessionId)throw Error('The game session changed before closing.');
  await shutdown('Stopped from Pokémon Suite.');return;
 }
 if(c.runScope!==undefined&&!['task','collection','postgame'].includes(c.runScope))throw Error('Choose a single task, collection, or postgame.');
 if(c.type==='start-campaign'){
  if(!frlg||!/^run-[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/.test(c.previewId??''))throw Error(`Review a ${frlg?frlgGame(game).title:'FireRed'} campaign before starting it.`);
  if(campaign?.record.id===c.previewId)return;
  const review=json(join(directory,'run-previews',`${c.previewId}.json`));
  if(review.started)throw Error('This campaign was already created. Restore its save to resume it.');
  if(review.record.id!==c.previewId)throw Error('The reviewed campaign identity changed.');
  const next=restoreCampaign(review.record);
  await command({type:'new-save',label:review.record.settings.label,campaignId:review.record.id});
  campaign=next;qualification={schema:'pokemon-suite/qualification/v1',pinned:true,interventions:[],baseline:'committed-new-run'};await startCampaign();return;
 }
 if(c.type==='resume-campaign'||c.type==='set-bot'&&c.enabled===true&&campaign&&campaign.state().status!=='complete'){
  if(localBridge?.busy()||postgameActive||!nativeTradeFinished(nativeTrade?.state))throw Error('Finish the current linked task before resuming the campaign.');
  await startCampaign({retryBlockedPolicy:true});return;
 }
 if(campaign&&campaign.state().status!=='complete'&&['start','player-task','postgame-goal','prepare-acquisition','prepare-trade','trade-shiny','trade-pokemon','host-trade'].includes(c.type))throw Error('This save has an unfinished story campaign. Resume it, or select a different save before starting another task.');
 // A traded Mail holder carries its Mail and can change the party mail slots.
 const openingTrade=['prepare-trade','trade-shiny','trade-pokemon','host-trade'].includes(c.type)||c.type==='start'&&(tradePreparation||resume?.tradePreparation||(nativeTrade??resume?.nativeTrade)&&!(nativeTrade?.state??resume?.nativeTrade)?.exchangeStarted);
 if(game==='firered'&&inputs&&openingTrade&&qmmPartyHoldsMail(observe()))throw Error('Take Mail off every party Pokémon before trading.');
 if(game==='firered'&&postgame?.state().qmm?.dirty&&['prepare-trade','trade-shiny','trade-pokemon','host-trade','prepare-acquisition'].includes(c.type))throw Error('Finish the Rare Candy supply and its native save before trading.');
 if(game==='firered'&&!running&&['start','player-task','postgame-goal'].includes(c.type)&&inspectNativeSaveContinuation(observe())){
  emulator.pause('Continuing the save for your task.');
  try{lastObservation=await continueNativeSaveAsync(session,observer);}catch(error){engine('manual',false,1);throw error;}
 }
 if(c.type==='defer-partner-evolution'){
  // extra-saves: an exchange leg waiting for its partner defers (clean) or keeps waiting (borrowed).
  if(game==='firered'&&!localBridge?.busy()&&postgame?.state().preparation?.kind==='extra-save'&&postgame.state().preparation.requestId===c.requestId){await postgame.deferExtraSave(c.reason??'The partner game is unavailable.');persist('extra-save-deferred');progress();return;}
  if(game!=='firered'||localBridge?.busy()||postgame?.state().dexEvolution?.requestId!==c.requestId)throw Error('The automatic partner reservation changed.');
  await postgame.deferPartnerEvolution(c.reason??'The partner game is unavailable.');persist('automatic-evolution-deferred');progress();return;
 }
 if(c.type==='bot-settings-changed'){
  // The saved Bot settings file is the source; a running postgame owner re-reads it.
  if(postgame){await postgame.setLeagueTraining(leagueTrainingOption());persist('bot-settings-changed');}
  progress();return;
 }
 if(c.type==='preserve-source'){
  if(game!=='firered'||localBridge?.busy()||running||postgame?.state().evolution?.requestId!==c.requestId)throw Error('Stop this evolution in its owning game before preserving its source.');
  await postgame.preserveEvolutionSource();
  if(mission?.state.continuation?.requestId===c.requestId)delete mission.state.continuation;
  if(resume?.postgame)resume.postgame=postgame.state();
  persist('preserved-unevolved-source');progress();return;
 }
 if(c.type==='player-task'||c.type==='postgame-goal'){
  if(game!=='firered')throw Error('Player task automation is currently implemented for FireRed.');
  // A goal's priority target is validated before the current task is stopped.
  if(c.type==='postgame-goal'&&c.priorityTarget!==undefined)normalizePriorityTarget(c.priorityTarget);
  if(localBridge?.busy()||readNativeWirelessStatus(session,inputs.runtime).remotePlayers>0)throw Error('Finish the current linked task before starting another task.');
  const protectedCapture=postgame?.state().player?.encounterSafety?.capture??player?.state()?.encounterSafety?.capture;
  if(protectedCapture&&!protectedCapture.nativeSaveVerified||mission?.state.protected&&mission.state.status!=='complete')throw Error('Finish saving the protected Pokémon before starting another task.');
  if(running)stop('Starting your selected task.');await task;
  // A finished player task or a relaunch leaves an owner without the enabled
  // checklist. The checklist resumes this campaign's durable agenda (receipts,
  // record cycles, deferrals) and keeps the owner's other state.
  const current=postgame?.state(),durable=c.type==='postgame-goal'&&!current?.agenda?.enabled&&existsSync(adventurePath)?json(adventurePath):null;
  const agenda=durable?.continuation?.campaignId&&durable.continuation.campaignId===campaign?.record.id?durable:null;
  const next=createPostgameClient({...inputs,mechanics:inputs.battle,qmmSupply:qmmSupplyOption(),leagueTraining:leagueTrainingOption(),...(c.type==='postgame-goal'&&(current||agenda)?{state:{schema:'pokemon-suite/postgame/v1',...current,...(agenda?{agenda}:{})}}:{})});
  if(c.type==='postgame-goal'){
   const o=observe();if(o.playerMemory?.storyState?.flagIds?.[2092]!==true)throw Error('Complete the Pokémon League before starting the postgame checklist.');
   await next.beginAdventure(campaign?campaignPostgameHandoff({record:campaign.record,state:campaign.state(),policy:{enabled:true,awaitingCommand:false}}):null,c.priorityTarget!==undefined?{priorityTarget:c.priorityTarget}:{});
  }else await next.beginPlayerTask(c.request);
  await postgame?.close();postgame=next;postgameActive=true;running=true;player=null;
  botPolicy={...botPolicy,enabled:true,awaitingCommand:false,consolePowered:true,runScope:c.type==='postgame-goal'?'postgame':'task'};atomicJson(botPolicyPath,botPolicy);engine('bot');
  persist('player-task-started');progress();task=runPostgame();return;
 }
 if(c.type==='console-presented'){
  await consolePresentation.finish(c.presentationId,()=>botPolicy.awaitingCommand?finishBotStart():Promise.resolve().then(()=>{engine('manual',false,1);persist('console-started');progress();}));return;
 }
 if(c.type==='start-bot'){
  if(campaign&&campaign.state().status!=='complete'){await startCampaign({retryBlockedPolicy:true});return;}
  if(!frlg&&game!=='emerald')throw Error('This game has no command bot yet.');
  if(c.presentationId!==undefined&&!/^[a-f0-9]{32}$/.test(c.presentationId))throw Error('Invalid startup presentation.');
  if(botPolicy.enabled)return;
  await startCommandReady({newProfile,local:localBridge?.state(),trade:nativeTrade?.state??resume?.nativeTrade,
   capture:postgame?.state().player?.encounterSafety?.capture??player?.state()?.encounterSafety?.capture??(mission?.state.protected&&mission.state.status!=='complete'?{nativeSaveVerified:false}:null),
   remotePlayers:inputs?readNativeWirelessStatus(session,inputs.runtime).remotePlayers:0},{
   async stop(){resumeActiveTask=false;if(running)stop('Waiting for your command.');await task;running=false;postgameActive=false;emeraldActive=false;localActive=false;emulator.pause('Starting bot.');},
   checkpoint(){persist('before-bot-start');},
   async prepareNewGame(){
    // Reach the real title/menu without selecting New Game on the user's behalf.
    for(let n=0;n<1800;n++){
     const o=observe();
     if(o.phase==='stable'&&!o.emulator?.paletteFadeActive&&(o.playerMemory?.ui?.newGame||o.playerMemory?.ui?.mainMenu?.stage==='choose-save'||/TitleScreenRun/.test(o.emulator?.callback2??'')))return;
     session.step([]);if(n%24===0)await new Promise(resolve=>setImmediate(resolve));
    }
   },
   continueSave:async()=>{if(!c.presentationId)await continueBotSave();},
   ready(){botPolicy={...botPolicy,enabled:true,consolePowered:true,awaitingCommand:true,runScope:'task'};atomicJson(botPolicyPath,botPolicy);engine('bot',true,1);if(c.presentationId)consolePresentation.begin(c.presentationId);lastDecision=null;lastObservation=observe();persist('bot-ready');progress();},
  });return;
 }
 if(c.type==='manual-game'){
  if(c.presentationId!==undefined && (!c.boot || !/^[a-f0-9]{32}$/.test(c.presentationId)))throw Error('Invalid console presentation.');
  if(typeof c.boot!=='boolean')throw Error('Choose whether to restart or continue the console.');
  await manualConsoleStart({boot:c.boot,local:localBridge?.state(),trade:nativeTrade?.state??resume?.nativeTrade,
   capture:postgame?.state().player?.encounterSafety?.capture??player?.state()?.encounterSafety?.capture??(mission?.state.protected&&mission.state.status!=='complete'?{nativeSaveVerified:false}:null),
   remotePlayers:inputs?readNativeWirelessStatus(session,inputs.runtime).remotePlayers:0},{
   async stop(){botPolicy={...botPolicy,enabled:false,awaitingCommand:false,consolePowered:true};atomicJson(botPolicyPath,botPolicy);resumeActiveTask=false;
    if(running)stop('Manual control.');await task;running=false;postgameActive=false;emeraldActive=false;localActive=false;},
   checkpoint(){persist('before-manual-console');},
   reset(){emulator.close();nativeRadio?.close();nativeRadio=null;session.reset();session.step([]);renewObserver();player=null;},
   manual(){engine('manual',Boolean(c.presentationId),1);if(c.presentationId)consolePresentation.begin(c.presentationId);lastDecision=null;lastObservation=observe();persist('manual-console');progress();},
  });return;
 }
 if(c.type==='new-save'||c.type==='restore-save'){
  if(!frlg)throw Error('Separate new-save profiles are currently supported for FireRed and LeafGreen.');
  const restored=c.type==='restore-save'?readGameProfile(directory,c.profileId,identity):null;
  if(c.type==='new-save'&&(typeof c.label!=='string'||!c.label.trim()||c.label.length>50))throw Error('Name this save using 1 to 50 characters.');
  if(c.campaignId&&!/^run-[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/.test(c.campaignId))throw Error('Invalid campaign save identity.');
  // Validate ownership and transactions before checkpointing or changing SRAM.
  const capture=campaign?.state().player?.encounterSafety?.capture??postgame?.state().player?.encounterSafety?.capture??player?.state()?.encounterSafety?.capture;
  if(capture&&!capture.nativeSaveVerified||mission?.state.protected&&mission.state.status!=='complete')throw Error('Save the protected Pokémon before changing save profiles.');
  await command({type:'manual-game',boot:false});emulator.pause('Opening a save profile.');
  const oldActive=existsSync(activePath)?json(activePath):null;
  backupGameProfile(directory,vault,{label:oldActive?.label||`Previous ${frlgGame(game).title} save`,active:oldActive,usingNativeRadio});
  emulator.close();nativeRadio?.close();nativeRadio=null;
  ownedTrade=null;mission=null;await postgame?.close();postgame=null;await campaign?.close();campaign=null;benchmark=null;campaignActive=false;player=null;resume=null;captureEvidence=null;nativeTrade=null;tradePreparation=null;queuedHunt=null;
  if(existsSync(queuedHuntPath))unlinkSync(queuedHuntPath);
  if(restored){
   vault=restored.vault;session.loadSram(restored.saved.sram);session.loadState(restored.saved.state);
   const prior=restored.record.context.active;
   if(prior)atomicJson(activePath,{...prior,nativeRadio:usingNativeRadio});else if(existsSync(activePath))unlinkSync(activePath);
   manualProfile=prior?.manual===true;newProfile=profileStartsNewGame({type:c.type,restoredMetadata:restored.saved.metadata,previous:newProfile});
   if(usingNativeRadio&&prior){cfg.nativeRadio.huntId=prior.id;atomicJson(configPath,config);}
   const previous=restored.saved.metadata?.session;
   if(previous?.request){mission=createSuiteMission({id:previous.id,request:previous.request,state:previous.mission,world:inputs.world,story:inputs.story,mechanics:inputs.battle,fundingPlanner:basePlanner});if(mission.state.status==='running')mission.state.status='paused';resume=previous;}
   if(previous?.postgame||restored.saved.metadata?.postgame)postgame=createPostgameClient({...inputs,mechanics:inputs.battle,qmmSupply:qmmSupplyOption(),leagueTraining:leagueTrainingOption(),state:previous?.postgame??restored.saved.metadata.postgame});
   if(restored.saved.metadata?.campaign){campaign=restoreCampaign(restored.saved.metadata.campaign.record,restored.saved.metadata.campaign.state);benchmark=createCampaignBenchmark({run:campaign.record,mechanics:inputs.battle,state:restored.saved.metadata?.benchmark??null});campaign.pause('Saved campaign restored. Resume when ready.');}
  }else{
   const id=c.campaignId??'play-'+randomUUID();manualProfile=true;newProfile=profileStartsNewGame({type:c.type,campaignId:c.campaignId,previous:newProfile});
   vault=new SaveVault(join(directory,'hunts',id,...(usingNativeRadio?['native-radio','saves']:['saves'])),identity);
   session.loadSram(Buffer.alloc(saved.sram.length,0xff));session.reset();
   atomicJson(activePath,createGameProfileSelection(id,c.label,usingNativeRadio));
   if(usingNativeRadio){cfg.nativeRadio.huntId=id;atomicJson(configPath,config);}
  }
  renewObserver();engine('manual',false,1);lastDecision=null;lastObservation=observe();persist(c.type);progress();return;
 }
 if(c.type==='stop'||c.type==='set-bot'&&c.enabled===false){
  if(recovery.state().current?.status==='recovering')finishRecovery('cancelled','Stopped by you.');
  interruptedRecovery=null;
 }
 if(localBridge?.busy()){
  if(c.type==='stop'||c.type==='set-bot'&&c.enabled===false){botPolicy={...botPolicy,enabled:false};atomicJson(botPolicyPath,botPolicy);await localBridge.stop('Stopped by you.');return;}
  if(c.type==='set-bot'&&c.enabled===true){botPolicy={...botPolicy,enabled:true,awaitingCommand:false};atomicJson(botPolicyPath,botPolicy);localBridge.resume();return;}
  if(['start','trade-shiny','trade-pokemon','prepare-trade','host-trade','archive'].includes(c.type))throw Error('Finish or stop the reserved evolution round trip before starting another game task.');
  if(['prepare-acquisition','prepare-partner'].includes(c.type)&&c.requestId===localBridge.state().requestId)return;
 }
 if(fireRedPartner&&['prepare-partner','set-bot','stop'].includes(c.type)){
  if(c.type==='prepare-partner'){
   if(c.automatic&&((emulator.controlState().mode==='manual'&&!emulator.controlState().paused)||emulator.controlState().manualSessionCount>0||!botPolicy.enabled))throw Error('The FireRed partner is under manual control or was stopped by you.');
   const sourceOwner=c.sourceOwner??'firered';
   if(typeof c.requestId!=='string'||!/^[a-zA-Z0-9_-]{1,100}$/.test(c.requestId)||!/^[a-z0-9][a-z0-9-]{0,39}$/.test(sourceOwner)||sourceOwner===owner||(config.games[sourceOwner]?.title??sourceOwner)!=='firered'||config.games[sourceOwner]?.role==='partner')throw Error('Choose the source FireRed evolution request for this partner.');
   if(localBridge?.busy())throw Error('This partner is serving another evolution request.');
   botPolicy={enabled:true,awaitingCommand:false,consolePowered:true,mode:'evolution-partner'};atomicJson(botPolicyPath,botPolicy);
   if(c.offer!==undefined&&(!c.offer||typeof c.offer!=='object'||Array.isArray(c.offer)))throw Error('Choose a valid extra-save offer for this partner.');// extra-saves
   await prepareFireRedPartner(c.requestId,sourceOwner,c.offer??null);persist('firered-partner-prepared');progress();return;
  }
  if(c.type==='set-bot'&&typeof c.enabled!=='boolean')throw Error('Choose whether to run the partner bot.');
  const enabled=c.type==='set-bot'&&c.enabled===true;
  // Enabled with no prepared request, the partner idles awaiting a command.
  botPolicy={enabled,awaitingCommand:enabled&&companionPreparation?.phase!=='ready-for-transfer',consolePowered:enabled,mode:'evolution-partner'};atomicJson(botPolicyPath,botPolicy);
  if(!enabled){if(running)stop('Stopped by you.');await task;emulator.pause('Stopped by you.');}
  persist(enabled?'firered-partner-enabled':'firered-partner-disabled');progress();return;
 }
 if(game==='emerald'&&['prepare-partner','set-bot','stop'].includes(c.type)){
  if(c.type==='prepare-partner'){
   if(c.automatic&&((emulator.controlState().mode==='manual'&&!emulator.controlState().paused)||emulator.controlState().manualSessionCount>0||!botPolicy.enabled||running&&botPolicy.mode!=='evolution-partner'))throw Error('The companion game is under another owner or was stopped by you.');
   if(typeof c.requestId!=='string'||!/^[a-zA-Z0-9_-]{1,100}$/.test(c.requestId))throw Error('Choose the FireRed evolution request for this companion.');
   if(companionPreparation&&companionPreparation.requestId!==c.requestId&&localBridge?.state()?.phase!=='complete')throw Error('This game is preparing another evolution request.');
   if(companionPreparation?.requestId!==c.requestId)emeraldCompanion=null;
   companionPreparation={requestId:c.requestId,phase:'preparing',reason:null};
  }
  const enabled=c.type==='prepare-partner'||c.type==='set-bot'&&c.enabled===true;
  if(c.type==='set-bot'&&typeof c.enabled!=='boolean')throw Error('Choose whether to run the companion bot.');
  if(enabled&&!companionPreparation)throw Error('This game needs a FireRed evolution partner request first.');
  botPolicy={enabled,awaitingCommand:false,consolePowered:enabled,mode:'evolution-partner'};atomicJson(botPolicyPath,botPolicy);
  if(!enabled){if(running)stop('Stopped by you.');await task;persist('companion-disabled');}
  else {emeraldCompanion?.resume();companionPreparation.phase='preparing';}
  progress();return;
 }
 if(c.type==='start'&&queuedHunt&&queuedHunt.record.id!==c.record?.id)throw new Error('Another hunt is queued. Stop it before selecting a different request.');
 if((c.type==='stop'&&queuedHunt?.record.id===c.id)||(c.type==='set-bot'&&c.enabled===false)){
  const wasQueued=c.type==='stop'&&queuedHunt?.record.id===c.id;
  queuedHunt=null;if(existsSync(queuedHuntPath))unlinkSync(queuedHuntPath);
  if(wasQueued)return command({type:'set-bot',enabled:false});
 }
 if(c.type==='set-bot'){
  if(!frlg||typeof c.enabled!=='boolean')throw new Error(`Choose whether to run the ${frlg?frlgGame(game).title:'FireRed'} bot.`);
  if(!c.enabled&&!nativeTradeFinished(nativeTrade?.state??resume?.nativeTrade)){
   const prepared=tradePreparation?.state??resume?.tradePreparation;
   nativeTrade??=new FireRedNativeTradeHost({world:inputs.world,center:prepared.center,fingerprint:prepared.fingerprint,state:resume?.nativeTrade});
   nativeTrade.cancel('Trade cancelled. Waiting for a new command.');
   botPolicy={...botPolicy,enabled:true,awaitingCommand:false,consolePowered:true,runScope:'task'};atomicJson(botPolicyPath,botPolicy);
   tradeState().status='running';tradeState().phase='native-trade-cancelling-trade';tradeState().reason=nativeTrade.state.reason;
   if(!running){engine('bot',false,1);running=true;task=runNativeTrade();}
   persist('native-trade-cancel-requested');progress();return;
  }
  botPolicy={...botPolicy,enabled:c.enabled,awaitingCommand:false,mode:'postgame',...(c.runScope?{runScope:c.runScope}:{})};atomicJson(botPolicyPath,botPolicy);
  if(!c.enabled){botPolicy.consolePowered=false;atomicJson(botPolicyPath,botPolicy);if(running)stop('Stopped by you.');else emulator.pause('Stopped by you.');await task;persist('bot-disabled');return;}
  botPolicy.consolePowered=true;atomicJson(botPolicyPath,botPolicy);
  if(ownedTrade?.status==='cancelled'){
   botPolicy={...botPolicy,enabled:true,awaitingCommand:true,consolePowered:true};atomicJson(botPolicyPath,botPolicy);engine('bot',true,1);persist('waiting-after-cancelled-trade');progress();return;
  }
  if(ownedTrade&&ownedTrade.status!=='complete')return command({type:(nativeTrade??resume?.nativeTrade)?'host-trade':'prepare-trade',id:ownedTrade.id});
  await postgame?.resume();
  if(!running&&mission?.state.status==='paused'&&!postgame)return command({type:'start',record:{id:mission.state.id,request:mission.request,route:mission.state.route}});
  progress();return;
 }
 if(c.type==='prepare-acquisition'){
  if(game!=='firered'||!mission||mission.state.status!=='complete'||running&&!postgameActive)throw new Error('Finish saving the current catch before evolution preparation.');
  if(readNativeWirelessStatus(session,inputs.runtime).remotePlayers!==0)throw new Error('Finish the current native link before preparing evolution.');
  if(c.route){await beginEvolution(c);botPolicy={...botPolicy,enabled:true,awaitingCommand:false};atomicJson(botPolicyPath,botPolicy);persist('evolution-requested');progress();return;}
  const preparation={requestId:c.requestId,kind:'national-dex'};
  if(typeof c.sourceId!=='string'||!collectionRecords.some(r=>r.requestId===c.sourceId&&r.owned&&r.nativeSaveVerified))throw new Error('The saved source Pokémon must still belong to this game.');
  postgame??=createPostgameClient({...inputs,mechanics:inputs.battle,qmmSupply:qmmSupplyOption(),leagueTraining:leagueTrainingOption()});
  await postgame.prepareAcquisition(preparation);await postgame.resume();
  botPolicy={...botPolicy,enabled:true,awaitingCommand:false};atomicJson(botPolicyPath,botPolicy);
  persist('acquisition-preparation-requested');progress();return;
 }
 if(postgameActive&&['start','trade-shiny','trade-pokemon','prepare-trade','host-trade','archive'].includes(c.type)){
  if(!postgame.canYield(observe())){
   if(c.type!=='start')throw new Error('The bot is finishing a battle or saving. Stop the bot or retry once it reaches the overworld.');
   queuedHunt={record:c.record,runScope:c.runScope,error:null};atomicJson(queuedHuntPath,queuedHunt);await postgame.requestHandoff();progress();return;
  }
  running=false;emulator.pause('Switching to your requested task.');await task;postgameActive=false;
  persist('postgame-before-request');await postgame?.close();postgame=null;player=null;resume=null;
 }
 if(c.type==='trade-shiny'||c.type==='trade-pokemon'){
  if(game!=='firered'||!usingNativeRadio)throw new Error('This game needs its native wireless trade adapter configured');
  const o=observe(),previous=nativeTrade?.state??resume?.nativeTrade;
  assertOwnedTradeReady({observation:o,mission:mission?.state,capture:postgame?.state().player?.encounterSafety?.capture??player?.state()?.encounterSafety?.capture??captureEvidence,campaign:campaign?.state(),running,localBusy:localBridge?.busy(),nativeTrade:previous,wireless:readNativeWirelessStatus(session,inputs.runtime)});
  refreshCollection();
  const record=c.type==='trade-pokemon'?(()=>{const p=selectInventoryPokemon(game,o.playerMemory?.trainer,c.pokemonId);return {id:p.id,fingerprint:p.fingerprint,pokemon:p};})():selectShinyForTrade({records:collectionRecords,id:c.shinyId,observation:o,trade:previous});
  if(previous)atomicJson(join(directory,`completed-trade-${randomUUID()}.json`),previous);
  persist('before-owned-trade');
  ownedTrade={schema:'pokemon-suite/owned-trade/v1',id:'trade-'+randomUUID(),pokemonId:record.id,fingerprint:record.fingerprint,autoHostTrade:true,status:'paused',phase:'selected'};
  const receipt={schema:'pokemon-suite/trade-preparation/v1',requestId:ownedTrade.id,pokemon:record.pokemon,fingerprint:record.fingerprint,state:'owned-awaiting-save',save:saveReference(vault.current())};
  atomicJson(join(directory,`trade-ready-${ownedTrade.id}.json`),receipt);
  tradePreparation=null;nativeTrade=null;player=null;resume=resume?{...resume,player:null,tradePreparation:null,nativeTrade:null}:null;
  return command({type:'prepare-trade',id:ownedTrade.id});
 }
 // Automatic Snorlax requests continue this save like the other hunt methods;
 // an explicit legacy reset hunt may still select its prepared encounter.
 if(c.type==='start'&&(c.record?.request?.speciesId!==143||c.record?.postgameObjective||c.record?.id===mission?.state.id&&mission?.state.postgameObjective)&&((c.record?.id!==mission?.state.id)||(!tradePreparation&&!resume?.tradePreparation&&!nativeTrade&&!resume?.nativeTrade))){
  if(game!=='firered'||running)throw new Error('Stop the current FireRed task before starting another hunt.');
  await task;
  if(mission?.state.id===c.record.id){
   if(JSON.stringify(mission.request)!==JSON.stringify(c.record.request))throw new Error('Saved hunt settings changed.');
   if(mission.state.status==='complete')return;
   const priorPlayer=resume?.player??player?.state()??null;
   const resumedPlayer=replanAfterRecovery(priorPlayer,{explicitRetry:c.retryBlockedPolicy===true,
    mission:mission.state,qualification,runtimeLock,plannerLock,observation:observe()});
   mission.state.status='running';mission.state.reason=null;engine('bot');player=createPlayer(resumedPlayer,mission.state.protected);resume=null;
  }else{
   if(!/^[a-zA-Z0-9_-]{1,100}$/.test(c.record.id))throw new Error('Invalid hunt identifier.');
   const o=observe(),previousTrade=nativeTrade?.state??resume?.nativeTrade,wireless=readNativeWirelessStatus(session,inputs.runtime);
   const outcome=previousTrade?validateNativeTradeContinuation(o,wireless,previousTrade):null;
   assertHuntHandoff(o,{...mission?.state,nativeTrade:previousTrade},wireless,outcome);
   assertCaptureCapacity(o.playerMemory.trainer,{quantity:c.record.request.quantity});
   const candidate=createSuiteMission({id:c.record.id,request:c.record.request,route:c.record.route,world:inputs.world,story:inputs.story,mechanics:inputs.battle,fundingPlanner:basePlanner});candidate.initialize(o);
   if(c.record.postgameObjective)candidate.state.postgameObjective=c.record.postgameObjective;
   if(c.record.continuation){candidate.state.continuation=c.record.continuation;botPolicy={...botPolicy,enabled:true,awaitingCommand:false};atomicJson(botPolicyPath,botPolicy);}
   const previous=persist('before-next-method-hunt');
   if(mission)atomicJson(join(directory,`archived-${mission.state.id}.json`),{request:mission.request,mission:mission.state,nativeTrade:previousTrade,save:previous,reason:'Continued the same saved game with a new hunting method.'});
   const sram=Buffer.from(session.saveSram()),state=Buffer.from(session.saveState());
   const path=join(directory,'hunts',c.record.id,...(usingNativeRadio?['native-radio','saves']:['saves']));
   const nextVault=new SaveVault(path,identity);
   nextVault.write(state,sram,{frame:session.frame,reason:'continued-current-game',source:saveReference(previous),session:{id:c.record.id,request:c.record.request,mission:candidate.state,player:null,tradePreparation:null,nativeTrade:null,decisions:sequence}});
   if(usingNativeRadio){cfg.nativeRadio.huntId=c.record.id;atomicJson(configPath,config);}
   atomicJson(activePath,createHuntSelection(c.record.id,usingNativeRadio,existsSync(activePath)?json(activePath):null));manualProfile=false;vault=nextVault;mission=candidate;resume=null;tradePreparation=null;nativeTrade=null;captureEvidence=null;player=null;await postgame?.close();postgame=null;
   nativeRadio?.close();nativeRadio=null;mission.state.status='running';engine('bot');player=createPlayer();
  }
  if(queuedHunt?.record.id===mission.state.id){queuedHunt=null;if(existsSync(queuedHuntPath))unlinkSync(queuedHuntPath);}
  botPolicy={...botPolicy,enabled:true,awaitingCommand:false,consolePowered:true,...(c.runScope?{runScope:c.runScope}:{})};atomicJson(botPolicyPath,botPolicy);
  running=true;persist('wild-hunt-started');task=runMission();return;
 }
 if(c.type==='host-trade' || (c.type==='start'&&(nativeTrade||resume?.nativeTrade))){
  if(game!=='firered')throw new Error('Native trade control needs this game’s own link adapter. Only the FireRed Direct Corner route is implemented.');
  if(!tradeState()||tradeState().id!==(c.id??c.record?.id))throw new Error('Select the current game’s saved capture.');
  if(running)return;
  await task;
  const prepared=tradePreparation?.state??resume?.tradePreparation;
  if(!prepared?.nativeSaveVerified)throw new Error('Save and prepare this game’s party before opening its native trade.');
  nativeTrade=new FireRedNativeTradeHost({world:inputs.world,center:prepared.center,fingerprint:prepared.fingerprint,state:nativeTrade?.state??resume?.nativeTrade});
  if(nativeTradeFinished(nativeTrade.state))return;
  if(['trade-outcome-unresolved','saved-exit-incomplete'].includes(nativeTrade.state.phase))throw new Error(nativeTrade.state.reason??'The previous exchange must not be repeated.');
  if(usingNativeRadio)startNativeRadio();
  // Keep the captured party inside this emulator. Link traffic will require
  // normal speed; never launch the record-export bridge as a fallback.
  tradePreparation??=new TradePreparation({receipt:json(join(directory,`trade-ready-${tradeState().id}.json`)),center:prepared.center,nurseIndex:prepared.nurseIndex,mechanics:inputs.battle,world:inputs.world,state:prepared});
  engine('bot',false,1);player=createPlayer();resume=null;
  tradeState().status='running';tradeState().reason='Going upstairs to host a native trade as Leader.';
  running=true;persist('native-trade-started');task=runNativeTrade();return;
 }
 if(c.type==='prepare-trade' || (c.type==='start' && (tradePreparation || resume?.tradePreparation))){
  if(nativeRadio||readNativeWirelessStatus(session,inputs.runtime).remotePlayers>0)throw new Error('Finish the active native link before preparing another trade');
  if(game!=='firered'||!tradeState()||tradeState().id!==(c.id??c.record?.id)||(!ownedTrade&&!tradeState().protected))throw new Error('Select the completed, protected FireRed capture to prepare its trade.');
  if(running)return;
  const receiptPath=join(directory,`trade-ready-${tradeState().id}.json`);
  if(!existsSync(receiptPath))throw new Error('The caught Pokémon has no verified native-save receipt.');
  const receipt=json(receiptPath);
  if(receipt.reservation)throw new Error('This Pokémon is reserved for a Switch trade. Resolve that trade before moving it.');
  const center='MAP_LAVENDER_TOWN_POKEMON_CENTER_1F';
  const map=inputs.world.data.maps.find(m=>m.id===center);
  const nurseIndex=map?.objectEvents.findIndex(o=>/EventScript_Nurse$/.test(o.script));
  if(!(nurseIndex>=0))throw new Error('The destination nurse could not be verified.');
  tradePreparation=new TradePreparation({receipt,center,nurseIndex,mechanics:inputs.battle,world:inputs.world,state:tradePreparation?.state??resume?.tradePreparation??null});
  botPolicy={...botPolicy,enabled:true,awaitingCommand:false,consolePowered:true,runScope:'task'};atomicJson(botPolicyPath,botPolicy);
  engine('bot');player=createPlayer(tradePreparation.state.phase==='ready'?null:resume?.tradePreparation?resume.player:null);
  resume=null;tradeState().status='running';tradeState().reason='Taking the saved capture to a Pokémon Center for trading.';
  running=true;persist('trade-preparation-started');task=runTradePreparation();return;
 }
 if(c.type==='start'){
  if(game!=='firered')throw new Error('Hunt execution is currently available for FireRed Snorlax.');
  if(mission&&mission.state.id!==c.record.id)throw new Error('This game has another hunt. Finish or explicitly archive it before starting a different request.');
  if(running)return;
  if(mission?.state.status==='complete')return;
  if(mission&&JSON.stringify(mission.request)!==JSON.stringify(c.record.request))throw new Error('Saved hunt settings changed.');
  let candidate=mission;
  if(!candidate){
   if(!/^[a-zA-Z0-9_-]{1,100}$/.test(c.record.id))throw new Error('Invalid hunt identifier.');
   const routes=c.record.request.locationId==='10:309:21:'?['map_route16']:c.record.request.locationId==='10:276:21:'?['map_route12']:['map_route12','map_route16'];
   const prepared=routes.map(route=>new SaveVault(join(config.directory,'prepared',owner,route),identity)).find(v=>v.current()?.metadata?.ready);
   if(!prepared)throw new Error('A prepared Snorlax encounter setup is not installed yet.');
   const start=prepared.read();
   if(start.metadata?.speciesId!==143||!start.metadata.nativeSaveVerified)throw new Error('The prepared encounter has not passed verification.');
   persist('before-opening-prepared-hunt');emulator.close();
   session.loadSram(start.sram);session.loadState(start.state);renewObserver();
   try{
    candidate=new SnorlaxMission({id:c.record.id,request:c.record.request});candidate.initialize(observe());
    const o=observe(),ballIds=candidate.captureRequirements().ballIds;
    const usableBalls=o.playerMemory.trainer.bag.pokeBalls.filter(b=>ballIds.includes(b.itemId)).reduce((n,b)=>n+b.quantity,0);
    if(o.emulator.mode!=='overworld'||o.phase!=='stable'||o.playerMemory.map?.id!==candidate.state.route.map||ballCount(o)<c.record.request.limits.minBalls+30||usableBalls<30)throw new Error('The prepared setup does not satisfy this request’s encounter, capture supply or ball reserve.');
   }catch(error){const normal=gameVault.read();session.loadSram(normal.sram);session.loadState(normal.state);engine('manual');throw error;}
   vault=new SaveVault(join(directory,'hunts',c.record.id,'saves'),identity);
   candidate.state.anchor=saveReference(vault.write(start.state,start.sram,{source:'prepared-encounter',frame:session.frame}));
   candidate.state.phase='hunting';mission=candidate;atomicJson(activePath,{id:c.record.id});
  }
  candidate.initialize(observe());mission=candidate;mission.state.status='running';mission.state.reason=null;
  engine('bot');player=createPlayer(mission.state.protected?(resume?.player??player?.state()??null):null,mission.state.protected);resume=null;
  botPolicy={...botPolicy,enabled:true,awaitingCommand:false,consolePowered:true,...(c.runScope?{runScope:c.runScope}:{})};atomicJson(botPolicyPath,botPolicy);
  running=true;persist('hunt-started');task=runMission();
 }else if(c.type==='stop'){
  if(!tradeState()||c.id!==tradeState().id)throw new Error('This is not the current task.');
  botPolicy.enabled=false;atomicJson(botPolicyPath,botPolicy);stop('Stopped by you. The current save and hunt anchor are preserved.');await task;persist('hunt-stopped');
 }else if(c.type==='archive'){
  if(running||mission?.state.id!==c.id||(mission.state.protected&&mission.state.status!=='complete'))throw new Error('This hunt cannot be archived while active or protecting an unresolved encounter.');
  atomicJson(join(directory,`archived-${mission.state.id}.json`),{request:mission.request,mission:mission.state,save:vault.current()});
  if(usingNativeRadio){
   if(existsSync(activePath))unlinkSync(activePath);
   await shutdown('Returned to the normal game save.');return;
  }
  mission=null;player=null;resume=null;tradePreparation=null;nativeTrade=null;captureEvidence=null;emulator.close();vault=gameVault;
  const normal=gameVault.read();session.loadSram(normal.sram);session.loadState(normal.state);
  if(existsSync(activePath))unlinkSync(activePath);
  engine('manual');persist('returned-to-game-save');
 }else if(c.type==='save')persist('save-now');
 else throw new Error('Unknown Suite command.');
}
function startNativeRadio(){
 nativeRadio?.close();
 const settingsPath=join(directory,'wireless.json');
 const connection={...cfg.nativeRadio,...(existsSync(settingsPath)?json(settingsPath):{})};
 nativeRadio=new NativeRadioLink({peripheral:session.attachWireless(),...connection,
  transport:connection.transport??(config.radioRuntime?'appliance':'ssh'),runtime:config.radioRuntime,keysPath:connection.keysPath,stateDir:directory,
  log:text=>appendFileSync(join(directory,'native-radio.log'),text,{mode:0o600})});
}
function pauseNativeRetry(){
 emulator.pause('Waiting to reconnect the native trade.');nativeRadio?.close();nativeRadio=null;
 tradeState().phase='native-trade-retry-wait';tradeState().reason=`Reconnecting after: ${nativeTrade.state.lastFailure}`;
 persist('native-trade-retry');progress();
}
function restartNativeGame(){
 // Keep the same session/video/audio owner; reset the device, never a link snapshot.
 emulator.pause('Restarting the native link.');nativeRadio?.close();nativeRadio=null;
 persist('before-native-trade-reconnect');emulator.close();session.reset();renewObserver();
 lastObservation=continueNativeSave(session,observer);
 return validateNativeTradeContinuation(lastObservation,readNativeWirelessStatus(session,inputs.runtime),nativeTrade.state);
}
async function verifyNativeTradeSave(state=nativeTrade?.state??resume?.nativeTrade){
 // Verify persistence with a radio-free diagnostic instance. The owning game
 // stays at its normal room exit; successful trading never resets its viewer.
 const sram=Buffer.from(session.saveSram()),check=await makeFireRedSession(coreDirectory,coreManifest);
 try{
  check.loadSram(sram);
  const checkObserver=createFireRedObserver({session:check,runtime:inputs.runtime,world:inputs.world,story:inputs.story,runId:'native-trade-save-verification'});
  const o=continueNativeSave(check,checkObserver);
  const result=validateNativeTradeContinuation(o,readNativeWirelessStatus(check,inputs.runtime),state);
  if(digest(check.saveSram())!==digest(sram))throw new Error('Native save verification changed SRAM.');
  return result;
 }finally{check.close();}
}
async function tryRecoverSavedTrade(){
 if(game!=='firered'||running||exiting)return false;
 const state=nativeTrade?.state??resume?.nativeTrade;
 let next=inspectSavedTradeRecovery(observe(),readNativeWirelessStatus(session,inputs.runtime),state);
 if(!next||next.kind==='blocked')return false;
 try{
  emulator.pause('Verifying the received Pokémon before returning from the link error.');
  if(await verifyNativeTradeSave(state)!=='saved-exit-incomplete')throw Error('The interrupted exchange does not match its native save.');
  state.completion.nativeSaveVerified=true;
  state.recovery={...state.recovery,startedFrame:session.frame,startedAt:Date.now()};
  state.phase='recovering-saved-trade';
  tradeState().status='recovering';tradeState().reason='The trade is saved. Returning from the communication error without repeating it.';
  persist('verified-interrupted-trade-save');engine('bot',false,1);running=true;
  while(!exiting){
   lastObservation=observe();next=inspectSavedTradeRecovery(lastObservation,readNativeWirelessStatus(session,inputs.runtime),state);
   if(!next||next.kind==='blocked')throw Error(next?.reason??'The interrupted trade cannot safely return to its saved game.');
   if(next.kind==='recovered'){
    state.recovery.fieldVerified=true;state.recovery.finishedAt=Date.now();state.phase='interrupted';
    const reason='The Pokémon is saved, but the room exit had a communication error. Returned to the saved game; this exchange will not be repeated.';
    state.reason=reason;tradeState().phase='native-trade-interrupted';stop(reason,'interrupted');
    botPolicy={...botPolicy,enabled:true,awaitingCommand:true,consolePowered:true,runScope:'task'};atomicJson(botPolicyPath,botPolicy);
    engine('bot',true,1);persist('recovered-interrupted-trade');progress();return true;
   }
   await emulator.execute(next.action??{buttons:[],holdFrames:8,releaseFrames:0});
   if(Date.now()-lastProgress>1000)progress();
  }
 }catch(error){
  state.recovery={...state.recovery,failed:true,reason:error.message};state.phase='saved-exit-incomplete';
  stop(error.message,'blocked');
 }
 return false;
}
async function runNativeTrade(){
 while(running&&!exiting){
  try{
   lastObservation=observe();const o=lastObservation;
   const next=nativeTrade.inspect(o,readNativeWirelessStatus(session,inputs.runtime),nativeRadio?.status()??null);
   tradeState().phase=`native-trade-${nativeTrade.state.phase}`;
   if(next.kind==='cancelled'){
    stop(next.reason,'cancelled');
    botPolicy={...botPolicy,enabled:true,awaitingCommand:true,consolePowered:true,runScope:'task'};atomicJson(botPolicyPath,botPolicy);
    engine('bot',true,1);persist('native-trade-cancelled');progress();break;
   }
   if(next.kind==='retry'){pauseNativeRetry();continue;}
   if(next.kind==='reconnect'){
    const outcome=restartNativeGame();
    if(outcome==='complete'){nativeTrade.state.phase='complete';stop('Native trade and saved received Pokémon verified.','complete');break;}
    if(outcome!=='ready')throw new Error('The previous exchange is saved, but its normal exit was interrupted. It will not be repeated.');
    nativeTrade.reconnected();engine('bot',false,1);player=createPlayer();startNativeRadio();
    tradeState().reason='Reopening the native Leader room.';persist('native-trade-reconnected');progress();continue;
   }
   if(nativeTrade.state.phase==='retry-wait'){
    if(Date.now()-lastProgress>1000)progress();
    await sleep(100);continue;
   }
   if(next.kind==='verify-complete'){
    emulator.pause('Verifying the native trade save after normal exit.');
    if(await verifyNativeTradeSave()!=='complete')throw new Error('The native trade save did not verify.');
    nativeTrade.state.phase='complete';nativeTrade.state.completion.nativeSaveVerified=true;
    tradeState().phase='native-trade-complete';stop('Native trade and saved received Pokémon verified.','complete');break;
   }
   if(next.kind==='complete'){stop('Native trade and saved received Pokémon verified.','complete');break;}
   if(next.kind==='stop'){stop(next.reason,'blocked');break;}
   if(nativeTrade.checkSetupTimeout()){pauseNativeRetry();continue;}
   if(next.objective)objective=next.objective;
   const decision=next.kind==='input'?{kind:'act',action:next.action,reason:'Native trade control'}:next.kind==='wait'?{kind:'resample',action:{buttons:[],holdFrames:8,releaseFrames:0}}:player.decide(o);lastDecision=decision;
   if(['blocked','complete'].includes(decision.kind)){stop(decision.reason??'Native trade setup stopped for inspection.','blocked');break;}
   sequence++;
   if(decision.kind==='act')appendFileSync(join(directory,'decisions.ndjson'),JSON.stringify({at:new Date().toISOString(),frame:session.frame,phase:tradeState().phase,map:mapped(o),decision:{sequence,kind:decision.kind,action:decision.action,recommendation:decision.winner?.recommendation},nativeTrade:{fingerprint:nativeTrade.state.fingerprint,tradeMenu:nativeTrade.state.wireless?.tradeMenu??null}})+'\n',{mode:0o600});
   const execution=await emulator.execute(decision.action??{buttons:[],holdFrames:8,releaseFrames:0});
   if(!running)break;
   if(next.kind==='policy')player.observeExecution({observation:o,decision,execution});
   if(Date.now()-lastSave>30000)persist('native-trade-progress');
   if(Date.now()-lastProgress>1000)progress();
   await sleep(0);
  }catch(error){
   console.error(error.stack);
   if(/Native wireless queue overflowed/.test(error.message)){
    const next=nativeTrade.inspect(observe(),readNativeWirelessStatus(session,inputs.runtime),{reason:error.message});
    if(next.kind==='retry'){pauseNativeRetry();continue;}
   }
   stop(error.message,'blocked');break;
  }
 }
}
async function runTradePreparation(){
 const began=Date.now();
 try{
  while(running&&!exiting){
   lastObservation=observe();const o=lastObservation,next=tradePreparation.inspect(o);
   tradeState().phase=`trade-${tradePreparation.state.phase}`;
   if(next.kind==='stop'){stop(next.reason,'blocked');break;}
   if(next.kind==='ready'){
    persist('trade-party-ready');
    const path=join(directory,`trade-ready-${tradeState().id}.json`),receipt=json(path);
    atomicJson(path,{...receipt,pokemon:next.pokemon,save:vault.current(),preparation:tradePreparation.state});
    if(tradeState().autoHostTrade){
     nativeTrade=new FireRedNativeTradeHost({world:inputs.world,center:tradePreparation.state.center,fingerprint:tradePreparation.state.fingerprint});
     startNativeRadio();engine('bot',false,1);player=createPlayer();resume=null;
     tradeState().reason='Going upstairs to host a native trade as Leader.';persist('native-trade-started');
     await runNativeTrade();return;
    }
    tradeState().phase='complete';stop('The selected Pokémon is in the healed party and saved at the Pokémon Center.','complete');break;
   }
   if(Date.now()-began>15*60000){stop('Trade preparation reached its travel time limit. The current save is preserved.','blocked');break;}
   if(next.objective)objective=next.objective;
   const decision=next.kind==='wait'?{kind:'resample',action:{buttons:[],holdFrames:8,releaseFrames:0}}:player.decide(o);lastDecision=decision;
   if(['blocked','complete'].includes(decision.kind)){stop(decision.reason??'Trade preparation stopped for inspection.','blocked');break;}
   sequence++;
   if(sequence%10===0)appendFileSync(join(directory,'decisions.ndjson'),JSON.stringify({at:new Date().toISOString(),frame:session.frame,phase:tradeState().phase,map:mapped(o),decision:{sequence,kind:decision.kind,reason:decision.reason,recommendation:decision.winner?.recommendation}})+'\n',{mode:0o600});
   const execution=await emulator.execute(decision.action??{buttons:[],holdFrames:8,releaseFrames:0});
   if(!running)break;
   if(next.kind!=='wait')player.observeExecution({observation:o,decision,execution});
   if(Date.now()-lastSave>30000)persist('trade-preparation-progress');
   if(Date.now()-lastProgress>1000)progress();
   await sleep(0);
  }
 }catch(error){console.error(error.stack);stop(error.message,'blocked');}
}
process.once('SIGTERM',()=>void shutdown('SIGTERM'));
process.once('SIGINT',()=>void shutdown('SIGINT'));
function stepEmeraldCompanion(){
 try{
  const next=emeraldCompanion.next();companionPreparation=emeraldCompanion.state();sequence=emeraldRuntime.decisions;
  if(next.kind==='stop'||next.kind==='wait'){stop(next.reason??'The companion is waiting.','blocked');return null;}
  return next.action.buttons;
 }catch(error){emeraldCompanion.wait(error.message);companionPreparation=emeraldCompanion.state();console.error(error.stack);stop(error.message,'blocked');return null;}
}
async function ensureEmeraldRuntime(){
 const {createEmeraldRuntime}=await import(pathToFileURL(join(config.researchBots,'games/emerald/player/runtime.mjs')));
 emeraldRuntime??=await createEmeraldRuntime({romPath:cfg.cartridge.path,coreDirectory:cfg.core,session,tickets:{genderTicket:1,starterTicket:0},teamPlan:null});
 return emeraldRuntime;
}
// Readiness is verified against a cold boot of this owner's own native save in
// a separate pinned emulator; the running game is never changed by the check.
async function prepareFireRedPartner(requestId,sourceOwner,offer=null){
 lastObservation=observe();
 const sram=Buffer.from(session.saveSram()),check=await makeFireRedSession(coreDirectory,coreManifest);
 let saved;
 try{check.loadSram(sram);saved=continueNativeSave(check,createFireRedObserver({session:check,...inputs,runId:'firered-partner-native-save',storyWatch:{flags:[...FIRERED_PARTNER_WATCH.flags],variables:[]}}));}
 catch(error){saved=null;console.error(error.stack);}
 finally{check.close();}
 companionPreparation=inspectFireRedPartnerReadiness({live:lastObservation,saved,world:inputs.world,owner,requestId,sourceOwner,sramSha256:digest(sram),offer,ledger:extraSaveLedger});
 companionPreparation.checkedAt=Date.now();
}
async function startEmeraldCompanion(){
 await ensureEmeraldRuntime();
 emeraldCompanion??=createEmeraldCompanion({runtime:emeraldRuntime,requestId:companionPreparation.requestId,state:companionPreparation});
 emeraldActive=true;running=true;engine('bot',false,5);
 progress();
}
if(['firered','emerald'].includes(game))localBridge=createLocalEvolutionWorker({game,owner,role:localRole,config,session,cartridge:nativeCartridge,coreDirectory,coreManifest,inputs,state:saved.metadata?.localEvolution??null,hooks:{
 enabled:()=>canAutomate(botPolicy),
 observe:()=>lastObservation=observe(),
 getEmeraldRuntime:ensureEmeraldRuntime,
 fireRedState:()=>postgame?.state(),
 companionState:()=>emeraldCompanion?.state()??companionPreparation,
 acceptRoundTrip:(result,o)=>postgame.acceptEvolutionRoundTrip(result,o),
 // extra-saves: a verified single leg belongs to the main save's exchange; a partner proves it against its ledger.
 acceptExtraSaveTrade:(result,o)=>postgame.acceptExtraSaveTrade(result,o),extraSaveLedger:()=>extraSaveLedger,
 async pause(reason){running=false;emulator.pause(reason);await task;postgameActive=false;emeraldActive=false;localActive=false;},
 startEngine(speed,frameInput){localActive=true;localFrameInput=frameInput;running=true;engine('bot',false,speed);},
 finishEngine(reason){running=false;localActive=false;emulator.pause(reason);},
 // Same session owner, as restartNativeGame: reset the device and continue the
 // unchanged native save; an active wireless session is never restored.
 ...(game==='firered'?{async restartNative(reason){
  running=false;localActive=false;emulator.pause(reason);
  const sramSha256=digest(Buffer.from(session.saveSram()));
  session.reset();renewObserver();
  lastObservation=await continueNativeSaveAsync(session,observer);
  if(digest(session.saveSram())!==sramSha256)throw Error('The native save changed during restart verification.');
  const wireless=readNativeWirelessStatus(session,inputs.runtime);
  persist('local-trade-native-restart');progress();
  return {observation:lastObservation,wireless,sramSha256};
 }}:{}),
 engine:()=>emulator,persist,progress,
}});
while(!exiting){
 try{
  const p=join(directory,'command.json');
  if(existsSync(p)){const c=json(p);if(c.commandId!==lastCommand){try{await command(c);}catch(e){commandError=e.message;console.error(e.stack);}lastCommand=c.commandId;progress();}}
  if(updateHold){if(Date.now()-lastProgress>1000)progress();await sleep(100);continue;}
  if(updateRequest&&!running&&await holdForUpdate(observe())){await sleep(100);continue;}
  if(resumeActiveTask){resumeActiveTask=false;if(canAutomate(botPolicy)&&!running)await command({type:'start',record:{id:mission.state.id,request:mission.request,route:mission.state.route}});}
  if(!running&&campaign?.state().status==='complete')await continueCompletedCampaign();
  if(campaign&&canAutomate(botPolicy)&&botPolicy.runScope==='campaign'&&!running&&['running','finishing'].includes(campaign.state().status))await startCampaign();
  if(canAutomate(botPolicy)&&queuedHunt&&!queuedHunt.error&&!running&&postgame?.canYield(observe())){
   const next=queuedHunt;
   try{await command({type:'start',record:next.record,runScope:next.runScope});queuedHunt=null;if(existsSync(queuedHuntPath))unlinkSync(queuedHuntPath);}
   catch(e){next.error=e.message;queuedHunt=next;atomicJson(queuedHuntPath,queuedHunt);commandError=e.message;progress();}
  }
  // A rejected automatic start belongs to its agenda. Retain user requests and
  // protected transactions, but let a clean automatic owner try other work.
  if(canAutomate(botPolicy)&&queuedHunt?.error&&!running&&await postgame?.rejectHunt(queuedHunt.record,queuedHunt.error,observe())){
   queuedHunt=null;if(existsSync(queuedHuntPath))unlinkSync(queuedHuntPath);
   commandError=null;persist('postgame-hunt-deferred');await startPostgame();
  }
  if(fireRedPartner&&canAutomate(botPolicy)&&!running&&!localBridge?.busy()){
   // Re-verify a waiting partner; after a verified net-zero return, idle.
   if(companionPreparation?.phase==='waiting'&&Date.now()-(companionPreparation.checkedAt??0)>60000){await prepareFireRedPartner(companionPreparation.requestId,companionPreparation.sourceOwner,companionPreparation.offer??null);persist('firered-partner-rechecked');progress();}
   const local=localBridge?.state();
   if(local?.phase==='complete'&&local.requestId===companionPreparation?.requestId&&companionPreparation.phase==='ready-for-transfer'){
    if(local.exchangeProof)extraSaveLedger=applyPartnerLegProof(extraSaveLedger,local.exchangeProof);// extra-saves
    companionPreparation={...companionPreparation,phase:'complete',reason:local.exchangeProof?.summary??'The round trip finished; the partner holds exactly its original Pokémon again.',netZeroVerified:local.netZeroVerified===true};
    botPolicy={...botPolicy,awaitingCommand:true};atomicJson(botPolicyPath,botPolicy);persist('firered-partner-round-trip-complete');progress();
   }
  }
  if(game==='firered'&&!fireRedPartner&&postgame){
   publishPartnerAvailability();
   // extra-saves: the host's inventory of other owned FireRed saves, re-read when it changes.
   const sourcesPath=join(directory,'extra-save-sources.json'),sourcesAt=existsSync(sourcesPath)?statSync(sourcesPath).mtimeMs:null;
   if(sourcesAt!==extraSaveSourcesAt||postgame!==extraSaveSourcesOwner){extraSaveSourcesAt=sourcesAt;extraSaveSourcesOwner=postgame;try{postgame.publishExtraSaveSources(sourcesAt===null?null:json(sourcesPath));}catch(error){console.error(error.message);}}
  }
  await localBridge?.poll();
  if(game==='firered'&&!fireRedPartner&&!running)await tryRecoverSavedTrade();
  // A retained Hall-of-Fame record no longer owns the active postgame task.
  // Its hunt still needs the same bounded recovery as a standalone hunt.
  if(game==='firered'&&!fireRedPartner&&!running&&(!campaign||campaign.state().status==='complete'))await tryAutomaticRecovery();
  if(game==='firered'&&canAutomate(botPolicy)&&botPolicy.runScope==='postgame'&&!running&&!postgame&&mission?.state.postgameObjective&&mission.state.status==='blocked'&&!mission.state.protected&&!localBridge?.busy()&&existsSync(adventurePath)){
   const o=observe();
   if(o.phase==='stable'&&o.emulator.mode==='overworld'&&!o.emulator.inBattle&&!Object.values(o.playerMemory.ui??{}).some(Boolean)&&readNativeWirelessStatus(session,inputs.runtime).remotePlayers===0){
    const agenda=releaseBlockedHunt(json(adventurePath),mission.state.postgameObjective,mission.state.reason,o);
    atomicJson(adventurePath,agenda);await postgame?.close();postgame=createPostgameClient({...inputs,mechanics:inputs.battle,qmmSupply:qmmSupplyOption(),leagueTraining:leagueTrainingOption(),state:{schema:'pokemon-suite/postgame/v1',agenda}});await startPostgame();
   }
  }
  if(!localBridge?.busy()&&game==='firered'&&!fireRedPartner&&canContinuePostgame({enabled:canAutomate(botPolicy),running,mission:mission?.state,nativeTrade:nativeTrade?.state??resume?.nativeTrade,wireless:readNativeWirelessStatus(session,inputs.runtime),postgame:postgame?.state(),recovery:recovery.state().current,interruptedRecovery}))await startPostgame();
  if(!localBridge?.busy()&&game==='emerald'&&canAutomate(botPolicy)&&!running&&companionPreparation?.phase==='preparing')await startEmeraldCompanion();
  if(localActive&&Date.now()-lastSave>30000)persist('local-evolution-progress');
  if(emeraldActive){if(Date.now()-lastSave>30000)persist('companion-progress');if(Date.now()-lastProgress>1000)progress();}
  if(!running&&Date.now()-lastProgress>1000){lastObservation=observe();progress();}
  if(!running&&!mission&&Date.now()-lastSave>30000)persist('viewer-automatic');
 }catch(e){console.error(e.stack);}
 await sleep(100);
}
async function shutdown(signal){
 if(exiting)return;exiting=true;running=false;emulator.pause(signal);await localBridge?.stop(signal,{shutdown:true});nativeRadio?.close();nativeRadio=null;if(nativeTrade){nativeTrade.state.advertising=false;nativeTrade.state.radio=null;}await task;persist(signal);progress();emulator.close();await live.close();await campaign?.close();await postgame?.close();session.close();process.exit(0);
}
