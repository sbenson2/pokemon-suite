#!/usr/bin/env node
// Supervisor for the Emerald player: resumes the newest checksum-valid
// checkpoint for a run identity, forwards signals, and exits with the child
// status so launchd KeepAlive can relaunch it.
import { spawn } from 'node:child_process';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { findLatestCheckpoint, safeRunId } from '../player/checkpoint.mjs';

const projectRoot = fileURLToPath(new URL('../../../', import.meta.url));
const playerCli = fileURLToPath(new URL('./run-player.mjs', import.meta.url));
const usage = `Usage:
  node games/emerald/cli/run-player-service.mjs --rom PATH --run-id ID [options]

Options:
  --core PATH          Pinned core directory (default: vendor/mgba-wasm/dist/mgba)
  --seed N             Ticket seed (default: derived from run id)
  --output PATH        Checkpoint directory (default: private/emerald/player-runs)
  --max-decisions N    Decisions between supervised restarts (default: 50000)
  --live-port N        AgentTV loopback port (default: 17341)
  --emulation-speed N  Cartridge speed 1-10 (default: 10)
  --checkpoint-frames N Frames between checkpoints (default: 36000)
  --fresh-if-missing   Start a new cartridge when the run has no checkpoint
  --dry-run            Print the launch plan without starting the player
`;

class UsageError extends Error {}

function parseArguments(args) {
  const options = {};
  const values = new Set(['--rom', '--core', '--seed', '--output', '--max-decisions', '--live-port', '--emulation-speed', '--run-id', '--checkpoint-frames']);
  const flags = new Set(['--fresh-if-missing', '--dry-run']);
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
  if (!options.rom || !options.run_id) throw new UsageError('--rom and --run-id are required');
  options.run_id = safeRunId(options.run_id);
  options.rom = resolve(options.rom);
  options.core = resolve(options.core ?? `${projectRoot}vendor/mgba-wasm/dist/mgba`);
  options.output = resolve(options.output ?? `${projectRoot}private/emerald/player-runs`);
  return options;
}

async function launchPlan(options) {
  const checkpoint = await findLatestCheckpoint({ outputDirectory: options.output, runId: options.run_id });
  if (!checkpoint && !options.fresh_if_missing) throw new Error(`no valid checkpoint found for run ${options.run_id}`);
  const args = [playerCli, '--rom', options.rom, '--core', options.core, '--output', options.output, '--run-id', options.run_id,
    ...(options.seed !== undefined ? ['--seed', String(options.seed)] : []),
    ...(checkpoint ? ['--state', checkpoint.stateFilePath, '--sram', checkpoint.sramFilePath] : []),
    '--live-port', String(options.live_port ?? 17341), '--emulation-speed', String(options.emulation_speed ?? 10),
    '--max-decisions', String(options.max_decisions ?? 50000), '--checkpoint-frames', String(options.checkpoint_frames ?? 36000)];
  return { schema: 'pokemon-research/emerald-player-service-plan/v1', runId: options.run_id, fresh: !checkpoint, checkpoint: checkpoint ? { statePath: checkpoint.stateFilePath, sramPath: checkpoint.sramFilePath, frame: checkpoint.frame, decisions: checkpoint.decisions, rejected: checkpoint.rejectedCheckpointPaths } : null, executable: process.execPath, arguments: args };
}

async function runChild(plan) {
  const child = spawn(plan.executable, plan.arguments, { cwd: projectRoot, stdio: 'inherit' });
  let forwarded = null;
  const forward = (signal) => { forwarded = signal; if (child.exitCode === null && child.signalCode === null) child.kill(signal); };
  const onInterrupt = () => forward('SIGINT');
  const onTerminate = () => forward('SIGTERM');
  process.once('SIGINT', onInterrupt);
  process.once('SIGTERM', onTerminate);
  const result = await new Promise((resolvePromise, reject) => { child.once('error', reject); child.once('exit', (code, signal) => resolvePromise({ code, signal })); })
    .finally(() => { process.removeListener('SIGINT', onInterrupt); process.removeListener('SIGTERM', onTerminate); });
  process.exitCode = Number.isInteger(result.code) ? result.code : forwarded ? 0 : 1;
}

try {
  const options = parseArguments(process.argv.slice(2));
  if (options.help) { process.stdout.write(usage); }
  else {
    const plan = await launchPlan(options);
    if (options.dry_run) process.stdout.write(`${JSON.stringify(plan)}\n`);
    else { process.stdout.write(`${JSON.stringify({ event: 'player-service-launch', ...plan })}\n`); await runChild(plan); }
  }
} catch (error) {
  process.stderr.write(`${error.stack ?? error.message}\n`);
  process.exitCode = error instanceof UsageError ? 64 : 1;
}
