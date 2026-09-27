const VECTORS = { north: [0, -1], south: [0, 1], west: [-1, 0], east: [1, 0] };
const INTERACTION_KINDS = new Set(['interact-with-object', 'interact-with-background', 'use-field-move']);
const fieldReady = o => o?.phase === 'stable' && o.emulator?.mode === 'overworld' &&
  !o.emulator.inBattle && !Object.values(o.playerMemory?.ui ?? {}).some(Boolean) &&
  !o.playerMemory?.questLog?.playback;
const interactionSurface = o => JSON.stringify({
  map: o.playerMemory?.map, position: o.playerMemory?.position,
  story: o.playerMemory?.storyState, bag: o.playerMemory?.trainer?.bag,
  objects: o.playerMemory?.objectEvents?.map(e => [e.localId, e.current, e.elevation, e.invisible]),
});
// Only objects touching the failed edge invalidate it; a distant wandering NPC
// must not repeatedly reopen a genuinely blocked route.
const edgeObjects = (memory, entry) => {
  if (!Array.isArray(memory?.objectEvents)) return null;
  const [dx, dy] = VECTORS[entry.direction];
  return JSON.stringify(memory.objectEvents.filter(e => !e.invisible &&
    ((e.current?.x === entry.x && e.current?.y === entry.y) ||
     (e.current?.x === entry.x + dx && e.current?.y === entry.y + dy)))
    .map(e => [e.localId, e.current, e.elevation]).sort((a,b) => a[0] - b[0]));
};

// Failed input is evidence about a route, not a reason to overwrite cartridge
// collision data. Keep bounded, checkpointable exclusions beside observations.
export function createMovementRecovery(initialState = null) {
  let failures = structuredClone(initialState?.failures ?? []);
  if (!Array.isArray(failures) || failures.length > 64 || failures.some((entry) =>
    typeof entry.map !== "string" || !Number.isSafeInteger(entry.x) || !Number.isSafeInteger(entry.y) ||
    !VECTORS[entry.direction] || !Number.isSafeInteger(entry.count) || entry.count <= 0
  )) throw new TypeError("invalid movement recovery state");
  let pending = structuredClone(initialState?.pending ?? null);
  if (pending && (pending.interaction
    ? typeof pending.surface !== 'string' || !Number.isSafeInteger(pending.frames) || pending.frames < 1 || pending.frames > 120 ||
      typeof pending.entry?.map !== 'string' || !VECTORS[pending.entry?.direction] ||
      !Number.isSafeInteger(pending.entry?.x) || !Number.isSafeInteger(pending.entry?.y)
    : typeof pending.lease?.origin?.map !== 'string' || !VECTORS[pending.recommendation?.direction] ||
      !Number.isSafeInteger(pending.lease?.origin?.x) || !Number.isSafeInteger(pending.lease?.origin?.y))) {
    throw new TypeError('invalid pending movement evidence');
  }
  let storySignature = initialState?.storySignature ?? null;
  let lastMap = initialState?.lastMap ?? null;
  return Object.freeze({
    observeExecution({ observation, decision, execution }) {
      const lease = decision?.action?.movementLease;
      if (!execution?.interrupted && lease && ["stalled", "frame-limit"].includes(execution?.movementLease)) {
        pending = { lease: structuredClone(lease), recommendation: { direction: decision.winner?.recommendation?.direction } };
      }
      const recommendation = decision?.winner?.recommendation;
      const target = recommendation?.obstacle ?? recommendation?.target;
      if (!pending && !execution?.interrupted && fieldReady(observation) && INTERACTION_KINDS.has(recommendation?.kind) &&
          ['object', 'background'].includes(target?.kind) && VECTORS[recommendation.direction] &&
          decision.action?.buttons?.includes('a') && Number.isSafeInteger(execution?.endFrame) &&
          execution.endFrame > observation.frame) {
        pending = { interaction: true, surface: interactionSurface(observation),
          frames: Math.min(120, execution.endFrame - observation.frame),
          entry: { map: observation.playerMemory.map.id, ...observation.playerMemory.position,
            direction: recommendation.direction, destinationMap: null,
            target: { kind: target.kind, index: target.index, x: target.x, y: target.y } } };
      }
    },
    observation(observation) {
      const memory = observation.playerMemory;
      if (fieldReady(observation)) {
        const map = memory?.map?.id;
        // A visit does not repair a failed edge. Revalidate against the actual
        // local blockers below; keep unchanged failures through map re-entry.
        if (map) lastMap = map;
        failures = failures.filter(entry => entry.map !== map || entry.target ||
          Object.hasOwn(entry, 'objects') && (entry.objects == null ||
            edgeObjects(memory, entry) == null || edgeObjects(memory, entry) === entry.objects));
      }
      const signature = JSON.stringify(memory?.storyState ?? null);
      if (storySignature !== null && signature !== storySignature) failures = [];
      storySignature = signature;
      if (pending?.interaction) {
        const attempted = pending;
        pending = null;
        const matches = candidate => candidate.target &&
          ['map', 'x', 'y', 'direction'].every(key => candidate[key] === attempted.entry[key]) &&
          JSON.stringify(candidate.target) === JSON.stringify(attempted.entry.target);
        if (fieldReady(observation) && interactionSurface(observation) === attempted.surface) {
          const existing = failures.find(matches);
          if (existing) { existing.count += 1; existing.frames = (existing.frames ?? 0) + attempted.frames; }
          else failures.push({ ...attempted.entry, count: 1, frames: attempted.frames });
          failures = failures.slice(-64);
        } else failures = failures.filter(candidate => !matches(candidate));
      }
      if (pending && observation.phase === "stable") {
        const { lease, recommendation } = pending;
        pending = null;
        const position = memory?.position;
        const direction = recommendation?.direction;
        if (fieldReady(observation) && VECTORS[direction] &&
            memory?.map?.id === lease.origin?.map &&
            position?.x === lease.origin.x && position?.y === lease.origin.y) {
          const entry = { map: lease.origin.map, x: position.x, y: position.y, direction,
            destinationMap: lease.kind === "map-connection" ? lease.destinationMap : null };
          const existing = failures.find((candidate) => Object.keys(entry).every((key) => candidate[key] === entry[key]));
          if (existing) existing.count += 1;
          else failures.push({ ...entry, count: 1, objects: edgeObjects(memory, entry) });
          failures = failures.slice(-64);
        }
      }
      const excluded = failures.filter(({ map, count, target, frames }) =>
        map === memory?.map?.id && count >= 3 && (!target || frames >= 120));
      if (!excluded.length) return observation;
      return { ...observation, navigationExclusions: {
        transitions: excluded.filter(({ destinationMap }) => destinationMap),
        tiles: excluded.filter(({ destinationMap, target }) => !destinationMap && !target).map(({ x, y, direction }) => ({
          x: x + VECTORS[direction][0], y: y + VECTORS[direction][1],
        })),
        interactions: excluded.filter(entry => entry.target).map(({ x, y, direction, target }) => ({ x, y, direction, target })),
      } };
    },
    reset() { failures = []; pending = null; storySignature = null; lastMap = null; },
    // An input receipt is not an observed result. Retain it across transition
    // waits and reconstruction, then reconcile once against settled native state.
    state() { return { failures: structuredClone(failures), storySignature, lastMap, pending: structuredClone(pending) }; },
  });
}
