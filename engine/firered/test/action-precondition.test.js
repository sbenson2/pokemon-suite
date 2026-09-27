import assert from "node:assert/strict";
import test from "node:test";
import { actionPrecondition, actionPreconditionMatches } from "../src/emulator/action-precondition.js";
import { createEmulatorRequestHandler } from "../src/emulator/autonomous-emulator-worker-runtime.js";

const observed = { frame: 10, phase: "stable", emulator: { mode: "battle", inBattle: true, inputReady: true },
  playerMemory: { encounter: { validity: "valid", pokemon: { personality: 8, otId: 5, species: 16 } },
    battle: { turn: 0 }, ui: { battle: { stage: "action", cursor: 3 } } } };
test("action preconditions expire and reject a new opponent, cursor, phase or backwards frame", () => {
  const expected = actionPrecondition(observed);
  assert.equal(actionPreconditionMatches(expected, { ...observed, frame: 11 }), true);
  for (const next of [{ ...observed, frame: 9 }, { ...observed, frame: 99999 },
    { ...observed, phase: "transition" }, { ...observed, emulator: { ...observed.emulator, inputReady: false } },
    { ...observed, playerMemory: { ...observed.playerMemory, encounter: { validity: "unknown" } } },
    { ...observed, playerMemory: { ...observed.playerMemory, ui: { battle: { stage: "action", cursor: 1 } } } }]) {
    assert.equal(actionPreconditionMatches(expected, next), false);
  }
});

test("the worker rejects stale flee input before it reaches the sole input writer", async () => {
  let executed = false;
  const handler = createEmulatorRequestHandler({
    emulator: { execute: async () => { executed = true; }, metrics: () => ({}) },
    session: { frame: 11, saveState() {}, saveSram() {}, videoFrame() {} },
    observer: { capture: () => ({ ...observed, frame: 11, playerMemory: { ...observed.playerMemory,
      encounter: { validity: "valid", pokemon: { personality: 0, otId: 0, species: 19, shiny: true } } } }) },
  });
  const result = await handler("execute", { buttons: ["a"], precondition: actionPrecondition(observed) });
  assert.equal(result.interrupted, "stale-observation");
  assert.equal(executed, false);
});
