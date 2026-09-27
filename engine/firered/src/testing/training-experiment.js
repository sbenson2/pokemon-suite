import { CAMPAIGN_MAJOR_BATTLE_LEVEL_TARGETS, IMPORTANT_BATTLE_TRAINER_NAMES } from "../player/campaign.js";
import { isProgressObservation } from "../player/progress-observation.js";

// Explicit research-only configuration. These defaults never enter an ordinary run.
export const HARD_MODE_ACQUISITIONS = Object.freeze(["fearow", "nidoran-m", "mr-mime", "snorlax", "lapras"]);
const TARGET_FIELDS = Object.freeze(["minimumTeamAnchorLevel", "minimumBattleMemberLevel",
  "starterBattleTargetLevel", "supportBattleTargetLevel", "battleTeamTargetLevel", "minimumCoreLevel"]);
const FPS = 59.7275;

export function validateTrainingExperiment(value) {
  if (!value || value.schema !== "master-red/training-experiment/v1" ||
      !["efficiency", "underlevel"].includes(value.mode)) throw new TypeError("invalid training experiment");
  const keys = ["schema", "mode", "purpose", ...(value.mode === "efficiency" ? ["readiness", "windowFrames"] : [])];
  if (Object.keys(value).some(key => !keys.includes(key))) throw new TypeError("unknown experiment option");
  if (typeof value.purpose !== "string" || !value.purpose.trim() || value.purpose.length > 240) throw new TypeError("experiment requires a short purpose");
  if (value.mode === "efficiency" && (!["baseline", "ace-match"].includes(value.readiness) ||
      !Number.isSafeInteger(value.windowFrames) || value.windowFrames < 600 || value.windowFrames > 2_000_000)) {
    throw new TypeError("efficiency experiment requires a readiness arm and bounded native-frame window");
  }
  return Object.freeze(structuredClone(value));
}

export function createTrainingExperimentCampaign({ campaign, config }) {
  validateTrainingExperiment(config);
  if (config.mode === "efficiency" && config.readiness === "baseline") return campaign;
  // Later bosses sometimes have LOWER levels. The suffix minimum prevents the
  // training target for an early boss from already breaking the next one's cap.
  const caps = Array(campaign.objectives.length).fill(100);
  let futureCap = 100;
  for (let i = campaign.objectives.length - 1; i >= 0; i--) {
    const objective = campaign.objectives[i];
    if (objective.importantBattle) futureCap = Math.min(futureCap, objective.enemyAceLevel - 2);
    caps[i] = futureCap;
  }
  const leagueEntry = campaign.objectives.findIndex(x => x.id === "elite-four-lorelei");
  const transform = (objective, index) => {
    if (config.mode === "efficiency" && !objective.importantBattle) return objective;
    const value = config.mode === "underlevel"
      ? Math.max(5, (index >= leagueEntry && leagueEntry >= 0 ? caps[leagueEntry] : caps[index]) - 1)
      : Number(objective.enemyAceLevel);
    const changed = { ...objective };
    for (const key of TARGET_FIELDS) if (typeof objective[key] === "number") changed[key] = value;
    if (config.mode === "underlevel" && objective.importantBattle) {
      changed.experimentalEntryCap = objective.enemyAceLevel - 2;
      changed.experimentalTrainingBuffer = 1;
    }
    return Object.freeze(changed);
  };
  return Object.freeze({ ...campaign, objectives: Object.freeze(campaign.objectives.map(transform)) });
}

export function createBossAuditCatalog(document) {
  const mechanics = document?.data ?? document;
  const trainers = Object.values(mechanics?.trainers ?? {});
  return Object.entries(IMPORTANT_BATTLE_TRAINER_NAMES).flatMap(([objectiveId, names]) => {
    const entries = names.map(name => trainers.find(trainer => trainer.name === name));
    if (entries.some(entry => !entry || !Number.isInteger(entry.id) || !entry.party?.length)) {
      throw new Error(`missing cartridge boss data: ${objectiveId}`);
    }
    return entries.map(trainer => ({ objectiveId, trainerId: trainer.id,
      category: CAMPAIGN_MAJOR_BATTLE_LEVEL_TARGETS[objectiveId].category,
      ace: Math.max(...trainer.party.map(member => Number(member.lvl ?? member.level))) }));
  });
}

function partyOf(memory) {
  return (memory.trainer?.party ?? []).filter(x => x.species > 0 && x.level > 0 && x.validity !== "invalid");
}
const identity = member => `${member.otId ?? "unknown"}:${member.personality ?? `species-${member.species}`}`;
const partyProof = party => party.map(({ personality, otId, species, level, experience, hp, maxHp, moves, heldItem }) =>
  ({ personality, otId, species, level, experience, hp, maxHp, moves, heldItem }));
function inventory(memory) {
  const result = new Map();
  for (const pocket of Object.values(memory.trainer?.bag ?? {})) {
    if (!Array.isArray(pocket)) continue;
    for (const item of pocket) if (item.itemId > 0) result.set(item.itemId, (result.get(item.itemId) ?? 0) + Number(item.quantity ?? 0));
  }
  return result;
}
function activity(update) {
  const mode = update.observation.emulator?.mode;
  if (update.observation.emulator?.inBattle || mode === "battle") return "battle";
  if (mode !== "overworld") return "menuOrTransition";
  const reason = JSON.stringify(update.decision ?? {});
  if (/vs-seeker-recharge/i.test(reason)) return "recharge";
  if (/heal|recover|restor/i.test(reason)) return "recovery";
  return "overworld";
}

export function createTrainingExperimentMonitor({ config, baseMonitor, bossCatalog = [], clock = Date.now }) {
  validateTrainingExperiment(config);
  const catalog = new Map(bossCatalog.map(entry => [entry.trainerId, entry]));
  const requiredBosses = [...new Set(bossCatalog.filter(x => x.category !== "tutorial-rival").map(x => x.objectiveId))];
  const startedAt = clock();
  const members = new Map();
  const bosses = [];
  const activityFrames = {};
  const inventoryRemovals = {};
  let initialFrame = null, previousFrame = null, previousActivity = "unknown", previousMap = null;
  let initialMoney = null, latestMoney = null, previousBag = null, newMembers = 0;
  let mapChanges = 0, faintEvents = 0, recoveryEvents = 0, activeBattle = null, battleCount = 0;
  let nativeBattleActive = false, stopReason = null, failure = null;
  return {
    observe(update) {
      const base = baseMonitor.observe(update);
      const observation = update.observation;
      const memory = observation.playerMemory ?? {};
      const frame = Number(observation.frame);
      const valid = isProgressObservation(observation);
      if (initialFrame === null && valid && partyOf(memory).length) initialFrame = frame;
      if (initialFrame !== null && previousFrame !== null && frame > previousFrame) {
        activityFrames[previousActivity] = (activityFrames[previousActivity] ?? 0) + frame - previousFrame;
      }
      if (initialFrame !== null) { previousFrame = frame; previousActivity = activity(update); }
      if (valid) {
        const party = partyOf(memory);
        for (const member of party) {
          const key = identity(member);
          const previous = members.get(key);
          if (!previous) {
            if (members.size && frame !== initialFrame) newMembers++;
            members.set(key, { ...partyProof([member])[0], initialLevel: member.level,
              initialExperience: member.experience ?? null, experienceGained: 0 });
          } else {
            if (previous.hp > 0 && member.hp === 0) faintEvents++;
            if (previous.hp < member.hp && !observation.emulator?.inBattle && observation.emulator?.mode !== "battle") recoveryEvents++;
            const gained = Number.isFinite(member.experience) && Number.isFinite(previous.experience)
              ? Math.max(0, member.experience - previous.experience) : 0;
            members.set(key, { ...previous, ...partyProof([member])[0], experienceGained: previous.experienceGained + gained });
          }
        }
        if (Number.isFinite(memory.trainer?.money)) {
          initialMoney ??= memory.trainer.money;
          latestMoney = memory.trainer.money;
        }
        if (memory.trainer?.bag) {
          const bag = inventory(memory);
          if (previousBag) for (const [id, count] of previousBag) {
            const removed = Math.max(0, count - (bag.get(id) ?? 0));
            if (removed) inventoryRemovals[id] = (inventoryRemovals[id] ?? 0) + removed;
          }
          previousBag = bag;
        }
        if (previousMap && previousMap !== memory.map.id) mapChanges++;
        previousMap = memory.map.id;
      }
      // inBattle remains true in the Bag/Party submenus: those are not exits.
      const inBattle = observation.emulator?.inBattle === true || observation.emulator?.mode === "battle";
      if (inBattle && !nativeBattleActive) { battleCount++; nativeBattleActive = true; }
      if (!inBattle && valid && observation.emulator?.mode === "overworld") {
        if (activeBattle && !activeBattle.outcome) activeBattle.outcome = "unknown";
        activeBattle = null;
        nativeBattleActive = false;
      }
      const entry = catalog.get(memory.battle?.trainerId);
      if (inBattle && valid && !activeBattle && entry && memory.battleTypeFlags & 8 &&
          memory.encounter?.validity === "valid" && memory.encounter?.kind === "trainer" &&
          memory.battle?.enemyParty?.some(x => x.species > 0 && x.level > 0) && partyOf(memory).length) {
        const ace = Math.max(...memory.battle.enemyParty.filter(x => x.species > 0).map(x => x.level));
        const tutorial = entry.category === "tutorial-rival";
        activeBattle = { objectiveId: entry.objectiveId, trainerId: entry.trainerId, enemyAce: ace,
          catalogAce: entry.ace, cap: ace - 2, entryParty: partyProof(partyOf(memory)),
          underlevel: tutorial ? null : ace === entry.ace && partyOf(memory).every(x => x.level <= ace - 2),
          ...(tutorial ? { exception: "forced-level-five-tutorial" } : {}),
          entry: { frame, captureId: observation.captureId, playerMemorySha256: memory.sha256 }, outcome: null };
        bosses.push(activeBattle);
      }
      // Outcomes can arrive during animation, before the next stable overworld.
      if (inBattle && activeBattle && !activeBattle.outcome && Number(memory.battleOutcome) > 0) {
        activeBattle.outcome = ({ 1: "won", 2: "lost", 3: "draw", 4: "ran", 5: "teleported", 6: "fled", 7: "caught" })[memory.battleOutcome] ?? "unknown";
        activeBattle.exitFrame = frame;
      }
      const nativeFrames = initialFrame === null ? 0 : Math.max(0, frame - initialFrame);
      const totalExperienceGained = [...members.values()].reduce((sum, x) => sum + x.experienceGained, 0);
      const capViolations = bosses.filter(x => x.underlevel === false).length;
      const missingBosses = requiredBosses.filter(id => !bosses.some(x => x.objectiveId === id && x.underlevel && x.outcome === "won"));
      const losses = bosses.filter(x => ["lost", "draw"].includes(x.outcome)).length;
      if (!stopReason) {
        if (base.stopReason && base.stopReason !== "target-reached") stopReason = base.stopReason;
        else if (config.mode === "efficiency" && nativeFrames >= config.windowFrames) stopReason = totalExperienceGained > 0 ? "target-reached" : "no-training-evidence";
        else if (base.targetReached) stopReason = config.mode === "underlevel" &&
          (missingBosses.length || capViolations || losses) ? "underlevel-coverage-incomplete" : "target-reached";
      }
      if (stopReason && stopReason !== "target-reached") failure ??= base.failure ?? { reason: stopReason, frame, captureId: observation.captureId };
      return { ...base, target: config.mode === "underlevel" ? "underlevel-hall-of-fame" : "training-window",
        stopReason, targetReached: stopReason === "target-reached", failure,
        experiment: { config, qualificationEligible: false, nativeFrames, windowFrames: config.windowFrames ?? null,
          wallSeconds: (clock() - startedAt) / 1000, activityFrames: { ...activityFrames },
          totalExperienceGained, experiencePerNativeMinute: nativeFrames ? totalExperienceGained * FPS * 60 / nativeFrames : 0,
          members: [...members.values()].map(x => ({ ...x })), newMembers, battleCount, faintEvents, recoveryEvents,
          mapChanges, moneyDelta: initialMoney === null ? null : latestMoney - initialMoney,
          inventoryRemovals: { ...inventoryRemovals }, bosses: structuredClone(bosses),
          capViolations, losses, missingBosses, cleanCampaignSoFar: capViolations === 0 && losses === 0 } };
    },
  };
}
