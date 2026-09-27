import assert from "node:assert/strict";
import test from "node:test";
import { createRngPredictionMonitor } from "../src/rng/prediction-monitor.js";
const slots = Array.from({ length: 12 }, () => ({ species: 16, minLevel: 2, maxLevel: 5 }));
const observed = (frame, inBattle = false, pokemon = null) => ({ frame, phase: "stable",
  emulator: { inBattle }, playerMemory: { map: { id: "MAP_ROUTE1" }, rng: { validity: "valid", mainState: 0, wildState: 0 },
    trainer: { otId: 0 }, encounter: inBattle ? { kind: "wild", validity: "valid", pokemon } : null } });

test("prediction-only reports a conditional candidate match without claiming synchronized control", () => {
  const monitor = createRngPredictionMonitor({ slots, map: "MAP_ROUTE1", maxAdvances: 1 });
  const forecast = monitor.observe(observed(1));
  assert.equal(forecast.validity, "conditional");
  assert.equal(forecast.inputGuidance, false);
  const result = monitor.observe(observed(2, true, { validity: "valid", species: 16, level: 4,
    personality: 4231227355, otId: 0, ivs: { hp: 12, attack: 25, defense: 27, speed: 30, spAttack: 2, spDefense: 31 } }));
  assert.equal(result.comparison, "candidate-consistent");
  assert.equal(result.validity, "conditional");
  assert.equal(result.synchronized, false);
});

test("forecast mismatch, missing data, stale frames and unsupported maps become unknown", () => {
  const monitor = createRngPredictionMonitor({ slots, map: "MAP_ROUTE1", maxAdvances: 1 });
  monitor.observe(observed(10));
  const mismatch = monitor.observe(observed(11, true, { validity: "valid", species: 19, personality: 8, otId: 0, ivs: {} }));
  assert.equal(mismatch.validity, "unknown");
  assert.equal(mismatch.comparison, "mismatch");
  assert.equal(monitor.observe(observed(12)).validity, "conditional", "fresh RNG readings can form a new conditional forecast");
  assert.equal(monitor.observe(observed(1)).validity, "unknown");
  const other = observed(15); other.playerMemory.map.id = "MAP_ROUTE2";
  assert.equal(monitor.observe(other).validity, "unknown");
});

test("prediction retains a small pre-generation history and labels the observed IV-gap variant", () => {
  const fixed = slots.map((slot) => ({ ...slot, minLevel: 3, maxLevel: 3 }));
  const monitor = createRngPredictionMonitor({ slots: fixed, map: "MAP_ROUTE1", maxAdvances: 1 });
  const before = observed(1); before.playerMemory.rng.mainState = 2676765209;
  monitor.observe(before);
  monitor.observe(observed(2)); // The field flag may remain set after generation.
  const actual = { validity: "valid", species: 16, level: 3, personality: 2565724235, otId: 0,
    ivs: { hp: 4, attack: 18, defense: 21, speed: 20, spAttack: 20, spDefense: 8 } };
  const comparison = monitor.observe(observed(3, true, actual));
  assert.equal(comparison.comparison, "candidate-consistent");
  assert.equal(comparison.forecastFrame, 1);
  assert.equal(comparison.predicted.ivGap, "between-ivs");
  assert.equal(comparison.synchronized, false);
});
