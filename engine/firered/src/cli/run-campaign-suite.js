#!/usr/bin/env node
import { resolve, join } from "node:path";
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { loadResearchBundle } from "../research.js";
import { prepareCampaignSuite, runCampaignSuite, setCampaignSuiteControl } from "../player/campaign-suite.js";

const usage = `Usage:
  node src/cli/run-campaign-suite.js create SUITE_PATH --rom PATH --core PATH [--concurrency 4] [--emulation-speed 5] [--seed 2026090400]
  node src/cli/run-campaign-suite.js run SUITE_PATH
  node src/cli/run-campaign-suite.js control SUITE_PATH --mode drain|run

  Add --video-port-base 17440 to create a suite with view-only live feeds.
  --emulation-speed selects a target from 1 through 10; actual speed depends on load.

Default: 20 independent cold starts (17 Brock episodes and 3 full campaigns).
Use --plan PLAN.json --host mini|desktop for an explicit portable host partition.
Use --checkpoints BINDINGS.json to bind replay checkpoint references to local paths.
--wall-ms N and --heartbeat-ms N set bounded test budgets, not gameplay policy.
--wall-ms none runs campaigns until the target or a real error/stall, with no
elapsed-time or decision cap. Heartbeat and shutdown watchdogs remain enabled.
Drain finishes active jobs and leaves the rest pending. Set mode run and invoke
the run command again to dispatch the remaining jobs; finished identities never restart.
Controller and research files are copied into a content-verified snapshot.
No manual-control port, AI calls, silent retries, or automatic qualification receipts.
Progress and failures are written to SUITE_PATH/summary.json.
`;

async function main(args) {
  if (args.includes("--help")) { process.stdout.write(usage); return; }
  const [mode, directory, ...rest] = args;
  if (!["create", "run", "control"].includes(mode) || !directory) throw new Error(usage);
  if (mode === "control") {
    if (rest.length !== 2 || rest[0] !== "--mode") throw new Error(usage);
    await setCampaignSuiteControl({ suiteDirectory: resolve(directory), mode: rest[1] });
    process.stdout.write(`${JSON.stringify({ event: "suite-control", mode: rest[1] })}\n`);
    return;
  }
  if (mode === "run") {
    if (rest.length) throw new Error("run takes only a suite path");
    const result = await runCampaignSuite({ suiteDirectory: resolve(directory) });
    process.stdout.write(`${JSON.stringify({ event: "suite-finished", id: result.id,
      passed: result.episodes.filter(x=>x.status==="passed").length,
      failed: result.episodes.filter(x=>x.status==="failed").length })}\n`);
    return;
  }
  const options = {};
  for (let index = 0; index < rest.length; index += 2) {
    const key = rest[index];
    if (!["--rom", "--core", "--concurrency", "--emulation-speed", "--seed", "--video-port-base",
      "--plan", "--host", "--checkpoints", "--wall-ms", "--heartbeat-ms"].includes(key) || !rest[index+1]) throw new Error(`invalid option ${key}`);
    options[key.slice(2)] = rest[index+1];
  }
  if (!options.rom || !options.core) throw new Error("--rom and --core are required");
  const projectRoot = fileURLToPath(new URL("../..", import.meta.url));
  const bundle = await loadResearchBundle(new URL("../../research/", import.meta.url));
  const inputs = { rom: resolve(options.rom), core: resolve(options.core) };
  for (const [name, id] of Object.entries({ runtime: "firered-runtime-symbols", world: "firered-world-structure",
    story: "firered-story-state", battle: "firered-battle-mechanics" })) {
    const dataset = bundle.knowledge.datasets.find(x=>x.id===id);
    inputs[name] = join(projectRoot,"private","knowledge",`${id}.${dataset.artifact.sha256}.json`);
  }
  const manifest = await prepareCampaignSuite({ projectRoot, suiteDirectory: resolve(directory), inputs,
    plan: options.plan ? JSON.parse(await readFile(resolve(options.plan), "utf8")) : null,
    hostId: options.host,
    checkpoints: options.checkpoints ? JSON.parse(await readFile(resolve(options.checkpoints), "utf8")) : {},
    budgets: { ...(options["wall-ms"] ? { wallMs: options["wall-ms"] === "none" ? null : Number(options["wall-ms"]) } : {}),
      ...(options["heartbeat-ms"] ? { heartbeatMs: Number(options["heartbeat-ms"]) } : {}) },
    concurrency: Number(options.concurrency ?? 4), seedBase: Number(options.seed ?? 2026090400),
    emulationSpeed: Number(options["emulation-speed"] ?? 5),
    videoPortBase: options["video-port-base"] === undefined ? null : Number(options["video-port-base"]) });
  process.stdout.write(`${JSON.stringify({ event: "suite-created", id: manifest.id,
    sourceRevision: manifest.sourceBundle.revision, episodes: manifest.episodes.length,
    concurrency: manifest.concurrency, emulationSpeed: manifest.emulationSpeed })}\n`);
}
main(process.argv.slice(2)).catch(error => { process.stderr.write(`${error.stack ?? error}\n`); process.exitCode=1; });
