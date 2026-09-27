import assert from "node:assert/strict";
import test from "node:test";

import { expectedTrainerPayout } from "../src/player/trainer-economics.js";

test("trainer payout follows FireRed's class factor and final party level", () => {
  assert.equal(expectedTrainerPayout({
    trainerClass: "TRAINER_CLASS_LADY",
    party: [
      { lvl: 20, species: "SPECIES_MEOWTH" },
      { lvl: 22, species: "SPECIES_PERSIAN" },
    ],
  }), 4 * 22 * 50);

  assert.equal(expectedTrainerPayout({
    trainerClass: "TRAINER_CLASS_YOUNGSTER",
    party: [{ lvl: 30, species: "SPECIES_RATICATE" }],
  }), 4 * 30 * 4);
});

test("trainer payout remains unknown when the cartridge class or party is absent", () => {
  assert.equal(expectedTrainerPayout({
    trainerClass: "TRAINER_CLASS_UNKNOWN",
    party: [{ lvl: 30, species: "SPECIES_RATICATE" }],
  }), null);
  assert.equal(expectedTrainerPayout({
    trainerClass: "TRAINER_CLASS_LADY",
    party: [],
  }), null);
});
