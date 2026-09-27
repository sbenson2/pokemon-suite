import assert from "node:assert/strict";
import test from "node:test";

async function loadWorkerRuntime() {
  try {
    return await import("../src/emulator/autonomous-emulator-worker-runtime.js");
  } catch (error) {
    if (error?.code === "ERR_MODULE_NOT_FOUND") return {};
    throw error;
  }
}

test("worker snapshots keep state, SRAM, video, and observation on one emulator frame", async () => {
  const { createEmulatorRequestHandler } = await loadWorkerRuntime();
  assert.equal(typeof createEmulatorRequestHandler, "function");
  const session = {
    frame: 75,
    saveState: () => new Uint8Array([1, 2, 3]),
    saveSram: () => new Uint8Array([4, 5]),
    videoFrame: () => ({
      width: 1,
      height: 1,
      rgba: new Uint8Array([6, 7, 8, 255]),
    }),
  };
  const observer = {
    capture: () => ({ captureId: "atomic-worker-capture", frame: session.frame }),
  };
  const handler = createEmulatorRequestHandler({
    emulator: { execute: async () => {}, metrics: () => ({ sourceFrame: session.frame }) },
    observer,
    session,
  });

  assert.deepEqual(await handler("captureSnapshot"), {
    frame: 75,
    state: new Uint8Array([1, 2, 3]),
    sram: new Uint8Array([4, 5]),
    video: {
      width: 1,
      height: 1,
      rgba: new Uint8Array([6, 7, 8, 255]),
    },
    observation: { captureId: "atomic-worker-capture", frame: 75 },
  });
});

test("worker control handoffs include the final atomic cartridge observation", async () => {
  const { createEmulatorRequestHandler } = await loadWorkerRuntime();
  const session = {
    frame: 125,
    saveState: () => new Uint8Array([1]),
    saveSram: () => new Uint8Array([2]),
    videoFrame: () => ({
      width: 1,
      height: 1,
      rgba: new Uint8Array([3, 4, 5, 255]),
    }),
  };
  const handoff = {
    schema: "master-red/manual-control-handoff/v1",
    session: 1,
    startedFrame: 100,
    endedFrame: 125,
    inputEvents: [{ frame: 101, buttons: ["a"] }],
  };
  const emulator = {
    execute: async () => {},
    metrics: () => ({ sourceFrame: session.frame }),
    controlState: () => ({ mode: "bot", manualSessionCount: 1 }),
    takeControlHandoff: () => handoff,
  };
  const observer = {
    capture: () => ({ captureId: "after-manual", frame: session.frame }),
  };
  const handler = createEmulatorRequestHandler({ emulator, observer, session });

  assert.deepEqual(await handler("controlState"), {
    mode: "bot",
    manualSessionCount: 1,
  });
  assert.deepEqual(await handler("takeControlHandoff"), {
    ...handoff,
    observation: { captureId: "after-manual", frame: 125 },
  });
});

test("the worker binds Agent TV status and controls to the same emulator owner", async () => {
  const { createLiveViewBindings } = await loadWorkerRuntime();
  assert.equal(typeof createLiveViewBindings, "function");
  const emulator = {
    controlState: () => ({
      schema: "master-red/control-state/v1",
      mode: "manual",
      effectiveEmulationSpeed: 1,
    }),
  };
  const bindings = createLiveViewBindings({
    emulator,
    getStatus: () => ({ runId: "manual-test", decisions: 42 }),
  });

  assert.equal(bindings.frameSource, emulator);
  assert.equal(bindings.control, emulator);
  assert.deepEqual(bindings.getStatus(), {
    runId: "manual-test",
    decisions: 42,
    control: {
      schema: "master-red/control-state/v1",
      mode: "manual",
      effectiveEmulationSpeed: 1,
    },
  });
});

test("view-only worker bindings expose video without granting a manual controller", async () => {
  const { createLiveViewBindings } = await loadWorkerRuntime();
  const emulator = { controlState: () => ({ mode: "bot", manualSessionCount: 0 }) };
  const bindings = createLiveViewBindings({ emulator, viewOnly: true });
  assert.equal(bindings.control, null);
  assert.equal(bindings.frameSource, emulator);
  assert.equal(bindings.getStatus().control.viewOnly, true);
});

test("the worker buffers every live decision while collapsing adjacent duplicate intent", async () => {
  const { createDecisionFeedBuffer } = await loadWorkerRuntime();
  assert.equal(typeof createDecisionFeedBuffer, "function");
  const feed = createDecisionFeedBuffer({ limit: 3 });
  const status = (sequence, overrides = {}) => ({
    runId: "run-a",
    frame: sequence * 100,
    phase: "stable",
    mode: "overworld",
    map: "MAP_ROUTE17",
    position: { x: 8, y: 40 - sequence },
    updatedAt: `2026-09-02T20:00:${String(sequence).padStart(2, "0")}.000Z`,
    spectator: {
      trainer: { playTime: { hours: 1, minutes: 2, seconds: sequence } },
      strategy: { activeStoryGoal: "badge-rainbow" },
    },
    decision: { sequence, kind: "act", reason: "policy-resolution" },
    winner: {
      advisor: "navigation",
      recommendation: {
        kind: "move-toward",
        objective: "reach-celadon-city",
        direction: "up",
        remainingSteps: 40 - sequence,
      },
      confidence: 0.96,
      constraints: ["campaign-objective-order"],
      evidenceRefs: ["cartridge:target-map:MAP_CELADON_CITY"],
    },
    action: { kind: "sustained-chord", reason: "navigation-running" },
    ...overrides,
  });

  feed.update(status(10));
  let published = feed.update(status(11));

  assert.equal(published.decisionFeed.schema, "master-red/decision-feed/v1");
  assert.equal(published.decisionFeed.totalDecisions, 2);
  assert.equal(published.decisionFeed.entries.length, 1);
  assert.deepEqual({
    id: published.decisionFeed.entries[0].id,
    firstSequence: published.decisionFeed.entries[0].firstSequence,
    lastSequence: published.decisionFeed.entries[0].lastSequence,
    repeats: published.decisionFeed.entries[0].repeats,
    position: published.decisionFeed.entries[0].position,
    playTime: published.decisionFeed.entries[0].playTime,
  }, {
    id: "run-a:10",
    firstSequence: 10,
    lastSequence: 11,
    repeats: 2,
    position: { x: 8, y: 29 },
    playTime: { hours: 1, minutes: 2, seconds: 11 },
  });

  published = feed.update(status(11));
  assert.equal(
    published.decisionFeed.entries[0].repeats,
    2,
    "republishing one status sample must not inflate its duplicate count",
  );

  published = feed.update(status(12, {
    phase: "battle",
    mode: "battle",
    winner: {
      advisor: "battle",
      recommendation: {
        kind: "choose-battle-move",
        objective: "win-trainer-battle",
        targetMoveId: 55,
        targetMoveSlot: 1,
      },
      confidence: 0.99,
      constraints: [],
      evidenceRefs: [],
    },
    action: { kind: "press", reason: "battle-move-selection" },
  }));

  assert.equal(published.decisionFeed.entries.length, 2);
  assert.equal(published.decisionFeed.entries.at(-1).firstSequence, 12);
});

test("the live decision buffer has fixed retention and resets at a run boundary", async () => {
  const { createDecisionFeedBuffer } = await loadWorkerRuntime();
  const feed = createDecisionFeedBuffer({ limit: 2 });
  const status = (runId, sequence, objective) => ({
    runId,
    frame: sequence,
    phase: "stable",
    decision: { sequence, kind: "act", reason: "policy-resolution" },
    winner: {
      advisor: "campaign",
      recommendation: { kind: "interact", objective },
    },
    action: { kind: "press", reason: objective },
  });

  feed.update(status("run-a", 1, "first"));
  feed.update(status("run-a", 2, "second"));
  let published = feed.update(status("run-a", 3, "third"));

  assert.deepEqual(
    published.decisionFeed.entries.map(({ firstSequence }) => firstSequence),
    [2, 3],
  );
  assert.equal(published.decisionFeed.droppedEntries, 1);
  assert.equal(published.decisionFeed.capacity, 2);

  published = feed.update(status("run-b", 1, "new-run"));
  assert.equal(published.decisionFeed.runId, "run-b");
  assert.equal(published.decisionFeed.totalDecisions, 1);
  assert.equal(published.decisionFeed.droppedEntries, 0);
  assert.deepEqual(
    published.decisionFeed.entries.map(({ id }) => id),
    ["run-b:1"],
  );
});

test("the live decision feed strips route internals so burst snapshots stay lightweight", async () => {
  const { createDecisionFeedBuffer } = await loadWorkerRuntime();
  const feed = createDecisionFeedBuffer({ limit: 80 });
  let published;
  for (let sequence = 1; sequence <= 80; sequence += 1) {
    published = feed.update({
      runId: "burst-run",
      frame: sequence * 10,
      phase: "stable",
      mode: "overworld",
      map: "MAP_ROUTE6",
      decision: { sequence, kind: "act", reason: "policy-resolution" },
      winner: {
        advisor: "navigation",
        recommendation: {
          kind: "move-toward",
          objective: `objective-${sequence}`,
          direction: "up",
          remainingSteps: 100 - sequence,
          travelMode: "run",
          routePlan: {
            segments: Array.from({ length: 100 }, (_, index) => ({
              direction: "up", endpoint: { x: sequence, y: index },
            })),
          },
          pathSegment: { direction: "up", steps: 1, endpoint: { x: 4, y: 5 } },
        },
        confidence: 0.96,
        constraints: Array.from({ length: 30 }, (_, index) => `constraint-${index}`),
        evidenceRefs: Array.from({ length: 30 }, (_, index) => `evidence-${index}`),
      },
      action: { kind: "sustained-chord", reason: "navigation-running" },
    });
  }

  const recommendation = published.decisionFeed.entries[0].winner.recommendation;
  assert.equal(Object.hasOwn(recommendation, "routePlan"), false);
  assert.equal(Object.hasOwn(recommendation, "pathSegment"), false);
  assert.ok(published.decisionFeed.entries[0].winner.constraints.length <= 12);
  assert.ok(published.decisionFeed.entries[0].winner.evidenceRefs.length <= 12);
  assert.ok(
    Buffer.byteLength(JSON.stringify(published.decisionFeed)) < 128 * 1024,
    "the complete eighty-group relay snapshot must remain comfortably below its 256 KiB transport cap",
  );
});
