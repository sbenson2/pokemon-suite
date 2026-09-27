import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import {
  createPinnedMgbaSession,
  verifyPinnedMgbaArtifacts,
} from "../src/emulator/pinned-mgba.js";

function sha256(bytes) {
  return createHash("sha256").update(bytes).digest("hex");
}

function sha1(bytes) {
  return createHash("sha1").update(bytes).digest("hex");
}

async function fixtureCore() {
  const directory = await mkdtemp(join(tmpdir(), "master-red-mgba-"));
  const javascript = Buffer.from(
    "var createMgbaModule=(()=>async function(){globalThis.__mgbaFactoryRan=true;return globalThis.__mgbaFakeModule})()",
  );
  const wasm = Buffer.from([0, 97, 115, 109]);
  const manifest = {
    wrapper_commit: "a".repeat(40),
    mgba_commit: "b".repeat(40),
    mgba_js_sha256: sha256(javascript),
    mgba_wasm_sha256: sha256(wasm),
    bridge: "read-only-gba-memory-v1",
  };
  await Promise.all([
    writeFile(join(directory, "mgba.js"), javascript),
    writeFile(join(directory, "mgba.wasm"), wasm),
    writeFile(join(directory, "build-manifest.json"), JSON.stringify(manifest)),
  ]);
  return { directory, javascript, manifest, wasm };
}

function bootableFakeModule() {
  const heap = new Uint8Array(100_000);
  let next = 256;
  return {
    HEAPU8: heap,
    _malloc(bytes) {
      const pointer = next;
      next += bytes + 16;
      return pointer;
    },
    _free() {},
    _mgbawasm_init() {},
    _mgbawasm_set_log_level() {},
    _mgbawasm_load() {
      return 1;
    },
    _mgbawasm_platform() {
      return 0;
    },
    _mgbawasm_set_keys() {},
    _mgbawasm_unload() {},
  };
}

test("pinned artifacts are verified before their JavaScript executes", async () => {
  const fixture = await fixtureCore();
  globalThis.__mgbaFactoryRan = false;

  await assert.rejects(
    () =>
      createPinnedMgbaSession({
        coreDirectory: fixture.directory,
        expected: {
          mgbaCommit: fixture.manifest.mgba_commit,
          wrapperCommit: fixture.manifest.wrapper_commit,
          mgbaWasmSha256: "0".repeat(64),
        },
        romBytes: Uint8Array.from([1]),
        cartridge: { bytes: 1, sha1: sha1(Uint8Array.from([1])) },
      }),
    /WASM digest/i,
  );
  assert.equal(globalThis.__mgbaFactoryRan, false);
});

test("a manifest, JS, WASM, and stock cartridge form one verified session identity", async () => {
  const fixture = await fixtureCore();
  const romBytes = Uint8Array.from([1, 2, 3]);
  globalThis.__mgbaFactoryRan = false;
  globalThis.__mgbaFakeModule = bootableFakeModule();

  const verified = await verifyPinnedMgbaArtifacts({
    coreDirectory: fixture.directory,
    expected: {
      mgbaCommit: fixture.manifest.mgba_commit,
      wrapperCommit: fixture.manifest.wrapper_commit,
      mgbaWasmSha256: fixture.manifest.mgba_wasm_sha256,
    },
  });
  assert.equal(verified.mgbaJsSha256, fixture.manifest.mgba_js_sha256);

  const session = await createPinnedMgbaSession({
    coreDirectory: fixture.directory,
    expected: {
      mgbaCommit: fixture.manifest.mgba_commit,
      wrapperCommit: fixture.manifest.wrapper_commit,
      mgbaWasmSha256: fixture.manifest.mgba_wasm_sha256,
    },
    romBytes,
    cartridge: { id: "fixture-stock", bytes: 3, sha1: sha1(romBytes) },
  });

  assert.equal(globalThis.__mgbaFactoryRan, true);
  assert.deepEqual(session.identity, {
    bridge: "read-only-gba-memory-v1",
    cartridgeProfileId: "fixture-stock",
    romBytes: 3,
    romSha1: sha1(romBytes),
    mgbaCommit: fixture.manifest.mgba_commit,
    mgbaWrapperCommit: fixture.manifest.wrapper_commit,
    mgbaJsSha256: fixture.manifest.mgba_js_sha256,
    mgbaWasmSha256: fixture.manifest.mgba_wasm_sha256,
  });
  session.close();
});

test("a mismatched cartridge is rejected before mGBA boots", async () => {
  const fixture = await fixtureCore();
  globalThis.__mgbaFactoryRan = false;
  globalThis.__mgbaFakeModule = bootableFakeModule();

  await assert.rejects(
    () =>
      createPinnedMgbaSession({
        coreDirectory: fixture.directory,
        expected: {
          mgbaCommit: fixture.manifest.mgba_commit,
          wrapperCommit: fixture.manifest.wrapper_commit,
          mgbaWasmSha256: fixture.manifest.mgba_wasm_sha256,
        },
        romBytes: Uint8Array.from([1, 2, 3]),
        cartridge: { bytes: 3, sha1: "0".repeat(40) },
      }),
    /stock cartridge fingerprint/i,
  );
  assert.equal(globalThis.__mgbaFactoryRan, false);
});

