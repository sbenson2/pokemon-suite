import assert from "node:assert/strict";
import test from "node:test";
import { createMovementRecovery } from "../src/player/movement-recovery.js";

function observed(x = 2, flags = {}) {
  return { phase: "stable", emulator: { mode: "overworld" }, playerMemory: {
    map: { id: "MAP_TEST" }, position: { x, y: 2 }, storyState: { flagIds: flags },
  } };
}
function execution(result, x = 2) {
  return { execution: { movementLease: result }, decision: {
    winner: { recommendation: { kind: "move-toward", direction: "east" } },
    action: { movementLease: { kind: "route-plan", origin: { map: "MAP_TEST", x, y: 2 } } },
  } };
}

test("successful patrols and partially completed leases do not blacklist training paths", () => {
  const recovery = createMovementRecovery();
  for (let index = 0; index < 12; index += 1) {
    recovery.observeExecution(execution(index % 2 ? "target-reached" : "frame-limit", index));
    assert.equal(recovery.observation(observed(index + 1)).navigationExclusions, undefined);
  }
  assert.deepEqual(recovery.state().failures, []);
});

test("repeated stationary route failures exclude the next tile without changing cartridge memory", () => {
  const recovery = createMovementRecovery();
  const original = observed();
  for (let index = 0; index < 3; index += 1) {
    recovery.observeExecution(execution("stalled"));
    recovery.observation(original);
  }
  const planned = recovery.observation(original);
  assert.deepEqual(planned.navigationExclusions.tiles, [{ x: 3, y: 2 }]);
  assert.equal(planned.playerMemory, original.playerMemory);
  assert.equal(original.navigationExclusions, undefined);
});

test("a story change or manual handoff reopens previously failed movement paths", () => {
  const recovery = createMovementRecovery();
  for (let index = 0; index < 3; index += 1) {
    recovery.observeExecution(execution("stalled"));
    recovery.observation(observed());
  }
  const restored = createMovementRecovery(JSON.parse(JSON.stringify(recovery.state())));
  assert.ok(restored.observation(observed()).navigationExclusions);
  assert.equal(restored.observation(observed(2, { 123: true })).navigationExclusions, undefined);
  recovery.reset();
  assert.equal(recovery.observation(observed()).navigationExclusions, undefined);
});

test('a moved blocker reopens its tile and connection after checkpoint restore', () => {
  for (const connection of [false, true]) {
    const recovery = createMovementRecovery();
    const o = observed();
    o.playerMemory.objectEvents = [{ localId: 1, current: { x: 3, y: 2 } },
      { localId: 2, current: { x: 8, y: 2 } }];
    for (let i = 0; i < 3; i++) {
      const attempt = { ...execution('stalled'), observation: o };
      if (connection) Object.assign(attempt.decision.action.movementLease,
        { kind: 'map-connection', destinationMap: 'MAP_NEXT' });
      recovery.observeExecution(attempt); recovery.observation(o);
    }
    const restored = createMovementRecovery(recovery.state());
    const unrelated = structuredClone(o);
    unrelated.playerMemory.objectEvents[1].current.x++;
    assert.ok(restored.observation(unrelated).navigationExclusions, 'unrelated motion retains the failed approach');
    const cleared = structuredClone(unrelated);
    cleared.playerMemory.objectEvents[0].current.x = 6;
    assert.equal(restored.observation(cleared).navigationExclusions, undefined);
    assert.deepEqual(restored.state().failures, []);
  }
});

test('reentering an unchanged map retains failed approaches across a controller restart', () => {
  const recovery = createMovementRecovery();
  for (let i = 0; i < 3; i++) {
    recovery.observeExecution({ ...execution('stalled'), observation: observed() });
    recovery.observation(observed());
  }
  const away = observed(); away.playerMemory.map.id = 'MAP_NEXT';
  recovery.observation(away);
  const restored=createMovementRecovery(JSON.parse(JSON.stringify(recovery.state())));
  assert.deepEqual(restored.observation(observed()).navigationExclusions.tiles,[{x:3,y:2}]);
});

test('legacy exclusions without blocker evidence are revalidated once after upgrading', () => {
 const recovery=createMovementRecovery({failures:[{map:'MAP_TEST',x:2,y:2,direction:'east',destinationMap:null,count:3}]});
 assert.equal(recovery.observation(observed()).navigationExclusions,undefined);
 assert.deepEqual(recovery.state().failures,[]);
});

function interaction(observation, changes = {}) {
  return { observation, execution: { startFrame: observation.frame, endFrame: observation.frame + 2 }, decision: {
    winner: { recommendation: { kind: 'interact-with-object', direction: 'east',
      obstacle: { kind: 'object', index: 0, x: 3, y: 2 } } },
    action: { buttons: ['a'], holdFrames: 1, releaseFrames: 1 }, ...changes,
  } };
}

test('stationary unsuccessful A inputs learn one approach and survive a checkpoint', () => {
  let recovery = createMovementRecovery();
  let observation = { ...observed(), frame: 0 };
  for (let index = 0; index < 60; index++) {
    recovery.observeExecution(interaction(observation));
    observation = { ...observed(), frame: observation.frame + 2 };
    const result = recovery.observation(observation);
    if (index === 20) recovery = createMovementRecovery(recovery.state());
    if (index < 59) assert.equal(result.navigationExclusions, undefined);
  }
  assert.deepEqual(recovery.observation(observation).navigationExclusions.interactions, [{
    x: 2, y: 2, direction: 'east', target: { kind: 'object', index: 0, x: 3, y: 2 },
  }]);
  assert.deepEqual(recovery.observation(observation).navigationExclusions.tiles, []);
});

test('turns, rejected inputs, dialogue, battles, motion and successful item collection do not poison approaches', () => {
  for (const scenario of ['turn', 'rejected', 'dialogue', 'battle', 'motion', 'bag', 'objects']) {
    const recovery = createMovementRecovery();
    let o = { ...observed(), frame: 0 };
    for (let i = 0; i < 80; i++) {
      const update = interaction(o);
      if (scenario === 'turn') update.decision.action.buttons = ['right'];
      if (scenario === 'rejected') update.execution = { status: 'precondition-failed' };
      recovery.observeExecution(update);
      o = { ...observed(scenario === 'motion' ? i + 3 : 2), frame: o.frame + 2 };
      if (scenario === 'dialogue') o.playerMemory.ui = { fieldDialog: { active: true } };
      if (scenario === 'battle') o.emulator = { mode: 'battle', inBattle: true };
      if (scenario === 'bag') o.playerMemory.trainer = { bag: { items: [{ itemId: 19, quantity: i }] } };
      if (scenario === 'objects') o.playerMemory.objectEvents = [{ localId: 1, current: { x: i, y: 2 } }];
      assert.equal(recovery.observation(o).navigationExclusions, undefined, scenario);
    }
  }
});
