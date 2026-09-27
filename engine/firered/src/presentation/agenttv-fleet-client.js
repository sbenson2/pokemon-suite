import { createFrameDecoder, fleetCanvasLayout } from "./campaign-video-client.js";

// Presentation only: no emulator, policy, save input, controller route or AI call.
export function startAgentTvFleet(canvas, origin = "http://127.0.0.1:17469") {
  if (!/^http:\/\/127\.0\.0\.1:\d+$/.test(origin)) throw new TypeError("fleet viewer must be loopback");
  canvas.width = 960; canvas.height = 600;
  const context = canvas.getContext("2d", { alpha: false });
  const feeds = new Map();
  let closed = false, status = null, statusAt = 0;
  const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));
  function connect(episode) {
    const surface = document.createElement("canvas");
    const feed = { surface, context: surface.getContext("2d", { alpha: false }), sequence: null, receivedAt: 0, abort: null, closed: false };
    void (async () => {
      while (!closed && !feed.closed) {
        try {
          if (!/^http:\/\/127\.0\.0\.1:\d+\/stream$/.test(episode.streamUrl)) throw new Error("invalid loopback feed");
          feed.abort = new AbortController();
          const response = await fetch(episode.streamUrl, { signal: feed.abort.signal, cache: "no-store" });
          if (!response.ok || !response.body) throw new Error("feed unavailable");
          const reader = response.body.getReader();
          const decoder = createFrameDecoder(frame => {
            surface.width = frame.width; surface.height = frame.height;
            feed.context.putImageData(new ImageData(new Uint8ClampedArray(frame.rgba), frame.width, frame.height), 0, 0);
            feed.sequence = frame.sequence; feed.receivedAt = Date.now();
          });
          try { while (!closed && !feed.closed) { const next = await reader.read(); if (next.done) break; decoder.push(next.value); } }
          finally { await reader.cancel().catch(() => {}); reader.releaseLock(); }
        } catch { /* Finished/disconnected sources are shown honestly as stale. */ }
        if (!closed && !feed.closed) await sleep(1000);
      }
    })();
    return feed;
  }
  const remove = feed => { feed.closed = true; feed.abort?.abort(); };
  const refresh = async () => {
    while (!closed) {
      try {
        const response = await fetch(`${origin}/api/status`, { cache: "no-store", signal: AbortSignal.timeout(4000) });
        if (!response.ok) throw new Error("queue unavailable");
        status = await response.json(); statusAt = Date.now();
        const active = status.episodes.filter(e => e.status === "running" && e.hasVideo).slice(0, 16);
        for (const [id, feed] of feeds) if (!active.some(e => e.id === id)) { remove(feed); feeds.delete(id); }
        for (const episode of active) if (!feeds.has(episode.id)) feeds.set(episode.id, connect(episode));
      } catch { /* Keep the last status, with a visible stale-data warning. */ }
      if (!closed) await sleep(2000);
    }
  };
  const text = (value, x, y, size = 14, color = "#b3c9c4", width = 936) => {
    context.font = `600 ${size}px monospace`; context.fillStyle = color; context.fillText(String(value), x, y, width);
  };
  const paint = () => {
    context.fillStyle = "#0c1115"; context.fillRect(0, 0, 960, 600);
    text("MASTER RED · VISIBLE TEST FLEET", 16, 29, 22, "#ff857c");
    const episodes = status?.episodes ?? [], counts = kind => episodes.filter(e => e.status === kind).length;
    text(statusAt && Date.now() - statusAt < 15000
      ? `${status.hostId ?? "MINI"} · ${counts("running")} running · ${counts("pending")} queued · ${counts("failed")} failed · ${status.control?.mode ?? "run"}`
      : "Waiting for current fleet status…", 16, 54);
    const active = episodes.filter(e => feeds.has(e.id)).slice(0, 16), cells = fleetCanvasLayout(active.length);
    context.imageSmoothingEnabled = false;
    active.forEach((episode, index) => {
      const cell = cells[index], feed = feeds.get(episode.id);
      context.fillStyle = "#14232a"; context.fillRect(cell.x, cell.y, cell.width, cell.height);
      text(episode.id, cell.x + 8, cell.y + 18, 11, "#d8ebe5", cell.width - 16);
      const screenHeight = Math.max(1, cell.height - 64), scale = Math.min((cell.width - 16) / 240, screenHeight / 160);
      if (feed.sequence !== null) context.drawImage(feed.surface, cell.x + (cell.width - 240 * scale) / 2, cell.y + 24, 240 * scale, 160 * scale);
      const rate = episode.performance?.observedFramesPerSecond;
      const live = Date.now() - feed.receivedAt < 3000;
      text(`${live ? "LIVE" : "WAITING"} · ${rate == null ? "measuring" : (rate / 59.7275).toFixed(1) + "×"} · ${episode.evidenceKind === "checkpoint-diagnostic" ? "diagnostic" : episode.target}`,
        cell.x + 8, cell.y + cell.height - 24, 11, live ? "#77e6b5" : "#ffc272", cell.width - 16);
      text((episode.map ?? "opening").replace(/^MAP_/, "").replaceAll("_", " "), cell.x + 8, cell.y + cell.height - 8, 10, "#b3c9c4", cell.width - 16);
    });
    if (!active.length) text("No active previews. Tests continue independently of AgentTV.", 70, 290, 17);
    canvas.dataset.liveFeeds = String([...feeds.values()].filter(f => Date.now() - f.receivedAt < 3000).length);
    canvas.dataset.sourceSequences = JSON.stringify([...feeds.values()].map(f => f.sequence));
  };
  const timer = setInterval(paint, 1000 / 30);
  paint(); void refresh();
  return { close() { closed = true; clearInterval(timer); for (const feed of feeds.values()) remove(feed); feeds.clear(); } };
}
