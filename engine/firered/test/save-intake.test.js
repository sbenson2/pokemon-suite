import assert from "node:assert/strict";
import test from "node:test";

import * as intake from "../src/evidence/save-intake.js";

function validObservation(overrides = {}) {
  return {
    frame: 120,
    phase: "stable",
    emulator: { mode: "overworld", callback2: "CB2_Overworld" },
    playerMemory: {
      saveFileStatus: 1,
      map: { id: "MAP_VIRIDIAN_CITY_GYM", group: 3, number: 0 },
      position: { x: 11, y: 17 },
    },
    ...overrides,
  };
}

test("save intake deduplicates identical explicit SRAM bytes and keeps every label", () => {
  const first = new Uint8Array(128 * 1024).fill(0x11);
  const second = new Uint8Array(128 * 1024).fill(0x22);

  const identified = intake.identifyStockSaveInputs([
    { label: "checkpoint-a.sav", sram: first },
    { label: "checkpoint-a-copy.sav", sram: first.slice() },
    { label: "checkpoint-b.sav", sram: second },
  ]);

  assert.equal(identified.length, 2);
  assert.deepEqual(identified[0].source.labels, [
    "checkpoint-a.sav",
    "checkpoint-a-copy.sav",
  ]);
  assert.equal(identified[0].source.bytes, 128 * 1024);
  assert.match(identified[0].source.sha256, /^[0-9a-f]{64}$/);
  assert.notEqual(identified[0].source.sha256, identified[1].source.sha256);
  assert.deepEqual(identified[0].sram, first);
});

test("save intake rejects anything that is not an exact FireRed flash image", () => {

  assert.throws(
    () =>
      intake.identifyStockSaveInputs([
        { label: "truncated.sav", sram: new Uint8Array(64 * 1024) },
      ]),
    /exactly 131072 bytes/i,
  );
});

test("save intake accepts only a stable overworld loaded by the stock save loader", () => {

  assert.doesNotThrow(() =>
    intake.assertAcceptedStockSaveObservation(validObservation()),
  );
  assert.throws(
    () =>
      intake.assertAcceptedStockSaveObservation(
        validObservation({
          playerMemory: {
            ...validObservation().playerMemory,
            saveFileStatus: 2,
          },
        }),
      ),
    /SAVE_STATUS_OK/i,
  );
  assert.throws(
    () =>
      intake.assertAcceptedStockSaveObservation(
        validObservation({
          emulator: { mode: "title", callback2: "CB2_TitleScreenRun" },
        }),
      ),
    /stable overworld/i,
  );
});

test("the stock-save bootstrap is bounded and supports Quest Log or direct continuation", () => {
  assert.ok(Array.isArray(intake.STOCK_SAVE_BOOTSTRAP_PROGRAM));
  assert.ok(intake.STOCK_SAVE_BOOTSTRAP_PROGRAM.length > 0);
  assert.ok(
    intake.STOCK_SAVE_BOOTSTRAP_PROGRAM.every(
      ({ maxFrames }) => Number.isSafeInteger(maxFrames) && maxFrames > 0,
    ),
  );
  const continuation = intake.STOCK_SAVE_BOOTSTRAP_PROGRAM.find(
    ({ id }) => id === "continue-valid-save",
  );
  assert.deepEqual(continuation.untilAny, [
    { emulator: { callback2: "CB2_SetUpOverworldForQLPlayback" } },
    {
      phase: "stable",
      emulator: { callback2: "CB2_Overworld", mode: "overworld" },
      playerMemory: { saveFileStatus: 1 },
    },
  ]);
  const final = intake.STOCK_SAVE_BOOTSTRAP_PROGRAM.at(-1);
  assert.equal(final.id, "settle-in-stock-overworld");
  assert.deepEqual(final.until, {
    phase: "stable",
    emulator: { callback2: "CB2_Overworld", mode: "overworld" },
    playerMemory: { saveFileStatus: 1 },
  });
});

test("a private stock-save catalog binds its recipe, core, source, and snapshot", () => {
  const sourceSha256 = "c".repeat(64);
  const catalog = intake.createStockSaveCatalog({
    runId: "save-intake-1",
    collectedAt: "2026-08-29T00:00:00.000Z",
    harnessRevision: "9".repeat(64),
    identity: {
      cartridgeProfileId: "firered-rev1-stock",
      romSha1: "d".repeat(40),
      mgbaCommit: "a".repeat(40),
      mgbaWrapperCommit: "b".repeat(40),
      mgbaJsSha256: "7".repeat(64),
      mgbaWasmSha256: "8".repeat(64),
    },
    knowledgeArtifacts: [
      { id: "firered-runtime-symbols", bytes: 100, sha256: "a".repeat(64) },
      { id: "firered-world-structure", bytes: 200, sha256: "b".repeat(64) },
    ],
    records: [
      {
        id: `stock-save-${sourceSha256.slice(0, 16)}`,
        source: {
          labels: ["checkpoint.sav"],
          bytes: 128 * 1024,
          sha256: sourceSha256,
        },
        bootstrap: { stages: [{ id: "settle", frames: 10 }] },
        snapshot: {
          frame: 120,
          statePath: `stock-save.${"1".repeat(64)}.state`,
          stateSha256: "1".repeat(64),
          sramPath: `stock-save.${"2".repeat(64)}.sav`,
          sramSha256: "2".repeat(64),
          observationSha256: "3".repeat(64),
          observation: validObservation(),
        },
      },
    ],
  });

  assert.equal(catalog.schema, "master-red/stock-save-catalog/v1");
  assert.equal(catalog.evidenceClass, "real-mgba-private-intake");
  assert.equal(catalog.entries.length, 1);
  assert.equal(catalog.entries[0].source.sha256, sourceSha256);
  assert.equal(catalog.entries[0].snapshot.stateSha256, "1".repeat(64));
  assert.equal(catalog.recipe.id, "stock-save-continue/v1");
  assert.deepEqual(catalog.recipe.program, intake.STOCK_SAVE_BOOTSTRAP_PROGRAM);
});
