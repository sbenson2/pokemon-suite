import { actionPreconditionMatches } from "./action-precondition.js";

function copyBytes(bytes, label) {
  if (!(bytes instanceof Uint8Array)) {
    throw new TypeError(`${label} must be a Uint8Array`);
  }
  return bytes.slice();
}

const DECISION_FEED_SCHEMA = "master-red/decision-feed/v1";
const DEFAULT_DECISION_FEED_LIMIT = 80;
const MAX_DECISION_FEED_LIMIT = 200;

function objectRecord(value) {
  return value && typeof value === "object" && !Array.isArray(value) ? value : null;
}

function copyJsonRecord(value) {
  const source = objectRecord(value);
  return source ? JSON.parse(JSON.stringify(source)) : null;
}

function copyStringList(value, limit = 12) {
  return Array.isArray(value)
    ? value.slice(0, limit).map((entry) => String(entry).slice(0, 160))
    : [];
}

const DECISION_RECOMMENDATION_FIELDS = Object.freeze([
  "kind",
  "objective",
  "direction",
  "travelMode",
  "useRunningShoes",
  "targetMap",
  "targetX",
  "targetY",
  "targetObjectIndex",
  "targetTriggerIndex",
  "targetWarpIndex",
  "targetSpecies",
  "targetSpeciesId",
  "targetPartySlot",
  "targetMoveId",
  "targetMoveSlot",
  "targetCommand",
  "targetAction",
  "targetItem",
  "targetItemId",
  "targetIndex",
  "targetOption",
  "targetPocket",
  "targetQuantity",
  "itemId",
  "quantity",
  "choice",
  "remainingSteps",
]);

function compactRecommendation(value) {
  const source = objectRecord(value);
  if (!source) return null;
  const result = {};
  for (const key of DECISION_RECOMMENDATION_FIELDS) {
    const field = source[key];
    if (
      field === null ||
      typeof field === "string" ||
      typeof field === "number" ||
      typeof field === "boolean"
    ) {
      result[key] = typeof field === "string" ? field.slice(0, 200) : field;
    }
  }
  return result;
}

function compactWinner(value) {
  const source = objectRecord(value);
  if (!source) return null;
  const confidence = Number(source.confidence);
  return {
    advisor: typeof source.advisor === "string"
      ? source.advisor.slice(0, 120)
      : null,
    recommendation: compactRecommendation(source.recommendation),
    confidence: Number.isFinite(confidence) ? confidence : null,
    constraints: copyStringList(source.constraints),
    evidenceRefs: copyStringList(source.evidenceRefs),
  };
}

function decisionSequence(status) {
  const value = Number(status?.decision?.sequence);
  return Number.isSafeInteger(value) && value >= 0 ? value : null;
}

function decisionIntentKey(status) {
  const winner = objectRecord(status?.winner) ?? {};
  const recommendation = objectRecord(winner.recommendation) ?? {};
  const action = objectRecord(status?.action) ?? {};
  const decision = objectRecord(status?.decision) ?? {};
  const strategy = objectRecord(status?.spectator?.strategy) ?? {};
  const opponent = objectRecord(status?.spectator?.battle?.opponent) ?? {};
  return JSON.stringify({
    phase: status?.phase ?? null,
    mode: status?.mode ?? null,
    map: status?.map ?? null,
    campaign: strategy.activeStoryGoal ?? null,
    decision: [decision.kind ?? null, decision.reason ?? null],
    advisor: winner.advisor ?? null,
    recommendation: [
      recommendation.kind ?? null,
      recommendation.objective ?? null,
      recommendation.direction ?? null,
      recommendation.travelMode ?? null,
      recommendation.useRunningShoes ?? null,
      recommendation.targetMap ?? null,
      recommendation.targetX ?? null,
      recommendation.targetY ?? null,
      recommendation.targetObjectIndex ?? null,
      recommendation.targetTriggerIndex ?? null,
      recommendation.targetWarpIndex ?? null,
      recommendation.targetSpecies ?? recommendation.targetSpeciesId ?? null,
      recommendation.targetPartySlot ?? null,
      recommendation.targetMoveId ?? null,
      recommendation.targetMoveSlot ?? null,
      recommendation.targetCommand ?? null,
      recommendation.itemId ?? null,
      recommendation.quantity ?? null,
      recommendation.choice ?? null,
    ],
    action: [action.kind ?? null, action.reason ?? null],
    opponent: opponent.speciesName ?? opponent.name ?? opponent.species ?? null,
  });
}

function decisionFeedEntry(status, sequence) {
  const spectator = objectRecord(status.spectator) ?? {};
  const trainer = objectRecord(spectator.trainer) ?? {};
  const strategy = objectRecord(spectator.strategy) ?? {};
  const runId = typeof status.runId === "string" && status.runId ? status.runId : "run";
  return {
    _intentKey: decisionIntentKey(status),
    id: `${runId}:${sequence}`,
    firstSequence: sequence,
    lastSequence: sequence,
    repeats: 1,
    firstFrame: Number.isSafeInteger(Number(status.frame)) ? Number(status.frame) : null,
    lastFrame: Number.isSafeInteger(Number(status.frame)) ? Number(status.frame) : null,
    updatedAt: typeof status.updatedAt === "string" ? status.updatedAt : null,
    phase: typeof status.phase === "string" ? status.phase : null,
    mode: typeof status.mode === "string" ? status.mode : null,
    map: typeof status.map === "string" ? status.map : null,
    position: copyJsonRecord(status.position),
    playTime: copyJsonRecord(trainer.playTime),
    campaignId: typeof strategy.activeStoryGoal === "string"
      ? strategy.activeStoryGoal
      : null,
    decision: copyJsonRecord(status.decision),
    winner: compactWinner(status.winner),
    action: copyJsonRecord(status.action),
  };
}

function publicDecisionFeedEntry(entry) {
  const { _intentKey, ...published } = entry;
  return published;
}

export function createDecisionFeedBuffer({ limit = DEFAULT_DECISION_FEED_LIMIT } = {}) {
  const capacity = Number.isSafeInteger(limit) && limit > 0
    ? Math.min(limit, MAX_DECISION_FEED_LIMIT)
    : DEFAULT_DECISION_FEED_LIMIT;
  let runId = null;
  let lastSequence = null;
  let totalDecisions = 0;
  let droppedEntries = 0;
  let entries = [];

  const publish = (status) => ({
    ...status,
    decisionFeed: {
      schema: DECISION_FEED_SCHEMA,
      runId,
      capacity,
      totalDecisions,
      droppedEntries,
      entries: entries.map(publicDecisionFeedEntry),
    },
  });

  return Object.freeze({
    update(value) {
      const status = objectRecord(value) ?? {};
      const nextRunId = typeof status.runId === "string" && status.runId
        ? status.runId
        : null;
      if (nextRunId !== runId) {
        runId = nextRunId;
        lastSequence = null;
        totalDecisions = 0;
        droppedEntries = 0;
        entries = [];
      }
      const sequence = decisionSequence(status);
      if (sequence === null || (lastSequence !== null && sequence <= lastSequence)) {
        return publish(status);
      }
      lastSequence = sequence;
      totalDecisions += 1;
      const entry = decisionFeedEntry(status, sequence);
      const previous = entries.at(-1);
      if (previous?._intentKey === entry._intentKey) {
        entries[entries.length - 1] = {
          ...entry,
          id: previous.id,
          firstSequence: previous.firstSequence,
          firstFrame: previous.firstFrame,
          repeats: previous.repeats + 1,
        };
      } else {
        entries.push(entry);
        if (entries.length > capacity) {
          entries = entries.slice(-capacity);
          droppedEntries += 1;
        }
      }
      return publish(status);
    },
  });
}

function captureSnapshot(session, observer) {
  const frame = session.frame;
  const observation = observer.capture();
  const state = copyBytes(session.saveState(), "emulator state");
  const sram = copyBytes(session.saveSram(), "cartridge SRAM");
  const sourceVideo = session.videoFrame();
  const video = {
    width: sourceVideo?.width,
    height: sourceVideo?.height,
    rgba: copyBytes(sourceVideo?.rgba, "framebuffer"),
  };
  if (session.frame !== frame || observation?.frame !== frame) {
    throw new Error("autonomous emulator snapshot crossed a frame boundary");
  }
  return { frame, state, sram, video, observation };
}

export function createLiveViewBindings({ emulator, getStatus = () => ({}), viewOnly = false } = {}) {
  if (!emulator || typeof emulator.controlState !== "function") {
    throw new TypeError("Agent TV bindings require the autonomous emulator owner");
  }
  if (typeof getStatus !== "function") {
    throw new TypeError("Agent TV bindings require a status reader");
  }
  return Object.freeze({
    frameSource: emulator,
    control: viewOnly ? null : emulator,
    getStatus: () => ({
      ...getStatus(),
      control: viewOnly ? { ...emulator.controlState(), viewOnly: true } : emulator.controlState(),
    }),
  });
}

export function createEmulatorRequestHandler({
  emulator,
  observer,
  session,
  setStatus = () => {},
  close = async () => {},
} = {}) {
  if (!emulator || typeof emulator.execute !== "function" ||
      typeof emulator.metrics !== "function") {
    throw new TypeError("worker request handler requires an autonomous emulator");
  }
  if (!observer || typeof observer.capture !== "function") {
    throw new TypeError("worker request handler requires an atomic observer");
  }
  if (!session || typeof session.saveState !== "function" ||
      typeof session.saveSram !== "function" ||
      typeof session.videoFrame !== "function") {
    throw new TypeError("worker request handler requires emulator snapshot access");
  }

  return async (method, value = null) => {
    switch (method) {
      case "observe":
        return observer.capture();
      case "execute":
        if (value?.precondition && !actionPreconditionMatches(value.precondition, observer.capture(), value)) {
          emulator.cancel?.("stale-observation");
          return { interrupted: "stale-observation", startFrame: session.frame, endFrame: session.frame };
        }
        return emulator.execute(value);
      case "pause":
        return emulator.pause(value ?? "safety-stop");
      case "cancel":
        return emulator.cancel(value ?? "cancelled");
      case "captureSnapshot":
        return captureSnapshot(session, observer);
      case "metrics":
        return emulator.metrics();
      case "controlState":
        if (typeof emulator.controlState !== "function") {
          throw new Error("autonomous emulator does not expose control state");
        }
        return emulator.controlState();
      case "takeControlHandoff": {
        if (typeof emulator.takeControlHandoff !== "function") {
          throw new Error("autonomous emulator does not expose control handoffs");
        }
        const handoff = emulator.takeControlHandoff();
        return handoff
          ? { ...handoff, observation: observer.capture() }
          : null;
      }
      case "setStatus":
        setStatus(value);
        return null;
      case "close":
        await close();
        return null;
      default:
        throw new Error(`unknown autonomous emulator method: ${method}`);
    }
  };
}
