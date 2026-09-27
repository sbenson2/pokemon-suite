// Exact volatile-state masks from pokefirered include/constants/battle.h.
const STATUS2_WRAPPED = 0x0000e000;
const STATUS2_MULTIPLETURNS = 1 << 12;
const STATUS2_RECHARGE = 1 << 22;
const STATUS2_ESCAPE_PREVENTION = 1 << 26;
const STATUS2_TORMENT = 0x80000000;
const STATUS3_ROOTED = 1 << 10;
const STATUS3_IMPRISONED_OTHERS = 1 << 13;
const BATTLE_TYPE_LINK = 1 << 1;
const BATTLE_TYPE_TRAINER = 1 << 3;
const BATTLE_TYPE_FIRST_BATTLE = 1 << 4;
const BATTLE_TYPE_DOUBLE = 1 << 0;
const BATTLE_TYPE_MULTI = 1 << 6;
const BATTLE_TYPE_BATTLE_TOWER = 1 << 8;
const BATTLE_TYPE_EREADER_TRAINER = 1 << 11;
const BATTLE_TYPE_GHOST_UNVEILED = 1 << 13;
const BATTLE_TYPE_GHOST = 1 << 15;
const TYPE_FLYING = 2;
const TYPE_STEEL = 8;
const ABILITY_SHADOW_TAG = 23;
const ABILITY_LEVITATE = 26;
const ABILITY_MAGNET_PULL = 42;
const ABILITY_RUN_AWAY = 50;
const ABILITY_ARENA_TRAP = 71;
const ITEM_CHOICE_BAND = 186;
const ITEM_SMOKE_BALL = 194;
const PARTY_SIZE = 6;

function opposingBattlers(battle) {
  const observed = (battle?.battlers ?? []).filter(
    (battler) => battler && (Number(battler.battler) & 1) === 1,
  );
  return observed.length > 0
    ? observed
    : battle?.opponent
      ? [battle.opponent]
      : [];
}

export function reservedPlayerPartySlots({
  battleTypeFlags = 0,
  battle,
  excludeBattler = null,
} = {}) {
  const flags = Number(battleTypeFlags) >>> 0;
  if (
    (flags & BATTLE_TYPE_DOUBLE) === 0 ||
    (flags & BATTLE_TYPE_MULTI) !== 0
  ) {
    return new Set();
  }
  const excluded = excludeBattler === null ? null : Number(excludeBattler);
  return new Set([0, 2].flatMap((battler) => {
    if (excluded !== null && Number.isSafeInteger(excluded) && battler === excluded) {
      return [];
    }
    const partySlot = Number(battle?.monToSwitchIntoIds?.[battler]);
    return Number.isSafeInteger(partySlot) &&
        partySlot >= 0 && partySlot < PARTY_SIZE
      ? [partySlot]
      : [];
  }));
}

export function deriveBattleLegality({
  battleTypeFlags = 0,
  battle,
  mechanics = {},
  party = [],
} = {}) {
  const player = battle?.player;
  const flags = Number(battleTypeFlags) >>> 0;
  const status2 = Number(player?.status2 ?? 0) >>> 0;
  const status3 = Number(player?.status3 ?? 0) >>> 0;
  const ability = Number(player?.ability ?? 0);
  const item = Number(player?.item ?? 0);
  const types = player?.types ?? [];
  const opponents = opposingBattlers(battle);
  const runBlockers = [];
  const switchBlockers = [];
  const moveState = player?.moveState ?? {};
  const moveData = mechanics?.data?.moves ?? mechanics?.moves ?? {};

  const trainerBattle = (flags & BATTLE_TYPE_TRAINER) !== 0;
  const linkBattle = (flags & BATTLE_TYPE_LINK) !== 0;
  const ghostWithoutScope = (flags & BATTLE_TYPE_GHOST) !== 0 &&
    (flags & BATTLE_TYPE_GHOST_UNVEILED) === 0;
  const alwaysRuns = linkBattle || item === ITEM_SMOKE_BALL ||
    ability === ABILITY_RUN_AWAY;
  if (trainerBattle && !linkBattle) {
    runBlockers.push("trainer-battle");
  } else if (!alwaysRuns) {
    if (opponents.some(({ ability: value }) =>
      Number(value) === ABILITY_SHADOW_TAG
    )) {
      runBlockers.push("shadow-tag");
    } else if (
      ability !== ABILITY_LEVITATE &&
      !types.map(Number).includes(TYPE_FLYING) &&
      opponents.some(({ ability: value }) =>
        Number(value) === ABILITY_ARENA_TRAP
      )
    ) {
      runBlockers.push("arena-trap");
    } else if (
      types.map(Number).includes(TYPE_STEEL) &&
      opponents.some(({ ability: value }) =>
        Number(value) === ABILITY_MAGNET_PULL
      )
    ) {
      runBlockers.push("magnet-pull");
    } else if ((status2 & STATUS2_WRAPPED) !== 0) {
      runBlockers.push("wrapped");
    } else if ((status2 & STATUS2_ESCAPE_PREVENTION) !== 0) {
      runBlockers.push("escape-prevention");
    } else if ((status3 & STATUS3_ROOTED) !== 0) {
      runBlockers.push("rooted");
    } else if ((flags & BATTLE_TYPE_FIRST_BATTLE) !== 0) {
      runBlockers.push("first-battle");
    }
  }

  const activePartySlot = Number(battle?.playerPartySlot ?? 0);
  const activePartySlots = new Set([activePartySlot]);
  if ((flags & BATTLE_TYPE_DOUBLE) !== 0) {
    const absentBattlerFlags = Number(battle?.absentBattlerFlags ?? 0) >>> 0;
    for (const battler of battle?.battlers ?? []) {
      const battlerId = Number(battler?.battler);
      if (
        !battler || !Number.isSafeInteger(battlerId) ||
        (battlerId & 1) !== 0 ||
        (absentBattlerFlags & (1 << battlerId)) !== 0
      ) continue;
      const partySlot = battle?.battlerPartyIndexes?.[battlerId];
      if (Number.isSafeInteger(partySlot)) activePartySlots.add(partySlot);
    }
  }
  const reservedPartySlots = reservedPlayerPartySlots({
    battleTypeFlags: flags,
    battle,
  });
  const hasReplacement = party.some(({ slot, hp }) =>
    !activePartySlots.has(Number(slot)) &&
    !reservedPartySlots.has(Number(slot)) &&
    Number(hp) > 0
  );
  if (!hasReplacement) {
    switchBlockers.push("no-usable-replacement");
  } else if ((status2 & STATUS2_WRAPPED) !== 0) {
    switchBlockers.push("wrapped");
  } else if ((status2 & STATUS2_ESCAPE_PREVENTION) !== 0) {
    switchBlockers.push("escape-prevention");
  } else if ((status3 & STATUS3_ROOTED) !== 0) {
    switchBlockers.push("rooted");
  } else if (opponents.some(({ ability: value }) =>
    Number(value) === ABILITY_SHADOW_TAG
  )) {
    switchBlockers.push("shadow-tag");
  } else if (
    ability !== ABILITY_LEVITATE &&
    !types.map(Number).includes(TYPE_FLYING) &&
    opponents.some(({ ability: value }) =>
      Number(value) === ABILITY_ARENA_TRAP
    )
  ) {
    switchBlockers.push("arena-trap");
  } else if (
    types.map(Number).includes(TYPE_STEEL) &&
    opponents.some(({ ability: value }) =>
      Number(value) === ABILITY_MAGNET_PULL
    )
  ) {
    switchBlockers.push("magnet-pull");
  }
  const blockedMoves = (player?.moves ?? []).map((moveId, moveSlot) => {
    const reasons = [];
    const pp = Number(player?.pp?.[moveSlot] ?? 0);
    const move = Array.isArray(moveData)
      ? moveData[moveId]
      : moveData?.[moveId] ?? moveData?.[String(moveId)];
    if (!Number(moveId)) reasons.push("no-move");
    if (pp <= 0) reasons.push("no-pp");
    if (
      Number(moveId) !== 0 &&
      Number(moveState.disabledMove) === Number(moveId)
    ) {
      reasons.push("disabled");
    }
    if (
      Number(moveId) !== 0 &&
      (status2 & STATUS2_TORMENT) !== 0 &&
      Number(moveState.lastMove) === Number(moveId)
    ) {
      reasons.push("torment");
    }
    if (Number(moveState.tauntTurns) > 0 && Number(move?.power ?? 0) === 0) {
      reasons.push("taunt");
    }
    if (opponents.some((opponent) =>
      (Number(opponent.status3 ?? 0) & STATUS3_IMPRISONED_OTHERS) !== 0 &&
      (opponent.moves ?? []).map(Number).includes(Number(moveId))
    )) {
      reasons.push("imprison");
    }
    if (
      Number(moveState.encoreTurns) > 0 &&
      Number(moveState.encoredMove) !== Number(moveId)
    ) {
      reasons.push("encore");
    }
    const choiceLockedMove = Number(moveState.choiceLockedMove ?? 0);
    if (
      item === ITEM_CHOICE_BAND &&
      choiceLockedMove !== 0 &&
      choiceLockedMove !== 0xffff &&
      choiceLockedMove !== Number(moveId)
    ) {
      reasons.push("choice-band");
    }
    return Object.freeze({
      moveSlot,
      moveId: Number(moveId),
      reasons: Object.freeze(reasons),
    });
  });
  const selectableSlots = blockedMoves
    .filter(({ reasons }) => reasons.length === 0)
    .map(({ moveSlot }) => moveSlot);
  const runAllowed = runBlockers.length === 0;
  const playerSpeed = Number(player?.stats?.speed);
  const opponentSpeed = Number(battle?.opponent?.stats?.speed);
  let runProbability = null;
  let runGuaranteed = false;
  if (!runAllowed) {
    runProbability = 0;
  } else if (alwaysRuns || ghostWithoutScope) {
    runProbability = 1;
    runGuaranteed = true;
  } else if ((flags & BATTLE_TYPE_DOUBLE) !== 0) {
    runProbability = 0;
  } else if (
    Number.isFinite(playerSpeed) && playerSpeed >= 0 &&
    Number.isFinite(opponentSpeed) && opponentSpeed > 0
  ) {
    if (playerSpeed >= opponentSpeed) {
      runProbability = 1;
      runGuaranteed = true;
    } else {
      const attempts = Math.max(0, Number(battle?.runAttempts ?? 0));
      const speedVar = (
        Math.floor((playerSpeed * 128) / opponentSpeed) + attempts * 30
      ) & 0xff;
      runProbability = speedVar / 256;
    }
  }
  return Object.freeze({
    forcedAction: Object.freeze({
      active: (status2 & (STATUS2_MULTIPLETURNS | STATUS2_RECHARGE)) !== 0,
      kind: (status2 & STATUS2_MULTIPLETURNS) !== 0
        ? "multi-turn-continuation"
        : (status2 & STATUS2_RECHARGE) !== 0
          ? "recharge"
          : null,
    }),
    run: Object.freeze({
      allowed: runAllowed,
      guaranteed: runGuaranteed,
      probability: runProbability,
      unidentifiedGhost: ghostWithoutScope,
      blockers: Object.freeze(runBlockers),
    }),
    bag: Object.freeze({
      allowed: (
        flags & (
          BATTLE_TYPE_LINK |
          BATTLE_TYPE_BATTLE_TOWER |
          BATTLE_TYPE_EREADER_TRAINER
        )
      ) === 0,
    }),
    switch: Object.freeze({
      allowed: switchBlockers.length === 0,
      blockers: Object.freeze(switchBlockers),
    }),
    moves: Object.freeze({
      selectableSlots: Object.freeze(selectableSlots),
      blocked: Object.freeze(blockedMoves),
      struggle: selectableSlots.length === 0,
    }),
  });
}
