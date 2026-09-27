#!/usr/bin/env node
// Offline dry run of the Crystal player from a checkpoint: no live feed, no
// wall-clock pacing, synchronous stepping. Used to verify campaign chapters on
// the real cartridge before deploying them to the LaunchAgent service.
//
//   node games/crystal/cli/dry-run.mjs --run-id ID [--state PATH --sram PATH]
//        [--decisions N] [--frames N] [--until-map MAP_ID] [--until-event FLAG]
//        [--until-badge BADGE] [--save-run-id ID --save-output DIR] [--verbose]

import { resolve } from 'node:path';

import { readVerifiedCartridge } from '../../../shared/cartridge.js';
import { createPinnedMultiSystemSession } from '../../../shared/pinned-mgba.js';
import { loadCrystalKnowledge } from '../knowledge.mjs';
import { loadCrystalWorld } from '../world/source.mjs';
import { createCrystalObserver } from '../observer.mjs';
import { createCrystalPlayer, PlayerStallError } from '../player/delegator.mjs';
import { findLatestCrystalCheckpoint, writeCrystalCheckpoint } from '../player/checkpoint.mjs';
import { cartridgeProfile } from '../player/runtime.mjs';
import { currentMapId } from '../player/navigation.mjs';

function parseArguments(args) {
  const values = new Set(['--run-id', '--state', '--sram', '--output', '--decisions', '--frames', '--until-map', '--until-event', '--until-badge', '--until-species', '--until-move', '--save-run-id', '--save-output', '--core', '--rom']);
  const flags = new Set(['--verbose', '--help']);
  const options = {};
  for (let index = 0; index < args.length; index += 1) {
    const argument = args[index];
    if (flags.has(argument)) { options[argument.slice(2)] = true; continue; }
    if (!values.has(argument)) throw new Error(`unknown argument ${argument}`);
    options[argument.slice(2).replaceAll('-', '_')] = args[index + 1];
    index += 1;
  }
  return options;
}

const partyLine = (observation) => observation.party.map((member) => `${member.speciesName} L${member.level} ${member.hp}/${member.maxHp}`).join('; ');

async function main() {
  const options = parseArguments(process.argv.slice(2));
  if (options.help) {
    console.log('see the header comment of games/crystal/cli/dry-run.mjs');
    return;
  }
  const outputDirectory = resolve(options.output ?? 'private/crystal/player-runs');
  let checkpoint = null;
  if (options.state) {
    checkpoint = { stateFilePath: resolve(options.state), sramFilePath: resolve(options.sram) };
  } else {
    if (!options.run_id) throw new Error('--run-id or --state/--sram is required');
    checkpoint = await findLatestCrystalCheckpoint({ outputDirectory, runId: options.run_id });
    if (!checkpoint) throw new Error(`run ${options.run_id} has no checkpoint under ${outputDirectory}`);
  }
  const { readFileSync } = await import('node:fs');
  const cartridge = await readVerifiedCartridge(cartridgeProfile(options.rom));
  const session = await createPinnedMultiSystemSession({ coreDirectory: options.core ?? 'vendor/mgba-wasm/dist/mgba', cartridge, system: 'gbc' });
  session.loadSram(new Uint8Array(readFileSync(checkpoint.sramFilePath)));
  session.loadState(new Uint8Array(readFileSync(checkpoint.stateFilePath)));

  const world = loadCrystalWorld();
  const knowledge = loadCrystalKnowledge();
  const observer = createCrystalObserver({ session, knowledge, runId: options.run_id ?? 'dry-run' });
  const verbose = options.verbose === true;
  const counts = {};
  const journal = {
    append(record) {
      counts[record.type] = (counts[record.type] ?? 0) + 1;
      if (record.type === 'decision') {
        console.log(`#${record.sequence} ${record.kind} ${record.map} ${record.position.x},${record.position.y} f${record.frame} | ${record.reason} | ${record.party}`);
      } else if (record.type === 'anomaly') {
        console.log(`  ! ${record.message}${record.detail ? ' ' + JSON.stringify(record.detail).slice(0, 200) : ''}`);
      } else if (['heal', 'shop', 'teach', 'field-move', 'herd', 'battle-result'].includes(record.type)) {
        const { type, runId, sequence, ...rest } = record;
        console.log(`  ${type} ${JSON.stringify(rest).slice(0, 200)}`);
      } else if (record.type === 'navigation' && (verbose || record.talkThrough)) {
        console.log(`  nav ${record.mapId} -> ${JSON.stringify(record.destination)} ${record.talkThrough ? 'talk-through ' + JSON.stringify(record.talkThrough) : JSON.stringify(record.leg?.segments ?? [])}`.slice(0, 240));
      } else if (verbose && ['battle-turn', 'prompt'].includes(record.type)) {
        const { type, runId, sequence, ...rest } = record;
        console.log(`  ${type} ${JSON.stringify(rest).slice(0, 160)}`);
      }
    },
    writeHandoff() {},
  };
  const player = createCrystalPlayer({ world, knowledge, observer, journal, runId: options.run_id ?? 'dry-run' });
  const maxDecisions = Number(options.decisions ?? 200);
  const maxFrames = Number(options.frames ?? 2_000_000);
  const untilMap = options.until_map ?? null;
  const untilEvent = options.until_event ?? null;
  const untilBadge = options.until_badge ?? null;
  const untilSpecies = options.until_species ?? null;
  const untilMove = options.until_move ?? null;
  const startFrame = session.frame;
  const startedAt = Date.now();
  const initial = observer.observe();
  console.log(`start ${currentMapId(world, initial)} ${initial.map.x},${initial.map.y} f${initial.frame} | badges ${initial.trainer.badges.join(',')} | ${partyLine(initial)}`);

  let generator = player.play();
  let stopReason = 'frames';
  let frames = 0;
  let restarts = 0;
  for (;;) {
    if (player.sequence() >= maxDecisions) { stopReason = 'decisions'; break; }
    if (frames >= maxFrames) { stopReason = 'frames'; break; }
    if (frames % 600 === 0 && (untilMap || untilEvent || untilBadge || untilSpecies || untilMove)) {
      const observation = observer.observe();
      if (observation.battle) { /* settle the battle before judging */ } else {
        if (untilMap && currentMapId(world, observation) === untilMap) { stopReason = `map ${untilMap}`; break; }
        if (untilEvent && observer.hasEvent(observation, untilEvent)) { stopReason = `event ${untilEvent}`; break; }
        if (untilBadge && observation.trainer.badges.includes(untilBadge)) { stopReason = `badge ${untilBadge}`; break; }
        if (untilSpecies && observation.party.some((member) => member.speciesName === untilSpecies)) { stopReason = `species ${untilSpecies}`; break; }
        if (untilMove && observation.party.some((member) => !member.isEgg && member.moves.some((move) => move.name === untilMove))) { stopReason = `move ${untilMove}`; break; }
      }
    }
    let next;
    try {
      next = generator.next();
    } catch (error) {
      restarts += 1;
      console.log(`  !! player loop failed: ${error.message} ${error.detail ? JSON.stringify(error.detail).slice(0, 200) : ''}`);
      if (error instanceof PlayerStallError && restarts > 6) { stopReason = 'stalled'; break; }
      player.resetWatchdog();
      generator = player.play();
      continue;
    }
    if (next.done) { generator = player.play(); continue; }
    session.step(next.value ?? []);
    frames += 1;
  }
  const final = observer.observe();
  const seconds = ((Date.now() - startedAt) / 1000).toFixed(1);
  console.log(`stop (${stopReason}) after ${player.sequence()} decisions, ${session.frame - startFrame} frames in ${seconds}s`);
  console.log(`end ${currentMapId(world, final)} ${final.map.x},${final.map.y} f${final.frame} | badges ${final.trainer.badges.join(',')} | ${partyLine(final)} | money ${final.trainer.money}`);
  console.log(`campaign ${JSON.stringify(player.campaignStatus(final))}`);
  console.log(`journal counts ${JSON.stringify(counts)}`);
  if (options.save_run_id) {
    const saved = await writeCrystalCheckpoint({
      session, outputDirectory: resolve(options.save_output ?? 'private/crystal/dry-runs'), runId: options.save_run_id,
      status: { reason: 'dry-run', decisions: player.sequence(), map: currentMapId(world, final), position: { x: final.map.x, y: final.map.y } },
      playerState: { sequence: player.sequence(), reason: 'dry-run' },
    });
    console.log(`saved ${saved.stateFilePath}`);
  }
  session.close();
}

main().catch((error) => {
  console.error(error.stack ?? error.message);
  process.exit(1);
});
