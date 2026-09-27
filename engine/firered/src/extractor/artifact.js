import { createHash, randomUUID } from "node:crypto";
import {
  chmod,
  mkdir,
  readFile,
  rename,
  unlink,
  writeFile,
} from "node:fs/promises";
import { dirname, isAbsolute, join, normalize, sep } from "node:path";

function sha256(value) {
  return createHash("sha256").update(value).digest("hex");
}

function canonicalValue(value) {
  if (value === null || typeof value === "string" || typeof value === "boolean") {
    return value;
  }
  if (typeof value === "number") {
    if (!Number.isFinite(value)) throw new TypeError("artifact numbers must be finite");
    return value;
  }
  if (Array.isArray(value)) {
    return Array.from(value, (entry) =>
      entry === undefined ? null : canonicalValue(entry),
    );
  }
  if (typeof value === "object") {
    return Object.fromEntries(
      Object.keys(value)
        .filter((key) => value[key] !== undefined)
        .sort()
        .map((key) => [key, canonicalValue(value[key])]),
    );
  }
  throw new TypeError(`artifact value type ${typeof value} is unsupported`);
}

export function canonicalJson(value) {
  return `${JSON.stringify(canonicalValue(value), null, 2)}\n`;
}

function assertSafeSourcePaths(paths) {
  if (
    paths.length === 0 ||
    paths.some(
      (path) =>
        typeof path !== "string" ||
        path.length === 0 ||
        isAbsolute(path) ||
        path.split(/[\\/]/).includes(".."),
    )
  ) {
    throw new TypeError("generator source paths must be safe relative paths");
  }
}

function localModuleSpecifiers(source) {
  const result = new Set();
  const staticImport = /\b(?:import|export)\s+(?:[^"'`;]*?\s+from\s*)?["']([^"']+)["']/gu;
  const dynamicImport = /\bimport\s*\(\s*["']([^"']+)["']\s*\)/gu;
  for (const pattern of [staticImport, dynamicImport]) {
    for (const match of source.matchAll(pattern)) {
      if (match[1].startsWith(".")) result.add(match[1]);
    }
  }
  return result;
}

async function transitiveLocalSourcePaths(root, entryPaths) {
  const discovered = new Set(entryPaths);
  const queue = [...entryPaths];
  for (let cursor = 0; cursor < queue.length; cursor += 1) {
    const path = queue[cursor];
    if (!/\.[cm]?js$/u.test(path)) continue;
    const source = await readFile(join(root, path), "utf8");
    for (const specifier of localModuleSpecifiers(source)) {
      const importedPath = normalize(join(dirname(path), specifier))
        .split(sep)
        .join("/");
      assertSafeSourcePaths([importedPath]);
      if (discovered.has(importedPath)) continue;
      discovered.add(importedPath);
      queue.push(importedPath);
    }
  }
  return [...discovered];
}

export async function digestSourceBundle(
  root,
  relativePaths,
  { followLocalImports = false } = {},
) {
  if (typeof followLocalImports !== "boolean") {
    throw new TypeError("followLocalImports must be a boolean");
  }
  const entries = [...new Set(relativePaths)];
  assertSafeSourcePaths(entries);
  const paths = (followLocalImports
    ? await transitiveLocalSourcePaths(root, entries)
    : entries
  ).sort();

  const files = await Promise.all(
    paths.map(async (path) => {
      const content = await readFile(join(root, path));
      return { path, bytes: content.byteLength, sha256: sha256(content) };
    }),
  );
  return {
    kind: "source-bundle-sha256",
    revision: sha256(canonicalJson(files)),
    files,
  };
}

export async function writeContentAddressedArtifact(outputDirectory, artifact) {
  if (!/^[a-z0-9][a-z0-9-]*$/.test(artifact?.datasetId ?? "")) {
    throw new TypeError("artifact datasetId must be a lowercase slug");
  }
  const content = canonicalJson(artifact);
  const digest = sha256(content);
  const filename = `${artifact.datasetId}.${digest}.json`;
  const path = join(outputDirectory, filename);

  await mkdir(outputDirectory, { recursive: true, mode: 0o700 });
  await chmod(outputDirectory, 0o700);
  try {
    const existing = await readFile(path, "utf8");
    if (existing !== content) {
      throw new Error(`content-address collision for ${filename}`);
    }
  } catch (error) {
    if (error?.code !== "ENOENT") throw error;
    const temporaryPath = join(
      outputDirectory,
      `.${filename}.${process.pid}.${randomUUID()}.tmp`,
    );
    try {
      await writeFile(temporaryPath, content, { mode: 0o600, flag: "wx" });
      await rename(temporaryPath, path);
    } finally {
      await unlink(temporaryPath).catch((error) => {
        if (error?.code !== "ENOENT") throw error;
      });
    }
  }
  await chmod(path, 0o600);

  return { path, filename, sha256: digest, bytes: Buffer.byteLength(content) };
}
