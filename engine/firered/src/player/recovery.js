import { moveDamageKind } from './move-damage.js';

const STATUS_SLEEP = 0x07;
const STATUS_POISON = 0x08;
const STATUS_BURN = 0x10;
const STATUS_FREEZE = 0x20;
const STATUS_PARALYSIS = 0x40;

const REVIVE_ITEMS = Object.freeze([24, 25, 33]);
const ALL_STATUS_ITEMS = Object.freeze([23, 32]);
const ELIXIR_ITEMS = Object.freeze([37, 36]);
// Berry Pouch navigation is not yet decoded; use the normal medicine pocket.
const SINGLE_PP_ITEMS = Object.freeze([34, 35]);
const STATUS_ITEM_MASKS = Object.freeze(new Map([
  [14, STATUS_POISON],
  [15, STATUS_BURN],
  [16, STATUS_FREEZE],
  [17, STATUS_SLEEP],
  [18, STATUS_PARALYSIS],
]));
const HP_ITEMS = Object.freeze([
  Object.freeze({ itemId: 13, amount: 20 }),
  Object.freeze({ itemId: 22, amount: 50 }),
  Object.freeze({ itemId: 26, amount: 50 }),
  Object.freeze({ itemId: 30, amount: 50 }),
  Object.freeze({ itemId: 27, amount: 60 }),
  Object.freeze({ itemId: 28, amount: 80 }),
  Object.freeze({ itemId: 29, amount: 100 }),
  Object.freeze({ itemId: 21, amount: 200 }),
  Object.freeze({ itemId: 31, amount: 200 }),
  Object.freeze({ itemId: 20, amount: Infinity }),
]);

function mechanicsMoves(mechanicsDocument) {
  const mechanics = mechanicsDocument?.data ?? mechanicsDocument ?? {};
  return new Map((Array.isArray(mechanics.moves)
    ? mechanics.moves
    : Object.values(mechanics.moves ?? {}))
    .map((move) => [Number(move?.id), move]));
}

function itemQuantity(memory, itemId) {
  const bag = memory?.trainer?.bag ?? {};
  return Number(Object.values(bag).flat().find(
    (entry) => Number(entry?.itemId) === Number(itemId),
  )?.quantity ?? 0);
}

function hasItem(memory, itemId) {
  return itemQuantity(memory, itemId) > 0;
}

function statusItemFor(memory, status1) {
  const status = Number(status1 ?? 0) >>> 0;
  if (status === 0) return null;
  const specificCure = [...STATUS_ITEM_MASKS].find(([itemId, mask]) =>
    (status & mask) !== 0 && hasItem(memory, itemId)
  )?.[0] ?? null;
  return specificCure ??
    ALL_STATUS_ITEMS.find((itemId) => hasItem(memory, itemId)) ?? null;
}

export function isStatusRecoveryItem(itemId) {
  const numericItemId = Number(itemId);
  return numericItemId === 19 ||
    ALL_STATUS_ITEMS.includes(numericItemId) ||
    STATUS_ITEM_MASKS.has(numericItemId);
}

export function isRecoveryItem(itemId) {
  const numericItemId = Number(itemId);
  return isStatusRecoveryItem(numericItemId) ||
    REVIVE_ITEMS.includes(numericItemId) ||
    HP_ITEMS.some(({ itemId: candidate }) => candidate === numericItemId) ||
    ELIXIR_ITEMS.includes(numericItemId) || SINGLE_PP_ITEMS.includes(numericItemId);
}

function hpItemFor(memory, deficit) {
  const available = HP_ITEMS.filter(({ itemId }) => hasItem(memory, itemId));
  const sufficient = available.find(({ amount }) => amount >= deficit);
  return sufficient?.itemId ?? available.at(-1)?.itemId ??
    (hasItem(memory, 19) ? 19 : null);
}

function movePpDeficit(member, movesById) {
  const moves = member?.moves ?? [];
  const pp = member?.pp ?? [];
  return moves.reduce((total, moveId, slot) => {
    const basePp = Number(movesById.get(Number(moveId))?.pp);
    const ppUps = (Number(member?.ppBonuses ?? 0) >> (slot * 2)) & 0x03;
    const maximum = Number.isSafeInteger(basePp)
      ? Math.floor(basePp * (5 + ppUps) / 5)
      : null;
    return Number.isSafeInteger(maximum) && maximum > 0
      ? total + Math.max(0, maximum - Number(pp[slot] ?? 0))
      : total;
  }, 0);
}

function mostInjured(party) {
  return [...party].sort((left, right) =>
    (Number(right.maxHp) - Number(right.hp)) -
      (Number(left.maxHp) - Number(left.hp)) ||
    Number(left.slot) - Number(right.slot)
  )[0] ?? null;
}

function mostPpDepleted(party, movesById) {
  return [...party].map((member) => ({
    member,
    deficit: movePpDeficit(member, movesById),
  })).filter(({ deficit }) => deficit > 0)
    .sort((left, right) =>
      right.deficit - left.deficit ||
      Number(left.member.slot) - Number(right.member.slot)
    )[0]?.member ?? null;
}

export function recoveryPpMove(member, mechanics = null) {
  const movesById = mechanicsMoves(mechanics);
  return (member?.moves ?? []).flatMap((moveId, slot) => {
    const base = Number(movesById.get(Number(moveId))?.pp);
    const pp = Number(member.pp?.[slot]);
    const ups = (Number(member.ppBonuses ?? 0) >> (slot * 2)) & 3;
    const maximum = Math.floor(base * (5 + ups) / 5);
    return moveId && Number.isSafeInteger(pp) && pp >= 0 && maximum > pp &&
      pp <= Math.max(2, Math.floor(maximum / 4))
      ? [{slot, moveId, pp, maximum, deficit:maximum - pp,
          attacking: Boolean(moveDamageKind(movesById.get(Number(moveId))))}] : [];
  }).sort((a,b) => Number(b.attacking) - Number(a.attacking) || Number(a.pp !== 0) - Number(b.pp !== 0) ||
    b.deficit - a.deficit || a.slot - b.slot)[0] ?? null;
}

function ppRecoveryTarget(party, mechanics) {
  return party.map(member => ({member, move:recoveryPpMove(member,mechanics)}))
    .filter(({move}) => move)
    .sort((a,b) => Number(b.move.attacking) - Number(a.move.attacking) || Number(a.move.pp !== 0) - Number(b.move.pp !== 0) ||
      b.move.deficit - a.move.deficit || Number(a.member.slot) - Number(b.member.slot))[0] ?? null;
}

export function hasAttackingMove(member, mechanics) {
  const moves = mechanicsMoves(mechanics);
  return (member.moves ?? []).some(id => id &&
    (moves.size ? Boolean(moveDamageKind(moves.get(Number(id)))) || moves.get(Number(id))?.effect === 'EFFECT_TRANSFORM' : true));
}

export function hasUsableAttackingPp(member, mechanics) {
  const moves = mechanicsMoves(mechanics);
  return (member.moves ?? []).some((id, slot) => id && Number(member.pp?.[slot]) > 0 &&
    (moves.size ? Boolean(moveDamageKind(moves.get(Number(id))))||moves.get(Number(id))?.effect==='EFFECT_TRANSFORM' : true));
}

export function recoveryTargetForItem(memory, itemId, mechanics = null) {
  const party = memory?.trainer?.party ?? [];
  const numericItemId = Number(itemId);
  if (REVIVE_ITEMS.includes(numericItemId)) {
    return party.find(({ hp, maxHp }) =>
      Number(maxHp) > 0 && Number(hp) === 0
    ) ?? null;
  }
  const living = party.filter(({ hp, maxHp }) =>
    Number(maxHp) > 0 && Number(hp) > 0
  );
  if (numericItemId === 19) {
    return living.find(({ hp, maxHp, status1 }) =>
      Number(status1 ?? 0) !== 0 && Number(hp) < Number(maxHp)
    ) ?? living.find(({ status1 }) => Number(status1 ?? 0) !== 0) ??
      mostInjured(living.filter(({ hp, maxHp }) => Number(hp) < Number(maxHp)));
  }
  if (ALL_STATUS_ITEMS.includes(numericItemId)) {
    return living.find(({ status1 }) => Number(status1 ?? 0) !== 0) ?? null;
  }
  const statusMask = STATUS_ITEM_MASKS.get(numericItemId);
  if (statusMask) {
    return living.find(({ status1 }) =>
      (Number(status1 ?? 0) & statusMask) !== 0
    ) ?? null;
  }
  if (HP_ITEMS.some(({ itemId: candidate }) => candidate === numericItemId)) {
    return mostInjured(living.filter(({ hp, maxHp }) =>
      Number(hp) < Number(maxHp)
    ));
  }
  if (ELIXIR_ITEMS.includes(numericItemId)) {
    return mostPpDepleted(living, mechanicsMoves(mechanics));
  }
  if (SINGLE_PP_ITEMS.includes(numericItemId)) {
    return ppRecoveryTarget(living, mechanics)?.member ?? null;
  }
  return null;
}

export function nextRecoveryTreatment(memory, mechanics = null, {travel=false} = {}) {
  const party = memory?.trainer?.party ?? [];
  const fainted = party.find(({ hp, maxHp }) =>
    Number(maxHp) > 0 && Number(hp) === 0
  );
  const reviveItemId = REVIVE_ITEMS.find((itemId) => hasItem(memory, itemId));
  if (fainted && reviveItemId) {
    return Object.freeze({
      kind: "revive",
      itemId: reviveItemId,
      target: fainted,
    });
  }

  const living = party.filter(({ hp, maxHp }) =>
    Number(maxHp) > 0 && Number(hp) > 0
  );
  const statusTarget = living.find(({ status1 }) => Number(status1 ?? 0) !== 0);
  if (statusTarget) {
    const statusItemId = statusItemFor(memory, statusTarget.status1);
    const itemId = statusItemId ?? (hasItem(memory, 19) ? 19 : null);
    if (itemId) {
      return Object.freeze({
        kind: itemId === 19 && Number(statusTarget.hp) < Number(statusTarget.maxHp)
          ? "full-restore"
          : "status",
        itemId,
        target: statusTarget,
      });
    }
  }

  const injured = mostInjured(living.filter(({ hp, maxHp }) =>
    Number(hp) < Number(maxHp) && (!travel || Number(hp) / Number(maxHp) <= 0.65)
  ));
  if (injured) {
    const itemId = hpItemFor(memory, Number(injured.maxHp) - Number(injured.hp));
    if (itemId) {
      return Object.freeze({ kind: "hp", itemId, target: injured });
    }
  }

  const ppTarget = ppRecoveryTarget(living, mechanics);
  if (!ppTarget) return null;
  const singleItemId = SINGLE_PP_ITEMS.find(itemId => hasItem(memory,itemId));
  if (singleItemId) return Object.freeze({kind:'pp',itemId:singleItemId,
    target:ppTarget.member,moveSlot:ppTarget.move.slot});
  const elixirItemId = [36,37].find((itemId) => hasItem(memory, itemId));
  return elixirItemId
    ? Object.freeze({ kind: "pp", itemId: elixirItemId,
        target: mostPpDepleted(living.filter(p=>recoveryPpMove(p,mechanics)), mechanicsMoves(mechanics)) })
    : null;
}

export function partyFullyRestored(memory, mechanics = null) {
  const party = memory?.trainer?.party ?? [];
  if (party.length === 0) return false;
  const movesById = mechanicsMoves(mechanics);
  return party.every((member) =>
    Number(member.maxHp) > 0 &&
    Number(member.hp) === Number(member.maxHp) &&
    Number(member.status1 ?? 0) === 0 &&
    movePpDeficit(member, movesById) === 0
  );
}

export function partyMaximallyRecovered(memory, mechanics = null) {
  const party = memory?.trainer?.party ?? [];
  return party.length > 0 && nextRecoveryTreatment(memory, mechanics) === null;
}
