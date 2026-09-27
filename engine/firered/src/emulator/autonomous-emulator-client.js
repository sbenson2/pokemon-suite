import { Worker } from "node:worker_threads";

function remoteError(value = {}) {
  const error = new Error(value.message ?? "autonomous emulator worker failed");
  error.name = value.name ?? "Error";
  if (value.code !== undefined) error.code = value.code;
  if (value.stack) error.stack = value.stack;
  return error;
}

export async function createAutonomousEmulatorClient(configuration, {
  workerUrl = new URL("./autonomous-emulator-worker.js", import.meta.url),
} = {}) {
  if (!configuration || typeof configuration !== "object") {
    throw new TypeError("autonomous emulator configuration is required");
  }
  const worker = new Worker(workerUrl, { workerData: configuration });
  const pending = new Map();
  let nextRequestId = 1;
  let ready = null;
  let closed = false;
  let closePromise = null;
  let workerFailure = null;
  let resolveReady;
  let rejectReady;
  const readyPromise = new Promise((resolve, reject) => {
    resolveReady = resolve;
    rejectReady = reject;
  });

  const rejectPending = (error) => {
    workerFailure = error;
    rejectReady(error);
    for (const request of pending.values()) request.reject(error);
    pending.clear();
  };

  worker.on("message", (message) => {
    if (message?.type === "ready") {
      ready = message;
      resolveReady(message);
      return;
    }
    if (message?.type === "startup-error") {
      rejectPending(remoteError(message.error));
      return;
    }
    const request = pending.get(message?.id);
    if (!request) return;
    pending.delete(message.id);
    if (message.ok) request.resolve(message.value);
    else request.reject(remoteError(message.error));
  });
  worker.once("error", rejectPending);
  worker.once("exit", (code) => {
    if (!closed) {
      rejectPending(new Error(`autonomous emulator worker exited with code ${code}`));
    }
  });

  await readyPromise;

  const request = (method, value = null) => {
    if (workerFailure) return Promise.reject(workerFailure);
    if (closed) return Promise.reject(new Error("autonomous emulator client is closed"));
    const id = nextRequestId;
    nextRequestId += 1;
    return new Promise((resolve, reject) => {
      pending.set(id, { resolve, reject });
      worker.postMessage({ id, method, value });
    });
  };

  return Object.freeze({
    identity: Object.freeze({ ...(ready.identity ?? {}) }),
    liveView: ready.liveView ?? null,
    observe: () => request("observe"),
    execute: (action) => request("execute", action),
    pause: (reason) => request("pause", reason),
    cancel: (reason) => request("cancel", reason),
    captureSnapshot: () => request("captureSnapshot"),
    metrics: () => request("metrics"),
    controlState: () => request("controlState"),
    takeControlHandoff: () => request("takeControlHandoff"),
    setStatus: (status) => request("setStatus", status),
    close() {
      if (closePromise) return closePromise;
      closePromise = (async () => {
        try {
          await request("close");
        } finally {
          closed = true;
          const error = new Error("autonomous emulator client closed");
          for (const pendingRequest of pending.values()) pendingRequest.reject(error);
          pending.clear();
          await worker.terminate();
        }
      })();
      return closePromise;
    },
  });
}
