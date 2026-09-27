import assert from "node:assert/strict";
import { mkdir, mkdtemp, readFile, readdir, rm, utimes, writeFile } from "node:fs/promises";
import { createHash } from "node:crypto";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

async function loadCheckpointModule() {
  try {
    return await import("../src/player/checkpoint.js");
  } catch (error) {
    if (error?.code === "ERR_MODULE_NOT_FOUND") return {};
    throw error;
  }
}

test("a failed state write never publishes an automatic-resume sidecar", async (t) => {
  const root = await mkdtemp(join(tmpdir(), "master-red-checkpoint-failed-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  const state = new Uint8Array([1, 2, 3]);
  const digest = createHash("sha256").update(state).digest("hex");
  await mkdir(join(root, `failed-run.${digest}.state`));
  const { writePlayerCheckpoint } = await loadCheckpointModule();
  await assert.rejects(writePlayerCheckpoint({ outputDirectory: root, runId: "failed-run",
    session: { saveState: () => state, saveSram: () => new Uint8Array([4]) },
    playerState: { sequence: 1 },
  }));
  assert.equal((await readdir(root)).some((name) => name.endsWith(".state.player.json")), false);
});

test("a whole-emulator checkpoint roundtrips the central workflow sidecar", async (t) => {
  const root = await mkdtemp(join(tmpdir(), "master-red-checkpoint-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  const { writePlayerCheckpoint, readPlayerControlState } =
    await loadCheckpointModule();
  assert.equal(typeof writePlayerCheckpoint, "function");
  assert.equal(typeof readPlayerControlState, "function");
  const playerState = {
    schema: "master-red/central-player-state/v1",
    sequence: 42,
    initialSramSha256: "initial-sram",
    workflow: {
      schema: "master-red/control-workflow/v1",
      id: "battle-party-40",
      kind: "battle-party-selection",
      targetPartySlot: 1,
      targetSpecies: 56,
    },
    lastDecision: null,
  };

  const saved = await writePlayerCheckpoint({
    session: {
      saveState: () => new Uint8Array([1, 2, 3]),
      saveSram: () => new Uint8Array([4, 5]),
    },
    outputDirectory: root,
    runId: "checkpoint-run",
    status: { mode: "battle" },
    playerState,
  });
  const control = JSON.parse(await readFile(saved.controlStateFilePath));
  assert.equal(control.stateSha256, saved.stateSha256);
  assert.equal(control.sramSha256, saved.sramSha256);
  assert.deepEqual(control.playerState, playerState);

  const restored = await readPlayerControlState({
    statePath: saved.stateFilePath,
    stateSha256: saved.stateSha256,
    sramSha256: saved.sramSha256,
  });
  assert.deepEqual(restored, playerState);
});

test("a worker checkpoint uses one asynchronous atomic emulator snapshot", async (t) => {
  const root = await mkdtemp(join(tmpdir(), "master-red-checkpoint-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  const { writePlayerCheckpoint } = await loadCheckpointModule();
  let captures = 0;

  const saved = await writePlayerCheckpoint({
    session: {
      async captureSnapshot() {
        captures += 1;
        return {
          frame: 500,
          state: new Uint8Array([9, 8, 7]),
          sram: new Uint8Array([6, 5]),
        };
      },
    },
    outputDirectory: root,
    runId: "worker-checkpoint",
    status: { frame: 500 },
  });

  assert.equal(captures, 1);
  assert.deepEqual([...await readFile(saved.stateFilePath)], [9, 8, 7]);
  assert.deepEqual([...await readFile(saved.sramFilePath)], [6, 5]);
});

test("a campaign continuation cannot claim a different source run or omit its control state", async t => {
  const root = await mkdtemp(join(tmpdir(), "master-red-continuation-source-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  const { writePlayerCheckpoint, readPlayerControlState } = await loadCheckpointModule();
  const saved = await writePlayerCheckpoint({ session: { captureSnapshot: () => ({ state: new Uint8Array([1]), sram: new Uint8Array([2]) }) },
    outputDirectory: root, runId: "original-campaign", playerState: { sequence: 42 } });
  const input = { statePath: saved.stateFilePath, stateSha256: saved.stateSha256, sramSha256: saved.sramSha256 };
  assert.equal((await readPlayerControlState({ ...input, expectedRunId: "original-campaign" })).sequence, 42);
  await assert.rejects(readPlayerControlState({ ...input, expectedRunId: "another-campaign" }), /source run/);
  await assert.rejects(readPlayerControlState({ ...input, statePath: join(root, "missing.state"), expectedRunId: "original-campaign" }), /control sidecar/);
});

test("a background player resumes from the newest valid checkpoint for its run", async (t) => {
  const root = await mkdtemp(join(tmpdir(), "master-red-service-checkpoint-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  const { writePlayerCheckpoint, findLatestPlayerCheckpoint } =
    await loadCheckpointModule();
  assert.equal(typeof findLatestPlayerCheckpoint, "function");

  const older = await writePlayerCheckpoint({
    session: {
      saveState: () => new Uint8Array([1, 1, 1]),
      saveSram: () => new Uint8Array([2, 2]),
    },
    outputDirectory: root,
    runId: "service-run",
    status: { frame: 100 },
    playerState: { sequence: 100 },
  });
  const newest = await writePlayerCheckpoint({
    session: {
      saveState: () => new Uint8Array([3, 3, 3]),
      saveSram: () => new Uint8Array([4, 4]),
    },
    outputDirectory: root,
    runId: "service-run",
    status: { frame: 200 },
    playerState: { sequence: 200 },
  });
  await writePlayerCheckpoint({
    session: {
      saveState: () => new Uint8Array([5, 5, 5]),
      saveSram: () => new Uint8Array([6, 6]),
    },
    outputDirectory: root,
    runId: "another-run",
    status: { frame: 300 },
    playerState: { sequence: 300 },
  });
  const corruptPath = join(root, "service-run.corrupt.state.player.json");
  await writeFile(corruptPath, "not JSON\n");
  await utimes(older.controlStateFilePath, new Date(1000), new Date(1000));
  await utimes(newest.controlStateFilePath, new Date(2000), new Date(2000));
  await utimes(corruptPath, new Date(3000), new Date(3000));

  const selected = await findLatestPlayerCheckpoint({
    outputDirectory: root,
    runId: "service-run",
  });

  assert.equal(selected.stateFilePath, newest.stateFilePath);
  assert.equal(selected.sramFilePath, newest.sramFilePath);
  assert.equal(selected.playerState.sequence, 200);
  assert.deepEqual(selected.rejectedControlStatePaths, [corruptPath]);
});
