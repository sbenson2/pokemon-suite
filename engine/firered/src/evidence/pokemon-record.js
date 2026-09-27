// Stock BPRE Rev 1: pret/pokefirered c75f352304d529f6ba92d4f74b9cf8b5c3810788,
// include/pokemon.h and src/pokemon.c (GetSubstruct, GetNature, IsMonShiny).
// This is a decoder only. It never writes a Pokémon record or emulator memory.
const ORDERS = ["GAEM", "GAME", "GEAM", "GEMA", "GMAE", "GMEA", "AGEM", "AGME",
  "AEGM", "AEMG", "AMGE", "AMEG", "EGAM", "EGMA", "EAGM", "EAMG", "EMGA", "EMAG",
  "MGAE", "MGEA", "MAGE", "MAEG", "MEGA", "MEAG"];
export const FIRE_RED_NATURES = Object.freeze(["Hardy", "Lonely", "Brave", "Adamant", "Naughty",
  "Bold", "Docile", "Relaxed", "Impish", "Lax", "Timid", "Hasty", "Serious", "Jolly", "Naive",
  "Modest", "Mild", "Quiet", "Bashful", "Rash", "Calm", "Gentle", "Sassy", "Careful", "Quirky"]);
export const IV_STATS = Object.freeze(["hp", "attack", "defense", "speed", "spAttack", "spDefense"]);

export function pokemonIdentity(personality, otId) {
  if (![personality, otId].every((value) => Number.isInteger(value) && value >= 0 && value <= 0xffffffff)) {
    throw new TypeError("Pokémon identity requires unsigned 32-bit PID and OT ID");
  }
  const shinyValue = (personality >>> 16) ^ (personality & 0xffff) ^ (otId >>> 16) ^ (otId & 0xffff);
  return { personality, otId, trainerId: otId & 0xffff, secretId: otId >>> 16,
    nature: { id: personality % 25, name: FIRE_RED_NATURES[personality % 25] },
    shinyValue, shiny: shinyValue < 8 };
}

export function decodeBoxPokemonRecord(bytes, offset = 0) {
  const unknown = (reason) => ({ validity: "unknown", reason, shiny: null });
  if (!(bytes instanceof Uint8Array) || !Number.isSafeInteger(offset) || offset < 0 || offset + 80 > bytes.length) {
    return unknown("truncated-record");
  }
  if (bytes.subarray(offset, offset + 80).every((value) => value === 0)) {
    return { validity: "empty", reason: "zero-record", shiny: null };
  }
  if (!(bytes[offset + 19] & 2) || (bytes[offset + 19] & 1)) return unknown("uninitialized-or-bad-egg");
  const view = new DataView(bytes.buffer, bytes.byteOffset + offset, 80);
  const personality = view.getUint32(0, true);
  const otId = view.getUint32(4, true);
  const secure = new DataView(new ArrayBuffer(48));
  for (let index = 0; index < 48; index += 4) {
    secure.setUint32(index, view.getUint32(32 + index, true) ^ personality ^ otId, true);
  }
  let checksum = 0;
  for (let index = 0; index < 48; index += 2) checksum = (checksum + secure.getUint16(index, true)) & 0xffff;
  if (checksum !== view.getUint16(28, true)) return unknown("checksum-mismatch");
  const order = ORDERS[personality % 24];
  const growth = order.indexOf("G") * 12;
  const attacks = order.indexOf("A") * 12;
  const effort = order.indexOf("E") * 12;
  const misc = order.indexOf("M") * 12;
  const species = secure.getUint16(growth, true);
  if (species <= 0 || species > 411) return unknown("invalid-species");
  const packedIvs = secure.getUint32(misc + 4, true);
  return {
    validity: "valid", ...pokemonIdentity(personality, otId), species,
    heldItem: secure.getUint16(growth + 2, true), experience: secure.getUint32(growth + 4, true),
    ppBonuses: secure.getUint8(growth + 8),
    friendship: secure.getUint8(growth + 9),
    evs: Object.fromEntries(IV_STATS.map((stat,index)=>[stat,secure.getUint8(effort+index)])),
    beauty: secure.getUint8(effort + 7), sheen: secure.getUint8(effort + 11),
    pokerus: secure.getUint8(misc),
    moves: [0, 1, 2, 3].map((slot) => secure.getUint16(attacks + slot * 2, true)),
    pp: [0, 1, 2, 3].map((slot) => secure.getUint8(attacks + 8 + slot)),
    ivs: Object.fromEntries(IV_STATS.map((stat, index) => [stat, (packedIvs >>> (index * 5)) & 31])),
    isEgg: Boolean((packedIvs & 0x40000000) || (bytes[offset + 19] & 4)), abilityNum: packedIvs >>> 31,
  };
}
