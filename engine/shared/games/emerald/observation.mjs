// Atomic read-only observation of the running Emerald cartridge. Layouts come
// from include/{global,global.fieldmap,main,pokemon,battle,task,script}.h at
// pokeemerald 5eff786. Nothing here writes memory.
import { decodeGen3Text } from './text.mjs';
import { decodePokeblocks } from './beauty.mjs';

const TASK_BYTES = 40;
const TASK_COUNT = 16;
const OBJECT_EVENT_BYTES = 0x24;
const OBJECT_EVENT_COUNT = 16;
const PARTY_MEMBER_BYTES = 100;
const BATTLE_MON_BYTES = 0x58;
const TEXT_PRINTER_BYTES = 36;
const TEXT_PRINTER_COUNT = 32;
const SAVE1 = Object.freeze({ gameStats:0x159c, pos: 0x0, location: 0x4, dynamicWarp: 0x14, lastHealLocation: 0x1c, money: 0x490, coins: 0x494, registeredItem: 0x496, pcItems: 0x498, items: 0x560, keyItems: 0x5d8, pokeBalls: 0x650, tmhm: 0x690, berries: 0x790, objectEventTemplates: 0xc70, flags: 0x1270, vars: 0x139c });
const SAVE2 = Object.freeze({ playerName: 0x0, gender: 0x8, trainerId: 0xa, playTimeHours: 0xe, playTimeMinutes: 0x10, playTimeSeconds: 0x11, playTimeVBlanks: 0x12, pokedexOwned: 0x28, pokedexSeen: 0x5c, encryptionKey: 0xac });
const FLAG_BYTES = 300;
const VAR_COUNT = 256;
const VARS_START = 0x4000;

// global.berry.h, with the eight-byte ARM record stride used by
// GetBerryTreeInfo in the pinned US cartridge.
export function decodeBerryTrees(bytes,firstBerry){
 return Array.from({length:Math.floor(bytes.length/8)},(_,id)=>{const offset=id*8;return {id,itemId:bytes[offset]?firstBerry+bytes[offset]-1:null,stage:bytes[offset+1]&127,stopGrowth:Boolean(bytes[offset+1]&128),minutes:u16(bytes,offset+2),yield:bytes[offset+4]};});
}
const POCKETS = Object.freeze([
  Object.freeze({ id: 'items', offset: SAVE1.items, slots: 30 }),
  Object.freeze({ id: 'keyItems', offset: SAVE1.keyItems, slots: 30 }),
  Object.freeze({ id: 'pokeBalls', offset: SAVE1.pokeBalls, slots: 16 }),
  Object.freeze({ id: 'tmhm', offset: SAVE1.tmhm, slots: 64 }),
  Object.freeze({ id: 'berries', offset: SAVE1.berries, slots: 46 }),
]);
const SUBSTRUCT_ORDERS = Object.freeze(['GAEM', 'GAME', 'GEAM', 'GEMA', 'GMAE', 'GMEA', 'AGEM', 'AGME', 'AEGM', 'AEMG', 'AMGE', 'AMEG', 'EGAM', 'EGMA', 'EAGM', 'EAMG', 'EMGA', 'EMAG', 'MGAE', 'MGEA', 'MAGE', 'MAEG', 'MEGA', 'MEAG']);
export const DIRECTIONS = Object.freeze({ 0: 'none', 1: 'down', 2: 'up', 3: 'left', 4: 'right' });
export const SCRIPT_STATUS = Object.freeze({ 0: 'running', 1: 'waiting', 2: 'shutdown' });

function u16(bytes, offset = 0) { return bytes[offset] | (bytes[offset + 1] << 8); }
function s16(bytes, offset = 0) { return (u16(bytes, offset) << 16) >> 16; }
function u32(bytes, offset = 0) { return (bytes[offset] | (bytes[offset + 1] << 8) | (bytes[offset + 2] << 16) | (bytes[offset + 3] << 24)) >>> 0; }
function s32(bytes, offset = 0) { return u32(bytes, offset) | 0; }

function read(readMemory, address, length) {
  const value = readMemory(address, length);
  if (!(value instanceof Uint8Array) || value.length < length) throw new RangeError(`cannot read ${length} bytes at 0x${address.toString(16)}`);
  return value;
}

export function readNativeStartMenu(readMemory,manifest,tasks){
  if(!manifest.gMenuCallback||!tasks.some(task=>task.func===(manifest.Task_ShowStartMenu|1))||u32(read(readMemory,manifest.gMenuCallback,4))!==(manifest.HandleStartMenuInput|1))return null;
  return Object.freeze({cursor:read(readMemory,manifest.sStartMenuCursorPos,1)[0],actions:Object.freeze(Array.from(read(readMemory,manifest.sCurrentStartMenuActions,Math.min(9,read(readMemory,manifest.sNumStartMenuActions,1)[0]))))});
}

export function readNativePokeblockMenu(readMemory,manifest,core,save1){
 if(!manifest.sSavedPokeblockData)return null;
 const saved=read(readMemory,manifest.sSavedPokeblockData,8);
 const result={cursor:u16(saved,4)+u16(saved,6),selectedSlot:u16(read(readMemory,manifest.gSpecialVar_ItemId,2))};
 // use_pokeblock.c frees sMenu without clearing its interior sInfo pointer.
 // Only the actual use-screen callback may dereference that allocation.
 if(core.callback2!==(manifest.CB2_UsePokeblockMenu|1))return result;
 const ptr=u32(read(readMemory,manifest.sInfo,4));
 if(ptr<0x02000000||ptr+124>0x02040000)return result;
 const b=read(readMemory,ptr,124),fn=u32(b),blockOffset=u32(b,8)-(save1+0x848);
 const phase=['UsePokeblockMenu','ShowPokeblockResults','CloseUsePokeblockMenu','FeedPokeblockToMon'].find(name=>fn===(manifest[name]|1));
 if(phase)Object.assign(result,{phase,state:b[80],selection:b[113],selections:b[112],blockSlot:blockOffset>=0&&blockOffset<320&&blockOffset%8===0?blockOffset/8:null});
 return result;
}

export function decodePokemon(bytes, tables = null, charmap = undefined) {
  const personality = u32(bytes, 0);
  const otId = u32(bytes, 4);
  const flags = bytes[19];
  const hasSpecies = (flags & 2) !== 0;
  const key = (personality ^ otId) >>> 0;
  const order = SUBSTRUCT_ORDERS[personality % 24];
  const secure = new Uint8Array(48);
  for (let index = 0; index < 12; index += 1) {
    const word = (u32(bytes, 32 + index * 4) ^ key) >>> 0;
    secure[index * 4] = word & 0xff; secure[index * 4 + 1] = (word >>> 8) & 0xff; secure[index * 4 + 2] = (word >>> 16) & 0xff; secure[index * 4 + 3] = word >>> 24;
  }
  const sub = (letter) => secure.subarray(order.indexOf(letter) * 12, order.indexOf(letter) * 12 + 12);
  const growth = sub('G');
  const attacks = sub('A');
  const condition = sub('E');
  const misc = sub('M');
  const species = u16(growth, 0);
  const ivWord = u32(misc, 4);
  const moves = [0, 1, 2, 3].map(slot => {const id=u16(attacks,slot*2),base=id&&tables?tables.move(id).pp:null;return Object.freeze({id,pp:attacks[8+slot],maxPp:base?Math.floor(base*(5+((growth[8]>>(slot*2))&3))/5):null});}).filter(move => move.id !== 0);
  const info = tables && species ? tables.species(species) : null;
  let checksum=0;for(let i=0;i<48;i+=2)checksum=(checksum+u16(secure,i))&65535;
  const shinyValue=((personality>>>16)^(personality&65535)^(otId>>>16)^(otId&65535))&65535;
  return Object.freeze({
    personality, otId,
    validity:hasSpecies&&!(flags&1)&&species>0&&species<=411&&checksum===u16(bytes,28)?'valid':'invalid',
    shiny:shinyValue<8,shinyValue,
    nickname: decodeGen3Text(bytes.subarray(8, 18), charmap),
    hasSpecies,
    isEgg: (flags & 4) !== 0 || ((ivWord >>> 30) & 1) === 1,
    isBadEgg: (flags & 1) !== 0,
    species,
    speciesName: info?.name ?? null,
    types: info ? info.types : Object.freeze([]),
    heldItem: u16(growth, 2),
    experience: u32(growth, 4),
    friendship: growth[9],
    evs:Object.freeze({hp:condition[0],attack:condition[1],defense:condition[2],speed:condition[3],spAttack:condition[4],spDefense:condition[5]}),
    beauty:condition[7],sheen:condition[11],
    moves: Object.freeze(moves.map(move => Object.freeze({ ...move, name: tables ? tables.move(move.id).name : null, power: tables ? tables.move(move.id).power : null, type: tables ? tables.move(move.id).type : null }))),
    ivs: Object.freeze({ hp: ivWord & 31, attack: (ivWord >>> 5) & 31, defense: (ivWord >>> 10) & 31, speed: (ivWord >>> 15) & 31, spAttack: (ivWord >>> 20) & 31, spDefense: (ivWord >>> 25) & 31 }),
    abilityNum: (ivWord >>> 31) & 1,
    metLevel: u16(misc, 2) & 0x7f,
    status: u32(bytes, 80),
    level: bytes[84],
    hp: u16(bytes, 86),
    maxHp: u16(bytes, 88),
    stats: Object.freeze({ attack: u16(bytes, 90), defense: u16(bytes, 92), speed: u16(bytes, 94), spAttack: u16(bytes, 96), spDefense: u16(bytes, 98) }),
  });
}

export function decodeBattleMon(bytes, tables) {
  const species = u16(bytes, 0);
  const moves = [0, 1, 2, 3].map(slot => Object.freeze({ id: u16(bytes, 0x0c + slot * 2), pp: bytes[0x24 + slot] })).filter(move => move.id !== 0);
  return Object.freeze({
    species,
    speciesName: species && tables ? tables.species(species).name : null,
    stats: Object.freeze({ attack: u16(bytes, 2), defense: u16(bytes, 4), speed: u16(bytes, 6), spAttack: u16(bytes, 8), spDefense: u16(bytes, 10) }),
    moves: Object.freeze(moves.map(move => Object.freeze({ ...move, name: tables ? tables.move(move.id).name : null, power: tables ? tables.move(move.id).power : null, type: tables ? tables.move(move.id).type : null, accuracy: tables ? tables.move(move.id).accuracy : null }))),
    statStages: Object.freeze(Array.from(bytes.subarray(0x18, 0x20), value => (value << 24) >> 24)),
    ability: bytes[0x20],
    types: Object.freeze([bytes[0x21], bytes[0x22]]),
    hp: u16(bytes, 0x28),
    level: bytes[0x2a],
    maxHp: u16(bytes, 0x2c),
    item: u16(bytes, 0x2e),
    personality: u32(bytes, 0x48),
    otId: u32(bytes, 0x54),
    status1: u32(bytes, 0x4c),
    status2: u32(bytes, 0x50),
  });
}

export function readNativeScript(readMemory,manifest) {
    const status = read(readMemory, manifest.sGlobalScriptContextStatus, 1)[0];
    const context = read(readMemory, manifest.sGlobalScriptContext, 0x74);
    const printers = read(readMemory, manifest.sTextPrinters, TEXT_PRINTER_BYTES * TEXT_PRINTER_COUNT);
    let textPrinterActive = false;
    for (let id = 0; id < TEXT_PRINTER_COUNT; id += 1) if (printers[id * TEXT_PRINTER_BYTES + 0x1b] !== 0) { textPrinterActive = true; break; }
    return Object.freeze({
      status: SCRIPT_STATUS[status] ?? `unknown-${status}`,
      running: status === 0,
      mode: context[1],
      scriptPointer: u32(context, 8),
      fieldControlsLocked: read(readMemory, manifest.sLockFieldControls, 1)[0] !== 0,
      textPrinterActive,
      specialVarResult: u16(read(readMemory, manifest.gSpecialVar_Result, 2)),
      lastTalked: u16(read(readMemory, manifest.gSpecialVar_LastTalked, 2)),
    });
  }

export function createEmeraldObserver({ readMemory, manifest, constants, tables = null, charmap = undefined, frameOf = () => null }) {
  if (typeof readMemory !== 'function') throw new TypeError('readMemory must be a function');
  if (!manifest || !constants) throw new TypeError('observer requires a runtime manifest and constants');
  const playerBattlerFuncs = new Set([
    manifest.HandleInputChooseAction | 1, manifest.HandleInputChooseMove | 1, manifest.HandleInputChooseTarget | 1,
    manifest.PlayerHandleYesNoInput | 1, manifest.OpenPartyMenuToChooseMon | 1, manifest.WaitForMonSelection | 1,
    manifest.OpenBagAndChooseItem | 1, manifest.CompleteWhenChoseItem | 1,
  ]);
  const funcNames = new Map();
  for (const [name, address] of Object.entries(manifest)) if (address >= 0x08000000) funcNames.set(address | 1, name);
  const nameOf = (address) => funcNames.get(address | 1) ?? null;
  const flagIndex = (name) => { const id = constants.flags[name]; if (id === undefined) throw new ReferenceError(`unknown flag ${name}`); return id; };
  const varIndex = (name) => { const id = constants.vars[name]; if (id === undefined) throw new ReferenceError(`unknown var ${name}`); return id; };

  const readTasks = () => {
    const bytes = read(readMemory, manifest.gTasks, TASK_BYTES * TASK_COUNT);
    const tasks = [];
    for (let id = 0; id < TASK_COUNT; id += 1) {
      const offset = id * TASK_BYTES;
      if (bytes[offset + 4] === 0) continue;
      const func = u32(bytes, offset);
      tasks.push(Object.freeze({ id, func, name: nameOf(func), data: Object.freeze(Array.from({ length: 16 }, (_, index) => s16(bytes, offset + 8 + index * 2))) }));
    }
    return tasks;
  };

  const readCore = () => {
    const main = read(readMemory, manifest.gMain, 0x43c);
    const fade = read(readMemory, manifest.gPaletteFade, 12);
    const callback2 = u32(main, 4);
    return Object.freeze({
      callback1: u32(main, 0),
      callback2,
      callback2Name: nameOf(callback2),
      vblankCounter: u32(main, 0x20),
      heldKeys: u16(main, 0x2c),
      newKeys: u16(main, 0x2e),
      state: main[0x438],
      inBattle: (main[0x439] & 2) !== 0,
      paletteFadeActive: (u16(fade, 6) & 0x8000) !== 0, // include/palette.h: bool16 active:1 is bit 15 of the u16 at +6
      fieldCallback: u32(read(readMemory, manifest.gFieldCallback, 4)),
    });
  };

  const readScript = () => readNativeScript(readMemory,manifest);

  const readObjects = () => {
    const bytes = read(readMemory, manifest.gObjectEvents, OBJECT_EVENT_BYTES * OBJECT_EVENT_COUNT);
    const objects = [];
    for (let id = 0; id < OBJECT_EVENT_COUNT; id += 1) {
      const offset = id * OBJECT_EVENT_BYTES;
      if ((bytes[offset] & 1) === 0) continue;
      const directions = u16(bytes, offset + 0x18);
      objects.push(Object.freeze({
        id,
        isPlayer: (bytes[offset + 2] & 1) !== 0,
        invisible: (bytes[offset + 1] & 0x20) !== 0,
        heldMovementActive: (bytes[offset] & 0x40) !== 0,
        heldMovementFinished: (bytes[offset] & 0x80) !== 0,
        frozen: (bytes[offset + 1] & 1) !== 0,
        graphicsId: bytes[offset + 5],
        movementType: bytes[offset + 6],
        trainerType: bytes[offset + 7],
        localId: bytes[offset + 8],
        mapNum: bytes[offset + 9],
        mapGroup: bytes[offset + 10],
        elevation: bytes[offset + 11] & 0xf,
        x: s16(bytes, offset + 0x10) - 7,
        y: s16(bytes, offset + 0x12) - 7,
        previousX: s16(bytes, offset + 0x14) - 7,
        previousY: s16(bytes, offset + 0x16) - 7,
        facing: DIRECTIONS[directions & 0xf] ?? 'none',
        movementDirection: DIRECTIONS[(directions >> 4) & 0xf] ?? 'none',
        movementActionId: bytes[offset + 0x1c],
        currentMetatileBehavior: bytes[offset + 0x1e],
      }));
    }
    return objects;
  };

  const readSaveBlocks = () => {
    const save1Pointer = u32(read(readMemory, manifest.gSaveBlock1Ptr, 4));
    const save2Pointer = u32(read(readMemory, manifest.gSaveBlock2Ptr, 4));
    if (save1Pointer < 0x02000000 || save2Pointer < 0x02000000) return null;
    return { save1Pointer, save2Pointer };
  };

  const tick = () => {
    const core = readCore();
    const pointers = readSaveBlocks();
    let map = null;
    let position = null;
    if (pointers) {
      const head = read(readMemory, pointers.save1Pointer, 16);
      map = Object.freeze({ group: head[4], number: head[5] });
      position = Object.freeze({ x: s16(head, 0), y: s16(head, 2) });
    }
    const avatar = read(readMemory, manifest.gPlayerAvatar, 8);
    const script = readScript();
    return Object.freeze({
      frame: frameOf(),
      callback2: core.callback2,
      callback2Name: core.callback2Name,
      inBattle: core.inBattle,
      paletteFadeActive: core.paletteFadeActive,
      map, position,
      mapId: map ? (constants.maps.at(map.group, map.number)?.id ?? null) : null,
      scriptRunning: script.running,
      fieldControlsLocked: script.fieldControlsLocked,
      textPrinterActive: script.textPrinterActive,
      tileTransitionState: avatar[3],
      runningState: avatar[2],
      avatarFlags: avatar[0],
    });
  };

  const observe = () => {
    const frame = frameOf();
    const core = readCore();
    const tasks = readTasks();
    const script = readScript();
    const pointers = readSaveBlocks();
    const avatarBytes = read(readMemory, manifest.gPlayerAvatar, 0x24);
    const objects = readObjects();
    const playerObject = objects.find(object => object.isPlayer) ?? null;
    let player = null;
    let bag = null;
    let flags = null;
    let vars = null;
    if (pointers) {
      const save1 = read(readMemory, pointers.save1Pointer, SAVE1.gameStats+64*4);
      const save2 = read(readMemory, pointers.save2Pointer, 0xb0);
      const key = u32(save2, SAVE2.encryptionKey);
      flags = save1.slice(SAVE1.flags, SAVE1.flags + FLAG_BYTES);
      vars = new Uint16Array(VAR_COUNT);
      for (let index = 0; index < VAR_COUNT; index += 1) vars[index] = u16(save1, SAVE1.vars + index * 2);
      const map = Object.freeze({ group: save1[SAVE1.location], number: save1[SAVE1.location + 1], warpId: (save1[SAVE1.location + 2] << 24) >> 24, x: s16(save1, SAVE1.location + 4), y: s16(save1, SAVE1.location + 6) });
      const catalogEntry = constants.maps.at(map.group, map.number);
      let owned = 0; let seen = 0;
      for (let index = 0; index < 52; index += 1) {
        let value = save2[SAVE2.pokedexOwned + index]; while (value) { owned += value & 1; value >>= 1; }
        value = save2[SAVE2.pokedexSeen + index]; while (value) { seen += value & 1; value >>= 1; }
      }
      const pockets = {};
      for (const pocket of POCKETS) {
        const list = [];
        for (let slot = 0; slot < pocket.slots; slot += 1) {
          const itemId = u16(save1, pocket.offset + slot * 4);
          if (itemId === 0) continue;
          const quantity = (u16(save1, pocket.offset + slot * 4 + 2) ^ (key & 0xffff)) & 0xffff;
          list.push(Object.freeze({ itemId, name: tables ? tables.item(itemId).name : null, quantity }));
        }
        pockets[pocket.id] = Object.freeze(list);
      }
      bag = Object.freeze(pockets);
      player = Object.freeze({
        gameStats:Object.freeze(Object.fromEntries(Object.entries({steps:5,battles:7,wildBattles:8,trainerBattles:9,leagueEntries:10,captures:11,fishingCaptures:12,eggsHatched:13,evolutions:14,heals:15,trades:21}).filter(([,i])=>SAVE1.gameStats+i*4+4<=save1.length).map(([name,i])=>[name,(u32(save1,SAVE1.gameStats+i*4)^key)>>>0]))),
        savedGameStat:(u32(save1,SAVE1.gameStats)^key)>>>0,
        name: decodeGen3Text(save2.subarray(SAVE2.playerName, SAVE2.playerName + 8), charmap),
        gender: save2[SAVE2.gender] === 1 ? 'FEMALE' : 'MALE',
        trainerId: u16(save2, SAVE2.trainerId),
        money: (u32(save1, SAVE1.money) ^ key) >>> 0,
        playTime: Object.freeze({ hours: u16(save2, SAVE2.playTimeHours), minutes: save2[SAVE2.playTimeMinutes], seconds: save2[SAVE2.playTimeSeconds], vblanks: save2[SAVE2.playTimeVBlanks] }),
        pokedex: Object.freeze({ owned, seen }),
        map: Object.freeze({ ...map, id: catalogEntry?.id ?? null, name: catalogEntry?.name ?? null }),
        position: Object.freeze({ x: s16(save1, SAVE1.pos), y: s16(save1, SAVE1.pos + 2) }),
        facing: playerObject?.facing ?? 'none',
        elevation: playerObject?.elevation ?? 0,
        lastHealLocation: Object.freeze({ group: save1[SAVE1.lastHealLocation], number: save1[SAVE1.lastHealLocation + 1], x: s16(save1, SAVE1.lastHealLocation + 4), y: s16(save1, SAVE1.lastHealLocation + 6) }),
        avatar: Object.freeze({ flags: avatarBytes[0], transitionFlags: avatarBytes[1], runningState: avatarBytes[2], tileTransitionState: avatarBytes[3], objectEventId: avatarBytes[5], preventStep: avatarBytes[6] !== 0 }),
      });
    }
    const partyCount = Math.min(read(readMemory, manifest.gPlayerPartyCount, 1)[0], 6);
    const partyBytes = partyCount ? read(readMemory, manifest.gPlayerParty, partyCount * PARTY_MEMBER_BYTES) : new Uint8Array();
    const party = [];
    for (let index = 0; index < partyCount; index += 1) party.push(decodePokemon(partyBytes.subarray(index * PARTY_MEMBER_BYTES, (index + 1) * PARTY_MEMBER_BYTES), tables, charmap));
    let battle = null;
    if (core.inBattle || core.callback2 === (manifest.BattleMainCB2 | 1)) {
      const typeFlags = u32(read(readMemory, manifest.gBattleTypeFlags, 4));
      const battlersCount = read(readMemory, manifest.gBattlersCount, 1)[0];
      const positions = read(readMemory, manifest.gBattlerPositions, 4);
      const partyIndexes = read(readMemory, manifest.gBattlerPartyIndexes, 8);
      const controllerFuncs = read(readMemory, manifest.gBattlerControllerFuncs, 16);
      const monBytes = read(readMemory, manifest.gBattleMons, BATTLE_MON_BYTES * 4);
      const communication = read(readMemory, manifest.gBattleCommunication, 8);
      const actionCursor = read(readMemory, manifest.gActionSelectionCursor, 4);
      const moveCursor = read(readMemory, manifest.gMoveSelectionCursor, 4);
      const battlers = [];
      for (let battler = 0; battler < Math.min(battlersCount, 4); battler += 1) {
        const func = u32(controllerFuncs, battler * 4);
        const restrictions=manifest.gDisableStructs?read(readMemory,manifest.gDisableStructs+battler*28,28):new Uint8Array(28);
        battlers.push(Object.freeze({
          battler,
          position: positions[battler],
          side: (positions[battler] & 1) === 0 ? 'player' : 'opponent',
          partyIndex: u16(partyIndexes, battler * 2),
          controllerFunc: func,
          controllerName: nameOf(func),
          awaitingInput: playerBattlerFuncs.has(func | 1),
          actionCursor: actionCursor[battler],
          moveCursor: moveCursor[battler],
          mon: Object.freeze({...decodeBattleMon(monBytes.subarray(battler * BATTLE_MON_BYTES, (battler + 1) * BATTLE_MON_BYTES), tables),disabledMove:u16(restrictions,4),encoredMove:u16(restrictions,6),encoreTimer:restrictions[14]&15,tauntTimer:restrictions[19]&15}),
        }));
      }
      const opponentId = u16(read(readMemory, manifest.gTrainerBattleOpponent_A, 2));
      const isTrainer = (typeFlags & constants.battleTypes.BATTLE_TYPE_TRAINER) !== 0;
      const enemyCount = isTrainer && tables ? Math.min(tables.trainer(opponentId).partySize, 6) : 1;
      const enemyBytes = read(readMemory, manifest.gEnemyParty, enemyCount * PARTY_MEMBER_BYTES);
      const enemyParty = [];
      for (let index = 0; index < enemyCount; index += 1) enemyParty.push(decodePokemon(enemyBytes.subarray(index * PARTY_MEMBER_BYTES, (index + 1) * PARTY_MEMBER_BYTES), tables, charmap));
      battle = Object.freeze({
        typeFlags,
        isTrainer,
        isDouble: (typeFlags & constants.battleTypes.BATTLE_TYPE_DOUBLE) !== 0,
        isFirstBattle: (typeFlags & constants.battleTypes.BATTLE_TYPE_FIRST_BATTLE) !== 0,
        isWallyTutorial: (typeFlags & constants.battleTypes.BATTLE_TYPE_WALLY_TUTORIAL) !== 0,
        outcome: read(readMemory, manifest.gBattleOutcome, 1)[0],
        opponentTrainerId: opponentId,
        opponentTrainer: isTrainer && tables ? tables.trainer(opponentId) : null,
        mainFunc: u32(read(readMemory, manifest.gBattleMainFunc, 4)),
        communication: Object.freeze(Array.from(communication)),
        battlers: Object.freeze(battlers),
        enemyParty: Object.freeze(enemyParty),
      });
    }
    const partyMenuBytes = read(readMemory, manifest.gPartyMenu, 0x14);
    // src/pokemon_summary_screen.c: sMonSummaryScreen → heap struct; newMove u16 at
    // 0x40C4 and firstMoveIndex u8 at 0x40C6 (bgTilemapBuffers[4][2][0x400] precede them).
    let summaryScreen = null;
    const summaryPointer = u32(read(readMemory, manifest.sMonSummaryScreen, 4));
    if (summaryPointer >= 0x02000000 && summaryPointer + 0x40d0 <= 0x02040000) {
      const summaryBytes = read(readMemory, summaryPointer + 0x40bc, 0x10);
      summaryScreen = Object.freeze({ mode: summaryBytes[0], curMonIndex: summaryBytes[2], newMove: u16(summaryBytes, 8), cursor: summaryBytes[10], secondCursor: summaryBytes[11] });
    }
    // include/item_menu.h struct BagPosition: exitCallback u32, location u8 @4, pocket u8 @5,
    // pocketSwitchArrowPos u16 @6, cursorPosition[5] u16 @8, scrollPosition[5] u16 @18.
    const bagBytes = read(readMemory, manifest.gBagPosition, 0x1c);
    const menuBytes = manifest.sMenu ? read(readMemory, manifest.sMenu, 12) : null;
    const menuCursor = menuBytes ? (menuBytes[2] << 24) >> 24 : 0;
    // src/shop.c: sShopData → heap struct; tilemapBuffers[4][0x400] u16 precede totalCost u32 @0x2000,
    // itemsShowed u16 @0x2004, selectedRow @0x2006, scrollOffset @0x2008, maxQuantity u8 @0x200a.
    let shop = null;
    const shopPointer = u32(read(readMemory, manifest.sShopData, 4));
    if (shopPointer >= 0x02000000 && shopPointer + 0x2010 <= 0x02040000) {
      const shopBytes = read(readMemory, shopPointer + 0x2000, 0x10);
      const martBytes = read(readMemory, manifest.sMartInfo, 16);
      // src/shop.c struct MartInfo: callback, menuActions, itemList @8, itemCount u16 @12
      const listPointer = u32(martBytes, 8);
      const itemCount = u16(martBytes, 12);
      let items = [];
      if (listPointer >= 0x08000000 && listPointer < 0x0a000000 && itemCount > 0 && itemCount <= 64) {
        const listBytes = read(readMemory, listPointer, itemCount * 2);
        for (let index = 0; index < itemCount; index += 1) items.push(u16(listBytes, index * 2));
      }
      const quantityTask = tasks.find(task => task.func === (manifest.Task_BuyHowManyDialogueHandleInput | 1));
      shop = Object.freeze({ totalCost: u32(shopBytes, 0), itemsShowed: u16(shopBytes, 4), selectedRow: u16(shopBytes, 6), scrollOffset: u16(shopBytes, 8), maxQuantity: shopBytes[10], items: Object.freeze(items), quantity: quantityTask ? quantityTask.data[1] : null });
    }
    const menus = Object.freeze({
      pokeblock:readNativePokeblockMenu(readMemory,manifest,core,pointers?.save1Pointer),
      startMenu:readNativeStartMenu(readMemory,manifest,tasks),
      summaryScreen,
      shop,
      menuCursor,
      multichoice: Object.freeze({ active: tasks.some(task => task.func === (manifest.Task_HandleMultichoiceInput | 1)), cursor: menuCursor, min: menuBytes ? (menuBytes[3] << 24) >> 24 : 0, max: menuBytes ? (menuBytes[4] << 24) >> 24 : 0 }),
      bag: Object.freeze({ location: bagBytes[4], pocket: bagBytes[5], selectedItemId:u16(read(readMemory,manifest.gSpecialVar_ItemId,2)),cursor: Object.freeze([0, 1, 2, 3, 4].map(index => u16(bagBytes, 8 + index * 2))), scroll: Object.freeze([0, 1, 2, 3, 4].map(index => u16(bagBytes, 18 + index * 2))) }),
      partyMenu: Object.freeze({ slotId: (partyMenuBytes[9] << 24) >> 24, slotId2: (partyMenuBytes[10] << 24) >> 24, action: partyMenuBytes[11], menuType: partyMenuBytes[8] & 0xf, bagItem: u16(partyMenuBytes, 12) }),
      selectedPartyOrder:Object.freeze(Array.from(read(readMemory,manifest.gSelectedOrderFromParty,4))),
      startMenuCursor: read(readMemory, manifest.sStartMenuCursorPos, 1)[0],
      moveToLearn: u16(read(readMemory, manifest.gMoveToLearn, 2)),
      yesNoActive: tasks.some(task => task.func === (manifest.Task_HandleYesNoInput | 1) || task.func === (manifest.Task_CallYesOrNoCallback | 1)),
    });
    const observation = {
      schema: 'pokemon-research/emerald-observation/v1',
      frame,
      capturedAt: new Date().toISOString(),
      emulator: Object.freeze({ ...core, mode: modeFor(core, manifest, tasks) }),
      tasks: Object.freeze(tasks),
      script,
      player,
      berryTrees:pointers?decodeBerryTrees(read(readMemory,pointers.save1Pointer+0x169c,128*8),constants.items.ITEM_CHERI_BERRY):[],
      pokeblocks:pointers?decodePokeblocks(read(readMemory,pointers.save1Pointer+0x848,320)):[],
      localTime:(()=>{const b=read(readMemory,manifest.gLocalTime,8);return {days:s16(b,0),hours:b[2],minutes:b[3],seconds:b[4]};})(),
      party: Object.freeze(party),
      bag,
      objects: Object.freeze(objects),
      battle,
      menus,
      flag(name) { return flags ? (flags[flagIndex(name) >> 3] & (1 << (flagIndex(name) & 7))) !== 0 : false; },
      flagById(id) { return flags ? (flags[id >> 3] & (1 << (id & 7))) !== 0 : false; },
      var(name) { return vars ? vars[varIndex(name) - VARS_START] : 0; },
      varById(id) { return vars ? vars[id - VARS_START] : 0; },
      hasTask(symbol) { const address = manifest[symbol]; return tasks.some(task => task.func === (address | 1)); },
      task(symbol) { const address = manifest[symbol]; return tasks.find(task => task.func === (address | 1)) ?? null; },
      is(symbol) { return core.callback2 === (manifest[symbol] | 1); },
    };
    observation.nativeSave=Object.freeze({fileStatus:u16(read(readMemory,manifest.gSaveFileStatus,2)),counter:u32(read(readMemory,manifest.gSaveCounter,4)),gameStat:player?.savedGameStat,differentFile:Boolean(read(readMemory,manifest.gDifferentSaveFile,1)[0]),callback:nameOf(u32(read(readMemory,manifest.sSaveDialogCallback,4))),active:tasks.some(t=>t.func===(manifest.Task_ShowStartMenu|1))&&['SaveCallback','SaveStartCallback','StartMenuSaveCallback'].some(name=>u32(read(readMemory,manifest.gMenuCallback,4))===(manifest[name]|1))});
    observation.fieldReady = Boolean(player) && !menus.startMenu && observation.is('CB2_Overworld') && !core.inBattle && !script.running && !script.fieldControlsLocked && !core.paletteFadeActive && !script.textPrinterActive && player.avatar.tileTransitionState === 0 && !(playerObject?.heldMovementActive && !playerObject?.heldMovementFinished);
    observation.dialogActive = observation.is('CB2_Overworld') && !core.inBattle && (script.running || script.fieldControlsLocked || script.textPrinterActive);
    return Object.freeze(observation);
  };

  return Object.freeze({ tick, observe, readTasks, nameOf });
}

export function modeFor(core, manifest, tasks = []) {
  if (core.inBattle || core.callback2 === (manifest.BattleMainCB2 | 1)) return 'battle';
  if (core.callback2 === (manifest.CB2_Overworld | 1)) return 'overworld';
  if (core.callback2 === (manifest.CB2_MainMenu | 1)) return 'main-menu';
  if (core.callback2 === (manifest.CB2_NamingScreen | 1)) return 'naming-screen';
  if (core.callback2 === (manifest.CB2_ChooseStarter | 1) || core.callback2 === (manifest.CB2_StarterChoose | 1)
    || tasks.some(task => task.func === (manifest.Task_HandleStarterChooseInput | 1) || task.func === (manifest.Task_HandleConfirmStarterInput | 1))) return 'starter-choice';
  if (core.callback2 === (manifest.CB2_WallClock | 1)) return 'wall-clock';
  if (core.callback2 === (manifest.CB2_UpdatePartyMenu | 1)) return 'party-menu';
  if (core.callback2 === (manifest.CB2_BerryTagScreen | 1)) return 'berry-tag';
  if (core.callback2 === (manifest.CB2_BagMenuRun | 1)) return 'bag';
  if (['CB2_UsePokeblockMenu','CB2_PokeblockMenu','CB2_PokeblockFeed'].some(name=>core.callback2===(manifest[name]|1)))return 'pokeblock';
  if (core.callback2 === (manifest.CB2_EvolutionSceneUpdate | 1)) return 'evolution';
  if (core.callback2 === (manifest.CB2_InitSummaryScreen | 1)) return 'summary';
  if (core.callback2 === (manifest.CB2_LoadMap | 1) || core.callback2 === (manifest.CB2_DoChangeMap | 1)) return 'map-load';
  if (core.callback2 === (manifest.CB2_WhiteOut | 1)) return 'white-out';
  if (core.callback2 === (manifest.CB2_InitPokeNav | 1) || core.callback2 === (manifest.CB2_Pokenav | 1)) return 'pokenav';
  if (core.callback2 === (manifest.CB2_BuyMenu | 1) || core.callback2 === (manifest.CB2_InitBuyMenu | 1)) return 'shop';
  return 'transition';
}
