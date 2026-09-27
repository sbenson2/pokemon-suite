// Crystal player runtime: boots the pinned core with the verified cartridge,
// resumes a checkpoint or performs the fresh opening, paces emulation at the
// configured speed, hosts the AgentTV live feed, journals every decision,
// and writes content-addressed checkpoints periodically and on shutdown.

import { readFileSync, unlinkSync } from 'node:fs';
import { resolve } from 'node:path';

import { readVerifiedCartridge } from '../../../shared/cartridge.js';
import { createPinnedMultiSystemSession } from '../../../shared/pinned-mgba.js';
import { createEmulationRunner } from '../../../shared/emulation-runner.js';
import { createLiveFeedServer } from '../../../shared/live-feed.js';
import { createDecisionFeedBuffer } from '../../../shared/decision-log.js';
import { sampleOpeningTickets } from '../../../shared/fair-choice.js';
import { CRYSTAL_REV1, choosePlayerGender, chooseStarter, runFreshCrystalOpening } from '../index.mjs';
import { loadCrystalKnowledge } from '../knowledge.mjs';
import { loadCrystalWorld } from '../world/source.mjs';
import { createCrystalObserver } from '../observer.mjs';
import { createCrystalPlayer, PlayerStallError } from './delegator.mjs';
import { createCrystalStatus } from './status.mjs';
import { createRunJournal, renderHandoff } from './journal.mjs';
import { pruneCrystalCheckpoints, writeCrystalCheckpoint } from './checkpoint.mjs';
import { createCrystalDiagnostics, createInputTrace } from './diagnostics.mjs';

export const CRYSTAL_FRAMES_PER_SECOND = 59.7275;

/** Deterministic byte source (mulberry32) so a seed reproduces the opening tickets. */
export function seededByteSource(seed) {
  let state = (Number(seed) >>> 0) || 0x9e3779b9;
  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let value = state;
    value = Math.imul(value ^ (value >>> 15), value | 1);
    value ^= value + Math.imul(value ^ (value >>> 7), value | 61);
    return ((value ^ (value >>> 14)) >>> 0) & 0xff;
  };
}

export function cartridgeProfile(romPath = CRYSTAL_REV1.rom.archivePath) {
  return Object.freeze({
    id: 'pokemon-crystal-rev1',
    path: romPath,
    member: CRYSTAL_REV1.rom.innerFile,
    bytes: CRYSTAL_REV1.rom.bytes,
    sha1: CRYSTAL_REV1.rom.sha1,
  });
}

export async function startCrystalRuntime({
  romPath = CRYSTAL_REV1.rom.archivePath,
  coreDirectory = 'vendor/mgba-wasm/dist/mgba',
  runId,
  seed = 1,
  outputDirectory = 'private/crystal/player-runs',
  livePort = 17340,
  emulationSpeed = 10,
  maxDecisions = 50_000,
  checkpoint = null,
  freshIfMissing = false,
  teamPlan = 'v1',
  checkpointIntervalMs = 120_000,
  checkpointsToKeep = 6,
  periodicBundleDecisions = 250,
  log = () => {},
} = {}) {
  if (!runId) throw new TypeError('runId is required');
  const startedAt = new Date().toISOString();
  const sessionId = startedAt.replace(/[:.]/g, '-');
  const output = resolve(outputDirectory);
  const cartridge = await readVerifiedCartridge(cartridgeProfile(romPath));
  const session = await createPinnedMultiSystemSession({ coreDirectory, cartridge, system: 'gbc' });
  const world = loadCrystalWorld();
  const knowledge = loadCrystalKnowledge();
  const observer = createCrystalObserver({ session, knowledge, runId });
  const journal = createRunJournal({ outputDirectory: output, runId, sessionId });
  const anomalies = [];
  const note = (record) => { journal.append(record); log(record); };
  // Replay bundles (exact state + SRAM + frame + observation + decision) on the
  // first decision, periodically, on every anomaly and on stop; the handoff
  // pointer is rewritten after each bundle so LATEST.json always names it.
  const diagnostics = createCrystalDiagnostics({
    session, observe: observer.observe, journal, runId, sessionId,
    periodicDecisions: periodicBundleDecisions,
    onBundle: (bundle) => { log({ type: 'bundle', runId, reason: bundle.reason, sequence: bundle.sequence, directory: bundle.directory }); writeHandoff(); },
  });
  const inputs = createInputTrace({ journal, runId });

  let runProfile;
  if (checkpoint) {
    session.loadSram(new Uint8Array(readFileSync(checkpoint.sramFilePath)));
    session.loadState(new Uint8Array(readFileSync(checkpoint.stateFilePath)));
    runProfile = checkpoint.playerState?.runProfile ?? { seed, resumed: true };
    note({ type: 'resume', runId, sessionId, stateFilePath: checkpoint.stateFilePath, stateSha256: checkpoint.stateSha256, frame: session.frame });
  } else if (freshIfMissing) {
    const tickets = sampleOpeningTickets(seededByteSource(seed));
    runProfile = { seed, tickets, gender: choosePlayerGender(tickets.genderTicket), starter: chooseStarter(tickets.starterTicket), playerName: 'default', cartridge: cartridge.identity, teamPlan };
    note({ type: 'fresh-boot', runId, sessionId, runProfile });
    const opening = runFreshCrystalOpening(session, { genderTicket: tickets.genderTicket, starterTicket: tickets.starterTicket });
    note({ type: 'opening-complete', runId, frames: opening.frames, starter: opening.starter, gender: opening.gender, state: opening.state.map });
  } else {
    session.close();
    throw new Error(`run ${runId} has no checkpoint and --fresh-if-missing was not given`);
  }

  const player = createCrystalPlayer({ world, knowledge, observer, journal, runId, runProfile, diagnostics });
  let generator = player.play();
  let restarts = 0;
  let stopping = null;
  let lastCheckpoint = null;
  let latestObservation = observer.observe();

  const emulation = () => ({ emulationSpeed, framesPerSecond: CRYSTAL_FRAMES_PER_SECOND * emulationSpeed, ...runner.metrics(), restarts });
  const buildStatus = () => {
    latestObservation = observer.observe();
    return createCrystalStatus({
      observation: latestObservation, world, runId, runProfile,
      decision: player.lastDecision(),
      campaign: player.campaignStatus(latestObservation),
      emulation: emulation(),
      startedAt,
    });
  };

  function writeHandoff(status = buildStatus()) {
    journal.writeHandoff({
      summary: renderHandoff({ runId, sessionId, status, campaign: player.campaignStatus(latestObservation), checkpoint: lastCheckpoint, anomalies, startedAt, observation: latestObservation, diagnostics: diagnostics.latest() }),
      latest: { checkpoint: lastCheckpoint, status: { decisions: status.decisions, map: status.map, position: status.position, mode: status.mode }, anomalies: anomalies.slice(-5), diagnostics: diagnostics.latest() },
    });
  }

  const writeCheckpoint = async (reason) => {
    const status = buildStatus();
    lastCheckpoint = await writeCrystalCheckpoint({
      session, outputDirectory: output, runId, status: { reason, decisions: status.decisions, map: status.map, position: status.position },
      playerState: { runProfile, sequence: player.sequence(), sessionId, reason },
    });
    const removed = await pruneCrystalCheckpoints({ outputDirectory: output, runId, keep: checkpointsToKeep, remove: async (path) => unlinkSync(path) });
    journal.append({ type: 'checkpoint', runId, reason, stateFilePath: lastCheckpoint.stateFilePath, stateSha256: lastCheckpoint.stateSha256, removed });
    writeHandoff(status);
    return lastCheckpoint;
  };

  const pump = () => {
    if (stopping) return [];
    try {
      const next = generator.next();
      if (next.done) {
        generator = player.play();
        return [];
      }
      if (player.sequence() >= maxDecisions) stop('max-decisions');
      const buttons = next.value ?? [];
      inputs.note(player.sequence(), buttons, session.frame);
      return buttons;
    } catch (error) {
      restarts += 1;
      const record = { type: 'anomaly', runId, at: new Date().toISOString(), message: `player loop failed: ${error.message}`, name: error.name, detail: error.detail ?? null, stack: error.stack, restarts };
      anomalies.push({ at: record.at, message: record.message });
      note(record);
      inputs.flush();
      if (!(error instanceof PlayerStallError)) {
        // Stalls already wrote their bundle inside the player before throwing.
        try { diagnostics.noteAnomaly(record.message, { name: error.name, detail: error.detail ?? null, restarts }, { playerState: player.playerState(), decision: player.lastDecision(), kind: 'loop-failure' }); }
        catch (bundleError) { note({ type: 'anomaly', runId, message: `replay bundle failed: ${bundleError.message}` }); }
      }
      if (error instanceof PlayerStallError && restarts > 12) {
        stop('stalled');
        return [];
      }
      player.resetWatchdog();
      generator = player.play();
      return [];
    }
  };

  const runner = createEmulationRunner({ session, emulatedFramesPerSecond: CRYSTAL_FRAMES_PER_SECOND * emulationSpeed, getButtons: pump });
  const decisionFeed = createDecisionFeedBuffer({ limit: 80 });
  const liveFeed = livePort === null ? null : await createLiveFeedServer({
    session, port: livePort, host: '127.0.0.1', framesPerSecond: 60,
    getStatus: () => decisionFeed.update(buildStatus()),
  });
  await writeCheckpoint('session-start');
  runner.start();
  note({ type: 'running', runId, sessionId, livePort, liveFeed: liveFeed?.url ?? null, emulationSpeed, maxDecisions, checkpointIntervalMs });

  const checkpointTimer = setInterval(() => { writeCheckpoint('periodic').catch((error) => note({ type: 'anomaly', runId, message: `checkpoint failed: ${error.message}` })); }, checkpointIntervalMs);
  checkpointTimer.unref?.();

  let resolveExit;
  const exit = new Promise((resolveFn) => { resolveExit = resolveFn; });
  function stop(reason) {
    if (stopping) return stopping;
    stopping = (async () => {
      runner.stop();
      clearInterval(checkpointTimer);
      inputs.flush();
      try { diagnostics.onStop(reason, { playerState: player.playerState(), decision: player.lastDecision() }); }
      catch (error) { note({ type: 'anomaly', runId, message: `stop bundle failed: ${error.message}` }); }
      try { await writeCheckpoint(`stop:${reason}`); } catch (error) { note({ type: 'anomaly', runId, message: `final checkpoint failed: ${error.message}` }); }
      note({ type: 'stopped', runId, reason, decisions: player.sequence(), frame: session.frame });
      await liveFeed?.close().catch(() => {});
      session.close();
      resolveExit({ reason, decisions: player.sequence(), checkpoint: lastCheckpoint });
    })();
    return stopping;
  }

  return Object.freeze({
    runId, sessionId, startedAt, runProfile,
    liveFeedUrl: liveFeed?.url ?? null,
    journalPath: journal.journalPath,
    bundlesDirectory: diagnostics.bundlesDirectory,
    diagnostics: diagnostics.latest,
    stop,
    exit,
    status: buildStatus,
    checkpoint: writeCheckpoint,
  });
}
