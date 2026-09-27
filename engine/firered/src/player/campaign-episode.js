import { createHash } from "node:crypto";
import { mkdir, open, rename, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { gzipSync } from "node:zlib";
import { isProgressObservation } from "./progress-observation.js";
import { createCampaignSupervisor, DEFAULT_CAMPAIGN_PROGRESS_TIMEOUT_MS } from "./campaign-supervisor.js";
import { createFireRedReplayMonitor } from "../testing/firered-replay.js";
import { createTrainingExperimentMonitor } from "../testing/training-experiment.js";

// Read-only campaign instrumentation. Deadlines are test budgets, not game policy.
export async function createCampaignEpisodeRecorder({ outputDirectory, metadata = {}, maxTraceBytes = 1024 ** 3, ...options }) {
  if (!Number.isSafeInteger(maxTraceBytes) || maxTraceBytes <= 0) throw new TypeError("invalid audit size budget");
  const replay = options.kind === "replay";
  const continuation = options.kind === "continuation";
  const experiment = options.kind === "experiment";
  const monitor = experiment ? createTrainingExperimentMonitor({ config: options.experimentConfig,
    bossCatalog: options.bossCatalog, baseMonitor: createCampaignEpisodeMonitor({ ...options, target: "hall-of-fame", maxGameSeconds: null }) })
    : replay ? createFireRedReplayMonitor(options) : createCampaignEpisodeMonitor(options);
  await mkdir(dirname(outputDirectory), { recursive: true, mode: 0o700 });
  // Exclusive ownership: an existing or interrupted episode is never silently restarted.
  await mkdir(outputDirectory, { mode: 0o700 });
  const tracePath = join(outputDirectory, "audit.jsonl.gz");
  const file = await open(tracePath, "wx", 0o600);
  const digest = createHash("sha256");
  let bytes = 0;
  let events = 0;
  let report = { schema: "master-red/campaign-episode/v1", metadata, reviewRequired: true,
    evidenceKind: experiment ? "training-experiment" : replay ? "checkpoint-diagnostic" : continuation ? "continued-campaign" : "cold-campaign",
    qualificationEligible: !experiment && !replay && !continuation,
    target: options.target, targetReached: false, stopReason: null, running: true, milestones: {} };
  let lastPublished = 0;
  let closed = false;
  const publish = async () => {
    await writeFile(join(outputDirectory, "episode.json.tmp"), `${JSON.stringify(report, null, 2)}\n`, { mode: 0o600 });
    await rename(join(outputDirectory, "episode.json.tmp"), join(outputDirectory, "episode.json"));
    lastPublished = Date.now();
  };
  await publish();
  return {
    status: () => structuredClone(report),
    state: () => monitor.state?.() ?? null,
    async record(update) {
      if (closed) throw new Error("episode recorder is closed");
      if (report.stopReason === "audit-size-limit") return;
      const status = monitor.observe(update);
      const observation = update.observation;
      const memory = observation?.playerMemory ?? {};
      const record = { decision: update.decision, controlHandoff: update.controlHandoff ?? null,
        observation: { captureId: observation.captureId, frame: observation.frame, phase: observation.phase,
          emulator: { mode: observation.emulator?.mode }, sram: observation.sram,
          playerMemory: { sha256: memory.sha256, map: memory.map, position: memory.position,
            battle: memory.battle, battleTypeFlags: memory.battleTypeFlags, battleOutcome: memory.battleOutcome,
            encounter: memory.encounter,
            trainer: { party: memory.trainer?.party, playTime: memory.trainer?.playTime,
              ...(experiment ? { money: memory.trainer?.money, bag: memory.trainer?.bag } : {}) },
            storyState: memory.storyState } } };
      const chunk = gzipSync(`${JSON.stringify(record)}\n`, { level: 1 });
      if (bytes + chunk.length > maxTraceBytes) {
        report = { ...report, ...status, stopReason: "audit-size-limit", targetReached: false };
        await publish();
        return;
      }
      await file.writeFile(chunk);
      digest.update(chunk);
      bytes += chunk.length;
      events += 1;
      report = { ...report, ...status, performance: update.performance ?? null, trace: { path: tracePath, bytes, events } };
      if (Date.now() - lastPublished >= 5000 || report.stopReason) await publish();
    },
    async close({ result, checkpoint = null, initialCheckpoint = null } = {}) {
      if (closed) return;
      closed = true;
      await file.sync();
      await file.close();
      report = { ...report, running: false, result, checkpoint, initialCheckpoint,
        targetReached: report.targetReached && Boolean(checkpoint) && ["stopped", "complete"].includes(result),
        trace: { path: tracePath, bytes, events, sha256: digest.digest("hex") } };
      await publish();
    },
  };
}

export function createCampaignEpisodeMonitor({
  target,
  clock = Date.now,
  progressTimeoutMs = DEFAULT_CAMPAIGN_PROGRESS_TIMEOUT_MS,
  maxGameSeconds = target === "brock" ? 8 * 3600 : 40 * 3600,
  initialState = null,
} = {}) {
  if (!["brock", "hall-of-fame"].includes(target)) throw new TypeError("invalid campaign target");
  for (const limit of [progressTimeoutMs, ...(maxGameSeconds === null ? [] : [maxGameSeconds])]) {
    if (!Number.isFinite(limit) || limit <= 0) throw new TypeError("campaign budgets must be positive");
  }
  const startedAt = clock();
  const supervisor=createCampaignSupervisor({clock,progressTimeoutMs,initialState:initialState?.supervision??null});
  const milestones = structuredClone(initialState?.milestones??{});
  let stopReason = initialState?.stopReason??null;
  let failure = initialState?.failure??null;
  let latest = null;
  let confirmedMemory = initialState?.confirmedMemory??{};
  function observe(update) {
    const now = clock();
    const observation = update.observation;
    const progressValid = isProgressObservation(observation);
    if (progressValid) confirmedMemory = observation.playerMemory;
    const memory = confirmedMemory;
    const flags = memory.storyState?.flagIds ?? {};
    const party = memory.trainer?.party ?? [];
    const playTime = memory.trainer?.playTime;
    const gameSeconds = playTime
      ? (playTime.hours ?? 0) * 3600 + (playTime.minutes ?? 0) * 60 + (playTime.seconds ?? 0)
      : null;
    const proof = {
      sequence: update.decision?.sequence ?? update.decisions,
      frame: observation?.frame,
      captureId: observation?.captureId ?? null,
      playerMemorySha256: memory.sha256 ?? null,
      sramSha256: observation?.sram?.sha256 ?? null,
      gameSeconds,
      wallSeconds: (now - startedAt) / 1000,
    };
    const supervision=supervisor.observe(update);
    if (!stopReason) {
      if (progressValid && flags[2089]) milestones.oakParcel ??= { ...proof };
      if (progressValid && flags[2080]) milestones.brock ??= { ...proof };
      if (progressValid && update.decision?.kind === "complete" && update.decision.reason === "native-hall-of-fame") {
        milestones.hallOfFame ??= { ...proof };
      }
      if (update.decision?.kind === "blocked") stopReason = "safety-stop";
      else if (target === "brock" ? milestones.brock : milestones.hallOfFame) stopReason = "target-reached";
      else if (maxGameSeconds !== null && gameSeconds !== null && gameSeconds >= maxGameSeconds) stopReason = "game-time-limit";
      else if (supervision.stopReason) stopReason = supervision.stopReason;
    }
    if (update.controlHandoff) stopReason = "manual-assistance";
    if (stopReason && stopReason !== "target-reached") {
      failure ??= { reason: stopReason === "safety-stop" ? update.decision?.reason ?? stopReason : stopReason, ...proof };
    }
    latest = {
      target, stopReason, targetReached: stopReason === "target-reached", progressValid,
      failure: structuredClone(failure),
      milestones: structuredClone(milestones), ...proof,
      lastProgressAt: supervision.lastProgressAt??new Date(startedAt).toISOString(),
      updatedAt: new Date(now).toISOString(),
      map: memory.map?.id ?? null,
      party: party.map(({ species, level, experience: xp }) => ({ species, level, experience: xp })),
      badgeCount: Array.from({ length: 8 }, (_, index) => flags[2080 + index]).filter(Boolean).length,
    };
    return structuredClone(latest);
  }
  return { observe, status: () => structuredClone(latest),
    state:()=>({schema:'master-red/campaign-episode-monitor/v1',supervision:supervisor.state(),milestones:structuredClone(milestones),stopReason,failure,
      confirmedMemory:structuredClone({sha256:confirmedMemory.sha256,storyState:confirmedMemory.storyState,trainer:confirmedMemory.trainer})}) };
}
