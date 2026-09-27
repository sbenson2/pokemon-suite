import { createServer } from "node:http";
import { constants as zlibConstants, createGzip } from "node:zlib";

const FRAME_HEADER_BYTES = 16;
const EMBEDDING_HEADERS = Object.freeze({
  "access-control-allow-origin": "*",
  "cross-origin-resource-policy": "cross-origin",
});

function validateFrame(frame) {
  if (
    !Number.isSafeInteger(frame?.width) || frame.width <= 0 || frame.width > 4096 ||
    !Number.isSafeInteger(frame?.height) || frame.height <= 0 || frame.height > 4096 ||
    !(frame.rgba instanceof Uint8Array) ||
    frame.rgba.byteLength !== frame.width * frame.height * 4
  ) throw new Error("emulator exposed an invalid video frame");
}

function framePacket(frame) {
  const packet = Buffer.allocUnsafe(FRAME_HEADER_BYTES + frame.rgba.byteLength);
  packet.write("MRF1", 0, 4, "ascii");
  packet.writeUInt16BE(frame.width, 4);
  packet.writeUInt16BE(frame.height, 6);
  packet.writeUInt32BE(frame.rgba.byteLength, 8);
  packet.writeUInt32BE(frame.sequence % 0x1_0000_0000, 12);
  Buffer.from(frame.rgba.buffer, frame.rgba.byteOffset, frame.rgba.byteLength)
    .copy(packet, FRAME_HEADER_BYTES);
  return packet;
}

function createFramePublisher({ session, framesPerSecond }) {
  if (!session || typeof session.videoFrame !== "function") {
    throw new TypeError("live feed requires an emulator framebuffer");
  }
  if (!Number.isFinite(framesPerSecond) || framesPerSecond <= 0 || framesPerSecond > 240) {
    throw new TypeError("live feed frame rate must be between 0 and 240");
  }
  let latest = null;
  let error = null;
  let fallbackSequence = 0;
  let publishedFrames = 0;
  const subscribers = new Set();
  const capture = () => {
    try {
      const value = session.videoFrame();
      validateFrame(value);
      fallbackSequence += 1;
      const sequence = Number.isSafeInteger(session.frame) && session.frame >= 0
        ? session.frame
        : fallbackSequence;
      latest = Object.freeze({
        width: value.width,
        height: value.height,
        sequence,
        rgba: Buffer.from(value.rgba),
      });
      error = null;
      publishedFrames += 1;
      for (const subscriber of subscribers) subscriber(latest);
    } catch (cause) {
      error = cause;
    }
  };
  capture();
  const timer = setInterval(capture, 1000 / framesPerSecond);
  timer.unref?.();
  return Object.freeze({
    latest: () => latest,
    error: () => error,
    metrics: () => Object.freeze({
      targetFramesPerSecond: framesPerSecond,
      publishedFrames,
      sourceFrame: latest?.sequence ?? null,
      subscribers: subscribers.size,
    }),
    subscribe(subscriber) {
      if (typeof subscriber !== "function") throw new TypeError("subscriber must be a function");
      subscribers.add(subscriber);
      if (latest) subscriber(latest);
      return () => subscribers.delete(subscriber);
    },
    close() {
      clearInterval(timer);
      subscribers.clear();
    },
  });
}

function sendJson(response, statusCode, value) {
  const body = Buffer.from(`${JSON.stringify(value)}\n`);
  response.writeHead(statusCode, {
    ...EMBEDDING_HEADERS,
    "cache-control": "no-store",
    "content-length": body.byteLength,
    "content-type": "application/json; charset=utf-8",
  });
  response.end(body);
}

export async function createLiveFeedServer({
  session,
  getStatus = () => ({}),
  host = "127.0.0.1",
  port,
  framesPerSecond = 60,
} = {}) {
  if (typeof getStatus !== "function") throw new TypeError("getStatus must be a function");
  if (!Number.isSafeInteger(port) || port < 0 || port > 65535) {
    throw new TypeError("live feed port must be an integer from 0 through 65535");
  }
  const publisher = createFramePublisher({ session, framesPerSecond });
  const packets = new WeakMap();
  const openStreams = new Set();
  const server = createServer((request, response) => {
    if (request.method === "OPTIONS") {
      response.writeHead(204, {
        ...EMBEDDING_HEADERS,
        "access-control-allow-methods": "GET, OPTIONS",
      });
      response.end();
      return;
    }
    const url = new URL(request.url ?? "/", `http://${host}:${port}`);
    if (request.method !== "GET") {
      sendJson(response, 405, { error: "method-not-allowed" });
      return;
    }
    if (url.pathname === "/health") {
      sendJson(response, 200, {
        ok: true,
        schema: "pokemon-research/live-feed/v1",
        stream: publisher.metrics(),
      });
      return;
    }
    if (url.pathname === "/status") {
      try { sendJson(response, 200, getStatus()); }
      catch (error) { sendJson(response, 503, { error: error.message }); }
      return;
    }
    if (url.pathname === "/frame") {
      const frame = publisher.latest();
      if (!frame) {
        sendJson(response, 503, { error: publisher.error()?.message ?? "frame-not-ready" });
        return;
      }
      response.writeHead(200, {
        ...EMBEDDING_HEADERS,
        "access-control-expose-headers": "x-frame-width, x-frame-height, x-frame-sequence",
        "cache-control": "no-store, no-transform",
        "content-length": frame.rgba.byteLength,
        "content-type": "application/octet-stream",
        "x-frame-width": frame.width,
        "x-frame-height": frame.height,
        "x-frame-sequence": frame.sequence,
      });
      response.end(frame.rgba);
      return;
    }
    if (url.pathname === "/stream") {
      response.socket?.setNoDelay(true);
      response.writeHead(200, {
        ...EMBEDDING_HEADERS,
        "cache-control": "no-store, no-transform",
        "content-encoding": "gzip",
        "content-type": "application/octet-stream",
        "x-accel-buffering": "no",
      });
      response.flushHeaders();
      const gzip = createGzip({ level: 1 });
      gzip.pipe(response);
      let closed = false;
      let unsubscribe = () => {};
      const cleanup = () => {
        if (closed) return;
        closed = true;
        openStreams.delete(cleanup);
        unsubscribe();
        gzip.destroy();
      };
      response.once("close", cleanup);
      response.once("error", cleanup);
      gzip.once("error", cleanup);
      openStreams.add(cleanup);
      unsubscribe = publisher.subscribe((frame) => {
        if (closed || gzip.destroyed) return;
        let packet = packets.get(frame);
        if (!packet) {
          packet = framePacket(frame);
          packets.set(frame, packet);
        }
        gzip.write(packet);
        gzip.flush(zlibConstants.Z_SYNC_FLUSH);
      });
      return;
    }
    sendJson(response, 404, { error: "not-found" });
  });

  try {
    await new Promise((resolve, reject) => {
      server.once("error", reject);
      server.listen(port, host, () => {
        server.off("error", reject);
        resolve();
      });
    });
  } catch (error) {
    publisher.close();
    throw error;
  }
  const address = server.address();
  const boundPort = typeof address === "object" && address ? address.port : port;
  let closing = null;
  return Object.freeze({
    host,
    port: boundPort,
    url: `http://${host}:${boundPort}/`,
    close() {
      if (closing) return closing;
      publisher.close();
      for (const cleanup of [...openStreams]) cleanup();
      closing = new Promise((resolve, reject) => {
        server.close((error) => error ? reject(error) : resolve());
      });
      return closing;
    },
  });
}

