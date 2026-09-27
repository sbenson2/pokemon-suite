import { createHash } from "node:crypto";
import { createRosterGenerator, drawRandomFamilies } from "./roster-generator.js";
import { FIRE_RED_FIELD_MOVES } from "./fire-red-roster-facts.js";
import { createMasterTeamPlan } from "./origins-team.js";
import { starterForSpecies } from "./run-profile.js";
import { PHYSICAL_TYPES } from "./battle-modifiers.js";
import { typeMultiplier, effectPenalty } from "./mechanics-data.js";
import { isHmUtilityCarrier } from './hm-policy.js';
import { MAIN_STORY_CAMPAIGN, CAMPAIGN_MAJOR_BATTLE_LEVEL_TARGETS, IMPORTANT_BATTLE_TRAINER_NAMES,
  buildCollectionCatalog, buildRegionalEncounterCatalog } from "./campaign.js";

const VERSION = "coherent-generated-v2";
export const RANDOM_ROSTER_VERSION = "random-families-v1";
const SHOP = { map: "MAP_CELADON_CITY_DEPARTMENT_STORE_4F", objectIndex: 2 };
const STONES = { 95: 2, 96: 3, 97: 4, 98: 5 };
const RODS = {
  262: { map: "MAP_VERMILION_CITY_HOUSE1", objectIndex: 0, afterObjectiveId: "vs-seeker" },
  263: { map: "MAP_FUCHSIA_CITY_HOUSE2", objectIndex: 0, afterObjectiveId: "silph-liberated" },
  264: { map: "MAP_ROUTE12_FISHING_HOUSE", objectIndex: 0, afterObjectiveId: "silph-liberated" },
};
const stageIndex = new Map(MAIN_STORY_CAMPAIGN.objectives.map((x, i) => [x.id, i]));
const indexOf = id => {
  const index = stageIndex.get(id);
  if (index === undefined) throw new Error(`unknown roster acquisition anchor ${id}`);
  return index;
};
const later = (a, b) => indexOf(a) >= indexOf(b) ? a : b;

// These are progression/route capabilities, not species or team recipes. New
// native encounters in supported areas automatically enter the candidate pool.
function mapAnchor(map) {
  const route = /^MAP_ROUTE(\d+)(?:_NORTH|_SOUTH)?$/.exec(map);
  if (route) {
    const n = Number(route[1]);
    if ([1, 2, 22].includes(n)) return "regional-pokedex";
    if ([3, 4].includes(n)) return "badge-boulder";
    if ([24, 25].includes(n)) return "rival-cerulean";
    if ([5, 6, 11].includes(n)) return "vs-seeker";
    if ([7, 8, 9, 10].includes(n)) return "badge-thunder";
    if ([16, 17, 18].includes(n)) return "poke-flute";
    if ([12, 13, 14, 15].includes(n)) return "silph-liberated";
    if ([19, 20, 21].includes(n)) return "teach-surf";
    if (n === 23) return "rival-route22-late";
  }
  if (map === "MAP_VIRIDIAN_FOREST") return "rival-route22-early";
  if (/^MAP_MT_MOON_/.test(map)) return "badge-boulder";
  if (map === "MAP_DIGLETTS_CAVE_B1F") return "vs-seeker";
  if (/^MAP_ROCK_TUNNEL_/.test(map)) return "badge-thunder";
  if (/^MAP_POKEMON_TOWER_[3-7]F$/.test(map)) return "rival-pokemon-tower";
  if (/^MAP_SAFARI_ZONE_/.test(map)) return "hm-surf";
  if (map === "MAP_POWER_PLANT" || map === "MAP_SEAFOAM_ISLANDS_1F") return "teach-surf";
  if (/^MAP_POKEMON_MANSION_/.test(map)) return "badge-marsh";
  if (map === "MAP_VICTORY_ROAD_1F") return "rival-route22-late";
  if (["MAP_PALLET_TOWN", "MAP_VIRIDIAN_CITY"].includes(map)) return "regional-pokedex";
  if (map === "MAP_CERULEAN_CITY") return "rival-cerulean";
  if (map === "MAP_VERMILION_CITY") return "vs-seeker";
  if (map === "MAP_CELADON_CITY") return "badge-thunder";
  if (map === "MAP_FUCHSIA_CITY") return "silph-liberated";
  if (map === "MAP_CINNABAR_ISLAND") return "badge-marsh";
  return null;
}

function freeze(value) {
  if (value && typeof value === "object" && !Object.isFrozen(value)) {
    Object.values(value).forEach(freeze); Object.freeze(value);
  }
  return value;
}

export function createFireRedRosterContext({ world, story, mechanics, facts }) {
  if (facts?.schema !== "master-red/firered-roster-facts/v1" || !world || !mechanics) {
    throw new TypeError("generated FireRed rosters require verified cartridge facts and world data");
  }
  const data = mechanics.data ?? mechanics, worldData = world.data ?? world;
  const species = facts.species;
  const levelMethod = facts.constants.EVO_LEVEL?.value ?? 4, itemMethod = facts.constants.EVO_ITEM?.value ?? 7;
  const exclusions = [], entries = new Map();
  const parents = new Map();
  for (const value of Object.values(species)) for (const evolution of value.evolutions) {
    parents.set(evolution.targetSpecies, value.id);
  }
  const lineage = id => {
    const seen = new Set();
    while (parents.has(id) && !seen.has(id)) { seen.add(id); id = parents.get(id); }
    return id;
  };
  const family = id => Object.keys(species).map(Number).filter(x => x <= 151 && lineage(x) === lineage(id));
  const familyKey = id => `lineage:${lineage(id)}`;
  const stones = buildCollectionCatalog(world, story).filter(x => x.itemId === 94 && !x.underfoot && mapAnchor(x.map))
    .sort((a, b) => indexOf(mapAnchor(a.map)) - indexOf(mapAnchor(b.map)) || a.id.localeCompare(b.id));
  const paths = (id, steps = [], seen = new Set()) => {
    if (seen.has(id)) throw new Error("cycle in cartridge evolution table");
    const nextSeen = new Set([...seen, id]);
    const supported = (species[id]?.evolutions ?? []).filter(e => e.targetSpecies <= 151 &&
      (e.method === levelMethod || e.method === itemMethod && (STONES[e.parameter] !== undefined || e.parameter === 94 && stones.length)));
    const results = supported.some(e => e.method === levelMethod) ? [] : [{ targetSpecies: id, evolutionSteps: steps }];
    for (const e of supported) results.push(...paths(e.targetSpecies, [...steps, {
      kind: e.method === levelMethod ? "level-evolution" : "item-evolution", sourceSpecies: id, targetSpecies: e.targetSpecies,
      ...(e.method === levelMethod ? { level: e.parameter } : { itemId: e.parameter }),
    }], nextSeen));
    return results;
  };
  const add = (base, path) => {
    const target = species[path.targetSpecies];
    if (!target) return;
    const id = base.id ?? `native-${path.targetSpecies}`;
    const acquisition = { ...base, id, label: `${species[base.captureSpecies].name.replace("SPECIES_", "")} → ${target.name.replace("SPECIES_", "")}`,
      ...path, family: family(path.targetSpecies), familyKey: familyKey(path.targetSpecies),
      exclusiveKeys: [familyKey(path.targetSpecies), ...(base.exclusiveKeys ?? [])],
      fieldCapabilities: [...target.fieldCapabilities], types: [...new Set(target.types)].map(x => x.replace("TYPE_", "").toLowerCase()),
      nativeFireRed: true, preHallOfFame: true, permanentRoster: true,
      requiredBy: "champion", availabilityOrder: indexOf(base.afterObjectiveId),
    };
    const previous = entries.get(id);
    if (!previous || acquisition.availabilityOrder < previous.availabilityOrder ||
        acquisition.availabilityOrder === previous.availabilityOrder && acquisition.encounterShare > previous.encounterShare) entries.set(id, acquisition);
  };
  for (const encounter of buildRegionalEncounterCatalog(world, mechanics)) {
    if (encounter.speciesId > 151) continue;
    let anchor = mapAnchor(encounter.map);
    if (!anchor) { exclusions.push({ species: encounter.speciesId, map: encounter.map, reason: "postgame or unauthored progression route" }); continue; }
    if (encounter.method === "surf") anchor = later(anchor, "teach-surf");
    if (encounter.rodItemId) anchor = later(anchor, RODS[encounter.rodItemId].afterObjectiveId);
    for (const path of paths(encounter.speciesId)) add({ captureSpecies: encounter.speciesId,
      captureLevel: encounter.minimumLevel, afterObjectiveId: anchor, encounterShare: encounter.encounterShare,
      steps: [{ kind: "wild-capture", species: encounter.speciesId, maps: [encounter.map],
        targetKind: encounter.targetKind, safari: encounter.safari, ...(encounter.rodItemId ? { rodItemId: encounter.rodItemId } : {}) }],
    }, path);
  }
  const hasMap = id => (worldData.maps ?? []).some(x => x.id === id);
  if (hasMap("MAP_SILPH_CO_7F")) add({ id: "lapras", captureSpecies: 131, captureLevel: 25, afterObjectiveId: "rival-silph", encounterShare: 100,
    steps: [{ kind: "gift", species: 131, map: "MAP_SILPH_CO_7F", objectIndex: 1 }] }, { targetSpecies: 131, evolutionSteps: [] });
  if (hasMap("MAP_ROUTE16")) add({ id: "snorlax", captureSpecies: 143, captureLevel: 30, afterObjectiveId: "poke-flute", encounterShare: 100,
    steps: [{ kind: "fixed-capture", species: 143, maps: ["MAP_ROUTE16"], objectIndex: 9, flagId: 128 }] }, { targetSpecies: 143, evolutionSteps: [] });
  if (hasMap("MAP_CELADON_CITY_CONDOMINIUMS_ROOF_ROOM")) for (const path of paths(133)) {
    add({ captureSpecies: 133, captureLevel: 25, afterObjectiveId: "badge-thunder", encounterShare: 100,
      steps: [{ kind: "gift", species: 133, map: "MAP_CELADON_CITY_CONDOMINIUMS_ROOF_ROOM", objectIndex: 1 }] }, path);
  }
  if (hasMap("MAP_ROUTE2_HOUSE")) {
    const abra = [...entries.values()].find(x => x.captureSpecies === 63);
    if (abra) add({ id: "mr-mime", captureSpecies: 122, captureLevel: abra.captureLevel, afterObjectiveId: "teach-cut", encounterShare: abra.encounterShare,
      exclusiveKeys: [familyKey(63)],
      steps: [{ ...abra.steps[0], prerequisite: true, afterObjectiveId: abra.afterObjectiveId },
        { kind: "in-game-trade", map: "MAP_ROUTE2_HOUSE", objectIndex: 1, requestedSpecies: 63, receivedSpecies: 122,
          flagId: 584, afterObjectiveId: "teach-cut" }],
    }, { targetSpecies: 122, evolutionSteps: [] });
  }
  const candidates = freeze([...entries.values()].sort((a, b) => a.id.localeCompare(b.id)));
  const byId = new Map(candidates.map(x => [x.id, x]));
  const revision = createHash("sha256").update(JSON.stringify({ version: VERSION, facts, candidates, stones,
    trainers: data.trainers, stages: [...stageIndex], levels: CAMPAIGN_MAJOR_BATTLE_LEVEL_TARGETS })).digest("hex");
  const milestoneLevel = (at) => Math.max(5, ...Object.entries(CAMPAIGN_MAJOR_BATTLE_LEVEL_TARGETS)
    .filter(([id]) => stageIndex.has(id) && indexOf(id) <= at).map(([, x]) => x.battleTeamTargetLevel ?? 5));
  const starterEntry = starterSpecies => {
    const starter = starterForSpecies(starterSpecies);
    if (!starter) throw new TypeError("FireRed roster requires its selected Kanto starter");
    return { id: `starter-${starter.species}`, captureSpecies: starter.species, captureLevel: 5,
      targetSpecies: starter.finalSpecies, family: [...starter.family], familyKey: familyKey(starter.species),
      afterObjectiveId: "regional-pokedex", evolutionSteps: paths(starter.species).find(x => x.targetSpecies === starter.finalSpecies)?.evolutionSteps ?? [], steps: [] };
  };
  const profileCache = new Map();
  const profile = (member, at, level) => {
    const key = JSON.stringify([member.id, member.captureSpecies, member.captureLevel,
      member.afterObjectiveId, member.evolutionSteps, at, level]);
    if (profileCache.has(key)) return profileCache.get(key);
    let current = member.captureSpecies, start = member.captureLevel, known = (species[current]?.levelUpMoves ?? []).filter(x => x.level <= start).slice(-4).map(x => x.moveId);
    for (const step of member.evolutionSteps) {
      const anchor = step.afterObjectiveId ?? (step.kind === "item-evolution" ? later(member.afterObjectiveId,
        step.itemId === 94 ? mapAnchor(stones[0].map) : "badge-thunder") : member.afterObjectiveId);
      const evolutionLevel = step.kind === "level-evolution" ? Math.max(start, step.level)
        : Math.max(start, step.minimumLevel ?? milestoneLevel(indexOf(anchor)) + 1);
      if (indexOf(anchor) >= at || evolutionLevel > level) break;
      known.push(...species[current].levelUpMoves.filter(x => x.level > start && x.level <= evolutionLevel).map(x => x.moveId));
      current = step.targetSpecies; start = evolutionLevel;
      // Stone evolution doesn't grant arbitrary level-one moves retroactively.
      if (step.kind === "level-evolution") known.push(...species[current].levelUpMoves.filter(x => x.level === evolutionLevel).map(x => x.moveId));
    }
    known.push(...species[current].levelUpMoves.filter(x => x.level > start && x.level <= level).map(x => x.moveId));
    const result = { ...species[current], available: member.id.startsWith("starter-") || indexOf(member.afterObjectiveId) < at,
      attacks: [...new Set(known)].map(id => facts.moves[id]).filter(x => x && Number(x.power) > 1 && !/OHKO|EXPLOSION|SELF_DESTRUCT/.test(x.effect ?? "")) };
    profileCache.set(key, result); return result;
  };
  const hmDeadlines = { cut: indexOf("teach-cut"), fly: indexOf("poke-flute") + 0.5,
    surf: indexOf("teach-surf"), strength: indexOf("teach-strength") };
  const fieldMoveMinimumLevel = (member, move) => {
    let current = member.captureSpecies, minimumLevel = 0;
    for (const step of member.evolutionSteps) {
      if (species[current].fieldCapabilities.includes(move)) break;
      minimumLevel = Math.max(minimumLevel, step.level ?? step.minimumLevel ?? 0);
      current = step.targetSpecies;
    }
    return minimumLevel;
  };
  const battleProfile = (member, at, level, fieldMoves) => {
    const base = profile(member, at, level);
    const taught = Object.entries(hmDeadlines).filter(([move, deadline]) =>
      at > deadline && fieldMoves[move]?.[0] === member.family[0])
      .map(([move]) => facts.moves[FIRE_RED_FIELD_MOVES[move]]).filter(Boolean);
    return { ...base, attacks: [...new Map([...base.attacks, ...taught].map(m => [m.id, m])).values()] };
  };
  const assignHms = (members, allowMissing = false) => {
    const assignments = {}, load = new Map();
    for (const [move, at] of Object.entries(hmDeadlines)) {
      // Level evolution can be trained before teaching. Acquisition/stone
      // timing must still precede the HM, and mature carriers are preferred.
      const eligible = members.filter(x => { const p = profile(x, at, 100); return p.available && p.fieldCapabilities.includes(move); })
        .sort((a, b) => fieldMoveMinimumLevel(a, move) - fieldMoveMinimumLevel(b, move) ||
          (load.get(a.id) ?? 0) - (load.get(b.id) ?? 0) || a.id.localeCompare(b.id));
      if (!eligible.length) { if (allowMissing) continue; return null; }
      const selected = eligible[0]; assignments[move] = selected.family; load.set(selected.id, (load.get(selected.id) ?? 0) + 1);
    }
    for (const move of ["flash", "rockSmash"]) assignments[move] = members.find(x => profile(x, indexOf("champion"), 65).fieldCapabilities.includes(move))?.family ?? [];
    return assignments;
  };
  const bosses = Object.keys(createMasterTeamPlan(1, 0).battlePlans).map(id => {
    const names = new Set(IMPORTANT_BATTLE_TRAINER_NAMES[id] ?? []);
    const opponents = Object.values(data.trainers ?? {}).filter(x => names.has(x.name)).flatMap(x => x.party ?? [])
      .map(x => Object.values(species).find(s => s.name === x.species || s.id === x.species)).filter(Boolean);
    return { id, at: indexOf(id), level: CAMPAIGN_MAJOR_BATTLE_LEVEL_TARGETS[id]?.battleTeamTargetLevel ?? 65,
      opponents: [...new Map(opponents.map(x => [x.id, x])).values()] };
  });
  const moveValue = (move, attacker, defender) => {
    const abilities = (defender.abilities ?? []).filter(x => x !== "ABILITY_NONE");
    if (move.type === "TYPE_GROUND" && abilities.length && abilities.every(x => x === "ABILITY_LEVITATE")) return 0;
    return move.power * typeMultiplier(facts, move.type, defender.types) * (attacker.types.includes(move.type) ? 1.5 : 1) *
      (PHYSICAL_TYPES.has(move.type) ? attacker.baseAttack : attacker.baseSpAttack) / 80 * effectPenalty(move.effect);
  };
  const allocateResources = selected => {
    let stoneIndex = 0;
    return [...selected].sort((a, b) => indexOf(a.afterObjectiveId) - indexOf(b.afterObjectiveId) || a.id.localeCompare(b.id)).map(member => ({
      ...member, evolutionSteps: member.evolutionSteps.map(step => {
        if (step.kind === "level-evolution") return step;
        const pickup = step.itemId === 94 ? stones[stoneIndex++] : null;
        const anchor = later(step.afterObjectiveId ?? member.afterObjectiveId,
          later(member.afterObjectiveId, pickup ? mapAnchor(pickup.map) : "badge-thunder"));
        const itemSource = pickup ? { kind: "collect-item", itemId: step.itemId, flagId: pickup.flagId, target: pickup.target,
          map: pickup.map, objectIndex: pickup.index, afterObjectiveId: anchor }
          : { kind: "purchase", ...SHOP, itemId: step.itemId, stockIndex: STONES[step.itemId], price: 2100, afterObjectiveId: anchor };
        const minimumLevel = Math.max(member.captureLevel, milestoneLevel(indexOf(anchor)) + 1,
          ...member.evolutionSteps.filter(x => x.kind === "level-evolution").map(x => x.level));
        return { ...step, afterObjectiveId: anchor, minimumLevel, itemSource };
      }),
    }));
  };
  const evaluate = plan => {
    const starter = starterEntry(plan.starterFamily[0]);
    const reasons = [];
    if (plan.acquisitions.flatMap(x => x.evolutionSteps).filter(x => x.itemId === 94).length > stones.length) {
      return { viable: false, reasons: ["insufficient authored Moon Stones"] };
    }
    const acquisitions = allocateResources(plan.acquisitions), members = [starter, ...acquisitions];
    if (members.length !== 6 || new Set(members.map(x => x.familyKey)).size !== 6) reasons.push("six distinct acquisition lineages required");
    const exclusive = members.flatMap(x => x.exclusiveKeys ?? [x.familyKey]);
    if (new Set(exclusive).size !== exclusive.length) reasons.push("exclusive acquisition or trade prerequisite reused");
    const available = id => members.filter(x => x === starter || indexOf(x.afterObjectiveId) < indexOf(id)).length;
    if (available("rival-route22-early") < 2 || available("badge-cascade") < 2 || available("badge-rainbow") < 4) reasons.push("insufficient early/midgame partners");
    if (members.filter(x => indexOf(x.afterObjectiveId) > indexOf("hm-surf")).length > 1) reasons.push("too many late training burdens");
    const fieldMoves = assignHms(members);
    if (!fieldMoves) reasons.push("field move unavailable before its use (including circular Surf acquisition)");
    if (reasons.length) return { viable: false, reasons };
    const final = members.map(x => battleProfile(x, indexOf("champion"), 65, fieldMoves));
    if (!final.some(p => p.attacks.some(m => PHYSICAL_TYPES.has(m.type))) || !final.some(p => p.attacks.some(m => !PHYSICAL_TYPES.has(m.type)))) reasons.push("missing physical or special offense");
    for (const type of new Set((facts.typeChart ?? []).map(x => x.attackingType))) {
      const multipliers = final.map(p => typeMultiplier(facts, type, p.types));
      if (multipliers.filter(x => x > 1).length >= 3 && !multipliers.some(x => x < 1)) reasons.push(`unanswered shared ${type} weakness`);
    }
    for (const boss of bosses) {
      const ready = members.map(x => battleProfile(x, boss.at, boss.level, fieldMoves)).filter(x => x.available);
      for (const opponent of boss.opponents) {
        if (!ready.some(p => p.attacks.some(m => moveValue(m, p, opponent) >= 20))) { reasons.push(`no affordable planned attack for ${boss.id}:${opponent.id}`); break; }
      }
    }
    return { viable: reasons.length === 0, reasons, fieldMoves, acquisitions };
  };
  const generators = new Map();
  const structurallyCompatible = (starter, selected) => {
    const members = [starter, ...selected];
    const exclusive = members.flatMap(x => x.exclusiveKeys ?? [x.familyKey]);
    return selected.length === 5 && new Set(members.map(x => x.familyKey)).size === 6 &&
      new Set(exclusive).size === exclusive.length &&
      selected.flatMap(x => x.evolutionSteps).filter(x => x.itemId === 94).length <= stones.length;
  };
  const randomAssessment = (starter, selected, { helpers = "allowed" } = {}) => {
    if (!["allowed", "field-only", "none"].includes(helpers)) throw new Error("choose an available helper policy");
    if (!structurallyCompatible(starter, selected)) throw new Error("random roster has conflicting acquisition families or resources");
    const acquisitions = allocateResources(selected), members = [starter, ...acquisitions];
    const utilityAcquisitions = [], temporaryAcquisitions = [];
    const reserved = new Set(members.flatMap(x => x.exclusiveKeys ?? [x.familyKey]));
    const helperCandidates = () => candidates.filter(x => !(x.exclusiveKeys ?? [x.familyKey]).some(key => reserved.has(key)) &&
      !x.evolutionSteps.some(step => step.kind === "item-evolution") &&
      ["wild-capture", "gift"].includes(x.steps[0]?.kind));
    const helper = (candidate, role) => {
      const value = { ...candidate, id: `helper-${candidate.id}`, permanentRoster: false,
        temporaryRoster: true, helperRole: role, requiredBy: "champion" };
      for (const key of candidate.exclusiveKeys ?? [candidate.familyKey]) reserved.add(key);
      return value;
    };
    let fieldMoves = assignHms(members, true);
    for (const [move, deadline] of Object.entries(hmDeadlines)) {
      if (fieldMoves[move]) continue;
      if (helpers === "none") throw new Error(`This drawn team needs a field helper for ${move}. Enable helpers or choose a different team.`);
      const eligible = helperCandidates().filter(x => { const p = profile(x, deadline, 100); return p.available && p.fieldCapabilities.includes(move); })
        .sort((a,b) => fieldMoveMinimumLevel(a,move) - fieldMoveMinimumLevel(b,move) || indexOf(a.afterObjectiveId)-indexOf(b.afterObjectiveId) || a.id.localeCompare(b.id));
      if (!eligible.length) throw new Error(`No supported field helper can learn ${move} before it is required.`);
      utilityAcquisitions.push(helper(eligible[0], "field"));
      fieldMoves = assignHms([...members, ...utilityAcquisitions], true);
    }
    if (helpers === "allowed" && members.filter(x => profile(x,indexOf("badge-boulder"),15).available).length < 2) {
      const early = helperCandidates().filter(x => indexOf(x.afterObjectiveId) < indexOf("rival-route22-early"))
        .sort((a,b) => Number(b.captureSpecies === 56) - Number(a.captureSpecies === 56) || a.id.localeCompare(b.id));
      if (!early.length) throw new Error("No supported early combat helper is available for this drawn team.");
      temporaryAcquisitions.push(helper(early[0], "combat"));
    }
    return { viable: true, acquisitions, fieldMoves, utilityAcquisitions, temporaryAcquisitions, helpers };
  };
  const assemble = (starterSpecies, seed, selected, randomOptions = null) => {
    const common = createMasterTeamPlan(starterSpecies, seed), starter = starterEntry(starterSpecies);
    const preliminary = { starterFamily: common.starterFamily, acquisitions: selected };
    const assessment = randomOptions ? randomAssessment(starter,selected,randomOptions) : evaluate(preliminary);
    if (!assessment.viable) throw new Error(`checkpoint generated roster is not viable: ${assessment.reasons.join("; ")}`);
    const materialize = member => {
      const steps = [...member.steps];
      for (const step of member.evolutionSteps) {
        if (step.kind === "level-evolution") { steps.push(step); continue; }
        steps.push(step.itemSource, step);
      }
      if (steps[0]?.rodItemId) steps.unshift({ kind: "key-item-gift", itemId: steps[0].rodItemId, ...RODS[steps[0].rodItemId] });
      return { ...member, steps };
    };
    const acquisitions = assessment.acquisitions.map(materialize);
    const utilityAcquisitions = (assessment.utilityAcquisitions ?? []).map(materialize);
    const temporaryAcquisitions = (assessment.temporaryAcquisitions ?? []).map(materialize);
    const members = [starter, ...acquisitions];
    const fieldMembers = [...members, ...utilityAcquisitions];
    const battlePlans = Object.fromEntries(bosses.map(boss => {
      const availableMembers = members.filter(x => profile(x, boss.at, boss.level).available);
      if (availableMembers.length < 6 && boss.at < indexOf("elite-four-lorelei")) {
        availableMembers.push(...temporaryAcquisitions.filter(x => profile(x,boss.at,boss.level).available));
      }
      const preferred = [...availableMembers].sort((a, b) => {
        const score = member => { const p = battleProfile(member, boss.at, boss.level, assessment.fieldMoves); return boss.opponents.reduce((sum, opponent) => sum + Math.max(0, ...p.attacks.map(m => moveValue(m, p, opponent))), 0); };
        return score(b) - score(a) || a.id.localeCompare(b.id);
      });
      return [boss.id, { coverageTypes: common.battlePlans[boss.id].coverageTypes,
        availableFamilies: availableMembers.map(x => x.family), preferredFamilies: preferred.map(x => x.family) }];
    }));
    const route16Fly = [...acquisitions, ...utilityAcquisitions].find(x => x.afterObjectiveId === "poke-flute" && x.family[0] === assessment.fieldMoves.fly[0] && x.id !== "snorlax");
    const fieldMoveMinimumLevels = Object.fromEntries(Object.keys(hmDeadlines).map(move => {
      const member = fieldMembers.find(x => x.family[0] === assessment.fieldMoves[move][0]);
      return [move, fieldMoveMinimumLevel(member, move)];
    }));
    const selection = randomOptions ? RANDOM_ROSTER_VERSION : VERSION;
    const surfFamilies = [starter.family, ...acquisitions.filter(x => indexOf(x.afterObjectiveId) < indexOf("hm-surf")).map(x => x.family)];
    if (randomOptions && !surfFamilies.some(f => f[0] === assessment.fieldMoves.surf[0])) {
      surfFamilies.splice(Math.min(1,surfFamilies.length),0,assessment.fieldMoves.surf);
    }
    return freeze({ ...common, provenance: { ...common.provenance, selection, catalogRevision: revision },
      acquisitions, permanentFamilies: [starter.family, ...acquisitions.map(x => x.family)],
      ...(randomOptions ? { utilityAcquisitions, temporaryAcquisitions,
        rosterPolicy: { ...common.rosterPolicy, allowTemporaryMembers: assessment.helpers !== "none", helpers: assessment.helpers } } : {}),
      hallOfFameSpecies: [starter.targetSpecies, ...acquisitions.map(x => x.targetSpecies)],
      fieldMoves: assessment.fieldMoves, fieldMoveMinimumLevels, battlePlans,
      route16FlyAcquisitionId: route16Fly?.id ?? null,
      surfAssemblyFamilies: surfFamilies.slice(0,6),
      coherence: { version: selection, catalogRevision: revision, candidateCount: candidates.length,
        rawCombinationCount: generators.get(starterSpecies)?.rawCombinationCount ?? null,
        basis: randomOptions ? "random evolutionary families; acquisition constraints only; helpers separate from the permanent six" : "native encounter/evolution/learnset/HM facts plus explicit progression constraints",
        qualification: "generated plan, not an autonomous completion" },
    });
  };
  return Object.freeze({ gameId: "firered-rev1-stock", version: VERSION, revision, candidates, exclusions: freeze(exclusions), evaluate,
    createFieldTeamPlan(committed) {
      // Runtime policy is separate from the historical random draw. Rebuilding
      // old run commitments must keep producing the exact original roster.
      const plan = structuredClone(committed);
      plan.fieldPolicy = 'utility-hms-v1';
      plan.utilityAcquisitions ??= [];
      plan.fieldMoveMinimumLevels ??= {};
      const restricted = ['cut', 'flash', 'rockSmash'];
      const combat = new Set([...(plan.starterFamily ?? []), ...(plan.permanentFamilies ?? []).flat(),
        ...(plan.temporaryAcquisitions ?? []).filter(a => a.helperRole !== 'field').flatMap(a => a.family)]);
      const supports = (a, move) => (species[a.captureSpecies]?.fieldCapabilities ?? []).includes(move);
      const nativeUtilities=candidates.filter(a => !a.family.some(id => combat.has(id)) &&
        restricted.some(move=>supports(a,move)) && indexOf(a.afterObjectiveId) < indexOf('teach-cut') &&
        a.steps.length === 1 && a.steps[0].kind === 'wild-capture' &&
        !a.steps[0].rodItemId && !a.steps[0].safari && a.steps[0].targetKind !== 'surf-zone');
      const utility = source => ({...structuredClone(source),id:`hm-utility-${source.captureSpecies}`,
        label:species[source.captureSpecies].name.replace('SPECIES_',''),
        targetSpecies:source.captureSpecies,evolutionSteps:[],
        fieldCapabilities:[...species[source.captureSpecies].fieldCapabilities],
        permanentRoster:false,temporaryRoster:true,helperRole:'field',fieldPolicyUtility:true});
      // Alternatives are candidates, not extra scheduled captures. A resumed
      // run can use one when the preferred habitat is behind a one-way route.
      plan.fieldUtilityAlternatives=[...new Map(nativeUtilities.map(a=>[a.captureSpecies,utility(a)])).values()];
      for (const move of restricted) {
        let carrier = plan.utilityAcquisitions.find(a =>
          isHmUtilityCarrier({species:a.captureSpecies},plan) && supports(a,move) &&
          indexOf(a.afterObjectiveId) < indexOf('teach-cut'));
        if (!carrier) {
          // Only native, early land encounters: no evolutions, traded donors,
          // fishing prerequisites or access requiring the HM being supplied.
          const eligible = nativeUtilities.filter(a=>supports(a,move));
          eligible.sort((a,b) => restricted.filter(m=>supports(b,m)).length - restricted.filter(m=>supports(a,m)).length ||
            a.availabilityOrder-b.availabilityOrder || a.captureLevel-b.captureLevel ||
            b.encounterShare-a.encounterShare || a.id.localeCompare(b.id));
          const source=eligible[0];
          if (!source) throw new Error(`No native utility carrier is available before ${move}.`);
          carrier = plan.utilityAcquisitions.find(a=>a.id===`hm-utility-${source.captureSpecies}`);
          if (!carrier) {
            carrier=utility(source);
            plan.utilityAcquisitions.push(carrier);
          }
        }
        plan.fieldMoves[move]=[...carrier.family];
        plan.fieldMoveMinimumLevels[move]=0;
      }
      plan.rosterPolicy={...plan.rosterPolicy,allowTemporaryMembers:true,
        helpers:plan.rosterPolicy?.helpers==='allowed'?'allowed':'field-only'};
      return freeze(plan);
    },
    createRandomTeamPlan(starterSpecies, seed, teamSeed, acquisitionIds = null, options = {}) {
      const starter = starterEntry(starterSpecies);
      const selected = acquisitionIds ? acquisitionIds.map(id => { const entry=byId.get(id); if (!entry) throw new Error(`unknown committed roster acquisition ${id}`); return entry; })
        : drawRandomFamilies({ candidates: candidates.filter(x => x.familyKey !== starter.familyKey), seed: teamSeed,
          scope: `firered:${starterSpecies}:${revision}`, accept: selected => structurallyCompatible(starter,selected) });
      return assemble(starterSpecies,seed,selected,options);
    },
    createTeamPlan(starterSpecies, seed, teamSeed, acquisitionIds = null) {
      const starter = starterEntry(starterSpecies);
      if (!generators.has(starterSpecies)) generators.set(starterSpecies, createRosterGenerator({ gameId: `firered-rev1-stock:${starterSpecies}:${revision}`,
        candidates: candidates.filter(x => x.familyKey !== starter.familyKey),
        acceptTeam: selected => evaluate({ starterFamily: starter.family, acquisitions: selected }).viable }));
      const selected = acquisitionIds ? acquisitionIds.map(id => { const entry = byId.get(id); if (!entry) throw new Error(`unknown committed roster acquisition ${id}`); return entry; })
        : generators.get(starterSpecies).select(teamSeed).members;
      return assemble(starterSpecies, seed, selected);
    },
  });
}
