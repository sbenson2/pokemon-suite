// Overworld menu flows: the START menu, the PACK, teaching an HM/TM from the
// TM/HM pocket, and field-move prompts. Every step is bounded and verified on
// the drawn screen; nothing here assumes fixed frame counts.

import { holdFrames, press } from './locomotion.mjs';
import { screenContains } from '../observer.mjs';
import { advanceScript, packFrameVisible, packVisible, startMenuVisible, textboxOpen, yesNoCursorRow, yesNoMenuOpen } from './dialog.mjs';

export { packVisible, startMenuVisible };

export class FieldMenuError extends Error {
  constructor(message) {
    super(message);
    this.name = 'FieldMenuError';
  }
}

const cursorRow = (observation) => observation.screen.find((row) => row.includes('▶')) ?? '';

function* tap(button, settle = 8) {
  yield* press(button);
  yield* holdFrames([], settle);
}

/** Opens the START menu and moves the cursor onto the named entry. */
export function* openStartMenu(observe, entry = 'PACK', { budget = 30 } = {}) {
  for (let attempt = 0; attempt < 4 && !startMenuVisible(observe()); attempt += 1) {
    yield* tap('start', 20);
  }
  if (!startMenuVisible(observe())) throw new FieldMenuError('START menu did not open');
  for (let move = 0; move < budget; move += 1) {
    const observation = observe();
    if (cursorRow(observation).includes(entry)) return true;
    const rows = observation.screen;
    const target = rows.findIndex((row) => row.includes(entry));
    const current = rows.findIndex((row) => row.includes('▶'));
    yield* tap(target >= 0 && target < current ? 'up' : 'down', 6);
  }
  throw new FieldMenuError(`START menu entry ${entry} not reachable`);
}

/** Closes any open overworld menus with B presses. */
export function* closeMenus(observe, presses = 4) {
  for (let index = 0; index < presses; index += 1) {
    const observation = observe();
    if (!startMenuVisible(observation) && !packVisible(observation) && !observation.scriptRunning) return;
    yield* tap('b', 12);
  }
}

/**
 * Teaches the HM/TM whose move name is `moveLabel` (as drawn, e.g. "CUT") to
 * the party member at `partySlot`. Handles the teach confirmation and the
 * forget-a-move flow via `chooseForget(observation)` → slot index.
 */
export function* teachFromPack(observe, { moveLabel, partySlot = 0, targetName = null, partyNames = [], chooseForget = null, onPrompt = null }) {
  yield* closeMenus(observe);
  yield* openStartMenu(observe, 'PACK');
  yield* tap('a', 30);
  if (!packVisible(observe())) throw new FieldMenuError('PACK did not open from the START menu');
  // The TM/HM pocket lists TMs before HMs and shows about five rows, so the
  // HM may sit below the window: scroll each pocket before giving up.
  let found = false;
  for (let pocket = 0; pocket < 5 && !found; pocket += 1) {
    for (let scroll = 0; scroll < 14; scroll += 1) {
      if (observe().screen.some((row) => row.includes(moveLabel))) { found = true; break; }
      if (observe().screen.some((row) => /▶CANCEL/.test(row))) break;
      yield* tap('down', 6);
    }
    if (!found) { for (let back = 0; back < 14 && !/▶.*(CANCEL|\S)/.test(''); back += 1) { /* no-op */ } yield* tap('right', 12); }
  }
  if (!found) { yield* closeMenus(observe); throw new FieldMenuError(`${moveLabel} is not in any pocket`); }
  for (let scroll = 0; scroll < 40 && !cursorRow(observe()).includes(moveLabel); scroll += 1) {
    const rows = observe().screen;
    const target = rows.findIndex((row) => row.includes(moveLabel));
    const current = rows.findIndex((row) => row.includes('▶'));
    yield* tap(target >= 0 && target < current ? 'up' : 'down', 6);
  }
  if (!cursorRow(observe()).includes(moveLabel)) { yield* closeMenus(observe); throw new FieldMenuError(`${moveLabel} cursor not reached`); }
  yield* tap('a', 30);
  // Overworld pack items open a USE/GIVE/TOSS/QUIT submenu; confirm USE.
  for (let wait = 0; wait < 6; wait += 1) {
    const observation = observe();
    if (observation.screen.some((row) => /USE\s*│/.test(row)) && screenContains(observation, 'QUIT')) {
      if (!cursorRow(observation).includes('USE')) yield* tap('up', 6);
      yield* tap('a', 30);
      break;
    }
    yield* holdFrames([], 6);
  }
  // "Booted up an HM… Teach CUT to a POKéMON?" YES, then the party picker,
  // then the possible forget-a-move prompt; the dialog policy answers the
  // remaining YES/NO prompts (YES) and declines "Stop learning".
  let frames = 0;
  let taughtPrompt = false;
  while (frames < 3_000) {
    const observation = observe();
    if (yesNoMenuOpen(observation)) {
      const answer = screenContains(observation, 'Stop learning') || screenContains(observation, 'give up') ? 'NO' : 'YES';
      onPrompt?.(answer, observation);
      if (yesNoCursorRow(observation) !== (answer === 'YES' ? 1 : 2)) yield* tap(answer === 'YES' ? 'up' : 'down', 6);
      yield* tap('a', 16);
      frames += 40;
      continue;
    }
    if (screenContains(observation, 'forgotten') || screenContains(observation, 'Which move')) {
      const slot = chooseForget ? chooseForget(observation) : 0;
      for (let move = 0; move < 6; move += 1) {
        const { cursorY } = observe().menu;
        const current = cursorY === 0 ? 1 : cursorY;
        if (current === slot + 1) break;
        yield* tap(current < slot + 1 ? 'down' : 'up', 6);
      }
      yield* tap('a', 16);
      frames += 60;
      continue;
    }
    // The party picker replaces the pack screen with every party member's
    // name; the "Teach SURF to a POKéMON?" text box that precedes it must not
    // trigger this branch (its presses would land on the YES/NO box).
    const pickerOpen = partyNames.length > 0
      ? !packFrameVisible(observation) && partyNames.every((name) => screenContains(observation, name))
      : screenContains(observation, 'which PKMN') || screenContains(observation, 'Choose a');
    if (pickerOpen) {
      // Party picker: the party menu keeps its own cursor (wPartyMenuCursor),
      // so steer by the drawn ▶ and the learner's drawn name; fall back to
      // slot arithmetic on the generic menu cursor when the name is unknown.
      for (let move = 0; move < 8; move += 1) {
        const current = observe();
        const rows = current.screen;
        const cursor = rows.findIndex((row) => row.includes('▶'));
        const target = targetName ? rows.findIndex((row) => row.includes(targetName)) : -1;
        if (target >= 0 && cursor >= 0) {
          if (cursor === target) break;
          yield* tap(target < cursor ? 'up' : 'down', 6);
          continue;
        }
        const at = current.menu.cursorY === 0 ? 1 : current.menu.cursorY;
        if (at === partySlot + 1) break;
        yield* tap(at < partySlot + 1 ? 'down' : 'up', 6);
      }
      yield* tap('a', 24);
      taughtPrompt = true;
      frames += 60;
      continue;
    }
    if (observation.scriptRunning || observation.screen.some((row) => row.includes('▼'))) {
      yield* tap('a', 8);
      frames += 22;
      continue;
    }
    if (packVisible(observation) && taughtPrompt) break;
    if (packVisible(observation)) { yield* tap('a', 16); frames += 30; continue; }
    if (!packVisible(observation) && !startMenuVisible(observation)) break;
    yield* holdFrames([], 8);
    frames += 8;
  }
  yield* closeMenus(observe, 6);
  return { taughtPrompt };
}

/**
 * Faces `direction` and answers the field-move prompt ("Use CUT?") with YES.
 * Returns after the script settles.
 */
export function* useFieldMoveOnFacingTile(observe, direction, { onPrompt = null } = {}) {
  yield* holdFrames([direction], 2);
  yield* holdFrames([], 10);
  yield* tap('a', 10);
  return yield* advanceScript(observe, { onPrompt, choose: () => 'YES' });
}


export const martMenuVisible = (observation) => screenContains(observation, 'BUY') && screenContains(observation, 'SELL');
export const martListVisible = (observation) => observation.screen.some((row) => row.includes('¥')) && !martMenuVisible(observation);
export const quantityPromptVisible = (observation) => screenContains(observation, 'How many?');

/**
 * Buys `orders` ([{itemId, displayName, quantity}]) from the clerk the player
 * is facing. Walks BUY → price list (wMenuSelection is the item id under the
 * cursor) → quantity → confirmation, one order at a time, then quits.
 */
export function* buyFromClerk(observe, { orders, onPrompt = null }) {
  const bought = [];
  yield* tap('a', 24);
  for (let wait = 0; wait < 12 && !martMenuVisible(observe()); wait += 1) { yield* tap('a', 16); }
  if (!martMenuVisible(observe())) { yield* closeMenus(observe, 6); return { bought, reason: 'no-mart-menu' }; }
  for (const order of orders) {
    if (!cursorRow(observe()).includes('BUY')) { for (let move = 0; move < 3 && !cursorRow(observe()).includes('BUY'); move += 1) yield* tap('up', 6); }
    yield* tap('a', 30);
    let listed = false;
    for (let wait = 0; wait < 8; wait += 1) { if (martListVisible(observe())) { listed = true; break; } yield* holdFrames([], 8); }
    if (!listed) break;
    let onItem = false;
    for (let scroll = 0; scroll < 24; scroll += 1) {
      const observation = observe();
      if (observation.menu.selection === order.itemId && cursorRow(observation).includes(order.displayName)) { onItem = true; break; }
      const rows = observation.screen;
      const target = rows.findIndex((row) => row.includes(order.displayName));
      const current = rows.findIndex((row) => row.includes('▶'));
      yield* tap(target >= 0 && target < current ? 'up' : 'down', 6);
    }
    if (!onItem) { yield* tap('b', 16); continue; }
    yield* tap('a', 24);
    if (!quantityPromptVisible(observe())) { yield* tap('b', 16); continue; }
    for (let count = 1; count < order.quantity; count += 1) yield* tap('up', 4);
    yield* tap('a', 24);
    let confirmed = false;
    for (let wait = 0; wait < 12; wait += 1) {
      const observation = observe();
      if (yesNoMenuOpen(observation)) {
        onPrompt?.('YES', observation);
        if (yesNoCursorRow(observation) !== 1) yield* tap('up', 6);
        yield* tap('a', 24);
        confirmed = true;
        break;
      }
      yield* tap('a', 8);
    }
    if (confirmed) {
      bought.push(order);
      for (let wait = 0; wait < 10 && !martListVisible(observe()); wait += 1) yield* tap('a', 12);
    }
    // Leave the price list so the next order starts from the BUY menu.
    yield* tap('b', 20);
    for (let wait = 0; wait < 6 && !martMenuVisible(observe()); wait += 1) yield* tap('b', 12);
  }
  // QUIT the clerk menu and clear the farewell text.
  for (let wait = 0; wait < 4 && martMenuVisible(observe()); wait += 1) yield* tap('b', 16);
  yield* advanceScript(observe, { onPrompt });
  return { bought, reason: 'done' };
}

/** Party menu ("Choose a POKéMON." / "Move to where?") drawn on screen. */
export const partyListVisible = (observation) => screenContains(observation, 'Choose a') || screenContains(observation, 'CHOOSE A') || screenContains(observation, 'Move to where') || screenContains(observation, 'Use on which');

/** Moves the party menu cursor onto `slot` (name rows sit at 1 + 2·slot). */
export function* partyCursorToSlot(observe, slot, { budget = 14 } = {}) {
  const targetRow = 1 + 2 * slot;
  for (let attempt = 0; attempt < budget; attempt += 1) {
    const rows = observe().screen;
    const current = rows.findIndex((row) => row.includes('▶'));
    if (current === targetRow) return true;
    if (current < 0) { yield* holdFrames([], 6); continue; }
    yield* tap(current < targetRow ? 'down' : 'up', 6);
  }
  return false;
}

/**
 * Moves party member `slot` to the lead: START → POKéMON → member → SWITCH →
 * "Move to where?" → slot 1 (engine/pokemon/mon_submenu.asm, party_menu.asm).
 * Verified on the party read back afterwards.
 */
export function* movePartyMemberToLead(observe, slot, { onPrompt = null } = {}) {
  const before = observe();
  const target = before.party[slot];
  if (!target) throw new FieldMenuError(`party slot ${slot} is empty`);
  if (slot === 0) return { swapped: false, lead: target.speciesName };
  yield* closeMenus(observe);
  yield* openStartMenu(observe, 'POKéMON');
  yield* tap('a', 30);
  let opened = false;
  for (let wait = 0; wait < 8 && !opened; wait += 1) { opened = partyListVisible(observe()); if (!opened) yield* holdFrames([], 8); }
  if (!opened) throw new FieldMenuError('party menu did not open from the START menu');
  if (!(yield* partyCursorToSlot(observe, slot))) { yield* closeMenus(observe, 6); throw new FieldMenuError(`party cursor did not reach slot ${slot}`); }
  yield* tap('a', 24);
  // Submenu: field moves, STATS, SWITCH, ITEM, CANCEL — steer onto SWITCH.
  let observation = observe();
  for (let attempt = 0; attempt < 12 && !cursorRow(observation).includes('SWITCH'); attempt += 1) {
    const rows = observation.screen;
    const targetRow = rows.findIndex((row) => row.includes('SWITCH'));
    const current = rows.findIndex((row) => row.includes('▶'));
    if (targetRow < 0) { yield* holdFrames([], 8); observation = observe(); continue; }
    yield* tap(targetRow < current ? 'up' : 'down', 6);
    observation = observe();
  }
  if (!cursorRow(observation).includes('SWITCH')) { yield* closeMenus(observe, 6); throw new FieldMenuError('SWITCH is not in the party submenu'); }
  onPrompt?.('SWITCH', observation);
  yield* tap('a', 24);
  if (!(yield* partyCursorToSlot(observe, 0))) { yield* closeMenus(observe, 6); throw new FieldMenuError('party cursor did not reach the lead slot'); }
  yield* tap('a', 30);
  yield* holdFrames([], 40);
  yield* closeMenus(observe, 6);
  const after = observe();
  if (after.party[0]?.speciesId !== target.speciesId) throw new FieldMenuError(`party swap did not make ${target.speciesName} the lead`);
  return { swapped: true, lead: after.party[0].speciesName, previousLead: before.party[0]?.speciesName ?? null };
}

/** Moves a list cursor (▶) onto the first row containing `text`; false when it never appears. */
export function* steerCursor(observe, text, { budget = 16, settle = 6 } = {}) {
  for (let move = 0; move < budget; move += 1) {
    const observation = observe();
    if (cursorRow(observation).includes(text)) return true;
    const rows = observation.screen;
    const target = rows.findIndex((row) => row.includes(text));
    const current = rows.findIndex((row) => row.includes('▶'));
    if (target < 0) { yield* holdFrames([], 8); continue; }
    yield* tap(target < current ? 'up' : 'down', settle);
  }
  return cursorRow(observe()).includes(text);
}

/** Presses A through text until `text` is drawn (menus that follow a message box). */
export function* advanceUntilVisible(observe, text, { budget = 12 } = {}) {
  for (let attempt = 0; attempt < budget; attempt += 1) {
    const observation = observe();
    if (screenContains(observation, text)) return true;
    yield* tap('a', 24);
  }
  return screenContains(observe(), text);
}

/**
 * Deposits the party member at `slot` into the current box through the
 * Pokémon Center PC the player faces (COLL_PC tile: engine/events/pokecenter_pc.asm
 * "BILL's PC" → engine/pokemon/bills_pc.asm DEPOSIT → member → DEPOSIT).
 * Every step is steered on the drawn screen. Returns { deposited, name, box }.
 */
export function* depositPartyMember(observe, slot, { onPrompt = null, log = null } = {}) {
  const before = observe();
  const target = before.party[slot];
  if (!target) throw new FieldMenuError(`party slot ${slot} is empty`);
  if (before.party.filter((member) => !member.isEgg).length < 2) throw new FieldMenuError('cannot deposit the last usable party member');
  const name = (target.nickname || target.speciesName || '').toUpperCase();
  const fail = function* (message) {
    log?.({ event: 'deposit-fail', message, screen: observe().screen });
    for (let index = 0; index < 10; index += 1) { yield* tap('b', 12); if (!observe().scriptRunning && !observe().screen.some((row) => row.includes('▶'))) break; }
    throw new FieldMenuError(message);
  };
  yield* press('a');
  yield* holdFrames([], 8);
  if (!(yield* advanceUntilVisible(observe, "BILL's PC"))) yield* fail('the PC menu did not open');
  if (!(yield* steerCursor(observe, "BILL's PC"))) yield* fail("BILL's PC is not on the PC menu");
  onPrompt?.("BILL's PC", observe());
  yield* tap('a', 30);
  if (!(yield* advanceUntilVisible(observe, 'DEPOSIT'))) yield* fail("BILL's PC menu did not open");
  if (!(yield* steerCursor(observe, 'DEPOSIT'))) yield* fail("DEPOSIT is not on BILL's PC menu");
  onPrompt?.('DEPOSIT', observe());
  yield* tap('a', 30);
  // The PC's party list draws no ▶; the selected member's name is echoed on
  // its own row under the panel (with its level and gender), so step down the
  // list (party order) until that echo names the target.
  const selected = (observation) => observation.screen.some((row) => row.trim() === name);
  if (!(yield* advanceUntilVisible(observe, 'PARTY'))) yield* fail('the deposit list did not open');
  for (let move = 0; move < 8 && !selected(observe()); move += 1) yield* tap('down', 12);
  if (!selected(observe())) yield* fail(`the deposit list did not select ${name}`);
  yield* tap('a', 24);
  if (!(yield* advanceUntilVisible(observe, 'DEPOSIT'))) yield* fail('the member submenu did not open');
  if (!(yield* steerCursor(observe, 'DEPOSIT'))) yield* fail('DEPOSIT is not on the member submenu');
  onPrompt?.(`DEPOSIT ${name}`, observe());
  yield* tap('a', 40);
  // "Stored <name> in BOX n." then back to the list; leave every PC menu
  // (hInMenu clears once the PC is turned off).
  let box = null;
  for (let attempt = 0; attempt < 12; attempt += 1) {
    const observation = observe();
    const stored = observation.screen.find((row) => /BOX/.test(row));
    if (stored) { box = stored.trim(); break; }
    if (observation.party.length < before.party.length) break;
    yield* tap('a', 16);
  }
  for (let index = 0; index < 16; index += 1) {
    const observation = observe();
    if (observation.joypad?.inMenu === 0 && !observation.scriptRunning && !textboxOpen(observation)) break;
    yield* tap('b', 14);
  }
  yield* holdFrames([], 12);
  const after = observe();
  const deposited = after.party.length === before.party.length - 1;
  log?.({ event: 'deposit', deposited, name, box });
  return { deposited, name, box, party: after.party.map((member) => member.speciesName) };
}
