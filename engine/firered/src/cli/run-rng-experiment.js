#!/usr/bin/env node
import { createHash } from "node:crypto";
import { mkdir, mkdtemp, readFile, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { createPinnedMgbaSession } from "../emulator/pinned-mgba.js";
import { createFireRedObserver } from "../evidence/fire-red-observer.js";
import { verifyKnowledgeArtifact } from "../evidence/knowledge-artifact.js";
import { digestSourceBundle } from "../extractor/artifact.js";
import { loadResearchBundle } from "../research.js";
import { landSlotsFromKnowledge } from "../rng/prediction-monitor.js";
import { runReplayExperiment, validateReplayConfig } from "../rng/replay-experiment.js";

const root = fileURLToPath(new URL("../..", import.meta.url));
const hash = (bytes) => createHash("sha256").update(bytes).digest("hex");
const usage = `Usage: node src/cli/run-rng-experiment.js --rom PATH --core PATH --state PATH --sram PATH --config PATH [--execute] [--output PATH]

Default: inspect the exact cartridge and checkpoint without advancing any frames.
--execute runs the bounded walking/replay plan in separate in-memory sessions.
The JSON mode is replay (one repeated plan) or guided (bounded wait candidates).
No battle commands, seed writes, new saves, or unattended capture are permitted.
This process owns frame stepping exclusively; ordinary campaign clocks are untouched.
Evidence goes to a new private directory, never a campaign qualification record.
Original state/SRAM inputs are read-only. Ctrl-C cancels at the next bounded yield.
See docs/SHINY-HUNTING.md for configuration and the production RNG gate.
`;

function parse(args) {
  const options = {};
  for (let index = 0; index < args.length; index++) {
    const key = args[index];
    if (key === "--help") return { help: true };
    if (key === "--execute") { options.execute = true; continue; }
    if (!["--rom", "--core", "--state", "--sram", "--config", "--output"].includes(key) || !args[index + 1] || args[index + 1].startsWith("--")) throw new Error(`invalid argument ${key}`);
    options[key.slice(2)] = resolve(args[++index]);
  }
  if (!options.state || !options.sram) throw new Error("explicit --state and --sram are required; experiments cannot create a new save");
  if (!options.rom || !options.core || !options.config) throw new Error("--rom, --core and --config are required");
  return options;
}

async function main() {
  const options = parse(process.argv.slice(2));
  if (options.help) { process.stdout.write(usage); return; }
  const config = validateReplayConfig(JSON.parse(await readFile(options.config, "utf8")));
  const bundle = await loadResearchBundle(new URL("../../research/", import.meta.url));
  const names = ["firered-runtime-symbols", "firered-world-structure", "firered-story-state", "firered-battle-mechanics"];
  const artifacts = await Promise.all(names.map(async (datasetId) => {
    const dataset = bundle.knowledge.datasets.find((entry) => entry.id === datasetId);
    const path = join(root, "private", "knowledge", `${datasetId}.${dataset?.artifact?.sha256}.json`);
    const bytes = await readFile(path);
    verifyKnowledgeArtifact({ bundle, datasetId, bytes });
    return { datasetId, sha256: hash(bytes), data: JSON.parse(bytes) };
  }));
  const [runtime, world, story, mechanics] = artifacts.map((artifact) => artifact.data);
  const [romBytes, stateBytes, sramBytes] = await Promise.all([options.rom, options.state, options.sram].map((path) => readFile(path)));
  const original = { state: { path: options.state, sha256: hash(stateBytes) }, sram: { path: options.sram, sha256: hash(sramBytes) } };
  const mgba = bundle.sources.sources.find((entry) => entry.id === "mgba-core");
  const wrapper = bundle.sources.sources.find((entry) => entry.id === "mgba-wasm-wrapper");
  const expected = { mgbaCommit: mgba.revision.value, wrapperCommit: wrapper.revision.value, mgbaWasmSha256: mgba.artifact.wasmSha256 };
  const cartridge = bundle.cartridges.profiles.find((entry) => entry.id === bundle.cartridges.qualificationProfileId);
  let identity = null;
  const openTrial = async ({ lineage = "inspection" } = {}) => {
    const session = await createPinnedMgbaSession({ coreDirectory: options.core, expected, romBytes, cartridge });
    try {
      session.loadSram(sramBytes); session.loadState(stateBytes);
      const observer = createFireRedObserver({ session, runtime, world, story, observeRng: true, runId: `rng-experiment-${lineage}` });
      identity = session.identity;
      // Establish the observer history without advancing the cartridge.
      observer.capture();
      return { session, observer, close: () => session.close() };
    } catch (error) { session.close(); throw error; }
  };
  if (!options.execute) {
    const trial = await openTrial();
    try {
      const observation = trial.observer.capture();
      process.stdout.write(`${JSON.stringify({ mode: "inspection", framesAdvanced: 0, identity, original, config,
        frame: observation.frame, phase: observation.phase, map: observation.playerMemory.map,
        inBattle: observation.emulator.inBattle, rng: observation.playerMemory.rng, encounter: observation.playerMemory.encounter })}\n`);
    } finally { trial.close(); }
    return;
  }
  const control = new AbortController();
  const abort = () => control.abort();
  process.once("SIGINT", abort); process.once("SIGTERM", abort);
  try {
    const report = await runReplayExperiment({ config, openTrial, signal: control.signal,
      slots: landSlotsFromKnowledge(world, mechanics, config.map),
      onTrial: (trial) => process.stdout.write(`${JSON.stringify({ event: "rng-trial", lineage: trial.lineage,
        status: trial.status, startFrame: trial.startFrame, endFrame: trial.endFrame, pokemon: trial.pokemon,
        predictionStatus: trial.prediction?.status ?? null })}\n`) });
    const sourceBundle = await digestSourceBundle(root, ["src/cli/run-rng-experiment.js"], { followLocalImports: true });
    const [stateAfter, sramAfter] = await Promise.all([options.state, options.sram].map((path) => readFile(path)));
    const originalInputsUnchanged = hash(stateAfter) === original.state.sha256 && hash(sramAfter) === original.sram.sha256;
    const base = options.output ?? join(root, "private", "evidence", "rng");
    await mkdir(base, { recursive: true, mode: 0o700 });
    const output = await mkdtemp(join(base, "experiment-"));
    const write = (name, bytes) => writeFile(join(output, name), bytes, { flag: "wx", mode: 0o600 });
    const preserved = report.preserved;
    if (preserved) await Promise.all([
      write("emulator.state", preserved.state), write("cartridge.sav", preserved.sram), write("frame.rgba", preserved.video.rgba),
      write("frame.json", JSON.stringify({ width: preserved.video.width, height: preserved.video.height, pixelFormat: "rgba8888" })),
      write("observation.json", JSON.stringify(preserved.observation)),
    ]);
    await write("report.json", JSON.stringify({ ...report,
      preserved: preserved ? { frame: preserved.frame, statePath: "emulator.state", stateSha256: preserved.stateSha256,
        sramPath: "cartridge.sav", sramSha256: preserved.sramSha256, observationPath: "observation.json", framebufferPath: "frame.rgba" } : null,
      identity, original, originalInputsUnchanged, sourceBundle,
      artifacts: artifacts.map(({ datasetId, sha256 }) => ({ datasetId, sha256 })), collectedAt: new Date().toISOString() }, null, 2));
    process.stdout.write(`${JSON.stringify({ event: "rng-experiment-finished", output, status: report.status,
      originalInputsUnchanged, encounterEvents: report.encounterEvents, uniqueOutcomes: report.uniqueOutcomes,
      reproducible: report.groups.map((group) => group.reproducible), selected: report.selected, productionQualified: false })}\n`);
    if (!originalInputsUnchanged || ["unknown", "mismatch"].includes(report.status)) process.exitCode = 2;
  } finally {
    process.removeListener("SIGINT", abort); process.removeListener("SIGTERM", abort);
  }
}

try { await main(); }
catch (error) { process.stderr.write(`${error.stack ?? error.message}\n`); process.exitCode = 1; }
