#!/usr/bin/env node

import { createHash, randomUUID } from "node:crypto";
import {
  chmod,
  mkdir,
  readFile,
  writeFile,
} from "node:fs/promises";
import { basename, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { createPinnedMgbaSession } from "../emulator/pinned-mgba.js";
import { computeHarnessRevision } from "../evidence/artifact.js";
import { createFireRedObserver } from "../evidence/fire-red-observer.js";
import { verifyKnowledgeArtifact } from "../evidence/knowledge-artifact.js";
import { executeSeedProgram } from "../evidence/mart-seed.js";
import { stableJson } from "../evidence/qualification.js";
import {
  STOCK_SAVE_BOOTSTRAP_PROGRAM,
  assertAcceptedStockSaveObservation,
  createStockSaveCatalog,
  identifyStockSaveInputs,
} from "../evidence/save-intake.js";
import { captureCanonicalSnapshot } from "../evidence/snapshot.js";
import { loadResearchBundle } from "../research.js";

const projectRoot = fileURLToPath(new URL("../..", import.meta.url));

const usage = `Usage:
  npm run catalog:stock-saves -- --rom PATH --core PATH \\
    --source-sram PATH [--source-sram PATH ...] [options]

Required private inputs:
  --rom PATH          Exact stock FireRed Rev 1 cartridge
  --core PATH         Pinned real mGBA directory
  --source-sram PATH  Explicit 128 KiB FireRed save; repeat for each candidate

Options:
  --runtime PATH      Runtime-symbol artifact (default: private knowledge artifact)
  --world PATH        World artifact (default: private knowledge artifact)
  --output PATH       Private content-addressed catalog directory
                      (default: private/save-catalog)
  --collected-at ISO  Fixed provenance time (default: current time)
  --help              Show this help

The command never scans for old bot files. It deduplicates only the explicitly
named SRAM bytes, boots each through the pinned stock cartridge, requires the
stock loader's SAVE_STATUS_OK, and captures a fresh stock-mGBA state.
`;

class UsageError extends Error {}

function parseArguments(args) {
  const parsed = { source_sram: [] };
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
    const key = argument.slice(2).replaceAll("-", "_");
    if (key === "source_sram") parsed.source_sram.push(value);
    else parsed[key] = value;
    index += 1;
  }
  if (!parsed.rom) throw new UsageError("--rom is required");
  if (!parsed.core) throw new UsageError("--core is required");
  if (parsed.source_sram.length === 0) {
    throw new UsageError("--source-sram is required");
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

async function writePrivateContent({ directory, prefix, extension, bytes }) {
  const digest = sha256(bytes);
  const filename = `${prefix}.${digest}.${extension}`;
  const path = join(directory, filename);
  await mkdir(directory, { recursive: true, mode: 0o700 });
  try {
    await writeFile(path, bytes, { flag: "wx", mode: 0o600 });
  } catch (error) {
    if (error?.code !== "EEXIST") throw error;
    const existing = await readFile(path);
    if (existing.length !== bytes.length || sha256(existing) !== digest) {
      throw new Error(`${filename}: existing content-addressed file is corrupt`);
    }
  }
  await chmod(path, 0o600);
  return { path, filename, bytes: bytes.length, sha256: digest };
}

function identityKey(identity) {
  return JSON.stringify(identity);
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
  const sourcePaths = options.source_sram.map((path) => resolve(path));
  const [rom, runtimeBytes, worldBytes, harnessRevision, ...sourceBytes] =
    await Promise.all([
      readFile(resolve(options.rom)),
      readFile(runtimePath),
      readFile(worldPath),
      computeHarnessRevision(projectRoot),
      ...sourcePaths.map((path) => readFile(path)),
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
  const inputs = identifyStockSaveInputs(
    sourceBytes.map((sram, index) => ({
      label: `input-${index + 1}:${basename(sourcePaths[index])}`,
      sram: new Uint8Array(sram),
    })),
  );
  const runId = `stock-save-intake-${randomUUID()}`;
  const collectedAt = options.collected_at ?? new Date().toISOString();
  const outputDirectory = resolve(
    options.output ?? join(projectRoot, "private", "save-catalog"),
  );
  const records = [];
  let catalogIdentity = null;

  for (const [index, input] of inputs.entries()) {
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
      if (
        catalogIdentity !== null &&
        identityKey(catalogIdentity) !== identityKey(session.identity)
      ) {
        throw new Error("stock-save sessions did not use one pinned emulator identity");
      }
      catalogIdentity ??= session.identity;
      session.loadSram(input.sram);
      const observer = createFireRedObserver({
        session,
        runtime,
        world,
        runId: `${runId}-${index + 1}`,
      });
      let bootstrap;
      try {
        bootstrap = executeSeedProgram({
          session,
          observer,
          program: STOCK_SAVE_BOOTSTRAP_PROGRAM,
        });
      } catch (error) {
        if (error?.stageId === "wait-for-stock-save-loader") {
          throw new Error(
            `${input.source.labels.join(", ")}: stock FireRed loader did not report SAVE_STATUS_OK`,
          );
        }
        throw error;
      }
      const snapshot = captureCanonicalSnapshot({ session, observer });
      assertAcceptedStockSaveObservation(snapshot.observation);
      const [stateOutput, sramOutput] = await Promise.all([
        writePrivateContent({
          directory: outputDirectory,
          prefix: "stock-save",
          extension: "state",
          bytes: snapshot.state,
        }),
        writePrivateContent({
          directory: outputDirectory,
          prefix: "stock-save",
          extension: "sav",
          bytes: snapshot.sram,
        }),
      ]);
      records.push({
        id: `stock-save-${input.source.sha256.slice(0, 16)}`,
        source: structuredClone(input.source),
        bootstrap: { stages: bootstrap.stages },
        snapshot: {
          frame: snapshot.frame,
          statePath: stateOutput.filename,
          stateSha256: stateOutput.sha256,
          sramPath: sramOutput.filename,
          sramSha256: sramOutput.sha256,
          observationSha256: snapshot.observationSha256,
          observation: snapshot.observation,
        },
      });
    } finally {
      session?.close();
    }
  }

  const endingRevision = await computeHarnessRevision(projectRoot);
  if (endingRevision !== harnessRevision) {
    throw new Error("stock-save intake harness changed during the run");
  }
  const catalog = createStockSaveCatalog({
    runId,
    collectedAt,
    harnessRevision,
    identity: catalogIdentity,
    knowledgeArtifacts,
    records,
  });
  const catalogBytes = Buffer.from(stableJson(catalog));
  const catalogOutput = await writePrivateContent({
    directory: outputDirectory,
    prefix: "stock-save-catalog",
    extension: "json",
    bytes: catalogBytes,
  });
  process.stdout.write(
    `${JSON.stringify(
      {
        runId,
        explicitInputs: sourcePaths.length,
        uniqueInputs: inputs.length,
        accepted: records.length,
        catalog: catalogOutput,
        entries: records.map(({ id, source, snapshot }) => ({
          id,
          source,
          stateSha256: snapshot.stateSha256,
          sramSha256: snapshot.sramSha256,
          observationSha256: snapshot.observationSha256,
          map: snapshot.observation.playerMemory.map,
          position: snapshot.observation.playerMemory.position,
        })),
      },
      null,
      2,
    )}\n`,
  );
}

main().catch((error) => {
  process.stderr.write(`${error.message}\n`);
  if (error instanceof UsageError) process.stderr.write(`\n${usage}`);
  process.exitCode = error instanceof UsageError ? 2 : 1;
});
