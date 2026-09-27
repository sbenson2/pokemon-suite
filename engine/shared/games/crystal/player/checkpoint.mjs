// Checkpoints: exact whole-mGBA state + native SRAM + player control state,
// content-addressed so a resume can prove it loads what was written.

import { createHash } from 'node:crypto';
import { chmod, mkdir, readFile, readdir, stat, writeFile } from 'node:fs/promises';
import { basename, join } from 'node:path';

const SCHEMA = 'pokemon-research/crystal-checkpoint/v1';
const CONTROL_SCHEMA = 'pokemon-research/crystal-resume-control/v1';

const sha256 = (bytes) => createHash('sha256').update(bytes).digest('hex');

function safeRunId(value) {
  if (!/^[a-zA-Z0-9._-]{1,160}$/.test(value ?? '')) throw new TypeError('checkpoint runId must be a safe identifier');
  return value;
}

async function writePrivate(path, bytes) {
  await writeFile(path, bytes, { mode: 0o600 });
  await chmod(path, 0o600);
}

export async function writeCrystalCheckpoint({ session, outputDirectory, runId, status = {}, playerState = {} } = {}) {
  if (typeof session?.saveState !== 'function' || typeof session?.saveSram !== 'function') {
    throw new TypeError('checkpoint requires emulator state and SRAM access');
  }
  if (typeof outputDirectory !== 'string' || !outputDirectory) throw new TypeError('checkpoint outputDirectory is required');
  const safeId = safeRunId(runId);
  const state = Buffer.from(session.saveState());
  const sram = Buffer.from(session.saveSram());
  const stateDigest = sha256(state);
  const sramDigest = sha256(sram);
  await mkdir(outputDirectory, { recursive: true, mode: 0o700 });
  const stateName = `${safeId}.${stateDigest}.state`;
  const sramName = `${safeId}.${sramDigest}.sav`;
  const controlName = `${stateName}.player.json`;
  const control = {
    schema: CONTROL_SCHEMA,
    runId: safeId,
    statePath: stateName,
    stateSha256: stateDigest,
    sramPath: sramName,
    sramSha256: sramDigest,
    writtenAt: new Date().toISOString(),
    frame: Number.isSafeInteger(session.frame) ? session.frame : null,
    playerState,
    status,
  };
  const controlBytes = Buffer.from(`${JSON.stringify(control, null, 2)}\n`);
  await Promise.all([
    writePrivate(join(outputDirectory, stateName), state),
    writePrivate(join(outputDirectory, sramName), sram),
    writePrivate(join(outputDirectory, controlName), controlBytes),
  ]);
  return {
    schema: SCHEMA,
    runId: safeId,
    stateFilePath: join(outputDirectory, stateName),
    sramFilePath: join(outputDirectory, sramName),
    controlFilePath: join(outputDirectory, controlName),
    stateSha256: stateDigest,
    sramSha256: sramDigest,
    stateBytes: state.length,
    sramBytes: sram.length,
  };
}

export async function findLatestCrystalCheckpoint({ outputDirectory, runId } = {}) {
  if (typeof outputDirectory !== 'string' || !outputDirectory) throw new TypeError('checkpoint outputDirectory is required');
  const safeId = safeRunId(runId);
  let entries;
  try {
    entries = await readdir(outputDirectory, { withFileTypes: true });
  } catch (error) {
    if (error?.code === 'ENOENT') return null;
    throw error;
  }
  const suffix = '.state.player.json';
  const candidates = await Promise.all(entries
    .filter((entry) => entry.isFile() && entry.name.startsWith(`${safeId}.`) && entry.name.endsWith(suffix))
    .map(async (entry) => ({ name: entry.name, path: join(outputDirectory, entry.name), modifiedAt: (await stat(join(outputDirectory, entry.name))).mtimeMs })));
  candidates.sort((left, right) => right.modifiedAt - left.modifiedAt || right.name.localeCompare(left.name));
  const rejected = [];
  for (const candidate of candidates) {
    try {
      const control = JSON.parse(await readFile(candidate.path, 'utf8'));
      if (control?.schema !== CONTROL_SCHEMA || control.runId !== safeId ||
          basename(control.statePath) !== control.statePath || basename(control.sramPath) !== control.sramPath ||
          candidate.name !== `${control.statePath}.player.json`) {
        throw new Error('invalid checkpoint control file');
      }
      const stateFilePath = join(outputDirectory, control.statePath);
      const sramFilePath = join(outputDirectory, control.sramPath);
      const [state, sram] = await Promise.all([readFile(stateFilePath), readFile(sramFilePath)]);
      if (sha256(state) !== control.stateSha256 || sha256(sram) !== control.sramSha256) throw new Error('checkpoint digest mismatch');
      return {
        stateFilePath,
        sramFilePath,
        controlFilePath: candidate.path,
        stateSha256: control.stateSha256,
        sramSha256: control.sramSha256,
        playerState: control.playerState ?? {},
        status: control.status ?? {},
        writtenAt: control.writtenAt ?? null,
        frame: control.frame ?? null,
        rejectedControlPaths: rejected,
      };
    } catch {
      rejected.push(candidate.path);
    }
  }
  return null;
}

/** Keeps the newest `keep` checkpoints for a run and returns the removed file names. */
export async function pruneCrystalCheckpoints({ outputDirectory, runId, keep = 6, remove } = {}) {
  const safeId = safeRunId(runId);
  let entries;
  try {
    entries = await readdir(outputDirectory, { withFileTypes: true });
  } catch (error) {
    if (error?.code === 'ENOENT') return [];
    throw error;
  }
  const controls = await Promise.all(entries
    .filter((entry) => entry.isFile() && entry.name.startsWith(`${safeId}.`) && entry.name.endsWith('.state.player.json'))
    .map(async (entry) => ({ name: entry.name, modifiedAt: (await stat(join(outputDirectory, entry.name))).mtimeMs })));
  controls.sort((left, right) => right.modifiedAt - left.modifiedAt);
  const readControl = async (name) => {
    try { return JSON.parse(await readFile(join(outputDirectory, name), 'utf8')); } catch { return null; }
  };
  // State and SRAM files are content-addressed, so an unchanged SRAM is shared
  // by several checkpoints; never delete a file a kept checkpoint still names.
  const retained = new Set();
  for (const control of controls.slice(0, keep)) {
    const document = await readControl(control.name);
    retained.add(control.name);
    if (document) { retained.add(document.statePath); retained.add(document.sramPath); }
  }
  const removed = [];
  for (const control of controls.slice(keep)) {
    const document = await readControl(control.name);
    if (!document) continue; // a malformed control file is left in place for inspection
    for (const name of [control.name, document.statePath, document.sramPath]) {
      if (typeof name === 'string' && basename(name) === name && !retained.has(name)) {
        try { await remove(join(outputDirectory, name)); removed.push(name); } catch { /* already gone */ }
      }
    }
  }
  return removed;
}
