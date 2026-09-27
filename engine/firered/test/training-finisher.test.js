import assert from "node:assert/strict";
import test from "node:test";
import { createPolicyAdvisors } from "../src/player/advisors.js";

const mechanics = {
  moves: {
    33: { id: 33, name: "MOVE_TACKLE", power: 35, accuracy: 95, type: "TYPE_NORMAL", effect: "EFFECT_HIT" },
    55: { id: 55, name: "MOVE_WATER_GUN", power: 40, accuracy: 100, type: "TYPE_WATER", effect: "EFFECT_HIT" },
    88: { id: 88, name: "MOVE_ROCK_THROW", power: 50, accuracy: 90, type: "TYPE_ROCK", effect: "EFFECT_HIT" },
    16: { id: 16, name: "MOVE_GUST", power: 40, accuracy: 100, type: "TYPE_FLYING", effect: "EFFECT_GUST" },
  },
  species: {
    104: { id: 104, types: ["TYPE_GROUND"] },
    8: { id: 8, types: ["TYPE_WATER"] },
    95: { id: 95, types: ["TYPE_ROCK", "TYPE_GROUND"] },
    16: { id: 16, name: "SPECIES_PIDGEY", types: ["TYPE_NORMAL", "TYPE_FLYING"] },
  },
  typeChart: [
    { attackingType: "TYPE_ROCK", defendingType: "TYPE_FLYING", multiplier: 20 },
    { attackingType: "TYPE_FLYING", defendingType: "TYPE_ROCK", multiplier: 5 },
    { attackingType: "TYPE_NORMAL", defendingType: "TYPE_ROCK", multiplier: 5 },
    { attackingType: "TYPE_WATER", defendingType: "TYPE_WATER", multiplier: 5 },
  ],
};

function trainingBattle({ activeSlot = 0, mask = 1, training = true, flags = 12,
  patchActive = {}, opponent = {}, ui = { battle: { stage: "action", cursor: 0 } } } = {}) {
  const party = [
    { slot: 0, species: 104, level: 25, hp: 64, maxHp: 64, moves: [33], pp: [35],
      stats: { attack: 35, defense: 60, spAttack: 30, spDefense: 40 } },
    { slot: 1, species: 8, level: 34, hp: 84, maxHp: 89, moves: [55], pp: [25],
      stats: { attack: 55, defense: 65, spAttack: 55, spDefense: 65 } },
    { slot: 2, species: 95, level: 36, hp: 66, maxHp: 76, moves: [88], pp: [7],
      stats: { attack: 45, defense: 115, spAttack: 35, spDefense: 50 } },
  ];
  Object.assign(party[activeSlot], patchActive);
  const story = { id: "silph-liberated", importantBattle: true,
    target: { kind: "map-arrival", map: "MAP_SILPH_CO_11F" } };
  const trainingObjective = { id: "train-battle-member-with-vs-seeker", trainingSource: "vs-seeker",
    trainingMethod: "switch", trainingPartySlot: 0, trainingSpecies: 104,
    escortPartySlot: 1, escortSpecies: 8, forObjective: story.id,
    target: { kind: "object", map: "MAP_ROUTE6", index: 1 },
    trainer: { id: 630, maximumLevel: 40 } };
  const observation = { captureId: "training-battle", frame: 100, phase: "stable",
    emulator: { mode: "battle", inputReady: true },
    playerMemory: { map: { id: "MAP_ROUTE6" }, battleTypeFlags: flags,
      trainer: { party, partyCount: 3, usablePartyCount: party.filter(p => p.hp > 0).length, bag: { items: [] } },
      battle: { playerPartySlot: activeSlot, player: { ...party[activeSlot] },
        sentPartyMasks: mask === null ? null : [mask, 0],
        opponent: { species: 16, level: 18, hp: 42, maxHp: 42, moves: [16], pp: [35],
          stats: { attack: 30, defense: 25, spAttack: 25, spDefense: 25 }, ...opponent } }, ui } };
  const campaignPlanner = { select: () => story, selectTraining: () => training ? trainingObjective : null };
  const advise = () => createPolicyAdvisors({ mechanics, campaignPlanner })
    .find(({ id }) => id === "battle").advise(observation)?.recommendation;
  return { observation, party, advise };
}

test("training sends its trainee directly to the suitable finisher instead of an intermediate escort", () => {
  const { advise, observation } = trainingBattle();
  assert.equal(advise()?.targetPartySlot, 2, "Onix should face Pidgey immediately");
  observation.playerMemory.ui = { party: { stage: "choose-pokemon", cursor: 0 } };
  assert.equal(advise()?.targetPartySlot, 2, "party selection must keep the same finisher");
});

test("a healthy participating finisher attacks without adding a third XP recipient", () => {
  const { advise } = trainingBattle({ activeSlot: 1, mask: 3 });
  assert.deepEqual(advise(), { kind: "choose-battle-command", targetCommand: "fight" });
});

for (const [name, patchActive, opponent, want] of [
  ["low HP", { hp: 20 }, {}, "protect-struggling-pokemon"],
  ["depleted damaging PP", { pp: [0] }, {}, "protect-struggling-pokemon"],
  ["a credible knockout threat", { stats: { attack: 55, defense: 3, spAttack: 55, spDefense: 65 } }, {}, "improve-battle-matchup"],
]) test(`training finisher can still switch for ${name}`, () => {
  const { advise } = trainingBattle({ activeSlot: 1, mask: 3, patchActive, opponent });
  const recommendation = advise();
  assert.equal(recommendation?.targetCommand, "pokemon");
  assert.equal(recommendation?.objective, want);
  assert.equal(recommendation?.targetPartySlot, 2);
});

// Resisted moves or a higher opponent level alone no longer pay for a switch
// while the finisher still wins its KO race against this Pidgey or Wartortle.
for (const [name, opponent] of [["only resisted moves", { species: 8 }], ["underlevel danger", { level: 37 }]])
  test(`training finisher keeps a won KO race despite ${name}`, () => {
    const { advise } = trainingBattle({ activeSlot: 1, mask: 3, opponent });
    assert.deepEqual(advise(), { kind: "choose-battle-command", targetCommand: "fight" });
  });

test("the next opponent requires fresh trainee participation", () => {
  const { advise } = trainingBattle({ activeSlot: 2, mask: 4 });
  assert.equal(advise()?.objective, "train-team-anchor");
  assert.equal(advise()?.targetPartySlot, 0);
});

test("a comparable planned escort remains eligible when its coverage is suitable", () => {
  const { party, advise } = trainingBattle();
  Object.assign(party[2], { level: 35, moves: [33], pp: [35],
    stats: { attack: 50, defense: 115, spAttack: 35, spDefense: 50 } });
  assert.equal(advise()?.targetPartySlot, 1);
});

test("training finisher retention requires observed participation and leaves ordinary battle tactics available", () => {
  // Unobserved participation still sends the trainee, and doubles (no race
  // estimate) keep the score upgrade. Without training, a single-battle
  // finisher that wins its KO race needs no retention rule to keep attacking.
  for (const options of [{ mask: null }, { flags: 13 }]) {
    const { advise } = trainingBattle({ activeSlot: 1, mask: 3, ...options });
    assert.equal(advise()?.targetCommand, "pokemon");
  }
  assert.equal(trainingBattle({ activeSlot: 1, mask: 3, training: false }).advise()?.targetCommand, "fight");
});

test('an overlevelled escort does not take routine XP away from an adequate party member',()=>{
  const {party,advise,observation}=trainingBattle();
  party[2].level=62;
  assert.equal(advise()?.targetPartySlot,1);
  observation.playerMemory.ui={party:{stage:'choose-pokemon',cursor:0}};
  assert.equal(advise()?.targetPartySlot,1,'keep the choice through the replacement menu');
});

test('ordinary trainers do not draw in an overlevelled attacker when the current fighter is adequate',()=>{
  const {party,advise}=trainingBattle({activeSlot:1,training:false});party[2].level=62;
  assert.deepEqual(advise(),{kind:'choose-battle-command',targetCommand:'fight'});
});

test('a capable trainee keeps its XP through the action and move menus despite a coverage upgrade',()=>{
  const {advise,observation}=trainingBattle({patchActive:{level:34,hp:100,maxHp:100,
    stats:{attack:100,defense:90,spAttack:80,spDefense:90}}});
  assert.deepEqual(advise(),{kind:'choose-battle-command',targetCommand:'fight'});
  observation.playerMemory.ui={battle:{stage:'move',cursor:0,selectedMoveId:33}};
  assert.equal(advise()?.kind,'choose-battle-move');
  assert.equal(advise()?.targetMoveSlot,0);
});

test('direct trainee retention never overrides depleted PP, low health or a knockout threat',()=>{
  for(const patch of [{pp:[0]},{hp:15},{stats:{attack:100,defense:1,spAttack:80,spDefense:90}}]){
    const {advise}=trainingBattle({patchActive:{level:34,hp:100,maxHp:100,
      stats:{attack:100,defense:90,spAttack:80,spDefense:90},...patch}});
    assert.equal(advise()?.targetCommand,'pokemon');
  }
});

test('single-opponent training estimates do not override double-battle protection',()=>{
  const {advise}=trainingBattle({flags:13,patchActive:{level:34,hp:100,maxHp:100,
    stats:{attack:100,defense:90,spAttack:80,spDefense:90}}});
  assert.equal(advise()?.targetCommand,'pokemon');
  assert.equal(advise()?.objective,'protect-training-member');
});
