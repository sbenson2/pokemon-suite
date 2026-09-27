#!/usr/bin/env node
// Supervised launcher for the Crystal player (LaunchAgent entry point). Before
// each launch it selects the newest digest-valid checkpoint for the run ID and
// forwards signals to the child so a SIGTERM produces a graceful checkpoint.

import { spawn } from 'node:child_process';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { findLatestCrystalCheckpoint } from '../player/checkpoint.mjs';

const projectRoot = fileURLToPath(new URL('../../..', import.meta.url));
const playerCli = fileURLToPath(new URL('./run-player.mjs', import.meta.url));

const usage = `Usage:
  node games/crystal/cli/run-player-service.mjs --run-id ID [options]

Options:
  --rom PATH --core PATH --seed N --output PATH --live-port N (default 17340)
  --emulation-speed N (default 10) --max-decisions N (default 50000)
  --checkpoint-interval S (default 120) --fresh-if-missing --dry-run --help
`;

class UsageError extends Error {}

function parseArguments(args) {
  const options = {};
  const values = new Set(['--rom', '--core', '--seed', '--output', '--run-id', '--live-port', '--emulation-speed', '--max-decisions', '--checkpoint-interval']);
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
  if (!options.run_id) throw new UsageError('--run-id is required');
  options.output = resolve(projectRoot, options.output ?? 'private/crystal/player-runs');
  return options;
}

async function launchPlan(options) {
  const checkpoint = await findLatestCrystalCheckpoint({ outputDirectory: options.output, runId: options.run_id });
  if (!checkpoint && !options.fresh_if_missing) throw new Error(`no valid checkpoint found for run ${options.run_id}`);
  const pass = (flag, key) => (options[key] !== undefined ? [flag, String(options[key])] : []);
  const args = [
    playerCli,
    '--run-id', options.run_id,
    ...pass('--rom', 'rom'), ...pass('--core', 'core'), ...pass('--seed', 'seed'),
    '--output', options.output,
    ...(checkpoint ? ['--state', checkpoint.stateFilePath, '--sram', checkpoint.sramFilePath] : ['--fresh-if-missing']),
    ...pass('--live-port', 'live_port'), ...pass('--emulation-speed', 'emulation_speed'),
    ...pass('--max-decisions', 'max_decisions'), ...pass('--checkpoint-interval', 'checkpoint_interval'),
  ];
  return {
    schema: 'pokemon-research/crystal-player-service-plan/v1',
    runId: options.run_id,
    fresh: !checkpoint,
    checkpoint: checkpoint ? { statePath: checkpoint.stateFilePath, sramPath: checkpoint.sramFilePath, writtenAt: checkpoint.writtenAt, sequence: checkpoint.playerState?.sequence ?? null, rejected: checkpoint.rejectedControlPaths } : null,
    executable: process.execPath,
    arguments: args,
  };
}

async function runChild(plan) {
  const child = spawn(plan.executable, plan.arguments, { cwd: projectRoot, stdio: 'inherit' });
  let forwarded = null;
  const forward = (signal) => { forwarded = signal; if (child.exitCode === null && child.signalCode === null) child.kill(signal); };
  const onInterrupt = () => forward('SIGINT');
  const onTerminate = () => forward('SIGTERM');
  process.once('SIGINT', onInterrupt);
  process.once('SIGTERM', onTerminate);
  const result = await new Promise((resolveFn, reject) => {
    child.once('error', reject);
    child.once('exit', (code, signal) => resolveFn({ code, signal }));
  }).finally(() => {
    process.removeListener('SIGINT', onInterrupt);
    process.removeListener('SIGTERM', onTerminate);
  });
  process.exitCode = Number.isInteger(result.code) ? result.code : forwarded ? 0 : 1;
}

async function main() {
  const options = parseArguments(process.argv.slice(2));
  if (options.help) { process.stdout.write(usage); return; }
  const plan = await launchPlan(options);
  if (options.dry_run) { process.stdout.write(`${JSON.stringify(plan)}\n`); return; }
  process.stdout.write(`${JSON.stringify({ event: 'player-service-launch', ...plan })}\n`);
  await runChild(plan);
}

try {
  await main();
} catch (error) {
  process.stderr.write(`${error.stack ?? error.message}\n`);
  process.exitCode = error instanceof UsageError ? 64 : 1;
}
