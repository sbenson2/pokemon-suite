function cloneAndFreeze(value) {
  if (value === undefined) return undefined;
  const copy = structuredClone(value);
  const freeze = (entry) => {
    if (entry && typeof entry === "object" && !Object.isFrozen(entry)) {
      for (const child of Object.values(entry)) freeze(child);
      Object.freeze(entry);
    }
    return entry;
  };
  return freeze(copy);
}

function canonical(value) {
  if (Array.isArray(value)) return value.map(canonical);
  if (value && typeof value === "object") {
    return Object.fromEntries(
      Object.keys(value).sort().map((key) => [key, canonical(value[key])]),
    );
  }
  return value;
}

export function createDecisionLog({
  maximumEntries = 200,
  clock = Date.now,
} = {}) {
  if (!Number.isSafeInteger(maximumEntries) || maximumEntries <= 0 || maximumEntries > 10_000) {
    throw new TypeError("maximumEntries must be an integer from 1 through 10000");
  }
  if (typeof clock !== "function") throw new TypeError("decision log clock must be a function");

  let totalDecisions = 0;
  let collapsedDuplicates = 0;
  const entries = [];
  let lastKey = null;

  const snapshot = () => Object.freeze({
    schema: "pokemon-research/decision-feed/v1",
    totalDecisions,
    collapsedDuplicates,
    entries: Object.freeze([...entries]),
  });

  return Object.freeze({
    append({ kind, reason, detail } = {}) {
      if (typeof kind !== "string" || !kind || typeof reason !== "string" || !reason) {
        throw new TypeError("decision log entries require kind and reason strings");
      }
      const safeDetail = cloneAndFreeze(detail);
      const key = JSON.stringify(canonical({ kind, reason, detail: safeDetail }));
      const at = Number(clock());
      if (!Number.isFinite(at)) throw new TypeError("decision log clock returned a non-finite value");
      totalDecisions += 1;
      if (entries.length && key === lastKey) {
        const previous = entries.at(-1);
        entries[entries.length - 1] = Object.freeze({
          ...previous,
          count: previous.count + 1,
          lastAt: at,
        });
        collapsedDuplicates += 1;
        return entries.at(-1);
      }
      const entry = Object.freeze({
        sequence: totalDecisions,
        kind,
        reason,
        ...(safeDetail === undefined ? {} : { detail: safeDetail }),
        count: 1,
        firstAt: at,
        lastAt: at,
      });
      entries.push(entry);
      if (entries.length > maximumEntries) entries.splice(0, entries.length - maximumEntries);
      lastKey = key;
      return entry;
    },
    snapshot,
  });
}

function record(value) {
  return value && typeof value === "object" && !Array.isArray(value) ? value : null;
}

function copyRecord(value) {
  const source = record(value);
  return source ? structuredClone(source) : null;
}

function controllerIntentKey(status) {
  const winner = record(status.winner) ?? {};
  const recommendation = record(winner.recommendation) ?? {};
  const action = record(status.action) ?? {};
  const decision = record(status.decision) ?? {};
  const strategy = record(status.spectator?.strategy) ?? {};
  const opponent = record(status.spectator?.battle?.opponent) ?? {};
  return JSON.stringify(canonical({
    phase: status.phase ?? null,
    mode: status.mode ?? null,
    map: status.map ?? null,
    campaign: strategy.activeStoryGoal ?? null,
    decision: [decision.kind ?? null, decision.reason ?? null],
    advisor: winner.advisor ?? null,
    recommendation,
    action: [action.kind ?? null, action.reason ?? null],
    opponent: opponent.speciesName ?? opponent.name ?? opponent.species ?? null,
  }));
}

function feedEntry(status, sequence) {
  const spectator = record(status.spectator) ?? {};
  const trainer = record(spectator.trainer) ?? {};
  const strategy = record(spectator.strategy) ?? {};
  const runId = typeof status.runId === "string" && status.runId ? status.runId : "run";
  const frame = Number(status.frame);
  return {
    _intentKey: controllerIntentKey(status),
    id: `${runId}:${sequence}`,
    firstSequence: sequence,
    lastSequence: sequence,
    repeats: 1,
    firstFrame: Number.isSafeInteger(frame) ? frame : null,
    lastFrame: Number.isSafeInteger(frame) ? frame : null,
    updatedAt: typeof status.updatedAt === "string" ? status.updatedAt : null,
    phase: typeof status.phase === "string" ? status.phase : null,
    mode: typeof status.mode === "string" ? status.mode : null,
    map: typeof status.map === "string" ? status.map : null,
    position: copyRecord(status.position),
    playTime: copyRecord(trainer.playTime),
    campaignId: typeof strategy.activeStoryGoal === "string"
      ? strategy.activeStoryGoal
      : null,
    decision: copyRecord(status.decision),
    winner: copyRecord(status.winner),
    action: copyRecord(status.action),
  };
}

function publicEntry(entry) {
  const { _intentKey, ...value } = entry;
  return value;
}

export function createDecisionFeedBuffer({ limit = 80 } = {}) {
  const capacity = Number.isSafeInteger(limit) && limit > 0
    ? Math.min(limit, 200)
    : 80;
  let runId = null;
  let lastSequence = null;
  let totalDecisions = 0;
  let droppedEntries = 0;
  let entries = [];

  const publish = (status) => ({
    ...status,
    decisionFeed: {
      schema: "pokemon-research/decision-feed/v1",
      runId,
      capacity,
      totalDecisions,
      droppedEntries,
      entries: entries.map(publicEntry),
    },
  });

  return Object.freeze({
    update(value) {
      const status = record(value) ?? {};
      const nextRunId = typeof status.runId === "string" && status.runId
        ? status.runId
        : null;
      if (runId !== nextRunId) {
        runId = nextRunId;
        lastSequence = null;
        totalDecisions = 0;
        droppedEntries = 0;
        entries = [];
      }
      const sequence = Number(status.decision?.sequence);
      if (
        !Number.isSafeInteger(sequence) || sequence < 0 ||
        (lastSequence !== null && sequence <= lastSequence)
      ) return publish(status);

      lastSequence = sequence;
      totalDecisions += 1;
      const entry = feedEntry(status, sequence);
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
