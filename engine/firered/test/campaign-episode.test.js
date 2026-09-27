import assert from "node:assert/strict";
import test from "node:test";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createHash, randomBytes } from "node:crypto";
import { gunzipSync } from "node:zlib";
import { spawnSync } from "node:child_process";
import { createCampaignEpisodeMonitor, createCampaignEpisodeRecorder } from "../src/player/campaign-episode.js";

function update(sequence, flags = {}, extra = {}) {
  return { decisions: sequence, decision: { sequence, kind: "act", reason: "policy-resolution",
    action: { buttons: ["a"], holdFrames: 1, releaseFrames: 1 } }, observation: {
    frame: sequence * 10, phase: "stable", emulator: { mode: "overworld" },
    sram: { sha256: "native-save" }, playerMemory: {
      sha256: `memory-${sequence}`, map: { id: "MAP_PALLET_TOWN" }, position: { x: 1, y: 1 },
      storyState: { flagIds: flags, variableIds: {} },
      trainer: { party: [], playTime: { hours: 0, minutes: 0, seconds: sequence } }, ...extra,
    },
  } };
}

test("the actual desktop episode 17 transient badge trace no longer passes Brock", async () => {
  const trace = JSON.parse(await readFile(new URL("./fixtures/episode-17-transient-badges.json", import.meta.url)));
  const monitor = createCampaignEpisodeMonitor({ target: "brock" });
  for (const [frame, phase, mode, bits, sha256, [hours, minutes, seconds]] of trace.samples) {
    const input = update(frame, Object.fromEntries([...bits].map((bit, i) => [2080 + i, bit === "1"])), {
      sha256, map: { id: trace.map }, trainer: { party: [], playTime: { hours, minutes, seconds } },
    });
    Object.assign(input.observation, { frame, phase, emulator: { mode } });
    assert.equal(monitor.observe(input).targetReached, false);
  }
  assert.equal(monitor.status().badgeCount, 0);
  assert.equal(monitor.status().gameSeconds, 5755);
});

test("an early-game episode records parcel return but stops only after the native Boulder Badge", () => {
  const monitor = createCampaignEpisodeMonitor({ target: "brock" });
  assert.equal(monitor.observe(update(1)).stopReason, null);
  const parcel = monitor.observe(update(2, { 2089: true }));
  assert.equal(parcel.milestones.oakParcel.sequence, 2);
  assert.equal(parcel.stopReason, null);
  const brock = monitor.observe(update(3, { 2089: true, 2080: true }));
  assert.equal(brock.stopReason, "target-reached");
  assert.equal(brock.milestones.brock.sequence, 3);
  assert.equal(brock.targetReached, true);
});

test("Hall of Fame episodes continue beyond Brock and require the central native-save completion", () => {
  const monitor = createCampaignEpisodeMonitor({ target: "hall-of-fame" });
  assert.equal(monitor.observe(update(1, { 2089: true, 2080: true })).targetReached, false);
  const finale = update(2, { 2089: true, 2080: true });
  finale.observation.emulator.mode = "hall-of-fame";
  assert.equal(monitor.observe(finale).targetReached, false);
  finale.decisions = finale.decision.sequence = 3;
  finale.decision.kind = "complete";
  finale.decision.reason = "native-hall-of-fame";
  assert.equal(monitor.observe(finale).stopReason, "target-reached");
});

test("manual assistance disqualifies a reached target and a safety stop ends the episode", () => {
  const assisted = createCampaignEpisodeMonitor({ target: "brock" });
  const input = update(1, { 2089: true, 2080: true });
  input.controlHandoff = { session: 1 };
  assert.equal(assisted.observe(input).stopReason, "manual-assistance");
  const blocked = createCampaignEpisodeMonitor({ target: "brock" });
  const stuck = update(1);
  stuck.decision.kind = "blocked";
  assert.equal(blocked.observe(stuck).stopReason, "safety-stop");
});

test("meaningful-progress timeout ignores aimless movement but resets for earned experience", () => {
  let now = 0;
  const monitor = createCampaignEpisodeMonitor({ target: "brock", clock: () => now, progressTimeoutMs: 100 });
  monitor.observe(update(1));
  now = 90;
  monitor.observe(update(2, {}, { trainer: { party: [{ species: 1, level: 5, experience: 150 }] } }));
  now = 150;
  assert.equal(monitor.observe(update(3, {}, { trainer: { party: [{ species: 1, level: 5, experience: 150 }] }, position: { x: 5, y: 5 } })).stopReason, null);
  now = 191;
  assert.equal(monitor.observe(update(4, {}, { trainer: { party: [{ species: 1, level: 5, experience: 150 }] }, position: { x: 6, y: 5 } })).stopReason, "no-meaningful-progress");
});

test("the episode deadline uses native play time rather than decision count", () => {
  const monitor = createCampaignEpisodeMonitor({ target: "brock", maxGameSeconds: 60 });
  assert.equal(monitor.observe(update(1, {}, { trainer: { party: [], playTime: { hours: 0, minutes: 2, seconds: 0 } } })).stopReason, "game-time-limit");
});

test("untimed campaigns keep progressing past forty game hours but still detect a genuine stall", () => {
  let now = 0;
  const monitor = createCampaignEpisodeMonitor({ target: "hall-of-fame", maxGameSeconds: null,
    clock: () => now, progressTimeoutMs: 100 });
  const sample = (sequence, xp) => update(sequence, {}, { trainer: {
    party: [{ species: 6, personality: 123, experience: xp }], playTime: { hours: 60, minutes: 0, seconds: 0 } } });
  assert.equal(monitor.observe(sample(1, 200)).stopReason, null);
  now = 90;
  assert.equal(monitor.observe(sample(2, 300)).stopReason, null);
  now = 191;
  assert.equal(monitor.observe(sample(3, 300)).stopReason, "no-meaningful-progress");
});

test("a safety failure records the specific diagnostic cause and first failing observation", () => {
  const monitor = createCampaignEpisodeMonitor({ target: "hall-of-fame" });
  const sample = update(5);
  sample.decision = { ...sample.decision, kind: "blocked", reason: "repeated-menu-transaction" };
  const result = monitor.observe(sample);
  assert.equal(result.failure?.reason, "repeated-menu-transaction");
  assert.equal(result.failure?.frame, 50);
  assert.equal(result.failure?.sequence, 5);
  assert.deepEqual(monitor.observe(update(6)).failure, result.failure);
});

test("a continued campaign can reach the Hall of Fame without claiming a cold-start qualification", async t => {
  const root = await mkdtemp(join(tmpdir(), "master-red-continued-campaign-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  const recorder = await createCampaignEpisodeRecorder({ outputDirectory: join(root, "continued"),
    kind: "continuation", target: "hall-of-fame", maxGameSeconds: null,
    metadata: { resumed: true, sourceRunId: "original-run" } });
  const completed = update(1);
  completed.decision.kind = "complete"; completed.decision.reason = "native-hall-of-fame";
  await recorder.record(completed);
  await recorder.close({ result: "complete", checkpoint: { stateSha256: "completed" } });
  assert.equal(recorder.status().targetReached, true);
  assert.equal(recorder.status().qualificationEligible, false);
  assert.equal(recorder.status().evidenceKind, "continued-campaign");
  assert.equal(recorder.status().metadata.sourceRunId, "original-run");
});

test("battle initialization cannot award transient badge flags or overwrite confirmed progress", () => {
  const monitor = createCampaignEpisodeMonitor({ target: "brock" });
  monitor.observe(update(1));
  const transient = update(2, Object.fromEntries(Array.from({ length: 8 }, (_, i) => [2080 + i, true])));
  transient.observation.phase = "transition";
  transient.observation.emulator = { mode: "battle", callback2: "CB2_InitBattle" };
  transient.observation.playerMemory.map.id = "MAP_ROUTE2";
  const status = monitor.observe(transient);
  assert.equal(status.targetReached, false);
  assert.equal(status.milestones.brock, undefined);
  assert.equal(status.badgeCount, 0);
  assert.equal(status.gameSeconds, 1);
  assert.equal(monitor.observe(update(3)).stopReason, null);
  assert.equal(monitor.observe(update(4, { 2080: true })).targetReached, true);
});

test("boot and quest recap state cannot count as campaign achievements", () => {
  for (const kind of ["boot", "quest-recap"]) {
    const monitor = createCampaignEpisodeMonitor({ target: "brock" });
    const input = update(1, { 2080: true, 2089: true });
    if (kind === "boot") input.observation.emulator.mode = "boot";
    else input.observation.playerMemory.questLog = { playback: true };
    assert.equal(monitor.observe(input).targetReached, false, kind);
    assert.deepEqual(monitor.status().milestones, {}, kind);
  }
});

test("invalid observations cannot reset the meaningful-progress watchdog", () => {
  let now = 0;
  const monitor = createCampaignEpisodeMonitor({ target: "hall-of-fame", clock: () => now, progressTimeoutMs: 100 });
  monitor.observe(update(1));
  now = 101;
  const transient = update(2, { 2080: true });
  transient.observation.phase = "unknown";
  transient.observation.playerMemory.trainer.party = [{ species: 6, personality: 7, experience: 99999 }];
  assert.equal(monitor.observe(transient).stopReason, "no-meaningful-progress");
});

test("an episode preserves an independently hashed action trace and its native milestone proof", async (t) => {
  const root = await mkdtemp(join(tmpdir(), "master-red-episode-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  const recorder = await createCampaignEpisodeRecorder({ outputDirectory: join(root, "episode"),
    target: "brock", metadata: { runId: "isolated-1", resumed: false, sourceRevision: "frozen" } });
  assert.ok(recorder, "recorder must be created");
  await recorder.record(update(1));
  await recorder.record(update(2, { 2080: true, 2089: true }));
  await recorder.close({ result: "stopped", checkpoint: { stateSha256: "end-state" }, initialCheckpoint: { stateSha256: "start-state" } });
  const report = JSON.parse(await readFile(join(root, "episode", "episode.json")));
  assert.equal(report.targetReached, true);
  assert.equal(report.metadata.resumed, false);
  assert.equal(report.checkpoint.stateSha256, "end-state");
  assert.equal(report.initialCheckpoint.stateSha256, "start-state");
  const bytes = await readFile(join(root, "episode", "audit.jsonl.gz"));
  assert.equal(report.trace.sha256, createHash("sha256").update(bytes).digest("hex"));
  const records = gunzipSync(bytes).toString().trim().split("\n").map(JSON.parse);
  assert.equal(records.length, 2);
  assert.equal(records[0].observation.playerMemory.sha256, "memory-1");
  assert.deepEqual(records[1].decision.action.buttons, ["a"]);
  assert.equal(report.reviewRequired, true, "instrumentation does not self-issue qualification receipts");
  await assert.rejects(createCampaignEpisodeRecorder({outputDirectory: join(root, "episode"), target:"brock"}), /exist/i);
});

test("audit storage is bounded by an explicit failed episode, never silent trace pruning", async t => {
  const root=await mkdtemp(join(tmpdir(),"master-red-audit-limit-"));
  t.after(()=>rm(root,{recursive:true,force:true}));
  const recorder=await createCampaignEpisodeRecorder({outputDirectory:join(root,"episode"),target:"brock",maxTraceBytes:1});
  await recorder.record(update(1));
  assert.equal(recorder.status().stopReason,"audit-size-limit");
  await recorder.close({result:"stopped"});
  assert.equal(recorder.status().targetReached,false);
});

test("an oversized audit event cannot be forgotten when a later smaller event reaches the target", async t => {
  const root=await mkdtemp(join(tmpdir(),"master-red-audit-latch-"));
  t.after(()=>rm(root,{recursive:true,force:true}));
  const recorder=await createCampaignEpisodeRecorder({outputDirectory:join(root,"episode"),target:"brock",maxTraceBytes:2048});
  await recorder.record(update(1));
  const large=update(2);
  large.decision.reason=randomBytes(5000).toString("hex");
  await recorder.record(large);
  assert.equal(recorder.status().stopReason,"audit-size-limit");
  await recorder.record(update(3,{2080:true}));
  const status=recorder.status();
  await recorder.close({result:"stopped"});
  assert.equal(status.stopReason,"audit-size-limit");
  assert.equal(status.targetReached,false);
});

test("qualification CLI rejects resumed or interactive episodes before opening a cartridge", () => {
  for (const args of [
    ["--no-live", "--state", "missing.state", "--sram", "missing.sav"],
    [],
  ]) {
    const result = spawnSync(process.execPath, ["src/cli/run-player.js", "--rom", "missing.gba", "--core", "missing-core",
      "--qualification-target", "brock", ...args], { cwd: new URL("..", import.meta.url), encoding: "utf8" });
    assert.equal(result.status, 1);
    assert.match(result.stderr, /qualification requires a fresh headless run/);
  }
});

test("qualification accepts an explicitly view-only feed but still refuses resumed video episodes", () => {
  const base=["src/cli/run-player.js","--rom","missing.gba","--core","missing-core","--qualification-target","brock","--view-only"];
  const fresh=spawnSync(process.execPath,base,{cwd:new URL("..",import.meta.url),encoding:"utf8"});
  assert.equal(fresh.status,1);
  assert.match(fresh.stderr,/ENOENT/);
  assert.doesNotMatch(fresh.stderr,/unknown argument|qualification requires/);
  const resumed=spawnSync(process.execPath,[...base,"--state","a.state","--sram","a.sav"],{cwd:new URL("..",import.meta.url),encoding:"utf8"});
  assert.match(resumed.stderr,/qualification requires a fresh/);
});

test("checkpoint recovery is diagnostic evidence and requires healing the original party", async t => {
  const root = await mkdtemp(join(tmpdir(), "master-red-replay-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  const recorder = await createCampaignEpisodeRecorder({ outputDirectory: join(root, "replay"),
    kind: "replay", target: "party-restored", metadata: { resumed: true } });
  const sample = (sequence, hp, status1 = 0) => update(sequence, {}, {
    trainer: { party: [{ species: 143, personality: 123, hp, maxHp: 142, status1 }] },
  });
  await recorder.record(sample(1, 48, 8));
  const transient = sample(2, 142); transient.observation.phase = "transition";
  await recorder.record(transient);
  assert.equal(recorder.status().targetReached, false);
  await recorder.record(sample(3, 142, 8));
  assert.equal(recorder.status().targetReached, false, "poison still needs treatment");
  const substituted = sample(4, 142); substituted.observation.playerMemory.trainer.party[0].personality = 456;
  await recorder.record(substituted);
  assert.equal(recorder.status().targetReached, false, "boxing the sick member is not healing");
  await recorder.record(sample(5, 142));
  await recorder.close({ result: "stopped", checkpoint: { stateSha256: "recovered" } });
  const report = recorder.status();
  assert.equal(report.targetReached, true);
  assert.equal(report.evidenceKind, "checkpoint-diagnostic");
  assert.equal(report.qualificationEligible, false);
  assert.equal(report.milestones.recovery.frame, 50);
  const trace = gunzipSync(await readFile(join(root, "replay", "audit.jsonl.gz"))).toString();
  assert.match(trace, /"status1":8/, "audit must contain the HP and status evidence");
});

test("an already healthy replay cannot self-award a recovery pass", async t => {
  const root = await mkdtemp(join(tmpdir(), "master-red-replay-precondition-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  const recorder = await createCampaignEpisodeRecorder({ outputDirectory: join(root, "replay"),
    kind: "replay", target: "party-restored" });
  await recorder.record(update(1, {}, { trainer: { party: [{ species: 143, personality: 1, hp: 142, maxHp: 142, status1: 0 }] } }));
  assert.equal(recorder.status().stopReason, "scenario-precondition-failed");
  await recorder.close({ result: "stopped", checkpoint: {} });
  assert.equal(recorder.status().targetReached, false);
});

test("replay CLI refuses missing checkpoints, interactive input and mixed qualification", () => {
  for (const extra of [[], ["--state", "x", "--sram", "y"],
    ["--state", "x", "--sram", "y", "--no-live", "--qualification-target", "brock"]]) {
    const result = spawnSync(process.execPath, ["src/cli/run-player.js", "--rom", "missing.gba", "--core", "missing",
      "--scenario-target", "party-restored", ...extra], { encoding: "utf8" });
    assert.match(result.stderr, /replay requires/);
  }
});
