import {
  createCoherentTeamPlan, createMasterTeamPlan, createMasterTeamPlanForRun,
  createOriginsPresetTeamPlan,
} from "./origins-team.js";
import { starterForSpecies } from "./run-profile.js";
import { isDeepStrictEqual } from "node:util";
import { normalizeTeamSeed } from "./roster-generator.js";

export const ROSTER_MODES = Object.freeze(["random", "coherent", "origins", "fixed"]);
const SCHEMA = "master-red/roster-selection/v1";
const VERSIONS = Object.freeze({ random: "random-families-v1", coherent: "coherent-generated-v2", origins: "origins-preset-v1",
  fixed: "starter-optimized-forward-team" });

function uint32(value, label) {
  if (!Number.isSafeInteger(value) || value < 0 || value > 0xffff_ffff) {
    throw new TypeError(`${label} must be a 32-bit unsigned integer`);
  }
  return value;
}

export function validateRosterOptions({ rosterMode, teamSeed } = {}) {
  if (rosterMode !== undefined && !ROSTER_MODES.includes(rosterMode)) throw new TypeError("invalid roster mode");
  if (teamSeed !== undefined) normalizeTeamSeed(teamSeed);
}

function commit(plan, mode, teamSeed) {
  return Object.freeze({ ...plan, rosterSelection: Object.freeze({ schema: SCHEMA, mode,
    version: plan.provenance.selection, runSeed: plan.seed, teamSeed,
    starterSpecies: plan.starterFamily[0],
    ...(mode === "random" ? { helpers: plan.rosterPolicy.helpers } : {}),
    ...(plan.provenance.catalogRevision ? { catalogRevision: plan.provenance.catalogRevision } : {}),
    acquisitionIds: Object.freeze(plan.acquisitions.map(x => x.id)),
  }) });
}

export function rosterCheckpoint(plan) {
  const selection = plan.rosterSelection ?? commit(plan, "fixed", plan.seed).rosterSelection;
  return { teamSelection: selection, permanentTeamPlan: { schema: plan.schema, seed: plan.seed,
    selection: plan.provenance.selection, acquisitionIds: plan.acquisitions.map(x => x.id) } };
}

export function resolveRosterRunSeed({ seed, seedExplicit = false, resumePlayerState = null }) {
  const restored = resumePlayerState?.teamSelection?.runSeed ?? resumePlayerState?.permanentTeamPlan?.seed;
  if (restored === undefined) return uint32(seed, "opening seed");
  uint32(restored, "checkpoint opening seed");
  if (seedExplicit && seed !== restored) throw new Error("checkpoint opening seed cannot change on resume");
  return restored;
}

// The supervisor validates identity without loading ROM tables or selecting a
// different team. The player then reconstructs v2 against its verified adapter.
export function validateRosterResume(starterSpecies, seed, resumePlayerState = null, options = {}) {
  validateRosterOptions(options);
  uint32(seed, "opening seed");
  const starter = starterForSpecies(starterSpecies);
  if (!starter) throw new TypeError("roster selection requires a Kanto starter");
  const saved = resumePlayerState?.teamSelection;
  if (resumePlayerState && Object.hasOwn(resumePlayerState, "teamSelection") && !saved) {
    throw new Error("invalid checkpoint roster commitment");
  }
  if (!saved && resumePlayerState !== null) {
    // Pre-feature checkpoints must use their old reconstruction path, never the
    // new default. Committing it now makes subsequent resumes explicit too.
    if (options.rosterMode !== undefined && options.rosterMode !== "fixed") {
      throw new Error("checkpoint roster mode cannot change on resume");
    }
    if (options.teamSeed !== undefined && options.teamSeed !== seed) {
      throw new Error("checkpoint team seed cannot change on resume");
    }
    return { starter, legacy: true, mode: "fixed", teamSeed: seed };
  }
  if (saved) {
    if (saved.schema !== SCHEMA || !ROSTER_MODES.includes(saved.mode)) throw new Error("invalid checkpoint roster commitment");
    normalizeTeamSeed(saved.teamSeed);
    if (saved.runSeed !== seed) throw new Error("checkpoint roster does not match this run");
    if (saved.starterSpecies !== starter.species) throw new Error("checkpoint starter cannot change on resume");
    if (options.rosterMode !== undefined && options.rosterMode !== saved.mode) throw new Error("checkpoint roster mode cannot change on resume");
    if (options.teamSeed !== undefined && normalizeTeamSeed(options.teamSeed) !== normalizeTeamSeed(saved.teamSeed)) throw new Error("checkpoint team seed cannot change on resume");
    if (saved.version !== VERSIONS[saved.mode] && !(saved.mode === "fixed" && saved.version === "legacy-seeded-v1") &&
        !(saved.mode === "coherent" && saved.version === "coherent-forward-v1")) {
      throw new Error("unsupported checkpoint roster version");
    }
    if (!Array.isArray(saved.acquisitionIds) || saved.acquisitionIds.length !== 5 || new Set(saved.acquisitionIds).size !== 5) {
      throw new Error("invalid checkpoint acquisition commitment");
    }
    if (saved.version === "coherent-forward-v1") uint32(saved.teamSeed, "checkpoint team seed");
    if ([VERSIONS.coherent,VERSIONS.random].includes(saved.version)) {
      if (!/^[0-9a-f]{64}$/.test(saved.catalogRevision ?? "")) throw new Error("invalid checkpoint roster catalog revision");
      const expected = { schema: "master-red/permanent-team-plan/v1", seed,
        selection: saved.version, acquisitionIds: saved.acquisitionIds };
      if (resumePlayerState.permanentTeamPlan && !isDeepStrictEqual(resumePlayerState.permanentTeamPlan, expected)) {
        throw new Error("checkpoint roster commitments conflict");
      }
    }
  }
  const mode = saved?.mode ?? options.rosterMode ?? "coherent";
  const teamSeed = normalizeTeamSeed(saved?.teamSeed ?? options.teamSeed ?? seed);
  return { starter, saved, mode, teamSeed, version: saved?.version ?? VERSIONS[mode] };
}

export function createRosterPlanForRun(starterSpecies, seed, resumePlayerState = null, options = {}) {
  const { starter, saved, mode, teamSeed, version, legacy } = validateRosterResume(starterSpecies, seed, resumePlayerState, options);
  if (legacy) return commit(createMasterTeamPlanForRun(starter.species, seed, resumePlayerState), "fixed", seed);
  let plan;
  if (version === VERSIONS.random) {
    const context = options.rosterContext;
    if (context?.gameId !== "firered-rev1-stock" || typeof context.createRandomTeamPlan !== "function") throw new Error("a verified FireRed roster context is required for random teams");
    if (saved && saved.catalogRevision !== context.revision) throw new Error("checkpoint roster catalog cannot change on resume");
    if (saved && options.helpers !== undefined && options.helpers !== saved.helpers) throw new Error("checkpoint helper policy cannot change on resume");
    plan = context.createRandomTeamPlan(starter.species,seed,teamSeed,saved?.acquisitionIds,{ helpers: saved?.helpers ?? options.helpers ?? "allowed" });
  } else if (version === VERSIONS.coherent) {
    const context = options.rosterContext;
    if (context?.gameId !== "firered-rev1-stock" || context.version !== version || typeof context.createTeamPlan !== "function") {
      throw new Error("a verified FireRed roster context is required for generated teams");
    }
    if (saved && saved.catalogRevision !== context.revision) throw new Error("checkpoint roster catalog cannot change on resume");
    plan = context.createTeamPlan(starter.species, seed, teamSeed, saved?.acquisitionIds);
  } else if (mode === "coherent") {
    plan = createCoherentTeamPlan(starter.species, seed, teamSeed, saved.acquisitionIds);
  } else if (mode === "origins") {
    plan = createOriginsPresetTeamPlan(starter.species, seed);
  } else {
    plan = createMasterTeamPlan(starter.species, seed, { selection: version, acquisitionIds: saved?.acquisitionIds });
  }
  const committed = commit(plan, mode, teamSeed);
  if (saved && JSON.stringify(saved.acquisitionIds) !== JSON.stringify(committed.rosterSelection.acquisitionIds)) {
    throw new Error("checkpoint roster acquisitions do not match the selected preset");
  }
  if (saved && resumePlayerState.permanentTeamPlan &&
      !isDeepStrictEqual(resumePlayerState.permanentTeamPlan, rosterCheckpoint(committed).permanentTeamPlan)) {
    throw new Error("checkpoint roster commitments conflict");
  }
  return committed;
}
