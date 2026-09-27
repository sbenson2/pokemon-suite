import assert from "node:assert/strict";
import test from "node:test";
import { selectBattleRosterObjective } from "../src/player/campaign.js";
import { createPolicyAdvisors } from "../src/player/advisors.js";
import { mapRecommendation } from "../src/player/delegator.js";

const center = {
  id: "MAP_LAVENDER_TOWN_POKEMON_CENTER_1F",
  connections: [], warpEvents: [], objectEvents: [], coordEvents: [],
  layout: { width: 5, height: 5, cells: Array.from({ length: 25 }, (_, i) => ({
    x: i % 5, y: Math.floor(i / 5), collision: 0, elevation: 3,
    behaviorName: i === 8 ? "MB_PC" : "MB_NORMAL", encounterType: 0,
  })) },
};
const world = { maps: [center] };
const teamPlan = {
  schema: "master-red/permanent-team-plan/v1", starterFamily: [4, 5, 6],
  acquisitions: [[41, 42], [43, 44, 45], [63, 64, 65], [129, 130], [98, 99]]
    .map(family => ({ family })), utilityAcquisitions: [],
};
const mon = (species, slot, moves = [33], level = 26) => ({
  species, slot, moves, level, hp: 60, maxHp: 60,
});
function observed(party, stored = []) {
  return {
    phase: "stable", frame: 1, captureId: "pc-roster",
    emulator: { mode: "storage", inputReady: true },
    playerMemory: {
      map: { id: center.id }, position: { x: 3, y: 2 },
      trainer: { party, partyCount: party.length, usablePartyCount: party.length,
        storage: { pokemon: stored, boxCounts: [stored.length] } },
      ui: { storage: { stage: "storage-main", boxOption: "deposit",
        cursorArea: "party", cursorPosition: 0, currentBox: 0 } },
    },
  };
}
const objective = {
  id: "badge-thunder", importantBattle: true, minimumBattlePartySize: 4,
  requiredApproachMoveIds: [15],
  preferredFamilies: [[63, 64, 65], [56, 57], [4, 5, 6], [129, 130], [41, 42], [43, 44, 45]],
};
const plan = (observation, battle = objective, team = teamPlan) =>
  selectBattleRosterObjective({ world, observation, objective: battle, teamPlan: team });
function advise(observation, selected, team = teamPlan) {
  return createPolicyAdvisors({ world, teamPlan: team, campaignPlanner: { select: () => selected } })
    .flatMap(advisor => advisor.advise(observation) ?? [])
    .find(proposal => proposal.advisor === "quest")?.recommendation;
}

test("battle preferences leave room for Cut and the starter before opening the PC", () => {
  const o = observed([mon(56, 0), mon(5, 1), mon(64, 2), mon(43, 3, [71, 230, 15], 13), mon(129, 4, [150], 5)],
    [{ ...mon(42, 1), box: 0 }]);
  const roster = plan(o);
  assert.equal(roster.target.maximumPartySize, 4);
  const action = advise(o, roster);
  assert.equal(action.kind, "choose-storage-party-member");
  assert.equal(action.targetSpecies, 129, "deposit Magikarp, retaining the starter, counters and Cut");
  o.playerMemory.trainer.storage.pokemon.push({ ...o.playerMemory.trainer.party.pop(), box: 0 });
  assert.equal(plan(o), null, "the requested roster must become ready after that deposit");
});

test("one member can cover the starter and several approach roles without losing a battle slot", () => {
  const o = observed([mon(5, 0, [15, 19]), mon(64, 1), mon(56, 2), mon(129, 3)]);
  // The starter's permanent family is never classified as a utility acquisition.
  assert.equal(plan(o, { ...objective, requiredApproachMoveIds: [15, 19] }), null);
});

test("multiple required utility carriers reserve multiple slots within the six-member limit", () => {
  const team = { ...teamPlan, utilityAcquisitions: [{ family: [46, 47] }, { family: [54, 55] }] };
  const party = [mon(5, 0), mon(64, 1), mon(56, 2), mon(129, 3), mon(46, 4, [15]), mon(54, 5, [57])];
  assert.equal(plan(observed(party), { ...objective, minimumBattlePartySize: 6,
    requiredApproachMoveIds: [15, 57] }, team), null);
});

test("PC deposits an interchangeable carrier only while every satisfied role stays covered", () => {
  const o = observed([mon(5, 0), mon(43, 1, [15], 13), mon(46, 2, [15], 12)]);
  const roster = { id: "shared-cut", target: { kind: "party-roster", map: center.id,
    minimumPartySize: 2, maximumPartySize: 2, requiredFamilies: [[4, 5, 6], [43, 46]] } };
  assert.equal(advise(o, roster).targetSpecies, 46);
  o.playerMemory.trainer.party.pop();
  assert.equal(advise(o, roster).kind, "exit-storage-mode");
});

test("PC preserves the sole representative of an overlapping requirement", () => {
  const o = observed([mon(5, 0), mon(43, 1, [15], 13), mon(46, 2, [15], 12)]);
  const roster = { id: "overlapping-roles", target: { kind: "party-roster", map: center.id,
    minimumPartySize: 2, maximumPartySize: 2, requiredFamilies: [[4, 5, 6], [43, 46], [46, 47]] } };
  assert.equal(advise(o, roster).targetSpecies, 43);
});

test("PC can deposit duplicate species without removing the last required representative", () => {
  const o = observed([mon(5, 0), mon(43, 1, [15], 25), mon(43, 2, [15], 13)]);
  const roster = { id: "duplicate-family", target: { kind: "party-roster", map: center.id,
    minimumPartySize: 2, maximumPartySize: 2, requiredFamilies: [[4, 5, 6], [43]] } };
  assert.equal(advise(o, roster).targetPartySlot, 2);
});

test("PC keeps the actual move carrier when another Pokemon of that species lacks the move", () => {
  const o = observed([mon(5, 0), mon(43, 1, [15], 13), mon(43, 2, [148], 25)]);
  const roster = { id: "actual-cut", target: { kind: "party-roster", map: center.id,
    minimumPartySize: 2, maximumPartySize: 2, requiredFamilies: [[4, 5, 6], [43]], requiredMoveIds: [15] } };
  assert.equal(advise(o, roster).targetPartySlot, 2);
});

test("a matching species without the required move still needs a PC withdrawal", () => {
  const o = observed([mon(5, 0), mon(64, 1), mon(56, 2), mon(43, 3, [71], 25)],
    [{ ...mon(43, 1, [15], 13), box: 0 }]);
  const roster = plan(o);
  assert.ok(roster, "species alone is not evidence of Cut coverage");
  assert.deepEqual(roster.target.requiredMoveIds, [15]);
  o.playerMemory.ui.storage.boxOption = "withdraw";
  const action = advise(o, roster);
  assert.equal(action.kind, "choose-storage-box-member");
  assert.equal(action.targetBoxSlot, 1);
});

test("PC confirmation cancels a different same-species member at the cursor", () => {
  const o = observed([mon(5, 0), mon(43, 1, [15], 13), mon(43, 2, [148], 25)],
    [{ ...mon(43, 0, [71]), box: 0 }, { ...mon(43, 1, [15]), box: 0 }]);
  const roster = { id: "actual-cut", target: { kind: "party-roster", map: center.id,
    minimumPartySize: 2, maximumPartySize: 2, requiredFamilies: [[4, 5, 6], [43]], requiredMoveIds: [15] } };
  o.playerMemory.ui.storage.stage = "pokemon-menu";
  o.playerMemory.ui.storage.cursorPosition = 1;
  assert.equal(advise(o, roster).kind, "cancel-storage-action", "do not deposit the Cut carrier by species alone");
  o.playerMemory.trainer.party = [mon(5, 0), mon(43, 1, [71])];
  o.playerMemory.ui.storage.boxOption = "withdraw";
  o.playerMemory.ui.storage.cursorPosition = 0;
  assert.equal(advise(o, roster).kind, "cancel-storage-action", "do not withdraw the wrong Oddish by species alone");
});

test("incompatible mandatory roles stop before entering a PC transaction", () => {
  const party = [mon(5, 0), mon(43, 1, [15]), mon(41, 2, [19]), mon(129, 3, [57]), mon(64, 4, [70]), mon(56, 5, [148])];
  const o = observed(party, [{ ...mon(98, 0, [249]), box: 0 }]);
  assert.equal(plan(o, { ...objective, requiredApproachMoveIds: [15, 19, 57, 70, 148, 249] }).blockedReason,
    "required-roster-exceeds-party-capacity");
});

test("PC replaces an excess utility member when party size is right but the combat count is short", () => {
  const team = { ...teamPlan, acquisitions: [], utilityAcquisitions: [{ family: [46, 47] }, { family: [54, 55] }] };
  const battle = { ...objective, preferredFamilies: [], requiredApproachMoveIds: [15] };
  const o = observed([mon(5, 0), mon(64, 1), mon(56, 2), mon(46, 3, [15]), mon(54, 4, [57])],
    [{ ...mon(129, 0, [150]), box: 0 }]);
  let roster = plan(o, battle, team);
  assert.equal(roster.target.maximumPartySize, 5);
  assert.equal(roster.target.minimumCombatPartySize, 4);
  assert.equal(advise(o, roster, team).targetSpecies, 54);
  o.playerMemory.trainer.storage.pokemon.push({ ...o.playerMemory.trainer.party.pop(), box: 0 });
  o.playerMemory.ui.storage.boxOption = "withdraw";
  roster = plan(o, battle, team);
  assert.equal(advise(o, roster, team).targetSpecies, 129);
  o.playerMemory.trainer.party.push(o.playerMemory.trainer.storage.pokemon.shift());
  assert.equal(plan(o, battle, team), null);
});

function atTerminal(o) {
  o.emulator.mode = "overworld";
  o.playerMemory.avatar = { facing: "north" };
  o.playerMemory.ui = { choiceMenu: {
    cursor: 0, minCursor: 0, maxCursor: 4, columns: 0, rows: 0, selected: null,
  } };
  return o;
}

test("a completed identity withdrawal logs off even while the old roster objective is retained", () => {
  const paras = { ...mon(46, 0, [15]), box: 0, validity: "valid", personality: 123,
    otId: 456, ivs: { hp: 1, attack: 2, defense: 3, speed: 4, spAttack: 5, spDefense: 6 } };
  const roster = { id: "withdraw-cut", target: { kind: "party-roster", map: center.id,
    requiredFingerprints: ["[46,123,456,1,2,3,4,5,6]"], requiredFamilies: [[85], [131]],
    minimumPartySize: 2, maximumPartySize: 6 } };
  const o = atTerminal(observed([mon(85, 0, [19]), mon(131, 1, [57]),
    { ...paras, slot: 2, personality: 999 }], [paras]));
  assert.deepEqual(mapRecommendation(advise(o, roster), o).buttons, ["a"],
    "a different Paras does not satisfy the requested identity");
  o.playerMemory.trainer.party.push({ ...paras, slot: 3 });
  o.playerMemory.trainer.storage.pokemon = [];
  o.emulator.mode = "storage";
  o.playerMemory.ui = { storage: { stage: "pc-menu", option: 0, selected: "withdraw" } };
  assert.deepEqual(mapRecommendation(advise(o, roster), o).buttons, ["b"]);
  atTerminal(o);
  assert.deepEqual(mapRecommendation(advise(o, roster), o).buttons, ["b"],
    "finish the terminal transaction instead of reopening Bill's PC");
});

for (const { name, target, before, after, stored = [], team = teamPlan } of [
  { name: "required move", target: { requiredMoveIds: [15] },
    before: [mon(5, 0), mon(43, 1, [71])], after: [mon(5, 0), mon(43, 1, [15])],
    stored: [{ ...mon(43, 0, [15]), box: 0 }] },
  { name: "maximum party size", target: { maximumPartySize: 2 },
    before: [mon(5, 0), mon(43, 1), mon(56, 2)], after: [mon(5, 0), mon(43, 1)] },
  { name: "minimum party size", target: { minimumPartySize: 3 },
    before: [mon(5, 0), mon(43, 1)], after: [mon(5, 0), mon(43, 1), mon(56, 2)],
    stored: [{ ...mon(56, 0), box: 0 }] },
  { name: "excluded utility replacement", target: { excludeHmUtilityCarriers: true },
    before: [mon(5, 0), mon(46, 1, [15])], after: [mon(5, 0), mon(64, 1)],
    stored: [{ ...mon(64, 0), box: 0 }],
    team: { ...teamPlan, utilityAcquisitions: [{ family: [46, 47] }] } },
]) {
  test(`the terminal closes only after its ${name} transaction is done`, () => {
    const roster = { id: "prepare-roster", target: { kind: "party-roster", map: center.id, ...target } };
    const o = atTerminal(observed(before, stored));
    assert.deepEqual(mapRecommendation(advise(o, roster, team), o).buttons, ["a"]);
    o.playerMemory.trainer.party = after;
    assert.deepEqual(mapRecommendation(advise(o, roster, team), o).buttons, ["b"]);
  });
}

test("a native save waits for a normal map refresh when PC allocations have exhausted field memory", () => {
  const outside = { ...center, id: "MAP_LAVENDER_TOWN", warpEvents: [
    { x: 3, y: 4, dest_map: center.id, dest_warp_id: "0" },
  ] };
  const inside = { ...center, warpEvents: [
    { x: 3, y: 4, dest_map: outside.id, dest_warp_id: "0" },
  ] };
  const localWorld = { maps: [inside, outside] };
  const save = { id: "save-preparation", target: { kind: "save-game", map: center.id, saveVerified: false } };
  const o = observed([mon(5, 0), mon(46, 1, [15])]);
  o.emulator.mode = "overworld"; o.playerMemory.ui = {};
  o.playerMemory.fieldHeap = { validity: "valid", largestFreeBlock: 4672 };
  const action = () => createPolicyAdvisors({ world: localWorld, campaignPlanner: { select: () => save } })
    .flatMap(a => a.advise(o) ?? []).find(p => p.advisor === "quest")?.recommendation;
  assert.equal(action().kind, "move-toward", "refresh field allocations through a normal reversible exit before saving");
  o.playerMemory.ui.startMenu = { cursor: 4, order: ["pokedex", "pokemon", "bag", "player", "save", "option", "exit"] };
  assert.equal(action().kind, "close-menu", "do not enter a save dialog with insufficient cartridge heap");
  o.playerMemory.ui = {}; o.playerMemory.map.id = outside.id;
  o.playerMemory.fieldHeap.largestFreeBlock = 70000;
  assert.equal(action().kind, "open-start-menu", "the pending native save resumes after the cartridge refresh");
  o.playerMemory.fieldHeap.largestFreeBlock = 4672;
  outside.warpEvents = [];
  assert.equal(action().kind, "stop-for-review", "without a verified return doorway, keep the save pending");
  o.playerMemory.ui = { saveDialog: { stage: 'saving' } };
  assert.equal(action().kind, "wait-for-supported-objective", "never interrupt a native write already in progress");
});
