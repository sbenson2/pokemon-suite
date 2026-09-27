// Replay bundles and anomaly detection for the Crystal player, mirroring
// master-red-research/src/player/diagnostics.js. Nobody watches the bot play:
// every anomaly, the first decision, a periodic sample and every stop capture
// the exact emulator state, native SRAM, framebuffer, full observation,
// decision and player state on one frame, so a run can be reloaded to that
// exact moment later. The journal additionally records the exact controller
// input of every decision as run-length-encoded button chords per frame.

import { createHash } from 'node:crypto';
import { chmodSync, mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { gzipSync } from 'node:zlib';

export const BUNDLE_SCHEMA = 'pokemon-research/crystal-replay-bundle/v1';
export const INPUT_TRACE_SCHEMA = 'pokemon-research/crystal-input-trace/v1';

const sha256 = (bytes) => createHash('sha256').update(bytes).digest('hex');

function safeToken(value) {
  const token = String(value ?? '').replaceAll(/[^a-zA-Z0-9._-]+/g, '-').replaceAll(/^-+|-+$/g, '');
  return token || 'unnamed';
}

function writePrivate(path, bytes) {
  writeFileSync(path, bytes, { mode: 0o600 });
  chmodSync(path, 0o600);
}

/** JSON with typed arrays encoded as base64 so observations round-trip exactly. */
export function serializeObservation(observation) {
  return JSON.stringify(observation, (key, value) => {
    if (value instanceof Uint8Array) {
      return { encoding: 'base64', byteLength: value.byteLength, bytes: Buffer.from(value.buffer, value.byteOffset, value.byteLength).toString('base64') };
    }
    return value;
  });
}

export function deserializeObservation(text) {
  return JSON.parse(text, (key, value) => {
    if (value && typeof value === 'object' && value.encoding === 'base64' && typeof value.bytes === 'string') {
      return new Uint8Array(Buffer.from(value.bytes, 'base64'));
    }
    return value;
  });
}

/**
 * A fine-grained signature of everything the player can react to. Two
 * consecutive decisions with the same signature mean the cartridge did not
 * move at all between them, including the drawn text.
 */
export function stableStateSignature(observation) {
  if (!observation) return null;
  const party = (observation.party ?? []).map((member) => [member.speciesId, member.level, member.hp, member.maxHp, member.statusByte ?? member.status]);
  const battle = observation.battle
    ? [observation.battle.mode, observation.battle.player?.speciesId, observation.battle.player?.hp, observation.battle.enemy?.speciesId, observation.battle.enemy?.hp, observation.battle.menuPosition]
    : null;
  const state = {
    map: observation.map, facing: observation.facing, scriptRunning: observation.scriptRunning,
    menu: observation.menu, battle, party,
    money: observation.trainer?.money, badges: observation.trainer?.badges,
    items: (observation.items ?? []).map((item) => [item.id, item.quantity]),
    balls: (observation.balls ?? []).map((item) => [item.id, item.quantity]),
    objects: (observation.objects ?? []).map((object) => [object.mapObjectIndex, object.x, object.y]),
    screen: observation.screen,
  };
  return sha256(Buffer.from(JSON.stringify(state)));
}

/** What a decision "is" for loop detection: same kind, reason, place and party. */
export function decisionCycleKey(decision) {
  return [decision.kind, decision.reason, decision.map, `${decision.position?.x},${decision.position?.y}`, decision.party].join('|');
}

/**
 * Detects a pattern of period p (minimumPeriod..maximumPeriod) repeated
 * `repeats` times at the tail of `keys`. Returns { period, pattern } or null.
 */
export function repeatedCycle(keys, { minimumPeriod = 2, maximumPeriod = 8, repeats = 4 } = {}) {
  for (let period = minimumPeriod; period <= maximumPeriod; period += 1) {
    const span = period * repeats;
    if (keys.length < span) break;
    const tail = keys.slice(-span);
    let matches = true;
    for (let index = period; index < span && matches; index += 1) {
      if (tail[index] !== tail[index - period]) matches = false;
    }
    // A constant sequence is the same decision repeated, which the stable-state
    // detector and the player's watchdog own; a cycle needs two different keys.
    if (matches && new Set(tail.slice(0, period)).size > 1) return { period, pattern: tail.slice(0, period) };
  }
  return null;
}

/** Rotation-invariant so the same loop seen one decision later shares its signature. */
export function cycleSignature(pattern) {
  const rotations = pattern.map((_, offset) => [...pattern.slice(offset), ...pattern.slice(0, offset)].join('\n'));
  rotations.sort();
  return sha256(Buffer.from(rotations[0])).slice(0, 16);
}

/**
 * Run-length encoded controller trace per decision. `note(sequence, buttons)`
 * is called once per emulated frame from the pacing loop; when the decision
 * sequence advances the finished trace is appended to the journal.
 */
export function createInputTrace({ journal, runId, maximumRuns = 600 } = {}) {
  let current = null;
  const flush = () => {
    if (!current) return null;
    const record = { type: 'inputs', schema: INPUT_TRACE_SCHEMA, runId, sequence: current.sequence, startFrame: current.startFrame, frames: current.frames, runs: current.runs, truncated: current.truncated };
    journal?.append(record);
    current = null;
    return record;
  };
  const note = (sequence, buttons, frame) => {
    if (!current || current.sequence !== sequence) {
      flush();
      current = { sequence, startFrame: frame ?? null, frames: 0, runs: [], truncated: false };
    }
    current.frames += 1;
    const chord = [...buttons].sort().join('+') || '-';
    const last = current.runs[current.runs.length - 1];
    if (last && last[0] === chord) {
      last[1] += 1;
    } else if (current.runs.length < maximumRuns) {
      current.runs.push([chord, 1]);
    } else {
      current.truncated = true;
    }
  };
  return Object.freeze({ note, flush, current: () => current });
}

export function createCrystalDiagnostics({
  session,
  observe,
  journal,
  runId,
  sessionId,
  periodicDecisions = 250,
  stableStateDecisions = 30,
  cycleCooldownDecisions = 60,
  anomalyCooldownDecisions = 20,
  maximumBundles = 400,
  onBundle = null,
  clock = () => new Date().toISOString(),
} = {}) {
  if (typeof session?.saveState !== 'function' || typeof session?.saveSram !== 'function' || typeof session?.videoFrame !== 'function') {
    throw new TypeError('diagnostics require emulator state, SRAM and framebuffer access');
  }
  if (typeof observe !== 'function') throw new TypeError('diagnostics require an observe function');
  if (!journal?.sessionDirectory) throw new TypeError('diagnostics require a run journal');
  const bundlesDirectory = join(journal.sessionDirectory, 'bundles');
  mkdirSync(bundlesDirectory, { recursive: true, mode: 0o700 });

  const bundles = [];
  const anomalies = [];
  const keys = [];
  const cycleSeenAt = new Map();
  const anomalySeenAt = new Map();
  let stable = { signature: null, count: 0, reportedAt: -1 };
  let lastSequence = 0;
  let skipped = 0;

  function writeBundle(reason, { observation = null, decision = null, playerState = null, anomaly = null, sequence = lastSequence } = {}) {
    if (bundles.length >= maximumBundles) {
      skipped += 1;
      journal.append({ type: 'bundle-skipped', runId, sequence, reason, maximumBundles, skipped });
      return null;
    }
    const current = observation ?? observe();
    const state = Buffer.from(session.saveState());
    const sram = Buffer.from(session.saveSram());
    const video = session.videoFrame();
    const frameBytes = Buffer.from(video.rgba.buffer, video.rgba.byteOffset, video.rgba.byteLength);
    const observationBytes = gzipSync(Buffer.from(serializeObservation(current)));
    const name = `${String(sequence).padStart(7, '0')}-${safeToken(reason)}`;
    const directory = join(bundlesDirectory, name);
    mkdirSync(directory, { recursive: true, mode: 0o700 });
    const manifest = {
      schema: BUNDLE_SCHEMA,
      runId, sessionId, sequence, reason,
      at: clock(),
      frame: Number.isSafeInteger(session.frame) ? session.frame : current.frame ?? null,
      observationFrame: current.frame ?? null,
      map: current.map ?? null,
      files: {
        'emulator.state': { sha256: sha256(state), byteLength: state.length },
        'cartridge.sav': { sha256: sha256(sram), byteLength: sram.length },
        'frame.rgba': { sha256: sha256(frameBytes), byteLength: frameBytes.length, width: video.width, height: video.height, format: 'rgba8888' },
        'observation.json.gz': { sha256: sha256(observationBytes), byteLength: observationBytes.length, schema: current.schema ?? null },
        'decision.json': { present: decision !== null },
        'player-state.json': { present: playerState !== null },
      },
      anomaly,
    };
    writePrivate(join(directory, 'emulator.state'), state);
    writePrivate(join(directory, 'cartridge.sav'), sram);
    writePrivate(join(directory, 'frame.rgba'), frameBytes);
    writePrivate(join(directory, 'frame.json'), `${JSON.stringify({ width: video.width, height: video.height, format: 'rgba8888', frame: manifest.frame })}\n`);
    writePrivate(join(directory, 'observation.json.gz'), observationBytes);
    writePrivate(join(directory, 'decision.json'), `${JSON.stringify(decision, null, 2)}\n`);
    writePrivate(join(directory, 'player-state.json'), `${JSON.stringify(playerState, null, 2)}\n`);
    writePrivate(join(directory, 'bundle.json'), `${JSON.stringify(manifest, null, 2)}\n`);
    const record = Object.freeze({ sequence, reason, frame: manifest.frame, directory, at: manifest.at, stateSha256: manifest.files['emulator.state'].sha256, sramSha256: manifest.files['cartridge.sav'].sha256, anomaly });
    bundles.push(record);
    journal.append({ type: 'bundle', runId, ...record });
    try { onBundle?.(record); } catch { /* the handoff writer must never break the player */ }
    return record;
  }

  function noteAnomaly(message, detail = {}, { observation = null, decision = null, playerState = null, sequence = lastSequence, kind = 'anomaly' } = {}) {
    const entry = { at: clock(), sequence, kind, message, ...detail };
    anomalies.push(entry);
    const key = `${kind}:${message}`.slice(0, 200);
    const seenAt = anomalySeenAt.get(key);
    let bundle = null;
    if (seenAt === undefined || sequence - seenAt >= anomalyCooldownDecisions) {
      anomalySeenAt.set(key, sequence);
      bundle = writeBundle(kind, { observation, decision, playerState, anomaly: entry, sequence });
    }
    return { entry, bundle };
  }

  function onDecision(decision, observation, playerState = null) {
    lastSequence = decision.sequence;
    const events = [];
    if (decision.sequence === 1) {
      events.push(writeBundle('first-decision', { observation, decision, playerState, sequence: decision.sequence }));
    } else if (periodicDecisions > 0 && decision.sequence % periodicDecisions === 0) {
      events.push(writeBundle('periodic', { observation, decision, playerState, sequence: decision.sequence }));
    }

    keys.push(decisionCycleKey(decision));
    if (keys.length > 64) keys.shift();
    const cycle = repeatedCycle(keys);
    // A loop that contains a battle is progress (experience, captures), not a stall:
    // the training ground repeats train → battle → dialog by design.
    const progressLoop = cycle && cycle.pattern.some((key) => key.startsWith('battle|'));
    if (cycle && !progressLoop) {
      const signature = cycleSignature(cycle.pattern);
      const seenAt = cycleSeenAt.get(signature);
      if (seenAt === undefined || decision.sequence - seenAt >= cycleCooldownDecisions) {
        cycleSeenAt.set(signature, decision.sequence);
        events.push(noteAnomaly(`decision cycle of period ${cycle.period} repeated 4 times`, { period: cycle.period, pattern: cycle.pattern, signature }, { observation, decision, playerState, sequence: decision.sequence, kind: 'decision-cycle' }));
      }
    }

    const signature = stableStateSignature(observation);
    if (signature !== null && signature === stable.signature) {
      stable.count += 1;
      if (stable.count >= stableStateDecisions && stable.reportedAt !== signature) {
        stable.reportedAt = signature;
        events.push(noteAnomaly(`cartridge state unchanged across ${stable.count} decisions`, { stableDecisions: stable.count, signature }, { observation, decision, playerState, sequence: decision.sequence, kind: 'stable-state' }));
      }
    } else {
      stable = { signature, count: 0, reportedAt: -1 };
    }
    return events.filter(Boolean);
  }

  function onStop(reason, { observation = null, decision = null, playerState = null } = {}) {
    return writeBundle(`stop-${safeToken(reason)}`, { observation, decision, playerState });
  }

  const latest = () => ({
    schema: BUNDLE_SCHEMA,
    bundlesDirectory,
    bundleCount: bundles.length,
    skippedBundles: skipped,
    latestBundle: bundles[bundles.length - 1] ?? null,
    latestAnomaly: anomalies[anomalies.length - 1] ?? null,
    recentAnomalies: anomalies.slice(-5),
    recentBundles: bundles.slice(-5).map(({ sequence, reason, frame, directory }) => ({ sequence, reason, frame, directory })),
  });

  return Object.freeze({
    bundlesDirectory,
    writeBundle,
    noteAnomaly,
    onDecision,
    onStop,
    latest,
    anomalies: () => anomalies.slice(),
    bundles: () => bundles.slice(),
  });
}
