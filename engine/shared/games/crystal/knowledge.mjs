// Source-authoritative pokecrystal knowledge pack: species, moves, the type
// chart, level-up learnsets, items, event flags, wild encounters and trainer
// parties. Every table is parsed from the pinned vendor/pokecrystal tree.

import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';

const stripComment = (line) => line.replace(/;.*$/, '').trim();
const splitArgs = (text) => text.split(',').map((part) => part.trim()).filter(Boolean);

function read(root, relative) {
  return readFileSync(join(root, relative), 'utf8');
}

function constList(text, { prefix = null, start = 0 } = {}) {
  const names = new Map();
  let next = start;
  for (const raw of text.split(/\r?\n/)) {
    const line = stripComment(raw);
    let match = /^const_def(?:\s+(\S+))?$/.exec(line);
    if (match) { next = match[1] ? Number(match[1]) : 0; continue; }
    match = /^const_next\s+(\d+)$/.exec(line);
    if (match) { next = Number(match[1]); continue; }
    match = /^const_skip(?:\s+(\d+))?$/.exec(line);
    if (match) { next += match[1] ? Number(match[1]) : 1; continue; }
    match = /^const\s+(\w+)$/.exec(line);
    if (match) {
      if (!prefix || match[1].startsWith(prefix)) names.set(match[1], next);
      next += 1;
      continue;
    }
    // constants/item_constants.asm: add_tm X / add_hm X define TM_X / HM_X item ids.
    match = /^add_(tm|hm)\s+(\w+)$/.exec(line);
    if (match) {
      const name = `${match[1].toUpperCase()}_${match[2]}`;
      if (!prefix || name.startsWith(prefix)) names.set(name, next);
      next += 1;
    }
  }
  return names;
}

function invert(map) {
  const result = new Map();
  for (const [name, id] of map) if (!result.has(id)) result.set(id, name);
  return result;
}

function parseTypes(text) {
  // Type ids follow constants/type_constants.asm exactly, including the
  // unused gap before CURSE_TYPE and the PHYSICAL/SPECIAL split.
  const ids = constList(text);
  const physicalStart = ids.get('NORMAL');
  const specialStart = ids.get('FIRE');
  const categories = new Map();
  for (const [name, id] of ids) {
    if (name === 'CURSE_TYPE') categories.set(name, 'none');
    else categories.set(name, id >= specialStart ? 'special' : id >= physicalStart ? 'physical' : 'none');
  }
  return { ids, names: invert(ids), categories };
}

function parseMatchups(text, typeIds) {
  const chart = new Map();
  const foresight = new Set();
  let afterForesight = false;
  for (const raw of text.split(/\r?\n/)) {
    const line = stripComment(raw);
    if (/^db\s+-2$/.test(line)) { afterForesight = true; continue; }
    if (/^db\s+-1$/.test(line)) break;
    const match = /^db\s+(\w+),\s*(\w+),\s*(\w+)$/.exec(line);
    if (!match) continue;
    const attacker = typeIds.get(match[1]);
    const defender = typeIds.get(match[2]);
    const multiplier = { NO_EFFECT: 0, NOT_VERY_EFFECTIVE: 0.5, EFFECTIVE: 1, MORE_EFFECTIVE: 1.5, SUPER_EFFECTIVE: 2 }[match[3]];
    if (attacker === undefined || defender === undefined || multiplier === undefined) {
      throw new Error(`unreadable type matchup: ${raw}`);
    }
    const key = `${attacker}>${defender}`;
    chart.set(key, multiplier);
    if (afterForesight) foresight.add(key);
  }
  return { chart, foresight };
}

function parseMoves(text, moveIds, typeIds, effectIds) {
  const moves = new Map();
  let id = 1;
  for (const raw of text.split(/\r?\n/)) {
    const line = stripComment(raw);
    const match = /^move\s+(.+)$/.exec(line);
    if (!match) continue;
    const [name, effect, power, type, accuracy, pp, effectChance] = splitArgs(match[1]);
    const moveId = moveIds.get(name);
    if (moveId !== id) throw new Error(`move table order mismatch at ${name}`);
    moves.set(moveId, Object.freeze({
      id: moveId,
      name,
      effect,
      effectId: effectIds.get(effect) ?? null,
      power: Number(power),
      type,
      typeId: typeIds.get(type),
      accuracy: Number(accuracy),
      pp: Number(pp),
      effectChance: Number(effectChance),
    }));
    id += 1;
  }
  return moves;
}

function parseNames(text, macro) {
  const names = [];
  const pattern = new RegExp(`^${macro}\\s+"([^"]*)"`);
  for (const raw of text.split(/\r?\n/)) {
    const match = pattern.exec(raw.trim());
    if (match) names.push(match[1].replace(/@$/, ''));
  }
  return names;
}

function parseBaseStats(root, includesText, speciesIds, typeIds) {
  const species = new Map();
  let index = 1;
  for (const raw of includesText.split(/\r?\n/)) {
    const match = /^INCLUDE\s+"([^"]+)"$/.exec(raw.trim());
    if (!match) continue;
    const body = read(root, match[1]).split(/\r?\n/).map(stripComment).filter(Boolean);
    const first = /^db\s+(\w+)$/.exec(body[0]);
    const statsLine = /^db\s+(.+)$/.exec(body[1]);
    const typesLine = /^db\s+(\w+),\s*(\w+)$/.exec(body[2]);
    const catchLine = /^db\s+(\d+)$/.exec(body[3]);
    const expLine = /^db\s+(\d+)$/.exec(body[4]);
    if (!first || !statsLine || !typesLine || !catchLine || !expLine) throw new Error(`unreadable base stats in ${match[1]}`);
    const name = first[1];
    const id = speciesIds.get(name);
    if (id !== index) throw new Error(`base stats order mismatch at ${name} (${id} vs ${index})`);
    const [hp, attack, defense, speed, specialAttack, specialDefense] = splitArgs(statsLine[1]).map(Number);
    const growth = body.find((line) => /^db\s+GROWTH_/.test(line));
    const tmhmLine = body.find((line) => /^tmhm\b/.test(line));
    const tmhm = tmhmLine ? splitArgs(tmhmLine.replace(/^tmhm\s*/, '')) : [];
    species.set(id, Object.freeze({
      id,
      name,
      baseStats: Object.freeze({ hp, attack, defense, speed, specialAttack, specialDefense }),
      types: Object.freeze([typesLine[1], typesLine[2]]),
      typeIds: Object.freeze([typeIds.get(typesLine[1]), typeIds.get(typesLine[2])]),
      catchRate: Number(catchLine[1]),
      baseExperience: Number(expLine[1]),
      growthRate: growth ? /^db\s+(\w+)/.exec(growth)[1] : null,
      tmhm: Object.freeze(tmhm),
    }));
    index += 1;
  }
  return species;
}

function parseLearnsets(pointersText, evosText, speciesIds, moveIds) {
  const order = [];
  for (const raw of pointersText.split(/\r?\n/)) {
    const match = /^dw\s+(\w+)EvosAttacks$/.exec(raw.trim());
    if (match) order.push(match[1]);
  }
  const blocks = new Map();
  let current = null;
  for (const raw of evosText.split(/\r?\n/)) {
    const line = stripComment(raw);
    let match = /^(\w+)EvosAttacks:$/.exec(line);
    if (match) {
      current = { label: match[1], evolutions: [], moves: [] };
      blocks.set(current.label, current);
      continue;
    }
    if (!current) continue;
    match = /^db\s+EVOLVE_(\w+),\s*(.+)$/.exec(line);
    if (match) {
      current.evolutions.push({ method: match[1], arguments: splitArgs(match[2]) });
      continue;
    }
    match = /^db\s+(\d+),\s*(\w+)$/.exec(line);
    if (match) {
      current.moves.push({ level: Number(match[1]), move: match[2], moveId: moveIds.get(match[2]) ?? null });
    }
  }
  const learnsets = new Map();
  order.forEach((label, index) => {
    const block = blocks.get(label);
    if (!block) throw new Error(`missing learnset block for ${label}`);
    learnsets.set(index + 1, Object.freeze({
      speciesId: index + 1,
      evolutions: Object.freeze(block.evolutions),
      moves: Object.freeze(block.moves),
    }));
  });
  return learnsets;
}

function parseGrassEncounters(text) {
  const byMap = new Map();
  let current = null;
  let bucket = null;
  for (const raw of text.split(/\r?\n/)) {
    const line = stripComment(raw);
    let match = /^def_grass_wildmons\s+(\w+)$/.exec(line);
    if (match) {
      current = { mapId: match[1], rates: null, morn: [], day: [], nite: [] };
      bucket = null;
      continue;
    }
    if (!current) continue;
    if (/^end_grass_wildmons$/.test(line)) { byMap.set(current.mapId, current); current = null; continue; }
    match = /^db\s+(\d+)\s+percent,\s*(\d+)\s+percent,\s*(\d+)\s+percent$/.exec(line);
    if (match) { current.rates = { morn: Number(match[1]), day: Number(match[2]), nite: Number(match[3]) }; bucket = 'morn'; continue; }
    match = /^db\s+(\d+),\s*(\w+)$/.exec(line);
    if (match && bucket) {
      current[bucket].push({ level: Number(match[1]), species: match[2] });
      if (current[bucket].length === 7) bucket = bucket === 'morn' ? 'day' : bucket === 'day' ? 'nite' : null;
    }
  }
  return byMap;
}

function parseTrainerClasses(text) {
  const classes = [];
  for (const raw of text.split(/\r?\n/)) {
    const match = /^trainerclass\s+(\w+)/.exec(stripComment(raw));
    if (match) classes.push(match[1]);
  }
  return classes;
}

function parseParties(text, classes) {
  const groups = new Map();
  let group = null;
  let trainer = null;
  for (const raw of text.split(/\r?\n/)) {
    const line = stripComment(raw);
    let match = /^(\w+)Group:$/.exec(line);
    if (match) { group = { label: match[1], trainers: [] }; groups.set(group.label, group); trainer = null; continue; }
    if (!group) continue;
    match = /^db\s+"([^"]*)@",\s*(TRAINERTYPE_\w+)$/.exec(line);
    if (match) { trainer = { id: group.trainers.length + 1, name: match[1], kind: match[2], party: [] }; group.trainers.push(trainer); continue; }
    if (/^db\s+-1$/.test(line)) { trainer = null; continue; }
    match = /^db\s+(\d+),\s*(\w+)(?:,\s*(.+))?$/.exec(line);
    if (match && trainer) {
      const rest = match[3] ? splitArgs(match[3]) : [];
      const member = { level: Number(match[1]), species: match[2] };
      if (trainer.kind === 'TRAINERTYPE_MOVES') member.moves = rest;
      else if (trainer.kind === 'TRAINERTYPE_ITEM') member.item = rest[0] ?? null;
      else if (trainer.kind === 'TRAINERTYPE_ITEM_MOVES') { member.item = rest[0] ?? null; member.moves = rest.slice(1); }
      trainer.party.push(member);
    }
  }
  const byClass = new Map();
  classes.forEach((className, classId) => {
    if (classId === 0) return;
    const label = className.split('_').map((part) => part[0] + part.slice(1).toLowerCase()).join('');
    const found = groups.get(label) ?? groups.get(`${label}1`);
    if (found) byClass.set(classId, { classId, className, trainers: found.trainers });
  });
  return { groups, byClass };
}


/** data/items/attributes.asm: "; NAME" comment followed by item_attribute price, ... */
function parseItemAttributes(text) {
  const attributes = new Map();
  let pending = null;
  for (const raw of text.split(/\r?\n/)) {
    const comment = /^;\s*([A-Z0-9_]+)\s*$/.exec(raw.trim());
    if (comment) { pending = comment[1]; continue; }
    const match = /^\s*item_attribute\s+(\d+),\s*(\w+),\s*(\d+),\s*(\w+),\s*(\w+)/.exec(raw);
    if (match && pending) {
      attributes.set(pending, Object.freeze({ price: Number(match[1]), heldEffect: match[2], parameter: Number(match[3]), pocket: match[5] }));
      pending = null;
    }
  }
  return attributes;
}

/** data/items/marts.asm + constants/mart_constants.asm: MART_* → item names. */
function parseMarts(martsText, constantsText) {
  const labels = new Map();
  let current = null;
  const order = [];
  for (const raw of martsText.split(/\r?\n/)) {
    const line = stripComment(raw);
    let match = /^(Mart\w+):$/.exec(line);
    if (match) { current = match[1]; labels.set(current, []); continue; }
    match = /^dw\s+(Mart\w+)$/.exec(line);
    if (match) { order.push(match[1]); continue; }
    match = /^db\s+([A-Z][A-Z0-9_]+)$/.exec(line);
    if (match && current) labels.get(current).push(match[1]);
  }
  const constants = constList(constantsText, { prefix: 'MART_' });
  const marts = new Map();
  for (const [name, index] of constants) {
    const label = order[index];
    if (label && labels.has(label)) marts.set(name, Object.freeze(labels.get(label)));
  }
  return marts;
}

const camelToMapId = (label) => (label.match(/[A-Z][a-z]*|[0-9]+[A-Z]?/g) ?? [label]).join('_').toUpperCase();

/** maps/*.asm `pokemart MARTTYPE_X, MART_Y` lines, in clerk order, keyed by map id. */
function parseMapMarts(sourceRoot, marts) {
  const byMap = new Map();
  const directory = join(sourceRoot, 'maps');
  for (const file of readdirSync(directory)) {
    if (!file.endsWith('.asm')) continue;
    const text = readFileSync(join(directory, file), 'utf8');
    const clerks = [];
    let label = null;
    let checked = null;
    const blockedBy = [];
    const requires = [];
    for (const raw of text.split(/\r?\n/)) {
      const labelMatch = /^([A-Za-z_][A-Za-z0-9_]*):/.exec(raw);
      if (labelMatch) { label = labelMatch[1]; checked = null; blockedBy.length = 0; requires.length = 0; continue; }
      // A local jump target starts a fresh path: guards seen before it belong to the fall-through path only.
      if (/^\.\w+:/.test(raw)) { checked = null; blockedBy.length = 0; requires.length = 0; continue; }
      // Event guards ahead of the pokemart line inside the script label: a
      // `checkevent X` followed by `iftrue` jumps away when X is set (the
      // Mahogany pharmacist stops selling once EVENT_DECIDED_TO_HELP_LANCE is
      // set); `iffalse` jumps away when X is clear.
      const check = /^\s*checkevent\s+(EVENT_\w+)/.exec(raw);
      if (check) { checked = check[1]; continue; }
      if (checked && /^\s*iftrue\b/.test(raw)) { blockedBy.push(checked); checked = null; continue; }
      if (checked && /^\s*iffalse\b/.test(raw)) { requires.push(checked); checked = null; continue; }
      const match = /^\s*pokemart\s+(MARTTYPE_\w+),\s*(MART_\w+)/.exec(raw);
      // The clerk is the object whose script is the label enclosing the pokemart line.
      if (match) clerks.push(Object.freeze({ type: match[1], mart: match[2], clerkIndex: clerks.length, script: label, blockedBy: Object.freeze([...blockedBy]), requires: Object.freeze([...requires]), items: marts.get(match[2]) ?? Object.freeze([]) }));
    }
    if (clerks.length > 0) byMap.set(camelToMapId(file.replace(/\.asm$/, '')), Object.freeze(clerks));
  }
  return byMap;
}

export function loadCrystalKnowledge({ sourceRoot = 'vendor/pokecrystal' } = {}) {
  const types = parseTypes(read(sourceRoot, 'constants/type_constants.asm'));
  const speciesIds = constList(read(sourceRoot, 'constants/pokemon_constants.asm'));
  const moveIds = constList(read(sourceRoot, 'constants/move_constants.asm'));
  const effectIds = constList(read(sourceRoot, 'constants/move_effect_constants.asm'));
  const itemIds = constList(read(sourceRoot, 'constants/item_constants.asm'));
  const spriteIds = constList(read(sourceRoot, 'constants/sprite_constants.asm'), { prefix: 'SPRITE_' });
  const eventIds = constList(read(sourceRoot, 'constants/event_flags.asm'), { prefix: 'EVENT_' });
  const matchups = parseMatchups(read(sourceRoot, 'data/types/type_matchups.asm'), types.ids);
  const moves = parseMoves(read(sourceRoot, 'data/moves/moves.asm'), moveIds, types.ids, effectIds);
  const speciesNames = parseNames(read(sourceRoot, 'data/pokemon/names.asm'), 'dname');
  const moveNames = parseNames(read(sourceRoot, 'data/moves/names.asm'), 'li');
  const species = parseBaseStats(sourceRoot, read(sourceRoot, 'data/pokemon/base_stats.asm'), speciesIds, types.ids);
  const learnsets = parseLearnsets(
    read(sourceRoot, 'data/pokemon/evos_attacks_pointers.asm'),
    read(sourceRoot, 'data/pokemon/evos_attacks.asm'),
    speciesIds,
    moveIds,
  );
  const grass = new Map([...parseGrassEncounters(read(sourceRoot, 'data/wild/johto_grass.asm')), ...parseGrassEncounters(read(sourceRoot, 'data/wild/kanto_grass.asm'))]);
  const trainerClasses = parseTrainerClasses(read(sourceRoot, 'constants/trainer_constants.asm'));
  const parties = parseParties(read(sourceRoot, 'data/trainers/parties.asm'), trainerClasses);
  const itemNames = invert(itemIds);
  const itemDisplayNames = parseNames(read(sourceRoot, 'data/items/names.asm'), 'li');
  const itemAttributes = parseItemAttributes(read(sourceRoot, 'data/items/attributes.asm'));
  const marts = parseMarts(read(sourceRoot, 'data/items/marts.asm'), read(sourceRoot, 'constants/mart_constants.asm'));
  const martsByMap = parseMapMarts(sourceRoot, marts);
  const speciesByName = speciesIds;

  const effectiveness = (attackTypeId, defenderTypeIds) => {
    let multiplier = 1;
    const seen = new Set();
    for (const defenderType of defenderTypeIds) {
      if (seen.has(defenderType)) continue;
      seen.add(defenderType);
      const value = matchups.chart.get(`${attackTypeId}>${defenderType}`);
      if (value !== undefined) multiplier *= value;
    }
    return multiplier;
  };

  return Object.freeze({
    sourceRoot,
    types,
    matchups,
    moves,
    moveIds,
    moveNames,
    species,
    speciesIds: speciesByName,
    speciesNames,
    learnsets,
    itemIds,
    itemNames,
    itemAttributes,
    itemPrice: (name) => itemAttributes.get(name)?.price ?? null,
    marts,
    martsByMap,
    spriteIds,
    eventIds,
    grass,
    trainerClasses,
    parties,
    effectiveness,
    speciesName: (id) => speciesNames[id - 1] ?? `SPECIES_${id}`,
    moveName: (id) => (id === 0 ? '-' : moveNames[id - 1] ?? `MOVE_${id}`),
    itemName: (id) => itemNames.get(id) ?? `ITEM_${id}`,
    // Display name as drawn in menus ("# BALL" is printed as "POKé BALL").
    itemDisplayName: (id) => (itemDisplayNames[id - 1] ?? `ITEM ${id}`).replace('#', 'POKé'),
    eventIndex: (name) => {
      const index = eventIds.get(name);
      if (index === undefined) throw new Error(`unknown Crystal event flag ${name}`);
      return index;
    },
    trainerClassName: (classId) => trainerClasses[classId] ?? `CLASS_${classId}`,
    trainer: (classId, trainerId) => parties.byClass.get(classId)?.trainers.find((entry) => entry.id === trainerId) ?? null,
    movesLearnedBy: (speciesId, level) => (learnsets.get(speciesId)?.moves ?? []).filter((entry) => entry.level <= level),
    canLearnMachine: (speciesId, moveName) => (species.get(speciesId)?.tmhm ?? []).includes(moveName),
  });
}
