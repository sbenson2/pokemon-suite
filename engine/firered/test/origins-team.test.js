import assert from "node:assert/strict";
import test from "node:test";

import { createOriginsTeamPlan } from "../src/player/origins-team.js";

const SUPPORT_CORE = [135, 131, 123, 85, 53];

test("the Origins League core is personalized around every selected starter", () => {
  for (const [starterSpecies, starterFamily, finalSpecies] of [
    [1, [1, 2, 3], 3],
    [4, [4, 5, 6], 6],
    [7, [7, 8, 9], 9],
  ]) {
    const plan = createOriginsTeamPlan(starterSpecies);
    assert.deepEqual(plan.starterFamily, starterFamily);
    assert.deepEqual(plan.hallOfFameSpecies, [finalSpecies, ...SUPPORT_CORE]);
    assert.equal(plan.hallOfFameSpecies.length, 6);
    assert.equal(new Set(plan.hallOfFameSpecies).size, 6);
    assert.equal(plan.provenance.source, "ORIGINS_RED_BATTLE_CONFIGS.md");
    assert.equal(plan.provenance.personalization, "selected-starter-family");
  }
});

test("only Charmander receives the optional early Mankey fallback for Brock", () => {
  assert.deepEqual(createOriginsTeamPlan(1).earlyGame.brock.optionalFamilies, []);
  assert.deepEqual(createOriginsTeamPlan(4).earlyGame.brock.optionalFamilies, [[56, 57]]);
  assert.deepEqual(createOriginsTeamPlan(7).earlyGame.brock.optionalFamilies, []);
});

test("the team plan has a native FireRed acquisition for every support slot", () => {
  const plan = createOriginsTeamPlan(4);
  assert.deepEqual(
    plan.acquisitions.map(({ targetSpecies }) => targetSpecies),
    SUPPORT_CORE,
  );
  assert.ok(plan.acquisitions.every(({ nativeFireRed }) => nativeFireRed));
  assert.deepEqual(
    plan.acquisitions.find(({ targetSpecies }) => targetSpecies === 135).steps
      .map(({ kind }) => kind),
    ["gift", "purchase", "evolution"],
  );
});

test("weak HMs stay on the utility carrier while strong HMs stay battle-usable", () => {
  for (const starter of [1, 4, 7]) {
    const plan = createOriginsTeamPlan(starter);
    assert.deepEqual(plan.fieldMoves.cut, [46, 47]);
    assert.deepEqual(plan.fieldMoves.flash, [46, 47]);
    assert.deepEqual(plan.fieldMoves.rockSmash, [46, 47]);
    assert.deepEqual(plan.fieldMoves.fly, [84, 85]);
    assert.deepEqual(plan.fieldMoves.surf, [131]);
    assert.deepEqual(plan.fieldMoves.strength, [131]);
    assert.deepEqual(plan.utilityAcquisitions[0].fieldMoves, [15, 148, 249]);
  }
});
