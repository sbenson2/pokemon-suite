import assert from "node:assert/strict";
import test from "node:test";

async function loadClient() {
  try {
    return await import("../src/emulator/autonomous-emulator-client.js");
  } catch (error) {
    if (error?.code === "ERR_MODULE_NOT_FOUND") return {};
    throw error;
  }
}

test("the central player can only observe and submit inputs to the emulator worker", async (context) => {
  const { createAutonomousEmulatorClient } = await loadClient();
  assert.equal(typeof createAutonomousEmulatorClient, "function");
  const emulator = await createAutonomousEmulatorClient({}, {
    workerUrl: new URL("../test-support/autonomous-emulator-rpc-worker.js", import.meta.url),
  });
  context.after(() => emulator.close());

  assert.equal(emulator.step, undefined);
  assert.deepEqual(emulator.identity, { cartridgeProfileId: "test-cartridge" });
  assert.equal(emulator.liveView, "http://127.0.0.1:17339/");
  assert.deepEqual(await emulator.observe(), {
    captureId: "worker-observation",
    frame: 25,
  });
  assert.deepEqual(await emulator.execute({
    buttons: ["right"], holdFrames: 3, releaseFrames: 1,
  }), {
    startFrame: 25,
    endFrame: 29,
    action: { buttons: ["right"], holdFrames: 3, releaseFrames: 1 },
  });
  assert.deepEqual(await emulator.metrics(), { emulationSpeed: 5, sourceFrame: 30 });
  assert.deepEqual(await emulator.controlState(), {
    mode: "bot",
    manualSessionCount: 1,
  });
  assert.deepEqual(await emulator.takeControlHandoff(), {
    schema: "master-red/manual-control-handoff/v1",
    session: 1,
    startedFrame: 20,
    endedFrame: 30,
    inputEvents: [{ frame: 22, buttons: ["a"] }],
    observation: { captureId: "after-manual", frame: 30 },
  });
});

test("an unexpected clean worker exit rejects outstanding and future requests", { timeout: 1000 }, async (t) => {
  const { createAutonomousEmulatorClient } = await loadClient();
  const emulator = await createAutonomousEmulatorClient({ exitOnObserve: true }, {
    workerUrl: new URL("../test-support/autonomous-emulator-rpc-worker.js", import.meta.url),
  });
  t.after(() => emulator.close().catch(() => {}));
  await assert.rejects(emulator.observe(), /worker exited/);
  await assert.rejects(emulator.observe(), /worker exited/);
});
