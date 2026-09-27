// Whole-emulator checkpoints (mGBA state + native SRAM + metadata) for the
// Emerald player, plus discovery of the newest checksum-valid checkpoint.
import { createHash } from 'node:crypto';
import { chmod, mkdir, readFile, readdir, rm, stat, writeFile } from 'node:fs/promises';
import { join } from 'node:path';

function sha256(bytes) { return createHash('sha256').update(bytes).digest('hex'); }

export function safeRunId(value) {
  if (!/^[a-zA-Z0-9._-]{1,160}$/.test(value ?? '')) throw new TypeError('runId must contain only letters, digits, dot, underscore, and dash');
  return value;
}

export async function writeCheckpoint({ session, outputDirectory, runId, metadata = {}, keep = 3 }) {
  const id = safeRunId(runId);
  const state = Buffer.from(session.saveState());
  const sram = Buffer.from(session.saveSram());
  const stateSha256 = sha256(state);
  const sramSha256 = sha256(sram);
  await mkdir(outputDirectory, { recursive: true, mode: 0o700 });
  const stateName = `${id}.${stateSha256}.state`;
  const sramName = `${id}.${sramSha256}.sav`;
  const metaName = `${id}.${stateSha256}.json`;
  const meta = { schema: 'pokemon-research/emerald-checkpoint/v1', runId: id, statePath: stateName, stateSha256, stateBytes: state.length, sramPath: sramName, sramSha256, sramBytes: sram.length, createdAt: new Date().toISOString(), ...metadata };
  await writeFile(join(outputDirectory, stateName), state, { mode: 0o600 });
  await writeFile(join(outputDirectory, sramName), sram, { mode: 0o600 });
  await writeFile(join(outputDirectory, metaName), `${JSON.stringify(meta, null, 2)}\n`, { mode: 0o600 });
  await chmod(join(outputDirectory, metaName), 0o600);
  if (keep > 0) await pruneCheckpoints({ outputDirectory, runId: id, keep });
  return { ...meta, stateFilePath: join(outputDirectory, stateName), sramFilePath: join(outputDirectory, sramName), metaFilePath: join(outputDirectory, metaName) };
}

async function listCheckpoints(outputDirectory, runId) {
  let names = [];
  try { names = await readdir(outputDirectory); } catch { return []; }
  const prefix = `${runId}.`;
  const metas = [];
  for (const name of names) {
    if (!name.startsWith(prefix) || !name.endsWith('.json') || !/\.[0-9a-f]{64}\.json$/.test(name)) continue;
    try {
      const path = join(outputDirectory, name);
      const meta = JSON.parse(await readFile(path, 'utf8'));
      if (meta.runId !== runId || meta.schema !== 'pokemon-research/emerald-checkpoint/v1') continue;
      const { mtimeMs } = await stat(path);
      metas.push({ meta, path, mtimeMs });
    } catch { /* ignore unreadable metadata */ }
  }
  return metas.sort((a, b) => b.mtimeMs - a.mtimeMs);
}

export async function pruneCheckpoints({ outputDirectory, runId, keep = 3 }) {
  const metas = await listCheckpoints(outputDirectory, runId);
  for (const entry of metas.slice(keep)) {
    const referenced = metas.slice(0, keep).some(kept => kept.meta.sramPath === entry.meta.sramPath);
    await rm(entry.path, { force: true });
    await rm(join(outputDirectory, entry.meta.statePath), { force: true });
    if (!referenced) await rm(join(outputDirectory, entry.meta.sramPath), { force: true });
  }
}

export async function findLatestCheckpoint({ outputDirectory, runId }) {
  const id = safeRunId(runId);
  const rejected = [];
  for (const entry of await listCheckpoints(outputDirectory, id)) {
    try {
      const statePath = join(outputDirectory, entry.meta.statePath);
      const sramPath = join(outputDirectory, entry.meta.sramPath);
      const [state, sram] = await Promise.all([readFile(statePath), readFile(sramPath)]);
      if (sha256(state) !== entry.meta.stateSha256 || sha256(sram) !== entry.meta.sramSha256) { rejected.push(entry.path); continue; }
      return { ...entry.meta, stateFilePath: statePath, sramFilePath: sramPath, metaFilePath: entry.path, rejectedCheckpointPaths: rejected };
    } catch { rejected.push(entry.path); }
  }
  return null;
}
