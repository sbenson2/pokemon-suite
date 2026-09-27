function receiptClass(receipt) {
  return receipt.evidenceClass ?? receipt.kind;
}

function allowedEvidenceClasses(gate) {
  return gate.allowedEvidence ?? [gate.evidenceClass];
}

function gatePassed(gate, receipts) {
  if (gate.status !== undefined && gate.status !== "passed") return false;

  const eligible = receipts.filter(
    (receipt) =>
      receipt.gateId === gate.id &&
      receipt.verified !== false &&
      allowedEvidenceClasses(gate).includes(receiptClass(receipt)),
  );
  if (eligible.length === 0) return false;

  const successes = eligible.reduce(
    (total, receipt) => total + (receipt.successes ?? 1),
    0,
  );
  const failures = eligible.reduce(
    (total, receipt) => total + (receipt.failures ?? 0),
    0,
  );

  return (
    successes >= (gate.targetSuccesses ?? 1) &&
    failures <= (gate.maxFailures ?? 0)
  );
}

const OBSERVATION_PHASES = new Set(["stable", "transition", "unknown"]);
const SNAPSHOT_VIEWS = ["emulator", "sram", "playerMemory"];
const CONTROL_FIELD = /(owner|lease|controller|inputwriter)/i;
const ADVISORS = new Set(["quest", "navigation", "battle", "inventory", "verifier"]);
const EXECUTABLE_INPUT_FIELD =
  /(button|keypress|inputs?|emulatorcommand|holdframes|durationframes|framecount|execute)/i;

function findControlField(value, path = "observation") {
  if (!value || typeof value !== "object") return null;

  for (const [key, child] of Object.entries(value)) {
    const childPath = `${path}.${key}`;
    if (CONTROL_FIELD.test(key.replaceAll(/[^a-z]/gi, ""))) return childPath;
    const nested = findControlField(child, childPath);
    if (nested) return nested;
  }

  return null;
}

export function assertAtomicObservation(observation) {
  if (!observation || typeof observation !== "object") {
    throw new TypeError("observation must be an object");
  }
  if (!OBSERVATION_PHASES.has(observation.phase)) {
    throw new TypeError("observation phase must be stable, transition, or unknown");
  }
  if (typeof observation.captureId !== "string" || observation.captureId === "") {
    throw new TypeError("observation needs a captureId");
  }
  if (!Number.isSafeInteger(observation.frame) || observation.frame < 0) {
    throw new TypeError("observation needs a non-negative integer frame");
  }

  const controlField = findControlField(observation);
  if (controlField) {
    throw new TypeError(`observation contains control coordination at ${controlField}`);
  }

  for (const viewName of SNAPSHOT_VIEWS) {
    const view = observation[viewName];
    if (
      !view ||
      view.captureId !== observation.captureId ||
      view.frame !== observation.frame
    ) {
      throw new TypeError(
        `observation is not atomic: ${viewName} must share its captureId and frame`,
      );
    }
  }

  return observation;
}

export function routeObservation(observation) {
  assertAtomicObservation(observation);
  if (observation.phase === "transition" || observation.phase === "unknown") {
    return { kind: "resample", reason: observation.phase };
  }
  return { kind: "advise" };
}

function findExecutableInputField(value, path = "proposal") {
  if (!value || typeof value !== "object") return null;

  for (const [key, child] of Object.entries(value)) {
    const childPath = `${path}.${key}`;
    const normalizedKey = key.replaceAll(/[^a-z]/gi, "");
    if (EXECUTABLE_INPUT_FIELD.test(normalizedKey)) return childPath;
    const nested = findExecutableInputField(child, childPath);
    if (nested) return nested;
  }

  return null;
}

export function assertAdvisorProposal(proposal) {
  if (!proposal || typeof proposal !== "object") {
    throw new TypeError("advisor proposal must be an object");
  }
  if (!ADVISORS.has(proposal.advisor)) {
    throw new TypeError("advisor must be quest, navigation, battle, inventory, or verifier");
  }
  if (typeof proposal.observationId !== "string" || proposal.observationId === "") {
    throw new TypeError("advisor proposal needs an observationId");
  }
  if (
    !proposal.recommendation ||
    typeof proposal.recommendation !== "object" ||
    typeof proposal.recommendation.kind !== "string"
  ) {
    throw new TypeError("advisor proposal needs an abstract recommendation");
  }
  if (
    typeof proposal.confidence !== "number" ||
    proposal.confidence < 0 ||
    proposal.confidence > 1
  ) {
    throw new TypeError("advisor confidence must be between 0 and 1");
  }
  for (const listName of ["constraints", "vetoes", "evidenceRefs"]) {
    if (!Array.isArray(proposal[listName])) {
      throw new TypeError(`advisor proposal ${listName} must be an array`);
    }
  }

  const executableField = findExecutableInputField(proposal);
  if (executableField) {
    throw new TypeError(
      `advisor contract is advice-only; executable input found at ${executableField}`,
    );
  }

  return proposal;
}

function fingerprintMatches(expected, candidate) {
  return (
    expected.bytes === candidate.bytes &&
    typeof candidate.sha1 === "string" &&
    expected.sha1.toLowerCase() === candidate.sha1.toLowerCase()
  );
}

export function qualifyCartridge(profile, candidate) {
  if (fingerprintMatches(profile.qualification, candidate)) {
    return {
      tier: "qualification",
      cartridgeId: profile.qualification.id,
    };
  }

  const compatibilityMatch = (profile.compatibility ?? []).find((entry) =>
    fingerprintMatches(entry, candidate),
  );
  if (compatibilityMatch) {
    return {
      tier: "compatibility-only",
      cartridgeId: compatibilityMatch.id,
    };
  }

  return { tier: "unsupported", cartridgeId: null };
}

export function evaluateFoundation({ acceptance, evidence }) {
  const gatesById = new Map(acceptance.gates.map((gate) => [gate.id, gate]));
  const receipts = evidence?.receipts ?? [];

  const unmetGateIds = acceptance.implementationGateIds.filter((gateId) => {
    const gate = gatesById.get(gateId);
    return !gate || !gatePassed(gate, receipts);
  });

  return {
    phase: unmetGateIds.length === 0 ? "implementation-ready" : "research",
    playerImplementationAllowed: unmetGateIds.length === 0,
    unmetGateIds,
  };
}
