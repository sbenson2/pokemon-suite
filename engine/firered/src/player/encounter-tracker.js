import { IV_STATS } from "../evidence/pokemon-record.js";

export function encounterFingerprint(pokemon) {
  return pokemon?.validity === "valid" ? JSON.stringify([
    pokemon.species, pokemon.personality, pokemon.otId, ...IV_STATS.map((stat) => pokemon.ivs?.[stat] ?? null),
  ]) : null;
}

export function createEncounterTracker({ initialState = null } = {}) {
  const state = initialState ? structuredClone(initialState) : {
    schema: "master-red/encounter-tracker/v1", totalEncounters: 0, identifiedEncounters: 0,
    repeatedOutcomes: 0, lineage: "initial", lastFrame: null, inBattle: false, current: null, recent: [],
  };
  if (state.schema !== "master-red/encounter-tracker/v1" || !Array.isArray(state.recent) || state.recent.length > 1024) {
    throw new TypeError("invalid encounter tracker checkpoint");
  }
  return Object.freeze({
    state: () => structuredClone(state),
    beginRestore(lineage) {
      if (typeof lineage !== "string" || !lineage || lineage === state.lineage) throw new TypeError("restore needs a new lineage ID");
      state.lineage = lineage; state.lastFrame = null; state.inBattle = false; state.current = null;
    },
    observe(observation) {
      const result = (validity, event = null) => ({ validity, event, current: structuredClone(state.current) });
      if (!Number.isSafeInteger(observation?.frame) || (state.lastFrame !== null && observation.frame < state.lastFrame)) {
        return result("unknown");
      }
      state.lastFrame = observation.frame;
      const encounter = observation.playerMemory?.encounter;
      const inBattle = observation.emulator?.inBattle === true;
      if (!inBattle) {
        // A transient callback is not sufficient evidence of a battle ending.
        if (observation.phase !== "stable") return result("unknown");
        state.inBattle = false; state.current = null;
        return result("absent");
      }
      if (["trainer", "tutorial"].includes(encounter?.kind)) return result(encounter.kind);
      if (!state.inBattle) {
        state.totalEncounters++;
        state.inBattle = true;
        state.current = { id: `${state.lineage}:${state.totalEncounters}`, lineage: state.lineage,
          startedFrame: observation.frame, fingerprint: null, pokemon: null };
      }
      const fingerprint = encounter?.validity === "valid" ? encounterFingerprint(encounter.pokemon) : null;
      if (!fingerprint || (state.current.fingerprint && fingerprint !== state.current.fingerprint)) return result("unknown");
      if (state.current.fingerprint) return result("valid");
      const repeatedOutcome = state.recent.includes(fingerprint);
      state.identifiedEncounters++;
      if (repeatedOutcome) state.repeatedOutcomes++;
      state.recent = [...state.recent.filter((entry) => entry !== fingerprint), fingerprint].slice(-1024);
      state.current.fingerprint = fingerprint;
      state.current.pokemon = structuredClone(encounter.pokemon);
      return result("valid", { kind: "encounter-identified", id: state.current.id,
        frame: observation.frame, repeatedOutcome, comparisonWindow: 1024 });
    },
  });
}
