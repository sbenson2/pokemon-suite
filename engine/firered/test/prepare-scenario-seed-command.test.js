import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import test from "node:test";

const project = new URL("..", import.meta.url);

test("the generic scenario-seed command documents its explicit provenance boundary", () => {
  const result = spawnSync(
    process.execPath,
    ["src/cli/prepare-scenario-seed.js", "--help"],
    { cwd: project, encoding: "utf8" },
  );

  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, /Usage:/);
  assert.match(result.stdout, /--id/);
  assert.match(result.stdout, /--program/);
  assert.match(result.stdout, /--source-state/);
  assert.match(result.stdout, /--source-sram/);
  assert.match(result.stdout, /--fresh-boot/);
  assert.match(result.stdout, /stock FireRed Rev 1/i);
});

test("scenario-seed preparation requires one explicit starting mode", () => {
  const result = spawnSync(
    process.execPath,
    [
      "src/cli/prepare-scenario-seed.js",
      "--id",
      "example",
      "--program",
      "program.json",
      "--rom",
      "stock.gba",
      "--core",
      "pinned-core",
    ],
    { cwd: project, encoding: "utf8" },
  );

  assert.equal(result.status, 2);
  assert.match(result.stderr, /source-state.*source-sram.*fresh-boot/i);
});

test("scenario-seed preparation rejects a mixed boot and state source", () => {
  const result = spawnSync(
    process.execPath,
    [
      "src/cli/prepare-scenario-seed.js",
      "--id",
      "example",
      "--program",
      "program.json",
      "--rom",
      "stock.gba",
      "--core",
      "pinned-core",
      "--source-state",
      "source.state",
      "--source-sram",
      "source.sav",
      "--fresh-boot",
    ],
    { cwd: project, encoding: "utf8" },
  );

  assert.equal(result.status, 2);
  assert.match(result.stderr, /exactly one starting mode/i);
});
