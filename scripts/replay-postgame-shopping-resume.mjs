import assert from 'node:assert/strict';
import {mkdirSync, writeFileSync} from 'node:fs';
import {resolve} from 'node:path';
import {createPostgameController} from '../engine/firered/src/suite/postgame.js';
import {createFireRedObserver} from '../engine/firered/src/evidence/fire-red-observer.js';
import {readPostgameEvidence} from '../engine/firered/src/suite/postgame-agenda.js';
import {continueNativeSaveAsync} from '../engine/firered/src/suite/native-cold-boot.js';
import {encounterFingerprint} from '../engine/firered/src/player/encounter-tracker.js';
import {SaveVault} from '../engine/firered/src/suite/save-vault.js';

const OUTPUT = resolve(process.env.SUITE_SHOPPING_REPLAY_OUTPUT ?? '.private/postgame-autonomy-20260920/native');
const SHOP = 'stock-postgame-supplies';
const MART = 'MAP_INDIGO_PLATEAU_POKEMON_CENTER_1F';
const quantity = (trainer, itemId) => Object.values(trainer.bag).flat()
  .filter(item => item.itemId === itemId).reduce((count, item) => count + item.quantity, 0);
const identities = trainer => [...trainer.party, ...trainer.storage.pokemon]
  .map(encounterFingerprint).sort();
const free = observation => observation.phase === 'stable' &&
  observation.emulator.mode === 'overworld' && !observation.emulator.inBattle &&
  (!observation.playerMemory.scripts?.globalStatus ||
    observation.playerMemory.scripts.globalStatus === 'shutdown') &&
  (!observation.playerMemory.scripts?.globalMode ||
    observation.playerMemory.scripts.globalMode === 'stopped') &&
  !Object.values(observation.playerMemory.ui ?? {}).some(Boolean);
const summary = (observation, state, decision) => ({
  frame: observation.frame,
  map: observation.playerMemory.map.id,
  position: observation.playerMemory.position,
  mode: observation.emulator.mode,
  objective: state.objective?.id,
  targetMap: state.objective?.target?.map,
  targetKind: state.objective?.target?.kind,
  care: state.fieldCare?.active?.kind,
  decision: decision?.kind,
  recommendation: decision?.winner?.recommendation?.kind,
  phase: decision?.winner?.recommendation?.victoryRoadPhase,
  savedGame: observation.playerMemory.gameStats.savedGame,
  money: observation.playerMemory.trainer.money,
  martStage: observation.playerMemory.ui?.mart?.stage,
  partyStage: observation.playerMemory.ui?.party?.stage,
});

// Continue the captured, blocked controller and cartridge without changing ROM,
// game memory, elapsed watchdog budget, or the retained supply basket.
export async function replayPostgameShoppingResume({session, saved, inputs, createSession}) {
  const initialState = structuredClone(saved.metadata.session.postgame);
  let clock = Math.max(Date.parse(saved.updatedAt), initialState.watchdog.lastAt);
  const open = state => createPostgameController({
    ...inputs, mechanics: inputs.battle, state, clock: () => clock,
  });
  let controller = open(initialState);
  const observer = createFireRedObserver({
    session, ...inputs, runId: 'postgame-shopping-resume', storyWatch: controller.storyWatch(),
  });
  const capture = () => {
    const raw = observer.capture();
    return {...raw, playerMemory: {...raw.playerMemory,
      postgameEvidence: readPostgameEvidence(session, inputs.runtime, raw)}};
  };
  const before = capture();
  let last = summary(before, controller.state(), null);
  let lastSwitch = before.playerMemory.storyState?.variableIds?.[0x4064];
  let lastWatchdogBucket = -1;
  const restarts = new Set();
  const visited = new Set([before.playerMemory.map.id]);
  const basket = structuredClone(initialState.fieldCare?.active?.objective?.target?.items);
  const initialTrainer = before.playerMemory.trainer;
  const originalIdentities = identities(initialTrainer);
  const initialRevives = quantity(initialTrainer, 24);
  const originalTentacruel = initialTrainer.party.find(member => member.species === 73);
  let revived = false;
  let shopBaseline = null;
  let stocked = false;
  let stockedAtSave = null;
  let spent = null;
  const wallDeadline = Date.now() + 10 * 60 * 1000;

  try {
    assert.equal(before.playerMemory.map.id, 'MAP_VICTORY_ROAD_1F');
    assert.deepEqual(before.playerMemory.position, {x: 11, y: 20});
    assert.equal(before.playerMemory.storyState.variableIds[0x4064], 0);
    assert.equal(initialState.objective?.id, SHOP);
    assert.ok(Array.isArray(basket) && basket.length > 0);
    assert.equal(originalTentacruel?.hp, 0);
    assert.ok(initialRevives > 0);
    controller.resume();

    for (let turn = 0; turn < 25000 && Date.now() < wallDeadline; turn++) {
      const observation = capture();
      const memory = observation.playerMemory;
      const trainer = memory.trainer;
      const decision = controller.decide(observation);
      let state = controller.state();
      visited.add(memory.map.id);
      const current = summary(observation, state, decision);
      const switch1 = memory.storyState?.variableIds?.[0x4064];
      const watchdogBucket = Math.floor((state.watchdog?.idleMs ?? 0) / 15000);
      if (current.care !== last.care || switch1 !== lastSwitch ||
          watchdogBucket >= 16 && watchdogBucket !== lastWatchdogBucket ||
          Boolean(state.fieldCare?.deferredShopping) !== Boolean(last.deferredShopping)) {
        console.log('# shopping-diagnostic ' + JSON.stringify({
          frame: observation.frame, map: memory.map.id, position: memory.position,
          objective: current.objective, care: current.care,
          party: trainer.party.map(member => ({species: member.species, hp: member.hp,
            maxHp: member.maxHp, status1: member.status1, pp: member.pp})),
          switch1, boulder: memory.objectEvents?.find(event => event.localId === 5)?.current,
          watchdog: {idleMs: state.watchdog?.idleMs, retries: state.watchdog?.retries,
            lastProgressAt: state.watchdog?.lastProgressAt, seen: state.watchdog?.seen?.length},
          suspendedShopping: Boolean(state.fieldCare?.suspendedShopping),
          deferredShopping: Boolean(state.fieldCare?.deferredShopping),
        }));
      }
      lastSwitch = switch1;
      lastWatchdogBucket = watchdogBucket;
      current.deferredShopping = Boolean(state.fieldCare?.deferredShopping);
      if (current.map !== last.map || current.objective !== last.objective ||
          current.care !== last.care || current.phase !== last.phase ||
          current.martStage !== last.martStage || current.partyStage !== last.partyStage ||
          turn % 1000 === 0) {
        console.log('# shopping-resume ' + JSON.stringify(current));
      }
      last = current;
      assert.notEqual(decision.kind, 'blocked', decision.reason);
      assert.ok(observation.frame - before.frame <= 360000, 'native frame bound exceeded');

      if (memory.ui?.party && !restarts.has('treatment')) {
        controller = open(structuredClone(state));
        state = controller.state();
        restarts.add('treatment');
      }
      const stone = memory.objectEvents?.find(event => event.localId === 5)?.current;
      if (memory.map.id === 'MAP_VICTORY_ROAD_1F' && stone &&
          (stone.x !== 7 || stone.y !== 18) && !restarts.has('puzzle')) {
        controller = open(structuredClone(state));
        state = controller.state();
        restarts.add('puzzle');
      }
      if (memory.ui?.mart?.stage === 'quantity' && !restarts.has('purchase')) {
        controller = open(structuredClone(state));
        state = controller.state();
        restarts.add('purchase');
      }

      if (trainer.party.some(member => member.species === 73 && member.hp > 0) &&
          quantity(trainer, 24) < initialRevives) revived = true;
      if (memory.map.id === MART && !shopBaseline && free(observation)) {
        shopBaseline = {money: trainer.money,
          quantities: Object.fromEntries(basket.map(item => [item.itemId, quantity(trainer, item.itemId)]))};
      }
      if (shopBaseline && !stocked && free(observation) &&
          basket.every(item => quantity(trainer, item.itemId) >= item.quantity)) {
        spent = basket.reduce((total, item) => total +
          (quantity(trainer, item.itemId) - shopBaseline.quantities[item.itemId]) * item.unitPrice, 0);
        assert.equal(shopBaseline.money - trainer.money, spent,
          'native money spent must match the observed basket increase');
        stocked = true;
        stockedAtSave = {counter: memory.gameStats.savedGame, sha256: observation.sram.sha256};
      }

      const nextTask = state.objective?.id !== SHOP &&
        !['purchase-items', 'heal-with-items', 'save-game'].includes(state.objective?.target?.kind) &&
        state.objective?.id !== 'postgame-save' && Boolean(state.objective);
      const savedGame = stockedAtSave && memory.gameStats.savedGame > stockedAtSave.counter &&
        memory.saveAttemptStatus === 1 && observation.sram.sha256 !== stockedAtSave.sha256;
      if (stocked && revived && savedGame && nextTask && free(observation)) {
        assert.ok(restarts.has('treatment') && restarts.has('puzzle') &&
          restarts.has('purchase'), 'reconstruct treatment, puzzle, and purchase');
        assert.ok(visited.has('MAP_VICTORY_ROAD_2F') && visited.has('MAP_VICTORY_ROAD_3F'),
          'cross both upper floors after opening the first gate');
        assert.deepEqual(identities(trainer), originalIdentities,
          'the original party and storage individuals survive shopping');
        const cold = await createSession();
        try {
          cold.loadSram(session.saveSram());
          const reader = createFireRedObserver({
            session: cold, ...inputs, runId: 'shopping-resume-cold', storyWatch: controller.storyWatch(),
          });
          const loaded = await continueNativeSaveAsync(cold, reader);
          assert.deepEqual(identities(loaded.playerMemory.trainer), originalIdentities);
          assert.equal(loaded.playerMemory.trainer.money, trainer.money);
          for (const item of basket) assert.equal(
            quantity(loaded.playerMemory.trainer, item.itemId), quantity(trainer, item.itemId));
        } finally { cold.close(); }
        assert.deepEqual(saved.metadata.session.postgame, initialState,
          'the original checkpoint remains unchanged');
        console.log('# shopping-resume verified ' + JSON.stringify({
          frame: observation.frame, spent, restarts: [...restarts], maps: [...visited],
          nextObjective: state.objective?.id, coldContinue: true,
        }));
        return {before, after: observation};
      }
      if (decision.kind === 'capture-saved') {
        controller.acknowledgeCapture();
        continue;
      }
      const action = decision.action ?? {buttons: [], holdFrames: 8};
      for (let frame = 0; frame < (action.holdFrames ?? 1); frame++) {
        session.step(action.buttons ?? []);
        clock += 1000 / 60;
      }
      for (let frame = 0; frame < (action.releaseFrames ?? 0); frame++) {
        session.step([]);
        clock += 1000 / 60;
      }
    }
    throw Error('Shopping resume exceeded its 10-minute, 25,000-decision, or native-frame bound.');
  } catch (error) {
    mkdirSync(OUTPUT, {recursive: true});
    const record = new SaveVault(OUTPUT, saved.identity).write(
      session.saveState(), session.saveSram(), {
        ...saved.metadata, frame: session.frame, reason: 'shopping-resume-replay-failure',
        session: {...saved.metadata.session, postgame: controller.state()},
      });
    writeFileSync(resolve(OUTPUT, 'failure.json'), JSON.stringify({
      message: error.message, last, restarts: [...restarts], maps: [...visited],
      revived, stocked, spent,
      checkpoint: {
        path: resolve(OUTPUT, 'current.json'),
        stateSha256: record.stateSha256,
        sramSha256: record.sramSha256,
      },
    }, null, 2) + '\n');
    console.log('# shopping-resume failure ' + JSON.stringify({
      message: error.message, last, checkpoint: resolve(OUTPUT, 'failure.json'),
    }));
    throw error;
  }
}
