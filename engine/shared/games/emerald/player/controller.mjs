// Frame-exact input programs. The controller is the only button writer: it
// runs one bounded program at a time (a press edge, a held walk lease, or a
// certified route) and reports how the program ended so the delegator can
// decide from a fresh observation. Durations are cartridge frames.
const EMPTY = Object.freeze([]);

function samePosition(a, b) { return a && b && a.x === b.x && a.y === b.y; }
function sameMap(a, b) { return a && b && a.group === b.group && a.number === b.number; }

export function pressProgram(button, { hold = 2, release = 4, reason = 'press' } = {}) {
  let frame = 0;
  return Object.freeze({
    kind: 'press', button, reason,
    next() {
      frame += 1;
      if (frame <= hold) return { buttons: Object.freeze([button]), done: false };
      if (frame < hold + release) return { buttons: EMPTY, done: false };
      return { buttons: EMPTY, done: true, result: { status: 'pressed', button } };
    },
  });
}

export function neutralProgram(frames, reason = 'neutral') {
  let frame = 0;
  return Object.freeze({ kind: 'neutral', reason, next() { frame += 1; return { buttons: EMPTY, done: frame >= frames, result: { status: 'waited' } }; } });
}

/** Holds a direction until the tile is reached, the walker is blocked, or the field changes. */
export function walkProgram(direction, { target = null, maxFrames = 600, stallFrames = 40, reason = 'walk', turnOnly = false } = {}) {
  let frame = 0;
  let stalled = 0;
  let last = null;
  let startMap = null;
  return Object.freeze({
    kind: 'walk', direction, target, reason,
    next(tick) {
      frame += 1;
      if (startMap === null) startMap = tick.map;
      if (tick.inBattle) return { buttons: EMPTY, done: true, result: { status: 'battle' } };
      if (!sameMap(tick.map, startMap)) return { buttons: EMPTY, done: true, result: { status: 'map-changed' } };
      if (tick.scriptRunning || tick.fieldControlsLocked) return { buttons: EMPTY, done: true, result: { status: 'interrupted' } };
      if (turnOnly && frame > 6) return { buttons: EMPTY, done: true, result: { status: 'turned' } };
      // SaveBlock1.pos updates when a step begins, so release as soon as the
      // target reads back and finish once the tile transition settles.
      if (target && samePosition(tick.position, target)) return { buttons: EMPTY, done: tick.tileTransitionState === 0, result: { status: 'arrived' } };
      if (last && samePosition(tick.position, last) && tick.tileTransitionState === 0) stalled += 1; else stalled = 0;
      last = tick.position;
      if (stalled >= stallFrames) return { buttons: EMPTY, done: true, result: { status: 'blocked', position: tick.position } };
      if (frame >= maxFrames) return { buttons: EMPTY, done: true, result: { status: 'timeout', position: tick.position } };
      return { buttons: Object.freeze([direction]), done: false };
    },
  });
}

/** Executes a certified route as one lease: direction changes at exact waypoints. */
export function routeProgram(segments, { reason = 'route', stallFrames = 40, frameBudget = null } = {}) {
  let index = 0;
  let frame = 0;
  let stalled = 0;
  let last = null;
  let startMap = null;
  const budget = frameBudget ?? Math.max(240, segments.reduce((sum, segment) => sum + segment.steps, 0) * 40);
  return Object.freeze({
    kind: 'route', segments, reason,
    next(tick) {
      frame += 1;
      if (startMap === null) startMap = tick.map;
      if (tick.inBattle) return { buttons: EMPTY, done: true, result: { status: 'battle', segment: index } };
      if (!sameMap(tick.map, startMap)) return { buttons: EMPTY, done: true, result: { status: 'map-changed', segment: index } };
      if (tick.scriptRunning || tick.fieldControlsLocked) return { buttons: EMPTY, done: true, result: { status: 'interrupted', segment: index } };
      while (index < segments.length && samePosition(tick.position, segments[index].to)) {
        index += 1;
        stalled = 0;
      }
      if (index >= segments.length) {
        // Position reads the final waypoint at step start: release now and
        // report arrival once the tile transition has settled.
        return { buttons: EMPTY, done: tick.tileTransitionState === 0, result: { status: 'arrived', position: tick.position } };
      }
      if (last && samePosition(tick.position, last) && tick.tileTransitionState === 0) stalled += 1; else stalled = 0;
      last = tick.position;
      if (stalled >= stallFrames) return { buttons: EMPTY, done: true, result: { status: 'blocked', position: tick.position, segment: index } };
      if (frame >= budget) return { buttons: EMPTY, done: true, result: { status: 'timeout', position: tick.position, segment: index } };
      return { buttons: Object.freeze([segments[index].direction]), done: false };
    },
  });
}

export function sequenceProgram(programs, reason = 'sequence') {
  let index = 0;
  const results = [];
  return Object.freeze({
    kind: 'sequence', reason,
    next(tick) {
      if (index >= programs.length) return { buttons: EMPTY, done: true, result: { status: 'complete', results } };
      const step = programs[index].next(tick);
      if (step.done) { results.push(step.result); index += 1; }
      if (index >= programs.length) return { buttons: step.buttons ?? EMPTY, done: true, result: { status: 'complete', results } };
      return { buttons: step.buttons ?? EMPTY, done: false };
    },
  });
}

export function createController() {
  let program = null;
  let lastResult = null;
  let executedFrames = 0;
  return Object.freeze({
    get idle() { return program === null; },
    get program() { return program; },
    get lastResult() { return lastResult; },
    get executedFrames() { return executedFrames; },
    start(next) { program = next; executedFrames = 0; },
    cancel(reason = 'cancelled') { if (program) lastResult = { status: reason }; program = null; },
    tick(observation) {
      if (!program) return EMPTY;
      executedFrames += 1;
      const step = program.next(observation);
      if (step.done) { lastResult = { ...step.result, program: program.kind, reason: program.reason }; program = null; }
      return step.buttons ?? EMPTY;
    },
  });
}
