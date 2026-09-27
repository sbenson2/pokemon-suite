import {replayFameChecker} from './replay-fame-checker.mjs';
import {replayPostgameRecords} from './replay-postgame-records.mjs';
import {replayTowerAdmission} from './replay-tower-admission.mjs';
import {replayLeagueRecord} from './replay-league-record.mjs';
import {replayUnownHandoff} from './replay-unown-handoff.mjs';
import {replayLeagueFinish} from './replay-league-finish.mjs';
import {replayLeagueOwnership} from './replay-league-ownership.mjs';
import {replayVictoryRoadFunding} from './replay-victory-road-funding.mjs';
import {replayTowerDefeat} from './replay-tower-defeat.mjs';
import {replayPostgameCombatPreparation} from './replay-postgame-combat-preparation.mjs';
import {replayPostgameTowerBalancedRoster} from './replay-postgame-tower-balanced-roster.mjs';
import {replaySnorlaxHandoff} from './replay-snorlax-handoff.mjs';
import {replayPostgameTravel} from './replay-postgame-travel.mjs';
import {replayEvolutionLearning} from './replay-evolution-learning.mjs';
import {replayEvolutionAcceleration} from './replay-evolution-acceleration.mjs';
import {replayLeagueMenuSettle} from './replay-league-menu-settle.mjs';
import {replayChecklistAgenda} from './replay-checklist-agenda.mjs';
import {replayPriorityStaticTarget} from './replay-priority-static-target.mjs';
import {replayNewSaveBotStart} from './replay-new-save-bot-start.mjs';
import {replayGoalNewGameName} from './replay-goal-new-game-name.mjs';
import {replayGoalPostgameHandoff} from './replay-goal-postgame-handoff.mjs';
import {replayPostgameSupplyReplan} from './replay-postgame-supply-replan.mjs';
import {replayTeamTradeEvolution} from './replay-team-trade-evolution.mjs';
import {replayReleasedHuntResume} from './replay-released-hunt-resume.mjs';
import {replayNationalEmberHunt} from './replay-national-ember-hunt.mjs';
import {replayDunsparceTunnelRng} from './replay-dunsparce-tunnel-rng.mjs';
import {replayHeldItemPartner} from './replay-held-item-partner.mjs';
import {replayFireRedPartner} from './replay-firered-partner.mjs';
import {replayQmmSetupBattle,replayQmmDuplicate,replayQmmRenewable,replayQmmPrerequisites} from './replay-qmm-supply.mjs';
import {replayIncomeChain} from './replay-income-chain.mjs';
import {replayMaintenanceRecovery} from './replay-maintenance-recovery.mjs';
import {replayPostgameShoppingResume} from './replay-postgame-shopping-resume.mjs';
import {replayBoundaryRecovery} from './replay-boundary-recovery.mjs';
import {replayHuntRejection} from './replay-hunt-rejection.mjs';
import {replayFundingRecovery} from './replay-funding-recovery.mjs';
import {replayRoamerCapture} from './replay-roamer-capture.mjs';
import {replayMoltresRoute} from './replay-moltres-route.mjs';
import {replayStaticTiming} from './replay-static-timing.mjs';
import {replaySeafoamCurrent} from './replay-seafoam-current.mjs';
import {replayPostgameSupplies} from './replay-postgame-supplies.mjs';
import {replayDojoGift} from './replay-dojo-gift.mjs';
import {replayDojoGiftHiddenPower} from './replay-dojo-gift-hidden-power.mjs';
import {replayPostgameSapphire} from './replay-postgame-sapphire.mjs';
import {replayIslandFly} from './replay-island-fly.mjs';
import {replayPostgameIcefall} from './replay-postgame-icefall.mjs';
import {replayPostgameSafariSave} from './replay-postgame-safari-save.mjs';
import {replayPostgameSelection} from './replay-postgame-selection.mjs';
import {replayAutomaticPartner} from './replay-automatic-partner.mjs';
import {replayNativeAcquisition} from './replay-native-acquisition.mjs';
import {replayEggWaitProgress} from './replay-egg-wait-progress.mjs';
import {replayRecoveryStorage} from './replay-recovery-storage.mjs';
import {replayPostgameWorker} from './replay-postgame-worker.mjs';
import {replayPostgameEvolution} from './replay-postgame-evolution.mjs';
import {replayPostgameHandoff} from './replay-postgame-handoff.mjs';
import {replayTrainerPortrait} from './replay-trainer-portrait.mjs';
import {replayTransform} from './replay-transform.mjs';
import {replayCampaignStrategy} from './replay-campaign-strategy.mjs';
import {replayMovingRematch} from './replay-moving-rematch.mjs';
import {replayFieldDialogue} from './replay-field-dialogue.mjs';
import {replayMenuNavigation} from './replay-menu-navigation.mjs';
import {replayLeagueTactics} from './replay-league-tactics.mjs';
import {replayLeagueChampionTactics} from './replay-league-champion-tactics.mjs';
import {replayLeagueExpShare} from './replay-league-exp-share.mjs';
import {replayLeagueExpShareRestore} from './replay-league-exp-share-restore.mjs';
import {replayLeagueExpShareStrike} from './replay-league-exp-share-strike.mjs';
import {replayLeagueTraining} from './replay-league-training.mjs';
import {replayRareCandyMoveLearn} from './replay-rare-candy-move-learn.mjs';
import {replaySafariDexCapture} from './replay-safari-dex-capture.mjs';
import {replayVictoryBoulder} from './replay-victory-boulder.mjs';
import {replayCampaignInterruptions} from './replay-campaign-interruptions.mjs';
import {replayCyclingRoute} from './replay-cycling-route.mjs';
import {replayVsSeekerCycle} from './replay-vs-seeker-cycle.mjs';
import {replayCampaignTeaching} from './replay-campaign-teaching.mjs';
import {replayCompletionPreview} from './replay-completion-preview.mjs';
import {replayVictoryRoadReturn} from './replay-victory-road-return.mjs';
import {replayDirectTraining} from './replay-direct-training.mjs';
import {replayEffortTraining} from './replay-effort-training.mjs';
import {replayRechargeApproach} from './replay-recharge-approach.mjs';
import {replayMoveUnderstanding} from './replay-move-understanding.mjs';
import {verifyNativeHeldReference,replayNativeHeldEquipment} from './replay-held-reference.mjs';
import {replaySeagallopReturn} from './replay-seagallop-return.mjs';
import {replayStoryCheckpoints,replayStoryRetry} from './replay-story-checkpoints.mjs';
import {replayBalancedProgression,replayTrainingBatch} from './replay-balanced-progression.mjs';
// Private saves stay outside the export. Each case runs in its own emulator;
// only ordinary controller inputs are applied, never cartridge memory writes.
import assert from 'node:assert/strict';
import {readFileSync, writeFileSync} from 'node:fs';
import {fork} from 'node:child_process';
import {createInterface} from 'node:readline';
import {fileURLToPath} from 'node:url';
import {dirname, resolve} from 'node:path';
import {SaveVault, digest} from '../engine/firered/src/suite/save-vault.js';
import {createPinnedMgbaSession} from '../engine/firered/src/emulator/pinned-mgba.js';
import {createFireRedObserver} from '../engine/firered/src/evidence/fire-red-observer.js';
import {readPostgameEvidence, POSTGAME_WATCH} from '../engine/firered/src/suite/postgame-agenda.js';
import {createSuiteMission} from '../engine/firered/src/suite/mission.js';
import {LINK_QUEST_WATCH, resolveFireRedTravel} from '../engine/firered/src/suite/fire-red-link-quest.js';
import {createCampaignPlanner} from '../engine/firered/src/player/campaign.js';
import {createPolicyAdvisors} from '../engine/firered/src/player/advisors.js';
import {createCentralPlayer} from '../engine/firered/src/player/delegator.js';
import {replanAfterRecovery} from '../engine/firered/src/suite/recovery.js';
import {verifiedReplayInputs} from './replay-rom-inputs.mjs';
import {replayCampaignSearch,replayCampaignHomeHealing} from './replay-campaign-search.mjs';
import {replayMajorBattle} from './replay-major-battle.mjs';
import {replayBattleTape} from './replay-battle-tape.mjs';
import {replayHmPolicy} from './replay-hm-policy.mjs';
import {replayCampaignRoster,replayCampaignBlockedClock} from './replay-campaign-roster.mjs';

const json = p => JSON.parse(readFileSync(p, 'utf8'));
const corpusPath = resolve(process.argv[2]), corpus = json(corpusPath);
const romReceipt = json(resolve(process.argv[3]));
const option = name => {
  const index = process.argv.indexOf(name);
  return index === -1 ? null : process.argv[index + 1] ?? null;
};
const only = (option('--only') ?? '').split(',').map(id => id.trim()).filter(Boolean);
const evidenceOut = option('--evidence-out');
const reusePath = option('--reuse');
const orderPath = option('--order');
const lanes = Math.max(1, Number.parseInt(option('--lanes') ?? '1', 10) || 1);
const worker = process.argv.includes('--worker');
// These cases are paced by the wall clock: real-time wireless exchanges between
// two live games, and planner supervision with a one-second worker timeout.
// With lanes they run after the parallel phase, with no other replay competing.
const EXCLUSIVE = new Set(['postgame-automatic-partner', 'postgame-team-trade-evolution', 'postgame-held-item-partner','postgame-firered-partner','postgame-firered-partner-stall','postgame-firered-partner-restart', 'postgame-recovery-storage', 'campaign-transform']);
assert.equal(corpus.schema, 'pokemon-suite/native-regressions/v1');
assert.ok(Array.isArray(corpus.cases) && corpus.cases.length > 0);
assert.equal(new Set(corpus.cases.map(c => c.id)).size, corpus.cases.length);
const fixtures = only.length
  ? corpus.cases.filter(c => only.includes(c.id))
  : corpus.cases;
if (only.length) assert.deepEqual(fixtures.map(c => c.id).sort(), [...only].sort(), 'every --only id must exist in the corpus');
const prior = reusePath ? json(reusePath) : null;
const priorCases = new Map((prior?.cases ?? []).map(entry => [entry.id, entry]));
const evidence = [];
const free = o => o.phase === 'stable' && o.emulator.mode === 'overworld' &&
  !o.emulator.inBattle && !Object.values(o.playerMemory.ui).some(Boolean);
/** Runs one case in this process; returns its evidence or throws. */
async function runFixture(fixture) {
  assert.ok(['postgame-fame-checker','postgame-records','postgame-tower-admission','postgame-league-record','postgame-unown-handoff','postgame-tower-balanced-roster','postgame-league-finish','postgame-league-ownership','postgame-victory-road-funding','postgame-tower-defeat','postgame-combat-preparation','postgame-snorlax-handoff','postgame-travel','postgame-evolution-learning','postgame-evolution-acceleration','postgame-league-menu-settle','postgame-checklist-agenda','postgame-priority-static-target','manual-new-save-bot-start','goal-new-game-trainer-name','goal-supervisor-postgame-handoff','postgame-supply-replan','postgame-team-trade-evolution','postgame-released-hunt-resume','postgame-national-ember-hunt','postgame-dunsparce-tunnel-rng','postgame-held-item-partner','postgame-firered-partner','postgame-firered-partner-stall','postgame-firered-partner-restart','postgame-qmm-setup-battle','postgame-qmm-duplicate','postgame-qmm-renewable','postgame-qmm-prerequisites','postgame-income-chain','postgame-maintenance-recovery','postgame-shopping-resume','postgame-boundary-recovery','postgame-hunt-rejection','postgame-funding-recovery','roamer-capture-handoff','moltres-ascent','static-legendary-timing','seafoam-current','postgame-supplies','postgame-field-medicine','dojo-gift-timing','dojo-gift-hidden-power','postgame-sapphire','island-fly-region','postgame-icefall','postgame-safari-save','postgame-objective-selection','postgame-automatic-partner','postgame-native-acquisition','postgame-egg-wait-progress','postgame-recovery-storage','postgame-worker-resume','postgame-evolution-route','campaign-postgame-handoff','postgame-pc-held-reference','postgame-pc-exit', 'postgame-pc-save', 'postgame-native-save', 'roamer-supplies', 'campaign-safari-search', 'campaign-home-healing', 'campaign-major-battle','battle-tape-equivalence','campaign-hm-policy','campaign-roster-acquisition','campaign-blocked-clock','campaign-balanced-progression','campaign-training-batch','campaign-story-checkpoints','campaign-story-retry','campaign-seagallop-return','campaign-move-understanding','campaign-recharge-approach','campaign-direct-training','competitive-ev-training','campaign-victory-road-return','campaign-completion-preview','campaign-teaching','campaign-cycling-route','campaign-vs-seeker-cycle','campaign-victory-boulder','campaign-menu-interruptions','campaign-navigation-interruptions','campaign-battle-interruptions','campaign-league-tactics','postgame-league-champion-tactics','postgame-league-exp-share','postgame-league-exp-share-restore','postgame-league-exp-share-strike','postgame-league-training','campaign-menu-route-recovery','campaign-field-dialogue','campaign-moving-rematch','campaign-transform','campaign-strategy-recovery','trainer-portrait','postgame-rare-candy-move-learn','postgame-rare-candy-move-learn-resume','postgame-safari-dex-capture','postgame-safari-dex-entry'].includes(fixture.target));
  const path = name => resolve(dirname(corpusPath), name);
  const {cfg, cartridge, romBytes,partnerCfg,partnerRomBytes} = verifiedReplayInputs(corpusPath, fixture, romReceipt);
  const checkpointPath = path(fixture.checkpoint), record = json(checkpointPath);
  const saved = new SaveVault(dirname(checkpointPath), record.identity).read(record);
  const core = fixture.nativeRadio ? cfg.nativeRadio.core : cfg.core;
  const manifest = json(core+'/build-manifest.json');
  // A reused pass must bind to the same ROM, core build and checkpoint bytes;
  // verify-bot only offers reuse when the reviewed source is byte-identical.
  const reusable = priorCases.get(fixture.id);
  if (reusable?.pass === true &&
      reusable.evidence?.romSha1 === cartridge.sha1 &&
      reusable.evidence?.coreSha256 === manifest.mgba_wasm_sha256 &&
      reusable.evidence?.seedStateSha256 === record.stateSha256) {
    return {reused: true, evidence: reusable.evidence};
  }
  const inputs = Object.fromEntries(['runtime', 'world', 'story', 'battle'].map(k => [k, json(cfg.inputs[k])]));
  const createSession = () => createPinnedMgbaSession({coreDirectory: core,
    romBytes, cartridge, expected: {
      mgbaCommit: manifest.mgba_commit, wrapperCommit: manifest.wrapper_commit,
      mgbaWasmSha256: manifest.mgba_wasm_sha256}});
  const session = await createSession();
  try {
    session.loadSram(saved.sram); session.loadState(saved.state);
    if(['postgame-fame-checker','postgame-records','postgame-tower-admission','postgame-league-record','postgame-unown-handoff','postgame-tower-balanced-roster','postgame-league-finish','postgame-league-ownership','postgame-victory-road-funding','postgame-tower-defeat','postgame-combat-preparation','postgame-snorlax-handoff','postgame-travel','postgame-evolution-learning','postgame-evolution-acceleration','postgame-league-menu-settle','postgame-checklist-agenda','postgame-priority-static-target','manual-new-save-bot-start','goal-new-game-trainer-name','goal-supervisor-postgame-handoff','postgame-supply-replan','postgame-team-trade-evolution','postgame-released-hunt-resume','postgame-national-ember-hunt','postgame-dunsparce-tunnel-rng','postgame-held-item-partner','postgame-firered-partner','postgame-firered-partner-stall','postgame-firered-partner-restart','postgame-qmm-setup-battle','postgame-qmm-duplicate','postgame-qmm-renewable','postgame-qmm-prerequisites','postgame-income-chain','postgame-maintenance-recovery','postgame-shopping-resume','postgame-boundary-recovery','postgame-hunt-rejection','postgame-funding-recovery','roamer-capture-handoff','moltres-ascent','static-legendary-timing','seafoam-current','postgame-supplies','postgame-field-medicine','dojo-gift-timing','dojo-gift-hidden-power','postgame-sapphire','island-fly-region','postgame-icefall','postgame-safari-save','postgame-objective-selection','postgame-automatic-partner','postgame-native-acquisition','postgame-egg-wait-progress','postgame-recovery-storage','postgame-worker-resume','postgame-evolution-route','campaign-postgame-handoff','campaign-safari-search','campaign-home-healing','campaign-major-battle','battle-tape-equivalence','campaign-hm-policy','campaign-roster-acquisition','campaign-blocked-clock','campaign-balanced-progression','campaign-training-batch','campaign-story-checkpoints','campaign-story-retry','campaign-seagallop-return','campaign-move-understanding','campaign-recharge-approach','campaign-direct-training','competitive-ev-training','campaign-victory-road-return','campaign-completion-preview','campaign-teaching','campaign-cycling-route','campaign-vs-seeker-cycle','campaign-victory-boulder','campaign-menu-interruptions','campaign-navigation-interruptions','campaign-battle-interruptions','campaign-league-tactics','postgame-league-champion-tactics','postgame-league-exp-share','postgame-league-exp-share-restore','postgame-league-exp-share-strike','postgame-league-training','campaign-menu-route-recovery','campaign-field-dialogue','campaign-moving-rematch','campaign-transform','campaign-strategy-recovery','trainer-portrait','postgame-rare-candy-move-learn','postgame-rare-candy-move-learn-resume','postgame-safari-dex-capture','postgame-safari-dex-entry'].includes(fixture.target)) {
      const replay={'postgame-fame-checker':replayFameChecker,'postgame-records':replayPostgameRecords,'postgame-tower-admission':replayTowerAdmission,'postgame-league-record':replayLeagueRecord,'postgame-unown-handoff':replayUnownHandoff,'postgame-league-finish':replayLeagueFinish,'postgame-league-ownership':replayLeagueOwnership,'postgame-victory-road-funding':replayVictoryRoadFunding,'postgame-tower-defeat':replayTowerDefeat,'postgame-combat-preparation':replayPostgameCombatPreparation,'postgame-tower-balanced-roster':replayPostgameTowerBalancedRoster,'postgame-snorlax-handoff':replaySnorlaxHandoff,'postgame-travel':replayPostgameTravel,'postgame-evolution-learning':replayEvolutionLearning,'postgame-evolution-acceleration':replayEvolutionAcceleration,'postgame-league-menu-settle':replayLeagueMenuSettle,'postgame-checklist-agenda':replayChecklistAgenda,'postgame-priority-static-target':replayPriorityStaticTarget,'manual-new-save-bot-start':replayNewSaveBotStart,'goal-new-game-trainer-name':replayGoalNewGameName,'goal-supervisor-postgame-handoff':replayGoalPostgameHandoff,'postgame-supply-replan':replayPostgameSupplyReplan,'postgame-team-trade-evolution':replayTeamTradeEvolution,'postgame-released-hunt-resume':replayReleasedHuntResume,'postgame-national-ember-hunt':replayNationalEmberHunt,'postgame-dunsparce-tunnel-rng':replayDunsparceTunnelRng,'postgame-held-item-partner':replayHeldItemPartner,'postgame-firered-partner':replayFireRedPartner,'postgame-firered-partner-stall':replayFireRedPartner,'postgame-firered-partner-restart':replayFireRedPartner,'postgame-qmm-setup-battle':replayQmmSetupBattle,'postgame-qmm-duplicate':replayQmmDuplicate,'postgame-qmm-renewable':replayQmmRenewable,'postgame-qmm-prerequisites':replayQmmPrerequisites,'postgame-income-chain':replayIncomeChain,'postgame-maintenance-recovery':replayMaintenanceRecovery,'postgame-shopping-resume':replayPostgameShoppingResume,'postgame-boundary-recovery':replayBoundaryRecovery,'postgame-hunt-rejection':replayHuntRejection,'postgame-funding-recovery':replayFundingRecovery,'roamer-capture-handoff':replayRoamerCapture,'moltres-ascent':replayMoltresRoute,'static-legendary-timing':replayStaticTiming,'seafoam-current':replaySeafoamCurrent,'postgame-supplies':replayPostgameSupplies,'postgame-field-medicine':replayPostgameSupplies,'dojo-gift-timing':replayDojoGift,'dojo-gift-hidden-power':replayDojoGiftHiddenPower,'postgame-sapphire':replayPostgameSapphire,'island-fly-region':replayIslandFly,'postgame-icefall':replayPostgameIcefall,'postgame-safari-save':replayPostgameSafariSave,'postgame-objective-selection':replayPostgameSelection,'postgame-automatic-partner':replayAutomaticPartner,'postgame-native-acquisition':replayNativeAcquisition,'postgame-egg-wait-progress':replayEggWaitProgress,'postgame-recovery-storage':replayRecoveryStorage,'postgame-worker-resume':replayPostgameWorker,'postgame-evolution-route':replayPostgameEvolution,'campaign-postgame-handoff':replayPostgameHandoff,'trainer-portrait':replayTrainerPortrait,'campaign-safari-search':replayCampaignSearch,'campaign-home-healing':replayCampaignHomeHealing,
        'campaign-major-battle':replayMajorBattle,'battle-tape-equivalence':replayBattleTape,'campaign-hm-policy':replayHmPolicy,'campaign-roster-acquisition':replayCampaignRoster,'campaign-blocked-clock':replayCampaignBlockedClock,'campaign-balanced-progression':replayBalancedProgression,'campaign-training-batch':replayTrainingBatch,'campaign-story-checkpoints':replayStoryCheckpoints,'campaign-story-retry':replayStoryRetry,'campaign-seagallop-return':replaySeagallopReturn,'campaign-move-understanding':replayMoveUnderstanding,'campaign-recharge-approach':replayRechargeApproach,'campaign-direct-training':replayDirectTraining,'competitive-ev-training':replayEffortTraining,'campaign-victory-road-return':replayVictoryRoadReturn,'campaign-completion-preview':replayCompletionPreview,'campaign-teaching':replayCampaignTeaching,'campaign-cycling-route':replayCyclingRoute,'campaign-vs-seeker-cycle':replayVsSeekerCycle,'campaign-victory-boulder':replayVictoryBoulder,'campaign-menu-interruptions':replayCampaignInterruptions,'campaign-navigation-interruptions':replayCampaignInterruptions,'campaign-battle-interruptions':replayCampaignInterruptions,'campaign-league-tactics':replayLeagueTactics,'postgame-league-champion-tactics':replayLeagueChampionTactics,'postgame-league-exp-share':replayLeagueExpShare,'postgame-league-exp-share-restore':replayLeagueExpShareRestore,'postgame-league-exp-share-strike':replayLeagueExpShareStrike,'postgame-league-training':replayLeagueTraining,'postgame-rare-candy-move-learn':replayRareCandyMoveLearn,'postgame-rare-candy-move-learn-resume':replayRareCandyMoveLearn,'postgame-safari-dex-capture':replaySafariDexCapture,'postgame-safari-dex-entry':replaySafariDexCapture,'campaign-menu-route-recovery':replayMenuNavigation,'campaign-field-dialogue':replayFieldDialogue,'campaign-moving-rematch':replayMovingRematch,'campaign-transform':replayTransform,'campaign-strategy-recovery':replayCampaignStrategy}[fixture.target];
      const {before,after}=await replay({session,saved,inputs,createSession,cfg,partnerCfg,partnerRomBytes,fixture,corpusPath});
      assert.equal(digest(readFileSync(resolve(dirname(checkpointPath), record.sramPath))), record.sramSha256);
      return {reused: false, evidence: {id:fixture.id,seedStateSha256:record.stateSha256,
        romSha1:cartridge.sha1,coreSha256:manifest.mgba_wasm_sha256,startFrame:before.frame,endFrame:after.frame,sramSha256:after.sram.sha256}};
    }
    const state = saved.metadata.session;
    let mission = createSuiteMission({id: state.id, request: state.request,
      state: state.mission, ...inputs, mechanics: inputs.battle});
    const basePlanner = createCampaignPlanner({...inputs, mechanics: inputs.battle});
    const observer = createFireRedObserver({session, ...inputs, runId: fixture.id, observeRng: true,
      storyWatch: {flags: [...basePlanner.storyWatch().flags, ...POSTGAME_WATCH.flags, ...LINK_QUEST_WATCH.flags, ...mission.storyWatch().flags],
        variables: [...POSTGAME_WATCH.variables, ...LINK_QUEST_WATCH.variables]}});
    const capture = () => {
      const o = observer.capture();
      return {...o, playerMemory: {...o.playerMemory,
        postgameEvidence: readPostgameEvidence(session, inputs.runtime, o)}};
    };
    const before = capture();let controller = mission.preparationController(before);
    const heldReference=fixture.target==='postgame-pc-held-reference';
    const heldIdentity=heldReference?verifyNativeHeldReference({inputs,romBytes,observation:before}):null;
    const capturePolicy=mission.capturePolicy();
    const supplies = fixture.target === 'roamer-supplies';
    if (!supplies) assert.ok(controller, 'the checkpoint must contain an active preparation task');
    const party = before.playerMemory.trainer.party;
    if (fixture.target.startsWith('postgame-pc-')) assert.ok(before.playerMemory.ui.storage, 'start inside the PC');
    else if (!supplies) assert.ok(controller.state().preparation?.nationalDexSave?.linkSave, 'start with the milestone save pending');
    const balls = o => (o.playerMemory.trainer.bag.pokeBalls??[]).filter(b=>b.itemId===2).reduce((n,b)=>n+b.quantity,0);
    let objective, restarted = false, supplied = false;
    const planner = {...basePlanner, select:()=>objective, selectCollection:()=>null,
      selectTraining:()=>null, selectBattleSquad:()=>[], campaignStatus:()=>({objective:objective?.id}),
      state:()=>({mission:mission.state.id,objective})};
    const playerFor = initialState => createCentralPlayer({campaignPlanner:planner,
      advisors:createPolicyAdvisors({world:inputs.world,mechanics:inputs.battle,campaignPlanner:planner}),
      initialState,mechanics:inputs.battle,huntConfig:mission.capturePolicy(),captureRequirements:mission.captureRequirements()});
    const qualification = {interventions:[]};
    const resumed = supplies ? replanAfterRecovery(state.player,{explicitRetry:true,mission:mission.state,
      qualification,runtimeLock:saved.metadata.runtimeLock,plannerLock:null,observation:before}) : null;
    let player = supplies ? playerFor(resumed) : null;
    if (supplies) {
      assert.equal(state.player.transactionRecovery.blocked.reason, 'repeated-menu-transaction');
      assert.equal(qualification.interventions.length, 1, 'restarting the stopped hunt records an explicit policy retry');
    }
    if (supplies) assert.ok(balls(before)<10, 'start below the capture supply reserve');
    let after = before, reached = false;
    for (let n = 0; n < 3000; n++) {
      after = capture();
      if ((fixture.target === 'postgame-pc-exit'||heldReference) && free(after)) {
        assert.equal(after.sram.sha256, before.sram.sha256, 'leaving the PC must not write a native save');
        assert.deepEqual(after.playerMemory.trainer.party, party, 'PC exit preserves every party member');
        if(heldReference){
          assert.ok(restarted,'the PC transaction survived controller reconstruction');
          assert.deepEqual(verifyNativeHeldReference({inputs,romBytes,observation:after}),heldIdentity);
          after=replayNativeHeldEquipment({session,inputs,capture,basePlanner});
          assert.deepEqual(verifyNativeHeldReference({inputs,romBytes,observation:after}),heldIdentity);
          assert.deepEqual(mission.capturePolicy(),capturePolicy,'retained hunt requirements survive the handoff');
        }
        reached = true; break;
      }
      if (fixture.target === 'postgame-pc-save' && free(after) && after.playerMemory.gameStats.savedGame > before.playerMemory.gameStats.savedGame) {
        assert.equal(after.playerMemory.gameStats.savedGame, before.playerMemory.gameStats.savedGame+1);
        assert.equal(after.playerMemory.saveAttemptStatus, 1);
        assert.notEqual(after.sram.sha256, before.sram.sha256);
        assert.notEqual(after.playerMemory.map.id, before.playerMemory.map.id, 'the exhausted field heap was refreshed by ordinary map loading');
        assert.deepEqual(after.playerMemory.trainer.party, party, 'the recovery and native save preserve the party');
        reached = true; break;
      }
      let decision;
      if (supplies) {
        const next = mission.inspect(after);
        assert.equal(next.kind, 'policy', next.reason);
        if (after.playerMemory.postgameEvidence)
          assert.equal(after.playerMemory.postgameEvidence.roamer.species, 0, 'supply work must not release Suicune');
        if (!supplied && free(after) && balls(after)>=30) {
          assert.equal(balls(after), 30, 'finish the planned reserve without repeated purchases');
          assert.equal(after.playerMemory.trainer.money, before.playerMemory.trainer.money-(30-balls(before))*1200);
          assert.equal(after.playerMemory.map.id, 'MAP_FUCHSIA_CITY_MART');
          assert.equal(after.playerMemory.postgameEvidence.roamer.species, 0);
          assert.equal(next.objective.id, 'release-suicune', 'hand off only after leaving the purchase dialogue');
          assert.deepEqual(after.playerMemory.trainer.party, party);
          assert.equal(after.sram.sha256, before.sram.sha256, 'buying supplies must not replace the native save');
          assert.ok(restarted, 'the active Fly transaction must survive a mission/player restart');
          supplied = true;
        }
        objective = resolveFireRedTravel(next.objective, after, inputs.world);
        decision = player.decide(after);
        if (mission.beforeInteraction(after, decision)) {
          assert.ok(supplied, 'finish supplies before starting the release anchor');
          assert.equal(after.playerMemory.map.id, 'MAP_ONE_ISLAND_POKEMON_CENTER_1F');
          assert.equal(decision.winner.recommendation.objective, 'release-suicune');
          assert.equal(mission.state.phase, 'saving-anchor');
          assert.equal(after.playerMemory.postgameEvidence.roamer.species, 0);
          reached = true; break;
        }
        if (!restarted && after.playerMemory.ui.party) {
          mission.checkpoint();
          mission = createSuiteMission({id:state.id,request:state.request,state:mission.state,...inputs,mechanics:inputs.battle});
          player = playerFor(player.state()); restarted = true;
        }
      } else {
        if(heldReference&&!restarted&&after.playerMemory.ui.storage){
          mission.checkpoint();
          mission=createSuiteMission({id:state.id,request:state.request,state:JSON.parse(JSON.stringify(mission.state)),...inputs,mechanics:inputs.battle});
          controller=mission.preparationController(after);assert.ok(controller);restarted=true;
        }
        decision = controller.decide(after);
      }
      if (fixture.target === 'postgame-native-save') {
        const receipt = controller.state().preparation?.nationalDexSave?.nativeLinkSave;
        if (receipt?.nativeSaveVerified && free(after)) {
          assert.equal(after.playerMemory.gameStats.savedGame, before.playerMemory.gameStats.savedGame+1);
          assert.equal(receipt.savedSramSha256, after.sram.sha256);
          assert.notEqual(after.sram.sha256, before.sram.sha256);
          reached = true; break;
        }
      }
      assert.ok(!['blocked', 'complete'].includes(decision.kind), decision.reason);
      const action = decision.action ?? {buttons: [], holdFrames: 8, releaseFrames: 0};
      for (let n = 0; n < (action.holdFrames ?? 1); n++) session.step(action.buttons ?? []);
      for (let n = 0; n < (action.releaseFrames ?? 0); n++) session.step([]);
    }
    assert.ok(reached, 'the native transaction did not finish within the replay budget');
    assert.equal(digest(readFileSync(resolve(dirname(checkpointPath), record.sramPath))), record.sramSha256);
    return {reused: false, evidence: {id: fixture.id, seedStateSha256: record.stateSha256,
      romSha1: cartridge.sha1, coreSha256: manifest.mgba_wasm_sha256,
      startFrame: before.frame, endFrame: after.frame, sramSha256: after.sram.sha256}};
  } finally { session.close(); }
}

const writeEvidence = () => {
  if (evidenceOut && !worker) writeFileSync(evidenceOut, JSON.stringify({schema: 'pokemon-suite/case-evidence/v1', cases: evidence}, null, 2)+'\n');
};
let passed = 0;
const recordPass = (fixture, result, ms) => {
  passed += 1;
  console.log(`ok ${passed} - ${fixture.id}`);
  if (result.reused) {
    console.log('# reused '+JSON.stringify({id: fixture.id, evidence: result.evidence}));
    console.log('# timing '+JSON.stringify({id: fixture.id, ms: 0, reused: true}));
  } else {
    console.log('# evidence '+JSON.stringify(result.evidence));
    console.log('# timing '+JSON.stringify({id: fixture.id, ms}));
  }
  evidence.push({id: fixture.id, pass: true, reused: result.reused, evidence: result.evidence});
};
const recordFailure = (fixture, error) => {
  evidence.push({id: fixture.id, pass: false, error: String(error?.message ?? error)});
  writeEvidence();
};

// Fail-fast order: named cases first, then cases without a recorded duration
// (usually new), then the longest first so parallel lanes finish together.
// Without an order file the corpus order is kept.
const ordered = list => {
  if (!orderPath) return list;
  const {first = [], durations = {}} = json(resolve(orderPath));
  const rank = c => first.includes(c.id) ? [0, first.indexOf(c.id)] : durations[c.id] == null ? [1, 0] : [2, -durations[c.id]];
  return [...list].sort((a, b) => { const x = rank(a), y = rank(b); return x[0] - y[0] || x[1] - y[1]; });
};

async function runSerial(list) {
  for (const fixture of list) {
    const startedAt = Date.now();
    let result;
    try { result = await runFixture(fixture); }
    catch (error) { recordFailure(fixture, error); throw error; }
    recordPass(fixture, result, Date.now() - startedAt);
  }
}

// Each lane is a worker process running one case at a time, exactly as the
// serial runner does. After a failure no new case starts; cases already
// running finish so their own cleanup (spawned owners, temporary saves) runs.
async function runLanes(list, count) {
  const pending = [...list];
  let failure = null;
  const lane = () => new Promise(done => {
    const child = fork(fileURLToPath(import.meta.url), [...process.argv.slice(2), '--worker'], {stdio: ['ignore', 'pipe', 'pipe', 'ipc']});
    // Worker output stays a TAP comment; only this process reports results.
    for (const stream of [child.stdout, child.stderr]) {
      createInterface({input: stream}).on('line', line => console.log(line.startsWith('#') ? line : '# ' + line));
    }
    let current = null;
    const next = () => {
      current = failure ? null : pending.shift() ?? null;
      if (current) child.send({id: current.id}); else child.disconnect();
    };
    child.on('message', message => {
      if (message.pass) recordPass(current, message, message.ms);
      else {
        failure ??= new Error(`${current.id}: ${message.error}`);
        recordFailure(current, message.error);
        console.log(`# failed ${current.id}; waiting for running lanes to finish`);
      }
      next();
    });
    // A lane ends once the worker has exited and both output streams have
    // drained; 'close' also waits on the disconnected IPC channel.
    let waiting = 3, ended = '';
    const finish = () => {
      if (--waiting) return;
      if (current) {
        failure ??= new Error(`The replay worker exited during ${current.id} (${ended}).`);
        recordFailure(current, new Error(`The replay worker exited (${ended}).`));
      }
      done();
    };
    child.stdout.on('end', finish);
    child.stderr.on('end', finish);
    child.on('exit', (code, signal) => { ended = String(signal ?? code); finish(); });
    next();
  });
  await Promise.all(Array.from({length: Math.min(count, list.length)}, lane));
  if (failure) { writeEvidence(); throw failure; }
}

if (worker) {
  process.on('message', async ({id}) => {
    const startedAt = Date.now();
    try { process.send({id, pass: true, ...(await runFixture(fixtures.find(c => c.id === id))), ms: Date.now() - startedAt}); }
    catch (error) { process.send({id, pass: false, error: String(error?.stack ?? error?.message ?? error)}); }
  });
  process.on('disconnect', () => process.exit(0));
} else {
  const queue = ordered(fixtures);
  if (lanes === 1) await runSerial(queue);
  else {
    await runLanes(queue.filter(c => !EXCLUSIVE.has(c.id)), lanes);
    await runSerial(queue.filter(c => EXCLUSIVE.has(c.id)));
  }
  writeEvidence();
  console.log(`# tests ${passed}\n# pass ${passed}\n# skipped 0`);
}
