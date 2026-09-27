import {heldItem,heldStatFactors,hasBattleAbility} from './held-items.js';
// Cartridge reference: pokefirered c75f3523, pokemon.c:CalculateBaseDamage
// and battle_script_commands.c:Cmd_accuracycheck. These are Gen III rules,
// including the cartridge's integer accuracy table (not modern fractions).
export const PHYSICAL_TYPES = new Set([
  "TYPE_NORMAL", "TYPE_FIGHTING", "TYPE_FLYING", "TYPE_POISON", "TYPE_GROUND",
  "TYPE_ROCK", "TYPE_BUG", "TYPE_GHOST", "TYPE_STEEL",
]);

const hasAbility = (battler, id, name) => Number(battler?.ability) === id ||
  battler?.ability === `ABILITY_${name}`;
const stage = (value) => Number.isSafeInteger(value) && value >= 0 && value <= 12 ? value : 6;

export function battleStatStageMultiplier(value) {
  const delta = stage(value) - 6;
  return delta >= 0 ? (2 + delta) / 2 : 2 / (2 - delta);
}

export function effectiveBattleWeather(weather, battlers) {
  return battlers.some((battler) => battler?.weatherSuppressed || hasAbility(battler, 13, "CLOUD_NINE") ||
    hasAbility(battler, 77, "AIR_LOCK")) ? 0 : Number(weather ?? 0);
}

export function battleDamageMultiplier({ move, attacker, defender, weather, critical=false }) {
  const field = effectiveBattleWeather(
    weather ?? attacker?.battleWeather ?? defender?.battleWeather, [attacker, defender],
  );
  let multiplier = 1;
  if (PHYSICAL_TYPES.has(move.type)) {
    const status = Number(attacker?.status1 ?? attacker?.status ?? 0);
    if (!hasAbility(attacker,62,"GUTS") && (status & 16)) multiplier *= 0.5;
  } else {
    // CalculateBaseDamage tests TEMPORARY rain specifically; automatic rain
    // also sets this bit in the cartridge. Thunder uses the whole rain mask.
    if (field & 1) {
      if (move.type === "TYPE_FIRE") multiplier *= 0.5;
      if (move.type === "TYPE_WATER") multiplier *= 1.5;
    }
    if (field & 96) {
      if (move.type === "TYPE_FIRE") multiplier *= 1.5;
      if (move.type === "TYPE_WATER") multiplier *= 0.5;
    }
    if ((field & (7 | 24 | 128)) && move.effect === "EFFECT_SOLAR_BEAM") multiplier *= 0.5;
  }
  const physical=PHYSICAL_TYPES.has(move.type);
  if(!critical&&move.effect!=='EFFECT_BRICK_BREAK'&&(Number(defender?.sideStatus??0)&(physical?1:2)))multiplier*=defender?.sideAlive===2&&(defender?.battleFlags&1)?2/3:1/2;
  if((attacker?.battleFlags&1)&&move.target==='MOVE_TARGET_BOTH'&&defender?.sideAlive===2)multiplier*=.5;
  if(move.type==='TYPE_ELECTRIC'&&attacker?.fieldSports?.mud)multiplier*=.5;
  if(move.type==='TYPE_FIRE'&&attacker?.fieldSports?.water)multiplier*=.5;
  if(move.type==='TYPE_FIRE'&&attacker?.flashFireActive)multiplier*=1.5;
  const pinch=[['TYPE_GRASS',65,'OVERGROW'],['TYPE_FIRE',66,'BLAZE'],['TYPE_WATER',67,'TORRENT'],['TYPE_BUG',68,'SWARM']];
  if(attacker?.hp<=Math.floor(attacker?.maxHp/3)&&pinch.some(([type,id,name])=>move.type===type&&hasAbility(attacker,id,name)))multiplier*=1.5;
  return multiplier;
}

// Cmd_damagecalc applies Charge after CalculateBaseDamage's final +2.
export function battlePostDamageMultiplier({move,attacker}) {
  return move.type==='TYPE_ELECTRIC'&&(Number(attacker?.status3??0)&(1<<9))?2:1;
}

export function battleMoveAccuracy({ move, attacker, defender, weather }) {
  const field = effectiveBattleWeather(
    weather ?? attacker?.battleWeather ?? defender?.battleWeather, [attacker, defender],
  );
  if (Number(move.accuracy) === 0 ||
      ["EFFECT_ALWAYS_HIT", "EFFECT_VITAL_THROW"].includes(move.effect) ||
      move.effect === "EFFECT_THUNDER" && (field & 7)) return 1;
  const evasion = (Number(defender?.status2 ?? 0) & (1 << 29)) ? 6 : stage(defender?.statStages?.evasion);
  const accuracyStage = Math.max(0, Math.min(12, stage(attacker?.statStages?.accuracy) + 6 - evasion));
  const ratios = [0.33, 0.36, 0.43, 0.5, 0.6, 0.75, 1, 1.33, 1.66, 2, 2.33, 2.66, 3];
  const base = move.effect === "EFFECT_THUNDER" && (field & 96) ? 50 : Number(move.accuracy);
  let accuracy = Math.floor(base * ratios[accuracyStage]);
  if (hasAbility(attacker, 14, "COMPOUND_EYES")) accuracy = Math.floor(accuracy * 1.3);
  if (hasAbility(defender, 8, "SAND_VEIL") && (field & 24)) accuracy = Math.floor(accuracy * 0.8);
  if (hasAbility(attacker, 55, "HUSTLE") && PHYSICAL_TYPES.has(move.type)) accuracy = Math.floor(accuracy * 0.8);
  const item=heldItem(defender);
  if(item.effect==="HOLD_EFFECT_EVASION_UP")accuracy=Math.floor(accuracy*(100-item.param)/100);
  return Math.max(0, Math.min(1, accuracy / 100));
}

// Stat changes occur before the base damage formula, with native integer rounding.
export function battleDamageStats({move,attacker,defender,attack,defense}){
 const physical=PHYSICAL_TYPES.has(move.type),flags=attacker?.battleFlags??defender?.battleFlags??0;
 const atk=heldStatFactors(attacker,{type:move.type,physical,battleFlags:flags});
 const def=heldStatFactors(defender,{type:move.type,physical,defending:true,battleFlags:flags});
 let a=Number(attack),d=Number(defense);
 if(physical&&(hasAbility(attacker,37,'HUGE_POWER')||hasAbility(attacker,74,'PURE_POWER')))a*=2;
 if(attacker?.badgeBoosts?.[physical?'attack':'spAttack'])a=Math.floor(a*1.1);
 if(defender?.badgeBoosts?.[physical?'defense':'spDefense'])d=Math.floor(d*1.1);
 a=Math.floor(a*atk.attack);d=Math.floor(d*def.defense);
 if(!physical&&hasAbility(defender,47,'THICK_FAT')&&['TYPE_FIRE','TYPE_ICE'].includes(move.type))a=Math.floor(a/2);
 if(physical&&hasAbility(attacker,55,'HUSTLE'))a=Math.floor(a*1.5);
 if(physical&&hasAbility(attacker,62,'GUTS')&&Number(attacker?.status1??attacker?.status??0))a=Math.floor(a*1.5);
 if(!physical&&attacker?.plusMinusActive)a=Math.floor(a*1.5);
 if(physical&&hasAbility(defender,63,'MARVEL_SCALE')&&Number(defender?.status1??defender?.status??0))d=Math.floor(d*1.5);
 if(physical&&move.effect==='EFFECT_EXPLOSION')d=Math.floor(d/2);
 return {attack:Math.max(1,a),defense:Math.max(1,d),known:atk.known&&def.known};
}
export function battleSpeed(p){
 let speed=Number(p?.stats?.speed);if(!(speed>0))return null;
 const weather=effectiveBattleWeather(p?.battleWeather,[p]);
 if(hasAbility(p,33,'SWIFT_SWIM')&&(weather&7)||hasAbility(p,34,'CHLOROPHYLL')&&(weather&96))speed*=2;
 speed=Math.floor(speed*battleStatStageMultiplier(p?.statStages?.speed));
 if(p?.badgeBoosts?.speed)speed=Math.floor(speed*1.1);
 if(heldItem(p).effect==='HOLD_EFFECT_MACHO_BRACE')speed=Math.floor(speed/2);
 if(Number(p?.status1??p?.status??0)&64)speed=Math.floor(speed/4);
 return Math.max(1,speed);
}
export function battleTurnOrder({attacker,defender,move,opponentMove={priority:0}}){
 const a=battleSpeed(attacker),d=battleSpeed(defender);
 if(a===null||d===null||!heldItem(attacker).known||!heldItem(defender).known)return {firstChance:null,guaranteed:false};
 if((move.priority??0)!==(opponentMove.priority??0)){const first=(move.priority??0)>(opponentMove.priority??0);return {firstChance:first?1:0,guaranteed:first};}
 const claw=p=>heldItem(p).effect==='HOLD_EFFECT_QUICK_CLAW'?heldItem(p).param/100:0;
 const x=claw(attacker),y=claw(defender),normal=a===d?.5:a>d?1:0;
 // FireRed uses one shared roll. When both trigger they tie at UINT_MAX.
 const chance=Math.max(0,x-y)+Math.min(x,y)*.5+(1-Math.max(x,y))*normal;
 return {firstChance:chance,guaranteed:chance===1};
}
