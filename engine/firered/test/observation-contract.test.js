import assert from "node:assert/strict";
import test from "node:test";

import {
  assertAtomicObservation,
  routeObservation,
} from "../src/foundation.js";

function observation(overrides = {}) {
  return {
    captureId: "capture-42",
    frame: 42,
    phase: "stable",
    emulator: { captureId: "capture-42", frame: 42, mapId: 3 },
    sram: { captureId: "capture-42", frame: 42, badges: 0 },
    playerMemory: { captureId: "capture-42", frame: 42, x: 5, y: 7 },
    ...overrides,
  };
}

test("an observation is one atomic capture with no control ownership", () => {
  assert.doesNotThrow(() => assertAtomicObservation(observation()));

  assert.throws(
    () =>
      assertAtomicObservation(
        observation({
          sram: { captureId: "capture-42", frame: 41, badges: 0 },
        }),
      ),
    /atomic/i,
  );

  assert.throws(
    () => assertAtomicObservation(observation({ controllerOwner: "navigation" })),
    /control/i,
  );
});

test("transition and unknown observations request a recoverable resample", () => {
  assert.deepEqual(routeObservation(observation({ phase: "transition" })), {
    kind: "resample",
    reason: "transition",
  });
  assert.deepEqual(routeObservation(observation({ phase: "unknown" })), {
    kind: "resample",
    reason: "unknown",
  });
  assert.deepEqual(routeObservation(observation()), { kind: "advise" });
});
