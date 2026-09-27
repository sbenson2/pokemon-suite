import assert from "node:assert/strict";
import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

async function writeFixture(root, path, value) {
  const target = join(root, path);
  await mkdir(join(target, ".."), { recursive: true });
  await writeFile(
    target,
    Buffer.isBuffer(value) ? value : typeof value === "string" ? value : `${JSON.stringify(value, null, 2)}\n`,
  );
}

async function loadWorldExtractor() {
  try {
    return await import("../src/extractor/world.js");
  } catch (error) {
    if (error?.code === "ERR_MODULE_NOT_FOUND") return {};
    throw error;
  }
}

test("world extraction resolves groups, layouts, collision, behaviors, warps, and FireRed encounters", async (t) => {
  const root = await mkdtemp(join(tmpdir(), "master-red-world-"));
  t.after(() => rm(root, { recursive: true, force: true }));

  await writeFixture(root, "data/maps/map_groups.json", {
    group_order: ["gMapGroup_Test"],
    gMapGroup_Test: ["TinyMap"],
  });
  await writeFixture(root, "data/maps/TinyMap/map.json", {
    id: "MAP_TINY_MAP",
    name: "TinyMap",
    layout: "LAYOUT_TINY",
    connections: [{ map: "MAP_TINY_MAP", offset: 0, direction: "up" }],
    object_events: [],
    warp_events: [{ x: 1, y: 0, elevation: 1, dest_map: "MAP_TINY_MAP", dest_warp_id: "0" }],
    coord_events: [],
    bg_events: [],
  });
  await writeFixture(root, "data/layouts/layouts.json", {
    layouts: [
      {
        id: "LAYOUT_TINY",
        name: "Tiny_Layout",
        width: 2,
        height: 1,
        border_width: 1,
        border_height: 1,
        primary_tileset: "gTileset_General",
        secondary_tileset: "gTileset_Tiny",
        blockdata_filepath: "data/layouts/Tiny/map.bin",
      },
    ],
  });
  const mapBytes = Buffer.alloc(4);
  mapBytes.writeUInt16LE(1, 0);
  mapBytes.writeUInt16LE(640 | (3 << 10) | (1 << 12), 2);
  await writeFixture(root, "data/layouts/Tiny/map.bin", mapBytes);

  await writeFixture(
    root,
    "src/data/tilesets/metatiles.h",
    `
      const u32 gMetatileAttributes_General[] = INCBIN_U32("data/tilesets/primary/general/metatile_attributes.bin");
      const u32 gMetatileAttributes_Tiny[] = INCBIN_U32("data/tilesets/secondary/tiny/metatile_attributes.bin");
    `,
  );
  const primaryAttributes = Buffer.alloc(8);
  primaryAttributes.writeUInt32LE(0, 0);
  primaryAttributes.writeUInt32LE(2, 4);
  const secondaryAttributes = Buffer.alloc(4);
  secondaryAttributes.writeUInt32LE(0x69, 0);
  await writeFixture(root, "data/tilesets/primary/general/metatile_attributes.bin", primaryAttributes);
  await writeFixture(root, "data/tilesets/secondary/tiny/metatile_attributes.bin", secondaryAttributes);
  await writeFixture(root, "include/constants/metatile_behaviors.h", `
    #define MB_NORMAL 0
    #define MB_TALL_GRASS 2
    #define MB_WARP_DOOR 0x69
  `);
  await writeFixture(root, "src/data/wild_encounters.json", {
    wild_encounter_groups: [
      {
        label: "gWildMonHeaders",
        for_maps: true,
        encounters: [
          { map: "MAP_TINY_MAP", base_label: "sTiny_FireRed", land_mons: { encounter_rate: 10, mons: [] } },
          { map: "MAP_TINY_MAP", base_label: "sTiny_LeafGreen", land_mons: { encounter_rate: 20, mons: [] } },
        ],
      },
    ],
  });

  const { extractWorldStructure } = await loadWorldExtractor();
  assert.equal(typeof extractWorldStructure, "function");
  const result = await extractWorldStructure(root);

  assert.equal(result.maps.length, 1);
  assert.deepEqual(
    {
      id: result.maps[0].id,
      group: result.maps[0].group,
      number: result.maps[0].number,
      width: result.maps[0].layout.width,
      height: result.maps[0].layout.height,
      cells: result.maps[0].layout.cells,
    },
    {
      id: "MAP_TINY_MAP",
      group: 0,
      number: 0,
      width: 2,
      height: 1,
      cells: [
        { x: 0, y: 0, metatileId: 1, collision: 0, elevation: 0, tileset: "gTileset_General", behavior: 2, behaviorName: "MB_TALL_GRASS", terrain: 0, encounterType: 0, layerType: 0 },
        { x: 1, y: 0, metatileId: 640, collision: 3, elevation: 1, tileset: "gTileset_Tiny", behavior: 0x69, behaviorName: "MB_WARP_DOOR", terrain: 0, encounterType: 0, layerType: 0 },
      ],
    },
  );
  assert.equal(result.wildEncounters.length, 1);
  assert.equal(result.wildEncounters[0].base_label, "sTiny_FireRed");
  assert.ok(result.reconciliation.every(({ passed }) => passed));
});
