import assert from "node:assert/strict";
import test from "node:test";

async function loadFoundation() {
  try {
    return await import("../src/foundation.js");
  } catch (error) {
    if (error?.code === "ERR_MODULE_NOT_FOUND") return {};
    throw error;
  }
}

test("incomplete real-emulator evidence keeps player implementation locked", async () => {
  const { evaluateFoundation } = await loadFoundation();

  assert.equal(
    typeof evaluateFoundation,
    "function",
    "the fresh project needs an evidence-gate evaluator",
  );

  const result = evaluateFoundation({
    acceptance: {
      implementationGateIds: ["source-lock", "atomic-sampling"],
      gates: [
        { id: "source-lock", status: "passed", evidenceClass: "artifact" },
        { id: "atomic-sampling", status: "pending", evidenceClass: "real-mgba" },
      ],
    },
    evidence: {
      receipts: [{ gateId: "source-lock", evidenceClass: "artifact" }],
    },
  });

  assert.equal(result.phase, "research");
  assert.equal(result.playerImplementationAllowed, false);
  assert.deepEqual(result.unmetGateIds, ["atomic-sampling"]);
});

test("synthetic evidence cannot satisfy a real-mgba gate", async () => {
  const { evaluateFoundation } = await loadFoundation();
  const result = evaluateFoundation({
    acceptance: {
      implementationGateIds: ["mart-roundtrip"],
      gates: [
        {
          id: "mart-roundtrip",
          targetSuccesses: 100,
          maxFailures: 0,
          allowedEvidence: ["real-mgba"],
        },
      ],
    },
    evidence: {
      receipts: [
        {
          gateId: "mart-roundtrip",
          evidenceClass: "synthetic",
          successes: 1000,
          failures: 0,
        },
      ],
    },
  });

  assert.equal(result.playerImplementationAllowed, false);
  assert.deepEqual(result.unmetGateIds, ["mart-roundtrip"]);
});
