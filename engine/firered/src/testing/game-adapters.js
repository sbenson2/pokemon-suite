// Test orchestration boundary, not a claim of universal gameplay support.
// Additional games must provide their own player, verified inputs and monitors.
import { validateTrainingExperiment } from "./training-experiment.js";
import { validateRosterOptions } from "../player/roster-selection.js";
const fireRed = Object.freeze({
  id: "firered-rev1-stock", platform: "gba", player: "src/cli/run-player.js",
  campaignTargets: Object.freeze(["brock", "hall-of-fame"]),
  replayTargets: Object.freeze(["party-restored"]),
});

export function gameTestAdapter(id) {
  if (id !== fireRed.id) throw new TypeError(`unsupported test game: ${id}`);
  return fireRed;
}

export function validateTestJob(job) {
  const adapter = gameTestAdapter(job.game);
  if (!["campaign", "replay", "continuation", "experiment"].includes(job.kind)) throw new TypeError("invalid test job kind");
  const experiment = job.kind === "experiment" ? validateTrainingExperiment(job.experiment) : null;
  validateRosterOptions({ rosterMode: job.rosterMode, teamSeed: job.teamSeed });
  if (experiment && (job.rosterMode !== undefined || job.teamSeed !== undefined)) {
    throw new TypeError("experiment roster is fixed by its configuration or parent checkpoint");
  }
  if (!experiment && job.experiment) throw new TypeError("experimental policy requires an experiment job");
  const targets = experiment ? [experiment.mode === "underlevel" ? "underlevel-hall-of-fame" : "training-window"]
    : job.kind === "replay" ? adapter.replayTargets : adapter.campaignTargets;
  if (!targets.includes(job.target)) throw new TypeError(`unsupported ${job.kind} target: ${job.target}`);
  if (!Number.isSafeInteger(job.seed) || job.seed < 0 || job.seed > 0xffff_ffff) throw new TypeError("invalid job seed");
  const cold = job.kind === "campaign" || experiment?.mode === "underlevel";
  if (cold && (job.checkpoint || job.sourceRunId)) throw new TypeError("cold campaign cannot use a checkpoint or parent identity");
  if (!cold && !/^[a-zA-Z0-9_-]{1,100}$/.test(job.checkpoint ?? "")) throw new TypeError("replay or continuation requires a checkpoint reference");
  if ((job.kind === "continuation" || experiment?.mode === "efficiency") && !/^[a-zA-Z0-9._-]{1,160}$/.test(job.sourceRunId ?? "")) throw new TypeError("continuation or experiment requires a source run ID");
  if (job.maxDecisions !== undefined && (!Number.isSafeInteger(job.maxDecisions) || job.maxDecisions < 1)) throw new TypeError("invalid decision budget");
  return adapter;
}
