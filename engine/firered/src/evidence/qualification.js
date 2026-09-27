import { createHash } from "node:crypto";

import { assertAtomicObservation } from "../foundation.js";
import {
  captureCanonicalSnapshot,
  restoreSnapshot,
} from "./snapshot.js";
import {
  executeScenario,
  validateScenarioSuite,
} from "./scenario.js";

const SHA256 = /^[0-9a-f]{64}$/;
const REQUIRED_OBSERVER_ARTIFACTS = [
  "firered-runtime-symbols",
  "firered-world-structure",
];

function stableValue(value) {
  if (Array.isArray(value)) return value.map(stableValue);
  if (!value || typeof value !== "object") return value;
  return Object.fromEntries(
    Object.entries(value)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([key, child]) => [key, stableValue(child)]),
  );
}

export function stableJson(value) {
  return `${JSON.stringify(stableValue(value), null, 2)}\n`;
}

function sha256(bytes) {
  return createHash("sha256").update(bytes).digest("hex");
}

function errorRecord(error) {
  const record = {
    name: error?.name ?? "Error",
    code: error?.code ?? null,
    message: error?.message ?? String(error),
  };
  if (error?.details && typeof error.details === "object") {
    record.details = {
      stateExact: error.details.stateExact,
      sramExact: error.details.sramExact,
      observationExact: error.details.observationExact,
      ...(error.details.stateDiff ? { stateDiff: structuredClone(error.details.stateDiff) } : {}),
      ...(error.details.sramDiff ? { sramDiff: structuredClone(error.details.sramDiff) } : {}),
    };
    record.expected = error.details.expected;
    record.actual = error.details.actual;
  }
  if (error?.context && typeof error.context === "object") {
    record.context = structuredClone(error.context);
  }
  return record;
}

function observationRecord(observation) {
  return {
    captureId: observation.captureId,
    frame: observation.frame,
    phase: observation.phase,
    phaseReasons: observation.phaseReasons,
    mode: observation.emulator.mode,
    callback1: observation.emulator.callback1,
    callback2: observation.emulator.callback2,
    map: observation.playerMemory.map,
    position: observation.playerMemory.position,
    playerMemorySha256: observation.playerMemory.sha256,
    sramSha256: observation.sram.sha256,
  };
}

export function runAtomicObservationQualification({
  session,
  observer,
  attempts,
}) {
  if (!Number.isSafeInteger(attempts) || attempts <= 0) {
    throw new TypeError("atomic observation attempts must be a positive integer");
  }
  let successes = 0;
  let failures = 0;
  const trace = [];
  const phaseCounts = { stable: 0, transition: 0, unknown: 0 };
  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    session.step([]);
    try {
      const observation = assertAtomicObservation(observer.capture());
      successes += 1;
      phaseCounts[observation.phase] += 1;
      trace.push({ attempt, success: true, observation: observationRecord(observation) });
    } catch (error) {
      failures += 1;
      trace.push({ attempt, success: false, error: errorRecord(error) });
    }
  }
  return {
    gateId: "atomic-observation-sampling",
    attempts,
    successes,
    failures,
    phaseCounts,
    trace,
  };
}

function defaultPerturb({ session, trial }) {
  const buttons = [[], ["a"], ["b"], ["start"], ["up"], ["right"]];
  const frames = (trial % 7) + 1;
  for (let index = 0; index < frames; index += 1) {
    session.step(buttons[(trial + index) % buttons.length]);
  }
}

export function runSnapshotRoundtripQualification({
  session,
  observer,
  trials,
  perturb = defaultPerturb,
}) {
  if (!Number.isSafeInteger(trials) || trials <= 0) {
    throw new TypeError("snapshot trials must be a positive integer");
  }
  let successes = 0;
  let failures = 0;
  const trace = [];
  for (let trial = 0; trial < trials; trial += 1) {
    try {
      const snapshot = captureCanonicalSnapshot({ session, observer });
      perturb({ session, observer, trial });
      const restored = restoreSnapshot({ session, observer, snapshot });
      successes += 1;
      trace.push({
        trial: trial + 1,
        success: true,
        frame: snapshot.frame,
        stateSha256: snapshot.stateSha256,
        sramSha256: snapshot.sramSha256,
        observationSha256: snapshot.observationSha256,
        stateExact: restored.stateExact,
        sramExact: restored.sramExact,
        observationExact: restored.observationExact,
      });
    } catch (error) {
      failures += 1;
      trace.push({ trial: trial + 1, success: false, error: errorRecord(error) });
    }
  }
  return {
    gateId: "snapshot-roundtrip",
    trials,
    successes,
    failures,
    trace,
  };
}

export function runScenarioTrials({
  session,
  observer,
  definition,
  seed,
  execute = executeScenario,
}) {
  if (!Number.isSafeInteger(definition?.trials) || definition.trials <= 0) {
    throw new TypeError("scenario trials must be a positive integer");
  }
  let successes = 0;
  let failures = 0;
  const trace = [];
  for (let trial = 1; trial <= definition.trials; trial += 1) {
    const variantIndex = Array.isArray(definition.variants)
      ? (trial - 1) % definition.variants.length
      : null;
    const variant = variantIndex === null
      ? null
      : definition.variants[variantIndex];
    const trialDefinition = variant
      ? (() => {
          const { variants: _variants, ...base } = definition;
          return {
            ...base,
            ...variant,
            id: definition.id,
            variantId: variant.id,
          };
        })()
      : definition;
    const trialSeed = variant
      ? Array.isArray(seed)
        ? seed[variantIndex]
        : seed?.[variant.id]
      : seed;
    try {
      const outcome = execute({
        session,
        observer,
        scenario: trialDefinition,
        seed: trialSeed,
      });
      successes += 1;
      trace.push({
        trial,
        ...(variant ? { variantId: variant.id } : {}),
        success: true,
        outcome,
      });
    } catch (error) {
      failures += 1;
      trace.push({
        trial,
        ...(variant ? { variantId: variant.id } : {}),
        success: false,
        error: errorRecord(error),
      });
    }
  }
  return {
    gateId: definition.id,
    scenarioId: definition.id,
    trials: definition.trials,
    successes,
    failures,
    trace,
  };
}

export function runModalCorpusQualification({
  session,
  observer,
  transitions,
  suite,
  seedFor,
  execute = executeScenario,
}) {
  validateScenarioSuite({ transitions, suite });
  let successes = 0;
  let failures = 0;
  let totalSuccessfulTraces = 0;
  const trace = [];
  for (const definition of suite.scenarios) {
    const result = runScenarioTrials({
      session,
      observer,
      definition,
      seed: seedFor(definition),
      execute,
    });
    const passed =
      result.failures === 0 && result.successes === definition.trials;
    if (passed) successes += 1;
    failures += result.failures;
    totalSuccessfulTraces += result.successes;
    trace.push({ ...result, scenarioPassed: passed });
  }
  return {
    gateId: "modal-transition-corpus",
    scenarios: suite.scenarios.length,
    successes,
    failures,
    totalSuccessfulTraces,
    trace,
  };
}

function snapshotRecord(snapshot) {
  return {
    frame: snapshot.frame,
    stateSha256: snapshot.stateSha256,
    sramSha256: snapshot.sramSha256,
    observationSha256: snapshot.observationSha256,
  };
}

function scenarioSuiteRecord(bytes) {
  if (typeof bytes !== "string" && !(bytes instanceof Uint8Array)) {
    throw new TypeError("scenario suite bytes are required");
  }
  const buffer = Buffer.from(bytes);
  const suite = JSON.parse(buffer.toString("utf8"));
  if (suite?.schema !== "master-red/mgba-scenario-suite/v1") {
    throw new Error("mGBA scenario suite schema is invalid");
  }
  if (!Array.isArray(suite.scenarios) || suite.scenarios.length === 0) {
    throw new Error("mGBA scenario suite has no scenarios");
  }
  return {
    schema: suite.schema,
    bytes: buffer.length,
    sha256: sha256(buffer),
    scenarios: structuredClone(suite.scenarios),
  };
}

function canonicalKnowledgeArtifacts(artifacts) {
  if (!Array.isArray(artifacts)) {
    throw new TypeError("real-mGBA evidence requires observer knowledge artifacts");
  }
  const byId = new Map(artifacts.map((artifact) => [artifact?.id, artifact]));
  if (
    byId.size !== REQUIRED_OBSERVER_ARTIFACTS.length ||
    REQUIRED_OBSERVER_ARTIFACTS.some((id) => !byId.has(id))
  ) {
    throw new TypeError("real-mGBA observer knowledge artifact set is incomplete");
  }
  return REQUIRED_OBSERVER_ARTIFACTS.map((id) => {
    const artifact = byId.get(id);
    if (
      !Number.isSafeInteger(artifact.bytes) ||
      artifact.bytes <= 0 ||
      !SHA256.test(artifact.sha256 ?? "")
    ) {
      throw new TypeError(`${id}: observer knowledge artifact identity is invalid`);
    }
    return { id, bytes: artifact.bytes, sha256: artifact.sha256 };
  });
}

export function createRealMgbaEvidence({
  collectedAt,
  runId,
  result,
  identity,
  knowledgeArtifacts,
  harnessRevision,
  startSnapshot,
  endSnapshot,
  scenarioSuiteBytes,
}) {
  if (typeof runId !== "string" || runId === "") {
    throw new TypeError("real-mGBA runId is required");
  }
  if (!SHA256.test(harnessRevision ?? "")) {
    throw new TypeError("harness revision must be a source-bundle SHA-256");
  }
  const observerKnowledge = canonicalKnowledgeArtifacts(knowledgeArtifacts);
  const needsScenarioSuite = [
    "mart-entry-roundtrip",
    "modal-transition-corpus",
  ].includes(result?.gateId);
  if (needsScenarioSuite && scenarioSuiteBytes === undefined) {
    throw new TypeError("scenario suite bytes are required for transition evidence");
  }
  const scenarioSuite =
    scenarioSuiteBytes === undefined
      ? null
      : scenarioSuiteRecord(scenarioSuiteBytes);
  const artifact = {
    schema: "master-red/real-mgba-run/v1",
    evidenceClass: "real-mgba",
    runId,
    collectedAt,
    gateId: result.gateId,
    harness: {
      kind: "source-bundle-sha256",
      revision: harnessRevision,
    },
    identity: { ...identity },
    knowledgeArtifacts: observerKnowledge,
    ...(scenarioSuite === null ? {} : { scenarioSuite }),
    start: snapshotRecord(startSnapshot),
    end: snapshotRecord(endSnapshot),
    result,
  };
  const artifactBytes = stableJson(artifact);
  const artifactSha256 = sha256(Buffer.from(artifactBytes));
  const receipt = {
    gateId: result.gateId,
    evidenceClass: "real-mgba",
    successes: result.successes,
    failures: result.failures,
    collectedAt,
    runId,
    cartridgeProfileId: identity.cartridgeProfileId,
    romSha1: identity.romSha1,
    mgbaCommit: identity.mgbaCommit,
    mgbaWrapperCommit: identity.mgbaWrapperCommit,
    mgbaJsSha256: identity.mgbaJsSha256,
    mgbaWasmSha256: identity.mgbaWasmSha256,
    knowledgeArtifacts: observerKnowledge,
    harnessRevisionKind: "source-bundle-sha256",
    harnessRevision,
    startStateSha256: startSnapshot.stateSha256,
    endStateSha256: endSnapshot.stateSha256,
    startSramSha256: startSnapshot.sramSha256,
    endSramSha256: endSnapshot.sramSha256,
    traceSha256: artifactSha256,
    ...(scenarioSuite === null
      ? {}
      : { scenarioSuiteSha256: scenarioSuite.sha256 }),
  };
  return { artifact, artifactBytes, artifactSha256, receipt };
}

export function createRealMgbaScenarioDiagnostic({
  collectedAt,
  runId,
  result,
  minimumSuccessfulTraces,
  definition,
  scenarioSuiteBytes,
  identity,
  knowledgeArtifacts,
  harnessRevision,
  startSnapshot,
  endSnapshot,
}) {
  if (typeof runId !== "string" || runId === "") {
    throw new TypeError("real-mGBA diagnostic runId is required");
  }
  if (!SHA256.test(harnessRevision ?? "")) {
    throw new TypeError("harness revision must be a source-bundle SHA-256");
  }
  if (
    !Number.isSafeInteger(minimumSuccessfulTraces) ||
    minimumSuccessfulTraces <= 0
  ) {
    throw new TypeError("scenario minimumSuccessfulTraces must be positive");
  }
  const scenarioId = result?.scenarioId ?? result?.gateId;
  if (typeof scenarioId !== "string" || scenarioId === "") {
    throw new TypeError("diagnostic result must identify its scenario");
  }
  if (definition?.id !== scenarioId) {
    throw new TypeError("diagnostic definition must match its scenario result");
  }
  const definitionBytes = stableJson(definition);
  const artifact = {
    schema: "master-red/real-mgba-scenario-diagnostic/v1",
    evidenceClass: "real-mgba-diagnostic",
    runId,
    collectedAt,
    promotion: {
      allowed: false,
      reason: "single-scenario development traces cannot satisfy public gates",
    },
    scenario: {
      id: scenarioId,
      trials: result.trials,
      minimumSuccessfulTraces,
      definitionSha256: sha256(Buffer.from(definitionBytes)),
      definition: structuredClone(definition),
    },
    scenarioSuite: scenarioSuiteRecord(scenarioSuiteBytes),
    harness: {
      kind: "source-bundle-sha256",
      revision: harnessRevision,
    },
    identity: { ...identity },
    knowledgeArtifacts: canonicalKnowledgeArtifacts(knowledgeArtifacts),
    start: snapshotRecord(startSnapshot),
    end: snapshotRecord(endSnapshot),
    result,
  };
  const artifactBytes = stableJson(artifact);
  const artifactSha256 = sha256(Buffer.from(artifactBytes));
  return { artifact, artifactBytes, artifactSha256 };
}
