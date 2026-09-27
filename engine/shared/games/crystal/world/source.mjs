// Source-authoritative pokecrystal world reader.
//
// Everything here is derived from the pinned vendor/pokecrystal tree: map
// dimensions, block layouts, tileset collision, the collision permission table,
// map connections, warps, coordinate events, background events and object
// events. Nothing is guessed from guides or memory.

import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const freeze = (value) => {
  if (ArrayBuffer.isView(value)) return value;
  if (value && typeof value === 'object' && !Object.isFrozen(value)) {
    for (const child of Object.values(value)) freeze(child);
    Object.freeze(value);
  }
  return value;
};

const stripComment = (line) => line.replace(/;.*$/, '').trim();
const splitArgs = (text) => text.split(',').map((part) => part.trim()).filter((part) => part.length > 0);
const parseNumber = (text) => {
  const value = text.trim();
  if (/^-?\$[0-9a-f]+$/i.test(value)) {
    const negative = value.startsWith('-');
    const magnitude = Number.parseInt(value.replace(/^-?\$/, ''), 16);
    return negative ? -magnitude : magnitude;
  }
  if (/^-?\d+$/.test(value)) return Number.parseInt(value, 10);
  throw new TypeError(`unsupported numeric literal: ${value}`);
};

export class WorldSourceError extends Error {
  constructor(message) {
    super(message);
    this.name = 'WorldSourceError';
  }
}

function read(root, relative) {
  try {
    return readFileSync(join(root, relative), 'utf8');
  } catch (error) {
    throw new WorldSourceError(`cannot read ${relative}: ${error.message}`);
  }
}

function parseMapConstants(text) {
  const groups = new Map();
  const maps = new Map();
  let group = 0;
  let number = 0;
  let groupName = null;
  for (const raw of text.split(/\r?\n/)) {
    const line = stripComment(raw);
    let match = /^newgroup\s+(\w+)$/.exec(line);
    if (match) {
      group += 1;
      number = 0;
      groupName = match[1];
      groups.set(groupName, group);
      continue;
    }
    match = /^map_const\s+(\w+),\s*(\d+),\s*(\d+)$/.exec(line);
    if (match) {
      number += 1;
      maps.set(match[1], {
        id: match[1],
        group,
        groupName,
        number,
        widthBlocks: Number(match[2]),
        heightBlocks: Number(match[3]),
        width: Number(match[2]) * 2,
        height: Number(match[3]) * 2,
      });
    }
  }
  return { groups, maps };
}

function parseConstList(text, prefix) {
  const values = new Map();
  let next = 0;
  for (const raw of text.split(/\r?\n/)) {
    const line = stripComment(raw);
    let match = /^const_def(?:\s+(\S+))?$/.exec(line);
    if (match) {
      next = match[1] ? parseNumber(match[1]) : 0;
      continue;
    }
    match = /^const_next\s+(\S+)$/.exec(line);
    if (match) {
      next = parseNumber(match[1]);
      continue;
    }
    match = /^const_skip(?:\s+(\S+))?$/.exec(line);
    if (match) {
      next += match[1] ? parseNumber(match[1]) : 1;
      continue;
    }
    match = /^const\s+(\w+)$/.exec(line);
    if (match) {
      if (!prefix || match[1].startsWith(prefix)) values.set(match[1], next);
      next += 1;
    }
  }
  return values;
}

function parseDefinitions(text, pattern) {
  const values = new Map();
  for (const raw of text.split(/\r?\n/)) {
    const line = stripComment(raw);
    const match = /^DEF\s+(\w+)\s+EQU\s+(\S+)$/.exec(line);
    if (match && pattern.test(match[1])) values.set(match[1], parseNumber(match[2]));
  }
  return values;
}

function parseMapTable(text) {
  const byLabel = new Map();
  for (const raw of text.split(/\r?\n/)) {
    const line = stripComment(raw);
    const match = /^map\s+(\w+),\s*(TILESET_\w+),\s*(\w+),\s*(\w+),\s*([^,]+),\s*(\w+),\s*(\w+),\s*(\w+)$/.exec(line);
    if (match) {
      byLabel.set(match[1], {
        label: match[1],
        tileset: match[2],
        environment: match[3],
        landmark: match[4],
        music: match[5].trim(),
      });
    }
  }
  return byLabel;
}

function parseAttributes(text) {
  const byLabel = new Map();
  let current = null;
  for (const raw of text.split(/\r?\n/)) {
    const line = stripComment(raw);
    let match = /^map_attributes\s+(\w+),\s*(\w+),\s*(\S+)$/.exec(line);
    if (match) {
      current = { label: match[1], id: match[2], borderBlock: parseNumber(match[3]), connections: [] };
      byLabel.set(current.label, current);
      continue;
    }
    match = /^connection\s+(north|south|west|east),\s*(\w+),\s*(\w+),\s*(-?\d+)$/.exec(line);
    if (match && current) {
      current.connections.push({
        direction: match[1],
        label: match[2],
        mapId: match[3],
        offset: Number(match[4]),
      });
    }
  }
  return byLabel;
}

function parseBlockIncludes(text) {
  const byLabel = new Map();
  let pending = [];
  for (const raw of text.split(/\r?\n/)) {
    const line = stripComment(raw);
    let match = /^(\w+)_Blocks:/.exec(line);
    if (match) {
      pending.push(match[1]);
      continue;
    }
    match = /^INCBIN\s+"([^"]+)"$/.exec(line);
    if (match) {
      for (const label of pending) byLabel.set(label, match[1]);
      pending = [];
    }
  }
  return byLabel;
}

function parseTilesetOrder(text) {
  const names = [];
  let inTable = false;
  for (const raw of text.split(/\r?\n/)) {
    const line = stripComment(raw);
    if (/^Tilesets::/.test(line)) { inTable = true; continue; }
    if (!inTable) continue;
    const match = /^tileset\s+(\w+)$/.exec(line);
    if (match) names.push(match[1]);
    if (/^assert_table_length/.test(line)) break;
  }
  return names;
}

function parseCollisionIncludes(text) {
  const byLabel = new Map();
  let pending = [];
  for (const raw of text.split(/\r?\n/)) {
    const line = stripComment(raw);
    let match = /^(\w+Coll)::?$/.exec(line);
    if (match) {
      pending.push(match[1]);
      continue;
    }
    match = /^INCLUDE\s+"([^"]+_collision\.asm)"$/.exec(line);
    if (match) {
      for (const label of pending) byLabel.set(label, match[1]);
      pending = [];
      continue;
    }
    if (line.length > 0 && !/^SECTION/.test(line)) pending = pending.length && /^\w+::?$/.test(line) ? pending : [];
  }
  return byLabel;
}

function parseTilesetCollision(text, collisionConstants) {
  const blocks = [];
  for (const raw of text.split(/\r?\n/)) {
    const line = stripComment(raw);
    const match = /^tilecoll\s+(.+)$/.exec(line);
    if (!match) continue;
    const parts = splitArgs(match[1]);
    if (parts.length !== 4) throw new WorldSourceError(`malformed tilecoll: ${raw}`);
    blocks.push(parts.map((name) => {
      const key = `COLL_${name}`;
      if (!collisionConstants.has(key)) throw new WorldSourceError(`unknown collision constant ${key}`);
      return collisionConstants.get(key);
    }));
  }
  return blocks;
}

function parseCollisionPermissions(text) {
  const table = [];
  let inTable = false;
  for (const raw of text.split(/\r?\n/)) {
    const line = stripComment(raw);
    if (/^CollisionPermissionTable::/.test(line)) { inTable = true; continue; }
    if (!inTable) continue;
    const match = /^db\s+(.+)$/.exec(line);
    if (match) {
      const flags = match[1].split('|').map((part) => part.trim());
      let value = 0;
      for (const flag of flags) {
        if (flag === 'LAND_TILE') value |= 0x00;
        else if (flag === 'WATER_TILE') value |= 0x01;
        else if (flag === 'WALL_TILE') value |= 0x0f;
        else if (flag === 'TALK') value |= 0x10;
        else throw new WorldSourceError(`unknown permission flag ${flag}`);
      }
      table.push(value);
    }
    if (/^assert_table_length/.test(line)) break;
  }
  if (table.length !== 256) throw new WorldSourceError(`collision permission table has ${table.length} entries`);
  return table;
}

function parseMapEvents(text) {
  const warps = [];
  const coordEvents = [];
  const bgEvents = [];
  const objectEvents = [];
  for (const raw of text.split(/\r?\n/)) {
    const line = stripComment(raw);
    let match = /^warp_event\s+(.+)$/.exec(line);
    if (match) {
      const [x, y, mapId, warpId] = splitArgs(match[1]);
      warps.push({ id: warps.length + 1, x: Number(x), y: Number(y), mapId, warpId: Number(warpId) });
      continue;
    }
    match = /^coord_event\s+(.+)$/.exec(line);
    if (match) {
      const [x, y, scene, script] = splitArgs(match[1]);
      coordEvents.push({ x: Number(x), y: Number(y), scene, script });
      continue;
    }
    match = /^bg_event\s+(.+)$/.exec(line);
    if (match) {
      const [x, y, kind, script] = splitArgs(match[1]);
      bgEvents.push({ x: Number(x), y: Number(y), kind, script });
      continue;
    }
    match = /^object_event\s+(.+)$/.exec(line);
    if (match) {
      const parts = splitArgs(match[1]);
      if (parts.length !== 13) throw new WorldSourceError(`malformed object_event: ${raw}`);
      const [x, y, sprite, movement, radiusX, radiusY, hour1, hour2, palette, type, sightRange, script, flag] = parts;
      objectEvents.push({
        index: objectEvents.length + 1,
        x: Number(x),
        y: Number(y),
        sprite,
        movement,
        radiusX: Number(radiusX),
        radiusY: Number(radiusY),
        hour1,
        hour2,
        palette,
        type,
        sightRange: Number(sightRange),
        script,
        flag,
      });
    }
  }
  return { warps, coordEvents, bgEvents, objectEvents };
}

/**
 * Loads the pokecrystal world lazily. All parsers are pure functions of the
 * pinned source text so the result is reproducible for the recorded commit.
 */
export function loadCrystalWorld({ sourceRoot = 'vendor/pokecrystal' } = {}) {
  const { groups, maps } = parseMapConstants(read(sourceRoot, 'constants/map_constants.asm'));
  const mapTable = parseMapTable(read(sourceRoot, 'data/maps/maps.asm'));
  const attributes = parseAttributes(read(sourceRoot, 'data/maps/attributes.asm'));
  const blockIncludes = parseBlockIncludes(read(sourceRoot, 'data/maps/blocks.asm'));
  const tilesetIds = parseConstList(read(sourceRoot, 'constants/tileset_constants.asm'), 'TILESET_');
  const tilesetOrder = parseTilesetOrder(read(sourceRoot, 'data/tilesets.asm'));
  const collisionIncludes = parseCollisionIncludes(read(sourceRoot, 'gfx/tilesets.asm'));
  const collisionConstants = parseDefinitions(read(sourceRoot, 'constants/collision_constants.asm'), /^COLL_/);
  const permissions = parseCollisionPermissions(read(sourceRoot, 'data/collision/collision_permissions.asm'));

  const labelById = new Map();
  for (const entry of attributes.values()) labelById.set(entry.id, entry.label);
  const idByGroupNumber = new Map();
  for (const map of maps.values()) idByGroupNumber.set(`${map.group}/${map.number}`, map.id);

  const tilesetCollisionCache = new Map();
  const tilesetCollision = (tilesetName) => {
    if (tilesetCollisionCache.has(tilesetName)) return tilesetCollisionCache.get(tilesetName);
    const tilesetIndex = tilesetIds.get(tilesetName);
    if (tilesetIndex === undefined) throw new WorldSourceError(`unknown tileset ${tilesetName}`);
    const label = tilesetOrder[tilesetIndex];
    if (!label) throw new WorldSourceError(`tileset ${tilesetName} has no table entry`);
    const include = collisionIncludes.get(`${label}Coll`);
    if (!include) throw new WorldSourceError(`tileset ${label} has no collision include`);
    const blocks = freeze(parseTilesetCollision(read(sourceRoot, include), collisionConstants));
    tilesetCollisionCache.set(tilesetName, blocks);
    return blocks;
  };

  const mapCache = new Map();
  const map = (mapId) => {
    if (mapCache.has(mapId)) return mapCache.get(mapId);
    const constants = maps.get(mapId);
    if (!constants) throw new WorldSourceError(`unknown map id ${mapId}`);
    const label = labelById.get(mapId);
    if (!label) throw new WorldSourceError(`map ${mapId} has no attributes entry`);
    const attributeEntry = attributes.get(label);
    const tableEntry = mapTable.get(label);
    if (!tableEntry) throw new WorldSourceError(`map ${label} has no maps.asm entry`);
    const blockPath = blockIncludes.get(label);
    if (!blockPath) throw new WorldSourceError(`map ${label} has no block data`);
    let blockBytes;
    try {
      blockBytes = new Uint8Array(readFileSync(join(sourceRoot, blockPath)));
    } catch (error) {
      throw new WorldSourceError(`cannot read ${blockPath}: ${error.message}`);
    }
    if (blockBytes.byteLength !== constants.widthBlocks * constants.heightBlocks) {
      throw new WorldSourceError(
        `${label} block data is ${blockBytes.byteLength} bytes; expected ${constants.widthBlocks * constants.heightBlocks}`,
      );
    }
    const events = parseMapEvents(read(sourceRoot, `maps/${label}.asm`));
    const collisionBlocks = tilesetCollision(tableEntry.tileset);
    const collision = new Uint8Array(constants.width * constants.height);
    for (let y = 0; y < constants.height; y += 1) {
      for (let x = 0; x < constants.width; x += 1) {
        const block = blockBytes[(y >> 1) * constants.widthBlocks + (x >> 1)];
        const quad = collisionBlocks[block];
        if (!quad) throw new WorldSourceError(`${label} uses block ${block} outside its tileset collision table`);
        collision[y * constants.width + x] = quad[((y & 1) << 1) | (x & 1)];
      }
    }
    const borderQuad = collisionBlocks[attributeEntry.borderBlock];
    const value = freeze({
      ...constants,
      label,
      tileset: tableEntry.tileset,
      environment: tableEntry.environment,
      landmark: tableEntry.landmark,
      borderBlock: attributeEntry.borderBlock,
      borderCollision: borderQuad ? [...borderQuad] : [0x07, 0x07, 0x07, 0x07],
      connections: attributeEntry.connections,
      blocks: blockBytes,
      collision,
      ...events,
    });
    mapCache.set(mapId, value);
    return value;
  };

  return freeze({
    sourceRoot,
    groups,
    permissions,
    collisionConstants,
    /** Collision quads [top-left, top-right, bottom-left, bottom-right] of every block in a tileset. */
    tilesetCollision,
    mapIds: [...maps.keys()],
    map,
    mapByGroupNumber(group, number) {
      const id = idByGroupNumber.get(`${group}/${number}`);
      return id ? map(id) : null;
    },
    idOf(group, number) {
      return idByGroupNumber.get(`${group}/${number}`) ?? null;
    },
    labelOf(mapId) {
      return labelById.get(mapId) ?? null;
    },
  });
}
