import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import test from "node:test";

test("the check command reports every implementation gate passed", () => {
  const result = spawnSync(
    process.execPath,
    ["src/cli/check-foundation.js"],
    { cwd: new URL("..", import.meta.url), encoding: "utf8" },
  );

  assert.equal(result.status, 0, result.stderr);
  const report = JSON.parse(result.stdout);
  assert.equal(report.structurallyValid, true);
  assert.equal(report.phase, "implementation-ready");
  assert.equal(report.playerImplementationAllowed, true);
  assert.deepEqual(report.unmetGateIds, []);
  assert.ok(report.passedGateIds.includes("knowledge-pack-generation"));
  assert.ok(report.passedGateIds.includes("modal-transition-corpus"));
});
