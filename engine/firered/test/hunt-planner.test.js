import assert from "node:assert/strict";
import test from "node:test";
import { createHuntPlanner } from "../src/player/hunt-planner.js";
import { validateHuntConfig } from "../src/player/hunt-config.js";
import { createPolicyAdvisors } from "../src/player/advisors.js";
import { createCentralPlayer } from "../src/player/delegator.js";

const cells = Array.from({ length: 24 }, (_, i) => ({ x: i % 8, y: Math.floor(i / 8),
  collision: Math.floor(i / 8) === 1 ? 0 : 1, elevation: 3, encounterType: 1,
  behaviorName: "MB_TALL_GRASS", metatileId: 13 }));
const world = { maps: [{ id: "MAP_ROUTE1", layout: { width: 8, height: 3, cells },
  objectEvents: [], coordEvents: [], warpEvents: [], connections: [], properties: { allow_running: true } }],
  wildEncounters: [{ map: "MAP_ROUTE1", base_label: "sRoute1_FireRed", land_mons: { encounter_rate: 21,
    mons: Array.from({ length: 12 }, (_, i) => ({ species: i < 6 ? "SPECIES_PIDGEY" : "SPECIES_RATTATA", min_level: 2, max_level: 5 })) } }] };
const mechanics = { species: { 16: { id: 16, name: "SPECIES_PIDGEY" }, 19: { id: 19, name: "SPECIES_RATTATA" } } };
function observation(frame = 1, hp = 50) {
  const captureId = `hunt-${frame}`;
  return { frame, captureId, phase: "stable", phaseReasons: [],
    emulator: { frame, captureId, mode: "overworld", inBattle: false, inputReady: true },
    sram: { frame, captureId, sha256: "save" }, playerMemory: { frame, captureId,
      encounter: null, map: { id: "MAP_ROUTE1" }, position: { x: 0, y: 1 }, ui: {},
      trainer: { partyValidity: "valid", partyCount: 1, usablePartyCount: 1,
        party: [{ validity: "valid", slot: 0, species: 4, level: 15, hp, maxHp: 50, moves: [33], pp: [35] }],
        bag: { pokeBalls: [{ itemId: 4, quantity: 25 }] } } } };
}
const config = validateHuntConfig({ observeOnly: false });

test("ordinary hunting reuses full-route navigation without campaign collection, training or team reshuffling", () => {
  const planner = createHuntPlanner({ world, mechanics, config });
  const observed = observation();
  assert.equal(planner.safetyCheck(observed), null);
  assert.equal(planner.selectTraining(observed), null);
  assert.equal(planner.selectCollection(observed), null);
  assert.deepEqual(planner.selectBattleSquad(observed), []);
  const player = createCentralPlayer({ huntConfig: config, campaignPlanner: planner,
    advisors: createPolicyAdvisors({ world, mechanics, campaignPlanner: planner }) });
  const result = player.decide(observed);
  assert.equal(result.winner.advisor, "navigation");
  assert.equal(result.winner.recommendation.objective, "hunt:MAP_ROUTE1");
  assert.equal(result.action.movementLease.kind, "route-plan");
  assert.equal(result.action.movementLease.target.x, 7, "use the available grass corridor, not a one-tile oscillation");
});

test("hunting rejects species absent from the actual encounter table", () => {
  assert.throws(() => createHuntPlanner({ world, mechanics,
    config: validateHuntConfig({ targets: [{ required: { species: [150] } }] }) }), /unavailable/i);
});

test("hunting stops for missing resources or an unreachable free healer instead of spending medicine", () => {
  const planner = createHuntPlanner({ world, mechanics, config });
  assert.match(planner.safetyCheck(observation(1, 5)).reason, /healer/);
  const observed = observation(2); observed.playerMemory.trainer.bag.pokeBalls = [];
  assert.match(planner.safetyCheck(observed).reason, /balls/);
});

test("hunting detects an unproductive stationary loop and preserves its elapsed budget across restart", () => {
  const planner = createHuntPlanner({ world, mechanics, config });
  planner.safetyCheck(observation(1));
  const restored = createHuntPlanner({ world, mechanics, config, initialState: planner.state() });
  assert.equal(restored.safetyCheck(observation(4000)).reason, "hunt-no-progress-timeout");
});
