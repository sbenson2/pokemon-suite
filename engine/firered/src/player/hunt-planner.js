import { campaignNavigationRecommendation, campaignRegionTransitionDistances, selectRecoveryObjective } from "./campaign.js";
import { knownCaptureFreeSlots } from "./encounter-safety.js";
import { dataOf } from "./mechanics-data.js";

export function createHuntPlanner({ world, story = null, mechanics, config, initialState = null, storyWatch = {} } = {}) {
  const data = dataOf(world);
  const encounters = (data.wildEncounters ?? []).find((entry) => entry.map === config.area && /_FireRed$/.test(entry.base_label));
  const species = Object.values(dataOf(mechanics).species ?? {});
  const available = new Set((encounters?.land_mons?.mons ?? []).map((mon) =>
    species.find((entry) => entry.name === mon.species)?.id).filter(Number.isSafeInteger));
  if (!available.size) throw new Error("hunting area has no supported, source-backed land encounter table");
  for (const target of config.targets) {
    if (target.required.species && !target.required.species.some((id) => available.has(id))) {
      throw new Error("required target species unavailable in this hunting area");
    }
  }
  const state = initialState ? structuredClone(initialState) : {
    schema: "master-red/hunt-planner/v1", firstFrame: null, lastProgressFrame: null, progress: null,
  };
  if (state.schema !== "master-red/hunt-planner/v1") throw new TypeError("incompatible hunting planner checkpoint");
  const hunt = Object.freeze({ id: `hunt:${config.area}`, target: { kind: "encounter-zone", map: config.area } });
  let latest = null;
  let selected = hunt;
  let failure = null;
  const blocked = (reason) => ({ kind: "blocked", reason });
  const distanceTo = (observation, target) => campaignRegionTransitionDistances({ world, observation, target,
    origins: [{ map: observation.playerMemory?.map?.id, position: observation.playerMemory?.position }] })[0];
  const localHealer = (observation) => {
    const healer = selectRecoveryObjective({ world, story, observation });
    if (!healer) return null;
    const distance = distanceTo(observation, healer.target);
    return Number.isInteger(distance) && distance <= config.resources.freeHealerRange ? healer : null;
  };
  const evaluate = (observation) => {
    if (latest === observation) return failure;
    latest = observation; selected = hunt; failure = null;
    const fail = (reason) => (failure = blocked(reason));
    state.firstFrame ??= observation.frame;
    state.lastProgressFrame ??= observation.frame;
    if (observation.frame < state.firstFrame) return fail("hunt-unexpected-restore");
    if (observation.frame - state.firstFrame >= config.limits.maxFrames) return fail("hunt-frame-budget");
    const memory = observation.playerMemory ?? {};
    const trainer = memory.trainer;
    const progress = JSON.stringify([memory.map?.id, memory.position, trainer?.party?.map((p) => [p.hp, p.status1, p.pp]),
      memory.encounter?.pokemon?.personality, observation.emulator?.inBattle, memory.battle?.turn,
      memory.battle?.runAttempts, memory.ui]);
    if (progress !== state.progress) { state.progress = progress; state.lastProgressFrame = observation.frame; }
    if (observation.frame - state.lastProgressFrame >= config.limits.maxIdleFrames) return fail("hunt-no-progress-timeout");
    if (observation.emulator?.inBattle || observation.phase !== "stable") return null;
    if (trainer?.partyValidity !== "valid" || !trainer.party?.length) return fail("hunt-party-unreadable");
    const free = knownCaptureFreeSlots(trainer);
    if (free === null || free < config.resources.minFreeSlots) return fail("hunt-storage-full-or-unknown");
    const balls = (trainer.bag?.pokeBalls ?? []).filter((ball) => ball.itemId >= 2 && ball.itemId <= 12 && ball.itemId !== 5)
      .reduce((sum, ball) => sum + ball.quantity, 0);
    if (!Number.isFinite(balls) || balls < config.resources.minBalls) return fail("hunt-balls-below-reserve");
    const healthy = trainer.party.filter((member) => member.hp > 0 && member.maxHp > 0 &&
      member.hp / member.maxHp >= config.resources.minHealthFraction && !member.status1 && member.pp?.some((pp) => pp > 0));
    if (healthy.length < config.resources.minHealthyMembers || !healthy.includes(trainer.party[0])) {
      selected = localHealer(observation);
      if (!selected) return fail("hunt-free-healer-out-of-reach");
    }
    if (!campaignNavigationRecommendation({ world, observation, objective: selected }) &&
        !memory.ui?.fieldDialog && !memory.ui?.choiceMenu) return fail("hunt-route-unavailable");
    return null;
  };
  return Object.freeze({
    safetyCheck: evaluate,
    select(observation) { evaluate(observation); return selected; },
    selectRecovery: localHealer,
    selectTraining: () => null,
    selectCollection: () => null,
    selectBattleSquad: () => [],
    storyWatch: () => storyWatch,
    state: () => structuredClone(state),
    campaignStatus: () => ({ activeStoryGoal: selected?.id ?? null, strategy: "hunt" }),
    collectionProgress: () => null,
  });
}
