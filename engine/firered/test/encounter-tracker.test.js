import assert from "node:assert/strict";
import test from "node:test";
import { createEncounterTracker } from "../src/player/encounter-tracker.js";

function observation(frame, inBattle, pokemon = null) {
  return { frame, captureId: `c${frame}`, phase: "stable", emulator: { inBattle }, playerMemory: {
    encounter: inBattle ? { kind: "wild", validity: pokemon ? "valid" : "unknown", pokemon } : null } };
}
const mon = { validity: "valid", species: 16, personality: 8, otId: 99,
  ivs: { hp: 1, attack: 2, defense: 3, speed: 4, spAttack: 5, spDefense: 6 }, shiny: false };

test("encounter count follows battle occurrences, including identical PIDs in successive battles", () => {
  const tracker = createEncounterTracker();
  tracker.observe(observation(1, false));
  assert.equal(tracker.observe(observation(2, true)).event, null);
  const first = tracker.observe(observation(3, true, mon));
  assert.equal(first.event.kind, "encounter-identified");
  for (let frame = 4; frame < 20; frame++) assert.equal(tracker.observe(observation(frame, true, mon)).event, null);
  tracker.observe(observation(20, false));
  const second = tracker.observe(observation(21, true, mon));
  assert.notEqual(second.current.id, first.current.id);
  assert.equal(second.event.repeatedOutcome, true);
  assert.equal(tracker.state().totalEncounters, 2);
  assert.equal(tracker.state().identifiedEncounters, 2);
});

test("unreadable data and changed identity inside one battle do not manufacture new encounters", () => {
  const tracker = createEncounterTracker();
  tracker.observe(observation(1, true, mon));
  assert.equal(tracker.observe(observation(2, true)).validity, "unknown");
  assert.equal(tracker.observe(observation(3, true, { ...mon, personality: 9 })).validity, "unknown");
  assert.equal(tracker.state().totalEncounters, 1);
});

test("restore lineage is explicit; unexpected backwards frames are unknown, not fresh RNG attempts", () => {
  const first = createEncounterTracker();
  first.observe(observation(100, true, mon));
  const resumed = createEncounterTracker({ initialState: first.state() });
  assert.equal(resumed.observe(observation(101, true, mon)).event, null);
  assert.equal(resumed.observe(observation(10, true, mon)).validity, "unknown");
  resumed.beginRestore("isolated-replay-1");
  const restored = resumed.observe(observation(10, true, mon));
  assert.equal(restored.event.repeatedOutcome, true);
  assert.equal(restored.current.lineage, "isolated-replay-1");
});

test("the catching tutorial does not count stale or demonstration Pokémon as wild encounters", () => {
  const tracker = createEncounterTracker();
  for (const [frame, pokemon] of [[1, mon], [2, null], [700, { ...mon, species: 13, personality: 91 }]]) {
    const demo = observation(frame, true, pokemon);
    demo.playerMemory.encounter.kind = "tutorial";
    assert.equal(tracker.observe(demo).event, null);
  }
  assert.equal(tracker.state().totalEncounters, 0);
  assert.equal(tracker.state().identifiedEncounters, 0);
  tracker.observe(observation(701, false));
  assert.equal(tracker.observe(observation(702, true, mon)).event.kind, "encounter-identified");
  assert.equal(tracker.state().totalEncounters, 1);
});
