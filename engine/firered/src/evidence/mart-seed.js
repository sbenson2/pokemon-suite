import { matchesObservation } from "./scenario.js";

const SHA256 = /^[0-9a-f]{64}$/;

function deepFreeze(value) {
  if (!value || typeof value !== "object" || Object.isFrozen(value)) return value;
  for (const child of Object.values(value)) deepFreeze(child);
  return Object.freeze(value);
}

function stage({
  id,
  buttons = [],
  until,
  maxFrames,
  consecutiveMatches = 1,
  pulseEvery,
}) {
  return {
    id,
    buttons,
    until,
    maxFrames,
    consecutiveMatches,
    ...(pulseEvery === undefined ? {} : { pulseEvery }),
  };
}

function stableAt(map, x, y) {
  return {
    phase: "stable",
    emulator: { callback2: "CB2_Overworld", mode: "overworld" },
    playerMemory: { map: { id: map }, position: { x, y } },
  };
}

const movement = [
  stage({
    id: "drive-east-through-gym",
    buttons: ["right"],
    until: { playerMemory: { map: { id: "MAP_VIRIDIAN_CITY_GYM" }, position: { x: 17, y: 17 } } },
    maxFrames: 240,
  }),
  stage({
    id: "settle-east-through-gym",
    until: stableAt("MAP_VIRIDIAN_CITY_GYM", 17, 17),
    maxFrames: 120,
    consecutiveMatches: 3,
  }),
  stage({
    id: "drive-out-of-gym",
    buttons: ["down"],
    until: { playerMemory: { map: { id: "MAP_VIRIDIAN_CITY" } } },
    maxFrames: 240,
  }),
  stage({
    id: "settle-outside-gym",
    until: stableAt("MAP_VIRIDIAN_CITY", 36, 11),
    maxFrames: 180,
    consecutiveMatches: 3,
  }),
  stage({
    id: "drive-east-of-gym",
    buttons: ["right"],
    until: { playerMemory: { position: { x: 41, y: 11 } } },
    maxFrames: 180,
  }),
  stage({
    id: "settle-east-of-gym",
    until: stableAt("MAP_VIRIDIAN_CITY", 41, 11),
    maxFrames: 120,
    consecutiveMatches: 3,
  }),
  stage({
    id: "drive-north-of-gym",
    buttons: ["up"],
    until: { playerMemory: { position: { x: 41, y: 6 } } },
    maxFrames: 180,
  }),
  stage({
    id: "settle-north-of-gym",
    until: stableAt("MAP_VIRIDIAN_CITY", 41, 6),
    maxFrames: 120,
    consecutiveMatches: 3,
  }),
  stage({
    id: "drive-west-above-gym",
    buttons: ["left"],
    until: { playerMemory: { position: { x: 22, y: 6 } } },
    maxFrames: 420,
  }),
  stage({
    id: "settle-west-above-gym",
    until: stableAt("MAP_VIRIDIAN_CITY", 22, 6),
    maxFrames: 120,
    consecutiveMatches: 3,
  }),
  stage({
    id: "drive-south-to-mart-road",
    buttons: ["down"],
    until: { playerMemory: { position: { x: 22, y: 20 } } },
    maxFrames: 320,
  }),
  stage({
    id: "settle-south-to-mart-road",
    until: stableAt("MAP_VIRIDIAN_CITY", 22, 20),
    maxFrames: 120,
    consecutiveMatches: 3,
  }),
  stage({
    id: "drive-east-to-mart",
    buttons: ["right"],
    until: { playerMemory: { position: { x: 36, y: 20 } } },
    maxFrames: 320,
  }),
  stage({
    id: "settle-at-mart-exterior",
    until: {
      ...stableAt("MAP_VIRIDIAN_CITY", 36, 20),
      playerMemory: {
        ...stableAt("MAP_VIRIDIAN_CITY", 36, 20).playerMemory,
        saveFileStatus: 1,
      },
    },
    maxFrames: 120,
    consecutiveMatches: 3,
  }),
];

export const VIRIDIAN_MART_BOOTSTRAP_PROGRAM = deepFreeze([
  stage({
    id: "wait-for-title",
    until: {
      phase: "stable",
      emulator: { callback2: "CB2_TitleScreenRun" },
      playerMemory: { saveFileStatus: 1 },
    },
    maxFrames: 1800,
    consecutiveMatches: 60,
  }),
  stage({
    id: "open-main-menu",
    buttons: ["start"],
    pulseEvery: 90,
    until: { emulator: { callback2: "CB2_InitMainMenu" } },
    maxFrames: 450,
  }),
  stage({
    id: "wait-for-main-menu",
    until: { phase: "stable", emulator: { callback2: "CB2_MainMenu" } },
    maxFrames: 240,
    consecutiveMatches: 60,
  }),
  stage({
    id: "continue-valid-save",
    buttons: ["a"],
    pulseEvery: 90,
    until: { emulator: { callback2: "CB2_SetUpOverworldForQLPlayback" } },
    maxFrames: 240,
  }),
  stage({
    id: "cancel-quest-log-playback",
    buttons: ["b"],
    pulseEvery: 30,
    until: {
      ...stableAt("MAP_VIRIDIAN_CITY_GYM", 11, 17),
      playerMemory: {
        ...stableAt("MAP_VIRIDIAN_CITY_GYM", 11, 17).playerMemory,
        saveFileStatus: 1,
      },
    },
    maxFrames: 480,
    consecutiveMatches: 30,
  }),
  ...movement,
]);

export class SeedStageTimeoutError extends Error {
  constructor(stageId, maxFrames, lastObservation) {
    super(`seed stage ${stageId} exceeded its ${maxFrames}-frame budget`);
    this.name = "SeedStageTimeoutError";
    this.code = "SEED_STAGE_TIMEOUT";
    this.stageId = stageId;
    this.maxFrames = maxFrames;
    this.lastObservation = lastObservation;
  }
}

function assertStage(value) {
  if (!value || typeof value.id !== "string" || value.id === "") {
    throw new TypeError("seed stage id is required");
  }
  if (!Array.isArray(value.buttons)) {
    throw new TypeError(`${value.id}: seed stage buttons must be an array`);
  }
  if (!Number.isSafeInteger(value.maxFrames) || value.maxFrames <= 0) {
    throw new TypeError(`${value.id}: maxFrames must be a positive integer`);
  }
  if (
    !Number.isSafeInteger(value.consecutiveMatches) ||
    value.consecutiveMatches <= 0
  ) {
    throw new TypeError(`${value.id}: consecutiveMatches must be positive`);
  }
  if (
    value.pulseEvery !== undefined &&
    (!Number.isSafeInteger(value.pulseEvery) || value.pulseEvery <= 0)
  ) {
    throw new TypeError(`${value.id}: pulseEvery must be a positive integer`);
  }
  const hasUntil = value.until !== undefined;
  const hasUntilAny = value.untilAny !== undefined;
  if (hasUntil === hasUntilAny) {
    throw new TypeError(`${value.id}: exactly one of until or untilAny is required`);
  }
  const alternatives = hasUntilAny ? value.untilAny : [value.until];
  if (!Array.isArray(alternatives) || alternatives.length === 0) {
    throw new TypeError(`${value.id}: untilAny must contain at least one predicate`);
  }
  for (const predicate of alternatives) matchesObservation({}, predicate);
}

function stageMatches(observation, definition) {
  const alternatives = definition.untilAny ?? [definition.until];
  return alternatives.some((predicate) =>
    matchesObservation(observation, predicate),
  );
}

export function executeSeedProgram({ session, observer, program }) {
  if (!Array.isArray(program) || program.length === 0) {
    throw new TypeError("seed program must contain at least one stage");
  }
  const trace = [];
  let finalObservation = null;
  for (const rawDefinition of program) {
    const definition = {
      buttons: [],
      consecutiveMatches: 1,
      ...rawDefinition,
    };
    assertStage(definition);
    if (
      definition.consecutiveMatches === 1 &&
      finalObservation &&
      stageMatches(finalObservation, definition)
    ) {
      trace.push({
        id: definition.id,
        frames: 0,
        input: {
          buttons: [...definition.buttons],
          pulseEvery: definition.pulseEvery ?? null,
        },
        consecutiveMatches: definition.consecutiveMatches,
        endObservation: finalObservation,
      });
      continue;
    }
    let consecutive = 0;
    let lastObservation = null;
    let complete = false;
    for (let index = 0; index < definition.maxFrames; index += 1) {
      const pulse =
        definition.pulseEvery === undefined ||
        index % definition.pulseEvery === 0;
      session.step(pulse ? definition.buttons : []);
      lastObservation = observer.capture();
      consecutive = stageMatches(lastObservation, definition)
        ? consecutive + 1
        : 0;
      if (consecutive >= definition.consecutiveMatches) {
        trace.push({
          id: definition.id,
          frames: index + 1,
          input: {
            buttons: [...definition.buttons],
            pulseEvery: definition.pulseEvery ?? null,
          },
          consecutiveMatches: definition.consecutiveMatches,
          endObservation: lastObservation,
        });
        finalObservation = lastObservation;
        complete = true;
        break;
      }
    }
    if (!complete) {
      throw new SeedStageTimeoutError(
        definition.id,
        definition.maxFrames,
        lastObservation,
      );
    }
  }
  return { stages: trace, finalObservation };
}

function assertSeedFile(name, label) {
  if (
    typeof name !== "string" ||
    name === "" ||
    name.includes("/") ||
    name.includes("\\")
  ) {
    throw new TypeError(`${label} must be a relative seed filename`);
  }
}

export function createMartScenarioSuite({
  stateFile,
  sramFile,
  stateSha256,
  sramSha256,
  provenance,
}) {
  assertSeedFile(stateFile, "stateFile");
  assertSeedFile(sramFile, "sramFile");
  if (!SHA256.test(stateSha256 ?? "") || !SHA256.test(sramSha256 ?? "")) {
    throw new TypeError("Mart seed digests must be SHA-256 values");
  }
  if (
    provenance?.kind !== "real-mgba-input-bootstrap" ||
    provenance.recipe !== "viridian-mart-exterior/v1" ||
    !SHA256.test(provenance.traceSha256 ?? "")
  ) {
    throw new TypeError("Mart seed provenance is incomplete");
  }

  return {
    schema: "master-red/mgba-scenario-suite/v1",
    scenarios: [
      {
        id: "mart-entry-roundtrip",
        trials: 100,
        seed: {
          statePath: stateFile,
          sramPath: sramFile,
          stateSha256,
          sramSha256,
          provenance: { ...provenance },
        },
        precondition: {
          ...stableAt("MAP_VIRIDIAN_CITY", 36, 20),
          playerMemory: {
            ...stableAt("MAP_VIRIDIAN_CITY", 36, 20).playerMemory,
            saveFileStatus: 1,
          },
        },
        steps: [
          {
            id: "enter",
            action: { buttons: ["up"], maxFrames: 120 },
            expectedInterrupt: ["transition", "map-change", "callback-change"],
            postcondition: stableAt("MAP_VIRIDIAN_CITY_MART", 4, 7),
          },
          {
            id: "leave",
            action: { buttons: ["down"], maxFrames: 120 },
            expectedInterrupt: ["transition", "map-change", "callback-change"],
            postcondition: stableAt("MAP_VIRIDIAN_CITY", 36, 20),
          },
        ],
        settle: { maxFrames: 360, consecutiveStable: 3 },
      },
    ],
  };
}
