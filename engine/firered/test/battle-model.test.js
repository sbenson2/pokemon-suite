import assert from "node:assert/strict";
import test from "node:test";
import { scoreBattleMoves } from "../src/player/advisors.js";
import { battleDecisionState, captureMoveMaximumCriticalDamage, maximumCredibleIncomingDamage, selectCapturePreparationMove } from "../src/player/battle-model.js";

test('double-battle item and party menus retain the battler that opened them', () => {
  const left = { battler: 0, species: 5, hp: 74, maxHp: 87 };
  const right = { battler: 2, species: 15, hp: 7, maxHp: 93 };
  const memory = { battleTypeFlags: 13, activeBattler: 4, battleMenuBattler: 2,
    battle: { player: left, battlers: [left, { battler: 1, species: 78 }, right], battlerPartyIndexes: [0, 0, 2], playerPartySlot: 0 },
    trainer: { party: [{ ...left, slot: 0 }, { ...right, slot: 2 }] } };
  for (const ui of [{ battle: { stage: 'action', battler: 2 } }, { bag: { stage: 'list' } },
    { bag: { stage: 'context' } }, { party: { stage: 'choose-pokemon', itemId: 22 } }, { party: { stage: 'selection-menu' } }]) {
    const value = battleDecisionState(memory, ui);
    assert.equal(value.player.species, 15, JSON.stringify(ui));
    assert.equal(value.player.hp, 7);
    assert.equal(value.playerPartySlot, 2);
  }
  assert.equal(battleDecisionState(memory, { battle: { stage: 'action', battler: 0 } }).player.species, 5,
    'A new action cursor supersedes the previous item menu owner.');
  assert.equal(battleDecisionState({ ...memory, activeBattler: 0 }, {}).player.species, 5,
    'The menu owner must not leak outside a menu.');
  assert.equal(battleDecisionState({ ...memory, battleTypeFlags: 8 }, { bag: {} }).player.species, 5,
    'Single battles never use a second player battler.');
  assert.equal(battleDecisionState({ ...memory, battleMenuBattler: 3 }, { bag: {} }).player.species, 5,
    'An opponent cannot own the player item menu.');
});

const mechanics = {
  species: { 1: { types: ["TYPE_NORMAL"] }, 2: { types: ["TYPE_NORMAL"] } },
  moves: {
    1: { id: 1, power: 100, accuracy: 100, type: "TYPE_NORMAL" },
    2: { id: 2, power: 100, accuracy: 100, type: "TYPE_FIRE" },
    3: { id: 3, power: 100, accuracy: 100, type: "TYPE_WATER" },
    4: { id: 4, power: 120, accuracy: 70, type: "TYPE_ELECTRIC", effect: "EFFECT_THUNDER" },
    5: { id: 5, power: 60, accuracy: 0, type: "TYPE_FLYING" },
  },
};
const player = { species: 1, moves: [1, 2, 3, 4, 5], pp: [10, 10, 10, 10, 10],
  stats: { attack: 100, spAttack: 100 } };
const opponent = { species: 2, stats: { defense: 100, spDefense: 100 } };
const scores = (attacker = {}, target = {}, weather = 0) => Object.fromEntries(
  scoreBattleMoves({ mechanics, player: { ...player, ...attacker },
    opponent: { ...opponent, ...target }, weather }).map(({ moveId, score }) => [moveId, score]),
);

test('Counter and Mirror Coat are not modeled as ordinary one-power attacks',()=>{
 for(const effect of ['EFFECT_COUNTER','EFFECT_MIRROR_COAT']){
  const rules={...mechanics,moves:{1:{id:1,power:1,type:'TYPE_NORMAL',effect},2:{id:2,power:0,type:'TYPE_NORMAL',effect:'EFFECT_SAFEGUARD'}}};
  const attacker={...player,level:30,moves:[1,2],pp:[10,10]};
  const defender={...opponent,hp:150,maxHp:150};
  assert.equal(maximumCredibleIncomingDamage({mechanics:rules,attacker,defender}),null,effect);
  assert.equal(maximumCredibleIncomingDamage({mechanics:rules,attacker:{...attacker,pp:[0,10]},defender}),0,'exhausted retaliation cannot hit');
 }
});

test("burn halves physical offense, but Guts uses its status boost instead", () => {
  assert.equal(scores({ status1: 16 })[1], 75);
  assert.equal(scores({ status1: 16 })[2], 100);
  assert.equal(scores({ status1: 16, ability: 62 })[1], 225);
});

test("rain and sun modify FireRed move damage and Thunder accuracy", () => {
  assert.equal(scores({}, {}, 1)[2], 50);
  assert.equal(scores({}, {}, 1)[3], 150);
  assert.equal(scores({}, {}, 1)[4], 120);
  assert.equal(scores({}, {}, 32)[2], 150);
  assert.equal(scores({}, {}, 32)[3], 50);
  assert.equal(scores({}, {}, 32)[4], 60);
  assert.equal(scores({ ability: 77 }, {}, 32)[3], 100);
});

test("accuracy and evasion stages affect expected damage without penalizing always-hit moves", () => {
  assert.equal(scores({ statStages: { accuracy: 0 } })[1], 49.5);
  assert.equal(scores({}, { statStages: { evasion: 12 } })[1], 49.5);
  assert.equal(scores({ statStages: { accuracy: 0 } })[5], 60);
  assert.equal(scores({ statStages: { accuracy: 12 } })[4], 120);
});

test("capture and incoming-damage bounds share burn, weather, and known ability immunity", () => {
  const attacker = { ...player, level: 50 };
  const defender = { ...opponent, hp: 150, maxHp: 150 };
  const incoming = (move, extra = {}, target = {}) => maximumCredibleIncomingDamage({
    mechanics, attacker: { ...attacker, moves: [move], pp: [10], ...extra },
    defender: { ...defender, ...target },
  });
  const capture = (move, extra = {}, target = {}) => captureMoveMaximumCriticalDamage({
    mechanics, player: { ...attacker, ...extra }, opponent: { ...defender, ...target }, move: mechanics.moves[move],
  });
  assert.equal(incoming(1), 69);
  assert.equal(incoming(1, { status1: 16 }), 36);
  assert.equal(capture(1, { status1: 16 }), 72);
  assert.equal(incoming(3, { battleWeather: 1 }), 68);
  assert.equal(capture(3, { battleWeather: 1 }), 136);
  assert.equal(incoming(3, {}, { ability: 11 }), 0);
  assert.equal(capture(3, {}, { ability: 11 }), 0);
  assert.equal(incoming(1, { statStages: { accuracy: 0 } }), 69,
    "a survival bound must not assume an inaccurate attack misses");
});

test("cartridge accuracy abilities, Foresight, and always-hit effects are respected", () => {
  assert.equal(scores({ ability: 14 })[4], 109.2);
  assert.equal(scores({ ability: 55 })[1], 180); // 150 STAB × 1.5 Attack × .8 accuracy
  assert.equal(scores({}, { ability: 8 }, 8)[1], 120);
  assert.equal(scores({}, { statStages: { evasion: 12 }, status2: 1 << 29 })[1], 150);
});

test("fixed-damage battle moves share one normalized damage scale and preserve immunity and PP", () => {
  const fixedMechanics = {
    species: {
      1: { types: ["TYPE_FIGHTING"] },
      2: { types: ["TYPE_NORMAL"] },
      3: { types: ["TYPE_GHOST"] },
    },
    typeChart: [
      { attackingType: "TYPE_NORMAL", defendingType: "TYPE_GHOST", multiplier: 0 },
      { attackingType: "TYPE_FIGHTING", defendingType: "TYPE_GHOST", multiplier: 0 },
      { attackingType: "TYPE_DRAGON", defendingType: "TYPE_NORMAL", multiplier: 20 },
    ],
    moves: {
      49: { id: 49, name: "MOVE_SONIC_BOOM", power: 1, accuracy: 90,
        type: "TYPE_NORMAL", effect: "EFFECT_SONICBOOM" },
      69: { id: 69, name: "MOVE_SEISMIC_TOSS", power: 1, accuracy: 100,
        type: "TYPE_FIGHTING", effect: "EFFECT_LEVEL_DAMAGE" },
      82: { id: 82, name: "MOVE_DRAGON_RAGE", power: 1, accuracy: 100,
        type: "TYPE_DRAGON", effect: "EFFECT_DRAGON_RAGE" },
      67: { id: 67, name: "MOVE_LOW_KICK", power: 1, accuracy: 100,
        type: "TYPE_FIGHTING", effect: "EFFECT_LOW_KICK" },
    },
  };
  const attacker = { species: 1, level: 26, moves: [49, 69, 82, 67],
    pp: [10, 10, 10, 10], stats: { attack: 50, spAttack: 30 } };
  const target = { species: 2, stats: { defense: 35, spDefense: 30 } };
  const scored = scoreBattleMoves({ mechanics: fixedMechanics, player: attacker,
    opponent: target });

  assert.deepEqual(scored.map(({ moveId }) => moveId), [82, 69, 49]);
  const byMove = Object.fromEntries(scored.map(({ moveId, score }) => [moveId, score]));
  assert.ok(Math.abs(byMove[49] - 18 * 50 / (2 * 26 / 5 + 2)) < 1e-12);
  assert.ok(Math.abs(byMove[69] - 26 * 50 / (2 * 26 / 5 + 2)) < 1e-12);
  assert.ok(Math.abs(byMove[82] - 40 * 50 / (2 * 26 / 5 + 2)) < 1e-12);
  assert.equal(scored.some(({ moveId }) => moveId === 67), false,
    "unsupported weight damage must not masquerade as one-power damage");
  const immuneScores = scoreBattleMoves({ mechanics: fixedMechanics,
    player: { ...attacker, moves: [49, 69, 67], pp: [10, 10, 10] },
    opponent: { ...target, species: 3 } });
  assert.deepEqual(immuneScores.map(({ moveId, score }) => [moveId, score]), [
    [49, 0], [69, 0],
  ]);
  assert.equal(scoreBattleMoves({ mechanics: fixedMechanics,
    player: { ...attacker, moves: [49], pp: [0] }, opponent: target }).length, 0);
});

test("incoming survival damage recognizes the native SonicBoom effect spelling", () => {
  const fixedMechanics = {
    species: { 1: { types: ["TYPE_NORMAL"] }, 2: { types: ["TYPE_NORMAL"] } },
    moves: { 49: { id: 49, power: 1, accuracy: 90, type: "TYPE_NORMAL",
      effect: "EFFECT_SONICBOOM" } },
  };
  assert.equal(maximumCredibleIncomingDamage({ mechanics: fixedMechanics,
    attacker: { species: 1, level: 20, moves: [49], pp: [20] },
    defender: { species: 2, hp: 60, maxHp: 60 } }), 20);
});

test("capture preparation rejects a Double Slap whose five critical hits can KO the target", () => {
  const move = { id: 3, power: 15, type: "TYPE_NORMAL", effect: "EFFECT_MULTI_HIT" };
  const attacker = { species: 1, level: 10, moves: [3], pp: [10], stats: { attack: 20 } };
  const target = { species: 2, hp: 20, maxHp: 20, stats: { defense: 20 } };
  const data = { ...mechanics, moves: { 3: move } };
  // Each maximal critical hit is 9 HP here; five hits are 45, not 9.
  assert.equal(captureMoveMaximumCriticalDamage({ mechanics: data, player: attacker, opponent: target, move }), 45);
  assert.equal(selectCapturePreparationMove({ mechanics: data, player: attacker, opponent: target,
    selectableMoveSlots: new Set([0]) }), null);
});

test("capture weakening rejects unbounded, residual, recoil, self-KO, and unknown move effects", () => {
  for (const effect of ["EFFECT_LEVEL_DAMAGE", "EFFECT_OHKO", "EFFECT_EXPLOSION", "EFFECT_RECOIL",
    "EFFECT_POISON_HIT", "EFFECT_BURN_HIT", "EFFECT_ROLLOUT", "EFFECT_MAGNITUDE", "EFFECT_UNKNOWN", undefined]) {
    const move = { id: 1, power: 1, type: "TYPE_NORMAL", effect };
    assert.equal(selectCapturePreparationMove({ mechanics: { ...mechanics, moves: { 1: move } },
      player: { ...player, level: 10, moves: [1] }, opponent: { ...opponent, hp: 100, maxHp: 100 },
      selectableMoveSlots: new Set([0]) }), null, String(effect));
  }
});
