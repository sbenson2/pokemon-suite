import assert from "node:assert/strict";
import test from "node:test";

import {
  createMasterTeamPlan,
  createMasterTeamPlanForRun,
} from "../src/player/origins-team.js";

const STARTERS = [
  { species: 1, family: [1, 2, 3], finalSpecies: 3 },
  { species: 4, family: [4, 5, 6], finalSpecies: 6 },
  { species: 7, family: [7, 8, 9], finalSpecies: 9 },
];

const OPTIMIZED_ACQUISITIONS = new Map([
  [1, ["fearow", "graveler", "hypno", "snorlax", "lapras"]],
  [4, ["primeape", "parasect", "dugtrio", "snorlax", "lapras"]],
  [7, ["fearow", "primeape", "nidoran-m", "mr-mime", "snorlax"]],
]);

const PREPARED_MAJOR_BATTLES = [
  "rival-route22-early",
  "badge-boulder",
  "rival-cerulean",
  "badge-cascade",
  "rival-ss-anne",
  "badge-thunder",
  "badge-rainbow",
  "rocket-hideout-giovanni",
  "rival-pokemon-tower",
  "rival-silph",
  "silph-liberated",
  "badge-soul",
  "badge-marsh",
  "badge-volcano",
  "badge-earth",
  "rival-route22-late",
  "elite-four-lorelei",
  "elite-four-bruno",
  "elite-four-agatha",
  "elite-four-lance",
  "champion",
];

function sameFamily(left, right) {
  return left.length === right.length && left.every(
    (species, index) => species === right[index],
  );
}

test("a seed chooses one reproducible permanent six-member League team", () => {
  for (const starter of STARTERS) {
    for (const seed of [0, 1, 54, 0x7fff_ffff, 0xffff_ffff]) {
      const first = createMasterTeamPlan(starter.species, seed);
      const second = createMasterTeamPlan(starter.species, seed);

      assert.deepEqual(first, second);
      assert.equal(first.schema, "master-red/permanent-team-plan/v1");
      assert.equal(first.seed, seed);
      assert.deepEqual(first.starterFamily, starter.family);
      assert.equal(first.hallOfFameSpecies[0], starter.finalSpecies);
      assert.equal(first.hallOfFameSpecies.length, 6);
      assert.equal(first.acquisitions.length, 5);
      assert.equal(first.permanentFamilies.length, 6);
      assert.deepEqual(first.utilityAcquisitions, []);
      assert.equal(first.rosterPolicy.lockedAtStart, true);
      assert.equal(first.rosterPolicy.allowTemporaryMembers, false);
      assert.equal(first.pokedexPolicy.enabled, false);
      assert.equal(first.pokedexPolicy.fillOpenPartySlots, false);

      for (const acquisition of first.acquisitions) {
        assert.equal(acquisition.nativeFireRed, true);
        assert.equal(acquisition.preHallOfFame, true);
        assert.equal(acquisition.permanentRoster, true);
        assert.ok(acquisition.steps.every(({ kind }) =>
          !["trade", "postgame"].includes(kind)
        ));
      }
    }
  }
});

test("every seeded team covers required traversal with its permanent League families", () => {
  for (const starter of STARTERS) {
    for (let seed = 0; seed < 128; seed += 1) {
      const plan = createMasterTeamPlan(starter.species, seed);
      for (const move of ["cut", "fly", "surf", "strength"]) {
        const family = plan.fieldMoves[move];
        assert.ok(Array.isArray(family) && family.length > 0, `${seed}:${move}`);
        assert.ok(
          plan.permanentFamilies.some((candidate) => sameFamily(candidate, family)),
          `${seed}:${move}:permanent`,
        );
      }

      const familyKeys = plan.permanentFamilies.map((family) => family.join(","));
      assert.equal(new Set(familyKeys).size, 6, `${seed}:unique families`);
      assert.deepEqual(
        plan.hallOfFameSpecies.slice(1),
        plan.acquisitions.map(({ targetSpecies }) => targetSpecies),
      );
    }
  }
});

test("starter-optimized selection stays forward-ready across seeds", () => {
  for (const starter of STARTERS) {
    const signatures = new Set();
    for (let seed = 0; seed < 128; seed += 1) {
      const plan = createMasterTeamPlan(starter.species, seed);
      signatures.add(plan.acquisitions.map(({ id }) => id).join("|"));
      assert.ok(
        plan.acquisitions.filter(({ availabilityOrder }) => availabilityOrder <= 1)
          .length >= 1,
        `${seed}: one teammate before Brock`,
      );
      assert.ok(
        plan.acquisitions.filter(({ availabilityOrder }) => availabilityOrder <= 4)
          .length >= 3,
        `${seed}: three teammates before Surge`,
      );
      assert.ok(
        plan.acquisitions.filter(({ availabilityOrder }) => availabilityOrder <= 7)
          .length >= 4,
        `${seed}: four teammates before Silph`,
      );
    }
    assert.equal(signatures.size, 1, `${starter.species}: stable optimized team`);
  }
});

test("every Charmander team commits a real Misty answer before Cerulean Gym", () => {
  for (let seed = 0; seed < 256; seed += 1) {
    const plan = createMasterTeamPlan(4, seed);
    assert.ok(plan.acquisitions.some((acquisition) =>
      acquisition.availabilityOrder <= 3 &&
      acquisition.battleRoles.includes("water-answer")
    ), `${seed}: ${plan.acquisitions.map(({ id }) => id).join(",")}`);
  }
});

test("the permanent roster is starter-optimized instead of uniformly random", () => {
  for (const starter of STARTERS) {
    for (const seed of [0, 1, 54, 0x7fff_ffff, 0xffff_ffff]) {
      const plan = createMasterTeamPlan(starter.species, seed);

      assert.deepEqual(
        plan.acquisitions.map(({ id }) => id),
        OPTIMIZED_ACQUISITIONS.get(starter.species),
        `${starter.species}:${seed}`,
      );
      assert.equal(
        plan.provenance.selection,
        "starter-optimized-forward-team",
      );
      assert.deepEqual(Object.keys(plan.battlePlans), PREPARED_MAJOR_BATTLES);
      for (const battleId of PREPARED_MAJOR_BATTLES) {
        assert.equal(
          plan.battlePlans[battleId].preferredFamilies.length,
          6,
          `${starter.species}:${battleId}`,
        );
        assert.ok(
          plan.battlePlans[battleId].coverageTypes.length > 0,
          `${starter.species}:${battleId}: coverage intelligence`,
        );
        assert.ok(
          plan.battlePlans[battleId].availableFamilies.length > 0,
          `${starter.species}:${battleId}: available permanent roster`,
        );
      }
    }
  }
});

test("a legacy checkpoint can restore the exact permanent roster it already committed to", () => {
  const plan = createMasterTeamPlan(4, 2735793998, {
    selection: "legacy-seeded-v1",
  });

  assert.deepEqual(plan.acquisitions.map(({ id }) => id), [
    "fearow",
    "beedrill",
    "golbat",
    "gloom",
    "snorlax",
  ]);
  assert.equal(plan.provenance.selection, "legacy-seeded-v1");
  assert.equal(
    plan.battlePlans["badge-cascade"].preferredFamilies[0].includes(43),
    true,
    "even a restored legacy roster must lead with its available Misty answer",
  );
});

test("run resumption locks old and new saves to the roster they started with", () => {
  const seed = 2735793998;
  const legacy = createMasterTeamPlanForRun(4, seed, {
    schema: "master-red/player-state/v1",
  });
  assert.deepEqual(legacy.acquisitions.map(({ id }) => id), [
    "fearow",
    "beedrill",
    "golbat",
    "gloom",
    "snorlax",
  ]);

  const fresh = createMasterTeamPlanForRun(4, seed, null);
  const restored = createMasterTeamPlanForRun(4, seed, {
    permanentTeamPlan: {
      schema: fresh.schema,
      seed: fresh.seed,
      selection: fresh.provenance.selection,
      acquisitionIds: fresh.acquisitions.map(({ id }) => id),
    },
  });
  assert.deepEqual(restored, fresh);
});
