import assert from "node:assert/strict";
import test from "node:test";

import {
  ScenarioStepError,
  TransitionTimeoutError,
  executeBoundedAction,
  executeScenario,
  matchesObservation,
  resampleUntilStable,
  validateScenarioSuite,
} from "../src/evidence/scenario.js";

function observation({
  frame,
  phase = "stable",
  map = "MAP_VIRIDIAN_CITY",
  mode = "overworld",
  callback2 = "CB2_Overworld",
  inputReady = true,
  sramSha256 = "sram",
  savedGame = 0,
}) {
  const captureId = `capture-${frame}`;
  return {
    captureId,
    frame,
    phase,
    phaseReasons: phase === "stable" ? [] : [phase],
    emulator: { captureId, frame, mode, callback2, inputReady },
    sram: { captureId, frame, bytes: 3, sha256: sramSha256 },
    playerMemory: {
      captureId,
      frame,
      sha256: `memory-${frame}`,
      map: { id: map, group: map.endsWith("MART") ? 1 : 3, number: 1 },
      position: { x: 1, y: 2 },
      gameStats: { savedGame },
    },
  };
}

class FakeSession {
  constructor() {
    this.steps = [];
    this.loadedState = null;
    this.loadedSram = null;
    this.loads = [];
  }

  step(buttons) {
    this.steps.push([...buttons]);
  }

  loadState(bytes) {
    this.loads.push("state");
    this.loadedState = bytes.slice();
  }

  loadSram(bytes) {
    this.loads.push("sram");
    this.loadedSram = bytes.slice();
  }
}

function queuedObserver(observations) {
  const queue = [...observations];
  return {
    resetCount: 0,
    resetHistory() {
      this.resetCount += 1;
    },
    capture() {
      if (queue.length === 0) throw new Error("observation queue exhausted");
      return queue.shift();
    },
  };
}

test("serializable partial predicates match observations without executable code", () => {
  const sample = observation({ frame: 1 });
  assert.equal(
    matchesObservation(sample, {
      phase: "stable",
      emulator: { mode: "overworld" },
      playerMemory: { map: { id: "MAP_VIRIDIAN_CITY" } },
    }),
    true,
  );
  assert.equal(
    matchesObservation(sample, { playerMemory: { map: { id: "MAP_ROUTE1" } } }),
    false,
  );
  assert.throws(() => matchesObservation(sample, () => true), /serializable/i);
});

test("a bounded action stops on the first map interrupt and emits no later input", () => {
  const session = new FakeSession();
  const observer = queuedObserver([
    observation({ frame: 1 }),
    observation({ frame: 2 }),
    observation({
      frame: 3,
      phase: "transition",
      map: "MAP_VIRIDIAN_CITY_MART",
    }),
  ]);

  const result = executeBoundedAction({
    session,
    observer,
    action: { buttons: ["up"], maxFrames: 20 },
  });
  assert.equal(result.frames, 2);
  assert.deepEqual(result.interrupt, {
    kind: "interrupt",
    cause: "map-change",
    frame: 3,
  });
  assert.deepEqual(session.steps, [["up"], ["up"]]);
});

test("a bounded action can repeat an edge-triggered pulse within its frame budget", () => {
  const session = new FakeSession();
  const observer = queuedObserver([
    observation({ frame: 1 }),
    observation({ frame: 2 }),
    observation({ frame: 3 }),
    observation({ frame: 4 }),
    observation({ frame: 5 }),
    observation({ frame: 6 }),
  ]);

  const result = executeBoundedAction({
    session,
    observer,
    action: { buttons: ["a"], pulseEvery: 3, maxFrames: 5 },
  });

  assert.equal(result.interrupt.cause, "action-budget");
  assert.deepEqual(session.steps, [["a"], [], [], ["a"], []]);
});

test("transition and unknown observations resample neutrally to stable state", () => {
  const session = new FakeSession();
  const observer = queuedObserver([
    observation({ frame: 2, phase: "unknown" }),
    observation({ frame: 3 }),
    observation({ frame: 4 }),
  ]);
  const result = resampleUntilStable({
    session,
    observer,
    initialObservation: observation({ frame: 1, phase: "transition" }),
    maxFrames: 5,
    consecutiveStable: 2,
  });

  assert.equal(result.frames, 3);
  assert.equal(result.observation.frame, 4);
  assert.deepEqual(session.steps, [[], [], []]);
});

test("resampling waits for FireRed to acknowledge key release", () => {
  const session = new FakeSession();
  const observer = queuedObserver([
    observation({ frame: 2, inputReady: false }),
    observation({ frame: 3 }),
    observation({ frame: 4 }),
  ]);
  const result = resampleUntilStable({
    session,
    observer,
    initialObservation: observation({ frame: 1, inputReady: false }),
    maxFrames: 4,
    consecutiveStable: 2,
  });

  assert.equal(result.frames, 3);
  assert.equal(result.observation.frame, 4);
  assert.deepEqual(session.steps, [[], [], []]);
});

test("resampling has a hard frame budget", () => {
  const session = new FakeSession();
  const observer = queuedObserver([
    observation({ frame: 2, phase: "transition" }),
    observation({ frame: 3, phase: "unknown" }),
  ]);
  assert.throws(
    () =>
      resampleUntilStable({
        session,
        observer,
        initialObservation: observation({ frame: 1, phase: "transition" }),
        maxFrames: 2,
      }),
    TransitionTimeoutError,
  );
});

test("a scenario reports which step timed out while resampling", () => {
  const session = new FakeSession();
  const observer = queuedObserver([
    observation({ frame: 1 }),
    observation({ frame: 2, phase: "transition" }),
    observation({ frame: 3, phase: "transition" }),
    observation({ frame: 4, phase: "unknown" }),
  ]);

  assert.throws(
    () =>
      executeScenario({
        session,
        observer,
        scenario: {
          id: "center-heal",
          precondition: { phase: "stable" },
          steps: [
            {
              id: "start-nurse-script",
              action: { buttons: ["a"], maxFrames: 2 },
              expectedInterrupt: "transition",
              postcondition: { phase: "stable" },
              settle: { maxFrames: 2, consecutiveStable: 1 },
            },
          ],
        },
        seed: { state: Uint8Array.from([1]), sram: Uint8Array.from([2]) },
      }),
    (error) => {
      assert.ok(error instanceof ScenarioStepError);
      assert.equal(error.context.stage, "resample");
      assert.equal(error.context.stepId, "start-nurse-script");
      assert.equal(error.context.finalObservation.frame, 4);
      assert.equal(error.context.finalObservation.phase, "unknown");
      return true;
    },
  );
});

test("a Mart scenario is two central decisions separated by stable resampling", () => {
  const session = new FakeSession();
  const observer = queuedObserver([
    observation({ frame: 10 }),
    observation({
      frame: 11,
      phase: "transition",
      map: "MAP_VIRIDIAN_CITY_MART",
    }),
    observation({ frame: 12, map: "MAP_VIRIDIAN_CITY_MART" }),
    observation({ frame: 13, phase: "transition" }),
    observation({ frame: 14 }),
  ]);
  const scenario = {
    id: "mart-entry-roundtrip",
    precondition: { playerMemory: { map: { id: "MAP_VIRIDIAN_CITY" } } },
    steps: [
      {
        id: "enter",
        action: { buttons: ["up"], maxFrames: 8 },
        expectedInterrupt: "map-change",
        postcondition: {
          phase: "stable",
          playerMemory: { map: { id: "MAP_VIRIDIAN_CITY_MART" } },
        },
      },
      {
        id: "leave",
        action: { buttons: ["down"], maxFrames: 8 },
        expectedInterrupt: "map-change",
        postcondition: {
          phase: "stable",
          playerMemory: { map: { id: "MAP_VIRIDIAN_CITY" } },
        },
      },
    ],
    settle: { maxFrames: 10, consecutiveStable: 1 },
  };

  const result = executeScenario({
    session,
    observer,
    scenario,
    seed: {
      state: Uint8Array.from([1, 2]),
      sram: Uint8Array.from([3, 4]),
      stateSha256: "a".repeat(64),
      sramSha256: "b".repeat(64),
    },
  });
  assert.equal(result.success, true);
  assert.equal(result.interrupts, 2);
  assert.equal(result.finalObservation.frame, 14);
  assert.deepEqual(session.steps, [["up"], [], ["down"], []]);
  assert.deepEqual(session.loadedState, Uint8Array.from([1, 2]));
  assert.deepEqual(session.loadedSram, Uint8Array.from([3, 4]));
  assert.deepEqual(session.loads, ["sram", "state"]);
});

test("a scenario can prove SRAM mutation and one native-save increment", () => {
  const session = new FakeSession();
  const observer = queuedObserver([
    observation({ frame: 50, sramSha256: "before", savedGame: 12 }),
    observation({
      frame: 51,
      phase: "transition",
      mode: "start-menu",
      sramSha256: "after",
      savedGame: 13,
    }),
    observation({
      frame: 52,
      mode: "start-menu",
      sramSha256: "after",
      savedGame: 13,
    }),
  ]);
  const result = executeScenario({
    session,
    observer,
    scenario: {
      id: "native-save",
      precondition: { phase: "stable" },
      steps: [
        {
          id: "save",
          action: { buttons: ["a"], maxFrames: 4 },
          expectedInterrupt: "mode-change",
          postcondition: { phase: "stable", emulator: { mode: "start-menu" } },
        },
      ],
      settle: { maxFrames: 4, consecutiveStable: 1 },
      effects: { sramChanged: true, savedGameStatDelta: 1 },
    },
    seed: { state: Uint8Array.from([1]), sram: Uint8Array.from([2]) },
  });

  assert.deepEqual(result.effects, {
    sramChanged: true,
    savedGameStatDelta: 1,
  });
});

test("a scenario can prove native trainer-state effects", () => {
  const before = observation({ frame: 70 });
  before.playerMemory.trainer = {
    money: 1200,
    partyCount: 2,
    usablePartyCount: 1,
    party: [
      { slot: 0, species: 6, level: 40, hp: 12, maxHp: 120, moves: [10] },
      { slot: 1, species: 25, level: 20, hp: 0, maxHp: 55, moves: [20] },
    ],
    bag: { items: [{ itemId: 13, quantity: 2 }] },
  };
  const interrupted = observation({ frame: 71, phase: "transition" });
  interrupted.playerMemory.trainer = before.playerMemory.trainer;
  const after = observation({ frame: 72 });
  after.playerMemory.trainer = {
    money: 1000,
    partyCount: 2,
    usablePartyCount: 2,
    party: [
      { slot: 0, species: 6, level: 40, hp: 120, maxHp: 120, moves: [10] },
      { slot: 1, species: 25, level: 20, hp: 55, maxHp: 55, moves: [20] },
    ],
    bag: { items: [{ itemId: 13, quantity: 3 }] },
  };
  const result = executeScenario({
    session: new FakeSession(),
    observer: queuedObserver([before, interrupted, after]),
    scenario: {
      id: "native-trainer-effect",
      precondition: { phase: "stable" },
      steps: [
        {
          id: "complete-transaction",
          action: { buttons: ["a"], maxFrames: 4 },
          expectedInterrupt: "transition",
          postcondition: { phase: "stable" },
        },
      ],
      settle: { maxFrames: 4, consecutiveStable: 1 },
      effects: {
        moneyDelta: -200,
        totalPartyHpDelta: 163,
        usablePartyCountDelta: 1,
        partyCountDelta: 0,
        partyChanged: true,
        bagChanged: true,
        partyFullyHealed: true,
      },
    },
    seed: { state: Uint8Array.from([1]), sram: Uint8Array.from([2]) },
  });

  assert.deepEqual(result.effects, {
    sramChanged: false,
    savedGameStatDelta: 0,
    moneyDelta: -200,
    totalPartyHpDelta: 163,
    usablePartyCountDelta: 1,
    partyCountDelta: 0,
    partyChanged: true,
    bagChanged: true,
    partyFullyHealed: true,
  });
});

test("a native-save scenario rejects an unchanged SRAM image", () => {
  const session = new FakeSession();
  const observer = queuedObserver([
    observation({ frame: 60, sramSha256: "same", savedGame: 12 }),
    observation({
      frame: 61,
      phase: "transition",
      mode: "start-menu",
      sramSha256: "same",
      savedGame: 13,
    }),
    observation({
      frame: 62,
      mode: "start-menu",
      sramSha256: "same",
      savedGame: 13,
    }),
  ]);

  assert.throws(
    () =>
      executeScenario({
        session,
        observer,
        scenario: {
          id: "native-save",
          precondition: { phase: "stable" },
          steps: [
            {
              id: "save",
              action: { buttons: ["a"], maxFrames: 4 },
              expectedInterrupt: "mode-change",
              postcondition: {
                phase: "stable",
                emulator: { mode: "start-menu" },
              },
            },
          ],
          settle: { maxFrames: 4, consecutiveStable: 1 },
          effects: { sramChanged: true, savedGameStatDelta: 1 },
        },
        seed: { state: Uint8Array.from([1]), sram: Uint8Array.from([2]) },
      }),
    (error) => {
      assert.ok(error instanceof ScenarioStepError);
      assert.equal(error.context.stage, "effects");
      assert.equal(error.context.observedEffects.sramChanged, false);
      return true;
    },
  );
});

test("a failed step preserves compact observations needed to diagnose the block", () => {
  const initial = observation({ frame: 20 });
  const locked = observation({ frame: 21 });
  locked.playerMemory.activeTasks = [
    { slot: 3, function: "Task_EndQuestLog", priority: 80 },
  ];
  const stillLocked = observation({ frame: 22 });
  stillLocked.playerMemory.activeTasks = [
    { slot: 3, function: "Task_MapNamePopup", priority: 90 },
  ];
  stillLocked.playerMemory.ui = {
    startMenu: { cursor: 2, count: 7, selected: "bag" },
  };
  stillLocked.playerMemory.avatar = {
    objectEventId: 4,
    facing: "north",
    movementDirection: "north",
  };
  stillLocked.playerMemory.scripts = {
    globalStatus: "waiting",
    globalMode: "native",
    globalNative: "WaitForAorBPress",
    fieldControlsLocked: true,
  };
  stillLocked.playerMemory.trainer = {
    money: 54321,
    partyCount: 1,
    usablePartyCount: 1,
    party: [{ slot: 0, species: 6, hp: 80, maxHp: 100 }],
    bag: { items: [] },
  };
  stillLocked.emulator.inputReady = false;
  stillLocked.emulator.input = { heldKeysRaw: 0x80, newKeysRaw: 0 };
  const session = new FakeSession();
  const observer = queuedObserver([initial, locked, stillLocked]);

  assert.throws(
    () =>
      executeScenario({
        session,
        observer,
        scenario: {
          id: "start-menu-open-close",
          precondition: { phase: "stable" },
          steps: [
            {
              id: "open-start-menu",
              action: { buttons: ["start"], maxFrames: 2 },
              expectedInterrupt: "mode-change",
              postcondition: { emulator: { mode: "start-menu" } },
            },
          ],
        },
        seed: {
          state: Uint8Array.from([1]),
          sram: Uint8Array.from([2]),
        },
      }),
    (error) => {
      assert.ok(error instanceof ScenarioStepError);
      assert.equal(error.code, "SCENARIO_STEP_FAILED");
      assert.equal(error.context.stage, "interrupt");
      assert.equal(error.context.actionFrames, 2);
      assert.equal(error.context.interrupt.cause, "action-budget");
      assert.deepEqual(error.context.observedTaskFunctions, [
        "Task_EndQuestLog",
        "Task_MapNamePopup",
      ]);
      assert.equal(error.context.finalObservation.frame, 22);
      assert.deepEqual(error.context.finalObservation.playerMemory.ui, {
        startMenu: { cursor: 2, count: 7, selected: "bag" },
      });
      assert.deepEqual(error.context.finalObservation.playerMemory.gameStats, {
        savedGame: 0,
      });
      assert.deepEqual(error.context.finalObservation.playerMemory.avatar, {
        objectEventId: 4,
        facing: "north",
        movementDirection: "north",
      });
      assert.deepEqual(error.context.finalObservation.playerMemory.scripts, {
        globalStatus: "waiting",
        globalMode: "native",
        globalNative: "WaitForAorBPress",
        fieldControlsLocked: true,
      });
      assert.deepEqual(error.context.finalObservation.playerMemory.trainer, {
        money: 54321,
        partyCount: 1,
        usablePartyCount: 1,
        party: [{ slot: 0, species: 6, hp: 80, maxHp: 100 }],
        bag: { items: [] },
      });
      assert.deepEqual(error.context.finalObservation.sram, {
        sha256: "sram",
      });
      assert.equal(error.context.finalObservation.emulator.inputReady, false);
      assert.deepEqual(error.context.finalObservation.emulator.input, {
        heldKeysRaw: 0x80,
        newKeysRaw: 0,
      });
      return true;
    },
  );
});

test("a failed postcondition reports the mode that actually settled", () => {
  const session = new FakeSession();
  const observer = queuedObserver([
    observation({ frame: 30 }),
    observation({ frame: 31, mode: "party", callback2: "CB2_UpdatePartyMenu" }),
    observation({ frame: 32, mode: "party", callback2: "CB2_UpdatePartyMenu" }),
  ]);

  assert.throws(
    () =>
      executeScenario({
        session,
        observer,
        scenario: {
          id: "bag-menu-roundtrip",
          precondition: { phase: "stable" },
          steps: [
            {
              id: "select-bag",
              action: { buttons: ["a"], maxFrames: 4 },
              expectedInterrupt: "mode-change",
              postcondition: { phase: "stable", emulator: { mode: "bag" } },
            },
          ],
          settle: { maxFrames: 4, consecutiveStable: 2 },
        },
        seed: {
          state: Uint8Array.from([1]),
          sram: Uint8Array.from([2]),
        },
      }),
    (error) => {
      assert.ok(error instanceof ScenarioStepError);
      assert.equal(error.context.stage, "postcondition");
      assert.equal(error.context.actionFrames, 1);
      assert.equal(error.context.resampleFrames, 1);
      assert.equal(error.context.finalObservation.emulator.mode, "party");
      return true;
    },
  );
});

test("a complete suite covers every declared transition at its minimum trials", () => {
  const transitions = {
    scenarios: [
      { id: "one", minimumSuccessfulTraces: 1 },
      { id: "three", minimumSuccessfulTraces: 3 },
    ],
  };
  const valid = {
    schema: "master-red/mgba-scenario-suite/v1",
    scenarios: [
      { id: "one", trials: 1, seed: {}, steps: [{}] },
      { id: "three", trials: 3, seed: {}, steps: [{}] },
    ],
  };
  assert.doesNotThrow(() => validateScenarioSuite({ transitions, suite: valid }));

  const incomplete = structuredClone(valid);
  incomplete.scenarios.pop();
  assert.throws(
    () => validateScenarioSuite({ transitions, suite: incomplete }),
    /exactly cover/i,
  );
});

test("a multi-interaction class may bind one declared trial to each explicit variant", () => {
  const transitions = {
    scenarios: [{ id: "field-moves", minimumSuccessfulTraces: 3 }],
  };
  const suite = {
    schema: "master-red/mgba-scenario-suite/v1",
    scenarios: [
      {
        id: "field-moves",
        trials: 3,
        variants: [
          { id: "cut", seed: {}, steps: [{}] },
          { id: "surf", seed: {}, steps: [{}] },
          { id: "strength", seed: {}, steps: [{}] },
        ],
      },
    ],
  };

  assert.doesNotThrow(() => validateScenarioSuite({ transitions, suite }));

  const duplicate = structuredClone(suite);
  duplicate.scenarios[0].variants[2].id = "surf";
  assert.throws(
    () => validateScenarioSuite({ transitions, suite: duplicate }),
    /variant ids/i,
  );
});
