#!/usr/bin/env node

import { createHash, randomUUID } from "node:crypto";
import { chmod, mkdir, readFile, writeFile } from "node:fs/promises";
import { basename, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { createPinnedMgbaSession } from "../emulator/pinned-mgba.js";
import { computeHarnessRevision } from "../evidence/artifact.js";
import { createFireRedObserver } from "../evidence/fire-red-observer.js";
import { verifyKnowledgeArtifact } from "../evidence/knowledge-artifact.js";
import {
  VIRIDIAN_MART_BOOTSTRAP_PROGRAM,
  createMartScenarioSuite,
  executeSeedProgram,
} from "../evidence/mart-seed.js";
import { stableJson } from "../evidence/qualification.js";
import { matchesObservation } from "../evidence/scenario.js";
import { captureCanonicalSnapshot } from "../evidence/snapshot.js";
import { loadResearchBundle } from "../research.js";

const projectRoot = fileURLToPath(new URL("../..", import.meta.url));
const FIRE_RED_FLASH_BYTES = 128 * 1024;

const usage = `Usage:
  npm run prepare:mart-seed -- --rom PATH --core PATH --source-sram PATH [options]

Required private inputs:
  --rom PATH          Exact stock FireRed Rev 1 cartridge
  --core PATH         Pinned real mGBA directory
  --source-sram PATH  Explicit 128 KiB FireRed save accepted by the stock loader

Options:
  --runtime PATH      Runtime-symbol artifact (default: private knowledge artifact)
  --world PATH        World artifact (default: private knowledge artifact)
  --output PATH       Private seed directory
                      (default: private/scenarios/viridian-mart)
  --collected-at ISO  Fixed provenance time (default: current time)
  --help              Show this help

The command replays bounded controller input through the pinned real mGBA core,
checks the stock save loader, and stops outside Viridian Mart. It never loads a
historical whole-emulator state or guesses a private SRAM source.
`;

class UsageError extends Error {}

function parseArguments(args) {
  const parsed = {};
  const valueOptions = new Set([
    "--rom",
    "--core",
    "--source-sram",
    "--runtime",
    "--world",
    "--output",
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
  if (!parsed.rom) throw new UsageError("--rom is required");
  if (!parsed.core) throw new UsageError("--core is required");
  if (!parsed.source_sram) throw new UsageError("--source-sram is required");
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

async function writePrivate(path, bytes) {
  await writeFile(path, bytes, { mode: 0o600 });
  await chmod(path, 0o600);
  return { path, bytes: Buffer.byteLength(bytes), sha256: sha256(bytes) };
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
  const [rom, sourceSram, runtimeBytes, worldBytes, harnessRevision] = await Promise.all([
    readFile(resolve(options.rom)),
    readFile(resolve(options.source_sram)),
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
  if (sourceSram.length !== FIRE_RED_FLASH_BYTES) {
    throw new Error(
      `source SRAM must contain exactly ${FIRE_RED_FLASH_BYTES} bytes`,
    );
  }

  const runId = `mart-seed-${randomUUID()}`;
  const collectedAt = options.collected_at ?? new Date().toISOString();
  const sourceSramSha256 = sha256(sourceSram);
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
    session.loadSram(new Uint8Array(sourceSram));
    const observer = createFireRedObserver({ session, runtime, world, runId });
    const bootstrap = executeSeedProgram({
      session,
      observer,
      program: VIRIDIAN_MART_BOOTSTRAP_PROGRAM,
    });
    const snapshot = captureCanonicalSnapshot({ session, observer });
    const endingRevision = await computeHarnessRevision(projectRoot);
    if (endingRevision !== harnessRevision) {
      throw new Error("seed harness changed during the real-mGBA bootstrap");
    }

    const trace = {
      schema: "master-red/mgba-seed-bootstrap/v1",
      evidenceClass: "real-mgba",
      runId,
      collectedAt,
      recipe: "viridian-mart-exterior/v1",
      harness: { kind: "source-bundle-sha256", revision: harnessRevision },
      identity: session.identity,
      knowledgeArtifacts,
      sourceSram: {
        label: basename(resolve(options.source_sram)),
        bytes: sourceSram.length,
        sha256: sourceSramSha256,
        stockSaveFileStatus: snapshot.observation.playerMemory.saveFileStatus,
      },
      program: VIRIDIAN_MART_BOOTSTRAP_PROGRAM,
      result: {
        stages: bootstrap.stages,
        final: {
          frame: snapshot.frame,
          stateSha256: snapshot.stateSha256,
          sramSha256: snapshot.sramSha256,
          observationSha256: snapshot.observationSha256,
          observation: snapshot.observation,
        },
      },
    };
    const traceBytes = stableJson(trace);
    const traceSha256 = sha256(Buffer.from(traceBytes));
    const stateFile = `mart-entry-roundtrip.${snapshot.stateSha256}.state`;
    const sramFile = `mart-entry-roundtrip.${snapshot.sramSha256}.sav`;
    const traceFile = `mart-entry-roundtrip-bootstrap.${traceSha256}.json`;
    const provenance = {
      kind: "real-mgba-input-bootstrap",
      evidenceClass: "real-mgba",
      recipe: "viridian-mart-exterior/v1",
      tracePath: traceFile,
      traceSha256,
      sourceSramBytes: sourceSram.length,
      sourceSramSha256,
      cartridgeProfileId: session.identity.cartridgeProfileId,
      romSha1: session.identity.romSha1,
      mgbaCommit: session.identity.mgbaCommit,
      mgbaWrapperCommit: session.identity.mgbaWrapperCommit,
      mgbaJsSha256: session.identity.mgbaJsSha256,
      mgbaWasmSha256: session.identity.mgbaWasmSha256,
      harnessRevisionKind: "source-bundle-sha256",
      harnessRevision,
    };
    const suite = createMartScenarioSuite({
      stateFile,
      sramFile,
      stateSha256: snapshot.stateSha256,
      sramSha256: snapshot.sramSha256,
      provenance,
    });
    const scenario = suite.scenarios[0];
    if (!matchesObservation(snapshot.observation, scenario.precondition)) {
      throw new Error("captured Mart seed does not satisfy its precondition");
    }
    const suiteBytes = stableJson(suite);
    const suiteSha256 = sha256(Buffer.from(suiteBytes));
    const suiteFile = `mart-entry-roundtrip.${suiteSha256}.suite.json`;
    const outputDirectory = resolve(
      options.output ?? join(projectRoot, "private", "scenarios", "viridian-mart"),
    );
    await mkdir(outputDirectory, { recursive: true, mode: 0o700 });
    const [stateOutput, sramOutput, traceOutput, suiteOutput] = await Promise.all([
      writePrivate(join(outputDirectory, stateFile), snapshot.state),
      writePrivate(join(outputDirectory, sramFile), snapshot.sram),
      writePrivate(join(outputDirectory, traceFile), traceBytes),
      writePrivate(join(outputDirectory, suiteFile), suiteBytes),
    ]);
    process.stdout.write(
      `${JSON.stringify(
        {
          runId,
          recipe: trace.recipe,
          finalObservation: snapshot.observation,
          state: stateOutput,
          sram: sramOutput,
          trace: traceOutput,
          suite: suiteOutput,
        },
        null,
        2,
      )}\n`,
    );
  } finally {
    session?.close();
  }
}

main().catch((error) => {
  process.stderr.write(`${error.message}\n`);
  if (error instanceof UsageError) process.stderr.write(`\n${usage}`);
  process.exitCode = error instanceof UsageError ? 2 : 1;
});
