import assert from "node:assert/strict";
import test from "node:test";

import { deriveBattleLegality } from "../src/player/battle-legality.js";

const LOCAL_WILD = 1 << 2;
const mechanics = {
  moves: {
    33: { id: 33, power: 40 },
    45: { id: 45, power: 0 },
    73: { id: 73, power: 0 },
    79: { id: 79, power: 0 },
  },
};

function legality({
  battleTypeFlags = LOCAL_WILD,
  player = {},
  opponent = {},
  runAttempts = 0,
  party = [
    { slot: 0, hp: 30, maxHp: 30 },
    { slot: 1, hp: 30, maxHp: 30 },
  ],
} = {}) {
  const normalizedPlayer = {
    battler: 0,
    ability: 0,
    item: 0,
    types: [10, 10],
    status2: 0,
    status3: 0,
    stats: { speed: 40 },
    ...player,
  };
  const normalizedOpponent = {
    battler: 1,
    ability: 0,
    types: [3, 3],
    stats: { speed: 30 },
    ...opponent,
  };
  return deriveBattleLegality({
    battleTypeFlags,
    mechanics,
    party,
    battle: {
      player: normalizedPlayer,
      opponent: normalizedOpponent,
      battlers: [normalizedPlayer, normalizedOpponent, null, null],
      playerPartySlot: 0,
      runAttempts,
    },
  });
}

test("escape legality follows FireRed's native trap precedence", () => {
  const cases = [
    { name: "ordinary wild battle", input: {}, allowed: true, blocker: null },
    {
      name: "trainer battle",
      input: { battleTypeFlags: LOCAL_WILD | (1 << 3) },
      allowed: false,
      blocker: "trainer-battle",
    },
    {
      name: "first battle",
      input: { battleTypeFlags: LOCAL_WILD | (1 << 4) },
      allowed: false,
      blocker: "first-battle",
    },
    {
      name: "Wrap or Bind",
      input: { player: { status2: 3 << 13 } },
      allowed: false,
      blocker: "wrapped",
    },
    {
      name: "Mean Look",
      input: { player: { status2: 1 << 26 } },
      allowed: false,
      blocker: "escape-prevention",
    },
    {
      name: "Ingrain",
      input: { player: { status3: 1 << 10 } },
      allowed: false,
      blocker: "rooted",
    },
    {
      name: "Shadow Tag",
      input: { opponent: { ability: 23 } },
      allowed: false,
      blocker: "shadow-tag",
    },
    {
      name: "Arena Trap on a grounded target",
      input: { opponent: { ability: 71 } },
      allowed: false,
      blocker: "arena-trap",
    },
    {
      name: "Arena Trap against Flying",
      input: { player: { types: [2, 2] }, opponent: { ability: 71 } },
      allowed: true,
      blocker: null,
    },
    {
      name: "Arena Trap against Levitate",
      input: { player: { ability: 26 }, opponent: { ability: 71 } },
      allowed: true,
      blocker: null,
    },
    {
      name: "Magnet Pull against Steel",
      input: { player: { types: [8, 8] }, opponent: { ability: 42 } },
      allowed: false,
      blocker: "magnet-pull",
    },
    {
      name: "Smoke Ball overrides a volatile trap",
      input: { player: { item: 194, status2: 3 << 13 } },
      allowed: true,
      blocker: null,
    },
    {
      name: "Run Away overrides a volatile trap",
      input: { player: { ability: 50, status2: 3 << 13 } },
      allowed: true,
      blocker: null,
    },
  ];

  for (const entry of cases) {
    const result = legality(entry.input);
    assert.equal(result.run.allowed, entry.allowed, entry.name);
    assert.equal(result.run.blockers[0] ?? null, entry.blocker, entry.name);
  }
});

test("escape odds reproduce FireRed's native speed and retry formula", () => {
  let result = legality({
    player: { stats: { speed: 40 } },
    opponent: { stats: { speed: 30 } },
  });
  assert.equal(result.run.guaranteed, true);
  assert.equal(result.run.probability, 1);

  result = legality({
    player: { stats: { speed: 20 } },
    opponent: { stats: { speed: 40 } },
  });
  assert.equal(result.run.guaranteed, false);
  assert.equal(result.run.probability, 64 / 256);

  result = legality({
    player: { stats: { speed: 20 } },
    opponent: { stats: { speed: 40 } },
    runAttempts: 2,
  });
  assert.equal(result.run.probability, 124 / 256);

  result = legality({
    player: { item: 194, stats: { speed: 1 } },
    opponent: { stats: { speed: 200 } },
  });
  assert.equal(result.run.guaranteed, true);
  assert.equal(result.run.probability, 1);

  result = legality({ player: { status2: 3 << 13 } });
  assert.equal(result.run.probability, 0);
});

test("forced move continuations remain owned by FireRed's turn engine", () => {
  let result = legality({ player: { status2: 1 << 12 } });
  assert.deepEqual(result.forcedAction, {
    active: true,
    kind: "multi-turn-continuation",
  });

  result = legality({ player: { status2: 1 << 22 } });
  assert.deepEqual(result.forcedAction, {
    active: true,
    kind: "recharge",
  });

  result = legality();
  assert.deepEqual(result.forcedAction, { active: false, kind: null });
});

test("item-menu legality follows FireRed's restricted battle modes", () => {
  assert.equal(legality().bag.allowed, true);
  assert.equal(legality({ battleTypeFlags: LOCAL_WILD | (1 << 8) }).bag.allowed,
    false);
  assert.equal(legality({ battleTypeFlags: LOCAL_WILD | (1 << 11) }).bag.allowed,
    false);
  assert.equal(legality({ battleTypeFlags: LOCAL_WILD | (1 << 1) }).bag.allowed,
    false);
});

test("move selection excludes every restriction checked by FireRed", () => {
  const cases = [
    {
      name: "zero PP",
      player: { moves: [33, 45, 0, 0], pp: [0, 10, 0, 0] },
      selectableSlots: [1],
    },
    {
      name: "Disable",
      player: {
        moves: [33, 45, 0, 0],
        pp: [10, 10, 0, 0],
        moveState: { disabledMove: 33, disableTurns: 2 },
      },
      selectableSlots: [1],
    },
    {
      name: "Torment",
      player: {
        moves: [33, 45, 0, 0],
        pp: [10, 10, 0, 0],
        status2: 1 << 31,
        moveState: { lastMove: 33 },
      },
      selectableSlots: [1],
    },
    {
      name: "Taunt",
      player: {
        moves: [33, 45, 0, 0],
        pp: [10, 10, 0, 0],
        moveState: { tauntTurns: 2 },
      },
      selectableSlots: [0],
    },
    {
      name: "Imprison",
      player: { moves: [33, 45, 0, 0], pp: [10, 10, 0, 0] },
      opponent: { moves: [33, 73, 0, 0], status3: 1 << 13 },
      selectableSlots: [1],
    },
    {
      name: "Encore",
      player: {
        moves: [33, 45, 79, 0],
        pp: [10, 10, 10, 0],
        moveState: { encoredMove: 79, encoreTurns: 2 },
      },
      selectableSlots: [2],
    },
    {
      name: "Choice Band",
      player: {
        item: 186,
        moves: [33, 45, 0, 0],
        pp: [10, 10, 0, 0],
        moveState: { choiceLockedMove: 33 },
      },
      selectableSlots: [0],
    },
  ];

  for (const entry of cases) {
    const result = legality({ player: entry.player, opponent: entry.opponent });
    assert.deepEqual(result.moves?.selectableSlots, entry.selectableSlots, entry.name);
    assert.equal(result.moves?.struggle, false, entry.name);
  }
});

test("proactive switching obeys traps even when running has an override", () => {
  const cases = [
    { name: "healthy reserve", input: {}, allowed: true, blocker: null },
    {
      name: "no healthy reserve",
      input: { party: [{ slot: 0, hp: 30, maxHp: 30 }] },
      allowed: false,
      blocker: "no-usable-replacement",
    },
    {
      name: "Smoke Ball does not permit switching through Wrap",
      input: { player: { item: 194, status2: 3 << 13 } },
      allowed: false,
      blocker: "wrapped",
    },
    {
      name: "Run Away does not permit switching through Mean Look",
      input: { player: { ability: 50, status2: 1 << 26 } },
      allowed: false,
      blocker: "escape-prevention",
    },
    {
      name: "Shadow Tag prevents switching",
      input: { opponent: { ability: 23 } },
      allowed: false,
      blocker: "shadow-tag",
    },
    {
      name: "Flying avoids Arena Trap",
      input: { player: { types: [2, 2] }, opponent: { ability: 71 } },
      allowed: true,
      blocker: null,
    },
  ];

  for (const entry of cases) {
    const result = legality(entry.input);
    assert.equal(result.switch?.allowed, entry.allowed, entry.name);
    assert.equal(result.switch?.blockers?.[0] ?? null, entry.blocker, entry.name);
  }
});

test("a double battle never treats the active partner as a switch reserve", () => {
  const playerLeft = {
    battler: 0,
    species: 1,
    ability: 0,
    item: 0,
    types: [10, 10],
    status2: 0,
    status3: 0,
  };
  const opponentLeft = { battler: 1, species: 4, ability: 0 };
  const playerRight = { battler: 2, species: 25, ability: 0 };
  const opponentRight = { battler: 3, species: 7, ability: 0 };

  const result = deriveBattleLegality({
    battleTypeFlags: LOCAL_WILD | (1 << 3) | (1 << 0),
    mechanics,
    party: [
      { slot: 0, species: 1, hp: 30, maxHp: 30 },
      { slot: 1, species: 25, hp: 30, maxHp: 30 },
    ],
    battle: {
      player: playerLeft,
      opponent: opponentLeft,
      battlers: [playerLeft, opponentLeft, playerRight, opponentRight],
      battlerPartyIndexes: [0, 0, 1, 1],
      playerPartySlot: 0,
      absentBattlerFlags: 0,
    },
  });

  assert.equal(result.switch.allowed, false);
  assert.deepEqual(result.switch.blockers, ["no-usable-replacement"]);
});
