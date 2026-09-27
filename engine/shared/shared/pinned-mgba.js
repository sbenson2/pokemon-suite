import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { createRequire } from "node:module";
import { join, resolve } from "node:path";

import { createMultiSystemMgbaSession } from "./mgba-session.js";

const COMMIT = /^[0-9a-f]{40}$/;
const SHA256 = /^[0-9a-f]{64}$/;
const SHA1 = /^[0-9a-f]{40}$/;
const DOCKER_DIGEST = /^.+@sha256:[0-9a-f]{64}$/;

export const PINNED_MULTI_SYSTEM_MGBA_IDENTITY = Object.freeze({
  wrapperCommit: "6b19a50a1aa45055970b46999d5cde2451f1f5d0",
  mgbaCommit: "c034660f007c543233f1cadeb0ca13c71afd8f41",
  dockerImage: "ghcr.io/openrct2/openrct2-build@sha256:0e1daa8e3f5a1c6951179aeab5c5de471ea705cb5f756bfb6e0ae5162b7e67be",
  mgbaJsSha256: "4ceadf4d73359120c415dc779f670664943cb6c2d716b5a49f797459d092e0ba",
  mgbaWasmSha256: "e9bbe503013759396a9fa776d6e09e6621d4a4ee26cea1382c8a85f9a7a1a405",
  bridge: "read-only-multisystem-memory-v2",
});

function digest(algorithm, bytes) {
  return createHash(algorithm).update(bytes).digest("hex");
}

function validateExpected(expected) {
  if (!expected || typeof expected !== "object") {
    throw new TypeError("pinned multi-system mGBA identity is required");
  }
  if (!COMMIT.test(expected.wrapperCommit ?? "")) {
    throw new Error("pinned wrapper commit must contain 40 hexadecimal digits");
  }
  if (!COMMIT.test(expected.mgbaCommit ?? "")) {
    throw new Error("pinned mGBA commit must contain 40 hexadecimal digits");
  }
  if (!DOCKER_DIGEST.test(expected.dockerImage ?? "")) {
    throw new Error("pinned builder image must include an immutable SHA-256 digest");
  }
  if (!SHA256.test(expected.mgbaJsSha256 ?? "")) {
    throw new Error("pinned mGBA JavaScript digest must contain 64 hexadecimal digits");
  }
  if (!SHA256.test(expected.mgbaWasmSha256 ?? "")) {
    throw new Error("pinned mGBA WASM digest must contain 64 hexadecimal digits");
  }
  if (expected.bridge !== "read-only-multisystem-memory-v2") {
    throw new Error("pinned mGBA identity has an unsupported memory bridge");
  }
}

function verifyManifestIdentity(manifest, expected) {
  const mappings = [
    ["wrapper_commit", "wrapperCommit", "wrapper commit"],
    ["mgba_commit", "mgbaCommit", "mGBA commit"],
    ["docker_image", "dockerImage", "builder image"],
    ["mgba_js_sha256", "mgbaJsSha256", "JavaScript digest"],
    ["mgba_wasm_sha256", "mgbaWasmSha256", "WASM digest"],
    ["bridge", "bridge", "memory bridge"],
  ];
  for (const [manifestKey, expectedKey, label] of mappings) {
    if (manifest[manifestKey] !== expected[expectedKey]) {
      throw new Error(`pinned mGBA ${label} does not match the build manifest`);
    }
  }
}

export async function verifyPinnedMultiSystemArtifacts({
  coreDirectory,
  expected = PINNED_MULTI_SYSTEM_MGBA_IDENTITY,
}) {
  if (typeof coreDirectory !== "string" || !coreDirectory) {
    throw new TypeError("mGBA core directory is required");
  }
  validateExpected(expected);

  const absoluteCoreDirectory = resolve(coreDirectory);
  const manifestPath = join(absoluteCoreDirectory, "build-manifest.json");
  const javascriptPath = join(absoluteCoreDirectory, "mgba.js");
  const wasmPath = join(absoluteCoreDirectory, "mgba.wasm");
  const [manifestText, javascript, wasm] = await Promise.all([
    readFile(manifestPath, "utf8"),
    readFile(javascriptPath),
    readFile(wasmPath),
  ]);
  const manifest = JSON.parse(manifestText);
  verifyManifestIdentity(manifest, expected);

  const mgbaJsSha256 = digest("sha256", javascript);
  const mgbaWasmSha256 = digest("sha256", wasm);
  if (mgbaJsSha256 !== manifest.mgba_js_sha256) {
    throw new Error("pinned mGBA JavaScript digest is invalid");
  }
  if (mgbaWasmSha256 !== manifest.mgba_wasm_sha256) {
    throw new Error("pinned mGBA WASM digest is invalid");
  }

  return Object.freeze({
    bridge: manifest.bridge,
    coreDirectory: absoluteCoreDirectory,
    dockerImage: manifest.docker_image,
    javascript,
    javascriptPath,
    mgbaCommit: manifest.mgba_commit,
    mgbaJsSha256,
    mgbaWasmSha256,
    mgbaWrapperCommit: manifest.wrapper_commit,
    wasmPath,
  });
}

function compileFactory(verified) {
  const source = verified.javascript.toString("utf8");
  const commonJsModule = { exports: {} };
  const require = createRequire(verified.javascriptPath);
  const compile = new Function(
    "module",
    "exports",
    "require",
    "__dirname",
    "__filename",
    `${source}\nmodule.exports = createMgbaModule;`,
  );
  compile(
    commonJsModule,
    commonJsModule.exports,
    require,
    verified.coreDirectory,
    verified.javascriptPath,
  );
  if (typeof commonJsModule.exports !== "function") {
    throw new Error("pinned mGBA JavaScript did not export its module factory");
  }
  return commonJsModule.exports;
}

function validateCartridge(cartridge) {
  if (!(cartridge?.bytes instanceof Uint8Array) || !cartridge.identity) {
    throw new TypeError("a verified cartridge is required");
  }
  const { identity } = cartridge;
  const sha1 = digest("sha1", cartridge.bytes);
  if (
    typeof identity.id !== "string" || !identity.id ||
    !Number.isSafeInteger(identity.bytes) || identity.bytes !== cartridge.bytes.byteLength ||
    !SHA1.test(identity.sha1 ?? "") || identity.sha1 !== sha1
  ) {
    throw new Error("verified cartridge identity does not match its bytes");
  }
  return identity;
}

export async function createPinnedMultiSystemSession({
  coreDirectory,
  expected = PINNED_MULTI_SYSTEM_MGBA_IDENTITY,
  cartridge,
  system,
  print = () => {},
  printErr = () => {},
}) {
  const cartridgeIdentity = validateCartridge(cartridge);
  const verified = await verifyPinnedMultiSystemArtifacts({ coreDirectory, expected });
  const factory = compileFactory(verified);
  const module = await factory({
    locateFile(filename) {
      if (filename !== "mgba.wasm") {
        throw new Error(`mGBA requested an unpinned runtime file: ${filename}`);
      }
      return verified.wasmPath;
    },
    print,
    printErr,
  });
  if (
    typeof module._mgbawasm_read_memory !== "function" ||
    typeof module._mgbawasm_read_memory_segment !== "function"
  ) {
    throw new Error("pinned mGBA runtime lacks the read-only multi-system memory bridge");
  }
  const session = createMultiSystemMgbaSession(module, {
    system,
    identity: {
      bridge: verified.bridge,
      cartridgeId: cartridgeIdentity.id,
      cartridgeBytes: cartridgeIdentity.bytes,
      cartridgeSha1: cartridgeIdentity.sha1,
      dockerImage: verified.dockerImage,
      mgbaCommit: verified.mgbaCommit,
      mgbaJsSha256: verified.mgbaJsSha256,
      mgbaWasmSha256: verified.mgbaWasmSha256,
      mgbaWrapperCommit: verified.mgbaWrapperCommit,
    },
  });
  try {
    return session.boot(cartridge.bytes);
  } catch (error) {
    session.close();
    throw error;
  }
}
