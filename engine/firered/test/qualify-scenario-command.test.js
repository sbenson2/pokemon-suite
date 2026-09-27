import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import test from "node:test";

const project = new URL("..", import.meta.url);

test("the scenario development command requires one explicit private scenario", () => {
  const result = spawnSync(
    process.execPath,
    ["src/cli/qualify-scenario.js", "--help"],
    { cwd: project, encoding: "utf8" },
  );

  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, /Usage:/);
  assert.match(result.stdout, /--scenario/);
  assert.match(result.stdout, /--suite/);
  assert.match(result.stdout, /--rom/);
  assert.match(result.stdout, /--core/);
  assert.match(result.stdout, /single-scenario/i);
  assert.match(result.stdout, /cannot satisfy.*public gate/i);
});

test("the scenario development command has no public-ledger recording mode", () => {
  const result = spawnSync(
    process.execPath,
    ["src/cli/qualify-scenario.js", "--record"],
    { cwd: project, encoding: "utf8" },
  );

  assert.equal(result.status, 2);
  assert.match(result.stderr, /unknown argument --record/i);
});

test("the scenario development command never guesses which scenario to run", () => {
  const result = spawnSync(
    process.execPath,
    [
      "src/cli/qualify-scenario.js",
      "--rom",
      "stock.gba",
      "--core",
      "pinned-core",
      "--suite",
      "private-suite.json",
    ],
    { cwd: project, encoding: "utf8" },
  );

  assert.equal(result.status, 2);
  assert.match(result.stderr, /--scenario.*required/i);
});
