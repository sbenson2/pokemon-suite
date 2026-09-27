import test from 'node:test';
import assert from 'node:assert/strict';
import {createLimitCycleDetector} from '../src/player/limit-cycle.js';

const field = (x, y, frame, overrides = {}) => {
  const o = {
    captureId: `c${frame}`, frame, phase: 'stable', phaseReasons: [],
    emulator: {mode: 'overworld', inBattle: false, inputReady: true},
    playerMemory: {
      map: {id: 'MAP_ROUTE17'}, position: {x, y}, avatar: {flags: 6, facing: 'south'},
      mapGrid: {cells: [], width: 10, height: 140}, ui: {}, questLog: null,
    },
  };
  for (const part of [o.emulator, o.playerMemory]) Object.assign(part, {frame, captureId: o.captureId});
  return Object.assign(o, overrides);
};

const walk = (detector, points, startFrame = 0) => points.reduce(
  (observation, [x, y], index) => detector.observe(field(x, y, startFrame + index * 20)),
  null,
);

const pullCell = (x, y) => ({x, y, collision: 0, elevation: 3, behaviorName: 'MB_CYCLING_ROAD_PULL_DOWN'});
const pullField = (x, y, frame) => field(x, y, frame, {playerMemory: {
  map: {id: 'MAP_ROUTE17'}, position: {x, y}, avatar: {flags: 6, facing: 'south'},
  mapGrid: {cells: [pullCell(x, y)], width: 10, height: 140}, ui: {}, questLog: null}});

test('a straight walk never reports a limit cycle', () => {
  const detector = createLimitCycleDetector();
  let last = null;
  for (let n = 0; n < 24; n++) last = detector.observe(field(5, 20 + n, n * 20));
  assert.ok(!last.navigationExclusions, 'a straight route carries no exclusions');
  assert.deepEqual(detector.state().exclusions, []);
  assert.equal(detector.state().samples.length, 24);
});

test('a pull flip-flop between four tiles emits tile exclusions', () => {
  const detector = createLimitCycleDetector();
  const points = [];
  for (let n = 0; n < 6; n++) points.push([5, 18], [5, 19], [5, 20], [5, 21], [5, 20], [5, 19]);
  let last = null;
  for (const [index, [x, y]] of points.entries()) last = detector.observe(pullField(x, y, index * 20));
  const tiles = last.navigationExclusions?.tiles ?? [];
  assert.deepEqual(
    tiles.map(({x, y}) => `${x},${y}`).sort(),
    ['5,18', '5,19', '5,20', '5,21'],
  );
  assert.ok(detector.state().samples.length < 14, 'the window is re-armed after a detection');
});

test('an ordinary-ground flip-flop is not a cycle', () => {
  const detector = createLimitCycleDetector();
  const points = [];
  for (let n = 0; n < 6; n++) points.push([5, 18], [5, 19], [5, 20], [5, 21], [5, 20], [5, 19]);
  let last = null;
  for (const [index, [x, y]] of points.entries()) last = detector.observe(field(x, y, index * 20));
  assert.ok(!last.navigationExclusions, 'searching or waiting on ordinary ground must not exclude tiles');
  assert.deepEqual(detector.state().exclusions, []);
});

test('a wide back-and-forth route with many tiles is not a cycle', () => {
  const detector = createLimitCycleDetector();
  const points = [];
  for (let n = 0; n < 10; n++) {
    points.push([5, 10 + n], [6, 10 + n], [7, 10 + n], [7, 11 + n], [6, 11 + n], [5, 11 + n]);
  }
  let last = null;
  for (const [index, [x, y]] of points.entries()) last = detector.observe(field(x, y, index * 20));
  assert.ok(!last.navigationExclusions, 'open revisits are ordinary navigation');
});

test('a few reversals during a reposition are not a cycle', () => {
  const detector = createLimitCycleDetector();
  const points = [[5, 20], [5, 19], [5, 20], [5, 19], [5, 20], [4, 20], [3, 20], [2, 20]];
  let last = null;
  for (const [index, [x, y]] of points.entries()) last = detector.observe(field(x, y, index * 20));
  assert.ok(!last.navigationExclusions);
});

test('standing still on one tile is not a cycle', () => {
  const detector = createLimitCycleDetector();
  let last = null;
  for (let n = 0; n < 20; n++) last = detector.observe(field(5, 20, n * 20));
  assert.ok(!last.navigationExclusions);
});

test('a map change clears the movement window', () => {
  const detector = createLimitCycleDetector();
  for (let n = 0; n < 8; n++) {
    detector.observe(field(5, 18 + (n % 2), n * 20));
  }
  const other = field(5, 18, 200, {playerMemory: {map: {id: 'MAP_ROUTE16'}, position: {x: 5, y: 18},
    avatar: {flags: 6, facing: 'south'}, mapGrid: {cells: [], width: 10, height: 140}, ui: {}, questLog: null}});
  other.playerMemory.frame = other.frame;
  const after = detector.observe(other);
  assert.ok(!after.navigationExclusions, 'exclusions from another map are not applied here');
});

test('menu and battle observations do not enter the window', () => {
  const detector = createLimitCycleDetector();
  for (let n = 0; n < 8; n++) detector.observe(field(5, 18 + (n % 2), n * 20));
  const menu = field(5, 18, 200, {playerMemory: {map: {id: 'MAP_ROUTE17'}, position: {x: 5, y: 18},
    avatar: {flags: 6, facing: 'south'}, mapGrid: {cells: [], width: 10, height: 140}, ui: {party: true}, questLog: null}});
  menu.playerMemory.frame = menu.frame;
  detector.observe(menu);
  assert.equal(detector.state().samples.length, 8, 'a menu wait cannot pollute or advance the window');
});

test('existing navigation exclusions are preserved and deduplicated', () => {
  const detector = createLimitCycleDetector();
  let last = null;
  const existing = {transitions: [], tiles: [{x: 5, y: 18}], interactions: []};
  for (let n = 0; n < 24; n++) {
    const x = n % 2 === 0 ? 5 : 6;
    const o = pullField(x, 20, n * 20);
    o.navigationExclusions = existing;
    last = detector.observe(o);
  }
  assert.deepEqual(last.navigationExclusions.tiles, [{x: 5, y: 18}, {x: 5, y: 20}, {x: 6, y: 20}]);
});

test('the detector checkpoint round-trips and rejects malformed state', () => {
  const detector = createLimitCycleDetector();
  for (let n = 0; n < 6; n++) detector.observe(field(5, 20, n * 20));
  const restored = createLimitCycleDetector(detector.state());
  assert.deepEqual(restored.state(), detector.state());
  assert.throws(() => createLimitCycleDetector({schema: 'master-red/limit-cycle/v1', samples: [{}], exclusions: []}),
    TypeError);
  assert.throws(() => createLimitCycleDetector({schema: 'master-red/limit-cycle/v0', samples: [], exclusions: []}),
    TypeError);
});
