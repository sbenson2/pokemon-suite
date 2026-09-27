// Cartridge-derived world geometry for Emerald: map headers, layouts, tileset
// attributes, events, and connections are read from the pinned ROM through
// the read-only memory bridge; the live map grid comes from gBackupMapLayout
// so dynamic tiles (opened doors, the truck exit) are always current.
// Layouts: include/global.fieldmap.h, src/fieldmap.c, src/event_object_movement.c.
const MAP_OFFSET = 7;
import {decodePuzzleObjects} from './rotating-tiles.mjs';
const HEADER_BYTES = 0x1c;
const LAYOUT_BYTES = 0x18;
const EVENTS_BYTES = 0x14;
const WARP_BYTES = 8;
const COORD_EVENT_BYTES = 16;
const BG_EVENT_BYTES = 12;
const OBJECT_TEMPLATE_BYTES = 24;
const CONNECTION_BYTES = 12;
const METATILES_PER_TILESET = 512;
const CONNECTION_DIRECTIONS = Object.freeze({ 1: 'down', 2: 'up', 3: 'left', 4: 'right', 5: 'dive', 6: 'emerge' });
export const OPPOSITE = Object.freeze({ up: 'down', down: 'up', left: 'right', right: 'left' });
export const DELTA = Object.freeze({ up: Object.freeze({ dx: 0, dy: -1 }), down: Object.freeze({ dx: 0, dy: 1 }), left: Object.freeze({ dx: -1, dy: 0 }), right: Object.freeze({ dx: 1, dy: 0 }) });

function u16(bytes, offset = 0) { return bytes[offset] | (bytes[offset + 1] << 8); }
function s16(bytes, offset = 0) { return (u16(bytes, offset) << 16) >> 16; }
function u32(bytes, offset = 0) { return (bytes[offset] | (bytes[offset + 1] << 8) | (bytes[offset + 2] << 16) | (bytes[offset + 3] << 24)) >>> 0; }
function s32(bytes, offset = 0) { return u32(bytes, offset) | 0; }
function isRom(pointer) { return pointer >= 0x08000000 && pointer < 0x0a000000; }

export function createBehaviorRules(constants) {
  const ids = constants.behaviors;
  const set = (...names) => new Set(names.map(name => ids[name]).filter(value => value !== undefined));
  const byPattern = (pattern) => new Set(Object.entries(ids).filter(([name]) => pattern.test(name)).map(([, value]) => value));
  const water = new Set([...byPattern(/WATER|CURRENT|WATERFALL|DIVE|NO_SURFACING|SEAWEED/)]);
  for (const walkable of ['MB_PUDDLE', 'MB_SHALLOW_WATER', 'MB_UNUSED_SOOTOPOLIS_DEEP_WATER']) water.delete(ids[walkable]);
  water.delete(ids.MB_UNUSED_SOOTOPOLIS_DEEP_WATER);
  return Object.freeze({
    water,
    diveable:set('MB_INTERIOR_DEEP_WATER','MB_DEEP_WATER','MB_SOOTOPOLIS_DEEP_WATER'),
    waterfalls:set('MB_WATERFALL'),
    holes:set('MB_CRACKED_FLOOR','MB_CRACKED_FLOOR_HOLE'),
    cannotEmerge:set('MB_NO_SURFACING','MB_SEAWEED_NO_SURFACING','MB_WATER_DOOR'),
    downhillSlopes:set('MB_MUDDY_SLOPE'),
    bikeOnly:set('MB_BUMPY_SLOPE','MB_ISOLATED_VERTICAL_RAIL','MB_ISOLATED_HORIZONTAL_RAIL','MB_VERTICAL_RAIL','MB_HORIZONTAL_RAIL'),
    surfable:set('MB_POND_WATER','MB_OCEAN_WATER','MB_INTERIOR_DEEP_WATER','MB_DEEP_WATER','MB_SOOTOPOLIS_DEEP_WATER','MB_NO_SURFACING','MB_SEAWEED','MB_SEAWEED_NO_SURFACING','MB_WATER_SOUTH_ARROW_WARP','MB_NORTHWARD_CURRENT','MB_SOUTHWARD_CURRENT','MB_WESTWARD_CURRENT','MB_EASTWARD_CURRENT','MB_WATERFALL'),
    currents:new Map([['up','MB_NORTHWARD_CURRENT'],['down','MB_SOUTHWARD_CURRENT'],['left','MB_WESTWARD_CURRENT'],['right','MB_EASTWARD_CURRENT']].filter(([,name])=>ids[name]!==undefined).map(([direction,name])=>[ids[name],direction])),
    stepWarps:set('MB_LADDER','MB_UP_ESCALATOR','MB_DOWN_ESCALATOR','MB_LAVARIDGE_GYM_B1F_WARP','MB_LAVARIDGE_GYM_1F_WARP','MB_AQUA_HIDEOUT_WARP','MB_MT_PYRE_HOLE','MB_MOSSDEEP_GYM_WARP','MB_BRIDGE_OVER_OCEAN','MB_DEEP_SOUTH_WARP'),
    terminalWarps:set('MB_LADDER','MB_UP_ESCALATOR','MB_DOWN_ESCALATOR','MB_LAVARIDGE_GYM_B1F_WARP','MB_LAVARIDGE_GYM_1F_WARP','MB_AQUA_HIDEOUT_WARP','MB_MT_PYRE_HOLE','MB_MOSSDEEP_GYM_WARP','MB_DEEP_SOUTH_WARP','MB_CRACKED_FLOOR','MB_CRACKED_FLOOR_HOLE'),
    doors: set('MB_ANIMATED_DOOR', 'MB_NON_ANIMATED_DOOR', 'MB_PETALBURG_GYM_DOOR', 'MB_WATER_DOOR'),
    southBlocked: set('MB_IMPASSABLE_SOUTH', 'MB_IMPASSABLE_SOUTHEAST', 'MB_IMPASSABLE_SOUTHWEST', 'MB_SECRET_BASE_NORTH_WALL'),
    northBlocked: set('MB_IMPASSABLE_NORTH', 'MB_IMPASSABLE_NORTHEAST', 'MB_IMPASSABLE_NORTHWEST'),
    westBlocked: set('MB_IMPASSABLE_WEST', 'MB_IMPASSABLE_NORTHWEST', 'MB_IMPASSABLE_SOUTHWEST'),
    eastBlocked: set('MB_IMPASSABLE_EAST', 'MB_IMPASSABLE_NORTHEAST', 'MB_IMPASSABLE_SOUTHEAST'),
    jumps: Object.freeze({ down: ids.MB_JUMP_SOUTH, up: ids.MB_JUMP_NORTH, left: ids.MB_JUMP_WEST, right: ids.MB_JUMP_EAST }),
    arrowWarps: Object.freeze({ down: ids.MB_SOUTH_ARROW_WARP, up: ids.MB_NORTH_ARROW_WARP, left: ids.MB_WEST_ARROW_WARP, right: ids.MB_EAST_ARROW_WARP }),
    waterSouthArrow:ids.MB_WATER_SOUTH_ARROW_WARP,
    tallGrass: set('MB_TALL_GRASS', 'MB_LONG_GRASS', 'MB_LONG_GRASS_SOUTH_EDGE', 'MB_CAVE', 'MB_INDOOR_ENCOUNTER', 'MB_ASHGRASS', 'MB_FOOTPRINTS', 'MB_DEEP_SAND'),
    forced: byPattern(/CURRENT|SPINNER|SLIDE|MUDDY_SLOPE|CRACKED_FLOOR|ICE\b|THIN_ICE|BRIDGE_OVER|ISOLATED|SECRET_BASE_JUMP|MOSSDEEP_GYM|MT_PYRE_HOLE|BATTLE_PYRAMID|PACIFIDLOG|TRICK_HOUSE|ESCALATOR|LADDER/),
    ledgeNames: ids,
  });
}

export function arrowWarpDirection(rules,behavior){
 return behavior!==undefined&&behavior===rules.waterSouthArrow?'down':Object.entries(rules.arrowWarps).find(([,id])=>id===behavior)?.[0]??null;
}

export function createWorld({ readMemory, manifest, constants }) {
  if (typeof readMemory !== 'function') throw new TypeError('readMemory must be a function');
  const rules = createBehaviorRules(constants);
  const headers = new Map();
  const layouts = new Map();
  const attributes = new Map();
  const geometries = new Map();
  const read = (address, length) => readMemory(address, length);

  const tilesetAttributes = (tilesetPointer) => {
    if (!isRom(tilesetPointer)) return new Uint16Array(METATILES_PER_TILESET);
    if (!attributes.has(tilesetPointer)) {
      const attributesPointer = u32(read(tilesetPointer, 0x14), 0x10);
      const bytes = isRom(attributesPointer) ? read(attributesPointer, METATILES_PER_TILESET * 2) : new Uint8Array(METATILES_PER_TILESET * 2);
      const table = new Uint16Array(METATILES_PER_TILESET);
      for (let index = 0; index < METATILES_PER_TILESET; index += 1) table[index] = u16(bytes, index * 2);
      attributes.set(tilesetPointer, table);
    }
    return attributes.get(tilesetPointer);
  };

  const layoutAt = (layoutPointer) => {
    if (!layouts.has(layoutPointer)) {
      const bytes = read(layoutPointer, LAYOUT_BYTES);
      layouts.set(layoutPointer, Object.freeze({
        pointer: layoutPointer,
        width: s32(bytes, 0),
        height: s32(bytes, 4),
        borderPointer: u32(bytes, 8),
        mapPointer: u32(bytes, 12),
        primary: tilesetAttributes(u32(bytes, 16)),
        secondary: tilesetAttributes(u32(bytes, 20)),
      }));
    }
    return layouts.get(layoutPointer);
  };

  const headerPointer = (group, number) => {
    const groupPointer = u32(read(manifest.gMapGroups + group * 4, 4));
    if (!isRom(groupPointer)) throw new RangeError(`map group ${group} is not in ROM`);
    const pointer = u32(read(groupPointer + number * 4, 4));
    if (!isRom(pointer)) throw new RangeError(`map ${group}:${number} header is not in ROM`);
    return pointer;
  };

  const header = (group, number) => {
    const key = `${group}:${number}`;
    if (!headers.has(key)) {
      const pointer = headerPointer(group, number);
      const bytes = read(pointer, HEADER_BYTES);
      headers.set(key, Object.freeze({
        group, number, pointer,
        layoutPointer: u32(bytes, 0),
        eventsPointer: u32(bytes, 4),
        scriptsPointer: u32(bytes, 8),
        connectionsPointer: u32(bytes, 12),
        layoutId: u16(bytes, 0x12),
        regionMapSection: bytes[0x14],
        mapType: bytes[0x17],
        flags: bytes[0x1a],
      }));
    }
    return headers.get(key);
  };

  const behaviorOf = (layout, block) => {
    const metatile = block & 0x3ff;
    const table = metatile < METATILES_PER_TILESET ? layout.primary : layout.secondary;
    return table[metatile % METATILES_PER_TILESET] & 0xff;
  };

  const decodeEvents = (eventsPointer) => {
    if (!isRom(eventsPointer)) return { warps: [], coordEvents: [], bgEvents: [], objectTemplates: [] };
    const events = read(eventsPointer, EVENTS_BYTES);
    const [objectCount, warpCount, coordCount, bgCount] = [events[0], events[1], events[2], events[3]];
    const objectsPointer = u32(events, 4); const warpsPointer = u32(events, 8); const coordPointer = u32(events, 12); const bgPointer = u32(events, 16);
    const warps = [];
    if (warpCount && isRom(warpsPointer)) {
      const bytes = read(warpsPointer, warpCount * WARP_BYTES);
      for (let index = 0; index < warpCount; index += 1) {
        const offset = index * WARP_BYTES;
        warps.push(Object.freeze({ index, x: s16(bytes, offset), y: s16(bytes, offset + 2), elevation: bytes[offset + 4], destWarpId: bytes[offset + 5], destNumber: bytes[offset + 6], destGroup: bytes[offset + 7] }));
      }
    }
    const coordEvents = [];
    if (coordCount && isRom(coordPointer)) {
      const bytes = read(coordPointer, coordCount * COORD_EVENT_BYTES);
      for (let index = 0; index < coordCount; index += 1) {
        const offset = index * COORD_EVENT_BYTES;
        coordEvents.push(Object.freeze({ index, x: s16(bytes, offset), y: s16(bytes, offset + 2), elevation: bytes[offset + 4], trigger: u16(bytes, offset + 6), triggerValue: u16(bytes, offset + 8), script: u32(bytes, offset + 12) }));
      }
    }
    const bgEvents = [];
    if (bgCount && isRom(bgPointer)) {
      const bytes = read(bgPointer, bgCount * BG_EVENT_BYTES);
      for (let index = 0; index < bgCount; index += 1) {
        const offset = index * BG_EVENT_BYTES;
        const kind = bytes[offset + 5];
        bgEvents.push(Object.freeze({ index, x: u16(bytes, offset), y: u16(bytes, offset + 2), elevation: bytes[offset + 4], kind, script: kind < 5 ? u32(bytes, offset + 8) : 0, hiddenItem: kind >= 5 && kind < 8 ? Object.freeze({ item: u16(bytes, offset + 8), id: u16(bytes, offset + 10) }) : null }));
      }
    }
    const objectTemplates = [];
    if (objectCount && isRom(objectsPointer)) {
      const bytes = read(objectsPointer, objectCount * OBJECT_TEMPLATE_BYTES);
      for (let index = 0; index < objectCount; index += 1) {
        const offset = index * OBJECT_TEMPLATE_BYTES;
        objectTemplates.push(Object.freeze({ localId: bytes[offset], graphicsId: bytes[offset + 1], x: s16(bytes, offset + 4), y: s16(bytes, offset + 6), elevation: bytes[offset + 8], movementType: bytes[offset + 9], rangeX: bytes[offset + 10] & 0xf, rangeY: (bytes[offset + 10] >> 4) & 0xf, trainerType: u16(bytes, offset + 12), trainerRange: u16(bytes, offset + 14), script: u32(bytes, offset + 16), flagId: u16(bytes, offset + 20) }));
      }
    }
    return { warps, coordEvents, bgEvents, objectTemplates };
  };

  const decodeConnections = (connectionsPointer) => {
    if (!isRom(connectionsPointer)) return [];
    const head = read(connectionsPointer, 8);
    const count = s32(head, 0);
    const listPointer = u32(head, 4);
    if (count <= 0 || count > 16 || !isRom(listPointer)) return [];
    const bytes = read(listPointer, count * CONNECTION_BYTES);
    const connections = [];
    for (let index = 0; index < count; index += 1) {
      const offset = index * CONNECTION_BYTES;
      connections.push(Object.freeze({ direction: CONNECTION_DIRECTIONS[bytes[offset]] ?? 'none', offset: s32(bytes, offset + 4), group: bytes[offset + 8], number: bytes[offset + 9] }));
    }
    return connections;
  };

  const geometry = (group, number, layoutName=null) => {
    const key = `${group}:${number}:${layoutName??''}`;
    if (!geometries.has(key)) {
      const head = header(group, number);
      const layoutId=layoutName?constants.maps.layoutIds[layoutName]:null;
      if(layoutName&&!layoutId)throw new Error(`Unknown native layout ${layoutName}`);
      const pointer=layoutId?u32(read(manifest.gMapLayouts+(layoutId-1)*4,4)):head.layoutPointer;
      if(!isRom(pointer))throw new Error('The native map layout pointer is invalid.');
      const layout = layoutAt(pointer);
      const blocksBytes = read(layout.mapPointer, layout.width * layout.height * 2);
      const blocks = new Uint16Array(layout.width * layout.height);
      const behaviors = new Uint8Array(layout.width * layout.height);
      for (let index = 0; index < blocks.length; index += 1) {
        blocks[index] = u16(blocksBytes, index * 2);
        behaviors[index] = behaviorOf(layout, blocks[index]);
      }
      const entry = constants.maps.at(group, number);
      const dive=entry?.fixedDiveWarp,diveMap=dive&&constants.maps.get(dive.map);
      const hole=entry?.holeWarp&&constants.maps.get(entry.holeWarp);
      geometries.set(key, Object.freeze({
        group, number, id: entry?.id ?? null, name: entry?.name ?? null, mapType: head.mapType,
        fixedDiveWarp:diveMap?{group:diveMap.group,number:diveMap.number,x:dive.x,y:dive.y}:null,
        holeDestination:hole?{group:hole.group,number:hole.number}:null,
        width: layout.width, height: layout.height, layout, blocks, behaviors,
        ...decodeEvents(head.eventsPointer),
        connections: Object.freeze(decodeConnections(head.connectionsPointer)),
      }));
    }
    return geometries.get(key);
  };

  /** Live grid of the current map from gBackupMapLayout, in map coordinates. */
  const liveGrid = () => {
    const backup = read(manifest.gBackupMapLayout, 12);
    const width = s32(backup, 0);
    const height = s32(backup, 4);
    const pointer = u32(backup, 8);
    if (width <= MAP_OFFSET * 2 || height <= MAP_OFFSET * 2 || pointer < 0x02000000) return null;
    const bytes = read(pointer, width * height * 2);
    const mapHeader = read(manifest.gMapHeader, HEADER_BYTES);
    const layout = layoutAt(u32(mapHeader, 0));
    const mapWidth = width - (MAP_OFFSET * 2 + 1);
    const mapHeight = height - MAP_OFFSET * 2;
    const blocks = new Uint16Array(mapWidth * mapHeight);
    const behaviors = new Uint8Array(mapWidth * mapHeight);
    for (let y = 0; y < mapHeight; y += 1) {
      for (let x = 0; x < mapWidth; x += 1) {
        const block = u16(bytes, ((y + MAP_OFFSET) * width + (x + MAP_OFFSET)) * 2);
        blocks[y * mapWidth + x] = block;
        behaviors[y * mapWidth + x] = behaviorOf(layout, block);
      }
    }
    return Object.freeze({ width: mapWidth, height: mapHeight, blocks, behaviors, layoutId: u16(mapHeader, 0x12) });
  };

  const tile = (grid, x, y) => {
    if (x < 0 || y < 0 || x >= grid.width || y >= grid.height) return null;
    const block = grid.blocks[y * grid.width + x];
    return Object.freeze({ x, y, metatile: block & 0x3ff, collision: (block >> 10) & 3, elevation: (block >> 12) & 0xf, behavior: grid.behaviors[y * grid.width + x], undefined: (block & 0x3ff) === 0x3ff });
  };

  const savedObjectTemplates=()=>{
    const pointer=u32(read(manifest.gSaveBlock1Ptr,4));
    if(pointer<0x02000000||pointer>=0x02040000)throw new Error('Native saved object templates are unavailable.');
    return decodePuzzleObjects(read(pointer+0xc70,24*64));
  };
  return Object.freeze({ rules, header, geometry, liveGrid, tile, layoutAt,savedObjectTemplates, behaviorName: (id) => constants.behaviorNames.get(id) ?? `MB_${id}` });
}

/**
 * Whether a walker at `from` (with elevation) may step in `direction` onto
 * `to`. Mirrors GetCollisionAtCoords: collision bits, directional
 * impassability from both tiles, elevation compatibility, and blockers.
 */
export function canStep(rules, from, to, direction, elevation, blockers = null, { allowDoors = true } = {}) {
  if (!to || to.undefined) return false;
  // Door metatiles are impassable in the grid; the warp fires when the walker
  // presses up into them (src/field_control_avatar.c TryDoorWarp), so an
  // upward step onto a door is the one legal collision-crossing edge.
  if (rules.doors.has(to.behavior)) return allowDoors && direction === 'up' && !blockers?.has(`${to.x},${to.y}`);
  if (to.collision !== 0) return false;
  if (rules.bikeOnly?.has(to.behavior))return false;
  if (rules.downhillSlopes?.has(to.behavior)&&direction!=='down')return false;
  if(rules.waterfalls?.has(to.behavior)||rules.waterfalls?.has(from?.behavior)){
    if(!rules.canSurf||!['up','down'].includes(direction)||(direction==='up'&&!rules.canWaterfall))return false;
  }
  if (rules.water.has(to.behavior)&&!(rules.canSurf&&rules.surfable?.has(to.behavior))) return false;
  const targetBlocked = { down: rules.southBlocked, up: rules.northBlocked, left: rules.westBlocked, right: rules.eastBlocked }[direction];
  const sourceBlocked = { down: rules.northBlocked, up: rules.southBlocked, left: rules.eastBlocked, right: rules.westBlocked }[direction];
  if (targetBlocked?.has(to.behavior) || (from && sourceBlocked?.has(from.behavior))) return false;
  if (Object.values(rules.jumps).includes(to.behavior) && rules.jumps[direction] !== to.behavior) return false;
  // IsPlayerFacingSurfableFishableWater / CanStopSurfing deliberately cross
  // the elevation mismatch between default-height land (3) and water (1).
  const surfShore=rules.canSurf&&((elevation===3&&to.elevation===1&&rules.surfable?.has(to.behavior))||(elevation===1&&to.elevation===3&&rules.surfable?.has(from?.behavior)&&!rules.water.has(to.behavior)));
  if (!surfShore && to.elevation !== 0 && to.elevation !== 15 && elevation !== 0 && elevation !== 15 && to.elevation !== elevation) return false;
  if (blockers?.has(`${to.x},${to.y}`)) return false;
  return true;
}

export function nextElevation(current, to) {
  return to.elevation === 15 ? current : to.elevation;
}

/** Destination coordinates when walking off a map edge through a connection. */
export function connectionArrival(connection, x, y, destination) {
  switch (connection.direction) {
    case 'up': return { x: x - connection.offset, y: destination.height - 1 };
    case 'down': return { x: x - connection.offset, y: 0 };
    case 'left': return { x: destination.width - 1, y: y - connection.offset };
    case 'right': return { x: 0, y: y - connection.offset };
    default: return null;
  }
}
