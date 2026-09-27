const defaultSchedule = (callback, milliseconds) => setTimeout(callback, milliseconds);
const defaultCancel = (handle) => clearTimeout(handle);

export function createEmulationRunner({
  session,
  emulatedFramesPerSecond,
  getButtons = () => [],
  clock = () => performance.now(),
  schedule = defaultSchedule,
  cancel = defaultCancel,
  maximumBatchFrames = 120,
} = {}) {
  if (!session || typeof session.step !== "function") {
    throw new TypeError("emulation runner requires a session");
  }
  if (!Number.isFinite(emulatedFramesPerSecond) || emulatedFramesPerSecond <= 0) {
    throw new TypeError("emulatedFramesPerSecond must be positive");
  }
  if (typeof getButtons !== "function") throw new TypeError("getButtons must be a function");
  if (typeof clock !== "function" || typeof schedule !== "function" || typeof cancel !== "function") {
    throw new TypeError("emulation runner clock and scheduler functions are required");
  }
  if (!Number.isSafeInteger(maximumBatchFrames) || maximumBatchFrames <= 0) {
    throw new TypeError("maximumBatchFrames must be a positive integer");
  }

  let running = false;
  let scheduled = null;
  let startedAt = 0;
  let emulatedFrames = 0;
  let catchUpLimitedBatches = 0;

  const metrics = () => Object.freeze({
    running,
    emulatedFrames,
    emulatedFramesPerSecond,
    catchUpLimitedBatches,
  });

  const queue = () => {
    if (running && scheduled === null) {
      const nextFrameAt = startedAt + (emulatedFrames + 1) * 1000 / emulatedFramesPerSecond;
      const delay = Math.max(0, nextFrameAt - Number(clock()));
      scheduled = schedule(tick, delay);
      scheduled?.unref?.();
    }
  };

  const tick = () => {
    scheduled = null;
    if (!running) return;
    try {
      const elapsedMilliseconds = Math.max(0, Number(clock()) - startedAt);
      const targetFrames = Math.floor(elapsedMilliseconds * emulatedFramesPerSecond / 1000);
      const due = Math.max(0, targetFrames - emulatedFrames);
      const batch = Math.min(due, maximumBatchFrames);
      if (due > maximumBatchFrames) catchUpLimitedBatches += 1;
      for (let index = 0; index < batch; index += 1) {
        const buttons = getButtons({
          frame: Number.isSafeInteger(session.frame) ? session.frame : emulatedFrames,
          emulatedFrames,
        });
        if (!Array.isArray(buttons) || buttons.some((button) => typeof button !== "string")) {
          throw new TypeError("input provider must return a button array");
        }
        session.step(buttons);
        emulatedFrames += 1;
      }
      queue();
    } catch (error) {
      running = false;
      throw error;
    }
  };

  return Object.freeze({
    start() {
      if (running) return metrics();
      running = true;
      startedAt = Number(clock());
      emulatedFrames = 0;
      catchUpLimitedBatches = 0;
      queue();
      return metrics();
    },
    stop() {
      if (!running && scheduled === null) return metrics();
      running = false;
      if (scheduled !== null) cancel(scheduled);
      scheduled = null;
      return metrics();
    },
    metrics,
  });
}
