import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import test from "node:test";

const project = new URL("..", import.meta.url);

test("the Mart seed command documents its private real-mGBA inputs", () => {
  const result = spawnSync(
    process.execPath,
    ["src/cli/prepare-mart-seed.js", "--help"],
    { cwd: project, encoding: "utf8" },
  );

  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, /Usage:/);
  assert.match(result.stdout, /--rom/);
  assert.match(result.stdout, /--core/);
  assert.match(result.stdout, /--source-sram/);
  assert.match(result.stdout, /--output/);
  assert.match(result.stdout, /stock FireRed Rev 1/i);
});

test("the Mart seed command never guesses a historical SRAM source", () => {
  const result = spawnSync(
    process.execPath,
    [
      "src/cli/prepare-mart-seed.js",
      "--rom",
      "stock.gba",
      "--core",
      "pinned-core",
    ],
    { cwd: project, encoding: "utf8" },
  );

  assert.equal(result.status, 2);
  assert.match(result.stderr, /--source-sram.*required/i);
});
