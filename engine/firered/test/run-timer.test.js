import assert from "node:assert/strict";
import test from "node:test";

async function loadRunTimerModule() {
  try {
    return await import("../src/player/run-timer.js");
  } catch (error) {
    if (error?.code === "ERR_MODULE_NOT_FOUND") return {};
    throw error;
  }
}

test("the 30-hour attempt clock measures Trainer Card time and tracks the 24-hour stretch", async () => {
  const { createRunAttemptTimer } = await loadRunTimerModule();
  assert.equal(typeof createRunAttemptTimer, "function");
  const firstProcess = createRunAttemptTimer();

  assert.deepEqual(firstProcess.snapshot({
    playTime: { hours: 1, minutes: 2, seconds: 3, vblanks: 17 },
  }), {
    schema: "master-red/run-attempt/v3",
    clock: "cartridge-play-time",
    targetSeconds: 108_000,
    primaryTargetSeconds: 108_000,
    stretchTargetSeconds: 86_400,
    observedPlayTimeSeconds: 3_723,
    completedPlayTimeSeconds: null,
    elapsedSeconds: 3_723,
    remainingSeconds: 104_277,
    stretchRemainingSeconds: 82_677,
    expired: false,
    stretchExpired: false,
    withinTarget: null,
    withinStretchTarget: null,
  });

  const resumedProcess = createRunAttemptTimer({
    restoredState: firstProcess.state(),
  });
  assert.equal(resumedProcess.snapshot({
    playTime: { hours: 1, minutes: 3, seconds: 3, vblanks: 2 },
  }).elapsedSeconds, 3_783);
});

test("the attempt clock freezes Hall of Fame cartridge time and records both results", async () => {
  const { createRunAttemptTimer } = await loadRunTimerModule();
  assert.equal(typeof createRunAttemptTimer, "function");
  const timer = createRunAttemptTimer();

  const complete = timer.snapshot({
    playTime: { hours: 23, minutes: 59, seconds: 59, vblanks: 59 },
    complete: true,
  });
  assert.equal(complete.elapsedSeconds, 86_399);
  assert.equal(complete.completedPlayTimeSeconds, 86_399);
  assert.equal(complete.withinTarget, true);
  assert.equal(complete.withinStretchTarget, true);

  assert.deepEqual(timer.snapshot({
    playTime: { hours: 24, minutes: 0, seconds: 9, vblanks: 0 },
  }), complete);
  assert.equal(
    timer.state().completedPlayTimeSeconds,
    complete.completedPlayTimeSeconds,
  );
});

test("a legacy wall-clock checkpoint cannot replace the cartridge clock", async () => {
  const { createRunAttemptTimer } = await loadRunTimerModule();
  const timer = createRunAttemptTimer({
    restoredState: {
      schema: "master-red/run-attempt/v1",
      startedAt: "2026-09-02T20:00:00.000Z",
      targetSeconds: 86_400,
      completedAt: null,
    },
  });

  const snapshot = timer.snapshot({
    playTime: { hours: 5, minutes: 0, seconds: 0, vblanks: 0 },
  });
  assert.equal(snapshot.schema, "master-red/run-attempt/v3");
  assert.equal(snapshot.elapsedSeconds, 18_000);
});

test("a v2 24-hour checkpoint migrates to the 30-hour primary and preserves 24 hours as stretch", async () => {
  const { createRunAttemptTimer } = await loadRunTimerModule();
  const timer = createRunAttemptTimer({
    restoredState: {
      schema: "master-red/run-attempt/v2",
      clock: "cartridge-play-time",
      targetSeconds: 86_400,
      observedPlayTimeSeconds: 90_000,
      completedPlayTimeSeconds: null,
    },
  });

  const snapshot = timer.snapshot();
  assert.equal(snapshot.primaryTargetSeconds, 108_000);
  assert.equal(snapshot.stretchTargetSeconds, 86_400);
  assert.equal(snapshot.expired, false);
  assert.equal(snapshot.stretchExpired, true);
});
