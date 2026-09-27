// Battle advisor and executor.
//
// The advisor scores the active Pokémon's moves from the pinned move table and
// type chart against the observed opponent, decides when to heal from the
// PACK, and when to throw Poké Balls at a wild team-plan species. The executor
// drives the native battle menus using the observed cursor (wMenuCursorY/X),
// the item under the pack cursor (wMenuSelection), and the decoded screen,
// one bounded press at a time, until wBattleMode clears.

import { holdFrames, press } from './locomotion.mjs';
import { screenContains } from '../observer.mjs';
import { yesNoCursorRow, yesNoMenuOpen } from './dialog.mjs';
import { BALLS, MEDICINE, MEDICINE_HEAL, estimateDamage, planBattleTurn, scoreMoves } from './tactics.mjs';

export { estimateDamage, scoreMoves };

export class BattleError extends Error {
  constructor(message) {
    super(message);
    this.name = 'BattleError';
  }
}


export const battleMenuVisible = (observation) => screenContains(observation, 'FIGHT') && screenContains(observation, 'RUN');
// The move menu's info box (rows 8-11) shows TYPE/ and PP, or "Disabled!"
// while the cursor rests on a move under Disable (engine/battle/core.asm
// MoveInfoBox .disabled) — selecting it prints "The move is DISABLED!" and
// returns here, so the disabled form must count as the menu too.
export const moveMenuVisible = (observation) => (observation.screen[9]?.includes('TYPE/') === true || observation.screen[10]?.includes('Disabled!') === true) && !battleMenuVisible(observation);
export const partyMenuVisible = (observation) => screenContains(observation, 'Choose a') || screenContains(observation, 'CHOOSE A') || screenContains(observation, 'Which PKMN?') || screenContains(observation, 'Use on which');
export const packVisible = (observation) => screenContains(observation, 'CANCEL') && !battleMenuVisible(observation) && !moveMenuVisible(observation) && !partyMenuVisible(observation);
export const yesNoVisible = (observation) => yesNoMenuOpen(observation);
export const promptVisible = (observation) => observation.screen.some((row) => row.includes('▼'));

const findItem = (pocket = [], names) => {
  for (const name of names) {
    const found = pocket.find((entry) => entry.name === name && entry.quantity > 0);
    if (found) return found;
  }
  return null;
};

/**
 * Chooses fight/run/item/ball for the current turn. Trainer battles never run.
 * `capture` = { targets: Set<speciesId>, throws: number, partySize } enables
 * the Poké Ball policy for wild team-plan species.
 */
/**
 * `training` is either a boolean (never run from wild battles) or a context
 * { traineeSlot, escortSlot }: the trainee leads so it earns participation
 * experience, and switches to the escort as soon as the matchup is unsafe.
 */
export function adviseBattleTurn({ knowledge, observation, training = false, runWhenHpBelow = 0.3, capture = null, maximumThrows = 5, roles = null, switchesUsed = 0 }) {
  const { battle } = observation;
  const scored = scoreMoves({ knowledge, attacker: battle.player, defender: battle.enemy });
  const ranked = [...scored].sort((left, right) => right.score - left.score);
  const best = ranked[0] ?? null;
  const hpRatio = battle.player.maxHp > 0 ? battle.player.hp / battle.player.maxHp : 0;
  const enemyRatio = battle.enemy.maxHp > 0 ? battle.enemy.hp / battle.enemy.maxHp : 1;
  const healthyReserve = observation.party.some((member) => !member.isEgg && member.hp > 0 && member.speciesId !== battle.player.speciesId);
  const evidence = ['data/moves/moves.asm', 'data/types/type_matchups.asm'];
  const trainingContext = training && typeof training === 'object' ? training : null;
  const isTraining = Boolean(training);

  // Switch training: the trainee is active and outmatched → escort takes over.
  if (trainingContext && Number.isInteger(trainingContext.traineeSlot) && Number.isInteger(trainingContext.escortSlot)
      && battle.curBattleMon === trainingContext.traineeSlot && trainingContext.escortSlot !== trainingContext.traineeSlot) {
    const escort = observation.party[trainingContext.escortSlot];
    const unsafe = battle.enemy.level >= battle.player.level + 3 || hpRatio < 0.5;
    if (escort && !escort.isEgg && escort.hp > 0 && unsafe) {
      return {
        advisor: 'training',
        recommendation: { kind: 'switch', slot: trainingContext.escortSlot, escort: escort.speciesName, reason: hpRatio < 0.5 ? 'trainee-low-hp' : 'trainee-outlevelled', traineeLevel: battle.player.level, enemyLevel: battle.enemy.level },
        confidence: 0.85, constraints: ['trainee-participated'], evidenceRefs: ['engine/battle/core.asm:BattleMenu_Pkmn'], scored,
      };
    }
  }

  const medicine = findItem(observation.items, MEDICINE);

  // Capture a wild team-plan species: weaken with the weakest damaging move, then throw.
  if (battle.mode === 'WILD' && capture?.targets?.has(battle.enemy.speciesId) && capture.partySize < 6 && capture.throws < maximumThrows) {
    const ball = findItem(observation.balls, BALLS);
    if (ball) {
      const weakest = [...scored].filter((entry) => entry.score > 0.01).sort((left, right) => left.score - right.score)[0] ?? null;
      const minimumHit = weakest ? estimateDamage({ knowledge, attacker: battle.player, defender: battle.enemy, move: knowledge.moves.get(weakest.id), roll: 217 }) : 0;
      const wouldFaint = !weakest || minimumHit >= battle.enemy.hp;
      if (enemyRatio <= 0.5 || capture.throws > 0 || wouldFaint) {
        return { advisor: 'capture', recommendation: { kind: 'ball', itemId: ball.id, item: ball.name, species: battle.enemy.speciesName, reason: wouldFaint ? 'weakest-move-would-faint' : 'target-weakened', throws: capture.throws + 1, minimumHit }, confidence: 0.6, constraints: ['wild-only'], evidenceRefs: ['games/crystal/index.mjs:TEAM_PLANS', 'engine/battle/core.asm:BattleCommand_DamageCalc'], scored };
      }
      return { advisor: 'capture', recommendation: { kind: 'fight', slot: weakest.slot, move: weakest.name, reason: 'weaken-for-capture', species: battle.enemy.speciesName, minimumHit }, confidence: 0.5, constraints: ['wild-only'], evidenceRefs: evidence, scored };
    }
  }

  if (battle.mode === 'WILD' && hpRatio < runWhenHpBelow && !healthyReserve && !isTraining && !medicine) {
    return { advisor: 'battle', recommendation: { kind: 'run', reason: 'lead-low-hp' }, confidence: 0.6, constraints: [], evidenceRefs: ['engine/battle/core.asm:BattleMenu_Run'], scored };
  }

  // Expert turn (reform P0-2): guaranteed knockout first; heal only when the
  // maximum credible hit would faint us and the smallest sufficient item makes
  // us survive; else a teammate that survives and hits harder; else best damage.
  // While switch-training, the trainee never makes a matchup switch of its own
  // (the escort rule above owns that) and the escort does not switch back.
  const plan = planBattleTurn({ knowledge, observation, roles, allowSwitch: !trainingContext && !isTraining, switchesUsed });
  const evidenceRefs = [...evidence, 'engine/battle/core.asm:BattleCommand_DamageCalc'];
  if (plan.kind === 'item') {
    return { advisor: 'battle', recommendation: { ...plan }, confidence: 0.8, constraints: ['pack-item-in-battle'], evidenceRefs: ['engine/battle/core.asm:BattleMenu_Pack', ...evidenceRefs], scored };
  }
  if (plan.kind === 'switch') {
    return { advisor: 'battle', recommendation: { ...plan }, confidence: 0.75, constraints: ['one-voluntary-switch'], evidenceRefs: ['engine/battle/core.asm:BattleMenu_Pkmn', ...evidenceRefs], scored };
  }
  if (!best || best.score < 0) {
    return { advisor: 'battle', recommendation: { kind: 'fight', slot: plan.slot ?? 0, move: plan.move ?? battle.player.moves[0]?.name ?? '-', reason: 'no-usable-move' }, confidence: 0.2, constraints: [], evidenceRefs: [], scored };
  }
  return {
    advisor: 'battle',
    recommendation: { ...plan, score: Number((scored.find((entry) => entry.slot === plan.slot)?.score ?? 0).toFixed(2)) },
    confidence: plan.reason === 'knockout' ? 0.95 : 0.8,
    constraints: [],
    evidenceRefs,
    scored,
  };
}

function* moveCursorTo(observe, row, column, { budget = 12 } = {}) {
  for (let attempt = 0; attempt < budget; attempt += 1) {
    const observation = observe();
    let { cursorY, cursorX } = observation.menu;
    // A freshly opened menu reports (0,0) until the first input; the drawn
    // cursor sits on the default option, so treat zero as row/column one.
    if (cursorY === 0) cursorY = 1;
    if (cursorX === 0) cursorX = 1;
    if (cursorY === row && cursorX === column) return true;
    if (cursorY !== row) yield* press(cursorY < row ? 'down' : 'up');
    else yield* press(cursorX < column ? 'right' : 'left');
  }
  return false;
}

const cursorRowText = (observation) => observation.screen.find((row) => row.includes('▶')) ?? '';
export const useSubmenuVisible = (observation) => observation.screen.some((row) => /[▶ ]USE\s*│/.test(row)) && observation.screen.some((row) => row.includes('QUIT'));

/**
 * From the battle menu, opens PACK, finds the pocket that holds `itemId`
 * (wMenuSelection reports the item under the cursor in the ITEM and BALL
 * pockets), selects it and confirms. Returns true when the item was used.
 */
export function* useBattleItem({ observe, knowledge, itemId, displayName, tap, tick, partySlot = 0 }) {
  const atFight = yield* moveCursorTo(observe, 2, 1);
  if (!atFight) return false;
  yield* tap('a');
  let opened = false;
  for (let wait = 0; wait < 12; wait += 1) {
    yield* tick([], 8);
    if (packVisible(observe())) { opened = true; break; }
  }
  if (!opened) return false;
  // Locate the pocket: cycle right until the item is on screen (max four pockets).
  let located = false;
  for (let pocket = 0; pocket < 5; pocket += 1) {
    const observation = observe();
    if (observation.menu.selection === itemId || observation.screen.some((row) => row.includes(displayName))) { located = true; break; }
    yield* tap('right');
    yield* tick([], 10);
  }
  if (!located) { yield* tap('b'); yield* tick([], 20); return false; }
  // Scroll within the pocket until the cursor is on the item.
  let onItem = false;
  for (let scroll = 0; scroll < 24; scroll += 1) {
    const observation = observe();
    if (observation.menu.selection === itemId || cursorRowText(observation).includes(displayName)) { onItem = true; break; }
    const rows = observation.screen;
    const cursorRow = rows.findIndex((row) => row.includes('▶'));
    const itemRow = rows.findIndex((row) => row.includes(displayName));
    yield* tap(itemRow >= 0 && itemRow < cursorRow ? 'up' : 'down');
    yield* tick([], 6);
  }
  if (!onItem) { yield* tap('b'); yield* tick([], 20); return false; }
  yield* tap('a');
  yield* tick([], 16);
  // Selecting an item opens a USE/QUIT submenu (cursor on USE); confirm it.
  let confirmed = false;
  for (let wait = 0; wait < 8; wait += 1) {
    const observation = observe();
    if (useSubmenuVisible(observation)) {
      if (!cursorRowText(observation).includes('USE')) yield* tap('up');
      yield* tap('a');
      yield* tick([], 16);
      confirmed = true;
      break;
    }
    if (!packVisible(observation)) { confirmed = true; break; }
    yield* tick([], 8);
  }
  if (!confirmed) { yield* tap('b'); yield* tick([], 20); return false; }
  // Medicine then asks which Pokémon; balls throw immediately. The party
  // menu's cursor is inactive (▷) for its first frames and wMenuCursorY is
  // not its cursor, so wait for ▶ and steer by the drawn rows (1 + 2·slot).
  for (let wait = 0; wait < 16; wait += 1) {
    const observation = observe();
    if (partyMenuVisible(observation)) {
      yield* selectPartyRow(observe, partySlot, tap, tick);
      break;
    }
    if (!packVisible(observation)) break;
    yield* tick([], 8);
  }
  return true;
}

/**
 * Selects a party member in an open party menu. The menu draws two rows per
 * member (name row at 1 + 2·slot); its cursor ignores input for its first
 * frames, so presses are repeated until the menu closes.
 */
export function* selectPartyRow(observe, partySlot, tap, tick) {
  const targetRow = 1 + 2 * partySlot;
  for (let attempt = 0; attempt < 10; attempt += 1) {
    const rows = observe().screen;
    if (!partyMenuVisible(observe())) return true;
    const cursorRow = rows.findIndex((row) => row.includes('▶'));
    if (cursorRow >= 0 && cursorRow !== targetRow) {
      yield* tap(cursorRow < targetRow ? 'down' : 'up');
      yield* tick([], 6);
      continue;
    }
    yield* tap('a');
    yield* tick([], 16);
  }
  return !partyMenuVisible(observe());
}

/**
 * From the battle menu, opens PKMN, picks `slot` and confirms SWITCH in the
 * SWITCH/STATS/CANCEL submenu (engine/pokemon/mon_submenu.asm). Returns true
 * once the party menu has closed again.
 */
export function* switchToPartySlot({ observe, slot, tap, tick }) {
  const atPkmn = yield* moveCursorTo(observe, 1, 2);
  if (!atPkmn) return false;
  yield* tap('a');
  let opened = false;
  for (let wait = 0; wait < 12 && !opened; wait += 1) { yield* tick([], 8); opened = partyMenuVisible(observe()); }
  if (!opened) return false;
  const targetRow = 1 + 2 * slot;
  let positioned = false;
  for (let attempt = 0; attempt < 14 && !positioned; attempt += 1) {
    const rows = observe().screen;
    const current = rows.findIndex((row) => row.includes('▶'));
    if (current === targetRow) { positioned = true; break; }
    if (current < 0) { yield* tick([], 6); continue; }
    yield* tap(current < targetRow ? 'down' : 'up');
    yield* tick([], 6);
  }
  if (!positioned) { yield* tap('b'); yield* tick([], 16); return false; }
  yield* tap('a');
  let submenu = false;
  for (let wait = 0; wait < 10 && !submenu; wait += 1) { yield* tick([], 6); submenu = observe().screen.some((row) => row.includes('SWITCH')); }
  if (!submenu) { yield* tap('b'); yield* tick([], 16); return false; }
  for (let attempt = 0; attempt < 4 && !cursorRowText(observe()).includes('SWITCH'); attempt += 1) { yield* tap('up'); yield* tick([], 6); }
  yield* tap('a');
  for (let wait = 0; wait < 30; wait += 1) {
    yield* tick([], 8);
    if (!partyMenuVisible(observe()) && !observe().screen.some((row) => row.includes('SWITCH'))) return true;
  }
  return !partyMenuVisible(observe());
}

/**
 * Plays one battle to completion. Returns the native battle result (0 win,
 * 1 lose, 2 draw) and turn statistics. `capture` carries the team-plan
 * species set; throws are counted here so the policy can cap them.
 */
export function* runBattle({ observe, knowledge, training = false, capture = null, onDecision = null, onPrompt = null, maximumFrames = 60_000, chooseForget = null, trace = null, roles = null }) {
  let frames = 0;
  let turns = 0;
  let presses = 0;
  let throws = 0;
  let itemsUsed = 0;
  let itemAttempts = 0;
  let switches = 0;
  let lastResult = null;
  const trainingContext = training && typeof training === 'object' ? training : null;
  const tick = function* (buttons = [], count = 1) { yield* holdFrames(buttons, count); frames += count; };
  const tap = function* (button) { yield* press(button); frames += 14; presses += 1; };
  while (frames < maximumFrames) {
    const observation = observe();
    if (!observation.battle) return { result: lastResult, turns, presses, frames, throws, itemsUsed, switches };
    lastResult = observation.battle.result & 0x3;
    trace?.({
      frames,
      branch: battleMenuVisible(observation) ? 'menu' : moveMenuVisible(observation) ? 'moves' : yesNoVisible(observation) ? 'yesno' : partyMenuVisible(observation) ? 'party' : packVisible(observation) ? 'pack' : 'text',
      hp: observation.battle.player.hp,
      rows: observation.screen,
    });
    if (battleMenuVisible(observation)) {
      const advice = adviseBattleTurn({
        knowledge, observation, training, roles, switchesUsed: switches,
        capture: capture ? { targets: capture.targets, throws, partySize: observation.party.length } : null,
      });
      onDecision?.(advice, observation);
      turns += 1;
      const { recommendation } = advice;
      if (recommendation.kind === 'run') {
        yield* tap('down');
        yield* tap('right');
        yield* tap('a');
        yield* tick([], 30);
        continue;
      }
      if (recommendation.kind === 'switch') {
        if (switches < 3) {
          switches += 1;
          const switched = yield* switchToPartySlot({ observe, slot: recommendation.slot, tap, tick });
          if (switched) { yield* tick([], 20); continue; }
          yield* tap('b');
          yield* tick([], 20);
          if (!battleMenuVisible(observe())) continue;
        }
        recommendation.kind = 'fight';
        recommendation.slot = advice.scored.filter((entry) => entry.score > 0).sort((left, right) => right.score - left.score)[0]?.slot ?? 0;
      }
      if ((recommendation.kind === 'item' || recommendation.kind === 'ball') && itemAttempts < 8) {
        itemAttempts += 1;
        const hpBefore = observation.battle.player.hp;
        const activeSlot = Math.max(observation.party.findIndex((member) => member.speciesId === observation.battle.player.speciesId), 0);
        const used = yield* useBattleItem({ observe, knowledge, itemId: recommendation.itemId, displayName: knowledge.itemDisplayName(recommendation.itemId), tap, tick, partySlot: Number.isInteger(recommendation.partySlot) ? recommendation.partySlot : activeSlot });
        if (used) {
          if (recommendation.kind === 'ball') throws += 1; else itemsUsed += 1;
          yield* tick([], 20);
          if (recommendation.kind === 'item' && observe().battle && observe().battle.player.hp <= hpBefore) itemAttempts += 2; // flow did not heal: back off sooner
          continue;
        }
        // Fall through to a plain attack when the pack could not be driven.
        yield* tap('b');
        yield* tick([], 20);
        if (!battleMenuVisible(observe())) continue;
        recommendation.kind = 'fight';
        recommendation.slot = advice.scored.filter((entry) => entry.score > 0).sort((left, right) => right.score - left.score)[0]?.slot ?? 0;
      } else if (recommendation.kind === 'item' || recommendation.kind === 'ball') {
        recommendation.kind = 'fight';
        recommendation.slot = advice.scored.filter((entry) => entry.score > 0).sort((left, right) => right.score - left.score)[0]?.slot ?? 0;
      }
      // FIGHT is the top-left option; up/left never leave the menu, so they
      // are always safe to press before confirming.
      yield* tap('up');
      yield* tap('left');
      yield* tap('a');
      let opened = false;
      for (let wait = 0; wait < 8; wait += 1) {
        yield* tick([], 8);
        if (moveMenuVisible(observe())) { opened = true; break; }
      }
      if (!opened) continue;
      const targetRow = (recommendation.slot ?? 0) + 1;
      const positioned = yield* moveCursorTo(observe, targetRow, 1);
      if (!positioned) { yield* tap('b'); continue; }
      yield* tap('a');
      yield* tick([], 20);
      continue;
    }
    if (moveMenuVisible(observation)) {
      if (promptVisible(observation)) { yield* tap('a'); yield* tick([], 8); continue; } // "The move is DISABLED!" still waiting for A
      const advice = adviseBattleTurn({ knowledge, observation, training, roles, switchesUsed: switches });
      yield* moveCursorTo(observe, (advice.recommendation.slot ?? 0) + 1, 1);
      yield* tap('a');
      yield* tick([], 20);
      continue;
    }
    if (yesNoVisible(observation)) {
      const stopLearning = screenContains(observation, 'Stop learning') || screenContains(observation, 'give up');
      const answer = stopLearning || screenContains(observation, 'nickname') ? 'NO' : 'YES';
      onPrompt?.(answer, observation);
      const wantedRow = answer === 'YES' ? 1 : 2;
      if (yesNoCursorRow(observation) !== wantedRow) yield* tap(wantedRow === 2 ? 'down' : 'up');
      yield* tap('a');
      continue;
    }
    if (screenContains(observation, 'forgotten') || screenContains(observation, 'Which move')) {
      const slot = chooseForget ? chooseForget(observation) : 0;
      yield* moveCursorTo(observe, slot + 1, 1);
      yield* tap('a');
      continue;
    }
    if (partyMenuVisible(observation)) {
      if (screenContains(observation, 'Use on which')) {
        // An item's target prompt (e.g. resumed mid-flow): apply it to the lead.
        const active = Math.max(observation.party.findIndex((member) => member.speciesId === observation.battle.player.speciesId), 0);
        yield* selectPartyRow(observe, active, tap, tick);
        continue;
      }
      if (observation.battle.player.hp > 0) {
        yield* tap('b');
        yield* tick([], 12);
        continue;
      }
      // Forced switch after a faint: the escort when training, else the first healthy member.
      const escort = trainingContext ? observation.party[trainingContext.escortSlot] : null;
      const healthy = escort && !escort.isEgg && escort.hp > 0
        ? trainingContext.escortSlot
        : observation.party.findIndex((member) => !member.isEgg && member.hp > 0);
      yield* selectPartyRow(observe, Math.max(healthy, 0), tap, tick);
      yield* tick([], 12);
      continue;
    }
    if (packVisible(observation) || useSubmenuVisible(observation)) {
      // A pack or item submenu left open outside our item flow: close it.
      yield* tap('b');
      yield* tick([], 12);
      continue;
    }
    // Text, animations and prompts: acknowledge with A on a modest cadence.
    yield* tap('a');
    yield* tick([], 4);
  }
  throw new BattleError(`battle exceeded ${maximumFrames} frames`);
}
