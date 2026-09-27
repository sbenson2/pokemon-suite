// Battle tactics (reform P0-2): a Gen II damage model over the observed
// stats and moves of both sides, used to decide a turn the way an expert
// does. Heal only when the maximum credible incoming hit would faint the
// active Pokémon and healing makes it survive; take a guaranteed knockout
// first; switch to a teammate that survives the hit and hits back harder;
// otherwise use the best expected-damage move. No speedrun tricks.
//
// Formula (engine/battle/core.asm BattleCommand_DamageCalc):
//   ((2·L/5 + 2) · power · A / D / 50 + 2) · STAB · type · roll/255, roll 217..255.
// Physical types use Attack/Defense, special types SpclAtk/SpclDef.

export const MEDICINE = Object.freeze(['POTION', 'SUPER_POTION', 'HYPER_POTION', 'FRESH_WATER', 'SODA_POP', 'LEMONADE', 'MOOMOO_MILK', 'MAX_POTION', 'FULL_RESTORE']);
export const BALLS = Object.freeze(['POKE_BALL', 'GREAT_BALL', 'ULTRA_BALL']);
export const MEDICINE_HEAL = Object.freeze({ POTION: 20, SUPER_POTION: 50, HYPER_POTION: 200, FRESH_WATER: 50, SODA_POP: 60, LEMONADE: 80, MOOMOO_MILK: 100, MAX_POTION: 999, FULL_RESTORE: 999 });
export const REVIVES = Object.freeze(['REVIVE', 'MAX_REVIVE']);
export const MINIMUM_ROLL = 217;
export const EXPECTED_ROLL = 236;
export const MAXIMUM_ROLL = 255;

export function estimateDamage({ knowledge, attacker, defender, move, roll = MINIMUM_ROLL, critical = false }) {
  if (!move || move.power === 0) return 0;
  const special = knowledge.types.categories.get(move.type) === 'special';
  const attack = special ? attacker.specialAttack ?? attacker.attack : attacker.attack;
  const defense = special ? defender.specialDefense ?? defender.defense : defender.defense;
  if (!attack || !defense) return 0;
  const stab = attacker.typeIds?.includes(move.typeId) ? 1.5 : 1;
  const effectiveness = knowledge.effectiveness(move.typeId, defender.typeIds ?? []);
  const level = (attacker.level ?? 1) * (critical ? 2 : 1);
  const base = Math.floor(Math.floor(Math.floor(2 * level / 5 + 2) * move.power * attack / defense) / 50) + 2;
  return Math.floor(base * stab * effectiveness * roll / 255);
}

export function damageRange(context) {
  return {
    min: estimateDamage({ ...context, roll: MINIMUM_ROLL }),
    expected: estimateDamage({ ...context, roll: EXPECTED_ROLL }),
    max: estimateDamage({ ...context, roll: MAXIMUM_ROLL }),
  };
}

/** A move the cartridge will accept: PP left and not under Disable (wPlayerDisableCount). */
export const usableMove = (slotMove) => slotMove.pp > 0 && !slotMove.disabled;

/** Scores each usable move; higher is better. Status moves score just above zero. */
export function scoreMoves({ knowledge, attacker, defender }) {
  return (attacker.moves ?? []).map((slotMove) => {
    const move = knowledge.moves.get(slotMove.id);
    if (!move || !usableMove(slotMove)) return { slot: slotMove.slot, id: slotMove.id, name: slotMove.name, score: -1, reason: slotMove.disabled ? 'disabled' : slotMove.pp <= 0 ? 'no-pp' : 'unknown-move' };
    if (move.power === 0) return { slot: slotMove.slot, id: move.id, name: move.name, score: 0.01, reason: 'status' };
    const stab = (attacker.typeIds ?? []).includes(move.typeId) ? 1.5 : 1;
    const effectiveness = knowledge.effectiveness(move.typeId, defender.typeIds ?? []);
    const accuracy = move.accuracy > 0 ? move.accuracy / 100 : 1;
    const score = move.power * stab * effectiveness * accuracy;
    return { slot: slotMove.slot, id: move.id, name: move.name, score, reason: effectiveness > 1 ? 'super-effective' : effectiveness === 0 ? 'immune' : 'damage', effectiveness, stab };
  });
}

/** The largest non-critical maximum-roll hit the attacker's usable moves can land. */
export function maximumIncomingDamage({ knowledge, attacker, defender }) {
  let worst = { damage: 0, move: null };
  for (const slotMove of attacker.moves ?? []) {
    if (!usableMove(slotMove)) continue;
    const move = knowledge.moves.get(slotMove.id);
    if (!move || move.power === 0) continue;
    const damage = estimateDamage({ knowledge, attacker, defender, move, roll: MAXIMUM_ROLL });
    if (damage > worst.damage) worst = { damage, move: move.name };
  }
  return worst;
}

/** A move whose minimum roll already knocks the defender out; prefers accuracy, then damage. */
export function knockoutMove({ knowledge, attacker, defender }) {
  let best = null;
  for (const slotMove of attacker.moves ?? []) {
    if (!usableMove(slotMove)) continue;
    const move = knowledge.moves.get(slotMove.id);
    if (!move || move.power === 0) continue;
    const min = estimateDamage({ knowledge, attacker, defender, move, roll: MINIMUM_ROLL });
    if (min < defender.hp) continue;
    const accuracy = move.accuracy > 0 ? move.accuracy : 100;
    const candidate = { slot: slotMove.slot, name: move.name, min, accuracy, guaranteed: accuracy >= 100 };
    if (!best || candidate.accuracy > best.accuracy || (candidate.accuracy === best.accuracy && candidate.min > best.min)) best = candidate;
  }
  return best;
}

/** The move with the highest accuracy-weighted expected damage. */
export function bestDamageMove({ knowledge, attacker, defender }) {
  let best = null;
  let bestByScore = null;
  for (const slotMove of attacker.moves ?? []) {
    if (!usableMove(slotMove)) continue;
    const move = knowledge.moves.get(slotMove.id);
    if (!move || move.power === 0) continue;
    const expected = estimateDamage({ knowledge, attacker, defender, move, roll: EXPECTED_ROLL });
    const accuracy = move.accuracy > 0 ? move.accuracy / 100 : 1;
    const value = expected * accuracy;
    const effectiveness = knowledge.effectiveness(move.typeId, defender.typeIds ?? []);
    const stab = (attacker.typeIds ?? []).includes(move.typeId) ? 1.5 : 1;
    const score = move.power * stab * effectiveness * accuracy;
    const candidate = { slot: slotMove.slot, name: move.name, expected, value, effectiveness, score };
    if (!best || value > best.value) best = candidate;
    if (!bestByScore || score > bestByScore.score) bestByScore = candidate;
  }
  // Without observed stats every estimate is zero: rank by power × STAB × type × accuracy instead.
  return best && best.value === 0 ? bestByScore : best;
}

/** The medicine with the smallest heal that still restores at least `needed` HP (else the largest owned). */
export function smallestSufficientMedicine(items = [], needed = 1) {
  const owned = items.filter((item) => item.quantity > 0 && MEDICINE_HEAL[item.name] !== undefined);
  if (owned.length === 0) return null;
  const sufficient = owned.filter((item) => MEDICINE_HEAL[item.name] >= needed).sort((left, right) => MEDICINE_HEAL[left.name] - MEDICINE_HEAL[right.name]);
  if (sufficient.length > 0) return { ...sufficient[0], heals: MEDICINE_HEAL[sufficient[0].name] };
  const largest = owned.sort((left, right) => MEDICINE_HEAL[right.name] - MEDICINE_HEAL[left.name])[0];
  return { ...largest, heals: MEDICINE_HEAL[largest.name] };
}

/**
 * A healthy teammate that survives the enemy's maximum hit and hits back at
 * least as hard as the active Pokémon, scored by knockout potential; null
 * when none qualifies. Party members need the stats the observer exposes.
 */
export function switchCandidate({ knowledge, observation, activeSlot, excludeSlots = [] }) {
  const { battle } = observation;
  const enemy = battle.enemy;
  const activeOffense = bestDamageMove({ knowledge, attacker: battle.player, defender: enemy })?.value ?? 0;
  let best = null;
  observation.party.forEach((member, slot) => {
    if (slot === activeSlot || excludeSlots.includes(slot) || member.isEgg || member.hp <= 0) return;
    if (!member.defense || !member.typeIds?.length) return;
    const incoming = maximumIncomingDamage({ knowledge, attacker: enemy, defender: member }).damage;
    if (incoming >= member.hp) return;
    const offense = bestDamageMove({ knowledge, attacker: member, defender: enemy });
    if (!offense || offense.value < 0.75 * activeOffense) return;
    const score = offense.value / Math.max(1, enemy.hp) + (member.speed > enemy.speed ? 0.25 : 0) + (offense.effectiveness > 1 ? 0.25 : 0);
    if (!best || score > best.score) best = { slot, speciesName: member.speciesName, level: member.level, score, incoming, offense: offense.value, move: offense.name };
  });
  return best;
}

/**
 * One turn, expert order: guaranteed knockout → survive the worst hit (heal
 * when it works, else a surviving teammate) → best damage. `roles` (slot →
 * starter/plan/utility) gates Revives to utility carriers in trainer battles.
 */
export function planBattleTurn({ knowledge, observation, roles = null, allowSwitch = true, switchesUsed = 0 }) {
  const { battle } = observation;
  const player = battle.player;
  const enemy = battle.enemy;
  const activeSlot = Number.isInteger(battle.curBattleMon) ? battle.curBattleMon : Math.max(observation.party.findIndex((member) => member.speciesId === player.speciesId), 0);
  const incoming = maximumIncomingDamage({ knowledge, attacker: enemy, defender: player });
  const outspeed = (player.speed ?? 0) > (enemy.speed ?? 0);
  const knockout = knockoutMove({ knowledge, attacker: player, defender: enemy });
  // No observable damaging move (moves not yet revealed): treat a low lead as threatened.
  const unknownThreat = incoming.damage === 0 && (enemy.moves ?? []).every((slotMove) => (knowledge.moves.get(slotMove.id)?.power ?? 0) === 0);
  const hpRatio = player.maxHp > 0 ? player.hp / player.maxHp : 1;
  if (unknownThreat && hpRatio < 0.3) incoming.damage = Math.max(incoming.damage, Math.ceil(player.maxHp * 0.5));
  const wouldFaint = incoming.damage >= player.hp;

  if (knockout && (outspeed || !wouldFaint)) {
    return { kind: 'fight', slot: knockout.slot, move: knockout.name, reason: knockout.guaranteed ? 'knockout' : 'likely-knockout', incoming: incoming.damage, outspeed };
  }

  // Revive: trainer battles only, and only a utility carrier may spend the turn.
  const revive = observation.items?.find((item) => item.quantity > 0 && REVIVES.includes(item.name)) ?? null;
  const fainted = observation.party.findIndex((member, slot) => slot !== activeSlot && !member.isEgg && member.hp === 0 && member.maxHp > 0);
  if (revive && fainted >= 0 && battle.mode === 'TRAINER' && roles?.[activeSlot] === 'utility' && !wouldFaint) {
    return { kind: 'item', itemId: revive.id, item: revive.name, partySlot: fainted, reason: 'revive-from-utility-carrier', incoming: incoming.damage };
  }

  if (wouldFaint) {
    const needed = incoming.damage - player.hp + 1;
    const medicine = smallestSufficientMedicine(observation.items ?? [], needed);
    const worthHealing = battle.mode === 'TRAINER' || (enemy.maxHp > 0 && enemy.hp / enemy.maxHp > 0.25);
    if (medicine && medicine.heals >= needed && player.maxHp - player.hp >= Math.min(needed, 10) && worthHealing) {
      return { kind: 'item', itemId: medicine.id, item: medicine.name, partySlot: activeSlot, heals: medicine.heals, reason: 'survive-max-hit', incoming: incoming.damage, needed };
    }
    if (allowSwitch && switchesUsed < 1) {
      const candidate = switchCandidate({ knowledge, observation, activeSlot });
      if (candidate) return { kind: 'switch', slot: candidate.slot, escort: candidate.speciesName, reason: 'matchup-switch', incoming: incoming.damage, candidate };
    }
  }

  const best = bestDamageMove({ knowledge, attacker: player, defender: enemy });
  if (best) return { kind: 'fight', slot: best.slot, move: best.name, reason: best.effectiveness > 1 ? 'super-effective' : 'damage', expected: best.expected, incoming: incoming.damage, outspeed };
  const fallback = (player.moves ?? []).find(usableMove) ?? player.moves?.[0];
  return { kind: 'fight', slot: fallback?.slot ?? 0, move: fallback?.name ?? '-', reason: 'no-damaging-move', incoming: incoming.damage };
}
