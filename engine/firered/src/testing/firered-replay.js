import { isProgressObservation } from "../player/progress-observation.js";

export function createFireRedReplayMonitor({ target, clock = Date.now, maxWallMs = 180_000 } = {}) {
  if (target !== "party-restored") throw new TypeError("invalid FireRed replay target");
  if (!Number.isFinite(maxWallMs) || maxWallMs <= 0) throw new TypeError("invalid replay wall budget");
  const startedAt = clock();
  let original = null, stopReason = null, latest = null;
  const milestones = {};
  const identity = member => `${member.personality}:${member.species}`;
  const healthy = member => member.hp === member.maxHp && member.status1 === 0;
  const validParty = party => Array.isArray(party) && party.length > 0 && party.length <= 6 && party.every(m =>
    Number.isInteger(m.species) && Number.isInteger(m.personality) && Number.isInteger(m.hp) &&
    Number.isInteger(m.maxHp) && m.maxHp > 0 && m.hp >= 0 && m.hp <= m.maxHp && Number.isInteger(m.status1));
  return { status: () => structuredClone(latest), observe(update) {
    const observation = update.observation, memory = observation?.playerMemory;
    const party = memory?.trainer?.party;
    const progressValid = isProgressObservation(observation) && observation.emulator.mode === "overworld" && validParty(party);
    const now = clock();
    const proof = { frame: observation?.frame, captureId: observation?.captureId,
      playerMemorySha256: memory?.sha256, sramSha256: observation?.sram?.sha256,
      wallSeconds: (now - startedAt) / 1000 };
    if (!stopReason && progressValid) {
      if (!original) {
        original = party.map(identity).sort();
        if (party.every(healthy)) stopReason = "scenario-precondition-failed";
        else milestones.baseline = { ...proof };
      } else if (JSON.stringify(party.map(identity).sort()) === JSON.stringify(original) && party.every(healthy)) {
        milestones.recovery = { ...proof };
        stopReason = "target-reached";
      }
    }
    if (!stopReason && now - startedAt >= maxWallMs) stopReason = "scenario-wall-time-limit";
    if (update.decision?.kind === "blocked") stopReason = "safety-stop";
    if (update.controlHandoff) stopReason = "manual-assistance";
    const time = memory?.trainer?.playTime;
    latest = { target, stopReason, targetReached: stopReason === "target-reached", progressValid,
      ...proof, milestones: structuredClone(milestones), map: memory?.map?.id ?? null,
      gameSeconds: time ? time.hours * 3600 + time.minutes * 60 + time.seconds : null,
      party: progressValid ? party.map(({ species, level, hp, maxHp, status1 }) => ({ species, level, hp, maxHp, status1 })) : latest?.party ?? [],
      updatedAt: new Date(now).toISOString() };
    return structuredClone(latest);
  } };
}
