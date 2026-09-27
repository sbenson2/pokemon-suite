import { readFile, readdir } from "node:fs/promises";
import { join, relative, sep } from "node:path";

import { parseNumericDefines } from "./primitives.js";

async function filesNamed(root, filename) {
  const found = [];
  async function visit(directory) {
    let entries;
    try {
      entries = await readdir(directory, { withFileTypes: true });
    } catch (error) {
      if (error?.code === "ENOENT") return;
      throw error;
    }
    for (const entry of entries) {
      const path = join(directory, entry.name);
      if (entry.isDirectory()) await visit(path);
      else if (entry.isFile() && entry.name === filename) found.push(path);
    }
  }
  await visit(root);
  return found.sort();
}

async function filesEndingWith(root, suffix) {
  const found = [];
  async function visit(directory) {
    let entries;
    try {
      entries = await readdir(directory, { withFileTypes: true });
    } catch (error) {
      if (error?.code === "ENOENT") return;
      throw error;
    }
    for (const entry of entries) {
      const path = join(directory, entry.name);
      if (entry.isDirectory()) await visit(path);
      else if (entry.isFile() && entry.name.endsWith(suffix)) found.push(path);
    }
  }
  await visit(root);
  return found.sort();
}

function portableRelative(root, path) {
  return relative(root, path).split(sep).join("/");
}

function splitArguments(source) {
  const args = [];
  let start = 0;
  let depth = 0;
  let quote = null;
  let escaped = false;
  for (let index = 0; index < source.length; index += 1) {
    const character = source[index];
    if (quote) {
      if (escaped) escaped = false;
      else if (character === "\\") escaped = true;
      else if (character === quote) quote = null;
    } else if (character === '"' || character === "'") quote = character;
    else if (character === "(" || character === "{" || character === "[") depth += 1;
    else if (character === ")" || character === "}" || character === "]") depth -= 1;
    else if (character === "," && depth === 0) {
      args.push(source.slice(start, index).trim());
      start = index + 1;
    }
  }
  const final = source.slice(start).trim();
  if (final) args.push(final);
  return args;
}

function parseScriptFile(text, file) {
  const scripts = [];
  let current = null;
  const lines = text.split(/\r?\n/);

  for (let index = 0; index < lines.length; index += 1) {
    const lineNumber = index + 1;
    const source = lines[index].replace(/\s+@.*$/, "").trim();
    if (!source) continue;
    const label = source.match(/^([A-Za-z_]\w*):{1,2}$/);
    if (label) {
      current = { label: label[1], file, line: lineNumber, instructions: [] };
      scripts.push(current);
      continue;
    }
    if (!current || source.startsWith("#")) continue;
    const instruction = source.match(/^([^\s]+)(?:\s+([\s\S]*))?$/);
    current.instructions.push({
      op: instruction[1],
      args: instruction[2] ? splitArguments(instruction[2]) : [],
      line: lineNumber,
    });
  }
  return scripts;
}

function referencesFor(scripts, prefix, include = () => true) {
  const references = {};
  const tokenPattern = new RegExp(`\\b${prefix}[A-Z0-9_]+\\b`, "g");
  for (const script of scripts) {
    for (const instruction of script.instructions) {
      for (const token of instruction.args.join(", ").match(tokenPattern) ?? []) {
        if (!include(token, instruction)) continue;
        (references[token] ??= []).push({
          file: script.file,
          line: instruction.line,
          label: script.label,
          op: instruction.op,
        });
      }
    }
  }
  return references;
}

function unresolvedReferences(references, definitions) {
  return Object.keys(references).filter((name) => !(name in definitions)).sort();
}

function referenceCheck(id, references, definitions) {
  const entries = Object.entries(references);
  const expected = entries.reduce((count, [, refs]) => count + refs.length, 0);
  const actual = entries
    .filter(([name]) => name in definitions)
    .reduce((count, [, refs]) => count + refs.length, 0);
  return { id, expected, actual, passed: expected === actual };
}

export async function extractStoryState(root) {
  const [flagText, variableText, itemText, trainerText, mapScripts, commonScripts] =
    await Promise.all([
      readFile(join(root, "include/constants/flags.h"), "utf8"),
      readFile(join(root, "include/constants/vars.h"), "utf8"),
      readFile(join(root, "include/constants/items.h"), "utf8"),
      readFile(join(root, "include/constants/opponents.h"), "utf8"),
      filesNamed(join(root, "data/maps"), "scripts.inc"),
      filesEndingWith(join(root, "data/scripts"), ".inc"),
    ]);

  const scriptPaths = [...new Set([...mapScripts, ...commonScripts])].sort();
  const scripts = (
    await Promise.all(
      scriptPaths.map(async (path) =>
        parseScriptFile(await readFile(path, "utf8"), portableRelative(root, path)),
      ),
    )
  ).flat();

  const trainerDefinitions = parseNumericDefines(trainerText);
  const trainerValues = Object.fromEntries(
    Object.entries(trainerDefinitions).map(([name, definition]) => [
      name,
      definition.value,
    ]),
  );
  const symbols = {
    flags: Object.fromEntries(
      Object.entries(parseNumericDefines(flagText, trainerValues)).filter(([name]) =>
        name.startsWith("FLAG_"),
      ),
    ),
    variables: Object.fromEntries(
      Object.entries(parseNumericDefines(variableText)).filter(([name]) =>
        name.startsWith("VAR_"),
      ),
    ),
    items: Object.fromEntries(
      Object.entries(parseNumericDefines(itemText)).filter(([name]) =>
        name.startsWith("ITEM_"),
      ),
    ),
    trainers: Object.fromEntries(
      Object.entries(trainerDefinitions).filter(([name]) =>
        name.startsWith("TRAINER_"),
      ),
    ),
  };
  const references = {
    flags: referencesFor(scripts, "FLAG_"),
    variables: referencesFor(scripts, "VAR_"),
    items: referencesFor(scripts, "ITEM_"),
    trainers: referencesFor(
      scripts,
      "TRAINER_",
      (token, instruction) =>
        token in symbols.trainers || instruction.op.startsWith("trainerbattle"),
    ),
  };
  const unresolved = Object.fromEntries(
    Object.keys(references).map((kind) => [
      kind,
      unresolvedReferences(references[kind], symbols[kind]),
    ]),
  );
  const enterHallOfFameReferences = scripts.flatMap((script) =>
    script.instructions
      .filter((instruction) =>
        instruction.args.some((arg) => /\bEnterHallOfFame\b/.test(arg)),
      )
      .map((instruction) => ({
        file: script.file,
        line: instruction.line,
        label: script.label,
        op: instruction.op,
      })),
  );

  const reconciliation = [
    referenceCheck("flag-references-resolve", references.flags, symbols.flags),
    referenceCheck(
      "variable-references-resolve",
      references.variables,
      symbols.variables,
    ),
    referenceCheck("item-references-resolve", references.items, symbols.items),
    referenceCheck(
      "trainer-references-resolve",
      references.trainers,
      symbols.trainers,
    ),
    {
      id: "game-clear-flag-defined",
      expected: true,
      actual: Boolean(symbols.flags.FLAG_SYS_GAME_CLEAR),
      passed: Boolean(symbols.flags.FLAG_SYS_GAME_CLEAR),
    },
    {
      id: "hall-of-fame-entry-referenced",
      expected: true,
      actual: enterHallOfFameReferences.length > 0,
      passed: enterHallOfFameReferences.length > 0,
    },
  ];

  return {
    symbols,
    scripts,
    references,
    unresolved,
    goalEvidence: {
      gameClearFlag: symbols.flags.FLAG_SYS_GAME_CLEAR ?? null,
      enterHallOfFameReferences,
    },
    reconciliation,
  };
}
