import assert from "node:assert/strict";
import test from "node:test";
import { createPolicyAdvisors } from "../src/player/advisors.js";
import { mapRecommendation } from "../src/player/delegator.js";
import { encounterFingerprint as fingerprint } from "../src/player/encounter-tracker.js";

// The Four Island Pokemon Center PC (a single MB_PC cell) and a release target:
// an Egg-sticker hatchling in Box 6, slot 7.
const center = {
  id: "MAP_FOUR_ISLAND_POKEMON_CENTER_1F",
  connections: [], warpEvents: [], objectEvents: [], coordEvents: [],
  layout: { width: 5, height: 5, cells: Array.from({ length: 25 }, (_, i) => ({
    x: i % 5, y: Math.floor(i / 5), collision: 0, elevation: 3,
    behaviorName: i === 8 ? "MB_PC" : "MB_NORMAL", encounterType: 0,
  })) },
};
const world = { maps: [center] };
const hatchling = (slot, extra = {}) => ({ validity: "valid", box: 5, slot, species: 19, personality: 4000 + slot, otId: 1706568373,
  shiny: false, isEgg: false, heldItem: 0, experience: 125, friendship: 120, metLevel: 0, moves: [33, 39, 0, 0],
  ivs: { hp: 1, attack: 2, defense: 3, speed: 4, spAttack: 5, spDefense: 6 }, ...extra });
const target = hatchling(7);
const release = { fingerprint: fingerprint(target), box: 5, slot: 7, species: 19, personality: target.personality, otId: target.otId,
  experience: 125, friendship: 120, metLevel: 0 };
const objective = { id: "acquire-postgame-pc-release-1-release", target: { kind: "party-roster", map: center.id, release },
  dialogue: "advance", choice: "yes", deferOptionalDetours: true, identityEvolution: true };
const partyMember = slot => ({ validity: "valid", slot, species: 149, personality: 10 + slot, otId: 1706568373, level: 100, hp: 300, maxHp: 300,
  moves: [19, 57, 0, 0], ivs: { hp: 0, attack: 0, defense: 0, speed: 0, spAttack: 0, spDefense: 0 } });

function observed(storage, { party = 6, stored = [hatchling(6), target, hatchling(8)] } = {}) {
  return {
    phase: "stable", frame: 1, captureId: "pc-release",
    emulator: { mode: storage ? "storage" : "overworld", inputReady: true },
    playerMemory: {
      map: { id: center.id }, position: { x: 3, y: 2 }, avatar: { facing: "north" },
      trainer: { party: Array.from({ length: party }, (_, i) => partyMember(i)), partyValidity: "valid", partyCount: party,
        storage: { validity: "valid", currentBox: 5, pokemon: stored, boxCounts: [0, 0, 0, 0, 0, stored.length, 0, 0, 0, 0, 0, 0, 0, 0] } },
      ui: storage ? { storage } : {},
    },
  };
}
const main = (extra = {}) => ({ stage: "storage-main", option: null, selected: null, boxOption: "move-pokemon", cursorArea: "box",
  cursorPosition: 7, currentBox: 5, movingPokemon: false, depositBox: 0, ...extra });
const moveMenu = cursor => ({ items: ["move", "summary", "withdraw", "mark", "release", "cancel"], cursor, selected: null });
function advise(observation, selected = objective) {
  return createPolicyAdvisors({ world, campaignPlanner: { select: () => selected } })
    .flatMap(advisor => advisor.advise(observation) ?? [])
    .find(proposal => proposal.advisor === "quest")?.recommendation;
}
const buttons = (recommendation, observation) => [...mapRecommendation(recommendation, observation).buttons];

test("a full party enters Move mode; a party with room enters Withdraw mode", () => {
  const pcMenu = { stage: "pc-menu", option: 0, selected: "withdraw", boxOption: null, cursorArea: null, cursorPosition: null,
    currentBox: null, movingPokemon: null, depositBox: null };
  let o = observed(pcMenu);
  let action = advise(o);
  assert.deepEqual([action.kind, action.targetOption, action.targetIndex], ["choose-storage-option", "move-pokemon", 2],
    "the cartridge refuses Withdraw with six party Pokemon (Task_PCMainMenu)");
  assert.deepEqual(buttons(action, o), ["down"]);
  o = observed(pcMenu, { party: 5 });
  action = advise(o);
  assert.deepEqual([action.kind, action.targetOption, action.targetIndex], ["choose-storage-option", "withdraw", 0]);
  assert.deepEqual(buttons(action, o), ["a"]);
});

test("the release navigates to the planned box slot in the planned mode", () => {
  let o = observed(main({ boxOption: "deposit", cursorArea: "party", cursorPosition: 0 }));
  assert.equal(advise(o).kind, "exit-storage-mode", "a storage session in another mode is left first");
  o = observed(main({ cursorArea: "party", cursorPosition: 0 }));
  let action = advise(o);
  assert.deepEqual([action.kind, action.targetBox, action.targetBoxSlot], ["choose-storage-box-member", 5, 7]);
  assert.deepEqual(buttons(action, o), ["right"]);
  o = observed(main({ cursorPosition: 1 }));
  assert.deepEqual(buttons(advise(o), o), ["down"]);
  o = observed(main());
  assert.deepEqual(buttons(advise(o), o), ["a"], "open the menu of the Pokemon under the cursor");
  o = observed(main({ movingPokemon: true }));
  assert.equal(advise(o).kind, "withhold-unsafe-decision", "never act while a Pokemon is held");
});

test("RELEASE is chosen only for the verified planned Pokemon under the box cursor", () => {
  let o = observed(main({ stage: "pokemon-menu", menu: moveMenu(0) }));
  let action = advise(o);
  assert.deepEqual([action.kind, action.targetAction, action.targetIndex], ["choose-storage-menu-action", "release", 4]);
  assert.deepEqual(buttons(action, o), ["down"]);
  o = observed(main({ stage: "pokemon-menu", menu: moveMenu(4) }));
  assert.deepEqual(buttons(advise(o), o), ["a"]);
  o = observed(main({ stage: "pokemon-menu", menu: { items: ["withdraw", "summary", "mark", "release", "cancel"], cursor: 3, selected: "release" } }),
    { party: 5 });
  o.playerMemory.ui.storage.boxOption = "withdraw";
  action = advise(o);
  assert.deepEqual([action.kind, action.targetIndex], ["choose-storage-menu-action", 3]);
  assert.deepEqual(buttons(action, o), ["a"]);

  const cancels = {
    "another Pokemon under the cursor": observed(main({ stage: "pokemon-menu", menu: moveMenu(4), cursorPosition: 6 })),
    "the cursor in the party": observed(main({ stage: "pokemon-menu", menu: moveMenu(4), cursorArea: "party" })),
    "an unverified menu": observed(main({ stage: "pokemon-menu", menu: null })),
    "a menu without RELEASE": observed(main({ stage: "pokemon-menu", menu: { items: ["move", "summary", "cancel"], cursor: 0, selected: "move" } })),
    "a shiny at the planned slot": observed(main({ stage: "pokemon-menu", menu: moveMenu(4) }), { stored: [hatchling(6), { ...target, shiny: true }] }),
    "a held item at the planned slot": observed(main({ stage: "pokemon-menu", menu: moveMenu(4) }), { stored: [{ ...target, heldItem: 13 }] }),
    "changed experience at the planned slot": observed(main({ stage: "pokemon-menu", menu: moveMenu(4) }), { stored: [{ ...target, experience: 200 }] }),
  };
  for (const [label, observation] of Object.entries(cancels)) {
    const refused = advise(observation);
    assert.ok(["cancel-storage-action", "exit-storage-mode"].includes(refused.kind), label);
    assert.deepEqual(buttons(refused, observation), ["b"], label);
  }
});

test("the Yes/No answer re-verifies the cursor Pokemon and defaults to No", () => {
  let o = observed(main({ stage: "release-confirm", option: 1, selected: "no" }));
  let action = advise(o);
  assert.deepEqual([action.kind, action.targetOption, action.targetIndex], ["confirm-storage-release", "yes", 0]);
  assert.deepEqual(buttons(action, o), ["up"]);
  o = observed(main({ stage: "release-confirm", option: 0, selected: "yes" }));
  assert.deepEqual(buttons(advise(o), o), ["a"]);
  for (const observation of [
    observed(main({ stage: "release-confirm", option: 0, selected: "yes", cursorPosition: 8 })),
    observed(main({ stage: "release-confirm", option: 0, selected: "yes", movingPokemon: true })),
    observed(main({ stage: "release-confirm", option: 0, selected: "yes" }), { stored: [{ ...target, shiny: true }] }),
    observed(main({ stage: "release-confirm", option: 0, selected: "yes" }), { stored: [hatchling(6)] }),
  ]) {
    action = advise(observation);
    assert.deepEqual([action.kind, action.targetOption, action.targetIndex], ["confirm-storage-release", "no", 1]);
    assert.deepEqual(buttons(action, observation), ["down"]);
  }
  // Another workflow never answers Yes to a release prompt it did not plan.
  const other = { id: "withdraw", target: { kind: "party-roster", map: center.id, requiredFingerprints: [fingerprint(target)] } };
  o = observed(main({ stage: "release-confirm", option: 0, selected: "yes" }), { party: 5 });
  assert.deepEqual([advise(o, other).kind, advise(o, other).targetOption], ["confirm-storage-release", "no"]);
});

test("the release messages and a refusal are acknowledged, then the PC is left", () => {
  const gone = [hatchling(6), hatchling(8)];
  for (const stage of [{ stage: "release-message", message: "released" }, { stage: "release-message", message: "bye-bye" },
    { stage: "release-refused", message: "came-back" }]) {
    const o = observed(main(stage), { stored: stage.stage === "release-refused" ? undefined : gone });
    const action = advise(o);
    assert.equal(action.kind, "acknowledge-storage-message");
    assert.deepEqual(buttons(action, o), ["a"]);
  }
  const o = observed(main({ cursorPosition: 7 }), { stored: gone });
  assert.equal(advise(o).kind, "exit-storage-mode", "the planned Pokemon is gone: leave the box");
  const pcMenu = observed({ stage: "pc-menu", option: 2, selected: "move-pokemon", boxOption: null, cursorArea: null, cursorPosition: null,
    currentBox: null, movingPokemon: null, depositBox: null }, { stored: gone });
  assert.equal(advise(pcMenu).kind, "exit-storage");
});

test("release proposals carry the constraint the Activity view explains", () => {
  const proposal = createPolicyAdvisors({ world, campaignPlanner: { select: () => objective } })
    .flatMap(advisor => advisor.advise(observed(main())) ?? []).find(p => p.advisor === "quest");
  assert.ok(proposal.constraints.includes("release-egg-sticker-hatchling"));
  assert.ok(proposal.evidenceRefs.includes(`pc-release:${release.fingerprint}`));
  const other = { id: "withdraw", target: { kind: "party-roster", map: center.id, requiredFingerprints: [fingerprint(target)] } };
  const withdraw = createPolicyAdvisors({ world, campaignPlanner: { select: () => other } })
    .flatMap(advisor => advisor.advise(observed(main({ boxOption: "withdraw" }), { party: 5 })) ?? []).find(p => p.advisor === "quest");
  assert.ok(!withdraw.constraints.includes("release-egg-sticker-hatchling"));
});
