import assert from "node:assert/strict";
import test from "node:test";
import { createMasterTeamPlan } from "../src/player/origins-team.js";
import { createMasterCampaign, CAMPAIGN_MAJOR_BATTLE_LEVEL_TARGETS } from "../src/player/campaign.js";
import { createCampaignEpisodeMonitor } from "../src/player/campaign-episode.js";
import { validateTrainingExperiment, createTrainingExperimentCampaign,
  createTrainingExperimentMonitor, createBossAuditCatalog, HARD_MODE_ACQUISITIONS } from "../src/testing/training-experiment.js";

const config = (extra = {}) => ({ schema: "master-red/training-experiment/v1", mode: "efficiency",
  purpose: "Matched checkpoint readiness comparison", readiness: "baseline", windowFrames: 600, ...extra });
const hard = () => ({ schema: "master-red/training-experiment/v1", mode: "underlevel", purpose: "Under-level whole campaign" });
const team = () => createMasterTeamPlan(1, 2026090500, { acquisitionIds: HARD_MODE_ACQUISITIONS });

test("experiment configuration rejects typos, ambiguous budgets and hidden production qualification", () => {
  assert.equal(validateTrainingExperiment(config()).windowFrames, 600);
  assert.equal(validateTrainingExperiment(hard()).mode, "underlevel");
  for (const bad of [config({ readiness: "stronger" }), config({ windowFrames: 0 }), config({ windowFrames: null }),
    config({ qualification: true }), { ...hard(), windowFrames: 600 }, config({ purpose: "" })]) {
    assert.throws(() => validateTrainingExperiment(bad));
  }
});

test("baseline is unchanged; ace-match changes every readiness alias without changing acquisitions or medicine", () => {
  const campaign = createMasterCampaign(team());
  const before = JSON.stringify(campaign);
  assert.equal(createTrainingExperimentCampaign({ campaign, config: config() }), campaign);
  const changed = createTrainingExperimentCampaign({ campaign, config: config({ readiness: "ace-match" }) });
  const battle = changed.objectives.find(x => x.id === "silph-liberated");
  for (const key of ["minimumTeamAnchorLevel", "minimumBattleMemberLevel", "starterBattleTargetLevel",
    "supportBattleTargetLevel", "battleTeamTargetLevel"]) assert.equal(battle[key], 41, key);
  assert.equal(battle.minimumBattlePartySize, 6);
  assert.equal(JSON.stringify(campaign), before);
  assert.deepEqual(changed.objectives.filter(x => !x.importantBattle), campaign.objectives.filter(x => !x.importantBattle));
});

test("hard preparation looks ahead to lower bosses, leaves XP buffer and does not demand grinding inside the League", () => {
  const campaign = createTrainingExperimentCampaign({ campaign: createMasterCampaign(team()), config: hard() });
  const get = id => campaign.objectives.find(x => x.id === id);
  assert.equal(get("rival-route22-early").starterBattleTargetLevel, 6); // ace 9 - cap 2 - buffer 1
  assert.equal(get("badge-cascade").starterBattleTargetLevel, 17); // next rival's ace is only 20
  assert.equal(get("badge-rainbow").starterBattleTargetLevel, 22); // Tower rival is only 25
  assert.equal(get("elite-four-lorelei").starterBattleTargetLevel, 51);
  assert.equal(get("champion").starterBattleTargetLevel, 51); // natural League XP, no inaccessible training gate
  for (const objective of campaign.objectives.filter(x => x.importantBattle)) {
    assert.ok(objective.starterBattleTargetLevel <= objective.enemyAceLevel - 2, objective.id);
  }
});

const member = (extra = {}) => ({ personality: 0, otId: 4, species: 1, level: 10, experience: 1000,
  hp: 30, maxHp: 30, slot: 0, ...extra });
function update(frame, extra = {}) {
  return { decision: { kind: "wait", sequence: frame }, observation: { phase: "stable", frame,
    captureId: `capture:${frame}`, emulator: { mode: "overworld", inBattle: false },
    playerMemory: { sha256: `sha:${frame}`, map: { id: "MAP_ROUTE6" },
      trainer: { party: [member()], money: 500, bag: { items: [{ itemId: 13, quantity: 3 }] } },
      storyState: { flagIds: {} }, ...extra } } };
}
function monitor(cfg = config(), bossCatalog = []) {
  return createTrainingExperimentMonitor({ config: cfg, bossCatalog,
    baseMonitor: createCampaignEpisodeMonitor({ target: "hall-of-fame", maxGameSeconds: null, clock: () => 1000 }),
    clock: () => 1000 });
}
function battle(frame, { trainerId = 414, ace = 14, party = [member({ level: 12 })], outcome = 0 } = {}) {
  const u = update(frame, { trainer: { party }, battleTypeFlags: 8, battleOutcome: outcome,
    encounter: { validity: "valid", kind: "trainer" },
    battle: { trainerId, enemyParty: [{ species: 74, level: ace }], turn: 1 } });
  u.observation.emulator = { mode: "battle", inBattle: true };
  return u;
}
const bosses = [{ objectiveId: "badge-boulder", trainerId: 414, ace: 14, category: "gym-leader" },
  { objectiveId: "rival-oaks-lab", trainerId: 328, ace: 5, category: "tutorial-rival" }];

test("efficiency uses native frames, Pokémon identities across evolution/reordering, and no invented catch XP", () => {
  const m = monitor();
  m.observe(update(100));
  m.observe(update(300, { trainer: { party: [member({ personality: 9, experience: 40000, slot: 0 }),
    member({ species: 2, experience: 1200, slot: 1 })], money: 300 } }));
  const result = m.observe(update(700, { trainer: { party: [member({ species: 2, experience: 1200 })], money: 300 } }));
  assert.equal(result.stopReason, "target-reached");
  assert.equal(result.targetReached, true);
  assert.equal(result.experiment.nativeFrames, 600);
  assert.equal(result.experiment.totalExperienceGained, 200);
  assert.equal(result.experiment.newMembers, 1);
  assert.equal(result.experiment.moneyDelta, -200);
  assert.equal(result.experiment.members.find(x => x.personality === 0).experienceGained, 200);
});

test("zero-XP windows and missing initial state are not successful training evidence", () => {
  const m = monitor();
  const boot = update(1); boot.observation.emulator.mode = "boot";
  assert.equal(m.observe(boot).experiment.nativeFrames, 0);
  m.observe(update(100));
  assert.equal(m.observe(update(700)).stopReason, "no-training-evidence");
});

test("boss audit uses native trainer ID and whole enemy party, freezes entry levels and records wins once", () => {
  const m = monitor(hard(), bosses);
  m.observe(update(1));
  m.observe(battle(10));
  m.observe(battle(20));
  m.observe(battle(30, { party: [member({ level: 13 })], outcome: 1 }));
  const r = m.observe(update(50));
  assert.equal(r.experiment.bosses.length, 1);
  assert.equal(r.experiment.bosses[0].entryParty[0].level, 12);
  assert.equal(r.experiment.bosses[0].cap, 12);
  assert.equal(r.experiment.bosses[0].underlevel, true);
  assert.equal(r.experiment.bosses[0].outcome, "won");
  assert.equal(r.experiment.bosses[0].entry.captureId, "capture:10");
});

test("cap violations, losses, unknown outcomes and tutorial exception remain explicit; no clean pass by flags alone", () => {
  const m = monitor(hard(), bosses);
  m.observe(battle(1, { party: [member({ level: 13 })] }));
  m.observe(battle(3, { outcome: 2 }));
  m.observe(update(4));
  m.observe(battle(5, { trainerId: 328, ace: 5, party: [member({ level: 5 })] }));
  m.observe(battle(6, { trainerId: 328, ace: 5, outcome: 1 }));
  m.observe(update(7));
  const end = update(8); end.decision = { kind: "complete", reason: "native-hall-of-fame" };
  const r = m.observe(end);
  assert.equal(r.targetReached, false);
  assert.equal(r.stopReason, "underlevel-coverage-incomplete");
  assert.equal(r.experiment.capViolations, 1);
  assert.equal(r.experiment.bosses[0].outcome, "lost");
  assert.equal(r.experiment.bosses[1].exception, "forced-level-five-tutorial");
  assert.deepEqual(r.experiment.missingBosses, ["badge-boulder"]);
});

test("unknown enemy data and wild battles cannot supply a boss-entry proof", () => {
  const m = monitor(hard(), bosses);
  const u = battle(5); u.observation.playerMemory.encounter.validity = "unknown";
  m.observe(u);
  const wild = battle(6); wild.observation.playerMemory.battleTypeFlags = 0;
  wild.observation.playerMemory.encounter.kind = "wild";
  assert.equal(m.observe(wild).experiment.bosses.length, 0);
});

test("boss catalog refuses incomplete cartridge facts instead of guessing missing bosses", () => {
  assert.throws(() => createBossAuditCatalog({ data: { trainers: [] } }), /missing.*boss/i);
  assert.ok(Object.keys(CAMPAIGN_MAJOR_BATTLE_LEVEL_TARGETS).length >= 20);
});
