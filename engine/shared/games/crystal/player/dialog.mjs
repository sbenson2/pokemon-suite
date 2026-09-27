// Script and menu handling edges. Crystal scripts (wScriptRunning) print text,
// wait for A, and open YES/NO menus. The policy answers YES by default and NO
// to nickname prompts; every other on-screen prompt is acknowledged with A.

import { holdFrames, press } from './locomotion.mjs';
import { screenContains } from '../observer.mjs';

export class DialogError extends Error {
  constructor(message) {
    super(message);
    this.name = 'DialogError';
  }
}

// Prompts answered NO: nicknames, giving up a move, any purchase offer (the
// Slowpoke Tail seller on Route 32 asks for ¥1,000,000), Pokégear number
// registration (every trainer's AskNumber text asks for the "phone number" or
// "your number"; registered numbers call back and stall dialog), and Mom's
// offer to hold the player's money (engine/events/mom.asm).
const NO_PROMPTS = Object.freeze(['nickname', 'NICKNAME', 'Stop learning', 'buy it', 'Buy it', 'want it', '¥', 'phone number', 'your number', 'save your money', 'save some money']);

// Three-option script menus with a known right answer: the Dragon Shrine
// elder's quiz (maps/DragonShrine.asm: answers 1/3, 1/2, 2/3, 1/3, 2 are right).
export const MENU_ANSWERS = Object.freeze([
  { options: ['Pal', 'Underling', 'Friend'], pick: 'Friend' },
  { options: ['Strategy', 'Raising', 'Cheating'], pick: 'Raising' },
  { options: ['Weak person', 'Tough person', 'Anybody'], pick: 'Anybody' },
  { options: ['Love', 'Violence', 'Knowledge'], pick: 'Knowledge' },
  { options: ['Tough', 'Both', 'Weak'], pick: 'Both' },
]);

/** The screen row of the wanted option and the row holding the cursor, when a known multi-choice menu is open. */
export function menuChoice(observation) {
  for (const entry of MENU_ANSWERS) {
    const rows = entry.options.map((option) => observation.screen.findIndex((row) => row.includes(option)));
    if (rows.some((row) => row < 0)) continue;
    const wanted = observation.screen.findIndex((row) => row.includes(entry.pick));
    const current = observation.screen.findIndex((row) => row.includes('▶'));
    return { wanted, current, pick: entry.pick };
  }
  return null;
}

export function chooseYesNo(observation, { preferNo = NO_PROMPTS } = {}) {
  return preferNo.some((text) => screenContains(observation, text)) ? 'NO' : 'YES';
}

/**
 * The naming screen (engine/menus/naming_screen.asm) asks "RIVAL'S NAME?"
 * after the egg is delivered; START jumps the cursor to END and A confirms,
 * which keeps the default name. B would only delete letters forever.
 */
export const namingScreenVisible = (observation) => screenContains(observation, 'NAME?') && screenContains(observation, 'END') && screenContains(observation, 'DEL');

/** START menu (POKéDEX/POKéMON/PACK/…/EXIT) drawn on screen. */
export const startMenuVisible = (observation) => screenContains(observation, 'PACK') && screenContains(observation, 'EXIT');
/**
 * The pack frame: a header row of graphic tiles (decoded as ·) and the pocket
 * icon column whose tiles decode as the PC/TM/TRAINER/ROCKET charmap tokens.
 * The TM/HM pocket lists CANCEL only when scrolled to its end, so the frame,
 * not the CANCEL entry, proves the pack is open.
 */
export const packFrameVisible = (observation) => (
  (observation.screen[0] ?? '') === '·'.repeat(20) && (observation.screen[5] ?? '').startsWith('·PCTMTRAINERROCKET')
);
/** A pack pocket or another CANCEL-terminated list is drawn on screen. */
export const packVisible = (observation) => (
  !startMenuVisible(observation) && (packFrameVisible(observation) || screenContains(observation, 'CANCEL'))
);

/**
 * True when a YES/NO menu is drawn on screen. wMenuDataItems is a reused
 * buffer (it keeps stale battle values), so the screen is the authority.
 */
export function yesNoMenuOpen(observation) {
  // The box is drawn as "│▶YES│" / "│ NO │" (borders may touch the words).
  const rows = observation.screen;
  const yesRow = rows.findIndex((row) => /(▶|\s)YES(\s|│|$)/.test(row));
  if (yesRow < 0) return false;
  const noRow = rows.findIndex((row, index) => index > yesRow && /(▶|\s)NO(\s|│|$)/.test(row));
  return noRow === yesRow + 1 || noRow === yesRow + 2;
}

/**
 * True when the bottom text box is drawn: its frame occupies rows 12 and 17
 * (┌───┐ / └───┘, possibly with the ▼ prompt). Map tilesets reuse the box
 * glyph ids (Goldenrod Gym walls decode as │), so single glyphs are not proof.
 */
export function textboxOpen(observation) {
  const top = observation.screen[12] ?? '';
  const bottom = observation.screen[17] ?? '';
  return /^┌─{18}┐$/.test(top) && /^└─{17}[─▼]┘$/.test(bottom);
}

/** Row (1 or 2) currently highlighted in an open YES/NO menu, from the drawn cursor. */
export function yesNoCursorRow(observation) {
  const yesRow = observation.screen.findIndex((row) => /YES(\s|│|$)/.test(row));
  if (yesRow >= 0 && observation.screen[yesRow].includes('▶')) return 1;
  const noRow = observation.screen.findIndex((row, index) => index > yesRow && /NO(\s|│|$)/.test(row));
  if (noRow >= 0 && observation.screen[noRow].includes('▶')) return 2;
  return observation.menu.cursorY === 2 ? 2 : 1;
}

/**
 * Advances an active script until the cartridge reports no running script and
 * no open menu. Returns the number of presses used and the final observation.
 */
export function* advanceScript(observe, { budget = 6_000, quietFrames = 12, choose = chooseYesNo, onPrompt = null } = {}) {
  let presses = 0;
  let quiet = 0;
  let frames = 0;
  while (frames < budget) {
    const observation = observe();
    if (observation.battle) return { presses, reason: 'battle', observation };
    const menuOpen = startMenuVisible(observation) || packVisible(observation);
    const choice = menuChoice(observation);
    if (choice && choice.wanted >= 0 && choice.current >= 0) {
      onPrompt?.(choice.pick, observation);
      if (choice.wanted !== choice.current) yield* press(choice.wanted < choice.current ? 'up' : 'down');
      else yield* press('a');
      frames += 14;
      presses += 1;
      quiet = 0;
      continue;
    }
    if (yesNoMenuOpen(observation)) {
      // A prompt drawn over an open pack ("Teach SURF to a POKéMON?") is not
      // ours to accept here: decline it so the menu can be closed below.
      const answer = menuOpen ? 'NO' : choose(observation);
      onPrompt?.(answer, observation);
      const wantedRow = answer === 'YES' ? 1 : 2;
      if (yesNoCursorRow(observation) !== wantedRow) {
        yield* press(wantedRow === 2 ? 'down' : 'up');
        frames += 14;
      }
      yield* press('a');
      frames += 14;
      presses += 1;
      quiet = 0;
      continue;
    }
    if (menuOpen) {
      // Never press A into an open START menu or pack (it would use items or
      // re-open teach prompts); back out of it instead.
      yield* press('b');
      frames += 14;
      presses += 1;
      quiet = 0;
      continue;
    }
    if (textboxOpen(observation) || observation.screen.some((row) => row.includes('▼'))) {
      yield* press('a');
      frames += 14;
      presses += 1;
      quiet = 0;
      continue;
    }
    if (namingScreenVisible(observation)) {
      yield* press('start');
      yield* holdFrames([], 8);
      yield* press('a');
      frames += 30;
      presses += 2;
      quiet = 0;
      continue;
    }
    if (observation.scriptRunning) {
      // A running script with no text box drawn is a full-screen menu the
      // screen decoder does not model (Pokédex, Pokégear, party, trainer
      // card, options). A would only go deeper; B backs out of every one of
      // them, and the cartridge treats B like A for plain text waits.
      yield* press('b');
      frames += 14;
      presses += 1;
      quiet = 0;
      continue;
    }
    quiet += 1;
    if (quiet >= quietFrames) return { presses, reason: 'idle', observation };
    yield [];
    frames += 1;
  }
  throw new DialogError(`script did not settle within ${budget} frames`);
}

/** Interacts with whatever is in front of the player and settles the script. */
export function* interact(observe, options = {}) {
  yield* press('a');
  yield* holdFrames([], 4);
  return yield* advanceScript(observe, options);
}
