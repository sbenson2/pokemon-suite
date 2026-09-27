#!/usr/bin/env node
// Runs the Crystal research player as one process: verified cartridge, pinned
// core, checkpoint resume or fresh opening, paced emulation, AgentTV feed.

import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { CRYSTAL_REV1 } from '../index.mjs';
import { startCrystalRuntime } from '../player/runtime.mjs';

const projectRoot = fileURLToPath(new URL('../../..', import.meta.url));

const usage = `Usage:
  node games/crystal/cli/run-player.mjs --run-id ID [options]

Options:
  --rom PATH              Crystal Rev 1 ZIP (default: pinned profile path)
  --core PATH             pinned mGBA core directory (default: vendor/mgba-wasm/dist/mgba)
  --seed N                opening ticket seed (default: 1)
  --output PATH           checkpoint directory (default: private/crystal/player-runs)
  --state PATH --sram PATH  resume from this checkpoint pair
  --fresh-if-missing      perform the fresh opening when no checkpoint is given
  --team-plan v1|v2       team plan for a fresh run (default: v1; v2 = scorer pick, docs/CRYSTAL-TEAM-SCORE.md)
  --live-port N           AgentTV loopback port (default: 17340)
  --no-live               disable the live feed
  --emulation-speed N     1..10 (default: 10)
  --max-decisions N       exit 0 after this many decisions (default: 50000)
  --checkpoint-interval S seconds between periodic checkpoints (default: 120)
  --help
`;

class UsageError extends Error {}

function parseArguments(args) {
  const options = { live: true };
  const values = new Set(['--rom', '--core', '--seed', '--output', '--state', '--sram', '--run-id', '--live-port', '--emulation-speed', '--max-decisions', '--checkpoint-interval', '--team-plan']);
  const flags = new Set(['--fresh-if-missing', '--no-live']);
  for (let index = 0; index < args.length; index += 1) {
    const argument = args[index];
    if (argument === '--help') return { help: true };
    if (flags.has(argument)) {
      if (argument === '--no-live') options.live = false;
      else options[argument.slice(2).replaceAll('-', '_')] = true;
      continue;
    }
    if (!values.has(argument)) throw new UsageError(`unknown argument ${argument}`);
    const value = args[index + 1];
    if (value === undefined || value.startsWith('--')) throw new UsageError(`${argument} requires a value`);
    options[argument.slice(2).replaceAll('-', '_')] = value;
    index += 1;
  }
  if (!options.run_id) throw new UsageError('--run-id is required');
  if ((options.state && !options.sram) || (!options.state && options.sram)) throw new UsageError('--state and --sram must be given together');
  const integer = (name, value, minimum, maximum) => {
    const parsed = Number(value);
    if (!Number.isSafeInteger(parsed) || parsed < minimum || parsed > maximum) throw new UsageError(`${name} must be an integer from ${minimum} to ${maximum}`);
    return parsed;
  };
  return {
    runId: options.run_id,
    romPath: options.rom ?? CRYSTAL_REV1.rom.archivePath,
    coreDirectory: resolve(projectRoot, options.core ?? 'vendor/mgba-wasm/dist/mgba'),
    seed: integer('--seed', options.seed ?? '1', 0, 0xffffffff),
    outputDirectory: resolve(projectRoot, options.output ?? 'private/crystal/player-runs'),
    checkpoint: options.state ? { stateFilePath: resolve(options.state), sramFilePath: resolve(options.sram), stateSha256: 'cli', playerState: {} } : null,
    freshIfMissing: options.fresh_if_missing === true,
    teamPlan: (() => { const value = options.team_plan ?? 'v1'; if (!['v1', 'v2'].includes(value)) throw new UsageError('--team-plan must be v1 or v2'); return value; })(),
    livePort: options.live ? integer('--live-port', options.live_port ?? '17340', 1, 65535) : null,
    emulationSpeed: integer('--emulation-speed', options.emulation_speed ?? '10', 1, 10),
    maxDecisions: integer('--max-decisions', options.max_decisions ?? '50000', 1, Number.MAX_SAFE_INTEGER),
    checkpointIntervalMs: integer('--checkpoint-interval', options.checkpoint_interval ?? '120', 5, 86_400) * 1000,
  };
}

async function main() {
  const options = parseArguments(process.argv.slice(2));
  if (options.help) {
    process.stdout.write(usage);
    return;
  }
  const emit = (record) => process.stdout.write(`${JSON.stringify(record)}\n`);
  const runtime = await startCrystalRuntime({ ...options, log: emit });
  emit({ event: 'player-started', runId: runtime.runId, sessionId: runtime.sessionId, liveFeed: runtime.liveFeedUrl, journal: runtime.journalPath, runProfile: runtime.runProfile });
  const onSignal = (signal) => { emit({ event: 'signal', signal }); runtime.stop(`signal:${signal}`); };
  process.once('SIGINT', () => onSignal('SIGINT'));
  process.once('SIGTERM', () => onSignal('SIGTERM'));
  const result = await runtime.exit;
  emit({ event: 'player-exited', ...result });
  process.exitCode = result.reason === 'stalled' ? 2 : 0;
}

try {
  await main();
} catch (error) {
  process.stderr.write(`${error.stack ?? error.message}\n`);
  process.exitCode = error instanceof UsageError ? 64 : 1;
}
