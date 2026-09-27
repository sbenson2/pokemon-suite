// Tile-level movement model and router over the source-derived Crystal world.
//
// Coordinates are the cartridge's own wXCoord/wYCoord tile coordinates. Every
// movement rule below mirrors pokecrystal: collision permissions come from
// CollisionPermissionTable, ledges are one-way two-tile hops, map connections
// enter the neighbouring map with the strip offsets used by EnterMapConnection
// (engine/overworld/warp_connection.asm), and warps are entered by stepping on
// the warp tile.

export const DIRECTIONS = Object.freeze({
  up: Object.freeze({ dx: 0, dy: -1, opposite: 'down' }),
  down: Object.freeze({ dx: 0, dy: 1, opposite: 'up' }),
  left: Object.freeze({ dx: -1, dy: 0, opposite: 'right' }),
  right: Object.freeze({ dx: 1, dy: 0, opposite: 'left' }),
});

const PERMISSION_MASK = 0x0f;
const WALL = 0x0f;
const WATER = 0x01;

const HOP_DIRECTIONS = Object.freeze({
  0xa0: ['right'],
  0xa1: ['left'],
  0xa2: ['up'],
  0xa3: ['down'],
  0xa4: ['down', 'right'],
  0xa5: ['down', 'left'],
  0xa6: ['up', 'right'],
  0xa7: ['up', 'left'],
});

const SIDE_OF = Object.freeze({ up: 'north', down: 'south', left: 'west', right: 'east' });

// home/map.asm GetMovementPermissions: a side-wall/buoy tile the player stands
// on blocks the directions in .MovementPermissionsData (indexed by its low
// three bits), and a neighbouring tile blocks entry when its wall faces the
// player (tile below with an UP wall blocks moving down, and so on).
// The standing table is written with DOWN_MASK/UP_MASK/LEFT_MASK/RIGHT_MASK
// (bits 0–3, ram_constants.asm) but DoPlayerMovement.CheckLandPerms tests
// wTilePermissions against wFacingDirection = FACE_RIGHT/LEFT/UP/DOWN
// (1/2/4/8), so bit 0 blocks right, bit 1 left, bit 2 up and bit 3 down:
// a COLL_UP_WALL ($b2) blocks moving up, as its name says (the 2026-09-05
// Ice Path 1F rim stall: pressing up at (26,10) into the ice never moved).
const isSideWall = (collision) => (collision & 0xf0) === 0xb0 || (collision & 0xf0) === 0xc0;
const STANDING_BLOCKS = Object.freeze([
  ['right'], ['left'], ['up'], ['down'], ['down', 'right'], ['down', 'left'], ['up', 'right'], ['up', 'left'],
]);
const ENTRY_BLOCKS = Object.freeze({
  down: new Set([2, 6, 7]), // COLL_UP_WALL, COLL_UP_RIGHT_WALL, COLL_UP_LEFT_WALL below
  up: new Set([3, 4, 5]), // COLL_DOWN_WALL, COLL_DOWN_RIGHT_WALL, COLL_DOWN_LEFT_WALL above
  right: new Set([1, 5, 7]), // COLL_LEFT_WALL, COLL_DOWN_LEFT_WALL, COLL_UP_LEFT_WALL to the right
  left: new Set([0, 4, 6]), // COLL_RIGHT_WALL, COLL_DOWN_RIGHT_WALL, COLL_UP_RIGHT_WALL to the left
});

// Land tiles the walker deliberately avoids: ice slides, pits, and forced
// movement/brake strips change position without input and are not modelled.
const AVOIDED_LAND = new Set([0x60, 0x68]);
// COLL_ICE (0x23) and COLL_ICE_2B: engine/overworld/player_movement.asm
// keeps stepping in the walking direction (STEP_ICE) while the standing tile
// is ice, until the next tile is blocked (.bump) — so a route may pass over
// ice but can only stop where the slide ends.
const ICE = new Set([0x23, 0x2b]);
// COLL_DOOR and COLL_CAVE: the warp fires on entry and a player arriving on
// one walks out of it one tile down before control returns, so the tile is
// never stood on (Route 44 (56,7) ↔ Ice Path 1F ping-pong, 2026-09-05).
export const WALK_OUT_TILES = new Set([0x71, 0x7b]);

// Warp events drawn as floor until a scene changes the block: the Mahogany
// souvenir shop staircase (maps/MahoganyMart1F.asm, MahoganyMart1FLanceUncoversStairsScene
// → changeblock 6, 2, $1e, warp_event 7, 3 → TEAM_ROCKET_BASE_B1F).
export const REVEALED_WARPS = Object.freeze({
  MAHOGANY_MART_1F: Object.freeze([{ x: 7, y: 3 }]),
});
const isForcedWalk = (collision) => (collision & 0xf0) === 0x40 || (collision & 0xf0) === 0x50;

export class RouteError extends Error {
  constructor(message) {
    super(message);
    this.name = 'RouteError';
  }
}

const key = (x, y) => `${x},${y}`;

export function connectionArrival(connection, targetMap, x, y) {
  const shift = -2 * connection.offset;
  switch (connection.direction) {
    case 'west': return { x: targetMap.width - 1, y: y + shift };
    case 'east': return { x: 0, y: y + shift };
    case 'north': return { x: x + shift, y: targetMap.height - 1 };
    case 'south': return { x: x + shift, y: 0 };
    default: throw new RouteError(`unknown connection direction ${connection.direction}`);
  }
}

/**
 * Builds a movement model for one map. `blockers` are live or static object
 * positions ({x, y}) that occupy tiles; `openings` are the changeblocks in
 * force ({x, y, block}, navigation.mjs eventOpenings). `world` is a loaded
 * Crystal world.
 */
const CUT_TREE = new Set([0x12, 0x1a]);

export function createMapGrid(world, mapId, { blockers = [], capabilities = {}, openings = [] } = {}) {
  const map = world.map(mapId);
  const { width, height } = map;
  const blocked = new Set(blockers.map(({ x, y }) => key(x, y)));
  const canCut = capabilities.cut === true;
  const canSurf = capabilities.surf === true;
  const canWhirlpool = capabilities.whirlpool === true; // HM06 + Glacier Badge (engine/events/overworld.asm TryWhirlpoolOW)
  const canWaterfall = capabilities.waterfall === true; // HM07 + Rising Badge (TryWaterfallOW)
  const inBounds = (x, y) => x >= 0 && y >= 0 && x < width && y < height;
  // Blocks a map script rewrites with changeblock under an event flag (locked
  // doors, shutters, fallen boulders; navigation.mjs EVENT_OPENINGS): the
  // block's four tiles take the new block's tileset collision, exactly as
  // Script_changeblock rewrites wOverworldMapBlocks (engine/overworld/scripting.asm).
  const changed = new Map();
  if (openings.length > 0) {
    const quads = world.tilesetCollision(map.tileset);
    for (const { x, y, block } of openings) {
      const quad = quads[block];
      if (!quad) throw new RouteError(`${mapId}: changeblock ${x}, ${y} to block ${block} outside tileset ${map.tileset}`);
      for (let dy = 0; dy < 2; dy += 1) {
        for (let dx = 0; dx < 2; dx += 1) changed.set(key((x & ~1) + dx, (y & ~1) + dy), quad[(dy << 1) | dx]);
      }
    }
  }
  const collisionAt = (x, y) => (
    changed.get(key(x, y)) ?? (inBounds(x, y) ? map.collision[y * width + x] : map.borderCollision[((y & 1) << 1) | (x & 1)])
  );
  const permissionAt = (x, y) => world.permissions[collisionAt(x, y)] & PERMISSION_MASK;
  // Ledge tiles are ordinary land to stand on; the jump happens when the
  // player presses the ledge's direction while standing on it (.TryJump reads
  // the standing tile and hops over the wall tile beyond it).
  const isWater = (x, y) => (world.permissions[collisionAt(x, y)] & PERMISSION_MASK) === WATER;
  const isLand = (x, y) => {
    const collision = collisionAt(x, y);
    const permission = world.permissions[collision] & PERMISSION_MASK;
    return permission !== WALL && permission !== WATER && !AVOIDED_LAND.has(collision) && !isForcedWalk(collision);
  };
  const isIce = (x, y) => ICE.has(collisionAt(x, y));
  const warpAt = (x, y) => map.warps.find((warp) => warp.x === x && warp.y === y) ?? null;
  const connectionFor = (direction) => map.connections.find((entry) => entry.direction === direction) ?? null;
  const connectionCovers = (connection, x, y) => {
    const target = world.map(connection.mapId);
    const arrival = connectionArrival(connection, target, x, y);
    return arrival.x >= 0 && arrival.y >= 0 && arrival.x < target.width && arrival.y < target.height
      ? { target, arrival }
      : null;
  };

  const canStep = (x, y, direction) => {
    const vector = DIRECTIONS[direction];
    if (!vector) throw new RouteError(`unknown direction ${direction}`);
    const standing = collisionAt(x, y);
    if (isSideWall(standing) && STANDING_BLOCKS[standing & 7].includes(direction)) return { ok: false, reason: 'side-wall' };
    if (WALK_OUT_TILES.has(standing) && direction !== 'down') return { ok: false, reason: 'door-tile' };
    const hop = HOP_DIRECTIONS[standing];
    if (hop && hop.includes(direction)) {
      const lx = x + vector.dx * 2;
      const ly = y + vector.dy * 2;
      if (!inBounds(lx, ly) || !isLand(lx, ly) || blocked.has(key(lx, ly))) return { ok: false, reason: 'ledge-landing' };
      return { ok: true, to: { mapId, x: lx, y: ly }, hop: true };
    }
    const tx = x + vector.dx;
    const ty = y + vector.dy;
    if (!inBounds(tx, ty)) {
      const connection = connectionFor(SIDE_OF[direction]);
      if (!connection) return { ok: false, reason: 'map-edge' };
      const covered = connectionCovers(connection, tx, ty);
      if (!covered) return { ok: false, reason: 'outside-connection-strip' };
      let targetGrid;
      try { targetGrid = createMapGrid(world, connection.mapId, { capabilities }); } catch { return { ok: false, reason: 'connected-map-unmodelled' }; }
      if (!targetGrid.isLand(covered.arrival.x, covered.arrival.y) && !(canSurf && targetGrid.isWater(covered.arrival.x, covered.arrival.y))) return { ok: false, reason: 'connected-tile-blocked' };
      return {
        ok: true,
        to: { mapId: connection.mapId, x: covered.arrival.x, y: covered.arrival.y },
        connection: connection.direction,
      };
    }
    if (blocked.has(key(tx, ty))) return { ok: false, reason: 'object' };
    const entering = collisionAt(tx, ty);
    if (isSideWall(entering) && ENTRY_BLOCKS[direction].has(entering & 7)) return { ok: false, reason: 'side-wall' };
    // A cuttable tree is entered after using CUT on it (TryCutOW needs the
    // move in the party and the Hive Badge); the planner marks the step.
    if (canCut && CUT_TREE.has(entering)) return { ok: true, to: { mapId, x: tx, y: ty }, cut: true };
    // A pit with a warp event is a deliberate drop (Olivine Lighthouse 4F
    // (8,3)/(9,3) reach the inner staircase column); it is enterable as a goal.
    if ((entering === 0x60 || entering === 0x68) && warpAt(tx, ty)) return { ok: true, to: { mapId, x: tx, y: ty }, pit: true };
    // Surfing: water is traversable; stepping from land onto water needs the
    // "Want to SURF?" prompt (marked `surf`), water→land dismounts by itself.
    if (canSurf && isWater(tx, ty) && !((entering & 0xf0) === 0x30 || entering === 0x24 || entering === 0x2c)) {
      return { ok: true, to: { mapId, x: tx, y: ty }, ...(isWater(x, y) ? {} : { surf: true }) };
    }
    // A whirlpool (COLL_WHIRLPOOL) is cleared with HM06 from the adjacent water
    // tile ("Use WHIRLPOOL?"), after which it is plain water.
    if (canSurf && canWhirlpool && isWater(x, y) && (entering === 0x24 || entering === 0x2c)) {
      return { ok: true, to: { mapId, x: tx, y: ty }, whirlpool: true };
    }
    // A waterfall (COLL_WATERFALL) is climbed upward with HM07 from the water
    // below ("Use WATERFALL?"); the climb then continues on its own.
    if (canSurf && canWaterfall && direction === 'up' && (entering & 0xf0) === 0x30 && (isWater(x, y) || (standing & 0xf0) === 0x30)) {
      return { ok: true, to: { mapId, x: tx, y: ty }, waterfall: true };
    }
    // Riding a waterfall down needs only Surf: COLL_WATERFALL is a water tile
    // whose current (DoPlayerMovement.CheckTile, .water table: $33 → DOWN)
    // carries the player down until ordinary water (Tohjo Falls' east fall).
    if (canSurf && direction === 'down' && entering === 0x33 && (isWater(x, y) || standing === 0x33)) {
      return { ok: true, to: { mapId, x: tx, y: ty }, descend: true };
    }
    if (standing === 0x33) return { ok: false, reason: 'current' };
    if (!isLand(tx, ty)) return { ok: false, reason: permissionAt(tx, ty) === WATER ? 'water' : 'wall' };
    return { ok: true, to: { mapId, x: tx, y: ty } };
  };

  // home/map.asm CheckWarpCollision (HI_NYBBLE_WARPS) and the pit tiles.
  // Some warps sit on plain floor in the static map and only become warp
  // tiles when a scene changes the block (REVEALED_WARPS); the campaign
  // never routes through them before the scene has run.
  const revealed = REVEALED_WARPS[mapId] ?? [];
  const isHotWarp = (x, y) => {
    const collision = collisionAt(x, y);
    return (collision & 0xf0) === 0x70 || collision === 0x60 || collision === 0x68 || revealed.some((tile) => tile.x === x && tile.y === y);
  };

  return Object.freeze({
    mapId,
    map,
    width,
    height,
    inBounds,
    collisionAt,
    permissionAt,
    isLand,
    isWater,
    isIce,
    canStep,
    warpAt,
    isHotWarp,
    connectionFor,
    /** Renders the walkable surface for diagnostics. */
    render(marks = {}) {
      const rows = [];
      for (let y = 0; y < height; y += 1) {
        let row = '';
        for (let x = 0; x < width; x += 1) {
          const mark = marks[key(x, y)];
          if (mark) { row += mark; continue; }
          const collision = collisionAt(x, y);
          if (blocked.has(key(x, y))) row += 'o';
          else if (warpAt(x, y)) row += 'W';
          else if (HOP_DIRECTIONS[collision]) row += 'L';
          else if (permissionAt(x, y) === WATER) row += '~';
          else if (!isLand(x, y)) row += '#';
          else if (collision === 0x18 || collision === 0x14) row += ',';
          else row += '.';
        }
        rows.push(row);
      }
      return rows.join('\n');
    },
  });
}

/**
 * Breadth-first route on one map. `goal` is either {x, y} or a predicate that
 * receives a candidate step result ({to, connection, hop}) and returns true
 * when that step completes the route (used for map exits).
 */
export function findRoute(grid, from, goal, { maximumSteps = 4_000 } = {}) {
  const goalPredicate = typeof goal === 'function'
    ? goal
    : (step) => step.to.mapId === grid.mapId && step.to.x === goal.x && step.to.y === goal.y;
  if (typeof goal !== 'function' && from.x === goal.x && from.y === goal.y) return [];
  const startKey = key(from.x, from.y);
  const previous = new Map([[startKey, null]]);
  const queue = [{ x: from.x, y: from.y }];
  let expanded = 0;
  while (queue.length > 0) {
    const current = queue.shift();
    expanded += 1;
    if (expanded > maximumSteps) break;
    for (const direction of Object.keys(DIRECTIONS)) {
      const step = grid.canStep(current.x, current.y, direction);
      if (!step.ok) continue;
      const records = [{ direction, from: { x: current.x, y: current.y }, to: step.to, hop: step.hop === true, connection: step.connection ?? null, cut: step.cut === true, surf: step.surf === true, ...(step.whirlpool ? { whirlpool: true } : {}), ...(step.waterfall ? { waterfall: true } : {}), ...(step.descend ? { descend: true } : {}) }];
      // Ice: the slide continues one tile per record until a non-ice tile, a
      // blocked tile (stop on the last ice tile) or a hot warp (fires on entry).
      if (!step.connection && !step.hop && grid.isIce?.(step.to.x, step.to.y)) {
        let cursor = step.to;
        while (grid.isIce(cursor.x, cursor.y) && !(grid.warpAt(cursor.x, cursor.y) && grid.isHotWarp(cursor.x, cursor.y))) {
          const next = grid.canStep(cursor.x, cursor.y, direction);
          if (!next.ok || next.connection || next.hop || next.cut || next.surf) break;
          records.push({ direction, from: cursor, to: next.to, hop: false, connection: null, cut: false, surf: false, slide: true });
          cursor = next.to;
        }
      }
      if (step.descend) {
        // The current carries the player down every waterfall tile onto the water below.
        let cursor = step.to;
        for (;;) {
          const next = grid.canStep(cursor.x, cursor.y, 'down');
          if (!next.ok || next.connection) break;
          records.push({ direction: 'down', from: cursor, to: next.to, hop: false, connection: null, cut: false, surf: false, ride: true });
          cursor = next.to;
          if (!next.descend) break;
        }
      }
      if (step.waterfall) {
        // The climb carries the player up every waterfall tile onto the water above.
        let cursor = step.to;
        for (;;) {
          const next = grid.canStep(cursor.x, cursor.y, 'up');
          if (!next.ok || next.connection) break;
          records.push({ direction: 'up', from: cursor, to: next.to, hop: false, connection: null, cut: false, surf: false, climb: true });
          cursor = next.to;
          if (!next.waterfall) break;
        }
      }
      const record = records.at(-1);
      if (goalPredicate(record)) {
        const path = [...records];
        let cursor = key(current.x, current.y);
        while (previous.get(cursor)) {
          const link = previous.get(cursor);
          path.unshift(...link);
          cursor = key(link[0].from.x, link[0].from.y);
        }
        return path;
      }
      if (step.connection) continue;
      // Stepping onto a warp tile warps immediately when its collision is a
      // warp type (doors, stairs, carpets) or a pit (Ecruteak Gym holes), so a
      // route never passes through one; a warp event on plain floor is inert.
      if (grid.warpAt(record.to.x, record.to.y) && grid.isHotWarp(record.to.x, record.to.y)) continue;
      const nextKey = key(record.to.x, record.to.y);
      if (previous.has(nextKey)) continue;
      previous.set(nextKey, records);
      queue.push({ x: record.to.x, y: record.to.y });
    }
  }
  return null;
}

/** Route to the nearest tile from which stepping `direction` leaves through the map connection. */
export function findConnectionExit(grid, from, direction) {
  return findRoute(grid, from, (step) => step.connection === direction);
}

/** Route onto a specific warp tile of the current map. */
export function findWarpRoute(grid, from, warpId) {
  const warp = grid.map.warps.find((entry) => entry.id === warpId);
  if (!warp) throw new RouteError(`map ${grid.mapId} has no warp ${warpId}`);
  return findRoute(grid, from, { x: warp.x, y: warp.y });
}

/**
 * Multi-map planner. Returns the ordered list of legs, each with the in-map
 * route and the transition that ends it, or null when unreachable.
 */
const MAGNET_TRAIN_STATION = /_MAGNET_TRAIN_STATION$/;
const FAST_SHIP = /^FAST_SHIP_/;
export const isRideWarp = (fromMapId, toMapId) => (
  (MAGNET_TRAIN_STATION.test(fromMapId) && MAGNET_TRAIN_STATION.test(toMapId))
  || (FAST_SHIP.test(toMapId) && !FAST_SHIP.test(fromMapId))
  || (FAST_SHIP.test(fromMapId) && !FAST_SHIP.test(toMapId))
);

export function planJourney(world, from, destination, { blockersFor = () => [], openingsFor = () => [], maximumMaps = 64, capabilities = {} } = {}) {
  const start = { mapId: from.mapId, x: from.x, y: from.y };
  const visited = new Set([`${start.mapId}:${start.x},${start.y}`]);
  const queue = [{ position: start, legs: [] }];
  let expandedMaps = 0;
  while (queue.length > 0) {
    const { position, legs } = queue.shift();
    expandedMaps += 1;
    if (expandedMaps > maximumMaps) break;
    let grid;
    try {
      grid = createMapGrid(world, position.mapId, { blockers: blockersFor(position.mapId), openings: openingsFor(position.mapId), capabilities });
    } catch {
      continue; // a map the extractor cannot model is never routed through
    }
    if (position.mapId === destination.mapId) {
      if (destination.x === undefined) return legs.length ? legs : [{ mapId: position.mapId, route: [], transition: null }];
      const route = findRoute(grid, position, { x: destination.x, y: destination.y });
      if (route) return [...legs, { mapId: position.mapId, route, transition: null }];
    }
    const exits = [];
    for (const warp of grid.map.warps) {
      if (!world.mapIds.includes(warp.mapId)) continue;
      // A warp event on plain floor never fires (Olivine Lighthouse 1F (16,13)
      // and (17,13), Ecruteak Gym); only warp-collision tiles are exits.
      if (!grid.isHotWarp(warp.x, warp.y)) continue;
      // Scripted rides are not walked: the Magnet Train (station → station,
      // `special MagnetTrain` behind the officer's PASS check) and the S.S.
      // Aqua (port → FAST_SHIP, S_S_TICKET). No ride step exists, so their
      // warps never join a journey (the 2026-09-05 Goldenrod station loop).
      if (isRideWarp(position.mapId, warp.mapId)) continue;
      const route = findRoute(grid, position, { x: warp.x, y: warp.y });
      if (!route) continue;
      let targetMap;
      try { targetMap = world.map(warp.mapId); } catch { continue; }
      const targetWarp = targetMap.warps.find((entry) => entry.id === warp.warpId);
      if (!targetWarp) continue;
      // Arriving on a door or cave mouth walks the player out one tile down; the next leg starts there.
      const walkOut = WALK_OUT_TILES.has(targetMap.collision[targetWarp.y * targetMap.width + targetWarp.x]);
      exits.push({
        route,
        transition: { kind: 'warp', warpId: warp.id, mapId: warp.mapId, targetWarpId: warp.warpId },
        arrival: { mapId: warp.mapId, x: targetWarp.x, y: targetWarp.y + (walkOut ? 1 : 0) },
      });
    }
    for (const connection of grid.map.connections) {
      const route = findConnectionExit(grid, position, connection.direction);
      if (!route) continue;
      const last = route.at(-1);
      exits.push({
        route,
        transition: { kind: 'connection', direction: connection.direction, mapId: connection.mapId },
        arrival: { mapId: last.to.mapId, x: last.to.x, y: last.to.y },
      });
    }
    exits.sort((left, right) => left.route.length - right.route.length);
    for (const exit of exits) {
      const marker = `${exit.arrival.mapId}:${exit.arrival.x},${exit.arrival.y}`;
      if (visited.has(marker)) continue;
      visited.add(marker);
      queue.push({
        position: exit.arrival,
        legs: [...legs, { mapId: position.mapId, route: exit.route, transition: exit.transition }],
      });
    }
  }
  return null;
}

/** Compresses a route into direction segments: [{direction, steps}]. */
export function segmentRoute(route) {
  const segments = [];
  for (const step of route) {
    const last = segments.at(-1);
    const special = step.cut || step.surf || step.whirlpool || step.waterfall || step.descend;
    const lastSpecial = last && (last.cut || last.surf || last.whirlpool || last.waterfall || last.descend);
    if (last && last.direction === step.direction && !step.hop && !last.hop && !special && !(lastSpecial && !last.waterfall && !(last.descend && step.ride))) {
      last.steps += 1;
      if (step.push) last.push = true;
    } else segments.push({ direction: step.direction, steps: 1, hop: step.hop === true, ...(step.cut ? { cut: true } : {}), ...(step.surf ? { surf: true } : {}), ...(step.whirlpool ? { whirlpool: true } : {}), ...(step.waterfall ? { waterfall: true } : {}), ...(step.descend ? { descend: true } : {}), ...(step.push ? { push: true } : {}) });
  }
  return segments;
}


/**
 * Route search that may push Strength boulders (SPRITE_BOULDER objects):
 * walking into a boulder moves it one tile in the same direction when the tile
 * beyond is free land (player_movement.asm .CheckStrengthBoulder), and the
 * player then steps into the vacated tile.
 *
 * Push-based search (the Sokoban trick): a state is the boulder layout plus
 * the region the player can walk without pushing, and a transition is one
 * push of one boulder from a reachable tile. Walking is collapsed into the
 * flood fill, so Ice Path B1F (four boulders that must be moved in order)
 * takes hundreds of states instead of millions.
 *
 * `goal` is a tile `{ x, y }` or `(position, boulderMap) => boolean`, tested
 * on every tile the player can reach. `holes` maps a hole tile to the index of
 * the one boulder that falls through it (maps/*.asm stonetable). Returns
 * steps with `push: true` on pushing moves and `drop: true` when the boulder
 * falls, or null.
 */
export function findRouteWithBoulders(grid, from, goal, boulders, { npcs = [], holes = new Map(), maximumStates = 60_000 } = {}) {
  const goalPredicate = typeof goal === 'function' ? goal : (position) => position.x === goal.x && position.y === goal.y;
  const npcSet = new Set(npcs.map(({ x, y }) => key(x, y)));
  const free = (x, y, map) => grid.inBounds(x, y) && grid.isLand(x, y) && !npcSet.has(key(x, y)) && !map.has(key(x, y));
  const step = (position, direction, extra = {}) => ({ direction, from: { x: position.x, y: position.y }, to: { mapId: grid.mapId, x: position.x + DIRECTIONS[direction].dx, y: position.y + DIRECTIONS[direction].dy }, push: false, ...extra });
  const encodeBoulders = (map) => [...map.entries()].map(([tile, index]) => `${tile}=${index}`).sort().join(';');

  // Flood fill the player's region: parent links for path reconstruction and
  // the goal test on every tile. Hot warps fire on entry, so they are not walked.
  const explore = (origin, map) => {
    const parents = new Map([[key(origin.x, origin.y), null]]);
    const order = [origin];
    let goalTile = goalPredicate(origin, map) ? origin : null;
    for (let cursor = 0; cursor < order.length && !goalTile; cursor += 1) {
      const position = order[cursor];
      for (const direction of Object.keys(DIRECTIONS)) {
        const x = position.x + DIRECTIONS[direction].dx;
        const y = position.y + DIRECTIONS[direction].dy;
        const tile = key(x, y);
        if (parents.has(tile) || !free(x, y, map) || grid.isHotWarp(x, y)) continue;
        parents.set(tile, { from: position, direction });
        const next = { x, y };
        order.push(next);
        if (goalPredicate(next, map)) { goalTile = next; break; }
      }
    }
    return { parents, order, goalTile };
  };
  const walkTo = (parents, target) => {
    const steps = [];
    for (let link = parents.get(key(target.x, target.y)); link; link = parents.get(key(link.from.x, link.from.y))) steps.unshift(step(link.from, link.direction));
    return steps;
  };
  const canonical = (order) => order.reduce((best, tile) => (tile.y < best.y || (tile.y === best.y && tile.x < best.x) ? tile : best), order[0]);

  const startMap = new Map(boulders.map((boulder, order) => [key(boulder.x, boulder.y), boulder.index ?? order + 1]));
  const first = explore({ x: from.x, y: from.y }, startMap);
  if (first.goalTile) return walkTo(first.parents, first.goalTile);
  const seen = new Set([`${key(canonical(first.order).x, canonical(first.order).y)}|${encodeBoulders(startMap)}`]);
  const queue = [{ position: { x: from.x, y: from.y }, map: startMap, region: first, path: [] }];
  let expanded = 0;
  while (queue.length > 0) {
    const { map, region, path } = queue.shift();
    expanded += 1;
    if (expanded > maximumStates) break;
    for (const [tile, index] of map) {
      const [bx, by] = tile.split(',').map(Number);
      for (const direction of Object.keys(DIRECTIONS)) {
        const vector = DIRECTIONS[direction];
        const behind = { x: bx - vector.dx, y: by - vector.dy };
        if (!region.parents.has(key(behind.x, behind.y))) continue;
        const ahead = { x: bx + vector.dx, y: by + vector.dy };
        // A boulder pushed onto a hole falls through only when the map's stone
        // table pairs that hole with that boulder (maps/*.asm stonetable). Holes
        // are not land for the walker (AVOIDED_LAND), so test them first.
        const drop = grid.inBounds(ahead.x, ahead.y) && grid.isHotWarp(ahead.x, ahead.y) && !npcSet.has(key(ahead.x, ahead.y)) && !map.has(key(ahead.x, ahead.y));
        if (drop ? holes.get(key(ahead.x, ahead.y)) !== index : !free(ahead.x, ahead.y, map)) continue;
        const nextMap = new Map(map);
        nextMap.delete(tile);
        if (!drop) nextMap.set(key(ahead.x, ahead.y), index);
        const vacated = { x: bx, y: by };
        const nextPath = [...path, ...walkTo(region.parents, behind), step(behind, direction, { push: true, ...(drop ? { drop: true } : {}) })];
        const next = explore(vacated, nextMap);
        if (next.goalTile) return [...nextPath, ...walkTo(next.parents, next.goalTile)];
        const anchor = canonical(next.order);
        const code = `${key(anchor.x, anchor.y)}|${encodeBoulders(nextMap)}`;
        if (seen.has(code)) continue;
        seen.add(code);
        queue.push({ position: vacated, map: nextMap, region: next, path: nextPath });
      }
    }
  }
  return null;
}

/** Boulder layout after walking `route` (pushes move, drops remove); player ends on the last step. */
export function simulateBoulderRoute(boulders, route) {
  let live = boulders.map((boulder) => ({ ...boulder }));
  for (const step of route) {
    if (!step.push) continue;
    const vector = DIRECTIONS[step.direction];
    const boulder = live.find((entry) => entry.x === step.to.x && entry.y === step.to.y);
    if (!boulder) throw new RouteError(`push at ${step.to.x},${step.to.y} finds no boulder`);
    if (step.drop) live = live.filter((entry) => entry !== boulder);
    else { boulder.x += vector.dx; boulder.y += vector.dy; }
  }
  return { boulders: live, position: route.length > 0 ? { x: route.at(-1).to.x, y: route.at(-1).to.y } : null };
}

/**
 * Plan the next hole to fill on a Strength puzzle. Tries the holed boulders
 * in index order and keeps the first drop after which every remaining holed
 * boulder can still reach its hole on its own (a greedy shortest drop can
 * shove a later boulder into a dead end — Ice Path B1F boulder 1). Falls
 * back to any drop at all. Returns the route or null.
 */
export function planBoulderDrop(grid, from, boulders, { npcs = [], holes = new Map(), maximumStates = 20_000 } = {}) {
  const holed = new Set(holes.values());
  const targets = boulders.filter((boulder) => holed.has(boulder.index)).sort((a, b) => a.index - b.index);
  const dropped = (index) => (position, map) => ![...map.values()].includes(index);
  const soloDrop = (boulder, rest, position) => findRouteWithBoulders(grid, position, dropped(boulder.index), [boulder], { npcs: [...npcs, ...rest.filter((entry) => entry !== boulder)], holes, maximumStates }) !== null;
  let fallback = null;
  for (const target of targets) {
    const route = findRouteWithBoulders(grid, from, dropped(target.index), boulders, { npcs, holes, maximumStates });
    if (!route) continue;
    fallback ??= route;
    const after = simulateBoulderRoute(boulders, route);
    const remaining = after.boulders.filter((boulder) => holed.has(boulder.index));
    if (remaining.every((boulder) => soloDrop(boulder, after.boulders, after.position))) return route;
  }
  return fallback;
}
