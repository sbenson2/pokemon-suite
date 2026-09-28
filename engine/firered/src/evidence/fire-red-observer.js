import { readTownMapPosition } from '../presentation/region-map.js';
import {decodeGameCounters,createPartyDisplayReader} from '../presentation/cartridge-display.js';
import { createHash } from "node:crypto";
import { decodeBoxPokemonRecord } from "./pokemon-record.js";
import { readFieldHeap } from "./field-heap.js";
import {decodeMailState,decodeEasyChatState,partyPromptStage,decodeBattleItemState} from "./mail-state.js";

const EWRAM_START = 0x02000000;
const EWRAM_END = 0x02040000;
const ROM_START = 0x08000000;
const ROM_END = 0x0a000000;
const PALETTE_FADE_ACTIVE_OFFSET = 7;
const PALETTE_FADE_ACTIVE_MASK = 0x80;
const BATTLE_TYPE_DOUBLE = 1 << 0;
const VS_SEEKER_REMATCH_ENTRY_COUNT = 100;
const EVOLUTION_STATE_REPLACE_MOVE = 22;
const EVOLUTION_MOVE_STATE_HANDLE_YES_NO = 4;
const EVOLUTION_MOVE_STATE_SHOW_MOVE_SELECT = 5;
const EVOLUTION_MOVE_STATE_CANCEL = 11;
const IN_GAME_TRADE_STATE_END = 71;
const IN_GAME_TRADE_STATE_BYTES = 0x96;
const TRANSIENT_CALLBACK =
  /(LoadMap|ChangeMap|ReturnToField|StartBattle|Init|SetUp|OpenBagMenu|WhiteOut|BeginEvolution|Fade|Transition|NewGameScene|CB2_PSA)/;
const TRANSIENT_TASK =
  /(BattleStart|BattleTransition|ExitDoor|ExitNonAnimDoor|ExitNonDoor|ExitStairs|Warp|Fade|EndQuestLog|MapNamePopup|Task_ForgetMove|FieldEffect|FldEff|ShowMon|DuckBGMForPokemonCry)/;
const TRANSIENT_MODAL_TASKS = new Set([
  "Task_ContinueTaskAfterMessagePrints",
  "BuyMenuTryMakePurchase",
  "BuyMenuReturnToItemList",
  "Task_GoToBuyOrSellMenu",
  "Task_ExitBuyMenu",
  "Task_ReturnToShopMenu",
  "Task_ExecuteMainMenuSelection",
]);
const MART_READY_TASK_STAGES = Object.freeze({
  Task_ShopMenu: "shop-menu",
  Task_BuyMenu: "item-list",
  Task_BuyHowManyDialogueHandleInput: "quantity",
  Task_ReturnToItemListAfterItemPurchase: "purchase-result",
});
const STORAGE_OPTIONS = [
  "withdraw",
  "deposit",
  "move-pokemon",
  "move-items",
  "exit",
];
const STORAGE_CURSOR_AREAS = ["box", "party", "box-title", "buttons"];
// Pinned FireRed enum of storage menu labels (pokemon_storage_system_internal.h
// MENU_TEXT_*), in sMenuTexts order.
const STORAGE_MENU_TEXTS = Object.freeze([
  "cancel", "store", "withdraw", "move", "shift", "place", "summary", "release",
  "mark", "jump", "wallpaper", "name", "take", "give", "give", "switch", "bag",
  "info", "scenery-1", "scenery-2", "scenery-3", "etcetera", "forest", "city",
  "desert", "savanna", "crag", "volcano", "snow", "cave", "beach", "seafloor",
  "river", "sky", "polka-dot", "pokecenter", "machine", "simple",
]);
// Pinned FireRed struct PokemonStorageSystemData (ARM EABI layout):
// menuItems[7] (struct StorageMenu {const u8 *text; int textId;}) at 0xC70 and
// menuItemsCount at 0xCA8.
const STORAGE_MENU_ITEMS_OFFSET = 0xc70;
const STORAGE_MENU_BLOCK_BYTES = 57;
// Task_ReleaseMon's gStorage->state values that wait for input
// (pokemon_storage_system_tasks.c). 1 is the Yes/No prompt; 4 and 5 follow a
// completed release; 9-13 are the cartridge's "came back" refusal (the last
// Surf or Dive user), which leaves the Pokémon in place.
const RELEASE_STORAGE_STATES = Object.freeze({
  1: ["release-confirm", null],
  4: ["release-message", "released"],
  5: ["release-message", "bye-bye"],
  9: ["release-refused", "released"],
  10: ["release-refused", "surprise"],
  12: ["release-refused", "came-back"],
  13: ["release-refused", "worried"],
});
const BATTLE_ACTIONS = ["fight", "bag", "pokemon", "run"];
const START_MENU_ITEMS = [
  "pokedex",
  "pokemon",
  "bag",
  "player",
  "save",
  "option",
  "exit",
  "retire",
  "player-link",
];
const PARTY_CURSOR_ACTIONS = [
  "summary",
  "switch",
  "cancel",
  "item",
  "give",
  "take-item",
  "mail",
  "take-mail",
  "read",
  "cancel",
  "shift",
  "send-out",
  "enter",
  "no-entry",
  "store",
  "register",
  "trade",
  "trade",
  "flash",
  "cut",
  "fly",
  "strength",
  "surf",
  "rock-smash",
  "waterfall",
  "teleport",
  "dig",
  "milk-drink",
  "soft-boiled",
  "sweet-scent",
];
const SAVE_MENU_CALLBACKS = new Set([
  "StartMenuSaveCallback",
  "StartCB_Save1",
  "StartCB_Save2",
]);
const SAVE_DIALOG_STAGES = Object.freeze({
  SaveDialogCB_PrintAskSaveText: "opening",
  SaveDialogCB_AskSavePrintYesNoMenu: "opening",
  SaveDialogCB_AskSaveHandleInput: "confirm-save",
  SaveDialogCB_PrintAskOverwriteText: "opening-overwrite",
  SaveDialogCB_AskOverwritePrintYesNoMenu: "opening-overwrite",
  SaveDialogCB_AskReplacePreviousFilePrintYesNoMenu: "opening-overwrite",
  SaveDialogCB_AskOverwriteOrReplacePreviousFileHandleInput:
    "confirm-overwrite",
  SaveDialogCB_PrintSavingDontTurnOffPower: "saving",
  SaveDialogCB_DoSave: "saving",
  SaveDialogCB_PrintSaveResult: "saving",
  SaveDialogCB_WaitPrintSuccessAndPlaySE: "saving",
  SaveDialogCB_ReturnSuccess: "success",
  SaveDialogCB_WaitPrintErrorAndPlaySE: "saving-error",
  SaveDialogCB_ReturnError: "error",
});
const SAVE_DIALOG_READY_STAGES = new Set([
  "confirm-save",
  "confirm-overwrite",
  "success",
  "error",
]);
const NEW_GAME_READY_TASK_STAGES = Object.freeze({
  Task_ControlsGuide_HandleInput: "controls-guide",
  Task_PikachuIntro_HandleInput: "pikachu-guide",
  Task_OakSpeech_HandleGenderInput: "choose-gender",
  Task_OakSpeech_HandleConfirmNameInput: "confirm-name",
  Task_OakSpeech_HandleRivalNameInput: "choose-rival-name",
});
const FIELD_MESSAGE_TYPES = ["hidden", "unused", "normal", "auto-scroll"];
const TEXT_PRINTER_STATES = [
  "handle-character",
  "wait-for-press",
  "clear-prompt",
  "scroll-prompt",
  "scrolling",
  "wait-sound-effect",
  "pause",
];
const TEXT_PRINTER_READY_STATES = new Set([1, 2, 3]);
const BATTLE_MESSAGE_WINDOW_IDS = Object.freeze([0, 24]);
const SCRIPT_CONTEXT_STATUSES = ["running", "waiting", "shutdown"];
const SCRIPT_CONTEXT_MODES = ["stopped", "bytecode", "native"];
const DIRECTIONS = [
  "none",
  "south",
  "north",
  "west",
  "east",
  "southwest",
  "southeast",
  "northwest",
  "northeast",
];
const DIRECTION_DELTAS = Object.freeze({
  north: Object.freeze({ x: 0, y: -1 }),
  south: Object.freeze({ x: 0, y: 1 }),
  west: Object.freeze({ x: -1, y: 0 }),
  east: Object.freeze({ x: 1, y: 0 }),
});
const CYCLING_ROAD_SLOPE_BEHAVIORS = new Set([
  "MB_CYCLING_ROAD_PULL_DOWN",
  "MB_CYCLING_ROAD_PULL_DOWN_GRASS",
]);
const BICYCLE_AVATAR_FLAGS = (1 << 1) | (1 << 2);
const PARTY_POKEMON_BYTES = 100;
const BOX_POKEMON_BYTES = 80;
const POKEMON_BOX_COUNT = 14;
const POKEMON_PER_BOX = 30;
const POKEMON_STORAGE_BOX_OFFSET = 4;
const POKEMON_STORAGE_BOX_BYTES =
  POKEMON_STORAGE_BOX_OFFSET +
  POKEMON_BOX_COUNT * POKEMON_PER_BOX * BOX_POKEMON_BYTES;
// Pinned FireRed struct ChooseBoxMenu.curBox (pokemon_storage_system_internal.h).
const CHOOSE_BOX_MENU_CURRENT_BOX_OFFSET = 0x244;
const BATTLE_POKEMON_BYTES = 88;
// Exact FireRed struct Pokedex layout (include/global.h): both flag arrays are
// 52 bytes and are indexed by National Dex number minus one.
const POKEDEX_FLAGS_BYTES = 52;
const POKEDEX_OWNED_OFFSET = 0x10;
const POKEDEX_SEEN_OFFSET = 0x44;
const OBJECT_EVENTS_COUNT = 16;
const OBJECT_EVENT_TEMPLATES_COUNT = 64;
const OBJECT_EVENT_TEMPLATE_BYTES = 24;
const MAP_COORDINATE_OFFSET = 7;
const BAG_POCKETS = Object.freeze([
  ["items", "bagPocket_Items", 42],
  ["keyItems", "bagPocket_KeyItems", 30],
  ["pokeBalls", "bagPocket_PokeBalls", 13],
  ["tmhm", "bagPocket_TMHM", 58],
  ["berries", "bagPocket_Berries", 43],
]);
const BAG_MENU_POCKETS = Object.freeze([
  { name: "items", trainerKey: "items" },
  { name: "key-items", trainerKey: "keyItems" },
  { name: "poke-balls", trainerKey: "pokeBalls" },
]);
const BAG_CONTEXT_ACTIONS = Object.freeze([
  ["use", "give", "toss", "cancel"],
  ["use", "register", "cancel"],
  ["use", "give", "cancel"],
]);
const TM_CASE_CONTEXT_ACTIONS = Object.freeze(["use", "give", "exit"]);
const ITEM_TM_CASE = 364;
const ITEM_BERRY_POUCH = 365;
// Exact 32-bit FireRed struct Item layout from include/item.h.
const ITEM_STRUCT_BYTES = 44;
const ITEM_PRICE_OFFSET = 16;
const SUMMARY_SELECT_MOVE_STATE_OFFSET = 0x3288;
const PARTY_ACTION_USE_ITEM = 3;
const PARTY_ACTION_GIVE_ITEM = 5;
const PARTY_ACTION_GIVE_PC_ITEM = 6;
const PARTY_ACTION_SWITCH = 8;
const PARTY_ACTION_SEND_OUT = 1;
const PARTY_ACTION_REUSABLE_ITEM = 14;
// Exact FireRed Rev 1 layouts from src/naming_screen.c and include/sprite.h.
// The naming screen is heap-backed; sNamingScreen stores the live pointer.
const NAMING_SCREEN_DATA_BYTES = 0x1e40;
const NAMING_TEXT_OFFSET = 0x1800;
const NAMING_TEXT_BYTES = 0x10;
const NAMING_STATE_OFFSET = 0x1e10;
const NAMING_PAGE_OFFSET = 0x1e22;
const NAMING_CURSOR_SPRITE_OFFSET = 0x1e23;
const NAMING_TEMPLATE_OFFSET = 0x1e2c;
const NAMING_INPUT_STATE = 2;
const SPRITE_BYTES = 68;
const SPRITE_DATA_OFFSET = 0x2e;

function sha256(parts) {
  const hash = createHash("sha256");
  for (const part of parts) hash.update(part);
  return hash.digest("hex");
}

function u32(bytes, offset = 0) {
  return new DataView(
    bytes.buffer,
    bytes.byteOffset,
    bytes.byteLength,
  ).getUint32(offset, true);
}

function u16(bytes, offset = 0) {
  return new DataView(
    bytes.buffer,
    bytes.byteOffset,
    bytes.byteLength,
  ).getUint16(offset, true);
}

function i16(bytes, offset) {
  return new DataView(
    bytes.buffer,
    bytes.byteOffset,
    bytes.byteLength,
  ).getInt16(offset, true);
}

function i32(bytes, offset = 0) {
  return new DataView(
    bytes.buffer,
    bytes.byteOffset,
    bytes.byteLength,
  ).getInt32(offset, true);
}

function decodeLiveMapGrid(virtualMapBytes, mapBytes, map, tileAttributes, behaviorNames) {
  const width = Number(map?.layout?.width);
  const height = Number(map?.layout?.height);
  if (
    !virtualMapBytes || virtualMapBytes.length < 12 || !mapBytes ||
    !Number.isSafeInteger(width) || width <= 0 ||
    !Number.isSafeInteger(height) || height <= 0
  ) return null;
  const virtualWidth = i32(virtualMapBytes, 0);
  const virtualHeight = i32(virtualMapBytes, 4);
  if (
    virtualWidth < width + 15 || virtualHeight < height + 14 ||
    mapBytes.length < virtualWidth * virtualHeight * 2
  ) return null;
  const sourceCells = new Map(
    (map.layout?.cells ?? []).map((cell) => [`${cell.x},${cell.y}`, cell]),
  );
  const cells = [];
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const raw = u16(mapBytes, ((y + 7) * virtualWidth + x + 7) * 2);
      const source = sourceCells.get(`${x},${y}`) ?? {};
      const id = raw & 0x03ff;
      const tileset = id < 640 ? map.layout.primaryTileset : map.layout.secondaryTileset;
      const attributes = tileAttributes?.get(tileset)?.[id < 640 ? id : id - 640];
      cells.push({
        x,
        y,
        metatileId: raw & 0x03ff,
        collision: (raw >>> 10) & 0x03,
        elevation: (raw >>> 12) & 0x0f,
        behaviorName: attributes === undefined ? source.behaviorName ?? null
          : behaviorNames.get(attributes & 0x1ff) ?? null,
      });
    }
  }
  return { width, height, cells };
}

function decodeLiveObjectEvents(bytes, playerObjectEventId) {
  const objectEventSize = bytes?.length / OBJECT_EVENTS_COUNT;
  if (!Number.isSafeInteger(objectEventSize) || objectEventSize < 36) return [];
  const events = [];
  for (let id = 0; id < OBJECT_EVENTS_COUNT; id += 1) {
    const offset = id * objectEventSize;
    if (!(bytes[offset] & 1)) continue;
    const directionByte = bytes[offset + 24];
    events.push({
      id,
      player: id === playerObjectEventId || Boolean(bytes[offset + 2] & 1),
      localId: bytes[offset + 8],
      map: { group: bytes[offset + 10], number: bytes[offset + 9] },
      elevation: bytes[offset + 11] & 0x0f,
      current: {
        x: i16(bytes, offset + 16) - MAP_COORDINATE_OFFSET,
        y: i16(bytes, offset + 18) - MAP_COORDINATE_OFFSET,
      },
      previous: {
        x: i16(bytes, offset + 20) - MAP_COORDINATE_OFFSET,
        y: i16(bytes, offset + 22) - MAP_COORDINATE_OFFSET,
      },
      facing: DIRECTIONS[directionByte & 0x0f] ??
        `unknown-${directionByte & 0x0f}`,
      movementDirection: DIRECTIONS[directionByte >>> 4] ??
        `unknown-${directionByte >>> 4}`,
    });
  }
  return events;
}

function decodeCurrentMapObjectEventTemplates(bytes, field, sourceObjectCount) {
  const offset = Number(field?.offset);
  const count = Math.min(
    Number(sourceObjectCount),
    OBJECT_EVENT_TEMPLATES_COUNT,
  );
  if (
    !bytes ||
    !Number.isSafeInteger(offset) ||
    offset < 0 ||
    !Number.isSafeInteger(count) ||
    count < 1
  ) return [];
  const templates = [];
  for (let index = 0; index < count; index += 1) {
    const base = offset + index * OBJECT_EVENT_TEMPLATE_BYTES;
    if (base + OBJECT_EVENT_TEMPLATE_BYTES > bytes.length) break;
    const localId = bytes[base];
    if (localId === 0) continue;
    templates.push({
      localId,
      current: {
        x: i16(bytes, base + 4),
        y: i16(bytes, base + 6),
      },
    });
  }
  return templates;
}

function decodeBoxPokemonPayload(bytes, offset) {
  const decoded = decodeBoxPokemonRecord(bytes, offset);
  return decoded.validity === "valid" ? decoded : null;
}

function decodePartyPokemon(bytes, offset, slot) {
  if (offset < 0 || offset + PARTY_POKEMON_BYTES > bytes.length) return null;
  const pokemon = decodeBoxPokemonPayload(bytes, offset);
  if (!pokemon) return null;
  const stats = {
    attack: u16(bytes, offset + 90),
    defense: u16(bytes, offset + 92),
    speed: u16(bytes, offset + 94),
    spAttack: u16(bytes, offset + 96),
    spDefense: u16(bytes, offset + 98),
  };
  return {
    slot,
    ...pokemon,
    level: bytes[offset + 84],
    hp: u16(bytes, offset + 86),
    maxHp: u16(bytes, offset + 88),
    status1: u32(bytes, offset + 80),
    ...(Object.values(stats).every((value) => value > 0) ? { stats } : {}),
  };
}

function decodePlayTime(bytes, fields) {
  const hoursOffset = Number(fields?.playTimeHours?.offset);
  const minutesOffset = Number(fields?.playTimeMinutes?.offset);
  const secondsOffset = Number(fields?.playTimeSeconds?.offset);
  const vblanksOffset = Number(fields?.playTimeVBlanks?.offset);
  if (
    !bytes ||
    !Number.isSafeInteger(hoursOffset) || hoursOffset < 0 ||
    !Number.isSafeInteger(minutesOffset) || minutesOffset < 0 ||
    !Number.isSafeInteger(secondsOffset) || secondsOffset < 0 ||
    !Number.isSafeInteger(vblanksOffset) || vblanksOffset < 0 ||
    hoursOffset + 2 > bytes.length ||
    minutesOffset >= bytes.length ||
    secondsOffset >= bytes.length ||
    vblanksOffset >= bytes.length
  ) return null;
  const playTime = {
    hours: u16(bytes, hoursOffset),
    minutes: bytes[minutesOffset],
    seconds: bytes[secondsOffset],
    vblanks: bytes[vblanksOffset],
  };
  return playTime.minutes <= 59 && playTime.seconds <= 59 &&
      playTime.vblanks <= 59
    ? playTime
    : null;
}

function decodePokemonStorage(bytes) {
  if (!bytes || bytes.length < POKEMON_STORAGE_BOX_BYTES) return null;
  const pokemon = [];
  const boxCounts = Array(POKEMON_BOX_COUNT).fill(0);
  let unknownSlots = 0;
  for (let box = 0; box < POKEMON_BOX_COUNT; box += 1) {
    for (let slot = 0; slot < POKEMON_PER_BOX; slot += 1) {
      const offset = POKEMON_STORAGE_BOX_OFFSET +
        (box * POKEMON_PER_BOX + slot) * BOX_POKEMON_BYTES;
      const decoded = decodeBoxPokemonRecord(bytes, offset);
      if (decoded.validity === "unknown") unknownSlots++;
      if (decoded.validity !== "valid") continue;
      boxCounts[box] += 1;
      pokemon.push({ box, slot, ...decoded });
    }
  }
  return { currentBox: bytes[0], boxCounts, pokemon, unknownSlots,
    validity: unknownSlots === 0 ? "valid" : "unknown" };
}

function decodeBattlePokemon(bytes, offset, battler) {
  if (offset < 0 || offset + BATTLE_POKEMON_BYTES > bytes.length) return null;
  const species = u16(bytes, offset);
  if (species === 0) return null;
  return {
    battler,
    species,
    level: bytes[offset + 42],
    friendship: bytes[offset + 43],
    ivs: Object.fromEntries(['hp','attack','defense','speed','spAttack','spDefense']
      .map((name,index)=>[name,(u32(bytes,offset+20) >>> (index*5)) & 31])),
    hp: u16(bytes, offset + 40),
    maxHp: u16(bytes, offset + 44),
    moves: [0, 1, 2, 3].map((slot) => u16(bytes, offset + 12 + slot * 2)),
    pp: Array.from(bytes.slice(offset + 36, offset + 40)),
    ability: bytes[offset + 32],
    types: [bytes[offset + 33], bytes[offset + 34]],
    stats: {
      attack: u16(bytes, offset + 2),
      defense: u16(bytes, offset + 4),
      speed: u16(bytes, offset + 6),
      spAttack: u16(bytes, offset + 8),
      spDefense: u16(bytes, offset + 10),
    },
    statStages: Object.fromEntries(
      [
        "hp",
        "attack",
        "defense",
        "speed",
        "spAttack",
        "spDefense",
        "accuracy",
        "evasion",
      ].map((name, index) => [name, bytes[offset + 24 + index]]),
    ),
    item: u16(bytes, offset + 46),
    status1: u32(bytes, offset + 76),
    status2: u32(bytes, offset + 80),
  };
}

function decodeBattleMoveState({
  disableStructs,
  lastMoves,
  battleStruct,
  battler,
}) {
  const offset = battler * 28;
  if (!disableStructs || offset + 28 > disableStructs.length) return null;
  return {
    protectUses: disableStructs[offset + 0x08],
    stockpileCount: disableStructs[offset + 0x09],
    substituteHp: disableStructs[offset + 0x0a],
    furyCutterCount: disableStructs[offset + 0x10],
    disabledMove: u16(disableStructs, offset + 0x04),
    disableTurns: disableStructs[offset + 0x0b] & 0x0f,
    encoredMove: u16(disableStructs, offset + 0x06),
    encoredMoveSlot: disableStructs[offset + 0x0c],
    encoreTurns: disableStructs[offset + 0x0e] & 0x0f,
    perishSongTurns: disableStructs[offset + 0x0f] & 0x0f,
    rolloutTurns: disableStructs[offset + 0x11] & 0x0f,
    chargeTurns: disableStructs[offset + 0x12] & 0x0f,
    tauntTurns: disableStructs[offset + 0x13] & 0x0f,
    battlerPreventingEscape: disableStructs[offset + 0x14],
    isFirstTurn: Boolean(disableStructs[offset + 0x16]),
    rechargeTurns: disableStructs[offset + 0x19],
    lastMove: lastMoves?.length >= (battler + 1) * 2
      ? u16(lastMoves, battler * 2)
      : null,
    choiceLockedMove: battleStruct?.length >= 0xc8 + (battler + 1) * 2
      ? u16(battleStruct, 0xc8 + battler * 2)
      : null,
  };
}

function decodeFireRedText(bytes) {
  if (!bytes) return null;
  let text = "";
  for (let index = 0; index < bytes.length; index += 1) {
    const value = bytes[index];
    if (value === 0xff) break;
    if (value === 0) text += " ";
    else if ([0xfa, 0xfb, 0xfe].includes(value)) text += "\n";
    else if (value === 0xfd) index += 1;
    else if (value >= 0xbb && value <= 0xd4) {
      text += String.fromCharCode(65 + value - 0xbb);
    } else if (value >= 0xd5 && value <= 0xee) {
      text += String.fromCharCode(97 + value - 0xd5);
    } else {
      text += ({
        0xab: "!",
        0xac: "?",
        0xad: ".",
        0xae: "-",
        0xb4: "'",
        0xb8: ",",
      })[value] ?? "";
    }
  }
  const normalized = text.replaceAll(/\s+/g, " ").trim();
  return normalized || null;
}

function decodeStructureText(bytes, field, length = 8) {
  const offset = field?.offset;
  if (
    !bytes || !Number.isSafeInteger(offset) || offset < 0 ||
    offset + length > bytes.length
  ) return null;
  return decodeFireRedText(bytes.slice(offset, offset + length));
}

function announcedOpponentName(messageText) {
  const match = messageText?.match(
    /about\s+to\s+use\s+([A-Z][A-Z0-9' -]*?)(?:[.!?]|$)/i,
  );
  return match?.[1]?.trim().toUpperCase() || null;
}

function decodeBag(save1, save1Fields, encryptionKey) {
  return Object.fromEntries(
    BAG_POCKETS.map(([name, field, capacity]) => {
      const offset = save1Fields[field]?.offset;
      const entries = [];
      if (!Number.isSafeInteger(offset)) return [name, entries];
      for (let slot = 0; slot < capacity; slot += 1) {
        const itemOffset = offset + slot * 4;
        if (itemOffset + 4 > save1.length) break;
        const itemId = u16(save1, itemOffset);
        if (itemId === 0) continue;
        entries.push({
          itemId,
          quantity: u16(save1, itemOffset + 2) ^ (encryptionKey & 0xffff),
        });
      }
      return [name, entries];
    }),
  );
}

function decodeVsSeeker(save1, save1Fields) {
  const counterOffset = save1Fields.trainerRematchStepCounter?.offset;
  const rematchesOffset = save1Fields.trainerRematches?.offset;
  if (
    !Number.isSafeInteger(counterOffset) || counterOffset < 0 ||
    counterOffset + 2 > save1.length ||
    !Number.isSafeInteger(rematchesOffset) || rematchesOffset < 0 ||
    rematchesOffset + VS_SEEKER_REMATCH_ENTRY_COUNT > save1.length
  ) return null;
  const counter = u16(save1, counterOffset);
  return {
    batterySteps: counter & 0xff,
    responseClearSteps: (counter >>> 8) & 0xff,
    rematchEntries: Array.from(
      save1.slice(
        rematchesOffset,
        rematchesOffset + VS_SEEKER_REMATCH_ENTRY_COUNT,
      ),
    ),
  };
}

function decodePokedex(save2, field) {
  const pokedexOffset = field?.offset;
  if (
    !save2 || !Number.isSafeInteger(pokedexOffset) || pokedexOffset < 0 ||
    pokedexOffset + POKEDEX_SEEN_OFFSET + POKEDEX_FLAGS_BYTES > save2.length
  ) return null;
  const decodeFlags = (relativeOffset) => {
    const species = [];
    for (let bit = 0; bit < POKEDEX_FLAGS_BYTES * 8; bit += 1) {
      if (save2[pokedexOffset + relativeOffset + (bit >> 3)] & (1 << (bit & 7))) {
        species.push(bit + 1);
      }
    }
    return species;
  };
  const ownedSpecies = decodeFlags(POKEDEX_OWNED_OFFSET);
  const seenSpecies = decodeFlags(POKEDEX_SEEN_OFFSET);
  return {
    ownedSpecies,
    seenSpecies,
    ownedCount: ownedSpecies.length,
    seenCount: seenSpecies.length,
  };
}

function isEwramPointer(pointer, bytes) {
  return (
    Number.isSafeInteger(pointer) &&
    pointer >= EWRAM_START &&
    pointer + bytes <= EWRAM_END
  );
}

function isRomPointer(pointer) {
  const address = pointer & ~1;
  return address >= ROM_START && address < ROM_END;
}

function isReadableDataPointer(pointer, bytes) {
  if (!Number.isSafeInteger(bytes) || bytes <= 0) return false;
  const address = pointer & ~1;
  return isEwramPointer(address, bytes) ||
    (isRomPointer(address) && address + bytes <= ROM_END);
}

function deepFreeze(value) {
  if (!value || typeof value !== "object" || Object.isFrozen(value)) return value;
  for (const child of Object.values(value)) deepFreeze(child);
  return Object.freeze(value);
}

function unwrapData(document) {
  return document?.data ?? document;
}

function symbolResolver(symbols) {
  const byAddress = new Map();
  for (const [name, symbol] of Object.entries(symbols)) {
    if (symbol?.region === "ROM" || symbol?.address >= ROM_START) {
      byAddress.set(symbol.address, symbol.sourceName ?? name);
    }
  }
  return (pointer) => {
    if (!pointer) return null;
    const address = pointer & ~1;
    return byAddress.get(address) ?? `0x${address.toString(16).padStart(8, "0")}`;
  };
}

function mapResolver(world) {
  const byCoordinates = new Map();
  for (const map of unwrapData(world)?.maps ?? []) {
    byCoordinates.set(`${map.group}:${map.number}`, map.id);
  }
  return (group, number) => byCoordinates.get(`${group}:${number}`) ?? null;
}

function storyStateDecoder(world, story, storyWatch = {}) {
  const maps = new Map(
    (unwrapData(world)?.maps ?? []).map((map) => [map.id, map]),
  );
  const symbols = unwrapData(story)?.symbols ?? {};
  const variables = symbols.variables ?? {};
  const flags = symbols.flags ?? {};
  const watchedVariables = [...new Set(storyWatch.variables ?? [])]
    .map(Number)
    .filter((id) => Number.isSafeInteger(id) && id >= 0x4000 && id < 0x4100);
  const watchedFlags = [...new Set(storyWatch.flags ?? [])]
    .map(Number)
    .filter((id) => Number.isSafeInteger(id) && id >= 0);
  return (mapId, save1, save1Fields) => {
    const map = maps.get(mapId);
    const varsOffset = save1Fields.vars?.offset;
    const flagsOffset = save1Fields.flags?.offset;
    const result = { variables: {}, flags: {} };
    for (const name of new Set((map?.coordEvents ?? []).map(({ var: variable }) => variable))) {
      const id = Number(variables[name]?.value);
      const index = id - 0x4000;
      const offset = Number(varsOffset) + index * 2;
      if (
        Number.isSafeInteger(index) && index >= 0 && index < 256 &&
        Number.isSafeInteger(varsOffset) && offset + 2 <= save1.length
      ) {
        result.variables[name] = u16(save1, offset);
      }
    }
    const currentMapFlagNames = new Set([
      ...(map?.objectEvents ?? []).map(({ flag }) => flag),
      ...(map?.backgroundEvents ?? []).map(({ flag }) => flag),
    ]);
    for (const name of currentMapFlagNames) {
      const id = Number(flags[name]?.value);
      const offset = Number(flagsOffset) + Math.floor(id / 8);
      if (
        Number.isSafeInteger(id) && id >= 0 &&
        Number.isSafeInteger(flagsOffset) && offset < save1.length
      ) {
        result.flags[name] = Boolean(save1[offset] & (1 << (id % 8)));
      }
    }
    if (watchedVariables.length > 0) {
      result.variableIds = {};
      for (const id of watchedVariables) {
        const index = id - 0x4000;
        const offset = Number(varsOffset) + index * 2;
        if (
          Number.isSafeInteger(varsOffset) &&
          offset >= 0 && offset + 2 <= save1.length
        ) {
          result.variableIds[id] = u16(save1, offset);
        }
      }
    }
    if (watchedFlags.length > 0) {
      result.flagIds = {};
      for (const id of watchedFlags) {
        const offset = Number(flagsOffset) + Math.floor(id / 8);
        if (
          Number.isSafeInteger(flagsOffset) &&
          offset >= 0 && offset < save1.length
        ) {
          result.flagIds[id] = Boolean(save1[offset] & (1 << (id % 8)));
        }
      }
    }
    return result;
  };
}

function modeFor({ callback2, inBattle, activeTasks }) {
  if (/Evolution/.test(callback2 ?? "")) return "evolution";
  if (inBattle || /Battle/.test(callback2 ?? "")) return "battle";
  if (/InGameTrade/.test(callback2 ?? "")) return "in-game-trade";
  if (/(HallOfFame|Hof|Credits)/.test(callback2 ?? "")) return "hall-of-fame";
  const taskNames = activeTasks.map((task) => task.function).join(" ");
  if (/Task_FlyMap/.test(taskNames)) return "fly-map";
  if (/StartMenu/.test(taskNames)) return "start-menu";
  if (/(Shop|Mart|BuyMenu|SellMenu)/.test(taskNames)) return "mart";
  // Held-item switch and Mail prompts run inside the party menu even when the
  // item came from the Bag (Task_*SwitchItemsFromBag*).
  if (/(SwitchItems|SendMailToPC|LoseMailMessage)/.test(taskNames)) return "party";
  if (/(Party|PokemonSummary|HandleChooseMon|ReplaceMove)/.test(taskNames)) {
    return "party";
  }
  if (
    /(Bag|BerryPouch|TMCase|Task_HandleListInput|Task_ContextMenu_HandleInput|Task_SelectedTMHM_Field)/.test(
      taskNames,
    )
  ) {
    return "bag";
  }
  if (/(PCMainMenu|PokeStorage|Deposit|Withdraw|PokemonStorage)/.test(taskNames)) {
    return "storage";
  }
  if (/Bag|BerryPouch|TMCase/.test(callback2 ?? "")) return "bag";
  if (/Party|Summary/.test(callback2 ?? "")) return "party";
  if (/PokeStorage|Deposit|Withdraw/.test(callback2 ?? "")) return "storage";
  if (/(Title|MainMenu|Copyright|Intro|NewGame|Naming)/.test(callback2 ?? "")) {
    return "boot";
  }
  if (/Overworld|Field|LoadMap|ChangeMap/.test(callback2 ?? "")) {
    return "overworld";
  }
  return callback2 ? "modal" : "unknown";
}

function digestBlocks(blocks) {
  const parts = [];
  const hashes = {};
  for (const [name, bytes] of [...blocks.entries()].sort(([left], [right]) =>
    left.localeCompare(right),
  )) {
    const blockHash = sha256([bytes]);
    hashes[name] = { bytes: bytes.length, sha256: blockHash };
    parts.push(Buffer.from(`${name}\0${bytes.length}\0${blockHash}\n`));
  }
  return { blocks: hashes, sha256: sha256(parts) };
}

export class AtomicCaptureError extends Error {
  constructor(startFrame, endFrame) {
    super(
      `atomic observation crossed a frame boundary (${startFrame} -> ${endFrame})`,
    );
    this.name = "AtomicCaptureError";
    this.code = "ATOMIC_CAPTURE_RACE";
    this.startFrame = startFrame;
    this.endFrame = endFrame;
  }
}

class FireRedObserver {
  #session;
  #symbols;
  #structures;
  #resolveSymbol;
  #resolveMap;
  #maps;
  #decodeStoryState;
  #watchedSpecialVariables;
  #tileAttributes = new Map();
  #behaviorNames;
  #runId;
  #sizedSymbolCache = new Map();
  #ordinal = 0;
  #previousSignature = null;
  #observeRng;
  #partyDisplay;

  constructor({ session, runtime, world, story, storyWatch, runId, observeRng = false }) {
    const data = unwrapData(runtime);
    if (!data?.symbols || !data?.structures) {
      throw new TypeError("FireRed runtime symbols and structures are required");
    }
    if (typeof runId !== "string" || runId === "") {
      throw new TypeError("observation runId is required");
    }
    this.#session = session;
    this.#observeRng = observeRng;
    this.#symbols = data.symbols;
    this.#partyDisplay = createPartyDisplayReader({symbols:data.symbols,readMemory:(a,n)=>session.readMemory(a,n)});
    this.#structures = data.structures;
    this.#resolveSymbol = symbolResolver(data.symbols);
    this.#resolveMap = mapResolver(world);
    this.#maps = new Map(
      (unwrapData(world)?.maps ?? []).map((map) => [map.id, map]),
    );
    this.#behaviorNames = new Map(Object.entries(unwrapData(world)?.metatileBehaviors ?? {})
      .map(([name,definition]) => [definition.value,name]));
    // Attribute tables are immutable, hash-bound ROM data. Cache each tileset
    // once so changed doors, ice and conveyor tiles use their current behavior.
    for (const tileset of new Set([...this.#maps.values()].flatMap(map =>
      [map.layout?.primaryTileset,map.layout?.secondaryTileset]).filter(Boolean))) {
      const symbol = this.#symbols[tileset.replace(/^gTileset_/, 'gMetatileAttributes_')];
      if (!symbol || symbol.address < 0x08000000 || symbol.address + symbol.size > 0x0a000000 ||
          symbol.size <= 0 || symbol.size > 4096 || symbol.size % 4) continue;
      const bytes = session.readMemory(symbol.address,symbol.size);
      this.#tileAttributes.set(tileset,Array.from({length:bytes.length/4},(_,i)=>u32(bytes,i*4)));
    }
    this.#decodeStoryState = storyStateDecoder(world, story, storyWatch);
    this.#watchedSpecialVariables = [...new Set(storyWatch?.variables ?? [])]
      .filter(id => Number.isInteger(id) && id >= 0x8000 && id <= 0x800b);
    this.#runId = runId;
  }

  resetHistory() {
    this.#previousSignature = null;
  }

  captureControllerState() {
    const startFrame = this.#session.frame;
    const save1Symbol = this.#symbols.gSaveBlock1Ptr;
    const mainSymbol = this.#symbols.gMain;
    const avatarSymbol = this.#symbols.gPlayerAvatar;
    if (!save1Symbol || !mainSymbol || !avatarSymbol) {
      throw new Error("runtime symbols for controller state are incomplete");
    }

    const save1Pointer = u32(
      this.#session.readMemory(save1Symbol.address, save1Symbol.size),
    );
    const main = this.#session.readMemory(mainSymbol.address, mainSymbol.size);
    const avatar = this.#session.readMemory(avatarSymbol.address, avatarSymbol.size);
    const save1Size = Number(this.#structures.SaveBlock1?.size ?? 0);
    const save1 = isEwramPointer(save1Pointer, save1Size)
      ? this.#session.readMemory(save1Pointer, save1Size)
      : null;
    const save1Fields = this.#structures.SaveBlock1?.fields ?? {};
    const avatarFields = this.#structures.PlayerAvatar?.fields ?? {};
    const positionOffset = save1Fields.pos?.offset ?? 0;
    const locationOffset = save1Fields.location?.offset ?? 4;
    const callback2Address = u32(main, 4);
    const callback2 = this.#resolveSymbol(callback2Address);
    const inBattle = Boolean(main[0x439] & 0b10);
    const endFrame = this.#session.frame;
    if (startFrame !== endFrame) {
      throw new AtomicCaptureError(startFrame, endFrame);
    }

    const group = save1?.[locationOffset] ?? null;
    const number = save1?.[locationOffset + 1] ?? null;
    return deepFreeze({
      frame: startFrame,
      mode: callback2 === "CB2_Overworld" && !inBattle ? "overworld" : "other",
      callback2,
      inBattle,
      map: Number.isSafeInteger(group) && Number.isSafeInteger(number)
        ? this.#resolveMap(group, number)
        : null,
      x: save1 ? i16(save1, positionOffset) : null,
      y: save1 ? i16(save1, positionOffset + 2) : null,
      tileTransitionState:
        avatar[avatarFields.tileTransitionState?.offset ?? 3] ?? null,
    });
  }

  // Small, atomic timing sample for the isolated frame experiment. Addresses
  // remain in this version-specific adapter and its pinned symbol artifact.
  captureTimingState() {
    const state = this.captureControllerState();
    const main = this.#observeRng ? this.#symbols.gRngValue : null;
    const wild = this.#observeRng ? this.#symbols.sWildEncounterData : null;
    const rng = main?.size === 4 && wild?.size === 12
      ? { validity: "valid", mainState: u32(this.#session.readMemory(main.address, 4)),
          wildState: u32(this.#session.readMemory(wild.address, 12)) }
      : { validity: "unknown", reason: "rng-observation-disabled-or-unsupported" };
    if (this.#session.frame !== state.frame) throw new AtomicCaptureError(state.frame, this.#session.frame);
    return deepFreeze({ ...state, rng });
  }

  #readSymbol(name, blocks, required = false, blockName = name) {
    const symbol = this.#symbols[name];
    if (!symbol) {
      if (required) throw new Error(`runtime symbol is missing: ${name}`);
      return null;
    }
    const bytes = this.#session.readMemory(symbol.address, symbol.size);
    blocks.set(blockName, bytes);
    return bytes;
  }

  #readSymbolOfSize(name, expectedSize, blocks, blockName = name) {
    const cacheKey = `${name}:${expectedSize}`;
    let matches = this.#sizedSymbolCache.get(cacheKey);
    if (!matches) {
      matches = Object.entries(this.#symbols).filter(
        ([key, symbol]) =>
          (key === name || symbol?.sourceName === name) &&
          symbol?.size === expectedSize,
      );
      this.#sizedSymbolCache.set(cacheKey, matches);
    }
    if (matches.length === 0) return null;
    if (matches.length > 1) {
      throw new Error(
        `runtime symbol is ambiguous for ${name} (${expectedSize} bytes)`,
      );
    }
    const [, symbol] = matches[0];
    const bytes = this.#session.readMemory(symbol.address, symbol.size);
    blocks.set(blockName, bytes);
    return bytes;
  }

  #isPokemonNicknamePrompt(blocks) {
    // Compare the current expanded field message against the pinned ROM's
    // canonical questions. Do not infer Yes/No purpose from map or team state:
    // gifts can go straight to storage and need not be planned acquisitions.
    const terminated = (bytes) => {
      const end = bytes?.indexOf(0xff) ?? -1;
      return end < 0 ? null : bytes.slice(0, end);
    };
    const message = terminated(this.#readSymbol("gStringVar4", blocks));
    if (!message?.length) return false;
    for (const name of ["Text_GiveNicknameToThisMon", "Text_GiveNicknameToReceivedMon"]) {
      const symbol = this.#symbols[name];
      // Assembly text labels have size zero in the symbol artifact. These
      // short, EOS-terminated ROM templates need an explicitly bounded read.
      if (!symbol || symbol.address < 0x08000000 || symbol.address + 128 > 0x0a000000) continue;
      const bytes = this.#session.readMemory(symbol.address, 128);
      blocks.set(name, bytes);
      const template = terminated(bytes);
      if (!template) continue;
      const expanded = [];
      let valid = true;
      for (let index = 0; index < template.length; index++) {
        if (template[index] !== 0xfd) { expanded.push(template[index]); continue; }
        const variableName = { 2: "gStringVar1", 3: "gStringVar2", 4: "gStringVar3" }[template[++index]];
        const value = variableName ? terminated(this.#readSymbol(variableName, blocks)) : null;
        if (!value?.length) { valid = false; break; }
        expanded.push(...value);
      }
      if (valid && expanded.length === message.length &&
          expanded.every((byte, index) => byte === message[index])) return true;
    }
    return false;
  }

  capture() {
    const startFrame = this.#session.frame;
    const blocks = new Map();
    const reasons = [];
    const questLogBytes = this.#readSymbol("gQuestLogState", blocks);
    const questLog = questLogBytes?.length === 1
      ? { state: questLogBytes[0], playback: [2, 3].includes(questLogBytes[0]) } : null;
    if (questLog?.playback) reasons.push("quest-log-playback");
    const rngBytes = this.#observeRng ? this.#readSymbol("gRngValue", blocks) : null;
    const wildRngBytes = this.#observeRng ? this.#readSymbol("sWildEncounterData", blocks) : null;

    const save1PointerBytes = this.#readSymbol("gSaveBlock1Ptr", blocks, true);
    const save2PointerBytes = this.#readSymbol("gSaveBlock2Ptr", blocks);
    const saveFileStatusBytes = this.#readSymbol("gSaveFileStatus", blocks);
    const saveAttemptStatusBytes = this.#readSymbol(
      "gSaveAttemptStatus",
      blocks,
    );
    const avatar = this.#readSymbol("gPlayerAvatar", blocks, true);
    const virtualMapBytes = this.#readSymbol("VMap", blocks);
    let liveMapBytes = null;
    if (virtualMapBytes?.length >= 12) {
      const virtualWidth = i32(virtualMapBytes, 0);
      const virtualHeight = i32(virtualMapBytes, 4);
      const virtualMapPointer = u32(virtualMapBytes, 8);
      const virtualMapSize = virtualWidth * virtualHeight * 2;
      if (
        virtualWidth > 0 && virtualHeight > 0 &&
        virtualMapSize > 0 && virtualMapSize <= 0x5000 &&
        isEwramPointer(virtualMapPointer, virtualMapSize)
      ) {
        liveMapBytes = this.#session.readMemory(
          virtualMapPointer,
          virtualMapSize,
        );
        blocks.set("VMap.map", liveMapBytes);
      }
    }
    const objectEvents = this.#readSymbol("gObjectEvents", blocks);
    const main = this.#readSymbol("gMain", blocks, true);
    const tasks = this.#readSymbol("gTasks", blocks);
    const startMenuCursorBytes = this.#readSymbol(
      "sStartMenuCursorPos",
      blocks,
    );
    const startMenuCountBytes = this.#readSymbol(
      "sNumStartMenuItems",
      blocks,
    );
    const startMenuOrderBytes = this.#readSymbol("sStartMenuOrder", blocks);
    const startMenuCallbackBytes = this.#readSymbol(
      "sStartMenuCallback",
      blocks,
    );
    const saveDialogCallbackBytes = this.#readSymbol("sSaveDialogCB", blocks);
    const saveDialogDelayBytes = this.#readSymbol("sSaveDialogDelay", blocks);
    const saveDialogPrintingBytes = this.#readSymbol(
      "sSaveDialogIsPrinting",
      blocks,
    );
    const menuBytes = this.#readSymbolOfSize("sMenu", 12, blocks);
    const namingScreenPointerBytes = this.#readSymbol(
      "sNamingScreen",
      blocks,
    );
    const namingScreenPointer = namingScreenPointerBytes
      ? u32(namingScreenPointerBytes)
      : 0;
    let namingScreenBytes = null;
    let namingSpritesBytes = null;
    if (isEwramPointer(namingScreenPointer, NAMING_SCREEN_DATA_BYTES)) {
      namingScreenBytes = this.#session.readMemory(
        namingScreenPointer,
        NAMING_SCREEN_DATA_BYTES,
      );
      blocks.set("NamingScreenData", namingScreenBytes);
      namingSpritesBytes = this.#readSymbol("gSprites", blocks);
    }
    const pokedexScreenPointerBytes = this.#readSymbol(
      "sPokedexScreenData",
      blocks,
    );
    const pokedexScreenPointer = pokedexScreenPointerBytes
      ? u32(pokedexScreenPointerBytes)
      : 0;
    let pokedexScreenHeader = null;
    if (isEwramPointer(pokedexScreenPointer, 2)) {
      pokedexScreenHeader = this.#session.readMemory(pokedexScreenPointer, 2);
      blocks.set("PokedexScreenData.header", pokedexScreenHeader);
    }
    const mapCursorPointerBytes = this.#readSymbol("sMapCursor", blocks);
    const mapCursorPointer = mapCursorPointerBytes
      ? u32(mapCursorPointerBytes)
      : 0;
    let mapCursorHeader = null;
    if (isEwramPointer(mapCursorPointer, 26)) {
      mapCursorHeader = this.#session.readMemory(mapCursorPointer, 26);
      blocks.set("MapCursor.header", mapCursorHeader);
    }
    const flyMapPointerBytes = this.#readSymbol("sFlyMap", blocks);
    const flyMapPointer = flyMapPointerBytes ? u32(flyMapPointerBytes) : 0;
    let flyMapHeader = null;
    if (isEwramPointer(flyMapPointer, 3)) {
      flyMapHeader = this.#session.readMemory(flyMapPointer, 3);
      blocks.set("FlyMap.header", flyMapHeader);
    }
    const tradeAnimPointerBytes = this.#readSymbol("sTradeAnim", blocks);
    const tradeAnimPointer = tradeAnimPointerBytes
      ? u32(tradeAnimPointerBytes)
      : 0;
    let tradeAnimHeader = null;
    if (isEwramPointer(tradeAnimPointer, IN_GAME_TRADE_STATE_BYTES)) {
      tradeAnimHeader = this.#session.readMemory(
        tradeAnimPointer,
        IN_GAME_TRADE_STATE_BYTES,
      );
      blocks.set("TradeAnim.header", tradeAnimHeader);
    }
    const shopDataBytes = this.#readSymbol("sShopData", blocks);
    let martStock = null;
    if (shopDataBytes?.length >= 0x18) {
      const itemListPointer = u32(shopDataBytes, 0x04);
      const itemCount = u16(shopDataBytes, 0x10);
      const itemListBytesLength = itemCount * 2;
      const itemTableSymbol = this.#symbols.gItems;
      if (
        itemCount > 0 && itemCount <= 100 &&
        isReadableDataPointer(itemListPointer, itemListBytesLength) &&
        itemTableSymbol?.size >= ITEM_STRUCT_BYTES
      ) {
        const itemListBytes = this.#session.readMemory(
          itemListPointer,
          itemListBytesLength,
        );
        const itemTableBytes = this.#session.readMemory(
          itemTableSymbol.address,
          itemTableSymbol.size,
        );
        blocks.set("sShopData.itemList", itemListBytes);
        blocks.set("gItems.martPrices", itemTableBytes);
        const itemCapacity = Math.floor(itemTableBytes.length / ITEM_STRUCT_BYTES);
        martStock = Array.from({ length: itemCount }, (_, index) => {
          const itemId = u16(itemListBytes, index * 2);
          const priceOffset = itemId * ITEM_STRUCT_BYTES + ITEM_PRICE_OFFSET;
          return {
            itemId,
            price: itemId < itemCapacity ? u16(itemTableBytes, priceOffset) : null,
          };
        });
      }
    }
    const messageBoxTypeBytes = this.#readSymbol("sMessageBoxType", blocks);
    const textPrintersBytes = this.#readSymbol("sTextPrinters", blocks);
    const globalScriptStatusBytes = this.#readSymbol(
      "sGlobalScriptContextStatus",
      blocks,
    );
    const globalScriptContextBytes = this.#readSymbol(
      "sGlobalScriptContext",
      blocks,
    );
    const fieldControlsLockedBytes = this.#readSymbol(
      "sLockFieldControls",
      blocks,
    );
    const bagMenuStateBytes = this.#readSymbol("gBagMenuState", blocks);
    const specialItemBytes = this.#readSymbol(
      "gSpecialVar_ItemId",
      blocks,
    );
    const tmCaseStaticBytes = this.#readSymbol(
      "sTMCaseStaticResources",
      blocks,
    );
    const berryPouchStaticBytes=this.#readSymbol('sStaticCnt',blocks);
    const berryOptionsPointerBytes=this.#readSymbol('sContextMenuOptions',blocks);
    const berryOptionsCountBytes=this.#readSymbol('sContextMenuNumOptions',blocks);
    const summaryMoveCursorBytes = this.#readSymbol(
      "sMoveSelectionCursorPos",
      blocks,
    );
    const summaryMoveSwapCursorBytes = this.#readSymbol(
      "sMoveSwapCursorPos",
      blocks,
    );
    const summaryLastViewedMonBytes = this.#readSymbol(
      "sLastViewedMonIndex",
      blocks,
    );
    const summaryScreenPointerBytes = this.#readSymbol(
      "sMonSummaryScreen",
      blocks,
    );
    const partyMenuBytes = this.#readSymbol("gPartyMenu", blocks);
    const partyMenuInternalPointerBytes = this.#readSymbol(
      "sPartyMenuInternal",
      blocks,
    );
    const paletteFadeBytes = this.#readSymbol("gPaletteFade", blocks);
    const battleFlagsBytes = this.#readSymbol("gBattleTypeFlags", blocks);
    const trainerOpponentBytes = this.#readSymbol("gTrainerBattleOpponent_A", blocks);
    const battleWeatherBytes = this.#readSymbol("gBattleWeather", blocks);
    const enigmaBerriesBytes=this.#readSymbol("gEnigmaBerries",blocks);
    const resourcesPointerBytes=this.#readSymbol("gBattleResources",blocks);
    let resourceFlagsBytes=null;
    const resourcesPointer=resourcesPointerBytes?.length>=4?u32(resourcesPointerBytes):null;
    if(isEwramPointer(resourcesPointer,8)){
      const resources=this.#session.readMemory(resourcesPointer,8);blocks.set('gBattleResources.data',resources);
      const flagPointer=u32(resources,4);
      if(isEwramPointer(flagPointer,16)){resourceFlagsBytes=this.#session.readMemory(flagPointer,16);blocks.set('gBattleResources.flags',resourceFlagsBytes);}
    }
    // Each battler's action for this turn (B_ACTION_*: 0 move, 1 item, 2
    // switch; 255 none). The trainer AI commits its action, and zeroes a
    // used trainer item, before the player's action menu is answered.
    const chosenActionsBytes=this.#readSymbol("gChosenActionByBattler",blocks,false);

    const battleControllerExecFlagsBytes = this.#readSymbol(
      "gBattleControllerExecFlags",
      blocks,
      false,
      "gBattleExecutionFlags",
    );
    const battlerControllerFuncsBytes = this.#readSymbol(
      "gBattlerControllerFuncs",
      blocks,
      false,
      "gBattlerInputFunctions",
    );
    const actionSelectionCursorBytes = this.#readSymbol(
      "gActionSelectionCursor",
      blocks,
    );
    const moveSelectionCursorBytes = this.#readSymbol(
      "gMoveSelectionCursor",
      blocks,
    );
    const activeBattlerBytes = this.#readSymbol("gActiveBattler", blocks);
    const battleMenuBattlerBytes = this.#readSymbol("gBattlerInMenuId", blocks);
    const battleOutcomeBytes = this.#readSymbol("gBattleOutcome", blocks);
    const battleScriptingBytes = this.#readSymbol("gBattleScripting", blocks);
    const battleScriptPointerBytes = this.#readSymbol(
      "gBattlescriptCurrInstr",
      blocks,
    );
    const battleCommunicationBytes = this.#readSymbol(
      "gBattleCommunication",
      blocks,
    );
    const moveToLearnBytes = this.#readSymbol("gMoveToLearn", blocks);
    const battleScriptPointer = battleScriptPointerBytes
      ? u32(battleScriptPointerBytes)
      : null;
    const captureNicknameStart = Number(
      this.#symbols.BattleScript_CaughtPokemonSkipNewDex?.address,
    );
    const captureNicknameEnd = Number(
      this.#symbols.BattleScript_CaughtPokemonSkipNickname?.address,
    );
    const battleScriptName =
      Number.isSafeInteger(battleScriptPointer) &&
      Number.isSafeInteger(captureNicknameStart) &&
      Number.isSafeInteger(captureNicknameEnd) &&
      battleScriptPointer >= captureNicknameStart &&
      battleScriptPointer < captureNicknameEnd
        ? "capture-nickname-prompt"
        : null;
    let battleScriptOpcode = null;
    if (
      Number.isSafeInteger(battleScriptPointer) &&
      battleScriptPointer >= 0x08000000 && battleScriptPointer < 0x0a000000
    ) {
      const command = this.#session.readMemory(battleScriptPointer, 1);
      blocks.set("gBattlescriptCurrInstr.command", command);
      battleScriptOpcode = command[0];
    }
    const battleMonsBytes = this.#readSymbol("gBattleMons", blocks);
    const battleStatuses3Bytes = this.#readSymbol("gStatuses3", blocks);
    const battleSideStatusBytes = this.#readSymbol("gSideStatuses", blocks);
    const disableStructsBytes = this.#readSymbol("gDisableStructs", blocks);
    const lastMovesBytes = this.#readSymbol("gLastMoves", blocks);
    const battleStructPointerBytes = this.#readSymbol("gBattleStruct", blocks);
    let battleStructBytes = null;
    const battleStructPointer = battleStructPointerBytes
      ? u32(battleStructPointerBytes)
      : null;
    if (isEwramPointer(battleStructPointer, 0x200)) {
      battleStructBytes = this.#session.readMemory(battleStructPointer, 0x200);
      blocks.set("gBattleStruct.data", battleStructBytes);
    }
    const battleResultsBytes = this.#readSymbol("gBattleResults", blocks);
    const wishFutureKnockBytes = main[0x439] & 0b10 ? this.#readSymbol("gWishFutureKnock", blocks) : null;
    const multiUsePlayerCursorBytes = this.#readSymbol(
      "gMultiUsePlayerCursor",
      blocks,
    );
    const battlersCountBytes = this.#readSymbol("gBattlersCount", blocks);
    const absentBattlerFlagsBytes = this.#readSymbol(
      "gAbsentBattlerFlags",
      blocks,
    );
    const sentPokesToOpponentBytes = this.#readSymbol(
      "gSentPokesToOpponent",
      blocks,
    );
    const battlerPartyIndexesBytes = this.#readSymbol(
      "gBattlerPartyIndexes",
      blocks,
    );
    const battlePartyOrderBytes = this.#readSymbol("gBattlePartyCurrentOrder", blocks);
    const enemyPartyBytes = main[0x439] & 0b10
      ? this.#readSymbol("gEnemyParty", blocks)
      : null;
    const displayedBattleTextBytes = this.#readSymbol(
      "gDisplayedStringBattle",
      blocks,
    );
    const playerPartyCountBytes = this.#readSymbol(
      "gPlayerPartyCount",
      blocks,
    );
    const playerPartyBytes = this.#readSymbol("gPlayerParty", blocks);
    const storagePointerBytes = this.#readSymbol("gStorage", blocks);
    const pokemonStoragePointerBytes = this.#readSymbol(
      "gPokemonStoragePtr",
      blocks,
    );
    const currentBoxOptionBytes = this.#readSymbol(
      "sCurrentBoxOption",
      blocks,
    );
    const storageCursorAreaBytes = this.#readSymbol("sCursorArea", blocks);
    const storageCursorPositionBytes = this.#readSymbol(
      "sCursorPosition",
      blocks,
    );
    const isMonBeingMovedBytes = this.#readSymbol(
      "sIsMonBeingMoved",
      blocks,
    );
    const inPartyMenuBytes = this.#readSymbol("sInPartyMenu", blocks);
    const depositBoxIdBytes = this.#readSymbol("sDepositBoxId", blocks);
    const chooseBoxMenuPointerBytes = this.#readSymbol("sChooseBoxMenu", blocks);

    const save1Pointer = u32(save1PointerBytes);
    const save1Size = this.#structures.SaveBlock1?.size;
    let save1 = null;
    if (isEwramPointer(save1Pointer, save1Size)) {
      save1 = this.#session.readMemory(save1Pointer, save1Size);
      blocks.set("SaveBlock1", save1);
    } else {
      reasons.push("save-block-1-pointer");
    }

    const save2Pointer = save2PointerBytes ? u32(save2PointerBytes) : 0;
    const save2Size = this.#structures.SaveBlock2?.size;
    let save2 = null;
    if (save2PointerBytes && isEwramPointer(save2Pointer, save2Size)) {
      save2 = this.#session.readMemory(save2Pointer, save2Size);
      blocks.set("SaveBlock2", save2);
    } else if (save2PointerBytes) {
      reasons.push("save-block-2-pointer");
    }

    const storagePointer = storagePointerBytes ? u32(storagePointerBytes) : 0;
    let storageHeader = null;
    if (storagePointerBytes && isEwramPointer(storagePointer, 2)) {
      storageHeader = this.#session.readMemory(storagePointer, 2);
      blocks.set("PokemonStorageSystemDataHeader", storageHeader);
    }
    const pokemonStoragePointer = pokemonStoragePointerBytes
      ? u32(pokemonStoragePointerBytes)
      : 0;
    let pokemonStorageHeader = null;
    let pokemonStorageBytes = null;
    if (
      pokemonStoragePointerBytes &&
      isEwramPointer(pokemonStoragePointer, POKEMON_STORAGE_BOX_BYTES)
    ) {
      pokemonStorageBytes = this.#session.readMemory(
        pokemonStoragePointer,
        POKEMON_STORAGE_BOX_BYTES,
      );
      pokemonStorageHeader = pokemonStorageBytes.slice(0, 1);
      blocks.set("PokemonStorage.boxes", pokemonStorageBytes);
      blocks.set("PokemonStorageHeader", pokemonStorageHeader);
    } else if (
      pokemonStoragePointerBytes &&
      isEwramPointer(pokemonStoragePointer, 1)
    ) {
      pokemonStorageHeader = this.#session.readMemory(pokemonStoragePointer, 1);
      blocks.set("PokemonStorageHeader", pokemonStorageHeader);
    }

    const summaryScreenPointer = summaryScreenPointerBytes
      ? u32(summaryScreenPointerBytes)
      : 0;
    let summarySelectMoveStateBytes = null;
    if (
      summaryScreenPointerBytes &&
      isEwramPointer(
        summaryScreenPointer + SUMMARY_SELECT_MOVE_STATE_OFFSET,
        1,
      )
    ) {
      summarySelectMoveStateBytes = this.#session.readMemory(
        summaryScreenPointer + SUMMARY_SELECT_MOVE_STATE_OFFSET,
        1,
      );
      blocks.set(
        "PokemonSummaryScreen.selectMoveInputHandlerState",
        summarySelectMoveStateBytes,
      );
    }
    const partyMenuInternalPointer = partyMenuInternalPointerBytes
      ? u32(partyMenuInternalPointerBytes)
      : 0;
    let partyMenuInternalHeader = null;
    if (
      partyMenuInternalPointerBytes &&
      isEwramPointer(partyMenuInternalPointer, 24)
    ) {
      partyMenuInternalHeader = this.#session.readMemory(
        partyMenuInternalPointer,
        24,
      );
      blocks.set("PartyMenuInternal.header", partyMenuInternalHeader);
    }

    const specialVariables = {};
    for (const id of this.#watchedSpecialVariables) {
      const bytes = this.#readSymbol(`gSpecialVar_0x${id.toString(16).toUpperCase()}`, blocks);
      if (bytes?.length === 2) specialVariables[id] = u16(bytes);
    }
    const sramBytes = this.#session.saveSram();
    const endFrame = this.#session.frame;
    if (startFrame !== endFrame) {
      throw new AtomicCaptureError(startFrame, endFrame);
    }

    const callback1Address = u32(main, 0);
    const callback2Address = u32(main, 4);
    const callback1 = this.#resolveSymbol(callback1Address);
    const callback2 = this.#resolveSymbol(callback2Address);
    if (!isRomPointer(callback2Address)) reasons.push("callback-2-pointer");

    const inBattle = Boolean(main[0x439] & 0b10);
    const mainState = main[0x438];
    const input = {
      heldKeysRaw: u16(main, 0x28),
      newKeysRaw: u16(main, 0x2a),
      heldKeys: u16(main, 0x2c),
      newKeys: u16(main, 0x2e),
    };
    const inputReady = input.heldKeysRaw === 0 && !questLog?.playback;
    const paletteFadeActive = Boolean(
      paletteFadeBytes?.[PALETTE_FADE_ACTIVE_OFFSET] &
        PALETTE_FADE_ACTIVE_MASK,
    );
    const activeTasks = [];
    if (tasks) {
      const taskSize = tasks.length / 16;
      if (Number.isSafeInteger(taskSize) && taskSize >= 10) {
        for (let slot = 0; slot < 16; slot += 1) {
          const offset = slot * taskSize;
          if (!tasks[offset + 4]) continue;
          const functionAddress = u32(tasks, offset);
          const functionName = this.#resolveSymbol(functionAddress);
          if (
            functionName === "task50_startmenu" ||
            functionName === "Task_StartMenuHandleInput" &&
              i16(tasks, offset + 8) === 0
          ) {
            reasons.push("start-menu-initializing");
          }
          activeTasks.push({
            slot,
            function: functionName,
            priority: tasks[offset + 7],
          });
        }
      }
    }
    const mode = modeFor({ callback2, inBattle, activeTasks });
    const inGameTradeState = tradeAnimHeader
      ? u16(tradeAnimHeader, 0x94)
      : null;
    const inGameTrade = mode === "in-game-trade" && inGameTradeState !== null
      ? {
          stage: inGameTradeState === IN_GAME_TRADE_STATE_END
            ? "completion"
            : "animation",
          state: inGameTradeState,
        }
      : null;
    if (mode === "in-game-trade" && inGameTrade?.stage !== "completion") {
      reasons.push(
        inGameTrade ? "in-game-trade-animation" : "in-game-trade-initializing",
      );
    }
    const battleMessageText = decodeFireRedText(displayedBattleTextBytes);
    const enemyParty = enemyPartyBytes
      ? Array.from({ length: 6 }, (_, slot) =>
          decodePartyPokemon(
            enemyPartyBytes,
            slot * PARTY_POKEMON_BYTES,
            slot,
          ),
        )
      : [];
    // party_menu.c temporarily rearranges gPlayerParty into menu order. Battle
    // indexes and participation masks remain in field order until we translate
    // them through its packed permutation. Bag/battle screens use field order.
    const battlePartyView = inBattle && (partyMenuBytes?.[8] & 0xf) === 1 &&
      /^(?:CB2_(?:Init|Update)PartyMenu|CB2_.*PokemonSummaryScreen)$/.test(callback2 ?? "");
    const decodedPartyOrder = battlePartyOrderBytes?.length === 3
      ? Array.from(battlePartyOrderBytes).flatMap(byte => [byte >>> 4, byte & 0xf])
      : null;
    const battlePartyOrder = battlePartyView && decodedPartyOrder &&
      new Set(decodedPartyOrder).size === 6 && decodedPartyOrder.every(slot => slot < 6)
      ? decodedPartyOrder : null;
    if (battlePartyView && !battlePartyOrder) reasons.push("battle-party-order-unavailable");
    const observedPartySlot = slot => battlePartyOrder && slot >= 0 && slot < 6
      ? battlePartyOrder.indexOf(slot) : slot;
    const nativeBattlerPartyIndexes = battlerPartyIndexesBytes
      ? Array.from(
          { length: Math.floor(battlerPartyIndexesBytes.length / 2) },
          (_, battler) => u16(battlerPartyIndexesBytes, battler * 2),
        )
      : null;
    const battlerPartyIndexes = nativeBattlerPartyIndexes?.map((slot, battler) =>
      battler % 2 === 0 ? observedPartySlot(slot) : slot
    ) ?? null;
    const decodedBattleMons = battleMonsBytes
      ? Array.from({ length: 4 }, (_, battler) => {
          const pokemon = decodeBattlePokemon(
            battleMonsBytes,
            battler * BATTLE_POKEMON_BYTES,
            battler,
          );
          const originalOpponent = battler % 2 === 1
            ? enemyParty[battlerPartyIndexes?.[battler]]
            : null;
          return pokemon
            ? {
                ...pokemon,
                battleFlags:battleFlagsBytes?.length>=4?u32(battleFlagsBytes):0,
                battleWeather:battleWeatherBytes?.length>=2?u16(battleWeatherBytes):null,
                flashFireActive:resourceFlagsBytes?Boolean(u32(resourceFlagsBytes,battler*4)&1):null,
                enigmaBerry:enigmaBerriesBytes?.length>=(battler+1)*27?{effectId:enigmaBerriesBytes[battler*27+7],param:enigmaBerriesBytes[battler*27+26]}:null,
                sideStatus: battleSideStatusBytes?.length>=4
                  ? u16(battleSideStatusBytes,(battler&1)*2) : null,
                ...(originalOpponent
                  ? { originalSpecies: originalOpponent.species }
                  : {}),
                status3: battleStatuses3Bytes?.length >= (battler + 1) * 4
                  ? u32(battleStatuses3Bytes, battler * 4)
                  : null,
                moveState: decodeBattleMoveState({
                  disableStructs: disableStructsBytes,
                  lastMoves: lastMovesBytes,
                  battleStruct: battleStructBytes,
                  battler,
                }),
              }
            : null;
        })
      : [];
    const alive=decodedBattleMons.filter(p=>p?.hp>0&&!(Number(absentBattlerFlagsBytes?.[0]??0)&(1<<p.battler)));
    for(const pokemon of decodedBattleMons.filter(Boolean)){
      pokemon.sideAlive=alive.filter(p=>(p.battler&1)===(pokemon.battler&1)).length;
      pokemon.fieldSports={mud:alive.some(p=>Number(p.status3)&(1<<16)),water:alive.some(p=>Number(p.status3)&(1<<17))};
      pokemon.plusMinusActive=pokemon.ability===57&&alive.some(p=>p.ability===58)||pokemon.ability===58&&alive.some(p=>p.ability===57);
      pokemon.weatherSuppressed=alive.some(p=>p.ability===13||p.ability===77);
      if(pokemon.weatherSuppressed)pokemon.battleWeather=0;
    }
    // An enemy record can survive between battles. Require the current battle
    // battler to agree on PID/OT before trusting its original (untransformed)
    // attributes. Missing RAM is unknown, never a negative shiny result.
    const encounterRecord = enemyParty[battlerPartyIndexes?.[1]];
    const coherentEncounter = encounterRecord && !encounterRecord.isEgg &&
      battleMonsBytes?.length >= BATTLE_POKEMON_BYTES * 2 &&
      u32(battleMonsBytes, BATTLE_POKEMON_BYTES + 72) === encounterRecord.personality &&
      u32(battleMonsBytes, BATTLE_POKEMON_BYTES + 84) === encounterRecord.otId &&
      decodedBattleMons[1]?.level > 0 && decodedBattleMons[1]?.maxHp > 0;
    const encounter = inBattle ? {
      // BATTLE_TYPE_OLD_MAN is set before the demonstration initializes its
      // enemy. Matching PID/OT can still describe the previous battle here.
      kind: !battleFlagsBytes ? "unknown"
        : (u32(battleFlagsBytes) & (1 << 9)) ? "tutorial"
        : (u32(battleFlagsBytes) & 8) ? "trainer" : "wild",
      validity: coherentEncounter ? "valid" : "unknown",
      reason: coherentEncounter ? "checked-enemy-record-and-battler" : "enemy-record-unavailable-or-inconsistent",
      pokemon: coherentEncounter ? encounterRecord : null,
    } : null;
    const battleState = mode === "battle"
      ? {
          trainerId: trainerOpponentBytes?.length >= 2 ? u16(trainerOpponentBytes) : null,
          enemyParty: enemyParty.filter(pokemon => pokemon?.species > 0 && pokemon.level > 0),
          scriptName: battleScriptName,
          weather: battleWeatherBytes?.length >= 2 ? u16(battleWeatherBytes, 0) : null,
          player: decodedBattleMons[0] ?? null,
          opponent: decodedBattleMons[1] ?? null,
          battlers: decodedBattleMons,
          sentPartyMasks: sentPokesToOpponentBytes
            ? Array.from(sentPokesToOpponentBytes, mask => battlePartyOrder
                ? battlePartyOrder.reduce((bits, fieldSlot, menuSlot) =>
                    bits | (((mask >>> fieldSlot) & 1) << menuSlot), mask & 0xc0)
                : mask)
            : null,
          battlerPartyIndexes,
          ...(battlePartyOrder ? { partyMenuOrder: battlePartyOrder, nativeBattlerPartyIndexes } : {}),
          monToSwitchIntoIds: battleStructBytes?.length >= 0x60
            ? Array.from(battleStructBytes.slice(0x5c, 0x60), (slot, battler) =>
                battler % 2 === 0 ? observedPartySlot(slot) : slot)
            : null,
          playerPartySlot: battlerPartyIndexes?.[0] ?? null,
          runAttempts: battleStructBytes?.length > 0x6c
            ? battleStructBytes[0x6c]
            : null,
          turn: battleResultsBytes?.length > 0x13
            ? battleResultsBytes[0x13]
            : null,
          battlersCount: battlersCountBytes?.[0] ?? null,
          absentBattlerFlags: absentBattlerFlagsBytes?.[0] ?? null,
          // Consumed held items per battler position and Knock Off marks per side.
          ...decodeBattleItemState(battleStructBytes, wishFutureKnockBytes),
          messageText: battleMessageText,
          announcedOpponentName: announcedOpponentName(battleMessageText),
          ...(chosenActionsBytes?.length >= 4 ? { chosenActions: Array.from(chosenActionsBytes.slice(0, 4)) } : {}),
        }
      : null;
    const activeTaskNames = new Set(
      activeTasks.map(({ function: name }) => name),
    );
    const flyMap = mode === "fly-map" && flyMapHeader && mapCursorHeader &&
        flyMapHeader[0] === 4
      ? {
          stage: "selection",
          cursor: {
            x: i16(mapCursorHeader, 0),
            y: i16(mapCursorHeader, 2),
          },
          selectedMapsec: u16(mapCursorHeader, 20),
          selectedMapsecType: u16(mapCursorHeader, 22),
          selectedDungeonType: u16(mapCursorHeader, 24),
        }
      : null;
    const taskFieldMessageReady = Boolean(
      mode === "overworld" &&
        activeTaskNames.has("Task_ContinueTaskAfterMessagePrints") &&
        textPrintersBytes?.[27] &&
        TEXT_PRINTER_READY_STATES.has(textPrintersBytes[28]),
    );
    const playerName = decodeStructureText(
      save2,
      this.#structures.SaveBlock2?.fields?.playerName,
    );
    const rivalName = decodeStructureText(
      save1,
      this.#structures.SaveBlock1?.fields?.rivalName,
    );
    const playerGenderOffset =
      this.#structures.SaveBlock2?.fields?.playerGender?.offset;
    const playerGender =
      save2 && Number.isSafeInteger(playerGenderOffset) &&
      playerGenderOffset >= 0 && playerGenderOffset < save2.length
        ? save2[playerGenderOffset] === 1 ? "GIRL" : "BOY"
        : null;
    const mappedNewGameTask = activeTasks.find(
      ({ function: name }) => NEW_GAME_READY_TASK_STAGES[name],
    );
    const oakNarrationTask = activeTasks.find(
      ({ function: name }) => /^Task_OakSpeech_/.test(name ?? ""),
    );
    const oakNarrationReady = Boolean(
      oakNarrationTask &&
        textPrintersBytes?.[27] &&
        TEXT_PRINTER_READY_STATES.has(textPrintersBytes[28]),
    );
    const newGameTask = mappedNewGameTask ??
      (oakNarrationReady ? oakNarrationTask : null);
    const newGameReadyTask =
      newGameTask?.function !== "Task_PikachuIntro_HandleInput" || mainState === 1
        ? newGameTask
        : null;
    let newGame = null;
    if (newGameReadyTask) {
      const taskName = newGameReadyTask.function;
      const isRivalNameMenu =
        taskName === "Task_OakSpeech_HandleRivalNameInput";
      const isGenderMenu = taskName === "Task_OakSpeech_HandleGenderInput";
      const cursor = menuBytes?.[2] ?? null;
      newGame = {
        stage: isRivalNameMenu
          ? "choose-rival-name"
          : NEW_GAME_READY_TASK_STAGES[taskName] ?? "oak-dialog",
        selected:
          [
            "Task_ControlsGuide_HandleInput",
            "Task_PikachuIntro_HandleInput",
          ].includes(taskName) ||
          (!NEW_GAME_READY_TASK_STAGES[taskName] &&
            newGameReadyTask === oakNarrationTask)
            ? "next"
            : isGenderMenu && Number.isSafeInteger(cursor)
              ? cursor === 1 ? "GIRL" : "BOY"
              : null,
        ...(isGenderMenu || isRivalNameMenu
          ? { cursor }
          : {}),
      };
    }
    let naming = null;
    if (namingScreenBytes) {
      const template = namingScreenBytes[NAMING_TEMPLATE_OFFSET];
      const state = namingScreenBytes[NAMING_STATE_OFFSET];
      const cursorSpriteId = namingScreenBytes[NAMING_CURSOR_SPRITE_OFFSET];
      const cursorOffset = cursorSpriteId * SPRITE_BYTES + SPRITE_DATA_OFFSET;
      const cursor = namingSpritesBytes &&
          cursorOffset >= 0 && cursorOffset + 4 <= namingSpritesBytes.length
        ? {
            x: i16(namingSpritesBytes, cursorOffset),
            y: i16(namingSpritesBytes, cursorOffset + 2),
          }
        : null;
      const subject = template === 0
        ? "player"
        : template === 4
          ? "rival"
          : [2, 3].includes(template)
            ? "pokemon"
            : "box";
      naming = {
        stage: template === 0
          ? "enter-player-preset"
          : template === 4
            ? "enter-rival-name"
            : [2, 3].includes(template)
              ? "nickname"
              : "box-name",
        subject,
        template,
        state,
        inputReady: state === NAMING_INPUT_STATE && Boolean(cursor),
        text: decodeFireRedText(namingScreenBytes.slice(
          NAMING_TEXT_OFFSET,
          NAMING_TEXT_OFFSET + NAMING_TEXT_BYTES,
        )) ?? "",
        // SaveInputText checks all ten Pokemon-name bytes, not merely the
        // decoded prefix. Unknown glyphs must never masquerade as empty input.
        ...(subject === "pokemon" ? { textIsBlank: namingScreenBytes.slice(
          NAMING_TEXT_OFFSET, NAMING_TEXT_OFFSET + 10,
        ).every((byte) => byte === 0xff || byte === 0) } : {}),
        page: namingScreenBytes[NAMING_PAGE_OFFSET],
        cursor,
      };
    }
    if (/NamingScreen/.test(callback2 ?? "") && !naming?.inputReady) {
      reasons.push("naming-transition");
    }
    const taskData = (task, index) => {
      if (!tasks || !task) return null;
      const taskSize = tasks.length / 16;
      if (!Number.isSafeInteger(taskSize) || taskSize < 10) return null;
      return i16(tasks, task.slot * taskSize + 8 + index * 2);
    };
    // main_menu.c stores its menu type and highlighted row in task data[0:2].
    // Read the active input task, never infer Continue from stale overworld RAM.
    const mainMenuTask = callback2 === "CB2_MainMenu"
      ? activeTasks.find(({ function: name }) => name === "Task_HandleMenuInput")
      : null;
    const mainMenuType = taskData(mainMenuTask, 0);
    const mainMenuOptions = mainMenuType === 0 ? ["new-game"]
      : mainMenuType === 1 ? ["continue", "new-game"]
      : mainMenuType === 2 ? ["continue", "new-game", "mystery-gift"] : [];
    const mainMenuCursor = taskData(mainMenuTask, 1);
    const mainMenu = callback2 === "CB2_MainMenu" ? {
      stage: activeTaskNames.has("Task_SaveErrorStatus_RunPrinterThenWaitButton")
        ? "save-error" : mainMenuTask ? "choose-save" : "loading",
      cursor: mainMenuCursor,
      options: mainMenuOptions,
      selected: mainMenuOptions[mainMenuCursor] ?? null,
      continueAvailable: mainMenuOptions.includes("continue"),
      saveStatus: saveFileStatusBytes ? u16(saveFileStatusBytes) : null,
    } : null;
    const taskWordArg = (task, index) => {
      const low = taskData(task, index * 2);
      const high = taskData(task, index * 2 + 1);
      return Number.isSafeInteger(low) && Number.isSafeInteger(high)
        ? ((low & 0xffff) | ((high & 0xffff) << 16)) >>> 0
        : null;
    };
    const blackoutTask = activeTasks.find(
      ({ function: name }) => name === "Task_RushInjuredPokemonToCenter",
    );
    const blackoutTaskState = taskData(blackoutTask, 0);
    const blackoutWindowId = taskData(blackoutTask, 1);
    const blackoutPrinterOffset = Number.isSafeInteger(blackoutWindowId)
      ? blackoutWindowId * 36
      : null;
    const blackoutPrinter =
      Number.isSafeInteger(blackoutPrinterOffset) &&
      blackoutPrinterOffset >= 0 &&
      blackoutPrinterOffset + 28 < (textPrintersBytes?.length ?? 0)
        ? {
            active: Boolean(textPrintersBytes[blackoutPrinterOffset + 27]),
            state: textPrintersBytes[blackoutPrinterOffset + 28],
            stateName:
              TEXT_PRINTER_STATES[
                textPrintersBytes[blackoutPrinterOffset + 28]
              ] ??
              `unknown-${textPrintersBytes[blackoutPrinterOffset + 28]}`,
          }
        : null;
    const blackoutMessageState = [1, 4].includes(blackoutTaskState);
    const blackoutReady = Boolean(
      blackoutMessageState &&
        blackoutPrinter?.active &&
        TEXT_PRINTER_READY_STATES.has(blackoutPrinter.state),
    );
    const blackout = blackoutTask
      ? {
          stage: blackoutMessageState
            ? blackoutReady
              ? "recovery-message"
              : "printing-recovery-message"
            : "relocating",
          destination: [4, 5, 6].includes(blackoutTaskState)
            ? "home"
            : "pokemon-center",
          selected: blackoutReady ? "acknowledge" : null,
          textPrinter: blackoutPrinter,
        }
      : null;
    if (blackoutTask && !blackoutReady) {
      reasons.push("blackout-transition");
    }
    const titleScreenMainTask = activeTasks.find(
      ({ function: name }) => name === "Task_TitleScreenMain",
    );
    if ([4, 5].includes(taskData(titleScreenMainTask, 0))) {
      reasons.push("title-screen-transition");
    }
    if (
      [...activeTaskNames].some(
        (name) =>
          TRANSIENT_MODAL_TASKS.has(name) &&
          !(
            name === "Task_ContinueTaskAfterMessagePrints" &&
            taskFieldMessageReady
          ),
      )
    ) {
      reasons.push("modal-task-transition");
    }
    const battleControllerFunctions = battlerControllerFuncsBytes
      ? Array.from({ length: 4 }, (_, battler) =>
          this.#resolveSymbol(u32(battlerControllerFuncsBytes, battler * 4)),
        )
      : [];
    const battleDecision = battleControllerFunctions
      .map((functionName, battler) => ({ functionName, battler }))
      .find(({ functionName }) =>
        [
          "HandleInputChooseAction",
          "HandleInputChooseMove",
          "OakOldManHandleInputChooseMove",
          "HandleInputChooseTarget",
        ].includes(functionName),
      );
    const battleTextReady = BATTLE_MESSAGE_WINDOW_IDS.some((windowId) => {
      const offset = windowId * 36;
      return Boolean(textPrintersBytes?.[offset + 27]) &&
        TEXT_PRINTER_READY_STATES.has(textPrintersBytes?.[offset + 28]);
    });
    const drawLevelUpBoxState = battleScriptingBytes?.[30] ?? null;
    const learnMoveState = battleScriptingBytes?.[31] ?? null;
    const battleMoveLearning =
      mode === "battle" &&
      learnMoveState === 1 &&
      [0x5a, 0x5b].includes(battleScriptOpcode)
        ? {
            stage: battleScriptOpcode === 0x5a
              ? "confirm-replace"
              : "confirm-stop-learning",
            partySlot: 0,
            moveId: moveToLearnBytes ? u16(moveToLearnBytes) : null,
            itemId: 0,
            cursor: battleCommunicationBytes?.[1] ?? null,
            selected:
              battleCommunicationBytes?.[1] === 0
                ? "yes"
                : battleCommunicationBytes?.[1] === 1
                  ? "no"
                  : null,
          }
        : null;
    const battleYesNoReady =
      mode === "battle" &&
      (
        battleScriptOpcode === 0x67 ||
        (
          battleScriptName === "capture-nickname-prompt" &&
          battleScriptOpcode === 0xf3
        )
      ) &&
      battleCommunicationBytes?.[0] === 1;
    const pokedexRegistration =
      mode === "battle" &&
      activeTaskNames.has("Task_DexScreen_RegisterMonToPokedex") &&
      pokedexScreenHeader?.[1] === 11
        ? { stage: "registered-entry", selected: "continue" }
        : null;
    const battleLevelUpReady = [6, 8].includes(drawLevelUpBoxState);
    let battle = null;
    if (mode === "battle" && battleDecision) {
      const { functionName, battler } = battleDecision;
      if (functionName === "HandleInputChooseAction") {
        const cursor = actionSelectionCursorBytes?.[battler] ?? null;
        battle = {
          stage: "action",
          battler,
          cursor,
          selected: BATTLE_ACTIONS[cursor] ?? null,
        };
      } else if (
        ["HandleInputChooseMove", "OakOldManHandleInputChooseMove"].includes(
          functionName,
        )
      ) {
        const cursor = moveSelectionCursorBytes?.[battler] ?? null;
        const selectedMoveId = Number.isSafeInteger(cursor)
          ? (battleState?.battlers?.[battler]?.moves?.[cursor] || null)
          : null;
        battle = {
          stage: "move",
          battler,
          cursor,
          selected: Number.isSafeInteger(cursor) ? `move-${cursor + 1}` : null,
          selectedMoveId,
        };
      } else {
        const cursor = multiUsePlayerCursorBytes?.[0] ?? null;
        const selectedMoveSlot = moveSelectionCursorBytes?.[battler] ?? null;
        const selectedMoveId = Number.isSafeInteger(selectedMoveSlot)
          ? battleState?.battlers?.[battler]?.moves?.[selectedMoveSlot] || null
          : null;
        battle = {
          stage: "target",
          battler,
          cursor,
          selected: Number.isSafeInteger(cursor) ? `battler-${cursor}` : null,
          selectedSpecies: Number.isSafeInteger(cursor)
            ? battleState?.battlers?.[cursor]?.species ?? null
            : null,
          selectedMoveId,
        };
      }
    } else if (mode === "battle" && battleLevelUpReady) {
      battle = {
        stage: "level-up-stats",
        battler: null,
        cursor: 0,
        selected: "advance",
        page: drawLevelUpBoxState === 6 ? 1 : 2,
      };
    } else if (mode === "battle" && battleTextReady) {
      battle = {
        stage: "message",
        battler: null,
        cursor: null,
        selected: null,
      };
    }
    // FireRed refreshes a white palette preview on every frame of a double
    // battle's move menu.  The controller still consumes input there, so that
    // particular fade proves neither animation nor loss of control.
    const actionableDoubleBattleMovePreview = Boolean(
      paletteFadeActive &&
      battle?.stage === "move" &&
      battleDecision?.functionName === "HandleInputChooseMove" &&
      ((battleFlagsBytes ? u32(battleFlagsBytes) : 0) & BATTLE_TYPE_DOUBLE),
    );
    if (paletteFadeActive && !actionableDoubleBattleMovePreview) {
      reasons.push("palette-fade");
    }
    const partyPrinterOffset = 6 * 36;
    const partyTextReady =
      Boolean(textPrintersBytes?.[partyPrinterOffset + 27]) &&
      TEXT_PRINTER_READY_STATES.has(
        textPrintersBytes?.[partyPrinterOffset + 28],
      );
    const partyMessageDecisionReady =
      activeTaskNames.has("Task_PrintAndWaitForText") && partyTextReady;
    const partyDecisionReady = activeTaskNames.has("Task_HandleChooseMonInput");
    const battleMoveSelectionReady = activeTaskNames.has(
      "Task_InputHandler_SelectOrForgetMove",
    );
    const battleBagDecisionReady =
      activeTaskNames.has("Task_BagMenu_HandleInput") ||
      activeTaskNames.has("Task_FieldItemContextMenuHandleInput");
    const partySelectionActionReady = activeTaskNames.has(
      "Task_HandleSelectionMenuInput",
    );
    const battlePartyActionReady =
      mode === "battle" && partySelectionActionReady;
    if (
      mode === "battle" && !battle && !partyDecisionReady &&
      !battleMoveLearning && !battleMoveSelectionReady &&
      !battleBagDecisionReady && !partyMessageDecisionReady &&
      !battleYesNoReady && !battlePartyActionReady && !pokedexRegistration
    ) {
      reasons.push("battle-transition");
    }
    const evolutionTask = activeTasks.find(
      ({ function: name }) => name === "Task_EvolutionScene",
    );
    const autonomousEvolutionTask = activeTasks.find(({ function: name }) =>
      /^EvoTask_/.test(name ?? ""),
    );
    const evolutionMoveLearning =
      mode === "evolution" &&
      taskData(evolutionTask, 0) === EVOLUTION_STATE_REPLACE_MOVE &&
      taskData(evolutionTask, 6) === EVOLUTION_MOVE_STATE_HANDLE_YES_NO
        ? {
            stage:
              taskData(evolutionTask, 7) ===
                EVOLUTION_MOVE_STATE_SHOW_MOVE_SELECT
                ? "confirm-replace"
                : taskData(evolutionTask, 7) === EVOLUTION_MOVE_STATE_CANCEL
                  ? "confirm-stop-learning"
                  : "confirm-replace",
            partySlot: taskData(evolutionTask, 10),
            moveId: moveToLearnBytes ? u16(moveToLearnBytes) : null,
            itemId: 0,
            cursor: battleCommunicationBytes?.[1] ?? null,
            selected:
              battleCommunicationBytes?.[1] === 0
                ? "yes"
                : battleCommunicationBytes?.[1] === 1
                  ? "no"
                  : null,
          }
        : null;
    const evolutionReady =
      mode === "evolution" &&
      Boolean(evolutionTask) &&
      !autonomousEvolutionTask &&
      battleTextReady;
    if (mode === "evolution" && !evolutionReady && !evolutionMoveLearning) {
      reasons.push("evolution-transition");
    }
    const psaTask = activeTasks.find(({ function: name }) =>
      /Task_(?:ForgetMove|MachineSet|UseTM_NoForget|UseItem_Normal|EvoStone_CantEvolve|CleanUp)/.test(
        name ?? "",
      ),
    );
    const psaWorkPointer = taskWordArg(psaTask, 0);
    let psaWorkBytes = null;
    if (isEwramPointer(psaWorkPointer, 0x98)) {
      psaWorkBytes = this.#session.readMemory(psaWorkPointer, 0x98);
      blocks.set("PokemonSpecialAnim.header", psaWorkBytes);
    }
    const psaState = psaWorkBytes ? u16(psaWorkBytes, 0x92) : null;
    const psaItemId = psaWorkBytes ? u16(psaWorkBytes, 0x96) : null;
    const psaAwaitingItemResult =
      psaTask?.function === "Task_UseItem_Normal" &&
      (
        psaState === 12 ||
        globalScriptContextBytes &&
          this.#resolveSymbol(u32(globalScriptContextBytes, 4)) ===
            "WaitForAorBPress"
      );
    const psaMessageReady =
      callback2 === "CB2_PSA" &&
      (battleTextReady || psaAwaitingItemResult);
    const specialAnimation =
      psaTask && psaMessageReady
        ? {
            stage: "message",
            task: psaTask.function,
            itemId: psaItemId ?? (specialItemBytes ? u16(specialItemBytes) : null),
          }
        : null;
    const martTask = activeTasks.find(
      ({ function: name }) => MART_READY_TASK_STAGES[name],
    );
    const martStage =
      martTask?.function && MART_READY_TASK_STAGES[martTask.function]
        ? MART_READY_TASK_STAGES[martTask.function]
        : /BuyMenu/.test(callback2 ?? "") &&
            activeTaskNames.has("Task_CallYesOrNoCallback")
          ? "confirm-purchase"
          : null;
    const martCursor = menuBytes
      ? new DataView(
          menuBytes.buffer,
          menuBytes.byteOffset,
          menuBytes.byteLength,
        ).getInt8(2)
      : null;
    const martItemListCursor =
      martStage === "item-list" && shopDataBytes?.length >= 0x10
        ? u16(shopDataBytes, 0x0c) + u16(shopDataBytes, 0x0e)
        : null;
    const martItemId =
      martStage === "quantity" ? taskData(martTask, 5) : null;
    const martQuantity =
      martStage === "quantity" ? taskData(martTask, 1) : null;
    const mart = martStage
      ? {
          stage: martStage,
          cursor:
            martStage === "shop-menu" || martStage === "confirm-purchase"
              ? martCursor
              : martItemListCursor,
          selected:
            martStage === "confirm-purchase"
              ? martCursor === 0
                ? "yes"
                : martCursor === 1
                  ? "no"
                  : null
              : null,
          ...(martStage === "quantity"
            ? {
                itemId: martItemId,
                quantity: martQuantity,
                maximumQuantity: shopDataBytes?.length >= 0x16
                  ? u16(shopDataBytes, 0x14)
                  : null,
              }
            : {}),
          ...(martStock ? { stock: martStock } : {}),
        }
      : null;
    const pcMenuTask = activeTasks.find(
      ({ function: name }) => name === "Task_PCMainMenu",
    );
    const storageMainTask = activeTasks.find(
      ({ function: name }) => name === "Task_PokeStorageMain",
    );
    const storagePokemonMenuTask = activeTasks.find(
      ({ function: name }) => name === "Task_OnSelectedMon",
    );
    const storageDepositTask = activeTasks.find(
      ({ function: name }) => name === "Task_DepositMenu",
    );
    const chooseBoxMenuPointer = chooseBoxMenuPointerBytes
      ? u32(chooseBoxMenuPointerBytes)
      : 0;
    let chooseBoxCursorBytes = null;
    const chooseBoxCursorAddress =
      chooseBoxMenuPointer + CHOOSE_BOX_MENU_CURRENT_BOX_OFFSET;
    if (
      storageDepositTask &&
      isEwramPointer(chooseBoxCursorAddress, 1)
    ) {
      chooseBoxCursorBytes = this.#session.readMemory(chooseBoxCursorAddress, 1);
      blocks.set("ChooseBoxMenu.curBox", chooseBoxCursorBytes);
    }
    const storageContinueTask = activeTasks.find(
      ({ function: name }) => name === "Task_OnBPressed",
    );
    const storageReleaseTask = activeTasks.find(
      ({ function: name }) => name === "Task_ReleaseMon",
    );
    const pcMenuState = taskData(pcMenuTask, 0);
    const pcMenuReady = Boolean(pcMenuTask) && (pcMenuState === 2 || pcMenuState === 3);
    const graphicalStorageTask =
      storageMainTask ??
      storagePokemonMenuTask ??
      storageDepositTask ??
      storageContinueTask ??
      storageReleaseTask;
    const graphicalStorageScreen = /PokeStorage/.test(callback2 ?? "");
    const graphicalStorageState = storageHeader?.[0] ?? null;
    const releaseStage = storageReleaseTask
      ? RELEASE_STORAGE_STATES[graphicalStorageState] ?? null
      : null;
    const graphicalStorageReady =
      (Boolean(storageMainTask) && graphicalStorageState === 0) ||
      (Boolean(storagePokemonMenuTask) && graphicalStorageState === 2) ||
      (Boolean(storageDepositTask) &&
        (graphicalStorageState === 1 || graphicalStorageState === 4)) ||
      (Boolean(storageContinueTask) && graphicalStorageState === 2) ||
      Boolean(releaseStage);
    // The selected Pokémon's menu lists the cartridge's own labels. Each entry's
    // text pointer must be the ROM label for its id, or the menu is withheld.
    let storageMenu = null;
    if (storagePokemonMenuTask && graphicalStorageState === 2 &&
        isEwramPointer(storagePointer + STORAGE_MENU_ITEMS_OFFSET, STORAGE_MENU_BLOCK_BYTES)) {
      const menuTextBytes = this.#readSymbolOfSize("sMenuTexts", STORAGE_MENU_TEXTS.length * 4, blocks);
      const menuBlock = this.#session.readMemory(storagePointer + STORAGE_MENU_ITEMS_OFFSET, STORAGE_MENU_BLOCK_BYTES);
      blocks.set("PokemonStorageSystemData.menuItems", menuBlock);
      const count = menuBlock[56];
      const view = new DataView(menuBlock.buffer, menuBlock.byteOffset, menuBlock.byteLength);
      const labels = menuTextBytes?.length === STORAGE_MENU_TEXTS.length * 4
        ? new DataView(menuTextBytes.buffer, menuTextBytes.byteOffset, menuTextBytes.byteLength)
        : null;
      const items = labels && count >= 1 && count <= 7
        ? Array.from({ length: count }, (_, index) => {
            const textId = view.getInt32(index * 8 + 4, true);
            return textId >= 0 && textId < STORAGE_MENU_TEXTS.length &&
              view.getUint32(index * 8, true) === labels.getUint32(textId * 4, true)
              ? STORAGE_MENU_TEXTS[textId]
              : null;
          })
        : null;
      storageMenu = items && items.every(Boolean)
        ? { items, cursor: martCursor, selected: items[martCursor] ?? null }
        : null;
    }
    if (
      (pcMenuTask && !pcMenuReady) ||
      (graphicalStorageTask && !graphicalStorageReady) ||
      (graphicalStorageScreen && !graphicalStorageReady)
    ) {
      reasons.push("storage-transition");
    }
    let storage = null;
    if (pcMenuReady) {
      const option = taskData(pcMenuTask, 1);
      storage = {
        stage: "pc-menu",
        option,
        selected: STORAGE_OPTIONS[option] ?? null,
        boxOption: null,
        cursorArea: null,
        cursorPosition: null,
        currentBox: null,
        movingPokemon: null,
        depositBox: null,
      };
    } else if (graphicalStorageReady) {
      const boxOptionValue = storageHeader?.[1] ?? currentBoxOptionBytes?.[0];
      const cursorAreaValue = storageCursorAreaBytes?.[0] ?? null;
      const yesNo = Boolean(storageContinueTask || releaseStage?.[0] === "release-confirm");
      const continueCursor = yesNo ? martCursor : null;
      const stage = storageContinueTask
        ? "confirm-continue"
        : releaseStage
          ? releaseStage[0]
          : storageDepositTask
            ? "deposit-box"
            : storagePokemonMenuTask
              ? "pokemon-menu"
              : "storage-main";
      storage = {
        stage,
        option: continueCursor,
        selected: yesNo
          ? continueCursor === 0
            ? "yes"
            : continueCursor === 1
              ? "no"
              : null
          : null,
        boxOption: STORAGE_OPTIONS[boxOptionValue] ?? null,
        cursorArea:
          STORAGE_CURSOR_AREAS[cursorAreaValue] ??
          (inPartyMenuBytes?.[0] ? "party" : null),
        cursorPosition: storageCursorPositionBytes?.[0] ?? null,
        currentBox: pokemonStorageHeader?.[0] ?? null,
        movingPokemon:
          isMonBeingMovedBytes === null
            ? null
            : Boolean(isMonBeingMovedBytes[0]),
        depositBox: storageDepositTask
          ? chooseBoxCursorBytes?.[0] ?? null
          : depositBoxIdBytes?.[0] ?? null,
        ...(stage === "pokemon-menu" ? { menu: storageMenu } : {}),
        ...(releaseStage?.[1] ? { message: releaseStage[1] } : {}),
      };
    }
    const scriptYesNoReady = activeTasks.some(
      ({ function: name }) => name === "Task_YesNoMenu_HandleInput",
    );
    const scriptListMenuHandler = activeTasks.find(
      ({ function: name }) => name === "Task_ListMenuHandleInput",
    );
    const scriptListTaskSlot = taskData(scriptListMenuHandler, 14);
    const scriptListTask = activeTasks.find(
      ({ slot }) => slot === scriptListTaskSlot,
    );
    const scriptListCursorRow = taskData(scriptListTask, 12);
    const scriptListItemsAbove = taskData(scriptListTask, 13);
    const scriptListTotalItems = taskData(scriptListMenuHandler, 1);
    const scriptListRows = taskData(scriptListMenuHandler, 0);
    const scriptListMenuReady = Boolean(
      scriptListMenuHandler &&
        scriptListTask?.function === "ListMenuDummyTask" &&
        Number.isSafeInteger(scriptListCursorRow) &&
        Number.isSafeInteger(scriptListItemsAbove) &&
        Number.isSafeInteger(scriptListTotalItems) &&
        scriptListTotalItems > 0 &&
        Number.isSafeInteger(scriptListRows) &&
        scriptListRows > 0,
    );
    const fieldChoiceMenuReady = scriptListMenuReady || activeTasks.some(({ function: name }) =>
      ["Task_MultichoiceMenu_HandleInput", "Task_YesNoMenu_HandleInput"].includes(
        name,
      ),
    );
    let choiceMenu = null;
    if (battleYesNoReady) {
      const cursor = battleCommunicationBytes[1];
      choiceMenu = {
        cursor,
        minCursor: 0,
        maxCursor: 1,
        columns: 1,
        rows: 2,
        selected: cursor === 0 ? "yes" : cursor === 1 ? "no" : null,
      };
    } else if (battlePartyActionReady && menuBytes) {
      const cursor = menuBytes[2];
      const firstAction = partyMenuBytes?.[11] === PARTY_ACTION_SEND_OUT
        ? "send-out"
        : "shift";
      const actions = [firstAction, "summary", "cancel"];
      choiceMenu = {
        cursor,
        minCursor: 0,
        maxCursor: 2,
        columns: 1,
        rows: 3,
        selected: actions[cursor] ?? null,
      };
    } else if (scriptListMenuReady) {
      choiceMenu = {
        cursor: scriptListCursorRow + scriptListItemsAbove,
        minCursor: 0,
        maxCursor: scriptListTotalItems - 1,
        columns: 1,
        rows: Math.min(scriptListRows, scriptListTotalItems),
        selected: null,
      };
    } else if (fieldChoiceMenuReady && menuBytes) {
      const cursor = new DataView(
        menuBytes.buffer,
        menuBytes.byteOffset,
        menuBytes.byteLength,
      ).getInt8(2);
      const minCursor = new DataView(
        menuBytes.buffer,
        menuBytes.byteOffset,
        menuBytes.byteLength,
      ).getInt8(3);
      const maxCursor = new DataView(
        menuBytes.buffer,
        menuBytes.byteOffset,
        menuBytes.byteLength,
      ).getInt8(4);
      const columns = menuBytes[9];
      const rows = menuBytes[10];
      const isYesNo =
        scriptYesNoReady ||
        (minCursor === 0 && maxCursor === 1 && columns === 1);
      choiceMenu = {
        cursor,
        minCursor,
        maxCursor,
        columns,
        rows,
        selected: isYesNo
          ? cursor === 0
            ? "yes"
            : cursor === 1
              ? "no"
              : null
          : null,
        ...(scriptYesNoReady && mode === "overworld" && this.#isPokemonNicknamePrompt(blocks)
          ? { purpose: "pokemon-nickname" } : {}),
      };
    }
    let startMenu = null;
    if (
      mode === "start-menu" &&
      startMenuCursorBytes &&
      startMenuCountBytes &&
      startMenuOrderBytes
    ) {
      const cursor = startMenuCursorBytes[0];
      const count = Math.min(startMenuCountBytes[0], startMenuOrderBytes.length);
      const order = [...startMenuOrderBytes.slice(0, count)].map(
        (item) => START_MENU_ITEMS[item] ?? `unknown-${item}`,
      );
      startMenu = {
        cursor,
        count,
        order,
        selected: order[cursor] ?? null,
      };
    }
    const liveSave1Fields = this.#structures.SaveBlock1?.fields ?? {};
    const liveEncryptionKeyOffset =
      this.#structures.SaveBlock2?.fields?.encryptionKey?.offset;
    const liveEncryptionKey =
      save2 &&
      Number.isSafeInteger(liveEncryptionKeyOffset) &&
      liveEncryptionKeyOffset + 4 <= save2.length
        ? u32(save2, liveEncryptionKeyOffset)
        : null;
    const liveBag =
      save1 && liveEncryptionKey !== null
        ? decodeBag(save1, liveSave1Fields, liveEncryptionKey)
        : null;
    const specialItemId = specialItemBytes ? u16(specialItemBytes) : null;
    const bagListTask = activeTasks.find(
      ({ function: name }) => name === "Task_BagMenu_HandleInput",
    );
    const bagContextTask = activeTasks.find(
      ({ function: name }) =>
        name === "Task_FieldItemContextMenuHandleInput",
    );
    const tmCaseListTask = activeTasks.find(
      ({ function: name }) => name === "Task_HandleListInput",
    );
    const tmCaseContextTask = activeTasks.find(
      ({ function: name }) => name === "Task_ContextMenu_HandleInput",
    );
    const berryPouchListTask=activeTasks.find(t=>t.function==='Task_BerryPouchMain');
    const berryPouchContextTask=/BerryPouch/.test(callback2??'')&&activeTasks.find(t=>t.function==='Task_NormalContextMenu_HandleInput');
    let bag = null;
    if ((bagListTask || bagContextTask) && bagMenuStateBytes) {
      const pocket = u16(bagMenuStateBytes, 6);
      const pocketDefinition = BAG_MENU_POCKETS[pocket] ?? null;
      const cursor =
        pocketDefinition && 8 + pocket * 2 + 2 <= bagMenuStateBytes.length
          ? u16(bagMenuStateBytes, 8 + pocket * 2)
          : null;
      const scrollOffset =
        pocketDefinition && 14 + pocket * 2 + 2 <= bagMenuStateBytes.length
          ? u16(bagMenuStateBytes, 14 + pocket * 2)
          : null;
      const index =
        Number.isSafeInteger(cursor) && Number.isSafeInteger(scrollOffset)
          ? cursor + scrollOffset
          : null;
      const entries = pocketDefinition
        ? (liveBag?.[pocketDefinition.trainerKey] ?? [])
        : [];
      const selectedEntry = bagContextTask
        ? entries.find(({ itemId }) => itemId === specialItemId) ?? null
        : entries[index] ?? null;
      const contextCursor = bagContextTask && menuBytes ? menuBytes[2] : null;
      let selectedAction = null;
      if (bagContextTask && Number.isSafeInteger(contextCursor)) {
        selectedAction = BAG_CONTEXT_ACTIONS[pocket]?.[contextCursor] ?? null;
        if (
          pocket === 1 &&
          contextCursor === 0 &&
          (specialItemId === ITEM_TM_CASE || specialItemId === ITEM_BERRY_POUCH)
        ) {
          selectedAction = "open";
        }
      }
      bag = {
        stage: bagContextTask ? "context" : "list",
        pocket,
        pocketName: pocketDefinition?.name ?? null,
        index,
        cursor,
        scrollOffset,
        selectedItemId: selectedEntry?.itemId ?? specialItemId,
        selectedQuantity: selectedEntry?.quantity ?? null,
        contextCursor,
        selectedAction,
      };
    } else if ((tmCaseListTask || tmCaseContextTask) && tmCaseStaticBytes) {
      const cursor = u16(tmCaseStaticBytes, 8);
      const scrollOffset = u16(tmCaseStaticBytes, 10);
      const index = cursor + scrollOffset;
      const entries = liveBag?.tmhm ?? [];
      const selectedEntry = tmCaseContextTask
        ? entries.find(({ itemId }) => itemId === specialItemId) ?? null
        : entries[index] ?? null;
      const contextCursor =
        tmCaseContextTask && menuBytes ? menuBytes[2] : null;
      bag = {
        stage: tmCaseContextTask ? "tm-case-context" : "tm-case-list",
        pocket: 3,
        pocketName: "tm-case",
        index,
        cursor,
        scrollOffset,
        selectedItemId: selectedEntry?.itemId ?? specialItemId,
        selectedQuantity: selectedEntry?.quantity ?? null,
        contextCursor,
        selectedAction:
          tmCaseContextTask && Number.isSafeInteger(contextCursor)
            ? (TM_CASE_CONTEXT_ACTIONS[contextCursor] ?? null)
            : null,
      };
    }
    if((berryPouchListTask||berryPouchContextTask)&&berryPouchStaticBytes?.length>=12){
      const cursor=u16(berryPouchStaticBytes,8),scrollOffset=u16(berryPouchStaticBytes,10),index=cursor+scrollOffset;
      const entries=liveBag?.berries??[],selectedEntry=berryPouchContextTask?entries.find(i=>i.itemId===specialItemId):entries[index];
      let actions=[];
      const count=berryOptionsCountBytes?.[0],pointer=berryOptionsPointerBytes?.length>=4?u32(berryOptionsPointerBytes):0;
      if(berryPouchContextTask&&count>0&&count<=4&&pointer>=0x08000000&&pointer+count<=0x0a000000){
        const options=this.#session.readMemory(pointer,count);blocks.set('berry-pouch-context-options',options);
        actions=[...options].map(id=>['use','toss','give','exit'][id]??null);
      }
      const contextCursor=berryPouchContextTask&&menuBytes?menuBytes[2]:null;
      bag={stage:berryPouchContextTask?'berry-pouch-context':'berry-pouch-list',pocket:4,pocketName:'berry-pouch',index,cursor,scrollOffset,
        selectedItemId:selectedEntry?.itemId??specialItemId,selectedQuantity:selectedEntry?.quantity??null,contextCursor,selectedAction:actions[contextCursor]??null,actions};
    }
    if (mode === "bag" && !bag) reasons.push("bag-transition");

    const choosePartyTask = activeTasks.find(
      ({ function: name }) => name === "Task_HandleChooseMonInput",
    );
    const restorePpMoveTask=activeTasks.find(({function:name})=>name==='Task_HandleRestoreWhichMoveInput');
    const partyCursor = partyMenuBytes ? partyMenuBytes[9] : null;
    const partySecondaryCursor = partyMenuBytes ? partyMenuBytes[10] : null;
    const partyAction = partyMenuBytes ? partyMenuBytes[11] : null;
    const partyBagItem = partyMenuBytes ? u16(partyMenuBytes, 12) : null;
    // gSpecialVar_ItemId deliberately outlives the menu that set it. FireRed's
    // gPartyMenu.action is the source of truth for whether this party picker is
    // actually targeting an item; treating the global alone as live state can
    // make an ordinary battle switch look like medicine use indefinitely.
    const partyItemId = [PARTY_ACTION_USE_ITEM, PARTY_ACTION_REUSABLE_ITEM]
      .includes(partyAction)
      ? specialItemId
      : [PARTY_ACTION_GIVE_ITEM, PARTY_ACTION_GIVE_PC_ITEM].includes(partyAction)
        ? partyBagItem
        : null;
    const summaryPartySlot = summaryLastViewedMonBytes?.[0] ?? partyCursor;
    const pokemonSummary =
      callback2 === "CB2_RunPokemonSummaryScreen" &&
      activeTaskNames.has("Task_InputHandler_Info")
        ? {
            stage: "info",
            partySlot: summaryPartySlot,
          }
        : null;
    const levelUpTask = activeTasks.find(({ function: name }) =>
      /Task_(?:DisplayLevelUpStatsPg[12]|TryLearnNewMoves)/.test(name ?? ""),
    );
    const fieldPartyActions =
      mode === "party" && partySelectionActionReady && partyMenuInternalHeader
        ? Array.from(
            partyMenuInternalHeader.slice(
              15,
              15 + Math.min(8, partyMenuInternalHeader[23]),
            ),
            (actionId) => PARTY_CURSOR_ACTIONS[actionId] ?? `action-${actionId}`,
          )
        : null;
    let party = restorePpMoveTask
      ? {stage:'restore-pp-move',cursor:menuBytes?.[2] ?? null,
          selectedPartySlot:partyCursor,...(partyItemId ? {itemId:partyItemId} : {})}
      : partySelectionActionReady
      ? mode === "battle"
        ? {
          stage: "selection-menu",
          cursor: partyCursor,
          selectedPartySlot: partyCursor,
          action: partyAction === PARTY_ACTION_SEND_OUT ? "send-out" : "shift",
          actionCursor: menuBytes?.[2] ?? null,
        }
        : {
          stage: "selection-menu",
          cursor: partyCursor,
          selectedPartySlot: partyCursor,
          action: "field",
          actionCursor: menuBytes?.[2] ?? null,
          ...(fieldPartyActions ? {
            actions: fieldPartyActions,
            selectedAction: fieldPartyActions[menuBytes?.[2]] ?? null,
          } : {}),
        }
      : choosePartyTask
        ? partyAction === PARTY_ACTION_SWITCH
        ? {
            stage: "choose-switch-target",
            cursor: partySecondaryCursor,
            selectedPartySlot: partyCursor,
            action: "switch",
          }
        : {
            stage: "choose-pokemon",
            cursor: partyCursor,
            selectedPartySlot: partyCursor,
            ...(partyItemId ? { itemId: partyItemId } : {}),
          }
        : null;
    const replaceMoveTask = activeTasks.find(
      ({ function: name }) => name === "Task_HandleReplaceMoveYesNoInput",
    );
    // "Stop trying to teach <MOVE>?" after declining the replacement or
    // backing out of the forget-move summary (party_menu.c).
    const stopLearningTask = activeTasks.find(
      ({ function: name }) => name === "Task_HandleStopLearningMoveYesNoInput",
    );
    // The party menu's own prompts belong to gPartyMenu.slotId (the Rare
    // Candy/TM target). sLastViewedMonIndex is only current inside the
    // forget-move summary screen and otherwise keeps an older summary view.
    const partyMoveSlot = callback2 === "CB2_UpdatePartyMenu" &&
      Number.isSafeInteger(partyCursor) ? partyCursor : summaryPartySlot;
    const forgetMoveTask = activeTasks.find(
      ({ function: name }) => name === "Task_InputHandler_SelectOrForgetMove",
    );
    const learnedMoveTask = activeTasks.find(
      ({ function: name }) => name === "Task_LearnNextMoveOrClosePartyMenu",
    );
    const moveTextTask = activeTasks.find(
      ({ function: name }) => name === "Task_PrintAndWaitForText",
    );
    const moveTextStages = Object.freeze({
      Task_ReplaceMoveYesNo: "replace-explanation",
      Task_ShowSummaryScreenToForgetMove: "forget-prompt",
      Task_PartyMenuReplaceMove: "forgot-move",
      Task_DoLearnedMoveFanfareAfterText: "learned-move-message",
    });
    const moveTextOwner = activeTasks.find(
      ({ function: name }) => moveTextStages[name],
    );
    const promptStage = partyPromptStage(activeTasks.map(({ function: name }) => name));
    if (promptStage && !partySelectionActionReady) {
      const cursor = menuBytes?.[2] ?? null;
      party = {
        stage: promptStage,
        cursor,
        selected: cursor === 0 ? "yes" : cursor === 1 ? "no" : null,
        selectedPartySlot: partyCursor,
        ...(partyItemId ? { itemId: partyItemId } : {}),
      };
    }
    if (!party && moveTextTask && partyTextReady && !moveTextOwner) {
      party = {
        stage: "message",
        cursor: partyCursor,
        selectedPartySlot: partyCursor,
        ...(partyItemId ? { itemId: partyItemId } : {}),
      };
    }
    // Easy Chat (Mail writing, and the "?" Mail of a failed GiveMailToMon).
    let easyChat = null;
    if (callback2 === "CB2_EasyChatScreen") {
      const pointerBytes = this.#readSymbol("sEasyChatScreen", blocks);
      const pointer = pointerBytes ? u32(pointerBytes) : 0;
      if (isEwramPointer(pointer, 0x2c)) {
        const screen = this.#session.readMemory(pointer, 0x2c);
        blocks.set("EasyChatScreen", screen);
        const wordsAddress = u32(screen, 0x14);
        const wordBytes = isEwramPointer(wordsAddress, 18) ? this.#session.readMemory(wordsAddress, 18) : null;
        if (wordBytes) blocks.set("EasyChatScreen.words", wordBytes);
        const task = activeTasks.find(({ function: name }) => name === "Task_RunEasyChat");
        easyChat = decodeEasyChatState({
          screen,
          menuCursor: menuBytes?.[2] ?? null,
          taskState: taskData(task, 0),
          fading: paletteFadeActive,
          saveBlock1Pointer: isEwramPointer(save1Pointer, 4) ? save1Pointer : null,
          mailOffset: this.#structures.SaveBlock1?.fields?.mail?.offset ?? null,
          storagePointer: isEwramPointer(pokemonStoragePointer, 4) ? pokemonStoragePointer : null,
          words: wordBytes ? Array.from({ length: 9 }, (_, i) => u16(wordBytes, i * 2)) : null,
        });
      }
      if (!easyChat?.inputReady) reasons.push("easy-chat-transition");
    }
    const learnMoveId = ["battle", "evolution"].includes(mode) && moveToLearnBytes
      ? u16(moveToLearnBytes)
      : partyMenuBytes
        ? i16(partyMenuBytes, 14)
        : null;
    const moveLearningItemId = ["battle", "evolution"].includes(mode)
      ? 0
      : specialItemId;
    let moveLearning = battleMoveLearning ?? evolutionMoveLearning;
    if (moveTextOwner && moveTextTask && partyTextReady) {
      moveLearning = {
        stage: moveTextStages[moveTextOwner.function],
        partySlot: partyMoveSlot,
        moveId: learnMoveId,
        itemId: moveLearningItemId,
        cursor: null,
        selected: null,
      };
    } else if (replaceMoveTask || stopLearningTask) {
      const cursor = menuBytes?.[2] ?? null;
      moveLearning = {
        stage: replaceMoveTask ? "confirm-replace" : "confirm-stop-learning",
        partySlot: partyMoveSlot,
        moveId: learnMoveId,
        itemId: moveLearningItemId,
        cursor,
        selected: cursor === 0 ? "yes" : cursor === 1 ? "no" : null,
      };
    } else if (forgetMoveTask) {
      const ready = summarySelectMoveStateBytes?.[0] === 2;
      const cursor = summaryMoveCursorBytes?.[0] ?? null;
      if (ready) {
        moveLearning = {
          stage: "forget-move",
          partySlot: summaryPartySlot,
          moveId: learnMoveId,
          itemId: moveLearningItemId,
          cursor,
          selected:
            cursor === 4
              ? "cancel"
              : Number.isSafeInteger(cursor)
                ? `move-${cursor + 1}`
                : null,
        };
      } else {
        reasons.push("move-learning-transition");
      }
    } else if (learnedMoveTask && !activeTaskNames.has("Task_Fanfare")) {
      moveLearning = {
        stage: "learned-move",
        partySlot: partyMoveSlot,
        moveId: learnMoveId,
        itemId: moveLearningItemId,
        cursor: summaryMoveSwapCursorBytes?.[0] ?? null,
        selected: null,
      };
    }
    const hasMoveTransitionTask = activeTasks.some(({ function: name }) =>
        /Task_(?:ReplaceMoveYesNo|StopLearningMoveYesNo|ShowSummaryScreenToForgetMove|DoLearnedMoveFanfareAfterText|PartyMenuReplaceMove|ReplaceMoveWithTMHM)/.test(
          name ?? "",
        ),
      );
    if (
      hasMoveTransitionTask &&
      !(moveTextOwner && moveTextTask && partyTextReady)
    ) {
      reasons.push("move-learning-transition");
    }
    let saveDialog = null;
    const startMenuCallback = startMenuCallbackBytes
      ? this.#resolveSymbol(u32(startMenuCallbackBytes))
      : null;
    if (
      mode === "start-menu" &&
      SAVE_MENU_CALLBACKS.has(startMenuCallback) &&
      saveDialogCallbackBytes
    ) {
      // StartMenuSaveCallback/StartCB_Save1 have not initialized sSaveDialogCB
      // yet. Its old success pointer can survive from a previous native save.
      const callback = startMenuCallback === "StartCB_Save2"
        ? this.#resolveSymbol(u32(saveDialogCallbackBytes)) : null;
      const stage = SAVE_DIALOG_STAGES[callback] ?? "initializing";
      const decisionStage =
        stage === "confirm-save" || stage === "confirm-overwrite";
      const cursor = decisionStage && menuBytes ? menuBytes[2] : null;
      const attemptStatus = saveAttemptStatusBytes
        ? u16(saveAttemptStatusBytes)
        : null;
      let attemptResult = null;
      if (stage === "success" || stage === "error") {
        if (attemptStatus === 1) attemptResult = "ok";
        else if (attemptStatus === 0xff) attemptResult = "error";
        else attemptResult = "unknown";
      }
      saveDialog = {
        callback,
        stage,
        printing: Boolean(saveDialogPrintingBytes?.[0]),
        delay: saveDialogDelayBytes?.[0] ?? null,
        cursor,
        selected: cursor === 0 ? "yes" : cursor === 1 ? "no" : null,
        attemptStatus,
        attemptResult,
      };
      if (!SAVE_DIALOG_READY_STAGES.has(stage)) {
        reasons.push("save-dialog-transition");
      }
    }
    const globalStatusValue = globalScriptStatusBytes?.[0] ?? null;
    const globalModeValue = globalScriptContextBytes?.[1] ?? null;
    const globalNative = globalScriptContextBytes
      ? this.#resolveSymbol(u32(globalScriptContextBytes, 4))
      : null;
    const fieldControlsLocked = Boolean(fieldControlsLockedBytes?.[0]);
    const scripts = {
      globalStatus:
        SCRIPT_CONTEXT_STATUSES[globalStatusValue] ??
        (globalStatusValue === null ? null : `unknown-${globalStatusValue}`),
      globalMode:
        SCRIPT_CONTEXT_MODES[globalModeValue] ??
        (globalModeValue === null ? null : `unknown-${globalModeValue}`),
      globalNative,
      fieldControlsLocked,
    };
    const messageBoxTypeValue = messageBoxTypeBytes?.[0] ?? null;
    const messageBoxType =
      FIELD_MESSAGE_TYPES[messageBoxTypeValue] ??
      (messageBoxTypeValue === null ? null : `unknown-${messageBoxTypeValue}`);
    const textPrinter = {
      active: Boolean(textPrintersBytes?.[27]),
      state: textPrintersBytes?.[28] ?? null,
      stateName:
        TEXT_PRINTER_STATES[textPrintersBytes?.[28]] ??
        (textPrintersBytes ? `unknown-${textPrintersBytes[28]}` : null),
    };
    const fishingTask = activeTasks.find(({ function: name }) => name === "Task_Fishing");
    const fishingStep = taskData(fishingTask, 0);
    // Stock FireRed's Fishing11 and Fishing16 run printer window 0 while
    // retaining the field lock. Fishing7 jumps directly to the on-hook text;
    // its unused reel-input state is not a live bite-timing prompt.
    const fishingMessageReady = mode === "overworld" && [10, 15].includes(fishingStep) &&
      textPrinter.active && TEXT_PRINTER_READY_STATES.has(textPrinter.state);
    const messageVisible =
      mode !== "battle" &&
      (messageBoxType === "normal" || messageBoxType === "auto-scroll");
    const awaitingClose =
      messageBoxType === "hidden" &&
      mode === "overworld" &&
      fieldControlsLocked &&
      globalNative === "WaitForAorBPress" &&
      !storage;
    let fieldDialog = null;
    let fieldDialogReady = false;
    if (messageVisible) {
      fieldDialogReady =
        textPrinter.active && TEXT_PRINTER_READY_STATES.has(textPrinter.state);
      fieldDialog = {
        type: messageBoxType,
        stage: fieldDialogReady ? "awaiting-page" : "printing",
        textPrinter,
      };
      if (!fieldDialogReady) reasons.push("field-dialog-transition");
    } else if (taskFieldMessageReady || fishingMessageReady) {
      fieldDialogReady = true;
      fieldDialog = {
        type: "task-message",
        stage: "awaiting-page",
        textPrinter,
        ...(fishingMessageReady ? { task: "Task_Fishing", taskState: fishingStep } : {}),
      };
    } else if (awaitingClose) {
      fieldDialogReady = true;
      fieldDialog = {
        type: messageBoxType,
        stage: "awaiting-close",
        textPrinter,
      };
    }
    if (
      mode === "overworld" &&
      fieldControlsLocked &&
      !fieldDialogReady &&
      !messageVisible &&
      !fieldChoiceMenuReady &&
      !blackoutReady &&
      !storage
    ) {
      reasons.push("script-lock");
    }
    const avatarFields = this.#structures.PlayerAvatar?.fields ?? {};
    const tileOffset = avatarFields.tileTransitionState?.offset ?? 3;
    const tileTransitionState = avatar[tileOffset];
    const objectEventIdOffset = avatarFields.objectEventId?.offset ?? 5;
    const objectEventId = avatar[objectEventIdOffset];
    const avatarFlags = avatar[avatarFields.flags?.offset ?? 0];
    let avatarState = {
      flags: avatarFlags,
      onFoot: Boolean(avatarFlags & (1 << 0)),
      surfing: Boolean(avatarFlags & (1 << 3)),
      objectEventId,
      facing: null,
      movementDirection: null,
    };
    const objectEventSize = objectEvents?.length / 16;
    if (
      Number.isSafeInteger(objectEventSize) &&
      objectEventSize >= 25 &&
      objectEventId < 16
    ) {
      const directionByte = objectEvents[objectEventId * objectEventSize + 24];
      const facingValue = directionByte & 0x0f;
      const movementValue = directionByte >>> 4;
      avatarState = {
        flags: avatarFlags,
        onFoot: Boolean(avatarFlags & (1 << 0)),
        surfing: Boolean(avatarFlags & (1 << 3)),
        objectEventId,
        facing: DIRECTIONS[facingValue] ?? `unknown-${facingValue}`,
        movementDirection:
          DIRECTIONS[movementValue] ?? `unknown-${movementValue}`,
      };
    }
    const liveObjectEvents = decodeLiveObjectEvents(objectEvents, objectEventId);
    if (
      activeTasks.some(
        ({ function: name }) =>
          TRANSIENT_TASK.test(name ?? "") &&
          name !== "Task_ScriptShowMonPic" &&
          !(psaMessageReady && name === "Task_ForgetMove") &&
          !(newGameReadyTask && name === newGameReadyTask.function),
      )
    ) {
      reasons.push("transient-task");
    }
    if (
      TRANSIENT_CALLBACK.test(callback2 ?? "") &&
      !psaMessageReady &&
      !newGameReadyTask
    ) {
      reasons.push("transient-callback");
    }

    let position = null;
    let map = null;
    let townMap = null;
    let storyState = null;
    let gameStats = null;
    let trainer = null;
    let mail = null;
    let vsSeeker = null;
    let mapGrid = null;
    let objectEventTemplates = [];
    if (save1) {
      const save1Fields = this.#structures.SaveBlock1.fields ?? {};
      const posOffset = save1Fields.pos?.offset ?? 0;
      const locationOffset = save1Fields.location?.offset ?? 4;
      position = { x: i16(save1, posOffset), y: i16(save1, posOffset + 2) };
      const group = save1[locationOffset];
      const number = save1[locationOffset + 1];
      map = { group, number, id: this.#resolveMap(group, number) };
      const sourceMap = this.#maps.get(map.id);
      townMap = readTownMapPosition({map:sourceMap,position,save:save1,fields:save1Fields,
        resolveMap:(group,number)=>this.#maps.get(this.#resolveMap(group,number))});
      mapGrid = decodeLiveMapGrid(
        virtualMapBytes,
        liveMapBytes,
        sourceMap,
        this.#tileAttributes,
        this.#behaviorNames,
      );
      objectEventTemplates = decodeCurrentMapObjectEventTemplates(
        save1,
        save1Fields.objectEventTemplates,
        sourceMap?.objectEvents?.length,
      );
      storyState = this.#decodeStoryState(
        map.id,
        save1,
        this.#structures.SaveBlock1.fields ?? {},
      );
      if (Object.keys(specialVariables).length) {
        storyState.variableIds = {...storyState.variableIds, ...specialVariables};
      }
      const badgeOffset=save1Fields.flags?.offset;
      const badge=id=>Number.isSafeInteger(badgeOffset)&&badgeOffset+Math.floor(id/8)<save1.length?Boolean(save1[badgeOffset+Math.floor(id/8)]&(1<<(id%8))):false;
      for(const pokemon of decodedBattleMons.filter(Boolean)){
        const applies=(pokemon.battler&1)===0&&!(pokemon.battleFlags&((1<<1)|(1<<11)));
        pokemon.badgeBoosts={attack:applies&&badge(0x820),defense:applies&&badge(0x824),spAttack:applies&&badge(0x826),spDefense:applies&&badge(0x826),speed:applies&&badge(0x822)};
      }
      vsSeeker = decodeVsSeeker(save1, save1Fields);
      const gameStatsOffset = save1Fields.gameStats?.offset;
      const encryptionKeyOffset =
        this.#structures.SaveBlock2?.fields?.encryptionKey?.offset;
      if (
        save2 &&
        Number.isSafeInteger(gameStatsOffset) &&
        gameStatsOffset >= 0 &&
        gameStatsOffset + 4 <= save1.length &&
        Number.isSafeInteger(encryptionKeyOffset) &&
        encryptionKeyOffset >= 0 &&
        encryptionKeyOffset + 4 <= save2.length
      ) {
        gameStats = decodeGameCounters(save1,gameStatsOffset,u32(save2,encryptionKeyOffset));
      }
      const encryptionKey =
        save2 && Number.isSafeInteger(encryptionKeyOffset)
          ? u32(save2, encryptionKeyOffset)
          : null;
      const moneyOffset = save1Fields.money?.offset;
      const party = playerPartyBytes
        ? Array.from({ length: 6 }, (_, slot) =>
            decodePartyPokemon(
              playerPartyBytes,
              slot * PARTY_POKEMON_BYTES,
              slot,
            ),
          ).filter(Boolean).map(this.#partyDisplay)
        : [];
      const partyCount = party.length;
      const pokedex = decodePokedex(
        save2,
        this.#structures.SaveBlock2?.fields?.pokedex,
      );
      const storagePokemon = decodePokemonStorage(pokemonStorageBytes);
      mail = decodeMailState({ save1, mailOffset: save1Fields.mail?.offset, partyBytes: playerPartyBytes,
        party, storageBytes: pokemonStorageBytes });
      const playTime = decodePlayTime(
        save2,
        this.#structures.SaveBlock2?.fields,
      );
      trainer = {
        playerName,
        rivalName,
        gender: playerGender,
        ...(save2 && Number.isSafeInteger(this.#structures.SaveBlock2?.fields?.playerTrainerId?.offset) &&
          this.#structures.SaveBlock2.fields.playerTrainerId.offset + 4 <= save2.length ? {
            otId: u32(save2, this.#structures.SaveBlock2.fields.playerTrainerId.offset),
            trainerId: u16(save2, this.#structures.SaveBlock2.fields.playerTrainerId.offset),
            secretId: u16(save2, this.#structures.SaveBlock2.fields.playerTrainerId.offset + 2),
          } : {}),
        money:
          encryptionKey !== null &&
          Number.isSafeInteger(moneyOffset) &&
          moneyOffset + 4 <= save1.length
            ? (u32(save1, moneyOffset) ^ encryptionKey) >>> 0
            : null,
        bag:
          encryptionKey === null
            ? null
            : decodeBag(save1, save1Fields, encryptionKey),
        partyCount,
        party,
        partyValidity: playerPartyBytes?.length >= 600 && Array.from({ length: 6 }, (_, slot) =>
          decodeBoxPokemonRecord(playerPartyBytes, slot * PARTY_POKEMON_BYTES).validity
        ).every((validity) => validity !== "unknown") ? "valid" : "unknown",
        usablePartyCount: party.filter(({ hp }) => hp > 0).length,
        ...(playTime ? { playTime } : {}),
        ...(pokedex ? { pokedex } : {}),
        ...(storagePokemon ? { storage: storagePokemon } : {}),
      };
    }
    const sourceMap = this.#maps.get(map?.id);
    const mapCells = mapGrid?.cells ?? sourceMap?.layout?.cells ?? [];
    const currentCell = mapCells.find(({ x, y }) =>
      Number(x) === Number(position?.x) && Number(y) === Number(position?.y)
    );
    const movementDelta = DIRECTION_DELTAS[avatarState.movementDirection];
    const nextCell = movementDelta
      ? mapCells.find(({ x, y }) =>
          Number(x) === Number(position?.x) + movementDelta.x &&
          Number(y) === Number(position?.y) + movementDelta.y
        )
      : null;
    const nextCellOccupied = movementDelta
      ? liveObjectEvents.some(({ player, current }) =>
          !player &&
          Number(current?.x) === Number(position?.x) + movementDelta.x &&
          Number(current?.y) === Number(position?.y) + movementDelta.y
        )
      : false;
    const currentElevation = Number(currentCell?.elevation);
    const nextElevation = Number(nextCell?.elevation);
    const nextCollision = Number(nextCell?.collision);
    const nextCellCollisionBlocked =
      Number.isFinite(nextCollision) && nextCollision !== 0;
    const nextCellElevationBlocked =
      Number.isFinite(currentElevation) && currentElevation > 0 &&
      Number.isFinite(nextElevation) && nextElevation > 0 &&
      currentElevation !== 15 && nextElevation !== 15 &&
      currentElevation !== nextElevation;
    const blockedCyclingRoadTileCenter =
      tileTransitionState === 2 &&
      (avatarFlags & BICYCLE_AVATAR_FLAGS) !== 0 &&
      CYCLING_ROAD_SLOPE_BEHAVIORS.has(currentCell?.behaviorName) &&
      (nextCellCollisionBlocked || nextCellElevationBlocked || nextCellOccupied);
    if (
      mode === "overworld" &&
      tileTransitionState !== 0 &&
      !blockedCyclingRoadTileCenter &&
      !fieldDialogReady &&
      !fieldChoiceMenuReady &&
      !storage
    ) {
      reasons.push("tile-transition");
    }
    const evolvedPokemon = trainer?.party?.[partyCursor] ?? null;
    const levelUpPokemon = trainer?.party?.[partyCursor] ?? null;
    const levelUp = levelUpTask
      ? {
          stage:
            levelUpTask.function === "Task_DisplayLevelUpStatsPg1"
              ? "stats-page-1"
              : levelUpTask.function === "Task_DisplayLevelUpStatsPg2"
                ? "stats-page-2"
                : "move-check",
          partySlot: partyCursor,
          species: levelUpPokemon?.species ?? null,
          level: levelUpPokemon?.level ?? null,
        }
      : null;
    const evolution = evolutionReady && !evolutionMoveLearning
      ? {
          stage: "complete-message",
          evolvedPartySlot: partyCursor,
          species: evolvedPokemon?.species ?? null,
          level: evolvedPokemon?.level ?? null,
        }
      : null;
    const observedParty = party
      ? {
          ...party,
          menuType: partyMenuBytes ? partyMenuBytes[8] & 0xf : null,
          actionId: partyAction,
          cursorPokemon: Number.isSafeInteger(party.cursor)
            ? (trainer?.party?.[party.cursor] ?? null)
            : null,
        }
      : null;
    // CB2_UpdatePartyMenu remains active while FireRed animates a party-order
    // swap, but none of the menu input tasks exist during those frames.  Treat
    // that opaque interval like every other modal transition so the player
    // waits for an actually actionable party surface instead of pressing into
    // the animation.
    if (
      mode === "party" &&
      !observedParty &&
      !pokemonSummary &&
      !moveLearning &&
      !levelUp &&
      !specialAnimation
    ) {
      reasons.push("party-transition");
    }
    if (mode === "fly-map" && !flyMap) {
      reasons.push("fly-map-transition");
    }

    const signature = JSON.stringify({
      callback1Address,
      callback2Address,
      mapGroup: map?.group,
      mapNumber: map?.number,
    });
    if (this.#previousSignature && signature !== this.#previousSignature) {
      reasons.push("callback-change");
    }
    this.#previousSignature = signature;

    const fieldHeap = ["overworld", "start-menu", "storage"].includes(mode)
      ? readFieldHeap(this.#session, this.#symbols, blocks) : null;
    const memoryDigest = digestBlocks(blocks);
    const sramSha256 = sha256([sramBytes]);
    let phase = "stable";
    if (
      reasons.includes("save-block-1-pointer") ||
      reasons.includes("save-block-2-pointer") ||
      reasons.includes("callback-2-pointer")
    ) {
      phase = "unknown";
    } else if (reasons.length > 0) {
      phase = "transition";
    }

    this.#ordinal += 1;
    const captureId = `${this.#runId}:${this.#ordinal}:${startFrame}:${memoryDigest.sha256.slice(0, 12)}`;
    const shared = { captureId, frame: startFrame };
    return deepFreeze({
      ...shared,
      phase,
      phaseReasons: [...new Set(reasons)].sort(),
      emulator: {
        ...shared,
        platform: this.#session.platform,
        identity: this.#session.identity,
        callback1,
        callback1Address,
        callback2,
        callback2Address,
        mainState,
        inBattle,
        input,
        inputReady,
        paletteFadeActive,
        mode,
      },
      sram: {
        ...shared,
        bytes: sramBytes.length,
        sha256: sramSha256,
      },
      playerMemory: {
        ...shared,
        sha256: memoryDigest.sha256,
        blocks: memoryDigest.blocks,
        saveBlock1Pointer: save1Pointer,
        saveBlock2Pointer: save2Pointer,
        saveFileStatus: saveFileStatusBytes ? u16(saveFileStatusBytes) : null,
        saveAttemptStatus: saveAttemptStatusBytes
          ? u16(saveAttemptStatusBytes)
          : null,
        position,
        map,
        mapGrid,
        ...(townMap ? {townMap} : {}),
        storyState,
        gameStats,
        ...(fieldHeap ? { fieldHeap } : {}),
        trainer,
        ...(mail ? { mail } : {}),
        ...(vsSeeker ? { vsSeeker } : {}),
        avatar: avatarState,
        objectEvents: liveObjectEvents,
        objectEventTemplates,
        tileTransitionState,
        battleTypeFlags: battleFlagsBytes ? u32(battleFlagsBytes) : null,
        battleExecutionFlags: battleControllerExecFlagsBytes
          ? u32(battleControllerExecFlagsBytes)
          : null,
        activeBattler: activeBattlerBytes?.[0] ?? null,
        battleMenuBattler: battleMenuBattlerBytes?.[0] ?? null,
        battleOutcome: battleOutcomeBytes?.[0] ?? null,
        battleScripting: battleScriptingBytes
          ? { drawLevelUpBoxState, learnMoveState }
          : null,
        battle: battleState,
        encounter,
        questLog,
        ...(this.#observeRng ? { rng: rngBytes?.length === 4 && wildRngBytes?.length === 12
          ? { validity: "valid", mainState: u32(rngBytes), wildState: u32(wildRngBytes),
              previousMetatileBehavior: u16(wildRngBytes, 4), encounterRateBuff: u16(wildRngBytes, 6),
              stepsSinceLastEncounter: wildRngBytes[8], abilityEffect: wildRngBytes[9],
              leadMonHeldItem: u16(wildRngBytes, 10) }
          : { validity: "unknown", reason: "missing-rng-symbols" } } : {}),
        battlerInputFunctions: battleControllerFunctions,
        activeTasks,
        scripts,
        ui: {
          mainMenu,
          startMenu,
          flyMap,
          saveDialog,
          fieldDialog,
          choiceMenu,
          mart,
          storage,
          bag,
          party: observedParty,
          pokemonSummary,
          moveLearning,
          levelUp,
          specialAnimation,
          inGameTrade,
          evolution,
          blackout,
          battle,
          pokedexRegistration,
          newGame,
          naming,
          easyChat,
        },
      },
    });
  }
}

export function createFireRedObserver(options) {
  return new FireRedObserver(options);
}
