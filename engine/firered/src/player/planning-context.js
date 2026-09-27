// Advisors consume the same atomic observation. Share its expensive strategic
// reads, including null results, without reusing a plan across fresh captures.
export function createObservationPlanner(planner) {
  let observations = new WeakMap();
  const selections = new Set(["select", "selectCollection", "selectTraining", "selectRecovery", "selectBattleSquad"]);
  const shared = Object.fromEntries(Object.entries(planner).map(([name, method]) => {
    if (typeof method !== "function") return [name, method];
    if (!selections.has(name)) return [name, (...args) => {
      if (name.startsWith("observe")) observations = new WeakMap();
      return method.apply(planner, args);
    }];
    return [name, (observation, ...args) => {
      let context = observations.get(observation);
      if (!context) {
        context = new Map();
        observations.set(observation, context);
      }
      const key = JSON.stringify([name, ...args]);
      const readArgs = name === "selectTraining"
        ? [args[0], { ...args[1], commit: false }]
        : args;
      if (!context.has(key)) context.set(key, method.call(planner, observation, ...readArgs));
      return context.get(key);
    }];
  }));
  return Object.freeze({ ...shared,
    observeDecision(observation, decision) {
      const recovery = [...(observations.get(observation) ?? [])]
        .find(([key]) => JSON.parse(key)[0] === "selectRecovery")?.[1] ?? null;
      planner.observeRecoveryDecision?.(observation, decision, recovery);
      if (decision?.kind !== "act") return;
      const winner = decision.winner;
      const recommendation = winner?.recommendation;
      const candidates = [...(observations.get(observation) ?? [])]
        .filter(([key, value]) => JSON.parse(key)[0] === "selectTraining" && value &&
          (value.id === recommendation?.objective ||
            (recommendation?.objective?.startsWith("fly-to-") &&
              winner.evidenceRefs?.includes(`campaign:objective:${value.id}`) &&
              winner.evidenceRefs?.includes(`cartridge:trainer:${value.trainer?.id}`))))
        .map(([, value]) => value);
      const selected = candidates.find((candidate) =>
        winner.evidenceRefs?.includes(`cartridge:trainer:${candidate.trainer?.id}`)
      ) ?? (candidates.length === 1 ? candidates[0] : null);
      if (selected) planner.commitTrainingSelection?.(selected,observation);
    },
  });
}
