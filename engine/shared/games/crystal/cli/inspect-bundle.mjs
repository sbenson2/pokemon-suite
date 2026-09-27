#!/usr/bin/env node
// Inspect a Crystal replay bundle after the fact: print its manifest, decision
// and player state; optionally reload the exact emulator state in the pinned
// core to prove it lands on the recorded frame, and dump the framebuffer as a
// PPM image you can open anywhere.
//
//   node games/crystal/cli/inspect-bundle.mjs <bundle-dir> [--verify] [--ppm out.ppm] [--observation]
//   node games/crystal/cli/inspect-bundle.mjs --list <run-diagnostics-dir>

import { readFileSync, readdirSync, statSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { gunzipSync } from 'node:zlib';

import { deserializeObservation } from '../player/diagnostics.mjs';

function parseArguments(args) {
  const options = { positional: [] };
  for (let index = 0; index < args.length; index += 1) {
    const argument = args[index];
    if (argument === '--verify' || argument === '--observation' || argument === '--help') options[argument.slice(2)] = true;
    else if (argument === '--ppm' || argument === '--list' || argument === '--rom' || argument === '--core') { options[argument.slice(2)] = args[index + 1]; index += 1; }
    else options.positional.push(argument);
  }
  return options;
}

function listBundles(runDirectory) {
  const sessions = join(runDirectory, 'sessions');
  const rows = [];
  for (const session of readdirSync(sessions)) {
    const bundles = join(sessions, session, 'bundles');
    let names = [];
    try { names = readdirSync(bundles); } catch { continue; }
    for (const name of names.sort()) {
      try {
        const manifest = JSON.parse(readFileSync(join(bundles, name, 'bundle.json'), 'utf8'));
        rows.push({ session, name, sequence: manifest.sequence, reason: manifest.reason, frame: manifest.frame, at: manifest.at, anomaly: manifest.anomaly?.message ?? '' });
      } catch { rows.push({ session, name, reason: '(unreadable manifest)' }); }
    }
  }
  for (const row of rows) console.log(`${row.session}  ${row.name}  frame ${row.frame ?? '?'}  ${row.at ?? ''}  ${row.anomaly}`);
  console.log(`${rows.length} bundle(s)`);
}

function writePpm(path, rgba, width, height) {
  const header = Buffer.from(`P6\n${width} ${height}\n255\n`, 'ascii');
  const pixels = Buffer.alloc(width * height * 3);
  for (let index = 0, out = 0; index < rgba.length; index += 4, out += 3) {
    pixels[out] = rgba[index]; pixels[out + 1] = rgba[index + 1]; pixels[out + 2] = rgba[index + 2];
  }
  writeFileSync(path, Buffer.concat([header, pixels]));
}

async function verify(directory, manifest, options) {
  const { readVerifiedCartridge } = await import('../../../shared/cartridge.js');
  const { createPinnedMultiSystemSession } = await import('../../../shared/pinned-mgba.js');
  const { cartridgeProfile } = await import('../player/runtime.mjs');
  const { loadCrystalKnowledge } = await import('../knowledge.mjs');
  const { createCrystalObserver } = await import('../observer.mjs');
  const cartridge = await readVerifiedCartridge(cartridgeProfile(options.rom));
  const session = await createPinnedMultiSystemSession({ coreDirectory: options.core ?? 'vendor/mgba-wasm/dist/mgba', cartridge, system: 'gbc' });
  try {
    session.loadSram(new Uint8Array(readFileSync(join(directory, 'cartridge.sav'))));
    session.loadState(new Uint8Array(readFileSync(join(directory, 'emulator.state'))));
    const observer = createCrystalObserver({ session, knowledge: loadCrystalKnowledge(), runId: manifest.runId });
    const observation = observer.observe();
    const recorded = deserializeObservation(gunzipSync(readFileSync(join(directory, 'observation.json.gz'))).toString('utf8'));
    const frameMatches = session.frame === manifest.frame;
    const mapMatches = JSON.stringify(observation.map) === JSON.stringify(recorded.map);
    const partyMatches = JSON.stringify(observation.party.map((m) => [m.speciesId, m.level, m.hp])) === JSON.stringify(recorded.party.map((m) => [m.speciesId, m.level, m.hp]));
    console.log(`verify: frame ${session.frame} ${frameMatches ? '==' : '!='} ${manifest.frame}; map ${mapMatches ? 'matches' : 'differs'}; party ${partyMatches ? 'matches' : 'differs'}`);
    console.log(`verify: screen\n${observation.screen.join('\n')}`);
    return frameMatches && mapMatches && partyMatches;
  } finally {
    session.close();
  }
}

async function main() {
  const options = parseArguments(process.argv.slice(2));
  if (options.help || (!options.list && options.positional.length === 0)) {
    console.log('usage: inspect-bundle.mjs <bundle-dir> [--verify] [--ppm out.ppm] [--observation] | --list <run-diagnostics-dir>');
    return;
  }
  if (options.list) { listBundles(resolve(options.list)); return; }
  const directory = resolve(options.positional[0]);
  statSync(directory);
  const manifest = JSON.parse(readFileSync(join(directory, 'bundle.json'), 'utf8'));
  console.log(`bundle ${manifest.sequence} (${manifest.reason}) at ${manifest.at}, frame ${manifest.frame}, map ${JSON.stringify(manifest.map)}`);
  if (manifest.anomaly) console.log(`anomaly: ${manifest.anomaly.kind}: ${manifest.anomaly.message}`);
  console.log(`decision: ${readFileSync(join(directory, 'decision.json'), 'utf8').trim()}`);
  console.log(`player state: ${readFileSync(join(directory, 'player-state.json'), 'utf8').trim()}`);
  if (options.observation) {
    const observation = deserializeObservation(gunzipSync(readFileSync(join(directory, 'observation.json.gz'))).toString('utf8'));
    console.log(`observation: map ${JSON.stringify(observation.map)}, party ${observation.party.map((m) => `${m.speciesName} L${m.level} ${m.hp}/${m.maxHp}`).join('; ')}`);
    console.log(observation.screen.join('\n'));
  }
  if (options.ppm) {
    const frame = JSON.parse(readFileSync(join(directory, 'frame.json'), 'utf8'));
    writePpm(resolve(options.ppm), readFileSync(join(directory, 'frame.rgba')), frame.width, frame.height);
    console.log(`wrote ${options.ppm} (${frame.width}x${frame.height})`);
  }
  if (options.verify) {
    const ok = await verify(directory, manifest, options);
    process.exitCode = ok ? 0 : 1;
  }
}

main().catch((error) => { console.error(error.stack ?? error.message); process.exitCode = 1; });
