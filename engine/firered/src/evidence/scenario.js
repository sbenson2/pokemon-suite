function assertSerializable(value, path = "predicate") {
  if (typeof value === "function" || typeof value === "symbol") {
    throw new TypeError(`${path} must be serializable data`);
  }
  if (!value || typeof value !== "object") return;
  for (const [key, child] of Object.entries(value)) {
    assertSerializable(child, `${path}.${key}`);
  }
}

export function matchesObservation(observation, expected) {
  assertSerializable(expected);
  function matches(actual, wanted) {
    if (Array.isArray(wanted)) {
      return (
        Array.isArray(actual) &&
        wanted.length === actual.length &&
        wanted.every((entry, index) => matches(actual[index], entry))
      );
    }
    if (wanted && typeof wanted === "object") {
      return (
        actual &&
        typeof actual === "object" &&
        Object.entries(wanted).every(([key, child]) =>
          matches(actual[key], child),
        )
      );
    }
    return Object.is(actual, wanted);
  }
  return matches(observation, expected);
}

function mapKey(observation) {
  const map = observation?.playerMemory?.map;
  if (!map) return "unknown";
  return map.id ?? `${map.group}:${map.number}`;
}

function interruptBetween(previous, current, stopWhen) {
  if (mapKey(previous) !== mapKey(current)) return "map-change";
  if (previous?.emulator?.mode !== current?.emulator?.mode) return "mode-change";
  if (
    previous?.emulator?.callback1 !== current?.emulator?.callback1 ||
    previous?.emulator?.callback2 !== current?.emulator?.callback2
  ) {
    return "callback-change";
  }
  if (current.phase === "transition") return "transition";
  if (current.phase === "unknown") return "unknown";
  if (stopWhen && matchesObservation(current, stopWhen)) return "postcondition";
  return null;
}

function buttonsAt(action, frameIndex) {
  if (action.sequence === undefined) {
    if (action.pulseEvery === undefined) return action.buttons ?? [];
    if (
      !Number.isSafeInteger(action.pulseEvery) ||
      action.pulseEvery <= 0
    ) {
      throw new TypeError("bounded action pulseEvery must be a positive integer");
    }
    return frameIndex % action.pulseEvery === 0 ? action.buttons ?? [] : [];
  }
  if (!Array.isArray(action.sequence) || action.sequence.length === 0) {
    throw new TypeError("bounded action sequence must be a non-empty array");
  }
  let remaining = frameIndex;
  for (const segment of action.sequence) {
    if (!Number.isSafeInteger(segment.frames) || segment.frames <= 0) {
      throw new TypeError("bounded action segment frames must be positive integers");
    }
    if (remaining < segment.frames) return segment.buttons ?? [];
    remaining -= segment.frames;
  }
  return [];
}

export function executeBoundedAction({
  session,
  observer,
  action,
  initialObservation,
}) {
  if (!Number.isSafeInteger(action?.maxFrames) || action.maxFrames <= 0) {
    throw new TypeError("bounded action maxFrames must be a positive integer");
  }
  let previous = initialObservation ?? observer.capture();
  const observations = [previous];
  for (let frameIndex = 0; frameIndex < action.maxFrames; frameIndex += 1) {
    session.step(buttonsAt(action, frameIndex));
    const current = observer.capture();
    observations.push(current);
    const cause = interruptBetween(previous, current, action.stopWhen);
    if (cause) {
      return {
        frames: frameIndex + 1,
        interrupt: { kind: "interrupt", cause, frame: current.frame },
        observation: current,
        observations,
      };
    }
    previous = current;
  }
  return {
    frames: action.maxFrames,
    interrupt: {
      kind: "interrupt",
      cause: "action-budget",
      frame: previous.frame,
    },
    observation: previous,
    observations,
  };
}

export class TransitionTimeoutError extends Error {
  constructor(maxFrames, observation) {
    super(`observation did not become stable within ${maxFrames} frames`);
    this.name = "TransitionTimeoutError";
    this.code = "TRANSITION_TIMEOUT";
    this.maxFrames = maxFrames;
    this.lastObservation = observation;
  }
}

export function resampleUntilStable({
  session,
  observer,
  initialObservation,
  maxFrames,
  consecutiveStable = 1,
}) {
  if (!Number.isSafeInteger(maxFrames) || maxFrames <= 0) {
    throw new TypeError("resample maxFrames must be a positive integer");
  }
  if (!Number.isSafeInteger(consecutiveStable) || consecutiveStable <= 0) {
    throw new TypeError("consecutiveStable must be a positive integer");
  }
  let current = initialObservation ?? observer.capture();
  const isReady = (observation) =>
    observation.phase === "stable" &&
    observation?.emulator?.inputReady !== false;
  let stable = isReady(current) ? 1 : 0;
  const observations = [current];
  if (stable >= consecutiveStable) {
    return { frames: 0, observation: current, observations };
  }

  for (let frames = 1; frames <= maxFrames; frames += 1) {
    session.step([]);
    current = observer.capture();
    observations.push(current);
    stable = isReady(current) ? stable + 1 : 0;
    if (stable >= consecutiveStable) {
      return { frames, observation: current, observations };
    }
  }
  throw new TransitionTimeoutError(maxFrames, current);
}

function assertCondition(observation, condition, label) {
  if (!matchesObservation(observation, condition ?? {})) {
    throw new Error(`${label} did not match the real-mGBA observation`);
  }
}

function compactObservation(observation) {
  return {
    frame: observation?.frame ?? null,
    phase: observation?.phase ?? null,
    phaseReasons: observation?.phaseReasons ?? [],
    emulator: {
      mode: observation?.emulator?.mode ?? null,
      callback1: observation?.emulator?.callback1 ?? null,
      callback2: observation?.emulator?.callback2 ?? null,
      inputReady: observation?.emulator?.inputReady ?? null,
      input: observation?.emulator?.input ?? null,
    },
    sram: {
      sha256: observation?.sram?.sha256 ?? null,
    },
    playerMemory: {
      map: observation?.playerMemory?.map ?? null,
      position: observation?.playerMemory?.position ?? null,
      avatar: observation?.playerMemory?.avatar ?? null,
      gameStats: observation?.playerMemory?.gameStats ?? null,
      trainer: observation?.playerMemory?.trainer ?? null,
      scripts: observation?.playerMemory?.scripts ?? null,
      activeTasks: observation?.playerMemory?.activeTasks ?? [],
      ui: observation?.playerMemory?.ui ?? null,
    },
  };
}

export class ScenarioStepError extends Error {
  constructor(message, context) {
    super(message);
    this.name = "ScenarioStepError";
    this.code = "SCENARIO_STEP_FAILED";
    this.context = context;
  }
}

export function executeScenario({ session, observer, scenario, seed }) {
  if (!scenario || typeof scenario.id !== "string" || scenario.id === "") {
    throw new TypeError("scenario id is required");
  }
  if (!(seed?.state instanceof Uint8Array)) {
    throw new TypeError("scenario seed needs whole-emulator state bytes");
  }
  if (seed.sram?.length > 0) session.loadSram(seed.sram);
  session.loadState(seed.state);
  observer.resetHistory?.();
  let current = observer.capture();
  assertCondition(current, scenario.precondition, `${scenario.id} precondition`);
  const initialObservation = current;

  const traceSteps = [];
  let interrupts = 0;
  for (const step of scenario.steps ?? []) {
    const actionResult = executeBoundedAction({
      session,
      observer,
      action: step.action,
      initialObservation: current,
    });
    interrupts += 1;
    const allowed = Array.isArray(step.expectedInterrupt)
      ? step.expectedInterrupt
      : [step.expectedInterrupt];
    if (
      step.expectedInterrupt !== undefined &&
      !allowed.includes(actionResult.interrupt.cause)
    ) {
      const observedTaskFunctions = [
        ...new Set(
          actionResult.observations.flatMap((observation) =>
            (observation?.playerMemory?.activeTasks ?? []).map(
              ({ function: name }) => name,
            ),
          ),
        ),
      ];
      throw new ScenarioStepError(
        `${scenario.id}/${step.id}: expected ${allowed.join(" or ")} interrupt, got ${actionResult.interrupt.cause}`,
        {
          scenarioId: scenario.id,
          stepId: step.id,
          stage: "interrupt",
          actionFrames: actionResult.frames,
          interrupt: actionResult.interrupt,
          observedTaskFunctions,
          initialObservation: compactObservation(current),
          finalObservation: compactObservation(actionResult.observation),
        },
      );
    }

    let settled;
    try {
      settled = resampleUntilStable({
        session,
        observer,
        initialObservation: actionResult.observation,
        maxFrames: step.settle?.maxFrames ?? scenario.settle?.maxFrames ?? 300,
        consecutiveStable:
          step.settle?.consecutiveStable ??
          scenario.settle?.consecutiveStable ??
          2,
      });
    } catch (error) {
      if (!(error instanceof TransitionTimeoutError)) throw error;
      throw new ScenarioStepError(
        `${scenario.id}/${step.id}: observation did not settle within ${error.maxFrames} frames`,
        {
          scenarioId: scenario.id,
          stepId: step.id,
          stage: "resample",
          actionFrames: actionResult.frames,
          interrupt: actionResult.interrupt,
          maxFrames: error.maxFrames,
          initialObservation: compactObservation(actionResult.observation),
          finalObservation: compactObservation(error.lastObservation),
        },
      );
    }
    current = settled.observation;
    if (!matchesObservation(current, step.postcondition ?? {})) {
      throw new ScenarioStepError(
        `${scenario.id}/${step.id} postcondition did not match the real-mGBA observation`,
        {
          scenarioId: scenario.id,
          stepId: step.id,
          stage: "postcondition",
          actionFrames: actionResult.frames,
          interrupt: actionResult.interrupt,
          resampleFrames: settled.frames,
          expectedPostcondition: structuredClone(step.postcondition ?? {}),
          finalObservation: compactObservation(current),
        },
      );
    }
    traceSteps.push({
      id: step.id,
      actionFrames: actionResult.frames,
      interrupt: actionResult.interrupt,
      resampleFrames: settled.frames,
      postObservation: current,
    });
  }

  let effects = null;
  if (scenario.effects !== undefined) {
    if (
      !scenario.effects ||
      typeof scenario.effects !== "object" ||
      Array.isArray(scenario.effects)
    ) {
      throw new TypeError(`${scenario.id}: effects must be an object`);
    }
    const integerEffects = new Set([
      "savedGameStatDelta",
      "moneyDelta",
      "totalPartyHpDelta",
      "usablePartyCountDelta",
      "partyCountDelta",
    ]);
    const booleanEffects = new Set([
      "sramChanged",
      "partyChanged",
      "bagChanged",
      "partyFullyHealed",
    ]);
    const allowedEffects = new Set([...integerEffects, ...booleanEffects]);
    const unsupported = Object.keys(scenario.effects).filter(
      (name) => !allowedEffects.has(name),
    );
    if (unsupported.length > 0) {
      throw new TypeError(
        `${scenario.id}: unsupported effect ${unsupported.join(", ")}`,
      );
    }
    for (const name of booleanEffects) {
      if (
        scenario.effects[name] !== undefined &&
        typeof scenario.effects[name] !== "boolean"
      ) {
        throw new TypeError(`${scenario.id}: ${name} must be boolean`);
      }
    }
    for (const name of integerEffects) {
      if (
        scenario.effects[name] !== undefined &&
        !Number.isSafeInteger(scenario.effects[name])
      ) {
        throw new TypeError(`${scenario.id}: ${name} must be a safe integer`);
      }
    }
    const initialSavedGame =
      initialObservation?.playerMemory?.gameStats?.savedGame;
    const finalSavedGame = current?.playerMemory?.gameStats?.savedGame;
    const initialTrainer = initialObservation?.playerMemory?.trainer;
    const finalTrainer = current?.playerMemory?.trainer;
    effects = {
      sramChanged:
        initialObservation?.sram?.sha256 !== current?.sram?.sha256,
      savedGameStatDelta:
        Number.isSafeInteger(initialSavedGame) &&
        Number.isSafeInteger(finalSavedGame)
          ? finalSavedGame - initialSavedGame
          : null,
      ...(initialTrainer && finalTrainer
        ? {
            moneyDelta:
              Number.isSafeInteger(initialTrainer.money) &&
              Number.isSafeInteger(finalTrainer.money)
                ? finalTrainer.money - initialTrainer.money
                : null,
            totalPartyHpDelta:
              finalTrainer.party.reduce((sum, pokemon) => sum + pokemon.hp, 0) -
              initialTrainer.party.reduce((sum, pokemon) => sum + pokemon.hp, 0),
            usablePartyCountDelta:
              finalTrainer.usablePartyCount - initialTrainer.usablePartyCount,
            partyCountDelta:
              finalTrainer.partyCount - initialTrainer.partyCount,
            partyChanged:
              JSON.stringify(initialTrainer.party) !==
              JSON.stringify(finalTrainer.party),
            bagChanged:
              JSON.stringify(initialTrainer.bag) !== JSON.stringify(finalTrainer.bag),
            partyFullyHealed:
              finalTrainer.party.length > 0 &&
              finalTrainer.party.every(
                ({ hp, maxHp }) => maxHp > 0 && hp === maxHp,
              ),
          }
        : {}),
    };
    if (!matchesObservation(effects, scenario.effects)) {
      throw new ScenarioStepError(
        `${scenario.id}: required effects did not match the real-mGBA observations`,
        {
          scenarioId: scenario.id,
          stage: "effects",
          expectedEffects: structuredClone(scenario.effects),
          observedEffects: effects,
          initialObservation: compactObservation(initialObservation),
          finalObservation: compactObservation(current),
        },
      );
    }
  }

  return {
    scenarioId: scenario.id,
    success: true,
    interrupts,
    seed: {
      stateSha256: seed.stateSha256,
      sramSha256: seed.sramSha256,
    },
    steps: traceSteps,
    finalObservation: current,
    ...(effects ? { effects } : {}),
  };
}

export function validateScenarioSuite({ transitions, suite }) {
  if (suite?.schema !== "master-red/mgba-scenario-suite/v1") {
    throw new Error("mGBA scenario suite schema is invalid");
  }
  const declared = transitions?.scenarios ?? [];
  const configured = suite?.scenarios ?? [];
  const declaredIds = declared.map(({ id }) => id);
  const configuredIds = configured.map(({ id }) => id);
  if (
    new Set(configuredIds).size !== configuredIds.length ||
    declaredIds.length !== configuredIds.length ||
    declaredIds.some((id) => !configuredIds.includes(id))
  ) {
    throw new Error("scenario suite must exactly cover declared transitions");
  }
  for (const definition of configured) {
    const requirement = declared.find(({ id }) => id === definition.id);
    if (
      !Number.isSafeInteger(definition.trials) ||
      definition.trials < requirement.minimumSuccessfulTraces
    ) {
      throw new Error(
        `${definition.id}: trials are below the declared minimum`,
      );
    }
    if (definition.variants !== undefined) {
      if (
        !Array.isArray(definition.variants) ||
        definition.variants.length !== definition.trials
      ) {
        throw new Error(
          `${definition.id}: variants must bind exactly one interaction to each trial`,
        );
      }
      const variantIds = definition.variants.map(({ id }) => id);
      if (
        variantIds.some((id) => typeof id !== "string" || id === "") ||
        new Set(variantIds).size !== variantIds.length
      ) {
        throw new Error(`${definition.id}: variant ids must be unique strings`);
      }
      if (
        definition.seed !== undefined ||
        definition.steps !== undefined ||
        definition.variants.some(
          (variant) =>
            !variant.seed ||
            !Array.isArray(variant.steps) ||
            variant.steps.length === 0,
        )
      ) {
        throw new Error(
          `${definition.id}: every variant needs its own seed and steps`,
        );
      }
    } else if (
      !definition.seed ||
      !Array.isArray(definition.steps) ||
      definition.steps.length === 0
    ) {
      throw new Error(`${definition.id}: seed and steps are required`);
    }
  }
  return suite;
}

export function selectDevelopmentScenario({
  transitions,
  suite,
  scenarioId,
  trials = 1,
}) {
  if (suite?.schema !== "master-red/mgba-scenario-suite/v1") {
    throw new Error("mGBA scenario suite schema is invalid");
  }
  if (typeof scenarioId !== "string" || scenarioId === "") {
    throw new TypeError("development scenario id is required");
  }
  if (!Number.isSafeInteger(trials) || trials <= 0) {
    throw new TypeError("development scenario trials must be a positive integer");
  }

  const declared = (transitions?.scenarios ?? []).filter(
    ({ id }) => id === scenarioId,
  );
  if (declared.length === 0) {
    throw new Error(`${scenarioId}: scenario is not declared in the modal corpus`);
  }
  if (declared.length !== 1) {
    throw new Error(`${scenarioId}: scenario is declared more than once`);
  }
  const configured = (suite.scenarios ?? []).filter(({ id }) => id === scenarioId);
  if (configured.length === 0) {
    throw new Error(`${scenarioId}: scenario is absent from the development suite`);
  }
  if (configured.length !== 1) {
    throw new Error(`${scenarioId}: scenario is configured more than once`);
  }
  const definition = configured[0];
  const legacyDefinition =
    definition.seed &&
    Array.isArray(definition.steps) &&
    definition.steps.length > 0;
  const variantDefinition =
    Array.isArray(definition.variants) &&
    definition.variants.length > 0 &&
    definition.variants.every(
      (variant) =>
        variant.seed &&
        Array.isArray(variant.steps) &&
        variant.steps.length > 0,
    );
  if (!legacyDefinition && !variantDefinition) {
    throw new Error(`${scenarioId}: seed and steps are required`);
  }
  if (
    !Number.isSafeInteger(declared[0].minimumSuccessfulTraces) ||
    declared[0].minimumSuccessfulTraces <= 0
  ) {
    throw new Error(`${scenarioId}: declared trace minimum is invalid`);
  }
  return {
    definition: { ...definition, trials },
    minimumSuccessfulTraces: declared[0].minimumSuccessfulTraces,
  };
}
