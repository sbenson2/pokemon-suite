// Fresh-cartridge opening for Pokémon Emerald: title → main menu → Birch
// speech → gender → name → CB2_NewGame, plus the Route 101 starter picker.
// Every menu press is state-driven and re-pressed while the state persists,
// so a press swallowed by a fade is never a one-shot stall. Source:
// src/main_menu.c, src/starter_choose.c, src/naming_screen.c at 5eff786.
import { EMERALD_ADDRESS_MANIFEST } from './addresses.mjs';

const SAVE_BLOCK_1_FLAGS_OFFSET = 0x1270;
const SAVE_BLOCK_1_VARS_OFFSET = 0x139c;
const VARS_START = 0x4000;
const VAR_STARTER_MON = 0x4023;
const VAR_ROUTE101_STATE = 0x4060;
const VAR_BIRCH_LAB_STATE = 0x4084;
const FLAG_RESCUED_BIRCH = 0x52;
const FLAG_SYS_POKEMON_GET = 0x860;

function bytes(readMemory, address, length) {
  const result = readMemory(address, length);
  if (!(result instanceof Uint8Array) || result.length < length) throw new RangeError(`cannot read ${length} bytes at 0x${address.toString(16)}`);
  return result;
}
function u16(value, offset = 0) { return value[offset] | (value[offset + 1] << 8); }
function u32(value, offset = 0) { return (value[offset] | (value[offset + 1] << 8) | (value[offset + 2] << 16) | (value[offset + 3] << 24)) >>> 0; }
function flagIsSet(saveBlock1, flag) { return (saveBlock1[SAVE_BLOCK_1_FLAGS_OFFSET + (flag >> 3)] & (1 << (flag & 7))) !== 0; }
function variable(saveBlock1, id) { return u16(saveBlock1, SAVE_BLOCK_1_VARS_OFFSET + ((id - VARS_START) * 2)); }

export function validateTickets({ genderTicket, starterTicket }) {
  if (genderTicket !== 0 && genderTicket !== 1) throw new RangeError('genderTicket must be an unbiased binary ticket (0 or 1)');
  if (!Number.isInteger(starterTicket) || starterTicket < 0 || starterTicket > 2) throw new RangeError('starterTicket must be an unbiased ternary ticket (0, 1, or 2)');
}

/** Reads only non-encrypted SaveBlock and party-count fields. */
export function readFreshOpeningProgress(readMemory, manifest) {
  if (typeof readMemory !== 'function') throw new TypeError('readMemory must be a function');
  const saveBlock1Pointer = u32(bytes(readMemory, manifest.gSaveBlock1Ptr, 4));
  const saveBlock2Pointer = u32(bytes(readMemory, manifest.gSaveBlock2Ptr, 4));
  if (saveBlock1Pointer === 0 || saveBlock2Pointer === 0) return null;
  const saveBlock1 = bytes(readMemory, saveBlock1Pointer, SAVE_BLOCK_1_VARS_OFFSET + ((VAR_BIRCH_LAB_STATE - VARS_START + 1) * 2));
  const saveBlock2 = bytes(readMemory, saveBlock2Pointer, 9);
  const main = bytes(readMemory, manifest.gMain, 8);
  const partyCount = bytes(readMemory, manifest.gPlayerPartyCount, 1)[0];
  return Object.freeze({
    callback2: u32(main, 4),
    playerGender: saveBlock2[8] === 1 ? 'FEMALE' : 'MALE',
    partyCount,
    map: Object.freeze({ group: saveBlock1[4], number: saveBlock1[5] }),
    route101State: variable(saveBlock1, VAR_ROUTE101_STATE),
    birchLabState: variable(saveBlock1, VAR_BIRCH_LAB_STATE),
    starterTicket: variable(saveBlock1, VAR_STARTER_MON),
    rescuedBirch: flagIsSet(saveBlock1, FLAG_RESCUED_BIRCH),
    pokemonObtained: flagIsSet(saveBlock1, FLAG_SYS_POKEMON_GET),
  });
}

/** The field proof used after native input selection; no party decryption. */
export function isStarterSelectionStable(progress, tickets) {
  if (!progress) return false;
  validateTickets(tickets);
  return progress.playerGender === (tickets.genderTicket === 0 ? 'MALE' : 'FEMALE')
    && progress.starterTicket === tickets.starterTicket
    && progress.partyCount === 1
    && progress.rescuedBirch
    && progress.pokemonObtained;
}

function hasTask(snapshot, address) {
  return snapshot.taskFunctions?.includes(address | 1) === true;
}

/**
 * State-driven planner for the game's own title, main-menu, gender, and
 * naming screens. Presses repeat every `repeatFrames` while the same screen
 * stays observable, and every press is followed by one released frame so the
 * cartridge sees a fresh JOY_NEW edge.
 */
export function createFreshOpeningInputPlanner(tickets, manifest = EMERALD_ADDRESS_MANIFEST, { repeatFrames = 24 } = {}) {
  validateTickets(tickets);
  let frame = 0;
  let releaseNext = false;
  const lastPress = new Map();
  let downPresses = 0;
  let namingPhase = 0;
  const press = (state, button, interval = repeatFrames) => {
    const last = lastPress.get(state);
    if (last !== undefined && frame - last < interval) return Object.freeze([]);
    lastPress.set(state, frame);
    releaseNext = true;
    return Object.freeze([button]);
  };
  return Object.freeze({
    get phase() { return namingPhase; },
    buttonsFor(snapshot) {
      frame += 1;
      if (releaseNext) { releaseNext = false; return Object.freeze([]); }
      if (hasTask(snapshot, manifest.Task_TitleScreenPhase3)) return press('title', 'start');
      if (snapshot.callback2 === (manifest.CB2_MainMenu | 1) && hasTask(snapshot, manifest.Task_HandleMainMenuInput)) {
        if (snapshot.mainMenu?.type > 0 && snapshot.mainMenu.item === 0) return press('main-menu-down', 'down');
        return press('main-menu', 'a');
      }
      if (hasTask(snapshot, manifest.Task_NewGameBirchSpeech_ChooseGender)) {
        if (tickets.genderTicket === 1 && downPresses < 2) {
          const result = press('gender-down', 'down');
          if (result.length) downPresses += 1;
          return result;
        }
        if (tickets.genderTicket === 1 && frame - lastPress.get('gender-down') < repeatFrames) return Object.freeze([]);
        return press('gender', 'a');
      }
      if (snapshot.callback2 === (manifest.CB2_NamingScreen | 1)) {
        // Alternate START (jump to OK) and A (confirm) until the screen exits.
        const button = namingPhase % 2 === 0 ? 'start' : 'a';
        const result = press('naming', button, 30);
        if (result.length) namingPhase += 1;
        return result;
      }
      if (hasTask(snapshot, manifest.Task_NewGameBirchSpeech_ProcessNameYesNoMenu)) return press('name-yes', 'a');
      if (snapshot.callback2 === (manifest.CB2_ChooseStarter | 1)) {
        if (hasTask(snapshot, manifest.Task_HandleConfirmStarterInput)) return press('starter-confirm', 'a');
        if (hasTask(snapshot, manifest.Task_HandleStarterChooseInput)) {
          if (tickets.starterTicket !== 1) {
            const direction = tickets.starterTicket === 0 ? 'left' : 'right';
            const moved = lastPress.get('starter-move');
            if (moved === undefined || (frame - moved) < repeatFrames * 2 && !lastPress.has('starter-select')) {
              if (moved === undefined) return press('starter-move', direction);
              return Object.freeze([]);
            }
          }
          return press('starter-select', 'a');
        }
        return Object.freeze([]);
      }
      if (snapshot.callback2 !== (manifest.CB2_Overworld | 1) && snapshot.callback2 !== (manifest.CB2_NewGame | 1)) {
        // Birch's speech and other one-button text screens advance on A.
        return press('speech', 'a');
      }
      return Object.freeze([]);
    },
  });
}

export const OPENING_SOURCE_EVIDENCE = Object.freeze({
  sourceCommit: '5eff78649e7170a877b961ef0b3da13b81a16038',
  saveLayouts: 'include/global.h: SaveBlock1.flags@0x1270, SaveBlock1.vars@0x139c, SaveBlock2.playerGender@0x8',
  starterTicket: 'include/constants/vars.h: VAR_STARTER_MON 0x4023 (0=Treecko, 1=Torchic, 2=Mudkip)',
  preSelectionFlags: 'data/maps/Route101/scripts.inc: Route101_EventScript_BirchsBag sets FLAG_SYS_POKEMON_GET and FLAG_RESCUED_BIRCH before special ChooseStarter',
  assignment: 'src/battle_setup.c: CB2_GiveStarter stores gSpecialVar_Result in VAR_STARTER_MON and calls ScriptGiveMon',
  menus: 'src/main_menu.c Task_HandleMainMenuInput (JOY_NEW A), Task_NewGameBirchSpeech_ChooseGender (DPAD no wrap), src/starter_choose.c Task_HandleStarterChooseInput (cursor starts at 1, no wrap)',
});
