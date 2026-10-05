import { readFile } from "node:fs/promises";
import { join } from "node:path";

import { parseNumericDefines } from "./primitives.js";
import { knowledgeVersion } from "./versions.js";

const DEFAULT_REQUIRED_SYMBOLS = [
  "gSaveBlock1Ptr",
  "gSaveBlock2Ptr",
  "gPlayerAvatar",
  "gMapHeader",
  "gMain",
  "gTasks",
  "gBattleMons",
  "gBattleTypeFlags",
  "gBattlersCount",
  "gActiveBattler",
  "gBattleOutcome",
  "gCurrentMove",
  "gChosenMove",
  "gPlayerPartyCount",
  "gPlayerParty",
];

function memoryRegion(address) {
  if (address >= 0x02000000 && address < 0x03000000) return "EWRAM";
  if (address >= 0x03000000 && address < 0x04000000) return "IWRAM";
  if (address >= 0x08000000 && address < 0x0a000000) return "ROM";
  return "OTHER";
}

function parseSymbols(text) {
  const symbols = {};
  for (const line of text.split(/\r?\n/)) {
    const match = line.match(/^\s*([0-9a-fA-F]{8})\s+(\w)\s+([0-9a-fA-F]{8})\s+(\S+)\s*$/);
    if (!match) continue;
    const address = Number.parseInt(match[1], 16);
    const name = match[4];
    const symbol = {
      address,
      addressHex: `0x${match[1].toLowerCase()}`,
      binding: match[2],
      size: Number.parseInt(match[3], 16),
      region: memoryRegion(address),
    };
    if (!symbols[name]) {
      symbols[name] = symbol;
      continue;
    }
    let duplicateKey = `${name}@${symbol.addressHex}`;
    let ordinal = 2;
    while (symbols[duplicateKey]) {
      duplicateKey = `${name}@${symbol.addressHex}#${ordinal}`;
      ordinal += 1;
    }
    symbols[duplicateKey] = { ...symbol, sourceName: name };
  }
  return symbols;
}

function closingBrace(text, openingIndex) {
  let depth = 0;
  for (let index = openingIndex; index < text.length; index += 1) {
    if (text[index] === "{") depth += 1;
    if (text[index] === "}" && --depth === 0) return index;
  }
  throw new SyntaxError("unclosed structure declaration");
}

function parseStructure(text, name, fallbackSize) {
  const declaration = new RegExp(`\\bstruct\\s+${name}\\s*\\{`).exec(text);
  if (!declaration) throw new Error(`structure ${name} is not declared`);
  const openingIndex = text.indexOf("{", declaration.index);
  const closingIndex = closingBrace(text, openingIndex);
  const body = text.slice(openingIndex + 1, closingIndex);
  const fields = {};
  const fieldPattern = /\/\*\s*0x([0-9a-fA-F]+)\s*\*\/\s*([^;\n]+);/g;
  for (const match of body.matchAll(fieldPattern)) {
    const field = match[2].match(/([A-Za-z_]\w*)\s*(?:\[[^\]]*\])*\s*(?::\s*\d+)?\s*$/);
    if (field) fields[field[1]] = { offset: Number.parseInt(match[1], 16) };
  }
  const trailer = text.slice(closingIndex, closingIndex + 160);
  const explicitSize = trailer.match(/size\s*(?:=|:)\s*0x([0-9a-fA-F]+)/i);
  const size = explicitSize ? Number.parseInt(explicitSize[1], 16) : fallbackSize;
  if (!Number.isSafeInteger(size) || size <= 0) {
    throw new Error(`structure ${name} has no reliable size`);
  }
  return { size, fields };
}

function arrayElementSize(symbol, count) {
  if (
    !symbol ||
    !Number.isSafeInteger(symbol.size) ||
    !Number.isSafeInteger(count) ||
    count <= 0 ||
    symbol.size % count !== 0
  ) {
    return undefined;
  }
  return symbol.size / count;
}

export async function extractRuntimeSymbols(
  root,
  {
    version = "firered",
    symbolFile = `${knowledgeVersion(version).buildName}.sym`,
    requiredSymbols = DEFAULT_REQUIRED_SYMBOLS,
  } = {},
) {
  const [symbolText, globalText, fieldmapText, pokemonText, battleConstantText] = await Promise.all([
    readFile(join(root, symbolFile), "utf8"),
    readFile(join(root, "include/global.h"), "utf8"),
    readFile(join(root, "include/global.fieldmap.h"), "utf8"),
    readFile(join(root, "include/pokemon.h"), "utf8"),
    readFile(join(root, "include/constants/battle.h"), "utf8"),
  ]);
  const symbols = parseSymbols(symbolText);
  const maxBattlers = parseNumericDefines(battleConstantText).MAX_BATTLERS_COUNT?.value;
  const structures = {
    SaveBlock1: parseStructure(globalText, "SaveBlock1"),
    SaveBlock2: parseStructure(globalText, "SaveBlock2"),
    PlayerAvatar: parseStructure(
      fieldmapText,
      "PlayerAvatar",
      symbols.gPlayerAvatar?.size,
    ),
    BattlePokemon: parseStructure(
      pokemonText,
      "BattlePokemon",
      arrayElementSize(symbols.gBattleMons, maxBattlers),
    ),
  };
  const missingRequiredSymbols = requiredSymbols.filter((name) => !symbols[name]);
  const recognizedRequiredRegions = requiredSymbols.filter(
    (name) => symbols[name] && symbols[name].region !== "OTHER",
  );
  const builtStructureSizes = {
    SaveBlock1: symbols.gSaveBlock1?.size,
    SaveBlock2: symbols.gSaveBlock2?.size,
    PlayerAvatar: symbols.gPlayerAvatar?.size,
    BattlePokemon: arrayElementSize(symbols.gBattleMons, maxBattlers),
  };
  const matchingStructureSizes = Object.entries(structures).filter(
    ([name, structure]) => structure.size === builtStructureSizes[name],
  );

  return {
    symbols,
    structures,
    requiredSymbols,
    missingRequiredSymbols,
    reconciliation: [
      {
        id: "required-symbols-present",
        expected: requiredSymbols.length,
        actual: requiredSymbols.length - missingRequiredSymbols.length,
        passed: missingRequiredSymbols.length === 0,
      },
      {
        id: "required-symbol-regions-recognized",
        expected: requiredSymbols.length,
        actual: recognizedRequiredRegions.length,
        passed: recognizedRequiredRegions.length === requiredSymbols.length,
      },
      {
        id: "required-structures-have-fields",
        expected: 4,
        actual: Object.values(structures).filter(
          ({ size, fields }) => size > 0 && Object.keys(fields).length > 0,
        ).length,
        passed: Object.values(structures).every(
          ({ size, fields }) => size > 0 && Object.keys(fields).length > 0,
        ),
      },
      {
        id: "structure-sizes-match-built-symbols",
        expected: Object.keys(structures).length,
        actual: matchingStructureSizes.length,
        passed: matchingStructureSizes.length === Object.keys(structures).length,
      },
    ],
  };
}
