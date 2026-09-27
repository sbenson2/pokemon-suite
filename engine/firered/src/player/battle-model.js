import {obedienceRisk,permanentTrainingParty} from './training-policy.js';
import { dataOf, indexed, speciesTypes, typeMultiplier, withBattleAbility } from "./mechanics-data.js";
import { abilityAdjustedEffectiveness, battleTypeEffectiveness } from "./battle-effectiveness.js";
import { PHYSICAL_TYPES, battleDamageStats, battleDamageMultiplier, battlePostDamageMultiplier, battleMoveAccuracy, battleStatStageMultiplier, effectiveBattleWeather, battleTurnOrder } from "./battle-modifiers.js";
import {heldItem,itemCatalog} from './held-items.js';
import { reservedPlayerPartySlots } from "./battle-legality.js";
import { isHmUtilityCarrier } from "./campaign.js";
import {evaluateMoveUse,resolveMoveDamage,liveMoveTypes,describeMove} from './move-knowledge.js';
import {
  deterministicFixedDamage,
  normalizedExpectedMoveDamage,
  moveDamageKind,
} from "./move-damage.js";

export function scoreBattleMoves({ mechanics: document, player, opponent, weather }) {
  const mechanics = dataOf(document);
  player=withBattleAbility(mechanics,player);opponent=withBattleAbility(mechanics,opponent);
  const playerTypes = liveMoveTypes(mechanics, player);
  const opponentTypes = liveMoveTypes(mechanics, opponent);
  const candidates = [];
  for (const [moveSlot, moveId] of (player?.moves ?? []).entries()) {
    const rawMove = indexed(mechanics.moves, moveId);
    const pp = Number(player?.pp?.[moveSlot] ?? 0);
    if (!rawMove || !moveId || pp <= 0 || Number(rawMove.power)<=0) continue;
    const move=resolveMoveDamage({move:rawMove,attacker:player,defender:opponent,mechanics,battle:{weather}});
    if (!move || !moveDamageKind(move)&&move.conditionalFixedDamage==null) continue;
    const physical = PHYSICAL_TYPES.has(move.type);
    const attack = (Number(
      physical ? player?.stats?.attack : player?.stats?.spAttack,
    ) || 1) * battleStatStageMultiplier(player?.statStages?.[physical ? "attack" : "spAttack"]);
    const defense = (Number(
      physical ? opponent?.stats?.defense : opponent?.stats?.spDefense,
    ) || 1) * battleStatStageMultiplier(opponent?.statStages?.[physical ? "defense" : "spDefense"]);
    const accuracy = battleMoveAccuracy({ move, attacker: player, defender: opponent, weather });
    const stab = playerTypes.includes(move.type) ? 1.5 : 1;
    const effectiveness = battleTypeEffectiveness({mechanics,move,defender:opponent});
    const modified=battleDamageStats({move,attacker:player,defender:opponent,attack:attack/battleStatStageMultiplier(player?.statStages?.[physical?"attack":"spAttack"]),defense:defense/battleStatStageMultiplier(opponent?.statStages?.[physical?"defense":"spDefense"])});
    const ordinaryScore = normalizedExpectedMoveDamage({
      move,
      attackerLevel: Number(player?.level) || 50,
      attack:modified.attack*battleStatStageMultiplier(player?.statStages?.[physical?"attack":"spAttack"]),
      defense:modified.defense*battleStatStageMultiplier(opponent?.statStages?.[physical?"defense":"spDefense"]),
      accuracy,
      stab,
      effectiveness,
      damageMultiplier: battlePostDamageMultiplier({move,attacker:player}) * battleDamageMultiplier({
        move, attacker: player, defender: opponent, weather,
      }),
    });
    let score=move.conditionalFixedDamage!=null
      ? effectiveness>0?move.conditionalFixedDamage*accuracy/((2*(Number(player?.level)||50)/5+2)/50):0
      : ordinaryScore;
    if (score === null) continue;
    score*=move.expectedHits??1;
    // Ordinary moves still advance a sleeping battler's turn, but Snore takes
    // priority when it can actually act during the remaining sleep turns.
    if((Number(player?.status1??player?.status??0)&7)>1&&move.effect!=='EFFECT_SNORE')score*=0.02;
    candidates.push({
      moveId,
      moveSlot,
      name: move.name ?? `MOVE_${moveId}`,
      effectiveness,
      score,
      evidenceRefs: [
        `cartridge:move:${moveId}`,
        `move-rule:gen3:${move.effect??'EFFECT_HIT'}`,
        `cartridge:species:${player?.species ?? "unknown"}`,
        `cartridge:species:${opponent?.species ?? "unknown"}`,
      ],
    });
  }
  return candidates.sort(
    (left, right) => right.score - left.score || left.moveSlot - right.moveSlot,
  );
}

function observedBattleOpponents(battle) {
  const absentBattlerFlags = Number(battle?.absentBattlerFlags ?? 0) >>> 0;
  const opponents = (battle?.battlers ?? []).filter((battler) => {
    const battlerId = Number(battler?.battler);
    return battler && Number.isSafeInteger(battlerId) &&
      (battlerId & 1) === 1 &&
      (absentBattlerFlags & (1 << battlerId)) === 0 &&
      (battler.hp == null || Number(battler.hp) > 0);
  });
  return opponents.length > 0
    ? opponents
    : battle?.opponent
      ? [battle.opponent]
      : [];
}

export function battleDecisionState(memory, ui) {
  const source = memory?.battle;
  if (!source) return null;
  const battlers = source.battlers ?? [];
  const isDoubleBattle = (Number(memory?.battleTypeFlags) & 1) !== 0;
  const actingBattler = [
    ui?.battle?.battler,
    // The controller loop leaves gActiveBattler beyond the battler array while
    // Bag/Party owns input. FireRed saves the actor in gBattlerInMenuId before
    // opening either menu. Keep that actor until its action cursor returns.
    ui?.bag || ui?.party ? memory?.battleMenuBattler : null,
    memory?.activeBattler,
    source.player?.battler,
  ].find((value) =>
    Number.isSafeInteger(value) &&
    (value & 1) === 0 &&
    (isDoubleBattle || value === 0) &&
    battlers[value]
  );
  const observedPlayer = Number.isSafeInteger(actingBattler)
    ? battlers[actingBattler]
    : null;
  const player = observedPlayer &&
      Number(source.player?.battler) === Number(actingBattler)
    ? { ...observedPlayer, ...source.player }
    : observedPlayer ?? source.player;
  const party = memory?.trainer?.party ?? [];
  const partyMemberAt = (slot) => party.find((member) =>
    Number(member.slot) === Number(slot)
  );
  const slotMatchesBattler = (slot, battler) => {
    if (!Number.isSafeInteger(slot)) return false;
    if (party.length === 0) return true;
    const member = partyMemberAt(slot);
    return Boolean(
      member && (Number(member.species) === Number(battler?.species) ||
        (Number(battler?.status2)&(1<<21))!==0),
    );
  };
  const matchingPartySlot = (battler, used = new Set()) =>
    party.find((member) =>
      !used.has(Number(member.slot)) &&
      Number(member.species) === Number(battler?.species)
    )?.slot;
  const indexedPartySlot = Number.isSafeInteger(actingBattler)
    ? source.battlerPartyIndexes?.[actingBattler]
    : null;
  const playerPartySlot = slotMatchesBattler(indexedPartySlot, player)
    ? indexedPartySlot
    : slotMatchesBattler(source.playerPartySlot, player)
      ? source.playerPartySlot
      : matchingPartySlot(player) ?? indexedPartySlot ?? source.playerPartySlot;
  const absentBattlerFlags = Number(source.absentBattlerFlags ?? 0) >>> 0;
  const activePlayerPartySlots = new Set();
  for (const battler of battlers) {
    const battlerId = Number(battler?.battler);
    if (
      !battler || !Number.isSafeInteger(battlerId) ||
      (battlerId & 1) !== 0 ||
      (!isDoubleBattle && battlerId !== 0) ||
      (absentBattlerFlags & (1 << battlerId)) !== 0
    ) continue;
    const indexedSlot = source.battlerPartyIndexes?.[battlerId];
    const partySlot = slotMatchesBattler(indexedSlot, battler)
      ? indexedSlot
      : matchingPartySlot(battler, activePlayerPartySlots);
    if (Number.isSafeInteger(partySlot)) activePlayerPartySlots.add(partySlot);
  }
  if (Number.isSafeInteger(playerPartySlot)) {
    activePlayerPartySlots.add(playerPartySlot);
  }
  const reservedPartySlots = reservedPlayerPartySlots({
    battleTypeFlags: memory?.battleTypeFlags,
    battle: source,
  });
  const battleWeather = effectiveBattleWeather(source.weather, battlers.length
    ? battlers.filter((battler) => battler && !(absentBattlerFlags & (1 << battler.battler)))
    : [player, source.opponent]);
  const opponents = observedBattleOpponents(source).map((battler) => ({ ...battler, battleWeather }));
  return {
    ...source,
    player: player ? { ...player, battleWeather } : player,
    opponent: opponents[0] ?? source.opponent,
    opponents,
    playerPartySlot,
    activePlayerPartySlots: [...activePlayerPartySlots],
    reservedPlayerPartySlots: [...reservedPartySlots],
  };
}

export function scoreBattleMoveTargets({ mechanics, player, opponents }) {
  return (opponents ?? []).flatMap((opponent) =>
    scoreBattleMoves({ mechanics, player, opponent }).map((candidate) => ({
      ...candidate,
      targetBattler: Number.isSafeInteger(opponent?.battler)
        ? opponent.battler
        : null,
      targetSpecies: opponent?.species ?? null,
    }))
  ).sort((left, right) =>
    right.score - left.score ||
    left.moveSlot - right.moveSlot ||
    Number(left.targetBattler ?? 0) - Number(right.targetBattler ?? 0)
  );
}

export function selectSurvivalSupportMove({
  mechanics: document,
  player,
  opponent,
  selectableMoveSlots,
}) {
  const mechanics = dataOf(document);
  const candidates = (player?.moves ?? []).flatMap((moveId, moveSlot) => {
    const move = indexed(mechanics.moves, moveId);
    const pp = Number(player?.pp?.[moveSlot] ?? 0);
    return move && moveId && pp > 0 && Number(move.power) === 0 &&
        evaluateMoveUse({move,attacker:player,defender:opponent,mechanics}).usable &&
        selectableMoveSlots?.has(moveSlot)
      ? [{ moveId, moveSlot, effect: move.effect }]
      : [];
  });
  const opponentAsleep = (Number(opponent?.status1 ?? 0) & 0b111) !== 0;
  const preferredEffect = opponentAsleep ? "EFFECT_LEECH_SEED" : "EFFECT_SLEEP";
  return candidates.find(({ effect }) => effect === preferredEffect) ??
    candidates.find(({ effect }) =>
      effect === (opponentAsleep ? "EFFECT_SLEEP" : "EFFECT_LEECH_SEED")
    ) ?? candidates[0] ?? null;
}

export function captureMoveMaximumCriticalDamage({
  mechanics: document,
  player,
  opponent,
  move,
} = {}) {
  const mechanics = dataOf(document);
  player=withBattleAbility(mechanics,player);opponent=withBattleAbility(mechanics,opponent);
  const power = Number(move?.power ?? 0);
  const level = Number(player?.level ?? 0);
  if (power <= 0 || level <= 0) return 0;
  const physical = PHYSICAL_TYPES.has(move.type);
  const attackStat = physical ? "attack" : "spAttack";
  const defenseStat = physical ? "defense" : "spDefense";
  const attackStage = battleStatStageMultiplier(
    player?.statStages?.[attackStat],
  );
  const defenseStage = battleStatStageMultiplier(
    opponent?.statStages?.[defenseStat],
  );
  // A Gen III critical hit ignores an unfavorable attacking stage and a
  // favorable defending stage. Use the strongest legal interpretation so a
  // capture-preparation hit cannot unexpectedly knock out the target.
  const modified=battleDamageStats({move,attacker:player,defender:opponent,attack:Number(player?.stats?.[attackStat]??1),defense:Number(opponent?.stats?.[defenseStat]??1)});
  if(!modified.known)return null;
  const attack = modified.attack *
    Math.max(1, attackStage);
  const defense = modified.defense *
    Math.min(1, defenseStage);
  const base = Math.floor(
    Math.floor(
      Math.floor((2 * level) / 5 + 2) * power * attack / defense,
    ) / 50,
  ) + 2;
  const stab = speciesTypes(mechanics, player).includes(move.type) ? 1.5 : 1;
  const effectiveness=battleTypeEffectiveness({mechanics,move,defender:opponent});
  const multiplier = battleDamageMultiplier({ move, attacker: player, defender: opponent, critical:true });
  const hits = move.effect === "EFFECT_MULTI_HIT" ? 5 : move.effect === "EFFECT_DOUBLE_HIT" ? 2 : 1;
  return Math.max(0, Math.ceil(((base - 2) * multiplier + 2) * battlePostDamageMultiplier({move,attacker:player}) * stab * effectiveness * 2)) * hits;
}

// Only ordinary, bounded damage effects belong in this estimate. Fixed/variable
// damage, residual status, recoil and forced multi-turn attacks need their own
// models. In particular, move.power = 1 is often a sentinel, not one damage.
const CAPTURE_BOUNDED_EFFECTS = new Set([
  "EFFECT_HIT", "EFFECT_MULTI_HIT", "EFFECT_DOUBLE_HIT", "EFFECT_ALWAYS_HIT",
  "EFFECT_HIGH_CRITICAL", "EFFECT_FLINCH_HIT", "EFFECT_ATTACK_DOWN_HIT",
  "EFFECT_DEFENSE_DOWN_HIT", "EFFECT_SPEED_DOWN_HIT", "EFFECT_SPECIAL_ATTACK_DOWN_HIT",
  "EFFECT_SPECIAL_DEFENSE_DOWN_HIT", "EFFECT_ACCURACY_DOWN_HIT",
]);

const BATTLE_HEALING_AMOUNTS = new Map([
  [13, 20],
  [22, 50],
  [26, 50],
  [27, 60],
  [28, 80],
  [29, 100],
  [21, 200],
  [20, Infinity],
  [19, Infinity],
]);

export function selectCaptureHealing({mechanics, memory}) {
  const battle = memory.battle, player = battle?.player;
  // The native party menu temporarily swaps its active member to the first
  // slot; gBattlerPartyIndexes still refers to the battle's original order.
  const candidates = (memory.trainer?.party ?? []).filter(p =>
    p.species === player?.species && p.hp === player?.hp);
  if (candidates.length !== 1 || candidates[0].hp <= 0) return null;
  const incoming = maximumCredibleIncomingDamage({mechanics, attacker:battle.opponent, defender:player});
  if (incoming === null) return null;
  // The medicine uses one turn; leave enough HP for two further capture turns.
  const item = (memory.trainer?.bag?.items ?? []).filter(i => i.quantity > 0)
    .map(i => ({...i, amount:BATTLE_HEALING_AMOUNTS.get(i.itemId)}))
    .filter(i => i.amount > 0 && Math.min(player.maxHp, player.hp + i.amount) > incoming * 3)
    .sort((a,b) => a.amount-b.amount || b.itemId-a.itemId)[0];
  return item ? {itemId:item.itemId, target:candidates[0]} : null;
}

const BASE_STAT_FIELDS = Object.freeze({
  attack: "baseAttack",
  defense: "baseDefense",
  spAttack: "baseSpAttack",
  spDefense: "baseSpDefense",
});

function observedOrEstimatedBattleStat(mechanics, battler, stat) {
  const observed = Number(battler?.stats?.[stat]);
  if (observed > 0) return observed;
  const species = indexed(mechanics.species, battler?.species);
  const base = Number(species?.[BASE_STAT_FIELDS[stat]]);
  const level = Number(battler?.level);
  if (!(base > 0) || !(level > 0)) return null;
  return Math.max(1, Math.floor(((2 * base + 31) * level) / 100) + 5);
}

export function maximumCredibleIncomingDamage({
  mechanics: document,
  attacker,
  defender,
} = {}) {
  const mechanics = dataOf(document);
  attacker=withBattleAbility(mechanics,attacker);defender=withBattleAbility(mechanics,defender);
  if (!Array.isArray(attacker?.moves) || Number(attacker?.level) <= 0) {
    return null;
  }
  let maximumDamage = 0;
  let evaluatedMove = false;
  for (const [moveSlot, moveId] of attacker.moves.entries()) {
    if (!Number(moveId)) continue;
    if (
      Array.isArray(attacker.pp) &&
      Number(attacker.pp[moveSlot] ?? 0) <= 0
    ) continue;
    const rawMove = indexed(mechanics.moves, moveId);
    if (!rawMove) return null;
    const use=evaluateMoveUse({move:rawMove,attacker,defender,mechanics,allowContingent:true});
    if(!use.usable){if(!use.known)return null;evaluatedMove=true;continue;}
    if(Number(rawMove.power)>0&&describeMove(rawMove).planning==='requires-plan')return null;
    let move=resolveMoveDamage({move:rawMove,attacker,defender,mechanics,allowContingent:true});
    if(!move)return null;
    // Survival bounds use the maximum possible roll, not selection utility.
    if(move.effect==='EFFECT_MAGNITUDE')move={...move,power:150};
    if(move.effect==='EFFECT_PRESENT')move={...move,power:120};
    if(move.effect==='EFFECT_FLAIL')move={...move,power:200};
    const effectiveness=battleTypeEffectiveness({mechanics,move,defender});
    if (effectiveness === 0) {
      evaluatedMove = true;
      continue;
    }
    if(move.conditionalFixedDamage!=null){
      const maximum=move.effect==='EFFECT_PSYWAVE'?Math.max(1,Math.floor(attacker.level*1.5)-1):move.conditionalFixedDamage;
      maximumDamage=Math.max(maximumDamage,maximum);evaluatedMove=true;continue;
    }
    const effect = String(move.effect ?? "");
    // These return twice the damage received this turn. Their ROM power of 1
    // is a sentinel, not a usable damage bound; without a proposed action and
    // native damage history the survival estimate must remain unknown.
    if (["EFFECT_COUNTER", "EFFECT_MIRROR_COAT"].includes(effect)) return null;
    if (/OHKO/.test(effect)) {
      maximumDamage = Math.max(maximumDamage, Number(defender?.hp ?? 0));
      evaluatedMove = true;
      continue;
    }
    const fixedDamage = deterministicFixedDamage(move, attacker.level);
    if (fixedDamage !== null) {
      maximumDamage = Math.max(maximumDamage, fixedDamage);
      evaluatedMove = true;
      continue;
    }
    if (/SUPER_FANG/.test(effect)) {
      maximumDamage = Math.max(
        maximumDamage,
        Math.max(1, Math.floor(Number(defender?.hp ?? 0) / 2)),
      );
      evaluatedMove = true;
      continue;
    }
    const power = Number(move.power ?? 0);
    if (power <= 0) {
      evaluatedMove = true;
      continue;
    }
    const physical = PHYSICAL_TYPES.has(move.type);
    const attackStat = physical ? "attack" : "spAttack";
    const defenseStat = physical ? "defense" : "spDefense";
    const attack = observedOrEstimatedBattleStat(
      mechanics,
      attacker,
      attackStat,
    );
    const defense = observedOrEstimatedBattleStat(
      mechanics,
      defender,
      defenseStat,
    );
    if (!(attack > 0) || !(defense > 0)) return null;
    const modified=battleDamageStats({move,attacker,defender,attack,defense});
    if(!modified.known)return null;
    const stagedAttack = modified.attack * battleStatStageMultiplier(
      attacker?.statStages?.[attackStat],
    );
    const stagedDefense = modified.defense * battleStatStageMultiplier(
      defender?.statStages?.[defenseStat],
    );
    const base = Math.floor(
      Math.floor(
        Math.floor((2 * Number(attacker.level)) / 5 + 2) * power *
          stagedAttack / Math.max(1, stagedDefense),
      ) / 50,
    ) + 2;
    const stab = speciesTypes(mechanics, attacker).includes(move.type) ? 1.5 : 1;
    const hitCount = /MULTI_HIT|FURY_ATTACK/.test(effect)
      ? 5
      : /DOUBLE_HIT|TWINEEDLE/.test(effect)
        ? 2
        : 1;
    maximumDamage = Math.max(
      maximumDamage,
      Math.max(1, Math.ceil(((base - 2) * battleDamageMultiplier({ move, attacker, defender }) + 2) * battlePostDamageMultiplier({move,attacker}) * stab * effectiveness)) * hitCount,
    );
    evaluatedMove = true;
  }
  return evaluatedMove ? maximumDamage : null;
}

export function selectCapturePreparationMove({
  mechanics: document,
  player,
  opponent,
  selectableMoveSlots,
} = {}) {
  const mechanics = dataOf(document);
  const moves = (player?.moves ?? []).flatMap((moveId, moveSlot) => {
    const move = indexed(mechanics.moves, moveId);
    const pp = Number(player?.pp?.[moveSlot] ?? 0);
    return move && Number(moveId) > 0 && pp > 0 &&
        evaluateMoveUse({move,attacker:player,defender:opponent,mechanics}).usable &&
        selectableMoveSlots?.has(moveSlot)
      ? [{ moveId: Number(moveId), moveSlot, move }]
      : [];
  });
  const opponentStatus = Number(opponent?.status1 ?? 0);
  if (opponentStatus === 0) {
    const abilities = indexed(mechanics.species, opponent?.species)?.abilities ?? [];
    const sleepImmune = abilities.some((ability) =>
      ["ABILITY_INSOMNIA", "ABILITY_VITAL_SPIRIT"].includes(ability)
    );
    const paralysisImmune = abilities.includes("ABILITY_LIMBER");
    const statusMove = (!sleepImmune
      ? moves.find(({ move }) => move.effect === "EFFECT_SLEEP")
      : null) ?? (!paralysisImmune
      ? moves.find(({ move }) =>
          move.effect === "EFFECT_PARALYZE" &&
          typeMultiplier(
            mechanics,
            move.type,
            speciesTypes(mechanics, opponent),
          ) > 0
        )
      : null);
    if (statusMove) return { ...statusMove, kind: "status" };
  }

  const hp = Number(opponent?.hp ?? 0);
  const maxHp = Number(opponent?.maxHp ?? 0);
  if (hp <= 1 || maxHp <= 0 || hp / maxHp <= 0.35) return null;
  const safeDamage = moves.flatMap((candidate) => {
    if (!CAPTURE_BOUNDED_EFFECTS.has(candidate.move.effect)) return [];
    const maximumCriticalDamage = captureMoveMaximumCriticalDamage({
      mechanics,
      player,
      opponent,
      move: candidate.move,
    });
    return maximumCriticalDamage > 0 && maximumCriticalDamage < hp
      ? [{ ...candidate, kind: "weaken", maximumCriticalDamage }]
      : [];
  }).sort((left, right) =>
    right.maximumCriticalDamage - left.maximumCriticalDamage ||
    left.moveSlot - right.moveSlot
  );
  return safeDamage[0] ?? null;
}

export function selectCapturePreparationSpecialist({
  mechanics: document,
  party,
  battle,
  activePreparation,
  switchAllowed,
} = {}) {
  if (!switchAllowed || !battle?.opponent) return null;
  const mechanics = dataOf(document);
  const unavailableSlots = new Set([
    ...(battle.activePlayerPartySlots ?? [battle.playerPartySlot]),
    ...(battle.reservedPlayerPartySlots ?? []),
  ].map(Number));
  const opponentLevel = Number(battle.opponent.level ?? 0);
  const candidates = (party ?? []).flatMap((member) => {
    const memberLevel = Number(member.level ?? 0);
    const maximumHp = Number(member.maxHp ?? 0);
    if (
      unavailableSlots.has(Number(member.slot)) ||
      Number(member.hp ?? 0) <= 0 || maximumHp <= 0 ||
      Number(member.hp) / maximumHp < 0.5 ||
      opponentLevel > 0 && memberLevel > 0 && opponentLevel > memberLevel + 2
    ) return [];
    const species = indexed(mechanics.species, member.species);
    const selectableMoveSlots = new Set(
      (member.moves ?? []).flatMap((moveId, moveSlot) =>
        Number(moveId) > 0 && (
          !Array.isArray(member.pp) || Number(member.pp[moveSlot] ?? 0) > 0
        ) ? [moveSlot] : []
      ),
    );
    const preparation = selectCapturePreparationMove({
      mechanics: document,
      player: {
        ...member,
        stats: {
          ...member.stats,
          attack: estimatedPartyStat(species, member, "attack"),
          spAttack: estimatedPartyStat(species, member, "spAttack"),
        },
      },
      opponent: battle.opponent,
      selectableMoveSlots,
    });
    const improvesPreparation = preparation && (
      !activePreparation ||
      preparation.kind === "status" && activePreparation.kind !== "status"
    );
    return improvesPreparation ? [{ member, preparation }] : [];
  }).sort((left, right) =>
    Number(right.preparation.kind === "status") -
      Number(left.preparation.kind === "status") ||
    Number(right.preparation.move?.effect === "EFFECT_SLEEP") -
      Number(left.preparation.move?.effect === "EFFECT_SLEEP") ||
    Number(right.member.level ?? 0) - Number(left.member.level ?? 0) ||
    Number(right.member.hp) / Number(right.member.maxHp) -
      Number(left.member.hp) / Number(left.member.maxHp) ||
    Number(left.member.slot) - Number(right.member.slot)
  );
  return candidates[0] ?? null;
}

export function selectTrainerControlMove({
  mechanics: document,
  player,
  opponent,
  damagingCandidates,
  selectableMoveSlots,
}) {
  const mechanics = dataOf(document);
  const bestDamage = damagingCandidates?.[0];
  const opponentMaxHp = Number(opponent?.maxHp ?? 0);
  if (
    !bestDamage || opponentMaxHp <= 0 ||
    bestDamage.score >= opponentMaxHp * 1.25
  ) return null;
  const abilities = indexed(mechanics.species, opponent?.species)?.abilities ?? [];
    const supportMoves = (player?.moves ?? []).flatMap((moveId, moveSlot) => {
    const move = indexed(mechanics.moves, moveId);
    const pp = Number(player?.pp?.[moveSlot] ?? 0);
    return move && moveId && pp > 0 && Number(move.power) === 0 &&
        evaluateMoveUse({move,attacker:player,defender:opponent,mechanics}).usable &&
        selectableMoveSlots?.has(moveSlot)
      ? [{ moveId, moveSlot, effect: move.effect }]
      : [];
  });
  const status1 = Number(opponent?.status1 ?? 0);
  const sleepImmune = abilities.some((ability) =>
    ["ABILITY_INSOMNIA", "ABILITY_VITAL_SPIRIT"].includes(ability)
  );
  if (status1 === 0 && !sleepImmune) {
    const sleep = supportMoves.find(({ effect }) => effect === "EFFECT_SLEEP");
    if (sleep) return sleep;
  }
  const seeded = (Number(opponent?.status3 ?? 0) & (1 << 2)) !== 0;
  const grassType = speciesTypes(mechanics, opponent).includes("TYPE_GRASS");
  const liquidOoze = abilities.includes("ABILITY_LIQUID_OOZE");
  if (!seeded && !grassType && !liquidOoze) {
    return supportMoves.find(({ effect }) => effect === "EFFECT_LEECH_SEED") ?? null;
  }
  return null;
}

export function speciesIdForBattleName(document, name) {
  if (!name) return null;
  const mechanics = dataOf(document);
  const normalized = `SPECIES_${String(name).toUpperCase()
    .replace(/[^A-Z0-9]+/g, "_").replace(/^_+|_+$/g, "")}`;
  const species = Array.isArray(mechanics.species)
    ? mechanics.species
    : Object.values(mechanics.species ?? {});
  return species.find(
    (species) => species?.name === normalized,
  )?.id ?? null;
}

// FireRed's trainer AI (battle_ai_switch_items.c) commits its action for the
// turn, and zeroes the trainer item it uses, before the player's action menu
// is answered; an item acts before any move. The observer reports each
// battler's chosen action (gChosenActionByBattler: 0 move, 1 item). When the
// opponent has chosen an item this turn our move lands on its healed HP. The
// item's amount is not observed, so the full HP is assumed (the League and
// Champion carry Full Restores); a smaller item only makes a finish need more
// damage. Returns null when no item was chosen or the action is unobserved.
export function trainerHealBeforeMove({battle, opponent = battle?.opponent} = {}) {
  const actions = battle?.chosenActions, battler = Number(opponent?.battler);
  const hp = Number(opponent?.hp), maxHp = Number(opponent?.maxHp);
  if (!Array.isArray(actions) || !Number.isInteger(battler) || !(hp > 0) || !(maxHp > 0)) return null;
  return Number(actions[battler]) === 1 ? {action: 'item', hp: maxHp} : null;
}

// Selection utility is normalized power, not HP. A short finish must use the
// remaining native HP, a conservative damage estimate and the cost of acting.
// Keep uncertain/committed moves, doubles and capture plans with their owners.
// A trainer that heals first (trainerHealBeforeMove) is finished only by a move
// that knocks out its healed HP.
export function finishingBattleMove({mechanics:document,player,opponent,weather,selectableMoveSlots,battle=null}) {
  const mechanics=dataOf(document);
  player=withBattleAbility(mechanics,player);opponent=withBattleAbility(mechanics,opponent);
  if(!(player?.hp>0&&player.level>0&&opponent?.hp>0)||
      Number(player.status1??0)!==0||Number(player.status2??0)!==0||
      Number(opponent.status2??0)!==0||!Array.isArray(opponent.moves)||
      !heldItem(player).known||!heldItem(opponent).known||
      heldItem(opponent).effect==='HOLD_EFFECT_FOCUS_BAND')return null;
  const incoming=maximumCredibleIncomingDamage({mechanics,attacker:opponent,defender:player});
  const remainingHp=trainerHealBeforeMove({battle,opponent})?.hp??opponent.hp;
  const replies=[];
  for(const [slot,id] of opponent.moves.entries()) {
    if(!id||Array.isArray(opponent.pp)&&!(opponent.pp[slot]>0))continue;
    const move=indexed(mechanics.moves,id);if(!move)return null;
    replies.push(move);
  }
  const finishes=[];
  for(const candidate of scoreBattleMoves({mechanics,player,opponent,weather})) {
    if(!selectableMoveSlots?.has(candidate.moveSlot)||candidate.effectiveness<=0)continue;
    const raw=indexed(mechanics.moves,candidate.moveId);
    const move=resolveMoveDamage({move:raw,attacker:player,defender:opponent,mechanics,battle:{weather}});
    if(!move||(move.expectedHits??1)!==1||
        /EXPLOSION|SELF_DESTRUCT|RECOIL|DOUBLE_EDGE|RAMPAGE|RECHARGE|SEMI_INVULNERABLE|SOLAR_BEAM|SKULL_BASH|SKY_ATTACK|RAZOR_WIND|ROLLOUT|FOCUS_PUNCH|OHKO|SUPER_FANG|FALSE_SWIPE/.test(move.effect??''))continue;
    const accuracy=battleMoveAccuracy({move,attacker:player,defender:opponent,weather});
    if(accuracy<1)continue;
    const fixed=deterministicFixedDamage(move,player.level);
    if(fixed===null&&(!moveDamageKind(move)||move.conditionalFixedDamage!=null))continue;
    const minimum=fixed??Math.max(0,Math.floor(candidate.score/accuracy*(2*player.level/5+2)/50*0.85)-3);
    if(minimum<remainingHp)continue;
    const first=replies.length>0&&replies.every(opponentMove=>
      battleTurnOrder({attacker:player,defender:opponent,move,opponentMove}).guaranteed);
    // A slower or uncertain-order finisher must afford a full hit plus margin.
    if(!first&&!(incoming!==null&&player.hp>incoming*2))continue;
    finishes.push({...candidate,estimatedMinimumDamage:minimum,actsFirst:first});
  }
  // Once damage is sufficient, preserve the scarcer attack's remaining PP.
  return finishes.sort((a,b)=>player.pp[b.moveSlot]-player.pp[a.moveSlot]||a.moveSlot-b.moveSlot)[0]??null;
}

function estimatedPartyStat(species, member, stat) {
  const observed = Number(member?.stats?.[stat]);
  if (observed > 0) return observed;
  const baseName = stat === "attack" ? "baseAttack" : "baseSpAttack";
  const base = Number(species?.[baseName] ?? 1);
  const level = Math.max(1, Number(member?.level ?? 1));
  return Math.max(1, Math.floor(((2 * base + 31) * level) / 100) + 5);
}

export function partyMemberMatchupSafety({
  mechanics,
  member,
  opponent,
  damagingCandidates,
}) {
  if (!member || Number(member.hp ?? 0) <= 0) {
    return {
      safe: false,
      belowHealthFloor: true,
      underleveled: false,
      noUsableDamagingMove: false,
      onlyResistedDamagingMoves: false,
    };
  }
  const maximumHp = Number(member.maxHp ?? 0);
  const belowHealthFloor = maximumHp > 0 &&
    Number(member.hp ?? 0) / maximumHp < 0.5;
  const memberLevel = Number(member.level ?? 0);
  const opponentLevel = Number(opponent?.level ?? 0);
  const underleveled = memberLevel > 0 && opponentLevel > 0 &&
    opponentLevel > memberLevel + 2;
  const observedDamage = Array.isArray(damagingCandidates)
    ? damagingCandidates
    : Array.isArray(member.pp) && opponent
      ? scoreBattleMoves({ mechanics, player: member, opponent })
      : null;
  const noUsableDamagingMove = Array.isArray(observedDamage) &&
    observedDamage.length === 0;
  const onlyResistedDamagingMoves = Array.isArray(observedDamage) &&
    observedDamage.length > 0 &&
    observedDamage.every(({ effectiveness }) => Number(effectiveness) < 1);
  return {
    safe: !belowHealthFloor && !underleveled && !noUsableDamagingMove,
    belowHealthFloor,
    underleveled,
    noUsableDamagingMove,
    onlyResistedDamagingMoves,
  };
}

// A short, ordinary fight can train its own participant. This is a conservative
// turn estimate, not a damage guarantee: retain the existing health/level gates
// and budget a maximum incoming hit for every turn plus one spare turn.
export function directTrainingPlan({ mechanics: document, member, opponent, weather }) {
  const mechanics = dataOf(document);
  if (!partyMemberMatchupSafety({mechanics,member,opponent}).safe ||
      !(opponent?.hp > 0) || Number(member?.status1 ?? 0) !== 0 ||
      Number(member?.status2 ?? 0) !== 0) return null;
  const incoming = maximumCredibleIncomingDamage({mechanics,attacker:opponent,defender:member});
  if (incoming === null) return null;
  for (const candidate of scoreBattleMoves({mechanics,player:member,opponent,weather}).slice(0,1)) {
    const raw = indexed(mechanics.moves,candidate.moveId);
    const move = resolveMoveDamage({move:raw,attacker:member,defender:opponent,mechanics,battle:{weather}});
    if (!move || candidate.effectiveness <= 0) continue;
    const fixed = deterministicFixedDamage(move,member.level);
    if (fixed === null && ((move.expectedHits ?? 1) !== 1 || !moveDamageKind(move) ||
        /EXPLOSION|SELF_DESTRUCT|RECOIL|DOUBLE_EDGE|RAMPAGE|RECHARGE|SEMI_INVULNERABLE|SOLAR_BEAM|SKULL_BASH|SKY_ATTACK|RAZOR_WIND|ROLLOUT|FOCUS_PUNCH|OHKO|SUPER_FANG|FALSE_SWIPE/.test(move.effect ?? ''))) continue;
    const accuracy = battleMoveAccuracy({move,attacker:member,defender:opponent,weather});
    if (accuracy < 0.95) continue;
    // Convert the selection score's normalized units back to estimated HP.
    // Fixed damage does not use the ordinary random damage multiplier.
    const damage = fixed ?? Math.max(0,Math.floor(
      candidate.score / accuracy * (2 * member.level / 5 + 2) / 50 * 0.85) - 3);
    const turns = Math.ceil(opponent.hp / damage);
    if (turns > 0 && turns <= 2 && member.pp[candidate.moveSlot] >= turns &&
        member.hp > incoming * (turns + 1)) return {moveId:candidate.moveId,moveSlot:candidate.moveSlot,turns,incoming};
  }
  return null;
}

export function partyMatchupPlan({
  mechanics: document,
  party,
  opponentSpecies,
  opponentBattle = null,
  activeSpecies,
  observation = null,
  balanceExperience = false,
  teamPlan = null,
  freeShift = false,
}) {
  const mechanics = dataOf(document);
  const opponent = indexed(mechanics.species, opponentSpecies);
  if (!opponent) return null;
  const observedThreatTypes = (opponentBattle?.moves ?? []).flatMap(
    (moveId, moveSlot) => {
      const move = indexed(mechanics.moves, moveId);
      const hasObservedPp = Array.isArray(opponentBattle?.pp);
      if (
        !move ||
        Number(move.power ?? 0) <= 0 ||
        hasObservedPp && Number(opponentBattle.pp[moveSlot] ?? 0) <= 0
      ) return [];
      return [move.type];
    },
  );
  const threatTypes = observedThreatTypes.length > 0
    ? [...new Set(observedThreatTypes)]
    : [...new Set(opponent.types ?? [])];
  const candidates = (party ?? []).flatMap((member) => {
    const species = indexed(mechanics.species, member.species);
    if (!species || Number(member.hp) <= 0) return [];
    const moves = scoreBattleMoves({
      mechanics,
      player: {
        ...member,
        species: member.species,
        moves: member.moves ?? [],
        pp: Array.isArray(member.pp)
          ? member.pp
          : (member.moves ?? []).map(() => 1),
        stats: {
          attack: estimatedPartyStat(species, member, "attack"),
          spAttack: estimatedPartyStat(species, member, "spAttack"),
        },
      },
      opponent: {
        ...opponentBattle,
        species: opponentSpecies,
        stats: {
          defense: Number(
            opponentBattle?.stats?.defense ?? opponent.baseDefense ?? 1,
          ),
          spDefense: Number(
            opponentBattle?.stats?.spDefense ?? opponent.baseSpDefense ?? 1,
          ),
        },
      },
    });
    const memberTypes = species.types ?? [];
    const vulnerability = Math.max(
      0.25,
      ...threatTypes.map((type) =>
        battleTypeEffectiveness({mechanics,move:{type},defender:member})
      ),
    );
    const hpRatio = Number(member.hp) / Math.max(1, Number(member.maxHp));
    const offense = moves[0]?.score ?? 0;
    const levelDamageTerm = 2 * Math.max(1, Number(member.level ?? 1)) / 5 + 2;
    return [{
      member,
      score: offense * levelDamageTerm * (0.5 + 0.5 * hpRatio) / vulnerability,
      effectiveness: Number(moves[0]?.effectiveness ?? 0),
    }];
  }).sort((left, right) =>
    right.score - left.score ||
    Number(right.member.level ?? 0) - Number(left.member.level ?? 0) ||
    Number(left.member.slot) - Number(right.member.slot)
  );
  // Do not trust an over-limit foreign Pokemon when a safe obedient fighter
  // can take this opponent. Keep every living member as an emergency fallback.
  const adequate = candidates.filter(({member,effectiveness}) => {
    const safety=partyMemberMatchupSafety({mechanics,member,opponent:opponentBattle});
    const incoming=maximumCredibleIncomingDamage({mechanics,attacker:opponentBattle,defender:member});
    return safety.safe && effectiveness>=1 && !obedienceRisk(member,observation) &&
      (incoming===null || incoming<Number(member.hp));
  });
  let preferred=adequate.length ? candidates.filter(c=>!obedienceRisk(c.member,observation)) : candidates;
  if(balanceExperience && adequate.length) {
    const permanent=new Set(permanentTrainingParty(adequate.map(c=>c.member),teamPlan));
    // Balancing spreads experience; a level-100 member cannot receive any.
    const eligible=adequate.filter(c=>permanent.has(c.member)&&Number(c.member.level)<100);
    if(eligible.length) {
      const floor=Math.min(...eligible.map(c=>Number(c.member.level)));
      preferred=eligible.filter(c=>Number(c.member.level)<=floor+2);
    }
  }
  const strongest = preferred[0] ?? null;
  const active = candidates.find(({ member }) =>
    Number(member.species) === Number(activeSpecies)
  ) ?? null;
  const coverageUpgrade = active
    ? [...preferred]
        .filter((candidate) =>
          Number(candidate.member.species) !== Number(active.member.species) &&
          candidate.effectiveness > 1 &&
          candidate.effectiveness > active.effectiveness &&
          // Announced replacements allow a free shift. During a live turn,
          // coverage must also improve utility to justify giving up an attack.
          (freeShift
            ? candidate.score >= active.score * 0.75
            : candidate.score > active.score * 1.1)
        )
        .sort((left, right) =>
          right.effectiveness - left.effectiveness ||
          right.score - left.score
        )[0] ?? null
    : null;
  const best = coverageUpgrade ?? strongest;
  return best ? { best, active, coverageUpgrade: Boolean(coverageUpgrade), freeShift } : null;
}

export function matchupIsMateriallyBetter(matchup, scoreMultiplier) {
  return Boolean(
    matchup?.best &&
    (matchup.freeShift && matchup.coverageUpgrade ||
      matchup.best.score > Number(matchup.active?.score ?? 0) *
        (matchup.coverageUpgrade ? Math.min(scoreMultiplier,1.1) : scoreMultiplier))
  );
}

export function selectForcedReplacementMember({ mechanics, party, battle, observation = null }) {
  const unavailablePartySlots = new Set([
    ...(battle?.activePlayerPartySlots ?? [battle?.playerPartySlot]),
    ...(battle?.reservedPlayerPartySlots ?? []),
  ].map(Number));
  const healthyReserves = [...(party ?? [])]
    .filter(({ slot, hp }) =>
      Number(hp) > 0 && !unavailablePartySlots.has(Number(slot))
    );
  if (healthyReserves.length === 0) return null;
  // A replacement after a faint enters without a free hit. In a single battle
  // prefer the reserve that wins its race against the opponent on the field,
  // keeping the only answer to a later opponent in reserve when another
  // member also wins. Unknown races keep the established matchup order.
  const flags = observation?.playerMemory?.battleTypeFlags;
  if (flags != null && (Number(flags) & 1) === 0 && Number(battle?.opponent?.hp) > 0) {
    const obedient = healthyReserves.filter((member) => !obedienceRisk(member, observation));
    const { ranked } = planBattleCounters({ mechanics, members: obedient, counterPool: obedient,
      opponent: battle.opponent, remaining: remainingBattleOpponents({ mechanics, battle }),
      weather: battle.weather ?? null });
    if (ranked.length) return ranked[0].member;
  }
  const safeReserves = battle?.opponent
    ? healthyReserves.filter((member) =>
        partyMemberMatchupSafety({
          mechanics,
          member,
          opponent: battle.opponent,
        }).safe
      )
    : healthyReserves;
  const coveredSafeReserves = battle?.opponent
    ? safeReserves.filter((member) =>
        !partyMemberMatchupSafety({
          mechanics,
          member,
          opponent: battle.opponent,
        }).onlyResistedDamagingMoves
      )
    : safeReserves;
  const replacementPool = coveredSafeReserves.length > 0
    ? coveredSafeReserves
    : safeReserves.length > 0
      ? safeReserves
      : healthyReserves;
  const matchup = battle?.opponent?.species
    ? partyMatchupPlan({
        observation,
        mechanics,
        party: replacementPool,
        opponentSpecies: battle.opponent.species,
        opponentBattle: battle.opponent,
        activeSpecies: null,
      })
    : null;
  return matchup?.best?.member ?? replacementPool.sort((left, right) =>
    Number(right.level ?? 0) - Number(left.level ?? 0) ||
    Number(right.hp ?? 0) / Math.max(1, Number(right.maxHp ?? 0)) -
      Number(left.hp ?? 0) / Math.max(1, Number(left.maxHp ?? 0)) ||
    Number(right.hp ?? 0) - Number(left.hp ?? 0) ||
    Number(left.slot) - Number(right.slot)
  )[0];
}

export function battleRecoveryPlan(memory, battle, document, {
  allowSupportRevive = false,
  emergencyRevive = false,
  reviveTarget = null,
} = {}) {
  const mechanics = dataOf(document);
  const party = memory?.trainer?.party ?? [];
  const items = memory?.trainer?.bag?.items ?? [];
  const hasItem = (itemId) => Number(items.find(
    (entry) => Number(entry.itemId) === Number(itemId),
  )?.quantity ?? 0) > 0;
  const reviveItemId = [25, 24].find(hasItem) ?? null;
  if (emergencyRevive && allowSupportRevive && reviveTarget && reviveItemId) {
    return { itemId: reviveItemId, target: reviveTarget, objective: "revive-party-member" };
  }
  const active = party.find(({ species, hp }) =>
    Number(species) === Number(battle?.player?.species) &&
    Number(hp) === Number(battle?.player?.hp)
  ) ?? party.find(({ species }) =>
    Number(species) === Number(battle?.player?.species)
  );
  const activeBattleState = active
    ? { ...active, ...battle?.player }
    : battle?.player;
  const ratio = Number(battle?.player?.hp ?? 0) /
    Math.max(1, Number(battle?.player?.maxHp ?? 0));
  const playerTypes = speciesTypes(mechanics, battle?.player);
  const opponentTypes = speciesTypes(mechanics, battle?.opponent);
  const defensiveVulnerability = Math.max(
    1,
    ...opponentTypes.map((type) =>
      typeMultiplier(mechanics, type, playerTypes)
    ),
  );
  const opponentAsleep =
    (Number(battle?.opponent?.status1 ?? 0) & 0b111) !== 0;
  const majorRecoveryThreshold =
    !opponentAsleep && defensiveVulnerability >= 2 ? 0.65 : 0.45;
  if (active && Number(active.hp) > 0) {
    const confused = (Number(battle?.player?.status2 ?? 0) & 7) !== 0;
    const hasMajorStatus = Number(battle?.player?.status1 ?? 0) !== 0 || confused;
    const maximumIncomingDamage = maximumCredibleIncomingDamage({
      mechanics,
      attacker: battle?.opponent,
      defender: activeBattleState,
    });
    const healingTargetHp = maximumIncomingDamage == null
      ? Math.floor(Number(battle?.player?.maxHp ?? 0) * majorRecoveryThreshold) + 1
      : maximumIncomingDamage + 1;
    const needsHealing = maximumIncomingDamage == null
      ? ratio <= majorRecoveryThreshold
      : Number(battle?.player?.hp ?? 0) < healingTargetHp;
    const maximumHp = Math.max(1, Number(battle?.player?.maxHp ?? 0));
    const healingCandidates = [...BATTLE_HEALING_AMOUNTS.entries()]
      .filter(([itemId]) => hasItem(itemId))
      .map(([itemId, amount]) => ({
        itemId,
        amount: Number.isFinite(amount) ? amount : maximumHp,
      }));
    if (
      hasMajorStatus && needsHealing && hasItem(19) &&
      Math.min(maximumHp, Number(battle.player.hp) + maximumHp) >= healingTargetHp
    ) {
      return {
        itemId: 19,
        target: active,
        objective: "restore-active-pokemon",
      };
    }
    const recoveryItem = needsHealing
      ? healingCandidates
          .filter(({ itemId, amount }) =>
            itemId !== 19 &&
            Math.min(maximumHp, Number(battle.player.hp) + amount) >= healingTargetHp
          )
          .sort((left, right) =>
            left.amount - right.amount || left.itemId - right.itemId
          )[0] ?? healingCandidates
          .filter(({ itemId, amount }) =>
            itemId === 19 &&
            Math.min(maximumHp, Number(battle.player.hp) + amount) >= healingTargetHp
          )[0] ?? null
      : null;
    if (recoveryItem) {
      return {
        itemId: recoveryItem.itemId,
        target: active,
        objective: "restore-active-pokemon",
      };
    }
    if (hasMajorStatus) {
      const status1 = Number(battle?.player?.status1 ?? 0);
      const specificStatusItemIds = [
        ...((status1 & 0b111) !== 0 ? [17] : []),
        ...((status1 & ((1 << 3) | (1 << 7))) !== 0 ? [14] : []),
        ...((status1 & (1 << 4)) !== 0 ? [15] : []),
        ...((status1 & (1 << 5)) !== 0 ? [16] : []),
        ...((status1 & (1 << 6)) !== 0 ? [18] : []),
      ];
      // FireRed's ITEM3_STATUS_ALL includes confusion. Ordinary HP medicine
      // leaves it intact, and healing turns do not spend its attack counter.
      const statusItemId = [...(confused ? [23,19] : []), ...specificStatusItemIds, 23].find(hasItem);
      if (statusItemId) {
        return {
          itemId: statusItemId,
          target: active,
          objective: "cure-active-status",
        };
      }
    }
  }
  if (reviveTarget && allowSupportRevive && reviveItemId) {
    return {
      itemId: reviveItemId,
      target: reviveTarget,
      objective: "revive-party-member",
    };
  }
  return null;
}

export function isReviveSupportCarrier(pokemon, teamPlan) {
  return isHmUtilityCarrier(pokemon, teamPlan);
}

export function selectStrategicReviveTarget({
  mechanics,
  party,
  opponent,
  objective,
  teamPlan,
} = {}) {
  const candidates = (party ?? []).filter((pokemon) =>
    Number(pokemon?.maxHp ?? 0) > 0 &&
    Number(pokemon?.hp ?? 0) === 0 &&
    !isReviveSupportCarrier(pokemon, teamPlan)
  );
  if (candidates.length === 0) return null;
  const battlePlanId = objective?.rosterPreparationFor ?? objective?.id;
  const preferredFamilies = teamPlan?.battlePlans?.[battlePlanId]
    ?.preferredFamilies ?? [];
  const familyRank = (pokemon) => {
    const rank = preferredFamilies.findIndex((family) =>
      (family ?? []).some((species) =>
        Number(species) === Number(pokemon.species)
      )
    );
    return rank >= 0 ? rank : preferredFamilies.length;
  };
  const matchupScore = (pokemon) => {
    if (!opponent?.species) return 0;
    return Number(partyMatchupPlan({
      mechanics,
      party: [{
        ...pokemon,
        hp: Math.max(1, Math.floor(Number(pokemon.maxHp) / 2)),
      }],
      opponentSpecies: opponent.species,
      opponentBattle: opponent,
      activeSpecies: null,
    })?.best?.score ?? 0);
  };
  return [...candidates].sort((left, right) =>
    familyRank(left) - familyRank(right) ||
    matchupScore(right) - matchupScore(left) ||
    Number(right.level ?? 0) - Number(left.level ?? 0) ||
    Number(right.maxHp ?? 0) - Number(left.maxHp ?? 0) ||
    Number(left.slot) - Number(right.slot)
  )[0];
}

export function canSafelyExecuteReviveSequence({ mechanics, pokemon, opponent }) {
  const hp = Number(pokemon?.hp ?? 0);
  const maximumHp = Number(pokemon?.maxHp ?? 0);
  if (hp <= 0 || maximumHp <= 0) return false;
  const maximumIncomingDamage = maximumCredibleIncomingDamage({
    mechanics,
    attacker: opponent,
    defender: pokemon,
  });
  if (maximumIncomingDamage != null) {
    return hp > maximumIncomingDamage * 2;
  }
  const pokemonLevel = Number(pokemon?.level ?? 0);
  const opponentLevel = Number(opponent?.level ?? 0);
  return hp / maximumHp >= 0.8 && !(
    pokemonLevel > 0 && opponentLevel > pokemonLevel + 2
  );
}

export const ACTIVE_BATTLE_RECOVERY_ITEMS = new Set([
  13, 14, 15, 16, 17, 18, 19, 20, 21, 22, 23, 26, 27, 28, 29,
]);
export const BATTLE_REVIVE_ITEMS = new Set([24, 25]);

export function committedBattleRecoveryPlan(memory, battle, { reviveTarget = null } = {}) {
  const partyUi = memory?.ui?.party;
  if (partyUi?.stage !== "choose-pokemon") return null;
  const itemId = Number(partyUi.itemId);
  const party = memory?.trainer?.party ?? [];
  if (BATTLE_REVIVE_ITEMS.has(itemId)) {
    return reviveTarget
      ? { itemId, target: reviveTarget, objective: "revive-party-member" }
      : null;
  }
  if (!ACTIVE_BATTLE_RECOVERY_ITEMS.has(itemId)) return null;
  const reportedSlot = Number(battle?.playerPartySlot);
  const reportedMember = party.find(({ slot }) => Number(slot) === reportedSlot);
  const target = (
    reportedMember &&
    Number(reportedMember.species) === Number(battle?.player?.species)
      ? reportedMember
      : party.find(({ species, hp }) =>
          Number(species) === Number(battle?.player?.species) &&
          Number(hp) === Number(battle?.player?.hp)
        ) ?? party.find(({ species }) =>
          Number(species) === Number(battle?.player?.species)
        )
  );
  if (!target) return null;
  return {
    itemId,
    target,
    objective: [14, 15, 16, 17, 18, 23].includes(itemId)
      ? "cure-active-status"
      : "restore-active-pokemon",
  };
}

// ---------------------------------------------------------------------------
// KO races. A conservative, pure estimate of one of our members against one
// opponent. Our damage is the minimum damage roll times accuracy with the
// best legal move that still has PP (no critical hits); the opponent's damage
// is maximumCredibleIncomingDamage, the maximum roll of every usable move.
// An unknown or uncertain speed order assumes the opponent acts first. The
// "entry" variant charges the free hit a paid switch-in takes before it can
// act. Any input needed for a sound bound that is unknown returns null, so
// callers keep their established behavior instead of guessing.
// ---------------------------------------------------------------------------
const RACE_UNRELIABLE_EFFECTS = /EXPLOSION|SELF_DESTRUCT|FOCUS_PUNCH|OHKO|FALSE_SWIPE|COUNTER|MIRROR_COAT|BIDE|FUTURE_SIGHT|BEAT_UP|ENDEAVOR|SUPER_FANG|PSYWAVE|SNORE|DREAM_EATER|SPIT_UP|FAKE_OUT|PRESENT/;
const RACE_TWO_TURN_EFFECTS = /SOLAR_BEAM|SKULL_BASH|SKY_ATTACK|RAZOR_WIND|SEMI_INVULNERABLE|RECHARGE/;
const RACE_RECOIL = Object.freeze({ EFFECT_RECOIL: 1 / 4, EFFECT_DOUBLE_EDGE: 1 / 3 });
// Moves whose damage depends on our own action; bounded separately below.
const RACE_REACTIVE_EFFECTS = new Set(["EFFECT_COUNTER", "EFFECT_MIRROR_COAT", "EFFECT_FUTURE_SIGHT"]);
const RACE_MAXIMUM_TURNS = 30;

function raceOrdinaryDamage({ mechanics, attacker, defender, move, weather, roll }) {
  const power = Number(move?.power ?? 0);
  if (!(power > 0)) return null;
  const physical = PHYSICAL_TYPES.has(move.type);
  const attackStat = physical ? "attack" : "spAttack";
  const defenseStat = physical ? "defense" : "spDefense";
  const attack = observedOrEstimatedBattleStat(mechanics, attacker, attackStat);
  const defense = observedOrEstimatedBattleStat(mechanics, defender, defenseStat);
  if (!(attack > 0) || !(defense > 0)) return null;
  const modified = battleDamageStats({ move, attacker, defender, attack, defense });
  if (!modified.known) return null;
  const stagedAttack = modified.attack * battleStatStageMultiplier(attacker?.statStages?.[attackStat]);
  const stagedDefense = modified.defense * battleStatStageMultiplier(defender?.statStages?.[defenseStat]);
  const base = Math.floor(
    Math.floor(Math.floor((2 * Number(attacker.level)) / 5 + 2) * power * stagedAttack / Math.max(1, stagedDefense)) / 50,
  ) + 2;
  const stab = liveMoveTypes(mechanics, attacker).includes(move.type) ? 1.5 : 1;
  const effectiveness = battleTypeEffectiveness({ mechanics, move, defender });
  if (!(effectiveness > 0)) return 0;
  const damage = ((base - 2) * battleDamageMultiplier({ move, attacker, defender, weather }) + 2) *
    battlePostDamageMultiplier({ move, attacker }) * stab * effectiveness;
  return Math.max(1, roll < 1 ? Math.floor(damage * roll) : Math.ceil(damage));
}

function raceMoveOption({ mechanics, attacker, defender, moveId, moveSlot, weather }) {
  const raw = indexed(mechanics.moves, moveId);
  if (!raw || !(Number(raw.power) > 0) || RACE_UNRELIABLE_EFFECTS.test(raw.effect ?? "")) return null;
  const move = resolveMoveDamage({ move: raw, attacker, defender, mechanics, battle: { weather } });
  if (!move || move.conditionalFixedDamage != null) return null;
  const accuracy = battleMoveAccuracy({ move, attacker, defender, weather });
  if (!(accuracy > 0)) return null;
  const fixed = deterministicFixedDamage(move, attacker.level);
  let minimum, maximum;
  if (fixed !== null) {
    if (battleTypeEffectiveness({ mechanics, move, defender }) === 0) return null;
    minimum = maximum = fixed;
  } else {
    if (!moveDamageKind(move)) return null;
    minimum = raceOrdinaryDamage({ mechanics, attacker, defender, move, weather, roll: 0.85 });
    maximum = raceOrdinaryDamage({ mechanics, attacker, defender, move, weather, roll: 1 });
    if (!(minimum > 0) || !(maximum > 0)) return null;
  }
  const hits = Number(move.expectedHits ?? 1);
  const sunny = (effectiveBattleWeather(weather ?? attacker?.battleWeather, [attacker, defender]) & 96) !== 0;
  const chargeTurns = RACE_TWO_TURN_EFFECTS.test(move.effect ?? "") &&
    !(move.effect === "EFFECT_SOLAR_BEAM" && sunny) ? 2 : 1;
  return {
    moveId: Number(moveId), moveSlot, move, accuracy, chargeTurns,
    perUse: minimum * hits,
    maximumPerUse: maximum * (move.effect === "EFFECT_MULTI_HIT" ? 5 : hits),
    perTurn: minimum * hits * accuracy / chargeTurns,
    physical: PHYSICAL_TYPES.has(move.type),
    recoil: RACE_RECOIL[move.effect] ?? 0,
  };
}

function raceIncomingDamage({ mechanics, attacker, defender, weather }) {
  const moves = attacker?.moves ?? [];
  const usable = (slot) => !Array.isArray(attacker.pp) || Number(attacker.pp[slot] ?? 0) > 0;
  const reactive = moves.flatMap((id, slot) => {
    const move = indexed(mechanics.moves, id);
    return Number(id) > 0 && move && RACE_REACTIVE_EFFECTS.has(move.effect) && usable(slot) ? [move] : [];
  });
  const ordinary = moves.map((id) =>
    RACE_REACTIVE_EFFECTS.has(indexed(mechanics.moves, id)?.effect) ? 0 : id);
  let base = maximumCredibleIncomingDamage({ mechanics, attacker: { ...attacker, moves: ordinary }, defender });
  if (base === null) {
    // Every remaining move was reactive, or the bound is genuinely unknown.
    if (ordinary.some((id, slot) => Number(id) > 0 && usable(slot))) return null;
    base = 0;
  }
  for (const move of reactive) {
    if (move.effect !== "EFFECT_FUTURE_SIGHT") continue;
    // Gen III Future Sight is typeless special damage; bound it immediately.
    const hit = raceOrdinaryDamage({ mechanics, attacker, defender, weather, roll: 1,
      move: { ...move, type: "TYPE_MYSTERY", effect: "EFFECT_HIT" } });
    if (hit === null) return null;
    base = Math.max(base, hit);
  }
  return {
    base,
    counter: reactive.some((move) => move.effect === "EFFECT_COUNTER"),
    mirrorCoat: reactive.some((move) => move.effect === "EFFECT_MIRROR_COAT"),
  };
}

function raceActsFirst({ mechanics, attacker, defender, move }) {
  const replies = [];
  for (const [slot, id] of (defender?.moves ?? []).entries()) {
    if (!Number(id) || Array.isArray(defender.pp) && !(Number(defender.pp[slot]) > 0)) continue;
    const reply = indexed(mechanics.moves, id);
    if (!reply) return false;
    replies.push(reply);
  }
  return (replies.length ? replies : [{ priority: 0 }]).every((reply) =>
    battleTurnOrder({ attacker, defender, move, opponentMove: reply }).guaranteed);
}

function raceResidualDamage({ mechanics, member, opponent, weather, turn }) {
  const maximumHp = Math.max(1, Number(member.maxHp ?? member.hp));
  const status = Number(member.status1 ?? 0);
  let damage = 0;
  if (status & (8 | 16)) damage += Math.max(1, Math.floor(maximumHp / 8));
  if (status & 128) damage += Math.max(1, Math.floor(maximumHp / 16)) * (((status >> 8) & 15) + turn);
  if (Number(member.status3 ?? 0) & 4) damage += Math.max(1, Math.floor(maximumHp / 8));
  const field = effectiveBattleWeather(weather ?? member?.battleWeather, [member, opponent]);
  const types = speciesTypes(mechanics, member);
  if ((field & 24) && !types.some((type) => ["TYPE_ROCK", "TYPE_GROUND", "TYPE_STEEL"].includes(type))) {
    damage += Math.max(1, Math.floor(maximumHp / 16));
  }
  if ((field & 128) && !types.includes("TYPE_ICE")) damage += Math.max(1, Math.floor(maximumHp / 16));
  return damage;
}

export function battleKoRace({
  mechanics: document,
  member,
  opponent,
  weather = null,
  entry = false,
  selectableMoveSlots = null,
} = {}) {
  const mechanics = dataOf(document);
  if (!member || !opponent || !Array.isArray(member.moves) || !Array.isArray(member.pp) ||
      !Array.isArray(opponent.moves)) return null;
  const attacker = withBattleAbility(mechanics, member);
  const defender = withBattleAbility(mechanics, opponent);
  const hp = Number(attacker.hp), opponentHp = Number(defender.hp);
  const opponentMaximumHp = Math.max(opponentHp, Number(defender.maxHp ?? 0));
  if (!(hp > 0) || !(opponentHp > 0) || !(Number(attacker.level) > 0) || !(Number(defender.level) > 0)) return null;
  const status = Number(attacker.status1 ?? 0);
  if (status & 32) return null; // A frozen member thaws at random.
  if (!heldItem(attacker).known || !heldItem(defender).known) return null;
  const incoming = raceIncomingDamage({ mechanics, attacker: defender, defender: attacker, weather });
  if (!incoming) return null;
  const options = [];
  for (const [moveSlot, moveId] of attacker.moves.entries()) {
    if (!Number(moveId) || !(Number(attacker.pp[moveSlot] ?? 0) > 0)) continue;
    if (selectableMoveSlots && !selectableMoveSlots.has(moveSlot)) continue;
    const option = raceMoveOption({ mechanics, attacker, defender, moveId, moveSlot, weather });
    if (option) options.push({ ...option,
      actsFirst: raceActsFirst({ mechanics, attacker, defender, move: option.move }) });
  }
  options.sort((left, right) => right.perTurn - left.perTurn || left.moveSlot - right.moveSlot);
  const volatile = Number(attacker.status2 ?? 0);
  let actionRate = 1;
  if (status & 64) actionRate *= 0.75;
  if (volatile & 7) actionRate *= 0.5;
  if (volatile & 0xf0000) actionRate *= 0.5;
  const lostTurns = (status & 7) + (Number(attacker.moveState?.rechargeTurns ?? 0) > 0 || (volatile & (1 << 22)) ? 1 : 0);
  const item = heldItem(defender);
  const leftovers = item.effect === "HOLD_EFFECT_LEFTOVERS" ? Math.max(1, Math.floor(opponentMaximumHp / 16)) : 0;
  const substitute = (Number(defender.status2 ?? 0) & (1 << 24)) ? Number(defender.moveState?.substituteHp ?? 0) : 0;
  const pp = options.map((option) => Number(attacker.pp[option.moveSlot] ?? 0));
  const choose = (turn) => turn <= lostTurns ? -1 : options.findIndex((option, index) =>
    pp[index] >= (option.chargeTurns > 1 ? 0.5 : 1));
  // Independent quantities for reporting and callers' tie-breaks.
  let turnsToKo = Infinity;
  {
    let remaining = opponentHp + substitute, berry = item.effect === "HOLD_EFFECT_RESTORE_HP" ? Number(item.param) || 0 : 0;
    const spent = [...pp];
    for (let turn = 1; turn <= RACE_MAXIMUM_TURNS; turn++) {
      const index = turn <= lostTurns ? -1 : options.findIndex((option, i) =>
        spent[i] >= (option.chargeTurns > 1 ? 0.5 : 1));
      if (index >= 0) {
        remaining -= options[index].perTurn * actionRate;
        spent[index] -= options[index].chargeTurns > 1 ? 0.5 : 1;
      }
      if (remaining <= 0) { turnsToKo = turn; break; }
      remaining += leftovers;
      if (berry && remaining <= opponentMaximumHp / 2) { remaining += berry; berry = 0; }
    }
  }
  const turnsToFaint = incoming.base > 0
    ? Math.max(0, Math.ceil(hp / incoming.base) - (entry ? 1 : 0))
    : Infinity;
  let myHp = hp, foeHp = opponentHp + substitute, acted = false, outcome = null, first = null, lead = null, faintTurn = null;
  let certain = false;
  let berry = item.effect === "HOLD_EFFECT_RESTORE_HP" ? Number(item.param) || 0 : 0;
  if (entry) {
    myHp -= incoming.base;
    if (myHp <= 0) { outcome = "faint"; faintTurn = 0; }
  }
  for (let turn = 1; turn <= RACE_MAXIMUM_TURNS && !outcome; turn++) {
    faintTurn = turn;
    const index = choose(turn);
    const option = index >= 0 ? options[index] : null;
    lead ??= option;
    const counterHit = option && (option.physical ? incoming.counter : incoming.mirrorCoat)
      ? 2 * option.maximumPerUse : 0;
    const counterTurn = counterHit > incoming.base;
    const hit = Math.max(incoming.base, counterHit);
    const actsFirst = Boolean(option?.actsFirst) || counterTurn;
    if (first === null) first = Boolean(option?.actsFirst);
    const act = () => {
      if (!option) return;
      foeHp -= option.perTurn * actionRate;
      myHp -= option.recoil * option.maximumPerUse * actionRate;
      pp[index] -= option.chargeTurns > 1 ? 0.5 : 1;
      acted = true;
    };
    if (!actsFirst) {
      myHp -= hit;
      if (myHp <= 0) { outcome = "faint"; break; }
      act();
    } else {
      act();
    }
    if (foeHp <= 0) {
      outcome = myHp > 0 ? "win" : "faint";
      // A first-turn knockout by a guaranteed-first, always-hitting move
      // cannot be answered, whatever HP the member has left.
      certain = outcome === "win" && turn === 1 && Boolean(option?.actsFirst) && !counterTurn &&
        option.accuracy >= 1 && actionRate === 1;
      break;
    }
    if (myHp <= 0) { outcome = "faint"; break; }
    if (actsFirst) {
      myHp -= hit;
      if (myHp <= 0) { outcome = "faint"; break; }
    }
    myHp -= raceResidualDamage({ mechanics, member: attacker, opponent: defender, weather, turn });
    if (myHp <= 0) { outcome = "faint"; break; }
    foeHp += leftovers;
    if (berry && foeHp <= opponentMaximumHp / 2) { foeHp += berry; berry = 0; }
  }
  const wins = outcome === "win";
  const damagePerTurn = lead ? lead.perTurn * actionRate : 0;
  return {
    wins,
    // Additional maximum hits the member could absorb and still win; negative
    // values count the actions it would still need when it loses.
    margin: wins
      ? incoming.base > 0 ? Math.floor((myHp - 1) / incoming.base) : RACE_MAXIMUM_TURNS
      : damagePerTurn > 0 ? -Math.min(99, Math.ceil(Math.max(0, foeHp) / damagePerTurn)) : -99,
    turnsToKo,
    turnsToFaint,
    movesFirst: Boolean(first),
    faintsBeforeActing: outcome === "faint" && !acted,
    // The member faints during the first turn of the race (0 = on entry).
    faintsThisTurn: outcome === "faint" && faintTurn !== null && faintTurn <= 1,
    certain,
    incoming: incoming.base,
    damagePerTurn,
    moveId: lead?.moveId ?? null,
    moveSlot: lead?.moveSlot ?? null,
    remainingHp: Math.max(0, Math.floor(myHp)),
    entry: Boolean(entry),
  };
}

// A comfortable win survives at least one extra maximum hit, or cannot be
// answered at all (a certain first-turn knockout). A narrow win is still a
// win, but a crit or a high roll can reverse it.
export function raceIsComfortable(race) {
  return Boolean(race?.wins && (race.margin >= 1 || race.certain));
}

// Trainer data names species, moves and items; resolve them once per document.
const raceNameIndexes = new WeakMap();
function raceNameIndex(mechanics) {
  if (!mechanics || typeof mechanics !== "object") return null;
  if (!raceNameIndexes.has(mechanics)) {
    const byName = (collection) => new Map(
      (Array.isArray(collection) ? collection : Object.values(collection ?? {}))
        .filter((entry) => entry?.name && Number.isSafeInteger(Number(entry.id)))
        .map((entry) => [entry.name, Number(entry.id)]),
    );
    raceNameIndexes.set(mechanics, {
      species: byName(mechanics.species),
      moves: byName(mechanics.moves),
      items: new Map(Object.values(itemCatalog.items ?? {}).filter((row) => row?.name)
        .map((row) => [row.name, Number(row.id)])),
    });
  }
  return raceNameIndexes.get(mechanics);
}

// A static trainer party entry as a battler: Gen III trainer IVs are
// iv*31/255 for every stat, no EVs, and a neutral nature is assumed.
export function estimatedTrainerPokemon(document, entry, slot = null) {
  const mechanics = dataOf(document);
  const names = raceNameIndex(mechanics);
  if (!entry || !names) return null;
  const speciesId = Number.isSafeInteger(Number(entry.species)) ? Number(entry.species) : names.species.get(entry.species);
  const species = indexed(mechanics.species, speciesId);
  const level = Number(entry.lvl ?? entry.level);
  if (!species || !(level > 0) || !Array.isArray(entry.moves) || entry.moves.length === 0) return null;
  const moves = entry.moves.map((move) => Number.isSafeInteger(Number(move)) ? Number(move) : names.moves.get(move));
  if (moves.some((move) => !Number.isSafeInteger(move))) return null;
  const item = entry.heldItem == null || entry.heldItem === "ITEM_NONE" ? 0
    : Number.isSafeInteger(Number(entry.heldItem)) ? Number(entry.heldItem) : names.items.get(entry.heldItem);
  if (!Number.isSafeInteger(item)) return null;
  const iv = Math.floor(Number(entry.iv ?? 0) * 31 / 255);
  const stat = (base) => Math.floor(((2 * Number(base) + iv) * level) / 100) + 5;
  const maxHp = Math.floor(((2 * Number(species.baseHP) + iv) * level) / 100) + level + 10;
  if (![species.baseHP, species.baseAttack, species.baseDefense, species.baseSpeed, species.baseSpAttack, species.baseSpDefense]
    .every((value) => Number(value) > 0)) return null;
  return {
    slot, species: speciesId, level, hp: maxHp, maxHp, moves,
    pp: moves.map((move) => Number(indexed(mechanics.moves, move)?.pp ?? 0)),
    heldItem: item, status1: 0,
    stats: {
      attack: stat(species.baseAttack), defense: stat(species.baseDefense), speed: stat(species.baseSpeed),
      spAttack: stat(species.baseSpAttack), spDefense: stat(species.baseSpDefense),
    },
    estimated: true,
  };
}

export function estimatedTrainerParty(document, trainerId) {
  const trainer = indexed(dataOf(document).trainers, trainerId);
  const party = Array.isArray(trainer?.party) ? trainer.party : null;
  if (!party?.length) return null;
  const estimated = party.map((entry, slot) => estimatedTrainerPokemon(document, entry, slot));
  return estimated.every(Boolean) ? estimated : null;
}

// The opponents still to be faced after the current one, from the live enemy
// party (gEnemyParty). Static trainer data is only a fallback when no live
// party is observed; it then assumes party order for the unseen members.
export function remainingBattleOpponents({ mechanics, battle } = {}) {
  const current = Number(battle?.battlerPartyIndexes?.[1]);
  const live = (battle?.enemyParty ?? []).filter((pokemon) =>
    Number(pokemon?.species) > 0 && Number(pokemon?.level) > 0 && !pokemon.isEgg &&
    (pokemon.validity == null || pokemon.validity === "valid"));
  if (live.length) {
    return live.filter((pokemon) => Number(pokemon.hp) > 0 && Number(pokemon.slot) !== current);
  }
  const estimated = Number.isSafeInteger(Number(battle?.trainerId))
    ? estimatedTrainerParty(mechanics, Number(battle.trainerId))
    : null;
  return estimated && Number.isSafeInteger(current)
    ? estimated.filter((pokemon) => Number(pokemon.slot) > current)
    : [];
}

const raceIdentity = (member) => [Number(member?.personality ?? 0), Number(member?.otId ?? 0), Number(member?.species ?? 0)];
function compareRaceIdentity(left, right) {
  const a = raceIdentity(left), b = raceIdentity(right);
  return a[0] - b[0] || a[1] - b[1] || a[2] - b[2];
}

// Rank members that win the race against one opponent. A comfortable win
// (see raceIsComfortable) ranks before a narrow one. A member that is
// the only winner against a remaining opponent is reserved for it and ranks
// after every other win of the same comfort. Ties never depend on party slot
// order, so a field reorder cannot flip the choice back.
export function planBattleCounters({
  mechanics,
  members = [],
  opponent,
  remaining = [],
  counterPool = members,
  weather = null,
  entry = false,
  excludeSlots = new Set(),
} = {}) {
  const reserved = new Map();
  for (const enemy of remaining ?? []) {
    const winners = (counterPool ?? []).filter((member) =>
      battleKoRace({ mechanics, member, opponent: enemy, weather })?.wins);
    if (winners.length === 1) reserved.set(Number(winners[0].slot), enemy);
  }
  const ranked = (members ?? []).filter((member) => !excludeSlots.has(Number(member.slot)))
    .map((member) => ({ member, race: battleKoRace({ mechanics, member, opponent, weather, entry }) }))
    .filter(({ race }) => race?.wins)
    .sort((left, right) =>
      Number(raceIsComfortable(right.race)) - Number(raceIsComfortable(left.race)) ||
      Number(reserved.has(Number(left.member.slot))) - Number(reserved.has(Number(right.member.slot))) ||
      left.race.turnsToKo - right.race.turnsToKo ||
      right.race.margin - left.race.margin ||
      Number(right.member.level ?? 0) - Number(left.member.level ?? 0) ||
      Number(right.member.hp ?? 0) / Math.max(1, Number(right.member.maxHp ?? 0)) -
        Number(left.member.hp ?? 0) / Math.max(1, Number(left.member.maxHp ?? 0)) ||
      compareRaceIdentity(left.member, right.member));
  return { ranked, reserved };
}
