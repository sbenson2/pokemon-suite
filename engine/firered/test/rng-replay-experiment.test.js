import assert from "node:assert/strict";
import test from "node:test";
import { runFrameTrial, runReplayExperiment, validateReplayConfig } from "../src/rng/replay-experiment.js";

const mon = { validity: "valid", species: 19, personality: 8, otId: 0, shiny: false, level: 3,
  ivs: { hp: 1, attack: 2, defense: 3, speed: 4, spAttack: 5, spDefense: 6 } };
const config = () => validateReplayConfig({ path: [{ buttons: ["right"], frames: 8 }] });
function trialFixture({ shiny = false, initiallyInBattle = false } = {}) {
  const session = { frame: 10, inputs: [], released: 0,
    step(buttons) { this.inputs.push([...buttons]); this.frame++; },
    releaseButtons() { this.released++; },
    saveState: () => new Uint8Array([1]), saveSram: () => new Uint8Array([2]),
    videoFrame: () => ({ width: 1, height: 1, rgba: new Uint8Array(4) }) };
  const inBattle = () => initiallyInBattle || session.frame >= 12;
  const observer = {
    captureTimingState: () => ({ frame: session.frame, map: "MAP_ROUTE1", mode: inBattle() ? "other" : "overworld",
      callback2: inBattle() ? "BattleMainCB2" : "CB2_Overworld", inBattle: inBattle(), rng: { validity: "valid", mainState: 0, wildState: 0 } }),
    capture: () => ({ frame: session.frame, phase: "stable", emulator: { inBattle: inBattle(), mode: inBattle() ? "battle" : "overworld", inputReady: true },
      playerMemory: { map: { id: "MAP_ROUTE1" }, trainer: { otId: 0 }, rng: { validity: "valid", mainState: 0, wildState: 0 },
        encounter: inBattle() && session.frame >= 14 ? { validity: "valid", kind: "wild", pokemon: { ...mon, shiny, personality: shiny ? 0 : 8 } } : null } }),
  };
  return { session, observer };
}

test("replay config is bounded and cannot contain battle, menu, reset or memory-edit inputs", () => {
  assert.equal(config().mode, "replay");
  for (const input of [ { path: [{ buttons: ["a"], frames: 1 }] }, { path: [{ buttons: ["right"], frames: 5000 }] },
    { path: config().path, repeats: 100 }, { path: config().path, rngSeed: 123 },
    { path: config().path, waits: [0, 1] } ]) assert.throws(() => validateReplayConfig(input));
});

test("frame trials release walking at battle entry and never press through an uninitialized enemy", async () => {
  const fixture = trialFixture();
  const result = await runFrameTrial({ ...fixture, config: config(), waitFrames: 0 });
  assert.equal(result.status, "encounter");
  assert.equal(result.observation.frame, 14);
  assert.deepEqual(fixture.session.inputs, [["right"], ["right"], [], []]);
  assert.ok(fixture.session.released > 0);
});

test("frame programs reject starting in a battle and honor cancellation without another input", async () => {
  const fixture = trialFixture({ initiallyInBattle: true });
  assert.equal((await runFrameTrial({ ...fixture, config: config(), waitFrames: 0 })).reason, "unsupported-start-context");
  assert.equal(fixture.session.inputs.length, 0);
  const control = new AbortController(); control.abort();
  const fresh = trialFixture();
  assert.equal((await runFrameTrial({ ...fresh, config: config(), waitFrames: 0, signal: control.signal })).status, "cancelled");
  assert.equal(fresh.session.inputs.length, 0);
});

test("replaying an identical outcome is measured twice, not counted as independent luck", async () => {
  let opened = 0, closed = 0;
  const report = await runReplayExperiment({ config: config(),
    openTrial: async () => { opened++; return { ...trialFixture(), close: () => { closed++; } }; } });
  assert.equal(opened, 2);
  assert.equal(closed, 2);
  assert.equal(report.groups[0].reproducible, true);
  assert.equal(report.encounterEvents, 2);
  assert.equal(report.uniqueOutcomes, 1);
  assert.equal(report.selected, null, "replay-only mode does not pick favorable inputs");
});

test("any shiny ends the whole experiment before a restore, even outside requested filters", async () => {
  let opened = 0;
  const report = await runReplayExperiment({ config: validateReplayConfig({ mode: "guided", waits: [0, 1],
    path: config().path, target: { species: [16] } }),
    openTrial: async () => { opened++; return { ...trialFixture({ shiny: true }), close() {} }; } });
  assert.equal(opened, 1);
  assert.equal(report.status, "protected-shiny");
  assert.ok(report.preserved.state instanceof Uint8Array);
});

test("guided experiments select only an empirically repeated input plan, and remain isolated", async () => {
  const report = await runReplayExperiment({ config: validateReplayConfig({ mode: "guided", path: config().path,
    waits: [0, 1], target: { species: [19] } }),
    openTrial: async () => ({ ...trialFixture(), close() {} }) });
  assert.equal(report.selected.waitFrames, 0);
  assert.equal(report.selected.validity, "reproduced-isolated-plan");
  assert.equal(report.productionQualified, false);
});
