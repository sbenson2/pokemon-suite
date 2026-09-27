import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import test from "node:test";

import { verifyKnowledgeArtifact } from "../src/evidence/knowledge-artifact.js";

function fixture(bytes) {
  return {
    knowledge: {
      datasets: [
        {
          id: "firered-runtime-symbols",
          runtimeEligible: true,
          artifact: {
            bytes: bytes.length,
            sha256: createHash("sha256").update(bytes).digest("hex"),
          },
        },
      ],
    },
  };
}

test("observer knowledge bytes must match the content-addressed ledger", () => {
  const bytes = Buffer.from('{"schema":"runtime"}\n');
  assert.deepEqual(
    verifyKnowledgeArtifact({
      bundle: fixture(bytes),
      datasetId: "firered-runtime-symbols",
      bytes,
    }),
    {
      id: "firered-runtime-symbols",
      bytes: bytes.length,
      sha256: createHash("sha256").update(bytes).digest("hex"),
    },
  );

  assert.throws(
    () =>
      verifyKnowledgeArtifact({
        bundle: fixture(bytes),
        datasetId: "firered-runtime-symbols",
        bytes: Buffer.from("changed"),
      }),
    /digest|byte length/i,
  );
});
