// Offsets are from include/{main.h,pokemon.h,global.h} at pokeemerald 5eff786.
const PARTY_MEMBER_BYTES = 100;
const BADGE_FIRST_FLAG = 0x867;
const BADGE_COUNT = 8;
const SAVE_BLOCK_1_FLAGS_OFFSET = 0x1270;

function asBytes(value, expectedLength) {
  if (!(value instanceof Uint8Array)) throw new TypeError('memory reader must return Uint8Array');
  if (value.length < expectedLength) throw new RangeError(`memory reader returned ${value.length} bytes; expected ${expectedLength}`);
  return value;
}

function u16(bytes, offset) {
  return bytes[offset] | (bytes[offset + 1] << 8);
}

function u32(bytes, offset) {
  return (bytes[offset] | (bytes[offset + 1] << 8) | (bytes[offset + 2] << 16) | (bytes[offset + 3] << 24)) >>> 0;
}

function readAt(readMemory, address, length) {
  if (typeof readMemory !== 'function') throw new TypeError('readMemory must be a function');
  return asBytes(readMemory(address, length), length);
}

function decodePartyMember(bytes) {
  // BoxPokemon.secure (0x20..0x4f) is encrypted; do not pretend species/moves are observable here.
  return Object.freeze({
    personality: u32(bytes, 0),
    otId: u32(bytes, 4),
    isBadEgg: (bytes[19] & 1) !== 0,
    hasSpecies: (bytes[19] & 2) !== 0,
    isEgg: (bytes[19] & 4) !== 0,
    status: u32(bytes, 80),
    level: bytes[84],
    hp: u16(bytes, 86),
    maxHp: u16(bytes, 88),
    attack: u16(bytes, 90),
    defense: u16(bytes, 92),
    speed: u16(bytes, 94),
    spAttack: u16(bytes, 96),
    spDefense: u16(bytes, 98),
  });
}

function decodeBadges(saveBlock1) {
  let badges = 0;
  for (let flag = BADGE_FIRST_FLAG; flag < BADGE_FIRST_FLAG + BADGE_COUNT; flag += 1) {
    const byte = saveBlock1[SAVE_BLOCK_1_FLAGS_OFFSET + (flag >> 3)];
    badges += (byte >> (flag & 7)) & 1;
  }
  return badges;
}

/**
 * Read-only snapshot of fields whose offsets are unambiguous in the pinned C
 * layouts. `readMemory(address, length)` is supplied by the emulator adapter.
 */
export function decodeObserverState(readMemory, manifest) {
  const battleFlags = readAt(readMemory, manifest.gBattleTypeFlags, 4);
  const outcome = readAt(readMemory, manifest.gBattleOutcome, 1);
  const partyCount = Math.min(readAt(readMemory, manifest.gPlayerPartyCount, 1)[0], 6);
  const partyBytes = readAt(readMemory, manifest.gPlayerParty, partyCount * PARTY_MEMBER_BYTES);
  const opponent = readAt(readMemory, manifest.gTrainerBattleOpponent_A, 2);
  const main = readAt(readMemory, manifest.gMain, 0x43c);
  const saveBlock1Pointer = u32(readAt(readMemory, manifest.gSaveBlock1Ptr, 4), 0);
  const saveBlock2Pointer = u32(readAt(readMemory, manifest.gSaveBlock2Ptr, 4), 0);
  const saveBlock1 = readAt(readMemory, saveBlock1Pointer, SAVE_BLOCK_1_FLAGS_OFFSET + ((BADGE_FIRST_FLAG + BADGE_COUNT - 1) >> 3) + 1);
  const saveBlock2 = readAt(readMemory, saveBlock2Pointer, 0x12);
  const party = [];
  for (let index = 0; index < partyCount; index += 1) party.push(decodePartyMember(partyBytes.subarray(index * PARTY_MEMBER_BYTES, (index + 1) * PARTY_MEMBER_BYTES)));
  return Object.freeze({
    inBattle: (main[0x439] & 2) !== 0,
    battleTypeFlags: u32(battleFlags, 0),
    battleOutcome: outcome[0],
    trainerOpponentId: u16(opponent, 0),
    map: Object.freeze({ group: saveBlock1[4], number: saveBlock1[5] }),
    playTime: Object.freeze({ hours: u16(saveBlock2, 14), minutes: saveBlock2[16], seconds: saveBlock2[17] }),
    playerGender: saveBlock2[8] === 1 ? 'FEMALE' : 'MALE',
    badges: decodeBadges(saveBlock1),
    party: Object.freeze(party),
  });
}

