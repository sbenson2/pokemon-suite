function delay(milliseconds) {
  return new Promise((resolve) => {
    if (milliseconds > 0) setTimeout(resolve, milliseconds);
    else setImmediate(resolve);
  });
}

export function createFramePacer(milliseconds, {
  clock = () => performance.now(),
  wait = delay,
  maximumLagMs = 250,
} = {}) {
  if (!Number.isFinite(milliseconds) || milliseconds < 0) {
    throw new TypeError("frame pace must be a finite non-negative number");
  }
  if (typeof clock !== "function" || typeof wait !== "function") {
    throw new TypeError("frame pacer clock and wait must be functions");
  }
  if (!Number.isFinite(maximumLagMs) || maximumLagMs <= 0) {
    throw new TypeError("frame pacer maximum lag must be positive");
  }
  if (milliseconds === 0) return () => wait(0);

  let deadline = clock();
  return async () => {
    deadline += milliseconds;
    const now = clock();
    const remaining = deadline - now;
    if (remaining > 0) {
      await wait(remaining);
    } else {
      if (-remaining > maximumLagMs) {
        // A suspended process or debugger pause should not trigger a long burst.
        // Ordinary observer/planner work stays on the original fixed deadline so
        // it counts toward, rather than being added on top of, emulated game time.
        deadline = now;
      }
      // When policy work consumes the frame budget, a zero-delay macrotask still
      // lets the fixed-rate framebuffer publisher and HTTP stream run.
      await wait(0);
    }
  };
}
