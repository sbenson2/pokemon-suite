import { createHash } from "node:crypto";
import { createRequire } from "node:module";
import { readFile } from "node:fs/promises";
import { join } from "node:path";

import { createMgbaSession } from "./mgba-session.js";

const COMMIT = /^[0-9a-f]{40}$/;
const SHA256 = /^[0-9a-f]{64}$/;

function digest(algorithm, bytes) {
  return createHash(algorithm).update(bytes).digest("hex");
}

function assertExpectedIdentity(manifest, expected) {
  if (
    !COMMIT.test(manifest.mgba_commit ?? "") ||
    manifest.mgba_commit !== expected.mgbaCommit
  ) {
    throw new Error("pinned mGBA commit does not match the build manifest");
  }
  if (
    !COMMIT.test(manifest.wrapper_commit ?? "") ||
    manifest.wrapper_commit !== expected.wrapperCommit
  ) {
    throw new Error("pinned mGBA wrapper commit does not match the build manifest");
  }
  if (
    !SHA256.test(manifest.mgba_wasm_sha256 ?? "") ||
    manifest.mgba_wasm_sha256 !== expected.mgbaWasmSha256
  ) {
    throw new Error("pinned mGBA WASM digest does not match the build manifest");
  }
  if (manifest.bridge !== "read-only-gba-memory-v1") {
    throw new Error("pinned mGBA build has an unsupported memory bridge");
  }
}

export async function verifyPinnedMgbaArtifacts({ coreDirectory, expected }) {
  if (typeof coreDirectory !== "string" || coreDirectory === "") {
    throw new TypeError("mGBA core directory is required");
  }
  if (!expected || typeof expected !== "object") {
    throw new TypeError("pinned mGBA identity is required");
  }

  const manifestPath = join(coreDirectory, "build-manifest.json");
  const javascriptPath = join(coreDirectory, "mgba.js");
  const wasmPath = join(coreDirectory, "mgba.wasm");
  const [manifestText, javascript, wasm] = await Promise.all([
    readFile(manifestPath, "utf8"),
    readFile(javascriptPath),
    readFile(wasmPath),
  ]);
  const manifest = JSON.parse(manifestText);
  assertExpectedIdentity(manifest, expected);

  const mgbaJsSha256 = digest("sha256", javascript);
  const mgbaWasmSha256 = digest("sha256", wasm);
  if (
    !SHA256.test(manifest.mgba_js_sha256 ?? "") ||
    mgbaJsSha256 !== manifest.mgba_js_sha256
  ) {
    throw new Error("pinned mGBA JavaScript digest is invalid");
  }
  if (mgbaWasmSha256 !== manifest.mgba_wasm_sha256) {
    throw new Error("pinned mGBA WASM digest is invalid");
  }

  return Object.freeze({
    bridge: manifest.bridge,
    coreDirectory,
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
  const module = { exports: {} };
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
    module,
    module.exports,
    require,
    verified.coreDirectory,
    verified.javascriptPath,
  );
  if (typeof module.exports !== "function") {
    throw new Error("pinned mGBA JavaScript did not export its module factory");
  }
  return module.exports;
}

function assertCartridge(romBytes, cartridge) {
  if (!(romBytes instanceof Uint8Array)) {
    throw new TypeError("stock cartridge bytes must be a Uint8Array");
  }
  const actualSha1 = digest("sha1", romBytes);
  if (
    !cartridge ||
    romBytes.length !== cartridge.bytes ||
    actualSha1 !== String(cartridge.sha1 ?? "").toLowerCase()
  ) {
    throw new Error("stock cartridge fingerprint does not match qualification profile");
  }
  return actualSha1;
}

export async function createPinnedMgbaSession({
  coreDirectory,
  expected,
  romBytes,
  cartridge,
  print = () => {},
  printErr = () => {},
}) {
  const romSha1 = assertCartridge(romBytes, cartridge);
  const verified = await verifyPinnedMgbaArtifacts({ coreDirectory, expected });
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
  const session = createMgbaSession(module, {
    bridge: verified.bridge,
    cartridgeProfileId: cartridge.id,
    romBytes: romBytes.length,
    romSha1,
    mgbaCommit: verified.mgbaCommit,
    mgbaWrapperCommit: verified.mgbaWrapperCommit,
    mgbaJsSha256: verified.mgbaJsSha256,
    mgbaWasmSha256: verified.mgbaWasmSha256,
  });
  try {
    return session.boot(romBytes);
  } catch (error) {
    session.close();
    throw error;
  }
}

