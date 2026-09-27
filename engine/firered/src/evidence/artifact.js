import { createHash, randomUUID } from "node:crypto";
import {
  chmod,
  mkdir,
  readFile,
  readdir,
  rename,
  writeFile,
} from "node:fs/promises";
import { dirname, join, relative } from "node:path";

const SHA256 = /^[0-9a-f]{64}$/;

async function javascriptFiles(directory) {
  const entries = await readdir(directory, { withFileTypes: true });
  const files = [];
  for (const entry of entries) {
    const path = join(directory, entry.name);
    if (entry.isDirectory()) files.push(...(await javascriptFiles(path)));
    if (entry.isFile() && entry.name.endsWith(".js")) files.push(path);
  }
  return files;
}

export async function computeHarnessRevision(root) {
  const files = [
    ...(await javascriptFiles(join(root, "src", "emulator"))),
    ...(await javascriptFiles(join(root, "src", "evidence"))),
    ...(await javascriptFiles(join(root, "src", "cli"))),
    join(root, "research", "acceptance.json"),
    join(root, "research", "architecture.json"),
    join(root, "research", "cartridges.json"),
    join(root, "research", "knowledge.json"),
    join(root, "research", "sources.json"),
    join(root, "research", "transitions.json"),
  ].sort((left, right) => left.localeCompare(right));
  const hash = createHash("sha256");
  for (const filename of files) {
    const bytes = await readFile(filename);
    const name = relative(root, filename).replaceAll("\\", "/");
    hash.update(`${name}\0${bytes.length}\0`);
    hash.update(bytes);
    hash.update("\0");
  }
  return hash.digest("hex");
}

function safeToken(value) {
  const token = String(value)
    .replaceAll(/[^a-zA-Z0-9._-]+/g, "-")
    .replaceAll(/^-+|-+$/g, "");
  if (!token) throw new TypeError("artifact identifier is empty after sanitization");
  return token;
}

export async function writePrivateRunArtifact({
  directory,
  gateId,
  runId,
  artifactBytes,
  artifactSha256,
}) {
  const actualSha256 = createHash("sha256")
    .update(artifactBytes)
    .digest("hex");
  if (!SHA256.test(artifactSha256 ?? "") || actualSha256 !== artifactSha256) {
    throw new Error("run artifact digest does not match its bytes");
  }
  await mkdir(directory, { recursive: true, mode: 0o700 });
  const filename = `${safeToken(gateId)}.${safeToken(runId)}.${artifactSha256}.json`;
  const path = join(directory, filename);
  await writeFile(path, artifactBytes, { mode: 0o600 });
  await chmod(path, 0o600);
  return { path, sha256: artifactSha256, bytes: Buffer.byteLength(artifactBytes) };
}

export async function recordPublicReceipt({
  acceptancePath,
  evidencePath,
  receipt,
}) {
  const [acceptance, evidence] = await Promise.all([
    readFile(acceptancePath, "utf8").then(JSON.parse),
    readFile(evidencePath, "utf8").then(JSON.parse),
  ]);
  const gate = acceptance.gates?.find(({ id }) => id === receipt.gateId);
  if (!gate) throw new Error(`unknown evidence gate: ${receipt.gateId}`);
  const passes =
    gate.allowedEvidence?.includes(receipt.evidenceClass) &&
    Number.isSafeInteger(receipt.successes) &&
    receipt.successes >= gate.targetSuccesses &&
    Number.isSafeInteger(receipt.failures) &&
    receipt.failures <= gate.maxFailures;
  if (!passes) {
    throw new Error(`${receipt.gateId} receipt does not pass its acceptance gate`);
  }
  if (!Array.isArray(evidence.receipts)) {
    throw new Error("public evidence ledger has no receipts array");
  }
  const existing = evidence.receipts.find(
    (entry) => entry.gateId === receipt.gateId && entry.runId === receipt.runId,
  );
  if (existing) {
    if (JSON.stringify(existing) !== JSON.stringify(receipt)) {
      throw new Error("runId already exists with different evidence");
    }
    return { recorded: false, receipt };
  }
  evidence.receipts.push(receipt);
  const bytes = `${JSON.stringify(evidence, null, 2)}\n`;
  const temporary = join(
    dirname(evidencePath),
    `.${safeToken(receipt.gateId)}.${randomUUID()}.tmp`,
  );
  await writeFile(temporary, bytes);
  await rename(temporary, evidencePath);
  return { recorded: true, receipt };
}
