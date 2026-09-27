import assert from "node:assert/strict";
import test from "node:test";

import {
  createRealMgbaEvidence,
  runAtomicObservationQualification,
  runModalCorpusQualification,
  runScenarioTrials,
  runSnapshotRoundtripQualification,
} from "../src/evidence/qualification.js";

function observation(frame, overrides = {}) {
  const captureId = `sample-${frame}`;
  return {
    captureId,
    frame,
    phase: "stable",
    phaseReasons: [],
    emulator: { captureId, frame, mode: "overworld" },
    sram: { captureId, frame, bytes: 3, sha256: "sram" },
    playerMemory: {
      captureId,
      frame,
      sha256: `memory-${frame}`,
      map: { id: "MAP_VIRIDIAN_CITY", group: 3, number: 1 },
      position: { x: 1, y: 2 },
    },
    ...overrides,
  };
}

test("atomic qualification counts real captures and records every failed attempt", () => {
  let frame = 0;
  const session = {
    step() {
      frame += 1;
    },
  };
  const observer = {
    capture() {
      if (frame === 4) {
        return observation(frame, {
          sram: { captureId: `sample-${frame}`, frame: frame - 1, sha256: "bad" },
        });
      }
      return observation(frame);
    },
  };

  const result = runAtomicObservationQualification({
    session,
    observer,
    attempts: 6,
  });
  assert.equal(result.gateId, "atomic-observation-sampling");
  assert.equal(result.successes, 5);
  assert.equal(result.failures, 1);
  assert.equal(result.trace.length, 6);
  assert.match(result.trace[3].error.message, /atomic/i);
});

class RoundtripSession {
  constructor() {
    this.state = Uint8Array.from([0x80, 1, 2]);
    this.sram = Uint8Array.from([3, 4]);
  }

  get frame() {
    return this.state[1];
  }

  step() {
    this.state[1] += 1;
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
}

function roundtripObserver(session) {
  let ordinal = 0;
  return {
    resetHistory() {},
    capture() {
      ordinal += 1;
      const sample = observation(session.frame);
      sample.captureId = `roundtrip-${ordinal}`;
      for (const view of [sample.emulator, sample.sram, sample.playerMemory]) {
        view.captureId = sample.captureId;
      }
      sample.playerMemory.sha256 = `state-${session.state.join("-")}`;
      sample.sram.sha256 = `sram-${session.sram.join("-")}`;
      return sample;
    },
  };
}

test("snapshot qualification perturbs and exactly restores every trial", () => {
  const session = new RoundtripSession();
  const observer = roundtripObserver(session);
  const result = runSnapshotRoundtripQualification({
    session,
    observer,
    trials: 5,
    perturb({ session: subject, trial }) {
      for (let index = 0; index <= trial; index += 1) subject.step([]);
      subject.sram[0] = trial + 10;
    },
  });

  assert.equal(result.gateId, "snapshot-roundtrip");
  assert.equal(result.successes, 5);
  assert.equal(result.failures, 0);
  assert.equal(result.trace.length, 5);
  assert.ok(result.trace.every(({ stateExact }) => stateExact === true));
});

test("snapshot qualification preserves mismatch dimensions for root-cause analysis", () => {
  const session = new RoundtripSession();
  const base = roundtripObserver(session);
  let captures = 0;
  const observer = {
    resetHistory: () => base.resetHistory(),
    capture() {
      captures += 1;
      const sample = base.capture();
      if (captures === 2) sample.playerMemory.sha256 = "corrupt-after-restore";
      return sample;
    },
  };
  const result = runSnapshotRoundtripQualification({
    session,
    observer,
    trials: 1,
    perturb: () => {},
  });

  assert.equal(result.failures, 1);
  assert.deepEqual(result.trace[0].error.details, {
    stateExact: true,
    sramExact: true,
    observationExact: false,
  });
});

test("a receipt binds the real run to cartridge, core, harness, states, and trace", () => {
  const result = {
    gateId: "atomic-observation-sampling",
    successes: 10_000,
    failures: 0,
    trace: [{ attempt: 1, success: true }],
  };
  const startSnapshot = {
    frame: 10,
    stateSha256: "1".repeat(64),
    sramSha256: "2".repeat(64),
    observationSha256: "3".repeat(64),
  };
  const endSnapshot = {
    frame: 20,
    stateSha256: "4".repeat(64),
    sramSha256: "5".repeat(64),
    observationSha256: "6".repeat(64),
  };
  const identity = {
    cartridgeProfileId: "firered-rev1-stock",
    romSha1: "d".repeat(40),
    mgbaCommit: "a".repeat(40),
    mgbaWrapperCommit: "b".repeat(40),
    mgbaJsSha256: "7".repeat(64),
    mgbaWasmSha256: "8".repeat(64),
  };
  const evidence = createRealMgbaEvidence({
    collectedAt: "2026-08-29T00:00:00.000Z",
    runId: "run-123",
    result,
    identity,
    knowledgeArtifacts: [
      {
        id: "firered-runtime-symbols",
        bytes: 100,
        sha256: "a".repeat(64),
      },
      {
        id: "firered-world-structure",
        bytes: 200,
        sha256: "b".repeat(64),
      },
    ],
    harnessRevision: "9".repeat(64),
    startSnapshot,
    endSnapshot,
  });

  assert.match(evidence.artifactSha256, /^[0-9a-f]{64}$/);
  assert.equal(evidence.receipt.evidenceClass, "real-mgba");
  assert.equal(evidence.receipt.harnessRevisionKind, "source-bundle-sha256");
  assert.equal(evidence.receipt.harnessRevision, "9".repeat(64));
  assert.equal(evidence.receipt.startStateSha256, "1".repeat(64));
  assert.equal(evidence.receipt.endStateSha256, "4".repeat(64));
  assert.deepEqual(evidence.receipt.knowledgeArtifacts, [
    {
      id: "firered-runtime-symbols",
      bytes: 100,
      sha256: "a".repeat(64),
    },
    {
      id: "firered-world-structure",
      bytes: 200,
      sha256: "b".repeat(64),
    },
  ]);
  assert.equal(evidence.receipt.traceSha256, evidence.artifactSha256);
  assert.deepEqual(JSON.parse(evidence.artifactBytes), evidence.artifact);
});

test("modal evidence binds the exact private scenario suite that drove it", () => {
  const suite = {
    schema: "master-red/mgba-scenario-suite/v1",
    scenarios: [
      {
        id: "mart-entry-roundtrip",
        trials: 100,
        seed: { stateSha256: "1".repeat(64), sramSha256: "2".repeat(64) },
        steps: [{ id: "enter" }, { id: "leave" }],
      },
    ],
  };
  const result = {
    gateId: "mart-entry-roundtrip",
    scenarioId: "mart-entry-roundtrip",
    trials: 100,
    successes: 100,
    failures: 0,
    trace: [],
  };
  const snapshots = {
    startSnapshot: {
      frame: 10,
      stateSha256: "1".repeat(64),
      sramSha256: "2".repeat(64),
      observationSha256: "3".repeat(64),
    },
    endSnapshot: {
      frame: 20,
      stateSha256: "4".repeat(64),
      sramSha256: "5".repeat(64),
      observationSha256: "6".repeat(64),
    },
  };
  const evidence = createRealMgbaEvidence({
    collectedAt: "2026-08-29T00:00:00.000Z",
    runId: "mart-run-1",
    result,
    identity: {
      cartridgeProfileId: "firered-rev1-stock",
      romSha1: "d".repeat(40),
      mgbaCommit: "a".repeat(40),
      mgbaWrapperCommit: "b".repeat(40),
      mgbaJsSha256: "7".repeat(64),
      mgbaWasmSha256: "8".repeat(64),
    },
    knowledgeArtifacts: [
      { id: "firered-runtime-symbols", bytes: 100, sha256: "a".repeat(64) },
      { id: "firered-world-structure", bytes: 200, sha256: "b".repeat(64) },
    ],
    harnessRevision: "9".repeat(64),
    scenarioSuiteBytes: `${JSON.stringify(suite, null, 2)}\n`,
    ...snapshots,
  });

  assert.match(evidence.artifact.scenarioSuite.sha256, /^[0-9a-f]{64}$/);
  assert.deepEqual(evidence.artifact.scenarioSuite.scenarios, suite.scenarios);
  assert.equal(
    evidence.receipt.scenarioSuiteSha256,
    evidence.artifact.scenarioSuite.sha256,
  );
  assert.throws(
    () =>
      createRealMgbaEvidence({
        collectedAt: "2026-08-29T00:00:00.000Z",
        runId: "unbound-mart-run",
        result,
        identity: evidence.artifact.identity,
        knowledgeArtifacts: evidence.artifact.knowledgeArtifacts,
        harnessRevision: "9".repeat(64),
        ...snapshots,
      }),
    /scenario suite bytes are required/i,
  );
});

test("scenario trials reload their seed and preserve every failure", () => {
  let calls = 0;
  const result = runScenarioTrials({
    session: {},
    observer: {},
    definition: { id: "mart-entry-roundtrip", trials: 3 },
    seed: { state: new Uint8Array(), sram: new Uint8Array() },
    execute() {
      calls += 1;
      if (calls === 2) {
        const error = new Error("fixture transition failed");
        error.context = {
          scenarioId: "mart-entry-roundtrip",
          stepId: "enter",
          stage: "interrupt",
        };
        throw error;
      }
      return { success: true, interrupts: 2, finalObservation: observation(calls) };
    },
  });

  assert.equal(result.successes, 2);
  assert.equal(result.failures, 1);
  assert.equal(result.trace.length, 3);
  assert.match(result.trace[1].error.message, /transition failed/);
  assert.deepEqual(result.trace[1].error.context, {
    scenarioId: "mart-entry-roundtrip",
    stepId: "enter",
    stage: "interrupt",
  });
});

test("scenario trials execute explicit variants with their matching seeds", () => {
  const calls = [];
  const result = runScenarioTrials({
    session: {},
    observer: {},
    definition: {
      id: "cut-surf-strength",
      trials: 3,
      variants: [
        { id: "cut", precondition: { move: "cut" }, steps: [{}] },
        { id: "surf", precondition: { move: "surf" }, steps: [{}] },
        { id: "strength", precondition: { move: "strength" }, steps: [{}] },
      ],
    },
    seed: [
      { state: Uint8Array.from([1]), sram: new Uint8Array() },
      { state: Uint8Array.from([2]), sram: new Uint8Array() },
      { state: Uint8Array.from([3]), sram: new Uint8Array() },
    ],
    execute({ scenario, seed }) {
      calls.push([scenario.variantId, scenario.precondition.move, seed.state[0]]);
      return { success: true };
    },
  });

  assert.deepEqual(calls, [
    ["cut", "cut", 1],
    ["surf", "surf", 2],
    ["strength", "strength", 3],
  ]);
  assert.deepEqual(
    result.trace.map(({ variantId }) => variantId),
    ["cut", "surf", "strength"],
  );
});

test("modal qualification counts scenario classes, not their repeated traces", () => {
  const transitions = {
    scenarios: [
      { id: "one", minimumSuccessfulTraces: 1 },
      { id: "three", minimumSuccessfulTraces: 3 },
    ],
  };
  const suite = {
    schema: "master-red/mgba-scenario-suite/v1",
    scenarios: [
      { id: "one", trials: 1, seed: {}, steps: [{}] },
      { id: "three", trials: 3, seed: {}, steps: [{}] },
    ],
  };
  const result = runModalCorpusQualification({
    session: {},
    observer: {},
    transitions,
    suite,
    seedFor: () => ({ state: new Uint8Array(), sram: new Uint8Array() }),
    execute: ({ scenario }) => ({
      success: true,
      interrupts: 1,
      finalObservation: observation(scenario.id === "one" ? 1 : 3),
    }),
  });

  assert.equal(result.gateId, "modal-transition-corpus");
  assert.equal(result.successes, 2);
  assert.equal(result.failures, 0);
  assert.equal(result.totalSuccessfulTraces, 4);
});
