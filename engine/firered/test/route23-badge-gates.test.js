import assert from "node:assert/strict";
import test from "node:test";
import { campaignNavigationRecommendation, MAIN_STORY_CAMPAIGN } from "../src/player/campaign.js";

function fixture() {
  const source = { type: "trigger", script: "SoulBadgeGuard", var: "VAR_GATE", var_value: "4", x: 1, y: 0, elevation: 0 };
  const cells = Array.from({ length: 12 }, (_, i) => ({
    x: i % 4, y: Math.floor(i / 4), collision: i === 1 ? 1 : 0,
    elevation: i >= 8 ? 1 : 3, behaviorName: i >= 8 ? "MB_OCEAN_WATER" : "MB_NORMAL",
    terrain: i >= 8 ? 2 : 0,
  }));
  const map = { id: "MAP_ROUTE23", layout: { width: 4, height: 3, cells },
    objectEvents: [], warpEvents: [], connections: [],
    coordEvents: [source, { ...source, x: 2, y: 2, elevation: 1 }] };
  const observation = { phase: "stable", emulator: { mode: "overworld", inputReady: true },
    playerMemory: { map: { id: map.id }, position: { x: 2, y: 0 }, avatar: { surfing: false },
      storyState: { flagIds: { 2084: true }, variableIds: { 16479: 4 } },
      trainer: { party: [{ slot: 0, species: 117, hp: 131, moves: [57] }] } } };
  const objective = { id: "route23-badge-gate-5",
    target: { kind: "trigger", map: map.id, index: 0, equivalentTriggers: true } };
  const world = { data: { maps: [map] } };
  return { world, map, observation, objective };
}

test("Route 23 badge checks accept equivalent cartridge triggers without skipping a gate", () => {
  const gates = MAIN_STORY_CAMPAIGN.objectives.filter(x => /^route23-badge-gate-/.test(x.id));
  assert.equal(gates.length, 7);
  gates.forEach((gate, index) => {
    assert.equal(gate.target.equivalentTriggers, true);
    assert.equal(gate.completion.value, index + 2);
  });
});

test("an inaccessible badge trigger routes to a reachable equivalent, activates Surf, then reaches the real event", () => {
  const f = fixture();
  const approach = campaignNavigationRecommendation(f);
  assert.equal(approach?.kind, "move-toward");
  assert.equal(approach.direction, "south");
  f.observation.playerMemory.position.y = 1;
  const surf = campaignNavigationRecommendation(f);
  assert.equal(surf?.kind, "use-field-move");
  assert.equal(surf.fieldMove, "surf");
  f.observation.playerMemory.avatar.surfing = true;
  const crossing = campaignNavigationRecommendation(f);
  assert.equal(crossing?.kind, "move-toward");
  assert.deepEqual(crossing.target, { kind: "trigger", index: 1, x: 2, y: 2, script: "SoulBadgeGuard" });
  assert.equal(crossing.objective, f.objective.id);
  f.observation.playerMemory.position.y = 2;
  assert.equal(campaignNavigationRecommendation(f), null, "arrival waits for the cartridge script instead of wandering");
});

for (const [field, value] of [["script", "DifferentGuard"], ["var", "VAR_DIFFERENT_GATE"], ["var_value", "5"]]) {
  test(`equivalent badge routing excludes a different ${field}`, () => {
    const f = fixture();
    f.map.coordEvents[1][field] = value;
    assert.equal(campaignNavigationRecommendation(f), null);
  });
}

test("equivalent badge routing preserves Surf requirements and explicit single-trigger objectives", () => {
  const f = fixture();
  f.observation.playerMemory.storyState.flagIds[2084] = false;
  assert.equal(campaignNavigationRecommendation(f), null);
  f.observation.playerMemory.storyState.flagIds[2084] = true;
  delete f.objective.target.equivalentTriggers;
  assert.equal(campaignNavigationRecommendation(f), null);
});
