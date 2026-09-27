import assert from "node:assert/strict";
import test from "node:test";

import {
  SnapshotMismatchError,
  canonicalizeMgbaState,
  captureCanonicalSnapshot,
  restoreSnapshot,
} from "../src/evidence/snapshot.js";

class CanonicalizingSession {
  constructor() {
    this.state = Uint8Array.from([1, 12, 30]);
    this.sram = Uint8Array.from([4, 5, 6]);
  }

  get frame() {
    return this.state[1];
  }

  saveState() {
    return this.state.slice();
  }

  loadState(bytes) {
    this.state = bytes.slice();
    this.state[0] |= 0x80;
  }

  saveSram() {
    return this.sram.slice();
  }

  loadSram(bytes) {
    this.sram = bytes.slice();
  }

  mutate() {
    this.state = Uint8Array.from([9, 99, 9]);
    this.sram = Uint8Array.from([8, 8, 8]);
  }
}

function observerFor(session, { corruptRestore = false } = {}) {
  let ordinal = 0;
  return {
    resetHistory() {},
    capture() {
      ordinal += 1;
      const frame = session.frame;
      const captureId = `capture-${ordinal}`;
      const playerDigest = corruptRestore && ordinal > 1 ? "bad" : `state-${session.state.join("-")}`;
      return {
        captureId,
        frame,
        phase: "stable",
        phaseReasons: [],
        emulator: {
          captureId,
          frame,
          platform: "gba",
          mode: "overworld",
          callback1: "CB1_Overworld",
          callback2: "CB2_Overworld",
        },
        sram: {
          captureId,
          frame,
          bytes: session.sram.length,
          sha256: `sram-${session.sram.join("-")}`,
        },
        playerMemory: {
          captureId,
          frame,
          sha256: playerDigest,
          map: { group: 3, number: 1, id: "MAP_VIRIDIAN_CITY" },
          position: { x: 12, y: 9 },
        },
      };
    },
  };
}

test("inactive GBA SIO legacy timing is canonicalized but active timing remains exact", () => {
  const inactive = new Uint8Array(0x61000);
  const inactiveView = new DataView(inactive.buffer);
  inactiveView.setInt32(0x2c4, -41002, true);
  inactiveView.setUint16(0x528, 0, true);

  const normalized = canonicalizeMgbaState(inactive);
  assert.equal(new DataView(normalized.buffer).getInt32(0x2c4, true), 0);
  assert.equal(inactiveView.getInt32(0x2c4, true), -41002, "input bytes remain immutable");

  const active = inactive.slice();
  const activeView = new DataView(active.buffer);
  activeView.setInt32(0x2c4, 556110, true);
  activeView.setUint16(0x528, 0x80, true);
  assert.deepEqual(canonicalizeMgbaState(active), active);
});

test("snapshot capture canonicalizes mGBA once and requires idempotent bytes", () => {
  const session = new CanonicalizingSession();
  const observer = observerFor(session);
  const snapshot = captureCanonicalSnapshot({ session, observer });

  assert.deepEqual(snapshot.state, Uint8Array.from([129, 12, 30]));
  assert.deepEqual(snapshot.sram, Uint8Array.from([4, 5, 6]));
  assert.match(snapshot.stateSha256, /^[0-9a-f]{64}$/);
  assert.match(snapshot.sramSha256, /^[0-9a-f]{64}$/);
  assert.match(snapshot.observationSha256, /^[0-9a-f]{64}$/);
});

test("SRAM cloning settles savedata before whole-state bytes are captured", () => {
  const session = new CanonicalizingSession();
  let firstClone = true;
  session.saveSram = function saveSram() {
    if (firstClone) {
      this.state[2] = 99;
      firstClone = false;
    }
    return this.sram.slice();
  };
  const snapshot = captureCanonicalSnapshot({
    session,
    observer: observerFor(session),
  });

  assert.deepEqual(snapshot.state, session.saveState());
  session.mutate();
  assert.equal(
    restoreSnapshot({ session, observer: observerFor(session), snapshot }).equivalent,
    true,
  );
});

test("whole state, SRAM, and player memory restore to one equivalent observation", () => {
  const session = new CanonicalizingSession();
  const observer = observerFor(session);
  const snapshot = captureCanonicalSnapshot({ session, observer });
  session.mutate();

  const result = restoreSnapshot({ session, observer, snapshot });
  assert.equal(result.equivalent, true);
  assert.equal(result.stateExact, true);
  assert.equal(result.sramExact, true);
  assert.equal(result.observationExact, true);
  assert.deepEqual(session.state, snapshot.state);
  assert.deepEqual(session.sram, snapshot.sram);
});

test("an observation mismatch fails the roundtrip instead of being hidden", () => {
  const session = new CanonicalizingSession();
  const observer = observerFor(session, { corruptRestore: true });
  const snapshot = captureCanonicalSnapshot({ session, observer });
  session.mutate();

  assert.throws(
    () => restoreSnapshot({ session, observer, snapshot }),
    (error) =>
      error instanceof SnapshotMismatchError &&
      error.details.stateExact === true &&
      error.details.sramExact === true &&
      error.details.observationExact === false,
  );
});

test("a state-byte mismatch reports bounded differing offsets", () => {
  const session = new CanonicalizingSession();
  const observer = observerFor(session);
  const snapshot = captureCanonicalSnapshot({ session, observer });
  session.mutate();
  session.loadState = function loadState(bytes) {
    this.state = bytes.slice();
    this.state[2] ^= 1;
  };

  assert.throws(
    () => restoreSnapshot({ session, observer, snapshot }),
    (error) =>
      error instanceof SnapshotMismatchError &&
      error.details.stateDiff.total === 1 &&
      error.details.stateDiff.samples[0].offset === 2 &&
      error.details.stateDiff.samples[0].expected === 30 &&
      error.details.stateDiff.samples[0].actual === 31,
  );
});

test("non-idempotent state loading is rejected during canonicalization", () => {
  const session = new CanonicalizingSession();
  session.loadState = function loadState(bytes) {
    this.state = bytes.slice();
    this.state[0] ^= 0x80;
  };

  assert.throws(
    () => captureCanonicalSnapshot({ session, observer: observerFor(session) }),
    /canonical state is not idempotent/i,
  );
});
