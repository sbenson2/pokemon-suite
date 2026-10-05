import assert from "node:assert/strict";
import test from "node:test";
import { createObservationPlanner } from "../src/player/planning-context.js";

import {
  CAMPAIGN_MAJOR_BATTLE_LEVEL_TARGETS,
  campaignNavigationRecommendation as rawCampaignNavigationRecommendation,
  createCampaignPlanner,
  createMasterCampaign,
  createOriginsCampaign,
  MAIN_STORY_CAMPAIGN,
  selectBattleRosterObjective,
  selectRecoveryObjective,
  selectTrainingObjective,
} from "../src/player/campaign.js";
import {
  createMasterTeamPlan,
  createOriginsTeamPlan,
} from "../src/player/origins-team.js";

// Most tests in this file predate the additive full-route contract and focus on
// the selected objective, edge, or interaction. Keep those assertions narrow;
// the dedicated route-plan tests below exercise the complete serialized route.
function campaignNavigationRecommendation(options) {
  const recommendation = rawCampaignNavigationRecommendation(options);
  if (!recommendation) return recommendation;
  const { routePlan: _routePlan, ...legacyRecommendation } = recommendation;
  return legacyRecommendation;
}

function campaignObservation({
  map = "MAP_PALLET_TOWN_PROFESSOR_OAKS_LAB",
  variables = {},
  flags = {},
  bag = {},
  party = [{ slot: 0, species: 1, level: 5, hp: 19, moves: [] }],
} = {}) {
  return {
    phase: "stable",
    emulator: { mode: "overworld" },
    playerMemory: {
      map: { id: map },
      position: { x: 7, y: 8 },
      storyState: {
        variables: {
          VAR_MAP_SCENE_PALLET_TOWN_PROFESSOR_OAKS_LAB: 4,
        },
        flags: {},
        variableIds: variables,
        flagIds: flags,
      },
      trainer: { bag, party },
    },
  };
}

test("the starter-optimized permanent-team campaign catches only its chosen six and stays forward", () => {
  const teamPlan = createMasterTeamPlan(4, 0);
  const campaign = createMasterCampaign(teamPlan);
  const ids = campaign.objectives.map(({ id }) => id);
  const objective = (id) => campaign.objectives.find((candidate) => candidate.id === id);

  assert.deepEqual(teamPlan.acquisitions.map(({ id }) => id), [
    "primeape", "parasect", "dugtrio", "snorlax", "lapras",
  ]);
  for (const acquisition of teamPlan.acquisitions) {
    const acquisitionObjectives = campaign.objectives.filter(
      ({ acquisitionId }) => acquisitionId === acquisition.id,
    );
    assert.ok(acquisitionObjectives.length > 0, acquisition.id);
  }
  assert.equal(ids.some((id) => id.startsWith("origins-")), false);
  assert.equal(ids.includes("route12-snorlax"), false);
  assert.equal(ids.includes("gift-lapras"), true);
  assert.equal(ids.includes("coin-case"), false);
  assert.equal(ids.includes("silph-coverage-tm"), false);
  assert.equal(ids.includes("teach-secret-power"), false);
  assert.ok(ids.indexOf("master-primeape-capture") > ids.indexOf("regional-pokedex"));
  assert.ok(ids.indexOf("master-primeape-capture") < ids.indexOf("rival-route22-early"));
  assert.ok(ids.indexOf("master-parasect-capture") > ids.indexOf("badge-boulder"));
  assert.ok(ids.indexOf("master-parasect-capture") < ids.indexOf("mt-moon-fossil"));
  assert.ok(ids.indexOf("master-snorlax-capture") > ids.indexOf("poke-flute"));
  assert.ok(ids.indexOf("master-snorlax-capture") < ids.indexOf("hm-fly"));
  assert.ok(ids.indexOf("hm-fly") < ids.indexOf("teach-fly"));
  assert.ok(ids.indexOf("assemble-permanent-roster") < ids.indexOf("badge-soul"));
  assert.ok(ids.indexOf("assemble-league-roster") < ids.indexOf("league-heal"));

  assert.deepEqual(objective("teach-cut").target.partySpecies, teamPlan.fieldMoves.cut);
  assert.deepEqual(objective("teach-fly").target.partySpecies, teamPlan.fieldMoves.fly);
  assert.deepEqual(objective("teach-surf").target.partySpecies, teamPlan.fieldMoves.surf);
  assert.deepEqual(
    objective("teach-strength").target.partySpecies,
    teamPlan.fieldMoves.strength,
  );
  assert.deepEqual(
    objective("assemble-permanent-roster").target.requiredFamilies,
    teamPlan.permanentFamilies,
  );
  assert.equal(objective("badge-boulder").minimumBattlePartySize, 2);
  assert.equal(objective("badge-boulder").starterBattleTargetLevel, 16);
  assert.equal(objective("badge-boulder").supportBattleTargetLevel, 16);
  assert.equal(objective("badge-boulder").minimumReadyBattleMembers, 2);
  assert.equal(objective("elite-four-lorelei").starterBattleTargetLevel, 65);
  assert.equal(objective("elite-four-lorelei").supportBattleTargetLevel, 65);
  assert.equal(objective("elite-four-lorelei").minimumReadyBattleMembers, 5);
});

test("a Squirtle master campaign prepares Blastoise with owned Surf before the League", () => {
  const basePlan = createMasterTeamPlan(7, 0);
  const teamPlan = {
    ...basePlan,
    fieldMoves: { ...basePlan.fieldMoves, surf: [116, 117] },
  };
  const squirtleCampaign = createMasterCampaign(teamPlan);
  const ids = squirtleCampaign.objectives.map(({ id }) => id);
  const preparation = squirtleCampaign.objectives.find(
    ({ id }) => id === "teach-blastoise-surf-for-league",
  );

  assert.ok(ids.indexOf("teach-blastoise-surf-for-league") > ids.indexOf("league-heal"));
  assert.ok(ids.indexOf("teach-blastoise-surf-for-league") < ids.indexOf("elite-four-lorelei"));
  assert.deepEqual(preparation.target, {
    kind: "teach-move",
    itemId: 341,
    moveId: 57,
    partySpecies: [7, 8, 9],
    replaceMoveId: 55,
  });
  const observation = campaignObservation({
    map: "MAP_INDIGO_PLATEAU_POKEMON_CENTER_1F",
    bag: { tmhm: [{ itemId: 341, quantity: 1 }] },
    party: [
      { slot: 0, species: 9, level: 58, hp: 170, maxHp: 170,
        moves: [130, 44, 70, 55], pp: [10, 25, 15, 25] },
      { slot: 1, species: 117, level: 58, hp: 140, maxHp: 140,
        moves: [56, 55, 239, 57], pp: [5, 25, 20, 15] },
    ],
  });
  const planner = createCampaignPlanner({
    campaign: squirtleCampaign,
    teamPlan,
    world: { maps: [], wildEncounters: [] },
    mechanics: { moves: {} },
    initialState: {
      schema: "master-red/campaign-planner-state/v1",
      completedThroughObjectiveId: "league-heal",
    },
  });
  assert.equal(planner.select(observation).id, "teach-blastoise-surf-for-league");
  observation.playerMemory.trainer.party[0].moves = [130, 44, 70, 57];
  assert.equal(planner.select(observation).id, "elite-four-lorelei");
  assert.equal(createMasterCampaign(createMasterTeamPlan(1, 0)).objectives.some(
    ({ id }) => id === "teach-blastoise-surf-for-league",
  ), false);
});

test("the Squirtle master route completes Nidoking and Mr. Mime acquisition workflows", () => {
  const campaign = createMasterCampaign(createMasterTeamPlan(7, 0));
  const objective = (id) => campaign.objectives.find((candidate) => candidate.id === id);
  const ids = campaign.objectives.map(({ id }) => id);

  assert.deepEqual(objective("master-nidoran-m-capture")?.target, {
    kind: "encounter-zone",
    map: "MAP_ROUTE3",
  });
  assert.deepEqual(objective("master-nidoran-m-moon-stone")?.target, {
    kind: "object",
    map: "MAP_MT_MOON_1F",
    index: 12,
  });
  assert.deepEqual(objective("master-nidoran-m-evolve")?.target, {
    kind: "evolve-with-item",
    itemId: 94,
    partySpecies: [33],
    targetSpecies: 34,
  });
  assert.deepEqual(objective("master-mr-mime-prerequisite-capture")?.target, {
    kind: "encounter-zone",
    map: "MAP_ROUTE24",
  });
  assert.deepEqual(objective("master-mr-mime-trade")?.target, {
    kind: "in-game-trade",
    map: "MAP_ROUTE2_HOUSE",
    index: 1,
    requestedSpecies: 63,
    receivedSpecies: 122,
  });
  assert.ok(ids.indexOf("master-nidoran-m-capture") < ids.indexOf("mt-moon-fossil"));
  assert.ok(ids.indexOf("master-nidoran-m-evolve") > ids.indexOf("badge-cascade"));
  assert.ok(ids.indexOf("master-mr-mime-prerequisite-capture") < ids.indexOf("badge-cascade"));
  assert.ok(ids.indexOf("master-mr-mime-trade") > ids.indexOf("teach-cut"));
  assert.ok(ids.indexOf("master-mr-mime-trade") < ids.indexOf("badge-thunder"));
});

test("Master mode preserves the researched readiness gate for every major battle", () => {
  const teamPlan = createMasterTeamPlan(4, 0);
  const campaign = createMasterCampaign(teamPlan);
  const authoredObjectives = MAIN_STORY_CAMPAIGN.objectives.filter(
    ({ importantBattle }) => importantBattle,
  );

  for (const authored of authoredObjectives) {
    const battleId = authored.rosterPreparationFor ?? authored.id;
    const expected = CAMPAIGN_MAJOR_BATTLE_LEVEL_TARGETS[battleId];
    const availableFamilies = teamPlan.battlePlans[battleId].availableFamilies;
    const expectedPartySize = Math.min(
      authored.minimumBattlePartySize,
      availableFamilies.length,
    );
    const expectedReadyMembers = Math.min(
      expected.minimumReadyBattleMembers,
      expectedPartySize,
    );
    const masterObjectives = campaign.objectives.filter((candidate) =>
      (candidate.rosterPreparationFor ?? candidate.id) === battleId &&
      candidate.importantBattle
    );
    assert.ok(masterObjectives.length > 0, `${battleId}: present`);
    for (const objective of masterObjectives) {
      assert.equal(
        objective.minimumBattlePartySize,
        expectedPartySize,
        `${objective.id}: staged squad`,
      );
      assert.equal(
        objective.starterBattleTargetLevel,
        expected.starterBattleTargetLevel,
        `${objective.id}: starter target`,
      );
      assert.equal(
        objective.supportBattleTargetLevel,
        expected.supportBattleTargetLevel,
        `${objective.id}: support target`,
      );
      assert.equal(
        objective.minimumReadyBattleMembers,
        expectedReadyMembers,
        `${objective.id}: ready battlers`,
      );
      assert.deepEqual(
        objective.enemyPartyLevels,
        expected.enemyPartyLevels,
        `${objective.id}: opponent intelligence`,
      );
      assert.ok(
        objective.minimumReadyBattleMembers <= objective.minimumBattlePartySize,
        `${objective.id}: readiness must be attainable by the staged squad`,
      );
    }
  }
});

test("the current Misty save retrieves its planned counter before challenging", () => {
  const teamPlan = createMasterTeamPlan(4, 2735793998, {
    selection: "legacy-seeded-v1",
  });
  const objective = createMasterCampaign(teamPlan).objectives.find(
    ({ id }) => id === "badge-cascade",
  );
  const center = openMap("MAP_CERULEAN_CITY_POKEMON_CENTER_1F", {
    behaviors: { "3,1": "MB_PC" },
  });
  const observation = campaignObservation({
    map: center.id,
    party: [
      { slot: 0, species: 21, level: 18, hp: 42, maxHp: 42, moves: [64] },
      { slot: 1, species: 5, level: 28, hp: 78, maxHp: 78, moves: [52] },
    ],
  });
  observation.playerMemory.position = { x: 3, y: 2 };
  observation.playerMemory.trainer.storage = {
    pokemon: [
      { box: 0, slot: 0, species: 41, moves: [141] },
      { box: 0, slot: 1, species: 13, moves: [40] },
      { box: 0, slot: 2, species: 43, moves: [71] },
    ],
  };

  const roster = selectBattleRosterObjective({
    world: { maps: [center] },
    observation,
    objective,
    teamPlan,
  });

  assert.equal(roster?.id, "prepare-badge-cascade-roster");
  assert.equal(roster?.minimumBattlePartySize, 3);
  assert.equal(roster?.minimumCombatPartySize, 3);
  assert.equal(roster?.target.minimumPartySize, 3);
  assert.equal(roster?.target.maximumPartySize, 3);
  assert.equal(
    roster?.target.requiredFamilies[0].includes(43),
    true,
    "the Water counter must be selected ahead of neutral permanent members",
  );
});

test('battle roster preferences reserve a slot for the starter protected by the PC policy',()=>{
 const teamPlan=createMasterTeamPlan(7,0);
 const center=openMap('MAP_VIRIDIAN_CITY_POKEMON_CENTER_1F',{behaviors:{'3,1':'MB_PC'}});
 const observation=campaignObservation({map:center.id,party:[
  {slot:0,species:7,level:6,hp:22,moves:[33]},
  {slot:1,species:21,level:3,hp:16,moves:[64]},
  {slot:2,species:56,level:5,hp:20,moves:[10]},
 ]});
 observation.playerMemory.position={x:3,y:2};
 observation.playerMemory.trainer.storage={pokemon:[]};
 const objective={id:'rival-route22-early',importantBattle:true,minimumBattlePartySize:2,preferredFamilies:[[21,22],[56,57],[7,8,9]]};
 const roster=selectBattleRosterObjective({world:{maps:[center]},observation,objective,teamPlan});
 assert.equal(roster.target.maximumPartySize,2);
 assert.deepEqual(roster.target.requiredFamilies,[[21,22],[7,8,9]]);
 observation.playerMemory.trainer.party.pop();
 assert.equal(selectBattleRosterObjective({world:{maps:[center]},observation,objective,teamPlan}),null);
});

test("Misty preparation trains the matchup counter before a closer neutral member", () => {
  const teamPlan = createMasterTeamPlan(4, 2735793998, {
    selection: "legacy-seeded-v1",
  });
  const objective = createMasterCampaign(teamPlan).objectives.find(
    ({ id }) => id === "badge-cascade",
  );
  const route = openMap("MAP_ROUTE24", {
    connections: [{ direction: "down", map: "MAP_CERULEAN_CITY_GYM", offset: 0 }],
    encounters: { "1,1": 1, "2,1": 1 },
    behaviors: { "1,1": "MB_TALL_GRASS", "2,1": "MB_TALL_GRASS" },
  });
  const gym = openMap("MAP_CERULEAN_CITY_GYM", {
    connections: [{ direction: "up", map: route.id, offset: 0 }],
  });
  const world = {
    maps: [route, gym],
    wildEncounters: [{
      map: route.id,
      land_mons: {
        encounter_rate: 21,
        mons: [{ min_level: 8, max_level: 14, species: "SPECIES_ODDISH" }],
      },
    }],
  };
  const observation = campaignObservation({
    map: route.id,
    party: [
      { slot: 0, species: 21, level: 19, hp: 44, maxHp: 44, moves: [64] },
      { slot: 1, species: 5, level: 29, hp: 81, maxHp: 81, moves: [52] },
      { slot: 2, species: 43, level: 13, hp: 36, maxHp: 36, moves: [71] },
    ],
  });
  observation.playerMemory.position = { x: 1, y: 1 };

  const training = selectTrainingObjective({
    world,
    observation,
    objective,
    teamPlan,
  });

  assert.equal(training?.id, "train-battle-member");
  assert.equal(training?.trainingSpecies, 43);
  assert.equal(training?.trainingPartySlot, 2);
  assert.equal(training?.minimumTeamAnchorLevel, 23);
  assert.equal(training?.forObjective, "badge-cascade");
});

test("a selected Lapras is permanent while an unselected Snorlax is only cleared", () => {
  const teamPlan = createMasterTeamPlan(4, 2, {
    selection: "legacy-seeded-v1",
  });
  const campaign = createMasterCampaign(teamPlan);
  const objective = (id) => campaign.objectives.find((candidate) => candidate.id === id);

  assert.ok(teamPlan.acquisitions.some(({ id }) => id === "lapras"));
  assert.equal(teamPlan.acquisitions.some(({ id }) => id === "snorlax"), false);
  assert.equal(objective("gift-lapras")?.acquisitionId, "lapras");
  assert.equal(objective("prepare-lapras-party-space")?.acquisitionId, "lapras");
  assert.equal(objective("route16-snorlax-clear")?.captureSpecies, undefined);
  assert.equal(objective("route16-snorlax-clear")?.completion.kind, "flag-set");
  assert.equal(objective("route16-snorlax-clear")?.completion.id, 128);
});

test("the permanent-team policy disables pre-League mastery and Pokedex grinding", () => {
  const { world, story, mechanics } = postThunderMasteryFixture();
  const planner = createCampaignPlanner({
    campaign: { objectives: [{
      id: "continue-to-celadon",
      target: { kind: "map-arrival", map: "MAP_CELADON_CITY", x: 1, y: 1 },
      completion: { kind: "flag-set", id: 9999 },
    }] },
    teamPlan: createMasterTeamPlan(4, 0),
    world,
    story,
    mechanics,
  });

  assert.equal(planner.select(postThunderObservation())?.id, "continue-to-celadon");
});

test("the Origins team campaign inserts every native acquisition in story order", () => {
  const campaign = createOriginsCampaign(createOriginsTeamPlan(7));
  const ids = campaign.objectives.map(({ id }) => id);
  const objective = (id) => campaign.objectives.find((candidate) => candidate.id === id);

  assert.ok(ids.indexOf("rival-route22-early") > ids.indexOf("brock-mankey-capture"));
  assert.ok(ids.indexOf("rival-route22-early") < ids.indexOf("badge-boulder"));
  assert.ok(ids.indexOf("origins-persian-capture") > ids.indexOf("cerulean-rocket"));
  assert.ok(ids.indexOf("ensure-meowth-party") > ids.indexOf("origins-persian-capture"));
  assert.ok(ids.indexOf("origins-persian-capture") < ids.indexOf("rival-ss-anne"));
  assert.ok(ids.indexOf("vs-seeker") > ids.indexOf("cerulean-rocket"));
  assert.ok(ids.indexOf("vs-seeker") < ids.indexOf("rival-ss-anne"));
  assert.ok(ids.indexOf("prepare-eevee-party-space") < ids.indexOf("origins-eevee-gift"));
  assert.ok(ids.indexOf("origins-eevee-gift") < ids.indexOf("ensure-eevee-party"));
  assert.ok(ids.indexOf("ensure-eevee-party") < ids.indexOf("origins-thunder-stone"));
  assert.ok(ids.indexOf("origins-eevee-gift") > ids.indexOf("badge-thunder"));
  assert.ok(ids.indexOf("origins-jolteon-evolve") < ids.indexOf("badge-rainbow"));
  assert.ok(ids.indexOf("bike-voucher") > ids.indexOf("badge-thunder"));
  assert.ok(ids.indexOf("bike-voucher") < ids.indexOf("bicycle"));
  assert.ok(ids.indexOf("bicycle") < ids.indexOf("route16-snorlax"));
  assert.ok(ids.indexOf("route16-snorlax") > ids.indexOf("poke-flute"));
  assert.ok(ids.indexOf("ensure-route16-cut-carrier-party") > ids.indexOf("route16-snorlax"));
  assert.ok(ids.indexOf("ensure-route16-cut-carrier-party") < ids.indexOf("hm-fly"));
  assert.ok(ids.indexOf("origins-doduo-capture") > ids.indexOf("route16-snorlax"));
  assert.ok(ids.indexOf("hm-fly") > ids.indexOf("route16-snorlax"));
  assert.ok(ids.indexOf("hm-fly") < ids.indexOf("origins-doduo-capture"));
  assert.ok(ids.indexOf("ensure-fly-carrier-party") > ids.indexOf("origins-doduo-capture"));
  assert.ok(ids.indexOf("ensure-fly-carrier-party") < ids.indexOf("teach-fly"));
  assert.ok(ids.indexOf("teach-fly") > ids.indexOf("origins-doduo-capture"));
  assert.ok(ids.indexOf("prepare-lapras-party-space") > ids.indexOf("rival-silph"));
  assert.ok(ids.indexOf("prepare-lapras-party-space") < ids.indexOf("gift-lapras"));
  assert.ok(ids.indexOf("gift-lapras") < ids.indexOf("ensure-lapras-party"));
  assert.ok(ids.indexOf("ensure-lapras-party") < ids.indexOf("silph-eleventh-floor-door"));
  assert.ok(ids.indexOf("origins-scyther-capture") > ids.indexOf("hm-surf"));
  assert.ok(ids.indexOf("ensure-scyther-party") > ids.indexOf("origins-scyther-capture"));
  assert.ok(ids.indexOf("assemble-origins-roster") > ids.indexOf("ensure-scyther-party"));
  assert.ok(ids.indexOf("assemble-origins-roster") < ids.indexOf("badge-soul"));
  assert.ok(ids.indexOf("assemble-league-roster") < ids.indexOf("league-heal"));
  assert.equal(objective("assemble-league-roster").deferOptionalDetours, true);

  assert.deepEqual(objective("origins-persian-capture").captureSpecies, [52]);
  assert.deepEqual(objective("route16-snorlax").captureSpecies, [143]);
  assert.deepEqual(objective("route16-snorlax").captureFamily, [143]);
  assert.deepEqual(objective("route16-snorlax").completion, {
    kind: "flag-set",
    id: 128,
  });
  assert.deepEqual(objective("route16-snorlax").watchFlags, [128]);
  assert.equal(objective("ensure-route16-cut-carrier-party").deferOptionalDetours, true);
  assert.equal(objective("hm-fly").deferOptionalDetours, true);
  assert.equal(objective("ensure-fly-carrier-party").deferOptionalDetours, true);
  assert.equal(objective("teach-fly").deferOptionalDetours, true);
  assert.deepEqual(objective("origins-doduo-capture").captureSpecies, [84]);
  assert.deepEqual(objective("origins-thunder-stone").target.items, [
    { itemId: 96, stockIndex: 3, quantity: 1, unitPrice: 2100 },
  ]);
  assert.deepEqual(objective("bike-voucher").target, {
    kind: "object",
    map: "MAP_VERMILION_CITY_POKEMON_FAN_CLUB",
    index: 0,
  });
  assert.deepEqual(objective("bicycle").target, {
    kind: "object",
    map: "MAP_CERULEAN_CITY_BIKE_SHOP",
    index: 0,
  });
  assert.equal(objective("bike-voucher").choice, "yes");
  assert.equal(objective("bike-voucher").deferOptionalDetours, true);
  assert.equal(objective("bicycle").deferOptionalDetours, true);
  assert.deepEqual(objective("teach-fly").target.partySpecies, [84, 85]);
  assert.deepEqual(objective("origins-scyther-capture").captureSpecies, [123]);
  assert.equal(objective("origins-scyther-capture").safari, true);
  assert.equal(objective("origins-eevee-gift").choice, "no");
  assert.equal(objective("origins-eevee-gift").reservedPartySlots, 1);
  assert.deepEqual(objective("origins-eevee-gift").completion, {
    kind: "owned-species",
    species: [133, 134, 135, 136],
  });
  assert.deepEqual(objective("ensure-eevee-party").target.requiredFamilies, [
    [133, 134, 135, 136],
  ]);
  assert.equal(objective("gift-lapras").choice, "no");
  assert.equal(objective("gift-lapras").reservedPartySlots, 1);
  assert.deepEqual(objective("gift-lapras").completion, {
    kind: "owned-species",
    species: [131],
  });
  assert.deepEqual(objective("ensure-lapras-party").target.requiredFamilies, [[131]]);
  assert.deepEqual(objective("assemble-origins-roster").target.requiredFamilies, [
    [7, 8, 9],
    [133, 134, 135, 136],
    [131],
    [123],
    [84, 85],
    [52, 53],
  ]);
  assert.equal(
    objective("assemble-origins-roster").target.map,
    "MAP_FUCHSIA_CITY_POKEMON_CENTER_1F",
  );
  assert.deepEqual(objective("assemble-league-roster").target.requiredFamilies, [
    [7, 8, 9],
    [133, 134, 135, 136],
    [131],
    [123],
    [84, 85],
    [52, 53],
  ]);
});

test("the first-clear Pokemon League uses a balanced five-member level-65 gate", () => {
  const campaign = createOriginsCampaign(createOriginsTeamPlan(4));
  for (const id of [
    "elite-four-lorelei",
    "elite-four-bruno",
    "elite-four-agatha",
    "elite-four-lance",
    "champion",
  ]) {
    const objective = campaign.objectives.find((candidate) => candidate.id === id);
    assert.equal(objective?.starterBattleTargetLevel, 65, id);
    assert.equal(objective?.supportBattleTargetLevel, 65, id);
    assert.equal(objective?.minimumReadyBattleMembers, 5, id);
  }
});

test("the researched first-clear League gate actively balances the lowest teammate", () => {
  const teamPlan = createOriginsTeamPlan(4);
  const objective = createOriginsCampaign(teamPlan).objectives.find(
    ({ id }) => id === "champion",
  );
  const route = openMap("MAP_ROUTE12", {
    encounters: { "1,1": 1, "2,1": 1 },
    behaviors: { "1,1": "MB_TALL_GRASS", "2,1": "MB_TALL_GRASS" },
  });
  const observation = campaignObservation({
    map: route.id,
    party: [
      { slot: 0, species: 53, level: 51, hp: 140, maxHp: 140, heldItem: 163, moves: [185] },
      { slot: 1, species: 131, level: 64, hp: 245, maxHp: 245, heldItem: 189, moves: [57] },
      { slot: 2, species: 85, level: 63, hp: 158, maxHp: 158, heldItem: 182, moves: [65] },
      { slot: 3, species: 123, level: 63, hp: 164, maxHp: 164, heldItem: 0, moves: [206] },
      { slot: 4, species: 135, level: 63, hp: 156, maxHp: 156, heldItem: 0, moves: [86] },
      { slot: 5, species: 6, level: 69, hp: 202, maxHp: 202, heldItem: 0, moves: [53] },
    ],
  });
  observation.playerMemory.position = { x: 1, y: 1 };

  const training = selectTrainingObjective({
    world: {
      maps: [route],
      wildEncounters: [{
        map: route.id,
        land_mons: {
          encounter_rate: 25,
          mons: [{ min_level: 24, max_level: 27, species: "SPECIES_GLOOM" }],
        },
      }],
    },
    observation,
    objective,
    teamPlan,
  });

  assert.equal(objective?.starterBattleTargetLevel, 65);
  assert.equal(objective?.supportBattleTargetLevel, 65);
  assert.equal(objective?.minimumReadyBattleMembers, 5);
  assert.equal(training?.trainingMode, undefined);
  assert.equal(training?.trainingPartySlot, 0);
  assert.equal(training?.expSharePartySlot, 2);
  assert.equal(training?.minimumTeamAnchorLevel, 65);
  assert.equal(training?.target.kind, "encounter-zone");
});

test("the final Origins acquisition immediately retires the HM utility slot", () => {
  const teamPlan = createOriginsTeamPlan(4);
  const campaign = createOriginsCampaign(teamPlan);
  const finalAcquisitionIndex = campaign.objectives.findIndex(
    ({ id }) => id === "ensure-scyther-party",
  );
  const planner = createCampaignPlanner({
    campaign: { objectives: campaign.objectives.slice(finalAcquisitionIndex) },
  });
  const observation = campaignObservation({
    map: "MAP_FUCHSIA_CITY_POKEMON_CENTER_1F",
    party: [
      { slot: 0, species: 6, level: 48, hp: 144, maxHp: 144, moves: [53] },
      { slot: 1, species: 135, level: 43, hp: 110, maxHp: 110, moves: [86] },
      { slot: 2, species: 131, level: 43, hp: 170, maxHp: 170, moves: [57] },
      { slot: 3, species: 85, level: 43, hp: 112, maxHp: 112, moves: [19] },
      { slot: 4, species: 123, level: 30, hp: 82, maxHp: 82, moves: [206] },
      { slot: 5, species: 47, level: 25, hp: 71, maxHp: 71, moves: [15, 148, 249] },
    ],
  });
  observation.playerMemory.trainer.storage = {
    pokemon: [{ box: 0, slot: 28, species: 53, moves: [10, 185, 44, 6] }],
  };

  const objective = planner.select(observation);

  assert.equal(objective?.id, "assemble-origins-roster");
  assert.deepEqual(objective?.target.requiredFamilies, [
    [4, 5, 6],
    [133, 134, 135, 136],
    [131],
    [123],
    [84, 85],
    [52, 53],
  ]);
});

test("the main campaign earns Gym badges in badge-case order", () => {
  assert.deepEqual(
    MAIN_STORY_CAMPAIGN.objectives
      .map(({ id }) => id)
      .filter((id) => id.startsWith("badge-")),
    [
      "badge-boulder",
      "badge-cascade",
      "badge-thunder",
      "badge-rainbow",
      "badge-soul",
      "badge-marsh",
      "badge-volcano",
      "badge-earth",
    ],
  );
});

test("clearing Route 16 Snorlax stages a Cut carrier before Fly", () => {
  const originsCampaign = createOriginsCampaign(createOriginsTeamPlan(7));
  const objective = (id) => originsCampaign.objectives.find(
    (candidate) => candidate.id === id,
  );
  const cutCarrier = objective("ensure-route16-cut-carrier-party");
  assert.ok(cutCarrier);
  const objectives = [objective("route16-snorlax"), cutCarrier, objective("hm-fly")];
  const select = (observation) => createCampaignPlanner({
    campaign: { objectives },
  }).select(observation);

  assert.deepEqual(objective("route16-snorlax").captureSpecies, [143]);
  assert.deepEqual(objective("route16-snorlax").captureFamily, [143]);

  const withoutCut = select(campaignObservation({
    map: "MAP_ROUTE16",
    flags: { 128: true, 568: false },
    party: [{ slot: 0, species: 25, level: 30, hp: 70, moves: [] }],
  }));
  assert.equal(withoutCut?.id, "ensure-route16-cut-carrier-party");

  const withCut = select(campaignObservation({
    map: "MAP_ROUTE16",
    flags: { 128: true, 568: false },
    party: [{ slot: 0, species: 46, level: 20, hp: 50, moves: [15] }],
  }));
  assert.equal(withCut?.id, "hm-fly");
});

test("Route 12 remains a campaign Snorlax catch after a Route 16 miss", () => {
  const originsCampaign = createOriginsCampaign(createOriginsTeamPlan(7));
  const objective = (id) => originsCampaign.objectives.find(
    (candidate) => candidate.id === id,
  );
  const route12Snorlax = objective("route12-snorlax");
  const planner = createCampaignPlanner({
    campaign: {
      objectives: [route12Snorlax, objective("gold-teeth")],
    },
  });

  assert.deepEqual(route12Snorlax.captureSpecies, [143]);
  assert.deepEqual(route12Snorlax.captureFamily, [143]);
  assert.equal(planner.select(campaignObservation({
    map: "MAP_ROUTE12",
    flags: { 84: true, 393: false },
  }))?.id, "route12-snorlax");

  const caught = campaignObservation({
    map: "MAP_ROUTE12",
    flags: { 84: true, 393: false },
  });
  caught.playerMemory.trainer.pokedex = { ownedSpecies: [143] };
  assert.equal(planner.select(caught)?.id, "gold-teeth");
});

test("the Celadon campaign acquires the Coin Case before using the Game Corner", () => {
  const campaign = createOriginsCampaign(createOriginsTeamPlan(7));
  const coinCase = campaign.objectives.find(({ id }) => id === "coin-case");
  assert.ok(coinCase);
  assert.deepEqual(coinCase.target, {
    kind: "object",
    map: "MAP_CELADON_CITY_RESTAURANT",
    index: 3,
  });
  const planner = createCampaignPlanner({
    campaign: { objectives: [
      coinCase,
      {
        id: "continue-celadon",
        target: { kind: "map-arrival", map: "MAP_CELADON_CITY", x: 1, y: 1 },
        completion: { kind: "flag-set", id: 9999 },
      },
    ] },
  });
  const withoutCase = campaignObservation({
    flags: { 579: false },
    bag: { keyItems: [] },
  });
  assert.equal(planner.select(withoutCase)?.id, "coin-case");

  const withCase = campaignObservation({
    flags: { 579: false },
    bag: { keyItems: [{ itemId: 260, quantity: 1 }] },
  });
  assert.equal(planner.select(withCase)?.id, "continue-celadon");
});

test("important battles use their authored squad size and readiness floor", () => {
  const campaign = createOriginsCampaign(createOriginsTeamPlan(4));
  assert.deepEqual(
    CAMPAIGN_MAJOR_BATTLE_LEVEL_TARGETS["rival-oaks-lab"],
    {
      category: "tutorial-rival",
      enemyPartyLevels: [5],
      enemyPartySize: 1,
      enemyAceLevel: 5,
      starterBattleTargetLevel: 5,
      supportBattleTargetLevel: 5,
      minimumReadyBattleMembers: 1,
      battleTeamTargetLevel: 5,
      preparationAvailable: false,
    },
    "the unavoidable opening rival must still be present in the campaign battle inventory",
  );
  const expectedBosses = new Map([
    ["rival-route22-early", { partySize: 2, levels: [9, 9] }],
    ["badge-boulder", { partySize: 2, levels: [12, 14] }],
    ["rival-cerulean", { partySize: 3, levels: [17, 16, 15, 18] }],
    ["badge-cascade", { partySize: 3, levels: [18, 21] }],
    ["rival-ss-anne", { partySize: 4, levels: [19, 16, 18, 20] }],
    ["badge-thunder", { partySize: 4, levels: [21, 18, 24] }],
    ["badge-rainbow", { partySize: 3, levels: [29, 24, 29] }],
    ["rocket-hideout-giovanni", { partySize: 5, levels: [25, 24, 29] }],
    ["rival-pokemon-tower", { partySize: 5, levels: [25, 23, 22, 20, 25] }],
    ["rival-silph", { partySize: 6, levels: [37, 38, 35, 35, 40] }],
    ["silph-liberated", { partySize: 6, levels: [37, 35, 37, 41] }],
    ["badge-soul", { partySize: 6, levels: [37, 39, 37, 43] }],
    ["badge-marsh", { partySize: 6, levels: [38, 37, 38, 43] }],
    ["badge-volcano", { partySize: 6, levels: [42, 40, 42, 47] }],
    ["badge-earth", { partySize: 6, levels: [45, 42, 44, 45, 50] }],
    ["rival-route22-late", { partySize: 6, levels: [47, 45, 45, 45, 47, 53] }],
    ["elite-four-lorelei", { partySize: 6, levels: [52, 51, 52, 54, 54] }],
    ["elite-four-bruno", { partySize: 6, levels: [51, 53, 53, 54, 56] }],
    ["elite-four-agatha", { partySize: 6, levels: [54, 54, 53, 56, 58] }],
    ["elite-four-lance", { partySize: 6, levels: [56, 54, 54, 58, 60] }],
    ["champion", { partySize: 6, levels: [59, 57, 59, 59, 61, 63] }],
  ]);

  for (const [id, { partySize, levels }] of expectedBosses) {
    const aceLevel = Math.max(...levels);
    const leagueBattle = id.startsWith("elite-four-") || id === "champion";
    const balancedTarget = leagueBattle ? 65 : aceLevel + 2;
    const readyMembers = leagueBattle ? 5 : levels.length;
    const objective = campaign.objectives.find((candidate) => candidate.id === id);
    assert.equal(objective?.importantBattle, true, `${id} must prepare its squad`);
    assert.equal(
      objective?.minimumBattlePartySize,
      partySize,
      `${id} must require ${partySize} active team members`,
    );
    assert.equal(
      objective?.enemyAceLevel,
      aceLevel,
      `${id} must identify its level-${aceLevel} enemy ace`,
    );
    assert.deepEqual(
      objective?.enemyPartyLevels,
      levels,
      `${id} must author the complete enemy party level curve`,
    );
    assert.equal(
      objective?.minimumBattleMemberLevel,
      balancedTarget,
      `${id} must train every battle member to level ${balancedTarget}`,
    );
    assert.equal(
      objective?.starterBattleTargetLevel,
      balancedTarget,
      `${id} must train the starter to level ${balancedTarget}`,
    );
    assert.equal(
      objective?.supportBattleTargetLevel,
      balancedTarget,
      `${id} must expose the same balanced teammate target`,
    );
    assert.equal(
      objective?.minimumReadyBattleMembers,
      readyMembers,
      `${id} must prepare ${readyMembers} battle members`,
    );
    assert.equal(
      objective?.battleTeamTargetLevel,
      balancedTarget,
      `${id} must expose its authored whole-team target`,
    );
    assert.equal(
      objective?.maximumTeamLevelGap,
      undefined,
      `${id} must not derive its target from the current team spread`,
    );
  }
  assert.equal(
    new Set(campaign.objectives
      .filter(({ importantBattle }) => importantBattle)
      .map(({ id, rosterPreparationFor }) => rosterPreparationFor ?? id)).size,
    expectedBosses.size,
    "every main-campaign rival, Gym Leader, boss, Elite Four member, and Champion must be mapped",
  );
});

test("the Rocket Hideout entrance prepares Giovanni's Origins-aligned squad", () => {
  const teamPlan = createOriginsTeamPlan(4);
  const campaign = createOriginsCampaign(teamPlan);
  const poster = campaign.objectives.find(
    ({ id }) => id === "rocket-hideout-poster",
  );
  const center = openMap("MAP_CELADON_CITY_POKEMON_CENTER_1F", {
    behaviors: { "3,1": "MB_PC" },
  });
  const observation = campaignObservation({
    map: center.id,
    party: [
      { slot: 0, species: 33, level: 25, hp: 66, maxHp: 66, moves: [24] },
      { slot: 1, species: 6, level: 38, hp: 78, maxHp: 120, moves: [53] },
      { slot: 2, species: 135, level: 25, hp: 67, maxHp: 67, moves: [98] },
      { slot: 3, species: 47, level: 30, hp: 84, maxHp: 84, moves: [15, 148] },
    ],
  });
  observation.playerMemory.position = { x: 3, y: 2 };
  observation.playerMemory.trainer.storage = {
    pokemon: [
      { box: 0, slot: 0, species: 53, moves: [44] },
      { box: 0, slot: 1, species: 84, moves: [64] },
    ],
  };

  const roster = selectBattleRosterObjective({
    world: { maps: [center] },
    observation,
    objective: poster,
    teamPlan,
  });

  assert.equal(poster?.rosterPreparationFor, "rocket-hideout-giovanni");
  assert.equal(poster?.minimumBattlePartySize, 5);
  assert.equal(poster?.minimumBattleMemberLevel, 31);
  assert.equal(poster?.starterBattleTargetLevel, 31);
  assert.equal(poster?.minimumReadyBattleMembers, 3);
  assert.equal(roster?.id, "prepare-rocket-hideout-giovanni-roster");
  assert.equal(roster?.forObjective, "rocket-hideout-giovanni");
  assert.equal(roster?.currentBattlePartySize, 3);
  assert.equal(roster?.target.minimumPartySize, 4);
  assert.equal(roster?.target.maximumPartySize, 4);
  assert.equal(roster?.target.excludeHmUtilityCarriers, undefined);
  assert.deepEqual(roster?.target.requiredFamilies, [
    [4, 5, 6],
    [133, 134, 135, 136],
    [84, 85],
    [46, 47],
  ]);
});

test("an unreachable misaligned boss roster stays blocked instead of appearing ready", () => {
  const teamPlan = createOriginsTeamPlan(4);
  const bossMap = openMap("MAP_ROCKET_HIDEOUT_B4F");
  const observation = campaignObservation({
    map: bossMap.id,
    party: [
      { slot: 0, species: 33, level: 25, hp: 66, maxHp: 66, moves: [24] },
      { slot: 1, species: 6, level: 38, hp: 78, maxHp: 120, moves: [53] },
      { slot: 2, species: 135, level: 25, hp: 67, maxHp: 67, moves: [98] },
      { slot: 3, species: 47, level: 30, hp: 84, maxHp: 84, moves: [15, 148] },
    ],
  });
  observation.playerMemory.position = { x: 2, y: 2 };
  observation.playerMemory.trainer.storage = {
    pokemon: [
      { box: 0, slot: 0, species: 53, moves: [44] },
      { box: 0, slot: 1, species: 84, moves: [64] },
    ],
  };
  const objective = createOriginsCampaign(teamPlan).objectives.find(
    ({ id }) => id === "rocket-hideout-giovanni",
  );

  const roster = selectBattleRosterObjective({
    world: { maps: [bossMap] },
    observation,
    objective,
    teamPlan,
  });

  assert.equal(roster?.id, "prepare-rocket-hideout-giovanni-roster");
  assert.equal(roster?.blockedReason, "no-reachable-pokemon-center");
  assert.deepEqual(roster?.target, {
    kind: "roster-preparation-blocked",
    map: bossMap.id,
  });
  assert.equal(roster?.currentBattlePartySize, 3);
  assert.equal(roster?.minimumBattlePartySize, 3);
});

test("Misty preparation keeps two combat members plus HM revive support", () => {
  const teamPlan = createOriginsTeamPlan(4);
  const objective = createOriginsCampaign(teamPlan).objectives.find(
    ({ id }) => id === "badge-cascade",
  );
  const center = openMap("MAP_CERULEAN_CITY_POKEMON_CENTER_1F", {
    behaviors: { "3,1": "MB_PC" },
  });
  const observation = campaignObservation({
    map: center.id,
    party: [
      { slot: 0, species: 5, level: 22, hp: 60, maxHp: 60, moves: [52] },
      { slot: 1, species: 43, level: 21, hp: 50, maxHp: 50, moves: [71] },
      { slot: 2, species: 19, level: 20, hp: 48, maxHp: 48, moves: [33] },
      { slot: 3, species: 16, level: 18, hp: 44, maxHp: 44, moves: [17] },
      { slot: 4, species: 46, level: 12, hp: 35, maxHp: 35, moves: [15, 148] },
    ],
  });
  observation.playerMemory.position = { x: 3, y: 2 };
  observation.playerMemory.trainer.storage = { pokemon: [] };

  const roster = selectBattleRosterObjective({
    world: { maps: [center] },
    observation,
    objective,
    teamPlan,
  });

  assert.equal(roster?.id, "prepare-badge-cascade-roster");
  assert.equal(roster?.currentBattlePartySize, 4);
  assert.equal(roster?.minimumBattlePartySize, 2);
  assert.equal(roster?.desiredBattlePartySize, 2);
  assert.equal(roster?.target.minimumPartySize, 3);
  assert.equal(roster?.target.maximumPartySize, 3);
  assert.equal(roster?.target.excludeHmUtilityCarriers, undefined);
  assert.equal(
    roster?.target.requiredFamilies.some((family) => family.includes(46)),
    true,
  );
});

test("Surge preparation keeps Cut as one utility slot outside his three battlers", () => {
  const teamPlan = createOriginsTeamPlan(4);
  const objective = createOriginsCampaign(teamPlan).objectives.find(
    ({ id }) => id === "badge-thunder",
  );
  const center = openMap("MAP_VERMILION_CITY_POKEMON_CENTER_1F", {
    behaviors: { "3,1": "MB_PC" },
  });
  const observation = campaignObservation({
    map: center.id,
    party: [
      { slot: 0, species: 5, level: 25, hp: 70, maxHp: 70, moves: [53] },
      { slot: 1, species: 16, level: 24, hp: 60, maxHp: 60, moves: [17] },
      { slot: 2, species: 19, level: 24, hp: 58, maxHp: 58, moves: [33] },
      { slot: 3, species: 43, level: 24, hp: 62, maxHp: 62, moves: [75] },
      { slot: 4, species: 52, level: 23, hp: 60, maxHp: 60, moves: [33] },
      { slot: 5, species: 46, level: 16, hp: 45, maxHp: 45, moves: [15, 148] },
    ],
  });
  observation.playerMemory.position = { x: 3, y: 2 };
  observation.playerMemory.trainer.storage = { pokemon: [] };

  const roster = selectBattleRosterObjective({
    world: { maps: [center] },
    observation,
    objective,
    teamPlan,
  });

  assert.equal(roster?.id, "prepare-badge-thunder-roster");
  assert.equal(roster?.currentBattlePartySize, 5);
  assert.equal(roster?.minimumBattlePartySize, 3);
  assert.equal(roster?.desiredBattlePartySize, 3);
  assert.equal(roster?.target.minimumPartySize, 4);
  assert.equal(roster?.target.maximumPartySize, 4);
  assert.equal(roster?.target.excludeHmUtilityCarriers, undefined);
  assert.equal(
    roster?.target.requiredFamilies.some((family) => family.includes(46)),
    true,
  );
});

test("late major battles reserve one party slot for HM revive support", () => {
  const teamPlan = createOriginsTeamPlan(4);
  const objective = {
    id: "rival-silph",
    target: { kind: "trigger", map: "MAP_SILPH_CO_7F", index: 0 },
    importantBattle: true,
    minimumBattlePartySize: 6,
    battleTeamTargetLevel: 45,
    minimumBattleMemberLevel: 45,
  };
  const center = openMap("MAP_SAFFRON_CITY_POKEMON_CENTER_1F", {
    behaviors: { "3,1": "MB_PC" },
  });
  const observation = campaignObservation({
    map: center.id,
    party: [
      { slot: 0, species: 6, level: 50, hp: 150, maxHp: 150, moves: [53] },
      { slot: 1, species: 135, level: 45, hp: 110, maxHp: 110, moves: [85] },
      { slot: 2, species: 85, level: 45, hp: 112, maxHp: 112, moves: [65] },
      { slot: 3, species: 53, level: 45, hp: 108, maxHp: 108, moves: [44] },
      { slot: 4, species: 33, level: 45, hp: 115, maxHp: 115, moves: [24] },
      { slot: 5, species: 46, level: 12, hp: 36, maxHp: 36, moves: [15, 148, 249] },
    ],
  });
  observation.playerMemory.position = { x: 3, y: 2 };
  observation.playerMemory.trainer.storage = { pokemon: [] };

  assert.equal(selectBattleRosterObjective({
    world: { maps: [center] },
    observation,
    objective,
    teamPlan,
  }), null);
  assert.equal(selectTrainingObjective({
    world: { maps: [center], wildEncounters: [] },
    observation,
    objective,
    teamPlan,
  }), null);
});

test("a complete Origins roster replaces HM utility before the Pokemon League", () => {
  const teamPlan = createOriginsTeamPlan(4);
  const objective = createOriginsCampaign(teamPlan).objectives.find(
    ({ id }) => id === "champion",
  );
  const center = openMap("MAP_INDIGO_PLATEAU_POKEMON_CENTER_1F", {
    behaviors: { "3,1": "MB_PC" },
  });
  const observation = campaignObservation({
    map: center.id,
    party: [
      { slot: 0, species: 135, level: 58, hp: 145, maxHp: 145, moves: [86] },
      { slot: 1, species: 131, level: 63, hp: 241, maxHp: 241, moves: [57] },
      { slot: 2, species: 6, level: 68, hp: 199, maxHp: 199, moves: [53] },
      { slot: 3, species: 85, level: 54, hp: 137, maxHp: 137, moves: [19] },
      { slot: 4, species: 123, level: 55, hp: 145, maxHp: 145, moves: [206] },
      { slot: 5, species: 47, level: 25, hp: 71, maxHp: 71, moves: [15, 148, 249] },
    ],
  });
  observation.playerMemory.position = { x: 3, y: 2 };
  observation.playerMemory.trainer.storage = {
    pokemon: [{ box: 0, slot: 28, species: 53, moves: [10, 185, 44, 6] }],
  };

  const roster = selectBattleRosterObjective({
    world: { maps: [center] },
    observation,
    objective,
    teamPlan,
  });

  assert.equal(roster?.id, "prepare-champion-roster");
  assert.equal(roster?.currentBattlePartySize, 5);
  assert.equal(roster?.minimumCombatPartySize, 6);
  assert.equal(roster?.target.minimumPartySize, 6);
  assert.equal(roster?.target.maximumPartySize, 6);
  assert.equal(roster?.target.excludeHmUtilityCarriers, true);
  assert.deepEqual(roster?.target.requiredFamilies, [
    [4, 5, 6],
    [133, 134, 135, 136],
    [131],
    [123],
    [84, 85],
    [52, 53],
  ]);
});

test("Koga roster readiness matches his four combatants instead of six slots", () => {
  const teamPlan = createOriginsTeamPlan(4);
  const objective = createOriginsCampaign(teamPlan).objectives.find(
    ({ id }) => id === "badge-soul",
  );
  const center = openMap("MAP_FUCHSIA_CITY_POKEMON_CENTER_1F", {
    behaviors: { "3,1": "MB_PC" },
  });
  const observation = campaignObservation({
    map: center.id,
    party: [
      { slot: 0, species: 6, level: 48, hp: 144, maxHp: 144, moves: [53] },
      { slot: 1, species: 131, level: 43, hp: 170, maxHp: 170, moves: [57] },
      { slot: 2, species: 135, level: 43, hp: 110, maxHp: 110, moves: [86] },
      { slot: 3, species: 85, level: 43, hp: 112, maxHp: 112, moves: [65] },
      { slot: 4, species: 46, level: 10, hp: 29, maxHp: 29, moves: [15, 148] },
    ],
  });
  observation.playerMemory.position = { x: 3, y: 2 };
  observation.playerMemory.trainer.storage = { pokemon: [] };

  assert.equal(selectBattleRosterObjective({
    world: { maps: [center], wildEncounters: [] },
    observation,
    objective,
    teamPlan,
  }), null);
});

test("Erika preparation keeps the available Origins trio plus the Cut carrier", () => {
  const teamPlan = createOriginsTeamPlan(4);
  const objective = createOriginsCampaign(teamPlan).objectives.find(
    ({ id }) => id === "badge-rainbow",
  );
  const center = openMap("MAP_CELADON_CITY_POKEMON_CENTER_1F", {
    behaviors: { "3,1": "MB_PC" },
  });
  const party = [
    { slot: 0, species: 74, level: 22, hp: 52, maxHp: 52, moves: [33] },
    { slot: 1, species: 47, level: 27, hp: 66, maxHp: 66, moves: [15, 148] },
    { slot: 2, species: 53, level: 30, hp: 71, maxHp: 71, moves: [44] },
    { slot: 3, species: 5, level: 34, hp: 76, maxHp: 76, moves: [53] },
    { slot: 4, species: 135, level: 34, hp: 74, maxHp: 74, moves: [84] },
    { slot: 5, species: 22, level: 42, hp: 108, maxHp: 108, moves: [65] },
  ];
  const observation = campaignObservation({ map: center.id, party });
  observation.playerMemory.position = { x: 3, y: 2 };
  observation.playerMemory.trainer.storage = { pokemon: [] };

  assert.equal(objective?.minimumBattlePartySize, 3);
  assert.equal(objective?.minimumBattleMemberLevel, 31);
  assert.equal(objective?.starterBattleTargetLevel, 31);
  assert.equal(objective?.supportBattleTargetLevel, 31);
  assert.equal(objective?.minimumReadyBattleMembers, 3);
  assert.equal(objective?.battleTeamTargetLevel, 31);
  assert.equal(objective?.minimumCoreLevel, 28);
  assert.deepEqual(objective?.coreSpecies, [4, 5, 6]);
  assert.equal(objective?.maximumTeamLevelGap, undefined);
  assert.equal(objective?.trainerTrainingAllowed, false);

  const planner = createCampaignPlanner({
    campaign: { objectives: [objective] },
    teamPlan,
  });
  assert.deepEqual(
    planner.selectBattleSquad(observation).map(({ slot, species }) => ({ slot, species })),
    [
      { slot: 3, species: 5 },
      { slot: 4, species: 135 },
      { slot: 5, species: 22 },
    ],
  );

  const roster = selectBattleRosterObjective({
    world: { maps: [center] },
    observation,
    objective,
    teamPlan,
  });
  assert.equal(roster?.target.minimumPartySize, 4);
  assert.equal(roster?.target.maximumPartySize, 4);
  assert.deepEqual(roster?.target.requiredFamilies, [
    [4, 5, 6],
    [133, 134, 135, 136],
    [21, 22],
    [47],
  ]);

  assert.equal(
    selectTrainingObjective({
      world: { maps: [center], wildEncounters: [] },
      observation,
      objective,
      teamPlan,
    }),
    null,
    "incidental Geodude and Persian levels must not hold Erika preparation open",
  );
});

test("Origins Erika readiness uses wild battles even when a trainer is available", () => {
  const teamPlan = createOriginsTeamPlan(4);
  const objective = createOriginsCampaign(teamPlan).objectives.find(
    ({ id }) => id === "badge-rainbow",
  );
  const route = openMap("MAP_ROUTE7", {
    connections: [{ direction: "east", map: "MAP_CELADON_CITY_GYM", offset: 0 }],
    objectEvents: [{ x: 3, y: 1, script: "Route7_EventScript_Trainer" }],
    encounters: { "1,1": 1, "2,1": 1 },
    behaviors: { "1,1": "MB_TALL_GRASS", "2,1": "MB_TALL_GRASS" },
  });
  const gym = openMap("MAP_CELADON_CITY_GYM", {
    connections: [{ direction: "west", map: route.id, offset: 0 }],
    objectEvents: [{ x: 3, y: 1, script: "CeladonCity_Gym_EventScript_Erika" }],
  });
  const world = {
    maps: [route, gym],
    wildEncounters: [{
      map: route.id,
      land_mons: {
        encounter_rate: 20,
        mons: [{ min_level: 19, max_level: 22, species: "SPECIES_GROWLITHE" }],
      },
    }],
  };
  const observation = campaignObservation({
    map: route.id,
    flags: { 3000: false },
    party: [
      { slot: 0, species: 5, level: 25, hp: 70, maxHp: 70, moves: [53] },
      { slot: 1, species: 135, level: 23, hp: 62, maxHp: 62, moves: [84] },
      { slot: 2, species: 22, level: 23, hp: 64, maxHp: 64, moves: [65] },
    ],
  });
  observation.playerMemory.position = { x: 1, y: 1 };

  const training = selectTrainingObjective({
    world,
    observation,
    objective,
    teamPlan,
    trainerCatalog: [{
      id: "route7-trainer",
      name: "TRAINER_LASS_ROUTE7",
      displayName: "Lass",
      flagId: 3000,
      minimumLevel: 18,
      maximumLevel: 20,
      partySize: 2,
      target: { kind: "object", map: route.id, index: 0 },
    }],
  });

  assert.equal(training?.id, "train-battle-member");
  assert.equal(training?.target.kind, "encounter-zone");
  assert.equal(training?.target.map, route.id);
  assert.equal(training?.trainingSource, undefined);
  assert.equal(training?.trainingPartySlot, 1);
  assert.equal(training?.minimumTeamAnchorLevel, 31);
});

test("the planner exposes only the next incomplete boss's staged combat squad", () => {
  const teamPlan = createOriginsTeamPlan(4);
  const planner = createCampaignPlanner({
    teamPlan,
    campaign: { objectives: [
      {
        id: "finished-brock",
        importantBattle: true,
        minimumBattlePartySize: 2,
        coreSpecies: [4, 5, 6],
        target: { kind: "object", map: "MAP_PEWTER_CITY_GYM", index: 0 },
        completion: { kind: "flag-set", id: 1 },
      },
      {
        id: "next-misty",
        importantBattle: true,
        minimumBattlePartySize: 3,
        coreSpecies: [43, 44, 45],
        target: { kind: "object", map: "MAP_CERULEAN_CITY_GYM", index: 2 },
        completion: { kind: "flag-set", id: 2 },
      },
    ] },
  });
  const observation = campaignObservation({
    flags: { 1: true, 2: false },
    party: [
      { slot: 0, species: 5, level: 21, hp: 60, maxHp: 60, moves: [52] },
      { slot: 1, species: 43, level: 23, hp: 54, maxHp: 54, moves: [71] },
      { slot: 2, species: 19, level: 20, hp: 50, maxHp: 50, moves: [33] },
      { slot: 3, species: 16, level: 4, hp: 18, maxHp: 18, moves: [33] },
      { slot: 4, species: 46, level: 5, hp: 20, maxHp: 20, moves: [15, 148] },
    ],
  });

  assert.deepEqual(
    planner.selectBattleSquad(observation).map(({ slot, species }) => ({ slot, species })),
    [
      { slot: 1, species: 43 },
      { slot: 0, species: 5 },
      { slot: 2, species: 19 },
    ],
  );
});

test("cartridge trainer parties update the enemy ace without lowering first-clear League floors", () => {
  const mechanics = {
    trainers: [{
      name: "TRAINER_ELITE_FOUR_LANCE",
      party: [{ lvl: 56 }, { lvl: 61 }, { lvl: 58 }],
    }],
  };
  const objective = createOriginsCampaign(createOriginsTeamPlan(4), {
    mechanics,
  }).objectives.find(({ id }) => id === "elite-four-lance");

  assert.equal(objective.enemyAceLevel, 61);
  assert.equal(objective.battleTeamTargetLevel, 65);
  assert.equal(objective.starterBattleTargetLevel, 65);
  assert.equal(objective.supportBattleTargetLevel, 65);
  assert.equal(objective.minimumReadyBattleMembers, 5);
  assert.equal(objective.minimumBattleMemberLevel, 65);
});

test("a Gym prepares its battle squad to one balanced ace-plus-two target", () => {
  const mechanics = {
    trainers: [{
      name: "TRAINER_LEADER_MISTY",
      party: [{ lvl: 18 }, { lvl: 21 }],
    }],
  };
  const objective = createOriginsCampaign(createOriginsTeamPlan(4), {
    mechanics,
  }).objectives.find(({ id }) => id === "badge-cascade");
  const route = openMap("MAP_ROUTE24", {
    connections: [{ direction: "down", map: "MAP_CERULEAN_CITY_GYM", offset: 0 }],
    encounters: { "1,1": 1, "2,1": 1 },
    behaviors: { "1,1": "MB_TALL_GRASS", "2,1": "MB_TALL_GRASS" },
  });
  const gym = openMap("MAP_CERULEAN_CITY_GYM", {
    connections: [{ direction: "up", map: route.id, offset: 0 }],
    objectEvents: [{ x: 3, y: 1, script: "CeruleanCity_Gym_EventScript_Misty" }],
  });
  const world = {
    maps: [route, gym],
    wildEncounters: [{
      map: route.id,
      land_mons: {
        encounter_rate: 21,
        mons: [{ min_level: 8, max_level: 14, species: "SPECIES_ODDISH" }],
      },
    }],
  };
  const observation = campaignObservation({
    map: route.id,
    party: [
      { slot: 0, species: 5, level: 26, hp: 73, maxHp: 73, moves: [52] },
      { slot: 1, species: 43, level: 20, hp: 50, maxHp: 50, moves: [71] },
      { slot: 2, species: 46, level: 15, hp: 40, maxHp: 40, moves: [10] },
    ],
  });
  observation.playerMemory.position = { x: 1, y: 1 };

  assert.equal(objective.gymLeaderAceLevel, 21);
  assert.equal(objective.minimumBattleMemberLevel, 23);
  assert.equal(objective.starterBattleTargetLevel, 23);
  assert.equal(objective.supportBattleTargetLevel, 23);
  assert.equal(objective.battleTeamTargetLevel, 23);
  assert.equal(objective.maximumTeamLevelGap, undefined);
  const training = selectTrainingObjective({
    world,
    observation,
    objective,
    teamPlan: createOriginsTeamPlan(4),
  });
  assert.equal(training?.id, "train-battle-member");
  assert.equal(training?.trainingPartySlot, 1);
  assert.equal(training?.currentTeamAnchorLevel, 20);
  assert.equal(training?.minimumTeamAnchorLevel, 23);
});

test("Koga preparation actively raises the lowest battle member to the shared target", () => {
  const teamPlan = createOriginsTeamPlan(4);
  const objective = createOriginsCampaign(teamPlan).objectives.find(
    ({ id }) => id === "badge-soul",
  );
  const route = openMap("MAP_ROUTE18", {
    connections: [{ direction: "left", map: "MAP_FUCHSIA_CITY_GYM", offset: 0 }],
    encounters: { "1,1": 1, "2,1": 1 },
    behaviors: { "1,1": "MB_TALL_GRASS", "2,1": "MB_TALL_GRASS" },
  });
  const gym = openMap("MAP_FUCHSIA_CITY_GYM", {
    connections: [{ direction: "right", map: route.id, offset: 0 }],
    objectEvents: [{ x: 3, y: 1, script: "FuchsiaCity_Gym_EventScript_Koga" }],
  });
  const world = {
    maps: [route, gym],
    wildEncounters: [{
      map: route.id,
      land_mons: {
        encounter_rate: 21,
        mons: [{ min_level: 24, max_level: 29, species: "SPECIES_FEAROW" }],
      },
    }],
  };
  const observation = campaignObservation({
    map: route.id,
    party: [
      { slot: 0, species: 6, level: 58, hp: 171, maxHp: 171, moves: [53] },
      { slot: 1, species: 131, level: 43, hp: 170, maxHp: 170, moves: [57] },
      { slot: 2, species: 135, level: 43, hp: 110, maxHp: 110, moves: [86] },
      { slot: 3, species: 85, level: 43, hp: 112, maxHp: 112, moves: [65] },
      { slot: 4, species: 123, level: 28, hp: 78, maxHp: 78, moves: [206] },
      { slot: 5, species: 46, level: 10, hp: 29, maxHp: 29, moves: [15, 148] },
    ],
  });
  observation.playerMemory.position = { x: 1, y: 1 };

  assert.equal(objective.starterBattleTargetLevel, 45);
  assert.equal(objective.supportBattleTargetLevel, 45);
  assert.equal(objective.minimumReadyBattleMembers, 4);

  const training = selectTrainingObjective({
    world,
    observation,
    objective,
    teamPlan,
  });

  assert.equal(training?.trainingMode, undefined);
  assert.equal(training?.trainingPartySlot, 4);
  assert.equal(training?.currentTeamAnchorLevel, 28);
  assert.equal(training?.minimumTeamAnchorLevel, 45);
  assert.equal(training?.target.kind, "encounter-zone");
});

test("an above-target starter yields training priority to a lower teammate", () => {
  const teamPlan = createOriginsTeamPlan(4);
  const objective = createOriginsCampaign(teamPlan).objectives.find(
    ({ id }) => id === "badge-soul",
  );
  const route = openMap("MAP_ROUTE18", {
    encounters: { "1,1": 1, "2,1": 1 },
    behaviors: { "1,1": "MB_TALL_GRASS", "2,1": "MB_TALL_GRASS" },
  });
  const world = {
    maps: [route],
    wildEncounters: [{
      map: route.id,
      land_mons: {
        encounter_rate: 21,
        mons: [{ min_level: 24, max_level: 29, species: "SPECIES_FEAROW" }],
      },
    }],
  };
  const observation = campaignObservation({
    map: route.id,
    party: [
      { slot: 0, species: 6, level: 47, hp: 140, maxHp: 140, moves: [53] },
      { slot: 1, species: 131, level: 43, hp: 170, maxHp: 170, moves: [57] },
      { slot: 2, species: 135, level: 43, hp: 110, maxHp: 110, moves: [86] },
      { slot: 3, species: 85, level: 43, hp: 112, maxHp: 112, moves: [65] },
      { slot: 4, species: 123, level: 43, hp: 106, maxHp: 106, moves: [206] },
      { slot: 5, species: 46, level: 10, hp: 29, maxHp: 29, moves: [15, 148] },
    ],
  });
  observation.playerMemory.position = { x: 1, y: 1 };

  const training = selectTrainingObjective({
    world,
    observation,
    objective,
    teamPlan,
  });

  assert.notEqual(training?.trainingMode, "passive");
  assert.equal(training?.trainingPartySlot, 1);
  assert.equal(training?.currentTeamAnchorLevel, 43);
  assert.equal(training?.minimumTeamAnchorLevel, 45);
});

test("balanced boss preparation trains the lowest-readiness teammate before the starter", () => {
  const route = openMap("MAP_ROUTE18", {
    encounters: { "1,1": 1, "2,1": 1 },
    behaviors: { "1,1": "MB_TALL_GRASS", "2,1": "MB_TALL_GRASS" },
  });
  const observation = campaignObservation({
    map: route.id,
    party: [
      { slot: 0, species: 6, level: 44, hp: 132, maxHp: 132, moves: [53] },
      { slot: 1, species: 131, level: 30, hp: 120, maxHp: 120, moves: [57] },
      { slot: 2, species: 135, level: 45, hp: 116, maxHp: 116, moves: [86] },
      { slot: 3, species: 85, level: 45, hp: 118, maxHp: 118, moves: [65] },
    ],
  });
  observation.playerMemory.position = { x: 1, y: 1 };

  const training = selectTrainingObjective({
    world: {
      maps: [route],
      wildEncounters: [{
        map: route.id,
        land_mons: {
          encounter_rate: 21,
          mons: [{ min_level: 24, max_level: 29, species: "SPECIES_FEAROW" }],
        },
      }],
    },
    observation,
    objective: {
      id: "badge-soul",
      target: { kind: "map-arrival", map: route.id, x: 4, y: 4 },
      importantBattle: true,
      starterBattleFamily: [4, 5, 6],
      starterBattleTargetLevel: 45,
      supportBattleTargetLevel: 45,
      battleTeamTargetLevel: 45,
      enemyAceLevel: 43,
      enemyPartySize: 4,
      minimumReadyBattleMembers: 4,
      minimumBattlePartySize: 4,
    },
  });

  assert.equal(training?.trainingPartySlot, 1);
  assert.equal(training?.currentTeamAnchorLevel, 30);
  assert.equal(training?.minimumTeamAnchorLevel, 45);
});

test("a readiness shortage trains the lowest squad member to the shared target", () => {
  const teamPlan = createOriginsTeamPlan(4);
  const objective = createOriginsCampaign(teamPlan).objectives.find(
    ({ id }) => id === "badge-soul",
  );
  const route = openMap("MAP_ROUTE18", {
    encounters: { "1,1": 1, "2,1": 1 },
    behaviors: { "1,1": "MB_TALL_GRASS", "2,1": "MB_TALL_GRASS" },
  });
  const world = {
    maps: [route],
    wildEncounters: [{
      map: route.id,
      land_mons: {
        encounter_rate: 21,
        mons: [{ min_level: 24, max_level: 29, species: "SPECIES_FEAROW" }],
      },
    }],
  };
  const observation = campaignObservation({
    map: route.id,
    party: [
      { slot: 0, species: 6, level: 48, hp: 144, maxHp: 144, moves: [53] },
      { slot: 1, species: 131, level: 43, hp: 170, maxHp: 170, moves: [57] },
      { slot: 2, species: 135, level: 43, hp: 110, maxHp: 110, moves: [86] },
      { slot: 3, species: 85, level: 42, hp: 109, maxHp: 109, moves: [65] },
      { slot: 4, species: 123, level: 28, hp: 78, maxHp: 78, moves: [206] },
      { slot: 5, species: 46, level: 10, hp: 29, maxHp: 29, moves: [15, 148] },
    ],
  });
  observation.playerMemory.position = { x: 1, y: 1 };

  const training = selectTrainingObjective({
    world,
    observation,
    objective,
    teamPlan,
  });

  assert.notEqual(training?.trainingMode, "passive");
  assert.equal(training?.trainingPartySlot, 4);
  assert.equal(training?.currentTeamAnchorLevel, 28);
  assert.equal(training?.minimumTeamAnchorLevel, 45);
});

test("Cerulean readiness includes all four members of the rival's party", () => {
  const teamPlan = createOriginsTeamPlan(4);
  const objective = createOriginsCampaign(teamPlan).objectives.find(
    ({ id }) => id === "rival-cerulean",
  );
  const route = openMap("MAP_ROUTE24", {
    encounters: { "1,1": 1, "2,1": 1 },
    behaviors: { "1,1": "MB_TALL_GRASS", "2,1": "MB_TALL_GRASS" },
  });
  const world = {
    maps: [route],
    wildEncounters: [{
      map: route.id,
      land_mons: {
        encounter_rate: 21,
        mons: [{ min_level: 8, max_level: 14, species: "SPECIES_ODDISH" }],
      },
    }],
  };
  const observation = campaignObservation({
    map: route.id,
    party: [
      { slot: 0, species: 5, level: 23, hp: 65, maxHp: 65, moves: [52] },
      { slot: 1, species: 43, level: 18, hp: 46, maxHp: 46, moves: [71] },
      { slot: 2, species: 16, level: 18, hp: 44, maxHp: 44, moves: [17] },
      { slot: 3, species: 19, level: 17, hp: 42, maxHp: 42, moves: [33] },
    ],
  });
  observation.playerMemory.position = { x: 1, y: 1 };

  const training = selectTrainingObjective({
    world,
    observation,
    objective,
    teamPlan,
  });

  assert.equal(objective.minimumBattlePartySize, 3);
  assert.equal(objective.minimumReadyBattleMembers, 4);
  assert.equal(training?.trainingPartySlot, 3);
  assert.equal(training?.currentTeamAnchorLevel, 17);
  assert.equal(training?.minimumTeamAnchorLevel, 20);
});

test("an overleveled member cannot raise an authored whole-team battle target", () => {
  const route = openMap("MAP_ROUTE18", {
    encounters: { "1,1": 1, "2,1": 1 },
    behaviors: { "1,1": "MB_TALL_GRASS", "2,1": "MB_TALL_GRASS" },
  });
  const world = {
    maps: [route],
    wildEncounters: [{
      map: route.id,
      land_mons: {
        encounter_rate: 21,
        mons: [{ min_level: 24, max_level: 29, species: "SPECIES_FEAROW" }],
      },
    }],
  };
  const observation = campaignObservation({
    map: route.id,
    party: [
      { slot: 0, species: 85, level: 70, hp: 180, maxHp: 180, moves: [65] },
      { slot: 1, species: 135, level: 100, hp: 240, maxHp: 240, moves: [84] },
      { slot: 2, species: 6, level: 71, hp: 210, maxHp: 210, moves: [53] },
      { slot: 3, species: 123, level: 71, hp: 190, maxHp: 190, moves: [163] },
      { slot: 4, species: 33, level: 70, hp: 185, maxHp: 185, moves: [24] },
      { slot: 5, species: 53, level: 70, hp: 175, maxHp: 175, moves: [44] },
    ],
  });
  observation.playerMemory.position = { x: 1, y: 1 };

  const training = selectTrainingObjective({
    world,
    observation,
    objective: {
      id: "rival-silph",
      target: { kind: "map-arrival", map: route.id, x: 4, y: 4 },
      importantBattle: true,
      minimumBattlePartySize: 6,
      enemyAceLevel: 40,
      battleTeamTargetLevel: 45,
      minimumBattleMemberLevel: 45,
      // A stale checkpoint may still carry the former heuristic fields. They
      // must never override the authored target.
      minimumTeamAnchorLevel: 48,
      maximumTeamLevelGap: 5,
    },
  });

  assert.equal(training, null);
});

test("battle preparation trains the lowest squad member only to the authored target", () => {
  const route = openMap("MAP_ROUTE18", {
    encounters: { "1,1": 1, "2,1": 1 },
    behaviors: { "1,1": "MB_TALL_GRASS", "2,1": "MB_TALL_GRASS" },
  });
  const world = {
    maps: [route],
    wildEncounters: [{
      map: route.id,
      land_mons: {
        encounter_rate: 21,
        mons: [{ min_level: 24, max_level: 29, species: "SPECIES_FEAROW" }],
      },
    }],
  };
  const observation = campaignObservation({
    map: route.id,
    party: [
      { slot: 0, species: 85, level: 50, hp: 150, maxHp: 150, moves: [65] },
      { slot: 1, species: 135, level: 45, hp: 120, maxHp: 120, moves: [84] },
      { slot: 2, species: 6, level: 44, hp: 125, maxHp: 125, moves: [53] },
      { slot: 3, species: 123, level: 45, hp: 115, maxHp: 115, moves: [163] },
      { slot: 4, species: 33, level: 45, hp: 110, maxHp: 110, moves: [24] },
      { slot: 5, species: 53, level: 45, hp: 105, maxHp: 105, moves: [44] },
    ],
  });
  observation.playerMemory.position = { x: 1, y: 1 };

  const training = selectTrainingObjective({
    world,
    observation,
    objective: {
      id: "rival-silph",
      target: { kind: "map-arrival", map: route.id, x: 4, y: 4 },
      importantBattle: true,
      minimumBattlePartySize: 6,
      enemyAceLevel: 40,
      battleTeamTargetLevel: 45,
      minimumBattleMemberLevel: 45,
      maximumTeamLevelGap: 5,
    },
  });

  assert.equal(training?.id, "train-battle-member");
  assert.equal(training?.trainingPartySlot, 2);
  assert.equal(training?.currentTeamAnchorLevel, 44);
  assert.equal(training?.minimumTeamAnchorLevel, 45);
});

test("a Gym floor uses switch training instead of advancing when no wild area is trainee-safe", () => {
  const route = openMap("MAP_ROUTE24", {
    connections: [{ direction: "down", map: "MAP_CERULEAN_CITY_GYM", offset: 0 }],
    encounters: { "1,1": 1, "2,1": 1 },
    behaviors: { "1,1": "MB_TALL_GRASS", "2,1": "MB_TALL_GRASS" },
  });
  const gym = openMap("MAP_CERULEAN_CITY_GYM", {
    connections: [{ direction: "up", map: route.id, offset: 0 }],
    objectEvents: [{ x: 3, y: 1, script: "CeruleanCity_Gym_EventScript_Misty" }],
  });
  const world = {
    maps: [route, gym],
    wildEncounters: [{
      map: route.id,
      land_mons: {
        encounter_rate: 21,
        mons: [{ min_level: 8, max_level: 14, species: "SPECIES_ODDISH" }],
      },
    }],
  };
  const observation = campaignObservation({
    map: route.id,
    party: [
      { slot: 0, species: 5, level: 26, hp: 73, maxHp: 73, moves: [52] },
      { slot: 1, species: 13, level: 8, hp: 26, maxHp: 26, moves: [40] },
    ],
  });
  observation.playerMemory.position = { x: 1, y: 1 };

  const training = selectTrainingObjective({
    world,
    observation,
    objective: {
      id: "badge-cascade",
      target: { kind: "object", map: gym.id, index: 0 },
      importantBattle: true,
      enemyAceLevel: 21,
      battleTeamTargetLevel: 26,
      minimumBattleMemberLevel: 26,
    },
  });

  assert.equal(training?.id, "train-battle-member");
  assert.equal(training?.target.map, route.id);
  assert.equal(training?.trainingPartySlot, 1);
  assert.equal(training?.minimumTeamAnchorLevel, 26);
  assert.equal(training?.trainingMethod, "switch");
  assert.equal(training?.escortPartySlot, 0);
});

test("team balancing cannot interrupt ordinary story progression", () => {
  const route = openMap("MAP_TRAINING", {
    encounters: { "1,1": 1, "2,1": 1 },
    behaviors: { "1,1": "MB_TALL_GRASS", "2,1": "MB_TALL_GRASS" },
  });
  const world = {
    maps: [route, openMap("MAP_DISTANT_GOAL")],
    wildEncounters: [{
      map: route.id,
      land_mons: {
        encounter_rate: 21,
        mons: [{ min_level: 5, max_level: 10, species: "SPECIES_RATTATA" }],
      },
    }],
  };
  const observation = campaignObservation({
    map: route.id,
    party: [
      { slot: 0, species: 5, level: 20, hp: 60, maxHp: 60, moves: [52] },
      { slot: 1, species: 46, level: 10, hp: 30, maxHp: 30, moves: [10] },
    ],
  });
  observation.playerMemory.position = { x: 1, y: 1 };

  const training = selectTrainingObjective({
    world,
    observation,
    objective: {
      id: "distant-story-step",
      target: { kind: "map-arrival", map: "MAP_DISTANT_GOAL", x: 1, y: 1 },
      maximumTeamLevelGap: 5,
    },
  });
  assert.equal(training, null);
});

test("only important battles receive an authored whole-team level target", () => {
  const campaign = createOriginsCampaign(createOriginsTeamPlan(4));
  const ordinaryObjective = campaign.objectives.find(
    ({ id }) => id === "prepare-eevee-party-space",
  );
  const bossObjective = campaign.objectives.find(
    ({ id }) => id === "badge-rainbow",
  );

  assert.equal(ordinaryObjective?.importantBattle, undefined);
  assert.equal(ordinaryObjective?.battleTeamTargetLevel, undefined);
  assert.equal(bossObjective?.importantBattle, true);
  assert.equal(bossObjective?.battleTeamTargetLevel, 31);
  assert.equal(bossObjective?.maximumTeamLevelGap, undefined);
});

test("an unaffordable remainder does not pin a purchase objective forever", () => {
  const planner = createCampaignPlanner({ campaign: { objectives: [
    {
      id: "supplies",
      target: {
        kind: "purchase-items",
        items: [{ itemId: 22, quantity: 4, unitPrice: 700 }],
      },
      completion: { kind: "item-at-least", id: 22, quantity: 4 },
    },
    {
      id: "continue-story",
      target: { kind: "map-arrival", map: "MAP_ROUTE24", x: 1, y: 1 },
      completion: { kind: "flag-set", id: 99 },
    },
  ] } });
  const observation = campaignObservation({
    bag: { items: [{ itemId: 22, quantity: 2 }] },
  });
  observation.playerMemory.trainer.money = 564;

  assert.equal(planner.select(observation)?.id, "continue-story");
});

test("the Charmander route recruits its Mankey counter before Brock", () => {
  const campaign = createOriginsCampaign(createOriginsTeamPlan(4));
  const ids = campaign.objectives.map(({ id }) => id);
  const capture = campaign.objectives.find(
    ({ id }) => id === "brock-mankey-capture",
  );

  assert.ok(ids.indexOf("brock-mankey-capture") > ids.indexOf("regional-pokedex"));
  assert.ok(ids.indexOf("brock-mankey-capture") < ids.indexOf("badge-boulder"));
  assert.deepEqual(capture?.captureSpecies, [56]);
  assert.deepEqual(capture?.captureFamily, [56, 57]);
});

test("Brock preparation levels Charmander instead of accepting unrelated level twelve members", () => {
  const objective = createOriginsCampaign(createOriginsTeamPlan(4)).objectives.find(
    ({ id }) => id === "badge-boulder",
  );
  const route = openMap("MAP_ROUTE2", {
    connections: [{ direction: "right", map: "MAP_PEWTER_CITY_GYM", offset: 0 }],
    encounters: { "1,1": 1, "2,1": 1 },
    behaviors: { "1,1": "MB_TALL_GRASS", "2,1": "MB_TALL_GRASS" },
  });
  const gym = openMap("MAP_PEWTER_CITY_GYM", {
    connections: [{ direction: "left", map: route.id, offset: 0 }],
    objectEvents: [{ x: 3, y: 1, script: "PewterCity_Gym_EventScript_Brock" }],
  });
  const world = {
    maps: [route, gym],
    wildEncounters: [{
      map: route.id,
      land_mons: {
        encounter_rate: 21,
        mons: [{ min_level: 2, max_level: 5, species: "SPECIES_PIDGEY" }],
      },
    }],
  };
  const observation = campaignObservation({
    map: route.id,
    party: [
      { slot: 0, species: 19, level: 12, hp: 29, maxHp: 29, moves: [33] },
      { slot: 1, species: 16, level: 12, hp: 33, maxHp: 33, moves: [33] },
      { slot: 2, species: 4, level: 11, hp: 30, maxHp: 30, moves: [33] },
    ],
  });
  observation.playerMemory.position = { x: 1, y: 1 };

  assert.deepEqual(selectTrainingObjective({ world, observation, objective }), {
    id: "train-battle-member",
    target: { kind: "encounter-zone", map: route.id },
    currentTeamAnchorLevel: 11,
    minimumTeamAnchorLevel: 16,
    trainingRotation: "one-level",
    trainingPartySlot: 2,
    trainingSpecies: 4,
    escortPartySlot: 0,
    escortSpecies: 19,
    forObjective: "badge-boulder",
    encounter: { rate: 21, minimumWildLevel: 2, maximumWildLevel: 5 },
  });
});

test("a newly caught support trains to the shared ace-plus-two target", () => {
  const objective = createOriginsCampaign(createOriginsTeamPlan(4)).objectives.find(
    ({ id }) => id === "badge-boulder",
  );
  const route = openMap("MAP_ROUTE2", {
    connections: [{ direction: "right", map: "MAP_PEWTER_CITY_GYM", offset: 0 }],
    encounters: { "1,1": 1, "2,1": 1 },
    behaviors: { "1,1": "MB_TALL_GRASS", "2,1": "MB_TALL_GRASS" },
  });
  const gym = openMap("MAP_PEWTER_CITY_GYM", {
    connections: [{ direction: "left", map: route.id, offset: 0 }],
    objectEvents: [{ x: 3, y: 1, script: "PewterCity_Gym_EventScript_Brock" }],
  });
  const world = {
    maps: [route, gym],
    wildEncounters: [{
      map: route.id,
      land_mons: {
        encounter_rate: 21,
        mons: [{ min_level: 2, max_level: 4, species: "SPECIES_PIDGEY" }],
      },
    }],
  };
  const observation = campaignObservation({
    map: route.id,
    party: [
      { slot: 0, species: 4, level: 19, hp: 48, maxHp: 48, moves: [33] },
      { slot: 1, species: 16, level: 3, hp: 15, maxHp: 15, moves: [33] },
    ],
  });
  observation.playerMemory.position = { x: 1, y: 1 };

  assert.deepEqual(objective.starterBattleFamily, [4, 5, 6]);
  assert.equal(objective.minimumBattleMemberLevel, 16);
  assert.deepEqual(selectTrainingObjective({ world, observation, objective }), {
    id: "train-battle-member",
    target: { kind: "encounter-zone", map: route.id },
    currentTeamAnchorLevel: 3,
    minimumTeamAnchorLevel: 16,
    trainingRotation: "one-level",
    trainingPartySlot: 1,
    trainingSpecies: 16,
    escortPartySlot: 0,
    escortSpecies: 4,
    forObjective: "badge-boulder",
    encounter: { rate: 21, minimumWildLevel: 2, maximumWildLevel: 4 },
  });
});

test("Brock training ignores a third incidental catch once two battlers are ready", () => {
  const teamPlan = createOriginsTeamPlan(4);
  const objective = createOriginsCampaign(teamPlan).objectives.find(
    ({ id }) => id === "badge-boulder",
  );
  const route = openMap("MAP_ROUTE2", {
    connections: [{ direction: "right", map: "MAP_PEWTER_CITY_GYM", offset: 0 }],
    encounters: { "1,1": 1, "2,1": 1 },
    behaviors: { "1,1": "MB_TALL_GRASS", "2,1": "MB_TALL_GRASS" },
  });
  const gym = openMap("MAP_PEWTER_CITY_GYM", {
    connections: [{ direction: "left", map: route.id, offset: 0 }],
    objectEvents: [{ x: 3, y: 1, script: "PewterCity_Gym_EventScript_Brock" }],
  });
  const world = {
    maps: [route, gym],
    wildEncounters: [{
      map: route.id,
      land_mons: {
        encounter_rate: 21,
        mons: [{ min_level: 2, max_level: 5, species: "SPECIES_PIDGEY" }],
      },
    }],
  };
  const observation = campaignObservation({
    map: route.id,
    party: [
      { slot: 0, species: 4, level: 19, hp: 39, maxHp: 39, moves: [33] },
      { slot: 1, species: 56, level: 19, hp: 40, maxHp: 40, moves: [2] },
      { slot: 2, species: 16, level: 3, hp: 15, maxHp: 15, moves: [33] },
    ],
  });
  observation.playerMemory.position = { x: 1, y: 1 };

  assert.equal(selectTrainingObjective({
    world,
    observation,
    objective,
    teamPlan,
  }), null);
});

test("Misty training never counts the HM carrier as one of its three battlers", () => {
  const teamPlan = createOriginsTeamPlan(4);
  const objective = createOriginsCampaign(teamPlan).objectives.find(
    ({ id }) => id === "badge-cascade",
  );
  const route = openMap("MAP_ROUTE24", {
    connections: [{ direction: "down", map: "MAP_CERULEAN_CITY_GYM", offset: 0 }],
    encounters: { "1,1": 1, "2,1": 1 },
    behaviors: { "1,1": "MB_TALL_GRASS", "2,1": "MB_TALL_GRASS" },
  });
  const gym = openMap("MAP_CERULEAN_CITY_GYM", {
    connections: [{ direction: "up", map: route.id, offset: 0 }],
  });
  const world = {
    maps: [route, gym],
    wildEncounters: [{
      map: route.id,
      land_mons: {
        encounter_rate: 21,
        mons: [{ min_level: 8, max_level: 14, species: "SPECIES_ODDISH" }],
      },
    }],
  };
  const observation = campaignObservation({
    map: route.id,
    party: [
      { slot: 0, species: 5, level: 26, hp: 60, maxHp: 60, moves: [52] },
      { slot: 1, species: 43, level: 26, hp: 54, maxHp: 54, moves: [71] },
      { slot: 2, species: 19, level: 26, hp: 50, maxHp: 50, moves: [33] },
      { slot: 3, species: 46, level: 5, hp: 20, maxHp: 20, moves: [15, 148] },
    ],
  });
  observation.playerMemory.position = { x: 1, y: 1 };

  assert.equal(selectTrainingObjective({
    world,
    observation,
    objective,
    teamPlan,
  }), null);
});

test("the Charmander route prepares a real Misty counter before entering the gym", () => {
  const campaign = createOriginsCampaign(createOriginsTeamPlan(4));
  const ids = campaign.objectives.map(({ id }) => id);
  const objective = (id) => campaign.objectives.find((candidate) => candidate.id === id);

  assert.ok(ids.indexOf("origins-paras-utility-capture") > ids.indexOf("badge-boulder"));
  assert.ok(ids.indexOf("origins-paras-utility-capture") < ids.indexOf("mt-moon-fossil"));
  assert.equal(objective("origins-paras-utility-capture").completion.kind, "any");
  assert.ok(ids.indexOf("cerulean-capture-supplies") > ids.indexOf("rival-cerulean"));
  assert.ok(ids.indexOf("misty-oddish-capture") > ids.indexOf("cerulean-capture-supplies"));
  assert.ok(ids.indexOf("ensure-misty-counter-party") > ids.indexOf("misty-oddish-capture"));
  assert.ok(ids.indexOf("ensure-misty-counter-party") < ids.indexOf("bill-enter-teleporter"));
  assert.ok(ids.indexOf("misty-oddish-capture") < ids.indexOf("bill-enter-teleporter"));
  assert.deepEqual(objective("cerulean-capture-supplies").target.items.map(
    ({ itemId }) => itemId,
  ), [22, 14, 18, 4]);
  assert.deepEqual(objective("misty-oddish-capture").captureSpecies, [43]);
  assert.deepEqual(objective("ensure-misty-counter-party").target.requiredFamilies, [
    [43, 44, 45],
  ]);
  assert.deepEqual(objective("badge-cascade").coreSpecies, [43, 44, 45]);
  assert.equal(objective("badge-cascade").minimumCoreLevel, 23);
});

test("the temporary Misty counter roster cannot rewind after the Cascade Badge", () => {
  const originsCampaign = createOriginsCampaign(createOriginsTeamPlan(4));
  const mistyRoster = originsCampaign.objectives.find(
    ({ id }) => id === "ensure-misty-counter-party",
  );
  const planner = createCampaignPlanner({
    campaign: { objectives: [
      mistyRoster,
      {
        id: "continue-after-misty",
        target: { kind: "map-arrival", map: "MAP_CELADON_CITY", x: 1, y: 1 },
        completion: { kind: "flag-set", id: 9999 },
      },
    ] },
    world: { maps: [], wildEncounters: [] },
  });
  const observation = campaignObservation({
    flags: { 2081: true },
    party: [{ slot: 0, species: 5, level: 32, hp: 87, maxHp: 89, moves: [] }],
  });

  assert.equal(planner.select(observation)?.id, "continue-after-misty");
});

test("the established Persian roster cannot rewind after the Thunder Badge", () => {
  const originsCampaign = createOriginsCampaign(createOriginsTeamPlan(4));
  const meowthRoster = originsCampaign.objectives.find(
    ({ id }) => id === "ensure-meowth-party",
  );
  const planner = createCampaignPlanner({
    campaign: { objectives: [
      meowthRoster,
      {
        id: "continue-after-surge",
        target: { kind: "map-arrival", map: "MAP_CELADON_CITY", x: 1, y: 1 },
        completion: { kind: "flag-set", id: 9999 },
      },
    ] },
    world: { maps: [], wildEncounters: [] },
  });
  const observation = campaignObservation({
    flags: { 2082: true },
    party: [{ slot: 0, species: 5, level: 32, hp: 89, maxHp: 89, moves: [] }],
  });

  assert.equal(planner.select(observation)?.id, "continue-after-surge");
});

test("Cut setup cannot rewind after the Thunder Badge when its carrier is boxed", () => {
  const originsCampaign = createOriginsCampaign(createOriginsTeamPlan(4));
  const cutRoster = originsCampaign.objectives.find(
    ({ id }) => id === "ensure-cut-carrier-party",
  );
  const teachCut = originsCampaign.objectives.find(({ id }) => id === "teach-cut");
  const planner = createCampaignPlanner({
    campaign: { objectives: [
      cutRoster,
      teachCut,
      {
        id: "continue-after-surge",
        target: { kind: "map-arrival", map: "MAP_CELADON_CITY", x: 1, y: 1 },
        completion: { kind: "flag-set", id: 9999 },
      },
    ] },
    world: { maps: [], wildEncounters: [] },
  });
  const observation = campaignObservation({
    flags: { 2082: true },
    party: [
      { slot: 0, species: 6, moves: [53] },
      { slot: 1, species: 135, moves: [84] },
      { slot: 2, species: 84, moves: [64] },
      { slot: 3, species: 53, moves: [44] },
      { slot: 4, species: 104, moves: [125] },
    ],
  });
  observation.playerMemory.trainer.storage = {
    pokemon: [{ box: 1, slot: 2, species: 47, moves: [15, 148] }],
  };

  assert.equal(planner.select(observation)?.id, "continue-after-surge");
});

test("Eevee party-space preparation cannot rewind after the family is acquired", () => {
  const originsCampaign = createOriginsCampaign(createOriginsTeamPlan(4));
  const eeveeSpace = originsCampaign.objectives.find(
    ({ id }) => id === "prepare-eevee-party-space",
  );
  const planner = createCampaignPlanner({
    campaign: { objectives: [
      eeveeSpace,
      {
        id: "continue-after-eevee",
        target: { kind: "map-arrival", map: "MAP_CELADON_CITY_GYM", x: 1, y: 1 },
        completion: { kind: "flag-set", id: 9999 },
      },
    ] },
    world: { maps: [], wildEncounters: [] },
  });
  const observation = campaignObservation({
    party: [
      { slot: 0, species: 5 },
      { slot: 1, species: 22 },
      { slot: 2, species: 47 },
      { slot: 3, species: 53 },
      { slot: 4, species: 74 },
      { slot: 5, species: 135 },
    ],
  });
  observation.playerMemory.trainer.pokedex = { ownedSpecies: [5, 135] };

  assert.equal(planner.select(observation)?.id, "continue-after-eevee");
});

test("a gift sent to the PC is recovered into the active Origins roster", () => {
  const originsCampaign = createOriginsCampaign(createOriginsTeamPlan(4));
  const gift = originsCampaign.objectives.find(
    ({ id }) => id === "origins-eevee-gift",
  );
  const ensureParty = originsCampaign.objectives.find(
    ({ id }) => id === "ensure-eevee-party",
  );
  const planner = createCampaignPlanner({
    campaign: { objectives: [
      gift,
      ensureParty,
      {
        id: "continue-after-eevee",
        target: { kind: "map-arrival", map: "MAP_CELADON_CITY_GYM", x: 1, y: 1 },
        completion: { kind: "flag-set", id: 9999 },
      },
    ] },
    world: { maps: [], wildEncounters: [] },
  });
  const observation = campaignObservation({
    party: [
      { slot: 0, species: 5 },
      { slot: 1, species: 22 },
      { slot: 2, species: 47 },
      { slot: 3, species: 53 },
      { slot: 4, species: 74 },
      { slot: 5, species: 95 },
    ],
  });
  observation.playerMemory.trainer.pokedex = { ownedSpecies: [5, 133] };
  observation.playerMemory.trainer.storage = {
    pokemon: [{ box: 1, slot: 2, species: 133, moves: [33] }],
  };

  assert.equal(planner.select(observation)?.id, "ensure-eevee-party");

  observation.playerMemory.trainer.party[5] = { slot: 5, species: 133 };
  assert.equal(planner.select(observation)?.id, "continue-after-eevee");
});

test("Lapras party-space preparation cannot rewind after the gift is acquired", () => {
  const originsCampaign = createOriginsCampaign(createOriginsTeamPlan(4));
  const laprasSpace = originsCampaign.objectives.find(
    ({ id }) => id === "prepare-lapras-party-space",
  );
  const planner = createCampaignPlanner({
    campaign: { objectives: [
      laprasSpace,
      {
        id: "continue-after-lapras",
        target: { kind: "map-arrival", map: "MAP_SILPH_CO_11F", x: 1, y: 1 },
        completion: { kind: "flag-set", id: 9999 },
      },
    ] },
    world: { maps: [], wildEncounters: [] },
  });
  const observation = campaignObservation({
    party: [
      { slot: 0, species: 6 },
      { slot: 1, species: 53 },
      { slot: 2, species: 105 },
      { slot: 3, species: 25 },
      { slot: 4, species: 84 },
      { slot: 5, species: 131 },
    ],
  });
  observation.playerMemory.trainer.pokedex = { ownedSpecies: [6, 131] };

  assert.equal(planner.select(observation)?.id, "continue-after-lapras");
});

test("the Origins campaign personalizes field carriers and authored battle anchors", () => {
  const campaign = createOriginsCampaign(createOriginsTeamPlan(7));
  const objective = (id) => campaign.objectives.find((candidate) => candidate.id === id);

  assert.deepEqual(objective("teach-cut").target.partySpecies, [46, 47]);
  assert.deepEqual(objective("teach-surf").target.partySpecies, [131]);
  assert.deepEqual(objective("teach-strength").target.partySpecies, [131]);
  assert.deepEqual(objective("badge-rainbow").coreSpecies, [7, 8, 9]);
  assert.equal(objective("badge-rainbow").minimumCoreLevel, 28);
  assert.equal(objective("elite-four-lorelei").minimumCoreLevel, 58);
});

test("party roster transactions complete only when every required role is active", () => {
  const planner = createCampaignPlanner({ campaign: { objectives: [{
    id: "assemble-team",
    target: {
      kind: "party-roster",
      map: "MAP_INDIGO_PLATEAU_POKEMON_CENTER_1F",
      requiredFamilies: [[4, 5, 6], [131], [84, 85]],
    },
    completion: {
      kind: "party-has-families",
      families: [[4, 5, 6], [131], [84, 85]],
    },
  }, {
    id: "make-gift-space",
    target: {
      kind: "party-roster",
      map: "MAP_SAFFRON_CITY_POKEMON_CENTER_1F",
      maximumPartySize: 5,
    },
    completion: { kind: "party-size-at-most", count: 5 },
  }, {
    id: "continue-story",
    target: { kind: "trigger", map: "MAP_ROUTE23", index: 0 },
    completion: { kind: "flag-set", id: 99 },
  }] } });

  assert.equal(planner.select(campaignObservation({ party: [
    { slot: 0, species: 5 },
    { slot: 1, species: 131 },
  ] }))?.id, "assemble-team");
  assert.equal(planner.select(campaignObservation({ party: [
    { slot: 0, species: 5 },
    { slot: 1, species: 131 },
    { slot: 2, species: 84 },
    { slot: 3, species: 19 },
    { slot: 4, species: 16 },
    { slot: 5, species: 46 },
  ] }))?.id, "make-gift-space");
  assert.equal(planner.select(campaignObservation({ party: [
    { slot: 0, species: 5 },
    { slot: 1, species: 131 },
    { slot: 2, species: 84 },
    { slot: 3, species: 19 },
    { slot: 4, species: 16 },
  ] }))?.id, "continue-story");
});

test("an in-game trade objective routes to its cartridge NPC", () => {
  const map = openMap("MAP_ROUTE2_HOUSE", {
    objectEvents: [
      { x: 1, y: 1, script: "Route2_House_EventScript_Scientist" },
      { x: 3, y: 1, script: "Route2_House_EventScript_Reyley" },
    ],
  });
  const observation = campaignObservation({ map: map.id });
  observation.playerMemory.position = { x: 3, y: 2 };

  assert.deepEqual(campaignNavigationRecommendation({
    world: { maps: [map] },
    observation,
    objective: {
      id: "master-mr-mime-trade",
      target: { kind: "in-game-trade", map: map.id, index: 1 },
    },
  }), {
    kind: "interact-with-object",
    direction: "north",
    objective: "master-mr-mime-trade",
    targetMap: map.id,
    target: {
      kind: "object",
      index: 1,
      x: 3,
      y: 1,
      localId: null,
      script: "Route2_House_EventScript_Reyley",
    },
    remainingSteps: 0,
  });
});

test("stored Pokemon satisfy durable acquisition ownership without occupying the party", () => {
  const planner = createCampaignPlanner({ campaign: { objectives: [{
    id: "catch-utility",
    target: { kind: "encounter-zone", map: "MAP_MT_MOON_1F" },
    completion: { kind: "owned-species", species: [46, 47] },
  }, {
    id: "continue-story",
    target: { kind: "trigger", map: "MAP_ROUTE4", index: 0 },
    completion: { kind: "flag-set", id: 99 },
  }] } });

  assert.equal(planner.select(campaignObservation({
    party: [{ slot: 0, species: 4, level: 20, hp: 50, moves: [] }],
  }))?.id, "catch-utility");
  const withStoredParas = campaignObservation({
    party: [{ slot: 0, species: 4, level: 20, hp: 50, moves: [] }],
  });
  withStoredParas.playerMemory.trainer.pokedex = { ownedSpecies: [4, 46] };
  assert.equal(planner.select(withStoredParas)?.id, "continue-story");
});

test("spent Cerulean capture supplies cannot rewind the campaign after Misty", () => {
  const campaign = createOriginsCampaign(createOriginsTeamPlan(4));
  const planner = createCampaignPlanner({ campaign });
  const observed = campaignObservation({
    map: "MAP_CERULEAN_CITY",
    flags: { 2080: true, 2081: true },
    variables: { 16471: 1, 0x4052: 1 },
    party: [
      { slot: 0, species: 5, level: 28, hp: 70, moves: [] },
      { slot: 1, species: 43, level: 23, hp: 54, moves: [71, 79] },
      { slot: 2, species: 46, level: 15, hp: 40, moves: [] },
    ],
  });
  observed.playerMemory.trainer.pokedex = {
    ownedSpecies: [4, 5, 43, 46],
  };

  assert.notEqual(planner.select(observed)?.id, "cerulean-capture-supplies");
});

test("midgame restocking keeps medicine ahead of capture balls", () => {
  const campaign = createOriginsCampaign(createOriginsTeamPlan(4));
  const supplies = campaign.objectives.find(({ id }) => id === "silph-supplies");

  assert.deepEqual(supplies.target.items.map(({ itemId }) => itemId), [21, 23, 3]);
});

test("the Master route replaces rigid Silph and League shopping quotas with dynamic reserves", () => {
  const ids = createMasterCampaign(createMasterTeamPlan(7, 0)).objectives.map(
    ({ id }) => id,
  );
  assert.equal(ids.includes("silph-supplies"), false);
  assert.equal(ids.includes("league-supplies"), false);
});

test("an acquired HM becomes a required party capability before the route continues", () => {
  const planner = createCampaignPlanner({ campaign: {
    objectives: [{
      id: "teach-cut",
      target: {
        kind: "teach-move",
        itemId: 339,
        moveId: 15,
        partySpecies: [1, 2, 3],
      },
      completion: { kind: "party-knows-move", moveId: 15 },
    }, {
      id: "next-route",
      target: { kind: "trigger", map: "MAP_ROUTE2", index: 0 },
      completion: { kind: "flag-set", id: 99 },
    }],
  } });

  assert.equal(planner.select(campaignObservation())?.id, "teach-cut");
  assert.equal(planner.select(campaignObservation({
    party: [{ slot: 0, species: 2, level: 20, hp: 55, moves: [15, 75] }],
  }))?.id, "next-route");
});

test("composite cartridge postconditions advance when any durable proof is present", () => {
  const planner = createCampaignPlanner({ campaign: { objectives: [{
    id: "open-lock",
    target: { kind: "background", map: "MAP_GYM", index: 2 },
    completion: {
      kind: "any",
      completions: [
        { kind: "flag-set", id: 1 },
        { kind: "flag-set", id: 612 },
      ],
    },
  }, {
    id: "leader",
    target: { kind: "object", map: "MAP_GYM", index: 0 },
    completion: { kind: "flag-set", id: 2082 },
  }] } });

  assert.equal(planner.select(campaignObservation({ flags: { 612: true } }))?.id,
    "leader");
  assert.deepEqual(planner.storyWatch(), {
    variables: [16462, 16480, 16492, 16497, 16502, 16509, 32772, 32773],
    flags: [
      1, 83, 562, 571, 594, 598, 612, 658, 762, 765,
      2082, 2092, 2095, 2112, 2116, 2192, 2193, 2194, 2195, 2196, 2197,
      2198, 2199, 2200, 2201, 2202,
    ],
  });
});

test("the campaign continues from the first rival win to Oak's Parcel", () => {
  const planner = createCampaignPlanner({ campaign: MAIN_STORY_CAMPAIGN });

  const selected = planner.select(campaignObservation());

  assert.deepEqual(selected, {
    id: "oak-parcel",
    target: {
      kind: "warp",
      map: "MAP_VIRIDIAN_CITY",
      index: 4,
    },
    completion: { kind: "variable-at-least", id: 16471, value: 1 },
    dialogue: "advance",
  });
});

test("returning Oak's Parcel advances to the regional Pokédex handoff", () => {
  const planner = createCampaignPlanner({ campaign: MAIN_STORY_CAMPAIGN });

  const selected = planner.select(campaignObservation({
    variables: { 16471: 1 },
  }));

  assert.deepEqual(selected, {
    id: "regional-pokedex",
    target: {
      kind: "object",
      map: "MAP_PALLET_TOWN_PROFESSOR_OAKS_LAB",
      index: 3,
    },
    completion: { kind: "flag-set", id: 2089 },
    dialogue: "advance",
  });
});

test("the campaign remains ordered through the late Route 22 rival and Champion", () => {
  const planner = createCampaignPlanner({ campaign: MAIN_STORY_CAMPAIGN });
  const flagIds = Object.fromEntries([
    2, 83, 84, 393, 424, 562, 563, 564, 567, 569, 570, 572, 573, 579, 658,
    612, 621, 636, 637, 653, 678, 1208, 1209, 1210, 1211,
    1457, 1458, 1459, 1460, 1493, 1494, 1495,
    1628, 1637, 1646, 1647, 1648,
    2089, 2080, 2081, 2082, 2083, 2084, 83, 2085, 2086, 2087,
  ].map((id) => [id, true]));
  flagIds[88] = false;
  const variables = {
    16384: 1,
    16385: 1,
    16471: 1,
    16466: 1,
    16475: 1,
    16476: 1,
    16477: 1,
    16468: 3,
    16479: 8,
    16484: 100,
    16485: 100,
    16486: 100,
    16487: 100,
    16509: 1,
  };
  const bag = {
    keyItems: [
      { itemId: 355, quantity: 1 },
      { itemId: 356, quantity: 1 },
      { itemId: 359, quantity: 1 },
    ],
    items: [
      { itemId: 19, quantity: 8 },
      { itemId: 21, quantity: 8 },
      { itemId: 23, quantity: 4 },
      { itemId: 24, quantity: 8 },
    ],
  };
  const party = [
    { slot: 0, species: 3, level: 58, hp: 180, maxHp: 180,
      moves: [15, 70, 290] },
    { slot: 1, species: 131, level: 58, hp: 220, maxHp: 220, moves: [57] },
    { slot: 2, species: 143, level: 58, hp: 240, maxHp: 240, moves: [34] },
  ];

  assert.equal(
    planner.select(campaignObservation({ variables, flags: flagIds, bag, party }))?.id,
    "rival-route22-late",
  );
  const leagueReady=campaignObservation({
      variables: { ...variables, 16468: 4 },
      flags: flagIds,
      bag,
      party:party.map(p=>({...p,pp:p.moves.map(()=>15)})),
    });
  leagueReady.sram={sha256:'before-league-save'};
  leagueReady.playerMemory.gameStats={savedGame:0};
  assert.equal(planner.select(leagueReady)?.id,'restore-after-lance');
  leagueReady.sram.sha256='after-league-save';
  leagueReady.playerMemory.gameStats.savedGame=1;
  leagueReady.playerMemory.saveAttemptStatus=1;
  assert.equal(planner.select(leagueReady)?.id,'champion');
  party[0].hp = 180;
  party[1].hp = 220;
  assert.equal(
    planner.select(campaignObservation({
      variables: { ...variables, 16468: 4 },
      flags: { ...flagIds, 2092: true },
      bag,
      party,
    })),
    null,
  );
});

test("the League expedition stocks every recovery category sold at Indigo Plateau", () => {
  const supplies = MAIN_STORY_CAMPAIGN.objectives.find(
    ({ id }) => id === "league-supplies",
  );

  assert.deepEqual(supplies?.target, {
    kind: "purchase-items",
    map: "MAP_INDIGO_PLATEAU_POKEMON_CENTER_1F",
    objectIndex: 0,
    items: [
      { itemId: 24, stockIndex: 4, quantity: 24, unitPrice: 1500 },
      { itemId: 20, stockIndex: 3, quantity: 40, unitPrice: 2500 },
      { itemId: 23, stockIndex: 5, quantity: 8, unitPrice: 600 },
      { itemId: 19, stockIndex: 2, quantity: 20, unitPrice: 3000 },
    ],
  });
});

test("a League blackout reopens Lorelei after a checkpointed Champion attempt", () => {
  const teamPlan = createOriginsTeamPlan(4);
  const planner = createCampaignPlanner({
    campaign: createOriginsCampaign(teamPlan),
    teamPlan,
    initialState: {
      schema: "master-red/campaign-planner-state/v1",
      completedThroughObjectiveId: "restore-after-lance",
    },
  });
  const observation = campaignObservation({
    map: "MAP_LAVENDER_TOWN_POKEMON_CENTER_1F",
    flags: {
      1208: false,
      1209: false,
      1210: false,
      1211: false,
      2092: false,
    },
    bag: {
      items: [
        { itemId: 24, quantity: 24 },
        { itemId: 20, quantity: 40 },
        { itemId: 23, quantity: 8 },
        { itemId: 19, quantity: 20 },
      ],
    },
    party: [
      { slot: 0, species: 53, level: 51, hp: 140, maxHp: 140, moves: [] },
      { slot: 1, species: 131, level: 64, hp: 245, maxHp: 245, moves: [] },
      { slot: 2, species: 85, level: 64, hp: 161, maxHp: 161, moves: [] },
      { slot: 3, species: 123, level: 63, hp: 164, maxHp: 164, moves: [] },
      { slot: 4, species: 135, level: 63, hp: 156, maxHp: 156, moves: [] },
      { slot: 5, species: 6, level: 69, hp: 202, maxHp: 202, moves: [] },
    ],
  });

  assert.equal(planner.select(observation)?.id, "elite-four-lorelei");
  assert.equal(planner.state().completedThroughObjectiveId, "league-supplies");
});

test("the League nurse remains required when HP is full but move PP is depleted", () => {
  const leagueHeal = MAIN_STORY_CAMPAIGN.objectives.find(
    ({ id }) => id === "league-heal",
  );
  const supplies = MAIN_STORY_CAMPAIGN.objectives.find(
    ({ id }) => id === "league-supplies",
  );
  const mechanics = { data: { moves: [
    { id: 57, pp: 15 },
    { id: 58, pp: 10 },
  ] } };
  const select = (pp, ppBonuses = 0) => createCampaignPlanner({
    campaign: { objectives: [leagueHeal, supplies] },
    mechanics,
  }).select(campaignObservation({
    party: [{
      slot: 0,
      species: 131,
      hp: 200,
      maxHp: 200,
      status1: 0,
      ppBonuses,
      moves: [57, 58, 0, 0],
      pp,
    }],
  }));

  assert.equal(select([0, 10, 0, 0])?.id, "league-heal");
  assert.equal(select([15, 10, 0, 0])?.id, "league-supplies");
  assert.equal(select([15, 10, 0, 0], 3)?.id, "league-heal");
  assert.equal(select([24, 10, 0, 0], 3)?.id, "league-supplies");
});

test("the campaign makes recovery a required transaction between Elite Four rooms", () => {
  const planner = createCampaignPlanner({ campaign: { objectives: [
    {
      id: "elite-four-lorelei",
      target: { kind: "object", map: "MAP_LORELEI", index: 0 },
      completion: { kind: "flag-set", id: 1208 },
    },
    {
      id: "restore-after-lorelei",
      target: { kind: "heal-with-items" },
      completion: { kind: "party-fully-healed" },
    },
    {
      id: "elite-four-bruno",
      target: { kind: "object", map: "MAP_BRUNO", index: 0 },
      completion: { kind: "flag-set", id: 1209 },
    },
  ] } });
  const party = [{ slot: 0, species: 3, hp: 40, maxHp: 180 }];
  assert.equal(planner.select(campaignObservation({
    flags: { 1208: true }, party,
  }))?.id, "restore-after-lorelei");
  party[0].hp = 180;
  assert.equal(planner.select(campaignObservation({
    flags: { 1208: true }, party,
  }))?.id, "elite-four-bruno");
});

test("League recovery cures status and advances only after every available treatment is spent", () => {
  const select = ({ party, items }) => createCampaignPlanner({
    campaign: { objectives: [
      {
        id: "restore-after-bruno",
        target: { kind: "heal-with-items" },
        completion: { kind: "party-maximally-recovered" },
      },
      {
        id: "elite-four-agatha",
        target: { kind: "object", map: "MAP_AGATHA", index: 0 },
        completion: { kind: "flag-set", id: 1210 },
      },
    ] },
  }).select(campaignObservation({ bag: { items }, party }));

  const poisoned = [{
    slot: 0,
    species: 131,
    hp: 200,
    maxHp: 200,
    status1: 8,
  }];
  assert.equal(select({
    party: poisoned,
    items: [{ itemId: 23, quantity: 1 }],
  })?.id, "restore-after-bruno");
  assert.equal(select({
    party: [{ ...poisoned[0], status1: 0 }],
    items: [{ itemId: 23, quantity: 1 }],
  })?.id, "elite-four-agatha");

  assert.equal(select({
    party: [
      { slot: 0, species: 131, hp: 200, maxHp: 200, status1: 0 },
      { slot: 1, species: 123, hp: 0, maxHp: 140, status1: 0 },
    ],
    items: [],
  })?.id, "elite-four-agatha");
});

test("the Indigo Plateau sequence cannot detour back into Victory Road", () => {
  const objectives = new Map(
    MAIN_STORY_CAMPAIGN.objectives.map((objective) => [objective.id, objective]),
  );
  for (const id of [
    "league-heal",
    "league-supplies",
    "elite-four-lorelei",
    "restore-after-lorelei",
    "elite-four-bruno",
    "restore-after-bruno",
    "elite-four-agatha",
    "restore-after-agatha",
    "elite-four-lance",
    "restore-after-lance",
    "champion",
  ]) {
    assert.equal(
      objectives.get(id)?.deferOptionalDetours,
      true,
      `${id} must retain ownership of the League transaction`,
    );
  }
});

test("League entrance routing uses the interior landing beside a wall-authored warp", () => {
  const center = openMap("MAP_INDIGO_PLATEAU_POKEMON_CENTER_1F", {
    width: 3,
    height: 4,
    behaviors: { "1,0": "MB_CAVE_DOOR" },
    warpEvents: [{
      x: 1,
      y: 0,
      dest_map: "MAP_POKEMON_LEAGUE_LORELEIS_ROOM",
      dest_warp_id: "0",
    }],
  });
  const lorelei = openMap("MAP_POKEMON_LEAGUE_LORELEIS_ROOM", {
    width: 5,
    height: 5,
    collisions: Object.fromEntries(
      [3, 4].flatMap((y) =>
        Array.from({ length: 5 }, (_, x) => [`${x},${y}`, 1])
      ),
    ),
    warpEvents: [{
      x: 2,
      y: 4,
      dest_map: center.id,
      dest_warp_id: "0",
    }],
    objectEvents: [{
      x: 2,
      y: 1,
      script: "PokemonLeague_LoreleisRoom_EventScript_Lorelei",
    }],
  });
  const observation = campaignObservation({ map: center.id });
  observation.playerMemory.position = { x: 1, y: 2 };

  const recommendation = campaignNavigationRecommendation({
    world: { maps: [center, lorelei] },
    observation,
    objective: {
      id: "elite-four-lorelei",
      target: { kind: "object", map: lorelei.id, index: 0 },
    },
  });

  assert.equal(recommendation?.kind, "move-toward");
  assert.equal(recommendation?.direction, "north");
  assert.equal(recommendation?.transit?.destinationMap, lorelei.id);
});

test("League routing follows a scripted exit opened in the live map", () => {
  const lorelei = openMap("MAP_POKEMON_LEAGUE_LORELEIS_ROOM", {
    width: 3,
    height: 4,
    collisions: { "1,0": 1, "1,3": 1 },
    warpEvents: [
      {
        x: 1,
        y: 3,
        dest_map: "MAP_INDIGO_PLATEAU_POKEMON_CENTER_1F",
        dest_warp_id: "0",
      },
      {
        x: 1,
        y: 0,
        dest_map: "MAP_POKEMON_LEAGUE_BRUNOS_ROOM",
        dest_warp_id: "0",
      },
    ],
  });
  const bruno = openMap("MAP_POKEMON_LEAGUE_BRUNOS_ROOM", {
    width: 3,
    height: 4,
    collisions: { "1,3": 1 },
    warpEvents: [{
      x: 1,
      y: 3,
      dest_map: lorelei.id,
      dest_warp_id: "1",
    }],
    objectEvents: [{
      x: 1,
      y: 1,
      script: "PokemonLeague_BrunosRoom_EventScript_Bruno",
    }],
  });
  const observation = campaignObservation({ map: lorelei.id });
  observation.playerMemory.position = { x: 1, y: 1 };
  observation.playerMemory.mapGrid = {
    width: lorelei.layout.width,
    height: lorelei.layout.height,
    cells: lorelei.layout.cells.map((cell) =>
      cell.x === 1 && cell.y === 0
        ? { ...cell, collision: 0, behaviorName: "MB_NORMAL" }
        : cell
    ),
  };

  const recommendation = campaignNavigationRecommendation({
    world: { maps: [lorelei, bruno] },
    observation,
    objective: {
      id: "elite-four-bruno",
      target: { kind: "object", map: bruno.id, index: 0 },
    },
  });

  assert.equal(recommendation?.kind, "move-toward");
  assert.equal(recommendation?.direction, "north");
  assert.equal(recommendation?.transit?.destinationMap, bruno.id);
});

test("spent supplies cannot rewind preparation after the next durable victory", () => {
  const objective = (id) => MAIN_STORY_CAMPAIGN.objectives.find(
    (candidate) => candidate.id === id,
  );
  const sentinel = {
    id: "next-story-step",
    target: { kind: "object", map: "MAP_NEXT", index: 0 },
    completion: { kind: "flag-set", id: 9999 },
  };
  const damagedParty = [{
    slot: 0,
    species: 3,
    level: 58,
    hp: 40,
    maxHp: 180,
    moves: [15, 70, 290],
  }];

  const afterSilphRival = createCampaignPlanner({ campaign: { objectives: [
    objective("silph-supplies"),
    sentinel,
  ] } });
  assert.equal(afterSilphRival.select(campaignObservation({
    variables: { [0x405c]: 1 },
    bag: { items: [{ itemId: 21, quantity: 7 }] },
  }))?.id, sentinel.id);

  const afterLorelei = createCampaignPlanner({ campaign: { objectives: [
    objective("league-heal"),
    objective("league-supplies"),
    sentinel,
  ] } });
  assert.equal(afterLorelei.select(campaignObservation({
    flags: { [0x4b8]: true },
    bag: { items: [] },
    party: damagedParty,
  }))?.id, sentinel.id);

  for (const [restoreId, nextVictoryFlag] of [
    ["restore-after-lorelei", 0x4b9],
    ["restore-after-bruno", 0x4ba],
    ["restore-after-agatha", 0x4bb],
    ["restore-after-lance", 2092],
  ]) {
    const afterNextVictory = createCampaignPlanner({ campaign: { objectives: [
      objective(restoreId),
      sentinel,
    ] } });
    assert.equal(afterNextVictory.select(campaignObservation({
      flags: { [nextVictoryFlag]: true },
      party: damagedParty,
    }))?.id, sentinel.id, restoreId);
  }
});

test("the Champion objective enters the automatic room scene without poking a scriptless sprite", () => {
  const map = openMap("MAP_POKEMON_LEAGUE_CHAMPIONS_ROOM", {
    width: 13,
    height: 20,
    objectEvents: [{ x: 6, y: 8, script: "0x0" }],
  });
  const observation = campaignObservation({ map: map.id });
  observation.playerMemory.position = { x: 6, y: 18 };
  const objective = MAIN_STORY_CAMPAIGN.objectives.find(({ id }) => id === "champion");

  assert.equal(objective.target.kind, "map-arrival");
  assert.equal(campaignNavigationRecommendation({
    world: { maps: [map] }, observation, objective,
  }), null);
});

test("the campaign exposes the exact global story state its objectives require", () => {
  const planner = createCampaignPlanner({ campaign: MAIN_STORY_CAMPAIGN });

  assert.deepEqual(planner.storyWatch?.(), {
    variables: [16384, 16385, 16442, 16462, 16466, 16468, 16471, 16475, 16476,
      16477, 16479, 16480, 16484, 16485, 16486, 16487, 16492, 16497, 16502, 16505,
      16507, 16509, 32772, 32773],
    flags: [1, 2, 83, 84, 88, 393, 424, 562, 563, 564, 567, 569,
      570, 571, 572, 573, 579, 594, 598, 612, 620, 621, 636, 637, 653, 658,
      673, 674, 675, 678, 762, 765, 1208, 1209, 1210, 1211, 1457, 1458, 1459, 1460, 1493,
      1494, 1495, 1628,
      1637, 1646, 1647, 1648, 2053, 2080, 2081, 2082, 2083, 2084,
      2085, 2086, 2087, 2089, 2092, 2095, 2112, 2113, 2116, 2192, 2193,
      2194, 2195, 2196, 2197, 2198, 2199, 2200, 2201, 2202],
  });
});

test("the campaign observes every Kanto visited flag before permitting Fly transport", () => {
  const planner = createCampaignPlanner({ campaign: MAIN_STORY_CAMPAIGN });
  for (let flagId = 2192; flagId <= 2202; flagId += 1) {
    assert.ok(planner.storyWatch().flags.includes(flagId));
  }
});

test("map access requirements remain globally observed while the player is indoors", () => {
  const planner = createCampaignPlanner({ campaign: { objectives: [{
    id: "catch-paras",
    target: { kind: "encounter-zone", map: "MAP_MT_MOON_1F" },
    completion: { kind: "owned-species", species: [46] },
  }] } });

  assert.deepEqual(planner.storyWatch().variables, [0x404e, 0x4060, 0x406c, 0x4071, 0x4076, 0x407d, 0x8004, 0x8005]);
  assert.ok(planner.storyWatch().flags.includes(83));
  assert.ok(planner.storyWatch().flags.includes(562));
});

test("the campaign explicitly takes a Mt. Moon fossil before routing to Cerulean", () => {
  const planner = createCampaignPlanner({ campaign: MAIN_STORY_CAMPAIGN });
  const selected = planner.select(campaignObservation({
    variables: { 16471: 1, 16468: 2 },
    flags: { 2089: true, 2080: true },
  }));

  assert.deepEqual(selected, {
    id: "mt-moon-fossil",
    target: {
      kind: "object",
      map: "MAP_MT_MOON_B2F",
      index: 1,
    },
    completion: { kind: "flag-set", id: 562 },
    dialogue: "advance",
    choice: "yes",
  });
});

test("the Rocket Hideout campaign gets the Lift Key before using the elevator", () => {
  const objectives = MAIN_STORY_CAMPAIGN.objectives;
  const liftGrunt = objectives.find(({ id }) =>
    id === "rocket-hideout-lift-key-grunt"
  );
  const liftKey = objectives.find(({ id }) => id === "rocket-hideout-lift-key");
  const firstGuard = objectives.find(({ id }) =>
    id === "rocket-hideout-door-grunt-left"
  );

  assert.deepEqual(liftGrunt?.target, {
    kind: "object",
    map: "MAP_ROCKET_HIDEOUT_B4F",
    index: 2,
  });
  assert.deepEqual(liftGrunt?.completion, { kind: "flag-set", id: 1648 });
  assert.deepEqual(liftKey?.completion, {
    kind: "item-at-least",
    id: 356,
    quantity: 1,
  });
  assert.ok(objectives.indexOf(liftGrunt) < objectives.indexOf(liftKey));
  assert.ok(objectives.indexOf(liftKey) < objectives.indexOf(firstGuard));
  for (const id of [
    "rocket-hideout-door-grunt-left",
    "rocket-hideout-door-grunt-right",
    "rocket-hideout-giovanni",
    "silph-scope",
  ]) {
    const objective = objectives.find((candidate) => candidate.id === id);
    assert.equal(objective?.rocketHideoutElevator, true);
    assert.equal(objective?.choiceIndex, 2);
  }
  assert.deepEqual(
    objectives.find(({ id }) => id === "rocket-hideout-exit")?.completion,
    {
      kind: "map-not-in",
      maps: [
        "MAP_ROCKET_HIDEOUT_B1F",
        "MAP_ROCKET_HIDEOUT_B2F",
        "MAP_ROCKET_HIDEOUT_B3F",
        "MAP_ROCKET_HIDEOUT_B4F",
        "MAP_ROCKET_HIDEOUT_ELEVATOR",
      ],
    },
  );
});

test("the campaign opens reachable Silph 3F door two before door one", () => {
  const objectives = MAIN_STORY_CAMPAIGN.objectives;
  const doorTwo = objectives.find(
    ({ id }) => id === "silph-third-floor-door-two",
  );
  const doorOne = objectives.find(
    ({ id }) => id === "silph-third-floor-door",
  );
  const coverageTm = objectives.find(({ id }) => id === "silph-coverage-tm");
  const teachCoverage = objectives.find(({ id }) => id === "teach-secret-power");
  const supplies = objectives.find(({ id }) => id === "silph-supplies");
  const rival = objectives.find(({ id }) => id === "rival-silph");

  assert.deepEqual(doorTwo?.target, {
    kind: "background",
    map: "MAP_SILPH_CO_3F",
    index: 2,
  });
  assert.deepEqual(doorTwo?.completion, { kind: "flag-set", id: 637 });
  assert.deepEqual(doorOne?.target, {
    kind: "background",
    map: "MAP_SILPH_CO_3F",
    index: 0,
  });
  assert.ok(objectives.indexOf(doorTwo) < objectives.indexOf(doorOne));
  assert.deepEqual(coverageTm?.target, {
    kind: "purchase-items",
    map: "MAP_CELADON_CITY_DEPARTMENT_STORE_2F",
    objectIndex: 2,
    items: [{ itemId: 331, stockIndex: 4, quantity: 1, unitPrice: 3000 }],
  });
  assert.deepEqual(coverageTm?.completion, {
    kind: "any",
    completions: [
      { kind: "item-at-least", id: 331, quantity: 1 },
      { kind: "party-knows-move", moveId: 290 },
    ],
  });
  assert.equal(teachCoverage?.target.replaceMoveId, 75);
  assert.deepEqual(supplies?.target, {
    kind: "purchase-items",
    map: "MAP_SAFFRON_CITY_MART",
    objectIndex: 0,
    items: [
      { itemId: 21, stockIndex: 1, quantity: 8, unitPrice: 1200 },
      { itemId: 23, stockIndex: 3, quantity: 4, unitPrice: 600 },
      { itemId: 3, stockIndex: 0, quantity: 15, unitPrice: 600 },
    ],
  });
  assert.ok(objectives.indexOf(doorOne) < objectives.indexOf(coverageTm));
  assert.ok(objectives.indexOf(coverageTm) < objectives.indexOf(teachCoverage));
  assert.ok(objectives.indexOf(teachCoverage) < objectives.indexOf(supplies));
  assert.ok(objectives.indexOf(supplies) < objectives.indexOf(rival));
  assert.equal(rival?.minimumTeamAnchorLevel, 42);
});

function openMap(id, {
  width = 5,
  height = 5,
  warpEvents = [],
  connections = [],
  objectEvents = [],
  coordEvents = [],
  backgroundEvents = [],
  behaviors = {},
  collisions = {},
  elevations = {},
  encounters = {},
} = {}) {
  return {
    id,
    warpEvents,
    connections,
    coordEvents,
    objectEvents,
    backgroundEvents,
    layout: {
      id: `LAYOUT_${id.slice(4)}`,
      width,
      height,
      blockDataSha256: `${id}-fixture`,
      cells: Array.from({ length: width * height }, (_, index) => {
        const x = index % width;
        const y = Math.floor(index / width);
        return {
          x,
          y,
          collision: collisions[`${x},${y}`] ?? 0,
          elevation: elevations[`${x},${y}`] ?? 3,
          behaviorName: behaviors[`${x},${y}`] ?? "MB_NORMAL",
          encounterType: encounters[`${x},${y}`] ?? 0,
        };
      }),
    },
  };
}

function shoreItemFixture() {
  const map = openMap('MAP_SHORE_ITEM', {
    width: 3, height: 3,
    behaviors: { '0,0': 'MB_OCEAN_WATER', '1,0': 'MB_OCEAN_WATER', '2,0': 'MB_OCEAN_WATER' },
    elevations: { '0,0': 1, '1,0': 1, '2,0': 1 },
    encounters: { '1,2': 1 },
    objectEvents: [{ x: 1, y: 1, elevation: 3, graphics_id: 'OBJ_EVENT_GFX_ITEM_BALL' }],
  });
  const observation = campaignObservation({ map: map.id, flags: { 2084: true },
    party: [{ species: 131, hp: 100, moves: [{ id: 57 }] }] });
  observation.playerMemory.position = { x: 1, y: 0 };
  observation.playerMemory.avatar = { surfing: true };
  return { world: { maps: [map] }, observation, objective: {
    id: 'shore-item', target: { kind: 'itemfinder', map: map.id, x: 1, y: 2 },
  } };
}

test('a collectible on shore is approached from matching elevation after dismounting Surf', () => {
  const fixture = shoreItemFixture();
  const recommendation = campaignNavigationRecommendation(fixture);
  assert.equal(recommendation?.kind, 'move-toward');
  assert.ok(['west', 'east'].includes(recommendation?.direction));
  fixture.observation.playerMemory.position = { x: 1, y: 2 };
  fixture.observation.playerMemory.avatar.surfing = false;
  fixture.objective.target = { kind: 'object', map: 'MAP_SHORE_ITEM', index: 0 };
  assert.equal(campaignNavigationRecommendation(fixture)?.kind, 'interact-with-object');
});

test('direct object targets also reject interactions across a surf height boundary', () => {
  const fixture = shoreItemFixture();
  fixture.objective.target = { kind: 'object', map: 'MAP_SHORE_ITEM', index: 0 };
  assert.equal(campaignNavigationRecommendation(fixture)?.kind, 'move-toward');
  fixture.world.maps[0].objectEvents[0].elevation = 0;
  assert.equal(campaignNavigationRecommendation(fixture)?.kind, 'interact-with-object');
});

test('a learned failed interaction approach reroutes without excluding the object itself', () => {
  const fixture = shoreItemFixture();
  fixture.observation.playerMemory.position = { x: 1, y: 2 };
  fixture.observation.playerMemory.avatar.surfing = false;
  fixture.observation.navigationExclusions = { interactions: [{
    x: 1, y: 2, direction: 'north', target: { kind: 'object', index: 0, x: 1, y: 1 },
  }] };
  fixture.objective.target = { kind: 'object', map: 'MAP_SHORE_ITEM', index: 0 };
  const recommendation = campaignNavigationRecommendation(fixture);
  assert.equal(recommendation?.kind, 'move-toward');
  assert.ok(['east', 'west'].includes(recommendation?.direction));
  fixture.objective.target = { kind: 'itemfinder', map: 'MAP_SHORE_ITEM', x: 1, y: 1 };
  assert.equal(campaignNavigationRecommendation(fixture)?.kind, 'move-toward');
});

function collectionStory({ flags = {}, items = {}, scripts = [] } = {}) {
  return {
    data: {
      symbols: {
        flags: Object.fromEntries(
          Object.entries(flags).map(([name, value]) => [name, { value }]),
        ),
        items: Object.fromEntries(
          Object.entries(items).map(([name, value]) => [name, { value }]),
        ),
      },
      scripts,
    },
  };
}

function postThunderMasteryFixture({ aideMap = false } = {}) {
  const route = openMap("MAP_ROUTE11", {
    objectEvents: [{
      x: 3,
      y: 1,
      script: "Route11_EventScript_Youngster",
      trainer_type: "TRAINER_TYPE_NORMAL",
    }],
    encounters: { "1,1": 1, "2,1": 1 },
    behaviors: { "1,1": "MB_TALL_GRASS", "2,1": "MB_TALL_GRASS" },
  });
  const maps = [route];
  if (aideMap) {
    maps.push(openMap("MAP_ROUTE11_EAST_ENTRANCE_2F", {
      objectEvents: [
        { x: 1, y: 1, script: "Route11_EastEntrance_2F_EventScript_Turner" },
        { x: 3, y: 1, script: "Route11_EastEntrance_2F_EventScript_Aide" },
      ],
    }));
  }
  return {
    world: { data: {
      maps,
      wildEncounters: [{
        map: route.id,
        land_mons: {
          encounter_rate: 21,
          mons: [
            { min_level: 11, max_level: 15, species: "SPECIES_DROWZEE" },
            { min_level: 12, max_level: 15, species: "SPECIES_EKANS" },
            { min_level: 13, max_level: 17, species: "SPECIES_SPEAROW" },
          ],
        },
      }],
    } },
    story: { data: {
      symbols: {
        trainers: { TRAINER_YOUNGSTER_ROUTE11: { value: 41 } },
        flags: {},
        items: {},
      },
      scripts: [{
        label: "Route11_EventScript_Youngster",
        instructions: [{
          op: "trainerbattle_single",
          args: ["TRAINER_YOUNGSTER_ROUTE11", "intro", "defeat"],
        }],
      }],
    } },
    mechanics: { data: {
      species: [
        { id: 21, name: "SPECIES_SPEAROW" },
        { id: 23, name: "SPECIES_EKANS" },
        { id: 96, name: "SPECIES_DROWZEE" },
      ],
      trainers: [{
        id: 41,
        name: "TRAINER_YOUNGSTER_ROUTE11",
        trainerName: "EDDIE",
        party: [{ lvl: 21, species: "SPECIES_EKANS" }],
      }],
    } },
  };
}

function postThunderObservation({ trainerDefeated = false, ownedSpecies = [21, 23] } = {}) {
  const observation = campaignObservation({
    map: "MAP_ROUTE11",
    flags: {
      571: true,
      594: true,
      598: true,
      762: true,
      765: true,
      2082: true,
      [0x500 + 41]: trainerDefeated,
    },
    party: [{ slot: 0, species: 5, level: 32, hp: 80, maxHp: 80, moves: [] }],
  });
  observation.playerMemory.position = { x: 1, y: 1 };
  observation.playerMemory.trainer.pokedex = {
    ownedSpecies,
    seenSpecies: [...ownedSpecies, 96],
    ownedCount: ownedSpecies.length,
    seenCount: new Set([...ownedSpecies, 96]).size,
  };
  observation.playerMemory.trainer.bag = {
    pokeBalls: [{ itemId: 4, quantity: 20 }],
  };
  observation.playerMemory.trainer.money = 12000;
  return observation;
}

test("post-badge mastery clears undefeated route trainers before wild coverage", () => {
  const { world, story, mechanics } = postThunderMasteryFixture();
  const planner = createCampaignPlanner({
    campaign: { objectives: [{
      id: "continue-to-celadon",
      target: { kind: "map-arrival", map: "MAP_CELADON_CITY", x: 1, y: 1 },
      completion: { kind: "flag-set", id: 9999 },
    }] },
    world,
    story,
    mechanics,
  });

  const objective = planner.select(postThunderObservation());

  assert.equal(objective?.id, "mastery-trainer:MAP_ROUTE11:0");
  assert.deepEqual(objective?.target, {
    kind: "object",
    map: "MAP_ROUTE11",
    index: 0,
  });
  assert.equal(objective?.trainingSource, "trainer");
  assert.equal(objective?.regionalMastery, true);

  const priorityPlanner = createCampaignPlanner({
    campaign: { objectives: [{
      id: "complete-priority-story-transaction",
      target: { kind: "map-arrival", map: "MAP_CELADON_CITY", x: 1, y: 1 },
      completion: { kind: "flag-set", id: 9999 },
      deferOptionalDetours: true,
    }] },
    world,
    story,
    mechanics,
  });
  assert.equal(
    priorityPlanner.select(postThunderObservation())?.id,
    "complete-priority-story-transaction",
    "regional mastery must not interrupt an explicit story transaction",
  );
});

test("regional mastery cannot interrupt an active Strength boulder puzzle", () => {
  const { world, story, mechanics } = postThunderMasteryFixture();
  world.data.maps[0].objectEvents.push({
    x: 2,
    y: 2,
    graphics_id: "OBJ_EVENT_GFX_PUSHABLE_BOULDER",
    script: "EventScript_StrengthBoulder",
  });
  const planner = createCampaignPlanner({
    campaign: { objectives: [{
      id: "victory-road-switch",
      target: {
        kind: "push-boulder",
        map: "MAP_ROUTE11",
        objectIndex: 1,
        x: 4,
        y: 4,
      },
      completion: { kind: "variable-at-least", id: 0x4064, value: 100 },
    }] },
    world,
    story,
    mechanics,
  });

  assert.equal(
    planner.select(postThunderObservation())?.id,
    "victory-road-switch",
  );
});

test("regional mastery keeps one trainer objective while crossing a gatehouse", () => {
  const route9 = openMap("MAP_ROUTE9", {
    connections: [{ direction: "left", map: "MAP_MASTERY_GATE", offset: 0 }],
    objectEvents: [{
      x: 3,
      y: 1,
      script: "Route9_EventScript_Trainer",
      trainer_type: "TRAINER_TYPE_NORMAL",
    }],
  });
  const gate = openMap("MAP_MASTERY_GATE", {
    connections: [
      { direction: "left", map: "MAP_ROUTE11", offset: 0 },
      { direction: "right", map: route9.id, offset: 0 },
    ],
    objectEvents: [{
      x: 1,
      y: 1,
      flag: "FLAG_HIDE_MASTERY_GATE_POTION_FIXTURE",
      graphics_id: "OBJ_EVENT_GFX_ITEM_BALL",
      script: "MasteryGate_EventScript_PotionFixture",
    }],
  });
  const route11 = openMap("MAP_ROUTE11", {
    connections: [{ direction: "right", map: gate.id, offset: 0 }],
    objectEvents: [{
      x: 3,
      y: 1,
      script: "Route11_EventScript_Trainer",
      trainer_type: "TRAINER_TYPE_NORMAL",
    }],
  });
  const planner = createCampaignPlanner({
    campaign: { objectives: [{
      id: "continue-story",
      target: { kind: "map-arrival", map: "MAP_CELADON_CITY", x: 1, y: 1 },
      completion: { kind: "flag-set", id: 9999 },
    }] },
    world: { data: { maps: [route9, gate, route11] } },
    story: { data: {
      symbols: {
        trainers: {
          TRAINER_ROUTE9_FIXTURE: { value: 41 },
          TRAINER_ROUTE11_FIXTURE: { value: 42 },
        },
        flags: { FLAG_HIDE_MASTERY_GATE_POTION_FIXTURE: { value: 777 } },
        items: { ITEM_POTION: { value: 13 } },
      },
      scripts: [
        {
          label: "Route9_EventScript_Trainer",
          instructions: [{
            op: "trainerbattle_single",
            args: ["TRAINER_ROUTE9_FIXTURE", "intro", "defeat"],
          }],
        },
        {
          label: "Route11_EventScript_Trainer",
          instructions: [{
            op: "trainerbattle_single",
            args: ["TRAINER_ROUTE11_FIXTURE", "intro", "defeat"],
          }],
        },
        {
          label: "MasteryGate_EventScript_PotionFixture",
          instructions: [{ op: "finditem", args: ["ITEM_POTION"] }],
        },
      ],
    } },
    mechanics: { data: { trainers: [
      {
        id: 41,
        name: "TRAINER_ROUTE9_FIXTURE",
        trainerName: "NINE",
        party: [{ lvl: 20, species: "SPECIES_SPEAROW" }],
      },
      {
        id: 42,
        name: "TRAINER_ROUTE11_FIXTURE",
        trainerName: "ELEVEN",
        party: [{ lvl: 20, species: "SPECIES_EKANS" }],
      },
    ] } },
  });
  const flags = {
    571: true,
    594: true,
    598: true,
    762: true,
    777: false,
    2082: true,
    [0x500 + 41]: false,
    [0x500 + 42]: false,
  };
  const routeObservation = campaignObservation({ map: route11.id, flags });
  routeObservation.playerMemory.position = { x: 1, y: 1 };
  const gateObservation = campaignObservation({ map: gate.id, flags });
  gateObservation.playerMemory.position = { x: 2, y: 2 };

  assert.equal(
    planner.select(routeObservation)?.id,
    "mastery-trainer:MAP_ROUTE11:0",
  );
  const committedObjective = planner.select(gateObservation);
  assert.equal(
    committedObjective?.id,
    "mastery-trainer:MAP_ROUTE11:0",
    "crossing a neutral gate must not retarget the closest trainer behind the player",
  );
  assert.equal(
    planner.selectCollection(gateObservation, committedObjective),
    null,
    "an optional pickup must not reverse travel away from a committed mastery objective",
  );
});

test("optional Pokémon Tower work waits for the Silph Scope", () => {
  const tower = openMap("MAP_POKEMON_TOWER_3F", {
    objectEvents: [
      {
        x: 3,
        y: 1,
        script: "PokemonTower_3F_EventScript_Channeler",
        trainer_type: "TRAINER_TYPE_NORMAL",
      },
      {
        x: 1,
        y: 3,
        flag: "FLAG_HIDE_POKEMON_TOWER_POTION",
        graphics_id: "OBJ_EVENT_GFX_ITEM_BALL",
        script: "PokemonTower_3F_EventScript_Potion",
      },
    ],
  });
  const trainerId = 77;
  const planner = createCampaignPlanner({
    campaign: { objectives: [{
      id: "continue-main-story",
      target: { kind: "object", map: tower.id, index: 0 },
      completion: { kind: "flag-set", id: 9999 },
    }] },
    world: { data: { maps: [tower] } },
    story: { data: {
      symbols: {
        trainers: { TRAINER_CHANNELER_TOWER: { value: trainerId } },
        flags: { FLAG_HIDE_POKEMON_TOWER_POTION: { value: 777 } },
        items: { ITEM_POTION: { value: 13 } },
      },
      scripts: [
        {
          label: "PokemonTower_3F_EventScript_Channeler",
          instructions: [{
            op: "trainerbattle_single",
            args: ["TRAINER_CHANNELER_TOWER", "intro", "defeat"],
          }],
        },
        {
          label: "PokemonTower_3F_EventScript_Potion",
          instructions: [{ op: "finditem", args: ["ITEM_POTION"] }],
        },
      ],
    } },
    mechanics: { data: { trainers: [{
      id: trainerId,
      name: "TRAINER_CHANNELER_TOWER",
      trainerName: "HOPE",
      party: [{ lvl: 23, species: "SPECIES_GASTLY" }],
    }] } },
  });
  const observed = campaignObservation({
    map: tower.id,
    flags: { 777: false, 2083: true, [0x500 + trainerId]: false },
    bag: { items: [], keyItems: [] },
    party: [{ slot: 0, species: 5, level: 22, hp: 60, moves: [] }],
  });
  observed.playerMemory.position = { x: 1, y: 1 };

  const trainingObjective = {
    id: "prepare-next-battle",
    target: { kind: "object", map: tower.id, index: 0 },
    minimumTeamAnchorLevel: 25,
  };
  assert.equal(planner.selectTraining(observed, trainingObjective), null);
  assert.equal(planner.selectCollection(observed), null);
  assert.equal(planner.select(observed)?.id, "continue-main-story");

  observed.playerMemory.trainer.bag.keyItems.push({
    itemId: 359,
    quantity: 1,
  });
  assert.equal(
    planner.selectTraining(observed, trainingObjective)?.id,
    "train-team-anchor-with-trainer",
  );
  assert.equal(
    planner.selectCollection(observed)?.id,
    "collect:MAP_POKEMON_TOWER_3F:visible:1",
  );
  assert.equal(
    planner.select(observed)?.id,
    "mastery-trainer:MAP_POKEMON_TOWER_3F:0",
  );
});

test("HM05 from Oak's aide is taught to the designated utility carrier", () => {
  const { world, story, mechanics } = postThunderMasteryFixture();
  const planner = createCampaignPlanner({
    campaign: { objectives: [{
      id: "continue-to-celadon",
      target: { kind: "map-arrival", map: "MAP_CELADON_CITY", x: 1, y: 1 },
      completion: { kind: "flag-set", id: 9999 },
    }] },
    teamPlan: createOriginsTeamPlan(4),
    world,
    story,
    mechanics,
  });
  const observation = postThunderObservation();
  observation.playerMemory.trainer.party.push({
    slot: 1,
    species: 47,
    level: 28,
    hp: 80,
    maxHp: 80,
    moves: [15, 71, 147, 141],
  });
  observation.playerMemory.trainer.bag.tmhm = [{ itemId: 343, quantity: 1 }];

  const objective = planner.select(observation);

  assert.equal(objective?.id, "teach-flash-for-regional-mastery");
  assert.deepEqual(objective?.target, {
    kind: "teach-move",
    itemId: 343,
    moveId: 148,
    partySpecies: [46, 47],
  });
  assert.deepEqual(objective?.completion, {
    kind: "party-knows-move",
    moveId: 148,
  });

  observation.playerMemory.trainer.party[1].moves[3] = 148;
  assert.equal(planner.select(observation)?.id, "mastery-trainer:MAP_ROUTE11:0");
});

test("dedicated optional wild hunts wait until the Hall of Fame", () => {
  const { world, story, mechanics } = postThunderMasteryFixture();
  const planner = createCampaignPlanner({
    campaign: { objectives: [{
      id: "continue-to-celadon",
      target: { kind: "map-arrival", map: "MAP_CELADON_CITY", x: 1, y: 1 },
      completion: { kind: "flag-set", id: 9999 },
    }] },
    world,
    story,
    mechanics,
  });

  const observation = postThunderObservation({ trainerDefeated: true });

  assert.equal(planner.select(observation)?.id, "continue-to-celadon");

  observation.playerMemory.storyState.flagIds[2092] = true;
  const objective = planner.select(observation);

  assert.equal(objective?.id, "mastery-capture:MAP_ROUTE11:96");
  assert.deepEqual(objective?.target, {
    kind: "encounter-zone",
    map: "MAP_ROUTE11",
  });
  assert.deepEqual(objective?.captureSpecies, [96]);
  assert.deepEqual(objective?.completion, {
    kind: "owned-species",
    species: [96],
  });
  assert.equal(objective?.maximumTeamLevelGap, undefined);
});

test("training infrastructure gets the VS Seeker, then common catches, then EXP Share", () => {
  const route = openMap("MAP_ROUTE15", {
    connections: [
      { direction: "left", map: "MAP_VERMILION_CITY_POKEMON_CENTER_1F", offset: 0 },
      { direction: "right", map: "MAP_ROUTE15_WEST_ENTRANCE_2F", offset: 0 },
    ],
    encounters: { "1,1": 1, "2,1": 1 },
    behaviors: { "1,1": "MB_TALL_GRASS", "2,1": "MB_TALL_GRASS" },
  });
  const vermilionCenter = openMap("MAP_VERMILION_CITY_POKEMON_CENTER_1F", {
    connections: [{ direction: "right", map: route.id, offset: 0 }],
    objectEvents: Array.from({ length: 5 }, (_, index) => ({
      x: index === 4 ? 3 : 1,
      y: index === 4 ? 2 : 1,
    })),
  });
  const aideGate = openMap("MAP_ROUTE15_WEST_ENTRANCE_2F", {
    connections: [{ direction: "left", map: route.id, offset: 0 }],
    objectEvents: [{ x: 3, y: 2 }],
  });
  const plannerOptions = {
    campaign: { objectives: [{
      id: "continue-story",
      target: { kind: "map-arrival", map: route.id, x: 3, y: 3 },
      completion: { kind: "flag-set", id: 9999 },
    }] },
    world: { maps: [route, vermilionCenter, aideGate], wildEncounters: [{
      map: route.id,
      land_mons: {
        encounter_rate: 25,
        mons: [
          { min_level: 22, max_level: 24, species: "SPECIES_DROWZEE" },
          { min_level: 22, max_level: 24, species: "SPECIES_DROWZEE" },
          { min_level: 22, max_level: 24, species: "SPECIES_DROWZEE" },
          { min_level: 22, max_level: 24, species: "SPECIES_DROWZEE" },
          { min_level: 22, max_level: 24, species: "SPECIES_DROWZEE" },
          { min_level: 22, max_level: 24, species: "SPECIES_DROWZEE" },
          { min_level: 22, max_level: 24, species: "SPECIES_DROWZEE" },
          { min_level: 22, max_level: 24, species: "SPECIES_DROWZEE" },
          { min_level: 22, max_level: 24, species: "SPECIES_DROWZEE" },
          { min_level: 22, max_level: 24, species: "SPECIES_DROWZEE" },
          { min_level: 24, max_level: 26, species: "SPECIES_SCYTHER" },
          { min_level: 24, max_level: 26, species: "SPECIES_SCYTHER" },
        ],
      },
    }] },
    story: { symbols: {}, scripts: [] },
    mechanics: { species: [
      { id: 96, name: "SPECIES_DROWZEE" },
      { id: 123, name: "SPECIES_SCYTHER" },
    ], trainers: [] },
  };
  const planner = createCampaignPlanner(plannerOptions);
  const observation = campaignObservation({
    map: route.id,
    flags: {
      84: true,
      598: false,
      658: false,
      2081: true,
      2083: true,
    },
    bag: { keyItems: [], items: [], pokeBalls: [{ itemId: 4, quantity: 20 }] },
  });
  observation.playerMemory.position = { x: 1, y: 1 };
  observation.playerMemory.trainer.pokedex = {
    ownedSpecies: Array.from({ length: 43 }, (_, index) => index + 1),
    ownedCount: 43,
    seenSpecies: Array.from({ length: 43 }, (_, index) => index + 1),
    seenCount: 43,
  };

  assert.equal(planner.select(observation)?.id, "vs-seeker");

  observation.emulator.mode = "start-menu";
  assert.equal(
    planner.select(observation)?.id,
    "vs-seeker",
    "opening a menu must not replace a committed infrastructure transaction",
  );
  const restored = createCampaignPlanner({ ...plannerOptions,
    initialState: JSON.parse(JSON.stringify(planner.state())),
  });
  assert.equal(restored.select(observation)?.id, "vs-seeker",
    "a restart in the menu must retain the infrastructure transaction");
  observation.emulator.mode = "overworld";

  observation.playerMemory.storyState.flagIds[658] = true;
  observation.playerMemory.trainer.bag.keyItems.push({ itemId: 362, quantity: 1 });
  const capture = planner.select(observation);
  assert.equal(capture?.id, "exp-share-capture:MAP_ROUTE15:96");
  assert.deepEqual(capture?.captureSpecies, [96]);
  assert.equal(
    capture?.captureSpecies.includes(123),
    false,
    "a one-percent species must remain a postgame hunt",
  );

  observation.playerMemory.trainer.pokedex.ownedSpecies = Array.from(
    { length: 50 },
    (_, index) => index + 1,
  );
  observation.playerMemory.trainer.pokedex.ownedCount = 50;
  const aide = planner.select(observation);
  assert.equal(aide?.id, "oak-aide-exp-share");
  assert.deepEqual(aide?.target, {
    kind: "object",
    map: "MAP_ROUTE15_WEST_ENTRANCE_2F",
    index: 0,
  });
});

test("an Origins acquisition transaction outranks optional regional mastery", () => {
  const { world, story, mechanics } = postThunderMasteryFixture();
  const objective = {
    id: "origins-eevee-gift",
    target: {
      kind: "object",
      map: "MAP_CELADON_CITY_CONDOMINIUMS_ROOF_ROOM",
      index: 1,
    },
    completion: { kind: "owned-species", species: [133, 134, 135, 136] },
    acquisitionId: "origins-jolteon",
    reservedPartySlots: 1,
  };
  const planner = createCampaignPlanner({
    campaign: { objectives: [objective] },
    world,
    story,
    mechanics,
  });

  assert.equal(
    planner.select(postThunderObservation({ trainerDefeated: true }))?.id,
    "origins-eevee-gift",
  );
});

test("land species confined to multiple rare slots wait until the Hall of Fame", () => {
  const mtMoon = openMap("MAP_MT_MOON_1F", {
    encounters: { "1,1": 1, "2,1": 1 },
    behaviors: { "1,1": "MB_CAVE_FLOOR", "2,1": "MB_CAVE_FLOOR" },
  });
  const world = { data: {
    maps: [mtMoon],
    wildEncounters: [{
      map: mtMoon.id,
      land_mons: {
        encounter_rate: 7,
        mons: Array.from({ length: 12 }, (_, index) => ({
          min_level: 7 + index % 3,
          max_level: 7 + index % 3,
          species: index === 6 || index === 9
            ? "SPECIES_CLEFAIRY"
            : "SPECIES_ZUBAT",
        })),
      },
    }],
  } };
  const mechanics = { data: {
    species: [
      { id: 35, name: "SPECIES_CLEFAIRY" },
      { id: 41, name: "SPECIES_ZUBAT" },
    ],
    trainers: [],
  } };
  const planner = createCampaignPlanner({
    campaign: { objectives: [{
      id: "continue-to-cerulean",
      target: { kind: "map-arrival", map: "MAP_CERULEAN_CITY", x: 1, y: 1 },
      completion: { kind: "flag-set", id: 9999 },
    }] },
    world,
    mechanics,
  });
  const observation = campaignObservation({
    map: mtMoon.id,
    flags: { 2080: true },
  });
  observation.playerMemory.position = { x: 1, y: 1 };
  observation.playerMemory.trainer.pokedex = {
    ownedSpecies: [41],
    seenSpecies: [35, 41],
    ownedCount: 1,
    seenCount: 2,
  };
  observation.playerMemory.trainer.bag = {
    pokeBalls: [{ itemId: 4, quantity: 30 }],
  };

  assert.equal(planner.select(observation)?.id, "continue-to-cerulean");

  observation.playerMemory.storyState.flagIds[2092] = true;
  observation.playerMemory.storyState.flagIds[9999] = true;
  assert.equal(
    planner.select(observation)?.id,
    "mastery-capture:MAP_MT_MOON_1F:35",
  );
});

test("established team captures outrank optional regional mastery", () => {
  const mtMoon = openMap("MAP_MT_MOON_1F", {
    encounters: { "1,1": 1, "2,1": 1 },
    behaviors: { "1,1": "MB_CAVE_FLOOR", "2,1": "MB_CAVE_FLOOR" },
  });
  const world = { data: {
    maps: [mtMoon],
    wildEncounters: [{
      map: mtMoon.id,
      land_mons: {
        encounter_rate: 7,
        mons: [
          ...Array.from({ length: 11 }, (_, index) => ({
            min_level: 7 + index % 3,
            max_level: 7 + index % 3,
            species: "SPECIES_ZUBAT",
          })),
          { min_level: 8, max_level: 8, species: "SPECIES_CLEFAIRY" },
        ],
      },
    }],
  } };
  const mechanics = { data: {
    species: [
      { id: 35, name: "SPECIES_CLEFAIRY" },
      { id: 41, name: "SPECIES_ZUBAT" },
    ],
    trainers: [],
  } };
  const planner = createCampaignPlanner({
    campaign: { objectives: [{
      id: "origins-required-clefairy",
      target: { kind: "encounter-zone", map: mtMoon.id },
      completion: { kind: "owned-species", species: [35] },
      captureSpecies: [35],
    }] },
    world,
    mechanics,
  });
  const observation = campaignObservation({
    map: mtMoon.id,
    flags: { 2080: true },
  });
  observation.playerMemory.position = { x: 1, y: 1 };
  observation.playerMemory.trainer.pokedex = {
    ownedSpecies: [],
    seenSpecies: [35, 41],
    ownedCount: 0,
    seenCount: 2,
  };
  observation.playerMemory.trainer.bag = {
    pokeBalls: [{ itemId: 4, quantity: 30 }],
  };

  assert.equal(planner.select(observation)?.id, "origins-required-clefairy");
});

test("one-percent surf captures wait until the Hall of Fame", () => {
  const route = openMap("MAP_ROUTE19", {
    width: 4,
    height: 3,
    behaviors: {
      "1,0": "MB_OCEAN_WATER",
      "1,1": "MB_OCEAN_WATER",
      "1,2": "MB_OCEAN_WATER",
      "2,0": "MB_OCEAN_WATER",
      "2,1": "MB_OCEAN_WATER",
      "2,2": "MB_OCEAN_WATER",
    },
  });
  const world = { data: {
    maps: [route],
    wildEncounters: [{
      map: route.id,
      water_mons: {
        encounter_rate: 2,
        mons: [
          ...Array.from({ length: 4 }, (_, index) => ({
            min_level: 25 + index,
            max_level: 25 + index,
            species: "SPECIES_TENTACOOL",
          })),
          { min_level: 30, max_level: 30, species: "SPECIES_STARYU" },
        ],
      },
    }],
  } };
  const mechanics = { data: {
    species: [
      { id: 72, name: "SPECIES_TENTACOOL" },
      { id: 120, name: "SPECIES_STARYU" },
    ],
    trainers: [],
  } };
  const planner = createCampaignPlanner({
    campaign: { objectives: [{
      id: "continue-story",
      target: { kind: "map-arrival", map: route.id, x: 3, y: 2 },
      completion: { kind: "flag-set", id: 9999 },
    }] },
    world,
    mechanics,
  });
  const observation = campaignObservation({
    map: route.id,
    flags: { 2084: true },
    party: [{ slot: 0, species: 9, level: 40, hp: 100, maxHp: 100, moves: [57] }],
  });
  observation.playerMemory.position = { x: 0, y: 1 };
  observation.playerMemory.trainer.pokedex = {
    ownedSpecies: [72],
    seenSpecies: [72, 120],
    ownedCount: 1,
    seenCount: 2,
  };
  observation.playerMemory.trainer.bag = {
    pokeBalls: [{ itemId: 4, quantity: 30 }],
  };

  assert.equal(planner.select(observation)?.id, "continue-story");
});

test("one-percent fishing captures wait until the Hall of Fame", () => {
  const route = openMap("MAP_ROUTE11", {
    width: 4,
    height: 3,
    behaviors: {
      "1,0": "MB_POND_WATER",
      "1,1": "MB_POND_WATER",
      "1,2": "MB_POND_WATER",
      "2,0": "MB_POND_WATER",
      "2,1": "MB_POND_WATER",
      "2,2": "MB_POND_WATER",
    },
  });
  const fishingMons = [
    "SPECIES_MAGIKARP",
    "SPECIES_MAGIKARP",
    "SPECIES_HORSEA",
    "SPECIES_HORSEA",
    "SPECIES_HORSEA",
    "SPECIES_HORSEA",
    "SPECIES_HORSEA",
    "SPECIES_HORSEA",
    "SPECIES_HORSEA",
    "SPECIES_PSYDUCK",
  ].map((species, index) => ({
    min_level: index < 5 ? 5 : 20,
    max_level: index < 5 ? 10 : 30,
    species,
  }));
  const world = { data: {
    maps: [route],
    wildEncounters: [{
      map: route.id,
      fishing_mons: { encounter_rate: 20, mons: fishingMons },
    }],
  } };
  const mechanics = { data: {
    species: [
      { id: 54, name: "SPECIES_PSYDUCK" },
      { id: 116, name: "SPECIES_HORSEA" },
      { id: 129, name: "SPECIES_MAGIKARP" },
    ],
    trainers: [],
  } };
  const planner = createCampaignPlanner({
    campaign: { objectives: [{
      id: "continue-story",
      target: { kind: "map-arrival", map: route.id, x: 3, y: 2 },
      completion: { kind: "flag-set", id: 9999 },
    }] },
    world,
    mechanics,
  });
  const observation = campaignObservation({
    map: route.id,
    flags: { 2082: true },
  });
  observation.playerMemory.position = { x: 0, y: 1 };
  observation.playerMemory.trainer.pokedex = {
    ownedSpecies: [116],
    seenSpecies: [54, 116],
    ownedCount: 1,
    seenCount: 2,
  };
  observation.playerMemory.trainer.bag = {
    keyItems: [{ itemId: 264, quantity: 1 }],
    pokeBalls: [{ itemId: 4, quantity: 30 }],
  };

  assert.equal(planner.select(observation)?.id, "continue-story");
});

test("postgame mastery spends trainer winnings on medicine before capture balls", () => {
  const { world, story, mechanics } = postThunderMasteryFixture();
  world.data.maps[0].objectEvents.push({
    x: 4,
    y: 3,
    script: "Route11_EventScript_TestClerk",
  });
  story.data.symbols.items = {
    ITEM_POKE_BALL: { value: 4 },
    ITEM_POTION: { value: 13 },
  };
  story.data.scripts.push({
    label: "Route11_EventScript_TestClerk",
    instructions: [{ op: "pokemart", args: ["Route11_TestStock"] }],
  }, {
    label: "Route11_TestStock",
    instructions: [
      { op: ".2byte", args: ["ITEM_POTION"] },
      { op: ".2byte", args: ["ITEM_POKE_BALL"] },
      { op: ".2byte", args: ["ITEM_NONE"] },
    ],
  });
  const planner = createCampaignPlanner({
    campaign: { objectives: [{
      id: "continue-to-celadon",
      target: { kind: "map-arrival", map: "MAP_CELADON_CITY", x: 1, y: 1 },
      completion: { kind: "flag-set", id: 9999 },
    }] },
    world,
    story,
    mechanics,
  });
  const observation = postThunderObservation({ trainerDefeated: true });
  observation.playerMemory.storyState.flagIds[2092] = true;
  observation.playerMemory.trainer.bag = { items: [], pokeBalls: [] };
  observation.playerMemory.trainer.money = 6000;

  const objective = planner.select(observation);

  assert.equal(objective?.id, "mastery-supplies:MAP_ROUTE11");
  assert.deepEqual(objective?.target, {
    kind: "purchase-items",
    map: "MAP_ROUTE11",
    objectIndex: 1,
    items: [
      { itemId: 13, stockIndex: 0, quantity: 6, unitPrice: 300 },
      { itemId: 4, stockIndex: 1, quantity: 12, unitPrice: 200 },
    ],
  });
  assert.deepEqual(objective?.supplyPriority, [
    "medicine",
    "revives",
    "status-medicine",
    "poke-balls",
  ]);
});

test("a generic important battle skips status cures without a matching threat", () => {
  const city = openMap("MAP_TEST_CITY", {
    objectEvents: [
      { x: 3, y: 1, script: "TestCity_EventScript_Clerk" },
      { x: 3, y: 3, script: "TestCity_EventScript_Boss" },
    ],
  });
  const plannerOptions = {
    campaign: { objectives: [{
      id: "badge-test",
      target: { kind: "object", map: city.id, index: 1 },
      completion: { kind: "flag-set", id: 9999 },
      importantBattle: true,
    }] },
    world: { data: { maps: [city] } },
    story: collectionStory({
      items: {
        ITEM_GREAT_BALL: 3,
        ITEM_SUPER_POTION: 22,
        ITEM_REVIVE: 24,
        ITEM_ANTIDOTE: 14,
        ITEM_PARALYZE_HEAL: 18,
        ITEM_AWAKENING: 17,
        ITEM_BURN_HEAL: 15,
        ITEM_ICE_HEAL: 16,
      },
      scripts: [{
        label: "TestCity_EventScript_Clerk",
        instructions: [{ op: "pokemart", args: ["TestCity_Mart_Items"] }],
      }, {
        label: "TestCity_Mart_Items",
        instructions: [
          { op: ".2byte", args: ["ITEM_GREAT_BALL"] },
          { op: ".2byte", args: ["ITEM_SUPER_POTION"] },
          { op: ".2byte", args: ["ITEM_REVIVE"] },
          { op: ".2byte", args: ["ITEM_ANTIDOTE"] },
          { op: ".2byte", args: ["ITEM_PARALYZE_HEAL"] },
          { op: ".2byte", args: ["ITEM_AWAKENING"] },
          { op: ".2byte", args: ["ITEM_BURN_HEAL"] },
          { op: ".2byte", args: ["ITEM_ICE_HEAL"] },
          { op: ".2byte", args: ["ITEM_NONE"] },
        ],
      }],
    }),
  };
  const planner = createCampaignPlanner(plannerOptions);
  const observation = campaignObservation({
    map: city.id,
    flags: { 9999: false },
    bag: { items: [], pokeBalls: [] },
    party: [{ slot: 0, species: 22, level: 34, hp: 90, maxHp: 90 }],
  });
  observation.playerMemory.position = { x: 1, y: 1 };
  observation.playerMemory.trainer.money = 40_000;

  const objective = planner.select(observation);

  assert.equal(objective?.id, "battle-medicine:badge-test:MAP_TEST_CITY");
  assert.deepEqual(objective?.target, {
    kind: "purchase-items",
    map: city.id,
    objectIndex: 0,
    items: [
      { itemId: 22, stockIndex: 1, quantity: 4, unitPrice: 700 },
      { itemId: 24, stockIndex: 2, quantity: 2, unitPrice: 1500 },
    ],
  });
  assert.deepEqual(objective?.supplyPriority, [
    "medicine",
    "revives",
    "status-medicine",
  ]);

  observation.playerMemory.trainer.bag.items = objective.target.items.map(
    ({ itemId, quantity }) => ({ itemId, quantity }),
  );
  assert.equal(planner.select(observation)?.id, "badge-test");
  assert.equal(
    planner.state().battleMedicineServicedForObjectiveId,
    "badge-test",
  );

  const resumed = createCampaignPlanner({
    ...plannerOptions,
    initialState: planner.state(),
  });
  observation.playerMemory.trainer.bag.items.find(
    ({ itemId }) => itemId === 22,
  ).quantity = 3;
  assert.equal(
    resumed.select(observation)?.id,
    "badge-test",
    "a restart must not turn one consumed treatment into another shopping trip",
  );

  observation.playerMemory.trainer.bag.items = objective.target.items.map(
    ({ itemId, quantity }) => ({ itemId, quantity }),
  );
  const alreadyStocked = createCampaignPlanner(plannerOptions);
  assert.equal(alreadyStocked.select(observation)?.id, "badge-test");
  assert.equal(
    alreadyStocked.state().battleMedicineServicedForObjectiveId,
    "badge-test",
    "a fresh planner must recognize a reserve that was stocked before restart",
  );
  observation.playerMemory.trainer.bag.items.find(
    ({ itemId }) => itemId === 22,
  ).quantity = 3;
  assert.equal(
    alreadyStocked.select(observation)?.id,
    "badge-test",
    "using one treatment after restart must not reopen the shopping transaction",
  );
  observation.playerMemory.trainer.bag.items.find(
    ({ itemId }) => itemId === 22,
  ).quantity = 1;
  assert.equal(
    alreadyStocked.select(observation)?.id,
    "battle-medicine:badge-test:MAP_TEST_CITY",
    "critical depletion before the boss must reopen the shopping transaction",
  );
});

test("important-battle medicine is value-sized, threat-specific, and wholly affordable", () => {
  const city = openMap("MAP_VALUE_CITY", {
    objectEvents: [
      { x: 3, y: 1, script: "ValueCity_EventScript_Clerk" },
      { x: 3, y: 3, script: "ValueCity_EventScript_Boss" },
    ],
  });
  const plannerOptions = {
    campaign: { objectives: [{
      id: "badge-value",
      target: { kind: "object", map: city.id, index: 1 },
      completion: { kind: "flag-set", id: 9998 },
      importantBattle: true,
      statusThreatItemIds: [14],
    }] },
    world: { data: { maps: [city] } },
    story: collectionStory({
      items: {
        ITEM_POTION: 13,
        ITEM_SUPER_POTION: 22,
        ITEM_HYPER_POTION: 21,
        ITEM_MAX_POTION: 20,
        ITEM_FULL_RESTORE: 19,
        ITEM_REVIVE: 24,
        ITEM_FULL_HEAL: 23,
        ITEM_ANTIDOTE: 14,
      },
      scripts: [{
        label: "ValueCity_EventScript_Clerk",
        instructions: [{ op: "pokemart", args: ["ValueCity_Mart_Items"] }],
      }, {
        label: "ValueCity_Mart_Items",
        instructions: [
          { op: ".2byte", args: ["ITEM_POTION"] },
          { op: ".2byte", args: ["ITEM_SUPER_POTION"] },
          { op: ".2byte", args: ["ITEM_HYPER_POTION"] },
          { op: ".2byte", args: ["ITEM_MAX_POTION"] },
          { op: ".2byte", args: ["ITEM_FULL_RESTORE"] },
          { op: ".2byte", args: ["ITEM_REVIVE"] },
          { op: ".2byte", args: ["ITEM_FULL_HEAL"] },
          { op: ".2byte", args: ["ITEM_ANTIDOTE"] },
          { op: ".2byte", args: ["ITEM_NONE"] },
        ],
      }],
    }),
  };
  const observed = campaignObservation({
    map: city.id,
    flags: { 9998: false },
    bag: { items: [], pokeBalls: [] },
    party: [{ slot: 0, species: 22, level: 34, hp: 100, maxHp: 100 }],
  });
  observed.playerMemory.position = { x: 1, y: 1 };
  observed.playerMemory.trainer.money = 7_000;

  const objective = createCampaignPlanner(plannerOptions).select(observed);
  assert.deepEqual(objective?.target?.items, [
    { itemId: 22, stockIndex: 1, quantity: 4, unitPrice: 700 },
    { itemId: 24, stockIndex: 5, quantity: 2, unitPrice: 1500 },
    { itemId: 23, stockIndex: 6, quantity: 2, unitPrice: 600 },
  ]);

  observed.playerMemory.trainer.money = 6_999;
  assert.equal(createCampaignPlanner(plannerOptions).select(observed)?.id, "badge-value");
});

test("an eligible Oak aide reward becomes a campaign goal", () => {
  const { world, story, mechanics } = postThunderMasteryFixture({ aideMap: true });
  world.data.maps[0].connections = [{
    direction: "right",
    map: "MAP_ROUTE11_EAST_ENTRANCE_2F",
    offset: 0,
  }];
  world.data.maps[1].connections = [{
    direction: "left",
    map: "MAP_ROUTE11",
    offset: 0,
  }];
  const planner = createCampaignPlanner({
    campaign: { objectives: [{
      id: "continue-story",
      target: { kind: "map-arrival", map: "MAP_ROUTE11", x: 4, y: 4 },
      completion: { kind: "flag-set", id: 9999 },
    }] },
    world,
    story,
    mechanics,
  });
  const observation = postThunderObservation({
    trainerDefeated: true,
    ownedSpecies: [
      ...Array.from({ length: 27 }, (_, index) => index + 1),
      28,
      29,
      96,
    ],
  });
  observation.playerMemory.trainer.pokedex.seenSpecies =
    observation.playerMemory.trainer.pokedex.ownedSpecies;
  observation.playerMemory.trainer.pokedex.seenCount = 30;
  observation.playerMemory.storyState.flagIds[594] = false;
  observation.playerMemory.map.id = "MAP_ROUTE11_EAST_ENTRANCE_2F";
  observation.playerMemory.position = { x: 2, y: 1 };

  const objective = planner.select(observation);

  assert.equal(objective?.id, "oak-aide-itemfinder");
  assert.deepEqual(objective?.target, {
    kind: "object",
    map: "MAP_ROUTE11_EAST_ENTRANCE_2F",
    index: 1,
  });
  assert.deepEqual(objective?.completion, { kind: "flag-set", id: 594 });
  assert.equal(objective?.choice, "yes");
  assert.ok(planner.storyWatch().flags.includes(594));
});

test("an Oak aide below its Pokedex threshold never blocks progression", () => {
  const { world, story, mechanics } = postThunderMasteryFixture({ aideMap: true });
  const campaign = { objectives: [{
    id: "continue-story",
    target: { kind: "map-arrival", map: "MAP_ROUTE11", x: 4, y: 4 },
    completion: { kind: "flag-set", id: 9999 },
  }] };
  const planner = createCampaignPlanner({ campaign, world, story, mechanics });
  const observation = postThunderObservation({
    trainerDefeated: true,
    ownedSpecies: [21, 23, 96],
  });
  observation.playerMemory.storyState.flagIds[594] = false;

  assert.equal(planner.select(observation)?.id, "continue-story");
});

test("postgame regional coverage adds water species only when Surf is currently usable", () => {
  const route = openMap("MAP_ROUTE19", {
    width: 4,
    height: 3,
    behaviors: {
      "1,0": "MB_OCEAN_WATER",
      "1,1": "MB_OCEAN_WATER",
      "1,2": "MB_OCEAN_WATER",
      "2,0": "MB_OCEAN_WATER",
      "2,1": "MB_OCEAN_WATER",
      "2,2": "MB_OCEAN_WATER",
    },
  });
  const world = { data: {
    maps: [route],
    wildEncounters: [{
      map: route.id,
      water_mons: {
        encounter_rate: 2,
        mons: [{ min_level: 5, max_level: 40, species: "SPECIES_TENTACOOL" }],
      },
    }],
  } };
  const mechanics = { data: {
    species: [{ id: 72, name: "SPECIES_TENTACOOL" }],
    trainers: [],
  } };
  const campaign = { objectives: [{
    id: "continue-story",
    target: { kind: "map-arrival", map: route.id, x: 3, y: 2 },
    completion: { kind: "flag-set", id: 9999 },
  }] };
  const observation = campaignObservation({
    map: route.id,
    flags: { 2084: true, 2092: true },
    party: [{ slot: 0, species: 9, level: 40, hp: 100, maxHp: 100, moves: [57] }],
  });
  observation.playerMemory.position = { x: 0, y: 1 };
  observation.playerMemory.trainer.pokedex = {
    ownedSpecies: [],
    seenSpecies: [],
    ownedCount: 0,
    seenCount: 0,
  };
  observation.playerMemory.trainer.bag = {
    pokeBalls: [{ itemId: 4, quantity: 20 }],
  };
  const planner = createCampaignPlanner({ campaign, world, mechanics });

  const surfObjective = planner.select(observation);

  assert.equal(surfObjective?.id, "mastery-capture:MAP_ROUTE19:72");
  assert.deepEqual(surfObjective?.target, {
    kind: "surf-encounter-zone",
    map: route.id,
  });
  assert.equal(surfObjective?.encounterMethod, "surf");
  assert.equal(
    campaignNavigationRecommendation({
      world,
      observation,
      objective: surfObjective,
    })?.kind,
    "use-field-move",
  );

  observation.playerMemory.trainer.party[0].moves = [];
  assert.equal(planner.select(observation)?.id, "continue-story");
});

test("postgame regional coverage uses only encounter slots supported by the owned rod", () => {
  const route = openMap("MAP_ROUTE11", {
    width: 4,
    height: 3,
    behaviors: {
      "1,0": "MB_OCEAN_WATER",
      "1,1": "MB_OCEAN_WATER",
      "1,2": "MB_OCEAN_WATER",
    },
  });
  const fishingMons = [
    "SPECIES_MAGIKARP",
    "SPECIES_MAGIKARP",
    "SPECIES_HORSEA",
    "SPECIES_MAGIKARP",
    "SPECIES_KRABBY",
    "SPECIES_HORSEA",
    "SPECIES_HORSEA",
    "SPECIES_GYARADOS",
    "SPECIES_HORSEA",
    "SPECIES_PSYDUCK",
  ].map((species, index) => ({
    min_level: index < 5 ? 5 : 15,
    max_level: index < 5 ? 15 : 35,
    species,
  }));
  const world = { data: {
    maps: [route],
    wildEncounters: [{
      map: route.id,
      fishing_mons: { encounter_rate: 20, mons: fishingMons },
    }],
  } };
  const mechanics = { data: {
    species: [
      { id: 54, name: "SPECIES_PSYDUCK" },
      { id: 98, name: "SPECIES_KRABBY" },
      { id: 116, name: "SPECIES_HORSEA" },
      { id: 129, name: "SPECIES_MAGIKARP" },
      { id: 130, name: "SPECIES_GYARADOS" },
    ],
    trainers: [],
  } };
  const campaign = { objectives: [{
    id: "continue-story",
    target: { kind: "map-arrival", map: route.id, x: 3, y: 2 },
    completion: { kind: "flag-set", id: 9999 },
  }] };
  const observation = campaignObservation({
    map: route.id,
    flags: { 2082: true, 2092: true },
  });
  observation.playerMemory.position = { x: 0, y: 1 };
  observation.playerMemory.trainer.pokedex = {
    ownedSpecies: [98, 129],
    seenSpecies: [98, 129],
    ownedCount: 2,
    seenCount: 2,
  };
  observation.playerMemory.trainer.bag = {
    keyItems: [{ itemId: 263, quantity: 1 }],
    pokeBalls: [{ itemId: 4, quantity: 20 }],
  };
  const planner = createCampaignPlanner({ campaign, world, mechanics });

  const fishingObjective = planner.select(observation);

  assert.equal(fishingObjective?.id, "mastery-capture:MAP_ROUTE11:116");
  assert.deepEqual(fishingObjective?.target, {
    kind: "fishing-zone",
    map: route.id,
    rodItemId: 263,
  });
  assert.equal(fishingObjective?.encounterMethod, "fishing");
  assert.equal(fishingObjective?.rodItemId, 263);

  observation.playerMemory.trainer.bag.keyItems = [];
  assert.equal(planner.select(observation)?.id, "continue-story");
});

function fishingHabitatFixture({ accessibleOriginal = false, alternateSpecies = "SPECIES_HORSEA", alternateRod = 264 } = {}) {
  // Route 4's source geometry has water behind a blocked bank: arrival on
  // the route does not prove a shore can be reached without Surf.
  const isolated = openMap("MAP_ROUTE4", { width: 5, height: 5,
    connections: [{ direction: "right", map: "MAP_ROUTE11", offset: 0 }],
    behaviors: Object.fromEntries(Array.from({ length: 10 }, (_, i) => [`${i % 5},${Math.floor(i / 5)}`, "MB_OCEAN_WATER"])),
    collisions: accessibleOriginal ? {} : Object.fromEntries(Array.from({ length: 5 }, (_, x) => [`${x},2`, 1])),
  });
  const shore = openMap("MAP_ROUTE11", { width: 5, height: 5,
    connections: [{ direction: "left", map: isolated.id, offset: 0 }],
    behaviors: Object.fromEntries(Array.from({ length: 5 }, (_, y) => [`4,${y}`, "MB_OCEAN_WATER"])),
  });
  const fishing = (map, species, rod = 264) => ({ map, fishing_mons: { encounter_rate: 20,
    mons: Array.from({ length: 10 }, (_, i) => ({ min_level: 15, max_level: 25,
      species: (rod === 264 ? i >= 5 : i >= 2 && i < 5) ? species : "SPECIES_MAGIKARP" })),
  } });
  const world = { data: { maps: [isolated, shore], wildEncounters: [
    fishing(isolated.id, "SPECIES_HORSEA"), fishing(shore.id, alternateSpecies, alternateRod),
  ] } };
  const mechanics = { data: { species: [{ id: 116, name: "SPECIES_HORSEA" },
    { id: 129, name: "SPECIES_MAGIKARP" }], trainers: [] } };
  const objective = { id: "capture-required-horsea", target: { kind: "fishing-zone", map: isolated.id, rodItemId: 264 },
    completion: { kind: "owned-species", species: [116, 117] }, captureSpecies: [116], captureFamily: [116, 117],
    acquisitionId: "native-117", permanentRoster: true };
  const campaign = { objectives: [objective] };
  const observation = campaignObservation({ map: isolated.id,
    bag: { keyItems: [{ itemId: 264, quantity: 1 }], pokeBalls: [{ itemId: 4, quantity: 20 }] } });
  observation.playerMemory.position = { x: 4, y: 3 };
  return { world, mechanics, campaign, objective, observation };
}

test("an inaccessible mandatory fishing habitat reroutes the same acquisition to a reachable source-backed shore", () => {
  const fixture = fishingHabitatFixture();
  const { observation, world, objective } = fixture;
  const planner = createCampaignPlanner(fixture);
  const selected = planner.select(observation);
  assert.equal(selected.id, objective.id);
  assert.deepEqual(selected.completion, objective.completion);
  assert.deepEqual(selected.captureSpecies, [116]);
  assert.deepEqual(selected.target, { kind: "fishing-zone", map: "MAP_ROUTE11", rodItemId: 264 });
  assert.equal(planner.campaignStatus().activeObjective.target.map, "MAP_ROUTE11");
  assert.equal(campaignNavigationRecommendation({ world, observation, objective: selected })?.direction, "east");

  observation.playerMemory.map.id = "MAP_ROUTE11";
  observation.playerMemory.position = { x: 3, y: 3 };
  const resumed = createCampaignPlanner({ ...fixture, initialState: planner.state() });
  const onShore = resumed.select(observation);
  assert.equal(onShore.id, objective.id);
  assert.equal(onShore.target.map, "MAP_ROUTE11");
  assert.equal(campaignNavigationRecommendation({ world, observation, objective: onShore })?.kind, "use-fishing-rod");
});

for (const [name, options] of [
  ["a reachable original shore", { accessibleOriginal: true }],
  ["an alternative with another species", { alternateSpecies: "SPECIES_MAGIKARP" }],
  ["an alternative requiring another rod", { alternateRod: 263 }],
]) {
  test(`mandatory fishing preserves its original target with ${name}`, () => {
    const fixture = fishingHabitatFixture(options);
    assert.equal(createCampaignPlanner(fixture).select(fixture.observation).target.map, "MAP_ROUTE4");
  });
}

test("repeated planning reuses immutable encounter geometry but never a replaced live grid", () => {
  const route = openMap("MAP_ROUTE19", { width: 4, height: 3,
    behaviors: { "1,0": "MB_OCEAN_WATER", "1,1": "MB_OCEAN_WATER", "1,2": "MB_OCEAN_WATER" } });
  let tileReads = 0;
  for (const cell of route.layout.cells) {
    const behavior = cell.behaviorName;
    Object.defineProperty(cell, "behaviorName", { enumerable: true, get() { tileReads++; return behavior; } });
  }
  const world = { data: { maps: [route], wildEncounters: [{ map: route.id,
    water_mons: { encounter_rate: 2, mons: [{ min_level: 5, max_level: 40, species: "SPECIES_TENTACOOL" }] } }] } };
  const mechanics = { data: { species: [{ id: 72, name: "SPECIES_TENTACOOL" }], trainers: [] } };
  const campaign = { objectives: [{ id: "continue-story", target: { kind: "map-arrival", map: route.id, x: 3, y: 2 }, completion: { kind: "flag-set", id: 9999 } }] };
  createCampaignPlanner({ world, mechanics, campaign });
  assert.ok(tileReads > 0);
  tileReads = 0;
  createCampaignPlanner({ world, mechanics, campaign });
  assert.equal(tileReads, 0, "reusing a knowledge grid must not rescan its encounter geometry");
  const observation = campaignObservation({ map: route.id, flags: { 2084: true, 2092: true },
    party: [{ slot: 0, species: 9, level: 40, hp: 100, maxHp: 100, moves: [57] }],
    bag: { pokeBalls: [{ itemId: 4, quantity: 20 }] } });
  observation.playerMemory.position = { x: 0, y: 1 };
  observation.playerMemory.trainer.pokedex = { ownedSpecies: [], seenSpecies: [] };
  route.layout.cells = route.layout.cells.map(cell => ({ ...cell, behaviorName: "MB_NORMAL" }));
  const replacedWorld = { data: { ...world.data, maps: [route] } };
  const fresh = createCampaignPlanner({ world: replacedWorld, mechanics, campaign });
  assert.equal(fresh.select(observation).id, "continue-story", "a changed grid cannot inherit old water encounters");
});

test("one training comparison shares its current-map routing work across remote trainers", () => {
  const here = openMap("MAP_START", { width: 8, height: 8,
    connections: [{ direction: "right", map: "MAP_TRAIN", offset: 0 }], objectEvents: [{ x: 3, y: 3 }] });
  const there = openMap("MAP_TRAIN", { width: 8, height: 8,
    connections: [{ direction: "left", map: here.id, offset: 0 }], objectEvents: [{ x: 3, y: 3 }] });
  const world = { maps: [here, there] };
  let remoteScans = 0;
  there.layout.cells.map = function (...args) { remoteScans++; return Array.prototype.map.apply(this, args); };
  const observation = campaignObservation({ map: here.id,
    party: [{ slot: 0, species: 6, level: 30, hp: 90, maxHp: 90, moves: [52] }] });
  observation.playerMemory.position = { x: 2, y: 2 };
  let gridReads = 0;
  const grid = { width: 8, height: 8, cells: here.layout.cells };
  Object.defineProperty(observation.playerMemory, "mapGrid", { get() { gridReads++; return grid; } });
  const catalog = Array.from({ length: 20 }, (_, i) => ({ id: 100 + i, name: `TRAINER_${i}`, flagId: 1380 + i,
    minimumLevel: 28, maximumLevel: 28, partySize: 2, target: { kind: "object", map: there.id, index: 0 } }));
  observation.playerMemory.storyState.flagIds = Object.fromEntries(catalog.map(t => [t.flagId, false]));
  const objective = { id: "prepare", importantBattle: true, battleTeamTargetLevel: 40,
    target: { kind: "object", map: here.id, index: 0 } };
  const selected = selectTrainingObjective({ world, observation, objective, trainerCatalog: catalog });
  assert.equal(selected?.trainer?.id, 100, JSON.stringify({ selected, gridReads }));
  assert.ok(gridReads <= 3, `one decision read the same live map ${gridReads} times`);
  observation.playerMemory.storyState.flagIds[1380] = true;
  remoteScans = 0;
  const next = selectTrainingObjective({ world, observation, objective, trainerCatalog: catalog });
  assert.equal(next?.trainer?.id, 101, "a later comparison must honor new cartridge state");
  assert.ok(remoteScans <= 3, `remote geometry was reindexed ${remoteScans} times`);
});

test("regional mastery cannot route past the mandatory Mt. Moon fossil", () => {
  const cave = openMap("MAP_MT_MOON_B2F", {
    connections: [{ direction: "right", map: "MAP_ROUTE4", offset: 0 }],
    objectEvents: [
      { x: 1, y: 1, script: "MtMoonB2F_EventScript_Grunt" },
      { x: 3, y: 1, script: "MtMoonB2F_EventScript_Fossil" },
    ],
  });
  const route = openMap("MAP_ROUTE4", {
    connections: [{ direction: "left", map: cave.id, offset: 0 }],
    encounters: { "1,1": 1, "2,1": 1 },
    behaviors: { "1,1": "MB_TALL_GRASS", "2,1": "MB_TALL_GRASS" },
  });
  const world = { data: {
    maps: [cave, route],
    wildEncounters: [{
      map: route.id,
      land_mons: {
        encounter_rate: 21,
        mons: [{ min_level: 6, max_level: 12, species: "SPECIES_EKANS" }],
      },
    }],
  } };
  const campaign = { objectives: [{
    id: "mt-moon-fossil",
    target: { kind: "object", map: cave.id, index: 1 },
    completion: { kind: "flag-set", id: 562 },
    choice: "yes",
  }] };
  const planner = createCampaignPlanner({
    campaign,
    world,
    mechanics: { data: {
      species: [{ id: 23, name: "SPECIES_EKANS" }],
      trainers: [],
    } },
  });
  const observation = campaignObservation({
    map: cave.id,
    flags: { 562: false, 2080: true, 2092: true },
  });
  observation.playerMemory.position = { x: 2, y: 1 };
  observation.playerMemory.trainer.pokedex = {
    ownedSpecies: [], seenSpecies: [], ownedCount: 0, seenCount: 0,
  };
  observation.playerMemory.trainer.bag = {
    pokeBalls: [{ itemId: 4, quantity: 20 }],
  };

  assert.equal(planner.select(observation)?.id, "mt-moon-fossil");

  observation.playerMemory.storyState.flagIds[562] = true;
  campaign.objectives.push({
    id: "continue-story",
    target: { kind: "map-arrival", map: route.id, x: 4, y: 4 },
    completion: { kind: "flag-set", id: 9999 },
  });
  assert.equal(planner.select(observation)?.id, "mastery-capture:MAP_ROUTE4:23");
});

test("regional mastery waits for the Cerulean Rocket passage before Routes 5 and 6", () => {
  const route = openMap("MAP_ROUTE5", {
    encounters: { "1,1": 1, "2,1": 1 },
    behaviors: { "1,1": "MB_TALL_GRASS", "2,1": "MB_TALL_GRASS" },
  });
  const world = { data: {
    maps: [route],
    wildEncounters: [{
      map: route.id,
      land_mons: {
        encounter_rate: 21,
        mons: [{ min_level: 10, max_level: 16, species: "SPECIES_MEOWTH" }],
      },
    }],
  } };
  const campaign = { objectives: [{
    id: "cerulean-rocket",
    target: { kind: "map-arrival", map: route.id, x: 4, y: 4 },
    completion: { kind: "variable-at-least", id: 0x407d, value: 1 },
  }] };
  const planner = createCampaignPlanner({
    campaign,
    world,
    mechanics: { data: {
      species: [{ id: 52, name: "SPECIES_MEOWTH" }],
      trainers: [],
    } },
  });
  const observation = campaignObservation({
    map: route.id,
    variables: { [0x407d]: 0 },
    flags: { 2081: true, 2092: true },
  });
  observation.playerMemory.position = { x: 1, y: 1 };
  observation.playerMemory.trainer.pokedex = {
    ownedSpecies: [], seenSpecies: [], ownedCount: 0, seenCount: 0,
  };
  observation.playerMemory.trainer.bag = {
    pokeBalls: [{ itemId: 4, quantity: 20 }],
  };

  assert.equal(planner.select(observation)?.id, "cerulean-rocket");

  observation.playerMemory.storyState.variableIds[0x407d] = 1;
  campaign.objectives.push({
    id: "continue-story",
    target: { kind: "map-arrival", map: route.id, x: 3, y: 3 },
    completion: { kind: "flag-set", id: 9999 },
  });
  assert.equal(planner.select(observation)?.id, "mastery-capture:MAP_ROUTE5:52");
});

test("campaign training spends safe undefeated trainers before wild encounters", () => {
  const map = openMap("MAP_TRAINER_ROUTE", {
    objectEvents: [{
      x: 3,
      y: 1,
      script: "TrainerRoute_EventScript_Ada",
      trainer_type: "TRAINER_TYPE_NORMAL",
    }],
    coordEvents: [{ x: 4, y: 4, type: "trigger" }],
    encounters: { "1,1": 1, "2,1": 1 },
    behaviors: { "1,1": "MB_TALL_GRASS", "2,1": "MB_TALL_GRASS" },
  });
  const world = {
    data: {
      maps: [map],
      wildEncounters: [{
        map: map.id,
        land_mons: {
          encounter_rate: 21,
          mons: [{
            min_level: 4,
            max_level: 5,
            species: "SPECIES_PIDGEY",
          }],
        },
      }],
    },
  };
  const story = {
    data: {
      symbols: {
        trainers: { TRAINER_LASS_ADA: { value: 11 } },
        flags: {},
        items: {},
      },
      scripts: [{
        label: "TrainerRoute_EventScript_Ada",
        instructions: [{
          op: "trainerbattle_single",
          args: ["TRAINER_LASS_ADA", "intro", "defeat"],
        }],
      }],
    },
  };
  const mechanics = {
    data: {
      trainers: [{
        id: 11,
        name: "TRAINER_LASS_ADA",
        trainerName: "ADA",
        party: [{ lvl: 10, species: "SPECIES_PIDGEY" }],
      }],
    },
  };
  const campaign = { objectives: [{
    id: "next-rival",
    target: { kind: "trigger", map: map.id, index: 0 },
    completion: { kind: "flag-set", id: 9999 },
    minimumTeamAnchorLevel: 18,
  }] };
  const planner = createCampaignPlanner({ campaign, world, story, mechanics });
  const observed = campaignObservation({
    map: map.id,
    flags: { [0x500 + 11]: false },
    party: [{
      slot: 0,
      species: 1,
      level: 12,
      hp: 35,
      maxHp: 35,
      moves: [],
    }],
  });
  observed.playerMemory.position = { x: 1, y: 1 };

  const trainerTraining = planner.selectTraining(observed, planner.select(observed));
  assert.equal(trainerTraining?.id, "train-team-anchor-with-trainer");
  assert.equal(trainerTraining?.trainingSource, "trainer");
  assert.deepEqual(trainerTraining?.target, {
    kind: "object",
    map: map.id,
    index: 0,
  });
  assert.deepEqual(trainerTraining?.trainer, {
    id: 11,
    name: "TRAINER_LASS_ADA",
    displayName: "ADA",
    flagId: 0x500 + 11,
    minimumLevel: 10,
    maximumLevel: 10,
    partySize: 1,
  });
  assert.ok(planner.storyWatch().flags.includes(0x500 + 11));

  const defeatedObservation = campaignObservation({
    map: map.id,
    flags: { [0x500 + 11]: true },
    party: observed.playerMemory.trainer.party,
  });
  defeatedObservation.playerMemory.position = { x: 1, y: 1 };
  const wildTraining = planner.selectTraining(
    defeatedObservation,
    planner.select(defeatedObservation),
  );
  assert.equal(wildTraining?.id, "train-team-anchor");
  assert.equal(wildTraining?.target.kind, "encounter-zone");
});

test("training fallback can exclude an unsupported committed trainer", () => {
  const route = openMap("MAP_REACHABLE_TRAINING_ROUTE", {
    objectEvents: [{
      x: 4,
      y: 4,
      script: "ReachableTrainingRoute_EventScript_Goal",
    }],
    encounters: { "1,1": 1, "2,1": 1 },
    behaviors: { "1,1": "MB_TALL_GRASS", "2,1": "MB_TALL_GRASS" },
  });
  const isolatedRoom = openMap("MAP_ISOLATED_TRAINER_ROOM", {
    objectEvents: [{
      x: 3,
      y: 1,
      script: "IsolatedTrainerRoom_EventScript_Ada",
      trainer_type: "TRAINER_TYPE_NORMAL",
    }],
  });
  const observation = campaignObservation({
    map: route.id,
    flags: { 1801: false },
    party: [{
      slot: 0,
      species: 1,
      level: 12,
      hp: 35,
      maxHp: 35,
      moves: [],
    }],
  });
  observation.playerMemory.position = { x: 1, y: 1 };

  const training = selectTrainingObjective({
    world: {
      maps: [route, isolatedRoom],
      wildEncounters: [{
        map: route.id,
        land_mons: {
          encounter_rate: 21,
          mons: [{
            min_level: 4,
            max_level: 5,
            species: "SPECIES_PIDGEY",
          }],
        },
      }],
    },
    observation,
    objective: {
      id: "next-rival",
      target: { kind: "object", map: route.id, index: 0 },
      minimumTeamAnchorLevel: 18,
    },
    trainerCatalog: [{
      id: 301,
      name: "TRAINER_LASS_ADA",
      displayName: "ADA",
      flagId: 1801,
      minimumLevel: 10,
      maximumLevel: 10,
      partySize: 1,
      target: { kind: "object", map: isolatedRoom.id, index: 0 },
    }],
    preferredTrainerId: 301,
    excludedTrainerIds: [301],
  });

  assert.equal(training?.id, "train-team-anchor");
  assert.deepEqual(training?.target, {
    kind: "encounter-zone",
    map: route.id,
  });
});

for (const travel of ["walking", "flying"]) test(`Silph trainer training keeps its ${travel} target across floor-boundary resampling`, () => {
  const maps = Array.from({ length: 7 }, (_, offset) => {
    const floor = offset + 2;
    const previousFloor = floor - 1;
    const nextFloor = floor + 1;
    const warpEvents = [];
    const behaviors = {};
    if (floor > 2) {
      warpEvents.push({
        x: 1,
        y: 1,
        dest_map: `MAP_SILPH_CO_${previousFloor}F`,
        dest_warp_id: floor === 3 ? "0" : "1",
      });
      behaviors["1,1"] = "MB_DOWN_LEFT_STAIR_WARP";
    }
    if (floor < 8) {
      const upwardX = floor === 2 ? 1 : 5;
      warpEvents.push({
        x: upwardX,
        y: 1,
        dest_map: `MAP_SILPH_CO_${nextFloor}F`,
        dest_warp_id: "0",
      });
      behaviors[`${upwardX},1`] = "MB_UP_RIGHT_STAIR_WARP";
    }
    const objectEvents = floor === 2
      ? [{
          x: 5,
          y: 3,
          script: "SilphCo_2F_EventScript_NearTrainer",
          trainer_type: "TRAINER_TYPE_NORMAL",
        }]
      : floor === 8
        ? [{
            x: 5,
            y: 3,
            script: "SilphCo_8F_EventScript_CommittedTrainer",
            trainer_type: "TRAINER_TYPE_NORMAL",
          }]
        : [];
    return openMap(`MAP_SILPH_CO_${floor}F`, {
      width: 7,
      height: 5,
      warpEvents,
      behaviors,
      objectEvents,
    });
  });
  const secondFloor = maps[0];
  const objective = {
    id: "rival-silph",
    importantBattle: true,
    minimumBattleMemberLevel: 30,
    target: { kind: "object", map: "MAP_SILPH_CO_8F", index: 0 },
  };
  const planner = createCampaignPlanner({
    campaign: { objectives: [objective] },
    world: { data: { maps } },
    story: { data: {
      symbols: { trainers: {
        TRAINER_NEAR: { value: 11 },
        TRAINER_COMMITTED: { value: 12 },
      } },
      scripts: [
        {
          label: "SilphCo_2F_EventScript_NearTrainer",
          instructions: [{
            op: "trainerbattle_single",
            args: ["TRAINER_NEAR", "intro", "defeat"],
          }],
        },
        {
          label: "SilphCo_8F_EventScript_CommittedTrainer",
          instructions: [{
            op: "trainerbattle_single",
            args: ["TRAINER_COMMITTED", "intro", "defeat"],
          }],
        },
      ],
    } },
    mechanics: { data: { trainers: [
      {
        id: 11,
        name: "TRAINER_NEAR",
        trainerName: "NEAR",
        party: [{ lvl: 21, species: "SPECIES_MAGNEMITE" }],
      },
      {
        id: 12,
        name: "TRAINER_COMMITTED",
        trainerName: "COMMITTED",
        party: [{ lvl: 21, species: "SPECIES_MAGNEMITE" }],
      },
    ] } },
  });
  const party = [{
    slot: 0,
    species: 84,
    level: 20,
    hp: 50,
    maxHp: 50,
    moves: [],
  }];
  const secondFloorObservation = campaignObservation({
    map: secondFloor.id,
    flags: { [0x500 + 11]: false, [0x500 + 12]: false },
    party,
  });
  secondFloorObservation.playerMemory.position = { x: 1, y: 3 };
  secondFloorObservation.playerMemory.mapGrid = {
    width: secondFloor.layout.width,
    height: secondFloor.layout.height,
    cells: secondFloor.layout.cells.map((cell) => ({
      ...cell,
      collision: cell.x === 3 ? 1 : cell.collision,
    })),
  };
  const context = createObservationPlanner(planner);
  const preview = context.selectTraining(secondFloorObservation, objective);
  assert.equal(preview?.trainer?.id, 12);
  assert.equal(planner.state().commitments?.training, undefined,
    "an advisor preview must not establish a training commitment");
  context.observeDecision(secondFloorObservation, { kind: "resample", winner: null });
  assert.equal(planner.state().commitments?.training, undefined);
  context.observeDecision(secondFloorObservation, {
    kind: "act", winner: {
      recommendation: { objective: travel === "flying" ? "fly-to-MAPSEC_SAFFRON_CITY" : preview.id },
      evidenceRefs: [`campaign:objective:${preview.id}`, "cartridge:trainer:12"],
    },
  });
  assert.equal(planner.state().commitments?.training?.trainer?.id, 12);
  const committed = planner.selectTraining(secondFloorObservation, objective);
  assert.equal(committed?.trainer?.id, 12);
  assert.equal(committed?.target.map, "MAP_SILPH_CO_8F");

  const thirdFloorObservation = campaignObservation({
    map: "MAP_SILPH_CO_3F",
    flags: { [0x500 + 11]: false, [0x500 + 12]: false },
    party,
  });
  thirdFloorObservation.playerMemory.position = { x: 1, y: 1 };
  const continued = planner.selectTraining(thirdFloorObservation, objective);

  assert.equal(continued?.trainer?.id, 12);
  assert.equal(continued?.target.map, "MAP_SILPH_CO_8F");

  const targetFloorObservation = campaignObservation({
    map: "MAP_SILPH_CO_8F",
    flags: { [0x500 + 11]: false, [0x500 + 12]: false },
    party,
  });
  targetFloorObservation.playerMemory.position = { x: 1, y: 3 };
  targetFloorObservation.playerMemory.mapGrid = {
    width: maps[6].layout.width,
    height: maps[6].layout.height,
    cells: maps[6].layout.cells.map((cell) => ({
      ...cell,
      collision: cell.x === 3 ? 3 : cell.collision,
    })),
  };
  const behindClosedDoor = planner.selectTraining(
    targetFloorObservation,
    objective,
  );
  assert.equal(behindClosedDoor?.trainer?.id, 12);
  assert.equal(behindClosedDoor?.target.map, "MAP_SILPH_CO_8F");

  targetFloorObservation.playerMemory.storyState.flagIds[0x500 + 12] = true;
  const afterDefeat = planner.selectTraining(targetFloorObservation, objective);
  assert.equal(afterDefeat?.trainer?.id, 11);
  assert.equal(afterDefeat?.target.map, "MAP_SILPH_CO_2F");
});

test("Saffron Gym trainer commitments release until Silph is liberated", () => {
  const city = openMap("MAP_SAFFRON_CITY", {
    connections: [
      { direction: "up", map: "MAP_SAFFRON_CITY_GYM", offset: 0 },
      { direction: "down", map: "MAP_SAFFRON_CITY_DOJO", offset: 0 },
    ],
    objectEvents: [{ x: 3, y: 3, script: "SaffronCity_EventScript_Goal" }],
  });
  const gym = openMap("MAP_SAFFRON_CITY_GYM", {
    connections: [{ direction: "down", map: city.id, offset: 0 }],
    objectEvents: [{
      x: 3,
      y: 3,
      script: "SaffronCity_Gym_EventScript_Trainer",
      trainer_type: "TRAINER_TYPE_NORMAL",
    }],
  });
  const dojo = openMap("MAP_SAFFRON_CITY_DOJO", {
    connections: [{ direction: "up", map: city.id, offset: 0 }],
    objectEvents: [{
      x: 3,
      y: 3,
      script: "SaffronCity_Dojo_EventScript_Trainer",
      trainer_type: "TRAINER_TYPE_NORMAL",
    }],
  });
  const observation = campaignObservation({
    map: city.id,
    flags: { 83: false, 1561: false, 1562: false },
    party: [
      { slot: 0, species: 84, level: 26, hp: 60, maxHp: 60, moves: [] },
      { slot: 1, species: 6, level: 55, hp: 169, maxHp: 169, moves: [] },
    ],
  });
  observation.playerMemory.position = { x: 2, y: 2 };
  const objective = {
    id: "rival-silph",
    importantBattle: true,
    enemyAceLevel: 40,
    battleTeamTargetLevel: 45,
    minimumBattleMemberLevel: 45,
    target: { kind: "object", map: city.id, index: 0 },
  };
  const trainerCatalog = [
    {
      id: 281,
      name: "TRAINER_CRUSH_KIN_RON_MYA",
      displayName: "RON & MYA",
      flagId: 1561,
      minimumLevel: 32,
      maximumLevel: 32,
      partySize: 2,
      target: { kind: "object", map: dojo.id, index: 0 },
    },
    {
      id: 282,
      name: "TRAINER_PSYCHIC_JOHAN",
      displayName: "JOHAN",
      flagId: 1562,
      minimumLevel: 33,
      maximumLevel: 33,
      partySize: 1,
      target: { kind: "object", map: gym.id, index: 0 },
    },
  ];

  const beforeLiberation = selectTrainingObjective({
    world: { maps: [city, gym, dojo] },
    observation,
    objective,
    trainerCatalog,
    preferredTrainerId: 282,
  });
  assert.equal(beforeLiberation?.trainer?.id, 281);
  assert.equal(beforeLiberation?.target.map, dojo.id);

  observation.playerMemory.storyState.flagIds[83] = true;
  const afterLiberation = selectTrainingObjective({
    world: { maps: [city, gym, dojo] },
    observation,
    objective,
    trainerCatalog,
    preferredTrainerId: 282,
  });
  assert.equal(afterLiberation?.trainer?.id, 282);
  assert.equal(afterLiberation?.target.map, gym.id);
});

test("Route 3 training remains blocked until Pewter's Brock gate opens", () => {
  const city = openMap("MAP_PEWTER_CITY", {
    connections: [{ direction: "right", map: "MAP_ROUTE3", offset: 0 }],
    objectEvents: [{ x: 3, y: 3, script: "PewterCity_EventScript_LocalTrainer" }],
  });
  const route = openMap("MAP_ROUTE3", {
    connections: [{ direction: "left", map: city.id, offset: 0 }],
    objectEvents: [{ x: 3, y: 3, script: "Route3_EventScript_Trainer" }],
  });
  const observation = campaignObservation({
    map: city.id,
    variables: { 0x406c: 0 },
    flags: { 1106: false, 1107: false },
    party: [
      { slot: 0, species: 56, level: 9, hp: 21, maxHp: 26, moves: [] },
      { slot: 1, species: 4, level: 10, hp: 29, maxHp: 29, moves: [] },
    ],
  });
  observation.playerMemory.position = { x: 2, y: 2 };
  const objective = {
    id: "rival-route22-early",
    importantBattle: true,
    enemyAceLevel: 9,
    battleTeamTargetLevel: 14,
    minimumBattleMemberLevel: 14,
    target: { kind: "object", map: city.id, index: 0 },
  };
  const trainerCatalog = [
    {
      id: 106,
      name: "TRAINER_PEWTER_LOCAL",
      displayName: "Local Trainer",
      flagId: 1106,
      minimumLevel: 8,
      maximumLevel: 8,
      partySize: 1,
      target: { kind: "object", map: city.id, index: 0 },
    },
    {
      id: 107,
      name: "TRAINER_ROUTE3",
      displayName: "Route 3 Trainer",
      flagId: 1107,
      minimumLevel: 11,
      maximumLevel: 11,
      partySize: 1,
      target: { kind: "object", map: route.id, index: 0 },
    },
  ];

  const beforeBrock = selectTrainingObjective({
    world: { maps: [city, route] },
    observation,
    objective,
    trainerCatalog,
    preferredTrainerId: 107,
  });
  assert.equal(beforeBrock?.trainer?.id, 106);
  assert.equal(beforeBrock?.target.map, city.id);

  observation.playerMemory.storyState.variableIds[0x406c] = 1;
  const afterBrock = selectTrainingObjective({
    world: { maps: [city, route] },
    observation,
    objective,
    trainerCatalog,
    preferredTrainerId: 107,
  });
  assert.equal(afterBrock?.trainer?.id, 107);
  assert.equal(afterBrock?.target.map, route.id);
});

test("exhausted trainers fall back to reachable wild encounters without crossing locked Route 3", () => {
  const city = openMap("MAP_PEWTER_CITY", {
    connections: [
      { direction: "right", map: "MAP_ROUTE3", offset: 0 },
      { direction: "down", map: "MAP_ROUTE22", offset: 0 },
    ],
    objectEvents: [{ x: 3, y: 3, script: "PewterCity_EventScript_DefeatedTrainer" }],
  });
  const lockedRoute = openMap("MAP_ROUTE3", {
    connections: [
      { direction: "left", map: city.id, offset: 0 },
      { direction: "right", map: "MAP_ROUTE25", offset: 0 },
    ],
  });
  const reachableGrass = openMap("MAP_ROUTE22", {
    connections: [{ direction: "up", map: city.id, offset: 0 }],
    coordEvents: [{ x: 3, y: 3, script: "Route22_EventScript_Rival" }],
    encounters: { "1,1": 1, "2,1": 1 },
    behaviors: { "1,1": "MB_TALL_GRASS", "2,1": "MB_TALL_GRASS" },
  });
  const lockedGrass = openMap("MAP_ROUTE25", {
    connections: [{ direction: "left", map: lockedRoute.id, offset: 0 }],
    encounters: { "1,1": 1, "2,1": 1 },
    behaviors: { "1,1": "MB_TALL_GRASS", "2,1": "MB_TALL_GRASS" },
  });
  const world = {
    maps: [city, lockedRoute, reachableGrass, lockedGrass],
    wildEncounters: [
      {
        map: reachableGrass.id,
        land_mons: {
          encounter_rate: 21,
          mons: [{ min_level: 8, max_level: 12, species: "SPECIES_SPEAROW" }],
        },
      },
      {
        map: lockedGrass.id,
        land_mons: {
          encounter_rate: 21,
          mons: [{ min_level: 8, max_level: 14, species: "SPECIES_SPEAROW" }],
        },
      },
    ],
  };
  const observation = campaignObservation({
    map: city.id,
    variables: { 0x406c: 0 },
    flags: { 1107: true },
    party: [
      { slot: 0, species: 56, level: 12, hp: 22, maxHp: 32, moves: [] },
      { slot: 1, species: 4, level: 12, hp: 27, maxHp: 32, moves: [] },
    ],
  });
  observation.playerMemory.position = { x: 2, y: 2 };
  const objective = {
    id: "route22-leveling",
    minimumTeamAnchorLevel: 14,
    target: { kind: "trigger", map: reachableGrass.id, index: 0 },
  };
  const trainerCatalog = [{
    id: 107,
    name: "TRAINER_ALREADY_DEFEATED",
    displayName: "Defeated Trainer",
    flagId: 1107,
    minimumLevel: 11,
    maximumLevel: 11,
    partySize: 1,
    target: { kind: "object", map: city.id, index: 0 },
  }];

  const beforeBrock = selectTrainingObjective({
    world,
    observation,
    objective,
    trainerCatalog,
  });
  assert.equal(beforeBrock?.id, "train-team-anchor");
  assert.equal(beforeBrock?.target.kind, "encounter-zone");
  assert.equal(beforeBrock?.target.map, reachableGrass.id);

  observation.playerMemory.storyState.variableIds[0x406c] = 1;
  const afterBrock = selectTrainingObjective({
    world,
    observation,
    objective,
    trainerCatalog,
  });
  assert.equal(afterBrock?.target.map, lockedGrass.id);
});

test("pre-fossil Route 4 permits the west Mt. Moon entrance but not the east exit", () => {
  const mart = openMap("MAP_PEWTER_CITY_MART", {
    warpEvents: [{ x: 1, y: 3, dest_map: "MAP_PEWTER_CITY", dest_warp_id: 0 }],
    behaviors: { "1,3": "MB_LADDER" },
  });
  const pewter = openMap("MAP_PEWTER_CITY", {
    warpEvents: [
      { x: 1, y: 1, dest_map: mart.id, dest_warp_id: 0 },
      { x: 3, y: 3, dest_map: "MAP_ROUTE3", dest_warp_id: 0 },
    ],
    behaviors: { "1,1": "MB_LADDER", "3,3": "MB_LADDER" },
  });
  const route3 = openMap("MAP_ROUTE3", {
    warpEvents: [
      { x: 1, y: 1, dest_map: pewter.id, dest_warp_id: 1 },
      { x: 3, y: 3, dest_map: "MAP_ROUTE4", dest_warp_id: 0 },
    ],
    behaviors: { "1,1": "MB_LADDER", "3,3": "MB_LADDER" },
  });
  const route4 = openMap("MAP_ROUTE4", {
    width: 7,
    warpEvents: [
      { x: 1, y: 1, dest_map: route3.id, dest_warp_id: 1 },
      { x: 2, y: 1, dest_map: "MAP_MT_MOON_1F", dest_warp_id: 0 },
      { x: 4, y: 1, dest_map: "MAP_MT_MOON_1F", dest_warp_id: 1 },
      { x: 5, y: 1, dest_map: "MAP_CERULEAN_CITY", dest_warp_id: 0 },
    ],
    behaviors: {
      "1,1": "MB_LADDER",
      "2,1": "MB_LADDER",
      "4,1": "MB_LADDER",
      "5,1": "MB_LADDER",
    },
    collisions: Object.fromEntries(
      Array.from({ length: 5 }, (_, y) => [`3,${y}`, 1]),
    ),
  });
  const mtMoon = openMap("MAP_MT_MOON_1F", {
    warpEvents: [
      { x: 1, y: 1, dest_map: route4.id, dest_warp_id: 1 },
      { x: 3, y: 1, dest_map: route4.id, dest_warp_id: 2 },
    ],
    behaviors: { "1,1": "MB_LADDER", "3,1": "MB_LADDER" },
    encounters: { "2,2": 1, "2,3": 1 },
  });
  const cerulean = openMap("MAP_CERULEAN_CITY", {
    warpEvents: [{ x: 1, y: 1, dest_map: route4.id, dest_warp_id: 3 }],
    behaviors: { "1,1": "MB_LADDER" },
  });
  const world = { maps: [mart, pewter, route3, route4, mtMoon, cerulean] };
  const observation = campaignObservation({
    map: mart.id,
    variables: { [0x406c]: 1 },
    flags: { 562: false },
  });
  observation.playerMemory.position = { x: 1, y: 1 };

  const mtMoonRoute = campaignNavigationRecommendation({
    world,
    observation,
    objective: {
      id: "origins-paras-utility-capture",
      target: { kind: "encounter-zone", map: mtMoon.id },
    },
  });
  assert.equal(mtMoonRoute?.transit.destinationMap, pewter.id);

  const ceruleanObjective = {
    id: "reach-cerulean",
    target: { kind: "map-arrival", map: cerulean.id, x: 2, y: 2 },
  };
  assert.equal(campaignNavigationRecommendation({
    world, observation, objective: ceruleanObjective,
  }), null);

  observation.playerMemory.storyState.flagIds[562] = true;
  assert.equal(campaignNavigationRecommendation({
    world, observation, objective: ceruleanObjective,
  })?.transit.destinationMap, pewter.id);
});

test("trainer-first preparation stays near its pending badge instead of entering future routes", () => {
  const gym = openMap("MAP_LOCAL_GYM", {
    connections: [{ direction: "down", map: "MAP_LOCAL_CITY", offset: 0 }],
    objectEvents: [{ x: 3, y: 3, script: "LocalGym_EventScript_Leader" }],
  });
  const city = openMap("MAP_LOCAL_CITY", {
    connections: [
      { direction: "up", map: gym.id, offset: 0 },
      { direction: "left", map: "MAP_LOCAL_GRASS", offset: 0 },
      { direction: "right", map: "MAP_FUTURE_PASSAGE", offset: 0 },
    ],
  });
  const localGrass = openMap("MAP_LOCAL_GRASS", {
    connections: [{ direction: "right", map: city.id, offset: 0 }],
    encounters: { "1,1": 1, "2,1": 1 },
    behaviors: { "1,1": "MB_TALL_GRASS", "2,1": "MB_TALL_GRASS" },
  });
  const futurePassage = openMap("MAP_FUTURE_PASSAGE", {
    connections: [
      { direction: "left", map: city.id, offset: 0 },
      { direction: "right", map: "MAP_FUTURE_PASSAGE_TWO", offset: 0 },
    ],
  });
  const futurePassageTwo = openMap("MAP_FUTURE_PASSAGE_TWO", {
    connections: [
      { direction: "left", map: futurePassage.id, offset: 0 },
      { direction: "right", map: "MAP_FUTURE_ROUTE", offset: 0 },
    ],
  });
  const futureRoute = openMap("MAP_FUTURE_ROUTE", {
    connections: [{ direction: "left", map: futurePassageTwo.id, offset: 0 }],
    objectEvents: [{
      x: 3,
      y: 1,
      script: "FutureRoute_EventScript_Trainer",
      trainer_type: "TRAINER_TYPE_NORMAL",
    }],
  });
  const world = {
    maps: [gym, city, localGrass, futurePassage, futurePassageTwo, futureRoute],
    wildEncounters: [{
      map: localGrass.id,
      land_mons: {
        encounter_rate: 21,
        mons: [{ min_level: 12, max_level: 16, species: "SPECIES_SPEAROW" }],
      },
    }],
  };
  const observation = campaignObservation({
    map: gym.id,
    flags: { 1703: false },
    party: [
      { slot: 0, species: 47, level: 25, hp: 71, maxHp: 71, moves: [15] },
      { slot: 1, species: 44, level: 31, hp: 84, maxHp: 84, moves: [77] },
    ],
  });
  observation.playerMemory.position = { x: 2, y: 2 };

  const training = selectTrainingObjective({
    world,
    observation,
    objective: {
      id: "pending-badge-lock",
      target: { kind: "object", map: gym.id, index: 0 },
      importantBattle: true,
      enemyAceLevel: 25,
      battleTeamTargetLevel: 30,
      minimumBattleMemberLevel: 30,
    },
    trainerCatalog: [{
      id: 423,
      name: "TRAINER_PICNICKER_ALICIA",
      displayName: "ALICIA",
      flagId: 1703,
      minimumLevel: 20,
      maximumLevel: 23,
      partySize: 2,
      target: { kind: "object", map: futureRoute.id, index: 0 },
    }],
  });

  assert.equal(training?.id, "train-battle-member");
  assert.deepEqual(training?.target, {
    kind: "encounter-zone",
    map: localGrass.id,
  });
  assert.equal(training?.trainingSource, undefined);
  assert.equal(training?.forObjective, "pending-badge-lock");
});

test("important-battle training stages beside the next badge instead of reversing to a charged old rematch", () => {
  const oldRoute = openMap("MAP_OLD_ROUTE", {
    connections: [{ direction: "right", map: "MAP_FORWARD_PASSAGE", offset: 0 }],
    objectEvents: [{
      x: 3,
      y: 2,
      trainer_type: "TRAINER_TYPE_NORMAL",
      script: "OldRoute_EventScript_RematchTrainer",
    }],
  });
  const passage = openMap("MAP_FORWARD_PASSAGE", {
    connections: [
      { direction: "left", map: oldRoute.id, offset: 0 },
      { direction: "right", map: "MAP_NEXT_CITY", offset: 0 },
    ],
  });
  const city = openMap("MAP_NEXT_CITY", {
    connections: [
      { direction: "left", map: passage.id, offset: 0 },
      { direction: "right", map: "MAP_NEXT_ROUTE", offset: 0 },
    ],
    warpEvents: [{ x: 3, y: 1, dest_map: "MAP_NEXT_GYM", dest_warp_id: 0 }],
    behaviors: { "3,1": "MB_LADDER" },
  });
  const nextRoute = openMap("MAP_NEXT_ROUTE", {
    connections: [{ direction: "left", map: city.id, offset: 0 }],
    encounters: { "1,1": 1, "2,1": 1 },
    behaviors: { "1,1": "MB_TALL_GRASS", "2,1": "MB_TALL_GRASS" },
  });
  const gym = openMap("MAP_NEXT_GYM", {
    warpEvents: [{ x: 1, y: 1, dest_map: city.id, dest_warp_id: 0 }],
    behaviors: { "1,1": "MB_LADDER" },
    objectEvents: [{ x: 3, y: 3, script: "NextGym_EventScript_Leader" }],
  });
  const world = {
    maps: [oldRoute, passage, city, nextRoute, gym],
    wildEncounters: [{
      map: nextRoute.id,
      land_mons: {
        encounter_rate: 21,
        mons: [{ min_level: 22, max_level: 25, species: "SPECIES_FEAROW" }],
      },
    }],
  };
  const observation = campaignObservation({
    map: passage.id,
    flags: {
      658: true,
      1541: true,
      1542: false,
    },
    bag: { keyItems: [{ itemId: 362, quantity: 1 }] },
    party: [
      { slot: 0, species: 22, level: 20, hp: 55, maxHp: 55, moves: [64] },
      { slot: 1, species: 8, level: 30, hp: 85, maxHp: 85, moves: [55] },
    ],
  });
  observation.playerMemory.position = { x: 3, y: 2 };
  observation.playerMemory.vsSeeker = {
    batterySteps: 100,
    responseClearSteps: 0,
    rematchEntries: Array(100).fill(0),
  };

  const training = selectTrainingObjective({
    world,
    observation,
    objective: {
      id: "badge-next",
      target: { kind: "object", map: gym.id, index: 0 },
      importantBattle: true,
      minimumBattlePartySize: 2,
      minimumBattleMemberLevel: 29,
    },
    trainerCatalog: [{
      id: 41,
      name: "TRAINER_OLD_BASE",
      displayName: "OLD TRAINER",
      flagId: 1541,
      minimumLevel: 20,
      maximumLevel: 20,
      partySize: 1,
      localId: 1,
      target: { kind: "object", map: oldRoute.id, index: 0 },
      rematchParties: [null, {
        id: 42,
        name: "TRAINER_OLD_REMATCH",
        displayName: "OLD TRAINER",
        flagId: 1542,
        minimumLevel: 25,
        maximumLevel: 25,
        partySize: 3,
        expectedExperience: 9000,
      }],
    }],
  });

  assert.equal(training?.id, "train-battle-member");
  assert.deepEqual(training?.target, {
    kind: "encounter-zone",
    map: nextRoute.id,
  });
  assert.equal(training?.forObjective, "badge-next");
});

test("a mandatory capture hunt replenishes affordable balls before entering grass", () => {
  const route = openMap("MAP_ROUTE5", {
    connections: [{
      direction: "right",
      map: "MAP_CERULEAN_CITY_MART",
      offset: 0,
    }],
    encounters: { "1,1": 1, "2,1": 1 },
    behaviors: { "1,1": "MB_TALL_GRASS", "2,1": "MB_TALL_GRASS" },
  });
  const mart = openMap("MAP_CERULEAN_CITY_MART", {
    connections: [{ direction: "left", map: route.id, offset: 0 }],
    objectEvents: [{
      x: 3,
      y: 1,
      script: "CeruleanCity_Mart_EventScript_Clerk",
    }],
  });
  const world = { data: { maps: [route, mart], wildEncounters: [] } };
  const story = {
    data: {
      symbols: {
        items: {
          ITEM_POKE_BALL: { value: 4 },
          ITEM_POTION: { value: 13 },
        },
        flags: {},
      },
      scripts: [{
        label: "CeruleanCity_Mart_EventScript_Clerk",
        instructions: [{
          op: "pokemart",
          args: ["CeruleanCity_Mart_Items"],
        }],
      }, {
        label: "CeruleanCity_Mart_Items",
        instructions: [
          { op: ".2byte", args: ["ITEM_POKE_BALL"] },
          { op: ".2byte", args: ["ITEM_POTION"] },
          { op: ".2byte", args: ["ITEM_NONE"] },
        ],
      }],
    },
  };
  const capture = {
    id: "origins-persian-capture",
    target: { kind: "encounter-zone", map: route.id },
    completion: { kind: "owned-species", species: [52, 53] },
    captureSpecies: [52],
    captureFamily: [52, 53],
  };
  const planner = createCampaignPlanner({
    campaign: { objectives: [capture] },
    world,
    story,
  });
  const observed = campaignObservation({ map: route.id });
  observed.playerMemory.position = { x: 1, y: 1 };
  observed.playerMemory.trainer.money = 2808;
  observed.playerMemory.trainer.bag = { pokeBalls: [] };

  assert.deepEqual(planner.select(observed), {
    id: "replenish-origins-persian-capture-balls",
    target: {
      kind: "purchase-items",
      map: mart.id,
      objectIndex: 0,
      items: [{ itemId: 4, stockIndex: 0, quantity: 12, unitPrice: 200 }],
    },
    completion: { kind: "item-at-least", id: 4, quantity: 12 },
    captureSupplyFor: capture.id,
    captureSpecies: [52],
    captureFamily: [52, 53],
    supplyPriority: ["medicine", "poke-balls"],
  });

  observed.emulator.mode = "battle";
  observed.playerMemory.battle = { opponent: { species: 52 } };
  observed.playerMemory.trainer.bag.pokeBalls = [{ itemId: 4, quantity: 1 }];
  assert.equal(planner.select(observed)?.id, capture.id);
});

test("capture restocking upgrades locally before crossing the unopened Snorlax route", () => {
  const route = openMap("MAP_CAPTURE_ROUTE", {
    connections: [
      { direction: "left", map: "MAP_LAVENDER_TOWN_MART", offset: 0 },
      { direction: "right", map: "MAP_FUCHSIA_CITY_MART", offset: 0 },
      { direction: "up", map: "MAP_CERULEAN_CITY_MART", offset: 0 },
    ],
    encounters: { "1,1": 1, "2,1": 1 },
    behaviors: { "1,1": "MB_CAVE_FLOOR", "2,1": "MB_CAVE_FLOOR" },
    objectEvents: [{
      x: 1,
      y: 1,
      flag: "FLAG_HIDE_CAPTURE_ROUTE_POTION",
      graphics_id: "OBJ_EVENT_GFX_ITEM_BALL",
      script: "CaptureRoute_EventScript_Potion",
    }],
  });
  const localMart = openMap("MAP_LAVENDER_TOWN_MART", {
    connections: [{ direction: "right", map: route.id, offset: 0 }],
    objectEvents: [{
      x: 3,
      y: 1,
      script: "LavenderTown_Mart_EventScript_Clerk",
    }],
  });
  const highGradeMart = openMap("MAP_FUCHSIA_CITY_MART", {
    connections: [{ direction: "left", map: route.id, offset: 0 }],
    objectEvents: [{
      x: 3,
      y: 1,
      script: "FuchsiaCity_Mart_EventScript_Clerk",
    }],
  });
  const fallbackMart = openMap("MAP_CERULEAN_CITY_MART", {
    connections: [{ direction: "down", map: route.id, offset: 0 }],
    objectEvents: [{
      x: 3,
      y: 1,
      script: "CeruleanCity_Mart_EventScript_Clerk",
    }],
  });
  const world = {
    data: { maps: [route, localMart, highGradeMart, fallbackMart] },
  };
  const story = collectionStory({
    flags: { FLAG_HIDE_CAPTURE_ROUTE_POTION: 1006 },
    items: {
      ITEM_ULTRA_BALL: 2,
      ITEM_GREAT_BALL: 3,
      ITEM_POKE_BALL: 4,
      ITEM_POTION: 13,
    },
    scripts: [{
      label: "LavenderTown_Mart_EventScript_Clerk",
      instructions: [{ op: "pokemart", args: ["LavenderTown_Mart_Items"] }],
    }, {
      label: "LavenderTown_Mart_Items",
      instructions: [
        { op: ".2byte", args: ["ITEM_GREAT_BALL"] },
        { op: ".2byte", args: ["ITEM_NONE"] },
      ],
    }, {
      label: "FuchsiaCity_Mart_EventScript_Clerk",
      instructions: [{ op: "pokemart", args: ["FuchsiaCity_Mart_Items"] }],
    }, {
      label: "FuchsiaCity_Mart_Items",
      instructions: [
        { op: ".2byte", args: ["ITEM_ULTRA_BALL"] },
        { op: ".2byte", args: ["ITEM_GREAT_BALL"] },
        { op: ".2byte", args: ["ITEM_NONE"] },
      ],
    }, {
      label: "CeruleanCity_Mart_EventScript_Clerk",
      instructions: [{ op: "pokemart", args: ["CeruleanCity_Mart_Items"] }],
    }, {
      label: "CeruleanCity_Mart_Items",
      instructions: [
        { op: ".2byte", args: ["ITEM_POKE_BALL"] },
        { op: ".2byte", args: ["ITEM_NONE"] },
      ],
    }, {
      label: "CaptureRoute_EventScript_Potion",
      instructions: [{ op: "finditem", args: ["ITEM_POTION"] }],
    }],
  });
  const capture = {
    id: "haunter",
    target: { kind: "encounter-zone", map: route.id },
    completion: { kind: "owned-species", species: [93] },
    captureSpecies: [93],
    captureFamily: [93, 94],
    encounter: { minimumLevel: 21, maximumLevel: 25 },
  };
  const planner = createCampaignPlanner({
    campaign: { objectives: [capture] },
    world,
    story,
  });
  const observed = campaignObservation({ map: route.id });
  observed.playerMemory.position = { x: 2, y: 1 };
  observed.playerMemory.trainer.money = 52896;
  observed.playerMemory.trainer.bag = { pokeBalls: [] };
  observed.playerMemory.storyState.flagIds[1006] = false;

  assert.deepEqual(planner.select(observed), {
    id: "replenish-haunter-balls",
    target: {
      kind: "purchase-items",
      map: localMart.id,
      objectIndex: 0,
      items: [
        { itemId: 3, stockIndex: 0, quantity: 12, unitPrice: 600 },
      ],
    },
    completion: { kind: "item-at-least", id: 3, quantity: 12 },
    captureSupplyFor: capture.id,
    captureSpecies: [93],
    captureFamily: [93, 94],
    supplyPriority: ["medicine", "poke-balls"],
  });
  assert.equal(
    planner.selectCollection(observed, planner.select(observed)),
    null,
    "urgent capture supplies must outrank optional item collection",
  );

  observed.playerMemory.trainer.bag.pokeBalls = [
    { itemId: 4, quantity: 7 },
    { itemId: 3, quantity: 12 },
  ];
  assert.equal(
    planner.select(observed)?.id,
    capture.id,
    "a completed stronger portfolio must not trigger weaker-ball shopping",
  );
  assert.equal(
    planner.selectCollection(observed, planner.select(observed)),
    null,
    "a mandatory rare capture must keep priority over optional item collection",
  );

  observed.playerMemory.trainer.bag.pokeBalls = [];
  observed.playerMemory.storyState.flagIds[84] = true;

  assert.deepEqual(planner.select(observed), {
    id: "replenish-haunter-balls",
    target: {
      kind: "purchase-items",
      map: highGradeMart.id,
      objectIndex: 0,
      items: [
        { itemId: 2, stockIndex: 0, quantity: 8, unitPrice: 1200 },
        { itemId: 3, stockIndex: 1, quantity: 4, unitPrice: 600 },
      ],
    },
    completion: {
      kind: "all",
      completions: [
        { kind: "item-at-least", id: 2, quantity: 8 },
        { kind: "item-at-least", id: 3, quantity: 4 },
      ],
    },
    captureSupplyFor: capture.id,
    captureSpecies: [93],
    captureFamily: [93, 94],
    supplyPriority: ["medicine", "poke-balls"],
  });
});

test("the campaign planner detours for a reachable unclaimed visible item", () => {
  const map = openMap("MAP_ITEM_MEADOW", {
    objectEvents: [{
      x: 2,
      y: 2,
      flag: "FLAG_HIDE_ITEM_MEADOW_POTION",
      graphics_id: "OBJ_EVENT_GFX_ITEM_BALL",
      script: "ItemMeadow_EventScript_Potion",
    }],
  });
  const world = { data: { maps: [map] } };
  const story = collectionStory({
    flags: { FLAG_HIDE_ITEM_MEADOW_POTION: 342 },
    items: { ITEM_POTION: 13 },
    scripts: [{
      label: "ItemMeadow_EventScript_Potion",
      instructions: [{ op: "finditem", args: ["ITEM_POTION"] }],
    }],
  });
  const planner = createCampaignPlanner({
    campaign: { objectives: [] },
    world,
    story,
  });
  const observation = campaignObservation({ map: map.id, flags: { 342: false } });
  observation.playerMemory.position = { x: 2, y: 3 };

  const objective = planner.selectCollection(observation);

  assert.equal(objective?.id, "collect:MAP_ITEM_MEADOW:visible:0");
  assert.deepEqual(objective?.target, {
    kind: "object",
    map: map.id,
    index: 0,
  });
  assert.equal(objective?.itemId, 13);
  assert.equal(objective?.flagId, 342);
  assert.equal(
    planner.selectCollection(observation, { deferOptionalDetours: true }),
    null,
    "an explicit story transaction must outrank an optional pickup",
  );
  assert.equal(
    campaignNavigationRecommendation({ world, observation, objective })?.kind,
    "interact-with-object",
  );

  observation.playerMemory.storyState.flagIds[342] = true;
  assert.equal(planner.selectCollection(observation), null);
});

test("the collection catalog includes visible key items awarded by giveitem scripts", () => {
  const map = openMap("MAP_KEY_ITEM_ROOM", {
    objectEvents: [{
      x: 2,
      y: 2,
      flag: "FLAG_HIDE_LIFT_KEY",
      graphics_id: "OBJ_EVENT_GFX_ITEM_BALL",
      script: "KeyItemRoom_EventScript_LiftKey",
    }],
  });
  const planner = createCampaignPlanner({
    campaign: { objectives: [] },
    world: { data: { maps: [map] } },
    story: collectionStory({
      flags: { FLAG_HIDE_LIFT_KEY: 54 },
      items: { ITEM_LIFT_KEY: 265 },
      scripts: [{
        label: "KeyItemRoom_EventScript_LiftKey",
        instructions: [{ op: "giveitem", args: ["ITEM_LIFT_KEY"] }],
      }],
    }),
  });

  assert.equal(planner.collectionCatalog().length, 1);
  assert.equal(planner.collectionCatalog()[0].itemId, 265);
});

test("the campaign planner routes to a reachable regular hidden item", () => {
  const map = openMap("MAP_HIDDEN_MEADOW", {
    backgroundEvents: [{
      x: 3,
      y: 2,
      elevation: 3,
      type: "hidden_item",
      flag: "FLAG_HIDDEN_ITEM_MEADOW_ANTIDOTE",
      item: "ITEM_ANTIDOTE",
      quantity: 1,
      underfoot: false,
    }],
  });
  const world = { data: { maps: [map] } };
  const story = collectionStory({
    flags: { FLAG_HIDDEN_ITEM_MEADOW_ANTIDOTE: 1000 },
    items: { ITEM_ANTIDOTE: 14 },
  });
  const planner = createCampaignPlanner({
    campaign: { objectives: [] },
    world,
    story,
  });
  const observation = campaignObservation({ map: map.id, flags: { 1000: false } });
  observation.playerMemory.position = { x: 3, y: 3 };

  const objective = planner.selectCollection(observation);

  assert.equal(objective?.id, "collect:MAP_HIDDEN_MEADOW:hidden:0");
  assert.equal(objective?.target.kind, "background");
  assert.equal(objective?.itemId, 14);
  assert.equal(
    campaignNavigationRecommendation({ world, observation, objective })?.kind,
    "interact-with-background",
  );
});

test("the Route 12 item sweep waits until its blocking Snorlax is cleared", () => {
  const route = openMap("MAP_ROUTE12", {
    width: 20,
    height: 110,
    objectEvents: [{
      x: 9,
      y: 101,
      flag: "FLAG_HIDE_ROUTE12_IRON",
      graphics_id: "OBJ_EVENT_GFX_ITEM_BALL",
      script: "Route12_EventScript_ItemIron",
    }],
  });
  const planner = createCampaignPlanner({
    campaign: { objectives: [] },
    world: { data: { maps: [route] } },
    story: collectionStory({
      flags: { FLAG_HIDE_ROUTE12_IRON: 1007 },
      items: { ITEM_IRON: 69 },
      scripts: [{
        label: "Route12_EventScript_ItemIron",
        instructions: [{ op: "finditem", args: ["ITEM_IRON"] }],
      }],
    }),
  });
  const observation = campaignObservation({
    map: route.id,
    flags: { 84: false, 573: true, 1007: false },
  });
  observation.playerMemory.position = { x: 14, y: 22 };

  assert.equal(
    planner.selectCollection(observation),
    null,
    "the coarse world graph must not route through the one-time encounter",
  );

  observation.playerMemory.storyState.flagIds[84] = true;
  assert.equal(
    planner.selectCollection(observation)?.id,
    "collect:MAP_ROUTE12:visible:0",
  );
});

test("recovery routing does not reverse across Route 12 while Snorlax is asleep", () => {
  const corridorWalls = Object.fromEntries(
    Array.from({ length: 5 }, (_, y) =>
      [0, 1, 3, 4].map((x) => [`${x},${y}`, 1])
    ).flat(),
  );
  const route12 = openMap("MAP_ROUTE12", {
    collisions: corridorWalls,
    connections: [
      { direction: "up", map: "MAP_LAVENDER_TOWN", offset: 0 },
      { direction: "down", map: "MAP_ROUTE13", offset: 0 },
    ],
    objectEvents: [{
      x: 2,
      y: 2,
      flag: "FLAG_HIDE_ROUTE_12_SNORLAX",
      graphics_id: "OBJ_EVENT_GFX_SNORLAX",
      script: "Route12_EventScript_Snorlax",
    }],
  });
  const route13 = openMap("MAP_ROUTE13", {
    connections: [
      { direction: "up", map: route12.id, offset: 0 },
      { direction: "left", map: "MAP_ROUTE14", offset: 0 },
    ],
  });
  const route14 = openMap("MAP_ROUTE14", {
    connections: [
      { direction: "right", map: route13.id, offset: 0 },
      { direction: "left", map: "MAP_FUCHSIA_CITY", offset: 0 },
    ],
  });
  const lavender = openMap("MAP_LAVENDER_TOWN", {
    connections: [{ direction: "down", map: route12.id, offset: 0 }],
    warpEvents: [{
      x: 2,
      y: 2,
      dest_map: "MAP_LAVENDER_TOWN_POKEMON_CENTER_1F",
      dest_warp_id: "0",
    }],
    behaviors: { "2,2": "MB_WARP_DOOR" },
  });
  const fuchsia = openMap("MAP_FUCHSIA_CITY", {
    connections: [{ direction: "right", map: route14.id, offset: 0 }],
    warpEvents: [{
      x: 2,
      y: 2,
      dest_map: "MAP_FUCHSIA_CITY_POKEMON_CENTER_1F",
      dest_warp_id: "0",
    }],
    behaviors: { "2,2": "MB_WARP_DOOR" },
  });
  const pokemonCenter = (id, city) => openMap(id, {
    warpEvents: [{ x: 2, y: 4, dest_map: city, dest_warp_id: "0" }],
    objectEvents: [{
      x: 2,
      y: 1,
      script: `${id}_EventScript_Nurse`,
    }],
    behaviors: { "2,4": "MB_SOUTH_ARROW_WARP" },
  });
  const world = { maps: [
    route12,
    route13,
    route14,
    lavender,
    fuchsia,
    pokemonCenter("MAP_LAVENDER_TOWN_POKEMON_CENTER_1F", lavender.id),
    pokemonCenter("MAP_FUCHSIA_CITY_POKEMON_CENTER_1F", fuchsia.id),
  ] };
  const recoveryTargetFrom = (map, position, route12SnorlaxCleared = false) => {
    const observation = campaignObservation({
      map,
      flags: { 84: route12SnorlaxCleared, 573: true },
    });
    observation.playerMemory.position = position;
    return selectRecoveryObjective({ world, observation })?.target.map;
  };

  assert.equal(
    recoveryTargetFrom(route12.id, { x: 2, y: 4 }),
    "MAP_FUCHSIA_CITY_POKEMON_CENTER_1F",
  );
  assert.equal(
    recoveryTargetFrom(route13.id, { x: 2, y: 0 }),
    "MAP_FUCHSIA_CITY_POKEMON_CENTER_1F",
  );
  assert.equal(
    recoveryTargetFrom(route13.id, { x: 2, y: 0 }, true),
    "MAP_LAVENDER_TOWN_POKEMON_CENTER_1F",
  );
});

test("recovery recognizes Silph 9F's cartridge-authored free healer", () => {
  const floor = openMap("MAP_SILPH_CO_9F", {
    objectEvents: [
      { x: 5, y: 1, script: "SilphCo_9F_EventScript_Grunt" },
      { x: 2, y: 2, script: "SilphCo_9F_EventScript_HealWoman" },
    ],
  });
  const observation = campaignObservation({ map: floor.id, variables: { 0x4060: 0 } });
  observation.playerMemory.position = { x: 2, y: 3 };

  assert.deepEqual(selectRecoveryObjective({
    world: { maps: [floor] },
    observation,
  }), {
    id: "recover-party",
    target: { kind: "object", map: floor.id, index: 1 },
  });
});


// Source-shaped fixture: the early scene branch bypasses the healing call.
function silphHealerStory(script = "SilphCo_9F_EventScript_HealWoman") {
  return { data: {
    symbols: { variables: { VAR_MAP_SCENE_SILPH_CO_11F: { value: 0x4060 } } },
    scripts: [
      { label: script, instructions: [
        { op: "lock", args: [] },
        { op: "faceplayer", args: [] },
        { op: "goto_if_ge", args: ["VAR_MAP_SCENE_SILPH_CO_11F", "1", "RocketsGone"] },
        { op: "msgbox", args: ["TakeQuickNap"] },
        { op: "call", args: ["EventScript_OutOfCenterPartyHeal"] },
        { op: "release", args: [] },
        { op: "end", args: [] },
      ] },
      { label: "RocketsGone", instructions: [
        { op: "msgbox", args: ["ThankYouSoMuch"] },
        { op: "release", args: [] },
        { op: "end", args: [] },
      ] },
    ],
  } };
}

for (const sourceAvailable of [true, false]) {
  for (const [scene, available] of [[0, true], [1, false], [2, false], [undefined, false], [null, false]]) {
    test(`Silph free healing availability: source=${sourceAvailable}, scene=${scene}`, () => {
      const floor = openMap("MAP_SILPH_CO_9F", { objectEvents: [
        { x: 2, y: 2, script: "SilphCo_9F_EventScript_HealWoman" },
      ] });
      const observation = campaignObservation({ map: floor.id,
        variables: scene === undefined ? {} : { 0x4060: scene } });
      observation.playerMemory.position = { x: 2, y: 3 };
      const objective = selectRecoveryObjective({ world: { maps: [floor] },
        story: sourceAvailable ? silphHealerStory() : null, observation });
      assert.equal(objective?.target.map ?? null, available ? floor.id : null);
    });
  }
}

test("healer scene guards follow script branches without depending on Silph's label", () => {
  const floor = openMap("MAP_TEST_HEALER", { objectEvents: [
    { x: 2, y: 2, script: "ConditionalHealer" },
  ] });
  const story = silphHealerStory("ConditionalHealer");
  const observation = campaignObservation({ map: floor.id, variables: { 0x4060: 1 } });
  observation.playerMemory.position = { x: 2, y: 3 };
  assert.equal(selectRecoveryObjective({ world: { maps: [floor] }, story, observation }), null);
  observation.playerMemory.storyState.variableIds[0x4060] = 0;
  assert.equal(selectRecoveryObjective({ world: { maps: [floor] }, story, observation })?.target.map, floor.id);
});

test("battle scripts that eventually heal are not offered as reusable free healers", () => {
  const floor = openMap("MAP_TEST_HEALER", { objectEvents: [
    { x: 2, y: 2, script: "BattleThenHeal" },
  ] });
  const story = { data: { scripts: [{ label: "BattleThenHeal", instructions: [
    { op: "trainerbattle_single", args: ["TRAINER_TEST"] },
    { op: "special", args: ["HealPlayerParty"] },
  ] }] } };
  const observation = campaignObservation({ map: floor.id });
  observation.playerMemory.position = { x: 2, y: 3 };
  assert.equal(selectRecoveryObjective({ world: { maps: [floor] }, story, observation }), null);
});

test("coordinate healing respects the same early scene branch as object healing", () => {
  const script = "ConditionalHealingZone";
  const story = silphHealerStory(script);
  story.data.scripts[0].instructions[4] = { op: "special", args: ["HealPlayerParty"] };
  const floor = openMap("MAP_TEST_HEALER", {
    coordEvents: [{ x: 2, y: 2, type: "trigger", script }],
  });
  const observation = campaignObservation({ map: floor.id, variables: { 0x4060: 1 } });
  observation.playerMemory.position = { x: 2, y: 3 };
  assert.equal(selectRecoveryObjective({ world: { maps: [floor] }, story, observation }), null);
  observation.playerMemory.storyState.variableIds[0x4060] = 0;
  assert.equal(selectRecoveryObjective({ world: { maps: [floor] }, story, observation })?.target.kind, "trigger");
});

test("excluded ineffective healers cannot replace another available free healer", () => {
  const floor = openMap("MAP_TEST_POKEMON_CENTER_1F", { objectEvents: [
    { x: 2, y: 2, script: "First_EventScript_Nurse" },
    { x: 4, y: 2, script: "Second_EventScript_Nurse" },
  ] });
  const observation = campaignObservation({ map: floor.id });
  observation.playerMemory.position = { x: 2, y: 3 };
  const excludedTargets = [{ kind: "object", map: floor.id, index: 0 }];
  assert.equal(selectRecoveryObjective({ world: { maps: [floor] }, observation, excludedTargets })?.target.index, 1);
  excludedTargets.push({ kind: "object", map: floor.id, index: 1 });
  assert.equal(selectRecoveryObjective({ world: { maps: [floor] }, observation, excludedTargets }), null);
});

test("healer watch includes its scene guard even without a campaign objective for Silph", () => {
  for (const story of [silphHealerStory(), null]) {
    const planner = createCampaignPlanner({ campaign: { objectives: [] }, story });
    assert.ok(planner.storyWatch().variables.includes(0x4060));
  }
});

test("recovery excludes a remote Silph healer behind an unopened Card Key door", () => {
  const wall = Object.fromEntries(
    Array.from({ length: 5 }, (_, y) => [`3,${y}`, y === 2 ? 0 : 1]),
  );
  const eighthFloor = openMap("MAP_SILPH_CO_8F", {
    width: 7,
    height: 5,
    behaviors: {
      "1,1": "MB_UP_LEFT_STAIR_WARP",
      "5,1": "MB_DOWN_RIGHT_STAIR_WARP",
    },
    warpEvents: [
      { x: 1, y: 1, dest_map: "MAP_SILPH_CO_9F", dest_warp_id: "0" },
      { x: 5, y: 1, dest_map: "MAP_SILPH_CO_7F", dest_warp_id: "0" },
    ],
  });
  const ninthFloor = openMap("MAP_SILPH_CO_9F", {
    width: 7,
    height: 5,
    collisions: wall,
    behaviors: { "1,1": "MB_DOWN_LEFT_STAIR_WARP" },
    warpEvents: [{
      x: 1,
      y: 1,
      dest_map: eighthFloor.id,
      dest_warp_id: "0",
    }],
    backgroundEvents: [{
      x: 3,
      y: 2,
      type: "sign",
      script: "SilphCo_9F_EventScript_Door1",
      player_facing_dir: "BG_EVENT_PLAYER_FACING_ANY",
    }],
    objectEvents: [{
      x: 5,
      y: 2,
      script: "SilphCo_9F_EventScript_HealWoman",
    }],
  });
  const seventhFloor = openMap("MAP_SILPH_CO_7F", {
    behaviors: {
      "1,1": "MB_UP_LEFT_STAIR_WARP",
      "3,1": "MB_LADDER",
    },
    warpEvents: [
      { x: 1, y: 1, dest_map: eighthFloor.id, dest_warp_id: "1" },
      {
        x: 3,
        y: 1,
        dest_map: "MAP_SAFFRON_CITY_POKEMON_CENTER_1F",
        dest_warp_id: "0",
      },
    ],
  });
  const center = openMap("MAP_SAFFRON_CITY_POKEMON_CENTER_1F", {
    behaviors: { "1,1": "MB_LADDER" },
    warpEvents: [{
      x: 1,
      y: 1,
      dest_map: seventhFloor.id,
      dest_warp_id: "1",
    }],
    objectEvents: [{
      x: 3,
      y: 3,
      script: "SaffronCity_PokemonCenter_1F_EventScript_Nurse",
    }],
  });
  const world = { maps: [seventhFloor, eighthFloor, ninthFloor, center] };
  const observation = campaignObservation({ map: eighthFloor.id, variables: { 0x4060: 0 } });
  observation.playerMemory.position = { x: 1, y: 1 };

  assert.equal(
    selectRecoveryObjective({ world, observation })?.target.map,
    center.id,
  );

  observation.playerMemory.trainer.bag = {
    keyItems: [{ itemId: 355, quantity: 1 }],
  };
  assert.equal(
    selectRecoveryObjective({ world, observation })?.target.map,
    ninthFloor.id,
  );
});

test("recovery keeps an unlockable same-floor healer instead of abandoning it at a closed door", () => {
  const floor = openMap("MAP_SILPH_CO_9F", {
    width: 9, height: 7,
    collisions: Object.fromEntries(Array.from({ length: 7 }, (_, y) => [`3,${y}`, y === 3 ? 0 : 1])),
    backgroundEvents: [{ x: 3, y: 3, type: "sign", script: "SilphCo_9F_EventScript_Door1",
      player_facing_dir: "BG_EVENT_PLAYER_FACING_ANY" }],
    objectEvents: [{ x: 7, y: 3, script: "SilphCo_9F_EventScript_HealWoman" }],
  });
  const observation = campaignObservation({ map: floor.id, variables: { 0x4060: 0 },
    bag: { keyItems: [{ itemId: 355, quantity: 1 }] } });
  observation.playerMemory.position = { x: 1, y: 3 };
  observation.playerMemory.mapGrid = { width: 9, height: 7,
    cells: floor.layout.cells.map(cell => cell.x === 3 && cell.y === 3 ? { ...cell, collision: 3 } : cell) };
  const objective = selectRecoveryObjective({ world: { maps: [floor] }, observation });
  assert.deepEqual(objective?.target, { kind: "object", map: floor.id, index: 0 });
  assert.equal(campaignNavigationRecommendation({ world: { maps: [floor] }, observation, objective })?.target?.kind, "background");
  observation.playerMemory.trainer.bag = {};
  assert.equal(selectRecoveryObjective({ world: { maps: [floor] }, observation }), null);
});

test("collection telemetry cannot persist transient or quest-recap pickup flags", () => {
  const map = openMap("MAP_ROUTE2", { objectEvents: [{ x: 3, y: 2,
    graphics_id: "OBJ_EVENT_GFX_ITEM_BALL", script: "Route2_EventScript_ItemPotion", flag: "FLAG_ITEM" }] });
  const story = { data: { symbols: { flags: { FLAG_ITEM: { value: 123 } }, items: { ITEM_POTION: { value: 13 } } },
    scripts: [{ label: "Route2_EventScript_ItemPotion", instructions: [{ op: "finditem", args: ["ITEM_POTION"] }] }] } };
  const planner = createCampaignPlanner({ world: { maps: [map] }, story });
  const stable = campaignObservation({ map: map.id, flags: { 123: false } });
  assert.equal(planner.collectionProgress(stable).collected, 0);
  assert.equal(planner.collectionProgress(stable).total, 1);
  const transient = structuredClone(stable);
  transient.phase = "transition";
  transient.playerMemory.storyState.flagIds[123] = true;
  transient.playerMemory.map.id = "MAP_UNVISITED";
  assert.equal(planner.collectionProgress(transient).collected, 0);
  assert.equal(planner.collectionProgress(transient).provenMaps, 1);
  transient.phase = "stable";
  transient.playerMemory.questLog = { playback: true };
  assert.equal(planner.collectionProgress(transient).collected, 0);
  stable.playerMemory.storyState.flagIds[123] = true;
  assert.equal(planner.collectionProgress(stable).collected, 1);
});

test("recovery derives reusable object and coordinate healers from cartridge scripts", () => {
  const home = openMap("MAP_PALLET_TOWN_PLAYERS_HOUSE_1F", {
    objectEvents: [{
      x: 2,
      y: 2,
      script: "PalletTown_PlayersHouse_1F_EventScript_Mom",
    }],
  });
  const cabin = openMap("MAP_SS_ANNE_1F_ROOM6", {
    objectEvents: [{
      x: 2,
      y: 2,
      script: "SSAnne_1F_Room6_EventScript_Woman",
    }],
  });
  const tower = openMap("MAP_POKEMON_TOWER_5F", {
    coordEvents: [{
      x: 3,
      y: 3,
      type: "trigger",
      script: "PokemonTower_5F_EventScript_PurifiedZone",
    }],
  });
  const danceHouse = openMap("MAP_SEVAULT_CANYON_HOUSE", {
    objectEvents: [{
      x: 2,
      y: 2,
      script: "SevaultCanyon_House_EventScript_OneTimeDance",
    }],
  });
  const story = {
    data: {
      symbols: {
        flags: {
          FLAG_BEAT_RIVAL_IN_OAKS_LAB: { value: 600 },
        },
      },
      scripts: [
        {
          label: "PalletTown_PlayersHouse_1F_EventScript_Mom",
          instructions: [{
            op: "goto_if_set",
            args: [
              "FLAG_BEAT_RIVAL_IN_OAKS_LAB",
              "PalletTown_PlayersHouse_1F_EventScript_MomHeal",
            ],
          }],
        },
        {
          label: "PalletTown_PlayersHouse_1F_EventScript_MomHeal",
          instructions: [{
            op: "call",
            args: ["EventScript_OutOfCenterPartyHeal"],
          }],
        },
        {
          label: "SSAnne_1F_Room6_EventScript_Woman",
          instructions: [
            { op: "msgbox", args: ["rest", "MSGBOX_YESNO"] },
            {
              op: "call",
              args: ["EventScript_OutOfCenterPartyHeal"],
            },
          ],
        },
        {
          label: "PokemonTower_5F_EventScript_PurifiedZone",
          instructions: [{ op: "special", args: ["HealPlayerParty"] }],
        },
        {
          label: "SevaultCanyon_House_EventScript_OneTimeDance",
          instructions: [
            { op: "goto_if_set", args: ["DID_DANCE", "already-danced"] },
            { op: "call", args: ["EventScript_OutOfCenterPartyHeal"] },
            { op: "setflag", args: ["DID_DANCE"] },
          ],
        },
      ],
    },
  };

  const earlyHomeObservation = campaignObservation({
    map: home.id,
    flags: { 600: false },
  });
  earlyHomeObservation.playerMemory.position = { x: 2, y: 3 };
  assert.equal(selectRecoveryObjective({
    world: { maps: [home, cabin, tower, danceHouse] },
    story,
    observation: earlyHomeObservation,
  }), null);

  const unlockedHomeObservation = campaignObservation({
    map: home.id,
    flags: { 600: true },
  });
  unlockedHomeObservation.playerMemory.position = { x: 2, y: 3 };
  assert.deepEqual(selectRecoveryObjective({
    world: { maps: [home, cabin, tower, danceHouse] },
    story,
    observation: unlockedHomeObservation,
  }), {
    id: "recover-party",
    target: { kind: "object", map: home.id, index: 0 },
  });

  const healerAwarePlanner = createCampaignPlanner({
    campaign: { objectives: [] },
    world: { maps: [home, cabin, tower, danceHouse] },
    story,
  });
  assert.ok(healerAwarePlanner.storyWatch().flags.includes(600));

  const cabinObservation = campaignObservation({ map: cabin.id });
  cabinObservation.playerMemory.position = { x: 2, y: 3 };
  assert.deepEqual(selectRecoveryObjective({
    world: { maps: [home, cabin, tower, danceHouse] },
    story,
    observation: cabinObservation,
  }), {
    id: "recover-party",
    target: { kind: "object", map: cabin.id, index: 0 },
    choice: "yes",
  });

  const towerObservation = campaignObservation({ map: tower.id });
  towerObservation.playerMemory.position = { x: 3, y: 4 };
  assert.deepEqual(selectRecoveryObjective({
    world: { maps: [home, cabin, tower, danceHouse] },
    story,
    observation: towerObservation,
  }), {
    id: "recover-party",
    target: { kind: "trigger", map: tower.id, index: 0 },
  });

  const danceObservation = campaignObservation({ map: danceHouse.id });
  danceObservation.playerMemory.position = { x: 2, y: 3 };
  assert.equal(selectRecoveryObjective({
    world: { maps: [home, cabin, tower, danceHouse] },
    story,
    observation: danceObservation,
  }), null);
});

test("Game Corner hidden coins wait until the Coin Case is owned", () => {
  const map = openMap("MAP_CELADON_CITY_GAME_CORNER", {
    backgroundEvents: [{
      x: 2,
      y: 2,
      elevation: 3,
      type: "hidden_item",
      flag: "FLAG_HIDDEN_ITEM_CELADON_CITY_GAME_CORNER_COINS_4",
      item: "ITEM_NONE",
      quantity: 10,
      underfoot: false,
    }],
  });
  const planner = createCampaignPlanner({
    campaign: { objectives: [] },
    world: { data: { maps: [map] } },
    story: collectionStory({
      flags: { FLAG_HIDDEN_ITEM_CELADON_CITY_GAME_CORNER_COINS_4: 1234 },
      items: { ITEM_NONE: 0 },
    }),
  });
  const observation = campaignObservation({
    map: map.id,
    flags: { 1234: false },
    bag: { keyItems: [] },
  });
  observation.playerMemory.position = { x: 2, y: 3 };

  assert.equal(planner.selectCollection(observation), null);

  observation.playerMemory.trainer.bag.keyItems.push({
    itemId: 260,
    quantity: 1,
  });
  assert.equal(
    planner.selectCollection(observation)?.id,
    "collect:MAP_CELADON_CITY_GAME_CORNER:hidden:0",
  );
});

test("the item sweep skips a hidden item whose local route is not proven", () => {
  const map = openMap("MAP_WALLED_HIDDEN_ITEM", {
    width: 5,
    height: 5,
    collisions: Object.fromEntries(
      Array.from({ length: 5 }, (_, y) => [`2,${y}`, 1]),
    ),
    backgroundEvents: [{
      x: 4,
      y: 2,
      elevation: 3,
      type: "hidden_item",
      flag: "FLAG_HIDDEN_ITEM_BEHIND_WALL",
      item: "ITEM_POTION",
      quantity: 1,
      underfoot: false,
    }],
  });
  const world = { data: { maps: [map] } };
  const planner = createCampaignPlanner({
    campaign: { objectives: [] },
    world,
    story: collectionStory({
      flags: { FLAG_HIDDEN_ITEM_BEHIND_WALL: 1001 },
      items: { ITEM_POTION: 13 },
    }),
  });
  const observation = campaignObservation({ map: map.id, flags: { 1001: false } });
  observation.playerMemory.position = { x: 0, y: 2 };

  assert.equal(planner.selectCollection(observation), null);
});

test("the item sweep defers a same-region item instead of cycling over a reciprocal border", () => {
  const corridorWalls = Object.fromEntries(
    [0, 2].flatMap((y) =>
      Array.from({ length: 5 }, (_, x) => [`${x},${y}`, 1])
    ),
  );
  const route = openMap("MAP_BLOCKED_ITEM_ROUTE", {
    width: 5,
    height: 3,
    collisions: corridorWalls,
    connections: [{ direction: "left", map: "MAP_BORDER_NEIGHBOR", offset: 0 }],
    objectEvents: [
      {
        x: 3,
        y: 1,
        flag: "FLAG_HIDE_BLOCKED_ROUTE_ITEM",
        graphics_id: "OBJ_EVENT_GFX_ITEM_BALL",
        script: "BlockedRoute_EventScript_Item",
      },
      {
        x: 2,
        y: 1,
        flag: "FLAG_HIDE_BLOCKING_TRAINER",
        graphics_id: "OBJ_EVENT_GFX_CAMPER",
        script: "BlockedRoute_EventScript_Trainer",
      },
    ],
  });
  const neighbor = openMap("MAP_BORDER_NEIGHBOR", {
    width: 5,
    height: 3,
    collisions: corridorWalls,
    connections: [{ direction: "right", map: route.id, offset: 0 }],
  });
  const world = { data: { maps: [route, neighbor] } };
  const planner = createCampaignPlanner({
    campaign: { objectives: [] },
    world,
    story: collectionStory({
      flags: { FLAG_HIDE_BLOCKED_ROUTE_ITEM: 1002 },
      items: { ITEM_POTION: 13 },
      scripts: [{
        label: "BlockedRoute_EventScript_Item",
        instructions: [{ op: "finditem", args: ["ITEM_POTION"] }],
      }],
    }),
  });
  const observation = campaignObservation({
    map: route.id,
    flags: { 1002: false },
  });
  observation.playerMemory.position = { x: 0, y: 1 };

  assert.equal(planner.selectCollection(observation), null);

  const neighborObservation = campaignObservation({
    map: neighbor.id,
    flags: { 1002: false },
  });
  neighborObservation.playerMemory.position = { x: 4, y: 1 };
  assert.equal(
    planner.selectCollection(neighborObservation),
    null,
    "a locally disproven item must stay deferred after crossing the border",
  );

  const clearedObservation = campaignObservation({
    map: route.id,
    flags: { 1002: false },
  });
  clearedObservation.playerMemory.position = { x: 0, y: 1 };
  clearedObservation.playerMemory.storyState.flags.FLAG_HIDE_BLOCKING_TRAINER = true;
  assert.equal(
    planner.selectCollection(clearedObservation)?.id,
    "collect:MAP_BLOCKED_ITEM_ROUTE:visible:0",
    "revisiting the map must re-prove an item after its live blocker changes",
  );
});

test("the item sweep cannot pull the player through a reciprocal border away from an active story map", () => {
  const storyMap = openMap("MAP_STORY_BORDER_ROOM", {
    connections: [{ direction: "left", map: "MAP_STORY_BORDER_ROUTE", offset: 0 }],
    objectEvents: [{ x: 3, y: 1, script: "StoryRoom_EventScript_Objective" }],
  });
  const route = openMap("MAP_STORY_BORDER_ROUTE", {
    connections: [{ direction: "right", map: storyMap.id, offset: 0 }],
    objectEvents: [{
      x: 1,
      y: 1,
      flag: "FLAG_HIDE_STORY_BORDER_ITEM",
      graphics_id: "OBJ_EVENT_GFX_ITEM_BALL",
      script: "StoryBorderRoute_EventScript_Item",
    }],
  });
  const planner = createCampaignPlanner({
    campaign: { objectives: [{
      id: "finish-local-story-action",
      target: { kind: "object", map: storyMap.id, index: 0 },
      completion: { kind: "flag-set", id: 99 },
    }] },
    world: { data: { maps: [storyMap, route] } },
    story: collectionStory({
      flags: { FLAG_HIDE_STORY_BORDER_ITEM: 1003 },
      items: { ITEM_POTION: 13 },
      scripts: [{
        label: "StoryBorderRoute_EventScript_Item",
        instructions: [{ op: "finditem", args: ["ITEM_POTION"] }],
      }],
    }),
  });
  const routeObservation = campaignObservation({
    map: route.id,
    flags: { 99: false, 1003: false },
  });
  routeObservation.playerMemory.position = { x: 4, y: 1 };
  assert.equal(
    planner.selectCollection(routeObservation)?.id,
    "collect:MAP_STORY_BORDER_ROUTE:visible:0",
  );

  const storyObservation = campaignObservation({
    map: storyMap.id,
    flags: { 99: false, 1003: false },
  });
  storyObservation.playerMemory.position = { x: 0, y: 1 };

  assert.equal(planner.select(storyObservation)?.id, "finish-local-story-action");
  assert.equal(planner.selectCollection(storyObservation), null);
});

test("the item sweep cannot pull the player through a door away from an active story map", () => {
  const corridorWalls = Object.fromEntries(
    [0, 2].flatMap((y) =>
      Array.from({ length: 5 }, (_, x) => [`${x},${y}`, 1])
    ),
  );
  const cottage = openMap("MAP_STORY_COTTAGE", {
    width: 5,
    height: 3,
    collisions: corridorWalls,
    behaviors: { "0,1": "MB_LADDER" },
    warpEvents: [{
      x: 0,
      y: 1,
      dest_map: "MAP_STORY_COTTAGE_ROUTE",
      dest_warp_id: 0,
    }],
    objectEvents: [{ x: 3, y: 1, script: "StoryCottage_EventScript_Objective" }],
  });
  const route = openMap("MAP_STORY_COTTAGE_ROUTE", {
    width: 5,
    height: 3,
    collisions: corridorWalls,
    behaviors: { "4,1": "MB_LADDER" },
    warpEvents: [{ x: 4, y: 1, dest_map: cottage.id, dest_warp_id: 0 }],
    objectEvents: [{
      x: 1,
      y: 1,
      flag: "FLAG_HIDE_STORY_COTTAGE_ITEM",
      graphics_id: "OBJ_EVENT_GFX_ITEM_BALL",
      script: "StoryCottageRoute_EventScript_Item",
    }],
  });
  const planner = createCampaignPlanner({
    campaign: { objectives: [{
      id: "finish-cottage-story-action",
      target: { kind: "object", map: cottage.id, index: 0 },
      completion: { kind: "flag-set", id: 99 },
    }] },
    world: { data: { maps: [cottage, route] } },
    story: collectionStory({
      flags: { FLAG_HIDE_STORY_COTTAGE_ITEM: 1004 },
      items: { ITEM_POTION: 13 },
      scripts: [{
        label: "StoryCottageRoute_EventScript_Item",
        instructions: [{ op: "finditem", args: ["ITEM_POTION"] }],
      }],
    }),
  });
  const routeObservation = campaignObservation({
    map: route.id,
    flags: { 99: false, 1004: false },
  });
  routeObservation.playerMemory.position = { x: 4, y: 1 };
  assert.equal(
    planner.selectCollection(routeObservation)?.id,
    "collect:MAP_STORY_COTTAGE_ROUTE:visible:0",
  );

  const cottageObservation = campaignObservation({
    map: cottage.id,
    flags: { 99: false, 1004: false },
  });
  cottageObservation.playerMemory.position = { x: 0, y: 1 };

  assert.equal(planner.select(cottageObservation)?.id, "finish-cottage-story-action");
  assert.equal(planner.selectCollection(cottageObservation), null);
});

test("the item sweep still collects items inside the active story map", () => {
  const map = openMap("MAP_STORY_ITEM_ROOM", {
    objectEvents: [
      { x: 3, y: 1, script: "StoryItemRoom_EventScript_Objective" },
      {
        x: 1,
        y: 1,
        flag: "FLAG_HIDE_LOCAL_STORY_ITEM",
        graphics_id: "OBJ_EVENT_GFX_ITEM_BALL",
        script: "StoryItemRoom_EventScript_Item",
      },
    ],
  });
  const planner = createCampaignPlanner({
    campaign: { objectives: [{
      id: "finish-story-room",
      target: { kind: "object", map: map.id, index: 0 },
      completion: { kind: "flag-set", id: 99 },
    }] },
    world: { data: { maps: [map] } },
    story: collectionStory({
      flags: { FLAG_HIDE_LOCAL_STORY_ITEM: 1005 },
      items: { ITEM_POTION: 13 },
      scripts: [{
        label: "StoryItemRoom_EventScript_Item",
        instructions: [{ op: "finditem", args: ["ITEM_POTION"] }],
      }],
    }),
  });
  const observation = campaignObservation({
    map: map.id,
    flags: { 99: false, 1005: false },
  });
  observation.playerMemory.position = { x: 2, y: 1 };

  assert.equal(
    planner.selectCollection(observation)?.id,
    "collect:MAP_STORY_ITEM_ROOM:visible:1",
  );
});

test("same-region local blockage never turns a reciprocal border into progress", () => {
  const corridorWalls = Object.fromEntries(
    [0, 2].flatMap((y) =>
      Array.from({ length: 5 }, (_, x) => [`${x},${y}`, 1])
    ),
  );
  const route = openMap("MAP_BLOCKED_OBJECT_ROUTE", {
    width: 5,
    height: 3,
    collisions: corridorWalls,
    connections: [{ direction: "left", map: "MAP_OBJECT_NEIGHBOR", offset: 0 }],
    objectEvents: [
      { x: 3, y: 1, script: "BlockedRoute_EventScript_Target" },
      {
        x: 2,
        y: 1,
        graphics_id: "OBJ_EVENT_GFX_CAMPER",
        script: "BlockedRoute_EventScript_Trainer",
      },
    ],
  });
  const neighbor = openMap("MAP_OBJECT_NEIGHBOR", {
    width: 5,
    height: 3,
    collisions: corridorWalls,
    connections: [{ direction: "right", map: route.id, offset: 0 }],
  });
  const observation = campaignObservation({ map: route.id });
  observation.playerMemory.position = { x: 0, y: 1 };

  assert.equal(campaignNavigationRecommendation({
    world: { maps: [route, neighbor] },
    observation,
    objective: {
      id: "reach-blocked-same-region-target",
      target: { kind: "object", map: route.id, index: 0 },
    },
  }), null);
});

test("same-region local blockage never turns a leave-and-return warp into progress", () => {
  const corridorWalls = Object.fromEntries(
    [0, 2].flatMap((y) =>
      Array.from({ length: 5 }, (_, x) => [`${x},${y}`, 1])
    ),
  );
  const route = openMap("MAP_BLOCKED_WARP_ROUTE", {
    width: 5,
    height: 3,
    collisions: corridorWalls,
    behaviors: { "0,1": "MB_LADDER" },
    warpEvents: [{
      x: 0,
      y: 1,
      dest_map: "MAP_WARP_NEIGHBOR",
      dest_warp_id: 0,
    }],
    objectEvents: [
      { x: 3, y: 1, script: "BlockedWarp_EventScript_Target" },
      {
        x: 2,
        y: 1,
        graphics_id: "OBJ_EVENT_GFX_CAMPER",
        script: "BlockedWarp_EventScript_Trainer",
      },
    ],
  });
  const neighbor = openMap("MAP_WARP_NEIGHBOR", {
    width: 5,
    height: 3,
    collisions: corridorWalls,
    behaviors: { "4,1": "MB_LADDER" },
    warpEvents: [{ x: 4, y: 1, dest_map: route.id, dest_warp_id: 0 }],
  });
  const observation = campaignObservation({ map: route.id });
  observation.playerMemory.position = { x: 1, y: 1 };

  assert.equal(campaignNavigationRecommendation({
    world: { maps: [route, neighbor] },
    observation,
    objective: {
      id: "reach-blocked-same-region-warp-target",
      target: { kind: "object", map: route.id, index: 0 },
    },
  }), null);
});

test("the item sweep revisits a proven map after a field move unlocks the item", () => {
  const corridorWalls = Object.fromEntries(
    Array.from({ length: 5 }, (_, y) => [
      [`0,${y}`, 1],
      [`2,${y}`, 1],
    ]).flat(),
  );
  const itemMap = openMap("MAP_PROVEN_ITEM_CAVE", {
    width: 3,
    height: 5,
    collisions: corridorWalls,
    behaviors: { "1,4": "MB_REGULAR_WARP" },
    warpEvents: [{
      x: 1,
      y: 4,
      dest_map: "MAP_PROVEN_CAVE_ENTRANCE",
      dest_warp_id: "0",
    }],
    objectEvents: [{
      x: 1,
      y: 2,
      flag: "0",
      graphics_id: "OBJ_EVENT_GFX_CUT_TREE",
      script: "EventScript_CutTree",
    }],
    backgroundEvents: [{
      x: 1,
      y: 0,
      elevation: 3,
      type: "hidden_item",
      flag: "FLAG_HIDDEN_ITEM_PROVEN_CAVE",
      item: "ITEM_RARE_CANDY",
      quantity: 1,
      underfoot: false,
    }],
  });
  const entrance = openMap("MAP_PROVEN_CAVE_ENTRANCE", {
    width: 3,
    height: 5,
    collisions: corridorWalls,
    behaviors: { "1,0": "MB_REGULAR_WARP" },
    warpEvents: [{
      x: 1,
      y: 0,
      dest_map: itemMap.id,
      dest_warp_id: "0",
    }],
  });
  const world = { data: { maps: [itemMap, entrance] } };
  const planner = createCampaignPlanner({
    campaign: { objectives: [] },
    world,
    story: collectionStory({
      flags: { FLAG_HIDDEN_ITEM_PROVEN_CAVE: 1003 },
      items: { ITEM_RARE_CANDY: 68 },
    }),
  });
  const beforeCut = campaignObservation({
    map: itemMap.id,
    flags: { 1003: false, 2081: false },
  });
  beforeCut.playerMemory.position = { x: 1, y: 3 };
  assert.equal(planner.selectCollection(beforeCut), null);

  const freshPlanner = createCampaignPlanner({
    campaign: { objectives: [] },
    world,
    story: collectionStory({
      flags: { FLAG_HIDDEN_ITEM_PROVEN_CAVE: 1003 },
      items: { ITEM_RARE_CANDY: 68 },
    }),
  });
  const afterCut = campaignObservation({
    map: entrance.id,
    flags: { 1003: false, 2081: true },
    party: [{ slot: 0, species: 46, level: 20, hp: 50, moves: [15] }],
  });
  afterCut.playerMemory.position = { x: 1, y: 1 };
  assert.equal(freshPlanner.selectCollection(afterCut), null);

  const unlocked = planner.selectCollection(afterCut);
  assert.equal(unlocked?.id, "collect:MAP_PROVEN_ITEM_CAVE:hidden:0");
  assert.equal(
    campaignNavigationRecommendation({ world, observation: afterCut, objective: unlocked })?.targetMap,
    itemMap.id,
  );
});

test("a renewable hidden-item flag cannot make one location mandatory twice", () => {
  const map = openMap("MAP_RENEWABLE_ITEM", {
    backgroundEvents: [{
      x: 2,
      y: 2,
      elevation: 3,
      type: "hidden_item",
      flag: "FLAG_HIDDEN_ITEM_RENEWABLE_BERRY",
      item: "ITEM_ORAN_BERRY",
      quantity: 1,
      underfoot: false,
    }],
  });
  const plannerOptions = {
    campaign: { objectives: [] },
    world: { data: { maps: [map] } },
    story: collectionStory({
      flags: { FLAG_HIDDEN_ITEM_RENEWABLE_BERRY: 1004 },
      items: { ITEM_ORAN_BERRY: 139 },
    }),
  };
  const planner = createCampaignPlanner(plannerOptions);
  const observation = campaignObservation({ map: map.id, flags: { 1004: true } });
  observation.playerMemory.position = { x: 2, y: 3 };
  assert.equal(planner.selectCollection(observation), null);

  observation.playerMemory.storyState.flagIds[1004] = false;
  assert.equal(planner.selectCollection(observation), null);
  assert.deepEqual(planner.collectionProgress(observation), {
    total: 1,
    collected: 1,
    remaining: 0,
    visible: 0,
    hidden: 1,
    underfoot: 0,
    provenMaps: 1,
  });
  const restored = createCampaignPlanner({ ...plannerOptions,
    initialState: JSON.parse(JSON.stringify(planner.state())),
  });
  assert.equal(restored.selectCollection(observation), null,
    "restarting must not forget a renewable location was already collected");
});

test("a full bag pocket defers a new item without blocking an existing stack", () => {
  const map = openMap("MAP_FULL_BAG_ITEM", {
    objectEvents: [{
      x: 2,
      y: 2,
      flag: "FLAG_HIDE_FULL_BAG_POTION",
      graphics_id: "OBJ_EVENT_GFX_ITEM_BALL",
      script: "FullBag_EventScript_Potion",
    }],
  });
  const world = { data: { maps: [map] } };
  const story = collectionStory({
    flags: { FLAG_HIDE_FULL_BAG_POTION: 1005 },
    items: { ITEM_POTION: 13 },
    scripts: [{
      label: "FullBag_EventScript_Potion",
      instructions: [{ op: "finditem", args: ["ITEM_POTION"] }],
    }],
  });
  const fullItems = Array.from({ length: 42 }, (_, index) => ({
    itemId: index + 14,
    quantity: 1,
  }));
  const planner = createCampaignPlanner({
    campaign: { objectives: [] },
    world,
    story,
  });
  const observation = campaignObservation({ map: map.id, flags: { 1005: false } });
  observation.playerMemory.position = { x: 2, y: 3 };
  observation.playerMemory.trainer.bag = { items: fullItems };

  assert.equal(planner.selectCollection(observation), null);

  observation.playerMemory.trainer.bag.items.pop();
  assert.equal(planner.selectCollection(observation)?.itemId, 13);

  const stackingPlanner = createCampaignPlanner({
    campaign: { objectives: [] },
    world,
    story,
  });
  observation.playerMemory.trainer.bag.items = [
    { itemId: 13, quantity: 1 },
    ...fullItems.slice(0, 41),
  ];
  assert.equal(observation.playerMemory.trainer.bag.items.length, 42);
  assert.equal(stackingPlanner.selectCollection(observation)?.itemId, 13);
});

test("underfoot hidden items require the Itemfinder and exact-tile routing", () => {
  const map = openMap("MAP_UNDERFOOT_ITEM", {
    backgroundEvents: [{
      x: 3,
      y: 2,
      elevation: 3,
      type: "hidden_item",
      flag: "FLAG_HIDDEN_ITEM_LEFTOVERS",
      item: "ITEM_LEFTOVERS",
      quantity: 1,
      underfoot: true,
    }],
  });
  const world = { data: { maps: [map] } };
  const planner = createCampaignPlanner({
    campaign: { objectives: [] },
    world,
    story: collectionStory({
      flags: { FLAG_HIDDEN_ITEM_LEFTOVERS: 1002 },
      items: { ITEM_LEFTOVERS: 200, ITEM_ITEMFINDER: 261 },
    }),
  });
  const observation = campaignObservation({ map: map.id, flags: { 1002: false } });
  observation.playerMemory.position = { x: 1, y: 2 };
  observation.playerMemory.trainer.bag = { keyItems: [] };

  assert.equal(planner.selectCollection(observation), null);

  observation.playerMemory.trainer.bag.keyItems.push({ itemId: 261, quantity: 1 });
  const objective = planner.selectCollection(observation);
  const firstStep = campaignNavigationRecommendation({ world, observation, objective });
  assert.equal(objective?.target.kind, "itemfinder");
  assert.equal(firstStep?.kind, "move-toward");
  assert.equal(firstStep?.direction, "east");

  observation.playerMemory.position = { x: 3, y: 2 };
  assert.deepEqual(
    campaignNavigationRecommendation({ world, observation, objective }),
    {
      kind: "use-itemfinder",
      objective: objective.id,
      targetMap: map.id,
      target: {
        kind: "itemfinder",
        index: 0,
        x: 3,
        y: 2,
        itemId: 200,
      },
    },
  );
});

test("a party-roster objective routes to and operates the Pokemon Center PC", () => {
  const center = openMap("MAP_CERULEAN_CITY_POKEMON_CENTER_1F", {
    width: 7,
    height: 5,
    behaviors: { "3,1": "MB_PC" },
    collisions: { "3,1": 1 },
  });
  const observed = campaignObservation({ map: center.id });
  const objective = {
    id: "ensure-misty-counter-party",
    target: {
      kind: "party-roster",
      map: center.id,
      requiredFamilies: [[43, 44, 45]],
    },
  };
  observed.playerMemory.position = { x: 3, y: 3 };

  assert.deepEqual(campaignNavigationRecommendation({
    world: { maps: [center] }, observation: observed, objective,
  }), {
    kind: "move-toward",
    direction: "north",
    objective: "ensure-misty-counter-party",
    targetMap: center.id,
    target: { kind: "party-roster", x: 3, y: 1 },
    remainingSteps: 1,
  });

  observed.playerMemory.position = { x: 3, y: 2 };
  assert.deepEqual(campaignNavigationRecommendation({
    world: { maps: [center] }, observation: observed, objective,
  }), {
    kind: "interact-with-background",
    direction: "north",
    objective: "ensure-misty-counter-party",
    targetMap: center.id,
    target: { kind: "party-roster", x: 3, y: 1 },
    remainingSteps: 0,
  });
});

test("same-map teleport pads route between disconnected rooms", () => {
  const collisions = Object.fromEntries(
    Array.from({ length: 5 }, (_, y) => [`3,${y}`, 1]),
  );
  const gym = openMap("MAP_TELEPORT_GYM", {
    width: 7,
    height: 5,
    collisions,
    behaviors: {
      "1,1": "MB_LADDER",
      "5,1": "MB_LADDER",
    },
    warpEvents: [
      { x: 1, y: 1, dest_map: "MAP_TELEPORT_GYM", dest_warp_id: 1 },
      { x: 5, y: 1, dest_map: "MAP_TELEPORT_GYM", dest_warp_id: 0 },
    ],
    objectEvents: [{ x: 5, y: 3, script: "Gym_EventScript_Leader" }],
  });
  const observation = campaignObservation({ map: gym.id });
  observation.playerMemory.position = { x: 1, y: 2 };

  assert.deepEqual(campaignNavigationRecommendation({
    world: { maps: [gym] },
    observation,
    objective: {
      id: "badge-teleport",
      target: { kind: "object", map: gym.id, index: 0 },
    },
  }), {
    kind: "move-toward",
    direction: "north",
    objective: "badge-teleport",
    targetMap: gym.id,
    transit: {
      kind: "warp",
      destinationMap: gym.id,
      x: 1,
      y: 1,
    },
    remainingSteps: 1,
  });
});

test("a disconnected hidden item keeps routing through the world graph", () => {
  const collisions = Object.fromEntries(
    Array.from({ length: 5 }, (_, y) => [`3,${y}`, 1]),
  );
  const city = openMap("MAP_SPLIT_CITY", {
    width: 7,
    height: 5,
    collisions,
    behaviors: {
      "1,1": "MB_LADDER",
      "5,1": "MB_LADDER",
    },
    warpEvents: [
      { x: 1, y: 1, dest_map: "MAP_SPLIT_CITY", dest_warp_id: 1 },
      { x: 5, y: 1, dest_map: "MAP_SPLIT_CITY", dest_warp_id: 0 },
    ],
    backgroundEvents: [{
      x: 5,
      y: 3,
      elevation: 3,
      type: "hidden_item",
      flag: "FLAG_HIDDEN_ITEM_SPLIT_CITY",
      item: "ITEM_RARE_CANDY",
      quantity: 1,
      underfoot: false,
    }],
  });
  const world = { data: { maps: [city] } };
  const planner = createCampaignPlanner({
    campaign: { objectives: [] },
    world,
    story: collectionStory({
      flags: { FLAG_HIDDEN_ITEM_SPLIT_CITY: 1004 },
      items: { ITEM_RARE_CANDY: 68 },
    }),
  });
  const observation = campaignObservation({
    map: city.id,
    flags: { 1004: false },
  });
  observation.playerMemory.position = { x: 1, y: 2 };
  const objective = planner.selectCollection(observation);

  assert.equal(objective?.id, "collect:MAP_SPLIT_CITY:hidden:0");
  assert.deepEqual(campaignNavigationRecommendation({
    world,
    observation,
    objective,
  }), {
    kind: "move-toward",
    direction: "north",
    objective: "collect:MAP_SPLIT_CITY:hidden:0",
    targetMap: city.id,
    transit: {
      kind: "warp",
      destinationMap: city.id,
      x: 1,
      y: 1,
    },
    remainingSteps: 1,
  });
});

test("a disconnected Itemfinder target keeps routing through the world graph", () => {
  const collisions = Object.fromEntries(
    Array.from({ length: 5 }, (_, y) => [`3,${y}`, 1]),
  );
  const city = openMap("MAP_SPLIT_ITEMFINDER_CITY", {
    width: 7,
    height: 5,
    collisions,
    behaviors: {
      "1,1": "MB_LADDER",
      "5,1": "MB_LADDER",
    },
    warpEvents: [
      { x: 1, y: 1, dest_map: "MAP_SPLIT_ITEMFINDER_CITY", dest_warp_id: 1 },
      { x: 5, y: 1, dest_map: "MAP_SPLIT_ITEMFINDER_CITY", dest_warp_id: 0 },
    ],
    backgroundEvents: [{
      x: 5,
      y: 3,
      elevation: 3,
      type: "hidden_item",
      flag: "FLAG_HIDDEN_ITEM_SPLIT_ITEMFINDER_CITY",
      item: "ITEM_RARE_CANDY",
      quantity: 1,
      underfoot: true,
    }],
  });
  const world = { data: { maps: [city] } };
  const planner = createCampaignPlanner({
    campaign: { objectives: [] },
    world,
    story: collectionStory({
      flags: { FLAG_HIDDEN_ITEM_SPLIT_ITEMFINDER_CITY: 1005 },
      items: { ITEM_RARE_CANDY: 68 },
    }),
  });
  const observation = campaignObservation({
    map: city.id,
    flags: { 1005: false },
    bag: { keyItems: [{ itemId: 261, quantity: 1 }] },
  });
  observation.playerMemory.position = { x: 1, y: 2 };
  const objective = planner.selectCollection(observation);

  assert.equal(objective?.id, "collect:MAP_SPLIT_ITEMFINDER_CITY:hidden:0");
  assert.equal(objective?.target.kind, "itemfinder");
  assert.deepEqual(campaignNavigationRecommendation({
    world,
    observation,
    objective,
  }), {
    kind: "move-toward",
    direction: "north",
    objective: "collect:MAP_SPLIT_ITEMFINDER_CITY:hidden:0",
    targetMap: city.id,
    transit: {
      kind: "warp",
      destinationMap: city.id,
      x: 1,
      y: 1,
    },
    remainingSteps: 1,
  });
});

test("disconnected same-map objectives retain their proven region transition", async (t) => {
  const collisions = {
    ...Object.fromEntries(Array.from({ length: 5 }, (_, y) => [`3,${y}`, 1])),
    "5,3": 1,
  };
  const map = openMap("MAP_SPLIT_OBJECTIVE_CITY", {
    width: 7,
    height: 5,
    collisions,
    behaviors: {
      "1,1": "MB_LADDER",
      "5,1": "MB_LADDER",
      "5,3": "MB_PC",
      "6,4": "MB_REGULAR_WARP",
    },
    encounters: {
      "5,2": 1,
      "6,2": 1,
    },
    warpEvents: [
      { x: 1, y: 1, dest_map: "MAP_SPLIT_OBJECTIVE_CITY", dest_warp_id: 1 },
      { x: 5, y: 1, dest_map: "MAP_SPLIT_OBJECTIVE_CITY", dest_warp_id: 0 },
      { x: 6, y: 4, dest_map: "MAP_UNUSED_TARGET", dest_warp_id: 0 },
    ],
    coordEvents: [{ x: 6, y: 3, script: "SplitObjective_EventScript_Trigger" }],
  });
  const world = { maps: [map] };
  const observation = campaignObservation({ map: map.id });
  observation.playerMemory.position = { x: 1, y: 2 };
  const cases = [
    { id: "roster", target: { kind: "party-roster", map: map.id } },
    { id: "fund-activation", target: { kind: "vs-seeker-activation", map: map.id, x: 5, y: 2 } },
    { id: "fund-recharge", target: { kind: "vs-seeker-recharge", map: map.id, x: 5, y: 2 } },
    { id: "training", target: { kind: "encounter-zone", map: map.id } },
    { id: "indexed-warp", target: { kind: "warp", map: map.id, index: 2 } },
    { id: "coordinate-trigger", target: { kind: "trigger", map: map.id, index: 0 } },
  ];

  for (const objective of cases) {
    await t.test(objective.target.kind, () => {
      assert.deepEqual(campaignNavigationRecommendation({
        world,
        observation,
        objective,
      }), {
        kind: "move-toward",
        direction: "north",
        objective: objective.id,
        targetMap: map.id,
        transit: {
          kind: "warp",
          destinationMap: map.id,
          x: 1,
          y: 1,
        },
        remainingSteps: 1,
      });
    });
  }
});

test("Volcano Badge preparation trains Lapras instead of accepting an unrelated high-level anchor", () => {
  const objective = MAIN_STORY_CAMPAIGN.objectives.find(
    ({ id }) => id === "badge-volcano",
  );
  const world = {
    maps: [openMap("MAP_CINNABAR_ISLAND_GYM", {
      objectEvents: Array.from({ length: 8 }, (_, index) => ({
        x: index === 7 ? 3 : 1,
        y: index === 7 ? 3 : 1,
        script: index === 7 ? "CinnabarIsland_Gym_EventScript_Blaine" : null,
      })),
      encounters: { "1,1": 1, "2,1": 1 },
      behaviors: { "1,1": "MB_TALL_GRASS", "2,1": "MB_TALL_GRASS" },
    })],
    wildEncounters: [{
      map: "MAP_CINNABAR_ISLAND_GYM",
      land_mons: {
        encounter_rate: 21,
        mons: [{ min_level: 24, max_level: 28, species: "SPECIES_KOFFING" }],
      },
    }],
  };
  const observation = campaignObservation({
    map: "MAP_CINNABAR_ISLAND_GYM",
    party: [
      { slot: 0, species: 3, level: 56, hp: 162, moves: [290, 235, 70, 15] },
      { slot: 1, species: 131, level: 26, hp: 109, moves: [57, 34, 109, 195] },
    ],
  });
  observation.playerMemory.position = { x: 2, y: 2 };

  const training = selectTrainingObjective({ world, observation, objective });

  assert.equal(objective.minimumCoreLevel, 45);
  assert.deepEqual(objective.coreSpecies, [131]);
  assert.equal(training?.trainingPartySlot, 1);
  assert.equal(training?.trainingSpecies, 131);
  assert.equal(training?.currentTeamAnchorLevel, 26);
});

test("role-based training uses an active trainee beside the EXP Share holder", () => {
  const route = openMap("MAP_LEAGUE_TRAINING", {
    encounters: { "1,1": 1, "2,1": 1 },
    behaviors: { "1,1": "MB_TALL_GRASS", "2,1": "MB_TALL_GRASS" },
  });
  const observation = campaignObservation({
    map: route.id,
    party: [
      { slot: 0, species: 6, level: 74, hp: 210, maxHp: 210, heldItem: 0, moves: [53] },
      { slot: 1, species: 131, level: 60, hp: 210, maxHp: 210, heldItem: 182, moves: [57] },
      { slot: 2, species: 135, level: 62, hp: 150, maxHp: 150, heldItem: 0, moves: [86] },
      { slot: 3, species: 85, level: 70, hp: 160, maxHp: 160, heldItem: 0, moves: [65] },
      { slot: 4, species: 123, level: 70, hp: 170, maxHp: 170, heldItem: 0, moves: [206] },
      { slot: 5, species: 53, level: 70, hp: 150, maxHp: 150, heldItem: 0, moves: [44] },
    ],
  });
  observation.playerMemory.position = { x: 1, y: 1 };

  const training = selectTrainingObjective({
    world: {
      maps: [route],
      wildEncounters: [{
        map: route.id,
        land_mons: {
          encounter_rate: 25,
          mons: [{ min_level: 38, max_level: 40, species: "SPECIES_MACHOKE" }],
        },
      }],
    },
    observation,
    objective: {
      id: "elite-four-lorelei",
      importantBattle: true,
      target: { kind: "object", map: route.id, index: 0 },
      starterBattleFamily: [4, 5, 6],
      starterBattleTargetLevel: 75,
      supportBattleTargetLevel: 70,
      enemyAceLevel: 54,
      enemyPartySize: 5,
      minimumReadyBattleMembers: 6,
      minimumBattlePartySize: 6,
    },
  });

  assert.equal(training?.trainingPartySlot, 2);
  assert.equal(training?.expSharePartySlot, 1);
  assert.deepEqual(training?.trainingPartySlots, [2, 1]);
  assert.equal(training?.minimumTeamAnchorLevel, 70);
});

function vsSeekerCatalogEntry({
  index,
  baseId,
  rematchId,
  expectedExperience,
  expectedPayout,
  maximumLevel = 25,
  map,
}) {
  return {
    id: baseId,
    name: `TRAINER_BATCH_BASE_${baseId}`,
    displayName: `BATCH ${baseId}`,
    flagId: 0x500 + baseId,
    minimumLevel: maximumLevel,
    maximumLevel,
    partySize: 1,
    localId: index + 1,
    target: { kind: "object", map, index },
    rematchParties: [null, {
      id: rematchId,
      name: `TRAINER_BATCH_REMATCH_${rematchId}`,
      displayName: `BATCH ${baseId}`,
      flagId: 0x500 + rematchId,
      minimumLevel: maximumLevel,
      maximumLevel,
      partySize: 1,
      expectedExperience,
      expectedPayout,
    }],
  };
}

function readyVsSeekerObservation({ map, flags, position = { x: 1, y: 4 } }) {
  const observation = campaignObservation({
    map,
    flags: { 658: true, ...flags },
    bag: { keyItems: [{ itemId: 362, quantity: 1 }] },
    party: [{
      slot: 0,
      species: 6,
      level: 50,
      hp: 150,
      maxHp: 150,
      moves: [53],
    }],
  });
  observation.playerMemory.position = position;
  observation.playerMemory.vsSeeker = {
    batterySteps: 100,
    responseClearSteps: 0,
    rematchEntries: Array(100).fill(0),
  };
  return observation;
}

function dividedVsSeekerRoute() {
  const route=openMap('MAP_DIVIDED_REMATCH_ROUTE',{width:9,height:7,
    objectEvents:[{x:3,y:5},{x:6,y:1}],
    connections:[{direction:'east',map:'MAP_REMATCH_DETOUR',offset:0}]});
  for(const cell of route.layout.cells)if(cell.y===3)cell.collision=1;
  const detour=openMap('MAP_REMATCH_DETOUR',{width:4,height:7,
    connections:[{direction:'west',map:route.id,offset:0}]});
  const trainerCatalog=[9000,1000].map((expectedExperience,index)=>vsSeekerCatalogEntry({
    index,baseId:41+10*index,rematchId:42+10*index,expectedExperience,expectedPayout:1000,map:route.id}));
  const observation=readyVsSeekerObservation({map:route.id,position:{x:1,y:1},
    flags:Object.fromEntries(trainerCatalog.flatMap(t=>[[t.flagId,true],[t.rematchParties[1].flagId,false]]))});
  const objective={id:'prepare-league',target:{kind:'map-arrival',map:route.id,x:1,y:1},minimumTeamAnchorLevel:70};
  return {world:{maps:[route,detour]},observation,objective,trainerCatalog};
}

test('VS Seeker activation reaches the trainers side of a barrier before scanning',()=>{
  const fixture=dividedVsSeekerRoute();
  const selected=selectTrainingObjective(fixture);
  assert.equal(selected?.target.kind,'vs-seeker-activation');
  assert.ok(selected.target.y>=4,'a trainer visible over a wall cannot be reached without erasing its response');
  assert.deepEqual(selected.vsSeekerBatch.localIds,[1],'score only the batch reachable from its activation side');
});

test('VS Seeker responses prioritize reachable trainers over a richer response across a barrier',()=>{
  const fixture=dividedVsSeekerRoute();
  fixture.observation.playerMemory.vsSeeker.batterySteps=0;
  fixture.observation.playerMemory.vsSeeker.rematchEntries[1]=1;
  fixture.observation.playerMemory.vsSeeker.rematchEntries[2]=1;
  const selected=selectTrainingObjective(fixture);
  assert.equal(selected?.id,'finish-vs-seeker-response-batch');
  assert.equal(selected.target.index,1,'stay on this map and battle the accessible responder first');
  assert.equal(selected.responseBatchRemaining,1);
  fixture.observation.playerMemory.vsSeeker.rematchEntries[2]=0;
  const next=selectTrainingObjective(fixture);
  assert.equal(next?.target.kind,'vs-seeker-recharge');
  assert.ok(next.target.y>=4,'relocate to a usable activation position once the remaining response needs a map transition');
});

test('VS Seeker response travel must finish before the cartridge clears the response',()=>{
  const fixture=dividedVsSeekerRoute();
  fixture.observation.playerMemory.vsSeeker.batterySteps=0;
  fixture.observation.playerMemory.vsSeeker.rematchEntries[2]=1;
  fixture.observation.playerMemory.vsSeeker.responseClearSteps=96;
  const selected=selectTrainingObjective(fixture);
  assert.notEqual(selected?.id,'finish-vs-seeker-response-batch','the four-step approach would expire the remaining response');
  assert.equal(selected?.target.kind,'vs-seeker-recharge');
});

test('VS Seeker activation allows a local one-way ledge approach that preserves responses',()=>{
  const route=openMap('MAP_LEDGE_REMATCH_ROUTE',{width:7,height:6,objectEvents:[{x:3,y:4}]});
  for(const cell of route.layout.cells)if(cell.y===2) {
    cell.collision=1;
    if(cell.x===2)cell.behaviorName='MB_JUMP_SOUTH';
  }
  const trainer=vsSeekerCatalogEntry({index:0,baseId:41,rematchId:42,
    expectedExperience:9000,expectedPayout:1000,map:route.id});
  const observation=readyVsSeekerObservation({map:route.id,position:{x:2,y:1},
    flags:{[trainer.flagId]:true,[trainer.rematchParties[1].flagId]:false}});
  const selected=selectTrainingObjective({world:{maps:[route]},observation,trainerCatalog:[trainer],
    objective:{id:'prepare-league',target:{kind:'map-arrival',map:route.id,x:2,y:1},minimumTeamAnchorLevel:70}});
  assert.deepEqual(selected?.target,{kind:'vs-seeker-activation',map:route.id,x:2,y:1});
});

test('VS Seeker follows the observed moving trainer instead of its original or persisted position',()=>{
  const route=openMap('MAP_MOVING_REMATCH_ROUTE',{width:30,height:12,objectEvents:[{x:12,y:6}]});
  const trainer=vsSeekerCatalogEntry({index:0,baseId:41,rematchId:42,
    expectedExperience:9000,expectedPayout:1000,map:route.id});
  const observation=readyVsSeekerObservation({map:route.id,position:{x:16,y:6},
    flags:{[trainer.flagId]:true,[trainer.rematchParties[1].flagId]:false}});
  observation.playerMemory.objectEventTemplates=[{localId:1,current:{x:12,y:6}}];
  observation.playerMemory.objectEvents=[{localId:1,map:{id:route.id},current:{x:8,y:6}}];
  const fixture={world:{maps:[route]},observation,trainerCatalog:[trainer],
    objective:{id:'prepare-league',target:{kind:'map-arrival',map:route.id,x:16,y:6},minimumTeamAnchorLevel:70}};
  let selected=selectTrainingObjective(fixture);
  assert.equal(selected?.target.kind,'vs-seeker-activation');
  assert.ok(Math.abs(selected.target.x-8)<=7,'the anchor must reach the moving trainer');
  assert.notDeepEqual(selected.target,{kind:'vs-seeker-activation',map:route.id,x:16,y:6});
  observation.playerMemory.position={x:selected.target.x,y:selected.target.y};
  observation.playerMemory.objectEvents[0].current={x:25,y:6};
  selected=selectTrainingObjective(fixture);
  assert.ok(Math.abs(selected.target.x-25)<=7,'re-observe movement rather than retain a stale anchor');
  observation.playerMemory.objectEvents=[{localId:1,map:{id:'MAP_OTHER'},current:{x:8,y:6}}];
  observation.playerMemory.objectEventTemplates=[{localId:1,current:{x:23,y:6}}];
  selected=selectTrainingObjective(fixture);
  assert.ok(Math.abs(selected.target.x-23)<=7,'approach an unloaded trainer using its persisted position; ignore foreign-map IDs');
});

test("VS Seeker activation maximizes the complete visible experience batch", () => {
  const route = openMap("MAP_BATCH_ROUTE", {
    width: 32,
    height: 9,
    objectEvents: [
      { x: 4, y: 4 },
      { x: 22, y: 4 },
      { x: 24, y: 4 },
    ],
  });
  const trainerCatalog = [
    vsSeekerCatalogEntry({
      index: 0,
      baseId: 41,
      rematchId: 42,
      expectedExperience: 9000,
      expectedPayout: 1000,
      map: route.id,
    }),
    vsSeekerCatalogEntry({
      index: 1,
      baseId: 51,
      rematchId: 52,
      expectedExperience: 6000,
      expectedPayout: 1000,
      map: route.id,
    }),
    vsSeekerCatalogEntry({
      index: 2,
      baseId: 61,
      rematchId: 62,
      expectedExperience: 6000,
      expectedPayout: 1000,
      map: route.id,
    }),
  ];
  const observation = readyVsSeekerObservation({
    map: route.id,
    flags: Object.fromEntries(trainerCatalog.flatMap((trainer) => [
      [trainer.flagId, true],
      [trainer.rematchParties[1].flagId, false],
    ])),
  });

  const training = selectTrainingObjective({
    world: { maps: [route] },
    observation,
    objective: {
      id: "prepare-league",
      target: { kind: "map-arrival", map: route.id, x: 1, y: 4 },
      minimumTeamAnchorLevel: 70,
    },
    trainerCatalog,
  });

  assert.equal(training?.target.kind, "vs-seeker-activation");
  assert.ok(Math.abs(Number(training?.target.x) - 22) <= 7);
  assert.ok(Math.abs(Number(training?.target.x) - 24) <= 7);
  assert.ok(Math.abs(Number(training?.target.x) - 4) > 7);
  assert.equal(training?.vsSeekerBatch.responderCount, 2);
  assert.equal(training?.vsSeekerBatch.expectedExperience, 12000);
  assert.deepEqual(training?.vsSeekerBatch.localIds, [2, 3]);
});

test("VS Seeker activation breaks equal-experience batches by exact payout", () => {
  const route = openMap("MAP_PAYOUT_ROUTE", {
    width: 28,
    height: 9,
    objectEvents: [{ x: 4, y: 4 }, { x: 22, y: 4 }],
  });
  const trainerCatalog = [
    vsSeekerCatalogEntry({
      index: 0,
      baseId: 41,
      rematchId: 42,
      expectedExperience: 7000,
      expectedPayout: 800,
      map: route.id,
    }),
    vsSeekerCatalogEntry({
      index: 1,
      baseId: 51,
      rematchId: 52,
      expectedExperience: 7000,
      expectedPayout: 5000,
      map: route.id,
    }),
  ];
  const observation = readyVsSeekerObservation({
    map: route.id,
    flags: Object.fromEntries(trainerCatalog.flatMap((trainer) => [
      [trainer.flagId, true],
      [trainer.rematchParties[1].flagId, false],
    ])),
  });

  const training = selectTrainingObjective({
    world: { maps: [route] },
    observation,
    objective: {
      id: "prepare-league",
      target: { kind: "map-arrival", map: route.id, x: 1, y: 4 },
      minimumTeamAnchorLevel: 70,
    },
    trainerCatalog,
  });

  assert.equal(training?.trainer.id, 52);
  assert.equal(training?.vsSeekerBatch.expectedPayout, 5000);
});

test("VS Seeker activation breaks equal-value batches by access to free healing", () => {
  const west = openMap("MAP_BATCH_WEST", {
    width: 9,
    height: 9,
    connections: [{ direction: "right", map: "MAP_BATCH_HUB", offset: 0 }],
    objectEvents: [{ x: 4, y: 4 }],
  });
  const hub = openMap("MAP_BATCH_HUB", {
    width: 9,
    height: 9,
    connections: [
      { direction: "left", map: west.id, offset: 0 },
      { direction: "right", map: "MAP_BATCH_EAST", offset: 0 },
    ],
  });
  const east = openMap("MAP_BATCH_EAST", {
    width: 9,
    height: 9,
    connections: [{ direction: "left", map: hub.id, offset: 0 }],
    warpEvents: [{
      x: 2,
      y: 2,
      dest_map: "MAP_BATCH_EAST_POKEMON_CENTER_1F",
      dest_warp_id: 0,
    }],
    behaviors: { "2,2": "MB_WARP_DOOR" },
    objectEvents: [{ x: 4, y: 4 }],
  });
  const center = openMap("MAP_BATCH_EAST_POKEMON_CENTER_1F", {
    width: 5,
    height: 5,
    warpEvents: [{ x: 2, y: 4, dest_map: east.id, dest_warp_id: 0 }],
    behaviors: { "2,4": "MB_SOUTH_ARROW_WARP" },
    objectEvents: [{
      x: 2,
      y: 1,
      script: "BatchEast_PokemonCenter_1F_EventScript_Nurse",
    }],
  });
  const trainerCatalog = [
    vsSeekerCatalogEntry({
      index: 0,
      baseId: 41,
      rematchId: 42,
      expectedExperience: 7000,
      expectedPayout: 2000,
      map: west.id,
    }),
    vsSeekerCatalogEntry({
      index: 0,
      baseId: 51,
      rematchId: 52,
      expectedExperience: 7000,
      expectedPayout: 2000,
      map: east.id,
    }),
  ];
  const observation = readyVsSeekerObservation({
    map: hub.id,
    position: { x: 4, y: 4 },
    flags: Object.fromEntries(trainerCatalog.flatMap((trainer) => [
      [trainer.flagId, true],
      [trainer.rematchParties[1].flagId, false],
    ])),
  });

  const training = selectTrainingObjective({
    world: { maps: [west, hub, east, center] },
    observation,
    objective: {
      id: "prepare-league",
      target: { kind: "map-arrival", map: hub.id, x: 4, y: 4 },
      minimumTeamAnchorLevel: 70,
    },
    trainerCatalog,
  });

  assert.equal(training?.target.map, east.id);
  assert.equal(training?.vsSeekerBatch.healerTransitions, 1);
});

test("VS Seeker training recharges locally, activates, and battles cartridge rematches", () => {
  const route = openMap("MAP_ROUTE11", {
    objectEvents: [{
      x: 3,
      y: 2,
      trainer_type: "TRAINER_TYPE_NORMAL",
      script: "Route11_EventScript_Trainer",
    }],
    encounters: { "1,1": 1, "2,1": 1 },
    behaviors: { "1,1": "MB_TALL_GRASS", "2,1": "MB_TALL_GRASS" },
  });
  const world = { maps: [route], wildEncounters: [{
    map: route.id,
    land_mons: {
      encounter_rate: 25,
      mons: [{ min_level: 20, max_level: 22, species: "SPECIES_DROWZEE" }],
    },
  }] };
  const story = {
    symbols: { trainers: { TRAINER_BASE: { value: 41 } } },
    scripts: [{
      label: "Route11_EventScript_Trainer",
      instructions: [{
        op: "trainerbattle_single",
        args: ["TRAINER_BASE", "intro", "defeat"],
      }],
    }],
  };
  const mechanics = { species: [{
    id: 96,
    name: "SPECIES_DROWZEE",
    expYield: 102,
  }], trainers: [
    {
      id: 41,
      name: "TRAINER_BASE",
      trainerName: "EDDIE",
      party: [{ lvl: 20, species: "SPECIES_DROWZEE" }],
    },
    {
      id: 42,
      name: "TRAINER_REMATCH",
      trainerName: "EDDIE",
      trainerClass: "TRAINER_CLASS_LADY",
      party: [
        { lvl: 35, species: "SPECIES_DROWZEE" },
        { lvl: 35, species: "SPECIES_DROWZEE" },
      ],
    },
  ], rematches: [{
    map: route.id,
    trainerNames: ["TRAINER_BASE", "TRAINER_REMATCH"],
    trainerIds: [41, 42],
  }] };
  const planner = createCampaignPlanner({
    campaign: { objectives: [{
      id: "league",
      target: { kind: "object", map: route.id, index: 0 },
      completion: { kind: "flag-set", id: 9999 },
    }] },
    world,
    story,
    mechanics,
  });
  const observation = campaignObservation({
    map: route.id,
    flags: {
      658: true,
      [0x500 + 41]: true,
      [0x500 + 42]: false,
    },
    bag: { keyItems: [{ itemId: 362, quantity: 1 }] },
    party: [{ slot: 0, species: 6, level: 50, hp: 150, maxHp: 150, moves: [53] }],
  });
  observation.playerMemory.position = { x: 1, y: 1 };
  observation.playerMemory.vsSeeker = {
    batterySteps: 20,
    responseClearSteps: 0,
    rematchEntries: Array(100).fill(0),
  };
  const trainingObjective = {
    id: "prepare-league",
    target: { kind: "object", map: route.id, index: 0 },
    minimumTeamAnchorLevel: 70,
  };

  const recharge = planner.selectTraining(observation, trainingObjective);
  assert.equal(recharge?.trainingSource, "vs-seeker-recharge");
  assert.deepEqual(recharge?.target, {
    kind: "vs-seeker-recharge",
    map: route.id,
    x: 1,
    y: 1,
  });
  assert.equal(recharge?.trainer.id, 42);

  observation.playerMemory.vsSeeker.batterySteps = 100;
  const activation = planner.selectTraining(observation, trainingObjective);
  assert.equal(activation?.trainingSource, "vs-seeker");
  assert.equal(activation?.vsSeekerAction, "activate");
  assert.equal(activation?.target.kind, "vs-seeker-activation");
  assert.equal(activation?.trainer.localId, 1);
  assert.equal(activation?.trainer.expectedPayout, 7000);

  observation.playerMemory.vsSeeker.rematchEntries[1] = 1;
  const battle = planner.selectTraining(observation, trainingObjective);
  assert.equal(battle?.vsSeekerAction, "battle");
  assert.equal(battle?.trainer.id, 42);
  assert.ok(planner.storyWatch().flags.includes(0x500 + 42));
});

test("VS Seeker recharge stays with its trainer batch instead of traveling to stronger wild encounters", () => {
  const trainerRoute = openMap("MAP_LOCAL_REMATCH_ROUTE", {
    width: 9,
    height: 9,
    connections: [{ direction: "right", map: "MAP_REMOTE_WILD_ROUTE", offset: 0 }],
    objectEvents: [{ x: 4, y: 4 }],
  });
  const remoteWildRoute = openMap("MAP_REMOTE_WILD_ROUTE", {
    connections: [{ direction: "left", map: trainerRoute.id, offset: 0 }],
    encounters: { "1,1": 1, "2,1": 1 },
    behaviors: { "1,1": "MB_TALL_GRASS", "2,1": "MB_TALL_GRASS" },
  });
  const trainerCatalog = [vsSeekerCatalogEntry({
    index: 0,
    baseId: 41,
    rematchId: 42,
    expectedExperience: 5000,
    expectedPayout: 1000,
    map: trainerRoute.id,
  })];
  const observation = readyVsSeekerObservation({
    map: trainerRoute.id,
    position: { x: 1, y: 4 },
    flags: {
      [trainerCatalog[0].flagId]: true,
      [trainerCatalog[0].rematchParties[1].flagId]: false,
    },
  });
  observation.playerMemory.vsSeeker.batterySteps = 20;

  const training = selectTrainingObjective({
    world: {
      maps: [trainerRoute, remoteWildRoute],
      wildEncounters: [{
        map: remoteWildRoute.id,
        land_mons: {
          encounter_rate: 25,
          mons: [{
            min_level: 35,
            max_level: 35,
            species: "SPECIES_DROWZEE",
          }],
        },
      }],
    },
    mechanics: {
      species: [{
        id: 96,
        name: "SPECIES_DROWZEE",
        expYield: 102,
      }],
    },
    observation,
    objective: {
      id: "prepare-league",
      target: { kind: "map-arrival", map: trainerRoute.id, x: 1, y: 4 },
      minimumTeamAnchorLevel: 70,
    },
    trainerCatalog,
  });

  assert.equal(training?.trainingSource, "vs-seeker-recharge");
  assert.deepEqual(training?.target, {
    kind: "vs-seeker-recharge",
    map: trainerRoute.id,
    x: 1,
    y: 4,
  });
});

test("VS Seeker training immediately follows the trainer that answered the scan", () => {
  const route = openMap("MAP_ROUTE11", {
    objectEvents: [
      {
        x: 3,
        y: 2,
        trainer_type: "TRAINER_TYPE_NORMAL",
        script: "Route11_EventScript_RichTrainer",
      },
      {
        x: 4,
        y: 2,
        trainer_type: "TRAINER_TYPE_NORMAL",
        script: "Route11_EventScript_ReadyTrainer",
      },
    ],
    encounters: { "1,1": 1, "2,1": 1 },
    behaviors: { "1,1": "MB_TALL_GRASS", "2,1": "MB_TALL_GRASS" },
  });
  const world = { maps: [route], wildEncounters: [{
    map: route.id,
    land_mons: {
      encounter_rate: 25,
      mons: [{ min_level: 20, max_level: 22, species: "SPECIES_DROWZEE" }],
    },
  }] };
  const story = {
    symbols: { trainers: {
      TRAINER_RICH_BASE: { value: 41 },
      TRAINER_READY_BASE: { value: 51 },
    } },
    scripts: [
      {
        label: "Route11_EventScript_RichTrainer",
        instructions: [{
          op: "trainerbattle_single",
          args: ["TRAINER_RICH_BASE", "intro", "defeat"],
        }],
      },
      {
        label: "Route11_EventScript_ReadyTrainer",
        instructions: [{
          op: "trainerbattle_single",
          args: ["TRAINER_READY_BASE", "intro", "defeat"],
        }],
      },
    ],
  };
  const mechanics = {
    species: [{ id: 96, name: "SPECIES_DROWZEE", expYield: 102 }],
    trainers: [
      {
        id: 41,
        name: "TRAINER_RICH_BASE",
        trainerName: "RICH",
        party: [{ lvl: 20, species: "SPECIES_DROWZEE" }],
      },
      {
        id: 42,
        name: "TRAINER_RICH_REMATCH",
        trainerName: "RICH",
        party: [
          { lvl: 35, species: "SPECIES_DROWZEE" },
          { lvl: 35, species: "SPECIES_DROWZEE" },
        ],
      },
      {
        id: 51,
        name: "TRAINER_READY_BASE",
        trainerName: "READY",
        party: [{ lvl: 20, species: "SPECIES_DROWZEE" }],
      },
      {
        id: 52,
        name: "TRAINER_READY_REMATCH",
        trainerName: "READY",
        party: [{ lvl: 25, species: "SPECIES_DROWZEE" }],
      },
    ],
    rematches: [
      {
        map: route.id,
        trainerNames: ["TRAINER_RICH_BASE", "TRAINER_RICH_REMATCH"],
        trainerIds: [41, 42],
      },
      {
        map: route.id,
        trainerNames: ["TRAINER_READY_BASE", "TRAINER_READY_REMATCH"],
        trainerIds: [51, 52],
      },
    ],
  };
  const planner = createCampaignPlanner({
    campaign: { objectives: [{
      id: "league",
      target: { kind: "object", map: route.id, index: 0 },
      completion: { kind: "flag-set", id: 9999 },
    }] },
    world,
    story,
    mechanics,
  });
  const observation = campaignObservation({
    map: route.id,
    flags: {
      658: true,
      [0x500 + 41]: true,
      [0x500 + 42]: false,
      [0x500 + 51]: true,
      [0x500 + 52]: false,
    },
    bag: { keyItems: [{ itemId: 362, quantity: 1 }] },
    party: [{ slot: 0, species: 6, level: 50, hp: 150, maxHp: 150, moves: [53] }],
  });
  observation.playerMemory.position = { x: 1, y: 1 };
  observation.playerMemory.vsSeeker = {
    batterySteps: 100,
    responseClearSteps: 0,
    rematchEntries: Array(100).fill(0),
  };
  const trainingObjective = {
    id: "prepare-league",
    target: { kind: "object", map: route.id, index: 0 },
    minimumTeamAnchorLevel: 70,
  };

  const activation = planner.selectTraining(observation, trainingObjective);
  assert.equal(activation?.trainer.id, 42);
  assert.equal(activation?.vsSeekerAction, "activate");

  observation.playerMemory.vsSeeker.batterySteps = 0;
  observation.playerMemory.vsSeeker.rematchEntries[2] = 1;
  const battle = planner.selectTraining(observation, trainingObjective);
  assert.equal(battle?.vsSeekerAction, "battle");
  assert.equal(battle?.trainer.id, 52);
  assert.equal(battle?.trainer.localId, 2);
});

test("VS Seeker response slots stay on the activated map until every responder is battled", () => {
  const route6 = openMap("MAP_ROUTE6", {
    width: 8,
    connections: [{ direction: "right", map: "MAP_ROUTE25", offset: 0 }],
    objectEvents: [
      {}, {}, {}, {},
      {
        x: 3,
        y: 2,
        trainer_type: "TRAINER_TYPE_NORMAL",
        script: "Route6_EventScript_FirstTrainer",
      },
      {
        x: 4,
        y: 2,
        trainer_type: "TRAINER_TYPE_NORMAL",
        script: "Route6_EventScript_SecondTrainer",
      },
    ],
  });
  const route25 = openMap("MAP_ROUTE25", {
    width: 8,
    connections: [{ direction: "left", map: route6.id, offset: 0 }],
    objectEvents: [
      {}, {}, {}, {},
      {
        x: 3,
        y: 2,
        trainer_type: "TRAINER_TYPE_NORMAL",
        script: "Route25_EventScript_RemoteTrainer",
      },
    ],
  });
  const world = { maps: [route6, route25] };
  const story = {
    symbols: { trainers: {
      TRAINER_ROUTE6_FIRST_BASE: { value: 41 },
      TRAINER_ROUTE6_SECOND_BASE: { value: 51 },
      TRAINER_ROUTE25_REMOTE_BASE: { value: 61 },
    } },
    scripts: [
      {
        label: "Route6_EventScript_FirstTrainer",
        instructions: [{
          op: "trainerbattle_single",
          args: ["TRAINER_ROUTE6_FIRST_BASE", "intro", "defeat"],
        }],
      },
      {
        label: "Route6_EventScript_SecondTrainer",
        instructions: [{
          op: "trainerbattle_single",
          args: ["TRAINER_ROUTE6_SECOND_BASE", "intro", "defeat"],
        }],
      },
      {
        label: "Route25_EventScript_RemoteTrainer",
        instructions: [{
          op: "trainerbattle_single",
          args: ["TRAINER_ROUTE25_REMOTE_BASE", "intro", "defeat"],
        }],
      },
    ],
  };
  const party = (size) => Array.from({ length: size }, () => ({
    lvl: 35,
    species: "SPECIES_DROWZEE",
  }));
  const mechanics = {
    species: [{ id: 96, name: "SPECIES_DROWZEE", expYield: 102 }],
    trainers: [
      { id: 41, name: "TRAINER_ROUTE6_FIRST_BASE", party: party(1) },
      { id: 42, name: "TRAINER_ROUTE6_FIRST_REMATCH", party: party(2) },
      { id: 51, name: "TRAINER_ROUTE6_SECOND_BASE", party: party(1) },
      { id: 52, name: "TRAINER_ROUTE6_SECOND_REMATCH", party: party(1) },
      { id: 61, name: "TRAINER_ROUTE25_REMOTE_BASE", party: party(1) },
      { id: 62, name: "TRAINER_ROUTE25_REMOTE_REMATCH", party: party(5) },
    ],
    rematches: [
      {
        map: route6.id,
        trainerNames: [
          "TRAINER_ROUTE6_FIRST_BASE",
          "TRAINER_ROUTE6_FIRST_REMATCH",
        ],
        trainerIds: [41, 42],
      },
      {
        map: route6.id,
        trainerNames: [
          "TRAINER_ROUTE6_SECOND_BASE",
          "TRAINER_ROUTE6_SECOND_REMATCH",
        ],
        trainerIds: [51, 52],
      },
      {
        map: route25.id,
        trainerNames: [
          "TRAINER_ROUTE25_REMOTE_BASE",
          "TRAINER_ROUTE25_REMOTE_REMATCH",
        ],
        trainerIds: [61, 62],
      },
    ],
  };
  const planner = createCampaignPlanner({
    campaign: { objectives: [{
      id: "league",
      target: { kind: "object", map: route6.id, index: 4 },
      completion: { kind: "flag-set", id: 9999 },
    }] },
    world,
    story,
    mechanics,
  });
  const observation = campaignObservation({
    map: route6.id,
    variables: { [0x407d]: 1 },
    flags: {
      658: true,
      [0x500 + 41]: true,
      [0x500 + 42]: false,
      [0x500 + 51]: true,
      [0x500 + 52]: false,
      [0x500 + 61]: true,
      [0x500 + 62]: false,
    },
    bag: { keyItems: [{ itemId: 362, quantity: 1 }] },
    party: [{ slot: 0, species: 6, level: 50, hp: 150, maxHp: 150, moves: [53] }],
  });
  observation.playerMemory.position = { x: 2, y: 2 };
  observation.playerMemory.vsSeeker = {
    batterySteps: 0,
    responseClearSteps: 0,
    rematchEntries: Array(100).fill(0),
  };
  observation.playerMemory.vsSeeker.rematchEntries[5] = 1;
  observation.playerMemory.vsSeeker.rematchEntries[6] = 1;
  const trainingObjective = {
    id: "prepare-league",
    target: { kind: "object", map: route6.id, index: 4 },
    minimumTeamAnchorLevel: 70,
  };

  const first = planner.selectTraining(observation, trainingObjective);
  assert.equal(first?.vsSeekerAction, "battle");
  assert.equal(first?.target.map, route6.id);
  assert.equal(first?.trainer.localId, 5);

  observation.playerMemory.vsSeeker.rematchEntries[5] = 0;
  observation.playerMemory.trainer.party[0].level = 70;
  const second = planner.selectTraining(observation, trainingObjective);
  assert.equal(second?.id, "finish-vs-seeker-response-batch");
  assert.equal(second?.responseBatchRemaining, 1);
  assert.equal(second?.vsSeekerAction, "battle");
  assert.equal(second?.target.map, route6.id);
  assert.equal(second?.trainer.localId, 6);
});

function activeVsSeekerResponseFixture({ rematchLevel = 22 } = {}) {
  const route = openMap("MAP_BALANCED_RESPONSE_ROUTE", {
    width: 8,
    objectEvents: [{
      x: 3,
      y: 2,
      trainer_type: "TRAINER_TYPE_NORMAL",
      script: "BalancedResponseRoute_EventScript_Trainer",
    }],
  });
  const world = { maps: [route] };
  const story = {
    symbols: { trainers: {
      TRAINER_BALANCED_RESPONSE_BASE: { value: 41 },
    } },
    scripts: [{
      label: "BalancedResponseRoute_EventScript_Trainer",
      instructions: [{
        op: "trainerbattle_single",
        args: ["TRAINER_BALANCED_RESPONSE_BASE", "intro", "defeat"],
      }],
    }],
  };
  const mechanics = {
    species: [
      { id: 9, name: "SPECIES_BLASTOISE", expYield: 210 },
      { id: 22, name: "SPECIES_FEAROW", expYield: 155 },
      { id: 50, name: "SPECIES_DIGLETT", expYield: 81 },
    ],
    trainers: [
      {
        id: 41,
        name: "TRAINER_BALANCED_RESPONSE_BASE",
        party: [{ lvl: 14, species: "SPECIES_DIGLETT" }],
      },
      {
        id: 42,
        name: "TRAINER_BALANCED_RESPONSE_REMATCH",
        party: [{ lvl: rematchLevel, species: "SPECIES_DIGLETT" }],
      },
    ],
    rematches: [{
      map: route.id,
      trainerNames: [
        "TRAINER_BALANCED_RESPONSE_BASE",
        "TRAINER_BALANCED_RESPONSE_REMATCH",
      ],
      trainerIds: [41, 42],
    }],
  };
  const planner = createCampaignPlanner({
    campaign: { objectives: [{
      id: "continue-story",
      target: { kind: "object", map: route.id, index: 0 },
      completion: { kind: "flag-set", id: 9999 },
    }] },
    world,
    story,
    mechanics,
  });
  const observation = campaignObservation({
    map: route.id,
    variables: { [0x407d]: 1 },
    flags: {
      658: true,
      [0x500 + 41]: true,
      [0x500 + 42]: false,
    },
    bag: { keyItems: [{ itemId: 362, quantity: 1 }] },
    party: [
      { slot: 0, species: 9, level: 55, hp: 177, maxHp: 177, moves: [55] },
      { slot: 1, species: 50, level: 18, hp: 37, maxHp: 37, moves: [91] },
      { slot: 2, species: 22, level: 25, hp: 73, maxHp: 73, moves: [64] },
    ],
  });
  observation.playerMemory.position = { x: 2, y: 2 };
  observation.playerMemory.vsSeeker = {
    batterySteps: 0,
    responseClearSteps: 0,
    rematchEntries: Array(100).fill(0),
  };
  observation.playerMemory.vsSeeker.rematchEntries[1] = 1;
  const trainingObjective = {
    id: "prepare-boss",
    target: { kind: "object", map: route.id, index: 0 },
    minimumTeamAnchorLevel: 30,
  };
  return { planner, observation, trainingObjective };
}

test("VS Seeker response cleanup trains the lowest healthy squad member", () => {
  const { planner, observation, trainingObjective } =
    activeVsSeekerResponseFixture();

  const training = planner.selectTraining(observation, trainingObjective);

  assert.equal(training?.id, "finish-vs-seeker-response-batch");
  assert.equal(training?.trainingPartySlot, 1);
  assert.equal(training?.trainingSpecies, 50);
});

test('pending VS Seeker responses never interrupt saving or an evolution item transaction', () => {
  const {planner, observation} = activeVsSeekerResponseFixture();
  for (const target of [{kind:'save-game'}, {kind:'give-held-item'}, {kind:'friendship-walk'}]) {
    assert.equal(planner.selectTraining(observation, {id:'finish-evolution',target,identityEvolution:true}), null);
  }
});

test("VS Seeker response cleanup chooses the least-overleveled capable escort", () => {
  const { planner, observation, trainingObjective } =
    activeVsSeekerResponseFixture({ rematchLevel: 22 });

  const training = planner.selectTraining(observation, trainingObjective);

  assert.equal(training?.trainingMethod, "switch");
  assert.equal(training?.escortPartySlot, 2);
  assert.equal(training?.escortSpecies, 22);
});

test("VS Seeker direct cleanup carries a balanced emergency escort", () => {
  const { planner, observation, trainingObjective } =
    activeVsSeekerResponseFixture({ rematchLevel: 18 });

  const training = planner.selectTraining(observation, trainingObjective);

  assert.equal(training?.trainingMethod, undefined);
  assert.equal(training?.escortPartySlot, 2);
  assert.equal(training?.escortSpecies, 22);
});

test("an overlevelled VS Seeker response keeps the same strongest member after a party reorder", () => {
  const { planner, observation, trainingObjective } =
    activeVsSeekerResponseFixture({ rematchLevel: 47 });
  const party = observation.playerMemory.trainer.party;
  for (const member of party) Object.assign(member, { level: 44, personality: member.species, otId: 123 });
  party[1].hp = 30;
  // Neither a direct trainee nor an escort satisfies the level safety margin.
  // Pick the healthiest strongest member, using identity to settle equal scores.
  const first = planner.selectTraining(observation, trainingObjective);
  assert.equal(first?.trainingSpecies, 9);
  observation.playerMemory.trainer.party = [party[2], party[1], party[0]]
    .map((member, slot) => ({ ...member, slot }));
  const reordered = planner.selectTraining(observation, trainingObjective);
  assert.equal(reordered?.trainingSpecies, 9);
  assert.equal(reordered?.trainingPartySlot, 2);
  // Promotion must reach a fixed point, rather than sending the lead back again.
  observation.playerMemory.trainer.party = [party[0], party[1], party[2]];
  assert.equal(planner.selectTraining(observation, trainingObjective)?.trainingPartySlot, 0);
  party[0].hp = 0;
  assert.equal(planner.selectTraining(observation, trainingObjective)?.trainingSpecies, 22);
});

test("matchup-core preparation stays active outside a dynamically opened boss room", () => {
  const gymBarrier = Object.fromEntries(
    Array.from({ length: 5 }, (_, y) => [`2,${y}`, 1]),
  );
  const world = {
    maps: [
      openMap("MAP_ISLAND", {
        connections: [
          { direction: "right", map: "MAP_GYM", offset: 0 },
          { direction: "down", map: "MAP_TRAINING", offset: 0 },
        ],
      }),
      openMap("MAP_GYM", {
        connections: [{ direction: "left", map: "MAP_ISLAND", offset: 0 }],
        collisions: gymBarrier,
        objectEvents: [{ x: 4, y: 2, script: "Gym_EventScript_Leader" }],
      }),
      openMap("MAP_TRAINING", {
        connections: [{ direction: "up", map: "MAP_ISLAND", offset: 0 }],
        encounters: { "1,1": 1, "2,1": 1 },
        behaviors: { "1,1": "MB_TALL_GRASS", "2,1": "MB_TALL_GRASS" },
      }),
    ],
    wildEncounters: [{
      map: "MAP_TRAINING",
      land_mons: {
        encounter_rate: 21,
        mons: [{ min_level: 24, max_level: 28, species: "SPECIES_KOFFING" }],
      },
    }],
  };
  const observation = campaignObservation({
    map: "MAP_ISLAND",
    party: [
      { slot: 0, species: 3, level: 59, hp: 170, moves: [290, 235, 70, 15] },
      { slot: 1, species: 131, level: 27, hp: 113, moves: [57, 34, 109, 195] },
    ],
  });
  observation.playerMemory.position = { x: 2, y: 2 };

  const training = selectTrainingObjective({
    world,
    observation,
    objective: {
      id: "badge-volcano",
      target: { kind: "object", map: "MAP_GYM", index: 0 },
      minimumCoreLevel: 45,
      coreSpecies: [131],
    },
  });

  assert.equal(training?.forObjective, "badge-volcano");
  assert.equal(training?.target.map, "MAP_TRAINING");
  assert.equal(training?.trainingPartySlot, 1);
});

test("core training rejects an area that outlevels both trainee and escort", () => {
  const world = {
    maps: [
      openMap("MAP_CITY", {
        coordEvents: [{ x: 2, y: 2, type: "trigger" }],
        connections: [
          { direction: "down", map: "MAP_RISKY", offset: 0 },
          { direction: "right", map: "MAP_MIDDLE", offset: 0 },
        ],
      }),
      openMap("MAP_RISKY", {
        connections: [{ direction: "up", map: "MAP_CITY", offset: 0 }],
        encounters: { "1,1": 1, "2,1": 1 },
        behaviors: { "1,1": "MB_NORMAL", "2,1": "MB_NORMAL" },
      }),
      openMap("MAP_MIDDLE", {
        connections: [
          { direction: "left", map: "MAP_CITY", offset: 0 },
          { direction: "right", map: "MAP_SAFE", offset: 0 },
        ],
      }),
      openMap("MAP_SAFE", {
        connections: [{ direction: "left", map: "MAP_MIDDLE", offset: 0 }],
        encounters: { "1,1": 1, "2,1": 1 },
        behaviors: { "1,1": "MB_NORMAL", "2,1": "MB_NORMAL" },
      }),
    ],
    wildEncounters: [
      {
        map: "MAP_RISKY",
        land_mons: {
          encounter_rate: 7,
          mons: [{ min_level: 62, max_level: 70, species: "SPECIES_RATICATE" }],
        },
      },
      {
        map: "MAP_SAFE",
        land_mons: {
          encounter_rate: 14,
          mons: [{ min_level: 17, max_level: 28, species: "SPECIES_TANGELA" }],
        },
      },
    ],
  };
  const observation = campaignObservation({
    map: "MAP_CITY",
    party: [
      { slot: 0, species: 3, level: 59, hp: 170, moves: [290, 235, 70, 15] },
      { slot: 1, species: 131, level: 27, hp: 113, moves: [57, 34, 109, 195] },
    ],
  });
  observation.playerMemory.position = { x: 2, y: 2 };

  const training = selectTrainingObjective({
    world,
    observation,
    objective: {
      id: "badge-volcano",
      target: { kind: "trigger", map: "MAP_CITY", index: 0 },
      minimumCoreLevel: 45,
      coreSpecies: [131],
    },
  });

  assert.equal(training?.target.map, "MAP_SAFE");
  assert.deepEqual(training?.encounter, {
    rate: 14,
    minimumWildLevel: 17,
    maximumWildLevel: 28,
  });
});

test("campaign preparation diverts an under-level team to the strongest safe cartridge encounters", () => {
  const world = { maps: [
    openMap("MAP_CITY", {
      coordEvents: [{ x: 2, y: 2, type: "trigger" }],
      connections: [
        { direction: "down", map: "MAP_SAFE_ROUTE", offset: 0 },
        { direction: "right", map: "MAP_TRAINER_ROUTE", offset: 0 },
      ],
    }),
    openMap("MAP_SAFE_ROUTE", {
      connections: [{ direction: "up", map: "MAP_CITY", offset: 0 }],
      encounters: { "1,1": 1, "2,1": 1 },
      behaviors: { "1,1": "MB_TALL_GRASS", "2,1": "MB_TALL_GRASS" },
    }),
    openMap("MAP_TRAINER_ROUTE", {
      connections: [{ direction: "left", map: "MAP_CITY", offset: 0 }],
      encounters: { "1,1": 1, "2,1": 1 },
      behaviors: { "1,1": "MB_TALL_GRASS", "2,1": "MB_TALL_GRASS" },
      objectEvents: [{
        x: 3,
        y: 1,
        trainer_type: "TRAINER_TYPE_NORMAL",
        trainer_sight_or_berry_tree_id: "4",
      }],
    }),
  ], wildEncounters: [
    {
      map: "MAP_SAFE_ROUTE",
      land_mons: {
        encounter_rate: 21,
        mons: [{ min_level: 4, max_level: 5, species: "SPECIES_PIDGEY" }],
      },
    },
    {
      map: "MAP_TRAINER_ROUTE",
      land_mons: {
        encounter_rate: 21,
        mons: [{ min_level: 7, max_level: 8, species: "SPECIES_SPEAROW" }],
      },
    },
  ] };
  const observation = campaignObservation({ map: "MAP_CITY" });
  observation.playerMemory.position = { x: 2, y: 2 };
  observation.playerMemory.trainer.party[0].level = 12;
  const storyObjective = {
    id: "next-rival",
    target: { kind: "trigger", map: "MAP_CITY", index: 0 },
    minimumTeamAnchorLevel: 18,
  };

  const training = selectTrainingObjective({ world, observation, objective: storyObjective });

  assert.deepEqual(training, {
    id: "train-team-anchor",
    target: { kind: "encounter-zone", map: "MAP_TRAINER_ROUTE" },
    currentTeamAnchorLevel: 12,
    minimumTeamAnchorLevel: 18,
    trainingPartySlot: 0,
    trainingSpecies: 1,
    forObjective: "next-rival",
    encounter: { rate: 21, minimumWildLevel: 7, maximumWildLevel: 8 },
  });
  observation.playerMemory.trainer.party[0].level = 18;
  assert.equal(
    selectTrainingObjective({ world, observation, objective: storyObjective }),
    null,
  );
});

test("wild training chooses the highest-level reachable safe encounter table", () => {
  const city = openMap("MAP_TRAINING_CITY", {
    coordEvents: [{ x: 2, y: 2, type: "trigger" }],
    connections: [
      { direction: "down", map: "MAP_NEARBY_GRASS", offset: 0 },
      { direction: "right", map: "MAP_TRAINING_PASSAGE", offset: 0 },
    ],
  });
  const nearbyGrass = openMap("MAP_NEARBY_GRASS", {
    connections: [{ direction: "up", map: city.id, offset: 0 }],
    encounters: { "1,1": 1, "2,1": 1 },
    behaviors: { "1,1": "MB_TALL_GRASS", "2,1": "MB_TALL_GRASS" },
  });
  const passage = openMap("MAP_TRAINING_PASSAGE", {
    connections: [
      { direction: "left", map: city.id, offset: 0 },
      { direction: "right", map: "MAP_STRONGER_GRASS", offset: 0 },
    ],
  });
  const strongerGrass = openMap("MAP_STRONGER_GRASS", {
    connections: [{ direction: "left", map: passage.id, offset: 0 }],
    encounters: { "1,1": 1, "2,1": 1 },
    behaviors: { "1,1": "MB_TALL_GRASS", "2,1": "MB_TALL_GRASS" },
    objectEvents: [{
      x: 3,
      y: 1,
      trainer_type: "TRAINER_TYPE_NORMAL",
    }],
  });
  const world = {
    maps: [city, nearbyGrass, passage, strongerGrass],
    wildEncounters: [
      {
        map: nearbyGrass.id,
        land_mons: {
          encounter_rate: 21,
          mons: [{ min_level: 4, max_level: 6, species: "SPECIES_PIDGEY" }],
        },
      },
      {
        map: strongerGrass.id,
        land_mons: {
          encounter_rate: 14,
          mons: [{ min_level: 14, max_level: 18, species: "SPECIES_SPEAROW" }],
        },
      },
    ],
  };
  const observation = campaignObservation({
    map: city.id,
    party: [
      {
        slot: 0,
        species: 1,
        level: 12,
        hp: 35,
        maxHp: 35,
        moves: [33],
      },
      {
        slot: 1,
        species: 5,
        level: 20,
        hp: 58,
        maxHp: 58,
        moves: [52],
      },
    ],
  });
  observation.playerMemory.position = { x: 2, y: 2 };

  const training = selectTrainingObjective({
    world,
    observation,
    objective: {
      id: "next-rival",
      target: { kind: "trigger", map: city.id, index: 0 },
      importantBattle: true,
      minimumBattlePartySize: 2,
      minimumBattleMemberLevel: 18,
    },
  });

  assert.equal(training?.target.map, strongerGrass.id);
  assert.equal(training?.trainingMethod, "switch");
  assert.equal(training?.escortPartySlot, 1);
  assert.deepEqual(training?.encounter, {
    rate: 14,
    minimumWildLevel: 14,
    maximumWildLevel: 18,
  });
});

test("boss staging cannot confine a late-game team to trivial nearby wild encounters", () => {
  const ids = ["MAP_GIOVANNI_CITY", "MAP_ROUTE22_GRASS", "MAP_TRAINING_LINK", "MAP_PRODUCTIVE_GRASS"];
  const maps = ids.map((id, index) => openMap(id, {
    connections: [
      ...(index > 0 ? [{ direction: "left", map: ids[index - 1], offset: 0 }] : []),
      ...(index < ids.length - 1 ? [{ direction: "right", map: ids[index + 1], offset: 0 }] : []),
    ],
    ...(index === 0 ? { objectEvents: [{ x: 3, y: 3, script: "Gym_Leader" }] } : {}),
    ...([1, 3].includes(index) ? {
      encounters: { "1,1": 1, "2,1": 1 },
      behaviors: { "1,1": "MB_TALL_GRASS", "2,1": "MB_TALL_GRASS" },
    } : {}),
  }));
  const observed = campaignObservation({ map: ids[0], party: [
    { slot: 0, species: 143, level: 49, hp: 200, maxHp: 200, moves: [33] },
    { slot: 1, species: 9, level: 50, hp: 150, maxHp: 150, moves: [57] },
  ] });
  observed.playerMemory.position = { x: 2, y: 2 };
  const world = { maps, wildEncounters: [
    { map: ids[1], land_mons: { encounter_rate: 21, mons: [{ min_level: 3, max_level: 5, species: "SPECIES_SPEAROW" }] } },
    { map: ids[3], land_mons: { encounter_rate: 21, mons: [{ min_level: 35, max_level: 40, species: "SPECIES_FEAROW" }] } },
  ] };
  const objective = { id: "badge-earth", importantBattle: true,
    target: { kind: "object", map: ids[0], index: 0 },
    minimumBattlePartySize: 2, minimumBattleMemberLevel: 52 };
  for (const mechanics of [null, { species: [
    { name: "SPECIES_SPEAROW", expYield: 58 }, { name: "SPECIES_FEAROW", expYield: 162 },
  ] }]) {
    const training = selectTrainingObjective({ world, mechanics, observation: observed, objective });
    assert.equal(training?.target.map, ids[3], "near the boss is not sufficient if local XP is trivial");
  }
});

test("wild switch training chooses the least-overleveled healthy escort", () => {
  const route = openMap("MAP_BALANCED_TRAINING", {
    coordEvents: [{ x: 2, y: 2, type: "trigger" }],
    encounters: { "1,1": 1, "2,1": 1 },
    behaviors: { "1,1": "MB_TALL_GRASS", "2,1": "MB_TALL_GRASS" },
  });
  const world = {
    maps: [route],
    wildEncounters: [{
      map: route.id,
      land_mons: {
        encounter_rate: 21,
        mons: [{ min_level: 12, max_level: 14, species: "SPECIES_PIDGEY" }],
      },
    }],
  };
  const observation = campaignObservation({
    map: route.id,
    party: [
      { slot: 0, species: 4, level: 10, hp: 30, maxHp: 30, moves: [33] },
      { slot: 1, species: 1, level: 16, hp: 45, maxHp: 45, moves: [33] },
      { slot: 2, species: 9, level: 55, hp: 177, maxHp: 177, moves: [55] },
    ],
  });
  observation.playerMemory.position = { x: 2, y: 2 };

  const training = selectTrainingObjective({
    world,
    observation,
    objective: {
      id: "next-rival",
      target: { kind: "trigger", map: route.id, index: 0 },
      importantBattle: true,
      minimumBattlePartySize: 3,
      minimumBattleMemberLevel: 18,
    },
  });

  assert.equal(training?.trainingPartySlot, 0);
  assert.equal(training?.trainingMethod, "switch");
  assert.equal(training?.escortPartySlot, 1);
  assert.equal(training?.escortSpecies, 1);

  const directWorld = {
    ...world,
    wildEncounters: [{
      ...world.wildEncounters[0],
      land_mons: {
        ...world.wildEncounters[0].land_mons,
        mons: [{ min_level: 10, max_level: 12, species: "SPECIES_PIDGEY" }],
      },
    }],
  };
  const directTraining = selectTrainingObjective({
    world: directWorld,
    observation,
    objective: {
      id: "next-rival",
      target: { kind: "trigger", map: route.id, index: 0 },
      importantBattle: true,
      minimumBattlePartySize: 3,
      minimumBattleMemberLevel: 18,
    },
  });

  assert.equal(directTraining?.trainingMethod, undefined);
  assert.equal(directTraining?.escortPartySlot, 1);
  assert.equal(directTraining?.escortSpecies, 1);
});

test("wild training ranks expected cartridge XP throughput instead of a rare maximum-level slot", () => {
  const city = openMap("MAP_FUCHSIA_CITY", {
    connections: [
      { direction: "right", map: "MAP_DIGLETTS_CAVE_B1F", offset: 0 },
      { direction: "left", map: "MAP_ROUTE18", offset: 0 },
    ],
  });
  const cave = openMap("MAP_DIGLETTS_CAVE_B1F", {
    connections: [{ direction: "left", map: city.id, offset: 0 }],
    encounters: { "1,1": 1, "2,1": 1 },
    behaviors: { "1,1": "MB_CAVE", "2,1": "MB_CAVE" },
  });
  const route = openMap("MAP_ROUTE18", {
    connections: [{ direction: "right", map: city.id, offset: 0 }],
    encounters: { "1,1": 1, "2,1": 1 },
    behaviors: { "1,1": "MB_TALL_GRASS", "2,1": "MB_TALL_GRASS" },
  });
  const objective = {
    id: "rival-silph",
    target: { kind: "trigger", map: city.id, index: 0 },
    importantBattle: true,
    minimumBattlePartySize: 2,
    minimumBattleMemberLevel: 40,
    maximumTeamLevelGap: 5,
  };
  const world = {
    maps: [city, cave, route],
    wildEncounters: [
      {
        map: cave.id,
        land_mons: {
          encounter_rate: 5,
          mons: [
            ...Array.from({ length: 11 }, () => ({
              min_level: 15,
              max_level: 22,
              species: "SPECIES_DIGLETT",
            })),
            { min_level: 29, max_level: 31, species: "SPECIES_DUGTRIO" },
          ],
        },
      },
      {
        map: route.id,
        land_mons: {
          encounter_rate: 21,
          mons: Array.from({ length: 12 }, () => ({
            min_level: 24,
            max_level: 29,
            species: "SPECIES_FEAROW",
          })),
        },
      },
    ],
  };
  const mechanics = { data: { species: [
    { name: "SPECIES_DIGLETT", expYield: 81 },
    { name: "SPECIES_DUGTRIO", expYield: 153 },
    { name: "SPECIES_FEAROW", expYield: 162 },
  ] } };
  const observation = campaignObservation({
    map: city.id,
    party: [
      { slot: 0, species: 123, level: 32, hp: 89, maxHp: 89, moves: [17] },
      { slot: 1, species: 6, level: 56, hp: 172, maxHp: 172, moves: [53] },
    ],
  });
  observation.playerMemory.position = { x: 2, y: 2 };
  const planner = createCampaignPlanner({
    campaign: { objectives: [objective] },
    world,
    mechanics,
  });

  const training = planner.selectTraining(observation, objective);

  assert.equal(training?.target.map, route.id);
  assert.deepEqual(training?.encounter, {
    rate: 21,
    minimumWildLevel: 24,
    maximumWildLevel: 29,
  });
});

test("wild training excludes Safari Zone encounters that cannot award experience", () => {
  const city = openMap("MAP_FUCHSIA_CITY", {
    connections: [
      { direction: "left", map: "MAP_ROUTE18", offset: 0 },
      { direction: "up", map: "MAP_SAFARI_ZONE_CENTER", offset: 0 },
    ],
  });
  const route = openMap("MAP_ROUTE18", {
    connections: [{ direction: "right", map: city.id, offset: 0 }],
    encounters: { "1,1": 1, "2,1": 1 },
    behaviors: { "1,1": "MB_TALL_GRASS", "2,1": "MB_TALL_GRASS" },
  });
  const safari = openMap("MAP_SAFARI_ZONE_CENTER", {
    connections: [{ direction: "down", map: city.id, offset: 0 }],
    encounters: { "1,1": 1, "2,1": 1 },
    behaviors: { "1,1": "MB_TALL_GRASS", "2,1": "MB_TALL_GRASS" },
  });
  const world = {
    maps: [city, route, safari],
    wildEncounters: [
      {
        map: route.id,
        land_mons: {
          encounter_rate: 15,
          mons: [{ min_level: 22, max_level: 25, species: "SPECIES_DODUO" }],
        },
      },
      {
        map: safari.id,
        land_mons: {
          encounter_rate: 30,
          mons: [{ min_level: 22, max_level: 33, species: "SPECIES_NIDORINO" }],
        },
      },
    ],
  };
  const observation = campaignObservation({
    map: city.id,
    party: [
      { slot: 0, species: 131, level: 24, hp: 80, maxHp: 80, moves: [55] },
      { slot: 1, species: 6, level: 40, hp: 120, maxHp: 120, moves: [53] },
    ],
  });
  observation.playerMemory.position = { x: 2, y: 2 };

  const training = selectTrainingObjective({
    world,
    observation,
    objective: {
      id: "rival-silph",
      target: { kind: "trigger", map: city.id, index: 0 },
      importantBattle: true,
      minimumBattlePartySize: 2,
      minimumBattleMemberLevel: 35,
    },
  });

  assert.equal(training?.target.map, route.id);
  assert.deepEqual(training?.encounter, {
    rate: 15,
    minimumWildLevel: 22,
    maximumWildLevel: 25,
  });
});

test("switch training avoids wild tables that can trap the trainee", () => {
  const city = openMap("MAP_TRAINING_CITY", {
    coordEvents: [{ x: 2, y: 2, type: "trigger" }],
    connections: [
      { direction: "down", map: "MAP_SAFE_GRASS", offset: 0 },
      { direction: "right", map: "MAP_TRAPPING_CAVE", offset: 0 },
    ],
  });
  const safeGrass = openMap("MAP_SAFE_GRASS", {
    connections: [{ direction: "up", map: city.id, offset: 0 }],
    encounters: { "1,1": 1, "2,1": 1 },
    behaviors: { "1,1": "MB_TALL_GRASS", "2,1": "MB_TALL_GRASS" },
  });
  const trappingCave = openMap("MAP_TRAPPING_CAVE", {
    connections: [{ direction: "left", map: city.id, offset: 0 }],
    encounters: { "1,1": 1, "2,1": 1 },
    behaviors: { "1,1": "MB_CAVE", "2,1": "MB_CAVE" },
  });
  const world = {
    maps: [city, safeGrass, trappingCave],
    wildEncounters: [
      {
        map: safeGrass.id,
        land_mons: {
          encounter_rate: 20,
          mons: [{ min_level: 14, max_level: 18, species: "SPECIES_SPEAROW" }],
        },
      },
      {
        map: trappingCave.id,
        land_mons: {
          encounter_rate: 20,
          mons: [{ min_level: 15, max_level: 31, species: "SPECIES_DIGLETT" }],
        },
      },
    ],
  };
  const observation = campaignObservation({
    map: city.id,
    party: [
      { slot: 0, species: 32, level: 7, hp: 23, maxHp: 23, moves: [64] },
      { slot: 1, species: 5, level: 32, hp: 89, maxHp: 89, moves: [52] },
    ],
  });
  observation.playerMemory.position = { x: 2, y: 2 };

  const training = selectTrainingObjective({
    world,
    observation,
    objective: {
      id: "badge-rainbow",
      target: { kind: "trigger", map: city.id, index: 0 },
      importantBattle: true,
      minimumBattlePartySize: 2,
      minimumBattleMemberLevel: 23,
    },
  });

  assert.equal(training?.target.map, safeGrass.id);
  assert.equal(training?.trainingMethod, "switch");
  assert.equal(training?.escortPartySlot, 1);
});

test("campaign preparation remains active after crossing into an exterior boss training map", () => {
  const town = openMap("MAP_TOWN", {
    connections: [{ direction: "down", map: "MAP_ROUTE", offset: 0 }],
    behaviors: { "3,1": "MB_LADDER" },
    warpEvents: [{ x: 3, y: 1, dest_map: "MAP_GYM", dest_warp_id: 0 }],
  });
  const route = openMap("MAP_ROUTE", {
    connections: [{ direction: "up", map: town.id, offset: 0 }],
    encounters: { "1,1": 1, "2,1": 1 },
    behaviors: { "1,1": "MB_TALL_GRASS", "2,1": "MB_TALL_GRASS" },
  });
  const gym = openMap("MAP_GYM", {
    behaviors: { "1,1": "MB_LADDER" },
    warpEvents: [{ x: 1, y: 1, dest_map: town.id, dest_warp_id: 0 }],
    objectEvents: [{ x: 3, y: 3, script: "Gym_EventScript_Leader" }],
  });
  const world = {
    maps: [town, route, gym],
    wildEncounters: [{
      map: route.id,
      land_mons: {
        encounter_rate: 21,
        mons: [{ min_level: 2, max_level: 5, species: "SPECIES_RATTATA" }],
      },
    }],
  };
  const observation = campaignObservation({ map: route.id });
  observation.playerMemory.position = { x: 1, y: 1 };
  observation.playerMemory.trainer.party[0].level = 9;

  assert.deepEqual(selectTrainingObjective({
    world,
    observation,
    objective: {
      id: "badge-boulder",
      target: { kind: "object", map: gym.id, index: 0 },
      minimumTeamAnchorLevel: 12,
    },
  }), {
    id: "train-team-anchor",
    target: { kind: "encounter-zone", map: route.id },
    currentTeamAnchorLevel: 9,
    minimumTeamAnchorLevel: 12,
    trainingPartySlot: 0,
    trainingSpecies: 1,
    forObjective: "badge-boulder",
    encounter: { rate: 21, minimumWildLevel: 2, maximumWildLevel: 5 },
  });
});

test("important-battle preparation stays active across its selected training boundary", () => {
  const route = openMap("MAP_ROUTE4", {
    connections: [{ direction: "right", map: "MAP_CERULEAN_CITY", offset: 0 }],
    behaviors: { "3,1": "MB_LADDER" },
    warpEvents: [{
      x: 3,
      y: 1,
      dest_map: "MAP_MT_MOON_B1F",
      dest_warp_id: 0,
    }],
  });
  const cave = openMap("MAP_MT_MOON_B1F", {
    behaviors: {
      "1,1": "MB_LADDER",
      "2,1": "MB_CAVE_FLOOR",
      "3,1": "MB_CAVE_FLOOR",
    },
    encounters: { "2,1": 1, "3,1": 1 },
    warpEvents: [{
      x: 1,
      y: 1,
      dest_map: route.id,
      dest_warp_id: 0,
    }],
  });
  const city = openMap("MAP_CERULEAN_CITY", {
    connections: [{ direction: "left", map: route.id, offset: 0 }],
    coordEvents: [{ x: 2, y: 2, type: "trigger" }],
  });
  const world = {
    maps: [route, cave, city],
    wildEncounters: [{
      map: cave.id,
      land_mons: {
        encounter_rate: 5,
        mons: [{ min_level: 5, max_level: 10, species: "SPECIES_ZUBAT" }],
      },
    }],
  };
  const party = [
    { slot: 0, species: 5, level: 17, hp: 45, maxHp: 45, moves: [10] },
    { slot: 1, species: 19, level: 14, hp: 34, maxHp: 34, moves: [33] },
    { slot: 2, species: 16, level: 14, hp: 37, maxHp: 37, moves: [16] },
    { slot: 3, species: 46, level: 8, hp: 25, maxHp: 25, moves: [10] },
  ];
  const objective = {
    id: "rival-cerulean",
    target: { kind: "trigger", map: city.id, index: 0 },
    importantBattle: true,
    minimumBattlePartySize: 3,
    enemyAceLevel: 18,
    battleTeamTargetLevel: 23,
    minimumBattleMemberLevel: 23,
    minimumTeamAnchorLevel: 23,
  };
  const observationAt = (map, position) => campaignObservation({
    map,
    party,
  });
  const routeObservation = observationAt(route.id, { x: 3, y: 2 });
  routeObservation.playerMemory.position = { x: 3, y: 2 };
  const caveObservation = observationAt(cave.id, { x: 1, y: 1 });
  caveObservation.playerMemory.position = { x: 1, y: 1 };

  assert.equal(
    selectTrainingObjective({ world, observation: routeObservation, objective })
      ?.target.map,
    cave.id,
  );
  assert.deepEqual(
    selectTrainingObjective({ world, observation: caveObservation, objective }),
    {
      id: "train-battle-member",
      target: { kind: "encounter-zone", map: cave.id },
      currentTeamAnchorLevel: 14,
      minimumTeamAnchorLevel: 23,
      trainingRotation: "one-level",
      trainingPartySlot: 1,
      trainingSpecies: 19,
      escortPartySlot: 0,
      escortSpecies: 5,
      forObjective: "rival-cerulean",
      encounter: { rate: 5, minimumWildLevel: 5, maximumWildLevel: 10 },
    },
  );

  party[0].level = 23;
  party[1].level = 23;
  party[2].level = 23;
  party[3].level = 14;
  assert.equal(
    selectTrainingObjective({ world, observation: caveObservation, objective }),
    null,
  );
});

test("campaign preparation does not replace progression battles far from the objective", () => {
  const world = { maps: [
    openMap("MAP_START", {
      connections: [{ direction: "right", map: "MAP_MIDDLE", offset: 0 }],
      encounters: { "1,1": 1, "2,1": 1 },
    }),
    openMap("MAP_MIDDLE", {
      connections: [
        { direction: "left", map: "MAP_START", offset: 0 },
        { direction: "right", map: "MAP_GOAL", offset: 0 },
      ],
    }),
    openMap("MAP_GOAL", {
      connections: [{ direction: "left", map: "MAP_MIDDLE", offset: 0 }],
      coordEvents: [{ x: 2, y: 2, type: "trigger" }],
    }),
  ], wildEncounters: [{
    map: "MAP_START",
    land_mons: {
      encounter_rate: 21,
      mons: [{ min_level: 4, max_level: 5, species: "SPECIES_PIDGEY" }],
    },
  }] };
  const observation = campaignObservation({ map: "MAP_START" });
  observation.playerMemory.position = { x: 1, y: 1 };
  observation.playerMemory.trainer.party[0].level = 15;

  assert.equal(selectTrainingObjective({
    world,
    observation,
    objective: {
      id: "distant-rival",
      target: { kind: "trigger", map: "MAP_GOAL", index: 0 },
      minimumTeamAnchorLevel: 18,
    },
  }), null);
});

test("campaign preparation walks continuously within cartridge encounter terrain", () => {
  const world = { maps: [openMap("MAP_SAFE_ROUTE", {
    encounters: { "1,1": 1, "2,1": 1 },
    behaviors: { "1,1": "MB_TALL_GRASS", "2,1": "MB_TALL_GRASS" },
  })] };
  const observation = campaignObservation({ map: "MAP_SAFE_ROUTE" });
  observation.playerMemory.position = { x: 1, y: 1 };
  const objective = {
    id: "train-team-anchor",
    target: { kind: "encounter-zone", map: "MAP_SAFE_ROUTE" },
    currentTeamAnchorLevel: 12,
    minimumTeamAnchorLevel: 18,
    forObjective: "next-rival",
  };

  assert.deepEqual(campaignNavigationRecommendation({ world, observation, objective }), {
    kind: "move-toward",
    direction: "east",
    objective: "train-team-anchor",
    targetMap: "MAP_SAFE_ROUTE",
    target: { kind: "encounter-zone", x: 2, y: 1 },
    remainingSteps: 1,
  });
});
test('friendship walking follows ordinary floor and avoids encounters and exits',()=>{
 const world={maps:[openMap('MAP_FRIENDSHIP_CENTER',{encounters:{'2,1':1},behaviors:{'2,1':'MB_TALL_GRASS'},warpEvents:[{x:1,y:2,dest_map:'MAP_OUTSIDE',dest_warp_id:'0'}]})]};
 const observation=campaignObservation({map:'MAP_FRIENDSHIP_CENTER'});observation.playerMemory.position={x:1,y:1};
 const recommendation=campaignNavigationRecommendation({world,observation,objective:{id:'friendship',target:{kind:'friendship-walk',map:'MAP_FRIENDSHIP_CENTER'}}});
 assert.equal(recommendation.kind,'move-toward');assert.ok(recommendation.remainingSteps>0);
 assert.notEqual(recommendation.direction,'east');assert.notEqual(recommendation.direction,'south');
});

test("VS Seeker recharge runs the best available path out and back", () => {
  const map = openMap("MAP_REMATCH_PACING_ROUTE", {
    width: 9,
    height: 1,
  });
  const world = { maps: [map] };
  const observation = campaignObservation({ map: map.id });
  observation.playerMemory.vsSeeker = { batterySteps: 20 };
  const objective = {
    id: "train-with-vs-seeker",
    target: {
      kind: "vs-seeker-recharge",
      map: map.id,
      x: 4,
      y: 0,
    },
    trainingSource: "vs-seeker-recharge",
    vsSeekerAction: "recharge",
  };

  observation.playerMemory.position = { x: 4, y: 0 };
  assert.deepEqual(campaignNavigationRecommendation({
    world,
    observation,
    objective,
  }), {
    kind: "move-toward",
    direction: "west",
    pathSegment: {
      direction: "west",
      steps: 4,
      endpoint: { map: map.id, x: 0, y: 0 },
    },
    objective: objective.id,
    targetMap: map.id,
    target: { kind: "vs-seeker-recharge", x: 0, y: 0 },
    remainingSteps: 4,
  });

  observation.playerMemory.position = { x: 0, y: 0 };
  assert.deepEqual(campaignNavigationRecommendation({
    world,
    observation,
    objective,
  }), {
    kind: "move-toward",
    direction: "east",
    pathSegment: {
      direction: "east",
      steps: 4,
      endpoint: { map: map.id, x: 4, y: 0 },
    },
    objective: objective.id,
    targetMap: map.id,
    target: { kind: "vs-seeker-recharge", x: 4, y: 0 },
    remainingSteps: 4,
  });
});

test("VS Seeker recharge limits its outbound path to half the missing charge", () => {
  const map = openMap("MAP_REMATCH_CHARGE_LIMIT_ROUTE", {
    width: 15,
    height: 1,
  });
  const world = { maps: [map] };
  const observation = campaignObservation({ map: map.id });
  observation.playerMemory.position = { x: 7, y: 0 };
  observation.playerMemory.vsSeeker = { batterySteps: 94 };
  const objective = {
    id: "finish-vs-seeker-charge",
    target: {
      kind: "vs-seeker-recharge",
      map: map.id,
      x: 7,
      y: 0,
    },
    trainingSource: "vs-seeker-recharge",
    vsSeekerAction: "recharge",
  };

  assert.deepEqual(campaignNavigationRecommendation({
    world,
    observation,
    objective,
  }), {
    kind: "move-toward",
    direction: "west",
    pathSegment: {
      direction: "west",
      steps: 3,
      endpoint: { map: map.id, x: 4, y: 0 },
    },
    objective: objective.id,
    targetMap: map.id,
    target: { kind: "vs-seeker-recharge", x: 4, y: 0 },
    remainingSteps: 3,
  });
});

test('VS Seeker recharge reaches its land anchor from water after a rematch', () => {
  const map = openMap('MAP_REMATCH_SHORE', { width: 7, height: 1,
    behaviors: {'0,0':'MB_OCEAN_WATER','1,0':'MB_OCEAN_WATER','2,0':'MB_OCEAN_WATER'},
    elevations: {'0,0':1,'1,0':1,'2,0':1},
  });
  const observation = campaignObservation({map:map.id});
  observation.playerMemory.position = {x:0,y:0};
  observation.playerMemory.avatar = {surfing:true};
  observation.playerMemory.vsSeeker = {batterySteps:14};
  const objective = {id:'train-next-badge',forObjective:'next-badge',
    target:{kind:'vs-seeker-recharge',map:map.id,x:3,y:0}};
  const route = campaignNavigationRecommendation({world:{maps:[map]},observation,objective});
  assert.equal(route?.kind,'move-toward');
  assert.equal(route.direction,'east');
  assert.equal(route.objective,'train-next-badge');
  assert.equal(route.remainingSteps,3);
  // Reconstruct the objective as an update/restart would; the native position
  // determines the approach/charge phase, not a transient navigation flag.
  observation.playerMemory.position = {x:3,y:0};
  observation.playerMemory.avatar.surfing = false;
  const charge = campaignNavigationRecommendation({world:{maps:[map]},observation,
    objective:JSON.parse(JSON.stringify(objective))});
  assert.equal(charge?.direction,'east','the recharge circuit stays on land');
  assert.equal(charge.remainingSteps,3);
});

test('VS Seeker recharge prefers a safe land return and never targets a water anchor', () => {
  const map = openMap('MAP_REMATCH_WATER_SHORTCUT',{width:5,height:3,
    behaviors:{'1,1':'MB_OCEAN_WATER','2,1':'MB_OCEAN_WATER','3,1':'MB_OCEAN_WATER'},
    elevations:{'1,1':1,'2,1':1,'3,1':1},
  });
  const observation = campaignObservation({map:map.id,flags:{2084:true},
    party:[{species:131,hp:100,level:50,moves:[57]}]});
  observation.playerMemory.position={x:0,y:1};
  const objective={id:'return-for-rematch',target:{kind:'vs-seeker-recharge',map:map.id,x:4,y:1}};
  const route=campaignNavigationRecommendation({world:{maps:[map]},observation,objective});
  assert.equal(route?.kind,'move-toward');
  assert.ok(['north','south'].includes(route.direction),'return over land without remounting Surf');
  objective.target.x=2;
  assert.equal(campaignNavigationRecommendation({world:{maps:[map]},observation,objective}),null);
});

test("preparation routing detours around its pending major-battle trigger", () => {
  const collisions = {};
  for (let x = 0; x < 7; x += 1) {
    collisions[`${x},0`] = 1;
    collisions[`${x},4`] = 1;
  }
  for (let y = 0; y < 5; y += 1) {
    collisions[`0,${y}`] = 1;
    collisions[`6,${y}`] = 1;
  }
  const map = openMap("MAP_BOSS_GUARD", {
    width: 7,
    height: 5,
    collisions,
    coordEvents: [
      { x: 3, y: 2, script: "Boss_EventScript_Rival" },
      { x: 5, y: 2, script: "Training_EventScript_Target" },
    ],
  });
  const observation = campaignObservation({ map: map.id });
  observation.playerMemory.position = { x: 1, y: 2 };

  const recommendation = campaignNavigationRecommendation({
    world: { maps: [map] },
    observation,
    objective: {
      id: "recover-before-rival",
      target: { kind: "trigger", map: map.id, index: 1 },
      avoidTargets: [
        { kind: "trigger", map: map.id, index: 0 },
      ],
    },
  });

  assert.equal(recommendation?.direction, "south");
  assert.deepEqual(recommendation?.pathSegment, {
    direction: "south",
    steps: 1,
    endpoint: { map: map.id, x: 1, y: 3 },
    continuationDirection: "east",
  });
});

test("encounter patrols traverse the connected terrain instead of pulsing one tile", () => {
  const world = { maps: [openMap("MAP_PATROL_ROUTE", {
    width: 7,
    height: 4,
    encounters: { "1,1": 1, "2,1": 1, "3,1": 1, "4,1": 1, "5,1": 1 },
    behaviors: {
      "1,1": "MB_TALL_GRASS",
      "2,1": "MB_TALL_GRASS",
      "3,1": "MB_TALL_GRASS",
      "4,1": "MB_TALL_GRASS",
      "5,1": "MB_TALL_GRASS",
    },
  })] };
  const observation = campaignObservation({ map: "MAP_PATROL_ROUTE" });
  observation.playerMemory.position = { x: 1, y: 1 };
  const recommendation = rawCampaignNavigationRecommendation({
    world,
    observation,
    objective: {
      id: "train-across-encounters",
      target: { kind: "encounter-zone", map: "MAP_PATROL_ROUTE" },
    },
  });

  const { mapRevision, ...routePlan } = recommendation.routePlan;
  assert.match(mapRevision, /^[0-9a-f]{64}$/);
  assert.deepEqual(routePlan, {
    map: "MAP_PATROL_ROUTE",
    origin: { x: 1, y: 1 },
    destination: { x: 5, y: 1 },
    steps: 4,
    segments: [
      { direction: "east", steps: 4, endpoint: { x: 5, y: 1 } },
    ],
  });
  assert.deepEqual(recommendation.target, {
    kind: "encounter-zone",
    x: 5,
    y: 1,
  });
});

test("cross-map campaign routing chooses the first cartridge edge toward the objective", () => {
  const world = { maps: [
    openMap("MAP_PALLET_TOWN_PROFESSOR_OAKS_LAB", {
      warpEvents: [{ x: 2, y: 4, dest_map: "MAP_PALLET_TOWN", dest_warp_id: "2" }],
      behaviors: { "2,4": "MB_SOUTH_ARROW_WARP" },
    }),
    openMap("MAP_PALLET_TOWN", {
      warpEvents: [
        { x: 0, y: 4, dest_map: "MAP_UNUSED", dest_warp_id: "0" },
        { x: 1, y: 4, dest_map: "MAP_UNUSED", dest_warp_id: "0" },
        { x: 2, y: 4, dest_map: "MAP_PALLET_TOWN_PROFESSOR_OAKS_LAB", dest_warp_id: "0" },
      ],
      connections: [{ direction: "up", map: "MAP_ROUTE1", offset: 0 }],
    }),
    openMap("MAP_ROUTE1", {
      connections: [
        { direction: "down", map: "MAP_PALLET_TOWN", offset: 0 },
        { direction: "up", map: "MAP_VIRIDIAN_CITY", offset: 0 },
      ],
    }),
    openMap("MAP_VIRIDIAN_CITY", {
      connections: [{ direction: "down", map: "MAP_ROUTE1", offset: 0 }],
      warpEvents: [
        { x: 0, y: 4, dest_map: "MAP_UNUSED", dest_warp_id: "0" },
        { x: 1, y: 4, dest_map: "MAP_UNUSED", dest_warp_id: "0" },
        { x: 2, y: 4, dest_map: "MAP_UNUSED", dest_warp_id: "0" },
        { x: 3, y: 4, dest_map: "MAP_UNUSED", dest_warp_id: "0" },
        { x: 3, y: 2, dest_map: "MAP_VIRIDIAN_CITY_MART", dest_warp_id: "0" },
      ],
    }),
    openMap("MAP_VIRIDIAN_CITY_MART", {
      warpEvents: [{ x: 2, y: 4, dest_map: "MAP_VIRIDIAN_CITY", dest_warp_id: "4" }],
    }),
  ] };
  const observation = campaignObservation();
  observation.playerMemory.position = { x: 2, y: 1 };
  const objective = createCampaignPlanner().select(observation);

  assert.deepEqual(campaignNavigationRecommendation({
    world,
    observation,
    objective,
  }), {
    kind: "move-toward",
    direction: "south",
    pathSegment: {
      direction: "south",
      steps: 3,
      endpoint: {
        map: "MAP_PALLET_TOWN_PROFESSOR_OAKS_LAB",
        x: 2,
        y: 4,
      },
    },
    objective: "oak-parcel",
    targetMap: "MAP_VIRIDIAN_CITY",
    transit: {
      kind: "warp",
      destinationMap: "MAP_PALLET_TOWN",
      x: 2,
      y: 4,
    },
    remainingSteps: 3,
  });
});

test("cross-map routing explores the current map once when several exits can reach the target", () => {
  const start = openMap("MAP_START", {
    width: 9,
    height: 9,
    warpEvents: [
      { x: 1, y: 1, dest_map: "MAP_BRANCH_A", dest_warp_id: 0 },
      { x: 7, y: 1, dest_map: "MAP_BRANCH_B", dest_warp_id: 0 },
      { x: 7, y: 7, dest_map: "MAP_BRANCH_C", dest_warp_id: 0 },
    ],
    behaviors: { "1,1": "MB_LADDER", "7,1": "MB_LADDER", "7,7": "MB_LADDER" },
  });
  const branches = ["A", "B", "C"].map((suffix, index) => openMap(
    `MAP_BRANCH_${suffix}`,
    {
      warpEvents: [
        { x: 1, y: 1, dest_map: start.id, dest_warp_id: index },
        { x: 3, y: 3, dest_map: "MAP_TARGET", dest_warp_id: index },
      ],
      behaviors: { "1,1": "MB_LADDER", "3,3": "MB_LADDER" },
    },
  ));
  const target = openMap("MAP_TARGET", {
    width: 7,
    height: 7,
    warpEvents: branches.map((branch) => ({
      x: 1,
      y: 1,
      dest_map: branch.id,
      dest_warp_id: 1,
    })),
    behaviors: { "1,1": "MB_LADDER" },
    objectEvents: [{ x: 5, y: 5, script: "Target_EventScript" }],
  });
  const world = { maps: [start, ...branches, target] };
  const observation = campaignObservation({ map: start.id });
  observation.playerMemory.position = { x: 4, y: 4 };
  const objective = {
    id: "reach-target",
    target: { kind: "object", map: target.id, index: 0 },
  };

  // Warm the immutable world graph so this count isolates per-decision local routing.
  campaignNavigationRecommendation({ world, observation, objective });
  let cellMapBuilds = 0;
  Object.defineProperty(start.layout.cells, "map", {
    configurable: true,
    value(callback, thisArg) {
      cellMapBuilds += 1;
      return Array.prototype.map.call(this, callback, thisArg);
    },
  });

  const recommendation = campaignNavigationRecommendation({ world, observation, objective });

  assert.equal(recommendation?.kind, "move-toward");
  assert.equal(cellMapBuilds, 1);
});

test("the world graph excludes Saffron's script gates until Tea is acquired", () => {
  const route6 = openMap("MAP_ROUTE6", {
    width: 7,
    height: 5,
    warpEvents: [
      { x: 3, y: 3, dest_map: "MAP_ROUTE6_NORTH_ENTRANCE", dest_warp_id: 0 },
      { x: 5, y: 1, dest_map: "MAP_UNDERGROUND_PATH_SOUTH_ENTRANCE", dest_warp_id: 0 },
    ],
    behaviors: { "3,3": "MB_LADDER", "5,1": "MB_LADDER" },
  });
  const gate = openMap("MAP_ROUTE6_NORTH_ENTRANCE", {
    warpEvents: [{ x: 1, y: 1, dest_map: "MAP_CELADON_CITY_GYM", dest_warp_id: 0 }],
    behaviors: { "1,1": "MB_LADDER" },
  });
  const detour = openMap("MAP_UNDERGROUND_PATH_SOUTH_ENTRANCE", {
    warpEvents: [{ x: 1, y: 1, dest_map: "MAP_CELADON_CITY_GYM", dest_warp_id: 0 }],
    behaviors: { "1,1": "MB_LADDER" },
  });
  const target = openMap("MAP_CELADON_CITY_GYM", {
    warpEvents: [{ x: 1, y: 1, dest_map: "MAP_ROUTE6_NORTH_ENTRANCE", dest_warp_id: 0 }],
    behaviors: { "1,1": "MB_LADDER" },
    objectEvents: [{ x: 2, y: 2, script: "Leader" }],
  });
  const world = { maps: [route6, gate, detour, target] };
  const objective = {
    id: "badge-rainbow",
    target: { kind: "object", map: target.id, index: 0 },
  };
  const observation = campaignObservation({ map: route6.id, flags: { 678: false } });
  observation.playerMemory.position = { x: 3, y: 3 };

  assert.equal(campaignNavigationRecommendation({
    world, observation, objective,
  })?.transit.destinationMap, "MAP_UNDERGROUND_PATH_SOUTH_ENTRANCE");
  observation.playerMemory.storyState.flagIds[678] = true;
  assert.equal(campaignNavigationRecommendation({
    world, observation, objective,
  })?.transit.destinationMap, "MAP_ROUTE6_NORTH_ENTRANCE");
});

test("the world graph excludes Route 12 until the Poke Flute is acquired", () => {
  const start = openMap("MAP_START", {
    width: 7,
    warpEvents: [
      { x: 1, y: 1, dest_map: "MAP_ROUTE12", dest_warp_id: 0 },
      { x: 5, y: 1, dest_map: "MAP_DETOUR", dest_warp_id: 0 },
    ],
    behaviors: { "1,1": "MB_LADDER", "5,1": "MB_LADDER" },
  });
  const route12 = openMap("MAP_ROUTE12", {
    warpEvents: [
      { x: 1, y: 1, dest_map: start.id, dest_warp_id: 0 },
      { x: 3, y: 3, dest_map: "MAP_GOAL", dest_warp_id: 0 },
    ],
    behaviors: { "1,1": "MB_LADDER", "3,3": "MB_LADDER" },
  });
  const detour = openMap("MAP_DETOUR", {
    warpEvents: [
      { x: 1, y: 1, dest_map: start.id, dest_warp_id: 1 },
      { x: 3, y: 3, dest_map: "MAP_GOAL", dest_warp_id: 1 },
    ],
    behaviors: { "1,1": "MB_LADDER", "3,3": "MB_LADDER" },
  });
  const goal = openMap("MAP_GOAL", {
    warpEvents: [
      { x: 1, y: 1, dest_map: route12.id, dest_warp_id: 1 },
      { x: 3, y: 1, dest_map: detour.id, dest_warp_id: 1 },
    ],
    behaviors: { "1,1": "MB_LADDER", "3,1": "MB_LADDER" },
    objectEvents: [{ x: 2, y: 3, script: "Goal_EventScript_Target" }],
  });
  const world = { maps: [start, route12, detour, goal] };
  const objective = {
    id: "reach-goal",
    target: { kind: "object", map: goal.id, index: 0 },
  };
  const observation = campaignObservation({
    map: start.id,
    flags: { 573: false, 678: true },
  });
  observation.playerMemory.position = { x: 1, y: 2 };

  assert.equal(campaignNavigationRecommendation({
    world, observation, objective,
  })?.transit.destinationMap, detour.id);
  observation.playerMemory.storyState.flagIds[573] = true;
  assert.equal(campaignNavigationRecommendation({
    world, observation, objective,
  })?.transit.destinationMap, route12.id);
});

test("the world graph excludes Rocket Hideout until the poster switch opens it", () => {
  const gameCorner = openMap("MAP_CELADON_CITY_GAME_CORNER", {
    warpEvents: [{
      x: 1,
      y: 1,
      dest_map: "MAP_ROCKET_HIDEOUT_B1F",
      dest_warp_id: 0,
    }],
    behaviors: { "1,1": "MB_DOWN_RIGHT_STAIR_WARP" },
  });
  const hideout = openMap("MAP_ROCKET_HIDEOUT_B1F", {
    warpEvents: [{
      x: 1,
      y: 1,
      dest_map: gameCorner.id,
      dest_warp_id: 0,
    }],
    behaviors: { "1,1": "MB_LADDER" },
    objectEvents: [{ x: 3, y: 3, script: "RocketHideout_B1F_EventScript_Grunt" }],
  });
  const world = { maps: [gameCorner, hideout] };
  const objective = {
    id: "train-battle-member-with-trainer",
    target: { kind: "object", map: hideout.id, index: 0 },
  };
  const observation = campaignObservation({
    map: gameCorner.id,
    flags: { 621: false },
  });
  observation.playerMemory.position = { x: 1, y: 1 };

  assert.equal(campaignNavigationRecommendation({
    world, observation, objective,
  }), null);
  observation.playerMemory.storyState.flagIds[621] = true;
  assert.equal(campaignNavigationRecommendation({
    world, observation, objective,
  })?.transit.destinationMap, hideout.id);
});

test("campaign routing applies the cartridge direction when standing on an arrow warp", () => {
  const world = { maps: [
    openMap("MAP_PALLET_TOWN_PROFESSOR_OAKS_LAB", {
      warpEvents: [{ x: 2, y: 4, dest_map: "MAP_PALLET_TOWN", dest_warp_id: "2" }],
      behaviors: { "2,4": "MB_SOUTH_ARROW_WARP" },
    }),
    openMap("MAP_PALLET_TOWN", {
      warpEvents: [
        { x: 0, y: 4, dest_map: "MAP_UNUSED", dest_warp_id: "0" },
        { x: 1, y: 4, dest_map: "MAP_UNUSED", dest_warp_id: "0" },
        { x: 2, y: 4, dest_map: "MAP_PALLET_TOWN_PROFESSOR_OAKS_LAB", dest_warp_id: "0" },
      ],
      connections: [{ direction: "up", map: "MAP_ROUTE1", offset: 0 }],
    }),
    openMap("MAP_ROUTE1", {
      connections: [{ direction: "up", map: "MAP_VIRIDIAN_CITY", offset: 0 }],
    }),
    openMap("MAP_VIRIDIAN_CITY", {
      warpEvents: [
        { x: 0, y: 4, dest_map: "MAP_UNUSED", dest_warp_id: "0" },
        { x: 1, y: 4, dest_map: "MAP_UNUSED", dest_warp_id: "0" },
        { x: 2, y: 4, dest_map: "MAP_UNUSED", dest_warp_id: "0" },
        { x: 3, y: 4, dest_map: "MAP_UNUSED", dest_warp_id: "0" },
        { x: 3, y: 2, dest_map: "MAP_VIRIDIAN_CITY_MART", dest_warp_id: "0" },
      ],
    }),
    openMap("MAP_VIRIDIAN_CITY_MART"),
  ] };
  const observation = campaignObservation();
  observation.playerMemory.position = { x: 2, y: 4 };

  const recommendation = campaignNavigationRecommendation({
    world,
    observation,
    objective: createCampaignPlanner().select(observation),
  });

  assert.equal(recommendation.kind, "traverse-directional-warp");
  assert.equal(recommendation.direction, "south");
  assert.equal(recommendation.remainingSteps, 0);
});

test("campaign routing steps off a landed ladder so it can re-enter and activate", () => {
  const world = { maps: [
    openMap("MAP_CAVE_B1F", {
      warpEvents: [{ x: 2, y: 2, dest_map: "MAP_CAVE_1F", dest_warp_id: "0" }],
      behaviors: { "2,2": "MB_LADDER" },
    }),
    openMap("MAP_CAVE_1F", {
      warpEvents: [{ x: 1, y: 1, dest_map: "MAP_CAVE_B1F", dest_warp_id: "0" }],
      objectEvents: [{ x: 3, y: 3, script: "Cave_EventScript_Goal" }],
      behaviors: { "1,1": "MB_LADDER" },
    }),
  ] };
  const observation = campaignObservation({ map: "MAP_CAVE_B1F" });
  observation.playerMemory.position = { x: 2, y: 2 };

  const recommendation = campaignNavigationRecommendation({
    world,
    observation,
    objective: {
      id: "leave-cave",
      target: { kind: "object", map: "MAP_CAVE_1F", index: 0 },
    },
  });

  assert.deepEqual(recommendation, {
    kind: "reenter-map-warp",
    direction: "south",
    objective: "leave-cave",
    targetMap: "MAP_CAVE_1F",
    transit: {
      kind: "warp",
      destinationMap: "MAP_CAVE_1F",
      x: 2,
      y: 2,
    },
    remainingSteps: 0,
  });
});

test("campaign routing detours around a directionally impassable cartridge edge", () => {
  const world = { maps: [
    openMap("MAP_CAVE", {
      warpEvents: [{ x: 2, y: 4, dest_map: "MAP_EXIT", dest_warp_id: "0" }],
      behaviors: {
        "2,2": "MB_IMPASSABLE_NORTH",
        "2,4": "MB_LADDER",
      },
    }),
    openMap("MAP_EXIT", {
      warpEvents: [{ x: 1, y: 1, dest_map: "MAP_CAVE", dest_warp_id: "0" }],
      objectEvents: [{ x: 3, y: 3, script: "Exit_EventScript_Goal" }],
      behaviors: { "1,1": "MB_LADDER" },
    }),
  ] };
  const observation = campaignObservation({ map: "MAP_CAVE" });
  observation.playerMemory.position = { x: 2, y: 1 };

  const recommendation = campaignNavigationRecommendation({
    world,
    observation,
    objective: {
      id: "leave-cave",
      target: { kind: "object", map: "MAP_EXIT", index: 0 },
    },
  });

  assert.equal(recommendation.kind, "move-toward");
  assert.equal(recommendation.direction, "east");
  assert.equal(recommendation.remainingSteps, 5);
});

test("campaign routing respects cartridge elevation and crosses by wildcard stairs", () => {
  const map = openMap("MAP_ELEVATED_ROUTE", {
    width: 5,
    height: 4,
    elevations: {
      "1,2": 4,
      "2,2": 4,
      "3,2": 0,
    },
    coordEvents: [{ x: 1, y: 1, script: "Goal_EventScript_Trigger" }],
  });
  const observation = campaignObservation({ map: map.id });
  observation.playerMemory.position = { x: 1, y: 2 };

  assert.deepEqual(campaignNavigationRecommendation({
    world: { maps: [map] },
    observation,
    objective: {
      id: "reach-elevated-trigger",
      target: { kind: "trigger", map: map.id, index: 0 },
    },
  }), {
    kind: "move-toward",
    direction: "east",
    pathSegment: {
      direction: "east",
      steps: 2,
      endpoint: { map: map.id, x: 3, y: 2 },
      continuationDirection: "north",
    },
    objective: "reach-elevated-trigger",
    targetMap: map.id,
    target: {
      kind: "trigger",
      index: 0,
      x: 1,
      y: 1,
      script: "Goal_EventScript_Trigger",
    },
    remainingSteps: 5,
  });
});

test("campaign routing treats Rocket Hideout spin tiles as forced movement", () => {
  const map = openMap("MAP_SPIN_FLOOR", {
    width: 5,
    height: 6,
    coordEvents: [{ x: 2, y: 4, script: "TargetTrigger" }],
    behaviors: {
      "2,2": "MB_STOP_SPINNING",
      "2,3": "MB_SPIN_UP",
    },
  });
  const observation = campaignObservation({ map: map.id });
  observation.playerMemory.position = { x: 2, y: 2 };

  const recommendation = campaignNavigationRecommendation({
    world: { maps: [map] },
    observation,
    objective: {
      id: "cross-spin-floor",
      target: { kind: "trigger", map: map.id, index: 0 },
    },
  });

  assert.equal(recommendation?.kind, "move-toward");
  assert.equal(recommendation?.direction, "east");
});

test("campaign routing collects an item ball that blocks the only route", () => {
  const walls = Object.fromEntries(
    Array.from({ length: 5 }, (_, y) => [
      [`0,${y}`, 1],
      [`2,${y}`, 1],
    ]).flat(),
  );
  const map = openMap("MAP_ITEM_CORRIDOR", {
    width: 3,
    height: 5,
    collisions: walls,
    objectEvents: [{
      x: 1,
      y: 2,
      graphics_id: "OBJ_EVENT_GFX_ITEM_BALL",
      script: "ItemCorridor_EventScript_Item",
      flag: "FLAG_HIDE_ITEM_CORRIDOR_ITEM",
    }],
    coordEvents: [{ x: 1, y: 4, script: "TargetTrigger" }],
  });
  const observation = campaignObservation({ map: map.id });
  observation.playerMemory.position = { x: 1, y: 1 };

  const recommendation = campaignNavigationRecommendation({
    world: { maps: [map] },
    observation,
    objective: {
      id: "cross-item-corridor",
      target: { kind: "trigger", map: map.id, index: 0 },
    },
  });

  assert.equal(recommendation?.kind, "interact-with-object");
  assert.equal(recommendation?.direction, "south");
  assert.equal(recommendation?.obstacle?.index, 0);
});

test("the map graph ignores landing-only warp records and uses an activating warp tile", () => {
  const world = { maps: [
    openMap("MAP_ROOM", {
      width: 8,
      height: 8,
      warpEvents: [
        { x: 3, y: 7, dest_map: "MAP_OUTSIDE", dest_warp_id: "0" },
        { x: 4, y: 7, dest_map: "MAP_OUTSIDE", dest_warp_id: "0" },
      ],
      behaviors: { "4,7": "MB_SOUTH_ARROW_WARP" },
    }),
    openMap("MAP_OUTSIDE", {
      warpEvents: [{ x: 2, y: 4, dest_map: "MAP_ROOM", dest_warp_id: "1" }],
      objectEvents: [{ x: 2, y: 2, script: "Outside_EventScript_Goal" }],
    }),
  ] };
  const observation = campaignObservation({ map: "MAP_ROOM" });
  observation.playerMemory.position = { x: 3, y: 7 };

  const recommendation = campaignNavigationRecommendation({
    world,
    observation,
    objective: {
      id: "leave-room",
      target: { kind: "object", map: "MAP_OUTSIDE", index: 0 },
    },
  });

  assert.equal(recommendation.kind, "move-toward");
  assert.equal(recommendation.direction, "east");
  assert.equal(recommendation.transit.x, 4);
  assert.equal(recommendation.transit.y, 7);
});

test("Silph Co routing takes the adjacent upward stair instead of returning to the prior floor", () => {
  const secondFloor = openMap("MAP_SILPH_CO_2F", {
    behaviors: {
      "1,1": "MB_UP_LEFT_STAIR_WARP",
      "3,3": "MB_REGULAR_WARP",
    },
    warpEvents: [
      { x: 1, y: 1, dest_map: "MAP_SILPH_CO_3F", dest_warp_id: "0" },
      { x: 3, y: 3, dest_map: "MAP_SILPH_CO_6F", dest_warp_id: "0" },
    ],
  });
  const thirdFloor = openMap("MAP_SILPH_CO_3F", {
    behaviors: {
      "1,1": "MB_DOWN_LEFT_STAIR_WARP",
      "3,1": "MB_UP_RIGHT_STAIR_WARP",
    },
    warpEvents: [
      { x: 1, y: 1, dest_map: secondFloor.id, dest_warp_id: "0" },
      { x: 3, y: 1, dest_map: "MAP_SILPH_CO_4F", dest_warp_id: "0" },
    ],
  });
  const fourthFloor = openMap("MAP_SILPH_CO_4F", {
    behaviors: {
      "1,1": "MB_DOWN_LEFT_STAIR_WARP",
      "3,3": "MB_REGULAR_WARP",
    },
    warpEvents: [
      { x: 1, y: 1, dest_map: thirdFloor.id, dest_warp_id: "1" },
      { x: 3, y: 3, dest_map: "MAP_SILPH_CO_6F", dest_warp_id: "1" },
    ],
  });
  const sixthFloor = openMap("MAP_SILPH_CO_6F", {
    behaviors: {
      "1,3": "MB_REGULAR_WARP",
      "3,1": "MB_DOWN_LEFT_STAIR_WARP",
    },
    warpEvents: [
      { x: 1, y: 3, dest_map: secondFloor.id, dest_warp_id: "1" },
      { x: 3, y: 1, dest_map: fourthFloor.id, dest_warp_id: "1" },
    ],
    objectEvents: [{ x: 4, y: 4, script: "SilphCo_6F_EventScript_Taylor" }],
  });
  const observation = campaignObservation({ map: thirdFloor.id });
  observation.playerMemory.position = { x: 1, y: 1 };

  assert.deepEqual(campaignNavigationRecommendation({
    world: { maps: [secondFloor, thirdFloor, fourthFloor, sixthFloor] },
    observation,
    objective: {
      id: "train-battle-member-with-trainer",
      target: { kind: "object", map: sixthFloor.id, index: 0 },
    },
  }), {
    kind: "move-toward",
    direction: "east",
    pathSegment: {
      direction: "east",
      steps: 2,
      endpoint: { map: thirdFloor.id, x: 3, y: 1 },
    },
    objective: "train-battle-member-with-trainer",
    targetMap: sixthFloor.id,
    transit: {
      kind: "warp",
      destinationMap: fourthFloor.id,
      x: 3,
      y: 1,
    },
    remainingSteps: 2,
  });
});

test("Silph Co routing returns through a target-floor teleporter before taking stairs", () => {
  const fifthFloor = openMap("MAP_SILPH_CO_5F", {
    behaviors: { "1,1": "MB_REGULAR_WARP" },
    warpEvents: [{
      x: 1,
      y: 1,
      dest_map: "MAP_SILPH_CO_9F",
      dest_warp_id: "0",
    }],
    objectEvents: [{
      x: 3,
      y: 3,
      script: "SilphCo_5F_EventScript_ItemCardKey",
    }],
  });
  const eighthFloor = openMap("MAP_SILPH_CO_8F", {
    behaviors: { "1,1": "MB_UP_LEFT_STAIR_WARP" },
    warpEvents: [{
      x: 1,
      y: 1,
      dest_map: "MAP_SILPH_CO_9F",
      dest_warp_id: "1",
    }],
  });
  const ninthFloor = openMap("MAP_SILPH_CO_9F", {
    behaviors: {
      "1,1": "MB_REGULAR_WARP",
      "3,1": "MB_DOWN_LEFT_STAIR_WARP",
    },
    warpEvents: [
      {
        x: 1,
        y: 1,
        dest_map: fifthFloor.id,
        dest_warp_id: "0",
      },
      {
        x: 3,
        y: 1,
        dest_map: eighthFloor.id,
        dest_warp_id: "0",
      },
    ],
  });
  const observation = campaignObservation({ map: ninthFloor.id });
  observation.playerMemory.position = { x: 1, y: 1 };

  assert.deepEqual(campaignNavigationRecommendation({
    world: { maps: [fifthFloor, eighthFloor, ninthFloor] },
    observation,
    objective: {
      id: "silph-card-key",
      target: { kind: "object", map: fifthFloor.id, index: 0 },
    },
  }), {
    kind: "reenter-map-warp",
    direction: "south",
    objective: "silph-card-key",
    targetMap: fifthFloor.id,
    transit: {
      kind: "warp",
      destinationMap: fifthFloor.id,
      x: 1,
      y: 1,
    },
    remainingSteps: 0,
  });
});

test("Silph Co routing shuttles around a teleporter blocking its target floor", () => {
  const corridorWalls = Object.fromEntries(
    Array.from({ length: 7 }, (_, x) => [
      [`${x},0`, 1],
      [`${x},2`, 1],
    ]).flat(),
  );
  const fifthFloor = openMap("MAP_SILPH_CO_5F", {
    width: 7,
    height: 3,
    collisions: corridorWalls,
    behaviors: {
      "1,1": "MB_REGULAR_WARP",
      "3,1": "MB_REGULAR_WARP",
    },
    warpEvents: [
      {
        x: 1,
        y: 1,
        dest_map: "MAP_SILPH_CO_3F",
        dest_warp_id: "0",
      },
      {
        x: 3,
        y: 1,
        dest_map: "MAP_SILPH_CO_9F",
        dest_warp_id: "0",
      },
    ],
    objectEvents: [{
      x: 5,
      y: 1,
      script: "SilphCo_5F_EventScript_ItemCardKey",
    }],
  });
  const thirdFloor = openMap("MAP_SILPH_CO_3F", {
    width: 3,
    height: 3,
    behaviors: { "1,1": "MB_REGULAR_WARP" },
    warpEvents: [{
      x: 1,
      y: 1,
      dest_map: fifthFloor.id,
      dest_warp_id: "0",
    }],
  });
  const ninthFloor = openMap("MAP_SILPH_CO_9F", {
    width: 3,
    height: 3,
    behaviors: { "1,1": "MB_REGULAR_WARP" },
    warpEvents: [{
      x: 1,
      y: 1,
      dest_map: fifthFloor.id,
      dest_warp_id: "1",
    }],
  });
  const observation = campaignObservation({ map: fifthFloor.id });
  observation.playerMemory.position = { x: 1, y: 1 };

  assert.deepEqual(campaignNavigationRecommendation({
    world: { maps: [thirdFloor, fifthFloor, ninthFloor] },
    observation,
    objective: {
      id: "silph-card-key",
      target: { kind: "object", map: fifthFloor.id, index: 0 },
    },
  }), {
    kind: "move-toward",
    direction: "east",
    pathSegment: {
      direction: "east",
      steps: 2,
      endpoint: { map: fifthFloor.id, x: 3, y: 1 },
    },
    objective: "silph-card-key",
    targetMap: fifthFloor.id,
    transit: {
      kind: "warp",
      destinationMap: ninthFloor.id,
      x: 3,
      y: 1,
    },
    remainingSteps: 2,
  });
});

test("Silph Co routing leaves a non-target landing pad through another reachable pad", () => {
  const firstFloor = openMap("MAP_SILPH_CO_1F", {
    objectEvents: [{ x: 3, y: 3, script: "SilphCo_1F_EventScript_Target" }],
  });
  const thirdFloor = openMap("MAP_SILPH_CO_3F", {
    behaviors: { "1,1": "MB_REGULAR_WARP" },
    warpEvents: [{
      x: 1,
      y: 1,
      dest_map: "MAP_SILPH_CO_7F",
      dest_warp_id: "1",
    }],
  });
  const seventhFloor = openMap("MAP_SILPH_CO_7F", {
    behaviors: {
      "1,1": "MB_REGULAR_WARP",
      "1,3": "MB_REGULAR_WARP",
    },
    warpEvents: [
      {
        x: 1,
        y: 1,
        dest_map: "MAP_SILPH_CO_11F",
        dest_warp_id: "0",
      },
      {
        x: 1,
        y: 3,
        dest_map: thirdFloor.id,
        dest_warp_id: "0",
      },
    ],
  });
  const eleventhFloor = openMap("MAP_SILPH_CO_11F", {
    behaviors: { "1,1": "MB_REGULAR_WARP" },
    warpEvents: [{
      x: 1,
      y: 1,
      dest_map: seventhFloor.id,
      dest_warp_id: "0",
    }],
  });
  const observation = campaignObservation({ map: seventhFloor.id });
  observation.playerMemory.position = { x: 1, y: 1 };

  const recommendation = campaignNavigationRecommendation({
    world: { maps: [firstFloor, thirdFloor, seventhFloor, eleventhFloor] },
    observation,
    objective: {
      id: "leave-silph-landing-pad",
      target: { kind: "object", map: firstFloor.id, index: 0 },
    },
  });

  assert.equal(recommendation?.transit?.destinationMap, thirdFloor.id);
});

test("Silph Co routing rejects a target-floor pad landing in the wrong collision region", () => {
  const thirdFloor = openMap("MAP_SILPH_CO_3F", {
    width: 7,
    behaviors: {
      "1,1": "MB_REGULAR_WARP",
      "5,1": "MB_UP_LEFT_STAIR_WARP",
    },
    warpEvents: [
      {
        x: 1,
        y: 1,
        dest_map: "MAP_SILPH_CO_7F",
        dest_warp_id: "0",
      },
      {
        x: 5,
        y: 1,
        dest_map: "MAP_SILPH_CO_4F",
        dest_warp_id: "0",
      },
    ],
  });
  const fourthFloor = openMap("MAP_SILPH_CO_4F", {
    width: 7,
    behaviors: {
      "1,1": "MB_DOWN_LEFT_STAIR_WARP",
      "5,1": "MB_UP_LEFT_STAIR_WARP",
    },
    warpEvents: [
      {
        x: 1,
        y: 1,
        dest_map: thirdFloor.id,
        dest_warp_id: "1",
      },
      {
        x: 5,
        y: 1,
        dest_map: "MAP_SILPH_CO_7F",
        dest_warp_id: "1",
      },
    ],
  });
  const seventhFloor = openMap("MAP_SILPH_CO_7F", {
    width: 7,
    collisions: Object.fromEntries(
      Array.from({ length: 5 }, (_, y) => [`3,${y}`, 1]),
    ),
    behaviors: {
      "1,1": "MB_REGULAR_WARP",
      "5,1": "MB_DOWN_LEFT_STAIR_WARP",
    },
    warpEvents: [
      {
        x: 1,
        y: 1,
        dest_map: thirdFloor.id,
        dest_warp_id: "0",
      },
      {
        x: 5,
        y: 1,
        dest_map: fourthFloor.id,
        dest_warp_id: "1",
      },
    ],
    objectEvents: [{
      x: 5,
      y: 3,
      script: "SilphCo_7F_EventScript_Trainer",
    }],
  });
  const observation = campaignObservation({ map: thirdFloor.id });
  observation.playerMemory.position = { x: 1, y: 2 };

  const recommendation = campaignNavigationRecommendation({
    world: { maps: [thirdFloor, fourthFloor, seventhFloor] },
    observation,
    objective: {
      id: "train-battle-member-with-trainer",
      target: { kind: "object", map: seventhFloor.id, index: 0 },
    },
  });

  assert.equal(recommendation?.transit?.destinationMap, fourthFloor.id);
});

test("Silph Co skips a target-floor stair that lands outside the objective region", () => {
  const tenthFloor = openMap("MAP_SILPH_CO_10F", {
    behaviors: {
      "1,1": "MB_UP_LEFT_STAIR_WARP",
      "3,1": "MB_DOWN_RIGHT_STAIR_WARP",
    },
    warpEvents: [
      {
        x: 1,
        y: 1,
        dest_map: "MAP_SILPH_CO_11F",
        dest_warp_id: "0",
      },
      {
        x: 3,
        y: 1,
        dest_map: "MAP_SILPH_CO_9F",
        dest_warp_id: "0",
      },
    ],
  });
  const ninthFloor = openMap("MAP_SILPH_CO_9F", {
    behaviors: {
      "3,1": "MB_UP_LEFT_STAIR_WARP",
      "1,3": "MB_REGULAR_WARP",
    },
    warpEvents: [
      {
        x: 3,
        y: 1,
        dest_map: tenthFloor.id,
        dest_warp_id: "1",
      },
      {
        x: 1,
        y: 3,
        dest_map: "MAP_SILPH_CO_7F",
        dest_warp_id: "0",
      },
    ],
  });
  const seventhFloor = openMap("MAP_SILPH_CO_7F", {
    behaviors: {
      "1,1": "MB_REGULAR_WARP",
      "3,3": "MB_REGULAR_WARP",
    },
    warpEvents: [
      {
        x: 1,
        y: 1,
        dest_map: ninthFloor.id,
        dest_warp_id: "1",
      },
      {
        x: 3,
        y: 3,
        dest_map: "MAP_SILPH_CO_11F",
        dest_warp_id: "1",
      },
    ],
  });
  const eleventhFloor = openMap("MAP_SILPH_CO_11F", {
    collisions: Object.fromEntries(
      Array.from({ length: 5 }, (_, y) => [`2,${y}`, 1]),
    ),
    behaviors: {
      "3,1": "MB_DOWN_LEFT_STAIR_WARP",
      "1,1": "MB_REGULAR_WARP",
    },
    warpEvents: [
      {
        x: 3,
        y: 1,
        dest_map: tenthFloor.id,
        dest_warp_id: "0",
      },
      {
        x: 1,
        y: 1,
        dest_map: seventhFloor.id,
        dest_warp_id: "1",
      },
    ],
    coordEvents: [{
      x: 1,
      y: 3,
      script: "SilphCo_11F_EventScript_GiovanniTriggerLeft",
    }],
  });
  const observation = campaignObservation({ map: tenthFloor.id });
  observation.playerMemory.position = { x: 1, y: 1 };

  const recommendation = campaignNavigationRecommendation({
    world: {
      maps: [ninthFloor, tenthFloor, seventhFloor, eleventhFloor],
    },
    observation,
    objective: {
      id: "silph-liberated",
      target: { kind: "trigger", map: eleventhFloor.id, index: 0 },
    },
  });

  assert.equal(recommendation?.direction, "east");
  assert.equal(recommendation?.transit?.destinationMap, ninthFloor.id);
});

test("Silph Co routing never relabels a transit to a disconnected teleporter", () => {
  const thirdFloor = openMap("MAP_SILPH_CO_3F", {
    behaviors: { "1,1": "MB_REGULAR_WARP" },
    warpEvents: [{
      x: 1,
      y: 1,
      dest_map: "MAP_SILPH_CO_7F",
      dest_warp_id: "0",
    }],
    objectEvents: [{
      x: 3,
      y: 3,
      script: "SilphCo_3F_EventScript_Door2",
    }],
  });
  const sixthFloor = openMap("MAP_SILPH_CO_6F", {
    behaviors: { "1,1": "MB_UP_LEFT_STAIR_WARP" },
    warpEvents: [{
      x: 1,
      y: 1,
      dest_map: "MAP_SILPH_CO_7F",
      dest_warp_id: "2",
    }],
  });
  const eighthFloor = openMap("MAP_SILPH_CO_8F", {
    behaviors: { "1,1": "MB_DOWN_RIGHT_STAIR_WARP" },
    warpEvents: [{
      x: 1,
      y: 1,
      dest_map: "MAP_SILPH_CO_7F",
      dest_warp_id: "0",
    }],
  });
  const wall = Object.fromEntries(
    Array.from({ length: 5 }, (_, y) => [`2,${y}`, 1]),
  );
  const seventhFloor = openMap("MAP_SILPH_CO_7F", {
    collisions: wall,
    behaviors: {
      "1,1": "MB_REGULAR_WARP",
      "3,1": "MB_UP_RIGHT_STAIR_WARP",
      "3,3": "MB_DOWN_LEFT_STAIR_WARP",
    },
    warpEvents: [
      {
        x: 1,
        y: 1,
        dest_map: thirdFloor.id,
        dest_warp_id: "0",
      },
      {
        x: 3,
        y: 1,
        dest_map: eighthFloor.id,
        dest_warp_id: "0",
      },
      {
        x: 3,
        y: 3,
        dest_map: sixthFloor.id,
        dest_warp_id: "0",
      },
    ],
  });
  const observation = campaignObservation({ map: seventhFloor.id });
  observation.playerMemory.position = { x: 3, y: 1 };

  const recommendation = campaignNavigationRecommendation({
    world: { maps: [thirdFloor, sixthFloor, seventhFloor, eighthFloor] },
    observation,
    objective: {
      id: "silph-third-floor-door-two",
      target: { kind: "object", map: thirdFloor.id, index: 0 },
    },
  });

  assert.equal(recommendation?.kind, "move-toward");
  assert.equal(recommendation?.direction, "south");
  assert.equal(recommendation?.transit?.destinationMap, sixthFloor.id);
});

test("Silph Co elevator selects 1F for an outside objective and exits", () => {
  const elevator = openMap("MAP_SILPH_CO_ELEVATOR", {
    width: 5,
    height: 7,
    behaviors: { "2,5": "MB_SOUTH_ARROW_WARP" },
    warpEvents: [{
      x: 2,
      y: 5,
      dest_map: "MAP_DYNAMIC",
      dest_warp_id: "WARP_ID_DYNAMIC",
    }],
    backgroundEvents: [{
      x: 0,
      y: 2,
      script: "SilphCo_Elevator_EventScript_FloorSelect",
    }],
  });
  const departmentStore = openMap("MAP_CELADON_CITY_DEPARTMENT_STORE_2F", {
    objectEvents: [{
      x: 3,
      y: 3,
      script: "CeladonCity_DepartmentStore_2F_EventScript_Clerk",
    }],
  });
  const objective = {
    id: "silph-coverage-tm",
    target: {
      kind: "purchase-items",
      map: departmentStore.id,
      objectIndex: 0,
      items: [{ itemId: 331, stockIndex: 4, quantity: 1 }],
    },
  };
  const observation = campaignObservation({
    map: elevator.id,
    variables: { 0x403a: 11 },
    flags: { 2: false },
  });
  observation.playerMemory.position = { x: 1, y: 2 };

  assert.equal(campaignNavigationRecommendation({
    world: { maps: [elevator, departmentStore] }, observation, objective,
  })?.kind, "interact-with-background");

  observation.playerMemory.storyState.variableIds[0x403a] = 4;
  // Selecting the elevator's current floor sets the dynamic warp but skips the
  // movement animation, so FLAG_TEMP_2 legitimately remains clear.
  observation.playerMemory.storyState.flagIds[2] = false;
  observation.playerMemory.position = { x: 2, y: 4 };
  assert.deepEqual(campaignNavigationRecommendation({
    world: { maps: [elevator, departmentStore] }, observation, objective,
  }), {
    kind: "move-toward",
    direction: "south",
    objective: objective.id,
    targetMap: departmentStore.id,
    target: { kind: "warp", index: 0, x: 2, y: 5 },
    remainingSteps: 1,
    silphCoElevatorFloor: 1,
    silphCoElevatorPhase: "exit-on-1f",
  });
});

test("Silph Co 1F leaves through Saffron instead of reentering its elevator", () => {
  const firstFloor = openMap("MAP_SILPH_CO_1F", {
    width: 10,
    height: 8,
    behaviors: {
      "1,6": "MB_SOUTH_ARROW_WARP",
      "8,1": "MB_WARP_DOOR",
    },
    warpEvents: [
      { x: 1, y: 6, dest_map: "MAP_SAFFRON_CITY", dest_warp_id: "0" },
      { x: 8, y: 1, dest_map: "MAP_SILPH_CO_ELEVATOR", dest_warp_id: "0" },
    ],
  });
  const saffron = openMap("MAP_SAFFRON_CITY", {
    warpEvents: [{
      x: 2,
      y: 2,
      dest_map: firstFloor.id,
      dest_warp_id: "0",
    }],
  });
  const elevator = openMap("MAP_SILPH_CO_ELEVATOR", {
    behaviors: { "2,4": "MB_SOUTH_ARROW_WARP" },
    warpEvents: [{
      x: 2,
      y: 4,
      dest_map: "MAP_DYNAMIC",
      dest_warp_id: "WARP_ID_DYNAMIC",
    }],
  });
  const observation = campaignObservation({ map: firstFloor.id });
  observation.playerMemory.position = { x: 8, y: 2 };

  const recommendation = campaignNavigationRecommendation({
    world: { maps: [firstFloor, saffron, elevator] },
    observation,
    objective: {
      id: "leave-silph",
      target: { kind: "map-arrival", map: saffron.id, x: 2, y: 2 },
    },
  });

  assert.equal(recommendation?.transit?.destinationMap, saffron.id);
});

test("Silph Co routing unlocks the extracted Card Key door blocking its local target", () => {
  const collisions = Object.fromEntries(
    Array.from({ length: 7 }, (_, y) => [`3,${y}`, y === 3 ? 0 : 1]),
  );
  const floor = openMap("MAP_SILPH_CO_2F", {
    width: 7,
    height: 7,
    collisions,
    backgroundEvents: [{
      x: 3,
      y: 3,
      type: "sign",
      script: "SilphCo_2F_EventScript_Door1",
      player_facing_dir: "BG_EVENT_PLAYER_FACING_ANY",
    }],
    objectEvents: [{
      x: 5,
      y: 3,
      script: "SilphCo_2F_EventScript_Trainer",
    }],
  });
  const observation = campaignObservation({
    map: floor.id,
    bag: { keyItems: [{ itemId: 355, quantity: 1 }] },
  });
  observation.playerMemory.position = { x: 1, y: 3 };
  observation.playerMemory.mapGrid = {
    width: floor.layout.width,
    height: floor.layout.height,
    cells: floor.layout.cells.map((cell) =>
      cell.x === 3 && cell.y === 3
        ? { ...cell, collision: 3 }
        : cell
    ),
  };
  const objective = {
    id: "train-battle-member-with-trainer",
    target: { kind: "object", map: floor.id, index: 0 },
  };

  assert.deepEqual(campaignNavigationRecommendation({
    world: { maps: [floor] },
    observation,
    objective,
  }), {
    kind: "move-toward",
    direction: "east",
    objective: objective.id,
    targetMap: floor.id,
    target: {
      kind: "background",
      index: 0,
      x: 3,
      y: 3,
      script: "SilphCo_2F_EventScript_Door1",
    },
    remainingSteps: 1,
  });

  observation.playerMemory.position = { x: 2, y: 3 };
  assert.deepEqual(campaignNavigationRecommendation({
    world: { maps: [floor] },
    observation,
    objective,
  }), {
    kind: "interact-with-background",
    direction: "east",
    objective: objective.id,
    targetMap: floor.id,
    target: {
      kind: "background",
      index: 0,
      x: 3,
      y: 3,
      script: "SilphCo_2F_EventScript_Door1",
    },
    remainingSteps: 0,
  });
});

test("Silph Co routing unlocks the first door in a cartridge-defined multi-door path", () => {
  const collisions = Object.fromEntries([
    ...Array.from({ length: 7 }, (_, y) => [`3,${y}`, y === 3 ? 0 : 1]),
    ...Array.from({ length: 7 }, (_, y) => [`5,${y}`, y === 3 ? 0 : 1]),
  ]);
  const floor = openMap("MAP_SILPH_CO_9F", {
    width: 9,
    height: 7,
    collisions,
    backgroundEvents: [
      {
        x: 5,
        y: 3,
        type: "sign",
        script: "SilphCo_9F_EventScript_Door1",
        player_facing_dir: "BG_EVENT_PLAYER_FACING_ANY",
      },
      {
        x: 3,
        y: 3,
        type: "sign",
        script: "SilphCo_9F_EventScript_Door2",
        player_facing_dir: "BG_EVENT_PLAYER_FACING_ANY",
      },
    ],
    objectEvents: [{
      x: 7,
      y: 3,
      script: "SilphCo_9F_EventScript_Trainer",
    }],
  });
  const observation = campaignObservation({
    map: floor.id,
    bag: { keyItems: [{ itemId: 355, quantity: 1 }] },
  });
  observation.playerMemory.position = { x: 1, y: 3 };
  observation.playerMemory.mapGrid = {
    width: floor.layout.width,
    height: floor.layout.height,
    cells: floor.layout.cells.map((cell) =>
      ["3,3", "5,3"].includes(`${cell.x},${cell.y}`)
        ? { ...cell, collision: 3 }
        : cell
    ),
  };

  assert.deepEqual(campaignNavigationRecommendation({
    world: { maps: [floor] },
    observation,
    objective: {
      id: "train-battle-member-with-trainer",
      target: { kind: "object", map: floor.id, index: 0 },
    },
  }), {
    kind: "move-toward",
    direction: "east",
    objective: "train-battle-member-with-trainer",
    targetMap: floor.id,
    target: {
      kind: "background",
      index: 1,
      x: 3,
      y: 3,
      script: "SilphCo_9F_EventScript_Door2",
    },
    remainingSteps: 1,
  });
});

test("Silph Co routing escapes an isolated teleporter before taking stairs to an outside goal", () => {
  const secondFloor = openMap("MAP_SILPH_CO_2F", {
    behaviors: {
      "1,1": "MB_REGULAR_WARP",
      "3,1": "MB_DOWN_RIGHT_STAIR_WARP",
    },
    warpEvents: [
      { x: 1, y: 1, dest_map: "MAP_SILPH_CO_6F", dest_warp_id: "0" },
      { x: 3, y: 1, dest_map: "MAP_SILPH_CO_1F", dest_warp_id: "0" },
    ],
  });
  const thirdFloor = openMap("MAP_SILPH_CO_3F", {
    behaviors: {
      "1,1": "MB_UP_LEFT_STAIR_WARP",
      "3,1": "MB_DOWN_RIGHT_STAIR_WARP",
    },
    warpEvents: [
      { x: 1, y: 1, dest_map: "MAP_SILPH_CO_4F", dest_warp_id: "1" },
      { x: 3, y: 1, dest_map: secondFloor.id, dest_warp_id: "1" },
    ],
  });
  const fourthFloor = openMap("MAP_SILPH_CO_4F", {
    behaviors: {
      "1,1": "MB_UP_LEFT_STAIR_WARP",
      "3,1": "MB_DOWN_RIGHT_STAIR_WARP",
    },
    warpEvents: [
      { x: 1, y: 1, dest_map: "MAP_SILPH_CO_5F", dest_warp_id: "1" },
      { x: 3, y: 1, dest_map: thirdFloor.id, dest_warp_id: "0" },
    ],
  });
  const fifthFloor = openMap("MAP_SILPH_CO_5F", {
    behaviors: {
      "1,1": "MB_UP_LEFT_STAIR_WARP",
      "3,1": "MB_DOWN_RIGHT_STAIR_WARP",
    },
    warpEvents: [
      { x: 1, y: 1, dest_map: "MAP_SILPH_CO_6F", dest_warp_id: "1" },
      { x: 3, y: 1, dest_map: fourthFloor.id, dest_warp_id: "0" },
    ],
  });
  const sixthFloor = openMap("MAP_SILPH_CO_6F", {
    behaviors: {
      "1,1": "MB_REGULAR_WARP",
      "3,1": "MB_DOWN_RIGHT_STAIR_WARP",
    },
    warpEvents: [
      { x: 1, y: 1, dest_map: secondFloor.id, dest_warp_id: "0" },
      { x: 3, y: 1, dest_map: fifthFloor.id, dest_warp_id: "0" },
    ],
  });
  const firstFloor = openMap("MAP_SILPH_CO_1F", {
    behaviors: {
      "1,1": "MB_UP_LEFT_STAIR_WARP",
      "3,4": "MB_SOUTH_ARROW_WARP",
    },
    warpEvents: [
      { x: 1, y: 1, dest_map: secondFloor.id, dest_warp_id: "1" },
      { x: 3, y: 4, dest_map: "MAP_SAFFRON_CITY", dest_warp_id: "0" },
    ],
  });
  const saffron = openMap("MAP_SAFFRON_CITY", {
    behaviors: { "3,0": "MB_NORTH_ARROW_WARP" },
    warpEvents: [{ x: 3, y: 0, dest_map: firstFloor.id, dest_warp_id: "1" }],
    objectEvents: [{ x: 4, y: 4, script: "SaffronCity_EventScript_Goal" }],
  });
  const world = {
    maps: [
      firstFloor,
      secondFloor,
      thirdFloor,
      fourthFloor,
      fifthFloor,
      sixthFloor,
      saffron,
    ],
  };
  const observation = campaignObservation({ map: secondFloor.id });
  observation.playerMemory.position = { x: 1, y: 1 };
  observation.playerMemory.mapGrid = {
    width: secondFloor.layout.width,
    height: secondFloor.layout.height,
    cells: secondFloor.layout.cells.map((cell) => ({
      ...cell,
      collision: cell.x === 2 ? 1 : cell.collision,
    })),
  };
  const objective = {
    id: "silph-supplies",
    target: { kind: "object", map: saffron.id, index: 0 },
  };

  assert.deepEqual(campaignNavigationRecommendation({
    world,
    observation,
    objective,
  }), {
    kind: "reenter-map-warp",
    direction: "south",
    objective: objective.id,
    targetMap: saffron.id,
    transit: {
      kind: "warp",
      destinationMap: sixthFloor.id,
      x: 1,
      y: 1,
    },
    remainingSteps: 0,
  });

  observation.playerMemory.position = { x: 1, y: 2 };
  assert.deepEqual(campaignNavigationRecommendation({
    world,
    observation,
    objective,
  }), {
    kind: "move-toward",
    direction: "north",
    objective: objective.id,
    targetMap: saffron.id,
    transit: {
      kind: "warp",
      destinationMap: sixthFloor.id,
      x: 1,
      y: 1,
    },
    remainingSteps: 1,
  });
});

test("cross-map routing never takes a reachable door that increases target distance", () => {
  const corridorWalls = Object.fromEntries(
    Array.from({ length: 5 }, (_, y) => [[`0,${y}`, 1], [`2,${y}`, 1]]).flat(),
  );
  const world = { maps: [
    openMap("MAP_START", {
      width: 3,
      height: 5,
      collisions: corridorWalls,
      behaviors: { "1,0": "MB_WARP_DOOR" },
      warpEvents: [{
        x: 1,
        y: 0,
        dest_map: "MAP_SIDE_ROOM",
        dest_warp_id: "0",
      }],
      connections: [{ direction: "down", map: "MAP_GOAL", offset: 0 }],
    }),
    openMap("MAP_SIDE_ROOM", {
      width: 3,
      height: 3,
      behaviors: { "1,2": "MB_SOUTH_ARROW_WARP" },
      warpEvents: [{
        x: 1,
        y: 2,
        dest_map: "MAP_START",
        dest_warp_id: "0",
      }],
    }),
    openMap("MAP_GOAL", {
      width: 3,
      height: 3,
      connections: [{ direction: "up", map: "MAP_START", offset: 0 }],
      objectEvents: [{ x: 1, y: 1, script: "Goal_EventScript_Target" }],
    }),
  ] };
  const observation = campaignObservation({ map: "MAP_START" });
  observation.playerMemory.position = { x: 1, y: 1 };
  observation.playerMemory.objectEvents = [{
    id: 2,
    player: false,
    localId: 9,
    current: { x: 1, y: 2 },
    previous: { x: 1, y: 2 },
  }];

  assert.equal(campaignNavigationRecommendation({
    world,
    observation,
    objective: {
      id: "reach-goal",
      target: { kind: "object", map: "MAP_GOAL", index: 0 },
    },
  }), null);
});

test("cross-map routing takes an acyclic detour when the optimistic exit is locally blocked", () => {
  const corridorWalls = Object.fromEntries(
    Array.from({ length: 5 }, (_, y) => [[`0,${y}`, 1], [`2,${y}`, 1]]).flat(),
  );
  const start = openMap("MAP_START", {
    width: 3,
    height: 5,
    collisions: corridorWalls,
    behaviors: { "1,0": "MB_WARP_DOOR" },
    warpEvents: [{
      x: 1,
      y: 0,
      dest_map: "MAP_SIDE_ROOM",
      dest_warp_id: "0",
    }],
    connections: [{ direction: "down", map: "MAP_GOAL", offset: 0 }],
  });
  const sideRoom = openMap("MAP_SIDE_ROOM", {
    behaviors: { "1,1": "MB_LADDER", "3,1": "MB_LADDER" },
    warpEvents: [
      { x: 1, y: 1, dest_map: start.id, dest_warp_id: "0" },
      { x: 3, y: 1, dest_map: "MAP_BRIDGE", dest_warp_id: "0" },
    ],
  });
  const bridge = openMap("MAP_BRIDGE", {
    behaviors: { "1,1": "MB_LADDER", "3,1": "MB_LADDER" },
    warpEvents: [
      { x: 1, y: 1, dest_map: sideRoom.id, dest_warp_id: "1" },
      { x: 3, y: 1, dest_map: "MAP_GOAL", dest_warp_id: "0" },
    ],
  });
  const goal = openMap("MAP_GOAL", {
    behaviors: { "1,1": "MB_LADDER" },
    warpEvents: [{ x: 1, y: 1, dest_map: bridge.id, dest_warp_id: "1" }],
    connections: [{ direction: "up", map: start.id, offset: 0 }],
    objectEvents: [{ x: 3, y: 3, script: "Goal_EventScript_Target" }],
  });
  const observation = campaignObservation({ map: start.id });
  observation.playerMemory.position = { x: 1, y: 1 };
  observation.playerMemory.objectEvents = [{
    id: 2,
    player: false,
    localId: 9,
    current: { x: 1, y: 2 },
    previous: { x: 1, y: 2 },
  }];

  assert.deepEqual(campaignNavigationRecommendation({
    world: { maps: [start, sideRoom, bridge, goal] },
    observation,
    objective: {
      id: "reach-goal",
      target: { kind: "object", map: goal.id, index: 0 },
    },
  }), {
    kind: "traverse-door-warp",
    direction: "north",
    objective: "reach-goal",
    targetMap: goal.id,
    transit: {
      kind: "warp",
      destinationMap: sideRoom.id,
      x: 1,
      y: 0,
    },
    remainingSteps: 0,
  });
});

test("cross-map routing does not rank an unavailable Cut shortcut as progress", () => {
  const wall = Object.fromEntries(
    Array.from({ length: 5 }, (_, x) => [`${x},2`, x === 2 ? 0 : 1]),
  );
  const center = openMap("MAP_CENTER", {
    collisions: wall,
    behaviors: {
      "1,3": "MB_LADDER",
      "1,1": "MB_LADDER",
    },
    warpEvents: [
      { x: 1, y: 3, dest_map: "MAP_EAST", dest_warp_id: "0" },
      { x: 1, y: 1, dest_map: "MAP_GOAL", dest_warp_id: "0" },
    ],
    objectEvents: [{
      x: 2,
      y: 2,
      graphics_id: "OBJ_EVENT_GFX_CUT_TREE",
      script: "EventScript_CutTree",
    }],
  });
  const east = openMap("MAP_EAST", {
    behaviors: { "1,1": "MB_LADDER", "3,1": "MB_LADDER" },
    warpEvents: [
      { x: 1, y: 1, dest_map: center.id, dest_warp_id: "0" },
      { x: 3, y: 1, dest_map: "MAP_NORTH", dest_warp_id: "0" },
    ],
  });
  const north = openMap("MAP_NORTH", {
    behaviors: { "1,1": "MB_LADDER", "3,1": "MB_LADDER" },
    warpEvents: [
      { x: 1, y: 1, dest_map: east.id, dest_warp_id: "1" },
      { x: 3, y: 1, dest_map: "MAP_GOAL", dest_warp_id: "1" },
    ],
  });
  const goal = openMap("MAP_GOAL", {
    behaviors: { "1,1": "MB_LADDER", "2,1": "MB_LADDER" },
    warpEvents: [
      { x: 1, y: 1, dest_map: center.id, dest_warp_id: "1" },
      { x: 2, y: 1, dest_map: north.id, dest_warp_id: "1" },
    ],
    objectEvents: [{ x: 3, y: 3, script: "Goal_EventScript_Target" }],
  });
  const observation = campaignObservation({ map: east.id });
  observation.playerMemory.position = { x: 1, y: 1 };

  assert.deepEqual(campaignNavigationRecommendation({
    world: { maps: [center, east, north, goal] },
    observation,
    objective: {
      id: "reach-goal",
      target: { kind: "object", map: goal.id, index: 0 },
    },
  }), {
    kind: "move-toward",
    direction: "east",
    pathSegment: {
      direction: "east",
      steps: 2,
      endpoint: { map: east.id, x: 3, y: 1 },
    },
    objective: "reach-goal",
    targetMap: goal.id,
    transit: {
      kind: "warp",
      destinationMap: north.id,
      x: 3,
      y: 1,
    },
    remainingSteps: 2,
  });
});

test("cross-map routing does not rank an unavailable Surf shortcut as progress", () => {
  const waterBarrier = Object.fromEntries(
    Array.from({ length: 5 }, (_, x) => [`${x},2`, "MB_POND_WATER"]),
  );
  const center = openMap("MAP_CENTER", {
    behaviors: {
      ...waterBarrier,
      "1,3": "MB_LADDER",
      "1,1": "MB_LADDER",
    },
    warpEvents: [
      { x: 1, y: 3, dest_map: "MAP_EAST", dest_warp_id: "0" },
      { x: 1, y: 1, dest_map: "MAP_GOAL", dest_warp_id: "0" },
    ],
  });
  const east = openMap("MAP_EAST", {
    behaviors: { "1,1": "MB_LADDER", "3,1": "MB_LADDER" },
    warpEvents: [
      { x: 1, y: 1, dest_map: center.id, dest_warp_id: "0" },
      { x: 3, y: 1, dest_map: "MAP_NORTH", dest_warp_id: "0" },
    ],
  });
  const north = openMap("MAP_NORTH", {
    behaviors: { "1,1": "MB_LADDER", "3,1": "MB_LADDER" },
    warpEvents: [
      { x: 1, y: 1, dest_map: east.id, dest_warp_id: "1" },
      { x: 3, y: 1, dest_map: "MAP_GOAL", dest_warp_id: "1" },
    ],
  });
  const goal = openMap("MAP_GOAL", {
    behaviors: { "1,1": "MB_LADDER", "2,1": "MB_LADDER" },
    warpEvents: [
      { x: 1, y: 1, dest_map: center.id, dest_warp_id: "1" },
      { x: 2, y: 1, dest_map: north.id, dest_warp_id: "1" },
    ],
    objectEvents: [{ x: 3, y: 3, script: "Goal_EventScript_Target" }],
  });
  const observation = campaignObservation({ map: east.id });
  observation.playerMemory.position = { x: 1, y: 1 };

  assert.deepEqual(campaignNavigationRecommendation({
    world: { maps: [center, east, north, goal] },
    observation,
    objective: {
      id: "reach-goal",
      target: { kind: "object", map: goal.id, index: 0 },
    },
  }), {
    kind: "move-toward",
    direction: "east",
    pathSegment: {
      direction: "east",
      steps: 2,
      endpoint: { map: east.id, x: 3, y: 1 },
    },
    objective: "reach-goal",
    targetMap: goal.id,
    transit: {
      kind: "warp",
      destinationMap: north.id,
      x: 3,
      y: 1,
    },
    remainingSteps: 2,
  });
});

test("cross-map routing uses an exit exposed by a live opened barrier", () => {
  const barrier = Object.fromEntries(
    Array.from({ length: 5 }, (_, x) => [`${x},3`, 1]),
  );
  const room = openMap("MAP_DYNAMIC_ROOM", {
    width: 5,
    height: 7,
    collisions: barrier,
    behaviors: { "2,6": "MB_SOUTH_ARROW_WARP" },
    warpEvents: [{
      x: 2,
      y: 6,
      dest_map: "MAP_OUTSIDE",
      dest_warp_id: "0",
    }],
  });
  const outside = openMap("MAP_OUTSIDE", {
    width: 5,
    height: 5,
    behaviors: { "2,0": "MB_NORTH_ARROW_WARP" },
    warpEvents: [{
      x: 2,
      y: 0,
      dest_map: "MAP_DYNAMIC_ROOM",
      dest_warp_id: "0",
    }],
    objectEvents: [{ x: 2, y: 3, script: "Goal_EventScript_Target" }],
  });
  const observation = campaignObservation({ map: room.id });
  observation.playerMemory.position = { x: 2, y: 1 };
  observation.playerMemory.mapGrid = {
    width: room.layout.width,
    height: room.layout.height,
    cells: room.layout.cells.map((cell) =>
      cell.x === 2 && cell.y === 3 ? { ...cell, collision: 0 } : cell
    ),
  };

  for (const [position, remainingSteps] of [
    [{ x: 2, y: 1 }, 5],
    [{ x: 2, y: 3 }, 3],
  ]) {
    observation.playerMemory.position = position;
    assert.deepEqual(campaignNavigationRecommendation({
      world: { maps: [room, outside] },
      observation,
      objective: {
        id: "leave-opened-room",
        target: { kind: "object", map: outside.id, index: 0 },
      },
    }), {
      kind: "move-toward",
      direction: "south",
      pathSegment: {
        direction: "south",
        steps: remainingSteps,
        endpoint: { map: room.id, x: 2, y: 6 },
      },
      objective: "leave-opened-room",
      targetMap: "MAP_OUTSIDE",
      transit: {
        kind: "warp",
        destinationMap: "MAP_OUTSIDE",
        x: 2,
        y: 6,
      },
      remainingSteps,
    });
  }
});

test("cross-map routing discovers a warp revealed only in the live map", () => {
  const room = openMap("MAP_SECRET_ROOM", {
    warpEvents: [{
      x: 3,
      y: 1,
      dest_map: "MAP_SECRET_BASEMENT",
      dest_warp_id: "0",
    }],
  });
  const basement = openMap("MAP_SECRET_BASEMENT", {
    warpEvents: [{
      x: 1,
      y: 1,
      dest_map: room.id,
      dest_warp_id: "0",
    }],
    behaviors: { "1,1": "MB_UP_LEFT_STAIR_WARP" },
    objectEvents: [{ x: 3, y: 3, script: "Basement_EventScript_Target" }],
  });
  const observation = campaignObservation({ map: room.id });
  observation.playerMemory.position = { x: 1, y: 1 };
  observation.playerMemory.mapGrid = {
    width: room.layout.width,
    height: room.layout.height,
    cells: room.layout.cells.map((cell) =>
      cell.x === 3 && cell.y === 1
        ? { ...cell, behaviorName: "MB_DOWN_RIGHT_STAIR_WARP" }
        : cell
    ),
  };

  assert.deepEqual(campaignNavigationRecommendation({
    world: { maps: [room, basement] },
    observation,
    objective: {
      id: "enter-secret-basement",
      target: { kind: "object", map: basement.id, index: 0 },
    },
  }), {
    kind: "move-toward",
    direction: "east",
    pathSegment: {
      direction: "east",
      steps: 2,
      endpoint: { map: room.id, x: 3, y: 1 },
    },
    objective: "enter-secret-basement",
    targetMap: basement.id,
    transit: {
      kind: "warp",
      destinationMap: basement.id,
      x: 3,
      y: 1,
    },
    remainingSteps: 2,
  });
});

test("campaign routing crosses map connections through a reachable boundary tile", () => {
  const world = { maps: [
    openMap("MAP_PALLET_TOWN", {
      connections: [{ direction: "up", map: "MAP_ROUTE1", offset: 0 }],
    }),
    openMap("MAP_ROUTE1", {
      connections: [
        { direction: "down", map: "MAP_PALLET_TOWN", offset: 0 },
        { direction: "up", map: "MAP_VIRIDIAN_CITY", offset: 0 },
      ],
    }),
    openMap("MAP_VIRIDIAN_CITY", {
      warpEvents: [
        { x: 0, y: 4, dest_map: "MAP_UNUSED", dest_warp_id: "0" },
        { x: 1, y: 4, dest_map: "MAP_UNUSED", dest_warp_id: "0" },
        { x: 2, y: 4, dest_map: "MAP_UNUSED", dest_warp_id: "0" },
        { x: 3, y: 4, dest_map: "MAP_UNUSED", dest_warp_id: "0" },
        { x: 3, y: 2, dest_map: "MAP_VIRIDIAN_CITY_MART", dest_warp_id: "0" },
      ],
    }),
    openMap("MAP_VIRIDIAN_CITY_MART"),
  ] };
  const objective = createCampaignPlanner().select(campaignObservation());
  const observation = campaignObservation({ map: "MAP_PALLET_TOWN" });
  observation.playerMemory.position = { x: 2, y: 3 };
  const approaching = campaignNavigationRecommendation({ world, objective, observation });
  observation.playerMemory.position = { x: 2, y: 0 };
  const crossing = campaignNavigationRecommendation({ world, objective, observation });

  assert.deepEqual(approaching, {
    kind: "move-toward",
    direction: "north",
    pathSegment: {
      direction: "north",
      steps: 3,
      endpoint: { map: "MAP_PALLET_TOWN", x: 2, y: 0 },
      continuationDirection: "north",
    },
    objective: "oak-parcel",
    targetMap: "MAP_VIRIDIAN_CITY",
    transit: {
      kind: "connection",
      destinationMap: "MAP_ROUTE1",
      direction: "north",
    },
    remainingSteps: 3,
  });
  assert.equal(crossing.kind, "traverse-map-connection");
  assert.equal(crossing.direction, "north");
  assert.equal(crossing.remainingSteps, 0);
});

test("campaign routing rejects a dry map-connection tile that lands in water", () => {
  const shore = openMap("MAP_MIXED_SURFACE_SHORE", {
    width: 5,
    height: 3,
    connections: [{ direction: "up", map: "MAP_MIXED_SURFACE_ROUTE", offset: 0 }],
    behaviors: { "3,0": "MB_OCEAN_WATER" },
    elevations: { "3,0": 1 },
  });
  const route = openMap("MAP_MIXED_SURFACE_ROUTE", {
    width: 5,
    height: 3,
    behaviors: {
      "2,2": "MB_OCEAN_WATER",
      "3,2": "MB_OCEAN_WATER",
    },
    elevations: { "2,2": 1, "3,2": 1 },
    objectEvents: [{ x: 1, y: 0, script: "MixedSurfaceRoute_EventScript_Goal" }],
  });
  const observation = campaignObservation({
    map: shore.id,
    flags: { 2084: true },
  });
  observation.playerMemory.position = { x: 2, y: 0 };
  observation.playerMemory.avatar = { surfing: false };
  observation.playerMemory.trainer.party[0].moves = [57];

  assert.deepEqual(campaignNavigationRecommendation({
    world: { maps: [shore, route] },
    observation,
    objective: {
      id: "leave-mixed-surface-shore",
      target: { kind: "object", map: route.id, index: 0 },
    },
  }), {
    kind: "move-toward",
    direction: "west",
    pathSegment: {
      direction: "west",
      steps: 1,
      endpoint: { map: shore.id, x: 1, y: 0 },
      continuationDirection: "north",
    },
    objective: "leave-mixed-surface-shore",
    targetMap: route.id,
    transit: {
      kind: "connection",
      destinationMap: route.id,
      direction: "north",
    },
    remainingSteps: 1,
  });
});

test("campaign routing preserves distinct reachable regions when one map is split", () => {
  const wall = Object.fromEntries(
    Array.from({ length: 5 }, (_, x) => [`${x},4`, 1]),
  );
  const world = { maps: [
    openMap("MAP_SPLIT_ROUTE", {
      width: 5,
      height: 8,
      collisions: wall,
      connections: [{ direction: "up", map: "MAP_GOAL", offset: 0 }],
      warpEvents: [
        { x: 1, y: 6, dest_map: "MAP_PASSAGE", dest_warp_id: "0" },
        { x: 1, y: 2, dest_map: "MAP_PASSAGE", dest_warp_id: "0" },
      ],
      behaviors: { "1,6": "MB_REGULAR_WARP" },
    }),
    openMap("MAP_PASSAGE", {
      width: 3,
      height: 5,
      warpEvents: [
        { x: 1, y: 4, dest_map: "MAP_SPLIT_ROUTE", dest_warp_id: "0" },
        { x: 1, y: 0, dest_map: "MAP_SPLIT_ROUTE", dest_warp_id: "1" },
      ],
      behaviors: { "1,0": "MB_NORTH_ARROW_WARP" },
    }),
    openMap("MAP_GOAL", {
      objectEvents: [{
        x: 2,
        y: 2,
        local_id: "LOCALID_GOAL",
        script: "Goal_EventScript_Object",
      }],
    }),
  ] };
  const observation = campaignObservation({ map: "MAP_SPLIT_ROUTE" });
  observation.playerMemory.position = { x: 2, y: 6 };

  const recommendation = campaignNavigationRecommendation({
    world,
    observation,
    objective: {
      id: "reach-split-map-goal",
      target: { kind: "object", map: "MAP_GOAL", index: 0 },
    },
  });

  assert.deepEqual(recommendation, {
    kind: "move-toward",
    direction: "west",
    objective: "reach-split-map-goal",
    targetMap: "MAP_GOAL",
    transit: {
      kind: "warp",
      destinationMap: "MAP_PASSAGE",
      x: 1,
      y: 6,
    },
    remainingSteps: 1,
  });
});

test("campaign routing follows cartridge one-way ledges into the next region", () => {
  const world = { maps: [
    openMap("MAP_LEDGE_ROUTE", {
      width: 3,
      height: 1,
      collisions: { "1,0": 1 },
      behaviors: { "1,0": "MB_JUMP_EAST" },
      connections: [{ direction: "right", map: "MAP_GOAL", offset: 0 }],
    }),
    openMap("MAP_GOAL", {
      width: 3,
      height: 1,
      objectEvents: [{ x: 2, y: 0, script: "Goal_EventScript_Object" }],
    }),
  ] };
  const observation = campaignObservation({ map: "MAP_LEDGE_ROUTE" });
  observation.playerMemory.position = { x: 0, y: 0 };

  const recommendation = campaignNavigationRecommendation({
    world,
    observation,
    objective: {
      id: "cross-one-way-ledge",
      target: { kind: "object", map: "MAP_GOAL", index: 0 },
    },
  });

  assert.deepEqual(recommendation, {
    kind: "traverse-ledge",
    direction: "east",
    objective: "cross-one-way-ledge",
    targetMap: "MAP_GOAL",
    transit: {
      kind: "ledge",
      destinationMap: "MAP_LEDGE_ROUTE",
      x: 1,
      y: 0,
      direction: "east",
    },
    remainingSteps: 0,
  });
});

test("campaign routing takes a same-region downhill ledge instead of a distant gap", () => {
  const world = { maps: [openMap("MAP_CYCLING_LEDGE", {
    width: 3,
    height: 3,
    collisions: {
      "1,1": 1,
      "2,1": 1,
    },
    behaviors: {
      "1,1": "MB_JUMP_SOUTH",
      "2,1": "MB_JUMP_SOUTH",
    },
    coordEvents: [{
      x: 2,
      y: 2,
      type: "trigger",
      var: "VAR_TEST",
      var_value: "0",
      script: "CyclingLedge_EventScript_Target",
    }],
  })] };
  const observation = campaignObservation({ map: "MAP_CYCLING_LEDGE" });
  observation.playerMemory.position = { x: 2, y: 0 };

  const recommendation = campaignNavigationRecommendation({
    world,
    observation,
    objective: {
      id: "cross-cycling-ledge",
      target: { kind: "trigger", map: "MAP_CYCLING_LEDGE", index: 0 },
    },
  });

  assert.equal(recommendation.kind, "move-toward");
  assert.equal(recommendation.direction, "south");
  assert.equal(recommendation.remainingSteps, 1);
});

test("campaign routing never reverses a one-way cartridge ledge", () => {
  const world = { maps: [openMap("MAP_LEDGE_ROUTE", {
    width: 3,
    height: 1,
    collisions: { "1,0": 1 },
    behaviors: { "1,0": "MB_JUMP_EAST" },
    coordEvents: [{ x: 0, y: 0, script: "Goal_EventScript_Trigger" }],
  })] };
  const observation = campaignObservation({ map: "MAP_LEDGE_ROUTE" });
  observation.playerMemory.position = { x: 2, y: 0 };

  const recommendation = campaignNavigationRecommendation({
    world,
    observation,
    objective: {
      id: "do-not-reverse-ledge",
      target: { kind: "trigger", map: "MAP_LEDGE_ROUTE", index: 0 },
    },
  });

  assert.equal(recommendation, null);
});

test("campaign routing does not plan through an uncleared field obstacle", () => {
  const corridorWalls = Object.fromEntries(
    Array.from({ length: 6 }, (_, y) => [
      [`0,${y}`, 1],
      [`2,${y}`, 1],
    ]).flat(),
  );
  const world = { maps: [
    openMap("MAP_CUT_SHORTCUT", {
      width: 3,
      height: 6,
      collisions: corridorWalls,
      connections: [{ direction: "up", map: "MAP_GOAL", offset: 0 }],
      warpEvents: [{
        x: 1,
        y: 5,
        dest_map: "MAP_SAFE_PASSAGE",
        dest_warp_id: "0",
      }],
      behaviors: { "1,5": "MB_REGULAR_WARP" },
      objectEvents: [{
        x: 1,
        y: 3,
        graphics_id: "OBJ_EVENT_GFX_CUT_TREE",
        script: "EventScript_CutTree",
      }],
    }),
    openMap("MAP_SAFE_PASSAGE", {
      width: 3,
      height: 6,
      collisions: corridorWalls,
      connections: [{ direction: "up", map: "MAP_GOAL", offset: 0 }],
      warpEvents: [{
        x: 1,
        y: 5,
        dest_map: "MAP_CUT_SHORTCUT",
        dest_warp_id: "0",
      }],
    }),
    openMap("MAP_GOAL", {
      width: 3,
      height: 6,
      collisions: corridorWalls,
      objectEvents: [{ x: 1, y: 2, script: "Goal_EventScript_Object" }],
    }),
  ] };
  const observation = campaignObservation({ map: "MAP_CUT_SHORTCUT" });
  observation.playerMemory.position = { x: 1, y: 4 };

  const recommendation = campaignNavigationRecommendation({
    world,
    observation,
    objective: {
      id: "avoid-uncleared-cut-tree",
      target: { kind: "object", map: "MAP_GOAL", index: 0 },
    },
  });

  assert.equal(recommendation.kind, "move-toward");
  assert.equal(recommendation.direction, "south");
  assert.equal(recommendation.transit.destinationMap, "MAP_SAFE_PASSAGE");
});

function strengthSeparatedTransitWorld() {
  const hub = openMap("MAP_STRENGTH_TRANSIT_HUB", {
    width: 5,
    height: 5,
    behaviors: {
      "1,2": "MB_LADDER",
      "3,2": "MB_LADDER",
    },
    warpEvents: [
      { x: 1, y: 2, dest_map: "MAP_STRENGTH_SPLIT", dest_warp_id: "0" },
      { x: 3, y: 2, dest_map: "MAP_STRENGTH_SPLIT", dest_warp_id: "1" },
    ],
  });
  const split = openMap("MAP_STRENGTH_SPLIT", {
    width: 5,
    height: 5,
    collisions: {
      "2,0": 1,
      "2,1": 1,
      "2,3": 1,
      "2,4": 1,
    },
    behaviors: {
      "0,2": "MB_LADDER",
      "1,2": "MB_LADDER",
      "3,2": "MB_LADDER",
      "4,2": "MB_LADDER",
    },
    warpEvents: [
      { x: 1, y: 2, dest_map: hub.id, dest_warp_id: "0" },
      { x: 3, y: 2, dest_map: hub.id, dest_warp_id: "1" },
      { x: 4, y: 2, dest_map: "MAP_STRENGTH_EAST_GOAL", dest_warp_id: "0" },
      { x: 0, y: 2, dest_map: "MAP_STRENGTH_WEST_GOAL", dest_warp_id: "0" },
    ],
    objectEvents: [{
      x: 2,
      y: 2,
      graphics_id: "OBJ_EVENT_GFX_PUSHABLE_BOULDER",
      script: "EventScript_StrengthBoulder",
    }, {
      x: 4,
      y: 4,
      script: "StrengthSplit_EventScript_Target",
    }],
  });
  const eastGoal = openMap("MAP_STRENGTH_EAST_GOAL", {
    behaviors: { "1,1": "MB_LADDER" },
    warpEvents: [{ x: 1, y: 1, dest_map: split.id, dest_warp_id: "2" }],
    objectEvents: [{ x: 3, y: 3, script: "EastGoal_EventScript_Target" }],
  });
  const westGoal = openMap("MAP_STRENGTH_WEST_GOAL", {
    behaviors: { "1,1": "MB_LADDER" },
    warpEvents: [{ x: 1, y: 1, dest_map: split.id, dest_warp_id: "3" }],
    objectEvents: [{ x: 3, y: 3, script: "WestGoal_EventScript_Target" }],
  });
  return { hub, split, eastGoal, westGoal };
}

test("cross-map routing takes the connector warp instead of a Strength shortcut", () => {
  const { hub, split, eastGoal, westGoal } = strengthSeparatedTransitWorld();
  const world = { maps: [hub, split, eastGoal, westGoal] };
  const observation = campaignObservation({
    map: hub.id,
    flags: { 2053: true, 2083: true },
    party: [{ slot: 0, species: 6, level: 50, hp: 150, moves: [70] }],
  });
  observation.playerMemory.position = { x: 1, y: 2 };

  const recommendation = campaignNavigationRecommendation({
    world,
    observation,
    objective: {
      id: "reach-east-side",
      target: { kind: "object", map: eastGoal.id, index: 0 },
    },
  });

  assert.equal(recommendation?.kind, "move-toward");
  assert.equal(recommendation?.direction, "east");
  assert.equal(recommendation?.transit?.destinationMap, split.id);
  assert.equal(recommendation?.transit?.x, 3);
});

test("Strength-separated maze floors use connector warps in both directions", () => {
  const { hub, split, eastGoal, westGoal } = strengthSeparatedTransitWorld();
  const world = { maps: [hub, split, eastGoal, westGoal] };
  const observation = campaignObservation({
    map: split.id,
    flags: { 2053: true, 2083: true },
    party: [{ slot: 0, species: 6, level: 50, hp: 150, moves: [70] }],
  });
  for (const scenario of [
    { position: { x: 1, y: 2 }, goal: eastGoal },
    { position: { x: 3, y: 2 }, goal: westGoal },
  ]) {
    observation.playerMemory.position = scenario.position;
    const recommendation = campaignNavigationRecommendation({
      world,
      observation,
      objective: {
        id: "cross-strength-maze",
        target: { kind: "object", map: scenario.goal.id, index: 0 },
      },
    });

    assert.equal(recommendation?.kind, "reenter-map-warp");
    assert.equal(recommendation?.direction, "south");
    assert.equal(recommendation?.transit?.destinationMap, hub.id);
  }
});

test("same-map routing detours around a Strength boulder instead of improvising a push", () => {
  const { hub, split, eastGoal, westGoal } = strengthSeparatedTransitWorld();
  const observation = campaignObservation({
    map: split.id,
    flags: { 2053: true, 2083: true },
    party: [{ slot: 0, species: 6, level: 50, hp: 150, moves: [70] }],
  });
  observation.playerMemory.position = { x: 1, y: 2 };

  const recommendation = campaignNavigationRecommendation({
    world: { maps: [hub, split, eastGoal, westGoal] },
    observation,
    objective: {
      id: "reach-other-side-without-moving-boulder",
      target: { kind: "object", map: split.id, index: 1 },
    },
  });

  assert.equal(recommendation?.kind, "reenter-map-warp");
  assert.equal(recommendation?.transit?.destinationMap, hub.id);
});

test("same-map routing does not cross an unrelated automatic warp", () => {
  const route = openMap("MAP_AUTOMATIC_WARP_ROUTE", {
    width: 7,
    height: 3,
    behaviors: { "3,1": "MB_FALL_WARP" },
    warpEvents: [{
      x: 3,
      y: 1,
      dest_map: "MAP_AUTOMATIC_WARP_LANDING",
      dest_warp_id: "0",
    }],
    objectEvents: [{
      x: 6,
      y: 1,
      script: "AutomaticWarpRoute_EventScript_Target",
    }],
  });
  const landing = openMap("MAP_AUTOMATIC_WARP_LANDING", {
    behaviors: { "1,1": "MB_LADDER" },
    warpEvents: [{
      x: 1,
      y: 1,
      dest_map: route.id,
      dest_warp_id: "0",
    }],
  });
  const observation = campaignObservation({ map: route.id });
  observation.playerMemory.position = { x: 0, y: 1 };

  const recommendation = rawCampaignNavigationRecommendation({
    world: { maps: [route, landing] },
    observation,
    objective: {
      id: "stay-on-current-floor",
      target: { kind: "object", map: route.id, index: 0 },
    },
  });

  const traversed = [];
  let position = { ...recommendation.routePlan.origin };
  const vectors = {
    north: { x: 0, y: -1 },
    south: { x: 0, y: 1 },
    east: { x: 1, y: 0 },
    west: { x: -1, y: 0 },
  };
  for (const segment of recommendation.routePlan.segments) {
    for (let step = 0; step < segment.steps; step += 1) {
      position = {
        x: position.x + vectors[segment.direction].x,
        y: position.y + vectors[segment.direction].y,
      };
      traversed.push(position);
    }
  }
  assert.equal(
    traversed.some(({ x, y }) => x === 3 && y === 1),
    false,
  );
});

function victoryRoadShuttleMap3F() {
  const wall = Object.fromEntries(
    Array.from({ length: 45 }, (_, x) => [`${x},12`, 1]),
  );
  return openMap("MAP_VICTORY_ROAD_3F", {
    width: 45,
    height: 22,
    collisions: wall,
    behaviors: {
      "5,2": "MB_LADDER",
      "10,5": "MB_LADDER",
      "37,16": "MB_LADDER",
      "39,17": "MB_LADDER",
      "34,18": "MB_FALL_WARP",
    },
    warpEvents: [
      { x: 5, y: 2, dest_map: "MAP_VICTORY_ROAD_2F", dest_warp_id: "1" },
      { x: 10, y: 5, dest_map: "MAP_VICTORY_ROAD_2F", dest_warp_id: "2" },
      { x: 37, y: 16, dest_map: "MAP_VICTORY_ROAD_2F", dest_warp_id: "3" },
      { x: 39, y: 17, dest_map: "MAP_VICTORY_ROAD_2F", dest_warp_id: "4" },
      { x: 34, y: 18, dest_map: "MAP_VICTORY_ROAD_2F", dest_warp_id: "8" },
    ],
    objectEvents: Array.from({ length: 10 }, (_, index) => {
      if (index === 1) {
        return { x: 21, y: 5, script: "VictoryRoad_3F_EventScript_Alexa" };
      }
      if (index === 7) {
        return {
          x: 33,
          y: 18,
          graphics_id: "OBJ_EVENT_GFX_PUSHABLE_BOULDER",
          script: "EventScript_StrengthBoulder",
          flag: "FLAG_HIDE_VICTORY_ROAD_3F_BOULDER",
        };
      }
      if (index === 9) {
        return {
          x: 32,
          y: 5,
          graphics_id: "OBJ_EVENT_GFX_PUSHABLE_BOULDER",
          script: "EventScript_StrengthBoulder",
        };
      }
      return { x: index, y: 0, script: `VictoryRoad_Filler_${index}` };
    }),
  });
}

test("Victory Road recovery remains committed while crossing the reset maze", () => {
  const secondFloor = openMap("MAP_VICTORY_ROAD_2F", {
    width: 40,
    height: 22,
    behaviors: { "34,9": "MB_LADDER" },
    warpEvents: [
      { x: 1, y: 1, dest_map: "MAP_UNUSED", dest_warp_id: "0" },
      { x: 2, y: 1, dest_map: "MAP_UNUSED", dest_warp_id: "0" },
      { x: 34, y: 9, dest_map: "MAP_VICTORY_ROAD_3F", dest_warp_id: "1" },
    ],
  });
  const thirdFloor = victoryRoadShuttleMap3F();
  const center = openMap("MAP_INDIGO_PLATEAU_POKEMON_CENTER_1F", {
    objectEvents: [{ x: 2, y: 1, script: "Indigo_EventScript_Nurse" }],
  });
  const world = { maps: [secondFloor, thirdFloor, center] };
  const observation = campaignObservation({
    map: secondFloor.id,
    flags: { 2083: true },
    party: [{ slot: 0, species: 131, level: 54, hp: 40, moves: [70] }],
  });
  observation.playerMemory.position = { x: 34, y: 9 };

  const objective = selectRecoveryObjective({ world, observation });
  const recommendation = campaignNavigationRecommendation({
    world,
    observation,
    objective,
  });

  assert.equal(objective?.target?.map, center.id);
  assert.equal(recommendation?.kind, "reenter-map-warp");
  assert.equal(recommendation?.transit?.destinationMap, thirdFloor.id);
  assert.equal(recommendation?.objective, "recover-party");
});

test("Victory Road outbound traversal reopens the third-floor switch", () => {
  const thirdFloor = victoryRoadShuttleMap3F();
  const center = openMap("MAP_INDIGO_PLATEAU_POKEMON_CENTER_1F", {
    objectEvents: [{ x: 2, y: 1, script: "Indigo_EventScript_Nurse" }],
  });
  const observation = campaignObservation({
    map: thirdFloor.id,
    variables: { 0x4067: 0 },
    flags: { 2053: true, 2083: true },
    party: [{ slot: 0, species: 131, level: 54, hp: 40, moves: [70] }],
  });
  observation.playerMemory.position = { x: 32, y: 6 };
  observation.playerMemory.objectEvents = [{
    localId: 10,
    current: { x: 32, y: 5 },
    previous: { x: 32, y: 5 },
  }];

  const recommendation = campaignNavigationRecommendation({
    world: { maps: [thirdFloor, center] },
    observation,
    objective: {
      id: "recover-party",
      target: { kind: "object", map: center.id, index: 0 },
    },
  });

  assert.equal(recommendation?.kind, "push-field-obstacle");
  assert.equal(recommendation?.direction, "north");
  assert.equal(recommendation?.obstacle?.index, 9);
  assert.equal(recommendation?.objective, "recover-party");
  assert.equal(recommendation?.targetMap, center.id);
});

test("Victory Road outbound traversal replays the drop and final switch", () => {
  const thirdFloor = openMap("MAP_VICTORY_ROAD_3F", {
    width: 45,
    height: 22,
    collisions: Object.fromEntries(
      Array.from({ length: 22 }, (_, y) => [`36,${y}`, 1]),
    ),
    behaviors: {
      "10,5": "MB_LADDER",
      "37,10": "MB_LADDER",
      "39,17": "MB_LADDER",
      "34,18": "MB_FALL_WARP",
    },
    warpEvents: [
      { x: 5, y: 2, dest_map: "MAP_VICTORY_ROAD_2F", dest_warp_id: "1" },
      { x: 10, y: 5, dest_map: "MAP_VICTORY_ROAD_2F", dest_warp_id: "2" },
      { x: 37, y: 10, dest_map: "MAP_VICTORY_ROAD_2F", dest_warp_id: "3" },
      { x: 39, y: 17, dest_map: "MAP_VICTORY_ROAD_2F", dest_warp_id: "4" },
      { x: 34, y: 18, dest_map: "MAP_VICTORY_ROAD_2F", dest_warp_id: "8" },
    ],
    objectEvents: Array.from({ length: 10 }, (_, index) => index === 7
      ? {
          x: 33,
          y: 18,
          graphics_id: "OBJ_EVENT_GFX_PUSHABLE_BOULDER",
          script: "EventScript_StrengthBoulder",
          flag: "FLAG_HIDE_VICTORY_ROAD_3F_BOULDER",
        }
      : index === 9
        ? {
            x: 32,
            y: 5,
            graphics_id: "OBJ_EVENT_GFX_PUSHABLE_BOULDER",
            script: "EventScript_StrengthBoulder",
          }
        : { x: index, y: 0, script: `VictoryRoad_Filler_${index}` }),
  });
  const center = openMap("MAP_INDIGO_PLATEAU_POKEMON_CENTER_1F", {
    objectEvents: [{ x: 2, y: 1, script: "Indigo_EventScript_Nurse" }],
  });
  const objective = {
    id: "recover-party",
    target: { kind: "object", map: center.id, index: 0 },
  };
  const observation = campaignObservation({
    map: thirdFloor.id,
    variables: { 0x4067: 100 },
    flags: { 88: true, 2053: true, 2083: true },
    party: [{ slot: 0, species: 131, level: 54, hp: 40, moves: [70] }],
  });
  observation.playerMemory.position = { x: 32, y: 18 };
  observation.playerMemory.objectEvents = [{
    localId: 8,
    current: { x: 33, y: 18 },
    previous: { x: 33, y: 18 },
  }];

  const dropping = campaignNavigationRecommendation({
    world: { maps: [thirdFloor, center] }, observation, objective,
  });
  assert.equal(dropping?.kind, "push-field-obstacle");
  assert.equal(dropping?.direction, "east");
  assert.equal(dropping?.obstacle?.index, 7);

  observation.playerMemory.storyState.flagIds[88] = false;
  observation.playerMemory.storyState.flags = {
    FLAG_HIDE_VICTORY_ROAD_3F_BOULDER: true,
  };
  observation.playerMemory.objectEvents = [];
  const following = campaignNavigationRecommendation({
    world: { maps: [thirdFloor, center] }, observation, objective,
  });
  assert.equal(following?.direction, "east");
  assert.equal(following?.target?.kind, "warp");
  assert.equal(following?.target?.index, 4);

  const secondFloor = openMap("MAP_VICTORY_ROAD_2F", {
    width: 51,
    height: 22,
    collisions: Object.fromEntries(
      Array.from({ length: 22 }, (_, y) => [`40,${y}`, 1]),
    ),
    behaviors: {
      "34,9": "MB_LADDER",
      "36,17": "MB_LADDER",
      "48,12": "MB_SOUTH_ARROW_WARP",
    },
    warpEvents: Array.from({ length: 7 }, (_, index) => index === 2
      ? { x: 34, y: 9, dest_map: thirdFloor.id, dest_warp_id: "1" }
      : index === 4
        ? { x: 36, y: 17, dest_map: thirdFloor.id, dest_warp_id: "3" }
      : index === 6
        ? { x: 48, y: 12, dest_map: "MAP_ROUTE23", dest_warp_id: "1" }
        : { x: index, y: 1, dest_map: "MAP_UNUSED", dest_warp_id: "0" }),
    objectEvents: Array.from({ length: 12 }, (_, index) => index === 11
      ? {
          x: 33,
          y: 19,
          graphics_id: "OBJ_EVENT_GFX_PUSHABLE_BOULDER",
          script: "EventScript_StrengthBoulder",
          flag: "FLAG_HIDE_VICTORY_ROAD_2F_BOULDER",
        }
      : { x: index, y: 0, script: `VictoryRoad_Filler_${index}` }),
  });
  const finalSwitchObservation = campaignObservation({
    map: secondFloor.id,
    variables: { 0x4066: 0 },
    flags: { 88: false, 2053: true, 2083: true },
    party: [{ slot: 0, species: 131, level: 54, hp: 40, moves: [70] }],
  });
  finalSwitchObservation.playerMemory.storyState.flags = {
    FLAG_HIDE_VICTORY_ROAD_2F_BOULDER: false,
  };
  finalSwitchObservation.playerMemory.position = { x: 34, y: 19 };
  finalSwitchObservation.playerMemory.objectEvents = [{
    localId: 12,
    current: { x: 33, y: 19 },
    previous: { x: 33, y: 19 },
  }];
  const finalSwitch = campaignNavigationRecommendation({
    world: { maps: [secondFloor, thirdFloor, center] },
    observation: finalSwitchObservation,
    objective,
  });
  assert.equal(finalSwitch?.kind, "push-field-obstacle");
  assert.equal(finalSwitch?.direction, "west");
  assert.equal(finalSwitch?.obstacle?.index, 11);

  finalSwitchObservation.playerMemory.storyState.variableIds[0x4066] = 100;
  finalSwitchObservation.playerMemory.position = { x: 34, y: 19 };
  finalSwitchObservation.playerMemory.objectEvents = [];
  const leavingSwitchPocket = campaignNavigationRecommendation({
    world: { maps: [secondFloor, thirdFloor, center] },
    observation: finalSwitchObservation,
    objective,
  });
  assert.equal(leavingSwitchPocket?.target?.kind, "warp");
  assert.equal(leavingSwitchPocket?.target?.index, 4);
  assert.equal(leavingSwitchPocket?.victoryRoadPhase, "leave-final-switch-pocket");
});

test("Victory Road inbound traversal drops and follows the return boulder", () => {
  const thirdFloor = victoryRoadShuttleMap3F();
  const secondFloor = openMap("MAP_VICTORY_ROAD_2F", {
    width: 40,
    height: 22,
    warpEvents: Array.from({ length: 9 }, (_, index) => ({
      x: index,
      y: 1,
      dest_map: thirdFloor.id,
      dest_warp_id: "0",
    })),
  });
  const world = { maps: [thirdFloor, secondFloor] };
  const objective = {
    id: "train-victory-road-main-room",
    target: { kind: "object", map: thirdFloor.id, index: 1 },
  };
  const observation = campaignObservation({
    map: thirdFloor.id,
    flags: { 88: true, 2053: true, 2083: true },
    party: [{ slot: 0, species: 131, level: 54, hp: 200, moves: [70] }],
  });
  observation.playerMemory.position = { x: 32, y: 18 };
  observation.playerMemory.objectEvents = [{
    localId: 8,
    current: { x: 33, y: 18 },
    previous: { x: 33, y: 18 },
  }];

  const dropping = campaignNavigationRecommendation({ world, observation, objective });
  assert.equal(dropping?.kind, "push-field-obstacle");
  assert.equal(dropping?.direction, "east");
  assert.equal(dropping?.obstacle?.index, 7);
  assert.equal(dropping?.objective, objective.id);

  observation.playerMemory.storyState.flagIds[88] = false;
  observation.playerMemory.storyState.flags = {
    FLAG_HIDE_VICTORY_ROAD_3F_BOULDER: true,
  };
  observation.playerMemory.objectEvents = [];
  const following = campaignNavigationRecommendation({ world, observation, objective });
  assert.equal(following?.kind, "move-toward");
  assert.equal(following?.direction, "east");
  assert.equal(following?.target?.kind, "warp");
  assert.equal(following?.target?.index, 4);
});

test("Victory Road reverse traversal pushes open the third-floor return passage", () => {
  const thirdFloor = openMap("MAP_VICTORY_ROAD_3F", {
    width: 45,
    height: 22,
    collisions: Object.fromEntries(
      Array.from({ length: 22 }, (_, y) => [`35,${y}`, y === 13 ? 0 : 1]),
    ),
    behaviors: {
      "34,9": "MB_LADDER",
      "37,10": "MB_LADDER",
      "39,17": "MB_LADDER",
      "34,18": "MB_FALL_WARP",
    },
    warpEvents: [
      { x: 5, y: 2, dest_map: "MAP_VICTORY_ROAD_2F", dest_warp_id: "1" },
      { x: 34, y: 9, dest_map: "MAP_VICTORY_ROAD_2F", dest_warp_id: "2" },
      { x: 37, y: 10, dest_map: "MAP_VICTORY_ROAD_2F", dest_warp_id: "3" },
      { x: 39, y: 17, dest_map: "MAP_VICTORY_ROAD_2F", dest_warp_id: "4" },
      { x: 34, y: 18, dest_map: "MAP_VICTORY_ROAD_2F", dest_warp_id: "8" },
    ],
    objectEvents: Array.from({ length: 9 }, (_, index) => index === 1
      ? { x: 21, y: 5, script: "VictoryRoad_3F_EventScript_Alexa" }
      : index === 8
        ? {
            x: 35,
            y: 13,
            graphics_id: "OBJ_EVENT_GFX_PUSHABLE_BOULDER",
            script: "EventScript_StrengthBoulder",
          }
        : { x: index, y: 0, script: `VictoryRoad_Filler_${index}` }),
  });
  const objective = {
    id: "train-battle-member-with-trainer",
    target: { kind: "object", map: thirdFloor.id, index: 1 },
  };
  const observation = campaignObservation({
    map: thirdFloor.id,
    flags: { 88: true, 2053: true, 2083: true },
    party: [{ slot: 0, species: 135, level: 51, hp: 127, moves: [70] }],
  });
  observation.playerMemory.position = { x: 36, y: 13 };
  observation.playerMemory.objectEvents = [{
    localId: 9,
    current: { x: 35, y: 13 },
    previous: { x: 35, y: 13 },
  }];

  const firstPush = campaignNavigationRecommendation({
    world: { maps: [thirdFloor] }, observation, objective,
  });
  assert.equal(firstPush?.kind, "push-field-obstacle");
  assert.equal(firstPush?.direction, "west");
  assert.equal(firstPush?.obstacle?.index, 8);
  assert.equal(firstPush?.victoryRoadPhase, "open-third-floor-return-passage");

  observation.playerMemory.position = { x: 35, y: 13 };
  observation.playerMemory.objectEvents[0].current = { x: 34, y: 13 };
  const secondPush = campaignNavigationRecommendation({
    world: { maps: [thirdFloor] }, observation, objective,
  });
  assert.equal(secondPush?.kind, "push-field-obstacle");
  assert.equal(secondPush?.direction, "west");
  assert.equal(secondPush?.obstacle?.index, 8);

  observation.playerMemory.position = { x: 34, y: 13 };
  observation.playerMemory.objectEvents[0].current = { x: 33, y: 13 };
  const crossed = campaignNavigationRecommendation({
    world: { maps: [thirdFloor] }, observation, objective,
  });
  assert.equal(crossed?.objective, objective.id);
  assert.notEqual(crossed?.target?.kind, "warp");
  assert.notEqual(crossed?.kind, "reenter-map-warp");
});

test("campaign routing follows the cartridge's live collision grid after a barrier opens", () => {
  const staticCollisions = { "0,0": 1, "2,0": 1, "0,1": 1, "2,1": 1,
    "0,2": 1, "1,2": 1, "2,2": 1, "0,3": 1, "2,3": 1,
    "0,4": 1, "2,4": 1 };
  const map = openMap("MAP_DYNAMIC_GYM", {
    width: 3,
    height: 5,
    collisions: staticCollisions,
    objectEvents: [{ x: 1, y: 0, script: "DynamicGym_EventScript_Leader" }],
  });
  const observation = campaignObservation({ map: "MAP_DYNAMIC_GYM" });
  observation.playerMemory.position = { x: 1, y: 4 };
  observation.playerMemory.mapGrid = {
    width: 3,
    height: 5,
    cells: map.layout.cells.map((cell) => ({
      ...cell,
      collision: cell.x === 1 && cell.y === 2 ? 0 : cell.collision,
    })),
  };

  const recommendation = campaignNavigationRecommendation({
    world: { maps: [map] },
    observation,
    objective: {
      id: "cross-opened-barrier",
      target: { kind: "object", map: "MAP_DYNAMIC_GYM", index: 0 },
    },
  });

  assert.equal(recommendation.kind, "move-toward");
  assert.equal(recommendation.direction, "north");
});

test("campaign routing remembers a moved trainer after the trainer scrolls offscreen", () => {
  const map = openMap("MAP_VIRIDIAN_CITY_GYM", {
    objectEvents: [
      { x: 0, y: 0, script: "ViridianCity_Gym_EventScript_Takashi" },
      { x: 2, y: 0, script: "ViridianCity_Gym_EventScript_Giovanni" },
    ],
  });
  const observation = campaignObservation({ map: map.id });
  observation.playerMemory.position = { x: 2, y: 4 };
  observation.playerMemory.objectEvents = [];
  observation.playerMemory.objectEventTemplates = [
    { localId: 1, current: { x: 2, y: 2 } },
    { localId: 2, current: { x: 2, y: 0 } },
  ];

  const recommendation = campaignNavigationRecommendation({
    world: { maps: [map] },
    observation,
    objective: {
      id: "badge-earth",
      target: { kind: "object", map: map.id, index: 1 },
    },
  });

  assert.equal(recommendation.kind, "move-toward");
  assert.equal(recommendation.direction, "east");
});

test("campaign routing does not push a live Strength boulder into a wall", () => {
  const map = openMap("MAP_VICTORY_ROAD_1F", {
    height: 7,
    collisions: { "2,2": 1, "1,4": 1, "3,4": 1 },
    objectEvents: [
      {
        x: 2,
        y: 4,
        graphics_id: "OBJ_EVENT_GFX_PUSHABLE_BOULDER",
        script: "EventScript_StrengthBoulder",
      },
      { x: 2, y: 0, script: "VictoryRoad_1F_EventScript_Trainer" },
    ],
  });
  const observation = campaignObservation({
    map: map.id,
    flags: { 2053: true },
  });
  observation.playerMemory.position = { x: 2, y: 4 };
  observation.playerMemory.objectEvents = [{
    localId: 1,
    current: { x: 2, y: 3 },
    previous: { x: 2, y: 4 },
  }];

  const recommendation = campaignNavigationRecommendation({
    world: { maps: [map] },
    observation,
    objective: {
      id: "victory-road-trainer",
      target: { kind: "object", map: map.id, index: 1 },
    },
  });

  assert.equal(recommendation.kind, "move-toward");
  assert.equal(recommendation.direction, "south");
});

test("Victory Road reverses toward a missed Kanto training-infrastructure objective", () => {
  const thirdFloor = victoryRoadShuttleMap3F();
  const secondFloor = openMap("MAP_VICTORY_ROAD_2F", {
    width: 51,
    height: 22,
    collisions: Object.fromEntries(
      Array.from({ length: 22 }, (_, y) => [`40,${y}`, 1]),
    ),
    behaviors: {
      "34,9": "MB_LADDER",
      "36,17": "MB_LADDER",
      "48,12": "MB_SOUTH_ARROW_WARP",
    },
    warpEvents: Array.from({ length: 7 }, (_, index) => index === 2
      ? { x: 34, y: 9, dest_map: thirdFloor.id, dest_warp_id: "1" }
      : index === 4
        ? { x: 36, y: 17, dest_map: thirdFloor.id, dest_warp_id: "3" }
        : index === 6
          ? { x: 48, y: 12, dest_map: "MAP_ROUTE23", dest_warp_id: "1" }
        : { x: index, y: 1, dest_map: "MAP_UNUSED", dest_warp_id: "0" }),
    objectEvents: Array.from({ length: 12 }, (_, index) => index === 11
      ? {
          x: 33,
          y: 19,
          graphics_id: "OBJ_EVENT_GFX_PUSHABLE_BOULDER",
          script: "EventScript_StrengthBoulder",
          flag: "FLAG_HIDE_VICTORY_ROAD_2F_BOULDER",
        }
      : { x: index, y: 0, script: `VictoryRoad_Filler_${index}` }),
  });
  const center = openMap("MAP_VERMILION_CITY_POKEMON_CENTER_1F", {
    objectEvents: Array.from({ length: 5 }, (_, index) => ({
      x: index === 4 ? 3 : 1,
      y: index === 4 ? 2 : 1,
    })),
  });
  const world = { maps: [secondFloor, thirdFloor, center] };
  const observation = campaignObservation({
    map: secondFloor.id,
    variables: { 0x4066: 0 },
    flags: { 84: true, 128: true, 2053: true, 2081: true, 2083: true,
      598: false, 658: false },
    bag: { keyItems: [], items: [], pokeBalls: [] },
  });
  observation.playerMemory.storyState.flags = {
    FLAG_HIDE_VICTORY_ROAD_2F_BOULDER: false,
  };
  observation.playerMemory.position = { x: 34, y: 19 };
  observation.playerMemory.objectEvents = [{
    localId: 12,
    current: { x: 33, y: 19 },
    previous: { x: 33, y: 19 },
  }];

  const objective = {
    id: "vs-seeker",
    target: { kind: "object", map: center.id, index: 4 },
  };
  const recommendation = campaignNavigationRecommendation({
    world,
    observation,
    objective,
  });
  assert.equal(recommendation?.kind, "push-field-obstacle");
  assert.equal(recommendation?.direction, "west");
  assert.equal(recommendation?.objective, objective.id);
  assert.equal(recommendation?.targetMap, center.id);
  assert.equal(recommendation?.victoryRoadPhase, "open-second-floor-north-gate");

  const planner = createCampaignPlanner({
    campaign: { objectives: [{
      id: "continue-story",
      target: { kind: "map-arrival", map: center.id, x: 1, y: 1 },
      completion: { kind: "flag-set", id: 9999 },
    }] },
    world,
    story: { symbols: {}, scripts: [] },
    mechanics: { species: [], trainers: [] },
  });
  assert.equal(planner.select(observation)?.id, "vs-seeker");
});

test("remote dynamic objectives stage through a reachable map ingress", () => {
  const corridorWalls = Object.fromEntries(
    Array.from({ length: 5 }, (_, y) => [
      [`0,${y}`, 1],
      [`2,${y}`, 1],
    ]).flat(),
  );
  const start = openMap("MAP_DYNAMIC_GYM_APPROACH", {
    width: 3,
    height: 5,
    collisions: corridorWalls,
    behaviors: { "1,1": "MB_LADDER" },
    warpEvents: [{
      x: 1,
      y: 1,
      dest_map: "MAP_REMOTE_DYNAMIC_GYM",
      dest_warp_id: "0",
    }],
  });
  const gym = openMap("MAP_REMOTE_DYNAMIC_GYM", {
    width: 3,
    height: 5,
    collisions: { ...corridorWalls, "1,2": 1 },
    behaviors: { "1,4": "MB_LADDER" },
    warpEvents: [{
      x: 1,
      y: 4,
      dest_map: start.id,
      dest_warp_id: "0",
    }],
    objectEvents: [{
      x: 1,
      y: 0,
      script: "RemoteDynamicGym_EventScript_Leader",
    }],
  });
  const world = { maps: [start, gym] };
  const objective = {
    id: "reach-remote-dynamic-leader",
    target: { kind: "object", map: gym.id, index: 0 },
  };
  const approaching = campaignObservation({ map: start.id });
  approaching.playerMemory.position = { x: 1, y: 3 };

  assert.deepEqual(campaignNavigationRecommendation({
    world,
    observation: approaching,
    objective,
  }), {
    kind: "move-toward",
    direction: "north",
    pathSegment: {
      direction: "north",
      steps: 2,
      endpoint: { map: start.id, x: 1, y: 1 },
    },
    objective: objective.id,
    targetMap: gym.id,
    transit: {
      kind: "warp",
      destinationMap: gym.id,
      x: 1,
      y: 1,
    },
    remainingSteps: 2,
  });

  const entered = campaignObservation({ map: gym.id });
  entered.playerMemory.position = { x: 1, y: 4 };
  entered.playerMemory.mapGrid = {
    width: gym.layout.width,
    height: gym.layout.height,
    cells: gym.layout.cells.map((cell) =>
      cell.x === 1 && cell.y === 2 ? { ...cell, collision: 0 } : cell
    ),
  };
  const liveRoute = campaignNavigationRecommendation({
    world,
    observation: entered,
    objective,
  });
  assert.equal(liveRoute?.kind, "move-toward");
  assert.equal(liveRoute?.direction, "north");
  assert.equal(liveRoute?.remainingSteps, 3);
});

test("campaign routing does not cross a barrier that the live cartridge still marks closed", () => {
  const map = openMap("MAP_DYNAMIC_GYM", {
    width: 3,
    height: 5,
    collisions: Object.fromEntries(
      Array.from({ length: 5 }, (_, y) => [[`0,${y}`, 1], [`2,${y}`, 1]]).flat(),
    ),
    objectEvents: [{ x: 1, y: 0, script: "DynamicGym_EventScript_Leader" }],
  });
  const observation = campaignObservation({ map: "MAP_DYNAMIC_GYM" });
  observation.playerMemory.position = { x: 1, y: 4 };
  observation.playerMemory.mapGrid = {
    width: 3,
    height: 5,
    cells: map.layout.cells.map((cell) => ({
      ...cell,
      collision: cell.x === 1 && cell.y === 2 ? 1 : cell.collision,
    })),
  };

  assert.equal(campaignNavigationRecommendation({
    world: { maps: [map] },
    observation,
    objective: {
      id: "respect-closed-barrier",
      target: { kind: "object", map: "MAP_DYNAMIC_GYM", index: 0 },
    },
  }), null);
});

test("campaign routing stops at a required Cut tree and requests the owned field move", () => {
  const walls = Object.fromEntries(
    Array.from({ length: 6 }, (_, y) => [[`0,${y}`, 1], [`2,${y}`, 1]]).flat(),
  );
  const map = openMap("MAP_CUT_ROUTE", {
    width: 3,
    height: 6,
    collisions: walls,
    objectEvents: [
      {
        x: 1,
        y: 3,
        graphics_id: "OBJ_EVENT_GFX_CUT_TREE",
        script: "EventScript_CutTree",
      },
      { x: 1, y: 0, script: "CutRoute_EventScript_Goal" },
    ],
  });
  const observation = campaignObservation({ map: "MAP_CUT_ROUTE", flags: { 2081: true } });
  observation.playerMemory.position = { x: 1, y: 4 };
  observation.playerMemory.trainer.party[0].moves = [15];
  observation.playerMemory.objectEvents = [{
    localId: 1,
    current: { x: 1, y: 3 },
    previous: { x: 1, y: 3 },
  }];

  const recommendation = campaignNavigationRecommendation({
    world: { maps: [map] },
    observation,
    objective: {
      id: "cross-cut-tree",
      target: { kind: "object", map: "MAP_CUT_ROUTE", index: 1 },
    },
  });

  assert.deepEqual(recommendation, {
    kind: "use-field-move",
    direction: "north",
    fieldMove: "cut",
    moveId: 15,
    objective: "cross-cut-tree",
    targetMap: "MAP_CUT_ROUTE",
    obstacle: { kind: "object", index: 0, x: 1, y: 3 },
    remainingSteps: 0,
  });
});

test("campaign routing runs around two Cut trees when the open detour is faster", () => {
  const map = openMap("MAP_OPTIONAL_CUT_ROUTE", {
    width: 9,
    height: 7,
    objectEvents: [
      {
        x: 4,
        y: 4,
        graphics_id: "OBJ_EVENT_GFX_CUT_TREE",
        script: "EventScript_CutTree",
      },
      {
        x: 4,
        y: 2,
        graphics_id: "OBJ_EVENT_GFX_CUT_TREE",
        script: "EventScript_CutTree",
      },
      { x: 4, y: 0, script: "OptionalCutRoute_EventScript_Goal" },
    ],
  });
  const observation = campaignObservation({
    map: map.id,
    flags: { 2081: true, 2095: true },
  });
  observation.playerMemory.position = { x: 4, y: 6 };
  observation.playerMemory.trainer.party[0].moves = [15];
  observation.playerMemory.objectEvents = [
    {
      localId: 1,
      current: { x: 4, y: 4 },
      previous: { x: 4, y: 4 },
    },
    {
      localId: 2,
      current: { x: 4, y: 2 },
      previous: { x: 4, y: 2 },
    },
  ];

  const recommendation = campaignNavigationRecommendation({
    world: { maps: [map] },
    observation,
    objective: {
      id: "avoid-optional-cut-trees",
      target: { kind: "object", map: map.id, index: 2 },
    },
  });

  assert.equal(recommendation?.kind, "move-toward");
  assert.equal(recommendation?.direction, "east");
  assert.equal(recommendation?.fieldMove, undefined);
});

test("campaign routing walks through a nearby Cut tile after the live object disappears", () => {
  const walls = Object.fromEntries(
    Array.from({ length: 6 }, (_, y) => [[`0,${y}`, 1], [`2,${y}`, 1]]).flat(),
  );
  const map = openMap("MAP_CUT_ROUTE", {
    width: 3,
    height: 6,
    collisions: walls,
    objectEvents: [
      {
        x: 1,
        y: 3,
        graphics_id: "OBJ_EVENT_GFX_CUT_TREE",
        script: "EventScript_CutTree",
      },
      { x: 1, y: 0, script: "CutRoute_EventScript_Goal" },
    ],
  });
  const observation = campaignObservation({ map: "MAP_CUT_ROUTE", flags: { 2081: true } });
  observation.playerMemory.position = { x: 1, y: 4 };
  observation.playerMemory.trainer.party[0].moves = [15];
  observation.playerMemory.objectEvents = [];

  const recommendation = campaignNavigationRecommendation({
    world: { maps: [map] },
    observation,
    objective: {
      id: "cross-cleared-tree",
      target: { kind: "object", map: "MAP_CUT_ROUTE", index: 1 },
    },
  });

  assert.equal(recommendation.kind, "move-toward");
  assert.equal(recommendation.direction, "north");
});

test("campaign routing activates Surf at the first water tile and then navigates while surfing", () => {
  const walls = Object.fromEntries(
    Array.from({ length: 6 }, (_, y) => [[`0,${y}`, 1], [`2,${y}`, 1]]).flat(),
  );
  const map = openMap("MAP_SURF_ROUTE", {
    width: 3,
    height: 6,
    collisions: walls,
    behaviors: { "1,2": "MB_OCEAN_WATER", "1,3": "MB_OCEAN_WATER" },
    objectEvents: [{ x: 1, y: 0, script: "SurfRoute_EventScript_Goal" }],
  });
  const observation = campaignObservation({ map: "MAP_SURF_ROUTE", flags: { 2084: true } });
  observation.playerMemory.position = { x: 1, y: 4 };
  observation.playerMemory.trainer.party[0].moves = [57];
  observation.playerMemory.avatar = { surfing: false };

  assert.deepEqual(campaignNavigationRecommendation({
    world: { maps: [map] },
    observation,
    objective: {
      id: "cross-water",
      target: { kind: "object", map: "MAP_SURF_ROUTE", index: 0 },
    },
  }), {
    kind: "use-field-move",
    direction: "north",
    fieldMove: "surf",
    moveId: 57,
    objective: "cross-water",
    targetMap: "MAP_SURF_ROUTE",
    obstacle: { kind: "terrain", x: 1, y: 3 },
    remainingSteps: 0,
  });

  observation.playerMemory.avatar.surfing = true;
  const surfing = campaignNavigationRecommendation({
    world: { maps: [map] },
    observation,
    objective: {
      id: "cross-water",
      target: { kind: "object", map: "MAP_SURF_ROUTE", index: 0 },
    },
  });
  assert.equal(surfing.kind, "move-toward");
  assert.equal(surfing.direction, "north");
});

test("campaign routing runs around a short water shortcut instead of mounting Surf", () => {
  const map = openMap("MAP_OPTIONAL_SURF_ROUTE", {
    width: 9,
    height: 7,
    behaviors: {
      "4,4": "MB_OCEAN_WATER",
      "4,5": "MB_OCEAN_WATER",
    },
    elevations: { "4,4": 1, "4,5": 1 },
    objectEvents: [{ x: 4, y: 0, script: "OptionalSurfRoute_EventScript_Goal" }],
  });
  for (const cell of map.layout.cells) {
    if (cell.behaviorName === "MB_OCEAN_WATER") cell.terrain = 2;
  }
  const observation = campaignObservation({
    map: map.id,
    flags: { 2084: true, 2095: true },
  });
  observation.playerMemory.position = { x: 4, y: 6 };
  observation.playerMemory.trainer.party[0].moves = [57];
  observation.playerMemory.avatar = { surfing: false };

  const recommendation = campaignNavigationRecommendation({
    world: { maps: [map] },
    observation,
    objective: {
      id: "avoid-short-surf-shortcut",
      target: { kind: "object", map: map.id, index: 0 },
    },
  });

  assert.equal(recommendation?.kind, "move-toward");
  assert.equal(recommendation?.direction, "east");
  assert.equal(recommendation?.fieldMove, undefined);
});

test("campaign routing pays one Surf mount for one continuous useful crossing", () => {
  const collisions = {};
  const behaviors = {};
  const elevations = {};
  for (let y = 1; y <= 47; y += 1) {
    for (let x = 4; x <= 8; x += 1) collisions[`${x},${y}`] = 1;
  }
  for (let x = 4; x <= 8; x += 1) {
    behaviors[`${x},48`] = "MB_OCEAN_WATER";
    elevations[`${x},48`] = 1;
  }
  const map = openMap("MAP_USEFUL_SURF_ROUTE", {
    width: 12,
    height: 49,
    collisions,
    behaviors,
    elevations,
    objectEvents: [{ x: 10, y: 48, script: "UsefulSurfRoute_EventScript_Goal" }],
  });
  for (const cell of map.layout.cells) {
    if (cell.behaviorName === "MB_OCEAN_WATER") cell.terrain = 2;
  }
  const observation = campaignObservation({
    map: map.id,
    flags: { 2084: true, 2095: true },
  });
  observation.playerMemory.position = { x: 3, y: 48 };
  observation.playerMemory.trainer.party[0].moves = [57];
  observation.playerMemory.avatar = { surfing: false };

  const recommendation = campaignNavigationRecommendation({
    world: { maps: [map] },
    observation,
    objective: {
      id: "use-worthwhile-surf-crossing",
      target: { kind: "object", map: map.id, index: 0 },
    },
  });

  assert.equal(recommendation?.kind, "use-field-move");
  assert.equal(recommendation?.direction, "east");
  assert.equal(recommendation?.fieldMove, "surf");
});

test("cross-map routing prefers a nearby open exit over a closer Cut exit", () => {
  const openCoordinates = new Set([
    "4,3",
    "4,4",
    "4,5",
    "4,6",
    "5,6",
    "6,6",
    "7,6",
    "8,6",
  ]);
  const collisions = Object.fromEntries(
    Array.from({ length: 9 * 7 }, (_, index) => {
      const coordinate = `${index % 9},${Math.floor(index / 9)}`;
      return [coordinate, openCoordinates.has(coordinate) ? 0 : 1];
    }),
  );
  const source = openMap("MAP_OPTIONAL_CUT_EXIT", {
    width: 9,
    height: 7,
    collisions,
    behaviors: {
      "4,3": "MB_LADDER",
      "8,6": "MB_LADDER",
    },
    warpEvents: [
      { x: 4, y: 3, dest_map: "MAP_SHARED_EXIT_GOAL", dest_warp_id: 0 },
      { x: 8, y: 6, dest_map: "MAP_SHARED_EXIT_GOAL", dest_warp_id: 1 },
    ],
    objectEvents: [{
      x: 4,
      y: 5,
      graphics_id: "OBJ_EVENT_GFX_CUT_TREE",
      script: "EventScript_CutTree",
    }],
  });
  const target = openMap("MAP_SHARED_EXIT_GOAL", {
    behaviors: {
      "1,1": "MB_LADDER",
      "3,1": "MB_LADDER",
    },
    warpEvents: [
      { x: 1, y: 1, dest_map: source.id, dest_warp_id: 0 },
      { x: 3, y: 1, dest_map: source.id, dest_warp_id: 1 },
    ],
    objectEvents: [{ x: 2, y: 3, script: "SharedExitGoal_EventScript_Goal" }],
  });
  const observation = campaignObservation({
    map: source.id,
    flags: { 2081: true },
  });
  observation.playerMemory.position = { x: 4, y: 6 };
  observation.playerMemory.trainer.party[0].moves = [15];
  observation.playerMemory.objectEvents = [{
    localId: 1,
    current: { x: 4, y: 5 },
    previous: { x: 4, y: 5 },
  }];

  const recommendation = campaignNavigationRecommendation({
    world: { maps: [source, target] },
    observation,
    objective: {
      id: "avoid-cut-exit",
      target: { kind: "object", map: target.id, index: 0 },
    },
  });

  assert.equal(recommendation?.kind, "move-toward");
  assert.equal(recommendation?.direction, "east");
  assert.deepEqual(recommendation?.transit, {
    kind: "warp",
    destinationMap: target.id,
    x: 8,
    y: 6,
  });
});

test("objective selection prefers an open destination over a closer Cut destination", () => {
  const openCoordinates = new Set([
    "4,3",
    "4,4",
    "4,5",
    "4,6",
    "5,6",
    "6,6",
    "7,6",
    "8,6",
  ]);
  const map = openMap("MAP_ROUTE_CHOICE_POKEMON_CENTER_1F", {
    width: 9,
    height: 7,
    collisions: Object.fromEntries(
      Array.from({ length: 9 * 7 }, (_, index) => {
        const coordinate = `${index % 9},${Math.floor(index / 9)}`;
        return [coordinate, openCoordinates.has(coordinate) ? 0 : 1];
      }),
    ),
    objectEvents: [
      {
        x: 4,
        y: 5,
        graphics_id: "OBJ_EVENT_GFX_CUT_TREE",
        script: "EventScript_CutTree",
      },
      { x: 4, y: 2, script: "CutRoute_EventScript_Nurse" },
      { x: 8, y: 5, script: "OpenRoute_EventScript_Nurse" },
    ],
  });
  const observation = campaignObservation({
    map: map.id,
    flags: { 2081: true },
  });
  observation.playerMemory.position = { x: 4, y: 6 };
  observation.playerMemory.trainer.party[0].moves = [15];
  observation.playerMemory.objectEvents = [{
    localId: 1,
    current: { x: 4, y: 5 },
    previous: { x: 4, y: 5 },
  }];

  assert.deepEqual(selectRecoveryObjective({
    world: { maps: [map] },
    observation,
  }), {
    id: "recover-party",
    target: { kind: "object", map: map.id, index: 2 },
  });
});

test("Surf cannot mount behavior-only water without the cartridge water terrain bit", () => {
  const walls = Object.fromEntries(
    Array.from({ length: 5 }, (_, y) => [[`0,${y}`, 1], [`2,${y}`, 1]]).flat(),
  );
  const map = openMap("MAP_CYCLING_WATER", {
    width: 3,
    height: 5,
    collisions: walls,
    behaviors: {
      "1,1": "MB_CYCLING_ROAD_WATER",
      "1,2": "MB_CYCLING_ROAD_WATER",
    },
    elevations: { "1,1": 1, "1,2": 1 },
    objectEvents: [{ x: 1, y: 0, script: "CyclingWater_EventScript_Goal" }],
  });
  for (const cell of map.layout.cells) {
    cell.terrain = 0;
  }
  const observation = campaignObservation({
    map: map.id,
    flags: { 2084: true },
  });
  observation.playerMemory.position = { x: 1, y: 3 };
  observation.playerMemory.trainer.party[0].moves = [57];
  observation.playerMemory.avatar = { surfing: false };

  assert.equal(campaignNavigationRecommendation({
    world: { maps: [map] },
    observation,
    objective: {
      id: "reject-false-surf-entry",
      target: { kind: "object", map: map.id, index: 0 },
    },
  }), null);
});

test("Surf joins elevation-three shores to elevation-one water across maps", () => {
  const corridorWalls = (height) => Object.fromEntries(
    Array.from({ length: height }, (_, y) => [[`0,${y}`, 1], [`2,${y}`, 1]]).flat(),
  );
  const water = (ys) => Object.fromEntries(ys.map((y) => [`1,${y}`, "MB_OCEAN_WATER"]));
  const waterElevation = (ys) => Object.fromEntries(ys.map((y) => [`1,${y}`, 1]));
  const coast = openMap("MAP_SURF_COAST", {
    width: 3,
    height: 5,
    collisions: corridorWalls(5),
    behaviors: water([0, 1, 2, 3]),
    elevations: waterElevation([0, 1, 2, 3]),
    connections: [{ direction: "up", map: "MAP_SURF_ISLAND", offset: 0 }],
  });
  const island = openMap("MAP_SURF_ISLAND", {
    width: 3,
    height: 5,
    collisions: corridorWalls(5),
    behaviors: water([3, 4]),
    elevations: waterElevation([3, 4]),
    connections: [{ direction: "down", map: "MAP_SURF_COAST", offset: 0 }],
    objectEvents: [{ x: 1, y: 0, script: "SurfIsland_EventScript_Goal" }],
  });
  const objective = {
    id: "cross-elevated-shore",
    target: { kind: "object", map: island.id, index: 0 },
  };
  const observation = campaignObservation({
    map: coast.id,
    flags: { 2084: true },
  });
  observation.playerMemory.position = { x: 1, y: 4 };
  observation.playerMemory.avatar = { surfing: false };
  observation.playerMemory.trainer.party[0].moves = [57];

  assert.deepEqual(campaignNavigationRecommendation({
    world: { maps: [coast, island] },
    observation,
    objective,
  }), {
    kind: "use-field-move",
    direction: "north",
    fieldMove: "surf",
    moveId: 57,
    objective: objective.id,
    targetMap: island.id,
    obstacle: { kind: "terrain", x: 1, y: 3 },
    remainingSteps: 0,
  });

  observation.playerMemory.map.id = island.id;
  observation.playerMemory.position = { x: 1, y: 3 };
  observation.playerMemory.avatar.surfing = true;
  const dismounting = campaignNavigationRecommendation({
    world: { maps: [coast, island] },
    observation,
    objective,
  });
  assert.equal(dismounting?.kind, "move-toward");
  assert.equal(dismounting?.direction, "north");
});

test("Surf never treats collision-one water borders as mountable terrain", () => {
  const map = openMap("MAP_SURF_BORDER", {
    width: 4,
    height: 5,
    behaviors: {
      "1,1": "MB_OCEAN_WATER",
      "1,2": "MB_OCEAN_WATER",
      "2,2": "MB_OCEAN_WATER",
      "2,3": "MB_OCEAN_WATER",
    },
    elevations: {
      "1,1": 1,
      "1,2": 1,
      "2,2": 0,
      "2,3": 1,
    },
    collisions: {
      "0,0": 1,
      "0,1": 1,
      "0,2": 1,
      "0,3": 1,
      "0,4": 1,
      "2,1": 1,
      "2,2": 1,
      "2,3": 1,
      "2,4": 1,
      "3,0": 1,
      "3,1": 1,
      "3,2": 1,
      "3,3": 1,
      "3,4": 1,
    },
    objectEvents: [{ x: 2, y: 0, script: "SurfBorder_EventScript_Goal" }],
  });
  const observation = campaignObservation({
    map: map.id,
    flags: { 2084: true },
  });
  observation.playerMemory.position = { x: 1, y: 3 };
  observation.playerMemory.avatar = { surfing: false };
  observation.playerMemory.trainer.party[0].moves = [57];

  const recommendation = campaignNavigationRecommendation({
    world: { maps: [map] },
    observation,
    objective: {
      id: "avoid-solid-water-border",
      target: { kind: "object", map: map.id, index: 0 },
    },
  });

  assert.equal(recommendation?.kind, "use-field-move");
  assert.equal(recommendation?.direction, "north");
  assert.deepEqual(recommendation?.obstacle, {
    kind: "terrain",
    x: 1,
    y: 2,
  });
});

test("campaign routing detours around a cartridge-observed live object", () => {
  const world = { maps: [
    openMap("MAP_PALLET_TOWN", {
      connections: [{ direction: "up", map: "MAP_ROUTE1", offset: 0 }],
    }),
    openMap("MAP_ROUTE1", {
      connections: [{ direction: "up", map: "MAP_VIRIDIAN_CITY", offset: 0 }],
    }),
    openMap("MAP_VIRIDIAN_CITY", {
      warpEvents: [
        { x: 0, y: 4, dest_map: "MAP_UNUSED", dest_warp_id: "0" },
        { x: 1, y: 4, dest_map: "MAP_UNUSED", dest_warp_id: "0" },
        { x: 2, y: 4, dest_map: "MAP_UNUSED", dest_warp_id: "0" },
        { x: 3, y: 4, dest_map: "MAP_UNUSED", dest_warp_id: "0" },
        { x: 3, y: 2, dest_map: "MAP_VIRIDIAN_CITY_MART", dest_warp_id: "0" },
      ],
    }),
  ] };
  const observation = campaignObservation({ map: "MAP_PALLET_TOWN" });
  observation.playerMemory.position = { x: 2, y: 3 };
  observation.playerMemory.objectEvents = [{
    id: 3,
    player: false,
    current: { x: 2, y: 2 },
    previous: { x: 2, y: 2 },
  }];

  const recommendation = campaignNavigationRecommendation({
    world,
    observation,
    objective: createCampaignPlanner().select(observation),
  });

  assert.equal(recommendation.kind, "move-toward");
  assert.equal(recommendation.direction, "east");
  assert.equal(recommendation.remainingSteps, 4);
});

test("campaign routing keeps flagged map objects blocked after FireRed culls them off-screen", () => {
  const corridorWalls = Object.fromEntries(
    Array.from({ length: 7 }, (_, y) => [
      [`0,${y}`, 1],
      [`2,${y}`, 1],
    ]).flat(),
  );
  const world = { maps: [openMap("MAP_FOSSIL_CORRIDOR", {
    width: 3,
    height: 7,
    collisions: corridorWalls,
    coordEvents: [{ x: 1, y: 0, type: "trigger", script: "Exit_EventScript" }],
    objectEvents: [{
      x: 1,
      y: 3,
      flag: "FLAG_HIDE_ROUTE_FOSSIL",
      graphics_id: "OBJ_EVENT_GFX_FOSSIL",
      script: "Cave_EventScript_Fossil",
    }],
  })] };
  const observation = campaignObservation({ map: "MAP_FOSSIL_CORRIDOR" });
  observation.playerMemory.position = { x: 1, y: 6 };
  observation.playerMemory.objectEvents = [];
  observation.playerMemory.storyState.flags = {
    FLAG_HIDE_ROUTE_FOSSIL: false,
  };
  const objective = {
    id: "reach-cave-exit",
    target: { kind: "trigger", map: "MAP_FOSSIL_CORRIDOR", index: 0 },
  };

  assert.equal(campaignNavigationRecommendation({ world, observation, objective }), null);

  observation.playerMemory.storyState.flags.FLAG_HIDE_ROUTE_FOSSIL = true;
  assert.equal(
    campaignNavigationRecommendation({ world, observation, objective })?.direction,
    "north",
  );
});

test("the live player position proves a removed story object no longer blocks an interaction", () => {
  const map = openMap("MAP_GAME_CORNER", {
    objectEvents: [{
      x: 2,
      y: 2,
      flag: "FLAG_HIDE_POSTER_GUARD",
      script: "GameCorner_EventScript_PosterGuard",
    }],
    backgroundEvents: [{
      x: 2,
      y: 1,
      script: "GameCorner_EventScript_Poster",
    }],
  });
  const observation = campaignObservation({ map: map.id });
  observation.playerMemory.position = { x: 2, y: 2 };
  observation.playerMemory.objectEvents = [{
    id: 0,
    player: true,
    localId: 255,
    current: { x: 2, y: 2 },
    previous: { x: 2, y: 2 },
  }];
  observation.playerMemory.storyState.flags = {
    FLAG_HIDE_POSTER_GUARD: false,
  };

  assert.deepEqual(campaignNavigationRecommendation({
    world: { maps: [map] },
    observation,
    objective: {
      id: "open-secret-stairs",
      target: { kind: "background", map: map.id, index: 0 },
    },
  }), {
    kind: "interact-with-background",
    direction: "north",
    objective: "open-secret-stairs",
    targetMap: map.id,
    target: {
      kind: "background",
      index: 0,
      x: 2,
      y: 1,
      script: "GameCorner_EventScript_Poster",
    },
    remainingSteps: 0,
  });
});

test("campaign routing resolves the objective's indexed activation on its target map", () => {
  const warpEvents = [0, 1, 2, 3].map((index) => ({
    x: index,
    y: 4,
    dest_map: `MAP_UNUSED_${index}`,
    dest_warp_id: "0",
  }));
  warpEvents.push({
    x: 3,
    y: 2,
    dest_map: "MAP_VIRIDIAN_CITY_MART",
    dest_warp_id: "0",
  });
  const world = { maps: [openMap("MAP_VIRIDIAN_CITY", { warpEvents })] };
  const observation = campaignObservation({ map: "MAP_VIRIDIAN_CITY" });
  observation.playerMemory.position = { x: 1, y: 2 };

  const recommendation = campaignNavigationRecommendation({
    world,
    observation,
    objective: createCampaignPlanner().select(observation),
  });

  assert.deepEqual(recommendation, {
    kind: "move-toward",
    direction: "east",
    pathSegment: {
      direction: "east",
      steps: 2,
      endpoint: { map: "MAP_VIRIDIAN_CITY", x: 3, y: 2 },
    },
    objective: "oak-parcel",
    targetMap: "MAP_VIRIDIAN_CITY",
    target: {
      kind: "warp",
      index: 4,
      x: 3,
      y: 2,
    },
    remainingSteps: 2,
  });
});

test("campaign routing approaches a collidable door warp from below and enters north", () => {
  const warpEvents = [0, 1, 2, 3].map((index) => ({
    x: index,
    y: 4,
    dest_map: `MAP_UNUSED_${index}`,
    dest_warp_id: "0",
  }));
  warpEvents.push({
    x: 3,
    y: 2,
    dest_map: "MAP_VIRIDIAN_CITY_MART",
    dest_warp_id: "1",
  });
  const world = { maps: [openMap("MAP_VIRIDIAN_CITY", {
    warpEvents,
    behaviors: { "3,2": "MB_WARP_DOOR" },
    collisions: { "3,2": 1 },
  })] };
  const observation = campaignObservation({ map: "MAP_VIRIDIAN_CITY" });
  observation.playerMemory.position = { x: 1, y: 3 };
  const objective = createCampaignPlanner().select(observation);

  const approaching = campaignNavigationRecommendation({
    world,
    observation,
    objective,
  });
  observation.playerMemory.position = { x: 3, y: 3 };
  const entering = campaignNavigationRecommendation({
    world,
    observation,
    objective,
  });

  assert.equal(approaching.kind, "move-toward");
  assert.equal(approaching.direction, "east");
  assert.equal(approaching.remainingSteps, 2);
  assert.deepEqual(approaching.pathSegment, {
    direction: "east",
    steps: 2,
    endpoint: { map: "MAP_VIRIDIAN_CITY", x: 3, y: 3 },
  });
  assert.equal(entering.kind, "traverse-door-warp");
  assert.equal(entering.direction, "north");
  assert.equal(entering.remainingSteps, 0);
  assert.equal(entering.pathSegment, undefined);
});

test("campaign routing ends a running segment exactly where the chosen route turns", () => {
  const warpEvents = [0, 1, 2, 3].map((index) => ({
    x: index,
    y: 4,
    dest_map: `MAP_UNUSED_${index}`,
    dest_warp_id: "0",
  }));
  warpEvents.push({
    x: 3,
    y: 1,
    dest_map: "MAP_VIRIDIAN_CITY_MART",
    dest_warp_id: "1",
  });
  const world = { maps: [openMap("MAP_VIRIDIAN_CITY", {
    warpEvents,
    behaviors: { "3,1": "MB_WARP_DOOR" },
    collisions: { "3,1": 1 },
  })] };
  const observation = campaignObservation({ map: "MAP_VIRIDIAN_CITY" });
  observation.playerMemory.position = { x: 1, y: 3 };

  const recommendation = campaignNavigationRecommendation({
    world,
    observation,
    objective: createCampaignPlanner().select(observation),
  });

  assert.equal(recommendation.kind, "move-toward");
  assert.equal(recommendation.remainingSteps, 3);
  assert.deepEqual(recommendation.pathSegment, {
    direction: "east",
    steps: 2,
    endpoint: { map: "MAP_VIRIDIAN_CITY", x: 3, y: 3 },
    continuationDirection: "north",
  });
});

test("campaign routing preserves every safe turn to the current-map destination", () => {
  const world = { maps: [openMap("MAP_ROUTE_PLAN", {
    width: 6,
    height: 6,
    objectEvents: [{
      x: 4,
      y: 1,
      script: "RoutePlan_EventScript_Target",
    }],
  })] };
  const observation = campaignObservation({ map: "MAP_ROUTE_PLAN" });
  observation.playerMemory.position = { x: 1, y: 4 };

  const recommendation = rawCampaignNavigationRecommendation({
    world,
    observation,
    objective: {
      id: "full-current-map-route",
      target: { kind: "object", map: "MAP_ROUTE_PLAN", index: 0 },
    },
  });

  const { mapRevision, ...routePlan } = recommendation.routePlan;
  assert.match(mapRevision, /^[0-9a-f]{64}$/);
  assert.deepEqual(routePlan, {
    map: "MAP_ROUTE_PLAN",
    origin: { x: 1, y: 4 },
    destination: { x: 4, y: 2 },
    steps: 5,
    segments: [
      { direction: "east", steps: 3, endpoint: { x: 4, y: 4 } },
      { direction: "north", steps: 2, endpoint: { x: 4, y: 2 } },
    ],
  });
});

test("current-map route revisions cover the complete live collision surface", () => {
  const map = openMap("MAP_ROUTE_REVISION", {
    width: 6,
    height: 6,
    objectEvents: [{ x: 4, y: 1, script: "RouteRevision_EventScript_Target" }],
  });
  const observation = campaignObservation({ map: map.id });
  observation.playerMemory.position = { x: 1, y: 4 };
  observation.playerMemory.mapGrid = {
    width: map.layout.width,
    height: map.layout.height,
    cells: map.layout.cells.map((cell) => ({ ...cell })),
  };
  const objective = {
    id: "live-map-revision",
    target: { kind: "object", map: map.id, index: 0 },
  };

  const before = rawCampaignNavigationRecommendation({
    world: { maps: [map] },
    observation,
    objective,
  });
  observation.playerMemory.mapGrid.cells = observation.playerMemory.mapGrid.cells.map(
    (cell) => cell.x === 0 && cell.y === 0
      ? { ...cell, collision: 1 }
      : cell,
  );
  const after = rawCampaignNavigationRecommendation({
    world: { maps: [map] },
    observation,
    objective,
  });

  assert.match(before.routePlan.mapRevision, /^[0-9a-f]{64}$/);
  assert.match(after.routePlan.mapRevision, /^[0-9a-f]{64}$/);
  assert.notEqual(after.routePlan.mapRevision, before.routePlan.mapRevision);
});

test("campaign routing exposes a verified turn after a one-tile running segment", () => {
  const warpEvents = [0, 1, 2, 3].map((index) => ({
    x: index,
    y: 4,
    dest_map: `MAP_UNUSED_${index}`,
    dest_warp_id: "0",
  }));
  warpEvents.push({
    x: 3,
    y: 1,
    dest_map: "MAP_VIRIDIAN_CITY_MART",
    dest_warp_id: "1",
  });
  const world = { maps: [openMap("MAP_VIRIDIAN_CITY", {
    warpEvents,
    behaviors: { "3,1": "MB_WARP_DOOR" },
    collisions: { "3,1": 1 },
  })] };
  const observation = campaignObservation({ map: "MAP_VIRIDIAN_CITY" });
  observation.playerMemory.position = { x: 2, y: 3 };

  const recommendation = campaignNavigationRecommendation({
    world,
    observation,
    objective: createCampaignPlanner().select(observation),
  });

  assert.deepEqual(recommendation.pathSegment, {
    direction: "east",
    steps: 1,
    endpoint: { map: "MAP_VIRIDIAN_CITY", x: 3, y: 3 },
    continuationDirection: "north",
  });
});

test("campaign routing approaches and faces an indexed story object", () => {
  const objectEvents = [0, 1, 2].map((index) => ({ x: index, y: 4 }));
  objectEvents.push({
    x: 3,
    y: 1,
    local_id: "LOCALID_OAKS_LAB_PROF_OAK",
    script: "PalletTown_ProfessorOaksLab_EventScript_ProfOak",
  });
  const world = { maps: [openMap(
    "MAP_PALLET_TOWN_PROFESSOR_OAKS_LAB",
    { objectEvents },
  )] };
  const objectiveObservation = campaignObservation({ variables: { 16471: 1 } });
  objectiveObservation.playerMemory.position = { x: 1, y: 3 };
  const objective = createCampaignPlanner().select(objectiveObservation);
  const approaching = campaignNavigationRecommendation({
    world,
    observation: objectiveObservation,
    objective,
  });
  objectiveObservation.playerMemory.position = { x: 3, y: 2 };
  const interacting = campaignNavigationRecommendation({
    world,
    observation: objectiveObservation,
    objective,
  });

  assert.equal(approaching?.kind, "move-toward");
  assert.equal(approaching?.direction, "east");
  assert.equal(approaching?.objective, "regional-pokedex");
  assert.equal(approaching?.remainingSteps, 3);
  assert.equal(interacting?.kind, "interact-with-object");
  assert.equal(interacting?.direction, "north");
  assert.equal(interacting?.target?.index, 3);
});

test("the Cerulean Rocket objective routes through the robbed house before the trigger", () => {
  const corridorWalls = Object.fromEntries(
    Array.from({ length: 7 }, (_, y) => [[`0,${y}`, 1], [`2,${y}`, 1]]).flat(),
  );
  const city = openMap("MAP_CERULEAN_CITY", {
    width: 3,
    height: 7,
    collisions: corridorWalls,
    behaviors: { "1,0": "MB_WARP_DOOR" },
    warpEvents: [
      { x: 0, y: 0, dest_map: "MAP_UNUSED", dest_warp_id: "0" },
      { x: 1, y: 0, dest_map: "MAP_CERULEAN_CITY_HOUSE2", dest_warp_id: "1" },
    ],
    objectEvents: [{
      x: 1,
      y: 3,
      graphics_id: "OBJ_EVENT_GFX_CUT_TREE",
      flag: "FLAG_TEMP_13",
    }],
    coordEvents: [0, 1, 2, 3].map((index) => ({ x: 0, y: index }))
      .concat({ x: 1, y: 5, script: "CeruleanCity_EventScript_GruntTriggerBottom" }),
  });
  const house = openMap("MAP_CERULEAN_CITY_HOUSE2", {
    width: 3,
    height: 5,
    behaviors: { "1,0": "MB_WARP_DOOR" },
    warpEvents: [
      { x: 0, y: 0, dest_map: "MAP_UNUSED", dest_warp_id: "0" },
      { x: 0, y: 0, dest_map: "MAP_UNUSED", dest_warp_id: "0" },
      { x: 0, y: 0, dest_map: "MAP_UNUSED", dest_warp_id: "0" },
      { x: 1, y: 0, dest_map: "MAP_CERULEAN_CITY", dest_warp_id: "1" },
    ],
  });
  const world = { maps: [city, house] };
  const objective = MAIN_STORY_CAMPAIGN.objectives.find(
    ({ id }) => id === "cerulean-rocket",
  );
  const observation = campaignObservation({ map: city.id });
  observation.playerMemory.position = { x: 1, y: 1 };

  const enteringHouse = campaignNavigationRecommendation({
    world, observation, objective,
  });
  observation.playerMemory.map.id = house.id;
  observation.playerMemory.position = { x: 1, y: 2 };
  const leavingThroughBack = campaignNavigationRecommendation({
    world, observation, objective,
  });
  observation.playerMemory.map.id = city.id;
  observation.playerMemory.position = { x: 1, y: 4 };
  const approachingRocket = campaignNavigationRecommendation({
    world, observation, objective,
  });

  assert.equal(objective?.target?.kind, "cerulean-rocket");
  assert.equal(enteringHouse?.kind, "traverse-door-warp");
  assert.equal(enteringHouse?.target?.index, 1);
  assert.equal(leavingThroughBack?.kind, "move-toward");
  assert.equal(leavingThroughBack?.direction, "north");
  assert.equal(leavingThroughBack?.target?.index, 3);
  assert.equal(approachingRocket?.kind, "move-toward");
  assert.equal(approachingRocket?.direction, "south");
  assert.equal(approachingRocket?.target?.index, 4);
});

test("the S.S. Anne route reuses the robbed-house bypass after a Cerulean whiteout", () => {
  const corridorWalls = Object.fromEntries(
    Array.from({ length: 7 }, (_, y) => [[`0,${y}`, 1], [`2,${y}`, 1]]).flat(),
  );
  const city = openMap("MAP_CERULEAN_CITY", {
    width: 3,
    height: 7,
    collisions: corridorWalls,
    behaviors: { "1,0": "MB_WARP_DOOR" },
    warpEvents: [
      { x: 0, y: 0, dest_map: "MAP_UNUSED", dest_warp_id: "0" },
      { x: 1, y: 0, dest_map: "MAP_CERULEAN_CITY_HOUSE2", dest_warp_id: "1" },
    ],
    connections: [{ direction: "down", map: "MAP_GOAL", offset: 0 }],
    objectEvents: [{
      x: 1,
      y: 3,
      graphics_id: "OBJ_EVENT_GFX_CUT_TREE",
      flag: "FLAG_TEMP_13",
    }],
  });
  const house = openMap("MAP_CERULEAN_CITY_HOUSE2", {
    width: 3,
    height: 5,
    behaviors: { "1,0": "MB_WARP_DOOR" },
    warpEvents: [
      { x: 0, y: 0, dest_map: "MAP_UNUSED", dest_warp_id: "0" },
      { x: 0, y: 0, dest_map: "MAP_UNUSED", dest_warp_id: "0" },
      { x: 0, y: 0, dest_map: "MAP_UNUSED", dest_warp_id: "0" },
      { x: 1, y: 0, dest_map: "MAP_CERULEAN_CITY", dest_warp_id: "1" },
    ],
  });
  const goal = openMap("MAP_GOAL", {
    width: 3,
    height: 3,
    connections: [{ direction: "up", map: "MAP_CERULEAN_CITY", offset: 0 }],
    objectEvents: [{ x: 1, y: 1, script: "Goal_EventScript_Target" }],
  });
  const world = { maps: [city, house, goal] };
  const objective = {
    id: "rival-ss-anne",
    target: { kind: "object", map: "MAP_GOAL", index: 0 },
    ceruleanPassage: true,
  };
  const observation = campaignObservation({ map: city.id });
  observation.playerMemory.position = { x: 1, y: 1 };

  const reentering = campaignNavigationRecommendation({ world, observation, objective });
  observation.playerMemory.map.id = house.id;
  observation.playerMemory.position = { x: 1, y: 2 };
  const leavingThroughBack = campaignNavigationRecommendation({
    world, observation, objective,
  });
  observation.playerMemory.map.id = city.id;
  observation.playerMemory.position = { x: 1, y: 4 };
  const continuingSouth = campaignNavigationRecommendation({
    world, observation, objective,
  });

  assert.equal(
    MAIN_STORY_CAMPAIGN.objectives.find(({ id }) => id === "rival-ss-anne")
      ?.ceruleanPassage,
    true,
  );
  assert.equal(reentering?.target?.index, 1);
  assert.equal(reentering?.ceruleanPhase, "enter-robbed-house");
  assert.equal(leavingThroughBack?.target?.index, 3);
  assert.equal(leavingThroughBack?.ceruleanPhase, "leave-through-back");
  assert.equal(continuingSouth?.direction, "south");
  assert.notEqual(continuingSouth?.ceruleanPhase, "enter-robbed-house");
});

test("campaign routing follows a story object that moved from its source coordinate", () => {
  const world = { maps: [openMap("MAP_ROUTE25_SEA_COTTAGE", {
    width: 15,
    height: 11,
    objectEvents: [{
      x: 7,
      y: 5,
      local_id: "LOCALID_BILL_HUMAN",
      script: "Route25_SeaCottage_EventScript_Bill",
    }],
  })] };
  const objective = {
    id: "ss-ticket",
    target: { kind: "object", map: "MAP_ROUTE25_SEA_COTTAGE", index: 0 },
  };
  const observation = campaignObservation({ map: "MAP_ROUTE25_SEA_COTTAGE" });
  observation.playerMemory.position = { x: 6, y: 5 };
  observation.playerMemory.objectEvents = [{
    id: 2,
    player: false,
    localId: 1,
    current: { x: 7, y: 6 },
    previous: { x: 7, y: 6 },
  }];

  const approaching = campaignNavigationRecommendation({ world, observation, objective });
  observation.playerMemory.position = { x: 6, y: 6 };
  const interacting = campaignNavigationRecommendation({ world, observation, objective });

  assert.equal(approaching?.kind, "move-toward");
  assert.equal(approaching?.direction, "south");
  assert.equal(approaching?.remainingSteps, 1);
  assert.equal(interacting?.kind, "interact-with-object");
  assert.equal(interacting?.direction, "east");
  assert.deepEqual(
    { x: interacting?.target?.x, y: interacting?.target?.y },
    { x: 7, y: 6 },
  );
});

test("campaign routing ignores a neighboring map object with the same local ID", () => {
  const route = openMap("MAP_ROUTE15", {
    width: 8,
    objectEvents: [{
      x: 1,
      y: 2,
      script: "Route15_EventScript_Mya",
    }],
  });
  const world = { maps: [route] };
  const objective = {
    id: "mastery-trainer:MAP_ROUTE15:0",
    target: { kind: "object", map: route.id, index: 0 },
  };
  const observation = campaignObservation({ map: route.id });
  observation.playerMemory.map = { id: route.id, group: 3, number: 33 };
  observation.playerMemory.position = { x: 6, y: 2 };
  observation.playerMemory.objectEvents = [{
    id: 3,
    player: false,
    localId: 1,
    map: { group: 3, number: 32 },
    current: { x: 9, y: 2 },
    previous: { x: 9, y: 2 },
  }];

  const recommendation = campaignNavigationRecommendation({
    world,
    observation,
    objective,
  });

  assert.equal(recommendation?.kind, "move-toward");
  assert.equal(recommendation?.direction, "west");
  assert.equal(recommendation?.remainingSteps, 4);
  assert.deepEqual(
    { x: recommendation?.target?.x, y: recommendation?.target?.y },
    { x: 1, y: 2 },
  );
});

test("campaign routing interacts with a cartridge object across a counter", () => {
  const world = { maps: [openMap("MAP_POKEMON_CENTER_1F", {
    width: 5,
    height: 6,
    collisions: {
      "2,0": 1,
      "1,1": 1,
      "3,1": 1,
      "2,2": 1,
    },
    behaviors: { "2,2": "MB_COUNTER" },
    objectEvents: [{
      x: 2,
      y: 1,
      local_id: "LOCALID_NURSE",
      script: "PokemonCenter_1F_EventScript_Nurse",
    }],
  })] };
  const objective = {
    id: "recover-party",
    target: { kind: "object", map: "MAP_POKEMON_CENTER_1F", index: 0 },
  };
  const observation = campaignObservation({ map: "MAP_POKEMON_CENTER_1F" });
  observation.playerMemory.position = { x: 2, y: 4 };
  const approaching = campaignNavigationRecommendation({ world, observation, objective });
  observation.playerMemory.position = { x: 2, y: 3 };
  const interacting = campaignNavigationRecommendation({ world, observation, objective });

  assert.equal(approaching.kind, "move-toward");
  assert.equal(approaching.direction, "north");
  assert.equal(approaching.remainingSteps, 1);
  assert.equal(interacting.kind, "interact-with-object");
  assert.equal(interacting.direction, "north");
});

test("campaign routing approaches and activates a cartridge background event", () => {
  const world = { maps: [openMap("MAP_SWITCH_ROOM", {
    width: 5,
    height: 5,
    backgroundEvents: [{
      x: 3,
      y: 1,
      script: "SwitchRoom_EventScript_ControlPanel",
    }],
  })] };
  const objective = {
    id: "open-switch",
    target: { kind: "background", map: "MAP_SWITCH_ROOM", index: 0 },
    completion: { kind: "variable-at-least", id: 0x4060, value: 1 },
  };
  const observation = campaignObservation({ map: "MAP_SWITCH_ROOM" });
  observation.playerMemory.position = { x: 1, y: 1 };

  assert.equal(campaignNavigationRecommendation({
    world, observation, objective,
  })?.direction, "east");
  observation.playerMemory.position = { x: 2, y: 1 };
  assert.deepEqual(campaignNavigationRecommendation({
    world, observation, objective,
  }), {
    kind: "interact-with-background",
    direction: "east",
    objective: "open-switch",
    targetMap: "MAP_SWITCH_ROOM",
    target: {
      kind: "background",
      index: 0,
      x: 3,
      y: 1,
      script: "SwitchRoom_EventScript_ControlPanel",
    },
    remainingSteps: 0,
  });
});

test("background events honor the cartridge's required player-facing direction", () => {
  const map = openMap("MAP_DIRECTIONAL_SWITCH_ROOM", {
    width: 5,
    height: 5,
    backgroundEvents: [{
      x: 3,
      y: 1,
      player_facing_dir: "BG_EVENT_PLAYER_FACING_NORTH",
      script: "DirectionalSwitchRoom_EventScript_ControlPanel",
    }],
  });
  const world = { maps: [map] };
  const objective = {
    id: "open-directional-switch",
    target: { kind: "background", map: map.id, index: 0 },
  };
  const observation = campaignObservation({ map: map.id });
  observation.playerMemory.position = { x: 2, y: 1 };

  const reposition = campaignNavigationRecommendation({
    world, observation, objective,
  });
  assert.equal(reposition?.kind, "move-toward");
  assert.equal(reposition?.direction, "south");

  observation.playerMemory.position = { x: 3, y: 2 };
  assert.deepEqual(campaignNavigationRecommendation({
    world, observation, objective,
  }), {
    kind: "interact-with-background",
    direction: "north",
    objective: objective.id,
    targetMap: map.id,
    target: {
      kind: "background",
      index: 0,
      x: 3,
      y: 1,
      script: "DirectionalSwitchRoom_EventScript_ControlPanel",
    },
    remainingSteps: 0,
  });
});

test("campaign routing activates a reachable tile of one multi-tile background script", () => {
  const barrier = Object.fromEntries(
    Array.from({ length: 7 }, (_, x) => [`${x},4`, 1]),
  );
  barrier["3,5"] = 1;
  barrier["4,5"] = 1;
  const doorScript = "SilphCo_11F_EventScript_Door";
  const map = openMap("MAP_SILPH_CO_11F", {
    width: 7,
    height: 9,
    collisions: barrier,
    backgroundEvents: [
      { x: 3, y: 4, script: doorScript },
      { x: 3, y: 5, script: doorScript },
      { x: 4, y: 4, script: doorScript },
      { x: 4, y: 5, script: doorScript },
    ],
  });
  const observation = campaignObservation({ map: map.id });
  observation.playerMemory.position = { x: 3, y: 7 };
  const objective = {
    id: "silph-eleventh-floor-door",
    target: { kind: "background", map: map.id, index: 0 },
  };

  assert.deepEqual(campaignNavigationRecommendation({
    world: { maps: [map] }, observation, objective,
  }), {
    kind: "move-toward",
    direction: "north",
    objective: objective.id,
    targetMap: map.id,
    target: {
      kind: "background",
      index: 1,
      x: 3,
      y: 5,
      script: doorScript,
    },
    remainingSteps: 1,
  });

  observation.playerMemory.position = { x: 3, y: 6 };
  const interacting = campaignNavigationRecommendation({
    world: { maps: [map] }, observation, objective,
  });
  assert.equal(interacting?.kind, "interact-with-background");
  assert.equal(interacting?.direction, "north");
  assert.equal(interacting?.target?.index, 1);
});

test("a cartridge variable selects the exact indexed background event", () => {
  const map = openMap("MAP_RANDOM_SWITCHES", {
    width: 7,
    height: 5,
    backgroundEvents: Array.from({ length: 5 }, (_, index) => ({
      x: index + 1,
      y: 1,
      script: `RandomSwitch_EventScript_${index}`,
    })),
  });
  const observation = campaignObservation({
    map: "MAP_RANDOM_SWITCHES",
    variables: { 0x4000: 3 },
  });
  observation.playerMemory.position = { x: 1, y: 3 };
  const recommendation = campaignNavigationRecommendation({
    world: { maps: [map] },
    observation,
    objective: {
      id: "random-switch",
      target: {
        kind: "variable-background",
        map: "MAP_RANDOM_SWITCHES",
        variableId: 0x4000,
        indexOffset: 1,
      },
      completion: { kind: "flag-set", id: 1 },
    },
  });
  assert.equal(recommendation.target.index, 4);
  assert.equal(recommendation.target.x, 5);
});

test("the Rocket Hideout elevator selects B4F and exits through its dynamic warp", () => {
  const elevator = openMap("MAP_ROCKET_HIDEOUT_ELEVATOR", {
    width: 5,
    height: 7,
    warpEvents: [
      { x: 1, y: 5, dest_map: "MAP_DYNAMIC", dest_warp_id: "WARP_ID_DYNAMIC" },
      { x: 2, y: 5, dest_map: "MAP_DYNAMIC", dest_warp_id: "WARP_ID_DYNAMIC" },
    ],
    behaviors: { "2,5": "MB_SOUTH_ARROW_WARP" },
    backgroundEvents: [{
      x: 0,
      y: 2,
      script: "RocketHideout_Elevator_EventScript_FloorSelect",
    }],
  });
  const b4f = openMap("MAP_ROCKET_HIDEOUT_B4F", {
    objectEvents: [{ x: 3, y: 3, script: "RocketHideout_B4F_EventScript_Grunt" }],
  });
  const objective = {
    id: "rocket-hideout-door-grunt-left",
    target: { kind: "object", map: b4f.id, index: 0 },
    rocketHideoutElevator: true,
    choiceIndex: 2,
    choiceMaps: [elevator.id],
  };
  const observation = campaignObservation({
    map: elevator.id,
    variables: { 0x403a: 2 },
    flags: { 2: false },
  });
  observation.playerMemory.position = { x: 1, y: 2 };

  assert.equal(campaignNavigationRecommendation({
    world: { maps: [elevator, b4f] }, observation, objective,
  })?.kind, "interact-with-background");

  observation.playerMemory.storyState.variableIds[0x403a] = 0;
  observation.playerMemory.storyState.flagIds[2] = true;
  observation.playerMemory.position = { x: 2, y: 4 };
  assert.deepEqual(campaignNavigationRecommendation({
    world: { maps: [elevator, b4f] }, observation, objective,
  }), {
    kind: "move-toward",
    direction: "south",
    objective: objective.id,
    targetMap: b4f.id,
    target: { kind: "warp", index: 1, x: 2, y: 5 },
    remainingSteps: 1,
    rocketHideoutPhase: "exit-elevator-on-b4f",
  });
});

test("the Rocket Hideout elevator clears a blocking B2 maze item", () => {
  const walls = Object.fromEntries(
    Array.from({ length: 5 }, (_, y) => [[`0,${y}`, 1], [`2,${y}`, 1]]).flat(),
  );
  const b2f = openMap("MAP_ROCKET_HIDEOUT_B2F", {
    width: 3,
    height: 5,
    collisions: walls,
    objectEvents: [{
      x: 1,
      y: 2,
      graphics_id: "OBJ_EVENT_GFX_ITEM_BALL",
      script: "RocketHideout_B2F_EventScript_ItemMoonStone",
      flag: "FLAG_HIDE_ROCKET_HIDEOUT_B2F_MOON_STONE",
    }],
    warpEvents: [
      { x: 0, y: 0, dest_map: "MAP_UNUSED", dest_warp_id: "0" },
      { x: 0, y: 0, dest_map: "MAP_UNUSED", dest_warp_id: "0" },
      { x: 0, y: 4, dest_map: "MAP_UNUSED", dest_warp_id: "0" },
      { x: 1, y: 4, dest_map: "MAP_ROCKET_HIDEOUT_ELEVATOR", dest_warp_id: "1" },
    ],
    behaviors: { "1,4": "MB_REGULAR_WARP" },
  });
  const b4f = openMap("MAP_ROCKET_HIDEOUT_B4F", {
    objectEvents: [{ x: 3, y: 3, script: "RocketHideout_B4F_Grunt" }],
  });
  const observation = campaignObservation({ map: b2f.id });
  observation.playerMemory.position = { x: 1, y: 1 };

  const recommendation = campaignNavigationRecommendation({
    world: { maps: [b2f, b4f] },
    observation,
    objective: {
      id: "rocket-hideout-door-grunt-left",
      target: { kind: "object", map: b4f.id, index: 0 },
      rocketHideoutElevator: true,
    },
  });

  assert.equal(recommendation?.kind, "interact-with-object");
  assert.equal(recommendation?.direction, "south");
  assert.equal(recommendation?.obstacle?.index, 0);
  assert.equal(recommendation?.rocketHideoutPhase, "reach-elevator");
});

test("the Rocket Hideout elevator itinerary leaves B3 through B2 instead of reversing to B4", () => {
  const b2f = openMap("MAP_ROCKET_HIDEOUT_B2F", {
    warpEvents: [{
      x: 3,
      y: 3,
      dest_map: "MAP_ROCKET_HIDEOUT_B3F",
      dest_warp_id: "0",
    }],
    behaviors: { "3,3": "MB_DOWN_RIGHT_STAIR_WARP" },
  });
  const b3f = openMap("MAP_ROCKET_HIDEOUT_B3F", {
    warpEvents: [
      {
        x: 3,
        y: 1,
        dest_map: b2f.id,
        dest_warp_id: "0",
      },
      {
        x: 1,
        y: 3,
        dest_map: "MAP_ROCKET_HIDEOUT_B4F",
        dest_warp_id: "0",
      },
    ],
    behaviors: {
      "3,1": "MB_UP_RIGHT_STAIR_WARP",
      "1,3": "MB_DOWN_LEFT_STAIR_WARP",
    },
  });
  const b4f = openMap("MAP_ROCKET_HIDEOUT_B4F", {
    warpEvents: [{
      x: 1,
      y: 1,
      dest_map: b3f.id,
      dest_warp_id: "1",
    }],
    behaviors: { "1,1": "MB_UP_RIGHT_STAIR_WARP" },
    objectEvents: [{
      x: 3,
      y: 3,
      script: "RocketHideout_B4F_EventScript_Grunt2",
    }],
  });
  const objective = {
    id: "rocket-hideout-door-grunt-left",
    target: { kind: "object", map: b4f.id, index: 0 },
    rocketHideoutElevator: true,
  };
  const observation = campaignObservation({ map: b3f.id });
  observation.playerMemory.position = { x: 1, y: 3 };

  const recommendation = campaignNavigationRecommendation({
    world: { maps: [b2f, b3f, b4f] },
    observation,
    objective,
  });

  assert.equal(recommendation?.target?.kind, "warp");
  assert.equal(recommendation?.target?.index, 0);
  assert.equal(recommendation?.targetMap, b4f.id);
  assert.equal(recommendation?.rocketHideoutPhase, "return-to-b2-spin-maze");
  assert.notEqual(recommendation?.transit?.destinationMap, b4f.id);
});

test("the Rocket Hideout elevator returns from B1 to the B2 spin maze", () => {
  const b1f = openMap("MAP_ROCKET_HIDEOUT_B1F", {
    warpEvents: [
      { x: 0, y: 0, dest_map: "MAP_UNUSED", dest_warp_id: "0" },
      { x: 3, y: 1, dest_map: "MAP_ROCKET_HIDEOUT_B2F", dest_warp_id: "1" },
    ],
    behaviors: { "3,1": "MB_REGULAR_WARP" },
  });
  const b4f = openMap("MAP_ROCKET_HIDEOUT_B4F", {
    objectEvents: [{ x: 3, y: 3, script: "RocketHideout_B4F_Grunt" }],
  });
  const observation = campaignObservation({ map: b1f.id });
  observation.playerMemory.position = { x: 1, y: 1 };

  const recommendation = campaignNavigationRecommendation({
    world: { maps: [b1f, b4f] },
    observation,
    objective: {
      id: "rocket-hideout-door-grunt-left",
      target: { kind: "object", map: b4f.id, index: 0 },
      rocketHideoutElevator: true,
    },
  });

  assert.equal(recommendation?.target?.index, 1);
  assert.equal(recommendation?.rocketHideoutPhase, "return-to-b2-spin-maze");
});

test("the Rocket Hideout exit clears the B1 security guard when its barrier is closed", () => {
  const collisions = Object.fromEntries(
    Array.from({ length: 7 }, (_, x) => [`${x},2`, 3]),
  );
  const b1f = openMap("MAP_ROCKET_HIDEOUT_B1F", {
    width: 7,
    height: 7,
    collisions,
    warpEvents: [{
      x: 3,
      y: 0,
      dest_map: "MAP_CELADON_CITY_GAME_CORNER",
      dest_warp_id: "3",
    }],
    behaviors: { "3,0": "MB_LADDER" },
    objectEvents: [
      { x: 0, y: 6, script: "RocketHideout_B1F_EventScript_Grunt2" },
      { x: 1, y: 6, script: "RocketHideout_B1F_EventScript_Grunt1" },
      { x: 2, y: 6, script: "RocketHideout_B1F_EventScript_Grunt4" },
      { x: 6, y: 6, script: "RocketHideout_B1F_EventScript_Grunt3" },
      { x: 3, y: 5, script: "RocketHideout_B1F_EventScript_Grunt5" },
    ],
  });
  const observation = campaignObservation({ map: b1f.id });
  observation.playerMemory.position = { x: 5, y: 5 };

  const recommendation = campaignNavigationRecommendation({
    world: { maps: [b1f] },
    observation,
    objective: {
      id: "rocket-hideout-exit",
      target: {
        kind: "rocket-hideout-exit",
        map: "MAP_CELADON_CITY_GAME_CORNER",
      },
    },
  });

  assert.equal(recommendation?.target?.index, 4);
  assert.equal(recommendation?.rocketHideoutPhase, "clear-b1-security-barrier");
  assert.equal(recommendation?.direction, "west");
});

test("a map arrival completes the explicit Rocket Hideout exit transaction", () => {
  const planner = createCampaignPlanner({ campaign: { objectives: [{
    id: "rocket-hideout-exit",
    target: {
      kind: "rocket-hideout-exit",
      map: "MAP_CELADON_CITY_GAME_CORNER",
    },
    completion: { kind: "map-is", map: "MAP_CELADON_CITY_GAME_CORNER" },
  }, {
    id: "next-objective",
    target: { kind: "object", map: "MAP_NEXT", index: 0 },
    completion: { kind: "flag-set", id: 99 },
  }] } });

  assert.equal(planner.select(campaignObservation({
    map: "MAP_ROCKET_HIDEOUT_B4F",
  }))?.id, "rocket-hideout-exit");
  assert.equal(planner.select(campaignObservation({
    map: "MAP_CELADON_CITY_GAME_CORNER",
  }))?.id, "next-objective");
  assert.equal(planner.select(campaignObservation({
    map: "MAP_ROCKET_HIDEOUT_B1F",
  }))?.id, "next-objective");
});

test("the monotonic campaign frontier survives a checkpoint resume", () => {
  const campaign = { objectives: [{
    id: "rocket-hideout-exit",
    target: {
      kind: "rocket-hideout-exit",
      map: "MAP_CELADON_CITY_GAME_CORNER",
    },
    completion: {
      kind: "map-not-in",
      maps: ["MAP_ROCKET_HIDEOUT_B1F"],
    },
  }, {
    id: "next-objective",
    target: { kind: "object", map: "MAP_NEXT", index: 0 },
    completion: { kind: "flag-set", id: 99 },
  }] };
  const planner = createCampaignPlanner({ campaign });

  assert.equal(planner.select(campaignObservation({
    map: "MAP_CELADON_CITY_GAME_CORNER",
  }))?.id, "next-objective");
  assert.deepEqual(planner.state(), {
    schema: "master-red/campaign-planner-state/v1",
    completedThroughObjectiveId: "rocket-hideout-exit",
  });

  const resumed = createCampaignPlanner({
    campaign,
    initialState: planner.state(),
  });
  assert.equal(resumed.select(campaignObservation({
    map: "MAP_ROCKET_HIDEOUT_B1F",
  }))?.id, "next-objective");
});

test("a checkpointed transient map puzzle is re-solved when its switch resets", () => {
  const room = openMap("MAP_BOULDER_ROOM", {
    width: 7,
    height: 7,
    objectEvents: [{
      x: 3,
      y: 3,
      graphics_id: "OBJ_EVENT_GFX_PUSHABLE_BOULDER",
      script: "EventScript_StrengthBoulder",
    }],
    coordEvents: [{ x: 5, y: 4, script: "FloorSwitch", var: "VAR_SWITCH" }],
  });
  const campaign = { objectives: [{
    id: "first-floor-switch",
    target: {
      kind: "push-boulder",
      map: room.id,
      objectIndex: 0,
      x: 5,
      y: 4,
    },
    completion: { kind: "variable-at-least", id: 0x4064, value: 100 },
    transientMapPuzzle: true,
  }, {
    id: "second-floor-switch",
    target: {
      kind: "push-boulder",
      map: "MAP_NEXT_BOULDER_ROOM",
      objectIndex: 0,
      x: 2,
      y: 2,
    },
    completion: { kind: "variable-at-least", id: 0x4065, value: 100 },
  }] };
  const world = { maps: [room] };
  const planner = createCampaignPlanner({
    campaign,
    world,
    initialState: {
      schema: "master-red/campaign-planner-state/v1",
      completedThroughObjectiveId: "first-floor-switch",
    },
  });
  const observation = campaignObservation({
    map: room.id,
    variables: { 0x4064: 0, 0x4065: 0 },
    flags: { 2053: true, 2083: true },
    party: [{ slot: 0, species: 131, level: 50, hp: 180, moves: [70] }],
  });
  observation.playerMemory.position = { x: 1, y: 3 };
  observation.playerMemory.objectEvents = [{
    localId: 1,
    current: { x: 3, y: 3 },
    previous: { x: 3, y: 3 },
  }];

  assert.equal(planner.select(observation)?.id, "first-floor-switch");
  assert.equal(
    planner.campaignStatus().activeObjective?.id,
    "first-floor-switch",
  );
  assert.equal(
    planner.state().completedThroughObjectiveId,
    "first-floor-switch",
  );

  room.objectEvents.push({
    x: 1,
    y: 1,
    graphics_id: "OBJ_EVENT_GFX_PUSHABLE_BOULDER",
    script: "EventScript_StrengthBoulder",
  });
  observation.playerMemory.objectEvents.push({
    localId: 2,
    current: { x: 1, y: 1 },
    previous: { x: 1, y: 1 },
  });
  campaign.objectives[1].target.map = room.id;
  campaign.objectives[1].target.objectIndex = 1;
  assert.notEqual(campaignNavigationRecommendation({
    world,
    observation,
    objective: campaign.objectives[1],
  }), null);
  const freshPlanner = createCampaignPlanner({
    campaign,
    world,
    initialState: {
      schema: "master-red/campaign-planner-state/v1",
      completedThroughObjectiveId: "first-floor-switch",
    },
  });
  assert.equal(
    freshPlanner.select(observation)?.id,
    "first-floor-switch",
    "returning to a reset switch floor must outrank a reachable later puzzle",
  );
  assert.equal(
    planner.select(observation)?.id,
    "first-floor-switch",
    "the planner must not abandon a reset puzzle when the forward route becomes visible",
  );

  observation.playerMemory.storyState.variableIds[0x4064] = 100;
  assert.equal(planner.select(observation)?.id, "second-floor-switch");
  assert.equal(
    planner.campaignStatus().activeObjective?.id,
    "second-floor-switch",
  );
});

test("the campaign planner exposes its exact active objective for spectators", () => {
  const planner = createCampaignPlanner({ campaign: { objectives: [{
    id: "completed-step",
    target: { kind: "object", map: "MAP_DONE", index: 1 },
    completion: { kind: "flag-set", id: 10 },
  }, {
    id: "rival-silph",
    target: { kind: "trigger", map: "MAP_SILPH_CO_7F", index: 0 },
    completion: { kind: "flag-set", id: 11 },
    minimumTeamAnchorLevel: 48,
    minimumBattlePartySize: 6,
    starterBattleFamily: [4, 5, 6],
    starterBattleTargetLevel: 45,
    supportBattleTargetLevel: 40,
    minimumReadyBattleMembers: 5,
  }] } });

  assert.equal(planner.select(campaignObservation({
    flags: { 10: true },
  }))?.id, "rival-silph");
  assert.deepEqual(planner.campaignStatus(), {
    completedThroughObjectiveId: "completed-step",
    activeObjective: {
      id: "rival-silph",
      target: { kind: "trigger", map: "MAP_SILPH_CO_7F", index: 0 },
      minimumTeamAnchorLevel: 48,
      minimumBattlePartySize: 6,
      starterBattleFamily: [4, 5, 6],
      starterBattleTargetLevel: 45,
      supportBattleTargetLevel: 40,
      minimumReadyBattleMembers: 5,
    },
  });
});

test("the boulder planner walks around a live boulder and pushes it to its switch", () => {
  const map = openMap("MAP_BOULDER_ROOM", {
    width: 7,
    height: 7,
    objectEvents: [{
      x: 3,
      y: 3,
      graphics_id: "OBJ_EVENT_GFX_PUSHABLE_BOULDER",
      script: "EventScript_StrengthBoulder",
    }],
    coordEvents: [{ x: 5, y: 4, script: "FloorSwitch", var: "VAR_SWITCH" }],
  });
  const objective = {
    id: "press-floor-switch",
    target: {
      kind: "push-boulder",
      map: "MAP_BOULDER_ROOM",
      objectIndex: 0,
      x: 5,
      y: 4,
    },
    completion: { kind: "variable-at-least", id: 0x4064, value: 100 },
  };
  const observation = campaignObservation({
    map: "MAP_BOULDER_ROOM",
    flags: { 2053: true },
  });
  observation.playerMemory.position = { x: 1, y: 3 };
  observation.playerMemory.objectEvents = [{
    localId: 1,
    current: { x: 3, y: 3 },
    previous: { x: 3, y: 3 },
  }];

  assert.equal(campaignNavigationRecommendation({
    world: { maps: [map] }, observation, objective,
  })?.direction, "east");
  observation.playerMemory.position = { x: 2, y: 3 };
  assert.equal(campaignNavigationRecommendation({
    world: { maps: [map] }, observation, objective,
  })?.direction, "north");
  observation.playerMemory.position = { x: 3, y: 2 };
  assert.equal(campaignNavigationRecommendation({
    world: { maps: [map] }, observation, objective,
  })?.kind, "push-field-obstacle");

  observation.playerMemory.position = { x: 4, y: 3 };
  observation.playerMemory.objectEvents[0] = {
    localId: 1,
    current: { x: 5, y: 3 },
    previous: { x: 4, y: 3 },
  };
  assert.equal(campaignNavigationRecommendation({
    world: { maps: [map] }, observation, objective,
  })?.direction, "north");
});

test("an authored boulder route performs its next literal push without improvising", () => {
  const map = openMap("MAP_AUTHORED_BOULDER_ROOM", {
    width: 25,
    height: 22,
    objectEvents: [{
      x: 7,
      y: 18,
      graphics_id: "OBJ_EVENT_GFX_PUSHABLE_BOULDER",
      script: "EventScript_StrengthBoulder",
    }],
  });
  const objective = {
    id: "authored-floor-switch",
    target: {
      kind: "push-boulder",
      map: map.id,
      objectIndex: 0,
      x: 20,
      y: 16,
    },
    authoredBoulderPath: [
      { x: 7, y: 18 },
      { x: 7, y: 19 },
      { x: 8, y: 19 },
      { x: 9, y: 19 },
      { x: 10, y: 19 },
      { x: 11, y: 19 },
      { x: 12, y: 19 },
      { x: 12, y: 18 },
      { x: 12, y: 17 },
      { x: 13, y: 17 },
      { x: 14, y: 17 },
      { x: 15, y: 17 },
      { x: 16, y: 17 },
      { x: 17, y: 17 },
      { x: 18, y: 17 },
      { x: 19, y: 17 },
      { x: 19, y: 16 },
      { x: 19, y: 15 },
      { x: 20, y: 15 },
      { x: 20, y: 16 },
    ],
    completion: { kind: "variable-at-least", id: 0x4064, value: 100 },
  };
  const observation = campaignObservation({
    map: map.id,
    flags: { 2053: true },
  });
  observation.playerMemory.position = { x: 7, y: 17 };
  observation.playerMemory.objectEvents = [{
    localId: 1,
    current: { x: 7, y: 18 },
    previous: { x: 7, y: 18 },
  }];

  const recommendation = campaignNavigationRecommendation({
    world: { maps: [map] }, observation, objective,
  });

  assert.equal(recommendation?.kind, "push-field-obstacle");
  assert.equal(recommendation?.direction, "south");
  assert.equal(recommendation?.obstacle?.index, 0);
});

test("Victory Road 2F clears the wall by pushing left twice before turning south", () => {
  const map = openMap("MAP_VICTORY_ROAD_2F", {
    width: 10,
    height: 22,
    objectEvents: Array.from({ length: 11 }, (_, index) => ({
      x: index === 10 ? 6 : index,
      y: index === 10 ? 17 : 0,
      graphics_id: index === 10
        ? "OBJ_EVENT_GFX_PUSHABLE_BOULDER"
        : "OBJ_EVENT_GFX_ITEM_BALL",
      script: index === 10 ? "EventScript_StrengthBoulder" : "EventScript_Item",
    })),
  });
  const objective = MAIN_STORY_CAMPAIGN.objectives.find(
    ({ id }) => id === "victory-road-second-floor-switch-one",
  );
  const observation = campaignObservation({
    map: map.id,
    flags: { 2053: true },
  });
  observation.playerMemory.position = { x: 7, y: 17 };
  observation.playerMemory.objectEvents = [{
    localId: 11,
    current: { x: 5, y: 17 },
    previous: { x: 6, y: 17 },
  }];

  assert.equal(campaignNavigationRecommendation({
    world: { maps: [map] }, observation, objective,
  })?.direction, "west");
  observation.playerMemory.position = { x: 6, y: 17 };
  assert.equal(campaignNavigationRecommendation({
    world: { maps: [map] }, observation, objective,
  })?.kind, "push-field-obstacle");
});

test("an off-route authored boulder commits to a floor reload until it exits", () => {
  const room = openMap("MAP_STRANDED_BOULDER_ROOM", {
    width: 10,
    height: 22,
    warpEvents: [{
      x: 1,
      y: 1,
      dest_map: "MAP_BOULDER_RESET_LANDING",
      dest_warp_id: 0,
    }],
    behaviors: { "1,1": "MB_LADDER" },
    objectEvents: [{
      x: 6,
      y: 17,
      graphics_id: "OBJ_EVENT_GFX_PUSHABLE_BOULDER",
      script: "EventScript_StrengthBoulder",
    }],
  });
  const landing = openMap("MAP_BOULDER_RESET_LANDING", {
    warpEvents: [{
      x: 1,
      y: 1,
      dest_map: room.id,
      dest_warp_id: 0,
    }],
    behaviors: { "1,1": "MB_LADDER" },
  });
  const objective = {
    id: "reload-stranded-boulder",
    target: {
      kind: "push-boulder",
      map: room.id,
      objectIndex: 0,
      x: 2,
      y: 19,
    },
    completion: { kind: "variable-at-least", id: 0x4065, value: 100 },
    transientMapPuzzle: true,
    authoredBoulderPath: [
      { x: 6, y: 17 },
      { x: 5, y: 17 },
      { x: 4, y: 17 },
      { x: 4, y: 18 },
      { x: 4, y: 19 },
      { x: 3, y: 19 },
      { x: 2, y: 19 },
    ],
    authoredBoulderResetTarget: { kind: "warp", map: room.id, index: 0 },
  };
  const world = { maps: [room, landing] };
  const planner = createCampaignPlanner({
    campaign: { objectives: [objective] },
    world,
  });
  const observation = campaignObservation({
    map: room.id,
    flags: { 2053: true },
  });
  observation.playerMemory.position = { x: 5, y: 17 };
  observation.playerMemory.objectEvents = [{
    localId: 1,
    current: { x: 5, y: 19 },
    previous: { x: 5, y: 19 },
  }];

  const recovery = planner.select(observation);
  assert.equal(recovery?.target?.kind, "warp");
  assert.equal(recovery?.target?.index, 0);
  assert.equal(recovery?.boulderRecoveryFor, objective.id);
  assert.notEqual(campaignNavigationRecommendation({
    world,
    observation,
    objective: recovery,
  }), null);

  observation.playerMemory.objectEvents = [];
  assert.equal(
    planner.select(observation)?.target?.kind,
    "warp",
    "the reset route must survive after the stranded boulder scrolls offscreen",
  );

  observation.playerMemory.map.id = landing.id;
  observation.playerMemory.position = { x: 1, y: 1 };
  assert.equal(planner.select(observation)?.target?.kind, "push-boulder");
});

test("Victory Road 3F pushes the authored switch boulder rather than a nearby decoy", () => {
  const map = openMap("MAP_VICTORY_ROAD_3F", {
    width: 45,
    height: 22,
    objectEvents: Array.from({ length: 10 }, (_, index) => ({
      x: index === 6 ? 19 : index === 9 ? 32 : index,
      y: index === 6 ? 15 : index === 9 ? 5 : 0,
      graphics_id: [6, 9].includes(index)
        ? "OBJ_EVENT_GFX_PUSHABLE_BOULDER"
        : "OBJ_EVENT_GFX_ITEM_BALL",
      script: [6, 9].includes(index)
        ? "EventScript_StrengthBoulder"
        : "EventScript_Item",
    })),
  });
  const objective = MAIN_STORY_CAMPAIGN.objectives.find(
    ({ id }) => id === "victory-road-third-floor-switch",
  );
  const observation = campaignObservation({
    map: map.id,
    flags: { 2053: true },
  });
  observation.playerMemory.position = { x: 32, y: 6 };
  observation.playerMemory.objectEvents = map.objectEvents.map((object, index) => ({
    localId: index + 1,
    current: { x: object.x, y: object.y },
    previous: { x: object.x, y: object.y },
  }));

  const recommendation = campaignNavigationRecommendation({
    world: { maps: [map] }, observation, objective,
  });

  assert.equal(recommendation?.kind, "push-field-obstacle");
  assert.equal(recommendation?.direction, "north");
  assert.equal(recommendation?.obstacle?.index, 9);
});

test("the Mansion planner treats the Secret Key route as a switch state machine", () => {
  const objectEvents = Array.from({ length: 6 }, (_, index) => ({
    x: index === 5 ? 1 : 0,
    y: index === 5 ? 2 : index,
    script: index === 5 ? "PokemonMansion_B1F_EventScript_ItemSecretKey" : null,
  }));
  const map = openMap("MAP_POKEMON_MANSION_B1F", {
    width: 7,
    height: 7,
    objectEvents,
    backgroundEvents: [
      { x: 0, y: 6 },
      { x: 5, y: 2, script: "PokemonMansion_B1F_EventScript_Statue" },
      { x: 1, y: 4, script: "PokemonMansion_B1F_EventScript_Statue" },
    ],
    collisions: Object.fromEntries(
      Array.from({ length: 7 }, (_, y) => [`3,${y}`, 1]),
    ),
  });
  const observation = campaignObservation({
    map: map.id,
    flags: { 424: false, 620: true },
  });
  observation.playerMemory.position = { x: 5, y: 5 };
  const recommendation = campaignNavigationRecommendation({
    world: { maps: [map] },
    observation,
    objective: {
      id: "secret-key",
      target: { kind: "mansion-secret-key", map: map.id, index: 5 },
      completion: { kind: "flag-set", id: 424 },
    },
  });

  assert.equal(recommendation?.target?.kind, "background");
  assert.equal(recommendation?.target?.index, 1);
  assert.equal(recommendation?.mansionPhase, "seek-secret-key");
});

test("the Mansion planner enters through Cinnabar before solving its dynamic interior", () => {
  const cinnabar = openMap("MAP_CINNABAR_ISLAND", {
    width: 3,
    height: 5,
    behaviors: { "1,1": "MB_WARP_DOOR" },
    warpEvents: [{
      x: 1,
      y: 1,
      dest_map: "MAP_POKEMON_MANSION_1F",
      dest_warp_id: 0,
    }],
  });
  const mansion1f = openMap("MAP_POKEMON_MANSION_1F", {
    width: 3,
    height: 5,
    behaviors: { "1,4": "MB_SOUTH_ARROW_WARP" },
    warpEvents: [{
      x: 1,
      y: 4,
      dest_map: cinnabar.id,
      dest_warp_id: 0,
    }],
  });
  const basement = openMap("MAP_POKEMON_MANSION_B1F", {
    width: 3,
    height: 5,
    objectEvents: Array.from({ length: 6 }, (_, index) => ({
      x: 1,
      y: index === 5 ? 1 : 4,
      script: index === 5 ? "PokemonMansion_B1F_EventScript_ItemSecretKey" : null,
    })),
  });
  const observation = campaignObservation({ map: cinnabar.id });
  observation.playerMemory.position = { x: 1, y: 4 };

  const recommendation = campaignNavigationRecommendation({
    world: { maps: [cinnabar, mansion1f, basement] },
    observation,
    objective: {
      id: "secret-key",
      target: { kind: "mansion-secret-key", map: basement.id, index: 5 },
      completion: { kind: "flag-set", id: 424 },
    },
  });

  assert.equal(recommendation?.direction, "north");
  assert.equal(recommendation?.target?.kind, "warp");
  assert.equal(recommendation?.target?.index, 0);
  assert.equal(recommendation?.targetMap, basement.id);
  assert.equal(recommendation?.mansionPhase, "enter");
});

test("the Mansion entry route avoids Cinnabar's locked Gym trigger", () => {
  const cinnabar = openMap("MAP_CINNABAR_ISLAND", {
    width: 24,
    height: 8,
    behaviors: { "8,3": "MB_CAVE_DOOR" },
    warpEvents: [{
      x: 8,
      y: 3,
      dest_map: "MAP_POKEMON_MANSION_1F",
      dest_warp_id: 0,
    }],
    coordEvents: [{
      x: 20,
      y: 5,
      elevation: 3,
      script: "CinnabarIsland_EventScript_GymDoorLocked",
      var: "VAR_TEMP_1",
      var_value: "0",
    }],
  });
  const basement = openMap("MAP_POKEMON_MANSION_B1F", {
    objectEvents: Array.from({ length: 6 }, (_, index) => ({
      x: 1,
      y: index === 5 ? 1 : 4,
    })),
  });
  const observation = campaignObservation({ map: cinnabar.id });
  observation.playerMemory.position = { x: 20, y: 6 };

  const recommendation = campaignNavigationRecommendation({
    world: { maps: [cinnabar, basement] },
    observation,
    objective: {
      id: "secret-key",
      target: { kind: "mansion-secret-key", map: basement.id, index: 5 },
      completion: { kind: "flag-set", id: 424 },
    },
  });

  assert.equal(recommendation?.direction, "west");
  assert.equal(recommendation?.mansionPhase, "enter");
});

test("the Mansion planner keeps controlling egress after the Secret Key is acquired", () => {
  const map = openMap("MAP_POKEMON_MANSION_B1F", {
    width: 7,
    height: 7,
    warpEvents: [{
      x: 5,
      y: 1,
      dest_map: "MAP_POKEMON_MANSION_1F",
      dest_warp_id: 4,
    }],
    backgroundEvents: [
      { x: 0, y: 6 },
      { x: 2, y: 2, script: "PokemonMansion_B1F_EventScript_Statue" },
      { x: 5, y: 4, script: "PokemonMansion_B1F_EventScript_Statue" },
    ],
  });
  const observation = campaignObservation({
    map: map.id,
    flags: { 424: true, 620: true },
  });
  observation.playerMemory.position = { x: 5, y: 3 };
  const recommendation = campaignNavigationRecommendation({
    world: { maps: [map] },
    observation,
    objective: {
      id: "cinnabar-gym-quinn",
      target: { kind: "object", map: "MAP_CINNABAR_ISLAND_GYM", index: 0 },
      completion: { kind: "flag-set", id: 1493 },
    },
  });

  assert.equal(recommendation?.target?.kind, "warp");
  assert.equal(recommendation?.target?.index, 0);
  assert.equal(recommendation?.mansionPhase, "egress");
});

test("the Mansion first floor ignores landing-only warp records during egress", () => {
  const map = openMap("MAP_POKEMON_MANSION_1F", {
    width: 7,
    height: 7,
    warpEvents: [
      {
        x: 2,
        y: 5,
        dest_map: "MAP_CINNABAR_ISLAND",
        dest_warp_id: 0,
      },
      {
        x: 3,
        y: 5,
        dest_map: "MAP_CINNABAR_ISLAND",
        dest_warp_id: 0,
      },
    ],
    behaviors: {
      "2,5": "MB_CAVE",
      "3,5": "MB_SOUTH_ARROW_WARP",
    },
  });
  const observation = campaignObservation({
    map: map.id,
    flags: { 424: true, 620: true },
  });
  observation.playerMemory.position = { x: 3, y: 4 };

  const recommendation = campaignNavigationRecommendation({
    world: { maps: [map] },
    observation,
    objective: {
      id: "recover-party",
      target: { kind: "object", map: "MAP_POKEMON_CENTER_1F", index: 0 },
    },
  });

  assert.equal(recommendation?.target?.kind, "warp");
  assert.equal(recommendation?.target?.index, 1);
  assert.equal(recommendation?.mansionPhase, "egress");
});

test("the completed Mansion quest yields its interior to an explicit training objective", () => {
  const map = openMap("MAP_POKEMON_MANSION_1F", {
    width: 5,
    height: 5,
    warpEvents: [{
      x: 1,
      y: 4,
      dest_map: "MAP_CINNABAR_ISLAND",
      dest_warp_id: 0,
    }],
    encounters: { "3,3": 1, "4,3": 1 },
    behaviors: { "3,3": "MB_NORMAL", "4,3": "MB_NORMAL" },
  });
  const observation = campaignObservation({
    map: map.id,
    flags: { 424: true, 620: true },
  });
  observation.playerMemory.position = { x: 1, y: 3 };

  const recommendation = campaignNavigationRecommendation({
    world: { maps: [map] },
    observation,
    objective: {
      id: "train-team-anchor",
      target: { kind: "encounter-zone", map: map.id },
      currentTeamAnchorLevel: 27,
      minimumTeamAnchorLevel: 45,
      trainingPartySlot: 1,
      trainingSpecies: 131,
      forObjective: "badge-volcano",
      encounter: { rate: 7, minimumWildLevel: 26, maximumWildLevel: 36 },
    },
  });

  assert.equal(recommendation?.objective, "train-team-anchor");
  assert.equal(recommendation?.direction, "east");
  assert.equal(recommendation?.mansionPhase, undefined);
});

// The Mansion switch (flag 620) toggles barriers on every floor: each floor's
// ON_LOAD script applies PokemonMansion_EventScript_PressSwitch_<floor> while
// it is set. This fixture keeps the real barrier coordinates: 2F x=12, y=4..8
// seals the north-west pocket around the 3F stairs; 3F (17..19,11..12) opens
// the way to the holes; 1F (32..34,25..26) opens the east exit to the hole
// landings. The current floor is read from the live grid, as on the cartridge.
function mansionSwitchFixture() {
  const range = (from, to) => Array.from({ length: to - from + 1 }, (_, index) => from + index);
  const walls = (cells, xs, ys) => {
    for (const x of xs) for (const y of ys) cells[`${x},${y}`] = 1;
    return cells;
  };
  const firstFloor = openMap("MAP_POKEMON_MANSION_1F", {
    width: 38,
    height: 35,
    collisions: walls(walls(walls({}, [15], range(0, 34)), [29], range(25, 34)),
      [...range(30, 31), ...range(32, 34), ...range(35, 37)], [25, 26]),
    behaviors: {
      "8,33": "MB_SOUTH_ARROW_WARP",
      "10,13": "MB_UP_RIGHT_STAIR_WARP",
      "19,22": "MB_CAVE",
      "20,22": "MB_CAVE",
      "34,33": "MB_SOUTH_ARROW_WARP",
    },
    warpEvents: [
      { x: 8, y: 33, dest_map: "MAP_CINNABAR_ISLAND", dest_warp_id: "0" },
      { x: 10, y: 13, dest_map: "MAP_POKEMON_MANSION_2F", dest_warp_id: "1" },
      { x: 19, y: 22, dest_map: "MAP_POKEMON_MANSION_3F", dest_warp_id: "1" },
      { x: 20, y: 22, dest_map: "MAP_POKEMON_MANSION_3F", dest_warp_id: "2" },
      { x: 34, y: 33, dest_map: "MAP_CINNABAR_ISLAND", dest_warp_id: "0" },
    ],
  });
  const secondFloor = openMap("MAP_POKEMON_MANSION_2F", {
    width: 38,
    height: 20,
    collisions: walls(
      walls({}, [12], [...range(0, 5), ...range(9, 14), ...range(16, 19)]),
      range(0, 11), [10]),
    behaviors: { "9,3": "MB_UP_RIGHT_STAIR_WARP", "30,14": "MB_DOWN_LEFT_STAIR_WARP" },
    warpEvents: [
      { x: 9, y: 3, dest_map: "MAP_POKEMON_MANSION_3F", dest_warp_id: "0" },
      { x: 30, y: 14, dest_map: "MAP_POKEMON_MANSION_1F", dest_warp_id: "1" },
    ],
    backgroundEvents: [{ x: 2, y: 16, script: "PokemonMansion_2F_EventScript_Statue" }],
  });
  const thirdFloor = openMap("MAP_POKEMON_MANSION_3F", {
    width: 38,
    height: 20,
    collisions: walls({}, range(0, 37), [11, 12]),
    behaviors: {
      "8,3": "MB_DOWN_LEFT_STAIR_WARP",
      "18,18": "MB_FALL_WARP",
      "19,18": "MB_FALL_WARP",
      "20,18": "MB_FALL_WARP",
    },
    warpEvents: [
      { x: 8, y: 3, dest_map: "MAP_POKEMON_MANSION_2F", dest_warp_id: "0" },
      { x: 18, y: 18, dest_map: "MAP_POKEMON_MANSION_1F", dest_warp_id: "2" },
      { x: 19, y: 18, dest_map: "MAP_POKEMON_MANSION_1F", dest_warp_id: "3" },
      { x: 20, y: 18, dest_map: "MAP_POKEMON_MANSION_1F", dest_warp_id: "3" },
    ],
    backgroundEvents: [{ x: 12, y: 5, script: "PokemonMansion_3F_EventScript_Statue" }],
  });
  const island = openMap("MAP_CINNABAR_ISLAND", {
    width: 20,
    height: 15,
    behaviors: { "8,3": "MB_WARP_DOOR", "14,11": "MB_WARP_DOOR" },
    warpEvents: [
      { x: 8, y: 3, dest_map: "MAP_POKEMON_MANSION_1F", dest_warp_id: "0" },
      { x: 14, y: 11, dest_map: "MAP_CINNABAR_ISLAND_POKEMON_CENTER_1F", dest_warp_id: "0" },
    ],
  });
  const center = openMap("MAP_CINNABAR_ISLAND_POKEMON_CENTER_1F", {
    width: 10,
    height: 8,
    behaviors: { "5,7": "MB_SOUTH_ARROW_WARP" },
    warpEvents: [{ x: 5, y: 7, dest_map: "MAP_CINNABAR_ISLAND", dest_warp_id: "1" }],
    objectEvents: [{ x: 5, y: 2, graphics_id: "OBJ_EVENT_GFX_NURSE" }],
  });
  const at = (map, position, { switchSet, live = {} }) => {
    const observation = campaignObservation({
      map: map.id,
      flags: { 424: false, 620: switchSet },
      party: [{ slot: 0, species: 101, level: 45, hp: 38, maxHp: 116, moves: [] }],
    });
    observation.playerMemory.position = position;
    observation.playerMemory.mapGrid = {
      width: map.layout.width,
      height: map.layout.height,
      cells: map.layout.cells.map((cell) => ({
        ...cell,
        collision: live[`${cell.x},${cell.y}`] ?? cell.collision,
      })),
    };
    return observation;
  };
  return {
    world: { maps: [firstFloor, secondFloor, thirdFloor, island, center] },
    floors: { firstFloor, secondFloor, thirdFloor },
    at,
    heal: {
      id: "recover-training-party",
      target: { kind: "object", map: center.id, index: 0 },
    },
    secretKey: {
      id: "secret-key",
      target: { kind: "mansion-secret-key", map: "MAP_POKEMON_MANSION_B1F", index: 5 },
      completion: { kind: "flag-set", id: 424 },
    },
    // Live cells PressSwitch_2F/3F leave on the current floor.
    sealedPocket: { "12,6": 3, "12,7": 3, "12,8": 3 },
    openHoles: { "17,11": 0, "18,11": 0, "19,11": 0, "17,12": 0, "18,12": 0, "19,12": 0 },
  };
}

test("a heal trip from Mansion 3F with the switch set drops through a hole, not into the sealed 2F pocket", () => {
  const fixture = mansionSwitchFixture();
  const recommendation = campaignNavigationRecommendation({
    world: fixture.world,
    observation: fixture.at(fixture.floors.thirdFloor, { x: 12, y: 7 },
      { switchSet: true, live: fixture.openHoles }),
    objective: fixture.heal,
  });

  assert.equal(recommendation?.kind, "move-toward");
  assert.equal(recommendation?.transit?.destinationMap, "MAP_POKEMON_MANSION_1F");
  assert.equal(recommendation?.transit?.y, 18);
  assert.ok([18, 19, 20].includes(recommendation?.transit?.x));
});

test("a heal trip that starts in the sealed 2F pocket climbs back to 3F instead of stalling", () => {
  const fixture = mansionSwitchFixture();
  const recommendation = campaignNavigationRecommendation({
    world: fixture.world,
    observation: fixture.at(fixture.floors.secondFloor, { x: 9, y: 3 },
      { switchSet: true, live: fixture.sealedPocket }),
    objective: fixture.heal,
  });

  assert.ok(recommendation, "a route out of the pocket exists through 3F");
  assert.equal(recommendation.transit?.destinationMap, "MAP_POKEMON_MANSION_3F");
  assert.deepEqual([recommendation.transit?.x, recommendation.transit?.y], [9, 3]);
});

test("the Secret Key search from the sealed 2F pocket climbs back to 3F instead of stalling", () => {
  const fixture = mansionSwitchFixture();
  const recommendation = campaignNavigationRecommendation({
    world: fixture.world,
    observation: fixture.at(fixture.floors.secondFloor, { x: 9, y: 3 },
      { switchSet: true, live: fixture.sealedPocket }),
    objective: fixture.secretKey,
  });

  assert.ok(recommendation, "the switch-set route leaves the pocket through 3F");
  assert.equal(recommendation.mansionPhase, "seek-secret-key");
  assert.equal(recommendation.transit?.destinationMap, "MAP_POKEMON_MANSION_3F");
});

test("with the Mansion switch reset the floors keep their authored layouts", () => {
  const fixture = mansionSwitchFixture();
  // Plan once with the switch set so a cached switch-set graph cannot leak.
  campaignNavigationRecommendation({
    world: fixture.world,
    observation: fixture.at(fixture.floors.thirdFloor, { x: 12, y: 7 },
      { switchSet: true, live: fixture.openHoles }),
    objective: fixture.heal,
  });
  const fromPocket = campaignNavigationRecommendation({
    world: fixture.world,
    observation: fixture.at(fixture.floors.secondFloor, { x: 9, y: 3 }, { switchSet: false }),
    objective: fixture.heal,
  });
  const fromThirdFloor = campaignNavigationRecommendation({
    world: fixture.world,
    observation: fixture.at(fixture.floors.thirdFloor, { x: 12, y: 7 }, { switchSet: false }),
    objective: fixture.heal,
  });

  assert.equal(fromPocket?.transit?.destinationMap, "MAP_POKEMON_MANSION_1F");
  assert.deepEqual([fromPocket?.transit?.x, fromPocket?.transit?.y], [30, 14]);
  assert.equal(fromThirdFloor?.transit?.destinationMap, "MAP_POKEMON_MANSION_2F");
});

test("the Cinnabar Gym planner enters through the island before routing behind quiz doors", () => {
  const cinnabar = openMap("MAP_CINNABAR_ISLAND", {
    width: 3,
    height: 5,
    behaviors: { "1,1": "MB_WARP_DOOR" },
    warpEvents: [
      {
        x: 0,
        y: 0,
        dest_map: "MAP_UNUSED",
        dest_warp_id: 0,
      },
      {
        x: 1,
        y: 1,
        dest_map: "MAP_CINNABAR_ISLAND_GYM",
        dest_warp_id: 0,
      },
    ],
  });
  const gym = openMap("MAP_CINNABAR_ISLAND_GYM", {
    width: 7,
    height: 7,
    objectEvents: [
      { x: 1, y: 5, script: "CinnabarIsland_Gym_EventScript_Quinn" },
      { x: 3, y: 1, script: "CinnabarIsland_Gym_EventScript_Erik" },
    ],
    warpEvents: [{
      x: 3,
      y: 6,
      dest_map: cinnabar.id,
      dest_warp_id: 1,
    }],
    collisions: Object.fromEntries(
      Array.from({ length: 7 }, (_, x) => [`${x},3`, 1]),
    ),
  });
  const observation = campaignObservation({ map: cinnabar.id });
  observation.playerMemory.position = { x: 1, y: 4 };
  const objective = {
    id: "cinnabar-gym-erik",
    target: { kind: "object", map: gym.id, index: 1 },
    completion: { kind: "flag-set", id: 1457 },
  };

  const recommendation = campaignNavigationRecommendation({
    world: { maps: [cinnabar, gym] }, observation, objective,
  });

  assert.equal(recommendation?.direction, "north");
  assert.equal(recommendation?.target?.kind, "warp");
  assert.equal(recommendation?.target?.index, 1);
  assert.equal(recommendation?.targetMap, gym.id);
  assert.equal(recommendation?.cinnabarGymPhase, "enter");
});

test("the forced Sevii detour preempts a restored Earth Badge objective", () => {
  const planner = createCampaignPlanner({
    teamPlan: createOriginsTeamPlan(7),
    world: { maps: [] },
    initialState: {
      schema: "master-red/campaign-planner-state/v1",
      completedThroughObjectiveId: "badge-volcano",
    },
  });
  const observed = campaignObservation({
    map: "MAP_ONE_ISLAND_POKEMON_CENTER_1F",
    variables: {
      16502: 1,
      16505: 0,
      16507: 0,
    },
    flags: {
      673: false,
      674: false,
      675: false,
      2087: false,
      2113: true,
    },
  });

  const objective = planner.select(observed);

  assert.equal(objective?.id, "sevii-sail-two-island");
  assert.deepEqual(objective?.target, {
    kind: "seagallop-destination",
    map: "MAP_TWO_ISLAND",
  });
  assert.equal(planner.campaignStatus().activeObjective?.id, objective.id);
  assert.equal(planner.state().completedThroughObjectiveId, "badge-volcano");
  assert.ok(planner.storyWatch().variables.includes(16502));
  assert.ok(planner.storyWatch().variables.includes(16505));
  assert.ok(planner.storyWatch().variables.includes(16507));
  assert.ok(planner.storyWatch().flags.includes(2113));
});

test("the forced Sevii detour derives every next step from durable cartridge state", () => {
  const cases = [
    {
      name: "ask Lostelle's father",
      map: "MAP_TWO_ISLAND",
      onePcScene: 1,
      twoGameScene: 0,
      threeIslandScene: 0,
      flags: { 673: false, 674: true, 675: false, 2113: true },
      expected: "sevii-find-lostelle",
    },
    {
      name: "sail to Three Island",
      map: "MAP_TWO_ISLAND_JOYFUL_GAME_CORNER",
      onePcScene: 1,
      twoGameScene: 1,
      threeIslandScene: 2,
      flags: { 673: false, 674: true, 675: false, 2113: true },
      expected: "sevii-sail-three-island",
    },
    {
      name: "confront the bikers",
      map: "MAP_THREE_ISLAND_PORT",
      onePcScene: 1,
      twoGameScene: 1,
      threeIslandScene: 2,
      flags: { 673: true, 674: true, 675: false, 2113: false },
      expected: "sevii-confront-bikers",
    },
    {
      name: "battle the biker gang",
      map: "MAP_THREE_ISLAND",
      onePcScene: 1,
      twoGameScene: 1,
      threeIslandScene: 3,
      flags: { 673: true, 674: true, 675: false, 2113: false },
      expected: "sevii-defeat-bikers",
    },
    {
      name: "rescue Lostelle",
      map: "MAP_THREE_ISLAND",
      onePcScene: 1,
      twoGameScene: 1,
      threeIslandScene: 4,
      flags: { 673: true, 674: true, 675: false, 2113: false },
      expected: "sevii-rescue-lostelle",
    },
    {
      name: "deliver the Meteorite",
      map: "MAP_TWO_ISLAND_JOYFUL_GAME_CORNER",
      onePcScene: 1,
      twoGameScene: 3,
      threeIslandScene: 4,
      flags: { 673: true, 674: true, 675: true, 2113: false },
      expected: "sevii-deliver-meteorite",
    },
    {
      name: "sail back to One Island",
      map: "MAP_TWO_ISLAND_JOYFUL_GAME_CORNER",
      onePcScene: 2,
      twoGameScene: 3,
      threeIslandScene: 4,
      flags: { 673: true, 674: true, 675: true, 2113: false },
      expected: "sevii-sail-one-island",
    },
    {
      name: "return to Kanto with Bill",
      map: "MAP_ONE_ISLAND",
      onePcScene: 2,
      twoGameScene: 3,
      threeIslandScene: 4,
      flags: { 673: true, 674: true, 675: true, 2113: false },
      expected: "sevii-return-to-kanto",
    },
    {
      name: "resume the Earth Badge campaign",
      map: "MAP_CINNABAR_ISLAND",
      onePcScene: 3,
      twoGameScene: 3,
      threeIslandScene: 4,
      flags: { 673: true, 674: true, 675: true, 2087: false, 2113: false },
      expected: "badge-earth",
    },
  ];

  for (const scenario of cases) {
    const planner = createCampaignPlanner({
      teamPlan: createOriginsTeamPlan(7),
      world: { maps: [] },
      initialState: {
        schema: "master-red/campaign-planner-state/v1",
        completedThroughObjectiveId: "badge-volcano",
      },
    });
    const observed = campaignObservation({
      map: scenario.map,
      variables: {
        16502: scenario.onePcScene,
        16505: scenario.twoGameScene,
        16507: scenario.threeIslandScene,
      },
      flags: scenario.flags,
    });

    assert.equal(planner.select(observed)?.id, scenario.expected, scenario.name);
  }
});

test("a global cartridge storage lock suppresses battle-roster PC preparation", () => {
  const center = openMap("MAP_ONE_ISLAND_POKEMON_CENTER_1F", {
    width: 12,
    height: 5,
    behaviors: { "9,1": "MB_PC" },
    collisions: { "9,1": 1 },
  });
  const observed = campaignObservation({
    map: center.id,
    flags: { 2113: true },
    party: [
      { slot: 0, species: 123, level: 51, hp: 134, moves: [17] },
      { slot: 1, species: 6, level: 60, hp: 177, moves: [53] },
      { slot: 2, species: 131, level: 51, hp: 196, moves: [57] },
      { slot: 3, species: 135, level: 48, hp: 120, moves: [24] },
      { slot: 4, species: 46, level: 10, hp: 29, moves: [15, 148] },
    ],
  });
  observed.playerMemory.position = { x: 9, y: 2 };
  observed.playerMemory.trainer.storage = {
    pokemon: [{ box: 0, slot: 0, species: 20, level: 45, moves: [98] }],
  };
  const objective = MAIN_STORY_CAMPAIGN.objectives.find(
    ({ id }) => id === "badge-earth",
  );

  assert.equal(selectBattleRosterObjective({
    world: { maps: [center] },
    observation: observed,
    objective,
    teamPlan: createOriginsTeamPlan(7),
  }), null);
});

test("a Seagallop destination routes to the local harbor sailor", () => {
  const harbor = openMap("MAP_ONE_ISLAND_HARBOR", {
    width: 17,
    height: 13,
    objectEvents: [
      { x: 8, y: 9, script: "0x0" },
      { x: 8, y: 6, script: "OneIsland_Harbor_EventScript_Sailor" },
    ],
  });
  const observed = campaignObservation({ map: harbor.id });
  observed.playerMemory.position = { x: 8, y: 7 };

  const recommendation = campaignNavigationRecommendation({
    world: { maps: [harbor] },
    observation: observed,
    objective: {
      id: "sevii-sail-two-island",
      target: { kind: "seagallop-destination", map: "MAP_TWO_ISLAND" },
    },
  });

  assert.equal(recommendation?.kind, "interact-with-object");
  assert.equal(recommendation?.direction, "north");
  assert.equal(recommendation?.target?.index, 1);
  assert.equal(
    recommendation?.target?.script,
    "OneIsland_Harbor_EventScript_Sailor",
  );
});

test("a Seagallop arrival leaves the destination harbor before completing travel", () => {
  const harbor = openMap("MAP_TWO_ISLAND_HARBOR", {
    width: 17,
    height: 13,
    behaviors: { "8,2": "MB_REGULAR_WARP" },
    warpEvents: [{
      x: 8,
      y: 2,
      dest_map: "MAP_TWO_ISLAND",
      dest_warp_id: 3,
    }],
  });
  const island = openMap("MAP_TWO_ISLAND", {
    width: 17,
    height: 13,
    warpEvents: [
      { x: 1, y: 1, dest_map: "MAP_UNUSED_1", dest_warp_id: 0 },
      { x: 2, y: 1, dest_map: "MAP_UNUSED_2", dest_warp_id: 0 },
      { x: 3, y: 1, dest_map: "MAP_UNUSED_3", dest_warp_id: 0 },
      { x: 10, y: 8, dest_map: harbor.id, dest_warp_id: 0 },
    ],
  });
  const observed = campaignObservation({ map: harbor.id });
  observed.playerMemory.position = { x: 8, y: 5 };

  const recommendation = campaignNavigationRecommendation({
    world: { maps: [harbor, island] },
    observation: observed,
    objective: {
      id: "sevii-sail-two-island",
      target: { kind: "seagallop-destination", map: island.id },
    },
  });

  assert.equal(recommendation?.kind, "move-toward");
  assert.equal(recommendation?.direction, "north");
  assert.equal(recommendation?.targetMap, island.id);
});

test('an authored walk waypoint navigates to its exact tile without starting a field move',()=>{
 const map={id:'MAP_ICE_TEST',layout:{width:4,height:1,cells:Array.from({length:4},(_,x)=>({x,y:0,collision:0,elevation:3,behaviorName:'MB_NORMAL'}))},objectEvents:[],warpEvents:[],coordEvents:[],connections:[]};
 const observation=campaignObservation({map:map.id});observation.playerMemory.position={x:0,y:0};
 const objective={id:'ice-approach',target:{kind:'walk-to',map:map.id,x:3,y:0}};
 const next=rawCampaignNavigationRecommendation({world:{maps:[map]},observation,objective});assert.equal(next?.direction,'east');assert.equal(next.remainingSteps,3);
 observation.playerMemory.position.x=3;assert.equal(rawCampaignNavigationRecommendation({world:{maps:[map]},observation,objective}),null);
});

test('income preparation chooses paid reachable trainers rather than wild experience',()=>{
 const map=openMap('MAP_ROUTE11',{objectEvents:[{x:3,y:2,trainer_type:'TRAINER_TYPE_NORMAL',script:'paid'}]});
 const story={symbols:{trainers:{TRAINER_PAID:{value:41}}},scripts:[{label:'paid',instructions:[{op:'trainerbattle_single',args:['TRAINER_PAID','intro','defeat']}]}]};
 const mechanics={trainers:[{id:41,name:'TRAINER_PAID',trainerName:'PAID',trainerClass:'TRAINER_CLASS_GENTLEMAN',party:[{lvl:20,species:'SPECIES_DROWZEE'}]}],species:[{id:96,name:'SPECIES_DROWZEE',expYield:102}],moves:[]};
 const planner=createCampaignPlanner({campaign:{objectives:[]},world:{maps:[map]},story,mechanics});
 const o=campaignObservation({map:map.id,flags:{2092:true,1321:false},bag:{keyItems:[{itemId:362,quantity:1}]},party:[{slot:0,species:18,level:67,hp:200,maxHp:200,moves:[19],pp:[15]}]});
 o.playerMemory.trainer.partyValidity='valid';o.playerMemory.position={x:1,y:1};o.playerMemory.ui={};
 assert.equal(typeof planner.selectIncomePreparation,'function');
 const selected=planner.selectIncomePreparation(o);assert.equal(selected.target.kind,'object');assert.equal(selected.target.map,map.id);assert.equal(selected.trainer.id,41);assert.ok(selected.expectedPayout>0);
 o.playerMemory.storyState.flagIds[1321]=true;assert.equal(planner.selectIncomePreparation(o),null,'a defeated trainer without rematches cannot fund supplies');
});
test('income preparation recharges, activates and follows the actual Vs Seeker responder',()=>{
 const map=openMap('MAP_ROUTE11',{objectEvents:[{x:3,y:2,trainer_type:'TRAINER_TYPE_NORMAL',script:'paid'}]});
 const story={symbols:{trainers:{TRAINER_PAID:{value:41}}},scripts:[{label:'paid',instructions:[{op:'trainerbattle_single',args:['TRAINER_PAID','intro','defeat']}]}]};
 const trainer={id:41,name:'TRAINER_PAID',trainerName:'PAID',trainerClass:'TRAINER_CLASS_GENTLEMAN',party:[{lvl:20,species:'SPECIES_DROWZEE'}]};
 const planner=createCampaignPlanner({campaign:{objectives:[]},world:{maps:[map]},story,mechanics:{trainers:[trainer,{...trainer,id:42,name:'TRAINER_PAID_REMATCH'}],rematches:[{map:map.id,trainerIds:[41,42]}],species:[{id:96,name:'SPECIES_DROWZEE',expYield:102}],moves:[]}});
 const o=campaignObservation({map:map.id,flags:{2092:true,1321:true,1322:true},bag:{keyItems:[{itemId:362,quantity:1}]},party:[{slot:0,species:18,level:67,hp:200,maxHp:200,moves:[19],pp:[15]}]});
 o.playerMemory.trainer.partyValidity='valid';o.playerMemory.position={x:1,y:1};o.playerMemory.ui={};o.playerMemory.vsSeeker={batterySteps:0,rematchEntries:Array(100).fill(0)};
 assert.equal(planner.selectIncomePreparation(o).target.kind,'vs-seeker-recharge');
 o.playerMemory.vsSeeker.batterySteps=100;assert.equal(planner.selectIncomePreparation(o).target.kind,'vs-seeker-activation');
 o.playerMemory.vsSeeker.rematchEntries[1]=1;const battle=planner.selectIncomePreparation(o);assert.equal(battle.target.kind,'object');assert.equal(battle.vsSeekerAction,'battle');assert.equal(battle.trainer.id,42);
});

test('League supplies earn the missing reserve and keep the funding task across travel, battles and restart',()=>{
 for(const objectiveId of ['league-supplies','elite-four-lorelei']) {
  const center='MAP_INDIGO_PLATEAU_POKEMON_CENTER_1F';
  const route=openMap('MAP_ROUTE11',{connections:[{direction:'up',map:center,offset:0}],
    objectEvents:[{x:3,y:2,trainer_type:'TRAINER_TYPE_NORMAL',script:'paid'}]});
  const world={maps:[openMap(center,{connections:[{direction:'down',map:route.id,offset:0}],objectEvents:[{x:3,y:2,script:'PokemonCenter_1F_EventScript_Nurse'}]}),route]};
  const story={symbols:{trainers:{TRAINER_PAID:{value:41}}},scripts:[{label:'paid',instructions:[{op:'trainerbattle_single',args:['TRAINER_PAID','intro','defeat']}]}]};
  const trainer={id:41,name:'TRAINER_PAID',trainerClass:'TRAINER_CLASS_GENTLEMAN',party:[{lvl:20,species:'SPECIES_DROWZEE'}]};
  const mechanics={trainers:[trainer,{...trainer,id:42,name:'TRAINER_PAID_REMATCH'}],rematches:[{map:route.id,trainerIds:[41,42]}],species:[{id:96,name:'SPECIES_DROWZEE',expYield:102}],moves:[{id:57,pp:15,power:95}]};
  const campaign={objectives:[{...MAIN_STORY_CAMPAIGN.objectives.find(o=>o.id===objectiveId),minimumTeamAnchorLevel:65,minimumBattleMemberLevel:65,minimumBattlePartySize:1,minimumReadyBattleMembers:1}]};
  const options={world,story,mechanics,campaign};
  let p=createCampaignPlanner(options);
  const o=campaignObservation({map:center,flags:{1208:false,1321:true,1322:true},bag:{items:[],keyItems:[{itemId:362,quantity:1}]},party:[{slot:0,species:9,level:65,hp:190,maxHp:190,moves:[57],pp:[15]}]});
  o.playerMemory.trainer.partyValidity='valid';o.playerMemory.trainer.money=100000;
  o.playerMemory.position={x:1,y:1};o.playerMemory.ui={};o.playerMemory.vsSeeker={batterySteps:0,rematchEntries:Array(100).fill(0)};
  const first=p.select(o);
  assert.equal(first.id,'fund-league-supplies');
  assert.equal(first.targetMoney,200800);
  assert.equal(first.target.map,route.id);
  p=createCampaignPlanner({...options,initialState:JSON.parse(JSON.stringify(p.state()))});
  o.playerMemory.map.id=route.id;
  assert.equal(p.select(o).target.kind,'vs-seeker-recharge');
  o.playerMemory.vsSeeker.batterySteps=100;
  assert.equal(p.select(o).target.kind,'vs-seeker-activation');
  o.playerMemory.vsSeeker.rematchEntries[1]=1;
  const battling=p.select(o);assert.equal(battling.trainer.id,42);
  o.emulator={mode:'battle',inBattle:true};
  assert.deepEqual(p.select(o),battling,'the battle retains the exact funding objective');
  o.emulator={mode:'overworld'};
  o.playerMemory.trainer.party[0].pp=[0];
  const heal=p.select(o);assert.equal(heal.id,'recover-party');assert.equal(heal.target.map,center);
  o.playerMemory.map.id=center;o.playerMemory.trainer.party[0].pp=[15];
  o.playerMemory.trainer.money=210000;
  const shopping=p.select(o);assert.equal(shopping.target.kind,'purchase-items');assert.equal(shopping.target.map,center);
  o.playerMemory.trainer.bag.items=[{itemId:24,quantity:24},{itemId:20,quantity:40},{itemId:23,quantity:8},{itemId:19,quantity:20}];
  o.playerMemory.trainer.money=9200;o.playerMemory.map.id=center;
  p.select(o);
  assert.equal(p.state().leagueFunding,undefined,'completion clears the funding commitment');
 }
});

function switchSequenceFixture(firstId, secondId) {
  const first = MAIN_STORY_CAMPAIGN.objectives.find(o => o.id === firstId);
  const second = MAIN_STORY_CAMPAIGN.objectives.find(o => o.id === secondId);
  const map = openMap(first.target.map, {width: 12, height: 20,
    backgroundEvents: Array.from({length: 17}, (_, i) => ({x: 1 + (i % 5) * 2, y: 2 + Math.floor(i / 5) * 3, script: `Switch${i}`})),
    objectEvents: [{x: 1, y: 16}, {x: 3, y: 16}],
  });
  const after = {id: 'after-switches', target: {kind: 'object', map: map.id, index: 0}, completion: {kind: 'flag-set', id: 0x700}};
  return {world: {maps: [map]}, campaign: {objectives: [first, second, after]}, map};
}

test('Surge temporary first lock is revalidated after reset, healing travel, and checkpoint restoration', () => {
  const f = switchSequenceFixture('surge-first-lock', 'surge-second-lock');
  const o = campaignObservation({map: f.map.id, variables: {0x4000: 3, 0x4001: 4}, flags: {1: true, 612: false, 2082: false}});
  o.playerMemory.position = {x: 7, y: 11};
  const planner = createCampaignPlanner(f);
  assert.equal(planner.select(o).id, 'surge-second-lock');
  o.playerMemory.map.id = 'MAP_VERMILION_CITY_POKEMON_CENTER_1F';
  o.playerMemory.storyState.flagIds[1] = false;
  assert.equal(planner.select(o).id, 'surge-second-lock', 'map-local flags in a different room are not puzzle evidence');
  o.playerMemory.map.id = f.map.id;
  assert.equal(planner.select(o).id, 'surge-first-lock');
  assert.equal(planner.state().completedThroughObjectiveId, 'surge-first-lock', 'repair preserves durable campaign progress');
  const restored = createCampaignPlanner({...f, initialState: planner.state()});
  assert.equal(restored.select(o).id, 'surge-first-lock');
  o.playerMemory.storyState.variableIds[0x4000] = 9;
  assert.equal(campaignNavigationRecommendation({...f, observation:o, objective:restored.select(o)}).target.index, 10, 'fresh cartridge variables choose the reset switch');
  o.playerMemory.storyState.flagIds[1] = true;
  assert.equal(restored.select(o).id, 'surge-second-lock');
  o.playerMemory.storyState.flagIds[612] = true;
  o.playerMemory.storyState.flagIds[1] = false;
  assert.equal(restored.select(o).id, 'after-switches', 'permanent puzzle completion prevents replay');
});

test('Bill temporary teleporter prerequisite recovers without a per-puzzle annotation', () => {
  const f = switchSequenceFixture('bill-enter-teleporter', 'bill-cell-separator');
  const o = campaignObservation({map:f.map.id, flags:{2:true,563:false,564:false}});
  o.playerMemory.position = {x:3,y:17};
  const planner = createCampaignPlanner(f);
  assert.equal(planner.select(o).id,'bill-cell-separator');
  o.playerMemory.storyState.flagIds[2]=false;
  assert.equal(planner.select(o).id,'bill-enter-teleporter');
  o.playerMemory.storyState.flagIds[563]=true;
  assert.equal(planner.select(o).id,'after-switches');
});

test('a reset puzzle on another floor cannot hide the current floor prerequisite', () => {
  const a=openMap('MAP_PUZZLE_A',{backgroundEvents:[{x:2,y:2}]});
  const b=openMap('MAP_PUZZLE_B',{backgroundEvents:[{x:2,y:2}],objectEvents:[{x:1,y:1}]});
  const objectives=[a,b].map((map,index)=>({id:`switch-${index}`,target:{kind:'background',map:map.id,index:0},completion:{kind:'variable-at-least',id:0x4064+index,value:100},transientMapPuzzle:true}));
  objectives.push({id:'continue',target:{kind:'object',map:b.id,index:0},completion:{kind:'flag-set',id:0x700}});
  const planner=createCampaignPlanner({campaign:{objectives},world:{maps:[a,b]},initialState:{schema:'master-red/campaign-planner-state/v1',completedThroughObjectiveId:'switch-1'}});
  const o=campaignObservation({map:b.id,variables:{0x4064:0,0x4065:0}});o.playerMemory.position={x:2,y:3};
  assert.equal(planner.select(o).id,'switch-1');
  o.playerMemory.storyState.variableIds[0x4065]=100;
  assert.equal(planner.select(o).id,'continue');
});

test('temporary-variable prerequisites recover with nested completion conditions', () => {
  const map=openMap('MAP_TEMP_SEQUENCE',{backgroundEvents:[{x:2,y:2}],objectEvents:[{x:1,y:1}]});
  const first={id:'temporary-state',target:{kind:'background',map:map.id,index:0},completion:{kind:'any',completions:[{kind:'all',completions:[{kind:'variable-at-least',id:0x400f,value:2},{kind:'flag-set',id:0x600}]},{kind:'flag-set',id:0x601}]}};
  const campaign={objectives:[first,{id:'finish',target:{kind:'object',map:map.id,index:0},completion:{kind:'flag-set',id:0x700}}]};
  const o=campaignObservation({map:map.id,variables:{0x400f:0},flags:{0x600:true,0x601:false}});o.playerMemory.position={x:2,y:3};
  const planner=createCampaignPlanner({campaign,world:{maps:[map]},initialState:{schema:'master-red/campaign-planner-state/v1',completedThroughObjectiveId:first.id}});
  assert.equal(planner.select(o).id,first.id);
  o.playerMemory.storyState.flagIds[0x601]=true;
  assert.equal(planner.select(o).id,'finish');
});

test('temporary puzzle recovery requires observed state outside transitions and quest recap', () => {
  const f=switchSequenceFixture('surge-first-lock','surge-second-lock');
  const o=campaignObservation({map:f.map.id,variables:{0x4000:3,0x4001:4},flags:{1:true,612:false,2082:false}});
  o.playerMemory.position={x:7,y:11};
  const planner=createCampaignPlanner(f);assert.equal(planner.select(o).id,'surge-second-lock');
  o.playerMemory.storyState.flagIds[1]=false;o.phase='transition';
  assert.equal(planner.select(o).id,'surge-second-lock');
  o.phase='stable';o.playerMemory.questLog={playback:true};
  assert.equal(planner.select(o).id,'surge-second-lock');
  o.playerMemory.questLog={playback:false};delete o.playerMemory.storyState.flagIds[1];
  assert.equal(planner.select(o).id,'surge-second-lock','unknown flag data does not prove a reset');
  o.playerMemory.storyState.flagIds[1]=false;
  assert.equal(planner.select(o).id,'surge-first-lock');
});

test('optional regional training waits until a temporary switch sequence finishes', () => {
  const {world,story,mechanics}=postThunderMasteryFixture();
  const map=world.data.maps[0];
  map.backgroundEvents=[{x:2,y:2},{x:4,y:2}];
  const objectives=[
    {id:'first-switch',target:{kind:'background',map:map.id,index:0},
      completion:{kind:'any',completions:[{kind:'flag-set',id:1},{kind:'flag-set',id:612}]}},
    {id:'second-switch',target:{kind:'variable-background',map:map.id,variableId:0x4001,indexOffset:0},
      completion:{kind:'flag-set',id:612}},
    {id:'continue-story',target:{kind:'map-arrival',map:'MAP_CELADON_CITY',x:1,y:1},
      completion:{kind:'flag-set',id:9999}},
  ];
  const planner=createCampaignPlanner({campaign:{objectives},world,story,mechanics});
  const o=postThunderObservation();
  Object.assign(o.playerMemory.storyState.flagIds,{1:false,612:false});
  o.playerMemory.storyState.variableIds[0x4001]=1;
  assert.equal(planner.select(o).id,'first-switch');
  o.playerMemory.storyState.flagIds[1]=true;
  assert.equal(planner.select(o).id,'second-switch');
  o.playerMemory.storyState.flagIds[612]=true;
  assert.equal(planner.select(o).id,'mastery-trainer:MAP_ROUTE11:0','optional training resumes after the permanent switch state is observed');
});

test('a direct warp objective steps off and reenters an inactive automatic tile',()=>{
  const map=openMap('MAP_EXIT_REENTRY',{width:3,height:3,behaviors:{'1,1':'MB_LADDER'},
    warpEvents:[{x:1,y:1,dest_map:'MAP_OUTSIDE',dest_warp_id:'0'}]});
  const world={maps:[map]},observation=campaignObservation({map:map.id});
  observation.playerMemory.position={x:1,y:1};
  const objective={id:'leave-building',target:{kind:'warp',map:map.id,index:0}};
  const first=campaignNavigationRecommendation({world,observation,objective});
  assert.equal(first.kind,'reenter-map-warp');
  assert.equal(first.direction,'south');
  observation.playerMemory.position={x:1,y:2};
  const next=campaignNavigationRecommendation({world,observation,objective});
  assert.equal(next.kind,'move-toward');
  assert.equal(next.direction,'north');
});

test('a landing-only warp target uses an adjacent activating exit with the same destination',()=>{
  const map=openMap('MAP_WIDE_EXIT',{width:4,height:3,behaviors:{'2,1':'MB_SOUTH_ARROW_WARP','0,1':'MB_LADDER'},
    warpEvents:[{x:1,y:1,dest_map:'MAP_OUTSIDE',dest_warp_id:'4'},
      {x:0,y:1,dest_map:'MAP_WRONG_EXIT',dest_warp_id:'4'},
      {x:2,y:1,dest_map:'MAP_OUTSIDE',dest_warp_id:'4'}]});
  const world={maps:[map]},observation=campaignObservation({map:map.id});
  observation.playerMemory.position={x:1,y:1};
  const objective={id:'leave-wide-building',target:{kind:'warp',map:map.id,index:0}};
  const first=campaignNavigationRecommendation({world,observation,objective});
  assert.equal(first.kind,'move-toward');
  assert.equal(first.direction,'east');
  assert.equal(first.target.index,2);
  observation.playerMemory.position={x:2,y:1};
  const next=campaignNavigationRecommendation({world,observation,objective});
  assert.equal(next.kind,'traverse-directional-warp');
  assert.equal(next.direction,'south');
});

test('story-trigger navigation avoids active cutscenes on through-routes and retains explicit story targets', () => {
  const map=openMap('MAP_STORY_ROUTE',{coordEvents:[{x:2,y:2,var:'VAR_TEMP_1',var_value:'0',script:'StoryGate_EventScript_ReturnPlayer'},{x:2,y:0,script:'Story_EventScript_Goal'}]});
  const observation=campaignObservation({map:map.id});
  observation.playerMemory.position={x:2,y:3};
  observation.playerMemory.storyState.variables.VAR_TEMP_1=0;
  const world={maps:[map]},objective={id:'continue-story',target:{kind:'trigger',map:map.id,index:1}};
  const active=rawCampaignNavigationRecommendation({world,observation,objective});
  assert.notEqual(active.direction,'north','do not repeatedly enter the active push-back tile');
  const explicit=rawCampaignNavigationRecommendation({world,observation,objective:{id:'story-scene',target:{kind:'trigger',map:map.id,index:0}}});
  assert.equal(explicit.direction,'north','an explicitly selected story trigger remains reachable');
  observation.playerMemory.storyState.variables.VAR_TEMP_1=1;
  const inactive=rawCampaignNavigationRecommendation({world,observation,objective});
  assert.equal(inactive.direction,'north','the scene condition was cleared by the game');
  assert.notEqual(active.routePlan.mapRevision,inactive.routePlan.mapRevision,'cached paths must observe scene changes');
});

test('unavoidable story-trigger navigation stops a held route at the scene boundary', () => {
  const map=openMap('MAP_STORY_CORRIDOR',{width:1,height:6,coordEvents:[{x:0,y:2,var:'VAR_TEMP_1',var_value:'0',script:'Corridor_EventScript_Scene'},{x:0,y:0,script:'Story_EventScript_Goal'}]});
  const observation=campaignObservation({map:map.id});
  observation.playerMemory.position={x:0,y:5};
  observation.playerMemory.storyState.variables.VAR_TEMP_1=0;
  const r=rawCampaignNavigationRecommendation({world:{maps:[map]},observation,objective:{id:'continue-story',target:{kind:'trigger',map:map.id,index:1}}});
  assert.equal(r.direction,'north');
  assert.ok(r.routePlan.destination.y>2,'observe before crossing a cutscene in a long route');
  assert.ok(r.pathSegment.endpoint.y>=2,'do not hold direction through a scripted scene');
  assert.equal(r.pathSegment.continuationDirection,undefined);
});


function victoryRoadInterruptedPuzzleMap() {
  const map = openMap("MAP_VICTORY_ROAD_3F", {
    width: 45,
    height: 22,
    collisions: Object.fromEntries(
      Array.from({ length: 22 }, (_, y) => [`35,${y}`, y === 13 ? 0 : 1]),
    ),
    behaviors: {
      "34,9": "MB_LADDER",
      "37,10": "MB_LADDER",
      "39,17": "MB_LADDER",
      "34,18": "MB_FALL_WARP",
    },
    warpEvents: [
      { x: 5, y: 2, dest_map: "MAP_VICTORY_ROAD_2F", dest_warp_id: "1" },
      { x: 34, y: 9, dest_map: "MAP_VICTORY_ROAD_2F", dest_warp_id: "2" },
      { x: 37, y: 10, dest_map: "MAP_VICTORY_ROAD_2F", dest_warp_id: "3" },
      { x: 39, y: 17, dest_map: "MAP_VICTORY_ROAD_2F", dest_warp_id: "4" },
      { x: 34, y: 18, dest_map: "MAP_VICTORY_ROAD_2F", dest_warp_id: "8" },
    ],
    objectEvents: Array.from({ length: 10 }, (_, index) => index === 1
      ? { x: 21, y: 5, script: "VictoryRoad_3F_EventScript_Alexa" }
      : index === 7
        ? {x:33,y:18,graphics_id:"OBJ_EVENT_GFX_PUSHABLE_BOULDER",script:"EventScript_StrengthBoulder"}
      : index === 8
        ? {
            x: 35,
            y: 13,
            graphics_id: "OBJ_EVENT_GFX_PUSHABLE_BOULDER",
            script: "EventScript_StrengthBoulder",
          }
        : { x: index, y: 0, script: `VictoryRoad_Filler_${index}` }),
  });
  return map;
}

test('Victory Road resumes a boulder puzzle across its blocked return passage', () => {
  const map= victoryRoadInterruptedPuzzleMap(),world={maps:[map]};
  const objective=MAIN_STORY_CAMPAIGN.objectives.find(o=>o.id==='victory-road-drop-boulder');
  const after={id:'continue-after-drop',target:{kind:'map-arrival',map:map.id},completion:{kind:'flag-set',id:9999}};
  const campaign={objectives:[objective,after]};
  let planner=createCampaignPlanner({world,campaign});
  const observation=campaignObservation({map:map.id,flags:{88:true,2053:true,2083:true},
    party:[{slot:0,species:6,level:55,hp:180,maxHp:180,moves:[70],pp:[15]}]});
  observation.playerMemory.position={x:36,y:13};
  observation.playerMemory.objectEvents=[
    {localId:8,current:{x:33,y:18},previous:{x:33,y:18}},
    {localId:9,current:{x:35,y:13},previous:{x:35,y:13}},
  ];
  for(const x of [35,34]) {
    observation.playerMemory.position={x:x+1,y:13};
    observation.playerMemory.objectEvents[1].current={x,y:13};
    planner=createCampaignPlanner({world,campaign,initialState:JSON.parse(JSON.stringify(planner.state()))});
    const selected=planner.select(observation);
    const action=campaignNavigationRecommendation({world,observation,objective:selected});
    assert.equal(selected.id,'victory-road-drop-boulder','reopening the approach retains the puzzle goal');
    assert.equal(action?.kind,'push-field-obstacle');
    assert.equal(action?.direction,'west');
    assert.equal(action?.obstacle?.index,8,'move the blocking passage boulder first');
  }
  observation.playerMemory.objectEvents[1].current={x:33,y:13};
  observation.playerMemory.position={x:32,y:18};
  const push=campaignNavigationRecommendation({world,observation,objective:planner.select(observation)});
  assert.equal(push?.kind,'push-field-obstacle');
  assert.equal(push?.direction,'east');
  assert.equal(push?.obstacle?.index,7,'resume the authored puzzle once its approach is clear');
  observation.playerMemory.storyState.flagIds[88]=false;
  assert.equal(planner.select(observation).id,'continue-after-drop');
  planner=createCampaignPlanner({world,campaign,initialState:JSON.parse(JSON.stringify(planner.state()))});
  assert.equal(planner.select(observation).id,'continue-after-drop','native completion survives another restart');
});

test('an accessible Victory Road puzzle keeps its direct boulder action', () => {
  const map=victoryRoadInterruptedPuzzleMap(),world={maps:[map]};
  const objective=MAIN_STORY_CAMPAIGN.objectives.find(o=>o.id==='victory-road-drop-boulder');
  const observation=campaignObservation({map:map.id,flags:{88:true,2053:true,2083:true},
    party:[{slot:0,species:6,level:55,hp:180,moves:[70]}]});
  observation.playerMemory.position={x:32,y:18};
  observation.playerMemory.objectEvents=[{localId:8,current:{x:33,y:18},previous:{x:33,y:18}}];
  const action=campaignNavigationRecommendation({world,observation,objective});
  assert.equal(action?.kind,'push-field-obstacle');
  assert.equal(action?.direction,'east');
  assert.equal(action?.obstacle?.index,7);
  assert.equal(action?.victoryRoadPhase,undefined,'an executable puzzle does not detour through transit');
});

test('a reset boulder in another passage does not seize the current campaign objective', () => {
  const map=victoryRoadInterruptedPuzzleMap(),world={maps:[map]};
  const puzzle=MAIN_STORY_CAMPAIGN.objectives.find(o=>o.id==='victory-road-drop-boulder');
  const next={id:'continue-from-north-side',target:{kind:'map-arrival',map:map.id},completion:{kind:'flag-set',id:9999}};
  const campaign={objectives:[puzzle,next]};
  const initialState={schema:'master-red/campaign-planner-state/v1',completedThroughObjectiveId:puzzle.id};
  const observation=campaignObservation({map:map.id,flags:{88:true,2053:true,2083:true},
    party:[{slot:0,species:6,level:55,hp:180,maxHp:180,moves:[70],pp:[15]}]});
  observation.playerMemory.position={x:36,y:13};
  observation.playerMemory.objectEvents=[
    {localId:8,current:{x:33,y:18},previous:{x:33,y:18}},
    {localId:9,current:{x:35,y:13},previous:{x:35,y:13}},
  ];
  let planner=createCampaignPlanner({world,campaign,initialState});
  assert.equal(planner.select(observation).id,next.id,'transit availability alone does not make a reset puzzle a local prerequisite');
  planner=createCampaignPlanner({world,campaign,initialState:JSON.parse(JSON.stringify(planner.state()))});
  assert.equal(planner.select(observation).id,next.id);
  observation.playerMemory.position={x:32,y:18};
  assert.equal(planner.select(observation).id,puzzle.id,'a locally executable reset prerequisite still recovers');
});

test('National Dex fallback considers rare reachable species without changing campaign catch preferences',()=>{
 const route=openMap('MAP_ROUTE15',{behaviors:{'1,1':'MB_TALL_GRASS','2,1':'MB_TALL_GRASS'},encounters:{'1,1':1,'2,1':1}});
 const planner=createCampaignPlanner({campaign:{objectives:[]},world:{maps:[route],wildEncounters:[{map:route.id,land_mons:{encounter_rate:25,mons:Array.from({length:12},(_,i)=>({min_level:23,max_level:25,species:i===11?'SPECIES_DITTO':'SPECIES_PIDGEY'}))}}]},story:{scripts:[]},mechanics:{species:[{id:16,name:'SPECIES_PIDGEY'},{id:132,name:'SPECIES_DITTO'}],trainers:[]}});
 const o=campaignObservation({map:route.id,flags:{84:true,598:true,658:true,2081:true,2083:true},bag:{keyItems:[{itemId:362,quantity:1}],items:[{itemId:182,quantity:1}],pokeBalls:[{itemId:2,quantity:20}]}});
 o.playerMemory.position={x:1,y:1};o.playerMemory.trainer.pokedex={ownedSpecies:[16],ownedCount:1};
 assert.equal(planner.selectPokedexPreparation(o,60),null);
 const next=planner.selectPokedexPreparation(o,60,{minimumEncounterShare:0});
 assert.equal(next?.captureSpecies?.[0],132,JSON.stringify(next));assert.equal(next.pokedexThreshold,60);
 assert.equal(planner.selectPokedexPreparation(o,60),null,'fallback does not persistently change the fast selector');
});

test('income preparation remembers a failed trainer across restart and selects another reachable trainer',()=>{
 const map=openMap('MAP_ROUTE11',{objectEvents:[{x:3,y:2,trainer_type:'TRAINER_TYPE_NORMAL',script:'paid'},{x:1,y:3,trainer_type:'TRAINER_TYPE_NORMAL',script:'other'}]});
 const story={symbols:{trainers:{TRAINER_PAID:{value:41},TRAINER_OTHER:{value:42}}},scripts:[{label:'paid',instructions:[{op:'trainerbattle_single',args:['TRAINER_PAID','intro','defeat']}]},{label:'other',instructions:[{op:'trainerbattle_single',args:['TRAINER_OTHER','intro','defeat']}]}]};
 const mechanics={trainers:[{id:41,name:'TRAINER_PAID',trainerName:'PAID',trainerClass:'TRAINER_CLASS_GENTLEMAN',party:[{lvl:20,species:'SPECIES_DROWZEE'}]},{id:42,name:'TRAINER_OTHER',trainerName:'OTHER',trainerClass:'TRAINER_CLASS_GENTLEMAN',party:[{lvl:10,species:'SPECIES_DROWZEE'}]}],species:[{id:96,name:'SPECIES_DROWZEE',expYield:102}],moves:[]};
 const args={campaign:{objectives:[]},world:{maps:[map]},story,mechanics};let planner=createCampaignPlanner(args);
 const o=campaignObservation({map:map.id,flags:{2092:true,1321:false,1322:false},bag:{keyItems:[{itemId:362,quantity:1}]},party:[{slot:0,species:18,level:67,hp:200,maxHp:200,moves:[19],pp:[15]}]});
 o.playerMemory.trainer.partyValidity='valid';o.playerMemory.position={x:1,y:1};o.playerMemory.ui={};
 const first=planner.selectIncomePreparation(o);assert.ok(first);
 planner.rejectIncomePreparation?.(first,o);
 planner=createCampaignPlanner({...args,initialState:JSON.parse(JSON.stringify(planner.state()))});
 const alternative=planner.selectIncomePreparation(o);assert.ok(alternative);assert.notEqual(alternative.trainer.id,first.trainer.id);
 assert.equal(planner.selectIncomePreparation(o,Date.now()+300001).trainer.id,alternative.trainer.id,'an expired failed candidate must not displace an untried reachable alternative');
 planner.rejectIncomePreparation?.(alternative,o);assert.equal(planner.selectIncomePreparation(o),null);
});

test('navigation distinguishes arrival, a route, a transition, and an unsupported destination',async()=>{
 const {campaignNavigationOutcome}=await import('../src/player/campaign.js');
 const map=openMap('MAP_OUTCOMES',{width:5,height:1,collisions:{'3,0':1}}),world={maps:[map]};
 const observation=campaignObservation({map:map.id});observation.playerMemory.position={x:0,y:0};
 const check=x=>campaignNavigationOutcome?.({world,observation,objective:{id:'test-walk',target:{kind:'walk-to',map:map.id,x,y:0}}});
 assert.equal(check(0)?.status,'arrived');assert.equal(check(2)?.status,'action');
 const failed=check(4);assert.equal(failed?.status,'unsupported');assert.equal(failed.target.x,4);assert.ok(failed.reason);assert.ok(failed.mapRevision);
 observation.phase='transition';assert.equal(check(4)?.status,'temporarily-blocked');
});

test('a moving NPC obstruction is re-evaluated without treating it as task completion',async()=>{
 const {campaignNavigationOutcome}=await import('../src/player/campaign.js');
 const map=openMap('MAP_NPC_CORRIDOR',{width:3,height:2,collisions:{'0,1':1,'2,1':1},objectEvents:[{localId:1,x:1,y:1,elevation:3}]});
 const observation=campaignObservation({map:map.id});observation.playerMemory.position={x:0,y:0};
 const npc={localId:1,map:{id:map.id},current:{x:1,y:0},previous:{x:1,y:0},elevation:3};observation.playerMemory.objectEvents=[npc];
 const args={world:{maps:[map]},observation,objective:{id:'cross-corridor',target:{kind:'walk-to',map:map.id,x:2,y:0}}};
 assert.equal(campaignNavigationOutcome(args).status,'unsupported');
 npc.current={x:1,y:1};npc.previous={x:1,y:1};
 assert.equal(campaignNavigationOutcome(args).status,'action');assert.equal(campaignNavigationOutcome(args).recommendation.direction,'east');
});

test('VS Seeker recharge uses the clear walking circuit instead of the longer wild-encounter path',()=>{
 const map=openMap('MAP_RECHARGE_GRASS',{width:7,height:1,encounters:{'3,0':1,'4,0':1,'5,0':1,'6,0':1},behaviors:{'3,0':'MB_TALL_GRASS','4,0':'MB_TALL_GRASS','5,0':'MB_TALL_GRASS','6,0':'MB_TALL_GRASS'}});
 const observation=campaignObservation({map:map.id});observation.playerMemory.position={x:2,y:0};observation.playerMemory.vsSeeker={batterySteps:0};
 const d=campaignNavigationRecommendation({world:{maps:[map]},observation,objective:{id:'fund-capture-supplies',target:{kind:'vs-seeker-recharge',map:map.id,x:2,y:0}}});
 assert.equal(d?.direction,'west');assert.equal(d.target.x,0);assert.equal(d.remainingSteps,2);
});

test('postgame traversal observes Victory Road puzzle state without a story campaign',()=>{
 const planner=createCampaignPlanner({campaign:{objectives:[]},world:{maps:[openMap('MAP_VICTORY_ROAD_2F'),openMap('MAP_VICTORY_ROAD_3F')]},story:{scripts:[]},mechanics:{species:[]}});
 assert.ok(planner.storyWatch().flags.includes(0x58),'hidden dropped boulder must be observed');
 for(const id of [0x4066,0x4067])assert.ok(planner.storyWatch().variables.includes(id),'floor switch '+id+' must be observed');
});

test('a hidden Strength boulder cannot be operated at its original map position',()=>{
 const map=openMap('MAP_BOULDER_HIDDEN',{objectEvents:[{x:2,y:1,flag:'FLAG_HIDE_BOULDER',graphics_id:'OBJ_EVENT_GFX_PUSHABLE_BOULDER',script:'EventScript_StrengthBoulder'}]});
 const o=campaignObservation({map:map.id});o.playerMemory.position={x:3,y:1};o.playerMemory.storyState.flags.FLAG_HIDE_BOULDER=true;
 const d=rawCampaignNavigationRecommendation({world:{maps:[map]},observation:o,objective:{id:'hidden-boulder',target:{kind:'push-boulder',map:map.id,objectIndex:0,x:1,y:1}}});
 assert.ok(!['use-field-move','push-field-obstacle'].includes(d?.kind),'must not interact with a hidden object');
});

function incomeReliabilityFixture(){
 const a=openMap('MAP_ROUTE11',{connections:[{direction:'east',map:'MAP_ROUTE12',offset:0}],objectEvents:[{x:3,y:2,trainer_type:'TRAINER_TYPE_NORMAL',script:'paid'}]});
 const b=openMap('MAP_ROUTE12',{connections:[{direction:'west',map:a.id,offset:0}],objectEvents:[{x:3,y:2,trainer_type:'TRAINER_TYPE_NORMAL',script:'other'}]});
 const story={symbols:{trainers:{TRAINER_PAID:{value:41},TRAINER_OTHER:{value:42}}},scripts:[{label:'paid',instructions:[{op:'trainerbattle_single',args:['TRAINER_PAID','intro','defeat']}]},{label:'other',instructions:[{op:'trainerbattle_single',args:['TRAINER_OTHER','intro','defeat']}]}]};
 const mechanics={trainers:[{id:41,name:'TRAINER_PAID',trainerClass:'TRAINER_CLASS_GENTLEMAN',party:[{lvl:20,species:'SPECIES_DROWZEE'}]},{id:42,name:'TRAINER_OTHER',trainerClass:'TRAINER_CLASS_GENTLEMAN',party:[{lvl:20,species:'SPECIES_DROWZEE'}]}],species:[{id:96,name:'SPECIES_DROWZEE',expYield:102}],moves:[{id:19,power:70,pp:15}]};
 const args={campaign:{objectives:[]},world:{maps:[a,b]},story,mechanics};
 const o=campaignObservation({map:a.id,flags:{2092:true,1321:false,1322:false},bag:{keyItems:[{itemId:362,quantity:1}]},party:[{slot:0,species:116,personality:1,otId:7,level:23,hp:50,maxHp:50,moves:[19],pp:[15]},{slot:1,species:22,personality:2,otId:7,level:67,hp:200,maxHp:200,moves:[19],pp:[15]}]});
 o.playerMemory.trainer.partyValidity='valid';o.playerMemory.trainer.money=539;o.playerMemory.position={x:1,y:1};o.playerMemory.ui={};o.playerMemory.gameStats={trainerBattles:10};
 return {args,o,a,b};
}

test('income commitment survives travel and restart instead of chasing the newly closest trainer',()=>{
 const {args,o,b}=incomeReliabilityFixture();let p=createCampaignPlanner(args);
 const first=p.selectIncomePreparation(o);assert.equal(first.trainer.id,41);
 o.playerMemory.map.id=b.id;
 p=createCampaignPlanner({...args,initialState:JSON.parse(JSON.stringify(p.state()))});
 assert.equal(p.selectIncomePreparation(o).trainer.id,41);
 o.playerMemory.trainer.money+=1000;o.playerMemory.gameStats.trainerBattles++;
 assert.equal(p.selectIncomePreparation(o).trainer.id,42,'verified income permits a new selection');
});

test('failed income candidates remain excluded across travel, transient flags and restart',()=>{
 const {args,o,b}=incomeReliabilityFixture();let p=createCampaignPlanner(args);
 p.rejectIncomePreparation(p.selectIncomePreparation(o,1000),o,1000);
 o.playerMemory.map.id=b.id;o.playerMemory.storyState.flagIds[1]=true;
 p=createCampaignPlanner({...args,initialState:JSON.parse(JSON.stringify(p.state()))});
 const second=p.selectIncomePreparation(o,2000);assert.equal(second.trainer.id,42);
 p.rejectIncomePreparation(second,o,2000);
 assert.equal(p.selectIncomePreparation(o,3000),null,'changing maps cannot revive the failed first trainer');
});

// The dug-out Dunsparce Tunnel is a navigation capability (National Dex
// layouts) that no trainer's route depends on. Income records written before it
// existed, or before the National Dex was enabled, keep their exhausted budget
// and committed trainer.
test('the National Dex layout capability neither revives exhausted income trainers nor drops a committed one',()=>{
 const {args,o,b}=incomeReliabilityFixture();
 const legacy=state=>{const strip=context=>JSON.stringify(Object.fromEntries(Object.entries(JSON.parse(context)).filter(([key])=>key!=='nationalDexLayouts')));
  const planner=JSON.parse(JSON.stringify(state));
  for(const failure of planner.incomeFailures??[])failure.context=strip(failure.context);
  if(planner.incomePlan)planner.incomePlan.context=strip(planner.incomePlan.context);
  return planner;};
 const nationalDex=on=>{o.playerMemory.storyState.flagIds[2112]=on;o.playerMemory.storyState.variableIds={...o.playerMemory.storyState.variableIds,[0x404e]:on?0x6258:0};};
 let p=createCampaignPlanner(args);const first=p.selectIncomePreparation(o,1000);assert.equal(first.trainer.id,41);
 for(let attempt=1;attempt<=3;attempt++)p.rejectIncomePreparation(first,o,attempt*1000);
 assert.equal(p.state().incomeFailures.find(f=>f.id===41)?.attempts,3);
 // On Route 11 the exhausted trainer is the only candidate.
 for(const on of [false,true]){
  nationalDex(on);
  p=createCampaignPlanner({...args,initialState:legacy(p.state())});
  assert.equal(p.selectIncomePreparation(o,10000000),null,`an exhausted trainer stays excluded (National Dex ${on?'on':'off'})`);
 }
 nationalDex(false);
 const fresh=incomeReliabilityFixture();p=createCampaignPlanner(fresh.args);
 assert.equal(p.selectIncomePreparation(fresh.o).trainer.id,41);
 p=createCampaignPlanner({...fresh.args,initialState:legacy(p.state())});
 fresh.o.playerMemory.map.id=b.id;
 assert.equal(p.selectIncomePreparation(fresh.o).trainer.id,41,'the committed trainer survives the update');
});

// The Mansion switch (flag 620) is a navigation capability too. Income records
// written before it existed keep their budget whichever way the switch is set.
test('the Mansion switch capability neither revives exhausted income trainers nor splits their records',()=>{
 const {args,o}=incomeReliabilityFixture();
 let p=createCampaignPlanner(args);const first=p.selectIncomePreparation(o,1000);assert.equal(first.trainer.id,41);
 for(let attempt=1;attempt<=3;attempt++)p.rejectIncomePreparation(first,o,attempt*1000);
 const recorded=JSON.parse(JSON.stringify(p.state()));
 assert.ok(recorded.incomeFailures.every(f=>!f.context.includes('mansionSwitchSet')));
 for(const on of [true,false]){
  o.playerMemory.storyState.flagIds[620]=on;
  p=createCampaignPlanner({...args,initialState:JSON.parse(JSON.stringify(recorded))});
  assert.equal(p.selectIncomePreparation(o,10000000),null,`an exhausted trainer stays excluded (switch ${on?'set':'reset'})`);
 }
});

test('income uses the chosen paid trainer and capable battler rather than starting unrelated training',()=>{
 const {args,o}=incomeReliabilityFixture();const p=createCampaignPlanner(args),income=p.selectIncomePreparation(o);
 const battle=p.selectTraining(o,income);
 assert.equal(battle?.trainer.id,41);assert.equal(battle?.trainingPartySlot,1);assert.equal(battle?.trainingSpecies,22);
});

test('funding does not reserve a higher-level battler with no attacking move',()=>{
 const {args,o}=incomeReliabilityFixture();args.mechanics.moves.push({id:45,power:0,pp:40,effect:'EFFECT_ATTACK_DOWN'});
 o.playerMemory.trainer.party.push({slot:2,species:176,personality:3,otId:7,level:90,hp:200,maxHp:200,moves:[45],pp:[40]});
 const p=createCampaignPlanner(args),goal=p.selectIncomePreparation(o);
 assert.equal(p.selectTraining(o,goal)?.trainingPartySlot,1);
});

test('a clean funding timeout rejects its trainer and preserves the parent for an executable alternative',async()=>{
 const {createPostgameController}=await import('../src/suite/postgame.js');
 const {args,o,a,b}=incomeReliabilityFixture();a.objectEvents.push({...b.objectEvents[0],x:1,y:3});b.objectEvents=[];
 const p=createCampaignPlanner(args),objective=p.selectIncomePreparation(o,1000);
 o.playerMemory.storyState.flagIds[2112]=true;o.playerMemory.storyState.flagIds[2116]=true;
 const state={schema:'pokemon-suite/postgame/v1',agenda:{enabled:true,active:'game-corner',failures:{}},preparation:{kind:'postgame',phase:'complete'},objective,planner:p.state(),watchdog:{owner:'game-corner',idleMs:300000}};
 let c=createPostgameController({...args,state,clock:()=>1000});const d=c.decide(o),held=c.state();
 assert.equal(d.kind,'resample');assert.equal(held.agenda.active,'game-corner',JSON.stringify({d,planner:held.planner}));
 assert.equal(held.planner.incomeFailures?.[0]?.id,objective.trainer.id);assert.ok(held.planner.incomePlan);assert.notEqual(held.planner.incomePlan.objective.trainer.id,objective.trainer.id);
 assert.equal(held.watchdog.idleMs,0,'a genuinely different candidate receives its bounded attempt');
 c=createPostgameController({...args,state:JSON.parse(JSON.stringify(held)),clock:()=>1001});
 assert.equal(c.state().planner.incomeFailures[0].attempts,1);
 assert.equal(c.state().agenda.failures?.['game-corner'],undefined,'one failed trainer is not failure of the prize');
});

test('campaign-rated training keeps its cycling-road pull responder', () => {
  const teamPlan = createMasterTeamPlan(4, 2735793998, { selection: 'legacy-seeded-v1' });
  const objective = createMasterCampaign(teamPlan).objectives.find(({ id }) => id === 'badge-cascade');
  const pullBehaviors = {};
  for (let y = 0; y < 24; y += 1) {
    pullBehaviors[`4,${y}`] = 'MB_CYCLING_ROAD_PULL_DOWN';
    pullBehaviors[`5,${y}`] = 'MB_CYCLING_ROAD_PULL_DOWN';
  }
  const cycling = openMap('MAP_ROUTE17', {
    width: 8, height: 24,
    behaviors: pullBehaviors,
    connections: [{ direction: 'east', map: 'MAP_ROUTE12', offset: 0 }],
    objectEvents: [{ x: 4, y: 18, script: 'Route17_EventScript_Virgil', trainer_type: 'TRAINER_TYPE_NORMAL' }],
  });
  const meadow = openMap('MAP_ROUTE12', {
    behaviors: { '1,1': 'MB_TALL_GRASS', '2,1': 'MB_TALL_GRASS' },
    encounters: { '1,1': 1, '2,1': 1 },
    connections: [{ direction: 'west', map: 'MAP_ROUTE17', offset: 0 }],
  });
  const world = {
    maps: [cycling, meadow],
    wildEncounters: [
      { map: 'MAP_ROUTE12', land_mons: { encounter_rate: 21, mons: [{ min_level: 20, max_level: 22, species: 'SPECIES_ODDISH' }] } },
    ],
  };
  const observation = campaignObservation({
    map: 'MAP_ROUTE17',
    party: [
      { slot: 0, species: 21, level: 19, hp: 44, maxHp: 44, moves: [64] },
      { slot: 1, species: 5, level: 29, hp: 81, maxHp: 81, moves: [52] },
      { slot: 2, species: 43, level: 13, hp: 36, maxHp: 36, moves: [71] },
    ],
    bag: { keyItems: [{ itemId: 362, quantity: 1 }] },
    flags: { 2092: true, 1321: true, 1322: true },
  });
  observation.playerMemory.position = { x: 5, y: 18 };
  observation.playerMemory.trainer.partyValidity = 'valid';
  observation.playerMemory.ui = {};
  observation.playerMemory.vsSeeker = { batterySteps: 0, rematchEntries: Array(100).fill(0) };
  observation.playerMemory.vsSeeker.rematchEntries[0] = 1;
  const trainerCatalog = [{
    id: 41, flagId: 1321, localId: 0,
    target: { kind: 'object', map: 'MAP_ROUTE17', x: 4, y: 18, index: 0 },
    rematchParties: [null, { flagId: 1322, maximumLevel: 30, expectedExperience: 600 }],
  }];

  const campaign = selectTrainingObjective({ world, observation, objective, teamPlan, trainerCatalog });
  assert.equal(campaign?.target?.map, 'MAP_ROUTE17', 'campaign-rated training keeps the pull route');
});
test('identity-evolution training never commits to a cycling-road pull trainer', () => {
  const pullBehaviors = {};
  for (let y = 0; y < 24; y += 1) {
    pullBehaviors[`4,${y}`] = 'MB_CYCLING_ROAD_PULL_DOWN';
    pullBehaviors[`5,${y}`] = 'MB_CYCLING_ROAD_PULL_DOWN';
  }
  const cycling = openMap('MAP_ROUTE17', {
    width: 8, height: 24,
    behaviors: pullBehaviors,
    connections: [{ direction: 'east', map: 'MAP_ROUTE12', offset: 0 }],
    objectEvents: [{ x: 4, y: 18, script: 'Route17_EventScript_Virgil', trainer_type: 'TRAINER_TYPE_NORMAL' }],
  });
  const meadow = openMap('MAP_ROUTE12', {
    behaviors: { '1,1': 'MB_TALL_GRASS', '2,1': 'MB_TALL_GRASS' },
    encounters: { '1,1': 1, '2,1': 1 },
    connections: [{ direction: 'west', map: 'MAP_ROUTE17', offset: 0 }],
  });
  const world = {
    maps: [cycling, meadow],
    wildEncounters: [
      { map: 'MAP_ROUTE12', land_mons: { encounter_rate: 21, mons: [{ min_level: 20, max_level: 22, species: 'SPECIES_ODDISH' }] } },
    ],
  };
  const observation = campaignObservation({
    map: 'MAP_ROUTE17',
    party: [
      { slot: 0, species: 21, level: 19, hp: 44, maxHp: 44, moves: [64] },
      { slot: 1, species: 5, level: 29, hp: 81, maxHp: 81, moves: [52] },
      { slot: 2, species: 43, level: 13, hp: 36, maxHp: 36, moves: [71] },
    ],
    bag: { keyItems: [{ itemId: 362, quantity: 1 }] },
    flags: { 2092: true, 1321: true, 1322: true },
  });
  observation.playerMemory.position = { x: 5, y: 18 };
  observation.playerMemory.trainer.partyValidity = 'valid';
  observation.playerMemory.ui = {};
  observation.playerMemory.vsSeeker = { batterySteps: 0, rematchEntries: Array(100).fill(0) };
  observation.playerMemory.vsSeeker.rematchEntries[0] = 1;
  const trainerCatalog = [{
    id: 41, flagId: 1321, localId: 0,
    target: { kind: 'object', map: 'MAP_ROUTE17', x: 4, y: 18, index: 0 },
    rematchParties: [null, { flagId: 1322, maximumLevel: 30, expectedExperience: 600 }],
  }];
  const objective = {
    id: 'evolution-dex-1706568373-178366266-85-train',
    target: { kind: 'map', map: 'MAP_ROUTE17' },
    identityEvolution: true, minimumCoreLevel: 31, coreSpecies: [84],
    trainingFingerprint: '[84,178366266,1706568373,29,15,18,25,8,30]',
  };
  // The pull trainer must never be selected for identity-evolution training.
  // (The reachable fallback is exercised against the real world data by the
  // planner probe and the live-replay qualification, not by this fixture.)
  const evolution = selectTrainingObjective({ world, observation, objective, trainerCatalog, avoidPullTerrain: true });
  assert.notEqual(evolution?.trainer?.id, 41, 'the pull trainer cannot be an evolution training route');
  assert.notEqual(evolution?.target?.map, 'MAP_ROUTE17', 'the pull target cannot be an evolution training route');
});

test("item preparation skips catalogued locations the task excludes", () => {
  // The Mail supply's seed candy must not route to Route 17's hidden candy on
  // the Cycling Road slope, where the field controller cannot stop to press A.
  const map = openMap("MAP_CANDY_FIELD", {
    width: 9,
    backgroundEvents: [
      { x: 3, y: 2, elevation: 3, type: "hidden_item", flag: "FLAG_HIDDEN_ITEM_NEAR_CANDY", item: "ITEM_RARE_CANDY", quantity: 1, underfoot: false },
      { x: 8, y: 4, elevation: 3, type: "hidden_item", flag: "FLAG_HIDDEN_ITEM_FAR_CANDY", item: "ITEM_RARE_CANDY", quantity: 1, underfoot: false },
    ],
  });
  const planner = createCampaignPlanner({
    campaign: { objectives: [] },
    world: { data: { maps: [map] } },
    story: collectionStory({
      flags: { FLAG_HIDDEN_ITEM_NEAR_CANDY: 1001, FLAG_HIDDEN_ITEM_FAR_CANDY: 1002 },
      items: { ITEM_RARE_CANDY: 68 },
    }),
  });
  const observation = campaignObservation({ map: map.id, flags: { 1001: false, 1002: false } });
  observation.playerMemory.position = { x: 3, y: 3 };

  assert.equal(planner.selectItemPreparation(observation, 68)?.id, "evolution-collect:MAP_CANDY_FIELD:hidden:0");
  assert.equal(
    planner.selectItemPreparation(observation, 68, 1, { excludeLocationIds: ["collect:MAP_CANDY_FIELD:hidden:0"] })?.id,
    "evolution-collect:MAP_CANDY_FIELD:hidden:1",
  );
  assert.equal(
    planner.selectItemPreparation(observation, 68, 1, { excludeLocationIds: ["collect:MAP_CANDY_FIELD:hidden:0", "collect:MAP_CANDY_FIELD:hidden:1"] }),
    null,
  );
});
