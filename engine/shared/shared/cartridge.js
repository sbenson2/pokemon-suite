import { createHash } from "node:crypto";
import { execFile } from "node:child_process";
import { readFile } from "node:fs/promises";
import { extname } from "node:path";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);
const SHA1 = /^[0-9a-f]{40}$/;

function validateProfile(profile) {
  if (!profile || typeof profile !== "object") {
    throw new TypeError("cartridge profile is required");
  }
  if (typeof profile.id !== "string" || !profile.id) {
    throw new TypeError("cartridge profile id is required");
  }
  if (typeof profile.path !== "string" || !profile.path) {
    throw new TypeError("cartridge source path is required");
  }
  if (!Number.isSafeInteger(profile.bytes) || profile.bytes <= 0) {
    throw new TypeError("cartridge byte length must be positive");
  }
  if (!SHA1.test(String(profile.sha1 ?? "").toLowerCase())) {
    throw new TypeError("cartridge SHA-1 must contain 40 hexadecimal digits");
  }
}

async function readZipMember(path, member, maximumBytes) {
  if (typeof member !== "string" || !member) {
    throw new TypeError("a ZIP cartridge profile requires an exact member name");
  }
  const { stdout } = await execFileAsync(
    "/usr/bin/unzip",
    ["-p", path, member],
    { encoding: "buffer", maxBuffer: maximumBytes },
  );
  return stdout;
}

export async function readVerifiedCartridge(profile) {
  validateProfile(profile);
  const container = extname(profile.path).toLowerCase() === ".zip"
    ? "zip"
    : "raw";
  const raw = container === "zip"
    ? await readZipMember(profile.path, profile.member, profile.bytes + 1)
    : await readFile(profile.path);
  const bytes = new Uint8Array(raw.buffer, raw.byteOffset, raw.byteLength);
  const sha1 = createHash("sha1").update(bytes).digest("hex");
  if (bytes.byteLength !== profile.bytes || sha1 !== profile.sha1.toLowerCase()) {
    throw new Error(
      `cartridge fingerprint mismatch for ${profile.id}: ` +
      `expected ${profile.bytes} bytes/${profile.sha1.toLowerCase()}, ` +
      `received ${bytes.byteLength} bytes/${sha1}`,
    );
  }
  return Object.freeze({
    bytes,
    identity: Object.freeze({
      id: profile.id,
      container,
      sourcePath: profile.path,
      ...(container === "zip" ? { member: profile.member } : {}),
      bytes: bytes.byteLength,
      sha1,
    }),
  });
}
