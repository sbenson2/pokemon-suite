const freeze = value => Object.freeze(value);
const freezePlan = members => freeze(members.map(member => freeze(member)));

export const SOURCE_AUTHORITY = freeze({
  pokeemeraldCommit: '5eff78649e7170a877b961ef0b3da13b81a16038',
  symbolsCommit: 'dba968c67d85caf9595abe12a51ff739d4dc5937',
  wildEncounters: 'vendor/pokeemerald/src/data/wild_encounters.json',
  trainers: 'vendor/pokeemerald/include/constants/opponents.h',
});

export const EMERALD_PROFILE = freeze({
  game: 'Pokemon Emerald Version (U)',
  rom: freeze({ sha1: 'f3ae088181bf583e55daf962a92bb46f4f1d07b7', byteLength: 16_777_216, mutable: false }),
  gameplayPolicy: freeze({ cheats: false, exploits: false, romWrites: false }),
  primaryGoal: freeze({ name: 'first-hall-of-fame', inGameHours: 30 }),
  stretchGoal: freeze({ name: 'first-hall-of-fame', inGameHours: 24 }),
  playerGenderDistribution: freeze({ MALE: 1 / 2, FEMALE: 1 / 2 }),
  starterDistribution: freeze({ TREECKO: 1 / 3, TORCHIC: 1 / 3, MUDKIP: 1 / 3 }),
  trainingPolicy: freeze({ trainBeforeEveryBoss: true, direction: 'forward-local', rematches: 'complete-active-before-leaving' }),
});

export function choosePlayerGender(uniformBit) {
  if (uniformBit !== 0 && uniformBit !== 1) throw new RangeError('choosePlayerGender requires a uniform bit (0 or 1)');
  return uniformBit === 0 ? 'MALE' : 'FEMALE';
}

export function chooseStarter(uniformTernaryTicket) {
  const starters = ['TREECKO', 'TORCHIC', 'MUDKIP'];
  if (!Number.isInteger(uniformTernaryTicket) || uniformTernaryTicket < 0 || uniformTernaryTicket >= starters.length) throw new RangeError('chooseStarter requires a uniform ternary ticket (0, 1, or 2)');
  return starters[uniformTernaryTicket];
}

const member = ({ species, types, encounter, role, sourceEvidence, sourceMap, sourceSpecies, acquisitionStage, evolutionStage = acquisitionStage, evolutionTarget = species, evolutionSourceSpecies = sourceSpecies, evolutionEvidence, bossCoverage, bossPartySymbol }) => ({
  species,
  finalSpecies: evolutionTarget,
  evolutionTarget,
  types,
  typeEvidence: `src/data/pokemon/species_info.h SPECIES_${evolutionTarget}`,
  encounter,
  role,
  obtainableBeforeEliteFour: true,
  tradeRequired: false,
  forwardLocal: true,
  acquisitionStage,
  evolutionStage,
  sourceEvidence,
  sourceMap,
  sourceSpecies,
  evolutionSourceSpecies,
  evolutionEvidence,
  bossCoverage,
  bossPartySymbol,
  bossEvidence: `src/data/trainer_parties.h ${bossPartySymbol}`,
});

const starter = (species, target, types, role, bossCoverage, bossPartySymbol) => member({
  species: target,
  types,
  encounter: `starter: ${species} evolves to ${target} by level 36`,
  role,
  sourceEvidence: 'starter',
  sourceMap: 'STARTER',
  sourceSpecies: `SPECIES_${species}`,
  evolutionTarget: target,
  evolutionSourceSpecies: `SPECIES_${species}`,
  evolutionEvidence: `src/data/pokemon/evolution.h SPECIES_${species}`,
  acquisitionStage: 0,
  evolutionStage: 2,
  bossCoverage,
  bossPartySymbol,
});

export const STARTER_TEAM_PLANS = freeze({
  TREECKO: freezePlan([
    starter('TREECKO', 'SCEPTILE', ['GRASS'], 'special Water-breaker', ['JUAN', 'WALLACE'], 'sParty_Wallace'),
    member({ species: 'HARIYAMA', types: ['FIGHTING'], encounter: 'Granite Cave: catch Makuhita; evolve at level 24', role: 'physical Dark/Ice breaker', sourceEvidence: 'src/data/wild_encounters.json MAP_GRANITE_CAVE_1F SPECIES_MAKUHITA', sourceMap: 'MAP_GRANITE_CAVE_1F', sourceSpecies: 'SPECIES_MAKUHITA', acquisitionStage: 1, evolutionStage: 2, evolutionEvidence: 'src/data/pokemon/evolution.h SPECIES_MAKUHITA', bossCoverage: ['ELITE_FOUR'], bossPartySymbol: 'sParty_Sidney' }),
    member({ species: 'MANECTRIC', types: ['ELECTRIC'], encounter: 'Route 110: catch Electrike; evolve at level 26', role: 'fast Water/Flying breaker', sourceEvidence: 'src/data/wild_encounters.json MAP_ROUTE110 SPECIES_ELECTRIKE', sourceMap: 'MAP_ROUTE110', sourceSpecies: 'SPECIES_ELECTRIKE', acquisitionStage: 2, evolutionStage: 3, evolutionEvidence: 'src/data/pokemon/evolution.h SPECIES_ELECTRIKE', bossCoverage: ['JUAN', 'WALLACE'], bossPartySymbol: 'sParty_Wallace' }),
    member({ species: 'SHARPEDO', types: ['WATER', 'DARK'], encounter: 'Route 118: catch Carvanha; evolve at level 30', role: 'Ghost/Psychic cleaner', sourceEvidence: 'src/data/wild_encounters.json MAP_ROUTE118 SPECIES_CARVANHA', sourceMap: 'MAP_ROUTE118', sourceSpecies: 'SPECIES_CARVANHA', acquisitionStage: 6, evolutionStage: 6, evolutionEvidence: 'src/data/pokemon/evolution.h SPECIES_CARVANHA', bossCoverage: ['TATE_AND_LIZA', 'ELITE_FOUR'], bossPartySymbol: 'sParty_Phoebe' }),
    member({ species: 'TORKOAL', types: ['FIRE'], encounter: 'Fiery Path: catch Torkoal', role: 'Ice-specialist wallbreaker', sourceEvidence: 'src/data/wild_encounters.json MAP_FIERY_PATH SPECIES_TORKOAL', sourceMap: 'MAP_FIERY_PATH', sourceSpecies: 'SPECIES_TORKOAL', acquisitionStage: 3, evolutionEvidence: 'src/data/wild_encounters.json (final species)', bossCoverage: ['ELITE_FOUR'], bossPartySymbol: 'sParty_Glacia' }),
    member({ species: 'FLYGON', types: ['GROUND', 'DRAGON'], encounter: 'Route 111 Desert: catch Trapinch; evolve at levels 35 and 45', role: 'Rock/Psychic and Dragon answer', sourceEvidence: 'src/data/wild_encounters.json MAP_ROUTE111 SPECIES_TRAPINCH', sourceMap: 'MAP_ROUTE111', sourceSpecies: 'SPECIES_TRAPINCH', acquisitionStage: 4, evolutionStage: 5, evolutionEvidence: 'src/data/pokemon/evolution.h SPECIES_TRAPINCH', bossCoverage: ['TATE_AND_LIZA', 'ELITE_FOUR'], bossPartySymbol: 'sParty_TateAndLiza1' }),
  ]),
  TORCHIC: freezePlan([
    starter('TORCHIC', 'BLAZIKEN', ['FIRE', 'FIGHTING'], 'Dark/Ice physical breaker', ['ELITE_FOUR'], 'sParty_Sidney'),
    member({ species: 'LUDICOLO', types: ['WATER', 'GRASS'], encounter: 'Route 114: catch Lombre; use a Route 124 Water Stone', role: 'Water-resistant Water-breaker', sourceEvidence: 'src/data/wild_encounters.json MAP_ROUTE114 SPECIES_LOMBRE; data/maps/Route124_DivingTreasureHuntersHouse/scripts.inc ITEM_WATER_STONE', sourceMap: 'MAP_ROUTE114', sourceSpecies: 'SPECIES_LOMBRE', acquisitionStage: 4, evolutionStage: 7, evolutionEvidence: 'src/data/pokemon/evolution.h SPECIES_LOMBRE', bossCoverage: ['JUAN', 'WALLACE'], bossPartySymbol: 'sParty_Wallace' }),
    member({ species: 'MANECTRIC', types: ['ELECTRIC'], encounter: 'Route 110: catch Electrike; evolve at level 26', role: 'fast Water/Flying breaker', sourceEvidence: 'src/data/wild_encounters.json MAP_ROUTE110 SPECIES_ELECTRIKE', sourceMap: 'MAP_ROUTE110', sourceSpecies: 'SPECIES_ELECTRIKE', acquisitionStage: 2, evolutionStage: 3, evolutionEvidence: 'src/data/pokemon/evolution.h SPECIES_ELECTRIKE', bossCoverage: ['JUAN', 'WALLACE'], bossPartySymbol: 'sParty_Wallace' }),
    member({ species: 'CROBAT', types: ['POISON', 'FLYING'], encounter: 'Granite Cave: catch Zubat; evolve Golbat by friendship', role: 'fast Fighting/Ground pivot', sourceEvidence: 'src/data/wild_encounters.json MAP_GRANITE_CAVE_1F SPECIES_ZUBAT', sourceMap: 'MAP_GRANITE_CAVE_1F', sourceSpecies: 'SPECIES_ZUBAT', acquisitionStage: 1, evolutionStage: 4, evolutionEvidence: 'src/data/pokemon/evolution.h SPECIES_ZUBAT and SPECIES_GOLBAT', bossCoverage: ['TATE_AND_LIZA'], bossPartySymbol: 'sParty_TateAndLiza1' }),
    member({ species: 'ABSOL', types: ['DARK'], encounter: 'Route 120: catch Absol', role: 'dedicated Ghost/Psychic cleaner', sourceEvidence: 'src/data/wild_encounters.json MAP_ROUTE120 SPECIES_ABSOL', sourceMap: 'MAP_ROUTE120', sourceSpecies: 'SPECIES_ABSOL', acquisitionStage: 6, evolutionEvidence: 'src/data/wild_encounters.json (final species)', bossCoverage: ['TATE_AND_LIZA', 'ELITE_FOUR'], bossPartySymbol: 'sParty_Phoebe' }),
    member({ species: 'FLYGON', types: ['GROUND', 'DRAGON'], encounter: 'Route 111 Desert: catch Trapinch; evolve at levels 35 and 45', role: 'Rock/Psychic and Dragon answer', sourceEvidence: 'src/data/wild_encounters.json MAP_ROUTE111 SPECIES_TRAPINCH', sourceMap: 'MAP_ROUTE111', sourceSpecies: 'SPECIES_TRAPINCH', acquisitionStage: 4, evolutionStage: 5, evolutionEvidence: 'src/data/pokemon/evolution.h SPECIES_TRAPINCH', bossCoverage: ['TATE_AND_LIZA', 'ELITE_FOUR'], bossPartySymbol: 'sParty_Drake' }),
  ]),
  MUDKIP: freezePlan([
    starter('MUDKIP', 'SWAMPERT', ['WATER', 'GROUND'], 'bulky Rock/Psychic answer', ['TATE_AND_LIZA'], 'sParty_TateAndLiza1'),
    member({ species: 'BRELOOM', types: ['GRASS', 'FIGHTING'], encounter: 'Petalburg Woods: catch Shroomish; evolve at level 23', role: 'Water/Dark physical breaker', sourceEvidence: 'src/data/wild_encounters.json MAP_PETALBURG_WOODS SPECIES_SHROOMISH', sourceMap: 'MAP_PETALBURG_WOODS', sourceSpecies: 'SPECIES_SHROOMISH', acquisitionStage: 1, evolutionStage: 2, evolutionEvidence: 'src/data/pokemon/evolution.h SPECIES_SHROOMISH', bossCoverage: ['JUAN', 'ELITE_FOUR', 'WALLACE'], bossPartySymbol: 'sParty_Sidney' }),
    member({ species: 'MANECTRIC', types: ['ELECTRIC'], encounter: 'Route 110: catch Electrike; evolve at level 26', role: 'fast Water/Flying breaker', sourceEvidence: 'src/data/wild_encounters.json MAP_ROUTE110 SPECIES_ELECTRIKE', sourceMap: 'MAP_ROUTE110', sourceSpecies: 'SPECIES_ELECTRIKE', acquisitionStage: 2, evolutionStage: 3, evolutionEvidence: 'src/data/pokemon/evolution.h SPECIES_ELECTRIKE', bossCoverage: ['JUAN', 'WALLACE'], bossPartySymbol: 'sParty_Wallace' }),
    member({ species: 'TORKOAL', types: ['FIRE'], encounter: 'Fiery Path: catch Torkoal', role: 'Ice-specialist wallbreaker', sourceEvidence: 'src/data/wild_encounters.json MAP_FIERY_PATH SPECIES_TORKOAL', sourceMap: 'MAP_FIERY_PATH', sourceSpecies: 'SPECIES_TORKOAL', acquisitionStage: 3, evolutionEvidence: 'src/data/wild_encounters.json (final species)', bossCoverage: ['ELITE_FOUR'], bossPartySymbol: 'sParty_Glacia' }),
    member({ species: 'ABSOL', types: ['DARK'], encounter: 'Route 120: catch Absol', role: 'dedicated Ghost/Psychic cleaner', sourceEvidence: 'src/data/wild_encounters.json MAP_ROUTE120 SPECIES_ABSOL', sourceMap: 'MAP_ROUTE120', sourceSpecies: 'SPECIES_ABSOL', acquisitionStage: 6, evolutionEvidence: 'src/data/wild_encounters.json (final species)', bossCoverage: ['TATE_AND_LIZA', 'ELITE_FOUR'], bossPartySymbol: 'sParty_Phoebe' }),
    member({ species: 'ALTARIA', types: ['DRAGON', 'FLYING'], encounter: 'Route 114: catch Swablu; evolve at level 35', role: 'Dragon endgame answer', sourceEvidence: 'src/data/wild_encounters.json MAP_ROUTE114 SPECIES_SWABLU', sourceMap: 'MAP_ROUTE114', sourceSpecies: 'SPECIES_SWABLU', acquisitionStage: 4, evolutionStage: 5, evolutionEvidence: 'src/data/pokemon/evolution.h SPECIES_SWABLU', bossCoverage: ['ELITE_FOUR'], bossPartySymbol: 'sParty_Drake' }),
  ]),
});

export function getStarterTeam(starter) {
  const team = STARTER_TEAM_PLANS[starter];
  if (!team) throw new RangeError(`Unknown Emerald starter: ${starter}`);
  return team;
}

const boss = (id, kind, trainerSymbol, label, trainerSymbols = [trainerSymbol]) => freeze({ id, kind, trainerSymbol, trainerSymbols: freeze(trainerSymbols), label, trainBefore: true, trainingDirection: 'forward-local', rematchBatchPolicy: 'complete-active-before-leaving' });
const rivalSymbols = (route, starter) => [`TRAINER_BRENDAN_${route}_${starter}`, `TRAINER_MAY_${route}_${starter}`];

export const MANDATORY_BOSS_MILESTONES = freeze([
  boss('rival-route-103', 'rival', 'TRAINER_BRENDAN_ROUTE_103_MUDKIP', 'Route 103 rival', ['TRAINER_BRENDAN_ROUTE_103_MUDKIP', 'TRAINER_BRENDAN_ROUTE_103_TREECKO', 'TRAINER_BRENDAN_ROUTE_103_TORCHIC', 'TRAINER_MAY_ROUTE_103_MUDKIP', 'TRAINER_MAY_ROUTE_103_TREECKO', 'TRAINER_MAY_ROUTE_103_TORCHIC']),
  boss('roxanne', 'gym', 'TRAINER_ROXANNE_1', 'Rustboro Gym: Roxanne'),
  boss('aqua-petalburg-and-rusturf', 'team-aqua', 'TRAINER_GRUNT_PETALBURG_WOODS', 'Team Aqua: Petalburg Woods and Rusturf Tunnel', ['TRAINER_GRUNT_PETALBURG_WOODS', 'TRAINER_GRUNT_RUSTURF_TUNNEL']),
  boss('rival-rustboro', 'rival', 'TRAINER_BRENDAN_RUSTBORO_MUDKIP', 'Rustboro rival', ['TRAINER_BRENDAN_RUSTBORO_MUDKIP', 'TRAINER_BRENDAN_RUSTBORO_TREECKO', 'TRAINER_BRENDAN_RUSTBORO_TORCHIC', 'TRAINER_MAY_RUSTBORO_MUDKIP', 'TRAINER_MAY_RUSTBORO_TREECKO', 'TRAINER_MAY_RUSTBORO_TORCHIC']),
  boss('brawly', 'gym', 'TRAINER_BRAWLY_1', 'Dewford Gym: Brawly'),
  boss('aqua-slateport-museum', 'team-aqua', 'TRAINER_GRUNT_MUSEUM_1', 'Team Aqua: Slateport Museum', ['TRAINER_GRUNT_MUSEUM_1', 'TRAINER_GRUNT_MUSEUM_2']),
  boss('rival-route-110', 'rival', 'TRAINER_BRENDAN_ROUTE_110_MUDKIP', 'Route 110 rival', ['TRAINER_BRENDAN_ROUTE_110_MUDKIP', 'TRAINER_BRENDAN_ROUTE_110_TREECKO', 'TRAINER_BRENDAN_ROUTE_110_TORCHIC', 'TRAINER_MAY_ROUTE_110_MUDKIP', 'TRAINER_MAY_ROUTE_110_TREECKO', 'TRAINER_MAY_ROUTE_110_TORCHIC']),
  boss('wattson', 'gym', 'TRAINER_WATTSON_1', 'Mauville Gym: Wattson'),
  boss('magma-mt-chimney', 'team-magma', 'TRAINER_TABITHA_MT_CHIMNEY', 'Team Magma: Mt. Chimney', ['TRAINER_TABITHA_MT_CHIMNEY', 'TRAINER_MAXIE_MT_CHIMNEY']),
  boss('flannery', 'gym', 'TRAINER_FLANNERY_1', 'Lavaridge Gym: Flannery'),
  boss('norman', 'gym', 'TRAINER_NORMAN_1', 'Petalburg Gym: Norman'),
  boss('rival-route-119', 'rival', 'TRAINER_BRENDAN_ROUTE_119_MUDKIP', 'Route 119 rival', ['TRAINER_BRENDAN_ROUTE_119_MUDKIP', 'TRAINER_BRENDAN_ROUTE_119_TREECKO', 'TRAINER_BRENDAN_ROUTE_119_TORCHIC', 'TRAINER_MAY_ROUTE_119_MUDKIP', 'TRAINER_MAY_ROUTE_119_TREECKO', 'TRAINER_MAY_ROUTE_119_TORCHIC']),
  boss('aqua-weather-institute', 'team-aqua', 'TRAINER_SHELLY_WEATHER_INSTITUTE', 'Team Aqua: Weather Institute', ['TRAINER_GRUNT_WEATHER_INST_1', 'TRAINER_GRUNT_WEATHER_INST_2', 'TRAINER_GRUNT_WEATHER_INST_3', 'TRAINER_GRUNT_WEATHER_INST_4', 'TRAINER_SHELLY_WEATHER_INSTITUTE']),
  boss('winona', 'gym', 'TRAINER_WINONA_1', 'Fortree Gym: Winona'),
  boss('rival-lilycove', 'rival', 'TRAINER_BRENDAN_LILYCOVE_MUDKIP', 'Lilycove rival', ['TRAINER_BRENDAN_LILYCOVE_MUDKIP', 'TRAINER_BRENDAN_LILYCOVE_TREECKO', 'TRAINER_BRENDAN_LILYCOVE_TORCHIC', 'TRAINER_MAY_LILYCOVE_MUDKIP', 'TRAINER_MAY_LILYCOVE_TREECKO', 'TRAINER_MAY_LILYCOVE_TORCHIC']),
  boss('aqua-mt-pyre-and-hideout', 'team-aqua', 'TRAINER_GRUNT_MT_PYRE_1', 'Team Aqua: Mt. Pyre and Aqua Hideout', ['TRAINER_GRUNT_MT_PYRE_1', 'TRAINER_GRUNT_MT_PYRE_2', 'TRAINER_GRUNT_MT_PYRE_3', 'TRAINER_GRUNT_AQUA_HIDEOUT_1', 'TRAINER_GRUNT_AQUA_HIDEOUT_2', 'TRAINER_GRUNT_AQUA_HIDEOUT_3', 'TRAINER_GRUNT_AQUA_HIDEOUT_4', 'TRAINER_GRUNT_AQUA_HIDEOUT_5', 'TRAINER_GRUNT_AQUA_HIDEOUT_6', 'TRAINER_MATT']),
  boss('magma-hideout', 'team-magma', 'TRAINER_TABITHA_MAGMA_HIDEOUT', 'Team Magma: Magma Hideout', ['TRAINER_TABITHA_MAGMA_HIDEOUT', 'TRAINER_MAXIE_MAGMA_HIDEOUT']),
  boss('tate-and-liza', 'gym', 'TRAINER_TATE_AND_LIZA_1', 'Mossdeep Gym: Tate and Liza'),
  boss('magma-space-center', 'team-magma', 'TRAINER_TABITHA_MOSSDEEP', 'Team Magma: Mossdeep Space Center', ['TRAINER_GRUNT_SPACE_CENTER_1', 'TRAINER_GRUNT_SPACE_CENTER_2', 'TRAINER_TABITHA_MOSSDEEP', 'TRAINER_MAXIE_MOSSDEEP']),
  boss('aqua-seafloor-cavern', 'team-aqua', 'TRAINER_SHELLY_SEAFLOOR_CAVERN', 'Team Aqua: Seafloor Cavern', ['TRAINER_GRUNT_SEAFLOOR_CAVERN_1', 'TRAINER_GRUNT_SEAFLOOR_CAVERN_2', 'TRAINER_GRUNT_SEAFLOOR_CAVERN_3', 'TRAINER_GRUNT_SEAFLOOR_CAVERN_4', 'TRAINER_SHELLY_SEAFLOOR_CAVERN', 'TRAINER_ARCHIE']),
  boss('juan', 'gym', 'TRAINER_JUAN_1', 'Sootopolis Gym: Juan'),
  boss('wally-victory-road', 'rival', 'TRAINER_WALLY_VR_1', 'Victory Road: Wally', ['TRAINER_WALLY_VR_1', 'TRAINER_WALLY_VR_2', 'TRAINER_WALLY_VR_3', 'TRAINER_WALLY_VR_4', 'TRAINER_WALLY_VR_5']),
  boss('sidney', 'elite-four', 'TRAINER_SIDNEY', 'Elite Four: Sidney'),
  boss('phoebe', 'elite-four', 'TRAINER_PHOEBE', 'Elite Four: Phoebe'),
  boss('glacia', 'elite-four', 'TRAINER_GLACIA', 'Elite Four: Glacia'),
  boss('drake', 'elite-four', 'TRAINER_DRAKE', 'Elite Four: Drake'),
  boss('wallace', 'champion', 'TRAINER_WALLACE', 'Champion: Wallace'),
]);
