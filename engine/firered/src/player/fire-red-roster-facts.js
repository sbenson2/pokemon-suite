import { createHash } from "node:crypto";

const ROM_BASE = 0x08000000;
export const FIRE_RED_FIELD_MOVES = Object.freeze({ cut: 15, fly: 19, surf: 57, strength: 70, flash: 148, rockSmash: 249 });

// Private bytes are decoded in memory. The pinned stock ABI pads each evolution
// record to eight bytes; its three u16 fields do NOT imply a six-byte stride.
export function readFireRedRosterFacts({ romBytes, cartridge, runtime, mechanics }) {
  const peerProfile = cartridge?.id === "firered-rev1-peer-trade-v2" &&
    cartridge.sha1 === "85a259c7b7a74d4f2322e5b9f89d22a53dfd6fce";
  // LeafGreen rev 1 (build 124) is the same stock ABI built from the same source.
  const stockProfile = ["firered-rev1-stock", "leafgreen-rev1-stock"].includes(cartridge?.id);
  if (!(romBytes instanceof Uint8Array) || !(stockProfile || peerProfile) ||
      romBytes.length !== cartridge.bytes || createHash("sha1").update(romBytes).digest("hex") !== cartridge.sha1) {
    throw new Error("roster cartridge fingerprint does not match the stock profile");
  }
  const bytes = Buffer.from(romBytes.buffer, romBytes.byteOffset, romBytes.byteLength);
  const symbols = (runtime?.data ?? runtime)?.symbols ?? {};
  const data = mechanics?.data ?? mechanics;
  const offset = (address, length) => {
    const value = address - ROM_BASE;
    if (!Number.isSafeInteger(value) || !Number.isSafeInteger(length) || value < 0 || length < 0 || value + length > bytes.length) {
      throw new Error("roster table pointer is outside ROM bounds");
    }
    return value;
  };
  const table = name => {
    const symbol = symbols[name];
    if (symbol?.region !== "ROM" || !symbol.size) throw new Error(`missing roster ROM symbol ${name}`);
    return { at: offset(symbol.address, symbol.size), size: symbol.size };
  };
  const learnsets = table("gLevelUpLearnsets"), hms = table("sTMHMLearnsets"), evolutions = table("gEvolutionTable");
  const count = learnsets.size / 4;
  if (!Number.isInteger(count) || hms.size !== count * 8 || evolutions.size !== count * 40) {
    throw new Error("roster table sizes do not match the stock ABI");
  }
  const species = {};
  for (const entry of Object.values(data?.species ?? {})) {
    if (!entry || !Number.isInteger(entry.id) || entry.id < 1 || entry.id >= count) continue;
    const id = entry.id;
    const pointer = bytes.readUInt32LE(learnsets.at + id * 4);
    let at = offset(pointer, 2);
    const levelUpMoves = [];
    for (let index = 0; ; index++, at += 2) {
      if (index > 100) throw new Error("unterminated roster learnset");
      offset(ROM_BASE + at, 2);
      const value = bytes.readUInt16LE(at);
      if (value === 0xffff) break;
      const level = value >> 9, moveId = value & 511;
      if (level < 1 || level > 100 || !data.moves?.[moveId]) throw new Error("invalid native roster learnset entry");
      levelUpMoves.push(Object.freeze({ level, moveId }));
    }
    const evolutionPaths = [];
    for (let index = 0; index < 5; index++) {
      const cursor = evolutions.at + id * 40 + index * 8;
      const method = bytes.readUInt16LE(cursor), parameter = bytes.readUInt16LE(cursor + 2), targetSpecies = bytes.readUInt16LE(cursor + 4);
      if (method) {
        if (targetSpecies < 1 || targetSpecies >= count) throw new Error("invalid native evolution target");
        evolutionPaths.push(Object.freeze({ method, parameter, targetSpecies }));
      }
    }
    const mask = bytes.readBigUInt64LE(hms.at + id * 8);
    const fieldCapabilities = Object.keys(FIRE_RED_FIELD_MOVES).filter((_, index) => (mask & (1n << BigInt(50 + index))) !== 0n);
    species[id] = Object.freeze({ ...entry, levelUpMoves: Object.freeze(levelUpMoves),
      evolutions: Object.freeze(evolutionPaths), fieldCapabilities: Object.freeze(fieldCapabilities) });
  }
  return Object.freeze({ schema: "master-red/firered-roster-facts/v1", cartridgeSha1: cartridge.sha1,
    species: Object.freeze(species), moves: data.moves, typeChart: data.typeChart ?? [],
    constants: data.constants?.pokemon ?? {},
  });
}
