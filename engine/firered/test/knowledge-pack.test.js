import assert from "node:assert/strict";
import { mkdtemp, readFile, readdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

async function loadKnowledgePack() {
  try {
    return await import("../src/extractor/knowledge-pack.js");
  } catch (error) {
    if (error?.code === "ERR_MODULE_NOT_FOUND") return {};
    throw error;
  }
}

const passingCheck = { id: "fixture-reconciles", expected: 1, actual: 1, passed: true };

function fixtureExtractors(overrides = {}) {
  return {
    "firered-world-structure": async () => ({
      maps: [{ connections: [], warpEvents: [], objectEvents: [], coordEvents: [], backgroundEvents: [], layout: { id: "LAYOUT", cells: [{}] } }],
      wildEncounters: [],
      reconciliation: [passingCheck],
    }),
    "firered-story-state": async () => ({
      scripts: [{ instructions: [] }],
      symbols: { flags: {}, variables: {}, items: {}, trainers: {} },
      references: { flags: {}, variables: {}, items: {}, trainers: {} },
      unresolved: { flags: [], variables: [], items: [], trainers: [] },
      goalEvidence: { enterHallOfFameReferences: [] },
      reconciliation: [passingCheck],
    }),
    "firered-runtime-symbols": async () => ({
      symbols: { gMain: {} },
      structures: { PlayerAvatar: { size: 32, fields: { flags: { offset: 0 } } } },
      requiredSymbols: ["gMain"],
      missingRequiredSymbols: [],
      reconciliation: [passingCheck],
    }),
    "firered-battle-mechanics": async () => ({
      moves: [{}],
      species: [{}],
      typeChart: [{}],
      trainers: [{}],
      parties: { sParty_Test: [{}] },
      rematches: [{}],
      reconciliation: [passingCheck],
    }),
    ...overrides,
  };
}

function options(outputDirectory, extractors = fixtureExtractors()) {
  return {
    sourceRoot: "/fixture/source",
    outputDirectory,
    cartridgeProfileId: "firered-rev1-stock",
    source: { id: "pret-pokefirered", revision: "b".repeat(40) },
    generator: {
      kind: "source-bundle-sha256",
      revision: "a".repeat(64),
      files: [{ path: "src/extractor.js", bytes: 1, sha256: "c".repeat(64) }],
    },
    build: {
      romSha1: "d".repeat(40),
      romBytes: 16_777_216,
      symbolsSha256: "e".repeat(64),
    },
    collectedAt: "2026-08-29T00:00:00.000Z",
    extractors,
  };
}

test("a knowledge pack writes four reconciled artifacts and one receipt", async (t) => {
  const root = await mkdtemp(join(tmpdir(), "master-red-pack-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  const { generateKnowledgePack } = await loadKnowledgePack();
  assert.equal(typeof generateKnowledgePack, "function");

  const result = await generateKnowledgePack(options(root));

  assert.equal(result.receipt.successes, 4);
  assert.equal(result.receipt.failures, 0);
  assert.equal(result.receipt.datasets.length, 4);
  assert.equal(result.artifacts.length, 4);
  assert.equal(
    result.receipt.datasets.find(({ id }) => id === "firered-battle-mechanics")
      ?.counts.rematches,
    1,
  );
  assert.equal((await readdir(root)).length, 5);
  assert.ok(
    result.receipt.datasets.every(
      ({ artifactSha256, generatorRevision }) =>
        /^[0-9a-f]{64}$/.test(artifactSha256) &&
        generatorRevision === "a".repeat(64),
    ),
  );

  const runtimeArtifact = result.artifacts.find(
    ({ datasetId }) => datasetId === "firered-runtime-symbols",
  );
  const runtimeEnvelope = JSON.parse(await readFile(runtimeArtifact.path, "utf8"));
  assert.equal(runtimeEnvelope.derivation.verifiedBuild.romSha1, "d".repeat(40));
  assert.equal(runtimeEnvelope.collectedAt, undefined);
});

test("a failed reconciliation writes no knowledge artifacts", async (t) => {
  const root = await mkdtemp(join(tmpdir(), "master-red-pack-fail-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  const { generateKnowledgePack } = await loadKnowledgePack();
  const extractors = fixtureExtractors({
    "firered-story-state": async () => ({
      reconciliation: [{ id: "broken", expected: 1, actual: 0, passed: false }],
    }),
  });

  await assert.rejects(
    generateKnowledgePack(options(root, extractors)),
    /firered-story-state.*reconciliation/i,
  );
  assert.deepEqual(await readdir(root), []);
});
