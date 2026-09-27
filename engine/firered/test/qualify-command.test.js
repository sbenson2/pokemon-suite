import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import test from "node:test";

const project = new URL("..", import.meta.url);

test("the emulator qualification command documents private and pinned inputs", () => {
  const result = spawnSync(
    process.execPath,
    ["src/cli/qualify-emulator.js", "--help"],
    { cwd: project, encoding: "utf8" },
  );

  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, /Usage:/);
  assert.match(result.stdout, /--gate/);
  assert.match(result.stdout, /--rom/);
  assert.match(result.stdout, /--core/);
  assert.match(result.stdout, /--suite/);
  assert.match(result.stdout, /--record/);
  assert.match(result.stdout, /real mGBA/i);
});

test("qualification refuses an implicit cartridge path", () => {
  const result = spawnSync(
    process.execPath,
    ["src/cli/qualify-emulator.js", "--gate", "atomic-observation-sampling"],
    { cwd: project, encoding: "utf8" },
  );

  assert.equal(result.status, 2);
  assert.match(result.stderr, /--rom.*required/i);
});

test("qualification rejects gates that synthetic evidence could accidentally invent", () => {
  const result = spawnSync(
    process.execPath,
    [
      "src/cli/qualify-emulator.js",
      "--gate",
      "ordinary-wild-battle-policy",
      "--rom",
      "private.gba",
    ],
    { cwd: project, encoding: "utf8" },
  );

  assert.equal(result.status, 2);
  assert.match(result.stderr, /unsupported Stage 2 gate/i);
});

