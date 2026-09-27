export const BATTLE_TYPES=["NORMAL","FIGHTING","FLYING","POISON","GROUND","ROCK","BUG","GHOST","STEEL","MYSTERY","FIRE","WATER","GRASS","ELECTRIC","PSYCHIC","ICE","DRAGON","DARK"].map(t=>"TYPE_"+t);
export function dataOf(document) {
  return document?.data ?? document ?? {};
}

export function indexed(collection, id) {
  if (Array.isArray(collection)) return collection[id] ?? null;
  return collection?.[id] ?? collection?.[String(id)] ?? null;
}

export function speciesTypes(mechanics, battler) {
  if (battler?.types?.length) return battler.types.map(t => typeof t === "number" ? BATTLE_TYPES[t] : t);
  const species = indexed(dataOf(mechanics).species, battler?.species);
  return species?.types ?? [];
}

export function withBattleAbility(mechanics, battler) {
  if (!battler || battler.ability != null) return battler;
  const abilities = indexed(dataOf(mechanics).species, battler.species)?.abilities ?? [];
  const slot = battler.abilityNum;
  const defaults = [...new Set(abilities.filter(a => a !== 'ABILITY_NONE'))];
  const ability = Number.isInteger(slot) && slot >= 0 && slot < 2
    ? abilities[slot] === 'ABILITY_NONE' ? abilities[0] : abilities[slot]
    : defaults.length === 1 ? defaults[0] : null;
  return ability != null ? {...battler, ability} : battler;
}

export function typeMultiplier(mechanics, attackingType, defendingTypes, {foresight=false}={}) {
  let result = 1;
  for (const defendingType of new Set(defendingTypes)) {
    if(foresight&&defendingType==="TYPE_GHOST"&&["TYPE_NORMAL","TYPE_FIGHTING"].includes(attackingType))continue;
    const entry = (dataOf(mechanics).typeChart ?? []).find(
      (candidate) =>
        candidate.attackingType === attackingType &&
        candidate.defendingType === defendingType,
    );
    result *= entry ? Number(entry.multiplier) / 10 : 1;
  }
  return result;
}

export function effectPenalty(effect) {
  if (/EXPLOSION|SELF_DESTRUCT/.test(effect ?? "")) return 0.15;
  if (/SEMI_INVULNERABLE|SOLAR_BEAM/.test(effect ?? "")) return 0.65;
  if (/RECHARGE/.test(effect ?? "")) return 0.72;
  if (/OHKO/.test(effect ?? "")) return 0.25;
  return 1;
}
