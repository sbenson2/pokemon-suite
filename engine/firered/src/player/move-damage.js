import { effectPenalty } from "./mechanics-data.js";

const FIXED_DAMAGE_EFFECTS = Object.freeze(new Map([
  ["EFFECT_DRAGON_RAGE", 40],
  ["EFFECT_SONICBOOM", 20],
]));

export function moveDamageKind(move) {
  const effect = String(move?.effect ?? "");
  if (effect === "EFFECT_LEVEL_DAMAGE") return "level";
  if (FIXED_DAMAGE_EFFECTS.has(effect)) return "fixed";
  const power = Number(move?.power ?? 0);
  // FireRed uses one as a placeholder for several effect-calculated moves.
  // Unsupported variable effects must not enter ordinary base-power math.
  if (power === 1 && !move.resolvedPower) return null;
  return power > 0 ? "ordinary" : null;
}

export function deterministicFixedDamage(move, attackerLevel) {
  const kind = moveDamageKind(move);
  if (kind === "level") {
    const level = Number(attackerLevel);
    return Number.isFinite(level) && level > 0 ? level : null;
  }
  return kind === "fixed" ? FIXED_DAMAGE_EFFECTS.get(String(move.effect)) : null;
}

// Normalized expected damage uses neutral base-power-equivalent units. This
// preserves the battle policy's established scale while putting ordinary and
// fixed-damage moves on one comparable scale at the attacker's current level.
export function normalizedExpectedMoveDamage({
  move,
  attackerLevel,
  attack = 1,
  defense = 1,
  accuracy = 1,
  stab = 1,
  effectiveness = 1,
  damageMultiplier = 1,
} = {}) {
  const kind = moveDamageKind(move);
  if (!kind) return null;
  if (!(Number(effectiveness) > 0)) return 0;
  const hitChance = Math.max(0, Math.min(1, Number(accuracy)));
  const level = Number(attackerLevel);
  const attackValue = Number(attack);
  const defenseValue = Number(defense);
  if (!(level > 0) || !(attackValue > 0) || !(defenseValue > 0)) return null;
  const fixedDamage = deterministicFixedDamage(move, attackerLevel);
  if (fixedDamage !== null) {
    const neutralDamagePerPower = (2 * level / 5 + 2) / 50;
    return fixedDamage * hitChance / neutralDamagePerPower;
  }
  return Number(move.power) * hitChance * Number(stab) * Number(effectiveness) *
    (attackValue / defenseValue) * Number(damageMultiplier) * effectPenalty(move.effect);
}
