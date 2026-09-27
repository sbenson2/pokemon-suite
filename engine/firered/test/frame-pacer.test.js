import assert from "node:assert/strict";
import test from "node:test";

import { createFramePacer } from "../src/player/frame-pacer.js";

function fakeTime() {
  let now = 0;
  const waits = [];
  return {
    clock: () => now,
    advance(milliseconds) {
      now += milliseconds;
    },
    async wait(milliseconds) {
      waits.push(milliseconds);
      now += milliseconds;
    },
    get now() {
      return now;
    },
    waits,
  };
}

test("the frame clock catches up after ordinary policy work", async () => {
  const time = fakeTime();
  const pace = createFramePacer(10, {
    clock: time.clock,
    wait: time.wait.bind(time),
    maximumLagMs: 250,
  });

  await pace();
  assert.equal(time.now, 10);

  // Observing and rectifying policy advice consumes wall time between frames.
  // That work is part of the 5x frame budget, not extra delay to add afterward.
  time.advance(80);
  for (let frame = 0; frame < 9; frame += 1) await pace();

  assert.equal(time.now, 100);
  assert.deepEqual(time.waits, [10, 0, 0, 0, 0, 0, 0, 0, 0, 10]);
});

test("the frame clock resynchronizes after a genuine wall-clock stall", async () => {
  const time = fakeTime();
  const pace = createFramePacer(10, {
    clock: time.clock,
    wait: time.wait.bind(time),
    maximumLagMs: 250,
  });

  await pace();
  time.advance(1000);
  await pace();
  await pace();

  assert.equal(time.now, 1020);
  assert.deepEqual(time.waits, [10, 0, 10]);
});

test("an unpaced frame still yields one event-loop turn to live viewers", async () => {
  const time = fakeTime();
  const pace = createFramePacer(0, {
    clock: time.clock,
    wait: time.wait.bind(time),
  });

  await pace();

  assert.deepEqual(time.waits, [0]);
});
