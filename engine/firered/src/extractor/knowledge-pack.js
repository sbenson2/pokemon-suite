import { extractBattleMechanics } from "./battle.js";
import { writeContentAddressedArtifact } from "./artifact.js";
import { extractRuntimeSymbols } from "./runtime.js";
import { extractStoryState } from "./story.js";
import { extractWorldStructure } from "./world.js";

const SHA1 = /^[0-9a-f]{40}$/;
const SHA256 = /^[0-9a-f]{64}$/;
const COMMIT = /^[0-9a-f]{40}$/;

function definedCount(entries) {
  return entries.filter(Boolean).length;
}

function referenceCount(references) {
  return Object.values(references ?? {}).reduce(
    (count, occurrences) => count + occurrences.length,
    0,
  );
}

function worldCounts(result) {
  return {
    maps: result.maps.length,
    layouts: new Set(result.maps.map(({ layout }) => layout.id)).size,
    cells: result.maps.reduce((count, { layout }) => count + layout.cells.length, 0),
    connections: result.maps.reduce(
      (count, { connections }) => count + connections.length,
      0,
    ),
    warps: result.maps.reduce(
      (count, { warpEvents }) => count + warpEvents.length,
      0,
    ),
    objectEvents: result.maps.reduce(
      (count, { objectEvents }) => count + objectEvents.length,
      0,
    ),
    coordinateEvents: result.maps.reduce(
      (count, { coordEvents }) => count + coordEvents.length,
      0,
    ),
    backgroundEvents: result.maps.reduce(
      (count, { backgroundEvents }) => count + backgroundEvents.length,
      0,
    ),
    wildEncounterMaps: result.wildEncounters.length,
  };
}

function storyCounts(result) {
  return {
    scripts: result.scripts.length,
    instructions: result.scripts.reduce(
      (count, { instructions }) => count + instructions.length,
      0,
    ),
    flagSymbols: Object.keys(result.symbols.flags).length,
    variableSymbols: Object.keys(result.symbols.variables).length,
    itemSymbols: Object.keys(result.symbols.items).length,
    trainerSymbols: Object.keys(result.symbols.trainers).length,
    flagReferences: referenceCount(result.references.flags),
    variableReferences: referenceCount(result.references.variables),
    itemReferences: referenceCount(result.references.items),
    trainerReferences: referenceCount(result.references.trainers),
    unresolvedReferences: Object.values(result.unresolved).reduce(
      (count, names) => count + names.length,
      0,
    ),
    hallOfFameEntryReferences:
      result.goalEvidence.enterHallOfFameReferences.length,
  };
}

function runtimeCounts(result) {
  return {
    symbols: Object.keys(result.symbols).length,
    requiredSymbols: result.requiredSymbols.length,
    missingRequiredSymbols: result.missingRequiredSymbols.length,
    structures: Object.keys(result.structures).length,
    structureFields: Object.values(result.structures).reduce(
      (count, { fields }) => count + Object.keys(fields).length,
      0,
    ),
  };
}

function battleCounts(result) {
  return {
    moves: definedCount(result.moves),
    species: definedCount(result.species),
    typeChartEntries: result.typeChart.length,
    trainers: definedCount(result.trainers),
    rematches: (result.rematches ?? []).length,
    parties: Object.keys(result.parties).length,
    partyMembers: Object.values(result.parties).reduce(
      (count, party) => count + party.length,
      0,
    ),
  };
}

const DATASETS = [
  {
    id: "firered-world-structure",
    extract: extractWorldStructure,
    counts: worldCounts,
  },
  {
    id: "firered-story-state",
    extract: extractStoryState,
    counts: storyCounts,
  },
  {
    id: "firered-runtime-symbols",
    extract: extractRuntimeSymbols,
    counts: runtimeCounts,
  },
  {
    id: "firered-battle-mechanics",
    extract: extractBattleMechanics,
    counts: battleCounts,
  },
];

function validateProvenance({ cartridgeProfileId, source, generator, build }) {
  if (typeof cartridgeProfileId !== "string" || cartridgeProfileId.length === 0) {
    throw new TypeError("cartridgeProfileId is required");
  }
  if (
    typeof source?.id !== "string" ||
    !COMMIT.test(source?.revision ?? "")
  ) {
    throw new TypeError("knowledge source needs an immutable commit");
  }
  if (
    generator?.kind !== "source-bundle-sha256" ||
    !SHA256.test(generator?.revision ?? "") ||
    !Array.isArray(generator?.files) ||
    generator.files.length === 0
  ) {
    throw new TypeError("knowledge generator needs a content-addressed source bundle");
  }
  if (
    !SHA1.test(build?.romSha1 ?? "") ||
    !Number.isSafeInteger(build?.romBytes) ||
    build.romBytes <= 0 ||
    !SHA256.test(build?.symbolsSha256 ?? "")
  ) {
    throw new TypeError("runtime knowledge needs a verified stock build");
  }
}

export async function generateKnowledgePack({
  sourceRoot,
  outputDirectory,
  cartridgeProfileId,
  source,
  generator,
  build,
  collectedAt = new Date().toISOString(),
  extractors = {},
}) {
  validateProvenance({ cartridgeProfileId, source, generator, build });
  if (typeof sourceRoot !== "string" || typeof outputDirectory !== "string") {
    throw new TypeError("sourceRoot and outputDirectory are required");
  }
  if (Number.isNaN(Date.parse(collectedAt))) {
    throw new TypeError("collectedAt must be an ISO-compatible timestamp");
  }

  const extracted = await Promise.all(
    DATASETS.map(async (dataset) => ({
      ...dataset,
      result: await (extractors[dataset.id] ?? dataset.extract)(sourceRoot),
    })),
  );
  for (const { id, result } of extracted) {
    if (
      !Array.isArray(result?.reconciliation) ||
      result.reconciliation.length === 0 ||
      !result.reconciliation.every(({ passed }) => passed === true)
    ) {
      throw new Error(`${id} reconciliation did not pass`);
    }
  }

  const artifacts = [];
  for (const { id, counts, result } of extracted) {
    const { reconciliation, ...data } = result;
    const envelope = {
      schema: "master-red/knowledge-artifact/v1",
      datasetId: id,
      cartridgeProfileId,
      source,
      generator,
      derivation:
        id === "firered-runtime-symbols"
          ? { verifiedBuild: build }
          : undefined,
      reconciliation,
      data,
    };
    const written = await writeContentAddressedArtifact(
      outputDirectory,
      envelope,
    );
    artifacts.push({ datasetId: id, counts: counts(result), ...written });
  }

  const receipt = {
    schema: "master-red/knowledge-receipt/v1",
    datasetId: "knowledge-pack-receipt",
    gateId: "knowledge-pack-generation",
    evidenceClass: "artifact-validation",
    successes: artifacts.length,
    failures: 0,
    collectedAt,
    cartridgeProfileId,
    source,
    generator,
    verifiedBuild: build,
    datasets: artifacts.map(
      ({ datasetId: id, sha256: artifactSha256, bytes, counts }) => ({
        id,
        artifactSha256,
        bytes,
        counts,
        generatorRevision: generator.revision,
      }),
    ),
  };
  const receiptArtifact = await writeContentAddressedArtifact(
    outputDirectory,
    receipt,
  );

  return { artifacts, receipt, receiptArtifact };
}
