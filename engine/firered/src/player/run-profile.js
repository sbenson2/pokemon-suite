export const PLAYER_PRESET_NAMES = Object.freeze({
  BOY: Object.freeze(["RED", "FIRE", "ASH"]),
  GIRL: Object.freeze(["RED", "FIRE", "OMI"]),
});

export const RIVAL_PRESET_NAMES = Object.freeze(["GREEN", "GARY", "KAZ"]);

const STARTERS = Object.freeze([
  Object.freeze({
    id: "bulbasaur",
    name: "BULBASAUR",
    species: 1,
    family: Object.freeze([1, 2, 3]),
    finalSpecies: 3,
    objectScript: "PalletTown_ProfessorOaksLab_EventScript_BulbasaurBall",
    objectLocalId: "LOCALID_BULBASAUR_BALL",
  }),
  Object.freeze({
    id: "charmander",
    name: "CHARMANDER",
    species: 4,
    family: Object.freeze([4, 5, 6]),
    finalSpecies: 6,
    objectScript: "PalletTown_ProfessorOaksLab_EventScript_CharmanderBall",
    objectLocalId: "LOCALID_CHARMANDER_BALL",
  }),
  Object.freeze({
    id: "squirtle",
    name: "SQUIRTLE",
    species: 7,
    family: Object.freeze([7, 8, 9]),
    finalSpecies: 9,
    objectScript: "PalletTown_ProfessorOaksLab_EventScript_SquirtleBall",
    objectLocalId: "LOCALID_SQUIRTLE_BALL",
  }),
]);

function normalizedSeed(seed) {
  const value = Number(seed);
  if (!Number.isSafeInteger(value) || value < 0 || value > 0xffff_ffff) {
    throw new TypeError("run seed must be an unsigned 32-bit integer");
  }
  return value >>> 0;
}

// The New Game keyboard automation types letters on the two letter pages; a
// FireRed player name holds at most seven characters (PLAYER_NAME_LENGTH).
export const PLAYER_NAME_PATTERN = /^[A-Za-z]{1,7}$/;

export function createRunProfile(seed, { starter: selectedStarter = "random", playerName: ownerName = null } = {}) {
  const value = normalizedSeed(seed);
  if (selectedStarter !== "random" && !STARTERS.some(starter => starter.id === selectedStarter)) {
    throw new TypeError("choose a native FireRed starter or random");
  }
  if (ownerName !== null && (typeof ownerName !== "string" || !PLAYER_NAME_PATTERN.test(ownerName))) {
    throw new TypeError("choose a trainer name of 1 to 7 letters");
  }
  // These mixed-radix digits enumerate the full 2×3×3×3 opening space once
  // per 54 consecutive seeds. That gives exact marginals rather than merely
  // hoping a small sample from a PRNG looks balanced.
  const gender = value % 2 === 0 ? "BOY" : "GIRL";
  const starter = selectedStarter === "random" ? STARTERS[Math.floor(value / 2) % STARTERS.length]
    : STARTERS.find(starter => starter.id === selectedStarter);
  const playerIndex = Math.floor(value / 6) % 3;
  const rivalIndex = Math.floor(value / 18) % 3;
  return Object.freeze({
    schema: "master-red/run-profile/v1",
    seed: value,
    gender,
    genderMenuRow: gender === "GIRL" ? 1 : 0,
    playerName: ownerName ?? PLAYER_PRESET_NAMES[gender][playerIndex],
    // FireRed opens a keyboard for the player; unlike the rival it has no
    // preset-name menu. This index selects one of the first three official
    // source-defined names that the keyboard controller enters verbatim. An
    // owner-chosen name replaces the preset (older runs have no such key).
    playerPresetIndex: ownerName === null ? playerIndex : null,
    ...(ownerName === null ? {} : { playerNameSource: "owner" }),
    rivalName: RIVAL_PRESET_NAMES[rivalIndex],
    rivalMenuRow: rivalIndex + 1,
    starter,
    nicknamePolicy: "species-name-only",
  });
}

export function starterForSpecies(species) {
  const value = Number(species);
  return STARTERS.find(({ family }) => family.includes(value)) ?? null;
}
