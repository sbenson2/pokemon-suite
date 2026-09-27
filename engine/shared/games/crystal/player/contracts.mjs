// Important-battle contracts (reform P0-1), derived from the cartridge's own
// trainer parties (data/trainers/parties.asm via the knowledge pack) for
// every mandatory boss in MANDATORY_BOSSES. A contract fixes the enemy level
// curve and ace, and the readiness band the whole battle roster must reach:
// ace to ace+2, no starter privilege, no hand-written level floors.
//
// Readiness is evaluated per party member with a role: the starter and the
// team plan's species (and their evolutions) are battle members; anything
// else (a Surf learner, a gift egg) is a utility carrier and is never trained
// for a boss. The trainee is the battle member furthest below the target.

import { MANDATORY_BOSSES, teamPlanForStarter } from '../index.mjs';

export const CONTRACT_SCHEMA = 'pokemon-research/crystal-battle-contract/v1';
export const READINESS_BAND_ABOVE_ACE = 2;
export const MAXIMUM_REQUIRED_MEMBERS = 5;

const STARTER_FAMILIES = Object.freeze({ CHIKORITA: ['CHIKORITA', 'BAYLEEF', 'MEGANIUM'], CYNDAQUIL: ['CYNDAQUIL', 'QUILAVA', 'TYPHLOSION'], TOTODILE: ['TOTODILE', 'CROCONAW', 'FERALIGATR'] });

/**
 * Trainer group and id per boss. The rival's party depends on the player's
 * starter: maps/CherrygroveCity.asm loads RIVAL1_n_CYNDAQUIL for a CHIKORITA
 * player, _TOTODILE for CYNDAQUIL and _CHIKORITA for TOTODILE; the ids are
 * 3·encounter + variant in parties.asm (1 CHIKORITA, 2 CYNDAQUIL, 3 TOTODILE).
 */
const rival = (encounter) => Object.freeze({ group: 'Rival1', ids: Object.freeze({ CHIKORITA: encounter * 3 + 2, CYNDAQUIL: encounter * 3 + 3, TOTODILE: encounter * 3 + 1 }) });
export const BOSS_TRAINERS = Object.freeze({
  FALKNER: { group: 'Falkner', id: 1 },
  RIVAL_CHERRYGROVE: rival(0),
  BUGSY: { group: 'Bugsy', id: 1 },
  RIVAL_AZALEA: rival(1),
  WHITNEY: { group: 'Whitney', id: 1 },
  RIVAL_BURNED_TOWER: rival(2),
  MORTY: { group: 'Morty', id: 1 },
  CHUCK: { group: 'Chuck', id: 1 },
  JASMINE: { group: 'Jasmine', id: 1 },
  PRYCE: { group: 'Pryce', id: 1 },
  ROCKET_EXECUTIVE_F_2: { group: 'ExecutiveF', id: 2 },
  ROCKET_EXECUTIVE_M_4: { group: 'ExecutiveM', id: 4 },
  RIVAL_GOLDENROD_UNDERGROUND: rival(3),
  ROCKET_EXECUTIVE_M_3: { group: 'ExecutiveM', id: 3 },
  ROCKET_EXECUTIVE_M_2: { group: 'ExecutiveM', id: 2 },
  ROCKET_EXECUTIVE_F_1: { group: 'ExecutiveF', id: 1 },
  ROCKET_EXECUTIVE_M_1: { group: 'ExecutiveM', id: 1 },
  CLAIR: { group: 'Clair', id: 1 },
  RIVAL_VICTORY_ROAD: rival(4),
  WILL: { group: 'Will', id: 1 },
  KOGA: { group: 'Koga', id: 1 },
  BRUNO: { group: 'Bruno', id: 1 },
  KAREN: { group: 'Karen', id: 1 },
  LANCE: { group: 'Champion', id: 1 },
});

const speciesKey = (name) => String(name).replace(/^SPECIES_/, '');

export function bossTrainer(knowledge, bossId, starter = null) {
  const entry = BOSS_TRAINERS[bossId];
  if (!entry) throw new RangeError(`no trainer mapping for Crystal boss ${bossId}`);
  const trainerId = entry.id ?? entry.ids?.[starter];
  if (!Number.isInteger(trainerId)) throw new RangeError(`boss ${bossId} needs the player's starter to pick the rival party`);
  const group = knowledge.parties.groups.get(entry.group);
  const trainer = group?.trainers.find((candidate) => candidate.id === trainerId) ?? null;
  if (!trainer) throw new RangeError(`trainer ${entry.group} #${trainerId} is not in data/trainers/parties.asm`);
  return Object.freeze({
    group: entry.group,
    id: trainerId,
    name: trainer.name,
    kind: trainer.kind,
    party: Object.freeze(trainer.party.map((member) => Object.freeze({
      species: speciesKey(member.species),
      speciesId: knowledge.speciesIds.get(speciesKey(member.species)) ?? null,
      level: member.level,
      moves: Object.freeze(member.moves ?? []),
      item: member.item ?? null,
    }))),
  });
}

export function buildBattleContract({ knowledge, bossId, starter = null }) {
  const boss = MANDATORY_BOSSES.find((entry) => entry.id === bossId);
  if (!boss) throw new RangeError(`unknown Crystal boss ${bossId}`);
  const trainer = bossTrainer(knowledge, bossId, starter);
  const levels = trainer.party.map((member) => member.level);
  const aceLevel = Math.max(...levels);
  const ace = trainer.party.find((member) => member.level === aceLevel);
  return Object.freeze({
    schema: CONTRACT_SCHEMA,
    id: bossId,
    category: boss.category,
    trainer: Object.freeze({ group: trainer.group, id: trainer.id, name: trainer.name }),
    enemyParty: trainer.party,
    enemyPartyLevels: Object.freeze(levels),
    enemyPartySize: levels.length,
    enemyAceLevel: aceLevel,
    enemyAce: Object.freeze({ species: ace.species, speciesId: ace.speciesId, level: ace.level }),
    targetLevel: aceLevel,
    ceilingLevel: aceLevel + READINESS_BAND_ABOVE_ACE,
    evidence: Object.freeze(['data/trainers/parties.asm', boss.source.file]),
  });
}

export function buildAllContracts({ knowledge, starter }) {
  return new Map(MANDATORY_BOSSES.map((boss) => [boss.id, buildBattleContract({ knowledge, bossId: boss.id, starter })]));
}

/** Species ids of `speciesName` and every forward evolution (data/pokemon/evos_attacks.asm). */
export function evolutionFamily(knowledge, speciesName) {
  const ids = new Set();
  const visit = (name) => {
    const id = knowledge.speciesIds.get(speciesKey(name));
    if (!id || ids.has(id)) return;
    ids.add(id);
    for (const evolution of knowledge.learnsets.get(id)?.evolutions ?? []) visit(evolution.arguments.at(-1));
  };
  visit(speciesName);
  return ids;
}

const planMembers = (starter, teamPlan) => {
  try { return teamPlanForStarter(starter, { version: teamPlan }).members ?? []; } catch { return []; }
};

/** Species ids of the starter family plus every plan species and its forward evolutions. */
export function battleFamilies(knowledge, starter, { teamPlan = 'v1' } = {}) {
  const ids = new Set();
  for (const name of STARTER_FAMILIES[starter] ?? []) for (const id of evolutionFamily(knowledge, name)) ids.add(id);
  for (const member of planMembers(starter, teamPlan)) for (const id of evolutionFamily(knowledge, member.species)) ids.add(id);
  return ids;
}

export function classifyParty(observation, { knowledge, starter, teamPlan = 'v1' }) {
  const families = battleFamilies(knowledge, starter, { teamPlan });
  const starterIds = new Set((STARTER_FAMILIES[starter] ?? []).map((name) => knowledge.speciesIds.get(name)));
  const familyOf = new Map();
  for (const member of planMembers(starter, teamPlan)) {
    for (const id of evolutionFamily(knowledge, member.species)) if (!familyOf.has(id)) familyOf.set(id, member.species);
  }
  const roles = observation.party.map((member) => (
    member.isEgg ? 'egg' : starterIds.has(member.speciesId) ? 'starter' : families.has(member.speciesId) ? 'plan' : 'utility'
  ));
  // One battle member per plan family: a second catch of a family already on
  // the team (the 2026-09-05 wild Zubat beside Crobat) is a utility carrier,
  // never trained for a boss; the highest level of the family is the member.
  const bestOfFamily = new Map();
  observation.party.forEach((member, index) => {
    if (roles[index] !== 'plan') return;
    const family = familyOf.get(member.speciesId) ?? member.speciesId;
    const current = bestOfFamily.get(family);
    if (current === undefined || member.level > observation.party[current].level) bestOfFamily.set(family, index);
  });
  const spares = new Set();
  observation.party.forEach((member, index) => {
    if (roles[index] === 'plan' && bestOfFamily.get(familyOf.get(member.speciesId) ?? member.speciesId) !== index) { roles[index] = 'utility'; spares.add(index); }
  });
  return observation.party.map((member, index) => Object.freeze({
    slot: member.slot ?? index,
    speciesId: member.speciesId,
    speciesName: member.speciesName,
    level: member.level,
    hp: member.hp,
    maxHp: member.maxHp,
    isEgg: member.isEgg === true,
    role: roles[index],
    spare: spares.has(index),
  }));
}

const FIELD_MOVES = new Set(['CUT', 'SURF', 'STRENGTH', 'FLASH', 'WHIRLPOOL', 'WATERFALL', 'FLY', 'ROCK_SMASH']);

/**
 * Party slot to box when a slot must be freed for a capture: a spare (second
 * member of a plan family) first, else the lightest utility carrier that is
 * not the only party member with one of its field moves; null when nothing
 * can go (a lone member, or every carrier is needed).
 */
export function depositCandidate(observation, members) {
  if (members.filter((member) => !member.isEgg).length < 2) return null;
  const spare = members.filter((member) => member.spare && !member.isEgg).sort((a, b) => a.level - b.level)[0];
  if (spare) return spare.slot;
  const movesOf = (slot) => new Set((observation.party[slot]?.moves ?? []).map((move) => move.name));
  const soleCarrier = (slot) => [...movesOf(slot)].some((name) => (
    FIELD_MOVES.has(name) && !members.some((other) => other.slot !== slot && !other.isEgg && movesOf(other.slot).has(name))
  ));
  const carrier = members
    .filter((member) => member.role === 'utility' && !member.isEgg && !soleCarrier(member.slot))
    .sort((a, b) => a.level - b.level)[0];
  return carrier ? carrier.slot : null;
}

/**
 * Party slot of the healthiest-strongest battle member to move in front when
 * the lead is not a battle member (a trainee demoted to utility, a carrier
 * left in front); null when the lead is already a battle member or none can.
 */
export function leadRestoreSlot(observation, roles) {
  const battle = (slot) => roles[slot] === 'starter' || roles[slot] === 'plan';
  const leadSlot = observation.party.findIndex((member) => !member.isEgg);
  if (leadSlot < 0 || battle(leadSlot)) return null;
  const candidate = observation.party
    .map((member, slot) => ({ member, slot }))
    .filter(({ member, slot }) => !member.isEgg && member.hp > 0 && battle(slot))
    .sort((left, right) => right.member.level - left.member.level || left.slot - right.slot)[0];
  return candidate ? candidate.slot : null;
}

/**
 * Readiness of the observed party against one contract. Battle members are
 * the starter and plan roles; `required` is all of them up to five.
 */
export function partyReadiness(observation, { contract, knowledge, starter, teamPlan = 'v1', maximumRequired = MAXIMUM_REQUIRED_MEMBERS }) {
  // The one named breakpoint above the band: when the enemy ace's own types
  // hit a member super-effectively (type chart), that member targets ace+3.
  const aceTypes = knowledge.species.get(contract.enemyAce.speciesId)?.typeIds ?? [];
  const members = classifyParty(observation, { knowledge, starter, teamPlan }).map((member) => {
    const battle = member.role === 'starter' || member.role === 'plan';
    const memberTypes = knowledge.species.get(member.speciesId)?.typeIds ?? [];
    const advantaged = battle && memberTypes.length > 0 && aceTypes.some((typeId) => knowledge.effectiveness(typeId, memberTypes) >= 2);
    const targetLevel = advantaged ? contract.targetLevel + 3 : contract.targetLevel;
    return Object.freeze({
      ...member,
      battle,
      targetLevel,
      breakpoint: advantaged ? 'ace-type-advantage' : null,
      ready: battle && member.level >= targetLevel,
      overLevelled: member.level > targetLevel + READINESS_BAND_ABOVE_ACE,
      deficit: battle ? Math.max(0, targetLevel - member.level) : 0,
    });
  });
  const battleMembers = members.filter((member) => member.battle);
  const required = Math.min(maximumRequired, Math.max(1, battleMembers.length));
  const readyCount = battleMembers.filter((member) => member.ready).length;
  const trainee = battleMembers.filter((member) => !member.ready).sort((left, right) => right.deficit - left.deficit || left.slot - right.slot)[0] ?? null;
  const healthy = members.filter((member) => !member.isEgg && member.hp > 0 && member.slot !== trainee?.slot);
  const escort = healthy.filter((member) => member.battle && member.ready).sort((left, right) => right.level - left.level)[0]
    ?? healthy.sort((left, right) => right.level - left.level)[0]
    ?? null;
  return Object.freeze({
    contractId: contract.id,
    targetLevel: contract.targetLevel,
    ceilingLevel: contract.ceilingLevel,
    members,
    required,
    readyCount,
    satisfied: readyCount >= required,
    trainee,
    escort,
  });
}

/** The player's starter, from whichever starter-family member is in the party. */
export function detectStarter(observation, knowledge) {
  for (const [starter, names] of Object.entries(STARTER_FAMILIES)) {
    const ids = new Set(names.map((name) => knowledge.speciesIds.get(name)));
    if (observation.party.some((member) => !member.isEgg && ids.has(member.speciesId))) return starter;
  }
  return null;
}
