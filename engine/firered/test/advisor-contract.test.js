import assert from "node:assert/strict";
import test from "node:test";

import { assertAdvisorProposal } from "../src/foundation.js";

function proposal(overrides = {}) {
  return {
    advisor: "navigation",
    observationId: "capture-42",
    recommendation: { kind: "seek-landmark", target: "viridian-mart" },
    confidence: 0.82,
    constraints: ["preserve-story-progress"],
    vetoes: [],
    evidenceRefs: ["world-graph:viridian-city"],
    ...overrides,
  };
}

test("advisors return pure proposals, never executable emulator input", () => {
  assert.doesNotThrow(() => assertAdvisorProposal(proposal()));

  assert.throws(
    () =>
      assertAdvisorProposal(
        proposal({
          recommendation: {
            kind: "seek-landmark",
            target: "viridian-mart",
            buttons: ["UP", "A"],
          },
        }),
      ),
    /advice-only/i,
  );

  assert.throws(
    () =>
      assertAdvisorProposal(
        proposal({
          recommendation: {
            kind: "seek-landmark",
            target: "viridian-mart",
            inputs: ["UP", "A"],
          },
        }),
      ),
    /advice-only/i,
  );

  assert.throws(
    () => assertAdvisorProposal(proposal({ confidence: 1.2 })),
    /confidence/i,
  );
});
