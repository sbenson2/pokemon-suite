import { createHash } from "node:crypto";
import { IV_STATS } from "../evidence/pokemon-record.js";
import { evaluateHuntTarget, validateHuntConfig } from "../player/hunt-config.js";
import { FIRE_RED_RNG_METHOD, FIRE_RED_SOURCE_REVISION, searchLandCandidates } from "./fire-red-rng.js";

const digest = (bytes) => createHash("sha256").update(bytes).digest("hex");
const immediate = () => new Promise((resolve) => setImmediate(resolve));
const outcomeKey = (p) => JSON.stringify([p.species, p.personality, p.otId, p.level, ...IV_STATS.map((stat) => p.ivs[stat])]);
const integer = (value, low, high) => Number.isInteger(value) && value >= low && value <= high;

export function validateReplayConfig(input) {
  if (!input || typeof input !== "object" || Array.isArray(input) || Object.keys(input).some((key) =>
    !["schema", "mode", "map", "repeats", "waits", "path", "settleFrames", "target"].includes(key))) throw new TypeError("invalid replay configuration keys");
  const config = { schema: "master-red/rng-replay/v1", mode: "replay", map: "MAP_ROUTE1", repeats: 2,
    waits: [0], settleFrames: 600, target: { shiny: true }, ...structuredClone(input) };
  if (config.schema !== "master-red/rng-replay/v1" || !["replay", "guided"].includes(config.mode) || config.map !== "MAP_ROUTE1" ||
      !integer(config.repeats, 2, 5) || !integer(config.settleFrames, 1, 1200)) throw new TypeError("unsupported replay context or budget");
  if (!Array.isArray(config.waits) || !config.waits.length || config.waits.length * config.repeats > 32 ||
      config.waits.some((frames) => !integer(frames, 0, 600)) || new Set(config.waits).size !== config.waits.length ||
      (config.mode === "replay" && config.waits.length !== 1)) throw new TypeError("replay needs one wait; guided search is bounded to 32 total trials");
  if (!Array.isArray(config.path) || !config.path.length || config.path.length > 64 || config.path.some((step) =>
    !step || Object.keys(step).some((key) => !["buttons", "frames"].includes(key)) || !integer(step.frames, 1, 3600) ||
    !Array.isArray(step.buttons) || step.buttons.length > 1 || step.buttons.some((button) => !["up", "down", "left", "right"].includes(button))) ||
      config.path.reduce((sum, step) => sum + step.frames, 0) > 3600) throw new TypeError("frame path permits only bounded walking or neutral input");
  validateHuntConfig({ targets: [{ required: config.target }] });
  return config;
}

function snapshot(session, observation) {
  const state = session.saveState();
  const sram = session.saveSram();
  const source = session.videoFrame();
  return { frame: session.frame, state, sram, observation, video: { ...source, rgba: source.rgba.slice() },
    stateSha256: digest(state), sramSha256: digest(sram) };
}

// The caller must supply a dedicated session with no autonomous clock. Only this
// function owns its controller. It never opens a battle menu or writes memory.
export async function runFrameTrial({ session, observer, config: input, waitFrames, signal, slots = null, yieldTask = immediate } = {}) {
  const config = validateReplayConfig(input);
  if (!config.waits.includes(waitFrames)) throw new TypeError("wait must be declared in the bounded experiment");
  session.releaseButtons();
  const initial = observer.capture();
  const startFrame = session.frame;
  const initialSramSha256 = digest(session.saveSram());
  let observed = initial;
  let lastField = null;
  const trace = [];
  const finish = (status, reason = null, prediction = null) => ({ status, reason, startFrame,
    endFrame: session.frame, waitFrames, observation: observed, trace, lastField, prediction,
    snapshot: snapshot(session, observed), initialSramSha256 });
  try {
    if (signal?.aborted) return finish("cancelled", "cancelled");
    if (initial.emulator?.inBattle !== false || initial.emulator?.mode !== "overworld" || initial.phase !== "stable" ||
        !initial.emulator.inputReady || initial.playerMemory?.map?.id !== config.map || initial.playerMemory.rng?.validity !== "valid") {
      return finish("unknown", "unsupported-start-context");
    }
    const schedule = [ ...(waitFrames ? [{ buttons: [], frames: waitFrames }] : []), ...config.path ];
    let index = 0, remaining = schedule[0].frames, settling = null;
    const frameLimit = waitFrames + config.path.reduce((sum, part) => sum + part.frames, 0) + config.settleFrames;
    for (let elapsed = 0; elapsed < frameLimit; elapsed++) {
      if (signal?.aborted) return finish("cancelled", "cancelled");
      const timing = observer.captureTimingState();
      if (timing.frame !== session.frame || timing.rng?.validity !== "valid") return finish("unknown", "timing-state-unreadable");
      if (!timing.inBattle && timing.mode === "overworld" && timing.map === config.map) lastField = timing;
      if (timing.inBattle || timing.mode !== "overworld" || timing.map !== config.map || index >= schedule.length) {
        if (settling === null) { settling = 0; session.releaseButtons(); }
      }
      const buttons = settling === null ? schedule[index].buttons : [];
      session.step(buttons);
      if (session.frame !== timing.frame + 1) return finish("unknown", "non-unit-cartridge-frame-step");
      trace.push({ frame: timing.frame, buttons: [...buttons], rng: timing.rng });
      if (settling === null) {
        if (--remaining === 0) { index++; remaining = schedule[index]?.frames ?? 0; }
      } else if (++settling > config.settleFrames) return finish("unknown", "encounter-settle-timeout");
      const after = observer.captureTimingState();
      if (after.inBattle || after.mode !== "overworld" || after.map !== config.map || index >= schedule.length) {
        session.releaseButtons();
        observed = observer.capture();
        const encounter = observed.playerMemory?.encounter;
        if (encounter?.kind === "wild" && encounter.validity === "valid" && encounter.pokemon?.validity === "valid") {
          let prediction = null;
          if (slots && lastField && !encounter.pokemon.shiny) {
            // Generation can finish before the field callback/battle flag changes.
            // Compare from the explicit pre-input anchor, not that late flag.
            const found = await searchLandCandidates({ state: initial.playerMemory.rng.mainState, otId: initial.playerMemory.trainer.otId,
              slots, maxAdvances: 1024, ivGaps: ["none", "between-ivs"], signal, matches: (pokemon) => outcomeKey(pokemon) === outcomeKey(encounter.pokemon) });
            prediction = { status: found.status, anchorFrame: initial.frame, lastFieldFrame: lastField.frame, ...found,
              synchronized: false, reason: "bounded generation-sequence comparison, not a frame prediction" };
          }
          return finish(encounter.pokemon.shiny ? "protected-shiny" : "encounter", null, prediction);
        }
        if (observed.phase === "stable" && !observed.emulator.inBattle && observed.emulator.mode !== "overworld") return finish("unknown", "unexpected-menu");
        if (after.map !== config.map) return finish("unknown", "map-changed");
      }
      if ((elapsed + 1) % 32 === 0) await yieldTask();
    }
    observed = observer.capture();
    return finish(observed.emulator.inBattle ? "unknown" : "no-encounter", "frame-budget");
  } finally {
    session.releaseButtons();
  }
}

export async function runReplayExperiment({ config: input, openTrial, signal, slots = null, onTrial = () => {} } = {}) {
  const config = validateReplayConfig(input);
  const targetPolicy = validateHuntConfig({ targets: [{ required: config.target }] });
  const report = { schema: "master-red/rng-experiment/v1", method: FIRE_RED_RNG_METHOD, sourceRevision: FIRE_RED_SOURCE_REVISION,
    config, productionQualified: false, status: "finished", groups: [], encounterEvents: 0, uniqueOutcomes: 0, selected: null, preserved: null };
  const outcomes = new Set();
  for (const waitFrames of config.waits) {
    const group = { waitFrames, reproducible: false, trials: [] };
    report.groups.push(group);
    let reference = null;
    for (let repeat = 0; repeat < config.repeats; repeat++) {
      if (signal?.aborted) { report.status = "cancelled"; return report; }
      const trial = await openTrial({ waitFrames, repeat, lineage: `wait-${waitFrames}:restore-${repeat}` });
      let result;
      try { result = await runFrameTrial({ ...trial, config, waitFrames, signal, slots }); }
      finally { await trial.close(); }
      const pokemon = result.observation.playerMemory?.encounter?.pokemon ?? null;
      const key = pokemon?.validity === "valid" ? outcomeKey(pokemon) : null;
      if (key) { report.encounterEvents++; outcomes.add(key); report.uniqueOutcomes = outcomes.size; }
      report.preserved = result.snapshot;
      const summary = { ...result, observation: undefined, snapshot: undefined, pokemon,
        lineage: `wait-${waitFrames}:restore-${repeat}`, stateSha256: result.snapshot.stateSha256,
        sramSha256: result.snapshot.sramSha256 };
      group.trials.push(summary);
      await onTrial(summary);
      if (result.status === "protected-shiny") { report.status = "protected-shiny"; return report; }
      if (!["encounter", "no-encounter"].includes(result.status) || result.initialSramSha256 !== result.snapshot.sramSha256) {
        report.status = result.status === "cancelled" ? "cancelled" : "unknown";
        report.reason = result.initialSramSha256 !== result.snapshot.sramSha256 ? "unexpected-native-save-write" : result.reason;
        return report;
      }
      const signature = JSON.stringify([key, result.startFrame, result.endFrame, result.trace, result.snapshot.sramSha256]);
      if (reference !== null && signature !== reference) { report.status = "mismatch"; return report; }
      reference = signature;
    }
    group.reproducible = true;
    const pokemon = group.trials[0].pokemon;
    if (config.mode === "guided" && evaluateHuntTarget(pokemon, targetPolicy).matched) {
      report.selected = { waitFrames, path: config.path, pokemon, validity: "reproduced-isolated-plan" };
      return report;
    }
  }
  return report;
}
