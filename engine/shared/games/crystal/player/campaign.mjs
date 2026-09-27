// Campaign objectives for the first Johto Hall of Fame, in story order. Each
// objective proves completion from cartridge state (event flags, badges,
// party, pockets) and proposes one plan: travel (+ optional interaction),
// train in grass to a readiness level, or heal.

import { MANDATORY_BOSSES } from '../index.mjs';
import { createMapGrid } from '../world/grid.mjs';
import { SWITCH_ROOM, SWITCH_ROOM_ENTRY, WAREHOUSE, WAREHOUSE_WARP_APPROACH, planSwitchRoom } from './underground.mjs';
import { staticBlockers } from './navigation.mjs';
import { buildAllContracts, detectStarter, evolutionFamily, partyReadiness } from './contracts.mjs';

const objective = (definition) => Object.freeze(definition);

const leadLevel = (observation) => observation.party.find((member) => !member.isEgg)?.level ?? 0;
const hasBadge = (observation, badge) => observation.trainer.badges.includes(badge);
const hasBall = (observation) => observation.balls.some((ball) => ball.name === 'POKE_BALL' && ball.quantity > 0);

/**
 * Ilex Forest Farfetch'd herding (maps/IlexForest.asm IlexForestFarfetchdScript):
 * talking to the bird while facing one of `facings` moves it to the next
 * position; other facings send it backwards. Position 9 → 10 sets
 * EVENT_HERDED_FARFETCHD and makes the Charcoal Master appear.
 */
export const FARFETCHD_HERDING = Object.freeze([
  Object.freeze({ position: 1, at: { x: 14, y: 31 }, facings: ['up', 'down', 'left', 'right'] }),
  Object.freeze({ position: 2, at: { x: 15, y: 25 }, facings: ['up', 'left', 'right'] }),
  Object.freeze({ position: 3, at: { x: 20, y: 24 }, facings: ['up', 'down', 'right'] }),
  Object.freeze({ position: 4, at: { x: 29, y: 22 }, facings: ['down', 'left', 'right'] }),
  Object.freeze({ position: 5, at: { x: 28, y: 31 }, facings: ['down'] }),
  Object.freeze({ position: 6, at: { x: 24, y: 35 }, facings: ['up', 'down', 'left'] }),
  Object.freeze({ position: 7, at: { x: 22, y: 31 }, facings: ['up', 'right'] }),
  Object.freeze({ position: 8, at: { x: 15, y: 29 }, facings: ['down'] }),
  Object.freeze({ position: 9, at: { x: 10, y: 35 }, facings: ['up', 'left'] }),
  Object.freeze({ position: 10, at: { x: 6, y: 28 }, facings: [] }),
]);
export const FARFETCHD_SPRITE = 0x4e; // constants/sprite_constants.asm SPRITE_BIRD

export const HEAL_POINTS = Object.freeze([
  Object.freeze({ mapId: 'CHERRYGROVE_POKECENTER_1F', approach: { x: 3, y: 1 }, from: ['CHERRYGROVE_CITY', 'ROUTE_29', 'ROUTE_30', 'NEW_BARK_TOWN', 'ELMS_LAB', 'MR_POKEMONS_HOUSE'] }),
  Object.freeze({ mapId: 'VIOLET_POKECENTER_1F', approach: { x: 3, y: 1 }, from: ['VIOLET_CITY', 'ROUTE_31', 'ROUTE_31_VIOLET_GATE', 'VIOLET_GYM', 'SPROUT_TOWER_1F'] }),
  Object.freeze({ mapId: 'ROUTE_32_POKECENTER_1F', approach: { x: 3, y: 1 }, from: ['ROUTE_32', 'ROUTE_32_RUINS_OF_ALPH_GATE', 'UNION_CAVE_1F', 'UNION_CAVE_B1F'] }),
  Object.freeze({ mapId: 'AZALEA_POKECENTER_1F', approach: { x: 3, y: 1 }, from: ['AZALEA_TOWN', 'ROUTE_33', 'SLOWPOKE_WELL_B1F', 'SLOWPOKE_WELL_B2F', 'AZALEA_GYM', 'KURTS_HOUSE', 'ILEX_FOREST_AZALEA_GATE', 'ILEX_FOREST', 'CHARCOAL_KILN'] }),
  Object.freeze({ mapId: 'GOLDENROD_POKECENTER_1F', approach: { x: 3, y: 1 }, from: ['GOLDENROD_CITY', 'ROUTE_34', 'ROUTE_34_ILEX_FOREST_GATE', 'ROUTE_35', 'GOLDENROD_GYM', 'GOLDENROD_FLOWER_SHOP', 'ROUTE_35_GOLDENROD_GATE', 'NATIONAL_PARK', 'ROUTE_36', 'ROUTE_36_NATIONAL_PARK_GATE', 'ROUTE_35_NATIONAL_PARK_GATE', 'RADIO_TOWER_1F', 'RADIO_TOWER_2F', 'RADIO_TOWER_3F', 'RADIO_TOWER_4F', 'RADIO_TOWER_5F', 'GOLDENROD_UNDERGROUND', 'GOLDENROD_UNDERGROUND_SWITCH_ROOM_ENTRANCES', 'GOLDENROD_UNDERGROUND_WAREHOUSE', 'GOLDENROD_DEPT_STORE_1F'] }),
  Object.freeze({ mapId: 'ECRUTEAK_POKECENTER_1F', approach: { x: 3, y: 1 }, from: ['ECRUTEAK_CITY', 'ROUTE_37', 'ECRUTEAK_GYM', 'BURNED_TOWER_1F', 'BURNED_TOWER_B1F', 'ECRUTEAK_MART', 'DANCE_THEATER', 'ROUTE_38'] }),
  Object.freeze({ mapId: 'OLIVINE_POKECENTER_1F', approach: { x: 3, y: 1 }, from: ['OLIVINE_CITY', 'ROUTE_39', 'ROUTE_40', 'OLIVINE_LIGHTHOUSE_1F', 'OLIVINE_LIGHTHOUSE_2F', 'OLIVINE_LIGHTHOUSE_3F', 'OLIVINE_LIGHTHOUSE_4F', 'OLIVINE_LIGHTHOUSE_5F', 'OLIVINE_LIGHTHOUSE_6F', 'OLIVINE_GYM', 'OLIVINE_CAFE', 'OLIVINE_MART'] }),
  Object.freeze({ mapId: 'CIANWOOD_POKECENTER_1F', approach: { x: 3, y: 1 }, from: ['CIANWOOD_CITY', 'ROUTE_41', 'CIANWOOD_PHARMACY', 'CIANWOOD_GYM'] }),
  Object.freeze({ mapId: 'MAHOGANY_POKECENTER_1F', approach: { x: 3, y: 1 }, from: ['MAHOGANY_TOWN', 'ROUTE_42', 'ROUTE_43', 'LAKE_OF_RAGE', 'ROUTE_44', 'ROUTE_43_MAHOGANY_GATE', 'ROUTE_42_ECRUTEAK_GATE', 'MAHOGANY_GYM', 'MAHOGANY_MART_1F', 'TEAM_ROCKET_BASE_B1F', 'TEAM_ROCKET_BASE_B2F', 'TEAM_ROCKET_BASE_B3F'] }),
  Object.freeze({ mapId: 'BLACKTHORN_POKECENTER_1F', approach: { x: 3, y: 1 }, from: ['BLACKTHORN_CITY', 'ICE_PATH_1F', 'ICE_PATH_B1F', 'ICE_PATH_B2F_MAHOGANY_SIDE', 'ICE_PATH_B2F_BLACKTHORN_SIDE', 'ICE_PATH_B3F', 'BLACKTHORN_GYM_1F', 'BLACKTHORN_GYM_2F', 'DRAGONS_DEN_1F', 'DRAGONS_DEN_B1F', 'DRAGON_SHRINE', 'ROUTE_45'] }),
  Object.freeze({ mapId: 'INDIGO_PLATEAU_POKECENTER_1F', approach: { x: 3, y: 1 }, from: ['ROUTE_23', 'VICTORY_ROAD', 'VICTORY_ROAD_GATE', 'ROUTE_26', 'ROUTE_27', 'TOHJO_FALLS', 'NEW_BARK_TOWN', 'WILLS_ROOM', 'KOGAS_ROOM', 'BRUNOS_ROOM', 'KARENS_ROOM', 'LANCES_ROOM'] }),
]);

/** Poké Marts whose clerk sells Poké Balls and Potions (clerk = first SPRITE_CLERK object). */
export const MART_POINTS = Object.freeze([
  Object.freeze({ mapId: 'CHERRYGROVE_MART', from: ['CHERRYGROVE_CITY', 'ROUTE_29', 'ROUTE_30', 'NEW_BARK_TOWN'] }),
  Object.freeze({ mapId: 'VIOLET_MART', from: ['VIOLET_CITY', 'ROUTE_31', 'ROUTE_32', 'ROUTE_36'] }),
  Object.freeze({ mapId: 'AZALEA_MART', from: ['AZALEA_TOWN', 'ROUTE_33', 'ILEX_FOREST', 'SLOWPOKE_WELL_B1F'] }),
  Object.freeze({ mapId: 'GOLDENROD_DEPT_STORE_2F', from: [] }),
  Object.freeze({ mapId: 'ECRUTEAK_MART', from: ['ECRUTEAK_CITY', 'ROUTE_37', 'ECRUTEAK_GYM', 'BURNED_TOWER_1F', 'BURNED_TOWER_B1F', 'DANCE_THEATER', 'ROUTE_38', 'ROUTE_35', 'NATIONAL_PARK'] }),
  Object.freeze({ mapId: 'OLIVINE_MART', from: ['OLIVINE_CITY', 'ROUTE_39', 'ROUTE_40', 'OLIVINE_LIGHTHOUSE_1F', 'OLIVINE_LIGHTHOUSE_6F', 'OLIVINE_GYM', 'OLIVINE_CAFE'] }),
  Object.freeze({ mapId: 'CIANWOOD_PHARMACY', from: [] }),
  Object.freeze({ mapId: 'MAHOGANY_MART_1F', from: [] }),
]);

export function needsShopping(observation, { ballTarget = 8, medicineTarget = 4, reserve = 800 } = {}) {
  const balls = observation.balls.reduce((sum, ball) => sum + ball.quantity, 0);
  const medicine = observation.items.filter((item) => ['POTION', 'SUPER_POTION', 'HYPER_POTION'].includes(item.name)).reduce((sum, item) => sum + item.quantity, 0);
  const money = observation.trainer.money;
  const orders = [];
  if (balls < 3 && money - reserve >= 200 * 2) orders.push({ item: 'POKE_BALL', quantity: Math.min(ballTarget - balls, Math.floor((money - reserve) / 200), 10) });
  const spent = orders.reduce((sum, order) => sum + order.quantity * 200, 0);
  if (medicine < 2 && money - reserve - spent >= 300 * 2) {
    const superPotion = money - reserve - spent >= 700 * 3;
    orders.push({ item: superPotion ? 'SUPER_POTION' : 'POTION', quantity: Math.min(medicineTarget - medicine, Math.floor((money - reserve - spent) / (superPotion ? 700 : 300)), 6) });
  }
  return orders.filter((order) => order.quantity > 0);
}

export function nearestMart(mapId) {
  return MART_POINTS.find((point) => point.mapId === mapId || point.from.includes(mapId)) ?? null;
}

export const TRAINING_GROUNDS = Object.freeze({
  ROUTE_29_EAST: Object.freeze({ mapId: 'ROUTE_29', tiles: [{ x: 51, y: 12 }, { x: 52, y: 12 }] }),
  ROUTE_30_SOUTH: Object.freeze({ mapId: 'ROUTE_30', tiles: [{ x: 8, y: 48 }, { x: 9, y: 48 }] }),
  ROUTE_31: Object.freeze({ mapId: 'ROUTE_31', tiles: [{ x: 8, y: 10 }, { x: 9, y: 10 }] }),
  ROUTE_32_NORTH: Object.freeze({ mapId: 'ROUTE_32', tiles: [{ x: 16, y: 16 }, { x: 17, y: 16 }] }),
  ROUTE_33: Object.freeze({ mapId: 'ROUTE_33', tiles: [{ x: 6, y: 16 }, { x: 7, y: 16 }] }),
  ROUTE_34: Object.freeze({ mapId: 'ROUTE_34', tiles: [{ x: 14, y: 4 }, { x: 15, y: 4 }] }),
  ROUTE_35: Object.freeze({ mapId: 'ROUTE_35', tiles: [{ x: 8, y: 8 }, { x: 9, y: 8 }] }),
  ROUTE_36: Object.freeze({ mapId: 'ROUTE_36', tiles: [{ x: 40, y: 4 }, { x: 41, y: 4 }] }),
  ROUTE_38: Object.freeze({ mapId: 'ROUTE_38', tiles: [{ x: 6, y: 4 }, { x: 7, y: 4 }] }),
});

/**
 * Grass pairs paced to capture a party member. Wooper (the team plans' Surf
 * learner) is a night-only Route 32 encounter (data/wild/johto_grass.asm);
 * Slowpoke Well B1F holds Slowpoke at every hour and it learns Surf too.
 */
export const CAPTURE_GROUNDS = Object.freeze({
  ROUTE_32_NORTH: Object.freeze({ mapId: 'ROUTE_32', tiles: [{ x: 16, y: 16 }, { x: 17, y: 16 }] }),
  SLOWPOKE_WELL_B1F: Object.freeze({ mapId: 'SLOWPOKE_WELL_B1F', tiles: [{ x: 15, y: 13 }, { x: 16, y: 13 }] }),
});

/** True when a non-egg party member can be taught `moveName` from a TM/HM. */
export function partyCanLearn(observation, knowledge, moveName) {
  if (!knowledge) return false;
  return observation.party.some((member) => !member.isEgg && knowledge.canLearnMachine(member.speciesId, moveName));
}

/** Species ids in a map's grass table (any hour) that can learn `moveName`. */
export function learnerTargets({ knowledge, mapId, moveName }) {
  const targets = new Set();
  const table = knowledge?.grass?.get(mapId);
  if (!table) return targets;
  for (const bucket of ['morn', 'day', 'nite']) {
    for (const entry of table[bucket] ?? []) {
      const id = knowledge.speciesIds.get(entry.species);
      if (id && knowledge.canLearnMachine(id, moveName)) targets.add(id);
    }
  }
  return targets;
}

const readiness = (bossId) => MANDATORY_BOSSES.find((boss) => boss.id === bossId).minimumLevel;

const TALL_GRASS = new Set([0x14, 0x18]); // COLL_LONG_GRASS, COLL_TALL_GRASS (constants/collision_constants.asm)
const SURF_WATER = new Set([0x29]);        // COLL_WATER

/**
 * Two horizontally adjacent encounter tiles (both tall grass, or both water
 * for a surfing player) nearest to `near` on the map, from the extracted
 * collision data. Used to pace for wild battles where no ground is authored.
 */
export function findEncounterPair(world, mapId, near = null, { water = false, cave = false } = {}) {
  const grid = createMapGrid(world, mapId);
  // Caves: every floor tile has encounters (data/wild/*_grass.asm lists them
  // under the same tables), so any two adjacent land tiles pace.
  const accept = water ? SURF_WATER : cave ? { has: (collision) => collision === 0x00 || collision === 0x01 || (collision >= 0x02 && collision <= 0x07) } : TALL_GRASS;
  const map = world.map(mapId);
  const width = (map.width ?? 40) * 2 + 4;
  const height = (map.height ?? 40) * 2 + 4;
  const origin = near ?? { x: Math.floor(width / 2), y: Math.floor(height / 2) };
  let best = null;
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x + 1 < width; x += 1) {
      if (!grid.inBounds(x, y) || !grid.inBounds(x + 1, y)) continue;
      if (!accept.has(grid.collisionAt(x, y)) || !accept.has(grid.collisionAt(x + 1, y))) continue;
      if (cave && !(grid.isLand(x, y) && grid.isLand(x + 1, y) && !grid.isIce(x, y))) continue;
      const distance = Math.abs(x - origin.x) + Math.abs(y - origin.y);
      if (!best || distance < best.distance) best = { distance, tiles: [{ x, y }, { x: x + 1, y }] };
    }
  }
  if (!best) return null;
  return Object.freeze({ mapId, tiles: Object.freeze(best.tiles), kind: water ? 'water' : cave ? 'cave' : 'grass' });
}

/**
 * A contract-driven training objective (reform P0-1): complete when the boss
 * is beaten or every battle member is inside the contract's readiness band;
 * otherwise train the member furthest below the ace with the escort.
 */
function trainingObjective({ id, chapter, bossId, until, ground, source, reason = null }) {
  return objective({
    id,
    chapter,
    source,
    bossId,
    until,
    isComplete: (observation, hasEvent, context) => until(observation, hasEvent) || context.readinessFor(observation, bossId).satisfied,
    plan: (observation, hasEvent, context) => {
      const state = context.readinessFor(observation, bossId);
      const resolvedGround = typeof ground === 'function' ? ground(context, observation) : ground;
      // Hysteresis: keep the current lead as trainee while it is still short and
      // within two levels of the largest deficit, so a level gained does not
      // trigger a party swap every battle.
      const lead = state.members?.find((member) => member.slot === 0) ?? null;
      const chosen = state.trainee && lead && lead.battle && !lead.ready && lead.deficit >= state.trainee.deficit - 2 ? lead : state.trainee;
      const trainee = chosen ? { slot: chosen.slot, speciesId: chosen.speciesId, speciesName: chosen.speciesName, level: chosen.level, deficit: chosen.deficit } : null;
      const escort = state.escort ? { slot: state.escort.slot, speciesId: state.escort.speciesId, speciesName: state.escort.speciesName, level: state.escort.level } : null;
      return {
        kind: 'train',
        ground: resolvedGround,
        minimumLevel: state.targetLevel,
        contract: bossId,
        trainee,
        escort,
        readiness: { required: state.required, readyCount: state.readyCount, targetLevel: state.targetLevel, ceilingLevel: state.ceilingLevel },
        reason: reason ?? `${bossId} ace L${state.targetLevel}: ${state.readyCount}/${state.required} battle members ready; train ${trainee ? `${trainee.speciesName} L${trainee.level} (+${trainee.deficit})` : 'the lead'}${escort ? ` with ${escort.speciesName} L${escort.level} as escort` : ''}`,
      };
    },
  });
}

export const CRYSTAL_OBJECTIVES = Object.freeze([
  objective({
    id: 'MR_POKEMON_EGG',
    chapter: '1A',
    isComplete: (observation, hasEvent) => hasEvent('EVENT_GOT_MYSTERY_EGG_FROM_MR_POKEMON'),
    plan: () => ({ kind: 'travel', destination: { mapId: 'MR_POKEMONS_HOUSE' }, reason: 'entering the house starts MrPokemonsHouseMeetMrPokemonScene' }),
    source: 'maps/MrPokemonsHouse.asm',
  }),
  trainingObjective({
    id: 'TRAIN_FOR_CHERRYGROVE_RIVAL',
    chapter: '1A',
    bossId: 'RIVAL_CHERRYGROVE',
    until: (observation, hasEvent) => hasEvent('EVENT_RIVAL_CHERRYGROVE_CITY'),
    ground: TRAINING_GROUNDS.ROUTE_30_SOUTH,
    source: 'maps/CherrygroveCity.asm',
  }),
  objective({
    id: 'EGG_TO_ELM',
    chapter: '1A',
    isComplete: (observation, hasEvent) => hasEvent('EVENT_GAVE_MYSTERY_EGG_TO_ELM'),
    plan: () => ({ kind: 'travel', destination: { mapId: 'ELMS_LAB', approach: { x: 5, y: 2 } }, interact: 'approach', reason: 'Elm (object at 5,2) takes the Mystery Egg and sets EVENT_GAVE_MYSTERY_EGG_TO_ELM' }),
    source: 'maps/ElmsLab.asm',
  }),
  objective({
    id: 'POKE_BALLS_FROM_AIDE',
    chapter: '1A',
    // The aide's scene sets wElmsLabSceneID to SCENE_ELMSLAB_NOOP (2, the third
    // scene_script in maps/ElmsLab.asm); balls may later be used up, so the
    // scene variable, not the pocket, proves this objective.
    isComplete: (observation, hasEvent) => hasBall(observation) || (hasEvent('EVENT_GAVE_MYSTERY_EGG_TO_ELM') && (observation.scenes?.elmsLab ?? 0) === 2),
    plan: () => ({ kind: 'travel', destination: { mapId: 'NEW_BARK_TOWN' }, reason: 'leaving the lab crosses the aide coordinate event that gives Poké Balls' }),
    source: 'maps/ElmsLab.asm',
  }),
  trainingObjective({
    id: 'TRAIN_FOR_FALKNER',
    chapter: '1B',
    bossId: 'FALKNER',
    until: (observation) => hasBadge(observation, 'ZEPHYR'),
    ground: TRAINING_GROUNDS.ROUTE_31,
    source: 'maps/VioletGym.asm',
  }),
  objective({
    id: 'FALKNER',
    chapter: '1B',
    isComplete: (observation) => hasBadge(observation, 'ZEPHYR'),
    plan: () => ({ kind: 'travel', destination: { mapId: 'VIOLET_GYM', approach: { x: 5, y: 1 } }, interact: 'approach', reason: 'Falkner (object at 5,1); the gym trainers engage on approach' }),
    source: 'maps/VioletGym.asm',
  }),
  objective({
    id: 'TOGEPI_EGG_FROM_AIDE',
    chapter: '2A',
    isComplete: (observation, hasEvent) => hasEvent('EVENT_GOT_TOGEPI_EGG_FROM_ELMS_AIDE'),
    plan: () => ({ kind: 'travel', destination: { mapId: 'VIOLET_POKECENTER_1F', approach: { x: 4, y: 3 } }, interact: 'approach', reason: "Elm's aide at (4,3) gives the Togepi Egg; until then the Route 32 Cooltrainer pushes the player back (SCENE_ROUTE32_COOLTRAINER_M_BLOCKS)" }),
    source: 'maps/VioletPokecenter1F.asm',
  }),
  objective({
    id: 'TRAIN_FOR_SLOWPOKE_WELL',
    chapter: '2A',
    isComplete: (observation, hasEvent) => hasEvent('EVENT_CLEARED_SLOWPOKE_WELL') || leadLevel(observation) >= 15,
    plan: () => ({ kind: 'train', ground: TRAINING_GROUNDS.ROUTE_32_NORTH, minimumLevel: 15, reason: 'four Rocket grunts guard Slowpoke Well; train on Route 32 first' }),
    source: 'maps/SlowpokeWellB1F.asm',
  }),
  objective({
    id: 'KURT_SENDS_YOU_TO_THE_WELL',
    chapter: '2A',
    isComplete: (observation, hasEvent) => hasEvent('EVENT_AZALEA_TOWN_SLOWPOKETAIL_ROCKET') || hasEvent('EVENT_CLEARED_SLOWPOKE_WELL'),
    plan: () => ({ kind: 'travel', destination: { mapId: 'KURTS_HOUSE', approachSprite: 'SPRITE_KURT' }, interact: 'approach', reason: 'talking to Kurt (whichever KURT object the flags show) sets EVENT_AZALEA_TOWN_SLOWPOKETAIL_ROCKET, clearing the well entrance guard' }),
    source: 'maps/KurtsHouse.asm',
  }),
  objective({
    id: 'CLEAR_SLOWPOKE_WELL',
    chapter: '2A',
    isComplete: (observation, hasEvent) => hasEvent('EVENT_CLEARED_SLOWPOKE_WELL'),
    plan: () => ({ kind: 'travel', destination: { mapId: 'SLOWPOKE_WELL_B1F', approach: { x: 5, y: 2 } }, interact: 'approach', reason: "beating TrainerGruntM1 at (5,2) runs Kurt's victory scene, which sets EVENT_CLEARED_SLOWPOKE_WELL and warps to Kurt's house; the other grunts engage on sight" }),
    source: 'maps/SlowpokeWellB1F.asm',
  }),
  trainingObjective({
    id: 'TRAIN_FOR_BUGSY',
    chapter: '2B',
    bossId: 'BUGSY',
    until: (observation) => hasBadge(observation, 'HIVE'),
    ground: TRAINING_GROUNDS.ROUTE_33,
    source: 'maps/AzaleaGym.asm',
  }),
  objective({
    id: 'BUGSY',
    chapter: '2B',
    isComplete: (observation) => hasBadge(observation, 'HIVE'),
    plan: () => ({ kind: 'travel', destination: { mapId: 'AZALEA_GYM', approach: { x: 5, y: 7 } }, interact: 'approach', reason: 'Bugsy (object at 5,7); the gym trainers engage on approach' }),
    source: 'maps/AzaleaGym.asm',
  }),
  objective({
    id: 'RIVAL_AZALEA',
    chapter: '3A',
    isComplete: (observation, hasEvent) => hasEvent('EVENT_RIVAL_AZALEA_TOWN'),
    plan: () => ({ kind: 'travel', destination: { mapId: 'AZALEA_TOWN', x: 5, y: 10 }, reason: 'coordinate event (5,10) starts AzaleaTownRivalBattleScene1 after the well is cleared; winning sets EVENT_RIVAL_AZALEA_TOWN' }),
    source: 'maps/AzaleaTown.asm',
  }),
  objective({
    id: 'HERD_FARFETCHD',
    chapter: '3A',
    isComplete: (observation, hasEvent) => hasEvent('EVENT_HERDED_FARFETCHD') || hasEvent('EVENT_GOT_HM01_CUT'),
    plan: () => ({ kind: 'herd', mapId: 'ILEX_FOREST', table: FARFETCHD_HERDING, sprite: FARFETCHD_SPRITE, reason: "talk to the apprentice's Farfetch'd from the facing that drives it forward until position 10" }),
    source: 'maps/IlexForest.asm',
  }),
  objective({
    id: 'HM01_CUT',
    chapter: '3A',
    isComplete: (observation, hasEvent) => hasEvent('EVENT_GOT_HM01_CUT'),
    plan: () => ({ kind: 'travel', destination: { mapId: 'ILEX_FOREST', approach: { x: 5, y: 28 } }, interact: 'approach', reason: 'the Charcoal Master (5,28) gives HM01 after the Farfetch\'d is herded' }),
    source: 'maps/IlexForest.asm',
  }),
  objective({
    id: 'TEACH_CUT',
    chapter: '3A',
    isComplete: (observation) => knowsMove(observation, 'CUT'),
    plan: () => ({ kind: 'teach', moveLabel: 'CUT', moveName: 'CUT', reason: 'teach HM01 to the lead from the TM/HM pocket so Ilex Forest and later trees can be cut' }),
    source: 'engine/events/overworld.asm:TryCutOW',
  }),
  trainingObjective({
    id: 'TRAIN_FOR_WHITNEY',
    chapter: '3B',
    bossId: 'WHITNEY',
    until: (observation) => hasBadge(observation, 'PLAIN'),
    ground: TRAINING_GROUNDS.ROUTE_34,
    source: 'maps/GoldenrodGym.asm',
  }),
  objective({
    id: 'WHITNEY',
    chapter: '3B',
    isComplete: (observation) => hasBadge(observation, 'PLAIN'),
    plan: (observation, hasEvent) => {
      // After the win Whitney cries (EVENT_MADE_WHITNEY_CRY); the coordinate
      // event at (8,5) runs WhitneyCriesScript, which clears the flag, and only
      // then does talking to her give the Plain Badge.
      if (hasEvent('EVENT_BEAT_WHITNEY') && hasEvent('EVENT_MADE_WHITNEY_CRY')) {
        return { kind: 'travel', destination: { mapId: 'GOLDENROD_GYM', x: 8, y: 5 }, reason: 'step on the (8,5) coordinate event so Bridget stops Whitney crying' };
      }
      return { kind: 'travel', destination: { mapId: 'GOLDENROD_GYM', approach: { x: 8, y: 3 } }, interact: 'approach', reason: hasEvent('EVENT_BEAT_WHITNEY') ? 'Whitney hands over the Plain Badge once she stops crying' : 'Whitney (object at 8,3); the gym trainers engage on approach' };
    },
    source: 'maps/GoldenrodGym.asm',
  }),
  objective({
    id: 'MEET_FLORIA',
    chapter: '4A',
    isComplete: (observation, hasEvent) => hasEvent('EVENT_MET_FLORIA') || hasEvent('EVENT_GOT_SQUIRTBOTTLE'),
    plan: () => ({ kind: 'travel', destination: { mapId: 'ROUTE_36', approachSprite: 'SPRITE_LASS', near: { x: 33, y: 12 } }, interact: 'approach', reason: 'Floria beside Sudowoodo sets EVENT_MET_FLORIA (Route36FloriaScript)' }),
    source: 'maps/Route36.asm',
  }),
  objective({
    id: 'FLORIA_AT_SHOP',
    chapter: '4A',
    isComplete: (observation, hasEvent) => hasEvent('EVENT_TALKED_TO_FLORIA_AT_FLOWER_SHOP') || hasEvent('EVENT_GOT_SQUIRTBOTTLE'),
    plan: () => ({ kind: 'travel', destination: { mapId: 'GOLDENROD_FLOWER_SHOP', approachSprite: 'SPRITE_LASS', near: { x: 5, y: 6 } }, interact: 'approach', reason: 'talking to Floria in the shop sets EVENT_TALKED_TO_FLORIA_AT_FLOWER_SHOP' }),
    source: 'maps/GoldenrodFlowerShop.asm',
  }),
  objective({
    id: 'SQUIRTBOTTLE',
    chapter: '4A',
    isComplete: (observation, hasEvent) => hasEvent('EVENT_GOT_SQUIRTBOTTLE') || hasEvent('EVENT_FOUGHT_SUDOWOODO'),
    plan: () => ({ kind: 'travel', destination: { mapId: 'GOLDENROD_FLOWER_SHOP', approach: { x: 2, y: 4 } }, interact: 'approach', reason: 'the shop teacher gives the SQUIRTBOTTLE once Floria was talked to and the Plain Badge is held' }),
    source: 'maps/GoldenrodFlowerShop.asm',
  }),
  objective({
    id: 'SUDOWOODO',
    chapter: '4A',
    isComplete: (observation, hasEvent) => hasEvent('EVENT_FOUGHT_SUDOWOODO'),
    plan: () => ({ kind: 'travel', destination: { mapId: 'ROUTE_36', approach: { x: 35, y: 9 } }, interact: 'approach', reason: 'the odd tree (35,9) is watered with the SQUIRTBOTTLE and battles as a L20 Sudowoodo; the route north opens' }),
    source: 'maps/Route36.asm',
  }),
  objective({
    id: 'BURNED_TOWER_RIVAL',
    chapter: '4B',
    isComplete: (observation, hasEvent) => hasEvent('EVENT_RIVAL_BURNED_TOWER') || hasEvent('EVENT_RELEASED_THE_BEASTS'),
    plan: () => ({ kind: 'travel', destination: { mapId: 'BURNED_TOWER_1F', x: 11, y: 9 }, reason: 'the Ecruteak Gym is closed (SCENE_ECRUTEAKGYM_FORCED_TO_LEAVE) until the Burned Tower: the (11,9) coordinate event starts the rival battle' }),
    source: 'maps/BurnedTower1F.asm',
  }),
  objective({
    id: 'RELEASE_THE_BEASTS',
    chapter: '4B',
    isComplete: (observation, hasEvent) => hasEvent('EVENT_RELEASED_THE_BEASTS'),
    plan: () => ({ kind: 'travel', destination: { mapId: 'BURNED_TOWER_B1F', x: 10, y: 6 }, reason: 'the (10,6) coordinate event on B1F runs ReleaseTheBeasts, which sets SCENE_ECRUTEAKGYM_NOOP and EVENT_ECRUTEAK_GYM_GRAMPS' }),
    source: 'maps/BurnedTowerB1F.asm',
  }),
  trainingObjective({
    id: 'TRAIN_FOR_MORTY',
    chapter: '4B',
    bossId: 'MORTY',
    until: (observation) => hasBadge(observation, 'FOG'),
    ground: TRAINING_GROUNDS.ROUTE_36,
    source: 'maps/EcruteakGym.asm',
  }),
  objective({
    id: 'MORTY',
    chapter: '4B',
    isComplete: (observation) => hasBadge(observation, 'FOG'),
    plan: () => ({ kind: 'travel', destination: { mapId: 'ECRUTEAK_GYM', approach: { x: 5, y: 1 } }, interact: 'approach', reason: 'Morty (object at 5,1) across the pit floor; the planner avoids the COLL_PIT warp tiles' }),
    source: 'maps/EcruteakGym.asm',
  }),
  objective({
    id: 'KIMONO_GIRLS',
    chapter: '5A',
    isComplete: (observation, hasEvent) => hasEvent('EVENT_GOT_HM03_SURF') || KIMONO_GIRLS.every((girl) => hasEvent(girl.flag)),
    plan: (observation, hasEvent) => {
      const next = KIMONO_GIRLS.find((girl) => !hasEvent(girl.flag));
      return { kind: 'travel', destination: { mapId: 'DANCE_THEATER', approach: next.at }, interact: 'approach', reason: `Kimono Girl ${next.name} (sight range 0) must be talked to; beating all five unlocks HM03` };
    },
    source: 'maps/DanceTheater.asm',
  }),
  objective({
    id: 'HM03_SURF',
    chapter: '5A',
    isComplete: (observation, hasEvent) => hasEvent('EVENT_GOT_HM03_SURF'),
    plan: () => ({ kind: 'travel', destination: { mapId: 'DANCE_THEATER', approach: { x: 7, y: 10 } }, interact: 'approach', reason: 'the gentleman (7,10) gives HM03 once every Kimono Girl is beaten' }),
    source: 'maps/DanceTheater.asm',
  }),
  objective({
    id: 'SURF_LEARNER',
    chapter: '5A',
    // Fire starters cannot learn HM03; the team plans' Surf learner is Wooper.
    // Pace grass that holds a Surf learner (night: Route 32 Wooper, otherwise
    // Slowpoke Well B1F Slowpoke) and throw balls at it (captureContext).
    isComplete: (observation, hasEvent, context) => knowsMove(observation, 'SURF') || !context?.knowledge || partyCanLearn(observation, context.knowledge, 'SURF'),
    plan: (observation) => ({
      kind: 'capture', learn: 'SURF',
      ground: observation.timeOfDay === 'NITE' ? CAPTURE_GROUNDS.ROUTE_32_NORTH : CAPTURE_GROUNDS.SLOWPOKE_WELL_B1F,
      reason: `no party member can learn SURF; capture a learner (${observation.timeOfDay === 'NITE' ? 'Route 32 Wooper at night' : 'Slowpoke Well Slowpoke'})`,
    }),
    source: 'data/wild/johto_grass.asm',
  }),
  objective({
    id: 'TEACH_SURF',
    chapter: '5A',
    isComplete: (observation) => knowsMove(observation, 'SURF'),
    plan: (observation) => ({ kind: 'teach', moveLabel: 'SURF', moveName: 'SURF', learner: 'SURF', reason: 'teach HM03 to the first party member that can learn it (Fog Badge held)' }),
    source: 'engine/events/overworld.asm:TrySurfOW',
  }),
  objective({
    id: 'JASMINE_LIGHTHOUSE',
    chapter: '5B',
    isComplete: (observation, hasEvent) => hasEvent('EVENT_JASMINE_EXPLAINED_AMPHYS_SICKNESS') || hasEvent('EVENT_JASMINE_RETURNED_TO_GYM'),
    plan: () => ({ kind: 'travel', destination: { mapId: 'OLIVINE_LIGHTHOUSE_6F', approach: { x: 8, y: 8 } }, interact: 'approach', reason: 'Jasmine at the top of the lighthouse explains Amphy\'s sickness (EVENT_JASMINE_EXPLAINED_AMPHYS_SICKNESS)' }),
    source: 'maps/OlivineLighthouse6F.asm',
  }),
  objective({
    id: 'SECRET_POTION',
    chapter: '5B',
    isComplete: (observation, hasEvent) => hasEvent('EVENT_GOT_SECRETPOTION_FROM_PHARMACY') || hasEvent('EVENT_JASMINE_RETURNED_TO_GYM'),
    plan: () => ({ kind: 'travel', destination: { mapId: 'CIANWOOD_PHARMACY', approachSprite: 'SPRITE_PHARMACIST' }, interact: 'approach', reason: 'the Cianwood pharmacist gives the SECRETPOTION after Jasmine explained (surf Routes 40/41)' }),
    source: 'maps/CianwoodPharmacy.asm',
  }),
  objective({
    id: 'JASMINE_CURE',
    chapter: '5B',
    isComplete: (observation, hasEvent) => hasEvent('EVENT_JASMINE_RETURNED_TO_GYM'),
    plan: () => ({ kind: 'travel', destination: { mapId: 'OLIVINE_LIGHTHOUSE_6F', approach: { x: 8, y: 8 } }, interact: 'approach', reason: 'handing Jasmine the SECRETPOTION cures Amphy; she returns to the gym (EVENT_JASMINE_RETURNED_TO_GYM)' }),
    source: 'maps/OlivineLighthouse6F.asm',
  }),
  trainingObjective({
    id: 'TRAIN_FOR_JASMINE',
    chapter: '5B',
    bossId: 'JASMINE',
    until: (observation) => hasBadge(observation, 'MINERAL'),
    ground: TRAINING_GROUNDS.ROUTE_38,
    source: 'maps/OlivineGym.asm',
  }),
  objective({
    id: 'JASMINE',
    chapter: '5B',
    isComplete: (observation) => hasBadge(observation, 'MINERAL'),
    plan: () => ({ kind: 'travel', destination: { mapId: 'OLIVINE_GYM', approach: { x: 5, y: 3 } }, interact: 'approach', reason: 'Jasmine (object at 5,3) once she has returned to the gym' }),
    source: 'maps/OlivineGym.asm',
  }),
  objective({
    id: 'HM04_STRENGTH',
    chapter: '6A',
    isComplete: (observation, hasEvent) => hasEvent('EVENT_GOT_HM04_STRENGTH'),
    plan: () => ({ kind: 'travel', destination: { mapId: 'OLIVINE_CAFE', approach: { x: 4, y: 3 } }, interact: 'approach', reason: 'the Olivine Café sailor (4,3) gives HM04' }),
    source: 'maps/OlivineCafe.asm',
  }),
  objective({
    id: 'TEACH_STRENGTH',
    chapter: '6A',
    isComplete: (observation) => knowsMove(observation, 'STRENGTH'),
    plan: () => ({ kind: 'teach', moveLabel: 'STRENGTH', moveName: 'STRENGTH', learner: 'STRENGTH', reason: 'teach HM04 to the first party member that can learn it (Plain Badge held); Cianwood Gym needs it' }),
    source: 'engine/events/overworld.asm:TryStrengthOW',
  }),
  trainingObjective({
    id: 'TRAIN_FOR_CHUCK',
    chapter: '6A',
    bossId: 'CHUCK',
    until: (observation) => hasBadge(observation, 'STORM'),
    // Cianwood has no grass: pace on the Route 41 water just off the shore.
    ground: (context) => findEncounterPair(context.world, 'ROUTE_41', { x: 1, y: 39 }, { water: true }),
    source: 'maps/CianwoodGym.asm',
  }),
  objective({
    id: 'CHUCK',
    chapter: '6A',
    isComplete: (observation) => hasBadge(observation, 'STORM'),
    plan: () => ({ kind: 'travel', destination: { mapId: 'CIANWOOD_GYM', approach: { x: 4, y: 1 } }, interact: 'approach', reason: 'Chuck (object at 4,1) behind the Strength boulder puzzle; the boulder-aware planner pushes (3,7), (5,7) and (4,7)' }),
    source: 'maps/CianwoodGym.asm',
  }),
  objective({
    id: 'HM02_FLY',
    chapter: '6A',
    isComplete: (observation, hasEvent) => hasEvent('EVENT_GOT_HM02_FLY'),
    plan: () => ({ kind: 'travel', destination: { mapId: 'CIANWOOD_CITY', approachSprite: 'SPRITE_POKEFAN_F', near: { x: 10, y: 46 } }, interact: 'approach', reason: "Chuck's wife outside the gym gives HM02 after the Storm Badge" }),
    source: 'maps/CianwoodCity.asm',
  }),
  objective({
    id: 'RED_GYARADOS',
    chapter: '6B',
    isComplete: (observation, hasEvent) => hasEvent('EVENT_LAKE_OF_RAGE_RED_GYARADOS') || hasEvent('EVENT_DECIDED_TO_HELP_LANCE'),
    plan: () => ({ kind: 'travel', destination: { mapId: 'LAKE_OF_RAGE', approach: { x: 18, y: 22 } }, interact: 'approach', reason: 'surf to the Red Gyarados (18,22); the battle (L30) removes it and Lance appears' }),
    source: 'maps/LakeOfRage.asm',
  }),
  objective({
    id: 'LANCE_AT_LAKE',
    chapter: '7A',
    isComplete: (observation, hasEvent) => hasEvent('EVENT_DECIDED_TO_HELP_LANCE') || hasEvent('EVENT_UNCOVERED_STAIRCASE_IN_MAHOGANY_MART'),
    plan: () => ({ kind: 'travel', destination: { mapId: 'LAKE_OF_RAGE', approachSprite: 'SPRITE_LANCE' }, interact: 'approach', reason: 'Lance on the shore asks for help against Team Rocket (answer YES → EVENT_DECIDED_TO_HELP_LANCE)' }),
    source: 'maps/LakeOfRage.asm',
  }),
  trainingObjective({
    id: 'TRAIN_FOR_ROCKET_HIDEOUT',
    chapter: '7A',
    bossId: 'ROCKET_EXECUTIVE_F_2',
    until: (observation, hasEvent) => hasEvent('EVENT_CLEARED_ROCKET_HIDEOUT'),
    // Route 43 grass between Mahogany and the lake, the closest encounters to the hideout.
    ground: (context) => findEncounterPair(context.world, 'ROUTE_43', null),
    source: 'maps/TeamRocketBaseB2F.asm',
  }),
  objective({
    id: 'MAHOGANY_STAIRS',
    chapter: '7A',
    isComplete: (observation, hasEvent) => hasEvent('EVENT_UNCOVERED_STAIRCASE_IN_MAHOGANY_MART'),
    plan: () => ({ kind: 'travel', destination: { mapId: 'MAHOGANY_MART_1F' }, reason: 'entering the souvenir shop runs MahoganyMart1FLanceUncoversStairsScene' }),
    source: 'maps/MahoganyMart1F.asm',
  }),
  objective({
    id: 'HIDEOUT_PASSWORD_SLOWPOKETAIL',
    chapter: '7B',
    isComplete: (observation, hasEvent) => hasEvent('EVENT_LEARNED_SLOWPOKETAIL') || hasEvent('EVENT_OPENED_DOOR_TO_GIOVANNIS_OFFICE'),
    plan: () => ({ kind: 'travel', destination: { mapId: 'TEAM_ROCKET_BASE_B3F', approach: { x: 21, y: 7 } }, interact: 'approach', reason: 'the grunt at (21,7) reveals password SLOWPOKETAIL after the battle' }),
    source: 'maps/TeamRocketBaseB3F.asm',
  }),
  objective({
    id: 'HIDEOUT_PASSWORD_RATICATE_TAIL',
    chapter: '7B',
    isComplete: (observation, hasEvent) => hasEvent('EVENT_LEARNED_RATICATE_TAIL') || hasEvent('EVENT_OPENED_DOOR_TO_GIOVANNIS_OFFICE'),
    plan: () => ({ kind: 'travel', destination: { mapId: 'TEAM_ROCKET_BASE_B3F', approach: { x: 5, y: 14 } }, interact: 'approach', reason: 'the grunt at (5,14) reveals password RATICATE TAIL after the battle' }),
    source: 'maps/TeamRocketBaseB3F.asm',
  }),
  objective({
    id: 'HIDEOUT_OFFICE_DOOR',
    chapter: '7B',
    isComplete: (observation, hasEvent) => hasEvent('EVENT_OPENED_DOOR_TO_GIOVANNIS_OFFICE'),
    plan: () => ({ kind: 'travel', destination: { mapId: 'TEAM_ROCKET_BASE_B3F', approach: { x: 10, y: 9 }, facings: ['up'] }, interact: 'approach', reason: 'the locked door (bg_event 10,9) opens with both passwords (TeamRocketBaseB3FLockedDoor)' }),
    source: 'maps/TeamRocketBaseB3F.asm',
  }),
  objective({
    id: 'HIDEOUT_EXECUTIVE_PETREL',
    chapter: '7B',
    isComplete: (observation, hasEvent) => hasEvent('EVENT_BEAT_ROCKET_EXECUTIVEM_4'),
    plan: () => ({ kind: 'travel', destination: { mapId: 'TEAM_ROCKET_BASE_B3F', x: 10, y: 8 }, reason: 'the (10,8) coordinate event in the office starts the Executive battle' }),
    source: 'maps/TeamRocketBaseB3F.asm',
  }),
  objective({
    id: 'HIDEOUT_PASSWORD_HAIL_GIOVANNI',
    chapter: '7B',
    isComplete: (observation, hasEvent) => hasEvent('EVENT_LEARNED_HAIL_GIOVANNI') || hasEvent('EVENT_OPENED_DOOR_TO_ROCKET_HIDEOUT_TRANSMITTER'),
    plan: () => ({ kind: 'travel', destination: { mapId: 'TEAM_ROCKET_BASE_B3F', approach: { x: 7, y: 2 } }, interact: 'approach', reason: 'the Murkrow in the office repeats HAIL GIOVANNI' }),
    source: 'maps/TeamRocketBaseB3F.asm',
  }),
  objective({
    id: 'HIDEOUT_TRANSMITTER_DOOR',
    chapter: '7C',
    isComplete: (observation, hasEvent) => hasEvent('EVENT_OPENED_DOOR_TO_ROCKET_HIDEOUT_TRANSMITTER'),
    plan: () => ({ kind: 'travel', destination: { mapId: 'TEAM_ROCKET_BASE_B2F', approach: { x: 14, y: 12 }, facings: ['up'] }, interact: 'approach', reason: 'the B2F locked door (bg_event 14,12) opens with HAIL GIOVANNI' }),
    source: 'maps/TeamRocketBaseB2F.asm',
  }),
  objective({
    id: 'HIDEOUT_ELECTRODES',
    chapter: '7C',
    isComplete: (observation, hasEvent) => ['EVENT_TEAM_ROCKET_BASE_B2F_ELECTRODE_1', 'EVENT_TEAM_ROCKET_BASE_B2F_ELECTRODE_2', 'EVENT_TEAM_ROCKET_BASE_B2F_ELECTRODE_3'].every((flag) => hasEvent(flag)) || hasEvent('EVENT_CLEARED_ROCKET_HIDEOUT'),
    plan: (observation, hasEvent) => {
      const targets = [[7, 5, 'EVENT_TEAM_ROCKET_BASE_B2F_ELECTRODE_1'], [7, 7, 'EVENT_TEAM_ROCKET_BASE_B2F_ELECTRODE_2'], [7, 9, 'EVENT_TEAM_ROCKET_BASE_B2F_ELECTRODE_3']];
      const next = targets.find(([, , flag]) => !hasEvent(flag)) ?? targets[0];
      return { kind: 'travel', destination: { mapId: 'TEAM_ROCKET_BASE_B2F', approach: { x: next[0], y: next[1] } }, interact: 'approach', reason: 'each generator Electrode (L23) must be beaten' };
    },
    source: 'maps/TeamRocketBaseB2F.asm',
  }),
  objective({
    id: 'HIDEOUT_BOSS',
    chapter: '7C',
    isComplete: (observation, hasEvent) => hasEvent('EVENT_CLEARED_ROCKET_HIDEOUT'),
    plan: () => ({ kind: 'travel', destination: { mapId: 'TEAM_ROCKET_BASE_B2F', x: 14, y: 11 }, reason: 'the (14,11) coordinate event starts the Executive + grunt battle with Lance; victory sets EVENT_CLEARED_ROCKET_HIDEOUT' }),
    source: 'maps/TeamRocketBaseB2F.asm',
  }),
  // ---- Chapter 8: Pryce, HM06, the Radio Tower and the Goldenrod Underground
  // (docs/CRYSTAL-MASTER-ROUTE.md §3 G–H; Bulbapedia Crystal walkthrough §11–12).
  objective({
    id: 'TEACH_WHIRLPOOL',
    chapter: '8A',
    isComplete: (observation, hasEvent, context) => knowsMove(observation, 'WHIRLPOOL') || !hasEvent('EVENT_GOT_HM06_WHIRLPOOL') || (context?.knowledge && !partyCanLearn(observation, context.knowledge, 'WHIRLPOOL')),
    plan: () => ({ kind: 'teach', moveLabel: 'WHIRLPOOL', moveName: 'WHIRLPOOL', learner: 'WHIRLPOOL', reason: 'teach HM06 (from Lance after the Hideout) to the first party member that can learn it; Route 27 and the Dragon\'s Den need it' }),
    source: 'maps/TeamRocketBaseB2F.asm',
  }),
  trainingObjective({
    id: 'TRAIN_FOR_PRYCE',
    chapter: '8A',
    bossId: 'PRYCE',
    until: (observation) => hasBadge(observation, 'GLACIER'),
    // Route 44 is closed until the Glacier Badge: the Rage Candy Bar merchant scene
    // (maps/MahoganyTown.asm coord events 19,8/19,9) pushes the player back west
    // until std_scripts sets SCENE_MAHOGANYTOWN_NOOP. Route 43 grass it is.
    ground: (context) => findEncounterPair(context.world, 'ROUTE_43', null),
    source: 'maps/MahoganyGym.asm',
  }),
  objective({
    id: 'PRYCE',
    chapter: '8A',
    isComplete: (observation) => hasBadge(observation, 'GLACIER'),
    plan: () => ({ kind: 'travel', destination: { mapId: 'MAHOGANY_GYM', approach: { x: 5, y: 3 } }, interact: 'approach', reason: 'Pryce (object at 5,3) across the ice maze; the planner slides (Seel L27, Dewgong L29, Piloswine L31)' }),
    source: 'maps/MahoganyGym.asm',
  }),
  trainingObjective({
    id: 'TRAIN_FOR_RADIO_TOWER',
    chapter: '8B',
    bossId: 'ROCKET_EXECUTIVE_M_2',
    until: (observation, hasEvent) => hasEvent('EVENT_CLEARED_RADIO_TOWER'),
    ground: (context) => findEncounterPair(context.world, 'ROUTE_44', { x: 10, y: 9 }),
    source: 'maps/RadioTower4F.asm',
  }),
  objective({
    id: 'RADIO_TOWER_PETREL',
    chapter: '8B',
    isComplete: (observation, hasEvent) => hasEvent('EVENT_BEAT_ROCKET_EXECUTIVEM_3') || hasEvent('EVENT_CLEARED_RADIO_TOWER'),
    plan: () => ({ kind: 'travel', destination: { mapId: 'RADIO_TOWER_5F', x: 0, y: 3 }, reason: 'the (0,3) coordinate event on 5F west is the fake Director (Petrel: Koffing L30 ×3, Weezing L32) who drops the Basement Key; grunts on 1F–4F battle on sight' }),
    source: 'maps/RadioTower5F.asm',
  }),
  objective({
    id: 'BASEMENT_DOOR',
    chapter: '8B',
    isComplete: (observation, hasEvent) => hasEvent('EVENT_USED_BASEMENT_KEY') || hasEvent('EVENT_CLEARED_RADIO_TOWER'),
    plan: () => ({ kind: 'travel', destination: { mapId: 'GOLDENROD_UNDERGROUND', approach: { x: 18, y: 6 }, facings: ['up'] }, interact: 'approach', reason: 'the locked basement door (bg_event 18,6) opens with the Basement Key (BasementDoorScript → changeblock 18,6 $2e)' }),
    source: 'maps/GoldenrodUnderground.asm',
  }),
  trainingObjective({
    id: 'TRAIN_FOR_UNDERGROUND_RIVAL',
    chapter: '8B',
    bossId: 'RIVAL_GOLDENROD_UNDERGROUND',
    until: (observation, hasEvent) => hasEvent('EVENT_RIVAL_GOLDENROD_UNDERGROUND') || hasEvent('EVENT_CLEARED_RADIO_TOWER'),
    ground: () => TRAINING_GROUNDS.ROUTE_35,
    source: 'maps/GoldenrodUndergroundSwitchRoomEntrances.asm',
  }),
  objective({
    id: 'UNDERGROUND_DOORS',
    chapter: '8B',
    // The switch room doors depend on the press history (player/underground.mjs
    // replays UpdateDoors from the EVENT_DOOR_n_OPEN flags). Done once the
    // warehouse warp is reachable from where the player stands (or from the
    // basement-door entry when the player is elsewhere); from a fresh room the
    // solver presses 3, 2, 1 — Bulbapedia's order.
    isComplete: (observation, hasEvent, context) => {
      if (hasEvent('EVENT_RECEIVED_CARD_KEY')) return true;
      const mapId = observation.map ? context.world.idOf(observation.map.group, observation.map.number) : null;
      if (mapId === WAREHOUSE) return true;
      const from = mapId === SWITCH_ROOM ? { x: observation.map.x, y: observation.map.y } : SWITCH_ROOM_ENTRY;
      return planSwitchRoom(context.world, from, hasEvent, { blockers: staticBlockers(context.world, SWITCH_ROOM, hasEvent) })?.presses.length === 0;
    },
    plan: (observation, hasEvent, context) => {
      const mapId = observation.map ? context.world.idOf(observation.map.group, observation.map.number) : null;
      const from = mapId === SWITCH_ROOM ? { x: observation.map.x, y: observation.map.y } : SWITCH_ROOM_ENTRY;
      const solution = planSwitchRoom(context.world, from, hasEvent, { blockers: staticBlockers(context.world, SWITCH_ROOM, hasEvent) });
      const press = solution?.presses[0] ?? { which: 3, tile: { x: 2, y: 1 } };
      return {
        kind: 'travel',
        destination: { mapId: SWITCH_ROOM, approach: press.tile, facings: ['up'] },
        interact: 'approach',
        reason: solution
          ? `switch ${press.which} (bg_event ${press.tile.x},${press.tile.y}) — ${solution.presses.map((p) => p.which).join(', ')} opens the way to the warehouse`
          : `no switch sequence found from ${from.x},${from.y}; pressing switch 3 (bg_event 2,1) to change the doors`,
      };
    },
    source: 'maps/GoldenrodUndergroundSwitchRoomEntrances.asm',
  }),
  objective({
    id: 'WAREHOUSE_DIRECTOR',
    chapter: '8B',
    isComplete: (observation, hasEvent) => hasEvent('EVENT_RECEIVED_CARD_KEY'),
    plan: () => ({ kind: 'travel', destination: { mapId: 'GOLDENROD_UNDERGROUND_WAREHOUSE', approachSprite: 'SPRITE_GENTLEMAN' }, interact: 'approach', reason: 'the Director (wandering gentleman) in the warehouse gives the Card Key (EVENT_RECEIVED_CARD_KEY)' }),
    source: 'maps/GoldenrodUndergroundWarehouse.asm',
  }),
  objective({
    id: 'UNDERGROUND_EXIT',
    chapter: '8B',
    // With the Card Key in hand the only modelled way out of the warehouse is
    // back through the switch room (the Dept Store B1F exit needs the elevator
    // menu). From the warp side every door may be shut; the EMERGENCY switch
    // (bg_event 20,11) reopens 3, 5, 6, 8, 9, 11 — the way in, reversed.
    isComplete: (observation, hasEvent, context) => {
      const mapId = observation.map ? context.world.idOf(observation.map.group, observation.map.number) : null;
      if (mapId !== WAREHOUSE && mapId !== SWITCH_ROOM) return true;
      const from = mapId === SWITCH_ROOM ? { x: observation.map.x, y: observation.map.y } : WAREHOUSE_WARP_APPROACH;
      return planSwitchRoom(context.world, from, hasEvent, { goal: SWITCH_ROOM_ENTRY, blockers: staticBlockers(context.world, SWITCH_ROOM, hasEvent) })?.presses.length === 0;
    },
    plan: (observation, hasEvent, context) => {
      const mapId = observation.map ? context.world.idOf(observation.map.group, observation.map.number) : null;
      const from = mapId === SWITCH_ROOM ? { x: observation.map.x, y: observation.map.y } : WAREHOUSE_WARP_APPROACH;
      const solution = planSwitchRoom(context.world, from, hasEvent, { goal: SWITCH_ROOM_ENTRY, blockers: staticBlockers(context.world, SWITCH_ROOM, hasEvent) });
      const press = solution?.presses[0] ?? { which: 'E', tile: { x: 20, y: 11 } };
      return {
        kind: 'travel',
        destination: { mapId: SWITCH_ROOM, approach: press.tile, facings: ['up'] },
        interact: 'approach',
        reason: solution
          ? `switch ${press.which} (bg_event ${press.tile.x},${press.tile.y}) — ${solution.presses.map((p) => p.which).join(', ')} opens the way back to the basement door`
          : `no switch sequence found from ${from.x},${from.y}; pressing the emergency switch (bg_event 20,11)`,
      };
    },
    source: 'maps/GoldenrodUndergroundSwitchRoomEntrances.asm',
  }),
  objective({
    id: 'CARD_KEY_SLOT',
    chapter: '8B',
    isComplete: (observation, hasEvent) => hasEvent('EVENT_USED_THE_CARD_KEY_IN_THE_RADIO_TOWER') || hasEvent('EVENT_CLEARED_RADIO_TOWER'),
    plan: () => ({ kind: 'travel', destination: { mapId: 'RADIO_TOWER_3F', approach: { x: 14, y: 2 }, facings: ['up'] }, interact: 'approach', reason: 'the Card Key slot (bg_event 14,2, read facing up) opens the 3F shutter (changeblock 14,2 / 14,4)' }),
    source: 'maps/RadioTower3F.asm',
  }),
  objective({
    id: 'RADIO_TOWER_BOSS',
    chapter: '8B',
    isComplete: (observation, hasEvent) => hasEvent('EVENT_CLEARED_RADIO_TOWER'),
    plan: () => ({ kind: 'travel', destination: { mapId: 'RADIO_TOWER_5F', x: 16, y: 5 }, reason: 'past the 3F shutter, 4F east (Proton: Golbat L36) and 5F east (Ariana: Arbok/Vileplume/Murkrow L32) the (16,5) coordinate event starts Archer (Houndour L33, Koffing L33, Houndoom L35); victory sets EVENT_CLEARED_RADIO_TOWER' }),
    source: 'maps/RadioTower5F.asm',
  }),
  // ---- Chapter 9: Route 44, Ice Path (HM07), Blackthorn, Clair, the Dragon's Den
  // (docs/CRYSTAL-MASTER-ROUTE.md §3 H–I; Bulbapedia §12–13).
  trainingObjective({
    id: 'TRAIN_FOR_CLAIR',
    chapter: '9A',
    bossId: 'CLAIR',
    until: (observation) => hasBadge(observation, 'RISING'),
    // Route 44's west grass patch (L22–24 wilds), open once the Glacier Badge is held.
    ground: (context) => findEncounterPair(context.world, 'ROUTE_44', { x: 10, y: 9 }),
    source: 'maps/BlackthornGym1F.asm',
  }),
  objective({
    id: 'ICE_PATH_HM07',
    chapter: '9A',
    isComplete: (observation, hasEvent) => hasEvent('EVENT_GOT_HM07_WATERFALL'),
    plan: () => ({ kind: 'travel', destination: { mapId: 'ICE_PATH_1F', approach: { x: 31, y: 7 } }, interact: 'approach', reason: 'the HM07 itemball (31,7) on Ice Path 1F beyond the third ice patch (Bulbapedia: Ice Path); the planner slides' }),
    source: 'maps/IcePath1F.asm',
  }),
  objective({
    id: 'ICE_PATH_BOULDERS',
    chapter: '9A',
    // IcePathB1F.asm stonetable: boulder n falls through hole n and clears EVENT_BOULDER_IN_ICE_PATH_nA (set at new game), which shows it on B2F as a slide stopper.
    isComplete: (observation, hasEvent) => [1, 2, 3, 4].every((n) => !hasEvent(`EVENT_BOULDER_IN_ICE_PATH_${n}A`)),
    plan: (observation, hasEvent) => {
      const fallEvents = [1, 2, 3, 4].map((n) => ({ event: `EVENT_BOULDER_IN_ICE_PATH_${n}A`, fallenWhenSet: false }));
      const fallen = fallEvents.filter((entry) => !hasEvent(entry.event)).length;
      return { kind: 'travel', destination: { mapId: 'ICE_PATH_B1F', boulderHoles: true, fallEvents, fallen }, reason: `push the next Strength boulder into its hole on Ice Path B1F (${fallen}/4 fallen)` };
    },
    source: 'maps/IcePathB1F.asm',
  }),
  objective({
    id: 'TEACH_WATERFALL',
    chapter: '9A',
    isComplete: (observation, hasEvent, context) => knowsMove(observation, 'WATERFALL') || (context?.knowledge && !partyCanLearn(observation, context.knowledge, 'WATERFALL')),
    plan: () => ({ kind: 'teach', moveLabel: 'WATERFALL', moveName: 'WATERFALL', learner: 'WATERFALL', reason: 'teach HM07 to the first party member that can learn it; Tohjo Falls needs it (Rising Badge)' }),
    source: 'maps/IcePath1F.asm',
  }),
  objective({
    id: 'BLACKTHORN_GYM_BOULDERS',
    chapter: '9B',
    // BlackthornGym2F.asm stonetable: boulders 1–3 (map objects 3–5) fall through holes (8,3), (2,5), (8,7) and set EVENT_BOULDER_IN_BLACKTHORN_GYM_n; the 1F callback bridges the lava.
    isComplete: (observation, hasEvent) => [1, 2, 3].every((n) => hasEvent(`EVENT_BOULDER_IN_BLACKTHORN_GYM_${n}`)) || hasEvent('EVENT_BEAT_CLAIR'),
    plan: (observation, hasEvent) => {
      const fallEvents = [1, 2, 3].map((n) => ({ event: `EVENT_BOULDER_IN_BLACKTHORN_GYM_${n}`, fallenWhenSet: true }));
      const fallen = fallEvents.filter((entry) => hasEvent(entry.event)).length;
      return { kind: 'travel', destination: { mapId: 'BLACKTHORN_GYM_2F', boulderHoles: true, fallEvents, fallen }, reason: `push the next Strength boulder into its hole on Blackthorn Gym 2F (${fallen}/3 fallen)` };
    },
    source: 'maps/BlackthornGym2F.asm',
  }),
  objective({
    id: 'CLAIR',
    chapter: '9B',
    isComplete: (observation, hasEvent) => hasEvent('EVENT_BEAT_CLAIR'),
    plan: () => ({ kind: 'travel', destination: { mapId: 'BLACKTHORN_GYM_1F', approach: { x: 5, y: 3 } }, interact: 'approach', reason: 'Clair (object at 5,3) over the boulder bridges (Dragonair L37 ×3, Kingdra L40); she sends you to the Dragon\'s Den' }),
    source: 'maps/BlackthornGym1F.asm',
  }),
  // A learner for the two water HMs no v1 team member can take: HM06 Whirlpool
  // opens the Dragon's Den channel to the shrine (the reason Lance's gift is
  // mandatory) and HM07 Waterfall climbs Tohjo Falls. Route 44's Poliwag
  // learns both. The party is boxed down to five first (a spare of a plan
  // family, else the lightest utility carrier) at the nearest Pokémon Center PC.
  objective({
    id: 'WATER_HM_LEARNER_SLOT',
    chapter: '9B',
    isComplete: (observation, hasEvent, context) => knowsMove(observation, 'WHIRLPOOL') || !context?.knowledge
      || partyCanLearn(observation, context.knowledge, 'WHIRLPOOL') || observation.party.filter((member) => !member.isEgg).length < 6,
    plan: () => ({ kind: 'deposit', reason: 'no party member can learn WHIRLPOOL and the party is full: box a spare at the nearest Pokémon Center PC' }),
    source: 'engine/events/pokecenter_pc.asm',
  }),
  objective({
    id: 'WATER_HM_LEARNER',
    chapter: '9B',
    isComplete: (observation, hasEvent, context) => knowsMove(observation, 'WHIRLPOOL') || !context?.knowledge || partyCanLearn(observation, context.knowledge, 'WHIRLPOOL'),
    plan: (observation, hasEvent, context) => ({
      kind: 'capture', learn: 'WHIRLPOOL',
      ground: context?.world ? findEncounterPair(context.world, 'ROUTE_44', { x: 10, y: 9 }) : null,
      reason: "no party member can learn WHIRLPOOL; capture a learner on Route 44's west grass (Poliwag takes HM06 and HM07)",
    }),
    source: 'data/wild/johto_grass.asm',
  }),
  objective({
    id: 'DRAGON_SHRINE',
    chapter: '9B',
    isComplete: (observation) => hasBadge(observation, 'RISING'),
    plan: () => ({ kind: 'travel', destination: { mapId: 'DRAGON_SHRINE', approach: { x: 5, y: 1 } }, interact: 'approach', reason: 'the elder (5,1) in the shrine behind the Dragon\'s Den (Surf + Whirlpool) asks five questions (dialog.mjs MENU_ANSWERS); Clair then awards the Rising Badge (setflag ENGINE_RISINGBADGE)' }),
    source: 'maps/DragonShrine.asm',
  }),
  // ---- Chapters 10–11: Route 27, Tohjo Falls, Route 26, Victory Road, the Elite Four
  // (docs/CRYSTAL-MASTER-ROUTE.md §3 J–K; Bulbapedia §14–15). The Master Ball is skipped.
  trainingObjective({
    id: 'TRAIN_FOR_ELITE_FOUR',
    chapter: '10A',
    bossId: 'LANCE',
    until: (observation, hasEvent) => hasEvent('EVENT_BEAT_ELITE_FOUR'),
    // Victory Road's cave floor: Golbat/Graveler/Onix/Rhyhorn L32–40 (data/wild/kanto_grass.asm VICTORY_ROAD).
    ground: (context) => findEncounterPair(context.world, 'VICTORY_ROAD', { x: 9, y: 60 }, { cave: true }),
    source: 'maps/LancesRoom.asm',
  }),
  objective({
    id: 'VICTORY_ROAD_RIVAL',
    chapter: '10A',
    isComplete: (observation, hasEvent) => hasEvent('EVENT_RIVAL_VICTORY_ROAD'),
    plan: () => ({ kind: 'travel', destination: { mapId: 'VICTORY_ROAD', x: 12, y: 8 }, reason: 'the (12,8) coordinate event near the Route 23 exit starts rival #5 (Sneasel L34, Golbat L36, Magneton L35, Haunter L35, Kadabra L35, starter L38)' }),
    source: 'maps/VictoryRoad.asm',
  }),
  ...[['WILL', 'WILLS_ROOM', 'EVENT_BEAT_ELITE_4_WILL', 'Will (Xatu L40/42, Exeggutor L41, Slowbro L41, Jynx L41)'], ['KOGA', 'KOGAS_ROOM', 'EVENT_BEAT_ELITE_4_KOGA', 'Koga (Ariados L40, Venomoth L41, Forretress L43, Muk L42, Crobat L44)'], ['BRUNO', 'BRUNOS_ROOM', 'EVENT_BEAT_ELITE_4_BRUNO', 'Bruno (Hitmontop/Hitmonlee/Hitmonchan L42, Onix L43, Machamp L46)'], ['KAREN', 'KARENS_ROOM', 'EVENT_BEAT_ELITE_4_KAREN', 'Karen (Umbreon L42, Vileplume L42, Murkrow L44, Gengar L45, Houndoom L47)']].map(([id, mapId, event, party]) => objective({
    id: `ELITE_${id}`,
    chapter: '11A',
    isComplete: (observation, hasEvent) => hasEvent(event),
    // The entrance locks behind the player (EVENT_*_ROOM_ENTRANCE_CLOSED): heal and stock at the Plateau first (free-healer and stocking rules run before travel).
    plan: () => ({ kind: 'travel', destination: { mapId, approach: { x: 5, y: 7 } }, interact: 'approach', reason: `${party}; the exit door opens on victory (changeblock 4,2)` }),
    source: `maps/${mapId.split('_').map((part) => part[0] + part.slice(1).toLowerCase()).join('')}.asm`,
  })),
  objective({
    id: 'CHAMPION_LANCE',
    chapter: '11A',
    isComplete: (observation, hasEvent) => hasEvent('EVENT_BEAT_CHAMPION_LANCE'),
    plan: () => ({ kind: 'travel', destination: { mapId: 'LANCES_ROOM', approach: { x: 5, y: 3 } }, interact: 'approach', reason: 'Lance (object at 5,3): Gyarados L44, Dragonite L47 ×2, Charizard L46, Aerodactyl L46, Dragonite L50' }),
    source: 'maps/LancesRoom.asm',
  }),
  objective({
    id: 'HALL_OF_FAME',
    chapter: '11A',
    isComplete: (observation, hasEvent) => hasEvent('EVENT_BEAT_ELITE_FOUR'),
    plan: () => ({ kind: 'travel', destination: { mapId: 'HALL_OF_FAME' }, reason: 'through the opened door behind Lance (changeblock 4,0) into the Hall of Fame; the scene sets EVENT_BEAT_ELITE_FOUR' }),
    source: 'maps/HallOfFame.asm',
  }),
]);

export const KIMONO_GIRLS = Object.freeze([
  Object.freeze({ name: 'Naoko', at: { x: 0, y: 2 }, flag: 'EVENT_BEAT_KIMONO_GIRL_NAOKO' }),
  Object.freeze({ name: 'Sayo', at: { x: 2, y: 1 }, flag: 'EVENT_BEAT_KIMONO_GIRL_SAYO' }),
  Object.freeze({ name: 'Zuki', at: { x: 6, y: 2 }, flag: 'EVENT_BEAT_KIMONO_GIRL_ZUKI' }),
  Object.freeze({ name: 'Kuni', at: { x: 9, y: 1 }, flag: 'EVENT_BEAT_KIMONO_GIRL_KUNI' }),
  Object.freeze({ name: 'Miki', at: { x: 11, y: 2 }, flag: 'EVENT_BEAT_KIMONO_GIRL_MIKI' }),
]);

export function knowsMove(observation, moveName) {
  return observation.party.some((member) => !member.isEgg && member.moves.some((move) => move.name === moveName || move.name === moveName.replace('_', ' ')));
}

/**
 * Team-plan species still to be captured, as species ids. A plan species is
 * owned once any party member belongs to its family: a Crobat fills the
 * Zubat slot (the 2026-09-05 live run caught a second Zubat beside it).
 */
export function captureTargets(observation, knowledge, plan) {
  if (!plan) return new Set();
  const owned = new Set(observation.party.map((member) => member.speciesId));
  const targets = new Set();
  for (const member of plan.members) {
    if (member.acquisition?.stage === 'STARTER') continue;
    const id = knowledge.speciesIds.get(member.species);
    if (!id) continue;
    const family = evolutionFamily(knowledge, member.species);
    if (![...family].some((speciesId) => owned.has(speciesId))) targets.add(id);
  }
  return targets;
}

export function needsHealing(observation, { threshold = 0.35 } = {}) {
  const members = observation.party.filter((member) => !member.isEgg);
  const lead = members[0];
  if (!lead) return false;
  const fainted = members.filter((member) => member.hp === 0).length;
  return lead.hp === 0 || lead.hp / Math.max(lead.maxHp, 1) < threshold || fainted > 0;
}

export function nearestHealPoint(mapId) {
  return HEAL_POINTS.find((point) => point.mapId === mapId || point.from.includes(mapId)) ?? HEAL_POINTS[0];
}

/**
 * Every free healer in the cartridge (reform P1-1): the nurse of each of the
 * 22 Pokémon Centers (object script `<Map>NurseScript`) and the Route 26 heal
 * house teacher. Approach = the healer's tile; counters are handled by the
 * approach-candidate search.
 */
export function freeHealers(world) {
  const healers = [];
  for (const mapId of world.mapIds) {
    for (const object of world.map(mapId).objectEvents ?? []) {
      const script = object.script ?? '';
      // Violet's nurse is `VioletPokecenterNurse`; every other one ends in NurseScript.
      if (/Pokecenter(1F)?Nurse(Script)?$/.test(script) || script === 'Route26HealHouseTeacherScript') {
        healers.push(Object.freeze({ mapId, approach: { x: object.x, y: object.y }, kind: /Nurse/.test(script) ? 'pokemon-center' : 'heal-house', script }));
      }
    }
  }
  return Object.freeze(healers);
}

/**
 * Map-transition distances (warps and connections, one step each) from one
 * map to every reachable map. Cheap enough to cache per starting map.
 */
export function mapTransitionDistances(world, fromMapId, { maximumDepth = 40 } = {}) {
  const distances = new Map([[fromMapId, 0]]);
  const queue = [fromMapId];
  while (queue.length > 0) {
    const mapId = queue.shift();
    const depth = distances.get(mapId);
    if (depth >= maximumDepth) continue;
    let map;
    try { map = world.map(mapId); } catch { continue; }
    const next = [...(map.warps ?? []).map((warp) => warp.mapId), ...(map.connections ?? []).map((connection) => connection.mapId)];
    for (const target of next) {
      if (!target || distances.has(target) || !world.mapIds.includes(target)) continue;
      // A route gate is a corridor, not a place: passing through it is free,
      // so "a Center two transitions away" means the same in Johto as in Kanto.
      distances.set(target, depth + (/_GATE$/.test(target) ? 0 : 1));
      queue.push(target);
    }
  }
  return distances;
}

/**
 * Recovery policy (reform P1-1): free healing whenever it is within two map
 * transitions; further away only when the party is in real danger. Returns
 * null when no heal is due, else { healer, distance, urgent, reason }.
 */
export function healDecision(observation, { world, currentMapId, healers = null, distances = null, roles = null, nearbyTransitions = 2 } = {}) {
  const members = observation.party.map((member, slot) => ({ ...member, slot, role: roles?.[slot] ?? 'plan' })).filter((member) => !member.isEgg);
  if (members.length === 0) return null;
  const battleMembers = members.filter((member) => member.role !== 'utility');
  const lead = members[0];
  const ratio = (member) => member.hp / Math.max(member.maxHp, 1);
  const faintedBattle = battleMembers.filter((member) => member.hp === 0);
  const strongest = [...battleMembers].sort((left, right) => right.level - left.level)[0] ?? lead;
  const damagingPpLeft = (member) => (member.moves ?? []).some((move) => move.pp > 0 && move.name !== 'LEER' && move.name !== 'GROWL' && move.name !== 'SMOKESCREEN');
  const reasons = [];
  if (faintedBattle.length > 0) reasons.push(`${faintedBattle.map((member) => member.speciesName).join(', ')} fainted`);
  if (ratio(lead) < 0.4) reasons.push(`lead ${lead.speciesName} at ${lead.hp}/${lead.maxHp}`);
  if (strongest !== lead && ratio(strongest) < 0.4) reasons.push(`escort ${strongest.speciesName} at ${strongest.hp}/${strongest.maxHp}`);
  if (strongest.moves?.length && !damagingPpLeft(strongest)) reasons.push(`${strongest.speciesName} has no attacking PP`);
  if (reasons.length === 0) return null;
  const healthyBattle = battleMembers.filter((member) => ratio(member) > 0.3);
  const urgent = healthyBattle.length === 0 || ratio(strongest) < 0.25 || (lead.hp === 0 && strongest.hp === 0);
  const all = healers ?? (world ? freeHealers(world) : HEAL_POINTS);
  const distanceTo = distances ?? (world && currentMapId ? mapTransitionDistances(world, currentMapId) : new Map());
  let nearest = null;
  for (const healer of all) {
    const distance = distanceTo.get(healer.mapId);
    if (distance === undefined) continue;
    if (!nearest || distance < nearest.distance) nearest = { healer, distance };
  }
  if (!nearest) {
    const fallback = nearestHealPoint(currentMapId);
    return { healer: fallback, distance: null, urgent, reason: `${reasons.join('; ')} (no reachable free healer known, fallback ${fallback.mapId})` };
  }
  if (nearest.distance > nearbyTransitions && !urgent) return null;
  return { healer: nearest.healer, distance: nearest.distance, urgent, reason: `${reasons.join('; ')}; ${nearest.healer.mapId} is ${nearest.distance} transition(s) away${urgent ? ' (urgent)' : ''}` };
}

export function createCampaign({ objectives = CRYSTAL_OBJECTIVES, knowledge = null, world = null, starter = null, teamPlan = 'v1' } = {}) {
  const visited = new Set();
  const contracts = new Map(); // starter → Map(bossId → contract)
  const readinessFor = (observation, bossId) => {
    const resolved = starter ?? (knowledge ? detectStarter(observation, knowledge) : null);
    const boss = MANDATORY_BOSSES.find((entry) => entry.id === bossId);
    if (!knowledge || !resolved) {
      // No knowledge pack or unknown starter: lead-only readiness against the authored ace.
      const level = leadLevel(observation);
      return { contractId: bossId, targetLevel: boss.maximumOpponentLevel, ceilingLevel: boss.maximumOpponentLevel + 2, required: 1, readyCount: level >= boss.maximumOpponentLevel ? 1 : 0, satisfied: level >= boss.maximumOpponentLevel, trainee: null, escort: null, members: [] };
    }
    if (!contracts.has(resolved)) contracts.set(resolved, buildAllContracts({ knowledge, starter: resolved }));
    const contract = contracts.get(resolved).get(bossId);
    return partyReadiness(observation, { contract, knowledge, starter: resolved, teamPlan });
  };
  const contractFor = (observation, bossId) => {
    const resolved = starter ?? (knowledge ? detectStarter(observation, knowledge) : null);
    if (!knowledge || !resolved) return null;
    if (!contracts.has(resolved)) contracts.set(resolved, buildAllContracts({ knowledge, starter: resolved }));
    return contracts.get(resolved).get(bossId) ?? null;
  };
  const context = Object.freeze({ knowledge, world, starter, teamPlan, readinessFor, contractFor });
  return Object.freeze({
    noteMap(mapId) { if (mapId) visited.add(mapId); },
    status(observation, hasEvent) {
      const completed = objectives.filter((entry) => entry.isComplete(observation, hasEvent, context)).map((entry) => entry.id);
      const active = objectives.find((entry) => !entry.isComplete(observation, hasEvent, context)) ?? null;
      return {
        activeObjective: active ? { id: active.id, chapter: active.chapter, source: active.source } : null,
        completed,
        remaining: objectives.length - completed.length,
        visitedMaps: visited.size,
      };
    },
    next(observation, hasEvent) {
      const active = objectives.find((entry) => !entry.isComplete(observation, hasEvent, context));
      if (!active) return null;
      return { objective: active, plan: active.plan(observation, hasEvent, context) };
    },
    /** The contract of the next important battle that is not yet won (for stocking). */
    nextContract(observation, hasEvent) {
      const pending = objectives.find((entry) => entry.bossId && !entry.until(observation, hasEvent));
      return pending ? contractFor(observation, pending.bossId) : null;
    },
  });
}

// ---------------------------------------------------------------------------
// Segment-based stocking (reform P1-2)

const MEDICINE_HEALS = Object.freeze({ POTION: 20, SUPER_POTION: 50, HYPER_POTION: 200, MAX_POTION: 999, FULL_RESTORE: 999, FRESH_WATER: 50, SODA_POP: 60, LEMONADE: 80, MOOMOO_MILK: 100 });
const STATUS_CURES = Object.freeze({
  EFFECT_SLEEP: 'AWAKENING',
  EFFECT_PARALYZE: 'PARLYZ_HEAL', EFFECT_PARALYZE_HIT: 'PARLYZ_HEAL',
  EFFECT_POISON: 'ANTIDOTE', EFFECT_POISON_HIT: 'ANTIDOTE', EFFECT_POISON_MULTI_HIT: 'ANTIDOTE', EFFECT_TOXIC: 'ANTIDOTE',
  EFFECT_BURN_HIT: 'BURN_HEAL',
  EFFECT_FREEZE_HIT: 'ICE_HEAL',
});

/** Scripts of the clerk objects visible under the current event flags (the Mahogany souvenir seller vs. the owners, etc.). */
export function visibleClerks(world, mapId, hasEvent) {
  return (world.map(mapId).objectEvents ?? [])
    .filter((object) => object.script && (object.flag === '-1' || !hasEvent(object.flag)))
    .map((object) => object.script);
}

/** Status cures the next boss's party can make necessary, from its moves' effects. */
export function statusCuresFor(contract, knowledge) {
  const cures = new Set();
  for (const member of contract?.enemyParty ?? []) {
    for (const moveName of member.moves ?? []) {
      const move = knowledge.moves.get(knowledge.moveIds.get(moveName));
      const cure = move ? STATUS_CURES[move.effect] : null;
      if (cure) cures.add(cure);
    }
  }
  return [...cures];
}

/**
 * What to buy, where, before the next segment: one healing item that restores
 * at least half of each battle member's HP (cheapest per HP the visible clerks
 * sell) plus one spare, cures for statuses the next boss can inflict, and
 * Poké Balls only while team-plan captures remain. The whole plan must fit
 * money − reserve or it is trimmed (balls, then cures, then spares); shopping
 * is only proposed when a floor is breached and a mart is within reach.
 */
export function shoppingPlan(observation, {
  knowledge, world, mapId, distances, roles = null, contract = null, captureTargets = new Set(), hasEvent = () => false,
  reserve = 800, nearbyTransitions = 2,
} = {}) {
  if (!knowledge?.martsByMap || !world || !mapId) return null;
  const members = observation.party.map((member, slot) => ({ ...member, slot, role: roles?.[slot] ?? 'plan' })).filter((member) => !member.isEgg);
  const battleMembers = members.filter((member) => member.role !== 'utility');
  if (battleMembers.length === 0) return null;
  const owned = (name) => [...(observation.items ?? []), ...(observation.balls ?? [])].filter((item) => item.name === name).reduce((sum, item) => sum + item.quantity, 0);

  // Nearest reachable mart with at least one visible clerk.
  let chosen = null;
  for (const [martMapId, clerks] of knowledge.martsByMap) {
    const distance = martMapId === mapId ? 0 : distances?.get(martMapId);
    if (distance === undefined || distance > nearbyTransitions) continue;
    let visible;
    try { visible = visibleClerks(world, martMapId, hasEvent); } catch { continue; }
    const stocked = clerks.filter((clerk) => clerk.script && visible.includes(clerk.script) && clerk.type === 'MARTTYPE_STANDARD'
      && !(clerk.blockedBy ?? []).some(hasEvent) && (clerk.requires ?? []).every(hasEvent));
    if (stocked.length === 0) continue;
    if (!chosen || distance < chosen.distance) chosen = { mapId: martMapId, distance, clerks: stocked };
  }
  if (!chosen) return null;
  const sells = new Map(); // item → clerk script (first clerk that sells it)
  for (const clerk of chosen.clerks) for (const item of clerk.items) if (!sells.has(item) && knowledge.itemPrice(item) !== null) sells.set(item, clerk.script);

  // Medicine: cheapest per HP that still restores half of the member's HP in one
  // use; when the mart sells nothing that strong (early Potion-only marts), the
  // strongest medicine it does sell counts as "sufficient" for this segment.
  const strongestSold = Object.entries(MEDICINE_HEALS).filter(([name]) => sells.has(name)).reduce((max, [, heals]) => Math.max(max, heals), 0);
  const needFor = (member) => Math.min(Math.ceil(member.maxHp / 2), strongestSold || Infinity);
  const medicineFor = (member) => {
    const need = needFor(member);
    let best = null;
    for (const [name, heals] of Object.entries(MEDICINE_HEALS)) {
      if (!sells.has(name) || heals < need) continue;
      const price = knowledge.itemPrice(name);
      const perHp = price / Math.min(heals, member.maxHp);
      if (!best || perHp < best.perHp) best = { name, price, heals, perHp };
    }
    return best;
  };
  const wanted = new Map(); // item → { quantity, price, clerkIndex, why }
  const add = (name, quantity, why) => {
    if (quantity <= 0 || !sells.has(name)) return;
    const entry = wanted.get(name) ?? { quantity: 0, price: knowledge.itemPrice(name), clerk: sells.get(name), why };
    entry.quantity += quantity;
    wanted.set(name, entry);
  };
  const medicineNeeds = battleMembers.map(medicineFor).filter(Boolean);
  const sufficientOwned = (member) => (observation.items ?? []).filter((item) => (MEDICINE_HEALS[item.name] ?? 0) >= needFor(member)).reduce((sum, item) => sum + item.quantity, 0);
  const shortMembers = battleMembers.filter((member) => sufficientOwned(member) < 1);
  const medicineFloorBreached = shortMembers.length > Math.floor(battleMembers.length / 2);
  const bulkiest = battleMembers.reduce((best, member) => (!best || member.maxHp > best.maxHp ? member : best), null);
  for (const member of battleMembers) {
    const medicine = medicineFor(member);
    if (!medicine) continue;
    const have = owned(medicine.name);
    const target = 1 + (member === bulkiest ? 1 : 0); // one each plus a spare for the member that takes the boss's hits
    add(medicine.name, Math.max(0, target - Math.max(0, have - (wanted.get(medicine.name)?.quantity ?? 0))), `heals ≥ ${needFor(member)} for ${member.speciesName}`);
  }
  const cures = statusCuresFor(contract, knowledge);
  let cureMissing = false;
  for (const cure of cures) {
    if (owned(cure) < 2) { cureMissing = true; add(cure, 2 - owned(cure), `${contract.id} can inflict it`); }
  }
  const ballsMissing = captureTargets.size > 0 && owned('POKE_BALL') < 5;
  if (ballsMissing) add('POKE_BALL', 5 - owned('POKE_BALL'), `${captureTargets.size} team-plan capture target(s) remain`);

  if (!medicineFloorBreached && !(cureMissing && contract) && !(ballsMissing && owned('POKE_BALL') === 0)) return null;
  const budget = observation.trainer.money - reserve;
  const orders = [...wanted.entries()].map(([item, entry]) => ({ item, ...entry }));
  const total = () => orders.reduce((sum, order) => sum + order.quantity * order.price, 0);
  // Trim to the budget: balls first, then cures, then medicine spares, then medicine.
  const priority = (order) => (order.item === 'POKE_BALL' ? 0 : cures.includes(order.item) ? 1 : 2);
  while (total() > budget && orders.some((order) => order.quantity > 0)) {
    const candidates = orders.filter((order) => order.quantity > 0).sort((left, right) => priority(left) - priority(right) || right.quantity - left.quantity);
    candidates[0].quantity -= 1;
  }
  const affordable = orders.filter((order) => order.quantity > 0);
  if (affordable.length === 0 || total() <= 0) return null;
  return Object.freeze({
    mart: Object.freeze({ mapId: chosen.mapId, distance: chosen.distance }),
    orders: Object.freeze(affordable.map((order) => Object.freeze({ item: order.item, quantity: order.quantity, unitPrice: order.price, clerk: order.clerk, why: order.why }))),
    total: total(),
    budget,
    cures,
    reason: `${chosen.mapId} (${chosen.distance} away): ${affordable.map((order) => `${order.quantity}× ${order.item}`).join(', ')} for ₽${total()} of ₽${budget}${medicineFloorBreached ? '; medicine floor breached' : ''}${cureMissing ? '; boss status cures missing' : ''}`,
  });
}
