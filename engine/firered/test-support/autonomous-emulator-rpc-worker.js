import { parentPort, workerData } from "node:worker_threads";

parentPort.postMessage({
  type: "ready",
  identity: { cartridgeProfileId: "test-cartridge" },
  liveView: "http://127.0.0.1:17339/",
});

parentPort.on("message", ({ id, method, value }) => {
  if (workerData?.exitOnObserve && method === "observe") {
    parentPort.close();
    return;
  }
  if (method === "close") {
    parentPort.postMessage({ id, ok: true, value: null });
    parentPort.close();
    return;
  }
  const result = {
    observe: { captureId: "worker-observation", frame: 25 },
    execute: { startFrame: 25, endFrame: 29, action: value },
    metrics: { emulationSpeed: 5, sourceFrame: 30 },
    controlState: { mode: "bot", manualSessionCount: 1 },
    takeControlHandoff: {
      schema: "master-red/manual-control-handoff/v1",
      session: 1,
      startedFrame: 20,
      endedFrame: 30,
      inputEvents: [{ frame: 22, buttons: ["a"] }],
      observation: { captureId: "after-manual", frame: 30 },
    },
    captureSnapshot: {
      frame: 30,
      state: new Uint8Array([1, 2, 3]),
      sram: new Uint8Array([4, 5]),
      video: { width: 1, height: 1, rgba: new Uint8Array([6, 7, 8, 255]) },
    },
    setStatus: null,
  }[method];
  if (result === undefined) {
    parentPort.postMessage({
      id,
      ok: false,
      error: { name: "Error", message: `unknown method ${method}` },
    });
  } else {
    parentPort.postMessage({ id, ok: true, value: result });
  }
});
