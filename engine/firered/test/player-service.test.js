import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";
import test from "node:test";

import { writePlayerCheckpoint } from "../src/player/checkpoint.js";
import { createRosterPlanForRun, rosterCheckpoint } from "../src/player/roster-selection.js";
import { createFireRedRosterContext } from "../src/player/fire-red-roster.js";
import { rosterContextFixture } from "../test-support/roster-context-fixture.js";

const execFileAsync = promisify(execFile);
const serviceCli = fileURLToPath(new URL("../src/cli/run-player-service.js", import.meta.url));
const playerCli = fileURLToPath(new URL("../src/cli/run-player.js", import.meta.url));

test("service validates a generated commitment and forwards its 256-bit seed without rebuilding it", async t => {
  const output = await mkdtemp(join(tmpdir(), "master-red-service-generated-"));
  t.after(() => rm(output, { recursive: true, force: true }));
  const teamSeed = `hex:${"123456789abcdef0".repeat(4)}`;
  const base = [serviceCli, "--rom", "/private/fire-red.gba", "--core", "/private/core", "--run-id", "generated-run",
    "--seed", "2", "--output", output, "--dry-run"];
  const fresh = JSON.parse((await execFileAsync(process.execPath, [...base, "--fresh-if-missing", "--team-seed", teamSeed])).stdout);
  assert.equal(fresh.arguments[fresh.arguments.indexOf("--team-seed") + 1], teamSeed);
  const rosterContext = createFireRedRosterContext(rosterContextFixture());
  const plan = createRosterPlanForRun(4, 2, null, { teamSeed, rosterContext });
  await writePlayerCheckpoint({ outputDirectory: output, runId: "generated-run",
    session: { saveState: () => new Uint8Array([1]), saveSram: () => new Uint8Array([2]) },
    playerState: { sequence: 1, ...rosterCheckpoint(plan) } });
  const resumed = JSON.parse((await execFileAsync(process.execPath, base)).stdout);
  assert.ok(resumed.checkpoint);
  await assert.rejects(execFileAsync(process.execPath, [...base, "--team-seed", "2"]), /checkpoint.*team seed/i);
});

test("service forwards fresh roster controls and refuses to change a resumed commitment", async t => {
  const output = await mkdtemp(join(tmpdir(), "master-red-service-roster-"));
  t.after(() => rm(output, { recursive: true, force: true }));
  const base = [serviceCli, "--rom", "/private/fire-red.gba", "--core", "/private/core",
    "--run-id", "roster-run", "--seed", "2", "--output", output, "--dry-run"];
  const args = ["--roster-mode", "origins", "--team-seed", "0"];
  const fresh = JSON.parse((await execFileAsync(process.execPath, [...base, "--fresh-if-missing", ...args])).stdout);
  assert.equal(fresh.arguments[fresh.arguments.indexOf("--roster-mode") + 1], "origins");
  assert.equal(fresh.arguments[fresh.arguments.indexOf("--team-seed") + 1], "0");
  await writePlayerCheckpoint({ outputDirectory: output, runId: "roster-run",
    session: { saveState: () => new Uint8Array([1]), saveSram: () => new Uint8Array([2]) },
    playerState: { sequence: 1, ...rosterCheckpoint(createRosterPlanForRun(4, 2, null, { rosterMode: "origins", teamSeed: 0 })) },
  });
  const resumed = JSON.parse((await execFileAsync(process.execPath, base)).stdout);
  assert.ok(resumed.checkpoint);
  assert.equal(resumed.arguments.includes("--roster-mode"), false, "omitted options restore, never default-reroll");
  await assert.rejects(execFileAsync(process.execPath, [...base, "--roster-mode", "coherent"]), /checkpoint.*roster mode/);
  await assert.rejects(execFileAsync(process.execPath, [...base, "--team-seed", "1"]), /checkpoint.*team seed/);
});

test("the supervisor does not relaunch a run stopped by transaction recovery", async (t) => {
  const output = await mkdtemp(join(tmpdir(), "master-red-service-safety-"));
  t.after(() => rm(output, { recursive: true, force: true }));
  await writePlayerCheckpoint({ outputDirectory: output, runId: "safety-run",
    session: { saveState: () => new Uint8Array([1]), saveSram: () => new Uint8Array([2]) },
    playerState: { sequence: 42, transactionRecovery: { blocked: { reason: "repeated-menu-transaction" } } },
  });
  await assert.rejects(execFileAsync(process.execPath, [serviceCli,
    "--rom", "/private/fire-red.gba", "--core", "/private/mgba-core", "--output", output,
    "--run-id", "safety-run", "--seed", "1", "--dry-run",
  ]), /safety stop/);
});

test("fresh-if-missing never replaces an existing run whose checkpoints are damaged", async (t) => {
  const output = await mkdtemp(join(tmpdir(), "master-red-service-damaged-"));
  t.after(() => rm(output, { recursive: true, force: true }));
  await writeFile(join(output, "existing-run.broken.state.player.json"), "invalid");
  await assert.rejects(execFileAsync(process.execPath, [serviceCli,
    "--rom", "/private/fire-red.gba", "--core", "/private/mgba-core",
    "--output", output, "--run-id", "existing-run", "--seed", "456",
    "--fresh-if-missing", "--dry-run",
  ]), /existing run.*no valid checkpoint/);
});

test("the background service launches the player from its newest checkpoint", async (t) => {
  const output = await mkdtemp(join(tmpdir(), "master-red-service-"));
  t.after(() => rm(output, { recursive: true, force: true }));
  const checkpoint = await writePlayerCheckpoint({
    session: {
      saveState: () => new Uint8Array([1, 2, 3]),
      saveSram: () => new Uint8Array([4, 5]),
    },
    outputDirectory: output,
    runId: "service-run",
    status: { frame: 400 },
    playerState: { sequence: 42 },
  });

  const { stdout, stderr } = await execFileAsync(process.execPath, [
    serviceCli,
    "--rom", "/private/fire-red.gba",
    "--core", "/private/mgba-core",
    "--output", output,
    "--run-id", "service-run",
    "--seed", "123",
    "--emulation-speed", "5",
    "--live-port", "17339",
    "--max-decisions", "50000",
    "--dry-run",
  ]);

  assert.equal(stderr, "");
  assert.deepEqual(JSON.parse(stdout), {
    schema: "master-red/player-service-plan/v1",
    runId: "service-run",
    checkpoint: {
      statePath: checkpoint.stateFilePath,
      sramPath: checkpoint.sramFilePath,
      playerSequence: 42,
      rejectedControlStatePaths: [],
    },
    executable: process.execPath,
    arguments: [
      playerCli,
      "--rom", "/private/fire-red.gba",
      "--core", "/private/mgba-core",
      "--state", checkpoint.stateFilePath,
      "--sram", checkpoint.sramFilePath,
      "--output", output,
      "--run-id", "service-run",
      "--seed", "123",
      "--emulation-speed", "5",
      "--live-port", "17339",
      "--max-decisions", "50000",
      "--linger",
    ],
  });
});

test("an explicitly fresh service run starts without fabricated checkpoint inputs", async (t) => {
  const output = await mkdtemp(join(tmpdir(), "master-red-service-fresh-"));
  t.after(() => rm(output, { recursive: true, force: true }));

  const { stdout, stderr } = await execFileAsync(process.execPath, [
    serviceCli,
    "--rom", "/private/fire-red.gba",
    "--core", "/private/mgba-core",
    "--output", output,
    "--run-id", "brand-new-run",
    "--seed", "456",
    "--emulation-speed", "10",
    "--live-port", "17339",
    "--max-decisions", "50000",
    "--fresh-if-missing",
    "--dry-run",
  ]);

  assert.equal(stderr, "");
  assert.deepEqual(JSON.parse(stdout), {
    schema: "master-red/player-service-plan/v1",
    runId: "brand-new-run",
    fresh: true,
    checkpoint: null,
    executable: process.execPath,
    arguments: [
      playerCli,
      "--rom", "/private/fire-red.gba",
      "--core", "/private/mgba-core",
      "--output", output,
      "--run-id", "brand-new-run",
      "--seed", "456",
      "--emulation-speed", "10",
      "--live-port", "17339",
      "--max-decisions", "50000",
      "--linger",
    ],
  });
});
