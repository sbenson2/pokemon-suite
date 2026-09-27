import { IV_STATS } from "../evidence/pokemon-record.js";
import { FIRE_RED_RNG_METHOD, FIRE_RED_SOURCE_REVISION, nextMainRng, predictLandGeneration } from "./fire-red-rng.js";

export function landSlotsFromKnowledge(world, mechanics, map) {
  const data = world?.data ?? world;
  const species = Object.values((mechanics?.data ?? mechanics)?.species ?? {});
  const table = data?.wildEncounters?.find((entry) => entry.map === map && /_FireRed$/.test(entry.base_label));
  return table?.land_mons?.mons?.map((mon) => ({ species: species.find((entry) => entry.name === mon.species)?.id,
    minLevel: mon.min_level, maxLevel: mon.max_level })) ?? null;
}

const outcomeKey = (pokemon) => JSON.stringify([pokemon?.species, pokemon?.personality, pokemon?.otId,
  pokemon?.level, ...IV_STATS.map((stat) => pokemon?.ivs?.[stat])]);

// Diagnostics-only. No controller or strategy reference is accepted here.
export function createRngPredictionMonitor({ slots, map, maxAdvances = 256 } = {}) {
  if (!Number.isInteger(maxAdvances) || maxAdvances < 1 || maxAdvances > 1024) throw new TypeError("invalid forecast budget");
  let forecast = null;
  let history = [];
  let lastFrame = null;
  let battleKey = null;
  let mismatches = 0;
  let last = null;
  const base = { method: FIRE_RED_RNG_METHOD, sourceRevision: FIRE_RED_SOURCE_REVISION,
    inputGuidance: false, synchronized: false };
  const unknown = (reason) => (last = { ...base, validity: "unknown", reason, mismatches });
  return Object.freeze({
    observe(observation) {
      if (!Number.isSafeInteger(observation?.frame) || (lastFrame !== null && observation.frame < lastFrame)) {
        forecast = null; history = []; return unknown("unexpected-backwards-frame");
      }
      lastFrame = observation.frame;
      const memory = observation.playerMemory ?? {};
      if (memory.map?.id !== map || memory.rng?.validity !== "valid" || !Number.isInteger(memory.trainer?.otId)) {
        forecast = null; history = []; return unknown("unsupported-or-unreadable-rng-context");
      }
      if (observation.emulator.inBattle) {
        if (memory.encounter?.kind !== "wild" || memory.encounter?.validity !== "valid") return unknown("opponent-not-yet-valid");
        const key = outcomeKey(memory.encounter.pokemon);
        if (battleKey === key) return last;
        battleKey = key;
        const recent = history.filter((entry) => observation.frame - entry.frame <= 3600);
        if (!recent.length) return unknown("no-recent-pre-encounter-forecast");
        const matchingForecast = recent.find((entry) => entry.candidates.some(({ candidate }) => outcomeKey(candidate.pokemon) === key));
        const compared = matchingForecast ?? recent.at(-1);
        const match = matchingForecast?.candidates.find(({ candidate }) => outcomeKey(candidate.pokemon) === key);
        if (!match) mismatches++;
        last = { ...base, validity: match ? "conditional" : "unknown", comparison: match ? "candidate-consistent" : "mismatch",
          observedFrame: observation.frame, forecastFrame: compared.frame, forecastState: compared.state,
          searchedAdvances: maxAdvances, mismatches, predicted: match?.candidate ?? null,
          advances: match?.advances ?? null, observed: memory.encounter.pokemon,
          reason: "candidate consistency does not establish frame synchronization" };
        forecast = null;
        history = [];
        return last;
      }
      battleKey = null;
      if (observation.phase !== "stable") return last ?? unknown("unstable-generation-context");
      let state = memory.rng.mainState;
      const candidates = [];
      for (let advances = 0; advances < maxAdvances; advances++, state = nextMainRng(state)) {
        for (const ivGap of ["none", "between-ivs"]) {
          const candidate = predictLandGeneration({ state, otId: memory.trainer.otId, slots, ivGap });
          if (candidate.validity === "conditional") candidates.push({ advances, candidate });
        }
      }
      forecast = { frame: observation.frame, state: memory.rng.mainState, candidates };
      history.push(forecast);
      history = history.slice(-8);
      return (last = { ...base, validity: "conditional", frame: observation.frame, mainState: memory.rng.mainState,
        wildState: memory.rng.wildState, searchedAdvances: maxAdvances, candidates: candidates.length,
        firstCandidate: candidates[0]?.candidate ?? null, mismatches,
        reason: "generation-boundary-not-observed; RNG calls are not emulator frames" });
    },
  });
}
