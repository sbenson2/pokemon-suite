import { createHash } from "node:crypto";

function sha256(bytes) {
  return createHash("sha256").update(bytes).digest("hex");
}

const GBA_STATE_BYTES = 0x61000;
const GBA_SIO_NEXT_EVENT_OFFSET = 0x2c4;
const GBA_IO_OFFSET = 0x400;
const GBA_SIOCNT_OFFSET = GBA_IO_OFFSET + 0x128;
const GBA_SIOCNT_ACTIVE = 0x80;

export function canonicalizeMgbaState(bytes) {
  if (!(bytes instanceof Uint8Array)) {
    throw new TypeError("mGBA state must be a Uint8Array");
  }
  const canonical = bytes.slice();
  if (canonical.length !== GBA_STATE_BYTES) return canonical;
  const view = new DataView(canonical.buffer, canonical.byteOffset, canonical.byteLength);
  const sioControl = view.getUint16(GBA_SIOCNT_OFFSET, true);
  if ((sioControl & GBA_SIOCNT_ACTIVE) === 0) {
    // Pinned mGBA serializes a legacy SIO completion timestamp even while no
    // transfer is active, then intentionally ignores it during deserialization.
    // It is therefore dead state whose value drifts with the timing clock.
    view.setUint32(GBA_SIO_NEXT_EVENT_OFFSET, 0, true);
  }
  return canonical;
}

function bytesEqual(left, right) {
  return (
    left instanceof Uint8Array &&
    right instanceof Uint8Array &&
    left.length === right.length &&
    left.every((value, index) => value === right[index])
  );
}

function byteDiff(left, right, sampleLimit = 16) {
  const samples = [];
  let total = 0;
  const bytes = Math.max(left?.length ?? 0, right?.length ?? 0);
  for (let offset = 0; offset < bytes; offset += 1) {
    const expected = left?.[offset] ?? null;
    const actual = right?.[offset] ?? null;
    if (expected === actual) continue;
    total += 1;
    if (samples.length < sampleLimit) samples.push({ offset, expected, actual });
  }
  return { total, expectedBytes: left?.length ?? 0, actualBytes: right?.length ?? 0, samples };
}

function normalizedObservation(value) {
  if (Array.isArray(value)) return value.map(normalizedObservation);
  if (!value || typeof value !== "object") return value;
  return Object.fromEntries(
    Object.entries(value)
      .filter(([key]) => key !== "captureId")
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([key, child]) => [key, normalizedObservation(child)]),
  );
}

export function observationFingerprint(observation) {
  return sha256(
    Buffer.from(JSON.stringify(normalizedObservation(observation))),
  );
}

export class SnapshotMismatchError extends Error {
  constructor(details) {
    super("whole-emulator snapshot did not restore equivalent state");
    this.name = "SnapshotMismatchError";
    this.code = "SNAPSHOT_MISMATCH";
    this.details = details;
  }
}

function canonicalState(session) {
  const rawState = canonicalizeMgbaState(session.saveState());
  session.loadState(rawState);
  const canonical = canonicalizeMgbaState(session.saveState());
  session.loadState(canonical);
  const verification = canonicalizeMgbaState(session.saveState());
  if (!bytesEqual(canonical, verification)) {
    throw new Error("mGBA canonical state is not idempotent after two loads");
  }
  return canonical;
}

export function captureCanonicalSnapshot({ session, observer }) {
  let state = null;
  let sram = null;
  for (let attempt = 0; attempt < 4; attempt += 1) {
    // mGBA's savedataClone may settle pending savedata bookkeeping. Settle it
    // before serializing, then require a second clone to leave state untouched.
    sram = session.saveSram();
    state = canonicalState(session);
    sram = session.saveSram();
    if (bytesEqual(state, canonicalizeMgbaState(session.saveState()))) break;
    state = null;
  }
  if (!state) {
    throw new Error("mGBA SRAM and whole-state capture did not reach a fixed point");
  }

  observer.resetHistory?.();
  const observation = observer.capture();
  if (!bytesEqual(state, canonicalizeMgbaState(session.saveState()))) {
    throw new Error("atomic observer changed whole-emulator state after capture");
  }
  return {
    state,
    sram,
    observation,
    frame: observation.frame,
    stateSha256: sha256(state),
    sramSha256: sha256(sram),
    observationSha256: observationFingerprint(observation),
  };
}

export function restoreSnapshot({ session, observer, snapshot }) {
  if (snapshot.sram.length > 0) session.loadSram(snapshot.sram);
  session.loadState(snapshot.state);

  const restoredState = canonicalizeMgbaState(session.saveState());
  const restoredSram = session.saveSram();
  observer.resetHistory?.();
  const observation = observer.capture();
  const details = {
    stateExact: bytesEqual(snapshot.state, restoredState),
    sramExact: bytesEqual(snapshot.sram, restoredSram),
    observationExact:
      snapshot.observationSha256 === observationFingerprint(observation),
    expected: {
      stateSha256: snapshot.stateSha256,
      sramSha256: snapshot.sramSha256,
      observationSha256: snapshot.observationSha256,
    },
    actual: {
      stateSha256: sha256(restoredState),
      sramSha256: sha256(restoredSram),
      observationSha256: observationFingerprint(observation),
    },
  };
  if (!details.stateExact) details.stateDiff = byteDiff(snapshot.state, restoredState);
  if (!details.sramExact) details.sramDiff = byteDiff(snapshot.sram, restoredSram);
  details.equivalent =
    details.stateExact && details.sramExact && details.observationExact;
  if (!details.equivalent) throw new SnapshotMismatchError(details);
  return { ...details, observation };
}
