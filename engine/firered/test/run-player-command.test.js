import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import test from "node:test";

test("roster controls accept reproducible modes and reject invalid or experiment-conflicting requests", () => {
  const run = args => spawnSync(process.execPath, ["src/cli/run-player.js", "--rom", "missing.gba",
    "--core", "missing-core", "--no-live", ...args], { encoding: "utf8" });
  for (const mode of ["coherent", "origins", "fixed"]) {
    const result = run(["--roster-mode", mode, "--team-seed", "0"]);
    assert.match(result.stderr, /ENOENT/);
    assert.doesNotMatch(result.stderr, /unknown argument|invalid roster/i);
  }
  assert.match(run(["--roster-mode", "anything"]).stderr, /roster mode/i);
  const wideSeed = run(["--team-seed", `hex:${"123456789abcdef0".repeat(4)}`]);
  assert.match(wideSeed.stderr, /ENOENT/);
  assert.doesNotMatch(wideSeed.stderr, /team.seed.*must/i);
  for (const value of ["-1", "4294967296", "1.5", "NaN"]) {
    assert.match(run(["--team-seed", value]).stderr, /team.seed/i);
  }
  assert.match(run(["--experiment", "missing.json", "--roster-mode", "coherent"]).stderr, /experiment.*roster/i);
  assert.match(run(["--experiment", "missing.json", "--team-seed", "0"]).stderr, /experiment.*roster/i);
});

test("training experiments are isolated, view-only, and cannot masquerade as campaign qualification", () => {
  const run = args => spawnSync(process.execPath, ["src/cli/run-player.js", "--rom", "missing.gba",
    "--core", "missing-core", "--experiment", "missing-experiment.json", ...args], { encoding: "utf8" });
  assert.match(run(["--no-live", "--until-target"]).stderr, /ENOENT/);
  assert.match(run(["--no-live", "--qualification-target", "hall-of-fame"]).stderr, /experiment.*qualification/i);
  assert.match(run([]).stderr, /experiment.*view-only/i);
  assert.match(run(["--no-live", "--state", "s", "--sram", "sram"]).stderr, /experiment.*source.run.id/i);
});

test("the continuous player command documents stock-ROM, checkpoint, and live-view inputs", () => {
  const result = spawnSync(process.execPath, ["src/cli/run-player.js", "--help"], {
    cwd: new URL("..", import.meta.url),
    encoding: "utf8",
  });
  assert.equal(result.status, 0);
  assert.match(result.stdout, /--rom PATH/);
  assert.match(result.stdout, /--state PATH/);
  assert.match(result.stdout, /--sram PATH/);
  assert.match(result.stdout, /--story PATH/);
  assert.match(result.stdout, /--live-port N/);
  assert.match(result.stdout, /--emulation-speed N/);
  assert.match(result.stdout, /--diagnostic-snapshot-interval N/);
  assert.match(result.stdout, /--diagnostic-stall-threshold N/);
  assert.match(result.stdout, /bounded rolling decision journal/i);
  assert.match(result.stdout, /--seed N/);
  assert.match(result.stdout, /preset names/i);
  assert.match(result.stdout, /seeded permanent six-member team/i);
  assert.match(result.stdout, /30-hour.*24-hour stretch/i);
  assert.match(result.stdout, /central delegator/i);
  assert.match(result.stdout, /emulator worker owns.*clock/i);
  assert.doesNotMatch(result.stdout, /--frame-pace-ms/);
});

test("the player refuses the removed bot-owned frame pacing control", () => {
  const result = spawnSync(process.execPath, [
    "src/cli/run-player.js",
    "--rom", "missing.gba",
    "--core", "missing-core",
    "--frame-pace-ms", "2",
  ], {
    cwd: new URL("..", import.meta.url),
    encoding: "utf8",
  });

  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /unknown argument --frame-pace-ms/i);
});

test("until-target campaigns accept no decision cap but cannot unbound hunting or hide a conflicting cap", () => {
  const base = ["src/cli/run-player.js", "--rom", "missing.gba", "--core", "missing-core", "--no-live"];
  const run = args => spawnSync(process.execPath, [...base, ...args], { encoding: "utf8" });
  const valid = run(["--qualification-target", "hall-of-fame", "--until-target"]);
  assert.match(valid.stderr, /ENOENT/);
  assert.doesNotMatch(valid.stderr, /unknown argument|UsageError/);
  assert.match(run(["--until-target"]).stderr, /until-target requires a campaign/i);
  assert.match(run(["--qualification-target", "hall-of-fame", "--until-target", "--max-decisions", "10"]).stderr,
    /until-target conflicts/i);
});

test("a continuation requires linked checkpoints and cannot masquerade as a fresh campaign", () => {
  const base = ["src/cli/run-player.js", "--rom", "missing.gba", "--core", "missing-core", "--no-live",
    "--continuation-target", "hall-of-fame", "--until-target"];
  const run = args => spawnSync(process.execPath, [...base, ...args], { encoding: "utf8" });
  const inputs = ["--state", "checkpoint.state", "--sram", "checkpoint.sav", "--source-run-id", "previous-run"];
  assert.match(run(inputs).stderr, /ENOENT/);
  assert.match(run([]).stderr, /continuation requires/i);
  assert.match(run([...inputs, "--qualification-target", "hall-of-fame"]).stderr, /continuation requires/i);
  assert.match(run([...inputs, "--hunt-config", "hunt.json"]).stderr, /continuation requires/i);
});

test("the continuous player refuses implicit licensed cartridge input", () => {
  const result = spawnSync(process.execPath, ["src/cli/run-player.js"], {
    cwd: new URL("..", import.meta.url),
    encoding: "utf8",
  });
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /--rom is required/i);
});

test("hunting requires explicit paired resume inputs and cannot share a qualification campaign", () => {
  const launch = (...args) => spawnSync(process.execPath, ["src/cli/run-player.js", "--rom", "missing.gba",
    "--core", "missing-core", "--hunt-config", "hunt.json", ...args], { cwd: new URL("..", import.meta.url), encoding: "utf8" });
  const fresh = launch();
  assert.notEqual(fresh.status, 0);
  assert.match(fresh.stderr, /hunting requires.*state.*sram/i);
  const qualification = launch("--qualification-target", "brock", "--no-live");
  assert.notEqual(qualification.status, 0);
  assert.match(qualification.stderr, /hunting.*qualification/i);
});
