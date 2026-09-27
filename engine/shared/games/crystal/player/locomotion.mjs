// Bounded controller edges for the Crystal player.
//
// Every edge is a generator that yields the exact button array for one
// cartridge frame at a time. The caller (the paced runtime or a synchronous
// test driver) steps the emulator with each yielded value, so edge durations
// are cartridge frames and stay exact at any presentation speed. Edges observe
// read-only memory between frames and stop at the first cartridge-proven
// boundary: a coordinate change, a map change, a script, or a battle.

import { DIRECTIONS } from '../world/grid.mjs';
import { textboxOpen } from './dialog.mjs';

export class LocomotionError extends Error {
  constructor(message) {
    super(message);
    this.name = 'LocomotionError';
  }
}

export function* holdFrames(buttons, frames) {
  for (let index = 0; index < frames; index += 1) yield buttons;
}

/** A press is a held edge followed by a neutral release so hJoyPressed fires once. */
export function* press(button, { hold = 8, release = 6 } = {}) {
  yield* holdFrames([button], hold);
  yield* holdFrames([], release);
  return { button, hold, release };
}

export function* waitFrames(frames) {
  yield* holdFrames([], frames);
}

/**
 * Yields neutral (or `each`-provided) frames until `predicate(observation)`
 * holds. Returns the satisfying observation, or throws after `budget` frames.
 */
export function* waitUntil(observe, predicate, { budget = 600, each = null, label = 'condition' } = {}) {
  for (let waited = 0; waited < budget; waited += 1) {
    const observation = observe();
    if (predicate(observation)) return observation;
    yield each ? each(waited, observation) : [];
  }
  throw new LocomotionError(`${label} did not hold within ${budget} frames`);
}

const sameTile = (a, b) => a.map.group === b.map.group && a.map.number === b.map.number && a.map.x === b.map.x && a.map.y === b.map.y;
const sameMap = (a, b) => a.map.group === b.map.group && a.map.number === b.map.number;

/**
 * Holds one direction and counts cartridge-proven tile transitions. Stops after
 * `steps` transitions, or earlier on a map change, script, battle, or when no
 * transition happens within `blockedFrames`. Returns a structured result.
 */
export function* walkSegment(observe, direction, steps, { blockedFrames = 48, settleFrames = 18, maximumFrames = 20_000, scriptBoundaryFrames = 16 } = {}) {
  if (!DIRECTIONS[direction]) throw new LocomotionError(`unknown direction ${direction}`);
  if (!Number.isSafeInteger(steps) || steps < 1) throw new LocomotionError('walkSegment requires a positive step count');
  const start = observe();
  let last = start;
  let completed = 0;
  let stationary = 0;
  let frames = 0;
  let reason = 'steps';
  let scriptFrames = 0;
  while (completed < steps) {
    if (frames >= maximumFrames) { reason = 'frame-budget'; break; }
    const current = observe();
    if (current.battle) { reason = 'battle'; last = current; break; }
    // Scene scripts flag wScriptRunning for a frame or two on every step and
    // turning runs ChangeDirectionScript for about eight frames; only a script
    // that persists (text, menus, forced movement) is a boundary.
    scriptFrames = current.scriptRunning || textboxOpen(current) ? scriptFrames + 1 : 0;
    if (scriptFrames >= scriptBoundaryFrames) { reason = 'script'; last = current; break; }
    if (!sameMap(current, last)) { reason = 'map-changed'; last = current; completed += 1; break; }
    if (!sameTile(current, last)) {
      // Only movement along the held direction is a step of this segment; a
      // scripted displacement (walking out of a door after a warp, a scene
      // moving the player) ends it so the caller re-plans from where it stands.
      const vector = DIRECTIONS[direction];
      if (Math.sign(current.map.x - last.map.x) !== vector.dx || Math.sign(current.map.y - last.map.y) !== vector.dy) { reason = 'displaced'; last = current; break; }
      completed += 1;
      stationary = 0;
      last = current;
      if (completed >= steps) break;
    } else {
      stationary += 1;
      if (stationary >= blockedFrames) { reason = 'blocked'; break; }
    }
    yield [direction];
    frames += 1;
  }
  yield* holdFrames([], settleFrames);
  const final = observe();
  return Object.freeze({
    direction,
    requestedSteps: steps,
    completedSteps: completed,
    reason,
    frames,
    from: { group: start.map.group, number: start.map.number, x: start.map.x, y: start.map.y },
    to: { group: final.map.group, number: final.map.number, x: final.map.x, y: final.map.y },
    observation: final,
  });
}

/** Faces a direction without moving: a short tap that turns the player. */
export function* face(direction) {
  yield* holdFrames([direction], 2);
  yield* holdFrames([], 10);
}

/**
 * Synchronous driver used by tests and gates: steps the session with each
 * yielded button array and returns the generator's return value.
 */
export function drive(session, generator, { maximumFrames = 60_000 } = {}) {
  let frames = 0;
  let next = generator.next();
  while (!next.done) {
    if (frames >= maximumFrames) throw new LocomotionError(`edge exceeded ${maximumFrames} frames`);
    session.step(next.value ?? []);
    frames += 1;
    next = generator.next();
  }
  return next.value;
}
