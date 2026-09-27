import { createHash } from "node:crypto";

import { starterForSpecies } from "./run-profile.js";

const SOURCE = "ORIGINS_RED_BATTLE_CONFIGS.md";
const SUPPORT_CORE = Object.freeze([135, 131, 123, 85, 53]);
const PARAS_UTILITY_FAMILY = Object.freeze([46, 47]);
const ODDISH_FAMILY = Object.freeze([43, 44, 45]);

const SUPPORT_ACQUISITIONS = Object.freeze([
  Object.freeze({
    id: "origins-jolteon",
    label: "Celadon Eevee to Jolteon",
    family: Object.freeze([133, 134, 135, 136]),
    targetSpecies: 135,
    requiredBy: "badge-rainbow",
    nativeFireRed: true,
    steps: Object.freeze([
      Object.freeze({
        kind: "gift",
        species: 133,
        map: "MAP_CELADON_CITY_CONDOMINIUMS_ROOF_ROOM",
        objectIndex: 1,
      }),
      Object.freeze({
        kind: "purchase",
        itemId: 96,
        price: 2100,
        quantity: 1,
        map: "MAP_CELADON_CITY_DEPARTMENT_STORE_4F",
        objectIndex: 2,
      }),
      Object.freeze({
        kind: "evolution",
        sourceSpecies: 133,
        targetSpecies: 135,
        itemId: 96,
      }),
    ]),
  }),
  Object.freeze({
    id: "origins-lapras",
    label: "Silph gift Lapras",
    family: Object.freeze([131]),
    targetSpecies: 131,
    requiredBy: "silph-liberated",
    nativeFireRed: true,
    steps: Object.freeze([
      Object.freeze({
        kind: "gift",
        species: 131,
        map: "MAP_SILPH_CO_7F",
        objectIndex: 1,
      }),
    ]),
  }),
  Object.freeze({
    id: "origins-scyther",
    label: "Safari Zone Scyther",
    family: Object.freeze([123]),
    targetSpecies: 123,
    requiredBy: "badge-soul",
    nativeFireRed: true,
    steps: Object.freeze([
      Object.freeze({
        kind: "safari-capture",
        species: 123,
        maps: Object.freeze([
          "MAP_SAFARI_ZONE_CENTER",
          "MAP_SAFARI_ZONE_EAST",
        ]),
      }),
    ]),
  }),
  Object.freeze({
    id: "origins-dodrio",
    label: "Route 16 Doduo to Dodrio",
    family: Object.freeze([84, 85]),
    targetSpecies: 85,
    requiredBy: "badge-soul",
    nativeFireRed: true,
    steps: Object.freeze([
      Object.freeze({
        kind: "wild-capture",
        species: 84,
        maps: Object.freeze(["MAP_ROUTE16", "MAP_ROUTE17", "MAP_ROUTE18"]),
      }),
      Object.freeze({
        kind: "level-evolution",
        sourceSpecies: 84,
        targetSpecies: 85,
        level: 31,
      }),
    ]),
  }),
  Object.freeze({
    id: "origins-persian",
    label: "Route 5 Meowth to Persian",
    family: Object.freeze([52, 53]),
    targetSpecies: 53,
    requiredBy: "badge-thunder",
    nativeFireRed: true,
    steps: Object.freeze([
      Object.freeze({
        kind: "wild-capture",
        species: 52,
        maps: Object.freeze(["MAP_ROUTE5", "MAP_ROUTE6", "MAP_ROUTE7", "MAP_ROUTE8"]),
      }),
      Object.freeze({
        kind: "level-evolution",
        sourceSpecies: 52,
        targetSpecies: 53,
        level: 28,
      }),
    ]),
  }),
]);

function freezeFamilies(families) {
  return Object.freeze(families.map((family) => Object.freeze([...family])));
}

export function createOriginsTeamPlan(starterSpecies) {
  const starter = starterForSpecies(starterSpecies);
  if (!starter) {
    throw new TypeError("Origins team plan requires a Bulbasaur, Charmander, or Squirtle family starter");
  }
  const starterFamily = Object.freeze([...starter.family]);
  return Object.freeze({
    schema: "master-red/origins-team-plan/v1",
    provenance: Object.freeze({
      source: SOURCE,
      personalization: "selected-starter-family",
      canonicalHallOfFameSpecies: Object.freeze([6, ...SUPPORT_CORE]),
    }),
    starterFamily,
    hallOfFameSpecies: Object.freeze([starter.finalSpecies, ...SUPPORT_CORE]),
    acquisitions: SUPPORT_ACQUISITIONS,
    utilityAcquisitions: Object.freeze([
      Object.freeze({
        id: "utility-paras",
        label: "Mt. Moon Paras utility carrier",
        family: PARAS_UTILITY_FAMILY,
        targetSpecies: 46,
        nativeFireRed: true,
        role: "hm-carrier",
        fieldMoves: Object.freeze([15, 148, 249]),
        steps: Object.freeze([
          Object.freeze({
            kind: "wild-capture",
            species: 46,
            maps: Object.freeze([
              "MAP_MT_MOON_1F",
              "MAP_MT_MOON_B1F",
              "MAP_MT_MOON_B2F",
            ]),
          }),
        ]),
      }),
    ]),
    earlyGame: Object.freeze({
      brock: Object.freeze({
        anchorFamilies: freezeFamilies([starter.family]),
        optionalFamilies: starter.species === 4
          ? freezeFamilies([[56, 57]])
          : Object.freeze([]),
        anchorLevel: 12,
        supportFloor: 8,
      }),
      misty: Object.freeze({
        anchorFamilies: freezeFamilies([starter.family]),
        anchorLevel: 20,
        supportFloor: 14,
        counterFamilies: starter.species === 1
          ? freezeFamilies([starter.family])
          : freezeFamilies([ODDISH_FAMILY]),
        counterLevel: starter.species === 1 ? 20 : 23,
      }),
      surge: Object.freeze({
        preferredFamilies: freezeFamilies([
          starter.family,
          [50, 51],
          [43, 44, 45],
        ]),
        anchorLevel: 23,
        supportFloor: 18,
      }),
    }),
    battlePlans: Object.freeze({
      "badge-rainbow": Object.freeze({
        anchorFamilies: freezeFamilies([starter.family]),
        preferredFamilies: freezeFamilies([
          starter.family,
          [133, 134, 135, 136],
          [32, 33, 34],
          [21, 22],
          [19, 20],
          [10, 11, 12],
        ]),
        anchorLevel: 28,
        supportFloor: 23,
        minimumReadyMembers: 3,
        trainerTrainingAllowed: false,
      }),
    }),
    fieldMoves: Object.freeze({
      // Weak utility HMs stay off the battle core. Surf, Fly, and Strength are
      // retained on core members because they are useful attacks in FireRed.
      cut: PARAS_UTILITY_FAMILY,
      fly: Object.freeze([84, 85]),
      surf: Object.freeze([131]),
      strength: Object.freeze([131]),
      flash: PARAS_UTILITY_FAMILY,
      rockSmash: PARAS_UTILITY_FAMILY,
    }),
    pokedexPolicy: Object.freeze({
      enabled: true,
      opportunisticBallReserve: 3,
      fillOpenPartySlots: true,
      purchasePriority: Object.freeze(["medicine", "poke-balls"]),
    }),
  });
}

const MASTER_TEAM_SOURCE =
  "Pokemon FireRed Rev 1 encounter tables and TM/HM learnsets";
const REQUIRED_FIELD_MOVES = Object.freeze(["cut", "fly", "surf", "strength"]);

function permanentAcquisition({
  id,
  label,
  family,
  captureSpecies,
  targetSpecies,
  afterObjectiveId,
  availabilityOrder,
  requiredBy,
  maps = [],
  encounterKind = "wild-capture",
  objectIndex = null,
  flagId = null,
  evolutionLevel = null,
  steps: authoredSteps = null,
  fieldCapabilities = [],
  types = [],
  coverageTypes = types,
  battleRoles = [],
  hmPriority = {},
}) {
  const generatedSteps = [{
    kind: encounterKind,
    species: captureSpecies,
    ...(maps.length > 0 ? { maps } : {}),
    ...(Number.isSafeInteger(objectIndex) ? { objectIndex } : {}),
    ...(Number.isSafeInteger(flagId) ? { flagId } : {}),
  }];
  if (Number.isSafeInteger(evolutionLevel)) generatedSteps.push({
    kind: "level-evolution",
    sourceSpecies: captureSpecies,
    targetSpecies,
    level: evolutionLevel,
  });
  const steps = (authoredSteps ?? generatedSteps).map((step) => Object.freeze({
    ...step,
    ...(Array.isArray(step.maps) ? { maps: Object.freeze([...step.maps]) } : {}),
  }));
  return Object.freeze({
    id,
    label,
    family: Object.freeze([...family]),
    captureSpecies,
    targetSpecies,
    afterObjectiveId,
    availabilityOrder,
    requiredBy,
    nativeFireRed: true,
    preHallOfFame: true,
    permanentRoster: true,
    fieldCapabilities: Object.freeze([...fieldCapabilities]),
    types: Object.freeze([...types]),
    coverageTypes: Object.freeze([...coverageTypes]),
    battleRoles: Object.freeze([...battleRoles]),
    hmPriority: Object.freeze({ ...hmPriority }),
    steps: Object.freeze(steps),
  });
}

const PERMANENT_ACQUISITION_CATALOG = Object.freeze([
  permanentAcquisition({
    id: "pidgeot", label: "Route 1 Pidgey to Pidgeot",
    family: [16, 17, 18], captureSpecies: 16, targetSpecies: 18,
    afterObjectiveId: "regional-pokedex", availabilityOrder: 0,
    requiredBy: "badge-boulder", maps: ["MAP_ROUTE1", "MAP_ROUTE2"],
    evolutionLevel: 36, fieldCapabilities: ["fly"],
    types: ["normal", "flying"], battleRoles: ["physical"],
    hmPriority: { fly: 0 },
  }),
  permanentAcquisition({
    id: "raticate", label: "Route 1 Rattata to Raticate",
    family: [19, 20], captureSpecies: 19, targetSpecies: 20,
    afterObjectiveId: "regional-pokedex", availabilityOrder: 0,
    requiredBy: "badge-boulder", maps: ["MAP_ROUTE1", "MAP_ROUTE2"],
    evolutionLevel: 20, fieldCapabilities: ["cut", "strength", "rockSmash"],
    types: ["normal"], battleRoles: ["physical", "agatha-answer"],
    hmPriority: { cut: 1, strength: 4 },
  }),
  permanentAcquisition({
    id: "fearow", label: "Route 22 Spearow to Fearow",
    family: [21, 22], captureSpecies: 21, targetSpecies: 22,
    afterObjectiveId: "regional-pokedex", availabilityOrder: 0,
    requiredBy: "badge-boulder", maps: ["MAP_ROUTE22", "MAP_ROUTE3"],
    evolutionLevel: 20, fieldCapabilities: ["fly"],
    types: ["normal", "flying"], battleRoles: ["physical"],
    hmPriority: { fly: 0 },
  }),
  permanentAcquisition({
    id: "primeape", label: "Route 22 Mankey to Primeape",
    family: [56, 57], captureSpecies: 56, targetSpecies: 57,
    afterObjectiveId: "regional-pokedex", availabilityOrder: 0,
    requiredBy: "badge-boulder", maps: ["MAP_ROUTE22", "MAP_ROUTE3"],
    evolutionLevel: 28, fieldCapabilities: ["strength", "rockSmash"],
    types: ["fighting"], battleRoles: ["physical", "ice-answer"],
    hmPriority: { strength: 2 },
  }),
  permanentAcquisition({
    id: "butterfree", label: "Viridian Forest Caterpie to Butterfree",
    family: [10, 11, 12], captureSpecies: 10, targetSpecies: 12,
    afterObjectiveId: "rival-route22-early", availabilityOrder: 1,
    requiredBy: "badge-boulder", maps: ["MAP_VIRIDIAN_FOREST", "MAP_ROUTE2"],
    evolutionLevel: 10, types: ["bug", "flying"],
    battleRoles: ["special", "status", "agatha-answer"],
  }),
  permanentAcquisition({
    id: "beedrill", label: "Viridian Forest Weedle to Beedrill",
    family: [13, 14, 15], captureSpecies: 13, targetSpecies: 15,
    afterObjectiveId: "rival-route22-early", availabilityOrder: 1,
    requiredBy: "badge-boulder", maps: ["MAP_VIRIDIAN_FOREST", "MAP_ROUTE2"],
    evolutionLevel: 10, types: ["bug", "poison"], battleRoles: ["physical"],
  }),
  permanentAcquisition({
    id: "graveler", label: "Mt. Moon Geodude to Graveler",
    family: [74, 75], captureSpecies: 74, targetSpecies: 75,
    afterObjectiveId: "badge-boulder", availabilityOrder: 2,
    requiredBy: "badge-cascade", maps: ["MAP_MT_MOON_1F", "MAP_MT_MOON_B2F"],
    evolutionLevel: 25, fieldCapabilities: ["strength", "rockSmash"],
    types: ["rock", "ground"], battleRoles: ["physical", "agatha-answer"],
    hmPriority: { strength: 1 },
  }),
  permanentAcquisition({
    id: "nidoran-m", label: "Route 3 Nidoran♂ to Nidoking",
    family: [32, 33, 34], captureSpecies: 32, targetSpecies: 34,
    afterObjectiveId: "badge-boulder", availabilityOrder: 2,
    requiredBy: "badge-cascade", maps: ["MAP_ROUTE3"],
    fieldCapabilities: ["cut", "surf", "strength", "rockSmash"],
    types: ["poison", "ground"],
    coverageTypes: ["ground", "ice", "electric", "water"],
    battleRoles: ["physical", "special", "ice-answer", "agatha-answer"],
    hmPriority: { cut: 0, surf: 4, strength: 3 },
    steps: [
      {
        kind: "wild-capture",
        species: 32,
        maps: ["MAP_ROUTE3"],
        afterObjectiveId: "badge-boulder",
      },
      {
        kind: "collect-item",
        itemId: 94,
        map: "MAP_MT_MOON_1F",
        objectIndex: 12,
        flagId: 350,
        afterObjectiveId: "badge-boulder",
      },
      {
        kind: "level-evolution",
        sourceSpecies: 32,
        targetSpecies: 33,
        level: 16,
      },
      {
        kind: "item-evolution",
        sourceSpecies: 33,
        targetSpecies: 34,
        itemId: 94,
        afterObjectiveId: "badge-cascade",
      },
    ],
  }),
  permanentAcquisition({
    id: "golbat", label: "Mt. Moon Zubat to Golbat",
    family: [41, 42], captureSpecies: 41, targetSpecies: 42,
    afterObjectiveId: "badge-boulder", availabilityOrder: 2,
    requiredBy: "badge-cascade", maps: ["MAP_MT_MOON_1F", "MAP_MT_MOON_B2F"],
    evolutionLevel: 22, types: ["poison", "flying"],
    battleRoles: ["physical", "status"],
  }),
  permanentAcquisition({
    id: "parasect", label: "Mt. Moon Paras to Parasect",
    family: [46, 47], captureSpecies: 46, targetSpecies: 47,
    afterObjectiveId: "badge-boulder", availabilityOrder: 2,
    requiredBy: "hm-cut", maps: ["MAP_MT_MOON_B1F", "MAP_MT_MOON_B2F"],
    evolutionLevel: 24, fieldCapabilities: ["cut", "flash", "rockSmash"],
    types: ["bug", "grass"],
    battleRoles: ["physical", "status", "ice-answer", "water-answer"],
    hmPriority: { cut: 0, flash: 0 },
  }),
  permanentAcquisition({
    id: "gloom", label: "Route 24 Oddish to Gloom",
    family: [43, 44, 45], captureSpecies: 43, targetSpecies: 44,
    afterObjectiveId: "rival-cerulean", availabilityOrder: 3,
    requiredBy: "badge-cascade", maps: ["MAP_ROUTE24", "MAP_ROUTE25"],
    evolutionLevel: 21, fieldCapabilities: ["cut", "flash"],
    types: ["grass", "poison"],
    battleRoles: ["special", "status", "ice-answer", "water-answer"],
    hmPriority: { cut: 2, flash: 1 },
  }),
  permanentAcquisition({
    id: "persian", label: "Route 5 Meowth to Persian",
    family: [52, 53], captureSpecies: 52, targetSpecies: 53,
    afterObjectiveId: "cerulean-rocket", availabilityOrder: 4,
    requiredBy: "hm-cut", maps: ["MAP_ROUTE5", "MAP_ROUTE6"],
    evolutionLevel: 28, fieldCapabilities: ["cut", "flash"],
    types: ["normal"], battleRoles: ["physical", "agatha-answer"],
    hmPriority: { cut: 1, flash: 1 },
  }),
  permanentAcquisition({
    id: "dugtrio", label: "Diglett's Cave Diglett to Dugtrio",
    family: [50, 51], captureSpecies: 50, targetSpecies: 51,
    afterObjectiveId: "vs-seeker", availabilityOrder: 4,
    requiredBy: "badge-thunder", maps: ["MAP_DIGLETTS_CAVE_B1F"],
    evolutionLevel: 26, fieldCapabilities: ["cut", "rockSmash"],
    types: ["ground"], battleRoles: ["physical", "agatha-answer"],
    hmPriority: { cut: 2 },
  }),
  permanentAcquisition({
    id: "hypno", label: "Route 11 Drowzee to Hypno",
    family: [96, 97], captureSpecies: 96, targetSpecies: 97,
    afterObjectiveId: "vs-seeker", availabilityOrder: 4,
    requiredBy: "badge-thunder", maps: ["MAP_ROUTE11"],
    evolutionLevel: 26, fieldCapabilities: ["flash"],
    types: ["psychic"], battleRoles: ["special", "status", "agatha-answer"],
  }),
  permanentAcquisition({
    id: "mr-mime", label: "Route 24 Abra traded for Mr. Mime",
    family: [122], captureSpecies: 63, targetSpecies: 122,
    afterObjectiveId: "rival-cerulean", availabilityOrder: 4,
    requiredBy: "badge-thunder", maps: ["MAP_ROUTE24", "MAP_ROUTE25"],
    fieldCapabilities: ["flash"], types: ["psychic"],
    coverageTypes: ["psychic", "electric"],
    battleRoles: ["special", "status", "agatha-answer"],
    hmPriority: { flash: 0 },
    steps: [
      {
        kind: "wild-capture",
        species: 63,
        maps: ["MAP_ROUTE24", "MAP_ROUTE25"],
        afterObjectiveId: "rival-cerulean",
        prerequisite: true,
      },
      {
        kind: "in-game-trade",
        map: "MAP_ROUTE2_HOUSE",
        objectIndex: 1,
        requestedSpecies: 63,
        receivedSpecies: 122,
        flagId: 584,
        afterObjectiveId: "teach-cut",
      },
    ],
  }),
  permanentAcquisition({
    id: "arbok", label: "Route 11 Ekans to Arbok",
    family: [23, 24], captureSpecies: 23, targetSpecies: 24,
    afterObjectiveId: "vs-seeker", availabilityOrder: 4,
    requiredBy: "badge-thunder", maps: ["MAP_ROUTE11", "MAP_ROUTE8"],
    evolutionLevel: 22, fieldCapabilities: ["strength", "rockSmash"],
    types: ["poison"], battleRoles: ["physical", "status"],
    hmPriority: { strength: 4 },
  }),
  permanentAcquisition({
    id: "growlithe", label: "Route 8 Growlithe",
    family: [58, 59], captureSpecies: 58, targetSpecies: 58,
    afterObjectiveId: "badge-thunder", availabilityOrder: 5,
    requiredBy: "badge-rainbow", maps: ["MAP_ROUTE8", "MAP_ROUTE7"],
    fieldCapabilities: ["strength", "rockSmash"], types: ["fire"],
    battleRoles: ["special", "ice-answer"], hmPriority: { strength: 4 },
  }),
  permanentAcquisition({
    id: "haunter", label: "Pokemon Tower Gastly to Haunter",
    family: [92, 93], captureSpecies: 92, targetSpecies: 93,
    afterObjectiveId: "rival-pokemon-tower", availabilityOrder: 6,
    requiredBy: "poke-flute", maps: ["MAP_POKEMON_TOWER_3F", "MAP_POKEMON_TOWER_4F"],
    evolutionLevel: 25, types: ["ghost", "poison"],
    battleRoles: ["special", "status", "agatha-answer"],
  }),
  permanentAcquisition({
    id: "marowak", label: "Pokemon Tower Cubone to Marowak",
    family: [104, 105], captureSpecies: 104, targetSpecies: 105,
    afterObjectiveId: "rival-pokemon-tower", availabilityOrder: 6,
    requiredBy: "poke-flute", maps: ["MAP_POKEMON_TOWER_3F", "MAP_POKEMON_TOWER_4F"],
    evolutionLevel: 28, fieldCapabilities: ["strength", "rockSmash"],
    types: ["ground"], battleRoles: ["physical", "agatha-answer"],
    hmPriority: { strength: 1 },
  }),
  permanentAcquisition({
    id: "dodrio", label: "Route 16 Doduo to Dodrio",
    family: [84, 85], captureSpecies: 84, targetSpecies: 85,
    afterObjectiveId: "poke-flute", availabilityOrder: 7,
    requiredBy: "rival-silph", maps: ["MAP_ROUTE16", "MAP_ROUTE17"],
    evolutionLevel: 31, fieldCapabilities: ["fly"],
    types: ["normal", "flying"], battleRoles: ["physical"],
    hmPriority: { fly: 0 },
  }),
  permanentAcquisition({
    id: "snorlax", label: "Route 16 Snorlax",
    family: [143], captureSpecies: 143, targetSpecies: 143,
    afterObjectiveId: "poke-flute", availabilityOrder: 7,
    requiredBy: "rival-silph", maps: ["MAP_ROUTE16"],
    encounterKind: "fixed-capture", objectIndex: 9, flagId: 128,
    fieldCapabilities: ["surf", "strength"], types: ["normal"],
    coverageTypes: ["normal", "ghost", "fighting"],
    battleRoles: ["physical", "tank", "agatha-answer"],
    hmPriority: { surf: 2, strength: 0 },
  }),
  permanentAcquisition({
    id: "lapras", label: "Silph Co. gift Lapras",
    family: [131], captureSpecies: 131, targetSpecies: 131,
    afterObjectiveId: "rival-silph", availabilityOrder: 8,
    requiredBy: "silph-liberated", maps: ["MAP_SILPH_CO_7F"],
    encounterKind: "gift", objectIndex: 1,
    fieldCapabilities: ["surf", "strength", "rockSmash"],
    types: ["water", "ice"], battleRoles: ["special", "tank", "ice-answer"],
    coverageTypes: ["water", "ice", "electric"],
    hmPriority: { surf: 0, strength: 1 },
  }),
]);

const STARTER_CAPABILITIES = Object.freeze({
  1: Object.freeze({
    fieldCapabilities: Object.freeze(["cut", "strength", "flash", "rockSmash"]),
    types: Object.freeze(["grass", "poison"]),
    coverageTypes: Object.freeze(["grass", "poison"]),
    battleRoles: Object.freeze(["special", "ice-answer", "water-answer"]),
    hmPriority: Object.freeze({ cut: 4, strength: 3, flash: 3 }),
  }),
  4: Object.freeze({
    fieldCapabilities: Object.freeze(["cut", "fly", "strength", "rockSmash"]),
    types: Object.freeze(["fire", "flying"]),
    coverageTypes: Object.freeze(["fire", "flying"]),
    battleRoles: Object.freeze(["special", "ice-answer"]),
    hmPriority: Object.freeze({ cut: 4, fly: 2, strength: 3 }),
  }),
  7: Object.freeze({
    fieldCapabilities: Object.freeze(["surf", "strength", "rockSmash"]),
    types: Object.freeze(["water"]),
    coverageTypes: Object.freeze(["water", "ice"]),
    battleRoles: Object.freeze(["special", "tank"]),
    hmPriority: Object.freeze({ surf: 0, strength: 2 }),
  }),
});

const OPTIMIZED_ACQUISITION_IDS = Object.freeze({
  1: Object.freeze(["fearow", "graveler", "hypno", "snorlax", "lapras"]),
  4: Object.freeze(["primeape", "parasect", "dugtrio", "snorlax", "lapras"]),
  7: Object.freeze(["fearow", "primeape", "nidoran-m", "mr-mime", "snorlax"]),
});

// `legacy-seeded-v1` is checkpoint data, not a live team-building policy. Keep
// both its catalog membership and its viability rules frozen: inserting a new
// acquisition into the current catalog otherwise changes the modulo and maps
// every historical seed to a different permanent roster.
const LEGACY_PERMANENT_ACQUISITION_IDS = Object.freeze([
  "pidgeot",
  "raticate",
  "fearow",
  "primeape",
  "butterfree",
  "beedrill",
  "graveler",
  "golbat",
  "parasect",
  "gloom",
  "persian",
  "dugtrio",
  "hypno",
  "arbok",
  "growlithe",
  "haunter",
  "marowak",
  "dodrio",
  "snorlax",
  "lapras",
]);

const MAJOR_BATTLE_COVERAGE = Object.freeze([
  Object.freeze({ id: "rival-route22-early", types: Object.freeze(["rock", "electric", "ice", "flying"]) }),
  Object.freeze({ id: "badge-boulder", types: Object.freeze(["water", "grass", "fighting", "ground"]) }),
  Object.freeze({ id: "rival-cerulean", types: Object.freeze(["electric", "ice", "rock", "ghost", "bug"]) }),
  Object.freeze({ id: "badge-cascade", types: Object.freeze(["grass", "electric"]) }),
  Object.freeze({ id: "rival-ss-anne", types: Object.freeze(["electric", "ice", "rock", "ghost", "bug"]) }),
  Object.freeze({ id: "badge-thunder", types: Object.freeze(["ground"]) }),
  Object.freeze({ id: "badge-rainbow", types: Object.freeze(["fire", "flying", "ice", "psychic", "bug"]) }),
  Object.freeze({ id: "rocket-hideout-giovanni", types: Object.freeze(["water", "grass", "fighting", "ground"]) }),
  Object.freeze({ id: "rival-pokemon-tower", types: Object.freeze(["electric", "ice", "rock", "ghost", "bug"]) }),
  Object.freeze({ id: "rival-silph", types: Object.freeze(["electric", "ice", "rock", "ghost", "bug"]) }),
  Object.freeze({ id: "silph-liberated", types: Object.freeze(["water", "grass", "ice", "fighting", "ground"]) }),
  Object.freeze({ id: "badge-soul", types: Object.freeze(["psychic", "ground"]) }),
  Object.freeze({ id: "badge-marsh", types: Object.freeze(["ghost", "dark", "bug"]) }),
  Object.freeze({ id: "badge-volcano", types: Object.freeze(["water", "ground", "rock"]) }),
  Object.freeze({ id: "badge-earth", types: Object.freeze(["water", "grass", "ice", "psychic", "ground"]) }),
  Object.freeze({ id: "rival-route22-late", types: Object.freeze(["electric", "ice", "water", "rock", "ghost", "bug"]) }),
  Object.freeze({ id: "elite-four-lorelei", types: Object.freeze(["electric", "fighting", "rock", "grass"]) }),
  Object.freeze({ id: "elite-four-bruno", types: Object.freeze(["water", "grass", "psychic", "flying", "ice"]) }),
  Object.freeze({ id: "elite-four-agatha", types: Object.freeze(["psychic", "ground", "ghost", "dark"]) }),
  Object.freeze({ id: "elite-four-lance", types: Object.freeze(["ice", "electric", "rock", "dragon"]) }),
  Object.freeze({ id: "champion", types: Object.freeze(["electric", "ice", "water", "grass", "fighting", "ground", "ghost", "bug"]) }),
]);

const MAJOR_BATTLE_AVAILABILITY_ORDER = Object.freeze({
  "rival-route22-early": 0,
  "badge-boulder": 1,
  "rival-cerulean": 2,
  "badge-cascade": 3,
  "rival-ss-anne": 4,
  "badge-thunder": 4,
  "badge-rainbow": 5,
  "rocket-hideout-giovanni": 5,
  "rival-pokemon-tower": 5,
  "rival-silph": 7,
  "silph-liberated": 8,
  "badge-soul": 8,
  "badge-marsh": 8,
  "badge-volcano": 8,
  "badge-earth": 8,
  "rival-route22-late": 8,
  "elite-four-lorelei": 8,
  "elite-four-bruno": 8,
  "elite-four-agatha": 8,
  "elite-four-lance": 8,
  champion: 8,
});

function combinations(values, count, start = 0, prefix = [], result = []) {
  if (prefix.length === count) {
    result.push([...prefix]);
    return result;
  }
  for (let index = start; index <= values.length - (count - prefix.length); index += 1) {
    prefix.push(values[index]);
    combinations(values, count, index + 1, prefix, result);
    prefix.pop();
  }
  return result;
}

function starterMember(starter) {
  const profile = STARTER_CAPABILITIES[starter.species];
  return {
    id: `starter-${starter.name.toLowerCase()}`,
    family: starter.family,
    targetSpecies: starter.finalSpecies,
    ...profile,
  };
}

function coversRequiredFieldMoves(members) {
  const capabilities = new Set(
    members.flatMap(({ fieldCapabilities }) => fieldCapabilities ?? []),
  );
  return REQUIRED_FIELD_MOVES.every((move) => capabilities.has(move));
}

function viablePermanentCombination(starter, acquisitions) {
  const members = [starterMember(starter), ...acquisitions];
  if (!coversRequiredFieldMoves(members)) return false;
  if (acquisitions.filter(({ availabilityOrder }) => availabilityOrder <= 1).length < 1) {
    return false;
  }
  if (acquisitions.filter(({ availabilityOrder }) => availabilityOrder <= 4).length < 3) {
    return false;
  }
  if (acquisitions.filter(({ availabilityOrder }) => availabilityOrder <= 7).length < 4) {
    return false;
  }
  const types = new Set(members.flatMap(({ types: memberTypes }) => memberTypes ?? []));
  const roles = new Set(members.flatMap(({ battleRoles }) => battleRoles ?? []));
  if (types.size < 5 || !roles.has("physical") || !roles.has("special")) return false;
  if (!roles.has("ice-answer") || !roles.has("agatha-answer")) return false;
  if (
    starter.species === 4 &&
    !acquisitions.some(({ availabilityOrder, battleRoles }) =>
      availabilityOrder <= 3 && battleRoles.includes("water-answer")
    )
  ) return false;
  const dedicatedFlyers = acquisitions.filter(({ id }) =>
    ["pidgeot", "fearow", "dodrio"].includes(id)
  ).length;
  if (dedicatedFlyers > 1) return false;
  const bugFamilies = acquisitions.filter(({ id }) =>
    ["butterfree", "beedrill", "parasect"].includes(id)
  ).length;
  return bugFamilies <= 1;
}

function legacyViablePermanentCombination(starter, acquisitions) {
  const members = [starterMember(starter), ...acquisitions];
  if (!coversRequiredFieldMoves(members)) return false;
  if (acquisitions.filter(({ availabilityOrder }) => availabilityOrder <= 1).length < 1) {
    return false;
  }
  if (acquisitions.filter(({ availabilityOrder }) => availabilityOrder <= 4).length < 3) {
    return false;
  }
  if (acquisitions.filter(({ availabilityOrder }) => availabilityOrder <= 7).length < 4) {
    return false;
  }
  const types = new Set(members.flatMap(({ types: memberTypes }) => memberTypes ?? []));
  const roles = new Set(members.flatMap(({ battleRoles }) => battleRoles ?? []));
  if (types.size < 5 || !roles.has("physical") || !roles.has("special")) return false;
  if (!roles.has("ice-answer") || !roles.has("agatha-answer")) return false;
  if (
    starter.species === 4 &&
    !acquisitions.some(({ availabilityOrder, battleRoles }) =>
      availabilityOrder <= 3 && battleRoles.includes("water-answer")
    )
  ) return false;
  const dedicatedFlyers = acquisitions.filter(({ id }) =>
    ["pidgeot", "fearow", "dodrio"].includes(id)
  ).length;
  if (dedicatedFlyers > 1) return false;
  const bugFamilies = acquisitions.filter(({ id }) =>
    ["butterfree", "beedrill", "parasect"].includes(id)
  ).length;
  return bugFamilies <= 1;
}

const feasibleTeamCache = new Map();

const legacyAcquisitionCatalog = Object.freeze(LEGACY_PERMANENT_ACQUISITION_IDS.map((id) => {
  const acquisition = PERMANENT_ACQUISITION_CATALOG.find((entry) => entry.id === id);
  if (!acquisition) throw new Error(`legacy permanent acquisition ${id} is missing`);
  return acquisition;
}));

function feasiblePermanentTeams(starter, { legacy = false } = {}) {
  const cacheKey = `${legacy ? "legacy" : "current"}:${starter.species}`;
  if (!feasibleTeamCache.has(cacheKey)) {
    const catalog = legacy ? legacyAcquisitionCatalog : PERMANENT_ACQUISITION_CATALOG;
    const viability = legacy
      ? legacyViablePermanentCombination
      : viablePermanentCombination;
    const teams = combinations(catalog, 5).filter((team) => viability(starter, team));
    if (teams.length === 0) {
      throw new Error(`no viable permanent teams for starter ${starter.name}`);
    }
    feasibleTeamCache.set(cacheKey, teams);
  }
  return feasibleTeamCache.get(cacheKey);
}

function seededTeamIndex(seed, starterSpecies, length) {
  const digest = createHash("sha256")
    .update(`master-red-team:v1:${starterSpecies}:${seed}`)
    .digest();
  return digest.readUInt32LE(0) % length;
}

function acquisitionsForIds(ids) {
  if (!Array.isArray(ids) || ids.length !== 5 || new Set(ids).size !== 5) {
    throw new TypeError("a locked permanent team requires five unique acquisition ids");
  }
  const byId = new Map(PERMANENT_ACQUISITION_CATALOG.map((entry) => [entry.id, entry]));
  const acquisitions = ids.map((id) => byId.get(id));
  if (acquisitions.some((entry) => !entry)) {
    throw new TypeError("a locked permanent team contains an unknown acquisition id");
  }
  return acquisitions;
}

function battlePlansFor(members) {
  return Object.freeze(Object.fromEntries(MAJOR_BATTLE_COVERAGE.map((battle) => {
    const coverage = new Set(battle.types);
    const availabilityOrder = MAJOR_BATTLE_AVAILABILITY_ORDER[battle.id];
    const preferred = [...members].sort((left, right) => {
      const coverageCount = (member) => (member.coverageTypes ?? member.types ?? [])
        .filter((type) => coverage.has(type)).length;
      return coverageCount(right) - coverageCount(left) ||
        Number(left.availabilityOrder ?? -1) - Number(right.availabilityOrder ?? -1) ||
        left.id.localeCompare(right.id);
    });
    return [battle.id, Object.freeze({
      coverageTypes: battle.types,
      preferredFamilies: freezeFamilies(preferred.map(({ family }) => family)),
      availableFamilies: freezeFamilies(members
        .filter((member) =>
          member.id.startsWith("starter-") ||
          Number(member.availabilityOrder) <= availabilityOrder
        )
        .map(({ family }) => family)),
    })];
  })));
}

function chooseFieldMoveFamilies(members) {
  const assignments = new Map(members.map(({ id }) => [id, 0]));
  const result = {};
  for (const move of [...REQUIRED_FIELD_MOVES, "flash", "rockSmash"]) {
    const candidates = members.filter(({ fieldCapabilities }) =>
      fieldCapabilities?.includes(move)
    ).sort((left, right) =>
      Number(left.hmPriority?.[move] ?? 10) - Number(right.hmPriority?.[move] ?? 10) ||
      Number(assignments.get(left.id) ?? 0) - Number(assignments.get(right.id) ?? 0) ||
      left.id.localeCompare(right.id)
    );
    const selected = candidates[0] ?? null;
    result[move] = Object.freeze(selected ? [...selected.family] : []);
    if (selected) assignments.set(selected.id, Number(assignments.get(selected.id)) + 1);
  }
  return Object.freeze(result);
}

export function createMasterTeamPlan(starterSpecies, seed, {
  selection = "starter-optimized-forward-team",
  acquisitionIds = null,
} = {}) {
  const starter = starterForSpecies(starterSpecies);
  if (!starter) {
    throw new TypeError(
      "permanent team plan requires a Bulbasaur, Charmander, or Squirtle family starter",
    );
  }
  const numericSeed = Number(seed);
  if (!Number.isSafeInteger(numericSeed) || numericSeed < 0 || numericSeed > 0xffff_ffff) {
    throw new TypeError("permanent team plan seed must be a 32-bit unsigned integer");
  }
  let selected;
  if (acquisitionIds) {
    selected = acquisitionsForIds(acquisitionIds);
  } else if (selection === "legacy-seeded-v1") {
    const feasibleTeams = feasiblePermanentTeams(starter, { legacy: true });
    selected = feasibleTeams[
      seededTeamIndex(numericSeed, starter.species, feasibleTeams.length)
    ];
  } else if (selection === "starter-optimized-forward-team") {
    selected = acquisitionsForIds(OPTIMIZED_ACQUISITION_IDS[starter.species]);
  } else {
    throw new TypeError(`unknown permanent team selection policy ${selection}`);
  }
  const selectedTeamIsViable = selection === "legacy-seeded-v1"
    ? legacyViablePermanentCombination(starter, selected)
    : viablePermanentCombination(starter, selected);
  if (!selectedTeamIsViable) {
    throw new Error(`permanent team is not forward viable for starter ${starter.name}`);
  }
  selected = [...selected].sort((left, right) =>
    left.availabilityOrder - right.availabilityOrder ||
    PERMANENT_ACQUISITION_CATALOG.indexOf(left) -
      PERMANENT_ACQUISITION_CATALOG.indexOf(right)
  );
  const starterEntry = starterMember(starter);
  const permanentFamilies = freezeFamilies([
    starter.family,
    ...selected.map(({ family }) => family),
  ]);
  return Object.freeze({
    schema: "master-red/permanent-team-plan/v1",
    seed: numericSeed,
    provenance: Object.freeze({
      source: MASTER_TEAM_SOURCE,
      selection,
      tradeEvolutions: false,
      postgameAcquisitions: false,
    }),
    starterFamily: Object.freeze([...starter.family]),
    hallOfFameSpecies: Object.freeze([
      starter.finalSpecies,
      ...selected.map(({ targetSpecies }) => targetSpecies),
    ]),
    permanentFamilies,
    acquisitions: Object.freeze(selected),
    utilityAcquisitions: Object.freeze([]),
    battlePlans: battlePlansFor([starterEntry, ...selected]),
    fieldMoves: chooseFieldMoveFamilies([starterEntry, ...selected]),
    rosterPolicy: Object.freeze({
      lockedAtStart: true,
      allowTemporaryMembers: false,
      requireAllSixInHallOfFame: true,
    }),
    trainingPolicy: Object.freeze({
      forwardOnly: true,
      regionalMasteryBeforeHallOfFame: false,
      acquireExpShareByPokedexGrinding: false,
    }),
    pokedexPolicy: Object.freeze({
      enabled: false,
      opportunisticBallReserve: 0,
      fillOpenPartySlots: false,
      purchasePriority: Object.freeze(["medicine", "poke-balls"]),
    }),
  });
}

export function createMasterTeamPlanForRun(
  starterSpecies,
  seed,
  resumePlayerState = null,
) {
  const persisted = resumePlayerState?.permanentTeamPlan ?? null;
  if (persisted) {
    if (
      persisted.schema !== "master-red/permanent-team-plan/v1" ||
      Number(persisted.seed) !== Number(seed)
    ) {
      throw new Error("checkpoint permanent team does not match this run");
    }
    return createMasterTeamPlan(starterSpecies, seed, {
      selection: persisted.selection,
      acquisitionIds: persisted.acquisitionIds,
    });
  }
  return createMasterTeamPlan(starterSpecies, seed, resumePlayerState
    ? { selection: "legacy-seeded-v1" }
    : undefined);
}

// Legacy v1 recipes, retained ONLY for checkpoint reconstruction and explicit
// library callers. New default campaigns use fire-red-roster.js's generator.
// Keep v1 membership/order stable: checkpoints commit the actual IDs as well.
const COHERENT_SLOTS_V1 = Object.freeze({
  1: [["fearow", "pidgeot"], ["graveler", "dugtrio"], ["hypno", "mr-mime"],
    ["lapras"], ["primeape", "raticate", "snorlax"]],
  4: [["primeape"], ["gloom"], ["fearow", "pidgeot"], ["lapras"], ["hypno", "mr-mime"]],
  7: [["fearow", "pidgeot"], ["gloom"], ["graveler", "dugtrio"], ["hypno", "mr-mime"], ["lapras"]],
});

export function createCoherentTeamPlan(starterSpecies, seed, teamSeed, acquisitionIds = null) {
  const starter = starterForSpecies(starterSpecies);
  if (!starter) throw new TypeError("coherent team requires a Kanto starter");
  const teams = COHERENT_SLOTS_V1[starter.species].reduce(
    (prefixes, slot) => prefixes.flatMap(prefix => slot.map(id => [...prefix, id])), [[]],
  );
  const signature = ids => [...ids].sort().join(",");
  const digest = createHash("sha256").update(`master-red-coherent:v1:${starter.species}:${teamSeed}`).digest();
  const selected = acquisitionIds ?? teams[digest.readUInt32LE(0) % teams.length];
  if (!teams.some(team => signature(team) === signature(selected))) {
    throw new TypeError("checkpoint coherent roster does not match a v1 strategy recipe");
  }
  const plan = createMasterTeamPlan(starter.species, seed, {
    selection: "coherent-forward-v1", acquisitionIds: selected,
  });
  // Do not rank Blastoise as an Ice attacker or Lapras/Mr. Mime as Electric
  // attackers merely because a purchasable TM could eventually teach that move.
  const members = [starterMember(starter), ...plan.acquisitions].map(member => ({
    ...member, coverageTypes: member.types,
  }));
  const battlePlans = Object.freeze(Object.fromEntries(Object.entries(battlePlansFor(members)).map(([id, battle]) => {
    // Both battles share the Vermilion availability band, but the Route 2
    // exchange is Cut-gated: it cannot support the earlier S.S. Anne rival.
    const availableFamilies = battle.availableFamilies.filter(family => id !== "rival-ss-anne" || !family.includes(122));
    return [id, Object.freeze({ ...battle, availableFamilies: freezeFamilies(availableFamilies),
      preferredFamilies: freezeFamilies(battle.preferredFamilies.filter(family =>
        availableFamilies.some(available => available[0] === family[0]))),
    })];
  })));
  return Object.freeze({ ...plan, battlePlans,
    coherence: Object.freeze({
      version: "coherent-forward-v1", candidateCount: teams.length,
      basis: "authored acquisition routes, natural attacks and campaign HMs",
      expensiveTmDependencies: Object.freeze([]),
      externalTradeDependencies: Object.freeze([]),
      limitations: "Bounded recipes; not a battle simulation or autonomous campaign qualification",
    }),
  });
}

export function createOriginsPresetTeamPlan(starterSpecies, seed) {
  const original = createOriginsTeamPlan(starterSpecies);
  const common = createMasterTeamPlan(starterSpecies, seed);
  const starter = starterForSpecies(starterSpecies);
  const availability = { "origins-jolteon": 5, "origins-lapras": 8,
    "origins-scyther": 8, "origins-dodrio": 7, "origins-persian": 4 };
  const types = { "origins-jolteon": ["electric"], "origins-lapras": ["water", "ice"],
    "origins-scyther": ["bug", "flying"], "origins-dodrio": ["normal", "flying"], "origins-persian": ["normal"] };
  const temporaryMembers = [
    ...(starter.species === 4 ? [{ id: "escort-mankey", family: [56, 57], availabilityOrder: 0, types: ["fighting"] }] : []),
    ...(starter.species !== 1 ? [{ id: "escort-oddish", family: [43, 44, 45], availabilityOrder: 3, types: ["grass", "poison"] }] : []),
  ];
  const members = [starterMember(starter), ...original.acquisitions.map(member => ({ ...member,
    availabilityOrder: availability[member.id], types: types[member.id],
  })), ...temporaryMembers];
  const rawPlans = battlePlansFor(members);
  const beforeSafari = new Set(["rival-route22-early", "badge-boulder", "rival-cerulean", "badge-cascade",
    "rival-ss-anne", "badge-thunder", "badge-rainbow", "rocket-hideout-giovanni", "rival-pokemon-tower",
    "rival-silph", "silph-liberated"]);
  const battlePlans = Object.freeze(Object.fromEntries(Object.entries(rawPlans).map(([id, plan]) => {
    const permitted = family => beforeSafari.has(id) ? !family.includes(123)
      : !temporaryMembers.some(member => member.family[0] === family[0]);
    const availableFamilies = plan.availableFamilies.filter(permitted);
    return [id, Object.freeze({ ...plan, availableFamilies: freezeFamilies(availableFamilies),
      preferredFamilies: freezeFamilies(plan.preferredFamilies.filter(family =>
        availableFamilies.some(available => available[0] === family[0]))),
    })];
  })));
  return Object.freeze({ ...original, seed,
    provenance: Object.freeze({ ...original.provenance, selection: "origins-preset-v1" }),
    permanentFamilies: freezeFamilies([original.starterFamily, ...original.acquisitions.map(x => x.family)]),
    battlePlans,
    rosterPolicy: Object.freeze({ ...common.rosterPolicy, allowTemporaryMembers: true }),
    trainingPolicy: common.trainingPolicy,
    pokedexPolicy: common.pokedexPolicy,
  });
}
