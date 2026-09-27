#!/usr/bin/env node
// Runs the autonomous Pokémon Emerald research player: verified cartridge,
// pinned mGBA core, wall-clock paced emulation, central delegator, live
// AgentTV feed on loopback, checkpoints, and a resumable journal.
import { randomUUID } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { createEmulationRunner } from '../../../shared/emulation-runner.js';
import { createLiveFeedServer } from '../../../shared/live-feed.js';
import { createDecisionFeedBuffer } from '../../../shared/decision-log.js';
import { createRunProfile } from '../player/run-profile.mjs';
import { createEmeraldRuntime } from '../player/runtime.mjs';
import { createPlayerStatus } from '../player/status.mjs';
import { writeCheckpoint, safeRunId } from '../player/checkpoint.mjs';
import { createJournal } from '../player/journal.mjs';

const projectRoot = fileURLToPath(new URL('../../../', import.meta.url));
const NATIVE_FPS = 59.7275;
const usage = `Usage:
  node games/emerald/cli/run-player.mjs --rom PATH [options]

Options:
  --rom PATH                 Pokémon Emerald (U) ROM (verified by SHA-1)
  --core PATH                Pinned mGBA-wasm core directory (default: vendor/mgba-wasm/dist/mgba)
  --run-id ID                Run identity (default: emerald-<uuid>)
  --seed N                   Ticket seed (default: derived from run id)
  --state PATH               Resume from a whole-emulator state file
  --sram PATH                Load native SRAM before the state
  --output PATH              Checkpoint/journal directory (default: private/emerald/player-runs)
  --live-port N              AgentTV loopback feed port (default: 17341)
  --no-live                  Disable the live feed
  --emulation-speed N        Cartridge speed multiplier 1-10 (default: 10)
  --max-decisions N          Stop gracefully after N decisions (default: 50000)
  --checkpoint-frames N      Cartridge frames between checkpoints (default: 36000)
  --max-frames N             Stop after N cartridge frames (default: unlimited)
  --linger                   Keep the feed alive after a graceful stop
  --dry-run                  Print the resolved plan and exit
  --help                     Show this help
`;

class UsageError extends Error {}

function integer(name, value, { minimum = 0, maximum = Number.MAX_SAFE_INTEGER } = {}) {
  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed) || parsed < minimum || parsed > maximum) throw new UsageError(`${name} must be an integer from ${minimum} to ${maximum}`);
  return parsed;
}

export function parseArguments(args) {
  const options = {};
  const values = new Set(['--rom', '--core', '--run-id', '--seed', '--state', '--sram', '--output', '--live-port', '--emulation-speed', '--max-decisions', '--checkpoint-frames', '--max-frames']);
  const flags = new Set(['--no-live', '--linger', '--dry-run']);
  for (let index = 0; index < args.length; index += 1) {
    const argument = args[index];
    if (argument === '--help') return { help: true };
    if (flags.has(argument)) { options[argument.slice(2).replaceAll('-', '_')] = true; continue; }
    if (!values.has(argument)) throw new UsageError(`unknown argument ${argument}`);
    const value = args[index + 1];
    if (value === undefined || value.startsWith('--')) throw new UsageError(`${argument} requires a value`);
    options[argument.slice(2).replaceAll('-', '_')] = value;
    index += 1;
  }
  if (!options.rom) throw new UsageError('--rom is required');
  options.rom = resolve(options.rom);
  options.core = resolve(options.core ?? `${projectRoot}vendor/mgba-wasm/dist/mgba`);
  options.output = resolve(options.output ?? `${projectRoot}private/emerald/player-runs`);
  options.run_id = safeRunId(options.run_id ?? `emerald-${randomUUID()}`);
  options.seed = options.seed === undefined ? Number.parseInt(options.run_id.replace(/[^0-9]/g, '').slice(-9) || '0', 10) : integer('--seed', options.seed, { maximum: 0xffffffff });
  options.live_port = integer('--live-port', options.live_port ?? '17341', { minimum: 1, maximum: 65535 });
  options.emulation_speed = integer('--emulation-speed', options.emulation_speed ?? '10', { minimum: 1, maximum: 10 });
  options.max_decisions = integer('--max-decisions', options.max_decisions ?? '50000', { minimum: 1 });
  options.checkpoint_frames = integer('--checkpoint-frames', options.checkpoint_frames ?? '36000', { minimum: 600 });
  options.max_frames = options.max_frames === undefined ? Number.POSITIVE_INFINITY : integer('--max-frames', options.max_frames, { minimum: 1 });
  if (options.state) options.state = resolve(options.state);
  if (options.sram) options.sram = resolve(options.sram);
  return options;
}

async function main() {
  const options = parseArguments(process.argv.slice(2));
  if (options.help) { process.stdout.write(usage); return; }
  const runProfile = createRunProfile({ runId: options.run_id, seed: options.seed });
  const plan = { schema: 'pokemon-research/emerald-player-plan/v1', runId: options.run_id, seed: options.seed, tickets: runProfile.tickets, gender: runProfile.gender, starter: runProfile.starter, rom: options.rom, core: options.core, state: options.state ?? null, output: options.output, livePort: options.no_live ? null : options.live_port, emulationSpeed: options.emulation_speed, maxDecisions: options.max_decisions };
  if (options.dry_run) { process.stdout.write(`${JSON.stringify(plan)}\n`); return; }
  process.stdout.write(`${JSON.stringify({ event: 'player-start', ...plan })}\n`);

  const stage = (name, extra = {}) => process.stdout.write(`${JSON.stringify({ event: 'boot-stage', stage: name, ...extra })}\n`);
  const sessionId = `${new Date().toISOString().replace(/[:.]/g, '-')}-${process.pid}`;
  const journal = createJournal({ outputDirectory: options.output, runId: options.run_id, sessionId });
  const feedBuffer = createDecisionFeedBuffer({ limit: 60 });
  let lastCheckpoint = null;
  let stopping = null;
  let runner = null;
  let keepAlive = null;
  let status = null;
  let publishedStatus = null;
  const startedAt = Date.now();
  let startFrame = 0;

  const runtime = await createEmeraldRuntime({
    romPath: options.rom, coreDirectory: options.core, tickets: runProfile.tickets,
    state: options.state ? await readFile(options.state) : null,
    sram: options.sram ? await readFile(options.sram) : null,
    onBootStage: stage,
    onDecision: ({ decision, observation, frame, decisions, lastResult }) => {
      journal.record({ frame, sequence: decision.sequence, advisor: decision.advisor, recommendation: decision.recommendation, action: decision.action, objective: decision.objective ?? null, map: observation.player?.map.id ?? null, position: observation.player?.position ?? null, mode: observation.emulator.mode, lastResult });
      refreshStatus(observation);
      if (decisions >= options.max_decisions) stop('max-decisions');
    },
  });
  const { session, story } = runtime;
  startFrame = session.frame;
  let lastCheckpointFrame = session.frame;

  const refreshStatus = (observation) => {
    const elapsed = Math.max(1, Date.now() - startedAt) / 1000;
    status = createPlayerStatus({ runId: options.run_id, runProfile, observation, decision: runtime.lastDecision, decisions: runtime.decisions, frame: session.frame, campaignStatus: observation ? story.status(observation) : null, emulation: { speed: options.emulation_speed, measuredSpeed: Number(((session.frame - startFrame) / elapsed / NATIVE_FPS).toFixed(2)), framesPerSecond: Number(((session.frame - startFrame) / elapsed).toFixed(1)), runner: runner?.metrics() ?? null }, diagnostics: { sessionId, journalPath: journal.journalPath, handoffPath: journal.handoffPath, latestPath: journal.latestPath, recordedDecisions: journal.recordedDecisions, checkpoint: lastCheckpoint ? { statePath: lastCheckpoint.statePath, frame: lastCheckpoint.frame } : null } });
    publishedStatus = feedBuffer.update(status);
  };
  refreshStatus(null);

  const getButtons = () => {
    if (stopping) return [];
    const buttons = runtime.stepButtons();
    if (session.frame - lastCheckpointFrame >= options.checkpoint_frames) { lastCheckpointFrame = session.frame; checkpoint('periodic').catch(error => process.stderr.write(`checkpoint failed: ${error.stack ?? error}\n`)); }
    if (session.frame >= options.max_frames) stop('max-frames');
    return buttons;
  };

  runner = createEmulationRunner({ session, emulatedFramesPerSecond: NATIVE_FPS * options.emulation_speed, getButtons, maximumBatchFrames: 120 });
  const feed = options.no_live ? null : await createLiveFeedServer({ session, getStatus: () => publishedStatus, port: options.live_port, framesPerSecond: 60 });

  const checkpoint = async (reason) => {
    const observation = runtime.lastObservation ?? runtime.observe();
    lastCheckpoint = await writeCheckpoint({ session, outputDirectory: options.output, runId: options.run_id, metadata: { reason, frame: session.frame, decisions: runtime.decisions, runProfile, campaign: story.status(observation), map: observation.player?.map.id ?? null, position: observation.player?.position ?? null, sessionId } });
    refreshStatus(observation);
    await journal.writeLatest(status, { checkpoint: lastCheckpoint, note: reason });
    process.stdout.write(`${JSON.stringify({ event: 'checkpoint', reason, frame: session.frame, decisions: runtime.decisions, statePath: lastCheckpoint.statePath, map: observation.player?.map.id ?? null })}\n`);
    return lastCheckpoint;
  };

  const stop = (reason) => {
    if (stopping) return stopping;
    stopping = (async () => {
      runner.stop();
      clearInterval(keepAlive);
      try { await checkpoint(reason); } catch (error) { process.stderr.write(`final checkpoint failed: ${error.stack ?? error}\n`); }
      await journal.flush();
      const finalFrame = session.frame;
      process.stdout.write(`${JSON.stringify({ event: 'player-stop', reason, frame: finalFrame, decisions: runtime.decisions })}\n`);
      if (!options.linger || reason === 'signal') { await feed?.close(); session.close(); process.exit(0); }
    })();
    return stopping;
  };
  process.once('SIGTERM', () => stop('signal'));
  process.once('SIGINT', () => stop('signal'));

  process.stdout.write(`${JSON.stringify({ event: 'player-live', feed: feed?.url ?? null, frame: session.frame })}\n`);
  await journal.writeLatest(status, { note: 'session start' });
  runner.start();
  keepAlive = setInterval(() => {}, 1 << 30); // the runner's timers are unref'd; hold the loop open until stop()
  const heartbeat = setInterval(() => {
    if (stopping) return;
    process.stdout.write(`${JSON.stringify({ event: 'heartbeat', frame: session.frame, decisions: runtime.decisions, measuredSpeed: status.emulation?.measuredSpeed ?? null, map: status.map, position: status.position, objective: status.campaign?.activeObjective?.id ?? null, winner: status.winner ? `${status.winner.advisor}:${status.winner.recommendation.kind}` : null })}\n`);
  }, 30_000);
  heartbeat.unref();
  await new Promise(() => {});
}

try {
  await main();
} catch (error) {
  process.stderr.write(`${error.stack ?? error.message}\n`);
  process.exitCode = error instanceof UsageError ? 64 : 1;
}
