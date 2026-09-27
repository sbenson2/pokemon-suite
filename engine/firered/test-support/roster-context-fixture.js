// Small synthetic cartridge-fact shape. This is not a distributed ROM table.
export function rosterContextFixture() {
  const species = {};
  const types = ["TYPE_GRASS", "TYPE_WATER", "TYPE_FIRE", "TYPE_NORMAL", "TYPE_PSYCHIC", "TYPE_ELECTRIC"];
  for (let id = 1; id <= 151; id++) species[id] = { id, name: `SPECIES_FIXTURE_${id}`,
    types: [types[id % types.length]], abilities: ["ABILITY_NONE"],
    baseHP: 70, baseAttack: 70, baseDefense: 70, baseSpAttack: 70, baseSpDefense: 70, baseSpeed: 70,
    levelUpMoves: [{ level: 1, moveId: 1 }, { level: 8, moveId: 55 }], evolutions: [],
    fieldCapabilities: id % 3 === 0 ? ["cut", "fly", "strength"] : ["surf", "strength", "flash"] };
  species[25].evolutions = [{ method: 7, parameter: 96, targetSpecies: 26 }];
  species[63].evolutions = [{ method: 4, parameter: 16, targetSpecies: 64 }];
  species[64].evolutions = [{ method: 5, parameter: 0, targetSpecies: 65 }];
  const locations = [
    ["MAP_ROUTE1", [16, 19, 21, 56]], ["MAP_VIRIDIAN_FOREST", [10, 13, 25]],
    ["MAP_ROUTE3", [35, 39, 32]], ["MAP_ROUTE24", [43, 63]],
    ["MAP_ROUTE11", [23, 50, 54, 96]], ["MAP_ROCK_TUNNEL_1F", [66, 74, 95]],
    ["MAP_SAFARI_ZONE_CENTER", [48, 102, 111, 113, 115, 123, 128]],
    ["MAP_POKEMON_MANSION_1F", [88, 109, 132]],
    ["MAP_CERULEAN_CAVE_1F", [150]], ["MAP_SEVEN_ISLAND_SEVAULT_CANYON", [127]],
  ];
  const world = { maps: locations.map(([id]) => ({ id, objectEvents: [], backgroundEvents: [],
    layout: { width: 2, height: 1, cells: [{ x: 0, y: 0, collision: 0, encounterType: 1 },
      { x: 1, y: 0, collision: 0, encounterType: 1 }] } })),
  wildEncounters: locations.map(([map, ids]) => ({ map, land_mons: { encounter_rate: 20,
    mons: ids.map(id => ({ species: species[id].name, min_level: 5, max_level: 10 })) } })) };
  const moves = { 1: { id: 1, name: "MOVE_FIXTURE_PHYSICAL", power: 60, accuracy: 100, type: "TYPE_NORMAL" },
    55: { id: 55, name: "MOVE_FIXTURE_SPECIAL", power: 50, accuracy: 100, type: "TYPE_WATER" },
    15: { id: 15, power: 50, accuracy: 95, type: "TYPE_NORMAL" }, 19: { id: 19, power: 70, accuracy: 95, type: "TYPE_FLYING" },
    57: { id: 57, power: 95, accuracy: 100, type: "TYPE_WATER" }, 70: { id: 70, power: 80, accuracy: 100, type: "TYPE_NORMAL" } };
  const facts = { schema: "master-red/firered-roster-facts/v1", cartridgeSha1: "1".repeat(40), species, moves, typeChart: [],
    constants: { EVO_LEVEL: { value: 4 }, EVO_ITEM: { value: 7 } } };
  return { world, story: { symbols: {}, scripts: [] }, mechanics: { species, moves, trainers: [] }, facts };
}
