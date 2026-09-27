import { spawn } from "node:child_process";
import { copyFile, cp, mkdir, open, readFile, readdir, rename, unlink, writeFile } from "node:fs/promises";
import { createHash } from "node:crypto";
import { basename, dirname, join, resolve } from "node:path";
import { digestSourceBundle } from "../extractor/artifact.js";
import { partitionTestPlan } from "../testing/fleet-plan.js";
import { gameTestAdapter } from "../testing/game-adapters.js";

const hash = bytes => createHash("sha256").update(bytes).digest("hex");

async function snapshotCheckpoint(directory, reference, paths) {
  const target = join(directory, "checkpoints", reference);
  await mkdir(target, { recursive: true, mode: 0o700 });
  const result = {};
  for (const [key, source, name] of [["state", paths.state, "emulator.state"], ["sram", paths.sram, "cartridge.sav"],
    ["controlState", paths.controlState ?? `${paths.state}.player.json`, "emulator.state.player.json"]]) {
    try { await copyFile(source, join(target, name)); }
    catch (error) { if (key === "controlState" && !paths.controlState && error.code === "ENOENT") continue; throw error; }
    result[key] = { path: `checkpoints/${reference}/${name}`, sha256: hash(await readFile(join(target, name))) };
  }
  return result;
}

async function readControl(directory) {
  try {
    const value = JSON.parse(await readFile(join(directory, "control.json"), "utf8"));
    if (!["run", "drain"].includes(value.mode)) throw new Error("invalid queue control mode");
    return { mode: value.mode };
  } catch (error) {
    return error.code === "ENOENT" ? { mode: "run" } : { mode: "drain", error: error.message };
  }
}

export async function setCampaignSuiteControl({ suiteDirectory, mode }) {
  if (!["run", "drain"].includes(mode)) throw new TypeError("invalid queue control mode");
  await readFile(join(suiteDirectory, "suite.json"));
  await publish(join(suiteDirectory, "control.json"), { mode, updatedAt: new Date().toISOString() });
}

async function publish(path, value) {
  await writeFile(`${path}.tmp`, `${JSON.stringify(value, null, 2)}\n`, { mode: 0o600 });
  await rename(`${path}.tmp`, path);
}

function validateEmulationSpeed(speed) {
  if (!Number.isFinite(speed) || speed < 1 || speed > 10) {
    throw new TypeError("emulation speed must be a number from 1 through 10");
  }
}

async function sourcePaths(root, prefix = "") {
  const paths = [];
  for (const entry of await readdir(join(root, prefix), { withFileTypes: true })) {
    const path = prefix ? `${prefix}/${entry.name}` : entry.name;
    if (entry.isDirectory()) paths.push(...await sourcePaths(root, path));
    else if (entry.isFile()) paths.push(path);
    else throw new Error(`controller snapshot cannot contain links: ${path}`);
  }
  return paths;
}

export async function prepareCampaignSuite({ projectRoot, suiteDirectory,
  inputs = {}, seedBase = 2026090400, concurrency = 4, emulationSpeed = 5, budgets = {}, videoPortBase = null,
  videoFramesPerSecond = 30, plan = null, hostId = null, checkpoints = {} } = {}) {
  const partition = plan ? partitionTestPlan(plan, hostId) : null;
  if (partition) ({ concurrency, emulationSpeed, videoPortBase, videoFramesPerSecond } = partition.settings);
  const episodeCount = partition?.jobs.length ?? 20;
  validateEmulationSpeed(emulationSpeed);
  if (videoPortBase !== null && (!Number.isInteger(videoPortBase) || videoPortBase < 1024 || videoPortBase + episodeCount > 65536)) {
    throw new TypeError("invalid video port range");
  }
  if (!Number.isFinite(videoFramesPerSecond) || videoFramesPerSecond < 1 || videoFramesPerSecond > 60) throw new TypeError("invalid video frame rate");
  for (const job of partition?.jobs ?? []) if (job.checkpoint && (!checkpoints[job.checkpoint]?.state || !checkpoints[job.checkpoint]?.sram)) {
    throw new TypeError(`missing checkpoint binding: ${job.checkpoint}`);
  }
  budgets = { wallMs: 24 * 3600_000, heartbeatMs: 120_000, shutdownMs: 30_000, ...budgets };
  if (Object.entries(budgets).some(([key, value]) => !(key === "wallMs" && value === null) &&
      (!Number.isSafeInteger(value) || value <= 0))) throw new TypeError("invalid suite budgets");
  if (!Number.isInteger(concurrency) || concurrency < 1 || concurrency > 16) throw new TypeError("invalid concurrency");
  if (!Number.isInteger(seedBase) || seedBase < 0 || seedBase > 0xffff_ffff - 19) throw new TypeError("invalid seed base");
  const directory = resolve(suiteDirectory);
  const id = basename(directory);
  if (!/^[a-zA-Z0-9_-]{1,100}$/.test(id)) throw new TypeError("invalid suite directory name");
  await mkdir(dirname(directory), { recursive: true, mode: 0o700 });
  await mkdir(directory, { mode: 0o700 });
  const controller = join(directory, "controller");
  await mkdir(controller);
  for (const path of ["src", "research", "package.json"]) {
    await cp(join(projectRoot, path), join(controller, path), { recursive: true, errorOnExist: true, force: false });
  }
  const sourceBundle = await digestSourceBundle(controller, await sourcePaths(controller));
  const offsets = [0, 1, 3, ...Array.from({ length: 15 }, (_, index) => index + 5), 2, 4];
  const jobs = partition?.jobs ?? offsets.map(offset => ({ seed: seedBase + offset,
    target: [0, 2, 4].includes(offset) ? "hall-of-fame" : "brock", game: "firered-rev1-stock", kind: "campaign" }));
  const frozenCheckpoints = {};
  for (const job of jobs) if (job.checkpoint && !frozenCheckpoints[job.checkpoint]) {
    frozenCheckpoints[job.checkpoint] = await snapshotCheckpoint(directory, job.checkpoint, checkpoints[job.checkpoint]);
  }
  if (jobs.some(job => job.kind === "experiment")) {
    await mkdir(join(directory, "experiments"));
    for (const job of jobs.filter(job => job.kind === "experiment")) await publish(join(directory, "experiments", `${job.id}.json`), job.experiment);
  }
  const manifest = { schema: "master-red/campaign-suite/v1", id, createdAt: new Date().toISOString(),
    sourceBundle, concurrency, emulationSpeed, inputs, nodeVersion: process.version, videoPortBase, videoFramesPerSecond,
    ...(partition ? { plan: { id: partition.id, revision: partition.revision, hostId } } : {}),
    budgets,
    episodes: jobs.map((job, index) => ({ ...job, id: `${id}-${job.id ?? String(index + 1).padStart(2, "0")}`,
      ...(job.id ? { jobId: job.id } : {}),
      evidenceKind: job.kind === "experiment" ? "training-experiment" : job.kind === "replay" ? "checkpoint-diagnostic" : job.kind === "continuation" ? "continued-campaign" : "cold-campaign",
      ...(job.checkpoint ? { checkpoint: frozenCheckpoints[job.checkpoint] } : {}),
      ...(videoPortBase === null ? {} : { livePort: videoPortBase + index }) })) };
  await mkdir(join(directory, "episodes"));
  if (plan) await publish(join(directory, "plan.json"), plan);
  await publish(join(directory, "suite.json"), manifest);
  return manifest;
}

export async function runCampaignSuite({ suiteDirectory, pollMs = 1000 } = {}) {
  const directory = resolve(suiteDirectory);
  const manifest = JSON.parse(await readFile(join(directory, "suite.json"), "utf8"));
  const emulationSpeed = manifest.emulationSpeed === undefined ? 5 : manifest.emulationSpeed;
  validateEmulationSpeed(emulationSpeed);
  const controller = join(directory, "controller");
  const checkController = async () => {
    const actual = await digestSourceBundle(controller, await sourcePaths(controller));
    if (actual.revision !== manifest.sourceBundle.revision) throw new Error("frozen controller has changed");
    if (manifest.plan) {
      const partition = partitionTestPlan(JSON.parse(await readFile(join(directory, "plan.json"), "utf8")), manifest.plan.hostId);
      if (partition.revision !== manifest.plan.revision) throw new Error("frozen test plan has changed");
      const settingsMatch = Object.entries(partition.settings).every(([key, value]) => manifest[key] === value);
      const jobsMatch = partition.jobs.length === manifest.episodes.length && partition.jobs.every((job, index) => {
        const episode = manifest.episodes[index];
        return episode.id === `${manifest.id}-${job.id}` && episode.jobId === job.id &&
          ["game", "kind", "target", "seed", "host", "maxDecisions", "sourceRunId", "rosterMode", "teamSeed"].every(key => episode[key] === job[key]) &&
          JSON.stringify(episode.experiment) === JSON.stringify(job.experiment) &&
          episode.livePort === partition.settings.videoPortBase + index &&
          (job.checkpoint ? episode.checkpoint?.state?.path === `checkpoints/${job.checkpoint}/emulator.state` : !episode.checkpoint);
      });
      if (!settingsMatch || !jobsMatch) throw new Error("frozen host partition has changed");
    }
    for (const episode of manifest.episodes) {
      if (episode.kind === "experiment" && JSON.stringify(JSON.parse(await readFile(join(directory, "experiments", `${episode.jobId}.json`), "utf8"))) !== JSON.stringify(episode.experiment)) {
        throw new Error("frozen experiment configuration has changed");
      }
      for (const input of Object.values(episode.checkpoint ?? {})) {
        if (!/^checkpoints\/[a-zA-Z0-9_-]+\/[a-zA-Z0-9.]+$/.test(input.path) ||
          hash(await readFile(join(directory, input.path))) !== input.sha256) throw new Error("frozen checkpoint has changed");
      }
    }
  };
  await checkController();
  const lockPath = join(directory, "supervisor.lock");
  const lock = await open(lockPath, "wx", 0o600);
  await lock.writeFile(JSON.stringify({ pid: process.pid, startedAt: new Date().toISOString() }));
  const summaryPath = join(directory, "summary.json");
  let summary;
  let stopping = false;
  const active = new Map();
  const stop = () => { stopping = true; };
  process.on("SIGINT", stop);
  process.on("SIGTERM", stop);
  try {
    try { summary = JSON.parse(await readFile(summaryPath, "utf8")); }
    catch (error) { if (error.code !== "ENOENT") throw error; }
    summary ??= { schema: "master-red/campaign-suite-summary/v1", id: manifest.id, plan: manifest.plan ?? null,
      concurrency: manifest.concurrency, emulationSpeed, videoFramesPerSecond: manifest.videoFramesPerSecond ?? 30,
      sourceRevision: manifest.sourceBundle.revision, reviewRequired: true,
      episodes: manifest.episodes.map(episode => ({ ...episode, status: "pending" })) };
    for (const episode of summary.episodes) if (episode.status === "running") {
      episode.status = "interrupted"; // Do not retry a cold start under the same identity.
    }
    const launch = async (episode) => {
      await checkController();
      const output = join(directory, "episodes", episode.id);
      const adapter = gameTestAdapter(episode.game ?? "firered-rev1-stock");
      const untilTarget = manifest.budgets.wallMs === null && episode.kind !== "replay";
      if (untilTarget && episode.maxDecisions !== undefined) throw new Error("until-target conflicts with a decision budget");
      const args = [join(controller, adapter.player),
        ...(episode.livePort ? ["--view-only", "--live-port", String(episode.livePort)] : ["--no-live"]),
        ...(episode.kind === "experiment" ? ["--experiment", join(directory, "experiments", `${episode.jobId}.json`)]
          : [episode.kind === "replay" ? "--scenario-target" : episode.kind === "continuation" ? "--continuation-target" : "--qualification-target", episode.target]),
        "--run-id", episode.id,
        "--seed", String(episode.seed), "--output", output,
        ...(untilTarget ? ["--until-target"] : ["--max-decisions", String(episode.maxDecisions ?? 5000000)]),
        "--video-fps", String(manifest.videoFramesPerSecond ?? 30),
        "--emulation-speed", String(emulationSpeed), "--pace-ms", "2"];
      if (episode.checkpoint) args.push("--state", join(directory, episode.checkpoint.state.path),
        "--sram", join(directory, episode.checkpoint.sram.path));
      if (episode.sourceRunId) args.push("--source-run-id", episode.sourceRunId);
      if (episode.rosterMode !== undefined) args.push("--roster-mode", episode.rosterMode);
      if (episode.teamSeed !== undefined) args.push("--team-seed", String(episode.teamSeed));
      for (const key of ["rom", "core", "runtime", "world", "story", "battle"]) {
        if (manifest.inputs[key]) args.push(`--${key}`, manifest.inputs[key]);
      }
      episode.status = "running";
      episode.startedAt = new Date().toISOString();
      await publish(summaryPath, { ...summary, running: true });
      const child = spawn(process.execPath, args, { cwd: controller, stdio: ["ignore", "ignore", "pipe"] });
      const state = { child, episode, output, startedAt: Date.now(), stderr: "", exit: null, stopAt: null };
      state.done = new Promise(resolveDone => {
        child.once("error", error => { state.stderr = error.message; });
        child.once("close", (code, signal) => { state.exit = { code, signal }; resolveDone(); });
      });
      child.stderr.on("data", chunk => { state.stderr = (state.stderr + chunk.toString()).slice(-8192); });
      episode.pid = child.pid ?? null;
      active.set(episode.id, state);
    };
    do {
      summary.control = await readControl(directory);
      for (const state of active.values()) {
        const { episode } = state;
        try {
          episode.progress = JSON.parse(await readFile(join(state.output, "episode.json"), "utf8"));
          delete episode.reportError;
        } catch (error) {
          if (error.code !== "ENOENT" && !(error instanceof SyntaxError)) throw error;
          if (error instanceof SyntaxError) episode.reportError = error.message;
        }
        if (state.exit) {
          await checkController();
          episode.status = state.exit.code === 0 && episode.progress?.targetReached &&
            !episode.reportError && !episode.supervisorStop ? "passed" : "failed";
          episode.exit = state.exit;
          episode.stderrTail = state.stderr;
          episode.endedAt = new Date().toISOString();
          active.delete(episode.id);
          continue;
        }
        const now = Date.now();
        const heartbeat = Date.parse(episode.progress?.updatedAt ?? episode.startedAt);
        const reason = stopping ? "operator-stop" : manifest.budgets.wallMs !== null && now - state.startedAt > manifest.budgets.wallMs
          ? "wall-time-limit" : now - heartbeat > manifest.budgets.heartbeatMs ? "heartbeat-timeout" : null;
        if (reason && state.stopAt === null) {
          episode.supervisorStop = reason;
          state.stopAt = now;
          state.child.kill("SIGTERM");
        } else if (state.stopAt !== null && now - state.stopAt > manifest.budgets.shutdownMs) {
          state.child.kill("SIGKILL");
        }
      }
      if (!stopping && summary.control.mode === "run") {
        for (const episode of summary.episodes) {
          if (active.size >= manifest.concurrency) break;
          if (episode.status === "pending") await launch(episode);
        }
      }
      summary.running = active.size > 0;
      summary.counts = summary.episodes.reduce((counts, episode) => {
        counts[episode.status] = (counts[episode.status] ?? 0) + 1;
        return counts;
      }, {});
      summary.issues = summary.episodes
        .filter(episode => episode.status === "failed" && episode.supervisorStop !== "operator-stop")
        .map(episode => ({ runId: episode.id, sourceRunId: episode.sourceRunId ?? null, needsReview: true,
          reason: episode.supervisorStop ?? episode.progress?.failure?.reason ?? episode.progress?.stopReason ?? "process-failure",
          failure: episode.progress?.failure ?? null, exit: episode.exit, stderrTail: episode.stderrTail,
          checkpoint: episode.progress?.checkpoint ?? null,
          diagnosticsDirectory: join(directory, "episodes", episode.id, `${episode.id}.diagnostics`) }));
      summary.updatedAt = new Date().toISOString();
      await publish(summaryPath, summary);
      if (active.size) await new Promise(r => setTimeout(r, pollMs));
    } while (active.size);
    return summary;
  } finally {
    for (const state of active.values()) state.child.kill("SIGTERM");
    const killTimer = setTimeout(() => {
      for (const state of active.values()) state.child.kill("SIGKILL");
    }, manifest.budgets.shutdownMs);
    await Promise.all([...active.values()].map(state => state.done));
    clearTimeout(killTimer);
    process.off("SIGINT", stop);
    process.off("SIGTERM", stop);
    await lock.close();
    await unlink(lockPath);
  }
}
