// FRLG knowledge versions. pret/pokefirered builds FireRed and LeafGreen from
// one source tree (Makefile targets firered_rev1 and leafgreen_rev1). The two
// packs differ only where the build differs: the built symbol file and the
// version's own wild tables (src/data/wild_encounters.json labels ending
// _FireRed or _LeafGreen). FireRed is the default everywhere.
const freeze = Object.freeze;

export const KNOWLEDGE_VERSIONS = freeze({
  firered: freeze({
    game: "firered",
    cartridgeProfileId: "firered-rev1-stock",
    datasetPrefix: "firered",
    encounterSuffix: "_FireRed",
    buildName: "pokefirered_rev1",
    target: "FIRERED REVISION=1 MODERN=0",
  }),
  leafgreen: freeze({
    game: "leafgreen",
    cartridgeProfileId: "leafgreen-rev1-stock",
    datasetPrefix: "leafgreen",
    encounterSuffix: "_LeafGreen",
    buildName: "pokeleafgreen_rev1",
    target: "LEAFGREEN REVISION=1 MODERN=0",
  }),
});

export function knowledgeVersion(version = "firered") {
  if (!Object.hasOwn(KNOWLEDGE_VERSIONS, version)) {
    throw new TypeError("knowledge version must be FireRed or LeafGreen");
  }
  return KNOWLEDGE_VERSIONS[version];
}

export function knowledgeVersionForProfile(cartridgeProfileId) {
  return Object.values(KNOWLEDGE_VERSIONS).find(
    (version) => version.cartridgeProfileId === cartridgeProfileId,
  ) ?? null;
}
