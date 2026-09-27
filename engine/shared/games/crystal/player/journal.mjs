// Run journal: append-only JSON lines plus the stable AI-HANDOFF.md and
// LATEST.json pointers that make the latest state discoverable after a
// restart or a fresh debugging session.

import { appendFileSync, mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

export function createRunJournal({ outputDirectory, runId, sessionId }) {
  const runDirectory = join(outputDirectory, `${runId}.diagnostics`);
  const sessionDirectory = join(runDirectory, 'sessions', sessionId);
  mkdirSync(sessionDirectory, { recursive: true, mode: 0o700 });
  const journalPath = join(sessionDirectory, 'journal.jsonl');
  let entries = 0;
  const append = (record) => {
    entries += 1;
    const line = JSON.stringify({ at: new Date().toISOString(), ...record });
    appendFileSync(journalPath, `${line}\n`, { mode: 0o600 });
  };
  const writeHandoff = ({ summary, latest }) => {
    writeFileSync(join(runDirectory, 'LATEST.json'), `${JSON.stringify({ schema: 'pokemon-research/crystal-latest/v1', runId, sessionId, journalPath, updatedAt: new Date().toISOString(), ...latest }, null, 2)}\n`, { mode: 0o600 });
    writeFileSync(join(runDirectory, 'AI-HANDOFF.md'), summary, { mode: 0o600 });
    writeFileSync(join(sessionDirectory, 'AI-HANDOFF.md'), summary, { mode: 0o600 });
  };
  return Object.freeze({
    runDirectory,
    sessionDirectory,
    journalPath,
    append,
    writeHandoff,
    entries: () => entries,
  });
}

export function renderHandoff({ runId, sessionId, status, campaign, checkpoint, anomalies, startedAt, observation, diagnostics = null }) {
  const bundle = diagnostics?.latestBundle ?? null;
  const lines = [
    `# Crystal research player handoff — ${runId}`,
    '',
    `Session ${sessionId}, started ${startedAt}, updated ${new Date().toISOString()}.`,
    '',
    '## Where the cartridge is',
    '',
    observation
      ? `- Map ${status.map ?? 'unknown'} at ${status.position?.x},${status.position?.y}, mode ${status.mode}, frame ${status.frame}.`
      : '- No observation yet.',
    observation
      ? `- Trainer ${observation.trainer.name} (${observation.trainer.gender}), badges ${observation.trainer.badges.join(', ') || 'none'}, money ${observation.trainer.money}, play time ${observation.trainer.playTime.hours}h ${observation.trainer.playTime.minutes}m.`
      : '',
    observation
      ? `- Party: ${observation.party.map((member) => `${member.speciesName} L${member.level} ${member.hp}/${member.maxHp} [${member.moves.map((move) => move.name).join(', ')}]`).join('; ') || 'empty'}.`
      : '',
    status?.spectator?.options
      ? `- Options: text ${status.spectator.options.textSpeed}, battle scene ${status.spectator.options.battleScene}, style ${status.spectator.options.battleStyle}, menu account ${status.spectator.options.menuAccount}${status.spectator.options.satisfied ? '' : ' (not yet at the desired settings)'}.`
      : '',
    '',
    '## Campaign',
    '',
    `- Active objective: ${campaign?.activeObjective?.id ?? 'none (complete or unknown)'}.`,
    `- Completed: ${campaign?.completed?.join(', ') || 'none'}.`,
    `- Decisions so far: ${status.decisions}.`,
    `- Last decision: ${status.decision ? `${status.decision.kind} (${status.decision.reason}) by ${status.decision.advisor}` : 'none'}.`,
    '',
    '## Checkpoint',
    '',
    checkpoint ? `- ${checkpoint.stateFilePath} (state ${checkpoint.stateSha256.slice(0, 12)}, sram ${checkpoint.sramSha256.slice(0, 12)}).` : '- No checkpoint written yet.',
    '',
    '## Replay bundles',
    '',
    diagnostics
      ? `- ${diagnostics.bundleCount} bundle(s) in \`${diagnostics.bundlesDirectory}\`${diagnostics.skippedBundles ? ` (${diagnostics.skippedBundles} skipped at the cap)` : ''}.`
      : '- Diagnostics recorder not attached.',
    bundle
      ? `- Latest: decision ${bundle.sequence}, reason \`${bundle.reason}\`, frame ${bundle.frame}: \`${bundle.directory}\`.`
      : '- No bundle written yet.',
    ...(diagnostics?.recentAnomalies?.length
      ? diagnostics.recentAnomalies.map((entry) => `- Anomaly at decision ${entry.sequence} (${entry.kind}): ${entry.message}`)
      : []),
    '',
    'Each bundle holds `emulator.state`, `cartridge.sav`, `frame.rgba` + `frame.json`,',
    '`observation.json.gz`, `decision.json`, `player-state.json` and `bundle.json`',
    'captured on one frame. Reload and inspect one with',
    '`node games/crystal/cli/inspect-bundle.mjs <bundle-dir> --verify`.',
    '',
    '## Recent anomalies',
    '',
    ...(anomalies.length ? anomalies.slice(-8).map((entry) => `- ${entry.at}: ${entry.message}`) : ['- none']),
    '',
    'Inspect `journal.jsonl` in the session directory for the complete decision record;',
    '`inputs` records give the exact button chord per frame of every decision.',
    '',
  ];
  return lines.join('\n');
}
