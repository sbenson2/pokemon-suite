import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { join } from "node:path";

import {
  decodeMapGrid,
  decodeMetatileAttributes,
  parseNumericDefines,
} from "./primitives.js";

async function readJson(root, path) {
  return JSON.parse(await readFile(join(root, path), "utf8"));
}

function sha256(bytes) {
  return createHash("sha256").update(bytes).digest("hex");
}

function parseTilesetAttributePaths(text) {
  const paths = new Map();
  const pattern = /gMetatileAttributes_(\w+)\[\]\s*=\s*INCBIN_U32\("([^"]+)"\)/g;
  for (const match of text.matchAll(pattern)) {
    paths.set(`gTileset_${match[1]}`, match[2]);
  }
  return paths;
}

function reconciliationCheck(id, expected, actual) {
  return { id, expected, actual, passed: expected === actual };
}

export async function extractWorldStructure(root) {
  const [groups, layoutsDocument, metatilesSource, behaviorSource, wildDocument] =
    await Promise.all([
      readJson(root, "data/maps/map_groups.json"),
      readJson(root, "data/layouts/layouts.json"),
      readFile(join(root, "src/data/tilesets/metatiles.h"), "utf8"),
      readFile(join(root, "include/constants/metatile_behaviors.h"), "utf8"),
      readJson(root, "src/data/wild_encounters.json"),
    ]);

  const layoutsById = new Map(
    layoutsDocument.layouts.map((layout) => [layout.id, layout]),
  );
  const tilesetPaths = parseTilesetAttributePaths(metatilesSource);
  const tilesetAttributes = new Map();
  const behaviorDefinitions = parseNumericDefines(behaviorSource);
  const behaviorNames = new Map(
    Object.entries(behaviorDefinitions)
      .filter(([name]) => name.startsWith("MB_"))
      .map(([name, { value }]) => [value, name]),
  );

  async function attributesFor(tileset) {
    if (tilesetAttributes.has(tileset)) return tilesetAttributes.get(tileset);
    const path = tilesetPaths.get(tileset);
    if (!path) throw new Error(`tileset ${tileset} has no attribute source`);
    const attributes = decodeMetatileAttributes(await readFile(join(root, path)));
    tilesetAttributes.set(tileset, attributes);
    return attributes;
  }

  const groupMaps = groups.group_order.flatMap((groupName, group) =>
    groups[groupName].map((name, number) => ({ groupName, group, name, number })),
  );
  const maps = [];

  for (const groupMap of groupMaps) {
    const sourceMap = await readJson(
      root,
      `data/maps/${groupMap.name}/map.json`,
    );
    const sourceLayout = layoutsById.get(sourceMap.layout);
    if (!sourceLayout) {
      throw new Error(`${sourceMap.id} references unknown layout ${sourceMap.layout}`);
    }
    const blockBytes = await readFile(join(root, sourceLayout.blockdata_filepath));
    const grid = decodeMapGrid(
      blockBytes,
      sourceLayout.width,
      sourceLayout.height,
    );
    const [primaryAttributes, secondaryAttributes] = await Promise.all([
      attributesFor(sourceLayout.primary_tileset),
      attributesFor(sourceLayout.secondary_tileset),
    ]);
    const cells = grid.cells.map((cell, index) => {
      const primary = cell.metatileId < 640;
      const tileset = primary
        ? sourceLayout.primary_tileset
        : sourceLayout.secondary_tileset;
      const attributes = (primary ? primaryAttributes : secondaryAttributes)[
        primary ? cell.metatileId : cell.metatileId - 640
      ];
      if (!attributes) {
        throw new Error(
          `${sourceMap.id} metatile ${cell.metatileId} has no attributes in ${tileset}`,
        );
      }
      return {
        x: index % grid.width,
        y: Math.floor(index / grid.width),
        ...cell,
        tileset,
        behavior: attributes.behavior,
        behaviorName: behaviorNames.get(attributes.behavior) ?? null,
        terrain: attributes.terrain,
        encounterType: attributes.encounterType,
        layerType: attributes.layerType,
      };
    });

    maps.push({
      id: sourceMap.id,
      name: sourceMap.name,
      groupName: groupMap.groupName,
      group: groupMap.group,
      number: groupMap.number,
      properties: Object.fromEntries(
        Object.entries(sourceMap).filter(
          ([key]) =>
            ![
              "id",
              "name",
              "layout",
              "connections",
              "object_events",
              "warp_events",
              "coord_events",
              "bg_events",
            ].includes(key),
        ),
      ),
      connections: sourceMap.connections ?? [],
      objectEvents: sourceMap.object_events ?? [],
      warpEvents: sourceMap.warp_events ?? [],
      coordEvents: sourceMap.coord_events ?? [],
      backgroundEvents: sourceMap.bg_events ?? [],
      layout: {
        id: sourceLayout.id,
        name: sourceLayout.name,
        width: sourceLayout.width,
        height: sourceLayout.height,
        borderWidth: sourceLayout.border_width,
        borderHeight: sourceLayout.border_height,
        primaryTileset: sourceLayout.primary_tileset,
        secondaryTileset: sourceLayout.secondary_tileset,
        blockDataSha256: sha256(blockBytes),
        cells,
      },
    });
  }

  const wildGroup = wildDocument.wild_encounter_groups.find(
    ({ label, for_maps: forMaps }) => label === "gWildMonHeaders" && forMaps,
  );
  const wildEncounters = (wildGroup?.encounters ?? []).filter(({ base_label: label }) =>
    label.endsWith("_FireRed"),
  );
  const mapIds = new Set(maps.map(({ id }) => id));
  const connections = maps.flatMap(({ connections: entries }) => entries);
  const warps = maps.flatMap(({ warpEvents }) => warpEvents);
  const knownWarpSentinels = new Set(["MAP_UNDEFINED", "MAP_DYNAMIC"]);

  const reconciliation = [
    reconciliationCheck("map-count-matches-groups", groupMaps.length, maps.length),
    reconciliationCheck("map-ids-are-unique", maps.length, mapIds.size),
    reconciliationCheck(
      "connection-destinations-resolve",
      connections.length,
      connections.filter(({ map }) => mapIds.has(map)).length,
    ),
    reconciliationCheck(
      "warp-destinations-resolve",
      warps.length,
      warps.filter(({ dest_map: destination }) =>
        mapIds.has(destination) || knownWarpSentinels.has(destination),
      ).length,
    ),
    reconciliationCheck(
      "firered-encounter-maps-resolve",
      wildEncounters.length,
      wildEncounters.filter(({ map }) => mapIds.has(map)).length,
    ),
  ];

  return {
    maps,
    wildEncounterRates: wildGroup?.fields ?? [],
    wildEncounters,
    metatileBehaviors: behaviorDefinitions,
    reconciliation,
  };
}
