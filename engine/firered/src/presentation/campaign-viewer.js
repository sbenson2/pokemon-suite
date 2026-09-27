import { createServer, request as httpRequest } from "node:http";
import { timingSafeEqual } from "node:crypto";
import { readFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { createCampaignStopReports } from "./campaign-stop-report.js";

export async function createCampaignViewer({ suiteDirectory, port = 17439, stopReportToken = null } = {}) {
  const root = resolve(suiteDirectory);
  const manifest = JSON.parse(await readFile(join(root, "suite.json"), "utf8"));
  const feeds = new Map(manifest.episodes.filter(e => Number.isInteger(e.livePort) && e.livePort >= 1024 && e.livePort <= 65535)
    .map(e => [e.id, e.livePort]));
  const [html, client] = await Promise.all([
    readFile(new URL("./campaign-viewer.html", import.meta.url)),
    readFile(new URL("./campaign-video-client.js", import.meta.url)),
  ]);
  const upstreams = new Set();
  const stopReports = stopReportToken ? await createCampaignStopReports({ suiteDirectory: root }) : null;
  const authorized = request => {
    const supplied = Buffer.from(String(request.headers["x-fleet-control-token"] ?? ""));
    const expected = Buffer.from(stopReportToken ?? "");
    return expected.length > 0 && supplied.length === expected.length && timingSafeEqual(supplied, expected);
  };
  const reply = (response, status, value, type = "application/json") => {
    const bytes = Buffer.isBuffer(value) ? value : Buffer.from(JSON.stringify(value));
    response.writeHead(status, { "content-type": type, "content-length": bytes.length,
      "access-control-allow-origin": "*",
      "cache-control": "no-store", "x-content-type-options": "nosniff" });
    response.end(bytes);
  };
  const server = createServer((request, response) => {
    void (async () => {
      const path = new URL(request.url, "http://127.0.0.1").pathname;
      if (path === "/api/stop-report" || path.startsWith("/api/stop-report/")) {
        if (!stopReports) return reply(response, 405, { error: "stop-report-disabled" });
        if (!authorized(request)) return reply(response, 401, { error: "unauthorized" });
        if (path === "/api/stop-report" && request.method === "POST") {
          let body = "";
          for await (const chunk of request) {
            body += chunk.toString();
            if (Buffer.byteLength(body) > 4096) return reply(response, 413, { error: "request-too-large" });
          }
          let value;
          try { value = JSON.parse(body); } catch { return reply(response, 400, { error: "invalid-json" }); }
          try { return reply(response, 202, await stopReports.start(value)); }
          catch (error) { return reply(response, 409, { error: error.message }); }
        }
        if (path.startsWith("/api/stop-report/") && request.method === "GET") {
          try { return reply(response, 200, await stopReports.get(path.slice("/api/stop-report/".length))); }
          catch (error) { return reply(response, 404, { error: error.code === "ENOENT" ? "request-not-found" : error.message }); }
        }
        return reply(response, 405, { error: "method-not-allowed" });
      }
      if (request.method !== "GET") return reply(response, 405, { error: "view-only" });
      if (path === "/") return reply(response, 200, html, "text/html; charset=utf-8");
      if (path === "/viewer.js") return reply(response, 200, client, "text/javascript; charset=utf-8");
      if (path === "/api/status") {
        const summary = JSON.parse(await readFile(join(root, "summary.json"), "utf8"));
        return reply(response, 200, { id: summary.id, updatedAt: summary.updatedAt,
          hostId: summary.plan?.hostId ?? null, control: summary.control ?? { mode: "run" },
          configuredSpeed: summary.emulationSpeed ?? manifest.emulationSpeed ?? 5,
          episodes: summary.episodes.map((e, index) => ({ id: e.id, number: index + 1, jobId: e.jobId ?? null,
            status: e.status, target: e.target,
            experiment: e.progress?.experiment ?? (e.experiment ? { config: e.experiment } : null),
            evidenceKind: e.progress?.evidenceKind ?? e.evidenceKind ?? "cold-campaign",
            sourceRunId: e.progress?.metadata?.sourceRunId ?? e.sourceRunId ?? null,
            untilTarget: e.progress?.metadata?.untilTarget ?? (manifest.budgets?.wallMs === null && e.kind !== "replay"),
            failureReason: e.supervisorStop ?? e.progress?.failure?.reason ?? null,
            performance: e.progress?.performance ?? null, lastProgressAt: e.progress?.lastProgressAt ?? null,
            updatedAt: e.progress?.updatedAt ?? null,
            wallSeconds: e.progress?.wallSeconds ?? e.progress?.performance?.wallSeconds ?? null,
            targetReached: e.progress?.targetReached === true,
            milestones: Object.fromEntries(["oakParcel", "brock", "hallOfFame", "baseline", "recovery"]
              .map(key => [key, Boolean(e.progress?.milestones?.[key])])),
            hasVideo: feeds.has(e.id), starter: e.progress?.metadata?.runProfile?.starter?.name ?? "STARTING",
            // Each long-lived feed needs its own origin; six same-origin streams
            // otherwise occupy Chromium's HTTP/1 connection pool and starve status/navigation.
            streamUrl: feeds.has(e.id) ? `http://127.0.0.1:${feeds.get(e.id)}/stream` : null,
            map: e.progress?.map ?? null, gameSeconds: e.progress?.gameSeconds ?? 0,
            badgeCount: e.progress?.badgeCount ?? 0, party: e.progress?.party ?? [],
            stopReason: e.supervisorStop ?? e.progress?.stopReason ?? null })) });
      }
      const match = /^\/feeds\/([a-zA-Z0-9._-]+)\/(stream|frame|status)$/.exec(path);
      if (!match || !feeds.has(match[1])) return reply(response, 404, { error: "not-found" });
      const upstream = httpRequest({ hostname: "127.0.0.1", port: feeds.get(match[1]), path: `/${match[2]}`, method: "GET" }, source => {
        response.writeHead(source.statusCode, { "content-type": source.headers["content-type"] ?? "application/octet-stream",
          "cache-control": "no-store", ...(source.headers["content-encoding"] ? { "content-encoding": source.headers["content-encoding"] } : {}),
          ...Object.fromEntries(Object.entries(source.headers).filter(([name]) => name.startsWith("x-frame-"))) });
        source.on("error", () => response.destroy());
        source.pipe(response);
      });
      upstreams.add(upstream);
      upstream.on("error", () => {
        if (!response.headersSent && !response.destroyed) reply(response, 503, { error: "feed-not-running" });
        else response.destroy();
      });
      upstream.on("close", () => upstreams.delete(upstream));
      response.on("close", () => upstream.destroy());
      upstream.end();
    })().catch(() => {
      if (!response.headersSent && !response.destroyed) reply(response, 503, { error: "suite-status-unavailable" });
      else response.destroy();
    });
  });
  await new Promise((resolveStarted, reject) => {
    server.once("error", reject);
    server.listen(port, "127.0.0.1", () => { server.off("error", reject); resolveStarted(); });
  });
  return { url: `http://127.0.0.1:${server.address().port}/`,
    async close() {
      for (const upstream of upstreams) upstream.destroy();
      server.closeAllConnections();
      await new Promise((resolveClosed, reject) => server.close(error => error ? reject(error) : resolveClosed()));
    } };
}
