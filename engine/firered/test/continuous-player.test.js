import assert from "node:assert/strict";
import test from "node:test";

test("the first protected encounter is backed up before any capture input", async () => {
  const { runContinuousPlayer } = await import("../src/player/continuous-player.js");
  const calls = [];
  await runContinuousPlayer({ maxDecisions: 1,
    emulator: { observe: async () => ({}), cancel: async () => calls.push("cancel"),
      execute: async () => calls.push("input"), pause: async () => calls.push("pause") },
    player: { decide: () => ({ kind: "act", protectedEncounter: { id: "initial:1" },
      action: { kind: "bounded", buttons: ["a"] } }) },
    onUpdate: async () => { await new Promise((resolve) => setImmediate(resolve)); calls.push("backup"); } });
  assert.deepEqual(calls, ["cancel", "backup", "input", "pause"]);
});

import { createPolicyAdvisors } from "../src/player/advisors.js";
import { createCentralPlayer } from "../src/player/delegator.js";
import {
  createDecisionReportGate,
  createLiveViewServer,
  runContinuousPlayer,
  shouldReportDecision,
} from "../src/player/continuous-player.js";

test("throughput reports distinguish rejected stale inputs from executed commands", async () => {
  let frame = 0, now = 0, inputs = 0;
  const updates = [];
  const result = await runContinuousPlayer({ maxDecisions: 3, performanceClock: () => now,
    emulator: { observe: async () => ({ frame: frame += 300 }),
      execute: async () => (++inputs === 1 ? { interrupted: "stale-observation", startFrame: frame + 130 } : { startFrame: frame + 30 }),
      pause: async () => {} },
    player: { decide: () => { now += 500; return { kind: "act", action: { kind: "bounded", buttons: ["a"] } }; } },
    onUpdate: update => updates.push(update) });
  assert.equal(result.performance.submittedActions, 3);
  assert.equal(result.performance.staleActions, 1);
  assert.equal(result.performance.acceptedActions, 2);
  assert.equal(result.performance.planningMs.mean, 500);
  assert.equal(result.performance.maxActionAgeFrames, 130);
  assert.equal(result.performance.observedFramesPerSecond, 400);
  assert.equal(updates[1].performance.staleActions, 1);
  assert.equal(updates[0].performance.staleActions, 0, "older metric samples must remain immutable");
});

function observation({ id, frame, phase = "stable", mode = "overworld", callback2 = "CB2_Overworld", ui = {} }) {
  return {
    captureId: id,
    frame,
    phase,
    phaseReasons: phase === "stable" ? [] : ["automatic-transition"],
    emulator: { captureId: id, frame, mode, callback2, inputReady: true },
    sram: { captureId: id, frame, sha256: `sram-${frame}` },
    playerMemory: {
      captureId: id,
      frame,
      sha256: `memory-${frame}`,
      map: { id: mode === "hall-of-fame" ? "MAP_POKEMON_LEAGUE_HALL_OF_FAME" : "MAP_POKEMON_LEAGUE_CHAMPIONS_ROOM" },
      trainer: { usablePartyCount: 6, party: [] },
      battle: null,
      ui: {
        battle: null,
        party: null,
        fieldDialog: null,
        choiceMenu: null,
        startMenu: null,
        saveDialog: null,
        moveLearning: null,
        levelUp: null,
        evolution: null,
        blackout: null,
        newGame: null,
        ...ui,
      },
    },
  };
}

test("a safety-blocked controller stops the continuous loop without issuing another input", async () => {
  const player = createCentralPlayer({ initialState: {
    sequence: 0, initialSramSha256: null,
    transactionRecovery: { attempts: 2, blocked: { reason: "repeated-menu-transaction" } },
  } });
  let inputs = 0;
  let paused = false;
  const result = await runContinuousPlayer({ player, maxDecisions: 4,
    emulator: { observe: async () => observation({ id: "blocked", frame: 1 }),
      execute: async () => { inputs += 1; }, pause: async () => { paused = true; } },
    onUpdate: () => assert.equal(paused, true, "freeze before asynchronous evidence writes"),
  });
  assert.equal(result.kind, "blocked");
  assert.equal(result.decisions, 1);
  assert.equal(inputs, 0);
  assert.equal(paused, true);
});

test("an uncapped decision loop still stops and freezes on a real safety error", async () => {
  let decisions = 0, inputs = 0, paused = false;
  const result = await runContinuousPlayer({ maxDecisions: null,
    emulator: { observe: async () => ({}), execute: async () => { inputs++; }, pause: async () => { paused = true; } },
    player: { decide: () => ++decisions === 4
      ? { kind: "blocked", reason: "repeated-menu-transaction", action: { kind: "neutral", buttons: [] } }
      : { kind: "act", action: { kind: "bounded", buttons: ["a"] } } },
  });
  assert.equal(result.kind, "blocked");
  assert.equal(result.decisions, 4);
  assert.equal(inputs, 3);
  assert.equal(paused, true);
});

function createManualScheduler() {
  let now = 0;
  let nextId = 1;
  const tasks = new Map();
  return {
    clock: () => now,
    schedule(callback, delay) {
      const token = nextId;
      nextId += 1;
      tasks.set(token, { callback, dueAt: now + delay });
      return token;
    },
    cancel(token) {
      tasks.delete(token);
    },
    advance(milliseconds) {
      const target = now + milliseconds;
      while (true) {
        const pending = [...tasks.entries()]
          .filter(([, task]) => task.dueAt <= target)
          .sort((left, right) => left[1].dueAt - right[1].dueAt)[0];
        if (!pending) break;
        const [token, task] = pending;
        tasks.delete(token);
        now = task.dueAt;
        task.callback();
      }
      now = target;
    },
  };
}

async function readFramePackets(response, count) {
  assert.equal(response.ok, true);
  const reader = response.body.getReader();
  const packets = [];
  let buffered = Buffer.alloc(0);
  try {
    while (packets.length < count) {
      const { done, value } = await reader.read();
      if (done) break;
      buffered = Buffer.concat([buffered, Buffer.from(value)]);
      while (buffered.length >= 16 && packets.length < count) {
        assert.equal(buffered.subarray(0, 4).toString("ascii"), "MRF1");
        const width = buffered.readUInt16BE(4);
        const height = buffered.readUInt16BE(6);
        const byteLength = buffered.readUInt32BE(8);
        const sequence = buffered.readUInt32BE(12);
        if (buffered.length < 16 + byteLength) break;
        packets.push({
          width,
          height,
          sequence,
          rgba: buffered.subarray(16, 16 + byteLength),
        });
        buffered = buffered.subarray(16 + byteLength);
      }
    }
  } finally {
    await reader.cancel();
  }
  assert.equal(packets.length, count);
  return packets;
}

test("the continuous loop resamples automatically, acts once, and stops at native Hall of Fame", async () => {
  const captures = [
    observation({ id: "capture-1", frame: 1, phase: "transition" }),
    observation({ id: "capture-2", frame: 3, ui: { fieldDialog: { stage: "awaiting-page" } } }),
    {
      ...observation({ id: "capture-3", frame: 5, mode: "hall-of-fame", callback2: "CB2_HofIdle" }),
      sram: { captureId: "capture-3", frame: 5, sha256: "native-hall-save" },
      playerMemory: {
        ...observation({ id: "capture-3", frame: 5 }).playerMemory,
        captureId: "capture-3",
        frame: 5,
        map: { id: "MAP_POKEMON_LEAGUE_HALL_OF_FAME" },
        activeTasks: [{ function: "Task_Hof_DelayAfterSave" }],
      },
    },
  ];
  const calls = [];
  const emulator = {
    async observe() { return captures.shift(); },
    async execute(action) { calls.push(action); },
  };
  const player = createCentralPlayer({ advisors: createPolicyAdvisors() });
  const updates = [];
  const result = await runContinuousPlayer({
    emulator,
    player,
    maxDecisions: 10,
    onUpdate(update) { updates.push(update); },
  });

  assert.equal(result.kind, "complete");
  assert.equal(result.decisions, 3);
  assert.deepEqual(calls.map(({ buttons }) => buttons), [[], ["a"]]);
  assert.deepEqual(updates.map(({ decision }) => decision.kind), ["resample", "act", "complete"]);
});

test("the continuous loop has a hard decision budget", async () => {
  let frame = 0;
  const emulator = {
    async observe() {
      return observation({ id: `capture-${frame}`, frame, phase: "transition" });
    },
    async execute() { frame += 1; },
  };
  const player = createCentralPlayer({ advisors: createPolicyAdvisors() });
  const result = await runContinuousPlayer({ emulator, player, maxDecisions: 2 });
  assert.deepEqual({ kind: result.kind, decisions: result.decisions }, {
    kind: "budget-exhausted",
    decisions: 2,
  });
});

test("the continuous loop reobserves the cartridge after manual control", async () => {
  const before = observation({
    id: "before-manual",
    frame: 100,
    ui: { fieldDialog: { stage: "awaiting-page" } },
  });
  const after = observation({
    id: "after-manual",
    frame: 180,
    ui: { fieldDialog: { stage: "awaiting-page" } },
  });
  const events = [];
  let capture = before;
  let controlPolls = 0;
  const emulator = {
    async observe() {
      events.push(`observe:${capture.captureId}`);
      return capture;
    },
    async execute(action) {
      events.push(`execute:${action.buttons.join("+")}`);
      if (capture === before) {
        return {
          startFrame: 100,
          endFrame: 110,
          holdFrames: 1,
          releaseFrames: 1,
          interrupted: "manual-control",
        };
      }
      return {};
    },
    async controlState() {
      controlPolls += 1;
      events.push(`control:${controlPolls}`);
      if (controlPolls === 1) return { mode: "manual" };
      capture = after;
      return { mode: "bot" };
    },
    async takeControlHandoff() {
      events.push("take-handoff");
      return {
        schema: "master-red/manual-control-handoff/v1",
        session: 1,
        startedFrame: 110,
        endedFrame: 180,
        inputEvents: [{ frame: 120, buttons: ["a"] }],
        observation: after,
      };
    },
  };
  const player = {
    decide(observed) {
      events.push(`decide:${observed.captureId}`);
      return {
        kind: "act",
        action: {
          kind: "bounded-edge",
          buttons: [observed === before ? "a" : "right"],
          holdFrames: 1,
          releaseFrames: 1,
        },
      };
    },
    resumeFromManual({ observation: observed }) {
      events.push(`resume:${observed.captureId}`);
    },
  };
  const updates = [];

  const result = await runContinuousPlayer({
    emulator,
    player,
    maxDecisions: 2,
    manualControlPollMs: 0,
    onUpdate(update) { updates.push(update); },
  });

  assert.equal(result.kind, "budget-exhausted");
  assert.deepEqual(events, [
    "observe:before-manual",
    "decide:before-manual",
    "execute:a",
    "control:1",
    "control:2",
    "take-handoff",
    "resume:after-manual",
    "observe:after-manual",
    "decide:after-manual",
    "execute:right",
  ]);
  assert.equal(updates[1].observation.captureId, "after-manual");
  assert.deepEqual(updates[1].controlHandoff, {
    schema: "master-red/manual-control-handoff/v1",
    session: 1,
    startedFrame: 110,
    endedFrame: 180,
    inputEvents: [{ frame: 120, buttons: ["a"] }],
    finalObservation: {
      captureId: "after-manual",
      frame: 180,
      sramSha256: "sram-180",
      playerMemorySha256: "memory-180",
    },
    interruptedBotAction: {
      decisions: 1,
      observationId: "before-manual",
      observationFrame: 100,
      decisionSequence: null,
      reason: null,
      winner: null,
      action: {
        kind: "bounded-edge",
        buttons: ["a"],
        holdFrames: 1,
        releaseFrames: 1,
      },
      execution: {
        startFrame: 100,
        endFrame: 110,
        holdFrames: 1,
        releaseFrames: 1,
        interrupted: "manual-control",
      },
    },
  });
});

test("the continuous loop serializes observations and commands through the worker", async () => {
  let frame = 5;
  const events = [];
  const emulator = {
    async observe() {
      events.push(`observe:${frame}`);
      return observation({ id: `capture-${frame}`, frame, phase: "transition" });
    },
    async execute(action) {
      events.push(`execute:${action.buttons.join("+") || "neutral"}`);
      frame += action.holdFrames + action.releaseFrames;
    },
  };
  const player = createCentralPlayer({ advisors: createPolicyAdvisors() });

  const result = await runContinuousPlayer({
    emulator,
    player,
    maxDecisions: 2,
  });

  assert.deepEqual(events, [
    "observe:5",
    "execute:neutral",
    "observe:21",
    "execute:neutral",
  ]);
  assert.equal(result.atomicCaptureRaces, 0);
});

test("the continuous loop submits the mapped frame plan as one controller command", async () => {
  const actions = [];
  const emulator = {
    async observe() {
      return observation({
        id: "paced-action",
        frame: 1,
        ui: { fieldDialog: { stage: "awaiting-page" } },
      });
    },
    async execute(action) { actions.push(action); },
  };
  const player = createCentralPlayer({ advisors: createPolicyAdvisors() });

  await runContinuousPlayer({
    emulator,
    player,
    maxDecisions: 1,
  });

  assert.deepEqual(actions.map(({ buttons, holdFrames, releaseFrames }) => ({
    buttons, holdFrames, releaseFrames,
  })), [{ buttons: ["a"], holdFrames: 1, releaseFrames: 1 }]);
});

test("the central player submits controller commands without stepping or waiting for diagnostics", async () => {
  const actions = [];
  let releaseDiagnostics;
  const diagnosticsFinished = new Promise((resolve) => {
    releaseDiagnostics = resolve;
  });
  const emulator = {
    async observe() {
      return observation({
        id: "controller-only",
        frame: 5,
        ui: { fieldDialog: { stage: "awaiting-page" } },
      });
    },
    async execute(action) {
      actions.push(action);
      return { startFrame: 5, endFrame: 7 };
    },
  };
  const player = createCentralPlayer({ advisors: createPolicyAdvisors() });

  const running = runContinuousPlayer({
    emulator,
    player,
    maxDecisions: 1,
    onUpdate: () => diagnosticsFinished,
  });
  await new Promise((resolve) => setImmediate(resolve));

  assert.deepEqual(actions.map(({ buttons }) => buttons), [["a"]]);
  releaseDiagnostics();
  const result = await running;
  assert.equal(result.kind, "budget-exhausted");
});

test("slow diagnostics are serialized but cannot stall the next controller command", async () => {
  const actions = [];
  const updates = [];
  let frame = 0;
  let releaseFirstUpdate;
  const firstUpdateFinished = new Promise((resolve) => {
    releaseFirstUpdate = resolve;
  });
  const emulator = {
    async observe() {
      return observation({ id: `async-${frame}`, frame, phase: "transition" });
    },
    async execute(action) {
      actions.push(action);
      frame += 1;
    },
  };
  const player = createCentralPlayer({ advisors: createPolicyAdvisors() });
  const running = runContinuousPlayer({
    emulator,
    player,
    maxDecisions: 2,
    async onUpdate(update) {
      updates.push(update.decisions);
      if (update.decisions === 1) await firstUpdateFinished;
    },
  });

  await new Promise((resolve) => setImmediate(resolve));
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(actions.length, 2, "the second command must not wait for diagnostic I/O");
  assert.deepEqual(updates, [1], "diagnostic writes remain serialized");

  releaseFirstUpdate();
  const result = await running;
  assert.equal(result.kind, "budget-exhausted");
  assert.deepEqual(updates, [1, 2], "the loop drains diagnostics before returning");
});

test("an asynchronous diagnostic failure is surfaced after submitted controller work", async () => {
  let frame = 0;
  const emulator = {
    async observe() {
      return observation({ id: `failure-${frame}`, frame, phase: "transition" });
    },
    async execute() { frame += 1; },
  };
  const player = createCentralPlayer({ advisors: createPolicyAdvisors() });

  await assert.rejects(
    runContinuousPlayer({
      emulator,
      player,
      maxDecisions: 1,
      onUpdate: async () => { throw new Error("diagnostic disk failure"); },
    }),
    /diagnostic disk failure/,
  );
});

test("a stopped loop clears retained movement before it drains diagnostics and returns", async () => {
  const actions = [];
  const emulator = {
    async observe() {
      return observation({ id: "retained-stop", frame: 10 });
    },
    async execute(action) { actions.push(action); },
  };
  const player = {
    decide(observed) {
      return {
        sequence: 1,
        kind: "act",
        observationId: observed.captureId,
        reason: "test-retained-running",
        proposals: [],
        rejected: [],
        winner: null,
        action: {
          kind: "sustained-chord",
          buttons: ["b", "right"],
          holdFrames: 4,
          releaseFrames: 0,
          reason: "navigation-running",
        },
      };
    },
  };

  const result = await runContinuousPlayer({
    emulator,
    player,
    maxDecisions: 1,
  });

  assert.equal(result.kind, "budget-exhausted");
  assert.deepEqual(actions.map(({ kind, buttons }) => ({ kind, buttons })), [
    { kind: "sustained-chord", buttons: ["b", "right"] },
    { kind: "neutral", buttons: [] },
  ]);
  assert.equal(actions[1].reason, "terminal-controller-release");
});

test("the central loop rejects direct access to a step-capable cartridge session", async () => {
  const player = createCentralPlayer({ advisors: createPolicyAdvisors() });
  await assert.rejects(
    runContinuousPlayer({
      session: { step() {} },
      observer: {
        capture: () => observation({ id: "legacy-session", frame: 1 }),
      },
      player,
      maxDecisions: 1,
    }),
    /autonomous emulator/i,
  );
});

test("idle neutral decisions are rate-limited while inputs and completion are reported", () => {
  const update = (decisions, kind, buttons) => ({
    decisions,
    decision: { kind, action: { buttons } },
  });
  assert.equal(shouldReportDecision(update(1, "act", [])), false);
  assert.equal(shouldReportDecision(update(250, "act", [])), true);
  assert.equal(shouldReportDecision(update(2, "act", ["right"])), true);
  assert.equal(shouldReportDecision(update(3, "complete", [])), true);
});

test("live decision logging is wall-clock bounded during fast-forward", () => {
  let now = 1000;
  const shouldWrite = createDecisionReportGate({ minimumIntervalMs: 250, clock: () => now });
  const update = (decisions, kind = "act") => ({
    decisions,
    decision: { kind, action: { buttons: ["right"] } },
  });

  assert.equal(shouldWrite(update(1)), true);
  now = 1100;
  assert.equal(shouldWrite(update(2)), false);
  now = 1250;
  assert.equal(shouldWrite(update(3)), true);
  assert.equal(shouldWrite(update(4, "complete")), true);
});

test("adaptive playback keeps a 54 FPS stream buffered on a 60 Hz display", async () => {
  const module = await import("../src/player/continuous-player.js");
  assert.equal(typeof module.advanceAdaptivePlayback, "function");

  let queuedFrames = 12;
  let playbackCredit = 0;
  let underflows = 0;
  let repeatedDisplayTicks = 0;
  for (let displayTick = 0; displayTick < 600; displayTick += 1) {
    // The measured live producer delivers nine frames per ten 60 Hz display
    // ticks. A fixed one-frame-per-tick consumer necessarily drains its queue.
    if (displayTick % 10 !== 9) queuedFrames += 1;
    if (queuedFrames === 0) underflows += 1;
    const step = module.advanceAdaptivePlayback({
      queuedFrames,
      playbackCredit,
    });
    assert.ok(step.consumeFrames >= 0 && step.consumeFrames <= queuedFrames);
    queuedFrames -= step.consumeFrames;
    playbackCredit = step.playbackCredit;
    if (step.consumeFrames === 0) repeatedDisplayTicks += 1;
  }

  assert.equal(underflows, 0);
  assert.ok(repeatedDisplayTicks >= 40 && repeatedDisplayTicks <= 60);
  assert.ok(queuedFrames >= 4 && queuedFrames <= 16);
});

test("the live publisher samples the latest emulator frame on a fixed 60 Hz clock", async () => {
  const { createLiveFramePublisher } = await import("../src/player/continuous-player.js");
  const scheduler = createManualScheduler();
  let captures = 0;
  const session = {
    frame: 0,
    videoFrame() {
      captures += 1;
      this.frame = (captures - 1) * 5;
      return { width: 1, height: 1, rgba: new Uint8Array([captures, 0, 0, 255]) };
    },
  };
  const publisher = createLiveFramePublisher({
    session,
    framesPerSecond: 60,
    clock: scheduler.clock,
    schedule: scheduler.schedule,
    cancel: scheduler.cancel,
  });

  assert.equal(captures, 1, "the first frame is available immediately");
  scheduler.advance(1000);
  assert.equal(captures, 61, "one initial snapshot plus exactly 60 clocked snapshots");
  assert.deepEqual(publisher.metrics(), {
    targetFramesPerSecond: 60,
    publishedFrames: 61,
    sourceFrame: 300,
    subscribers: 0,
  });

  publisher.close();
  scheduler.advance(1000);
  assert.equal(captures, 61, "closing the publisher cancels its clock");
});

test("Agent TV reuses one fixed-rate snapshot and losslessly compresses polling fallbacks", async (context) => {
  let captures = 0;
  const session = {
    frame: 42,
    videoFrame() {
      captures += 1;
      return { width: 1, height: 1, rgba: new Uint8Array([10, 20, 30, 255]) };
    },
  };
  const viewer = await createLiveViewServer({ session, port: 0, framesPerSecond: 1 });
  context.after(() => viewer.close());

  const responses = await Promise.all([
    fetch(new URL("/frame", viewer.url)),
    fetch(new URL("/frame", viewer.url)),
  ]);
  const bodies = await Promise.all(responses.map(async (response) => ({
    encoding: response.headers.get("content-encoding"),
    sequence: response.headers.get("x-frame-sequence"),
    bytes: [...new Uint8Array(await response.arrayBuffer())],
  })));

  assert.equal(captures, 1);
  assert.deepEqual(bodies, [
    { encoding: "gzip", sequence: "42", bytes: [10, 20, 30, 255] },
    { encoding: "gzip", sequence: "42", bytes: [10, 20, 30, 255] },
  ]);
});

test("Agent TV sends successive display frames over one persistent compressed stream", async (context) => {
  let captures = 0;
  const session = {
    frame: 0,
    videoFrame() {
      captures += 1;
      this.frame = captures * 5;
      return { width: 1, height: 1, rgba: new Uint8Array([captures, 0, 0, 255]) };
    },
  };
  const viewer = await createLiveViewServer({ session, port: 0, framesPerSecond: 120 });
  context.after(() => viewer.close());

  const response = await fetch(new URL("/stream", viewer.url));
  assert.equal(response.headers.get("content-encoding"), "gzip");
  assert.equal(response.headers.get("x-accel-buffering"), "no");
  const packets = await readFramePackets(response, 3);

  assert.deepEqual(packets.map(({ width, height }) => [width, height]), [[1, 1], [1, 1], [1, 1]]);
  assert.equal(packets.every(({ rgba }) => rgba.length === 4), true);
  assert.equal(packets[1].sequence > packets[0].sequence, true);
  assert.equal(packets[2].sequence > packets[1].sequence, true);
});

test("closing the live view terminates an attached persistent frame client", async () => {
  const session = {
    frame: 42,
    videoFrame() {
      return { width: 1, height: 1, rgba: new Uint8Array([0, 0, 0, 255]) };
    },
  };
  const viewer = await createLiveViewServer({ session, port: 0 });
  const response = await fetch(new URL("/stream", viewer.url));
  const reader = response.body.getReader();
  await reader.read();

  const closePromise = viewer.close();
  const outcome = await Promise.race([
    closePromise.then(() => "closed"),
    new Promise((resolve) => setTimeout(() => resolve("timed-out"), 100)),
  ]);
  if (outcome !== "closed") {
    await reader.cancel();
    await closePromise;
  }

  assert.equal(outcome, "closed");
});

test("Agent TV streams the autonomous emulator clock without creating a second sampler", async (context) => {
  const { createAutonomousEmulator } = await import(
    "../src/emulator/autonomous-emulator.js"
  );
  const scheduler = createManualScheduler();
  const session = {
    frame: 0,
    step() { this.frame += 1; },
    videoFrame() {
      return { width: 1, height: 1, rgba: new Uint8Array([this.frame, 0, 0, 255]) };
    },
  };
  const emulator = createAutonomousEmulator({
    session,
    emulationSpeed: 5,
    presentationFramesPerSecond: 60,
    clock: scheduler.clock,
    schedule: scheduler.schedule,
    cancel: scheduler.cancel,
  });
  const viewer = await createLiveViewServer({ frameSource: emulator, port: 0 });
  context.after(async () => {
    await viewer.close();
    emulator.close();
  });

  const response = await fetch(new URL("/stream", viewer.url));
  scheduler.advance(17);
  const packets = await readFramePackets(response, 2);

  assert.deepEqual(packets.map(({ sequence }) => sequence), [0, 5]);
  assert.equal(session.frame, 5);
  assert.equal(emulator.metrics().publishedFrames, 2);
});

test("the Agent TV page consumes the persistent stream instead of polling one HTTP frame at a time", async (context) => {
  const session = {
    frame: 42,
    videoFrame() {
      return { width: 1, height: 1, rgba: new Uint8Array([0, 0, 0, 255]) };
    },
  };
  const viewer = await createLiveViewServer({ session, port: 0 });
  context.after(() => viewer.close());

  const html = await fetch(viewer.url).then((response) => response.text());
  assert.match(html, /fetch\('\/stream'/);
  assert.doesNotMatch(html, /fetch\('\/frame'/);
});

test("the live viewer permits Agent TV to embed every response under COEP", async (context) => {
  const session = {
    frame: 42,
    videoFrame() {
      return { width: 1, height: 1, rgba: new Uint8Array([0, 0, 0, 255]) };
    },
  };
  const viewer = await createLiveViewServer({ session, port: 0 });
  context.after(() => viewer.close());

  for (const pathname of ["/", "/health", "/status", "/frame"]) {
    const response = await fetch(new URL(pathname, viewer.url));
    assert.equal(response.headers.get("cross-origin-resource-policy"), "cross-origin", pathname);
    if (pathname === "/frame") {
      assert.equal(
        response.headers.get("access-control-expose-headers"),
        "x-frame-width, x-frame-height, x-frame-sequence",
      );
      assert.equal(response.headers.get("x-frame-sequence"), "42");
    }
  }
});

test("Agent TV surfaces the live Pokedex completion count", async (context) => {
  const session = {
    frame: 42,
    videoFrame() {
      return { width: 1, height: 1, rgba: new Uint8Array([0, 0, 0, 255]) };
    },
  };
  const viewer = await createLiveViewServer({
    session,
    port: 0,
    getStatus: () => ({ pokedexOwnedCount: 17, pokedexSeenCount: 24 }),
  });
  context.after(() => viewer.close());

  const html = await fetch(viewer.url).then((response) => response.text());
  assert.match(html, /pokedexOwnedCount/);
  assert.match(html, /DEX/);
  assert.deepEqual(await fetch(new URL("/status", viewer.url)).then(
    (response) => response.json(),
  ), { pokedexOwnedCount: 17, pokedexSeenCount: 24 });
});

test("Agent TV transfers exclusive control through its live control API", async (context) => {
  const { createAutonomousEmulator } = await import(
    "../src/emulator/autonomous-emulator.js"
  );
  const scheduler = createManualScheduler();
  const inputs = [];
  const session = {
    frame: 0,
    step(buttons) {
      inputs.push([...buttons]);
      this.frame += 1;
    },
    videoFrame() {
      return { width: 1, height: 1, rgba: new Uint8Array([0, 0, 0, 255]) };
    },
  };
  const emulator = createAutonomousEmulator({
    session,
    emulationSpeed: 10,
    presentationFramesPerSecond: 60,
    clock: scheduler.clock,
    schedule: scheduler.schedule,
    cancel: scheduler.cancel,
  });
  const viewer = await createLiveViewServer({
    frameSource: emulator,
    control: emulator,
    port: 0,
  });
  context.after(async () => {
    await viewer.close();
    emulator.close();
  });
  const post = (pathname, body) => fetch(new URL(pathname, viewer.url), {
    method: "POST",
    headers: {
      "content-type": "application/json",
      origin: new URL(viewer.url).origin,
    },
    body: JSON.stringify(body),
  });

  const initial = await fetch(new URL("/control", viewer.url)).then(
    (response) => response.json(),
  );
  assert.equal(initial.mode, "bot");
  const manualResponse = await post("/control/mode", { mode: "manual" });
  assert.equal(manualResponse.status, 200);
  assert.equal((await manualResponse.json()).effectiveEmulationSpeed, 1);
  const inputResponse = await post("/control/input", { buttons: ["up", "b"] });
  assert.equal(inputResponse.status, 200);
  scheduler.advance(17);
  assert.deepEqual(inputs, [["b", "up"]]);

  await post("/control/input", { buttons: [] });
  const botResponse = await post("/control/mode", { mode: "bot" });
  assert.equal(botResponse.status, 200);
  assert.equal((await botResponse.json()).effectiveEmulationSpeed, 10);
  assert.equal(emulator.takeControlHandoff().inputEvents.length, 2);
});

test("Agent TV rejects cross-origin browser attempts to write controller input", async (context) => {
  let mutations = 0;
  const session = {
    frame: 42,
    videoFrame() {
      return { width: 1, height: 1, rgba: new Uint8Array([0, 0, 0, 255]) };
    },
  };
  const control = {
    controlState: () => ({ mode: "bot" }),
    setControlMode: () => {
      mutations += 1;
      return { mode: "manual" };
    },
    setManualButtons: () => {
      mutations += 1;
      return { mode: "manual" };
    },
  };
  const viewer = await createLiveViewServer({ session, control, port: 0 });
  context.after(() => viewer.close());

  const response = await fetch(new URL("/control/mode", viewer.url), {
    method: "POST",
    headers: {
      "content-type": "application/json",
      origin: "https://unrelated.example",
    },
    body: JSON.stringify({ mode: "manual" }),
  });

  assert.equal(response.status, 403);
  assert.deepEqual(await response.json(), { error: "untrusted-control-origin" });
  assert.equal(mutations, 0);
});

test("Agent TV replaces its trainer card with accessible Game Boy Advance controls", async (context) => {
  const session = {
    frame: 42,
    videoFrame() {
      return { width: 1, height: 1, rgba: new Uint8Array([0, 0, 0, 255]) };
    },
  };
  const viewer = await createLiveViewServer({ session, port: 0 });
  context.after(() => viewer.close());

  const html = await fetch(viewer.url).then((response) => response.text());
  assert.match(html, /id="take-control"[^>]*>Play manually</);
  assert.match(html, /aria-label="Game Boy Advance controls"/);
  for (const button of ["up", "down", "left", "right", "a", "b", "start", "select"]) {
    assert.match(html, new RegExp(`data-gba-button="${button}"`));
  }
  assert.match(html, /id="return-to-bot"[^>]*>Return to bot</);
});

test("Agent TV advertises and streams native-rate stereo audio, releasing listeners on close", async (context) => {
  const listeners = new Set();
  const session = {
    frame: 1,
    videoFrame: () => ({ width: 1, height: 1, rgba: new Uint8Array([0, 0, 0, 255]) }),
    audioFormat: { sampleRate: 32768, channels: 2, format: 's16le' },
    subscribeAudio(listener) { listeners.add(listener); return () => listeners.delete(listener); },
  };
  const viewer = await createLiveViewServer({ session, port: 0 });
  context.after(() => viewer.close());
  const health = await (await fetch(new URL('/health', viewer.url))).json();
  assert.deepEqual(health.audio, { path: '/audio', sampleRate: 32768, channels: 2, format: 's16le', tempo: 1 });
  const response = await fetch(new URL('/audio', viewer.url));
  assert.equal(response.status, 200);
  const pcm = Buffer.alloc(32768);
  for (let i = 0; i < pcm.length; i += 4) { pcm.writeInt16LE(1234, i); pcm.writeInt16LE(-1234, i + 2); }
  for (const listener of listeners) listener(pcm);
  const reader = response.body.getReader();
  const { value } = await reader.read();
  const received = Buffer.from(value);
  assert.equal(received.readInt16LE(0), 1234);
  assert.equal(received.readInt16LE(2), -1234);
  assert.equal(received.length % 4, 0);
  await reader.cancel();
  await viewer.close();
  assert.equal(listeners.size, 0);
});
