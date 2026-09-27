import { createHash } from "node:crypto";

const SHA256 = /^[0-9a-f]{64}$/;
const REQUIRED_OBSERVER_ARTIFACTS = [
  "firered-runtime-symbols",
  "firered-world-structure",
];

export const FIRE_RED_FLASH_BYTES = 128 * 1024;

function deepFreeze(value) {
  if (!value || typeof value !== "object" || Object.isFrozen(value)) return value;
  for (const child of Object.values(value)) deepFreeze(child);
  return Object.freeze(value);
}

function stage({
  id,
  buttons = [],
  until,
  untilAny,
  maxFrames,
  consecutiveMatches = 1,
  pulseEvery,
}) {
  return {
    id,
    buttons,
    ...(until === undefined ? {} : { until }),
    ...(untilAny === undefined ? {} : { untilAny }),
    maxFrames,
    consecutiveMatches,
    ...(pulseEvery === undefined ? {} : { pulseEvery }),
  };
}

const stableStockOverworld = {
  phase: "stable",
  emulator: { callback2: "CB2_Overworld", mode: "overworld" },
  playerMemory: { saveFileStatus: 1 },
};

export const STOCK_SAVE_BOOTSTRAP_PROGRAM = deepFreeze([
  stage({
    id: "wait-for-stock-save-loader",
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
    untilAny: [
      { emulator: { callback2: "CB2_SetUpOverworldForQLPlayback" } },
      stableStockOverworld,
    ],
    maxFrames: 480,
  }),
  stage({
    id: "settle-in-stock-overworld",
    buttons: ["b"],
    pulseEvery: 30,
    until: stableStockOverworld,
    maxFrames: 900,
    consecutiveMatches: 30,
  }),
]);

function sha256(bytes) {
  return createHash("sha256").update(bytes).digest("hex");
}

export function identifyStockSaveInputs(inputs) {
  if (!Array.isArray(inputs) || inputs.length === 0) {
    throw new TypeError("stock-save intake needs at least one explicit SRAM input");
  }
  const identified = new Map();
  for (const input of inputs) {
    if (typeof input?.label !== "string" || input.label === "") {
      throw new TypeError("stock-save input label is required");
    }
    if (!(input.sram instanceof Uint8Array)) {
      throw new TypeError(`${input.label}: SRAM must be a Uint8Array`);
    }
    if (input.sram.length !== FIRE_RED_FLASH_BYTES) {
      throw new Error(
        `${input.label}: source SRAM must contain exactly ${FIRE_RED_FLASH_BYTES} bytes`,
      );
    }
    const digest = sha256(input.sram);
    const existing = identified.get(digest);
    if (existing) {
      if (!existing.source.labels.includes(input.label)) {
        existing.source.labels.push(input.label);
      }
      continue;
    }
    identified.set(digest, {
      source: {
        labels: [input.label],
        bytes: input.sram.length,
        sha256: digest,
      },
      sram: input.sram.slice(),
    });
  }
  return [...identified.values()];
}

export function assertAcceptedStockSaveObservation(observation) {
  if (observation?.playerMemory?.saveFileStatus !== 1) {
    throw new Error("stock FireRed loader did not report SAVE_STATUS_OK");
  }
  if (
    observation?.phase !== "stable" ||
    observation?.emulator?.mode !== "overworld" ||
    observation?.emulator?.callback2 !== "CB2_Overworld"
  ) {
    throw new Error("accepted stock save did not settle in a stable overworld");
  }
  return observation;
}

function canonicalKnowledgeArtifacts(artifacts) {
  if (!Array.isArray(artifacts)) {
    throw new TypeError("stock-save catalog needs observer knowledge artifacts");
  }
  const byId = new Map(artifacts.map((artifact) => [artifact?.id, artifact]));
  if (
    byId.size !== REQUIRED_OBSERVER_ARTIFACTS.length ||
    REQUIRED_OBSERVER_ARTIFACTS.some((id) => !byId.has(id))
  ) {
    throw new TypeError("stock-save observer knowledge artifact set is incomplete");
  }
  return REQUIRED_OBSERVER_ARTIFACTS.map((id) => {
    const artifact = byId.get(id);
    if (
      !Number.isSafeInteger(artifact.bytes) ||
      artifact.bytes <= 0 ||
      !SHA256.test(artifact.sha256 ?? "")
    ) {
      throw new TypeError(`${id}: observer knowledge artifact identity is invalid`);
    }
    return { id, bytes: artifact.bytes, sha256: artifact.sha256 };
  });
}

function assertRecord(record) {
  const source = record?.source;
  const snapshot = record?.snapshot;
  if (
    source?.bytes !== FIRE_RED_FLASH_BYTES ||
    !SHA256.test(source?.sha256 ?? "") ||
    !Array.isArray(source?.labels) ||
    source.labels.length === 0
  ) {
    throw new TypeError("stock-save catalog source identity is invalid");
  }
  if (record.id !== `stock-save-${source.sha256.slice(0, 16)}`) {
    throw new TypeError("stock-save catalog id is not content-derived");
  }
  for (const [name, value] of [
    ["state", snapshot?.stateSha256],
    ["SRAM", snapshot?.sramSha256],
    ["observation", snapshot?.observationSha256],
  ]) {
    if (!SHA256.test(value ?? "")) {
      throw new TypeError(`stock-save snapshot ${name} digest is invalid`);
    }
  }
  if (snapshot.statePath !== `stock-save.${snapshot.stateSha256}.state`) {
    throw new TypeError("stock-save state path is not content-addressed");
  }
  if (snapshot.sramPath !== `stock-save.${snapshot.sramSha256}.sav`) {
    throw new TypeError("stock-save SRAM path is not content-addressed");
  }
  if (!Number.isSafeInteger(snapshot.frame) || snapshot.frame < 0) {
    throw new TypeError("stock-save snapshot frame is invalid");
  }
  if (!Array.isArray(record.bootstrap?.stages) || record.bootstrap.stages.length === 0) {
    throw new TypeError("stock-save bootstrap trace is missing");
  }
  assertAcceptedStockSaveObservation(snapshot.observation);
}

export function createStockSaveCatalog({
  runId,
  collectedAt,
  harnessRevision,
  identity,
  knowledgeArtifacts,
  records,
}) {
  if (typeof runId !== "string" || runId === "") {
    throw new TypeError("stock-save catalog runId is required");
  }
  if (!SHA256.test(harnessRevision ?? "")) {
    throw new TypeError("stock-save catalog harness revision is invalid");
  }
  if (!Array.isArray(records) || records.length === 0) {
    throw new TypeError("stock-save catalog needs at least one accepted record");
  }
  for (const record of records) assertRecord(record);
  const sourceHashes = records.map(({ source }) => source.sha256);
  if (new Set(sourceHashes).size !== sourceHashes.length) {
    throw new Error("stock-save catalog contains duplicate SRAM content");
  }
  return {
    schema: "master-red/stock-save-catalog/v1",
    evidenceClass: "real-mgba-private-intake",
    runId,
    collectedAt,
    harness: { kind: "source-bundle-sha256", revision: harnessRevision },
    identity: { ...identity },
    knowledgeArtifacts: canonicalKnowledgeArtifacts(knowledgeArtifacts),
    recipe: {
      id: "stock-save-continue/v1",
      program: STOCK_SAVE_BOOTSTRAP_PROGRAM,
    },
    entries: records.map((record) => structuredClone(record)),
  };
}
