import { readFile } from "node:fs/promises";

import { evaluateFoundation } from "./foundation.js";

const RESEARCH_FILES = {
  acceptance: "acceptance.json",
  architecture: "architecture.json",
  cartridges: "cartridges.json",
  evidence: "evidence.json",
  knowledge: "knowledge.json",
  sources: "sources.json",
  transitions: "transitions.json",
};

const COMMIT = /^[0-9a-f]{40}$/;
const SHA1 = /^[0-9a-f]{40}$/;
const SHA256 = /^[0-9a-f]{64}$/;

export async function loadResearchBundle(baseUrl) {
  const entries = await Promise.all(
    Object.entries(RESEARCH_FILES).map(async ([name, filename]) => {
      const text = await readFile(new URL(filename, baseUrl), "utf8");
      return [name, JSON.parse(text)];
    }),
  );
  return Object.fromEntries(entries);
}

function check(errors, condition, message) {
  if (!condition) errors.push(message);
}

function idsAreUnique(entries) {
  const ids = entries.map(({ id }) => id);
  return ids.every(Boolean) && new Set(ids).size === ids.length;
}

function jsonEqual(left, right) {
  return JSON.stringify(left) === JSON.stringify(right);
}

function validateArchitecture(architecture, errors) {
  check(errors, architecture?.schema === "master-red/architecture/v1", "architecture schema is invalid");
  check(errors, architecture?.status === "research-only", "architecture must remain research-only");
  check(
    errors,
    architecture?.soleInputWriter === "worker-control-gate",
    "the worker control gate must be the sole input writer",
  );
  check(
    errors,
    architecture?.controlModes?.bot?.owner === "central-player" &&
      architecture?.controlModes?.manual?.owner === "operator" &&
      architecture?.controlModes?.manual?.emulationSpeed === 1,
    "bot and manual control ownership must be exclusive and explicit",
  );
  check(errors, Array.isArray(architecture?.advisors), "architecture advisors are missing");

  const advisors = architecture?.advisors ?? [];
  check(errors, idsAreUnique(advisors), "advisor ids must be present and unique");
  check(errors, advisors.length === 5, "architecture must define five advisors");
  check(errors, advisors.every(({ output }) => output === "advice"), "all advisor output must be advice-only");
  check(errors, architecture?.observationDispositions?.transition === "resample", "transition observations must resample");
  check(errors, architecture?.observationDispositions?.unknown === "resample", "unknown observations must resample");
}

function validateSources(sourcesDocument, errors) {
  const sources = sourcesDocument?.sources ?? [];
  check(errors, sourcesDocument?.schema === "master-red/source-ledger/v1", "source ledger schema is invalid");
  check(errors, sources.length > 0 && idsAreUnique(sources), "source ids must be present and unique");

  for (const source of sources) {
    check(errors, typeof source.url === "string" && source.url.startsWith("https://"), `${source.id}: source URL must be HTTPS`);
    check(errors, Boolean(source.license?.status), `${source.id}: license review status is missing`);
    if (source.intakeStatus === "approved") {
      check(errors, source.revision?.kind === "commit" && COMMIT.test(source.revision?.value ?? ""), `${source.id}: approved source needs an immutable commit`);
      check(errors, !["unreviewed", "not-applicable"].includes(source.license?.status), `${source.id}: approved source needs a license decision`);
      check(errors, Boolean(source.license?.spdx || source.license?.decision), `${source.id}: approved source needs an SPDX id or written decision`);
    }
  }

  return sources;
}

function validateCartridges(cartridges, sourcesById, errors) {
  const profiles = cartridges?.profiles ?? [];
  check(errors, cartridges?.schema === "master-red/cartridges/v1", "cartridge schema is invalid");
  check(errors, profiles.length > 0 && idsAreUnique(profiles), "cartridge ids must be present and unique");

  const qualificationProfiles = profiles.filter(({ qualification }) => qualification === true);
  check(errors, qualificationProfiles.length === 1, "there must be exactly one qualification cartridge");
  const qualification = profiles.find(({ id }) => id === cartridges?.qualificationProfileId);
  check(errors, qualification?.qualification === true, "qualificationProfileId must point to the qualification cartridge");
  check(errors, qualification?.relationship === "stock", "qualification cartridge must be stock");
  check(errors, SHA1.test(qualification?.sha1 ?? ""), "qualification cartridge SHA-1 is invalid");
  check(errors, Number.isSafeInteger(qualification?.bytes) && qualification.bytes > 0, "qualification cartridge byte length is invalid");
  check(errors, profiles.filter(({ relationship }) => relationship === "derived").every(({ qualification: allowed }) => allowed === false), "derived cartridges cannot qualify");

  const authority = sourcesById.get(qualification?.decompilation?.sourceId);
  check(errors, Boolean(authority), "qualification decompilation source is missing");
  check(errors, authority?.revision?.value === qualification?.decompilation?.commit, "qualification decompilation commit must match the source ledger");
}

function validateKnowledge(knowledge, sourcesById, errors) {
  const datasets = knowledge?.datasets ?? [];
  check(errors, knowledge?.schema === "master-red/knowledge/v1", "knowledge schema is invalid");
  check(errors, datasets.length > 0 && idsAreUnique(datasets), "knowledge dataset ids must be present and unique");

  const primary = datasets.filter(({ priority }) => priority === "implementation-prerequisite");
  check(errors, primary.length === 4, "exactly four cartridge-authoritative datasets are required");
  check(errors, primary.every(({ authority }) => authority === "cartridge"), "primary datasets must use cartridge authority");

  for (const dataset of datasets) {
    check(errors, sourcesById.has(dataset.sourceId), `${dataset.id}: source is absent from the ledger`);
    if (dataset.priority === "implementation-prerequisite") {
      const source = sourcesById.get(dataset.sourceId);
      check(errors, dataset.sourceRevision === source?.revision?.value, `${dataset.id}: source revision is not pinned to the ledger`);
    }
    if (dataset.runtimeEligible) {
      check(errors, dataset.status === "generated", `${dataset.id}: runtime-eligible data must be generated`);
      check(errors, SHA256.test(dataset.artifact?.sha256 ?? ""), `${dataset.id}: runtime artifact digest is missing`);
      check(errors, Number.isSafeInteger(dataset.artifact?.bytes) && dataset.artifact.bytes > 0, `${dataset.id}: runtime artifact byte length is invalid`);
      check(errors, dataset.artifact?.counts && typeof dataset.artifact.counts === "object", `${dataset.id}: runtime artifact counts are missing`);
      check(
        errors,
        (dataset.generator?.kind === "git-commit" &&
          COMMIT.test(dataset.generator?.revision ?? "")) ||
          (dataset.generator?.kind === "source-bundle-sha256" &&
            SHA256.test(dataset.generator?.revision ?? "")),
        `${dataset.id}: generator revision is not immutable`,
      );
      const compatibleArtifacts = dataset.evidenceCompatibleArtifacts ?? [];
      check(
        errors,
        Array.isArray(compatibleArtifacts),
        `${dataset.id}: evidence-compatible artifacts must be an array`,
      );
      if (compatibleArtifacts.length > 0) {
        check(
          errors,
          SHA256.test(dataset.artifact?.dataSha256 ?? ""),
          `${dataset.id}: current observer data identity is missing`,
        );
        check(
          errors,
          new Set(compatibleArtifacts.map(({ sha256 }) => sha256)).size ===
            compatibleArtifacts.length &&
            compatibleArtifacts.every(
              (artifact) =>
                SHA256.test(artifact?.sha256 ?? "") &&
                artifact.sha256 !== dataset.artifact?.sha256 &&
                Number.isSafeInteger(artifact?.bytes) &&
                artifact.bytes > 0 &&
                artifact.compatibility === "observer-data-identical" &&
                artifact.dataSha256 === dataset.artifact?.dataSha256,
            ),
          `${dataset.id}: evidence-compatible observer identity is invalid`,
        );
      }
    } else {
      check(errors, dataset.artifact === null, `${dataset.id}: ineligible data cannot expose a runtime artifact`);
    }
  }
}

function validateAcceptance(acceptance, errors) {
  const gates = acceptance?.gates ?? [];
  check(errors, acceptance?.schema === "master-red/acceptance/v1", "acceptance schema is invalid");
  check(errors, gates.length > 0 && idsAreUnique(gates), "acceptance gate ids must be present and unique");
  const gateIds = new Set(gates.map(({ id }) => id));
  check(errors, Array.isArray(acceptance?.implementationGateIds) && acceptance.implementationGateIds.length > 0, "implementation gates are missing");
  check(errors, (acceptance?.implementationGateIds ?? []).every((id) => gateIds.has(id)), "an implementation gate is not defined");

  for (const gate of gates) {
    check(errors, Number.isSafeInteger(gate.targetSuccesses) && gate.targetSuccesses > 0, `${gate.id}: targetSuccesses must be positive`);
    check(errors, Number.isSafeInteger(gate.maxFailures) && gate.maxFailures >= 0, `${gate.id}: maxFailures must be non-negative`);
    check(errors, Array.isArray(gate.allowedEvidence) && gate.allowedEvidence.length > 0, `${gate.id}: allowed evidence is missing`);
  }

  return new Map(gates.map((gate) => [gate.id, gate]));
}

function validateEvidence(
  evidence,
  gatesById,
  sourcesById,
  cartridges,
  knowledge,
  errors,
) {
  check(errors, evidence?.schema === "master-red/evidence/v1", "evidence schema is invalid");
  check(errors, Array.isArray(evidence?.receipts), "evidence receipts are missing");

  for (const receipt of evidence?.receipts ?? []) {
    const gate = gatesById.get(receipt.gateId);
    check(errors, Boolean(gate), `${receipt.gateId}: evidence refers to an unknown gate`);
    check(errors, gate?.allowedEvidence?.includes(receipt.evidenceClass), `${receipt.gateId}: evidence class is not allowed`);
    check(errors, Number.isSafeInteger(receipt.successes) && receipt.successes >= 0, `${receipt.gateId}: successes must be non-negative`);
    check(errors, Number.isSafeInteger(receipt.failures) && receipt.failures >= 0, `${receipt.gateId}: failures must be non-negative`);

    if (receipt.gateId === "source-provenance-lock") {
      const approvedSources = [...sourcesById.values()].filter(
        ({ intakeStatus }) => intakeStatus === "approved",
      );
      const receiptSources = new Map(
        (receipt.sources ?? []).map((source) => [source.id, source]),
      );
      check(
        errors,
        approvedSources.length === receiptSources.size &&
          approvedSources.every(
            (source) =>
              receiptSources.get(source.id)?.revision === source.revision.value,
          ),
        "source receipt does not match every approved ledger revision",
      );
      check(
        errors,
        SHA256.test(receipt.sourceReceiptSha256 ?? ""),
        "source receipt digest is invalid",
      );
    }

    if (receipt.gateId === "stock-rom-fingerprint") {
      const profile = cartridges.profiles.find(
        ({ id }) => id === cartridges.qualificationProfileId,
      );
      check(
        errors,
        receipt.cartridgeProfileId === profile?.id &&
          receipt.bytes === profile?.bytes &&
          receipt.sha1 === profile?.sha1,
        "stock ROM receipt does not match the qualification cartridge",
      );
    }

    if (receipt.gateId === "knowledge-pack-generation") {
      const primary = knowledge.datasets.filter(
        ({ priority }) => priority === "implementation-prerequisite",
      );
      const qualification = cartridges.profiles.find(
        ({ id }) => id === cartridges.qualificationProfileId,
      );
      const receiptDatasets = new Map(
        (receipt.datasets ?? []).map((dataset) => [dataset.id, dataset]),
      );
      check(
        errors,
        receipt.cartridgeProfileId === qualification?.id &&
          SHA256.test(receipt.privateReceiptSha256 ?? "") &&
          receipt.source?.id === primary[0]?.sourceId &&
          receipt.source?.revision === primary[0]?.sourceRevision &&
          receipt.generator?.kind === primary[0]?.generator?.kind &&
          receipt.generator?.revision === primary[0]?.generator?.revision &&
          receipt.verifiedBuild?.romSha1 === qualification?.sha1 &&
          receipt.verifiedBuild?.romBytes === qualification?.bytes &&
          SHA256.test(receipt.verifiedBuild?.symbolsSha256 ?? ""),
        "knowledge receipt lacks pinned source, generator, cartridge, or build identity",
      );
      check(
        errors,
        primary.length === 4 &&
          receipt.successes === primary.length &&
          receiptDatasets.size === primary.length &&
          primary.every((dataset) => {
            const recorded = receiptDatasets.get(dataset.id);
            return (
              dataset.status === "generated" &&
              dataset.runtimeEligible === true &&
              recorded?.artifactSha256 === dataset.artifact?.sha256 &&
              recorded?.bytes === dataset.artifact?.bytes &&
              jsonEqual(recorded?.counts, dataset.artifact?.counts) &&
              recorded?.generatorKind === dataset.generator?.kind &&
              recorded?.generatorRevision === dataset.generator?.revision
            );
          }),
        "knowledge receipt does not match four generated runtime-eligible datasets",
      );
    }

    if (receipt.evidenceClass === "real-mgba") {
      const qualification = cartridges.profiles.find(
        ({ id }) => id === cartridges.qualificationProfileId,
      );
      const mgba = sourcesById.get("mgba-core");
      const wrapper = sourcesById.get("mgba-wasm-wrapper");
      const immutableHarness =
        COMMIT.test(receipt.harnessRevision ?? "") ||
        (receipt.harnessRevisionKind === "source-bundle-sha256" &&
          SHA256.test(receipt.harnessRevision ?? ""));
      const observerDatasetIds = [
        "firered-runtime-symbols",
        "firered-world-structure",
      ];
      const observerArtifacts = new Map(
        (receipt.knowledgeArtifacts ?? []).map((artifact) => [
          artifact.id,
          artifact,
        ]),
      );
      check(
        errors,
        observerArtifacts.size === observerDatasetIds.length &&
          observerDatasetIds.every((id) => {
            const dataset = knowledge.datasets.find(
              (dataset) => dataset.id === id,
            );
            const recorded = observerArtifacts.get(id);
            const accepted = [
              dataset?.artifact,
              ...(dataset?.evidenceCompatibleArtifacts ?? []).filter(
                (artifact) =>
                  artifact.compatibility === "observer-data-identical" &&
                  artifact.dataSha256 === dataset?.artifact?.dataSha256,
              ),
            ];
            return accepted.some(
              (expected) =>
                recorded?.bytes === expected?.bytes &&
                recorded?.sha256 === expected?.sha256,
            );
          }),
        "real-mgba receipt knowledge artifact identity does not match the ledger",
      );
      check(
        errors,
        typeof receipt.runId === "string" &&
          receipt.runId.length > 0 &&
          receipt.cartridgeProfileId === qualification?.id &&
          receipt.romSha1 === qualification?.sha1 &&
          receipt.mgbaCommit === mgba?.revision?.value &&
          receipt.mgbaWrapperCommit === wrapper?.revision?.value &&
          SHA256.test(receipt.mgbaJsSha256 ?? "") &&
          receipt.mgbaWasmSha256 === mgba?.artifact?.wasmSha256 &&
          immutableHarness &&
          SHA256.test(receipt.startStateSha256 ?? "") &&
          SHA256.test(receipt.endStateSha256 ?? "") &&
          SHA256.test(receipt.startSramSha256 ?? "") &&
          SHA256.test(receipt.endSramSha256 ?? "") &&
          SHA256.test(receipt.traceSha256 ?? ""),
        "real-mgba receipt lacks reproducible run identity",
      );
      if (receipt.gateId === "modal-transition-corpus") {
        check(
          errors,
          SHA256.test(receipt.scenarioSuiteSha256 ?? ""),
          "modal-transition-corpus receipt does not bind its private scenario suite",
        );
      }
    }
  }
}

function validateTransitions(transitions, errors) {
  const scenarios = transitions?.scenarios ?? [];
  check(errors, transitions?.schema === "master-red/transitions/v1", "transition corpus schema is invalid");
  check(errors, transitions?.acceptedEvidence?.length === 1 && transitions.acceptedEvidence[0] === "real-mgba", "transition corpus must accept real-mgba evidence only");
  check(errors, scenarios.length === 25 && idsAreUnique(scenarios), "transition corpus must define 25 unique scenarios");
  check(errors, scenarios.every(({ expected }) => Array.isArray(expected) && expected.includes("interrupt")), "every transition scenario must interrupt");
}

export function validateResearchBundle(bundle) {
  const errors = [];
  validateArchitecture(bundle.architecture, errors);
  const sources = validateSources(bundle.sources, errors);
  const sourcesById = new Map(sources.map((source) => [source.id, source]));
  validateCartridges(bundle.cartridges, sourcesById, errors);
  validateKnowledge(bundle.knowledge, sourcesById, errors);
  const gatesById = validateAcceptance(bundle.acceptance, errors);
  validateEvidence(
    bundle.evidence,
    gatesById,
    sourcesById,
    bundle.cartridges,
    bundle.knowledge,
    errors,
  );
  validateTransitions(bundle.transitions, errors);

  const foundation = evaluateFoundation({
    acceptance: bundle.acceptance,
    evidence: bundle.evidence,
  });
  const unmet = new Set(foundation.unmetGateIds);

  const structurallyValid = errors.length === 0;

  return {
    structurallyValid,
    errors,
    phase: structurallyValid ? foundation.phase : "research",
    playerImplementationAllowed:
      structurallyValid && foundation.playerImplementationAllowed,
    unmetGateIds: foundation.unmetGateIds,
    passedGateIds: bundle.acceptance.implementationGateIds.filter((id) => !unmet.has(id)),
    sourceSummary: {
      total: sources.length,
      approved: sources.filter(({ intakeStatus }) => intakeStatus === "approved").length,
      researchOnly: sources.filter(({ runtimeUse }) => runtimeUse === "research-only").length,
    },
  };
}
