import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import test from "node:test";
import * as runs from "../src/suite/campaign-run.js";
import { createRunProfile, PLAYER_PRESET_NAMES } from "../src/player/run-profile.js";
import { createPolicyAdvisors } from "../src/player/advisors.js";
import { mapRecommendation } from "../src/player/delegator.js";
import { createFireRedRosterContext } from "../src/player/fire-red-roster.js";
import { rosterContextFixture } from "../test-support/roster-context-fixture.js";

// Goal requests (G2): "new game as NOVA with Squirtle" chooses the trainer name
// and the starter. The name is part of the committed run; the New Game keyboard
// types it instead of one of the three official presets.
const context = () => createFireRedRosterContext(rosterContextFixture());
const draft = delta => ({ label: "Goal run", starter: "squirtle", teamMode: "random", helpers: "allowed", seedMode: "fresh", seed: null, teamSeed: null, ...delta });
const mechanics = { moves: {}, species: {}, typeChart: [] };

function namingObservation({ text = "", page = 1, x = 0, y = 0, state = 2 } = {}) {
  const captureId = "capture-7", frame = 7;
  return {
    captureId, frame, phase: "stable", phaseReasons: [],
    emulator: { captureId, frame, mode: "boot", inputReady: true, callback2: "CB2_NamingScreen" },
    sram: { captureId, frame, sha256: "sram" },
    playerMemory: {
      captureId, frame, sha256: "memory", map: { id: null }, position: null,
      trainer: { usablePartyCount: 0, party: [] }, battle: null,
      ui: { battle: null, party: null, fieldDialog: null, choiceMenu: null, startMenu: null, saveDialog: null,
        moveLearning: null, levelUp: null, evolution: null, blackout: null, newGame: null,
        naming: { stage: "enter-player-preset", subject: "player", template: 0, state, inputReady: state === 2, text, page, cursor: { x, y } } },
    },
  };
}
const quest = (runProfile, observed) => createPolicyAdvisors({ mechanics, runProfile })
  .flatMap(advisor => advisor.advise(observed) ?? []).find(({ advisor }) => advisor === "quest");

test("campaign settings accept an optional trainer name the keyboard can type", () => {
  assert.equal(runs.DEFAULT_RUN_SETTINGS.trainerName, null, "the preset names stay the default");
  assert.equal(runs.validateRunSettings(draft()).trainerName, null);
  assert.equal(runs.validateRunSettings(draft({ trainerName: "NOVA" })).trainerName, "NOVA");
  assert.equal(runs.validateRunSettings(draft({ trainerName: "Nova" })).trainerName, "Nova", "FireRed names keep their case");
  assert.equal(runs.validateRunSettings(draft({ trainerName: "ABCDEFG" })).trainerName, "ABCDEFG", "seven characters is the FireRed limit");
  for (const bad of ["", " ", "ABCDEFGH", "SH4WN", "ASH!", "A B", "Ãsh", 7, true, {}]) {
    assert.throws(() => runs.validateRunSettings(draft({ trainerName: bad })), /trainer name/i, JSON.stringify(bad));
  }
});

test("a chosen trainer name is committed in the run profile and survives restore", () => {
  const rosterContext = context();
  const run = runs.createCampaignRun({ settings: draft({ trainerName: "Nova" }), rosterContext });
  assert.equal(run.settings.trainerName, "Nova");
  assert.equal(run.runProfile.playerName, "Nova");
  assert.equal(run.runProfile.playerNameSource, "owner");
  assert.equal(run.runProfile.playerPresetIndex, null, "no official preset is selected");
  assert.equal(run.runProfile.starter.species, 7, "the chosen starter is kept");
  assert.deepEqual(runs.restoreCampaignRun(JSON.parse(JSON.stringify(run)), rosterContext), run);
  assert.equal(runs.presentCampaignRun(run).settings.trainerName, "Nova");
  const renamed = structuredClone(run); renamed.runProfile.playerName = "GARY";
  assert.throws(() => runs.restoreCampaignRun(renamed, rosterContext), /commitment|changed/i);
});

test("runs committed before trainer names still restore with their preset", () => {
  // Older run records have no trainerName setting. Their commitment must still verify.
  const rosterContext = context();
  const current = runs.createCampaignRun({ settings: draft({ seedMode: "replay", seed: 53, teamSeed: 42 }), rosterContext });
  const { trainerName, ...settings } = current.settings;
  assert.equal(trainerName, null);
  const legacy = { ...current, settings };
  delete legacy.commitment;
  legacy.commitment = createHash("sha256").update(JSON.stringify({ schema: legacy.schema, id: legacy.id, game: legacy.game,
    createdAt: legacy.createdAt, settings: legacy.settings, seed: legacy.seed, teamSeed: legacy.teamSeed,
    runProfile: legacy.runProfile, teamPlan: legacy.teamPlan, romSha1: legacy.romSha1 })).digest("hex");
  assert.deepEqual(runs.restoreCampaignRun(legacy, rosterContext), legacy);
  assert.ok(PLAYER_PRESET_NAMES[legacy.runProfile.gender].includes(legacy.runProfile.playerName));
});

test("run profiles type the owner's name only when one is chosen", () => {
  for (let seed = 0; seed < 54; seed++) {
    assert.deepEqual(createRunProfile(seed, { playerName: null }), createRunProfile(seed), "no name keeps the seeded preset profile");
  }
  const named = createRunProfile(53, { starter: "charmander", playerName: "NOVA" });
  const preset = createRunProfile(53, { starter: "charmander" });
  assert.equal(named.playerName, "NOVA");
  assert.equal(named.gender, preset.gender);
  assert.equal(named.rivalName, preset.rivalName);
  assert.deepEqual(named.starter, preset.starter);
  assert.throws(() => createRunProfile(0, { playerName: "TOOLONGX" }), /name/i);
  assert.throws(() => createRunProfile(0, { playerName: "R3D" }), /name/i);
});

test("the New Game keyboard enters the owner's trainer name instead of a preset", () => {
  const runProfile = createRunProfile(0, { starter: "squirtle", playerName: "Nova" });
  const observed = namingObservation({ text: "", x: 0, y: 0 });
  const recommendation = quest(runProfile, observed).recommendation;
  assert.equal(recommendation.kind, "enter-naming-screen-text");
  assert.equal(recommendation.targetText, "Nova");
  assert.equal(recommendation.objective, "enter-owner-player-name");
  const press = state => mapRecommendation(recommendation, namingObservation(state)).buttons;
  // "N" is row 2, column 1 on the letter pages.
  assert.deepEqual(press({ text: "", x: 0, y: 0 }), ["down"]);
  assert.deepEqual(press({ text: "", x: 1, y: 2 }), ["a"]);
  // Lower-case letters are on the second letter page; Select switches pages.
  assert.deepEqual(press({ text: "N", x: 1, y: 2, page: 1 }), ["select"]);
  assert.deepEqual(press({ text: "N", x: 2, y: 2, page: 2 }), ["a"], "o is under O on the lower-case page");
  assert.deepEqual(press({ text: "NO", x: 2, y: 2, page: 2 }), ["b"], "a wrong-case letter is erased");
  assert.deepEqual(press({ text: "No", x: 2, y: 3, page: 2 }), ["a"], "v is under V");
  assert.deepEqual(press({ text: "Nova", x: 3, y: 2, page: 2 }), ["start"]);
  assert.deepEqual(press({ text: "Nova", x: 8, y: 2, page: 2 }), ["a"]);
  // Preset runs are unchanged.
  const preset = quest(createRunProfile(53), namingObservation()).recommendation;
  assert.equal(preset.targetText, "OMI");
  assert.equal(preset.objective, "enter-official-player-preset");
});

test("names the keyboard automation cannot type are never entered", () => {
  const typed = targetText => mapRecommendation({ kind: "enter-naming-screen-text", subject: "player", targetText }, namingObservation({ text: "", x: 0, y: 0 })).buttons;
  assert.deepEqual(typed("ABCDEFGH"), [], "eight characters exceed the player name buffer");
  assert.deepEqual(typed("R3D"), []);
});
