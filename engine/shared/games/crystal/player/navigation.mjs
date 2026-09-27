// Navigation advisor and executor. Plans over the source-derived world with
// live object blockers, then executes one leg at a time as bounded walking
// edges, re-planning after every cartridge-proven interruption.

import { WALK_OUT_TILES, createMapGrid, findRouteWithBoulders, planBoulderDrop, planJourney, segmentRoute } from '../world/grid.mjs';
import { walkSegment, holdFrames, face } from './locomotion.mjs';
import { advanceScript, interact, textboxOpen, yesNoMenuOpen } from './dialog.mjs';

const WARP_EXIT_DIRECTION = Object.freeze({ 0x70: 'down', 0x76: 'left', 0x78: 'up', 0x7e: 'right' });

export class NavigationError extends Error {
  constructor(message, detail = {}) {
    super(message);
    this.name = 'NavigationError';
    this.detail = detail;
  }
}

/**
 * Blocks that map scripts rewrite with `changeblock` under an event flag
 * (locked doors, shutters, fallen boulders). Every triple is the script's own
 * `changeblock x, y, block` arguments — tile coordinates of the 2×2 block and
 * the block id in the map's tileset — applied while the event is `set` or
 * while it is `clear`, so the planner takes the block's real collision from
 * the tileset instead of a hand-listed guess (the raised shutter and the
 * open-door pictures keep wall tiles). test/crystal/navigation.test.mjs
 * checks every triple against maps/*.asm.
 */
const ugdoor = (n, row) => ({
  event: `EVENT_DOOR_${n}_OPEN`,
  set: Array.from({ length: row.length / 4 }, (_, i) => [row[i * 4], row[i * 4 + 1], row[i * 4 + 3]]),
  clear: Array.from({ length: row.length / 4 }, (_, i) => [row[i * 4], row[i * 4 + 1], row[i * 4 + 2]]),
});

export const EVENT_OPENINGS = Object.freeze({
  // TeamRocketBaseB3F.asm: the office door becomes floor after both passwords.
  TEAM_ROCKET_BASE_B3F: [{ event: 'EVENT_OPENED_DOOR_TO_GIOVANNIS_OFFICE', set: [[10, 8, 0x07]] }],
  // TeamRocketBaseB2F.asm: the transmitter door becomes floor after HAIL GIOVANNI.
  TEAM_ROCKET_BASE_B2F: [{ event: 'EVENT_OPENED_DOOR_TO_ROCKET_HIDEOUT_TRANSMITTER', set: [[14, 12, 0x07]] }],
  // RadioTower3F.asm: the Card Key raises the shutter ($2a still walls 14,2 and
  // 15,2; only 15,3 opens) and turns the block below into floor (15,4 and 15,5).
  RADIO_TOWER_3F: [{ event: 'EVENT_USED_THE_CARD_KEY_IN_THE_RADIO_TOWER', set: [[14, 2, 0x2a], [14, 4, 0x01]] }],
  // GoldenrodUnderground.asm: the basement door is drawn unlocked ($2e, DOOR)
  // and the callback locks it ($3d) until the Basement Key has been used.
  GOLDENROD_UNDERGROUND: [{ event: 'EVENT_USED_BASEMENT_KEY', set: [[18, 6, 0x2e]], clear: [[18, 6, 0x3d]] }],
  // GoldenrodUndergroundSwitchRoomEntrances.asm ugdoor_def rows (x, y, closed,
  // open[, x, y, closed, open]): the switch scripts apply OPEN/CLOSED as the
  // positions change and the map callback re-applies OPEN for every
  // EVENT_DOOR_n_OPEN on load. Doors 7–11 span two blocks: the picture block
  // is a wall either way ($3f/$2a) and the block below opens its west column.
  GOLDENROD_UNDERGROUND_SWITCH_ROOM_ENTRANCES: [
    [16, 6, 0x3e, 0x2d],
    [10, 6, 0x3e, 0x2d],
    [2, 6, 0x3e, 0x2d],
    [2, 10, 0x3e, 0x2d],
    [10, 10, 0x3e, 0x2d],
    [16, 10, 0x3e, 0x2d],
    [12, 6, 0x3f, 0x2a, 12, 8, 0x3d, 0x2d],
    [6, 6, 0x3f, 0x2a, 6, 8, 0x3d, 0x2d],
    [12, 10, 0x3f, 0x2a, 12, 12, 0x3d, 0x2d],
    [6, 10, 0x3f, 0x2a, 6, 12, 0x3d, 0x2d],
    [18, 10, 0x3f, 0x2a, 18, 12, 0x3d, 0x2d],
  ].map((row, index) => ugdoor(index + 1, row)),
  // Elite Four rooms: the exit ladder appears after each victory (changeblock 4, 2, $16);
  // Lance's (changeblock 4, 0, $0b: ladder on row 1, row 0 stays wall) leads to the Hall of Fame.
  ...Object.fromEntries(['WILLS', 'KOGAS', 'BRUNOS', 'KARENS'].map((who) => [`${who}_ROOM`, [{ event: `EVENT_${who}_ROOM_EXIT_OPEN`, set: [[4, 2, 0x16]] }]])),
  LANCES_ROOM: [{ event: 'EVENT_LANCES_ROOM_EXIT_OPEN', set: [[4, 0, 0x0b]] }],
  // BlackthornGym1F.asm BlackthornGym1FBouldersCallback: each fallen boulder
  // bridges one lava tile (8,3), (2,5), (8,7); the rest of its block stays wall.
  BLACKTHORN_GYM_1F: [[1, 8, 2, 0x3b], [2, 2, 4, 0x3a], [3, 8, 6, 0x3b]].map(([n, x, y, block]) => ({ event: `EVENT_BOULDER_IN_BLACKTHORN_GYM_${n}`, set: [[x, y, block]] })),
});

/**
 * Holes that swallow a specific Strength boulder (maps/*.asm `stonetable
 * warp, object, script`): tile → map-object index of the boulder that falls
 * there. Ice Path B1F drops onto B2F where the boulders stop the ice slides;
 * Blackthorn Gym 2F drops bridge the 1F lava (BlackthornGym1FBouldersCallback).
 */
export const BOULDER_HOLES = Object.freeze({
  ICE_PATH_B1F: new Map([['11,2', 1], ['4,7', 2], ['5,12', 3], ['12,13', 4]]),
  BLACKTHORN_GYM_2F: new Map([['8,3', 3], ['2,5', 4], ['8,7', 5]]),
});

/** The changeblocks in force on `mapId` under the current flags: [{x, y, block}]. */
export function eventOpenings(mapId, hasEvent) {
  return (EVENT_OPENINGS[mapId] ?? [])
    .flatMap((entry) => (hasEvent(entry.event) ? entry.set ?? [] : entry.clear ?? []))
    .map(([x, y, block]) => ({ x, y, block }));
}

/**
 * Static object blockers for planning: source object events that are still
 * visible under the current event flags (an object_event disappears once its
 * event flag is set). Live objects replace these on the current map.
 */
export function staticBlockers(world, mapId, hasEvent) {
  return world.map(mapId).objectEvents
    .filter((object) => object.flag === '-1' || !hasEvent(object.flag))
    .map((object) => ({ x: object.x, y: object.y, source: object.script }));
}

/**
 * Blockers on the current map. The engine loads an object struct only for
 * map objects near the player (map_objects.asm InitializeVisibleSprites), so
 * every visible entry of wMapObjects counts, at its live position when it is
 * loaded (Ice Path B2F: the fallen boulders that stop the slides were off the
 * loaded list from the stairs, 2026-09-05).
 */
export function liveBlockers(observation) {
  const loaded = new Map(observation.objects.filter((object) => object.index !== 0).map((object) => [object.mapObjectIndex, object]));
  const blockers = [];
  const listed = new Set();
  for (const entry of observation.mapObjects ?? []) {
    if (entry.hidden) continue;
    listed.add(entry.index);
    const live = loaded.get(entry.index);
    blockers.push(live ? { x: live.x, y: live.y, source: `object-${live.index}` } : { x: entry.x, y: entry.y, source: `map-object-${entry.index}` });
  }
  for (const object of loaded.values()) {
    if (!listed.has(object.mapObjectIndex)) blockers.push({ x: object.x, y: object.y, source: `object-${object.index}` });
  }
  return blockers;
}

export function currentMapId(world, observation) {
  return world.idOf(observation.map.group, observation.map.number);
}

const ADJACENT = Object.freeze([
  { dx: 0, dy: 1, face: 'up' }, { dx: 0, dy: -1, face: 'down' }, { dx: -1, dy: 0, face: 'right' }, { dx: 1, dy: 0, face: 'left' },
]);

/**
 * Candidate standing tiles next to an approach point (an NPC or counter),
 * each with the direction to face so an A press targets the point.
 */
const COUNTER_COLLISION = new Set([0x90, 0x98]);

export function approachCandidates(world, mapId, approach, blockers = [], { capabilities = {} } = {}) {
  const grid = createMapGrid(world, mapId, { blockers, capabilities });
  // A surfing player talks to objects from the water (the Red Gyarados sits
  // in the middle of Lake of Rage), so water tiles count once Surf is usable.
  const standable = (tile) => grid.isLand(tile.x, tile.y) || (capabilities.surf === true && grid.isWater(tile.x, tile.y));
  const free = (tile) => grid.inBounds(tile.x, tile.y) && standable(tile) && !blockers.some((blocker) => blocker.x === tile.x && blocker.y === tile.y);
  const candidates = [];
  for (const { dx, dy, face } of ADJACENT) {
    const adjacent = { x: approach.x + dx, y: approach.y + dy, face };
    if (free(adjacent)) { candidates.push(adjacent); continue; }
    // Counters (COLL_COUNTER) are talked across: stand one tile further out.
    if (grid.inBounds(adjacent.x, adjacent.y) && COUNTER_COLLISION.has(grid.collisionAt(adjacent.x, adjacent.y))) {
      const beyond = { x: approach.x + dx * 2, y: approach.y + dy * 2, face, acrossCounter: true };
      if (free(beyond)) candidates.push(beyond);
    }
  }
  return candidates;
}

/**
 * Resolves an `approachSprite` destination to the visible source object with
 * that sprite (object_events hide once their event flag is set), so the
 * target follows the story instead of a fixed tile.
 */
export function resolveDestination(world, destination, hasEvent, { observation = null, knowledge = null, currentMap = null } = {}) {
  if (!destination.approachSprite) return destination;
  const distance = (object) => (destination.near ? Math.abs(object.x - destination.near.x) + Math.abs(object.y - destination.near.y) : 0);
  const visible = world.map(destination.mapId).objectEvents
    .filter((object) => object.sprite === destination.approachSprite)
    .filter((object) => object.flag === '-1' || !hasEvent(object.flag))
    .sort((left, right) => distance(left) - distance(right));
  const chosen = visible[0] ?? null;
  if (!chosen) return null;
  let approach = { x: chosen.x, y: chosen.y };
  // On the destination map, wMapObjects carries the object's live coordinates
  // (wanderers move); match by map-object index, which is the object_event order.
  if (observation && currentMap === destination.mapId) {
    const live = observation.mapObjects.find((object) => object.index === chosen.index);
    if (live && live.sprite === (knowledge?.spriteIds?.get(chosen.sprite) ?? live.sprite)) approach = { x: live.x, y: live.y };
  }
  return { mapId: destination.mapId, approach, facings: destination.facings ?? null, sprite: chosen.sprite, script: chosen.script };
}

export function fieldCapabilities(observation, knowledge) {
  const cutId = knowledge?.moveIds?.get('CUT') ?? 15;
  const surfId = knowledge?.moveIds?.get('SURF') ?? 57;
  const strengthId = knowledge?.moveIds?.get('STRENGTH') ?? 70;
  const whirlpoolId = knowledge?.moveIds?.get('WHIRLPOOL') ?? 250;
  const waterfallId = knowledge?.moveIds?.get('WATERFALL') ?? 127;
  const knows = (id) => observation.party.some((member) => !member.isEgg && member.moves.some((move) => move.id === id));
  return {
    cut: knows(cutId) && observation.trainer.badges.includes('HIVE'),
    surf: knows(surfId) && observation.trainer.badges.includes('FOG'),
    strength: knows(strengthId) && observation.trainer.badges.includes('PLAIN'),
    whirlpool: knows(whirlpoolId) && observation.trainer.badges.includes('GLACIER'),
    waterfall: knows(waterfallId) && observation.trainer.badges.includes('RISING'),
  };
}

const BOULDER_SPRITE = 0x5a; // SPRITE_BOULDER (constants/sprite_constants.asm)

/**
 * Live boulder and non-boulder object positions on the current map. Hidden
 * map objects (a boulder that fell through its hole, a taken item ball) keep
 * their coordinates in wMapObjects and are skipped.
 */
export function liveBoulders(observation, knowledge) {
  const boulderId = knowledge?.spriteIds?.get('SPRITE_BOULDER') ?? BOULDER_SPRITE;
  const present = observation.mapObjects.filter((object) => !object.hidden);
  const boulders = present.filter((object) => object.sprite === boulderId).map(({ x, y, index }) => ({ x, y, index }));
  const others = present.filter((object) => object.sprite !== boulderId).map(({ x, y }) => ({ x, y }));
  return { boulders, others };
}

export function planFromObservation({ world, observer, observation, destination: requested, maximumMaps = 3000, knowledge = null }) {
  const mapId = currentMapId(world, observation);
  if (!mapId) throw new NavigationError(`observation map ${observation.map.group}/${observation.map.number} is not a known Crystal map`);
  const hasEvent = (flag) => observer.hasEvent(observation, flag);
  const destination = resolveDestination(world, requested, hasEvent, { observation, knowledge, currentMap: mapId });
  if (!destination) return { mapId, legs: null, target: requested, missing: requested.approachSprite };
  const blockersFor = (candidate) => (
    candidate === mapId ? liveBlockers(observation) : staticBlockers(world, candidate, hasEvent)
  );
  const openingsFor = (candidate) => eventOpenings(candidate, hasEvent);
  const from = { mapId, x: observation.map.x, y: observation.map.y };
  const capabilities = fieldCapabilities(observation, knowledge);
  // Strength puzzles: when the destination is on this map and boulders stand
  // in the way, search over player + boulder positions instead.
  if (destination.mapId === mapId && capabilities.strength) {
    const { boulders, others } = liveBoulders(observation, knowledge);
    if (boulders.length > 0 && destination.boulderHoles) {
      // Drop the next boulder into its hole (keeping the rest solvable); the objective re-plans until every hole is filled.
      const grid = createMapGrid(world, mapId, { capabilities, openings: openingsFor(mapId) });
      const route = planBoulderDrop(grid, from, boulders, { npcs: others, holes: BOULDER_HOLES[mapId] ?? new Map() });
      if (route) return { mapId, legs: [{ mapId, route, transition: null }], target: { mapId, boulderHoles: true }, boulders: true };
      return { mapId, legs: null, target: { mapId, boulderHoles: true } };
    }
    if (boulders.length > 0) {
      const grid = createMapGrid(world, mapId, { capabilities, openings: openingsFor(mapId) });
      const goals = destination.approach
        ? approachCandidates(world, mapId, destination.approach, others, { capabilities }).filter((tile) => !destination.facings || destination.facings.includes(tile.face))
        : destination.x !== undefined ? [{ x: destination.x, y: destination.y }] : [];
      for (const goal of goals) {
        const route = findRouteWithBoulders(grid, from, { x: goal.x, y: goal.y }, boulders, { npcs: others });
        if (route) return { mapId, legs: [{ mapId, route, transition: null }], target: { mapId, ...goal }, boulders: route.some((step) => step.push) };
      }
    }
  }
  const targets = destination.approach
    ? approachCandidates(world, destination.mapId, destination.approach, blockersFor(destination.mapId), { capabilities })
      .filter((tile) => !destination.facings || destination.facings.includes(tile.face))
      .map((tile) => ({ mapId: destination.mapId, x: tile.x, y: tile.y, face: tile.face }))
    : destination.boulderHoles ? [{ mapId: destination.mapId }]
    : [destination];
  for (const target of targets) {
    const legs = planJourney(world, from, target, { blockersFor, openingsFor, maximumMaps, capabilities });
    if (legs) return { mapId, legs, target };
  }
  // Fallback: other maps' static objects may have moved or be conditional;
  // plan with live blockers only and let execution re-plan on contact.
  const liveOnly = (candidate) => (candidate === mapId ? liveBlockers(observation) : []);
  for (const target of targets) {
    const legs = planJourney(world, from, target, { blockersFor: liveOnly, openingsFor, maximumMaps, capabilities });
    if (legs) return { mapId, legs, target, fallback: 'live-blockers-only' };
  }
  // Last resort: when the only obstacle is a live object on this map, report
  // it so the executor can talk through it. Eusine appears on the one-tile
  // corridor of Burned Tower B1F after the beasts are released and leaves only
  // after his dialog (BurnedTowerB1FEusine: applymovement + disappear).
  const ignoringLive = (candidate) => (candidate === mapId ? [] : staticBlockers(world, candidate, hasEvent));
  const live = liveBlockers(observation);
  for (const target of targets) {
    const legs = planJourney(world, from, target, { blockersFor: ignoringLive, openingsFor, maximumMaps, capabilities });
    if (!legs) continue;
    const onRoute = legs[0].route.find((step) => live.some((blocker) => blocker.x === step.to.x && blocker.y === step.to.y));
    if (!onRoute) continue;
    const object = observation.objects.find((entry) => entry.index !== 0 && entry.x === onRoute.to.x && entry.y === onRoute.to.y) ?? null;
    return {
      mapId, legs: null, target,
      blockedBy: { x: onRoute.to.x, y: onRoute.to.y, index: object?.index ?? null, sprite: object?.sprite ?? null, mapObjectIndex: object?.mapObjectIndex ?? null },
    };
  }
  return { mapId, legs: null, target: targets[0] ?? destination };
}

/** True when a script or menu stays active across a few frames (not a transient scene-script tick). */
const onWalkOutTile = (world, observation) => {
  const mapId = currentMapId(world, observation);
  if (!mapId) return false;
  const map = world.map(mapId);
  return WALK_OUT_TILES.has(map.collision[observation.map.y * map.width + observation.map.x]);
};

export function* scriptPersists(observe, frames = 16) {
  for (let index = 0; index < frames; index += 1) {
    const observation = observe();
    if (!observation.scriptRunning && !textboxOpen(observation) && !yesNoMenuOpen(observation)) return false;
    yield [];
  }
  return true;
}

const arrived = (world, observation, destination, hasEvent = () => false) => {
  const mapId = currentMapId(world, observation);
  if (mapId !== destination.mapId) return false;
  // Boulder puzzles: done when one more of the listed fall events has flipped since the plan was made.
  if (destination.boulderHoles) {
    const fallen = (destination.fallEvents ?? []).filter((entry) => hasEvent(entry.event) === entry.fallenWhenSet).length;
    return fallen > (destination.fallen ?? 0);
  }
  if (destination.approach) {
    return approachCandidates(world, mapId, destination.approach, [], { capabilities: fieldCapabilities(observation) })
      .filter((tile) => !destination.facings || destination.facings.includes(tile.face))
      .some((tile) => observation.map.x === tile.x && observation.map.y === tile.y);
  }
  if (destination.x === undefined) return true;
  return observation.map.x === destination.x && observation.map.y === destination.y;
};

/** Direction to face from the current tile toward an approach point, or null. */
export function facingToward(observation, approach) {
  const found = ADJACENT.find(({ dx, dy }) => (
    (observation.map.x === approach.x + dx && observation.map.y === approach.y + dy) ||
    (observation.map.x === approach.x + dx * 2 && observation.map.y === approach.y + dy * 2)
  ));
  return found ? found.face : null;
}

/**
 * Walks to `destination` ({mapId, x?, y?}). Yields controller frames. Returns
 * a record of executed segments. Re-plans after scripts, blocks and map
 * transitions; throws when the plan cannot be completed.
 */
export function* travelTo({ world, observer, destination: requestedDestination, onDecision = null, maximumReplans = 40, log = null, knowledge = null, onCut = null, onSurf = null, onStrength = null, onWhirlpool = null, onWaterfall = null, onPrompt = null, maximumTalkThroughs = 3 }) {
  const observe = observer.observe;
  const executed = [];
  const talkThroughs = new Map();
  let replans = 0;
  let blockedRetries = 0;
  for (;;) {
    let observation = observe();
    if (yield* scriptPersists(observe)) {
      const settled = yield* advanceScript(observe);
      observation = settled.observation;
      if (settled.reason === 'battle') return { arrived: false, reason: 'battle', executed };
    }
    if (observation.battle) return { arrived: false, reason: 'battle', executed };
    // A player on a door or cave-mouth tile is walking out of it (the exit
    // step after a warp); wait for the step so the plan starts from the tile
    // below, not from a tile that is never stood on (Route 44 (56,7), 2026-09-05).
    if (onWalkOutTile(world, observation)) {
      for (let waited = 0; waited < 240 && onWalkOutTile(world, observe()); waited += 1) yield* holdFrames([], 1);
      yield* holdFrames([], 8);
      observation = observe();
    }
    const destination = resolveDestination(world, requestedDestination, (flag) => observer.hasEvent(observation, flag), { observation, knowledge, currentMap: currentMapId(world, observation) });
    if (!destination) return { arrived: false, reason: 'target-absent', executed, missing: requestedDestination.approachSprite };
    if (arrived(world, observation, destination, (flag) => observer.hasEvent(observation, flag))) return { arrived: true, reason: 'arrived', executed, face: destination.approach ? facingToward(observation, destination.approach) : null };
    if (replans >= maximumReplans) throw new NavigationError('navigation exceeded its re-plan budget', { destination, executed });
    replans += 1;
    const { mapId, legs, fallback, boulders, blockedBy } = planFromObservation({ world, observer, observation, destination: requestedDestination, knowledge });
    if (fallback) log?.({ event: 'plan-fallback', fallback, destination });
    if (boulders && !observation.strengthActive && onStrength) {
      // Activate Strength on this map first: face the nearest boulder and answer the prompt.
      const activated = yield* onStrength(observation);
      log?.({ event: 'strength', activated });
      continue;
    }
    if (!legs && blockedBy) {
      // A live object stands on the only route: walk up to it, talk, re-plan.
      // Bounded per tile so an immovable object still ends in a NavigationError.
      const key = `${blockedBy.x},${blockedBy.y}`;
      const attempt = (talkThroughs.get(key) ?? 0) + 1;
      talkThroughs.set(key, attempt);
      if (attempt <= maximumTalkThroughs) {
        log?.({ event: 'talk-through', blockedBy, attempt, destination });
        onDecision?.({ kind: 'navigation', mapId, destination, talkThrough: { blockedBy, attempt } });
        const step = yield* travelTo({ world, observer, knowledge, log, onPrompt, onCut, onSurf, destination: { mapId, approach: { x: blockedBy.x, y: blockedBy.y } }, maximumReplans: 6, maximumTalkThroughs: 0 });
        if (step.reason === 'battle') return { arrived: false, reason: 'battle', executed };
        if (step.arrived && step.face) {
          yield* face(step.face);
          const settled = yield* interact(observe, { onPrompt });
          if (settled.reason === 'battle') return { arrived: false, reason: 'battle', executed };
          yield* holdFrames([], 30);
        }
        continue;
      }
    }
    if (!legs) throw new NavigationError(`no route from ${mapId} ${observation.map.x},${observation.map.y} to ${destination.mapId}${destination.approach ? ` approach ${destination.approach.x},${destination.approach.y}` : destination.x !== undefined ? ` ${destination.x},${destination.y}` : ''}`, { destination });
    const leg = legs[0];
    const segments = segmentRoute(leg.route);
    onDecision?.({ kind: 'navigation', mapId, destination, leg: { mapId: leg.mapId, transition: leg.transition, segments } });
    if (segments.length === 0 && leg.transition === null) return { arrived: true, reason: 'arrived', executed };
    let interrupted = false;
    for (let segment of segments) {
      if (segment.cut) {
        // Face the tree and answer "Use CUT?" before stepping through it.
        const cutResult = onCut ? yield* onCut(segment.direction) : null;
        log?.({ event: 'cut', direction: segment.direction, result: cutResult });
        yield* holdFrames([], 20);
      }
      if (segment.whirlpool) {
        // Face the whirlpool from the water and answer "Use WHIRLPOOL?"; the tile becomes water.
        const result = onWhirlpool ? yield* onWhirlpool(segment.direction) : null;
        log?.({ event: 'whirlpool', direction: segment.direction, result });
        yield* holdFrames([], 30);
      }
      if (segment.waterfall) {
        // Face the fall and answer "Use WATERFALL?"; the climb moves the player on its own.
        const result = onWaterfall ? yield* onWaterfall(segment.direction) : null;
        log?.({ event: 'waterfall', direction: segment.direction, result });
        let previous = observe();
        for (let stable = 0, waited = 0; stable < 20 && waited < 900; waited += 1) {
          yield* holdFrames([], 1);
          const now = observe();
          stable = now.map.x === previous.map.x && now.map.y === previous.map.y ? stable + 1 : 0;
          previous = now;
        }
        executed.push({ direction: segment.direction, requested: segment.steps, completed: segment.steps, reason: 'waterfall', from: null, to: { group: previous.map.group, number: previous.map.number, x: previous.map.x, y: previous.map.y }, waterfall: true });
        interrupted = true;
        break;
      }
      if (segment.descend) {
        // One step onto the falls; the current then carries the player down to the water below.
        const entry = yield* walkSegment(observe, 'down', 1, { blockedFrames: 120 });
        let previous = observe();
        for (let stable = 0, waited = 0; stable < 20 && waited < 600; waited += 1) {
          yield* holdFrames([], 1);
          const now = observe();
          stable = now.map.x === previous.map.x && now.map.y === previous.map.y ? stable + 1 : 0;
          previous = now;
        }
        executed.push({ direction: 'down', requested: segment.steps, completed: entry.completedSteps, reason: entry.reason === 'blocked' ? 'blocked' : 'descend', from: entry.from, to: { group: previous.map.group, number: previous.map.number, x: previous.map.x, y: previous.map.y }, descend: true });
        log?.({ event: 'descend', ...executed.at(-1) });
        if (entry.reason === 'blocked') {
          blockedRetries += 1;
          if (blockedRetries > 12) throw new NavigationError('navigation is repeatedly blocked', { destination, executed });
        }
        interrupted = true;
        break;
      }
      if (segment.surf) {
        // Face the water and answer "Want to SURF?"; the mount animation moves
        // the player onto the water tile, so this segment's step is consumed.
        const surfResult = onSurf ? yield* onSurf(segment.direction) : null;
        log?.({ event: 'surf', direction: segment.direction, result: surfResult });
        yield* holdFrames([], 30);
        const mounted = observe();
        executed.push({ direction: segment.direction, requested: segment.steps, completed: 1, reason: 'surf', from: null, to: { group: mounted.map.group, number: mounted.map.number, x: mounted.map.x, y: mounted.map.y }, surf: true });
        if (segment.steps <= 1) continue;
        segment = { ...segment, steps: segment.steps - 1 };
      }
      const result = yield* walkSegment(observe, segment.direction, segment.steps, segment.push ? { blockedFrames: 150 } : {});
      executed.push({ direction: result.direction, requested: result.requestedSteps, completed: result.completedSteps, reason: result.reason, from: result.from, to: result.to, ...(segment.push ? { push: true } : {}) });
      log?.({ event: 'walk', ...executed.at(-1) });
      if (result.reason === 'steps') continue;
      if (result.reason === 'map-changed') {
        interrupted = true;
        break;
      }
      if (result.reason === 'blocked') {
        blockedRetries += 1;
        if (blockedRetries > 12) throw new NavigationError('navigation is repeatedly blocked', { destination, executed });
        yield* holdFrames([], 30);
        interrupted = true;
        break;
      }
      // script or battle: settle at the top of the loop.
      interrupted = true;
      break;
    }
    if (!interrupted && leg.transition?.kind === 'warp') {
      // Door, stair and panel warps fire when the tile is entered. Carpet warps
      // (COLL_WARP_CARPET_*) fire when the player steps off the carpet in the
      // carpet's direction, so take that one extra step here.
      const before = observe();
      if (currentMapId(world, before) === mapId) {
        const grid = createMapGrid(world, mapId);
        const collision = grid.collisionAt(before.map.x, before.map.y);
        const exitDirection = WARP_EXIT_DIRECTION[collision] ?? segments.at(-1)?.direction ?? before.facing;
        const result = yield* walkSegment(observe, exitDirection, 1, { blockedFrames: 120 });
        executed.push({ direction: result.direction, requested: 1, completed: result.completedSteps, reason: result.reason, from: result.from, to: result.to, warpExit: true });
        log?.({ event: 'warp-exit', ...executed.at(-1) });
        if (result.reason === 'blocked') {
          blockedRetries += 1;
          if (blockedRetries > 12) throw new NavigationError('warp did not fire', { destination, executed });
        }
      }
      yield* holdFrames([], 30);
    }
    if (!interrupted) blockedRetries = 0;
  }
}

export function describeGrid(world, observation) {
  const mapId = currentMapId(world, observation);
  if (!mapId) return null;
  const grid = createMapGrid(world, mapId, { blockers: liveBlockers(observation) });
  return grid.render({ [`${observation.map.x},${observation.map.y}`]: '@' });
}
