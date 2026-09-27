import { createHash } from "node:crypto";

export function verifyKnowledgeArtifact({ bundle, datasetId, bytes }) {
  if (!(bytes instanceof Uint8Array)) {
    throw new TypeError("knowledge artifact bytes must be a Uint8Array");
  }
  const dataset = bundle?.knowledge?.datasets?.find(
    ({ id }) => id === datasetId,
  );
  if (!dataset?.runtimeEligible || !dataset.artifact) {
    throw new Error(`${datasetId} is not a runtime-eligible knowledge artifact`);
  }
  if (bytes.length !== dataset.artifact.bytes) {
    throw new Error(`${datasetId} byte length does not match the knowledge ledger`);
  }
  const digest = createHash("sha256").update(bytes).digest("hex");
  if (digest !== dataset.artifact.sha256) {
    throw new Error(`${datasetId} digest does not match the knowledge ledger`);
  }
  return { id: datasetId, bytes: bytes.length, sha256: digest };
}
