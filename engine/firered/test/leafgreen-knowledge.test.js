// LeafGreen knowledge (build 124): the same extractors, run on pret's
// LeafGreen rev 1 build of the same pokefirered source, produce a pack of the
// same shape with LeafGreen's own wild tables and built symbol file. FireRed
// stays the default, so its pinned pack is reproduced unchanged.
import assert from "node:assert/strict";
import { mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { spawnSync } from "node:child_process";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import { KNOWLEDGE_VERSIONS, knowledgeVersion } from "../src/extractor/versions.js";
import { extractWorldStructure } from "../src/extractor/world.js";
import { extractRuntimeSymbols } from "../src/extractor/runtime.js";
import { generateKnowledgePack } from "../src/extractor/knowledge-pack.js";
import { loadResearchBundle } from "../src/research.js";

async function writeFixture(root, path, value) {
  const target = join(root, path);
  await mkdir(join(target, ".."), { recursive: true });
  await writeFile(target, Buffer.isBuffer(value) ? value : typeof value === "string" ? value : `${JSON.stringify(value, null, 2)}\n`);
}

test("the two FRLG knowledge versions name pret's own build targets", () => {
  assert.deepEqual(Object.keys(KNOWLEDGE_VERSIONS).sort(), ["firered", "leafgreen"]);
  assert.deepEqual(
    { ...knowledgeVersion("firered") },
    { game: "firered", cartridgeProfileId: "firered-rev1-stock", datasetPrefix: "firered",
      encounterSuffix: "_FireRed", buildName: "pokefirered_rev1", target: "FIRERED REVISION=1 MODERN=0" });
  assert.deepEqual(
    { ...knowledgeVersion("leafgreen") },
    { game: "leafgreen", cartridgeProfileId: "leafgreen-rev1-stock", datasetPrefix: "leafgreen",
      encounterSuffix: "_LeafGreen", buildName: "pokeleafgreen_rev1", target: "LEAFGREEN REVISION=1 MODERN=0" });
  assert.throws(() => knowledgeVersion("emerald"), /FireRed or LeafGreen/);
  assert.ok(Object.isFrozen(KNOWLEDGE_VERSIONS.leafgreen));
});

async function worldFixture(root) {
  await writeFixture(root, "data/maps/map_groups.json", { group_order: ["gMapGroup_Test"], gMapGroup_Test: ["TinyMap"] });
  await writeFixture(root, "data/maps/TinyMap/map.json", { id: "MAP_TINY_MAP", name: "TinyMap", layout: "LAYOUT_TINY",
    connections: [], object_events: [], warp_events: [], coord_events: [], bg_events: [] });
  await writeFixture(root, "data/layouts/layouts.json", { layouts: [{ id: "LAYOUT_TINY", name: "Tiny_Layout", width: 1, height: 1,
    border_width: 1, border_height: 1, primary_tileset: "gTileset_General", secondary_tileset: "gTileset_General",
    blockdata_filepath: "data/layouts/Tiny/map.bin" }] });
  await writeFixture(root, "data/layouts/Tiny/map.bin", Buffer.alloc(2));
  await writeFixture(root, "src/data/tilesets/metatiles.h",
    'const u32 gMetatileAttributes_General[] = INCBIN_U32("data/tilesets/primary/general/metatile_attributes.bin");\n');
  await writeFixture(root, "data/tilesets/primary/general/metatile_attributes.bin", Buffer.alloc(4));
  await writeFixture(root, "include/constants/metatile_behaviors.h", "#define MB_NORMAL 0\n");
  await writeFixture(root, "src/data/wild_encounters.json", { wild_encounter_groups: [{ label: "gWildMonHeaders", for_maps: true, encounters: [
    { map: "MAP_TINY_MAP", base_label: "sTiny_FireRed", land_mons: { encounter_rate: 10, mons: [{ min_level: 3, max_level: 3, species: "SPECIES_EKANS" }] } },
    { map: "MAP_TINY_MAP", base_label: "sTiny_LeafGreen", land_mons: { encounter_rate: 20, mons: [{ min_level: 3, max_level: 3, species: "SPECIES_SANDSHREW" }] } },
  ] }] });
}

test("LeafGreen world extraction keeps only LeafGreen wild tables; FireRed stays the default", async (t) => {
  const root = await mkdtemp(join(tmpdir(), "leafgreen-world-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  await worldFixture(root);
  const fireRed = await extractWorldStructure(root);
  const leafGreen = await extractWorldStructure(root, { version: "leafgreen" });
  assert.deepEqual(fireRed.wildEncounters.map(t => t.base_label), ["sTiny_FireRed"]);
  assert.deepEqual(fireRed.reconciliation.map(r => r.id).at(-1), "firered-encounter-maps-resolve");
  assert.deepEqual(leafGreen.wildEncounters.map(t => t.base_label), ["sTiny_LeafGreen"]);
  assert.equal(leafGreen.wildEncounters[0].land_mons.mons[0].species, "SPECIES_SANDSHREW");
  assert.deepEqual(leafGreen.reconciliation.map(r => r.id).at(-1), "leafgreen-encounter-maps-resolve");
  assert.ok(leafGreen.reconciliation.every(r => r.passed));
  // Everything except the version's wild tables is the same source.
  assert.deepEqual(leafGreen.maps, fireRed.maps);
});

test("LeafGreen runtime extraction reads pret's LeafGreen symbol file", async (t) => {
  const root = await mkdtemp(join(tmpdir(), "leafgreen-runtime-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  await writeFixture(root, "pokeleafgreen_rev1.sym", "03000000 g 00000020 gPlayerAvatar\n02000000 g 00000004 gSaveBlock1\n02000010 g 00000004 gSaveBlock2\n02000100 g 00000008 gBattleMons\n");
  await writeFixture(root, "include/global.h", "struct SaveBlock1 {\n /*0x00*/ u8 a;\n}; // size: 0x4\nstruct SaveBlock2 {\n /*0x00*/ u8 b;\n}; // size: 0x4\n");
  await writeFixture(root, "include/global.fieldmap.h", "struct PlayerAvatar {\n /*0x00*/ u8 flags;\n};\n");
  await writeFixture(root, "include/pokemon.h", "struct BattlePokemon {\n /*0x00*/ u16 species;\n};\n");
  await writeFixture(root, "include/constants/battle.h", "#define MAX_BATTLERS_COUNT 4\n");
  const result = await extractRuntimeSymbols(root, { version: "leafgreen", requiredSymbols: ["gPlayerAvatar"] });
  assert.equal(result.symbols.gPlayerAvatar.address, 0x03000000);
  await assert.rejects(extractRuntimeSymbols(root, { requiredSymbols: ["gPlayerAvatar"] }), /pokefirered_rev1\.sym/);
});

const passing = { id: "fixture-reconciles", expected: 1, actual: 1, passed: true };
const fixtureResults = {
  world: async () => ({ maps: [{ connections: [], warpEvents: [], objectEvents: [], coordEvents: [], backgroundEvents: [], layout: { id: "L", cells: [{}] } }], wildEncounters: [], reconciliation: [passing] }),
  story: async () => ({ scripts: [{ instructions: [] }], symbols: { flags: {}, variables: {}, items: {}, trainers: {} },
    references: { flags: {}, variables: {}, items: {}, trainers: {} }, unresolved: { flags: [], variables: [], items: [], trainers: [] },
    goalEvidence: { enterHallOfFameReferences: [] }, reconciliation: [passing] }),
  runtime: async () => ({ symbols: { gMain: {} }, structures: { P: { size: 1, fields: { f: { offset: 0 } } } }, requiredSymbols: ["gMain"], missingRequiredSymbols: [], reconciliation: [passing] }),
  battle: async () => ({ moves: [{}], species: [{}], typeChart: [{}], trainers: [{}], parties: { sParty_T: [{}] }, rematches: [], reconciliation: [passing] }),
};

test("a LeafGreen knowledge pack names its datasets and cartridge profile", async (t) => {
  const root = await mkdtemp(join(tmpdir(), "leafgreen-pack-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  const result = await generateKnowledgePack({
    version: "leafgreen", sourceRoot: "/fixture", outputDirectory: root, cartridgeProfileId: "leafgreen-rev1-stock",
    source: { id: "pret-pokefirered", revision: "b".repeat(40) },
    generator: { kind: "source-bundle-sha256", revision: "a".repeat(64), files: [{ path: "x.js", bytes: 1, sha256: "c".repeat(64) }] },
    build: { romSha1: "7862c67bdecbe21d1d69ce082ce34327e1c6ed5e", romBytes: 16_777_216, symbolsSha256: "e".repeat(64), target: "LEAFGREEN REVISION=1 MODERN=0" },
    collectedAt: "2026-09-28T00:00:00.000Z",
    extractors: { "leafgreen-world-structure": fixtureResults.world, "leafgreen-story-state": fixtureResults.story,
      "leafgreen-runtime-symbols": fixtureResults.runtime, "leafgreen-battle-mechanics": fixtureResults.battle },
  });
  assert.deepEqual(result.artifacts.map(a => a.datasetId).sort(),
    ["leafgreen-battle-mechanics", "leafgreen-runtime-symbols", "leafgreen-story-state", "leafgreen-world-structure"]);
  const runtime = JSON.parse(await readFile(result.artifacts.find(a => a.datasetId === "leafgreen-runtime-symbols").path, "utf8"));
  assert.equal(runtime.cartridgeProfileId, "leafgreen-rev1-stock");
  assert.equal(runtime.derivation.verifiedBuild.romSha1, "7862c67bdecbe21d1d69ce082ce34327e1c6ed5e");
  assert.equal(result.receipt.cartridgeProfileId, "leafgreen-rev1-stock");
  // A pack's version and its cartridge profile must agree.
  await assert.rejects(generateKnowledgePack({ version: "leafgreen", sourceRoot: "/fixture", outputDirectory: root, cartridgeProfileId: "firered-rev1-stock",
    source: { id: "pret-pokefirered", revision: "b".repeat(40) },
    generator: { kind: "source-bundle-sha256", revision: "a".repeat(64), files: [{ path: "x.js", bytes: 1, sha256: "c".repeat(64) }] },
    build: { romSha1: "d".repeat(40), romBytes: 1, symbolsSha256: "e".repeat(64) }, extractors: {} }), /leafgreen-rev1-stock/);
});

test("the research ledger records LeafGreen rev 1 as a stock, non-qualifying profile of the same source", async () => {
  const bundle = await loadResearchBundle(new URL("../research/", import.meta.url));
  const profile = bundle.cartridges.profiles.find(p => p.id === "leafgreen-rev1-stock");
  assert.deepEqual({ ...profile, name: undefined, purpose: undefined }, {
    id: "leafgreen-rev1-stock", name: undefined, purpose: undefined, relationship: "stock", qualification: false, game: "leafgreen",
    bytes: 16_777_216, sha1: "7862c67bdecbe21d1d69ce082ce34327e1c6ed5e",
    sha256: "2f978f635b9593f6ca26ec42481c53a6b39f6cddd894ad5c062c1419fac58825",
    gameCode: "BPGE", revision: 1, decompilation: { sourceId: "pret-pokefirered", commit: "c75f352304d529f6ba92d4f74b9cf8b5c3810788" } });
  assert.equal(bundle.cartridges.qualificationProfileId, "firered-rev1-stock");
});

test("the extraction command selects the FireRed or LeafGreen profile explicitly", () => {
  const project = new URL("..", import.meta.url);
  const help = spawnSync(process.execPath, ["src/cli/extract-knowledge.js", "--help"], { cwd: project, encoding: "utf8" });
  assert.equal(help.status, 0, help.stderr);
  assert.match(help.stdout, /--profile/);
  assert.match(help.stdout, /leafgreen-rev1-stock/);
  const refused = spawnSync(process.execPath, ["src/cli/extract-knowledge.js", "--source", "/nonexistent", "--stock-rom", "/nonexistent", "--profile", "emerald-us"],
    { cwd: project, encoding: "utf8" });
  assert.equal(refused.status, 2);
  assert.match(refused.stderr, /profile/i);
});
