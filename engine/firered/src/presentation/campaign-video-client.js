export function createFrameDecoder(onFrame) {
  let buffered = new Uint8Array(0);
  return { push(chunk) {
    const bytes = new Uint8Array(buffered.length + chunk.length);
    bytes.set(buffered); bytes.set(chunk, buffered.length);
    let offset = 0;
    while (bytes.length - offset >= 16) {
      const view = new DataView(bytes.buffer, offset);
      const width = view.getUint16(4), height = view.getUint16(6), length = view.getUint32(8);
      if (view.getUint32(0) !== 0x4d524631 || width < 1 || height < 1 || width > 240 || height > 160 || length !== width * height * 4) {
        throw new Error("invalid frame packet");
      }
      if (bytes.length - offset < 16 + length) break;
      onFrame({ width, height, sequence: view.getUint32(12), rgba: bytes.slice(offset + 16, offset + 16 + length) });
      offset += 16 + length;
    }
    buffered = bytes.slice(offset);
  } };
}

export function visibleCampaignEpisodes(episodes) {
  return episodes.filter(episode => episode.status === "running" && episode.hasVideo);
}

export function campaignTestDetails(episode) {
  const milestones = episode.milestones ?? {};
  const statusLabel = { running: "Running", pending: "Queued", passed: "Target reached · review required",
    failed: "Stopped / failed", interrupted: "Interrupted" }[episode.status] ?? "Status unknown";
  let purpose, progressLabel, milestoneLabel, progressValue, progressMax;
  const continued = episode.evidenceKind === "continued-campaign";
  if (episode.target === "training-window") {
    const experiment = episode.experiment ?? {};
    purpose = experiment.config?.purpose ?? "Matched training-efficiency checkpoint experiment; not campaign qualification.";
    progressValue = experiment.nativeFrames ?? 0; progressMax = experiment.windowFrames ?? experiment.config?.windowFrames ?? 1;
    progressLabel = `${experiment.totalExperienceGained ?? 0} XP gained · ${Math.round(experiment.experiencePerNativeMinute ?? 0)} XP/native minute`;
    milestoneLabel = `${experiment.battleCount ?? 0} battles · ${experiment.faintEvents ?? 0} faints · ${experiment.mapChanges ?? 0} map changes`;
  } else if (episode.target === "underlevel-hall-of-fame") {
    const experiment = episode.experiment ?? {};
    purpose = experiment.config?.purpose ?? "Every major boss with an under-level team. Forced opening rival is an explicit exception.";
    const wins = new Set((experiment.bosses ?? []).filter(x => x.underlevel && x.outcome === "won").map(x => x.objectiveId));
    progressValue = wins.size; progressMax = wins.size + (experiment.missingBosses?.length ?? 21);
    progressLabel = `${progressValue}/${progressMax} under-level boss wins verified`;
    milestoneLabel = `${experiment.capViolations ?? 0} cap violations · ${experiment.losses ?? 0} losses · opening tutorial excluded`;
  } else if (episode.target === "hall-of-fame") {
    purpose = continued
      ? "Continued campaign: test story navigation, team training and healing from a preserved checkpoint to the Hall of Fame. Not a fresh-start qualification."
      : "Full campaign: test story navigation, team training and healing from a new game to the Hall of Fame.";
    progressValue = Math.max(0, Math.min(8, Number(episode.badgeCount) || 0)); progressMax = 8;
    progressLabel = `${progressValue}/8 badges · ${milestones.hallOfFame ? "Hall of Fame confirmed" : "League not yet confirmed"}`;
    milestoneLabel = [milestones.oakParcel && "Parcel delivered", milestones.brock && "Brock defeated",
      milestones.hallOfFame && "Hall of Fame recorded"].filter(Boolean).join(" · ");
  } else if (episode.target === "brock") {
    purpose = continued ? "Continued opening check: reach the first Gym goal from a preserved checkpoint. Not a fresh-start qualification."
      : "Opening check: test starter selection, Oak's Parcel and the first Gym from a new game.";
    progressValue = Number(Boolean(milestones.oakParcel)) + Number(Boolean(milestones.brock)); progressMax = 2;
    progressLabel = `${progressValue}/2 opening milestones`;
    milestoneLabel = `${milestones.oakParcel ? "Parcel delivered" : "Parcel pending"} · ${milestones.brock ? "Brock defeated" : "Brock pending"}`;
  } else if (episode.target === "party-restored") {
    purpose = "Recovery diagnostic: fully heal the same injured team from a checkpoint, without substitutions. Not a fresh campaign.";
    progressValue = Number(Boolean(milestones.baseline)) + Number(Boolean(milestones.recovery)); progressMax = 2;
    progressLabel = milestones.recovery ? "Original team fully restored" : milestones.baseline ? "Injured team confirmed · healing pending" : "Checking the starting team";
    milestoneLabel = "Checkpoint diagnostic only";
  } else {
    purpose = `Declared test goal: ${String(episode.target ?? "unknown").replaceAll("-", " ")}.`;
    progressLabel = "Waiting for target-specific evidence"; progressValue = null; progressMax = 1;
  }
  if (episode.status === "pending") { progressLabel = "Waiting to start"; progressValue = null; milestoneLabel = "No observations yet"; }
  const reason = episode.failureReason ?? episode.stopReason;
  const stopLabel = reason && reason !== "target-reached"
    ? reason.replaceAll("-", " ").replace(/^./, letter => letter.toUpperCase()) : "";
  return { purpose, statusLabel, progressLabel, milestoneLabel: milestoneLabel || "No confirmed milestones yet",
    progressValue, progressMax, stopLabel };
}

export function fleetCanvasLayout(count) {
  if (!Number.isInteger(count) || count < 0 || count > 16) throw new TypeError("invalid visible fleet size");
  const columns = count <= 1 ? 1 : count <= 4 ? 2 : count <= 9 ? 3 : 4;
  const rows = Math.max(1, Math.ceil(count / columns)), gap = 12;
  const width = (960 - gap * (columns + 1)) / columns;
  const height = (530 - gap * (rows + 1)) / rows;
  return Array.from({ length: count }, (_, index) => ({ x: gap + (index % columns) * (width + gap),
    y: 70 + gap + Math.floor(index / columns) * (height + gap), width, height }));
}

if (typeof document !== "undefined" && document.querySelector("#games")) {
  const grid = document.querySelector("#games");
  const cards = new Map();
  const testRows = new Map();
  const delay = ms => new Promise(resolve => setTimeout(resolve, ms));
  const time = seconds => {
    if (seconds == null || !Number.isFinite(seconds)) return "—";
    seconds = Math.max(0, Math.floor(seconds));
    return `${Math.floor(seconds / 3600)}:${String(Math.floor(seconds / 60) % 60).padStart(2,"0")}:${String(seconds % 60).padStart(2,"0")}`;
  };
  const location = value => value ? value.replace(/^MAP_/, "").replaceAll("_", " ") : "OPENING SEQUENCE";
  const testName = episode => `TEST ${String(episode.number ?? "?").padStart(2, "0")} · ${episode.starter}`;

  function updateTests(episodes) {
    const list = document.querySelector("#test-list");
    for (const [id, node] of testRows) if (!episodes.some(e => e.id === id)) { node.remove(); testRows.delete(id); }
    for (const episode of episodes) {
      if (!testRows.has(episode.id)) {
        const node = document.querySelector("#test-template").content.firstElementChild.cloneNode(true);
        node.dataset.testId = episode.id;
        list.append(node); testRows.set(episode.id, node);
      }
      const node = testRows.get(episode.id), details = campaignTestDetails(episode);
      node.dataset.status = episode.status;
      node.querySelector(".test-name").textContent = testName(episode);
      node.querySelector(".test-id").textContent = episode.jobId ?? episode.id;
      node.querySelector(".test-status").textContent = details.statusLabel;
      node.querySelector(".test-purpose").textContent = details.purpose;
      node.querySelector(".test-progress-label").textContent = details.progressLabel;
      const progress = node.querySelector("progress");
      progress.hidden = details.progressValue === null;
      progress.max = details.progressMax; progress.value = details.progressValue ?? 0;
      progress.setAttribute("aria-label", `${testName(episode)}: ${details.progressLabel}`);
      node.querySelector(".test-milestones").textContent = details.milestoneLabel;
      node.querySelector(".test-map").textContent = episode.status === "pending" ? "Not started" : location(episode.map);
      node.querySelector(".test-time").textContent = episode.status === "pending" ? "" : `Game ${time(episode.gameSeconds)} · Wall ${time(episode.wallSeconds)}`;
      const updatedAt = Date.parse(episode.updatedAt), age = Math.max(0, Math.floor((Date.now() - updatedAt) / 1000));
      node.querySelector(".test-update").textContent = episode.status === "running"
        ? Number.isFinite(updatedAt) ? `Last game report ${age < 60 ? `${age}s` : `${Math.floor(age / 60)}m`} ago` : "Waiting for first game report"
        : episode.status === "pending" ? "Starts when a test slot opens" : "Final result saved";
      node.querySelector(".test-stop").textContent = details.stopLabel;
      node.querySelector(".test-stop").hidden = !details.stopLabel;
    }
  }

  function createCard(episode) {
    const node = document.querySelector("#game-template").content.firstElementChild.cloneNode(true);
    node.dataset.runId = episode.id;
    const canvas = node.querySelector("canvas"), context = canvas.getContext("2d", { alpha: false });
    const connection = node.querySelector(".connection");
    let closed = false, abort = null, pending = null, lastFrameAt = 0, animation;
    const paint = () => {
      if (closed) return;
      if (pending) {
        canvas.width = pending.width; canvas.height = pending.height;
        context.putImageData(new ImageData(new Uint8ClampedArray(pending.rgba), pending.width, pending.height), 0, 0);
        canvas.dataset.sequence = String(pending.sequence);
        pending = null;
        node.querySelector(".waiting").hidden = true;
      }
      connection.textContent = Date.now() - lastFrameAt < 3000 ? "● LIVE" : "CONNECTING";
      animation = requestAnimationFrame(paint);
    };
    const stream = async () => {
      while (!closed) {
        if (document.hidden) { await delay(500); continue; }
        try {
          abort = new AbortController();
          const response = await fetch(episode.streamUrl ?? `/feeds/${encodeURIComponent(episode.id)}/stream`, { signal: abort.signal, cache: "no-store" });
          if (!response.ok || !response.body) throw new Error("feed unavailable");
          const reader = response.body.getReader();
          const decoder = createFrameDecoder(frame => { pending = frame; lastFrameAt = Date.now(); });
          try { while (!closed) { const next = await reader.read(); if (next.done) break; decoder.push(next.value); } }
          finally { await reader.cancel().catch(() => {}); reader.releaseLock(); }
        } catch { /* New episodes take a moment to publish their feed. */ }
        if (!closed) await delay(1000);
      }
    };
    const onVisibility = () => { if (document.hidden) abort?.abort(); };
    document.addEventListener("visibilitychange", onVisibility);
    grid.append(node); animation = requestAnimationFrame(paint); void stream();
    return { node, update(e) {
      node.querySelector(".title").textContent = testName(e);
      node.querySelector(".target").textContent = `${e.evidenceKind === "checkpoint-diagnostic" ? "DIAGNOSTIC · " : "CAMPAIGN · "}${e.target.replaceAll("-", " ").toUpperCase()}`;
      node.querySelector(".location").textContent = location(e.map);
      node.querySelector(".clock").textContent = time(e.gameSeconds);
      node.querySelector(".party").textContent = e.party.length ? e.party.map(p => `Lv ${p.level}`).join(" · ") : "Choosing a starter…";
      node.querySelector(".badges").textContent = `${e.badgeCount}/8 badges`;
      const fps = e.performance?.observedFramesPerSecond;
      node.querySelector(".throughput").textContent = fps == null ? "Measuring throughput…" : `${(fps / 59.7275).toFixed(1)}× observed · ${e.performance.staleActions ?? 0} stale inputs rejected`;
      node.querySelector(".stop-reason").textContent = e.stopReason ? e.stopReason.replaceAll("-", " ") : "";
    }, stop() { closed = true; abort?.abort(); cancelAnimationFrame(animation); document.removeEventListener("visibilitychange", onVisibility); },
    remove() { this.stop(); node.remove(); } };
  }

  async function refresh() {
    try {
      const response = await fetch("/api/status", { cache: "no-store" });
      if (!response.ok) throw new Error("waiting for queue");
      const summary = await response.json();
      const counts = status => summary.episodes.filter(e => e.status === status).length;
      document.querySelector("#summary").textContent = `${counts("running")} running · ${counts("pending")} queued · ${counts("passed")} targets reached (review required) · ${counts("failed")} stopped/failed${summary.control?.mode === "drain" ? " · DRAINING — no new games" : ""}`;
      document.querySelector("#suite").textContent = `${summary.hostId ?? "LOCAL"} · ${summary.id} · target ${summary.configuredSpeed}×`;
      updateTests(summary.episodes);
      document.querySelector("#tracker-freshness").textContent = "Refreshes every 2s · game reports about every 5s";
      const visible = visibleCampaignEpisodes(summary.episodes);
      for (const [id, card] of cards) if (!visible.some(e => e.id === id)) { card.remove(); cards.delete(id); }
      for (const episode of visible) {
        if (!cards.has(episode.id)) cards.set(episode.id, createCard(episode));
        const card = cards.get(episode.id); card.update(episode);
      }
      document.querySelector("#empty").hidden = visible.length > 0;
      document.querySelector("#empty").textContent = counts("running") || counts("pending")
        ? "Waiting for games to start…" : "No active games. Finished previews closed; results saved.";
    } catch {
      document.querySelector("#summary").textContent = "Waiting for the campaign queue…";
      document.querySelector("#tracker-freshness").textContent = "Connection unavailable · showing the last received reports";
    }
    setTimeout(refresh, 2000);
  }
  void refresh();
}
