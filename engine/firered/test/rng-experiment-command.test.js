import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import test from "node:test";

const run = (...args) => spawnSync(process.execPath, ["src/cli/run-rng-experiment.js", ...args], { encoding: "utf8" });
test("isolated RNG experiment help separates inspection, replay, and guided experiments", () => {
  const result = run("--help");
  assert.equal(result.status, 0);
  assert.match(result.stdout, /--execute/);
  assert.match(result.stdout, /never.*qualification/i);
});
test("RNG experiments cannot boot a new save or use implicit state/SRAM inputs", () => {
  const result = run("--rom", "rom", "--core", "core", "--config", "plan.json");
  assert.equal(result.status, 1);
  assert.match(result.stderr, /--state.*--sram/);
});

test("a valid replay configuration loads the repository's research bundle before private inputs", () => {
  const result = run("--rom", "missing-rom", "--core", "missing-core", "--state", "missing-state", "--sram", "missing-sram",
    "--config", "config/rng-route1.replay.json");
  assert.equal(result.status, 1);
  assert.match(result.stderr, /ENOENT/);
});
