import assert from "node:assert/strict";
import test from "node:test";

async function loadPrimitives() {
  try {
    return await import("../src/extractor/primitives.js");
  } catch (error) {
    if (error?.code === "ERR_MODULE_NOT_FOUND") return {};
    throw error;
  }
}

test("numeric C defines resolve literals, aliases, and restricted expressions", async () => {
  const { parseNumericDefines } = await loadPrimitives();
  assert.equal(
    typeof parseNumericDefines,
    "function",
    "the stock extractor needs a numeric define parser",
  );

  const definitions = parseNumericDefines(`
    #define ZERO 0
    #define BASE 0x4000
    #define STORY_FLAG (BASE + 0x2C)
    #define MAP_TEST (3 | (2 << 8))
    #define LAST STORY_FLAG
  `);

  assert.deepEqual(definitions, {
    ZERO: { expression: "0", value: 0 },
    BASE: { expression: "0x4000", value: 16384 },
    STORY_FLAG: { expression: "(BASE + 0x2C)", value: 16428 },
    MAP_TEST: { expression: "(3 | (2 << 8))", value: 515 },
    LAST: { expression: "STORY_FLAG", value: 16428 },
  });
});

test("numeric C defines can resolve dependencies supplied by another header", async () => {
  const { parseNumericDefines } = await loadPrimitives();

  assert.deepEqual(
    parseNumericDefines("#define FLAG_AFTER_TRAINERS (MAX_TRAINERS_COUNT + 1)", {
      MAX_TRAINERS_COUNT: 768,
    }),
    {
      FLAG_AFTER_TRAINERS: {
        expression: "(MAX_TRAINERS_COUNT + 1)",
        value: 769,
      },
    },
  );
});

test("map grid words split into metatile, collision, and elevation", async () => {
  const { decodeMapGrid } = await loadPrimitives();
  assert.equal(typeof decodeMapGrid, "function");

  assert.deepEqual(decodeMapGrid(Buffer.from([0x01, 0x00, 0x02, 0x1c]), 2, 1), {
    width: 2,
    height: 1,
    cells: [
      { metatileId: 1, collision: 0, elevation: 0 },
      { metatileId: 2, collision: 3, elevation: 1 },
    ],
  });
  assert.throws(
    () => decodeMapGrid(Buffer.from([0x01, 0x00]), 2, 1),
    /byte length/i,
  );
});

test("metatile attribute words expose cartridge bitfields", async () => {
  const { decodeMetatileAttributes } = await loadPrimitives();
  assert.equal(typeof decodeMetatileAttributes, "function");

  const raw =
    0x69 |
    (2 << 9) |
    (3 << 14) |
    (4 << 18) |
    (1 << 24) |
    (2 << 27) |
    (2 << 29) |
    (1 << 31);
  const bytes = Buffer.alloc(4);
  bytes.writeUInt32LE(raw >>> 0);

  assert.deepEqual(decodeMetatileAttributes(bytes), [
    {
      raw: raw >>> 0,
      behavior: 0x69,
      terrain: 2,
      attribute2: 3,
      attribute3: 4,
      encounterType: 1,
      attribute5: 2,
      layerType: 2,
      attribute7: 1,
    },
  ]);
  assert.throws(() => decodeMetatileAttributes(Buffer.alloc(3)), /multiple of 4/i);
});

test("designated C initializers become structured data without evaluating code", async () => {
  const { parseDesignatedInitializers } = await loadPrimitives();
  assert.equal(typeof parseDesignatedInitializers, "function");

  const entries = parseDesignatedInitializers(`
    const struct Thing values[] = {
      [MOVE_TEST] = {
        .power = 40,
        .types = {TYPE_FIRE, TYPE_FLYING},
        .flags = FLAG_CONTACT | FLAG_PROTECT,
        .name = _("TEST"),
        .chance = PERCENT(12.5),
      },
      [OTHER_ENTRY] = {.power = 1},
    };
  `, "MOVE_");

  assert.deepEqual(entries, {
    MOVE_TEST: {
      power: 40,
      types: ["TYPE_FIRE", "TYPE_FLYING"],
      flags: "FLAG_CONTACT | FLAG_PROTECT",
      name: "TEST",
      chance: { call: "PERCENT", args: [12.5] },
    },
  });
});

test("designated C initializers preserve macro-valued entries", async () => {
  const { parseDesignatedInitializers } = await loadPrimitives();

  assert.deepEqual(
    parseDesignatedInitializers(`
      const struct Thing values[] = {
        [SPECIES_NORMAL] = {.baseHP = 45},
        [SPECIES_LEGACY] = SHARED_SPECIES_INFO,
      };
    `, "SPECIES_"),
    {
      SPECIES_NORMAL: { baseHP: 45 },
      SPECIES_LEGACY: { value: "SHARED_SPECIES_INFO" },
    },
  );
});
