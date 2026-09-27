// Read-only Crystal Rev 1 observer. One observation reads WRAM0, WRAMX bank 1
// and HRAM through the pinned session's read-only bridge and decodes them with
// the pokecrystal symbol layout (vendor/pokecrystal-symbols/pokecrystal11.sym).
// The observer never writes memory and never advances the cartridge.

const freeze = (value) => {
  if (ArrayBuffer.isView(value)) return value;
  if (value && typeof value === 'object' && !Object.isFrozen(value)) {
    for (const child of Object.values(value)) freeze(child);
    Object.freeze(value);
  }
  return value;
};

// WRAM0 (bank 0) symbols.
const W0 = Object.freeze({
  wTilemap: 0xc4a0,
  wOptions2: 0xcfd1, // pokecrystal11.sym: MENU_ACCOUNT bit 0
  wPlayerDisableCount: 0xc675, // high nibble: disabled move slot + 1, low nibble: turns left (engine/battle/core.asm swaps then `and $f`, `dec a`)
  wEnemyDisableCount: 0xc67d,
  wBattleMon: 0xc62c,
  wBattleMonMoves: 0xc62e,
  wBattleMonPP: 0xc634,
  wBattleMonLevel: 0xc639,
  wBattleMonStatus: 0xc63a,
  wBattleMonHP: 0xc63c,
  wBattleMonMaxHP: 0xc63e,
  wBattleMonAttack: 0xc640,
  wBattleMonDefense: 0xc642,
  wBattleMonSpeed: 0xc644,
  wBattleMonSpclAtk: 0xc646,
  wBattleMonSpclDef: 0xc648,
  wBattleMonType1: 0xc64a,
  wPlayerSubStatus1: 0xc668,
  wBattleEnded: 0xc734,
  wJumptableIndex: 0xcf63,
  wMenuSelection: 0xcf74,
  wMenuDataItems: 0xcf92,
  wMenuCursorY: 0xcfa9,
  wMenuCursorX: 0xcfaa,
  wOptions: 0xcfcc,
});

// WRAMX bank 1 symbols.
const W1 = Object.freeze({
  wTimeOfDay: 0xd269, // MORN_F=0, DAY_F=1, NITE_F=2 (constants/wram_constants.asm)
  wBattleMenuCursorPosition: 0xd0d2,
  wCurBattleMon: 0xd0d4,
  wCurMoveNum: 0xd0d5,
  wBattlePlayerAction: 0xd0ec,
  wBattleResult: 0xd0ee,
  wCurPartyMon: 0xd109,
  wMapWidth: 0xd19f,
  wMapHeight: 0xd19e,
  wEnemyMon: 0xd206,
  wEnemyMonMoves: 0xd208,
  wEnemyMonPP: 0xd20e,
  wEnemyMonLevel: 0xd213,
  wEnemyMonStatus: 0xd214,
  wEnemyMonHP: 0xd216,
  wEnemyMonMaxHP: 0xd218,
  wEnemyMonAttack: 0xd21a,
  wEnemyMonDefense: 0xd21c,
  wEnemyMonSpeed: 0xd21e,
  wEnemyMonSpclAtk: 0xd220,
  wEnemyMonSpclDef: 0xd222,
  wEnemyMonType1: 0xd224,
  wBattleMode: 0xd22d,
  wOtherTrainerClass: 0xd22f,
  wBattleType: 0xd230,
  wOtherTrainerID: 0xd231,
  wBattleHasJustStarted: 0xd264,
  wNumFleeAttempts: 0xd267,
  wMapStatus: 0xd432,
  wMapEventStatus: 0xd433,
  wScriptMode: 0xd437,
  wScriptRunning: 0xd438,
  wPlayerGender: 0xd472,
  wPlayerID: 0xd47b,
  wPlayerName: 0xd47d,
  wStartDay: 0xd4b6, // set at new game (ram/wram.asm)
  wStartHour: 0xd4b7,
  wCurDay: 0xd4cb, // SUNDAY=0..SATURDAY=6 (constants/wram_constants.asm)
  wGameTimeHours: 0xd4c4,
  wGameTimeMinutes: 0xd4c6,
  wGameTimeSeconds: 0xd4c7,
  wObjectStructs: 0xd4d6,
  wMapObjects: 0xd71e,
  wPlayerWalking: 0xd4dd,
  wPlayerDirection: 0xd4de,
  wPlayerAction: 0xd4e1,
  wMoney: 0xd84e,
  wMomsMoney: 0xd851,
  wMomSavingMoney: 0xd854, // bit 0: saving
  wStatusFlags: 0xd84c,
  wJohtoBadges: 0xd857,
  wNumItems: 0xd892,
  wItems: 0xd893,
  wNumKeyItems: 0xd8bc,
  wKeyItems: 0xd8bd,
  wNumBalls: 0xd8d7,
  wBalls: 0xd8d8,
  wElmsLabSceneID: 0xd987,
  wBikeFlags: 0xdbf5,
  wEventFlags: 0xda72,
  wMapGroup: 0xdcb5,
  wMapNumber: 0xdcb6,
  wYCoord: 0xdcb7,
  wXCoord: 0xdcb8,
  wPartyCount: 0xdcd7,
  wPartySpecies: 0xdcd8,
  wPartyMon1: 0xdcdf,
  wPartyMonNicknames: 0xde41,
  wPokedexCaught: 0xde99,
  wPokedexSeen: 0xdeb9,
});

export const DAYS_OF_WEEK = Object.freeze(['SUNDAY', 'MONDAY', 'TUESDAY', 'WEDNESDAY', 'THURSDAY', 'FRIDAY', 'SATURDAY']);

const HRAM = Object.freeze({ hHours: 0xff94, hMinutes: 0xff96, hSeconds: 0xff98, hJoyReleased: 0xffa6, hJoyPressed: 0xffa7, hJoyDown: 0xffa8, hJoyLast: 0xffa9, hInMenu: 0xffaa });

// party_struct (macros/ram.asm): stats are big-endian words from 0x22 (HP) through 0x2e (SpclDef).
const PARTY_STRUCT = Object.freeze({ length: 0x30, item: 1, moves: 2, pp: 0x17, happiness: 0x1b, level: 0x1f, status: 0x20, hp: 0x22, maxHp: 0x24, attack: 0x26, defense: 0x28, speed: 0x2a, specialAttack: 0x2c, specialDefense: 0x2e });
const OBJECT_STRUCT = Object.freeze({ length: 0x28, count: 13, sprite: 0, mapObjectIndex: 1, movementType: 3, walking: 7, direction: 8, mapX: 0x10, mapY: 0x11 });
// wMapObjects: 16 map_object entries (constants/map_object_constants.asm
// MAPOBJECT_*): the coordinates persist while the object struct is unloaded.
const MAP_OBJECT = Object.freeze({ length: 0x10, count: 16, objectStructId: 0, sprite: 1, y: 2, x: 3, movement: 4, eventFlag: 0xc });
const JOHTO_BADGES = Object.freeze(['ZEPHYR', 'HIVE', 'PLAIN', 'FOG', 'MINERAL', 'STORM', 'GLACIER', 'RISING']);
const DIRECTION_NAMES = Object.freeze(['down', 'up', 'left', 'right']);
const EGG_SPECIES = 0xfd; // constants/pokemon_constants.asm: DEF EGG EQU $fd
const EVENT_FLAG_BYTES = 250; // wEventFlags:: flag_array NUM_EVENTS (2000 bits); constants leave gaps.
const SCREEN_WIDTH = 20;
const SCREEN_HEIGHT = 18;

export class ObserverError extends Error {
  constructor(message) {
    super(message);
    this.name = 'ObserverError';
  }
}

// Crystal charmap subset sufficient for menus, dialog and battle text.
const CHARMAP = new Map();
const mapRange = (start, text) => [...text].forEach((character, index) => CHARMAP.set(start + index, character));
mapRange(0x80, 'ABCDEFGHIJKLMNOPQRSTUVWXYZ():;[]');
mapRange(0xa0, 'abcdefghijklmnopqrstuvwxyz');
mapRange(0xf6, '0123456789');
Object.entries({
  0x7f: ' ', 0x4a: 'PKMN', 0x54: 'POKé', 0x5b: 'PC', 0x5c: 'TM', 0x5d: 'TRAINER', 0x5e: 'ROCKET',
  0xe0: "'", 0xe3: '-', 0xe6: '?', 0xe7: '!', 0xe8: '.', 0xe9: '&', 0xea: 'é', 0xeb: '→', 0xec: '▷',
  0xed: '▶', 0xee: '▼', 0xef: '♂', 0xf0: '¥', 0xf1: '×', 0xf3: '/', 0xf4: ',', 0xf5: '♀',
  0xd0: "'d", 0xd1: "'l", 0xd2: "'m", 0xd3: "'r", 0xd4: "'s", 0xd5: "'t", 0xd6: "'v",
  0x75: '…', 0x79: '┌', 0x7a: '─', 0x7b: '┐', 0x7c: '│', 0x7d: '└', 0x7e: '┘', 0x6d: ':', 0xe1: 'PK', 0xe2: 'MN',
}).forEach(([code, text]) => CHARMAP.set(Number(code), text));

export function decodeCrystalText(bytes) {
  let text = '';
  for (const byte of bytes) {
    if (byte === 0x50) break;
    text += CHARMAP.get(byte) ?? (byte === 0x00 || byte === 0x60 || byte === 0x61 ? ' ' : '·');
  }
  return text;
}

/**
 * A tilemap row is not a string: 0x50 ("@", the text terminator) is also an
 * ordinary background tile id (the Olivine Café floor, among others), so a
 * row must decode every tile or menu text drawn to its right disappears.
 */
export function decodeTilemapRow(bytes) {
  let text = '';
  for (const byte of bytes) {
    text += CHARMAP.get(byte) ?? (byte === 0x00 || byte === 0x60 || byte === 0x61 ? ' ' : '·');
  }
  return text;
}

function decodeScreen(wram0) {
  const rows = [];
  for (let y = 0; y < SCREEN_HEIGHT; y += 1) {
    const start = W0.wTilemap - 0xc000 + y * SCREEN_WIDTH;
    rows.push(decodeTilemapRow(wram0.subarray(start, start + SCREEN_WIDTH)).padEnd(SCREEN_WIDTH));
  }
  return rows;
}

function decodeStatus(byte) {
  if (byte & 0x07) return 'SLP';
  if (byte & 0x08) return 'PSN';
  if (byte & 0x10) return 'BRN';
  if (byte & 0x20) return 'FRZ';
  if (byte & 0x40) return 'PAR';
  return 'OK';
}

export function createCrystalObserver({ session, knowledge = null, runId = null } = {}) {
  if (!session || typeof session.readMemory !== 'function' || typeof session.readWramBank !== 'function') {
    throw new ObserverError('Crystal observer requires readMemory and readWramBank');
  }
  const speciesName = (id) => knowledge?.speciesName(id) ?? `SPECIES_${id}`;
  const moveName = (id) => knowledge?.moveName(id) ?? (id ? `MOVE_${id}` : '-');
  const typeName = (id) => knowledge?.types.names.get(id) ?? `TYPE_${id}`;
  const itemName = (id) => knowledge?.itemName(id) ?? `ITEM_${id}`;

  const observe = () => {
    const frame = session.frame;
    const wram0 = session.readMemory(0xc000, 0x1000);
    const wram1 = session.readWramBank(1, 0xd000, 0x1000);
    const hram = session.readMemory(0xff80, 0x80);
    if (session.frame !== frame) throw new ObserverError('observation crossed a frame boundary');
    const r0 = (address) => wram0[address - 0xc000];
    const r1 = (address) => wram1[address - 0xd000];
    const r0w = (address) => (r0(address) << 8) | r0(address + 1);
    const r1w = (address) => (r1(address) << 8) | r1(address + 1);
    const h = (address) => hram[address - 0xff80];

    const partyCount = Math.min(r1(W1.wPartyCount), 6);
    const party = [];
    for (let index = 0; index < partyCount; index += 1) {
      const base = W1.wPartyMon1 + index * PARTY_STRUCT.length;
      const speciesId = r1(base);
      const moves = [];
      for (let slot = 0; slot < 4; slot += 1) {
        const moveId = r1(base + PARTY_STRUCT.moves + slot);
        if (moveId) moves.push({ slot, id: moveId, name: moveName(moveId), pp: r1(base + PARTY_STRUCT.pp + slot) & 0x3f });
      }
      const nicknameStart = W1.wPartyMonNicknames - 0xd000 + index * 11;
      const isEgg = r1(W1.wPartySpecies + index) === EGG_SPECIES;
      party.push({
        slot: index,
        speciesId,
        speciesName: isEgg ? 'EGG' : speciesName(speciesId),
        isEgg,
        eggSpeciesName: isEgg ? speciesName(speciesId) : null,
        nickname: decodeCrystalText(wram1.subarray(nicknameStart, nicknameStart + 11)).trim(),
        level: r1(base + PARTY_STRUCT.level),
        hp: r1w(base + PARTY_STRUCT.hp),
        maxHp: r1w(base + PARTY_STRUCT.maxHp),
        status: decodeStatus(r1(base + PARTY_STRUCT.status)),
        statusByte: r1(base + PARTY_STRUCT.status),
        itemId: r1(base + PARTY_STRUCT.item),
        happiness: r1(base + PARTY_STRUCT.happiness),
        attack: r1w(base + PARTY_STRUCT.attack),
        defense: r1w(base + PARTY_STRUCT.defense),
        speed: r1w(base + PARTY_STRUCT.speed),
        specialAttack: r1w(base + PARTY_STRUCT.specialAttack),
        specialDefense: r1w(base + PARTY_STRUCT.specialDefense),
        typeIds: knowledge?.species?.get(speciesId)?.typeIds ?? [],
        moves,
      });
    }

    const battleModeId = r1(W1.wBattleMode);
    const battle = battleModeId === 0 ? null : {
      mode: battleModeId === 1 ? 'WILD' : battleModeId === 2 ? 'TRAINER' : `MODE_${battleModeId}`,
      typeId: r1(W1.wBattleType),
      trainer: battleModeId === 2 ? { classId: r1(W1.wOtherTrainerClass), id: r1(W1.wOtherTrainerID) } : null,
      justStarted: r1(W1.wBattleHasJustStarted) !== 0,
      result: r1(W1.wBattleResult),
      menuPosition: r1(W1.wBattleMenuCursorPosition),
      curMoveNum: r1(W1.wCurMoveNum),
      curBattleMon: r1(W1.wCurBattleMon),
      playerAction: r1(W1.wBattlePlayerAction),
      fleeAttempts: r1(W1.wNumFleeAttempts),
      player: {
        speciesId: r0(W0.wBattleMon),
        speciesName: speciesName(r0(W0.wBattleMon)),
        level: r0(W0.wBattleMonLevel),
        hp: r0w(W0.wBattleMonHP),
        maxHp: r0w(W0.wBattleMonMaxHP),
        status: decodeStatus(r0(W0.wBattleMonStatus)),
        attack: r0w(W0.wBattleMonAttack),
        defense: r0w(W0.wBattleMonDefense),
        speed: r0w(W0.wBattleMonSpeed),
        specialAttack: r0w(W0.wBattleMonSpclAtk),
        specialDefense: r0w(W0.wBattleMonSpclDef),
        typeIds: [r0(W0.wBattleMonType1), r0(W0.wBattleMonType1 + 1)],
        types: [typeName(r0(W0.wBattleMonType1)), typeName(r0(W0.wBattleMonType1 + 1))],
        disabledSlot: (r0(W0.wPlayerDisableCount) >> 4) ? (r0(W0.wPlayerDisableCount) >> 4) - 1 : null,
        moves: [0, 1, 2, 3].map((slot) => ({ slot, id: r0(W0.wBattleMonMoves + slot), name: moveName(r0(W0.wBattleMonMoves + slot)), pp: r0(W0.wBattleMonPP + slot) & 0x3f, disabled: (r0(W0.wPlayerDisableCount) >> 4) === slot + 1 })).filter((move) => move.id),
      },
      enemy: {
        speciesId: r1(W1.wEnemyMon),
        speciesName: speciesName(r1(W1.wEnemyMon)),
        level: r1(W1.wEnemyMonLevel),
        hp: r1w(W1.wEnemyMonHP),
        maxHp: r1w(W1.wEnemyMonMaxHP),
        status: decodeStatus(r1(W1.wEnemyMonStatus)),
        attack: r1w(W1.wEnemyMonAttack),
        defense: r1w(W1.wEnemyMonDefense),
        speed: r1w(W1.wEnemyMonSpeed),
        specialAttack: r1w(W1.wEnemyMonSpclAtk),
        specialDefense: r1w(W1.wEnemyMonSpclDef),
        typeIds: [r1(W1.wEnemyMonType1), r1(W1.wEnemyMonType1 + 1)],
        types: [typeName(r1(W1.wEnemyMonType1)), typeName(r1(W1.wEnemyMonType1 + 1))],
        moves: [0, 1, 2, 3].map((slot) => ({ slot, id: r1(W1.wEnemyMonMoves + slot), name: moveName(r1(W1.wEnemyMonMoves + slot)), pp: r1(W1.wEnemyMonPP + slot) & 0x3f, disabled: (r0(W0.wEnemyDisableCount) >> 4) === slot + 1 })).filter((move) => move.id),
      },
    };

    const objects = [];
    for (let index = 0; index < OBJECT_STRUCT.count; index += 1) {
      const base = W1.wObjectStructs + index * OBJECT_STRUCT.length;
      const sprite = r1(base + OBJECT_STRUCT.sprite);
      if (!sprite) continue;
      objects.push({
        index,
        sprite,
        mapObjectIndex: r1(base + OBJECT_STRUCT.mapObjectIndex),
        movementType: r1(base + OBJECT_STRUCT.movementType),
        walking: r1(base + OBJECT_STRUCT.walking),
        x: r1(base + OBJECT_STRUCT.mapX) - 4,
        y: r1(base + OBJECT_STRUCT.mapY) - 4,
      });
    }

    const mapObjects = [];
    for (let index = 1; index < MAP_OBJECT.count; index += 1) {
      const base = W1.wMapObjects + index * MAP_OBJECT.length;
      const sprite = r1(base + MAP_OBJECT.sprite);
      if (!sprite) continue;
      // MAPOBJECT_EVENT_FLAG (little-endian word, -1 = none): the object is
      // hidden while its flag is set (map_objects.asm CheckObjectFlag) — a
      // Strength boulder that fell through its hole, a taken item ball — but
      // its coordinates stay here, so planners must skip hidden entries
      // (Ice Path B1F phantom-boulder loop, 2026-09-05).
      const eventFlag = r1(base + MAP_OBJECT.eventFlag) | (r1(base + MAP_OBJECT.eventFlag + 1) << 8);
      const hidden = eventFlag !== 0xffff && (r1(W1.wEventFlags + (eventFlag >> 3)) & (1 << (eventFlag & 7))) !== 0;
      mapObjects.push({
        index, sprite, x: r1(base + MAP_OBJECT.x) - 4, y: r1(base + MAP_OBJECT.y) - 4, movement: r1(base + MAP_OBJECT.movement),
        eventFlag: eventFlag === 0xffff ? null : eventFlag, hidden,
      });
    }

    const items = [];
    const itemCount = Math.min(r1(W1.wNumItems), 20);
    for (let index = 0; index < itemCount; index += 1) {
      const id = r1(W1.wItems + index * 2);
      items.push({ id, name: itemName(id), quantity: r1(W1.wItems + index * 2 + 1) });
    }
    const keyItems = [];
    const keyItemCount = Math.min(r1(W1.wNumKeyItems), 25);
    for (let index = 0; index < keyItemCount; index += 1) {
      const id = r1(W1.wKeyItems + index);
      keyItems.push({ id, name: itemName(id) });
    }
    const balls = [];
    const ballCount = Math.min(r1(W1.wNumBalls), 12);
    for (let index = 0; index < ballCount; index += 1) {
      const id = r1(W1.wBalls + index * 2);
      balls.push({ id, name: itemName(id), quantity: r1(W1.wBalls + index * 2 + 1) });
    }

    const badgeBits = r1(W1.wJohtoBadges);
    const eventFlags = wram1.slice(W1.wEventFlags - 0xd000, W1.wEventFlags - 0xd000 + EVENT_FLAG_BYTES);
    const statusFlags = r1(W1.wStatusFlags);
    const map = { group: r1(W1.wMapGroup), number: r1(W1.wMapNumber), x: r1(W1.wXCoord), y: r1(W1.wYCoord) };
    return freeze({
      schema: 'pokemon-research/crystal-observation/v1',
      runId,
      frame,
      map,
      facing: DIRECTION_NAMES[(r1(W1.wPlayerDirection) >> 2) & 3] ?? 'down',
      playerWalking: r1(W1.wPlayerWalking),
      playerAction: r1(W1.wPlayerAction),
      mapStatus: r1(W1.wMapStatus),
      mapEventsOff: r1(W1.wMapEventStatus) !== 0,
      scriptRunning: r1(W1.wScriptRunning) !== 0,
      scriptMode: r1(W1.wScriptMode),
      jumptableIndex: r0(W0.wJumptableIndex),
      menu: { selection: r0(W0.wMenuSelection), items: r0(W0.wMenuDataItems), cursorY: r0(W0.wMenuCursorY), cursorX: r0(W0.wMenuCursorX) },
      joypad: { down: h(HRAM.hJoyDown), pressed: h(HRAM.hJoyPressed), released: h(HRAM.hJoyReleased), last: h(HRAM.hJoyLast), inMenu: h(HRAM.hInMenu) },
      options: r0(W0.wOptions),
      options2: r0(W0.wOptions2),
      trainer: {
        name: decodeCrystalText(wram1.subarray(W1.wPlayerName - 0xd000, W1.wPlayerName - 0xd000 + 8)).trim(),
        id: r1w(W1.wPlayerID),
        gender: (r1(W1.wPlayerGender) & 1) === 0 ? 'BOY' : 'GIRL',
        money: (r1(W1.wMoney) << 16) | (r1(W1.wMoney + 1) << 8) | r1(W1.wMoney + 2),
        badges: JOHTO_BADGES.filter((_, index) => badgeBits & (1 << index)),
        badgeCount: JOHTO_BADGES.filter((_, index) => badgeBits & (1 << index)).length,
        pokedex: statusFlags & 0x01 ? true : false,
        playTime: { hours: r1w(W1.wGameTimeHours), minutes: r1(W1.wGameTimeMinutes), seconds: r1(W1.wGameTimeSeconds) },
        pokedexSeen: countBits(wram1, W1.wPokedexSeen - 0xd000, 32),
        pokedexCaught: countBits(wram1, W1.wPokedexCaught - 0xd000, 32),
      },
      party,
      battle,
      objects,
      mapObjects,
      items,
      keyItems,
      balls,
      eventFlags,
      scenes: { elmsLab: r1(W1.wElmsLabSceneID) },
      timeOfDay: ['MORN', 'DAY', 'NITE'][r1(W1.wTimeOfDay) & 0x03] ?? 'DAY',
      // The MBC3 clock follows the host clock; home/time.asm FixTime adds the
      // new-game offset (wStart*) to the raw RTC and stores the game time in hHours/hMinutes/hSeconds.
      clock: {
        day: DAYS_OF_WEEK[r1(W1.wCurDay) % 7],
        hour: h(HRAM.hHours) % 24,
        minute: h(HRAM.hMinutes) % 60,
        second: h(HRAM.hSeconds) % 60,
        start: { day: DAYS_OF_WEEK[r1(W1.wStartDay) % 7], hour: r1(W1.wStartHour) % 24 },
      },
      mom: { saving: (r1(W1.wMomSavingMoney) & 0x01) !== 0, money: (r1(W1.wMomsMoney) << 16) | (r1(W1.wMomsMoney + 1) << 8) | r1(W1.wMomsMoney + 2) },
      strengthActive: (r1(W1.wBikeFlags) & 0x01) !== 0, // BIKEFLAGS_STRENGTH_ACTIVE_F
      screen: decodeScreen(wram0),
    });
  };

  const hasEvent = (observation, eventName) => {
    if (!knowledge) throw new ObserverError('event lookup requires the knowledge pack');
    const index = knowledge.eventIndex(eventName);
    return (observation.eventFlags[index >> 3] & (1 << (index & 7))) !== 0;
  };

  return Object.freeze({ observe, hasEvent });
}

function countBits(bytes, start, length) {
  let count = 0;
  for (let index = 0; index < length; index += 1) {
    let byte = bytes[start + index];
    while (byte) { count += byte & 1; byte >>= 1; }
  }
  return count;
}

export function screenText(observation) {
  return observation.screen.join('\n');
}

export function screenContains(observation, text) {
  return observation.screen.some((row) => row.includes(text));
}
