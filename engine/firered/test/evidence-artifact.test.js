import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { chmod, mkdir, mkdtemp, readFile, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import {
  computeHarnessRevision,
  recordPublicReceipt,
  writePrivateRunArtifact,
} from "../src/evidence/artifact.js";

async function fixtureRoot() {
  const root = await mkdtemp(join(tmpdir(), "master-red-harness-"));
  await Promise.all([
    mkdir(join(root, "src", "emulator"), { recursive: true }),
    mkdir(join(root, "src", "evidence"), { recursive: true }),
    mkdir(join(root, "src", "cli"), { recursive: true }),
    mkdir(join(root, "research"), { recursive: true }),
  ]);
  await Promise.all([
    writeFile(join(root, "src", "emulator", "a.js"), "export const a=1;\n"),
    writeFile(join(root, "src", "evidence", "b.js"), "export const b=2;\n"),
    writeFile(join(root, "src", "cli", "qualify-emulator.js"), "// cli\n"),
    writeFile(join(root, "src", "cli", "qualify-scenario.js"), "// scenario cli\n"),
    writeFile(join(root, "src", "cli", "catalog-stock-saves.js"), "// intake cli\n"),
    writeFile(join(root, "research", "acceptance.json"), "{}\n"),
    writeFile(join(root, "research", "architecture.json"), "{}\n"),
    writeFile(join(root, "research", "cartridges.json"), "{}\n"),
    writeFile(join(root, "research", "knowledge.json"), "{}\n"),
    writeFile(join(root, "research", "sources.json"), "{}\n"),
    writeFile(join(root, "research", "transitions.json"), "{}\n"),
  ]);
  return root;
}

test("the harness revision is a deterministic source-bundle digest", async () => {
  const root = await fixtureRoot();
  const first = await computeHarnessRevision(root);
  await chmod(join(root, "src", "emulator", "a.js"), 0o600);
  const sameContent = await computeHarnessRevision(root);
  assert.equal(first, sameContent);
  assert.match(first, /^[0-9a-f]{64}$/);

  await writeFile(join(root, "src", "emulator", "a.js"), "export const a=3;\n");
  assert.notEqual(await computeHarnessRevision(root), first);

  await writeFile(join(root, "src", "emulator", "a.js"), "export const a=1;\n");
  await writeFile(join(root, "research", "knowledge.json"), "{\"changed\":true}\n");
  assert.notEqual(await computeHarnessRevision(root), first);
});

test("the harness revision covers diagnostic and save-intake orchestration", async () => {
  const root = await fixtureRoot();
  const first = await computeHarnessRevision(root);

  await writeFile(
    join(root, "src", "cli", "qualify-scenario.js"),
    "// changed scenario cli\n",
  );
  assert.notEqual(await computeHarnessRevision(root), first);

  await writeFile(
    join(root, "src", "cli", "qualify-scenario.js"),
    "// scenario cli\n",
  );
  await writeFile(
    join(root, "src", "cli", "catalog-stock-saves.js"),
    "// changed intake cli\n",
  );
  assert.notEqual(await computeHarnessRevision(root), first);
});

test("real-run artifacts are content-addressed and private", async () => {
  const directory = await mkdtemp(join(tmpdir(), "master-red-evidence-"));
  const artifactBytes = "{\"ok\":true}\n";
  const artifactSha256 = createHash("sha256")
    .update(artifactBytes)
    .digest("hex");
  const written = await writePrivateRunArtifact({
    directory,
    gateId: "snapshot-roundtrip",
    runId: "run:unsafe/id",
    artifactBytes,
    artifactSha256,
  });
  assert.ok(
    written.path.endsWith(
      `snapshot-roundtrip.run-unsafe-id.${artifactSha256}.json`,
    ),
  );
  assert.equal((await stat(written.path)).mode & 0o777, 0o600);
  assert.equal(await readFile(written.path, "utf8"), "{\"ok\":true}\n");
});

test("only a threshold-passing receipt can enter the public ledger", async () => {
  const root = await mkdtemp(join(tmpdir(), "master-red-ledger-"));
  const acceptancePath = join(root, "acceptance.json");
  const evidencePath = join(root, "evidence.json");
  await writeFile(
    acceptancePath,
    JSON.stringify({
      gates: [
        {
          id: "atomic-observation-sampling",
          targetSuccesses: 10,
          maxFailures: 0,
          allowedEvidence: ["real-mgba"],
        },
      ],
    }),
  );
  await writeFile(
    evidencePath,
    JSON.stringify({ schema: "master-red/evidence/v1", receipts: [] }),
  );
  const receipt = {
    gateId: "atomic-observation-sampling",
    evidenceClass: "real-mgba",
    successes: 9,
    failures: 0,
    runId: "run-1",
  };
  await assert.rejects(
    () => recordPublicReceipt({ acceptancePath, evidencePath, receipt }),
    /does not pass/i,
  );

  receipt.successes = 10;
  await recordPublicReceipt({ acceptancePath, evidencePath, receipt });
  await recordPublicReceipt({ acceptancePath, evidencePath, receipt });
  const evidence = JSON.parse(await readFile(evidencePath, "utf8"));
  assert.equal(evidence.receipts.length, 1);
  assert.equal(evidence.receipts[0].runId, "run-1");
});
