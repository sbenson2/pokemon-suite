import assert from "node:assert/strict";
import test from "node:test";
import * as roster from "../src/player/fire-red-roster.js";
import { rosterContextFixture } from "../test-support/roster-context-fixture.js";
import { createMasterCampaign, createCampaignPlanner, IMPORTANT_BATTLE_TRAINER_NAMES } from "../src/player/campaign.js";

test("FireRed discovers native encounter candidates outside the old recipe pool", () => {
  assert.equal(typeof roster.createFireRedRosterContext, "function");
  const context = roster.createFireRedRosterContext(rosterContextFixture());
  for (const id of [25, 35, 39, 48, 66, 95, 111, 113, 115, 123, 128, 132]) {
    assert.ok(context.candidates.some(x => x.captureSpecies === id), `missing discoverable species ${id}`);
  }
  assert.equal(context.candidates.some(x => x.targetSpecies === 150), false, "postgame map is excluded");
  assert.equal(context.candidates.some(x => x.targetSpecies === 127), false, "unavailable Sevii map is excluded");
  assert.equal(context.candidates.some(x => x.targetSpecies === 65), false, "no invented external trade evolution");
  assert.ok(context.candidates.some(x => x.targetSpecies === 64));
  assert.ok(context.candidates.some(x => x.targetSpecies === 26), "a supported stone evolution is a separate choice");
});

test("new teams are generated from the catalog, with no forced Lapras or fixed role occupants", () => {
  assert.equal(typeof roster.createFireRedRosterContext, "function");
  const context = roster.createFireRedRosterContext(rosterContextFixture());
  const teams = new Set();
  for (let seed = 0; seed < 160; seed++) {
    const plan = context.createTeamPlan(1, 123, seed);
    assert.equal(plan.provenance.selection, "coherent-generated-v2");
    assert.equal(plan.permanentFamilies.length, 6);
    assert.deepEqual(plan, context.createTeamPlan(1, 123, seed));
    assert.equal(context.evaluate(plan).viable, true);
    assert.equal(plan.pokedexPolicy.enabled, false);
    const campaign = createMasterCampaign(plan);
    assert.equal(new Set(campaign.objectives.map(x => x.id)).size, campaign.objectives.length);
    for (const acquisition of plan.acquisitions) assert.ok(campaign.objectives.some(x => x.acquisitionId === acquisition.id));
    teams.add([...plan.hallOfFameSpecies].sort((a, b) => a - b).join());
  }
  assert.ok(teams.size > 100, `${teams.size} distinct actual species lineups`);
});

test("surf-dependent catches cannot be their own first Surf provider", () => {
  assert.equal(typeof roster.createFireRedRosterContext, "function");
  const context = roster.createFireRedRosterContext(rosterContextFixture());
  const plan = context.createTeamPlan(1, 123, 8);
  const impossible = { ...plan, acquisitions: plan.acquisitions.map(x => ({ ...x, afterObjectiveId: "teach-surf" })) };
  assert.equal(context.evaluate(impossible).viable, false);
});

function generatedPlan() {
  return roster.createFireRedRosterContext(rosterContextFixture()).createTeamPlan(1, 123, 4);
}

test("generated fishing and Safari captures preserve their actual encounter methods", () => {
  const plan = generatedPlan();
  const fishing = { ...plan.acquisitions[0], id: "fishing-test", afterObjectiveId: "vs-seeker", steps: [
    { kind: "key-item-gift", itemId: 262, map: "MAP_VERMILION_CITY_HOUSE1", objectIndex: 0, afterObjectiveId: "vs-seeker" },
    { kind: "wild-capture", species: 129, maps: ["MAP_VERMILION_CITY"], targetKind: "fishing-zone", rodItemId: 262 },
  ] };
  const safari = { ...plan.acquisitions[1], id: "safari-test", afterObjectiveId: "hm-surf", steps: [
    { kind: "wild-capture", species: 123, maps: ["MAP_SAFARI_ZONE_CENTER"], targetKind: "encounter-zone", safari: true },
  ] };
  const campaign = createMasterCampaign({ ...plan, acquisitions: [fishing, safari, ...plan.acquisitions.slice(2)] });
  const rod = campaign.objectives.find(x => x.id === "master-fishing-test-key-item-262");
  const capture = campaign.objectives.find(x => x.id === "master-fishing-test-capture");
  assert.ok(rod);
  assert.ok(campaign.objectives.indexOf(rod) < campaign.objectives.indexOf(capture));
  assert.equal(capture.target.kind, "fishing-zone");
  assert.equal(capture.target.rodItemId, 262);
  assert.equal(campaign.objectives.find(x => x.id === "master-safari-test-capture").safari, true);
});

test("generated gifts reserve a slot, refuse nicknames, and buy their required evolution item", () => {
  const plan = generatedPlan();
  const gift = { ...plan.acquisitions[0], id: "gift-test", captureSpecies: 133, targetSpecies: 135,
    afterObjectiveId: "badge-thunder", family: [133, 134, 135, 136], steps: [
      { kind: "gift", species: 133, map: "MAP_CELADON_CITY_CONDOMINIUMS_ROOF_ROOM", objectIndex: 1 },
      { kind: "purchase", itemId: 96, price: 2100, map: "MAP_CELADON_CITY_DEPARTMENT_STORE_4F", objectIndex: 2, stockIndex: 3 },
      { kind: "item-evolution", itemId: 96, sourceSpecies: 133, targetSpecies: 135 },
    ] };
  const campaign = createMasterCampaign({ ...plan, acquisitions: [gift, ...plan.acquisitions.slice(1)] });
  const objectives = new Map(campaign.objectives.map(x => [x.id, x]));
  assert.equal(objectives.get("master-gift-test-gift-party-space")?.target.maximumPartySize, 5);
  assert.equal(objectives.get("master-gift-test-gift")?.choice, "no");
  assert.equal(objectives.get("master-gift-test-purchase-96")?.target.items[0].unitPrice, 2100);
  assert.equal(objectives.get("master-gift-test-evolve")?.target.targetSpecies, 135);
});

test("generated late acquisitions are not demanded before capture, and a Route 16 flyer is caught before Fly", () => {
  const plan = generatedPlan();
  const doduo = { ...plan.acquisitions[0], id: "native-flyer", family: [84, 85], afterObjectiveId: "poke-flute",
    steps: [{ kind: "wild-capture", species: 84, maps: ["MAP_ROUTE16"] }] };
  const campaign = createMasterCampaign({ ...plan, route16FlyAcquisitionId: doduo.id, fieldMoves: { ...plan.fieldMoves, fly: [84, 85] },
    acquisitions: [doduo, ...plan.acquisitions.slice(1)], surfAssemblyFamilies: [[1, 2, 3]] });
  const ids = campaign.objectives.map(x => x.id);
  assert.equal(ids.filter(x => x === "master-native-flyer-capture").length, 1);
  assert.ok(ids.indexOf("master-native-flyer-capture") < ids.indexOf("teach-fly"));
  assert.deepEqual(campaign.objectives.find(x => x.id === "assemble-permanent-roster").target.requiredFamilies, [[1, 2, 3]]);
});

test("Route 21's native north/south map names are eligible after Surf", () => {
  const fixture = rosterContextFixture();
  fixture.world.maps.find(x => x.id === "MAP_ROUTE3").id = "MAP_ROUTE21_NORTH";
  fixture.world.wildEncounters.find(x => x.map === "MAP_ROUTE3").map = "MAP_ROUTE21_NORTH";
  const context = roster.createFireRedRosterContext(fixture);
  assert.equal(context.candidates.find(x => x.captureSpecies === 35)?.afterObjectiveId, "teach-surf");
});

test("HM evaluation respects changed evolution timing, including after a profile was cached", () => {
  const fixture = rosterContextFixture();
  for (const p of Object.values(fixture.facts.species)) p.fieldCapabilities = ["cut", "surf", "strength"];
  fixture.facts.species[26].fieldCapabilities.push("fly");
  const context = roster.createFireRedRosterContext(fixture);
  const acquisitions = [16, 19, 21, 56, 26].map(id => context.candidates.find(x => x.id === `native-${id}`));
  const plan = { starterFamily: [1, 2, 3], acquisitions };
  assert.equal(context.evaluate(plan).viable, true);
  const materialized = context.createTeamPlan(1, 1, 1, acquisitions.map(x => x.id));
  const evolution = materialized.acquisitions.find(x => x.targetSpecies === 26).steps.find(x => x.kind === "item-evolution");
  assert.ok(evolution.minimumLevel > 5);
  assert.equal(materialized.fieldMoveMinimumLevels.fly, evolution.minimumLevel);
  const delayed = { ...plan, acquisitions: acquisitions.map(x => x.targetSpecies !== 26 ? x : { ...x,
    evolutionSteps: x.evolutionSteps.map(e => ({ ...e, afterObjectiveId: "teach-surf" })) }) };
  assert.equal(context.evaluate(delayed).viable, false, "Fly cannot depend on an evolution scheduled after Surf");
});

test("distinct Moon Stones are allocated before checking evolution and HM deadlines", () => {
  const fixture = rosterContextFixture();
  for (const p of Object.values(fixture.facts.species)) p.fieldCapabilities = ["cut", "surf", "strength"];
  fixture.facts.species[40].fieldCapabilities.push("fly");
  for (const id of [35, 39]) fixture.facts.species[id].evolutions = [{ method: 7, parameter: 94, targetSpecies: id + 1 }];
  fixture.world.maps.push({ id: "MAP_MT_MOON_B1F", objectEvents: [], backgroundEvents: [] });
  for (const [i, map] of ["MAP_MT_MOON_B1F", "MAP_POKEMON_MANSION_1F"].entries()) {
    fixture.world.maps.find(x => x.id === map).backgroundEvents.push({ type: "hidden_item", item: "ITEM_MOON_STONE", flag: `STONE_${i}`, x: 0, y: 0 });
  }
  fixture.story.symbols = { flags: { STONE_0: { value: 100 }, STONE_1: { value: 101 } }, items: { ITEM_MOON_STONE: { value: 94 } } };
  const context = roster.createFireRedRosterContext(fixture);
  const plan = { starterFamily: [1, 2, 3], acquisitions: [16, 19, 21, 36, 40].map(id => context.candidates.find(x => x.id === `native-${id}`)) };
  assert.equal(context.evaluate(plan).viable, false, "second stone is not available in time for the only Fly carrier");
});

test("restoring selected acquisitions cannot bypass a shared trade prerequisite", () => {
  const fixture = rosterContextFixture();
  fixture.world.maps.push({ id: "MAP_ROUTE2_HOUSE", objectEvents: [], backgroundEvents: [] });
  const context = roster.createFireRedRosterContext(fixture);
  const selected = ["native-16", "native-19", "native-21", "native-64", "mr-mime"];
  assert.throws(() => context.createTeamPlan(1, 1, 1, selected), /exclusive|prerequisite/i);
});

test("stone evolution retrieves and trains its source before attempting to use the item", () => {
  const plan = generatedPlan();
  const acquisition = { ...plan.acquisitions[0], steps: [
    ...plan.acquisitions[0].steps,
    { kind: "item-evolution", sourceSpecies: 33, targetSpecies: 34, itemId: 94, minimumLevel: 17 },
  ] };
  const campaign = createMasterCampaign({ ...plan, acquisitions: [acquisition, ...plan.acquisitions.slice(1)] });
  const ids = campaign.objectives.map(x => x.id);
  const prepare = `master-${acquisition.id}-evolve-party`, train = `master-${acquisition.id}-evolve-train`;
  assert.ok(ids.indexOf(prepare) >= 0 && ids.indexOf(prepare) < ids.indexOf(train));
  assert.ok(ids.indexOf(train) < ids.indexOf(`master-${acquisition.id}-evolve`));
  assert.equal(campaign.objectives.find(x => x.id === train).minimumCoreLevel, 17);
});

test("training prerequisites advance only when the named family reaches its level", () => {
  const objective = { id: "train-required-carrier", target: { kind: "roster-training" },
    completion: { kind: "party-member-minimum-level", species: [16, 17, 18], level: 18 } };
  const planner = createCampaignPlanner({ campaign: { objectives: [objective] } });
  const observation = level => ({ phase: "stable", emulator: { mode: "overworld" }, playerMemory: {
    trainer: { party: [{ species: 1, level: 55 }, { species: 16, level }] },
  } });
  assert.equal(planner.select(observation(17))?.id, objective.id);
  assert.equal(planner.select(observation(18)), null);
});

test("generated field moves prepare their selected carrier before teaching", () => {
  const plan = generatedPlan();
  const campaign = createMasterCampaign({ ...plan, fieldMoveMinimumLevels: { cut: 20, fly: 18, surf: 20, strength: 20 } });
  const ids = campaign.objectives.map(x => x.id);
  for (const move of ["cut", "fly", "surf", "strength"]) {
    assert.ok(ids.indexOf(`prepare-${move}-carrier`) >= 0, move);
    assert.ok(ids.indexOf(`train-${move}-carrier`) < ids.indexOf(`teach-${move}`), move);
    assert.deepEqual(campaign.objectives.find(x => x.id === `train-${move}-carrier`).coreSpecies, plan.fieldMoves[move]);
  }
});

test("catalog commitments bind learnset evidence, not only the list of species", () => {
  const baseline = roster.createFireRedRosterContext(rosterContextFixture());
  const fixture = rosterContextFixture();
  fixture.facts.species[16].levelUpMoves.push({ level: 9, moveId: 55 });
  assert.notEqual(roster.createFireRedRosterContext(fixture).revision, baseline.revision);
});

test("planned HMs count as affordable attacks only after their teaching deadline", () => {
  const fixture = rosterContextFixture();
  fixture.facts.moves[55].power = 0;
  const context = roster.createFireRedRosterContext(fixture);
  const selected = [16, 19, 21, 56, 25];
  const planFor = context => ({ starterFamily: [1, 2, 3], acquisitions: selected.map(id => context.candidates.find(x => x.id === `native-${id}`)) });
  assert.equal(context.evaluate(planFor(context)).viable, true, "the Surf carrier provides late special offense");
  fixture.facts.species[150].types = ["TYPE_GHOST"];
  fixture.facts.typeChart = [{ attackingType: "TYPE_NORMAL", defendingType: "TYPE_GHOST", multiplier: 0 }];
  fixture.mechanics.trainers = [{ name: IMPORTANT_BATTLE_TRAINER_NAMES["badge-cascade"][0], party: [{ species: 150 }] }];
  const early = roster.createFireRedRosterContext(fixture);
  assert.equal(early.evaluate(planFor(early)).viable, false, "Misty cannot be answered with a future Surf or Fly");
});

test("an available starter may evolve into the sole Fly carrier without forcing a bird slot", () => {
  const fixture = rosterContextFixture();
  for (const p of Object.values(fixture.facts.species)) p.fieldCapabilities = ["cut", "surf", "strength"];
  fixture.facts.species[1].evolutions = [{ method: 4, parameter: 16, targetSpecies: 2 }];
  fixture.facts.species[2].evolutions = [{ method: 4, parameter: 36, targetSpecies: 3 }];
  fixture.facts.species[3].fieldCapabilities.push("fly");
  const context = roster.createFireRedRosterContext(fixture);
  const plan = context.createTeamPlan(1, 1, 1, [16, 19, 21, 56, 25].map(id => `native-${id}`));
  assert.deepEqual(plan.fieldMoves.fly, [1, 2, 3]);
  assert.equal(plan.fieldMoveMinimumLevels.fly, 36, "explicit training, not invented level-35 compatibility");
});
