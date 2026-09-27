// Source-authoritative constants for Pokémon Emerald, parsed from the pinned
// pokeemerald headers and map JSON rather than transcribed by hand.
import { readFile, readdir } from 'node:fs/promises';
import { join } from 'node:path';
import { adapterPath, readAdapterFile } from '../../shared/adapter-resources.mjs';

export const POKEEMERALD_ROOT = adapterPath('pokeemerald');

function stripComments(text) {
  return text.replace(/\/\*[\s\S]*?\*\//g, ' ').replace(/\/\/[^\n]*/g, '');
}

function evaluate(expression, table) {
  const tokens = expression.match(/0x[0-9a-fA-F]+|\d+|[A-Za-z_][A-Za-z0-9_]*|<<|>>|[()+\-*|&]/g);
  if (!tokens) throw new SyntaxError(`empty expression: ${expression}`);
  let index = 0;
  const peek = () => tokens[index];
  const next = () => tokens[index++];
  const primary = () => {
    const token = next();
    if (token === '(') {
      const value = additive();
      if (next() !== ')') throw new SyntaxError(`unbalanced parentheses in ${expression}`);
      return value;
    }
    if (token === '-') return -primary();
    if (/^0x/i.test(token)) return Number.parseInt(token, 16);
    if (/^\d+$/.test(token)) return Number.parseInt(token, 10);
    if (Object.hasOwn(table, token)) return table[token];
    throw new ReferenceError(`unknown identifier ${token} in ${expression}`);
  };
  const multiplicative = () => {
    let value = primary();
    while (peek() === '*') { next(); value *= primary(); }
    return value;
  };
  const additive = () => {
    let value = multiplicative();
    while (peek() === '+' || peek() === '-') {
      const operator = next();
      const right = multiplicative();
      value = operator === '+' ? value + right : value - right;
    }
    return shiftOr(value);
  };
  const shiftOr = (left) => {
    let value = left;
    while (peek() === '<<' || peek() === '>>' || peek() === '|' || peek() === '&') {
      const operator = next();
      const right = multiplicative();
      if (operator === '<<') value <<= right;
      else if (operator === '>>') value >>= right;
      else if (operator === '|') value |= right;
      else value &= right;
    }
    return value;
  };
  const value = additive();
  if (index !== tokens.length) throw new SyntaxError(`trailing tokens in ${expression}`);
  return value;
}

/** Parses object-like `#define NAME expr` lines into a name → integer table. */
export function parseCDefines(text, table = {}) {
  const result = { ...table };
  for (const line of stripComments(text).split(/\r?\n/)) {
    const match = line.match(/^\s*#define\s+([A-Za-z_][A-Za-z0-9_]*)\s+(.+?)\s*$/);
    if (!match || /^[A-Za-z_][A-Za-z0-9_]*\(/.test(line.replace(/^\s*#define\s+/, ''))) continue;
    try { result[match[1]] = evaluate(match[2], result); } catch { /* non-numeric macro */ }
  }
  return result;
}

/** Parses C `enum { A, B = 5, C }` bodies into a name → integer table. */
export function parseCEnums(text, table = {}) {
  const result = { ...table };
  const source = stripComments(text);
  const enumPattern = /enum\s*(?:[A-Za-z_][A-Za-z0-9_]*\s*)?\{([^}]*)\}/g;
  let match;
  while ((match = enumPattern.exec(source)) !== null) {
    let value = 0;
    for (const entry of match[1].split(',')) {
      const item = entry.trim();
      if (!item) continue;
      const [name, expression] = item.split('=').map(part => part.trim());
      if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(name)) continue;
      if (expression !== undefined) value = evaluate(expression, result);
      result[name] = value;
      value += 1;
    }
  }
  return result;
}

async function header(relativePath) {
  return readAdapterFile('pokeemerald/'+relativePath);
}

/** Loads the map catalog: ids, groups/numbers, layouts, and events from map JSON. */
export async function loadMapCatalog(root = POKEEMERALD_ROOT) {
  const groups = JSON.parse(await readFile(join(root, 'data/maps/map_groups.json'), 'utf8'));
  const layouts = JSON.parse(await readFile(join(root, 'data/layouts/layouts.json'), 'utf8'));
  const layoutsById = new Map(layouts.layouts.map(layout => [layout.id, layout]));
  const maps = new Map();
  const byName = new Map();
  await Promise.all(groups.group_order.map(async (groupName, group) => {
    await Promise.all(groups[groupName].map(async (mapName, number) => {
      const data = JSON.parse(await readFile(join(root, 'data/maps', mapName, 'map.json'), 'utf8'));
      const script=await readFile(join(root,'data/maps',mapName,'scripts.inc'),'utf8').catch(error=>{if(error.code==='ENOENT')return '';throw error;});
      const diveWarps=[...script.matchAll(/^\s*setdivewarp (MAP_[A-Z0-9_]+), (\d+), (\d+)/gm)];
      const holeWarps=[...script.matchAll(/^\s*setholewarp (MAP_[A-Z0-9_]+)/gm)];
      const layout = layoutsById.get(data.layout) ?? null;
      const entry = Object.freeze({
        id: data.id,
        name: mapName,
        group,
        number,
        layoutId: data.layout,
        holeWarp:holeWarps.length===1?holeWarps[0][1]:null,
        width: layout?.width ?? null,
        height: layout?.height ?? null,
        blockdataPath: layout?.blockdata_filepath ?? null,
        primaryTileset: layout?.primary_tileset ?? null,
        secondaryTileset: layout?.secondary_tileset ?? null,
        mapType: data.map_type,
        fixedDiveWarp:diveWarps.length===1?Object.freeze({map:diveWarps[0][1],x:Number(diveWarps[0][2]),y:Number(diveWarps[0][3])}):null,
        regionMapSection: data.region_map_section,
        allowRunning: data.allow_running === true,
        connections: Object.freeze((data.connections ?? []).map(connection => Object.freeze({ ...connection }))),
        warps: Object.freeze((data.warp_events ?? []).map((warp, index) => Object.freeze({ index, x: warp.x, y: warp.y, elevation: warp.elevation, destMap: warp.dest_map, destWarpId: Number(warp.dest_warp_id) }))),
        coordEvents: Object.freeze((data.coord_events ?? []).map(event => Object.freeze({ type: event.type, x: event.x, y: event.y, elevation: event.elevation, var: event.var ?? null, varValue: event.var_value === undefined ? null : Number(event.var_value), script: event.script ?? null }))),
        bgEvents: Object.freeze((data.bg_events ?? []).map(event => Object.freeze({ type: event.type, x: event.x, y: event.y, elevation: event.elevation, script: event.script ?? null, item: event.item ?? null, flag: event.flag ?? null, facing: event.player_facing_dir ?? null }))),
        objects: Object.freeze((data.object_events ?? []).map((object, index) => Object.freeze({ localId: index + 1, localIdName: object.local_id ?? null, graphicsId: object.graphics_id, x: object.x, y: object.y, elevation: object.elevation, movementType: object.movement_type, rangeX: object.movement_range_x, rangeY: object.movement_range_y, trainerType: object.trainer_type, sightRange: object.trainer_sight_or_berry_tree_id, script: object.script && object.script !== '0x0' ? object.script : null, flag: object.flag && object.flag !== '0' ? object.flag : null }))),
      });
      maps.set(data.id, entry);
      byName.set(mapName, entry);
    }));
  }));
  const byNumber = new Map();
  for (const entry of maps.values()) byNumber.set(`${entry.group}:${entry.number}`, entry);
  return Object.freeze({
    layoutIds:Object.freeze(Object.fromEntries(layouts.layouts.map((layout,i)=>[layout.id,i+1]))),
    byId: maps,
    byName,
    byNumber,
    get(id) { return maps.get(id) ?? null; },
    at(group, number) { return byNumber.get(`${group}:${number}`) ?? null; },
  });
}

let cached = null;

/** Loads every constant table the Emerald player needs, once per process. */
export async function loadEmeraldConstants() {
  if (cached) return cached;
  const global = parseCDefines(await header('include/constants/global.h'));
  const opponents = parseCDefines(await header('include/constants/opponents.h'), global);
  const flags = parseCDefines(await header('include/constants/flags.h'), opponents);
  const vars = parseCDefines(await header('include/constants/vars.h'), global);
  const items = parseCEnums(await header('include/constants/items.h'));
  const species = parseCDefines(await header('include/constants/species.h'));
  const moves = parseCDefines(await header('include/constants/moves.h'));
  const behaviors = parseCEnums(await header('include/constants/metatile_behaviors.h'));
  const battle = parseCDefines(await header('include/constants/battle.h'));
  const pokemon = parseCDefines(await header('include/constants/pokemon.h'));
  const eventObjects = parseCDefines(await header('include/constants/event_objects.h'));
  const berryTrees=parseCDefines(await header('include/constants/berry.h'));
  const pick = (table, prefix) => Object.freeze(Object.fromEntries(Object.entries(table).filter(([name]) => name.startsWith(prefix))));
  const invert = (table) => { const out = new Map(); for (const [name, value] of Object.entries(table)) if (!out.has(value)) out.set(value, name); return out; };
  const behaviorTable = pick(behaviors, 'MB_');
  const speciesTable = pick(species, 'SPECIES_');
  const moveTable = pick(moves, 'MOVE_');
  const itemTable = pick(items, 'ITEM_');
  const catalog = await loadMapCatalog();
  cached = Object.freeze({
    flags: pick(flags, 'FLAG_'),
    vars: pick(vars, 'VAR_'),
    items: itemTable,
    itemNames: invert(itemTable),
    species: speciesTable,
    speciesNames: invert(speciesTable),
    moves: moveTable,
    moveNames: invert(moveTable),
    trainers: pick(opponents, 'TRAINER_'),
    behaviors: behaviorTable,
    behaviorNames: invert(behaviorTable),
    battleTypes: pick(battle, 'BATTLE_TYPE_'),
    battleOutcomes: pick(battle, 'B_OUTCOME_'),
    types: pick(pokemon, 'TYPE_'),
    graphics: pick(eventObjects, 'OBJ_EVENT_GFX_'),
    berryTreeIds:pick(berryTrees,'BERRY_TREE_'),
    maps: catalog,
  });
  return cached;
}
