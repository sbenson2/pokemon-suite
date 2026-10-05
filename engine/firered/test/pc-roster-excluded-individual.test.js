import assert from "node:assert/strict";
import test from "node:test";
import { createPolicyAdvisors } from "../src/player/advisors.js";
import { encounterFingerprint } from "../src/player/encounter-tracker.js";

// A protected Day Care parent (a shiny) goes back into the PC before the Egg is
// hatched, so it never walks thousands of steps in the party. The roster names
// that exact individual; species rules alone could deposit its look-alike.
const center = {
  id: "MAP_FOUR_ISLAND_POKEMON_CENTER_1F",
  connections: [], warpEvents: [], objectEvents: [], coordEvents: [],
  layout: { width: 5, height: 5, cells: Array.from({ length: 25 }, (_, i) => ({
    x: i % 5, y: Math.floor(i / 5), collision: 0, elevation: 3,
    behaviorName: i === 8 ? "MB_PC" : "MB_NORMAL", encounterType: 0,
  })) },
};
const world = { maps: [center] };
const mon = (species, slot, personality, more = {}) => ({ species, slot, personality, otId: 7, validity: "valid", moves: [33], level: 30, hp: 60, maxHp: 60,
  ivs: { hp: 1, attack: 2, defense: 3, speed: 4, spAttack: 5, spDefense: 6 }, ...more });
function observed(party, stored = [], boxOption = "deposit") {
  return { phase: "stable", frame: 1, captureId: "excluded", emulator: { mode: "storage", inputReady: true },
    playerMemory: { map: { id: center.id }, position: { x: 3, y: 2 },
      trainer: { party, partyCount: party.length, usablePartyCount: party.length, storage: { pokemon: stored, boxCounts: [stored.length] } },
      ui: { storage: { stage: "storage-main", boxOption, cursorArea: "party", cursorPosition: 0, currentBox: 0 } } } };
}
const advise = (observation, selected) => createPolicyAdvisors({ world, campaignPlanner: { select: () => selected } })
  .flatMap(advisor => advisor.advise(observation) ?? []).find(proposal => proposal.advisor === "quest")?.recommendation;

test("a roster deposits the exact excluded individual, not a same-species look-alike", () => {
  const lead = mon(22, 0, 1, { moves: [19] }), plain = mon(133, 1, 2), egg = mon(133, 2, 3, { isEgg: true, level: 5 }),
    shiny = mon(133, 3, 4, { shiny: true }), ditto = mon(132, 4, 5);
  const roster = { id: "return-protected", target: { kind: "party-roster", map: center.id,
    excludedFingerprints: [encounterFingerprint(shiny)], requiredFingerprints: [encounterFingerprint(egg)] } };
  const o = observed([lead, plain, egg, shiny, ditto]);
  const action = advise(o, roster);
  assert.equal(action?.kind, "choose-storage-party-member");
  assert.equal(action.targetPartySlot, 3, "deposit the named shiny");
  o.playerMemory.trainer.party = [lead, plain, egg, ditto];
  o.playerMemory.trainer.storage.pokemon = [{ ...shiny, box: 0, slot: 0 }];
  assert.equal(advise(o, roster)?.kind, "exit-storage-mode", "the roster is complete once it is stored");
});

test("a roster never withdraws an excluded individual to fill the party", () => {
  const lead = mon(22, 0, 1, { moves: [19] }), shiny = mon(133, 0, 4, { shiny: true, box: 0 }), spare = mon(19, 1, 6, { box: 0, level: 3 });
  const roster = { id: "fill", target: { kind: "party-roster", map: center.id, minimumPartySize: 2, excludedFingerprints: [encounterFingerprint(shiny)] } };
  const o = observed([lead], [shiny, spare], "withdraw");
  o.playerMemory.ui.storage.cursorArea = "box";
  const action = advise(o, roster);
  assert.equal(action?.kind, "choose-storage-box-member");
  assert.equal(action.targetBoxSlot, 1, "the spare Rattata, never the excluded shiny");
});
