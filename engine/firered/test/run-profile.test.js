import assert from "node:assert/strict";
import test from "node:test";

import {
  PLAYER_PRESET_NAMES,
  RIVAL_PRESET_NAMES,
  createRunProfile,
} from "../src/player/run-profile.js";

test("a complete 54-seed cycle balances every cartridge opening choice", () => {
  const profiles = Array.from({ length: 54 }, (_, seed) => createRunProfile(seed));

  assert.deepEqual(
    Object.fromEntries(["BOY", "GIRL"].map((gender) => [
      gender,
      profiles.filter((profile) => profile.gender === gender).length,
    ])),
    { BOY: 27, GIRL: 27 },
  );
  assert.deepEqual(
    Object.fromEntries([1, 4, 7].map((species) => [
      species,
      profiles.filter((profile) => profile.starter.species === species).length,
    ])),
    { 1: 18, 4: 18, 7: 18 },
  );

  const combinations = new Set(profiles.map((profile) => [
    profile.gender,
    profile.starter.species,
    profile.playerPresetIndex,
    profile.rivalMenuRow,
  ].join(":")));
  assert.equal(combinations.size, 54);
});

test("run profiles only select the first three cartridge preset names", () => {
  for (let seed = 0; seed < 1_000; seed += 1) {
    const profile = createRunProfile(seed);
    assert.ok(PLAYER_PRESET_NAMES[profile.gender].includes(profile.playerName));
    assert.ok(RIVAL_PRESET_NAMES.includes(profile.rivalName));
    assert.ok([0, 1, 2].includes(profile.playerPresetIndex));
    assert.ok([1, 2, 3].includes(profile.rivalMenuRow));
    assert.notEqual(profile.rivalMenuRow, 0, "row zero is NEW NAME");
    assert.equal("playerMenuRow" in profile, false,
      "FireRed has no player preset menu; it opens the naming keyboard");
  }
});

test("the selected starter carries its exact FireRed lab object identity", () => {
  assert.deepEqual(createRunProfile(0).starter, {
    id: "bulbasaur",
    name: "BULBASAUR",
    species: 1,
    family: [1, 2, 3],
    finalSpecies: 3,
    objectScript: "PalletTown_ProfessorOaksLab_EventScript_BulbasaurBall",
    objectLocalId: "LOCALID_BULBASAUR_BALL",
  });
  assert.equal(createRunProfile(2).starter.species, 4);
  assert.equal(createRunProfile(4).starter.species, 7);
});

test("an explicit native starter changes the lab choice without changing trainer identity", () => {
  const profile = createRunProfile(0, { starter: "squirtle" });
  assert.equal(profile.starter.species, 7);
  assert.equal(profile.starter.objectScript, "PalletTown_ProfessorOaksLab_EventScript_SquirtleBall");
  assert.equal(profile.playerName, "RED");
  assert.equal(profile.gender, "BOY");
  assert.equal(profile.rivalName, "GREEN");
  assert.deepEqual(createRunProfile(2, { starter: "random" }), createRunProfile(2));
  assert.throws(() => createRunProfile(0, { starter: "pikachu" }), /starter/i);
});
