import { createHash, randomBytes, randomUUID } from "node:crypto";
import { isDeepStrictEqual } from "node:util";
import { createRunProfile, PLAYER_NAME_PATTERN } from "../player/run-profile.js";
import { normalizeTeamSeed } from "../player/roster-generator.js";
import { createRosterPlanForRun, rosterCheckpoint } from "../player/roster-selection.js";
import { createCampaignPlanner } from "../player/campaign.js";
import { createPolicyAdvisors, isPcAccessMenu } from "../player/advisors.js";
import { createCentralPlayer, mapRecommendation } from "../player/delegator.js";
import { actionPrecondition } from '../emulator/action-precondition.js';
import { inspectNativeSaveContinuation } from "./native-cold-boot.js";
import { createCampaignSupervisor } from "../player/campaign-supervisor.js";
import { restoreCampaignAccounting } from "../player/campaign-suspension.js";
import { createRecoveryLedger } from './recovery.js';
import {captureRecoveryEvidence,recoveryProgress,recoveryFieldReady} from './campaign-recovery.js';
import { frlgGame } from "../frlg.js";
// extra-saves: a helper save's one-per-save choices and its goal stop.
import {validateHelperGoal,inspectHelperGoal,HELPER_GOAL_WATCH} from './extra-save-helper.js';

export const DEFAULT_RUN_SETTINGS = Object.freeze({ label: "FireRed adventure", starter: "random",
  teamMode: "random", helpers: "allowed", seedMode: "fresh", seed: null, teamSeed: null, afterCampaign: "postgame",
  // null types one of the seeded official presets; a goal may choose the name.
  trainerName: null });
const SCHEMA = "pokemon-suite/campaign-run/v1";
// extra-saves: optional helper-save settings, stored only when given, so a
// default record (and its commitment) is exactly as before.
const OPTIONAL_RUN_SETTINGS = Object.freeze(["fossil", "helperGoal"]);
// LeafGreen (build 124) plays the same story campaign. Its postgame is not
// implemented yet, so a LeafGreen run waits for commands after the Hall of Fame.
const LEAFGREEN_RUN_SETTINGS = Object.freeze({ ...DEFAULT_RUN_SETTINGS, label: "LeafGreen adventure", afterCampaign: "wait" });
export function defaultRunSettings(game = "firered") {
  frlgGame(game);
  return game === "leafgreen" ? LEAFGREEN_RUN_SETTINGS : DEFAULT_RUN_SETTINGS;
}

export function validateRunSettings(value, game = "firered") {
  const defaults = defaultRunSettings(game);
  if (!value || typeof value !== "object" || Array.isArray(value) ||
      Object.keys(value).some(key => !Object.hasOwn(DEFAULT_RUN_SETTINGS,key) && !OPTIONAL_RUN_SETTINGS.includes(key))) throw new Error("Unknown or unsupported run setting.");
  const settings = { ...defaults, ...value };
  if (typeof settings.label !== "string" || !settings.label.trim() || settings.label.length > 50) throw new Error("Name the run using 1 to 50 characters.");
  settings.label = settings.label.trim();
  if (!["random","bulbasaur","charmander","squirtle"].includes(settings.starter)) throw new Error("Choose a native FireRed starter.");
  if (!["random","balanced"].includes(settings.teamMode)) throw new Error("Choose Random Adventure or Balanced Adventure.");
  if (!["allowed","field-only","none"].includes(settings.helpers)) throw new Error("Choose the helper policy.");
  if (settings.teamMode === "balanced" && settings.helpers !== "none") throw new Error("Balanced Adventure plans field moves within its six; choose no additional helpers.");
  if (!["fresh","replay"].includes(settings.seedMode)) throw new Error("Choose fresh randomness or explicit seed replay.");
  if (!["postgame","wait"].includes(settings.afterCampaign)) throw new Error("Choose postgame continuation or wait after the League.");
  if (game === "leafgreen" && settings.afterCampaign !== "wait") throw new Error("The LeafGreen postgame is not available yet. Choose to wait after the League.");
  if (settings.trainerName !== null && (typeof settings.trainerName !== "string" || !PLAYER_NAME_PATTERN.test(settings.trainerName)))
    throw new Error("Choose a trainer name of 1 to 7 letters (A–Z, a–z), or leave it empty for a preset name.");
  if (Object.hasOwn(settings, "fossil") && !["helix","dome"].includes(settings.fossil)) throw new Error("Choose the Helix Fossil or the Dome Fossil.");
  if (Object.hasOwn(settings, "helperGoal")) {
    const goal = validateHelperGoal(settings.helperGoal);
    if (goal && settings.afterCampaign !== "wait") throw new Error("A helper save waits after its goal (afterCampaign 'wait').");
    if (goal?.kind === "starter" && settings.starter !== goal.starter) throw new Error("A starter helper save must choose that starter.");
    if (goal?.kind === "fossil" && (settings.fossil ?? "helix") !== goal.fossil) throw new Error("A fossil helper save must take that fossil at Mt. Moon.");
    settings.helperGoal = goal;
  }
  if (settings.seedMode === "fresh") {
    if (settings.seed !== null || settings.teamSeed !== null) throw new Error("Fresh runs create new seeds. Choose Replay to reuse seeds.");
  } else {
    if (!Number.isSafeInteger(settings.seed) || settings.seed < 0 || settings.seed > 0xffffffff) throw new Error("The opening seed must be a 32-bit unsigned integer.");
    settings.teamSeed = normalizeTeamSeed(settings.teamSeed);
  }
  return settings;
}

function commitment(record) {
  return createHash("sha256").update(JSON.stringify({ schema: record.schema, id: record.id, game: record.game,
    createdAt: record.createdAt, settings: record.settings, seed: record.seed, teamSeed: record.teamSeed,
    runProfile: record.runProfile, teamPlan: record.teamPlan, romSha1: record.romSha1 })).digest("hex");
}

// A roster context belongs to one FRLG cartridge; a run commits that game.
function assertRosterGame(rosterContext, game) {
  const { cartridgeProfileId, title } = frlgGame(game);
  if (rosterContext?.gameId !== cartridgeProfileId) throw new Error(`A verified ${title} roster is required for this ${title} run.`);
}

export function createCampaignRun({ settings, rosterContext, romSha1 = null, game = "firered" }) {
  assertRosterGame(rosterContext, game);
  const config = validateRunSettings(settings, game);
  const seed = config.seedMode === "replay" ? config.seed : randomBytes(4).readUInt32LE();
  const teamSeed = config.seedMode === "replay" ? config.teamSeed : `hex:${randomBytes(32).toString("hex")}`;
  const runProfile = createRunProfile(seed,{starter:config.starter,playerName:config.trainerName,game});
  const teamPlan = createRosterPlanForRun(runProfile.starter.species,seed,null,{
    rosterMode: config.teamMode === "random" ? "random" : "coherent", teamSeed,
    helpers: config.helpers, rosterContext,
  });
  const record = { schema: SCHEMA, id: `run-${randomUUID()}`, game, createdAt: new Date().toISOString(),
    settings: config, seed, teamSeed, runProfile, teamPlan, romSha1 };
  return { ...record, commitment: commitment(record) };
}

export function restoreCampaignRun(record, rosterContext) {
  if (record?.schema !== SCHEMA || !["firered","leafgreen"].includes(record.game) || !/^run-[a-f0-9-]{36}$/.test(record.id ?? "") ||
      record.commitment !== commitment(record)) throw new Error("The reviewed run commitment changed.");
  assertRosterGame(rosterContext, record.game);
  const settings = validateRunSettings(record.settings, record.game);
  const profile = createRunProfile(record.seed,{starter:settings.starter,playerName:settings.trainerName,game:record.game});
  if (!isDeepStrictEqual(profile,record.runProfile)) throw new Error("The committed starter or trainer changed.");
  if (settings.seedMode === "replay" && (settings.seed !== record.seed || settings.teamSeed !== record.teamSeed)) throw new Error("The replay seeds changed.");
  const plan = createRosterPlanForRun(profile.starter.species,record.seed,rosterCheckpoint(record.teamPlan),{
    rosterContext, teamSeed: record.teamSeed, helpers: settings.helpers,
    rosterMode: settings.teamMode === "random" ? "random" : "coherent",
  });
  if (!isDeepStrictEqual(plan,record.teamPlan)) throw new Error("The committed team or helper plan changed.");
  return record;
}

export function presentCampaignRun(record, state = null, storyProgress = null) {
  const plan = record.teamPlan;
  const training=state?.player?.campaignPlanner?.commitments?.training;
  const rate=training?.trainingRate;
  const measurements=state?.player?.campaignPlanner?.trainingMeasurements;
  const sample=measurements?.samples?.[measurements?.active?.key];
  const observedXpPerMinute=sample?.activeMs>0&&sample.battles>=2?sample.experience/(sample.activeMs/60000):rate?.measuredXpPerMinute;
  const pokemon = (species,extra={}) => ({ species, ...extra, sprite: `./assets/pokedex/${record.game}/${species}.png` });
  return { id: record.id, label: record.settings.label, game: record.game, createdAt: record.createdAt,
    settings: record.settings, seed: record.seed, teamSeed: record.teamSeed, commitment: record.commitment,
    starter: pokemon(record.runProfile.starter.species,{name:record.runProfile.starter.name}),
    team: [pokemon(plan.starterFamily[0],{name:record.runProfile.starter.name,targetSpecies:plan.hallOfFameSpecies[0],family:plan.starterFamily,starter:true}),
      ...plan.acquisitions.map(a => pokemon(a.captureSpecies,{targetSpecies:a.targetSpecies,family:a.family,label:a.label,afterObjectiveId:a.afterObjectiveId}))],
    helpers: [...(plan.temporaryAcquisitions??[]),...((state?.fieldTeamPlan??plan).utilityAcquisitions??[])].map(a => pokemon(a.captureSpecies,{family:a.family,label:a.label,helperRole:a.helperRole,afterObjectiveId:a.afterObjectiveId})),
    pool: { candidateSpecies: plan.coherence?.candidateCount ?? null },
    status: state?.status ?? "review", reason: state?.reason ?? null, objective: state?.objective ?? null,
    task: state?.task ?? null,
    ...(rate||sample?{training:{map:training?.target.map,species:training?.trainingSpecies,
      estimatedXpPerMinute:rate?.xpPerMinute??null,measuredXpPerMinute:observedXpPerMinute??null,basis:rate?.basis??'measured'}}:{}),
    recovery: structuredClone(state?.recovery?.current??null),
    plannerSupervision: structuredClone(state?.plannerSupervision??null),
    supervision: state?.supervision ? Object.fromEntries(['stopReason','idleMs','elapsedMs','progressTimeoutMs','lastProgressAt','recent','reviewedRetries','automaticRecoveries']
      .map(key=>[key,structuredClone(state.supervision[key])])) : null,
    completion: state?.completion ?? null,
    ...(storyProgress?{storyProgress}:{}),
  };
}

export function createCampaignController({record,world,story,mechanics,state=null,fieldTeamPlan=state?.fieldTeamPlan??record?.teamPlan,clock=Date.now,progressTimeoutMs}={}) {
  const helperGoal=record?.settings?.helperGoal??null;
  const planner=createCampaignPlanner({teamPlan:fieldTeamPlan,world,story,mechanics,initialState:state?.player?.campaignPlanner??null,
    storyChoices:{fossil:record?.settings?.fossil??'helix',helperGoal}});
  // extra-saves: the helper goal's park step runs through its own player.
  let helperState=structuredClone(state?.helperGoal??{}),helperObjective=null,helperPlayer=null,activePlayer=null;
  const openHelperPlayer=()=>{const wrapper={...planner,select:()=>helperObjective,selectCollection:()=>null,selectTraining:()=>null,selectBattleSquad:()=>[],campaignStatus:()=>({...planner.campaignStatus(),activeObjective:helperObjective})};
    return createCentralPlayer({campaignPlanner:wrapper,mechanics,captureRequirements:{automaticShinies:true,optimizeCapture:true,shinyPriority:true,safari:true},
      advisors:createPolicyAdvisors({world,mechanics,campaignPlanner:wrapper,runProfile:record.runProfile,teamPlan:fieldTeamPlan})});};
  const openPlayer=initialState=>createCentralPlayer({campaignPlanner:planner,mechanics,initialState,
    captureRequirements:{automaticShinies:true,optimizeCapture:true,shinyPriority:true,safari:true},
    advisors:createPolicyAdvisors({world,mechanics,campaignPlanner:planner,runProfile:record.runProfile,teamPlan:fieldTeamPlan})});
  let player=openPlayer(state?.player??null);
  let status=state?.status??"running",reason=state?.reason??null,hallOfFame=state?.hallOfFame??null,
    completion=state?.completion??null,hasStarted=state?.hasStarted??false;
  const accounting=restoreCampaignAccounting(state,record,progressTimeoutMs);
  const supervisor=createCampaignSupervisor({clock,progressTimeoutMs,initialState:accounting.supervision??null});
  const recovery=createRecoveryLedger(state?.recovery??null);
  let menuRecovery=structuredClone(state?.menuRecovery??null);
  let reviewedMenuRetry=state?.reviewedMenuRetry===true,storySnapshot=null;
  let lastRecoveryProbe=state?.lastRecoveryProbe??-Infinity;
  if(['paused','blocked','complete'].includes(status))supervisor.pause();
  const idle=message=>({kind:"resample",reason:message,action:{buttons:[],holdFrames:8,releaseFrames:0}});
  const expected=[...record.teamPlan.hallOfFameSpecies].sort((a,b)=>a-b);
  const matches=party=>isDeepStrictEqual(party.filter(p=>p.species>0).map(p=>p.species).sort((a,b)=>a-b),expected);
  function tryAlternative(o){
    const saved=player.state();
    if(!recoveryFieldReady(o)||saved.encounterSafety?.capture||saved.encounterSafety?.blocked||saved.workflow?.kind==='in-game-trade')return false;
    const strategy=planner.recoverStalledTask(o,{commit:false});if(!strategy)return false;
    const key=JSON.stringify([record.id,'campaign-strategy',strategy.objective]);
    if(!recovery.begin({key,action:'replan-task',reason:'no-task-progress',strategy},clock()).allowed)return false;
    if(!supervisor.beginRecovery(strategy)){recovery.finish('needs-review','Supported task recovery budget is exhausted.',clock());return false;}
    const baseline=captureRecoveryEvidence(o,planner.campaignStatus(),planner.state());
    planner.recoverStalledTask(o);
    player=openPlayer({...saved,workflow:null,transactionRecovery:null});
    recovery.finish('verifying','Trying a different task strategy; waiting for its outcome.',clock());
    menuRecovery={key,phase:'verifying',baseline,verifiedFrame:null};
    return true;
  }
  function recoverMenu(o,decision) {
    const saved=player.state(),m=o.playerMemory??{},ui=m.ui??{};
    if(o.phase!=='stable'||o.emulator?.inputReady===false)return idle('Waiting for a stable menu before recovery.');
    if(o.emulator?.inBattle||o.emulator?.mode==='battle'||ui.saveDialog||saved.encounterSafety?.capture||
        saved.workflow?.kind==='in-game-trade'||/UNION_ROOM|TRADE|COLOSSEUM|CABLE_CLUB/.test(m.map?.id??''))return decision;
    const key=JSON.stringify([record.id,'campaign-menu',m.map?.id,planner.campaignStatus().activeObjective?.id]);
    const previous=recovery.state().current;
    if(menuRecovery?.phase==='verifying'){
      recovery.finish('failed','The interrupted task repeated before recovery was verified.',clock());menuRecovery=null;
    }
    if(previous?.key===key&&previous.status==='needs-review'&&!reviewedMenuRetry)return decision;
    if(!menuRecovery){
      const attempt=recovery.begin({key,action:'resume-campaign',reason:decision.reason},clock());
      if(!attempt.allowed)return attempt.reason==='cooldown'?idle('Waiting before retrying the interrupted menu.'):decision;
      reviewedMenuRetry=false;
      menuRecovery={key,steps:0,baseline:captureRecoveryEvidence(o,planner.campaignStatus(),planner.state())};
    }
    menuRecovery.baseline??=captureRecoveryEvidence(o,planner.campaignStatus(),planner.state());
    if(o.emulator?.mode==='overworld'&&!Object.values(ui).some(Boolean)&&!m.questLog?.playback){
      // Rebuild transient menu policy only. Keep the committed team, captures,
      // campaign tasks, movement evidence and the semantic progress budget.
      player=openPlayer({...saved,workflow:null,transactionRecovery:null});
      recovery.finish('verifying','Menu closed. Waiting for progress on the interrupted task.',clock());
      menuRecovery={...menuRecovery,phase:'verifying',verifiedFrame:null};
      return idle('Menu closed; verifying task progress.');
    }
    let recommendation;
    if(o.emulator?.mode==='overworld'&&isPcAccessMenu(m,world))recommendation={kind:'close-menu'};
    else if(ui.storage?.stage==='confirm-continue')recommendation={kind:'choose-storage-continue',targetOption:'no',targetIndex:1};
    else if(ui.storage?.stage==='pc-menu')recommendation={kind:'exit-storage'};
    else if(ui.storage?.stage==='pokemon-menu')recommendation={kind:'cancel-storage-action'};
    else if(ui.storage?.movingPokemon===false && ['storage-main','deposit-box'].includes(ui.storage.stage))recommendation={kind:'exit-storage-mode'};
    else if(ui.startMenu||ui.bag||ui.mart||ui.party&&[null,0].includes(ui.party.menuType??null))recommendation={kind:'cancel-conflicting-menu'};
    if(!recommendation||menuRecovery.steps>=32){
      recovery.finish('needs-review','The interrupted menu could not be safely closed.',clock());
      menuRecovery=null;return decision;
    }
    menuRecovery.steps++;
    recommendation.objective='recover-campaign-menu';
    return {kind:'act',reason:'campaign-menu-recovery',winner:{advisor:'verifier',recommendation},
      action:{...mapRecommendation(recommendation,o),precondition:actionPrecondition(o)}};
  }
  return {
    record,
    storyWatch:()=>{const w=planner.storyWatch();return helperGoal?{...w,flags:[...new Set([...w.flags,...HELPER_GOAL_WATCH.flags])],variables:[...new Set([...(w.variables??[]),...HELPER_GOAL_WATCH.variables])]}:w;},
    campaignStatus:()=>planner.campaignStatus(),
    storyProgress(observation){
      if(observation?.phase==='stable'&&storySnapshot?.frame!==observation.frame)storySnapshot=planner.storyProgress(observation);
      return storySnapshot??planner.storyProgress(null);
    },
    state:()=>({schema:"pokemon-suite/campaign-state/v1",status,reason,hallOfFame,completion,hasStarted,fieldTeamPlan,
      objective:planner.campaignStatus().activeObjective??null,task:planner.campaignStatus().activeTask??null,
      activityAccounting:'blocked-pauses-v1',supervisionAccountingRepair:accounting.repair,
      supervision:supervisor.state(),recovery:recovery.state(),menuRecovery:structuredClone(menuRecovery),reviewedMenuRetry,
      ...(Number.isFinite(lastRecoveryProbe)?{lastRecoveryProbe}:{}),...(helperGoal?{helperGoal:structuredClone(helperState)}:{}),player:player.state()}),
    pause(message="Paused by you."){if(status!=="complete"){supervisor.pause();status="paused";reason=message;}},
    resume({retryBlockedPolicy=false}={}){if(status!=="complete"){
      const safety=player.state();
      if(retryBlockedPolicy&&supervisor.state().stopReason==='no-meaningful-progress'&&
          !safety.transactionRecovery?.blocked&&!safety.encounterSafety?.blocked&&!safety.encounterSafety?.capture&&
          safety.workflow?.kind!=='in-game-trade')
        supervisor.retryReviewedStop({objective:planner.campaignStatus().activeObjective?.id??null});
      const saved=player.state();
      // Only an explicit user retry may reopen a stopped battle transaction.
      // Automatic field recovery keeps its existing budgets and safety gates.
      if(retryBlockedPolicy&&saved.transactionRecovery?.blocked?.reason==='repeated-menu-transaction'&&
          recovery.state().current?.status!=='needs-review'&&!saved.encounterSafety?.capture&&saved.workflow?.kind!=='in-game-trade'){
        player=openPlayer({...saved,workflow:null,transactionRecovery:null});
      }
      // A reviewed retry keeps the stop latch until observed menu recovery can
      // run. It consumes the existing attempt budget and never clears history.
      if(retryBlockedPolicy&&saved.transactionRecovery?.blocked?.reason==='repeated-menu-transaction'&&
          recovery.state().current?.status==='needs-review'&&!saved.encounterSafety?.capture&&saved.workflow?.kind!=='in-game-trade'){
        reviewedMenuRetry=true;
      }
      supervisor.resume();status=hallOfFame?"finishing":"running";reason=null;
    }},
    wait(message){supervisor.pause();status="blocked";reason=message;},
    observeExecution:update=>(activePlayer??player).observeExecution(update),
    acknowledgeCapture(fingerprint){
      const saved=player.state(),capture=saved.encounterSafety?.capture;
      if(!capture?.nativeSaveVerified||capture.fingerprint!==fingerprint)throw Error('Verify and save the capture before resuming the campaign.');
      player=openPlayer({...saved,encounterSafety:{...saved.encounterSafety,blocked:null,capture:null,unknownSince:null}});
    },
    decide(o){
      if(status==="paused"||status==="complete"||status==='blocked'&&reason!=='repeated-menu-transaction')return idle(reason??"Campaign is paused.");
      const decision=(()=>{
      const m=o.playerMemory??{};
      const campaign=planner.campaignStatus();
      const progress=supervisor.observe({observation:o,objective:campaign.activeObjective,
        task:campaign.activeTask,completedThroughObjectiveId:campaign.completedThroughObjectiveId});
      if(progress.idleMs>=Math.min(60000,progress.progressTimeoutMs)&&progress.elapsedMs-lastRecoveryProbe>=5000){
        lastRecoveryProbe=progress.elapsedMs;
        if(tryAlternative(o))return idle('Trying a different route or training target for the same task.');
      }
      if(progress.stopReason){
        if(recovery.state().current?.status==='verifying')recovery.finish('needs-review','The recovery did not produce verified task progress.',clock());
        this.wait(progress.stopReason);return {kind:'blocked',reason:progress.stopReason,
        action:{buttons:[],holdFrames:1,releaseFrames:0},supervision:progress};}
      o={...o,trainingActiveMs:progress.elapsedMs};
      if((m.trainer?.party??[]).some(p=>record.teamPlan.starterFamily.includes(p.species)))hasStarted=true;
      if(hallOfFame){
        if(o.phase==="stable"&&o.emulator.mode==="overworld"&&!o.emulator.inBattle&&!m.questLog?.playback&&
            m.storyState?.flagIds?.[2092]===true&&m.trainer?.partyValidity==="valid"&&matches(m.trainer.party)){
          status="complete";reason="The selected team entered the Hall of Fame, saved, and returned to playable postgame.";
          completion={nativeHallOfFame:hallOfFame,playablePostgame:true,frame:o.frame,sramSha256:o.sram?.sha256??null};
          return {kind:"campaign-complete",reason,action:{buttons:[],holdFrames:1,releaseFrames:0}};
        }
        const continuation=inspectNativeSaveContinuation(o);
        if(continuation?.kind==="blocked"){this.wait(continuation.reason);return continuation;}
        return continuation??{kind:"act",reason:"Finishing the Hall of Fame and credits.",action:{buttons:["a"],holdFrames:1,releaseFrames:59}};
      }
      if(hasStarted){
        const continuation=inspectNativeSaveContinuation(o);
        if(continuation?.kind==="blocked"){this.wait(continuation.reason);return continuation;}
        if(continuation)return continuation;
      }
      // extra-saves: a helper save stops once its goal individual is saved in a linked Center.
      activePlayer=null;
      if(helperGoal){
        const goal=inspectHelperGoal({observation:o,goal:helperGoal,state:helperState,world,mechanics});
        if(goal.kind==='reached'){status="complete";reason="The helper goal is saved in a Pokémon Center with a Direct Corner.";
          completion={helperGoal:goal.receipt,frame:o.frame,sramSha256:o.sram?.sha256??null};
          return {kind:"campaign-complete",reason,helperGoal:goal.receipt,action:{buttons:[],holdFrames:1,releaseFrames:0}};}
        if(goal.kind==='stop'){this.wait(goal.reason);return {kind:'blocked',reason:goal.reason,action:{buttons:[],holdFrames:1,releaseFrames:0}};}
        if(goal.kind==='wait')return idle('Waiting for the helper goal observation.');
        if(goal.kind==='policy'){helperObjective=goal.objective;helperPlayer??=openHelperPlayer();activePlayer=helperPlayer;
          const decision=helperPlayer.decide(o);if(decision.kind==='blocked')this.wait(decision.reason??'The helper goal needs review.');return decision;}
      }
      let decision=player.decide(o);
      if(menuRecovery?.phase==='verifying'&&decision.kind!=='blocked'&&recoveryFieldReady(o)){
        const proof=recoveryProgress(menuRecovery.baseline,o,planner.campaignStatus(),planner.state(),mechanics);
        if(proof&&menuRecovery.verifiedFrame!==null&&o.frame>menuRecovery.verifiedFrame){
          recovery.finish('recovered',`Verified ${proof} and a stable field handoff.`,clock());menuRecovery=null;
        }else if(proof)menuRecovery.verifiedFrame=o.frame;
        else menuRecovery.verifiedFrame=null;
      }
      if(decision.kind==='blocked'&&decision.reason==='repeated-menu-transaction'){
        decision=recoverMenu(o,decision);
        if(decision.kind!=='blocked'){if(status==='blocked')supervisor.resume();status='running';reason=null;}
      }
      const capture=player.state().encounterSafety?.capture;
      if(decision.kind==='blocked'&&decision.reason==='protected-capture-saved'&&capture?.nativeSaveVerified)return {kind:'capture-saved',capture};
      if(decision.kind==="complete"){
        if(!matches(m.trainer?.party??[])){this.wait("The Hall of Fame party differs from the committed six. Its save is preserved for review.");return {...idle(reason),kind:"blocked"};}
        hallOfFame={nativeSaveVerified:true,frame:o.frame,party:expected,sramSha256:o.sram?.sha256??null};
        status="finishing";reason="Hall of Fame saved. Finishing credits and returning to the game.";
        return idle(reason);
      }
      if(decision.kind==="blocked")this.wait(decision.reason??"Campaign needs review.");
      return decision;
      })();
      const {activeObjective:objective,activeTask:task}=planner.campaignStatus();
      supervisor.recordDecision({observation:o,decision,objective,task});
      return decision;
    },
  };
}
