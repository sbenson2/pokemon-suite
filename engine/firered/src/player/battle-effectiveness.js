import {speciesTypes,typeMultiplier,indexed,dataOf,withBattleAbility} from './mechanics-data.js';
// FireRed ability IDs from include/constants/abilities.h. An observed ability
// wins over species defaults (Trace/Skill Swap can change it during battle).
const ABILITY_NAMES = new Map([
  [10, "ABILITY_VOLT_ABSORB"], [11, "ABILITY_WATER_ABSORB"],
  [18, "ABILITY_FLASH_FIRE"], [25, "ABILITY_WONDER_GUARD"], [26, "ABILITY_LEVITATE"],
]);

export function abilityAdjustedEffectiveness({ move, defender, species, effectiveness }) {
  // Struggle is typeless in Gen III and bypasses Wonder Guard.
  if (Number(move.id) === 165 || move.name === "MOVE_STRUGGLE") return 1;
  const observed = defender?.ability;
  const defaults = [...new Set((species?.abilities ?? []).filter((name) => name !== "ABILITY_NONE"))];
  const ability = observed != null
    ? ABILITY_NAMES.get(Number(observed)) ?? observed
    : defaults.length === 1 ? defaults[0] : null;
  const immune =
    ability === "ABILITY_LEVITATE" && move.type === "TYPE_GROUND" ||
    ability === "ABILITY_VOLT_ABSORB" && move.type === "TYPE_ELECTRIC" ||
    ability === "ABILITY_WATER_ABSORB" && move.type === "TYPE_WATER" ||
    ability === "ABILITY_FLASH_FIRE" && move.type === "TYPE_FIRE" &&
      (Number(defender?.status1 ?? 0) & 32) === 0 ||
    ability === "ABILITY_WONDER_GUARD" && effectiveness <= 1;
  return immune ? 0 : effectiveness;
}

export function battleTypeEffectiveness({mechanics,move,defender}) {
 const data=dataOf(mechanics);
 defender=withBattleAbility(data,defender);
 return abilityAdjustedEffectiveness({move,defender,species:indexed(data.species,defender?.species),effectiveness:typeMultiplier(data,move.type,speciesTypes(data,defender),{foresight:Boolean(Number(defender?.status2??0)&(1<<29))})});
}
