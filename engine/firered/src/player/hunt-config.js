import { FIRE_RED_NATURES, IV_STATS } from "../evidence/pokemon-record.js";
import {unownForm} from '../evidence/unown-form.js';

function object(value, keys, name) {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new TypeError(`${name} must be an object`);
  for (const key of Object.keys(value)) if (!keys.includes(key)) throw new TypeError(`unknown ${name}.${key}`);
}
function integer(value, min, max, name) {
  if (!Number.isSafeInteger(value) || value < min || value > max) throw new TypeError(`${name} must be ${min}..${max}`);
  return value;
}
function choice(value, choices, name) {
  if (!choices.includes(value)) throw new TypeError(`unsupported ${name}: ${value}`);
  return value;
}
function criteria(value, name) {
  object(value, ["species", "shiny", "natures", "minIvs", "unownForms"], name);
  if (Object.keys(value).length === 0) throw new TypeError(`${name} must constrain at least one attribute`);
  if (value.shiny !== undefined) choice(value.shiny, [true, false], `${name}.shiny`);
  if(value.unownForms!==undefined){
    if(!Array.isArray(value.unownForms)||!value.unownForms.length)throw new TypeError('Unown forms must be a nonempty list.');
    for(const form of value.unownForms)integer(form,0,27,'Unown form');
  }
  for (const key of ["species", "natures"]) if (value[key] !== undefined) {
    if (!Array.isArray(value[key]) || value[key].length === 0) throw new TypeError(`${name}.${key} must be nonempty`);
    for (const entry of value[key]) key === "species" ? integer(entry, 1, 411, "species") : choice(entry, FIRE_RED_NATURES, "nature");
  }
  if (value.minIvs !== undefined) {
    object(value.minIvs, IV_STATS, `${name}.minIvs`);
    if (!Object.keys(value.minIvs).length) throw new TypeError("minIvs must not be empty");
    for (const iv of Object.values(value.minIvs)) integer(iv, 0, 31, "IV");
  }
  return structuredClone(value);
}
function freeze(value) {
  if (value && typeof value === "object") { Object.values(value).forEach(freeze); Object.freeze(value); }
  return value;
}

export function validateHuntConfig(input) {
  object(input, ["schema", "strategy", "area", "rngMode", "observeOnly", "preserveEveryShiny", "onShiny",
    "onTarget", "targets", "resources", "limits", "allowMasterBall"], "hunt");
  const resources = input.resources ?? {};
  const limits = input.limits ?? {};
  object(resources, ["minBalls", "minHealthyMembers", "minHealthFraction", "minFreeSlots", "freeHealerRange"], "resources");
  object(limits, ["maxEncounters", "maxFrames", "maxIdleFrames", "maxUnknownFrames", "maxCaptureTurns", "maxEscapeAttempts"], "limits");
  const targets = input.targets ?? [{ required: { shiny: true } }];
  if (!Array.isArray(targets) || targets.length === 0 || targets.length > 32) throw new TypeError("targets must have 1..32 entries");
  const minHealthFraction = resources.minHealthFraction ?? 0.7;
  if (typeof minHealthFraction !== "number" || !Number.isFinite(minHealthFraction) || minHealthFraction <= 0 || minHealthFraction > 1) {
    throw new TypeError("minHealthFraction must be > 0 and <= 1");
  }
  return freeze({
    schema: choice(input.schema ?? "master-red/hunt-config/v1", ["master-red/hunt-config/v1"], "schema"),
    strategy: choice(input.strategy ?? "hunt", ["hunt"], "strategy"),
    // First qualified hunting surface; additional methods/maps need hazard and
    // reachability tests, not just an invented coordinate in a config file.
    area: choice(input.area ?? "MAP_ROUTE1", ["MAP_ROUTE1"], "hunting area"),
    rngMode: choice(input.rngMode ?? "off", ["off", "predict", "guided"], "rngMode"),
    observeOnly: choice(input.observeOnly ?? true, [true, false], "observeOnly"),
    preserveEveryShiny: choice(input.preserveEveryShiny ?? true, [true], "preserveEveryShiny"),
    onShiny: choice(input.onShiny ?? "pause", ["pause", "capture"], "onShiny"),
    onTarget: choice(input.onTarget ?? "pause", ["pause", "capture"], "onTarget"),
    allowMasterBall: choice(input.allowMasterBall ?? false, [true, false], "allowMasterBall"),
    targets: targets.map((target) => {
      object(target, ["required", "preferred"], "target");
      return { required: criteria(target.required, "required"),
        ...(target.preferred ? { preferred: criteria(target.preferred, "preferred") } : {}) };
    }),
    resources: {
      minBalls: integer(resources.minBalls ?? 20, 1, 999, "minBalls"),
      minHealthyMembers: integer(resources.minHealthyMembers ?? 1, 1, 6, "minHealthyMembers"),
      minHealthFraction,
      minFreeSlots: integer(resources.minFreeSlots ?? 1, 1, 426, "minFreeSlots"),
      freeHealerRange: integer(resources.freeHealerRange ?? 2, 0, 8, "freeHealerRange"),
    },
    limits: {
      maxEncounters: integer(limits.maxEncounters ?? 1000, 1, 100000, "maxEncounters"),
      maxFrames: integer(limits.maxFrames ?? 216000, 1, 2160000, "maxFrames"),
      maxIdleFrames: integer(limits.maxIdleFrames ?? 3600, 1, 36000, "maxIdleFrames"),
      maxUnknownFrames: integer(limits.maxUnknownFrames ?? 600, 1, 3600, "maxUnknownFrames"),
      maxCaptureTurns: integer(limits.maxCaptureTurns ?? 30, 1, 200, "maxCaptureTurns"),
      maxEscapeAttempts: integer(limits.maxEscapeAttempts ?? 3, 1, 10, "maxEscapeAttempts"),
    },
  });
}

function matches(pokemon, filter) {
  return (!filter.species || filter.species.includes(pokemon.species)) &&
    (!filter.unownForms || filter.unownForms.includes(unownForm(pokemon))) &&
    (filter.shiny === undefined || filter.shiny === pokemon.shiny) &&
    (!filter.natures || filter.natures.includes(pokemon.nature?.name)) &&
    (!filter.minIvs || Object.entries(filter.minIvs).every(([stat, min]) =>
      Number.isInteger(pokemon.ivs?.[stat]) && pokemon.ivs[stat] >= min));
}

export function evaluateHuntTarget(pokemon, config) {
  if (pokemon?.validity !== "valid" || typeof pokemon.shiny !== "boolean" || pokemon.isEgg) {
    return { known: false, protected: false, matched: false, preferred: false };
  }
  const targets = config.targets.filter((target) => matches(pokemon, target.required));
  return { known: true, protected: pokemon.shiny || targets.length > 0, matched: targets.length > 0,
    preferred: targets.some((target) => !target.preferred || matches(pokemon, target.preferred)) };
}
