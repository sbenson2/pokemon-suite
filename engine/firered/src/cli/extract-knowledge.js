#!/usr/bin/env node

import { execFile as execFileCallback } from "node:child_process";
import { createHash } from "node:crypto";
import { readFile, stat } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { join, resolve } from "node:path";
import { promisify } from "node:util";

import { digestSourceBundle } from "../extractor/artifact.js";
import { generateKnowledgePack } from "../extractor/knowledge-pack.js";
import { KNOWLEDGE_VERSIONS, knowledgeVersionForProfile } from "../extractor/versions.js";
import { loadResearchBundle } from "../research.js";

const execFile = promisify(execFileCallback);
const projectRoot = fileURLToPath(new URL("../..", import.meta.url));
const GENERATOR_SOURCE_FILES = [
  "src/cli/extract-knowledge.js",
  "src/extractor/artifact.js",
  "src/extractor/battle.js",
  "src/extractor/knowledge-pack.js",
  "src/extractor/primitives.js",
  "src/extractor/runtime.js",
  "src/extractor/story.js",
  "src/extractor/versions.js",
  "src/extractor/world.js",
];

const PROFILES = Object.values(KNOWLEDGE_VERSIONS).map(({ cartridgeProfileId }) => cartridgeProfileId);
const usage = `Usage:
  npm run extract:knowledge -- --source PATH --stock-rom PATH [--profile ID] [--output PATH]

Required private inputs:
  --source PATH       Pinned pret/pokefirered checkout with an exact Rev1 build
                      of the chosen profile (make firered_rev1 or leafgreen_rev1)
  --stock-rom PATH    Stock Rev1 ROM of that profile, used only for local hash verification

Options:
  --profile ID        ${PROFILES.join(" or ")} (default: the qualification profile)
  --output PATH       Private artifact directory (default: private/knowledge)
  --collected-at ISO  Receipt timestamp; artifacts themselves contain no timestamp
  --help              Show this help
`;

class UsageError extends Error {}

function parseArguments(args) {
  const parsed = {};
  for (let index = 0; index < args.length; index += 1) {
    const argument = args[index];
    if (argument === "--help") return { help: true };
    if (!["--source", "--stock-rom", "--profile", "--output", "--collected-at"].includes(argument)) {
      throw new UsageError(`unknown argument ${argument}`);
    }
    const value = args[index + 1];
    if (!value || value.startsWith("--")) {
      throw new UsageError(`${argument} requires a value`);
    }
    parsed[argument.slice(2).replaceAll("-", "_")] = value;
    index += 1;
  }
  if (!parsed.source) throw new UsageError("--source is required");
  if (!parsed.stock_rom) throw new UsageError("--stock-rom is required");
  if (parsed.profile !== undefined && !PROFILES.includes(parsed.profile)) {
    throw new UsageError(`--profile must be ${PROFILES.join(" or ")}`);
  }
  return parsed;
}

async function hashFile(path, algorithm) {
  const content = await readFile(path);
  return createHash(algorithm).update(content).digest("hex");
}

async function fileFingerprint(path) {
  const metadata = await stat(path);
  if (!metadata.isFile()) throw new Error(`${path} is not a regular file`);
  const [sha1, sha256] = await Promise.all([
    hashFile(path, "sha1"),
    hashFile(path, "sha256"),
  ]);
  return { bytes: metadata.size, sha1, sha256 };
}

async function gitOutput(sourceRoot, args) {
  const { stdout } = await execFile("git", ["-C", sourceRoot, ...args], {
    encoding: "utf8",
  });
  return stdout.trim();
}

async function main() {
  const options = parseArguments(process.argv.slice(2));
  if (options.help) {
    process.stdout.write(usage);
    return;
  }

  const sourceRoot = resolve(options.source);
  const stockRomPath = resolve(options.stock_rom);
  const outputDirectory = resolve(
    options.output ?? join(projectRoot, "private/knowledge"),
  );
  const bundle = await loadResearchBundle(
    new URL("../../research/", import.meta.url),
  );
  const profileId = options.profile ?? bundle.cartridges.qualificationProfileId;
  const profile = bundle.cartridges.profiles.find(({ id }) => id === profileId);
  const version = knowledgeVersionForProfile(profileId);
  if (!profile || !version || profile.relationship !== "stock") {
    throw new Error(`${profileId} is not a stock FRLG profile in the research ledger`);
  }
  const sourceRecord = bundle.sources.sources.find(
    ({ id }) => id === profile.decompilation.sourceId,
  );

  const [sourceHead, trackedChanges] = await Promise.all([
    gitOutput(sourceRoot, ["rev-parse", "HEAD"]),
    gitOutput(sourceRoot, ["status", "--porcelain", "--untracked-files=no"]),
  ]);
  if (sourceHead !== sourceRecord.revision.value) {
    throw new Error(
      `source HEAD ${sourceHead} does not match pinned ${sourceRecord.revision.value}`,
    );
  }
  if (trackedChanges) {
    throw new Error("pinned source checkout has tracked modifications");
  }

  const builtPaths = {
    rom: join(sourceRoot, `${version.buildName}.gba`),
    symbols: join(sourceRoot, `${version.buildName}.sym`),
    map: join(sourceRoot, `${version.buildName}.map`),
    elf: join(sourceRoot, `${version.buildName}.elf`),
  };
  const [stockRom, builtRom, symbols, map, elf, generator] = await Promise.all([
    fileFingerprint(stockRomPath),
    fileFingerprint(builtPaths.rom),
    fileFingerprint(builtPaths.symbols),
    fileFingerprint(builtPaths.map),
    fileFingerprint(builtPaths.elf),
    digestSourceBundle(projectRoot, GENERATOR_SOURCE_FILES),
  ]);
  for (const [name, fingerprint] of [
    ["stock ROM", stockRom],
    ["built ROM", builtRom],
  ]) {
    if (fingerprint.bytes !== profile.bytes || fingerprint.sha1 !== profile.sha1) {
      throw new Error(`${name} does not match ${profile.id}`);
    }
  }
  if (builtRom.sha256 !== stockRom.sha256) {
    throw new Error("exact build and stock ROM disagree despite profile checks");
  }

  const build = {
    target: version.target,
    sourceTreeTrackedClean: true,
    romBytes: builtRom.bytes,
    romSha1: builtRom.sha1,
    romSha256: builtRom.sha256,
    symbolsBytes: symbols.bytes,
    symbolsSha256: symbols.sha256,
    mapBytes: map.bytes,
    mapSha256: map.sha256,
    elfBytes: elf.bytes,
    elfSha256: elf.sha256,
  };
  const generated = await generateKnowledgePack({
    version: version.game,
    sourceRoot,
    outputDirectory,
    cartridgeProfileId: profile.id,
    source: { id: sourceRecord.id, revision: sourceHead },
    generator,
    build,
    collectedAt: options.collected_at ?? new Date().toISOString(),
  });

  process.stdout.write(
    `${JSON.stringify(
      {
        outputDirectory,
        generatorRevision: generator.revision,
        receiptSha256: generated.receiptArtifact.sha256,
        datasets: generated.receipt.datasets,
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
