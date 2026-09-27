import assert from "node:assert/strict";
import test from "node:test";

import {
  loadResearchBundle,
  validateResearchBundle,
} from "../src/research.js";

test("the checked-in research bundle passes every implementation gate", async () => {
  const bundle = await loadResearchBundle(
    new URL("../research/", import.meta.url),
  );
  const report = validateResearchBundle(bundle);

  assert.equal(report.structurallyValid, true);
  assert.deepEqual(report.errors, []);
  assert.equal(report.phase, "implementation-ready");
  assert.equal(report.playerImplementationAllowed, true);
  assert.deepEqual(report.passedGateIds, [
    "source-provenance-lock",
    "stock-rom-fingerprint",
    "knowledge-pack-generation",
    "atomic-observation-sampling",
    "snapshot-roundtrip",
    "mart-entry-roundtrip",
    "modal-transition-corpus",
  ]);
  assert.deepEqual(report.unmetGateIds, []);
  const modalReceipt = bundle.evidence.receipts.find(
    ({ gateId }) => gateId === "modal-transition-corpus",
  );
  assert.deepEqual(
    { successes: modalReceipt.successes, failures: modalReceipt.failures },
    { successes: 25, failures: 0 },
  );
  assert.match(modalReceipt.scenarioSuiteSha256, /^[0-9a-f]{64}$/u);
  assert.match(modalReceipt.traceSha256, /^[0-9a-f]{64}$/u);
});

test("the design has one worker input gate and advice-only policies", async () => {
  const { architecture } = await loadResearchBundle(
    new URL("../research/", import.meta.url),
  );

  assert.equal(architecture.status, "research-only");
  assert.equal(architecture.soleInputWriter, "worker-control-gate");
  assert.deepEqual(architecture.controlModes, {
    bot: { owner: "central-player", emulationSpeed: "configured" },
    manual: { owner: "operator", emulationSpeed: 1 },
    handoff: "fresh atomic observation before bot policy resumes",
  });
  assert.deepEqual(
    architecture.advisors.map(({ id, output }) => [id, output]),
    [
      ["quest", "advice"],
      ["navigation", "advice"],
      ["battle", "advice"],
      ["inventory", "advice"],
      ["verifier", "advice"],
    ],
  );
  assert.equal(architecture.observationDispositions.transition, "resample");
  assert.equal(architecture.observationDispositions.unknown, "resample");
});

test("all four cartridge-authoritative datasets are content-addressed and eligible", async () => {
  const { knowledge } = await loadResearchBundle(
    new URL("../research/", import.meta.url),
  );
  const primary = knowledge.datasets.filter(
    ({ priority }) => priority === "implementation-prerequisite",
  );

  assert.equal(primary.length, 4);
  assert.ok(primary.every(({ status }) => status === "generated"));
  assert.ok(primary.every(({ runtimeEligible }) => runtimeEligible === true));
  assert.ok(primary.every(({ artifact }) => /^[0-9a-f]{64}$/.test(artifact.sha256)));
  assert.ok(
    primary.every(
      ({ generator }) =>
        generator.kind === "source-bundle-sha256" &&
        /^[0-9a-f]{64}$/.test(generator.revision),
    ),
  );
});

test("artifact receipts must match the pinned ledger and cartridge", async () => {
  const bundle = await loadResearchBundle(
    new URL("../research/", import.meta.url),
  );
  const altered = structuredClone(bundle);
  altered.evidence.receipts.find(
    ({ gateId }) => gateId === "stock-rom-fingerprint",
  ).sha1 = "0000000000000000000000000000000000000000";
  altered.evidence.receipts.find(
    ({ gateId }) => gateId === "source-provenance-lock",
  ).sources[0].revision = "0000000000000000000000000000000000000000";

  const report = validateResearchBundle(altered);
  assert.equal(report.structurallyValid, false);
  assert.ok(report.errors.some((message) => /stock ROM receipt/i.test(message)));
  assert.ok(report.errors.some((message) => /source receipt/i.test(message)));
});

test("an invalid bundle can never grant permission to implement", async () => {
  const bundle = await loadResearchBundle(
    new URL("../research/", import.meta.url),
  );
  const altered = structuredClone(bundle);
  altered.architecture.soleInputWriter = "navigation";

  for (const gateId of altered.acceptance.implementationGateIds) {
    if (altered.evidence.receipts.some((receipt) => receipt.gateId === gateId)) {
      continue;
    }
    const gate = altered.acceptance.gates.find(({ id }) => id === gateId);
    altered.evidence.receipts.push({
      gateId,
      evidenceClass: gate.allowedEvidence[0],
      successes: gate.targetSuccesses,
      failures: 0,
    });
  }

  const report = validateResearchBundle(altered);
  assert.equal(report.structurallyValid, false);
  assert.equal(report.phase, "research");
  assert.equal(report.playerImplementationAllowed, false);
});

test("knowledge evidence cannot outrun generated runtime-eligible datasets", async () => {
  const bundle = await loadResearchBundle(
    new URL("../research/", import.meta.url),
  );
  const primary = bundle.knowledge.datasets.filter(
    ({ priority }) => priority === "implementation-prerequisite",
  );
  for (const dataset of primary) {
    dataset.status = "planned";
    dataset.runtimeEligible = false;
    dataset.artifact = null;
    dataset.generator = null;
  }

  const report = validateResearchBundle(bundle);
  assert.equal(report.structurallyValid, false);
  assert.ok(report.errors.some((message) => /knowledge receipt/i.test(message)));
});

test("a content-addressed generator revision can qualify knowledge artifacts", async () => {
  const bundle = await loadResearchBundle(
    new URL("../research/", import.meta.url),
  );
  const primary = bundle.knowledge.datasets.filter(
    ({ priority }) => priority === "implementation-prerequisite",
  );
  for (const [index, dataset] of primary.entries()) {
    delete dataset.evidenceCompatibleArtifacts;
    dataset.status = "generated";
    dataset.runtimeEligible = true;
    dataset.artifact = {
      sha256: index.toString(16).padStart(64, "0"),
      bytes: index + 1,
      counts: { fixture: 1 },
    };
    dataset.generator = {
      kind: "source-bundle-sha256",
      revision: "a".repeat(64),
    };
  }
  bundle.evidence.receipts = bundle.evidence.receipts.filter(
    ({ gateId, evidenceClass }) =>
      gateId !== "knowledge-pack-generation" && evidenceClass !== "real-mgba",
  );
  const qualification = bundle.cartridges.profiles.find(
    ({ qualification }) => qualification,
  );
  bundle.evidence.receipts.push({
    gateId: "knowledge-pack-generation",
    evidenceClass: "artifact-validation",
    successes: 4,
    failures: 0,
    cartridgeProfileId: qualification.id,
    privateReceiptSha256: "f".repeat(64),
    generator: {
      kind: "source-bundle-sha256",
      revision: "a".repeat(64),
    },
    source: {
      id: primary[0].sourceId,
      revision: primary[0].sourceRevision,
    },
    verifiedBuild: {
      romSha1: qualification.sha1,
      romBytes: qualification.bytes,
      symbolsSha256: "e".repeat(64),
    },
    datasets: primary.map((dataset) => ({
      id: dataset.id,
      artifactSha256: dataset.artifact.sha256,
      bytes: dataset.artifact.bytes,
      counts: dataset.artifact.counts,
      generatorKind: dataset.generator.kind,
      generatorRevision: dataset.generator.revision,
    })),
  });

  const report = validateResearchBundle(bundle);
  assert.equal(report.structurallyValid, true, report.errors.join("\n"));
  assert.ok(report.passedGateIds.includes("knowledge-pack-generation"));
});

test("real-mgba evidence requires reproducible run identity", async () => {
  const bundle = await loadResearchBundle(
    new URL("../research/", import.meta.url),
  );
  bundle.evidence.receipts.push({
    gateId: "atomic-observation-sampling",
    evidenceClass: "real-mgba",
    successes: 10000,
    failures: 0,
  });

  const report = validateResearchBundle(bundle);
  assert.equal(report.structurallyValid, false);
  assert.ok(report.errors.some((message) => /real-mgba receipt/i.test(message)));
});

test("a content-addressed harness can identify a real-mGBA run without a Git commit", async () => {
  const bundle = await loadResearchBundle(
    new URL("../research/", import.meta.url),
  );
  const qualification = bundle.cartridges.profiles.find(
    ({ qualification: enabled }) => enabled,
  );
  const mgba = bundle.sources.sources.find(({ id }) => id === "mgba-core");
  const wrapper = bundle.sources.sources.find(
    ({ id }) => id === "mgba-wasm-wrapper",
  );
  bundle.evidence.receipts.push({
    gateId: "atomic-observation-sampling",
    evidenceClass: "real-mgba",
    successes: 10000,
    failures: 0,
    runId: "fixture-real-run",
    cartridgeProfileId: qualification.id,
    romSha1: qualification.sha1,
    mgbaCommit: mgba.revision.value,
    mgbaWrapperCommit: wrapper.revision.value,
    mgbaJsSha256: "1".repeat(64),
    mgbaWasmSha256: mgba.artifact.wasmSha256,
    knowledgeArtifacts: [
      "firered-runtime-symbols",
      "firered-world-structure",
    ].map((id) => {
      const dataset = bundle.knowledge.datasets.find((entry) => entry.id === id);
      return {
        id,
        bytes: dataset.artifact.bytes,
        sha256: dataset.artifact.sha256,
      };
    }),
    harnessRevisionKind: "source-bundle-sha256",
    harnessRevision: "2".repeat(64),
    startStateSha256: "3".repeat(64),
    endStateSha256: "4".repeat(64),
    startSramSha256: "5".repeat(64),
    endSramSha256: "6".repeat(64),
    traceSha256: "7".repeat(64),
  });

  const report = validateResearchBundle(bundle);
  assert.equal(report.structurallyValid, true, report.errors.join("\n"));
  assert.ok(report.passedGateIds.includes("atomic-observation-sampling"));

  bundle.evidence.receipts.at(-1).knowledgeArtifacts[0].sha256 = "0".repeat(64);
  const altered = validateResearchBundle(bundle);
  assert.equal(altered.structurallyValid, false);
  assert.ok(
    altered.errors.some((message) => /knowledge artifact identity/i.test(message)),
  );
});

test("historical real-mGBA receipts may bind an explicitly data-identical observer artifact", async () => {
  const bundle = await loadResearchBundle(
    new URL("../research/", import.meta.url),
  );
  const observerIds = [
    "firered-runtime-symbols",
    "firered-world-structure",
  ];
  for (const receipt of bundle.evidence.receipts.filter(
    ({ evidenceClass }) => evidenceClass === "real-mgba",
  )) {
    receipt.knowledgeArtifacts = observerIds.map((id) => {
      const dataset = bundle.knowledge.datasets.find((entry) => entry.id === id);
      return { id, bytes: dataset.artifact.bytes, sha256: dataset.artifact.sha256 };
    });
  }

  const runtime = bundle.knowledge.datasets.find(
    ({ id }) => id === "firered-runtime-symbols",
  );
  runtime.artifact.dataSha256 = "a".repeat(64);
  runtime.evidenceCompatibleArtifacts = [
    {
      sha256: "b".repeat(64),
      bytes: runtime.artifact.bytes,
      dataSha256: runtime.artifact.dataSha256,
      compatibility: "observer-data-identical",
    },
  ];
  bundle.evidence.receipts.find(
    ({ evidenceClass }) => evidenceClass === "real-mgba",
  ).knowledgeArtifacts[0].sha256 = "b".repeat(64);

  const compatible = validateResearchBundle(bundle);
  assert.equal(compatible.structurallyValid, true, compatible.errors.join("\n"));

  runtime.evidenceCompatibleArtifacts[0].dataSha256 = "c".repeat(64);
  const mismatched = validateResearchBundle(bundle);
  assert.equal(mismatched.structurallyValid, false);
  assert.ok(
    mismatched.errors.some((message) => /knowledge artifact identity/i.test(message)),
  );
});

test("modal-corpus receipts must bind the exact private scenario suite", async () => {
  const bundle = await loadResearchBundle(
    new URL("../research/", import.meta.url),
  );
  const template = structuredClone(
    bundle.evidence.receipts.find(
      ({ gateId }) => gateId === "mart-entry-roundtrip",
    ),
  );
  template.gateId = "modal-transition-corpus";
  template.runId = "fixture-modal-corpus";
  template.successes = 25;
  template.failures = 0;
  delete template.scenarioSuiteSha256;
  bundle.evidence.receipts.push(template);

  const missing = validateResearchBundle(bundle);
  assert.equal(missing.structurallyValid, false);
  assert.ok(missing.errors.some((message) => /scenario suite/i.test(message)));

  template.scenarioSuiteSha256 = "8".repeat(64);
  const bound = validateResearchBundle(bundle);
  assert.equal(bound.structurallyValid, true, bound.errors.join("\n"));
  assert.equal(bound.playerImplementationAllowed, true);
});
