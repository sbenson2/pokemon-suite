import assert from "node:assert/strict";
import test from "node:test";

import {
  SeedStageTimeoutError,
  VIRIDIAN_MART_BOOTSTRAP_PROGRAM,
  createMartScenarioSuite,
  executeSeedProgram,
} from "../src/evidence/mart-seed.js";

function observation({
  frame,
  phase = "stable",
  callback2 = "CB2_Overworld",
  map = "MAP_VIRIDIAN_CITY",
  x = 36,
  y = 20,
}) {
  return {
    frame,
    phase,
    emulator: { callback2, mode: "overworld" },
    playerMemory: {
      map: { id: map },
      position: { x, y },
      saveFileStatus: 1,
    },
  };
}

class FakeSession {
  constructor() {
    this.steps = [];
  }

  step(buttons) {
    this.steps.push([...buttons]);
  }
}

function queuedObserver(values) {
  const queue = [...values];
  return {
    capture() {
      if (queue.length === 0) throw new Error("observation queue exhausted");
      return queue.shift();
    },
  };
}

test("a seed program uses bounded inputs and consecutive observation matches", () => {
  const session = new FakeSession();
  const observer = queuedObserver([
    observation({ frame: 1, phase: "transition" }),
    observation({ frame: 2 }),
    observation({ frame: 3 }),
    observation({
      frame: 4,
      phase: "transition",
      map: "MAP_VIRIDIAN_CITY_MART",
      x: 4,
      y: 7,
    }),
  ]);
  const result = executeSeedProgram({
    session,
    observer,
    program: [
      {
        id: "settle",
        buttons: [],
        until: { phase: "stable" },
        consecutiveMatches: 2,
        maxFrames: 3,
      },
      {
        id: "warp",
        buttons: ["up"],
        until: {
          playerMemory: { map: { id: "MAP_VIRIDIAN_CITY_MART" } },
        },
        maxFrames: 2,
      },
    ],
  });

  assert.deepEqual(session.steps, [[], [], [], ["up"]]);
  assert.deepEqual(
    result.stages.map(({ id, frames }) => ({ id, frames })),
    [
      { id: "settle", frames: 3 },
      { id: "warp", frames: 1 },
    ],
  );
  assert.equal(result.finalObservation.frame, 4);
});

test("pulsed seed input always releases the key between attempts", () => {
  const session = new FakeSession();
  const observer = queuedObserver([
    observation({ frame: 1, callback2: "CB2_TitleScreenRun" }),
    observation({ frame: 2, callback2: "CB2_TitleScreenRun" }),
    observation({ frame: 3, callback2: "CB2_TitleScreenRun" }),
    observation({ frame: 4, callback2: "CB2_InitMainMenu" }),
  ]);

  executeSeedProgram({
    session,
    observer,
    program: [
      {
        id: "press-start",
        buttons: ["start"],
        pulseEvery: 2,
        until: { emulator: { callback2: "CB2_InitMainMenu" } },
        maxFrames: 4,
      },
    ],
  });

  assert.deepEqual(session.steps, [["start"], [], ["start"], []]);
});

test("a stage does not press when the previous handoff already satisfies it", () => {
  const session = new FakeSession();
  const observer = queuedObserver([
    observation({ frame: 1, callback2: "CB2_BagMenuRun" }),
  ]);

  const result = executeSeedProgram({
    session,
    observer,
    program: [
      {
        id: "open-bag",
        buttons: ["a"],
        until: { emulator: { callback2: "CB2_BagMenuRun" } },
        maxFrames: 4,
      },
      {
        id: "select-already-highlighted-item",
        buttons: ["down"],
        until: { emulator: { callback2: "CB2_BagMenuRun" } },
        maxFrames: 4,
      },
    ],
  });

  assert.deepEqual(session.steps, [["a"]]);
  assert.equal(result.stages[1].frames, 0);
  assert.equal(result.finalObservation.frame, 1);
});

test("a seed stage can stop on either of two serializable observations", () => {
  const session = new FakeSession();
  const observer = queuedObserver([
    observation({ frame: 1, callback2: "CB2_LoadMap" }),
    observation({ frame: 2, callback2: "CB2_Overworld" }),
  ]);

  const result = executeSeedProgram({
    session,
    observer,
    program: [
      {
        id: "continue-save",
        buttons: ["a"],
        untilAny: [
          { emulator: { callback2: "CB2_SetUpOverworldForQLPlayback" } },
          {
            phase: "stable",
            emulator: { callback2: "CB2_Overworld", mode: "overworld" },
          },
        ],
        maxFrames: 4,
      },
    ],
  });

  assert.equal(result.stages[0].frames, 2);
  assert.equal(result.finalObservation.frame, 2);
  assert.deepEqual(session.steps, [["a"], ["a"]]);
});

test("a seed stage timeout names the bounded stage", () => {
  const session = new FakeSession();
  const observer = queuedObserver([
    observation({ frame: 1 }),
    observation({ frame: 2 }),
  ]);

  assert.throws(
    () =>
      executeSeedProgram({
        session,
        observer,
        program: [
          {
            id: "never",
            buttons: [],
            until: { playerMemory: { position: { x: 999 } } },
            maxFrames: 2,
          },
        ],
      }),
    (error) =>
      error instanceof SeedStageTimeoutError &&
      error.stageId === "never" &&
      error.maxFrames === 2,
  );
});

test("the pinned Mart bootstrap ends outside the door on a valid stock save", () => {
  const last = VIRIDIAN_MART_BOOTSTRAP_PROGRAM.at(-1);
  assert.equal(last.id, "settle-at-mart-exterior");
  assert.deepEqual(last.until, {
    phase: "stable",
    emulator: { callback2: "CB2_Overworld", mode: "overworld" },
    playerMemory: {
      map: { id: "MAP_VIRIDIAN_CITY" },
      position: { x: 36, y: 20 },
      saveFileStatus: 1,
    },
  });
  assert.equal(last.consecutiveMatches, 3);
});

test("a Mart scenario suite binds content-addressed real-mGBA seed files", () => {
  const stateSha256 = "a".repeat(64);
  const sramSha256 = "b".repeat(64);
  const traceSha256 = "c".repeat(64);
  const suite = createMartScenarioSuite({
    stateFile: `mart.${stateSha256}.state`,
    sramFile: `mart.${sramSha256}.sav`,
    stateSha256,
    sramSha256,
    provenance: {
      kind: "real-mgba-input-bootstrap",
      recipe: "viridian-mart-exterior/v1",
      traceSha256,
    },
  });

  assert.equal(suite.schema, "master-red/mgba-scenario-suite/v1");
  assert.equal(suite.scenarios.length, 1);
  const scenario = suite.scenarios[0];
  assert.equal(scenario.id, "mart-entry-roundtrip");
  assert.equal(scenario.trials, 100);
  assert.equal(scenario.seed.stateSha256, stateSha256);
  assert.equal(scenario.seed.sramSha256, sramSha256);
  assert.deepEqual(
    scenario.steps.map(({ id, action }) => ({ id, buttons: action.buttons })),
    [
      { id: "enter", buttons: ["up"] },
      { id: "leave", buttons: ["down"] },
    ],
  );
  assert.deepEqual(scenario.steps[1].postcondition.playerMemory.position, {
    x: 36,
    y: 20,
  });
});
