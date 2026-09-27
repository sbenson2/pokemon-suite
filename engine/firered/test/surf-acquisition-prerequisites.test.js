import assert from "node:assert/strict";
import test from "node:test";
import { createCampaignPlanner, createMasterCampaign } from "../src/player/campaign.js";
import { createMasterTeamPlan } from "../src/player/origins-team.js";

function fixture({ targetKind = "encounter-zone", map = "MAP_POWER_PLANT" } = {}) {
  const original = createMasterTeamPlan(7, 0);
  const acquisition = { ...original.acquisitions[4], id: "native-82", family: [81, 82],
    captureSpecies: 81, targetSpecies: 82, afterObjectiveId: "teach-surf",
    steps: [{ kind: "wild-capture", species: 81, maps: [map], targetKind }] };
  const families = [...original.permanentFamilies.slice(0, 5), [81, 82]];
  const teamPlan = { ...original, acquisitions: [...original.acquisitions.slice(0, 4), acquisition],
    permanentFamilies: families, fieldMoves: { ...original.fieldMoves, surf: [116, 117], strength: [7, 8, 9] },
    battlePlans: { ...original.battlePlans, "badge-soul": { ...original.battlePlans["badge-soul"],
      availableFamilies: families, preferredFamilies: [[81, 82], ...families.slice(0, 5)] } } };
  const observation = { phase: "stable", emulator: { mode: "overworld", inputReady: true },
    playerMemory: { map: { id: "MAP_FUCHSIA_CITY_MART" }, position: { x: 4, y: 3 },
      storyState: { flagIds: { 2080: true, 2081: true, 2082: true, 2083: true, 2084: false } },
      trainer: { party: [{ slot: 0, species: 34, level: 45, hp: 138, maxHp: 138, moves: [15] },
        { slot: 1, species: 45, level: 43, hp: 131, maxHp: 131, moves: [51] },
        { slot: 2, species: 9, level: 43, hp: 132, maxHp: 132, moves: [55] },
        { slot: 3, species: 18, level: 43, hp: 134, maxHp: 134, moves: [19] },
        { slot: 4, species: 116, level: 15, hp: 35, maxHp: 35, moves: [57] }],
        pokedex: { ownedSpecies: [7, 8, 9, 16, 17, 18, 32, 33, 34, 43, 44, 45, 116] },
        bag: { tmhm: [{ itemId: 341, quantity: 1 }, { itemId: 342, quantity: 1 }] } } } };
  const initialState = { schema: "master-red/campaign-planner-state/v1", completedThroughObjectiveId: "teach-surf" };
  return { teamPlan, observation, initialState };
}

for (const [name, settings] of [
  ["Power Plant land capture", {}],
  ["native Surf encounter", { targetKind: "surf-encounter-zone", map: "MAP_ROUTE10" }],
  ["Route 21 south acquisition", { map: "MAP_ROUTE21_SOUTH" }],
]) {
  test(`${name} waits for the Soul Badge without replacing its roster commitment`, () => {
    const f = fixture(settings), original = structuredClone(f.teamPlan);
    const campaign = createMasterCampaign(f.teamPlan);
    const ids = campaign.objectives.map(x => x.id);
    assert.ok(ids.indexOf("master-native-82-capture") > ids.indexOf("badge-soul"));
    const planner = createCampaignPlanner(f);
    assert.equal(planner.select(f.observation).id, "teach-strength");
    f.observation.playerMemory.trainer.party[2].moves.push(70);
    const koga = planner.select(f.observation);
    assert.equal(koga.id, "badge-soul");
    assert.equal(koga.minimumBattlePartySize, 5);
    assert.equal(koga.preferredFamilies.some(family => family.includes(81)), false);
    assert.deepEqual(f.teamPlan, original, "source catalog, team, and acquisition records stay immutable");
    const resumed = createCampaignPlanner({ ...f, initialState: planner.state() });
    assert.equal(resumed.select(f.observation).id, "badge-soul");
    f.observation.playerMemory.storyState.flagIds[2084] = true;
    const capture = resumed.select(f.observation);
    assert.equal(capture.id, "master-native-82-capture");
    assert.deepEqual(capture.captureSpecies, [81]);
    assert.deepEqual(capture.completion, { kind: "owned-species", species: [81, 82] });
  });
}

test("a deferred acquisition rechecks actual Surf even after its teaching milestone was checkpointed", () => {
  const f = fixture();
  f.observation.playerMemory.storyState.flagIds[2084] = true;
  f.observation.playerMemory.trainer.party[2].moves.push(70);
  f.observation.playerMemory.trainer.party[4].moves = [145];
  const planner = createCampaignPlanner({ ...f, initialState: { ...f.initialState, completedThroughObjectiveId: "badge-soul" } });
  assert.equal(planner.select(f.observation).id, "teach-surf");
  f.observation.playerMemory.trainer.party[4].moves.push(57);
  assert.equal(planner.select(f.observation).id, "master-native-82-capture");
});

test("a boxed generated Surf carrier is prepared before reteaching and returning to the same acquisition", () => {
  const f = fixture();
  f.teamPlan.fieldMoveMinimumLevels = { surf: 0 };
  f.observation.playerMemory.storyState.flagIds[2084] = true;
  const trainer = f.observation.playerMemory.trainer;
  const horsea = trainer.party.pop();
  horsea.moves = [145];
  trainer.storage = { pokemon: [horsea] };
  const planner = createCampaignPlanner({ ...f, initialState: { ...f.initialState, completedThroughObjectiveId: "badge-soul" } });
  assert.equal(planner.select(f.observation).id, "prepare-surf-carrier");
  assert.equal(planner.campaignStatus().activeObjective.id, "prepare-surf-carrier");
  const saved = planner.state();
  assert.equal(saved.completedThroughObjectiveId, "badge-soul", "pending capture is never marked complete");
  trainer.party.push(horsea);
  trainer.storage.pokemon = [];
  const resumed = createCampaignPlanner({ ...f, initialState: saved });
  assert.equal(resumed.select(f.observation).id, "teach-surf");
  horsea.moves.push(57);
  assert.equal(resumed.select(f.observation).id, "master-native-82-capture");
});
