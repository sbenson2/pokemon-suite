import assert from "node:assert/strict";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { gunzipSync } from "node:zlib";
import { findLatestPlayerCheckpoint, writePlayerCheckpoint } from "../src/player/checkpoint.js";

async function loadDiagnostics() {
  try {
    return await import("../src/player/diagnostics.js");
  } catch (error) {
    if (error?.code === "ERR_MODULE_NOT_FOUND") return {};
    throw error;
  }
}

function recordedUpdate(decisions = 1) {
  const captureId = `capture-${decisions}`;
  const frame = decisions * 10;
  const observation = {
    captureId,
    frame,
    phase: "stable",
    phaseReasons: [],
    emulator: {
      captureId,
      frame,
      mode: "battle",
      callback2: "CB2_UpdatePartyMenu",
      inputReady: true,
    },
    sram: { captureId, frame, sha256: `sram-${decisions}` },
    playerMemory: {
      captureId,
      frame,
      sha256: `memory-${decisions}`,
      map: { id: "MAP_MT_MOON_B2F" },
      position: { x: 12, y: 26 },
      trainer: {
        partyCount: 3,
        usablePartyCount: 3,
        party: [
          { slot: 0, species: 46, level: 8, hp: 13, maxHp: 25 },
          { slot: 1, species: 56, level: 9, hp: 12, maxHp: 27 },
          { slot: 2, species: 5, level: 21, hp: 34, maxHp: 61 },
        ],
      },
      battle: {
        playerPartySlot: 0,
        player: { species: 46, hp: 13, maxHp: 25 },
        opponent: { species: 41, hp: 22, maxHp: 22 },
      },
      activeTasks: [{ function: "Task_HandleChooseMonInput" }],
      ui: {
        battle: null,
        party: { stage: "choose-pokemon", cursor: 0 },
      },
    },
  };
  const proposal = {
    advisor: "verifier",
    observationId: captureId,
    recommendation: {
      kind: "choose-party-member",
      targetPartySlot: 2,
      targetSpecies: 5,
      objective: "protect-training-member",
    },
    confidence: 1,
    constraints: ["pending-central-workflow"],
    vetoes: [],
    evidenceRefs: ["workflow:battle-party-1"],
  };
  const decision = {
    sequence: decisions,
    kind: "act",
    observationId: captureId,
    reason: "policy-resolution",
    proposals: [proposal],
    rejected: [{ advisor: "battle", reason: "stale-observation" }],
    winner: proposal,
    action: {
      kind: "bounded-edge",
      buttons: ["down"],
      holdFrames: 1,
      releaseFrames: 1,
      reason: "party-member",
    },
  };
  return { decisions, atomicCaptureRaces: 0, observation, decision };
}

test("diagnostics bound future journals and retain discoverable recent events without deleting replay evidence", async (t) => {
  const root = await mkdtemp(join(tmpdir(), "master-red-retention-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  const { createRunDiagnosticRecorder } = await loadDiagnostics();
  const recorder = await createRunDiagnosticRecorder({
    outputDirectory: root, runId: "retention", sessionId: "bounded",
    journalRetention: { segmentBytes: 700, maxBytes: 2200, closedRunMaxBytes: 3000 },
    session: {
      saveState: () => new Uint8Array([1]), saveSram: () => new Uint8Array([2]),
      videoFrame: () => ({ width: 1, height: 1, rgba: new Uint8Array(4) }),
    },
  });
  for (let index = 1; index <= 20; index += 1) await recorder.recordUpdate(recordedUpdate(index));
  await recorder.close({ result: "test" });
  const status = recorder.status();
  assert.ok(status.journalRetention, "retention metadata must be discoverable");
  const ledger = JSON.parse(await readFile(status.journalRetention.path, "utf8"));
  assert.ok(ledger.prunedEvents > 0);
  assert.ok(ledger.segments.reduce((sum, segment) => sum + segment.bytes, 0) <= 2200);
  const events = [];
  for (const segment of ledger.segments) {
    const bytes = await readFile(join(status.sessionDirectory, segment.path));
    assert.equal(bytes.length, segment.bytes);
    events.push(...gunzipSync(bytes).toString("utf8").trim().split("\n").map(JSON.parse));
  }
  assert.ok(events.some((event) => event.decisions === 20));
  assert.equal(events.at(-1).event, "session-end");
  assert.ok(await readFile(join(status.latestBundlePath, "emulator.state")));
  assert.ok(await readFile(status.recoveryDatasetPath));
});

test("closed-session retention bounds the run's managed journals and leaves legacy files alone", async (t) => {
  const root = await mkdtemp(join(tmpdir(), "master-red-run-retention-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  const legacy = join(root, "retention.diagnostics", "sessions", "legacy", "decisions.jsonl.gz");
  await mkdir(join(legacy, ".."), { recursive: true });
  await writeFile(legacy, "untouched historical evidence");
  const { createRunDiagnosticRecorder } = await loadDiagnostics();
  const statuses = [];
  for (let index = 0; index < 3; index += 1) {
    const recorder = await createRunDiagnosticRecorder({
      outputDirectory: root, runId: "retention", sessionId: `session-${index}`,
      journalRetention: { segmentBytes: 700, maxBytes: 2200, closedRunMaxBytes: 2300 },
      session: {
        saveState: () => new Uint8Array([1]), saveSram: () => new Uint8Array([2]),
        videoFrame: () => ({ width: 1, height: 1, rgba: new Uint8Array(4) }),
      },
    });
    for (let decision = 1; decision <= 3; decision += 1) await recorder.recordUpdate(recordedUpdate(decision));
    await recorder.close();
    statuses.push(recorder.status());
  }
  let bytes = 0;
  for (const status of statuses) {
    const ledger = JSON.parse(await readFile(status.journalRetention.path, "utf8"));
    for (const segment of ledger.segments) bytes += (await readFile(join(status.sessionDirectory, segment.path))).length;
    assert.ok(await readFile(join(status.latestBundlePath, "emulator.state")));
  }
  assert.ok(bytes <= 2300, `managed closed journals retained ${bytes} bytes`);
  assert.equal(await readFile(legacy, "utf8"), "untouched historical evidence");
});

test("a safety stop captures its exact blocked state and names the anomaly in the handoff", async (t) => {
  const root = await mkdtemp(join(tmpdir(), "master-red-safety-diagnostic-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  const { createRunDiagnosticRecorder } = await loadDiagnostics();
  const recorder = await createRunDiagnosticRecorder({
    outputDirectory: root, runId: "blocked-run",
    session: {
      saveState: () => new Uint8Array([1]), saveSram: () => new Uint8Array([2]),
      videoFrame: () => ({ width: 1, height: 1, rgba: new Uint8Array(4) }),
    },
  });
  await recorder.recordUpdate(recordedUpdate(1));
  const update = recordedUpdate(2);
  update.decision.kind = "blocked";
  update.decision.reason = "repeated-menu-transaction";
  await recorder.recordUpdate(update);
  await recorder.close({ result: "blocked" });
  assert.equal(recorder.status().latestAnomaly?.reason, "repeated-menu-transaction");
  const bundle = JSON.parse(await readFile(join(recorder.status().latestBundlePath, "bundle.json"), "utf8"));
  assert.equal(bundle.decisions, 2);
  assert.match(await readFile(recorder.status().handoffPath, "utf8"), /Latest anomaly: repeated-menu-transaction/);
});

test("periodic diagnostic snapshots publish a verified automatic-resume checkpoint without recapturing", async (t) => {
  const root = await mkdtemp(join(tmpdir(), "master-red-periodic-resume-"));
  await writePlayerCheckpoint({
    outputDirectory: root, runId: "resume-run", playerState: { sequence: 1 },
    session: { saveState: () => new Uint8Array([1]), saveSram: () => new Uint8Array([2]) },
  });
  let captures = 0;
  const { createRunDiagnosticRecorder } = await loadDiagnostics();
  const recorder = await createRunDiagnosticRecorder({
    outputDirectory: root, runId: "resume-run", sessionId: "periodic", snapshotIntervalDecisions: 2,
    session: { captureSnapshot() {
      captures += 1;
      return { state: new Uint8Array([captures + 10]), sram: new Uint8Array([captures + 20]),
        video: { width: 1, height: 1, rgba: new Uint8Array([0, 0, 0, 255]) } };
    } },
  });
  t.after(async () => {
    await recorder.close({ result: "test" });
    await rm(root, { recursive: true, force: true });
  });
  await recorder.recordUpdate(recordedUpdate(1), { playerState: { sequence: 10 } });
  await recorder.recordUpdate(recordedUpdate(2), { playerState: { sequence: 20, workflow: { id: "ongoing" } } });
  const resumed = await findLatestPlayerCheckpoint({ outputDirectory: root, runId: "resume-run" });
  assert.equal(resumed.playerState.sequence, 20);
  assert.equal(resumed.playerState.workflow.id, "ongoing");
  assert.deepEqual([...await readFile(resumed.stateFilePath)], [12]);
  assert.deepEqual([...await readFile(resumed.sramFilePath)], [22]);
  assert.equal(captures, 2);
});

function stalledUpdate(decisions) {
  const update = recordedUpdate(decisions);
  return {
    ...update,
    decision: {
      sequence: decisions,
      kind: "resample",
      observationId: update.observation.captureId,
      reason: "no-advice",
      proposals: [],
      rejected: [],
      winner: null,
      action: {
        kind: "neutral",
        buttons: [],
        holdFrames: 8,
        releaseFrames: 8,
        reason: "no-recommendation",
      },
    },
  };
}

function cyclingUpdate(decisions) {
  const update = recordedUpdate(decisions);
  const even = decisions % 2 === 0;
  return {
    ...update,
    observation: {
      ...update.observation,
      playerMemory: {
        ...update.observation.playerMemory,
        position: { x: even ? 13 : 12, y: 26 },
        ui: { battle: null, party: null },
      },
    },
    decision: {
      ...update.decision,
      winner: {
        ...update.decision.winner,
        recommendation: {
          kind: "move-toward",
          direction: even ? "west" : "east",
          objective: "leave-mt-moon",
        },
      },
      action: {
        kind: "bounded-edge",
        buttons: [even ? "left" : "right"],
        holdFrames: 4,
        releaseFrames: 1,
        reason: "navigation",
      },
    },
  };
}

test("the run journal preserves dynamic state and exact retained controller semantics without repeating the full map grid", async (t) => {
  const root = await mkdtemp(join(tmpdir(), "master-red-diagnostics-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  const { createRunDiagnosticRecorder } = await loadDiagnostics();
  assert.equal(typeof createRunDiagnosticRecorder, "function");

  const recorder = await createRunDiagnosticRecorder({
    outputDirectory: root,
    runId: "diagnostic-run",
    sessionId: "session-1",
    session: {
      saveState: () => new Uint8Array([1, 2, 3]),
      saveSram: () => new Uint8Array([4, 5]),
      videoFrame: () => ({
        width: 1,
        height: 1,
        rgba: new Uint8Array([10, 20, 30, 255]),
      }),
    },
    metadata: { cartridge: { sha1: "stock-fire-red" } },
    snapshotIntervalDecisions: 100,
    stallThresholdDecisions: 10,
    clock: () => "2026-08-30T20:00:00.000Z",
  });
  const update = recordedUpdate(1);
  update.observation.playerMemory.mapGrid = {
    width: 2,
    height: 1,
    cells: [{ x: 0, y: 0, collision: 0 }, { x: 1, y: 0, collision: 1 }],
  };
  update.decision.action = {
    kind: "sustained-chord",
    buttons: ["b", "right"],
    holdFrames: 4,
    releaseFrames: 0,
    reason: "navigation-running",
    movementLease: {
      kind: "route-plan",
      origin: { map: "MAP_MT_MOON_B2F", x: 12, y: 26 },
      target: { map: "MAP_MT_MOON_B2F", x: 15, y: 24 },
      segments: [
        {
          direction: "east",
          target: { map: "MAP_MT_MOON_B2F", x: 15, y: 26 },
        },
        {
          direction: "north",
          target: { map: "MAP_MT_MOON_B2F", x: 15, y: 24 },
        },
      ],
      mapRevision: "a".repeat(64),
      maximumFrames: 180,
      stallFrames: 60,
    },
  };
  update.controlHandoff = {
    schema: "master-red/manual-control-handoff/v1",
    session: 1,
    startedFrame: 4,
    endedFrame: 9,
    inputEvents: [
      { frame: 5, buttons: ["a"] },
      { frame: 6, buttons: [] },
    ],
    finalObservation: {
      captureId: "capture-1",
      frame: 10,
      sramSha256: "sram-1",
      playerMemorySha256: "memory-1",
    },
  };
  const playerState = {
    sequence: 1,
    workflow: {
      id: "battle-party-1",
      kind: "battle-party-selection",
      targetPartySlot: 2,
    },
  };
  await recorder.recordUpdate(update, { playerState });
  await recorder.close({ result: "stopped" });

  const journalBytes = await readFile(recorder.status().journalPath);
  const events = gunzipSync(journalBytes).toString("utf8").trim().split("\n").map(JSON.parse);
  const event = events.find(({ event: kind }) => kind === "decision");

  assert.deepEqual(event.observation.playerMemory.mapGrid, {
    omittedFromDecisionJournal: true,
    width: 2,
    height: 1,
    derivedFromPlayerMemorySha256: "memory-1",
  });
  assert.deepEqual(
    { ...event.observation.playerMemory, mapGrid: update.observation.playerMemory.mapGrid },
    update.observation.playerMemory,
  );
  assert.deepEqual(event.decision, update.decision);
  assert.deepEqual(event.playerState, playerState);
  assert.deepEqual(event.controlHandoff, update.controlHandoff);
  assert.deepEqual(event.controllerFramePlan, {
    kind: "sustained-chord",
    buttons: ["b", "right"],
    holdFrames: 4,
    releaseFrames: 0,
    movementLease: update.decision.action.movementLease,
  });

  const bundleObservation = JSON.parse(gunzipSync(await readFile(join(
    recorder.status().latestBundlePath,
    "observation.json.gz",
  ))));
  assert.deepEqual(bundleObservation, update.observation, "replay bundles remain exact");
});

test("a manual handoff writes a replay-backed recovery example with preceding bot context", async (t) => {
  const root = await mkdtemp(join(tmpdir(), "master-red-diagnostics-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  const { createRunDiagnosticRecorder } = await loadDiagnostics();
  const recorder = await createRunDiagnosticRecorder({
    outputDirectory: root,
    runId: "recovery-run",
    sessionId: "recovery-session",
    session: {
      saveState: () => new Uint8Array([1, 2, 3]),
      saveSram: () => new Uint8Array([4, 5]),
      videoFrame: () => ({
        width: 1,
        height: 1,
        rgba: new Uint8Array([10, 20, 30, 255]),
      }),
    },
    snapshotIntervalDecisions: 100,
    stallThresholdDecisions: 10,
    clock: () => "2026-08-31T20:00:00.000Z",
  });
  await recorder.recordUpdate(recordedUpdate(1));
  const interrupted = recordedUpdate(2);
  await recorder.recordUpdate(interrupted);
  const resumed = recordedUpdate(3);
  resumed.controlHandoff = {
    schema: "master-red/manual-control-handoff/v1",
    session: 1,
    startedFrame: 21,
    endedFrame: 29,
    inputEvents: [
      { frame: 22, buttons: ["left"] },
      { frame: 28, buttons: [] },
    ],
    finalObservation: {
      captureId: "manual-final",
      frame: 29,
      sramSha256: "manual-sram",
      playerMemorySha256: "manual-memory",
    },
    interruptedBotAction: {
      decisions: 2,
      observationId: "capture-2",
      observationFrame: 20,
      decisionSequence: 2,
      action: interrupted.decision.action,
      execution: {
        startFrame: 20,
        endFrame: 21,
        interrupted: "manual-control",
      },
    },
  };
  await recorder.recordUpdate(resumed);
  await recorder.close({ result: "stopped" });

  const status = recorder.status();
  assert.equal(typeof status.recoveryDatasetPath, "string");
  assert.match(
    status.recoveryDatasetPath,
    /recovery-run\.diagnostics\/manual-recoveries\.jsonl$/,
  );
  const examples = (await readFile(status.recoveryDatasetPath, "utf8"))
    .trim().split("\n").map(JSON.parse);
  assert.equal(examples.length, 1);
  const [example] = examples;
  assert.equal(example.schema, "master-red/manual-recovery-example/v1");
  assert.deepEqual(example.supervision, {
    kind: "operator-demonstrated-recovery",
    outcome: "operator-returned-control",
    usage: "candidate-policy-repair-and-regression-eval",
    onlinePolicyMutation: false,
  });
  assert.deepEqual(
    example.trigger.recentBotDecisions.map((entry) => ({
      decisions: entry.decisions,
      observationId: entry.observation.captureId,
      frame: entry.observation.frame,
      buttons: entry.decision.action.buttons,
    })),
    [
      { decisions: 1, observationId: "capture-1", frame: 10, buttons: ["down"] },
      { decisions: 2, observationId: "capture-2", frame: 20, buttons: ["down"] },
    ],
  );
  assert.deepEqual(
    example.trigger.interruptedBotAction,
    resumed.controlHandoff.interruptedBotAction,
  );
  assert.deepEqual(example.demonstration.inputEvents, [
    { frame: 22, buttons: ["left"] },
    { frame: 28, buttons: [] },
  ]);
  assert.deepEqual({
    observationId: example.outcome.firstBotObservation.captureId,
    frame: example.outcome.firstBotObservation.frame,
    buttons: example.outcome.firstBotDecision.action.buttons,
  }, {
    observationId: "capture-3",
    frame: 30,
    buttons: ["down"],
  });
  assert.match(example.provenance.preInterventionReplayBundle, /run-start$/);
  assert.match(example.provenance.postInterventionReplayBundle, /manual-recovery$/);
  assert.equal(status.recoveryExamples, 1);
  assert.equal(status.latestRecoveryExample.exampleId, example.exampleId);
  const manifest = JSON.parse(await readFile(status.manifestPath, "utf8"));
  assert.deepEqual(manifest.manualRecoveryDataset, {
    path: status.recoveryDatasetPath,
    scope: "run",
    format: "json-lines",
    schema: "master-red/manual-recovery-example/v1",
    supervision: "operator-demonstrated-recovery",
    onlinePolicyMutation: false,
  });
  const handoff = await readFile(status.handoffPath, "utf8");
  assert.match(handoff, /Manual-recovery training examples: 1/);
  assert.match(handoff, /recovery-run:recovery-session:manual-1/);
  const latest = JSON.parse(await readFile(status.latestPointerPath, "utf8"));
  assert.equal(latest.recoveryDatasetPath, status.recoveryDatasetPath);
  assert.equal(latest.recoveryExamples, 1);
  assert.equal(latest.latestRecoveryExample.exampleId, example.exampleId);
  const journalEvents = gunzipSync(await readFile(status.journalPath))
    .toString("utf8").trim().split("\n").map(JSON.parse);
  assert.equal(
    journalEvents.some((event) =>
      event.event === "manual-recovery-example" &&
      event.exampleId === example.exampleId
    ),
    true,
  );

  const nextSession = await createRunDiagnosticRecorder({
    outputDirectory: root,
    runId: "recovery-run",
    sessionId: "recovery-session-2",
    session: {
      saveState: () => new Uint8Array([1, 2, 3]),
      saveSram: () => new Uint8Array([4, 5]),
      videoFrame: () => ({
        width: 1,
        height: 1,
        rgba: new Uint8Array([10, 20, 30, 255]),
      }),
    },
    clock: () => "2026-08-31T20:01:00.000Z",
  });
  assert.equal(nextSession.status().recoveryExamples, 1);
  assert.equal(
    nextSession.status().latestRecoveryExample.exampleId,
    example.exampleId,
  );
  await nextSession.close({ result: "stopped" });
});

test("the first decision writes an exact replay bundle and an AI-readable handoff", async (t) => {
  const root = await mkdtemp(join(tmpdir(), "master-red-diagnostics-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  const { createRunDiagnosticRecorder } = await loadDiagnostics();
  const recorder = await createRunDiagnosticRecorder({
    outputDirectory: root,
    runId: "diagnostic-run",
    sessionId: "session-start-bundle",
    session: {
      saveState: () => new Uint8Array([1, 2, 3]),
      saveSram: () => new Uint8Array([4, 5]),
      videoFrame: () => ({
        width: 1,
        height: 1,
        rgba: new Uint8Array([10, 20, 30, 255]),
      }),
    },
    metadata: { cartridge: { sha1: "stock-fire-red" } },
    snapshotIntervalDecisions: 100,
    stallThresholdDecisions: 10,
    clock: () => "2026-08-30T20:00:00.000Z",
  });
  const update = recordedUpdate(1);
  const playerState = {
    sequence: 1,
    workflow: { id: "battle-party-1", targetPartySlot: 2 },
    manualControl: {
      sessionCount: 2,
      lastHandoff: {
        schema: "master-red/manual-control-handoff/v1",
        session: 2,
        startedFrame: 80,
        endedFrame: 120,
        inputEvents: [{ frame: 90, buttons: ["start"] }],
        finalObservationId: "capture-1",
        finalFrame: 10,
        finalSramSha256: "sram-1",
      },
    },
  };

  await recorder.recordUpdate(update, { playerState });
  const status = recorder.status();
  const bundle = JSON.parse(await readFile(join(status.latestBundlePath, "bundle.json")));

  assert.equal(bundle.reason, "run-start");
  assert.equal(bundle.frame, 10);
  assert.deepEqual([...await readFile(join(status.latestBundlePath, "emulator.state"))], [1, 2, 3]);
  assert.deepEqual([...await readFile(join(status.latestBundlePath, "cartridge.sav"))], [4, 5]);
  assert.deepEqual([...await readFile(join(status.latestBundlePath, "frame.rgba"))], [10, 20, 30, 255]);
  assert.deepEqual(
    JSON.parse(gunzipSync(await readFile(join(status.latestBundlePath, "observation.json.gz")))),
    update.observation,
  );
  const handoff = await readFile(status.handoffPath, "utf8");
  assert.match(handoff, /MAP_MT_MOON_B2F/);
  assert.match(handoff, /CB2_UpdatePartyMenu/);
  assert.match(handoff, /battle-party-1/);
  assert.match(handoff, /Manual control sessions: 2/);
  assert.match(handoff, /master-red\/manual-control-handoff\/v1/);
  assert.match(handoff, /latest replay bundle/i);

  const manifest = JSON.parse(await readFile(status.manifestPath, "utf8"));
  assert.match(manifest.journal.completeness, /manual control handoff/i);

  await recorder.close({ result: "stopped" });
});

test("diagnostic replay bundles use one asynchronous worker snapshot", async (t) => {
  const root = await mkdtemp(join(tmpdir(), "master-red-diagnostics-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  const { createRunDiagnosticRecorder } = await loadDiagnostics();
  let captures = 0;
  const recorder = await createRunDiagnosticRecorder({
    outputDirectory: root,
    runId: "worker-diagnostic-run",
    sessionId: "worker-snapshot",
    session: {
      async captureSnapshot() {
        captures += 1;
        return {
          frame: 10,
          state: new Uint8Array([1, 2, 3]),
          sram: new Uint8Array([4, 5]),
          video: {
            width: 1,
            height: 1,
            rgba: new Uint8Array([10, 20, 30, 255]),
          },
          observation: recordedUpdate(1).observation,
        };
      },
    },
    snapshotIntervalDecisions: 100,
    stallThresholdDecisions: 10,
  });

  await recorder.recordUpdate(recordedUpdate(1));

  assert.equal(captures, 1);
  assert.deepEqual(
    [...await readFile(join(recorder.status().latestBundlePath, "emulator.state"))],
    [1, 2, 3],
  );
  await recorder.close({ result: "stopped" });
});

test("a stable no-advice loop automatically captures one anomaly replay bundle", async (t) => {
  const root = await mkdtemp(join(tmpdir(), "master-red-diagnostics-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  const { createRunDiagnosticRecorder } = await loadDiagnostics();
  const recorder = await createRunDiagnosticRecorder({
    outputDirectory: root,
    runId: "diagnostic-run",
    sessionId: "session-stall",
    session: {
      saveState: () => new Uint8Array([1, 2, 3]),
      saveSram: () => new Uint8Array([4, 5]),
      videoFrame: () => ({
        width: 1,
        height: 1,
        rgba: new Uint8Array([10, 20, 30, 255]),
      }),
    },
    snapshotIntervalDecisions: 100,
    stallThresholdDecisions: 3,
    clock: () => "2026-08-30T20:00:00.000Z",
  });

  for (let decisions = 1; decisions <= 6; decisions += 1) {
    await recorder.recordUpdate(stalledUpdate(decisions), {
      playerState: { sequence: decisions, workflow: null },
    });
  }

  const status = recorder.status();
  const bundle = JSON.parse(await readFile(join(status.latestBundlePath, "bundle.json")));
  assert.equal(bundle.reason, "stable-no-advice");
  assert.equal(bundle.decisions, 3);
  assert.equal(status.snapshots, 2, "run start plus one deduplicated anomaly");
  assert.equal(status.latestAnomaly.reason, "stable-no-advice");
  const handoff = await readFile(status.handoffPath, "utf8");
  assert.match(handoff, /stable-no-advice/);

  await recorder.close({ result: "stopped" });
});

test("the run journal records atomic-capture recovery frames in causal order", async (t) => {
  const root = await mkdtemp(join(tmpdir(), "master-red-diagnostics-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  const { createRunDiagnosticRecorder } = await loadDiagnostics();
  const recorder = await createRunDiagnosticRecorder({
    outputDirectory: root,
    runId: "diagnostic-run",
    sessionId: "session-capture-race",
    session: {
      saveState: () => new Uint8Array([1]),
      saveSram: () => new Uint8Array([2]),
      videoFrame: () => ({ width: 1, height: 1, rgba: new Uint8Array(4) }),
    },
    clock: () => "2026-08-30T20:00:00.000Z",
  });

  assert.equal(typeof recorder.recordCaptureRace, "function");
  await recorder.recordCaptureRace({
    atomicCaptureRaces: 1,
    startFrame: 40,
    endFrame: 41,
    recoveryFrame: 41,
  });
  await recorder.close({ result: "stopped" });
  const events = gunzipSync(await readFile(recorder.status().journalPath))
    .toString("utf8").trim().split("\n").map(JSON.parse);
  const race = events.find(({ event }) => event === "atomic-capture-race");

  assert.deepEqual(race.controllerFramePlan, {
    kind: "neutral",
    buttons: [],
    holdFrames: 1,
    releaseFrames: 0,
  });
  assert.deepEqual(
    { startFrame: race.startFrame, endFrame: race.endFrame, recoveryFrame: race.recoveryFrame },
    { startFrame: 40, endFrame: 41, recoveryFrame: 41 },
  );
});

test("each update refreshes a stable run-level pointer for a future AI session", async (t) => {
  const root = await mkdtemp(join(tmpdir(), "master-red-diagnostics-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  const { createRunDiagnosticRecorder } = await loadDiagnostics();
  const recorder = await createRunDiagnosticRecorder({
    outputDirectory: root,
    runId: "diagnostic-run",
    sessionId: "session-latest",
    session: {
      saveState: () => new Uint8Array([1]),
      saveSram: () => new Uint8Array([2]),
      videoFrame: () => ({ width: 1, height: 1, rgba: new Uint8Array(4) }),
    },
  });
  t.after(() => recorder.close({ result: "test-cleanup" }));
  await recorder.recordUpdate(recordedUpdate(1), {
    playerState: { sequence: 1, workflow: null },
  });

  const status = recorder.status();
  assert.equal(typeof status.latestPointerPath, "string");
  assert.equal(typeof status.runHandoffPath, "string");
  const latest = JSON.parse(await readFile(status.latestPointerPath));
  assert.equal(latest.sessionId, "session-latest");
  assert.equal(latest.journalPath, status.journalPath);
  assert.equal(latest.latestBundlePath, status.latestBundlePath);
  assert.match(await readFile(status.runHandoffPath, "utf8"), /session-latest/);

  await recorder.close({ result: "stopped" });
  const ended = JSON.parse(await readFile(status.latestPointerPath));
  assert.equal(ended.closed, true);
  assert.equal(ended.final.result, "stopped");
});

test("a repeated cartridge-state/action cycle captures a loop anomaly", async (t) => {
  const root = await mkdtemp(join(tmpdir(), "master-red-diagnostics-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  const { createRunDiagnosticRecorder } = await loadDiagnostics();
  const recorder = await createRunDiagnosticRecorder({
    outputDirectory: root,
    runId: "diagnostic-run",
    sessionId: "session-cycle",
    session: {
      saveState: () => new Uint8Array([1]),
      saveSram: () => new Uint8Array([2]),
      videoFrame: () => ({ width: 1, height: 1, rgba: new Uint8Array(4) }),
    },
    snapshotIntervalDecisions: 100,
    stallThresholdDecisions: 32,
  });

  for (let decisions = 1; decisions <= 10; decisions += 1) {
    await recorder.recordUpdate(cyclingUpdate(decisions), {
      playerState: { sequence: decisions, workflow: null },
    });
  }

  const status = recorder.status();
  assert.equal(status.latestAnomaly?.reason, "repeated-decision-cycle");
  assert.equal(status.latestAnomaly?.period, 2);
  const bundle = JSON.parse(await readFile(join(status.latestBundlePath, "bundle.json")));
  assert.equal(bundle.reason, "repeated-decision-cycle");
  assert.equal(status.snapshots, 2);

  await recorder.close({ result: "stopped" });
});

test("walking transitions preserve actionable cycle history", async (t) => {
  const root = await mkdtemp(join(tmpdir(), "master-red-diagnostics-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  const { createRunDiagnosticRecorder } = await loadDiagnostics();
  const recorder = await createRunDiagnosticRecorder({
    outputDirectory: root,
    runId: "diagnostic-run",
    sessionId: "session-transition-cycle",
    session: {
      saveState: () => new Uint8Array([1]),
      saveSram: () => new Uint8Array([2]),
      videoFrame: () => ({ width: 1, height: 1, rgba: new Uint8Array(4) }),
    },
    snapshotIntervalDecisions: 100,
    stallThresholdDecisions: 32,
  });

  let decisions = 0;
  for (let cycle = 1; cycle <= 10; cycle += 1) {
    const stable = cyclingUpdate(cycle);
    stable.decisions = ++decisions;
    await recorder.recordUpdate(stable, {
      playerState: { sequence: decisions, workflow: null },
    });
    const transition = recordedUpdate(++decisions);
    transition.observation.phase = "transition";
    transition.decision = {
      ...transition.decision,
      kind: "resample",
      reason: "transition",
      winner: null,
      action: {
        kind: "neutral",
        buttons: [],
        holdFrames: 8,
        releaseFrames: 8,
        reason: "resample-transition",
      },
    };
    await recorder.recordUpdate(transition, {
      playerState: { sequence: decisions, workflow: null },
    });
  }

  const status = recorder.status();
  assert.equal(status.latestAnomaly?.reason, "repeated-decision-cycle");
  assert.equal(status.latestAnomaly?.period, 2);

  await recorder.close({ result: "stopped" });
});

test("intentional encounter patrols are not navigation anomalies", async (t) => {
  const root = await mkdtemp(join(tmpdir(), "master-red-diagnostics-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  const { createRunDiagnosticRecorder } = await loadDiagnostics();
  const recorder = await createRunDiagnosticRecorder({
    outputDirectory: root,
    runId: "diagnostic-run",
    sessionId: "session-encounter-patrol",
    session: {
      saveState: () => new Uint8Array([1]),
      saveSram: () => new Uint8Array([2]),
      videoFrame: () => ({ width: 1, height: 1, rgba: new Uint8Array(4) }),
    },
    snapshotIntervalDecisions: 100,
    stallThresholdDecisions: 32,
  });

  let decisions = 0;
  for (let cycle = 1; cycle <= 10; cycle += 1) {
    const stable = cyclingUpdate(cycle);
    stable.decisions = ++decisions;
    stable.decision.winner.recommendation = {
      kind: "move-toward",
      direction: stable.decision.winner.recommendation.direction,
      objective: "train-battle-member",
      targetMap: "MAP_ROUTE4",
      target: {
        kind: "encounter-zone",
        x: cycle % 2 === 0 ? 87 : 88,
        y: 15,
      },
      remainingSteps: 1,
    };
    await recorder.recordUpdate(stable, {
      playerState: { sequence: decisions, workflow: null },
    });
    const transition = recordedUpdate(++decisions);
    transition.observation.phase = "transition";
    transition.decision = {
      ...transition.decision,
      kind: "resample",
      reason: "transition",
      winner: null,
      action: {
        kind: "neutral",
        buttons: [],
        holdFrames: 8,
        releaseFrames: 8,
        reason: "resample-transition",
      },
    };
    await recorder.recordUpdate(transition, {
      playerState: { sequence: decisions, workflow: null },
    });
  }

  const status = recorder.status();
  assert.equal(status.latestAnomaly, null);
  assert.equal(status.snapshots, 1, "only the run-start replay should be captured");

  await recorder.close({ result: "stopped" });
});
