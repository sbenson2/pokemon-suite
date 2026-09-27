import assert from "node:assert/strict";
import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

async function writeFixture(root, path, text) {
  const target = join(root, path);
  await mkdir(join(target, ".."), { recursive: true });
  await writeFile(target, text);
}

async function loadBattleExtractor() {
  try {
    return await import("../src/extractor/battle.js");
  } catch (error) {
    if (error?.code === "ERR_MODULE_NOT_FOUND") return {};
    throw error;
  }
}

test("battle extraction joins moves, species, type chart, trainers, and parties", async (t) => {
  const root = await mkdtemp(join(tmpdir(), "master-red-battle-"));
  t.after(() => rm(root, { recursive: true, force: true }));

  await writeFixture(root, "include/constants/moves.h", `
    #define MOVE_NONE 0
    #define MOVE_TACKLE 1
    #define MOVES_COUNT 2
  `);
  await writeFixture(root, "include/constants/species.h", `
    #define SPECIES_NONE 0
    #define SPECIES_BULBASAUR 1
    #define NUM_SPECIES 2
  `);
  await writeFixture(root, "include/constants/pokemon.h", `
    #define TYPE_NORMAL 0
    #define TYPE_GRASS 1
    #define TYPE_ENDTABLE 0xFE
    #define NUMBER_OF_MON_TYPES 2
  `);
  await writeFixture(root, "include/battle_main.h", `
    #define TYPE_MUL_NO_EFFECT 0
    #define TYPE_MUL_NORMAL 10
    #define TYPE_MUL_SUPER_EFFECTIVE 20
  `);
  await writeFixture(root, "include/constants/opponents.h", `
    #define TRAINER_BROCK 0
    #define NUM_TRAINERS 1
  `);
  await writeFixture(root, "src/data/battle_moves.h", `
    const struct BattleMove gBattleMoves[MOVES_COUNT] = {
      [MOVE_NONE] = {.power = 0, .type = TYPE_NORMAL, .accuracy = 0, .pp = 0},
      [MOVE_TACKLE] = {.power = 40, .type = TYPE_NORMAL, .accuracy = 100, .pp = 35},
    };
  `);
  await writeFixture(root, "src/data/pokemon/species_info.h", `
    const struct SpeciesInfo gSpeciesInfo[] = {
      [SPECIES_NONE] = {0},
      [SPECIES_BULBASAUR] = {
        .baseHP = 45,
        .baseAttack = 49,
        .types = {TYPE_GRASS, TYPE_GRASS},
        .abilities = {ABILITY_OVERGROW, ABILITY_NONE},
      },
    };
  `);
  await writeFixture(root, "src/battle_main.c", `
    const u8 gTypeEffectiveness[] = {
      TYPE_GRASS, TYPE_NORMAL, TYPE_MUL_SUPER_EFFECTIVE,
      TYPE_ENDTABLE, TYPE_ENDTABLE, TYPE_MUL_NO_EFFECT,
    };
  `);
  await writeFixture(root, "src/data/trainer_parties.h", `
    static const struct TrainerMonNoItemCustomMoves sParty_LeaderBrock[] = {
      {.lvl = 12, .species = SPECIES_BULBASAUR, .moves = {MOVE_TACKLE, MOVE_NONE}},
    };
  `);
  await writeFixture(root, "src/data/trainers.h", `
    const struct Trainer gTrainers[] = {
      [TRAINER_BROCK] = {
        .trainerName = _("BROCK"),
        .items = {},
        .party = NO_ITEM_CUSTOM_MOVES(sParty_LeaderBrock),
      },
    };
  `);
  await writeFixture(root, "src/vs_seeker.c", `
    static const struct RematchData sRematches[] = {
      { {TRAINER_BROCK, TRAINER_BROCK, SKIP}, MAP(MAP_ROUTE3) },
    };
  `);

  const { extractBattleMechanics } = await loadBattleExtractor();
  assert.equal(typeof extractBattleMechanics, "function");
  const result = await extractBattleMechanics(root);

  assert.deepEqual(result.moves[1], {
    name: "MOVE_TACKLE",
    id: 1,
    power: 40,
    type: "TYPE_NORMAL",
    accuracy: 100,
    pp: 35,
  });
  assert.equal(result.species[1].name, "SPECIES_BULBASAUR");
  assert.deepEqual(result.species[1].types, ["TYPE_GRASS", "TYPE_GRASS"]);
  assert.deepEqual(result.typeChart, [
    { attackingType: "TYPE_GRASS", defendingType: "TYPE_NORMAL", multiplier: 20 },
  ]);
  assert.equal(result.trainers[0].trainerName, "BROCK");
  assert.equal(result.trainers[0].partyName, "sParty_LeaderBrock");
  assert.deepEqual(result.trainers[0].party, [
    { lvl: 12, species: "SPECIES_BULBASAUR", moves: ["MOVE_TACKLE", "MOVE_NONE"] },
  ]);
  assert.deepEqual(result.rematches, [{
    map: "MAP_ROUTE3",
    trainerNames: ["TRAINER_BROCK", "TRAINER_BROCK", null],
    trainerIds: [0, 0, null],
  }]);
  assert.ok(result.reconciliation.every(({ passed }) => passed));
});
