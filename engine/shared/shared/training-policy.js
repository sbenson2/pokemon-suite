const KIND_PRIORITY = Object.freeze({ trainer: 0, rematch: 1, wild: 2 });

function safeCandidate(candidate) {
  return candidate && candidate.safe !== false && typeof candidate.id === "string";
}

function compareCandidates(left, right) {
  return Number(KIND_PRIORITY[left.kind] ?? 9) - Number(KIND_PRIORITY[right.kind] ?? 9) ||
    Number(right.experience ?? 0) - Number(left.experience ?? 0) ||
    Number(left.transitionsToBattle ?? Number.POSITIVE_INFINITY) -
      Number(right.transitionsToBattle ?? Number.POSITIVE_INFINITY) ||
    left.id.localeCompare(right.id);
}

function selected(candidate, reason, extra = {}) {
  return Object.freeze({ ...candidate, ...extra, reason });
}

export function selectTrainingCandidate({
  currentMap,
  candidates = [],
  stagingRadius = 2,
} = {}) {
  if (!Array.isArray(candidates)) throw new TypeError("training candidates must be an array");
  if (!Number.isSafeInteger(stagingRadius) || stagingRadius < 0) {
    throw new TypeError("staging radius must be a non-negative integer");
  }
  const safe = candidates.filter(safeCandidate);
  const responders = safe.filter(
    (candidate) => candidate.activeResponse === true && candidate.map === currentMap,
  ).sort(compareCandidates);
  if (responders.length > 0) {
    return selected(responders[0], "finish-active-rematch-batch", {
      responseBatchRemaining: responders.length,
    });
  }
  const forward = safe.filter((candidate) =>
    Number.isSafeInteger(candidate.transitionsToBattle) &&
    candidate.transitionsToBattle <= stagingRadius
  );
  const pool = forward.length > 0 ? forward : safe;
  pool.sort(compareCandidates);
  const candidate = pool[0];
  return candidate
    ? selected(candidate, forward.length > 0 ? "forward-boss-staging" : "best-safe-training")
    : null;
}
