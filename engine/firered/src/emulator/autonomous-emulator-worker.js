import { readFile } from "node:fs/promises";
import { parentPort, workerData } from "node:worker_threads";

import { createFireRedObserver } from "../evidence/fire-red-observer.js";
import { createLiveViewServer } from "../player/continuous-player.js";
import { createAutonomousEmulator } from "./autonomous-emulator.js";
import {
  createDecisionFeedBuffer,
  createEmulatorRequestHandler,
  createLiveViewBindings,
} from "./autonomous-emulator-worker-runtime.js";
import { createPinnedMgbaSession } from "./pinned-mgba.js";

function serializeError(error) {
  return {
    name: error?.name ?? "Error",
    message: error?.message ?? String(error),
    code: error?.code,
    stack: error?.stack,
  };
}

async function boot(configuration) {
  const paths = configuration?.paths ?? {};
  const [rom, runtimeText, worldText, storyText, state, sram] = await Promise.all([
    readFile(paths.rom),
    readFile(paths.runtime, "utf8"),
    readFile(paths.world, "utf8"),
    readFile(paths.story, "utf8"),
    paths.state ? readFile(paths.state) : null,
    paths.sram ? readFile(paths.sram) : null,
  ]);
  const session = await createPinnedMgbaSession({
    coreDirectory: configuration.coreDirectory,
    expected: configuration.expected,
    romBytes: new Uint8Array(rom),
    cartridge: configuration.cartridge,
  });
  let emulator = null;
  let liveView = null;
  let closing = null;
  try {
    if (state && sram) {
      session.loadSram(new Uint8Array(sram));
      session.loadState(new Uint8Array(state));
    } else {
      const bootFrames = Number.isSafeInteger(configuration.bootFrames)
        ? configuration.bootFrames
        : 600;
      for (let index = 0; index < bootFrames; index += 1) session.step([]);
    }
    const observer = createFireRedObserver({
      session,
      runtime: JSON.parse(runtimeText),
      world: JSON.parse(worldText),
      story: JSON.parse(storyText),
      storyWatch: configuration.storyWatch ?? {},
      runId: configuration.runId,
      observeRng: configuration.observeRng === true,
    });
    emulator = createAutonomousEmulator({
      session,
      emulationSpeed: configuration.emulationSpeed,
      presentationFramesPerSecond: configuration.presentationFramesPerSecond,
      videoFramesPerSecond: configuration.videoFramesPerSecond,
      controllerState: () => observer.captureControllerState(),
      actionObservation: () => observer.capture(),
      startPaused: configuration.startPaused === true,
    });
    const decisionFeed = createDecisionFeedBuffer();
    let status = decisionFeed.update(configuration.initialStatus ?? {});
    if (configuration.livePort !== null) {
      liveView = await createLiveViewServer({
        audioSource: session,
        ...createLiveViewBindings({ emulator, getStatus: () => status, viewOnly: configuration.viewOnly === true }),
        host: "127.0.0.1",
        port: configuration.livePort,
      });
    }
    const close = () => {
      if (closing) return closing;
      closing = (async () => {
        emulator.close();
        await liveView?.close();
        session.close();
      })();
      return closing;
    };
    const handle = createEmulatorRequestHandler({
      emulator,
      observer,
      session,
      setStatus(value) { status = decisionFeed.update(value); },
      close,
    });
    return { close, handle, identity: session.identity, liveView: liveView?.url ?? null };
  } catch (error) {
    emulator?.close();
    await liveView?.close().catch(() => {});
    session.close();
    throw error;
  }
}

if (!parentPort) throw new Error("autonomous emulator worker requires a parent port");

try {
  const runtime = await boot(workerData);
  parentPort.postMessage({
    type: "ready",
    identity: runtime.identity,
    liveView: runtime.liveView,
  });
  parentPort.on("message", async ({ id, method, value }) => {
    try {
      const result = await runtime.handle(method, value);
      parentPort.postMessage({ id, ok: true, value: result });
      if (method === "close") parentPort.close();
    } catch (error) {
      parentPort.postMessage({ id, ok: false, error: serializeError(error) });
    }
  });
} catch (error) {
  parentPort.postMessage({ type: "startup-error", error: serializeError(error) });
  parentPort.close();
}
