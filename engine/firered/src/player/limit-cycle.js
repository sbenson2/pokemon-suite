const SCHEMA = 'master-red/limit-cycle/v1';
const VECTORS = Object.freeze({
  north: Object.freeze([0, -1]), south: Object.freeze([0, 1]),
  west: Object.freeze([-1, 0]), east: Object.freeze([1, 0]),
});
const OPPOSITE = Object.freeze({ north: 'south', south: 'north', west: 'east', east: 'west' });
// Only forced-movement terrain is eligible: ordinary ground is allowed to
// revisit a small tile set while searching, interacting or waiting for a moving
// NPC, and excluding those tiles would derail a legitimate route.
const FORCED_MOVEMENT_BEHAVIORS = Object.freeze(new Set([
  'MB_CYCLING_ROAD_PULL_DOWN', 'MB_CYCLING_ROAD_PULL_DOWN_GRASS',
]));
const fieldReady = (observation) => observation?.phase === 'stable' &&
  observation.emulator?.mode === 'overworld' && !observation.emulator.inBattle &&
  !Object.values(observation.playerMemory?.ui ?? {}).some(Boolean) &&
  !observation.playerMemory?.questLog?.playback;
const positionOf = (observation) => {
  const map = observation?.playerMemory?.map?.id;
  const position = observation?.playerMemory?.position;
  return typeof map === 'string' && map !== '' &&
    Number.isSafeInteger(position?.x) && Number.isSafeInteger(position?.y)
    ? { map, x: position.x, y: position.y }
    : null;
};
const forcedMovementAt = (observation, at) => {
  const cell = (observation?.playerMemory?.mapGrid?.cells ?? []).find(({ x, y }) =>
    Number(x) === at.x && Number(y) === at.y);
  return FORCED_MOVEMENT_BEHAVIORS.has(cell?.behaviorName);
};

// A forced-movement pull can carry the character away from a one-tile approach
// lease and flip the direction of travel without ever failing a single move.
// Record settled field positions; when the same tiny tile set repeats with
// opposite directions on one map, emit bounded tile exclusions so routing can
// choose a different approach (or a different target) instead of retrying until
// the safety deadline latches. Detection is deterministic; no timers are read.
export function createLimitCycleDetector(initialState = null, {
  windowSize = 48,
  minimumSamples = 14,
  maximumTiles = 4,
  minimumReversals = 3,
  maximumExclusions = 32,
} = {}) {
  if (initialState !== null) {
    if (initialState.schema !== SCHEMA || !Array.isArray(initialState.samples) ||
        !Array.isArray(initialState.exclusions) ||
        initialState.samples.length > windowSize ||
        initialState.exclusions.length > maximumExclusions * 2 ||
        initialState.samples.some((sample) =>
          !Number.isSafeInteger(sample?.x) || !Number.isSafeInteger(sample?.y) ||
          !Number.isSafeInteger(sample?.frame) ||
          !(sample?.direction === null || Object.hasOwn(VECTORS, sample?.direction)) ||
          typeof sample?.forced !== 'boolean') ||
        initialState.exclusions.some((entry) =>
          typeof entry?.map !== 'string' || entry.map === '' ||
          !Number.isSafeInteger(entry?.x) || !Number.isSafeInteger(entry?.y))) {
      throw new TypeError('invalid limit cycle state');
    }
  }
  let samples = structuredClone(initialState?.samples ?? []);
  let exclusions = structuredClone(initialState?.exclusions ?? []);
  let map = initialState?.map ?? samples.at(-1)?.map ?? null;
  if (map !== null && (typeof map !== 'string' || map === '')) throw new TypeError('invalid limit cycle map');

  const record = () => {
    const tiles = [];
    for (const sample of samples) {
      if (!tiles.some(({ x, y }) => x === sample.x && y === sample.y)) {
        tiles.push({ map, x: sample.x, y: sample.y });
      }
    }
    for (const tile of tiles) {
      if (!exclusions.some((entry) =>
        entry.map === tile.map && entry.x === tile.x && entry.y === tile.y)) {
        exclusions.push(tile);
      }
    }
    exclusions = exclusions.slice(-maximumExclusions);
    samples = [];
  };
  const cycling = () => {
    if (samples.length < minimumSamples) return false;
    if (!samples.some((sample) => sample.forced === true)) return false;
    const unique = new Set(samples.map((sample) => `${sample.x},${sample.y}`));
    if (unique.size > maximumTiles) return false;
    let reversals = 0;
    let previous = null;
    for (const sample of samples) {
      if (sample.direction === null) continue;
      if (previous !== null && sample.direction === OPPOSITE[previous]) reversals += 1;
      previous = sample.direction;
    }
    return reversals >= minimumReversals;
  };
  const enriched = (observation) => {
    const at = positionOf(observation);
    const available = exclusions.filter((entry) => entry.map === at?.map);
    if (!available.length) return observation;
    const existing = observation.navigationExclusions?.tiles ?? [];
    const tiles = [...existing];
    for (const entry of available) {
      if (!tiles.some(({ x, y }) => x === entry.x && y === entry.y)) {
        tiles.push({ x: entry.x, y: entry.y });
      }
    }
    if (tiles.length === existing.length) return observation;
    return Object.freeze({
      ...observation,
      navigationExclusions: Object.freeze({
        transitions: observation.navigationExclusions?.transitions ?? [],
        interactions: observation.navigationExclusions?.interactions ?? [],
        tiles,
      }),
    });
  };

  return Object.freeze({
    observe(observation) {
      if (!fieldReady(observation)) return observation;
      const at = positionOf(observation);
      if (!at) return observation;
      if (at.map !== map) {
        map = at.map;
        samples = [];
      }
      const previous = samples.at(-1) ?? null;
      const delta = previous ? [at.x - previous.x, at.y - previous.y] : null;
      const direction = delta && Math.abs(delta[0]) + Math.abs(delta[1]) === 1
        ? Object.keys(VECTORS).find((name) =>
            VECTORS[name][0] === delta[0] && VECTORS[name][1] === delta[1]) ?? null
        : null;
      samples.push({ x: at.x, y: at.y, frame: observation.frame, direction,
        forced: forcedMovementAt(observation, at) });
      if (samples.length > windowSize) samples = samples.slice(-windowSize);
      if (cycling()) record();
      return enriched(observation);
    },
    reset() { samples = []; exclusions = []; map = null; },
    state() { return { schema: SCHEMA, map, samples: structuredClone(samples), exclusions: structuredClone(exclusions) }; },
  });
}
