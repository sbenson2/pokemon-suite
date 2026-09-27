#!/usr/bin/env node

import { createHash, randomUUID } from "node:crypto";
import { readFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { createPinnedMgbaSession } from "../emulator/pinned-mgba.js";
import {
  computeHarnessRevision,
  writePrivateRunArtifact,
} from "../evidence/artifact.js";
import { createFireRedObserver } from "../evidence/fire-red-observer.js";
import { verifyKnowledgeArtifact } from "../evidence/knowledge-artifact.js";
import {
  createRealMgbaScenarioDiagnostic,
  runScenarioTrials,
} from "../evidence/qualification.js";
import { selectDevelopmentScenario } from "../evidence/scenario.js";
import { captureCanonicalSnapshot } from "../evidence/snapshot.js";
import { loadResearchBundle } from "../research.js";

const projectRoot = fileURLToPath(new URL("../..", import.meta.url));

const usage = `Usage:
  npm run qualify:scenario -- --scenario ID --suite PATH --rom PATH --core PATH [options]

Required private inputs:
  --scenario ID      One transition id declared in research/transitions.json
  --suite PATH       Partial or complete private real-mGBA scenario suite
  --rom PATH         Exact stock FireRed Rev 1 cartridge
  --core PATH        Pinned real mGBA directory

Options:
  --trials N         Development trials (default: 1)
  --runtime PATH     Runtime-symbol artifact (default: private knowledge artifact)
  --world PATH       World artifact (default: private knowledge artifact)
  --output PATH      Private diagnostic directory
                     (default: private/evidence/scenario-development)
  --warmup-frames N  Neutral boot frames before loading the seed (default: 1)
  --collected-at ISO Fixed diagnostic time (default: current time)
  --help              Show this help

This is a single-scenario development runner. It writes a private diagnostic
trace only; its output cannot satisfy or be recorded as a public gate.
`;

class UsageError extends Error {}

function parsePositiveInteger(name, value) {
  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed) || parsed <= 0) {
    throw new UsageError(`${name} must be a positive integer`);
  }
  return parsed;
}

function parseNonNegativeInteger(name, value) {
  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed) || parsed < 0) {
    throw new UsageError(`${name} must be a non-negative integer`);
  }
  return parsed;
}

function parseArguments(args) {
  const parsed = {};
  const valueOptions = new Set([
    "--scenario",
    "--suite",
    "--rom",
    "--core",
    "--trials",
    "--runtime",
    "--world",
    "--output",
    "--warmup-frames",
    "--collected-at",
  ]);
  for (let index = 0; index < args.length; index += 1) {
    const argument = args[index];
    if (argument === "--help") return { help: true };
    if (!valueOptions.has(argument)) throw new UsageError(`unknown argument ${argument}`);
    const value = args[index + 1];
    if (!value || value.startsWith("--")) {
      throw new UsageError(`${argument} requires a value`);
    }
    parsed[argument.slice(2).replaceAll("-", "_")] = value;
    index += 1;
  }
  if (!parsed.scenario) throw new UsageError("--scenario is required");
  if (!parsed.suite) throw new UsageError("--suite is required");
  if (!parsed.rom) throw new UsageError("--rom is required");
  if (!parsed.core) throw new UsageError("--core is required");
  parsed.trials = parsePositiveInteger("--trials", parsed.trials ?? "1");
  parsed.warmup_frames = parseNonNegativeInteger(
    "--warmup-frames",
    parsed.warmup_frames ?? "1",
  );
  return parsed;
}

function artifactPath(bundle, datasetId) {
  const dataset = bundle.knowledge.datasets.find(({ id }) => id === datasetId);
  if (!dataset?.runtimeEligible || !dataset.artifact?.sha256) {
    throw new Error(`${datasetId} is not a runtime-eligible knowledge artifact`);
  }
  return join(
    projectRoot,
    "private",
    "knowledge",
    `${dataset.id}.${dataset.artifact.sha256}.json`,
  );
}

function sha256(bytes) {
  return createHash("sha256").update(bytes).digest("hex");
}

async function loadScenarioSeed(definition, suitePath) {
  const seed = definition.seed;
  if (!seed?.statePath || !seed?.sramPath) {
    throw new Error(`${definition.id}: seed statePath and sramPath are required`);
  }
  const base = dirname(suitePath);
  const [state, sram] = await Promise.all([
    readFile(resolve(base, seed.statePath)),
    readFile(resolve(base, seed.sramPath)),
  ]);
  const stateSha256 = sha256(state);
  const sramSha256 = sha256(sram);
  if (stateSha256 !== seed.stateSha256 || sramSha256 !== seed.sramSha256) {
    throw new Error(`${definition.id}: scenario seed digest mismatch`);
  }
  return {
    state: new Uint8Array(state),
    sram: new Uint8Array(sram),
    stateSha256,
    sramSha256,
    provenance: seed.provenance ?? null,
  };
}

async function loadScenarioSeeds(definition, suitePath) {
  if (!Array.isArray(definition.variants)) {
    return loadScenarioSeed(definition, suitePath);
  }
  return Promise.all(
    definition.variants.map((variant) =>
      loadScenarioSeed(
        { ...variant, id: `${definition.id}/${variant.id}` },
        suitePath,
      ),
    ),
  );
}

async function main() {
  const options = parseArguments(process.argv.slice(2));
  if (options.help) {
    process.stdout.write(usage);
    return;
  }

  const bundle = await loadResearchBundle(
    new URL("../../research/", import.meta.url),
  );
  const suitePath = resolve(options.suite);
  const suiteBytes = await readFile(suitePath);
  const suite = JSON.parse(suiteBytes.toString("utf8"));
  const selected = selectDevelopmentScenario({
    transitions: bundle.transitions,
    suite,
    scenarioId: options.scenario,
    trials: options.trials,
  });
  const seed = await loadScenarioSeeds(selected.definition, suitePath);
  const cartridge = bundle.cartridges.profiles.find(
    ({ id }) => id === bundle.cartridges.qualificationProfileId,
  );
  const mgba = bundle.sources.sources.find(({ id }) => id === "mgba-core");
  const wrapper = bundle.sources.sources.find(
    ({ id }) => id === "mgba-wasm-wrapper",
  );
  const runtimePath = resolve(
    options.runtime ?? artifactPath(bundle, "firered-runtime-symbols"),
  );
  const worldPath = resolve(
    options.world ?? artifactPath(bundle, "firered-world-structure"),
  );
  const [rom, runtimeBytes, worldBytes, harnessRevision] = await Promise.all([
    readFile(resolve(options.rom)),
    readFile(runtimePath),
    readFile(worldPath),
    computeHarnessRevision(projectRoot),
  ]);
  const knowledgeArtifacts = [
    verifyKnowledgeArtifact({
      bundle,
      datasetId: "firered-runtime-symbols",
      bytes: runtimeBytes,
    }),
    verifyKnowledgeArtifact({
      bundle,
      datasetId: "firered-world-structure",
      bytes: worldBytes,
    }),
  ];
  const runtime = JSON.parse(runtimeBytes.toString("utf8"));
  const world = JSON.parse(worldBytes.toString("utf8"));
  const runId = `${options.scenario}-diagnostic-${randomUUID()}`;
  const collectedAt = options.collected_at ?? new Date().toISOString();

  let session;
  try {
    session = await createPinnedMgbaSession({
      coreDirectory: resolve(options.core),
      expected: {
        mgbaCommit: mgba.revision.value,
        wrapperCommit: wrapper.revision.value,
        mgbaWasmSha256: mgba.artifact.wasmSha256,
      },
      romBytes: new Uint8Array(rom),
      cartridge,
      printErr(value) {
        process.stderr.write(`[mgba] ${String(value).slice(0, 400)}\n`);
      },
    });
    for (let frame = 0; frame < options.warmup_frames; frame += 1) {
      session.step([]);
    }
    const observer = createFireRedObserver({ session, runtime, world, runId });
    const initialSeed = Array.isArray(seed) ? seed[0] : seed;
    if (initialSeed.sram.length > 0) session.loadSram(initialSeed.sram);
    session.loadState(initialSeed.state);
    observer.resetHistory?.();
    const startSnapshot = captureCanonicalSnapshot({ session, observer });
    const result = runScenarioTrials({
      session,
      observer,
      definition: selected.definition,
      seed,
    });
    const endSnapshot = captureCanonicalSnapshot({ session, observer });
    const endingRevision = await computeHarnessRevision(projectRoot);
    if (endingRevision !== harnessRevision) {
      throw new Error("diagnostic harness or transition corpus changed during the run");
    }
    const diagnostic = createRealMgbaScenarioDiagnostic({
      collectedAt,
      runId,
      result,
      minimumSuccessfulTraces: selected.minimumSuccessfulTraces,
      definition: selected.definition,
      scenarioSuiteBytes: suiteBytes,
      identity: session.identity,
      knowledgeArtifacts,
      harnessRevision,
      startSnapshot,
      endSnapshot,
    });
    const output = await writePrivateRunArtifact({
      directory: resolve(
        options.output ??
          join(projectRoot, "private", "evidence", "scenario-development"),
      ),
      gateId: `diagnostic-${options.scenario}`,
      runId,
      artifactBytes: diagnostic.artifactBytes,
      artifactSha256: diagnostic.artifactSha256,
    });
    const diagnosticPassed =
      result.successes === selected.definition.trials && result.failures === 0;
    process.stdout.write(
      `${JSON.stringify(
        {
          scenarioId: options.scenario,
          runId,
          diagnosticPassed,
          promotable: false,
          successes: result.successes,
          failures: result.failures,
          artifact: output,
        },
        null,
        2,
      )}\n`,
    );
    if (!diagnosticPassed) process.exitCode = 1;
  } finally {
    session?.close();
  }
}

main().catch((error) => {
  process.stderr.write(`${error.message}\n`);
  if (error instanceof UsageError) process.stderr.write(`\n${usage}`);
  process.exitCode = error instanceof UsageError ? 2 : 1;
});
