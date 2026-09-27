import assert from "node:assert/strict";
import test from "node:test";

import * as qualification from "../src/evidence/qualification.js";
import * as scenarios from "../src/evidence/scenario.js";

const transitions = {
  scenarios: [
    { id: "mart-entry-roundtrip", minimumSuccessfulTraces: 100 },
    { id: "start-menu-open-close", minimumSuccessfulTraces: 1 },
  ],
};

const partialSuite = {
  schema: "master-red/mgba-scenario-suite/v1",
  scenarios: [
    {
      id: "mart-entry-roundtrip",
      trials: 100,
      seed: { statePath: "mart.state", sramPath: "mart.sav" },
      steps: [{ id: "enter" }],
    },
  ],
};

test("development selects one declared scenario without pretending the corpus is complete", () => {
  const selected = scenarios.selectDevelopmentScenario({
    transitions,
    suite: partialSuite,
    scenarioId: "mart-entry-roundtrip",
  });

  assert.equal(selected.definition.id, "mart-entry-roundtrip");
  assert.equal(selected.definition.trials, 1);
  assert.equal(selected.minimumSuccessfulTraces, 100);
  assert.equal(partialSuite.scenarios[0].trials, 100);
});

test("development rejects a scenario that is absent from the declared corpus", () => {
  assert.throws(
    () =>
      scenarios.selectDevelopmentScenario({
        transitions,
        suite: partialSuite,
        scenarioId: "invented-transition",
      }),
    /not declared/i,
  );
});

test("a single-scenario trace is permanently marked as non-promotable", () => {
  const result = {
    gateId: "mart-entry-roundtrip",
    scenarioId: "mart-entry-roundtrip",
    trials: 1,
    successes: 1,
    failures: 0,
    trace: [],
  };
  const diagnostic = qualification.createRealMgbaScenarioDiagnostic({
    collectedAt: "2026-08-29T00:00:00.000Z",
    runId: "scenario-diagnostic-1",
    result,
    minimumSuccessfulTraces: 100,
    definition: { ...partialSuite.scenarios[0], trials: 1 },
    scenarioSuiteBytes: `${JSON.stringify(partialSuite, null, 2)}\n`,
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
  });

  assert.equal(
    diagnostic.artifact.schema,
    "master-red/real-mgba-scenario-diagnostic/v1",
  );
  assert.equal(diagnostic.artifact.evidenceClass, "real-mgba-diagnostic");
  assert.deepEqual(diagnostic.artifact.promotion, {
    allowed: false,
    reason: "single-scenario development traces cannot satisfy public gates",
  });
  assert.equal(diagnostic.artifact.scenario.minimumSuccessfulTraces, 100);
  assert.deepEqual(diagnostic.artifact.scenario.definition, {
    ...partialSuite.scenarios[0],
    trials: 1,
  });
  assert.match(
    diagnostic.artifact.scenario.definitionSha256,
    /^[0-9a-f]{64}$/,
  );
  assert.equal(
    diagnostic.artifact.scenarioSuite.schema,
    "master-red/mgba-scenario-suite/v1",
  );
  assert.match(diagnostic.artifact.scenarioSuite.sha256, /^[0-9a-f]{64}$/);
  assert.equal("receipt" in diagnostic, false);
  assert.match(diagnostic.artifactSha256, /^[0-9a-f]{64}$/);
  assert.deepEqual(JSON.parse(diagnostic.artifactBytes), diagnostic.artifact);
});
