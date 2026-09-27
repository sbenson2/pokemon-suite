import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { createHash } from "node:crypto";
import { mkdir, readFile, readdir, realpath, rename, writeFile } from "node:fs/promises";
import { basename, join, resolve, sep } from "node:path";
import { setCampaignSuiteControl } from "../player/campaign-suite.js";

const exec = promisify(execFile);
const hash = bytes => createHash("sha256").update(bytes).digest("hex");
const json = async path => JSON.parse(await readFile(path, "utf8"));
const uuid = /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i;
const safeRun = /^[a-zA-Z0-9._-]{1,160}$/;

// Only the supervisor already bound to this viewer's suite can receive SIGTERM.
// No PID, executable, suite path, or signal is accepted from an HTTP client.
export async function signalCampaignSupervisor({ pid, suiteDirectory, lock }) {
  if (!Number.isSafeInteger(pid) || pid <= 1) throw new Error("invalid supervisor PID");
  const expectedSuffix = ` ${join(suiteDirectory, "controller/src/cli/run-campaign-suite.js")} run ${suiteDirectory}`;
  const { stdout } = await exec("/bin/ps", ["-ww", "-p", String(pid), "-o", "command="], { timeout: 3000 });
  const command = stdout.trim();
  if (!command.endsWith(expectedSuffix)) throw new Error("supervisor process does not match bound suite");
  const executable = command.slice(0, -expectedSuffix.length);
  if (await realpath(executable) !== await realpath(process.execPath)) throw new Error("supervisor executable does not match viewer runtime");
  const current = await json(join(suiteDirectory, "supervisor.lock"));
  if (current.pid !== lock.pid || current.startedAt !== lock.startedAt) throw new Error("supervisor identity changed");
  process.kill(pid, "SIGTERM");
}

export async function createCampaignStopReports({ suiteDirectory, signalSupervisor = signalCampaignSupervisor,
  pollMs = 500, timeoutMs = null } = {}) {
  const root = await realpath(resolve(suiteDirectory));
  const manifest = await json(join(root, "suite.json"));
  const directory = join(root, "operator-reports");
  const watching = new Set();
  let queue = Promise.resolve();
  const pathFor = requestId => {
    if (!uuid.test(requestId ?? "")) throw new Error("invalid request ID");
    return join(directory, `${requestId}.json`);
  };
  const publish = async operation => {
    await mkdir(directory, { recursive: true, mode: 0o700 });
    const path = pathFor(operation.requestId);
    await writeFile(`${path}.tmp`, `${JSON.stringify(operation, null, 2)}\n`, { mode: 0o600 });
    await rename(`${path}.tmp`, path);
  };
  async function readFinal(operation) {
    const summary = await json(join(root, "summary.json"));
    const selected = summary.episodes.find(episode => episode.id === operation.runId);
    if (!selected || summary.running || selected.status === "running") return null;
    try { await readFile(join(root, "supervisor.lock")); return null; }
    catch (error) { if (error.code !== "ENOENT") throw error; }
    const output = join(root, "episodes", operation.runId);
    const episode = await json(join(output, "episode.json"));
    if (episode.running !== false || episode.metadata?.runId !== operation.runId) return null;
    const diagnostics = join(output, `${operation.runId}.diagnostics`);
    const latest = await json(join(diagnostics, "LATEST.json"));
    if (latest.closed !== true || latest.runId !== operation.runId || !latest.final?.checkpoint) return null;
    const metadataPath = await realpath(latest.final.checkpoint.metadataPath);
    if (!metadataPath.startsWith(`${output}${sep}`)) throw new Error("checkpoint metadata outside episode");
    const checkpoint = await json(metadataPath);
    if (checkpoint.runId !== operation.runId || checkpoint.stateSha256 !== episode.checkpoint?.stateSha256 ||
      checkpoint.sramSha256 !== episode.checkpoint?.sramSha256 ||
      checkpoint.controlStateSha256 !== episode.checkpoint?.controlStateSha256) throw new Error("final checkpoint identity mismatch");
    const verified = { metadataPath };
    for (const key of ["state", "sram", "controlState"]) {
      const name = checkpoint[`${key}Path`];
      if (typeof name !== "string" || basename(name) !== name) throw new Error("invalid checkpoint artifact path");
      const path = await realpath(join(output, name));
      if (!path.startsWith(`${output}${sep}`)) throw new Error("checkpoint artifact outside episode");
      const bytes = await readFile(path);
      if (hash(bytes) !== checkpoint[`${key}Sha256`]) throw new Error(`${key} checkpoint digest mismatch`);
      verified[`${key}Path`] = path;
      verified[`${key}Sha256`] = hash(bytes);
    }
    const control = await json(verified.controlStatePath);
    if (control.runId !== operation.runId || control.stateSha256 !== verified.stateSha256 ||
      control.sramSha256 !== verified.sramSha256 || !control.playerState) throw new Error("control checkpoint identity mismatch");
    const handoffPath = join(diagnostics, "AI-HANDOFF.md");
    const handoff = (await readFile(handoffPath, "utf8")).slice(0, 48000);
    const reason = selected.supervisorStop ?? episode.failure?.reason ?? episode.stopReason ?? episode.result;
    const evidence = { suiteDirectory: root, runId: operation.runId, sourceRunId: episode.metadata?.sourceRunId ?? null,
      controllerRevision: manifest.sourceBundle?.revision, stopReason: reason, result: episode.result,
      targetReached: episode.targetReached === true, map: episode.map, badgeCount: episode.badgeCount,
      party: episode.party, checkpoint: verified, handoffPath,
      teamSelection: episode.metadata?.teamSelection ?? control.playerState.teamSelection ?? null };
    return { ...evidence, markdown: `# Master Red test report\n\nThe campaign is stopped and its final emulator, SRAM, and controller checkpoints are verified.\n\n` +
      `Stop reason: ${reason}. Preserve this run's evidence; any later controller revision requires a linked continuation.\n\n` +
      `\`\`\`json\n${JSON.stringify(evidence, null, 2)}\n\`\`\`\n\n${handoff}\n` };
  }
  function watch(operation) {
    if (watching.has(operation.requestId) || ["ready", "error"].includes(operation.state)) return;
    watching.add(operation.requestId);
    void (async () => {
      try {
        const deadline = Date.parse(operation.waitStartedAt ?? operation.startedAt) + (timeoutMs ?? (manifest.budgets?.shutdownMs ?? 30000) + 15000);
        while (Date.now() < deadline) {
          const report = await readFinal(operation);
          if (report) {
            await publish({ ...operation, state: "ready", report, error: null, canRetry: false, completedAt: new Date().toISOString() });
            return;
          }
          await new Promise(resolveWait => setTimeout(resolveWait, pollMs));
        }
        throw new Error("timed out waiting for finalized checkpoint and diagnostics; inspect preserved suite evidence");
      } catch (error) {
        await publish({ ...operation, state: "error", report: null, error: error.message,
          canRetry: Boolean(operation.signalSentAt || operation.alreadyStopped), completedAt: new Date().toISOString() });
      } finally { watching.delete(operation.requestId); }
    })();
  }
  async function reuse(operation) {
    if (operation.state === "error" && operation.canRetry) {
      operation = { ...operation, state: "saving", error: null, report: null, canRetry: false,
        waitStartedAt: new Date().toISOString() };
      await publish(operation);
    }
    watch(operation);
    return operation;
  }
  async function start({ expectedRunId, requestId } = {}) {
    const path = pathFor(requestId);
    if (!safeRun.test(expectedRunId ?? "")) throw new Error("invalid expected run ID");
    let existing;
    try { existing = await json(path); } catch (error) { if (error.code !== "ENOENT") throw error; }
    if (existing) {
      if (existing.runId !== expectedRunId) throw new Error("request ID belongs to a different run");
      return reuse(existing);
    }
    const summary = await json(join(root, "summary.json"));
    if (!manifest.episodes.some(episode => episode.id === expectedRunId) ||
      !summary.episodes.some(episode => episode.id === expectedRunId)) throw new Error("expected run does not match bound suite");
    const active = summary.episodes.filter(episode => episode.status === "running");
    if (active.length > 1 || (active.length === 1 && active[0].id !== expectedRunId)) throw new Error("stop report requires only one active matching run");
    let files = [];
    try { files = await readdir(directory); } catch (error) { if (error.code !== "ENOENT") throw error; }
    for (const name of files.filter(name => name.endsWith(".json"))) {
      const prior = await json(join(directory, name));
      if (prior.runId === expectedRunId) {
        // A new UI request also reuses the existing stop; it never signals twice.
        return reuse(prior);
      }
    }
    const operation = { requestId, runId: expectedRunId, state: "stopping", report: null, error: null, canRetry: false,
      startedAt: new Date().toISOString() };
    await publish(operation);
    try {
      const lock = active.length ? await json(join(root, "supervisor.lock")) : null;
      await setCampaignSuiteControl({ suiteDirectory: root, mode: "drain" });
      if (lock) {
        await signalSupervisor({ pid: lock.pid, suiteDirectory: root, lock });
        operation.signalSentAt = new Date().toISOString();
      } else operation.alreadyStopped = true;
      operation.state = "saving";
      await publish(operation);
      watch(operation);
    } catch (error) {
      operation.state = "error"; operation.error = error.message;
      await publish(operation);
    }
    return operation;
  }
  return {
    start(request) {
      const next = queue.then(() => start(request));
      queue = next.catch(() => {});
      return next;
    },
    async get(requestId) { const operation = await json(pathFor(requestId)); watch(operation); return operation; },
  };
}
