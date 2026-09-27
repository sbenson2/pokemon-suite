import assert from "node:assert/strict";
import test from "node:test";
import { mkdtemp, mkdir, readFile, writeFile, rm, realpath, symlink, rename } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { randomUUID } from "node:crypto";
import { spawn } from "node:child_process";
import { once } from "node:events";
import { removeTempDirectory } from "../test-support/temp-dir.mjs";
import { writePlayerCheckpoint } from "../src/player/checkpoint.js";
import * as stopReports from "../src/presentation/campaign-stop-report.js";

async function fixture(t, { timeoutMs = 1000 } = {}) {
  const root = await realpath(await mkdtemp(join(tmpdir(), "master-red-stop-")));
  t.after(() => removeTempDirectory(root));
  const runId = "fixture-campaign", output = join(root, "episodes", runId);
  const diagnostics = join(output, `${runId}.diagnostics`);
  await mkdir(diagnostics, { recursive: true });
  const manifest = { id: "fixture-suite", sourceBundle: { revision: "controller-revision" },
    budgets: { shutdownMs: 100 }, episodes: [{ id: runId }] };
  const summary = { id: manifest.id, running: true, episodes: [{ id: runId, status: "running", pid: 222 }] };
  await writeFile(join(root, "suite.json"), JSON.stringify(manifest));
  await writeFile(join(root, "summary.json"), JSON.stringify(summary));
  await writeFile(join(root, "supervisor.lock"), JSON.stringify({ pid: 111, startedAt: "2026-09-06T06:00:00Z" }));
  let signals = 0;
  const signalSupervisor = async ({ pid, suiteDirectory }) => {
    assert.equal(pid, 111); assert.equal(suiteDirectory, root);
    assert.equal(JSON.parse(await readFile(join(root, "control.json"))).mode, "drain");
    signals++;
  };
  const manager = await stopReports.createCampaignStopReports({ suiteDirectory: root, signalSupervisor, pollMs: 5, timeoutMs });
  const finalize = async ({ corrupt = false } = {}) => {
    const checkpoint = await writePlayerCheckpoint({ session: { saveState: async () => new Uint8Array([1, 2]),
      saveSram: async () => new Uint8Array([3, 4]) }, outputDirectory: output, runId,
      status: { running: false }, playerState: { teamSelection: { teamSeed: "preserved" } } });
    await writeFile(join(output, "episode.json"), JSON.stringify({ metadata: { runId, sourceRunId: "parent" },
      running: false, result: "stopped", checkpoint, badgeCount: 4, map: "MAP_ROUTE24", party: [{ species: 116, level: 15 }] }));
    await writeFile(join(diagnostics, "AI-HANDOFF.md"), "# Diagnostic handoff\nExact frozen evidence.\n");
    await writeFile(join(diagnostics, "LATEST.json"), JSON.stringify({ runId, closed: true,
      final: { result: "stopped", checkpoint: { metadataPath: checkpoint.metadataPath } } }));
    summary.running = false;
    summary.episodes[0].status = "failed"; summary.episodes[0].supervisorStop = "operator-stop";
    // Match the supervisor's atomic publication so its polling reader never
    // observes the fixture's temporary empty/truncated JSON file.
    await writeFile(join(root, "summary.json.tmp"), JSON.stringify(summary));
    await rename(join(root, "summary.json.tmp"), join(root, "summary.json"));
    await rm(join(root, "supervisor.lock"));
    if (corrupt) await writeFile(checkpoint.controlStateFilePath, "changed");
    return checkpoint;
  };
  return { root, manager, runId, summary, finalize, signals: () => signals };
}

async function settled(manager, requestId) {
  for (let i = 0; i < 200; i++) {
    const result = await manager.get(requestId);
    if (["ready", "error"].includes(result.state)) return result;
    await new Promise(resolve => setTimeout(resolve, 5));
  }
  throw new Error("operation did not settle");
}

test("stop report rejects stale runs and concurrent games before drain or signal", async t => {
  const f = await fixture(t);
  await assert.rejects(f.manager.start({ expectedRunId: "stale", requestId: randomUUID() }), /run.*match/i);
  assert.equal(f.signals(), 0);
  f.summary.episodes.push({ id: "another", status: "running" });
  await writeFile(join(f.root, "summary.json"), JSON.stringify(f.summary));
  await assert.rejects(f.manager.start({ expectedRunId: f.runId, requestId: randomUUID() }), /one active/i);
  assert.equal(f.signals(), 0);
  await assert.rejects(readFile(join(f.root, "control.json")), { code: "ENOENT" });
});

test("stop report drains then signals once and waits for verified final artifacts", async t => {
  const f = await fixture(t), requestId = randomUUID();
  const request = { expectedRunId: f.runId, requestId };
  const [first, duplicate] = await Promise.all([f.manager.start(request), f.manager.start(request)]);
  assert.equal(first.requestId, duplicate.requestId);
  assert.equal(f.signals(), 1);
  assert.notEqual((await f.manager.get(requestId)).state, "ready");
  const checkpoint = await f.finalize();
  const result = await settled(f.manager, requestId);
  assert.equal(result.state, "ready", result.error);
  assert.equal(result.report.checkpoint.controlStateSha256, checkpoint.controlStateSha256);
  assert.match(result.report.markdown, /operator-stop/);
  assert.match(result.report.markdown, /Exact frozen evidence/);
  assert.match(result.report.markdown, /preserved/);
  const restarted = await stopReports.createCampaignStopReports({ suiteDirectory: f.root,
    signalSupervisor: async () => { throw new Error("must not signal again"); } });
  assert.equal((await restarted.start(request)).state, "ready");
  await assert.rejects(restarted.start({ ...request, expectedRunId: "stale" }), /request.*run/i);
});

test("stop report refuses to call corrupted final checkpoint ready", async t => {
  const f = await fixture(t), requestId = randomUUID();
  await f.manager.start({ expectedRunId: f.runId, requestId });
  await f.finalize({ corrupt: true });
  const result = await settled(f.manager, requestId);
  assert.equal(result.state, "error");
  assert.match(result.error, /digest|hash/i);
  assert.equal(result.report, null);
});

test("a finalization retry rechecks late artifacts without signaling the run again", async t => {
  // The first phase must time out before the fixture finalizes; the retry phase
  // then needs enough budget to read the late artifacts on a loaded host.
  const f = await fixture(t, { timeoutMs: 250 }), requestId = randomUUID();
  await f.manager.start({ expectedRunId: f.runId, requestId });
  const timedOut = await settled(f.manager, requestId);
  assert.equal(timedOut.state, "error");
  assert.equal(timedOut.canRetry, true);
  await f.finalize();
  await f.manager.start({ expectedRunId: f.runId, requestId });
  assert.equal((await settled(f.manager, requestId)).state, "ready");
  assert.equal(f.signals(), 1);
});

test("supervisor signal verifies exact process command and current lock before graceful SIGTERM", async t => {
  const root = await realpath(await mkdtemp(join(tmpdir(), "master-red-signal-")));
  t.after(() => removeTempDirectory(root));
  const cli = join(root, "controller/src/cli/run-campaign-suite.js");
  await mkdir(join(root, "controller/src/cli"), { recursive: true });
  await writeFile(cli, 'process.on("SIGTERM",()=>process.exit(0)); process.stdout.write("ready\\n"); setInterval(()=>{},1000);\n');
  const nodeAlias = join(root, "node-alias");
  await symlink(process.execPath, nodeAlias);
  const child = spawn(nodeAlias, [cli, "run", root], { stdio: ["ignore", "pipe", "pipe"] });
  t.after(() => { if (child.exitCode === null) child.kill("SIGKILL"); });
  await once(child.stdout, "data");
  const lock = { pid: child.pid, startedAt: "2026-09-06T00:00:00Z" };
  await writeFile(join(root, "supervisor.lock"), JSON.stringify(lock));
  await assert.rejects(stopReports.signalCampaignSupervisor({ pid: process.pid, suiteDirectory: root, lock }), /does not match/);
  await assert.rejects(stopReports.signalCampaignSupervisor({ pid: child.pid, suiteDirectory: root,
    lock: { ...lock, startedAt: "changed" } }), /identity changed/);
  const exited = once(child, "close");
  await stopReports.signalCampaignSupervisor({ pid: child.pid, suiteDirectory: root, lock });
  assert.deepEqual(await exited, [0, null]);
});
