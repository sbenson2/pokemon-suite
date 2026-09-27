import test from 'node:test';
import assert from 'node:assert/strict';
import {createPostgameController} from '../src/suite/postgame.js';
import {createCentralPlayer, retainedTransitionAction} from '../src/player/delegator.js';
import {FireRedEvolutionTask} from '../src/suite/fire-red-evolution.js';
import {encodeButtons} from '../src/emulator/mgba-session.js';
import {actionPrecondition} from '../src/emulator/action-precondition.js';

const slopeCell = (x, y) => ({x, y, collision: 0, elevation: 3, behaviorName: 'MB_CYCLING_ROAD_PULL_DOWN'});
const cyclingTransition = (x = 5, y = 91) => {
  const o = {captureId: 'slope', frame: 200, phase: 'transition', phaseReasons: ['tile-transition'],
    sram: {sha256: 'before'}, emulator: {mode: 'overworld', inBattle: false, inputReady: true, input: {heldKeysRaw: 0}},
    playerMemory: {map: {id: 'MAP_ROUTE17'}, position: {x, y}, avatar: {flags: 6}, mapGrid: {width: 10, height: 140, cells: [slopeCell(x, y)]}, encounter: null,
      ui: {}, storyState: {flagIds: {2092: true}, variableIds: {}}, gameStats: {savedGame: 7}, saveAttemptStatus: 1,
      trainer: {partyValidity: 'valid', party: [], usablePartyCount: 0, pokedex: {ownedSpecies: [13]}, bag: {}, storage: {validity: 'valid', pokemon: [], boxCounts: [1, ...Array(13).fill(0)]}}}};
  for (const part of [o.sram, o.emulator, o.playerMemory]) Object.assign(part, {frame: o.frame, captureId: o.captureId});
  return o;
};

const sustained = (buttons, holdFrames = 4, continuationButtons = null) => ({
  kind: 'sustained-chord', buttons, holdFrames, releaseFrames: 0,
  ...(continuationButtons ? {movementLease: {continuationButtons}} : {})});

test('an owned slope climb continues across a tile transition instead of releasing the chord', () => {
  const o = cyclingTransition();
  const action = sustained(['b', 'up'], 4, ['b']);
  o.emulator.input.heldKeysRaw = encodeButtons(['b']);
  const continuation = retainedTransitionAction(o, {action});
  assert.equal(continuation?.reason, 'continuous-movement-lease-transition');
  assert.deepEqual(continuation?.action.buttons, ['b']);
  assert.equal(continuation?.action.kind, 'sustained-chord');
  assert.equal(continuation?.action.holdFrames, 4);
});

test('ordinary retained running continues across an unowned tile transition', () => {
  const o = cyclingTransition();
  const continuation = retainedTransitionAction(o, {action: sustained(['up'])});
  assert.equal(continuation?.reason, 'continuous-tile-transition');
  assert.deepEqual(continuation?.action.buttons, ['up']);
});

test('a coasting bicycle brakes on a cycling-road transition when no chord is owned', () => {
  const o = cyclingTransition();
  const continuation = retainedTransitionAction(o, null);
  assert.equal(continuation?.reason, 'cycling-road-brake-transition');
  assert.deepEqual(continuation?.action.buttons, ['b']);
  assert.equal(continuation?.action.kind, 'sustained-chord');
});

test('no transition continuation is invented away from the slope', () => {
  const o = cyclingTransition();
  o.phase = 'stable';
  o.phaseReasons = [];
  assert.equal(retainedTransitionAction(o, null), null);
  o.phase = 'transition';
  o.phaseReasons = ['tile-transition'];
  o.playerMemory.mapGrid.cells = [{x: 5, y: 91, collision: 0, elevation: 3, behaviorName: 'MB_NORMAL'}];
  assert.equal(retainedTransitionAction(o, null), null);
});

const args = {world: {data: {maps: [], wildEncounters: []}}, story: {data: {scripts: []}}, mechanics: {data: {species: []}}};
const weedle = {validity: 'valid', species: 13, personality: 123, otId: 456, shiny: false, level: 5, friendship: 70, heldItem: 0,
  moves: [40], pp: [35], ivs: {hp: 20, attack: 20, defense: 20, speed: 20, spAttack: 20, spDefense: 20}};

function evolvingState() {
  const c = createPostgameController(args);
  c.beginAdventure();
  const state = c.state();
  state.dexEvolution = new FireRedEvolutionTask({requestId: 'weedle', sourceId: 'owned-national-dex', pokemon: weedle,
    steps: [{kind: 'evolve', game: 'firered', fromSpecies: 13, speciesId: 14}, {kind: 'verify', game: 'firered', speciesId: 14}],
    request: {speciesId: 14, shiny: 'any'}}).state;
  return state;
}

test('an owned slope climb chord continues while the pull transition runs', () => {
  const o = cyclingTransition();
  const action = sustained(['b', 'up'], 4, ['b']);
  o.emulator.input.heldKeysRaw = encodeButtons(['b', 'up']);
  const continuation = retainedTransitionAction(o, {action});
  assert.equal(continuation?.reason, 'continuous-slope-climb-transition');
  assert.deepEqual(continuation?.action.buttons, ['b', 'up']);
  assert.equal(continuation?.action.kind, 'sustained-chord');
});

test('a held slope climb is neither vetoed nor stripped while the pull runs', () => {
  const proposal = (advisor, observation, recommendation, vetoes = []) => ({
    advisor, observationId: observation.captureId, recommendation, confidence: 1,
    constraints: [], vetoes, evidenceRefs: ['test']});
  const advisors = [
    {id: 'navigation', advise: o => proposal('navigation', o,
      {kind: 'move-toward', direction: 'north', objective: 'train', cyclingRoadSlope: true})},
    {id: 'verifier', advise: o => {
      const contradiction = o.phase !== 'stable' || o.emulator.inputReady === false;
      return proposal('verifier', o,
        contradiction ? {kind: 'withhold-unsafe-decision'} : {kind: 'permit-current-observation'},
        contradiction ? ['all'] : []);
    }},
  ];
  const player = createCentralPlayer({advisors, mechanics: {}});
  const stable = cyclingTransition();
  stable.phase = 'stable';
  stable.phaseReasons = [];
  const first = player.decide(stable);
  assert.equal(first.winner?.recommendation?.kind, 'move-toward');
  assert.deepEqual(first.action.buttons, ['b', 'up']);
  const pulling = cyclingTransition();
  pulling.emulator.input.heldKeysRaw = encodeButtons(['b', 'up']);
  pulling.emulator.inputReady = false;
  const second = player.decide(pulling);
  assert.notEqual(second.reason, 'policy-veto');
  assert.ok((second.action?.buttons ?? []).includes('up'), 'the climb chord stays pressed');
  assert.ok(actionPrecondition(pulling, second.action).motion, 'the held climb is executable field motion');
});

test('an evolution waiting on a cycling-road pull retains the slope transition input', () => {
  let now = 1000;
  const controller = createPostgameController({...args, state: evolvingState(), clock: () => now});
  const decision = controller.decide(cyclingTransition());
  assert.equal(decision.kind, 'resample');
  assert.equal(decision.reason, 'cycling-road-brake-transition');
  assert.deepEqual(decision.action.buttons, ['b']);
  assert.equal(decision.action.kind, 'sustained-chord');
});

test('a reviewed resume re-arms the exhausted progress lease instead of replaying it', () => {
  let now = 1000;
  const state = evolvingState();
  state.status = 'waiting';
  state.reason = 'Recovery could not finish the transition within its 120-second active deadline; the owned task and checkpoint are retained.';
  state.watchdog = {owner: 'weedle', idleMs: 400000, lastAt: now - 130000, seen: ['a'], storySeen: ['b'], verifiedStoryProgress: false,
    reason: 'Progress timeout: finish the owned transaction and native save before changing tasks.',
    boundary: {owner: 'weedle', reason: 'Progress timeout: finish the owned transaction and native save before changing tasks.', elapsedMs: 130000, lastAt: now}};
  const controller = createPostgameController({...args, state, clock: () => now});
  controller.resume();
  assert.ok(!controller.state().watchdog.boundary, 'the exhausted boundary is re-armed, not replayed');
  const decision = controller.decide(cyclingTransition());
  assert.notEqual(decision.reason, 'Recovery could not finish the transition within its 120-second active deadline; the owned task and checkpoint are retained.');
  assert.equal(decision.reason, 'cycling-road-brake-transition');
});

test('an evolution waiting off the slope still resamples neutrally', () => {
  let now = 1000;
  const controller = createPostgameController({...args, state: evolvingState(), clock: () => now});
  const o = cyclingTransition();
  o.phase = 'transition';
  o.phaseReasons = ['palette-fade'];
  o.playerMemory.mapGrid.cells = [];
  const decision = controller.decide(o);
  assert.notEqual(decision.reason, 'cycling-road-brake-transition');
  assert.deepEqual(decision.action.buttons, []);
});

test('an evolution waiting with an invalid party keeps its neutral observation wait', () => {
  let now = 1000;
  const controller = createPostgameController({...args, state: evolvingState(), clock: () => now});
  const o = cyclingTransition();
  o.phase = 'stable';
  o.phaseReasons = [];
  o.playerMemory.trainer.partyValidity = 'unknown';
  const decision = controller.decide(o);
  assert.equal(decision.reason, 'Waiting for the evolution observation.');
  assert.deepEqual(decision.action.buttons, []);
});
