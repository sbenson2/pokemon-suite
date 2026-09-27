import assert from "node:assert/strict";
import { mkdtemp, readdir, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

async function loadArtifactWriter() {
  try {
    return await import("../src/extractor/artifact.js");
  } catch (error) {
    if (error?.code === "ERR_MODULE_NOT_FOUND") return {};
    throw error;
  }
}

test("content-addressed artifacts are canonical, deterministic, and private", async (t) => {
  const root = await mkdtemp(join(tmpdir(), "master-red-artifact-"));
  t.after(() => rm(root, { recursive: true, force: true }));

  const { writeContentAddressedArtifact } = await loadArtifactWriter();
  assert.equal(typeof writeContentAddressedArtifact, "function");

  const first = await writeContentAddressedArtifact(root, {
    schema: "example/v1",
    datasetId: "fixture",
    data: { z: 1, a: { second: 2, first: 1 } },
  });
  const second = await writeContentAddressedArtifact(root, {
    data: { a: { first: 1, second: 2 }, z: 1 },
    datasetId: "fixture",
    schema: "example/v1",
  });

  assert.equal(first.sha256, second.sha256);
  assert.equal(first.path, second.path);
  assert.match(first.filename, /^fixture\.[0-9a-f]{64}\.json$/);
  assert.deepEqual(await readdir(root), [first.filename]);
  assert.equal((await stat(first.path)).mode & 0o777, 0o600);
});

test("generator source bundles are ordered and content-addressed", async (t) => {
  const root = await mkdtemp(join(tmpdir(), "master-red-generator-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  await writeFile(join(root, "a.js"), "export const a = 1;\n");
  await writeFile(join(root, "b.js"), "export const b = 2;\n");

  const { digestSourceBundle } = await loadArtifactWriter();
  assert.equal(typeof digestSourceBundle, "function");

  const forward = await digestSourceBundle(root, ["a.js", "b.js"]);
  const reverse = await digestSourceBundle(root, ["b.js", "a.js"]);
  assert.deepEqual(forward, reverse);
  assert.equal(forward.kind, "source-bundle-sha256");
  assert.match(forward.revision, /^[0-9a-f]{64}$/);
  assert.deepEqual(forward.files.map(({ path }) => path), ["a.js", "b.js"]);
});

test("a JavaScript source bundle binds every transitive local import", async (t) => {
  const root = await mkdtemp(join(tmpdir(), "master-red-source-graph-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  await writeFile(
    join(root, "entry.js"),
    'import { nested } from "./nested.js";\nexport const entry = nested;\n',
  );
  await writeFile(
    join(root, "nested.js"),
    'export { deep as nested } from "./deep.js";\n',
  );
  await writeFile(join(root, "deep.js"), "export const deep = 1;\n");

  const { digestSourceBundle } = await loadArtifactWriter();
  const first = await digestSourceBundle(root, ["entry.js"], {
    followLocalImports: true,
  });
  assert.deepEqual(first.files.map(({ path }) => path), [
    "deep.js",
    "entry.js",
    "nested.js",
  ]);

  await writeFile(join(root, "deep.js"), "export const deep = 2;\n");
  const changed = await digestSourceBundle(root, ["entry.js"], {
    followLocalImports: true,
  });
  assert.notEqual(changed.revision, first.revision);
});
