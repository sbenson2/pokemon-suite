import {obedienceRisk,permanentTrainingParty} from './training-policy.js';
import {presentStoryProgress} from './story-checkpoints.js';
import { isHmUtilityCarrier, fieldCarrierSpecies } from './hm-policy.js';
export { isHmUtilityCarrier } from './hm-policy.js';
import { createHash } from "node:crypto";
import { productiveTrainingOptions, estimateTrainingCycle, createTrainingMeasurements } from "./training-quality.js";
import {acceptableEffortGain} from './effort-values.js';
import { isProgressObservation } from "./progress-observation.js";
import {createLeagueRecovery} from './league-recovery.js';
import {createCampaignTasks,campaignMemberIdentity} from './campaign-tasks.js';

import {encounterFingerprint} from './encounter-tracker.js';
import {nationalSpeciesId} from '../evidence/gen3-national-species.js';
import {fireRedIsland,fireRedFerryArrival,SEAGALLOP_WATCH_VARIABLES} from '../suite/fire-red-link-quest.js';
import { isMajorBattle } from './major-battles.js';
import {
  CAPTURE_BALL_UNIT_PRICES,
  planCaptureBallPortfolio,
  PURCHASABLE_CAPTURE_BALL_IDS,
} from "./capture-balls.js";
import {
  partyFullyRestored,
  partyMaximallyRecovered,
  hasUsableAttackingPp,
  hasAttackingMove,
} from "./recovery.js";
import { expectedTrainerPayout } from "./trainer-economics.js";
import { NATIVE_LAYOUT_VARIANTS } from "../data/native-layout-variants.js";
import { applyStoryChoices } from "../suite/extra-save-story.js"; // extra-saves
import {RUIN_VALLEY,SUN_STONE} from '../suite/ruin-valley-route.js';

const IMPORTANT_BATTLE_PARTY_MINIMUMS = Object.freeze({
  "rival-route22-early": 2,
  "badge-boulder": 2,
  "rival-cerulean": 3,
  "badge-cascade": 3,
  "rival-ss-anne": 4,
  "badge-thunder": 4,
  "badge-rainbow": 5,
  "rocket-hideout-giovanni": 5,
  "rival-pokemon-tower": 5,
  "rival-silph": 6,
  "silph-liberated": 6,
  "badge-soul": 6,
  "badge-marsh": 6,
  "badge-volcano": 6,
  "badge-earth": 6,
  "rival-route22-late": 6,
  "elite-four-lorelei": 6,
  "elite-four-bruno": 6,
  "elite-four-agatha": 6,
  "elite-four-lance": 6,
  champion: 6,
});
const IMPORTANT_BATTLE_MINIMUM_LEVEL_ADVANTAGE = 2;
const FIRST_CLEAR_LEAGUE_TEAM_TARGET_LEVEL = 65;
const FIRST_CLEAR_LEAGUE_MINIMUM_READY_MEMBERS = 5;

function authoredBattleLevelTarget(
  category,
  enemyPartyLevels,
  battleTeamTargetLevel,
  {
    preparationAvailable = true,
    supportBattleTargetLevel = null,
    minimumReadyBattleMembers = null,
  } = {},
) {
  const levels = enemyPartyLevels.map(Number);
  const enemyAceLevel = Math.max(...levels);
  if (
    preparationAvailable &&
    battleTeamTargetLevel < enemyAceLevel + IMPORTANT_BATTLE_MINIMUM_LEVEL_ADVANTAGE
  ) {
    throw new RangeError("a prepared major battle target must be at least ace + 2");
  }
  return Object.freeze({
    category,
    enemyPartyLevels: Object.freeze(levels),
    enemyPartySize: levels.length,
    enemyAceLevel,
    starterBattleTargetLevel: battleTeamTargetLevel,
    supportBattleTargetLevel: Number(
      supportBattleTargetLevel ?? battleTeamTargetLevel,
    ),
    minimumReadyBattleMembers: Number(minimumReadyBattleMembers ?? levels.length),
    // Retained as a compatibility alias for consumers that still display the
    // former uniform target. Only the starter uses this threshold now.
    battleTeamTargetLevel,
    preparationAvailable,
  });
}

export const CAMPAIGN_MAJOR_BATTLE_LEVEL_TARGETS = Object.freeze({
  // The lab fight is forced before the player can leave to train, so its
  // cartridge-authored level is recorded without applying a preparation gate.
  "rival-oaks-lab": authoredBattleLevelTarget(
    "tutorial-rival",
    [5],
    5,
    { preparationAvailable: false },
  ),
  "rival-route22-early": authoredBattleLevelTarget("rival", [9, 9], 11),
  "badge-boulder": authoredBattleLevelTarget("gym-leader", [12, 14], 16),
  "rival-cerulean": authoredBattleLevelTarget("rival", [17, 16, 15, 18], 20),
  "badge-cascade": authoredBattleLevelTarget("gym-leader", [18, 21], 23),
  "rival-ss-anne": authoredBattleLevelTarget("rival", [19, 16, 18, 20], 22),
  "badge-thunder": authoredBattleLevelTarget("gym-leader", [21, 18, 24], 26),
  "badge-rainbow": authoredBattleLevelTarget("gym-leader", [29, 24, 29], 31),
  "rocket-hideout-giovanni": authoredBattleLevelTarget("boss", [25, 24, 29], 31),
  "rival-pokemon-tower": authoredBattleLevelTarget(
    "rival",
    [25, 23, 22, 20, 25],
    27,
  ),
  "rival-silph": authoredBattleLevelTarget("rival", [37, 38, 35, 35, 40], 42),
  "silph-liberated": authoredBattleLevelTarget("boss", [37, 35, 37, 41], 43),
  "badge-soul": authoredBattleLevelTarget("gym-leader", [37, 39, 37, 43], 45),
  "badge-marsh": authoredBattleLevelTarget("gym-leader", [38, 37, 38, 43], 45),
  "badge-volcano": authoredBattleLevelTarget("gym-leader", [42, 40, 42, 47], 49),
  "badge-earth": authoredBattleLevelTarget(
    "gym-leader",
    [45, 42, 44, 45, 50],
    52,
  ),
  "rival-route22-late": authoredBattleLevelTarget(
    "rival",
    [47, 45, 45, 45, 47, 53],
    55,
  ),
  "elite-four-lorelei": authoredBattleLevelTarget(
    "elite-four",
    [52, 51, 52, 54, 54],
    FIRST_CLEAR_LEAGUE_TEAM_TARGET_LEVEL,
    {
      supportBattleTargetLevel: FIRST_CLEAR_LEAGUE_TEAM_TARGET_LEVEL,
      minimumReadyBattleMembers: FIRST_CLEAR_LEAGUE_MINIMUM_READY_MEMBERS,
    },
  ),
  "elite-four-bruno": authoredBattleLevelTarget(
    "elite-four",
    [51, 53, 53, 54, 56],
    FIRST_CLEAR_LEAGUE_TEAM_TARGET_LEVEL,
    {
      supportBattleTargetLevel: FIRST_CLEAR_LEAGUE_TEAM_TARGET_LEVEL,
      minimumReadyBattleMembers: FIRST_CLEAR_LEAGUE_MINIMUM_READY_MEMBERS,
    },
  ),
  "elite-four-agatha": authoredBattleLevelTarget(
    "elite-four",
    [54, 54, 53, 56, 58],
    FIRST_CLEAR_LEAGUE_TEAM_TARGET_LEVEL,
    {
      supportBattleTargetLevel: FIRST_CLEAR_LEAGUE_TEAM_TARGET_LEVEL,
      minimumReadyBattleMembers: FIRST_CLEAR_LEAGUE_MINIMUM_READY_MEMBERS,
    },
  ),
  "elite-four-lance": authoredBattleLevelTarget(
    "elite-four",
    [56, 54, 54, 58, 60],
    FIRST_CLEAR_LEAGUE_TEAM_TARGET_LEVEL,
    {
      supportBattleTargetLevel: FIRST_CLEAR_LEAGUE_TEAM_TARGET_LEVEL,
      minimumReadyBattleMembers: FIRST_CLEAR_LEAGUE_MINIMUM_READY_MEMBERS,
    },
  ),
  champion: authoredBattleLevelTarget(
    "champion",
    [59, 57, 59, 59, 61, 63],
    FIRST_CLEAR_LEAGUE_TEAM_TARGET_LEVEL,
    {
      supportBattleTargetLevel: FIRST_CLEAR_LEAGUE_TEAM_TARGET_LEVEL,
      minimumReadyBattleMembers: FIRST_CLEAR_LEAGUE_MINIMUM_READY_MEMBERS,
    },
  ),
});
const IMPORTANT_BATTLE_LEVEL_TARGETS = CAMPAIGN_MAJOR_BATTLE_LEVEL_TARGETS;
export const IMPORTANT_BATTLE_TRAINER_NAMES = Object.freeze({
  "rival-oaks-lab": Object.freeze([
    "TRAINER_RIVAL_OAKS_LAB_SQUIRTLE",
    "TRAINER_RIVAL_OAKS_LAB_BULBASAUR",
    "TRAINER_RIVAL_OAKS_LAB_CHARMANDER",
  ]),
  "rival-route22-early": Object.freeze([
    "TRAINER_RIVAL_ROUTE22_EARLY_SQUIRTLE",
    "TRAINER_RIVAL_ROUTE22_EARLY_BULBASAUR",
    "TRAINER_RIVAL_ROUTE22_EARLY_CHARMANDER",
  ]),
  "badge-boulder": Object.freeze(["TRAINER_LEADER_BROCK"]),
  "rival-cerulean": Object.freeze([
    "TRAINER_RIVAL_CERULEAN_SQUIRTLE",
    "TRAINER_RIVAL_CERULEAN_BULBASAUR",
    "TRAINER_RIVAL_CERULEAN_CHARMANDER",
  ]),
  "badge-cascade": Object.freeze(["TRAINER_LEADER_MISTY"]),
  "rival-ss-anne": Object.freeze([
    "TRAINER_RIVAL_SS_ANNE_SQUIRTLE",
    "TRAINER_RIVAL_SS_ANNE_BULBASAUR",
    "TRAINER_RIVAL_SS_ANNE_CHARMANDER",
  ]),
  "badge-thunder": Object.freeze(["TRAINER_LEADER_LT_SURGE"]),
  "badge-rainbow": Object.freeze(["TRAINER_LEADER_ERIKA"]),
  "rocket-hideout-giovanni": Object.freeze(["TRAINER_BOSS_GIOVANNI"]),
  "rival-pokemon-tower": Object.freeze([
    "TRAINER_RIVAL_POKEMON_TOWER_SQUIRTLE",
    "TRAINER_RIVAL_POKEMON_TOWER_BULBASAUR",
    "TRAINER_RIVAL_POKEMON_TOWER_CHARMANDER",
  ]),
  "rival-silph": Object.freeze([
    "TRAINER_RIVAL_SILPH_SQUIRTLE",
    "TRAINER_RIVAL_SILPH_BULBASAUR",
    "TRAINER_RIVAL_SILPH_CHARMANDER",
  ]),
  "silph-liberated": Object.freeze(["TRAINER_BOSS_GIOVANNI_2"]),
  "badge-soul": Object.freeze(["TRAINER_LEADER_KOGA"]),
  "badge-marsh": Object.freeze(["TRAINER_LEADER_SABRINA"]),
  "badge-volcano": Object.freeze(["TRAINER_LEADER_BLAINE"]),
  "badge-earth": Object.freeze(["TRAINER_LEADER_GIOVANNI"]),
  "rival-route22-late": Object.freeze([
    "TRAINER_RIVAL_ROUTE22_LATE_SQUIRTLE",
    "TRAINER_RIVAL_ROUTE22_LATE_BULBASAUR",
    "TRAINER_RIVAL_ROUTE22_LATE_CHARMANDER",
  ]),
  "elite-four-lorelei": Object.freeze(["TRAINER_ELITE_FOUR_LORELEI"]),
  "elite-four-bruno": Object.freeze(["TRAINER_ELITE_FOUR_BRUNO"]),
  "elite-four-agatha": Object.freeze(["TRAINER_ELITE_FOUR_AGATHA"]),
  "elite-four-lance": Object.freeze(["TRAINER_ELITE_FOUR_LANCE"]),
  champion: Object.freeze([
    "TRAINER_CHAMPION_FIRST_SQUIRTLE",
    "TRAINER_CHAMPION_FIRST_BULBASAUR",
    "TRAINER_CHAMPION_FIRST_CHARMANDER",
  ]),
});
const GYM_LEADER_TRAINERS = Object.freeze({
  "badge-boulder": "TRAINER_LEADER_BROCK",
  "badge-cascade": "TRAINER_LEADER_MISTY",
  "badge-thunder": "TRAINER_LEADER_LT_SURGE",
  "badge-rainbow": "TRAINER_LEADER_ERIKA",
  "badge-soul": "TRAINER_LEADER_KOGA",
  "badge-marsh": "TRAINER_LEADER_SABRINA",
  "badge-volcano": "TRAINER_LEADER_BLAINE",
  "badge-earth": "TRAINER_LEADER_GIOVANNI",
});
const IMPORTANT_BATTLE_APPROACH_MOVES = Object.freeze({
  "badge-thunder": Object.freeze([15]),
  "badge-rainbow": Object.freeze([15]),
});
const COIN_CASE_ITEM_ID = 260;
const EXP_SHARE_ITEM_ID = 182;
const EXP_SHARE_FLAG_ID = 598;
const VS_SEEKER_ITEM_ID = 362;
const VS_SEEKER_FLAG_ID = 658;
const KANTO_FLY_DESTINATION_VISITED_FLAG_IDS = Object.freeze(
  Array.from({ length: 11 }, (_, index) => 2192 + index),
);
const SILPH_SCOPE_ITEM_ID = 359;
const COIN_CASE_FLAG_ID = 579;
const SEVII_DETOUR_FINISHED_FLAG_ID = 673;
const VISITED_TWO_ISLAND_FLAG_ID = 674;
const RESCUED_LOSTELLE_FLAG_ID = 675;
const PC_STORAGE_DISABLED_FLAG_ID = 2113;
const HALL_OF_FAME_FLAG_ID = 2092;
const LEAGUE_BATTLE_FLAG_IDS = Object.freeze([0x4b8, 0x4b9, 0x4ba, 0x4bb]);
const ONE_ISLAND_POKEMON_CENTER_SCENE_VARIABLE_ID = 16502;
const TWO_ISLAND_GAME_CORNER_SCENE_VARIABLE_ID = 16505;
const THREE_ISLAND_SCENE_VARIABLE_ID = 16507;
const MANDATORY_CAPTURE_BALL_TARGET = 12;
const REGIONAL_MASTERY_BALL_TARGET = 30;
const MART_ITEM_UNIT_PRICES = Object.freeze({
  ...CAPTURE_BALL_UNIT_PRICES,
  13: 300,
  14: 100,
  15: 250,
  16: 250,
  17: 250,
  18: 200,
  19: 3000,
  20: 2500,
  21: 1200,
  22: 700,
  23: 600,
  24: 1500,
});
const MASTERY_MEDICINE_GROUPS = Object.freeze([
  Object.freeze({
    priority: "medicine",
    desired: 6,
    preferredItemIds: Object.freeze([19, 20, 21, 22, 13]),
  }),
  Object.freeze({
    priority: "revives",
    desired: 2,
    preferredItemIds: Object.freeze([24]),
  }),
  Object.freeze({
    priority: "status-medicine",
    desired: 2,
    preferredItemIds: Object.freeze([23, 18, 17, 14, 15, 16]),
  }),
]);
const IMPORTANT_BATTLE_MEDICINE_GROUPS = Object.freeze(
  MASTERY_MEDICINE_GROUPS.slice(0, 2),
);
const SPECIFIC_STATUS_MEDICINE_TARGETS = Object.freeze([
  Object.freeze({ itemId: 14, desired: 2 }),
  Object.freeze({ itemId: 15, desired: 2 }),
  Object.freeze({ itemId: 16, desired: 2 }),
  Object.freeze({ itemId: 17, desired: 2 }),
  Object.freeze({ itemId: 18, desired: 2 }),
]);
const BROAD_STATUS_MEDICINE_IDS = Object.freeze([23, 19, 32]);
const BROAD_STATUS_MEDICINE_TARGET = 4;
const IMPORTANT_BATTLE_HEALING_ITEM_HP = Object.freeze(new Map([
  [13, 20],
  [22, 50],
  [21, 200],
  [20, Number.POSITIVE_INFINITY],
]));
const IMPORTANT_BATTLE_HEALING_RESERVE_IDS = Object.freeze([
  13, 19, 20, 21, 22, 26, 27, 28, 29,
]);
const IMPORTANT_BATTLE_STATUS_THREATS = Object.freeze({
  "badge-thunder": Object.freeze([18]),
  "badge-rainbow": Object.freeze([17]),
  "rival-pokemon-tower": Object.freeze([17]),
  "rival-silph": Object.freeze([17]),
  "silph-liberated": Object.freeze([14]),
  "badge-soul": Object.freeze([14]),
  "badge-marsh": Object.freeze([17, 18]),
  "badge-volcano": Object.freeze([15]),
  "elite-four-lorelei": Object.freeze([16, 18]),
  "elite-four-agatha": Object.freeze([14, 17]),
  champion: Object.freeze([14, 17, 18]),
});
const TRAINER_FLAGS_START = 0x500;
const VS_SEEKER_CELADON_VISITED_FLAG_ID = 0x896;
const VS_SEEKER_FUCHSIA_VISITED_FLAG_ID = 0x897;
const VS_SEEKER_GAME_CLEAR_FLAG_ID = 0x82c;
const VS_SEEKER_RS_LINK_FLAG_ID = 0x844;
const TRAINER_LOCALITY_TRANSITION_MARGIN = 1;
const IMPORTANT_BATTLE_TRAINING_STAGING_RADIUS = 2;
const TRAINER_TRAINING_SCRIPT_OPS = new Set([
  "trainerbattle_single",
  "trainerbattle_no_intro",
]);
const POTENTIAL_WILD_SWITCH_TRAPPERS = new Set([
  "50",
  "51",
  "SPECIES_DIGLETT",
  "SPECIES_DUGTRIO",
]);
const REGIONAL_MASTERY_TRAINER_SCRIPT_OPS = new Set([
  "trainerbattle_single",
  "trainerbattle_no_intro",
  "trainerbattle_double",
  "trainerbattle_rematch",
  "trainerbattle_rematch_double",
]);
const REGIONAL_MASTERY_STAGES = Object.freeze([
  Object.freeze({
    badgeFlagId: 2080,
    maps: Object.freeze([
      "MAP_ROUTE1",
      "MAP_ROUTE2",
      "MAP_ROUTE22",
      "MAP_VIRIDIAN_FOREST",
      "MAP_ROUTE3",
      "MAP_MT_MOON_1F",
      "MAP_MT_MOON_B1F",
      "MAP_MT_MOON_B2F",
      "MAP_ROUTE4",
    ]),
  }),
  Object.freeze({
    badgeFlagId: 2081,
    maps: Object.freeze([
      "MAP_ROUTE24",
      "MAP_ROUTE25",
      "MAP_ROUTE5",
      "MAP_ROUTE6",
    ]),
  }),
  Object.freeze({
    badgeFlagId: 2082,
    maps: Object.freeze([
      "MAP_ROUTE11",
      "MAP_DIGLETTS_CAVE_B1F",
      "MAP_ROUTE9",
      "MAP_ROUTE10",
      "MAP_ROCK_TUNNEL_1F",
      "MAP_ROCK_TUNNEL_B1F",
      "MAP_ROUTE8",
      "MAP_ROUTE7",
    ]),
  }),
  Object.freeze({
    badgeFlagId: 2083,
    maps: Object.freeze([
      "MAP_POKEMON_TOWER_3F",
      "MAP_POKEMON_TOWER_4F",
      "MAP_POKEMON_TOWER_5F",
      "MAP_POKEMON_TOWER_6F",
      "MAP_POKEMON_TOWER_7F",
      "MAP_ROUTE12",
      "MAP_ROUTE13",
      "MAP_ROUTE14",
      "MAP_ROUTE15",
      "MAP_ROUTE16",
      "MAP_ROUTE17",
      "MAP_ROUTE18",
      "MAP_SAFARI_ZONE_CENTER",
      "MAP_SAFARI_ZONE_EAST",
      "MAP_SAFARI_ZONE_NORTH",
      "MAP_SAFARI_ZONE_WEST",
    ]),
  }),
  Object.freeze({
    badgeFlagId: 2084,
    maps: Object.freeze([
      "MAP_POWER_PLANT",
      "MAP_ROUTE19",
      "MAP_ROUTE20",
      "MAP_ROUTE21",
      "MAP_SEAFOAM_ISLANDS_1F",
      "MAP_SEAFOAM_ISLANDS_B1F",
      "MAP_SEAFOAM_ISLANDS_B2F",
      "MAP_SEAFOAM_ISLANDS_B3F",
      "MAP_SEAFOAM_ISLANDS_B4F",
    ]),
  }),
  Object.freeze({
    badgeFlagId: 2085,
    maps: Object.freeze([]),
  }),
  Object.freeze({
    badgeFlagId: 2086,
    maps: Object.freeze([
      "MAP_POKEMON_MANSION_1F",
      "MAP_POKEMON_MANSION_2F",
      "MAP_POKEMON_MANSION_3F",
      "MAP_POKEMON_MANSION_B1F",
    ]),
  }),
  Object.freeze({
    badgeFlagId: 2087,
    maps: Object.freeze([
      "MAP_ROUTE23",
      "MAP_VICTORY_ROAD_1F",
      "MAP_VICTORY_ROAD_2F",
      "MAP_VICTORY_ROAD_3F",
    ]),
  }),
]);
const OPTIONAL_MAP_REQUIREMENTS = Object.freeze({
  MAP_ROUTE3: Object.freeze({ kind: "variable-at-least", id: 0x406c, value: 1 }),
  MAP_ROUTE4: Object.freeze({ kind: "flag-set", id: 562 }),
  MAP_ROUTE5: Object.freeze({ kind: "variable-at-least", id: 0x407d, value: 1 }),
  MAP_ROUTE6: Object.freeze({ kind: "variable-at-least", id: 0x407d, value: 1 }),
  MAP_SAFFRON_CITY_GYM: Object.freeze({ kind: "flag-set", id: 83 }),
  MAP_POKEMON_TOWER_3F: Object.freeze({
    kind: "item-at-least",
    id: SILPH_SCOPE_ITEM_ID,
    quantity: 1,
  }),
  MAP_POKEMON_TOWER_4F: Object.freeze({
    kind: "item-at-least",
    id: SILPH_SCOPE_ITEM_ID,
    quantity: 1,
  }),
  MAP_POKEMON_TOWER_5F: Object.freeze({
    kind: "item-at-least",
    id: SILPH_SCOPE_ITEM_ID,
    quantity: 1,
  }),
  MAP_POKEMON_TOWER_6F: Object.freeze({
    kind: "item-at-least",
    id: SILPH_SCOPE_ITEM_ID,
    quantity: 1,
  }),
  MAP_POKEMON_TOWER_7F: Object.freeze({
    kind: "item-at-least",
    id: SILPH_SCOPE_ITEM_ID,
    quantity: 1,
  }),
});
const PARTIAL_MAP_ACCESS_ANCHORS = Object.freeze({
  // Route 4 contains two cartridge-disconnected sides. Its western region is
  // the legal approach from Route 3 to Mt. Moon; the eastern regions remain
  // behind the fossil scene until that scene completes.
  MAP_ROUTE4: Object.freeze(["MAP_ROUTE3"]),
});
const OAK_AIDE_REWARDS = Object.freeze([
  Object.freeze({
    id: "oak-aide-hm05-flash",
    map: "MAP_ROUTE2_EAST_BUILDING",
    objectIndex: 0,
    countKind: "seen",
    threshold: 10,
    itemId: 343,
    flagId: 571,
    minimumBadgeFlagId: 2082,
    fieldEnabling: true,
  }),
  Object.freeze({
    id: "oak-aide-everstone",
    map: "MAP_ROUTE10_POKEMON_CENTER_1F",
    objectIndex: 4,
    countKind: "owned",
    threshold: 20,
    itemId: 195,
    flagId: 762,
    minimumBadgeFlagId: 2082,
  }),
  Object.freeze({
    id: "oak-aide-itemfinder",
    map: "MAP_ROUTE11_EAST_ENTRANCE_2F",
    objectIndex: 1,
    countKind: "owned",
    threshold: 30,
    itemId: 261,
    flagId: 594,
    minimumBadgeFlagId: 2082,
  }),
  Object.freeze({
    id: "oak-aide-amulet-coin",
    map: "MAP_ROUTE16_NORTH_ENTRANCE_2F",
    objectIndex: 2,
    countKind: "owned",
    threshold: 40,
    itemId: 189,
    flagId: 765,
    minimumBadgeFlagId: 2083,
  }),
  Object.freeze({
    id: "oak-aide-exp-share",
    map: "MAP_ROUTE15_WEST_ENTRANCE_2F",
    objectIndex: 0,
    countKind: "owned",
    threshold: 50,
    itemId: 182,
    flagId: 598,
    minimumBadgeFlagId: 2083,
  }),
]);


const OAK_PARCEL = Object.freeze({
  id: "oak-parcel",
  target: Object.freeze({
    kind: "warp",
    map: "MAP_VIRIDIAN_CITY",
    index: 4,
  }),
  completion: Object.freeze({
    kind: "variable-at-least",
    id: 16471,
    value: 1,
  }),
  dialogue: "advance",
});

const REGIONAL_POKEDEX = Object.freeze({
  id: "regional-pokedex",
  target: Object.freeze({
    kind: "object",
    map: "MAP_PALLET_TOWN_PROFESSOR_OAKS_LAB",
    index: 3,
  }),
  completion: Object.freeze({ kind: "flag-set", id: 2089 }),
  dialogue: "advance",
});

function routeObjective(id, target, completion, options = {}) {
  const importantBattleId = options.rosterPreparationFor ?? id;
  const minimumBattlePartySize = IMPORTANT_BATTLE_PARTY_MINIMUMS[importantBattleId];
  const battleLevelTarget = IMPORTANT_BATTLE_LEVEL_TARGETS[importantBattleId];
  const requiredApproachMoveIds = IMPORTANT_BATTLE_APPROACH_MOVES[importantBattleId];
  return Object.freeze({
    id,
    target: Object.freeze(target),
    completion: Object.freeze(completion),
    dialogue: options.dialogue ?? "advance",
    ...options,
    ...(minimumBattlePartySize
      ? {
          importantBattle: true,
          minimumBattlePartySize,
          battleCategory: battleLevelTarget.category,
          enemyPartyLevels: battleLevelTarget.enemyPartyLevels,
          enemyPartySize: battleLevelTarget.enemyPartySize,
          enemyAceLevel: battleLevelTarget.enemyAceLevel,
          starterBattleTargetLevel: battleLevelTarget.starterBattleTargetLevel,
          supportBattleTargetLevel: battleLevelTarget.supportBattleTargetLevel,
          minimumReadyBattleMembers: battleLevelTarget.minimumReadyBattleMembers,
          battleTeamTargetLevel: battleLevelTarget.battleTeamTargetLevel,
          minimumBattleMemberLevel: battleLevelTarget.supportBattleTargetLevel,
          minimumTeamAnchorLevel: battleLevelTarget.battleTeamTargetLevel,
        }
      : {}),
    ...(requiredApproachMoveIds ? { requiredApproachMoveIds } : {}),
  });
}

function teachMoveObjective(id, itemId, moveId, partySpecies, options = {}) {
  const { replaceMoveId, completeAfterFlagId, ...metadata } = options;
  const moveCompletion = { kind: "party-knows-move", moveId };
  const completion = Number.isSafeInteger(completeAfterFlagId)
    ? anyCompletion(moveCompletion, { kind: "flag-set", id: completeAfterFlagId })
    : moveCompletion;
  return routeObjective(id, {
    kind: "teach-move",
    itemId,
    moveId,
    partySpecies,
    ...(Number.isSafeInteger(replaceMoveId)
      ? { replaceMoveId }
      : {}),
  }, completion, metadata);
}

const BLASTOISE_FAMILY = Object.freeze([7, 8, 9]);

function blastoiseLeagueSurfObjective() {
  return routeObjective("teach-blastoise-surf-for-league", {
    kind: "teach-move",
    itemId: 341,
    moveId: 57,
    partySpecies: BLASTOISE_FAMILY,
    replaceMoveId: 55,
  }, anyCompletion(
    { kind: "party-family-knows-move", species: BLASTOISE_FAMILY, moveId: 57 },
    { kind: "party-family-lacks-move", species: BLASTOISE_FAMILY, moveId: 55 },
  ), { deferOptionalDetours: true });
}

function anyCompletion(...completions) {
  return { kind: "any", completions };
}

function authoredBoulderPath(x, y, segments) {
  const deltas = {
    north: [0, -1],
    south: [0, 1],
    east: [1, 0],
    west: [-1, 0],
  };
  const path = [{ x: Number(x), y: Number(y) }];
  for (const [direction, distance] of segments) {
    const delta = deltas[direction];
    if (!delta || !Number.isSafeInteger(distance) || distance < 1) {
      throw new TypeError("authored boulder path segment is invalid");
    }
    for (let step = 0; step < distance; step += 1) {
      const previous = path.at(-1);
      path.push({
        x: previous.x + delta[0],
        y: previous.y + delta[1],
      });
    }
  }
  return Object.freeze(path.map((coordinate) => Object.freeze(coordinate)));
}

const MAIN_STORY_AFTER_POKEDEX = Object.freeze([
  routeObjective("rival-route22-early",
    { kind: "trigger", map: "MAP_ROUTE22", index: 0 },
    { kind: "variable-at-least", id: 0x4054, value: 2 }),
  routeObjective("badge-boulder",
    { kind: "object", map: "MAP_PEWTER_CITY_GYM", index: 0 },
    { kind: "flag-set", id: 2080 }, { minimumTeamAnchorLevel: 12 }),
  routeObjective("mt-moon-fossil",
    { kind: "object", map: "MAP_MT_MOON_B2F", index: 1 },
    { kind: "flag-set", id: 562 }, { choice: "yes" }),
  routeObjective("rival-cerulean",
    { kind: "trigger", map: "MAP_CERULEAN_CITY", index: 0 },
    { kind: "variable-at-least", id: 0x4052, value: 1 },
    { minimumTeamAnchorLevel: 18 }),
  routeObjective("bill-enter-teleporter",
    { kind: "object", map: "MAP_ROUTE25_SEA_COTTAGE", index: 1 },
    anyCompletion(
      { kind: "flag-set", id: 2 },
      { kind: "flag-set", id: 563 },
      { kind: "flag-set", id: 564 },
    ), { choice: "yes" }),
  routeObjective("bill-cell-separator",
    { kind: "background", map: "MAP_ROUTE25_SEA_COTTAGE", index: 0 },
    anyCompletion(
      { kind: "flag-set", id: 563 },
      { kind: "flag-set", id: 564 },
    )),
  routeObjective("ss-ticket",
    { kind: "object", map: "MAP_ROUTE25_SEA_COTTAGE", index: 0 },
    { kind: "flag-set", id: 564 }),
  routeObjective("badge-cascade",
    { kind: "object", map: "MAP_CERULEAN_CITY_GYM", index: 2 },
    { kind: "flag-set", id: 2081 }, { minimumTeamAnchorLevel: 19 }),
  routeObjective("cerulean-rocket",
    { kind: "cerulean-rocket", map: "MAP_CERULEAN_CITY" },
    { kind: "variable-at-least", id: 0x407d, value: 1 }),
  routeObjective("vs-seeker",
    {
      kind: "object",
      map: "MAP_VERMILION_CITY_POKEMON_CENTER_1F",
      index: 4,
    },
    anyCompletion(
      { kind: "flag-set", id: VS_SEEKER_FLAG_ID },
      { kind: "item-at-least", id: VS_SEEKER_ITEM_ID, quantity: 1 },
    ),
    { dialogue: "advance", deferOptionalDetours: true }),
  routeObjective("rival-ss-anne",
    { kind: "trigger", map: "MAP_SSANNE_2F_CORRIDOR", index: 0 },
    { kind: "variable-at-least", id: 0x405b, value: 1 },
    { minimumTeamAnchorLevel: 20, ceruleanPassage: true }),
  routeObjective("hm-cut",
    { kind: "object", map: "MAP_SSANNE_CAPTAINS_OFFICE", index: 0 },
    { kind: "flag-set", id: 567 }),
  teachMoveObjective("teach-cut", 339, 15, [1, 2, 3], {
    completeAfterFlagId: 2082,
  }),
  routeObjective("surge-first-lock",
    { kind: "variable-background", map: "MAP_VERMILION_CITY_GYM",
      variableId: 0x4000, indexOffset: 1, minimum: 1, fallbackIndex: 2 },
    anyCompletion(
      { kind: "flag-set", id: 1 },
      { kind: "flag-set", id: 612 },
      { kind: "flag-set", id: 2082 },
    )),
  routeObjective("surge-second-lock",
    { kind: "variable-background", map: "MAP_VERMILION_CITY_GYM",
      variableId: 0x4001, indexOffset: 1, minimum: 1, fallbackIndex: 2 },
    anyCompletion(
      { kind: "flag-set", id: 612 },
      { kind: "flag-set", id: 2082 },
    )),
  routeObjective("badge-thunder",
    { kind: "object", map: "MAP_VERMILION_CITY_GYM", index: 0 },
    { kind: "flag-set", id: 2082 }, { minimumTeamAnchorLevel: 23 }),
  routeObjective("coin-case",
    { kind: "object", map: "MAP_CELADON_CITY_RESTAURANT", index: 3 },
    anyCompletion(
      { kind: "flag-set", id: COIN_CASE_FLAG_ID },
      { kind: "item-at-least", id: COIN_CASE_ITEM_ID, quantity: 1 },
    )),
  routeObjective("badge-rainbow",
    { kind: "object", map: "MAP_CELADON_CITY_GYM", index: 6 },
    { kind: "flag-set", id: 2083 }, { minimumTeamAnchorLevel: 28 }),
  routeObjective("tea",
    { kind: "object", map: "MAP_CELADON_CITY_CONDOMINIUMS_1F", index: 3 },
    { kind: "flag-set", id: 678 }),
  routeObjective("game-corner-rocket",
    { kind: "object", map: "MAP_CELADON_CITY_GAME_CORNER", index: 10 },
    { kind: "flag-set", id: 0x665 }),
  routeObjective("rocket-hideout-poster",
    { kind: "background", map: "MAP_CELADON_CITY_GAME_CORNER", index: 34 },
    { kind: "flag-set", id: 0x26d }, {
      rosterPreparationFor: "rocket-hideout-giovanni",
      minimumTeamAnchorLevel: 30,
    }),
  routeObjective("rocket-hideout-lift-key-grunt",
    { kind: "object", map: "MAP_ROCKET_HIDEOUT_B4F", index: 2 },
    { kind: "flag-set", id: 0x670 }),
  routeObjective("rocket-hideout-lift-key",
    { kind: "object", map: "MAP_ROCKET_HIDEOUT_B4F", index: 3 },
    { kind: "item-at-least", id: 356, quantity: 1 }),
  routeObjective("rocket-hideout-door-grunt-left",
    { kind: "object", map: "MAP_ROCKET_HIDEOUT_B4F", index: 5 },
    { kind: "flag-set", id: 0x66e }, {
      rocketHideoutElevator: true,
      choiceIndex: 2,
      choiceMaps: ["MAP_ROCKET_HIDEOUT_ELEVATOR"],
    }),
  routeObjective("rocket-hideout-door-grunt-right",
    { kind: "object", map: "MAP_ROCKET_HIDEOUT_B4F", index: 4 },
    { kind: "flag-set", id: 0x66f }, {
      rocketHideoutElevator: true,
      choiceIndex: 2,
      choiceMaps: ["MAP_ROCKET_HIDEOUT_ELEVATOR"],
    }),
  routeObjective("rocket-hideout-giovanni",
    { kind: "object", map: "MAP_ROCKET_HIDEOUT_B4F", index: 0 },
    { kind: "flag-set", id: 0x65c }, {
      minimumTeamAnchorLevel: 30,
      rocketHideoutElevator: true,
      choiceIndex: 2,
      choiceMaps: ["MAP_ROCKET_HIDEOUT_ELEVATOR"],
    }),
  routeObjective("silph-scope",
    { kind: "object", map: "MAP_ROCKET_HIDEOUT_B4F", index: 1 },
    { kind: "item-at-least", id: SILPH_SCOPE_ITEM_ID, quantity: 1 }, {
      rocketHideoutElevator: true,
      choiceIndex: 2,
      choiceMaps: ["MAP_ROCKET_HIDEOUT_ELEVATOR"],
    }),
  routeObjective("rocket-hideout-exit",
    { kind: "rocket-hideout-exit", map: "MAP_CELADON_CITY_GAME_CORNER" },
    { kind: "map-not-in", maps: [
      "MAP_ROCKET_HIDEOUT_B1F",
      "MAP_ROCKET_HIDEOUT_B2F",
      "MAP_ROCKET_HIDEOUT_B3F",
      "MAP_ROCKET_HIDEOUT_B4F",
      "MAP_ROCKET_HIDEOUT_ELEVATOR",
    ] }, {
      choiceIndex: 0,
      choiceMaps: ["MAP_ROCKET_HIDEOUT_ELEVATOR"],
    }),
  routeObjective("rival-pokemon-tower",
    { kind: "trigger", map: "MAP_POKEMON_TOWER_2F", index: 0 },
    { kind: "variable-at-least", id: 0x405d, value: 1 },
    { minimumTeamAnchorLevel: 25 }),
  routeObjective("mr-fuji",
    { kind: "object", map: "MAP_POKEMON_TOWER_7F", index: 0 },
    { kind: "flag-set", id: 572 }),
  routeObjective("poke-flute",
    { kind: "object", map: "MAP_LAVENDER_TOWN_VOLUNTEER_POKEMON_HOUSE", index: 0 },
    { kind: "flag-set", id: 573 }),
  routeObjective("silph-card-key",
    { kind: "object", map: "MAP_SILPH_CO_5F", index: 7 },
    { kind: "item-at-least", id: 355, quantity: 1 }),
  routeObjective("silph-third-floor-door-two",
    { kind: "background", map: "MAP_SILPH_CO_3F", index: 2 },
    { kind: "flag-set", id: 637 }),
  routeObjective("silph-third-floor-door",
    { kind: "background", map: "MAP_SILPH_CO_3F", index: 0 },
    { kind: "flag-set", id: 636 }),
  routeObjective("silph-coverage-tm",
    { kind: "purchase-items", map: "MAP_CELADON_CITY_DEPARTMENT_STORE_2F",
      objectIndex: 2, items: [
        { itemId: 331, stockIndex: 4, quantity: 1, unitPrice: 3000 },
      ] },
    anyCompletion(
      { kind: "item-at-least", id: 331, quantity: 1 },
      { kind: "party-knows-move", moveId: 290 },
    )),
  teachMoveObjective("teach-secret-power", 331, 290, [1, 2, 3], {
    replaceMoveId: 75,
  }),
  routeObjective("silph-supplies",
    { kind: "purchase-items", map: "MAP_SAFFRON_CITY_MART",
      objectIndex: 0, items: [
        { itemId: 21, stockIndex: 1, quantity: 8, unitPrice: 1200 },
        { itemId: 23, stockIndex: 3, quantity: 4, unitPrice: 600 },
        { itemId: 3, stockIndex: 0, quantity: 15, unitPrice: 600 },
      ] },
    anyCompletion(
      { kind: "all", completions: [
        { kind: "item-at-least", id: 21, quantity: 8 },
        { kind: "item-at-least", id: 23, quantity: 4 },
        { kind: "item-at-least", id: 3, quantity: 15 },
      ] },
      { kind: "variable-at-least", id: 0x405c, value: 1 },
    )),
  routeObjective("rival-silph",
    { kind: "trigger", map: "MAP_SILPH_CO_7F", index: 0 },
    { kind: "variable-at-least", id: 0x405c, value: 1 },
    { minimumTeamAnchorLevel: 48 }),
  routeObjective("gift-lapras",
    { kind: "object", map: "MAP_SILPH_CO_7F", index: 1 },
    { kind: "owned-species", species: [131] },
    { choice: "no", reservedPartySlots: 1 }),
  routeObjective("silph-eleventh-floor-door",
    { kind: "background", map: "MAP_SILPH_CO_11F", index: 0 },
    { kind: "flag-set", id: 653 }),
  routeObjective("silph-liberated",
    { kind: "trigger", map: "MAP_SILPH_CO_11F", index: 0 },
    { kind: "flag-set", id: 83 }),
  routeObjective("route12-snorlax",
    { kind: "object", map: "MAP_ROUTE12", index: 4 },
    { kind: "all", completions: [
      { kind: "flag-set", id: 84 },
      { kind: "owned-species", species: [143] },
    ] }, {
      choice: "yes",
      captureSpecies: Object.freeze([143]),
      captureFamily: Object.freeze([143]),
      encounter: Object.freeze({ minimumLevel: 30, maximumLevel: 30 }),
    }),
  routeObjective("gold-teeth",
    { kind: "object", map: "MAP_SAFARI_ZONE_WEST", index: 0 },
    { kind: "flag-set", id: 393 }, { choice: "yes" }),
  routeObjective("hm-surf",
    { kind: "object", map: "MAP_SAFARI_ZONE_SECRET_HOUSE", index: 0 },
    { kind: "flag-set", id: 569 }, { choice: "yes" }),
  routeObjective("hm-strength",
    { kind: "object", map: "MAP_FUCHSIA_CITY_WARDENS_HOUSE", index: 0 },
    { kind: "flag-set", id: 570 }),
  teachMoveObjective("teach-surf", 341, 57, [131]),
  teachMoveObjective("teach-strength", 342, 70, [1, 2, 3]),
  routeObjective("badge-soul",
    { kind: "object", map: "MAP_FUCHSIA_CITY_GYM", index: 6 },
    { kind: "flag-set", id: 2084 }, { minimumTeamAnchorLevel: 40 }),
  routeObjective("badge-marsh",
    { kind: "object", map: "MAP_SAFFRON_CITY_GYM", index: 6 },
    { kind: "flag-set", id: 2085 }, { minimumTeamAnchorLevel: 41 }),
  routeObjective("secret-key",
    { kind: "mansion-secret-key", map: "MAP_POKEMON_MANSION_B1F", index: 5 },
    { kind: "flag-set", id: 424 }),
  routeObjective("cinnabar-gym-quinn",
    { kind: "object", map: "MAP_CINNABAR_ISLAND_GYM", index: 0 },
    { kind: "flag-set", id: 0x5d5 }),
  routeObjective("cinnabar-gym-erik",
    { kind: "object", map: "MAP_CINNABAR_ISLAND_GYM", index: 1 },
    { kind: "flag-set", id: 0x5b1 }),
  routeObjective("cinnabar-gym-avery",
    { kind: "object", map: "MAP_CINNABAR_ISLAND_GYM", index: 2 },
    { kind: "flag-set", id: 0x5b2 }),
  routeObjective("cinnabar-gym-ramon",
    { kind: "object", map: "MAP_CINNABAR_ISLAND_GYM", index: 3 },
    { kind: "flag-set", id: 0x5d6 }),
  routeObjective("cinnabar-gym-derek",
    { kind: "object", map: "MAP_CINNABAR_ISLAND_GYM", index: 4 },
    { kind: "flag-set", id: 0x5b3 }),
  routeObjective("cinnabar-gym-dusty",
    { kind: "object", map: "MAP_CINNABAR_ISLAND_GYM", index: 5 },
    { kind: "flag-set", id: 0x5d7 }),
  routeObjective("cinnabar-gym-zac",
    { kind: "object", map: "MAP_CINNABAR_ISLAND_GYM", index: 6 },
    { kind: "flag-set", id: 0x5b4 }),
  routeObjective("badge-volcano",
    { kind: "object", map: "MAP_CINNABAR_ISLAND_GYM", index: 7 },
    { kind: "flag-set", id: 2086 }, {
      minimumCoreLevel: 45,
      coreSpecies: [131],
    }),
  routeObjective("badge-earth",
    { kind: "object", map: "MAP_VIRIDIAN_CITY_GYM", index: 7 },
    { kind: "flag-set", id: 2087 }, {
      minimumTeamAnchorLevel: 48,
      choice: "no",
      choiceMaps: ["MAP_CINNABAR_ISLAND"],
    }),
  routeObjective("rival-route22-late",
    { kind: "trigger", map: "MAP_ROUTE22", index: 3 },
    { kind: "variable-at-least", id: 0x4054, value: 4 },
    { minimumTeamAnchorLevel: 52 }),
  routeObjective("route23-boulder-gate",
    { kind: "trigger", map: "MAP_ROUTE22_NORTH_ENTRANCE", index: 0 },
    { kind: "variable-at-least", id: 0x405f, value: 1 }),
  ...Array.from({ length: 7 }, (_, index) => routeObjective(
    `route23-badge-gate-${index + 2}`,
    { kind: "trigger", map: "MAP_ROUTE23", index, equivalentTriggers: true },
    { kind: "variable-at-least", id: 0x405f, value: index + 2 },
  )),
  routeObjective("victory-road-first-floor-switch",
    { kind: "push-boulder", map: "MAP_VICTORY_ROAD_1F",
      objectIndex: 4, x: 20, y: 16 },
    { kind: "variable-at-least", id: 0x4064, value: 100 },
    {
      transientMapPuzzle: true,
      authoredBoulderPath: authoredBoulderPath(7, 18, [
        ["south", 1],
        ["east", 5],
        ["north", 2],
        ["east", 7],
        ["north", 2],
        ["east", 1],
        ["south", 1],
      ]),
      authoredBoulderResetTarget: {
        kind: "warp",
        map: "MAP_VICTORY_ROAD_1F",
        index: 1,
      },
    }),
  routeObjective("victory-road-second-floor-switch-one",
    { kind: "push-boulder", map: "MAP_VICTORY_ROAD_2F",
      objectIndex: 10, x: 2, y: 19 },
    { kind: "variable-at-least", id: 0x4065, value: 100 },
    {
      transientMapPuzzle: true,
      authoredBoulderPath: authoredBoulderPath(6, 17, [
        ["west", 2],
        ["south", 2],
        ["west", 2],
      ]),
      authoredBoulderResetTarget: {
        kind: "warp",
        map: "MAP_VICTORY_ROAD_2F",
        index: 0,
      },
    }),
  routeObjective("victory-road-third-floor-switch",
    { kind: "push-boulder", map: "MAP_VICTORY_ROAD_3F",
      objectIndex: 9, x: 7, y: 7 },
    { kind: "variable-at-least", id: 0x4067, value: 100 },
    {
      transientMapPuzzle: true,
      authoredBoulderPath: authoredBoulderPath(32, 5, [
        ["north", 2],
        ["west", 22],
        ["south", 1],
        ["west", 4],
        ["south", 3],
        ["east", 1],
      ]),
      authoredBoulderResetTarget: {
        kind: "warp",
        map: "MAP_VICTORY_ROAD_3F",
        index: 1,
      },
    }),
  routeObjective("victory-road-drop-boulder",
    { kind: "push-boulder", map: "MAP_VICTORY_ROAD_3F",
      objectIndex: 7, x: 34, y: 18 },
    { kind: "flag-unset", id: 0x58 },
    {
      transientMapPuzzle: true,
      authoredBoulderPath: authoredBoulderPath(33, 18, [["east", 1]]),
      authoredBoulderResetTarget: {
        kind: "warp",
        map: "MAP_VICTORY_ROAD_3F",
        index: 3,
      },
    }),
  routeObjective("victory-road-second-floor-switch-two",
    { kind: "push-boulder", map: "MAP_VICTORY_ROAD_2F",
      objectIndex: 11, x: 14, y: 19 },
    { kind: "variable-at-least", id: 0x4066, value: 100 },
    {
      transientMapPuzzle: true,
      authoredBoulderPath: authoredBoulderPath(33, 19, [["west", 19]]),
      authoredBoulderResetTarget: {
        kind: "warp",
        map: "MAP_VICTORY_ROAD_2F",
        index: 4,
      },
    }),
  routeObjective("league-heal",
    { kind: "object", map: "MAP_INDIGO_PLATEAU_POKEMON_CENTER_1F", index: 1 },
    anyCompletion(
      { kind: "party-fully-restored" },
      { kind: "flag-set", id: 0x4b8 },
    ), { choice: "yes", deferOptionalDetours: true }),
  routeObjective("league-supplies",
    { kind: "purchase-items", map: "MAP_INDIGO_PLATEAU_POKEMON_CENTER_1F",
      objectIndex: 0, items: [
        { itemId: 24, stockIndex: 4, quantity: 24, unitPrice: 1500 },
        { itemId: 20, stockIndex: 3, quantity: 40, unitPrice: 2500 },
        { itemId: 23, stockIndex: 5, quantity: 8, unitPrice: 600 },
        { itemId: 19, stockIndex: 2, quantity: 20, unitPrice: 3000 },
      ] },
    anyCompletion(
      { kind: "all", completions: [
        { kind: "item-at-least", id: 24, quantity: 24 },
        { kind: "item-at-least", id: 20, quantity: 40 },
        { kind: "item-at-least", id: 23, quantity: 8 },
        { kind: "item-at-least", id: 19, quantity: 20 },
      ] },
      { kind: "flag-set", id: 0x4b8 },
    ), { deferOptionalDetours: true }),
  routeObjective("elite-four-lorelei",
    { kind: "object", map: "MAP_POKEMON_LEAGUE_LORELEIS_ROOM", index: 0 },
    { kind: "flag-set", id: 0x4b8 }, {
      minimumCoreLevel: 58,
      coreSpecies: [1, 2, 3, 131],
      deferOptionalDetours: true,
    }),
  routeObjective("restore-after-lorelei",
    { kind: "heal-with-items", saveAfterRecovery:true },
    anyCompletion(
      { kind: "party-maximally-recovered" },
      { kind: "flag-set", id: 0x4b9 },
    ), { deferOptionalDetours: true }),
  routeObjective("elite-four-bruno",
    { kind: "object", map: "MAP_POKEMON_LEAGUE_BRUNOS_ROOM", index: 0 },
    { kind: "flag-set", id: 0x4b9 }, { deferOptionalDetours: true }),
  routeObjective("restore-after-bruno",
    { kind: "heal-with-items", saveAfterRecovery:true },
    anyCompletion(
      { kind: "party-maximally-recovered" },
      { kind: "flag-set", id: 0x4ba },
    ), { deferOptionalDetours: true }),
  routeObjective("elite-four-agatha",
    { kind: "object", map: "MAP_POKEMON_LEAGUE_AGATHAS_ROOM", index: 0 },
    { kind: "flag-set", id: 0x4ba }, { deferOptionalDetours: true }),
  routeObjective("restore-after-agatha",
    { kind: "heal-with-items", saveAfterRecovery:true },
    anyCompletion(
      { kind: "party-maximally-recovered" },
      { kind: "flag-set", id: 0x4bb },
    ), { deferOptionalDetours: true }),
  routeObjective("elite-four-lance",
    { kind: "object", map: "MAP_POKEMON_LEAGUE_LANCES_ROOM", index: 0 },
    { kind: "flag-set", id: 0x4bb }, { deferOptionalDetours: true }),
  routeObjective("restore-after-lance",
    { kind: "heal-with-items", saveAfterRecovery:true },
    anyCompletion(
      { kind: "party-maximally-recovered" },
      { kind: "flag-set", id: 2092 },
    ), { deferOptionalDetours: true }),
  routeObjective("champion",
    { kind: "map-arrival", map: "MAP_POKEMON_LEAGUE_CHAMPIONS_ROOM",
      x: 6, y: 18 },
    { kind: "flag-set", id: 2092 }, {
      minimumTeamAnchorLevel: 56,
      deferOptionalDetours: true,
    }),
]);

const SEVII_DETOUR_INTERLUDE = Object.freeze({
  id: "sevii-detour",
  activation: Object.freeze(anyCompletion(
    { kind: "flag-set", id: PC_STORAGE_DISABLED_FLAG_ID },
    {
      kind: "variable-between",
      id: ONE_ISLAND_POKEMON_CENTER_SCENE_VARIABLE_ID,
      minimum: 1,
      maximum: 2,
    },
  )),
  completion: Object.freeze({
    kind: "variable-at-least",
    id: ONE_ISLAND_POKEMON_CENTER_SCENE_VARIABLE_ID,
    value: 3,
  }),
  objectives: Object.freeze([
    routeObjective(
      "sevii-sail-two-island",
      { kind: "seagallop-destination", map: "MAP_TWO_ISLAND" },
      { kind: "flag-set", id: VISITED_TWO_ISLAND_FLAG_ID },
      { mandatoryInterlude: "sevii-detour", deferOptionalDetours: true },
    ),
    routeObjective(
      "sevii-find-lostelle",
      { kind: "object", map: "MAP_TWO_ISLAND_JOYFUL_GAME_CORNER", index: 0 },
      {
        kind: "variable-at-least",
        id: TWO_ISLAND_GAME_CORNER_SCENE_VARIABLE_ID,
        value: 1,
      },
      { mandatoryInterlude: "sevii-detour", deferOptionalDetours: true },
    ),
    routeObjective(
      "sevii-sail-three-island",
      { kind: "seagallop-destination", map: "MAP_THREE_ISLAND" },
      { kind: "flag-set", id: SEVII_DETOUR_FINISHED_FLAG_ID },
      { mandatoryInterlude: "sevii-detour", deferOptionalDetours: true },
    ),
    routeObjective(
      "sevii-confront-bikers",
      { kind: "trigger", map: "MAP_THREE_ISLAND", index: 0 },
      {
        kind: "variable-at-least",
        id: THREE_ISLAND_SCENE_VARIABLE_ID,
        value: 3,
      },
      { mandatoryInterlude: "sevii-detour", deferOptionalDetours: true },
    ),
    routeObjective(
      "sevii-defeat-bikers",
      { kind: "trigger", map: "MAP_THREE_ISLAND", index: 4 },
      {
        kind: "variable-at-least",
        id: THREE_ISLAND_SCENE_VARIABLE_ID,
        value: 4,
      },
      {
        mandatoryInterlude: "sevii-detour",
        deferOptionalDetours: true,
        choice: "yes",
        choiceMaps: ["MAP_THREE_ISLAND"],
      },
    ),
    routeObjective(
      "sevii-rescue-lostelle",
      { kind: "object", map: "MAP_THREE_ISLAND_BERRY_FOREST", index: 0 },
      { kind: "flag-set", id: RESCUED_LOSTELLE_FLAG_ID },
      { mandatoryInterlude: "sevii-detour", deferOptionalDetours: true },
    ),
    routeObjective(
      "sevii-deliver-meteorite",
      { kind: "object", map: "MAP_TWO_ISLAND_JOYFUL_GAME_CORNER", index: 0 },
      {
        kind: "variable-at-least",
        id: ONE_ISLAND_POKEMON_CENTER_SCENE_VARIABLE_ID,
        value: 2,
      },
      { mandatoryInterlude: "sevii-detour", deferOptionalDetours: true },
    ),
    routeObjective(
      "sevii-sail-one-island",
      { kind: "seagallop-destination", map: "MAP_ONE_ISLAND" },
      { kind: "map-prefix", prefix: "MAP_ONE_ISLAND" },
      { mandatoryInterlude: "sevii-detour", deferOptionalDetours: true },
    ),
    routeObjective(
      "sevii-return-to-kanto",
      { kind: "trigger", map: "MAP_ONE_ISLAND_POKEMON_CENTER_1F", index: 0 },
      {
        kind: "variable-at-least",
        id: ONE_ISLAND_POKEMON_CENTER_SCENE_VARIABLE_ID,
        value: 3,
      },
      { mandatoryInterlude: "sevii-detour", deferOptionalDetours: true },
    ),
  ]),
});

export const MAIN_STORY_CAMPAIGN = Object.freeze({
  objectives: Object.freeze([
    OAK_PARCEL,
    REGIONAL_POKEDEX,
    ...MAIN_STORY_AFTER_POKEDEX,
  ]),
  mandatoryInterludes: Object.freeze([SEVII_DETOUR_INTERLUDE]),
});

function personalizedObjective(objective, changes = {}) {
  return Object.freeze({
    ...objective,
    ...changes,
    target: changes.target
      ? Object.freeze(changes.target)
      : objective.target,
  });
}

function captureObjective(id, map, species, family, options = {}) {
  const { completion, ...metadata } = options;
  return routeObjective(
    id,
    { kind: "encounter-zone", map },
    completion ?? { kind: "owned-species", species: [...family] },
    {
      captureSpecies: Object.freeze([species]),
      captureFamily: Object.freeze([...family]),
      ...metadata,
    },
  );
}

function partyRosterObjective(id, map, {
  requiredFamilies = [],
  maximumPartySize = null,
  completeAfterFlagId = null,
  completeAfterOwnedSpecies = [],
  ...metadata
} = {}) {
  const families = requiredFamilies.map((family) => Object.freeze([...family]));
  const target = {
    kind: "party-roster",
    map,
    ...(families.length > 0 ? { requiredFamilies: Object.freeze(families) } : {}),
    ...(Number.isSafeInteger(maximumPartySize) ? { maximumPartySize } : {}),
  };
  const rosterCompletion = Number.isSafeInteger(maximumPartySize)
    ? { kind: "party-size-at-most", count: maximumPartySize }
    : { kind: "party-has-families", families: Object.freeze(families) };
  const durableCompletions = [
    ...(Number.isSafeInteger(completeAfterFlagId)
      ? [{ kind: "flag-set", id: completeAfterFlagId }]
      : []),
    ...(completeAfterOwnedSpecies.length > 0
      ? [{
          kind: "owned-species",
          species: Object.freeze([...completeAfterOwnedSpecies]),
        }]
      : []),
  ];
  const completion = durableCompletions.length > 0
    ? anyCompletion(rosterCompletion, ...durableCompletions)
    : rosterCompletion;
  return routeObjective(id, target, completion, metadata);
}

function importantBattlePartyLevels(mechanicsDocument, objectiveId) {
  const trainerNames = new Set(IMPORTANT_BATTLE_TRAINER_NAMES[objectiveId] ?? []);
  if (trainerNames.size === 0) return null;
  const mechanics = mechanicsDocument?.data ?? mechanicsDocument ?? {};
  const trainers = Array.isArray(mechanics.trainers)
    ? mechanics.trainers
    : Object.values(mechanics.trainers ?? {});
  const parties = trainers.filter(({ name }) => trainerNames.has(name))
    .map(({ party }) => (party ?? [])
      .map(({ lvl, level }) => Number(lvl ?? level))
      .filter((candidate) => Number.isSafeInteger(candidate) && candidate > 0))
    .filter((party) => party.length > 0)
    .sort((left, right) =>
      Math.max(...right) - Math.max(...left) ||
      right.length - left.length ||
      right.join(",").localeCompare(left.join(","))
    );
  return parties[0] ?? null;
}

function importantBattleAceLevel(mechanicsDocument, objectiveId) {
  const levels = importantBattlePartyLevels(mechanicsDocument, objectiveId);
  return levels ? Math.max(...levels) : null;
}

export function createOriginsCampaign(teamPlan, {
  campaign = MAIN_STORY_CAMPAIGN,
  mechanics = null,
} = {}) {
  if (!teamPlan?.starterFamily || !Array.isArray(teamPlan.acquisitions)) {
    throw new TypeError("an Origins team plan is required");
  }
  const combatSpecies = Object.freeze([
    ...teamPlan.starterFamily,
    ...teamPlan.acquisitions.flatMap(({ family }) => family),
  ]);
  const coreLevels = new Map([
    ["badge-rainbow", 28],
    ["rival-silph", 38],
    ["silph-liberated", 38],
    ["badge-marsh", 41],
    ["badge-soul", 40],
    ["badge-volcano", 45],
    ["badge-earth", 48],
    ["rival-route22-late", 52],
    ["elite-four-lorelei", 58],
    ["champion", 58],
  ]);
  const personalize = (objective) => {
    const importantBattleId = objective.rosterPreparationFor ?? objective.id;
    let target = objective.target;
    if (objective.id === "teach-cut") {
      target = { ...target, partySpecies: fieldCarrierSpecies(teamPlan,'cut') };
    } else if (objective.id === "teach-surf") {
      target = { ...target, partySpecies: [...teamPlan.fieldMoves.surf] };
    } else if (objective.id === "teach-strength") {
      target = { ...target, partySpecies: [...teamPlan.fieldMoves.strength] };
    } else if (objective.id === "teach-secret-power") {
      target = { ...target, partySpecies: [...teamPlan.starterFamily] };
    }
    const minimumCoreLevel = coreLevels.get(importantBattleId);
    const brockPlan = importantBattleId === "badge-boulder"
      ? teamPlan.earlyGame?.brock
      : null;
    const brockCoreSpecies = brockPlan?.anchorFamilies?.flat?.() ?? [];
    const mistyPlan = importantBattleId === "badge-cascade"
      ? teamPlan.earlyGame?.misty
      : null;
    const mistyCoreSpecies = mistyPlan?.counterFamilies?.flat?.() ?? [];
    const battlePlan = teamPlan.battlePlans?.[importantBattleId] ?? null;
    const battleCoreSpecies = battlePlan?.anchorFamilies?.flat?.() ?? [];
    const authoredBattleLevelTarget = IMPORTANT_BATTLE_LEVEL_TARGETS[
      importantBattleId
    ] ?? null;
    const enemyPartyLevels = importantBattlePartyLevels(mechanics, importantBattleId) ??
      authoredBattleLevelTarget?.enemyPartyLevels ?? null;
    const enemyAceLevel = enemyPartyLevels
      ? Math.max(...enemyPartyLevels)
      : importantBattleAceLevel(mechanics, importantBattleId) ??
        authoredBattleLevelTarget?.enemyAceLevel ?? null;
    const battleTeamTargetLevel = enemyAceLevel
      ? Math.max(
          enemyAceLevel + IMPORTANT_BATTLE_MINIMUM_LEVEL_ADVANTAGE,
          Number(authoredBattleLevelTarget?.battleTeamTargetLevel ?? 0),
        )
      : null;
    const supportBattleTargetLevel = battleTeamTargetLevel;
    const authoredMinimumReadyBattleMembers = Number(
      authoredBattleLevelTarget?.minimumReadyBattleMembers ?? 0,
    );
    const authoredAllowsShortBattleSquad = Boolean(
      authoredBattleLevelTarget &&
      authoredMinimumReadyBattleMembers < authoredBattleLevelTarget.enemyPartySize
    );
    const minimumReadyBattleMembers = enemyPartyLevels
      ? authoredAllowsShortBattleSquad
        ? authoredMinimumReadyBattleMembers
        : Math.max(enemyPartyLevels.length, authoredMinimumReadyBattleMembers)
      : null;
    return personalizedObjective(objective, {
      ...(target !== objective.target ? { target } : {}),
      ...(objective.id === "gift-lapras"
        ? { acquisitionId: "origins-lapras" }
        : {}),
      ...(brockPlan ? {
        minimumCoreLevel: brockPlan.anchorLevel,
        coreSpecies: Object.freeze([...brockCoreSpecies]),
        minimumBattleMemberLevel: brockPlan.supportFloor,
      } : {}),
      ...(mistyPlan ? {
        minimumCoreLevel: mistyPlan.counterLevel,
        coreSpecies: Object.freeze([...mistyCoreSpecies]),
      } : {}),
      ...(minimumCoreLevel
        ? { minimumCoreLevel, coreSpecies: combatSpecies }
        : {}),
      ...(battlePlan ? {
        minimumBattlePartySize: battlePlan.minimumReadyMembers,
        minimumBattleMemberLevel: battlePlan.supportFloor,
        minimumCoreLevel: battlePlan.anchorLevel,
        coreSpecies: Object.freeze([...battleCoreSpecies]),
        preferredFamilies: Object.freeze(
          battlePlan.preferredFamilies.map((family) => Object.freeze([...family])),
        ),
        trainerTrainingAllowed: battlePlan.trainerTrainingAllowed,
      } : {}),
      ...(battleTeamTargetLevel ? {
        battleCategory: authoredBattleLevelTarget?.category,
        enemyPartyLevels: Object.freeze([...enemyPartyLevels]),
        enemyPartySize: enemyPartyLevels.length,
        enemyAceLevel,
        starterBattleFamily: Object.freeze([...teamPlan.starterFamily]),
        ...(GYM_LEADER_TRAINERS[importantBattleId]
          ? { gymLeaderAceLevel: enemyAceLevel }
          : {}),
        starterBattleTargetLevel: battleTeamTargetLevel,
        supportBattleTargetLevel,
        minimumReadyBattleMembers,
        battleTeamTargetLevel,
        minimumBattleMemberLevel: supportBattleTargetLevel,
        minimumTeamAnchorLevel: battleTeamTargetLevel,
      } : {}),
    });
  };

  const eeveeFamily = [133, 134, 135, 136];
  const leagueFamilies = [
    [...teamPlan.starterFamily],
    ...teamPlan.acquisitions.map(({ family }) => [...family]),
  ];
  const brockMankeyFamily = teamPlan.earlyGame?.brock?.optionalFamilies?.find(
    (family) => family.some((species) => Number(species) === 56),
  ) ?? null;
  const additions = new Map([
    ["regional-pokedex", brockMankeyFamily ? [
      captureObjective(
        "brock-mankey-capture",
        "MAP_ROUTE22",
        56,
        brockMankeyFamily,
        { strategicRole: "brock-counter", temporaryRoster: true },
      ),
    ] : []],
    ["badge-boulder", [
      captureObjective(
        "origins-paras-utility-capture",
        "MAP_MT_MOON_1F",
        46,
        [46, 47],
        {
          acquisitionId: "utility-paras",
          utilityRole: "hm-carrier",
          // Older checkpoints that already crossed Mt. Moon must not be sent
          // backward through its one-way Route 4 exit.
          completion: anyCompletion(
            { kind: "owned-species", species: [46, 47] },
            { kind: "flag-set", id: 562 },
          ),
        },
      ),
    ]],
    ["rival-cerulean", [
      routeObjective(
        "cerulean-capture-supplies",
        {
          kind: "purchase-items",
          map: "MAP_CERULEAN_CITY_MART",
          objectIndex: 0,
          // Ordered policy: survival medicine is funded before capture stock.
          items: [
            { itemId: 22, stockIndex: 1, quantity: 4, unitPrice: 700 },
            { itemId: 14, stockIndex: 3, quantity: 2, unitPrice: 100 },
            { itemId: 18, stockIndex: 4, quantity: 2, unitPrice: 200 },
            { itemId: 4, stockIndex: 0, quantity: 12, unitPrice: 200 },
          ],
        },
        anyCompletion(
          { kind: "all", completions: [
            { kind: "item-at-least", id: 22, quantity: 4 },
            { kind: "item-at-least", id: 14, quantity: 2 },
            { kind: "item-at-least", id: 18, quantity: 2 },
            { kind: "item-at-least", id: 4, quantity: 12 },
          ] },
          { kind: "flag-set", id: 2081 },
        ),
        { supplyPriority: Object.freeze(["medicine", "poke-balls"]) },
      ),
      ...(teamPlan.earlyGame?.misty?.counterFamilies?.some(
        (family) => family.includes(43),
      ) ? [
        captureObjective(
          "misty-oddish-capture",
          "MAP_ROUTE24",
          43,
          [43, 44, 45],
          { strategicRole: "misty-counter", temporaryRoster: true },
        ),
        partyRosterObjective(
          "ensure-misty-counter-party",
          "MAP_CERULEAN_CITY_POKEMON_CENTER_1F",
          {
            requiredFamilies: [[43, 44, 45]],
            strategicRole: "misty-counter",
            completeAfterFlagId: 2081,
          },
        ),
      ] : []),
    ]],
    ["cerulean-rocket", [
      captureObjective(
        "origins-persian-capture",
        "MAP_ROUTE5",
        52,
        [52, 53],
        { acquisitionId: "origins-persian" },
      ),
      partyRosterObjective(
        "ensure-meowth-party",
        "MAP_VERMILION_CITY_POKEMON_CENTER_1F",
        {
          requiredFamilies: [[52, 53]],
          acquisitionId: "origins-persian",
          completeAfterFlagId: 2082,
        },
      ),
    ]],
    ["hm-cut", [
      partyRosterObjective(
        "ensure-cut-carrier-party",
        "MAP_VERMILION_CITY_POKEMON_CENTER_1F",
        {
          requiredFamilies: [[...teamPlan.fieldMoves.cut]],
          utilityRole: "hm-carrier",
          completeAfterFlagId: 2082,
        },
      ),
    ]],
    ["badge-thunder", [
      partyRosterObjective(
        "prepare-eevee-party-space",
        "MAP_CELADON_CITY_POKEMON_CENTER_1F",
        {
          maximumPartySize: 5,
          completeAfterOwnedSpecies: eeveeFamily,
          acquisitionId: "origins-jolteon",
        },
      ),
      routeObjective(
        "origins-eevee-gift",
        {
          kind: "object",
          map: "MAP_CELADON_CITY_CONDOMINIUMS_ROOF_ROOM",
          index: 1,
        },
        { kind: "owned-species", species: eeveeFamily },
        {
          choice: "no",
          acquisitionId: "origins-jolteon",
          reservedPartySlots: 1,
        },
      ),
      partyRosterObjective(
        "ensure-eevee-party",
        "MAP_CELADON_CITY_POKEMON_CENTER_1F",
        {
          requiredFamilies: [eeveeFamily],
          acquisitionId: "origins-jolteon",
        },
      ),
      routeObjective(
        "origins-thunder-stone",
        {
          kind: "purchase-items",
          map: "MAP_CELADON_CITY_DEPARTMENT_STORE_4F",
          objectIndex: 2,
          items: [{ itemId: 96, stockIndex: 3, quantity: 1, unitPrice: 2100 }],
        },
        anyCompletion(
          { kind: "item-at-least", id: 96, quantity: 1 },
          { kind: "party-has-species", species: [135] },
        ),
        { acquisitionId: "origins-jolteon" },
      ),
      routeObjective(
        "origins-jolteon-evolve",
        {
          kind: "evolve-with-item",
          itemId: 96,
          partySpecies: [133],
          targetSpecies: 135,
        },
        { kind: "party-has-species", species: [135] },
        { acquisitionId: "origins-jolteon" },
      ),
      routeObjective(
        "bike-voucher",
        {
          kind: "object",
          map: "MAP_VERMILION_CITY_POKEMON_FAN_CLUB",
          index: 0,
        },
        anyCompletion(
          { kind: "flag-set", id: 577 },
          { kind: "item-at-least", id: 352, quantity: 1 },
          { kind: "flag-set", id: 625 },
          { kind: "item-at-least", id: 360, quantity: 1 },
        ),
        { choice: "yes", deferOptionalDetours: true },
      ),
      routeObjective(
        "bicycle",
        {
          kind: "object",
          map: "MAP_CERULEAN_CITY_BIKE_SHOP",
          index: 0,
        },
        anyCompletion(
          { kind: "flag-set", id: 625 },
          { kind: "item-at-least", id: 360, quantity: 1 },
        ),
        { deferOptionalDetours: true },
      ),
    ]],
    ["poke-flute", [
      routeObjective(
        "route16-snorlax",
        { kind: "object", map: "MAP_ROUTE16", index: 9 },
        { kind: "flag-set", id: 128 },
        {
          choice: "yes",
          captureSpecies: Object.freeze([143]),
          captureFamily: Object.freeze([143]),
          encounter: Object.freeze({ minimumLevel: 30, maximumLevel: 30 }),
          watchFlags: Object.freeze([128]),
        },
      ),
      partyRosterObjective(
        "ensure-route16-cut-carrier-party",
        "MAP_CELADON_CITY_POKEMON_CENTER_1F",
        {
          requiredFamilies: [[...teamPlan.fieldMoves.cut]],
          utilityRole: "hm-carrier",
          completeAfterFlagId: 568,
          deferOptionalDetours: true,
        },
      ),
      routeObjective(
        "hm-fly",
        { kind: "object", map: "MAP_ROUTE16_HOUSE", index: 0 },
        { kind: "flag-set", id: 568 },
        { deferOptionalDetours: true },
      ),
      captureObjective(
        "origins-doduo-capture",
        "MAP_ROUTE16",
        84,
        [84, 85],
        { acquisitionId: "origins-dodrio" },
      ),
      partyRosterObjective(
        "ensure-fly-carrier-party",
        "MAP_CELADON_CITY_POKEMON_CENTER_1F",
        {
          requiredFamilies: [[...teamPlan.fieldMoves.fly]],
          acquisitionId: "origins-dodrio",
          deferOptionalDetours: true,
        },
      ),
      teachMoveObjective("teach-fly", 340, 19, [...teamPlan.fieldMoves.fly], {
        deferOptionalDetours: true,
      }),
    ]],
    ["rival-silph", [
      partyRosterObjective(
        "prepare-lapras-party-space",
        "MAP_SAFFRON_CITY_POKEMON_CENTER_1F",
        {
          maximumPartySize: 5,
          completeAfterOwnedSpecies: [131],
          acquisitionId: "origins-lapras",
        },
      ),
    ]],
    ["gift-lapras", [
      partyRosterObjective(
        "ensure-lapras-party",
        "MAP_SAFFRON_CITY_POKEMON_CENTER_1F",
        {
          requiredFamilies: [[131]],
          acquisitionId: "origins-lapras",
        },
      ),
    ]],
    ["hm-surf", [
      captureObjective(
        "origins-scyther-capture",
        "MAP_SAFARI_ZONE_CENTER",
        123,
        [123],
        { acquisitionId: "origins-scyther", safari: true },
      ),
      partyRosterObjective(
        "ensure-scyther-party",
        "MAP_FUCHSIA_CITY_POKEMON_CENTER_1F",
        {
          requiredFamilies: [[123]],
          acquisitionId: "origins-scyther",
        },
      ),
      partyRosterObjective(
        "assemble-origins-roster",
        "MAP_FUCHSIA_CITY_POKEMON_CENTER_1F",
        {
          requiredFamilies: leagueFamilies,
          strategicRole: "hall-of-fame-team",
          deferOptionalDetours: true,
        },
      ),
    ]],
    ["victory-road-second-floor-switch-two", [
      partyRosterObjective(
        "assemble-league-roster",
        "MAP_INDIGO_PLATEAU_POKEMON_CENTER_1F",
        {
          requiredFamilies: leagueFamilies,
          strategicRole: "hall-of-fame-team",
          deferOptionalDetours: true,
        },
      ),
    ]],
  ]);
  const objectives = campaign.objectives.flatMap((objective) => [
    personalize(objective),
    ...(additions.get(objective.id) ?? []),
  ]);
  return Object.freeze({
    objectives: Object.freeze(objectives),
    mandatoryInterludes: Object.freeze([...(campaign.mandatoryInterludes ?? [])]),
  });
}

const MASTER_OPTIONAL_DETOURS = new Set([
  "coin-case",
  "silph-coverage-tm",
  "teach-secret-power",
  "silph-supplies",
  "league-supplies",
  "route12-snorlax",
]);

function masterCaptureObjective(acquisition) {
  const step = acquisition.steps.find(({ kind }) => kind === "wild-capture");
  if (!step) return null;
  return captureObjective(
    `master-${acquisition.id}-capture`,
    step.maps[0],
    step.species,
    acquisition.family,
    {
      acquisitionId: acquisition.id,
      permanentRoster: true,
      forwardPathAcquisition: true,
    },
  );
}

function rosterTrainingObjective(id, family, level, metadata = {}) {
  return routeObjective(id, { kind: "roster-training" },
    { kind: "party-member-minimum-level", species: [...family], level },
    { minimumCoreLevel: level, coreSpecies: [...family], permanentRoster: true, ...metadata });
}

const SURF_ACQUISITION_MAPS = new Set([
  "MAP_POWER_PLANT", "MAP_SEAFOAM_ISLANDS_1F", "MAP_ROUTE19", "MAP_ROUTE20",
  "MAP_ROUTE21", "MAP_ROUTE21_NORTH", "MAP_ROUTE21_SOUTH",
]);

function acquisitionTargetRequiresSurf(target) {
  return target?.kind === "surf-encounter-zone" || SURF_ACQUISITION_MAPS.has(target?.map);
}

function acquisitionRequiresSurf(acquisition) {
  return acquisition.steps.some(step => step.kind === "wild-capture" &&
    acquisitionTargetRequiresSurf({ kind: step.targetKind, map: step.maps?.[0] }));
}

function masterAcquisitionObjectives(acquisition) {
  return acquisition.steps.flatMap((step) => {
    const afterObjectiveId = step.afterObjectiveId ?? acquisition.afterObjectiveId;
    if (step.kind === "wild-capture") {
      const prerequisite = step.prerequisite === true;
      return [{
        afterObjectiveId,
        objective: captureObjective(
          `master-${acquisition.id}-${prerequisite ? "prerequisite-" : ""}capture`,
          step.maps[0],
          step.species,
          prerequisite ? [step.species] : acquisition.family,
          {
            acquisitionId: acquisition.id,
            permanentRoster: !prerequisite,
            prerequisiteAcquisition: prerequisite,
            forwardPathAcquisition: true,
            target: { kind: step.targetKind ?? "encounter-zone", map: step.maps[0],
              ...(step.rodItemId ? { rodItemId: step.rodItemId } : {}) },
            ...(step.safari ? { safari: true } : {}),
            ...(prerequisite ? {
              completion: anyCompletion(
                { kind: "owned-species", species: [step.species] },
                { kind: "owned-species", species: [acquisition.targetSpecies] },
              ),
            } : {}),
          },
        ),
      }];
    }
    if (step.kind === "collect-item") {
      return [{
        afterObjectiveId,
        objective: routeObjective(
          `master-${acquisition.id}-moon-stone`,
          step.target ?? { kind: "object", map: step.map, index: step.objectIndex },
          anyCompletion(
            { kind: "item-at-least", id: step.itemId, quantity: 1 },
            { kind: "flag-set", id: step.flagId },
            { kind: "owned-species", species: [acquisition.targetSpecies] },
          ),
          {
            acquisitionId: acquisition.id,
            permanentRoster: true,
            forwardPathAcquisition: true,
          },
        ),
      }];
    }
    if (step.kind === "key-item-gift") {
      return [{ afterObjectiveId, objective: routeObjective(
        `master-${acquisition.id}-key-item-${step.itemId}`,
        { kind: "object", map: step.map, index: step.objectIndex },
        { kind: "item-at-least", id: step.itemId, quantity: 1 },
        { choice: "yes", acquisitionId: acquisition.id, prerequisiteAcquisition: true },
      ) }];
    }
    if (step.kind === "gift") {
      const pcMap = step.pcMap ?? "MAP_CELADON_CITY_POKEMON_CENTER_1F";
      return [
        partyRosterObjective(`master-${acquisition.id}-gift-party-space`, pcMap, {
          maximumPartySize: 5, completeAfterOwnedSpecies: acquisition.family,
          acquisitionId: acquisition.id, permanentRoster: true,
        }),
        routeObjective(`master-${acquisition.id}-gift`,
          { kind: "object", map: step.map, index: step.objectIndex },
          { kind: "owned-species", species: acquisition.family },
          { choice: "no", acquisitionId: acquisition.id, permanentRoster: true }),
        partyRosterObjective(`master-${acquisition.id}-gift-party`, pcMap, {
          requiredFamilies: [acquisition.family], acquisitionId: acquisition.id, permanentRoster: true,
        }),
      ].map(objective => ({ afterObjectiveId, objective }));
    }
    if (step.kind === "purchase") {
      return [{ afterObjectiveId, objective: routeObjective(
        `master-${acquisition.id}-purchase-${step.itemId}`,
        { kind: "purchase-items", map: step.map, objectIndex: step.objectIndex,
          items: [{ itemId: step.itemId, quantity: 1, stockIndex: step.stockIndex, unitPrice: step.price }] },
        anyCompletion({ kind: "item-at-least", id: step.itemId, quantity: 1 },
          { kind: "owned-species", species: [acquisition.targetSpecies] }),
        { acquisitionId: acquisition.id, permanentRoster: true },
      ) }];
    }
    if (step.kind === "item-evolution") {
      const preparation = Number.isSafeInteger(step.minimumLevel) ? [
        partyRosterObjective(`master-${acquisition.id}-evolve-party`,
          step.itemSource?.kind === "collect-item" && step.itemSource.map.startsWith("MAP_MT_MOON_")
            ? "MAP_CERULEAN_CITY_POKEMON_CENTER_1F" : "MAP_CELADON_CITY_POKEMON_CENTER_1F", {
            requiredFamilies: [acquisition.family], completeAfterOwnedSpecies: [step.targetSpecies],
            acquisitionId: acquisition.id, permanentRoster: true,
          }),
        rosterTrainingObjective(`master-${acquisition.id}-evolve-train`, acquisition.family, step.minimumLevel, {
          acquisitionId: acquisition.id,
          completion: anyCompletion({ kind: "party-member-minimum-level", species: acquisition.family, level: step.minimumLevel },
            { kind: "owned-species", species: [step.targetSpecies] }),
        }),
      ].map(objective => ({ afterObjectiveId, objective })) : [];
      return [...preparation, {
        afterObjectiveId,
        objective: routeObjective(
          `master-${acquisition.id}-evolve`,
          {
            kind: "evolve-with-item",
            itemId: step.itemId,
            partySpecies: [step.sourceSpecies],
            targetSpecies: step.targetSpecies,
          },
          { kind: "owned-species", species: [step.targetSpecies] },
          { acquisitionId: acquisition.id, permanentRoster: true },
        ),
      }];
    }
    if (step.kind === "in-game-trade") {
      return [
        {
          afterObjectiveId,
          objective: partyRosterObjective(
            `master-${acquisition.id}-trade-party`,
            "MAP_VERMILION_CITY_POKEMON_CENTER_1F",
            {
              requiredFamilies: [[step.requestedSpecies]],
              completeAfterOwnedSpecies: [step.receivedSpecies],
              acquisitionId: acquisition.id,
              prerequisiteAcquisition: true,
            },
          ),
        },
        {
          afterObjectiveId,
          objective: routeObjective(
            `master-${acquisition.id}-trade`,
            {
              kind: "in-game-trade",
              map: step.map,
              index: step.objectIndex,
              requestedSpecies: step.requestedSpecies,
              receivedSpecies: step.receivedSpecies,
            },
            anyCompletion(
              { kind: "flag-set", id: step.flagId },
              { kind: "owned-species", species: [step.receivedSpecies] },
            ),
            {
              choice: "yes",
              acquisitionId: acquisition.id,
              permanentRoster: true,
            },
          ),
        },
      ];
    }
    return [];
  });
}

function masterBattleObjective(objective, teamPlan, combatSpecies, unavailableFamilies = []) {
  const importantBattleId = objective.rosterPreparationFor ?? objective.id;
  if (!objective.importantBattle) return objective;
  const battlePlan = teamPlan.battlePlans?.[importantBattleId] ?? null;
  const available = family => !unavailableFamilies.some(unavailable =>
    unavailable.some(species => family.includes(species)));
  const availablePermanentMembers =
    (battlePlan?.availableFamilies ?? teamPlan.permanentFamilies).filter(available).length;
  const minimumBattlePartySize = Math.min(
    Number(objective.minimumBattlePartySize ?? availablePermanentMembers),
    availablePermanentMembers,
  );
  return personalizedObjective(objective, {
    minimumBattlePartySize,
    minimumReadyBattleMembers: Math.min(
      Number(objective.minimumReadyBattleMembers ?? minimumBattlePartySize),
      minimumBattlePartySize,
    ),
    starterBattleFamily: Object.freeze([...teamPlan.starterFamily]),
    minimumCoreLevel: null,
    coreSpecies: combatSpecies,
    prioritizeMatchupTraining: true,
    ...(battlePlan ? {
      battleCoverageTypes: Object.freeze([...battlePlan.coverageTypes]),
    } : {}),
    preferredFamilies: Object.freeze(
      (battlePlan?.preferredFamilies ?? teamPlan.permanentFamilies)
        .filter(available)
        .map((family) => Object.freeze([...family])),
    ),
  });
}

function masterRoute16Objectives(teamPlan) {
  const acquisitions = [...teamPlan.acquisitions, ...(teamPlan.utilityAcquisitions ?? [])];
  const snorlax = acquisitions.find(({ id }) => id === "snorlax");
  const flyer = acquisitions.find(({ id }) => id === "dodrio" || id === teamPlan.route16FlyAcquisitionId);
  const snorlaxObjective = snorlax
    ? routeObjective(
        "master-snorlax-capture",
        { kind: "object", map: "MAP_ROUTE16", index: 9 },
        {
          kind: "all",
          completions: [
            { kind: "flag-set", id: 128 },
            { kind: "owned-species", species: [143] },
          ],
        },
        {
          choice: "yes",
          acquisitionId: snorlax.id,
          permanentRoster: true,
          captureSpecies: Object.freeze([143]),
          captureFamily: Object.freeze([143]),
          encounter: Object.freeze({ minimumLevel: 30, maximumLevel: 30 }),
          watchFlags: Object.freeze([128]),
          deferOptionalDetours: true,
        },
      )
    : routeObjective(
        "route16-snorlax-clear",
        { kind: "object", map: "MAP_ROUTE16", index: 9 },
        { kind: "flag-set", id: 128 },
        {
          choice: "yes",
          watchFlags: Object.freeze([128]),
          deferOptionalDetours: true,
        },
      );
  return [
    snorlaxObjective,
    partyRosterObjective(
      "ensure-route16-cut-carrier-party",
      "MAP_CELADON_CITY_POKEMON_CENTER_1F",
      {
        requiredFamilies: [[...teamPlan.fieldMoves.cut]],
        permanentRoster: true,
        completeAfterFlagId: 568,
        deferOptionalDetours: true,
      },
    ),
    routeObjective(
      "hm-fly",
      { kind: "object", map: "MAP_ROUTE16_HOUSE", index: 0 },
      { kind: "flag-set", id: 568 },
      { deferOptionalDetours: true },
    ),
    ...(flyer ? [masterCaptureObjective(flyer)] : []),
    partyRosterObjective(
      "ensure-fly-carrier-party",
      "MAP_CELADON_CITY_POKEMON_CENTER_1F",
      {
        requiredFamilies: [[...teamPlan.fieldMoves.fly]],
        permanentRoster: true,
        deferOptionalDetours: true,
      },
    ),
    teachMoveObjective("teach-fly", 340, 19, [...teamPlan.fieldMoves.fly], {
      deferOptionalDetours: true,
    }),
  ];
}

function masterBicycleObjectives() {
  return [
    routeObjective(
      "bike-voucher",
      {
        kind: "object",
        map: "MAP_VERMILION_CITY_POKEMON_FAN_CLUB",
        index: 0,
      },
      anyCompletion(
        { kind: "flag-set", id: 577 },
        { kind: "item-at-least", id: 352, quantity: 1 },
        { kind: "flag-set", id: 625 },
        { kind: "item-at-least", id: 360, quantity: 1 },
      ),
      { choice: "yes", deferOptionalDetours: true },
    ),
    routeObjective(
      "bicycle",
      { kind: "object", map: "MAP_CERULEAN_CITY_BIKE_SHOP", index: 0 },
      anyCompletion(
        { kind: "flag-set", id: 625 },
        { kind: "item-at-least", id: 360, quantity: 1 },
      ),
      { deferOptionalDetours: true },
    ),
  ];
}

function masterCaptureSuppliesObjective() {
  return routeObjective(
    "permanent-team-capture-supplies",
    {
      kind: "purchase-items",
      map: "MAP_CERULEAN_CITY_MART",
      objectIndex: 0,
      items: [
        { itemId: 22, stockIndex: 1, quantity: 3, unitPrice: 700 },
        { itemId: 14, stockIndex: 3, quantity: 2, unitPrice: 100 },
        { itemId: 4, stockIndex: 0, quantity: 10, unitPrice: 200 },
      ],
    },
    anyCompletion(
      {
        kind: "all",
        completions: [
          { kind: "item-at-least", id: 22, quantity: 3 },
          { kind: "item-at-least", id: 14, quantity: 2 },
          { kind: "item-at-least", id: 4, quantity: 10 },
        ],
      },
      { kind: "flag-set", id: 2081 },
    ),
    { supplyPriority: Object.freeze(["medicine", "poke-balls"]) },
  );
}

export function createMasterCampaign(teamPlan, {
  campaign = MAIN_STORY_CAMPAIGN,
} = {}) {
  if (
    teamPlan?.schema !== "master-red/permanent-team-plan/v1" ||
    !Array.isArray(teamPlan.acquisitions) ||
    teamPlan.acquisitions.length !== 5
  ) {
    throw new TypeError("a seeded permanent team plan is required");
  }
  const combatSpecies = Object.freeze(
    [...teamPlan.permanentFamilies, ...(teamPlan.temporaryAcquisitions ?? []).map(x => x.family)].flatMap((family) => [...family]),
  );
  const allAcquisitions = [...teamPlan.acquisitions, ...(teamPlan.utilityAcquisitions ?? []), ...(teamPlan.temporaryAcquisitions ?? [])];
  const selectedLapras = allAcquisitions.find(x => x.id === "lapras" || x.id === "helper-lapras");
  const soulIndex = campaign.objectives.findIndex(({ id }) => id === "badge-soul");
  const surfAcquisitions = teamPlan.acquisitions.filter(acquisitionRequiresSurf);
  const genericAdditions = new Map();
  for (const acquisition of allAcquisitions) {
    if (["snorlax", "lapras", "helper-lapras", "dodrio", teamPlan.route16FlyAcquisitionId].includes(acquisition.id)) continue;
    for (const { afterObjectiveId, objective } of masterAcquisitionObjectives(acquisition)) {
      // Catalog identity is frozen in existing checkpoints. Resolve native
      // field capabilities here for both resumed and newly generated teams:
      // teaching Surf does not authorize its use before the Soul Badge.
      const anchorIndex = campaign.objectives.findIndex(({ id }) => id === afterObjectiveId);
      const anchor = surfAcquisitions.includes(acquisition) && soulIndex >= 0 &&
        anchorIndex >= 0 && anchorIndex < soulIndex ? "badge-soul" : afterObjectiveId;
      const current = genericAdditions.get(anchor) ?? [];
      current.push(acquisition.temporaryRoster ? { ...objective, permanentRoster: false, temporaryRoster: true, helperRole: acquisition.helperRole,
        ...(acquisition.fieldPolicyUtility ? {fieldPolicyUtility:true,
          completion:{kind:'available-species',species:acquisition.family}} : {}) } : objective);
      genericAdditions.set(anchor, current);
    }
  }
  const additions = new Map([
    ["rival-cerulean", [masterCaptureSuppliesObjective()]],
    ["badge-thunder", masterBicycleObjectives()],
    ["poke-flute", masterRoute16Objectives(teamPlan)],
    ["rival-silph", selectedLapras ? [
      partyRosterObjective(
        "prepare-lapras-party-space",
        "MAP_SAFFRON_CITY_POKEMON_CENTER_1F",
        {
          maximumPartySize: 5,
          completeAfterOwnedSpecies: [131],
          acquisitionId: selectedLapras.id,
          permanentRoster: !selectedLapras.temporaryRoster,
          temporaryRoster: Boolean(selectedLapras.temporaryRoster),
        },
      ),
    ] : []],
    ["gift-lapras", selectedLapras ? [
      partyRosterObjective(
        "ensure-lapras-party",
        "MAP_SAFFRON_CITY_POKEMON_CENTER_1F",
        {
          requiredFamilies: [[131]],
          acquisitionId: selectedLapras.id,
          permanentRoster: !selectedLapras.temporaryRoster,
          temporaryRoster: Boolean(selectedLapras.temporaryRoster),
        },
      ),
    ] : []],
    ["hm-surf", [
      partyRosterObjective(
        "assemble-permanent-roster",
        "MAP_FUCHSIA_CITY_POKEMON_CENTER_1F",
        {
          requiredFamilies: teamPlan.surfAssemblyFamilies ?? teamPlan.permanentFamilies,
          strategicRole: "hall-of-fame-team",
          permanentRoster: true,
          deferOptionalDetours: true,
        },
      ),
    ]],
    ["victory-road-second-floor-switch-two", [
      partyRosterObjective(
        "assemble-league-roster",
        "MAP_INDIGO_PLATEAU_POKEMON_CENTER_1F",
        {
          requiredFamilies: teamPlan.permanentFamilies,
          strategicRole: "hall-of-fame-team",
          permanentRoster: true,
          deferOptionalDetours: true,
        },
      ),
    ]],
  ]);
  const objectives = [];
  const hasBlastoiseStarter = BLASTOISE_FAMILY.every((species) =>
    teamPlan.starterFamily.includes(species)
  );
  const designatedSurfFamily = new Set(teamPlan.fieldMoves?.surf ?? []);
  const addBlastoiseLeagueSurf = hasBlastoiseStarter &&
    !BLASTOISE_FAMILY.some((species) => designatedSurfFamily.has(species));
  for (const sourceObjective of campaign.objectives) {
    if (MASTER_OPTIONAL_DETOURS.has(sourceObjective.id)) continue;
    if (sourceObjective.id === "gift-lapras" && !selectedLapras) continue;
    let target = sourceObjective.target;
    if (sourceObjective.id === "teach-cut") {
      target = { ...target, partySpecies: [...teamPlan.fieldMoves.cut] };
    } else if (sourceObjective.id === "teach-surf") {
      target = { ...target, partySpecies: [...teamPlan.fieldMoves.surf] };
    } else if (sourceObjective.id === "teach-strength") {
      target = { ...target, partySpecies: [...teamPlan.fieldMoves.strength] };
    }
    let objective = target === sourceObjective.target
      ? sourceObjective
      : personalizedObjective(sourceObjective, { target });
    if (sourceObjective.id === "gift-lapras") {
      objective = personalizedObjective(objective, {
        acquisitionId: selectedLapras.id,
        permanentRoster: !selectedLapras.temporaryRoster,
        temporaryRoster: Boolean(selectedLapras.temporaryRoster),
      });
    }
    const beforeSurfAccess = soulIndex >= 0 && campaign.objectives.indexOf(sourceObjective) <= soulIndex;
    objective = masterBattleObjective(objective, teamPlan, combatSpecies,
      beforeSurfAccess ? surfAcquisitions.map(({ family }) => family) : []);
    objectives.push(objective);
    if (sourceObjective.id === "league-heal" && addBlastoiseLeagueSurf) {
      objectives.push(blastoiseLeagueSurfObjective());
    }
    let acquisitionObjectives = genericAdditions.get(sourceObjective.id) ?? [];
    for (const addition of additions.get(sourceObjective.id) ?? []) {
      // A roster consumer cannot precede its acquisition at the same story
      // milestone. Move the required acquisition's complete sequence, keeping
      // its internal prerequisites and the milestone itself in order.
      const families = addition.target?.kind === 'party-roster'
        ? addition.target.requiredFamilies ?? [] : [];
      const required = new Set(allAcquisitions.filter(a =>
        families.some(family => family.some(species => a.family.includes(species))))
        .map(a => a.id));
      objectives.push(...acquisitionObjectives.filter(o => required.has(o.acquisitionId)));
      acquisitionObjectives = acquisitionObjectives.filter(o => !required.has(o.acquisitionId));
      objectives.push(addition);
    }
    objectives.push(...acquisitionObjectives);
  }
  return Object.freeze({
    objectives: Object.freeze(objectives.flatMap(objective => {
      const move = objective.id.startsWith("teach-") ? objective.id.slice(6) : null;
      const level = teamPlan.fieldMoveMinimumLevels?.[move];
      if (level === undefined) return [objective];
      const pcMap = move === "cut" ? "MAP_VERMILION_CITY_POKEMON_CENTER_1F"
        : move === "fly" ? "MAP_CELADON_CITY_POKEMON_CENTER_1F" : "MAP_FUCHSIA_CITY_POKEMON_CENTER_1F";
      return [partyRosterObjective(`prepare-${move}-carrier`, pcMap, {
        requiredFamilies: [fieldCarrierSpecies(teamPlan,move)],
        permanentRoster: !isHmUtilityCarrier({species:teamPlan.fieldMoves[move]?.[0]},teamPlan),
      }), ...(level > 0 ? [rosterTrainingObjective(`train-${move}-carrier`, teamPlan.fieldMoves[move], level, {
        fieldAccessObjective:({cut:'badge-cascade',fly:'badge-thunder',surf:'badge-soul',strength:'badge-rainbow'})[move]??null,
      })] : []), objective];
    })),
    mandatoryInterludes: Object.freeze([...(campaign.mandatoryInterludes ?? [])]),
  });
}

// Roster presets share the current readiness/supply rules. The legacy Origins
// constructor remains unchanged for old library callers and replay fixtures.
export function createRosterCampaign(teamPlan, options = {}) {
  if (teamPlan?.schema === "master-red/permanent-team-plan/v1") return createMasterCampaign(teamPlan, options);
  if (teamPlan?.provenance?.selection !== "origins-preset-v1") return createOriginsCampaign(teamPlan, options);
  const source = options.campaign ?? MAIN_STORY_CAMPAIGN;
  const sourceById = new Map(source.objectives.map(objective => [objective.id, objective]));
  const acquisitionCampaign = createOriginsCampaign({ ...teamPlan, battlePlans: {} }, options);
  const objectives = acquisitionCampaign.objectives.filter(objective => !MASTER_OPTIONAL_DETOURS.has(objective.id))
    .map(objective => {
      if (objective.id === "cerulean-capture-supplies") return masterCaptureSuppliesObjective();
      if (objective.id === "route16-snorlax") {
        const { captureSpecies, captureFamily, encounter, ...clearRoad } = objective;
        return Object.freeze(clearRoad);
      }
      if (!objective.importantBattle) return objective;
      const base = sourceById.get(objective.id) ?? objective;
      const battle = teamPlan.battlePlans[base.rosterPreparationFor ?? base.id];
      return masterBattleObjective(base, teamPlan, Object.freeze(battle.availableFamilies.flat()));
    });
  return Object.freeze({ ...acquisitionCampaign, objectives: Object.freeze(objectives) });
}

const DIRECTIONS = Object.freeze([
  Object.freeze({ direction: "south", dx: 0, dy: 1 }),
  Object.freeze({ direction: "east", dx: 1, dy: 0 }),
  Object.freeze({ direction: "north", dx: 0, dy: -1 }),
  Object.freeze({ direction: "west", dx: -1, dy: 0 }),
]);

const WARP_DIRECTIONS = Object.freeze({
  MB_UP_RIGHT_STAIR_WARP: "east",
  MB_DOWN_RIGHT_STAIR_WARP: "east",
  MB_UP_LEFT_STAIR_WARP: "west",
  MB_DOWN_LEFT_STAIR_WARP: "west",
  MB_NORTH_ARROW_WARP: "north",
  MB_SOUTH_ARROW_WARP: "south",
  MB_WEST_ARROW_WARP: "west",
  MB_EAST_ARROW_WARP: "east",
});

const SEAGALLOP_HARBORS = Object.freeze([
  Object.freeze({prefix:'MAP_VERMILION_CITY',map:'MAP_VERMILION_CITY',index:5}),
  Object.freeze({ prefix: "MAP_ONE_ISLAND", map: "MAP_ONE_ISLAND_HARBOR" }),
  Object.freeze({ prefix: "MAP_TWO_ISLAND", map: "MAP_TWO_ISLAND_HARBOR" }),
  Object.freeze({ prefix: "MAP_THREE_ISLAND", map: "MAP_THREE_ISLAND_HARBOR" }),
  ...['FOUR','FIVE','SIX','SEVEN'].map(n=>Object.freeze({prefix:`MAP_${n}_ISLAND`,map:`MAP_${n}_ISLAND_HARBOR`})),
]);

function seagallopHarborForMap(mapId) {
  return SEAGALLOP_HARBORS[fireRedIsland(mapId)]??null;
}

function seagallopRecommendation({ world, observation, objective }) {
  const currentMap = observation?.playerMemory?.map?.id;
  const origin = seagallopHarborForMap(currentMap);
  const destination = seagallopHarborForMap(objective?.target?.map);
  if (!origin || !destination) return null;
  if (origin.prefix === destination.prefix) {
    return campaignNavigationRecommendation({
      world,
      observation,
      objective: {
        ...objective,
        target: { kind: "map-arrival", map: objective.target.map },
        seagallopDestinationMap: objective.target.map,
      },
    });
  }
  return campaignNavigationRecommendation({
    world,
    observation,
    objective: {
      ...objective,
      target: { kind: "object", map: origin.map, index: origin.index??1 },
      seagallopDestinationMap: objective.target.map,
    },
  });
}

const LEDGE_DIRECTIONS = Object.freeze({
  MB_JUMP_SOUTH: "south",
  MB_JUMP_NORTH: "north",
  MB_JUMP_WEST: "west",
  MB_JUMP_EAST: "east",
});

const SPIN_DIRECTIONS = Object.freeze({
  MB_SPIN_RIGHT: "east",
  MB_SPIN_LEFT: "west",
  MB_SPIN_UP: "north",
  MB_SPIN_DOWN: "south",
});

const DIRECTIONAL_BLOCKED_SIDES = Object.freeze({
  MB_IMPASSABLE_EAST: Object.freeze(["east"]),
  MB_IMPASSABLE_WEST: Object.freeze(["west"]),
  MB_IMPASSABLE_NORTH: Object.freeze(["north"]),
  MB_IMPASSABLE_SOUTH: Object.freeze(["south"]),
  MB_IMPASSABLE_NORTHEAST: Object.freeze(["north", "east"]),
  MB_IMPASSABLE_NORTHWEST: Object.freeze(["north", "west"]),
  MB_IMPASSABLE_SOUTHEAST: Object.freeze(["south", "east"]),
  MB_IMPASSABLE_SOUTHWEST: Object.freeze(["south", "west"]),
});

const STEP_EDGE_SIDES = Object.freeze({
  north: Object.freeze({ source: "north", destination: "south" }),
  south: Object.freeze({ source: "south", destination: "north" }),
  west: Object.freeze({ source: "west", destination: "east" }),
  east: Object.freeze({ source: "east", destination: "west" }),
});

// ObjectEventDoesElevationMatch uses exact height (or zero), unlike movement
// which also permits Surf dismounts. Pressing A cannot perform that dismount.
function interactionElevationsMatch(playerElevation, objectElevation) {
  return !Number.isSafeInteger(playerElevation) || !Number.isSafeInteger(objectElevation) ||
    playerElevation === 0 || objectElevation === 0 || playerElevation === objectElevation;
}

function interactionExcluded(observation, x, y, direction, target) {
  return (observation?.navigationExclusions?.interactions ?? []).some(entry =>
    entry.x === x && entry.y === y && entry.direction === direction &&
    entry.target?.kind === target.kind && entry.target.x === Number(target.x) &&
    entry.target.y === Number(target.y));
}

function canCrossMetatileEdge(
  source,
  destination,
  direction,
  { canSurf = false } = {},
) {
  const sides = STEP_EDGE_SIDES[direction];
  if (!source || !destination || !sides) return false;
  const sourceElevation = Number(source.elevation);
  const destinationElevation = Number(destination.elevation);
  const sourceIsWater = SURFABLE_BEHAVIORS.has(source.behaviorName);
  const destinationIsWater = SURFABLE_BEHAVIORS.has(destination.behaviorName);
  const surfBoundary = canSurf && sourceIsWater !== destinationIsWater && (
    (sourceIsWater && destinationElevation === 3) ||
    (destinationIsWater && sourceElevation === 3)
  );
  const elevationsCompatible =
    !Number.isSafeInteger(sourceElevation) ||
    !Number.isSafeInteger(destinationElevation) ||
    sourceElevation === 0 || sourceElevation === 15 ||
    destinationElevation === 0 || destinationElevation === 15 ||
    sourceElevation === destinationElevation || surfBoundary;
  const sourceBlocked = DIRECTIONAL_BLOCKED_SIDES[source.behaviorName] ?? [];
  const destinationBlocked =
    DIRECTIONAL_BLOCKED_SIDES[destination.behaviorName] ?? [];
  return elevationsCompatible &&
    !sourceBlocked.includes(sides.source) &&
    !destinationBlocked.includes(sides.destination);
}

const AUTOMATIC_WARP_BEHAVIORS = new Set([
  "MB_CAVE_DOOR",
  "MB_LADDER",
  "MB_FALL_WARP",
  "MB_REGULAR_WARP",
  "MB_LAVARIDGE_1F_WARP",
  "MB_WARP_DOOR",
  "MB_UP_ESCALATOR",
  "MB_DOWN_ESCALATOR",
  "MB_UNION_ROOM_WARP",
]);

const WORLD_NAVIGATION_CACHE = new WeakMap();
// These entrances are changed by native map-load scripts after a permanent
// unlock. The offscreen static map still contains their original closed tile.
// Only stage an approach here; the live map must verify the actual open warp.
// An entry with an ingress stages only a target reachable from that landing;
// otherwise a walled-off floor would send the player to the door and stall.
const SCRIPTED_ENTRANCES = Object.freeze([
  { interior: "MAP_FIVE_ISLAND_ROCKET_WAREHOUSE", exterior: "MAP_FIVE_ISLAND_MEADOW", flag: 726 },
  { interior: "MAP_SIX_ISLAND_DOTTED_HOLE_", exterior: "MAP_SIX_ISLAND_RUIN_VALLEY", flag: 739 },
  // MtEmber_Exterior_OnLoad: setmetatile 42,39 (the Ruby Path cave door) once
  // VAR_MAP_SCENE_ONE_ISLAND_POKEMON_CENTER_1F >= 4.
  { interior: "MAP_MT_EMBER_RUBY_PATH_", exterior: "MAP_MT_EMBER_EXTERIOR", variable: 0x4076, atLeast: 4,
    ingress: { map: "MAP_MT_EMBER_RUBY_PATH_1F", warp: 0 } },
]);
const TRAINING_CATALOG_CACHE = new WeakMap();
const FREE_HEALER_SCRIPT_METADATA_CACHE = new WeakMap();
const FIELD_OBSTACLE_GRAPHICS = new Set([
  "OBJ_EVENT_GFX_CUT_TREE",
  "OBJ_EVENT_GFX_PUSHABLE_BOULDER",
  "OBJ_EVENT_GFX_ROCK_SMASH_ROCK",
  "OBJ_EVENT_GFX_SNORLAX",
]);
const COLLECTIBLE_OBJECT_GRAPHICS = new Set([
  "OBJ_EVENT_GFX_ITEM_BALL",
]);
const SURFABLE_BEHAVIORS = new Set([
  "MB_POND_WATER",
  "MB_FAST_WATER",
  "MB_DEEP_WATER",
  "MB_WATERFALL",
  "MB_OCEAN_WATER",
  "MB_UNUSED_WATER",
  "MB_CYCLING_ROAD_WATER",
  "MB_EASTWARD_CURRENT",
  "MB_WESTWARD_CURRENT",
  "MB_NORTHWARD_CURRENT",
  "MB_SOUTHWARD_CURRENT",
]);
const WATER_TERRAIN = 2;
// Field moves open menus and play animations. Price each activation like a
// substantial ordinary detour while still allowing genuinely useful crossings.
const FIELD_MOVE_ROUTE_PENALTY = 40;

function isSurfMountableCell(cell) {
  return SURFABLE_BEHAVIORS.has(cell?.behaviorName) &&
    Number(cell?.collision) === 0 &&
    !["MB_FAST_WATER", "MB_WATERFALL"].includes(cell.behaviorName) &&
    (
      cell.terrain === undefined ||
      Number(cell.terrain) === WATER_TERRAIN
    );
}
const FISHING_ROD_TABLES = Object.freeze([
  Object.freeze({
    itemId: 262,
    start: 0,
    end: 2,
    name: "old-rod",
    slotShares: Object.freeze([70, 30]),
  }),
  Object.freeze({
    itemId: 263,
    start: 2,
    end: 5,
    name: "good-rod",
    slotShares: Object.freeze([60, 20, 20]),
  }),
  Object.freeze({
    itemId: 264,
    start: 5,
    end: 10,
    name: "super-rod",
    slotShares: Object.freeze([40, 40, 15, 4, 1]),
  }),
]);
const LAND_ENCOUNTER_SLOT_SHARES = Object.freeze([
  20, 20, 10, 10, 10, 10, 5, 5, 4, 4, 1, 1,
]);
const WATER_ENCOUNTER_SLOT_SHARES = Object.freeze([60, 30, 5, 4, 1]);
const SAFFRON_SCRIPT_GATES = new Set([
  "MAP_ROUTE5_SOUTH_ENTRANCE",
  "MAP_ROUTE6_NORTH_ENTRANCE",
  "MAP_ROUTE7_EAST_ENTRANCE",
  "MAP_ROUTE8_WEST_ENTRANCE",
]);
const ROCKET_HIDEOUT_MAPS = new Set([
  "MAP_ROCKET_HIDEOUT_B1F",
  "MAP_ROCKET_HIDEOUT_B2F",
  "MAP_ROCKET_HIDEOUT_B3F",
  "MAP_ROCKET_HIDEOUT_B4F",
  "MAP_ROCKET_HIDEOUT_ELEVATOR",
]);
const ROCKET_HIDEOUT_ELEVATOR_APPROACH = Object.freeze({
  MAP_ROCKET_HIDEOUT_B1F: Object.freeze({
    warpIndex: 1,
    phase: "return-to-b2-spin-maze",
  }),
  MAP_ROCKET_HIDEOUT_B2F: Object.freeze({
    warpIndex: 3,
    phase: "reach-elevator",
  }),
  MAP_ROCKET_HIDEOUT_B3F: Object.freeze({
    warpIndex: 0,
    phase: "return-to-b2-spin-maze",
  }),
  MAP_ROCKET_HIDEOUT_B4F: Object.freeze({
    warpIndex: 0,
    phase: "return-to-b3-spin-maze",
  }),
});
const FIELD_MOVE_REQUIREMENTS = Object.freeze({
  OBJ_EVENT_GFX_CUT_TREE: Object.freeze({
    fieldMove: "cut",
    moveId: 15,
    badgeFlag: 2081,
  }),
  OBJ_EVENT_GFX_ROCK_SMASH_ROCK: Object.freeze({
    fieldMove: "rock-smash",
    moveId: 249,
    badgeFlag: 2085,
  }),
});

function worldData(world) {
  return world?.data ?? world ?? {};
}

function storyData(story) {
  return story?.data ?? story ?? {};
}

function symbolValue(symbols, group, name) {
  const value = Number(symbols?.[group]?.[name]?.value);
  return Number.isSafeInteger(value) ? value : null;
}

function visibleItemName(story, scriptLabel) {
  const script = (storyData(story).scripts ?? []).find(
    ({ label }) => label === scriptLabel,
  );
  const instruction = script?.instructions?.find(
    ({ op }) => op === "finditem" || op === "giveitem",
  );
  return instruction?.args?.[0] ?? null;
}

export function buildCollectionCatalog(world, story) {
  const symbols = storyData(story).symbols ?? {};
  const result = [];
  for (const map of worldData(world).maps ?? []) {
    for (const [index, event] of (map.objectEvents ?? []).entries()) {
      if (!COLLECTIBLE_OBJECT_GRAPHICS.has(event.graphics_id)) continue;
      const flagId = symbolValue(symbols, "flags", event.flag);
      const itemName = visibleItemName(story, event.script);
      const itemId = symbolValue(symbols, "items", itemName);
      if (flagId === null || itemId === null) continue;
      result.push(Object.freeze({
        id: `collect:${map.id}:visible:${index}`,
        kind: "visible",
        map: map.id,
        index,
        x: Number(event.x),
        y: Number(event.y),
        flagName: event.flag,
        flagId,
        itemName,
        itemId,
        quantity: 1,
        underfoot: false,
        target: Object.freeze({ kind: "object", map: map.id, index }),
      }));
    }
    for (const [index, event] of (map.backgroundEvents ?? []).entries()) {
      if (event.type !== "hidden_item") continue;
      const flagId = symbolValue(symbols, "flags", event.flag);
      const itemId = symbolValue(symbols, "items", event.item);
      if (flagId === null || itemId === null) continue;
      const underfoot = event.underfoot === true;
      const requiredItemId =
        event.item === "ITEM_NONE" &&
          String(event.flag).startsWith(
            "FLAG_HIDDEN_ITEM_CELADON_CITY_GAME_CORNER_COINS",
          )
          ? COIN_CASE_ITEM_ID
          : null;
      result.push(Object.freeze({
        id: `collect:${map.id}:hidden:${index}`,
        kind: "hidden",
        map: map.id,
        index,
        x: Number(event.x),
        y: Number(event.y),
        flagName: event.flag,
        flagId,
        itemName: event.item,
        itemId,
        quantity: Number(event.quantity ?? 1),
        underfoot,
        ...(requiredItemId === null ? {} : { requiredItemId }),
        target: Object.freeze(underfoot
          ? {
              kind: "itemfinder",
              map: map.id,
              index,
              x: Number(event.x),
              y: Number(event.y),
              itemId,
            }
          : { kind: "background", map: map.id, index }),
      }));
    }
  }
  return Object.freeze(result);
}

export function buildPokeBallMartCatalog(world, story) {
  const data = storyData(story);
  const symbols = data.symbols ?? {};
  const purchasableBallIds = new Set(PURCHASABLE_CAPTURE_BALL_IDS);
  const scripts = new Map(
    (data.scripts ?? []).map((script) => [script.label, script]),
  );
  const result = [];
  for (const map of worldData(world).maps ?? []) {
    for (const [objectIndex, event] of (map.objectEvents ?? []).entries()) {
      const clerk = scripts.get(event.script);
      const stockLabel = clerk?.instructions?.find(
        ({ op, args }) => op === "pokemart" && typeof args?.[0] === "string",
      )?.args?.[0];
      const stock = scripts.get(stockLabel);
      const stockItems = (stock?.instructions ?? [])
        .filter(({ op, args }) => op === ".2byte" && typeof args?.[0] === "string")
        .map(({ args }) => args[0])
        .filter((itemName) => itemName !== "ITEM_NONE");
      const resolvedStock = stockItems.flatMap((itemName, index) => {
        const itemId = symbolValue(symbols, "items", itemName);
        return itemId === null ? [] : [{ itemName, itemId, stockIndex: index }];
      });
      const ballStock = resolvedStock.filter(({ itemId }) =>
        purchasableBallIds.has(Number(itemId))
      );
      if (resolvedStock.length === 0) continue;
      result.push(Object.freeze({
        map: map.id,
        objectIndex,
        stock: Object.freeze(resolvedStock.map(Object.freeze)),
        ballStock: Object.freeze(ballStock.map(Object.freeze)),
        target: Object.freeze({ kind: "object", map: map.id, index: objectIndex }),
      }));
    }
  }
  return Object.freeze(result);
}

function buildTrainerTrainingCatalog(world, story, mechanics) {
  const storyDocument = storyData(story);
  const scripts = new Map(
    (storyDocument.scripts ?? []).map((script) => [script.label, script]),
  );
  const trainerSymbols = storyDocument.symbols ?? {};
  const mechanicsDocument = mechanics?.data ?? mechanics ?? {};
  const trainers = Array.isArray(mechanicsDocument.trainers)
    ? mechanicsDocument.trainers
    : Object.values(mechanicsDocument.trainers ?? {});
  const trainersByName = new Map(
    trainers.map((trainer) => [trainer.name, trainer]),
  );
  const trainersById = new Map(
    trainers.filter(Boolean).map((trainer) => [Number(trainer.id), trainer]),
  );
  const species = Array.isArray(mechanicsDocument.species)
    ? mechanicsDocument.species
    : Object.values(mechanicsDocument.species ?? {});
  const experienceBySpecies = new Map(
    species.filter(Boolean).map((entry) => [entry.name, Number(entry.expYield ?? 0)]),
  );
  const expectedExperience = (party) => (party ?? []).reduce(
    (total, member) => total +
      Number(experienceBySpecies.get(member.species) ?? 0) *
        Number(member.lvl ?? member.level ?? 0),
    0,
  );
  const rematchesByBase = new Map(
    (mechanicsDocument.rematches ?? []).flatMap((rematch) => {
      const baseId = Number(rematch.trainerIds?.[0]);
      return Number.isSafeInteger(baseId)
        ? [[`${rematch.map}\0${baseId}`, rematch]]
        : [];
    }),
  );
  const result = [];
  for (const map of worldData(world).maps ?? []) {
    for (const [index, event] of (map.objectEvents ?? []).entries()) {
      if (event.trainer_type !== "TRAINER_TYPE_NORMAL") continue;
      const instruction = scripts.get(event.script)?.instructions?.find(
        ({ op }) => TRAINER_TRAINING_SCRIPT_OPS.has(op),
      );
      const trainerName = instruction?.args?.[0];
      if (typeof trainerName !== "string") continue;
      const trainerId = symbolValue(trainerSymbols, "trainers", trainerName);
      const trainer = trainersByName.get(trainerName);
      if (
        trainerId === null ||
        !trainer ||
        Number(trainer.id) !== trainerId ||
        trainer.doubleBattle === true ||
        trainer.doubleBattle === "TRUE"
      ) continue;
      const party = trainer.party ?? [];
      const levels = party.map(({ lvl, level }) => Number(lvl ?? level));
      if (
        party.length === 0 ||
        levels.some((level) => !Number.isSafeInteger(level) || level <= 0)
      ) continue;
      const rematch = rematchesByBase.get(`${map.id}\0${trainerId}`);
      const rematchParties = (rematch?.trainerIds ?? []).map((id, tier) => {
        if (!Number.isSafeInteger(Number(id))) return null;
        const rematchTrainer = trainersById.get(Number(id));
        const rematchParty = rematchTrainer?.party ?? [];
        const rematchLevels = rematchParty.map(({ lvl, level }) =>
          Number(lvl ?? level)
        );
        if (
          !rematchTrainer || rematchParty.length === 0 ||
          rematchLevels.some((level) => !Number.isSafeInteger(level) || level <= 0)
        ) return null;
        return Object.freeze({
          tier,
          id: Number(id),
          name: rematchTrainer.name,
          displayName: rematchTrainer.trainerName || rematchTrainer.name,
          flagId: TRAINER_FLAGS_START + Number(id),
          minimumLevel: Math.min(...rematchLevels),
          maximumLevel: Math.max(...rematchLevels),
          partySize: rematchParty.length,
          expectedExperience: expectedExperience(rematchParty),
          expectedPayout: expectedTrainerPayout(rematchTrainer),
        });
      });
      result.push(Object.freeze({
        id: trainerId,
        name: trainerName,
        displayName: trainer.trainerName || trainerName,
        flagId: TRAINER_FLAGS_START + trainerId,
        minimumLevel: Math.min(...levels),
        maximumLevel: Math.max(...levels),
        partySize: party.length,
        expectedExperience: expectedExperience(party),
        expectedPayout: expectedTrainerPayout(trainer),
        localId: index + 1,
        rematchParties: Object.freeze(rematchParties),
        target: Object.freeze({ kind: "object", map: map.id, index }),
      }));
    }
  }
  return Object.freeze(result);
}

function buildRegionalTrainerCatalog(world, story, mechanics) {
  const storyDocument = storyData(story);
  const scripts = new Map(
    (storyDocument.scripts ?? []).map((script) => [script.label, script]),
  );
  const trainerSymbols = storyDocument.symbols ?? {};
  const mechanicsDocument = mechanics?.data ?? mechanics ?? {};
  const trainers = Array.isArray(mechanicsDocument.trainers)
    ? mechanicsDocument.trainers
    : Object.values(mechanicsDocument.trainers ?? {});
  const trainersByName = new Map(
    trainers.map((trainer) => [trainer.name, trainer]),
  );
  const result = [];
  for (const map of worldData(world).maps ?? []) {
    for (const [index, event] of (map.objectEvents ?? []).entries()) {
      if (event.trainer_type !== "TRAINER_TYPE_NORMAL") continue;
      const instruction = scripts.get(event.script)?.instructions?.find(
        ({ op }) => REGIONAL_MASTERY_TRAINER_SCRIPT_OPS.has(op),
      );
      const trainerName = instruction?.args?.[0];
      if (typeof trainerName !== "string") continue;
      const trainerId = symbolValue(trainerSymbols, "trainers", trainerName);
      const trainer = trainersByName.get(trainerName);
      if (trainerId === null || !trainer || Number(trainer.id) !== trainerId) {
        continue;
      }
      const party = trainer.party ?? [];
      const levels = party.map(({ lvl, level }) => Number(lvl ?? level));
      if (
        party.length === 0 ||
        levels.some((level) => !Number.isSafeInteger(level) || level <= 0)
      ) continue;
      result.push(Object.freeze({
        id: trainerId,
        name: trainerName,
        displayName: trainer.trainerName || trainerName,
        flagId: TRAINER_FLAGS_START + trainerId,
        minimumLevel: Math.min(...levels),
        maximumLevel: Math.max(...levels),
        partySize: party.length,
        doubleBattle: trainer.doubleBattle === true || trainer.doubleBattle === "TRUE",
        target: Object.freeze({ kind: "object", map: map.id, index }),
      }));
    }
  }
  return Object.freeze(result);
}

export function buildRegionalEncounterCatalog(world, mechanics) {
  const data = worldData(world);
  const maps = new Map((data.maps ?? []).map((map) => [map.id, map]));
  const mechanicsDocument = mechanics?.data ?? mechanics ?? {};
  const species = Array.isArray(mechanicsDocument.species)
    ? mechanicsDocument.species
    : Object.values(mechanicsDocument.species ?? {});
  const speciesByName = new Map(
    species.map((entry) => [entry.name, Number(entry.id)]),
  );
  const result = [];
  for (const encounter of data.wildEncounters ?? []) {
    const map = maps.get(encounter.map);
    if (!map) continue;
    const append = ({
      mons,
      rate,
      method,
      targetKind,
      rodItemId = null,
      slotShares = null,
    }) => {
      if (
        mons.length === 0 ||
        targetCoordinates(map, { kind: targetKind }).length === 0
      ) return;
      const bySpecies = new Map();
      for (const [index, mon] of mons.entries()) {
        const speciesId = speciesByName.get(mon.species);
        if (!Number.isSafeInteger(speciesId) || speciesId <= 0) continue;
        const existing = bySpecies.get(speciesId) ?? {
          speciesId,
          minimumLevel: Number(mon.min_level),
          maximumLevel: Number(mon.max_level),
          encounterShare: 0,
          maximumSlotShare: 0,
        };
        existing.minimumLevel = Math.min(existing.minimumLevel, Number(mon.min_level));
        existing.maximumLevel = Math.max(existing.maximumLevel, Number(mon.max_level));
        const slotShare = Number(slotShares?.[index] ?? 100 / mons.length);
        existing.encounterShare += slotShare;
        existing.maximumSlotShare = Math.max(
          existing.maximumSlotShare,
          slotShare,
        );
        bySpecies.set(speciesId, existing);
      }
      for (const entry of bySpecies.values()) {
        result.push(Object.freeze({
          ...entry,
          map: encounter.map,
          rate: Number(rate ?? 0),
          method,
          targetKind,
          ...(rodItemId ? { rodItemId } : {}),
          safari: encounter.map.startsWith("MAP_SAFARI_ZONE_"),
          requiresSilphScope: encounter.map.startsWith("MAP_POKEMON_TOWER_"),
        }));
      }
    };
    append({
      mons: encounter.land_mons?.mons ?? [],
      rate: encounter.land_mons?.encounter_rate,
      method: "land",
      targetKind: "encounter-zone",
      slotShares: LAND_ENCOUNTER_SLOT_SHARES,
    });
    append({
      mons: encounter.water_mons?.mons ?? [],
      rate: encounter.water_mons?.encounter_rate,
      method: "surf",
      targetKind: "surf-encounter-zone",
      slotShares: WATER_ENCOUNTER_SLOT_SHARES,
    });
    for (const rod of FISHING_ROD_TABLES) {
      append({
        mons: (encounter.fishing_mons?.mons ?? []).slice(rod.start, rod.end),
        rate: encounter.fishing_mons?.encounter_rate,
        method: "fishing",
        targetKind: "fishing-zone",
        rodItemId: rod.itemId,
        slotShares: rod.slotShares,
      });
    }
  }
  return Object.freeze(result);
}

function bagHasItem(observation, itemId) {
  return Object.values(observation?.playerMemory?.trainer?.bag ?? {}).some(
    (pocket) => (pocket ?? []).some(
      (entry) => Number(entry.itemId) === Number(itemId) && Number(entry.quantity) > 0,
    ),
  );
}

function bagQuantity(observation, predicate) {
  return Object.values(observation?.playerMemory?.trainer?.bag ?? {}).flat()
    .filter((entry) => predicate(entry))
    .reduce((total, entry) => total + Number(entry.quantity ?? 0), 0);
}

function captureSupplyMartAccessible(mart, observation) {
  if (mart?.map !== "MAP_FUCHSIA_CITY_MART") return true;
  // Before either southern route is genuinely open, the region graph can see
  // Fuchsia beyond a wakeable Snorlax even though the local path cannot cross
  // that one-time encounter. Do not consume or strand a rare capture merely
  // to reach stronger capture supplies.
  return watchedFlag(observation, 84) || (
    watchedFlag(observation, 128) && bagHasItem(observation, 360)
  );
}

function captureBallTargetContexts(objective) {
  const maximumLevel = Number(objective?.encounter?.maximumLevel);
  return (objective?.captureSpecies ?? []).map(Number)
    .filter((species) => Number.isSafeInteger(species) && species > 0)
    .map((species) => ({
      species,
      ...(Number.isSafeInteger(maximumLevel) && maximumLevel > 0
        ? { level: maximumLevel }
        : {}),
    }));
}

function captureBallMapType(world, objective) {
  const mapId = objective?.target?.map;
  return (worldData(world).maps ?? []).find(({ id }) => id === mapId)
    ?.properties?.map_type ?? null;
}

function captureBallPurchasePlan({
  world,
  observation,
  objective,
  mechanics,
  mart,
  targetCount,
}) {
  const ownedSpecies = observation?.playerMemory?.trainer?.pokedex?.ownedSpecies ?? [];
  const portfolio = planCaptureBallPortfolio({
    stock: mart.ballStock ?? mart.stock,
    targetCount,
    opponents: captureBallTargetContexts(objective),
    mechanics,
    ownedSpecies,
    mapType: captureBallMapType(world, objective),
  });
  const items = portfolio.flatMap((entry) => {
    const owned = bagQuantity(
      observation,
      ({ itemId }) => Number(itemId) === entry.itemId,
    );
    const missing = Math.max(0, entry.quantity - owned);
    if (missing === 0 || !bagCanReceive(observation, entry.itemId, missing)) {
      return [];
    }
    return [Object.freeze({
      itemId: entry.itemId,
      stockIndex: entry.stockIndex,
      quantity: entry.quantity,
      unitPrice: entry.unitPrice,
    })];
  });
  return Object.freeze({
    items: Object.freeze(items),
    strength: Number(portfolio[0]?.immediateMultiplier ?? 0),
    peak: Math.max(0, ...portfolio.map(({ peakMultiplier }) => peakMultiplier)),
    variety: portfolio.length,
  });
}

function selectCaptureSupplyObjective({
  world,
  observation,
  objective,
  martCatalog,
  mechanics,
} = {}) {
  const captureSpecies = (objective?.captureSpecies ?? []).map(Number)
    .filter((species) => Number.isSafeInteger(species) && species > 0);
  if (captureSpecies.length === 0 || objective?.safari) return null;
  const purchasableBallIds = new Set(PURCHASABLE_CAPTURE_BALL_IDS);
  const usableBallCount = bagQuantity(observation, ({ itemId, quantity }) =>
    purchasableBallIds.has(Number(itemId)) &&
    Number(quantity) > 0
  );
  const opponentSpecies = Number(
    observation?.playerMemory?.battle?.opponent?.species,
  );
  if (
    observation?.emulator?.mode === "battle" &&
    captureSpecies.includes(opponentSpecies) &&
    usableBallCount > 0
  ) return null;
  const money = Number(observation?.playerMemory?.trainer?.money);
  if (!Number.isSafeInteger(money) || money < 0) return null;
  const graph = createWorldNavigationGraph(world, observation);
  const candidates = (martCatalog ?? []).flatMap((mart) => {
    if (!captureSupplyMartAccessible(mart, observation)) return [];
    const ballPlan = captureBallPurchasePlan({
      world,
      observation,
      objective,
      mechanics,
      mart,
      targetCount: MANDATORY_CAPTURE_BALL_TARGET,
    });
    if (
      ballPlan.items.length > 0 &&
      !ballPlan.items.some(({ unitPrice }) => unitPrice <= money)
    ) return [];
    const metrics = routeMetrics({ graph, observation, target: mart.target });
    return metrics ? [{ mart, ballPlan, metrics }] : [];
  });
  candidates.sort((left, right) =>
    right.ballPlan.strength - left.ballPlan.strength ||
    right.ballPlan.peak - left.ballPlan.peak ||
    right.ballPlan.variety - left.ballPlan.variety ||
    left.metrics.transitions - right.metrics.transitions ||
    left.metrics.localSteps - right.metrics.localSteps ||
    left.mart.map.localeCompare(right.mart.map) ||
    left.mart.objectIndex - right.mart.objectIndex
  );
  const selected = candidates[0];
  if (!selected || selected.ballPlan.items.length === 0) return null;
  const completions = selected.ballPlan.items.map(({ itemId, quantity }) =>
    Object.freeze({ kind: "item-at-least", id: itemId, quantity })
  );
  return Object.freeze({
    id: `replenish-${objective.id}-balls`,
    target: Object.freeze({
      kind: "purchase-items",
      map: selected.mart.map,
      objectIndex: selected.mart.objectIndex,
      items: selected.ballPlan.items,
    }),
    completion: Object.freeze(completions.length === 1
      ? completions[0]
      : { kind: "all", completions: Object.freeze(completions) }),
    captureSupplyFor: objective.id,
    captureSpecies: Object.freeze([...captureSpecies]),
    captureFamily: Object.freeze([...(objective.captureFamily ?? [])]),
    supplyPriority: Object.freeze(["medicine", "poke-balls"]),
  });
}

function selectRegionalMasterySupplyObjective({
  world,
  observation,
  objective,
  martCatalog,
  mechanics,
} = {}) {
  if (
    !objective?.regionalMastery ||
    (objective.captureSpecies ?? []).length === 0 ||
    objective.safari
  ) return null;
  const captureSpecies = (objective.captureSpecies ?? []).map(Number);
  const purchasableBallIds = new Set(PURCHASABLE_CAPTURE_BALL_IDS);
  const usableBallCount = bagQuantity(observation, ({ itemId, quantity }) =>
    purchasableBallIds.has(Number(itemId)) &&
    Number(quantity) > 0
  );
  const opponentSpecies = Number(
    observation?.playerMemory?.battle?.opponent?.species,
  );
  if (
    observation?.emulator?.mode === "battle" &&
    captureSpecies.includes(opponentSpecies) &&
    usableBallCount > 0
  ) return null;

  const remainingSpecies = Math.max(
    1,
    Number(objective.remainingRegionalSpecies ?? captureSpecies.length),
  );
  const desiredBallCount = Math.min(
    REGIONAL_MASTERY_BALL_TARGET,
    Math.max(MANDATORY_CAPTURE_BALL_TARGET, remainingSpecies * 3),
  );
  const money = Number(observation?.playerMemory?.trainer?.money);
  if (!Number.isSafeInteger(money) || money < 0) return null;
  const graph = createWorldNavigationGraph(world, observation);
  const candidates = (martCatalog ?? []).flatMap((mart) => {
    if (!captureSupplyMartAccessible(mart, observation)) return [];
    const stockById = new Map(
      (mart.stock ?? []).map((entry) => [Number(entry.itemId), entry]),
    );
    const ballPlan = captureBallPurchasePlan({
      world,
      observation,
      objective,
      mechanics,
      mart,
      targetCount: desiredBallCount,
    });
    const items = [];
    let medicineTargets = 0;
    for (const group of MASTERY_MEDICINE_GROUPS) {
      const ownedInGroup = bagQuantity(observation, ({ itemId }) =>
        group.preferredItemIds.includes(Number(itemId))
      );
      const missing = Math.max(0, group.desired - ownedInGroup);
      if (missing === 0) continue;
      const selectedItemId = group.preferredItemIds.find((itemId) =>
        stockById.has(itemId)
      );
      const stock = stockById.get(selectedItemId);
      const unitPrice = MART_ITEM_UNIT_PRICES[selectedItemId];
      if (
        !stock || !Number.isSafeInteger(unitPrice) ||
        !bagCanReceive(observation, selectedItemId, missing)
      ) continue;
      const ownedSelected = bagQuantity(
        observation,
        ({ itemId }) => Number(itemId) === selectedItemId,
      );
      items.push(Object.freeze({
        itemId: selectedItemId,
        stockIndex: stock.stockIndex,
        quantity: ownedSelected + missing,
        unitPrice,
      }));
      medicineTargets += 1;
    }
    items.push(...ballPlan.items);
    if (
      items.length > 0 &&
      !items.some(({ unitPrice }) => Number(unitPrice) <= money)
    ) return [];
    const metrics = routeMetrics({ graph, observation, target: mart.target });
    return metrics
      ? [{ mart, items, medicineTargets, ballPlan, metrics }]
      : [];
  });
  candidates.sort((left, right) =>
    right.medicineTargets - left.medicineTargets ||
    right.ballPlan.strength - left.ballPlan.strength ||
    right.ballPlan.peak - left.ballPlan.peak ||
    right.ballPlan.variety - left.ballPlan.variety ||
    left.metrics.transitions - right.metrics.transitions ||
    left.metrics.localSteps - right.metrics.localSteps ||
    left.mart.map.localeCompare(right.mart.map) ||
    left.mart.objectIndex - right.mart.objectIndex
  );
  const selected = candidates[0];
  if (!selected || selected.items.length === 0) return null;
  const completions = selected.items.map(({ itemId, quantity }) =>
    Object.freeze({ kind: "item-at-least", id: itemId, quantity })
  );
  return Object.freeze({
    id: `mastery-supplies:${selected.mart.map}`,
    target: Object.freeze({
      kind: "purchase-items",
      map: selected.mart.map,
      objectIndex: selected.mart.objectIndex,
      items: Object.freeze(selected.items),
    }),
    completion: Object.freeze(completions.length === 1
      ? completions[0]
      : { kind: "all", completions: Object.freeze(completions) }),
    regionalMastery: true,
    captureSupplyFor: objective.id,
    captureSpecies: Object.freeze([...captureSpecies]),
    captureFamily: Object.freeze([...(objective.captureFamily ?? [])]),
    supplyPriority: Object.freeze([
      "medicine",
      "revives",
      "status-medicine",
      "poke-balls",
    ]),
  });
}

const BAG_POCKET_CAPACITIES = Object.freeze({
  items: 42,
  keyItems: 30,
  pokeBalls: 13,
  tmhm: 58,
  berries: 43,
});

function bagPocketForItem(itemId) {
  if (itemId >= 1 && itemId <= 12) return "pokeBalls";
  if (itemId >= 133 && itemId <= 175) return "berries";
  if (itemId >= 289 && itemId <= 346) return "tmhm";
  if (
    itemId >= 259 && itemId <= 288 ||
    itemId >= 349 && itemId <= 374
  ) return "keyItems";
  return "items";
}

function bagCanReceive(observation, itemId, quantity = 1) {
  const pocketName = bagPocketForItem(Number(itemId));
  const entries = observation?.playerMemory?.trainer?.bag?.[pocketName] ?? [];
  const existing = entries.find(
    (entry) => Number(entry.itemId) === Number(itemId),
  );
  if (existing) return Number(existing.quantity ?? 0) + Number(quantity) <= 999;
  return entries.length < BAG_POCKET_CAPACITIES[pocketName];
}

function importantBattleMedicineTargets(objective) {
  const league = ["elite-four", "champion"].includes(objective?.battleCategory);
  const statusItemIds = [...new Set(
    (objective?.statusThreatItemIds ?? IMPORTANT_BATTLE_STATUS_THREATS[objective?.id] ?? [])
      .map(Number)
      .filter((itemId) => SPECIFIC_STATUS_MEDICINE_TARGETS.some(
        (target) => target.itemId === itemId,
      )),
  )];
  return {
    healing: league ? 12 : 4,
    revives: league ? 6 : 2,
    status: statusItemIds.length > 0 ? (league ? 4 : 2) : 0,
    statusItemIds,
  };
}

function healingMedicineItemId({ observation, stockById }) {
  const maximumHp = Math.max(
    1,
    ...(observation?.playerMemory?.trainer?.party ?? []).map(
      ({ maxHp }) => Number(maxHp ?? 0),
    ),
  );
  const usefulHealing = Math.max(20, Math.ceil(maximumHp * 0.45));
  return [...IMPORTANT_BATTLE_HEALING_ITEM_HP]
    .filter(([itemId, healing]) => stockById.has(itemId) && healing >= usefulHealing)
    .sort(([leftId, leftHealing], [rightId, rightHealing]) =>
      MART_ITEM_UNIT_PRICES[leftId] - MART_ITEM_UNIT_PRICES[rightId] ||
      leftHealing - rightHealing ||
      leftId - rightId
    )[0]?.[0] ?? null;
}

function importantBattleMedicinePurchasePlan({ observation, objective, mart } = {}) {
  const stockById = new Map(
    (mart?.stock ?? []).map((entry) => [Number(entry.itemId), entry]),
  );
  const items = [];
  let coverage = 0;
  const ownedQuantity = (itemId) => bagQuantity(
    observation,
    (entry) => Number(entry.itemId) === Number(itemId),
  );
  const projectedQuantity = (itemId) =>
    items.find((entry) => Number(entry.itemId) === Number(itemId))?.quantity ??
    ownedQuantity(itemId);
  const addItem = (itemId, quantity, missing, coverageWeight) => {
    const stock = stockById.get(Number(itemId));
    const unitPrice = MART_ITEM_UNIT_PRICES[itemId];
    if (
      !stock ||
      !Number.isSafeInteger(unitPrice) ||
      missing <= 0 ||
      !bagCanReceive(observation, itemId, missing)
    ) return false;
    const existing = items.find((entry) => Number(entry.itemId) === Number(itemId));
    if (existing) {
      existing.quantity = Math.max(existing.quantity, quantity);
    } else {
      items.push({
        itemId,
        stockIndex: stock.stockIndex,
        quantity,
        unitPrice,
      });
    }
    coverage += coverageWeight;
    return true;
  };

  const targets = importantBattleMedicineTargets(objective);
  const ownedHealing = bagQuantity(observation, ({ itemId }) =>
    IMPORTANT_BATTLE_HEALING_RESERVE_IDS.includes(Number(itemId))
  );
  const missingHealing = Math.max(0, targets.healing - ownedHealing);
  const healingItemId = healingMedicineItemId({ observation, stockById });
  if (healingItemId !== null) {
    addItem(
      healingItemId,
      ownedQuantity(healingItemId) + missingHealing,
      missingHealing,
      1,
    );
  }

  const ownedRevives = ownedQuantity(24);
  addItem(24, targets.revives, Math.max(0, targets.revives - ownedRevives), 1);

  const projectedBroadStatusCount = BROAD_STATUS_MEDICINE_IDS.reduce(
    (total, itemId) => total + projectedQuantity(itemId),
    0,
  );
  const broadStatusItemId = stockById.has(23) ? 23 : null;
  if (broadStatusItemId !== null && targets.status > 0) {
    const missing = Math.max(
      0,
      targets.status - projectedBroadStatusCount,
    );
    addItem(
      broadStatusItemId,
      projectedQuantity(broadStatusItemId) + missing,
      missing,
      targets.statusItemIds.length,
    );
  } else if (targets.status > 0) {
    const desiredPerThreat = Math.ceil(targets.status / targets.statusItemIds.length);
    for (const itemId of targets.statusItemIds) {
      const owned = ownedQuantity(itemId);
      const missing = Math.max(
        0,
        desiredPerThreat - projectedBroadStatusCount - owned,
      );
      addItem(itemId, owned + missing, missing, 1);
    }
  }

  const cost = items.reduce((total, item) =>
    total + Math.max(0, item.quantity - ownedQuantity(item.itemId)) * item.unitPrice,
  0);

  return Object.freeze({
    items: Object.freeze(items.map((item) => Object.freeze(item))),
    coverage,
    cost,
  });
}

function importantBattleMedicineReserveSatisfied(observation, objective) {
  const targets = importantBattleMedicineTargets(objective);
  const healingReady = bagQuantity(observation, ({ itemId }) =>
    IMPORTANT_BATTLE_HEALING_RESERVE_IDS.includes(Number(itemId))
  ) >= targets.healing;
  const revivesReady = bagQuantity(
    observation,
    ({ itemId }) => Number(itemId) === 24,
  ) >= targets.revives;
  if (!healingReady || !revivesReady) return false;
  if (targets.status === 0) return true;

  const broadStatusCount = BROAD_STATUS_MEDICINE_IDS.reduce(
    (total, itemId) => total + bagQuantity(
      observation,
      (entry) => Number(entry.itemId) === itemId,
    ),
    0,
  );
  const desiredPerThreat = Math.ceil(targets.status / targets.statusItemIds.length);
  return broadStatusCount >= targets.status ||
    targets.statusItemIds.every((itemId) =>
      broadStatusCount + bagQuantity(
        observation,
        (entry) => Number(entry.itemId) === itemId,
      ) >= desiredPerThreat
    );
}

function importantBattleMedicineCriticalReserveSatisfied(observation, objective) {
  const targets = importantBattleMedicineTargets(objective);
  const healingReady = bagQuantity(observation, ({ itemId }) =>
    IMPORTANT_BATTLE_HEALING_RESERVE_IDS.includes(Number(itemId))
  ) >= Math.max(1, Math.ceil(targets.healing / 2));
  const revivesReady = bagQuantity(
    observation,
    ({ itemId }) => Number(itemId) === 24,
  ) >= Math.max(1, Math.ceil(targets.revives / 2));
  if (!healingReady || !revivesReady) return false;
  if (targets.status === 0) return true;

  const broadStatusCount = BROAD_STATUS_MEDICINE_IDS.reduce(
    (total, itemId) => total + bagQuantity(
      observation,
      (entry) => Number(entry.itemId) === itemId,
    ),
    0,
  );
  return broadStatusCount >= 1 || targets.statusItemIds.every(
    (itemId) => bagQuantity(
      observation,
      (entry) => Number(entry.itemId) === itemId,
    ) >= 1,
  );
}

function selectImportantBattleMedicineSupplyObjective({
  world,
  observation,
  objective,
  martCatalog,
} = {}) {
  if (
    !objective?.importantBattle ||
    objective?.target?.kind === "purchase-items" ||
    objective?.mandatoryInterlude ||
    objective?.deferOptionalDetours === true && objective?.id !== "elite-four-lorelei" ||
    observation?.emulator?.mode !== "overworld"
  ) return null;
  const money = Number(observation?.playerMemory?.trainer?.money);
  if (!Number.isSafeInteger(money) || money < 0) return null;
  const graph = createWorldNavigationGraph(world, observation);
  const candidates = (martCatalog ?? []).flatMap((mart) => {
    if (!captureSupplyMartAccessible(mart, observation)) return [];
    const medicinePlan = importantBattleMedicinePurchasePlan({
      observation,
      objective,
      mart,
    });
    if (
      medicinePlan.items.length === 0 ||
      medicinePlan.cost > money
    ) return [];
    const metrics = routeMetrics({ graph, observation, target: mart.target });
    return metrics ? [{ mart, medicinePlan, metrics }] : [];
  });
  candidates.sort((left, right) =>
    right.medicinePlan.coverage - left.medicinePlan.coverage ||
    left.metrics.transitions - right.metrics.transitions ||
    left.metrics.localSteps - right.metrics.localSteps ||
    left.mart.map.localeCompare(right.mart.map) ||
    left.mart.objectIndex - right.mart.objectIndex
  );
  const selected = candidates[0];
  if (!selected) return null;
  const completions = selected.medicinePlan.items.map(({ itemId, quantity }) =>
    Object.freeze({ kind: "item-at-least", id: itemId, quantity })
  );
  return Object.freeze({
    id: `battle-medicine:${objective.id}:${selected.mart.map}`,
    target: Object.freeze({
      kind: "purchase-items",
      map: selected.mart.map,
      objectIndex: selected.mart.objectIndex,
      items: selected.medicinePlan.items,
    }),
    completion: Object.freeze(completions.length === 1
      ? completions[0]
      : { kind: "all", completions: Object.freeze(completions) }),
    battleMedicineFor: objective.id,
    supplyPriority: Object.freeze([
      "medicine",
      "revives",
      "status-medicine",
    ]),
  });
}

function currentMapView(map, observation) {
  if (!map) return map;
  // Coordinate scripts are conditional game events, not ordinary walking
  // tiles. Read the same map variables that enable them in the cartridge.
  const variables=observation?.playerMemory?.storyState?.variables??{};
  const activeStoryTriggers=(map.coordEvents??[]).filter(event=>
    Number.isSafeInteger(variables[event.var]) &&
    variables[event.var]===Number(event.var_value));
  if(activeStoryTriggers.length) map={...map,activeStoryTriggers};
  const live = observation?.playerMemory?.mapGrid;
  if (
    !map || !live ||
    Number(live.width) !== Number(map.layout?.width) ||
    Number(live.height) !== Number(map.layout?.height)
  ) return map;
  const source = new Map(
    (map.layout?.cells ?? []).map((cell) => [`${cell.x},${cell.y}`, cell]),
  );
  return {
    ...map,
    layout: {
      ...map.layout,
      cells: (live.cells ?? []).map((cell) => ({
        ...(source.get(`${cell.x},${cell.y}`) ?? {}),
        ...cell,
      })),
    },
  };
}

function warpBehavior(map, warp) {
  return (map?.layout?.cells ?? []).find(
    ({ x, y }) => Number(x) === Number(warp?.x) && Number(y) === Number(warp?.y),
  )?.behaviorName ?? null;
}

function isActivatingWarp(map, warp) {
  const behavior = warpBehavior(map, warp);
  return Boolean(WARP_DIRECTIONS[behavior]) || AUTOMATIC_WARP_BEHAVIORS.has(behavior);
}

function isLiveOpenedWarp(staticMap, currentMap, warp) {
  const cellAtWarp = (map) => (map?.layout?.cells ?? []).find(
    ({ x, y }) => Number(x) === Number(warp?.x) && Number(y) === Number(warp?.y),
  );
  const staticCell = cellAtWarp(staticMap);
  const currentCell = cellAtWarp(currentMap);
  return Boolean(
    staticCell && currentCell &&
    Number(staticCell.collision) !== 0 &&
    Number(currentCell.collision) === 0
  );
}

function mapEdges(map) {
  return [
    ...(map?.warpEvents ?? []).flatMap((warp, index) => isActivatingWarp(map, warp) ? [{
      kind: "warp",
      destinationMap: warp.dest_map,
      x: Number(warp.x),
      y: Number(warp.y),
      index,
    }] : []),
    ...(map?.connections ?? []).map((connection, index) => ({
      kind: "connection",
      destinationMap: connection.map,
      direction: connection.direction,
      offset: Number(connection.offset ?? 0),
      index,
    })),
  ].filter(({ destinationMap }) => typeof destinationMap === "string");
}

function firstMapEdge(maps, startMap, targetMap) {
  if (startMap === targetMap) return null;
  const queue = [{ map: startMap, first: null }];
  const visited = new Set([startMap]);
  for (let cursor = 0; cursor < queue.length; cursor += 1) {
    const current = queue[cursor];
    for (const edge of mapEdges(maps.get(current.map))) {
      if (visited.has(edge.destinationMap) || !maps.has(edge.destinationMap)) continue;
      const first = current.first ?? edge;
      if (edge.destinationMap === targetMap) return first;
      visited.add(edge.destinationMap);
      queue.push({ map: edge.destinationMap, first });
    }
  }
  return null;
}

function spinLanding({ cells, x, y, blocked, capabilities }) {
  const key = (cellX, cellY) => `${cellX},${cellY}`;
  let direction = SPIN_DIRECTIONS[cells.get(key(x, y))?.behaviorName];
  if (!direction) return { x, y };
  const visited = new Set();
  while (true) {
    const coordinate = key(x, y);
    if (visited.has(coordinate)) return null;
    visited.add(coordinate);
    const current = cells.get(coordinate);
    if (current?.behaviorName === "MB_STOP_SPINNING") return { x, y };
    direction = SPIN_DIRECTIONS[current?.behaviorName] ?? direction;
    const step = DIRECTIONS.find((candidate) =>
      candidate.direction === direction
    );
    if (!step) return null;
    const nextX = x + step.dx;
    const nextY = y + step.dy;
    const nextCoordinate = key(nextX, nextY);
    const next = cells.get(nextCoordinate);
    if (
      !next || Number(next.collision) !== 0 || blocked.has(nextCoordinate) ||
      !canCrossMetatileEdge(current, next, direction, capabilities)
    ) {
      return { x, y };
    }
    x = nextX;
    y = nextY;
  }
}

function navigationSurfaceRevision(map, blocked, interactive) {
  const digest = createHash("sha256");
  digest.update(JSON.stringify({
    map: map?.id ?? null,
    layout: map?.layout?.id ?? null,
    width: Number(map?.layout?.width),
    height: Number(map?.layout?.height),
    ...(map?.activeStoryTriggers?.length ? {storyTriggers:map.activeStoryTriggers.map(e=>[Number(e.x),Number(e.y),e.script])}:{}),
    cells: [...(map?.layout?.cells ?? [])]
      .sort((left, right) => Number(left.y) - Number(right.y) ||
        Number(left.x) - Number(right.x))
      .map(({ x, y, collision, elevation, behaviorName }) => [
        Number(x),
        Number(y),
        Number(collision),
        Number(elevation),
        behaviorName ?? null,
      ]),
    blocked: [...blocked].sort(),
    interactive: [...interactive.entries()]
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([coordinate, value]) => [
        coordinate,
        value?.action ?? null,
        value?.fieldMove ?? null,
        Number(value?.moveId) || null,
        value?.allowedDirections ?? null,
        value?.elevation ?? null,
      ]),
  }));
  return digest.digest("hex");
}

function localRoutes(
  map,
  position,
  targets,
  blocked = new Set(),
  interactive = new Map(),
  capabilities = {},
) {
  const width = Number(map?.layout?.width);
  const height = Number(map?.layout?.height);
  if (!Number.isSafeInteger(width) || !Number.isSafeInteger(height)) return new Map();
  const key = (x, y) => `${x},${y}`;
  const routeTargets = new Set(
    targets instanceof Map ? targets.keys() : targets,
  );
  const remainingTargets = new Set(routeTargets);
  const routes = new Map();
  if (remainingTargets.size === 0) return routes;
  const cells = new Map(
    (map.layout.cells ?? []).map((cell) => [key(cell.x, cell.y), cell]),
  );
  const automaticWarpCoordinates = new Set(
    (map?.warpEvents ?? []).flatMap((warp) =>
      AUTOMATIC_WARP_BEHAVIORS.has(warpBehavior(map, warp))
        ? [key(Number(warp.x), Number(warp.y))]
        : []
    ),
  );
  const routeBlocked = new Set(blocked);
  const storyTriggerCoordinates=new Set((map?.activeStoryTriggers??[]).map(e=>key(Number(e.x),Number(e.y))));
  const originCoordinate = key(position.x, position.y);
  for (const coordinate of automaticWarpCoordinates) {
    if (coordinate !== originCoordinate && !routeTargets.has(coordinate)) {
      routeBlocked.add(coordinate);
    }
  }
  const mapRevision = navigationSurfaceRevision(map, routeBlocked, interactive);
  let ordinaryComponents = null;
  let queueOrder = 0;
  const compareQueuedRoutes = (left, right) =>
    left.travelCost - right.travelCost ||
    left.distance - right.distance ||
    left.queueOrder - right.queueOrder;
  const queue = [];
  const enqueue = (route) => {
    queue.push(route);
    let index = queue.length - 1;
    while (index > 0) {
      const parent = Math.floor((index - 1) / 2);
      if (compareQueuedRoutes(queue[parent], queue[index]) <= 0) break;
      [queue[parent], queue[index]] = [queue[index], queue[parent]];
      index = parent;
    }
  };
  const dequeue = () => {
    const first = queue[0];
    const last = queue.pop();
    if (queue.length > 0) {
      queue[0] = last;
      let index = 0;
      while (true) {
        const left = index * 2 + 1;
        const right = left + 1;
        let smallest = index;
        if (
          left < queue.length &&
          compareQueuedRoutes(queue[left], queue[smallest]) < 0
        ) smallest = left;
        if (
          right < queue.length &&
          compareQueuedRoutes(queue[right], queue[smallest]) < 0
        ) smallest = right;
        if (smallest === index) break;
        [queue[index], queue[smallest]] = [queue[smallest], queue[index]];
        index = smallest;
      }
    }
    return first;
  };
  const stateKey = (x, y, surfing, elevation) => `${key(x, y)}|${Number(surfing)}|${elevation}`;
  const start = {
    x: position.x,
    y: position.y,
    distance: 0,
    travelCost: 0,
    surfing: capabilities.currentlySurfing === true,
    elevation: capabilities.currentElevation ?? cells.get(originCoordinate)?.elevation,
    mapRevision,
    routeNode: null,
    first: null,
    firstSegmentOpen: true,
    firstSegmentSteps: 0,
    firstSegmentEndX: position.x,
    firstSegmentEndY: position.y,
    firstContinuation: null,
    firstObstacle: null,
    queueOrder: queueOrder++,
  };
  enqueue(start);
  const bestRoutes = new Map([[
    stateKey(start.x, start.y, start.surfing, start.elevation),
    { travelCost: 0, distance: 0 },
  ]]);
  while (queue.length > 0) {
    const current = dequeue();
    const currentBest = bestRoutes.get(
      stateKey(current.x, current.y, current.surfing, current.elevation),
    );
    if (
      !currentBest ||
      current.travelCost !== currentBest.travelCost ||
      current.distance !== currentBest.distance
    ) continue;
    const currentCoordinate = key(current.x, current.y);
    if (remainingTargets.delete(currentCoordinate)) {
      routes.set(currentCoordinate, current);
      if (remainingTargets.size === 0) return routes;
    }
    if (
      current.distance > 0 &&
      automaticWarpCoordinates.has(currentCoordinate)
    ) continue;
    for (const step of DIRECTIONS) {
      const adjacentX = current.x + step.dx;
      const adjacentY = current.y + step.dy;
      const adjacent = cells.get(key(adjacentX, adjacentY));
      const jumping =
        LEDGE_DIRECTIONS[adjacent?.behaviorName] === step.direction;
      let x = current.x + step.dx * (jumping ? 2 : 1);
      let y = current.y + step.dy * (jumping ? 2 : 1);
      let coordinate = key(x, y);
      let cell = cells.get(coordinate);
      let obstacle = interactive.get(coordinate) ?? null;
      const obstacleDirectionAllowed = !Array.isArray(obstacle?.allowedDirections) ||
        obstacle.allowedDirections.includes(step.direction);
      let locallyRoutableJump = false;
      if (jumping) {
        // Reachability proofs may include the separate ledge actions that the
        // navigator executes between regions without reloading the map.
        if (capabilities.includeRegionLedges) locallyRoutableJump = true;
        else {
          ordinaryComponents ??= collisionComponents(map, capabilities).byCoordinate;
          const sourceComponent = ordinaryComponents.get(currentCoordinate);
          locallyRoutableJump = sourceComponent !== undefined &&
            sourceComponent === ordinaryComponents.get(coordinate);
        }
      }
      if (
        x < 0 || y < 0 || x >= width || y >= height ||
        !obstacleDirectionAllowed ||
        (obstacle?.obstacle?.kind === 'object' &&
          !interactionElevationsMatch(current.elevation, obstacle.elevation)) ||
        (routeBlocked.has(coordinate) && !obstacle) || !cell ||
        (Number(cell.collision) !== 0 && !obstacle) ||
        (Number(adjacent?.collision) !== 0 && !obstacle && !locallyRoutableJump) ||
        !canCrossMetatileEdge(
          cells.get(key(current.x, current.y)),
          adjacent,
          step.direction,
          capabilities,
        ) ||
        (jumping && !canCrossMetatileEdge(adjacent, cell, step.direction, capabilities))
      ) continue;
      if (!obstacle) {
        const landing = spinLanding({
          cells,
          x,
          y,
          blocked: routeBlocked,
          capabilities,
        });
        if (!landing) continue;
        x = landing.x;
        y = landing.y;
        coordinate = key(x, y);
        cell = cells.get(coordinate);
      }
      const destinationIsWater = SURFABLE_BEHAVIORS.has(cell?.behaviorName);
      let surfing = false;
      if (destinationIsWater) {
        if (current.surfing) {
          if (obstacle?.fieldMove === "surf") obstacle = null;
        } else if (obstacle?.fieldMove !== "surf") {
          if (!capabilities.canSurf || !isSurfMountableCell(cell)) continue;
          obstacle = {
            action: "use-field-move",
            fieldMove: "surf",
            moveId: 57,
            obstacle: { kind: "terrain", x, y },
          };
        }
        surfing = true;
      }
      const travelCost = current.travelCost + 1 + (
        obstacle?.fieldMove ? FIELD_MOVE_ROUTE_PENALTY : 0
      ) + (storyTriggerCoordinates.has(coordinate) && !routeTargets.has(coordinate) ? width*height : 0);
      const distance = current.distance + 1;
      const elevation = cell.elevation === 15 ? current.elevation : cell.elevation;
      const nextStateKey = stateKey(x, y, surfing, elevation);
      const previousBest = bestRoutes.get(nextStateKey);
      if (
        previousBest &&
        (
          previousBest.travelCost < travelCost ||
          previousBest.travelCost === travelCost &&
            previousBest.distance <= distance
        )
      ) continue;
      bestRoutes.set(nextStateKey, { travelCost, distance });
      const surfaceModeChanged = current.surfing !== surfing;
      const extendsFirstSegment = current.first === null || (
        current.firstSegmentOpen && current.first === step.direction
      );
      const startsSafeContinuation =
        current.first !== null &&
        current.firstSegmentOpen &&
        current.first !== step.direction &&
        !jumping &&
        !obstacle &&
        !surfaceModeChanged &&
        x === adjacentX &&
        y === adjacentY;
      enqueue({
        x,
        y,
        distance,
        travelCost,
        surfing,
        mapRevision,
        routeNode: {
          previous: current.routeNode,
          direction: step.direction,
          x,
          y,
          continuous:
            !jumping && !obstacle && !surfaceModeChanged && !storyTriggerCoordinates.has(coordinate) &&
            x === adjacentX && y === adjacentY,
        },
        elevation,
        first: current.first ?? step.direction,
        firstSegmentOpen: extendsFirstSegment && !storyTriggerCoordinates.has(coordinate),
        firstSegmentSteps: current.firstSegmentSteps +
          (extendsFirstSegment ? 1 : 0),
        firstSegmentEndX: extendsFirstSegment ? x : current.firstSegmentEndX,
        firstSegmentEndY: extendsFirstSegment ? y : current.firstSegmentEndY,
        firstContinuation: current.firstContinuation ?? (
          startsSafeContinuation ? step.direction : null
        ),
        firstObstacle: current.firstObstacle ?? (obstacle ? {
          ...obstacle,
          x,
          y,
          approachX: current.x,
          approachY: current.y,
          direction: step.direction,
          approachDistance: current.distance,
        } : null),
        queueOrder: queueOrder++,
      });
    }
  }
  return routes;
}

function plannedRoutePlan(routed, position, mapId, maximumSteps = Infinity) {
  const reversed = [];
  for (let node = routed?.routeNode; node; node = node.previous) reversed.push(node);
  const route = reversed.reverse();
  const limit = Math.min(route.length, Number(maximumSteps));
  if (
    typeof mapId !== "string" || mapId === "" ||
    !Number.isSafeInteger(Number(position?.x)) ||
    !Number.isSafeInteger(Number(position?.y)) ||
    !Number.isSafeInteger(limit) || limit < 1
  ) return null;

  const safeRoute = [];
  for (const step of route.slice(0, limit)) {
    if (!step.continuous) break;
    safeRoute.push(step);
  }
  if (safeRoute.length === 0) return null;

  const segments = [];
  for (const step of safeRoute) {
    const previous = segments.at(-1);
    if (previous?.direction === step.direction) {
      previous.steps += 1;
      previous.endpoint = { x: step.x, y: step.y };
    } else {
      segments.push({
        direction: step.direction,
        steps: 1,
        endpoint: { x: step.x, y: step.y },
      });
    }
  }
  const destination = safeRoute.at(-1);
  return {
    map: mapId,
    mapRevision: routed.mapRevision,
    origin: { x: Number(position.x), y: Number(position.y) },
    destination: { x: destination.x, y: destination.y },
    steps: safeRoute.length,
    segments,
  };
}

function localRoute(
  map,
  position,
  targets,
  blocked = new Set(),
  interactive = new Map(),
  capabilities = {},
) {
  return localRoutes(
    map,
    position,
    targets,
    blocked,
    interactive,
    capabilities,
  ).values().next().value ?? null;
}

function farthestLocalRoute(
  map,
  position,
  targets,
  blocked = new Set(),
  interactive = new Map(),
  capabilities = {},
) {
  return [...localRoutes(
    map,
    position,
    targets,
    blocked,
    interactive,
    capabilities,
  ).values()].sort((left, right) =>
    Number(right.distance) - Number(left.distance) ||
    Number(left.y) - Number(right.y) ||
    Number(left.x) - Number(right.x)
  )[0] ?? null;
}

function plannedPathSegment(
  routed,
  position,
  mapId,
  maximumSteps = Infinity,
  terminalContinuationDirection = null,
) {
  const availableSteps = Number(routed?.firstSegmentSteps);
  const allowedSteps = Math.min(availableSteps, Number(maximumSteps));
  const direction = routed?.first;
  const startX = Number(position?.x);
  const startY = Number(position?.y);
  const vector = DIRECTIONS.find((candidate) => candidate.direction === direction);
  if (
    !vector || typeof mapId !== "string" || mapId === "" ||
    !Number.isSafeInteger(startX) || !Number.isSafeInteger(startY) ||
    !Number.isSafeInteger(availableSteps) || !Number.isSafeInteger(allowedSteps) ||
    allowedSteps < 1
  ) return null;

  const endpoint = allowedSteps === availableSteps
    ? { x: Number(routed.firstSegmentEndX), y: Number(routed.firstSegmentEndY) }
    : {
        x: startX + vector.dx * allowedSteps,
        y: startY + vector.dy * allowedSteps,
      };
  if (
    !Number.isSafeInteger(endpoint.x) || !Number.isSafeInteger(endpoint.y) ||
    Math.abs(endpoint.x - startX) + Math.abs(endpoint.y - startY) !== allowedSteps
  ) return null;

  const continuationCandidate = routed.firstContinuation ?? (
    allowedSteps === availableSteps &&
    availableSteps === Number(routed.distance)
      ? terminalContinuationDirection
      : null
  );
  const continuationDirection = allowedSteps === availableSteps &&
    DIRECTIONS.some(({ direction: candidate }) =>
      candidate === continuationCandidate
    )
    ? continuationCandidate
    : null;
  if (allowedSteps < 2 && !continuationDirection) return null;
  return {
    direction,
    steps: allowedSteps,
    endpoint: { map: mapId, x: endpoint.x, y: endpoint.y },
    ...(continuationDirection ? { continuationDirection } : {}),
  };
}

function pathSegmentFields(
  routed,
  position,
  mapId,
  maximumSteps = Infinity,
  terminalContinuationDirection = null,
) {
  const pathSegment = plannedPathSegment(
    routed,
    position,
    mapId,
    maximumSteps,
    terminalContinuationDirection,
  );
  const routePlan = plannedRoutePlan(routed, position, mapId, maximumSteps);
  return {
    ...(pathSegment ? { pathSegment } : {}),
    ...(routePlan ? { routePlan } : {}),
  };
}

function liveObjectBlockers(observation) {
  const blockers = new Set();
  for (const objectEvent of observation?.playerMemory?.objectEvents ?? []) {
    if (objectEvent.player) continue;
    for (const coordinate of [objectEvent.current, objectEvent.previous]) {
      if (Number.isSafeInteger(coordinate?.x) && Number.isSafeInteger(coordinate?.y)) {
        blockers.add(`${coordinate.x},${coordinate.y}`);
      }
    }
  }
  return blockers;
}

function liveObjectBelongsToCurrentMap(objectEvent, observation) {
  const eventMap = objectEvent?.map;
  const currentMap = observation?.playerMemory?.map;
  if (
    typeof eventMap?.id === "string" &&
    typeof currentMap?.id === "string"
  ) return eventMap.id === currentMap.id;
  const coordinates = [
    eventMap?.group,
    eventMap?.number,
    currentMap?.group,
    currentMap?.number,
  ].map(Number);
  return coordinates.every(Number.isSafeInteger)
    ? coordinates[0] === coordinates[2] && coordinates[1] === coordinates[3]
    : true;
}

function currentMapLiveObjects(observation) {
  return (observation?.playerMemory?.objectEvents ?? []).filter(
    (objectEvent) =>
      !objectEvent.player && liveObjectBelongsToCurrentMap(objectEvent, observation),
  );
}

function currentMapObjectTemplates(observation) {
  return Array.isArray(observation?.playerMemory?.objectEventTemplates)
    ? observation.playerMemory.objectEventTemplates
    : [];
}

function persistedObjectForMapIndex(observation, index) {
  return currentMapObjectTemplates(observation).find(
    ({ localId }) => Number(localId) === Number(index) + 1,
  ) ?? null;
}

function observedObjectPosition(observation, index, sourceObject) {
  return liveObjectForMapIndex(observation, index)?.current ??
    persistedObjectForMapIndex(observation, index)?.current ??
    sourceObject;
}

function mapObjectBlockers(map, observation) {
  const blockers = liveObjectBlockers(observation);
  const observedFlags = observation?.playerMemory?.storyState?.flags ?? {};
  const liveEvents = observation?.playerMemory?.objectEvents;
  const hasLiveEvents = Array.isArray(liveEvents);
  const liveByLocalId = new Map(
    currentMapLiveObjects(observation)
      .map((event) => [Number(event.localId), event]),
  );
  const persistedByLocalId = new Map(
    currentMapObjectTemplates(observation)
      .map((event) => [Number(event.localId), event]),
  );
  const position = observation?.playerMemory?.position;
  for (const [index, objectEvent] of (map?.objectEvents ?? []).entries()) {
    const flag = objectEvent.flag;
    if (flag && flag !== "0" && observedFlags[flag] === true) continue;
    if (liveByLocalId.has(index + 1)) continue;
    const persisted = persistedByLocalId.get(index + 1)?.current;
    const objectX = Number(persisted?.x ?? objectEvent.x);
    const objectY = Number(persisted?.y ?? objectEvent.y);
    const playerOccupiesSource = hasLiveEvents &&
      objectX === Number(position?.x) &&
      objectY === Number(position?.y);
    if (playerOccupiesSource) continue;
    const nearbyRemovedFieldObject =
      hasLiveEvents && FIELD_OBSTACLE_GRAPHICS.has(objectEvent.graphics_id) &&
      Math.abs(objectX - Number(position?.x)) <= 2 &&
      Math.abs(objectY - Number(position?.y)) <= 2;
    if (nearbyRemovedFieldObject) continue;
    if (Number.isSafeInteger(objectX) && Number.isSafeInteger(objectY)) {
      blockers.add(`${objectX},${objectY}`);
    }
  }
  return blockers;
}

function partyKnowsMove(observation, moveId) {
  return (observation?.playerMemory?.trainer?.party ?? []).some(({ moves }) =>
    (moves ?? []).map(Number).includes(Number(moveId))
  );
}

function watchedFlag(observation, id) {
  return observation?.playerMemory?.storyState?.flagIds?.[id] === true;
}

function unavailableStoryMaps(observation) {
  const unavailable = new Set();
  for (const mapId of Object.keys(OPTIONAL_MAP_REQUIREMENTS)) {
    if (!optionalMapAuthorized(mapId, observation)) unavailable.add(mapId);
  }
  if (!watchedFlag(observation, 678)) {
    for (const mapId of SAFFRON_SCRIPT_GATES) unavailable.add(mapId);
  }
  if (!watchedFlag(observation, 573)) unavailable.add("MAP_ROUTE12");
  if (!watchedFlag(observation, 0x26d)) {
    for (const mapId of ROCKET_HIDEOUT_MAPS) unavailable.add(mapId);
  }
  return unavailable;
}

function fieldObjectAction(objectEvent, observation) {
  const requirement = FIELD_MOVE_REQUIREMENTS[objectEvent?.graphics_id];
  if (requirement) {
    return partyKnowsMove(observation, requirement.moveId) &&
      watchedFlag(observation, requirement.badgeFlag)
      ? { ...requirement, action: "use-field-move" }
      : null;
  }
  if (objectEvent?.graphics_id === "OBJ_EVENT_GFX_PUSHABLE_BOULDER") {
    if (watchedFlag(observation, 2053)) {
      return { fieldMove: "strength", moveId: 70, action: "push-field-obstacle" };
    }
    return partyKnowsMove(observation, 70) && watchedFlag(observation, 2083)
      ? { fieldMove: "strength", moveId: 70, action: "use-field-move" }
      : null;
  }
  return null;
}

function pushableBoulderDirections(map, coordinate, blocked, liveObject) {
  const cells = new Map(
    (map?.layout?.cells ?? []).map((cell) => [`${cell.x},${cell.y}`, cell]),
  );
  const boulderCell = cells.get(`${Number(coordinate?.x)},${Number(coordinate?.y)}`);
  if (!boulderCell) return [];
  const ownCoordinates = new Set(
    [liveObject?.current, liveObject?.previous]
      .filter((value) => Number.isSafeInteger(Number(value?.x)) &&
        Number.isSafeInteger(Number(value?.y)))
      .map((value) => `${Number(value.x)},${Number(value.y)}`),
  );
  return DIRECTIONS.filter((step) => {
    const destinationKey = `${Number(coordinate.x) + step.dx},${
      Number(coordinate.y) + step.dy}`;
    const destination = cells.get(destinationKey);
    if (!destination || (blocked.has(destinationKey) && !ownCoordinates.has(destinationKey))) {
      return false;
    }
    if (destination.behaviorName === "MB_FALL_WARP") return true;
    return Number(destination.collision) === 0 &&
      destination.behaviorName !== "MB_CAVE_DOOR" &&
      canCrossMetatileEdge(boulderCell, destination, step.direction);
  }).map(({ direction }) => direction);
}

function routingState(map, observation) {
  const blocked = mapObjectBlockers(map, observation);
  for (const { x, y } of observation?.navigationExclusions?.tiles ?? []) {
    blocked.add(`${x},${y}`);
  }
  const interactive = new Map();
  const liveEvents = observation?.playerMemory?.objectEvents;
  const hasLiveEvents = Array.isArray(liveEvents);
  const liveByLocalId = new Map(
    currentMapLiveObjects(observation)
      .map((event) => [Number(event.localId), event]),
  );
  const observedFlags = observation?.playerMemory?.storyState?.flags ?? {};
  const position = observation?.playerMemory?.position;
  for (const [index, objectEvent] of (map?.objectEvents ?? []).entries()) {
    const collectible = COLLECTIBLE_OBJECT_GRAPHICS.has(objectEvent.graphics_id);
    if (!FIELD_OBSTACLE_GRAPHICS.has(objectEvent.graphics_id) && !collectible) {
      continue;
    }
    const flag = objectEvent.flag;
    if (flag && flag !== "0" && observedFlags[flag] === true) continue;
    const live = liveByLocalId.get(index + 1);
    const coordinate = observedObjectPosition(observation, index, objectEvent);
    if (
      !live && hasLiveEvents &&
      Math.abs(Number(coordinate.x) - Number(position?.x)) <= 2 &&
      Math.abs(Number(coordinate.y) - Number(position?.y)) <= 2
    ) continue;
    let action = collectible
      ? { action: "interact-with-object" }
      : fieldObjectAction(objectEvent, observation);
    if (!action) continue;
    if (objectEvent.graphics_id === "OBJ_EVENT_GFX_PUSHABLE_BOULDER") {
      action = {
        ...action,
        allowedDirections: pushableBoulderDirections(
          map,
          coordinate,
          blocked,
          live,
        ),
      };
    }
    const key = `${Number(coordinate.x)},${Number(coordinate.y)}`;
    const target = { kind: 'object', index, x: Number(coordinate.x), y: Number(coordinate.y) };
    const excludedDirections = DIRECTIONS.filter(step => interactionExcluded(
      observation, target.x - step.dx, target.y - step.dy, step.direction, target,
    )).map(step => step.direction);
    interactive.set(key, {
      ...action,
      elevation: live?.elevation ?? objectEvent.elevation,
      ...(excludedDirections.length ? { allowedDirections: (action.allowedDirections ??
        DIRECTIONS.map(step => step.direction)).filter(direction => !excludedDirections.includes(direction)) } : {}),
      obstacle: {
        kind: "object",
        index,
        x: Number(coordinate.x),
        y: Number(coordinate.y),
      },
    });
    blocked.delete(key);
  }

  if (!observation?.playerMemory?.avatar?.surfing) {
    const canSurf = partyKnowsMove(observation, 57) && watchedFlag(observation, 2084);
    for (const cell of map?.layout?.cells ?? []) {
      if (!SURFABLE_BEHAVIORS.has(cell.behaviorName)) continue;
      const key = `${Number(cell.x)},${Number(cell.y)}`;
      if (canSurf && isSurfMountableCell(cell)) {
        interactive.set(key, {
          action: "use-field-move",
          fieldMove: "surf",
          moveId: 57,
          obstacle: {
            kind: "terrain",
            x: Number(cell.x),
            y: Number(cell.y),
          },
        });
        blocked.delete(key);
      } else {
        blocked.add(key);
      }
    }
  }
  return { blocked, interactive };
}

function routingWithoutStatefulBoulders(blocked, interactive) {
  const routedBlocked = new Set(blocked);
  const routedInteractive = new Map(interactive);
  for (const [coordinate, obstacle] of interactive) {
    if (obstacle?.fieldMove !== "strength") continue;
    routedInteractive.delete(coordinate);
    routedBlocked.add(coordinate);
  }
  return { blocked: routedBlocked, interactive: routedInteractive };
}

function obstacleRecommendation(routed, position, objective, targetMap, mapId) {
  const obstacle = routed?.firstObstacle;
  if (!obstacle) return null;
  const atApproach =
    Number(position?.x) === obstacle.approachX &&
    Number(position?.y) === obstacle.approachY;
  return {
    kind: atApproach ? obstacle.action : "move-toward",
    direction: atApproach ? obstacle.direction : routed.first,
    ...(!atApproach
      ? pathSegmentFields(
          routed,
          position,
          mapId,
          Number(obstacle.approachDistance),
        )
      : {}),
    fieldMove: obstacle.fieldMove,
    moveId: obstacle.moveId,
    objective: objective.id,
    targetMap,
    obstacle: obstacle.obstacle,
    remainingSteps: obstacle.approachDistance,
  };
}

function resolveTarget(target, observation) {
  if (target?.kind !== "variable-background") return target;
  const value = Number(
    observation?.playerMemory?.storyState?.variableIds?.[target.variableId],
  );
  const index = Number.isSafeInteger(value) && value >= Number(target.minimum ?? 1)
    ? value + Number(target.indexOffset ?? 0)
    : Number(target.fallbackIndex ?? 0);
  return { ...target, kind: "background", index };
}

function liveObjectForMapIndex(observation, index) {
  return currentMapLiveObjects(observation).find(
    ({ localId }) => Number(localId) === Number(index) + 1,
  ) ?? null;
}

function authoredBoulderLivePathState({ world, observation, objective }) {
  const target = objective?.target;
  const path = objective?.authoredBoulderPath;
  const currentMap = observation?.playerMemory?.map?.id;
  if (
    target?.kind !== "push-boulder" ||
    !Array.isArray(path) ||
    path.length < 2 ||
    currentMap !== target.map
  ) return null;
  const map = (worldData(world).maps ?? []).find(({ id }) => id === currentMap);
  const sourceObject = map?.objectEvents?.[target.objectIndex];
  const liveObject = liveObjectForMapIndex(observation, target.objectIndex);
  if (
    sourceObject?.graphics_id !== "OBJ_EVENT_GFX_PUSHABLE_BOULDER" ||
    !Number.isSafeInteger(Number(liveObject?.current?.x)) ||
    !Number.isSafeInteger(Number(liveObject?.current?.y))
  ) return null;
  return path.some((coordinate) =>
    Number(coordinate?.x) === Number(liveObject.current.x) &&
    Number(coordinate?.y) === Number(liveObject.current.y)
  ) ? "on-path" : "off-path";
}

function boulderPlan({ map, observation, objective }) {
  const target = objective?.target;
  const sourceObject = map?.objectEvents?.[target?.objectIndex];
  if (!sourceObject || sourceObject.graphics_id !== "OBJ_EVENT_GFX_PUSHABLE_BOULDER") {
    return null;
  }
  if (observation?.playerMemory?.storyState?.flags?.[sourceObject.flag] === true) return null;
  const boulder = observedObjectPosition(
    observation,
    target.objectIndex,
    sourceObject,
  );
  const player = observation?.playerMemory?.position;
  if (![boulder?.x, boulder?.y, player?.x, player?.y, target?.x, target?.y]
    .every((value) => Number.isSafeInteger(Number(value)))) return null;

  const cells = new Map(
    (map.layout?.cells ?? []).map((cell) => [`${cell.x},${cell.y}`, cell]),
  );
  const otherBlockers = new Set();
  const liveByLocalId = new Map(
    currentMapLiveObjects(observation)
      .map((event) => [Number(event.localId), event]),
  );
  const flags = observation?.playerMemory?.storyState?.flags ?? {};
  for (const [index, object] of (map.objectEvents ?? []).entries()) {
    if (index === Number(target.objectIndex)) continue;
    if (object.flag && object.flag !== "0" && flags[object.flag] === true) continue;
    const coordinate = liveByLocalId.get(index + 1)?.current ?? object;
    otherBlockers.add(`${Number(coordinate.x)},${Number(coordinate.y)}`);
  }
  const passable = (x, y) => {
    const cell = cells.get(`${x},${y}`);
    return Boolean(cell) && Number(cell.collision) === 0 &&
      !otherBlockers.has(`${x},${y}`);
  };
  const routePlayer = (position, destination, boulderPosition) => localRoute(
    map,
    position,
    new Set([`${destination.x},${destination.y}`]),
    new Set([...otherBlockers, `${boulderPosition.x},${boulderPosition.y}`]),
  );
  const authoredPath = objective?.authoredBoulderPath;
  if (Array.isArray(authoredPath) && authoredPath.length > 1) {
    const currentIndex = authoredPath.findIndex((coordinate) =>
      Number(coordinate?.x) === Number(boulder.x) &&
      Number(coordinate?.y) === Number(boulder.y)
    );
    if (currentIndex === authoredPath.length - 1) return null;
    if (currentIndex >= 0) {
      const next = authoredPath[currentIndex + 1];
      const dx = Number(next.x) - Number(boulder.x);
      const dy = Number(next.y) - Number(boulder.y);
      const push = DIRECTIONS.find((step) => step.dx === dx && step.dy === dy);
      if (!push) return null;
      const behind = {
        x: Number(boulder.x) - push.dx,
        y: Number(boulder.y) - push.dy,
      };
      if (
        !passable(behind.x, behind.y) ||
        !passable(Number(next.x), Number(next.y))
      ) return null;
      const behindCell = cells.get(`${behind.x},${behind.y}`);
      const boulderCell = cells.get(`${boulder.x},${boulder.y}`);
      const destinationCell = cells.get(`${next.x},${next.y}`);
      if (
        !canCrossMetatileEdge(behindCell, boulderCell, push.direction) ||
        !canCrossMetatileEdge(boulderCell, destinationCell, push.direction)
      ) return null;
      const playerRoute = routePlayer(player, behind, boulder);
      if (!playerRoute) return null;
      return playerRoute.distance > 0
        ? { kind: "move", direction: playerRoute.first }
        : { kind: "push", direction: push.direction };
    }
  }
  const start = {
    player: { x: Number(player.x), y: Number(player.y) },
    boulder: { x: Number(boulder.x), y: Number(boulder.y) },
    first: null,
  };
  const queue = [start];
  const visited = new Set([
    `${start.player.x},${start.player.y}|${start.boulder.x},${start.boulder.y}`,
  ]);
  for (let cursor = 0; cursor < queue.length; cursor += 1) {
    const current = queue[cursor];
    if (
      current.boulder.x === Number(target.x) &&
      current.boulder.y === Number(target.y)
    ) return current.first;
    for (const step of DIRECTIONS) {
      const behind = {
        x: current.boulder.x - step.dx,
        y: current.boulder.y - step.dy,
      };
      const destination = {
        x: current.boulder.x + step.dx,
        y: current.boulder.y + step.dy,
      };
      if (!passable(behind.x, behind.y) || !passable(destination.x, destination.y)) {
        continue;
      }
      const behindCell = cells.get(`${behind.x},${behind.y}`);
      const boulderCell = cells.get(`${current.boulder.x},${current.boulder.y}`);
      const destinationCell = cells.get(`${destination.x},${destination.y}`);
      if (
        !canCrossMetatileEdge(behindCell, boulderCell, step.direction) ||
        !canCrossMetatileEdge(boulderCell, destinationCell, step.direction)
      ) continue;
      const playerRoute = routePlayer(current.player, behind, current.boulder);
      if (!playerRoute) continue;
      const first = current.first ?? (playerRoute.distance > 0
        ? { kind: "move", direction: playerRoute.first }
        : { kind: "push", direction: step.direction });
      const next = {
        player: { ...current.boulder },
        boulder: destination,
        first,
      };
      const key = `${next.player.x},${next.player.y}|${next.boulder.x},${next.boulder.y}`;
      if (visited.has(key)) continue;
      visited.add(key);
      queue.push(next);
    }
  }
  return null;
}

function boulderRecommendation({ map, observation, objective }) {
  const planned = boulderPlan({ map, observation, objective });
  if (!planned) return null;
  if (planned.kind === "move") {
    return {
      kind: "move-toward",
      direction: planned.direction,
      objective: objective.id,
      targetMap: objective.target.map,
      target: { ...objective.target },
    };
  }
  if (!watchedFlag(observation, 2053)) {
    return {
      kind: "use-field-move",
      direction: planned.direction,
      fieldMove: "strength",
      moveId: 70,
      objective: objective.id,
      targetMap: objective.target.map,
      obstacle: {
        kind: "object",
        index: objective.target.objectIndex,
      },
      remainingSteps: 0,
    };
  }
  return {
    kind: "push-field-obstacle",
    direction: planned.direction,
    fieldMove: "strength",
    moveId: 70,
    objective: objective.id,
    targetMap: objective.target.map,
    obstacle: {
      kind: "object",
      index: objective.target.objectIndex,
    },
    remainingSteps: 0,
  };
}

function connectionDirection(value) {
  return {
    up: "north",
    down: "south",
    left: "west",
    right: "east",
    north: "north",
    south: "south",
    west: "west",
    east: "east",
  }[value] ?? null;
}

function connectionTargets(map, direction) {
  const width = Number(map?.layout?.width);
  const height = Number(map?.layout?.height);
  const targets = new Set();
  for (const cell of map?.layout?.cells ?? []) {
    if (Number(cell.collision) !== 0) continue;
    const x = Number(cell.x);
    const y = Number(cell.y);
    if (
      (direction === "north" && y === 0) ||
      (direction === "south" && y === height - 1) ||
      (direction === "west" && x === 0) ||
      (direction === "east" && x === width - 1)
    ) {
      targets.add(`${x},${y}`);
    }
  }
  return targets;
}

function warpActivation(map, warp) {
  const warpX = Number(warp?.x);
  const warpY = Number(warp?.y);
  const behavior = warpBehavior(map, warp);
  if (behavior === "MB_WARP_DOOR") {
    return {
      x: warpX,
      y: warpY + 1,
      direction: "north",
      kind: "traverse-door-warp",
    };
  }
  const direction = WARP_DIRECTIONS[behavior];
  return {
    x: warpX,
    y: warpY,
    ...(direction ? { direction } : {}),
    kind: direction ? "traverse-directional-warp" : "traverse-map-warp",
  };
}

function automaticWarpReentryDirection(map, activation, blocked = new Set()) {
  const cells = new Map(
    (map?.layout?.cells ?? []).map((cell) => [`${cell.x},${cell.y}`, cell]),
  );
  return DIRECTIONS.find(({ direction, dx, dy }) => {
    const key = `${activation.x + dx},${activation.y + dy}`;
    const cell = cells.get(key);
    const source = cells.get(`${activation.x},${activation.y}`);
    return cell && Number(cell.collision) === 0 && !blocked.has(key) &&
      canCrossMetatileEdge(source, cell, direction);
  })?.direction ?? null;
}

function graphCellPassable(cell, { canSurf = false } = {}, blocked = new Set()) {
  if (
    !cell || Number(cell.collision) !== 0 ||
    blocked.has(`${Number(cell.x)},${Number(cell.y)}`)
  ) return false;
  if (!SURFABLE_BEHAVIORS.has(cell.behaviorName)) return true;
  return canSurf && !["MB_FAST_WATER", "MB_WATERFALL"].includes(
    cell.behaviorName,
  );
}

// IsNationalPokedexEnabled() (src/event_data.c) checks FLAG_SYS_NATIONAL_DEX,
// VAR_NATIONAL_DEX == 0x6258 and the SaveBlock2 magic, all set together.
const NATIONAL_DEX_FLAG_ID = 2112;
const NATIONAL_DEX_VARIABLE_ID = 0x404e;
function nationalDexEnabled(observation) {
  return watchedFlag(observation, NATIONAL_DEX_FLAG_ID) &&
    Number(observation?.playerMemory?.storyState?.variableIds?.[NATIONAL_DEX_VARIABLE_ID]) === 0x6258;
}
const NATIVE_LAYOUT_CELLS = new Map(NATIVE_LAYOUT_VARIANTS.map(({ map, layout }) => [map,
  Object.freeze(layout.cells.map(([metatileId, collision, elevation, behavior, terrain, encounterType, layerType], index) =>
    Object.freeze({
      x: index % layout.width,
      y: Math.floor(index / layout.width),
      metatileId,
      collision,
      elevation,
      tileset: metatileId < 640 ? layout.primaryTileset : layout.secondaryTileset,
      behavior,
      behaviorName: layout.behaviorNames[behavior] ?? null,
      terrain,
      encounterType,
      layerType,
    })))]));
// FLAG_POKEMON_MANSION_SWITCH_STATE (0x26C). Every Mansion floor's ON_LOAD
// runs `call_if_set FLAG_POKEMON_MANSION_SWITCH_STATE,
// PokemonMansion_EventScript_PressSwitch_<floor>`, whose setmetatile commands
// (data/scripts/pokemon_mansion.inc) move the barriers. The authored layouts
// are the switch-reset floors (the ResetSwitch scripts restore exactly them),
// so while the switch is set the offscreen graph must load these cells: 2F's
// x=12 barrier seals the pocket around the 3F stairs, and 3F/1F open the way
// from the holes to the east exit. Each entry is [x, y, impassable].
const POKEMON_MANSION_SWITCH_FLAG_ID = 620;
const POKEMON_MANSION_SWITCH_SET_CELLS = Object.freeze({
  // PokemonMansion_EventScript_PressSwitch_1F
  MAP_POKEMON_MANSION_1F: Object.freeze([
    [22, 10, 0], [23, 10, 0], [24, 10, 0], [22, 11, 0], [23, 11, 0], [24, 11, 0],
    [27, 25, 0], [28, 25, 0], [29, 25, 0], [27, 26, 0], [28, 26, 0], [29, 26, 0],
    [32, 25, 0], [33, 25, 0], [34, 25, 0], [32, 26, 0], [33, 26, 0], [34, 26, 0],
    [31, 18, 1], [32, 18, 1], [33, 18, 1], [31, 19, 1], [32, 19, 1], [33, 19, 1],
    [5, 4, 0],
  ]),
  // PokemonMansion_EventScript_PressSwitch_2F
  MAP_POKEMON_MANSION_2F: Object.freeze([
    [24, 14, 0], [25, 14, 0], [26, 14, 0], [24, 15, 0], [25, 15, 0], [26, 15, 0],
    [10, 28, 1], [10, 29, 1], [10, 30, 0], [10, 31, 0], [10, 32, 0],
    [12, 4, 1], [12, 5, 1], [12, 6, 1], [12, 7, 1], [12, 8, 1],
    [2, 15, 0],
  ]),
  // PokemonMansion_EventScript_PressSwitch_3F
  MAP_POKEMON_MANSION_3F: Object.freeze([
    [17, 11, 0], [18, 11, 0], [19, 11, 0], [17, 12, 0], [18, 12, 0], [19, 12, 0],
    [21, 4, 1], [21, 5, 1], [21, 6, 1], [21, 7, 1], [21, 8, 1],
    [12, 4, 0],
  ]),
  // PokemonMansion_EventScript_PressSwitch_B1F
  MAP_POKEMON_MANSION_B1F: Object.freeze([
    [33, 20, 1], [34, 20, 1], [35, 20, 1], [33, 21, 1], [34, 21, 1], [35, 21, 1],
    [16, 26, 1], [16, 27, 1], [16, 28, 1], [16, 29, 1], [16, 30, 1],
    [12, 8, 1], [12, 9, 1], [12, 10, 0], [12, 11, 0], [12, 12, 0],
    [20, 22, 0], [21, 22, 0], [22, 22, 0], [20, 23, 0], [21, 23, 0], [22, 23, 0],
    [24, 28, 0], [27, 4, 0],
  ]),
});
// setmetatile keeps each cell's elevation (MapGridSetMetatileIdAt) and writes
// the impassable bit, which the live grid reports as collision 3.
function mansionSwitchSetView(map, switchCells) {
  const impassable = new Map(switchCells.map(([x, y, value]) => [`${x},${y}`, value]));
  return {
    ...map,
    layout: {
      ...map.layout,
      cells: (map.layout?.cells ?? []).map((cell) => {
        const value = impassable.get(`${cell.x},${cell.y}`);
        return value === undefined ? cell : { ...cell, collision: value ? 3 : 0 };
      }),
    },
  };
}
// Native ON_TRANSITION scripts can install a whole layout (setmaplayoutindex).
// The knowledge pack keeps each map's authored layout, so the offscreen graph
// must use the layout the cartridge will load. Dunsparce Tunnel is dug out once
// the National Dex is enabled; it is the only way into Three Isle Port's grass.
// Apply a variant only to the exact authored layout it was derived against.
function nativeLayoutView(map, capabilities) {
  const switchCells = POKEMON_MANSION_SWITCH_SET_CELLS[map?.id];
  if (switchCells && capabilities.mansionSwitchSet) {
    return mansionSwitchSetView(map, switchCells);
  }
  const variant = NATIVE_LAYOUT_VARIANTS.find((entry) => entry.map === map?.id);
  if (
    !variant || variant.condition !== "national-dex" || !capabilities.nationalDexLayouts ||
    map.layout?.blockDataSha256 !== variant.baseBlockDataSha256 ||
    Number(map.layout?.width) !== variant.layout.width ||
    Number(map.layout?.height) !== variant.layout.height
  ) return map;
  return {
    ...map,
    layout: {
      ...map.layout,
      id: variant.layout.id,
      name: variant.layout.name,
      blockDataSha256: variant.layout.blockDataSha256,
      cells: NATIVE_LAYOUT_CELLS.get(map.id),
    },
  };
}

function worldNavigationCapabilities(observation) {
  return Object.freeze({
    currentlySurfing: observation?.playerMemory?.avatar?.surfing === true,
    currentElevation: observation?.playerMemory?.objectEvents?.find(event => event.player)?.elevation,
    canSurf: Boolean(observation?.playerMemory?.avatar?.surfing) ||
      (partyKnowsMove(observation, 57) && watchedFlag(observation, 2084)),
    canCut: partyKnowsMove(observation, 15) && watchedFlag(observation, 2081),
    canRockSmash: partyKnowsMove(observation, 249) && watchedFlag(observation, 2085),
    canStrength: partyKnowsMove(observation, 70) && watchedFlag(observation, 2083),
    canPassRoute12Snorlax: watchedFlag(observation, 84),
    canPassRoute16Snorlax: watchedFlag(observation, 128),
    canOpenSilphDoors: bagHasItem(observation, 355),
    nationalDexLayouts: nationalDexEnabled(observation),
    mansionSwitchSet: watchedFlag(observation, POKEMON_MANSION_SWITCH_FLAG_ID),
  });
}

function collisionComponents(map, capabilities) {
  const canPassSnorlax = {
    MAP_ROUTE12: capabilities.canPassRoute12Snorlax,
    MAP_ROUTE16: capabilities.canPassRoute16Snorlax,
  }[map?.id] ?? false;
  const blocked = new Set([
    ...(map?.objectEvents ?? []).flatMap((objectEvent) => {
      const passable = {
        OBJ_EVENT_GFX_CUT_TREE: capabilities.canCut,
        OBJ_EVENT_GFX_ROCK_SMASH_ROCK: capabilities.canRockSmash,
        // Strength boulders change position and may become permanently stranded.
        // Only an authored boulder route can model that state transition safely;
        // the static world graph must keep them as topology boundaries.
        OBJ_EVENT_GFX_PUSHABLE_BOULDER: false,
        OBJ_EVENT_GFX_SNORLAX: canPassSnorlax,
      }[objectEvent.graphics_id];
      return passable === false
        ? [`${Number(objectEvent.x)},${Number(objectEvent.y)}`]
        : [];
    }),
    ...(!capabilities.canOpenSilphDoors
      ? (map?.backgroundEvents ?? []).flatMap((event) =>
          /^SilphCo_\d+F_EventScript_Door\d+$/u.test(event?.script ?? "")
            ? [`${Number(event.x)},${Number(event.y)}`]
            : []
        )
      : []),
  ]);
  const cells = new Map(
    (map?.layout?.cells ?? []).map((cell) => [`${cell.x},${cell.y}`, cell]),
  );
  const byCoordinate = new Map();
  let count = 0;
  for (const [coordinate, cell] of cells) {
    if (
      !graphCellPassable(cell, capabilities, blocked) ||
      byCoordinate.has(coordinate)
    ) continue;
    const component = count;
    count += 1;
    const [startX, startY] = coordinate.split(",").map(Number);
    const queue = [{ x: startX, y: startY }];
    byCoordinate.set(coordinate, component);
    for (let cursor = 0; cursor < queue.length; cursor += 1) {
      const current = queue[cursor];
      const currentCell = cells.get(`${current.x},${current.y}`);
      for (const step of DIRECTIONS) {
        const x = current.x + step.dx;
        const y = current.y + step.dy;
        const key = `${x},${y}`;
        const adjacent = cells.get(key);
        if (
          byCoordinate.has(key) ||
          !graphCellPassable(adjacent, capabilities, blocked) ||
          !canCrossMetatileEdge(currentCell, adjacent, step.direction, capabilities)
        ) continue;
        byCoordinate.set(key, component);
        queue.push({ x, y });
      }
    }
  }
  return { byCoordinate, count };
}

function regionKey(mapId, component) {
  return `${mapId}\0${component}`;
}

function landingForWarp(map, warp) {
  if (!warp) return null;
  const activation = warpActivation(map, warp);
  const cells = new Map(
    (map?.layout?.cells ?? []).map((cell) => [`${cell.x},${cell.y}`, cell]),
  );
  const exact = cells.get(`${activation.x},${activation.y}`);
  if (!exact || Number(exact.collision) === 0) {
    return { x: activation.x, y: activation.y };
  }
  const centerX = (Number(map?.layout?.width) - 1) / 2;
  const centerY = (Number(map?.layout?.height) - 1) / 2;
  const interiorLanding = [...cells.values()].filter((cell) =>
    Number(cell.collision) === 0
  ).map((cell, order) => ({
    x: Number(cell.x),
    y: Number(cell.y),
    order,
  })).sort((left, right) =>
    Math.abs(left.x - activation.x) + Math.abs(left.y - activation.y) -
      (Math.abs(right.x - activation.x) + Math.abs(right.y - activation.y)) ||
    Math.abs(left.x - centerX) + Math.abs(left.y - centerY) -
      (Math.abs(right.x - centerX) + Math.abs(right.y - centerY)) ||
    left.order - right.order
  )[0];
  return interiorLanding
    ? { x: interiorLanding.x, y: interiorLanding.y }
    : { x: activation.x, y: activation.y };
}

function landingForConnection(sourceMap, destinationMap, connection, x, y) {
  const direction = connectionDirection(connection?.direction);
  const offset = Number(connection?.offset ?? 0);
  const width = Number(destinationMap?.layout?.width);
  const height = Number(destinationMap?.layout?.height);
  if (!direction || !Number.isSafeInteger(width) || !Number.isSafeInteger(height)) {
    return null;
  }
  const landing = {
    north: { x: x - offset, y: height - 1 },
    south: { x: x - offset, y: 0 },
    west: { x: width - 1, y: y - offset },
    east: { x: 0, y: y - offset },
  }[direction];
  if (
    !landing || landing.x < 0 || landing.y < 0 ||
    landing.x >= width || landing.y >= height
  ) return null;
  return landing;
}

function createWorldNavigationGraph(world, observation) {
  const data = worldData(world);
  const capabilities = worldNavigationCapabilities(observation);
  const capabilityKey = Object.entries(capabilities)
    .filter(([name]) => !['currentlySurfing', 'currentElevation'].includes(name))
    .map(([name, enabled]) => `${name}:${Number(enabled)}`)
    .join(";");
  const cached = data && typeof data === "object"
    ? WORLD_NAVIGATION_CACHE.get(data)?.get(capabilityKey)
    : null;
  if (cached) {
    return cached;
  }
  const maps = new Map((data.maps ?? []).map((map) => [map.id, nativeLayoutView(map, capabilities)]));
  const components = new Map(
    [...maps].map(([mapId, map]) => [
      mapId,
      collisionComponents(map, capabilities),
    ]),
  );
  const edges = new Map();
  const reverse = new Map();
  const addEdge = (edge) => {
    if (!edges.has(edge.from)) edges.set(edge.from, []);
    edges.get(edge.from).push(edge);
    if (!reverse.has(edge.to)) reverse.set(edge.to, []);
    reverse.get(edge.to).push(edge.from);
  };
  const componentAt = (mapId, coordinate) => components.get(mapId)?.byCoordinate.get(
    `${coordinate?.x},${coordinate?.y}`,
  );

  for (const [mapId, map] of maps) {
    const cells = new Map(
      (map.layout?.cells ?? []).map((cell) => [`${cell.x},${cell.y}`, cell]),
    );
    for (const cell of cells.values()) {
      if (Number(cell.collision) !== 0) continue;
      for (const step of DIRECTIONS) {
        const ledgeX = Number(cell.x) + step.dx;
        const ledgeY = Number(cell.y) + step.dy;
        const ledge = cells.get(`${ledgeX},${ledgeY}`);
        if (LEDGE_DIRECTIONS[ledge?.behaviorName] !== step.direction) continue;
        const landing = {
          x: Number(cell.x) + step.dx * 2,
          y: Number(cell.y) + step.dy * 2,
        };
        const sourceComponent = componentAt(mapId, cell);
        const destinationComponent = componentAt(mapId, landing);
        if (
          sourceComponent === undefined || destinationComponent === undefined ||
          sourceComponent === destinationComponent
        ) continue;
        addEdge({
          from: regionKey(mapId, sourceComponent),
          to: regionKey(mapId, destinationComponent),
          activation: {
            x: Number(cell.x),
            y: Number(cell.y),
            direction: step.direction,
            kind: "traverse-ledge",
          },
          transit: {
            kind: "ledge",
            destinationMap: mapId,
            x: ledgeX,
            y: ledgeY,
            direction: step.direction,
          },
        });
      }
    }
    for (const [index, warp] of (map.warpEvents ?? []).entries()) {
      if (!isActivatingWarp(map, warp)) continue;
      const activation = warpActivation(map, warp);
      const sourceComponent = componentAt(mapId, activation);
      const destinationMap = maps.get(warp.dest_map);
      const destinationWarpIndex = Number(warp.dest_warp_id);
      const destinationWarp = Number.isSafeInteger(destinationWarpIndex)
        ? destinationMap?.warpEvents?.[destinationWarpIndex]
        : null;
      const landing = landingForWarp(destinationMap, destinationWarp);
      const destinationComponent = componentAt(warp.dest_map, landing);
      if (sourceComponent === undefined || destinationComponent === undefined) continue;
      addEdge({
        from: regionKey(mapId, sourceComponent),
        to: regionKey(warp.dest_map, destinationComponent),
        activation,
        transit: {
          kind: "warp",
          destinationMap: warp.dest_map,
          x: Number(warp.x),
          y: Number(warp.y),
          index,
        },
      });
    }
    for (const [index, connection] of (map.connections ?? []).entries()) {
      const direction = connectionDirection(connection.direction);
      const destinationMap = maps.get(connection.map);
      if (!direction || !destinationMap) continue;
      for (const coordinate of connectionTargets(map, direction)) {
        const [x, y] = coordinate.split(",").map(Number);
        const landing = landingForConnection(map, destinationMap, connection, x, y);
        const sourceCell = cells.get(`${x},${y}`);
        const destinationCell = destinationMap.layout?.cells?.find((cell) =>
          Number(cell.x) === Number(landing?.x) &&
          Number(cell.y) === Number(landing?.y)
        );
        if (
          SURFABLE_BEHAVIORS.has(sourceCell?.behaviorName) !==
            SURFABLE_BEHAVIORS.has(destinationCell?.behaviorName)
        ) continue;
        const sourceComponent = componentAt(mapId, { x, y });
        const destinationComponent = componentAt(connection.map, landing);
        if (sourceComponent === undefined || destinationComponent === undefined) continue;
        addEdge({
          from: regionKey(mapId, sourceComponent),
          to: regionKey(connection.map, destinationComponent),
          activation: {
            x,
            y,
            direction,
            kind: "traverse-map-connection",
          },
          transit: {
            kind: "connection",
            destinationMap: connection.map,
            direction,
            index,
          },
        });
      }
    }
  }
  const graph = { maps, components, edges, reverse, componentAt, source: data };
  if (data && typeof data === "object") {
    const cache = WORLD_NAVIGATION_CACHE.get(data) ?? new Map();
    cache.set(capabilityKey, graph);
    WORLD_NAVIGATION_CACHE.set(data, cache);
  }
  return graph;
}

const MAP_CELL_INDEX_CACHE = new WeakMap();
function indexedMapCells(map) {
  const source = map?.layout?.cells;
  if (!Array.isArray(source)) return new Map();
  if (!MAP_CELL_INDEX_CACHE.has(source)) {
    MAP_CELL_INDEX_CACHE.set(source, new Map(source.map(cell => [`${cell.x},${cell.y}`, cell])));
  }
  return MAP_CELL_INDEX_CACHE.get(source);
}

function objectApproaches(map, object, observation = null, target = object) {
  if (!object) return [];
  const cells = indexedMapCells(map);
  const approaches = [];
  for (const step of DIRECTIONS) {
    const adjacent = {
      x: Number(object.x) - step.dx,
      y: Number(object.y) - step.dy,
    };
    const adjacentCell = cells.get(`${adjacent.x},${adjacent.y}`);
    const allowed = (point, cell) => {
      const here = observation?.playerMemory?.position;
      const elevation = here?.x === point.x && here?.y === point.y
        ? observation?.playerMemory?.objectEvents?.find(event => event.player)?.elevation ?? cell?.elevation
        : cell?.elevation;
      return interactionElevationsMatch(elevation, object.elevation) &&
        !interactionExcluded(observation, point.x, point.y, step.direction, target);
    };
    if (Number(adjacentCell?.collision) === 0 && allowed(adjacent, adjacentCell)) {
      approaches.push({ ...adjacent, direction: step.direction });
    }
    if (adjacentCell?.behaviorName === "MB_COUNTER") {
      const acrossCounter = {
        x: Number(object.x) - step.dx * 2,
        y: Number(object.y) - step.dy * 2,
      };
      const cell = cells.get(`${acrossCounter.x},${acrossCounter.y}`);
      if (Number(cell?.collision) === 0 && allowed(acrossCounter, cell)) {
        approaches.push({ ...acrossCounter, direction: step.direction });
      }
    }
  }
  return approaches;
}

const BACKGROUND_FACING_DIRECTIONS = Object.freeze({
  BG_EVENT_PLAYER_FACING_NORTH: "north",
  BG_EVENT_PLAYER_FACING_SOUTH: "south",
  BG_EVENT_PLAYER_FACING_EAST: "east",
  BG_EVENT_PLAYER_FACING_WEST: "west",
  1: "north",
  2: "south",
  3: "east",
  4: "west",
});

function backgroundApproaches(map, event, observation = null) {
  const requiredDirection = BACKGROUND_FACING_DIRECTIONS[
    event?.player_facing_dir ?? event?.playerFacingDir
  ];
  return objectApproaches(map, event, observation, { ...event, kind: 'background' }).filter(({ direction }) =>
    !requiredDirection || direction === requiredDirection
  );
}

function equivalentBackgroundEvents(map, index) {
  const events = map?.backgroundEvents ?? [];
  const source = events[index];
  if (!source) return [];
  const result = [{ index, event: source }];
  if (!source.script) return result;
  const included = new Set([index]);
  for (let cursor = 0; cursor < result.length; cursor += 1) {
    const current = result[cursor].event;
    for (const [candidateIndex, candidate] of events.entries()) {
      if (
        included.has(candidateIndex) ||
        candidate?.script !== source.script ||
        String(candidate?.type ?? "") !== String(source.type ?? "") ||
        String(candidate?.elevation ?? "") !== String(source.elevation ?? "")
      ) continue;
      const distance = Math.abs(Number(candidate.x) - Number(current.x)) +
        Math.abs(Number(candidate.y) - Number(current.y));
      if (distance !== 1) continue;
      included.add(candidateIndex);
      result.push({ index: candidateIndex, event: candidate });
    }
  }
  return result;
}

function equivalentTriggerEvents(map, target) {
  const events = map?.coordEvents ?? [];
  const source = events[target.index];
  if (!source) return [];
  // Some badge checks span land, blocked bank tiles, and water. Only opted-in
  // objectives may use another tile, and its script and condition must agree.
  if (target.equivalentTriggers !== true || !source.script || !source.var ||
      source.var_value === undefined) return [{ index: target.index, event: source }];
  return events.flatMap((event, index) =>
    event.script === source.script && event.var === source.var &&
      String(event.var_value) === String(source.var_value) &&
      String(event.type ?? "") === String(source.type ?? "")
      ? [{ index, event }]
      : []
  );
}

function surfEncounterCoordinates(map) {
  const cells = new Map(
    (map?.layout?.cells ?? []).map((cell) => [`${cell.x},${cell.y}`, cell]),
  );
  return [...cells.values()].filter((cell) =>
    Number(cell.collision) === 0 &&
    SURFABLE_BEHAVIORS.has(cell.behaviorName) &&
    DIRECTIONS.some(({ dx, dy }) => {
      const adjacent = cells.get(`${Number(cell.x) + dx},${Number(cell.y) + dy}`);
      return Number(adjacent?.collision) === 0 &&
        SURFABLE_BEHAVIORS.has(adjacent?.behaviorName);
    })
  ).map(({ x, y }) => ({ x: Number(x), y: Number(y) }));
}

function fishingApproaches(map) {
  const cells = new Map(
    (map?.layout?.cells ?? []).map((cell) => [`${cell.x},${cell.y}`, cell]),
  );
  return [...cells.values()].flatMap((cell) => {
    if (Number(cell.collision) !== 0) return [];
    return DIRECTIONS.flatMap(({ direction, dx, dy }) => {
      const adjacent = cells.get(`${Number(cell.x) + dx},${Number(cell.y) + dy}`);
      return Number(adjacent?.collision) === 0 &&
          SURFABLE_BEHAVIORS.has(adjacent?.behaviorName)
        ? [{ x: Number(cell.x), y: Number(cell.y), direction }]
        : [];
    });
  });
}

const ENCOUNTER_COORDINATES_CACHE = new WeakMap();
function targetCoordinates(map, target) {
  const cells = map?.layout?.cells;
  if (!Array.isArray(cells) || !["encounter-zone", "surf-encounter-zone", "fishing-zone"].includes(target?.kind)) {
    return computeTargetCoordinates(map, target);
  }
  // Knowledge cells are immutable; each atomic live grid (including opened
  // doors/collision changes) has a new cell array. Never cache by map ID alone.
  let kinds = ENCOUNTER_COORDINATES_CACHE.get(cells);
  if (!kinds) { kinds = new Map(); ENCOUNTER_COORDINATES_CACHE.set(cells, kinds); }
  if (!kinds.has(target.kind)) kinds.set(target.kind, Object.freeze(
    computeTargetCoordinates(map, target).map(coordinate => Object.freeze(coordinate)),
  ));
  return kinds.get(target.kind);
}

function computeTargetCoordinates(map, target) {
  if (target?.kind === "party-roster") {
    return (map?.layout?.cells ?? [])
      .filter(({ behaviorName }) => behaviorName === "MB_PC")
      .flatMap((cell) => objectApproaches(map, cell));
  }
  if ([
    "object",
    "in-game-trade",
    "mansion-secret-key",
    "purchase-items",
  ].includes(target?.kind)) {
    const index = target.kind === "purchase-items" ? target.objectIndex : target.index;
    const object = map?.objectEvents?.[index];
    return objectApproaches(map, object);
  }
  if (target?.kind === "warp") {
    const warp = map?.warpEvents?.[target.index];
    return warp ? [warpActivation(map, warp)] : [];
  }
  if (target?.kind === "trigger") {
    return equivalentTriggerEvents(map, target).map(({ event }) =>
      ({ x: Number(event.x), y: Number(event.y) })
    );
  }
  if (target?.kind === "background") {
    return equivalentBackgroundEvents(map, target.index).flatMap(({ event }) =>
      backgroundApproaches(map, event)
    );
  }
  if (target?.kind === "itemfinder") {
    return Number.isSafeInteger(Number(target.x)) &&
      Number.isSafeInteger(Number(target.y))
      ? [{ x: Number(target.x), y: Number(target.y) }]
      : [];
  }
  if (target?.kind === "variable-background") {
    const event = map?.backgroundEvents?.[target.fallbackIndex ?? 0];
    return backgroundApproaches(map, event);
  }
  if (target?.kind === "push-boulder") {
    const object = map?.objectEvents?.[target.objectIndex];
    return objectApproaches(map, object);
  }
  if (target?.kind === "encounter-zone") {
    const cells = new Map(
      (map?.layout?.cells ?? []).map((cell) => [`${cell.x},${cell.y}`, cell]),
    );
    return [...cells.values()].filter((cell) =>
      Number(cell.collision) === 0 &&
      Number(cell.encounterType) === 1 &&
      DIRECTIONS.some(({ dx, dy }) => {
        const adjacent = cells.get(`${Number(cell.x) + dx},${Number(cell.y) + dy}`);
        return Number(adjacent?.collision) === 0 && Number(adjacent?.encounterType) === 1;
      })
    ).map(({ x, y }) => ({ x: Number(x), y: Number(y) }));
  }
  if (target?.kind === "surf-encounter-zone") {
    return surfEncounterCoordinates(map);
  }
  if (target?.kind === "fishing-zone") {
    return fishingApproaches(map).map(({ x, y }) => ({ x, y }));
  }
  if (target?.kind === 'friendship-walk') {
    const excluded = new Set([...(map?.warpEvents ?? []), ...(map?.coordEvents ?? []), ...(map?.objectEvents ?? [])].map(e => `${e.x},${e.y}`));
    return (map?.layout?.cells ?? []).filter(c => Number(c.collision) === 0 && !(Number(c.encounterType) > 0) && c.behaviorName === 'MB_NORMAL' && !excluded.has(`${c.x},${c.y}`)).map(({x,y}) => ({x:Number(x),y:Number(y)}));
  }
  if ([
    "map-arrival",
    "vs-seeker-activation",
    "vs-seeker-recharge",
    "field-move-at",
    "walk-to",
  ].includes(target?.kind)) {
    return [{ x: Number(target.x), y: Number(target.y) }];
  }
  return [];
}

function firstReachableRegionTransition({
  graph,
  mapId,
  position,
  target,
  targetRegionOverride = null,
  blocked,
  interactive = new Map(),
  capabilities = {},
  currentMap = null,
  unavailableRegions = new Set(),
  excludedTransitions = [],
  localRouteCache = null,
}) {
  const unavailable = (key) => unavailableRegions.has(key) ||
    unavailableRegions.has(key.split("\0", 1)[0]);
  const sourceComponent = graph.componentAt(mapId, position);
  const targetMap = graph.maps.get(target?.map);
  const targetRegions = targetRegionOverride
    ? new Set([...targetRegionOverride].filter((key) => !unavailable(key)))
    : new Set(
        targetCoordinates(targetMap, target).flatMap((coordinate) => {
          const component = graph.componentAt(target.map, coordinate);
          return component === undefined ? [] : [regionKey(target.map, component)];
        }).filter((key) => !unavailable(key)),
      );
  const sourceRegion = sourceComponent === undefined
    ? null
    : regionKey(mapId, sourceComponent);
  if (mapId === target?.map && sourceRegion) {
    // The caller already failed to prove a cartridge-local route. Leaving and
    // re-entering that same collision region cannot turn the exit into progress.
    targetRegions.delete(sourceRegion);
  }
  if (targetRegions.size === 0) return null;

  const distances = new Map([...targetRegions].map((key) => [key, 0]));
  const queue = [...targetRegions];
  for (let cursor = 0; cursor < queue.length; cursor += 1) {
    const current = queue[cursor];
    const distance = distances.get(current);
    for (const predecessor of graph.reverse.get(current) ?? []) {
      if (
        distances.has(predecessor) ||
        unavailable(predecessor)
      ) continue;
      distances.set(predecessor, distance + 1);
      queue.push(predecessor);
    }
  }

  const map = currentMap ?? graph.maps.get(mapId);
  const sourceDistance = sourceComponent === undefined
    ? undefined
    : distances.get(sourceRegion);
  let detourDistances = null;
  const distanceWithoutReturningToSource = (destination) => {
    if (!sourceRegion) return undefined;
    if (!detourDistances) {
      detourDistances = new Map([...targetRegions].map((key) => [key, 0]));
      const detourQueue = [...targetRegions];
      for (let cursor = 0; cursor < detourQueue.length; cursor += 1) {
        const current = detourQueue[cursor];
        const distance = detourDistances.get(current);
        for (const predecessor of graph.reverse.get(current) ?? []) {
          if (
            predecessor === sourceRegion ||
            detourDistances.has(predecessor) ||
            unavailable(predecessor)
          ) continue;
          detourDistances.set(predecessor, distance + 1);
          detourQueue.push(predecessor);
        }
      }
    }
    return detourDistances.get(destination);
  };
  const mapRegionPrefix = `${mapId}\0`;
  const outgoing = [...graph.edges.entries()]
    .filter(([from]) => from.startsWith(mapRegionPrefix))
    .flatMap(([, regionEdges]) => regionEdges);
  const knownWarpIndexes = new Set(outgoing.flatMap(({ transit }) =>
    transit?.kind === "warp" ? [Number(transit.index)] : []
  ));
  const staticMap = graph.maps.get(mapId);
  for (const [index, warp] of (map?.warpEvents ?? []).entries()) {
    if (
      knownWarpIndexes.has(index) ||
      !isActivatingWarp(map, warp) && !isLiveOpenedWarp(staticMap, map, warp)
    ) continue;
    const destinationMap = graph.maps.get(warp.dest_map);
    const destinationWarpIndex = Number(warp.dest_warp_id);
    const destinationWarp = Number.isSafeInteger(destinationWarpIndex)
      ? destinationMap?.warpEvents?.[destinationWarpIndex]
      : null;
    const landing = landingForWarp(destinationMap, destinationWarp);
    const destinationComponent = graph.componentAt(warp.dest_map, landing);
    if (destinationComponent === undefined) continue;
    outgoing.push({
      from: null,
      to: regionKey(warp.dest_map, destinationComponent),
      activation: warpActivation(map, warp),
      transit: {
        kind: "warp",
        destinationMap: warp.dest_map,
        x: Number(warp.x),
        y: Number(warp.y),
        index,
      },
    });
  }
  const reachableEdges = [];
  for (const [order, edge] of outgoing.entries()) {
    if (unavailable(edge.to)) continue;
    if (excludedTransitions.some((entry) =>
      entry.map === mapId && entry.x === edge.activation.x && entry.y === edge.activation.y &&
      entry.direction === edge.activation.direction && entry.destinationMap === edge.transit.destinationMap
    )) continue;
    const regionDistance = distances.get(edge.to);
    if (regionDistance === undefined) continue;
    const monotonic = sourceDistance === undefined || regionDistance <= sourceDistance;
    const productiveDetourDistance = monotonic
      ? undefined
      : distanceWithoutReturningToSource(edge.to);
    if (!monotonic && productiveDetourDistance === undefined) continue;
    reachableEdges.push({
      edge,
      regionDistance: monotonic ? regionDistance : productiveDetourDistance,
      detour: !monotonic,
      order,
    });
  }
  const {
    blocked: transitBlocked,
    interactive: transitInteractive,
  } = routingWithoutStatefulBoulders(blocked, interactive);
  const localTargets = new Set(reachableEdges.map(({ edge }) =>
    `${edge.activation.x},${edge.activation.y}`
  ));
  const localKey = [...localTargets].sort().join(";");
  const routes = localRouteCache?.get(localKey) ?? localRoutes(
    map,
    position,
    localTargets,
    transitBlocked,
    transitInteractive,
    capabilities,
  );
  localRouteCache?.set(localKey, routes);
  const candidates = reachableEdges.flatMap((candidate) => {
    const coordinate = `${candidate.edge.activation.x},${candidate.edge.activation.y}`;
    const routed = routes.get(coordinate);
    return routed ? [{ ...candidate, routed }] : [];
  });
  candidates.sort((left, right) =>
    Number(left.detour) - Number(right.detour) ||
    left.regionDistance - right.regionDistance ||
    (left.routed.travelCost ?? left.routed.distance) -
      (right.routed.travelCost ?? right.routed.distance) ||
    DIRECTIONS.findIndex(({ direction }) => direction === left.routed.first) -
      DIRECTIONS.findIndex(({ direction }) => direction === right.routed.first) ||
    left.order - right.order
  );
  return candidates[0] ?? null;
}

function targetMapIngressRegions(graph, targetMapId) {
  const targetPrefix = `${targetMapId}\0`;
  const regions = new Set();
  for (const [source, edges] of graph.edges) {
    if (source.startsWith(targetPrefix)) continue;
    for (const edge of edges) {
      if (edge.to.startsWith(targetPrefix)) regions.add(edge.to);
    }
  }
  return regions;
}

function unavailableStoryRegions(graph, observation) {
  const unavailable = unavailableStoryMaps(observation);
  for (const [mapId, anchorMaps] of Object.entries(PARTIAL_MAP_ACCESS_ANCHORS)) {
    if (!unavailable.has(mapId)) continue;
    const prefix = `${mapId}\0`;
    const anchors = new Set(anchorMaps);
    const accessible = new Set();
    for (const [from, edges] of graph.edges) {
      if (
        from.startsWith(prefix) &&
        edges.some(({ transit }) => anchors.has(transit?.destinationMap))
      ) accessible.add(from);
      if (!anchors.has(from.split("\0", 1)[0])) continue;
      for (const edge of edges) {
        if (edge.to.startsWith(prefix)) accessible.add(edge.to);
      }
    }
    if (accessible.size === 0) continue;
    unavailable.delete(mapId);
    const componentCount = Number(graph.components.get(mapId)?.count ?? 0);
    for (let component = 0; component < componentCount; component += 1) {
      const key = regionKey(mapId, component);
      if (!accessible.has(key)) unavailable.add(key);
    }
  }
  return unavailable;
}

function createRouteMetricsQuery(graph, observation) {
  const mapId = observation?.playerMemory?.map?.id;
  const position = observation?.playerMemory?.position;
  const map = currentMapView(graph.maps.get(mapId), observation);
  if (!map || !position) return null;
  const { blocked, interactive } = routingState(map, observation);
  const capabilities = worldNavigationCapabilities(observation);
  return { mapId, position, map, blocked, interactive, capabilities,
    unavailableRegions: unavailableStoryRegions(graph, observation), localRouteCache: new Map() };
}

function routeMetrics({ graph, observation, target, query = createRouteMetricsQuery(graph, observation) }) {
  target = resolveTarget(target, observation);
  if (!query) return null;
  const { mapId, position, map, blocked, interactive, capabilities, unavailableRegions, localRouteCache } = query;
  if (mapId === target?.map) {
    const routed = localRoute(
      map,
      position,
      new Set(targetCoordinates(map, target).map(({ x, y }) => `${x},${y}`)),
      blocked,
      interactive,
      capabilities,
    );
    if (routed) {
      return {
        transitions: 0,
        localSteps: routed.travelCost ?? routed.distance,
      };
    }
    // Navigation can open cartridge-authored doors with the owned Card Key.
    // Recovery/training must use that same reachability contract: otherwise a
    // remote healer is selected, then rejected on its own floor, forever.
    const doorRoute = silphCoDoorRecommendation({
      world: graph.source, observation, objective: { id: "route-metrics", target },
      map, staticMap: graph.maps.get(mapId), blocked, interactive, capabilities,
    });
    if (doorRoute) return { transitions: 0, localSteps: (doorRoute.remainingSteps ?? 0) + 1 };
  }
  const planned = firstReachableRegionTransition({
    graph,
    mapId,
    position,
    target,
    blocked,
    interactive,
    capabilities,
    currentMap: map,
    unavailableRegions,
    localRouteCache,
    excludedTransitions: observation?.navigationExclusions?.transitions,
  });
  if (!planned && VICTORY_ROAD_MAPS.has(mapId)) {
    // A reset passage can disconnect the static graph while the navigator's
    // authored boulder/ladder route still provides an executable way out.
    // Funding, training and recovery must not discard that same route here.
    const routing = routingWithoutStatefulBoulders(blocked, interactive);
    const passage = victoryRoadTransitRecommendation({
      world: graph.source, observation, objective: { id: 'route-metrics', target },
      map, blocked: routing.blocked, interactive: routing.interactive,
      capabilities, graph,
    });
    if (passage) return {
      transitions: target.map === mapId ? 0 : 1,
      localSteps: (passage.remainingSteps ?? 0) + 1,
    };
  }
  return planned
    ? {
        transitions: planned.regionDistance + 1,
        localSteps: planned.routed.travelCost ?? planned.routed.distance,
      }
    : null;
}

function campaignRegionTransitionDistanceLookup({ graph, observation, target, exact = false }) {
  const resolvedTarget = resolveTarget(target, observation);
  const targetMap = graph.maps.get(resolvedTarget?.map);
  if (!targetMap) return () => null;
  const unavailableRegions = unavailableStoryRegions(graph, observation);
  const unavailable = (key) => unavailableRegions.has(key) ||
    unavailableRegions.has(key.split("\0", 1)[0]);
  const exactTargetRegions = new Set(
    targetCoordinates(targetMap, resolvedTarget).flatMap((coordinate) => {
      const component = graph.componentAt(resolvedTarget?.map, coordinate);
      return component === undefined
        ? []
        : [regionKey(resolvedTarget.map, component)];
    }).filter((key) => !unavailable(key)),
  );
  const ingressTargetRegions = new Set(
    [...targetMapIngressRegions(graph, resolvedTarget?.map)]
      .filter((key) => !unavailable(key)),
  );
  const reverseDistances = (targetRegions) => {
    const distances = new Map([...targetRegions].map((key) => [key, 0]));
    const queue = [...targetRegions];
    for (let cursor = 0; cursor < queue.length; cursor += 1) {
      const current = queue[cursor];
      const distance = distances.get(current);
      for (const predecessor of graph.reverse.get(current) ?? []) {
        if (distances.has(predecessor) || unavailable(predecessor)) continue;
        distances.set(predecessor, distance + 1);
        queue.push(predecessor);
      }
    }
    return distances;
  };
  const exactDistances = reverseDistances(exactTargetRegions);
  // Entering the map is not reaching its target cells: an encounter pocket can
  // be walled off from every entrance. Callers that must stand on the target
  // (a hunt selection) ask for the exact regions only.
  const ingressDistances = exact ? new Map() : reverseDistances(ingressTargetRegions);
  return ({ map, position }) => {
    const component = graph.componentAt(map, position);
    if (component === undefined) return null;
    const source = regionKey(map, component);
    const exact = exactDistances.get(source);
    if (Number.isSafeInteger(exact)) return exact;
    const ingress = ingressDistances.get(source);
    return Number.isSafeInteger(ingress) ? ingress : null;
  };
}

function targetTransitionDistance({ graph, target, distanceFrom }) {
  const map = graph.maps.get(target?.map);
  if (!map || typeof distanceFrom !== "function") return null;
  const distances = targetCoordinates(map, target)
    .map((position) => distanceFrom({ map: target.map, position }))
    .filter(Number.isSafeInteger);
  return distances.length > 0 ? Math.min(...distances) : null;
}

export function campaignRegionTransitionDistances({
  world,
  observation,
  target,
  origins = [],
} = {}) {
  const graph = createWorldNavigationGraph(world, observation);
  const distanceFrom = campaignRegionTransitionDistanceLookup({
    graph,
    observation,
    target,
  });
  return origins.map(distanceFrom);
}

function scriptedEntranceUnlocked(observation, entry) {
  return entry.flag !== undefined
    ? watchedFlag(observation, entry.flag)
    : Number(observation?.playerMemory?.storyState?.variableIds?.[entry.variable]) >= entry.atLeast;
}

// The static exterior keeps the closed door, so the interior graph starts at
// the entrance's authored landing. Entries without one keep flag-only staging,
// which proves the interior map but not an exact target inside it.
function scriptedEntranceLandingReaches({ graph, observation, entry, target, exact = false }) {
  if (!entry.ingress) return !exact;
  const map = graph.maps.get(entry.ingress.map);
  const landing = landingForWarp(map, map?.warpEvents?.[entry.ingress.warp]);
  if (!landing) return false;
  const distanceFrom = campaignRegionTransitionDistanceLookup({ graph, observation, target, exact });
  return Number.isSafeInteger(distanceFrom({ map: entry.ingress.map, position: landing }));
}

// Selector-side reachability for an objective target. `origins` are
// {map, position} starts (a missing position means any region of that map).
// Returns true or false for a target map with a known layout, and null when
// the world or the origins cannot answer (unknown maps stay allowed). Unlike
// campaignRegionTransitionDistances, an unlocked scripted entrance counts when
// its exterior is reachable and its landing reaches the target.
export function campaignTargetReachable({ world, observation, target, origins = [], exact = false } = {}) {
  const graph = createWorldNavigationGraph(world, observation);
  if (!graph.maps.get(target?.map)?.layout?.cells?.length) return null;
  const starts = origins.flatMap((origin) => {
    if (origin?.position) {
      return graph.componentAt(origin.map, origin.position) === undefined ? [] : [origin];
    }
    const byComponent = new Map();
    for (const [coordinate, component] of graph.components.get(origin?.map)?.byCoordinate ?? []) {
      if (!byComponent.has(component)) byComponent.set(component, coordinate);
    }
    return [...byComponent.values()].map((coordinate) => {
      const [x, y] = coordinate.split(",").map(Number);
      return { map: origin.map, position: { x, y } };
    });
  });
  if (starts.length === 0) return null;
  const distanceFrom = campaignRegionTransitionDistanceLookup({ graph, observation, target, exact });
  if (starts.some((start) => Number.isSafeInteger(distanceFrom(start)))) return true;
  const entrance = SCRIPTED_ENTRANCES.find((entry) =>
    target.map.startsWith(entry.interior) && scriptedEntranceUnlocked(observation, entry));
  if (!entrance || !scriptedEntranceLandingReaches({ graph, observation, entry: entrance, target, exact })) return false;
  const exteriorFrom = campaignRegionTransitionDistanceLookup({
    graph,
    observation,
    target: { kind: "map", map: entrance.exterior },
  });
  return starts.some((start) => start.map === entrance.exterior ||
    Number.isSafeInteger(exteriorFrom(start)));
}

export function campaignOutdoorStagingTarget({ world, observation, allowedMapTypes } = {}) {
  const graph = createWorldNavigationGraph(world, observation);
  const query = createRouteMetricsQuery(graph, observation);
  if (!query) return null;
  const candidates = [];
  // Use actual exit landings, including multi-floor buildings and caves.
  // A map name or region section alone does not prove a connected exit.
  for (const map of graph.maps.values()) {
    if (!allowedMapTypes?.has(map.properties?.map_type)) continue;
    for (const warp of map.warpEvents ?? []) {
      const interior = graph.maps.get(warp.dest_map);
      if (!interior || allowedMapTypes.has(interior.properties?.map_type)) continue;
      const landing = landingForWarp(map, warp);
      if (!landing) continue;
      const target = { kind: 'map-arrival', map: map.id, ...landing };
      const metrics = routeMetrics({ graph, observation, target, query });
      if (metrics) candidates.push({ target, ...metrics });
    }
  }
  candidates.sort((a, b) => a.transitions - b.transitions || a.localSteps - b.localSteps ||
    a.target.map.localeCompare(b.target.map));
  return candidates[0]?.target ?? null;
}

const SILPH_HEALER_SCENE_VARIABLE_ID = 0x4060;
const HEALER_COMPARISONS = Object.freeze({
  eq: (left, right) => left === right,
  ne: (left, right) => left !== right,
  lt: (left, right) => left < right,
  le: (left, right) => left <= right,
  gt: (left, right) => left > right,
  ge: (left, right) => left >= right,
});

function freeHealerScriptMetadata(story) {
  const data = storyData(story);
  if (data && typeof data === "object") {
    const cached = FREE_HEALER_SCRIPT_METADATA_CACHE.get(data);
    if (cached) return cached;
  }
  const scripts = new Map(
    (data.scripts ?? []).map((script) => [script.label, script]),
  );
  const resolved = new Map();
  const resolve = (label, visiting = new Set()) => {
    if (resolved.has(label)) return resolved.get(label);
    if (visiting.has(label)) {
      return Object.freeze({
        directlyHealsParty: false,
        outOfCenterRoutes: Object.freeze([]),
      });
    }
    const script = scripts.get(label);
    if (!script) return null;
    const instructions = script?.instructions ?? [];
    const directlyHealsParty = instructions.some(({ op, args }) =>
      op === "special" && args?.[0] === "HealPlayerParty"
    );
    const oneTimeGuardFlags = new Set(instructions.flatMap(({ op, args }) =>
      op === "goto_if_set" && typeof args?.[0] === "string" ? [args[0]] : []
    ));
    const oneTime = instructions.some(({ op, args }) =>
      op === "setflag" && oneTimeGuardFlags.has(args?.[0])
    );
    const asksPermission = instructions.some(({ op, args }) =>
      op === "msgbox" && args?.includes("MSGBOX_YESNO")
    );
    const routes = [];
    const nextVisiting = new Set(visiting).add(label);
    let fallthroughRequirements = [];
    for (const { op, args = [] } of instructions) {
      if (["end", "return"].includes(op)) break;
      if (op === "call" && args[0] === "EventScript_OutOfCenterPartyHeal" ||
          op === "special" && args[0] === "HealPlayerParty") {
        routes.push({ requirements: [...fallthroughRequirements], oneTime, asksPermission,
          direct: op === "special" });
        continue;
      }
      let target = null;
      let requirement = null;
      if (["call", "goto"].includes(op)) {
        target = args[0];
      } else if (/^(?:call|goto)_if_(?:set|unset)$/u.test(op)) {
        target = args.at(-1);
        requirement = { flag: args[0], set: op.endsWith("_set") };
      } else {
        const comparison = /^(?:call|goto)_if_(eq|ne|lt|le|gt|ge)$/u.exec(op)?.[1];
        const variableId = symbolValue(data.symbols, "variables", args[0]);
        // VAR_RESULT is a transient menu response, not persistent story state.
        // The existing YES choice owns that prompt; only saved variables gate availability.
        if (comparison && (variableId >= 0x4000 && variableId < 0x8000 ||
            /^VAR_(?!RESULT$)/u.test(args[0] ?? ""))) {
          target = args.at(-1);
          requirement = { variable: args[0], comparison, value: Number(args[1]), matches: true };
        }
      }
      const child = scripts.has(target) ? resolve(target, nextVisiting) : null;
      for (const route of child?.outOfCenterRoutes ?? []) {
        const requirements = [...fallthroughRequirements, ...route.requirements,
          ...(requirement ? [requirement] : [])];
        const contradictory = requirements.some((candidate) => candidate.flag &&
          requirements.some((other) => other.flag === candidate.flag && other.set !== candidate.set));
        if (contradictory) continue;
        routes.push({ requirements, oneTime: oneTime || route.oneTime, direct: route.direct,
          asksPermission: asksPermission || route.asksPermission });
      }
      if (op === "goto") break;
      if (op.startsWith("goto_if_") && requirement) {
        // The following instructions run only when this earlier jump was NOT taken.
        fallthroughRequirements = [...fallthroughRequirements, requirement.flag
          ? { ...requirement, set: !requirement.set }
          : { ...requirement, matches: !requirement.matches }];
      }
    }
    const uniqueRoutes = [...new Map(routes.map((route) => [
      JSON.stringify(route),
      Object.freeze({
        ...route,
        requirements: Object.freeze(route.requirements),
      }),
    ])).values()];
    const metadata = Object.freeze({
      directlyHealsParty,
      outOfCenterRoutes: Object.freeze(uniqueRoutes),
    });
    resolved.set(label, metadata);
    return metadata;
  };
  for (const label of scripts.keys()) resolve(label);
  if (data && typeof data === "object") {
    FREE_HEALER_SCRIPT_METADATA_CACHE.set(data, resolved);
  }
  return resolved;
}

function observedScriptFlag(story, observation, flag) {
  const named = observation?.playerMemory?.storyState?.flags?.[flag];
  if (typeof named === "boolean") return named;
  const id = symbolValue(storyData(story).symbols, "flags", flag);
  const numeric = observation?.playerMemory?.storyState?.flagIds?.[id];
  return typeof numeric === "boolean" ? numeric : null;
}

function observedHealerRequirement(story, observation, requirement) {
  if (requirement.flag) {
    return observedScriptFlag(story, observation, requirement.flag) === requirement.set;
  }
  const state = observation?.playerMemory?.storyState;
  const id = requirement.variableId ??
    symbolValue(storyData(story).symbols, "variables", requirement.variable);
  const value = state?.variableIds?.[id] ?? state?.variables?.[requirement.variable];
  return Number.isSafeInteger(value) && value >= 0 &&
    Number.isSafeInteger(requirement.value) &&
    HEALER_COMPARISONS[requirement.comparison]?.(value, requirement.value) === requirement.matches;
}

function reusableOutOfCenterHealer(
  script,
  scriptMetadata,
  story,
  observation,
  allowDirectHealing = false,
) {
  return scriptMetadata.get(script)?.outOfCenterRoutes.find((route) =>
    !route.oneTime && (allowDirectHealing || !route.direct) && route.requirements.every((requirement) =>
      observedHealerRequirement(story, observation, requirement)
    )
  ) ?? null;
}

function freeHealerObjectMetadata({
  map,
  object,
  scriptMetadata,
  story,
  observation,
}) {
  const script = object?.script ?? "";
  if (
    map?.id?.endsWith("_POKEMON_CENTER_1F") &&
    /EventScript_Nurse$/.test(script)
  ) {
    return Object.freeze({ asksPermission: false });
  }
  const route = reusableOutOfCenterHealer(
    script,
    scriptMetadata,
    story,
    observation,
  );
  if (route) return route;
  // A source-derived rejection is authoritative; the source-free cartridge
  // fallback must carry the same pre-liberation condition, including unknown state.
  if (!scriptMetadata.has(script) && script === "SilphCo_9F_EventScript_HealWoman" &&
      observedHealerRequirement(story, observation, {
        variableId: SILPH_HEALER_SCENE_VARIABLE_ID,
        variable: "VAR_MAP_SCENE_SILPH_CO_11F", comparison: "lt", value: 1, matches: true,
      })) return Object.freeze({ asksPermission: false });
  return null;
}

function freeHealerRequirementIds(story, group) {
  const data = storyData(story);
  const metadata = freeHealerScriptMetadata(story);
  return [...new Set([...metadata.values()].flatMap(({ outOfCenterRoutes }) =>
    outOfCenterRoutes.flatMap(({ requirements }) =>
      requirements.flatMap((requirement) => {
        const name = group === "flags" ? requirement.flag : requirement.variable;
        const id = symbolValue(data.symbols, group, name);
        return id === null ? [] : [id];
      })
    )
  ))].sort((left, right) => left - right);
}

function freeHealerCatalog({ graph, story, observation }) {
  const scriptMetadata = freeHealerScriptMetadata(story);
  const targets = [];
  for (const map of graph.maps.values()) {
    for (const [index, object] of (map.objectEvents ?? []).entries()) {
      const metadata = freeHealerObjectMetadata({
        map,
        object,
        scriptMetadata,
        story,
        observation,
      });
      if (!metadata) continue;
      targets.push(Object.freeze({
        target: Object.freeze({ kind: "object", map: map.id, index }),
        ...(metadata?.asksPermission ? { choice: "yes" } : {}),
      }));
    }
    for (const [index, event] of (map.coordEvents ?? []).entries()) {
      const metadata = scriptMetadata.get(event?.script);
      if (metadata?.directlyHealsParty !== true ||
          !reusableOutOfCenterHealer(event.script, scriptMetadata, story, observation, true)) continue;
      targets.push(Object.freeze({
        target: Object.freeze({ kind: "trigger", map: map.id, index }),
      }));
    }
  }
  return Object.freeze(targets);
}

function freeHealerTransitionDistanceLookup({ graph, observation, story = null }) {
  const unavailableRegions = unavailableStoryRegions(graph, observation);
  const unavailable = (key) => unavailableRegions.has(key) ||
    unavailableRegions.has(key.split("\0", 1)[0]);
  const healerRegions = new Set();
  for (const { target } of freeHealerCatalog({ graph, story, observation })) {
    const map = graph.maps.get(target.map);
    for (const coordinate of targetCoordinates(map, target)) {
      const component = graph.componentAt(map.id, coordinate);
      if (component === undefined) continue;
      const key = regionKey(map.id, component);
      if (!unavailable(key)) healerRegions.add(key);
    }
  }
  const distances = new Map([...healerRegions].map((key) => [key, 0]));
  const queue = [...healerRegions];
  for (let cursor = 0; cursor < queue.length; cursor += 1) {
    const current = queue[cursor];
    const distance = distances.get(current);
    for (const predecessor of graph.reverse.get(current) ?? []) {
      if (distances.has(predecessor) || unavailable(predecessor)) continue;
      distances.set(predecessor, distance + 1);
      queue.push(predecessor);
    }
  }
  return (target) => {
    const map = graph.maps.get(target?.map);
    if (!map) return Number.POSITIVE_INFINITY;
    const reachable = targetCoordinates(map, target).flatMap((coordinate) => {
      const component = graph.componentAt(map.id, coordinate);
      if (component === undefined) return [];
      const distance = distances.get(regionKey(map.id, component));
      return Number.isSafeInteger(distance) ? [distance] : [];
    });
    return reachable.length > 0
      ? Math.min(...reachable)
      : Number.POSITIVE_INFINITY;
  };
}

export function selectRecoveryObjective({ world, story = null, observation, excludedTargets = [] } = {}) {
  const graph = createWorldNavigationGraph(world, observation);
  const candidates = [];
  const excluded = (target) => excludedTargets.some((entry) =>
    entry.kind === target.kind && entry.map === target.map && entry.index === target.index);
  for (const healer of freeHealerCatalog({ graph, story, observation })) {
    if (excluded(healer.target)) continue;
    const objective = {
      id: "recover-party",
      target: healer.target,
      ...(healer.choice ? { choice: healer.choice } : {}),
    };
    const metrics = routeMetrics({
      graph,
      observation,
      target: objective.target,
    });
    if (metrics) candidates.push({ objective, metrics });
  }
  candidates.sort((left, right) =>
    left.metrics.transitions - right.metrics.transitions ||
    left.metrics.localSteps - right.metrics.localSteps ||
    left.objective.target.map.localeCompare(right.objective.target.map)
  );
  if (candidates[0]) return candidates[0].objective;
  if (!VICTORY_ROAD_SHUTTLE_MAPS.has(observation?.playerMemory?.map?.id)) {
    return null;
  }
  const indigoCenter = graph.maps.get("MAP_INDIGO_PLATEAU_POKEMON_CENTER_1F");
  const nurseIndex = (indigoCenter?.objectEvents ?? []).findIndex((object) =>
    /EventScript_Nurse$/.test(object?.script ?? "")
  );
  return nurseIndex >= 0 && !excluded({ kind: "object", map: indigoCenter.id, index: nurseIndex })
    ? {
        id: "recover-party",
        target: { kind: "object", map: indigoCenter.id, index: nurseIndex },
      }
    : null;
}

function trainingCatalog(world, mechanics = null) {
  const data = worldData(world);
  const mechanicsDocument = mechanics?.data ?? mechanics ?? null;
  const mechanicsKey = mechanicsDocument && typeof mechanicsDocument === "object"
    ? mechanicsDocument
    : null;
  const cachedCatalogs = data && typeof data === "object"
    ? TRAINING_CATALOG_CACHE.get(data)
    : null;
  if (cachedCatalogs?.has(mechanicsKey)) {
    return cachedCatalogs.get(mechanicsKey);
  }
  const speciesEntries = Array.isArray(mechanicsDocument?.species)
    ? mechanicsDocument.species.map((entry) => [entry?.name, entry])
    : Object.entries(mechanicsDocument?.species ?? {}).map(([name, entry]) => [
        entry?.name ?? name,
        entry,
      ]);
  const experienceYieldBySpecies = new Map(
    speciesEntries.flatMap(([name, entry]) => {
      const experienceYield = Number(entry?.expYield);
      return typeof name === "string" &&
          Number.isFinite(experienceYield) &&
          experienceYield > 0
        ? [[name, experienceYield]]
        : [];
    }),
  );
  const maps = new Map((data.maps ?? []).map((map) => [map.id, map]));
  const catalog = (data.wildEncounters ?? []).flatMap((encounter) => {
    const map = maps.get(encounter.map);
    const mons = encounter.land_mons?.mons ?? [];
    if (!map || mons.length === 0 || targetCoordinates(map, {
      kind: "encounter-zone",
    }).length === 0) return [];
    const slotShares = mons.map((_, index) =>
      Number(LAND_ENCOUNTER_SLOT_SHARES[index] ?? 0)
    );
    const totalSlotShare = slotShares.reduce((total, share) => total + share, 0);
    const averageLevels = mons.map(({ min_level: minimum, max_level: maximum }) =>
      (Number(minimum) + Number(maximum)) / 2
    );
    const expectedWildLevel = totalSlotShare > 0
      ? averageLevels.reduce(
          (total, level, index) => total + level * slotShares[index],
          0,
        ) / totalSlotShare
      : null;
    const completeExperienceTable = mons.every(({ species }) =>
      experienceYieldBySpecies.has(String(species))
    );
    const expectedExperienceYield = completeExperienceTable && totalSlotShare > 0
      ? mons.reduce((total, { species }, index) =>
          total +
            averageLevels[index] *
            experienceYieldBySpecies.get(String(species)) *
            slotShares[index],
        0) / totalSlotShare
      : null;
    const rate = Number(encounter.land_mons.encounter_rate ?? 0);
    return [{
      map: encounter.map,
      mons: mons.map((mon,index)=>({...mon,weight:slotShares[index]/totalSlotShare})),
      rate,
      minimumWildLevel: Math.min(...mons.map(({ min_level: level }) => Number(level))),
      maximumWildLevel: Math.max(...mons.map(({ max_level: level }) => Number(level))),
      expectedWildLevel,
      expectedExperienceYield,
      experienceThroughput: expectedExperienceYield === null
        ? null
        : expectedExperienceYield * rate,
      switchEscapeHazard: mons.some(({ species }) =>
        POTENTIAL_WILD_SWITCH_TRAPPERS.has(String(species))
      ),
      trainerHazards: (map.objectEvents ?? []).filter(
        ({ trainer_type: trainerType }) =>
          trainerType && trainerType !== "TRAINER_TYPE_NONE",
      ).length,
    }];
  });
  if (data && typeof data === "object") {
    const catalogs = cachedCatalogs ?? new Map();
    catalogs.set(mechanicsKey, catalog);
    TRAINING_CATALOG_CACHE.set(data, catalogs);
  }
  return catalog;
}

function compareExpectedTrainingExperience(left, right) {
  const leftThroughput = left.encounter.experienceThroughput;
  const rightThroughput = right.encounter.experienceThroughput;
  const leftHasExperience = Number.isFinite(leftThroughput);
  const rightHasExperience = Number.isFinite(rightThroughput);
  if (leftHasExperience !== rightHasExperience) return rightHasExperience ? 1 : -1;
  if (!leftHasExperience) return 0;
  return rightThroughput - leftThroughput ||
    right.encounter.expectedExperienceYield -
      left.encounter.expectedExperienceYield ||
    right.encounter.expectedWildLevel - left.encounter.expectedWildLevel;
}

// A family is an OR requirement; one owned Pokemon may satisfy several roles.
// Search coverage signatures (not all combinations of a potentially full PC),
// bounded by the six party slots. A chosen signature cannot be selected twice:
// each recursive step must cover the first still-missing role.
function rosterRequirementsFit(owned, families, maximumPartySize, maximumUtility, teamPlan, requiredMoveIds) {
  const roles = [
    ...families.map(family => pokemon => family.includes(Number(pokemon.species))),
    ...requiredMoveIds.map(moveId => pokemon => (pokemon.moves ?? []).some(move => Number(move) === moveId)),
  ];
  const full = (1n << BigInt(roles.length)) - 1n;
  const signatures = new Map();
  for (const pokemon of owned) {
    const mask = roles.reduce((bits, matches, index) =>
      matches(pokemon) ? bits | (1n << BigInt(index)) : bits, 0n);
    if (mask === 0n) continue;
    const utility = Number(isHmUtilityCarrier(pokemon, teamPlan));
    signatures.set(`${mask}:${utility}`, { mask, utility });
  }
  const candidates = [...signatures.values()];
  const failed = new Set();
  function fits(covered, used, utilities) {
    if (covered === full) return true;
    if (used >= maximumPartySize) return false;
    const key = `${covered}:${used}:${utilities}`;
    if (failed.has(key)) return false;
    const missing = full & ~covered;
    const first = missing & -missing;
    for (const candidate of candidates) {
      if ((candidate.mask & first) === 0n || utilities + candidate.utility > maximumUtility) continue;
      if (fits(covered | candidate.mask, used + 1, utilities + candidate.utility)) return true;
    }
    failed.add(key);
    return false;
  }
  return fits(0n, 0, 0);
}

export function selectBattleRosterObjective({
  world,
  observation,
  objective,
  teamPlan,
} = {}) {
  const forObjective = objective?.rosterPreparationFor ?? objective?.id;
  const minimumBattlePartySize = teamPlan?.schema ===
      "master-red/permanent-team-plan/v1"
    ? Number(
        objective?.minimumBattlePartySize ??
        objective?.minimumReadyBattleMembers ??
        objective?.enemyPartySize ??
        0,
      )
    : Number(
        objective?.minimumReadyBattleMembers ??
        objective?.enemyPartySize ??
        objective?.minimumBattlePartySize ??
        0,
      );
  if (!objective?.importantBattle || minimumBattlePartySize <= 0) return null;
  if (
    observation?.playerMemory?.storyState?.flagIds?.[
      PC_STORAGE_DISABLED_FLAG_ID
    ] === true
  ) return null;
  const trainer = observation?.playerMemory?.trainer ?? {};
  const party = (trainer.party ?? []).filter(({ species }) => Number(species) > 0);
  const stored = (trainer.storage?.pokemon ?? []).filter(
    ({ species }) => Number(species) > 0,
  );
  const owned = [...party, ...stored];
  const nonUtilityOwned = owned.filter((pokemon) =>
    !isHmUtilityCarrier(pokemon, teamPlan)
  );
  const nonUtilityParty = party.filter((pokemon) =>
    !isHmUtilityCarrier(pokemon, teamPlan)
  );
  const utilityOwned = owned.filter((pokemon) =>
    isHmUtilityCarrier(pokemon, teamPlan)
  );
  const knowsMove = (pokemon, moveId) => (pokemon?.moves ?? []).some(
    (knownMoveId) => Number(knownMoveId) === Number(moveId)
  );
  const requiredApproachFamilies = [];
  const requiredMoveIds = [];
  let approachNeedsUtility = false;
  for (const moveId of objective.requiredApproachMoveIds ?? []) {
    const combatCandidates = nonUtilityOwned.filter((pokemon) =>
      knowsMove(pokemon, moveId)
    );
    const utilityCandidates = utilityOwned.filter((pokemon) =>
      knowsMove(pokemon, moveId)
    );
    const candidates = combatCandidates.length > 0
      ? combatCandidates
      : utilityCandidates;
    if (candidates.length === 0) continue;
    requiredMoveIds.push(Number(moveId));
    requiredApproachFamilies.push([
      ...new Set(candidates.map(({ species }) => Number(species))),
    ]);
    if (combatCandidates.length === 0) approachNeedsUtility = true;
  }
  const establishedOriginsFamilies = [
    teamPlan?.starterFamily,
    ...(teamPlan?.acquisitions ?? []).map(({ family }) => family),
  ].filter(Array.isArray);
  const fullOriginsBattleRosterAvailable =
    establishedOriginsFamilies.length >= 6 &&
    establishedOriginsFamilies.every((family) => nonUtilityOwned.some(
      ({ species }) => family.includes(Number(species))
    ));
  let utilitySupportSlots = utilityOwned.length > 0 && (
    !fullOriginsBattleRosterAvailable || approachNeedsUtility
  ) ? 1 : 0;
  const starterFamily = teamPlan?.starterFamily;
  const requiredStarterFamilies = starterFamily?.length && owned.some(
    ({ species }) => starterFamily.includes(Number(species))
  ) ? [[...starterFamily]] : [];
  const utilitySupportFamilies = utilitySupportSlots > 0 && !approachNeedsUtility
    ? (teamPlan?.utilityAcquisitions ?? [])
        .map(({ family }) => [...new Set((family ?? []).map(Number))])
        .filter((family) => utilityOwned.some(({ species }) => family.includes(Number(species))))
        .slice(0, 1)
    : [];
  const mandatoryFamilies = [...requiredStarterFamilies, ...requiredApproachFamilies, ...utilitySupportFamilies];
  const blockedRoster = () => ({
    id: `prepare-${forObjective}-roster`,
    target: { kind: "roster-preparation-blocked", map: observation?.playerMemory?.map?.id },
    blockedReason: "required-roster-exceeds-party-capacity",
    currentBattlePartySize: nonUtilityParty.length,
    minimumBattlePartySize,
    forObjective,
  });
  const requirementsFit = (families, size, utilities) =>
    rosterRequirementsFit(owned, families, size, utilities, teamPlan, requiredMoveIds);
  if (!requirementsFit(mandatoryFamilies, 6, 6)) return blockedRoster();
  while (!requirementsFit(mandatoryFamilies, 6, utilitySupportSlots)) {
    utilitySupportSlots += 1;
  }
  const desiredCombatPartySize = fullOriginsBattleRosterAvailable &&
      !approachNeedsUtility
    ? Math.min(6, establishedOriginsFamilies.length)
    : minimumBattlePartySize;
  let minimumCombatPartySize = Math.min(
    desiredCombatPartySize,
    6 - utilitySupportSlots,
  );
  let desiredPartySize = minimumCombatPartySize + utilitySupportSlots;
  while (!requirementsFit(mandatoryFamilies, desiredPartySize, utilitySupportSlots)) {
    desiredPartySize += 1;
  }
  minimumCombatPartySize = desiredPartySize - utilitySupportSlots;
  if (nonUtilityOwned.length < minimumCombatPartySize) {
    const graph = createWorldNavigationGraph(world, observation);
    const highestPartyLevel = Math.max(
      1,
      ...party.map(({ level }) => Number(level ?? 1)),
    );
    const candidates = trainingCatalog(world).flatMap((encounter) => {
      if (encounter.maximumWildLevel > Math.max(5, highestPartyLevel + 2)) return [];
      const target = { kind: "encounter-zone", map: encounter.map };
      const metrics = routeMetrics({ graph, observation, target });
      return metrics ? [{ encounter, metrics, target }] : [];
    });
    candidates.sort((left, right) =>
      left.metrics.transitions - right.metrics.transitions ||
      left.encounter.trainerHazards - right.encounter.trainerHazards ||
      left.metrics.localSteps - right.metrics.localSteps ||
      right.encounter.maximumWildLevel - left.encounter.maximumWildLevel ||
      left.encounter.map.localeCompare(right.encounter.map)
    );
    const selected = candidates[0];
    if (!selected) {
      return {
        id: `build-${forObjective}-roster`,
        target: {
          kind: "roster-preparation-blocked",
          map: observation?.playerMemory?.map?.id,
        },
        blockedReason: "no-reachable-roster-capture",
        currentBattlePartySize: nonUtilityParty.length,
        minimumBattlePartySize,
        forObjective,
      };
    }
    return {
      id: `build-${forObjective}-roster`,
      target: selected.target,
      captureAnyNewSpecies: true,
      currentBattlePartySize: nonUtilityParty.length,
      minimumBattlePartySize,
      forObjective,
      encounter: {
        rate: selected.encounter.rate,
        minimumWildLevel: selected.encounter.minimumWildLevel,
        maximumWildLevel: selected.encounter.maximumWildLevel,
      },
    };
  }
  const graph = createWorldNavigationGraph(world, observation);
  const preferredBattleFamilies = [];
  const authoredPreferredFamilies = objective.preferredFamilies ?? [];
  const preferredFamilyPlan = authoredPreferredFamilies.length > 0
    ? authoredPreferredFamilies
    : establishedOriginsFamilies;
  for (const family of preferredFamilyPlan) {
    if (preferredBattleFamilies.length >= minimumCombatPartySize) break;
    const normalizedFamily = [...new Set((family ?? []).map(Number))];
    if (
      normalizedFamily.length > 0 &&
      nonUtilityOwned.some(({ species }) =>
        normalizedFamily.includes(Number(species))
      )
    ) {
      const proposed = [...preferredBattleFamilies, normalizedFamily, ...mandatoryFamilies];
      if (requirementsFit(proposed, desiredPartySize, utilitySupportSlots)) {
        preferredBattleFamilies.push(normalizedFamily);
      }
    }
  }
  const requiredFamilies = [
    ...preferredBattleFamilies,
    ...mandatoryFamilies,
  ]
    .filter((family, index, families) =>
      families.findIndex((candidate) =>
        candidate.length === family.length &&
        candidate.every((species, memberIndex) => species === family[memberIndex])
      ) === index
    );
  const excludeUtilityCarriers = utilitySupportSlots === 0;
  const requiredFamilyPresent = (family) => party.some(({ species }) =>
    family.includes(Number(species))
  );
  const rosterReady =
    nonUtilityParty.length >= minimumCombatPartySize &&
    party.length === desiredPartySize &&
    requiredFamilies.every(requiredFamilyPresent) &&
    requiredMoveIds.every(moveId => party.some(pokemon => knowsMove(pokemon, moveId))) &&
    (!excludeUtilityCarriers || party.length === nonUtilityParty.length);
  if (rosterReady) return null;

  const candidates = [...graph.maps.values()].flatMap((map) => {
    if (!map.id.endsWith("_POKEMON_CENTER_1F")) return [];
    const target = { kind: "party-roster", map: map.id };
    if (targetCoordinates(map, target).length === 0) return [];
    const metrics = routeMetrics({ graph, observation, target });
    return metrics ? [{ map: map.id, metrics }] : [];
  });
  candidates.sort((left, right) =>
    left.metrics.transitions - right.metrics.transitions ||
    left.metrics.localSteps - right.metrics.localSteps ||
    left.map.localeCompare(right.map)
  );
  const selected = candidates[0];
  if (!selected) {
    return {
      id: `prepare-${forObjective}-roster`,
      target: {
        kind: "roster-preparation-blocked",
        map: observation?.playerMemory?.map?.id,
      },
      blockedReason: "no-reachable-pokemon-center",
      currentBattlePartySize: nonUtilityParty.length,
      minimumBattlePartySize,
      minimumCombatPartySize,
      desiredBattlePartySize: minimumCombatPartySize,
      forObjective,
    };
  }
  const excludedFamilies = (teamPlan?.utilityAcquisitions ?? [])
    .map(({ family }) => [...(family ?? [])]);
  return {
    id: `prepare-${forObjective}-roster`,
    target: {
      kind: "party-roster",
      map: selected.map,
      minimumPartySize: desiredPartySize,
      maximumPartySize: desiredPartySize,
      minimumCombatPartySize,
      ...(requiredMoveIds.length > 0 ? { requiredMoveIds } : {}),
      ...(requiredFamilies.length > 0 ? {
        requiredFamilies,
      } : {}),
      ...(excludeUtilityCarriers ? {
        excludedFamilies,
        excludeHmUtilityCarriers: true,
      } : {}),
    },
    currentBattlePartySize: nonUtilityParty.length,
    minimumBattlePartySize,
    minimumCombatPartySize,
    desiredBattlePartySize: minimumCombatPartySize,
    forObjective,
  };
}

function selectImportantBattleSquad(party, objective, teamPlan) {
  const coreSpecies = new Set((objective?.coreSpecies ?? []).map(Number));
  const preferredFamilies = (objective?.preferredFamilies ?? []).map(
    (family) => new Set((family ?? []).map(Number)),
  );
  const starterSpecies = new Set(
    (objective?.starterBattleFamily ?? teamPlan?.starterFamily ?? []).map(Number),
  );
  const strategicSpecies = new Set(
    (teamPlan?.acquisitions ?? [])
      .flatMap(({ family }) => family ?? [])
      .map(Number),
  );
  const combatCandidates = party.filter((pokemon) =>
    !isHmUtilityCarrier(pokemon, teamPlan)
  );
  const requestedBattlePartySize = Number(objective?.minimumBattlePartySize ?? 0);
  const minimumReadyBattleMembers = Number(
    objective?.minimumReadyBattleMembers ?? objective?.enemyPartySize ?? 0,
  );
  const selectedBattlePartySize = Math.max(
    requestedBattlePartySize,
    minimumReadyBattleMembers,
  );
  const activeBattlePartySize = selectedBattlePartySize > 0
    ? Math.min(selectedBattlePartySize, combatCandidates.length)
    : combatCandidates.length;
  const roleRank = (pokemon) => {
    const species = Number(pokemon.species);
    const preferredRank = preferredFamilies.findIndex((family) =>
      family.has(species)
    );
    if (preferredRank >= 0) return preferredRank;
    const fallbackOffset = preferredFamilies.length;
    if (coreSpecies.has(species)) return fallbackOffset;
    if (starterSpecies.has(species)) return fallbackOffset + 1;
    if (strategicSpecies.has(species)) return fallbackOffset + 2;
    return fallbackOffset + 3;
  };
  return [...combatCandidates].sort((left, right) =>
    roleRank(left) - roleRank(right) ||
    Number(right.level ?? 0) - Number(left.level ?? 0) ||
    Number(left.slot ?? 0) - Number(right.slot ?? 0)
  ).slice(0, activeBattlePartySize);
}

function maximumVsSeekerRematchTier(observation) {
  if (
    !watchedFlag(observation, VS_SEEKER_FLAG_ID) &&
    !bagHasItem(observation, VS_SEEKER_ITEM_ID)
  ) return 0;
  if (watchedFlag(observation, VS_SEEKER_RS_LINK_FLAG_ID)) return 5;
  if (watchedFlag(observation, VS_SEEKER_GAME_CLEAR_FLAG_ID)) return 4;
  if (watchedFlag(observation, VS_SEEKER_FUCHSIA_VISITED_FLAG_ID)) return 3;
  if (watchedFlag(observation, VS_SEEKER_CELADON_VISITED_FLAG_ID)) return 2;
  return 1;
}

function resolveTrainerTrainingEntry(trainer, observation, responseReachable) {
  const numericFlags = observation?.playerMemory?.storyState?.flagIds ?? {};
  if (numericFlags[trainer.flagId] === false) {
    return { ...trainer, rematch: false, vsSeekerAction: null };
  }
  if (numericFlags[trainer.flagId] !== true) return null;
  const rematchParties = trainer.rematchParties ?? [];
  const maximumTier = Math.min(
    maximumVsSeekerRematchTier(observation),
    rematchParties.length - 1,
  );
  if (maximumTier < 1) return null;
  const rematchEntries = observation?.playerMemory?.vsSeeker?.rematchEntries;
  if (!Array.isArray(rematchEntries)) return null;
  // FireRed keys trainerRematches by a map object's localId. Those identifiers
  // repeat on every map, and the cartridge clears the whole response array on
  // a map transition. A response can therefore only describe a trainer on the
  // currently loaded map; treating it as global sends the player toward an
  // unrelated trainer that happens to have the same localId.
  const responseBelongsToTrainerMap =
    observation?.playerMemory?.map?.id === trainer?.target?.map;
  const readyTier = responseBelongsToTrainerMap &&
      Number(rematchEntries[trainer.localId] ?? 0) > 0 && responseReachable(trainer)
    ? Number(rematchEntries[trainer.localId] ?? 0)
    : 0;
  let tier = readyTier > 0 && readyTier < rematchParties.length
    ? readyTier
    : null;
  if (tier === null) {
    for (let candidate = 1; candidate <= maximumTier; candidate += 1) {
      const party = rematchParties[candidate];
      if (party && numericFlags[party.flagId] !== true) {
        tier = candidate;
        break;
      }
    }
  }
  if (tier === null) {
    for (let candidate = maximumTier; candidate >= 1; candidate -= 1) {
      if (rematchParties[candidate]) {
        tier = candidate;
        break;
      }
    }
  }
  while (tier > 0 && !rematchParties[tier]) tier -= 1;
  const party = rematchParties[tier];
  if (!party || tier < 1) return null;
  const batterySteps = Number(
    observation?.playerMemory?.vsSeeker?.batterySteps ?? 0,
  );
  return {
    ...trainer,
    ...party,
    baseId: trainer.id,
    rematch: true,
    rematchTier: tier,
    vsSeekerAction: readyTier > 0
      ? "battle"
      : batterySteps >= 100
        ? "activate"
        : "recharge",
  };
}

function trainerTrainingActionPriority(trainer) {
  if (trainer?.vsSeekerAction === "battle") return 0;
  if (trainer?.vsSeekerAction === "activate") return 1;
  if (trainer?.rematch !== true) return 2;
  if (trainer?.vsSeekerAction === "recharge") return 3;
  return 4;
}

const VS_SEEKER_HORIZONTAL_RANGE = 7;
const VS_SEEKER_VERTICAL_RANGE = 5;

function vsSeekerApproachQuery(map, observation) {
  const local = map?.id === observation?.playerMemory?.map?.id;
  let view = local ? currentMapView(map, observation) : map;
  // Walking trainers no longer occupy their authored coordinates. Use the
  // current object for both scan coverage and the route to its response;
  // persisted positions remain useful when approaching an unloaded object.
  if (local && view) view = {...view, objectEvents:(view.objectEvents ?? []).map(
    (object, index) => ({...object, ...observedObjectPosition(observation, index, object)}),
  )};
  const { blocked, interactive } = routingState(view, local ? observation : null);
  // Even a same-map warp reloads the map and clears its rematch responses.
  for (const warp of view?.warpEvents ?? []) blocked.add(`${warp.x},${warp.y}`);
  const capabilities = worldNavigationCapabilities(observation);
  return { map: view, route(position, target) {
    if (!view || !position || target?.map !== view.id) return null;
    const cell = indexedMapCells(view).get(`${position.x},${position.y}`);
    return localRoute(view, position,
      new Set(targetCoordinates(view, target).map(p=>`${p.x},${p.y}`)),
      blocked, interactive, {...capabilities,
        includeRegionLedges:true,
        currentlySurfing:SURFABLE_BEHAVIORS.has(cell?.behaviorName),
        currentElevation:cell?.elevation});
  }};
}

function vsSeekerResponseReachability(world, observation) {
  const map = (worldData(world).maps ?? []).find(m=>m.id===observation?.playerMemory?.map?.id);
  let query;
  const results = new Map();
  return trainer => {
    if (!map || trainer.target?.map !== map.id) return false;
    if (!results.has(trainer.localId)) {
      query ??= vsSeekerApproachQuery(map, observation);
      const route = query.route(observation.playerMemory.position, trainer.target);
      const remaining = 100-Number(observation.playerMemory.vsSeeker?.responseClearSteps ?? 0);
      results.set(trainer.localId, Boolean(route && route.distance < remaining));
    }
    return results.get(trainer.localId);
  };
}

function trainerObjectForCandidate(graph, candidate, map = null) {
  const target = candidate?.trainer?.target;
  return target?.kind === "object"
    ? (map ?? graph.maps.get(target.map))?.objectEvents?.[target.index] ?? null
    : null;
}

function trainerVisibleFrom(object, position) {
  return Number.isFinite(Number(object?.x)) &&
    Number.isFinite(Number(object?.y)) &&
    Math.abs(Number(object.x) - Number(position?.x)) <=
      VS_SEEKER_HORIZONTAL_RANGE &&
    Math.abs(Number(object.y) - Number(position?.y)) <=
      VS_SEEKER_VERTICAL_RANGE;
}

export function vsSeekerTrainerVisible(observation, localId) {
  // Activation requires an active object on this map, just as the cartridge's
  // IsTrainerVisibleOnScreen does. Templates can guide travel, not prove range.
  const object = currentMapLiveObjects(observation).find(
    event => Number(event.localId) === Number(localId),
  );
  return Boolean(object && trainerVisibleFrom(object.current, observation?.playerMemory?.position));
}

function buildVsSeekerBatchCandidates({
  graph,
  observation,
  candidates,
  healerTransitionDistance,
  objectiveTransitionDistance,
}) {
  const batchCandidates = candidates.filter(({ trainer }) =>
    ["activate", "recharge"].includes(trainer?.vsSeekerAction)
  );
  if (batchCandidates.length === 0) return candidates;
  const ordinaryCandidates = candidates.filter(({ trainer }) =>
    !["activate", "recharge"].includes(trainer?.vsSeekerAction)
  );
  const byMap = Map.groupBy(batchCandidates, ({ trainer }) => trainer.target.map);
  const batched = [];
  for (const [mapId, mapCandidates] of byMap) {
    const staticMap = graph.maps.get(mapId);
    if (!staticMap) continue;
    const approachQuery = vsSeekerApproachQuery(staticMap, observation);
    const map = approachQuery.map;
    const objectsByCandidate = new Map(mapCandidates.flatMap((candidate) => {
      const object = trainerObjectForCandidate(graph, candidate, map);
      return object ? [[candidate, object]] : [];
    }));
    if (objectsByCandidate.size === 0) continue;
    // Shortlist by local topology before doing exact approach searches. A
    // visible trainer across a fence is not part of a usable response batch.
    // Directed ledge links remain valid; links through another map do not.
    const regionsByCandidate = new Map([...objectsByCandidate].map(([candidate, object])=>{
      const regions = new Set(objectApproaches(map, object).flatMap(point=>{
        const component=graph.componentAt(mapId, point);
        return component===undefined?[]:[regionKey(mapId, component)];
      }));
      for (const key of regions) for (const from of graph.reverse.get(key) ?? []) {
        if (from.startsWith(`${mapId}\0`)) regions.add(from);
      }
      return [candidate, regions];
    }));
    const occupied = new Set((map.objectEvents ?? []).flatMap((object) =>
      Number.isFinite(Number(object?.x)) && Number.isFinite(Number(object?.y))
        ? [`${Number(object.x)},${Number(object.y)}`]
        : []
    ));
    const warpTiles = new Set((map.warpEvents ?? []).map((warp) =>
      `${Number(warp.x)},${Number(warp.y)}`
    ));
    const capabilities = worldNavigationCapabilities(observation);
    const groups = new Map();
    for (const cell of map.layout?.cells ?? []) {
      const position = { x: Number(cell.x), y: Number(cell.y) };
      const coordinate = `${position.x},${position.y}`;
      if (
        !graphCellPassable(cell, capabilities) ||
        SURFABLE_BEHAVIORS.has(cell.behaviorName) ||
        occupied.has(coordinate) || warpTiles.has(coordinate)
      ) continue;
      const component = graph.componentAt(mapId, position);
      if (component === undefined) continue;
      const covered = mapCandidates.filter((candidate) =>
        trainerVisibleFrom(objectsByCandidate.get(candidate), position) &&
        regionsByCandidate.get(candidate)?.has(regionKey(mapId, component))
      ).sort((left, right) =>
        Number(left.trainer.localId ?? 0) - Number(right.trainer.localId ?? 0)
      );
      if (covered.length === 0) continue;
      const key = `${component}\0${covered.map(({ trainer }) =>
        Number(trainer.localId ?? 0)
      ).join(",")}`;
      const group = groups.get(key) ?? { component, covered, positions: [] };
      group.positions.push(position);
      groups.set(key, group);
    }
    for (const group of groups.values()) {
      const targets = group.positions.map(({ x, y }) => ({
        kind: "vs-seeker-activation",
        map: mapId,
        x,
        y,
      }));
      const canFinishResponses = position => group.covered.every(candidate=>{
        const route=approachQuery.route(position, candidate.trainer.target);
        return route && route.distance < 100;
      });
      let selectedTarget = null;
      let selectedMetrics = null;
      if (observation?.playerMemory?.map?.id === mapId) {
        const currentMap = currentMapView(map, observation);
        const { blocked, interactive } = routingState(currentMap, observation);
        const routes = localRoutes(
          currentMap,
          observation?.playerMemory?.position,
          new Set(targets.map(({ x, y }) => `${x},${y}`)),
          blocked,
          interactive,
          capabilities,
        );
        const closest = [...routes.values()].sort((left, right) =>
          Number(left.travelCost ?? left.distance) -
            Number(right.travelCost ?? right.distance) ||
          Number(left.distance) - Number(right.distance) ||
          Number(left.y) - Number(right.y) ||
          Number(left.x) - Number(right.x)
        ).find(canFinishResponses);
        if (closest) {
          selectedTarget = {
            kind: "vs-seeker-activation",
            map: mapId,
            x: Number(closest.x),
            y: Number(closest.y),
          };
          selectedMetrics = {
            transitions: 0,
            localSteps: Number(closest.travelCost ?? closest.distance),
          };
        }
      }
      if (!selectedTarget) {
        // Every target in this group belongs to the same static collision
        // component, so the inter-map transition route is identical. Avoid a
        // separate world-route search for every tile in the activation area.
        const reachableTarget=targets.find(canFinishResponses);
        for (const target of reachableTarget ? [reachableTarget] : []) {
          const metrics = routeMetrics({ graph, observation, target });
          if (!metrics) continue;
          if (
            !selectedMetrics ||
            metrics.transitions < selectedMetrics.transitions ||
            metrics.transitions === selectedMetrics.transitions &&
              metrics.localSteps < selectedMetrics.localSteps
          ) {
            selectedTarget = target;
            selectedMetrics = metrics;
          }
        }
      }
      if (!selectedTarget || !selectedMetrics) continue;
      const representative = [...group.covered].sort((left, right) =>
        Number(right.trainer.expectedExperience ?? 0) -
          Number(left.trainer.expectedExperience ?? 0) ||
        Number(right.trainer.expectedPayout ?? 0) -
          Number(left.trainer.expectedPayout ?? 0) ||
        Number(left.trainer.localId ?? 0) - Number(right.trainer.localId ?? 0)
      )[0];
      const knownPayouts = group.covered.map(({ trainer }) =>
        Number(trainer.expectedPayout)
      );
      const batch = Object.freeze({
        responderCount: group.covered.length,
        trainerIds: Object.freeze(group.covered.map(({trainer})=>trainer.id)),
        localIds: Object.freeze(group.covered.map(({ trainer }) =>
          Number(trainer.localId)
        )),
        expectedExperience: group.covered.reduce(
          (total, { trainer }) => total + Number(trainer.expectedExperience ?? 0),
          0,
        ),
        expectedPayout: knownPayouts.every(Number.isFinite)
          ? knownPayouts.reduce((total, payout) => total + payout, 0)
          : null,
        maximumLevel: Math.max(...group.covered.map(({ trainer }) =>
          Number(trainer.maximumLevel ?? 0)
        )),
        partySize: group.covered.reduce(
          (total, { trainer }) => total + Number(trainer.partySize ?? 0),
          0,
        ),
        healerTransitions: healerTransitionDistance(selectedTarget),
      });
      batched.push({
        ...representative,
        target: selectedTarget,
        metrics: selectedMetrics,
        riskTier: Math.max(...group.covered.map(({ riskTier }) => riskTier)),
        trainingMethod: group.covered.some(
          ({ trainingMethod }) => trainingMethod !== "direct",
        ) ? "switch" : "direct",
        preferred: group.covered.some(({ preferred }) => preferred),
        objectiveTransitions: objectiveTransitionDistance(selectedTarget),
        healerTransitions: batch.healerTransitions,
        vsSeekerBatch: batch,
      });
    }
  }
  return [...ordinaryCandidates, ...batched];
}

function trainingObjectiveTrainer(trainer) {
  return {
    id: trainer.id,
    name: trainer.name,
    displayName: trainer.displayName,
    flagId: trainer.flagId,
    minimumLevel: trainer.minimumLevel,
    maximumLevel: trainer.maximumLevel,
    partySize: trainer.partySize,
    ...(trainer.rematch ? {
      baseId: trainer.baseId,
      localId: trainer.localId,
      rematchTier: trainer.rematchTier,
      expectedExperience: trainer.expectedExperience,
      expectedPayout: trainer.expectedPayout,
    } : {}),
  };
}

export function selectEffortTrainingLocation({world,mechanics,observation,member,targets,preferredMap=null}) {
  const species=new Map(Object.values((mechanics?.data??mechanics)?.species??{}).filter(Boolean).map(s=>[s.name,s]));
  const graph=createWorldNavigationGraph(world,observation),query=createRouteMetricsQuery(graph,observation);
  const candidates=trainingCatalog(world,mechanics).flatMap(encounter=>{
    if(encounter.map.startsWith('MAP_SAFARI_ZONE_')||!optionalMapAuthorized(encounter.map,observation)||encounter.maximumWildLevel>member.level+2)return [];
    const reward=encounter.mons.reduce((n,mon)=>{
      const gain=acceptableEffortGain(member,species.get(mon.species),targets);
      return n+(gain?Object.values(gain).reduce((a,b)=>a+b,0)*mon.weight:0);
    },0);
    if(!reward)return [];
    const target={kind:'encounter-zone',map:encounter.map},metrics=routeMetrics({graph,observation,target,query});
    if(!metrics)return [];
    return [{target,encounter:{rate:encounter.rate,minimumWildLevel:encounter.minimumWildLevel,maximumWildLevel:encounter.maximumWildLevel},score:reward/(20+180/Math.max(1,encounter.rate)+metrics.transitions*18+metrics.localSteps*.25)*(encounter.map===preferredMap?1.15:1)}];
  });
  return candidates.sort((a,b)=>b.score-a.score||a.target.map.localeCompare(b.target.map))[0]??null;
}

const CYCLING_ROAD_PULL_BEHAVIORS=new Set(['MB_CYCLING_ROAD_PULL_DOWN','MB_CYCLING_ROAD_PULL_DOWN_GRASS']);
function cyclingRoadPullCells(world,mapId){
  const maps=(world?.data??world)?.maps??[];
  const map=maps.find(candidate=>candidate.id===mapId);
  const cells=map?.layout?.cells;
  return Array.isArray(cells)?cells.filter(cell=>CYCLING_ROAD_PULL_BEHAVIORS.has(cell.behaviorName)):[];
}
// A trainer interaction needs the player to stand beside the object. On the
// cycling-road pull the slope keeps sliding the player away, so those routes
// cannot hold the interaction and are not selectable for identity-evolution
// training (campaign battle training keeps its own route choices).
function cyclingRoadPullApproach(world,target){
  const maps=(world?.data??world)?.maps??[];
  const map=maps.find(candidate=>candidate.id===target?.map);
  const pull=cyclingRoadPullCells(world,target?.map);
  if(!map||!pull.length||!Array.isArray(map?.layout?.cells))return false;
  const pullKeys=new Set(pull.map(cell=>`${Number(cell.x)},${Number(cell.y)}`));
  const resolved=computeTargetCoordinates(map,target);
  const points=resolved.length?resolved:
    (Number.isSafeInteger(Number(target?.x))&&Number.isSafeInteger(Number(target?.y))
      ? [{x:Number(target.x),y:Number(target.y)}]:[]);
  return points.some(({x,y})=>{
    const px=Number(x),py=Number(y);
    return [`${px},${py}`,`${px+1},${py}`,`${px-1},${py}`,`${px},${py+1}`,`${px},${py-1}`].some(key=>pullKeys.has(key));
  });
}
function cyclingRoadPullEncounterMap(world,mapId){
  const maps=(world?.data??world)?.maps??[];
  const map=maps.find(candidate=>candidate.id===mapId);
  const cells=map?.layout?.cells;
  if(!Array.isArray(cells))return false;
  return cells.some(cell=>Number(cell.encounterType)===1&&CYCLING_ROAD_PULL_BEHAVIORS.has(cell.behaviorName));
}

export function selectTrainingObjective({
  world,
  story = null,
  mechanics = null,
  observation,
  objective,
  trainerCatalog = [],
  teamPlan = null,
  preferredTrainerId = null,
  excludedTrainerIds = [],
  excludedTrainingMaps = [],
  trainingTask = null,
  progressionObjective = null,
  trainingSamples = {},
  preferredTrainingKey = null,
  avoidPullTerrain = false,
} = {}) {
  // Actual opponent identity takes priority over a retained training task.
  // Outside this battle, the original preparation/XP objective remains intact.
  if (isMajorBattle(observation, mechanics)) return null;
  if(objective?.evTraining){
    if(!objective.evTraining.training)return null;
    const member=(observation.playerMemory?.trainer?.party??[]).find(p=>encounterFingerprint(p)===objective.evTraining.fingerprint);
    return member?{...objective,trainingPartySlot:member.slot,trainingSpecies:member.species,currentTeamAnchorLevel:member.level,minimumTeamAnchorLevel:member.level+1,forObjective:objective.id,
      encounter:objective.evTraining.encounter}:null;
  }
  // Teaching, evolution and saving own their menus through completion. A
  // pending VS Seeker batch must not reopen party ordering in those menus.
  if (['save-game','teach-move'].includes(objective?.target?.kind) ||
      objective?.identityEvolution && !objective.trainingFingerprint) return null;
  const forObjective = objective?.rosterPreparationFor ?? objective?.id;
  const party = (observation?.playerMemory?.trainer?.party ?? []).filter(
    ({ species, level }) => Number(species) > 0 && Number(level) > 0,
  );
  if (objective?.incomePreparation) {
    const reserved=objective.fundingBattler;
    const member=party.find(p=>reserved?.identity
      ? campaignMemberIdentity(p)===reserved.identity
      : Number(p.slot)===reserved?.slot&&Number(p.species)===reserved?.species);
    return member?{...objective,trainingPartySlot:member.slot,trainingSpecies:member.species,
      currentTeamAnchorLevel:member.level,minimumTeamAnchorLevel:member.level,
      trainingMethod:'direct',forObjective:objective.id}:null;
  }
  const taskMember=trainingTask?party.find(p=>Number(p.slot)===Number(trainingTask.partySlot)&&Number(p.species)===Number(trainingTask.species)):null;
  const coreSpecies = new Set((objective?.coreSpecies ?? []).map(Number));
  const battleParty = objective?.importantBattle
    ? selectImportantBattleSquad(party, objective, teamPlan)
    : party;
  const excludedTrainers = new Set((excludedTrainerIds ?? []).map(Number));
  const currentMap = observation?.playerMemory?.map?.id;
  const responseReachable = vsSeekerResponseReachability(world, observation);
  const activeVsSeekerResponders = (trainerCatalog ?? []).flatMap((trainer) => {
    const resolved = resolveTrainerTrainingEntry(trainer, observation, responseReachable);
    return resolved?.vsSeekerAction === "battle" &&
        resolved.target?.map === currentMap &&
        !(avoidPullTerrain&&cyclingRoadPullApproach(world,resolved.target)) &&
        !excludedTrainers.has(Number(resolved.id)) &&
        !excludedTrainers.has(Number(resolved.baseId))
      ? [resolved]
      : [];
  }).sort((left, right) =>
    Number(right.expectedExperience ?? 0) - Number(left.expectedExperience ?? 0) ||
    Number(right.maximumLevel ?? 0) - Number(left.maximumLevel ?? 0) ||
    Number(left.localId ?? 0) - Number(right.localId ?? 0)
  );
  const activeVsSeekerResponder = activeVsSeekerResponders[0] ?? null;
  if (activeVsSeekerResponder) {
    // An activation is a small, expiring batch transaction. Finish every
    // affirmative response even if an earlier battle happens to satisfy the
    // original level gate; a map transition would erase the remaining slots.
    // Medicine/travel objectives have no battle roster of their own. The
    // expiring response batch still belongs to the permanent team's progress,
    // rather than whichever low-level field helper happens to be in the party.
    const healthyCleanupMembers = permanentTrainingParty(battleParty,teamPlan).filter(
      ({ hp }) => Number(hp) > 0,
    )
      .sort((left, right) =>
        Number(left.level ?? 0) - Number(right.level ?? 0) ||
        Number(right.hp ?? 0) / Math.max(1, Number(right.maxHp ?? 1)) -
          Number(left.hp ?? 0) / Math.max(1, Number(left.maxHp ?? 1)) ||
        Number(left.slot ?? 0) - Number(right.slot ?? 0)
      );
    // The batch trains for experience, so a level-100 member is never its
    // trainee; it may still escort. With no member able to gain experience the
    // expiring batch is finished without a trainee constraint.
    const gainsExperience = (member) => Boolean(member) && Number(member.level ?? 0) < 100;
    const experienceCleanupMembers = healthyCleanupMembers.filter(gainsExperience);
    const withoutTrainee = () => ({
      id: "finish-vs-seeker-response-batch",
      target: activeVsSeekerResponder.target,
      trainingSource: "vs-seeker",
      vsSeekerAction: "battle",
      forObjective,
      responseBatchRemaining: activeVsSeekerResponders.length,
      trainer: trainingObjectiveTrainer(activeVsSeekerResponder),
    });
    const requiredMember=(gainsExperience(taskMember)?taskMember:null)??(Number(objective?.minimumCoreLevel)>0?party.find(p=>
      coreSpecies.has(Number(p.species))&&Number(p.level)<Math.min(100,Number(objective.minimumCoreLevel))):null);
    let cleanupMember = requiredMember ?? experienceCleanupMembers[0] ??
      (healthyCleanupMembers.length ? null : [battleParty[0], party[0]].find(gainsExperience)) ?? null;
    if (!cleanupMember) return battleParty.length || party.length ? withoutTrainee() : null;
    const responderMaximumLevel = Number(activeVsSeekerResponder.maximumLevel ?? 0);
    const healthRatio = (member) => Number(member.hp ?? 0) /
      Math.max(1, Number(member.maxHp ?? 1));
    const capableHealthyEscortFor = (member) =>
      healthyCleanupMembers.filter((candidate) =>
        Number(candidate.slot) !== Number(member.slot) &&
        healthRatio(candidate) >= 0.5 &&
        responderMaximumLevel <= Number(candidate.level ?? 0) + 2
      ).sort((left, right) =>
        Number(left.level ?? 0) - Number(right.level ?? 0) ||
        healthRatio(right) - healthRatio(left) ||
        Number(left.slot ?? 0) - Number(right.slot ?? 0)
      )[0] ?? null;
    let cleanupLevel = Number(cleanupMember.level ?? 0);
    let cleanupNeedsEscort = responderMaximumLevel > cleanupLevel + 2;
    let healthyTrainingEscort = capableHealthyEscortFor(cleanupMember);
    if (cleanupNeedsEscort && !healthyTrainingEscort) {
      cleanupMember = healthyCleanupMembers.find((member) =>
        healthRatio(member) >= 0.5 &&
        responderMaximumLevel <= Number(member.level ?? 0) + 2
      ) ?? [...healthyCleanupMembers].sort((left, right) =>
        Number(right.level ?? 0) - Number(left.level ?? 0) ||
        healthRatio(right) - healthRatio(left) ||
        // Reversing the trainee order also reversed its slot tie-break: an
        // equally levelled lead was repeatedly exchanged with the last slot.
        // Keep the strongest healthy fallback stable when party slots move.
        Number(left.otId ?? 0) - Number(right.otId ?? 0) ||
        Number(left.personality ?? left.species) - Number(right.personality ?? right.species) ||
        Number(left.species) - Number(right.species)
      )[0] ?? cleanupMember;
      if (!gainsExperience(cleanupMember)) return withoutTrainee();
      cleanupLevel = Number(cleanupMember.level ?? 0);
      cleanupNeedsEscort = responderMaximumLevel > cleanupLevel + 2;
      healthyTrainingEscort = capableHealthyEscortFor(cleanupMember);
    }
    return {
      id: "finish-vs-seeker-response-batch",
      target: activeVsSeekerResponder.target,
      trainingSource: "vs-seeker",
      vsSeekerAction: "battle",
      currentTeamAnchorLevel: cleanupLevel,
      minimumTeamAnchorLevel: cleanupMember===requiredMember
        ? Number(trainingTask?.minimumLevel??objective.minimumCoreLevel??cleanupLevel) : cleanupLevel,
      trainingPartySlot: cleanupMember.slot ?? null,
      trainingSpecies: cleanupMember.species ?? null,
      ...(cleanupNeedsEscort && healthyTrainingEscort ? {
        trainingMethod: "switch",
      } : {}),
      ...(healthyTrainingEscort ? {
        escortPartySlot: healthyTrainingEscort.slot,
        escortSpecies: healthyTrainingEscort.species,
      } : {}),
      forObjective,
      responseBatchRemaining: activeVsSeekerResponders.length,
      trainer: trainingObjectiveTrainer(activeVsSeekerResponder),
    };
  }
  const starterSpecies = new Set(
    (objective?.starterBattleFamily ?? teamPlan?.starterFamily ?? []).map(Number),
  );
  const enemyAceLevel = Number(objective?.enemyAceLevel ?? 0);
  const minimumReadyBattleMembers = Number(
    objective?.minimumReadyBattleMembers ?? objective?.enemyPartySize ?? 0,
  );
  const usesRoleBasedBattleReadiness = Boolean(
    objective?.importantBattle &&
    starterSpecies.size > 0 &&
    enemyAceLevel > 0 &&
    minimumReadyBattleMembers > 0
  );
  let roleBasedBattleTrainingMember = null;
  let roleBasedBattleTrainingLevel = 0;
  let expShareTrainingMember = null;
  if (usesRoleBasedBattleReadiness) {
    const starterBattleTargetLevel = Number(
      objective?.starterBattleTargetLevel ??
      objective?.battleTeamTargetLevel ??
      enemyAceLevel + IMPORTANT_BATTLE_MINIMUM_LEVEL_ADVANTAGE,
    );
    const supportBattleTargetLevel = Number(
      objective?.supportBattleTargetLevel ?? enemyAceLevel,
    );
    const targetLevelFor = ({ species }) =>
      starterSpecies.has(Number(species))
        ? starterBattleTargetLevel
        : supportBattleTargetLevel;
    const readyBattleMembers = battleParty.filter((member) =>
      Number(member.level ?? 0) >= targetLevelFor(member)
    );
    const underTargetMembers = battleParty.filter((member) =>
      Number(member.level ?? 0) < targetLevelFor(member)
    );
    const currentExpShareHolder = battleParty.find(
      ({ heldItem }) => Number(heldItem ?? 0) === EXP_SHARE_ITEM_ID,
    ) ?? null;
    const expShareAvailable = Boolean(
      currentExpShareHolder || bagHasItem(observation, EXP_SHARE_ITEM_ID),
    );
    const balancedTrainingOrder = (left, right) =>
      Number(left.level ?? 0) / targetLevelFor(left) -
        Number(right.level ?? 0) / targetLevelFor(right) ||
      Number(left.level ?? 0) - Number(right.level ?? 0) ||
      Number(left.slot ?? 0) - Number(right.slot ?? 0);
    const orderedUnderTargetMembers = [...underTargetMembers]
      .sort(balancedTrainingOrder);
    expShareTrainingMember = expShareAvailable
      ? currentExpShareHolder && underTargetMembers.includes(currentExpShareHolder)
          ? currentExpShareHolder
          : orderedUnderTargetMembers.find(
              ({ heldItem }) => Number(heldItem ?? 0) === 0,
            ) ?? null
      : null;
    if (
      readyBattleMembers.length >= minimumReadyBattleMembers
    ) {
      const passiveTrainingMember = orderedUnderTargetMembers[0] ?? null;
      if (!passiveTrainingMember) return null;
      if (["elite-four", "champion"].includes(objective?.battleCategory)) {
        if (!expShareAvailable) return null;
        return {
          id: "support-lowest-member-with-exp-share",
          trainingMode: "experience-share-only",
          trainingSource: "story",
          target: objective.target,
          currentTeamAnchorLevel: Number(passiveTrainingMember.level ?? 0),
          minimumTeamAnchorLevel: targetLevelFor(passiveTrainingMember),
          trainingRotation: "one-level",
          expSharePartySlot: passiveTrainingMember.slot ?? null,
          trainingSpecies: passiveTrainingMember.species ?? null,
          forObjective,
          readyBattleMembers: readyBattleMembers.length,
          minimumReadyBattleMembers,
        };
      }
      return {
        id: "train-battle-member-through-story",
        trainingMode: "passive",
        trainingSource: "story",
        target: objective.target,
        currentTeamAnchorLevel: Number(passiveTrainingMember.level ?? 0),
        minimumTeamAnchorLevel: targetLevelFor(passiveTrainingMember),
          trainingRotation: "one-level",
        trainingPartySlot: passiveTrainingMember.slot ?? null,
        ...(expShareTrainingMember ? {
          expSharePartySlot: expShareTrainingMember.slot ?? null,
          trainingPartySlots: Object.freeze([
            passiveTrainingMember.slot,
            ...(
              Number(expShareTrainingMember.slot) === Number(passiveTrainingMember.slot)
                ? []
                : [expShareTrainingMember.slot]
            ),
          ]),
        } : {}),
        trainingSpecies: passiveTrainingMember.species ?? null,
        forObjective,
        trainingMethod: "switch",
        readyBattleMembers: readyBattleMembers.length,
        minimumReadyBattleMembers,
      };
    }
    if (readyBattleMembers.length < minimumReadyBattleMembers) {
      if (expShareAvailable) {
        const activeCandidates = underTargetMembers.filter((member) =>
          Number(member.slot) !== Number(expShareTrainingMember?.slot)
        );
        roleBasedBattleTrainingMember = [
          ...(activeCandidates.length > 0 ? activeCandidates : underTargetMembers),
        ].sort(balancedTrainingOrder)[0] ?? null;
      } else {
        roleBasedBattleTrainingMember = orderedUnderTargetMembers[0] ?? null;
      }
      roleBasedBattleTrainingLevel = roleBasedBattleTrainingMember
        ? targetLevelFor(roleBasedBattleTrainingMember)
        : 0;
    }
  }
  const minimumBattleMemberLevel = Number(
    roleBasedBattleTrainingLevel || (
      objective?.battleTeamTargetLevel ?? objective?.minimumBattleMemberLevel ?? 0
    ),
  );
  const underLevelBattleMembers = roleBasedBattleTrainingMember
    ? [roleBasedBattleTrainingMember]
    : minimumBattleMemberLevel > 0
    ? battleParty.filter(({ level }) => Number(level ?? 0) < minimumBattleMemberLevel)
        .sort((left, right) =>
          Number(left.level ?? 0) - Number(right.level ?? 0) ||
          Number(left.slot ?? 0) - Number(right.slot ?? 0)
        )
    : [];
  const battleTrainingMember = taskMember ?? underLevelBattleMembers[0] ?? null;
  const requiredLevel = taskMember ? (trainingTask.targetLevel??trainingTask.minimumLevel) : battleTrainingMember
    ? minimumBattleMemberLevel
    : objective?.importantBattle
    ? 0
    : Number(objective?.minimumCoreLevel ?? objective?.minimumTeamAnchorLevel ?? 0);
  if (requiredLevel <= 0) {
    // Travel and regular story trainers supply XP without a training detour.
    // Acquisition, field-move, save and other menu transactions keep ownership.
    const targetLevel=Number(progressionObjective?.battleTeamTargetLevel??0);
    const travel=['object','trigger','background','map-arrival','position','exit-map'].includes(objective?.target?.kind);
    if(!travel || objective?.acquisitionId || objective?.captureSpecies?.length ||
      objective?.mandatoryInterlude || objective?.deferOptionalDetours || !targetLevel)return null;
    const eligible=permanentTrainingParty(party,teamPlan).filter(p=>Number(p.hp)>0&&
      Number(p.level)<targetLevel&&!obedienceRisk(p,observation))
      .sort((a,b)=>Number(a.level)-Number(b.level)||Number(a.slot)-Number(b.slot));
    const member=eligible[0];if(!member)return null;
    return {id:'train-battle-member-through-story',trainingMode:'passive',trainingSource:'story',
      trainingRotation:'one-level',trainingMethod:'switch',target:objective.target,
      currentTeamAnchorLevel:Number(member.level),minimumTeamAnchorLevel:targetLevel,
      trainingPartySlot:member.slot,trainingSpecies:member.species,forObjective};
  }
  const trainingParty = battleTrainingMember
    ? [battleTrainingMember]
    : battleParty.filter((pokemon) =>
        objective?.trainingFingerprint
          ? encounterFingerprint(pokemon) === objective.trainingFingerprint
          : coreSpecies.size === 0 || coreSpecies.has(Number(pokemon.species))
      ).sort((left, right) =>
        Number(left.level ?? 0) - Number(right.level ?? 0) ||
        Number(left.slot ?? 0) - Number(right.slot ?? 0)
      );
  const currentLevel = battleTrainingMember
    ? Number(battleTrainingMember.level ?? 0)
    : objective?.minimumCoreLevel
    ? Math.min(...trainingParty.map(({ level }) => Number(level ?? 0)))
    : Math.max(0, ...trainingParty.map(({ level }) => Number(level ?? 0)));
  if (!Number.isFinite(currentLevel)) return null;
  if (currentLevel >= requiredLevel) return null;
  const trainingMember = trainingParty[0] ?? null;
  // A postgame evolution trains one identified Pokémon. Its escort fights
  // after the switch, so the strongest healthy member opens the productive
  // tables; story training keeps its original escort order.
  const evolutionTrainee = Boolean(objective?.identityEvolution && objective?.trainingFingerprint);
  const healthyTrainingEscort = trainingMember
    ? battleParty.filter(p=>!obedienceRisk(p,observation)).filter(({ slot, level, hp }) =>
        Number(slot) !== Number(trainingMember.slot) &&
        Number(level ?? 0) > currentLevel &&
        Number(hp ?? 0) > 0
      ).map((member) => {
        const maximumHp = Number(member.maxHp ?? 0);
        const healthRatio = maximumHp > 0
          ? Number(member.hp ?? 0) / maximumHp
          : 1;
        return { member, healthRatio };
      }).filter(({ healthRatio }) => healthRatio >= 0.5)
      .sort((left, right) =>
        (evolutionTrainee
          ? Number(right.member.level ?? 0) - Number(left.member.level ?? 0)
          : Number(left.member.level ?? 0) - Number(right.member.level ?? 0)) ||
        right.healthRatio - left.healthRatio ||
        Number(left.member.slot ?? 0) - Number(right.member.slot ?? 0)
      )[0]?.member ?? null
    : null;
  if (evolutionTrainee && trainingMember && (
    bagHasItem(observation, EXP_SHARE_ITEM_ID) ||
    battleParty.some(({ heldItem }) => Number(heldItem ?? 0) === EXP_SHARE_ITEM_ID)
  )) expShareTrainingMember = trainingMember;
  // Experience the trainee still needs, for spreading one trip across the job.
  const progress = trainingMember?.experienceProgress;
  const levelSpan = Number(progress?.nextLevel) - Number(progress?.levelStart);
  const experienceNeeded = evolutionTrainee && Number.isFinite(levelSpan) && levelSpan > 0
    ? Math.max(0, Number(progress.remaining ?? 0)) + Math.max(0, requiredLevel - currentLevel - 1) * levelSpan
    : null;
  const directTrainingMaximum = Math.max(5, currentLevel + 2);
  const escortedTrainingMaximum = healthyTrainingEscort
    ? Math.max(5, Number(healthyTrainingEscort.level ?? 0) + 2)
    : 0;
  const graph = createWorldNavigationGraph(world, observation);
  const healerTransitionDistance = freeHealerTransitionDistanceLookup({
    graph,
    observation,
    story,
  });
  // This cache lives for one comparison only. A new party, flag, map grid or
  // exclusion is always evaluated by the next call, including test fixtures.
  const routingQuery = createRouteMetricsQuery(graph, observation);
  const objectiveMetrics = routeMetrics({
    graph,
    observation,
    target: objective.target,
    query: routingQuery,
  });
  const objectiveDistanceFrom = objective?.importantBattle
    ? campaignRegionTransitionDistanceLookup({
        graph,
        observation,
        target: objective.target,
      })
    : null;
  const objectiveTransitionDistanceCache = new Map();
  const objectiveTransitionDistance = (target) => {
    if (!objectiveDistanceFrom || !target?.map) return null;
    const key = JSON.stringify(target);
    if (!objectiveTransitionDistanceCache.has(key)) {
      objectiveTransitionDistanceCache.set(key, targetTransitionDistance({
        graph,
        target,
        distanceFrom: objectiveDistanceFrom,
      }));
    }
    return objectiveTransitionDistanceCache.get(key);
  };
  const targetEnteredByWarp = [...graph.edges.values()].some((edges) =>
    edges.some(({ transit }) =>
      transit?.kind === "warp" &&
      transit.destinationMap === objective?.target?.map
    )
  );
  const preparationTransitionLimit = targetEnteredByWarp ? 2 : 1;
  if (
    !objective?.importantBattle &&
    !objective?.minimumCoreLevel &&
    (
      !objectiveMetrics ||
      objectiveMetrics.transitions > preparationTransitionLimit
    )
  ) return null;
  const trainingKind = battleTrainingMember
    ? "train-battle-member"
    : "train-team-anchor";
  const mandatoryCaptureHunt = !objective?.safari && (
    (objective?.captureSpecies ?? []).length > 0 ||
    objective?.captureAnyNewSpecies === true
  );
  const numericFlags = observation?.playerMemory?.storyState?.flagIds ?? {};
  const trainingMemberLevel = Number(trainingMember?.level ?? currentLevel);
  const directTrainerMaximum = Math.max(5, trainingMemberLevel + 2);
  let encounterCandidates = trainingCatalog(world, mechanics).flatMap((encounter) => {
    if(excludedTrainingMaps.includes(encounter.map))return [];
    if (avoidPullTerrain && cyclingRoadPullEncounterMap(world, encounter.map)) return [];
    if (encounter.map.startsWith("MAP_SAFARI_ZONE_")) return [];
    if (!optionalMapAuthorized(encounter.map, observation)) return [];
    const target = { kind: "encounter-zone", map: encounter.map };
    const metrics = routeMetrics({ graph, observation, target, query: routingQuery });
    if (!metrics) return [];
    const directlySafe = encounter.maximumWildLevel <= directTrainingMaximum;
    const switchSafe = !directlySafe && Boolean(
      healthyTrainingEscort &&
      encounter.maximumWildLevel <= escortedTrainingMaximum &&
      !encounter.switchEscapeHazard,
    );
    return [{
      encounter,
      metrics,
      target,
      objectiveTransitions: objectiveTransitionDistance(target),
      riskTier: directlySafe ? 0 : switchSafe ? 1 : 2,
      trainingMethod: directlySafe ? "direct" : switchSafe ? "switch" : "guarded",
    }];
  });
  const nearestSafeWildTransitions = Math.min(
    ...encounterCandidates
      .filter(({ riskTier }) => riskTier <= 1)
      .map(({ metrics }) => metrics.transitions),
  );
  const maximumLocalTrainerTransitions = Number.isFinite(
    nearestSafeWildTransitions,
  )
    ? nearestSafeWildTransitions + TRAINER_LOCALITY_TRANSITION_MARGIN
    : Number.POSITIVE_INFINITY;
  let trainerCandidates = mandatoryCaptureHunt ||
      objective?.trainerTrainingAllowed === false
    ? []
    : (trainerCatalog ?? []).flatMap((trainer) => {
        const resolvedTrainer = resolveTrainerTrainingEntry(trainer, observation, responseReachable);
        if (
          !resolvedTrainer ||
          excludedTrainers.has(Number(resolvedTrainer.id)) ||
          excludedTrainers.has(Number(resolvedTrainer.baseId)) ||
          (avoidPullTerrain&&cyclingRoadPullApproach(world,resolvedTrainer.target)) ||
          !optionalMapAuthorized(resolvedTrainer.target.map, observation)
        ) return [];
        const directlySafe = resolvedTrainer.maximumLevel <= directTrainerMaximum;
        const switchSafe = !directlySafe && Boolean(
          healthyTrainingEscort &&
          resolvedTrainer.maximumLevel <= escortedTrainingMaximum,
        );
        if (!directlySafe && !switchSafe) return [];
        const preferred = preferredTrainerId !== null &&
          (
            Number(resolvedTrainer.id) === Number(preferredTrainerId) ||
            Number(resolvedTrainer.baseId) === Number(preferredTrainerId)
          );
        const metrics = routeMetrics({
          graph,
          observation,
          target: resolvedTrainer.target,
          query: routingQuery,
        });
        const objectiveTransitions = objectiveTransitionDistance(
          resolvedTrainer.target,
        );
        const stagesNearImportantBattle = Boolean(
          objective?.importantBattle &&
          Number.isSafeInteger(objectiveTransitions) &&
          objectiveTransitions <= IMPORTANT_BATTLE_TRAINING_STAGING_RADIUS
        );
        return (preferred || metrics) && (
          preferred || resolvedTrainer.rematch || stagesNearImportantBattle ||
            metrics.transitions <= maximumLocalTrainerTransitions
        )
          ? [{
          trainer: resolvedTrainer,
          metrics: metrics ?? {
            transitions: Number.POSITIVE_INFINITY,
            localSteps: Number.POSITIVE_INFINITY,
          },
          riskTier: directlySafe ? 0 : 1,
          trainingMethod: directlySafe ? "direct" : "switch",
          preferred,
          objectiveTransitions,
          healerTransitions: healerTransitionDistance(resolvedTrainer.target),
        }]
          : [];
      });
  if (objective?.importantBattle) {
    const productive = productiveTrainingOptions({ encounters: encounterCandidates, trainers: trainerCandidates });
    encounterCandidates = productive.encounters;
    trainerCandidates = productive.trainers;
  }
  const hasForwardBattleStaging = Boolean(
    objective?.importantBattle &&
    [
      ...encounterCandidates.filter(({ riskTier }) => riskTier <= 1),
      ...trainerCandidates,
    ].some(({ objectiveTransitions }) =>
      Number.isSafeInteger(objectiveTransitions) &&
      objectiveTransitions <= IMPORTANT_BATTLE_TRAINING_STAGING_RADIUS
    )
  );
  if (hasForwardBattleStaging) {
    const stagesNearObjective = ({ objectiveTransitions }) =>
      Number.isSafeInteger(objectiveTransitions) &&
      objectiveTransitions <= IMPORTANT_BATTLE_TRAINING_STAGING_RADIUS;
    encounterCandidates = encounterCandidates.filter(stagesNearObjective);
    trainerCandidates = trainerCandidates.filter(stagesNearObjective);
  }
  trainerCandidates = buildVsSeekerBatchCandidates({
    graph,
    observation,
    candidates: trainerCandidates,
    healerTransitionDistance,
    objectiveTransitionDistance,
  });
  const rateCandidate=candidate=>{
    const trainingRate=estimateTrainingCycle(candidate,{member:trainingMember,escort:healthyTrainingEscort,party,mechanics,samples:trainingSamples,experienceNeeded});
    return {...candidate,trainingRate,trainingMethod:trainingRate.viable===false&&trainingRate.matchupKnown!==false?'guarded':trainingRate.method,preferred:candidate.preferred||trainingRate.key===preferredTrainingKey};
  };
  const potentiallyViable=c=>c.trainingRate.viable||c.trainingRate.matchupKnown===false;
  trainerCandidates=trainerCandidates.map(rateCandidate);
  encounterCandidates=encounterCandidates.map(rateCandidate);
  // A bad/empty moveset must not make an unmet level gate disappear. Retain
  // guarded preparation so the existing recovery and battle safety can act.
  if([...trainerCandidates,...encounterCandidates].some(potentiallyViable)){
    trainerCandidates=trainerCandidates.filter(potentiallyViable);
    encounterCandidates=encounterCandidates.filter(potentiallyViable);
  }
  // A modest advantage is required to abandon the committed trainer. This
  // comparison runs after the expiring-response transaction above has finished.
  const rateScore=c=>c.trainingRate.matchupKnown?(c.trainingRate.xpPerMinute??c.trainingRate.xpPerGameMinute)*(c.preferred?1.15:1):0;
  // Switch training keeps the trainee out of the fight, so for an evolution
  // trainee it competes with direct training on rate. Guarded stays last.
  const riskClass = (candidate) => evolutionTrainee && candidate.riskTier <= 1 ? 0 : candidate.riskTier;
  const expectedTrainerCandidateExperience = (candidate) => Number(
    candidate.vsSeekerBatch?.expectedExperience ??
      candidate.trainer?.expectedExperience ?? 0,
  );
  const expectedTrainerCandidatePayout = (candidate) => Number(
    candidate.vsSeekerBatch?.expectedPayout ??
      candidate.trainer?.expectedPayout ?? 0,
  );
  trainerCandidates.sort((left, right) =>
    riskClass(left) - riskClass(right) ||
    rateScore(right)-rateScore(left) ||
    trainerTrainingActionPriority(left.trainer) -
      trainerTrainingActionPriority(right.trainer) ||
    Number(right.preferred) - Number(left.preferred) ||
    expectedTrainerCandidateExperience(right) -
      expectedTrainerCandidateExperience(left) ||
    expectedTrainerCandidatePayout(right) -
      expectedTrainerCandidatePayout(left) ||
    Number(left.vsSeekerBatch?.maximumLevel ?? 0) -
      Number(right.vsSeekerBatch?.maximumLevel ?? 0) ||
    Number(left.vsSeekerBatch?.partySize ?? 0) -
      Number(right.vsSeekerBatch?.partySize ?? 0) ||
    Number(left.healerTransitions ?? Number.POSITIVE_INFINITY) -
      Number(right.healerTransitions ?? Number.POSITIVE_INFINITY) ||
    left.metrics.transitions - right.metrics.transitions ||
    right.trainer.maximumLevel - left.trainer.maximumLevel ||
    left.metrics.localSteps - right.metrics.localSteps ||
    left.trainer.target.map.localeCompare(right.trainer.target.map) ||
    left.trainer.target.index - right.trainer.target.index
  );
  const bestWild=encounterCandidates.filter(c=>c.riskTier<=1)
    .sort((a,b)=>riskClass(a)-riskClass(b)||rateScore(b)-rateScore(a))[0];
  const trainerChoice=trainerCandidates[0];
  const selectedTrainer = trainerChoice&&(!bestWild||riskClass(trainerChoice)<riskClass(bestWild)||
    riskClass(trainerChoice)===riskClass(bestWild)&&rateScore(trainerChoice)>=rateScore(bestWild))?trainerChoice:null;
  if (selectedTrainer) {
    const trainer = selectedTrainer.trainer;
    const rechargeTarget = trainer.vsSeekerAction === "recharge" &&
        selectedTrainer.target?.kind === "vs-seeker-activation"
      ? {
          ...selectedTrainer.target,
          kind: "vs-seeker-recharge",
        }
      : null;
    if (trainer.vsSeekerAction === "recharge" && !rechargeTarget) return null;
    return {
      id: trainer.rematch
        ? `${trainingKind}-with-vs-seeker`
        : `${trainingKind}-with-trainer`,
      target: rechargeTarget ?? selectedTrainer.target ?? trainer.target,
      trainingSource: rechargeTarget
        ? "vs-seeker-recharge"
        : trainer.rematch
          ? "vs-seeker"
          : "trainer",
      ...(trainer.rematch ? { vsSeekerAction: trainer.vsSeekerAction } : {}),
      ...(selectedTrainer.vsSeekerBatch ? {
        vsSeekerBatch: selectedTrainer.vsSeekerBatch,
      } : {}),
      currentTeamAnchorLevel: currentLevel,
      minimumTeamAnchorLevel: requiredLevel,
      ...(objective?.importantBattle ? {trainingRotation:"one-level"} : {}),
      trainingPartySlot: trainingParty[0]?.slot ?? null,
      ...(expShareTrainingMember ? {
        expSharePartySlot: expShareTrainingMember.slot ?? null,
        trainingPartySlots: Object.freeze([
          trainingParty[0]?.slot,
          ...(
            Number(expShareTrainingMember.slot) === Number(trainingParty[0]?.slot)
              ? []
              : [expShareTrainingMember.slot]
          ),
        ]),
      } : {}),
      trainingSpecies: trainingParty[0]?.species ?? null,
      ...(selectedTrainer.trainingRate.matchupKnown&&selectedTrainer.trainingRate.viable?{trainingRate:selectedTrainer.trainingRate}:{}),
      forObjective,
      ...(selectedTrainer.trainingMethod !== "direct"
        ? { trainingMethod: selectedTrainer.trainingMethod }
        : {}),
      ...(healthyTrainingEscort ? {
        escortPartySlot: healthyTrainingEscort.slot,
        escortSpecies: healthyTrainingEscort.species,
      } : {}),
      trainer: trainingObjectiveTrainer(trainer),
    };
  }
  const safelyTrainableCandidates = encounterCandidates.filter(
    ({ riskTier }) => riskTier <= 1,
  );
  const candidates = safelyTrainableCandidates.length > 0
    ? safelyTrainableCandidates
    : encounterCandidates;
  const selectingSafeEncounter = safelyTrainableCandidates.length > 0;
  candidates.sort((left, right) =>
    (selectingSafeEncounter
      ? riskClass(left)-riskClass(right) || rateScore(right)-rateScore(left) || compareExpectedTrainingExperience(left, right) ||
        right.encounter.maximumWildLevel - left.encounter.maximumWildLevel ||
        right.encounter.minimumWildLevel - left.encounter.minimumWildLevel ||
        left.riskTier - right.riskTier
      : left.encounter.maximumWildLevel - right.encounter.maximumWildLevel) ||
    left.metrics.transitions - right.metrics.transitions ||
    left.encounter.trainerHazards - right.encounter.trainerHazards ||
    right.encounter.rate - left.encounter.rate ||
    left.metrics.localSteps - right.metrics.localSteps ||
    left.encounter.map.localeCompare(right.encounter.map)
  );
  const selected = candidates[0];
  if (!selected) return null;
  return {
    id: trainingKind,
    target: selected.target,
    currentTeamAnchorLevel: currentLevel,
    minimumTeamAnchorLevel: requiredLevel,
      ...(objective?.importantBattle ? {trainingRotation:"one-level"} : {}),
    trainingPartySlot: trainingParty[0]?.slot ?? null,
    ...(expShareTrainingMember ? {
      expSharePartySlot: expShareTrainingMember.slot ?? null,
      trainingPartySlots: Object.freeze([
        trainingParty[0]?.slot,
        ...(
          Number(expShareTrainingMember.slot) === Number(trainingParty[0]?.slot)
            ? []
            : [expShareTrainingMember.slot]
        ),
      ]),
    } : {}),
    trainingSpecies: trainingParty[0]?.species ?? null,
    ...(selected.trainingRate.matchupKnown&&selected.trainingRate.viable?{trainingRate:selected.trainingRate}:{}),
    forObjective,
    ...(selected.trainingMethod !== "direct"
      ? { trainingMethod: selected.trainingMethod }
      : {}),
    ...(healthyTrainingEscort ? {
      escortPartySlot: healthyTrainingEscort.slot,
      escortSpecies: healthyTrainingEscort.species,
    } : {}),
    encounter: {
      rate: selected.encounter.rate,
      minimumWildLevel: selected.encounter.minimumWildLevel,
      maximumWildLevel: selected.encounter.maximumWildLevel,
    },
  };
}

const POKEMON_MANSION_MAPS = new Set([
  "MAP_POKEMON_MANSION_1F",
  "MAP_POKEMON_MANSION_2F",
  "MAP_POKEMON_MANSION_3F",
  "MAP_POKEMON_MANSION_B1F",
]);

function mansionTargets(mapId, { keyAcquired, switchSet }) {
  const warp = (index) => ({ kind: "warp", map: mapId, index });
  const background = (index) => ({ kind: "background", map: mapId, index });
  if (!keyAcquired) {
    if (mapId === "MAP_POKEMON_MANSION_1F") return [warp(4), warp(3)];
    if (mapId === "MAP_POKEMON_MANSION_2F") {
      return switchSet ? [background(0)] : [warp(0), warp(1)];
    }
    if (mapId === "MAP_POKEMON_MANSION_3F") {
      return switchSet
        ? [warp(3), warp(4), warp(6), warp(2)]
        : [background(1)];
    }
    if (mapId === "MAP_POKEMON_MANSION_B1F") {
      return [
        { kind: "object", map: mapId, index: 5 },
        switchSet ? background(1) : background(2),
      ];
    }
  }
  if (mapId === "MAP_POKEMON_MANSION_B1F") {
    return switchSet
      ? [warp(0), background(2)]
      : [background(1)];
  }
  if (mapId === "MAP_POKEMON_MANSION_1F") {
    return [warp(1), warp(5)];
  }
  if (mapId === "MAP_POKEMON_MANSION_2F") return [warp(2)];
  if (mapId === "MAP_POKEMON_MANSION_3F") {
    return [warp(3), warp(4), warp(6), warp(0), warp(1), warp(2)];
  }
  return [];
}

function mansionRecommendation({ world, observation, objective }) {
  const mapId = observation?.playerMemory?.map?.id;
  if (!POKEMON_MANSION_MAPS.has(mapId)) {
    if (objective?.target?.kind !== "mansion-secret-key") return null;
    const cinnabarMap = (worldData(world).maps ?? []).find(
      ({ id }) => id === "MAP_CINNABAR_ISLAND",
    );
    const lockedGymTriggerIndex = (cinnabarMap?.coordEvents ?? []).findIndex(
      ({ script }) => script === "CinnabarIsland_EventScript_GymDoorLocked",
    );
    const recommendation = campaignNavigationRecommendation({
      world,
      observation,
      objective: {
        ...objective,
        mansionConcrete: true,
        avoidTargets: [
          ...(objective.avoidTargets ?? []),
          ...(lockedGymTriggerIndex >= 0 ? [{
            kind: "trigger",
            map: "MAP_CINNABAR_ISLAND",
            index: lockedGymTriggerIndex,
          }] : []),
        ],
        target: { kind: "warp", map: "MAP_CINNABAR_ISLAND", index: 0 },
      },
    });
    return recommendation
      ? {
          ...recommendation,
          objective: objective.id,
          targetMap: objective.target.map,
          mansionPhase: "enter",
        }
      : null;
  }
  const keyAcquired = watchedFlag(observation, 424);
  if (!keyAcquired && objective?.target?.kind !== "mansion-secret-key") {
    return null;
  }
  const switchSet = watchedFlag(observation, 620);
  for (const target of mansionTargets(mapId, { keyAcquired, switchSet })) {
    const recommendation = campaignNavigationRecommendation({
      world,
      observation,
      objective: {
        ...objective,
        mansionConcrete: true,
        target,
      },
    });
    if (recommendation) {
      return {
        ...recommendation,
        objective: objective.id,
        targetMap: objective.target.map,
        mansionPhase: keyAcquired ? "egress" : "seek-secret-key",
      };
    }
  }
  return null;
}

function cinnabarGymRecommendation({ world, observation, objective }) {
  if (observation?.playerMemory?.map?.id === "MAP_CINNABAR_ISLAND_GYM") {
    return null;
  }
  const recommendation = campaignNavigationRecommendation({
    world,
    observation,
    objective: {
      ...objective,
      cinnabarGymConcrete: true,
      target: { kind: "warp", map: "MAP_CINNABAR_ISLAND", index: 1 },
    },
  });
  return recommendation
    ? {
        ...recommendation,
        objective: objective.id,
        targetMap: objective.target.map,
        cinnabarGymPhase: "enter",
      }
    : null;
}

function ceruleanRocketRecommendation({ world, observation, objective }) {
  const mapId = observation?.playerMemory?.map?.id;
  const candidates = mapId === "MAP_CERULEAN_CITY"
    ? [
        { phase: "rocket-trigger", target: { kind: "trigger", map: mapId, index: 4 } },
        { phase: "rocket-trigger", target: { kind: "trigger", map: mapId, index: 3 } },
        { phase: "enter-robbed-house", target: { kind: "warp", map: mapId, index: 1 } },
      ]
    : mapId === "MAP_CERULEAN_CITY_HOUSE2"
      ? [{
          phase: "leave-through-back",
          target: { kind: "warp", map: mapId, index: 3 },
        }]
      : [{
          phase: "return-to-cerulean",
          target: { kind: "warp", map: "MAP_CERULEAN_CITY", index: 1 },
        }];
  for (const candidate of candidates) {
    const recommendation = campaignNavigationRecommendation({
      world,
      observation,
      objective: {
        ...objective,
        ceruleanConcrete: true,
        target: candidate.target,
      },
    });
    if (recommendation) {
      return {
        ...recommendation,
        objective: objective.id,
        targetMap: objective.target.map,
        ceruleanPhase: candidate.phase,
      };
    }
  }
  return null;
}

function ceruleanPassageRecommendation({ world, observation, objective }) {
  const mapId = observation?.playerMemory?.map?.id;
  if (mapId === "MAP_CERULEAN_CITY_HOUSE2") {
    const recommendation = campaignNavigationRecommendation({
      world,
      observation,
      objective: {
        ...objective,
        ceruleanPassageConcrete: true,
        target: { kind: "warp", map: mapId, index: 3 },
      },
    });
    return recommendation
      ? {
          ...recommendation,
          objective: objective.id,
          targetMap: objective.target.map,
          ceruleanPhase: "leave-through-back",
        }
      : null;
  }
  const direct = campaignNavigationRecommendation({
    world,
    observation,
    objective: { ...objective, ceruleanPassageConcrete: true },
  });
  if (direct || mapId !== "MAP_CERULEAN_CITY") return direct;
  const recommendation = campaignNavigationRecommendation({
    world,
    observation,
    objective: {
      ...objective,
      ceruleanPassageConcrete: true,
      target: { kind: "warp", map: mapId, index: 1 },
    },
  });
  return recommendation
    ? {
        ...recommendation,
        objective: objective.id,
        targetMap: objective.target.map,
        ceruleanPhase: "enter-robbed-house",
      }
    : null;
}

function rocketHideoutElevatorRecommendation({ world, observation, objective }) {
  const mapId = observation?.playerMemory?.map?.id;
  const elevatorMap = "MAP_ROCKET_HIDEOUT_ELEVATOR";
  let target;
  let phase;

  if (mapId === elevatorMap) {
    const selectedFloor = Number(
      observation?.playerMemory?.storyState?.variableIds?.[0x403a],
    );
    if (watchedFlag(observation, 2) && selectedFloor === 0) {
      target = { kind: "warp", map: elevatorMap, index: 1 };
      phase = "exit-elevator-on-b4f";
    } else {
      target = { kind: "background", map: elevatorMap, index: 0 };
      phase = "select-b4f";
    }
  } else {
    if (mapId === objective.target.map) {
      const direct = campaignNavigationRecommendation({
        world,
        observation,
        objective: { ...objective, rocketHideoutConcrete: true },
      });
      if (direct && !direct.transit) return direct;
    }
    const approach = ROCKET_HIDEOUT_ELEVATOR_APPROACH[mapId];
    if (approach) {
      target = { kind: "warp", map: mapId, index: approach.warpIndex };
      phase = approach.phase;
    } else {
      const direct = campaignNavigationRecommendation({
        world,
        observation,
        objective: { ...objective, rocketHideoutConcrete: true },
      });
      if (direct) return direct;
      target = { kind: "warp", map: "MAP_ROCKET_HIDEOUT_B2F", index: 3 };
      phase = "reach-elevator";
    }
  }

  const recommendation = campaignNavigationRecommendation({
    world,
    observation,
    objective: {
      ...objective,
      rocketHideoutConcrete: true,
      target,
    },
  });
  return recommendation
    ? {
        ...recommendation,
        objective: objective.id,
        targetMap: objective.target.map,
        rocketHideoutPhase: phase,
      }
    : null;
}

function rocketHideoutExitRecommendation({ world, observation, objective }) {
  const mapId = observation?.playerMemory?.map?.id;
  const elevatorMap = "MAP_ROCKET_HIDEOUT_ELEVATOR";
  let target;
  let phase;

  if (mapId === elevatorMap) {
    const selectedFloor = Number(
      observation?.playerMemory?.storyState?.variableIds?.[0x403a],
    );
    if (watchedFlag(observation, 2) && selectedFloor === 3) {
      target = { kind: "warp", map: elevatorMap, index: 1 };
      phase = "exit-elevator-on-b1f";
    } else {
      target = { kind: "background", map: elevatorMap, index: 0 };
      phase = "select-b1f";
    }
  } else if (mapId === "MAP_ROCKET_HIDEOUT_B1F") {
    target = { kind: "warp", map: mapId, index: 0 };
    phase = "leave-hideout";
  } else {
    target = { kind: "warp", map: "MAP_ROCKET_HIDEOUT_B4F", index: 1 };
    phase = "enter-elevator";
  }

  let recommendation = campaignNavigationRecommendation({
    world,
    observation,
    objective: {
      ...objective,
      rocketHideoutExitConcrete: true,
      target,
    },
  });
  if (!recommendation && mapId === "MAP_ROCKET_HIDEOUT_B1F") {
    target = { kind: "object", map: mapId, index: 4 };
    phase = "clear-b1-security-barrier";
    recommendation = campaignNavigationRecommendation({
      world,
      observation,
      objective: {
        ...objective,
        rocketHideoutExitConcrete: true,
        target,
      },
    });
  }
  return recommendation
    ? {
        ...recommendation,
        objective: objective.id,
        targetMap: objective.target.map,
        rocketHideoutPhase: phase,
      }
    : null;
}

function silphCoFloorNumber(mapId) {
  const match = /^MAP_SILPH_CO_(\d+)F$/.exec(String(mapId ?? ""));
  if (!match) return null;
  const floor = Number(match[1]);
  return Number.isSafeInteger(floor) && floor >= 1 && floor <= 11
    ? floor
    : null;
}

function silphCoElevatorRecommendation({ world, observation, objective } = {}) {
  const elevatorMap = "MAP_SILPH_CO_ELEVATOR";
  if (observation?.playerMemory?.map?.id !== elevatorMap) return null;
  const destinationFloor = silphCoFloorNumber(objective?.target?.map) ?? 1;
  const selectedFloor = Number(
    observation?.playerMemory?.storyState?.variableIds?.[0x403a],
  );
  // The source floor is already stored as the elevator's dynamic return warp.
  // Selecting that same floor skips AnimateElevator, so FLAG_TEMP_2 stays clear
  // even though the requested dynamic exit is ready.
  const selectionApplied = selectedFloor === destinationFloor + 3;
  const target = selectionApplied
    ? { kind: "warp", map: elevatorMap, index: 0 }
    : { kind: "background", map: elevatorMap, index: 0 };
  const recommendation = campaignNavigationRecommendation({
    world,
    observation,
    objective: {
      ...objective,
      silphCoElevatorConcrete: true,
      target,
    },
  });
  return recommendation
    ? {
        ...recommendation,
        objective: objective.id,
        targetMap: objective.target.map,
        silphCoElevatorFloor: destinationFloor,
        silphCoElevatorPhase: selectionApplied
          ? `exit-on-${destinationFloor}f`
          : `select-${destinationFloor}f`,
      }
    : null;
}

function silphCoWarpRecommendation({
  world,
  observation,
  objective,
  map,
  blocked,
  warpIndex,
} = {}) {
  const warp = map?.warpEvents?.[warpIndex];
  if (!warp) return null;
  const activation = warpActivation(map, warp);
  const position = observation?.playerMemory?.position;
  if (
    activation.kind === "traverse-map-warp" &&
    Number(position?.x) === activation.x &&
    Number(position?.y) === activation.y
  ) {
    const direction = automaticWarpReentryDirection(map, activation, blocked);
    return direction
      ? {
          kind: "reenter-map-warp",
          direction,
          objective: objective.id,
          targetMap: objective.target.map,
          transit: {
            kind: "warp",
            destinationMap: warp.dest_map,
            x: Number(warp.x),
            y: Number(warp.y),
          },
          remainingSteps: 0,
        }
      : null;
  }
  const recommendation = campaignNavigationRecommendation({
    world,
    observation,
    objective: {
      ...objective,
      silphCoConcrete: true,
      target: { kind: "warp", map: map.id, index: warpIndex },
    },
  });
  if (
    recommendation?.target?.kind !== "warp" ||
    Number(recommendation.target.index) !== Number(warpIndex)
  ) return null;
  const { target: ignoredTarget, ...route } = recommendation;
  return {
    ...route,
    objective: objective.id,
    targetMap: objective.target.map,
    transit: {
      kind: "warp",
      destinationMap: warp.dest_map,
      x: Number(warp.x),
      y: Number(warp.y),
    },
  };
}

function silphCoDoorRecommendation({
  world,
  observation,
  objective,
  map,
  staticMap,
  blocked,
  interactive,
  capabilities,
} = {}) {
  const mapId = observation?.playerMemory?.map?.id;
  if (
    silphCoFloorNumber(mapId) === null ||
    objective?.target?.map !== mapId ||
    !bagHasItem(observation, 355)
  ) return null;

  const targetCoordinatesSet = new Set(
    targetCoordinates(map, objective.target).map(({ x, y }) => `${x},${y}`),
  );
  if (
    targetCoordinatesSet.size === 0 ||
    localRoute(
      map,
      observation.playerMemory.position,
      targetCoordinatesSet,
      blocked,
      interactive,
      capabilities,
    )
  ) return null;

  const staticCells = new Map(
    (staticMap?.layout?.cells ?? []).map((cell) => [`${cell.x},${cell.y}`, cell]),
  );
  const doorGroups = new Map();
  for (const [index, event] of (map?.backgroundEvents ?? []).entries()) {
    if (!/^SilphCo_\d+F_EventScript_Door\d+$/.test(event?.script ?? "")) {
      continue;
    }
    if (!doorGroups.has(event.script)) doorGroups.set(event.script, []);
    doorGroups.get(event.script).push({ index, event });
  }
  const liveCells = new Map(
    (map?.layout?.cells ?? []).map((cell) => [`${cell.x},${cell.y}`, cell]),
  );
  const doors = [...doorGroups.values()].flatMap((events) => {
    const coordinates = new Set(
      events.map(({ event }) => `${Number(event.x)},${Number(event.y)}`),
    );
    const closed = [...coordinates].some((coordinate) => {
      const liveCell = liveCells.get(coordinate);
      const staticCell = staticCells.get(coordinate);
      return Number(liveCell?.collision) !== Number(staticCell?.collision);
    });
    return closed ? [{
      coordinates,
      target: { kind: "background", map: mapId, index: events[0].index },
    }] : [];
  }).sort((left, right) => left.target.index - right.target.index);
  if (doors.length === 0) return null;

  const mapWithOpenedDoors = (opened) => ({
    ...map,
    layout: {
      ...map.layout,
      cells: (map.layout?.cells ?? []).map((cell) => {
        const coordinate = `${Number(cell.x)},${Number(cell.y)}`;
        const opens = doors.some((door, index) =>
          opened.has(index) && door.coordinates.has(coordinate)
        );
        return opens
          ? { ...cell, ...(staticCells.get(coordinate) ?? {}) }
          : cell;
      }),
    },
  });
  const queue = [{ opened: new Set(), firstDoor: null }];
  const visited = new Set([""]);
  let selected = null;
  for (let cursor = 0; cursor < queue.length && !selected; cursor += 1) {
    const state = queue[cursor];
    const routedMap = mapWithOpenedDoors(state.opened);
    const targetRoute = localRoute(
      routedMap,
      observation.playerMemory.position,
      new Set(
        targetCoordinates(routedMap, objective.target)
          .map(({ x, y }) => `${x},${y}`),
      ),
      blocked,
      interactive,
      capabilities,
    );
    if (targetRoute && state.firstDoor) {
      selected = state.firstDoor;
      break;
    }
    const reachableDoors = doors.flatMap((door, index) => {
      if (state.opened.has(index)) return [];
      const route = localRoute(
        routedMap,
        observation.playerMemory.position,
        new Set(
          targetCoordinates(routedMap, door.target)
            .map(({ x, y }) => `${x},${y}`),
        ),
        blocked,
        interactive,
        capabilities,
      );
      return route ? [{ door, index, route }] : [];
    }).sort((left, right) =>
      left.route.distance - right.route.distance ||
      left.door.target.index - right.door.target.index
    );
    for (const candidate of reachableDoors) {
      const opened = new Set(state.opened);
      opened.add(candidate.index);
      const signature = [...opened].sort((left, right) => left - right).join(",");
      if (visited.has(signature)) continue;
      visited.add(signature);
      queue.push({
        opened,
        firstDoor: state.firstDoor ?? candidate.door.target,
      });
    }
  }
  if (!selected) return null;
  const recommendation = campaignNavigationRecommendation({
    world,
    observation,
    objective: {
      ...objective,
      silphCoConcrete: true,
      target: selected,
    },
  });
  return recommendation
    ? {
        ...recommendation,
        objective: objective.id,
        targetMap: objective.target.map,
      }
    : null;
}

function silphCoFloorRouteRecommendation({
  world,
  observation,
  objective,
  map,
  blocked,
  interactive,
  capabilities,
  graph,
} = {}) {
  const mapId = observation?.playerMemory?.map?.id;
  const currentFloor = silphCoFloorNumber(mapId);
  const targetFloor = silphCoFloorNumber(objective?.target?.map);
  if (currentFloor === null) return null;

  if (currentFloor === targetFloor) {
    const targetCoordinatesSet = new Set(
      targetCoordinates(map, objective?.target).map(({ x, y }) => `${x},${y}`),
    );
    if (
      targetCoordinatesSet.size === 0 ||
      localRoute(
        map,
        observation.playerMemory.position,
        targetCoordinatesSet,
        blocked,
        interactive,
        capabilities,
      )
    ) return null;

    // A Silph teleporter can divide one floor even though both sides share the
    // same static collision component. Leave through the pad, return through
    // its paired destination, then continue from the far side of the barrier.
    const shuttleRoutes = (map?.warpEvents ?? []).flatMap((warp, index) => {
      if (
        warpBehavior(map, warp) !== "MB_REGULAR_WARP" ||
        silphCoFloorNumber(warp.dest_map) === null
      ) return [];
      const destinationMap = graph?.maps?.get(warp.dest_map);
      const destinationWarpIndex = Number(warp.dest_warp_id);
      const returnWarp = Number.isSafeInteger(destinationWarpIndex)
        ? destinationMap?.warpEvents?.[destinationWarpIndex]
        : null;
      if (
        !returnWarp ||
        warpBehavior(destinationMap, returnWarp) !== "MB_REGULAR_WARP" ||
        returnWarp.dest_map !== mapId ||
        Number(returnWarp.dest_warp_id) !== index
      ) return [];
      const activation = warpActivation(map, warp);
      const routeAfterReturn = localRoute(
        map,
        activation,
        targetCoordinatesSet,
        blocked,
        interactive,
        capabilities,
      );
      if (!routeAfterReturn) return [];
      const route = silphCoWarpRecommendation({
        world,
        observation,
        objective,
        map,
        blocked,
        warpIndex: index,
      });
      return route ? [{ route, routeAfterReturn, index }] : [];
    });
    shuttleRoutes.sort((left, right) =>
      Number(left.route.remainingSteps ?? Infinity) -
        Number(right.route.remainingSteps ?? Infinity) ||
      Number(left.routeAfterReturn.steps ?? Infinity) -
        Number(right.routeAfterReturn.steps ?? Infinity) ||
      left.index - right.index
    );
    return shuttleRoutes[0]?.route ?? null;
  }

  const targetMap = graph?.maps?.get(objective?.target?.map);
  const targetComponents = new Set(
    targetCoordinates(targetMap, objective?.target).flatMap((coordinate) => {
      const component = graph?.componentAt(objective?.target?.map, coordinate);
      return component === undefined ? [] : [component];
    }),
  );
  const landsInTargetComponent = (warp) => {
    if (targetComponents.size === 0) return true;
    const destinationWarpIndex = Number(warp?.dest_warp_id);
    const destinationWarp = Number.isSafeInteger(destinationWarpIndex)
      ? targetMap?.warpEvents?.[destinationWarpIndex]
      : null;
    const landing = landingForWarp(targetMap, destinationWarp);
    const component = graph?.componentAt(objective?.target?.map, landing);
    return component !== undefined && targetComponents.has(component);
  };
  const targetFloorTeleporterRoutes = targetFloor === null ? [] : (map?.warpEvents ?? []).flatMap(
    (warp, index) => {
      const behavior = warpBehavior(map, warp) ?? "";
      if (
        silphCoFloorNumber(warp.dest_map) !== targetFloor ||
        /_STAIR_WARP$/.test(behavior) ||
        !isActivatingWarp(map, warp) ||
        !landsInTargetComponent(warp)
      ) return [];
      const route = silphCoWarpRecommendation({
        world,
        observation,
        objective,
        map,
        blocked,
        warpIndex: index,
      });
      return route ? [{ route, index }] : [];
    },
  );
  targetFloorTeleporterRoutes.sort((left, right) =>
    Number(left.route.remainingSteps ?? Infinity) -
      Number(right.route.remainingSteps ?? Infinity) ||
    left.index - right.index
  );
  if (targetFloorTeleporterRoutes[0]) {
    return targetFloorTeleporterRoutes[0].route;
  }

  const floorDirection = targetFloor === null
    ? null
    : Math.sign(targetFloor - currentFloor);
  const targetAdjacentFloor = floorDirection === null
    ? null
    : targetFloor - floorDirection;
  const targetAdjacentMap = targetAdjacentFloor === null
    ? null
    : graph?.maps?.get(`MAP_SILPH_CO_${targetAdjacentFloor}F`);
  const targetFloorStairs = (targetAdjacentMap?.warpEvents ?? []).filter((warp) =>
    warp.dest_map === objective.target.map &&
    /_STAIR_WARP$/.test(warpBehavior(targetAdjacentMap, warp) ?? "")
  );
  if (
    targetFloorStairs.length > 0 &&
    !targetFloorStairs.some(landsInTargetComponent)
  ) return null;

  const nextFloor = targetFloor === null
    ? currentFloor - 1
    : currentFloor + Math.sign(targetFloor - currentFloor);
  if (nextFloor < 1) return null;
  const warpIndex = (map?.warpEvents ?? []).findIndex((warp) =>
    silphCoFloorNumber(warp.dest_map) === nextFloor &&
    /_STAIR_WARP$/.test(warpBehavior(map, warp) ?? "")
  );
  const stairRoute = warpIndex < 0
    ? null
    : silphCoWarpRecommendation({
        world,
        observation,
        objective,
        map,
        blocked,
        warpIndex,
      });
  if (stairRoute) return stairRoute;

  const teleporterRoutes = (map?.warpEvents ?? []).flatMap((warp, index) => {
    const destinationFloor = silphCoFloorNumber(warp.dest_map);
    const behavior = warpBehavior(map, warp) ?? "";
    if (
      destinationFloor === null || destinationFloor === currentFloor ||
      /_STAIR_WARP$/.test(behavior) || !isActivatingWarp(map, warp)
    ) return [];
    const route = silphCoWarpRecommendation({
      world,
      observation,
      objective,
      map,
      blocked,
      warpIndex: index,
    });
    return route
      ? [{
          route,
          index,
          returnsThroughLandingPad: route.kind === "reenter-map-warp",
        }]
      : [];
  });
  teleporterRoutes.sort((left, right) =>
    Number(left.returnsThroughLandingPad) -
      Number(right.returnsThroughLandingPad) ||
    Number(left.route.remainingSteps ?? Infinity) -
      Number(right.route.remainingSteps ?? Infinity) ||
    left.index - right.index
  );
  return teleporterRoutes[0]?.route ?? null;
}

const VICTORY_ROAD_MAPS = new Set([
  "MAP_VICTORY_ROAD_1F",
  "MAP_VICTORY_ROAD_2F",
  "MAP_VICTORY_ROAD_3F",
]);
const VICTORY_ROAD_SHUTTLE_MAPS = new Set([
  "MAP_VICTORY_ROAD_2F",
  "MAP_VICTORY_ROAD_3F",
]);
const VICTORY_ROAD_THIRD_FLOOR_RETURN_PASSAGE = Object.freeze({
  id: "victory-road-third-floor-return-passage",
  target: Object.freeze({
    kind: "push-boulder",
    map: "MAP_VICTORY_ROAD_3F",
    objectIndex: 8,
    x: 33,
    y: 13,
  }),
  authoredBoulderPath: Object.freeze(authoredBoulderPath(35, 13, [["west", 2]])),
});
const VICTORY_ROAD_SECOND_FLOOR_RETURN_PASSAGE = Object.freeze({
  id: "victory-road-second-floor-return-passage",
  target: Object.freeze({kind: "push-boulder", map: "MAP_VICTORY_ROAD_2F",
    objectIndex: 9, x: 8, y: 8}),
  authoredBoulderPath: Object.freeze(authoredBoulderPath(8, 7, [["south", 1]])),
});
const VICTORY_ROAD_FIRST_FLOOR_RETURN_PASSAGE = Object.freeze({
  id: "victory-road-first-floor-return-passage",
  target: Object.freeze({kind: "push-boulder", map: "MAP_VICTORY_ROAD_1F",
    objectIndex: 5, x: 4, y: 14}),
  authoredBoulderPath: Object.freeze(authoredBoulderPath(4, 12, [["south", 2]])),
});

function victoryRoadPuzzleObjective(id) {
  return MAIN_STORY_CAMPAIGN.objectives.find((objective) => objective.id === id) ?? null;
}

function victoryRoadRelabelRecommendation(recommendation, objective, phase) {
  return recommendation
    ? {
        ...recommendation,
        objective: objective.id,
        targetMap: objective.target.map,
        victoryRoadPhase: phase,
      }
    : null;
}

function victoryRoadWarpRecommendation({
  world,
  observation,
  objective,
  map,
  blocked,
  warpIndex,
  phase,
} = {}) {
  const warp = map?.warpEvents?.[warpIndex];
  if (!warp || !isActivatingWarp(map, warp)) return null;
  const activation = warpActivation(map, warp);
  const position = observation?.playerMemory?.position;
  if (
    warpBehavior(map, warp) !== "MB_FALL_WARP" &&
    activation.kind === "traverse-map-warp" &&
    Number(position?.x) === activation.x &&
    Number(position?.y) === activation.y
  ) {
    const direction = automaticWarpReentryDirection(map, activation, blocked);
    return direction
      ? victoryRoadRelabelRecommendation({
          kind: "reenter-map-warp",
          direction,
          transit: {
            kind: "warp",
            destinationMap: warp.dest_map,
            x: Number(warp.x),
            y: Number(warp.y),
          },
          remainingSteps: 0,
        }, objective, phase)
      : null;
  }
  const recommendation = campaignNavigationRecommendation({
    world,
    observation,
    objective: {
      ...objective,
      victoryRoadConcrete: true,
      target: { kind: "warp", map: map.id, index: warpIndex },
    },
  });
  if (
    recommendation?.target?.kind !== "warp" ||
    Number(recommendation.target.index) !== Number(warpIndex)
  ) return null;
  return victoryRoadRelabelRecommendation({
    ...recommendation,
    transit: {
      kind: "warp",
      destinationMap: warp.dest_map,
      x: Number(warp.x),
      y: Number(warp.y),
    },
  }, objective, phase);
}

function victoryRoadCanReachWarp({
  map,
  observation,
  blocked,
  interactive,
  capabilities,
  warpIndex,
} = {}) {
  const warp = map?.warpEvents?.[warpIndex];
  if (!warp || !isActivatingWarp(map, warp)) return false;
  const activation = warpActivation(map, warp);
  return Boolean(localRoute(
    map,
    observation?.playerMemory?.position,
    new Set([`${activation.x},${activation.y}`]),
    blocked,
    interactive,
    capabilities,
  ));
}

function victoryRoadBoulderRecommendation({
  world,
  observation,
  objective,
  puzzleId,
  phase,
} = {}) {
  const puzzle = victoryRoadPuzzleObjective(puzzleId);
  if (!puzzle) return null;
  const recommendation = campaignNavigationRecommendation({
    world,
    observation,
    objective: { ...puzzle, victoryRoadConcrete: true },
  });
  return victoryRoadRelabelRecommendation(recommendation, objective, phase);
}

function victoryRoadReturnPassageRecommendation({
  map,
  observation,
  objective,
} = {}) {
  const passage = map.id === "MAP_VICTORY_ROAD_1F" ? VICTORY_ROAD_FIRST_FLOOR_RETURN_PASSAGE :
    map.id === "MAP_VICTORY_ROAD_2F" ? VICTORY_ROAD_SECOND_FLOOR_RETURN_PASSAGE :
      VICTORY_ROAD_THIRD_FLOOR_RETURN_PASSAGE;
  return victoryRoadRelabelRecommendation(boulderRecommendation({
    map,
    observation,
    objective: passage,
  }), objective, passage.id.replace("victory-road-", "open-"));
}

function victoryRoadTargetSide(graph, target, observation) {
  if (
    target?.map?.startsWith("MAP_INDIGO_PLATEAU") ||
    target?.map?.startsWith("MAP_POKEMON_LEAGUE_")
  ) return "north";
  const targetMap = graph?.maps?.get(target?.map);
  if (!targetMap) return null;
  if (!VICTORY_ROAD_MAPS.has(target.map)) {
    // Route 23 has disconnected north and south approaches. Choose the exit
    // using the same destination regions as ordinary navigation, or the two
    // planners can repeatedly send the player back through the north doorway.
    // Compare the same 2F regions on every floor so the return shuttle keeps
    // its direction through map transitions and controller reconstruction.
    const secondFloor = graph.maps.get("MAP_VICTORY_ROAD_2F");
    const distanceFrom = campaignRegionTransitionDistanceLookup({graph, observation, target});
    const distance = (index) => {
      const warp = secondFloor?.warpEvents?.[index];
      return warp ? distanceFrom({map: secondFloor.id, position: warpActivation(secondFloor, warp)}) : null;
    };
    const main = distance(2), north = distance(3);
    if (Number.isSafeInteger(main) && (!Number.isSafeInteger(north) || main < north)) return "main";
    return "north";
  }
  const targetComponents = new Set(
    targetCoordinates(targetMap, target).flatMap((coordinate) => {
      const component = graph.componentAt(target.map, coordinate);
      return component === undefined ? [] : [component];
    }),
  );
  if (target.map === "MAP_VICTORY_ROAD_3F") {
    const mainWarp = targetMap.warpEvents?.[1];
    const northWarp = targetMap.warpEvents?.[2];
    const mainComponent = graph.componentAt(target.map, warpActivation(targetMap, mainWarp));
    const northComponent = graph.componentAt(
      target.map,
      warpActivation(targetMap, northWarp),
    );
    if (targetComponents.has(mainComponent)) return "main";
    if (targetComponents.has(northComponent)) return "north";
  }
  if (target.map === "MAP_VICTORY_ROAD_2F") {
    const mainWarp = targetMap.warpEvents?.[2];
    const northWarp = targetMap.warpEvents?.[3];
    const mainComponent = graph.componentAt(target.map, warpActivation(targetMap, mainWarp));
    const northComponent = graph.componentAt(
      target.map,
      warpActivation(targetMap, northWarp),
    );
    if (targetComponents.has(mainComponent)) return "main";
    if (targetComponents.has(northComponent)) return "north";
  }
  return null;
}

function victoryRoadTransitRecommendation({
  world,
  observation,
  objective,
  map,
  blocked,
  interactive,
  capabilities,
  graph,
} = {}) {
  const mapId = observation?.playerMemory?.map?.id;
  if (!VICTORY_ROAD_MAPS.has(mapId)) return null;
  const boulderPuzzle = objective?.target?.kind === "push-boulder";
  if (boulderPuzzle && mapId === objective.target.map) {
    // Healing can return to the opposite side of a reset passage. Keep an
    // executable puzzle's authored pushes; otherwise reopen its approach using
    // the same transit planner as every other destination.
    const direct = boulderRecommendation({ map, observation, objective });
    if (direct) return direct;
  }
  if (!boulderPuzzle && mapId === objective.target.map) {
    const localTarget = localRoute(
      map,
      observation.playerMemory.position,
      new Set(
        targetCoordinates(map, objective.target).map(({ x, y }) => `${x},${y}`),
      ),
      blocked,
      interactive,
      capabilities,
    );
    if (localTarget) return null;
  }
  const side = victoryRoadTargetSide(graph, objective.target, observation);
  if (!side) return null;
  const kantoDestination = !VICTORY_ROAD_MAPS.has(objective.target.map) &&
    objective.target.map !== "MAP_ROUTE23" &&
    !objective.target.map.startsWith("MAP_INDIGO_PLATEAU") &&
    !objective.target.map.startsWith("MAP_POKEMON_LEAGUE_");
  const warp = (warpIndex, phase) => victoryRoadWarpRecommendation({
    world,
    observation,
    objective,
    map,
    blocked,
    warpIndex,
    phase,
  });
  const canReach = (warpIndex) => victoryRoadCanReachWarp({
    map,
    observation,
    blocked,
    interactive,
    capabilities,
    warpIndex,
  });

  if ((side === "main" || kantoDestination) && mapId === "MAP_VICTORY_ROAD_1F" && !VICTORY_ROAD_MAPS.has(objective.target.map)) {
    if (canReach(1)) return warp(1, "exit-south");
    return victoryRoadReturnPassageRecommendation({map, observation, objective});
  }

  if (kantoDestination && mapId === "MAP_VICTORY_ROAD_2F" && canReach(0)) {
    return warp(0, "leave-second-floor-to-south");
  }

  if (side === "north" && mapId === "MAP_VICTORY_ROAD_1F") {
    if (Number(observation?.playerMemory?.storyState?.variableIds?.[0x4064] ?? 0) < 100) {
      const firstSwitch = victoryRoadBoulderRecommendation({
        world,
        observation,
        objective,
        puzzleId: "victory-road-first-floor-switch",
        phase: "open-first-floor-north-gate",
      });
      if (firstSwitch) return firstSwitch;
    }
    return warp(0, "take-north-ladder");
  }

  if (side === "north" && mapId === "MAP_VICTORY_ROAD_2F") {
    if (Number(observation?.playerMemory?.storyState?.variableIds?.[0x4065] ?? 0) < 100) {
      const firstSwitch = victoryRoadBoulderRecommendation({
        world,
        observation,
        objective,
        puzzleId: "victory-road-second-floor-switch-one",
        phase: "open-second-floor-main-gate",
      });
      if (firstSwitch) return firstSwitch;
    }
    if (
      !watchedFlag(observation, 0x58) &&
      Number(observation?.playerMemory?.storyState?.variableIds?.[0x4066] ?? 0) < 100
    ) {
      const finalSwitch = victoryRoadBoulderRecommendation({
        world,
        observation,
        objective,
        puzzleId: "victory-road-second-floor-switch-two",
        phase: "open-second-floor-north-gate",
      });
      if (finalSwitch) return finalSwitch;
    }
    return warp(6, "exit-north") ??
      warp(4, "leave-final-switch-pocket") ??
      warp(2, "return-to-third-floor-switch");
  }
  if (side === "north" && mapId === "MAP_VICTORY_ROAD_3F") {
    const northLadder = warp(2, "take-north-ladder");
    if (northLadder) return northLadder;
    if (canReach(1)) {
      if (
        Number(observation?.playerMemory?.storyState?.variableIds?.[0x4067] ?? 0) < 100
      ) {
        return victoryRoadBoulderRecommendation({
          world,
          observation,
          objective,
          puzzleId: "victory-road-third-floor-switch",
          phase: "open-third-floor-north-gate",
        });
      }
      if (watchedFlag(observation, 0x58)) {
        return victoryRoadBoulderRecommendation({
          world,
          observation,
          objective,
          puzzleId: "victory-road-drop-boulder",
          phase: "drop-northbound-boulder",
        });
      }
      return warp(4, "follow-northbound-boulder");
    }
    return null;
  }
  if (side === "main" && mapId === "MAP_VICTORY_ROAD_2F") {
    // Finish the return through its locally verified southern ladder. The
    // static graph can still prefer 3F -> central 2F behind a reset barrier.
    if (!VICTORY_ROAD_MAPS.has(objective.target.map) && canReach(0)) {
      return warp(0, "leave-second-floor-to-south");
    }
    if (!VICTORY_ROAD_MAPS.has(objective.target.map) && canReach(1)) {
      return victoryRoadReturnPassageRecommendation({map, observation, objective});
    }
    return warp(2, "enter-third-floor-main-room") ??
      warp(3, "enter-third-floor-return-room") ??
      warp(4, "leave-final-switch-pocket");
  }
  if (side === "main" && mapId === "MAP_VICTORY_ROAD_3F") {
    if (canReach(1)) {
      if (!VICTORY_ROAD_MAPS.has(objective.target.map)) {
        // The central 2F ladder can land behind its reset first switch. For
        // Kanto, cross 3F to the western ladder instead of returning to that
        // same blocked room. Reopen 3F's switch if its barrier has reset too.
        if (canReach(0)) return warp(0, "take-southbound-western-ladder");
        if (Number(observation?.playerMemory?.storyState?.variableIds?.[0x4067] ?? 0) < 100) {
          return victoryRoadBoulderRecommendation({world, observation, objective,
            puzzleId: "victory-road-third-floor-switch", phase: "open-third-floor-return-gate"});
        }
      }
      return null;
    }
    if (!canReach(2) && !canReach(3)) return null;
    const returnPassage = victoryRoadReturnPassageRecommendation({
      map,
      observation,
      objective,
    });
    if (returnPassage) return returnPassage;
    if (watchedFlag(observation, 0x58)) {
      return victoryRoadBoulderRecommendation({
        world,
        observation,
        objective,
        puzzleId: "victory-road-drop-boulder",
        phase: "drop-return-boulder",
      });
    }
    return warp(4, "follow-return-boulder");
  }
  return null;
}

// Seafoam B4F's fall warps are not routes to the western island until both
// required B3F boulders fall. The cartridge's OnTransition script then stops
// the current. Derive each push from live objects so partial progress survives
// a restart, battle, or floor reload without replaying a completed drop.
export function campaignNavigationWatch(map) {
  return {flags:map==='MAP_SEAFOAM_ISLANDS_B4F'?[76,77,723]:[]};
}
function seafoamCurrentRecommendation({world, observation, objective, map}) {
  const m=observation.playerMemory,flags=m.storyState?.flagIds??{};
  const upper='MAP_SEAFOAM_ISLANDS_B3F',lower='MAP_SEAFOAM_ISLANDS_B4F';
  if(objective.seafoamConcrete||objective.target.map!==lower||![upper,lower].includes(map.id)||flags[723]===true)return null;
  const label=(r,phase)=>r?{...r,objective:objective.id,targetMap:objective.target.map,seafoamPhase:phase}:null;
  const wait=phase=>({kind:'wait-for-supported-objective',objective:objective.id,targetMap:lower,seafoamPhase:phase});
  if(typeof flags[76]!=='boolean'||typeof flags[77]!=='boolean')return wait('observe-current-boulders');
  if(map.id===lower){
    const route=campaignNavigationRecommendation({world,observation,objective:{...objective,seafoamConcrete:true,target:{kind:'warp',map:lower,index:0}}});
    return label(route,'return-to-current-puzzle')??wait('reach-current-puzzle');
  }
  if(flags[76]===false&&flags[77]===false)return null;
  const position=index=>observedObjectPosition(observation,index,map.objectEvents[index]);
  const push=(index,x,y,path,phase)=>label(boulderRecommendation({map,observation,objective:{
    id:phase,target:{kind:'push-boulder',map:upper,objectIndex:index,x,y},authoredBoulderPath:path,
  }}),phase)??wait(phase);
  if(flags[77]){
    const stone=position(2),blocker=position(3);
    if(blocker?.x===13&&blocker?.y>14)
      return push(3,13,14,authoredBoulderPath(13,16,[['north',2]]),'clear-right-boulder');
    if(stone?.x===12&&stone?.y===16)
      return push(2,12,17,authoredBoulderPath(12,16,[['south',1]]),'open-right-boulder-approach');
    if(stone?.y===17&&stone?.x>9)
      return push(2,9,17,authoredBoulderPath(12,17,[['west',3]]),'align-current-boulder');
  }
  const blocker=position(4);
  if(blocker?.y===16&&blocker?.x>4)
    return push(4,4,16,authoredBoulderPath(9,16,[['west',5]]),'clear-left-boulder');
  if(flags[76])return push(5,6,18,authoredBoulderPath(6,17,[['south',1]]),'drop-left-current-boulder');
  return push(2,9,18,authoredBoulderPath(9,17,[['south',1]]),'drop-right-current-boulder');
}

// Arrival hands control to interaction policy; it does not complete the quest.
export function campaignNavigationOutcome({world,observation,objective,recommendation}){
  const target=objective?.target,base={objective:objective?.id,target};
  if(observation.phase!=='stable'||observation.emulator?.inputReady===false||observation.emulator?.inBattle)
    return {...base,status:'temporarily-blocked',reason:'Wait for a controllable game state.'};
  const result=recommendation===undefined?campaignNavigationRecommendation({world,observation,objective}):recommendation;
  if(result&&result.kind!=='wait-for-supported-objective')return {...base,status:'action',recommendation:result};
  const data=world?.data??world,staticMap=data?.maps?.find(m=>m.id===observation.playerMemory?.map?.id);
  const map=staticMap?currentMapView(staticMap,observation):null,position=observation.playerMemory?.position;
  if(map&&map.id===target?.map&&(target.kind==='map-arrival'||targetCoordinates(map,target).some(p=>p.x===position?.x&&p.y===position?.y)))
    return {...base,status:'arrived',reason:'Navigation reached the interaction location.'};
  const routing=map?routingState(map,observation):null;
  return {...base,status:'unsupported',reason:target?'No executable route to the selected destination.':'No executable objective was selected.',
    mapRevision:map?navigationSurfaceRevision(map,routing.blocked,routing.interactive):null};
}

export function campaignNavigationRecommendation({ world, observation, objective } = {}) {
  objective = objective
    ? { ...objective, target: resolveTarget(objective.target, observation) }
    : objective;
  const mapId = observation?.playerMemory?.map?.id;
  const position = observation?.playerMemory?.position;
  const targetMap = objective?.target?.map;
  if (!mapId || !position || !targetMap) return null;
  const capabilities = worldNavigationCapabilities(observation);
  const graph = createWorldNavigationGraph(world, observation);
  const maps = graph.maps;
  const staticMap = maps.get(mapId);
  const map = currentMapView(staticMap, observation);
  if (!map) return null;
  const seafoam=seafoamCurrentRecommendation({world,observation,objective,map});
  if(seafoam)return seafoam;
  const routing = routingState(map, observation);
  const objectiveRouting = objective.target.kind === "push-boulder"
    ? { blocked: new Set(routing.blocked), interactive: new Map(routing.interactive) }
    : routingWithoutStatefulBoulders(routing.blocked, routing.interactive);
  const liveBlocked = objectiveRouting.blocked;
  const interactive = objectiveRouting.interactive;
  for (const avoided of objective.avoidTargets ?? []) {
    if (avoided?.kind !== "trigger" || avoided.map !== mapId) continue;
    for (const coordinate of targetCoordinates(map, avoided)) {
      if (
        Number(coordinate.x) !== Number(position.x) ||
        Number(coordinate.y) !== Number(position.y)
      ) liveBlocked.add(`${coordinate.x},${coordinate.y}`);
    }
  }
  if (objective.target.kind === "seagallop-destination") {
    return seagallopRecommendation({ world, observation, objective });
  }
  if (
    mapId === "MAP_SILPH_CO_ELEVATOR" &&
    !objective.silphCoElevatorConcrete
  ) {
    const silphCoElevator = silphCoElevatorRecommendation({
      world,
      observation,
      objective,
    });
    if (silphCoElevator) return silphCoElevator;
  }
  if (!objective.silphCoConcrete) {
    const silphCoDoor = silphCoDoorRecommendation({
      world,
      observation,
      objective,
      map,
      staticMap,
      blocked: liveBlocked,
      interactive,
      capabilities,
    });
    if (silphCoDoor) return silphCoDoor;
    const silphCoFloorRoute = silphCoFloorRouteRecommendation({
      world,
      observation,
      objective,
      map,
      blocked: liveBlocked,
      interactive,
      capabilities,
      graph,
    });
    if (silphCoFloorRoute) return silphCoFloorRoute;
  }
  if (!objective.victoryRoadConcrete && VICTORY_ROAD_MAPS.has(mapId)) {
    // Transit must prove the passage without treating a different puzzle's
    // boulders as freely traversable Strength interactions.
    const transitRouting = routingWithoutStatefulBoulders(liveBlocked, interactive);
    const victoryRoadTransit = victoryRoadTransitRecommendation({
      world,
      observation,
      objective,
      map,
      blocked: transitRouting.blocked,
      interactive: transitRouting.interactive,
      capabilities,
      graph,
    });
    if (victoryRoadTransit) return victoryRoadTransit;
  }
  if (objective.rocketHideoutElevator && !objective.rocketHideoutConcrete) {
    return rocketHideoutElevatorRecommendation({ world, observation, objective });
  }
  if (
    objective.target.kind === "rocket-hideout-exit" &&
    !objective.rocketHideoutExitConcrete
  ) {
    return rocketHideoutExitRecommendation({ world, observation, objective });
  }
  if (objective.ceruleanPassage && !objective.ceruleanPassageConcrete) {
    return ceruleanPassageRecommendation({ world, observation, objective });
  }
  if (!objective.ceruleanConcrete && objective.target.kind === "cerulean-rocket") {
    return ceruleanRocketRecommendation({ world, observation, objective });
  }
  const objectiveTargetsMansion = POKEMON_MANSION_MAPS.has(objective.target.map);
  if (
    !objective.mansionConcrete &&
    (
      objective.target.kind === "mansion-secret-key" ||
      (POKEMON_MANSION_MAPS.has(mapId) && !objectiveTargetsMansion)
    )
  ) {
    const mansion = mansionRecommendation({ world, observation, objective });
    if (mansion) return mansion;
  }
  if (
    !objective.cinnabarGymConcrete &&
    objective.target.map === "MAP_CINNABAR_ISLAND_GYM"
  ) {
    const cinnabarGym = cinnabarGymRecommendation({ world, observation, objective });
    if (cinnabarGym) return cinnabarGym;
  }
  if (
    mapId === targetMap &&
    objective.target.kind === "vs-seeker-activation"
  ) {
    const target = {
      kind: "vs-seeker-activation",
      x: Number(objective.target.x),
      y: Number(objective.target.y),
    };
    const routed = localRoute(
      map,
      position,
      new Set([`${target.x},${target.y}`]),
      liveBlocked,
      interactive,
      capabilities,
    );
    if (routed?.distance === 0) return null;
    // A same-map destination may require leaving through a gate and returning.
    // Keep the world-route fallback when the current region cannot reach it.
    if (routed) {
      const obstacle = obstacleRecommendation(
        routed,
        position,
        objective,
        targetMap,
        mapId,
      );
      if (obstacle) return obstacle;
      return {
        kind: "move-toward",
        direction: routed.first,
        ...pathSegmentFields(routed, position, mapId),
        objective: objective.id,
        targetMap,
        target,
        remainingSteps: routed.distance,
      };
    }
  }
  if (
    mapId === targetMap &&
    objective.target.kind === "vs-seeker-recharge"
  ) {
    const anchor = {
      x: Number(objective.target.x),
      y: Number(objective.target.y),
    };
    const atAnchor = Number(position.x) === anchor.x &&
      Number(position.y) === anchor.y;
    const currentCoordinate = `${Number(position.x)},${Number(position.y)}`;
    const warpTiles = new Set((map.warpEvents ?? []).map(({ x, y }) =>
      `${Number(x)},${Number(y)}`
    ));
    const triggerTiles = new Set((map.coordEvents ?? []).map(({ x, y }) =>
      `${Number(x)},${Number(y)}`
    ));
    const rechargeBlocked = new Set(liveBlocked);
    for (const coordinate of interactive.keys()) rechargeBlocked.add(coordinate);
    const rechargeTargets = new Set();
    for (const cell of map.layout?.cells ?? []) {
      const coordinate = `${Number(cell.x)},${Number(cell.y)}`;
      const unsafe = Number(cell.collision) !== 0 ||
        SURFABLE_BEHAVIORS.has(cell.behaviorName) ||
        warpTiles.has(coordinate) || triggerTiles.has(coordinate) ||
        rechargeBlocked.has(coordinate) ||
        Object.hasOwn(LEDGE_DIRECTIONS, cell.behaviorName) ||
        Object.hasOwn(SPIN_DIRECTIONS, cell.behaviorName);
      if (unsafe) {
        rechargeBlocked.add(coordinate);
      } else if (coordinate !== currentCoordinate) {
        rechargeTargets.add(coordinate);
      }
    }
    // The anchor must itself be safe for the walking circuit. Travel back
    // after a swimmer battle can start in water, however; do not apply the
    // circuit's terrain restrictions to an otherwise valid approach to land.
    if (rechargeBlocked.has(`${anchor.x},${anchor.y}`)) return null;
    let routed = localRoute(
      map,
      position,
      new Set([`${anchor.x},${anchor.y}`]),
      rechargeBlocked,
      new Map(),
      capabilities,
    );
    if (!atAnchor && !routed) {
      routed = localRoute(map, position, new Set([`${anchor.x},${anchor.y}`]),
        liveBlocked, interactive, capabilities);
    }
    if (atAnchor) {
      const observedBatterySteps = Number(
        observation?.playerMemory?.vsSeeker?.batterySteps ?? 0,
      );
      const batterySteps = Number.isFinite(observedBatterySteps)
        ? Math.max(0, Math.min(100, Math.floor(observedBatterySteps)))
        : 0;
      const maximumOutboundSteps = Math.max(
        1,
        Math.ceil((100 - batterySteps) / 2),
      );
      // Prefer a clear circuit even when a longer path crosses grass. Keep
      // ordinary approach/fallback routing for anchors reachable only via grass.
      const clearBlocked = new Set(rechargeBlocked);
      for (const cell of map.layout?.cells ?? []) {
        if (Number(cell.encounterType) > 0 && `${cell.x},${cell.y}` !== currentCoordinate) clearBlocked.add(`${cell.x},${cell.y}`);
      }
      const clearTargets = new Set([...rechargeTargets].filter(key => !clearBlocked.has(key)));
      const clearRoutes = localRoutes(map, position, clearTargets, clearBlocked, new Map(), capabilities);
      routed = [...(clearRoutes.size ? clearRoutes : localRoutes(
        map,
        position,
        rechargeTargets,
        rechargeBlocked,
        new Map(),
        capabilities,
      )).values()]
        .filter(({ distance }) =>
          Number(distance) > 0 && Number(distance) <= maximumOutboundSteps
        )
        .sort((left, right) =>
          Number(right.distance) - Number(left.distance) ||
          Number(right.firstSegmentSteps) - Number(left.firstSegmentSteps) ||
          Number(left.y) - Number(right.y) ||
          Number(left.x) - Number(right.x)
        )[0] ?? null;
    }
    if (routed?.distance === 0) return null;
    // A same-map destination may require leaving through a gate and returning.
    // Keep the world-route fallback when the current region cannot reach it.
    if (routed) {
      const obstacle = obstacleRecommendation(
        routed,
        position,
        objective,
        targetMap,
        mapId,
      );
      if (obstacle) return obstacle;
      return {
        kind: "move-toward",
        direction: routed.first,
        ...pathSegmentFields(routed, position, mapId),
        objective: objective.id,
        targetMap,
        target: {
          kind: "vs-seeker-recharge",
          x: Number(routed.x),
          y: Number(routed.y),
        },
        remainingSteps: routed.distance,
      };
    }
  }
  if (mapId === targetMap && objective.target.kind === "map-arrival") {
    return null;
  }
  if (mapId === targetMap && objective.target.kind === 'friendship-walk') {
    // Friendship comes from actual field steps. Stay on ordinary indoor floor,
    // away from exits, scripts, encounters, and the PC/nurse interactions.
    const blocked=new Set(liveBlocked);
    for(const event of [...(map.warpEvents??[]),...(map.coordEvents??[])])blocked.add(`${event.x},${event.y}`);
    for(const coordinate of interactive.keys())blocked.add(coordinate);
    const goals=new Set();
    for(const cell of map.layout?.cells??[]){
      const key=`${cell.x},${cell.y}`;
      if(Number(cell.collision)!==0||Number(cell.encounterType)>0||cell.behaviorName!=='MB_NORMAL')blocked.add(key);
      else if(!blocked.has(key))goals.add(key);
    }
    const routed=[...localRoutes(map,position,goals,blocked,new Map(),capabilities).values()]
      .filter(r=>r.distance>0&&r.distance<=20).sort((a,b)=>b.distance-a.distance||a.y-b.y||a.x-b.x)[0];
    return routed?{kind:'move-toward',direction:routed.first,...pathSegmentFields(routed,position,mapId),objective:objective.id,targetMap,target:objective.target,remainingSteps:routed.distance}:null;
  }
  if(mapId===targetMap&&['field-move-at','walk-to'].includes(objective.target.kind)){
    const target=objective.target;
    const routed=localRoute(map,position,new Set([`${target.x},${target.y}`]),liveBlocked,interactive,capabilities);
    if(!routed||routed.distance===0)return null;
    const obstacle=obstacleRecommendation(routed,position,objective,targetMap,mapId);
    return obstacle??{kind:'move-toward',direction:routed.first,...pathSegmentFields(routed,position,mapId),objective:objective.id,targetMap,target,remainingSteps:routed.distance};
  }
  if (mapId === targetMap && objective.target.kind === "push-boulder") {
    return boulderRecommendation({ map, observation, objective });
  }
  if (
    mapId === targetMap &&
    ["encounter-zone", "surf-encounter-zone"].includes(objective.target.kind)
  ) {
    const cells = new Map(
      (map.layout?.cells ?? []).map((cell) => [`${cell.x},${cell.y}`, cell]),
    );
    const isEncounterCell = (cell) => Number(cell?.collision) === 0 && (
      objective.target.kind === "encounter-zone"
        ? Number(cell?.encounterType) === 1
        : SURFABLE_BEHAVIORS.has(cell?.behaviorName)
    );
    const current = cells.get(`${position.x},${position.y}`);
    if (isEncounterCell(current)) {
      const currentCoordinate = `${position.x},${position.y}`;
      const patrolTargets = new Set(
        [...cells.entries()]
          .filter(([coordinate, cell]) =>
            coordinate !== currentCoordinate && isEncounterCell(cell)
          )
          .map(([coordinate]) => coordinate),
      );
      const patrolBlocked = new Set(liveBlocked);
      for (const [coordinate, cell] of cells) {
        if (!isEncounterCell(cell)) patrolBlocked.add(coordinate);
      }
      for (const coordinate of interactive.keys()) patrolBlocked.add(coordinate);
      const patrol = farthestLocalRoute(
        map,
        position,
        patrolTargets,
        patrolBlocked,
        new Map(),
        capabilities,
      );
      if (patrol) {
        return {
          kind: "move-toward",
          direction: patrol.first,
          ...pathSegmentFields(patrol, position, mapId),
          objective: objective.id,
          targetMap,
          target: {
            kind: objective.target.kind,
            x: patrol.x,
            y: patrol.y,
          },
          remainingSteps: patrol.distance,
        };
      }
    }
    const routed = localRoute(
      map,
      position,
      new Set(targetCoordinates(map, objective.target)
        .map(({ x, y }) => `${x},${y}`)
        .filter((coordinate) => coordinate !== `${position.x},${position.y}`)),
      liveBlocked,
      interactive,
      capabilities,
    );
    if (routed?.distance === 0) return null;
    if (routed) {
      const obstacle = obstacleRecommendation(routed, position, objective, targetMap, mapId);
      if (obstacle) return obstacle;
      return {
        kind: "move-toward",
        direction: routed.first,
        ...pathSegmentFields(routed, position, mapId),
        objective: objective.id,
        targetMap,
        target: { kind: objective.target.kind, x: routed.x, y: routed.y },
        remainingSteps: routed.distance,
      };
    }
  }
  if (mapId === targetMap && objective.target.kind === "fishing-zone") {
    const approaches = new Map();
    for (const approach of fishingApproaches(map)) {
      const coordinate = `${approach.x},${approach.y}`;
      if (!liveBlocked.has(coordinate) && !approaches.has(coordinate)) {
        approaches.set(coordinate, approach);
      }
    }
    const routed = localRoute(
      map,
      position,
      approaches,
      liveBlocked,
      interactive,
      capabilities,
    );
    if (routed) {
      const obstacle = obstacleRecommendation(routed, position, objective, targetMap, mapId);
      if (obstacle) return obstacle;
      const selected = approaches.get(`${routed.x},${routed.y}`);
      if (!selected) return null;
      return {
        kind: routed.distance === 0 ? "use-fishing-rod" : "move-toward",
        direction: routed.distance === 0 ? selected.direction : routed.first,
        ...(routed.distance > 0
          ? pathSegmentFields(routed, position, mapId)
          : {}),
        objective: objective.id,
        targetMap,
        target: {
          kind: "fishing-zone",
          x: selected.x,
          y: selected.y,
          rodItemId: objective.target.rodItemId,
        },
        remainingSteps: routed.distance,
      };
    }
  }
  if (mapId === targetMap && objective.target.kind === "party-roster") {
    const approaches = new Map();
    for (const pc of (map.layout?.cells ?? []).filter(
      ({ behaviorName }) => behaviorName === "MB_PC",
    )) {
      for (const { x, y, direction } of objectApproaches(map, pc)) {
        const coordinate = `${x},${y}`;
        if (!liveBlocked.has(coordinate) && !approaches.has(coordinate)) {
          approaches.set(coordinate, { pc, direction });
        }
      }
    }
    const routed = localRoute(
      map,
      position,
      approaches,
      liveBlocked,
      interactive,
      capabilities,
    );
    if (routed) {
      const obstacle = obstacleRecommendation(routed, position, objective, targetMap, mapId);
      if (obstacle) return obstacle;
      const selected = approaches.get(`${routed.x},${routed.y}`);
      if (!selected) return null;
      return {
        kind: routed.distance === 0
          ? "interact-with-background"
          : "move-toward",
        direction: routed.distance === 0 ? selected.direction : routed.first,
        ...(routed.distance > 0
          ? pathSegmentFields(routed, position, mapId)
          : {}),
        objective: objective.id,
        targetMap,
        target: {
          kind: "party-roster",
          x: Number(selected.pc.x),
          y: Number(selected.pc.y),
        },
        remainingSteps: routed.distance,
      };
    }
  }
  if (mapId === targetMap && objective.target.kind === "itemfinder") {
    const target = {
      kind: "itemfinder",
      index: objective.target.index,
      x: Number(objective.target.x),
      y: Number(objective.target.y),
      itemId: Number(objective.target.itemId),
    };
    const routed = localRoute(
      map,
      position,
      new Set([`${target.x},${target.y}`]),
      liveBlocked,
      interactive,
      capabilities,
    );
    if (routed) {
      const obstacle = obstacleRecommendation(routed, position, objective, targetMap, mapId);
      if (obstacle) return obstacle;
      return routed.distance === 0
        ? {
            kind: "use-itemfinder",
            objective: objective.id,
            targetMap,
            target,
          }
        : {
            kind: "move-toward",
            direction: routed.first,
            ...pathSegmentFields(routed, position, mapId),
            objective: objective.id,
            targetMap,
            target,
            remainingSteps: routed.distance,
          };
    }
  }
  if (
    mapId === targetMap &&
    ["object", "in-game-trade", "mansion-secret-key", "purchase-items"].includes(
      objective.target.kind,
    )
  ) {
    const targetIndex = objective.target.kind === "purchase-items"
      ? objective.target.objectIndex
      : objective.target.index;
    const sourceObject = map.objectEvents?.[targetIndex];
    if (!sourceObject) return null;
    const observedPosition = observedObjectPosition(
      observation,
      targetIndex,
      sourceObject,
    );
    const object = observedPosition !== sourceObject
      ? {
          ...sourceObject,
          x: Number(observedPosition.x),
          y: Number(observedPosition.y),
        }
      : sourceObject;
    const approaches = new Map();
    const blocked = liveBlocked;
    const liveObject = liveObjectForMapIndex(observation, targetIndex);
    for (const { x, y, direction } of objectApproaches(map,
      { ...object, elevation: liveObject?.elevation ?? object.elevation }, observation,
      { kind: 'object', index: targetIndex, x: object.x, y: object.y })) {
      const coordinate = `${x},${y}`;
      if (!blocked.has(coordinate)) approaches.set(coordinate, direction);
    }
    const routed = localRoute(
      map,
      position,
      approaches,
      blocked,
      interactive,
      capabilities,
    );
    if (routed) {
      const obstacle = obstacleRecommendation(routed, position, objective, targetMap, mapId);
      if (obstacle) return obstacle;
      const target = {
        kind: "object",
        index: targetIndex,
        x: Number(object.x),
        y: Number(object.y),
        localId: object.local_id ?? null,
        script: object.script ?? null,
      };
      return {
        kind: routed.distance === 0 ? "interact-with-object" : "move-toward",
        direction: routed.distance === 0
          ? approaches.get(`${routed.x},${routed.y}`)
          : routed.first,
        ...(routed.distance > 0
          ? pathSegmentFields(routed, position, mapId)
          : {}),
        objective: objective.id,
        targetMap,
        target,
        remainingSteps: routed.distance,
      };
    }
  }
  if (mapId === targetMap && objective.target.kind === "background") {
    const candidates = equivalentBackgroundEvents(map, objective.target.index);
    if (candidates.length === 0) return null;
    const approaches = new Map();
    for (const candidate of candidates) {
      for (const { x, y, direction } of backgroundApproaches(map, candidate.event, observation)) {
        const coordinate = `${x},${y}`;
        if (!liveBlocked.has(coordinate) && !approaches.has(coordinate)) {
          approaches.set(coordinate, { ...candidate, direction });
        }
      }
    }
    const routed = localRoute(
      map,
      position,
      approaches,
      liveBlocked,
      interactive,
      capabilities,
    );
    if (routed) {
      const obstacle = obstacleRecommendation(routed, position, objective, targetMap, mapId);
      if (obstacle) return obstacle;
      const selected = approaches.get(`${routed.x},${routed.y}`);
      if (!selected) return null;
      return {
        kind: routed.distance === 0
          ? "interact-with-background"
          : "move-toward",
        direction: routed.distance === 0
          ? selected.direction
          : routed.first,
        ...(routed.distance > 0
          ? pathSegmentFields(routed, position, mapId)
          : {}),
        objective: objective.id,
        targetMap,
        target: {
          kind: "background",
          index: selected.index,
          x: Number(selected.event.x),
          y: Number(selected.event.y),
          script: selected.event.script ?? null,
        },
        remainingSteps: routed.distance,
      };
    }
  }
  if (mapId === targetMap && objective.target.kind === "warp") {
    let index = objective.target.index;
    let warp = map.warpEvents?.[index];
    if (!warp) return null;
    if (!isActivatingWarp(map,warp)) {
      // Wide doors can have ordinary landing tiles beside the actual arrow
      // exit. A landing event cannot activate simply by waiting or reentering.
      const equivalent = map.warpEvents.findIndex(candidate=>isActivatingWarp(map,candidate) &&
        candidate.dest_map===warp.dest_map && String(candidate.dest_warp_id)===String(warp.dest_warp_id) &&
        Number(candidate.elevation??0)===Number(warp.elevation??0) &&
        Math.abs(Number(candidate.x)-Number(warp.x))+Math.abs(Number(candidate.y)-Number(warp.y))<=2);
      if(equivalent>=0) {index=equivalent;warp=map.warpEvents[index];}
    }
    const x = Number(warp.x);
    const y = Number(warp.y);
    const activation = warpActivation(map, warp);
    const routed = localRoute(
      map,
      position,
      new Set([`${activation.x},${activation.y}`]),
      liveBlocked,
      interactive,
      capabilities,
    );
    if (routed) {
      const obstacle = obstacleRecommendation(routed, position, objective, targetMap, mapId);
      if (obstacle) return obstacle;
      const target = {
        kind: "warp",
        index,
        x,
        y,
      };
      if (routed.distance > 0) {
        return {
          kind: "move-toward",
          direction: routed.first,
          ...pathSegmentFields(routed, position, mapId),
          objective: objective.id,
          targetMap,
          target,
          remainingSteps: routed.distance,
        };
      }
      const reentryDirection = activation.kind === 'traverse-map-warp' && isActivatingWarp(map,warp) &&
        warpBehavior(map,warp) !== 'MB_FALL_WARP'
        ? automaticWarpReentryDirection(map,activation,liveBlocked) : null;
      return {
        kind: reentryDirection ? 'reenter-map-warp' : activation.kind,
        ...(reentryDirection ? {direction:reentryDirection} : activation.direction ? { direction: activation.direction } : {}),
        objective: objective.id,
        targetMap,
        target,
        remainingSteps: 0,
      };
    }
  }
  if (mapId === targetMap && objective.target.kind === "trigger") {
    const events = new Map(equivalentTriggerEvents(map, objective.target)
      .map(candidate => [`${Number(candidate.event.x)},${Number(candidate.event.y)}`, candidate]));
    if (events.size === 0) return null;
    const routed = localRoute(
      map,
      position,
      new Set(events.keys()),
      liveBlocked,
      interactive,
      capabilities,
    );
    if (routed?.distance === 0) return null;
    if (routed) {
      const obstacle = obstacleRecommendation(routed, position, objective, targetMap, mapId);
      if (obstacle) return obstacle;
      const { event, index } = events.get(`${routed.x},${routed.y}`);
      return {
        kind: "move-toward",
        direction: routed.first,
        ...pathSegmentFields(routed, position, mapId),
        objective: objective.id,
        targetMap,
        target: {
          kind: "trigger",
          index,
          x: Number(event.x),
          y: Number(event.y),
          script: event.script ?? null,
        },
        remainingSteps: routed.distance,
      };
    }
  }
  const unavailableRegions = unavailableStoryRegions(graph, observation);
  let planned = firstReachableRegionTransition({
    graph,
    mapId,
    position,
    target: objective.target,
    blocked: liveBlocked,
    interactive,
    capabilities,
    currentMap: map,
    unavailableRegions,
    excludedTransitions: observation?.navigationExclusions?.transitions,
  });
  if (!planned && mapId !== targetMap) {
    planned = firstReachableRegionTransition({
      graph,
      mapId,
      position,
      target: objective.target,
      targetRegionOverride: targetMapIngressRegions(graph, targetMap),
      blocked: liveBlocked,
      interactive,
      capabilities,
      currentMap: map,
      unavailableRegions,
      excludedTransitions: observation?.navigationExclusions?.transitions,
    });
  }
  if (!planned) {
    const entrance = SCRIPTED_ENTRANCES.find(entry =>
      targetMap.startsWith(entry.interior) && !mapId.startsWith(entry.interior) &&
      mapId !== entry.exterior && scriptedEntranceUnlocked(observation, entry) &&
      scriptedEntranceLandingReaches({ graph, observation, entry, target: objective.target }));
    return entrance ? campaignNavigationRecommendation({world, observation,
      objective: {...objective, target: {kind: "map", map: entrance.exterior}}}) : null;
  }
  const { edge: { transit, activation }, routed } = planned;
  const obstacle = obstacleRecommendation(routed, position, objective, targetMap, mapId);
  if (obstacle) return obstacle;
  if (transit.kind === "ledge") {
    return {
      kind: routed.distance === 0 ? "traverse-ledge" : "move-toward",
      direction: routed.distance === 0 ? activation.direction : routed.first,
      ...(routed.distance > 0
        ? pathSegmentFields(routed, position, mapId)
        : {}),
      objective: objective.id,
      targetMap,
      transit: {
        kind: "ledge",
        destinationMap: transit.destinationMap,
        x: transit.x,
        y: transit.y,
        direction: transit.direction,
      },
      remainingSteps: routed.distance,
    };
  }
  if (transit.kind === "warp") {
    const reentryDirection = routed.distance === 0 &&
      activation.kind === "traverse-map-warp"
      ? automaticWarpReentryDirection(map, activation, liveBlocked)
      : null;
    return {
      kind: routed.distance === 0
        ? reentryDirection ? "reenter-map-warp" : activation.kind
        : "move-toward",
      ...(routed.distance > 0
        ? { direction: routed.first }
        : reentryDirection
          ? { direction: reentryDirection }
        : activation.direction
          ? { direction: activation.direction }
          : {}),
      ...(routed.distance > 0
        ? pathSegmentFields(routed, position, mapId)
        : {}),
      objective: objective.id,
      targetMap,
      transit: {
        kind: "warp",
        destinationMap: transit.destinationMap,
        x: transit.x,
        y: transit.y,
      },
      remainingSteps: routed.distance,
    };
  }
  if (transit.kind === "connection") {
    const direction = activation.direction;
    return {
      kind: routed.distance === 0
        ? "traverse-map-connection"
        : "move-toward",
      direction: routed.distance === 0 ? direction : routed.first,
      ...(routed.distance > 0
        ? pathSegmentFields(routed, position, mapId, Infinity, direction)
        : {}),
      objective: objective.id,
      targetMap,
      transit: {
        kind: "connection",
        destinationMap: transit.destinationMap,
        direction,
      },
      remainingSteps: routed.distance,
    };
  }
  return null;
}

// The cartridge clears FLAG_TEMP_1..1F and VAR_TEMP_0..F on map load.
// A completed prefix is a durable route milestone, not proof these local
// prerequisites are still satisfied. Persistent variables reset by scripts
// (such as Victory Road switches) retain their explicit transient annotation.
function completionUsesTemporaryState(completion) {
  if (["any", "all"].includes(completion?.kind)) {
    return (completion.completions ?? []).some(completionUsesTemporaryState);
  }
  const id = Number(completion?.id);
  if (["flag-set", "flag-unset"].includes(completion?.kind)) {
    return Number.isInteger(id) && id >= 1 && id <= 0x1f;
  }
  return ["variable-at-least", "variable-between"].includes(completion?.kind) &&
    Number.isInteger(id) && id >= 0x4000 && id <= 0x400f;
}

function isResettableMapObjective(objective) {
  return Boolean(objective?.target?.map) &&
    (objective.transientMapPuzzle === true ||
      completionUsesTemporaryState(objective.completion));
}

function completionEvidenceKnown(completion, observation) {
  if (["any", "all"].includes(completion?.kind)) {
    return (completion.completions ?? []).every(c => completionEvidenceKnown(c, observation));
  }
  const story = observation?.playerMemory?.storyState;
  if (["flag-set", "flag-unset"].includes(completion?.kind)) {
    return typeof story?.flagIds?.[completion.id] === "boolean";
  }
  if (["variable-at-least", "variable-between"].includes(completion?.kind)) {
    return Number.isFinite(story?.variableIds?.[completion.id]);
  }
  return true;
}

function completed(completion, observation, mechanics = null) {
  if (completion?.kind === "any") {
    return (completion.completions ?? []).some((candidate) =>
      completed(candidate, observation, mechanics)
    );
  }
  if (completion?.kind === "all") {
    return (completion.completions ?? []).every((candidate) =>
      completed(candidate, observation, mechanics)
    );
  }
  if (completion?.kind === "variable-at-least") {
    return Number(
      observation?.playerMemory?.storyState?.variableIds?.[completion.id] ?? 0,
    ) >= Number(completion.value);
  }
  if (completion?.kind === "variable-between") {
    const value = Number(
      observation?.playerMemory?.storyState?.variableIds?.[completion.id] ?? 0,
    );
    return value >= Number(completion.minimum) &&
      value <= Number(completion.maximum);
  }
  if (completion?.kind === "flag-set") {
    return observation?.playerMemory?.storyState?.flagIds?.[completion.id] === true;
  }
  if (completion?.kind === "flag-unset") {
    return observation?.playerMemory?.storyState?.flagIds?.[completion.id] === false;
  }
  if (completion?.kind === "item-at-least") {
    const bag = observation?.playerMemory?.trainer?.bag ?? {};
    const quantity = Object.values(bag).flat().find(
      ({ itemId }) => Number(itemId) === Number(completion.id),
    )?.quantity ?? 0;
    return Number(quantity) >= Number(completion.quantity);
  }
  if (completion?.kind === "party-knows-move") {
    return partyKnowsMove(observation, completion.moveId);
  }
  if (["party-family-knows-move", "party-family-lacks-move"].includes(
    completion?.kind,
  )) {
    const wanted = new Set((completion.species ?? []).map(Number));
    const member = (observation?.playerMemory?.trainer?.party ?? []).find(
      ({ species }) => wanted.has(Number(species)),
    );
    if (!member) return false;
    const knowsMove = (member.moves ?? []).map(Number).includes(
      Number(completion.moveId),
    );
    return completion.kind === "party-family-knows-move"
      ? knowsMove
      : !knowsMove;
  }
  if (completion?.kind === "party-has-species") {
    const wanted = new Set((completion.species ?? []).map(Number));
    return (observation?.playerMemory?.trainer?.party ?? []).some(({ species }) =>
      wanted.has(Number(species))
    );
  }
  if (completion?.kind === "party-member-minimum-level") {
    const wanted = new Set((completion.species ?? []).map(Number));
    return (observation?.playerMemory?.trainer?.party ?? []).some(member =>
      wanted.has(Number(member.species)) && Number(member.level) >= Number(completion.level));
  }
  if (completion?.kind === "party-has-families") {
    const partySpecies = new Set(
      (observation?.playerMemory?.trainer?.party ?? []).map(({ species }) =>
        Number(species)
      ),
    );
    return (completion.families ?? []).every((family) =>
      (family ?? []).some((species) => partySpecies.has(Number(species)))
    );
  }
  if (completion?.kind === "party-size-at-most") {
    return (observation?.playerMemory?.trainer?.party ?? []).length <=
      Number(completion.count);
  }
  if (completion?.kind === "owned-species") {
    const wanted = new Set((completion.species ?? []).map(Number));
    const owned = observation?.playerMemory?.trainer?.pokedex?.ownedSpecies ?? [];
    // Pokédex flags are National numbers; completion species are internal ids.
    const wantedNational = new Set([...wanted].map(nationalSpeciesId).filter(Boolean));
    return owned.some((species) => wantedNational.has(Number(species))) ||
      (observation?.playerMemory?.trainer?.party ?? []).some(({ species }) =>
        wanted.has(Number(species))
      );
  }
  if (completion?.kind === 'available-species') {
    const wanted = new Set(completion.species.map(Number));
    const trainer = observation?.playerMemory?.trainer;
    return [...(trainer?.party ?? []), ...(trainer?.storage?.pokemon ?? [])]
      .some(p => wanted.has(Number(p.species)));
  }
  if (completion?.kind === "party-fully-healed") {
    const party = observation?.playerMemory?.trainer?.party ?? [];
    return party.length > 0 && party.every(({ hp, maxHp }) =>
      Number(maxHp) > 0 && Number(hp) === Number(maxHp)
    );
  }
  if (completion?.kind === "party-fully-restored") {
    return partyFullyRestored(observation?.playerMemory, mechanics);
  }
  if (completion?.kind === "party-maximally-recovered") {
    return partyMaximallyRecovered(observation?.playerMemory, mechanics);
  }
  if (completion?.kind === "map-is") {
    return observation?.playerMemory?.map?.id === completion.map;
  }
  if (completion?.kind === "map-not-in") {
    const mapId = observation?.playerMemory?.map?.id;
    return Boolean(mapId) && !(completion.maps ?? []).includes(mapId);
  }
  if (completion?.kind === "map-prefix") {
    return String(observation?.playerMemory?.map?.id ?? "").startsWith(
      String(completion.prefix ?? ""),
    );
  }
  return false;
}

function purchaseBudgetExhausted(objective, observation) {
  if (objective?.target?.kind !== "purchase-items") return false;
  const money = Number(observation?.playerMemory?.trainer?.money);
  if (!Number.isSafeInteger(money) || money < 0) return false;
  const bag = observation?.playerMemory?.trainer?.bag ?? {};
  const items = Object.values(bag).flat();
  const missing = (objective.target.items ?? []).filter(({ itemId, quantity }) => {
    const owned = Number(items.find((entry) =>
      Number(entry?.itemId) === Number(itemId)
    )?.quantity ?? 0);
    return owned < Number(quantity);
  });
  return missing.length > 0 && missing.every(({ unitPrice }) => {
    const price = Number(unitPrice);
    return Number.isSafeInteger(price) && price > money;
  });
}

function objectiveCompleted(objective, observation, mechanics = null) {
  const captureBattleInProgress =
    observation?.emulator?.mode === "battle" &&
    (objective?.captureSpecies ?? []).map(Number).includes(
      Number(observation?.playerMemory?.battle?.opponent?.species),
    );
  // One-time cartridge encounters can set their hide flag as the battle
  // starts. Keep the capture objective—and therefore its capture policy—active
  // until FireRed leaves the battle instead of advancing on that early flag.
  return (!captureBattleInProgress && completed(
    objective?.completion,
    observation,
    mechanics,
  )) ||
    purchaseBudgetExhausted(objective, observation);
}

function regionalMasteryMaps(observation) {
  const result = new Set();
  let hasBadge = false;
  for (const stage of REGIONAL_MASTERY_STAGES) {
    if (!watchedFlag(observation, stage.badgeFlagId)) continue;
    hasBadge = true;
    for (const map of stage.maps) result.add(map);
  }
  return hasBadge ? result : null;
}

function optionalMapAuthorized(map, observation) {
  const requirement = OPTIONAL_MAP_REQUIREMENTS[map];
  return !requirement || completed(requirement, observation);
}

function collectionLocationAuthorized(location, observation) {
  // Route 12 is one long source map, but its southern items are separated from
  // the north entrance by the one-time Snorlax battle. The coarse map graph
  // cannot represent that internal story gate, so keep those pickups deferred
  // until the cartridge confirms that Snorlax is gone.
  if (
    location?.map === "MAP_ROUTE12" &&
    Number(location?.y) > 70 &&
    !watchedFlag(observation, 84)
  ) return false;
  return true;
}

function pokedexCount(observation, kind) {
  const pokedex = observation?.playerMemory?.trainer?.pokedex ?? {};
  const reported = Number(pokedex[`${kind}Count`]);
  if (Number.isSafeInteger(reported) && reported >= 0) return reported;
  const species = pokedex[`${kind}Species`];
  return Array.isArray(species) ? new Set(species.map(Number)).size : 0;
}

function trainingInfrastructureRouteMetrics({
  world,
  graph,
  observation,
  objectiveId,
  target,
} = {}) {
  const metrics = routeMetrics({ graph, observation, target });
  if (metrics) return metrics;
  if (!VICTORY_ROAD_SHUTTLE_MAPS.has(observation?.playerMemory?.map?.id)) {
    return null;
  }
  const specialTransit = campaignNavigationRecommendation({
    world,
    observation,
    objective: { id: objectiveId, target },
  });
  return specialTransit
    ? {
        transitions: Number.MAX_SAFE_INTEGER,
        localSteps: Number(specialTransit.remainingSteps ?? 0),
      }
    : null;
}

function selectReachableOakAide({
  world,
  graph,
  observation,
  fieldEnabling = null,
  preferredObjectiveId = null,
} = {}) {
  const numericFlags = observation?.playerMemory?.storyState?.flagIds ?? {};
  const candidates = OAK_AIDE_REWARDS.flatMap((reward, order) => {
    if (
      fieldEnabling !== null && Boolean(reward.fieldEnabling) !== fieldEnabling ||
      !watchedFlag(observation, reward.minimumBadgeFlagId) ||
      numericFlags[reward.flagId] !== false ||
      pokedexCount(observation, reward.countKind) < reward.threshold ||
      !bagCanReceive(observation, reward.itemId, 1)
    ) return [];
    const target = {
      kind: "object",
      map: reward.map,
      index: reward.objectIndex,
    };
    const metrics = trainingInfrastructureRouteMetrics({
      world,
      graph,
      observation,
      objectiveId: reward.id,
      target,
    });
    return metrics ? [{ reward, target, metrics, order }] : [];
  });
  candidates.sort((left, right) =>
    left.metrics.transitions - right.metrics.transitions ||
    left.metrics.localSteps - right.metrics.localSteps ||
    left.order - right.order
  );
  const selected = candidates.find(({ reward }) =>
    reward.id === preferredObjectiveId
  ) ?? candidates[0];
  return selected
    ? Object.freeze({
        id: selected.reward.id,
        target: Object.freeze(selected.target),
        completion: Object.freeze({
          kind: "flag-set",
          id: selected.reward.flagId,
        }),
        dialogue: "advance",
        choice: "yes",
        regionalMastery: true,
        oakAide: true,
        pokedexCountKind: selected.reward.countKind,
        pokedexThreshold: selected.reward.threshold,
        itemId: selected.reward.itemId,
      })
    : null;
}

function selectTrainingInfrastructureObjective({
  world,
  observation,
  encounterCatalog,
  objective,
  teamPlan = null,
  pokedexGoal = 50,
  minimumEncounterShare = pokedexGoal > 60 ? 0 : 10,
} = {}) {
  if (!world || observation?.emulator?.mode !== "overworld") return null;
  if (teamPlan?.trainingPolicy?.acquireExpShareByPokedexGrinding === false) {
    return null;
  }
  const mandatoryTransaction = Boolean(
    objective?.mandatoryInterlude ||
    objective?.acquisitionId ||
    objective?.target?.kind === "push-boulder" ||
    objective?.boulderRecoveryFor ||
    (objective?.captureSpecies ?? []).length > 0 ||
    objective?.captureAnyNewSpecies === true
  );
  if (mandatoryTransaction) return null;
  const graph = createWorldNavigationGraph(world, observation);

  if (
    watchedFlag(observation, 2081) &&
    !watchedFlag(observation, VS_SEEKER_FLAG_ID) &&
    !bagHasItem(observation, VS_SEEKER_ITEM_ID) &&
    bagCanReceive(observation, VS_SEEKER_ITEM_ID, 1)
  ) {
    const target = {
      kind: "object",
      map: "MAP_VERMILION_CITY_POKEMON_CENTER_1F",
      index: 4,
    };
    if (trainingInfrastructureRouteMetrics({
      world,
      graph,
      observation,
      objectiveId: "vs-seeker",
      target,
    })) {
      return Object.freeze({
        id: "vs-seeker",
        target: Object.freeze(target),
        completion: Object.freeze(anyCompletion(
          { kind: "flag-set", id: VS_SEEKER_FLAG_ID },
          { kind: "item-at-least", id: VS_SEEKER_ITEM_ID, quantity: 1 },
        )),
        dialogue: "advance",
        trainingInfrastructure: true,
      });
    }
  }

  const expShareMissing =
    !watchedFlag(observation, EXP_SHARE_FLAG_ID) &&
    !bagHasItem(observation, EXP_SHARE_ITEM_ID);
  const route15Open = watchedFlag(observation, 84) || watchedFlag(observation, 128);
  if ((!expShareMissing && pokedexGoal <= 50) || !watchedFlag(observation, 2083) || !route15Open) {
    return null;
  }
  const aide = selectReachableOakAide({
    world,
    graph,
    observation,
    fieldEnabling: false,
    preferredObjectiveId: "oak-aide-exp-share",
  });
  if (aide?.id === "oak-aide-exp-share") {
    return Object.freeze({ ...aide, trainingInfrastructure: true });
  }
  if (pokedexCount(observation, "owned") >= pokedexGoal) return null;

  const ownedSpecies = new Set(
    (observation?.playerMemory?.trainer?.pokedex?.ownedSpecies ?? []).map(Number),
  );
  const capabilities = worldNavigationCapabilities(observation);
  const candidates = (encounterCatalog ?? []).flatMap((encounter, order) => {
    if (
      ownedSpecies.has(nationalSpeciesId(Number(encounter.speciesId))) ||
      encounter.safari ||
      encounter.requiresSilphScope && !bagHasItem(observation, SILPH_SCOPE_ITEM_ID) ||
      Number(encounter.encounterShare) < minimumEncounterShare ||
      encounter.method === "surf" && !capabilities.canSurf ||
      encounter.method === "fishing" && !bagHasItem(observation, encounter.rodItemId) ||
      !optionalMapAuthorized(encounter.map, observation)
    ) return [];
    const target = {
      kind: encounter.targetKind,
      map: encounter.map,
      ...(encounter.rodItemId ? { rodItemId: encounter.rodItemId } : {}),
    };
    const metrics = trainingInfrastructureRouteMetrics({
      world,
      graph,
      observation,
      objectiveId: `exp-share-capture:${encounter.map}:${encounter.speciesId}`,
      target,
    });
    return metrics ? [{ encounter, target, metrics, order }] : [];
  });
  candidates.sort((left, right) =>
    Number(right.encounter.rate) * Number(right.encounter.encounterShare) -
      Number(left.encounter.rate) * Number(left.encounter.encounterShare) ||
    left.metrics.transitions - right.metrics.transitions ||
    left.metrics.localSteps - right.metrics.localSteps ||
    right.encounter.encounterShare - left.encounter.encounterShare ||
    left.order - right.order
  );
  const selected = candidates[0];
  if (!selected) return null;
  const speciesId = Number(selected.encounter.speciesId);
  return Object.freeze({
    id: `${pokedexGoal > 50 ? 'national-dex' : 'exp-share'}-capture:${selected.encounter.map}:${speciesId}`,
    target: Object.freeze(selected.target),
    completion: Object.freeze({
      kind: "owned-species",
      species: Object.freeze([speciesId]),
    }),
    dialogue: "advance",
    trainingInfrastructure: true,
    captureSpecies: Object.freeze([speciesId]),
    captureFamily: Object.freeze([speciesId]),
    encounterMethod: selected.encounter.method,
    ...(selected.encounter.rodItemId
      ? { rodItemId: selected.encounter.rodItemId }
      : {}),
    encounter: Object.freeze({
      rate: selected.encounter.rate,
      encounterShare: selected.encounter.encounterShare,
      minimumLevel: selected.encounter.minimumLevel,
      maximumLevel: selected.encounter.maximumLevel,
    }),
    pokedexOwnedCount: pokedexCount(observation, "owned"),
    pokedexThreshold: pokedexGoal,
  });
}

function selectRegionalMasteryObjective({
  world,
  observation,
  teamPlan,
  trainerCatalog,
  encounterCatalog,
  preferredObjectiveId = null,
} = {}) {
  if (teamPlan?.pokedexPolicy?.enabled === false) return null;
  const masteryMaps = regionalMasteryMaps(observation);
  if (!masteryMaps || !world) return null;
  const graph = createWorldNavigationGraph(world, observation);
  const fieldEnablingAide = selectReachableOakAide({
    world,
    graph,
    observation,
    fieldEnabling: true,
    preferredObjectiveId,
  });
  if (fieldEnablingAide) return fieldEnablingAide;
  const flashCarriers = teamPlan ? fieldCarrierSpecies(teamPlan,'flash') : [46, 47];
  const hasFlashCarrier = (observation?.playerMemory?.trainer?.party ?? []).some(
    ({ species }) => flashCarriers.map(Number).includes(Number(species)),
  );
  if (
    watchedFlag(observation, 571) &&
    bagHasItem(observation, 343) &&
    hasFlashCarrier &&
    !partyKnowsMove(observation, 148)
  ) {
    return Object.freeze({
      id: "teach-flash-for-regional-mastery",
      target: Object.freeze({
        kind: "teach-move",
        itemId: 343,
        moveId: 148,
        partySpecies: Object.freeze([...flashCarriers]),
      }),
      completion: Object.freeze({ kind: "party-knows-move", moveId: 148 }),
      dialogue: "advance",
      regionalMastery: true,
      oakAide: true,
    });
  }

  const numericFlags = observation?.playerMemory?.storyState?.flagIds ?? {};
  const trainerCandidates = (trainerCatalog ?? []).flatMap((trainer, order) => {
    if (
      !masteryMaps.has(trainer.target.map) ||
      !optionalMapAuthorized(trainer.target.map, observation) ||
      numericFlags[trainer.flagId] !== false
    ) return [];
    const metrics = routeMetrics({
      graph,
      observation,
      target: trainer.target,
    });
    return metrics ? [{ trainer, metrics, order }] : [];
  });
  trainerCandidates.sort((left, right) =>
    left.metrics.transitions - right.metrics.transitions ||
    left.metrics.localSteps - right.metrics.localSteps ||
    left.order - right.order
  );
  const selectedTrainer = (
    trainerCandidates.find(({ trainer }) =>
      `mastery-trainer:${trainer.target.map}:${trainer.target.index}` ===
        preferredObjectiveId
    ) ?? trainerCandidates[0]
  )?.trainer;
  if (selectedTrainer) {
    return Object.freeze({
      id: `mastery-trainer:${selectedTrainer.target.map}:${selectedTrainer.target.index}`,
      target: selectedTrainer.target,
      completion: Object.freeze({ kind: "flag-set", id: selectedTrainer.flagId }),
      dialogue: "advance",
      regionalMastery: true,
      trainingSource: "trainer",
      trainer: selectedTrainer,
    });
  }

  const aide = selectReachableOakAide({
    world,
    graph,
    observation,
    fieldEnabling: false,
    preferredObjectiveId,
  });
  if (aide) return aide;

  const ownedSpecies = new Set(
    (observation?.playerMemory?.trainer?.pokedex?.ownedSpecies ?? []).map(Number),
  );
  const capabilities = worldNavigationCapabilities(observation);
  const postgame = watchedFlag(observation, 2092);
  const captureCandidates = (encounterCatalog ?? []).flatMap((encounter, order) => {
    if (
      !postgame ||
      !masteryMaps.has(encounter.map) ||
      !optionalMapAuthorized(encounter.map, observation) ||
      ownedSpecies.has(nationalSpeciesId(Number(encounter.speciesId))) ||
      encounter.requiresSilphScope &&
        !bagHasItem(observation, SILPH_SCOPE_ITEM_ID) ||
      encounter.method === "surf" && !capabilities.canSurf ||
      encounter.method === "fishing" && !bagHasItem(observation, encounter.rodItemId)
    ) return [];
    const target = {
      kind: encounter.targetKind,
      map: encounter.map,
      ...(encounter.rodItemId ? { rodItemId: encounter.rodItemId } : {}),
    };
    const metrics = routeMetrics({ graph, observation, target });
    return metrics ? [{ encounter, target, metrics, order }] : [];
  });
  captureCandidates.sort((left, right) =>
    left.metrics.transitions - right.metrics.transitions ||
    left.metrics.localSteps - right.metrics.localSteps ||
    left.order - right.order ||
    left.encounter.speciesId - right.encounter.speciesId
  );
  const selectedCapture = captureCandidates.find(({ encounter }) =>
    `mastery-capture:${encounter.map}:${encounter.speciesId}` ===
      preferredObjectiveId
  ) ?? captureCandidates[0];
  if (!selectedCapture) return null;
  const remainingRegionalSpecies = new Set(
    captureCandidates.map(({ encounter }) => encounter.speciesId),
  ).size;
  return Object.freeze({
    id: `mastery-capture:${selectedCapture.encounter.map}:${selectedCapture.encounter.speciesId}`,
    target: Object.freeze(selectedCapture.target),
    completion: Object.freeze({
      kind: "owned-species",
      species: Object.freeze([selectedCapture.encounter.speciesId]),
    }),
    dialogue: "advance",
    regionalMastery: true,
    captureSpecies: Object.freeze([selectedCapture.encounter.speciesId]),
    captureFamily: Object.freeze([selectedCapture.encounter.speciesId]),
    remainingRegionalSpecies,
    encounterMethod: selectedCapture.encounter.method,
    ...(selectedCapture.encounter.rodItemId
      ? { rodItemId: selectedCapture.encounter.rodItemId }
      : {}),
    safari: selectedCapture.encounter.safari,
    encounter: Object.freeze({
      rate: selectedCapture.encounter.rate,
      minimumLevel: selectedCapture.encounter.minimumLevel,
      maximumLevel: selectedCapture.encounter.maximumLevel,
    }),
  });
}

export function createCampaignPlanner({
  campaign = null,
  teamPlan = null,
  world = null,
  story = null,
  mechanics = null,
  initialState = null,
  // extra-saves: a helper save's one-per-save choices (extra-save-story.js).
  // Without them the campaign object is returned unchanged.
  storyChoices = null,
} = {}) {
  const activeCampaign = applyStoryChoices(campaign ?? (teamPlan
    ? createRosterCampaign(teamPlan, { mechanics }) : MAIN_STORY_CAMPAIGN), storyChoices ?? {});
  const mandatoryInterludes = activeCampaign.mandatoryInterludes ?? [];
  const tasks=createCampaignTasks({initialState:initialState?.tasks??null,mechanics});
  if (initialState !== null && (
    initialState?.schema !== "master-red/campaign-planner-state/v1" ||
    ![null, "string"].includes(
      initialState.completedThroughObjectiveId === null
        ? null
        : typeof initialState.completedThroughObjectiveId,
    ) ||
    initialState.battleMedicineServicedForObjectiveId !== undefined &&
      ![null, "string"].includes(
        initialState.battleMedicineServicedForObjectiveId === null
          ? null
          : typeof initialState.battleMedicineServicedForObjectiveId,
      )
  )) {
    throw new TypeError("campaign planner initial state is invalid");
  }
  const restoredCompletedThroughIndex = initialState?.completedThroughObjectiveId
    ? activeCampaign.objectives.findIndex(
        ({ id }) => id === initialState.completedThroughObjectiveId,
      )
    : -1;
  if (
    initialState?.completedThroughObjectiveId &&
    restoredCompletedThroughIndex < 0
  ) {
    throw new TypeError("campaign planner initial state has an unknown objective");
  }
  const collectionCatalog = buildCollectionCatalog(world, story);
  const pokeBallMartCatalog = buildPokeBallMartCatalog(world, story);
  const trainerTrainingCatalog = buildTrainerTrainingCatalog(
    world,
    story,
    mechanics,
  );
  const regionalTrainerCatalog = buildRegionalTrainerCatalog(
    world,
    story,
    mechanics,
  );
  const regionalEncounterCatalog = buildRegionalEncounterCatalog(world, mechanics);
  const collectionMemory = initialState?.collectionMemory ?? {};
  for (const key of ["collectedLocations", "visitedMaps", "locallyDeferredCollections", "operatorDeferredCollections"]) {
    if (collectionMemory[key] !== undefined && (!Array.isArray(collectionMemory[key]) ||
        collectionMemory[key].some((value) => typeof value !== "string"))) {
      throw new TypeError("campaign planner collection memory is invalid");
    }
  }
  const collectedLocations = new Set(collectionMemory.collectedLocations ?? []);
  const visitedMaps = new Set(collectionMemory.visitedMaps ?? []);
  const locallyDeferredCollections = new Set(collectionMemory.locallyDeferredCollections ?? []);
  const operatorDeferredCollections = new Set(collectionMemory.operatorDeferredCollections ?? []);
  const recoveryMemory = structuredClone(initialState?.recoveryMemory ?? {
    failures: [], pending: null,
  });
  const validRecoveryTarget = (target) => ["object", "background"].includes(target?.kind) &&
    typeof target.map === "string" && Number.isSafeInteger(target.index) && target.index >= 0;
  if (!Array.isArray(recoveryMemory.failures) || recoveryMemory.failures.some((failure) =>
    !validRecoveryTarget(failure?.target) ||
    !Number.isSafeInteger(failure.attempts) || failure.attempts < 1 || failure.attempts > 2
  ) || recoveryMemory.pending !== null && (
    !validRecoveryTarget(recoveryMemory.pending?.target) ||
    !Array.isArray(recoveryMemory.pending.party) ||
    typeof recoveryMemory.pending.sawDialogue !== "boolean" ||
    !Number.isFinite(recoveryMemory.pending.position?.x) ||
    !Number.isFinite(recoveryMemory.pending.position?.y)
  )) throw new TypeError("campaign planner recovery memory is invalid");
  const recoveryTargetKey = (target) => JSON.stringify([target.kind, target.map, target.index]);
  const recoveryParty = (observation) => {
    const party = observation?.playerMemory?.trainer?.party;
    if (!Array.isArray(party) || party.length === 0 || party.some((member) =>
      !Number.isFinite(member.hp) || !Number.isFinite(member.maxHp) ||
      member.maxHp <= 0 || !Number.isFinite(member.status1) ||
      !Array.isArray(member.moves) || !Array.isArray(member.pp) ||
      member.moves.length !== member.pp.length || !member.pp.every(Number.isFinite)
    )) return null;
    return party.map((member) => ({
      identity: JSON.stringify([member.slot, member.species, member.personality ?? null,
        member.otId ?? null, member.moves]),
      hp: member.hp, status1: member.status1, pp: [...member.pp],
    }));
  };
  const observeRecoveryOutcome = (observation) => {
    const pending = recoveryMemory.pending;
    if (!pending) return;
    const memory = observation?.playerMemory;
    if (memory?.map?.id !== pending.target.map ||
      memory?.position?.x !== pending.position.x || memory?.position?.y !== pending.position.y ||
      observation?.emulator?.mode !== "overworld") {
      recoveryMemory.pending = null;
      return;
    }
    const ui = memory.ui ?? {};
    if (ui.fieldDialog || ui.choiceMenu) {
      pending.sawDialogue = true;
      return;
    }
    if (observation?.phase !== "stable" || observation?.emulator?.inputReady === false ||
      memory.scripts?.fieldControlsLocked || Object.values(ui).some(Boolean)) return;
    recoveryMemory.pending = null;
    const after = recoveryParty(observation);
    // A direction change, rejected input, or repeated UI page is not a healing
    // transaction. Require a complete conversation and the same observed party.
    if (!pending.sawDialogue || !after || after.length !== pending.party.length ||
      after.some((member, index) => member.identity !== pending.party[index].identity)) return;
    const improved = after.some((member, index) => {
      const before = pending.party[index];
      return member.hp > before.hp || (before.status1 & ~member.status1) !== 0 ||
        member.pp.some((pp, slot) => pp > before.pp[slot]);
    });
    const key = recoveryTargetKey(pending.target);
    const previous = recoveryMemory.failures.find((failure) => recoveryTargetKey(failure.target) === key);
    recoveryMemory.failures = recoveryMemory.failures.filter((failure) =>
      recoveryTargetKey(failure.target) !== key);
    if (!improved) recoveryMemory.failures.push({
      target: pending.target, attempts: Math.min(2, (previous?.attempts ?? 0) + 1),
    });
  };
  let collectionNavigationSignature = null;
  const restoredCommitments = structuredClone(initialState?.commitments ?? {});
  for (const value of Object.values(restoredCommitments)) {
    if (!value || typeof value !== "object" || typeof value.id !== "string" || !value.target) {
      throw new TypeError("campaign planner commitment is invalid");
    }
  }
  let committedRegionalMasteryObjective = restoredCommitments.regionalMastery ?? null;
  let committedTrainingObjective = restoredCommitments.training ?? null;
  // Keyed by content: callers may reuse and mutate one observation object.
  // Serializing it costs well under a millisecond; one selection costs ~120 ms.
  const trainingSelectionCache = new Map();
  const trainingSelectionStats = { computed: 0, reused: 0 };
  const trainingMeasurements=createTrainingMeasurements(initialState?.trainingMeasurements??null);
  let rejectedTraining=structuredClone(initialState?.rejectedTraining??[]);
  if(!Array.isArray(rejectedTraining)||rejectedTraining.length>64)throw new TypeError('invalid training recovery history');
  const trainingCondition=o=>JSON.stringify((o.playerMemory?.trainer?.party??[]).map(p=>
    [p.otId,p.personality,p.species,p.level,p.moves]).sort((a,b)=>JSON.stringify(a).localeCompare(JSON.stringify(b))));
  let committedFishingObjective = restoredCommitments.fishing ?? null;
  let committedFieldCarrierObjective = restoredCommitments.fieldCarrier ?? null;
  let committedTrainingInfrastructureTransaction = restoredCommitments.infrastructure ?? null;
  let committedBattleMedicineTransaction = restoredCommitments.battleMedicine ?? null;
  const commitTrainingSelection = (selected,observation=null) => {
    tasks.rememberTraining(selected,observation);
    if(observation)trainingMeasurements.commit(selected,observation);
    committedTrainingObjective = selected?.trainingRate||["trainer", "vs-seeker", "vs-seeker-recharge"]
      .includes(selected?.trainingSource) ? structuredClone(selected) : null;
  };
  let battleMedicineServicedForObjectiveId =
    activeCampaign.objectives.some(
      ({ id }) => id === initialState?.battleMedicineServicedForObjectiveId,
    )
      ? initialState.battleMedicineServicedForObjectiveId
      : null;
  let activeMandatoryInterludeObjective = null;
  let activeTransientMapPuzzleObjective = null;
  let activeBoulderRecoveryObjective = null;
  let activeBoulderRecoverySourceObjective = null;
  let activeAcquisitionPrerequisiteObjective = null;
  const fieldCarrierPrerequisite = (objective, observation) => {
    if (teamPlan?.fieldPolicy !== 'utility-hms-v1') return null;
    const move = objective.id === 'prepare-cut-carrier' ? 'cut' :
      objective.target?.kind === 'teach-move' ? ({15:'cut',148:'flash',249:'rockSmash'})[objective.target.moveId] : null;
    if (!move) { committedFieldCarrierObjective=null; return null; }
    const family=fieldCarrierSpecies(teamPlan,move);
    const available=p=>family.includes(Number(p.species));
    const trainer=observation.playerMemory?.trainer;
    if ((trainer?.party ?? []).some(available)) { committedFieldCarrierObjective=null; return null; }
    const prep=activeCampaign.objectives.find(o=>o.id===`prepare-${move}-carrier`) ??
      partyRosterObjective(`prepare-${move}-carrier`,'MAP_VERMILION_CITY_POKEMON_CENTER_1F',{
        requiredFamilies:[family],permanentRoster:false});
    if ((trainer?.storage?.pokemon ?? []).some(available)) { committedFieldCarrierObjective=null; return prep; }
    // Keep an in-flight capture stable through encounters, menus and restart.
    if (committedFieldCarrierObjective?.fieldCarrierFor === move) return committedFieldCarrierObjective;
    const acquisition=teamPlan.utilityAcquisitions.find(a=>a.family.some(id=>family.includes(id)));
    const capture=a=>masterAcquisitionObjectives(a).find(({objective:o})=>o.captureSpecies?.length)?.objective;
    let source=acquisition && capture(acquisition);
    if (!source) return {id:`obtain-${move}-carrier`,target:{kind:'stop-for-review',reason:'utility-acquisition-unavailable'}};
    let target=source.target;
    if (world) {
      const graph=createWorldNavigationGraph(world,observation), query=createRouteMetricsQuery(graph,observation);
      const choices=[acquisition,...(teamPlan.fieldUtilityAlternatives??[]).filter(a=>a.fieldCapabilities.includes(move))];
      const reachable=choices.flatMap((a,priority)=>{
        const source=capture(a);
        return regionalEncounterCatalog.filter(e=>source.captureSpecies.includes(e.speciesId) &&
          e.method==='land' && !e.safari && optionalMapAuthorized(e.map,observation)).flatMap(e=>{
          const target={...source.target,map:e.map},metrics=routeMetrics({graph,observation,target,query});
          return metrics?[{source,target,metrics,priority}]:[];
        });
      }).sort((a,b)=>Number(a.priority>0)-Number(b.priority>0) ||
        a.metrics.transitions-b.metrics.transitions || a.metrics.localSteps-b.metrics.localSteps);
      if (reachable.length) ({source,target}=reachable[0]);
    }
    committedFieldCarrierObjective={...source,target,fieldCarrierFor:move,fieldPolicyUtility:true,
      permanentRoster:false,temporaryRoster:true,helperRole:'field',
      completion:{kind:'available-species',species:family}};
    return committedFieldCarrierObjective;
  };
  const selectFishingHabitat = (objective, observation) => {
    if (objective?.target?.kind !== "fishing-zone" || !objective.captureSpecies?.length) {
      committedFishingObjective = null;
      return objective;
    }
    const rodItemId = Number(objective.target.rodItemId);
    const species = new Set(objective.captureSpecies.map(Number));
    const habitats = regionalEncounterCatalog.filter((encounter) =>
      encounter.method === "fishing" && encounter.rodItemId === rodItemId &&
      species.has(encounter.speciesId) &&
      encounter.safari === Boolean(objective.safari) &&
      optionalMapAuthorized(encounter.map, observation)
    );
    if (!bagHasItem(observation, rodItemId)) return objective;
    const graph = createWorldNavigationGraph(world, observation);
    const query = createRouteMetricsQuery(graph, observation);
    const metricsFor = (target) => routeMetrics({ graph, observation, target, query });
    if (committedFishingObjective?.id === objective.id &&
      committedFishingObjective.target.rodItemId === rodItemId &&
      habitats.some(({ map }) => map === committedFishingObjective.target.map) &&
      metricsFor(committedFishingObjective.target)) {
      return Object.freeze({ ...objective, target: committedFishingObjective.target });
    }
    committedFishingObjective = null;
    // A map's encounter table can describe water reachable only after Surf.
    // Require a route to an actual casting tile, not merely the map entrance.
    if (metricsFor(objective.target)) return objective;
    const candidates = habitats.flatMap((encounter, order) => {
      const target = { ...objective.target, map: encounter.map };
      const metrics = metricsFor(target);
      return metrics ? [{ target, metrics, order }] : [];
    }).sort((left, right) => left.metrics.transitions - right.metrics.transitions ||
      left.metrics.localSteps - right.metrics.localSteps || left.order - right.order);
    if (!candidates.length) return objective;
    committedFishingObjective = Object.freeze({ ...objective,
      target: Object.freeze(candidates[0].target) });
    return committedFishingObjective;
  };
  let minimumStoryObjectiveIndex = restoredCompletedThroughIndex + 1;
  const leagueRecovery=createLeagueRecovery({mechanics,initialState:initialState?.leagueRecovery});
  let activeLeagueRecoveryObjective=null;
  let activeLeagueEntryObjective=null;
  let leagueFunding=structuredClone(initialState?.leagueFunding ?? null);
  const leagueStep=(objective,observation)=>{
    const nextBattleFlag=objective.completion?.completions?.find(c=>c.kind==='flag-set')?.id;
    return nextBattleFlag && watchedFlag(observation,nextBattleFlag)
      ? {complete:true,objective} : leagueRecovery.inspect(objective,observation);
  };
  const incomeFailures=structuredClone(initialState?.incomeFailures??[]);
  // No trainer's route depends on the National Dex layouts (the dug-out tunnel
  // leads only to Three Isle Port's grass), so they do not split income records.
  // The Mansion switch only changes which floor exits apply inside the Mansion;
  // keeping it out also leaves already recorded failure contexts unchanged.
  const incomeCapabilities=capabilities=>Object.fromEntries(Object.entries(capabilities)
    .filter(([key])=>!['currentlySurfing','currentElevation','nationalDexLayouts','mansionSwitchSet'].includes(key)).sort(([a],[b])=>a.localeCompare(b)));
  const incomeContext=o=>JSON.stringify(incomeCapabilities(worldNavigationCapabilities(o)));
  // Old checkpoints keyed failures by the player's current map and transient
  // surface. Migrate those records instead of granting their candidates a reset.
  for(const failure of incomeFailures){
    try{const old=JSON.parse(failure.context);if(Array.isArray(old)&&old[1])failure.context=JSON.stringify(incomeCapabilities(old[1]));}catch{}
  }
  let incomePlan=structuredClone(initialState?.incomePlan??null);
  const rejectIncomePreparation=(objective,o,now=Date.now())=>{
    incomePlan=null;
    const ids=objective.vsSeekerBatch?.trainerIds??[objective.trainer?.id];
    const context=incomeContext(o);
    for(const id of ids.filter(Number.isSafeInteger)){
      let failed=incomeFailures.find(f=>f.id===id&&f.context===context);
      if(!failed){failed={id,context,attempts:0};incomeFailures.push(failed);}
      failed.attempts++;failed.retryAt=now+300000;
    }
    if(incomeFailures.length>128)incomeFailures.splice(0,incomeFailures.length-128);
  };
  const selectIncomePreparation = (observation,now=Date.now()) => {
      const context=incomeContext(observation);
      const t=observation.playerMemory?.trainer;
      if(t?.partyValidity!=='valid')return null;
      if(incomePlan&&(incomePlan.context!==context||
          t.money>incomePlan.money&&observation.playerMemory?.gameStats?.trainerBattles>incomePlan.trainerBattles))incomePlan=null;
      if(incomePlan&&observation.emulator?.inBattle)return structuredClone(incomePlan.objective);
      const strongest=[...t.party].filter(p=>p.hp>0&&hasAttackingMove(p,mechanics)).sort((a,b)=>b.level-a.level)[0];
      if(!strongest)return null;
      if(!bagHasItem(observation,VS_SEEKER_ITEM_ID))return MAIN_STORY_CAMPAIGN.objectives.find(o=>o.id==='vs-seeker');
      const graph=createWorldNavigationGraph(world,observation),query=createRouteMetricsQuery(graph,observation);
      const responseReachable=vsSeekerResponseReachability(world,observation);
      // Revalidate the committed area against fresh NPC/response evidence.
      // Ranking every trainer in the world at each walking step both changes
      // the plan unnecessarily and blocks decisions with redundant routing.
      const catalog=incomePlan?trainerTrainingCatalog.filter(entry=>entry.target.map===incomePlan.objective.target.map):trainerTrainingCatalog;
      const candidates=catalog.flatMap(entry=>{
        const trainer=resolveTrainerTrainingEntry(entry,observation,responseReachable);
        if(!trainer||!(trainer.expectedPayout>0)||trainer.maximumLevel>strongest.level-5||!optionalMapAuthorized(trainer.target.map,observation))return [];
        if(incomeFailures.some(f=>f.id===trainer.id&&f.context===context&&(f.attempts>=3||f.retryAt>now)))return [];
        const metrics=routeMetrics({graph,observation,target:trainer.target,query});
        return metrics?[{trainer,target:trainer.target,metrics,riskTier:0,trainingMethod:'direct'}]:[];
      });
      const batches=buildVsSeekerBatchCandidates({graph,observation,candidates,healerTransitionDistance:()=>0,objectiveTransitionDistance:()=>0});
      const rate=c=>(c.vsSeekerBatch?.expectedPayout??c.trainer.expectedPayout)/(30*(c.vsSeekerBatch?.partySize??c.trainer.partySize)+c.metrics.transitions*10+c.metrics.localSteps/4+(c.trainer.vsSeekerAction==='recharge'?30:0));
      const failures=c=>{const ids=c.vsSeekerBatch?.trainerIds??[c.trainer.id];return incomeFailures.filter(f=>ids.includes(f.id)).reduce((n,f)=>n+f.attempts,0);};
      const committed=c=>incomePlan&&Number(c.trainer.baseId??c.trainer.id)===incomePlan.trainerId;
      batches.sort((a,b)=>Number(Boolean(committed(b)))-Number(Boolean(committed(a)))||Number(b.trainer.vsSeekerAction==='battle')-Number(a.trainer.vsSeekerAction==='battle')||failures(a)-failures(b)||rate(b)-rate(a));
      const selected=batches[0];
      if(!selected){if(incomePlan){incomePlan=null;return selectIncomePreparation(observation,now);}return null;}
      const {trainer}=selected,recharge=trainer.vsSeekerAction==='recharge';
      const fundingBattler=incomePlan?.objective.fundingBattler??{identity:campaignMemberIdentity(strongest),slot:strongest.slot,species:strongest.species};
      const objective={id:'fund-capture-supplies',incomePreparation:true,fundingBattler,target:recharge?{...selected.target,kind:'vs-seeker-recharge'}:selected.target,
        trainingSource:recharge?'vs-seeker-recharge':trainer.rematch?'vs-seeker':'trainer',vsSeekerAction:trainer.vsSeekerAction,
        ...(selected.vsSeekerBatch?{vsSeekerBatch:selected.vsSeekerBatch}:{}),trainer:trainingObjectiveTrainer(trainer),
        expectedPayout:selected.vsSeekerBatch?.expectedPayout??trainer.expectedPayout,dialogue:'advance',choice:'yes',deferOptionalDetours:true};
      incomePlan={context,trainerId:Number(trainer.baseId??trainer.id),money:incomePlan?.money??t.money,
        trainerBattles:incomePlan?.trainerBattles??observation.playerMemory?.gameStats?.trainerBattles??0,objective};
      return structuredClone(objective);
  };
  const selectLeagueEntryPreparation=(objective,observation)=>{
    if(!['league-supplies','elite-four-lorelei'].includes(objective?.id)) {leagueFunding=null;return null;}
    if(observation.emulator?.inBattle || observation.emulator?.mode==='battle') return leagueFunding?.objective ?? null;
    if(!leagueFunding && observation.playerMemory?.map?.id!=='MAP_INDIGO_PLATEAU_POKEMON_CENTER_1F') return null;
    const party=observation.playerMemory?.trainer?.party ?? [];
    const targetLevel=Number(objective.minimumBattleMemberLevel ?? objective.minimumTeamAnchorLevel ?? objective.minimumCoreLevel ?? 0);
    const ready=party.filter(p=>Number(p.level)>=targetLevel).length;
    if(!leagueFunding && objective.id==='elite-four-lorelei' && (party.length<Number(objective.minimumBattlePartySize ?? 1) ||
      ready<Number(objective.minimumReadyBattleMembers ?? party.length))) return null;
    const supplies=MAIN_STORY_CAMPAIGN.objectives.find(o=>o.id==='league-supplies');
    const missing=supplies.target.items.filter(({itemId,quantity})=>
      bagQuantity(observation,entry=>Number(entry.itemId)===itemId)<quantity);
    if(missing.length) {
      const cost=missing.reduce((sum,{itemId,quantity,unitPrice})=>sum+
        Math.max(0,quantity-bagQuantity(observation,entry=>Number(entry.itemId)===itemId))*unitPrice,0);
      if(Number.isFinite(observation.playerMemory?.trainer?.money) && observation.playerMemory.trainer.money<cost) {
        // Preserve the owner through menus and trainer battles. Recompute the
        // price after each battle because healing can consume the reserve.
        if(leagueFunding?.objective && observation.emulator?.mode!=='overworld') return leagueFunding.objective;
        const needsRest=party.some(p=>Number(p.hp)<Number(p.maxHp)*0.6||!hasUsableAttackingPp(p,mechanics));
        if(leagueFunding?.healing || needsRest){
          const healing=leagueFunding?.healing ?? selectRecoveryObjective({world,story,observation,
            excludedTargets:recoveryMemory.failures.filter(f=>f.attempts>=2).map(f=>f.target)});
          if(healing && (!partyFullyRestored(observation.playerMemory,mechanics)||Object.values(observation.playerMemory.ui??{}).some(Boolean))){
            const next={...healing,taskKind:'recovery',dialogue:'advance',deferOptionalDetours:true};
            leagueFunding={parentObjectiveId:objective.id,objective:next,healing:next};
            return next;
          }
        }
        const income=selectIncomePreparation(observation);
        const next=income ? {...income,id:'fund-league-supplies',forObjective:objective.id,targetMoney:cost}
          : {id:'fund-league-supplies',target:{kind:'stop-for-review',reason:'league-income-route-unavailable'},targetMoney:cost};
        leagueFunding={parentObjectiveId:objective.id,objective:next};
        return next;
      }
      if(leagueFunding) leagueFunding.objective={...supplies,id:'league-entry-supplies'};
      return {...supplies,id:'league-entry-supplies'};
    }
    leagueFunding=null;
    if(objective.id==='league-supplies') return null;
    if(!partyFullyRestored(observation.playerMemory,mechanics)) {
      return {...MAIN_STORY_CAMPAIGN.objectives.find(o=>o.id==='league-heal'),id:'league-entry-heal'};
    }
    const step=leagueRecovery.inspect({id:'league-entry-save',target:{kind:'save-game'},deferOptionalDetours:true},observation);
    return step.complete ? null : step.objective;
  };
  const leagueRetryStartIndex = activeCampaign.objectives.findIndex(
    ({ id }) => id === "league-heal",
  );
  const leagueFirstBattleIndex = activeCampaign.objectives.findIndex(
    ({ id }) => id === "elite-four-lorelei",
  );
  const leagueChampionIndex = activeCampaign.objectives.findIndex(
    ({ id }) => id === "champion",
  );
  const reconcileLeagueBlackout = (observation) => {
    if (
      leagueRetryStartIndex < 0 ||
      leagueFirstBattleIndex < 0 ||
      leagueChampionIndex < 0 ||
      minimumStoryObjectiveIndex <= leagueFirstBattleIndex
    ) return false;
    const flagIds = observation?.playerMemory?.storyState?.flagIds ?? {};
    const resetFlags = [HALL_OF_FAME_FLAG_ID, ...LEAGUE_BATTLE_FLAG_IDS];
    if (!resetFlags.every((id) => Object.hasOwn(flagIds, id))) return false;
    if (
      flagIds[HALL_OF_FAME_FLAG_ID] === true ||
      LEAGUE_BATTLE_FLAG_IDS.some((id) => flagIds[id] === true)
    ) return false;
    minimumStoryObjectiveIndex = leagueRetryStartIndex;
    leagueRecovery.reset();
    activeLeagueRecoveryObjective=null;
    activeLeagueEntryObjective=null;
    committedRegionalMasteryObjective = null;
    committedTrainingObjective = null;
    committedTrainingInfrastructureTransaction = null;
    committedBattleMedicineTransaction = null;
    battleMedicineServicedForObjectiveId = null;
    activeTransientMapPuzzleObjective = null;
    activeBoulderRecoveryObjective = null;
    activeBoulderRecoverySourceObjective = null;
    return true;
  };
  const selectActiveStoryObjective = (observation) => {
    activeAcquisitionPrerequisiteObjective = null;
    reconcileLeagueBlackout(observation);
    const currentMap = observation?.playerMemory?.map?.id;
    if (
      activeTransientMapPuzzleObjective &&
      (
        objectiveCompleted(activeTransientMapPuzzleObjective, observation, mechanics) ||
        (currentMap && resolveTarget(
          activeTransientMapPuzzleObjective.target,
          observation,
        )?.map !== currentMap)
      )
    ) {
      activeTransientMapPuzzleObjective = null;
    }
    const activeInterlude = mandatoryInterludes.find((interlude) =>
      completed(interlude.activation, observation, mechanics) &&
      !completed(interlude.completion, observation, mechanics)
    );
    activeMandatoryInterludeObjective = activeInterlude?.objectives.find(
      (objective) => !objectiveCompleted(objective, observation, mechanics),
    ) ?? null;
    if (activeMandatoryInterludeObjective) {
      return activeMandatoryInterludeObjective;
    }
    if (activeTransientMapPuzzleObjective) {
      return activeTransientMapPuzzleObjective;
    }
    const relativeIndex = activeCampaign.objectives
      .slice(minimumStoryObjectiveIndex)
      .findIndex((objective) => objective.target?.saveAfterRecovery
        ? !leagueStep(objective,observation).complete
        : !objectiveCompleted(objective, observation, mechanics));
    if (relativeIndex < 0) {
      minimumStoryObjectiveIndex = activeCampaign.objectives.length;
      return null;
    }
    minimumStoryObjectiveIndex += relativeIndex;
    const objective = activeCampaign.objectives[minimumStoryObjectiveIndex];
    // A field-move evolution does not unlock travel until its badge is earned.
    // Let the badge's normal readiness and story battles run first. Keep the
    // original prefix, so completion/restart returns to the unfinished carrier.
    if(objective.target?.kind==='roster-training' && objective.fieldAccessObjective) {
      const access=activeCampaign.objectives.find(o=>o.id===objective.fieldAccessObjective);
      if(access && !objectiveCompleted(access,observation,mechanics)) {
        activeAcquisitionPrerequisiteObjective=access;return access;
      }
    }
    activeAcquisitionPrerequisiteObjective=fieldCarrierPrerequisite(objective,observation);
    if (activeAcquisitionPrerequisiteObjective) return activeAcquisitionPrerequisiteObjective;
    activeLeagueRecoveryObjective=objective.target?.saveAfterRecovery
      ? leagueStep(objective,observation).objective : null;
    if(activeLeagueRecoveryObjective) return activeLeagueRecoveryObjective;
    if (objective?.acquisitionId && objective.captureSpecies?.length &&
      acquisitionTargetRequiresSurf(objective.target) &&
      !worldNavigationCapabilities(observation).canSurf) {
      const prerequisiteIds = watchedFlag(observation, 2084)
        ? ["prepare-surf-carrier", "train-surf-carrier", "teach-surf"]
        : ["badge-soul"];
      activeAcquisitionPrerequisiteObjective = prerequisiteIds
        .map(id => activeCampaign.objectives.find(candidate => candidate.id === id))
        .find(candidate => candidate && !objectiveCompleted(candidate, observation, mechanics)) ?? null;
      // Keep the mandatory acquisition pending while an observed prerequisite
      // is restored. Neither its identity nor the completed prefix is skipped.
      if (activeAcquisitionPrerequisiteObjective) return activeAcquisitionPrerequisiteObjective;
    }
    if (world && isProgressObservation(observation) &&
        observation.emulator.mode === "overworld") {
      const resetPuzzle = activeCampaign.objectives
        .slice(0, minimumStoryObjectiveIndex)
        .find((candidate) => isResettableMapObjective(candidate) &&
          resolveTarget(candidate.target, observation)?.map === currentMap &&
          completionEvidenceKnown(candidate.completion, observation) &&
          !objectiveCompleted(candidate, observation, mechanics) &&
          // A prior switch is a local prerequisite only when its puzzle is
          // executable here. Transit to a different passage must retain the
          // current objective instead of repeatedly reselecting old switches.
          campaignNavigationRecommendation({world, observation,
            objective: { ...candidate, victoryRoadConcrete: true }}) !== null);
      if (resetPuzzle) {
        activeTransientMapPuzzleObjective = resetPuzzle;
        return activeTransientMapPuzzleObjective;
      }
    }
    return objective;
  };
  const selectBoulderRecoveryObjective = (objective, observation) => {
    const currentMap = observation?.playerMemory?.map?.id;
    if (
      activeBoulderRecoveryObjective &&
      (
        !objective ||
        objective.id !== activeBoulderRecoverySourceObjective?.id ||
        objectiveCompleted(
          activeBoulderRecoverySourceObjective,
          observation,
          mechanics,
        ) ||
        (currentMap && currentMap !== activeBoulderRecoverySourceObjective?.target?.map)
      )
    ) {
      activeBoulderRecoveryObjective = null;
      activeBoulderRecoverySourceObjective = null;
    }
    if (activeBoulderRecoveryObjective) return activeBoulderRecoveryObjective;
    if (
      observation?.emulator?.mode !== "overworld" ||
      authoredBoulderLivePathState({ world, observation, objective }) !== "off-path" ||
      objective?.authoredBoulderResetTarget?.kind !== "warp"
    ) return objective;
    activeBoulderRecoverySourceObjective = objective;
    activeBoulderRecoveryObjective = Object.freeze({
      ...objective,
      target: Object.freeze(structuredClone(objective.authoredBoulderResetTarget)),
      boulderRecoveryFor: objective.id,
      boulderRecoveryPhase: "reload-floor",
      deferOptionalDetours: true,
    });
    return activeBoulderRecoveryObjective;
  };
  const completedThroughObjectiveId = () => minimumStoryObjectiveIndex > 0
    ? activeCampaign.objectives[
        Math.min(minimumStoryObjectiveIndex, activeCampaign.objectives.length) - 1
      ]?.id ?? null
    : null;
  const observeCollectionState = (observation) => {
    if (!isProgressObservation(observation)) return;
    const currentMap = observation?.playerMemory?.map?.id;
    if (currentMap) visitedMaps.add(currentMap);
    const numericFlags = observation?.playerMemory?.storyState?.flagIds ?? {};
    const namedFlags = observation?.playerMemory?.storyState?.flags ?? {};
    for (const location of collectionCatalog) {
      if (
        numericFlags[location.flagId] === true ||
        namedFlags[location.flagName] === true
      ) {
        collectedLocations.add(location.id);
      }
    }
  };
  const completionLeaves = (completion) =>
    ["any", "all"].includes(completion?.kind)
      ? (completion.completions ?? []).flatMap(completionLeaves)
      : [completion];
  const watchedObjectives = [
    ...activeCampaign.objectives,
    ...mandatoryInterludes.flatMap(({ objectives }) => objectives ?? []),
    // Transit can reopen these puzzles after the story campaign has ended.
    ...MAIN_STORY_CAMPAIGN.objectives.filter(({ target }) =>
      VICTORY_ROAD_MAPS.has(target?.map) &&
      (worldData(world).maps ?? []).some(({ id }) => id === target.map)),
  ];
  const completions = watchedObjectives.flatMap(({ completion }) =>
    completionLeaves(completion)
  );
  const observedStoryRequirements = [
    ...completions,
    ...mandatoryInterludes.flatMap(({ activation, completion }) => [
      ...completionLeaves(activation),
      ...completionLeaves(completion),
    ]),
    ...Object.values(OPTIONAL_MAP_REQUIREMENTS).flatMap(completionLeaves),
  ];
  const storyWatch = Object.freeze({
    variables: Object.freeze([...new Set([
      SILPH_HEALER_SCENE_VARIABLE_ID,
      NATIONAL_DEX_VARIABLE_ID,
      ...SEAGALLOP_WATCH_VARIABLES,
      ...freeHealerRequirementIds(story, "variables"),
      ...observedStoryRequirements
        .filter((completion) => [
          "variable-at-least",
          "variable-between",
        ].includes(completion?.kind))
        .map((completion) => completion.id),
      ...watchedObjectives.flatMap(({ target }) =>
        target?.kind === "variable-background" ? [target.variableId] : []),
      ...watchedObjectives.flatMap(({ target, rocketHideoutElevator }) =>
        rocketHideoutElevator || target?.kind === "rocket-hideout-exit"
          ? [0x403a]
          : []),
    ])].sort((left, right) => left - right)),
    flags: Object.freeze([...new Set([
      2095,
      NATIONAL_DEX_FLAG_ID,
      VS_SEEKER_FLAG_ID,
      VS_SEEKER_CELADON_VISITED_FLAG_ID,
      VS_SEEKER_FUCHSIA_VISITED_FLAG_ID,
      VS_SEEKER_GAME_CLEAR_FLAG_ID,
      VS_SEEKER_RS_LINK_FLAG_ID,
      ...KANTO_FLY_DESTINATION_VISITED_FLAG_IDS,
      ...watchedObjectives.flatMap(({ watchFlags }) => watchFlags ?? []),
      ...observedStoryRequirements
        .filter((completion) => completion?.kind === "flag-set")
        .map((completion) => completion.id),
      ...observedStoryRequirements
        .filter((completion) => completion?.kind === "flag-unset")
        .map((completion) => completion.id),
      ...watchedObjectives.flatMap(({ target }) =>
        target?.kind === "push-boulder" ? [2053] : []),
      ...watchedObjectives.flatMap(({ target }) =>
        target?.kind === "mansion-secret-key" ? [620] : []),
      ...freeHealerRequirementIds(story, "flags"),
      ...collectionCatalog.map(({ flagId }) => flagId),
      ...trainerTrainingCatalog.flatMap(({ flagId, rematchParties }) => [
        flagId,
        ...(rematchParties ?? []).flatMap((party) => party ? [party.flagId] : []),
      ]),
      ...regionalTrainerCatalog.map(({ flagId }) => flagId),
      ...OAK_AIDE_REWARDS.map(({ flagId }) => flagId),
    ])].sort((left, right) => left - right)),
  });
  return Object.freeze({
    routeMetrics(observation, target) {
      return routeMetrics({
        graph: createWorldNavigationGraph(world, observation),
        observation,
        target,
      });
    },
    recoverStalledTask(observation,{commit=true}={}){
      const m=observation?.playerMemory;
      if(!isProgressObservation(observation)||observation.emulator.mode!=='overworld'||observation.emulator.inBattle||
        m?.scripts?.fieldControlsLocked||m?.questLog?.playback||Object.values(m?.ui??{}).some(Boolean)||
        /UNION_ROOM|TRADE|COLOSSEUM|CABLE_CLUB/.test(m?.map?.id??''))return null;
      const healing=tasks.recovery()?.objective??(recoveryMemory.pending?{target:recoveryMemory.pending.target}:null);
      if(healing){
        const from=healing.target,alternative=selectRecoveryObjective({world,story,observation,
          excludedTargets:[from,...recoveryMemory.failures.filter(f=>f.attempts>=2).map(f=>f.target)]});
        if(!alternative)return null;
        if(commit){
          recoveryMemory.failures=recoveryMemory.failures.filter(f=>recoveryTargetKey(f.target)!==recoveryTargetKey(from));
          recoveryMemory.failures.push({target:structuredClone(from),attempts:2});recoveryMemory.pending=null;
          tasks.retargetRecovery(alternative);
        }
        return {kind:'alternate-healer',objective:activeCampaign.objectives[minimumStoryObjectiveIndex]?.id??null,from,to:alternative.target};
      }
      const current=committedTrainingObjective;
      if(!current||!['trainer','vs-seeker','vs-seeker-recharge','wild'].includes(current.trainingSource)&&current.target?.kind!=='encounter-zone')return null;
      const objective=activeCampaign.objectives.find(o=>o.id===current.forObjective);
      if(!objective)return null;
      const condition=trainingCondition(observation),rejected={objective:current.forObjective,condition,
        trainers:current.trainer?[current.trainer.id,current.trainer.baseId,...(current.vsSeekerBatch?.trainerIds??[])].filter(Number.isFinite):[],
        maps:current.target.kind==='encounter-zone'?[current.target.map]:[]};
      const failures=[...rejectedTraining.filter(r=>r.objective===current.forObjective&&r.condition===condition),rejected];
      const alternative=selectTrainingObjective({world,story,mechanics,observation,objective,teamPlan,trainerCatalog:trainerTrainingCatalog,
        excludedTrainerIds:failures.flatMap(r=>r.trainers),excludedTrainingMaps:failures.flatMap(r=>r.maps),
        trainingTask:tasks.trainingFor(observation,current.forObjective),trainingSamples:trainingMeasurements.samples()});
      if(!alternative||JSON.stringify(alternative.target)===JSON.stringify(current.target))return null;
      if(commit){rejectedTraining=[...rejectedTraining,rejected].slice(-64);commitTrainingSelection(alternative,observation);}
      return {kind:'alternate-training',objective:current.forObjective,from:current.target,to:alternative.target,condition};
    },
    safetyCheck(observation){if(isMajorBattle(observation,mechanics))trainingMeasurements.clear();else trainingMeasurements.observe(observation);tasks.observe(observation);return tasks.blocked();},
    select(observation) {
      if(isMajorBattle(observation,mechanics))trainingMeasurements.clear();else trainingMeasurements.observe(observation);
      tasks.observe(observation);
      observeRecoveryOutcome(observation);
      const task=tasks.recovery();
      if(task){
        const failed=recoveryMemory.failures.some(f=>f.attempts>=2&&recoveryTargetKey(f.target)===recoveryTargetKey(task.objective.target));
        if(failed){
          const alternative=selectRecoveryObjective({world,story,observation,excludedTargets:recoveryMemory.failures.filter(f=>f.attempts>=2).map(f=>f.target)});
          if(!alternative){tasks.block('recovery-healers-exhausted');return {...task.objective,target:{kind:'stop-for-review',reason:'recovery-healers-exhausted'}};}
          tasks.retargetRecovery(alternative);
        }
        return tasks.recovery().objective;
      }
      const objective = selectFishingHabitat(selectBoulderRecoveryObjective(
        selectActiveStoryObjective(observation),
        observation,
      ), observation);
      tasks.selectParent(objective?.rosterPreparationFor??objective?.id??null,observation);
      activeLeagueEntryObjective=selectLeagueEntryPreparation(objective,observation);
      if(activeLeagueEntryObjective) return activeLeagueEntryObjective;
      if (
        battleMedicineServicedForObjectiveId !== null &&
        battleMedicineServicedForObjectiveId !== objective?.id
      ) {
        battleMedicineServicedForObjectiveId = null;
      }
      if (
        battleMedicineServicedForObjectiveId === objective?.id &&
        objective?.importantBattle &&
        !importantBattleMedicineCriticalReserveSatisfied(observation, objective)
      ) {
        battleMedicineServicedForObjectiveId = null;
      }
      if (
        committedBattleMedicineTransaction &&
        committedBattleMedicineTransaction.battleMedicineFor !== objective?.id
      ) {
        committedBattleMedicineTransaction = null;
      }
      if (
        committedBattleMedicineTransaction &&
        objectiveCompleted(
          committedBattleMedicineTransaction,
          observation,
          mechanics,
        )
      ) {
        if (completed(
          committedBattleMedicineTransaction.completion,
          observation,
          mechanics,
        )) {
          battleMedicineServicedForObjectiveId =
            committedBattleMedicineTransaction.battleMedicineFor;
        }
        committedBattleMedicineTransaction = null;
      }
      if (committedBattleMedicineTransaction) {
        return committedBattleMedicineTransaction;
      }
      if (
        committedTrainingInfrastructureTransaction &&
        objectiveCompleted(
          committedTrainingInfrastructureTransaction,
          observation,
          mechanics,
        )
      ) {
        committedTrainingInfrastructureTransaction = null;
      }
      // Dynamic infrastructure objectives are selected only from a stable
      // overworld route proof. Once one opens a cartridge menu or battle, keep
      // that exact transaction until its durable flag/item/species condition
      // proves completion; otherwise unrelated story-training policy can seize
      // the temporary UI and close it.
      if (
        observation?.emulator?.mode !== "overworld" &&
        committedTrainingInfrastructureTransaction
      ) {
        return committedTrainingInfrastructureTransaction;
      }
      const mandatoryCaptureObjective = Boolean(
        objective && (
          (objective.captureSpecies ?? []).length > 0 ||
          objective.captureAnyNewSpecies === true
        ),
      );
      const mandatoryAcquisitionObjective = Boolean(objective?.acquisitionId);
      const mandatoryPuzzleObjective =
        isResettableMapObjective(objective) ||
        ["push-boulder", "variable-background"].includes(objective?.target?.kind) ||
        Boolean(objective?.boulderRecoveryFor);
      if (
        objective?.importantBattle &&
        observation?.emulator?.mode === "overworld" &&
        !mandatoryCaptureObjective &&
        !mandatoryAcquisitionObjective &&
        !mandatoryPuzzleObjective &&
        !objective?.mandatoryInterlude &&
        objective?.deferOptionalDetours !== true &&
        battleMedicineServicedForObjectiveId !== objective.id &&
        importantBattleMedicineReserveSatisfied(observation, objective)
      ) {
        battleMedicineServicedForObjectiveId = objective.id;
      }
      const regionalMasteryAllowed = !mandatoryCaptureObjective &&
        !mandatoryAcquisitionObjective &&
        !mandatoryPuzzleObjective &&
        !objective?.mandatoryInterlude &&
        objective?.deferOptionalDetours !== true &&
        Boolean(objective || watchedFlag(observation, 2092));
      const battleMedicineObjective =
        !mandatoryCaptureObjective &&
        !mandatoryAcquisitionObjective &&
        !mandatoryPuzzleObjective &&
        objective?.id !== battleMedicineServicedForObjectiveId
          ? selectImportantBattleMedicineSupplyObjective({
              world,
              observation,
              objective,
              martCatalog: pokeBallMartCatalog,
            })
          : null;
      if (battleMedicineObjective) {
        committedBattleMedicineTransaction = battleMedicineObjective;
        return committedBattleMedicineTransaction;
      }
      const trainingInfrastructureObjective =
        selectTrainingInfrastructureObjective({
          world,
          observation,
          encounterCatalog: regionalEncounterCatalog,
          objective,
          teamPlan,
        });
      const masteryObjective = !trainingInfrastructureObjective && regionalMasteryAllowed
        ? selectRegionalMasteryObjective({
            world,
            observation,
            teamPlan,
            trainerCatalog: regionalTrainerCatalog,
            encounterCatalog: regionalEncounterCatalog,
            preferredObjectiveId: committedRegionalMasteryObjective?.id,
          })
        : null;
      committedRegionalMasteryObjective = masteryObjective;
      const selected = trainingInfrastructureObjective ?? masteryObjective ?? objective;
      const selectedTransaction = selected
        ? selectRegionalMasterySupplyObjective({
            world,
            observation,
            objective: selected,
            martCatalog: pokeBallMartCatalog,
            mechanics,
          }) ?? selectCaptureSupplyObjective({
            world,
            observation,
            objective: selected,
            martCatalog: pokeBallMartCatalog,
            mechanics,
          }) ?? selected
        : null;
      committedTrainingInfrastructureTransaction = trainingInfrastructureObjective
        ? selectedTransaction
        : null;
      return selectedTransaction;
    },
    selectIncomePreparation,
    rejectIncomePreparation,
    selectPokedexPreparation(observation, count, {minimumEncounterShare=count>60?0:10}={}) {
      if (!Number.isInteger(count) || count < 1 || count > 386) throw new Error('Invalid Pokédex preparation count.');
      if(!Number.isFinite(minimumEncounterShare)||minimumEncounterShare<0||minimumEncounterShare>100)throw new Error('Invalid encounter share.');
      const selected=selectTrainingInfrastructureObjective({world,observation,encounterCatalog:regionalEncounterCatalog,objective:null,teamPlan,pokedexGoal:count,minimumEncounterShare});
      return selected ? selectRegionalMasterySupplyObjective({world,observation,objective:selected,martCatalog:pokeBallMartCatalog,mechanics}) ?? selectCaptureSupplyObjective({world,observation,objective:selected,martCatalog:pokeBallMartCatalog,mechanics}) ?? selected : null;
    },
    // excludeLocationIds: catalogued collection ids a task cannot use (the
    // Mail supply skips Route 17's hidden candy on the Cycling Road slope).
    selectItemPreparation(observation, itemId, quantity=1, {excludeLocationIds=[]}={}) {
      if(!Number.isInteger(itemId)||itemId<1||!Number.isInteger(quantity)||quantity<1)throw Error('Invalid item preparation.');
      const excluded=new Set(excludeLocationIds);
      const graph=createWorldNavigationGraph(world,observation);
      const prices={64:9800,65:9800,95:2100,96:2100,97:2100,98:2100};
      const candidates=[];
      for(const mart of pokeBallMartCatalog){
        const stock=mart.stock.find(i=>i.itemId===itemId),price=prices[itemId];
        if(!stock||!price||!optionalMapAuthorized(mart.map,observation)||Number(observation.playerMemory?.trainer?.money)<price*quantity)continue;
        // A mart on another island (or back in Kanto) is reached by the same
        // Seagallop leg as an item ball below: measure its clerk from that
        // island's ferry landing and rank it after every same-island source.
        // The Celadon Department Store is the only Fire Stone seller on the
        // navigation graph, so an Eevee hatched at the Four Island Day Care
        // could never become Flareon.
        const crossing=fireRedIsland(mart.map)!==fireRedIsland(observation?.playerMemory?.map?.id);
        const metrics=routeMetrics({graph,observation,target:mart.target})??(crossing&&
          campaignTargetReachable({world,observation,target:mart.target,origins:[fireRedFerryArrival(mart.map)],exact:true})?{transitions:1000,localSteps:0}:null);
        if(metrics)candidates.push({metrics,objective:{id:`evolution-buy-${itemId}`,target:{kind:'purchase-items',map:mart.map,objectIndex:mart.objectIndex,items:[{itemId,quantity,unitPrice:price,stockIndex:stock.stockIndex}]},dialogue:'advance',choice:'yes',deferOptionalDetours:true,identityEvolution:true}});
      }
      for(const location of collectionCatalog){
        // Ruin Valley's Sun Stone sits behind three Strength boulders. The coarse
        // graph reaches it from inside the valley, but only the reviewed push
        // order opens it (suite/ruin-valley-route.js), so it is never an
        // ordinary supply: the postgame collects it on that route first.
        if(location.map===RUIN_VALLEY&&location.target?.kind==='object'&&location.target.index===SUN_STONE.objectIndex)continue;
        if(excluded.has(location.id)||location.itemId!==itemId||watchedFlag(observation,location.flagId)||!optionalMapAuthorized(location.map,observation)||!collectionLocationAuthorized(location,observation)||location.underfoot&&!bagHasItem(observation,261)||location.requiredItemId&&!bagHasItem(observation,location.requiredItemId))continue;
        // An item on another island (or back in Kanto) is reached by the
        // Seagallop leg resolveFireRedTravel plans; measure it from that landing
        // and rank it after every same-island source. Its flag must read false,
        // and the ball's own cell must be reachable (exact), the contract
        // routeMetrics applies once on that island: entering the map is not
        // reaching the ball (Ruin Valley's Sun Stone and Sevault Canyon's
        // King's Rock sit behind Strength boulders).
        const crossing=fireRedIsland(location.map)!==fireRedIsland(observation?.playerMemory?.map?.id);
        const metrics=routeMetrics({graph,observation,target:location.target})??(crossing&&observation?.playerMemory?.storyState?.flagIds?.[location.flagId]===false&&
          campaignTargetReachable({world,observation,target:location.target,origins:[fireRedFerryArrival(location.map)],exact:true})?{transitions:1000,localSteps:0}:null);
        if(metrics)candidates.push({metrics,objective:{id:`evolution-${location.id}`,target:location.target,completion:{kind:'flag-set',id:location.flagId},collectionKind:location.kind,itemId,underfoot:location.underfoot,dialogue:'advance',deferOptionalDetours:true,identityEvolution:true}});
      }
      candidates.sort((a,b)=>a.metrics.transitions-b.metrics.transitions||a.metrics.localSteps-b.metrics.localSteps);
      return candidates[0]?.objective??null;
    },
    selectCollection(observation, priorityObjective = null) {
      const currentMap = observation?.playerMemory?.map?.id;
      if (!currentMap) return null;
      observeCollectionState(observation);
      if (priorityObjective) return null;
      const navigationSignature = JSON.stringify({
        capabilities: worldNavigationCapabilities(observation),
        unavailableMaps: [...unavailableStoryMaps(observation)].sort(),
      });
      if (
        collectionNavigationSignature !== null &&
        collectionNavigationSignature !== navigationSignature
      ) {
        locallyDeferredCollections.clear();
      }
      collectionNavigationSignature = navigationSignature;
      const activeStoryObjective = selectActiveStoryObjective(observation);
      const activeStoryTargetMap = resolveTarget(
        activeStoryObjective?.target,
        observation,
      )?.map;
      const committedToCurrentStoryMap = activeStoryTargetMap === currentMap;
      const graph = createWorldNavigationGraph(world, observation);
      const candidates = collectionCatalog.flatMap((location, order) => {
        // A failed local proof remains authoritative after the player leaves;
        // otherwise the coarse world graph can immediately send them back.
        // Revisit the target map or gain a navigation capability to retry it.
        const locallyDeferredElsewhere =
          locallyDeferredCollections.has(location.id) &&
          location.map !== currentMap;
        // Opportunistic collection may interrupt travel, but never abandon the
        // map containing the currently available mandatory story action.
        const leavesActiveStoryMap =
          committedToCurrentStoryMap && location.map !== currentMap;
        if (
          !visitedMaps.has(location.map) ||
          collectedLocations.has(location.id) ||
          operatorDeferredCollections.has(location.id) ||
          locallyDeferredElsewhere ||
          leavesActiveStoryMap ||
          !optionalMapAuthorized(location.map, observation) ||
          !collectionLocationAuthorized(location, observation) ||
          location.underfoot && !bagHasItem(observation, 261) ||
          location.requiredItemId &&
            !bagHasItem(observation, location.requiredItemId) ||
          !bagCanReceive(observation, location.itemId, location.quantity)
        ) return [];
        const metrics = routeMetrics({
          graph,
          observation,
          target: location.target,
        });
        if (location.map === currentMap) {
          if (metrics) locallyDeferredCollections.delete(location.id);
          else locallyDeferredCollections.add(location.id);
        }
        return metrics ? [{ location, metrics, order }] : [];
      });
      candidates.sort((left, right) =>
        left.metrics.transitions - right.metrics.transitions ||
        left.metrics.localSteps - right.metrics.localSteps ||
        left.order - right.order
      );
      const selected = candidates[0]?.location;
      return selected
        ? Object.freeze({
            id: selected.id,
            target: selected.target,
            completion: Object.freeze({ kind: "flag-set", id: selected.flagId }),
            collectionKind: selected.kind,
            itemName: selected.itemName,
            itemId: selected.itemId,
            quantity: selected.quantity,
            flagName: selected.flagName,
            flagId: selected.flagId,
            underfoot: selected.underfoot,
          })
          : null;
    },
    observeManualRecovery({ interruptedObjectiveId } = {}) {
      const location = collectionCatalog.find(
        ({ id }) => id === interruptedObjectiveId,
      );
      if (!location) return false;
      operatorDeferredCollections.add(location.id);
      return true;
    },
    retainedRecovery(observation) {
      tasks.observe(observation);
      const memory=observation?.playerMemory,map=memory?.map?.id;
      const retained=tasks.state()?.recovery;
      if(isProgressObservation(observation)&&observation.emulator?.mode==='overworld'&&
          !observation.emulator.inBattle&&!Object.values(memory?.ui??{}).some(Boolean)&&
          memory?.storyState?.variableIds?.[0x4082]===1&&map?.startsWith('MAP_TRAINER_TOWER_')&&
          retained?.objective?.target?.map&&
          !retained.objective.target.map.startsWith('MAP_TRAINER_TOWER_')){
        // A resumed outside healer would abandon this native challenge.
        // Restore the Tower's own floor/nurse objective instead.
        tasks.releaseRecovery();
      }
      if(tasks.recovery()?.phase==='reassembling'){
        const healer=selectRecoveryObjective({world,story,observation,excludedTargets:recoveryMemory.failures.filter(f=>f.attempts>=2).map(f=>f.target)});
        if(healer)tasks.retargetRecovery(healer);
      }
      return tasks.recovery()?.objective??null;
    },
    selectRecovery(observation) {
      observeRecoveryOutcome(observation);
      return selectRecoveryObjective({ world, story, observation,
        excludedTargets: recoveryMemory.failures
          .filter(({ attempts }) => attempts >= 2).map(({ target }) => target),
      });
    },
    observeRecoveryDecision(observation, decision, selectedRecovery = null) {
      observeRecoveryOutcome(observation);
      const recommendation = decision?.winner?.recommendation;
      const target = selectedRecovery?.target;
      if(decision?.kind==='act'&&validRecoveryTarget(target)&&
        ['recover-training-party','recover-party'].includes(recommendation?.objective)&&
        (recommendation.targetMap===target.map||decision.winner?.evidenceRefs?.includes(`cartridge:healer-map:${target.map}`))){
        tasks.beginRecovery({observation,objective:{...selectedRecovery,id:recommendation.objective},
          parentObjectiveId:activeCampaign.objectives[minimumStoryObjectiveIndex]?.id??null});
      }
      if (decision?.kind !== "act" || !validRecoveryTarget(target) ||
        !["interact-with-object", "interact-with-background"].includes(recommendation?.kind) ||
        recommendation.targetMap !== target.map || recommendation.target?.kind !== target.kind ||
        recommendation.target?.index !== target.index ||
        !decision.action?.buttons?.includes("a") ||
        observation?.playerMemory?.avatar?.facing !== recommendation.direction ||
        observation?.playerMemory?.ui?.fieldDialog || observation?.playerMemory?.ui?.choiceMenu
      ) return;
      const party = recoveryParty(observation);
      if (!party) return;
      recoveryMemory.pending = { target: structuredClone(target), party,
        position: structuredClone(observation.playerMemory.position), sawDialogue: false };
    },
    commitTrainingSelection,
    trainingSelectionStats: () => ({ ...trainingSelectionStats }),
    selectTraining(observation, objective, { excludedTrainerIds = [], commit = true, avoidPullTerrain = false } = {}) {
      if(objective?.taskKind==='recovery'||tasks.recovery())return null;
      const forObjective = objective?.rosterPreparationFor ?? objective?.id;
      const failures=rejectedTraining.filter(r=>r.objective===forObjective&&r.condition===trainingCondition(observation));
      const rejectedTrainerIds=failures.flatMap(r=>r.trainers);
      if(committedTrainingObjective?.forObjective===forObjective &&
        committedTrainingObjective.trainingRotation!=='one-level')tasks.rememberTraining(committedTrainingObjective,observation);
      const excludedTrainers = new Set([...(excludedTrainerIds??[]),...rejectedTrainerIds].map(Number));
      const preferredTrainerId =
        committedTrainingObjective?.forObjective === forObjective &&
          !excludedTrainers.has(Number(committedTrainingObjective?.trainer?.id))
          ? committedTrainingObjective?.trainer?.id
          : null;
      const inputs = {
        world,
        story,
        mechanics,
        observation,
        objective,
        trainerCatalog: trainerTrainingCatalog,
        teamPlan,
        preferredTrainerId,
        excludedTrainerIds:[...excludedTrainers],
        excludedTrainingMaps:failures.flatMap(r=>r.maps),
        trainingTask:tasks.trainingFor(observation,forObjective),
        trainingSamples:trainingMeasurements.samples(),
        avoidPullTerrain,
        preferredTrainingKey:committedTrainingObjective?.forObjective===forObjective?committedTrainingObjective?.trainingRate?.key:null,
        progressionObjective:activeCampaign.objectives.slice(minimumStoryObjectiveIndex)
          .find(o=>o.importantBattle&&!objectiveCompleted(o,observation,mechanics)),
      };
      // Several advisors inspect one observation. Selection is a pure function
      // of the observation content and these inputs, so identical inputs are
      // computed once; commits still run on every call, and callers receive
      // their own copy.
      const key = JSON.stringify([observation, objective, inputs.preferredTrainerId, inputs.excludedTrainerIds,
        inputs.excludedTrainingMaps, inputs.trainingTask, inputs.trainingSamples, avoidPullTerrain,
        inputs.preferredTrainingKey, inputs.progressionObjective?.id ?? null]);
      let selected;
      if (trainingSelectionCache.has(key)) {
        selected = structuredClone(trainingSelectionCache.get(key));
        trainingSelectionStats.reused++;
      } else {
        selected = selectTrainingObjective(inputs);
        trainingSelectionCache.set(key, structuredClone(selected));
        if (trainingSelectionCache.size > 4) trainingSelectionCache.delete(trainingSelectionCache.keys().next().value);
        trainingSelectionStats.computed++;
      }
      // Exclusions are a caller-local route fallback.  A losing advisor may
      // inspect one without replacing the shared campaign commitment that
      // another advisor is actively carrying through a menu transaction.
      if (commit && excludedTrainerIds.length === 0) commitTrainingSelection(selected,observation);
      return selected;
    },
    selectBattleSquad(observation) {
      const activeStoryObjective = selectActiveStoryObjective(observation);
      if (activeStoryObjective?.mandatoryInterlude) return Object.freeze([]);
      const activeStoryObjectiveIndex = activeStoryObjective
        ? activeCampaign.objectives.indexOf(activeStoryObjective)
        : activeCampaign.objectives.length;
      const objective = activeCampaign.objectives
        .slice(activeStoryObjectiveIndex)
        .find((candidate) =>
          candidate.importantBattle &&
            !objectiveCompleted(candidate, observation, mechanics)
        ) ?? null;
      const party = (observation?.playerMemory?.trainer?.party ?? []).filter(
        ({ species, level }) => Number(species) > 0 && Number(level) > 0,
      );
      return Object.freeze(
        objective ? selectImportantBattleSquad(party, objective, teamPlan) : [],
      );
    },
    collectionCatalog() {
      return collectionCatalog;
    },
    collectionProgress(observation) {
      observeCollectionState(observation);
      return Object.freeze({
        total: collectionCatalog.length,
        collected: collectedLocations.size,
        remaining: collectionCatalog.length - collectedLocations.size,
        visible: collectionCatalog.filter(({ kind }) => kind === "visible").length,
        hidden: collectionCatalog.filter(({ kind }) => kind === "hidden").length,
        underfoot: collectionCatalog.filter(({ underfoot }) => underfoot).length,
        provenMaps: visitedMaps.size,
      });
    },
    storyWatch() {
      return storyWatch;
    },
    storyProgress(observation) {
      return presentStoryProgress({campaign:activeCampaign,index:minimumStoryObjectiveIndex,
        active:this.campaignStatus().activeObjective,observation,mechanics,
        evaluate:(objective,o)=>objectiveCompleted(objective,o,mechanics),
        isKnown:completionEvidenceKnown,isTemporary:completionUsesTemporaryState});
    },
    campaignStatus() {
      const objective = activeLeagueEntryObjective ?? activeLeagueRecoveryObjective ?? activeBoulderRecoveryObjective ??
        activeMandatoryInterludeObjective ??
        activeTransientMapPuzzleObjective ??
        activeAcquisitionPrerequisiteObjective ??
        committedFishingObjective ??
        activeCampaign.objectives[minimumStoryObjectiveIndex] ?? null;
      const metadata = objective
        ? Object.fromEntries([
            "rosterPreparationFor",
            "minimumTeamAnchorLevel",
            "minimumBattlePartySize",
            "minimumBattleMemberLevel",
            "starterBattleFamily",
            "starterBattleTargetLevel",
            "supportBattleTargetLevel",
            "minimumReadyBattleMembers",
            "battleCategory",
            "enemyPartyLevels",
            "enemyPartySize",
            "enemyAceLevel",
            "battleTeamTargetLevel",
            "importantBattle",
            "mandatoryInterlude",
            "transientMapPuzzle",
            "boulderRecoveryFor",
            "boulderRecoveryPhase",
            "captureSpecies",
            "captureAnyNewSpecies",
            "regionalMastery",
            "encounterMethod",
          ].flatMap((key) => objective[key] === undefined
            ? []
            : [[key, structuredClone(objective[key])]]
          ))
        : {};
      return Object.freeze({
        completedThroughObjectiveId: completedThroughObjectiveId(),
        ...(tasks.active()?{activeTask:tasks.active()}:{}),
        activeObjective: objective
          ? Object.freeze({
              id: objective.id,
              target: Object.freeze(structuredClone(objective.target)),
              ...metadata,
            })
          : null,
      });
    },
    state() {
      const commitments = Object.fromEntries([
        ["regionalMastery", committedRegionalMasteryObjective],
        ["training", committedTrainingObjective],
        ["fishing", committedFishingObjective],
        ['fieldCarrier', committedFieldCarrierObjective],
        ["infrastructure", committedTrainingInfrastructureTransaction],
        ["battleMedicine", committedBattleMedicineTransaction],
      ].filter(([, value]) => value !== null));
      return Object.freeze({
        schema: "master-red/campaign-planner-state/v1",
        ...(rejectedTraining.length?{rejectedTraining:structuredClone(rejectedTraining)}:{}),
        ...(trainingMeasurements.state()?{trainingMeasurements:trainingMeasurements.state()}:{}),
        ...(tasks.state()?{tasks:tasks.state()}:{}),
        completedThroughObjectiveId: completedThroughObjectiveId(),
        ...(recoveryMemory.failures.length || recoveryMemory.pending
          ? { recoveryMemory: structuredClone(recoveryMemory) } : {}),
        ...(leagueRecovery.state() ? {leagueRecovery:leagueRecovery.state()} : {}),
        ...(leagueFunding ? {leagueFunding:structuredClone(leagueFunding)} : {}),
        ...(incomeFailures.length?{incomeFailures:structuredClone(incomeFailures)}:{}),
        ...(incomePlan?{incomePlan:structuredClone(incomePlan)}:{}),
        ...(Object.keys(commitments).length ? { commitments: structuredClone(commitments) } : {}),
        ...(battleMedicineServicedForObjectiveId === null
          ? {}
          : { battleMedicineServicedForObjectiveId }),
        ...(collectedLocations.size || visitedMaps.size || locallyDeferredCollections.size || operatorDeferredCollections.size
          ? { collectionMemory: {
              collectedLocations: [...collectedLocations],
              visitedMaps: [...visitedMaps],
              locallyDeferredCollections: [...locallyDeferredCollections],
              operatorDeferredCollections: [...operatorDeferredCollections],
            } }
          : {}),
      });
    },
  });
}
