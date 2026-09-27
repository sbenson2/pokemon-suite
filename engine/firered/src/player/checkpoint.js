import { createHash, randomUUID } from "node:crypto";
import { chmod, mkdir, readFile, readdir, rename, stat, writeFile } from "node:fs/promises";
import { basename, join } from "node:path";

function sha256(bytes) {
  return createHash("sha256").update(bytes).digest("hex");
}

function safeRunId(value) {
  if (!/^[a-zA-Z0-9._-]{1,160}$/.test(value ?? "")) {
    throw new TypeError("checkpoint runId must be a safe identifier");
  }
  return value;
}

async function writePrivate(path, bytes) {
  await writeFile(path, bytes, { mode: 0o600 });
  await chmod(path, 0o600);
}

export async function writePlayerCheckpoint({
  session,
  outputDirectory,
  runId,
  status,
  playerState = null,
} = {}) {
  const hasAtomicSnapshot = typeof session?.captureSnapshot === "function";
  const hasLegacySnapshot = typeof session?.saveState === "function" &&
    typeof session?.saveSram === "function";
  if (!hasAtomicSnapshot && !hasLegacySnapshot) {
    throw new TypeError("player checkpoint requires emulator state and SRAM access");
  }
  if (typeof outputDirectory !== "string" || outputDirectory === "") {
    throw new TypeError("player checkpoint outputDirectory is required");
  }
  const safeId = safeRunId(runId);
  const snapshot = hasAtomicSnapshot
    ? await session.captureSnapshot()
    : {
        state: await session.saveState(),
        sram: await session.saveSram(),
      };
  if (!(snapshot?.state instanceof Uint8Array) ||
      !(snapshot?.sram instanceof Uint8Array)) {
    throw new Error("player checkpoint received an invalid emulator snapshot");
  }
  const state = Buffer.from(snapshot.state);
  const sram = Buffer.from(snapshot.sram);
  const stateDigest = sha256(state);
  const sramDigest = sha256(sram);
  await mkdir(outputDirectory, { recursive: true, mode: 0o700 });
  await chmod(outputDirectory, 0o700);
  const stateName = `${safeId}.${stateDigest}.state`;
  const sramName = `${safeId}.${sramDigest}.sav`;
  const controlStateName = `${stateName}.player.json`;
  const controlState = {
    schema: "master-red/player-resume-control/v1",
    runId: safeId,
    statePath: stateName,
    stateSha256: stateDigest,
    sramPath: sramName,
    sramSha256: sramDigest,
    playerState,
  };
  const controlStateBytes = Buffer.from(`${JSON.stringify(controlState, null, 2)}\n`);
  const metadata = {
    schema: "master-red/player-checkpoint/v2",
    runId: safeId,
    statePath: stateName,
    stateSha256: stateDigest,
    stateBytes: state.length,
    sramPath: sramName,
    sramSha256: sramDigest,
    sramBytes: sram.length,
    controlStatePath: controlStateName,
    controlStateSha256: sha256(controlStateBytes),
    status,
    playerState,
  };
  const metadataBytes = Buffer.from(`${JSON.stringify(metadata, null, 2)}\n`);
  const metadataName = `${safeId}.${sha256(metadataBytes)}.json`;
  const stateFilePath = join(outputDirectory, stateName);
  const sramFilePath = join(outputDirectory, sramName);
  const controlStateFilePath = join(outputDirectory, controlStateName);
  const metadataPath = join(outputDirectory, metadataName);
  const writes = await Promise.allSettled([
    writePrivate(stateFilePath, state),
    writePrivate(sramFilePath, sram),
    writePrivate(metadataPath, metadataBytes),
  ]);
  const failedWrite = writes.find(({ status }) => status === "rejected");
  if (failedWrite) throw failedWrite.reason;
  // The discoverable sidecar is the commit marker. Publish it atomically only
  // after all artifacts exist; a crash must leave the older checkpoint usable.
  const pendingControlPath = `${controlStateFilePath}.${randomUUID()}.tmp`;
  await writePrivate(pendingControlPath, controlStateBytes);
  await rename(pendingControlPath, controlStateFilePath);
  return {
    ...metadata,
    metadataPath,
    stateFilePath,
    sramFilePath,
    controlStateFilePath,
  };
}

export async function readPlayerControlState({
  statePath,
  stateSha256,
  sramSha256,
  expectedRunId = null,
} = {}) {
  if (typeof statePath !== "string" || statePath === "") {
    throw new TypeError("resume statePath is required");
  }
  let document;
  try {
    document = JSON.parse(await readFile(`${statePath}.player.json`, "utf8"));
  } catch (error) {
    if (error?.code === "ENOENT") {
      if (expectedRunId !== null) throw new Error("campaign continuation requires a matching control sidecar");
      return null;
    }
    throw error;
  }
  if (
    document?.schema !== "master-red/player-resume-control/v1" ||
    document.stateSha256 !== stateSha256 ||
    document.sramSha256 !== sramSha256 ||
    !document.playerState || typeof document.playerState !== "object"
  ) {
    throw new Error("player control sidecar does not match the supplied checkpoint");
  }
  if (expectedRunId !== null && document.runId !== expectedRunId) throw new Error("checkpoint source run does not match continuation");
  return document.playerState;
}

export async function findLatestPlayerCheckpoint({
  outputDirectory,
  runId,
} = {}) {
  if (typeof outputDirectory !== "string" || outputDirectory === "") {
    throw new TypeError("checkpoint outputDirectory is required");
  }
  const safeId = safeRunId(runId);
  let entries;
  try {
    entries = await readdir(outputDirectory, { withFileTypes: true });
  } catch (error) {
    if (error?.code === "ENOENT") return null;
    throw error;
  }
  const prefix = `${safeId}.`;
  const suffix = ".state.player.json";
  const candidates = await Promise.all(entries
    .filter((entry) => entry.isFile() &&
      entry.name.startsWith(prefix) && entry.name.endsWith(suffix))
    .map(async (entry) => {
      const controlStateFilePath = join(outputDirectory, entry.name);
      return {
        controlStateFilePath,
        name: entry.name,
        modifiedAt: (await stat(controlStateFilePath)).mtimeMs,
      };
    }));
  candidates.sort((left, right) =>
    right.modifiedAt - left.modifiedAt ||
    right.name.localeCompare(left.name)
  );
  const rejectedControlStatePaths = [];
  for (const candidate of candidates) {
    try {
      const document = JSON.parse(
        await readFile(candidate.controlStateFilePath, "utf8"),
      );
      if (
        document?.schema !== "master-red/player-resume-control/v1" ||
        document.runId !== safeId ||
        typeof document.statePath !== "string" ||
        basename(document.statePath) !== document.statePath ||
        typeof document.sramPath !== "string" ||
        basename(document.sramPath) !== document.sramPath ||
        candidate.name !== `${document.statePath}.player.json` ||
        !document.playerState || typeof document.playerState !== "object"
      ) {
        throw new Error("invalid player checkpoint control state");
      }
      const stateFilePath = join(outputDirectory, document.statePath);
      const sramFilePath = join(outputDirectory, document.sramPath);
      const [state, sram] = await Promise.all([
        readFile(stateFilePath),
        readFile(sramFilePath),
      ]);
      if (
        sha256(state) !== document.stateSha256 ||
        sha256(sram) !== document.sramSha256
      ) {
        throw new Error("player checkpoint digest mismatch");
      }
      return {
        stateFilePath,
        sramFilePath,
        controlStateFilePath: candidate.controlStateFilePath,
        stateSha256: document.stateSha256,
        sramSha256: document.sramSha256,
        playerState: document.playerState,
        modifiedAt: candidate.modifiedAt,
        rejectedControlStatePaths,
      };
    } catch {
      rejectedControlStatePaths.push(candidate.controlStateFilePath);
    }
  }
  return null;
}
