import { createHash, randomUUID } from "node:crypto";
import { chmod, mkdir, open, readFile, rename, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { gzipSync } from "node:zlib";
import { writePlayerCheckpoint } from "./checkpoint.js";
import { createBoundedJournal, DEFAULT_JOURNAL_RETENTION } from "./bounded-journal.js";

const RECOVERY_CONTEXT_DECISIONS = 16;

function safeToken(value, name) {
  const token = String(value ?? "")
    .replaceAll(/[^a-zA-Z0-9._-]+/g, "-")
    .replaceAll(/^-+|-+$/g, "");
  if (!token) throw new TypeError(`${name} must contain a safe identifier`);
  return token;
}

function timestamp(clock) {
  const value = clock();
  if (typeof value === "string") return value;
  return new Date(value).toISOString();
}

function sha256(bytes) {
  return createHash("sha256").update(bytes).digest("hex");
}

function stableStateSignature(observation) {
  const memory = observation?.playerMemory ?? {};
  const party = (memory.trainer?.party ?? []).map((pokemon) => ({
    slot: pokemon.slot,
    species: pokemon.species,
    level: pokemon.level,
    hp: pokemon.hp,
    maxHp: pokemon.maxHp,
    status: pokemon.status,
    heldItem: pokemon.heldItem,
    moves: pokemon.moves,
    pp: pokemon.pp,
  }));
  const state = {
    phase: observation?.phase,
    mode: observation?.emulator?.mode,
    callback2: observation?.emulator?.callback2,
    map: memory.map?.id,
    position: memory.position,
    battleTypeFlags: memory.battleTypeFlags,
    battle: memory.battle,
    ui: memory.ui,
    party,
    scripts: memory.scripts,
    activeTasks: (memory.activeTasks ?? []).map(({ function: name }) => name),
  };
  return sha256(Buffer.from(JSON.stringify(state)));
}

function decisionJournalObservation(observation) {
  const memory = observation?.playerMemory;
  const mapGrid = memory?.mapGrid;
  if (!mapGrid || typeof mapGrid !== "object") return observation ?? null;
  return {
    ...observation,
    playerMemory: {
      ...memory,
      mapGrid: {
        omittedFromDecisionJournal: true,
        width: mapGrid.width ?? null,
        height: mapGrid.height ?? null,
        derivedFromPlayerMemorySha256: memory.sha256 ?? null,
      },
    },
  };
}

function controllerFramePlan(action = {}) {
  return {
    kind: action.kind ?? "neutral",
    buttons: action.buttons ?? [],
    holdFrames: action.holdFrames ?? 0,
    releaseFrames: action.releaseFrames ?? 0,
    ...(action.movementLease
      ? { movementLease: action.movementLease }
      : {}),
  };
}

function decisionCycleKey(update) {
  const decision = update?.decision ?? {};
  return sha256(Buffer.from(JSON.stringify({
    state: stableStateSignature(update?.observation),
    recommendation: decision.winner?.recommendation ?? null,
    controllerFramePlan: controllerFramePlan(decision.action),
  })));
}

function recoveryDecisionContext(update) {
  const action = update?.decision?.action ?? {};
  return {
    decisions: update?.decisions ?? null,
    observation: decisionJournalObservation(update?.observation),
    decision: update?.decision ?? null,
    controllerFramePlan: controllerFramePlan(action),
  };
}

function repeatedCycle(keys, { minimumPeriod = 2, maximumPeriod = 8, repeats = 4 } = {}) {
  for (let period = minimumPeriod; period <= maximumPeriod; period += 1) {
    const length = period * repeats;
    if (keys.length < length) continue;
    const tail = keys.slice(-length);
    const pattern = tail.slice(0, period);
    if (tail.every((key, index) => key === pattern[index % period])) {
      return { period, repeats, pattern };
    }
  }
  return null;
}

function cycleSignature(pattern) {
  const rotations = pattern.map((_, offset) =>
    [...pattern.slice(offset), ...pattern.slice(0, offset)].join(":"),
  );
  rotations.sort();
  return sha256(Buffer.from(rotations[0]));
}

async function writePrivateJson(path, value) {
  await writeFile(path, `${JSON.stringify(value, null, 2)}\n`, { mode: 0o600 });
  await chmod(path, 0o600);
}

async function writePrivateBytes(path, bytes) {
  await writeFile(path, bytes, { mode: 0o600 });
  await chmod(path, 0o600);
}

async function writeAtomicPrivateText(path, value) {
  const temporaryPath = `${path}.${process.pid}.${randomUUID()}.tmp`;
  await writeFile(temporaryPath, value, { mode: 0o600 });
  await rename(temporaryPath, path);
  await chmod(path, 0o600);
}

async function readRecoveryDatasetState(path) {
  let text;
  try {
    text = await readFile(path, "utf8");
  } catch (error) {
    if (error?.code === "ENOENT") {
      return { recoveryExamples: 0, latestRecoveryExample: null };
    }
    throw error;
  }
  const examples = text.trim() === ""
    ? []
    : text.trim().split("\n").map((line) => JSON.parse(line));
  if (examples.some((example) =>
    example?.schema !== "master-red/manual-recovery-example/v1" ||
    typeof example.exampleId !== "string" || example.exampleId === ""
  )) {
    throw new Error("manual recovery dataset contains an invalid example");
  }
  const latest = examples.at(-1) ?? null;
  return {
    recoveryExamples: examples.length,
    latestRecoveryExample: latest
      ? {
          exampleId: latest.exampleId,
          recordedAt: latest.recordedAt,
          manualSession: latest.demonstration?.session ?? null,
          datasetPath: path,
          postInterventionReplayBundle:
            latest.provenance?.postInterventionReplayBundle ?? null,
        }
      : null,
  };
}

function handoffMarkdown({
  runId,
  sessionId,
  update,
  playerState,
  journalPath,
  recoveryDatasetPath,
  recoveryExamples = 0,
  latestRecoveryExample = null,
  latestBundlePath,
  anomaly = null,
  final = null,
}) {
  const observation = update?.observation ?? {};
  const memory = observation.playerMemory ?? {};
  const decision = update?.decision ?? {};
  const party = memory.trainer?.party ?? [];
  const ui = memory.ui ?? {};
  const uiStages = Object.entries(ui)
    .filter(([, value]) => value)
    .map(([name, value]) => `${name}:${value.stage ?? "active"}`)
    .join(", ") || "none";
  const partyRows = party.length === 0
    ? "| — | — | — | — |\n"
    : party.map(({ slot, species, level, hp, maxHp, status, heldItem }) =>
        `| ${slot} | ${species} | ${level ?? "?"} | ${hp ?? "?"}/${maxHp ?? "?"}` +
        `${status ? ` · status ${status}` : ""}${heldItem ? ` · item ${heldItem}` : ""} |`
      ).join("\n") + "\n";
  const tasks = (memory.activeTasks ?? []).map(({ function: name }) => name).filter(Boolean);
  return `# MASTER RED live diagnostic handoff

This file is generated from the cartridge and central-player record. Read it before debugging or resuming work after context compaction.

- Run: \`${runId}\`
- Diagnostic session: \`${sessionId}\`
- Decision/frame: ${update?.decisions ?? "?"} / ${observation.frame ?? "?"}
- Cartridge mode: \`${observation.emulator?.mode ?? "unknown"}\`
- Callback: \`${observation.emulator?.callback2 ?? "unknown"}\`
- Map: \`${memory.map?.id ?? "unknown"}\` @ ${memory.position?.x ?? "?"},${memory.position?.y ?? "?"}
- UI: ${uiStages}
- Active tasks: ${tasks.length ? tasks.map((name) => `\`${name}\``).join(", ") : "none observed"}
- Winning advice: ${decision.winner ? `\`${decision.winner.advisor}:${decision.winner.recommendation.kind}\`` : "none"}
- Controller plan: \`${(decision.action?.buttons ?? []).join("+") || "neutral"}\` for ${decision.action?.holdFrames ?? 0} hold + ${decision.action?.releaseFrames ?? 0} release frame(s)
- Manual control sessions: ${playerState?.manualControl?.sessionCount ?? 0}
- Latest anomaly: ${anomaly ?? "none"}
- Session result: ${final?.result ?? "running"}
- Rolling compressed decision journal: \`${journalPath}\` (segments and explicit gaps: \`journal.retention.json\` beside it)
- Manual-recovery training examples: ${recoveryExamples} in \`${recoveryDatasetPath}\`
- Latest replay bundle: \`${latestBundlePath ?? "not captured yet"}\`

## Pending central workflow

\`\`\`json
${JSON.stringify(playerState?.workflow ?? null, null, 2)}
\`\`\`

## Last manual-control handoff

\`\`\`json
${JSON.stringify(playerState?.manualControl?.lastHandoff ?? null, null, 2)}
\`\`\`

## Latest recovery-training example

\`\`\`json
${JSON.stringify(latestRecoveryExample, null, 2)}
\`\`\`

## Party

| Slot | Species ID | Level | HP / state |
|---:|---:|---:|---|
${partyRows}
## Battle

\`\`\`json
${JSON.stringify(memory.battle ?? null, null, 2)}
\`\`\`

## Current decision

\`\`\`json
${JSON.stringify({
    reason: decision.reason ?? null,
    proposals: decision.proposals ?? [],
    rejected: decision.rejected ?? [],
    winner: decision.winner ?? null,
    action: decision.action ?? null,
  }, null, 2)}
\`\`\`

The replay bundle contains exact mGBA state, native SRAM, framebuffer bytes, the complete atomic observation, decision, and player workflow. The journal contains one independently recoverable gzip member per event, including manual-control handoffs.
`;
}

export async function createRunDiagnosticRecorder({
  outputDirectory,
  runId,
  sessionId = `${Date.now()}-${randomUUID()}`,
  session,
  metadata = {},
  snapshotIntervalDecisions = 5_000,
  stallThresholdDecisions = 32,
  journalRetention = {},
  clock = () => new Date().toISOString(),
} = {}) {
  if (typeof outputDirectory !== "string" || outputDirectory === "") {
    throw new TypeError("diagnostic outputDirectory is required");
  }
  const hasAtomicSnapshot = typeof session?.captureSnapshot === "function";
  const hasLegacySnapshot = typeof session?.saveState === "function" &&
    typeof session?.saveSram === "function" &&
    typeof session?.videoFrame === "function";
  if (!hasAtomicSnapshot && !hasLegacySnapshot) {
    throw new TypeError("diagnostics require emulator state, SRAM, and video access");
  }
  if (!Number.isSafeInteger(snapshotIntervalDecisions) || snapshotIntervalDecisions <= 0) {
    throw new TypeError("snapshotIntervalDecisions must be a positive integer");
  }
  if (!Number.isSafeInteger(stallThresholdDecisions) || stallThresholdDecisions <= 0) {
    throw new TypeError("stallThresholdDecisions must be a positive integer");
  }
  const safeRunId = safeToken(runId, "runId");
  const safeSessionId = safeToken(sessionId, "sessionId");
  const runDirectory = join(outputDirectory, `${safeRunId}.diagnostics`);
  const sessionDirectory = join(runDirectory, "sessions", safeSessionId);
  const journalPath = join(sessionDirectory, "decisions.jsonl.gz");
  const recoveryDatasetPath = join(runDirectory, "manual-recoveries.jsonl");
  const manifestPath = join(sessionDirectory, "manifest.json");
  const bundlesDirectory = join(sessionDirectory, "bundles");
  const handoffPath = join(sessionDirectory, "AI-HANDOFF.md");
  const runHandoffPath = join(runDirectory, "AI-HANDOFF.md");
  const latestPointerPath = join(runDirectory, "LATEST.json");
  await mkdir(sessionDirectory, { recursive: true, mode: 0o700 });
  await chmod(runDirectory, 0o700);
  await chmod(join(runDirectory, "sessions"), 0o700);
  await chmod(sessionDirectory, 0o700);
  const startedAt = timestamp(clock);
  const recoveryDatasetState = await readRecoveryDatasetState(recoveryDatasetPath);
  await writePrivateJson(manifestPath, {
    schema: "master-red/run-diagnostics/v1",
    runId: safeRunId,
    sessionId: safeSessionId,
    startedAt,
    journal: {
      path: "decisions.jsonl.gz",
      format: "concatenated-gzip-members-containing-one-json-line-each",
      completeness: "every central decision, bot controller frame plan, and manual control handoff within the retained window; older gaps are declared",
      retention: { path: "journal.retention.json", ...DEFAULT_JOURNAL_RETENTION, ...journalRetention },
      observations:
        "dynamic atomic observation per decision; map-grid cells are reconstructed by replay from exact bundles",
    },
    manualRecoveryDataset: {
      path: recoveryDatasetPath,
      scope: "run",
      format: "json-lines",
      schema: "master-red/manual-recovery-example/v1",
      supervision: "operator-demonstrated-recovery",
      onlinePolicyMutation: false,
    },
    snapshotPolicy: {
      intervalDecisions: snapshotIntervalDecisions,
      stableNoAdviceThreshold: stallThresholdDecisions,
      repeatedDecisionCycle: { minimumPeriod: 2, maximumPeriod: 8, repeats: 4 },
    },
    metadata,
  });
  const journal = await createBoundedJournal(journalPath, journalRetention);
  const recoveryDataset = await open(recoveryDatasetPath, "a", 0o600);
  await chmod(journalPath, 0o600);
  await chmod(recoveryDatasetPath, 0o600);
  let closed = false;
  let recordedDecisions = 0;
  let snapshots = 0;
  let latestBundlePath = null;
  let latestUpdate = null;
  let latestPlayerState = null;
  let latestAnomaly = null;
  let finalSummary = null;
  let { recoveryExamples, latestRecoveryExample } = recoveryDatasetState;
  let stableNoAdviceSignature = null;
  let stableNoAdviceCount = 0;
  const capturedStableNoAdvice = new Set();
  const decisionCycleKeys = [];
  const capturedDecisionCycles = new Set();
  const recentBotDecisions = [];
  const preservedEncounters = new Set();

  async function appendEvent(event) {
    if (closed) throw new Error("diagnostic recorder is closed");
    const bytes = Buffer.from(`${JSON.stringify(event)}\n`);
    await journal.write(gzipSync(bytes, { level: 1 }));
  }

  async function appendRecoveryExample(example) {
    if (closed) throw new Error("diagnostic recorder is closed");
    await recoveryDataset.write(Buffer.from(`${JSON.stringify(example)}\n`));
  }

  await appendEvent({
    schema: "master-red/run-event/v1",
    event: "session-start",
    runId: safeRunId,
    sessionId: safeSessionId,
    recordedAt: startedAt,
  });

  async function writeHandoff() {
    if (!latestUpdate) return;
    const markdown = handoffMarkdown({
      runId: safeRunId,
      sessionId: safeSessionId,
      update: latestUpdate,
      playerState: latestPlayerState,
      journalPath,
      recoveryDatasetPath,
      recoveryExamples,
      latestRecoveryExample,
      latestBundlePath,
      anomaly: latestAnomaly?.reason ?? null,
      final: finalSummary,
    });
    await Promise.all([
      writeAtomicPrivateText(handoffPath, markdown),
      writeAtomicPrivateText(runHandoffPath, markdown),
      writeAtomicPrivateText(latestPointerPath, `${JSON.stringify({
        schema: "master-red/latest-run-diagnostics/v1",
        runId: safeRunId,
        sessionId: safeSessionId,
        updatedAt: timestamp(clock),
        sessionDirectory,
        manifestPath,
        journalPath,
        recoveryDatasetPath,
        recoveryExamples,
        latestRecoveryExample,
        handoffPath,
        latestBundlePath,
        latestAnomaly,
        recordedDecisions,
        closed,
        final: finalSummary,
      }, null, 2)}\n`),
    ]);
  }

  async function writeReplayBundle(reason, update, playerState) {
    const decisions = Number(update?.decisions ?? 0);
    const decisionObservation = update?.observation ?? null;
    const decision = update?.decision ?? null;
    const snapshot = hasAtomicSnapshot
      ? await session.captureSnapshot()
      : {
          state: await session.saveState(),
          sram: await session.saveSram(),
          video: await session.videoFrame(),
        };
    const state = Buffer.from(snapshot?.state ?? []);
    const sram = Buffer.from(snapshot?.sram ?? []);
    const video = snapshot?.video;
    const observation = snapshot?.observation ?? decisionObservation;
    if (!(snapshot?.state instanceof Uint8Array) ||
        !(snapshot?.sram instanceof Uint8Array)) {
      throw new Error("diagnostic replay bundle received an invalid emulator snapshot");
    }
    if (
      !Number.isSafeInteger(video?.width) || video.width <= 0 ||
      !Number.isSafeInteger(video?.height) || video.height <= 0 ||
      !(video.rgba instanceof Uint8Array) ||
      video.rgba.byteLength !== video.width * video.height * 4
    ) {
      throw new Error("diagnostic replay bundle received an invalid framebuffer");
    }
    const rgba = Buffer.from(video.rgba.buffer, video.rgba.byteOffset, video.rgba.byteLength);
    const bundlePath = join(
      bundlesDirectory,
      `${String(decisions).padStart(9, "0")}-${safeToken(reason, "bundle reason")}`,
    );
    await mkdir(bundlePath, { recursive: true, mode: 0o700 });
    await chmod(bundlesDirectory, 0o700);
    await chmod(bundlePath, 0o700);
    const observationBytes = Buffer.from(`${JSON.stringify(observation)}\n`);
    const observationGzip = gzipSync(observationBytes, { level: 1 });
    const bundle = {
      schema: "master-red/replay-bundle/v1",
      runId: safeRunId,
      sessionId: safeSessionId,
      reason,
      recordedAt: timestamp(clock),
      decisions,
      frame: observation?.frame ?? null,
      decisionObservationFrame: decisionObservation?.frame ?? null,
      files: {
        state: { path: "emulator.state", bytes: state.length, sha256: sha256(state) },
        sram: { path: "cartridge.sav", bytes: sram.length, sha256: sha256(sram) },
        framebuffer: {
          path: "frame.rgba",
          bytes: rgba.length,
          sha256: sha256(rgba),
          width: video.width,
          height: video.height,
          pixelFormat: "rgba8888",
        },
        observation: {
          path: "observation.json.gz",
          bytes: observationGzip.length,
          sha256: sha256(observationBytes),
          compression: "gzip",
        },
        decision: { path: "decision.json" },
        playerState: { path: "player-state.json" },
      },
      replay: {
        journalPath,
        retentionPath: journal.status().path,
        note: "Load emulator.state with cartridge.sav, then replay retained journal segments in ledger order. Check declared gaps before replay; the rolling journal is not a complete campaign trace.",
      },
    };
    await Promise.all([
      writePrivateBytes(join(bundlePath, "emulator.state"), state),
      writePrivateBytes(join(bundlePath, "cartridge.sav"), sram),
      writePrivateBytes(join(bundlePath, "frame.rgba"), rgba),
      writePrivateBytes(join(bundlePath, "observation.json.gz"), observationGzip),
      writePrivateJson(join(bundlePath, "decision.json"), decision),
      writePrivateJson(join(bundlePath, "player-state.json"), playerState),
      writePrivateJson(join(bundlePath, "frame.json"), {
        width: video.width,
        height: video.height,
        pixelFormat: "rgba8888",
      }),
      writePrivateJson(join(bundlePath, "bundle.json"), bundle),
    ]);
    if (playerState) {
      // Publish the same atomic state/SRAM pair for automatic service resume.
      // Taking a second capture here would associate a later cartridge frame
      // with this decision's control workflow.
      await writePlayerCheckpoint({
        session: { captureSnapshot: () => snapshot },
        outputDirectory, runId: safeRunId,
        status: { frame: observation?.frame ?? null, reason },
        playerState,
      });
    }
    snapshots += 1;
    latestBundlePath = bundlePath;
    await journal.sync();
    return bundlePath;
  }

  return Object.freeze({
    async recordUpdate(update, { playerState = null } = {}) {
      const firstDecision = recordedDecisions === 0;
      let refreshHandoff = firstDecision;
      recordedDecisions = Number(update?.decisions ?? recordedDecisions);
      latestUpdate = update;
      latestPlayerState = playerState;
      const action = update?.decision?.action ?? {};
      const preInterventionReplayBundle = latestBundlePath;
      await appendEvent({
        schema: "master-red/run-event/v1",
        event: "decision",
        runId: safeRunId,
        sessionId: safeSessionId,
        recordedAt: timestamp(clock),
        decisions: update?.decisions ?? null,
        atomicCaptureRaces: update?.atomicCaptureRaces ?? null,
        observation: decisionJournalObservation(update?.observation),
        decision: update?.decision ?? null,
        rngPrediction: update?.rngPrediction ?? null,
        controlHandoff: update?.controlHandoff ?? null,
        playerState,
        controllerFramePlan: controllerFramePlan(action),
      });
      if (firstDecision) {
        await writeReplayBundle("run-start", update, playerState);
        refreshHandoff = true;
      } else if (recordedDecisions % snapshotIntervalDecisions === 0) {
        await writeReplayBundle("periodic", update, playerState);
        refreshHandoff = true;
      }
      if (update?.controlHandoff) {
        const postInterventionReplayBundle = await writeReplayBundle(
          "manual-recovery",
          update,
          playerState,
        );
        const {
          interruptedBotAction = null,
          ...demonstration
        } = update.controlHandoff;
        const recordedAt = timestamp(clock);
        const example = {
          schema: "master-red/manual-recovery-example/v1",
          exampleId:
            `${safeRunId}:${safeSessionId}:manual-${update.controlHandoff.session}`,
          runId: safeRunId,
          diagnosticSessionId: safeSessionId,
          recordedAt,
          supervision: {
            kind: "operator-demonstrated-recovery",
            outcome: "operator-returned-control",
            usage: "candidate-policy-repair-and-regression-eval",
            onlinePolicyMutation: false,
          },
          trigger: {
            latestDetectedAnomaly: latestAnomaly,
            interruptedBotAction,
            recentBotDecisions: [...recentBotDecisions],
          },
          demonstration,
          outcome: {
            firstBotObservation: decisionJournalObservation(update.observation),
            firstBotDecision: update.decision ?? null,
          },
          provenance: {
            decisionJournal: journalPath,
            preInterventionReplayBundle,
            postInterventionReplayBundle,
          },
        };
        await appendRecoveryExample(example);
        recoveryExamples += 1;
        latestRecoveryExample = {
          exampleId: example.exampleId,
          recordedAt,
          manualSession: update.controlHandoff.session,
          datasetPath: recoveryDatasetPath,
          postInterventionReplayBundle,
        };
        await appendEvent({
          schema: "master-red/run-event/v1",
          event: "manual-recovery-example",
          runId: safeRunId,
          sessionId: safeSessionId,
          recordedAt,
          ...latestRecoveryExample,
        });
        refreshHandoff = true;
      }
      const stableNoAdvice =
        update?.observation?.phase === "stable" &&
        update?.decision?.winner === null &&
        update?.decision?.reason === "no-advice" &&
        (update?.decision?.action?.buttons?.length ?? 0) === 0;
      if (stableNoAdvice) {
        const signature = stableStateSignature(update.observation);
        if (signature === stableNoAdviceSignature) {
          stableNoAdviceCount += 1;
        } else {
          stableNoAdviceSignature = signature;
          stableNoAdviceCount = 1;
        }
        if (
          stableNoAdviceCount === stallThresholdDecisions &&
          !capturedStableNoAdvice.has(signature)
        ) {
          capturedStableNoAdvice.add(signature);
          latestAnomaly = {
            reason: "stable-no-advice",
            signature,
            decisions: recordedDecisions,
            firstDecision: recordedDecisions - stableNoAdviceCount + 1,
            frame: update.observation.frame,
          };
          await appendEvent({
            schema: "master-red/run-event/v1",
            event: "anomaly",
            runId: safeRunId,
            sessionId: safeSessionId,
            recordedAt: timestamp(clock),
            ...latestAnomaly,
          });
          await writeReplayBundle("stable-no-advice", update, playerState);
          refreshHandoff = true;
        }
      } else {
        stableNoAdviceSignature = null;
        stableNoAdviceCount = 0;
      }
      const cycleRecommendation = update?.decision?.winner?.recommendation;
      const deliberateEncounterPatrol =
        cycleRecommendation?.kind === "move-toward" &&
        cycleRecommendation?.target?.kind === "encounter-zone" &&
        Number(cycleRecommendation?.remainingSteps) === 1;
      const cycleEligible =
        update?.observation?.phase === "stable" &&
        (update?.decision?.action?.buttons?.length ?? 0) > 0 &&
        !deliberateEncounterPatrol;
      if (cycleEligible) {
        decisionCycleKeys.push(decisionCycleKey(update));
        if (decisionCycleKeys.length > 64) decisionCycleKeys.shift();
        const cycle = repeatedCycle(decisionCycleKeys);
        if (cycle) {
          const signature = cycleSignature(cycle.pattern);
          if (!capturedDecisionCycles.has(signature)) {
            capturedDecisionCycles.add(signature);
            latestAnomaly = {
              reason: "repeated-decision-cycle",
              signature,
              period: cycle.period,
              repeats: cycle.repeats,
              decisions: recordedDecisions,
              frame: update.observation.frame,
            };
            await appendEvent({
              schema: "master-red/run-event/v1",
              event: "anomaly",
              runId: safeRunId,
              sessionId: safeSessionId,
              recordedAt: timestamp(clock),
              ...latestAnomaly,
            });
            await writeReplayBundle("repeated-decision-cycle", update, playerState);
            refreshHandoff = true;
          }
        }
      } else if (update?.observation?.phase !== "transition") {
        decisionCycleKeys.length = 0;
      }
      recentBotDecisions.push(recoveryDecisionContext(update));
      if (recentBotDecisions.length > RECOVERY_CONTEXT_DECISIONS) {
        recentBotDecisions.shift();
      }
      if (update?.decision?.kind === "blocked") {
        latestAnomaly = { reason: update.decision.reason, decisions: recordedDecisions,
          frame: update.observation?.frame, recovery: update.decision.recovery ?? null };
        await appendEvent({ schema: "master-red/run-event/v1", event: "safety-stop",
          runId: safeRunId, sessionId: safeSessionId, recordedAt: timestamp(clock), ...latestAnomaly });
        await writeReplayBundle(update.decision.protectedEncounter ? "protected-encounter" : "safety-stop", update, playerState);
        refreshHandoff = true;
      }
      const protectedEncounter = update?.decision?.protectedEncounter;
      if (protectedEncounter && !preservedEncounters.has(protectedEncounter.observationId)) {
        preservedEncounters.add(protectedEncounter.observationId);
        if (update.decision.kind !== "blocked") await writeReplayBundle("protected-encounter", update, playerState);
        refreshHandoff = true;
      }
      if (
        refreshHandoff ||
        update?.decision?.kind === "complete" ||
        recordedDecisions % 64 === 0
      ) {
        await writeHandoff();
      }
    },
    async recordCaptureRace(event = {}) {
      await appendEvent({
        schema: "master-red/run-event/v1",
        event: "atomic-capture-race",
        runId: safeRunId,
        sessionId: safeSessionId,
        recordedAt: timestamp(clock),
        ...event,
        controllerFramePlan: {
          kind: "neutral",
          buttons: [],
          holdFrames: 1,
          releaseFrames: 0,
        },
      });
    },
    async close(summary = {}) {
      if (closed) return;
      await appendEvent({
        schema: "master-red/run-event/v1",
        event: "session-end",
        runId: safeRunId,
        sessionId: safeSessionId,
        recordedAt: timestamp(clock),
        recordedDecisions,
        ...summary,
      });
      await journal.sync();
      await recoveryDataset.sync();
      await journal.close();
      await recoveryDataset.close();
      finalSummary = summary;
      closed = true;
      await writeHandoff();
    },
    status() {
      return Object.freeze({
        schema: "master-red/run-diagnostics-status/v1",
        runId: safeRunId,
        sessionId: safeSessionId,
        runDirectory,
        sessionDirectory,
        manifestPath,
        journalPath,
        journalRetention: journal.status(),
        recoveryDatasetPath,
        handoffPath,
        runHandoffPath,
        latestPointerPath,
        latestBundlePath,
        latestAnomaly,
        recoveryExamples,
        latestRecoveryExample,
        final: finalSummary,
        recordedDecisions,
        snapshots,
        closed,
      });
    },
  });
}
