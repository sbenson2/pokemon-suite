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

async function loadRuntimeExtractor() {
  try {
    return await import("../src/extractor/runtime.js");
  } catch (error) {
    if (error?.code === "ERR_MODULE_NOT_FOUND") return {};
    throw error;
  }
}

test("runtime extraction joins built addresses with explicit structure offsets", async (t) => {
  const root = await mkdtemp(join(tmpdir(), "master-red-runtime-"));
  t.after(() => rm(root, { recursive: true, force: true }));

  await writeFixture(root, "pokefirered_rev1.sym", `
02000000 g 00000004 gSaveBlock1Ptr
02000004 g 00000004 gSaveBlock2Ptr
02001000 g 00003d68 gSaveBlock1
02005000 g 00000f24 gSaveBlock2
03000000 g 00000020 gPlayerAvatar
02000100 g 00000160 gBattleMons
08000100 g 00000040 gMapHeader
08000200 l 00000020 HandleInputChooseAction
08000300 l 00000020 HandleInputChooseAction
  `);
  await writeFixture(root, "include/global.h", `
struct SaveBlock1 {
  /*0x0000*/ struct Coords16 pos;
  /*0x0004*/ struct WarpData location;
  /*0x0EE0*/ u8 flags[288];
  /*0x1000*/ u16 vars[256];
}; // size: 0x3D68
struct SaveBlock2 {
  /*0x000*/ u8 playerName[8];
  /*0xF20*/ u32 encryptionKey;
}; // size: 0xF24
  `);
  await writeFixture(root, "include/global.fieldmap.h", `
struct PlayerAvatar {
  /*0x00*/ u8 flags;
  /*0x03*/ u8 tileTransitionState;
};
  `);
  await writeFixture(root, "include/pokemon.h", `
struct BattlePokemon {
  /*0x00*/ u16 species;
  /*0x28*/ u16 hp;
};
  `);
  await writeFixture(root, "include/constants/battle.h", `
#define MAX_BATTLERS_COUNT 4
  `);

  const { extractRuntimeSymbols } = await loadRuntimeExtractor();
  assert.equal(typeof extractRuntimeSymbols, "function");
  const result = await extractRuntimeSymbols(root, {
    requiredSymbols: ["gSaveBlock1Ptr", "gPlayerAvatar", "gMapHeader"],
  });

  assert.deepEqual(result.symbols.gSaveBlock1Ptr, {
    address: 0x02000000,
    addressHex: "0x02000000",
    binding: "g",
    size: 4,
    region: "EWRAM",
  });
  assert.equal(result.symbols.gPlayerAvatar.region, "IWRAM");
  assert.equal(result.symbols.gMapHeader.region, "ROM");
  assert.equal(result.symbols.HandleInputChooseAction.address, 0x08000200);
  assert.deepEqual(result.symbols["HandleInputChooseAction@0x08000300"], {
    address: 0x08000300,
    addressHex: "0x08000300",
    binding: "l",
    size: 0x20,
    region: "ROM",
    sourceName: "HandleInputChooseAction",
  });
  assert.equal(result.structures.PlayerAvatar.size, 0x20);
  assert.equal(result.structures.BattlePokemon.size, 0x58);
  assert.deepEqual(result.structures.SaveBlock1, {
    size: 0x3d68,
    fields: {
      pos: { offset: 0 },
      location: { offset: 4 },
      flags: { offset: 0x0ee0 },
      vars: { offset: 0x1000 },
    },
  });
  assert.deepEqual(result.missingRequiredSymbols, []);
  assert.ok(result.reconciliation.every(({ passed }) => passed));
});
