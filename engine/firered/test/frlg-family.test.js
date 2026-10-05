// The FRLG family (build 124). FireRed and LeafGreen run one engine: the same
// observer, story planner and campaign. Only facts that differ between the two
// cartridges switch on the game (its verified image, knowledge pack, roster
// identity and the Oak's-speech name presets); FireRed stays the default and
// its committed runs are unchanged.
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdtempSync, rmSync, writeFileSync, mkdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import { FRLG_GAMES, isFrlgGame, frlgGame, frlgGameForSha1, FRLG_ENCOUNTER_TABLE } from "../src/frlg.js";
import { createRunProfile, PLAYER_PRESET_NAMES, RIVAL_PRESET_NAMES, presetNames } from "../src/player/run-profile.js";
import { resolveSuiteOwner } from "../src/suite/suite-owner.js";
import { readFireRedRosterFacts } from "../src/player/fire-red-roster-facts.js";
import { createFireRedRosterContext } from "../src/player/fire-red-roster.js";
import * as runs from "../src/suite/campaign-run.js";
import { loadSuiteCampaignContext } from "../src/suite/campaign-context.js";
import { rosterContextFixture } from "../test-support/roster-context-fixture.js";

const FR_SHA1 = "dd5945db9b930750cb39d00c84da8571feebf417";
const LG_SHA1 = "7862c67bdecbe21d1d69ce082ce34327e1c6ed5e";

test("the FRLG family names each verified cartridge", () => {
  assert.deepEqual(Object.keys(FRLG_GAMES), ["firered", "leafgreen"]);
  assert.deepEqual({ ...frlgGame("leafgreen") }, { game: "leafgreen", title: "LeafGreen", cartridgeProfileId: "leafgreen-rev1-stock",
    configCartridgeId: "leafgreen-rev1", sha1: LG_SHA1, bytes: 16_777_216, gameCode: "BPGE" });
  assert.deepEqual({ ...frlgGame("firered") }, { game: "firered", title: "FireRed", cartridgeProfileId: "firered-rev1-stock",
    configCartridgeId: "firered-rev1", sha1: FR_SHA1, bytes: 16_777_216, gameCode: "BPRE" });
  assert.equal(isFrlgGame("leafgreen"), true);
  assert.equal(isFrlgGame("emerald"), false);
  assert.equal(isFrlgGame(undefined), false);
  assert.throws(() => frlgGame("crystal"), /FireRed or LeafGreen/);
  assert.equal(frlgGameForSha1(LG_SHA1).game, "leafgreen");
  assert.equal(frlgGameForSha1(FR_SHA1).game, "firered");
  assert.equal(frlgGameForSha1("0".repeat(40)), null);
  // Each knowledge pack holds only its own version's wild tables.
  assert.ok(FRLG_ENCOUNTER_TABLE.test("sRoute1_FireRed") && FRLG_ENCOUNTER_TABLE.test("sRoute1_LeafGreen"));
  assert.ok(!FRLG_ENCOUNTER_TABLE.test("sRoute1_Emerald"));
});

test("LeafGreen's run profile uses LeafGreen's own Oak's-speech presets; FireRed's is unchanged", () => {
  // pret src/oak_speech.c sMaleNameChoices/sFemaleNameChoices/sRivalNameChoices (LEAFGREEN).
  assert.deepEqual(presetNames("leafgreen"), { player: { BOY: ["GREEN", "LEAF", "GARY"], GIRL: ["GREEN", "LEAF", "OMI"] }, rival: ["RED", "ASH", "KENE"] });
  assert.deepEqual(presetNames("firered"), { player: PLAYER_PRESET_NAMES, rival: RIVAL_PRESET_NAMES });
  for (let seed = 0; seed < 54; seed++) {
    const fr = createRunProfile(seed), explicit = createRunProfile(seed, { game: "firered" }), lg = createRunProfile(seed, { game: "leafgreen" });
    assert.deepEqual(explicit, fr, "FireRed profiles are byte-identical with or without the game");
    assert.equal(JSON.stringify(explicit), JSON.stringify(fr));
    assert.deepEqual({ ...lg, playerName: fr.playerName, rivalName: fr.rivalName }, fr, "only the preset names differ");
    assert.equal(lg.playerName, presetNames("leafgreen").player[lg.gender][Math.floor(seed / 6) % 3]);
    assert.equal(lg.rivalName, presetNames("leafgreen").rival[lg.rivalMenuRow - 1]);
  }
  assert.equal(createRunProfile(7, { game: "leafgreen", playerName: "Nova" }).playerName, "Nova");
  assert.throws(() => createRunProfile(1, { game: "emerald" }), /FireRed or LeafGreen/);
});

test("a LeafGreen owner resolves like FireRed; only FireRed has partners", () => {
  const root = mkdtempSync(join(tmpdir(), "suite-lg-owner-"));
  try {
    const owner = resolveSuiteOwner({ directory: root, games: { leafgreen: { port: 1 } } }, "leafgreen");
    assert.deepEqual([owner.owner, owner.title, owner.partner, owner.directory], ["leafgreen", "leafgreen", false, join(root, "leafgreen")]);
    assert.throws(() => resolveSuiteOwner({ directory: root, games: { "leafgreen-partner": { title: "leafgreen", role: "partner" } } }, "leafgreen-partner"),
      /Unknown configured Suite game/);
  } finally { rmSync(root, { recursive: true, force: true }); }
});

function factsFixture(id) {
  const romBytes = Buffer.alloc(1024);
  const symbol = (offset, size) => ({ address: 0x08000000 + offset, region: "ROM", size });
  const symbols = { gLevelUpLearnsets: symbol(0, 12), sTMHMLearnsets: symbol(32, 24), gEvolutionTable: symbol(64, 120) };
  for (let i = 0; i < 3; i++) { romBytes.writeUInt32LE(0x08000200 + i * 8, i * 4); romBytes.writeUInt16LE(0xffff, 512 + i * 8); }
  const cartridge = { id, bytes: 1024, sha1: createHash("sha1").update(romBytes).digest("hex") };
  const mechanics = { species: { 1: { id: 1, name: "SPECIES_A", types: ["TYPE_NORMAL"] }, 2: { id: 2, name: "SPECIES_B", types: ["TYPE_NORMAL"] } }, moves: {} };
  return { romBytes, cartridge, runtime: { data: { symbols } }, mechanics };
}

test("roster facts read a LeafGreen stock cartridge with the same ABI; FireRed facts are unchanged", () => {
  const lg = readFireRedRosterFacts(factsFixture("leafgreen-rev1-stock"));
  const fr = readFireRedRosterFacts(factsFixture("firered-rev1-stock"));
  assert.deepEqual(Object.keys(fr), ["schema", "cartridgeSha1", "species", "moves", "typeChart", "constants"]);
  assert.deepEqual(lg, fr, "the two stock profiles decode the same tables the same way");
  assert.throws(() => readFireRedRosterFacts(factsFixture("emerald-us")), /fingerprint/);
});

test("the roster context carries its cartridge's identity, so LeafGreen teams are LeafGreen's own", () => {
  const fr = createFireRedRosterContext(rosterContextFixture());
  const lgFixture = rosterContextFixture(); lgFixture.facts = { ...lgFixture.facts, cartridgeSha1: LG_SHA1 };
  const lg = createFireRedRosterContext(lgFixture);
  assert.equal(fr.gameId, "firered-rev1-stock");
  assert.equal(lg.gameId, "leafgreen-rev1-stock");
  const settings = { label: "LeafGreen adventure", starter: "bulbasaur", teamMode: "random", helpers: "allowed", afterCampaign: "wait", seedMode: "replay", seed: 99, teamSeed: "hex:" + "a".repeat(64) };
  const record = runs.createCampaignRun({ settings, rosterContext: lg, romSha1: LG_SHA1, game: "leafgreen" });
  assert.equal(record.game, "leafgreen");
  assert.equal(record.runProfile.rivalName, presetNames("leafgreen").rival[record.runProfile.rivalMenuRow - 1]);
  assert.equal(runs.restoreCampaignRun(record, lg), record);
  // A LeafGreen run never restores against FireRed's roster, or as FireRed.
  assert.throws(() => runs.restoreCampaignRun(record, fr), /changed|roster/);
  assert.throws(() => runs.restoreCampaignRun({ ...record, game: "firered" }, lg), /commitment/);
  // FireRed runs are created exactly as before: game "firered" is the default.
  const frRecord = runs.createCampaignRun({ settings: { ...settings, label: "FireRed adventure", afterCampaign: "postgame" }, rosterContext: fr });
  assert.equal(frRecord.game, "firered");
  assert.equal(runs.restoreCampaignRun(frRecord, fr), frRecord);
  assert.throws(() => runs.createCampaignRun({ settings, rosterContext: fr, game: "leafgreen" }), /LeafGreen roster/);
});

test("LeafGreen runs wait after the Hall of Fame: its postgame is not implemented yet", () => {
  assert.equal(runs.defaultRunSettings("leafgreen").afterCampaign, "wait");
  assert.equal(runs.defaultRunSettings("leafgreen").label, "LeafGreen adventure");
  assert.deepEqual(runs.defaultRunSettings("firered"), runs.DEFAULT_RUN_SETTINGS);
  const lg = rosterContextFixture(); lg.facts = { ...lg.facts, cartridgeSha1: LG_SHA1 };
  assert.throws(() => runs.createCampaignRun({ settings: { label: "x", starter: "random", teamMode: "random", helpers: "allowed", afterCampaign: "postgame", seedMode: "fresh" },
    rosterContext: createFireRedRosterContext(lg), game: "leafgreen" }), /LeafGreen postgame/);
});

test("the campaign context loads the configured LeafGreen cartridge only with LeafGreen's verified image", () => {
  const root = mkdtempSync(join(tmpdir(), "suite-lg-context-"));
  try {
    const rom = join(root, "lg.gba"); writeFileSync(rom, Buffer.from("not a cartridge"));
    const inputs = {};
    for (const key of ["runtime", "world", "story", "battle"]) { inputs[key] = join(root, `${key}.json`); writeFileSync(inputs[key], "{}"); }
    const config = join(root, "config.json");
    writeFileSync(config, JSON.stringify({ directory: root, games: { leafgreen: { cartridge: { id: "leafgreen-rev1", path: rom, bytes: 15, sha1: FR_SHA1 }, inputs } } }));
    assert.throws(() => loadSuiteCampaignContext(config, "leafgreen"), /verified LeafGreen campaign cartridge/);
    assert.throws(() => loadSuiteCampaignContext(config), /verified FireRed campaign cartridge/);
    assert.throws(() => loadSuiteCampaignContext(config, "emerald"), /FireRed or LeafGreen/);
  } finally { rmSync(root, { recursive: true, force: true }); }
});
