// Opponent foresight for major trainer battles: which static trainer party the
// next battle uses, and which of our members should lead against its first
// Pokemon. Pure functions over observed state and cartridge trainer data.
import { dataOf } from "./mechanics-data.js";
import { IMPORTANT_BATTLE_TRAINER_NAMES } from "./campaign.js";
import { isPassiveTrainee, obedienceRisk, passiveTraineeIdentity } from "./training-policy.js";
import { battleKoRace, estimatedTrainerPokemon, planBattleCounters, raceIsComfortable } from "./battle-model.js";

const CHAMPIONS_ROOM = "MAP_POKEMON_LEAGUE_CHAMPIONS_ROOM";
const LANCES_ROOM = "MAP_POKEMON_LEAGUE_LANCES_ROOM";
// pokefirered data/maps/PokemonLeague_*/scripts.inc: every League room uses its
// rematch party once FLAG_SYS_CAN_LINK_WITH_RS is set. The Champion's party
// also depends on VAR_STARTER_MON; its three variants share a first Pokemon.
const CAN_LINK_WITH_RS_FLAG = 2116;
const GAME_CLEAR_FLAG = 2092;
const champion = (kind) => ["SQUIRTLE", "BULBASAUR", "CHARMANDER"].map((starter) => `TRAINER_CHAMPION_${kind}_${starter}`);
const LEAGUE_ROOM_TRAINERS = Object.freeze({
  MAP_POKEMON_LEAGUE_LORELEIS_ROOM: [["TRAINER_ELITE_FOUR_LORELEI"], ["TRAINER_ELITE_FOUR_LORELEI_2"]],
  MAP_POKEMON_LEAGUE_BRUNOS_ROOM: [["TRAINER_ELITE_FOUR_BRUNO"], ["TRAINER_ELITE_FOUR_BRUNO_2"]],
  MAP_POKEMON_LEAGUE_AGATHAS_ROOM: [["TRAINER_ELITE_FOUR_AGATHA"], ["TRAINER_ELITE_FOUR_AGATHA_2"]],
  MAP_POKEMON_LEAGUE_LANCES_ROOM: [["TRAINER_ELITE_FOUR_LANCE"], ["TRAINER_ELITE_FOUR_LANCE_2"]],
  [CHAMPIONS_ROOM]: [champion("FIRST"), champion("REMATCH")],
});

function trainerNamesFor(objective, observation) {
  const map = objective?.target?.map;
  const here = observation?.playerMemory?.map?.id;
  const flags = observation?.playerMemory?.storyState?.flagIds ?? {};
  const league = LEAGUE_ROOM_TRAINERS[map];
  if (league) {
    // The Champion's room runs its battle script on entry, so its lead is set
    // in Lance's room; every other room is ordered after its entry script.
    if (!(here === map || map === CHAMPIONS_ROOM && here === LANCES_ROOM)) return null;
    const rematch = flags[CAN_LINK_WITH_RS_FLAG] === true ? true
      : flags[CAN_LINK_WITH_RS_FLAG] === false || flags[GAME_CLEAR_FLAG] === false ? false : null;
    return rematch === null ? null : league[rematch ? 1 : 0];
  }
  const names = IMPORTANT_BATTLE_TRAINER_NAMES[objective?.rosterPreparationFor ?? objective?.id];
  return names?.length && map && here === map && ["object", "trigger"].includes(objective?.target?.kind)
    ? names : null;
}

const sameEntry = (left, right) => JSON.stringify([left?.species, left?.lvl ?? left?.level, left?.moves, left?.heldItem, left?.iv]) ===
  JSON.stringify([right?.species, right?.lvl ?? right?.level, right?.moves, right?.heldItem, right?.iv]);

// The upcoming major trainer's party, estimated from static data. Variants
// (starter-dependent Champions) must agree on the first Pokemon; the rest of
// the party is only returned when every variant agrees on it too.
export function upcomingMajorTrainer({ mechanics: document, observation, objective } = {}) {
  if (!objective?.importantBattle) return null;
  const names = trainerNamesFor(objective, observation);
  if (!names) return null;
  const mechanics = dataOf(document);
  const trainers = (Array.isArray(mechanics.trainers) ? mechanics.trainers : Object.values(mechanics.trainers ?? {}))
    .filter((trainer) => names.includes(trainer?.name) && Array.isArray(trainer.party) && trainer.party.length);
  if (!trainers.length || trainers.length !== new Set(names).size) return null;
  const [reference] = trainers;
  if (!trainers.every((trainer) => sameEntry(trainer.party[0], reference.party[0]))) return null;
  const first = estimatedTrainerPokemon(mechanics, reference.party[0], 0);
  if (!first) return null;
  const agreed = trainers.every((trainer) => trainer.party.length === reference.party.length &&
    trainer.party.every((entry, slot) => sameEntry(entry, reference.party[slot])));
  const remaining = agreed
    ? reference.party.slice(1).map((entry, index) => estimatedTrainerPokemon(mechanics, entry, index + 1))
    : [];
  return {
    trainerNames: trainers.map((trainer) => trainer.name),
    first,
    remaining: remaining.every(Boolean) ? remaining : [],
  };
}

// Choose a field lead for the next major battle. The current lead keeps its
// place whenever it wins its KO race comfortably against the first opponent,
// unless it is the only answer to a later opponent and another member also
// wins comfortably. Only a winner is ever moved to the front, and a narrowly
// winning lead only yields to a comfortable winner (the move costs no turn). Returns null when the
// next battle or a race is unknown, { member: null } to keep the lead, and
// { member } to move that member to the front.
export function selectMajorBattleLead({ mechanics, observation, objective, party } = {}) {
  const upcoming = upcomingMajorTrainer({ mechanics, observation, objective });
  const trainee = passiveTraineeIdentity(objective);
  const alive = (party ?? []).filter((member) =>
    Number(member?.hp) > 0 && Number(member?.species) > 0 && !member.isEgg &&
    (member.validity == null || member.validity === "valid"));
  const lead = [...alive].sort((left, right) => Number(left.slot) - Number(right.slot))[0];
  if (!lead) return null;
  // A passive Exp. Share trainee never leads while another member can fight.
  const living = alive.filter((member) => !isPassiveTrainee(member, trainee));
  if (isPassiveTrainee(lead, trainee) && living.length) {
    const fighter = upcoming
      ? planBattleCounters({ mechanics, members: living, counterPool: living, opponent: upcoming.first,
          remaining: upcoming.remaining }).ranked[0]?.member
      : null;
    return { member: fighter ?? [...living].sort((left, right) =>
        Number(right.level ?? 0) - Number(left.level ?? 0) ||
        Number(right.hp ?? 0) / Math.max(1, Number(right.maxHp ?? 0)) - Number(left.hp ?? 0) / Math.max(1, Number(left.maxHp ?? 0)) ||
        Number(left.personality ?? 0) - Number(right.personality ?? 0))[0],
      lead, leadRace: null, opponent: upcoming?.first ?? null, trainerNames: upcoming?.trainerNames ?? [],
      passiveTrainee: true };
  }
  if (!upcoming) return null;
  const obedientMembers = living.filter((member) => !obedienceRisk(member, observation));
  const leadRace = battleKoRace({ mechanics, member: lead, opponent: upcoming.first });
  if (!leadRace) return null;
  const plan = planBattleCounters({ mechanics, members: obedientMembers, counterPool: obedientMembers,
    opponent: upcoming.first, remaining: upcoming.remaining });
  const unreservedComfortable = plan.ranked.some(({ member, race }) =>
    !plan.reserved.has(Number(member.slot)) && raceIsComfortable(race));
  const keep = { member: null, lead, leadRace, opponent: upcoming.first, trainerNames: upcoming.trainerNames };
  const obedient = !obedienceRisk(lead, observation);
  if (obedient && raceIsComfortable(leadRace) &&
      !(plan.reserved.has(Number(lead.slot)) && unreservedComfortable)) return keep;
  const best = plan.ranked[0];
  if (!best || Number(best.member.slot) === Number(lead.slot)) return keep;
  // A narrowly winning lead only yields to a comfortable winner.
  if (obedient && leadRace.wins && !raceIsComfortable(best.race)) return keep;
  return { ...keep, member: best.member, race: best.race };
}
