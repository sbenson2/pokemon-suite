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

async function loadStoryExtractor() {
  try {
    return await import("../src/extractor/story.js");
  } catch (error) {
    if (error?.code === "ERR_MODULE_NOT_FOUND") return {};
    throw error;
  }
}

test("story extraction indexes script instructions and resolves state references", async (t) => {
  const root = await mkdtemp(join(tmpdir(), "master-red-story-"));
  t.after(() => rm(root, { recursive: true, force: true }));

  await writeFixture(root, "include/constants/flags.h", `
    #define FLAGS_START 0x800
    #define FLAG_PARCEL (FLAGS_START + 1)
    #define TRAINER_FLAGS_END (FLAGS_START + MAX_TRAINERS_COUNT - 1)
    #define FLAG_SYS_GAME_CLEAR (TRAINER_FLAGS_END + 1)
  `);
  await writeFixture(root, "include/constants/vars.h", `
    #define VARS_START 0x4000
    #define VAR_SCENE (VARS_START + 1)
  `);
  await writeFixture(root, "include/constants/items.h", `
    #define ITEM_NONE 0
    #define ITEM_POTION 13
  `);
  await writeFixture(root, "include/constants/opponents.h", `
    #define TRAINER_BROCK 414
    #define MAX_TRAINERS_COUNT 768
  `);
  await writeFixture(root, "data/maps/TinyMap/scripts.inc", `
Tiny_EventScript_Start::
  goto_if_set FLAG_PARCEL, Tiny_EventScript_Done
  setvar VAR_SCENE, 1
  giveitem ITEM_POTION
Tiny_EventScript_Done:
  trainerbattle_single TRAINER_BROCK, Tiny_Text, Tiny_Text
  setvar TRAINER_LOCAL_ALIAS, 1
  special EnterHallOfFame
  end
  `);
  await writeFixture(root, "data/scripts/pc.inc", `
Common_EventScript_CheckClear::
  goto_if_set FLAG_SYS_GAME_CLEAR, Tiny_EventScript_Done
  end
  `);

  const { extractStoryState } = await loadStoryExtractor();
  assert.equal(typeof extractStoryState, "function");
  const result = await extractStoryState(root);

  assert.equal(result.symbols.flags.FLAG_PARCEL.value, 0x801);
  assert.equal(result.symbols.variables.VAR_SCENE.value, 0x4001);
  assert.deepEqual(
    result.scripts.find(({ label }) => label === "Tiny_EventScript_Start").instructions,
    [
      { op: "goto_if_set", args: ["FLAG_PARCEL", "Tiny_EventScript_Done"], line: 3 },
      { op: "setvar", args: ["VAR_SCENE", "1"], line: 4 },
      { op: "giveitem", args: ["ITEM_POTION"], line: 5 },
    ],
  );
  assert.equal(result.references.flags.FLAG_PARCEL.length, 1);
  assert.equal(result.references.flags.FLAG_SYS_GAME_CLEAR?.length, 1);
  assert.equal(result.references.variables.VAR_SCENE.length, 1);
  assert.equal(result.references.items.ITEM_POTION.length, 1);
  assert.equal(result.references.trainers.TRAINER_BROCK.length, 1);
  assert.equal(result.references.trainers.TRAINER_LOCAL_ALIAS, undefined);
  assert.deepEqual(result.unresolved, {
    flags: [],
    variables: [],
    items: [],
    trainers: [],
  });
  assert.equal(result.goalEvidence.gameClearFlag.value, 0xb00);
  assert.equal(result.goalEvidence.enterHallOfFameReferences.length, 1);
  assert.ok(result.reconciliation.every(({ passed }) => passed));
});
