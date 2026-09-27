#!/usr/bin/env node

import { createHash, randomUUID } from "node:crypto";
import { chmod, mkdir, readFile, writeFile } from "node:fs/promises";
import { basename, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { createPinnedMgbaSession } from "../emulator/pinned-mgba.js";
import { computeHarnessRevision } from "../evidence/artifact.js";
import { createFireRedObserver } from "../evidence/fire-red-observer.js";
import { verifyKnowledgeArtifact } from "../evidence/knowledge-artifact.js";
import { executeSeedProgram } from "../evidence/mart-seed.js";
import { stableJson } from "../evidence/qualification.js";
import { captureCanonicalSnapshot } from "../evidence/snapshot.js";
import { loadResearchBundle } from "../research.js";

const projectRoot = fileURLToPath(new URL("../..", import.meta.url));
const FIRE_RED_FLASH_BYTES = 128 * 1024;
const SAFE_ID = /^[a-z0-9][a-z0-9-]*$/;

const usage = `Usage:
  npm run prepare:scenario-seed -- --id ID --program PATH --rom PATH --core PATH START [options]

Required private inputs:
  --id ID             Lowercase content label for the resulting seed
  --program PATH      Data-only bounded seed program (array or
                      master-red/mgba-seed-program/v1 document)
  --rom PATH          Exact stock FireRed Rev 1 cartridge
  --core PATH         Pinned real mGBA directory

Choose exactly one starting mode:
  --source-state PATH Whole-emulator state, paired with --source-sram
  --source-sram PATH  Exact 128 KiB SRAM, paired with --source-state
  --fresh-boot        Start from a new stock-ROM mGBA session

Options:
  --runtime PATH      Runtime-symbol artifact (default: private knowledge)
  --world PATH        World artifact (default: private knowledge)
  --output PATH       Private output directory
                      (default: private/scenario-seeds/ID)
  --collected-at ISO  Fixed provenance time (default: current time)
  --help              Show this help

The command executes only the declared bounded input program on stock FireRed
Rev 1. It records the exact source, program, observations, core identity, and
content digests; it never scans historical bot directories.
`;

class UsageError extends Error {}

function parseArguments(args) {
  const parsed = { fresh_boot: false };
  const valueOptions = new Set([
    "--id",
    "--program",
    "--rom",
    "--core",
    "--source-state",
    "--source-sram",
    "--runtime",
    "--world",
    "--output",
    "--collected-at",
  ]);
  for (let index = 0; index < args.length; index += 1) {
    const argument = args[index];
    if (argument === "--help") return { help: true };
    if (argument === "--fresh-boot") {
      parsed.fresh_boot = true;
      continue;
    }
    if (!valueOptions.has(argument)) {
      throw new UsageError(`unknown argument ${argument}`);
    }
    const value = args[index + 1];
    if (!value || value.startsWith("--")) {
      throw new UsageError(`${argument} requires a value`);
    }
    parsed[argument.slice(2).replaceAll("-", "_")] = value;
    index += 1;
  }
  if (!parsed.id) throw new UsageError("--id is required");
  if (!SAFE_ID.test(parsed.id)) {
    throw new UsageError("--id must contain lowercase letters, digits, or hyphens");
  }
  if (!parsed.program) throw new UsageError("--program is required");
  if (!parsed.rom) throw new UsageError("--rom is required");
  if (!parsed.core) throw new UsageError("--core is required");
  const hasState = Boolean(parsed.source_state);
  const hasSram = Boolean(parsed.source_sram);
  if (!parsed.fresh_boot && !hasState && !hasSram) {
    throw new UsageError(
      "--source-state and --source-sram are required unless --fresh-boot is used",
    );
  }
  if (parsed.fresh_boot && (hasState || hasSram)) {
    throw new UsageError("choose exactly one starting mode: source pair or fresh boot");
  }
  if (!parsed.fresh_boot && hasState !== hasSram) {
    throw new UsageError("--source-state and --source-sram must be supplied together");
  }
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

function stagesFrom(document) {
  const stages = Array.isArray(document) ? document : document?.stages;
  if (
    !Array.isArray(document) &&
    document?.schema !== "master-red/mgba-seed-program/v1"
  ) {
    throw new Error("seed program schema is invalid");
  }
  if (!Array.isArray(stages) || stages.length === 0) {
    throw new Error("seed program must contain at least one stage");
  }
  return stages;
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
  const reads = [
    readFile(resolve(options.rom)),
    readFile(resolve(options.program)),
    readFile(runtimePath),
    readFile(worldPath),
    computeHarnessRevision(projectRoot),
  ];
  if (!options.fresh_boot) {
    reads.push(
      readFile(resolve(options.source_state)),
      readFile(resolve(options.source_sram)),
    );
  }
  const [
    rom,
    programBytes,
    runtimeBytes,
    worldBytes,
    harnessRevision,
    sourceState,
    sourceSram,
  ] = await Promise.all(reads);
  if (sourceSram && sourceSram.length !== FIRE_RED_FLASH_BYTES) {
    throw new Error(
      `source SRAM must contain exactly ${FIRE_RED_FLASH_BYTES} bytes`,
    );
  }
  const programDocument = JSON.parse(programBytes.toString("utf8"));
  const program = stagesFrom(programDocument);
  const runtime = JSON.parse(runtimeBytes.toString("utf8"));
  const world = JSON.parse(worldBytes.toString("utf8"));
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

  const runId = `scenario-seed-${options.id}-${randomUUID()}`;
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
    if (!options.fresh_boot) {
      session.loadSram(new Uint8Array(sourceSram));
      session.loadState(new Uint8Array(sourceState));
    }
    const observer = createFireRedObserver({ session, runtime, world, runId });
    observer.resetHistory();
    const initialObservation = observer.capture();
    const execution = executeSeedProgram({ session, observer, program });
    const snapshot = captureCanonicalSnapshot({ session, observer });
    const endingRevision = await computeHarnessRevision(projectRoot);
    if (endingRevision !== harnessRevision) {
      throw new Error("seed harness changed during the real-mGBA preparation run");
    }

    const source = options.fresh_boot
      ? { kind: "fresh-stock-boot" }
      : {
          kind: "explicit-state-sram-pair",
          state: {
            label: basename(resolve(options.source_state)),
            bytes: sourceState.length,
            sha256: sha256(sourceState),
          },
          sram: {
            label: basename(resolve(options.source_sram)),
            bytes: sourceSram.length,
            sha256: sha256(sourceSram),
          },
        };
    const trace = {
      schema: "master-red/mgba-scenario-seed/v1",
      evidenceClass: "real-mgba",
      runId,
      collectedAt,
      id: options.id,
      harness: { kind: "source-bundle-sha256", revision: harnessRevision },
      identity: session.identity,
      knowledgeArtifacts,
      source,
      program: {
        label: basename(resolve(options.program)),
        bytes: programBytes.length,
        sha256: sha256(programBytes),
        stages: program,
      },
      result: {
        initialObservation,
        stages: execution.stages,
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
    const stateFile = `${options.id}.${snapshot.stateSha256}.state`;
    const sramFile = `${options.id}.${snapshot.sramSha256}.sav`;
    const traceFile = `${options.id}-bootstrap.${traceSha256}.json`;
    const seed = {
      statePath: stateFile,
      sramPath: sramFile,
      stateSha256: snapshot.stateSha256,
      sramSha256: snapshot.sramSha256,
      provenance: {
        kind: "real-mgba-scenario-seed",
        evidenceClass: "real-mgba",
        tracePath: traceFile,
        traceSha256,
        programSha256: sha256(programBytes),
        cartridgeProfileId: session.identity.cartridgeProfileId,
        romSha1: session.identity.romSha1,
        mgbaCommit: session.identity.mgbaCommit,
        mgbaWrapperCommit: session.identity.mgbaWrapperCommit,
        mgbaJsSha256: session.identity.mgbaJsSha256,
        mgbaWasmSha256: session.identity.mgbaWasmSha256,
        harnessRevisionKind: "source-bundle-sha256",
        harnessRevision,
      },
    };
    const seedBytes = stableJson({
      schema: "master-red/mgba-scenario-seed-descriptor/v1",
      id: options.id,
      seed,
      finalObservation: snapshot.observation,
    });
    const seedSha256 = sha256(Buffer.from(seedBytes));
    const seedFile = `${options.id}.${seedSha256}.seed.json`;
    const outputDirectory = resolve(
      options.output ??
        join(projectRoot, "private", "scenario-seeds", options.id),
    );
    await mkdir(outputDirectory, { recursive: true, mode: 0o700 });
    await chmod(outputDirectory, 0o700);
    const [stateOutput, sramOutput, traceOutput, descriptorOutput] =
      await Promise.all([
        writePrivate(join(outputDirectory, stateFile), snapshot.state),
        writePrivate(join(outputDirectory, sramFile), snapshot.sram),
        writePrivate(join(outputDirectory, traceFile), traceBytes),
        writePrivate(join(outputDirectory, seedFile), seedBytes),
      ]);
    process.stdout.write(
      `${JSON.stringify(
        {
          runId,
          id: options.id,
          finalObservation: snapshot.observation,
          seed,
          state: stateOutput,
          sram: sramOutput,
          trace: traceOutput,
          descriptor: descriptorOutput,
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
  if (error?.lastObservation) {
    const observation = error.lastObservation;
    process.stderr.write(
      `${JSON.stringify(
        {
          phase: observation.phase,
          phaseReasons: observation.phaseReasons,
          emulator: {
            mode: observation.emulator?.mode,
            callback1: observation.emulator?.callback1,
            callback2: observation.emulator?.callback2,
          },
          playerMemory: {
            map: observation.playerMemory?.map,
            position: observation.playerMemory?.position,
            scripts: observation.playerMemory?.scripts,
            ui: observation.playerMemory?.ui,
            activeTasks: observation.playerMemory?.activeTasks,
          },
        },
        null,
        2,
      )}\n`,
    );
  }
  if (error instanceof UsageError) process.stderr.write(`\n${usage}`);
  process.exitCode = error instanceof UsageError ? 2 : 1;
});
