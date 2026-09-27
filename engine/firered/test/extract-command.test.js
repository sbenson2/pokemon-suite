import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import test from "node:test";

const project = new URL("..", import.meta.url);

test("the knowledge extraction command documents its private inputs", () => {
  const result = spawnSync(
    process.execPath,
    ["src/cli/extract-knowledge.js", "--help"],
    { cwd: project, encoding: "utf8" },
  );

  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, /Usage:/);
  assert.match(result.stdout, /--source/);
  assert.match(result.stdout, /--stock-rom/);
  assert.match(result.stdout, /--output/);
});

test("the knowledge extraction command refuses implicit source paths", () => {
  const result = spawnSync(
    process.execPath,
    ["src/cli/extract-knowledge.js"],
    { cwd: project, encoding: "utf8" },
  );

  assert.equal(result.status, 2);
  assert.match(result.stderr, /--source.*required/i);
});
