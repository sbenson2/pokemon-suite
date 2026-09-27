import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import test from "node:test";
import * as factsReader from "../src/player/fire-red-roster-facts.js";

function fixture() {
  const romBytes = Buffer.alloc(1024);
  const symbol = (offset, size) => ({ address: 0x08000000 + offset, region: "ROM", size });
  const symbols = { gLevelUpLearnsets: symbol(0, 12), sTMHMLearnsets: symbol(32, 24), gEvolutionTable: symbol(64, 120) };
  for (let i = 0; i < 3; i++) { romBytes.writeUInt32LE(0x08000200 + i * 8, i * 4); romBytes.writeUInt16LE(0xffff, 512 + i * 8); }
  romBytes.writeUInt16LE((7 << 9) | 22, 520); romBytes.writeUInt16LE(0xffff, 522);
  romBytes.writeBigUInt64LE((1n << 50n) | (1n << 54n), 40);
  romBytes.writeUInt16LE(4, 104); romBytes.writeUInt16LE(16, 106); romBytes.writeUInt16LE(2, 108);
  const cartridge = { id: "firered-rev1-stock", bytes: 1024, sha1: createHash("sha1").update(romBytes).digest("hex") };
  const mechanics = { species: { 1: { id: 1, name: "SPECIES_A", types: ["TYPE_NORMAL", "TYPE_NORMAL"] },
    2: { id: 2, name: "SPECIES_B", types: ["TYPE_NORMAL", "TYPE_NORMAL"] } }, moves: { 22: { id: 22, power: 45, type: "TYPE_GRASS" } } };
  return { romBytes, cartridge, runtime: { data: { symbols } }, mechanics };
}

test("roster facts decode native learnsets, padded evolution records and HM bits", () => {
  assert.equal(typeof factsReader.readFireRedRosterFacts, "function");
  const facts = factsReader.readFireRedRosterFacts(fixture());
  assert.deepEqual(facts.species[1].levelUpMoves, [{ level: 7, moveId: 22 }]);
  assert.deepEqual(facts.species[1].evolutions, [{ method: 4, parameter: 16, targetSpecies: 2 }]);
  assert.deepEqual(facts.species[1].fieldCapabilities, ["cut", "flash"]);
  assert.deepEqual(facts.species[2].evolutions, []);
});

test("wrong cartridges and out-of-ROM tables or pointers fail before producing facts", () => {
  assert.equal(typeof factsReader.readFireRedRosterFacts, "function");
  const wrong = fixture(); wrong.cartridge.sha1 = "0".repeat(40);
  assert.throws(() => factsReader.readFireRedRosterFacts(wrong), /fingerprint/);
  const bounds = fixture(); bounds.runtime.data.symbols.sTMHMLearnsets.address = 0x02000000;
  assert.throws(() => factsReader.readFireRedRosterFacts(bounds), /ROM|bounds/);
  const pointer = fixture(); pointer.romBytes.writeUInt32LE(0x03000000, 4);
  pointer.cartridge.sha1 = createHash("sha1").update(pointer.romBytes).digest("hex");
  assert.throws(() => factsReader.readFireRedRosterFacts(pointer), /ROM|bounds/);
});
