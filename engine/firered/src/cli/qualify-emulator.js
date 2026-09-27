#!/usr/bin/env node

import { createHash, randomUUID } from "node:crypto";
import { readFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import {
  computeHarnessRevision,
  recordPublicReceipt,
  writePrivateRunArtifact,
} from "../evidence/artifact.js";
import { createFireRedObserver } from "../evidence/fire-red-observer.js";
import { verifyKnowledgeArtifact } from "../evidence/knowledge-artifact.js";
import {
  createRealMgbaEvidence,
  runAtomicObservationQualification,
  runModalCorpusQualification,
  runScenarioTrials,
  runSnapshotRoundtripQualification,
} from "../evidence/qualification.js";
import { captureCanonicalSnapshot } from "../evidence/snapshot.js";
import { createPinnedMgbaSession } from "../emulator/pinned-mgba.js";
import { loadResearchBundle } from "../research.js";

const projectRoot = fileURLToPath(new URL("../..", import.meta.url));
const STAGE_2_GATES = new Set([
  "atomic-observation-sampling",
  "snapshot-roundtrip",
  "mart-entry-roundtrip",
  "modal-transition-corpus",
]);

const usage = `Usage:
  npm run qualify:emulator -- --gate GATE --rom PATH --core PATH [options]

Required private inputs:
  --gate ID          Stage 2 gate: atomic-observation-sampling,
                     snapshot-roundtrip, mart-entry-roundtrip, or
                     modal-transition-corpus
  --rom PATH         Exact stock FireRed Rev 1 cartridge
  --core PATH        Pinned real mGBA directory containing build-manifest.json,
                     mgba.js, and mgba.wasm

Scenario inputs:
  --suite PATH       Private real-mGBA scenario suite; required for Mart/modal gates

Options:
  --runtime PATH     Runtime-symbol artifact (default: private knowledge artifact)
  --world PATH       World artifact (default: private knowledge artifact)
  --output PATH      Private run directory (default: private/evidence)
  --attempts N       Atomic samples (default: acceptance target)
  --trials N         Snapshot or Mart trials (default: acceptance target)
  --warmup-frames N  Neutral boot frames before qualification (default: 1)
  --collected-at ISO Fixed receipt time (default: current time)
  --record            Add a passing receipt to research/evidence.json
  --help              Show this help

Synthetic tests never satisfy this command. Every receipt is produced by the
pinned real mGBA WASM core and exact stock cartridge.
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
  const parsed = { record: false };
  const valueOptions = new Set([
    "--gate",
    "--rom",
    "--core",
    "--suite",
    "--runtime",
    "--world",
    "--output",
    "--attempts",
    "--trials",
    "--warmup-frames",
    "--collected-at",
  ]);
  for (let index = 0; index < args.length; index += 1) {
    const argument = args[index];
    if (argument === "--help") return { help: true };
    if (argument === "--record") {
      parsed.record = true;
      continue;
    }
    if (!valueOptions.has(argument)) throw new UsageError(`unknown argument ${argument}`);
    const value = args[index + 1];
    if (!value || value.startsWith("--")) {
      throw new UsageError(`${argument} requires a value`);
    }
    parsed[argument.slice(2).replaceAll("-", "_")] = value;
    index += 1;
  }
  if (!parsed.gate) throw new UsageError("--gate is required");
  if (!STAGE_2_GATES.has(parsed.gate)) {
    throw new UsageError(`unsupported Stage 2 gate: ${parsed.gate}`);
  }
  if (!parsed.rom) throw new UsageError("--rom is required");
  if (!parsed.core) throw new UsageError("--core is required");
  if (
    ["mart-entry-roundtrip", "modal-transition-corpus"].includes(parsed.gate) &&
    !parsed.suite
  ) {
    throw new UsageError(`--suite is required for ${parsed.gate}`);
  }
  if (parsed.attempts !== undefined) {
    parsed.attempts = parsePositiveInteger("--attempts", parsed.attempts);
  }
  if (parsed.trials !== undefined) {
    parsed.trials = parsePositiveInteger("--trials", parsed.trials);
  }
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

function gatePassed(gate, result) {
  return (
    result.successes >= gate.targetSuccesses &&
    result.failures <= gate.maxFailures
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
  const gate = bundle.acceptance.gates.find(({ id }) => id === options.gate);
  if (!gate?.allowedEvidence.includes("real-mgba")) {
    throw new Error(`${options.gate} is not a real-mGBA evidence gate`);
  }
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

  const runId = `${options.gate}-${randomUUID()}`;
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
    const startSnapshot = captureCanonicalSnapshot({ session, observer });

    let result;
    let scenarioSuiteBytes;
    if (options.gate === "atomic-observation-sampling") {
      result = runAtomicObservationQualification({
        session,
        observer,
        attempts: options.attempts ?? gate.targetSuccesses,
      });
    } else if (options.gate === "snapshot-roundtrip") {
      result = runSnapshotRoundtripQualification({
        session,
        observer,
        trials: options.trials ?? gate.targetSuccesses,
      });
    } else {
      const suitePath = resolve(options.suite);
      scenarioSuiteBytes = await readFile(suitePath);
      const suite = JSON.parse(scenarioSuiteBytes.toString("utf8"));
      if (options.gate === "mart-entry-roundtrip") {
        const declared = suite.scenarios?.find(
          ({ id }) => id === "mart-entry-roundtrip",
        );
        if (!declared) throw new Error("scenario suite has no Mart roundtrip");
        const definition = {
          ...declared,
          trials: options.trials ?? gate.targetSuccesses,
        };
        const seed = await loadScenarioSeed(definition, suitePath);
        result = runScenarioTrials({ session, observer, definition, seed });
        result.gateId = "mart-entry-roundtrip";
      } else {
        const loadedSeeds = new Map(
          await Promise.all(
            suite.scenarios.map(async (definition) => [
              definition.id,
              await loadScenarioSeeds(definition, suitePath),
            ]),
          ),
        );
        result = runModalCorpusQualification({
          session,
          observer,
          transitions: bundle.transitions,
          suite,
          seedFor: (definition) => loadedSeeds.get(definition.id),
        });
      }
    }

    const endSnapshot = captureCanonicalSnapshot({ session, observer });
    const endingRevision = await computeHarnessRevision(projectRoot);
    if (endingRevision !== harnessRevision) {
      throw new Error("qualification harness or acceptance corpus changed during the run");
    }
    const evidence = createRealMgbaEvidence({
      collectedAt,
      runId,
      result,
      identity: session.identity,
      knowledgeArtifacts,
      harnessRevision,
      startSnapshot,
      endSnapshot,
      scenarioSuiteBytes,
    });
    const output = await writePrivateRunArtifact({
      directory: resolve(options.output ?? join(projectRoot, "private", "evidence")),
      gateId: options.gate,
      runId,
      artifactBytes: evidence.artifactBytes,
      artifactSha256: evidence.artifactSha256,
    });
    const passed = gatePassed(gate, result);
    let recorded = false;
    if (options.record) {
      if (!passed) {
        throw new Error("failed qualification cannot be recorded in the public ledger");
      }
      const record = await recordPublicReceipt({
        acceptancePath: join(projectRoot, "research", "acceptance.json"),
        evidencePath: join(projectRoot, "research", "evidence.json"),
        receipt: evidence.receipt,
      });
      recorded = record.recorded;
    }
    process.stdout.write(
      `${JSON.stringify(
        {
          gateId: options.gate,
          runId,
          passed,
          successes: result.successes,
          failures: result.failures,
          artifact: output,
          receipt: evidence.receipt,
          recorded,
        },
        null,
        2,
      )}\n`,
    );
    if (!passed) process.exitCode = 1;
  } finally {
    session?.close();
  }
}

main().catch((error) => {
  process.stderr.write(`${error.message}\n`);
  if (error instanceof UsageError) process.stderr.write(`\n${usage}`);
  process.exitCode = error instanceof UsageError ? 2 : 1;
});
