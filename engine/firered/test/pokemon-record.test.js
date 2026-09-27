import assert from "node:assert/strict";
import test from "node:test";
import { decodeBoxPokemonRecord } from "../src/evidence/pokemon-record.js";

// Independently laid out records: G/A/E/M are four 12-byte substructures.
const orders = ["GAEM", "GAME", "GEAM", "GEMA", "GMAE", "GMEA", "AGEM", "AGME",
  "AEGM", "AEMG", "AMGE", "AMEG", "EGAM", "EGMA", "EAGM", "EAMG", "EMGA", "EMAG",
  "MGAE", "MGEA", "MAGE", "MAEG", "MEGA", "MEAG"];
function record(personality, otId = 0x12345678) {
  const bytes = new Uint8Array(80);
  const out = new DataView(bytes.buffer);
  out.setUint32(0, personality, true);
  out.setUint32(4, otId, true);
  bytes[19] = 2;
  const payload = new Uint8Array(48);
  const view = new DataView(payload.buffer);
  const order = orders[personality % 24];
  view.setUint16(order.indexOf("G") * 12, 19, true);
  view.setUint32(order.indexOf("G") * 12 + 4, 125, true);
  payload[order.indexOf("G") * 12 + 9] = 219;
  payload[order.indexOf("E") * 12 + 1] = 24;
  payload[order.indexOf("E") * 12 + 7] = 169;
  payload[order.indexOf("E") * 12 + 11] = 240;
  view.setUint16(order.indexOf("A") * 12, 33, true);
  payload[order.indexOf("A") * 12 + 8] = 35;
  // IVs 31/0/1/2/3/4, ability slot 1, not an egg.
  payload[order.indexOf('M')*12]=0x20; // Cured Pokérus still doubles EV gain.
  view.setUint32(order.indexOf("M") * 12 + 4, 0x8831041f, true);
  let checksum = 0;
  for (let index = 0; index < 48; index += 2) checksum += view.getUint16(index, true);
  out.setUint16(28, checksum & 0xffff, true);
  for (let index = 0; index < 48; index += 4) {
    out.setUint32(32 + index, view.getUint32(index, true) ^ personality ^ otId, true);
  }
  return bytes;
}

test("secure Pokémon decoding preserves identity and IV order through all 24 permutations", () => {
  for (let personality = 0; personality < 24; personality++) {
    const decoded = decodeBoxPokemonRecord(record(personality));
    assert.equal(decoded.validity, "valid");
    assert.equal(decoded.personality, personality);
    assert.equal(decoded.otId, 0x12345678);
    assert.equal(decoded.trainerId, 0x5678);
    assert.equal(decoded.secretId, 0x1234);
    assert.equal(decoded.species, 19);
    assert.equal(decoded.experience, 125);
    assert.equal(decoded.friendship,219);
    assert.equal(decoded.evs.attack,24);
    assert.equal(decoded.pokerus,0x20);
    assert.equal(decoded.beauty,169);
    assert.equal(decoded.sheen,240);
    assert.deepEqual(decoded.moves, [33, 0, 0, 0]);
    assert.deepEqual(decoded.pp, [35, 0, 0, 0]);
    assert.deepEqual(decoded.ivs, { hp: 31, attack: 0, defense: 1, speed: 2, spAttack: 3, spDefense: 4 });
    assert.equal(decoded.abilityNum, 1);
    assert.equal(decoded.isEgg, false);
    assert.equal(decoded.nature.id, personality);
    assert.equal(decoded.shiny, false);
  }
});

test("shiny XOR uses the Pokémon's OT, unsigned PID, and strict less-than-eight boundary", () => {
  for (const [personality, otId, shiny] of [[0, 0, true], [7, 0, true], [8, 0, false],
    [0x80008007, 0, true], [0xffffffff, 0xffffffff, true], [0, 0x12345678, false]]) {
    const decoded = decodeBoxPokemonRecord(record(personality, otId));
    assert.equal(decoded.personality, personality);
    assert.equal(decoded.shiny, shiny);
  }
  assert.equal(decodeBoxPokemonRecord(record(24)).nature.name, "Quirky");
  assert.equal(decodeBoxPokemonRecord(record(25)).nature.name, "Hardy");
});

test("truncated, corrupt, bad-egg and uninitialized Pokémon never report not-shiny", () => {
  const corrupt = record(8); corrupt[32] ^= 1;
  const badEgg = record(8); badEgg[19] |= 1;
  const initializing = record(8); initializing[19] = 0;
  for (const bytes of [new Uint8Array(79), corrupt, badEgg, initializing]) {
    const decoded = decodeBoxPokemonRecord(bytes);
    assert.equal(decoded.validity, "unknown");
    assert.equal(decoded.shiny, null);
  }
  assert.equal(decodeBoxPokemonRecord(new Uint8Array(80)).validity, "empty");
});
