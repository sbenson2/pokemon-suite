import { loadCrystalWorld } from './world/source.mjs';
import { loadCrystalKnowledge } from './knowledge.mjs';
import { createCrystalObserver } from './observer.mjs';
import { drive } from './player/locomotion.mjs';
import { travelTo } from './player/navigation.mjs';

const freeze = (value) => {
  if (value && typeof value === 'object' && !Object.isFrozen(value)) {
    for (const child of Object.values(value)) freeze(child);
    Object.freeze(value);
  }
  return value;
};

const source = {
  repository: 'vendor/pokecrystal',
  commit: '7a7881d0d62e0ddbd82dcf10e7116807487ac651',
};

const encounter = (location, sourceFile, terms, routePolicy = 'FORWARD_LOCAL') => freeze({
  location,
  routePolicy,
  source: { ...source, file: sourceFile, terms },
});

const evidence = (file, terms) => freeze({ ...source, file, terms });

const member = (species, acquisition, profile) => freeze({
  species,
  preEliteFour: true,
  requiresTrade: false,
  acquisition,
  ...profile,
});

const planMember = (species, acquisition, role, battleTypes, stage, evolution, roleSource) => member(species, {
  ...acquisition,
  stage,
}, { role, battleTypes, evolution, roleSource });

const starter = (species, profile) => planMember(
  species,
  encounter('ELMS_LAB', 'maps/ElmsLab.asm', [`givepoke ${species}`]),
  profile.role, profile.battleTypes, 'STARTER', profile.evolution, profile.roleSource,
);
const magnemite = () => planMember('MAGNEMITE', encounter('ROUTE_38', 'data/wild/johto_grass.asm', ['ROUTE_38', 'MAGNEMITE']), 'ELECTRIC_STEEL_SPECIALIST', ['ELECTRIC', 'STEEL'], 'MIDGAME', { target: 'MAGNETON', method: 'LEVEL_30', source: evidence('data/pokemon/evos_attacks.asm', ['MagnemiteEvosAttacks:', 'EVOLVE_LEVEL, 30, MAGNETON']) }, evidence('data/pokemon/base_stats/magneton.asm', ['MAGNETON', 'ELECTRIC, STEEL']));
const zubat = () => planMember('ZUBAT', encounter('DARK_CAVE_VIOLET_ENTRANCE', 'data/wild/johto_grass.asm', ['DARK_CAVE_VIOLET_ENTRANCE', 'ZUBAT']), 'FLYING_SPEED_UTILITY', ['POISON', 'FLYING'], 'EARLY', { target: 'CROBAT', method: 'LEVEL_22_THEN_HAPPINESS', source: evidence('data/pokemon/evos_attacks.asm', ['ZubatEvosAttacks:', 'EVOLVE_LEVEL, 22, GOLBAT', 'GolbatEvosAttacks:', 'EVOLVE_HAPPINESS, TR_ANYTIME, CROBAT']) }, evidence('data/pokemon/base_stats/crobat.asm', ['CROBAT', 'POISON, FLYING']));
const heracross = () => planMember('HERACROSS', encounter('AZALEA_TOWN_HEADBUTT', 'data/wild/treemons.asm', ['TreeMonSet_Town', 'HERACROSS']), 'FIGHTING_PHYSICAL_BREAKER', ['BUG', 'FIGHTING'], 'EARLY', { target: 'HERACROSS', method: 'NO_EVOLUTION', source: evidence('data/pokemon/base_stats/heracross.asm', ['HERACROSS']) }, evidence('data/pokemon/base_stats/heracross.asm', ['HERACROSS', 'BUG, FIGHTING']));
const wooper = () => planMember('WOOPER', encounter('ROUTE_32_NIGHT', 'data/wild/johto_grass.asm', ['ROUTE_32', 'WOOPER']), 'WATER_GROUND_BULKY_ICE_COVERAGE', ['WATER', 'GROUND'], 'EARLY', { target: 'QUAGSIRE', method: 'LEVEL_20', source: evidence('data/pokemon/evos_attacks.asm', ['WooperEvosAttacks:', 'EVOLVE_LEVEL, 20, QUAGSIRE']) }, evidence('data/pokemon/base_stats/quagsire.asm', ['QUAGSIRE', 'WATER, GROUND', 'ICE_PUNCH']));
const abra = () => planMember('ABRA', encounter('ROUTE_34', 'data/wild/johto_grass.asm', ['ROUTE_34', 'ABRA']), 'PSYCHIC_SPECIALIST', ['PSYCHIC'], 'EARLY', { target: 'KADABRA', method: 'LEVEL_16_NO_TRADE_EVOLUTION', source: evidence('data/pokemon/evos_attacks.asm', ['AbraEvosAttacks:', 'EVOLVE_LEVEL, 16, KADABRA', 'KadabraEvosAttacks:', 'EVOLVE_TRADE, -1, ALAKAZAM']) }, evidence('data/pokemon/base_stats/kadabra.asm', ['KADABRA', 'PSYCHIC_TYPE']));
const growlithe = () => planMember('GROWLITHE', encounter('ROUTE_35', 'data/wild/johto_grass.asm', ['ROUTE_35', 'GROWLITHE']), 'FIRE_PHYSICAL_ATTACKER', ['FIRE'], 'MIDGAME', { target: 'GROWLITHE', method: 'RETAIN_NO_NONDETERMINISTIC_FIRE_STONE', source: evidence('data/pokemon/evos_attacks.asm', ['GrowlitheEvosAttacks:', 'EVOLVE_ITEM, FIRE_STONE, ARCANINE']) }, evidence('data/pokemon/base_stats/growlithe.asm', ['GROWLITHE', 'FIRE, FIRE']));

// Reform P1-3 (games/crystal/player/team-score.mjs): members chosen by the
// cartridge-data scorer — two free fixed encounters, three common grass finds,
// every evolution by level. Selected per fresh run with --team-plan v2.
const geodude = () => planMember('GEODUDE', encounter('UNION_CAVE_1F', 'data/wild/johto_grass.asm', ['UNION_CAVE_1F', 'GEODUDE']), 'ROCK_GROUND_PHYSICAL_WALL', ['ROCK'], 'EARLY', { target: 'GRAVELER', method: 'LEVEL_25', source: evidence('data/pokemon/evos_attacks.asm', ['GeodudeEvosAttacks:', 'EVOLVE_LEVEL, 25, GRAVELER']) }, evidence('data/pokemon/base_stats/graveler.asm', ['GRAVELER', 'ROCK, GROUND']));
const sudowoodo = () => planMember('SUDOWOODO', encounter('ROUTE_36', 'maps/Route36.asm', ['loadwildmon SUDOWOODO, 20']), 'ROCK_FIXED_ENCOUNTER_BREAKER', ['ROCK_SLIDE'], 'MIDGAME', { target: 'SUDOWOODO', method: 'NO_EVOLUTION', source: evidence('data/pokemon/base_stats/sudowoodo.asm', ['SUDOWOODO']) }, evidence('data/pokemon/base_stats/sudowoodo.asm', ['SUDOWOODO', 'ROCK, ROCK']));
const gyarados = () => planMember('GYARADOS', encounter('LAKE_OF_RAGE', 'maps/LakeOfRage.asm', ['loadwildmon GYARADOS, 30']), 'WATER_FLYING_PHYSICAL_SWEEPER', ['WATER', 'FLYING'], 'MIDGAME', { target: 'GYARADOS', method: 'NO_EVOLUTION', source: evidence('data/pokemon/base_stats/gyarados.asm', ['GYARADOS']) }, evidence('data/pokemon/base_stats/gyarados.asm', ['GYARADOS', 'WATER, FLYING']));
const slowpoke = () => planMember('SLOWPOKE', encounter('SLOWPOKE_WELL_B1F', 'data/wild/johto_grass.asm', ['SLOWPOKE_WELL_B1F', 'SLOWPOKE']), 'WATER_PSYCHIC_SPECIAL_TANK', ['PSYCHIC'], 'EARLY', { target: 'SLOWBRO', method: 'LEVEL_37', source: evidence('data/pokemon/evos_attacks.asm', ['SlowpokeEvosAttacks:', 'EVOLVE_LEVEL, 37, SLOWBRO']) }, evidence('data/pokemon/base_stats/slowbro.asm', ['SLOWBRO', 'WATER, PSYCHIC_TYPE']));

const STARTER_PROFILES = freeze({
  CHIKORITA: { role: 'GRASS_DEFENSIVE_STATUS', battleTypes: ['GRASS'], evolution: { target: 'MEGANIUM', method: 'LEVEL_16_THEN_32', source: evidence('data/pokemon/evos_attacks.asm', ['ChikoritaEvosAttacks:', 'EVOLVE_LEVEL, 16, BAYLEEF', 'BayleefEvosAttacks:', 'EVOLVE_LEVEL, 32, MEGANIUM']) }, roleSource: evidence('data/pokemon/base_stats/meganium.asm', ['MEGANIUM', 'GRASS, GRASS']) },
  CYNDAQUIL: { role: 'FIRE_SPECIAL_ATTACKER', battleTypes: ['FIRE'], evolution: { target: 'TYPHLOSION', method: 'LEVEL_14_THEN_36', source: evidence('data/pokemon/evos_attacks.asm', ['CyndaquilEvosAttacks:', 'EVOLVE_LEVEL, 14, QUILAVA', 'QuilavaEvosAttacks:', 'EVOLVE_LEVEL, 36, TYPHLOSION']) }, roleSource: evidence('data/pokemon/base_stats/typhlosion.asm', ['TYPHLOSION', 'FIRE, FIRE']) },
  TOTODILE: { role: 'WATER_PHYSICAL_ATTACKER', battleTypes: ['WATER'], evolution: { target: 'FERALIGATR', method: 'LEVEL_18_THEN_30', source: evidence('data/pokemon/evos_attacks.asm', ['TotodileEvosAttacks:', 'EVOLVE_LEVEL, 18, CROCONAW', 'CroconawEvosAttacks:', 'EVOLVE_LEVEL, 30, FERALIGATR']) }, roleSource: evidence('data/pokemon/base_stats/feraligatr.asm', ['FERALIGATR', 'WATER, WATER', 'ICE_PUNCH']) },
});

const TEAMS = freeze({
  CHIKORITA: [starter('CHIKORITA', STARTER_PROFILES.CHIKORITA), growlithe(), magnemite(), zubat(), heracross(), wooper()],
  CYNDAQUIL: [starter('CYNDAQUIL', STARTER_PROFILES.CYNDAQUIL), magnemite(), zubat(), heracross(), wooper(), abra()],
  TOTODILE: [starter('TOTODILE', STARTER_PROFILES.TOTODILE), growlithe(), magnemite(), zubat(), heracross(), abra()],
});

const ATTACK_EVIDENCE = freeze({
  DARK: evidence('data/pokemon/evos_attacks.asm', ['ZubatEvosAttacks:', 'BITE']),
  ELECTRIC: evidence('data/pokemon/evos_attacks.asm', ['MagnemiteEvosAttacks:', 'THUNDERSHOCK']),
  FIRE: evidence('data/pokemon/evos_attacks.asm', ['CyndaquilEvosAttacks:', 'EMBER']),
  FIGHTING: evidence('data/pokemon/base_stats/heracross.asm', ['HERACROSS', 'ROCK_SMASH']),
  FLYING: evidence('data/pokemon/evos_attacks.asm', ['ZubatEvosAttacks:', 'WING_ATTACK']),
  GROUND: evidence('data/pokemon/evos_attacks.asm', ['WooperEvosAttacks:', 'EARTHQUAKE']),
  ICE: evidence('data/items/marts.asm', ['MartGoldenrod5F1:', 'TM_ICE_PUNCH']),
  PSYCHIC: evidence('data/pokemon/base_stats/kadabra.asm', ['KADABRA', 'PSYCHIC_M']),
});

const coverage = (trainerGroup, answers) => freeze({
  answers: answers.map((answer) => freeze({ ...answer, source: ATTACK_EVIDENCE[answer.attackType] })),
  source: evidence('data/trainers/parties.asm', [trainerGroup]),
});

const sharedCoverage = (starter, waterTarget) => freeze({
  FALKNER: coverage('FalknerGroup:', [{ member: 'ZUBAT', attackType: 'FLYING', kind: 'EARLY_NEUTRAL_PIVOT' }]),
  BUGSY: coverage('BugsyGroup:', [{ member: starter === 'CYNDAQUIL' ? 'TYPHLOSION' : 'ZUBAT', attackType: starter === 'CYNDAQUIL' ? 'FIRE' : 'FLYING', kind: 'EARLY_SAFE_MATCHUP' }]),
  WHITNEY: coverage('WhitneyGroup:', [{ member: 'HERACROSS', attackType: 'FIGHTING', kind: 'TYPE_ADVANTAGE' }]),
  MORTY: coverage('MortyGroup:', [{ member: 'CROBAT', attackType: 'DARK', kind: 'BITE_UTILITY' }]),
  JASMINE: coverage('JasmineGroup:', [{ member: starter === 'TOTODILE' ? 'HERACROSS' : 'QUAGSIRE', attackType: starter === 'TOTODILE' ? 'FIGHTING' : 'GROUND', kind: 'TYPE_ADVANTAGE' }]),
  PRYCE: coverage('PryceGroup:', [{ member: 'MAGNETON', attackType: 'ELECTRIC', kind: 'TYPE_ADVANTAGE' }]),
  CLAIR: coverage('ClairGroup:', [{ member: waterTarget, attackType: 'ICE', kind: 'ICE_PUNCH_COVERAGE' }]),
  WILL: coverage('WillGroup:', [{ member: 'CROBAT', attackType: 'DARK', kind: 'BITE_UTILITY' }]),
  KOGA: coverage('KogaGroup:', [{ member: starter === 'CHIKORITA' ? 'QUAGSIRE' : 'KADABRA', attackType: starter === 'CHIKORITA' ? 'GROUND' : 'PSYCHIC', kind: 'TYPE_ADVANTAGE' }]),
  BRUNO: coverage('BrunoGroup:', [{ member: 'CROBAT', attackType: 'FLYING', kind: 'TYPE_ADVANTAGE' }]),
  KAREN: coverage('KarenGroup:', [{ member: 'HERACROSS', attackType: 'FIGHTING', kind: 'TYPE_ADVANTAGE' }]),
  LANCE: coverage('ChampionGroup:', [
    { member: 'MAGNETON', attackType: 'ELECTRIC', kind: 'FLYING_WATER_COVERAGE' },
    { member: waterTarget, attackType: 'ICE', kind: 'ICE_PUNCH_COVERAGE' },
  ]),
});

const TEAM_PLANS = freeze({
  CHIKORITA: { version: 'v1', starter: 'CHIKORITA', members: TEAMS.CHIKORITA, majorBossCoverage: sharedCoverage('CHIKORITA', 'QUAGSIRE') },
  CYNDAQUIL: { version: 'v1', starter: 'CYNDAQUIL', members: TEAMS.CYNDAQUIL, majorBossCoverage: sharedCoverage('CYNDAQUIL', 'QUAGSIRE') },
  TOTODILE: { version: 'v1', starter: 'TOTODILE', members: TEAMS.TOTODILE, majorBossCoverage: sharedCoverage('TOTODILE', 'FERALIGATR') },
});

const ATTACK_EVIDENCE_V2 = freeze({
  ROCK: evidence('data/pokemon/evos_attacks.asm', ['GeodudeEvosAttacks:', 'ROCK_THROW']),
  ROCK_SLIDE: evidence('data/pokemon/evos_attacks.asm', ['SudowoodoEvosAttacks:', 'ROCK_SLIDE']),
  GROUND: evidence('data/pokemon/evos_attacks.asm', ['GeodudeEvosAttacks:', 'EARTHQUAKE']),
  WATER: evidence('data/pokemon/evos_attacks.asm', ['GyaradosEvosAttacks:', 'HYDRO_PUMP']),
  PSYCHIC: evidence('data/pokemon/evos_attacks.asm', ['SlowpokeEvosAttacks:', 'PSYCHIC_M']),
  ICE: ATTACK_EVIDENCE.ICE,
});
const coverageV2 = (trainerGroup, answers) => freeze({
  answers: answers.map((answer) => freeze({ ...answer, source: ATTACK_EVIDENCE_V2[answer.attackType] })),
  source: evidence('data/trainers/parties.asm', [trainerGroup]),
});
// Per-boss best member from the scorer (score-teams.mjs, 2026-09-04).
const sharedCoverageV2 = () => freeze({
  FALKNER: coverageV2('FalknerGroup:', [{ member: 'GEODUDE', attackType: 'ROCK', kind: 'TYPE_ADVANTAGE' }]),
  BUGSY: coverageV2('BugsyGroup:', [{ member: 'GEODUDE', attackType: 'ROCK', kind: 'TYPE_ADVANTAGE' }]),
  WHITNEY: coverageV2('WhitneyGroup:', [{ member: 'QUAGSIRE', attackType: 'GROUND', kind: 'BULKY_NEUTRAL' }]),
  MORTY: coverageV2('MortyGroup:', [{ member: 'QUAGSIRE', attackType: 'GROUND', kind: 'TYPE_ADVANTAGE' }]),
  JASMINE: coverageV2('JasmineGroup:', [{ member: 'QUAGSIRE', attackType: 'GROUND', kind: 'TYPE_ADVANTAGE' }]),
  PRYCE: coverageV2('PryceGroup:', [{ member: 'GYARADOS', attackType: 'WATER', kind: 'BULKY_NEUTRAL' }]),
  CLAIR: coverageV2('ClairGroup:', [{ member: 'QUAGSIRE', attackType: 'ICE', kind: 'ICE_PUNCH_COVERAGE' }]),
  WILL: coverageV2('WillGroup:', [{ member: 'SLOWBRO', attackType: 'WATER', kind: 'BULKY_NEUTRAL' }]),
  KOGA: coverageV2('KogaGroup:', [{ member: 'GRAVELER', attackType: 'GROUND', kind: 'TYPE_ADVANTAGE' }]),
  BRUNO: coverageV2('BrunoGroup:', [{ member: 'SLOWBRO', attackType: 'PSYCHIC', kind: 'TYPE_ADVANTAGE' }]),
  KAREN: coverageV2('KarenGroup:', [{ member: 'GYARADOS', attackType: 'WATER', kind: 'BULKY_NEUTRAL' }]),
  LANCE: coverageV2('ChampionGroup:', [
    { member: 'SUDOWOODO', attackType: 'ROCK_SLIDE', kind: 'FLYING_FIRE_COVERAGE' },
    { member: 'QUAGSIRE', attackType: 'ICE', kind: 'ICE_PUNCH_COVERAGE' },
  ]),
});
const TEAMS_V2 = freeze(Object.fromEntries(['CHIKORITA', 'CYNDAQUIL', 'TOTODILE'].map((name) => [name, [starter(name, STARTER_PROFILES[name]), geodude(), sudowoodo(), gyarados(), slowpoke(), wooper()]])));
const TEAM_PLANS_V2 = freeze(Object.fromEntries(['CHIKORITA', 'CYNDAQUIL', 'TOTODILE'].map((name) => [name, { version: 'v2', starter: name, members: TEAMS_V2[name], majorBossCoverage: sharedCoverageV2() }])));

export const TEAM_PLAN_VERSIONS = freeze({ v1: TEAM_PLANS, v2: TEAM_PLANS_V2 });

export const CRYSTAL_REV1 = freeze({
  id: 'POKEMON_CRYSTAL_US_EU_REV_1',
  generation: 2,
  platform: 'GBC',
  rom: {
    archivePath: process.env.POKEMON_SUITE_CRYSTAL_ROM || '',
    innerFile: 'Pokemon - Crystal Version (USA, Europe) (Rev 1).gbc',
    sha1: 'f2f52230b536214ef7c9924f483392993e226cfb',
    bytes: 2_097_152,
  },
  symbolSource: {
    repository: 'vendor/pokecrystal-symbols',
    commit: 'cc6fc04f19c645f5c40f64f8d88b2ab42c7bdde8',
    file: 'pokecrystal11.sym',
  },
  goal: {
    primary: 'FIRST_JOHTO_HALL_OF_FAME',
    postgame: { status: 'LATER_EXTENSION', target: 'RED' },
  },
  budgets: { primaryGameHours: 30, stretchGameHours: 24 },
  policy: {
    gameplayOnly: true,
    prohibited: ['CHEATS', 'EXPLOITS', 'TRADES'],
    training: 'BEFORE_EVERY_GYM_RIVAL_TEAM_ROCKET_ELITE_FOUR_BOSS',
    routing: 'FORWARD_LOCAL',
    rematches: 'FINISH_ACTIVE_BATCH_BEFORE_LEAVING',
  },
  source,
});

export function choosePlayerGender(binaryTicket) {
  if (!Number.isInteger(binaryTicket) || binaryTicket < 0 || binaryTicket > 1) {
    throw new RangeError('Crystal gender ticket must be an unbiased binary value (0 or 1)');
  }
  return binaryTicket === 0 ? 'BOY' : 'GIRL';
}

export function chooseStarter(ternaryTicket) {
  if (!Number.isInteger(ternaryTicket) || ternaryTicket < 0 || ternaryTicket > 2) {
    throw new RangeError('Crystal starter ticket must be an unbiased ternary value (0, 1, or 2)');
  }
  return ['CHIKORITA', 'CYNDAQUIL', 'TOTODILE'][ternaryTicket];
}

export function teamForStarter(starterSpecies) {
  const team = TEAMS[starterSpecies];
  if (!team) throw new RangeError(`Unsupported Crystal starter: ${starterSpecies}`);
  return team;
}

export function teamPlanForStarter(starterSpecies, { version = 'v1' } = {}) {
  const plans = TEAM_PLAN_VERSIONS[version];
  if (!plans) throw new RangeError(`Unsupported Crystal team plan version: ${version}`);
  const plan = plans[starterSpecies];
  if (!plan) throw new RangeError(`Unsupported Crystal starter: ${starterSpecies}`);
  return plan;
}

export function validateTeamSources(team, sourceTextByFile) {
  return team.flatMap(({ species, acquisition }) => {
    const text = sourceTextByFile[acquisition.source.file];
    if (typeof text !== 'string') return `${species}: missing source file ${acquisition.source.file}`;
    return acquisition.source.terms.every((term) => text.includes(term))
      ? []
      : `${species}: encounter evidence missing from ${acquisition.source.file}`;
  });
}

const validateEvidence = (label, entry, sourceTextByFile) => {
  const text = sourceTextByFile[entry.file];
  if (typeof text !== 'string') return `${label}: missing source file ${entry.file}`;
  return entry.terms.every((term) => text.includes(term))
    ? []
    : [`${label}: evidence missing from ${entry.file}`];
};

export function validateTeamPlanSources(plan, sourceTextByFile) {
  return [
    ...validateTeamSources(plan.members, sourceTextByFile),
    ...plan.members.flatMap((member) => [
      ...validateEvidence(`${member.species} role`, member.roleSource, sourceTextByFile),
      ...validateEvidence(`${member.species} evolution`, member.evolution.source, sourceTextByFile),
    ]),
    ...Object.entries(plan.majorBossCoverage).flatMap(([bossId, matchup]) => (
      [
        ...validateEvidence(`${bossId} coverage`, matchup.source, sourceTextByFile),
        ...matchup.answers.flatMap((answer) => (
          validateEvidence(`${bossId} ${answer.member} answer`, answer.source, sourceTextByFile)
        )),
      ]
    )),
  ];
}

export const SYMBOL_MANIFEST = freeze({
  wBattleMon: { bank: 0, address: 0xc62c },
  wCurPartyMon: { bank: 1, address: 0xd109 },
  wEnemyMon: { bank: 1, address: 0xd206 },
  wBattleMode: { bank: 1, address: 0xd22d },
  wOtherTrainerClass: { bank: 1, address: 0xd22f },
  wOtherTrainerID: { bank: 1, address: 0xd231 },
  wGameTimeHours: { bank: 1, address: 0xd4c4 },
  wGameTimeMinutes: { bank: 1, address: 0xd4c6 },
  wGameTimeSeconds: { bank: 1, address: 0xd4c7 },
  wGameTimeFrames: { bank: 1, address: 0xd4c8 },
  wTimeOfDay: { bank: 1, address: 0xd269 },
  wJohtoBadges: { bank: 1, address: 0xd857 },
  wMapGroup: { bank: 1, address: 0xdcb5 },
  wMapNumber: { bank: 1, address: 0xdcb6 },
  wPartyCount: { bank: 1, address: 0xdcd7 },
  wPartyMon1Species: { bank: 1, address: 0xdcdf },
  wPartyMon1Level: { bank: 1, address: 0xdcfe },
  wEventFlags: { bank: 1, address: 0xda72 },
  wPlayerGender: { bank: 1, address: 0xd472 },
  wJumptableIndex: { bank: 0, address: 0xcf63 },
  wMenuSelection: { bank: 0, address: 0xcf74 },
  wMenuDataItems: { bank: 0, address: 0xcf92 },
  wMenuCursorY: { bank: 0, address: 0xcfa9 },
  wMenuCursorX: { bank: 0, address: 0xcfaa },
  wYCoord: { bank: 1, address: 0xdcb7 },
  wXCoord: { bank: 1, address: 0xdcb8 },
  wScriptRunning: { bank: 1, address: 0xd438 },
  wStartDay: { bank: 1, address: 0xd4b6 },
  wStartHour: { bank: 1, address: 0xd4b7 },
  wCurDay: { bank: 1, address: 0xd4cb },
  wMomsMoney: { bank: 1, address: 0xd851 },
  wMomSavingMoney: { bank: 1, address: 0xd854 },
  hHours: { bank: 0, address: 0xff94 },
  hMinutes: { bank: 0, address: 0xff96 },
  hSeconds: { bank: 0, address: 0xff98 },
});

const OPENING_EVENT_BYTE = 0xda75;
const STARTER_EVENT_BITS = freeze({ CHIKORITA: 0x20, CYNDAQUIL: 0x08, TOTODILE: 0x10 });
const STARTER_SPECIES = freeze({ CHIKORITA: 152, CYNDAQUIL: 155, TOTODILE: 158 });

export const CRYSTAL_OPENING = freeze({
  wramBank: 1,
  postSelectionMap: freeze({ group: 24, number: 5 }),
  starterSpecies: STARTER_SPECIES,
  source: freeze({
    gender: evidence('engine/menus/init_gender.asm', ['InitGender:', 'ld [wPlayerGender], a']),
    playerName: evidence('data/player_names.asm', ['db 5 ; items', 'db 1 ; default option']),
    starters: evidence('maps/ElmsLab.asm', ['givepoke CHIKORITA, 5, BERRY', 'givepoke CYNDAQUIL, 5, BERRY', 'givepoke TOTODILE, 5, BERRY']),
    events: evidence('constants/event_flags.asm', ['EVENT_GOT_A_POKEMON_FROM_ELM', 'EVENT_GOT_CYNDAQUIL_FROM_ELM', 'EVENT_GOT_TOTODILE_FROM_ELM', 'EVENT_GOT_CHIKORITA_FROM_ELM']),
    map: evidence('constants/map_constants.asm', ['newgroup NEW_BARK', 'map_const ELMS_LAB,                                     5']),
  }),
});

export class OpeningControllerError extends Error {
  constructor(message) {
    super(message);
    this.name = 'OpeningControllerError';
  }
}

export const CHAPTER_1A = freeze({
  goal: 'READY_FOR_FALKNER_TRAINING',
  policy: freeze({ inputOnly: true, firstRivalAttemptRequired: true, doesNotClaimFalkner: true }),
  milestones: freeze([
    freeze({ id: 'MR_POKEMON_EGG', source: evidence('maps/MrPokemonsHouse.asm', ['giveitem MYSTERY_EGG', 'setevent EVENT_GOT_MYSTERY_EGG_FROM_MR_POKEMON']) }),
    freeze({ id: 'CHERRYGROVE_RIVAL_WIN', source: evidence('maps/CherrygroveCity.asm', ['startbattle', 'winlosstext']) }),
    freeze({ id: 'ELM_HANDOFF', source: evidence('maps/ElmsLab.asm', ['EVENT_GOT_MYSTERY_EGG_FROM_MR_POKEMON', 'ENGINE_POKEDEX']) }),
    freeze({ id: 'FALKNER_TRAINING_READY', source: evidence('maps/ElmsLab.asm', ['setevent EVENT_GAVE_MYSTERY_EGG_TO_ELM']) }),
  ]),
});

export function createChapter1ADecision(milestone, details = {}) {
  if (!CHAPTER_1A.milestones.some(({ id }) => id === milestone)) {
    throw new RangeError(`unknown Crystal chapter 1A milestone: ${milestone}`);
  }
  if (milestone === 'CHERRYGROVE_RIVAL_WIN' && details.attempt !== 1) {
    throw new OpeningControllerError('the Cherrygrove rival must be won on the first attempt');
  }
  return freeze({
    type: 'gameplay.decision', game: CRYSTAL_REV1.id, chapter: '1A', milestone,
    status: 'DECISION', ...details,
  });
}

const requireBytes = (value, bytes, label) => {
  if (!(value instanceof Uint8Array) || value.byteLength !== bytes) {
    throw new OpeningControllerError(`${label} must return exactly ${bytes} read-only bytes`);
  }
  return value;
};

export function readCrystalOpeningState(session) {
  if (!session || typeof session.readMemory !== 'function' || typeof session.readWramBank !== 'function') {
    throw new OpeningControllerError(
      'Crystal opening observation requires readMemory and readWramBank; Crystal Rev 1 progress symbols reside in WRAMX bank 1',
    );
  }
  const wram0 = requireBytes(session.readMemory(0xc000, 0x1000), 0x1000, 'readMemory');
  const wram1 = requireBytes(session.readWramBank(CRYSTAL_OPENING.wramBank, 0xd000, 0x1000), 0x1000, 'readWramBank');
  const read0 = (address) => wram0[address - 0xc000];
  const read1 = (address) => wram1[address - 0xd000];
  const eventByte = read1(OPENING_EVENT_BYTE);
  const starters = Object.entries(STARTER_EVENT_BITS)
    .filter(([, bit]) => eventByte & bit)
    .map(([starterName]) => starterName);
  const partyCount = Math.min(read1(0xdcd7), 6);
  const party = Array.from({ length: partyCount }, (_, index) => {
    const base = 0xdcdf + index * 0x30;
    return { speciesId: read1(base), level: read1(base + 0x1f) };
  });
  return freeze({
    jumptableIndex: read0(0xcf63),
    menu: freeze({ selection: read0(0xcf74), items: read0(0xcf92), cursorY: read0(0xcfa9), cursorX: read0(0xcfaa) }),
    playerGender: (read1(0xd472) & 1) === 0 ? 'BOY' : 'GIRL',
    scriptRunning: Boolean(read1(0xd438)),
    map: freeze({ group: read1(0xdcb5), number: read1(0xdcb6), y: read1(0xdcb7), x: read1(0xdcb8) }),
    party: freeze(party),
    elmEvents: freeze({ gotPokemon: Boolean(eventByte & 0x04), starter: starters.length === 1 ? starters[0] : null }),
  });
}

export function verifyStarterSelection(state, gender, starterSpecies) {
  const expectedId = STARTER_SPECIES[starterSpecies];
  if (!expectedId || state?.playerGender !== gender || !state.elmEvents?.gotPokemon ||
      state.elmEvents.starter !== starterSpecies || state.party?.length !== 1 ||
      state.party[0]?.speciesId !== expectedId || state.party[0]?.level !== 5) {
    throw new OpeningControllerError('native opening state does not verify the requested gender and level-5 Elm starter');
  }
  return freeze({ verified: true, starter: starterSpecies, gender });
}

const sameMap = (state, map) => state.map.group === map.group && state.map.number === map.number;
const OPENING_MAPS = freeze({ HOME_2F: freeze({ group: 24, number: 7 }), HOME_1F: freeze({ group: 24, number: 6 }), NEW_BARK: freeze({ group: 24, number: 4 }), ELMS_LAB: freeze({ group: 24, number: 5 }) });
const STARTER_BALL_APPROACH = freeze({ CHIKORITA: freeze({ x: 8, y: 4 }), CYNDAQUIL: freeze({ x: 6, y: 4 }), TOTODILE: freeze({ x: 7, y: 4 }) });

const assertQualifiedOpeningSession = (session) => {
  if (session?.platform !== 'gbc') throw new OpeningControllerError('Crystal opening requires a booted GBC session');
  if (session.identity?.cartridgeSha1 !== CRYSTAL_REV1.rom.sha1 || session.identity?.cartridgeBytes !== CRYSTAL_REV1.rom.bytes) {
    throw new OpeningControllerError('Crystal opening refuses a session whose cartridge identity is not the pinned Rev 1 ROM');
  }
};

/**
 * Drives only `session.step(buttons)` and observes only public read-only memory APIs.
 * It deliberately has no save/load, SRAM, RAM, or emulation-internal control path.
 */
export function runFreshCrystalOpening(session, {
  genderTicket,
  starterTicket,
  maximumInputFrames = 30_000,
  trace = null,
} = {}) {
  assertQualifiedOpeningSession(session);
  const gender = choosePlayerGender(genderTicket);
  const starterSpecies = chooseStarter(starterTicket);
  if (!Number.isInteger(maximumInputFrames) || maximumInputFrames < 1) {
    throw new RangeError('maximumInputFrames must be a positive integer');
  }
  let frames = 0;
  const state = () => readCrystalOpeningState(session);
  const step = (buttons = []) => {
    if (frames >= maximumInputFrames) throw new OpeningControllerError(`opening exceeded ${maximumInputFrames} native input frames`);
    session.step(buttons);
    frames += 1;
  };
  const press = (button) => {
    // Crystal's joypad edge detection requires a held input followed by release.
    for (let held = 0; held < 20; held += 1) step([button]);
    for (let released = 0; released < 4; released += 1) step([]);
  };
  const waitFor = (label, predicate, budget, action = () => step([])) => {
    for (let waited = 0; waited < budget && frames < maximumInputFrames; waited += 1) {
      const current = state();
      if (predicate(current)) return current;
      action(waited, current);
    }
    throw new OpeningControllerError(`opening did not reach ${label} within ${budget} observed frames`);
  };
  const waitForDifferentLocation = (before, budget = 96) => waitFor(
    'a map or coordinate transition',
    (current) => current.map.group !== before.map.group || current.map.number !== before.map.number || current.map.x !== before.map.x || current.map.y !== before.map.y,
    budget,
  );
  const driveTo = (map, target, { acknowledgeText = true } = {}) => {
    trace?.('driveTo', { target, at: state().map, frames });
    let noProgress = 0;
    while (frames < maximumInputFrames) {
      const before = state();
      if (!sameMap(before, map)) return before;
      if (before.map.x === target.x && before.map.y === target.y) return before;
      const button = before.map.x < target.x ? 'right' : before.map.x > target.x ? 'left' : before.map.y < target.y ? 'down' : 'up';
      press(button);
      try {
        waitForDifferentLocation(before);
        // The map coordinate changes when a step begins; let the 16-frame
        // step finish before the next input so it cannot turn mid-step.
        for (let settle = 0; settle < 16; settle += 1) step([]);
        noProgress = 0;
      } catch (error) {
        if (!(error instanceof OpeningControllerError)) throw error;
        // A fresh game can stop this path for Mom/Elm text. Acknowledge it and
        // retry the same observed coordinate; never issue a RAM or state write.
        if (acknowledgeText) {
          if (before.menu.items === 2 && before.menu.cursorY === 2) press('up');
          press('a');
        }
        noProgress += 1;
        if (noProgress > 60) throw new OpeningControllerError(`opening route is blocked near ${before.map.x},${before.map.y}`);
      }
    }
    throw new OpeningControllerError('opening route exhausted its native input budget');
  };

  waitFor('fresh main menu', (current) => current.jumptableIndex === 0x82 && current.menu.selection === 1 && current.menu.items === 2 && current.menu.cursorY === 1, 1_500, (waited) => {
    if (waited % 30 === 0) press('start'); else step([]);
  });
  // MainMenu is entered immediately after the title scene; let its input loop
  // become live before submitting the default New Game choice.
  for (let settle = 0; settle < 60; settle += 1) step([]);
  press('a');
  waitFor('gender menu', (current) => current.menu.selection === 0 && current.menu.items === 2 && current.menu.cursorY === 1 && current.map.group === 0, 900);
  if (gender === 'GIRL') {
    press('down');
    waitFor('girl cursor', (current) => current.menu.cursorY === 2, 120);
  }
  press('a');

  // Oak text is advanced only while the expected, observable pre-world state
  // remains active. The five-item name menu is handled separately so NEW NAME
  // is never accepted by accident.
  waitFor('player home after Oak speech', (current) => sameMap(current, OPENING_MAPS.HOME_2F), 8_000, (waited, current) => {
    if (current.menu.items === 5 && current.menu.cursorY === 1) press('down');
    else if (current.menu.items === 5 && current.menu.cursorY === 2) press('a');
    else if (waited % 16 === 0) press('a');
    else step([]);
  });

  driveTo(OPENING_MAPS.HOME_2F, { x: 7, y: 0 });
  waitFor('downstairs map', (current) => sameMap(current, OPENING_MAPS.HOME_1F), 360);
  // The stairwell opens into the right-hand corridor. Heading down first is
  // required by the map collision layout and crosses Mom's native scene.
  driveTo(OPENING_MAPS.HOME_1F, { x: 9, y: 7 });
  driveTo(OPENING_MAPS.HOME_1F, { x: 6, y: 7 });
  press('down');
  waitFor('New Bark Town', (current) => sameMap(current, OPENING_MAPS.NEW_BARK), 360);
  driveTo(OPENING_MAPS.NEW_BARK, { x: 6, y: 3 });
  waitFor('Elm laboratory', (current) => sameMap(current, OPENING_MAPS.ELMS_LAB), 360);

  // Elm's scene includes text and default-Yes confirmations. Once it releases
  // the player, approach the exact ball selected by the already-unbiased ticket.
  waitFor('Elm starter-choice scene', (current) => sameMap(current, OPENING_MAPS.ELMS_LAB) && current.party.length === 0 && current.map.y <= 5 && !current.scriptRunning, 3_000, (waited) => {
    if (waited % 16 === 0) press('a'); else step([]);
  });
  // Elm leaves the player west of the central table; route below it before
  // approaching the selected ball, so a facing-A acknowledgement cannot touch
  // the neighbouring Cyndaquil ball.
  trace?.('elm-scene-released', { at: state().map, frames });
  driveTo(OPENING_MAPS.ELMS_LAB, { x: 4, y: 5 }, { acknowledgeText: false });
  driveTo(OPENING_MAPS.ELMS_LAB, STARTER_BALL_APPROACH[starterSpecies], { acknowledgeText: false });
  for (let settle = 0; settle < 24; settle += 1) step([]);
  trace?.('at-ball', { starterSpecies, at: state().map, frames });
  press('up');
  press('a');
  const verified = waitFor('verified Elm starter selection', (current) => {
    try { verifyStarterSelection(current, gender, starterSpecies); return true; } catch { return false; }
  }, 3_000, (waited, current) => {
    // The only YES/NO prompt after the starter joins the party is the nickname
    // question; decline it so the party keeps the species name.
    if (current.menu.items === 2 && current.party.length === 1) {
      if (current.menu.cursorY === 1) press('down');
      press('a');
    } else if (waited % 16 === 0) press('a'); else step([]);
  });
  return freeze({ ...verifyStarterSelection(verified, gender, starterSpecies), frames, state: verified });
}

export const ROUTE29_GATE = freeze({ from: freeze({ group: 24, number: 5 }), to: freeze({ group: 24, number: 3 }) });

export function runPostStarterToRoute29(session, { maximumInputFrames = 12_000, world = null, knowledge = null } = {}) {
  assertQualifiedOpeningSession(session);
  if (!Number.isInteger(maximumInputFrames) || maximumInputFrames < 1) throw new RangeError('maximumInputFrames must be positive');
  const initial = readCrystalOpeningState(session);
  if (!sameMap(initial, ROUTE29_GATE.from) || initial.scriptRunning || !initial.elmEvents.gotPokemon || initial.party.length !== 1) {
    throw new OpeningControllerError('Route 29 controller requires the stable verified post-starter Elm Lab state');
  }
  // The route is planned over the pinned pokecrystal map data (collision,
  // warps, and the New Bark west connection) and executed as bounded walking
  // edges; the aide's Potion scene is acknowledged when the cartridge runs it.
  const crystalWorld = world ?? loadCrystalWorld();
  const observer = createCrystalObserver({ session, knowledge: knowledge ?? loadCrystalKnowledge() });
  const decisions = [];
  const result = drive(session, travelTo({
    world: crystalWorld,
    observer,
    destination: { mapId: crystalWorld.idOf(ROUTE29_GATE.to.group, ROUTE29_GATE.to.number) },
    onDecision: (decision) => decisions.push(decision),
  }), { maximumFrames: maximumInputFrames });
  const state = readCrystalOpeningState(session);
  if (!result.arrived || !sameMap(state, ROUTE29_GATE.to) || state.scriptRunning) {
    throw new OpeningControllerError(`Route 29 controller stopped: ${result.reason} at ${state.map.group}/${state.map.number} ${state.map.x},${state.map.y}`);
  }
  return freeze({ frames: result.executed.reduce((sum, segment) => sum + segment.completed, 0), state, decisions, executed: result.executed });
}

export function parseRgbdsSymbols(symbolText) {
  const symbols = new Map();
  for (const line of String(symbolText).split(/\r?\n/)) {
    const match = /^\s*(?:\d+:)?([0-9a-f]{2}):([0-9a-f]{4})\s+(\S+)\s*$/i.exec(line);
    if (match) symbols.set(match[3], { bank: Number.parseInt(match[1], 16), address: Number.parseInt(match[2], 16) });
  }
  return symbols;
}

export function validateSymbolManifest(symbols, requiredSymbols = Object.keys(SYMBOL_MANIFEST)) {
  return requiredSymbols.flatMap((symbol) => {
    const expected = SYMBOL_MANIFEST[symbol];
    const actual = symbols.get(symbol);
    return actual?.bank === expected?.bank && actual?.address === expected?.address
      ? []
      : [{ symbol, expected, actual }];
  });
}

const PARTY_MON = { first: 0xdcdf, stride: 0x30, species: 0, level: 0x1f };
const BATTLE_MON = { species: 0, level: 0x0d };
const JOHTO_BADGES = ['ZEPHYR', 'HIVE', 'PLAIN', 'FOG', 'MINERAL', 'STORM', 'GLACIER', 'RISING'];

const at = (memory, address) => memory[address] ?? 0;

export function decodeObserver(memory) {
  const modeId = at(memory, 0xd22d);
  const mode = ['OVERWORLD', 'WILD', 'TRAINER'][modeId] ?? 'UNKNOWN';
  const partyCount = Math.min(at(memory, 0xdcd7), 6);
  const party = Array.from({ length: partyCount }, (_, index) => {
    const base = PARTY_MON.first + index * PARTY_MON.stride;
    return { speciesId: at(memory, base + PARTY_MON.species), level: at(memory, base + PARTY_MON.level) };
  });
  const badgeBits = at(memory, 0xd857);
  const battleMon = (base) => ({
    speciesId: at(memory, base + BATTLE_MON.species),
    level: at(memory, base + BATTLE_MON.level),
  });

  return {
    map: { group: at(memory, 0xdcb5), number: at(memory, 0xdcb6) },
    playtime: {
      hours: at(memory, 0xd4c4) * 0x100 + at(memory, 0xd4c5),
      minutes: at(memory, 0xd4c6), seconds: at(memory, 0xd4c7), frames: at(memory, 0xd4c8),
    },
    johtoBadges: JOHTO_BADGES.filter((_, index) => badgeBits & (1 << index)),
    party,
    battle: {
      mode,
      trainer: mode === 'TRAINER' ? { classId: at(memory, 0xd22f), id: at(memory, 0xd231) } : null,
      player: battleMon(0xc62c),
      enemy: battleMon(0xd206),
    },
  };
}

const boss = (id, category, maximumOpponentLevel, file) => freeze({
  id, category, maximumOpponentLevel, minimumLevel: maximumOpponentLevel + 1,
  trainBefore: true,
  rematchPolicy: 'FINISH_ACTIVE_BATCH_BEFORE_LEAVING',
  source: freeze({ ...source, file }),
});

export const MANDATORY_BOSSES = freeze([
  boss('FALKNER', 'GYM', 9, 'maps/VioletGym.asm'),
  boss('RIVAL_CHERRYGROVE', 'RIVAL', 5, 'maps/CherrygroveCity.asm'),
  boss('BUGSY', 'GYM', 16, 'maps/AzaleaGym.asm'),
  boss('RIVAL_AZALEA', 'RIVAL', 16, 'maps/AzaleaTown.asm'),
  boss('WHITNEY', 'GYM', 20, 'maps/GoldenrodGym.asm'),
  boss('RIVAL_BURNED_TOWER', 'RIVAL', 22, 'maps/BurnedTower1F.asm'),
  boss('MORTY', 'GYM', 25, 'maps/EcruteakGym.asm'),
  boss('CHUCK', 'GYM', 30, 'maps/CianwoodGym.asm'),
  boss('JASMINE', 'GYM', 35, 'maps/OlivineGym.asm'),
  boss('PRYCE', 'GYM', 31, 'maps/MahoganyGym.asm'),
  boss('ROCKET_EXECUTIVE_F_2', 'TEAM_ROCKET', 25, 'maps/TeamRocketBaseB2F.asm'),
  boss('ROCKET_EXECUTIVE_M_4', 'TEAM_ROCKET', 24, 'maps/TeamRocketBaseB3F.asm'),
  boss('RIVAL_GOLDENROD_UNDERGROUND', 'RIVAL', 32, 'maps/GoldenrodUndergroundSwitchRoomEntrances.asm'),
  boss('ROCKET_EXECUTIVE_M_3', 'TEAM_ROCKET', 32, 'maps/RadioTower5F.asm'),
  boss('ROCKET_EXECUTIVE_M_2', 'TEAM_ROCKET', 36, 'maps/RadioTower4F.asm'),
  boss('ROCKET_EXECUTIVE_F_1', 'TEAM_ROCKET', 32, 'maps/RadioTower5F.asm'),
  boss('ROCKET_EXECUTIVE_M_1', 'TEAM_ROCKET', 35, 'maps/RadioTower5F.asm'),
  boss('CLAIR', 'GYM', 40, 'maps/BlackthornGym1F.asm'),
  boss('RIVAL_VICTORY_ROAD', 'RIVAL', 38, 'maps/VictoryRoad.asm'),
  boss('WILL', 'ELITE_FOUR', 42, 'maps/WillsRoom.asm'),
  boss('KOGA', 'ELITE_FOUR', 44, 'maps/KogasRoom.asm'),
  boss('BRUNO', 'ELITE_FOUR', 46, 'maps/BrunosRoom.asm'),
  boss('KAREN', 'ELITE_FOUR', 47, 'maps/KarensRoom.asm'),
  boss('LANCE', 'CHAMPION', 50, 'maps/LancesRoom.asm'),
]);

export function readinessFor(milestoneId) {
  const milestone = MANDATORY_BOSSES.find(({ id }) => id === milestoneId);
  if (!milestone) throw new RangeError(`Unknown Crystal milestone: ${milestoneId}`);
  return milestone;
}

export function canLeaveArea(rematchBatch) {
  const pendingRematches = rematchBatch
    .filter(({ complete }) => !complete)
    .map(({ trainer }) => trainer);
  return { allowed: pendingRematches.length === 0, pendingRematches };
}
