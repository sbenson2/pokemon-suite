// Run journal: append-only decision records plus stable AI-HANDOFF.md and
// LATEST.json pointers so a new session can resume reasoning after a restart.
import { appendFile, mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';

export function createJournal({ outputDirectory, runId, sessionId }) {
  const directory = join(outputDirectory, `${runId}.diagnostics`);
  const journalPath = join(directory, 'decisions.jsonl');
  const latestPath = join(directory, 'LATEST.json');
  const handoffPath = join(directory, 'AI-HANDOFF.md');
  let pending = [];
  let recorded = 0;
  let ready = mkdir(directory, { recursive: true, mode: 0o700 });
  const flush = async () => {
    await ready;
    if (!pending.length) return;
    const lines = pending; pending = [];
    await appendFile(journalPath, lines.map(line => `${JSON.stringify(line)}\n`).join(''), { mode: 0o600 });
  };
  return Object.freeze({
    directory, journalPath, latestPath, handoffPath, sessionId,
    get recordedDecisions() { return recorded; },
    record(entry) {
      recorded += 1;
      pending.push({ sessionId, recordedAt: new Date().toISOString(), ...entry });
      if (pending.length >= 50) return flush();
      return null;
    },
    flush,
    async writeLatest(status, { checkpoint = null, note = null } = {}) {
      await ready;
      await flush();
      const latest = { schema: 'pokemon-research/emerald-latest/v1', runId, sessionId, updatedAt: new Date().toISOString(), journalPath, checkpoint, note, frame: status.frame, decisions: status.decisions, map: status.map, position: status.position, mode: status.mode, campaign: status.campaign, winner: status.winner, party: status.spectator?.party ?? [], runProfile: status.runProfile, emulation: status.emulation };
      await writeFile(latestPath, `${JSON.stringify(latest, null, 2)}\n`, { mode: 0o600 });
      const objective = status.campaign?.activeObjective?.id ?? 'campaign complete';
      const party = (status.spectator?.party ?? []).map(member => `${member.speciesName} L${member.level} ${member.hp}/${member.maxHp} ${member.status}`).join(', ') || 'none';
      await writeFile(handoffPath, `# Emerald player handoff — ${runId}\n\nUpdated ${latest.updatedAt} (session ${sessionId}).\n\n- Frame ${status.frame}, decisions ${status.decisions}, mode ${status.mode}.\n- Location: ${status.map ?? 'unknown'} @ ${status.position ? `${status.position.x},${status.position.y}` : '?'}.\n- Active objective: ${objective}; completed: ${(status.campaign?.completed ?? []).join(', ') || 'none'}.\n- Party: ${party}.\n- Trainer: ${status.spectator?.trainer?.name ?? '?'} (${status.runProfile?.gender ?? '?'}), starter ticket ${status.runProfile?.starter ?? '?'}, money ${status.spectator?.trainer?.money ?? '?'}, play time ${JSON.stringify(status.spectator?.trainer?.playTime ?? null)}.\n- Last winner: ${status.winner ? `${status.winner.advisor} → ${status.winner.recommendation.kind}` : 'none'}.\n- Emulation: ${JSON.stringify(status.emulation ?? null)}.\n- Checkpoint: ${checkpoint ? `${checkpoint.statePath} (${checkpoint.stateSha256.slice(0, 12)})` : 'none yet'}.\n${note ? `- Note: ${note}\n` : ''}\nInspect \`${journalPath}\` for the ordered decision journal (one JSON object per line) and \`${latestPath}\` for the machine-readable pointer.\n`, { mode: 0o600 });
    },
  });
}
