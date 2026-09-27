import assert from "node:assert/strict";
import test from "node:test";
import { createCampaignPlanner } from "../src/player/campaign.js";
import { createPolicyAdvisors } from "../src/player/advisors.js";
import { createCentralPlayer } from "../src/player/delegator.js";

const mapId = "MAP_RECOVERY_TEST_POKEMON_CENTER_1F";
const campaign = { objectives: [] };
function recoveryWorld(healers = 2) {
  return { maps: [{
    id: mapId,
    warpEvents: [], connections: [], coordEvents: [],
    objectEvents: Array.from({ length: healers }, (_, index) => ({
      x: 2 + index * 3, y: 1, script: `Recovery${index}_EventScript_Nurse`,
    })),
    layout: {
      width: 8, height: 5,
      cells: Array.from({ length: 40 }, (_, index) => ({
        x: index % 8, y: Math.floor(index / 8), collision: 0,
        elevation: 3, behaviorName: "MB_NORMAL",
      })),
    },
  }] };
}

let captures = 0;
function observation({ party = null, ui = {}, position = { x: 2, y: 2 },
  facing = "north", variables = { 16480: 0 } } = {}) {
  const captureId = `recovery-${++captures}`;
  const frame = captures * 20;
  return {
    captureId, frame, phase: "stable", phaseReasons: [],
    emulator: { captureId, frame, mode: "overworld", inputReady: true },
    sram: { captureId, frame, sha256: "recovery-sram" },
    playerMemory: {
      captureId, frame, sha256: captureId,
      map: { id: mapId }, position, avatar: { facing },
      storyState: { variableIds: variables, flagIds: {} },
      scripts: { fieldControlsLocked: false },
      trainer: {
        usablePartyCount: 1,
        party: party ?? [{ slot: 0, species: 34, level: 43, hp: 10,
          maxHp: 132, status1: 8, moves: [33], pp: [0] }],
        bag: { items: [{ itemId: 22, quantity: 5 }, { itemId: 14, quantity: 1 }] },
      },
      ui,
    },
  };
}

function fixture({ healers = 2, initialState = null } = {}) {
  const world = recoveryWorld(healers);
  const planner = createCampaignPlanner({ world, campaign, initialState });
  const advisors = createPolicyAdvisors({ world, campaignPlanner: planner });
  const player = createCentralPlayer({ advisors });
  return { planner, player, inventory: advisors.find(({ id }) => id === "inventory") };
}

function interact(player, options = {}) {
  const decision = player.decide(observation(options));
  assert.equal(decision.winner?.recommendation.kind, "interact-with-object");
  assert.equal(decision.winner?.recommendation.target.index, 0);
  assert.deepEqual(decision.action.buttons, ["a"]);
  return decision;
}

function dialogue(player, options = {}) {
  return player.decide(observation({ ...options,
    ui: { fieldDialog: { stage: "awaiting-close" } },
  }));
}

test("two completed ineffective healer conversations reroute to another free healer", () => {
  const { planner, player } = fixture();
  interact(player);
  dialogue(player);
  interact(player);
  dialogue(player);
  assert.deepEqual(planner.selectRecovery(observation())?.target,
    { kind: "object", map: mapId, index: 1 });
});

test("a healer exclusion survives a checkpoint and stays authoritative over fallback and items", () => {
  const { planner, player } = fixture({ healers: 1 });
  interact(player);
  dialogue(player);
  interact(player);
  dialogue(player);
  assert.equal(planner.selectRecovery(observation()), null);
  const restored = fixture({ healers: 1, initialState: JSON.parse(JSON.stringify(planner.state())) });
  assert.equal(restored.planner.selectRecovery(observation()), null);
  assert.equal(restored.inventory.advise(observation())?.recommendation.kind, "open-start-menu");
});

test("a pending healer conversation survives checkpoint restoration", () => {
  const { planner, player } = fixture();
  interact(player);
  dialogue(player);
  interact(player);
  dialogue(player);
  const restored = fixture({ initialState: JSON.parse(JSON.stringify(planner.state())) });
  assert.equal(restored.planner.selectRecovery(observation())?.target.index, 1);
});

test("approach, facing, unconfirmed A presses and repeated dialogue pages are not failed heals", () => {
  const { planner, player } = fixture();
  for (let index = 0; index < 4; index += 1) {
    player.decide(observation({ position: { x: 2, y: 4 } }));
    player.decide(observation({ facing: "south" }));
    interact(player);
  }
  for (let index = 0; index < 6; index += 1) dialogue(player);
  assert.equal(planner.selectRecovery(observation())?.target.index, 0);
});

for (const [name, change] of [
  ["HP", { hp: 20 }], ["status", { status1: 0 }], ["PP", { pp: [10] }],
]) {
  test(`${name} recovery resets consecutive ineffective attempts and preserves the free healer`, () => {
    const { planner, player } = fixture();
    interact(player);
    dialogue(player);
    interact(player);
    dialogue(player);
    const party = [{ ...observation().playerMemory.trainer.party[0], ...change }];
    interact(player, { party });
    dialogue(player, { party });
    assert.equal(planner.selectRecovery(observation({ party }))?.target.index, 0);
    interact(player, { party });
    dialogue(player, { party });
    assert.equal(planner.selectRecovery(observation({ party }))?.target.index, 1);
  });
}

test("missing party observations cannot establish ineffective healing", () => {
  const { planner, player } = fixture();
  interact(player);
  dialogue(player);
  assert.equal(planner.selectRecovery(observation({ party: [] }))?.target.index, 0);
  interact(player);
  dialogue(player);
  assert.equal(planner.selectRecovery(observation())?.target.index, 0);
});

test('a stalled healing task selects a different reachable healer and remembers the rejection after restart',()=>{
 const {planner,player}=fixture();interact(player);
 const before=planner.state();
 assert.equal(typeof planner.recoverStalledTask,'function');
 const strategy=planner.recoverStalledTask(observation());
 assert.equal(strategy?.kind,'alternate-healer');
 assert.equal(strategy.from.index,0);assert.equal(strategy.to.index,1);
 const restored=fixture({initialState:JSON.parse(JSON.stringify(planner.state()))});
 assert.equal(restored.planner.selectRecovery(observation())?.target.index,1);
 assert.equal(restored.planner.state().completedThroughObjectiveId,before.completedThroughObjectiveId);
});

test('stalled task recovery refuses battles, unknown menus and protected transactions',()=>{
 for(const change of [o=>o.emulator.inBattle=true,o=>o.playerMemory.ui={saveDialog:{stage:'writing'}},
  o=>o.playerMemory.map.id='MAP_UNION_ROOM',o=>o.playerMemory.ui={choiceMenu:{cursor:0}}]){
  const {planner,player}=fixture();interact(player);const o=observation();change(o);
  assert.equal(planner.recoverStalledTask?.(o),null);
 }
});
