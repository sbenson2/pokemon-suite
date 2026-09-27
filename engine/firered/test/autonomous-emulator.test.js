import assert from "node:assert/strict";
import test from "node:test";

async function loadAutonomousEmulator() {
  try {
    return await import("../src/emulator/autonomous-emulator.js");
  } catch (error) {
    if (error?.code === "ERR_MODULE_NOT_FOUND") return {};
    throw error;
  }
}

function createManualScheduler() {
  let now = 0;
  let nextId = 1;
  const tasks = new Map();
  return {
    clock: () => now,
    schedule(callback, delay) {
      const id = nextId;
      nextId += 1;
      tasks.set(id, { callback, at: now + delay });
      return id;
    },
    cancel(id) {
      tasks.delete(id);
    },
    advance(milliseconds) {
      const target = now + milliseconds;
      while (true) {
        const next = [...tasks.entries()]
          .filter(([, task]) => task.at <= target)
          .sort((left, right) => left[1].at - right[1].at)[0];
        if (!next) break;
        const [id, task] = next;
        tasks.delete(id);
        now = task.at;
        task.callback();
      }
      now = target;
    },
    runOneAfterStall(milliseconds) {
      now += milliseconds;
      const next = [...tasks.entries()]
        .sort((left, right) => left[1].at - right[1].at)[0];
      if (!next) return;
      const [id, task] = next;
      tasks.delete(id);
      task.callback();
    },
    nextDueAt() {
      return [...tasks.values()].sort((left, right) => left.at - right.at)[0]?.at ?? null;
    },
  };
}

function createFakeSession() {
  return {
    frame: 0,
    inputs: [],
    step(buttons) {
      this.inputs.push([...buttons]);
      this.frame += 1;
      return this.frame;
    },
    videoFrame() {
      return {
        width: 1,
        height: 1,
        rgba: new Uint8Array([this.frame & 0xff, 0, 0, 255]),
      };
    },
  };
}

test('frame-exact hunt actions honor long neutral waits and stop at the requested frame at 5x', async()=>{
 const {createAutonomousEmulator}=await loadAutonomousEmulator();
 const scheduler=createManualScheduler(),session=createFakeSession();
 const emulator=createAutonomousEmulator({session,...scheduler,emulationSpeed:5,frameExact:true});
 scheduler.advance(100);
 assert.equal(session.frame,0);
 const wait=emulator.execute({buttons:[],holdFrames:81,releaseFrames:0});
 scheduler.advance(1000);await wait;
 assert.equal(session.frame,81);
 const press=emulator.execute({buttons:['a'],holdFrames:1,releaseFrames:1});
 scheduler.advance(100);await press;
 assert.equal(session.frame,83);
 assert.deepEqual(session.inputs.slice(-2),[['a'],[]]);
 emulator.close();
});

test('a synchronous native controller observes and supplies every frame at 5x without waiting between commands',async()=>{
 const {createAutonomousEmulator}=await loadAutonomousEmulator(),scheduler=createManualScheduler(),session=createFakeSession(),seen=[];
 const emulator=createAutonomousEmulator({session,...scheduler,emulationSpeed:5,frameExact:true,botFrameInput:()=>{seen.push(session.frame);return session.frame===299?null:session.frame%2?[]:['a'];}});
 scheduler.advance(1100);assert.equal(session.frame,299);assert.deepEqual(seen,Array.from({length:300},(_,i)=>i));
 assert.deepEqual(session.inputs.slice(0,4),[['a'],[],['a'],[]]);
 assert.equal(emulator.controlState().paused,true);emulator.close();
});

test('native frame input cannot compete with queued commands and stops immediately on manual takeover',async()=>{
 const {createAutonomousEmulator}=await loadAutonomousEmulator(),scheduler=createManualScheduler(),session=createFakeSession();let reads=0;
 const emulator=createAutonomousEmulator({session,...scheduler,emulationSpeed:5,botFrameInput:()=>{reads++;return ['a'];}});
 const queued=emulator.execute({buttons:['b'],holdFrames:1,releaseFrames:0});scheduler.advance(20);await assert.rejects(queued,/frame controller/);
 scheduler.advance(100);const before=reads;emulator.setControlMode('manual');scheduler.advance(100);assert.equal(reads,before);emulator.close();
});

test("decimating visible frames never slows the cartridge clock or controller frames", async () => {
  const { createAutonomousEmulator } = await loadAutonomousEmulator();
  for (const fps of [15, 30, 60]) {
    const scheduler = createManualScheduler(); const session = createFakeSession();
    const emulator = createAutonomousEmulator({ session, ...scheduler, presentationFramesPerSecond: 60,
      emulationSpeed: 5, videoFramesPerSecond: fps });
    let delivered = 0; emulator.subscribe(() => { delivered++; });
    scheduler.advance(1000);
    assert.ok(session.frame >= 295 && session.frame <= 300);
    assert.ok(delivered >= fps - 1 && delivered <= fps + 1, `${fps}: delivered ${delivered}`);
    assert.equal(emulator.metrics().targetVideoFramesPerSecond, fps);
    emulator.close();
  }
});

test("a safety pause cancels active and retained input without advancing the cartridge", async () => {
  const { createAutonomousEmulator } = await loadAutonomousEmulator();
  const scheduler = createManualScheduler();
  const session = createFakeSession();
  let released = false;
  session.releaseButtons = () => { released = true; };
  const emulator = createAutonomousEmulator({ session, ...scheduler });
  const pending = emulator.execute({ kind: "bounded", buttons: ["a"], holdFrames: 8, releaseFrames: 1 });
  assert.equal(typeof emulator.pause, "function");
  emulator.pause("protected-encounter");
  assert.equal((await pending).interrupted, "protected-encounter");
  scheduler.advance(2000);
  assert.equal(session.frame, 0);
  assert.equal(released, true);
  assert.deepEqual(emulator.metrics().retainedButtons, []);
  assert.equal((await emulator.execute({ buttons: ["a"] })).interrupted, "paused");
  emulator.close();
});

test("bounded input cannot carry from an overworld action into a newly started battle", async () => {
  const { createAutonomousEmulator } = await loadAutonomousEmulator();
  const scheduler = createManualScheduler();
  const session = createFakeSession();
  const emulator = createAutonomousEmulator({ session, ...scheduler,
    controllerState: () => ({ inBattle: session.frame >= 1, callback2: session.frame >= 1 ? "BattleMainCB2" : "CB2_Overworld" }) });
  const pending = emulator.execute({ kind: "bounded", buttons: ["a"], holdFrames: 8, releaseFrames: 1 });
  scheduler.advance(200);
  assert.equal((await pending).interrupted, "cartridge-boundary-changed");
  assert.deepEqual(session.inputs[0], ["a"]);
  assert.ok(session.inputs.slice(1).every((buttons) => buttons.length === 0));
  emulator.close();
});

test("a fresh command replaces the previous retained command's boundary", async () => {
  const { createAutonomousEmulator } = await loadAutonomousEmulator();
  const scheduler = createManualScheduler();
  const session = createFakeSession();
  let callback2 = "CB2_Overworld";
  const emulator = createAutonomousEmulator({ session, ...scheduler,
    controllerState: () => ({ inBattle: false, callback2 }) });
  const retained = emulator.execute({ kind: "sustained-chord", buttons: ["right"], holdFrames: 1, releaseFrames: 0 });
  scheduler.advance(17);
  await retained;
  callback2 = "CB2_BagMenuRun";
  const fresh = emulator.execute({ kind: "bounded", buttons: ["b"], holdFrames: 1, releaseFrames: 1 });
  scheduler.advance(34);
  assert.equal((await fresh).interrupted, undefined);
  assert.deepEqual(session.inputs.slice(1), [["b"], []]);
  emulator.close();
});

test("the autonomous emulator advances five neutral cartridge frames per presentation tick", async () => {
  const { createAutonomousEmulator } = await loadAutonomousEmulator();
  assert.equal(typeof createAutonomousEmulator, "function");
  const scheduler = createManualScheduler();
  const session = createFakeSession();

  const emulator = createAutonomousEmulator({
    session,
    emulationSpeed: 5,
    presentationFramesPerSecond: 60,
    clock: scheduler.clock,
    schedule: scheduler.schedule,
    cancel: scheduler.cancel,
  });
  scheduler.advance(1_000);

  assert.equal(session.frame, 300);
  assert.equal(session.inputs.every((buttons) => buttons.length === 0), true);
  assert.deepEqual(emulator.metrics(), {
    targetPresentationFramesPerSecond: 60,
    targetVideoFramesPerSecond: 60,
    targetEmulatedFramesPerSecond: 300,
    emulationSpeed: 5,
    publishedFrames: 61,
    emulatedFrames: 300,
    sourceFrame: 300,
    subscribers: 0,
    busy: false,
    retainedButtons: [],
  });
  emulator.close();
});

test("manual control interrupts the bot and restores its configured speed after handoff", async () => {
  const { createAutonomousEmulator } = await loadAutonomousEmulator();
  const scheduler = createManualScheduler();
  const session = createFakeSession();
  const emulator = createAutonomousEmulator({
    session,
    emulationSpeed: 5,
    presentationFramesPerSecond: 60,
    clock: scheduler.clock,
    schedule: scheduler.schedule,
    cancel: scheduler.cancel,
  });
  const botAction = emulator.execute({
    kind: "sustained-chord",
    buttons: ["b", "right"],
    holdFrames: 4,
    releaseFrames: 0,
  });

  emulator.setControlMode("manual");

  assert.deepEqual(await botAction, {
    startFrame: 0,
    endFrame: 0,
    holdFrames: 4,
    releaseFrames: 0,
    interrupted: "manual-control",
  });
  assert.deepEqual(emulator.controlState(), {
    schema: "master-red/control-state/v1",
    mode: "manual",
    configuredEmulationSpeed: 5,
    effectiveEmulationSpeed: 1,
    manualSessionCount: 1,
    manualButtons: [],
  });
  scheduler.advance(17);
  assert.equal(session.frame, 1, "manual play advances at one cartridge frame per display tick");

  emulator.setControlMode("bot");
  const handoff = emulator.takeControlHandoff();
  assert.deepEqual(handoff, {
    schema: "master-red/manual-control-handoff/v1",
    session: 1,
    startedFrame: 0,
    endedFrame: 1,
    inputEvents: [],
  });
  scheduler.advance(17);
  assert.equal(session.frame, 6, "bot play returns to its configured five-times speed");
  emulator.close();
});

test("manual control latches simultaneous GBA buttons and records every change", async () => {
  const { createAutonomousEmulator } = await loadAutonomousEmulator();
  const scheduler = createManualScheduler();
  const session = createFakeSession();
  const emulator = createAutonomousEmulator({
    session,
    emulationSpeed: 5,
    presentationFramesPerSecond: 60,
    controllerState: () => ({
      frame: session.frame,
      mode: "overworld",
      callback2: "CB2_Overworld",
      inBattle: false,
      map: "MAP_ROUTE17",
      x: 13 + session.frame,
      y: 157,
      tileTransitionState: session.frame === 0 ? 0 : 1,
    }),
    clock: scheduler.clock,
    schedule: scheduler.schedule,
    cancel: scheduler.cancel,
  });

  emulator.setControlMode("manual");
  emulator.setManualButtons(["right", "a", "right"]);
  scheduler.advance(17);
  emulator.setManualButtons([]);
  emulator.setControlMode("bot");

  assert.deepEqual(session.inputs, [["a", "right"]]);
  const handoff = emulator.takeControlHandoff();
  assert.deepEqual(handoff.inputEvents, [
    { frame: 0, buttons: ["a", "right"] },
    { frame: 1, buttons: [] },
  ]);
  assert.deepEqual(handoff.trajectory, [
    {
      frame: 0,
      buttons: [],
      state: {
        frame: 0,
        mode: "overworld",
        callback2: "CB2_Overworld",
        inBattle: false,
        map: "MAP_ROUTE17",
        x: 13,
        y: 157,
        tileTransitionState: 0,
      },
    },
    {
      frame: 0,
      buttons: ["a", "right"],
      state: {
        frame: 0,
        mode: "overworld",
        callback2: "CB2_Overworld",
        inBattle: false,
        map: "MAP_ROUTE17",
        x: 13,
        y: 157,
        tileTransitionState: 0,
      },
    },
    {
      frame: 1,
      buttons: [],
      state: {
        frame: 1,
        mode: "overworld",
        callback2: "CB2_Overworld",
        inBattle: false,
        map: "MAP_ROUTE17",
        x: 14,
        y: 157,
        tileTransitionState: 1,
      },
    },
  ]);
  assert.throws(
    () => emulator.setManualButtons(["turbo"]),
    /manual input requires manual control|unknown GBA button/i,
  );
  emulator.close();
});

test("manual buttons fail safe to neutral when the browser heartbeat stops", async () => {
  const { createAutonomousEmulator } = await loadAutonomousEmulator();
  const scheduler = createManualScheduler();
  const session = createFakeSession();
  const emulator = createAutonomousEmulator({
    session,
    emulationSpeed: 5,
    presentationFramesPerSecond: 60,
    manualInputTimeoutMs: 50,
    clock: scheduler.clock,
    schedule: scheduler.schedule,
    cancel: scheduler.cancel,
  });

  emulator.setControlMode("manual");
  emulator.setManualButtons(["right"]);
  scheduler.advance(49);
  emulator.setManualButtons(["right"]); // Same-state heartbeat renews the lease.
  scheduler.advance(49);
  assert.equal(session.inputs.every((buttons) => buttons[0] === "right"), true);

  scheduler.advance(51);
  assert.deepEqual(session.inputs.at(-1), []);
  assert.deepEqual(emulator.controlState().manualButtons, []);
  emulator.close();
});

test("a sustained chord stays held between commands, turns without releasing B, and stops on a bounded edge", async () => {
  const { createAutonomousEmulator } = await loadAutonomousEmulator();
  const scheduler = createManualScheduler();
  const session = createFakeSession();
  const emulator = createAutonomousEmulator({
    session,
    emulationSpeed: 5,
    presentationFramesPerSecond: 60,
    clock: scheduler.clock,
    schedule: scheduler.schedule,
    cancel: scheduler.cancel,
  });

  const east = emulator.execute({
    kind: "sustained-chord",
    buttons: ["b", "right"],
    holdFrames: 2,
    releaseFrames: 0,
  });
  scheduler.advance(17);
  assert.deepEqual(await east, {
    startFrame: 0,
    endFrame: 2,
    holdFrames: 2,
    releaseFrames: 0,
    retained: true,
  });
  assert.deepEqual(session.inputs.slice(0, 5), Array(5).fill(["b", "right"]));
  assert.deepEqual(emulator.metrics().retainedButtons, ["b", "right"]);

  const north = emulator.execute({
    kind: "sustained-chord",
    buttons: ["b", "up"],
    holdFrames: 2,
    releaseFrames: 0,
  });
  scheduler.advance(17);
  await north;
  assert.deepEqual(session.inputs.slice(5, 10), Array(5).fill(["b", "up"]));
  assert.equal(session.inputs.some((buttons) => buttons.length === 0), false);

  const menuEdge = emulator.execute({
    kind: "bounded-edge",
    buttons: ["a"],
    holdFrames: 1,
    releaseFrames: 1,
  });
  scheduler.advance(17);
  await menuEdge;
  assert.deepEqual(session.inputs.slice(10, 15), [["a"], [], [], [], []]);
  assert.deepEqual(emulator.metrics().retainedButtons, []);
  emulator.close();
});

test("a one-tile movement lease holds the chord through the stride and releases before another tile", async () => {
  const { createAutonomousEmulator } = await loadAutonomousEmulator();
  const scheduler = createManualScheduler();
  const session = createFakeSession();
  const state = {
    mode: "overworld",
    map: "MAP_ROUTE1",
    x: 7,
    y: 11,
    tileTransitionState: 0,
  };
  const step = session.step.bind(session);
  session.step = (buttons) => {
    const frame = step(buttons);
    if (frame === 8) {
      state.x = 8;
      state.tileTransitionState = 1;
    }
    if (frame === 16) state.tileTransitionState = 0;
    return frame;
  };
  const emulator = createAutonomousEmulator({
    session,
    emulationSpeed: 5,
    presentationFramesPerSecond: 60,
    controllerState: () => ({ ...state }),
    clock: scheduler.clock,
    schedule: scheduler.schedule,
    cancel: scheduler.cancel,
  });

  const movement = emulator.execute({
    kind: "sustained-chord",
    buttons: ["b", "right"],
    holdFrames: 4,
    releaseFrames: 0,
    movementLease: {
      kind: "one-tile",
      origin: { map: "MAP_ROUTE1", x: 7, y: 11 },
      maximumFrames: 60,
    },
  });
  scheduler.advance(100);

  assert.deepEqual(await movement, {
    startFrame: 0,
    endFrame: 16,
    holdFrames: 4,
    releaseFrames: 0,
    movementLease: "position-changed",
  });
  assert.deepEqual(session.inputs.slice(0, 8), Array(8).fill(["b", "right"]));
  assert.equal(
    session.inputs.slice(8).every((buttons) => buttons.length === 0),
    true,
  );
  assert.deepEqual(emulator.metrics().retainedButtons, []);
  emulator.close();
});

test("a verified one-tile corner changes direction without a neutral frame", async () => {
  const { createAutonomousEmulator } = await loadAutonomousEmulator();
  const scheduler = createManualScheduler();
  const session = createFakeSession();
  const state = {
    mode: "overworld",
    map: "MAP_ROUTE1",
    x: 7,
    y: 11,
    tileTransitionState: 0,
  };
  const step = session.step.bind(session);
  session.step = (buttons) => {
    const frame = step(buttons);
    if (frame === 8) {
      state.x = 8;
      state.tileTransitionState = 1;
    }
    if (frame === 16) state.tileTransitionState = 0;
    return frame;
  };
  const emulator = createAutonomousEmulator({
    session,
    emulationSpeed: 5,
    presentationFramesPerSecond: 60,
    controllerState: () => ({ ...state }),
    clock: scheduler.clock,
    schedule: scheduler.schedule,
    cancel: scheduler.cancel,
  });

  const movement = emulator.execute({
    kind: "sustained-chord",
    buttons: ["b", "right"],
    holdFrames: 4,
    releaseFrames: 0,
    movementLease: {
      kind: "one-tile",
      origin: { map: "MAP_ROUTE1", x: 7, y: 11 },
      maximumFrames: 60,
      continuationButtons: ["b", "up"],
    },
  });
  scheduler.advance(100);

  assert.deepEqual(await movement, {
    startFrame: 0,
    endFrame: 16,
    holdFrames: 4,
    releaseFrames: 0,
    movementLease: "position-changed",
    retained: true,
  });
  assert.deepEqual(session.inputs.slice(0, 8), Array(8).fill(["b", "right"]));
  assert.equal(
    session.inputs.slice(8).every((buttons) =>
      buttons.length === 2 && buttons[0] === "b" && buttons[1] === "up"
    ),
    true,
  );
  assert.equal(session.inputs.some((buttons) => buttons.length === 0), false);
  assert.deepEqual(emulator.metrics().retainedButtons, ["b", "up"]);
  emulator.close();
});

test("a blocked one-tile movement lease releases on its cartridge-frame limit", async () => {
  const { createAutonomousEmulator } = await loadAutonomousEmulator();
  const scheduler = createManualScheduler();
  const session = createFakeSession();
  const emulator = createAutonomousEmulator({
    session,
    emulationSpeed: 5,
    presentationFramesPerSecond: 60,
    controllerState: () => ({
      mode: "overworld",
      map: "MAP_ROUTE1",
      x: 7,
      y: 11,
      tileTransitionState: 0,
    }),
    clock: scheduler.clock,
    schedule: scheduler.schedule,
    cancel: scheduler.cancel,
  });

  const movement = emulator.execute({
    kind: "sustained-chord",
    buttons: ["b", "right"],
    holdFrames: 4,
    releaseFrames: 0,
    movementLease: {
      kind: "one-tile",
      origin: { map: "MAP_ROUTE1", x: 7, y: 11 },
      maximumFrames: 12,
    },
  });
  scheduler.advance(100);

  assert.equal((await movement).movementLease, "frame-limit");
  assert.deepEqual(session.inputs.slice(0, 12), Array(12).fill(["b", "right"]));
  assert.equal(
    session.inputs.slice(12).every((buttons) => buttons.length === 0),
    true,
  );
  assert.deepEqual(emulator.metrics().retainedButtons, []);
  emulator.close();
});

test("a route segment holds the running chord through intermediate tiles and releases at its exact waypoint", async () => {
  const { createAutonomousEmulator } = await loadAutonomousEmulator();
  const scheduler = createManualScheduler();
  const session = createFakeSession();
  const state = {
    mode: "overworld",
    map: "MAP_ROUTE1",
    x: 1,
    y: 11,
    tileTransitionState: 0,
  };
  const step = session.step.bind(session);
  session.step = (buttons) => {
    const frame = step(buttons);
    if (frame === 8) state.x = 2;
    if (frame === 16) state.x = 3;
    if (frame === 24) {
      state.x = 4;
      state.tileTransitionState = 1;
    }
    if (frame === 32) state.tileTransitionState = 0;
    return frame;
  };
  const emulator = createAutonomousEmulator({
    session,
    emulationSpeed: 5,
    presentationFramesPerSecond: 60,
    controllerState: () => ({ ...state }),
    clock: scheduler.clock,
    schedule: scheduler.schedule,
    cancel: scheduler.cancel,
  });

  const movement = emulator.execute({
    kind: "sustained-chord",
    buttons: ["b", "right"],
    holdFrames: 4,
    releaseFrames: 0,
    movementLease: {
      kind: "route-segment",
      origin: { map: "MAP_ROUTE1", x: 1, y: 11 },
      target: { map: "MAP_ROUTE1", x: 4, y: 11 },
      maximumFrames: 100,
      stallFrames: 60,
    },
  });
  scheduler.advance(150);

  assert.deepEqual(await movement, {
    startFrame: 0,
    endFrame: 32,
    holdFrames: 4,
    releaseFrames: 0,
    movementLease: "target-reached",
  });
  assert.deepEqual(session.inputs.slice(0, 24), Array(24).fill(["b", "right"]));
  assert.equal(
    session.inputs.slice(24).every((buttons) => buttons.length === 0),
    true,
  );
  assert.deepEqual(emulator.metrics().retainedButtons, []);
  emulator.close();
});

test("a route segment queues its verified corner without releasing the running chord", async () => {
  const { createAutonomousEmulator } = await loadAutonomousEmulator();
  const scheduler = createManualScheduler();
  const session = createFakeSession();
  const state = {
    mode: "overworld",
    map: "MAP_ROUTE1",
    x: 1,
    y: 11,
    tileTransitionState: 0,
  };
  const step = session.step.bind(session);
  session.step = (buttons) => {
    const frame = step(buttons);
    if (frame === 8) state.x = 2;
    if (frame === 16) state.x = 3;
    if (frame === 24) {
      state.x = 4;
      state.tileTransitionState = 1;
    }
    if (frame === 32) state.tileTransitionState = 0;
    return frame;
  };
  const emulator = createAutonomousEmulator({
    session,
    emulationSpeed: 5,
    presentationFramesPerSecond: 60,
    controllerState: () => ({ ...state }),
    clock: scheduler.clock,
    schedule: scheduler.schedule,
    cancel: scheduler.cancel,
  });

  const movement = emulator.execute({
    kind: "sustained-chord",
    buttons: ["b", "right"],
    holdFrames: 4,
    releaseFrames: 0,
    movementLease: {
      kind: "route-segment",
      origin: { map: "MAP_ROUTE1", x: 1, y: 11 },
      target: { map: "MAP_ROUTE1", x: 4, y: 11 },
      maximumFrames: 100,
      stallFrames: 60,
      continuationButtons: ["b", "up"],
    },
  });
  scheduler.advance(150);

  assert.deepEqual(await movement, {
    startFrame: 0,
    endFrame: 32,
    holdFrames: 4,
    releaseFrames: 0,
    movementLease: "target-reached",
    retained: true,
  });
  assert.deepEqual(session.inputs.slice(0, 24), Array(24).fill(["b", "right"]));
  assert.equal(
    session.inputs.slice(24).every((buttons) =>
      buttons.length === 2 && buttons[0] === "b" && buttons[1] === "up"
    ),
    true,
  );
  assert.equal(session.inputs.some((buttons) => buttons.length === 0), false);
  assert.deepEqual(emulator.metrics().retainedButtons, ["b", "up"]);
  emulator.close();
});

test("a full route lease executes every verified turn without a neutral frame", async () => {
  const { createAutonomousEmulator } = await loadAutonomousEmulator();
  const scheduler = createManualScheduler();
  const session = createFakeSession();
  const state = {
    mode: "overworld",
    map: "MAP_ROUTE_PLAN",
    x: 1,
    y: 4,
    tileTransitionState: 0,
  };
  const step = session.step.bind(session);
  session.step = (buttons) => {
    const frame = step(buttons);
    if (frame === 8) state.x = 2;
    if (frame === 16) state.x = 3;
    if (frame === 24) {
      state.x = 4;
      state.tileTransitionState = 1;
    }
    if (frame === 32) state.y = 3;
    if (frame === 40) state.y = 2;
    if (frame === 48) state.tileTransitionState = 0;
    return frame;
  };
  const emulator = createAutonomousEmulator({
    session,
    emulationSpeed: 5,
    presentationFramesPerSecond: 60,
    controllerState: () => ({ ...state }),
    clock: scheduler.clock,
    schedule: scheduler.schedule,
    cancel: scheduler.cancel,
  });

  const movement = emulator.execute({
    kind: "sustained-chord",
    buttons: ["b", "right"],
    holdFrames: 4,
    releaseFrames: 0,
    movementLease: {
      kind: "route-plan",
      origin: { map: "MAP_ROUTE_PLAN", x: 1, y: 4 },
      target: { map: "MAP_ROUTE_PLAN", x: 4, y: 2 },
      segments: [
        {
          direction: "east",
          target: { map: "MAP_ROUTE_PLAN", x: 4, y: 4 },
        },
        {
          direction: "north",
          target: { map: "MAP_ROUTE_PLAN", x: 4, y: 2 },
        },
      ],
      mapRevision: "a".repeat(64),
      maximumFrames: 180,
      stallFrames: 60,
    },
  });
  scheduler.advance(200);

  assert.deepEqual(await movement, {
    startFrame: 0,
    endFrame: 48,
    holdFrames: 4,
    releaseFrames: 0,
    movementLease: "target-reached",
  });
  assert.deepEqual(session.inputs.slice(0, 24), Array(24).fill(["b", "right"]));
  assert.deepEqual(session.inputs.slice(24, 40), Array(16).fill(["b", "up"]));
  assert.equal(session.inputs.slice(0, 40).some((buttons) => buttons.length === 0), false);
  assert.equal(session.inputs.slice(40).every((buttons) => buttons.length === 0), true);
  emulator.close();
});

test("a Cycling Road route brakes at its final tile without sliding during the next decision", async () => {
  const { createAutonomousEmulator } = await loadAutonomousEmulator();
  const scheduler = createManualScheduler();
  const session = createFakeSession();
  const state = { mode: "overworld", inBattle: false, map: "MAP_ROUTE17", x: 1, y: 4, tileTransitionState: 0 };
  let movingFrames = 0;
  const step = session.step.bind(session);
  session.step = (buttons) => {
    const frame = step(buttons);
    if (state.inBattle) return frame;
    if (movingFrames > 0) {
      movingFrames -= 1;
      return frame;
    }
    // Like the cartridge, coordinates change before the tile animation ends.
    // Releasing every button starts another downhill step; B alone stops it.
    const direction = ["up", "down", "left", "right"].find(b => buttons.includes(b)) ??
      (buttons.includes("b") ? null : "down");
    if (direction) {
      state.x += direction === "right" ? 1 : direction === "left" ? -1 : 0;
      state.y += direction === "down" ? 1 : direction === "up" ? -1 : 0;
      state.tileTransitionState = 1;
      movingFrames = 3;
    } else state.tileTransitionState = 0;
    return frame;
  };
  const emulator = createAutonomousEmulator({ session, emulationSpeed: 5,
    presentationFramesPerSecond: 60, controllerState: () => ({ ...state }),
    clock: scheduler.clock, schedule: scheduler.schedule, cancel: scheduler.cancel });
  const movement = emulator.execute({ kind: "sustained-chord", buttons: ["b", "up"],
    holdFrames: 4, releaseFrames: 0, movementLease: {
      kind: "route-plan", origin: { map: state.map, x: 1, y: 4 },
      target: { map: state.map, x: 3, y: 2 },
      segments: [
        { direction: "north", target: { map: state.map, x: 1, y: 2 } },
        { direction: "east", target: { map: state.map, x: 3, y: 2 } },
      ], mapRevision: "a".repeat(64), maximumFrames: 120, stallFrames: 20,
      continuationButtons: ["b"], stopButtons: ["b"],
    } });
  scheduler.advance(1000);
  const result = await movement;
  assert.equal(result.movementLease, "target-reached");
  assert.ok(result.endFrame < 30, "arrival settles promptly instead of sliding until the frame limit");
  assert.deepEqual({ x: state.x, y: state.y }, { x: 3, y: 2 });
  assert.deepEqual(emulator.metrics().retainedButtons, ["b"]);
  assert.ok(session.inputs.every(buttons => buttons.length > 0));
  state.inBattle = true;
  scheduler.advance(50);
  assert.deepEqual(session.inputs.at(-1), [], "the brake never leaks into battle");
  emulator.close();
});

for (const kind of ["route-plan", "route-segment"]) {
  test(`${kind} verifies its final position after arrival animation settles`, async()=>{
    const {createAutonomousEmulator}=await loadAutonomousEmulator();
    const scheduler=createManualScheduler(),session=createFakeSession();
    const state={mode:'overworld',map:'MAP_SLOPE',x:1,y:4,tileTransitionState:0,inBattle:false};
    const step=session.step.bind(session);
    session.step=buttons=>{
      const frame=step(buttons);
      // Touch the target, then coast back to the entry while the animation
      // remains active. That is the native Cycling Road failure pattern.
      state.y=[4,3,2,3,4][Math.min(frame,4)];
      state.tileTransitionState=frame<4?1:0;
      return frame;
    };
    const emulator=createAutonomousEmulator({session,...scheduler,emulationSpeed:10,frameExact:true,
      controllerState:()=>({...state})});
    const target={map:state.map,x:1,y:2};
    const pending=emulator.execute({kind:'sustained-chord',buttons:['up'],holdFrames:4,releaseFrames:0,
      movementLease:{kind,origin:{map:state.map,x:1,y:4},target,maximumFrames:90,stallFrames:20,
        ...(kind==='route-plan'?{segments:[{direction:'north',target}],mapRevision:'a'.repeat(64)}:{})}});
    scheduler.advance(1000);const result=await pending;emulator.close();
    assert.equal(result.movementLease,'route-diverged','touching a target is not a completed arrival');
    assert.equal(result.endFrame,4);
  });
}

for (const kind of ["route-plan", "route-segment"]) {
  test(`${kind} detects backtracking without progress and brakes before replanning`, async () => {
    const { createAutonomousEmulator } = await loadAutonomousEmulator();
    const scheduler = createManualScheduler();
    const session = createFakeSession();
    const state = { mode: "overworld", inBattle: false, map: "MAP_ROUTE17", x: 1, y: 10, tileTransitionState: 0 };
    const step = session.step.bind(session);
    session.step = buttons => {
      const frame = step(buttons);
      if (buttons.includes("up")) state.y = frame % 2 ? 9 : 10;
      else if (!buttons.includes("b")) state.y += 1;
      return frame;
    };
    const emulator = createAutonomousEmulator({ session, emulationSpeed: 5,
      presentationFramesPerSecond: 60, controllerState: () => ({ ...state }),
      clock: scheduler.clock, schedule: scheduler.schedule, cancel: scheduler.cancel });
    const target = { map: state.map, x: 1, y: 2 };
    const movement = emulator.execute({ kind: "sustained-chord", buttons: ["b", "up"],
      holdFrames: 4, releaseFrames: 0, movementLease: {
        kind, origin: { map: state.map, x: 1, y: 10 }, target,
        ...(kind === "route-plan" ? { segments: [{ direction: "north", target }], mapRevision: "a".repeat(64) } : {}),
        maximumFrames: 120, stallFrames: 12, stopButtons: ["b"],
      } });
    scheduler.advance(1000);
    const result = await movement;
    assert.equal(result.movementLease, "stalled");
    assert.equal(result.endFrame, 13);
    assert.equal(state.y, 9, "failed navigation holds its position for the next decision");
    assert.deepEqual(session.inputs.at(-1), ["b"]);
    emulator.close();
  });
}

for (const boundary of ["battle", "menu"]) {
  test(`a Cycling Road arrival releases its brake when ${boundary} starts during the tile animation`, async () => {
    const { createAutonomousEmulator } = await loadAutonomousEmulator();
    const scheduler = createManualScheduler();
    const session = createFakeSession();
    const state = { mode: "overworld", inBattle: false, map: "MAP_ROUTE17", x: 1, y: 4, tileTransitionState: 1 };
    const step = session.step.bind(session);
    session.step = buttons => {
      const frame = step(buttons);
      if (frame === 1) state.y = 2;
      if (frame === 2) {
        if (boundary === "battle") state.inBattle = true;
        else state.mode = "other";
      }
      if (frame === 3) state.tileTransitionState = 0;
      return frame;
    };
    const emulator = createAutonomousEmulator({ session, emulationSpeed: 5,
      presentationFramesPerSecond: 60, controllerState: () => ({ ...state }),
      clock: scheduler.clock, schedule: scheduler.schedule, cancel: scheduler.cancel });
    const target = { map: state.map, x: 1, y: 2 };
    const movement = emulator.execute({ kind: "sustained-chord", buttons: ["b", "up"],
      holdFrames: 4, releaseFrames: 0, movementLease: {
        kind: "route-plan", origin: { map: state.map, x: 1, y: 4 }, target,
        segments: [{ direction: "north", target }], mapRevision: "a".repeat(64),
        maximumFrames: 120, stallFrames: 20, continuationButtons: ["b"], stopButtons: ["b"],
      } });
    scheduler.advance(100);
    assert.equal((await movement).movementLease, "mode-changed");
    assert.deepEqual(session.inputs.slice(0, 2), [["b", "up"], ["b"]]);
    assert.ok(session.inputs.slice(2).every(buttons => buttons.length === 0));
    emulator.close();
  });
}

test("a full route lease releases as soon as battle ownership begins", async () => {
  const { createAutonomousEmulator } = await loadAutonomousEmulator();
  const scheduler = createManualScheduler();
  const session = createFakeSession();
  const state = {
    mode: "overworld",
    inBattle: false,
    map: "MAP_ROUTE_PLAN",
    x: 1,
    y: 4,
    tileTransitionState: 0,
  };
  const step = session.step.bind(session);
  session.step = (buttons) => {
    const frame = step(buttons);
    if (frame === 8) {
      state.x = 2;
      state.inBattle = true;
    }
    return frame;
  };
  const emulator = createAutonomousEmulator({
    session,
    emulationSpeed: 5,
    presentationFramesPerSecond: 60,
    controllerState: () => ({ ...state }),
    clock: scheduler.clock,
    schedule: scheduler.schedule,
    cancel: scheduler.cancel,
  });

  const movement = emulator.execute({
    kind: "sustained-chord",
    buttons: ["b", "right"],
    holdFrames: 4,
    releaseFrames: 0,
    movementLease: {
      kind: "route-plan",
      origin: { map: "MAP_ROUTE_PLAN", x: 1, y: 4 },
      target: { map: "MAP_ROUTE_PLAN", x: 4, y: 2 },
      segments: [
        {
          direction: "east",
          target: { map: "MAP_ROUTE_PLAN", x: 4, y: 4 },
        },
        {
          direction: "north",
          target: { map: "MAP_ROUTE_PLAN", x: 4, y: 2 },
        },
      ],
      mapRevision: "a".repeat(64),
      maximumFrames: 180,
      stallFrames: 60,
    },
  });
  scheduler.advance(300);

  assert.deepEqual(await movement, {
    startFrame: 0,
    endFrame: 8,
    holdFrames: 4,
    releaseFrames: 0,
    movementLease: "mode-changed",
  });
  assert.deepEqual(session.inputs.slice(0, 8), Array(8).fill(["b", "right"]));
  assert.equal(session.inputs.slice(8).every((buttons) => buttons.length === 0), true);
  emulator.close();
});

test("a map-connection lease holds running through the callback handoff", async () => {
  const { createAutonomousEmulator } = await loadAutonomousEmulator();
  const scheduler = createManualScheduler();
  const session = createFakeSession();
  const state = {
    mode: "overworld",
    inBattle: false,
    map: "MAP_VIRIDIAN_CITY",
    x: 17,
    y: 0,
    tileTransitionState: 0,
  };
  const step = session.step.bind(session);
  session.step = (buttons) => {
    const frame = step(buttons);
    if (frame === 8) state.mode = "other";
    if (frame === 16) {
      state.map = "MAP_ROUTE2";
      state.y = 31;
    }
    if (frame === 24) {
      state.mode = "overworld";
      state.tileTransitionState = 1;
    }
    if (frame === 32) state.tileTransitionState = 0;
    return frame;
  };
  const emulator = createAutonomousEmulator({
    session,
    emulationSpeed: 5,
    presentationFramesPerSecond: 60,
    controllerState: () => ({ ...state }),
    clock: scheduler.clock,
    schedule: scheduler.schedule,
    cancel: scheduler.cancel,
  });

  const movement = emulator.execute({
    kind: "sustained-chord",
    buttons: ["b", "up"],
    holdFrames: 4,
    releaseFrames: 0,
    movementLease: {
      kind: "map-connection",
      origin: { map: "MAP_VIRIDIAN_CITY", x: 17, y: 0 },
      destinationMap: "MAP_ROUTE2",
      maximumFrames: 180,
      continuationButtons: ["b", "up"],
    },
  });
  scheduler.advance(150);

  assert.deepEqual(await movement, {
    startFrame: 0,
    endFrame: 32,
    holdFrames: 4,
    releaseFrames: 0,
    movementLease: "destination-reached",
    retained: true,
  });
  assert.equal(
    session.inputs.every((buttons) =>
      buttons.length === 2 && buttons[0] === "b" && buttons[1] === "up"
    ),
    true,
  );
  assert.deepEqual(emulator.metrics().retainedButtons, ["b", "up"]);
  emulator.close();
});

test("a blocked route segment releases after its stationary cartridge-frame budget", async () => {
  const { createAutonomousEmulator } = await loadAutonomousEmulator();
  const scheduler = createManualScheduler();
  const session = createFakeSession();
  const emulator = createAutonomousEmulator({
    session,
    emulationSpeed: 5,
    presentationFramesPerSecond: 60,
    controllerState: () => ({
      mode: "overworld",
      map: "MAP_ROUTE1",
      x: 1,
      y: 11,
      tileTransitionState: 0,
    }),
    clock: scheduler.clock,
    schedule: scheduler.schedule,
    cancel: scheduler.cancel,
  });

  const movement = emulator.execute({
    kind: "sustained-chord",
    buttons: ["b", "right"],
    holdFrames: 4,
    releaseFrames: 0,
    movementLease: {
      kind: "route-segment",
      origin: { map: "MAP_ROUTE1", x: 1, y: 11 },
      target: { map: "MAP_ROUTE1", x: 4, y: 11 },
      maximumFrames: 100,
      stallFrames: 12,
    },
  });
  scheduler.advance(100);

  assert.equal((await movement).movementLease, "stalled");
  assert.deepEqual(session.inputs.slice(0, 12), Array(12).fill(["b", "right"]));
  assert.equal(
    session.inputs.slice(12).every((buttons) => buttons.length === 0),
    true,
  );
  emulator.close();
});

test("the autonomous emulator rejects malformed sustained controller commands", async () => {
  const { createAutonomousEmulator } = await loadAutonomousEmulator();
  const scheduler = createManualScheduler();
  const emulator = createAutonomousEmulator({
    session: createFakeSession(),
    clock: scheduler.clock,
    schedule: scheduler.schedule,
    cancel: scheduler.cancel,
  });

  const emptyChord = emulator.execute({
      kind: "sustained-chord",
      buttons: [],
      holdFrames: 4,
      releaseFrames: 0,
    });
  scheduler.advance(100);
  await assert.rejects(
    emptyChord,
    /sustained.*button/i,
  );
  const releasingChord = emulator.execute({
      kind: "sustained-chord",
      buttons: ["b", "right"],
      holdFrames: 4,
      releaseFrames: 1,
    });
  scheduler.advance(100);
  await assert.rejects(
    releasingChord,
    /release.*zero/i,
  );
  emulator.close();
});

test("controller commands hold and release for cartridge frames without owning the clock", async () => {
  const { createAutonomousEmulator } = await loadAutonomousEmulator();
  const scheduler = createManualScheduler();
  const session = createFakeSession();
  const emulator = createAutonomousEmulator({
    session,
    emulationSpeed: 5,
    presentationFramesPerSecond: 60,
    clock: scheduler.clock,
    schedule: scheduler.schedule,
    cancel: scheduler.cancel,
  });

  const completed = emulator.execute({
    buttons: ["a"],
    holdFrames: 2,
    releaseFrames: 2,
  });
  assert.equal(emulator.metrics().busy, true);
  scheduler.advance(17);

  assert.deepEqual(await completed, {
    startFrame: 0,
    endFrame: 4,
    holdFrames: 2,
    releaseFrames: 2,
  });
  assert.deepEqual(session.inputs.slice(0, 5), [["a"], ["a"], [], [], []]);

  scheduler.advance(983);
  assert.equal(session.frame, 300, "the emulator keeps running after the button command ends");
  assert.equal(session.inputs.slice(5).every((buttons) => buttons.length === 0), true);
  emulator.close();
});

test("a suspended worker rebases its deadline instead of bursting old presentation frames", async () => {
  const { createAutonomousEmulator } = await loadAutonomousEmulator();
  const scheduler = createManualScheduler();
  const session = createFakeSession();
  const emulator = createAutonomousEmulator({
    session,
    emulationSpeed: 5,
    presentationFramesPerSecond: 60,
    clock: scheduler.clock,
    schedule: scheduler.schedule,
    cancel: scheduler.cancel,
  });

  scheduler.runOneAfterStall(1_000);

  assert.equal(session.frame, 5);
  assert.ok(scheduler.nextDueAt() > 1_000, "the next frame remains evenly scheduled");
  emulator.close();
});


test('radio backpressure holds the cartridge without consuming input or accumulating catch-up frames',async()=>{
 const {createAutonomousEmulator}=await loadAutonomousEmulator(),scheduler=createManualScheduler(),session=createFakeSession();
 let allowed=false;
 const emulator=createAutonomousEmulator({session,...scheduler,presentationFramesPerSecond:60,canAdvanceFrame:()=>allowed});
 const action=emulator.execute({buttons:['a'],holdFrames:3,releaseFrames:2});
 let done=false;action.then(()=>{done=true;});
 scheduler.advance(1200);await Promise.resolve();
 assert.equal(session.frame,0);assert.equal(done,false);assert.notEqual(emulator.controlState().paused,true);
 allowed=true;scheduler.advance(17);assert.equal(session.frame,1);
 allowed=false;scheduler.advance(1000);assert.equal(session.frame,1);
 allowed=true;scheduler.advance(90);await action;
 assert.deepEqual(session.inputs.slice(0,5),[['a'],['a'],['a'],[],[]]);
 emulator.close();
});
