import assert from "node:assert/strict";
import test from "node:test";

import { createCoherentTeamPlan, createMasterTeamPlan, createMasterTeamPlanForRun } from "../src/player/origins-team.js";
import {
  createRosterPlanForRun as createPlan, rosterCheckpoint, resolveRosterRunSeed,
} from "../src/player/roster-selection.js";
import { createCampaignPlanner, createMasterCampaign, createRosterCampaign, MAIN_STORY_CAMPAIGN } from "../src/player/campaign.js";
import { createFireRedRosterContext } from "../src/player/fire-red-roster.js";
import { rosterContextFixture } from "../test-support/roster-context-fixture.js";

const rosterContext = createFireRedRosterContext(rosterContextFixture());
const createRosterPlanForRun = (starter, seed, state = null, options = {}) => createPlan(starter, seed, state, { rosterContext, ...options });

const ids = plan => plan.acquisitions.map(({ id }) => id);
const roundTrip = value => JSON.parse(JSON.stringify(value));

test("new campaigns choose varied, repeatable coherent teams for every starter", () => {
  for (const starter of [1, 4, 7]) {
    const rosters = new Set();
    for (let seed = 0; seed < 96; seed += 1) {
      const plan = createRosterPlanForRun(starter, 123, null, { teamSeed: seed });
      assert.deepEqual(plan, createRosterPlanForRun(starter, 123, null, { teamSeed: seed }));
      assert.equal(plan.rosterSelection.mode, "coherent");
      assert.equal(plan.rosterSelection.version, "coherent-generated-v2");
      assert.equal(plan.rosterSelection.catalogRevision, rosterContext.revision);
      assert.equal(plan.rosterSelection.teamSeed, seed);
      assert.equal(plan.seed, 123, "team randomness must not change the opening identity");
      assert.equal(plan.permanentFamilies.length, 6);
      assert.equal(new Set(ids(plan)).size, 5);
      assert.equal(plan.rosterPolicy.allowTemporaryMembers, false);
      assert.equal(plan.pokedexPolicy.enabled, false);
      assert.ok(plan.acquisitions.some(x => x.afterObjectiveId === "regional-pokedex"), "an early partner is planned");
      assert.equal(rosterContext.evaluate(plan).viable, true);
      for (const move of ["cut", "fly", "surf", "strength"]) {
        assert.ok(plan.permanentFamilies.some(family => family.join() === plan.fieldMoves[move].join()), move);
      }
      const campaign = createMasterCampaign(plan);
      const objectiveIds = campaign.objectives.map(x => x.id);
      assert.equal(new Set(objectiveIds).size, objectiveIds.length);
      assert.equal(Object.keys(plan.battlePlans).length, 21);
      assert.ok(plan.battlePlans["badge-cascade"].availableFamilies.every(family => !family.includes(131)));
      rosters.add(ids(plan).join());
    }
    assert.ok(rosters.size > 36, `starter ${starter} has ${rosters.size} distinct teams`);
  }
});

test("fixed remains available, and Origins changes the roster without enabling collection grinding", () => {
  for (const starter of [1, 4, 7]) {
    const fixed = createRosterPlanForRun(starter, 17, null, { rosterMode: "fixed" });
    assert.deepEqual(ids(fixed), ids(createMasterTeamPlan(starter, 17)));
    const origins = createRosterPlanForRun(starter, 17, null, { rosterMode: "origins" });
    assert.deepEqual(origins.hallOfFameSpecies.slice(1), [135, 131, 123, 85, 53]);
    assert.equal(origins.pokedexPolicy.enabled, false);
    assert.equal(origins.pokedexPolicy.fillOpenPartySlots, false);
    assert.equal(origins.trainingPolicy.regionalMasteryBeforeHallOfFame, false);
    assert.equal(origins.rosterPolicy.allowTemporaryMembers, true);
    // Use the real default planner boundary; selecting the mode must select its campaign too.
    const planner = createCampaignPlanner({ teamPlan: origins });
    assert.ok(planner);
  }
});

test("the Origins preset uses current readiness and supplies while retaining its acquisition routes", () => {
  for (const starter of [1, 4, 7]) {
    const plan = createRosterPlanForRun(starter, 17, null, { rosterMode: "origins" });
    const campaign = createRosterCampaign(plan);
    const objectives = new Map(campaign.objectives.map(x => [x.id, x]));
    assert.equal(objectives.size, campaign.objectives.length);
    for (const source of MAIN_STORY_CAMPAIGN.objectives.filter(x => x.importantBattle)) {
      const objective = objectives.get(source.id);
      assert.equal(objective.battleTeamTargetLevel, source.battleTeamTargetLevel, source.id);
      assert.equal(objective.minimumCoreLevel, null, `${source.id}: no old starter anchor`);
      assert.equal(objective.prioritizeMatchupTraining, true, source.id);
      assert.notEqual(objective.trainerTrainingAllowed, false, source.id);
      assert.ok(objective.minimumBattlePartySize <= plan.battlePlans[source.rosterPreparationFor ?? source.id].availableFamilies.length);
    }
    for (const id of ["origins-eevee-gift", "origins-thunder-stone", "origins-jolteon-evolve",
      "origins-doduo-capture", "origins-scyther-capture", "gift-lapras", "assemble-league-roster"]) assert.ok(objectives.has(id), id);
    assert.equal(objectives.get("origins-eevee-gift").choice, "no");
    assert.ok(objectives.has("origins-paras-utility-capture"));
    assert.equal(objectives.has("brock-mankey-capture"), starter === 4);
    assert.equal(objectives.has("misty-oddish-capture"), starter !== 1);
    for (const id of ["coin-case", "silph-coverage-tm", "teach-secret-power", "silph-supplies", "league-supplies", "route12-snorlax"]) {
      assert.equal(objectives.has(id), false, `${id}: not implicitly reenabled by a roster preset`);
    }
    const common = createMasterCampaign(createMasterTeamPlan(starter, 17));
    assert.deepEqual(objectives.get("permanent-team-capture-supplies").target,
      common.objectives.find(x => x.id === "permanent-team-capture-supplies").target);
    assert.equal(objectives.get("route16-snorlax").captureSpecies, undefined, "clear the road, no unplanned extra teammate");
    assert.ok(plan.battlePlans["silph-liberated"].availableFamilies.every(f => !f.includes(123)));
    assert.equal(plan.battlePlans.champion.availableFamilies.length, 6);
  }
});

test("a serialized roster restores exactly and refuses a mode, seed, or starter change", () => {
  for (const mode of ["coherent", "origins", "fixed"]) {
    const plan = createRosterPlanForRun(4, 123, null, { rosterMode: mode, teamSeed: 42 });
    const state = roundTrip(rosterCheckpoint(plan));
    assert.deepEqual(createRosterPlanForRun(4, 123, state), plan);
    assert.deepEqual(createRosterPlanForRun(4, 123, state, { rosterMode: mode, teamSeed: 42 }), plan);
    assert.throws(() => createRosterPlanForRun(4, 123, state, { teamSeed: 43 }), /checkpoint.*team seed/i);
    assert.throws(() => createRosterPlanForRun(4, 123, state, { rosterMode: mode === "origins" ? "coherent" : "origins" }), /checkpoint.*roster mode/i);
    assert.throws(() => createRosterPlanForRun(4, 124, state), /checkpoint.*run/i);
    assert.throws(() => createRosterPlanForRun(7, 123, state), /checkpoint.*starter/i);
  }
});

test("old committed and pre-commitment checkpoints keep their exact historic teams", () => {
  const oldFixed = createMasterTeamPlan(4, 2735793998);
  const fixedState = { permanentTeamPlan: { schema: oldFixed.schema, seed: oldFixed.seed,
    selection: oldFixed.provenance.selection, acquisitionIds: ids(oldFixed) } };
  for (const state of [fixedState, { campaignPlanner: null }]) {
    const expected = createMasterTeamPlanForRun(4, oldFixed.seed, state);
    const actual = createRosterPlanForRun(4, oldFixed.seed, state);
    assert.deepEqual(ids(actual), ids(expected));
    assert.equal(actual.provenance.selection, expected.provenance.selection);
    assert.deepEqual(createRosterPlanForRun(4, oldFixed.seed, roundTrip(rosterCheckpoint(actual))), actual);
    assert.throws(() => createRosterPlanForRun(4, oldFixed.seed, state, { rosterMode: "coherent" }), /checkpoint.*roster mode/i);
  }
});

test("invalid or inconsistent roster commitments fail closed", () => {
  for (const teamSeed of [-1, 0x1_0000_0000, 0.5, NaN, ""]) {
    assert.throws(() => createRosterPlanForRun(1, 1, null, { teamSeed }), /team seed/i);
  }
  assert.throws(() => createRosterPlanForRun(1, 1, null, { rosterMode: "random-anything" }), /roster mode/i);
  const state = roundTrip(rosterCheckpoint(createRosterPlanForRun(1, 1)));
  state.teamSelection.version = "unknown-future-version";
  assert.throws(() => createRosterPlanForRun(1, 1, state), /version/i);
  const conflicting = roundTrip(rosterCheckpoint(createRosterPlanForRun(1, 1)));
  conflicting.permanentTeamPlan.acquisitionIds[0] = "beedrill";
  assert.throws(() => createRosterPlanForRun(1, 1, conflicting), /checkpoint.*(conflict|match)/i);
  assert.throws(() => createRosterPlanForRun(1, 1, { teamSelection: null }), /checkpoint.*commitment/i);
});

test("checkpoint field order is not part of roster identity", () => {
  const plan = createRosterPlanForRun(7, 456);
  const state = roundTrip(rosterCheckpoint(plan));
  state.permanentTeamPlan = Object.fromEntries(Object.entries(state.permanentTeamPlan).reverse());
  assert.deepEqual(createRosterPlanForRun(7, 456, state), plan);
});

test("Mr. Mime is only planned as available after its Cut-gated exchange", () => {
  const plans = Array.from({ length: 20 }, (_, seed) => createCoherentTeamPlan(7, seed, seed));
  const traded = plans.find(plan => ids(plan).includes("mr-mime"));
  assert.ok(traded);
  assert.equal(traded.battlePlans["rival-ss-anne"].availableFamilies.some(family => family.includes(122)), false);
  assert.equal(traded.battlePlans["badge-thunder"].availableFamilies.some(family => family.includes(122)), true);
  for (const battle of Object.values(traded.battlePlans)) {
    assert.ok(battle.preferredFamilies.every(family => battle.availableFamilies.some(available => available[0] === family[0])));
  }
});

test("renaming a continuation does not reroll the saved opening or team", () => {
  const state = rosterCheckpoint(createRosterPlanForRun(4, 123, null, { teamSeed: 456 }));
  assert.equal(resolveRosterRunSeed({ seed: 999, resumePlayerState: state }), 123);
  assert.equal(resolveRosterRunSeed({ seed: 123, seedExplicit: true, resumePlayerState: state }), 123);
  assert.throws(() => resolveRosterRunSeed({ seed: 999, seedExplicit: true, resumePlayerState: state }), /checkpoint.*opening seed/i);
  assert.equal(resolveRosterRunSeed({ seed: 999 }), 999);
});

test("legacy coherent-v1 checkpoints keep their exact recipes without needing new cartridge facts", () => {
  const old = createCoherentTeamPlan(7, 123, 456);
  const state = { ...rosterCheckpoint(old), teamSelection: { schema: "master-red/roster-selection/v1",
    mode: "coherent", version: "coherent-forward-v1", runSeed: 123, teamSeed: 456,
    starterSpecies: 7, acquisitionIds: ids(old) } };
  const restored = createPlan(7, 123, state);
  assert.deepEqual(ids(restored), ids(old));
  assert.equal(restored.rosterSelection.version, "coherent-forward-v1");
  assert.deepEqual(createPlan(7, 123, roundTrip(rosterCheckpoint(restored))), restored);
});

test("new coherent plans require their native adapter, never a silent preset fallback", () => {
  assert.throws(() => createPlan(1, 1), /verified.*roster|roster.*context/i);
});

test("256-bit roster seeds survive checkpointing, and changed catalogs fail closed", () => {
  const teamSeed = `hex:${"0123456789abcdef".repeat(4)}`;
  const plan = createRosterPlanForRun(1, 123, null, { teamSeed });
  const state = roundTrip(rosterCheckpoint(plan));
  assert.deepEqual(createRosterPlanForRun(1, 123, state), plan);
  assert.equal(plan.rosterSelection.teamSeed, teamSeed);
  assert.throws(() => createRosterPlanForRun(1, 123, state, { rosterContext: { ...rosterContext, revision: "0".repeat(64) } }), /catalog.*(change|match)/i);
  delete state.teamSelection.catalogRevision;
  assert.throws(() => createRosterPlanForRun(1, 123, state), /catalog/i);
});
