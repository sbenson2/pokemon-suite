import { randomUUID } from "node:crypto";
import { lstat, open, readFile, readdir, rename, unlink, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";

export const DEFAULT_JOURNAL_RETENTION = Object.freeze({
  segmentBytes: 16 * 1024 * 1024,
  maxBytes: 128 * 1024 * 1024,
  closedRunMaxBytes: 1024 * 1024 * 1024,
});

async function publish(path, state) {
  const temporary = `${path}.${randomUUID()}.tmp`;
  await writeFile(temporary, `${JSON.stringify(state, null, 2)}\n`, { mode: 0o600 });
  await rename(temporary, path);
}

async function pruneClosedRunJournals(runDirectory, maxBytes) {
  const sessionsDirectory = join(runDirectory, "sessions");
  const entries = await readdir(sessionsDirectory, { withFileTypes: true });
  const sessions = [];
  for (const entry of entries) {
    if (!entry.isDirectory()) continue; // Never follow a symlink out of this run.
    const directory = join(sessionsDirectory, entry.name);
    const path = join(directory, "journal.retention.json");
    let state;
    try {
      if (!(await lstat(path)).isFile()) continue;
      state = JSON.parse(await readFile(path, "utf8"));
    } catch (error) {
      if (error.code === "ENOENT" || error instanceof SyntaxError) continue;
      throw error;
    }
    if (state.schema !== "master-red/journal-retention/v1" || state.closed !== true ||
        !Array.isArray(state.segments) || state.segments.some((segment) =>
          !/^decisions(?:\.\d{8})?\.jsonl\.gz$/.test(segment.path) ||
          !Number.isSafeInteger(segment.bytes) || segment.bytes < 0 ||
          !Number.isSafeInteger(segment.events) || segment.events < 0)) continue;
    sessions.push({ directory, path, state });
  }
  sessions.sort((left, right) => String(left.state.createdAt).localeCompare(String(right.state.createdAt)) ||
    left.path.localeCompare(right.path));
  let total = sessions.reduce((sum, session) => sum + session.state.segments.reduce((bytes, segment) => bytes + segment.bytes, 0), 0);
  for (const session of sessions) {
    let changed = false;
    while (total > maxBytes && session.state.segments.length) {
      const segment = session.state.segments[0];
      const path = join(session.directory, segment.path);
      try {
        if (!(await lstat(path)).isFile()) break;
        await unlink(path);
      } catch (error) { if (error.code !== "ENOENT") throw error; }
      session.state.segments.shift();
      session.state.prunedEvents += segment.events;
      session.state.prunedBytes += segment.bytes;
      total -= segment.bytes;
      changed = true;
    }
    if (changed) await publish(session.path, session.state);
  }
}

// Rotate only between complete gzip members. Never touch saves, bundles,
// manual-recovery examples, or journals created before this retention policy.
export async function createBoundedJournal(path, options = {}) {
  const policy = { ...DEFAULT_JOURNAL_RETENTION, ...options };
  for (const [key, value] of Object.entries(policy)) {
    if (!Number.isSafeInteger(value) || value <= 0) throw new TypeError(`invalid journal ${key}`);
  }
  if (policy.segmentBytes > policy.maxBytes) throw new TypeError("journal segment exceeds session limit");
  const directory = dirname(path);
  const retentionPath = join(directory, "journal.retention.json");
  const runDirectory = dirname(dirname(directory));
  await pruneClosedRunJournals(runDirectory, policy.closedRunMaxBytes);
  let file = await open(path, "wx", 0o600);
  let serial = 0;
  let current = { path: "decisions.jsonl.gz", bytes: 0, events: 0 };
  const state = {
    schema: "master-red/journal-retention/v1", policy, closed: false,
    createdAt: new Date().toISOString(), segments: [current], prunedEvents: 0, prunedBytes: 0,
  };
  await publish(retentionPath, state);
  async function persist() { await file.sync(); await publish(retentionPath, state); }
  return Object.freeze({
    async write(bytes) {
      if (state.closed) throw new Error("journal is closed");
      if (bytes.length > policy.maxBytes) throw new Error("one diagnostic event exceeds the journal limit");
      if (current.bytes > 0 && current.bytes + bytes.length > policy.segmentBytes) {
        await file.sync();
        await file.close();
        const segmentName = `decisions.${String(++serial).padStart(8, "0")}.jsonl.gz`;
        await rename(path, join(directory, segmentName));
        current.path = segmentName;
        current = { path: "decisions.jsonl.gz", bytes: 0, events: 0 };
        state.segments.push(current);
        file = await open(path, "wx", 0o600);
      }
      await file.writeFile(bytes);
      current.bytes += bytes.length;
      current.events += 1;
      let total = state.segments.reduce((sum, segment) => sum + segment.bytes, 0);
      let pruned = false;
      while (total > policy.maxBytes && state.segments.length > 1) {
        const segment = state.segments[0];
        await unlink(join(directory, segment.path));
        state.segments.shift();
        state.prunedEvents += segment.events;
        state.prunedBytes += segment.bytes;
        total -= segment.bytes;
        pruned = true;
      }
      // Metadata is refreshed at rotations/prunes and snapshot/close boundaries.
      if (current.events === 1 || pruned) await persist();
    },
    sync: persist,
    async close() {
      if (state.closed) return;
      state.closed = true;
      await persist();
      await file.close();
      await pruneClosedRunJournals(runDirectory, policy.closedRunMaxBytes);
    },
    status: () => ({ path: retentionPath, policy, prunedEvents: state.prunedEvents,
      prunedBytes: state.prunedBytes, retainedBytes: state.segments.reduce((sum, segment) => sum + segment.bytes, 0) }),
  });
}
