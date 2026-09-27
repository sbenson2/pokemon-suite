// Game options policy (reform P0-3). Text speed FAST, battle animations OFF
// and battle style SHIFT cut the wall time of every text box and battle at
// any emulation speed; MENU ACCOUNT OFF removes the START-menu descriptions.
// Source: engine/menus/options_menu.asm and constants/ram_constants.asm
// (wOptions: TEXT_DELAY bits 0-2 FAST=1/MED=3/SLOW=5, BATTLE_SHIFT bit 6
// set = SET, BATTLE_SCENE bit 7 set = OFF; wOptions2: MENU_ACCOUNT bit 0).

import { holdFrames, press } from './locomotion.mjs';
import { closeMenus, openStartMenu, FieldMenuError } from './field.mjs';
import { screenContains } from '../observer.mjs';

export const DESIRED_OPTIONS = Object.freeze({ textSpeed: 'FAST', battleScene: 'OFF', battleStyle: 'SHIFT', menuAccount: 'OFF' });

const TEXT_DELAY = Object.freeze({ 1: 'FAST', 3: 'MID', 5: 'SLOW' });
const OPTION_ROWS = Object.freeze([
  ['textSpeed', 'TEXT SPEED'],
  ['battleScene', 'BATTLE SCENE'],
  ['battleStyle', 'BATTLE STYLE'],
  ['menuAccount', 'MENU ACCOUNT'],
]);

export function decodeOptions(options, options2 = 0) {
  return Object.freeze({
    textSpeed: TEXT_DELAY[options & 0x07] ?? 'MID',
    battleScene: options & 0x80 ? 'OFF' : 'ON',
    battleStyle: options & 0x40 ? 'SET' : 'SHIFT',
    menuAccount: options2 & 0x01 ? 'ON' : 'OFF',
    raw: { options, options2 },
  });
}

export function currentOptions(observation) {
  return decodeOptions(observation.options ?? 0, observation.options2 ?? 0);
}

export function optionsSatisfied(observation, desired = DESIRED_OPTIONS) {
  const current = currentOptions(observation);
  return Object.entries(desired).every(([key, value]) => current[key] === value);
}

export const optionsScreenVisible = (observation) => screenContains(observation, 'TEXT SPEED') && screenContains(observation, 'CANCEL');

const cursorRowIndex = (observation) => observation.screen.findIndex((row) => row.includes('▶'));
const rowIndexOf = (observation, label) => observation.screen.findIndex((row) => row.includes(label));
// The value row reads "│         :MID     │": take the text between the colon and the box border.
const valueOnRow = (observation, index) => ((observation.screen[index + 1] ?? '').split(':')[1] ?? '').replace(/│.*$/, '').trim();

function* tap(button, settle = 10) {
  yield* press(button);
  yield* holdFrames([], settle);
}

function* moveCursorToRow(observe, label, { budget = 20 } = {}) {
  for (let attempt = 0; attempt < budget; attempt += 1) {
    const observation = observe();
    const target = rowIndexOf(observation, label);
    const current = cursorRowIndex(observation);
    if (target < 0) throw new FieldMenuError(`option ${label} is not on screen`);
    if (target === current) return observation;
    yield* tap(target < current ? 'up' : 'down', 8);
  }
  throw new FieldMenuError(`option ${label} cursor not reached`);
}

/**
 * Opens START → OPTION and cycles each option with Right until the screen
 * shows the desired value, then leaves through CANCEL. Verified by reading
 * wOptions/wOptions2 afterwards. Returns { changed, before, after }.
 */
export function* ensureGameOptions(observe, { desired = DESIRED_OPTIONS, onPrompt = null } = {}) {
  const before = currentOptions(observe());
  if (optionsSatisfied(observe(), desired)) return { changed: false, before, after: before };
  yield* closeMenus(observe);
  yield* openStartMenu(observe, 'OPTION');
  yield* tap('a', 30);
  if (!optionsScreenVisible(observe())) throw new FieldMenuError('OPTION screen did not open');
  for (const [key, label] of OPTION_ROWS) {
    const wanted = desired[key];
    if (!wanted) continue;
    let observation = yield* moveCursorToRow(observe, label);
    for (let cycle = 0; cycle < 4 && valueOnRow(observation, rowIndexOf(observation, label)) !== wanted; cycle += 1) {
      yield* tap('right', 10);
      observation = observe();
    }
    if (valueOnRow(observation, rowIndexOf(observation, label)) !== wanted) {
      throw new FieldMenuError(`${label} did not reach ${wanted} (shows ${valueOnRow(observation, rowIndexOf(observation, label))})`);
    }
  }
  yield* moveCursorToRow(observe, 'CANCEL');
  onPrompt?.('CANCEL', observe());
  yield* tap('a', 30);
  yield* closeMenus(observe);
  yield* holdFrames([], 10);
  const after = currentOptions(observe());
  if (!optionsSatisfied(observe(), desired)) throw new FieldMenuError(`options not applied: ${JSON.stringify(after)}`);
  return { changed: true, before, after };
}
