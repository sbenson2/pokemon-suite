const RUN_ATTEMPT_SCHEMA = "master-red/run-attempt/v3";
const PREVIOUS_RUN_ATTEMPT_SCHEMA = "master-red/run-attempt/v2";
const DEFAULT_PRIMARY_TARGET_SECONDS = 30 * 60 * 60;
const DEFAULT_STRETCH_TARGET_SECONDS = 24 * 60 * 60;

function positiveInteger(value, fallback) {
  const number = Number(value);
  return Number.isSafeInteger(number) && number > 0 ? number : fallback;
}

function nonNegativeInteger(value) {
  if (value === null || value === undefined || value === "") return null;
  const number = Number(value);
  return Number.isSafeInteger(number) && number >= 0 ? number : null;
}

function playTimeSeconds(playTime) {
  if (!playTime || typeof playTime !== "object") return null;
  const hours = nonNegativeInteger(playTime.hours);
  const minutes = nonNegativeInteger(playTime.minutes);
  const seconds = nonNegativeInteger(playTime.seconds);
  if (
    hours === null || minutes === null || seconds === null ||
    minutes > 59 || seconds > 59
  ) return null;
  const total = hours * 60 * 60 + minutes * 60 + seconds;
  return Number.isSafeInteger(total) ? total : null;
}

export function createRunAttemptTimer({
  restoredState = null,
  targetSeconds = DEFAULT_PRIMARY_TARGET_SECONDS,
  primaryTargetSeconds = targetSeconds,
  stretchTargetSeconds = DEFAULT_STRETCH_TARGET_SECONDS,
} = {}) {
  const restored = restoredState?.schema === RUN_ATTEMPT_SCHEMA
    ? restoredState
    : null;
  const previous = restoredState?.schema === PREVIOUS_RUN_ATTEMPT_SCHEMA
    ? restoredState
    : null;
  const durationSeconds = positiveInteger(
    restored?.primaryTargetSeconds ?? restored?.targetSeconds,
    positiveInteger(primaryTargetSeconds, DEFAULT_PRIMARY_TARGET_SECONDS),
  );
  const stretchDurationSeconds = positiveInteger(
    restored?.stretchTargetSeconds ?? previous?.targetSeconds,
    positiveInteger(stretchTargetSeconds, DEFAULT_STRETCH_TARGET_SECONDS),
  );
  let observedPlayTimeSeconds = nonNegativeInteger(
    restored?.observedPlayTimeSeconds ?? previous?.observedPlayTimeSeconds,
  );
  let completedPlayTimeSeconds = nonNegativeInteger(
    restored?.completedPlayTimeSeconds ?? previous?.completedPlayTimeSeconds,
  );
  if (completedPlayTimeSeconds !== null) {
    observedPlayTimeSeconds = completedPlayTimeSeconds;
  }

  function state() {
    return Object.freeze({
      schema: RUN_ATTEMPT_SCHEMA,
      clock: "cartridge-play-time",
      targetSeconds: durationSeconds,
      primaryTargetSeconds: durationSeconds,
      stretchTargetSeconds: stretchDurationSeconds,
      observedPlayTimeSeconds,
      completedPlayTimeSeconds,
    });
  }

  function snapshot({ playTime = null, complete = false } = {}) {
    if (completedPlayTimeSeconds === null) {
      const measuredSeconds = playTimeSeconds(playTime);
      if (measuredSeconds !== null) {
        observedPlayTimeSeconds = Math.max(
          observedPlayTimeSeconds ?? 0,
          measuredSeconds,
        );
      }
      if (complete && observedPlayTimeSeconds !== null) {
        completedPlayTimeSeconds = observedPlayTimeSeconds;
      }
    }
    const elapsedSeconds = completedPlayTimeSeconds ?? observedPlayTimeSeconds;
    const withinTarget = completedPlayTimeSeconds === null
      ? null
      : completedPlayTimeSeconds <= durationSeconds;
    const withinStretchTarget = completedPlayTimeSeconds === null
      ? null
      : completedPlayTimeSeconds <= stretchDurationSeconds;
    return Object.freeze({
      ...state(),
      elapsedSeconds,
      remainingSeconds: elapsedSeconds === null
        ? durationSeconds
        : Math.max(0, durationSeconds - elapsedSeconds),
      stretchRemainingSeconds: elapsedSeconds === null
        ? stretchDurationSeconds
        : Math.max(0, stretchDurationSeconds - elapsedSeconds),
      expired: elapsedSeconds === null ? false : elapsedSeconds > durationSeconds,
      stretchExpired: elapsedSeconds === null
        ? false
        : elapsedSeconds > stretchDurationSeconds,
      withinTarget,
      withinStretchTarget,
    });
  }

  return Object.freeze({ snapshot, state });
}
