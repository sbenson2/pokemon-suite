#!/usr/bin/env node

import { createHash, randomUUID } from "node:crypto";
import { readFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { createAutonomousEmulatorClient } from "../emulator/autonomous-emulator-client.js";
import { verifyKnowledgeArtifact } from "../evidence/knowledge-artifact.js";
import { digestSourceBundle } from "../extractor/artifact.js";
import { loadResearchBundle } from "../research.js";
import { createPolicyAdvisors } from "../player/advisors.js";
import { createCampaignPlanner, createRosterCampaign } from "../player/campaign.js";
import { validateTrainingExperiment, createTrainingExperimentCampaign, createBossAuditCatalog,
  HARD_MODE_ACQUISITIONS } from "../testing/training-experiment.js";
import { validateHuntConfig } from "../player/hunt-config.js";
import { createHuntPlanner } from "../player/hunt-planner.js";
import { createRngPredictionMonitor, landSlotsFromKnowledge } from "../rng/prediction-monitor.js";
import {
  readPlayerControlState,
  writePlayerCheckpoint,
} from "../player/checkpoint.js";
import { createMasterTeamPlan } from "../player/origins-team.js";
import { createRosterPlanForRun, rosterCheckpoint, resolveRosterRunSeed, validateRosterOptions, validateRosterResume } from "../player/roster-selection.js";
import { normalizeTeamSeed } from "../player/roster-generator.js";
import { createFireRedRosterContext } from "../player/fire-red-roster.js";
import { readFireRedRosterFacts } from "../player/fire-red-roster-facts.js";
import { createRunProfile } from "../player/run-profile.js";
import { createRunAttemptTimer } from "../player/run-timer.js";
import {
  createDecisionReportGate,
  runContinuousPlayer,
} from "../player/continuous-player.js";
import { createCentralPlayer } from "../player/delegator.js";
import { createRunDiagnosticRecorder } from "../player/diagnostics.js";
import { createCampaignEpisodeRecorder } from "../player/campaign-episode.js";
import { createSpectatorStatus } from "../presentation/player-status.js";

const projectRoot = fileURLToPath(new URL("../..", import.meta.url));
const STOCK_FIRERED_FPS = 59.7275;

const usage = `Usage:
  npm run run:player -- --rom PATH --core PATH [options]

Required private inputs:
  --rom PATH          Exact stock Pokemon FireRed Rev 1 cartridge
  --core PATH         Pinned mGBA core directory

Resume inputs (provide both or neither):
  --state PATH        Whole-emulator checkpoint
  --sram PATH         Matching native cartridge SRAM

Options:
  --experiment PATH  Isolated training/hard-mode research configuration; never qualification
  --runtime PATH      Runtime-symbol knowledge artifact
  --world PATH        World-structure knowledge artifact
  --story PATH        Story-state knowledge artifact
  --battle PATH       Battle-mechanics knowledge artifact
  --hunt-config PATH  Separate bounded hunting strategy (requires --state/--sram)
                      JSON defaults to observeOnly: true; never a qualification run
  --resume-protected-capture
                      Explicitly resume a reviewed shiny/target pause; identity must match
  --max-decisions N   Hard central-decision budget (default: 50000)
  --until-target      No elapsed-time or decision cap for a campaign;
                      native completion and error/stall watchdogs still stop it
  --live-port N       Loopback framebuffer/status port (default: 17339)
  --no-live           Disable the local Agent TV feed
  --view-only         Enable live video without exposing manual-control access
  --qualification-target brock|hall-of-fame
                      Fresh headless or view-only episode with durable audit trace
  --scenario-target party-restored
                      Isolated checkpoint diagnostic; never campaign qualification
  --continuation-target brock|hall-of-fame
                      Continue a checkpoint; never a fresh-start qualification
  --source-run-id ID  Required parent run identity for a continuation
  --video-fps N       Visible frames per second (default: 30; independent of game speed)
  --pace-ms N         Wall delay per decision; 0 is unpaced (default: 2)
  --emulation-speed N Autonomous cartridge speed (default: 5; range: 1-10)
  --diagnostic-snapshot-interval N
                      Save an exact replay bundle every N decisions (default: 5000)
  --diagnostic-stall-threshold N
                      Bundle a stable no-advice state after N repeats (default: 32)
  --output PATH       Content-addressed checkpoint directory
                      (default: private/player-runs)
  --run-id ID         Stable run label (default: generated UUID)
  --seed N            Reproducible 32-bit opening seed (default: run-id hash)
                      Balances gender/starter and uses cartridge preset names only
                      Also defaults the seeded permanent six-member team when explicit
  --roster-mode random|coherent|origins|fixed
                      New campaigns default to coherent, checked team variety
                      Origins is a themed final roster; fixed retains the prior preset
  --team-seed TOKEN   uint32 or hex: plus 64 hex digits (otherwise derived from run ID)
                      Resumes restore committed teams; neither option may reroll them
  --linger            Keep the completed Hall of Fame feed alive until stopped
  --help              Show this help

One central delegator reads immutable observations, rectifies advice-only policy
proposals, and maps bot commands. The emulator worker owns the real-time clock,
exclusive input gate, frame advancement, live stream, and Agent TV manual-control
handoff. Every run writes a bounded rolling decision journal with causal
manual-control records and exact replay bundles.
The challenge clock uses Trainer Card time: 30-hour primary, 24-hour stretch.
`;

class UsageError extends Error {}

function integer(name, value, { minimum = 0 } = {}) {
  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed) || parsed < minimum) {
    throw new UsageError(`${name} must be an integer >= ${minimum}`);
  }
  return parsed;
}

function finiteNumber(name, value, { minimum = 0, maximum = Number.POSITIVE_INFINITY } = {}) {
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed < minimum || parsed > maximum) {
    throw new UsageError(`${name} must be a number from ${minimum} to ${maximum}`);
  }
  return parsed;
}

function parseArguments(args) {
  const options = {};
  const values = new Set([
    "--rom", "--core", "--state", "--sram", "--runtime", "--world",
    "--story", "--battle", "--max-decisions", "--live-port", "--pace-ms", "--output",
    "--run-id", "--seed", "--emulation-speed",
    "--diagnostic-snapshot-interval", "--diagnostic-stall-threshold",
    "--qualification-target", "--hunt-config", "--scenario-target", "--video-fps",
    "--continuation-target", "--source-run-id", "--experiment", "--roster-mode", "--team-seed",
  ]);
  const flags = new Set(["--no-live", "--view-only", "--linger", "--resume-protected-capture", "--until-target"]);
  for (let index = 0; index < args.length; index += 1) {
    const argument = args[index];
    if (argument === "--help") return { help: true };
    if (flags.has(argument)) {
      options[argument.slice(2).replaceAll("-", "_")] = true;
      continue;
    }
    if (!values.has(argument)) throw new UsageError(`unknown argument ${argument}`);
    const value = args[index + 1];
    if (!value || value.startsWith("--")) throw new UsageError(`${argument} requires a value`);
    options[argument.slice(2).replaceAll("-", "_")] = value;
    index += 1;
  }
  if (!options.rom) throw new UsageError("--rom is required");
  if (!options.core) throw new UsageError("--core is required");
  if (options.team_seed !== undefined) options.team_seed = normalizeTeamSeed(/^hex:/i.test(options.team_seed)
    ? options.team_seed : integer("--team-seed", options.team_seed));
  validateRosterOptions({ rosterMode: options.roster_mode, teamSeed: options.team_seed });
  if (options.experiment && (options.roster_mode !== undefined || options.team_seed !== undefined)) {
    throw new UsageError("experiment roster is fixed by its configuration or parent checkpoint; roster overrides are not allowed");
  }
  if (options.experiment && (options.qualification_target || options.continuation_target || options.scenario_target || options.hunt_config || options.linger)) {
    throw new UsageError("experiment cannot share qualification, continuation, replay, hunting or linger modes");
  }
  if (options.experiment && !(options.no_live || options.view_only)) throw new UsageError("experiment requires view-only or headless mode");
  if (options.experiment && options.state && !/^[a-zA-Z0-9._-]{1,160}$/.test(options.source_run_id ?? "")) {
    throw new UsageError("checkpoint experiment requires a source-run-id");
  }
  if (options.experiment && options.source_run_id && !options.state) throw new UsageError("cold experiment cannot claim a source-run-id");
  if (options.continuation_target && (!options.state || !options.sram ||
      !/^[a-zA-Z0-9._-]{1,160}$/.test(options.source_run_id ?? "") ||
      options.hunt_config || options.qualification_target || options.scenario_target || options.linger ||
      !(options.no_live || options.view_only))) {
    throw new UsageError("continuation requires linked checkpoints, a source run ID, view-only or headless mode, and no hunting or qualification");
  }
  if (options.continuation_target && !["brock", "hall-of-fame"].includes(options.continuation_target)) throw new UsageError("invalid continuation target");
  if (options.source_run_id && !options.continuation_target && !options.experiment) throw new UsageError("source-run-id requires a continuation or experiment");
  if (options.scenario_target && (!options.state || !options.sram || options.hunt_config || options.qualification_target ||
      options.linger || !(options.no_live || options.view_only))) {
    throw new UsageError("replay requires explicit checkpoints, view-only or headless mode, and no hunting or qualification");
  }
  if (options.scenario_target && options.scenario_target !== "party-restored") throw new UsageError("invalid scenario target");
  if (options.resume_protected_capture && !options.hunt_config) throw new UsageError("--resume-protected-capture requires --hunt-config and a reviewed checkpoint");
  if (options.hunt_config && options.qualification_target) throw new UsageError("hunting cannot run as a qualification campaign");
  if (options.hunt_config && (!options.state || !options.sram)) throw new UsageError("hunting requires explicit --state and --sram inputs");
  if (Boolean(options.state) !== Boolean(options.sram)) {
    throw new UsageError("--state and --sram must be provided together");
  }
  if (options.qualification_target) {
    if (options.state || !(options.no_live || options.view_only) || options.linger) {
      throw new UsageError("qualification requires a fresh headless run or view-only feed (no resume or linger)");
    }
    if (!["brock", "hall-of-fame"].includes(options.qualification_target)) {
      throw new UsageError("invalid qualification target");
    }
  }
  if (options.until_target && !(options.qualification_target || options.continuation_target || options.experiment)) throw new UsageError("until-target requires a campaign target or experiment");
  if (options.until_target && options.max_decisions !== undefined) throw new UsageError("until-target conflicts with --max-decisions");
  options.max_decisions = options.until_target ? null : integer("--max-decisions", options.max_decisions ?? "50000", { minimum: 1 });
  options.live_port = integer("--live-port", options.live_port ?? "17339", { minimum: 1 });
  if (options.live_port > 65535) throw new UsageError("--live-port must be <= 65535");
  options.pace_ms = integer("--pace-ms", options.pace_ms ?? "2");
  options.diagnostic_snapshot_interval = integer(
    "--diagnostic-snapshot-interval",
    options.diagnostic_snapshot_interval ?? "5000",
    { minimum: 1 },
  );
  options.diagnostic_stall_threshold = integer(
    "--diagnostic-stall-threshold",
    options.diagnostic_stall_threshold ?? "32",
    { minimum: 1 },
  );
  options.emulation_speed = finiteNumber(
    "--emulation-speed",
    options.emulation_speed ?? "5",
    { minimum: 1, maximum: 10 },
  );
  options.video_fps = finiteNumber("--video-fps", options.video_fps ?? "30", { minimum: 1, maximum: 60 });
  options.output ??= join(projectRoot, "private", "player-runs");
  options.run_id ??= `central-player-${randomUUID()}`;
  if (!/^[a-zA-Z0-9._-]{1,160}$/.test(options.run_id)) {
    throw new UsageError("--run-id may contain only letters, digits, dot, underscore, and dash");
  }
  options.seed_explicit = options.seed !== undefined;
  options.seed = options.seed === undefined
    ? createHash("sha256").update(options.run_id).digest().readUInt32LE(0)
    : integer("--seed", options.seed);
  if (options.seed > 0xffff_ffff) {
    throw new UsageError("--seed must be <= 4294967295");
  }
  return options;
}

function artifactPath(bundle, datasetId) {
  const dataset = bundle.knowledge.datasets.find(({ id }) => id === datasetId);
  if (!dataset?.runtimeEligible || !dataset.artifact?.sha256) {
    throw new Error(`${datasetId} is not runtime eligible`);
  }
  return join(projectRoot, "private", "knowledge", `${dataset.id}.${dataset.artifact.sha256}.json`);
}

function sha256(bytes) {
  return createHash("sha256").update(bytes).digest("hex");
}

function sleep(milliseconds) {
  return milliseconds > 0
    ? new Promise((resolve) => setTimeout(resolve, milliseconds))
    : Promise.resolve();
}

function compactStatus(
  update,
  runId,
  complete = false,
  runProfile = null,
  teamPlan = null,
  campaignPlanner = null,
  playerState = null,
  diagnostics = null,
  mechanics = null,
  attempt = null,
) {
  const observation = update?.observation;
  const decision = update?.decision;
  const itemCollection = campaignPlanner?.collectionProgress?.(observation) ?? null;
  return {
    schema: "master-red/player-status/v1",
    runId,
    running: !complete,
    complete,
    performance: update?.performance ?? null,
    attempt,
    runProfile: runProfile
      ? {
          seed: runProfile.seed,
          gender: runProfile.gender,
          playerName: runProfile.playerName,
          rivalName: runProfile.rivalName,
          starter: runProfile.starter.name,
          nicknamePolicy: runProfile.nicknamePolicy,
        }
      : null,
    teamPlan: teamPlan
      ? {
          schema: teamPlan.schema,
          seed: teamPlan.seed,
          rosterSelection: rosterCheckpoint(teamPlan).teamSelection,
          hallOfFameSpecies: teamPlan.hallOfFameSpecies,
          acquisitions: teamPlan.acquisitions.map(({ id, label, targetSpecies }) => ({
            id,
            label,
            targetSpecies,
          })),
        }
      : null,
    decisions: update?.decisions ?? 0,
    atomicCaptureRaces: update?.atomicCaptureRaces ?? 0,
    frame: observation?.frame ?? null,
    phase: observation?.phase ?? null,
    mode: observation?.emulator?.mode ?? null,
    callback2: observation?.emulator?.callback2 ?? null,
    map: observation?.playerMemory?.map?.id ?? null,
    position: observation?.playerMemory?.position ?? null,
    usablePartyCount: observation?.playerMemory?.trainer?.usablePartyCount ?? null,
    pokedexOwnedCount:
      observation?.playerMemory?.trainer?.pokedex?.ownedCount ?? null,
    pokedexSeenCount:
      observation?.playerMemory?.trainer?.pokedex?.seenCount ?? null,
    itemCollection,
    spectator: createSpectatorStatus({
      observation,
      runProfile,
      mechanics,
      collectionProgress: itemCollection,
      decision,
      campaignStatus: campaignPlanner?.campaignStatus?.() ?? null,
    }),
    winner: decision?.winner
      ? {
          advisor: decision.winner.advisor,
          recommendation: decision.winner.recommendation,
          confidence: decision.winner.confidence,
          constraints: decision.winner.constraints,
          evidenceRefs: decision.winner.evidenceRefs,
        }
      : null,
    decision: decision
      ? {
          sequence: decision.sequence,
          kind: decision.kind,
          reason: decision.reason,
        }
      : null,
    action: decision?.action
      ? { kind: decision.action.kind, reason: decision.action.reason }
      : null,
    rejectedAdvice: decision?.rejected?.length ?? 0,
    workflow: playerState?.workflow ?? null,
    encounterSafety: playerState?.encounterSafety ?? null,
    rngPrediction: update?.rngPrediction ?? null,
    strategy: playerState?.huntConfig ? { kind: "hunt", config: playerState.huntConfig } : { kind: "campaign" },
    diagnostics: diagnostics
      ? {
          sessionId: diagnostics.sessionId,
          journalPath: diagnostics.journalPath,
          handoffPath: diagnostics.runHandoffPath ?? diagnostics.handoffPath,
          latestBundlePath: diagnostics.latestBundlePath,
          latestAnomaly: diagnostics.latestAnomaly,
          recordedDecisions: diagnostics.recordedDecisions,
          snapshots: diagnostics.snapshots,
        }
      : null,
    updatedAt: new Date().toISOString(),
  };
}

async function main() {
  const options = parseArguments(process.argv.slice(2));
  if (options.help) {
    process.stdout.write(usage);
    return;
  }
  const huntConfig = options.hunt_config ? validateHuntConfig(JSON.parse(await readFile(resolve(options.hunt_config), "utf8"))) : null;
  const experimentConfig = options.experiment ? validateTrainingExperiment(JSON.parse(await readFile(resolve(options.experiment), "utf8"))) : null;
  if (experimentConfig?.mode === "underlevel" && options.state) throw new UsageError("underlevel campaign must start fresh; checkpoint tests are efficiency experiments");
  if (experimentConfig?.mode === "efficiency" && !options.state) throw new UsageError("efficiency experiment requires a matched checkpoint");
  if (huntConfig?.rngMode === "guided" && !huntConfig.observeOnly) {
    throw new UsageError("RNG-guided unattended hunting is not cartridge-qualified; use isolated RNG experiments first");
  }
  const bundle = await loadResearchBundle(new URL("../../research/", import.meta.url));
  const playerSourceBundle = await digestSourceBundle(projectRoot, [
    "research/architecture.json",
    "src/cli/run-player.js",
    "src/emulator/autonomous-emulator-client.js",
    "src/emulator/autonomous-emulator-worker-runtime.js",
    "src/emulator/autonomous-emulator-worker.js",
    "src/emulator/autonomous-emulator.js",
    "src/evidence/fire-red-observer.js",
    "src/foundation.js",
    "src/player/advisors.js",
    "src/player/capture-balls.js",
    "src/player/campaign.js",
    "src/player/checkpoint.js",
    "src/player/continuous-player.js",
    "src/player/delegator.js",
    "src/player/diagnostics.js",
    "src/player/origins-team.js",
    "src/player/recovery.js",
    "src/player/run-timer.js",
  ], { followLocalImports: true });
  const cartridge = bundle.cartridges.profiles.find(
    ({ id }) => id === bundle.cartridges.qualificationProfileId,
  );
  const mgba = bundle.sources.sources.find(({ id }) => id === "mgba-core");
  const wrapper = bundle.sources.sources.find(({ id }) => id === "mgba-wasm-wrapper");
  const paths = {
    runtime: resolve(options.runtime ?? artifactPath(bundle, "firered-runtime-symbols")),
    world: resolve(options.world ?? artifactPath(bundle, "firered-world-structure")),
    story: resolve(options.story ?? artifactPath(bundle, "firered-story-state")),
    battle: resolve(options.battle ?? artifactPath(bundle, "firered-battle-mechanics")),
  };
  const [runtimeBytes, worldBytes, storyBytes, battleBytes, stateBytes, sramBytes] = await Promise.all([
    readFile(paths.runtime),
    readFile(paths.world),
    readFile(paths.story),
    readFile(paths.battle),
    options.state ? readFile(resolve(options.state)) : null,
    options.sram ? readFile(resolve(options.sram)) : null,
  ]);
  for (const [datasetId, bytes] of [
    ["firered-runtime-symbols", runtimeBytes],
    ["firered-world-structure", worldBytes],
    ["firered-story-state", storyBytes],
    ["firered-battle-mechanics", battleBytes],
  ]) {
    verifyKnowledgeArtifact({ bundle, datasetId, bytes });
  }
  const resumePlayerState = options.state
    ? await readPlayerControlState({
        statePath: resolve(options.state),
        stateSha256: sha256(stateBytes),
        sramSha256: sha256(sramBytes),
        expectedRunId: options.continuation_target || experimentConfig ? options.source_run_id : null,
      })
    : null;
  if (options.state && !resumePlayerState) throw new UsageError("checkpoint requires verified player control state to preserve its roster identity");
  if (resumePlayerState?.huntConfig && !huntConfig) throw new UsageError("a hunting checkpoint requires its explicit --hunt-config");
  if (resumePlayerState?.experimentConfig && JSON.stringify(resumePlayerState.experimentConfig) !== JSON.stringify(experimentConfig)) {
    throw new UsageError("experimental checkpoint cannot resume under a different policy or ordinary campaign");
  }
  if (resumePlayerState?.huntConfig && JSON.stringify(resumePlayerState.huntConfig) !== JSON.stringify(huntConfig)) {
    throw new UsageError("hunting checkpoint configuration differs; review the checkpoint before switching strategy");
  }
  const runAttempt = createRunAttemptTimer({
    restoredState: resumePlayerState?.runAttempt ?? null,
  });

  let session;
  let diagnostics;
  let qualification;
  let qualificationInitialCheckpoint;
  let finalResult = null;
  let stopping = false;
  let status = {
    schema: "master-red/player-status/v1",
    runId: options.run_id,
    running: false,
    complete: false,
    attempt: runAttempt.snapshot(),
    decisions: 0,
    mode: "starting",
  };
  const stop = () => { stopping = true; };
  process.once("SIGINT", stop);
  process.once("SIGTERM", stop);
  try {
    const world = JSON.parse(worldBytes.toString("utf8"));
    const story = JSON.parse(storyBytes.toString("utf8"));
    const mechanics = JSON.parse(battleBytes.toString("utf8"));
    const rngMonitor = huntConfig?.rngMode === "predict" ? createRngPredictionMonitor({
      slots: landSlotsFromKnowledge(world, mechanics, huntConfig.area), map: huntConfig.area }) : null;
    // A strategy experiment gets its own diagnostic label, not a different
    // permanent party identity. Preserve the campaign checkpoint's seed.
    const runProfile = createRunProfile(resolveRosterRunSeed({ seed: options.seed,
      seedExplicit: options.seed_explicit && !(huntConfig || experimentConfig || options.scenario_target || options.continuation_target),
      resumePlayerState }));
    let teamPlan;
    if (experimentConfig?.mode === "underlevel") {
      teamPlan = createMasterTeamPlan(runProfile.starter.species, runProfile.seed, { acquisitionIds: HARD_MODE_ACQUISITIONS });
    } else {
      const rosterOptions = { rosterMode: options.roster_mode, teamSeed: options.team_seed ??
        (resumePlayerState === null && !options.seed_explicit
          ? `hex:${createHash("sha256").update(`roster:${options.run_id}`).digest("hex")}` : undefined) };
      const selection = validateRosterResume(runProfile.starter.species, runProfile.seed, resumePlayerState, rosterOptions);
      if (["coherent-generated-v2", "random-families-v1"].includes(selection.version)) {
        const facts = readFireRedRosterFacts({ romBytes: await readFile(resolve(options.rom)), cartridge,
          runtime: JSON.parse(runtimeBytes.toString("utf8")), mechanics });
        rosterOptions.rosterContext = createFireRedRosterContext({ world, story, mechanics, facts });
      }
      teamPlan = createRosterPlanForRun(runProfile.starter.species, runProfile.seed, resumePlayerState, rosterOptions);
    }
    const normalPlanner = createCampaignPlanner({
      teamPlan,
      ...(experimentConfig ? { campaign: createTrainingExperimentCampaign({ campaign: createRosterCampaign(teamPlan), config: experimentConfig }) } : {}),
      world,
      story,
      mechanics,
      initialState: huntConfig ? null : resumePlayerState?.campaignPlanner ?? null,
    });
    const campaignPlanner = huntConfig ? createHuntPlanner({ world, story, mechanics, config: huntConfig,
      initialState: resumePlayerState?.huntConfig ? resumePlayerState.campaignPlanner : null,
      storyWatch: normalPlanner.storyWatch() }) : normalPlanner;
    session = await createAutonomousEmulatorClient({
      coreDirectory: resolve(options.core),
      expected: {
        mgbaCommit: mgba.revision.value,
        wrapperCommit: wrapper.revision.value,
        mgbaWasmSha256: mgba.artifact.wasmSha256,
      },
      cartridge,
      paths: {
        rom: resolve(options.rom),
        runtime: paths.runtime,
        world: paths.world,
        story: paths.story,
        state: options.state ? resolve(options.state) : null,
        sram: options.sram ? resolve(options.sram) : null,
      },
      storyWatch: campaignPlanner.storyWatch(),
      runId: options.run_id,
      emulationSpeed: options.emulation_speed,
      presentationFramesPerSecond: STOCK_FIRERED_FPS,
      videoFramesPerSecond: options.video_fps,
      livePort: options.no_live ? null : options.live_port,
      viewOnly: options.view_only === true,
      observeRng: huntConfig?.rngMode !== undefined && huntConfig.rngMode !== "off",
      startPaused: huntConfig?.observeOnly === true,
      initialStatus: status,
      bootFrames: 600,
    });
    const player = createCentralPlayer({
      initialState: huntConfig && !resumePlayerState?.huntConfig && resumePlayerState
        ? { ...resumePlayerState, workflow: null, transactionRecovery: null, movementRecovery: null,
            encounterSafety: null } : resumePlayerState,
      campaignPlanner,
      huntConfig,
      resumeProtectedCapture: options.resume_protected_capture === true,
      mechanics,
      advisors: createPolicyAdvisors({
        mechanics,
        world,
        campaignPlanner,
        runProfile,
        teamPlan: huntConfig ? null : teamPlan,
      }),
    });
    const checkpointPlayerState = () => ({
      ...player.state(),
      ...(huntConfig ? { huntConfig } : {}),
      ...(experimentConfig ? { experimentConfig } : {}),
      runAttempt: runAttempt.state(),
      ...(qualification?.state() ? {campaignSupervision:qualification.state()} : {}),
      ...rosterCheckpoint(teamPlan),
    });
    if (options.qualification_target || options.scenario_target || options.continuation_target || experimentConfig) {
      qualification = await createCampaignEpisodeRecorder({
        initialState: resumePlayerState?.campaignSupervision??null,
        outputDirectory: resolve(options.output), target: experimentConfig
          ? experimentConfig.mode === "underlevel" ? "underlevel-hall-of-fame" : "training-window"
          : options.qualification_target ?? options.scenario_target ?? options.continuation_target,
        kind: experimentConfig ? "experiment" : options.scenario_target ? "replay" : options.continuation_target ? "continuation" : "campaign",
        ...(experimentConfig ? { experimentConfig, bossCatalog: createBossAuditCatalog(mechanics) } : {}),
        ...(options.until_target ? { maxGameSeconds: null } : {}),
        metadata: { runId: options.run_id, runProfile, teamSelection: rosterCheckpoint(teamPlan).teamSelection, resumed: Boolean(options.state),
          sourceRunId: options.source_run_id ?? null, untilTarget: options.until_target === true,
          inputStateSha256: stateBytes ? sha256(stateBytes) : null, inputSramSha256: sramBytes ? sha256(sramBytes) : null,
          sourceBundle: playerSourceBundle, cartridge: session.identity,
          liveView: { enabled: !options.no_live, viewOnly: options.view_only === true, port: options.no_live ? null : options.live_port } },
      });
      qualificationInitialCheckpoint = await writePlayerCheckpoint({ session, outputDirectory: resolve(options.output),
        runId: `${options.run_id}.initial`, status, playerState: checkpointPlayerState() });
    }
    diagnostics = await createRunDiagnosticRecorder({
      outputDirectory: resolve(options.output),
      runId: options.run_id,
      session,
      snapshotIntervalDecisions: options.diagnostic_snapshot_interval,
      stallThresholdDecisions: options.diagnostic_stall_threshold,
      metadata: {
        architecture: {
          document: "docs/PLAYER-ARCHITECTURE.md",
          machineReadableDocument: "research/architecture.json",
          sourceBundle: playerSourceBundle,
        },
        cartridge: session.identity,
        knowledgeArtifacts: Object.fromEntries(
          Object.entries(paths).map(([id, path]) => [id, {
            path,
            sha256: sha256({ runtime: runtimeBytes, world: worldBytes,
              story: storyBytes, battle: battleBytes }[id]),
          }]),
        ),
        runProfile,
        teamPlan,
        strategy: experimentConfig ?? huntConfig ?? { kind: "campaign" },
        launch: {
          resumed: Boolean(stateBytes),
          sourceRunId: options.source_run_id ?? null, untilTarget: options.until_target === true,
          inputStateSha256: stateBytes ? sha256(stateBytes) : null,
          inputSramSha256: sramBytes ? sha256(sramBytes) : null,
          restoredPlayerControlState: Boolean(resumePlayerState),
          maxDecisions: options.max_decisions,
          paceMs: options.pace_ms,
          clockOwner: "autonomous-emulator-worker",
          presentationFramesPerSecond: STOCK_FIRERED_FPS,
          videoFramesPerSecond: options.video_fps,
          emulationSpeed: options.emulation_speed,
        },
      },
    });
    status = {
      ...status,
      running: true,
      mode: "ready",
      diagnostics: diagnostics.status(),
      attempt: runAttempt.snapshot(),
    };
    await session.setStatus(status);
    process.stdout.write(`${JSON.stringify({
      event: "player-ready",
      runId: options.run_id,
      liveView: session.liveView,
      cartridge: session.identity,
      resumed: Boolean(stateBytes),
      runProfile,
      hallOfFameSpecies: teamPlan.hallOfFameSpecies,
      itemCollection: campaignPlanner.collectionProgress(),
      diagnostics: diagnostics.status(),
      attempt: runAttempt.snapshot(),
    })}\n`);
    const shouldWriteDecision = createDecisionReportGate();
    const result = await runContinuousPlayer({
      emulator: session,
      player,
      maxDecisions: options.max_decisions,
      shouldStop: () => stopping || Boolean(qualification?.status()?.stopReason),
      yieldEvery: 8,
      async onUpdate(update) {
        if (rngMonitor) update = { ...update, rngPrediction: rngMonitor.observe(update.observation) };
        if (qualification) {
          const campaign=campaignPlanner.campaignStatus();
          await qualification.record({...update,objective:campaign.activeObjective,task:campaign.activeTask,
            completedThroughObjectiveId:campaign.completedThroughObjectiveId});
        }
        const complete = update.decision.kind === "complete";
        const attempt = runAttempt.snapshot({
          playTime: update.observation?.playerMemory?.trainer?.playTime,
          complete,
        });
        const playerState = checkpointPlayerState();
        await diagnostics.recordUpdate(update, { playerState });
        status = compactStatus(
          update,
          options.run_id,
          complete,
          runProfile,
          teamPlan,
          campaignPlanner,
          playerState,
          diagnostics.status(),
          mechanics,
          attempt,
        );
        await session.setStatus(status);
        if (shouldWriteDecision(update)) {
          process.stdout.write(`${JSON.stringify({ event: "decision", ...status })}\n`);
        }
        await sleep(options.pace_ms);
      },
    });
    finalResult = result.kind;
    const complete = result.kind === "complete";
    const attempt = runAttempt.snapshot({
      playTime: result.observation?.playerMemory?.trainer?.playTime,
      complete,
    });
    const playerState = checkpointPlayerState();
    status = compactStatus(
      result,
      options.run_id,
      complete,
      runProfile,
      teamPlan,
      campaignPlanner,
      playerState,
      diagnostics.status(),
      mechanics,
      attempt,
    );
    status = { ...status, running: options.linger && result.kind === "complete" };
    await session.setStatus(status);
    const saved = await writePlayerCheckpoint({
      session,
      outputDirectory: resolve(options.output),
      runId: options.run_id,
      status,
      playerState,
    });
    await diagnostics.close({
      result: result.kind,
      checkpoint: {
        statePath: saved.statePath,
        stateSha256: saved.stateSha256,
        sramPath: saved.sramPath,
        sramSha256: saved.sramSha256,
        metadataPath: saved.metadataPath,
      },
    });
    if (qualification) {
      await qualification.close({ result: result.kind, checkpoint: saved, initialCheckpoint: qualificationInitialCheckpoint });
      if (!qualification.status().targetReached) process.exitCode = 2;
    }
    status = { ...status, diagnostics: diagnostics.status() };
    await session.setStatus(status);
    process.stdout.write(`${JSON.stringify({
      event: "player-finished",
      result: result.kind,
      decisions: result.decisions,
      checkpoint: saved,
      liveView: session.liveView,
      lingering: Boolean(options.linger && result.kind === "complete"),
    })}\n`);
    if (result.kind !== "complete" && result.kind !== "stopped") process.exitCode = 2;
    if (options.linger && result.kind === "complete" && !stopping) {
      await new Promise((resolve) => {
        process.once("SIGINT", resolve);
        process.once("SIGTERM", resolve);
      });
    }
  } finally {
    if (qualification) await qualification.close({ result: finalResult ?? "aborted" }).catch(() => {});
    if (diagnostics) {
      await diagnostics.close({ result: finalResult ?? "aborted" }).catch(() => {});
    }
    if (session) await session.close().catch(() => {});
  }
}

try {
  await main();
} catch (error) {
  process.stderr.write(`${error.stack ?? error.message}\n`);
  process.exitCode = 1;
}
