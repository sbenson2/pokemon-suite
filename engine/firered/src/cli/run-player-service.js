#!/usr/bin/env node

import { spawn } from "node:child_process";
import { readdir } from "node:fs/promises";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { findLatestPlayerCheckpoint } from "../player/checkpoint.js";
import { createRosterPlanForRun, resolveRosterRunSeed, validateRosterOptions, validateRosterResume } from "../player/roster-selection.js";
import { normalizeTeamSeed } from "../player/roster-generator.js";
import { createRunProfile } from "../player/run-profile.js";

const projectRoot = fileURLToPath(new URL("../..", import.meta.url));
const playerCli = fileURLToPath(new URL("./run-player.js", import.meta.url));

const usage = `Usage:
  node src/cli/run-player-service.js --rom PATH --core PATH --run-id ID --seed N [options]

Required:
  --rom PATH
  --core PATH
  --run-id ID
  --seed N

Options:
  --output PATH       Checkpoint directory (default: private/player-runs)
  --max-decisions N   Decisions between supervised restarts (default: 50000)
  --live-port N       AgentTV loopback port (default: 17339)
  --emulation-speed N Autonomous cartridge speed (default: 5)
  --fresh-if-missing  Start a new cartridge save when this run has no checkpoint
  --roster-mode coherent|origins|fixed
                      New-run policy; omitted on resume restores the committed roster
  --team-seed TOKEN   uint32 or hex: plus 64 hex digits; cannot change on resume
  --dry-run           Print the resolved launch plan without starting the player
  --help              Show this help
`;

class UsageError extends Error {}

function integer(name, value, { minimum = 0, maximum = Number.MAX_SAFE_INTEGER } = {}) {
  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed) || parsed < minimum || parsed > maximum) {
    throw new UsageError(`${name} must be an integer from ${minimum} to ${maximum}`);
  }
  return parsed;
}

function parseArguments(args) {
  const options = {};
  const values = new Set([
    "--rom", "--core", "--output", "--run-id", "--seed",
    "--max-decisions", "--live-port", "--emulation-speed", "--roster-mode", "--team-seed",
  ]);
  const flags = new Set(["--dry-run", "--fresh-if-missing"]);
  for (let index = 0; index < args.length; index += 1) {
    const argument = args[index];
    if (argument === "--help") return { help: true };
    if (flags.has(argument)) {
      options[argument.slice(2).replaceAll("-", "_")] = true;
      continue;
    }
    if (!values.has(argument)) throw new UsageError(`unknown argument ${argument}`);
    const value = args[index + 1];
    if (!value || value.startsWith("--")) throw new UsageError(`${argument} requires a value`);
    options[argument.slice(2).replaceAll("-", "_")] = value;
    index += 1;
  }
  for (const name of ["rom", "core", "run_id", "seed"]) {
    if (!options[name]) throw new UsageError(`--${name.replaceAll("_", "-")} is required`);
  }
  options.output = resolve(options.output ?? `${projectRoot}/private/player-runs`);
  options.rom = resolve(options.rom);
  options.core = resolve(options.core);
  options.seed = integer("--seed", options.seed, { maximum: 0xffffffff });
  if (options.team_seed !== undefined) options.team_seed = normalizeTeamSeed(/^hex:/i.test(options.team_seed)
    ? options.team_seed : integer("--team-seed", options.team_seed, { maximum: 0xffffffff }));
  validateRosterOptions({ rosterMode: options.roster_mode, teamSeed: options.team_seed });
  options.max_decisions = integer(
    "--max-decisions",
    options.max_decisions ?? "50000",
    { minimum: 1 },
  );
  options.live_port = integer(
    "--live-port",
    options.live_port ?? "17339",
    { minimum: 1, maximum: 65535 },
  );
  options.emulation_speed = integer(
    "--emulation-speed",
    options.emulation_speed ?? "5",
    { minimum: 1, maximum: 10 },
  );
  return options;
}

async function launchPlan(options) {
  const checkpoint = await findLatestPlayerCheckpoint({
    outputDirectory: options.output,
    runId: options.run_id,
  });
  if (checkpoint?.playerState?.transactionRecovery?.blocked) {
    throw new Error(`run ${options.run_id} has a safety stop; review its checkpoint and diagnostic handoff before resuming`);
  }
  if (!checkpoint && !options.fresh_if_missing) {
    throw new Error(`no valid checkpoint found for run ${options.run_id}`);
  }
  if (!checkpoint) {
    const entries = await readdir(options.output).catch((error) => {
      if (error.code === "ENOENT") return [];
      throw error;
    });
    if (entries.some((name) => name.startsWith(`${options.run_id}.`))) {
      throw new Error(`existing run ${options.run_id} has no valid checkpoint; refusing to start a new save`);
    }
  }
  const seed = resolveRosterRunSeed({ seed: options.seed, seedExplicit: true, resumePlayerState: checkpoint?.playerState });
  const rosterOptions = { rosterMode: options.roster_mode, teamSeed: options.team_seed };
  const starterSpecies = createRunProfile(seed).starter.species;
  const selection = validateRosterResume(starterSpecies, seed, checkpoint?.playerState ?? null, rosterOptions);
  if (selection.version !== "coherent-generated-v2") {
    createRosterPlanForRun(starterSpecies, seed, checkpoint?.playerState ?? null, rosterOptions);
  }
  const arguments_ = [
    playerCli,
    "--rom", options.rom,
    "--core", options.core,
    ...(checkpoint ? [
      "--state", checkpoint.stateFilePath,
      "--sram", checkpoint.sramFilePath,
    ] : []),
    "--output", options.output,
    "--run-id", options.run_id,
    "--seed", String(options.seed),
    ...(options.roster_mode === undefined ? [] : ["--roster-mode", options.roster_mode]),
    ...(options.team_seed === undefined ? [] : ["--team-seed", String(options.team_seed)]),
    "--emulation-speed", String(options.emulation_speed),
    "--live-port", String(options.live_port),
    "--max-decisions", String(options.max_decisions),
    "--linger",
  ];
  return {
    schema: "master-red/player-service-plan/v1",
    runId: options.run_id,
    ...(!checkpoint ? { fresh: true } : {}),
    checkpoint: checkpoint
      ? {
          statePath: checkpoint.stateFilePath,
          sramPath: checkpoint.sramFilePath,
          playerSequence: Number(checkpoint.playerState.sequence ?? 0),
          rejectedControlStatePaths: checkpoint.rejectedControlStatePaths,
        }
      : null,
    executable: process.execPath,
    arguments: arguments_,
  };
}

async function runChild(plan) {
  const child = spawn(plan.executable, plan.arguments, {
    cwd: projectRoot,
    stdio: "inherit",
  });
  let forwardedSignal = null;
  const forward = (signal) => {
    forwardedSignal = signal;
    if (child.exitCode === null && child.signalCode === null) child.kill(signal);
  };
  const onInterrupt = () => forward("SIGINT");
  const onTerminate = () => forward("SIGTERM");
  process.once("SIGINT", onInterrupt);
  process.once("SIGTERM", onTerminate);
  const result = await new Promise((resolvePromise, reject) => {
    child.once("error", reject);
    child.once("exit", (code, signal) => resolvePromise({ code, signal }));
  }).finally(() => {
    process.removeListener("SIGINT", onInterrupt);
    process.removeListener("SIGTERM", onTerminate);
  });
  process.exitCode = Number.isInteger(result.code)
    ? result.code
    : forwardedSignal
      ? 0
      : 1;
}

async function main() {
  const options = parseArguments(process.argv.slice(2));
  if (options.help) {
    process.stdout.write(usage);
    return;
  }
  const plan = await launchPlan(options);
  if (options.dry_run) {
    process.stdout.write(`${JSON.stringify(plan)}\n`);
    return;
  }
  process.stdout.write(`${JSON.stringify({ event: "player-service-launch", ...plan })}\n`);
  await runChild(plan);
}

try {
  await main();
} catch (error) {
  process.stderr.write(`${error.stack ?? error.message}\n`);
  process.exitCode = error instanceof UsageError ? 64 : 1;
}
