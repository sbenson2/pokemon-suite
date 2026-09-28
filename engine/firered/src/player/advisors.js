import {describeHeldItem,itemCatalog,berryConfuses} from './held-items.js';
import {acceptableEffortGain} from './effort-values.js';
import {PHYSICAL_TYPES} from './battle-modifiers.js';
import {nationalSpeciesId} from '../evidence/gen3-national-species.js';
import {obedienceRisk,passiveTraineeIdentity,isPassiveTrainee} from './training-policy.js';
import { dataOf, indexed, speciesTypes, typeMultiplier } from "./mechanics-data.js";
import {
  battleDecisionState,
  scoreBattleMoveTargets,
  selectSurvivalSupportMove,
  selectCapturePreparationMove,
  selectCapturePreparationSpecialist,
  selectTrainerControlMove,
  finishingBattleMove,
  speciesIdForBattleName,
  partyMemberMatchupSafety,
  directTrainingPlan,
  maximumCredibleIncomingDamage,
  partyMatchupPlan,
  matchupIsMateriallyBetter,
  selectForcedReplacementMember,
  battleRecoveryPlan,
  isReviveSupportCarrier,
  selectStrategicReviveTarget,
  canSafelyExecuteReviveSequence,
  ACTIVE_BATTLE_RECOVERY_ITEMS,
  BATTLE_REVIVE_ITEMS,
  committedBattleRecoveryPlan,
  battleKoRace,
  planBattleCounters,
  raceIsComfortable,
  remainingBattleOpponents,
} from "./battle-model.js";
import { selectMajorBattleLead } from "./battle-foresight.js";
export { scoreBattleMoves } from "./battle-model.js";
import { createHash } from "node:crypto";
import {encounterFingerprint} from './encounter-tracker.js';
import {evolutionItemRecommendation} from '../suite/fire-red-evolution.js';
import {fieldMoveAtRecommendation,seagallopChoiceIndex,fireRedIsland} from '../suite/fire-red-link-quest.js';

import { assertAdvisorProposal } from "../foundation.js";
import {
  CAMPAIGN_MAJOR_BATTLE_LEVEL_TARGETS,
  campaignNavigationRecommendation,
  campaignNavigationOutcome,
  campaignOutdoorStagingTarget,
  campaignRegionTransitionDistances,
  createCampaignPlanner,
  isHmUtilityCarrier,
  selectBattleRosterObjective,
  selectRecoveryObjective,
  selectTrainingObjective,
  vsSeekerTrainerVisible,
} from "./campaign.js";
import {
  deriveBattleLegality,
} from "./battle-legality.js";
import { selectBestCaptureBall } from "./capture-balls.js";
import { createObservationPlanner } from "./planning-context.js";
import {
  isRecoveryItem,
  isStatusRecoveryItem,
  nextRecoveryTreatment,
  recoveryTargetForItem,
  recoveryPpMove,
} from "./recovery.js";
import { createRunProfile } from "./run-profile.js";
import { isInGameTradePartyMenu } from "./in-game-trade.js";
import { moveDamageKind, normalizedExpectedMoveDamage } from "./move-damage.js";
import {moveLearningReadiness} from './move-knowledge.js';
import { isMajorBattle } from './major-battles.js';
import { HM_MOVE_IDS, mayLearnMove } from './hm-policy.js';

// FireRed sets BATTLE_TYPE_IS_MASTER for every local, non-link battle. A
// normal random wild encounter has no other battle-type bits set.
const NORMAL_WILD_BATTLE_FLAGS = 1 << 2;
const SAFARI_BATTLE_FLAGS = (1 << 2) | (1 << 7);
const BATTLE_TYPE_DOUBLE = 1 << 0;
const BATTLE_TYPE_TRAINER = 1 << 3;
const BATTLE_TYPE_OLD_MAN_TUTORIAL = 1 << 9;
const BATTLE_TYPE_GHOST = 1 << 15;
const BATTLE_TYPE_POKEDUDE = 1 << 16;
// Center interior (0), town exterior/building (1-2), or one adjacent route (2).
const LOCAL_FREE_HEALER_MAX_TRANSITIONS = 2;
const NON_CAPTURABLE_WILD_BATTLE_FLAGS =
  BATTLE_TYPE_TRAINER |
  (1 << 7) |
  BATTLE_TYPE_OLD_MAN_TUTORIAL |
  BATTLE_TYPE_GHOST |
  BATTLE_TYPE_POKEDUDE;
const RUNNING_SHOES_FLAG = 2095;
const RUNNING_TRAVEL_KINDS = new Set([
  "move-toward",
  "traverse-map-connection",
]);
const CYCLING_ROAD_CONTROL_KINDS = new Set([
  ...RUNNING_TRAVEL_KINDS,
  "acknowledge-cartridge-prompt",
  "interact-with-object",
  "interact-with-background",
  "use-field-move",
]);
const CYCLING_ROAD_SLOPE_BEHAVIORS = new Set([
  "MB_CYCLING_ROAD_PULL_DOWN",
  "MB_CYCLING_ROAD_PULL_DOWN_GRASS",
]);
const BICYCLE_AVATAR_FLAGS = (1 << 1) | (1 << 2);
const FISHABLE_WATER_BEHAVIORS = new Set([
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

function isCapturableWildBattle(battleTypeFlags) {
  const flags = Number(battleTypeFlags) >>> 0;
  return (flags & NORMAL_WILD_BATTLE_FLAGS) !== 0 &&
    (flags & NON_CAPTURABLE_WILD_BATTLE_FLAGS) === 0;
}

function campaignTrainingObjective({
  campaignPlanner,
  world,
  observation,
  objective,
  teamPlan = null,
  excludedTrainerIds = [],
}) {
  // Identity-evolution training must avoid cycling-road pull targets the
  // slope cannot hold. Campaign battle training keeps its own route choices.
  const avoidPullTerrain = objective?.identityEvolution === true &&
    Boolean(objective?.trainingFingerprint);
  const training = typeof campaignPlanner?.selectTraining === "function"
    ? campaignPlanner.selectTraining(observation, objective, { excludedTrainerIds, avoidPullTerrain })
    : selectTrainingObjective({
        world,
        observation,
        objective,
        teamPlan,
        excludedTrainerIds,
        avoidPullTerrain,
      });
  return preparationWithStoryTriggerGuard(training, objective);
}

function preparationWithStoryTriggerGuard(preparation, storyObjective) {
  if (
    !preparation ||
    ["passive", "experience-share-only"].includes(preparation.trainingMode) ||
    !storyObjective?.importantBattle ||
    storyObjective?.target?.kind !== "trigger"
  ) return preparation;
  return {
    ...preparation,
    avoidTargets: [
      ...(preparation.avoidTargets ?? []),
      storyObjective.target,
    ],
  };
}

const TRAINER_TRAINING_SOURCES = new Set([
  "trainer",
  "vs-seeker",
  "vs-seeker-recharge",
]);

function trainingSourceConstraint(trainingObjective) {
  return trainingObjective?.trainingMode === "experience-share-only"
    ? "experience-share-only"
    : trainingObjective?.trainingMode === "passive"
    ? "story-progress-training"
    : trainingObjective?.trainingSource === "vs-seeker-recharge"
      ? "vs-seeker-recharge-training"
    : TRAINER_TRAINING_SOURCES.has(trainingObjective?.trainingSource)
      ? "trainer-first-training"
    : "normal-wild-training";
}

const OVERWORLD_DIRECTIONS = Object.freeze([
  Object.freeze({ direction: "south", dx: 0, dy: 1 }),
  Object.freeze({ direction: "east", dx: 1, dy: 0 }),
  Object.freeze({ direction: "north", dx: 0, dy: -1 }),
  Object.freeze({ direction: "west", dx: -1, dy: 0 }),
]);

const SUPPORTED_NAVIGATION_OBJECTIVES = Object.freeze({
  MAP_PALLET_TOWN_PLAYERS_HOUSE_2F: Object.freeze({
    id: "leave-players-house",
    destinationMap: "MAP_PALLET_TOWN_PLAYERS_HOUSE_1F",
  }),
  MAP_PALLET_TOWN_PLAYERS_HOUSE_1F: Object.freeze({
    id: "leave-players-house",
    destinationMap: "MAP_PALLET_TOWN",
  }),
  MAP_PALLET_TOWN: Object.freeze({
    id: "meet-professor-oak",
    eventScripts: Object.freeze([
      "PalletTown_EventScript_OakTriggerLeft",
      "PalletTown_EventScript_OakTriggerRight",
    ]),
    eventVariable: "VAR_MAP_SCENE_PALLET_TOWN_OAK",
    eventValue: "0",
  }),
});

const OAKS_LAB = "MAP_PALLET_TOWN_PROFESSOR_OAKS_LAB";
const OAKS_LAB_SCENE = "VAR_MAP_SCENE_PALLET_TOWN_PROFESSOR_OAKS_LAB";
const DEFAULT_RUN_PROFILE = createRunProfile(0);

function labStarterObjective(runProfile = DEFAULT_RUN_PROFILE) {
  const starter = runProfile?.starter ?? DEFAULT_RUN_PROFILE.starter;
  return Object.freeze({
    id: `choose-${starter.id}`,
    objectScript: starter.objectScript,
    objectLocalId: starter.objectLocalId,
    species: `SPECIES_${starter.name}`,
  });
}
const OAKS_LAB_RIVAL_BATTLE = Object.freeze({
  id: "start-first-rival-battle",
  ...CAMPAIGN_MAJOR_BATTLE_LEVEL_TARGETS["rival-oaks-lab"],
  eventScripts: Object.freeze([
    "PalletTown_ProfessorOaksLab_EventScript_RivalBattleTriggerLeft",
    "PalletTown_ProfessorOaksLab_EventScript_RivalBattleTriggerMid",
    "PalletTown_ProfessorOaksLab_EventScript_RivalBattleTriggerRight",
  ]),
  eventVariable: OAKS_LAB_SCENE,
  eventValue: "3",
});

const DIRECTIONAL_WARP_INPUT = Object.freeze({
  MB_UP_RIGHT_STAIR_WARP: "east",
  MB_DOWN_RIGHT_STAIR_WARP: "east",
  MB_UP_LEFT_STAIR_WARP: "west",
  MB_DOWN_LEFT_STAIR_WARP: "west",
  MB_NORTH_ARROW_WARP: "north",
  MB_SOUTH_ARROW_WARP: "south",
  MB_WEST_ARROW_WARP: "west",
  MB_EAST_ARROW_WARP: "east",
});

const AUTOMATIC_WARP_BEHAVIORS = new Set([
  "MB_WARP_DOOR",
  "MB_UP_ESCALATOR",
  "MB_DOWN_ESCALATOR",
  "MB_LADDER",
  "MB_CAVE_DOOR",
  "MB_LAVARIDGE_1F_WARP",
  "MB_REGULAR_WARP",
  "MB_UNION_ROOM_WARP",
  "MB_FALL_WARP",
]);
const ITEM_ITEMFINDER = 261;
const ITEM_VS_SEEKER = 362;
const MOVE_FLY = 19;
const THUNDER_BADGE_FLAG = 2082;
const FLY_MAP_DESTINATIONS = Object.freeze({
  MAPSEC_PALLET_TOWN: Object.freeze({
    map: "MAP_PALLET_TOWN", x: 4, y: 11, visitedFlagId: 2192,
    landing: Object.freeze({ x: 6, y: 8 }),
  }),
  MAPSEC_VIRIDIAN_CITY: Object.freeze({
    map: "MAP_VIRIDIAN_CITY", x: 4, y: 8, visitedFlagId: 2193,
    landing: Object.freeze({ x: 26, y: 27 }),
  }),
  MAPSEC_PEWTER_CITY: Object.freeze({
    map: "MAP_PEWTER_CITY", x: 4, y: 4, visitedFlagId: 2194,
    landing: Object.freeze({ x: 17, y: 26 }),
  }),
  MAPSEC_CERULEAN_CITY: Object.freeze({
    map: "MAP_CERULEAN_CITY", x: 14, y: 3, visitedFlagId: 2195,
    landing: Object.freeze({ x: 22, y: 20 }),
  }),
  MAPSEC_LAVENDER_TOWN: Object.freeze({
    map: "MAP_LAVENDER_TOWN", x: 18, y: 6, visitedFlagId: 2196,
    landing: Object.freeze({ x: 6, y: 6 }),
  }),
  MAPSEC_VERMILION_CITY: Object.freeze({
    map: "MAP_VERMILION_CITY", x: 14, y: 9, visitedFlagId: 2197,
    landing: Object.freeze({ x: 15, y: 7 }),
  }),
  MAPSEC_CELADON_CITY: Object.freeze({
    map: "MAP_CELADON_CITY", x: 11, y: 6, visitedFlagId: 2198,
    landing: Object.freeze({ x: 48, y: 12 }),
  }),
  MAPSEC_FUCHSIA_CITY: Object.freeze({
    map: "MAP_FUCHSIA_CITY", x: 12, y: 12, visitedFlagId: 2199,
    landing: Object.freeze({ x: 25, y: 32 }),
  }),
  MAPSEC_CINNABAR_ISLAND: Object.freeze({
    map: "MAP_CINNABAR_ISLAND", x: 4, y: 14, visitedFlagId: 2200,
    landing: Object.freeze({ x: 14, y: 12 }),
  }),
  MAPSEC_INDIGO_PLATEAU: Object.freeze({
    map: "MAP_INDIGO_PLATEAU_EXTERIOR", x: 2, y: 3, visitedFlagId: 2201,
    landing: Object.freeze({ x: 11, y: 7 }),
  }),
  MAPSEC_SAFFRON_CITY: Object.freeze({
    map: "MAP_SAFFRON_CITY", x: 14, y: 6, visitedFlagId: 2202,
    landing: Object.freeze({ x: 24, y: 39 }),
  }),
});
const FLY_ALLOWED_MAP_TYPES = new Set([
  "MAP_TYPE_ROUTE",
  "MAP_TYPE_TOWN",
  "MAP_TYPE_OCEAN_ROUTE",
  "MAP_TYPE_CITY",
]);
// InitRegionMap selects one of three Sevii maps from sSeviiMapsecs. Their
// coordinates are not the Kanto coordinates in FLY_MAP_DESTINATIONS. Special
// dungeons share those maps even when their names do not contain an island.
const SEVII_FLY_SECTIONS = new Set([
  'ONE_ISLAND','TWO_ISLAND','THREE_ISLAND','KINDLE_ROAD','TREASURE_BEACH',
  'CAPE_BRINK','BOND_BRIDGE','THREE_ISLE_PORT','MT_EMBER','BERRY_FOREST',
  'THREE_ISLE_PATH','EMBER_SPA','FOUR_ISLAND','FIVE_ISLAND','SEVII_ISLE_6',
  'SEVII_ISLE_7','SEVII_ISLE_8','SEVII_ISLE_9','RESORT_GORGEOUS',
  'WATER_LABYRINTH','FIVE_ISLE_MEADOW','MEMORIAL_PILLAR','NAVEL_ROCK',
  'ICEFALL_CAVE','ROCKET_WAREHOUSE','LOST_CAVE','SEVEN_ISLAND','SIX_ISLAND',
  'OUTCAST_ISLAND','GREEN_PATH','WATER_PATH','RUIN_VALLEY','TRAINER_TOWER',
  'CANYON_ENTRANCE','SEVAULT_CANYON','TANOBY_RUINS','SEVII_ISLE_22',
  'SEVII_ISLE_23','SEVII_ISLE_24','TRAINER_TOWER_2','DOTTED_HOLE',
  'PATTERN_BUSH','ALTERING_CAVE','TANOBY_CHAMBERS','TANOBY_KEY','BIRTH_ISLAND',
  'MONEAN_CHAMBER','LIPTOO_CHAMBER','WEEPTH_CHAMBER','DILFORD_CHAMBER',
  'SCUFIB_CHAMBER','RIXY_CHAMBER','VIAPOIS_CHAMBER',
].map(section => `MAPSEC_${section}`));
function isSeviiFlyMap(observation, world) {
  const id = observation.playerMemory?.map?.id;
  const map = (dataOf(world).maps ?? []).find(map => map.id === id);
  return fireRedIsland(id) > 0 || SEVII_FLY_SECTIONS.has(map?.properties?.region_map_section);
}
const HELD_TYPE_BOOSTS = Object.freeze(new Map([
  [188, "TYPE_BUG"],
  [199, "TYPE_STEEL"],
  [203, "TYPE_GROUND"],
  [204, "TYPE_ROCK"],
  [205, "TYPE_GRASS"],
  [206, "TYPE_DARK"],
  [207, "TYPE_FIGHTING"],
  [208, "TYPE_ELECTRIC"],
  [209, "TYPE_WATER"],
  [210, "TYPE_FLYING"],
  [211, "TYPE_POISON"],
  [212, "TYPE_ICE"],
  [213, "TYPE_GHOST"],
  [214, "TYPE_PSYCHIC"],
  [215, "TYPE_FIRE"],
  [216, "TYPE_DRAGON"],
  [217, "TYPE_NORMAL"],
  [220, "TYPE_WATER"],
]));
const HELD_ITEM_PRIORITIES = Object.freeze(new Map([
  [200, 100], // Leftovers
  [182, 95],  // Exp. Share
  [219, 90],  // Shell Bell
  ...[...HELD_TYPE_BOOSTS.keys()].map((itemId) => [itemId, 80]),
  [198, 70],  // Scope Lens
  [183, 60],  // Quick Claw
  [187, 55],  // King's Rock
  [179, 50],  // BrightPowder
  [189, 40],  // Amulet Coin
  [186,85], [191,85], [192,85], [193,85], [202,85], [223,85], [224,85],
  [222,70], [225,70], [221,50], [196,45], [194,35], [197,94],
  ...itemCatalog.items.filter(i=>describeHeldItem(i.id)?.consumable).map(i=>[i.id,30]),
]));

function coordinateKey(x, y) {
  return `${x},${y}`;
}

function currentMapKnowledge(map, observation) {
  const live = observation?.playerMemory?.mapGrid;
  if (
    !map || !live ||
    Number(live.width) !== Number(map.layout?.width) ||
    Number(live.height) !== Number(map.layout?.height)
  ) return map;
  const source = new Map(
    (map.layout?.cells ?? []).map((cell) => [coordinateKey(cell.x, cell.y), cell]),
  );
  return {
    ...map,
    layout: {
      ...map.layout,
      cells: (live.cells ?? []).map((cell) => ({
        ...(source.get(coordinateKey(cell.x, cell.y)) ?? {}),
        ...cell,
      })),
    },
  };
}

export function isPcAccessMenu(memory, world) {
  const choice = memory?.ui?.choiceMenu;
  if (
    !choice || choice.selected !== null ||
    Number(choice.minCursor) !== 0 || Number(choice.maxCursor) < 3
  ) return false;
  const position = memory?.position;
  const facing = OVERWORLD_DIRECTIONS.find(
    ({ direction }) => direction === memory?.avatar?.facing,
  );
  const map = (dataOf(world).maps ?? []).find(
    ({ id }) => id === memory?.map?.id,
  );
  if (!facing || !map || !position) return false;
  const targetX = Number(position.x) + facing.dx;
  const targetY = Number(position.y) + facing.dy;
  return (map.layout?.cells ?? []).some(({ x, y, behaviorName }) =>
    Number(x) === targetX && Number(y) === targetY && behaviorName === "MB_PC"
  );
}

function pathContext(map, position) {
  const width = Number(map?.layout?.width);
  const height = Number(map?.layout?.height);
  if (
    !Number.isSafeInteger(width) || width <= 0 ||
    !Number.isSafeInteger(height) || height <= 0 ||
    !Number.isSafeInteger(position?.x) || !Number.isSafeInteger(position?.y)
  ) {
    return null;
  }

  const cells = new Map(
    (map.layout.cells ?? []).map((cell) => [coordinateKey(cell.x, cell.y), cell]),
  );
  const blockedObjects = new Set(
    (map.objectEvents ?? []).map(({ x, y }) => coordinateKey(x, y)),
  );
  const revision = createHash("sha256").update(JSON.stringify({
    map: map.id,
    layout: map.layout?.id ?? null,
    width,
    height,
    cells: [...cells.values()]
      .sort((left, right) => Number(left.y) - Number(right.y) ||
        Number(left.x) - Number(right.x))
      .map(({ x, y, collision, elevation, behaviorName }) => [
        Number(x),
        Number(y),
        Number(collision),
        Number(elevation),
        behaviorName ?? null,
      ]),
    blocked: [...blockedObjects].sort(),
  })).digest("hex");
  return { mapId: map.id, width, height, cells, blockedObjects, revision };
}

function routePlanFromNode(context, position, routeNode) {
  const reversed = [];
  for (let node = routeNode; node; node = node.previous) reversed.push(node);
  const route = reversed.reverse();
  if (route.length === 0) return null;
  const segments = [];
  for (const step of route) {
    const segment = segments.at(-1);
    if (segment?.direction === step.direction) {
      segment.steps += 1;
      segment.endpoint = { x: step.x, y: step.y };
    } else {
      segments.push({
        direction: step.direction,
        steps: 1,
        endpoint: { x: step.x, y: step.y },
      });
    }
  }
  const destination = route.at(-1);
  return {
    map: context.mapId,
    mapRevision: context.revision,
    origin: { x: Number(position.x), y: Number(position.y) },
    destination: { x: destination.x, y: destination.y },
    steps: route.length,
    segments,
  };
}

function routeToTargets(context, position, targets) {
  if (!context || targets.size === 0) return null;
  const { mapId, width, height, cells, blockedObjects } = context;
  const startKey = coordinateKey(position.x, position.y);
  const queue = [{
    x: position.x,
    y: position.y,
    distance: 0,
    firstDirection: null,
    firstSegmentOpen: true,
    firstSegmentSteps: 0,
    firstSegmentEndX: position.x,
    firstSegmentEndY: position.y,
    routeNode: null,
  }];
  const visited = new Set([startKey]);
  for (let cursor = 0; cursor < queue.length; cursor += 1) {
    const current = queue[cursor];
    const target = targets.get(coordinateKey(current.x, current.y));
    if (target) {
      const segmentDistance =
        Math.abs(Number(current.firstSegmentEndX) - Number(position.x)) +
        Math.abs(Number(current.firstSegmentEndY) - Number(position.y));
      const pathSegment =
        current.firstSegmentSteps >= 2 &&
        segmentDistance === current.firstSegmentSteps
          ? {
              direction: current.firstDirection,
              steps: current.firstSegmentSteps,
              endpoint: {
                map: mapId,
                x: current.firstSegmentEndX,
                y: current.firstSegmentEndY,
              },
            }
          : null;
      return {
        direction: current.firstDirection,
        distance: current.distance,
        ...(pathSegment ? { pathSegment } : {}),
        ...(current.distance > 0
          ? { routePlan: routePlanFromNode(context, position, current.routeNode) }
          : {}),
        ...target,
      };
    }

    for (const { direction, dx, dy } of OVERWORLD_DIRECTIONS) {
      const x = current.x + dx;
      const y = current.y + dy;
      const key = coordinateKey(x, y);
      if (visited.has(key) || x < 0 || y < 0 || x >= width || y >= height) continue;
      const cell = cells.get(key);
      if (!cell || Number(cell.collision) !== 0 || blockedObjects.has(key)) continue;
      visited.add(key);
      const extendsFirstSegment = current.firstDirection === null || (
        current.firstSegmentOpen && current.firstDirection === direction
      );
      queue.push({
        x,
        y,
        distance: current.distance + 1,
        firstDirection: current.firstDirection ?? direction,
        firstSegmentOpen: extendsFirstSegment,
        firstSegmentSteps: current.firstSegmentSteps +
          (extendsFirstSegment ? 1 : 0),
        firstSegmentEndX: extendsFirstSegment ? x : current.firstSegmentEndX,
        firstSegmentEndY: extendsFirstSegment ? y : current.firstSegmentEndY,
        routeNode: {
          previous: current.routeNode,
          direction,
          x,
          y,
        },
      });
    }
  }
  return null;
}

function routeToWarp(map, position, destinationMap) {
  const context = pathContext(map, position);
  if (!context) return null;
  const targetWarps = new Map(
    (map.warpEvents ?? [])
      .filter(({ dest_map: destination }) => destination === destinationMap)
      .map((warp) => {
        const key = coordinateKey(warp.x, warp.y);
        return { key, warp, cell: context.cells.get(key) };
      })
      .filter(({ cell }) =>
        Number(cell?.collision) === 0 &&
        (DIRECTIONAL_WARP_INPUT[cell.behaviorName] ||
          AUTOMATIC_WARP_BEHAVIORS.has(cell.behaviorName))
      )
      .map(({ key, warp, cell }) => [key, { warp, cell }]),
  );
  return routeToTargets(context, position, targetWarps);
}

function routeToCoordinateEvent(map, position, objective) {
  const context = pathContext(map, position);
  if (!context) return null;
  const allowedScripts = new Set(objective.eventScripts);
  const targetEvents = new Map(
    (map.coordEvents ?? [])
      .filter((event) =>
        event.type === "trigger" &&
        allowedScripts.has(event.script) &&
        event.var === objective.eventVariable &&
        String(event.var_value) === objective.eventValue
      )
      .map((event) => {
        const key = coordinateKey(event.x, event.y);
        return { key, event, cell: context.cells.get(key) };
      })
      .filter(({ cell }) => Number(cell?.collision) === 0)
      .map(({ key, event, cell }) => [key, { event, cell }]),
  );
  return routeToTargets(context, position, targetEvents);
}

function routeToObjectEvent(map, position, objective) {
  const context = pathContext(map, position);
  if (!context) return null;
  const objectEvent = (map.objectEvents ?? []).find((event) =>
    event.script === objective.objectScript &&
    event.local_id === objective.objectLocalId
  );
  if (!objectEvent) return null;
  const approachTargets = new Map();
  for (const { direction, dx, dy } of OVERWORLD_DIRECTIONS) {
    const x = objectEvent.x - dx;
    const y = objectEvent.y - dy;
    const key = coordinateKey(x, y);
    const cell = context.cells.get(key);
    if (
      Number(cell?.collision) === 0 &&
      !context.blockedObjects.has(key)
    ) {
      approachTargets.set(key, {
        objectEvent,
        interactionDirection: direction,
      });
    }
  }
  return routeToTargets(context, position, approachTargets);
}

function proposal({
  advisor,
  observation,
  recommendation,
  confidence,
  constraints = [],
  vetoes = [],
  evidenceRefs = [],
}) {
  return assertAdvisorProposal({
    advisor,
    observationId: observation.captureId,
    recommendation,
    confidence,
    constraints,
    vetoes,
    evidenceRefs,
  });
}

function questPromptAdvice(observation) {
  const ui = observation.playerMemory?.ui ?? {};
  if (ui.choiceMenu) return null;
  const mode = observation.emulator?.mode;
  let prompt = null;
  if (ui.fieldDialog) {
    prompt = `field-dialog:${ui.fieldDialog.stage ?? "unknown"}`;
  } else if (ui.moveLearning) {
    if (["confirm-replace", "confirm-stop-learning", "forget-move"].includes(
      ui.moveLearning.stage,
    )) {
      return null;
    }
    prompt = `move-learning:${ui.moveLearning.stage ?? "unknown"}`;
  } else if (ui.party?.stage === "message" && mode !== "battle") {
    prompt = "party-message";
  } else if (ui.mart?.stage === "purchase-result") {
    prompt = "mart-purchase-result";
  } else if (["success", "error"].includes(ui.saveDialog?.stage)) {
    prompt = `save-result:${ui.saveDialog.stage}`;
  } else if (ui.blackout) {
    prompt = `blackout:${ui.blackout.stage ?? "unknown"}`;
  } else if (ui.levelUp) {
    prompt = `level-up:${ui.levelUp.stage ?? "unknown"}`;
  } else if (ui.evolution) {
    prompt = `evolution:${ui.evolution.stage ?? "unknown"}`;
  } else if (ui.specialAnimation) {
    prompt = `special-animation:${ui.specialAnimation.stage ?? "unknown"}`;
  }
  if (!prompt) return null;
  return proposal({
    advisor: "quest",
    observation,
    recommendation: {
      kind: "acknowledge-cartridge-prompt",
      objective: `advance-${prompt.replaceAll(":", "-")}`,
    },
    confidence: 1,
    constraints: ["ready-cartridge-prompt", "one-edge-then-reobserve"],
    evidenceRefs: [`cartridge:${prompt}`],
  });
}

function battlePromptAdvice(observation) {
  if (observation.emulator?.mode !== "battle") return null;
  const ui = observation.playerMemory?.ui ?? {};
  if (ui.moveLearning) return null;
  const battleStage = ui.battle?.stage;
  const prompt = ui.pokedexRegistration?.stage === "registered-entry"
    ? "pokedex-registration"
    : ui.party?.stage === "message"
      ? "battle-party-message"
      : ["message", "level-up-stats"].includes(battleStage)
        ? `battle-message:${battleStage}`
        : null;
  if (!prompt) return null;
  return proposal({
    advisor: "battle",
    observation,
    recommendation: {
      kind: "acknowledge-cartridge-prompt",
      objective: `advance-${prompt.replaceAll(":", "-")}`,
    },
    confidence: 1,
    constraints: ["ready-cartridge-prompt", "one-edge-then-reobserve"],
    evidenceRefs: [`cartridge:${prompt}`],
  });
}

function cyclingRoadRouteCell(recommendation, position, map, cellAt) {
  const plan=recommendation.routePlan;
  const segments=plan?.map===map?.id && plan.origin?.x===position?.x && plan.origin?.y===position?.y
    ? plan.segments : recommendation.pathSegment ? [recommendation.pathSegment] : [];
  let x=Number(position?.x),y=Number(position?.y);
  for(const segment of Array.isArray(segments)?segments:[]) {
    const vector=OVERWORLD_DIRECTIONS.find(v=>v.direction===segment.direction);
    const steps=Number(segment.steps),endpoint=segment.endpoint;
    if(!vector||!Number.isSafeInteger(steps)||steps<1||steps>4096||
       endpoint?.x!==x+vector.dx*steps||endpoint?.y!==y+vector.dy*steps)break;
    for(let n=0;n<steps;n++) {
      x+=vector.dx;y+=vector.dy;
      const cell=cellAt(x,y);
      if(CYCLING_ROAD_SLOPE_BEHAVIORS.has(cell?.behaviorName))return cell;
    }
  }
  return null;
}

function withMovementCapabilities(advice, observation, maps) {
  const recommendationKind = advice?.recommendation?.kind;
  if (!advice || !CYCLING_ROAD_CONTROL_KINDS.has(recommendationKind)) {
    return advice;
  }
  const runningTravel = RUNNING_TRAVEL_KINDS.has(recommendationKind);
  const memory = observation.playerMemory;
  const map = maps.get(memory?.map?.id);
  const position = memory?.position;
  const avatar = memory?.avatar;
  const findCell=(grid,x,y)=>{
    // Native grids are row-major. Partial observations and fixtures can be
    // sparse, so confirm the coordinates before falling back to a lookup.
    const indexed=grid?.cells?.[y*grid.width+x];
    return indexed?.x===x&&indexed?.y===y ? indexed
      : grid?.cells?.find(c=>Number(c.x)===x&&Number(c.y)===y);
  };
  const cellAt=(x,y)=>findCell(memory?.mapGrid,x,y)??findCell(map?.layout,x,y);
  const currentCell=cellAt(Number(position?.x),Number(position?.y));
  const movement = OVERWORLD_DIRECTIONS.find(({ direction }) =>
    direction === advice.recommendation.direction
  );
  const destination = movement
    ? { x: Number(position?.x) + movement.dx, y: Number(position?.y) + movement.dy }
    : null;
  const destinationCell=destination?cellAt(destination.x,destination.y):null;
  const shoesUnlocked =
    memory?.storyState?.flagIds?.[RUNNING_SHOES_FLAG] === true ||
    memory?.storyState?.flags?.FLAG_SYS_B_DASH === true;
  const onFoot = avatar?.onFoot === true || (
    avatar?.onFoot === undefined &&
    (Number(avatar?.flags ?? 0) & (1 << 0)) !== 0
  );
  const ridingBicycle = avatar?.surfing !== true &&
    (Number(avatar?.flags ?? 0) & BICYCLE_AVATAR_FLAGS) !== 0;
  const cyclingRoadCell = [
    currentCell,
    ...(runningTravel ? [destinationCell] : []),
  ].find((cell) =>
    CYCLING_ROAD_SLOPE_BEHAVIORS.has(cell?.behaviorName)
  ) ?? (ridingBicycle&&runningTravel
    // The executor follows every segment before asking for another plan. A
    // flat entry tile cannot remove braking from a later slope or corner.
    ? cyclingRoadRouteCell(advice.recommendation,position,map,cellAt) : null);
  if (
    ridingBicycle &&
    cyclingRoadCell
  ) {
    return assertAdvisorProposal({
      ...advice,
      recommendation: {
        ...advice.recommendation,
        cyclingRoadSlope: true,
        travelMode: "bicycle",
      },
      constraints: [
        ...advice.constraints.filter((constraint) =>
          constraint !== "one-bounded-step-then-reobserve"
        ),
        "cycling-road-downhill-pull",
        "one-tile-retained-input",
      ],
      evidenceRefs: [
        ...advice.evidenceRefs,
        `cartridge:bicycle-avatar-flags:${avatar.flags}`,
        `cartridge:cycling-road-tile:${cyclingRoadCell.behaviorName}`,
      ],
    });
  }
  if (!runningTravel) return advice;
  const hasFullRoute =
    Array.isArray(advice.recommendation.routePlan?.segments) &&
    advice.recommendation.routePlan.segments.length > 0;
  const hasPlannedSegment =
    !hasFullRoute && advice.recommendation.pathSegment !== undefined;
  const movementAdvice = hasFullRoute || hasPlannedSegment
    ? {
        ...advice,
        constraints: [
          ...advice.constraints.filter((constraint) =>
            constraint !== "one-bounded-step-then-reobserve"
          ),
          ...(hasFullRoute
            ? ["preplanned-current-area-route", "exact-waypoints-then-reobserve"]
            : ["preplanned-straight-segment", "exact-waypoint-then-reobserve"]),
        ],
        evidenceRefs: [
          ...advice.evidenceRefs,
          ...(hasFullRoute ? [
            `cartridge:current-area-route:${
              advice.recommendation.routePlan.map
            }:${advice.recommendation.routePlan.mapRevision}`,
          ] : []),
        ],
      }
    : advice;
  const travelMode = avatar?.surfing === true
    ? "surf"
    : ridingBicycle
      ? "bicycle"
      : "walk";
  if (
    !shoesUnlocked ||
    map?.properties?.allow_running !== true ||
    !onFoot ||
    avatar?.surfing === true ||
    !currentCell ||
    currentCell.behaviorName === "MB_RUNNING_DISALLOWED"
  ) {
    return assertAdvisorProposal({
      ...movementAdvice,
      recommendation: {
        ...movementAdvice.recommendation,
        travelMode,
      },
    });
  }
  return assertAdvisorProposal({
    ...movementAdvice,
    recommendation: {
      ...movementAdvice.recommendation,
      useRunningShoes: true,
      travelMode: "run",
    },
    constraints: [
      ...movementAdvice.constraints,
      "running-shoes-unlocked",
      "map-allows-running",
      "on-foot-travel",
    ],
    evidenceRefs: [
      ...movementAdvice.evidenceRefs,
      `cartridge:flag:${RUNNING_SHOES_FLAG}`,
      `cartridge:running-map:${map.id}`,
      `cartridge:running-tile:${currentCell.behaviorName}`,
    ],
  });
}

const PERMANENT_FIELD_MOVES = HM_MOVE_IDS;

function moveRetentionScore(mechanics, pokemon, moveId) {
  if (!moveId) return -Infinity;
  if (PERMANENT_FIELD_MOVES.has(Number(moveId))) return Infinity;
  const move = indexed(mechanics.moves, moveId);
  if (!move) return Infinity;
  const readiness=moveLearningReadiness({move,pokemon,mechanics});
  if(!readiness.usable)return 0;
  const accuracy = Number(move.accuracy) === 0
    ? 1
    : Math.max(0, Math.min(1, Number(move.accuracy) / 100));
  const stab = speciesTypes(mechanics, pokemon).includes(move.type) ? 1.5 : 1;
  if (Number(move.power) > 0) {
    const score=normalizedExpectedMoveDamage({
      move,
      attackerLevel: Number(pokemon?.level) || 50,
      accuracy,
      stab,
    });
    return score===null?null:score*readiness.utilityMultiplier;
  }
  const statusValue = [
    [/SLEEP/, 80],
    [/SYNTHESIS|RECOVER|HEAL/, 70],
    [/LEECH_SEED/, 60],
    [/PARALYZE/, 55],
    [/POISON|TOXIC/, 45],
    [/CONFUS(?:E|ION)/, 40],
    [/SPECIAL_ATTACK_UP|ATTACK_UP/, 35],
    [/DEFENSE_DOWN|SPECIAL_DEFENSE_DOWN/, 25],
    [/ATTACK_DOWN|SPECIAL_ATTACK_DOWN/, 20],
    [/ACCURACY_DOWN|EVASION_DOWN/, 15],
  ].find(([pattern]) => pattern.test(move.effect ?? ""))?.[1] ?? 10;
  return statusValue * accuracy;
}

function moveLearningPlan(observation, document, objective = null, teamPlan = null) {
  const mechanics = dataOf(document);
  const learning = observation.playerMemory?.ui?.moveLearning;
  const pokemon = observation.playerMemory?.trainer?.party?.[
    Number(learning?.partySlot ?? 0)
  ];
  const learnedMoveId = Number(learning?.moveId ?? 0);
  if (learning && !mayLearnMove(pokemon, learnedMoveId, teamPlan)) {
    return { shouldLearn: false, targetMoveSlot: null, forbiddenHm: true };
  }
  if (!learning || !pokemon || !indexed(mechanics.moves, learnedMoveId)) {
    return { shouldLearn: false, targetMoveSlot: null };
  }
  // A task may require a level-up move (the QMM supply's Recycle). Keep the
  // task's other required moves and field moves; replace the weakest other.
  const requiredLearn = (objective?.learnMoveIds ?? []).map(Number);
  if (requiredLearn.includes(learnedMoveId)) {
    const keep = new Set([...requiredLearn, ...(objective?.keepMoveIds ?? []).map(Number)]);
    const candidate = (pokemon.moves ?? []).map((moveId, moveSlot) => ({ moveId: Number(moveId), moveSlot,
      score: moveRetentionScore(mechanics, pokemon, moveId) })).filter(({ moveId }) => !keep.has(moveId) && !PERMANENT_FIELD_MOVES.has(moveId))
      .map((entry) => ({ ...entry, score: entry.score ?? -Infinity }))
      .sort((left, right) => left.score - right.score || left.moveSlot - right.moveSlot)[0];
    return { shouldLearn: Boolean(candidate), targetMoveSlot: candidate?.moveSlot ?? null };
  }
  const learnedMove = indexed(mechanics.moves, learnedMoveId);
  if(!moveLearningReadiness({move:learnedMove,pokemon,mechanics}).usable &&
      objective?.target?.kind!=="teach-move") {
    return {shouldLearn:false,targetMoveSlot:null};
  }
  const learnedScore = moveRetentionScore(mechanics, pokemon, learnedMoveId);
  const existing = (pokemon.moves ?? []).map((moveId, moveSlot) => ({
    moveId: Number(moveId),
    moveSlot,
    move: indexed(mechanics.moves, moveId),
    score: moveRetentionScore(mechanics, pokemon, moveId),
  }));
  const plannedReplacement =
    objective?.target?.kind === "teach-move" &&
    Number(objective.target.moveId) === learnedMoveId &&
    Number.isSafeInteger(objective.target.replaceMoveId)
      ? existing.find(({ moveId }) =>
          moveId === Number(objective.target.replaceMoveId) &&
          !PERMANENT_FIELD_MOVES.has(moveId)
        )
      : null;
  if (plannedReplacement) {
    return { shouldLearn: true, targetMoveSlot: plannedReplacement.moveSlot };
  }
  if (moveDamageKind(learnedMove) === null && Number(learnedMove.power) > 0) {
    return { shouldLearn: false, targetMoveSlot: null };
  }
  const learnedIsDamaging = Number(learnedMove.power) > 0;
  // Moves a task keeps (the QMM supply's screen moves) are never forgotten.
  const kept = new Set((objective?.keepMoveIds ?? []).map(Number));
  const replaceable = (learnedIsDamaging
    ? existing
    : existing.filter(({ move }) => Number(move?.power ?? 0) === 0))
    .filter(({ moveId }) => !kept.has(moveId));
  const weakest = replaceable.map((candidate) => ({
    ...candidate,
    score: candidate.score === null ? Infinity : candidate.score,
  })).sort(
    (left, right) => left.score - right.score || left.moveSlot - right.moveSlot,
  )[0];
  return {
    shouldLearn: Boolean(weakest && learnedScore > weakest.score),
    targetMoveSlot: weakest?.moveSlot ?? null,
  };
}

function teachMoveAdvice(observation, objective, teamPlan) {
  if (objective?.target?.kind !== "teach-move") return null;
  const memory = observation.playerMemory;
  const ui = memory?.ui ?? {};
  const target = objective.target;
  const targetSpecies = new Set((target.partySpecies ?? []).map(Number));
  const partyMember = (memory?.trainer?.party ?? []).find(pokemon =>
    (targetSpecies.size === 0 || targetSpecies.has(Number(pokemon.species))) &&
    mayLearnMove(pokemon, target.moveId, teamPlan)
  );
  let recommendation = null;
  if (!partyMember) {
    if (!(ui.choiceMenu || ui.party || ui.bag || ui.startMenu)) return null;
    recommendation = { kind: 'cancel-conflicting-menu', objective: `replan-${objective.id}-recipient` };
  } else if (ui.choiceMenu) {
    recommendation = {
      kind: "choose-menu-option",
      targetOption: "yes",
      objective: objective.id,
    };
  } else if (ui.party) {
    const committedItemPicker =
      ui.party.stage === "choose-pokemon" &&
      Number(ui.party.itemId) === Number(target.itemId);
    if (!committedItemPicker) {
      recommendation = {
        kind: "cancel-conflicting-menu",
        objective: `restart-${objective.id}`,
      };
    } else {
      if (!partyMember) return null;
      recommendation = {
        kind: "choose-party-member",
        targetPartySlot: partyMember.slot,
        targetSpecies: partyMember.species,
        objective: objective.id,
      };
    }
  } else if (ui.bag?.stage === "tm-case-context") {
    recommendation = {
      kind: "choose-bag-context-action",
      targetAction: "use",
      targetIndex: 0,
      objective: objective.id,
    };
  } else if (ui.bag?.stage === "tm-case-list") {
    const targetIndex = (memory?.trainer?.bag?.tmhm ?? []).findIndex(
      ({ itemId }) => Number(itemId) === Number(target.itemId),
    );
    if (targetIndex < 0) return null;
    recommendation = {
      kind: "choose-tm-case-item",
      targetItemId: target.itemId,
      targetIndex,
      objective: objective.id,
    };
  } else if (ui.bag?.stage === "context") {
    recommendation = {
      kind: "choose-bag-context-action",
      targetAction: "open",
      targetIndex: 0,
      objective: objective.id,
    };
  } else if (ui.bag?.stage === "list") {
    if (Number(ui.bag.pocket) !== 1) {
      recommendation = {
        kind: "choose-bag-pocket",
        targetPocket: 1,
        objective: objective.id,
      };
    } else {
      const targetIndex = (memory?.trainer?.bag?.keyItems ?? []).findIndex(
        ({ itemId }) => Number(itemId) === 364,
      );
      if (targetIndex < 0) return null;
      recommendation = {
        kind: "choose-bag-item",
        targetItemId: 364,
        targetIndex,
        objective: objective.id,
      };
    }
  } else if (ui.startMenu) {
    const targetIndex = ui.startMenu.order?.indexOf("bag") ?? -1;
    if (targetIndex < 0) return null;
    recommendation = {
      kind: "choose-start-menu-item",
      targetItem: "bag",
      targetIndex,
      objective: objective.id,
    };
  } else if (observation.emulator?.mode === "overworld") {
    recommendation = { kind: "open-start-menu", objective: objective.id };
  }
  return recommendation
    ? proposal({
        advisor: "quest",
        observation,
        recommendation,
        confidence: 0.995,
        constraints: ["owned-hm", "source-observed-menu-state"],
        evidenceRefs: [
          `campaign:objective:${objective.id}`,
          `cartridge:item:${target.itemId}`,
          `cartridge:move:${target.moveId}`,
        ],
      })
    : null;
}

function inventoryQuantity(memory, itemId) {
  const bag = memory?.trainer?.bag ?? {};
  return Number(Object.values(bag).flat().find(
    (entry) => Number(entry?.itemId) === Number(itemId),
  )?.quantity ?? 0);
}

function useItemfinderAdvice(observation, objective) {
  if (objective?.target?.kind !== "itemfinder") return null;
  const memory = observation.playerMemory;
  const ui = memory?.ui ?? {};
  const position = memory?.position;
  if (
    memory?.map?.id !== objective.target.map ||
    Number(position?.x) !== Number(objective.target.x) ||
    Number(position?.y) !== Number(objective.target.y) ||
    inventoryQuantity(memory, ITEM_ITEMFINDER) <= 0 ||
    ui.fieldDialog || ui.choiceMenu || ui.specialAnimation
  ) return null;
  let recommendation = null;
  if (ui.bag?.stage === "context") {
    recommendation = Number(ui.bag.selectedItemId) === ITEM_ITEMFINDER
      ? {
          kind: "choose-bag-context-action",
          targetAction: "use",
          targetIndex: 0,
          objective: objective.id,
        }
      : { kind: "close-menu", objective: objective.id };
  } else if (ui.bag?.stage === "list") {
    if (Number(ui.bag.pocket) !== 1) {
      recommendation = {
        kind: "choose-bag-pocket",
        targetPocket: 1,
        objective: objective.id,
      };
    } else {
      const targetIndex = (memory?.trainer?.bag?.keyItems ?? []).findIndex(
        ({ itemId }) => Number(itemId) === ITEM_ITEMFINDER,
      );
      if (targetIndex < 0) return null;
      recommendation = {
        kind: "choose-bag-item",
        targetItemId: ITEM_ITEMFINDER,
        targetIndex,
        objective: objective.id,
      };
    }
  } else if (ui.startMenu) {
    const targetIndex = ui.startMenu.order?.indexOf("bag") ?? -1;
    if (targetIndex < 0) return null;
    recommendation = {
      kind: "choose-start-menu-item",
      targetItem: "bag",
      targetIndex,
      objective: objective.id,
    };
  } else if (observation.emulator?.mode === "overworld") {
    recommendation = { kind: "open-start-menu", objective: objective.id };
  }
  return recommendation
    ? proposal({
        advisor: "quest",
        observation,
        recommendation,
        confidence: 0.999,
        constraints: [
          "stand-on-underfoot-hidden-item",
          "owned-itemfinder",
          "source-observed-menu-state",
        ],
        evidenceRefs: [
          `campaign:collection:${objective.id}`,
          `cartridge:item:${ITEM_ITEMFINDER}`,
          `cartridge:hidden-item:${objective.target.map}:${objective.target.x},${objective.target.y}`,
        ],
      })
    : null;
}

function useVsSeekerAdvice(observation, objective) {
  if (
    objective?.trainingSource !== "vs-seeker" ||
    objective?.vsSeekerAction !== "activate" ||
    !["object", "map-arrival", "vs-seeker-activation"].includes(
      objective?.target?.kind,
    )
  ) return null;
  const memory = observation.playerMemory;
  const ui = memory?.ui ?? {};
  const position = memory?.position;
  const batchedLocalIds = objective?.vsSeekerBatch?.localIds;
  const localIds = Array.isArray(batchedLocalIds) && batchedLocalIds.length > 0
    ? batchedLocalIds.map(Number)
    : [Number(objective.trainer?.localId)];
  const atActivationPosition = objective.target.kind === "object" || (
    Number(position?.x) === Number(objective.target.x) &&
    Number(position?.y) === Number(objective.target.y)
  );
  const trainersVisible = localIds.length > 0 && localIds.every(
    candidateLocalId => vsSeekerTrainerVisible(observation, candidateLocalId),
  );
  const rematchEntries = memory?.vsSeeker?.rematchEntries;
  if (
    memory?.map?.id !== objective.target.map ||
    !atActivationPosition ||
    !trainersVisible ||
    Number(memory?.vsSeeker?.batterySteps ?? 0) < 100 ||
    localIds.some((candidateLocalId) =>
      !Number.isSafeInteger(candidateLocalId) || candidateLocalId < 1 ||
      Number(rematchEntries?.[candidateLocalId] ?? 0) !== 0
    ) ||
    inventoryQuantity(memory, ITEM_VS_SEEKER) <= 0 ||
    ui.fieldDialog || ui.choiceMenu || ui.specialAnimation
  ) return null;
  let recommendation = null;
  if (ui.bag?.stage === "context") {
    recommendation = Number(ui.bag.selectedItemId) === ITEM_VS_SEEKER
      ? {
          kind: "choose-bag-context-action",
          targetAction: "use",
          targetIndex: 0,
          objective: objective.id,
        }
      : { kind: "close-menu", objective: objective.id };
  } else if (ui.bag?.stage === "list") {
    if (Number(ui.bag.pocket) !== 1) {
      recommendation = {
        kind: "choose-bag-pocket",
        targetPocket: 1,
        objective: objective.id,
      };
    } else {
      const targetIndex = (memory?.trainer?.bag?.keyItems ?? []).findIndex(
        ({ itemId }) => Number(itemId) === ITEM_VS_SEEKER,
      );
      if (targetIndex < 0) return null;
      recommendation = {
        kind: "choose-bag-item",
        targetItemId: ITEM_VS_SEEKER,
        targetIndex,
        objective: objective.id,
      };
    }
  } else if (ui.startMenu) {
    const targetIndex = ui.startMenu.order?.indexOf("bag") ?? -1;
    if (targetIndex < 0) return null;
    recommendation = {
      kind: "choose-start-menu-item",
      targetItem: "bag",
      targetIndex,
      objective: objective.id,
    };
  } else if (observation.emulator?.mode === "overworld") {
    recommendation = { kind: "open-start-menu", objective: objective.id };
  }
  return recommendation
    ? proposal({
        advisor: "quest",
        observation,
        recommendation,
        confidence: 0.999,
        constraints: [
          "charged-vs-seeker",
          "rematch-trainer-visible",
          "source-observed-menu-state",
        ],
        evidenceRefs: [
          `campaign:objective:${objective.id}`,
          `cartridge:item:${ITEM_VS_SEEKER}`,
          ...localIds.map((candidateLocalId) =>
            `cartridge:rematch-local-id:${candidateLocalId}`
          ),
        ],
      })
    : null;
}

function flyLandingPosition(map, destination) {
  const cells = (map?.layout?.cells ?? []).filter(
    ({ collision }) => Number(collision) === 0,
  );
  if (cells.length === 0) return null;
  const desired = destination?.landing;
  return cells.map((cell, order) => ({
    x: Number(cell.x),
    y: Number(cell.y),
    order,
  })).sort((left, right) =>
    Math.abs(left.x - Number(desired?.x)) +
      Math.abs(left.y - Number(desired?.y)) -
      Math.abs(right.x - Number(desired?.x)) -
      Math.abs(right.y - Number(desired?.y)) ||
    left.order - right.order
  )[0];
}

function flyTravelPlan(observation, objective, world) {
  if (isSeviiFlyMap(observation, world)) return null;
  const memory = observation?.playerMemory;
  const position = memory?.position;
  const maps = dataOf(world).maps ?? [];
  const mapsById = new Map(maps.map((map) => [map.id, map]));
  const currentMap = mapsById.get(memory?.map?.id);
  const targetMap = mapsById.get(objective?.target?.map);
  if (
    !currentMap || !targetMap ||
    memory?.storyState?.flagIds?.[THUNDER_BADGE_FLAG] !== true
  ) return null;
  const member = (memory?.trainer?.party ?? []).find(({ moves }) =>
    (moves ?? []).map(Number).includes(MOVE_FLY)
  );
  if (!member) return null;
  const indoors = !FLY_ALLOWED_MAP_TYPES.has(currentMap.properties?.map_type);
  // Keep ordinary indoor walking and local interactions as they are.
  if (indoors && (currentMap.id === targetMap.id ||
      campaignNavigationRecommendation({ world, observation, objective }))) return null;

  // Route 23's northern Victory Road landing is a cartridge-disconnected
  // pocket. Preserve a direct region-section escape even when a reduced test
  // world does not include the destination city's exterior map.
  const isolatedVictoryRoadLanding =
    memory.map.id === "MAP_ROUTE23" &&
    Number.isSafeInteger(position?.y) && position.y <= 30;
  const targetMapSection = targetMap.properties?.region_map_section;
  const directDestination = FLY_MAP_DESTINATIONS[targetMapSection];
  let selected = isolatedVictoryRoadLanding && directDestination &&
      targetMapSection !== "MAPSEC_INDIGO_PLATEAU" &&
      memory.storyState?.flagIds?.[directDestination.visitedFlagId] === true
    ? { targetMapSection, destination: directDestination }
    : null;

  if (!selected) {
    const candidates = Object.entries(FLY_MAP_DESTINATIONS).flatMap(
      ([mapSection, destination]) => {
        const destinationMap = mapsById.get(destination.map);
        if (
          memory.storyState?.flagIds?.[destination.visitedFlagId] !== true ||
          !destinationMap || destination.map === currentMap.id
        ) return [];
        const landing = flyLandingPosition(destinationMap, destination);
        return landing
          ? [{ targetMapSection: mapSection, destination, landing }]
          : [];
      },
    );
    const transitionDistances = campaignRegionTransitionDistances({
      world,
      observation,
      target: objective.target,
      origins: [
        { map: currentMap.id, position },
        ...candidates.map(({ destination, landing }) => ({
          map: destination.map,
          position: landing,
        })),
      ],
    });
    const currentDistance = transitionDistances[0];
    const rankedCandidates = candidates.map((candidate, index) => ({
      ...candidate,
      distance: transitionDistances[index + 1],
    })).filter(({ distance }) => Number.isSafeInteger(distance)).sort((left, right) =>
      left.distance - right.distance ||
      left.targetMapSection.localeCompare(right.targetMapSection)
    );
    const best = rankedCandidates[0];
    // A proven Fly landing can reach a destination even when walking cannot.
    // When both routes exist, account for opening the party and Fly map.
    if (
      best && (!Number.isSafeInteger(currentDistance) ||
      best.distance + 1 < currentDistance)
    ) selected = best;
  }
  if (!selected) return null;
  let staging = null;
  if (indoors) {
    // Preserve reachable walking routes and local interactions. If only Fly
    // connects the goal, first prove a real exit; never open Fly indoors.
    const target = campaignOutdoorStagingTarget({ world, observation, allowedMapTypes: FLY_ALLOWED_MAP_TYPES });
    if (!target) return null;
    staging = campaignNavigationRecommendation({ world, observation,
      objective: { ...objective, id: `fly-to-${selected.targetMapSection}-exit`, target } });
    if (!staging) return null;
  }
  return {
    member,
    ...(staging ? { staging } : {}),
    targetMapSection: selected.targetMapSection,
    targetCursor: { x: selected.destination.x, y: selected.destination.y },
    objective: `fly-to-${selected.targetMapSection}`,
  };
}

function useFlyAdvice(observation, objective, world) {
  const memory = observation.playerMemory;
  const ui = memory?.ui ?? {};
  // Overworld callbacks also run while a script owns a Yes/No prompt or the
  // actors finish moving. Finish that owner before planning a new Fly menu.
  // Start/party/Fly menus retain their own workflow below.
  if (observation.emulator?.mode === 'overworld' &&
      (Object.values(ui).some(Boolean) || memory?.scripts?.fieldControlsLocked)) return null;
  if (ui.flyMap?.stage === 'selection' && isSeviiFlyMap(observation, world)) {
    return proposal({advisor: 'quest', observation,
      recommendation: {kind: 'close-menu', objective: objective?.id ?? 'leave-unsupported-fly-region'},
      confidence: 0.999, constraints: ['fly-destinations-must-share-current-region'],
      evidenceRefs: [`cartridge:map:${memory.map.id}`, 'cartridge:region-map:sSeviiMapsecs']});
  }
  const plan = flyTravelPlan(observation, objective, world);
  if (!plan) return null;
  let recommendation = null;
  if (plan.staging) {
    if (observation.emulator?.mode !== 'overworld' || Object.values(ui).some(Boolean)) return null;
    recommendation = plan.staging;
  } else if (ui.flyMap?.stage === "selection") {
    recommendation = {
      kind: "choose-fly-destination",
      targetMapSection: plan.targetMapSection,
      targetCursor: plan.targetCursor,
      objective: plan.objective,
    };
  } else if (ui.party?.stage === "selection-menu") {
    if (Number(ui.party.selectedPartySlot) !== Number(plan.member.slot)) {
      recommendation = { kind: "close-menu", objective: plan.objective };
    } else {
      const targetIndex = ui.party.actions?.indexOf("fly") ?? -1;
      if (targetIndex >= 0) {
        recommendation = {
          kind: "choose-party-action",
          targetAction: "fly",
          targetIndex,
          objective: plan.objective,
        };
      }
    }
  } else if (ui.party?.stage === "choose-pokemon") {
    recommendation = {
      kind: "choose-party-member",
      targetPartySlot: plan.member.slot,
      targetSpecies: plan.member.species,
      objective: plan.objective,
    };
  } else if (ui.party?.stage === "message") {
    recommendation = {
      kind: "acknowledge-cartridge-prompt",
      objective: plan.objective,
    };
  } else if (ui.startMenu) {
    const targetIndex = ui.startMenu.order?.indexOf("pokemon") ?? -1;
    if (targetIndex >= 0) {
      recommendation = {
        kind: "choose-start-menu-item",
        targetItem: "pokemon",
        targetIndex,
        objective: plan.objective,
      };
    }
  } else if (observation.emulator?.mode === "overworld") {
    recommendation = { kind: "open-start-menu", objective: plan.objective };
  }
  return recommendation
    ? proposal({
        advisor: "quest",
        observation,
        recommendation,
        confidence: 0.999,
        constraints: [
          "visited-fly-destination",
          "source-observed-fly-map-cursor",
          "shortest-reachable-fly-staging",
        ],
        evidenceRefs: [
          `campaign:objective:${objective.id}`,
          `cartridge:move:${MOVE_FLY}`,
          `cartridge:fly-destination:${plan.targetMapSection}`,
          ...(objective.trainer?.id != null
            ? [`cartridge:trainer:${objective.trainer.id}`] : []),
        ],
      })
    : null;
}

function useFishingRodAdvice(observation, objective, world) {
  if (objective?.target?.kind !== "fishing-zone") return null;
  const memory = observation.playerMemory;
  const ui = memory?.ui ?? {};
  const map = (dataOf(world).maps ?? []).find(
    ({ id }) => id === memory?.map?.id,
  );
  const position = memory?.position;
  const rodItemId = Number(objective.target.rodItemId ?? objective.rodItemId);
  if (
    !map || memory?.map?.id !== objective.target.map ||
    !Number.isSafeInteger(rodItemId) ||
    inventoryQuantity(memory, rodItemId) <= 0 ||
    ui.fieldDialog || ui.choiceMenu || ui.specialAnimation
  ) return null;
  const cells = new Map(
    (map.layout?.cells ?? []).map((cell) => [`${cell.x},${cell.y}`, cell]),
  );
  const fishingDirection = OVERWORLD_DIRECTIONS.find(({ dx, dy }) => {
    const adjacent = cells.get(
      `${Number(position?.x) + dx},${Number(position?.y) + dy}`,
    );
    return Number(adjacent?.collision) === 0 &&
      FISHABLE_WATER_BEHAVIORS.has(adjacent?.behaviorName);
  })?.direction;
  if (!fishingDirection) return null;
  let recommendation = null;
  if (
    observation.emulator?.mode === "overworld" &&
    memory?.avatar?.facing !== fishingDirection
  ) {
    recommendation = {
      kind: "face-fishing-water",
      direction: fishingDirection,
      objective: objective.id,
    };
  } else if (ui.bag?.stage === "context") {
    recommendation = Number(ui.bag.selectedItemId) === rodItemId
      ? {
          kind: "choose-bag-context-action",
          targetAction: "use",
          targetIndex: 0,
          objective: objective.id,
        }
      : { kind: "close-menu", objective: objective.id };
  } else if (ui.bag?.stage === "list") {
    if (Number(ui.bag.pocket) !== 1) {
      recommendation = {
        kind: "choose-bag-pocket",
        targetPocket: 1,
        objective: objective.id,
      };
    } else {
      const targetIndex = (memory?.trainer?.bag?.keyItems ?? []).findIndex(
        ({ itemId }) => Number(itemId) === rodItemId,
      );
      if (targetIndex < 0) return null;
      recommendation = {
        kind: "choose-bag-item",
        targetItemId: rodItemId,
        targetIndex,
        objective: objective.id,
      };
    }
  } else if (ui.startMenu) {
    const targetIndex = ui.startMenu.order?.indexOf("bag") ?? -1;
    if (targetIndex < 0) return null;
    recommendation = {
      kind: "choose-start-menu-item",
      targetItem: "bag",
      targetIndex,
      objective: objective.id,
    };
  } else if (observation.emulator?.mode === "overworld") {
    recommendation = { kind: "open-start-menu", objective: objective.id };
  }
  return recommendation
    ? proposal({
        advisor: "quest",
        observation,
        recommendation,
        confidence: 0.999,
        constraints: [
          "owned-required-fishing-rod",
          "face-fishable-water",
          "source-observed-menu-state",
        ],
        evidenceRefs: [
          `campaign:objective:${objective.id}`,
          `cartridge:item:${rodItemId}`,
          `cartridge:fishing-map:${map.id}`,
        ],
      })
    : null;
}

function damagingMovePower(mechanics, pokemon, wantedType = null) {
  return (pokemon.moves ?? []).reduce((total, moveId) => {
    const move = indexed(mechanics.moves, moveId);
    return total + (
      Number(move?.power ?? 0) > 0 && (!wantedType || move.type === wantedType)
        ? Number(move.power)
        : 0
    );
  }, 0);
}

function heldItemTarget(itemId, party, mechanics, teamPlan) {
  const empty = party.filter(({ heldItem }) => Number(heldItem ?? 0) === 0);
  const battleCore = empty.filter((pokemon) => !isHmUtilityCarrier(pokemon, teamPlan));
  const candidates = battleCore.length > 0 ? battleCore : empty;
  if (candidates.length === 0) return null;
  const speciesItems={191:[380,381],192:[366],193:[366],202:[25],223:[132],224:[104,105],222:[113],225:[83]};
  if(speciesItems[itemId])return candidates.filter(p=>speciesItems[itemId].includes(nationalSpeciesId(p.species))).sort((a,b)=>damagingMovePower(mechanics,b)-damagingMovePower(mechanics,a))[0]??null;
  if(itemId===186)return candidates.filter(p=>{
    const moves=(p.moves??[]).map(id=>indexed(mechanics.moves,id)).filter(Boolean);
    return moves.length>=2&&moves.filter(m=>m.power>0&&PHYSICAL_TYPES.has(m.type)).length>=2&&!moves.some(m=>['EFFECT_DREAM_EATER','EFFECT_SNORE','EFFECT_SLEEP_TALK','EFFECT_FOCUS_PUNCH'].includes(m.effect));
  }).sort((a,b)=>Number(b.stats?.attack??0)-Number(a.stats?.attack??0))[0]??null;
  const held=describeHeldItem(itemId);
  if(held?.consumable)return candidates.filter(p=>{
    if(berryConfuses(p,held.effect)!==false)return false;
    const moves=(p.moves??[]).map(id=>indexed(mechanics.moves,id)).filter(Boolean);
    if(held.effect==='HOLD_EFFECT_ATTACK_UP')return moves.some(m=>m.power>0&&PHYSICAL_TYPES.has(m.type));
    if(held.effect==='HOLD_EFFECT_SP_ATTACK_UP')return moves.some(m=>m.power>0&&!PHYSICAL_TYPES.has(m.type));
    if(held.effect==='HOLD_EFFECT_RESTORE_STATS')return moves.some(m=>['EFFECT_OVERHEAT','EFFECT_SUPERPOWER'].includes(m.effect));
    return true;
  }).sort((a,b)=>Number(b.maxHp??0)-Number(a.maxHp??0))[0]??null;
  const wantedType = HELD_TYPE_BOOSTS.get(itemId);
  if (wantedType) {
    return candidates.map((pokemon) => ({
      pokemon,
      score: damagingMovePower(mechanics, pokemon, wantedType),
    })).filter(({ score }) => score > 0)
      .sort((left, right) =>
        right.score - left.score ||
        Number(right.pokemon.level ?? 0) - Number(left.pokemon.level ?? 0) ||
        Number(left.pokemon.slot) - Number(right.pokemon.slot)
      )[0]?.pokemon ?? null;
  }
  if (itemId === 182) {
    return [...candidates].sort((left, right) =>
      Number(left.level ?? 0) - Number(right.level ?? 0) ||
      Number(left.slot) - Number(right.slot)
    )[0];
  }
  if (itemId === 200) {
    return [...candidates].sort((left, right) =>
      Number(right.maxHp ?? 0) - Number(left.maxHp ?? 0) ||
      Number(right.level ?? 0) - Number(left.level ?? 0) ||
      Number(left.slot) - Number(right.slot)
    )[0];
  }
  if (itemId === 183) {
    return [...candidates].sort((left, right) =>
      Number(left.stats?.speed ?? Number.MAX_SAFE_INTEGER) -
        Number(right.stats?.speed ?? Number.MAX_SAFE_INTEGER) ||
      Number(left.slot) - Number(right.slot)
    )[0];
  }
  if (itemId === 189) {
    return candidates.find(({ slot }) => Number(slot) === 0) ?? candidates[0];
  }
  return [...candidates].sort((left, right) =>
    damagingMovePower(mechanics, right) - damagingMovePower(mechanics, left) ||
    Number(right.level ?? 0) - Number(left.level ?? 0) ||
    Number(left.slot) - Number(right.slot)
  )[0];
}

function selectHeldItemPlan(
  observation,
  mechanicsDocument,
  teamPlan,
  trainingObjective = null,
  allowConsumables = true,
  expShareOnly = false,
  passiveTrainee = null,
) {
  const memory = observation.playerMemory;
  const mechanics = dataOf(mechanicsDocument);
  const party = memory?.trainer?.party ?? [];
  const items = [...(memory?.trainer?.bag?.items??[]).map(i=>({...i,pocket:0})),...(memory?.trainer?.bag?.berries??[]).map(i=>({...i,pocket:4}))]
    .filter(({ itemId, quantity, pocket }) =>
      HELD_ITEM_PRIORITIES.has(Number(itemId)) && Number(quantity) > 0 && (allowConsumables || !describeHeldItem(Number(itemId))?.consumable) && (pocket!==4 || memory?.trainer?.bag?.keyItems?.some(i=>i.itemId===365&&i.quantity>0))
    )
    .sort((left, right) =>
      HELD_ITEM_PRIORITIES.get(Number(right.itemId)) -
        HELD_ITEM_PRIORITIES.get(Number(left.itemId)) ||
      Number(left.itemId) - Number(right.itemId)
  );
  const desiredExpShareSlot = Number(trainingObjective?.expSharePartySlot);
  const requestedExpShareTarget = Number.isSafeInteger(desiredExpShareSlot)
    ? party.find(({ slot, heldItem }) =>
        Number(slot) === desiredExpShareSlot && Number(heldItem ?? 0) === 0
      ) ?? null
    : null;
  if (
    requestedExpShareTarget &&
    items.some(({ itemId }) => Number(itemId) === 182)
  ) {
    return { itemId: 182, target: requestedExpShareTarget, pocket:0 };
  }
  if (expShareOnly) return null;
  // A League passive trainee (league-exp-share.js) gets the Exp. Share through
  // its own give step: the general policy neither equips the Exp. Share on
  // another member nor equips the trainee, and leaves the trainee's own item
  // (reservedItemId, returned to it later) in the Bag.
  const equipParty = passiveTrainee
    ? party.filter((member) => !isPassiveTrainee(member, passiveTrainee))
    : party;
  for (const item of items) {
    if (passiveTrainee && Number(item.itemId) === 182) continue;
    if (passiveTrainee && Number(item.itemId) === Number(passiveTrainee.reservedItemId)) continue;
    const target = heldItemTarget(Number(item.itemId), equipParty, mechanics, teamPlan);
    if (target) return { itemId: Number(item.itemId), target, pocket:item.pocket };
  }
  return null;
}

function relocateExpShareAdvice(observation, trainingObjective) {
  if (observation.emulator?.mode === "battle") return null;
  const desiredSlot = Number(trainingObjective?.expSharePartySlot);
  if (!Number.isSafeInteger(desiredSlot)) return null;
  const memory = observation.playerMemory;
  const ui = memory?.ui ?? {};
  const party = memory?.trainer?.party ?? [];
  const holder = party.find(({ heldItem }) => Number(heldItem ?? 0) === 182);
  const target = party.find(({ slot }) => Number(slot) === desiredSlot);
  if (
    !holder || !target ||
    Number(holder.slot) === desiredSlot
  ) return null;
  const itemSource = Number(target.heldItem ?? 0) !== 0 ? target : holder;
  const objective = `move-exp-share-to-slot-${desiredSlot}`;
  let recommendation = null;
  if (ui.party?.stage === "selection-menu") {
    if (Number(ui.party.selectedPartySlot) !== Number(itemSource.slot)) {
      recommendation = { kind: "close-menu", objective };
    } else {
      const takeIndex = ui.party.actions?.indexOf("take-item") ?? -1;
      const itemIndex = ui.party.actions?.indexOf("item") ?? -1;
      if (takeIndex >= 0) {
        recommendation = {
          kind: "choose-party-action",
          targetAction: "take-item",
          targetIndex: takeIndex,
          objective,
        };
      } else if (itemIndex >= 0) {
        recommendation = {
          kind: "choose-party-action",
          targetAction: "item",
          targetIndex: itemIndex,
          objective,
        };
      }
    }
  } else if (ui.party?.stage === "choose-pokemon") {
    recommendation = {
      kind: "choose-party-member",
      targetPartySlot: itemSource.slot,
      targetSpecies: itemSource.species,
      objective,
    };
  } else if (ui.startMenu) {
    const targetIndex = ui.startMenu.order?.indexOf("pokemon") ?? -1;
    if (targetIndex < 0) return null;
    recommendation = {
      kind: "choose-start-menu-item",
      targetItem: "pokemon",
      targetIndex,
      objective,
    };
  } else if (observation.emulator?.mode === "overworld" && !ui.choiceMenu) {
    recommendation = { kind: "open-start-menu", objective };
  }
  return recommendation
    ? proposal({
        advisor: "quest",
        observation,
        recommendation,
        confidence: 0.985,
        constraints: [
          "rotate-exp-share-to-under-level-member",
          "preserve-existing-held-items",
          "source-observed-party-menu-state",
        ],
        evidenceRefs: [
          "cartridge:held-item:182",
          `cartridge:party-slot:${holder.slot}:exp-share-holder`,
          `cartridge:party-slot:${itemSource.slot}:held-item-source`,
          `campaign:party-slot:${desiredSlot}:exp-share-target`,
        ],
      })
    : null;
}

function equipHeldItemAdvice(
  observation,
  mechanics,
  teamPlan,
  trainingObjective = null,
  allowConsumables = true,
  expShareOnly = false,
  passiveTrainee = null,
) {
  if (observation.emulator?.mode === "battle") return null;
  const memory = observation.playerMemory;
  const ui = memory?.ui ?? {};
  const messageItemId = Number(ui.party?.itemId);
  if (
    ui.party?.stage === "message" &&
    HELD_ITEM_PRIORITIES.has(messageItemId)
  ) {
    return proposal({
      advisor: "quest",
      observation,
      recommendation: {
        kind: "acknowledge-cartridge-prompt",
        objective: `confirm-held-item-${messageItemId}`,
      },
      confidence: 0.98,
      constraints: ["source-observed-party-item-message"],
      evidenceRefs: [`cartridge:held-item:${messageItemId}`],
    });
  }
  const plan = selectHeldItemPlan(
    observation,
    mechanics,
    teamPlan,
    trainingObjective,
    allowConsumables,
    expShareOnly,
    passiveTrainee,
  );
  if (!plan) return null;
  const objective = `equip-held-item-${plan.itemId}-on-slot-${plan.target.slot}`;
  let recommendation = null;
  if (ui.choiceMenu && observation.emulator?.mode === "party") {
    recommendation = {
      kind: "choose-menu-option",
      targetOption: "no",
      objective,
    };
  } else if (ui.party?.stage === "choose-pokemon") {
    recommendation = Number(ui.party.itemId ?? plan.itemId) === plan.itemId
      ? {
          kind: "choose-party-member",
          targetPartySlot: plan.target.slot,
          targetSpecies: plan.target.species,
          objective,
        }
      : { kind: "close-menu", objective };
  } else if (plan.pocket===4 && ui.bag?.stage==='berry-pouch-context') {
    const give=ui.bag.actions?.indexOf('give')??-1;
    recommendation=Number(ui.bag.selectedItemId)===plan.itemId&&give>=0
      ? {kind:'choose-bag-context-action',targetAction:'give',targetIndex:give,objective}
      : {kind:'close-menu',objective};
  } else if (plan.pocket===4 && ui.bag?.stage==='berry-pouch-list') {
    const targetIndex=(memory.trainer.bag.berries??[]).findIndex(i=>i.itemId===plan.itemId);
    recommendation=targetIndex>=0?{kind:'choose-bag-item',targetItemId:plan.itemId,targetIndex,objective}:null;
  } else if (plan.pocket===4 && ui.bag?.stage==='context') {
    recommendation=Number(ui.bag.selectedItemId)===365
      ? {kind:'choose-bag-context-action',targetAction:'open',targetIndex:0,objective}
      : {kind:'close-menu',objective};
  } else if (plan.pocket===4 && ui.bag?.stage==='list') {
    if(ui.bag.pocket!==1)recommendation={kind:'choose-bag-pocket',targetPocket:1,objective};
    else {
      const targetIndex=(memory.trainer.bag.keyItems??[]).findIndex(i=>i.itemId===365);
      recommendation=targetIndex>=0?{kind:'choose-bag-item',targetItemId:365,targetIndex,objective}:null;
    }
  } else if (ui.bag?.stage === "context") {
    recommendation = Number(ui.bag.selectedItemId) === plan.itemId
      ? {
          kind: "choose-bag-context-action",
          targetAction: "give",
          targetIndex: 1,
          objective,
        }
      : { kind: "close-menu", objective };
  } else if (ui.bag?.stage === "list") {
    if (Number(ui.bag.pocket) !== plan.pocket) {
      recommendation = {
        kind: "choose-bag-pocket",
        targetPocket: plan.pocket,
        objective,
      };
    } else {
      const targetIndex = (memory?.trainer?.bag?.[plan.pocket===4?"berries":"items"] ?? []).findIndex(
        ({ itemId }) => Number(itemId) === plan.itemId,
      );
      if (targetIndex < 0) return null;
      recommendation = {
        kind: "choose-bag-item",
        targetItemId: plan.itemId,
        targetIndex,
        objective,
      };
    }
  } else if (ui.startMenu) {
    const targetIndex = ui.startMenu.order?.indexOf("bag") ?? -1;
    if (targetIndex < 0) return null;
    recommendation = {
      kind: "choose-start-menu-item",
      targetItem: "bag",
      targetIndex,
      objective,
    };
  } else if (observation.emulator?.mode === "overworld" && !ui.choiceMenu) {
    recommendation = { kind: "open-start-menu", objective };
  }
  return recommendation
    ? proposal({
        advisor: "quest",
        observation,
        recommendation,
        confidence: 0.975,
        constraints: [
          "owned-compatible-held-item",
          "empty-held-item-slot",
          "source-observed-menu-state",
        ],
        evidenceRefs: [
          `cartridge:held-item:${plan.itemId}`,
          `cartridge:party-slot:${plan.target.slot}:species:${plan.target.species}`,
        ],
      })
    : null;
}

function rosterFamilyPresent(party, family) {
  const wanted = new Set((family ?? []).map(Number));
  return party.some(({ species }) => wanted.has(Number(species)));
}

function battleRosterCoverageScore(candidate, party, document) {
  const mechanics = dataOf(document);
  const speciesFor = (pokemon) => indexed(mechanics.species, pokemon?.species);
  const moveFor = (moveId) => indexed(mechanics.moves, moveId);
  const existingTypes = new Set(
    party.flatMap((pokemon) => speciesFor(pokemon)?.types ?? []),
  );
  const existingMoveTypes = new Set(
    party.flatMap((pokemon) => (pokemon.moves ?? []).flatMap((moveId) => {
      const move = moveFor(moveId);
      return move && Number(move.power) > 0 ? [move.type] : [];
    })),
  );
  const candidateTypes = speciesFor(candidate)?.types ?? [];
  const candidateMoves = (candidate.moves ?? []).flatMap((moveId) => {
    const move = moveFor(moveId);
    return move && Number(move.power) > 0 ? [move] : [];
  });
  const candidateMoveTypes = new Set(candidateMoves.map(({ type }) => type));
  const defendingTypes = new Set([
    ...(mechanics.typeChart ?? []).map(({ defendingType }) => defendingType),
    ...Object.values(mechanics.species ?? {}).flatMap(
      (species) => species?.types ?? [],
    ),
  ]);
  const offensiveCoverage = (moveTypes) => new Set(
    [...defendingTypes].filter((defendingType) =>
      [...moveTypes].some((attackingType) =>
        typeMultiplier(mechanics, attackingType, [defendingType]) > 1
      )
    ),
  );
  const existingOffense = offensiveCoverage(existingMoveTypes);
  const candidateOffense = offensiveCoverage(candidateMoveTypes);
  const newOffensiveAnswers = [...candidateOffense].filter(
    (type) => !existingOffense.has(type),
  ).length;
  const newDefensiveTypes = new Set(
    candidateTypes.filter((type) => !existingTypes.has(type)),
  ).size;
  const novelAttackTypes = [...candidateMoveTypes].filter(
    (type) => !existingMoveTypes.has(type),
  ).length;
  const strongestMovePower = Math.max(
    0,
    ...candidateMoves.map(({ power }) => Number(power ?? 0)),
  );
  return newOffensiveAnswers * 10_000 +
    newDefensiveTypes * 1_000 +
    novelAttackTypes * 100 +
    strongestMovePower +
    Number(candidate.level ?? 0);
}

function selectStoredRosterCandidate(candidates, party, mechanics) {
  return [...candidates].sort((left, right) =>
    battleRosterCoverageScore(right, party, mechanics) -
      battleRosterCoverageScore(left, party, mechanics) ||
    Number(left.box ?? 0) - Number(right.box ?? 0) ||
    Number(left.slot ?? 0) - Number(right.slot ?? 0)
  )[0] ?? null;
}

function selectRosterDepositCandidate(party, target, teamPlan) {
  const requiredFamilies = target?.requiredFamilies ?? [];
  const starterSpecies = new Set((teamPlan?.starterFamily ?? []).map(Number));
  const strategicSpecies = new Set(
    (teamPlan?.acquisitions ?? []).flatMap(({ family }) => family).map(Number),
  );
  const utilitySpecies = new Set(
    (teamPlan?.utilityAcquisitions ?? []).flatMap(({ family }) => family).map(Number),
  );
  const excludedSpecies = new Set(
    (target?.excludedFamilies ?? []).flat().map(Number),
  );
  return party
    .filter(pokemon=>!target?.requiredFingerprints?.includes(encounterFingerprint(pokemon)))
    // FireRed refuses to store a Pokémon holding Mail (party_menu/storage checks).
    .filter((pokemon) => !(Number(pokemon.heldItem) >= 121 && Number(pokemon.heldItem) <= 132))
    .filter((pokemon) => !starterSpecies.has(Number(pokemon.species)))
    // Preserve coverage, not every possible representative of an OR group.
    // A missing group may be waiting in the box; do not prevent making space
    // for it, but never remove the last representative of a satisfied group.
    .filter((pokemon) => requiredFamilies.every((family) =>
      !family.some(species => Number(species) === Number(pokemon.species)) ||
      party.some(other => other !== pokemon && family.some(species => Number(species) === Number(other.species)))
    ))
    .filter((pokemon) => (target?.requiredMoveIds ?? []).every(moveId =>
      !(pokemon.moves ?? []).some(move => Number(move) === Number(moveId)) ||
      party.some(other => other !== pokemon && (other.moves ?? []).some(move => Number(move) === Number(moveId)))
    ))
    .map((pokemon) => {
      const species = Number(pokemon.species);
      const hasFieldMove = (pokemon.moves ?? []).some((moveId) =>
        PERMANENT_FIELD_MOVES.has(Number(moveId))
      );
      const excludedFromBattleRoster = excludedSpecies.has(species) ||
        (target?.excludeHmUtilityCarriers && isHmUtilityCarrier(pokemon, teamPlan));
      const roleRank = excludedFromBattleRoster
        ? -1
        : hasFieldMove
        ? 3
        : utilitySpecies.has(species)
          ? 2
          : strategicSpecies.has(species)
            ? 1
            : 0;
      return { pokemon, roleRank };
    })
    .sort((left, right) =>
      left.roleRank - right.roleRank ||
      Number(left.pokemon.level ?? 0) - Number(right.pokemon.level ?? 0) ||
      Number(left.pokemon.slot ?? 0) - Number(right.pokemon.slot ?? 0)
    )[0]?.pokemon ?? null;
}

// A planned PC release (suite/pc-release.js) names one boxed individual and the
// fields re-checked at the cursor. Anything else under the cursor, a shiny, an
// Egg, a held item or a changed record is never released.
function releaseTargetMatches(pokemon, release, party = []) {
  return Boolean(pokemon && release && pokemon.validity === "valid" &&
    encounterFingerprint(pokemon) === release.fingerprint &&
    !party.some((member) => encounterFingerprint(member) === release.fingerprint) &&
    Number(pokemon.box) === Number(release.box) && Number(pokemon.slot) === Number(release.slot) &&
    pokemon.species === release.species && pokemon.personality === release.personality &&
    pokemon.otId === release.otId && pokemon.experience === release.experience &&
    pokemon.friendship === release.friendship &&
    (release.metLevel == null || pokemon.metLevel === release.metLevel) &&
    pokemon.shiny === false && pokemon.isEgg === false && Number(pokemon.heldItem) === 0);
}

function planStorageOperation(memory, objective, teamPlan, mechanics) {
  const party = memory?.trainer?.party ?? [];
  const stored = memory?.trainer?.storage?.pokemon ?? [];
  const boxCounts = memory?.trainer?.storage?.boxCounts ?? [];
  const release = objective?.target?.kind === "party-roster"
    ? objective.target.release ?? null
    : null;
  if (release) {
    // FireRed refuses Withdraw with six party Pokémon (Task_PCMainMenu); Move
    // mode offers RELEASE for a boxed Pokémon without touching the party.
    const storedTarget = stored.find((pokemon) => encounterFingerprint(pokemon) === release.fingerprint) ?? null;
    return { party, stored, boxCounts, missingFingerprint: null, storedTarget, depositCandidate: null, release,
      releaseMode: party.length >= 6 ? "move-pokemon" : "withdraw",
      operation: releaseTargetMatches(storedTarget, release, party) ? "release" : "exit" };
  }
  const target = objective?.target?.kind === "party-roster"
    ? objective.target
    : null;
  const excludedSpecies = new Set(
    (target?.excludedFamilies ?? []).flat().map(Number),
  );
  const combatDeficit = Number.isSafeInteger(target?.minimumCombatPartySize) &&
    party.filter(pokemon => !isHmUtilityCarrier(pokemon, teamPlan)).length < target.minimumCombatPartySize;
  const isExcluded = (pokemon) => excludedSpecies.has(Number(pokemon?.species)) ||
    Boolean((target?.excludeHmUtilityCarriers || combatDeficit) && isHmUtilityCarrier(pokemon, teamPlan));
  const eligibleStored = stored.filter((pokemon) => !isExcluded(pokemon));
  const excludedPartyMember = party.find(isExcluded) ?? null;
  const missingFamily = target?.requiredFamilies?.find((family) =>
    !rosterFamilyPresent(party, family)
  ) ?? null;
  const missingFingerprint=target?.requiredFingerprints?.find(fp=>!party.some(p=>encounterFingerprint(p)===fp));
  const missingMoveId = target?.requiredMoveIds?.find(moveId =>
    !party.some(pokemon => (pokemon.moves ?? []).some(move => Number(move) === Number(moveId))));
  const rosterBelowMinimum = Number.isSafeInteger(target?.minimumPartySize) &&
    party.length < Number(target.minimumPartySize);
  const storedTarget = missingFingerprint?stored.find(p=>encounterFingerprint(p)===missingFingerprint):missingFamily
    ? selectStoredRosterCandidate(stored.filter(({ species }) =>
        missingFamily.some((candidate) => Number(candidate) === Number(species))
      ), party, mechanics)
    : missingMoveId !== undefined
      ? selectStoredRosterCandidate(stored.filter(pokemon =>
          (pokemon.moves ?? []).some(move => Number(move) === Number(missingMoveId))), party, mechanics)
    : rosterBelowMinimum || excludedPartyMember
      ? selectStoredRosterCandidate(eligibleStored, party, mechanics)
      : null;
  const aboveMaximum = Number.isSafeInteger(target?.maximumPartySize) &&
    party.length > Number(target.maximumPartySize);
  const needsExcludedReplacement = Boolean(excludedPartyMember && storedTarget);
  const needsDeposit = Boolean(
    target && (
      aboveMaximum ||
      (combatDeficit && needsExcludedReplacement && party.length >= Number(target.maximumPartySize ?? 6)) ||
      ((missingFamily || missingFingerprint || missingMoveId !== undefined) && party.length >= 6) ||
      (needsExcludedReplacement && party.length >= 6)
    ),
  );
  const depositCandidate = needsDeposit
    ? selectRosterDepositCandidate(party, combatDeficit ? { ...target, excludeHmUtilityCarriers: true } : target, teamPlan)
    : null;
  const operation = !target || (
    !missingFamily && !missingFingerprint && missingMoveId === undefined &&
    !aboveMaximum &&
    !rosterBelowMinimum &&
    !needsExcludedReplacement
  )
    ? "exit"
    : needsDeposit
      ? "deposit"
      : "withdraw";
  return { party, stored, boxCounts, missingFingerprint, storedTarget, depositCandidate, operation };
}

function releaseStorageRecommendation(ui, plan, objective) {
  const { stored, release, releaseMode, operation, party } = plan;
  const id = objective?.id ?? "close-storage";
  // The cartridge purges the Pokémon before these messages; they only drain.
  if (ui.stage === "release-message" || ui.stage === "release-refused") {
    return { kind: "acknowledge-storage-message", message: ui.message ?? null, objective: id };
  }
  const atCursor = ui.cursorArea === "box" && ui.movingPokemon === false
    ? stored.find(({ box, slot }) => Number(box) === Number(ui.currentBox) && Number(slot) === Number(ui.cursorPosition))
    : null;
  const verified = operation === "release" && ui.boxOption === releaseMode &&
    releaseTargetMatches(atCursor, release, party);
  if (ui.stage === "release-confirm") {
    return verified
      ? { kind: "confirm-storage-release", targetOption: "yes", targetIndex: 0, targetFingerprint: release.fingerprint, objective: id }
      : { kind: "confirm-storage-release", targetOption: "no", targetIndex: 1, objective: id };
  }
  if (!release) return null;
  if (ui.stage === "pc-menu") {
    return operation === "exit"
      ? { kind: "exit-storage", objective: id }
      : { kind: "choose-storage-option", targetOption: releaseMode, targetIndex: releaseMode === "withdraw" ? 0 : 2, objective: id };
  }
  if (ui.stage === "confirm-continue") return null;
  if (ui.stage === "pokemon-menu") {
    const index = ui.menu?.items?.indexOf("release") ?? -1;
    return verified && index >= 0
      ? { kind: "choose-storage-menu-action", targetAction: "release", targetIndex: index,
          targetFingerprint: release.fingerprint, targetSpecies: release.species, objective: id }
      : { kind: "cancel-storage-action", objective: id };
  }
  if (ui.stage !== "storage-main" || operation === "exit" || ui.boxOption !== releaseMode) {
    return { kind: "exit-storage-mode", objective: id };
  }
  if (ui.movingPokemon !== false) {
    return { kind: "withhold-unsafe-decision", reason: "pokemon-held-in-storage", objective: id };
  }
  return { kind: "choose-storage-box-member", targetBox: release.box, targetBoxSlot: release.slot,
    targetSpecies: release.species, objective: id };
}

function storageAdvice(observation, objective, teamPlan, mechanics) {
  const memory = observation.playerMemory;
  const ui = memory?.ui?.storage;
  if (!ui) return null;
  const plan = planStorageOperation(memory, objective, teamPlan, mechanics);
  const { party, stored, boxCounts, missingFingerprint, storedTarget, depositCandidate, operation } = plan;
  let recommendation = releaseStorageRecommendation(ui, plan, objective);

  if (recommendation) {
    // Planned PC release (or draining a release prompt).
  } else if (operation === "withdraw" && !storedTarget) {
    recommendation = {
      kind: "withhold-unsafe-decision",
      reason: "required-pokemon-not-in-observed-storage",
      objective: objective.id,
    };
  } else if (operation === "deposit" && !depositCandidate) {
    recommendation = {
      kind: "withhold-unsafe-decision",
      reason: "no-safe-party-member-to-deposit",
      objective: objective.id,
    };
  } else if (ui.stage === "confirm-continue") {
    recommendation = {
      kind: "choose-storage-continue",
      targetOption: "no",
      targetIndex: 1,
      objective: objective?.id ?? "close-storage",
    };
  } else if (ui.stage === "pc-menu") {
    if (operation === "exit") {
      recommendation = {
        kind: "exit-storage",
        objective: objective?.id ?? "close-storage",
      };
    } else {
      recommendation = {
        kind: "choose-storage-option",
        targetOption: operation,
        targetIndex: operation === "withdraw" ? 0 : 1,
        objective: objective.id,
      };
    }
  } else if (operation === "exit" || ui.boxOption !== operation) {
    recommendation = {
      kind: "exit-storage-mode",
      objective: objective?.id ?? "close-storage",
    };
  } else if (operation === "deposit") {
    if (ui.stage === "deposit-box") {
      // A task may reserve boxes (the QMM supply keeps Box 3 slot 1 empty).
      const avoided = new Set((objective?.target?.avoidDepositBoxes ?? []).map(Number));
      const targetBox = Array.from({ length: 14 }, (_, box) => box)
        .find((box) => !avoided.has(box) && Number(boxCounts[box] ?? 0) < 30);
      recommendation = Number.isSafeInteger(targetBox)
        ? { kind: "choose-storage-box", targetBox, objective: objective.id }
        : {
            kind: "withhold-unsafe-decision",
            reason: "pokemon-storage-full",
            objective: objective.id,
          };
    } else if (ui.stage === "pokemon-menu") {
      const selected = party.find(({ slot }) =>
        Number(slot) === Number(ui.cursorPosition)
      );
      recommendation = Number(selected?.slot) === Number(depositCandidate.slot) &&
        Number(selected?.species) === Number(depositCandidate.species)&&(!encounterFingerprint(depositCandidate)||encounterFingerprint(selected)===encounterFingerprint(depositCandidate))
        ? {
            kind: "confirm-storage-action",
            targetAction: "store",
            targetSpecies: depositCandidate.species,
            objective: objective.id,
          }
        : { kind: "cancel-storage-action", objective: objective.id };
    } else {
      recommendation = {
        kind: "choose-storage-party-member",
        targetPartySlot: depositCandidate.slot,
        targetSpecies: depositCandidate.species,
        objective: objective.id,
      };
    }
  } else if (ui.stage === "pokemon-menu") {
    const selected = stored.find(({ box, slot }) =>
      Number(box) === Number(ui.currentBox) &&
      Number(slot) === Number(ui.cursorPosition)
    );
    recommendation = Number(selected?.box) === Number(storedTarget.box) &&
      Number(selected?.slot) === Number(storedTarget.slot) &&
      Number(selected?.species) === Number(storedTarget.species)&&(!missingFingerprint||encounterFingerprint(selected)===missingFingerprint)
      ? {
          kind: "confirm-storage-action",
          targetAction: "withdraw",
          targetSpecies: storedTarget.species,
          objective: objective.id,
        }
      : { kind: "cancel-storage-action", objective: objective.id };
  } else {
    recommendation = {
      kind: "choose-storage-box-member",
      targetBox: storedTarget.box,
      targetBoxSlot: storedTarget.slot,
      targetSpecies: storedTarget.species,
      objective: objective.id,
    };
  }

  return proposal({
    advisor: "quest",
    observation,
    recommendation,
    confidence: 0.998,
    constraints: [
      "observed-pokemon-storage",
      "protect-starter",
      "one-bounded-edge-then-reobserve",
      ...(plan.release ? ["release-egg-sticker-hatchling"] : []),
    ],
    evidenceRefs: [
      `campaign:objective:${objective?.id ?? "close-storage"}`,
      `cartridge:storage-stage:${ui.stage}`,
      `cartridge:storage-operation:${operation}`,
      ...(plan.release ? [`pc-release:${plan.release.fingerprint}`] : []),
    ],
  });
}

function purchaseAdvice(observation, objective) {
  if (objective?.target?.kind !== "purchase-items") return null;
  const memory = observation.playerMemory;
  const mart = memory?.ui?.mart;
  if (!mart) return null;
  const wanted = objective.target.items ?? [];
  const missingItems = wanted.filter(({ itemId, quantity }) =>
    inventoryQuantity(memory, itemId) < Number(quantity)
  );
  const stockPrices = new Map((mart.stock ?? []).map(({ itemId, price }) => [
    Number(itemId),
    Number(price),
  ]));
  const money = Number(memory?.trainer?.money);
  const missing = missingItems.find(({ itemId, unitPrice }) => {
    const price = stockPrices.get(Number(itemId)) ?? Number(unitPrice);
    return !Number.isSafeInteger(money) || !Number.isSafeInteger(price) ||
      price <= 0 || money >= price;
  }) ?? null;
  let recommendation;
  const wrongStock = missing && Array.isArray(mart.stock) && !stockPrices.has(Number(missing.itemId));
  const wrongSelection = ['quantity','confirm-purchase'].includes(mart.stage) && Number.isSafeInteger(mart.itemId) && !wanted.some(item=>Number(item.itemId)===mart.itemId);
  if (missingItems.length === 0 || !missing || wrongStock || wrongSelection) {
    recommendation = { kind: "close-menu", objective: objective.id };
  } else if (mart.stage === "shop-menu") {
    recommendation = {
      kind: "choose-mart-menu-item",
      targetAction: "buy",
      targetIndex: 0,
      objective: objective.id,
    };
  } else if (mart.stage === "item-list") {
    recommendation = {
      kind: "choose-mart-item",
      targetItemId: missing.itemId,
      targetIndex: missing.stockIndex,
      objective: objective.id,
    };
  } else if (mart.stage === "quantity") {
    const selected = wanted.find(({ itemId }) =>
      Number(itemId) === Number(mart.itemId)
    ) ?? missing;
    const neededQuantity = Math.max(
      1,
      Number(selected.quantity) - inventoryQuantity(memory, selected.itemId),
    );
    const maximumQuantity = Number(mart.maximumQuantity);
    recommendation = {
      kind: "choose-mart-quantity",
      targetItemId: selected.itemId,
      targetQuantity: Number.isSafeInteger(maximumQuantity) && maximumQuantity > 0
        ? Math.min(neededQuantity, maximumQuantity)
        : neededQuantity,
      objective: objective.id,
    };
  } else if (mart.stage === "confirm-purchase") {
    recommendation = {
      kind: "choose-menu-option",
      targetOption: "yes",
      objective: objective.id,
    };
  } else if (mart.stage === "purchase-result") {
    recommendation = {
      kind: "acknowledge-cartridge-prompt",
      objective: objective.id,
    };
  } else {
    return null;
  }
  return proposal({
    advisor: "quest",
    observation,
    recommendation,
    confidence: 0.995,
    constraints: ["cartridge-mart-state", "campaign-inventory-target"],
    evidenceRefs: [
      `campaign:objective:${objective.id}`,
      `cartridge:mart:${mart.stage}`,
    ],
  });
}

function healWithItemsAdvice(
  observation,
  objective,
  mechanics = null,
  {
    advisor = "quest",
    confidence = 0.995,
    constraints = ["between-league-battles", "fully-restore-party"],
  } = {},
) {
  if (objective?.target?.kind !== "heal-with-items") return null;
  const memory = observation.playerMemory;
  const ui = memory?.ui ?? {};
  const nextTreatment = nextRecoveryTreatment(memory, mechanics, {travel:objective.target.travel===true});
  const treatment = objective.target.statusOnly &&
      !["status", "full-restore"].includes(nextTreatment?.kind)
    ? null
    : nextTreatment;
  const wantedItemId = treatment?.itemId ?? null;
  let recommendation = null;
  if (ui.party?.stage === "message") {
    recommendation = {
      kind: "acknowledge-cartridge-prompt",
      objective: objective.id,
    };
  } else if (ui.party?.stage === 'restore-pp-move') {
    const member=memory.trainer?.party?.find(p=>Number(p.slot)===Number(ui.party.selectedPartySlot));
    const move=recoveryPpMove(member,mechanics);
    recommendation=move ? {kind:'choose-pp-move',targetMoveSlot:move.slot,objective:objective.id}
      : {kind:'close-menu',objective:objective.id};
  } else if (!wantedItemId) {
    recommendation = { kind: "close-menu", objective: objective.id };
  } else if (ui.party) {
    const selectedItemId = Number(ui.party.itemId);
    const target = objective.target.travel === true
      ? selectedItemId === wantedItemId ? treatment.target : null
      : Number.isSafeInteger(selectedItemId) && selectedItemId > 0
      ? recoveryTargetForItem(memory, selectedItemId, mechanics)
      : null;
    recommendation = target
      ? {
          kind: "choose-party-member",
          targetPartySlot: target.slot,
          targetSpecies: target.species,
          objective: objective.id,
        }
      : { kind: "close-menu", objective: objective.id };
  } else if (ui.bag?.stage === "context") {
    recommendation = Number(ui.bag.selectedItemId) === wantedItemId
      ? {
          kind: "choose-bag-context-action",
          targetAction: "use",
          targetIndex: 0,
          objective: objective.id,
        }
      : { kind: "close-menu", objective: objective.id };
  } else if (ui.bag?.stage === "list") {
    if (Number(ui.bag.pocket) !== 0) {
      recommendation = {
        kind: "choose-bag-pocket",
        targetPocket: 0,
        objective: objective.id,
      };
    } else {
      const targetIndex = (memory?.trainer?.bag?.items ?? []).findIndex(
        ({ itemId }) => Number(itemId) === wantedItemId,
      );
      recommendation = targetIndex < 0
        ? { kind: "close-menu", objective: objective.id }
        : {
            kind: "choose-bag-item",
            targetItemId: wantedItemId,
            targetIndex,
            objective: objective.id,
          };
    }
  } else if (ui.startMenu) {
    const targetIndex = ui.startMenu.order?.indexOf("bag") ?? -1;
    if (targetIndex < 0) return null;
    recommendation = {
      kind: "choose-start-menu-item",
      targetItem: "bag",
      targetIndex,
      objective: objective.id,
    };
  } else if (observation.emulator?.mode === "overworld") {
    recommendation = { kind: "open-start-menu", objective: objective.id };
  }
  return recommendation
    ? proposal({
        advisor,
        observation,
        recommendation,
        confidence,
        constraints,
        evidenceRefs: [
          `campaign:objective:${objective.id}`,
          `cartridge:recovery-item:${wantedItemId ?? "complete"}`,
        ],
      })
    : null;
}

function saveMemoryRecovery(observation, world) {
  const m = observation.playerMemory, ui = m.ui ?? {};
  if (m.fieldHeap?.validity !== 'valid' || m.fieldHeap.largestFreeBlock >= 16384) return null;
  if (ui.saveDialog) {
    return ['confirm-save', 'confirm-overwrite'].includes(ui.saveDialog.stage)
      ? {kind: 'choose-menu-option', targetOption: 'no'}
      : null; // Never interrupt a native write already in progress.
  }
  if (Object.values(ui).some(Boolean)) return {kind: 'close-menu'};
  const maps = (world?.data ?? world)?.maps ?? [], map = maps.find(map => map.id === m.map?.id);
  // Use a normal, reversible doorway. Map loading resets the cartridge heap;
  // it preserves the party, storage and story and requires no save rollback.
  const exits = (map?.warpEvents ?? []).map((warp, index) => ({warp, index}))
    .filter(({warp}) => maps.find(other => other.id === warp.dest_map)?.warpEvents?.[Number(warp.dest_warp_id)]?.dest_map === map.id)
    .sort((a, b) => Math.abs(a.warp.x-m.position.x)+Math.abs(a.warp.y-m.position.y) -
      Math.abs(b.warp.x-m.position.x)-Math.abs(b.warp.y-m.position.y));
  for (const {index} of exits) {
    const next = campaignNavigationRecommendation({world, observation, objective: {
      id: 'refresh-field-memory-before-save', target: {kind: 'warp', map: map.id, index},
      deferOptionalDetours: true,
    }});
    if (next && next.kind !== 'stop-for-review') return next;
  }
  return {kind: 'stop-for-review', reason: 'The cartridge needs a reachable map exit to refresh field memory before saving.'};
}

function saveAreaExitRecommendation(observation) {
  const memory=observation.playerMemory,ui=memory?.ui??{};
  // Safari replaces Save with Retire, including after an item evolution.
  // Leave through the cartridge script while the original save owner retains
  // its baseline and identity. Never interrupt a native write already started.
  if(!/^MAP_SAFARI_ZONE_/.test(memory?.map?.id??'')||ui.saveDialog||observation.emulator?.inBattle)return null;
  if(ui.choiceMenu)return {kind:'choose-menu-option',targetOption:'yes'};
  if(['awaiting-page','awaiting-close'].includes(ui.fieldDialog?.stage))return {kind:'acknowledge-cartridge-prompt'};
  if(ui.startMenu){
    if(ui.startMenu.order?.includes('save'))return null;
    const targetIndex=ui.startMenu.order?.indexOf('retire')??-1;
    return targetIndex>=0?{kind:'choose-start-menu-item',targetItem:'retire',targetIndex}:{kind:'stop-for-review',reason:'safari-retire-menu-unavailable'};
  }
  if(ui.bag||ui.party||ui.pokemonSummary)return {kind:'close-menu'};
  return {kind:'open-start-menu'};
}

function leaguePreparationAdvice(observation, objective, world) {
  if (!['save-game','stop-for-review'].includes(objective?.target?.kind)) return null;
  const ui=observation.playerMemory?.ui ?? {};
  const areaExit = objective.target.kind === 'save-game' ? saveAreaExitRecommendation(observation) : null;
  const memoryRecovery = !areaExit && objective.target.kind === 'save-game' ? saveMemoryRecovery(observation, world) : null;
  let recommendation;
  if(objective.target.kind==='stop-for-review') recommendation={kind:'stop-for-review',reason:objective.target.reason};
  else if(areaExit) recommendation=areaExit;
  else if(memoryRecovery) recommendation=memoryRecovery;
  else if(ui.saveDialog) {
    if(['confirm-save','confirm-overwrite'].includes(ui.saveDialog.stage)) recommendation={kind:'choose-menu-option',targetOption:'yes'};
    else if(ui.saveDialog.stage==='success' && objective.target.saveVerified) recommendation={kind:'acknowledge-cartridge-prompt'};
    else recommendation={kind:'wait-for-supported-objective'};
  } else if(['awaiting-page','awaiting-close'].includes(ui.fieldDialog?.stage)) recommendation={kind:'acknowledge-cartridge-prompt'};
  else if(ui.startMenu) {
    const targetIndex=ui.startMenu.order?.indexOf('save') ?? -1;
    recommendation=targetIndex>=0 ? {kind:'choose-start-menu-item',targetItem:'save',targetIndex}
      : {kind:'stop-for-review',reason:'league-save-menu-unavailable'};
  } else if(ui.bag || ui.party || ui.mart || ui.choiceMenu) recommendation={kind:'close-menu'};
  else recommendation={kind:'open-start-menu'};
  return proposal({advisor:'quest',observation,recommendation:{...recommendation,objective:objective.id},confidence:1,
    constraints:['league-team-preparation','verify-native-save'],evidenceRefs:[`campaign:objective:${objective.id}`]});
}

function evolveWithItemAdvice(observation, objective) {
  if (objective?.target?.kind !== "evolve-with-item") return null;
  const memory = observation.playerMemory;
  const ui = memory?.ui ?? {};
  const target = objective.target;
  const wantedSpecies = new Set((target.partySpecies ?? []).map(Number));
  const partyMember = (memory?.trainer?.party ?? []).find(({ species }) =>
    wantedSpecies.has(Number(species))
  );
  if (!partyMember) return null;
  let recommendation = null;
  if (ui.party) {
    recommendation = {
      kind: "choose-party-member",
      targetPartySlot: partyMember.slot,
      targetSpecies: partyMember.species,
      objective: objective.id,
    };
  } else if (ui.bag?.stage === "context") {
    recommendation = Number(ui.bag.selectedItemId) === Number(target.itemId)
      ? {
          kind: "choose-bag-context-action",
          targetAction: "use",
          targetIndex: 0,
          objective: objective.id,
        }
      : { kind: "close-menu", objective: objective.id };
  } else if (ui.bag?.stage === "list") {
    if (Number(ui.bag.pocket) !== 0) {
      recommendation = {
        kind: "choose-bag-pocket",
        targetPocket: 0,
        objective: objective.id,
      };
    } else {
      const targetIndex = (memory?.trainer?.bag?.items ?? []).findIndex(
        ({ itemId }) => Number(itemId) === Number(target.itemId),
      );
      if (targetIndex < 0) return null;
      recommendation = {
        kind: "choose-bag-item",
        targetItemId: target.itemId,
        targetIndex,
        objective: objective.id,
      };
    }
  } else if (ui.startMenu) {
    const targetIndex = ui.startMenu.order?.indexOf("bag") ?? -1;
    if (targetIndex < 0) return null;
    recommendation = {
      kind: "choose-start-menu-item",
      targetItem: "bag",
      targetIndex,
      objective: objective.id,
    };
  } else if (observation.emulator?.mode === "overworld") {
    recommendation = { kind: "open-start-menu", objective: objective.id };
  }
  return recommendation
    ? proposal({
        advisor: "quest",
        observation,
        recommendation,
        confidence: 0.998,
        constraints: ["owned-evolution-item", "origins-roster-acquisition"],
        evidenceRefs: [
          `campaign:objective:${objective.id}`,
          `cartridge:item:${target.itemId}`,
          `cartridge:party-slot:${partyMember.slot}:species:${partyMember.species}`,
        ],
      })
    : null;
}

function isGiftNicknamePrompt(observation, teamPlan) {
  if (!['yes', 'no'].includes(observation.playerMemory?.ui?.choiceMenu?.selected) ||
      !teamPlan?.acquisitions) {
    return false;
  }
  const map = observation.playerMemory?.map?.id;
  const owned = new Set(
    (observation.playerMemory?.trainer?.party ?? []).map(({ species }) =>
      Number(species)
    ),
  );
  return teamPlan.acquisitions.some(({ steps }) =>
    (steps ?? []).some((step) =>
      step.kind === "gift" &&
      (step.map === map || step.maps?.includes(map)) &&
      owned.has(Number(step.species))
    )
  );
}

function silphCoElevatorChoiceIndex(map, targetMap) {
  if (map !== "MAP_SILPH_CO_ELEVATOR") return null;
  const match = /^MAP_SILPH_CO_(\d+)F$/.exec(String(targetMap ?? ""));
  const targetFloor = match ? Number(match[1]) : 1;
  if (!Number.isSafeInteger(targetFloor) || targetFloor < 1 || targetFloor > 11) {
    return 10;
  }
  return 11 - targetFloor;
}

const TRI_PASS_DESTINATIONS_BY_HARBOR = Object.freeze({
  MAP_ONE_ISLAND_HARBOR: Object.freeze([
    "MAP_TWO_ISLAND",
    "MAP_THREE_ISLAND",
  ]),
  MAP_TWO_ISLAND_HARBOR: Object.freeze([
    "MAP_ONE_ISLAND",
    "MAP_THREE_ISLAND",
  ]),
  MAP_THREE_ISLAND_HARBOR: Object.freeze([
    "MAP_ONE_ISLAND",
    "MAP_TWO_ISLAND",
  ]),
});

function triPassSeagallopChoiceIndex(map, target,observation) {
  if (target?.kind !== "seagallop-destination") return null;
  const m=observation?.playerMemory;
  if(m){
    const variables=m.storyState?.variableIds??{};
    const centerScene=variables[0x4076],cinnabarScene=variables[0x4071];
    const origin=fireRedIsland(map),destination=fireRedIsland(target.map),page=variables[0x8005]??0;
    // data/scripts/seagallop.inc gates the actual menu on these scenes.
    // Lostelle's completed-detour flag is set BEFORE Bill returns to Kanto;
    // using it inserts a nonexistent Vermilion row and selects the wrong island.
    const rainbow=Number.isInteger(centerScene)?centerScene>=5:
      m.storyState?.flagIds?.[2118]===true||Object.values(m.trainer?.bag??{}).flat().some(i=>i.itemId===368&&i.quantity>0);
    const kantoUnlocked=Number.isInteger(cinnabarScene)?cinnabarScene>=4:
      origin===0||m.ui?.choiceMenu?.maxCursor===3;
    // Special-ticket prompts in Vermilion first ask for the Sevii service.
    if(origin===0&&rainbow&&m.ui?.choiceMenu?.maxCursor<4)return 0;
    return seagallopChoiceIndex({origin,destination,page,rainbow,kantoUnlocked});
  }
  const index = TRI_PASS_DESTINATIONS_BY_HARBOR[map]?.indexOf(target.map) ?? -1;
  return index >= 0 ? index : null;
}

function inGameTradeAdvice(observation, objective) {
  if (objective?.target?.kind !== "in-game-trade") return null;
  const requestedSpecies = Number(objective.target.requestedSpecies);
  const receivedSpecies = Number(objective.target.receivedSpecies);
  const workflow = {
    workflowKind: "in-game-trade",
    requestedSpecies,
    receivedSpecies,
  };
  const tradeUi = observation?.playerMemory?.ui?.inGameTrade;
  if (tradeUi?.stage === "completion") {
    return {
      kind: "acknowledge-cartridge-prompt",
      objective: objective.id,
      ...workflow,
    };
  }
  if (tradeUi) return null;
  if (!isInGameTradePartyMenu(observation, objective.target.map)) return null;
  const partyUi = observation?.playerMemory?.ui?.party;
  if (!partyUi) return null;
  if (partyUi.stage === "message") {
    return {
      kind: "acknowledge-cartridge-prompt",
      objective: objective.id,
      ...workflow,
    };
  }
  if (partyUi.stage !== "choose-pokemon") return null;
  const member = (observation?.playerMemory?.trainer?.party ?? []).find(
    ({ species }) => Number(species) === requestedSpecies,
  );
  return member
    ? {
        kind: "choose-party-member",
        targetPartySlot: member.slot,
        targetSpecies: member.species,
        objective: objective.id,
        ...workflow,
      }
    : { kind: "close-menu", objective: objective.id };
}

function questAdvice(
  observation,
  mechanics,
  world,
  campaignPlanner,
  runProfile = DEFAULT_RUN_PROFILE,
  teamPlan = null,
) {
  const memory = observation.playerMemory;
  const ui = memory?.ui ?? {};
  const map = memory?.map?.id;
  const labScene = memory?.storyState?.variables?.[OAKS_LAB_SCENE];
  const labStarter = labStarterObjective(runProfile);
  const plannedObjective = campaignPlanner?.select?.(observation);
  const collectionObjective = campaignPlanner?.selectCollection?.(
    observation,
    plannedObjective,
  ) ?? null;
  const campaignObjective = plannedObjective
    ? selectBattleRosterObjective({
        world,
        observation,
        objective: plannedObjective,
        teamPlan,
      }) ?? plannedObjective
    : null;
  const questTrainingObjective =
    campaignObjective === plannedObjective && plannedObjective
      ? campaignTrainingObjective({
          campaignPlanner,
          world,
          observation,
          objective: plannedObjective,
          teamPlan,
        })
      : null;
  const blockingQuestTrainingObjective = [
    "passive",
    "experience-share-only",
  ].includes(questTrainingObjective?.trainingMode)
    ? null
    : questTrainingObjective;
  const travelObjective = collectionObjective ??
    blockingQuestTrainingObjective ??
    campaignObjective;
  const cartridgeNicknamePrompt = ui.choiceMenu?.purpose === "pokemon-nickname";
  if (cartridgeNicknamePrompt || isGiftNicknamePrompt(observation, teamPlan)) {
    return proposal({
      advisor: "quest",
      observation,
      recommendation: {
        kind: "choose-menu-option",
        targetOption: "no",
        objective: cartridgeNicknamePrompt
          ? "keep-pokemon-species-name" : "keep-gift-species-name",
      },
      confidence: 1,
      constraints: ["never-nickname-pokemon", cartridgeNicknamePrompt
        ? "cartridge-nickname-question" : "planned-gift-map"],
      evidenceRefs: [
        `cartridge:map:${map}`,
        `strategy:nickname-policy:${runProfile.nicknamePolicy}`,
      ],
    });
  }
  if (ui.moveLearning) {
    const learning = ui.moveLearning;
    // A roster detour may replace the planned objective; its required moves still apply.
    const learningObjective = !campaignObjective?.learnMoveIds && plannedObjective?.learnMoveIds
      ? { ...campaignObjective, learnMoveIds: plannedObjective.learnMoveIds, keepMoveIds: plannedObjective.keepMoveIds }
      : campaignObjective;
    const plan = moveLearningPlan(observation, mechanics, learningObjective, teamPlan);
    let recommendation;
    if (learning.stage === "confirm-replace") {
      recommendation = {
        kind: "choose-menu-option",
        targetOption: plan.shouldLearn ? "yes" : "no",
        objective: plan.shouldLearn
          ? `learn-move-${learning.moveId}`
          : `decline-move-${learning.moveId}`,
      };
    } else if (learning.stage === "confirm-stop-learning") {
      recommendation = {
        kind: "choose-menu-option",
        targetOption: "yes",
        objective: `stop-learning-move-${learning.moveId}`,
      };
    } else if (learning.stage === "forget-move" && plan.forbiddenHm) {
      recommendation = { kind: 'cancel-conflicting-menu', objective: `decline-move-${learning.moveId}` };
    } else if (learning.stage === "forget-move" && plan.targetMoveSlot !== null) {
      recommendation = {
        kind: "choose-move-to-forget",
        targetMoveSlot: plan.targetMoveSlot,
        learnedMoveId: learning.moveId,
      };
    } else {
      recommendation = { kind: "acknowledge-cartridge-prompt" };
    }
    return proposal({
      advisor: "quest",
      observation,
      recommendation,
      confidence: 0.995,
      constraints: ["source-backed-move-learning-state", "preserve-field-moves"],
      evidenceRefs: [
        `cartridge:move-learning:${learning.stage}`,
        `cartridge:move:${learning.moveId ?? "unknown"}`,
      ],
    });
  }
  if (ui.pokemonSummary) {
    return proposal({
      advisor: "quest",
      observation,
      recommendation: {
        kind: "close-menu",
        objective: "leave-pokemon-summary",
      },
      confidence: 0.999,
      constraints: ["source-backed-summary-input-state"],
      evidenceRefs: [
        `cartridge:summary:${ui.pokemonSummary.stage}`,
        `cartridge:party-slot:${ui.pokemonSummary.partySlot}`,
      ],
    });
  }
  // Cartridge-owned modals must release field controls before any campaign
  // workflow can open or operate another menu.
  if(ui.evolution&&campaignObjective?.evTraining)return proposal({advisor:'quest',observation,
    recommendation:{kind:'cancel-conflicting-menu',objective:'preserve-ev-training-species'},confidence:1,
    constraints:['retain-requested-evolution-stage'],evidenceRefs:['cartridge:evolution-cancel']});
  if (
    !ui.choiceMenu &&
    (ui.fieldDialog || ui.blackout || ui.levelUp || ui.evolution || ui.specialAnimation)
  ) {
    return proposal({
      advisor: "quest",
      observation,
      recommendation: { kind: "acknowledge-cartridge-prompt" },
      confidence: 0.98,
      constraints: ["one-edge-then-reobserve"],
      evidenceRefs: [
        `cartridge:callback:${observation.emulator?.callback2 ?? "unknown"}`,
      ],
    });
  }
  const flight = useFlyAdvice(observation, travelObjective, world);
  if (flight) return flight;
  const fieldMove=fieldMoveAtRecommendation(observation,campaignObjective);
  if(fieldMove)return proposal({advisor:'quest',observation,recommendation:{...fieldMove,objective:campaignObjective.id},confidence:1,constraints:['native-field-move','observed-position'],evidenceRefs:[`campaign:objective:${campaignObjective.id}`]});
  // The terminal root is a cartridge-owned menu, not a campaign prompt. It
  // must either enter an unfinished roster transaction or log off before a
  // subsequent item, healing, or story workflow interprets menu input.
  if (
    observation.emulator?.mode === "overworld" && ui.choiceMenu &&
    !(map === OAKS_LAB && labScene === 2) &&
    isPcAccessMenu(memory, world)
  ) {
    // The planner retains the transaction until field control returns. Use
    // the same observed roster check here and inside Bill's PC, including
    // identities, moves and party limits, so completion cannot reopen it.
    const needsPokemonStorage =
      planStorageOperation(memory, campaignObjective, teamPlan, mechanics).operation !== "exit";
    return proposal({
      advisor: "quest",
      observation,
      recommendation: needsPokemonStorage
        ? {
            kind: "choose-menu-option",
            targetIndex: 0,
            objective: campaignObjective.id,
          }
        : {
            kind: "close-menu",
            objective: "turn-off-pc",
          },
      confidence: 0.999,
      constraints: [
        "source-backed-pc-terminal",
        needsPokemonStorage ? "enter-storage-workflow" : "finish-storage-workflow",
      ],
      evidenceRefs: [
        `cartridge:map:${map}`,
        "cartridge:metatile-behavior:MB_PC",
        `cartridge:pc-menu-options:${Number(ui.choiceMenu.maxCursor) + 1}`,
      ],
    });
  }
  const vsSeeker = useVsSeekerAdvice(
    observation,
    questTrainingObjective?.trainingSource === "vs-seeker"
      ? questTrainingObjective
      : campaignObjective,
    world,
  );
  if (vsSeeker) return vsSeeker;
  const itemfinding = useItemfinderAdvice(observation, collectionObjective);
  if (itemfinding) return itemfinding;
  const fishing = useFishingRodAdvice(observation, campaignObjective, world);
  if (fishing) return fishing;
  const storage = storageAdvice(observation, campaignObjective, teamPlan, mechanics);
  if (storage) return storage;
  const teaching = teachMoveAdvice(observation, campaignObjective, teamPlan);
  if (teaching) return teaching;
  const purchasing = purchaseAdvice(observation, campaignObjective);
  if (purchasing) return purchasing;
  if (ui.mart) {
    return proposal({
      advisor: "quest",
      observation,
      recommendation: ui.mart.stage === "purchase-result"
        ? { kind: "acknowledge-cartridge-prompt" }
        : {
            kind: "close-menu",
            objective: campaignObjective?.id ?? "return-to-overworld",
          },
      confidence: 0.995,
      constraints: ["drain-completed-mart-workflow"],
      evidenceRefs: [`cartridge:mart:${ui.mart.stage}`],
    });
  }
  const preparation=leaguePreparationAdvice(observation,campaignObjective,world);
  if(preparation) return preparation;
  const healing = healWithItemsAdvice(observation, campaignObjective, mechanics);
  if (healing) return healing;
  const identityItem=evolutionItemRecommendation(observation,campaignObjective);
  if(identityItem)return proposal({advisor:'quest',observation,recommendation:{...identityItem,objective:campaignObjective.id},confidence:1,constraints:['verified-individual','observed-item-menu'],evidenceRefs:[`campaign:objective:${campaignObjective.id}`]});
  const evolution = evolveWithItemAdvice(observation, campaignObjective);
  if (evolution) return evolution;
  const inGameTrade = inGameTradeAdvice(observation, campaignObjective);
  if (inGameTrade) {
    return proposal({
      advisor: "quest",
      observation,
      recommendation: inGameTrade,
      confidence: 0.999,
      constraints: ["cartridge-in-game-trade", "requested-species-only"],
      evidenceRefs: [
        `campaign:objective:${campaignObjective.id}`,
        `cartridge:trade-requested-species:${campaignObjective.target.requestedSpecies}`,
      ],
    });
  }
  // Evolution tasks own their items, so the general equipment policy stays
  // off (it could equip an Everstone). Only the Exp. Share that an evolution
  // training objective assigns to its trainee may move.
  const evolutionTraining = Boolean(campaignObjective?.identityEvolution);
  const evolutionShare = evolutionTraining && questTrainingObjective?.expSharePartySlot != null &&
    Number.isSafeInteger(Number(questTrainingObjective.expSharePartySlot));
  const relocatedExpShare = (!evolutionTraining || evolutionShare) && relocateExpShareAdvice(
    observation,
    questTrainingObjective,
  );
  if (relocatedExpShare) return relocatedExpShare;
  const heldItem = (!evolutionTraining || evolutionShare) && equipHeldItemAdvice(
    observation,
    mechanics,
    teamPlan,
    questTrainingObjective,
    !campaignObjective || Boolean(questTrainingObjective || campaignObjective.importantBattle),
    evolutionShare,
    passiveTraineeIdentity(campaignObjective),
  );
  if (heldItem) return heldItem;
  if (
    ![
      "teach-move",
      "heal-with-items",
      "evolve-with-item",
    ].includes(
      campaignObjective?.target?.kind,
    ) &&
    ["start-menu", "bag", "party", "mart"].includes(observation.emulator?.mode)
  ) {
    return proposal({
      advisor: "quest",
      observation,
      recommendation: {
        kind: "close-menu",
        objective: campaignObjective?.id ?? "return-to-overworld",
      },
      confidence: 0.99,
      constraints: ["completed-menu-workflow"],
      evidenceRefs: [`cartridge:mode:${observation.emulator.mode}`],
    });
  }
  if (
    observation.emulator?.mode === "overworld" && ui.choiceMenu &&
    !(map === OAKS_LAB && labScene === 2)
  ) {
    const elevatorChoiceIndex = silphCoElevatorChoiceIndex(
      map,
      campaignObjective?.target?.map,
    );
    const seagallopChoiceIndex = triPassSeagallopChoiceIndex(
      map,
      campaignObjective?.target,
      observation,
    );
    if (campaignObjective?.target?.kind === "seagallop-destination" &&
        !Number.isSafeInteger(seagallopChoiceIndex)) {
      return proposal({
        advisor: "quest",
        observation,
        recommendation: {
          kind: "stop-for-review",
          reason: "The requested island is unavailable in the current ferry menu.",
          objective: campaignObjective.id,
        },
        confidence: 0.995,
        constraints: ["unavailable-ferry-destination"],
        evidenceRefs: [`campaign:objective:${campaignObjective.id}`],
      });
    }
    const choiceMaps = campaignObjective?.choiceMaps ?? [
      campaignObjective?.target?.map,
    ];
    const rowChoice=choiceMaps.includes(map)&&campaignObjective?.choiceByRows;
    const nativeRowCount=ui.choiceMenu.maxCursor-ui.choiceMenu.minCursor+1;
    if(rowChoice){
      const targetIndex=rowChoice[nativeRowCount];
      return proposal({advisor:'quest',observation,
        recommendation:Number.isInteger(targetIndex)&&ui.choiceMenu.minCursor===0&&targetIndex>=0&&targetIndex<nativeRowCount?
          {kind:'choose-menu-option',targetIndex,objective:campaignObjective.id}:
          {kind:'withhold-unsafe-decision',reason:'Unexpected native choice menu for the current postgame transaction.'},
        confidence:1,constraints:['verified-postgame-menu-shape'],evidenceRefs:[`campaign:objective:${campaignObjective.id}`]});
    }
    const explicitChoiceApplies = Number.isSafeInteger(elevatorChoiceIndex) ||
      Number.isSafeInteger(seagallopChoiceIndex) ||
      choiceMaps.includes(map) &&
        (
          campaignObjective?.choice === "yes" ||
          campaignObjective?.choice === "no" ||
          Number.isSafeInteger(campaignObjective?.choiceIndex)
        );
    if (explicitChoiceApplies) {
      return proposal({
        advisor: "quest",
        observation,
        recommendation: {
          kind: "choose-menu-option",
          ...(Number.isSafeInteger(elevatorChoiceIndex)
            ? { targetIndex: elevatorChoiceIndex }
            : Number.isSafeInteger(seagallopChoiceIndex)
            ? { targetIndex: seagallopChoiceIndex }
            : Number.isSafeInteger(campaignObjective.choiceIndex)
            ? { targetIndex: campaignObjective.choiceIndex }
            : { targetOption: campaignObjective.choice }),
          objective: campaignObjective.id,
        },
        confidence: 0.995,
        constraints: ["explicit-campaign-choice"],
        evidenceRefs: [`campaign:objective:${campaignObjective.id}`],
      });
    }
    return proposal({
      advisor: "quest",
      observation,
      recommendation: {
        kind: "choose-menu-option",
        targetOption: "yes",
        objective: campaignObjective?.id ?? "accept-cartridge-prompt",
      },
      confidence: 0.9,
      constraints: ["default-progressive-cartridge-choice"],
      evidenceRefs: [
        `cartridge:map:${map ?? "unknown"}`,
        `campaign:objective:${campaignObjective?.id ?? "none"}`,
      ],
    });
  }
  if (map === OAKS_LAB && labScene === 2 && ui.choiceMenu) {
    const hasStarter = Number(memory?.trainer?.partyCount ?? 0) > 0;
    return proposal({
      advisor: "quest",
      observation,
      recommendation: {
        kind: "choose-menu-option",
        targetOption: hasStarter ? "no" : "yes",
        objective: hasStarter
          ? "keep-starter-species-name"
          : `confirm-${runProfile.starter.id}`,
      },
      confidence: 0.99,
      constraints: [
        hasStarter ? "decline-nickname-screen" : "confirm-configured-starter",
      ],
      evidenceRefs: [
        `cartridge:map:${OAKS_LAB}`,
        `cartridge:event-condition:${OAKS_LAB_SCENE}=2`,
        hasStarter
          ? "cartridge:party-count:1"
          : `cartridge:object-script:${labStarter.objectScript}`,
      ],
    });
  }
  if (
    observation.emulator?.mode === "hall-of-fame" &&
    observation.emulator?.callback2 === "CB2_HofIdle"
  ) {
    return proposal({
      advisor: "quest",
      observation,
      recommendation: {
        kind: "mission-complete",
        milestone: "native-hall-of-fame",
      },
      confidence: 1,
      constraints: ["stop-all-further-gameplay"],
      evidenceRefs: [
        "cartridge:CB2_HofIdle",
        `cartridge:map:${memory?.map?.id ?? "unknown"}`,
      ],
    });
  }
  if (ui.naming?.template === 0 && ui.naming?.subject === "player") {
    // A goal can commit the owner's chosen name; otherwise a seeded preset.
    const ownerName = runProfile.playerNameSource === "owner";
    return proposal({
      advisor: "quest",
      observation,
      recommendation: {
        kind: "enter-naming-screen-text",
        subject: "player",
        targetText: runProfile.playerName,
        objective: ownerName ? "enter-owner-player-name" : "enter-official-player-preset",
      },
      confidence: 1,
      constraints: ownerName
        ? ["committed-owner-player-name-only", "never-enter-freeform-name"]
        : ["official-first-three-player-names-only", "never-enter-freeform-name"],
      evidenceRefs: [
        "cartridge:naming-template:player",
        `strategy:${ownerName ? "player-owner-name" : "player-preset"}:${runProfile.playerName}`,
      ],
    });
  }
  if (ui.newGame) {
    const openingTarget = {
      "choose-gender": {
        targetIndex: runProfile.genderMenuRow,
        targetValue: runProfile.gender,
        objective: "choose-player-gender",
      },
      "choose-rival-name": {
        targetIndex: runProfile.rivalMenuRow,
        targetValue: runProfile.rivalName,
        objective: "choose-rival-preset-name",
      },
    }[ui.newGame.stage];
    return proposal({
      advisor: "quest",
      observation,
      recommendation: openingTarget
        ? { kind: "choose-new-game-option", ...openingTarget }
        : {
            kind: "choose-default-cartridge-option",
            stage: ui.newGame.stage,
          },
      confidence: openingTarget ? 0.999 : 0.9,
      constraints: openingTarget
        ? ["seeded-cartridge-option", "preset-names-only"]
        : ["one-edge-then-reobserve"],
      evidenceRefs: [`cartridge:new-game:${ui.newGame.stage}`],
    });
  }
  if (/NamingScreen/i.test(observation.emulator?.callback2 ?? "")) {
    if (ui.naming?.subject === "pokemon" && [2, 3].includes(ui.naming.template) &&
        ui.naming.textIsBlank === true) {
      return proposal({
        advisor: "quest",
        observation,
        recommendation: {
          kind: "keep-pokemon-species-name",
          objective: "recover-empty-pokemon-nickname",
        },
        confidence: 1,
        constraints: ["never-nickname-pokemon", "blank-input-preserves-existing-name"],
        evidenceRefs: [`cartridge:naming:template:${ui.naming.template}:blank`],
      });
    }
    return proposal({
      advisor: "quest",
      observation,
      recommendation: {
        kind: "withhold-unsafe-decision",
        reason: "unexpected-custom-naming-screen",
      },
      confidence: 1,
      constraints: ["never-type-custom-name"],
      vetoes: ["acknowledge-cartridge-prompt"],
      evidenceRefs: [
        `cartridge:callback:${observation.emulator?.callback2 ?? "unknown"}`,
      ],
    });
  }
  if (observation.emulator?.mode === "boot") {
    return proposal({
      advisor: "quest",
      observation,
      recommendation: { kind: "acknowledge-cartridge-prompt" },
      confidence: 0.7,
      constraints: ["one-edge-then-reobserve"],
      evidenceRefs: [
        `cartridge:callback:${observation.emulator?.callback2 ?? "unknown"}`,
      ],
    });
  }
  return null;
}

// EV training and funding battles use a named battler for another purpose;
// every other training objective exists to earn experience.
function trainingSeeksExperience(trainingObjective) {
  return Boolean(trainingObjective) && !trainingObjective.evTraining && !trainingObjective.incomePreparation;
}

function battleAdvice(observation, mechanics, world, campaignPlanner, teamPlan) {
  if (observation.emulator?.mode !== "battle") return null;
  const majorBattle = isMajorBattle(observation, mechanics);
  const memory = observation.playerMemory;
  const ui = memory?.ui ?? {};
  const battle = battleDecisionState(memory, ui);
  if (ui.pokedexRegistration?.stage === "registered-entry") {
    return proposal({
      advisor: "battle",
      observation,
      recommendation: {
        kind: "acknowledge-cartridge-prompt",
        objective: "close-new-pokedex-entry",
      },
      confidence: 1,
      constraints: ["caught-pokedex-entry-awaiting-dismissal"],
      evidenceRefs: [
        "cartridge:task:Task_DexScreen_RegisterMonToPokedex:state:11",
      ],
    });
  }
  const plannedObjective = campaignPlanner?.select?.(observation) ?? null;
  const storyObjective = plannedObjective
    ? selectBattleRosterObjective({
        world,
        observation,
        objective: plannedObjective,
        teamPlan,
      }) ?? plannedObjective
    : null;
  const captureSpecies = new Set(
    (storyObjective?.captureSpecies ?? []).map(Number),
  );
  // A passive Exp. Share trainee never fights while another member can: it is
  // no switch, shift or replacement target, and it leaves the field at once.
  const passiveTrainee = passiveTraineeIdentity(plannedObjective) ?? passiveTraineeIdentity(storyObjective);
  const passiveTraineeSlots = new Set((memory?.trainer?.party ?? [])
    .filter((member) => isPassiveTrainee(member, passiveTrainee)).map(({ slot }) => Number(slot)));
  const opponentSpecies = Number(battle?.opponent?.species);
  const encounterSpecies = Number(
    battle?.opponent?.originalSpecies ?? battle?.opponent?.species,
  );
  const ownedSpecies = memory?.trainer?.pokedex?.ownedSpecies;
  const pokedexEnabled = teamPlan?.pokedexPolicy?.enabled ?? true;
  const isObservedPokedex = Array.isArray(ownedSpecies);
  const isNewPokedexSpecies = pokedexEnabled && isObservedPokedex &&
    Number.isSafeInteger(encounterSpecies) && encounterSpecies > 0 &&
    !ownedSpecies.some((species) => Number(species) === encounterSpecies);
  const captureAnyNewSpecies = Boolean(storyObjective?.captureAnyNewSpecies);
  const captureEncounter = (
    captureSpecies.size > 0 && captureSpecies.has(encounterSpecies)
  ) || (captureAnyNewSpecies && isNewPokedexSpecies);
  const isCaptureHunt = captureSpecies.size > 0 || captureAnyNewSpecies;
  const totalOwnedBalls = (memory?.trainer?.bag?.pokeBalls ?? []).reduce(
    (total, { itemId, quantity }) =>
      Number(itemId) === 1 ? total : total + Number(quantity ?? 0),
    0,
  );
  const ballReserve = Number(
    teamPlan?.pokedexPolicy?.opportunisticBallReserve ?? 3,
  );
  const partyCount = Number(memory?.trainer?.partyCount ?? 0);
  const boxCounts = memory?.trainer?.storage?.boxCounts;
  const reservedPartySlots = Math.max(
    0,
    Math.min(6, Number(storyObjective?.reservedPartySlots ?? 0)),
  );
  const hasCaptureCapacity = reservedPartySlots > 0
    ? partyCount < 6 - reservedPartySlots
    : partyCount < 6 || !Array.isArray(boxCounts) ||
      boxCounts.some((count) => Number(count) < 30);
  const healthyEnoughToCatch = Number(battle?.player?.maxHp ?? 0) > 0 &&
    Number(battle?.player?.hp ?? 0) / Number(battle?.player?.maxHp) > 0.45;
  const normalPokedexCapture = !storyObjective?.evTraining && isNewPokedexSpecies && healthyEnoughToCatch &&
    isCapturableWildBattle(memory?.battleTypeFlags) &&
    totalOwnedBalls > ballReserve && hasCaptureCapacity;
  const safariPokedexCapture = isNewPokedexSpecies &&
    Number(memory?.battleTypeFlags) === SAFARI_BATTLE_FLAGS;
  const pokedexCapture = normalPokedexCapture || safariPokedexCapture;
  const captureTarget = captureEncounter || pokedexCapture;
  const captureObjective = captureEncounter
    ? `capture-${storyObjective.id}`
    : `pokedex-capture-${encounterSpecies}`;
  if (ui.choiceMenu && battle?.scriptName === "capture-nickname-prompt") {
    return proposal({
      advisor: "battle",
      observation,
      recommendation: {
        kind: "choose-menu-option",
        targetOption: "no",
        objective: "keep-caught-species-name",
      },
      confidence: 1,
      constraints: ["never-nickname-pokemon", "caught-pokemon-script"],
      evidenceRefs: ["cartridge:battle-script:capture-nickname-prompt"],
    });
  }
  const battleLegality = deriveBattleLegality({
    battleTypeFlags: memory?.battleTypeFlags,
    battle,
    mechanics,
    party: memory?.trainer?.party,
  });
  if(storyObjective?.evTraining&&battle?.opponent?.hp>0&&
      memory.encounter?.shiny!==true&&battle.opponent.shiny!==true){
    const ev=storyObjective.evTraining;
    const member=(memory.trainer?.party??[]).find(p=>encounterFingerprint(p)===ev.fingerprint);
    const species=Object.values(dataOf(mechanics).species??{}).find(s=>s?.id===encounterSpecies);
    const allowed=ev.training&&ev.allowedSpecies.includes(encounterSpecies)&&member&&acceptableEffortGain(member,species,ev.targets);
    if(!allowed){
      let recommendation=null;
      if(!battleLegality.run.allowed)recommendation={kind:'stop-for-review',reason:'This battle cannot be escaped without risking unwanted EVs. The requested spread is preserved for review.'};
      else if(ui.battle?.stage==='action')recommendation={kind:'choose-battle-command',targetCommand:'run',objective:'preserve-requested-evs'};
      else if(ui.battle?.stage==='move')recommendation={kind:'cancel-battle-move-for-run',objective:'preserve-requested-evs'};
      else if(ui.party||ui.bag)recommendation={kind:'cancel-conflicting-menu',objective:'preserve-requested-evs'};
      if(recommendation)return proposal({advisor:'battle',observation,recommendation,confidence:1,
        constraints:['exact-ev-target','native-recipient-yield'],evidenceRefs:[`cartridge:opponent-species:${encounterSpecies}`]});
    }
  }
  const selectableMoveSlots = new Set(battleLegality.moves.selectableSlots);
  const hasCaptureBall = (memory?.trainer?.bag?.pokeBalls ?? []).some(
    ({ itemId, quantity }) =>
      Number(itemId) !== 1 && Number(quantity) > 0,
  );
  const normalCaptureTarget = captureTarget && hasCaptureBall &&
    isCapturableWildBattle(memory?.battleTypeFlags);
  const capturePreparation = normalCaptureTarget
    ? selectCapturePreparationMove({
        mechanics,
        player: battle?.player,
        opponent: battle?.opponent,
        selectableMoveSlots,
      })
    : null;
  const captureSpecialist = normalCaptureTarget
    ? selectCapturePreparationSpecialist({
        mechanics,
        party: memory?.trainer?.party,
        battle,
        activePreparation: capturePreparation,
        switchAllowed: battleLegality.switch.allowed,
      })
    : null;
  const capturePreparationObjective = `prepare-${captureObjective}`;
  const captureSpecialistObjective =
    `deploy-capture-specialist-${captureObjective}`;
  if (ui.bag && captureTarget) {
    const balls = memory?.trainer?.bag?.pokeBalls ?? [];
    const mapType = (dataOf(world).maps ?? []).find(({ id }) =>
      id === memory?.map?.id
    )?.properties?.map_type ?? null;
    const preferredBall = selectBestCaptureBall({
      balls,
      opponent: battle?.opponent,
      mechanics,
      ownedSpecies,
      mapType,
      turn: battle?.turn,
    });
    let recommendation = capturePreparation || captureSpecialist
      ? {
          kind: "close-menu",
          objective: capturePreparationObjective,
        }
      : null;
    if (!recommendation && ui.bag.stage === "context") {
      recommendation = preferredBall &&
          Number(ui.bag.selectedItemId) === preferredBall.itemId
        ? {
            kind: "choose-bag-context-action",
            targetAction: "use",
            targetIndex: 0,
            objective: captureObjective,
          }
        : { kind: "close-menu", objective: captureObjective };
    } else if (!recommendation && ui.bag.stage === "list") {
      recommendation = Number(ui.bag.pocket) === 2
        ? preferredBall && {
            kind: "choose-bag-item",
            targetItemId: preferredBall.itemId,
            targetIndex: preferredBall.index,
            objective: captureObjective,
          }
        : {
            kind: "choose-bag-pocket",
            targetPocket: 2,
            objective: captureObjective,
          };
    }
    if (recommendation) {
      return proposal({
        advisor: "battle",
        observation,
        recommendation,
        confidence: 0.999,
        constraints: [
          captureEncounter ? "requested-wild-species" : "uncaught-pokedex-species",
          ...(capturePreparation || captureSpecialist
            ? ["capture-preparation-required"]
            : [
                "owned-poke-ball",
                `best-catch-multiplier:${preferredBall?.multiplier ?? 0}/10`,
              ]),
        ],
        evidenceRefs: [
          `campaign:objective:${storyObjective.id}`,
          `cartridge:opponent-species:${battle?.opponent?.species}`,
          `cartridge:battle-turn:${battle?.turn ?? 0}`,
        ],
      });
    }
  }
  if (ui.party?.stage === "message") {
    return proposal({
      advisor: "battle",
      observation,
      recommendation: { kind: "acknowledge-cartridge-prompt" },
      confidence: 0.999,
      constraints: ["observed-party-message"],
      evidenceRefs: [
        `cartridge:party-item:${ui.party.itemId ?? "unknown"}`,
        `cartridge:callback:${observation.emulator?.callback2 ?? "unknown"}`,
      ],
    });
  }
  if (
    ui.choiceMenu &&
    Number(battle?.player?.hp ?? 0) === 0 &&
    Number(memory?.trainer?.usablePartyCount ?? 0) > 0
  ) {
    return proposal({
      advisor: "battle",
      observation,
      recommendation: {
        kind: "choose-menu-option",
        targetOption: "yes",
        objective: "replace-fainted-pokemon",
      },
      confidence: 0.999,
      constraints: ["fainted-active-pokemon", "usable-party-member"],
      evidenceRefs: [
        `cartridge:battle-message:${battle?.messageText ?? "use-next-pokemon"}`,
        `cartridge:usable-party-count:${memory.trainer.usablePartyCount}`,
      ],
    });
  }
  const damagingCandidates = battle?.player && battle?.opponent
    ? scoreBattleMoveTargets({
        mechanics,
        player: battle.player,
        opponents: battle.opponents,
      }).filter(({ moveSlot }) => selectableMoveSlots.has(moveSlot))
    : [];
  const playerHp = Number(battle?.player?.hp ?? 0);
  const playerMaxHp = Number(battle?.player?.maxHp ?? 0);
  const transformPlan=damagingCandidates.length===0&&battle?.player&&battle?.opponent?selectSurvivalSupportMove({mechanics,player:battle.player,
    opponent:battle.opponent,selectableMoveSlots}):null;
  const shouldPreserveRecoveryResources =
    Number(memory?.battleTypeFlags) === NORMAL_WILD_BATTLE_FLAGS &&
    playerMaxHp > 0 &&
    (playerHp / playerMaxHp <= 0.45 || damagingCandidates.length === 0&&transformPlan?.effect!=='EFFECT_TRANSFORM');
  const isTrainerBattle = ![
    NORMAL_WILD_BATTLE_FLAGS,
    SAFARI_BATTLE_FLAGS,
  ].includes(Number(memory?.battleTypeFlags));
  const activePartyMemberForRole = (memory?.trainer?.party ?? []).find(({ slot }) =>
    Number(slot) === Number(battle?.playerPartySlot)
  ) ?? (memory?.trainer?.party ?? []).find(({ species, hp }) =>
    Number(species) === Number(battle?.player?.species) &&
    Number(hp) === Number(battle?.player?.hp)
  );
  const hmSupportTurn = Boolean(
    plannedObjective?.importantBattle &&
    isReviveSupportCarrier(activePartyMemberForRole, teamPlan)
  );
  const strategicReviveTarget = selectStrategicReviveTarget({
    mechanics,
    party: memory?.trainer?.party,
    opponent: battle?.opponent,
    objective: plannedObjective,
    teamPlan,
  });
  // A field helper can be boxed or fainted. Its absence must not prohibit
  // a last-chance rescue when no remaining fighter is safe.
  const livingParty = (memory?.trainer?.party ?? []).filter(({ hp }) => Number(hp) > 0);
  const emergencyRevive = Boolean(
    playerHp > 0 && strategicReviveTarget &&
    livingParty.length > 0 && livingParty.length <= 2 &&
    !livingParty.some((member) =>
      Number(member.slot) !== Number(battle?.playerPartySlot) &&
      isReviveSupportCarrier(member, teamPlan) &&
      canSafelyExecuteReviveSequence({ mechanics, pokemon: member, opponent: battle?.opponent })
    ) &&
    livingParty.every((member) => {
      const safety = partyMemberMatchupSafety({ mechanics, member, opponent: battle?.opponent });
      return isReviveSupportCarrier(member, teamPlan) || !safety.safe || safety.onlyResistedDamagingMoves;
    }) &&
    partyMatchupPlan({
        observation,
      mechanics,
      party: [{ ...strategicReviveTarget, hp: Math.max(1, Math.floor(strategicReviveTarget.maxHp / 2)) }],
      opponentSpecies: battle?.opponent?.species,
      opponentBattle: battle?.opponent,
      activeSpecies: null,
    })?.best?.score > 0
  );
  const allowSupportRevive = hmSupportTurn || emergencyRevive;
  let recoveryPlan = isTrainerBattle && battleLegality.bag.allowed
    ? battleRecoveryPlan(memory, battle, mechanics, {
        allowSupportRevive,
        emergencyRevive,
        reviveTarget: strategicReviveTarget,
      })
    : null;
  const committedPartyItemId = Number(ui.party?.itemId);
  if (
    ui.party?.stage === "choose-pokemon" &&
    BATTLE_REVIVE_ITEMS.has(committedPartyItemId) &&
    !allowSupportRevive
  ) {
    return proposal({
      advisor: "battle",
      observation,
      recommendation: {
        kind: "cancel-conflicting-menu",
        objective: "cancel-unsafe-revive",
      },
      confidence: 1,
      constraints: [
        "revive-support-carrier-only",
        "combat-member-must-not-tank-revive-turn",
      ],
      evidenceRefs: [
        `cartridge:item:${committedPartyItemId}`,
        `cartridge:active-species:${battle?.player?.species ?? "unknown"}`,
      ],
    });
  }
  const committedRecoveryPlan = committedBattleRecoveryPlan(memory, battle, {
    reviveTarget: strategicReviveTarget,
  });
  if (committedRecoveryPlan) {
    const { itemId, target, objective } = committedRecoveryPlan;
    return proposal({
      advisor: "battle",
      observation,
      recommendation: {
        kind: "choose-party-member",
        targetPartySlot: target.slot,
        targetSpecies: target.species,
        objective,
      },
      confidence: 1,
      constraints: ["committed-battle-item", "observed-party-target"],
      evidenceRefs: [
        `cartridge:item:${itemId}`,
        `cartridge:party-slot:${target.slot}:species:${target.species}`,
      ],
    });
  }
  const plannedTrainingObjective = storyObjective && !majorBattle
    ? campaignTrainingObjective({
        campaignPlanner,
        world,
        observation,
        objective: storyObjective,
        teamPlan,
      })
    : null;
  const explicitTrainingObjective = plannedTrainingObjective && (
    Number(memory?.battleTypeFlags) === NORMAL_WILD_BATTLE_FLAGS ||
    isTrainerBattle &&
      (
        plannedTrainingObjective.trainingMode === "passive" ||
        ["trainer", "vs-seeker"].includes(
          plannedTrainingObjective.trainingSource,
        ) &&
          plannedTrainingObjective.target?.map === memory?.map?.id &&
          Number(battle?.opponent?.level ?? Infinity) <=
            Number(plannedTrainingObjective.trainer?.maximumLevel ?? -Infinity)
      )
  ) ? plannedTrainingObjective : null;
  const trainingObjective = explicitTrainingObjective;
  // Experience training needs a member that can still gain EXP. A level-100
  // member may still escort or finish, but is never a participation target.
  const trainingMember = trainingObjective
    ? (memory?.trainer?.party ?? []).find(({ slot, hp, level }) =>
        Number(slot) === Number(trainingObjective.trainingPartySlot) && Number(hp) > 0 &&
        !(trainingSeeksExperience(trainingObjective) && Number(level) >= 100)
      ) ?? null
    : null;
  const observedPlayerPartySlot = Number(battle?.playerPartySlot);
  const activePlayerPartySlots = new Set(
    (battle?.activePlayerPartySlots ?? [observedPlayerPartySlot]).map(Number),
  );
  const reservedPlayerPartySlotSet = new Set(
    (battle?.reservedPlayerPartySlots ?? []).map(Number),
  );
  const unavailablePlayerPartySlots = new Set([
    ...activePlayerPartySlots,
    ...reservedPlayerPartySlotSet,
  ]);
  const faintedCombatMember = strategicReviveTarget;
  const ownedReviveItem = [25, 24].find((itemId) =>
    Number((memory?.trainer?.bag?.items ?? []).find((item) =>
      Number(item.itemId) === itemId
    )?.quantity ?? 0) > 0
  ) ?? null;
  const reviveSupport =
    plannedObjective?.importantBattle &&
    isTrainerBattle &&
    battleLegality.bag.allowed &&
    battleLegality.switch.allowed &&
    !hmSupportTurn &&
    !recoveryPlan &&
    faintedCombatMember &&
    ownedReviveItem
      ? [...(memory?.trainer?.party ?? [])]
          .filter((pokemon) =>
            !unavailablePlayerPartySlots.has(Number(pokemon.slot)) &&
            !passiveTraineeSlots.has(Number(pokemon.slot)) &&
            Number(pokemon.hp ?? 0) > 0 &&
            Number(pokemon.maxHp ?? 0) > 0 &&
            isReviveSupportCarrier(pokemon, teamPlan) &&
            canSafelyExecuteReviveSequence({
              mechanics,
              pokemon,
              opponent: battle?.opponent,
            })
          )
          .sort((left, right) =>
            Number(right.hp) / Number(right.maxHp) -
              Number(left.hp) / Number(left.maxHp) ||
            Number(right.hp) - Number(left.hp) ||
            Number(left.slot) - Number(right.slot)
          )[0] ?? null
      : null;
  const observedActivePartyMember = (memory?.trainer?.party ?? []).find(
    ({ slot }) => Number(slot) === observedPlayerPartySlot,
  );
  const observedPlayerPartySlotIsCurrent = Boolean(
    observedActivePartyMember &&
    (Number(observedActivePartyMember.species) === Number(battle?.player?.species)||
      (Number(battle?.player?.status2)&(1<<21))!==0),
  );
  const trainingMemberIsActive = Boolean(
    trainingMember &&
    (
      activePlayerPartySlots.has(Number(trainingMember.slot)) ||
      !Number.isSafeInteger(observedPlayerPartySlot) &&
        Number(battle?.player?.species) === Number(trainingMember.species)
    ),
  );
  const trainingMemberIsReserved = Boolean(
    trainingMember &&
    reservedPlayerPartySlotSet.has(Number(trainingMember.slot)),
  );
  const trainingMemberIsActing = Boolean(
    trainingMember &&
    (Number.isSafeInteger(observedPlayerPartySlot) &&
      observedPlayerPartySlotIsCurrent
      ? observedPlayerPartySlot === Number(trainingMember.slot)
      : Number(battle?.player?.species) === Number(trainingMember.species)),
  );
  const sentPartyMasks = battle?.sentPartyMasks;
  const trainingParticipationIsObserved = Boolean(
    trainingMember &&
    Array.isArray(sentPartyMasks) &&
    sentPartyMasks.length > 0,
  );
  const trainingMemberHasParticipated = Boolean(
    trainingParticipationIsObserved &&
    sentPartyMasks.some((mask) =>
      (Number(mask) & (1 << Number(trainingMember.slot))) !== 0
    ),
  );
  const trainingMemberNeedsParticipation = Boolean(
    trainingMember &&
    !trainingMemberIsActive &&
    !trainingMemberIsReserved &&
    (!trainingParticipationIsObserved || !trainingMemberHasParticipated)
  );
  // A paid participation switch hands the opponent a free hit on the trainee.
  // It needs a trainee that survives that hit whenever the hit is bounded.
  const trainingParticipationIncoming = trainingMemberNeedsParticipation && battle?.opponent
    ? maximumCredibleIncomingDamage({ mechanics, attacker: battle.opponent, defender: trainingMember })
    : null;
  const trainingParticipationSwitchSafe = trainingParticipationIncoming === null ||
    trainingParticipationIncoming < Number(trainingMember?.hp ?? 0);
  const trainingMethodRequiresEscort = ["switch", "guarded"].includes(
    trainingObjective?.trainingMethod,
  );
  const trainingMemberMatchupSafety = trainingMember
    ? partyMemberMatchupSafety({
        mechanics,
        member: trainingMemberIsActing
          ? { ...trainingMember, ...battle.player }
          : trainingMember,
        opponent: battle?.opponent,
        damagingCandidates: trainingMemberIsActing
          ? damagingCandidates
          : undefined,
      })
    : null;
  const trainingMemberIsUnderleveled = Boolean(
    trainingMemberMatchupSafety?.underleveled,
  );
  const trainingMemberIsBelowHealthFloor = Boolean(
    trainingMemberMatchupSafety?.belowHealthFloor,
  );
  const directTraining = trainingMember && (Number(memory?.battleTypeFlags) & BATTLE_TYPE_DOUBLE) === 0 &&
      !obedienceRisk(trainingMember,observation)
    ? directTrainingPlan({mechanics,member:trainingMemberIsActing
        ? {...trainingMember,...battle.player} : trainingMember,
      opponent:battle?.opponent,weather:battle?.weather})
    : null;
  const trainingMemberRequiresEscort = Boolean(
    trainingMember &&
    (trainingMethodRequiresEscort || trainingMemberIsUnderleveled) && !directTraining
  );
  const switchTrainingExposureComplete = Boolean(
    trainingMemberRequiresEscort &&
    trainingMemberIsActive &&
    trainingMemberHasParticipated
  );
  const trainingMemberHasNoUsableDamagingMove = Boolean(
    trainingMemberMatchupSafety?.noUsableDamagingMove,
  );
  const trainingMemberNeedsProtection = Boolean(
    trainingMember &&
    trainingMemberIsActing &&
    (
      switchTrainingExposureComplete ||
      trainingMemberHasNoUsableDamagingMove ||
      trainingMemberIsBelowHealthFloor
    )
  );
  const trainingMemberShouldRemainProtected = Boolean(
    trainingMember &&
    !trainingMemberIsActive &&
    (
      trainingMemberIsBelowHealthFloor ||
      trainingMemberHasNoUsableDamagingMove ||
      trainingMemberRequiresEscort && trainingMemberHasParticipated
    )
  );
  const safeTrainingEscortCandidates = trainingMember
    ? [...(memory?.trainer?.party ?? [])]
        .filter(({ slot, hp }) =>
          !unavailablePlayerPartySlots.has(Number(slot)) &&
          Number(hp) > 0
        )
        .filter((member) =>
          partyMemberMatchupSafety({
            mechanics,
            member,
            opponent: battle?.opponent,
          }).safe
        )
    : [];
  const coveredTrainingEscortCandidates = safeTrainingEscortCandidates.filter(
    (member) => !partyMemberMatchupSafety({
      mechanics,
      member,
      opponent: battle?.opponent,
    }).onlyResistedDamagingMoves,
  );
  const trainingEscortCandidates = coveredTrainingEscortCandidates.length > 0
    ? coveredTrainingEscortCandidates
    : safeTrainingEscortCandidates;
  const plannedEscortPartySlot = trainingObjective?.escortPartySlot;
  const plannedEscortSpecies = trainingObjective?.escortSpecies;
  const plannedTrainingEscort = (
    plannedEscortPartySlot != null || plannedEscortSpecies != null
  )
    ? trainingEscortCandidates.find((member) =>
        (plannedEscortPartySlot == null ||
          Number(member.slot) === Number(plannedEscortPartySlot)) &&
        (plannedEscortSpecies == null ||
          Number(member.species) === Number(plannedEscortSpecies))
      ) ?? null
    : null;
  const trainingEscortMatchup = trainingMember && battle?.opponent?.species
    ? partyMatchupPlan({
        observation,
        mechanics,
        party: trainingEscortCandidates,
        balanceExperience: !isMajorBattle(observation,mechanics),
        teamPlan,
        opponentSpecies: battle.opponent.species,
        opponentBattle: battle.opponent,
        activeSpecies: plannedTrainingEscort?.species ?? null,
      })
    : null;
  // Select the counter before paying for the switch. A balanced escort is a
  // useful tie-breaker, but must not become a stop on the way to a better one.
  const trainingEscort = (plannedTrainingEscort &&
    !obedienceRisk(plannedTrainingEscort,observation) &&
    !matchupIsMateriallyBetter(trainingEscortMatchup, 1.35)
      ? plannedTrainingEscort : null) ??
    trainingEscortMatchup?.best?.member ??
    trainingEscortCandidates
      .sort((left, right) =>
        Number(right.level ?? 0) - Number(left.level ?? 0) ||
        Number(right.hp ?? 0) - Number(left.hp ?? 0)
      )[0] ?? null;
  const trainingProtectionConstraints = [
    trainingSourceConstraint(trainingObjective),
    switchTrainingExposureComplete
      ? trainingMethodRequiresEscort
        ? "switch-training-after-participation"
        : "training-member-underleveled-for-opponent"
      : trainingMemberHasNoUsableDamagingMove
        ? "no-usable-damaging-move"
      : "damaged-below-half-health",
    "usable-escort-member",
  ];
  const trainingProtectionEvidence = [
    ...(switchTrainingExposureComplete
      ? [
          ...(trainingMethodRequiresEscort
            ? [`campaign:training-method:${trainingObjective.trainingMethod}`]
            : [
                `cartridge:training-member-level:${trainingMember.level}`,
                `cartridge:opponent-level:${battle.opponent.level}`,
              ]),
          `cartridge:sent-party-mask:${sentPartyMasks.join(",")}`,
        ]
      : trainingMemberHasNoUsableDamagingMove
        ? ["cartridge:damaging-moves-with-pp:0"]
      : [`cartridge:training-member-hp:${playerHp}/${playerMaxHp}`]),
    `cartridge:party-slot:${trainingEscort?.slot ?? "unknown"}:species:${trainingEscort?.species ?? "unknown"}`,
  ];
  const bestTrainingDamage = damagingCandidates[0] ?? null;
  const opponentHp = Number(battle?.opponent?.hp ?? 0);
  const safeTrainingKnockout = Boolean(
    trainingMember &&
    trainingMemberIsActing &&
    trainingMemberHasParticipated &&
    trainingEscort &&
    bestTrainingDamage && directTraining?.turns === 1
  );
  const protectedTrainingMemberSlot = trainingMemberShouldRemainProtected
    ? Number(trainingMember.slot)
    : null;
  const activeSafetyMember = observedActivePartyMember
    ? { ...observedActivePartyMember, ...battle?.player }
    : battle?.player;
  const activeMatchupSafety = partyMemberMatchupSafety({
    mechanics,
    member: activeSafetyMember,
    opponent: battle?.opponent,
    damagingCandidates,
  });
  const switchMatchupParty = (memory?.trainer?.party ?? []).filter((member) => {
    const slot = Number(member.slot);
    if (reservedPlayerPartySlotSet.has(slot)) return false;
    const active = activePlayerPartySlots.has(slot);
    if (active) return slot === observedPlayerPartySlot;
    if (slot === protectedTrainingMemberSlot || passiveTraineeSlots.has(slot)) return false;
    const safety = partyMemberMatchupSafety({
      mechanics,
      member,
      opponent: battle?.opponent,
    });
    const incoming=maximumCredibleIncomingDamage({mechanics,attacker:battle?.opponent,defender:member});
    return safety.safe && !safety.onlyResistedDamagingMoves &&
      (incoming===null||incoming<Number(member.hp));
  });
  const currentMatchup = isTrainerBattle && battle?.opponent?.species
    ? partyMatchupPlan({
        observation,
        balanceExperience: !isMajorBattle(observation,mechanics) &&
          switchMatchupParty.some(p=>Number(p.level)>Number(battle?.player?.level)+2),
        teamPlan,
        mechanics,
        party: switchMatchupParty,
        opponentSpecies: battle.opponent.species,
        opponentBattle: battle.opponent,
        activeSpecies: battle?.player?.species,
      })
    : null;
  const safeReserveMatchup = battle?.opponent?.species
    ? partyMatchupPlan({
        observation,
        balanceExperience: !isMajorBattle(observation,mechanics),
        teamPlan,
        mechanics,
        party: switchMatchupParty.filter(({ slot }) =>
          !activePlayerPartySlots.has(Number(slot))
        ),
        opponentSpecies: battle.opponent.species,
        opponentBattle: battle.opponent,
        activeSpecies: null,
      })
    : null;
  // The passive trainee is sent after a faint only when nobody else can fight.
  const fightingParty = (memory?.trainer?.party ?? []).filter(({ slot, hp }) =>
    !passiveTraineeSlots.has(Number(slot)) || Number(hp) <= 0);
  const forcedReplacementMember =
    ui.party?.stage === "choose-pokemon" &&
    Number(battle?.player?.hp) === 0 &&
    Number(memory?.trainer?.usablePartyCount ?? 0) > 0
      ? selectForcedReplacementMember({
          mechanics,
          party: fightingParty,
          observation,
          battle,
        }) ?? selectForcedReplacementMember({
          mechanics,
          party: memory?.trainer?.party,
          observation,
          battle,
        })
      : null;
  const hmSupportMatchup = hmSupportTurn && battle?.opponent?.species
    ? partyMatchupPlan({
        observation,
        mechanics,
        party: switchMatchupParty.filter((pokemon) =>
          Number(pokemon.hp) > 0 && !isReviveSupportCarrier(pokemon, teamPlan)
        ),
        opponentSpecies: battle.opponent.species,
        opponentBattle: battle.opponent,
        activeSpecies: null,
      })
    : null;
  // KO-race discipline (singles). A voluntary switch costs the incoming member
  // a free opponent hit, so it is made only when the active member loses its
  // race and the incoming member still wins after that entry hit. "Losing" is
  // the race, not a health floor: a hurt member that still knocks the opponent
  // out first keeps attacking. When a race cannot be bounded from observed
  // data, the established matchup rules below apply unchanged.
  const singlesBattle = (Number(memory?.battleTypeFlags) & BATTLE_TYPE_DOUBLE) === 0;
  const battleWeather = battle?.weather ?? null;
  const activeRace = singlesBattle && battle?.player && Number(battle?.opponent?.hp) > 0
    ? battleKoRace({ mechanics, member: activeSafetyMember, opponent: battle.opponent,
        weather: battleWeather, selectableMoveSlots })
    : null;
  const raceKnown = Boolean(activeRace);
  const activeWinsRace = activeRace?.wins === true;
  // A winning member keeps attacking. The only exception is a narrow win
  // (no spare maximum hit) by a member the established health/level gates
  // already call unsafe; it may hand over, but only to a member that wins
  // comfortably after its entry hit.
  const activeHoldsRace = activeWinsRace && (raceIsComfortable(activeRace) || activeMatchupSafety.safe);
  const activeObedienceRisk = obedienceRisk(activePartyMemberForRole, observation);
  // Attacking cannot help when the active member has no usable damaging move,
  // or faints this turn without winning (before acting, or right after a hit
  // that cannot finish). Obedience keeps its own rule below.
  const activeRaceEmergency = raceKnown && !activeWinsRace &&
    (activeMatchupSafety.noUsableDamagingMove || activeRace.faintsBeforeActing || activeRace.faintsThisTurn);
  // Hysteresis without hidden state: FireRed's participation mask for the
  // current opponent (gSentPokesToOpponent) marks every member already sent
  // against it. A withdrawn member is not voluntarily switched back in; only
  // an emergency may return to it. A new opponent resets the mask natively.
  const participationMask = singlesBattle ? Number(sentPartyMasks?.[0] ?? 0) : 0;
  const withdrawnPartySlots = new Set((memory?.trainer?.party ?? [])
    .map(({ slot }) => Number(slot))
    .filter((slot) => Number.isSafeInteger(slot) && slot >= 0 && slot < 6 &&
      (participationMask & (1 << slot)) !== 0 && !activePlayerPartySlots.has(slot)));
  // The active member races with its live battle state, even when its party
  // entry is transiently unreadable (the cartridge rewrites it mid-turn).
  const livingRaceMembers = [
    ...(memory?.trainer?.party ?? []).filter((member) => Number(member.hp) > 0 &&
      !reservedPlayerPartySlotSet.has(Number(member.slot)) && Number(member.slot) !== observedPlayerPartySlot &&
      !passiveTraineeSlots.has(Number(member.slot))),
    ...(Number.isSafeInteger(observedPlayerPartySlot) && Number(battle?.player?.hp) > 0 &&
      (observedPlayerPartySlotIsCurrent || !observedActivePartyMember)
      ? [{ ...activeSafetyMember, slot: observedPlayerPartySlot }] : []),
  ];
  const remainingOpponents = raceKnown && isTrainerBattle ? remainingBattleOpponents({ mechanics, battle }) : [];
  // Incoming members keep every established safety gate (health, level,
  // usable non-resisted damage, surviving the entry hit) and must also win.
  const raceSwitchPool = raceKnown && !activeHoldsRace && battleLegality.switch.allowed
    ? switchMatchupParty.filter((member) =>
        !activePlayerPartySlots.has(Number(member.slot)) &&
        !obedienceRisk(member, observation))
    : [];
  const raceSwitchCandidate = raceSwitchPool.length
    ? planBattleCounters({ mechanics, members: raceSwitchPool, counterPool: livingRaceMembers,
        opponent: battle.opponent, remaining: remainingOpponents, weather: battleWeather,
        entry: true, excludeSlots: withdrawnPartySlots }).ranked[0] ?? null
    : null;
  const raceSwitchTarget = raceSwitchCandidate &&
    (!activeWinsRace || raceIsComfortable(raceSwitchCandidate.race))
    ? raceSwitchCandidate.member
    : null;
  // With no winning reserve, an emergency still leaves for a reserve that at
  // least survives the entry hit, preferring one not already withdrawn.
  const emergencyReserve = activeRaceEmergency && !raceSwitchTarget && battle?.opponent?.species
    ? partyMatchupPlan({
        observation, mechanics, teamPlan,
        party: switchMatchupParty.filter(({ slot }) =>
          !activePlayerPartySlots.has(Number(slot)) && !withdrawnPartySlots.has(Number(slot))),
        opponentSpecies: battle.opponent.species,
        opponentBattle: battle.opponent,
        activeSpecies: null,
      })?.best?.member ?? safeReserveMatchup?.best?.member ?? null
    : null;
  const hmSupportSwitch = battleLegality.switch.allowed
    ? hmSupportMatchup?.best?.member ?? null
    : null;
  // A passive trainee that is somehow active (a last-resort replacement, or a
  // lead from an unprepared party) leaves as soon as another member can fight.
  const passiveTraineeActive = passiveTraineeSlots.has(observedPlayerPartySlot) && Number(battle?.player?.hp ?? 0) > 0;
  const passiveWithdrawal = passiveTraineeActive && battleLegality.switch.allowed
    ? (raceKnown
        ? planBattleCounters({ mechanics, members: switchMatchupParty.filter(({ slot }) =>
            !activePlayerPartySlots.has(Number(slot))), counterPool: livingRaceMembers,
            opponent: battle.opponent, remaining: remainingOpponents, weather: battleWeather,
            entry: true }).ranked[0]?.member
        : null) ?? safeReserveMatchup?.best?.member ??
      (memory?.trainer?.party ?? []).filter(({ slot, hp }) => Number(hp) > 0 &&
        !unavailablePlayerPartySlots.has(Number(slot)) && !passiveTraineeSlots.has(Number(slot)))
        .sort((left, right) => Number(right.hp) - Number(left.hp) || Number(left.slot) - Number(right.slot))[0] ?? null
    : null;
  // A race-decided switch keeps the established objective names: struggling
  // (unsafe by the health/level/move gates), coverage, or a matchup change.
  const raceSwitch = raceKnown && !activeObedienceRisk && !activeHoldsRace &&
    battleLegality.switch.allowed && Number(battle?.player?.hp ?? 0) > 0
    ? raceSwitchTarget ?? emergencyReserve
    : null;
  const strugglingActiveSwitch =
    battleLegality.switch.allowed &&
    (isTrainerBattle || activeObedienceRisk) &&
    Number(battle?.player?.hp ?? 0) > 0
      ? activeObedienceRisk
        ? safeReserveMatchup?.best?.member ?? null
        : raceKnown
          ? !activeMatchupSafety.safe ? raceSwitch : null
          : !activeMatchupSafety.safe ? safeReserveMatchup?.best?.member ?? null : null
      : null;
  const coverageActiveSwitch =
    battleLegality.switch.allowed &&
    Number(battle?.player?.hp ?? 0) > 0 &&
    activeMatchupSafety.onlyResistedDamagingMoves && !(trainingMemberIsActing && directTraining)
      ? raceKnown
        ? raceSwitch
        : safeReserveMatchup?.best?.member ?? null
      : null;
  // In singles the cartridge's first participation mask belongs to the current
  // opponent. Keep a capable finisher once both it and the trainee have credit;
  // a score-only upgrade would cost a turn and dilute that trainee's XP. Health,
  // PP, coverage, forced switches and other emergency rules still take priority.
  const finisherIncomingDamage = trainingMember && !trainingMemberIsActive
    ? maximumCredibleIncomingDamage({ mechanics, attacker: battle?.opponent,
        defender: activeSafetyMember })
    : null;
  const retainTrainingFinisher = Boolean(
    trainingMember && !trainingMemberIsActive &&
    (Number(memory?.battleTypeFlags) & 1) === 0 &&
    observedPlayerPartySlotIsCurrent &&
    (Number(sentPartyMasks?.[0]) & (1 << Number(trainingMember.slot))) !== 0 &&
    (Number(sentPartyMasks?.[0]) & (1 << observedPlayerPartySlot)) !== 0 &&
    activeMatchupSafety.safe && !activeMatchupSafety.onlyResistedDamagingMoves &&
    (finisherIncomingDamage === null || finisherIncomingDamage < Number(battle?.player?.hp))
  );
  // A score-only upgrade needs an unknown race: a known race has already
  // decided above whether the active member keeps attacking.
  const matchupSwitch = passiveWithdrawal ?? hmSupportSwitch ?? strugglingActiveSwitch ??
    coverageActiveSwitch ?? (raceKnown ? (isTrainerBattle ? raceSwitch : null) : null) ?? (
    !raceKnown &&
    !retainTrainingFinisher && !(trainingMemberIsActing && trainingMemberHasParticipated && directTraining) &&
    // A score comparison needs the active member's own score; a transiently
    // unreadable party entry must not make every reserve look better.
    battleLegality.switch.allowed && currentMatchup?.best && currentMatchup.active &&
    Number(currentMatchup.best.member.species) !== Number(battle?.player?.species) &&
    matchupIsMateriallyBetter(currentMatchup, 1.35)
      ? currentMatchup.best.member
      : null
  );
  const matchupSwitchObjective = passiveWithdrawal
    ? "withdraw-passive-trainee"
    : hmSupportSwitch
    ? "deploy-battle-specialist"
    : strugglingActiveSwitch
      ? "protect-struggling-pokemon"
      : coverageActiveSwitch
        ? "improve-battle-coverage"
        : "improve-battle-matchup";
  const raceDecidedSwitch = Boolean(raceSwitch) && matchupSwitch === raceSwitch && !hmSupportSwitch && !passiveWithdrawal;
  const raceSwitchConstraints = raceDecidedSwitch
    ? [
        activeMatchupSafety.noUsableDamagingMove
          ? "active-pokemon-has-no-usable-damaging-move"
          : activeRace.faintsBeforeActing
            ? "active-pokemon-faints-before-acting"
            : activeRace.faintsThisTurn
              ? "active-pokemon-faints-this-turn"
              : "active-pokemon-loses-ko-race",
        raceSwitch === raceSwitchTarget ? "reserve-wins-ko-race-after-entry-hit" : "reserve-survives-entry-hit",
      ]
    : [];
  const matchupSwitchConstraints = passiveWithdrawal
    ? ["passive-exp-share-trainee", "another-member-can-fight"]
    : strugglingActiveSwitch
    ? [
        "trainer-battle",
        activeMatchupSafety.belowHealthFloor
          ? "active-pokemon-below-half-health"
          : activeMatchupSafety.underleveled
            ? "active-pokemon-underleveled"
            : "active-pokemon-has-no-usable-damaging-move",
        "safe-reserve",
        ...raceSwitchConstraints,
      ]
    : coverageActiveSwitch
      ? [
          "resisted-active-damaging-moves",
          "neutral-or-better-reserve",
          "safe-reserve",
          ...raceSwitchConstraints,
        ]
      : ["trainer-battle", ...(raceDecidedSwitch ? raceSwitchConstraints : ["source-backed-type-matchup"])];
  const finishingMove=isTrainerBattle && !trainingMember && !passiveWithdrawal &&
    (Number(memory.battleTypeFlags)&BATTLE_TYPE_DOUBLE)===0 &&
    !battleLegality.forcedAction.active && !obedienceRisk(activePartyMemberForRole,observation)
      ? finishingBattleMove({mechanics,player:battle?.player,opponent:battle?.opponent,
          weather:battle?.weather,selectableMoveSlots,battle}) : null;
  const activeMatchupMember = currentMatchup?.active?.member;
  const outclassedRecoveryTarget = matchupSwitch && activeMatchupMember &&
    Number(matchupSwitch.level ?? 0) >= Number(activeMatchupMember.level ?? 0) + 12;
  const perishSongCritical =
    (Number(battle?.player?.status3 ?? 0) & (1 << 5)) !== 0 &&
    Number(battle?.player?.moveState?.perishSongTurns) === 0;
  const perishEscapeTarget = perishSongCritical && battleLegality.switch.allowed
    ? [...(memory?.trainer?.party ?? [])]
        .filter(({ slot, hp }) =>
          !unavailablePlayerPartySlots.has(Number(slot)) && Number(hp) > 0
      )
        .sort((left, right) =>
          Number(passiveTraineeSlots.has(Number(left.slot))) - Number(passiveTraineeSlots.has(Number(right.slot))) ||
          Number(right.hp) / Math.max(1, Number(right.maxHp)) -
            Number(left.hp) / Math.max(1, Number(left.maxHp)) ||
          Number(right.level ?? 0) - Number(left.level ?? 0)
        )[0] ?? null
    : null;
  if (hmSupportSwitch && recoveryPlan?.objective !== "revive-party-member") {
    recoveryPlan = null;
  }
  if (outclassedRecoveryTarget && recoveryPlan?.objective === "restore-active-pokemon") {
    recoveryPlan = null;
  }
  if (majorBattle && matchupSwitch && recoveryPlan?.objective === "restore-active-pokemon") {
    // Compare against a healed active Pokémon: low HP alone must not persuade
    // us to spend a switch turn. The reserve must also survive the incoming hit.
    const healedMatchup = partyMatchupPlan({
        observation,
      mechanics,
      party: [{...activeSafetyMember, hp: activeSafetyMember.maxHp}, matchupSwitch],
      opponentSpecies: battle?.opponent?.species,
      opponentBattle: battle?.opponent,
      activeSpecies: battle?.player?.species,
    });
    const incoming = maximumCredibleIncomingDamage({
      mechanics, attacker: battle?.opponent, defender: matchupSwitch,
    });
    if (healedMatchup?.best?.member === matchupSwitch &&
        matchupIsMateriallyBetter(healedMatchup, 1.35) && incoming !== null &&
        incoming < Number(matchupSwitch.hp)) recoveryPlan = null;
  }
  if (forcedReplacementMember) {
    return proposal({
      advisor: "battle",
      observation,
      recommendation: {
        kind: "choose-party-member",
        targetPartySlot: forcedReplacementMember.slot,
        targetSpecies: forcedReplacementMember.species,
        objective: "replace-fainted-pokemon",
      },
      confidence: 0.999,
      constraints: ["fainted-active-pokemon", "usable-reserve"],
      evidenceRefs: [
        `cartridge:fainted-active-species:${battle.player.species}`,
        `cartridge:party-slot:${forcedReplacementMember.slot}:species:${forcedReplacementMember.species}`,
        `cartridge:opponent-species:${battle?.opponent?.species ?? "unknown"}`,
      ],
    });
  }
  if (ui.party?.stage === "choose-pokemon" && perishEscapeTarget) {
    return proposal({
      advisor: "battle",
      observation,
      recommendation: {
        kind: "choose-party-member",
        targetPartySlot: perishEscapeTarget.slot,
        targetSpecies: perishEscapeTarget.species,
        objective: "escape-perish-song",
      },
      confidence: 0.999,
      constraints: ["perish-song-zero", "legal-switch", "usable-reserve"],
      evidenceRefs: [
        "cartridge:status3:perish-song",
        `cartridge:party-slot:${perishEscapeTarget.slot}:species:${perishEscapeTarget.species}`,
      ],
    });
  }
  if (ui.party?.stage === "choose-pokemon" && reviveSupport) {
    return proposal({
      advisor: "battle",
      observation,
      recommendation: {
        kind: "choose-party-member",
        targetPartySlot: reviveSupport.slot,
        targetSpecies: reviveSupport.species,
        objective: "deploy-revive-support",
      },
      confidence: 0.999,
      constraints: [
        "important-battle",
        "fainted-combat-member",
        "healthy-utility-support",
        "owned-revive",
      ],
      evidenceRefs: [
        `cartridge:item:${ownedReviveItem}`,
        `cartridge:fainted-party-slot:${faintedCombatMember.slot}`,
        `cartridge:party-slot:${reviveSupport.slot}:species:${reviveSupport.species}`,
      ],
    });
  }
  const selectedPartyItemId = Number(ui.party?.itemId);
  const partySelectingRecoveryTarget =
    ACTIVE_BATTLE_RECOVERY_ITEMS.has(selectedPartyItemId) ||
    BATTLE_REVIVE_ITEMS.has(selectedPartyItemId);
  if (ui.party && recoveryPlan && partySelectingRecoveryTarget) {
    const selectedItemId = selectedPartyItemId;
    const target = [24, 25].includes(selectedItemId)
      ? recoveryPlan.target ?? (memory?.trainer?.party ?? []).find(({ hp, maxHp }) =>
          Number(maxHp) > 0 && Number(hp) === 0
        )
      : recoveryPlan.target;
    if (target) {
      return proposal({
        advisor: "battle",
        observation,
        recommendation: {
          kind: "choose-party-member",
          targetPartySlot: target.slot,
          targetSpecies: target.species,
          objective: recoveryPlan.objective,
        },
        confidence: 0.999,
        constraints: ["trainer-battle-recovery", "observed-party-target"],
        evidenceRefs: [
          `cartridge:item:${selectedItemId}`,
          `cartridge:party-slot:${target.slot}:species:${target.species}`,
        ],
      });
    }
  }
  if (ui.bag && recoveryPlan) {
    let recommendation = null;
    if (ui.bag.stage === "context") {
      recommendation = Number(ui.bag.selectedItemId) === recoveryPlan.itemId
        ? {
            kind: "choose-bag-context-action",
            targetAction: "use",
            targetIndex: 0,
            objective: recoveryPlan.objective,
          }
        : { kind: "close-menu", objective: recoveryPlan.objective };
    } else if (ui.bag.stage === "list") {
      if (Number(ui.bag.pocket) !== 0) {
        recommendation = {
          kind: "choose-bag-pocket",
          targetPocket: 0,
          objective: recoveryPlan.objective,
        };
      } else {
        const targetIndex = (memory?.trainer?.bag?.items ?? []).findIndex(
          ({ itemId }) => Number(itemId) === recoveryPlan.itemId,
        );
        if (targetIndex >= 0) {
          recommendation = {
            kind: "choose-bag-item",
            targetItemId: recoveryPlan.itemId,
            targetIndex,
            objective: recoveryPlan.objective,
          };
        }
      }
    }
    if (recommendation) {
      return proposal({
        advisor: "battle",
        observation,
        recommendation,
        confidence: 0.999,
        constraints: ["trainer-battle-recovery", "observed-bag-state"],
        evidenceRefs: [
          `cartridge:item:${recoveryPlan.itemId}`,
          `cartridge:party-hp:${playerHp}/${playerMaxHp}`,
        ],
      });
    }
  }
  if (ui.party && captureSpecialist) {
    return proposal({
      advisor: "battle",
      observation,
      recommendation: {
        kind: "choose-party-member",
        targetPartySlot: captureSpecialist.member.slot,
        targetSpecies: captureSpecialist.member.species,
        objective: captureSpecialistObjective,
      },
      confidence: 0.999,
      constraints: [
        captureEncounter ? "requested-wild-species" : "uncaught-pokedex-species",
        "safe-capture-specialist",
        "increase-capture-probability",
      ],
      evidenceRefs: [
        `cartridge:opponent-species:${opponentSpecies}`,
        `cartridge:party-slot:${captureSpecialist.member.slot}:species:${captureSpecialist.member.species}`,
        `cartridge:move:${captureSpecialist.preparation.moveId}`,
      ],
    });
  }
  if (ui.party && battle?.announcedOpponentName && trainingMember) {
    return proposal({
      advisor: "battle",
      observation,
      recommendation: trainingMemberIsActive
        ? {
            kind: "retain-active-pokemon",
            announcedOpponentName: battle.announcedOpponentName,
            observedCursorSpecies: ui.party.cursorPokemon?.species ?? null,
          }
        : {
            kind: "choose-party-member",
            targetPartySlot: trainingMember.slot,
            targetSpecies: trainingMember.species,
            objective: "train-team-anchor",
          },
      confidence: 0.999,
      constraints: [
        trainingSourceConstraint(trainingObjective),
        "new-opponent-training-participation",
      ],
      evidenceRefs: [
        `cartridge:battle-message:${battle.announcedOpponentName}`,
        `cartridge:party-slot:${trainingMember.slot}:species:${trainingMember.species}`,
      ],
    });
  }
  if (
    ui.party &&
    trainingMember &&
    trainingMemberIsActive &&
    trainingMemberNeedsProtection &&
    trainingEscort
  ) {
    return proposal({
      advisor: "battle",
      observation,
      recommendation: {
        kind: "choose-party-member",
        targetPartySlot: trainingEscort.slot,
        targetSpecies: trainingEscort.species,
        objective: "protect-training-member",
      },
      confidence: 0.997,
      constraints: trainingProtectionConstraints,
      evidenceRefs: trainingProtectionEvidence,
    });
  }
  if (
    ui.party &&
    trainingMemberNeedsParticipation &&
    trainingParticipationSwitchSafe
  ) {
    return proposal({
      advisor: "battle",
      observation,
      recommendation: {
        kind: "choose-party-member",
        targetPartySlot: trainingMember.slot,
        targetSpecies: trainingMember.species,
        objective: "train-team-anchor",
      },
      confidence: 0.995,
      constraints: [
        trainingSourceConstraint(trainingObjective),
        "usable-target-member",
      ],
      evidenceRefs: [
        `campaign:preparation-for:${trainingObjective.forObjective}`,
        `cartridge:party-slot:${trainingMember.slot}:species:${trainingMember.species}`,
      ],
    });
  }
  if (ui.party && !battle?.announcedOpponentName && matchupSwitch) {
    return proposal({
      advisor: "battle",
      observation,
      recommendation: {
        kind: "choose-party-member",
        targetPartySlot: matchupSwitch.slot,
        targetSpecies: matchupSwitch.species,
        objective: matchupSwitchObjective,
      },
      confidence: 0.99,
      constraints: matchupSwitchConstraints,
      evidenceRefs: [
        `cartridge:opponent-species:${battle.opponent.species}`,
        `cartridge:party-slot:${matchupSwitch.slot}:species:${matchupSwitch.species}`,
      ],
    });
  }
  const announcedSpecies = speciesIdForBattleName(
    mechanics,
    battle?.announcedOpponentName,
  );
  const observedAnnouncedOpponent = majorBattle && announcedSpecies
    ? battle?.enemyParty?.find(member => Number(member.species) === announcedSpecies && Number(member.hp) > 0)
    : null;
  const announcedOpponent = announcedSpecies
    ? observedAnnouncedOpponent ?? { ...battle?.opponent, species: announcedSpecies }
    : null;
  const announcedMatchupParty = announcedOpponent
    ? (memory?.trainer?.party ?? []).filter((member) => {
        const slot = Number(member.slot);
        if (
          unavailablePlayerPartySlots.has(slot) &&
          slot !== observedPlayerPartySlot
        ) return false;
        if (passiveTraineeSlots.has(slot) && slot !== observedPlayerPartySlot) return false;
        const safety = partyMemberMatchupSafety({
          mechanics,
          member,
          opponent: announcedOpponent,
        });
        return safety.safe && !safety.onlyResistedDamagingMoves;
      })
    : [];
  const announcedMatchup = announcedSpecies
    ? partyMatchupPlan({
        observation,
        mechanics,
        party: announcedMatchupParty,
        freeShift: true,
        opponentSpecies: announcedSpecies,
        ...(observedAnnouncedOpponent ? {opponentBattle: observedAnnouncedOpponent} : {}),
        activeSpecies: battle?.player?.species,
      })
    : null;
  // A free shift takes the member that wins its race against the announced
  // opponent (from the live enemy party), keeping a sole answer to a later
  // opponent in reserve. Every member it keeps or brings in wins that race,
  // and a paid turn never pays to replace a winner, so a shift is not undone.
  const announcedEnemy = singlesBattle && isTrainerBattle && announcedSpecies && !trainingMember
    ? (battle?.enemyParty ?? []).filter((member) =>
        Number(member.species) === announcedSpecies && Number(member.hp) > 0 &&
        Number(member.slot) !== Number(battle?.battlerPartyIndexes?.[1]) &&
        (member.validity == null || member.validity === "valid"))
        .sort((left, right) => Number(left.slot) - Number(right.slot))[0] ?? null
    : null;
  const announcedActive = announcedEnemy
    ? livingRaceMembers.find((member) => Number(member.slot) === observedPlayerPartySlot) ?? null
    : null;
  const announcedActiveRace = announcedActive
    ? battleKoRace({ mechanics, member: announcedActive, opponent: announcedEnemy, weather: battleWeather })
    : null;
  const announcedRacePlan = announcedActiveRace
    ? planBattleCounters({ mechanics, weather: battleWeather, opponent: announcedEnemy,
        members: livingRaceMembers.filter((member) => !obedienceRisk(member, observation) &&
          !passiveTraineeSlots.has(Number(member.slot)) &&
          (!unavailablePlayerPartySlots.has(Number(member.slot)) ||
            Number(member.slot) === observedPlayerPartySlot)),
        counterPool: livingRaceMembers,
        remaining: remainingBattleOpponents({ mechanics, battle })
          .filter((member) => Number(member.slot) !== Number(announcedEnemy.slot)) })
    : null;
  // The shift itself is free, so a comfortable winner is worth taking over a
  // narrowly winning active member; a comfortable active member stays.
  const announcedRaceChoice = announcedRacePlan
    ? (() => {
        const reserved = announcedRacePlan.reserved;
        const obedient = !obedienceRisk(activePartyMemberForRole, observation) && !passiveTraineeActive;
        const unreservedComfortable = announcedRacePlan.ranked.some(({ member, race }) =>
          !reserved.has(Number(member.slot)) && raceIsComfortable(race));
        if (obedient && raceIsComfortable(announcedActiveRace) &&
            !(reserved.has(observedPlayerPartySlot) && unreservedComfortable)) return { retain: true };
        const best = announcedRacePlan.ranked[0];
        if (!best) return null;
        if (Number(best.member.slot) === observedPlayerPartySlot) return { retain: true };
        if (raceIsComfortable(best.race) || !announcedActiveRace.wins || !obedient) return { member: best.member };
        return { retain: true };
      })()
    : null;
  // An active passive trainee always yields the free shift to a fighter.
  const passiveShiftTarget = passiveTraineeActive && announcedSpecies
    ? partyMatchupPlan({ observation, mechanics, freeShift: true, opponentSpecies: announcedSpecies,
        party: announcedMatchupParty.filter(({ slot }) => Number(slot) !== observedPlayerPartySlot),
        ...(announcedEnemy ? { opponentBattle: announcedEnemy } : {}), activeSpecies: null })?.best?.member ??
      (memory?.trainer?.party ?? []).filter(({ slot, hp }) => Number(hp) > 0 &&
        !unavailablePlayerPartySlots.has(Number(slot)) && !passiveTraineeSlots.has(Number(slot)))
        .sort((left, right) => Number(right.hp) - Number(left.hp) || Number(left.slot) - Number(right.slot))[0] ?? null
    : null;
  const announcedShiftTarget = passiveTraineeActive
    ? announcedRaceChoice?.member ?? passiveShiftTarget
    : announcedRaceChoice
    ? announcedRaceChoice.member ?? null
    : announcedMatchup?.best &&
        Number(announcedMatchup.best.member.species) !== Number(battle?.player?.species) &&
        matchupIsMateriallyBetter(announcedMatchup, 1.15)
      ? announcedMatchup.best.member
      : null;
  const announcedShiftConstraints = announcedRaceChoice
    ? ["free-shift", "wins-ko-race-against-announced-opponent"]
    : ["free-shift", "source-backed-type-matchup"];
  if (ui.party?.stage === "selection-menu") {
    const selectedPartySlot = Number(ui.party.selectedPartySlot);
    const selectedPokemonIsActive = Number.isSafeInteger(selectedPartySlot) &&
      (battle?.activePlayerPartySlots ?? [battle?.playerPartySlot])
        .map(Number)
        .includes(selectedPartySlot);
    return proposal({
      advisor: "battle",
      observation,
      recommendation: selectedPokemonIsActive
        ? {
            kind: "retain-active-pokemon",
            announcedOpponentName: battle?.announcedOpponentName ?? null,
            observedCursorSpecies: ui.party.cursorPokemon?.species ?? null,
          }
        : {
            kind: "choose-menu-option",
            targetIndex: 0,
            objective: "confirm-battle-party-action",
          },
      confidence: 0.999,
      constraints: selectedPokemonIsActive
        ? ["selected-pokemon-is-already-active"]
        : ["source-observed-party-action-menu"],
      evidenceRefs: [
        `cartridge:party-action:${ui.party.action ?? "unknown"}`,
        `cartridge:party-slot:${ui.party.selectedPartySlot ?? "unknown"}`,
      ],
    });
  }
  if (ui.party && battle?.announcedOpponentName && battle?.player?.hp > 0) {
    if (announcedShiftTarget) {
      const target = announcedShiftTarget;
      return proposal({
        advisor: "battle",
        observation,
        recommendation: {
          kind: "choose-party-member",
          targetPartySlot: target.slot,
          targetSpecies: target.species,
          objective: "counter-announced-opponent",
        },
        confidence: 0.99,
        constraints: announcedShiftConstraints,
        evidenceRefs: [
          `cartridge:battle-message:${battle.announcedOpponentName}`,
          `cartridge:party-slot:${target.slot}:species:${target.species}`,
        ],
      });
    }
    return proposal({
      advisor: "battle",
      observation,
      recommendation: {
        kind: "retain-active-pokemon",
        announcedOpponentName: battle.announcedOpponentName,
        observedCursorSpecies: ui.party.cursorPokemon?.species ?? null,
      },
      confidence: 0.97,
      constraints: ["opponent-announcement-is-observed"],
      evidenceRefs: [
        `cartridge:battle-message:${battle.announcedOpponentName}`,
        `cartridge:active-species:${battle.player.species}`,
      ],
    });
  }
  if (ui.choiceMenu && battle?.announcedOpponentName) {
    const trainingShiftTarget = trainingMember &&
        !trainingMemberIsActive && !trainingMemberIsReserved
      ? trainingMember
      : null;
    const matchupShiftTarget = !trainingMember ? announcedShiftTarget : null;
    const shiftTarget = trainingShiftTarget ?? matchupShiftTarget;
    return proposal({
      advisor: "battle",
      observation,
      recommendation: {
        kind: "choose-menu-option",
        targetOption: shiftTarget ? "yes" : "no",
        ...(shiftTarget ? {
          targetPartySlot: shiftTarget.slot,
          targetSpecies: shiftTarget.species,
          objective: trainingShiftTarget
            ? "train-team-anchor"
            : "counter-announced-opponent",
        } : {}),
      },
      confidence: 0.95,
      constraints: ["retain-active-pokemon"],
      evidenceRefs: [`cartridge:battle-message:${battle.announcedOpponentName}`],
    });
  }
  if (
    ui.battle?.stage === "target" &&
    Number.isSafeInteger(ui.battle.cursor)
  ) {
    const selectedMoveId = Number(ui.battle.selectedMoveId);
    const scoredTarget = selectedMoveId > 0
      ? damagingCandidates.find(({ moveId }) => Number(moveId) === selectedMoveId)
      : null;
    const observedTarget = battle?.opponents?.find(({ battler }) =>
      Number(battler) === Number(ui.battle.cursor)
    );
    const targetBattler = Number.isSafeInteger(scoredTarget?.targetBattler)
      ? scoredTarget.targetBattler
      : ui.battle.cursor;
    const targetSpecies = scoredTarget?.targetSpecies ??
      observedTarget?.species ?? ui.battle.selectedSpecies ?? null;
    return proposal({
      advisor: "battle",
      observation,
      recommendation: {
        kind: "confirm-battle-target",
        targetBattler,
        targetSpecies,
      },
      confidence: 0.999,
      constraints: ["cartridge-selected-legal-target"],
      evidenceRefs: [
        `cartridge:battle-target:${targetBattler}`,
        `cartridge:target-species:${targetSpecies ?? "unknown"}`,
      ],
    });
  }
  if (ui.battle?.stage === "action") {
    if (
      battleLegality.run.unidentifiedGhost &&
      battleLegality.run.allowed
    ) {
      return proposal({
        advisor: "battle",
        observation,
        recommendation: {
          kind: "choose-battle-command",
          targetCommand: "run",
          objective: "escape-unidentified-ghost",
        },
        confidence: 1,
        constraints: ["unidentified-ghost", "silph-scope-required"],
        evidenceRefs: [
          `cartridge:battle-type-flags:${memory?.battleTypeFlags}`,
          "cartridge:battle-type:ghost-without-scope",
        ],
      });
    }
    if (perishEscapeTarget) {
      return proposal({
        advisor: "battle",
        observation,
        recommendation: {
          kind: "choose-battle-command",
          targetCommand: "pokemon",
          objective: "escape-perish-song",
          targetPartySlot: perishEscapeTarget.slot,
        },
        confidence: 0.999,
        constraints: ["perish-song-zero", "legal-switch", "usable-reserve"],
        evidenceRefs: [
          "cartridge:status3:perish-song",
          `cartridge:perish-song-turns:${battle.player.moveState.perishSongTurns}`,
        ],
      });
    }
    if (reviveSupport) {
      return proposal({
        advisor: "battle",
        observation,
        recommendation: {
          kind: "choose-battle-command",
          targetCommand: "pokemon",
          objective: "deploy-revive-support",
          targetPartySlot: reviveSupport.slot,
        },
        confidence: 0.999,
        constraints: [
          "important-battle",
          "fainted-combat-member",
          "healthy-utility-support",
          "owned-revive",
        ],
        evidenceRefs: [
          `cartridge:item:${ownedReviveItem}`,
          `cartridge:fainted-party-slot:${faintedCombatMember.slot}`,
          `cartridge:party-slot:${reviveSupport.slot}:species:${reviveSupport.species}`,
        ],
      });
    }
    if (
      battleLegality.switch.allowed &&
      trainingMemberNeedsProtection &&
      trainingEscort
    ) {
      return proposal({
        advisor: "battle",
        observation,
        recommendation: {
          kind: "choose-battle-command",
          targetCommand: "pokemon",
          objective: "protect-training-member",
          targetPartySlot: trainingEscort.slot,
        },
        confidence: 0.999,
        constraints: trainingProtectionConstraints,
        evidenceRefs: trainingProtectionEvidence,
      });
    }
    if (isCaptureHunt && Number(memory?.battleTypeFlags) === SAFARI_BATTLE_FLAGS) {
      return proposal({
        advisor: "battle",
        observation,
        recommendation: captureEncounter
          ? {
              kind: "choose-safari-command",
              targetAction: "ball",
              targetIndex: 0,
              objective: `capture-${storyObjective.id}`,
            }
          : {
              kind: "choose-battle-command",
              targetCommand: "run",
              objective: `seek-${storyObjective.id}`,
            },
        confidence: 0.999,
        constraints: ["safari-battle", "requested-wild-species"],
        evidenceRefs: [
          `campaign:objective:${storyObjective.id}`,
          `cartridge:opponent-species:${battle?.opponent?.species}`,
        ],
      });
    }
    if (safariPokedexCapture) {
      return proposal({
        advisor: "battle",
        observation,
        recommendation: {
          kind: "choose-safari-command",
          targetAction: "ball",
          targetIndex: 0,
          objective: captureObjective,
        },
        confidence: 0.999,
        constraints: ["safari-battle", "uncaught-pokedex-species"],
        evidenceRefs: [
          `cartridge:opponent-species:${opponentSpecies}`,
          `cartridge:pokedex-owned-count:${ownedSpecies.length}`,
        ],
      });
    }
    if (isCaptureHunt && isCapturableWildBattle(memory?.battleTypeFlags)) {
      const trainOffTargetEncounter = !captureEncounter && trainingMember;
      if (!trainOffTargetEncounter) {
        return proposal({
          advisor: "battle",
          observation,
          recommendation: captureEncounter && hasCaptureBall
            ? captureSpecialist
              ? {
                  kind: "choose-battle-command",
                  targetCommand: "pokemon",
                  targetPartySlot: captureSpecialist.member.slot,
                  objective: captureSpecialistObjective,
                }
              : capturePreparation
              ? {
                  kind: "choose-battle-command",
                  targetCommand: "fight",
                  objective: capturePreparationObjective,
                }
              : {
                  kind: "choose-battle-command",
                  targetCommand: "bag",
                  objective: captureObjective,
                }
            : battleLegality.run.allowed
              ? {
                kind: "choose-battle-command",
                targetCommand: "run",
                objective: `seek-${storyObjective.id}`,
              }
              : {
                kind: "choose-battle-command",
                targetCommand: "fight",
                objective: "resolve-capture-escape-block",
              },
          confidence: 0.999,
          constraints: ["normal-wild-battle", "requested-wild-species"],
          evidenceRefs: [
            `campaign:objective:${storyObjective.id}`,
            `cartridge:opponent-species:${battle?.opponent?.species}`,
          ],
        });
      }
    }
    if (normalPokedexCapture) {
      return proposal({
        advisor: "battle",
        observation,
        recommendation: captureSpecialist
          ? {
              kind: "choose-battle-command",
              targetCommand: "pokemon",
              targetPartySlot: captureSpecialist.member.slot,
              objective: captureSpecialistObjective,
            }
          : capturePreparation
            ? {
                kind: "choose-battle-command",
                targetCommand: "fight",
                objective: capturePreparationObjective,
              }
            : {
                kind: "choose-battle-command",
                targetCommand: "bag",
                objective: captureObjective,
              },
        confidence: 0.998,
        constraints: [
          "normal-wild-battle",
          "uncaught-pokedex-species",
          "capture-ball-reserve-preserved",
        ],
        evidenceRefs: [
          `cartridge:opponent-species:${opponentSpecies}`,
          `cartridge:pokedex-owned-count:${ownedSpecies.length}`,
          `cartridge:poke-balls:${totalOwnedBalls}:reserve:${ballReserve}`,
        ],
      });
    }
    if (Number(memory?.battleTypeFlags) === SAFARI_BATTLE_FLAGS) {
      return proposal({
        advisor: "battle",
        observation,
        recommendation: {
          kind: "choose-battle-command",
          targetCommand: "run",
          objective: "leave-safari-encounter",
        },
        confidence: 0.999,
        constraints: ["safari-battle", "preserve-safari-steps"],
        evidenceRefs: ["cartridge:battle-type:safari"],
      });
    }
    // Finish an opponent already worn down, or a fresh one the active member
    // knocks out before it can act: no switch or medicine beats that race.
    if (finishingMove && (opponentHp < Number(battle?.opponent?.maxHp) || finishingMove.actsFirst)) {
      return proposal({advisor:'battle',observation,
        recommendation:{kind:'choose-battle-command',targetCommand:'fight',objective:'finish-current-opponent'},
        confidence:0.99,constraints:['legal-accurate-attack','remaining-hp-damage-estimate','safe-action-order'],
        evidenceRefs:[`cartridge:move:${finishingMove.moveId}`,`cartridge:opponent-hp:${opponentHp}`]});
    }
    if (recoveryPlan) {
      return proposal({
        advisor: "battle",
        observation,
        recommendation: {
          kind: "choose-battle-command",
          targetCommand: "bag",
          objective: recoveryPlan.objective,
        },
        confidence: 0.999,
        constraints: ["trainer-battle-recovery", "owned-recovery-item"],
        evidenceRefs: [
          `cartridge:item:${recoveryPlan.itemId}`,
          `cartridge:party-hp:${playerHp}/${playerMaxHp}`,
        ],
      });
    }
    if (safeTrainingKnockout) {
      return proposal({
        advisor: "battle",
        observation,
        recommendation: {
          kind: "choose-battle-command",
          targetCommand: "fight",
          objective: "safe-training-knockout",
        },
        confidence: 0.998,
        constraints: [
          trainingSourceConstraint(trainingObjective),
          "cartridge-proven-participation",
          "healthy-training-member",
          "high-confidence-knockout-margin",
        ],
        evidenceRefs: [
          `cartridge:sent-party-mask:${sentPartyMasks.join(",")}`,
          `cartridge:move:${bestTrainingDamage.moveId}`,
          `cartridge:best-damage-utility:${bestTrainingDamage.score}`,
          `cartridge:opponent-hp:${opponentHp}`,
        ],
      });
    }
    if (
      battleLegality.switch.allowed &&
      trainingMember &&
      trainingMemberNeedsParticipation &&
      trainingParticipationSwitchSafe
    ) {
      return proposal({
        advisor: "battle",
        observation,
        recommendation: {
          kind: "choose-battle-command",
          targetCommand: "pokemon",
          objective: "train-team-anchor",
          targetPartySlot: trainingMember.slot,
        },
        confidence: 0.995,
        constraints: [
          trainingSourceConstraint(trainingObjective),
          "usable-target-member",
        ],
        evidenceRefs: [
          `campaign:preparation-for:${trainingObjective.forObjective}`,
          `cartridge:party-slot:${trainingMember.slot}:species:${trainingMember.species}`,
        ],
      });
    }
    if (matchupSwitch) {
      return proposal({
        advisor: "battle",
        observation,
        recommendation: {
          kind: "choose-battle-command",
          targetCommand: "pokemon",
          objective: matchupSwitchObjective,
          targetPartySlot: matchupSwitch.slot,
        },
        confidence: 0.99,
        constraints: matchupSwitchConstraints,
        evidenceRefs: [
          `cartridge:opponent-species:${battle.opponent.species}`,
          `cartridge:party-slot:${matchupSwitch.slot}:species:${matchupSwitch.species}`,
        ],
      });
    }
    const escapeIsBlocked =
      shouldPreserveRecoveryResources && !battleLegality.run.allowed;
    return proposal({
      advisor: "battle",
      observation,
      recommendation: escapeIsBlocked
        ? {
            kind: "choose-battle-command",
            targetCommand: "fight",
            objective: "resolve-escape-block",
          }
        : shouldPreserveRecoveryResources
        ? {
            kind: "choose-battle-command",
            targetCommand: "run",
            objective: "preserve-recovery-resources",
          }
        : { kind: "choose-battle-command", targetCommand: "fight" },
      confidence: 0.99,
      constraints: [
        "legal-cartridge-command",
        ...(escapeIsBlocked ? battleLegality.run.blockers : []),
        ...(shouldPreserveRecoveryResources ? ["normal-wild-battle"] : []),
      ],
      evidenceRefs: [
        "cartridge:battle-action-menu",
        ...(shouldPreserveRecoveryResources
          ? [`cartridge:party-hp:${playerHp}/${playerMaxHp}`]
          : []),
      ],
    });
  }
  if (ui.battle?.stage === "move" && battle?.player && battle?.opponent) {
    if (capturePreparation) {
      return proposal({
        advisor: "battle",
        observation,
        recommendation: {
          kind: "choose-battle-move",
          targetMoveId: capturePreparation.moveId,
          targetMoveSlot: capturePreparation.moveSlot,
          objective: `${capturePreparation.kind}-${captureObjective}`,
          ...(capturePreparation.kind === "weaken"
            ? {
                maximumCriticalDamage:
                  capturePreparation.maximumCriticalDamage,
              }
            : {}),
        },
        confidence: 0.999,
        constraints: [
          captureEncounter ? "requested-wild-species" : "uncaught-pokedex-species",
          capturePreparation.kind === "status"
            ? "increase-capture-probability"
            : "critical-hit-safe-capture-damage",
          "positive-pp",
        ],
        evidenceRefs: [
          captureEncounter
            ? `campaign:objective:${storyObjective.id}`
            : `pokedex:uncaught-species:${opponentSpecies}`,
          `cartridge:opponent-hp:${battle.opponent.hp}/${battle.opponent.maxHp}`,
          `cartridge:move:${capturePreparation.moveId}`,
        ],
      });
    }
    if (
      battleLegality.run.unidentifiedGhost &&
      battleLegality.run.allowed
    ) {
      return proposal({
        advisor: "battle",
        observation,
        recommendation: {
          kind: "cancel-battle-move-for-run",
          objective: "escape-unidentified-ghost",
        },
        confidence: 1,
        constraints: [
          "unidentified-ghost",
          "silph-scope-required",
          "return-to-action-menu",
        ],
        evidenceRefs: [
          `cartridge:battle-type-flags:${memory?.battleTypeFlags}`,
          "cartridge:battle-type:ghost-without-scope",
        ],
      });
    }
    if (shouldPreserveRecoveryResources && battleLegality.run.allowed) {
      return proposal({
        advisor: "battle",
        observation,
        recommendation: {
          kind: "cancel-battle-move-for-run",
          objective: "preserve-recovery-resources",
        },
        confidence: 0.995,
        constraints: ["normal-wild-battle", "return-to-action-menu"],
        evidenceRefs: [
          `cartridge:party-hp:${playerHp}/${playerMaxHp}`,
          `cartridge:damaging-moves-with-pp:${damagingCandidates.length}`,
        ],
      });
    }
    const firstRivalDefensiveSetup =
      memory?.map?.id === OAKS_LAB &&
      memory?.storyState?.variables?.[OAKS_LAB_SCENE] === 3 &&
      battle.player.species === 1 &&
      battle.player.level === 5 &&
      battle.opponent.species === 4 &&
      battle.opponent.level === 5;
    const opponentAttackStage = Number(battle.opponent.statStages?.attack);
    const growlSlot = battle.player.moves.indexOf(45);
    if (
      firstRivalDefensiveSetup &&
      opponentAttackStage > 4 &&
      growlSlot >= 0 &&
      selectableMoveSlots.has(growlSlot) &&
      Number(battle.player.pp?.[growlSlot] ?? 0) > 0
    ) {
      return proposal({
        advisor: "battle",
        observation,
        recommendation: {
          kind: "choose-battle-move",
          targetMoveId: 45,
          targetMoveSlot: growlSlot,
          objective: "lower-first-rival-attack",
          observedAttackStage: opponentAttackStage,
          targetAttackStage: 4,
        },
        confidence: 0.98,
        constraints: [
          "first-rival-defensive-plan",
          "observed-opponent-stat-stage",
          "positive-pp",
        ],
        evidenceRefs: [
          "cartridge:move:45",
          "cartridge:species:1",
          "cartridge:species:4",
          `cartridge:event-condition:${OAKS_LAB_SCENE}=3`,
        ],
      });
    }
    if (damagingCandidates.length === 0) {
      const support = selectSurvivalSupportMove({
        mechanics,
        player: battle.player,
        opponent: battle.opponent,
        selectableMoveSlots,
      });
      if (support) {
        return proposal({
          advisor: "battle",
          observation,
          recommendation: {
            kind: "choose-battle-move",
            targetMoveId: support.moveId,
            targetMoveSlot: support.moveSlot,
            objective: "survive-with-support-move",
          },
          confidence: 0.96,
          constraints: ["positive-pp", "trainer-battle-cannot-run"],
          evidenceRefs: [
            `cartridge:move:${support.moveId}`,
            `cartridge:opponent-status1:${battle.opponent.status1 ?? 0}`,
          ],
        });
      }
      const transformSlot=battle.player.moves.findIndex((id,slot)=>id===144&&battle.player.pp?.[slot]>0&&selectableMoveSlots.has(slot));
      if(transformSlot>=0&&selectableMoveSlots.size===1&&!battleLegality.run.allowed&&
          (Number(battle.opponent.status3)&((1<<6)|(1<<7)|(1<<18)))!==0){
        // There is no Wait command. With no switch/attack chosen above, the
        // only legal move must spend this turn so Fly/Dig/Dive can finish.
        return proposal({advisor:'battle',observation,
          recommendation:{kind:'choose-battle-move',targetMoveId:144,targetMoveSlot:transformSlot,objective:'wait-for-transform-target'},
          confidence:0.95,constraints:['only-selectable-move','cannot-run','target-temporarily-hidden'],
          evidenceRefs:[`cartridge:opponent-status3:${battle.opponent.status3}`,'cartridge:move:144']});
      }
    }
    if (finishingMove) {
      return proposal({advisor:'battle',observation,
        recommendation:{kind:'choose-battle-move',targetMoveId:finishingMove.moveId,
          targetMoveSlot:finishingMove.moveSlot,objective:'finish-current-opponent'},
        confidence:0.99,constraints:['positive-pp','legal-accurate-attack','remaining-hp-damage-estimate'],
        evidenceRefs:[`cartridge:move:${finishingMove.moveId}`,`cartridge:opponent-hp:${opponentHp}`]});
    }
    const control = isTrainerBattle
      ? selectTrainerControlMove({
          mechanics,
          player: battle.player,
          opponent: battle.opponent,
          damagingCandidates,
          selectableMoveSlots,
        })
      : null;
    if (control) {
      return proposal({
        advisor: "battle",
        observation,
        recommendation: {
          kind: "choose-battle-move",
          targetMoveId: control.moveId,
          targetMoveSlot: control.moveSlot,
          objective: "control-bulky-trainer-matchup",
        },
        confidence: 0.97,
        constraints: ["trainer-battle", "bulky-matchup", "positive-pp"],
        evidenceRefs: [
          `cartridge:move:${control.moveId}`,
          `cartridge:opponent-status1:${battle.opponent.status1 ?? 0}`,
          `cartridge:best-damage-utility:${damagingCandidates[0].score}`,
        ],
      });
    }
    const selected = damagingCandidates[0];
    if (selected) {
      const doubleTarget =
        (Number(memory?.battleTypeFlags) & BATTLE_TYPE_DOUBLE) !== 0 &&
        Number.isSafeInteger(selected.targetBattler)
          ? { targetBattler: selected.targetBattler }
          : {};
      return proposal({
        advisor: "battle",
        observation,
        recommendation: {
          kind: "choose-battle-move",
          targetMoveId: selected.moveId,
          targetMoveSlot: selected.moveSlot,
          expectedUtility: selected.score,
          ...doubleTarget,
        },
        confidence: 0.94,
        constraints: ["positive-pp", "observed-active-battlers"],
        evidenceRefs: selected.evidenceRefs,
      });
    }
  }
  if (["message", "level-up-stats"].includes(ui.battle?.stage)) {
    return proposal({
      advisor: "battle",
      observation,
      recommendation: { kind: "acknowledge-cartridge-prompt" },
      confidence: 0.99,
      constraints: ["one-edge-then-reobserve"],
      evidenceRefs: ["cartridge:battle-message-ready"],
    });
  }
  return null;
}

function inventoryAdvice(
  observation,
  mechanicsDocument,
  world,
  campaignPlanner,
  teamPlan = null,
) {
  const memory = observation.playerMemory;
  const ui = memory?.ui ?? {};
  // Battle owns every battle callback, including the party menu nested inside it.
  // Treating that menu as a field-party workflow can move the submenu cursor
  // instead of confirming the selected replacement Pokemon.
  if (observation.emulator?.mode === "battle") return null;
  const party = memory?.trainer?.party ?? [];
  const mechanics = dataOf(mechanicsDocument);
  const storyObjective = campaignPlanner?.select?.(observation) ?? null;
  // The save dialog overlays the start menu. Field medicine must wait until
  // the native save transaction finishes instead of trying to select the Bag.
  if (storyObjective?.target?.kind === "save-game" || storyObjective?.taskKind==='recovery') return null;
  // The active Tower run has its own lobby nurse. An outside free healer
  // abandons the challenge and resets its native floor progress.
  const activeTowerChallenge = storyObjective?.battleCategory === 'trainer-tower' &&
    memory?.storyState?.variableIds?.[0x4082] === 1 &&
    memory?.map?.id?.startsWith('MAP_TRAINER_TOWER_');
  const trainingObjective = storyObjective
    ? campaignTrainingObjective({
        campaignPlanner,
        world,
        observation,
        objective: storyObjective,
        teamPlan,
      })
    : null;
  const trainingMember = trainingObjective
    ? party.find(({ slot }) =>
        Number(slot) === Number(trainingObjective.trainingPartySlot)
      ) ?? null
    : null;
  const onTrainingMap = Boolean(
    trainingMember &&
    (
      trainingObjective?.trainingMode === "passive" ||
      memory?.map?.id === trainingObjective?.target?.map
    ),
  );
  const plannedEscortPartySlot = trainingObjective?.escortPartySlot;
  const plannedEscortSpecies = trainingObjective?.escortSpecies;
  const plannedTrainingEscort = trainingMember &&
      (plannedEscortPartySlot != null || plannedEscortSpecies != null)
    ? party.find((member) =>
        Number(member.slot) !== Number(trainingMember.slot) &&
        (plannedEscortPartySlot == null ||
          Number(member.slot) === Number(plannedEscortPartySlot)) &&
        (plannedEscortSpecies == null ||
          Number(member.species) === Number(plannedEscortSpecies))
      ) ?? null
    : null;
  const trainingEscort = plannedTrainingEscort ?? (trainingMember
    ? [...party]
        .filter(({ slot, hp }) =>
          Number(slot) !== Number(trainingMember.slot) && Number(hp) > 0
        )
        .sort((left, right) =>
          Number(right.level ?? 0) - Number(left.level ?? 0) ||
          Number(right.hp ?? 0) - Number(left.hp ?? 0)
        )[0] ?? null
    : null);
  const lowTrainingPartyMember = [trainingMember, trainingEscort]
    .filter(Boolean)
    .find(({ hp, maxHp }) =>
      Number(maxHp) > 0 && Number(hp) / Number(maxHp) <= 0.6
    ) ?? null;
  const lowTrainingAttackPp = [
    { role: "member", pokemon: trainingMember },
    { role: "escort", pokemon: trainingEscort },
  ].flatMap(({ role, pokemon }) => {
    if (!pokemon || !Array.isArray(pokemon.pp)) return [];
    const damagingMoves = (pokemon.moves ?? []).flatMap((moveId, moveSlot) => {
      const move = indexed(mechanics.moves, moveId);
      return move && Number(move.power) > 0
        ? [{ moveId, pp: Number(pokemon.pp[moveSlot] ?? 0), maximum:
            Number.isSafeInteger(move.pp) && move.pp > 0
              ? Math.floor(move.pp * (5 + ((Number(pokemon.ppBonuses ?? 0) >> (moveSlot * 2)) & 3)) / 5)
              : null }]
        : [];
    });
    return damagingMoves.length > 0
      ? [{
          role,
          total: damagingMoves.reduce((total, move) => total + move.pp, 0),
          maximum: damagingMoves.every(move => move.maximum !== null)
            ? damagingMoves.reduce((total, move) => total + move.maximum, 0) : null,
        }]
      : [];
  // Recovery must be satisfiable: a fully restored five-PP attack is not
  // depleted. Retain the ordinary reserve threshold for larger move pools.
  }).find(({ total, maximum }) => total <= (maximum === null ? 8 : Math.min(8, Math.floor(maximum / 2)))) ?? null;
  const currentHp = party.reduce((total, member) => total + Number(member.hp ?? 0), 0);
  const maximumHp = party.reduce(
    (total, member) => total + Number(member.maxHp ?? 0),
    0,
  );
  const hasFaintedMember = party.some(({ hp, maxHp }) =>
    Number(maxHp) > 0 && Number(hp) === 0
  );
  const trainingStatusMember = party.find(({ hp, status1 }) =>
    Number(hp) > 0 && Number(status1 ?? 0) !== 0
  ) ?? null;
  const nextTrainingTreatment = nextRecoveryTreatment(
    memory,
    mechanicsDocument,
  );
  const hasOwnedStatusTreatment = ["status", "full-restore"].includes(
    nextTrainingTreatment?.kind,
  );
  const needsTrainingRecovery = maximumHp > 0 && (
    currentHp / maximumHp <= 0.45 ||
    hasFaintedMember ||
    lowTrainingPartyMember ||
    lowTrainingAttackPp ||
    (trainingStatusMember && !hasOwnedStatusTreatment)
  );
  const rematchEntries = memory?.vsSeeker?.rematchEntries;
  const activeVsSeekerBatch = Boolean(
    trainingObjective?.trainingSource === "vs-seeker" &&
    trainingObjective?.vsSeekerAction === "battle" &&
    onTrainingMap &&
    Array.isArray(rematchEntries) &&
    rematchEntries.some((tier, localId) => localId > 0 && Number(tier) > 0)
  );
  const nextVsSeekerTreatment = activeVsSeekerBatch
    ? nextRecoveryTreatment(memory, mechanicsDocument)
    : null;
  const drainingVsSeekerRecoveryMessage =
    activeVsSeekerBatch && ui.party?.stage === "message";
  const canPlanFreeRecovery =
    !activeTowerChallenge &&
    observation.emulator?.mode === "overworld" &&
    !ui.party &&
    (needsTrainingRecovery || Boolean(trainingStatusMember));
  const recoveryObjective = canPlanFreeRecovery
    ? typeof campaignPlanner?.selectRecovery === "function"
      ? campaignPlanner.selectRecovery(observation)
      : selectRecoveryObjective({ world, observation })
    : null;
  const guardedRecoveryObjective = preparationWithStoryTriggerGuard(
    recoveryObjective,
    storyObjective,
  );
  const routedRecoveryRecommendation = guardedRecoveryObjective
    ? campaignNavigationRecommendation({
        world,
        observation,
        objective: guardedRecoveryObjective,
      })
    : null;
  const recoveryRecommendation = routedRecoveryRecommendation
    ? {
        ...routedRecoveryRecommendation,
        objective: lowTrainingPartyMember || lowTrainingAttackPp ||
            trainingStatusMember
          ? "recover-training-party"
          : routedRecoveryRecommendation.objective,
      }
    : null;
  const [recoveryTransitionDistance] = guardedRecoveryObjective
    ? campaignRegionTransitionDistances({
        world,
        observation,
        target: guardedRecoveryObjective.target,
        origins: [{ map: memory?.map?.id, position: memory?.position }],
      })
    : [];
  const freeRecoveryAdvice = ({ nearby = false } = {}) =>
    recoveryRecommendation
      ? proposal({
          advisor: "inventory",
          observation,
          recommendation: recoveryRecommendation,
          confidence: 0.99,
          constraints: [
            ...(trainingStatusMember
              ? ["training-party-status-cleared"]
              : ["critical-party-health"]),
            "nearest-reachable-cartridge-healer",
            ...(nearby
              ? ["nearby-free-healer", "preserve-field-medicine"]
              : []),
            "one-bounded-step-then-reobserve",
          ],
          evidenceRefs: [
            `cartridge:party-hp:${currentHp}/${maximumHp}`,
            ...(lowTrainingPartyMember ? [
              `cartridge:training-member-hp:${lowTrainingPartyMember.hp}/${lowTrainingPartyMember.maxHp}`,
            ] : []),
            ...(lowTrainingAttackPp ? [
              `cartridge:training-${lowTrainingAttackPp.role}-damaging-pp:${lowTrainingAttackPp.total}`,
            ] : []),
            ...(trainingStatusMember ? [
              `cartridge:training-status:${trainingStatusMember.slot}:${trainingStatusMember.status1}`,
            ] : []),
            `cartridge:healer-map:${recoveryObjective.target.map}`,
            `cartridge:free-healer-transitions:${recoveryTransitionDistance}`,
          ],
        })
      : null;
  if (
    Number.isSafeInteger(recoveryTransitionDistance) &&
    recoveryTransitionDistance <= LOCAL_FREE_HEALER_MAX_TRANSITIONS
  ) {
    const nearbyRecovery = freeRecoveryAdvice({ nearby: true });
    if (nearbyRecovery) return nearbyRecovery;
  }
  if (
    activeVsSeekerBatch &&
    (needsTrainingRecovery || drainingVsSeekerRecoveryMessage) &&
    (nextVsSeekerTreatment || drainingVsSeekerRecoveryMessage)
  ) {
    const itemRecovery = healWithItemsAdvice(
      observation,
      {
        id: "recover-vs-seeker-party",
        target: { kind: "heal-with-items" },
      },
      mechanicsDocument,
      {
        advisor: "inventory",
        confidence: 0.999,
        constraints: [
          "active-vs-seeker-response-batch",
          "preserve-map-local-rematches",
          "owned-field-recovery",
        ],
      },
    );
    if (itemRecovery) return itemRecovery;
  }
  const recoveryWorkflowItemId = Number(ui.party?.itemId);
  const partyRecoveryItemId = Number(ui.party?.itemId);
  const hasStatusTreatment = ["status", "full-restore"].includes(
    nextTrainingTreatment?.kind,
  );
  const continuingStatusWorkflow =
    isStatusRecoveryItem(partyRecoveryItemId) &&
    (partyRecoveryItemId !== 19 || Boolean(trainingStatusMember));
  if (
    hasStatusTreatment ||
    continuingStatusWorkflow
  ) {
    const statusRecovery = healWithItemsAdvice(
      observation,
      {
        id: "recover-training-status",
        target: { kind: "heal-with-items", statusOnly: true },
      },
      mechanicsDocument,
      {
        advisor: "inventory",
        confidence: 0.999,
        constraints: [
          ...(trainingObjective
            ? [trainingSourceConstraint(trainingObjective)]
            : []),
          "field-preparation",
          "owned-status-remedy",
        ],
      },
    );
    if (statusRecovery) return statusRecovery;
  }
  if (
    !trainingStatusMember &&
    (
      needsTrainingRecovery && nextTrainingTreatment ||
      isRecoveryItem(recoveryWorkflowItemId)
    )
  ) {
    const itemRecovery = healWithItemsAdvice(
      observation,
      {
        id: "recover-training-party-with-items",
        target: { kind: "heal-with-items" },
      },
      mechanicsDocument,
      {
        advisor: "inventory",
        confidence: 0.998,
        constraints: [
          ...(trainingObjective
            ? [trainingSourceConstraint(trainingObjective)]
            : []),
          "field-preparation",
          "owned-field-recovery",
          "avoid-healing-backtrack",
        ],
      },
    );
    if (itemRecovery) return itemRecovery;
  }
  if (
    needsTrainingRecovery
  ) {
    const recovery = freeRecoveryAdvice();
    if (recovery) return recovery;
  }
  if (onTrainingMap) {
    let recommendation = null;
    if (Number(trainingMember.slot) === 0) {
      if (ui.party || ui.startMenu) {
        recommendation = {
          kind: "close-menu",
          objective: "lead-with-training-member",
        };
      }
    } else if (ui.party?.stage === "choose-switch-target") {
      const currentLead = party.find(({ slot }) => Number(slot) === 0);
      if (currentLead) {
        recommendation = {
          kind: "choose-party-member",
          targetPartySlot: currentLead.slot,
          targetSpecies: currentLead.species,
          objective: "lead-with-training-member",
        };
      }
    } else if (ui.party?.stage === "selection-menu") {
      const targetIndex = ui.party.actions?.indexOf("switch") ?? -1;
      if (targetIndex >= 0) {
        recommendation = {
          kind: "choose-party-action",
          targetAction: "switch",
          targetIndex,
          objective: "lead-with-training-member",
        };
      }
    } else if (ui.party?.stage === "choose-pokemon") {
      recommendation = {
        kind: "choose-party-member",
        targetPartySlot: trainingMember.slot,
        targetSpecies: trainingMember.species,
        objective: "lead-with-training-member",
      };
    } else if (ui.startMenu) {
      const targetIndex = ui.startMenu.order?.indexOf("pokemon") ?? -1;
      if (targetIndex >= 0) {
        recommendation = {
          kind: "choose-start-menu-item",
          targetItem: "pokemon",
          targetIndex,
          objective: "lead-with-training-member",
        };
      }
    } else if (observation.emulator?.mode === "overworld") {
      recommendation = {
        kind: "open-start-menu",
        objective: "lead-with-training-member",
      };
    }
    if (recommendation) {
      return proposal({
        advisor: "inventory",
        observation,
        recommendation,
        confidence: 0.998,
        constraints: [
          trainingSourceConstraint(trainingObjective),
          "training-member-field-lead",
          "source-observed-party-order",
        ],
        evidenceRefs: [
          `campaign:preparation-for:${trainingObjective.forObjective}`,
          `cartridge:party-slot:${trainingMember.slot}:species:${trainingMember.species}`,
          `cartridge:training-map:${trainingObjective.target.map}`,
        ],
      });
    }
  }
  // Order the lead for the next major trainer battle from its static party:
  // a member that wins its KO race against the first opponent moves to the
  // front when the current lead does not. A training objective that owns the
  // lead keeps it (EXP Share support does not use the lead).
  const fieldMenusOnly = Object.entries(ui).every(([key, value]) =>
    !value || key === "startMenu" || key === "party" && !ui.party?.itemId);
  const majorLead = !(trainingMember && trainingObjective?.trainingMode !== "experience-share-only") &&
      !activeTowerChallenge && observation.emulator?.mode !== "battle" && fieldMenusOnly
    ? selectMajorBattleLead({ mechanics: mechanicsDocument, observation, objective: storyObjective, party })
    : null;
  if (majorLead) {
    const target = majorLead.member;
    let recommendation = null;
    if (!target) {
      if (ui.party || ui.startMenu) recommendation = { kind: "close-menu", objective: "lead-for-major-battle" };
    } else if (ui.party?.stage === "choose-switch-target") {
      const currentLead = party.find(({ slot }) => Number(slot) === 0);
      if (currentLead) {
        recommendation = {
          kind: "choose-party-member",
          targetPartySlot: currentLead.slot,
          targetSpecies: currentLead.species,
          objective: "lead-for-major-battle",
        };
      }
    } else if (ui.party?.stage === "selection-menu") {
      const targetIndex = ui.party.actions?.indexOf("switch") ?? -1;
      if (targetIndex >= 0) {
        recommendation = {
          kind: "choose-party-action",
          targetAction: "switch",
          targetIndex,
          objective: "lead-for-major-battle",
        };
      }
    } else if (ui.party?.stage === "choose-pokemon") {
      recommendation = {
        kind: "choose-party-member",
        targetPartySlot: target.slot,
        targetSpecies: target.species,
        objective: "lead-for-major-battle",
      };
    } else if (ui.startMenu) {
      const targetIndex = ui.startMenu.order?.indexOf("pokemon") ?? -1;
      if (targetIndex >= 0) {
        recommendation = {
          kind: "choose-start-menu-item",
          targetItem: "pokemon",
          targetIndex,
          objective: "lead-for-major-battle",
        };
      }
    } else if (observation.emulator?.mode === "overworld") {
      recommendation = { kind: "open-start-menu", objective: "lead-for-major-battle" };
    }
    if (recommendation) {
      return proposal({
        advisor: "inventory",
        observation,
        recommendation,
        confidence: 0.997,
        constraints: [
          "major-battle-lead",
          majorLead.passiveTrainee ? "passive-exp-share-trainee-never-leads"
            : target ? "lead-wins-ko-race-against-first-opponent" : "current-lead-wins-ko-race",
          "source-observed-party-order",
          "static-trainer-party",
        ],
        evidenceRefs: [
          ...majorLead.trainerNames.map((name) => `cartridge:trainer:${name}`),
          `cartridge:first-opponent-species:${majorLead.opponent?.species ?? "unknown"}`,
          ...(target ? [`cartridge:party-slot:${target.slot}:species:${target.species}`] : []),
        ],
      });
    }
  }
  if (
    !ui.party || ui.party.stage === "message" ||
    memory?.battle?.announcedOpponentName
  ) return null;
  const target = [...party]
    .filter(({ hp }) => hp > 0)
    .sort((left, right) =>
      (right.hp / Math.max(1, right.maxHp)) - (left.hp / Math.max(1, left.maxHp)) ||
      right.level - left.level || left.slot - right.slot
    )[0];
  if (!target) return null;
  return proposal({
    advisor: "inventory",
    observation,
    recommendation: {
      kind: "choose-party-member",
      targetPartySlot: target.slot,
      targetSpecies: target.species,
    },
    confidence: 0.85,
    constraints: ["usable-party-member"],
    evidenceRefs: [`cartridge:party-slot:${target.slot}:species:${target.species}`],
  });
}

function navigationAdvice(
  observation,
  maps,
  world,
  campaignPlanner,
  runProfile = DEFAULT_RUN_PROFILE,
  teamPlan = null,
) {
  const map = observation.playerMemory?.map?.id;
  const position = observation.playerMemory?.position;
  if (!map || !position || observation.emulator?.mode !== "overworld") return null;
  const labScene = observation.playerMemory?.storyState?.variables?.[OAKS_LAB_SCENE];
  const partyCount = Number(observation.playerMemory?.trainer?.partyCount ?? 0);
  const labStarter = labStarterObjective(runProfile);
  const configuredObjective = map === OAKS_LAB
    ? labScene === 2 && partyCount === 0
      ? labStarter
      : labScene === 3 && partyCount > 0
        ? OAKS_LAB_RIVAL_BATTLE
        : null
    // Opening routes stop owning the field once a Pokemon has been obtained.
    // Later visits (healing, errands or a blackout) belong to the active task.
    : partyCount === 0 ? SUPPORTED_NAVIGATION_OBJECTIVES[map] : null;
  const observedObjectiveVariable = configuredObjective?.eventVariable
    ? observation.playerMemory?.storyState?.variables?.[configuredObjective.eventVariable]
    : undefined;
  const objective = observedObjectiveVariable !== undefined &&
      String(observedObjectiveVariable) !== String(configuredObjective.eventValue)
    ? null
    : configuredObjective;
  const mapKnowledge = currentMapKnowledge(maps.get(map), observation);
  const objectRoute = objective?.objectScript
    ? routeToObjectEvent(mapKnowledge, position, objective)
    : null;
  if (objectRoute) {
    const objectEvent = objectRoute.objectEvent;
    const targetObject = {
      x: objectEvent.x,
      y: objectEvent.y,
      localId: objectEvent.local_id,
      script: objectEvent.script,
    };
    const objectEvidence = [
      `cartridge:map:${map}`,
      `cartridge:layout:${mapKnowledge.layout.id}:${mapKnowledge.layout.blockDataSha256}`,
      `cartridge:object-event:${map}:${objectEvent.x},${objectEvent.y}:${objectEvent.script}`,
      `strategy:starter:${objective.species}:early-campaign`,
    ];
    if (objectRoute.distance > 0) {
      return proposal({
        advisor: "navigation",
        observation,
        recommendation: {
          kind: "move-toward",
          direction: objectRoute.direction,
          ...(objectRoute.pathSegment
            ? { pathSegment: objectRoute.pathSegment }
            : {}),
          ...(objectRoute.routePlan
            ? { routePlan: objectRoute.routePlan }
            : {}),
          objective: objective.id,
          targetObject,
          remainingSteps: objectRoute.distance,
        },
        confidence: 0.97,
        constraints: [
          "cartridge-object-approach",
          "one-bounded-step-then-reobserve",
        ],
        evidenceRefs: objectEvidence,
      });
    }
    return proposal({
      advisor: "navigation",
      observation,
      recommendation: {
        kind: "interact-with-object",
        direction: objectRoute.interactionDirection,
        objective: objective.id,
        targetObject,
      },
      confidence: 0.99,
      constraints: [
        "face-before-interaction",
        "one-bounded-edge-then-reobserve",
      ],
      evidenceRefs: objectEvidence,
    });
  }
  const eventRoute = objective?.eventScripts
    ? routeToCoordinateEvent(mapKnowledge, position, objective)
    : null;
  if (eventRoute?.distance > 0) {
    const event = eventRoute.event;
    return proposal({
      advisor: "navigation",
      observation,
      recommendation: {
        kind: "move-toward",
        direction: eventRoute.direction,
        ...(eventRoute.pathSegment
          ? { pathSegment: eventRoute.pathSegment }
          : {}),
        ...(eventRoute.routePlan
          ? { routePlan: eventRoute.routePlan }
          : {}),
        objective: objective.id,
        targetEvent: {
          x: event.x,
          y: event.y,
          script: event.script,
          condition: {
            variable: event.var,
            value: String(event.var_value),
          },
        },
        remainingSteps: eventRoute.distance,
      },
      confidence: 0.98,
      constraints: [
        "cartridge-coordinate-event",
        "automatic-trigger-on-entry",
        "one-bounded-step-then-reobserve",
      ],
      evidenceRefs: [
        `cartridge:map:${map}`,
        `cartridge:layout:${mapKnowledge.layout.id}:${mapKnowledge.layout.blockDataSha256}`,
        `cartridge:coord-event:${map}:${event.x},${event.y}:${event.script}`,
        `cartridge:event-condition:${event.var}=${event.var_value}`,
      ],
    });
  }
  const route = objective?.destinationMap
    ? routeToWarp(mapKnowledge, position, objective.destinationMap)
    : null;
  const targetWarp = route
    ? {
        x: route.warp.x,
        y: route.warp.y,
        destinationMap: route.warp.dest_map,
      }
    : null;
  const warpEvidence = route
    ? [
        `cartridge:map:${map}`,
        `cartridge:layout:${mapKnowledge.layout.id}:${mapKnowledge.layout.blockDataSha256}`,
        `cartridge:warp:${map}:${route.warp.x},${route.warp.y}->${route.warp.dest_map}`,
        `cartridge:metatile-behavior:${route.cell.behaviorName}`,
      ]
    : [];
  const warpDirection = route
    ? DIRECTIONAL_WARP_INPUT[route.cell.behaviorName]
    : null;
  if (route?.distance === 0 && warpDirection) {
    return proposal({
      advisor: "navigation",
      observation,
      recommendation: {
        kind: "traverse-directional-warp",
        direction: warpDirection,
        objective: objective.id,
        targetWarp,
      },
      confidence: 0.99,
      constraints: [
        "cartridge-directional-warp",
        "one-bounded-edge-then-reobserve",
      ],
      evidenceRefs: warpEvidence,
    });
  }
  if (route) {
    return proposal({
      advisor: "navigation",
      observation,
      recommendation: {
        kind: "move-toward",
        direction: route.direction,
        ...(route.pathSegment ? { pathSegment: route.pathSegment } : {}),
        ...(route.routePlan ? { routePlan: route.routePlan } : {}),
        objective: objective.id,
        targetWarp,
        remainingSteps: route.distance,
      },
      confidence: 0.96,
      constraints: [
        "cartridge-collision-route",
        "one-bounded-step-then-reobserve",
      ],
      evidenceRefs: warpEvidence,
    });
  }
  const storyObjective = partyCount > 0
    ? campaignPlanner.select(observation)
    : null;
  const collectionObjective = partyCount > 0
    ? campaignPlanner.selectCollection?.(observation, storyObjective) ?? null
    : null;
  const rosterObjective = storyObjective
    ? selectBattleRosterObjective({ world, observation, objective: storyObjective, teamPlan })
    : null;
  const trainingObjective = storyObjective && !rosterObjective
    ? campaignTrainingObjective({
        campaignPlanner,
        world,
        observation,
        objective: storyObjective,
        teamPlan,
      })
    : null;
  let blockingTrainingObjective = ["passive", "experience-share-only"].includes(
    trainingObjective?.trainingMode,
  )
    ? null
    : trainingObjective;
  let campaignObjective = collectionObjective ??
    rosterObjective ?? blockingTrainingObjective ?? storyObjective;
  const activationTarget = campaignObjective?.target;
  if (campaignObjective === blockingTrainingObjective &&
      activationTarget?.kind === "vs-seeker-activation" &&
      activationTarget.map === map &&
      activationTarget.x === position.x && activationTarget.y === position.y) {
    // Arriving at the batch anchor completes navigation; quest owns opening
    // the bag. A null route here means "arrived", not "unreachable trainer".
    // Re-ranking the world can expire that ready command at accelerated speed.
    return null;
  }
  let guardedCampaignObjective = campaignObjective === storyObjective
    ? campaignObjective
    : preparationWithStoryTriggerGuard(campaignObjective, storyObjective);
  let campaignRecommendation = guardedCampaignObjective
    ? campaignNavigationRecommendation({
        world,
        observation,
        objective: guardedCampaignObjective,
      })
    : null;
  const excludedTrainingTrainers = new Set();
  let unroutableTraining = blockingTrainingObjective;
  while (
    !campaignRecommendation &&
    campaignObjective === blockingTrainingObjective &&
    TRAINER_TRAINING_SOURCES.has(unroutableTraining?.trainingSource) &&
    Number.isSafeInteger(Number(unroutableTraining?.trainer?.id))
  ) {
    const trainerId = Number(unroutableTraining.trainer.id);
    // A rematch and its base trainer share the same obstacle. Accumulate
    // exclusions across candidates and stop if a selector repeats one.
    if (excludedTrainingTrainers.has(trainerId)) break;
    excludedTrainingTrainers.add(trainerId);
    const baseId = unroutableTraining.trainer.baseId;
    if (Number.isSafeInteger(baseId)) excludedTrainingTrainers.add(baseId);
    const alternativeTraining = campaignTrainingObjective({
      campaignPlanner,
      world,
      observation,
      objective: storyObjective,
      teamPlan,
      excludedTrainerIds: [...excludedTrainingTrainers],
    });
    const alternativeBlockingTraining = ["passive", "experience-share-only"].includes(
      alternativeTraining?.trainingMode,
    )
      ? null
      : alternativeTraining;
    const alternativeGuarded = alternativeBlockingTraining
      ? preparationWithStoryTriggerGuard(alternativeBlockingTraining, storyObjective)
      : null;
    const alternativeRecommendation = alternativeGuarded
      ? campaignNavigationRecommendation({
          world,
          observation,
          objective: alternativeGuarded,
        })
      : null;
    if (alternativeRecommendation) {
      blockingTrainingObjective = alternativeBlockingTraining;
      campaignObjective = alternativeBlockingTraining;
      guardedCampaignObjective = alternativeGuarded;
      campaignRecommendation = alternativeRecommendation;
    }
    unroutableTraining = alternativeBlockingTraining;
  }
  if (campaignRecommendation) {
    return proposal({
      advisor: "navigation",
      observation,
      recommendation: campaignRecommendation,
      confidence: 0.96,
      constraints: [
        "campaign-objective-order",
        ...(collectionObjective ? ["mandatory-reachable-item-sweep"] : []),
        ...(rosterObjective ? ["minimum-important-battle-party-size"] : []),
        ...(blockingTrainingObjective ? [
          "minimum-team-anchor-level",
          ...(TRAINER_TRAINING_SOURCES.has(
            blockingTrainingObjective.trainingSource,
          )
            ? ["trainer-first-training"]
            : []),
        ] : []),
        "cartridge-map-graph",
        "one-bounded-step-then-reobserve",
      ],
      evidenceRefs: [
        `campaign:objective:${campaignObjective.id}`,
        ...(collectionObjective ? [
          `cartridge:item:${collectionObjective.itemId}`,
          `cartridge:item-flag:${collectionObjective.flagId}`,
        ] : []),
        ...(rosterObjective ? [
          `campaign:preparation-for:${rosterObjective.forObjective}`,
          `cartridge:battle-party-size:${rosterObjective.currentBattlePartySize}/${rosterObjective.minimumBattlePartySize}`,
        ] : []),
        ...(blockingTrainingObjective ? [
          `campaign:preparation-for:${blockingTrainingObjective.forObjective}`,
          `cartridge:team-anchor-level:${blockingTrainingObjective.currentTeamAnchorLevel}/${blockingTrainingObjective.minimumTeamAnchorLevel}`,
          ...(TRAINER_TRAINING_SOURCES.has(
            blockingTrainingObjective.trainingSource,
          ) ? [
            `cartridge:trainer:${blockingTrainingObjective.trainer.id}`,
            `cartridge:trainer-flag:${blockingTrainingObjective.trainer.flagId}`,
            `cartridge:trainer-levels:${blockingTrainingObjective.trainer.minimumLevel}-${blockingTrainingObjective.trainer.maximumLevel}`,
          ] : [
            `cartridge:land-encounters:${blockingTrainingObjective.target.map}:${blockingTrainingObjective.encounter.minimumWildLevel}-${blockingTrainingObjective.encounter.maximumWildLevel}`,
          ]),
        ] : []),
        `cartridge:map:${map}`,
        `cartridge:target-map:${campaignObjective.target.map}`,
      ],
    });
  }
  return proposal({
    advisor: "navigation",
    observation,
    recommendation: { kind: "wait-for-supported-objective", map, position,
      navigation:campaignNavigationOutcome({world,observation,objective:guardedCampaignObjective,recommendation:null}) },
    confidence: 0.2,
    constraints: ["do-not-wander-without-story-objective"],
    evidenceRefs: [`cartridge:map:${map}`],
  });
}

function verifierAdvice(observation) {
  const contradiction =
    observation.phase !== "stable" ||
    observation.emulator?.inputReady === false ||
    (observation.emulator?.mode === "battle" &&
      !observation.playerMemory?.battle &&
      !observation.playerMemory?.ui?.party);
  return proposal({
    advisor: "verifier",
    observation,
    recommendation: contradiction
      ? { kind: "withhold-unsafe-decision" }
      : { kind: "permit-current-observation" },
    confidence: 1,
    constraints: contradiction ? ["neutral-resample"] : ["current-capture-only"],
    vetoes: contradiction ? ["all"] : [],
    evidenceRefs: [
      `observation:${observation.captureId}`,
      `memory:${observation.playerMemory?.sha256 ?? "unknown"}`,
    ],
  });
}

export function createPolicyAdvisors({
  mechanics = {},
  world = {},
  campaignPlanner = createCampaignPlanner({ world, mechanics }),
  runProfile = DEFAULT_RUN_PROFILE,
  teamPlan = null,
} = {}) {
  campaignPlanner = createObservationPlanner(campaignPlanner);
  const maps = new Map(
    (dataOf(world).maps ?? []).map((map) => [map.id, map]),
  );
  const rectifyMovementCapabilities = (supplied, observation) =>
    Array.isArray(supplied)
      ? supplied.map((advice) => withMovementCapabilities(advice, observation, maps))
      : withMovementCapabilities(supplied, observation, maps);
  return Object.freeze([
    Object.freeze({
      id: "quest",
      advisePrompt: (observation) => rectifyMovementCapabilities(
        questPromptAdvice(observation),
        observation,
      ),
      advise: (observation) => rectifyMovementCapabilities(
        questAdvice(
          observation,
          mechanics,
          world,
          campaignPlanner,
          runProfile,
          teamPlan,
        ),
        observation,
      ),
    }),
    Object.freeze({
      id: "navigation",
      observeDecision: (observation, decision) =>
        campaignPlanner.observeDecision(observation, decision),
      observeManualRecovery: (recovery) =>
        campaignPlanner.observeManualRecovery?.(recovery),
      advise: (observation) => withMovementCapabilities(
        navigationAdvice(
          observation,
          maps,
          world,
          campaignPlanner,
          runProfile,
          teamPlan,
        ),
        observation,
        maps,
      ),
    }),
    Object.freeze({
      id: "battle",
      advisePrompt: (observation) => battlePromptAdvice(observation),
      advise: (observation) => rectifyMovementCapabilities(
        battleAdvice(
          observation,
          mechanics,
          world,
          campaignPlanner,
          teamPlan,
        ),
        observation,
      ),
    }),
    Object.freeze({
      id: "inventory",
      advise: (observation) => rectifyMovementCapabilities(
        inventoryAdvice(
          observation,
          mechanics,
          world,
          campaignPlanner,
          teamPlan,
        ),
        observation,
      ),
    }),
    Object.freeze({
      id: "verifier",
      advise: (observation) => rectifyMovementCapabilities(
        verifierAdvice(observation),
        observation,
      ),
    }),
  ]);
}
