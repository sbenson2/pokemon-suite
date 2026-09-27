import { readFile } from "node:fs/promises";
import { join } from "node:path";

import {
  parseDesignatedInitializers,
  parseNamedInitializerArrays,
  parseNumericDefines,
} from "./primitives.js";

function indexedEntries(definitions, entries, prefix) {
  const indexed = [];
  for (const [name, fields] of Object.entries(entries)) {
    const id = definitions[name]?.value;
    if (!Number.isSafeInteger(id) || !name.startsWith(prefix)) continue;
    indexed[id] = { name, id, ...fields };
  }
  return indexed;
}

function extractTypeChart(text, multipliers) {
  const declaration = text.match(/gTypeEffectiveness\s*\[[^\]]*\]\s*=\s*\{([\s\S]*?)\};/);
  if (!declaration) throw new Error("gTypeEffectiveness is not declared");
  const tokens = declaration[1]
    .replaceAll(/\/\*[\s\S]*?\*\//g, "")
    .replaceAll(/\/\/.*$/gm, "")
    .split(",")
    .map((token) => token.trim())
    .filter(Boolean);
  if (tokens.length % 3 !== 0) {
    throw new Error("type effectiveness table is not made of triples");
  }

  const chart = [];
  for (let index = 0; index < tokens.length; index += 3) {
    const [attackingType, defendingType, multiplierName] = tokens.slice(index, index + 3);
    if (attackingType === "TYPE_ENDTABLE") break;
    const multiplier = multipliers[multiplierName]?.value;
    if (!Number.isSafeInteger(multiplier)) {
      throw new Error(`type multiplier ${multiplierName} is unresolved`);
    }
    chart.push({ attackingType, defendingType, multiplier });
  }
  return chart;
}

function countDefined(entries) {
  return entries.filter(Boolean).length;
}

function extractRematches(text, trainerDefinitions) {
  const entries = parseNamedInitializerArrays(text, "sRematches").sRematches ?? [];
  return entries.map(({ value }, index) => {
    const match = String(value).match(/^\{([\s\S]+)\},\s*MAP\((MAP_[A-Z0-9_]+)\)$/);
    if (!match) {
      throw new SyntaxError(`VS Seeker rematch ${index} has an unsupported initializer`);
    }
    const trainerNames = match[1].split(",").map((name) => {
      const trimmed = name.trim();
      return trimmed === "SKIP" ? null : trimmed;
    });
    const trainerIds = trainerNames.map((name) =>
      name === null ? null : trainerDefinitions[name]?.value ?? null
    );
    return { map: match[2], trainerNames, trainerIds };
  });
}

export async function extractBattleMechanics(root) {
  const [moveConstants, speciesConstants, pokemonConstants, battleConstants, trainerConstants, moveData, speciesData, battleMain, partyData, trainerData, vsSeekerData] =
    await Promise.all([
      readFile(join(root, "include/constants/moves.h"), "utf8"),
      readFile(join(root, "include/constants/species.h"), "utf8"),
      readFile(join(root, "include/constants/pokemon.h"), "utf8"),
      readFile(join(root, "include/battle_main.h"), "utf8"),
      readFile(join(root, "include/constants/opponents.h"), "utf8"),
      readFile(join(root, "src/data/battle_moves.h"), "utf8"),
      readFile(join(root, "src/data/pokemon/species_info.h"), "utf8"),
      readFile(join(root, "src/battle_main.c"), "utf8"),
      readFile(join(root, "src/data/trainer_parties.h"), "utf8"),
      readFile(join(root, "src/data/trainers.h"), "utf8"),
      readFile(join(root, "src/vs_seeker.c"), "utf8"),
    ]);

  const moveDefinitions = parseNumericDefines(moveConstants);
  const speciesDefinitions = parseNumericDefines(speciesConstants);
  const pokemonDefinitions = parseNumericDefines(pokemonConstants);
  const multiplierDefinitions = parseNumericDefines(battleConstants);
  const trainerDefinitions = parseNumericDefines(trainerConstants);
  const moves = indexedEntries(
    moveDefinitions,
    parseDesignatedInitializers(moveData, "MOVE_"),
    "MOVE_",
  );
  const species = indexedEntries(
    speciesDefinitions,
    parseDesignatedInitializers(speciesData, "SPECIES_"),
    "SPECIES_",
  );
  const parties = parseNamedInitializerArrays(partyData, "sParty_");
  const trainers = indexedEntries(
    trainerDefinitions,
    parseDesignatedInitializers(trainerData, "TRAINER_"),
    "TRAINER_",
  ).map((trainer) => {
    if (!trainer) return trainer;
    const partyName = trainer.party?.args?.[0];
    return {
      ...trainer,
      partyName: typeof partyName === "string" ? partyName : null,
      party: typeof partyName === "string" ? (parties[partyName] ?? null) : null,
    };
  });
  const typeChart = extractTypeChart(battleMain, multiplierDefinitions);
  const rematches = extractRematches(vsSeekerData, trainerDefinitions);

  const expectedMoveCount = moveDefinitions.MOVES_COUNT?.value;
  const expectedSpeciesCount = speciesDefinitions.NUM_SPECIES?.value;
  const expectedTrainerCount = trainerDefinitions.NUM_TRAINERS?.value;
  const regularSpeciesCount = species
    .slice(0, expectedSpeciesCount)
    .filter(Boolean).length;
  const referencedParties = trainers
    .filter(Boolean)
    .map(({ partyName }) => partyName)
    .filter(Boolean);
  const resolvedParties = referencedParties.filter((name) => parties[name]);
  const referencedRematchTrainers = rematches
    .flatMap(({ trainerNames }) => trainerNames)
    .filter(Boolean);
  const resolvedRematchTrainers = rematches
    .flatMap(({ trainerIds }) => trainerIds)
    .filter((id) => Number.isSafeInteger(id));

  return {
    constants: {
      moves: moveDefinitions,
      species: speciesDefinitions,
      pokemon: pokemonDefinitions,
      trainers: trainerDefinitions,
      typeMultipliers: multiplierDefinitions,
    },
    moves,
    species,
    typeChart,
    trainers,
    parties,
    rematches,
    reconciliation: [
      {
        id: "move-count-matches-constant",
        expected: expectedMoveCount,
        actual: countDefined(moves),
        passed: countDefined(moves) === expectedMoveCount,
      },
      {
        id: "species-count-matches-constant",
        expected: expectedSpeciesCount,
        actual: regularSpeciesCount,
        passed: regularSpeciesCount === expectedSpeciesCount,
      },
      {
        id: "trainer-count-matches-constant",
        expected: expectedTrainerCount,
        actual: countDefined(trainers),
        passed: countDefined(trainers) === expectedTrainerCount,
      },
      {
        id: "trainer-parties-resolve",
        expected: referencedParties.length,
        actual: resolvedParties.length,
        passed: referencedParties.length === resolvedParties.length,
      },
      {
        id: "type-chart-is-nonempty",
        expected: true,
        actual: typeChart.length > 0,
        passed: typeChart.length > 0,
      },
      {
        id: "vs-seeker-trainers-resolve",
        expected: referencedRematchTrainers.length,
        actual: resolvedRematchTrainers.length,
        passed: referencedRematchTrainers.length === resolvedRematchTrainers.length,
      },
    ],
  };
}
