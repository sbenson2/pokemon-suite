// Crystal team-plan scorer (reform P1-3): ranks candidate members by campaign
// efficiency computed from the cartridge data already in the knowledge pack —
// no tier list, no speedrun source. For every mandatory boss reachable after
// the candidate joins, the candidate's evolved form at the contract's target
// level (the boss's ace level) fights each enemy party member with the Gen II
// damage formula (tactics.mjs estimateDamage); a matchup is won when the
// candidate knocks the enemy out before it is knocked out itself. That
// battle value is then adjusted by growth rate (data/growth_rates.asm),
// encounter cost (data/wild/johto_grass.asm slot rates, probabilities.asm),
// evolution determinism (data/pokemon/evos_attacks.asm: level > happiness >
// trade/stone) and HM coverage (data/pokemon/base_stats/*.asm TM/HM lists).

import { MANDATORY_BOSSES } from '../index.mjs';
import { buildBattleContract } from './contracts.mjs';
import { estimateDamage } from './tactics.mjs';

/** data/wild/probabilities.asm GrassMonProbTable: 30/30/20/10/5/4/1 %. */
export const GRASS_SLOT_RATES = Object.freeze([30, 30, 20, 10, 5, 4, 1]);

/** data/growth_rates.asm: exp(n) = (a/b)·n³ + c·n² + d·n − e. */
const GROWTH = Object.freeze({
  GROWTH_MEDIUM_FAST: [1, 1, 0, 0, 0],
  GROWTH_SLIGHTLY_FAST: [3, 4, 10, 0, 30],
  GROWTH_SLIGHTLY_SLOW: [3, 4, 20, 0, 70],
  GROWTH_MEDIUM_SLOW: [6, 5, -15, 100, 140],
  GROWTH_FAST: [4, 5, 0, 0, 0],
  GROWTH_SLOW: [5, 4, 0, 0, 0],
});

export function experienceForLevel(growthRate, level) {
  const [a, b, c, d, e] = GROWTH[growthRate] ?? GROWTH.GROWTH_MEDIUM_FAST;
  return Math.max(0, Math.floor((a * level ** 3) / b + c * level ** 2 + d * level - e));
}

const HM_MOVES = Object.freeze(['CUT', 'FLY', 'SURF', 'STRENGTH', 'FLASH', 'WHIRLPOOL', 'WATERFALL', 'ROCK_SMASH']);

/** Gen II stat formula with a fixed DV and no stat experience (conservative, symmetric for both sides). */
export function statsAtLevel(species, level, { dv = 8 } = {}) {
  const base = species.baseStats;
  const stat = (value) => Math.floor(((value + dv) * 2 * level) / 100) + 5;
  return {
    hp: Math.floor(((base.hp + dv) * 2 * level) / 100) + level + 10,
    attack: stat(base.attack),
    defense: stat(base.defense),
    speed: stat(base.speed),
    specialAttack: stat(base.specialAttack),
    specialDefense: stat(base.specialDefense),
  };
}

/**
 * The form a species reaches by `level` under this run's rules: level
 * evolutions always, happiness evolutions when allowed (the live run's members
 * sit at 187-255 happiness from level-ups alone), never trade or stone.
 * Returns the chain of species ids (base first) and the determinism factor.
 */
export function formAtLevel(knowledge, speciesId, level, { allowHappiness = true } = {}) {
  const chain = [speciesId];
  let determinism = 1;
  let current = speciesId;
  for (let hop = 0; hop < 3; hop += 1) {
    const evolutions = knowledge.learnsets.get(current)?.evolutions ?? [];
    let next = null;
    for (const evolution of evolutions) {
      const target = evolution.arguments[evolution.arguments.length - 1];
      const targetId = knowledge.speciesIds.get(target);
      if (!targetId) continue;
      if (evolution.method === 'LEVEL' && level >= Number(evolution.arguments[0])) { next = targetId; break; }
      if (evolution.method === 'HAPPINESS' && allowHappiness && level >= 30) { next = targetId; determinism *= 0.85; break; }
    }
    if (!next) break;
    chain.push(next);
    current = next;
  }
  return { speciesId: current, chain, determinism };
}

/** Level-up moves known by `level` across the evolution chain (pre-evolution moves carry over), best four by damage value. */
export function movesAtLevel(knowledge, chain, level, { machines = [], finalSpeciesId = chain[chain.length - 1], attackerTypeIds = [] } = {}) {
  const known = new Map();
  for (const speciesId of chain) {
    for (const entry of knowledge.learnsets.get(speciesId)?.moves ?? []) {
      if (entry.level <= level && entry.moveId) known.set(entry.move, entry.moveId);
    }
  }
  for (const name of machines) {
    const id = knowledge.moveIds.get(name);
    if (id && knowledge.canLearnMachine(finalSpeciesId, name)) known.set(name, id);
  }
  const value = (id) => {
    const move = knowledge.moves.get(id);
    if (!move) return 0;
    const stab = attackerTypeIds.includes(move.typeId) ? 1.5 : 1;
    return move.power * stab * (move.accuracy > 0 ? move.accuracy / 100 : 1);
  };
  return [...known.entries()]
    .map(([name, id]) => ({ id, name, value: value(id) }))
    .sort((left, right) => right.value - left.value)
    .slice(0, 4)
    .map(({ id, name }, slot) => ({ slot, id, name, pp: 10 }));
}

function combatant(knowledge, speciesId, level, moves, { dv = 8 } = {}) {
  const species = knowledge.species.get(speciesId);
  return { speciesId, speciesName: species.name, level, ...statsAtLevel(species, level, { dv }), typeIds: species.typeIds, moves };
}

/** Best expected damage the attacker can deal per turn with its current moves. */
function bestDamage(knowledge, attacker, defender) {
  let best = 0;
  for (const slotMove of attacker.moves) {
    const move = knowledge.moves.get(slotMove.id);
    if (!move || move.power === 0) continue;
    const accuracy = move.accuracy > 0 ? move.accuracy / 100 : 1;
    best = Math.max(best, estimateDamage({ knowledge, attacker, defender, move, roll: 217 }) * accuracy);
  }
  return best;
}

/**
 * One duel: turns the member needs to knock the enemy out versus hits it can
 * take. Value 1 = exactly enough; above 1 = spare turns; below 1 = loses.
 */
export function duelValue(knowledge, member, enemy) {
  const mine = bestDamage(knowledge, member, enemy);
  const theirs = bestDamage(knowledge, enemy, member);
  const turnsToKnockOut = mine > 0 ? Math.ceil(enemy.hp / mine) : Infinity;
  const hitsSurvived = theirs > 0 ? Math.floor((member.hp - 1) / theirs) + 1 : Infinity;
  const faster = member.speed > enemy.speed ? 1 : 0;
  if (turnsToKnockOut === Infinity) return 0;
  if (hitsSurvived === Infinity) return 2;
  return Math.min(2, (hitsSurvived + faster) / turnsToKnockOut);
}

const bossIndex = (bossId) => MANDATORY_BOSSES.findIndex((boss) => boss.id === bossId);

/**
 * Battle value of a candidate at each mandatory boss from `availableFrom`
 * onward: the candidate at the contract's target level (ace level) against
 * every enemy party member, averaged.
 */
export function bossValues({ knowledge, starter, candidate, contracts }) {
  const from = bossIndex(candidate.availableFrom);
  const values = [];
  for (const boss of MANDATORY_BOSSES) {
    if (bossIndex(boss.id) < from) continue;
    const contract = contracts.get(boss.id);
    if (!contract) continue;
    const level = contract.targetLevel;
    const form = formAtLevel(knowledge, candidate.speciesId, level, { allowHappiness: candidate.allowHappiness ?? true });
    const species = knowledge.species.get(form.speciesId);
    const moves = movesAtLevel(knowledge, form.chain, level, { machines: candidate.machines ?? [], finalSpeciesId: form.speciesId, attackerTypeIds: species.typeIds });
    const member = combatant(knowledge, form.speciesId, level, moves);
    const duels = contract.enemyParty.map((enemyEntry) => {
      const enemySpeciesId = enemyEntry.speciesId ?? knowledge.speciesIds.get(enemyEntry.species);
      const enemyMoves = (enemyEntry.moves?.length ? enemyEntry.moves.map((name, slot) => ({ slot, id: knowledge.moveIds.get(name), name, pp: 10 })) : movesAtLevel(knowledge, [enemySpeciesId], enemyEntry.level, { attackerTypeIds: knowledge.species.get(enemySpeciesId).typeIds }));
      const enemy = combatant(knowledge, enemySpeciesId, enemyEntry.level, enemyMoves, { dv: 8 });
      return duelValue(knowledge, member, enemy);
    });
    values.push({ bossId: boss.id, level, form: species.name, determinism: form.determinism, value: duels.reduce((sum, value) => sum + value, 0) / Math.max(1, duels.length) });
  }
  return values;
}

/** Encounter probability per attempt from the grass table of the capture map (mean over the time buckets where it appears at all). */
export function encounterProbability(knowledge, candidate) {
  if (candidate.method === 'fixed' || candidate.method === 'gift' || candidate.method === 'egg') return { probability: 1, buckets: ['any'] };
  if (candidate.method === 'headbutt') return { probability: candidate.probability ?? 0.3, buckets: ['any'] };
  const table = knowledge.grass.get(candidate.mapId);
  if (!table) return { probability: 0, buckets: [] };
  const buckets = [];
  let total = 0;
  for (const bucket of ['morn', 'day', 'nite']) {
    let probability = 0;
    (table[bucket] ?? []).forEach((entry, slot) => { if (entry.species === candidate.species) probability += GRASS_SLOT_RATES[slot] / 100; });
    if (probability > 0) { buckets.push(bucket); total += probability; }
  }
  return { probability: buckets.length ? total / buckets.length : 0, buckets, dayFraction: buckets.length / 3 };
}

export const DEFAULT_WEIGHTS = Object.freeze({ growth: 0.3, encounter: 0.1, hm: 0.05, timeGate: 0.15 });

/**
 * Scores one candidate: mean boss value × determinism, minus growth cost
 * relative to MEDIUM_FAST at the Champion's ace level, minus encounter cost
 * (log2 of expected attempts, plus a time-of-day gate penalty), plus HM coverage.
 */
export function scoreCandidate({ knowledge, starter, candidate, contracts, weights = DEFAULT_WEIGHTS }) {
  const values = bossValues({ knowledge, starter, candidate, contracts });
  const battle = values.length ? values.reduce((sum, entry) => sum + entry.value, 0) / values.length : 0;
  const determinism = values.length ? values[values.length - 1].determinism : 1;
  const species = knowledge.species.get(candidate.speciesId);
  const championLevel = contracts.get('LANCE')?.targetLevel ?? 50;
  const growthRatio = experienceForLevel(species.growthRate, championLevel) / experienceForLevel('GROWTH_MEDIUM_FAST', championLevel);
  const encounter = encounterProbability(knowledge, candidate);
  const attempts = encounter.probability > 0 ? 1 / encounter.probability : 64;
  const finalForm = values.length ? values[values.length - 1].form : species.name;
  const hmCoverage = HM_MOVES.filter((move) => knowledge.canLearnMachine(knowledge.speciesIds.get(finalForm), move));
  // Time gates cost log2(1/fraction) under the host-time clock: night-only
  // (1/3 of the day) is cheap to wait for, a weekday-only encounter (1/7) is not.
  const dayFraction = candidate.dayFraction ?? encounter.dayFraction ?? 1;
  const timeGate = dayFraction < 1 ? Math.log2(1 / dayFraction) : 0;
  const score = battle * determinism
    - weights.growth * Math.max(0, growthRatio - 1)
    - weights.encounter * Math.log2(attempts)
    - weights.timeGate * timeGate
    + weights.hm * hmCoverage.length;
  return Object.freeze({
    species: candidate.species, finalForm, availableFrom: candidate.availableFrom, method: candidate.method, mapId: candidate.mapId ?? null,
    battle: Number(battle.toFixed(3)), determinism, growthRatio: Number(growthRatio.toFixed(3)), encounterProbability: Number(encounter.probability.toFixed(3)),
    buckets: encounter.buckets, hmCoverage, score: Number(score.toFixed(3)), bosses: values,
  });
}

/**
 * Greedy team of `size` members that maximises per-boss coverage: at each
 * step add the candidate that most raises Σ_boss max(member value), so the
 * team covers different bosses instead of stacking one type.
 */
export function chooseTeam({ scored, size = 5 }) {
  const bosses = MANDATORY_BOSSES.map((boss) => boss.id);
  const valueAt = (entry, bossId) => entry.bosses.find((boss) => boss.bossId === bossId)?.value ?? 0;
  const team = [];
  const coverage = new Map(bosses.map((bossId) => [bossId, 0]));
  const pool = scored.filter((entry) => entry.score > 0);
  while (team.length < size && pool.length > 0) {
    let best = null;
    for (const entry of pool) {
      if (team.includes(entry)) continue;
      let gain = 0;
      for (const bossId of bosses) gain += Math.max(0, valueAt(entry, bossId) * entry.determinism - coverage.get(bossId));
      // Coverage gained minus the candidate's non-battle costs (growth,
      // encounter, time gate, less HM credit), so a rare morning-only find
      // never beats a fixed encounter of similar strength.
      const costs = entry.battle * entry.determinism - entry.score;
      const merit = gain - costs * bosses.length / 4 + entry.score * 0.5;
      if (!best || merit > best.merit) best = { entry, merit };
    }
    if (!best) break;
    team.push(best.entry);
    for (const bossId of bosses) coverage.set(bossId, Math.max(coverage.get(bossId), valueAt(best.entry, bossId) * best.entry.determinism));
  }
  return { team, coverage: Object.fromEntries(coverage) };
}

/**
 * Candidate pool: deterministic acquisitions on the campaign path, with the
 * boss before which each one becomes reachable. Grass rates come from the
 * knowledge pack; fixed encounters cite their map scripts.
 */
export function defaultCandidates(knowledge) {
  const id = (name) => knowledge.speciesIds.get(name);
  const grass = (species, mapId, availableFrom, extra = {}) => ({ species, speciesId: id(species), method: 'grass', mapId, availableFrom, ...extra });
  return [
    grass('ZUBAT', 'DARK_CAVE_VIOLET_ENTRANCE', 'FALKNER', { machines: ['FLY'] }),
    grass('GEODUDE', 'DARK_CAVE_VIOLET_ENTRANCE', 'FALKNER', { machines: ['STRENGTH', 'ROCK_SMASH'] }),
    grass('GASTLY', 'SPROUT_TOWER_2F', 'FALKNER'),
    grass('WOOPER', 'ROUTE_32', 'BUGSY', { machines: ['SURF', 'STRENGTH', 'ICE_PUNCH', 'WHIRLPOOL', 'WATERFALL'] }),
    grass('ONIX', 'UNION_CAVE_1F', 'BUGSY', { machines: ['STRENGTH', 'ROCK_SMASH'] }),
    grass('SLOWPOKE', 'SLOWPOKE_WELL_B1F', 'BUGSY', { machines: ['SURF', 'STRENGTH', 'ICE_PUNCH', 'FIRE_PUNCH'] }),
    grass('HOPPIP', 'ROUTE_32', 'BUGSY'),
    grass('ABRA', 'ROUTE_34', 'WHITNEY', { machines: ['ICE_PUNCH', 'FIRE_PUNCH', 'THUNDERPUNCH'] }),
    grass('GROWLITHE', 'ROUTE_36', 'RIVAL_BURNED_TOWER'),
    { species: 'HERACROSS', speciesId: id('HERACROSS'), method: 'headbutt', mapId: 'AZALEA_TOWN', availableFrom: 'WHITNEY', probability: 0.3, machines: ['STRENGTH', 'ROCK_SMASH'] },
    { species: 'SUDOWOODO', speciesId: id('SUDOWOODO'), method: 'fixed', mapId: 'ROUTE_36', availableFrom: 'RIVAL_BURNED_TOWER', machines: ['STRENGTH', 'ROCK_SMASH'] },
    grass('MAGNEMITE', 'ROUTE_38', 'MORTY', { machines: ['FLASH'] }),
    grass('MILTANK', 'ROUTE_38', 'MORTY', { machines: ['STRENGTH', 'ICE_PUNCH', 'FIRE_PUNCH', 'THUNDERPUNCH'] }),
    grass('TAUROS', 'ROUTE_38', 'MORTY', { machines: ['STRENGTH'] }),
    { species: 'LAPRAS', speciesId: id('LAPRAS'), method: 'fixed', mapId: 'UNION_CAVE_B2F', availableFrom: 'CHUCK', dayFraction: 1 / 7, machines: ['SURF', 'STRENGTH', 'ICE_PUNCH', 'THUNDERPUNCH', 'WHIRLPOOL', 'WATERFALL'] },
    { species: 'GYARADOS', speciesId: id('GYARADOS'), method: 'fixed', mapId: 'LAKE_OF_RAGE', availableFrom: 'PRYCE', machines: ['SURF', 'STRENGTH', 'WHIRLPOOL', 'WATERFALL'] },
    grass('GLIGAR', 'ROUTE_45', 'CLAIR', { machines: ['STRENGTH'] }),
    grass('SWINUB', 'ICE_PATH_1F', 'CLAIR', { machines: ['STRENGTH'] }),
    grass('SKARMORY', 'ROUTE_45', 'CLAIR', { machines: ['FLY'] }),
    grass('PHANPY', 'ROUTE_46', 'FALKNER', { machines: ['STRENGTH', 'ROCK_SMASH'] }),
    grass('TEDDIURSA', 'DARK_CAVE_VIOLET_ENTRANCE', 'FALKNER', { machines: ['STRENGTH', 'ROCK_SMASH'] }),
  ].filter((candidate) => candidate.speciesId);
}

/** Full ranking for one starter plus the greedy team pick. */
export function scoreTeamPlan({ knowledge, starter, candidates = defaultCandidates(knowledge), weights = DEFAULT_WEIGHTS, size = 5 }) {
  const contracts = new Map(MANDATORY_BOSSES.map((boss) => [boss.id, buildBattleContract({ knowledge, bossId: boss.id, starter })]));
  const scored = candidates.map((candidate) => scoreCandidate({ knowledge, starter, candidate, contracts, weights })).sort((left, right) => right.score - left.score);
  const { team, coverage } = chooseTeam({ scored, size });
  return Object.freeze({ starter, scored, team, coverage });
}
