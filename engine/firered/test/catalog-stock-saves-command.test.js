import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import test from "node:test";

const project = new URL("..", import.meta.url);

test("the stock-save catalog command documents repeatable explicit SRAM inputs", () => {
  const result = spawnSync(
    process.execPath,
    ["src/cli/catalog-stock-saves.js", "--help"],
    { cwd: project, encoding: "utf8" },
  );

  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, /Usage:/);
  assert.match(result.stdout, /--rom/);
  assert.match(result.stdout, /--core/);
  assert.match(result.stdout, /--source-sram/);
  assert.match(result.stdout, /repeat/i);
  assert.match(result.stdout, /never scans/i);
  assert.match(result.stdout, /SAVE_STATUS_OK/);
});

test("stock-save intake refuses to guess an SRAM source", () => {
  const result = spawnSync(
    process.execPath,
    [
      "src/cli/catalog-stock-saves.js",
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

test("stock-save intake exposes no implicit directory scanning mode", () => {
  const result = spawnSync(
    process.execPath,
    ["src/cli/catalog-stock-saves.js", "--scan", "/old-bot"],
    { cwd: project, encoding: "utf8" },
  );

  assert.equal(result.status, 2);
  assert.match(result.stderr, /unknown argument --scan/i);
});
