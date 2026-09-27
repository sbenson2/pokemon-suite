import assert from "node:assert/strict";
import test from "node:test";

test('returning home after obtaining Pokemon follows the current task instead of the opening exit route', () => {
  const home='MAP_PALLET_TOWN_PLAYERS_HOUSE_1F';
  let goal={id:'recover-party',target:{kind:'object',map:home,index:0},taskKind:'recovery',dialogue:'advance'};
  const planner={select:()=>goal,selectCollection:()=>null,selectTraining:()=>null};
  const advisors=createPolicyAdvisors({mechanics,world:playersHouseWorld,campaignPlanner:planner});
  const navigate=(position,hp=2)=>{
    const o=observation({playerMemory:{map:{id:home},position,avatar:{facing:'east'},
      trainer:{partyCount:1,usablePartyCount:1,party:[{slot:0,species:4,level:7,hp,maxHp:23}]}}});
    return advisors.find(a=>a.id==='navigation').advise(o)?.recommendation;
  };
  const enter=navigate({x:4,y:8});
  assert.equal(enter.objective,'recover-party');
  assert.equal(enter.kind,'move-toward');
  assert.notEqual(enter.direction,'south','move off the entrance toward Mom, never straight back outside');
  const interact=navigate({x:9,y:4});
  assert.equal(interact.objective,'recover-party');
  assert.equal(interact.kind,'interact-with-object');
  goal={id:'continue-campaign',target:{kind:'warp',map:home,index:1}};
  const leave=navigate({x:4,y:8},23);
  assert.equal(leave.objective,'continue-campaign');
  assert.equal(leave.kind,'traverse-directional-warp');
  assert.equal(leave.direction,'south');
});

import {
  createPolicyAdvisors,
  scoreBattleMoves,
} from "../src/player/advisors.js";
import {
  createCentralPlayer,
  executeCentralAction,
  mapRecommendation,
} from "../src/player/delegator.js";
import { createRunProfile } from "../src/player/run-profile.js";
import {
  createMasterTeamPlan,
  createOriginsTeamPlan,
} from "../src/player/origins-team.js";
import {
  createCampaignPlanner,
  createOriginsCampaign,
  selectTrainingObjective,
} from "../src/player/campaign.js";
import { runContinuousPlayer } from "../src/player/continuous-player.js";
import { actionPreconditionMatches } from "../src/emulator/action-precondition.js";

function observation(overrides = {}) {
  const captureId = overrides.captureId ?? "capture-42";
  const frame = overrides.frame ?? 42;
  const base = {
    captureId,
    frame,
    phase: "stable",
    phaseReasons: [],
    emulator: {
      captureId,
      frame,
      mode: "overworld",
      inputReady: true,
      callback2: "CB2_Overworld",
    },
    sram: { captureId, frame, sha256: "sram" },
    playerMemory: {
      captureId,
      frame,
      sha256: "memory",
      map: { id: "MAP_ROUTE1" },
      position: { x: 1, y: 1 },
      trainer: { usablePartyCount: 1, party: [] },
      battle: null,
      ui: {
        battle: null,
        party: null,
        fieldDialog: null,
        choiceMenu: null,
        startMenu: null,
        saveDialog: null,
        moveLearning: null,
        levelUp: null,
        evolution: null,
        blackout: null,
        newGame: null,
      },
    },
  };
  return {
    ...base,
    ...overrides,
    emulator: { ...base.emulator, ...overrides.emulator },
    sram: { ...base.sram, ...overrides.sram },
    playerMemory: {
      ...base.playerMemory,
      ...overrides.playerMemory,
      ui: { ...base.playerMemory.ui, ...overrides.playerMemory?.ui },
    },
  };
}

function withoutLocomotionMetadata(recommendation) {
  const {
    routePlan: _routePlan,
    travelMode: _travelMode,
    ...legacyRecommendation
  } = recommendation;
  return legacyRecommendation;
}

test("a repeating bag transaction is unwound and stops safely if two recovery attempts cannot change it", () => {
  const player = createCentralPlayer({ advisors: createPolicyAdvisors() });
  const recoveries = [];
  let decision;
  for (let index = 1; index <= 220; index += 1) {
    decision = player.decide(observation({ captureId: `menu-loop-${index}`, frame: index * 4,
      emulator: { mode: "bag-menu" }, playerMemory: {
        trainer: { partyCount: 1, usablePartyCount: 1,
          party: [{ slot: 0, species: 7, level: 30, hp: 90, maxHp: 90 }] },
        ui: { bag: { stage: "list", pocket: 0, cursor: index % 2 } },
      },
    }));
    if (decision.recovery) recoveries.push(decision.recovery);
    if (decision.kind === "blocked") break;
  }
  assert.ok(recoveries.some(({ action }) => action === "unwind-menu"));
  assert.equal(decision.kind, "blocked");
  assert.deepEqual(decision.action.buttons, []);
  assert.equal(player.state().transactionRecovery.blocked.reason, "repeated-menu-transaction");
  const resumed = createCentralPlayer({ initialState: JSON.parse(JSON.stringify(player.state())),
    advisors: createPolicyAdvisors() });
  assert.equal(resumed.decide(observation()).kind, "blocked");
});

test("productive item use is not a menu loop", () => {
  const player = createCentralPlayer({ advisors: createPolicyAdvisors() });
  for (let index = 1; index <= 220; index += 1) {
    const decision = player.decide(observation({ captureId: `productive-${index}`, frame: index * 4,
      emulator: { mode: "bag-menu" }, playerMemory: {
        trainer: { partyCount: 1, usablePartyCount: 1,
          party: [{ slot: 0, species: 7, level: 30, hp: index, maxHp: 300 }],
          bag: { items: [{ itemId: 13, quantity: 250 - index }] } },
        ui: { bag: { stage: "list", pocket: 0, cursor: index % 2 } },
      },
    }));
    assert.notEqual(decision.kind, "blocked");
    assert.equal(decision.recovery, undefined);
  }
});

test("central control closes a completed field reorder even if strategy requests another swap", () => {
  const advisors = [{ id: "inventory", advise: (observed) => ({
    advisor: "inventory", observationId: observed.captureId,
    recommendation: { kind: "choose-party-member", targetPartySlot: 1 },
    confidence: 1, constraints: [], vetoes: [], evidenceRefs: [],
  }) }];
  const player = createCentralPlayer({ advisors });
  const party = [
    { slot: 0, species: 7, personality: 1, otId: 3, hp: 20 },
    { slot: 1, species: 7, personality: 2, otId: 3, hp: 20 },
  ];
  const observed = (members, ui) => observation({ emulator: { mode: "party" },
    playerMemory: { trainer: { party: members }, ui: { party: ui } },
  });
  assert.deepEqual(player.decide(observed(party, { stage: "choose-switch-target", cursor: 1 })).action.buttons, ["a"]);
  const reordered = [{ ...party[1], slot: 0 }, { ...party[0], slot: 1 }];
  const decision = player.decide(observed(reordered, { stage: "choose-pokemon", cursor: 0 }));
  assert.deepEqual(decision.action.buttons, ["b"]);
  assert.equal(decision.recovery.reason, "complete-field-party-reorder");
  assert.equal(decision.reason, "field-party-reorder-complete");
  assert.equal(decision.kind, "act");
});

test("failed map-connection leases make the central player choose another crossing and survive resume", async () => {
  const world = { maps: [
    mapFromCollisionRows({ id: "MAP_A", rows: ["000", "000", "000"],
      connections: [{ direction: "right", map: "MAP_B", offset: 0 }] }),
    mapFromCollisionRows({ id: "MAP_B", rows: ["000", "000", "000"],
      connections: [{ direction: "left", map: "MAP_A", offset: 0 }] }),
  ] };
  const campaign = { objectives: [{ id: "cross", target: { kind: "map-arrival", map: "MAP_B", x: 1, y: 1 },
    completion: { kind: "flag-set", id: 9999 } }] };
  const makePlayer = (initialState = null) => {
    const campaignPlanner = createCampaignPlanner({ campaign, world });
    return createCentralPlayer({ initialState, campaignPlanner,
      advisors: createPolicyAdvisors({ campaignPlanner, world }) });
  };
  let capture = 0;
  const observed = () => observation({ captureId: `stuck-${++capture}`, frame: capture,
    playerMemory: { map: { id: "MAP_A" }, position: { x: 2, y: 1 },
      trainer: { partyCount: 1, usablePartyCount: 1,
        party: [{ slot: 0, species: 7, level: 50, hp: 100, maxHp: 100, moves: [57], pp: [15] }] } } });
  const player = makePlayer();
  const actions = [];
  await runContinuousPlayer({ player, maxDecisions: 4, emulator: {
    observe: async () => observed(),
    execute: async (action) => { actions.push(action); return { movementLease: "frame-limit" }; },
  } });
  assert.equal(actions[0].movementLease?.kind, "map-connection", JSON.stringify(actions));
  assert.ok(actions[3].buttons.includes("up") || actions[3].buttons.includes("down"),
    "three failed crossings must cause a different local approach");
  const resumed = makePlayer(JSON.parse(JSON.stringify(player.state())));
  assert.notEqual(resumed.decide(observed()).action.movementLease?.kind, "map-connection");
});

test("a cycling-road pull flip-flop reaches routing as bounded tile exclusions", () => {
  const seen = [];
  const advisor = { id: "navigation", advise: (observed) => {
    seen.push(observed);
    return { advisor: "navigation", observationId: observed.captureId,
      recommendation: { kind: "move-toward", direction: "south", objective: "train" },
      confidence: 1, constraints: [], vetoes: [], evidenceRefs: [] };
  } };
  const player = createCentralPlayer({ advisors: [advisor] });
  const positions = [];
  for (let n = 0; n < 6; n++) positions.push([5, 18], [5, 19], [5, 20], [5, 21], [5, 20], [5, 19]);
  for (const [index, [x, y]] of positions.entries()) {
    player.decide(observation({ captureId: `cycle-${index}`, frame: index * 20,
      playerMemory: { map: { id: "MAP_ROUTE17" }, position: { x, y },
        mapGrid: { cells: [{ x, y, collision: 0, elevation: 3, behaviorName: "MB_CYCLING_ROAD_PULL_DOWN" }],
          width: 10, height: 140 } } }));
  }
  const tiles = seen.at(-1)?.navigationExclusions?.tiles ?? [];
  assert.deepEqual(tiles.map(({ x, y }) => `${x},${y}`).sort(), ["5,18", "5,19", "5,20", "5,21"]);
  assert.ok(player.state().limitCycle, "the detector checkpoint is part of the central player state");
  const resumed = createCentralPlayer({ advisors: [advisor],
    initialState: JSON.parse(JSON.stringify(player.state())) });
  resumed.decide(observation({ captureId: "cycle-resume", frame: 5000,
    playerMemory: { map: { id: "MAP_ROUTE17" }, position: { x: 5, y: 18 },
      mapGrid: { cells: [{ x: 5, y: 18, collision: 0, elevation: 3, behaviorName: "MB_CYCLING_ROAD_PULL_DOWN" }],
        width: 10, height: 140 } } }));
  assert.ok((seen.at(-1)?.navigationExclusions?.tiles ?? []).some(({ x, y }) => x === 5 && y === 21),
    "resuming keeps the learned exclusions for the current map");
});

test("advisors share one training calculation per observation and refresh it for the next capture", () => {
  const campaignPlanner = createCampaignPlanner({ campaign: { objectives: [{
    id: "prepare-boss", importantBattle: true, minimumBattleMemberLevel: 40,
    target: { kind: "object", map: "MAP_ROUTE1", index: 0 },
    completion: { kind: "flag-set", id: 1234 },
  }] } });
  let trainingCalculations = 0;
  const advisors = createPolicyAdvisors({ campaignPlanner: {
    ...campaignPlanner,
    selectTraining(...args) {
      trainingCalculations += 1;
      return campaignPlanner.selectTraining(...args);
    },
  } });
  for (let index = 1; index <= 2; index += 1) {
    const observed = observation({ captureId: `planning-${index}`, frame: index });
    for (const advisor of advisors) advisor.advise(observed);
    assert.equal(trainingCalculations, index);
  }
});

const mechanics = {
  moves: {
    33: { id: 33, name: "MOVE_TACKLE", power: 40, accuracy: 100,
      effect: "EFFECT_HIT", type: "TYPE_NORMAL" },
    45: { id: 45, name: "MOVE_GROWL", power: 0, accuracy: 100,
      effect: "EFFECT_ATTACK_DOWN", type: "TYPE_NORMAL" },
    77: { id: 77, name: "MOVE_POISON_POWDER", power: 0, accuracy: 75,
      effect: "EFFECT_POISON", type: "TYPE_POISON" },
    79: { id: 79, name: "MOVE_SLEEP_POWDER", power: 0, accuracy: 75,
      effect: "EFFECT_SLEEP", type: "TYPE_GRASS" },
    75: { id: 75, name: "MOVE_RAZOR_LEAF", power: 55, accuracy: 95,
      effect: "EFFECT_HIGH_CRITICAL", type: "TYPE_GRASS" },
    73: { id: 73, name: "MOVE_LEECH_SEED", power: 0, accuracy: 90,
      effect: "EFFECT_LEECH_SEED", type: "TYPE_GRASS" },
    17: { id: 17, name: "MOVE_WING_ATTACK", power: 60, accuracy: 100,
      effect: "EFFECT_HIT", type: "TYPE_FLYING" },
    19: { id: 19, name: "MOVE_FLY", power: 70, accuracy: 95,
      effect: "EFFECT_SEMI_INVULNERABLE", type: "TYPE_FLYING" },
    53: { id: 53, name: "MOVE_FLAMETHROWER", power: 95, accuracy: 100,
      effect: "EFFECT_BURN_HIT", type: "TYPE_FIRE" },
    83: { id: 83, name: "MOVE_FIRE_SPIN", power: 15, accuracy: 70,
      effect: "EFFECT_TRAP", type: "TYPE_FIRE" },
    57: { id: 57, name: "MOVE_SURF", power: 95, accuracy: 100,
      effect: "EFFECT_HIT", type: "TYPE_WATER" },
    85: { id: 85, name: "MOVE_THUNDERBOLT", power: 95, accuracy: 100,
      effect: "EFFECT_PARALYZE_HIT", type: "TYPE_ELECTRIC",
      target: "MOVE_TARGET_SELECTED" },
    290: { id: 290, name: "MOVE_SECRET_POWER", power: 70, accuracy: 100,
      effect: "EFFECT_SECRET_POWER", type: "TYPE_NORMAL" },
  },
  species: {
    1: { id: 1, types: ["TYPE_GRASS", "TYPE_POISON"] },
    4: { id: 4, name: "SPECIES_CHARMANDER",
      types: ["TYPE_FIRE", "TYPE_FIRE"], baseDefense: 43, baseSpDefense: 50 },
    6: { id: 6, types: ["TYPE_FIRE", "TYPE_FLYING"] },
    7: { id: 7, types: ["TYPE_WATER", "TYPE_WATER"] },
    25: { id: 25, types: ["TYPE_ELECTRIC", "TYPE_ELECTRIC"] },
    59: { id: 59, types: ["TYPE_FIRE", "TYPE_FIRE"] },
    95: { id: 95, types: ["TYPE_ROCK", "TYPE_GROUND"] },
    131: { id: 131, name: "SPECIES_LAPRAS",
      types: ["TYPE_WATER", "TYPE_ICE"], baseAttack: 85, baseSpAttack: 85 },
  },
  typeChart: [
    { attackingType: "TYPE_FIRE", defendingType: "TYPE_FIRE", multiplier: 5 },
    { attackingType: "TYPE_WATER", defendingType: "TYPE_FIRE", multiplier: 20 },
    { attackingType: "TYPE_ELECTRIC", defendingType: "TYPE_WATER", multiplier: 20 },
    { attackingType: "TYPE_ELECTRIC", defendingType: "TYPE_GROUND", multiplier: 0 },
  ],
};

test("move scoring respects observed ability immunities and does not invent alternate abilities", () => {
  const document = { ...mechanics, moves: { ...mechanics.moves,
    89: { id: 89, name: "MOVE_EARTHQUAKE", type: "TYPE_GROUND", power: 100, accuracy: 100 },
    165: { id: 165, name: "MOVE_STRUGGLE", type: "TYPE_NORMAL", power: 50, accuracy: 100 },
  }, species: { ...mechanics.species,
    34: { id: 34, types: ["TYPE_POISON", "TYPE_GROUND"] },
    94: { id: 94, types: ["TYPE_GHOST", "TYPE_POISON"], abilities: ["ABILITY_LEVITATE", "ABILITY_NONE"] },
    134: { id: 134, types: ["TYPE_WATER"], abilities: ["ABILITY_WATER_ABSORB", "ABILITY_NONE"] },
    170: { id: 170, types: ["TYPE_WATER"], abilities: ["ABILITY_VOLT_ABSORB", "ABILITY_ILLUMINATE"] },
  }, typeChart: [...mechanics.typeChart,
    { attackingType: "TYPE_GROUND", defendingType: "TYPE_POISON", multiplier: 20 },
    { attackingType: "TYPE_NORMAL", defendingType: "TYPE_GHOST", multiplier: 0 },
  ] };
  const player = { species: 34, moves: [89, 57, 85, 53, 33, 165], pp: [10, 10, 10, 10, 10, 10],
    stats: { attack: 100, spAttack: 100 } };
  for (const [opponent, moveId, effectiveness] of [
    [{ species: 94, ability: 26 }, 89, 0],
    [{ species: 94 }, 89, 0],
    [{ species: 94, ability: 0 }, 89, 2],
    [{ species: 134 }, 57, 0],
    [{ species: 170, ability: 10 }, 85, 0],
    [{ species: 170, ability: 35 }, 85, 2],
    [{ species: 170 }, 85, 2],
    [{ species: 59, ability: 18 }, 53, 0],
    [{ species: 59, ability: 18, status1: 32 }, 53, 0.5],
    [{ species: 94, ability: 25 }, 57, 0],
    [{ species: 94, ability: 25 }, 89, 2],
    [{ species: 94, ability: 25 }, 165, 1],
  ]) {
    const scores = scoreBattleMoves({ mechanics: document, player, opponent });
    assert.equal(scores.find((entry) => entry.moveId === moveId).effectiveness, effectiveness,
      JSON.stringify({ opponent, moveId }));
  }
  assert.equal(scoreBattleMoves({ mechanics: document, player: { ...player, moves: [89, 57], pp: [10, 10] },
    opponent: { species: 94, ability: 26 } })[0].moveId, 57);
});

test("move scoring incorporates observed attack and defense stages", () => {
  const player = { species: 7, moves: [33, 57], pp: [10, 10], stats: { attack: 100, spAttack: 100 },
    statStages: { attack: 12, spAttack: 0 } };
  const scores = scoreBattleMoves({ mechanics, player, opponent: { species: 4,
    stats: { defense: 100, spDefense: 100 }, statStages: { defense: 6, spDefense: 12 } } });
  assert.equal(scores[0].moveId, 33);
});

test("battle healing does not spend medicine against a known Levitate-blocked attack", () => {
  const document = { ...mechanics, moves: { ...mechanics.moves,
    89: { id: 89, name: "MOVE_EARTHQUAKE", type: "TYPE_GROUND", power: 100, accuracy: 100 },
  } };
  const active = { slot: 0, species: 7, ability: 26, level: 50, hp: 20, maxHp: 150,
    moves: [57], pp: [15], stats: { attack: 100, defense: 100, spAttack: 100, spDefense: 100 } };
  const advice = createPolicyAdvisors({ mechanics: document,
    campaignPlanner: { select: () => ({ id: "test-boss", importantBattle: true }) },
  }).find(({ id }) => id === "battle").advise(observation({ emulator: { mode: "battle" },
    playerMemory: { battleTypeFlags: 12, battle: { playerPartySlot: 0, player: active,
      opponent: { species: 95, level: 50, hp: 150, maxHp: 150, moves: [89], pp: [10],
        stats: { attack: 120, defense: 100, spAttack: 100, spDefense: 100 } } },
      trainer: { partyCount: 1, usablePartyCount: 1, party: [active],
        bag: { items: [{ itemId: 20, quantity: 1 }] } },
      ui: { battle: { stage: "action", cursor: 0 } },
    },
  }));
  assert.equal(advice.recommendation.targetCommand, "fight");
});

function mapFromCollisionRows({
  id,
  rows,
  warpEvents = [],
  connections = [],
  coordEvents = [],
  objectEvents = [],
  behaviors = {},
  encounters = {},
  properties = {},
}) {
  return {
    id,
    properties,
    warpEvents,
    connections,
    coordEvents,
    objectEvents,
    layout: {
      id: `LAYOUT_${id.slice(4)}`,
      width: rows[0].length,
      height: rows.length,
      blockDataSha256: `${id.toLowerCase()}-fixture`,
      cells: rows.flatMap((row, y) =>
        [...row].map((symbol, x) => ({
          x,
          y,
          collision: symbol === "#" ? 1 : 0,
          elevation: symbol === "#" ? 0 : 3,
          behaviorName: behaviors[`${x},${y}`] ?? "MB_NORMAL",
          encounterType: encounters[`${x},${y}`] ?? 0,
        })),
      ),
    },
  };
}

test("navigation requests Running Shoes only for safe on-foot travel", () => {
  const recommend = ({
    shoes = true,
    allowRunning = true,
    onFoot = true,
    surfing = false,
    avatarFlags = onFoot ? 1 : 0,
    behavior = "MB_NORMAL",
  } = {}) => {
    const world = { maps: [mapFromCollisionRows({
      id: "MAP_RUNNING_TEST",
      rows: [".....", ".....", "....."],
      coordEvents: [{
        x: 4,
        y: 1,
        type: "trigger",
        var: "VAR_TEST",
        var_value: "0",
        script: "RunningTest_EventScript_Target",
      }],
      behaviors: { "1,1": behavior },
      properties: { allow_running: allowRunning },
    })] };
    const campaignPlanner = {
      select: () => ({
        id: "running-test",
        target: { kind: "trigger", map: "MAP_RUNNING_TEST", index: 0 },
      }),
    };
    const observed = observation({
      playerMemory: {
        map: { id: "MAP_RUNNING_TEST" },
        position: { x: 1, y: 1 },
        avatar: { flags: avatarFlags, onFoot, surfing },
        trainer: {
          partyCount: 1,
          usablePartyCount: 1,
          party: [{ slot: 0, species: 1, level: 5, hp: 20, maxHp: 20 }],
        },
        storyState: { flagIds: { 2095: shoes } },
      },
    });
    return createPolicyAdvisors({ mechanics, world, campaignPlanner })
      .flatMap((advisor) => advisor.advise(observed) ?? [])
      .find(({ advisor }) => advisor === "navigation")?.recommendation;
  };

  assert.equal(recommend().kind, "move-toward");
  assert.equal(recommend().useRunningShoes, true);
  assert.equal(recommend().travelMode, "run");
  assert.equal(recommend({ shoes: false }).travelMode, "walk");
  assert.equal(recommend({ onFoot: false, avatarFlags: 2 }).travelMode, "bicycle");
  assert.equal(recommend({ onFoot: false, surfing: true }).travelMode, "surf");
  assert.deepEqual(recommend().pathSegment, {
    direction: "east",
    steps: 3,
    endpoint: { map: "MAP_RUNNING_TEST", x: 4, y: 1 },
  });
  for (const unsafe of [
    { shoes: false },
    { allowRunning: false },
    { onFoot: false },
    { surfing: true },
    { behavior: "MB_RUNNING_DISALLOWED" },
  ]) {
    assert.equal(recommend(unsafe).useRunningShoes, undefined);
  }
});

test("navigation falls back when a committed training trainer becomes unsupported", () => {
  const map = mapFromCollisionRows({
    id: "MAP_TRAINING_FALLBACK_ROUTE",
    rows: [".......", ".......", "......."],
    objectEvents: [
      {
        x: 1,
        y: 0,
        script: "TrainingFallbackRoute_EventScript_Goal",
      },
      {
        x: 5,
        y: 1,
        script: "TrainingFallbackRoute_EventScript_Ada",
        trainer_type: "TRAINER_TYPE_NORMAL",
      },
    ],
    behaviors: {
      "1,2": "MB_TALL_GRASS",
      "2,2": "MB_TALL_GRASS",
    },
    encounters: { "1,2": 1, "2,2": 1 },
  });
  const world = {
    data: {
      maps: [map],
      wildEncounters: [{
        map: map.id,
        land_mons: {
          encounter_rate: 21,
          mons: [{
            min_level: 4,
            max_level: 5,
            species: "SPECIES_PIDGEY",
          }],
        },
      }],
    },
  };
  const story = {
    data: {
      symbols: {
        trainers: { TRAINER_LASS_ADA: { value: 11 } },
        flags: {},
        items: {},
      },
      scripts: [{
        label: "TrainingFallbackRoute_EventScript_Ada",
        instructions: [{
          op: "trainerbattle_single",
          args: ["TRAINER_LASS_ADA", "intro", "defeat"],
        }],
      }],
    },
  };
  const battleMechanics = {
    data: {
      trainers: [{
        id: 11,
        name: "TRAINER_LASS_ADA",
        trainerName: "ADA",
        party: [{ lvl: 10, species: "SPECIES_PIDGEY" }],
      }],
    },
  };
  const campaignPlanner = createCampaignPlanner({
    campaign: { objectives: [{
      id: "next-rival",
      target: { kind: "object", map: map.id, index: 0 },
      completion: { kind: "flag-set", id: 9999 },
      minimumTeamAnchorLevel: 18,
    }] },
    world,
    story,
    mechanics: battleMechanics,
  });
  const observed = observation({
    playerMemory: {
      map: { id: map.id },
      position: { x: 1, y: 1 },
      storyState: {
        variables: {},
        flags: {},
        variableIds: {},
        flagIds: { [0x500 + 11]: false, 9999: false },
      },
      trainer: {
        partyCount: 1,
        usablePartyCount: 1,
        party: [{
          slot: 0,
          species: 1,
          level: 12,
          hp: 35,
          maxHp: 35,
          moves: [],
        }],
        bag: {},
      },
    },
  });
  const objective = campaignPlanner.select(observed);
  assert.equal(
    campaignPlanner.selectTraining(observed, objective)?.trainer?.id,
    11,
  );
  observed.playerMemory.mapGrid = {
    width: map.layout.width,
    height: map.layout.height,
    cells: map.layout.cells.map((cell) => ({
      ...cell,
      collision: cell.x === 3 ? 1 : cell.collision,
    })),
  };

  const recommendation = createPolicyAdvisors({
    mechanics: battleMechanics,
    world,
    campaignPlanner,
  }).find(({ id }) => id === "navigation").advise(observed)?.recommendation;

  assert.equal(recommendation?.kind, "move-toward");
  assert.equal(recommendation?.direction, "south");
  assert.equal(recommendation?.objective, "train-team-anchor");
  assert.equal(recommendation?.target?.kind, "encounter-zone");
});

test("Seagallop menus select the requested island from every Tri-Pass harbor", () => {
  const cases = [
    ["MAP_ONE_ISLAND_HARBOR", "MAP_TWO_ISLAND", 0],
    ["MAP_ONE_ISLAND_HARBOR", "MAP_THREE_ISLAND", 1],
    ["MAP_TWO_ISLAND_HARBOR", "MAP_ONE_ISLAND", 0],
    ["MAP_TWO_ISLAND_HARBOR", "MAP_THREE_ISLAND", 1],
    ["MAP_THREE_ISLAND_HARBOR", "MAP_ONE_ISLAND", 0],
    ["MAP_THREE_ISLAND_HARBOR", "MAP_TWO_ISLAND", 1],
  ];

  for (const [origin, destination, targetIndex] of cases) {
    const observed = observation({
      playerMemory: {
        map: { id: origin },
        ui: {
          choiceMenu: {
            minCursor: 0,
            maxCursor: 2,
            cursor: 0,
            selected: null,
          },
        },
      },
    });
    const campaignPlanner = {
      select: () => ({
        id: `sail-${destination}`,
        target: { kind: "seagallop-destination", map: destination },
      }),
    };
    const recommendation = createPolicyAdvisors({ mechanics, campaignPlanner })
      .find(({ id }) => id === "quest")
      .advise(observed)?.recommendation;

    assert.deepEqual(recommendation, {
      kind: "choose-menu-option",
      targetIndex,
      objective: `sail-${destination}`,
    });
  }
});

test("ferry destinations follow the active story scene, including the completed Lostelle detour", () => {
  const maps = ["MAP_VERMILION_CITY", "MAP_ONE_ISLAND", "MAP_TWO_ISLAND", "MAP_THREE_ISLAND"];
  for (const scene of [2, 4]) for (const detourFinished of [false, true]) {
    for (const origin of [1, 2, 3]) {
      const destinations = (scene >= 4 ? [0, 1, 2, 3] : [1, 2, 3]).filter(i => i !== origin);
      for (const [targetIndex, destination] of destinations.entries()) {
        const objective = {id: "return-from-sevii", target: {kind: "seagallop-destination", map: maps[destination]}};
        const observed = observation({playerMemory: {
          map: {id: maps[origin] + "_HARBOR"},
          storyState: {flagIds: {673: detourFinished}, variableIds: {[0x4071]: scene, [0x4076]: 2, [0x8005]: 4}},
          ui: {choiceMenu: {minCursor: 0, maxCursor: destinations.length, cursor: 0, selected: null}},
        }});
        const advice = createPolicyAdvisors({mechanics, campaignPlanner: {select: () => objective}})
          .find(a => a.id === "quest").advise(observed)?.recommendation;
        assert.deepEqual(advice, {kind: "choose-menu-option", targetIndex, objective: objective.id},
          JSON.stringify({scene, detourFinished, origin, destination}));
      }
    }
  }
});

test("Rainbow ferry pages follow Celio's scene even when pass flags disagree", () => {
  for (const [scene, flag, page, destination, maxCursor, targetIndex] of [
    [4, true, 0, "MAP_ONE_ISLAND", 3, 1],
    [5, false, 0, "MAP_SIX_ISLAND", 5, 4],
    [5, false, 1, "MAP_SIX_ISLAND", 4, 1],
  ]) {
    const objective = {id: "sail", target: {kind: "seagallop-destination", map: destination}};
    const observed = observation({playerMemory: {
      map: {id: "MAP_THREE_ISLAND_HARBOR"},
      storyState: {flagIds: {2118: flag}, variableIds: {[0x4071]: 4, [0x4076]: scene, [0x8005]: page}},
      ui: {choiceMenu: {minCursor: 0, maxCursor, cursor: 0, selected: null}},
    }});
    const advice = createPolicyAdvisors({mechanics, campaignPlanner: {select: () => objective}})
      .find(a => a.id === "quest").advise(observed)?.recommendation;
    assert.deepEqual(advice, {kind: "choose-menu-option", targetIndex, objective: "sail"});
  }
});

test("an unavailable ferry destination cannot fall through to accepting another island", () => {
  const objective = {id: "sail-four", target: {kind: "seagallop-destination", map: "MAP_FOUR_ISLAND"}};
  const observed = observation({playerMemory: {
    map: {id: "MAP_THREE_ISLAND_HARBOR"},
    storyState: {flagIds: {673: true}, variableIds: {[0x4071]: 2, [0x4076]: 2}},
    ui: {choiceMenu: {minCursor: 0, maxCursor: 2, cursor: 0, selected: null}},
  }});
  const advice = createPolicyAdvisors({mechanics, campaignPlanner: {select: () => objective}})
    .find(a => a.id === "quest").advise(observed)?.recommendation;
  assert.equal(advice.kind, "stop-for-review");
  assert.equal(advice.objective, objective.id);
});

test("a field move owns its confirmation over an unrelated map-scoped story choice", () => {
  const map = mapFromCollisionRows({
    id: "MAP_CINNABAR_ISLAND",
    rows: ["#####", ".....", "#####"],
    behaviors: {
      "1,1": "MB_OCEAN_WATER",
      "2,1": "MB_OCEAN_WATER",
      "3,1": "MB_OCEAN_WATER",
    },
    objectEvents: [{ x: 0, y: 1, script: "Route21_EventScript_Trainer" }],
  });
  const objective = {
    id: "badge-earth",
    target: { kind: "object", map: map.id, index: 0 },
    completion: { kind: "flag-set", id: 2087 },
    choice: "no",
    choiceMaps: [map.id],
  };
  const world = { maps: [map], wildEncounters: [] };
  const campaignPlanner = createCampaignPlanner({
    campaign: { objectives: [objective] },
    world,
  });
  const player = createCentralPlayer({
    advisors: createPolicyAdvisors({ mechanics, world, campaignPlanner }),
    campaignPlanner,
  });
  const playerMemory = {
    map: { id: map.id },
    position: { x: 4, y: 1 },
    avatar: { flags: 1, onFoot: true, surfing: false, facing: "west" },
    storyState: { flagIds: { 2084: true, 2087: false } },
    trainer: {
      partyCount: 1,
      usablePartyCount: 1,
      party: [{
        slot: 0,
        species: 131,
        level: 51,
        hp: 196,
        maxHp: 196,
        moves: [57],
      }],
    },
  };

  const activation = player.decide(observation({
    captureId: "surf-activation",
    frame: 100,
    playerMemory,
  }));
  assert.equal(activation.winner?.recommendation.kind, "use-field-move");
  assert.deepEqual(activation.action.buttons, ["a"]);

  const confirmation = player.decide(observation({
    captureId: "surf-confirmation",
    frame: 200,
    playerMemory: {
      ...playerMemory,
      scripts: {
        globalStatus: "waiting",
        globalMode: "bytecode",
        fieldControlsLocked: true,
      },
      ui: {
        choiceMenu: {
          cursor: 0,
          minCursor: 0,
          maxCursor: 1,
          selected: "yes",
        },
      },
    },
  }));

  assert.equal(confirmation.winner?.advisor, "verifier");
  assert.deepEqual(confirmation.winner?.recommendation, {
    kind: "choose-menu-option",
    targetOption: "yes",
    objective: "badge-earth",
  });
  assert.deepEqual(confirmation.action.buttons, ["a"]);
});

test("a restored field-move workflow retains confirmation ownership", () => {
  const player = createCentralPlayer({
    advisors: [],
    initialState: {
      sequence: 20,
      initialSramSha256: "sram",
      workflow: {
        schema: "master-red/control-workflow/v1",
        id: "field-move-20",
        kind: "field-move-confirmation",
        objective: "cross-water",
        fieldMove: "surf",
        moveId: 57,
        direction: "west",
        sourceAdvisor: "navigation",
        stage: "opening-confirmation",
        enteredConfirmation: false,
        startedObservationId: "before-restart",
        startedFrame: 100,
      },
    },
  });
  const decision = player.decide(observation({
    captureId: "after-restart",
    frame: 200,
    playerMemory: {
      ui: {
        choiceMenu: {
          cursor: 0,
          minCursor: 0,
          maxCursor: 1,
          selected: "yes",
        },
      },
    },
  }));

  assert.equal(decision.winner?.advisor, "verifier");
  assert.deepEqual(decision.winner?.recommendation, {
    kind: "choose-menu-option",
    targetOption: "yes",
    objective: "cross-water",
  });
  assert.deepEqual(decision.action.buttons, ["a"]);
});

test("Cycling Road uphill navigation holds Up through the straight slope", () => {
  const world = { maps: [mapFromCollisionRows({
    id: "MAP_ROUTE17",
    rows: ["...", "...", "...", "..."],
    coordEvents: [{
      x: 1,
      y: 0,
      type: "trigger",
      var: "VAR_TEST",
      var_value: "0",
      script: "Route17_EventScript_Target",
    }],
    behaviors: {
      "1,3": "MB_CYCLING_ROAD_PULL_DOWN",
      "1,2": "MB_CYCLING_ROAD_PULL_DOWN",
    },
    properties: { allow_running: true },
  })] };
  const campaignPlanner = {
    select: () => ({
      id: "route17-uphill-target",
      target: { kind: "trigger", map: "MAP_ROUTE17", index: 0 },
    }),
  };
  const observed = observation({
    playerMemory: {
      map: { id: "MAP_ROUTE17" },
      position: { x: 1, y: 3 },
      avatar: {
        flags: 2,
        onFoot: false,
        surfing: false,
        facing: "south",
        movementDirection: "south",
      },
      trainer: {
        partyCount: 1,
        usablePartyCount: 1,
        party: [{ slot: 0, species: 1, level: 5, hp: 20, maxHp: 20 }],
      },
    },
  });
  const advice = createPolicyAdvisors({ mechanics, world, campaignPlanner })
    .flatMap((advisor) => advisor.advise(observed) ?? [])
    .find(({ advisor }) => advisor === "navigation");

  assert.equal(advice.recommendation.direction, "north");
  assert.equal(advice.recommendation.cyclingRoadSlope, true);
  const action = mapRecommendation(advice.recommendation, observed);
  assert.equal(action.kind, "sustained-chord");
  assert.deepEqual(action.buttons, ["b", "up"]);
  assert.equal(action.reason, "navigation-cycling-road-slope");
  assert.equal(action.movementLease.kind, "route-plan");
  assert.deepEqual(action.movementLease.target, {
    map: "MAP_ROUTE17", x: 1, y: 0,
  });
  assert.deepEqual(action.movementLease.continuationButtons, ["b"]);
  assert.deepEqual(action.movementLease.stopButtons, ["b"]);
});

test("a route starting on flat ground brakes for a slope beyond its first step or turn", () => {
  for (const curved of [false, true]) for (const source of ['layout','live']) {
    const rows=curved
      ? ['#######','#.....#','#.###.#','#.....#','#.#####','#.....#','#######']
      : ['#######','#.#####','#.#####','#.#####','#.#####','#.#####','#######'];
    const slope={x:1,y:curved?4:3};
    const map=mapFromCollisionRows({id:'MAP_CYCLING_APPROACH',rows,
      coordEvents:[{x:curved?5:1,y:1,type:'trigger',var:'VAR_TEST',var_value:'0',script:'Target'}],
      behaviors:source==='layout'?{[`${slope.x},${slope.y}`]:'MB_CYCLING_ROAD_PULL_DOWN'}:{}});
    const observed=observation({playerMemory:{map:{id:map.id},position:{x:curved?5:1,y:5},
      ...(source==='live'?{mapGrid:{cells:[{...slope,behaviorName:'MB_CYCLING_ROAD_PULL_DOWN'}]}}:{}),
      avatar:{flags:2,onFoot:false,surfing:false},
      trainer:{partyCount:1,usablePartyCount:1,party:[{slot:0,species:1,level:5,hp:20,maxHp:20}]}}});
    const campaignPlanner={select:()=>({id:'reach-trainer',target:{kind:'trigger',map:map.id,index:0}})};
    const advisors=createPolicyAdvisors({mechanics,world:{maps:[map]},campaignPlanner});
    const advice=advisors.find(a=>a.id==='navigation').advise(observed);
    assert.equal(advice.recommendation.direction,curved?'west':'north');
    assert.ok(advice.recommendation.routePlan.segments.length>=1);
    assert.equal(advice.recommendation.cyclingRoadSlope,true,`${curved}/${source}: inspect the full route`);
    const action=mapRecommendation(advice.recommendation,observed);
    assert.ok(action.buttons.includes('b'));
    assert.deepEqual(action.movementLease.continuationButtons,['b']);
    assert.deepEqual(action.movementLease.stopButtons,['b']);
    // Current cartridge tiles supersede the source layout, including when a
    // tile stops being a slope. Unrelated slopes never own ordinary bike input.
    observed.playerMemory.mapGrid={cells:[{...slope,behaviorName:'MB_NORMAL'},
      {x:3,y:0,behaviorName:'MB_CYCLING_ROAD_PULL_DOWN'}]};
    const normal=advisors.find(a=>a.id==='navigation').advise(observed);
    assert.notEqual(normal.recommendation.cyclingRoadSlope,true);
    assert.ok(!mapRecommendation(normal.recommendation,observed).buttons.includes('b'));
  }
});

test("Cycling Road downhill navigation brakes after its observed tile", () => {
  const observed = observation({
    playerMemory: {
      map: { id: "MAP_ROUTE17" },
      position: { x: 12, y: 40 },
      avatar: {
        flags: 2,
        onFoot: false,
        surfing: false,
        facing: "south",
        movementDirection: "south",
      },
    },
  });

  assert.deepEqual(mapRecommendation({
    kind: "move-toward",
    direction: "south",
    cyclingRoadSlope: true,
    travelMode: "bicycle",
    objective: "route17-downhill-target",
  }, observed), {
    kind: "sustained-chord",
    buttons: ["b", "down"],
    holdFrames: 4,
    releaseFrames: 0,
    reason: "navigation-cycling-road-slope",
    movementLease: {kind: "one-tile", origin: {map: "MAP_ROUTE17", x: 12, y: 40},
      maximumFrames: 60, continuationButtons: ["b"], stopButtons: ["b"]},
  });
});

test("Cycling Road downhill navigation keeps the brake through tile transitions", () => {
  const navigation = {
    id: "navigation",
    advise(observed) {
      return {
        advisor: "navigation",
        observationId: observed.captureId,
        recommendation: {
          kind: "move-toward",
          direction: "south",
          cyclingRoadSlope: true,
          travelMode: "bicycle",
          objective: "route17-downhill-target",
        },
        confidence: 1,
        constraints: ["cycling-road-downhill-pull"],
        vetoes: [],
        evidenceRefs: [`cartridge:frame:${observed.frame}`],
      };
    },
  };
  const verifier = createPolicyAdvisors({ mechanics })
    .find(({ id }) => id === "verifier");
  const player = createCentralPlayer({ advisors: [navigation, verifier] });
  const bicycle = {
    flags: 2,
    onFoot: false,
    surfing: false,
    facing: "south",
    movementDirection: "south",
  };

  const start = player.decide(observation({
    captureId: "coast-1",
    frame: 100,
    playerMemory: {
      map: { id: "MAP_ROUTE17" },
      position: { x: 12, y: 40 },
      avatar: bicycle,
    },
  }));
  assert.deepEqual(start.action.buttons, ["b", "down"]);
  assert.equal(start.action.reason, "navigation-cycling-road-slope");

  const transition = player.decide(observation({
    captureId: "coast-2",
    frame: 116,
    phase: "transition",
    phaseReasons: ["tile-transition"],
    emulator: {
      inputReady: false,
      input: { heldKeysRaw: 0, newKeysRaw: 0, heldKeys: 0, newKeys: 0 },
    },
    playerMemory: {
      map: { id: "MAP_ROUTE17" },
      position: { x: 12, y: 41 },
      mapGrid: {
        cells: [{
          x: 12,
          y: 41,
          collision: 0,
          elevation: 3,
          behaviorName: "MB_CYCLING_ROAD_PULL_DOWN",
        }],
      },
      avatar: bicycle,
    },
  }));

  assert.deepEqual(transition.action.buttons, ["b"]);
  assert.equal(transition.action.reason, "hold-cycling-road-brake-transition");
});

test("a trainer moving three tiles downhill gets an exact route instead of an open-ended coast", () => {
  const action = mapRecommendation({
    kind: "move-toward", direction: "south", cyclingRoadSlope: true,
    travelMode: "bicycle", objective: "mastery-trainer:MAP_ROUTE17:0",
    routePlan: {
      map: "MAP_ROUTE17", mapRevision: "a".repeat(64),
      origin: { x: 5, y: 18 }, destination: { x: 5, y: 21 }, steps: 3,
      segments: [{ direction: "south", steps: 3, endpoint: { x: 5, y: 21 } }],
    },
  }, observation({playerMemory: {map: {id: "MAP_ROUTE17"}, position: {x: 5, y: 18}}}));
  assert.deepEqual(action.buttons, ["b", "down"]);
  assert.equal(action.movementLease.kind, "route-plan");
  assert.deepEqual(action.movementLease.target, {map: "MAP_ROUTE17", x: 5, y: 21});
  assert.deepEqual(action.movementLease.continuationButtons, ["b"]);
});

test("Cycling Road lateral navigation steers through its segment before braking", () => {
  const observed = observation({
    playerMemory: {
      map: { id: "MAP_ROUTE17" },
      position: { x: 12, y: 40 },
      avatar: {
        flags: 2,
        onFoot: false,
        surfing: false,
        facing: "south",
        movementDirection: "south",
      },
    },
  });

  assert.deepEqual(mapRecommendation({
    kind: "move-toward",
    direction: "east",
    cyclingRoadSlope: true,
    travelMode: "bicycle",
    pathSegment: {
      direction: "east",
      steps: 4,
      endpoint: { map: "MAP_ROUTE17", x: 16, y: 40 },
      continuationDirection: "south",
    },
    objective: "route17-downhill-target",
  }, observed), {
    kind: "sustained-chord",
    buttons: ["b", "right"],
    holdFrames: 4,
    releaseFrames: 0,
    reason: "navigation-cycling-road-slope",
    movementLease: {
      kind: "route-segment",
      origin: { map: "MAP_ROUTE17", x: 12, y: 40 },
      target: { map: "MAP_ROUTE17", x: 16, y: 40 },
      maximumFrames: 156,
      stallFrames: 60,
      continuationButtons: ["b"],
      stopButtons: ["b"],
    },
  });
});

test("entering Cycling Road holds Up through the available uphill segment", () => {
  const world = { maps: [mapFromCollisionRows({
    id: "MAP_ROUTE17",
    rows: ["...", "...", "..."],
    coordEvents: [{
      x: 1,
      y: 0,
      type: "trigger",
      var: "VAR_TEST",
      var_value: "0",
      script: "Route17_EventScript_Target",
    }],
    behaviors: {
      "1,1": "MB_CYCLING_ROAD_PULL_DOWN",
      "1,0": "MB_CYCLING_ROAD_PULL_DOWN",
    },
  })] };
  const campaignPlanner = {
    select: () => ({
      id: "route17-uphill-target",
      target: { kind: "trigger", map: "MAP_ROUTE17", index: 0 },
    }),
  };
  const observed = observation({
    playerMemory: {
      map: { id: "MAP_ROUTE17" },
      position: { x: 1, y: 2 },
      avatar: {
        flags: 2,
        onFoot: false,
        surfing: false,
        facing: "south",
        movementDirection: "south",
      },
      trainer: {
        partyCount: 1,
        usablePartyCount: 1,
        party: [{ slot: 0, species: 1, level: 5, hp: 20, maxHp: 20 }],
      },
    },
  });
  const advice = createPolicyAdvisors({ mechanics, world, campaignPlanner })
    .flatMap((advisor) => advisor.advise(observed) ?? [])
    .find(({ advisor }) => advisor === "navigation");

  assert.equal(advice.recommendation.direction, "north");
  assert.equal(advice.recommendation.cyclingRoadSlope, true);
  const action = mapRecommendation(advice.recommendation, observed);
  assert.equal(action.kind, "sustained-chord");
  assert.deepEqual(action.buttons, ["b", "up"]);
  assert.equal(action.reason, "navigation-cycling-road-slope");
  assert.equal(action.movementLease.kind, "route-plan");
  assert.deepEqual(action.movementLease.segments, [{
    direction: "north",
    target: { map: "MAP_ROUTE17", x: 1, y: 0 },
  }]);
  assert.deepEqual(action.movementLease.continuationButtons, ["b"]);
  assert.deepEqual(action.movementLease.stopButtons, ["b"]);
});

test("Cycling Road facing holds direction through the turn before confirming the interaction", () => {
  const world = { maps: [mapFromCollisionRows({
    id: "MAP_ROUTE17",
    rows: ["...", "...", "..."],
    objectEvents: [{
      x: 0,
      y: 1,
      elevation: 3,
      script: "Route17_EventScript_Jaxon",
    }],
    behaviors: {
      "1,1": "MB_CYCLING_ROAD_PULL_DOWN",
    },
  })] };
  const campaignPlanner = {
    select: () => ({
      id: "mastery-trainer:MAP_ROUTE17:0",
      target: { kind: "object", map: "MAP_ROUTE17", index: 0 },
    }),
  };
  const recommend = (facing) => {
    const observed = observation({
      playerMemory: {
        map: { id: "MAP_ROUTE17" },
        position: { x: 1, y: 1 },
        avatar: {
          flags: 2,
          onFoot: false,
          surfing: false,
          facing,
          movementDirection: facing,
        },
        trainer: {
          partyCount: 1,
          usablePartyCount: 1,
          party: [{ slot: 0, species: 1, level: 5, hp: 20, maxHp: 20 }],
        },
      },
    });
    const advice = createPolicyAdvisors({ mechanics, world, campaignPlanner })
      .flatMap((advisor) => advisor.advise(observed) ?? [])
      .find(({ advisor }) => advisor === "navigation");
    return { observed, advice };
  };

  const facing = recommend("north");
  assert.equal(facing.advice.recommendation.kind, "interact-with-object");
  assert.equal(facing.advice.recommendation.direction, "west");
  assert.equal(facing.advice.recommendation.cyclingRoadSlope, true);
  assert.deepEqual(
    mapRecommendation(facing.advice.recommendation, facing.observed),
    {
      kind: "sustained-chord",
      buttons: ["b", "left"],
      holdFrames: 4,
      releaseFrames: 0,
      reason: "face-object-cycling-road-slope",
    },
  );

  const confirming = recommend("west");
  assert.equal(confirming.advice.recommendation.cyclingRoadSlope, true);
  assert.deepEqual(
    mapRecommendation(confirming.advice.recommendation, confirming.observed),
    {
      kind: "bounded-edge",
      buttons: ["b", "a"],
      holdFrames: 1,
      releaseFrames: 1,
      reason: "interact-with-object-cycling-road-slope",
    },
  );
});

test("Cycling Road field moves brake while facing and activating", () => {
  const southFacing = observation({
    playerMemory: {
      avatar: {
        flags: 2,
        onFoot: false,
        surfing: false,
        facing: "south",
        movementDirection: "south",
      },
    },
  });
  assert.deepEqual(
    mapRecommendation({
      kind: "use-field-move",
      fieldMove: "surf",
      direction: "north",
      cyclingRoadSlope: true,
    }, southFacing),
    {
      kind: "sustained-chord",
      buttons: ["b", "up"],
      holdFrames: 4,
      releaseFrames: 0,
      reason: "face-field-obstacle-cycling-road-slope",
    },
  );

  const northFacing = observation({
    playerMemory: {
      avatar: {
        flags: 2,
        onFoot: false,
        surfing: false,
        facing: "north",
        movementDirection: "north",
      },
    },
  });
  assert.deepEqual(
    mapRecommendation({
      kind: "use-field-move",
      fieldMove: "surf",
      direction: "north",
      cyclingRoadSlope: true,
    }, northFacing),
    {
      kind: "sustained-chord",
      buttons: ["b", "up", "a"],
      holdFrames: 4,
      releaseFrames: 0,
      reason: "use-field-move-cycling-road-slope",
    },
  );
});

test("navigation marks a Cycling Road Surf boundary for slope-safe control", () => {
  const world = { maps: [mapFromCollisionRows({
    id: "MAP_ROUTE17",
    rows: ["#.#", "#.#", "#.#", "#.#", "#.#"],
    objectEvents: [{
      x: 1,
      y: 0,
      script: "Route17_EventScript_SurfGoal",
    }],
    behaviors: {
      "1,1": "MB_CYCLING_ROAD_WATER",
      "1,2": "MB_CYCLING_ROAD_WATER",
      "1,3": "MB_CYCLING_ROAD_PULL_DOWN",
    },
  })] };
  const campaignPlanner = {
    select: () => ({
      id: "route17-surf-target",
      target: { kind: "object", map: "MAP_ROUTE17", index: 0 },
    }),
    selectCollection: () => null,
    selectTraining: () => null,
  };
  const observed = observation({
    playerMemory: {
      map: { id: "MAP_ROUTE17" },
      position: { x: 1, y: 3 },
      avatar: {
        flags: 2,
        onFoot: false,
        surfing: false,
        facing: "south",
        movementDirection: "south",
      },
      storyState: { flagIds: { 2084: true } },
      trainer: {
        partyCount: 1,
        usablePartyCount: 1,
        party: [{
          slot: 0,
          species: 7,
          level: 50,
          hp: 100,
          maxHp: 100,
          moves: [57],
        }],
      },
    },
  });
  const advice = createPolicyAdvisors({ mechanics, world, campaignPlanner })
    .flatMap((advisor) => advisor.advise(observed) ?? [])
    .find(({ advisor }) => advisor === "navigation");

  assert.equal(advice.recommendation.kind, "use-field-move");
  assert.equal(advice.recommendation.fieldMove, "surf");
  assert.equal(advice.recommendation.cyclingRoadSlope, true);
  assert.deepEqual(mapRecommendation(advice.recommendation, observed).buttons, [
    "b",
    "up",
  ]);
});

test("closing a Cycling Road sign keeps the bicycle brake held", () => {
  const world = { maps: [mapFromCollisionRows({
    id: "MAP_ROUTE17",
    rows: ["...", "...", "..."],
    behaviors: {
      "1,1": "MB_CYCLING_ROAD_PULL_DOWN",
      "1,2": "MB_SIGNPOST",
    },
  })] };
  const observed = observation({
    playerMemory: {
      map: { id: "MAP_ROUTE17" },
      position: { x: 1, y: 1 },
      avatar: {
        flags: 2,
        onFoot: false,
        surfing: false,
        facing: "south",
        movementDirection: "south",
      },
      scripts: {
        globalStatus: "running",
        globalMode: "native",
        globalNative: "WaitForAorBPress",
        fieldControlsLocked: true,
      },
      trainer: {
        partyCount: 1,
        usablePartyCount: 1,
        party: [{ slot: 0, species: 1, level: 5, hp: 20, maxHp: 20 }],
      },
      ui: {
        fieldDialog: {
          type: "hidden",
          stage: "awaiting-close",
          textPrinter: { active: false, state: 0, stateName: "handle-character" },
        },
      },
    },
  });
  const advice = createPolicyAdvisors({ mechanics, world })
    .flatMap((advisor) => advisor.advise(observed) ?? [])
    .find(({ recommendation }) =>
      recommendation.kind === "acknowledge-cartridge-prompt"
    );

  assert.equal(advice.recommendation.cyclingRoadSlope, true);
  assert.deepEqual(mapRecommendation(advice.recommendation, observed), {
    kind: "sustained-chord",
    buttons: ["b", "a"],
    holdFrames: 4,
    releaseFrames: 0,
    reason: "acknowledge-cartridge-prompt-cycling-road-slope",
  });
});

test("returning from battle while climbing Cycling Road brakes before choosing the next direction", () => {
  const route17 = mapFromCollisionRows({
    id: "MAP_ROUTE17",
    rows: ["...", "...", "..."],
    behaviors: {
      "1,1": "MB_CYCLING_ROAD_PULL_DOWN",
    },
  });
  const world = { maps: [route17] };
  const player = createCentralPlayer({
    advisors: createPolicyAdvisors({ mechanics, world }),
  });
  const slopeMemory = {
    map: { id: "MAP_ROUTE17" },
    position: { x: 1, y: 1 },
    mapGrid: {
      width: 3,
      height: 3,
      cells: route17.layout.cells,
    },
    avatar: {
      flags: 2,
      onFoot: false,
      surfing: false,
      facing: "north",
      movementDirection: "north",
    },
    trainer: {
      partyCount: 1,
      usablePartyCount: 1,
      party: [{ slot: 0, species: 1, level: 5, hp: 20, maxHp: 20 }],
    },
  };

  const closingPrompt = player.decide(observation({
    captureId: "cycling-return-1",
    frame: 100,
    playerMemory: {
      ...slopeMemory,
      scripts: {
        globalStatus: "running",
        globalMode: "native",
        globalNative: "WaitForAorBPress",
        fieldControlsLocked: true,
      },
      ui: {
        fieldDialog: {
          type: "hidden",
          stage: "awaiting-close",
          textPrinter: { active: false, state: 0, stateName: "handle-character" },
        },
      },
    },
  }));
  assert.deepEqual(closingPrompt.action.buttons, ["b", "a"]);

  const battleTransition = player.decide(observation({
    captureId: "cycling-return-2",
    frame: 130,
    phase: "transition",
    phaseReasons: ["battle-transition"],
    emulator: {
      mode: "battle",
      inputReady: false,
      input: { heldKeysRaw: 3, newKeysRaw: 0, heldKeys: 3, newKeys: 0 },
    },
    playerMemory: slopeMemory,
  }));
  assert.deepEqual(battleTransition.action.buttons, []);

  const overworldReturn = player.decide(observation({
    captureId: "cycling-return-3",
    frame: 160,
    phase: "transition",
    phaseReasons: ["callback-change", "palette-fade"],
    emulator: {
      mode: "overworld",
      inputReady: true,
      input: { heldKeysRaw: 0, newKeysRaw: 0, heldKeys: 0, newKeys: 0 },
    },
    playerMemory: slopeMemory,
  }));

  assert.deepEqual(overworldReturn.action, {
    kind: "sustained-chord",
    buttons: ["b"],
    holdFrames: 4,
    releaseFrames: 0,
    reason: "hold-cycling-road-brake-transition",
  });
});

test("the Cycling Road arrival brake stays owned through a transition observation", () => {
  const navigation = {
    id: "navigation",
    advise(observed) {
      return {
        advisor: "navigation",
        observationId: observed.captureId,
        recommendation: {
          kind: "move-toward",
          direction: "north",
          cyclingRoadSlope: true,
          objective: "route17-uphill-target",
        },
        confidence: 1,
        constraints: ["cycling-road-downhill-pull"],
        vetoes: [],
        evidenceRefs: [`cartridge:frame:${observed.frame}`],
      };
    },
  };
  const verifier = createPolicyAdvisors({ mechanics })
    .find(({ id }) => id === "verifier");
  const player = createCentralPlayer({ advisors: [navigation, verifier] });
  const bicycle = {
    flags: 2,
    onFoot: false,
    surfing: false,
    facing: "north",
    movementDirection: "north",
  };

  const start = player.decide(observation({
    captureId: "slope-1",
    frame: 100,
    playerMemory: {
      map: { id: "MAP_ROUTE17" },
      position: { x: 7, y: 37 },
      avatar: bicycle,
    },
  }));
  assert.deepEqual(start.action.movementLease.continuationButtons, ["b"]);

  const transition = player.decide(observation({
    captureId: "slope-2",
    frame: 108,
    phase: "transition",
    phaseReasons: ["tile-transition"],
    emulator: {
      inputReady: false,
      input: { heldKeysRaw: 0x02, newKeysRaw: 0, heldKeys: 0x02, newKeys: 0 },
    },
    playerMemory: {
      map: { id: "MAP_ROUTE17" },
      position: { x: 7, y: 36 },
      avatar: bicycle,
    },
  }));
  assert.equal(transition.reason, "continuous-movement-lease-transition");
  assert.deepEqual(transition.action, {
    kind: "sustained-chord",
    buttons: ["b"],
    holdFrames: 4,
    releaseFrames: 0,
    reason: "continue-movement-lease-tile-transition",
  });
});

test("navigation honors the campaign minimum level before advancing the story", () => {
  const world = {
    maps: [mapFromCollisionRows({
      id: "MAP_TRAINING_MEADOW",
      rows: [".....", ".....", "....."],
      encounters: { "1,1": 1, "2,1": 1 },
      behaviors: { "1,1": "MB_TALL_GRASS", "2,1": "MB_TALL_GRASS" },
    })],
    wildEncounters: [{
      map: "MAP_TRAINING_MEADOW",
      land_mons: {
        encounter_rate: 21,
        mons: [{ min_level: 4, max_level: 5, species: "SPECIES_PIDGEY" }],
      },
    }],
  };
  const campaignPlanner = {
    select() {
      return {
        id: "next-rival",
        target: { kind: "encounter-zone", map: "MAP_TRAINING_MEADOW" },
        minimumTeamAnchorLevel: 18,
      };
    },
  };
  const observed = observation({
    playerMemory: {
      map: { id: "MAP_TRAINING_MEADOW" },
      position: { x: 1, y: 1 },
      trainer: {
        partyCount: 1,
        usablePartyCount: 1,
        party: [{ slot: 0, species: 1, level: 12, hp: 35, maxHp: 35 }],
      },
    },
  });

  const navigation = createPolicyAdvisors({ mechanics, world, campaignPlanner })
    .flatMap((advisor) => advisor.advise(observed) ?? [])
    .find(({ advisor }) => advisor === "navigation");

  assert.equal(navigation.recommendation.objective, "train-team-anchor");
  assert.equal(navigation.recommendation.direction, "east");
  assert.ok(navigation.evidenceRefs.includes("campaign:preparation-for:next-rival"));
  assert.ok(navigation.evidenceRefs.includes("cartridge:team-anchor-level:12/18"));
});

test("navigation follows the campaign planner to an undefeated training trainer", () => {
  const map = mapFromCollisionRows({
    id: "MAP_TRAINER_ROUTE",
    rows: [".....", ".....", "....."],
    objectEvents: [{
      x: 3,
      y: 1,
      script: "TrainerRoute_EventScript_Ada",
      trainer_type: "TRAINER_TYPE_NORMAL",
    }],
    encounters: { "1,1": 1, "2,1": 1 },
    behaviors: { "1,1": "MB_TALL_GRASS", "2,1": "MB_TALL_GRASS" },
  });
  const world = {
    maps: [map],
    wildEncounters: [{
      map: map.id,
      land_mons: {
        encounter_rate: 21,
        mons: [{ min_level: 4, max_level: 5 }],
      },
    }],
  };
  const storyObjective = {
    id: "next-rival",
    target: { kind: "object", map: map.id, index: 0 },
    minimumTeamAnchorLevel: 18,
  };
  const campaignPlanner = {
    select: () => storyObjective,
    selectTraining: () => ({
      id: "train-team-anchor-with-trainer",
      target: { kind: "object", map: map.id, index: 0 },
      trainingSource: "trainer",
      currentTeamAnchorLevel: 12,
      minimumTeamAnchorLevel: 18,
      trainingPartySlot: 0,
      trainingSpecies: 1,
      forObjective: storyObjective.id,
      trainer: {
        id: 11,
        name: "TRAINER_LASS_ADA",
        displayName: "ADA",
        flagId: 0x500 + 11,
        minimumLevel: 10,
        maximumLevel: 10,
        partySize: 1,
      },
    }),
  };
  const observed = observation({
    playerMemory: {
      map: { id: map.id },
      position: { x: 1, y: 1 },
      trainer: {
        partyCount: 1,
        usablePartyCount: 1,
        party: [{ slot: 0, species: 1, level: 12, hp: 35, maxHp: 35 }],
      },
    },
  });

  const navigation = createPolicyAdvisors({ mechanics, world, campaignPlanner })
    .flatMap((advisor) => advisor.advise(observed) ?? [])
    .find(({ advisor }) => advisor === "navigation");

  assert.equal(navigation.recommendation.objective, "train-team-anchor-with-trainer");
  assert.equal(navigation.recommendation.direction, "east");
  assert.ok(navigation.evidenceRefs.includes("cartridge:trainer:11"));
  assert.ok(navigation.evidenceRefs.includes(`cartridge:trainer-flag:${0x500 + 11}`));
});

test("navigation treats local VS Seeker recharge as trainer training", () => {
  const map = mapFromCollisionRows({
    id: "MAP_REMATCH_RECHARGE_ROUTE",
    rows: ["......."],
  });
  const world = { maps: [map] };
  const storyObjective = {
    id: "next-boss",
    target: { kind: "map-arrival", map: map.id, x: 6, y: 0 },
  };
  const rechargeObjective = {
    id: "train-team-anchor-with-vs-seeker",
    target: {
      kind: "vs-seeker-recharge",
      map: map.id,
      x: 3,
      y: 0,
    },
    trainingSource: "vs-seeker-recharge",
    vsSeekerAction: "recharge",
    currentTeamAnchorLevel: 12,
    minimumTeamAnchorLevel: 18,
    trainingPartySlot: 0,
    trainingSpecies: 1,
    forObjective: storyObjective.id,
    trainer: {
      id: 42,
      name: "TRAINER_LASS_ADA_REMATCH",
      displayName: "ADA",
      flagId: 0x500 + 42,
      minimumLevel: 15,
      maximumLevel: 15,
      partySize: 1,
    },
  };
  const campaignPlanner = {
    select: () => storyObjective,
    selectTraining: () => rechargeObjective,
  };
  const observed = observation({
    playerMemory: {
      map: { id: map.id },
      position: { x: 3, y: 0 },
      vsSeeker: { batterySteps: 20 },
      trainer: {
        partyCount: 1,
        usablePartyCount: 1,
        party: [{ slot: 0, species: 1, level: 12, hp: 35, maxHp: 35 }],
      },
    },
  });

  const navigation = createPolicyAdvisors({ mechanics, world, campaignPlanner })
    .flatMap((advisor) => advisor.advise(observed) ?? [])
    .find(({ advisor }) => advisor === "navigation");

  assert.equal(navigation.recommendation.objective, rechargeObjective.id);
  assert.equal(navigation.recommendation.direction, "west");
  assert.equal(navigation.recommendation.remainingSteps, 3);
  assert.deepEqual(navigation.recommendation.pathSegment, {
    direction: "west",
    steps: 3,
    endpoint: { map: map.id, x: 0, y: 0 },
  });
  assert.ok(navigation.evidenceRefs.includes("cartridge:trainer:42"));
  assert.equal(
    navigation.evidenceRefs.some((reference) =>
      reference.startsWith("cartridge:land-encounters:")),
    false,
  );
});

const playersHouseWorld = {
  maps: [
    mapFromCollisionRows({
      id: "MAP_PALLET_TOWN_PLAYERS_HOUSE_2F",
      rows: [
        "############",
        "############",
        "#.......##..",
        "#.......##..",
        "#.....#.....",
        "#.....#.....",
        "#.#.........",
        "#...........",
        "#...........",
      ],
      warpEvents: [{
        x: 10,
        y: 2,
        elevation: 3,
        dest_map: "MAP_PALLET_TOWN_PLAYERS_HOUSE_1F",
        dest_warp_id: "2",
      }],
      behaviors: { "10,2": "MB_DOWN_LEFT_STAIR_WARP" },
    }),
    mapFromCollisionRows({
      id: "MAP_PALLET_TOWN_PLAYERS_HOUSE_1F",
      rows: [
        "#############",
        "#############",
        "#..........##",
        "#............",
        "#.....##.....",
        "#.....##.....",
        "#............",
        "##..........#",
        "#............",
        "#############",
      ],
      warpEvents: [
        { x: 5, y: 8, elevation: 3, dest_map: "MAP_PALLET_TOWN", dest_warp_id: "0" },
        { x: 4, y: 8, elevation: 3, dest_map: "MAP_PALLET_TOWN", dest_warp_id: "0" },
        { x: 10, y: 2, elevation: 3, dest_map: "MAP_PALLET_TOWN_PLAYERS_HOUSE_2F", dest_warp_id: "0" },
      ],
      objectEvents: [{ x: 8, y: 4, movement_range_x: 0, movement_range_y: 0 }],
      behaviors: {
        "10,2": "MB_UP_RIGHT_STAIR_WARP",
        "4,8": "MB_SOUTH_ARROW_WARP",
      },
    }),
    mapFromCollisionRows({
      id: "MAP_PALLET_TOWN",
      rows: [
        "############..##########",
        "############..##########",
        "##....................##",
        "##....................##",
        "##...#####....#####...##",
        "##...#####....#####...##",
        "##...#####....#####...##",
        "##..######...######...##",
        "##....................##",
        "##....................##",
        "##...........#######..##",
        "##...#####...#######..##",
        "##...........#######..##",
        "##...........#######..##",
        "##...#................##",
        "##....................##",
        "##...........######...##",
        "##....................##",
        "##....................##",
        "##....................##",
      ],
      coordEvents: [
        {
          x: 12,
          y: 1,
          elevation: 3,
          type: "trigger",
          var: "VAR_MAP_SCENE_PALLET_TOWN_OAK",
          var_value: "0",
          script: "PalletTown_EventScript_OakTriggerLeft",
        },
        {
          x: 13,
          y: 1,
          elevation: 3,
          type: "trigger",
          var: "VAR_MAP_SCENE_PALLET_TOWN_OAK",
          var_value: "0",
          script: "PalletTown_EventScript_OakTriggerRight",
        },
        {
          x: 13,
          y: 2,
          elevation: 3,
          type: "trigger",
          var: "VAR_TEMP_2",
          var_value: "1",
          script: "PalletTown_EventScript_SignLadyTrigger",
        },
      ],
      objectEvents: [
        { x: 3, y: 10 },
        { x: 13, y: 17 },
        { x: 10, y: 8, flag: "FLAG_HIDE_OAK_IN_PALLET_TOWN" },
      ],
      warpEvents: [
        {
          x: 6,
          y: 7,
          dest_map: "MAP_PALLET_TOWN_PLAYERS_HOUSE_1F",
          dest_warp_id: "1",
        },
        {
          x: 15,
          y: 7,
          dest_map: "MAP_PALLET_TOWN_RIVALS_HOUSE",
          dest_warp_id: "0",
        },
        {
          x: 16,
          y: 13,
          dest_map: "MAP_PALLET_TOWN_PROFESSOR_OAKS_LAB",
          dest_warp_id: "0",
        },
      ],
      behaviors: {
        "6,7": "MB_WARP_DOOR",
        "15,7": "MB_WARP_DOOR",
        "16,13": "MB_WARP_DOOR",
      },
      connections: [{ direction: "up", map: "MAP_ROUTE1", offset: 10 }],
    }),
    mapFromCollisionRows({
      id: "MAP_PALLET_TOWN_PROFESSOR_OAKS_LAB",
      rows: [
        "#############",
        "#############",
        ".............",
        "#............",
        "###.....###..",
        ".##..........",
        ".............",
        ".............",
        "#####...#####",
        ".............",
        ".............",
        ".............",
        "#...........#",
        "#############",
      ],
      warpEvents: [
        { x: 5, y: 12, elevation: 3, dest_map: "MAP_PALLET_TOWN", dest_warp_id: "2" },
        { x: 6, y: 12, elevation: 3, dest_map: "MAP_PALLET_TOWN", dest_warp_id: "2" },
        { x: 7, y: 12, elevation: 3, dest_map: "MAP_PALLET_TOWN", dest_warp_id: "2" },
      ],
      coordEvents: [
        ...[5, 6, 7].map((x) => ({
          x,
          y: 8,
          elevation: 3,
          type: "trigger",
          var: "VAR_MAP_SCENE_PALLET_TOWN_PROFESSOR_OAKS_LAB",
          var_value: "2",
          script: "PalletTown_ProfessorOaksLab_EventScript_LeaveStarterSceneTrigger",
        })),
        ...[
          [5, "PalletTown_ProfessorOaksLab_EventScript_RivalBattleTriggerLeft"],
          [6, "PalletTown_ProfessorOaksLab_EventScript_RivalBattleTriggerMid"],
          [7, "PalletTown_ProfessorOaksLab_EventScript_RivalBattleTriggerRight"],
        ].map(([x, script]) => ({
          x,
          y: 8,
          elevation: 3,
          type: "trigger",
          var: "VAR_MAP_SCENE_PALLET_TOWN_PROFESSOR_OAKS_LAB",
          var_value: "3",
          script,
        })),
      ],
      objectEvents: [
        { x: 3, y: 11, script: "PalletTown_ProfessorOaksLab_EventScript_Aide1" },
        { x: 2, y: 10, script: "PalletTown_ProfessorOaksLab_EventScript_Aide3" },
        { x: 11, y: 10, script: "PalletTown_ProfessorOaksLab_EventScript_Aide2" },
        { x: 6, y: 3, local_id: "LOCALID_OAKS_LAB_PROF_OAK", script: "PalletTown_ProfessorOaksLab_EventScript_ProfOak" },
        { x: 8, y: 4, local_id: "LOCALID_BULBASAUR_BALL", script: "PalletTown_ProfessorOaksLab_EventScript_BulbasaurBall" },
        { x: 9, y: 4, local_id: "LOCALID_SQUIRTLE_BALL", script: "PalletTown_ProfessorOaksLab_EventScript_SquirtleBall" },
        { x: 10, y: 4, local_id: "LOCALID_CHARMANDER_BALL", script: "PalletTown_ProfessorOaksLab_EventScript_CharmanderBall" },
        { x: 5, y: 4, local_id: "LOCALID_OAKS_LAB_RIVAL", script: "PalletTown_ProfessorOaksLab_EventScript_Rival" },
      ],
      behaviors: { "6,12": "MB_SOUTH_ARROW_WARP" },
    }),
    mapFromCollisionRows({
      id: "MAP_ROUTE1",
      rows: [".....", ".....", ".....", ".....", "....."],
      connections: [
        { direction: "down", map: "MAP_PALLET_TOWN", offset: -10 },
        { direction: "up", map: "MAP_VIRIDIAN_CITY", offset: 0 },
      ],
    }),
    mapFromCollisionRows({
      id: "MAP_VIRIDIAN_CITY",
      rows: [".....", ".....", ".....", ".....", "....."],
      connections: [{ direction: "down", map: "MAP_ROUTE1", offset: 0 }],
      warpEvents: [
        { x: 0, y: 4, dest_map: "MAP_UNUSED_0", dest_warp_id: "0" },
        { x: 1, y: 4, dest_map: "MAP_UNUSED_1", dest_warp_id: "0" },
        { x: 2, y: 4, dest_map: "MAP_UNUSED_2", dest_warp_id: "0" },
        { x: 3, y: 4, dest_map: "MAP_UNUSED_3", dest_warp_id: "0" },
        { x: 3, y: 2, dest_map: "MAP_VIRIDIAN_CITY_MART", dest_warp_id: "0" },
      ],
    }),
    mapFromCollisionRows({
      id: "MAP_VIRIDIAN_CITY_MART",
      rows: [".....", ".....", ".....", ".....", "....."],
    }),
  ],
};

test("battle type math applies a duplicated monotype only once", () => {
  const [surf] = scoreBattleMoves({
    mechanics,
    player: {
      species: 131,
      moves: [57],
      pp: [15],
      stats: { attack: 85, spAttack: 80 },
    },
    opponent: {
      species: 4,
      stats: { defense: 43, spDefense: 50 },
    },
  });

  assert.equal(surf.effectiveness, 2);
});

test("battle advice ranks cartridge move IDs against the observed battlers", () => {
  const candidates = scoreBattleMoves({
    mechanics,
    player: {
      species: 6,
      moves: [17, 53, 83, 19],
      pp: [23, 1, 15, 15],
      stats: { attack: 195, spAttack: 230 },
    },
    opponent: {
      species: 59,
      stats: { defense: 128, spDefense: 117 },
    },
  });
  assert.equal(candidates[0].moveId, 53);

  const observed = observation({
    emulator: { mode: "battle" },
    playerMemory: {
      battle: {
        player: {
          species: 6,
          moves: [17, 53, 83, 19],
          pp: [23, 1, 15, 15],
          stats: { attack: 195, spAttack: 230 },
        },
        opponent: {
          species: 59,
          hp: 193,
          stats: { defense: 128, spDefense: 117 },
        },
      },
      ui: { battle: { stage: "move", cursor: 1, selectedMoveId: 53 } },
    },
  });
  const proposals = createPolicyAdvisors({ mechanics }).flatMap((advisor) =>
    advisor.advise(observed) ?? []
  );
  const battle = proposals.find(({ advisor }) => advisor === "battle");
  assert.equal(battle.recommendation.kind, "choose-battle-move");
  assert.equal(battle.recommendation.targetMoveId, 53);
  assert.equal(battle.recommendation.targetMoveSlot, 1);
  assert.equal("buttons" in battle.recommendation, false);
});

test("live battle advice propagates observed weather and a double-battle partner's Cloud Nine", () => {
  const document = { ...mechanics, typeChart: [] };
  const active = { battler: 0, species: 7, level: 50, hp: 150, maxHp: 150,
    moves: [53, 57], pp: [10, 10], stats: { attack: 100, spAttack: 100 } };
  const opponent = { battler: 1, species: 95, hp: 150, maxHp: 150,
    stats: { defense: 100, spDefense: 100 } };
  for (const [partnerAbility, expectedMove] of [[0, 53], [13, 57]]) {
    const battle = createPolicyAdvisors({ mechanics: document }).find(({ id }) => id === "battle");
    const advice = battle.advise(observation({ emulator: { mode: "battle" }, playerMemory: {
      battleTypeFlags: 13, battle: { weather: 32, player: active, opponent,
        battlers: [active, opponent, { battler: 2, species: 6, hp: 100, ability: partnerAbility }],
      }, ui: { battle: { stage: "move", battler: 0, cursor: 0, selectedMoveId: 53 } },
    } }));
    assert.equal(advice.recommendation.targetMoveId, expectedMove);
  }
});

test("battle advice never reselects a disabled high-scoring move", () => {
  const observed = observation({
    emulator: { mode: "battle" },
    playerMemory: {
      battleTypeFlags: (1 << 2) | (1 << 3),
      battle: {
        player: {
          species: 6,
          moves: [17, 53, 0, 0],
          pp: [23, 15, 0, 0],
          stats: { attack: 195, spAttack: 230 },
          status2: 0,
          status3: 0,
          moveState: { disabledMove: 17, disableTurns: 3 },
        },
        opponent: {
          species: 59,
          hp: 193,
          moves: [],
          stats: { defense: 128, spDefense: 117 },
          status3: 0,
        },
      },
      ui: { battle: { stage: "move", cursor: 0, selectedMoveId: 17 } },
    },
  });

  const recommendation = createPolicyAdvisors({ mechanics })
    .flatMap((advisor) => advisor.advise(observed) ?? [])
    .find(({ advisor }) => advisor === "battle")?.recommendation;

  assert.equal(recommendation.kind, "choose-battle-move");
  assert.equal(recommendation.targetMoveId, 53);
  assert.equal(recommendation.targetMoveSlot, 1);
});

test("the central player confirms FireRed's legal default battle target", () => {
  const observed = observation({
    emulator: { mode: "battle" },
    playerMemory: {
      battleTypeFlags: (1 << 2) | 1,
      battle: {
        player: { battler: 0, species: 25, hp: 70, maxHp: 70 },
        opponent: { battler: 1, species: 74, hp: 40, maxHp: 70 },
        battlers: [
          { battler: 0, species: 25, hp: 70, maxHp: 70 },
          { battler: 1, species: 74, hp: 40, maxHp: 70 },
          { battler: 2, species: 35, hp: 60, maxHp: 60 },
          { battler: 3, species: 95, hp: 35, maxHp: 75 },
        ],
      },
      ui: {
        battle: {
          stage: "target",
          battler: 0,
          cursor: 3,
          selected: "battler-3",
          selectedSpecies: 95,
        },
      },
    },
  });
  const recommendation = createPolicyAdvisors({ mechanics })
    .flatMap((advisor) => advisor.advise(observed) ?? [])
    .find(({ advisor }) => advisor === "battle")?.recommendation;

  assert.deepEqual(recommendation, {
    kind: "confirm-battle-target",
    targetBattler: 3,
    targetSpecies: 95,
  });
  assert.deepEqual(mapRecommendation(recommendation, observed).buttons, ["a"]);
});

test("a double battle scores moves for the player-right battler", () => {
  const observed = observation({
    emulator: { mode: "battle" },
    playerMemory: {
      battleTypeFlags: (1 << 2) | (1 << 3) | (1 << 0),
      battle: {
        player: {
          battler: 0,
          species: 1,
          moves: [33, 0, 0, 0],
          pp: [20, 0, 0, 0],
          stats: { attack: 40, spAttack: 40 },
        },
        opponent: {
          battler: 1,
          species: 95,
          hp: 80,
          maxHp: 80,
          stats: { defense: 60, spDefense: 60 },
        },
        battlers: [
          {
            battler: 0,
            species: 1,
            moves: [33, 0, 0, 0],
            pp: [20, 0, 0, 0],
            stats: { attack: 40, spAttack: 40 },
          },
          {
            battler: 1,
            species: 95,
            hp: 80,
            maxHp: 80,
            stats: { defense: 60, spDefense: 60 },
          },
          {
            battler: 2,
            species: 25,
            moves: [85, 33, 0, 0],
            pp: [15, 20, 0, 0],
            stats: { attack: 30, spAttack: 90 },
          },
          {
            battler: 3,
            species: 7,
            hp: 70,
            maxHp: 70,
            stats: { defense: 50, spDefense: 50 },
          },
        ],
        battlerPartyIndexes: [0, 0, 1, 1],
        playerPartySlot: 0,
      },
      trainer: {
        partyCount: 2,
        usablePartyCount: 2,
        party: [
          { slot: 0, species: 1, hp: 60, maxHp: 60 },
          { slot: 1, species: 25, hp: 70, maxHp: 70 },
        ],
        bag: { items: [] },
      },
      ui: {
        battle: {
          stage: "move",
          battler: 2,
          cursor: 0,
          selectedMoveId: 85,
        },
      },
    },
  });

  const recommendation = createPolicyAdvisors({ mechanics })
    .flatMap((advisor) => advisor.advise(observed) ?? [])
    .find(({ advisor }) => advisor === "battle")?.recommendation;

  assert.equal(recommendation.kind, "choose-battle-move");
  assert.equal(recommendation.targetMoveId, 85);
  assert.equal(recommendation.targetMoveSlot, 0);
  assert.equal(recommendation.targetBattler, 3);
});

test("a double-battle command never reuses the partner's queued switch", () => {
  const doubleMechanics = {
    ...mechanics,
    moves: {
      ...mechanics.moves,
      2: { id: 2, name: "MOVE_KARATE_CHOP", power: 50, accuracy: 100,
        effect: "EFFECT_HIGH_CRITICAL", type: "TYPE_FIGHTING" },
      10: { id: 10, name: "MOVE_SCRATCH", power: 40, accuracy: 100,
        effect: "EFFECT_HIT", type: "TYPE_NORMAL" },
    },
    species: {
      ...mechanics.species,
      35: { id: 35, types: ["TYPE_NORMAL", "TYPE_NORMAL"] },
      39: { id: 39, types: ["TYPE_NORMAL", "TYPE_NORMAL"] },
      44: { id: 44, types: ["TYPE_GRASS", "TYPE_POISON"] },
      53: { id: 53, types: ["TYPE_NORMAL", "TYPE_NORMAL"] },
      57: { id: 57, types: ["TYPE_FIGHTING", "TYPE_FIGHTING"] },
    },
    typeChart: [
      ...mechanics.typeChart,
      { attackingType: "TYPE_FIGHTING", defendingType: "TYPE_NORMAL",
        multiplier: 20 },
    ],
  };
  const observed = observation({
    emulator: { mode: "battle" },
    playerMemory: {
      battleTypeFlags: (1 << 2) | (1 << 3) | (1 << 0),
      battle: {
        player: {
          battler: 0,
          species: 44,
          level: 32,
          hp: 84,
          maxHp: 84,
          moves: [33, 0, 0, 0],
          pp: [20, 0, 0, 0],
          stats: { attack: 51, defense: 64, spAttack: 64, spDefense: 59 },
        },
        opponent: {
          battler: 1,
          species: 35,
          level: 22,
          hp: 62,
          maxHp: 62,
          stats: { defense: 26, spDefense: 36 },
        },
        battlers: [
          { battler: 0, species: 44, level: 32, hp: 84, maxHp: 84,
            moves: [33, 0, 0, 0], pp: [20, 0, 0, 0],
            stats: { attack: 51, defense: 64, spAttack: 64, spDefense: 59 } },
          { battler: 1, species: 35, level: 22, hp: 62, maxHp: 62,
            stats: { defense: 26, spDefense: 36 } },
          { battler: 2, species: 53, level: 30, hp: 85, maxHp: 85,
            moves: [10, 0, 0, 0], pp: [35, 0, 0, 0],
            stats: { attack: 46, defense: 51, spAttack: 45, spDefense: 53 } },
          { battler: 3, species: 39, level: 22, hp: 82, maxHp: 82,
            stats: { defense: 13, spDefense: 16 } },
        ],
        battlerPartyIndexes: [0, 0, 1, 1],
        monToSwitchIntoIds: [2, 6, 6, 6],
        playerPartySlot: 0,
        absentBattlerFlags: 0,
      },
      trainer: {
        partyCount: 3,
        usablePartyCount: 3,
        party: [
          { slot: 0, species: 44, level: 32, hp: 84, maxHp: 84,
            moves: [33], stats: { attack: 51, defense: 64,
              spAttack: 64, spDefense: 59 } },
          { slot: 1, species: 53, level: 30, hp: 85, maxHp: 85,
            moves: [10], stats: { attack: 46, defense: 51,
              spAttack: 45, spDefense: 53 } },
          { slot: 2, species: 57, level: 30, hp: 82, maxHp: 82,
            moves: [2], stats: { attack: 86, defense: 47,
              spAttack: 43, spDefense: 45 } },
        ],
        bag: { items: [] },
      },
      ui: {
        battle: { stage: "action", battler: 2, cursor: 0, selected: "fight" },
      },
    },
  });

  const recommendation = createPolicyAdvisors({ mechanics: doubleMechanics })
    .flatMap((advisor) => advisor.advise(observed) ?? [])
    .find(({ advisor }) => advisor === "battle")?.recommendation;

  assert.deepEqual(recommendation, {
    kind: "choose-battle-command",
    targetCommand: "fight",
  });
});

test("a double battle redirects a selected move to its best opponent", () => {
  const observed = observation({
    emulator: { mode: "battle" },
    playerMemory: {
      battleTypeFlags: (1 << 2) | (1 << 3) | (1 << 0),
      battle: {
        player: { battler: 0, species: 1 },
        opponent: { battler: 1, species: 95 },
        battlers: [
          { battler: 0, species: 1 },
          {
            battler: 1,
            species: 95,
            hp: 80,
            maxHp: 80,
            stats: { defense: 60, spDefense: 60 },
          },
          {
            battler: 2,
            species: 25,
            moves: [85, 33, 0, 0],
            pp: [15, 20, 0, 0],
            stats: { attack: 30, spAttack: 90 },
          },
          {
            battler: 3,
            species: 7,
            hp: 70,
            maxHp: 70,
            stats: { defense: 50, spDefense: 50 },
          },
        ],
        battlerPartyIndexes: [0, 0, 1, 1],
        playerPartySlot: 0,
      },
      trainer: {
        partyCount: 2,
        usablePartyCount: 2,
        party: [
          { slot: 0, species: 1, hp: 60, maxHp: 60 },
          { slot: 1, species: 25, hp: 70, maxHp: 70 },
        ],
        bag: { items: [] },
      },
      ui: {
        battle: {
          stage: "target",
          battler: 2,
          cursor: 1,
          selected: "battler-1",
          selectedSpecies: 95,
          selectedMoveId: 85,
        },
      },
    },
  });

  const recommendation = createPolicyAdvisors({ mechanics })
    .flatMap((advisor) => advisor.advise(observed) ?? [])
    .find(({ advisor }) => advisor === "battle")?.recommendation;

  assert.deepEqual(recommendation, {
    kind: "confirm-battle-target",
    targetBattler: 3,
    targetSpecies: 7,
  });
  assert.deepEqual(mapRecommendation(recommendation, observed).buttons, ["left"]);
});

test("Perish Song at zero triggers a legal emergency switch", () => {
  const party = [
    { slot: 0, species: 25, level: 40, hp: 80, maxHp: 100 },
    { slot: 1, species: 131, level: 38, hp: 140, maxHp: 160 },
  ];
  const recommend = (ui) => {
    const observed = observation({
      emulator: { mode: "battle" },
      playerMemory: {
        battleTypeFlags: (1 << 2) | (1 << 3),
        battle: {
          playerPartySlot: 0,
          player: {
            battler: 0,
            species: 25,
            hp: 80,
            maxHp: 100,
            status2: 0,
            status3: 1 << 5,
            moveState: { perishSongTurns: 0 },
          },
          opponent: { battler: 1, species: 94, hp: 90, maxHp: 110 },
          battlers: [
            { battler: 0, species: 25, status3: 1 << 5 },
            { battler: 1, species: 94 },
          ],
        },
        trainer: {
          partyCount: 2,
          usablePartyCount: 2,
          party,
          bag: { items: [] },
        },
        ui,
      },
    });
    return createPolicyAdvisors({ mechanics })
      .flatMap((advisor) => advisor.advise(observed) ?? [])
      .find(({ advisor }) => advisor === "battle")?.recommendation;
  };

  assert.deepEqual(recommend({ battle: { stage: "action", cursor: 0 } }), {
    kind: "choose-battle-command",
    targetCommand: "pokemon",
    objective: "escape-perish-song",
    targetPartySlot: 1,
  });
  assert.deepEqual(recommend({
    battle: null,
    party: { stage: "choose-pokemon", cursor: 0 },
  }), {
    kind: "choose-party-member",
    targetPartySlot: 1,
    targetSpecies: 131,
    objective: "escape-perish-song",
  });
});

test("the battle policy leaves a wild encounter when recovery resources are critical", () => {
  const battleState = {
    playerPartySlot: 0,
    sentPartyMasks: [0b000001],
    player: {
      species: 1,
      hp: 10,
      maxHp: 59,
      moves: [33, 45, 0, 0],
      pp: [0, 10, 0, 0],
      stats: { attack: 30, spAttack: 30 },
    },
    opponent: {
      species: 4,
      hp: 29,
      maxHp: 29,
      stats: { defense: 20, spDefense: 20 },
    },
  };
  const inMoveMenu = observation({
    emulator: { mode: "battle" },
    playerMemory: {
      // FireRed always sets BATTLE_TYPE_IS_MASTER in a local wild battle.
      battleTypeFlags: 1 << 2,
      battle: battleState,
      ui: { battle: { stage: "move", cursor: 0, selectedMoveId: 33 } },
    },
  });
  const moveProposal = createPolicyAdvisors({ mechanics })
    .map((advisor) => advisor.advise(inMoveMenu))
    .find((entry) => entry?.advisor === "battle");
  assert.equal(moveProposal.recommendation.kind, "cancel-battle-move-for-run");
  assert.deepEqual(mapRecommendation(
    moveProposal.recommendation,
    inMoveMenu,
  ).buttons, ["b"]);

  const inActionMenu = observation({
    emulator: { mode: "battle" },
    playerMemory: {
      battleTypeFlags: 1 << 2,
      battle: battleState,
      ui: { battle: { stage: "action", cursor: 0 } },
    },
  });
  const actionProposal = createPolicyAdvisors({ mechanics })
    .map((advisor) => advisor.advise(inActionMenu))
    .find((entry) => entry?.advisor === "battle");
  assert.deepEqual(actionProposal.recommendation, {
    kind: "choose-battle-command",
    targetCommand: "run",
    objective: "preserve-recovery-resources",
  });
});

test("the battle policy escapes an unidentified Pokémon Tower ghost", () => {
  const battleState = {
    playerPartySlot: 0,
    player: {
      species: 6,
      level: 37,
      hp: 110,
      maxHp: 110,
      moves: [53, 17, 83, 19],
      pp: [15, 25, 15, 15],
      stats: { attack: 90, speed: 95, spAttack: 105 },
    },
    opponent: {
      species: 92,
      level: 16,
      hp: 42,
      maxHp: 42,
      stats: { defense: 30, speed: 35, spDefense: 35 },
    },
  };
  const recommend = (battleUi) => {
    const observed = observation({
      emulator: { mode: "battle" },
      playerMemory: {
        map: { id: "MAP_POKEMON_TOWER_4F" },
        battleTypeFlags: (1 << 2) | (1 << 15),
        battle: battleState,
        trainer: {
          partyCount: 1,
          usablePartyCount: 1,
          party: [{ slot: 0, species: 6, level: 37, hp: 110, maxHp: 110 }],
          bag: { items: [], keyItems: [] },
        },
        ui: { battle: battleUi },
      },
    });
    return createPolicyAdvisors({ mechanics })
      .flatMap((advisor) => advisor.advise(observed) ?? [])
      .find(({ advisor }) => advisor === "battle")?.recommendation;
  };

  assert.deepEqual(recommend({ stage: "action", cursor: 0 }), {
    kind: "choose-battle-command",
    targetCommand: "run",
    objective: "escape-unidentified-ghost",
  });
  assert.deepEqual(recommend({ stage: "move", cursor: 0, selectedMoveId: 53 }), {
    kind: "cancel-battle-move-for-run",
    objective: "escape-unidentified-ghost",
  });
});

test("a wrapped battler fights instead of retrying an impossible escape", () => {
  const observed = observation({
    emulator: { mode: "battle" },
    playerMemory: {
      battleTypeFlags: 1 << 2,
      battle: {
        playerPartySlot: 0,
        player: {
          species: 1,
          hp: 10,
          maxHp: 59,
          moves: [33, 45, 0, 0],
          pp: [10, 10, 0, 0],
          stats: { attack: 30, speed: 30, spAttack: 30 },
          status2: 3 << 13,
          status3: 0,
        },
        opponent: {
          species: 4,
          hp: 29,
          maxHp: 29,
          stats: { defense: 20, speed: 20, spDefense: 20 },
          ability: 0,
        },
      },
      ui: { battle: { stage: "action", cursor: 3, selected: "run" } },
    },
  });

  const recommendation = createPolicyAdvisors({ mechanics })
    .flatMap((advisor) => advisor.advise(observed) ?? [])
    .find(({ advisor }) => advisor === "battle")?.recommendation;

  assert.deepEqual(recommendation, {
    kind: "choose-battle-command",
    targetCommand: "fight",
    objective: "resolve-escape-block",
  });
});

test("a wrapped battler selects a usable move instead of cancelling for Run", () => {
  const observed = observation({
    emulator: { mode: "battle" },
    playerMemory: {
      battleTypeFlags: 1 << 2,
      battle: {
        player: {
          species: 1,
          hp: 10,
          maxHp: 59,
          moves: [33, 45, 0, 0],
          pp: [10, 10, 0, 0],
          stats: { attack: 30, speed: 30, spAttack: 30 },
          status2: 3 << 13,
          status3: 0,
        },
        opponent: {
          species: 4,
          hp: 29,
          maxHp: 29,
          stats: { defense: 20, speed: 20, spDefense: 20 },
          ability: 0,
        },
      },
      ui: { battle: { stage: "move", cursor: 1, selectedMoveId: 45 } },
    },
  });

  const recommendation = createPolicyAdvisors({ mechanics })
    .flatMap((advisor) => advisor.advise(observed) ?? [])
    .find(({ advisor }) => advisor === "battle")?.recommendation;

  assert.equal(recommendation.kind, "choose-battle-move");
  assert.equal(recommendation.targetMoveId, 33);
  assert.equal(recommendation.targetMoveSlot, 0);
});

test("a trapped trainer matchup attacks instead of opening an unusable switch", () => {
  const observed = observation({
    emulator: { mode: "battle" },
    playerMemory: {
      battleTypeFlags: (1 << 2) | (1 << 3),
      battle: {
        playerPartySlot: 0,
        player: {
          species: 1,
          level: 30,
          hp: 90,
          maxHp: 90,
          moves: [33, 45, 0, 0],
          pp: [20, 20, 0, 0],
          stats: { attack: 55, speed: 45, spAttack: 55 },
          status2: 3 << 13,
          status3: 0,
        },
        opponent: {
          species: 6,
          level: 30,
          hp: 100,
          maxHp: 100,
          stats: { defense: 70, speed: 70, spDefense: 70 },
          ability: 0,
        },
      },
      trainer: {
        partyCount: 2,
        usablePartyCount: 2,
        party: [
          { slot: 0, species: 1, level: 30, hp: 90, maxHp: 90, moves: [33] },
          { slot: 1, species: 131, level: 30, hp: 110, maxHp: 110, moves: [57] },
        ],
        bag: { items: [] },
      },
      ui: { battle: { stage: "action", cursor: 0, selected: "fight" } },
    },
  });

  const recommendation = createPolicyAdvisors({ mechanics })
    .flatMap((advisor) => advisor.advise(observed) ?? [])
    .find(({ advisor }) => advisor === "battle")?.recommendation;

  assert.equal(recommendation.kind, "choose-battle-command");
  assert.equal(recommendation.targetCommand, "fight");
});

test("the battle policy immediately runs from Safari encounters", () => {
  const observed = observation({
    emulator: { mode: "battle" },
    playerMemory: {
      battleTypeFlags: (1 << 2) | (1 << 7),
      battle: {
        player: { species: 1, hp: 59, maxHp: 59, moves: [], pp: [] },
        opponent: { species: 113, hp: 150, maxHp: 150 },
      },
      ui: { battle: { stage: "action", cursor: 0 } },
    },
  });
  const battle = createPolicyAdvisors({ mechanics })
    .map((advisor) => advisor.advise(observed))
    .find((entry) => entry?.advisor === "battle");

  assert.deepEqual(battle.recommendation, {
    kind: "choose-battle-command",
    targetCommand: "run",
    objective: "leave-safari-encounter",
  });
  assert.deepEqual(mapRecommendation(battle.recommendation, observed).buttons,
    ["down"]);
});

test("a roster acquisition catches only its requested wild species", () => {
  const campaignPlanner = { select: () => ({
    id: "origins-persian-capture",
    target: { kind: "encounter-zone", map: "MAP_ROUTE5" },
    captureSpecies: [52],
    captureFamily: [52, 53],
  }) };
  const battleState = (species, status2 = 0) => ({
    player: {
      species: 7,
      hp: 50,
      maxHp: 50,
      moves: [33],
      pp: [20],
      status2,
      stats: { attack: 30, spAttack: 30 },
    },
    opponent: {
      species,
      hp: 30,
      maxHp: 30,
      stats: { defense: 20, spDefense: 20 },
    },
  });
  const advise = ({
    species = 52,
    status2 = 0,
    battleTypeFlags = 1 << 2,
    ui,
  }) => {
    const observed = observation({
      emulator: { mode: "battle" },
      playerMemory: {
        map: { id: "MAP_ROUTE5" },
        battleTypeFlags,
        battle: battleState(species, status2),
        trainer: {
          partyCount: 1,
          usablePartyCount: 1,
          party: [{ slot: 0, species: 7, hp: 50, maxHp: 50 }],
          bag: {
            items: [],
            keyItems: [],
            pokeBalls: [
              { itemId: 4, quantity: 5 },
              { itemId: 3, quantity: 2 },
            ],
          },
        },
        ui,
      },
    });
    return createPolicyAdvisors({ mechanics, campaignPlanner })
      .flatMap((advisor) => advisor.advise(observed) ?? [])
      .find(({ advisor }) => advisor === "battle")?.recommendation;
  };

  assert.deepEqual(advise({ ui: { battle: { stage: "action", cursor: 0 } } }), {
    kind: "choose-battle-command",
    targetCommand: "bag",
    objective: "capture-origins-persian-capture",
  });
  assert.deepEqual(advise({
    battleTypeFlags: (1 << 2) | (1 << 17),
    ui: { battle: { stage: "action", cursor: 0 } },
  }), {
    kind: "choose-battle-command",
    targetCommand: "bag",
    objective: "capture-origins-persian-capture",
  }, "a cartridge-scripted wild encounter is still catchable");
  assert.deepEqual(advise({
    species: 16,
    ui: { battle: { stage: "action", cursor: 0 } },
  }), {
    kind: "choose-battle-command",
    targetCommand: "run",
    objective: "seek-origins-persian-capture",
  });
  assert.deepEqual(advise({
    species: 16,
    status2: 0x6000,
    ui: { battle: { stage: "action", cursor: 3 } },
  }), {
    kind: "choose-battle-command",
    targetCommand: "fight",
    objective: "resolve-capture-escape-block",
  });
  assert.deepEqual(advise({
    ui: { battle: null, bag: { stage: "list", pocket: 0, index: 0 } },
  }), {
    kind: "choose-bag-pocket",
    targetPocket: 2,
    objective: "capture-origins-persian-capture",
  });
  assert.deepEqual(advise({
    ui: { battle: null, bag: { stage: "list", pocket: 2, index: 0 } },
  }), {
    kind: "choose-bag-item",
    targetItemId: 3,
    targetIndex: 1,
    objective: "capture-origins-persian-capture",
  });
  assert.deepEqual(advise({
    ui: {
      battle: null,
      bag: { stage: "context", pocket: 2, selectedItemId: 3, contextCursor: 0 },
    },
  }), {
    kind: "choose-bag-context-action",
    targetAction: "use",
    targetIndex: 0,
    objective: "capture-origins-persian-capture",
  });
});

test("a transformed Ditto remains the requested capture encounter", () => {
  const campaignPlanner = { select: () => ({
    id: "pokedex-ditto-capture",
    target: { kind: "encounter-zone", map: "MAP_POKEMON_MANSION_B1F" },
    captureSpecies: [132],
    captureFamily: [132],
  }) };
  const observed = observation({
    emulator: { mode: "battle" },
    playerMemory: {
      map: { id: "MAP_POKEMON_MANSION_B1F" },
      battleTypeFlags: 1 << 2,
      battle: {
        player: {
          species: 135,
          hp: 100,
          maxHp: 100,
          moves: [33],
          pp: [20],
          stats: { attack: 50, spAttack: 50 },
        },
        opponent: {
          species: 135,
          originalSpecies: 132,
          hp: 1,
          maxHp: 56,
          stats: { defense: 20, spDefense: 20 },
        },
      },
      trainer: {
        partyCount: 1,
        usablePartyCount: 1,
        party: [{ slot: 0, species: 135, hp: 100, maxHp: 100 }],
        pokedex: { ownedSpecies: [] },
        bag: {
          items: [],
          keyItems: [],
          pokeBalls: [{ itemId: 3, quantity: 8 }],
        },
      },
      ui: { battle: { stage: "action", cursor: 0 } },
    },
  });
  const recommendation = createPolicyAdvisors({ mechanics, campaignPlanner })
    .flatMap((advisor) => advisor.advise(observed) ?? [])
    .find(({ advisor }) => advisor === "battle")?.recommendation;

  assert.deepEqual(recommendation, {
    kind: "choose-battle-command",
    targetCommand: "bag",
    objective: "capture-pokedex-ditto-capture",
  });
});

test("mandatory catches prepare a full-health target before spending balls", () => {
  const originsCampaign = createOriginsCampaign(createOriginsTeamPlan(7));
  const objective = (id) => originsCampaign.objectives.find(
    (candidate) => candidate.id === id,
  );
  const campaignPlanner = createCampaignPlanner({
    campaign: {
      objectives: [objective("route16-snorlax"), objective("hm-fly")],
    },
  });
  const advise = ({
    opponentHp = 141,
    opponentStatus = 0,
    moves = [33],
    pp = moves.map(() => 20),
    battleUi = { stage: "action", cursor: 0 },
  } = {}) => {
    const observed = observation({
      emulator: { mode: "battle" },
      playerMemory: {
        map: { id: "MAP_ROUTE16" },
        storyState: { flagIds: { 128: true, 568: false } },
        battleTypeFlags: (1 << 2) | (1 << 17),
        battle: {
          turn: 0,
          playerPartySlot: 0,
          player: {
            species: 7,
            level: 36,
            hp: 90,
            maxHp: 100,
            moves,
            pp,
            stats: { attack: 57, spAttack: 55 },
          },
          opponent: {
            species: 143,
            level: 30,
            hp: opponentHp,
            maxHp: 141,
            status1: opponentStatus,
            stats: { defense: 50, spDefense: 81 },
          },
        },
        trainer: {
          partyCount: 1,
          usablePartyCount: 1,
          party: [{
            slot: 0,
            species: 7,
            level: 36,
            hp: 90,
            maxHp: 100,
            moves,
            pp,
          }],
          pokedex: { ownedSpecies: [] },
          bag: {
            items: [],
            keyItems: [],
            pokeBalls: [{ itemId: 3, quantity: 12 }],
          },
        },
        ui: { battle: battleUi },
      },
    });
    return createPolicyAdvisors({ mechanics, campaignPlanner })
      .flatMap((advisor) => advisor.advise(observed) ?? [])
      .find(({ advisor }) => advisor === "battle")?.recommendation;
  };

  assert.deepEqual(advise(), {
    kind: "choose-battle-command",
    targetCommand: "fight",
    objective: "prepare-capture-route16-snorlax",
  });
  assert.deepEqual(advise({ battleUi: { stage: "move", cursor: 0 } }), {
    kind: "choose-battle-move",
    targetMoveId: 33,
    targetMoveSlot: 0,
    objective: "weaken-capture-route16-snorlax",
    maximumCriticalDamage: 32,
  });
  assert.deepEqual(advise({
    moves: [79, 33],
    battleUi: { stage: "move", cursor: 0 },
  }), {
    kind: "choose-battle-move",
    targetMoveId: 79,
    targetMoveSlot: 0,
    objective: "status-capture-route16-snorlax",
  });
  assert.deepEqual(advise({ opponentHp: 40 }), {
    kind: "choose-battle-command",
    targetCommand: "bag",
    objective: "capture-route16-snorlax",
  });
});

test("capture policy chooses the cartridge-best owned ball for the encounter", () => {
  const chooseBall = ({
    species,
    level,
    types,
    turn = 0,
    balls,
    ownedSpecies = [],
  }) => {
    const campaignPlanner = { select: () => ({
      id: `capture-${species}`,
      target: { kind: "encounter-zone", map: "MAP_TEST_ROUTE" },
      captureSpecies: [species],
      captureFamily: [species],
    }) };
    const observed = observation({
      emulator: { mode: "battle" },
      playerMemory: {
        map: { id: "MAP_TEST_ROUTE" },
        battleTypeFlags: 1 << 2,
        battle: {
          turn,
          player: {
            species: 7,
            hp: 50,
            maxHp: 50,
            moves: [33],
            pp: [20],
            stats: { attack: 30, spAttack: 30 },
          },
          opponent: {
            species,
            level,
            types,
            hp: 1,
            maxHp: 50,
            stats: { defense: 20, spDefense: 20 },
          },
        },
        trainer: {
          partyCount: 1,
          usablePartyCount: 1,
          party: [{ slot: 0, species: 7, hp: 50, maxHp: 50 }],
          pokedex: { ownedSpecies },
          bag: { items: [], keyItems: [], pokeBalls: balls },
        },
        ui: { battle: null, bag: { stage: "list", pocket: 2, index: 0 } },
      },
    });
    return createPolicyAdvisors({ mechanics, campaignPlanner })
      .flatMap((advisor) => advisor.advise(observed) ?? [])
      .find(({ advisor }) => advisor === "battle")?.recommendation;
  };

  assert.equal(chooseBall({
    species: 93,
    level: 21,
    types: [7, 3],
    balls: [
      { itemId: 4, quantity: 12 },
      { itemId: 3, quantity: 4 },
      { itemId: 2, quantity: 8 },
      { itemId: 8, quantity: 4 },
    ],
  })?.targetItemId, 2, "Ultra Ball beats Great, Poké, and Nest on Haunter");
  assert.equal(chooseBall({
    species: 7,
    level: 20,
    types: [11, 11],
    balls: [
      { itemId: 2, quantity: 8 },
      { itemId: 6, quantity: 4 },
    ],
  })?.targetItemId, 6, "Net Ball beats Ultra Ball on Water types");
  assert.equal(chooseBall({
    species: 19,
    level: 5,
    types: [0, 0],
    balls: [
      { itemId: 2, quantity: 8 },
      { itemId: 8, quantity: 4 },
    ],
  })?.targetItemId, 8, "Nest Ball beats Ultra Ball on a level-five target");
  assert.equal(chooseBall({
    species: 93,
    level: 21,
    types: [7, 3],
    turn: 15,
    balls: [
      { itemId: 2, quantity: 8 },
      { itemId: 10, quantity: 4 },
    ],
  })?.targetItemId, 10, "Timer Ball beats Ultra Ball late in battle");
  assert.equal(chooseBall({
    species: 93,
    level: 21,
    types: [7, 3],
    balls: [
      { itemId: 2, quantity: 8 },
      { itemId: 9, quantity: 4 },
    ],
    ownedSpecies: [93],
  })?.targetItemId, 9, "Repeat Ball beats Ultra Ball for an owned species");
});

test("an off-target capture encounter exits without inventing a two-switch training transaction", () => {
  const campaignPlanner = { select: () => ({
    id: "origins-paras-utility-capture",
    target: { kind: "encounter-zone", map: "MAP_MT_MOON_1F" },
    captureSpecies: [46],
    captureFamily: [46, 47],
  }) };
  const party = [
    { slot: 0, species: 4, level: 10, hp: 15, maxHp: 31, moves: [33] },
    { slot: 1, species: 1, level: 18, hp: 60, maxHp: 60, moves: [33] },
    { slot: 2, species: 131, level: 16, hp: 70, maxHp: 70, moves: [57] },
  ];
  const recommend = ({ activePartySlot, sentPartyMasks, ui }) => {
    const active = party[activePartySlot];
    const observed = observation({
      emulator: { mode: "battle" },
      playerMemory: {
        map: { id: "MAP_MT_MOON_1F" },
        battleTypeFlags: 1 << 2,
        battle: {
          playerPartySlot: activePartySlot,
          sentPartyMasks,
          player: {
            ...active,
            pp: active.moves.map(() => 20),
            stats: { attack: 30, spAttack: 30 },
          },
          opponent: {
            species: 4,
            level: 10,
            hp: 29,
            maxHp: 29,
            stats: { defense: 43, spDefense: 50 },
          },
        },
        trainer: {
          partyCount: 3,
          usablePartyCount: 3,
          party,
          bag: { items: [], keyItems: [], pokeBalls: [{ itemId: 4, quantity: 5 }] },
        },
        ui,
      },
    });
    return createPolicyAdvisors({ mechanics, campaignPlanner })
      .flatMap((advisor) => advisor.advise(observed) ?? [])
      .find(({ advisor }) => advisor === "battle")?.recommendation;
  };

  assert.deepEqual(recommend({
    activePartySlot: 0,
    sentPartyMasks: [0b000001],
    ui: { battle: { stage: "action", cursor: 0 } },
  }), {
    kind: "choose-battle-command",
    targetCommand: "run",
    objective: "seek-origins-paras-utility-capture",
  });
});

test("an optional capture hunt does not manufacture training outside an explicit training objective", () => {
  const party = [
    { slot: 0, species: 5, level: 21, hp: 60, maxHp: 60, moves: [52] },
    { slot: 1, species: 43, level: 23, hp: 54, maxHp: 54, moves: [71] },
    { slot: 2, species: 19, level: 20, hp: 50, maxHp: 50, moves: [33] },
    { slot: 3, species: 46, level: 5, hp: 20, maxHp: 20, moves: [15, 148] },
  ];
  const campaignPlanner = {
    select: () => ({
      id: "mastery-capture:MAP_ROUTE8:58",
      target: { kind: "encounter-zone", map: "MAP_ROUTE8" },
      regionalMastery: true,
      captureSpecies: [58],
      captureFamily: [58],
    }),
    selectTraining: () => null,
    selectBattleSquad: () => party.slice(0, 3),
  };
  const active = party[0];
  const observed = observation({
    emulator: { mode: "battle" },
    playerMemory: {
      map: { id: "MAP_ROUTE8" },
      battleTypeFlags: 1 << 2,
      battle: {
        playerPartySlot: 0,
        sentPartyMasks: [0b000001],
        player: {
          ...active,
          pp: active.moves.map(() => 20),
          stats: { attack: 45, spAttack: 45 },
        },
        opponent: {
          species: 4,
          level: 10,
          hp: 29,
          maxHp: 29,
          stats: { defense: 43, spDefense: 50 },
        },
      },
      trainer: {
        partyCount: 4,
        usablePartyCount: 4,
        party,
        bag: { items: [], keyItems: [], pokeBalls: [{ itemId: 4, quantity: 5 }] },
      },
      ui: { battle: { stage: "action", cursor: 0 } },
    },
  });

  const recommendation = createPolicyAdvisors({
    mechanics,
    campaignPlanner,
    teamPlan: createOriginsTeamPlan(4),
  }).flatMap((advisor) => advisor.advise(observed) ?? [])
    .find(({ advisor }) => advisor === "battle")?.recommendation;

  assert.deepEqual(recommendation, {
    kind: "choose-battle-command",
    targetCommand: "run",
    objective: "seek-mastery-capture:MAP_ROUTE8:58",
  });
});

test("a Safari roster target throws a Safari Ball and ignores other species", () => {
  const campaignPlanner = { select: () => ({
    id: "origins-scyther-capture",
    target: { kind: "encounter-zone", map: "MAP_SAFARI_ZONE_CENTER" },
    captureSpecies: [123],
    safari: true,
  }) };
  const recommendation = (species) => {
    const observed = observation({
      emulator: { mode: "battle" },
      playerMemory: {
        battleTypeFlags: (1 << 2) | (1 << 7),
        battle: {
          player: { species: 7, hp: 50, maxHp: 50, moves: [], pp: [] },
          opponent: { species, hp: 60, maxHp: 60 },
        },
        ui: { battle: { stage: "action", cursor: 1 } },
      },
    });
    return createPolicyAdvisors({ mechanics, campaignPlanner })
      .flatMap((advisor) => advisor.advise(observed) ?? [])
      .find(({ advisor }) => advisor === "battle")?.recommendation;
  };

  assert.deepEqual(recommendation(123), {
    kind: "choose-safari-command",
    targetAction: "ball",
    targetIndex: 0,
    objective: "capture-origins-scyther-capture",
  });
  assert.equal(recommendation(113).targetCommand, "run");
});

test("every caught Pokemon nickname prompt is explicitly declined", () => {
  const observed = observation({
    emulator: { mode: "battle" },
    playerMemory: {
      battleTypeFlags: 1 << 2,
      battle: {
        scriptName: "capture-nickname-prompt",
        player: { species: 7, hp: 50, maxHp: 50, moves: [], pp: [] },
        opponent: { species: 52, hp: 0, maxHp: 30 },
      },
      ui: {
        battle: null,
        choiceMenu: { cursor: 0, selected: "yes" },
      },
    },
  });
  const recommendation = createPolicyAdvisors({ mechanics })
    .flatMap((advisor) => advisor.advise(observed) ?? [])
    .find(({ advisor }) => advisor === "battle")?.recommendation;

  assert.deepEqual(recommendation, {
    kind: "choose-menu-option",
    targetOption: "no",
    objective: "keep-caught-species-name",
  });
});

test("a newly caught Pokedex entry is acknowledged before declining its nickname", () => {
  const observed = observation({
    emulator: { mode: "battle", callback2: "BattleMainCB2" },
    playerMemory: {
      battleTypeFlags: 1 << 2,
      battle: {
        scriptName: null,
        player: { species: 4, hp: 40, maxHp: 40, moves: [33], pp: [20] },
        opponent: { species: 16, hp: 0, maxHp: 20 },
      },
      ui: {
        battle: null,
        pokedexRegistration: {
          stage: "registered-entry",
          selected: "continue",
        },
      },
    },
  });
  const recommendation = createPolicyAdvisors({ mechanics })
    .flatMap((advisor) => advisor.advise(observed) ?? [])
    .find(({ advisor }) => advisor === "battle")?.recommendation;

  assert.deepEqual(recommendation, {
    kind: "acknowledge-cartridge-prompt",
    objective: "close-new-pokedex-entry",
  });
  assert.deepEqual(mapRecommendation(recommendation, observed).buttons, ["a"]);
});

test("the Pokedex policy opportunistically catches a new ordinary wild species", () => {
  const advise = ({ ownedSpecies = [4], balls = 6, ui, battleTypeFlags = 1 << 2 }) => {
    const observed = observation({
      emulator: { mode: "battle" },
      playerMemory: {
        battleTypeFlags,
        battle: {
          player: {
            species: 4,
            hp: 40,
            maxHp: 40,
            moves: [33],
            pp: [20],
            stats: { attack: 30, spAttack: 30 },
          },
          opponent: {
            species: 19,
            hp: 24,
            maxHp: 24,
            stats: { defense: 20, spDefense: 20 },
          },
        },
        trainer: {
          partyCount: 1,
          usablePartyCount: 1,
          party: [{ slot: 0, species: 4, level: 12, hp: 40, maxHp: 40 }],
          pokedex: { ownedSpecies, seenSpecies: [...ownedSpecies, 19] },
          bag: {
            items: [],
            keyItems: [],
            pokeBalls: balls > 0 ? [{ itemId: 4, quantity: balls }] : [],
          },
        },
        ui,
      },
    });
    return createPolicyAdvisors({ mechanics })
      .flatMap((advisor) => advisor.advise(observed) ?? [])
      .find(({ advisor }) => advisor === "battle")?.recommendation;
  };

  assert.deepEqual(advise({
    ui: { battle: { stage: "action", cursor: 0 } },
  }), {
    kind: "choose-battle-command",
    targetCommand: "bag",
    objective: "pokedex-capture-19",
  });
  assert.deepEqual(advise({
    ui: { battle: null, bag: { stage: "list", pocket: 0, index: 0 } },
  }), {
    kind: "choose-bag-pocket",
    targetPocket: 2,
    objective: "pokedex-capture-19",
  });
  assert.deepEqual(advise({
    ui: { battle: null, bag: { stage: "list", pocket: 2, index: 0 } },
  }), {
    kind: "choose-bag-item",
    targetItemId: 4,
    targetIndex: 0,
    objective: "pokedex-capture-19",
  });
  assert.equal(advise({
    ownedSpecies: [4, 19],
    ui: { battle: { stage: "action", cursor: 0 } },
  }).targetCommand, "fight");
  assert.equal(advise({
    balls: 3,
    ui: { battle: { stage: "action", cursor: 0 } },
  }).targetCommand, "fight");
  assert.deepEqual(advise({
    balls: 0,
    battleTypeFlags: (1 << 2) | (1 << 7),
    ui: { battle: { stage: "action", cursor: 1 } },
  }), {
    kind: "choose-safari-command",
    targetAction: "ball",
    targetIndex: 0,
    objective: "pokedex-capture-19",
  });
});

test("an ordinary Pokedex capture applies status before opening the Bag", () => {
  const recommend = (ui) => {
    const observed = observation({
      emulator: { mode: "battle" },
      playerMemory: {
        battleTypeFlags: 1 << 2,
        battle: {
          playerPartySlot: 0,
          player: {
            species: 1,
            level: 20,
            hp: 55,
            maxHp: 55,
            moves: [79, 33],
            pp: [15, 20],
            stats: { attack: 35, spAttack: 35 },
          },
          opponent: {
            species: 19,
            level: 5,
            hp: 24,
            maxHp: 24,
            status1: 0,
            stats: { defense: 20, spDefense: 20 },
          },
        },
        trainer: {
          partyCount: 1,
          usablePartyCount: 1,
          party: [{
            slot: 0,
            species: 1,
            level: 20,
            hp: 55,
            maxHp: 55,
            moves: [79, 33],
            pp: [15, 20],
            stats: { attack: 35, spAttack: 35 },
          }],
          pokedex: { ownedSpecies: [1], seenSpecies: [1, 19] },
          bag: {
            items: [],
            keyItems: [],
            pokeBalls: [{ itemId: 4, quantity: 6 }],
          },
        },
        ui,
      },
    });
    return createPolicyAdvisors({ mechanics })
      .flatMap((advisor) => advisor.advise(observed) ?? [])
      .find(({ advisor }) => advisor === "battle")?.recommendation;
  };

  assert.deepEqual(recommend({
    battle: null,
    bag: { stage: "list", pocket: 2, index: 0 },
  }), {
    kind: "close-menu",
    objective: "prepare-pokedex-capture-19",
  });
  assert.deepEqual(recommend({ battle: { stage: "action", cursor: 0 } }), {
    kind: "choose-battle-command",
    targetCommand: "fight",
    objective: "prepare-pokedex-capture-19",
  });
  assert.deepEqual(recommend({ battle: { stage: "move", cursor: 0 } }), {
    kind: "choose-battle-move",
    targetMoveId: 79,
    targetMoveSlot: 0,
    objective: "status-pokedex-capture-19",
  });
});

test("an ordinary capture switches to a safe party status specialist", () => {
  const observed = observation({
    emulator: { mode: "battle" },
    playerMemory: {
      battleTypeFlags: 1 << 2,
      battle: {
        playerPartySlot: 0,
        player: {
          species: 6,
          level: 50,
          hp: 150,
          maxHp: 150,
          moves: [53],
          pp: [15],
          stats: { attack: 100, spAttack: 130 },
        },
        opponent: {
          species: 19,
          level: 5,
          hp: 24,
          maxHp: 24,
          status1: 0,
          stats: { defense: 20, spDefense: 20 },
        },
      },
      trainer: {
        partyCount: 2,
        usablePartyCount: 2,
        party: [
          {
            slot: 0,
            species: 6,
            level: 50,
            hp: 150,
            maxHp: 150,
            moves: [53],
            pp: [15],
            stats: { attack: 100, spAttack: 130 },
          },
          {
            slot: 1,
            species: 1,
            level: 20,
            hp: 55,
            maxHp: 55,
            moves: [79, 33],
            pp: [15, 20],
            stats: { attack: 35, spAttack: 35 },
          },
        ],
        pokedex: { ownedSpecies: [1, 6], seenSpecies: [1, 6, 19] },
        bag: {
          items: [],
          keyItems: [],
          pokeBalls: [{ itemId: 4, quantity: 6 }],
        },
      },
      ui: { battle: { stage: "action", cursor: 0 } },
    },
  });
  const recommendation = createPolicyAdvisors({ mechanics })
    .flatMap((advisor) => advisor.advise(observed) ?? [])
    .find(({ advisor }) => advisor === "battle")?.recommendation;

  assert.deepEqual(recommendation, {
    kind: "choose-battle-command",
    targetCommand: "pokemon",
    targetPartySlot: 1,
    objective: "deploy-capture-specialist-pokedex-capture-19",
  });
});

test("opportunistic catching fills the final open party slot before boxing later catches", () => {
  const observed = observation({
    emulator: { mode: "battle" },
    playerMemory: {
      battleTypeFlags: 1 << 2,
      battle: {
        player: {
          species: 4,
          hp: 40,
          maxHp: 40,
          moves: [33],
          pp: [20],
          stats: { attack: 30, spAttack: 30 },
        },
        opponent: {
          species: 19,
          hp: 24,
          maxHp: 24,
          stats: { defense: 20, spDefense: 20 },
        },
      },
      trainer: {
        partyCount: 5,
        usablePartyCount: 5,
        party: [
          { slot: 0, species: 4, hp: 40, maxHp: 40 },
          { slot: 1, species: 16, hp: 25, maxHp: 25 },
          { slot: 2, species: 10, hp: 20, maxHp: 20 },
          { slot: 3, species: 25, hp: 30, maxHp: 30 },
          { slot: 4, species: 43, hp: 25, maxHp: 25 },
        ],
        pokedex: {
          ownedSpecies: [4, 10, 16, 25, 43],
          seenSpecies: [4, 10, 16, 19, 25, 43],
        },
        bag: { items: [], keyItems: [], pokeBalls: [{ itemId: 4, quantity: 12 }] },
      },
      ui: { battle: { stage: "action", cursor: 0 } },
    },
  });
  const recommendation = createPolicyAdvisors({
    mechanics,
    teamPlan: createOriginsTeamPlan(4),
  }).flatMap((advisor) => advisor.advise(observed) ?? [])
    .find(({ advisor }) => advisor === "battle")?.recommendation;

  assert.deepEqual(recommendation, {
    kind: "choose-battle-command",
    targetCommand: "bag",
    objective: "pokedex-capture-19",
  });
});

test("opportunistic catching preserves a party slot reserved for a pending gift", () => {
  const observed = observation({
    emulator: { mode: "battle" },
    playerMemory: {
      battleTypeFlags: 1 << 2,
      battle: {
        player: {
          species: 4,
          level: 20,
          hp: 55,
          maxHp: 55,
          moves: [33],
          pp: [20],
          stats: { attack: 40, spAttack: 40 },
        },
        opponent: {
          species: 19,
          level: 12,
          hp: 24,
          maxHp: 24,
          stats: { defense: 20, spDefense: 20 },
        },
      },
      trainer: {
        partyCount: 5,
        usablePartyCount: 5,
        party: [
          { slot: 0, species: 4, level: 20, hp: 55, maxHp: 55, moves: [33] },
          { slot: 1, species: 16, level: 18, hp: 40, maxHp: 40, moves: [33] },
          { slot: 2, species: 10, level: 18, hp: 35, maxHp: 35, moves: [33] },
          { slot: 3, species: 25, level: 18, hp: 42, maxHp: 42, moves: [33] },
          { slot: 4, species: 43, level: 18, hp: 40, maxHp: 40, moves: [33] },
        ],
        pokedex: {
          ownedSpecies: [4, 10, 16, 25, 43],
          seenSpecies: [4, 10, 16, 19, 25, 43],
        },
        bag: { items: [], keyItems: [], pokeBalls: [{ itemId: 4, quantity: 12 }] },
      },
      ui: { battle: { stage: "action", cursor: 0 } },
    },
  });
  const campaignPlanner = { select: () => ({
    id: "origins-eevee-gift",
    target: {
      kind: "object",
      map: "MAP_CELADON_CITY_CONDOMINIUMS_ROOF_ROOM",
      index: 1,
    },
    acquisitionId: "origins-jolteon",
    reservedPartySlots: 1,
  }) };
  const recommendation = createPolicyAdvisors({ mechanics, campaignPlanner })
    .flatMap((advisor) => advisor.advise(observed) ?? [])
    .find(({ advisor }) => advisor === "battle")?.recommendation;

  assert.equal(recommendation?.targetCommand, "fight");
});

test("Brock roster preparation spends the last ball on a new second team member", () => {
  const route = mapFromCollisionRows({
    id: "MAP_ROUTE2",
    rows: [".....", ".....", "....."],
    connections: [{ direction: "right", map: "MAP_PEWTER_CITY_GYM", offset: 0 }],
    encounters: { "1,1": 1, "2,1": 1 },
    behaviors: { "1,1": "MB_TALL_GRASS", "2,1": "MB_TALL_GRASS" },
  });
  const gym = mapFromCollisionRows({
    id: "MAP_PEWTER_CITY_GYM",
    rows: [".....", ".....", "....."],
    connections: [{ direction: "left", map: route.id, offset: 0 }],
    objectEvents: [{ x: 3, y: 1, script: "PewterCity_Gym_EventScript_Brock" }],
  });
  const world = {
    maps: [route, gym],
    wildEncounters: [{
      map: route.id,
      land_mons: {
        encounter_rate: 21,
        mons: [{ min_level: 3, max_level: 5, species: "SPECIES_CHARMANDER" }],
      },
    }],
  };
  const campaignPlanner = { select: () => ({
    id: "badge-boulder",
    target: { kind: "object", map: gym.id, index: 0 },
    importantBattle: true,
    minimumBattlePartySize: 2,
  }) };
  const observed = observation({
    emulator: { mode: "battle" },
    playerMemory: {
      map: { id: route.id },
      position: { x: 1, y: 1 },
      battleTypeFlags: 1 << 2,
      battle: {
        player: {
          species: 1, level: 12, hp: 35, maxHp: 35,
          moves: [33], pp: [20], stats: { attack: 30, spAttack: 30 },
        },
        opponent: {
          species: 4, level: 4, hp: 18, maxHp: 18,
          stats: { defense: 20, spDefense: 20 },
        },
      },
      trainer: {
        partyCount: 1,
        usablePartyCount: 1,
        party: [{ slot: 0, species: 1, level: 12, hp: 35, maxHp: 35, moves: [33] }],
        pokedex: { ownedSpecies: [1], seenSpecies: [1, 4] },
        bag: { items: [], keyItems: [], pokeBalls: [{ itemId: 4, quantity: 1 }] },
      },
      ui: { battle: { stage: "action", cursor: 0 } },
    },
  });

  const recommendation = createPolicyAdvisors({
    mechanics,
    world,
    campaignPlanner,
    teamPlan: createOriginsTeamPlan(1),
  }).flatMap((advisor) => advisor.advise(observed) ?? [])
    .find(({ advisor }) => advisor === "battle")?.recommendation;

  assert.deepEqual(recommendation, {
    kind: "choose-battle-command",
    targetCommand: "bag",
    objective: "capture-build-badge-boulder-roster",
  });
});

test("navigation will not enter Brock's Gym before building a two-member squad", () => {
  const route = mapFromCollisionRows({
    id: "MAP_ROUTE2",
    rows: [".....", ".....", "....."],
    connections: [{ direction: "right", map: "MAP_PEWTER_CITY_GYM", offset: 0 }],
    encounters: { "1,1": 1, "2,1": 1 },
    behaviors: { "1,1": "MB_TALL_GRASS", "2,1": "MB_TALL_GRASS" },
  });
  const gym = mapFromCollisionRows({
    id: "MAP_PEWTER_CITY_GYM",
    rows: [".....", ".....", "....."],
    connections: [{ direction: "left", map: route.id, offset: 0 }],
    objectEvents: [{ x: 3, y: 1, script: "PewterCity_Gym_EventScript_Brock" }],
  });
  const world = {
    maps: [route, gym],
    wildEncounters: [{
      map: route.id,
      land_mons: {
        encounter_rate: 21,
        mons: [{ min_level: 3, max_level: 5, species: "SPECIES_PIDGEY" }],
      },
    }],
  };
  const campaignPlanner = { select: () => ({
    id: "badge-boulder",
    target: { kind: "object", map: gym.id, index: 0 },
    importantBattle: true,
    minimumBattlePartySize: 2,
  }) };
  const observed = observation({ playerMemory: {
    map: { id: route.id },
    position: { x: 1, y: 1 },
    trainer: {
      partyCount: 1,
      usablePartyCount: 1,
      party: [{ slot: 0, species: 1, level: 12, hp: 35, maxHp: 35 }],
    },
  } });

  const recommendation = createPolicyAdvisors({ world, campaignPlanner })
    .flatMap((advisor) => advisor.advise(observed) ?? [])
    .find(({ advisor }) => advisor === "navigation")?.recommendation;

  assert.equal(recommendation.objective, "build-badge-boulder-roster");
  assert.equal(recommendation.targetMap, route.id);
});

test("wild training battles switch to the campaign's under-level core member", () => {
  const world = {
    maps: [mapFromCollisionRows({
      id: "MAP_TRAINING_MEADOW",
      rows: [".....", ".....", "....."],
      encounters: { "1,1": 1, "2,1": 1 },
    })],
    wildEncounters: [{
      map: "MAP_TRAINING_MEADOW",
      land_mons: {
        encounter_rate: 20,
        mons: [{ min_level: 8, max_level: 12 }],
      },
    }],
  };
  const campaignPlanner = { select: () => ({
    id: "elite-four-lorelei",
    target: { kind: "encounter-zone", map: "MAP_TRAINING_MEADOW" },
    minimumCoreLevel: 18,
    coreSpecies: [1, 4],
  }) };
  const party = [
    { slot: 0, species: 1, level: 20, hp: 59, maxHp: 59 },
    { slot: 1, species: 4, level: 10, hp: 31, maxHp: 31 },
  ];
  const battleState = {
    player: {
      species: 1,
      hp: 59,
      maxHp: 59,
      moves: [33],
      pp: [20],
      stats: { attack: 30, spAttack: 30 },
    },
    opponent: {
      species: 4,
      hp: 29,
      maxHp: 29,
      stats: { defense: 20, spDefense: 20 },
    },
  };
  const advise = (ui) => {
    const observed = observation({
      emulator: { mode: "battle" },
      playerMemory: {
        map: { id: "MAP_TRAINING_MEADOW" },
        position: { x: 1, y: 1 },
        battleTypeFlags: 1 << 2,
        battle: battleState,
        trainer: { partyCount: 2, usablePartyCount: 2, party },
        ui,
      },
    });
    return createPolicyAdvisors({ mechanics, world, campaignPlanner })
      .flatMap((advisor) => advisor.advise(observed) ?? [])
      .find(({ advisor }) => advisor === "battle")?.recommendation;
  };

  assert.deepEqual(advise({ battle: { stage: "action", cursor: 0 } }), {
    kind: "choose-battle-command",
    targetCommand: "pokemon",
    objective: "train-team-anchor",
    targetPartySlot: 1,
  });
  assert.deepEqual(advise({
    battle: null,
    party: { stage: "choose-pokemon", cursor: 0 },
  }), {
    kind: "choose-party-member",
    targetPartySlot: 1,
    targetSpecies: 4,
    objective: "train-team-anchor",
  });
});

test("trainer training battles give the planned trainee participation first", () => {
  const map = mapFromCollisionRows({
    id: "MAP_TRAINER_ROUTE",
    rows: [".....", ".....", "....."],
    objectEvents: [{
      x: 3,
      y: 1,
      script: "TrainerRoute_EventScript_Ada",
      trainer_type: "TRAINER_TYPE_NORMAL",
    }],
  });
  const world = { maps: [map], wildEncounters: [] };
  const storyObjective = {
    id: "next-rival",
    target: { kind: "object", map: map.id, index: 0 },
    minimumTeamAnchorLevel: 18,
  };
  const campaignPlanner = {
    select: () => storyObjective,
    selectTraining: () => ({
      id: "train-team-anchor-with-trainer",
      target: { kind: "object", map: map.id, index: 0 },
      trainingSource: "trainer",
      currentTeamAnchorLevel: 10,
      minimumTeamAnchorLevel: 18,
      trainingPartySlot: 1,
      trainingSpecies: 4,
      forObjective: storyObjective.id,
      trainingMethod: "switch",
      escortPartySlot: 0,
      escortSpecies: 1,
      trainer: {
        id: 11,
        flagId: 0x500 + 11,
        minimumLevel: 10,
        maximumLevel: 10,
        partySize: 1,
      },
    }),
  };
  const party = [
    { slot: 0, species: 1, level: 20, hp: 59, maxHp: 59 },
    { slot: 1, species: 4, level: 10, hp: 31, maxHp: 31 },
  ];
  const observed = observation({
    emulator: { mode: "battle" },
    playerMemory: {
      map: { id: map.id },
      position: { x: 2, y: 1 },
      battleTypeFlags: (1 << 2) | (1 << 3),
      battle: {
        playerPartySlot: 0,
        player: {
          species: 1,
          level: 20,
          hp: 59,
          maxHp: 59,
          moves: [33],
          pp: [20],
          stats: { attack: 30, spAttack: 30 },
        },
        opponent: {
          species: 4,
          level: 10,
          hp: 29,
          maxHp: 29,
          stats: { defense: 20, spDefense: 20 },
        },
      },
      trainer: { partyCount: 2, usablePartyCount: 2, party },
      ui: { battle: { stage: "action", cursor: 0 } },
    },
  });

  const recommendation = createPolicyAdvisors({
    mechanics,
    world,
    campaignPlanner,
  }).flatMap((advisor) => advisor.advise(observed) ?? [])
    .find(({ advisor }) => advisor === "battle")?.recommendation;

  assert.deepEqual(recommendation, {
    kind: "choose-battle-command",
    targetCommand: "pokemon",
    objective: "train-team-anchor",
    targetPartySlot: 1,
  });
});

test("passive training uses ordinary story trainer battles for participation", () => {
  const map = mapFromCollisionRows({
    id: "MAP_STORY_TRAINER_ROUTE",
    rows: [".....", ".....", "....."],
  });
  const storyObjective = {
    id: "badge-soul",
    target: { kind: "object", map: "MAP_FUCHSIA_CITY_GYM", index: 0 },
    importantBattle: true,
  };
  const campaignPlanner = {
    select: () => storyObjective,
    selectTraining: () => ({
      id: "train-battle-member-through-story",
      trainingMode: "passive",
      trainingSource: "story",
      target: storyObjective.target,
      forObjective: storyObjective.id,
      trainingMethod: "switch",
      trainingPartySlot: 1,
      trainingSpecies: 123,
      currentTeamAnchorLevel: 28,
      minimumTeamAnchorLevel: 43,
    }),
  };
  const party = [
    {
      slot: 0, species: 6, level: 58, hp: 171, maxHp: 171,
      moves: [53], pp: [15], stats: { attack: 120, spAttack: 150 },
    },
    {
      slot: 1, species: 123, level: 28, hp: 78, maxHp: 78,
      moves: [206], pp: [20], stats: { attack: 75, spAttack: 35 },
    },
  ];
  const observed = observation({
    emulator: { mode: "battle" },
    playerMemory: {
      map: { id: map.id },
      battleTypeFlags: (1 << 2) | (1 << 3),
      battle: {
        playerPartySlot: 0,
        player: party[0],
        opponent: {
          species: 19,
          level: 30,
          hp: 70,
          maxHp: 70,
          stats: { defense: 45, spDefense: 45 },
        },
      },
      trainer: { partyCount: 2, usablePartyCount: 2, party, bag: { items: [] } },
      ui: { battle: { stage: "action", cursor: 0 } },
    },
  });

  const recommendation = createPolicyAdvisors({
    mechanics,
    world: { maps: [map] },
    campaignPlanner,
  }).flatMap((advisor) => advisor.advise(observed) ?? [])
    .find(({ advisor }) => advisor === "battle")?.recommendation;

  assert.deepEqual(recommendation, {
    kind: "choose-battle-command",
    targetCommand: "pokemon",
    objective: "train-team-anchor",
    targetPartySlot: 1,
  });
});

test("the League gives its lowest member only EXP Share while type matchup owns shifts", () => {
  const teamPlan = createOriginsTeamPlan(4);
  const storyObjective = createOriginsCampaign(teamPlan).objectives.find(
    ({ id }) => id === "elite-four-lorelei",
  );
  const leagueMechanics = {
    ...mechanics,
    species: {
      ...mechanics.species,
      53: { id: 53, name: "SPECIES_PERSIAN", types: ["TYPE_NORMAL", "TYPE_NORMAL"] },
      85: { id: 85, name: "SPECIES_DODRIO", types: ["TYPE_NORMAL", "TYPE_FLYING"] },
      91: { id: 91, name: "SPECIES_CLOYSTER", types: ["TYPE_WATER", "TYPE_ICE"] },
      123: { id: 123, name: "SPECIES_SCYTHER", types: ["TYPE_BUG", "TYPE_FLYING"] },
      135: { id: 135, name: "SPECIES_JOLTEON", types: ["TYPE_ELECTRIC", "TYPE_ELECTRIC"] },
    },
    typeChart: [
      ...mechanics.typeChart,
      { attackingType: "TYPE_FIRE", defendingType: "TYPE_WATER", multiplier: 5 },
      { attackingType: "TYPE_FIRE", defendingType: "TYPE_ICE", multiplier: 20 },
      { attackingType: "TYPE_ELECTRIC", defendingType: "TYPE_ICE", multiplier: 10 },
      { attackingType: "TYPE_WATER", defendingType: "TYPE_FLYING", multiplier: 10 },
    ],
  };
  const party = [
    { slot: 0, species: 53, level: 51, hp: 140, maxHp: 140, heldItem: 163,
      moves: [33], pp: [20], stats: { attack: 95, spAttack: 75 } },
    { slot: 1, species: 131, level: 64, hp: 245, maxHp: 245, heldItem: 189,
      moves: [57], pp: [15], stats: { attack: 120, spAttack: 130 } },
    { slot: 2, species: 85, level: 64, hp: 161, maxHp: 161, heldItem: 182,
      moves: [19], pp: [15], stats: { attack: 150, spAttack: 70 } },
    { slot: 3, species: 123, level: 63, hp: 164, maxHp: 164, heldItem: 0,
      moves: [17], pp: [20], stats: { attack: 145, spAttack: 75 } },
    { slot: 4, species: 135, level: 63, hp: 156, maxHp: 156, heldItem: 0,
      moves: [85], pp: [15], stats: { attack: 90, spAttack: 155 } },
    { slot: 5, species: 6, level: 69, hp: 202, maxHp: 202, heldItem: 0,
      moves: [53], pp: [15], stats: { attack: 140, spAttack: 175 } },
  ];
  const world = { maps: [], wildEncounters: [] };
  const campaignPlanner = {
    select: () => storyObjective,
    selectTraining: (observed, objective) => selectTrainingObjective({
      world,
      observation: observed,
      objective,
      teamPlan,
    }),
  };
  const observed = observation({
    emulator: { mode: "battle" },
    playerMemory: {
      map: { id: "MAP_POKEMON_LEAGUE_LORELEIS_ROOM" },
      battleTypeFlags: (1 << 2) | (1 << 3),
      battle: {
        playerPartySlot: 5,
        activePlayerPartySlots: [5],
        player: party[5],
        opponent: {
          species: 91,
          level: 54,
          hp: 0,
          maxHp: 130,
          moves: [57],
          pp: [15],
          stats: { defense: 180, spDefense: 110 },
        },
        announcedOpponentName: "CLOYSTER",
      },
      trainer: {
        partyCount: party.length,
        usablePartyCount: party.length,
        party,
        bag: { items: [] },
      },
      ui: { choiceMenu: { cursor: 0, maxCursor: 1 } },
    },
  });

  const recommendation = createPolicyAdvisors({
    mechanics: leagueMechanics,
    world,
    campaignPlanner,
    teamPlan,
  }).flatMap((advisor) => advisor.advise(observed) ?? [])
    .find(({ advisor }) => advisor === "battle")?.recommendation;

  assert.deepEqual(recommendation, {
    kind: "choose-menu-option",
    targetOption: "yes",
    targetPartySlot: 4,
    targetSpecies: 135,
    objective: "counter-announced-opponent",
  });
});

test("battle safety gates protect unsafe members without blocking safe matchups", () => {
  const gymMap = mapFromCollisionRows({
    id: "MAP_CERULEAN_CITY_GYM",
    rows: [".....", ".....", "....."],
    objectEvents: [{
      x: 3,
      y: 1,
      script: "CeruleanCity_Gym_EventScript_SwimmerLuis",
      trainer_type: "TRAINER_TYPE_NORMAL",
    }],
  });
  const goldeenMechanics = {
    ...mechanics,
    species: {
      ...mechanics.species,
      43: {
        id: 43,
        name: "SPECIES_ODDISH",
        types: ["TYPE_GRASS", "TYPE_POISON"],
        baseAttack: 50,
        baseSpAttack: 75,
      },
      56: {
        id: 56,
        name: "SPECIES_MANKEY",
        types: ["TYPE_FIGHTING", "TYPE_FIGHTING"],
        baseAttack: 80,
        baseSpAttack: 35,
      },
      118: {
        id: 118,
        name: "SPECIES_GOLDEEN",
        types: ["TYPE_WATER", "TYPE_WATER"],
        baseDefense: 60,
        baseSpDefense: 50,
      },
    },
    typeChart: [
      ...mechanics.typeChart,
      { attackingType: "TYPE_GRASS", defendingType: "TYPE_WATER", multiplier: 20 },
      { attackingType: "TYPE_WATER", defendingType: "TYPE_GRASS", multiplier: 5 },
    ],
  };
  const storyObjective = {
    id: "badge-cascade",
    target: { kind: "object", map: gymMap.id, index: 2 },
    importantBattle: true,
    enemyAceLevel: 21,
    battleTeamTargetLevel: 26,
    minimumBattleMemberLevel: 26,
  };
  const recommend = ({
    includeTraining = true,
    activePartySlot = 1,
    trainingMethod = "direct",
    trainingLevel = 19,
    trainingHp = 40,
    trainingPp = 20,
    announcedOpponentName = null,
    ui = { battle: { stage: "action", cursor: 0 } },
  } = {}) => {
    const campaignPlanner = {
      select: () => storyObjective,
      selectTraining: () => includeTraining ? ({
        id: "train-oddish-with-gym-trainer",
        target: { kind: "object", map: gymMap.id, index: 0 },
        trainingSource: "trainer",
        trainingPartySlot: 0,
        trainingSpecies: 43,
        forObjective: storyObjective.id,
        trainingMethod,
        escortPartySlot: 1,
        escortSpecies: 56,
        trainer: {
          id: 20,
          flagId: 0x500 + 20,
          minimumLevel: 19,
          maximumLevel: 19,
          partySize: 1,
        },
      }) : null,
    };
    const party = [
      {
        slot: 0,
        species: 43,
        level: trainingLevel,
        hp: trainingHp,
        maxHp: 40,
        moves: [75],
        pp: [trainingPp],
        stats: { attack: 27, spAttack: 34 },
      },
      {
        slot: 1,
        species: 56,
        level: 21,
        hp: 49,
        maxHp: 49,
        moves: [33],
        pp: [20],
        stats: { attack: 42, spAttack: 21 },
      },
    ];
    const active = party[activePartySlot];
    const observed = observation({
      emulator: { mode: "battle" },
      playerMemory: {
        map: { id: gymMap.id },
        position: { x: 2, y: 1 },
        battleTypeFlags: (1 << 2) | (1 << 3),
        battle: {
          playerPartySlot: activePartySlot,
          sentPartyMasks: [0b000011, 0],
          player: {
            species: active.species,
            level: active.level,
            hp: active.hp,
            maxHp: active.maxHp,
            moves: active.moves,
            pp: active.pp,
            stats: active.stats,
          },
          opponent: {
            species: 118,
            level: 19,
            hp: 46,
            maxHp: 46,
            stats: { defense: 31, spDefense: 28 },
          },
          announcedOpponentName,
        },
        trainer: {
          partyCount: 2,
          usablePartyCount: 2,
          party,
          bag: { items: [] },
        },
        ui,
      },
    });
    return createPolicyAdvisors({
      mechanics: goldeenMechanics,
      world: { maps: [gymMap], wildEncounters: [] },
      campaignPlanner,
    }).flatMap((advisor) => advisor.advise(observed) ?? [])
      .find(({ advisor }) => advisor === "battle")?.recommendation;
  };
  const fight = {
    kind: "choose-battle-command",
    targetCommand: "fight",
  };

  assert.deepEqual(recommend({ trainingMethod: "switch", trainingLevel: 16 }),
    fight, "the observed switch-training loop remains fixed");
  assert.deepEqual(recommend({ trainingLevel: 16 }), fight,
    "an under-level trainee is protected even without a planner label");
  assert.deepEqual(recommend({ trainingHp: 19 }), fight,
    "a trainee below half health stays protected");
  assert.deepEqual(recommend({ trainingPp: 0 }), fight,
    "a trainee without a usable damaging move stays protected");
  assert.deepEqual(recommend(), fight,
    "a healthy participating finisher does not switch back to the trainee for score alone");
  assert.deepEqual(recommend({ includeTraining: false }), {
    kind: "choose-battle-command",
    targetCommand: "pokemon",
    objective: "improve-battle-matchup",
    targetPartySlot: 0,
  }, "ordinary battles retain favorable matchup switching");
  const protectActive = {
    kind: "choose-battle-command",
    targetCommand: "pokemon",
    objective: "protect-struggling-pokemon",
    targetPartySlot: 1,
  };
  assert.deepEqual(recommend({
    includeTraining: false,
    activePartySlot: 0,
    trainingLevel: 16,
  }), protectActive, "level safety applies outside training objectives");
  assert.deepEqual(recommend({
    includeTraining: false,
    activePartySlot: 0,
    trainingHp: 19,
  }), protectActive, "health safety applies outside training objectives");
  assert.deepEqual(recommend({
    includeTraining: false,
    activePartySlot: 0,
    trainingPp: 0,
  }), protectActive, "move usability applies outside training objectives");
  assert.deepEqual(recommend({
    includeTraining: false,
    activePartySlot: 0,
  }), fight, "a safe active matchup is not switched unnecessarily");
  assert.deepEqual(recommend({
    includeTraining: false,
    trainingLevel: 16,
  }), fight, "an under-level reserve is not chosen for type alone");
  assert.deepEqual(recommend({
    includeTraining: false,
    trainingHp: 19,
  }), fight, "a hurt reserve is not chosen for type alone");
  assert.deepEqual(recommend({
    includeTraining: false,
    trainingPp: 0,
  }), fight, "a reserve without damaging PP is not chosen for type alone");
  const retainAtShift = {
    kind: "retain-active-pokemon",
    announcedOpponentName: "GOLDEEN",
    observedCursorSpecies: 56,
  };
  const shiftUi = {
    party: {
      stage: "choose-pokemon",
      cursor: 1,
      cursorPokemon: { slot: 1, species: 56, hp: 49, maxHp: 49 },
    },
  };
  assert.deepEqual(recommend({
    includeTraining: false,
    trainingLevel: 16,
    announcedOpponentName: "GOLDEEN",
    ui: shiftUi,
  }), retainAtShift, "a free shift does not bypass level safety");
  assert.deepEqual(recommend({
    includeTraining: false,
    trainingHp: 19,
    announcedOpponentName: "GOLDEEN",
    ui: shiftUi,
  }), retainAtShift, "a free shift does not bypass health safety");
  assert.deepEqual(recommend({
    includeTraining: false,
    trainingPp: 0,
    announcedOpponentName: "GOLDEEN",
    ui: shiftUi,
  }), retainAtShift, "a free shift does not bypass move usability");
});

test("battle policy pivots when every active damaging move is resisted", () => {
  const coverageMechanics = {
    ...mechanics,
    typeChart: [
      ...mechanics.typeChart,
      { attackingType: "TYPE_GRASS", defendingType: "TYPE_GRASS", multiplier: 5 },
      { attackingType: "TYPE_GRASS", defendingType: "TYPE_POISON", multiplier: 5 },
      { attackingType: "TYPE_FIRE", defendingType: "TYPE_GRASS", multiplier: 20 },
    ],
  };
  const trainingMap = mapFromCollisionRows({
    id: "MAP_ROUTE25",
    rows: [".....", ".....", "....."],
    encounters: { "1,1": 1, "2,1": 1 },
  });
  const world = {
    maps: [trainingMap],
    wildEncounters: [{
      map: trainingMap.id,
      land_mons: {
        encounter_rate: 15,
        mons: [{ min_level: 8, max_level: 14 }],
      },
    }],
  };
  const storyObjective = {
    id: "badge-cascade",
    target: { kind: "object", map: "MAP_CERULEAN_CITY_GYM", index: 2 },
    importantBattle: true,
    minimumBattleMemberLevel: 26,
  };
  const campaignPlanner = {
    select: () => storyObjective,
    selectTraining: () => ({
      id: "train-battle-member",
      target: { kind: "encounter-zone", map: trainingMap.id },
      trainingPartySlot: 0,
      trainingSpecies: 1,
      forObjective: storyObjective.id,
      encounter: { minimumWildLevel: 8, maximumWildLevel: 14 },
    }),
  };
  const recommend = ({
    moves = [75],
    pp = [20],
    battleTypeFlags = 1 << 2,
  } = {}) => {
    const party = [
      {
        slot: 0,
        species: 1,
        level: 19,
        hp: 47,
        maxHp: 47,
        moves,
        pp,
        stats: { attack: 30, spAttack: 34 },
      },
      {
        slot: 1,
        species: 4,
        level: 29,
        hp: 77,
        maxHp: 77,
        moves: [53],
        pp: [15],
        stats: { attack: 47, spAttack: 60 },
      },
    ];
    const observed = observation({
      emulator: { mode: "battle" },
      playerMemory: {
        map: { id: trainingMap.id },
        position: { x: 1, y: 1 },
        battleTypeFlags,
        battle: {
          playerPartySlot: 0,
          sentPartyMasks: [0b000001, 0],
          player: { ...party[0] },
          opponent: {
            species: 1,
            level: 12,
            hp: 34,
            maxHp: 34,
            stats: { defense: 31, spDefense: 33 },
          },
        },
        trainer: { partyCount: 2, usablePartyCount: 2, party },
        ui: { battle: { stage: "action", cursor: 0 } },
      },
    });
    return createPolicyAdvisors({
      mechanics: coverageMechanics,
      world,
      campaignPlanner,
    }).flatMap((advisor) => advisor.advise(observed) ?? [])
      .find(({ advisor }) => advisor === "battle")?.recommendation;
  };

  assert.deepEqual(recommend(), {
    kind: "choose-battle-command",
    targetCommand: "pokemon",
    objective: "improve-battle-coverage",
    targetPartySlot: 1,
  });
  assert.deepEqual(recommend({ battleTypeFlags: (1 << 2) | (1 << 3) }), {
    kind: "choose-battle-command",
    targetCommand: "pokemon",
    objective: "improve-battle-coverage",
    targetPartySlot: 1,
  }, "the same coverage rule applies in trainer battles");
  assert.deepEqual(recommend({ moves: [75, 33], pp: [20, 20] }), {
    kind: "choose-battle-command",
    targetCommand: "fight",
  }, "a neutral damaging move is enough to keep the safe active Pokemon in");
});

test("a healthy paralyzed trainee can keep battling after earning participation", () => {
  const world = {
    maps: [mapFromCollisionRows({
      id: "MAP_TRAINING_MEADOW",
      rows: [".....", ".....", "....."],
      encounters: { "1,1": 1, "2,1": 1 },
    })],
    wildEncounters: [{
      map: "MAP_TRAINING_MEADOW",
      land_mons: {
        encounter_rate: 20,
        mons: [{ min_level: 8, max_level: 12 }],
      },
    }],
  };
  const campaignPlanner = { select: () => ({
    id: "elite-four-lorelei",
    target: { kind: "encounter-zone", map: "MAP_TRAINING_MEADOW" },
    minimumCoreLevel: 18,
    coreSpecies: [1, 4],
  }) };
  const party = [
    { slot: 0, species: 1, level: 20, hp: 59, maxHp: 59 },
    { slot: 1, species: 4, level: 10, hp: 31, maxHp: 31, status1: 64 },
  ];
  const opponent = {
    species: 7,
    level: 12,
    hp: 35,
    maxHp: 35,
    stats: { defense: 20, spDefense: 20 },
  };
  const recommend = ({
    playerPartySlot,
    activePartySlot = playerPartySlot,
    sentPartyMasks,
    ui,
  }) => {
    const active = party[activePartySlot];
    const observed = observation({
      emulator: { mode: "battle" },
      playerMemory: {
        map: { id: "MAP_TRAINING_MEADOW" },
        position: { x: 1, y: 1 },
        battleTypeFlags: 1 << 2,
        battle: {
          playerPartySlot,
          sentPartyMasks,
          player: {
            species: active.species,
            level: active.level,
            hp: active.hp,
            maxHp: active.maxHp,
            status1: active.status1 ?? 0,
            moves: [33],
            pp: [20],
            stats: { attack: 30, spAttack: 30 },
          },
          opponent,
        },
        trainer: {
          partyCount: 2,
          usablePartyCount: 2,
          party,
          bag: { items: [] },
        },
        ui,
      },
    });
    return createPolicyAdvisors({ mechanics, world, campaignPlanner })
      .flatMap((advisor) => advisor.advise(observed) ?? [])
      .find(({ advisor }) => advisor === "battle")?.recommendation;
  };

  assert.deepEqual(recommend({
    playerPartySlot: 0,
    activePartySlot: 1,
    sentPartyMasks: [0b000011],
    ui: { battle: { stage: "action", cursor: 0 } },
  }), {
    kind: "choose-battle-command",
    targetCommand: "fight",
  });
});

test("a trainee with no damaging PP switches to its escort after participating", () => {
  const world = {
    maps: [mapFromCollisionRows({
      id: "MAP_TRAINING_MEADOW",
      rows: [".....", ".....", "....."],
      encounters: { "1,1": 1, "2,1": 1 },
    })],
    wildEncounters: [{
      map: "MAP_TRAINING_MEADOW",
      land_mons: {
        encounter_rate: 20,
        mons: [{ min_level: 8, max_level: 12 }],
      },
    }],
  };
  const campaignPlanner = { select: () => ({
    id: "badge-cascade",
    target: { kind: "object", map: "MAP_CERULEAN_CITY_GYM", index: 2 },
    importantBattle: true,
    enemyAceLevel: 21,
    battleTeamTargetLevel: 26,
    minimumBattleMemberLevel: 26,
  }) };
  const party = [
    { slot: 0, species: 1, level: 27, hp: 59, maxHp: 59, moves: [33], pp: [20] },
    { slot: 1, species: 4, level: 21, hp: 57, maxHp: 60,
      moves: [33, 79, 77, 45], pp: [0, 15, 35, 30] },
  ];
  const recommend = (ui) => {
    const observed = observation({
      emulator: { mode: "battle" },
      playerMemory: {
        map: { id: "MAP_TRAINING_MEADOW" },
        position: { x: 1, y: 1 },
        battleTypeFlags: 1 << 2,
        battle: {
          playerPartySlot: 1,
          sentPartyMasks: [0b000010],
          player: {
            species: 4, level: 21, hp: 57, maxHp: 60,
            moves: [33, 79, 77, 45], pp: [0, 15, 35, 30],
            stats: { attack: 30, spAttack: 30 },
          },
          opponent: {
            species: 7, level: 10, hp: 35, maxHp: 35,
            stats: { defense: 20, spDefense: 20 },
          },
        },
        trainer: { partyCount: 2, usablePartyCount: 2, party },
        ui,
      },
    });
    return createPolicyAdvisors({ mechanics, world, campaignPlanner })
      .flatMap((advisor) => advisor.advise(observed) ?? [])
      .find(({ advisor }) => advisor === "battle")?.recommendation;
  };

  assert.deepEqual(recommend({ battle: { stage: "action", cursor: 0 } }), {
    kind: "choose-battle-command",
    targetCommand: "pokemon",
    objective: "protect-training-member",
    targetPartySlot: 0,
  });
  assert.deepEqual(recommend({
    battle: null,
    party: { stage: "choose-pokemon", cursor: 1 },
  }), {
    kind: "choose-party-member",
    targetPartySlot: 0,
    targetSpecies: 1,
    objective: "protect-training-member",
  });

});

test("switch training protects a full-health lead before an optional Pokedex capture", () => {
  const world = {
    maps: [mapFromCollisionRows({
      id: "MAP_TRAINING_MEADOW",
      rows: [".....", ".....", "....."],
      encounters: { "1,1": 1, "2,1": 1 },
    })],
    wildEncounters: [{
      map: "MAP_TRAINING_MEADOW",
      land_mons: {
        encounter_rate: 20,
        mons: [{ min_level: 8, max_level: 12 }],
      },
    }],
  };
  const campaignPlanner = { select: () => ({
    id: "badge-cascade",
    target: { kind: "object", map: "MAP_CERULEAN_CITY_GYM", index: 2 },
    importantBattle: true,
    enemyAceLevel: 21,
    battleTeamTargetLevel: 26,
    minimumBattleMemberLevel: 26,
  }) };
  const party = [
    { slot: 0, species: 4, level: 8, hp: 31, maxHp: 31, moves: [33] },
    { slot: 1, species: 1, level: 26, hp: 73, maxHp: 73, moves: [33] },
  ];
  const recommend = (ui) => {
    const observed = observation({
      emulator: { mode: "battle" },
      playerMemory: {
        map: { id: "MAP_TRAINING_MEADOW" },
        position: { x: 1, y: 1 },
        battleTypeFlags: 1 << 2,
        battle: {
          playerPartySlot: 0,
          sentPartyMasks: [0b000001, 0],
          player: {
            species: 4, level: 8, hp: 31, maxHp: 31,
            moves: [33], pp: [20], stats: { attack: 20, spAttack: 20 },
          },
          opponent: {
            species: 7, level: 10, hp: 35, maxHp: 35,
            stats: { defense: 20, spDefense: 20 },
          },
        },
        trainer: {
          partyCount: 2,
          usablePartyCount: 2,
          party,
          pokedex: { ownedSpecies: [1, 4] },
          bag: { pokeBalls: [{ itemId: 4, quantity: 10 }] },
        },
        ui,
      },
    });
    return createPolicyAdvisors({ mechanics, world, campaignPlanner })
      .flatMap((advisor) => advisor.advise(observed) ?? [])
      .find(({ advisor }) => advisor === "battle")?.recommendation;
  };

  assert.deepEqual(recommend({ battle: { stage: "action", cursor: 0 } }), {
    kind: "choose-battle-command",
    targetCommand: "pokemon",
    objective: "protect-training-member",
    targetPartySlot: 1,
  });
  assert.deepEqual(recommend({
    battle: null,
    party: { stage: "choose-pokemon", cursor: 0 },
  }), {
    kind: "choose-party-member",
    targetPartySlot: 1,
    targetSpecies: 1,
    objective: "protect-training-member",
  });
});

test("a damaged trainee below half health switches to the best type-and-level escort", () => {
  const world = {
    maps: [mapFromCollisionRows({
      id: "MAP_TRAINING_MEADOW",
      rows: [".....", ".....", "....."],
      encounters: { "1,1": 1, "2,1": 1 },
    })],
    wildEncounters: [{
      map: "MAP_TRAINING_MEADOW",
      land_mons: {
        encounter_rate: 20,
        mons: [{ min_level: 8, max_level: 12 }],
      },
    }],
  };
  const campaignPlanner = { select: () => ({
    id: "train-for-rival",
    target: { kind: "encounter-zone", map: "MAP_TRAINING_MEADOW" },
    minimumCoreLevel: 18,
    coreSpecies: [4],
  }) };
  const party = [
    { slot: 0, species: 4, level: 10, hp: 15, maxHp: 31, moves: [33] },
    { slot: 1, species: 1, level: 40, hp: 110, maxHp: 110, moves: [33] },
    { slot: 2, species: 131, level: 25, hp: 100, maxHp: 100, moves: [57] },
  ];
  const recommend = (ui) => {
    const observed = observation({
      emulator: { mode: "battle" },
      playerMemory: {
        map: { id: "MAP_TRAINING_MEADOW" },
        position: { x: 1, y: 1 },
        battleTypeFlags: 1 << 2,
        battle: {
          playerPartySlot: 0,
          player: {
            species: 4, level: 10, hp: 15, maxHp: 31,
            moves: [33], pp: [20], stats: { attack: 30, spAttack: 30 },
          },
          opponent: {
            species: 4, level: 10, hp: 29, maxHp: 29,
            stats: { defense: 43, spDefense: 50 },
          },
        },
        trainer: { partyCount: 3, usablePartyCount: 3, party },
        ui,
      },
    });
    return createPolicyAdvisors({ mechanics, world, campaignPlanner })
      .flatMap((advisor) => advisor.advise(observed) ?? [])
      .find(({ advisor }) => advisor === "battle")?.recommendation;
  };

  assert.deepEqual(recommend({ battle: { stage: "action", cursor: 0 } }), {
    kind: "choose-battle-command",
    targetCommand: "pokemon",
    objective: "protect-training-member",
    targetPartySlot: 2,
  });
  assert.deepEqual(recommend({ party: { stage: "choose-pokemon", cursor: 0 } }), {
    kind: "choose-party-member",
    targetPartySlot: 2,
    targetSpecies: 131,
    objective: "protect-training-member",
  });
});

test("a healthy training lead attacks its favorable wild opponent itself", () => {
  const trainingMechanics = {
    ...mechanics,
    moves: {
      ...mechanics.moves,
      34: { id: 34, name: "MOVE_BODY_SLAM", power: 85, accuracy: 100,
        effect: "EFFECT_PARALYZE_HIT", type: "TYPE_NORMAL" },
      58: { id: 58, name: "MOVE_ICE_BEAM", power: 95, accuracy: 100,
        effect: "EFFECT_FREEZE_HIT", type: "TYPE_ICE" },
      109: { id: 109, name: "MOVE_CONFUSE_RAY", power: 0, accuracy: 100,
        effect: "EFFECT_CONFUSE", type: "TYPE_GHOST" },
    },
    species: {
      ...mechanics.species,
      114: { id: 114, name: "SPECIES_TANGELA",
        types: ["TYPE_GRASS"] },
    },
    typeChart: [
      ...mechanics.typeChart,
      { attackingType: "TYPE_WATER", defendingType: "TYPE_GRASS", multiplier: 5 },
      { attackingType: "TYPE_ICE", defendingType: "TYPE_GRASS", multiplier: 20 },
    ],
  };
  const world = {
    maps: [mapFromCollisionRows({
      id: "MAP_ROUTE21_NORTH",
      rows: [".....", ".....", "....."],
      encounters: { "1,1": 1, "2,1": 1 },
    })],
    wildEncounters: [{
      map: "MAP_ROUTE21_NORTH",
      land_mons: {
        encounter_rate: 14,
        mons: [{ min_level: 17, max_level: 28 }],
      },
    }],
  };
  const campaignPlanner = { select: () => ({
    id: "badge-volcano",
    target: { kind: "object", map: "MAP_CINNABAR_ISLAND_GYM", index: 7 },
    minimumCoreLevel: 45,
    coreSpecies: [131],
  }) };
  const baseMemory = {
    map: { id: "MAP_ROUTE21_NORTH" },
    position: { x: 1, y: 1 },
    battleTypeFlags: 1 << 2,
    battle: {
      playerPartySlot: 0,
      sentPartyMasks: [0b000001, 0],
      player: {
        species: 131, level: 32, hp: 131, maxHp: 131,
        moves: [57, 34, 109, 58], pp: [14, 15, 10, 10],
        stats: { attack: 67, spAttack: 64 },
      },
      opponent: {
        species: 114, level: 25, hp: 69, maxHp: 69,
        stats: { defense: 63, spDefense: 27 },
      },
    },
    trainer: {
      partyCount: 2,
      usablePartyCount: 2,
      party: [
        { slot: 0, species: 131, level: 32, hp: 131, maxHp: 131,
          moves: [57, 34, 109, 58] },
        { slot: 1, species: 3, level: 60, hp: 149, maxHp: 173 },
      ],
    },
  };
  const recommend = (ui) => {
    const observed = observation({
      emulator: { mode: "battle" },
      playerMemory: { ...baseMemory, ui },
    });
    return createPolicyAdvisors({
      mechanics: trainingMechanics,
      world,
      campaignPlanner,
    }).flatMap((advisor) => advisor.advise(observed) ?? [])
      .find(({ advisor }) => advisor === "battle")?.recommendation;
  };

  assert.deepEqual(recommend({ battle: { stage: "action", cursor: 0 } }), {
    kind: "choose-battle-command",
    targetCommand: "fight",
  });
  assert.equal(
    recommend({ battle: { stage: "move", cursor: 0 } }).targetMoveId,
    58,
  );
});

test("a fainted active Pokemon accepts the cartridge's use-next prompt", () => {
  const observed = observation({
    emulator: { mode: "battle" },
    playerMemory: {
      battleTypeFlags: 1 << 2,
      battle: {
        player: { species: 131, hp: 0, maxHp: 113, moves: [57], pp: [14] },
        opponent: { species: 20, hp: 87, maxHp: 87 },
        messageText: "Use next POKMON?",
      },
      trainer: {
        partyCount: 2,
        usablePartyCount: 1,
        party: [
          { slot: 0, species: 3, level: 59, hp: 161, maxHp: 170 },
          { slot: 1, species: 131, level: 27, hp: 0, maxHp: 113 },
        ],
      },
      ui: { choiceMenu: { cursor: 0, selected: "yes" } },
    },
  });
  const recommendation = createPolicyAdvisors({ mechanics })
    .flatMap((advisor) => advisor.advise(observed) ?? [])
    .find(({ advisor }) => advisor === "battle")?.recommendation;

  assert.deepEqual(recommendation, {
    kind: "choose-menu-option",
    targetOption: "yes",
    objective: "replace-fainted-pokemon",
  });
  assert.deepEqual(mapRecommendation(recommendation, observed).buttons, ["a"]);
});

test("a forced replacement ignores a transitional battler party index", () => {
  const observed = observation({
    emulator: { mode: "battle", callback2: "CB2_UpdatePartyMenu" },
    playerMemory: {
      battleTypeFlags: (1 << 2) | (1 << 3),
      battle: {
        playerPartySlot: 1,
        player: { species: 56, level: 11, hp: 0, maxHp: 31, moves: [33] },
        opponent: { species: 74, level: 12, hp: 18, maxHp: 31 },
      },
      trainer: {
        partyCount: 2,
        usablePartyCount: 1,
        party: [
          { slot: 0, species: 56, level: 11, hp: 0, maxHp: 31, moves: [33] },
          { slot: 1, species: 4, level: 13, hp: 6, maxHp: 36, moves: [33, 45] },
        ],
      },
      ui: {
        party: {
          stage: "choose-pokemon",
          cursor: 0,
          selectedPartySlot: 0,
        },
      },
    },
  });
  const decision = createCentralPlayer({
    advisors: createPolicyAdvisors({
      mechanics,
      campaignPlanner: { select: () => null },
    }),
  }).decide(observed);

  assert.equal(decision.winner?.advisor, "battle");
  assert.deepEqual(decision.winner?.recommendation, {
    kind: "choose-party-member",
    targetPartySlot: 1,
    targetSpecies: 4,
    objective: "replace-fainted-pokemon",
  });
  assert.deepEqual(decision.action.buttons, ["down"]);
});

test("a forced replacement uses matchup evidence in a wild battle", () => {
  const observed = observation({
    emulator: { mode: "battle", callback2: "CB2_UpdatePartyMenu" },
    playerMemory: {
      battleTypeFlags: 1 << 2,
      battle: {
        playerPartySlot: 0,
        player: { species: 1, level: 18, hp: 0, maxHp: 50, moves: [33] },
        opponent: { species: 4, level: 16, hp: 40, maxHp: 40 },
      },
      trainer: {
        partyCount: 3,
        usablePartyCount: 2,
        party: [
          { slot: 0, species: 1, level: 18, hp: 0, maxHp: 50, moves: [33] },
          { slot: 1, species: 4, level: 20, hp: 52, maxHp: 52, moves: [53] },
          { slot: 2, species: 131, level: 15, hp: 61, maxHp: 61, moves: [57] },
        ],
      },
      ui: {
        party: {
          stage: "choose-pokemon",
          cursor: 0,
          selectedPartySlot: 0,
        },
      },
    },
  });
  const decision = createCentralPlayer({
    advisors: createPolicyAdvisors({
      mechanics,
      campaignPlanner: { select: () => null },
    }),
  }).decide(observed);

  assert.equal(decision.winner?.advisor, "battle");
  assert.deepEqual(decision.winner?.recommendation, {
    kind: "choose-party-member",
    targetPartySlot: 2,
    targetSpecies: 131,
    objective: "replace-fainted-pokemon",
  });
  assert.deepEqual(decision.action.buttons, ["down"]);
});

test("a forced replacement prefers a safe reserve over unsafe type coverage", () => {
  const observed = observation({
    emulator: { mode: "battle", callback2: "CB2_UpdatePartyMenu" },
    playerMemory: {
      battleTypeFlags: 1 << 2,
      battle: {
        playerPartySlot: 0,
        player: { species: 1, level: 18, hp: 0, maxHp: 50, moves: [33] },
        opponent: {
          species: 4,
          level: 16,
          hp: 40,
          maxHp: 40,
          stats: { defense: 43, spDefense: 50 },
        },
      },
      trainer: {
        partyCount: 3,
        usablePartyCount: 2,
        party: [
          { slot: 0, species: 1, level: 18, hp: 0, maxHp: 50,
            moves: [33], pp: [20] },
          { slot: 1, species: 4, level: 20, hp: 52, maxHp: 52,
            moves: [33], pp: [20] },
          { slot: 2, species: 131, level: 10, hp: 42, maxHp: 42,
            moves: [57], pp: [15] },
        ],
      },
      ui: {
        party: {
          stage: "choose-pokemon",
          cursor: 0,
          selectedPartySlot: 0,
        },
      },
    },
  });

  const recommendation = createPolicyAdvisors({ mechanics })
    .flatMap((advisor) => advisor.advise(observed) ?? [])
    .find(({ advisor }) => advisor === "battle")?.recommendation;

  assert.deepEqual(recommendation, {
    kind: "choose-party-member",
    targetPartySlot: 1,
    targetSpecies: 4,
    objective: "replace-fainted-pokemon",
  });
});

test("battle policy owns the send-out submenu after the active Pokemon faints", () => {
  const observed = observation({
    emulator: { mode: "battle", callback2: "CB2_UpdatePartyMenu" },
    playerMemory: {
      battleTypeFlags: (1 << 2) | (1 << 3),
      battle: {
        playerPartySlot: 0,
        player: { species: 19, level: 12, hp: 0, maxHp: 29, moves: [33] },
        opponent: { species: 74, level: 12, hp: 18, maxHp: 31 },
      },
      trainer: {
        partyCount: 3,
        usablePartyCount: 2,
        party: [
          { slot: 0, species: 19, level: 12, hp: 0, maxHp: 29 },
          { slot: 1, species: 16, level: 12, hp: 33, maxHp: 33 },
          { slot: 2, species: 4, level: 11, hp: 30, maxHp: 30 },
        ],
      },
      ui: {
        choiceMenu: { cursor: 0, selected: "send-out" },
        party: {
          stage: "selection-menu",
          cursor: 2,
          selectedPartySlot: 2,
          action: "send-out",
          actionCursor: 0,
        },
      },
    },
  });

  const decision = createCentralPlayer({
    advisors: createPolicyAdvisors({ mechanics }),
  }).decide(observed);

  assert.equal(decision.winner.advisor, "battle");
  assert.equal(decision.winner.recommendation.objective, "replace-fainted-pokemon");
  assert.deepEqual(decision.action.buttons, ["a"]);
});

test("an HM carrier spends an important-battle support turn on Max Revive", () => {
  const party = [
    { slot: 0, species: 46, level: 20, hp: 10, maxHp: 40, moves: [15, 148, 249] },
    { slot: 1, species: 131, level: 30, hp: 0, maxHp: 120, moves: [57] },
    { slot: 2, species: 4, level: 25, hp: 70, maxHp: 70, moves: [53] },
  ];
  const campaignPlanner = { select: () => ({
    id: "important-rival",
    target: { kind: "trigger", map: "MAP_ARENA", index: 0 },
    importantBattle: true,
    minimumBattlePartySize: 2,
  }) };
  const recommend = (ui) => {
    const observed = observation({
      emulator: { mode: "battle" },
      playerMemory: {
        battleTypeFlags: (1 << 2) | (1 << 3),
        battle: {
          playerPartySlot: 0,
          player: {
            species: 46, level: 20, hp: 10, maxHp: 40,
            moves: [15, 148, 249], pp: [30, 20, 15],
            stats: { attack: 30, spAttack: 30 },
          },
          opponent: {
            species: 4, level: 25, hp: 65, maxHp: 65,
            stats: { defense: 43, spDefense: 50 },
          },
        },
        trainer: {
          partyCount: 3,
          usablePartyCount: 2,
          party,
          bag: { items: [{ itemId: 25, quantity: 1 }] },
        },
        ui,
      },
    });
    return createPolicyAdvisors({
      mechanics,
      campaignPlanner,
      teamPlan: createOriginsTeamPlan(4),
    }).flatMap((advisor) => advisor.advise(observed) ?? [])
      .find(({ advisor }) => advisor === "battle")?.recommendation;
  };

  assert.deepEqual(recommend({ battle: { stage: "action", cursor: 0 } }), {
    kind: "choose-battle-command",
    targetCommand: "bag",
    objective: "revive-party-member",
  });
  assert.deepEqual(recommend({ bag: { stage: "list", pocket: 0, index: 0 } }), {
    kind: "choose-bag-item",
    targetItemId: 25,
    targetIndex: 0,
    objective: "revive-party-member",
  });
  assert.deepEqual(recommend({
    party: { stage: "choose-pokemon", cursor: 0, itemId: 25 },
  }), {
    kind: "choose-party-member",
    targetPartySlot: 1,
    targetSpecies: 131,
    objective: "revive-party-member",
  });
});

test("a weakened combatant deploys HM support to revive a fainted teammate", () => {
  const party = [
    {
      slot: 0, species: 6, level: 45, hp: 54, maxHp: 160,
      moves: [17, 53], pp: [35, 15], stats: { attack: 105, spAttack: 125 },
    },
    {
      slot: 1, species: 46, level: 40, hp: 55, maxHp: 55,
      moves: [15, 148, 249], pp: [30, 20, 15],
      stats: { attack: 55, defense: 80, spAttack: 45, spDefense: 80 },
    },
    { slot: 2, species: 131, level: 45, hp: 0, maxHp: 180, moves: [57] },
  ];
  const campaignPlanner = { select: () => ({
    id: "important-rival",
    target: { kind: "trigger", map: "MAP_ARENA", index: 0 },
    importantBattle: true,
    minimumBattlePartySize: 2,
  }) };
  const recommend = (ui) => {
    const observed = observation({
      emulator: { mode: "battle" },
      playerMemory: {
        battleTypeFlags: (1 << 2) | (1 << 3),
        battle: {
          playerPartySlot: 0,
          player: party[0],
          opponent: {
            species: 4, level: 40, hp: 90, maxHp: 90,
            moves: [33], pp: [20],
            stats: { attack: 30, defense: 65, spAttack: 30, spDefense: 70 },
          },
        },
        trainer: {
          partyCount: 3,
          usablePartyCount: 2,
          party,
          bag: { items: [{ itemId: 24, quantity: 1 }] },
        },
        ui,
      },
    });
    return createPolicyAdvisors({
      mechanics,
      campaignPlanner,
      teamPlan: createOriginsTeamPlan(4),
    }).flatMap((advisor) => advisor.advise(observed) ?? [])
      .find(({ advisor }) => advisor === "battle")?.recommendation;
  };

  assert.deepEqual(recommend({ battle: { stage: "action", cursor: 0 } }), {
    kind: "choose-battle-command",
    targetCommand: "pokemon",
    objective: "deploy-revive-support",
    targetPartySlot: 1,
  });
  assert.deepEqual(recommend({ party: { stage: "choose-pokemon", cursor: 0 } }), {
    kind: "choose-party-member",
    targetPartySlot: 1,
    targetSpecies: 46,
    objective: "deploy-revive-support",
  });
});

test("a healthy combatant deploys HM support instead of spending a Revive", () => {
  const party = [
    {
      slot: 0, species: 6, level: 45, hp: 120, maxHp: 160,
      moves: [17, 53], pp: [35, 15], stats: { attack: 105, spAttack: 125 },
    },
    {
      slot: 1, species: 46, level: 40, hp: 55, maxHp: 55,
      moves: [15, 148, 249], pp: [30, 20, 15],
      stats: { attack: 55, defense: 80, spAttack: 45, spDefense: 80 },
    },
    { slot: 2, species: 131, level: 45, hp: 0, maxHp: 180, moves: [57] },
  ];
  const campaignPlanner = { select: () => ({
    id: "important-rival",
    target: { kind: "trigger", map: "MAP_ARENA", index: 0 },
    importantBattle: true,
    minimumBattlePartySize: 2,
  }) };
  const observed = observation({
    emulator: { mode: "battle" },
    playerMemory: {
      battleTypeFlags: (1 << 2) | (1 << 3),
      battle: {
        playerPartySlot: 0,
        player: party[0],
        opponent: {
          species: 4, level: 40, hp: 90, maxHp: 90,
          moves: [33], pp: [20],
          stats: { attack: 30, defense: 65, spAttack: 30, spDefense: 70 },
        },
      },
      trainer: {
        partyCount: 3,
        usablePartyCount: 2,
        party,
        bag: { items: [{ itemId: 24, quantity: 1 }] },
      },
      ui: { battle: { stage: "action", cursor: 0 } },
    },
  });

  const recommendation = createPolicyAdvisors({
    mechanics,
    campaignPlanner,
    teamPlan: createOriginsTeamPlan(4),
  }).flatMap((advisor) => advisor.advise(observed) ?? [])
    .find(({ advisor }) => advisor === "battle")?.recommendation;

  assert.deepEqual(recommendation, {
    kind: "choose-battle-command",
    targetCommand: "pokemon",
    objective: "deploy-revive-support",
    targetPartySlot: 1,
  });
});

test("a permanent fighter is not sacrificed because a legacy plan assigned it utility HMs", () => {
  const party = [
    {
      slot: 0, species: 6, level: 45, hp: 120, maxHp: 160,
      moves: [17, 53], pp: [35, 15], stats: { attack: 105, spAttack: 125 },
    },
    {
      slot: 1, species: 47, level: 40, hp: 70, maxHp: 70,
      moves: [15], pp: [30],
      stats: { attack: 65, defense: 90, spAttack: 55, spDefense: 90 },
    },
    { slot: 2, species: 131, level: 45, hp: 0, maxHp: 180, moves: [57] },
  ];
  const campaignPlanner = { select: () => ({
    id: "important-rival",
    target: { kind: "trigger", map: "MAP_ARENA", index: 0 },
    importantBattle: true,
    minimumBattlePartySize: 2,
  }) };
  const observed = observation({
    emulator: { mode: "battle" },
    playerMemory: {
      battleTypeFlags: (1 << 2) | (1 << 3),
      battle: {
        playerPartySlot: 0,
        player: party[0],
        opponent: {
          species: 4, level: 40, hp: 90, maxHp: 90,
          moves: [33], pp: [20],
          stats: { attack: 30, defense: 65, spAttack: 30, spDefense: 70 },
        },
      },
      trainer: {
        partyCount: 3,
        usablePartyCount: 2,
        party,
        bag: { items: [{ itemId: 24, quantity: 1 }] },
      },
      ui: { battle: { stage: "action", cursor: 0 } },
    },
  });

  const recommendation = createPolicyAdvisors({
    mechanics,
    campaignPlanner,
    teamPlan: createMasterTeamPlan(4, 2_901_270_947),
  }).flatMap((advisor) => advisor.advise(observed) ?? [])
    .find(({ advisor }) => advisor === "battle")?.recommendation;

  assert.deepEqual(recommendation, {
    kind: "choose-battle-command",
    targetCommand: "fight",
  });
});

test("the permanent Squirtle team can complete an emergency Max Revive with its last fighter", () => {
  const party = [
    { slot: 0, species: 143, level: 45, hp: 30, maxHp: 200,
      moves: [33], pp: [20], stats: { attack: 90, defense: 80, spAttack: 60, spDefense: 80 } },
    { slot: 1, species: 9, level: 50, hp: 0, maxHp: 160,
      moves: [57], pp: [15], stats: { attack: 100, defense: 100, spAttack: 110, spDefense: 100 } },
  ];
  const emergencyMechanics = { ...mechanics, species: { ...mechanics.species,
    143: { id: 143, types: ["TYPE_NORMAL"] },
    9: { id: 9, types: ["TYPE_WATER"] },
  } };
  const advisor = createPolicyAdvisors({
    mechanics: emergencyMechanics,
    teamPlan: createMasterTeamPlan(7, 2_901_270_947),
    campaignPlanner: { select: () => ({ id: "badge-volcano", importantBattle: true }) },
  }).find(({ id }) => id === "battle");
  const stages = [
    [{ battle: { stage: "action", cursor: 0 } }, "choose-battle-command"],
    [{ bag: { stage: "list", pocket: 0 } }, "choose-bag-item"],
    [{ bag: { stage: "context", selectedItemId: 25 } }, "choose-bag-context-action"],
    [{ party: { stage: "choose-pokemon", itemId: 25, cursor: 0 } }, "choose-party-member"],
  ];
  for (const [ui, kind] of stages) {
    const advice = advisor.advise(observation({
      emulator: { mode: "battle" },
      playerMemory: {
        battleTypeFlags: 12,
        battle: { playerPartySlot: 0, player: party[0], opponent: {
          species: 59, level: 47, hp: 150, maxHp: 150, moves: [33], pp: [20],
          stats: { attack: 100, defense: 100, spAttack: 100, spDefense: 100 },
        } },
        trainer: { partyCount: 2, usablePartyCount: 1, party,
          bag: { items: [{ itemId: 25, quantity: 1 }, { itemId: 20, quantity: 1 }] } },
        ui,
      },
    }));
    assert.equal(advice.recommendation.kind, kind);
    assert.equal(advice.recommendation.objective, "revive-party-member");
    if (kind === "choose-party-member") assert.equal(advice.recommendation.targetPartySlot, 1);
    if (kind === "choose-bag-item") assert.equal(advice.recommendation.targetItemId, 25);
    if (kind === "choose-battle-command") assert.equal(advice.recommendation.targetCommand, "bag");
  }
});

test("a committed battle Revive is cancelled while a combat teammate is exposed", () => {
  const observed = observation({
    emulator: { mode: "battle", callback2: "CB2_UpdatePartyMenu" },
    playerMemory: {
      battleTypeFlags: (1 << 2) | (1 << 3),
      battle: {
        // The cartridge can expose the previous party index while the item
        // target picker is opening, so the battler identity is authoritative.
        playerPartySlot: 1,
        player: {
          species: 1,
          level: 14,
          hp: 48,
          maxHp: 100,
          moves: [33],
          pp: [20],
          stats: { attack: 30, spAttack: 30 },
        },
        opponent: {
          species: 4,
          level: 18,
          hp: 9,
          maxHp: 46,
          stats: { defense: 43, spDefense: 50 },
        },
      },
      trainer: {
        partyCount: 3,
        usablePartyCount: 2,
        party: [
          { slot: 0, species: 1, level: 14, hp: 48, maxHp: 100, moves: [33] },
          { slot: 1, species: 4, level: 23, hp: 34, maxHp: 66, moves: [53] },
          { slot: 2, species: 131, level: 14, hp: 0, maxHp: 37, moves: [57] },
        ],
        bag: { items: [{ itemId: 24, quantity: 1 }] },
      },
      ui: {
        battle: null,
        party: {
          stage: "choose-pokemon",
          cursor: 0,
          selectedPartySlot: 0,
          itemId: 24,
        },
      },
    },
  });

  const recommendation = createPolicyAdvisors({ mechanics })
    .flatMap((advisor) => advisor.advise(observed) ?? [])
    .find(({ advisor }) => advisor === "battle")?.recommendation;

  assert.deepEqual(recommendation, {
    kind: "cancel-conflicting-menu",
    objective: "cancel-unsafe-revive",
  });
});

test("a committed Revive targets the boss-plan priority instead of the first fainted teammate", () => {
  const teamPlan = {
    utilityAcquisitions: [{ family: [46] }],
    fieldMoves: {},
    battlePlans: {
      "important-rival": {
        preferredFamilies: [[4, 5, 6], [131]],
      },
    },
  };
  const campaignPlanner = { select: () => ({
    id: "important-rival",
    target: { kind: "trigger", map: "MAP_ARENA", index: 0 },
    importantBattle: true,
  }) };
  const observed = observation({
    emulator: { mode: "battle", callback2: "CB2_UpdatePartyMenu" },
    playerMemory: {
      battleTypeFlags: (1 << 2) | (1 << 3),
      battle: {
        playerPartySlot: 0,
        player: {
          species: 46, level: 40, hp: 80, maxHp: 80,
          moves: [15, 148, 249], pp: [30, 20, 15],
          stats: { attack: 60, defense: 70, spAttack: 50, spDefense: 70 },
        },
        opponent: {
          species: 4, level: 40, hp: 90, maxHp: 90,
          moves: [33], pp: [20],
          stats: { attack: 70, defense: 65, spAttack: 70, spDefense: 70 },
        },
      },
      trainer: {
        partyCount: 3,
        usablePartyCount: 1,
        party: [
          { slot: 0, species: 46, level: 40, hp: 80, maxHp: 80,
            moves: [15, 148, 249] },
          { slot: 1, species: 131, level: 50, hp: 0, maxHp: 180,
            moves: [57] },
          { slot: 2, species: 4, level: 45, hp: 0, maxHp: 150,
            moves: [53] },
        ],
        bag: { items: [{ itemId: 24, quantity: 1 }] },
      },
      ui: {
        party: { stage: "choose-pokemon", cursor: 0, itemId: 24 },
      },
    },
  });

  const recommendation = createPolicyAdvisors({
    mechanics,
    campaignPlanner,
    teamPlan,
  }).flatMap((advisor) => advisor.advise(observed) ?? [])
    .find(({ advisor }) => advisor === "battle")?.recommendation;

  assert.deepEqual(recommendation, {
    kind: "choose-party-member",
    targetPartySlot: 2,
    targetSpecies: 4,
    objective: "revive-party-member",
  });
});

test("Revive support is not deployed when utility cannot survive two known attacks", () => {
  const threatMechanics = {
    ...mechanics,
    species: {
      ...mechanics.species,
      46: {
        id: 46,
        types: ["TYPE_BUG", "TYPE_GRASS"],
        baseDefense: 55,
        baseSpDefense: 55,
      },
    },
    typeChart: [
      ...mechanics.typeChart,
      { attackingType: "TYPE_FIRE", defendingType: "TYPE_GRASS", multiplier: 20 },
      { attackingType: "TYPE_FIRE", defendingType: "TYPE_BUG", multiplier: 20 },
    ],
  };
  const party = [
    {
      slot: 0, species: 6, level: 45, hp: 150, maxHp: 160,
      moves: [17, 53], pp: [35, 15],
      stats: { attack: 105, defense: 95, spAttack: 125, spDefense: 100 },
    },
    {
      slot: 1, species: 46, level: 30, hp: 80, maxHp: 80,
      moves: [15, 148, 249], pp: [30, 20, 15],
      stats: { attack: 55, defense: 45, spAttack: 45, spDefense: 45 },
    },
    { slot: 2, species: 131, level: 45, hp: 0, maxHp: 180, moves: [57] },
  ];
  const campaignPlanner = { select: () => ({
    id: "important-rival",
    target: { kind: "trigger", map: "MAP_ARENA", index: 0 },
    importantBattle: true,
  }) };
  const observed = observation({
    emulator: { mode: "battle" },
    playerMemory: {
      battleTypeFlags: (1 << 2) | (1 << 3),
      battle: {
        playerPartySlot: 0,
        player: party[0],
        opponent: {
          species: 4, level: 40, hp: 90, maxHp: 90,
          moves: [53], pp: [15],
          stats: { attack: 75, defense: 65, spAttack: 100, spDefense: 70 },
        },
      },
      trainer: {
        partyCount: 3,
        usablePartyCount: 2,
        party,
        bag: { items: [{ itemId: 24, quantity: 1 }] },
      },
      ui: { battle: { stage: "action", cursor: 0 } },
    },
  });

  const recommendation = createPolicyAdvisors({
    mechanics: threatMechanics,
    campaignPlanner,
    teamPlan: createOriginsTeamPlan(4),
  }).flatMap((advisor) => advisor.advise(observed) ?? [])
    .find(({ advisor }) => advisor === "battle")?.recommendation;

  assert.equal(recommendation.targetCommand, "fight");
});

test("an HM carrier pivots to the best available battler instead of attacking a boss", () => {
  const hmMechanics = {
    ...mechanics,
    species: {
      ...mechanics.species,
      46: {
        id: 46,
        types: ["TYPE_BUG", "TYPE_GRASS"],
        baseAttack: 100,
        baseSpAttack: 100,
      },
    },
  };
  const party = [
    { slot: 0, species: 46, level: 50, hp: 120, maxHp: 120, moves: [33] },
    { slot: 1, species: 4, level: 25, hp: 65, maxHp: 65, moves: [33] },
  ];
  const campaignPlanner = { select: () => ({
    id: "important-rival",
    target: { kind: "trigger", map: "MAP_ARENA", index: 0 },
    importantBattle: true,
    minimumBattlePartySize: 2,
  }) };
  const recommend = (ui) => {
    const observed = observation({
      emulator: { mode: "battle" },
      playerMemory: {
        battleTypeFlags: (1 << 2) | (1 << 3),
        battle: {
          playerPartySlot: 0,
          player: {
            species: 46, level: 50, hp: 120, maxHp: 120,
            moves: [33], pp: [20], stats: { attack: 120, spAttack: 120 },
          },
          opponent: {
            species: 4, level: 25, hp: 65, maxHp: 65,
            stats: { defense: 43, spDefense: 50 },
          },
        },
        trainer: {
          partyCount: 2,
          usablePartyCount: 2,
          party,
          bag: { items: [] },
        },
        ui,
      },
    });
    return createPolicyAdvisors({
      mechanics: hmMechanics,
      campaignPlanner,
      teamPlan: createOriginsTeamPlan(4),
    }).flatMap((advisor) => advisor.advise(observed) ?? [])
      .find(({ advisor }) => advisor === "battle")?.recommendation;
  };

  assert.deepEqual(recommend({ battle: { stage: "action", cursor: 0 } }), {
    kind: "choose-battle-command",
    targetCommand: "pokemon",
    objective: "deploy-battle-specialist",
    targetPartySlot: 1,
  });
  assert.deepEqual(recommend({ party: { stage: "choose-pokemon", cursor: 0 } }), {
    kind: "choose-party-member",
    targetPartySlot: 1,
    targetSpecies: 4,
    objective: "deploy-battle-specialist",
  });
});

test("an HM carrier pivots after a Revive instead of healing itself", () => {
  const hmMechanics = {
    ...mechanics,
    species: {
      ...mechanics.species,
      46: {
        id: 46,
        types: ["TYPE_BUG", "TYPE_GRASS"],
        baseAttack: 100,
        baseSpAttack: 100,
      },
    },
  };
  const party = [
    { slot: 0, species: 46, level: 50, hp: 10, maxHp: 120, moves: [33] },
    { slot: 1, species: 4, level: 25, hp: 65, maxHp: 65, moves: [33] },
  ];
  const campaignPlanner = { select: () => ({
    id: "important-rival",
    target: { kind: "trigger", map: "MAP_ARENA", index: 0 },
    importantBattle: true,
    minimumBattlePartySize: 2,
  }) };
  const observed = observation({
    emulator: { mode: "battle" },
    playerMemory: {
      battleTypeFlags: (1 << 2) | (1 << 3),
      battle: {
        playerPartySlot: 0,
        player: {
          species: 46, level: 50, hp: 10, maxHp: 120,
          moves: [33], pp: [20], stats: { attack: 120, spAttack: 120 },
        },
        opponent: {
          species: 4, level: 25, hp: 65, maxHp: 65,
          stats: { defense: 43, spDefense: 50 },
        },
      },
      trainer: {
        partyCount: 2,
        usablePartyCount: 2,
        party,
        bag: { items: [{ itemId: 21, quantity: 1 }] },
      },
      ui: { battle: { stage: "action", cursor: 0 } },
    },
  });

  const recommendation = createPolicyAdvisors({
    mechanics: hmMechanics,
    campaignPlanner,
    teamPlan: createOriginsTeamPlan(4),
  }).flatMap((advisor) => advisor.advise(observed) ?? [])
    .find(({ advisor }) => advisor === "battle")?.recommendation;

  assert.deepEqual(recommendation, {
    kind: "choose-battle-command",
    targetCommand: "pokemon",
    objective: "deploy-battle-specialist",
    targetPartySlot: 1,
  });
});

test("the battle policy uses sleep then draining support when a trainer battle has no damaging PP", () => {
  const trainerBattle = (status1) => observation({
    emulator: { mode: "battle" },
    playerMemory: {
      battleTypeFlags: (1 << 2) | (1 << 3),
      battle: {
        player: {
          species: 1,
          hp: 10,
          maxHp: 59,
          moves: [33, 79, 73, 0],
          pp: [0, 15, 10, 0],
          stats: { attack: 30, spAttack: 30 },
        },
        opponent: {
          species: 4,
          hp: 29,
          maxHp: 29,
          status1,
          stats: { defense: 20, spDefense: 20 },
        },
      },
      ui: { battle: { stage: "move", cursor: 0, selectedMoveId: 33 } },
    },
  });
  const recommendation = (observed) => createPolicyAdvisors({ mechanics })
    .map((advisor) => advisor.advise(observed))
    .find((entry) => entry?.advisor === "battle")
    ?.recommendation;

  assert.deepEqual(recommendation(trainerBattle(0)), {
    kind: "choose-battle-move",
    targetMoveId: 79,
    targetMoveSlot: 1,
    objective: "survive-with-support-move",
  });
  assert.deepEqual(recommendation(trainerBattle(2)), {
    kind: "choose-battle-move",
    targetMoveId: 73,
    targetMoveSlot: 2,
    objective: "survive-with-support-move",
  });
});

test("the battle policy puts a bulky trainer matchup to sleep before attacking", () => {
  const trainerBattle = (status1, attack = 20, status3 = 0) => observation({
    emulator: { mode: "battle" },
    playerMemory: {
      battleTypeFlags: (1 << 2) | (1 << 3),
      battle: {
        player: {
          species: 1,
          hp: 80,
          maxHp: 100,
          moves: [33, 79, 73, 0],
          pp: [20, 15, 10, 0],
          stats: { attack, spAttack: 20 },
        },
        opponent: {
          species: 4,
          hp: 100,
          maxHp: 100,
          status1,
          status3,
          stats: { defense: 80, spDefense: 80 },
        },
      },
      trainer: { party: [] },
      ui: { battle: { stage: "move", cursor: 0, selectedMoveId: 33 } },
    },
  });
  const recommendation = (observed) => createPolicyAdvisors({ mechanics })
    .map((advisor) => advisor.advise(observed))
    .find((entry) => entry?.advisor === "battle")
    ?.recommendation;

  assert.deepEqual(recommendation(trainerBattle(0)), {
    kind: "choose-battle-move",
    targetMoveId: 79,
    targetMoveSlot: 1,
    objective: "control-bulky-trainer-matchup",
  });
  assert.deepEqual(recommendation(trainerBattle(2)), {
    kind: "choose-battle-move",
    targetMoveId: 73,
    targetMoveSlot: 2,
    objective: "control-bulky-trainer-matchup",
  });
  assert.equal(recommendation(trainerBattle(2, 20, 1 << 2)).targetMoveId, 33);
  assert.equal(recommendation(trainerBattle(0, 400)).targetMoveId, 33);
});

test("Taunt prevents the battle policy from selecting status moves", () => {
  const observed = observation({
    emulator: { mode: "battle" },
    playerMemory: {
      battleTypeFlags: (1 << 2) | (1 << 3),
      battle: {
        player: {
          species: 1,
          hp: 80,
          maxHp: 100,
          moves: [33, 79, 73, 0],
          pp: [20, 15, 10, 0],
          stats: { attack: 20, spAttack: 20 },
          moveState: { tauntTurns: 2 },
        },
        opponent: {
          species: 4,
          hp: 100,
          maxHp: 100,
          status1: 0,
          status3: 0,
          stats: { defense: 80, spDefense: 80 },
        },
      },
      trainer: { party: [] },
      ui: { battle: { stage: "move", cursor: 1, selectedMoveId: 79 } },
    },
  });

  const recommendation = createPolicyAdvisors({ mechanics })
    .flatMap((advisor) => advisor.advise(observed) ?? [])
    .find(({ advisor }) => advisor === "battle")?.recommendation;

  assert.equal(recommendation.kind, "choose-battle-move");
  assert.equal(recommendation.targetMoveId, 33);
  assert.equal(recommendation.targetMoveSlot, 0);
});

test("trainer battles use a Full Restore through the observed Bag workflow", () => {
  const party = [
    { slot: 0, species: 1, level: 50, hp: 20, maxHp: 100, moves: [33] },
    { slot: 1, species: 131, level: 50, hp: 180, maxHp: 180, moves: [57] },
  ];
  const battleState = {
    player: {
      species: 1,
      hp: 20,
      maxHp: 100,
      moves: [33],
      pp: [20],
      stats: { attack: 80, spAttack: 80 },
    },
    opponent: {
      species: 4,
      hp: 70,
      maxHp: 70,
      stats: { defense: 60, spDefense: 60 },
    },
  };
  const advise = (ui) => {
    const observed = observation({
      emulator: { mode: "battle" },
      playerMemory: {
        battleTypeFlags: (1 << 2) | (1 << 3),
        battle: battleState,
        trainer: {
          partyCount: 2,
          usablePartyCount: 2,
          party,
          bag: { items: [{ itemId: 19, quantity: 3 }] },
        },
        ui,
      },
    });
    return createPolicyAdvisors({ mechanics })
      .flatMap((advisor) => advisor.advise(observed) ?? [])
      .find(({ advisor }) => advisor === "battle")?.recommendation;
  };

  assert.deepEqual(advise({ battle: { stage: "action", cursor: 0 } }), {
    kind: "choose-battle-command",
    targetCommand: "bag",
    objective: "restore-active-pokemon",
  });
  assert.deepEqual(advise({
    battle: null,
    bag: { stage: "list", pocket: 0, index: 1 },
  }), {
    kind: "choose-bag-item",
    targetItemId: 19,
    targetIndex: 0,
    objective: "restore-active-pokemon",
  });
  assert.equal(advise({
    battle: null,
    party: { stage: "choose-pokemon", cursor: 1, itemId: 19 },
  }).targetPartySlot, 0);
});

test("trainer battles conserve Full Restores when a pure HP medicine is available", () => {
  const party = [
    { slot: 0, species: 1, level: 50, hp: 20, maxHp: 100, moves: [33] },
  ];
  const observed = observation({
    emulator: { mode: "battle" },
    playerMemory: {
      battleTypeFlags: (1 << 2) | (1 << 3),
      battle: {
        player: {
          species: 1,
          hp: 20,
          maxHp: 100,
          status1: 0,
          moves: [33],
          pp: [20],
          stats: { attack: 80, spAttack: 80 },
        },
        opponent: {
          species: 4,
          hp: 70,
          maxHp: 70,
          stats: { defense: 60, spDefense: 60 },
        },
      },
      trainer: {
        partyCount: 1,
        usablePartyCount: 1,
        party,
        bag: { items: [
          { itemId: 19, quantity: 3 },
          { itemId: 20, quantity: 3 },
        ] },
      },
      ui: { bag: { stage: "list", pocket: 0, index: 0 } },
    },
  });

  const recommendation = createPolicyAdvisors({ mechanics })
    .flatMap((advisor) => advisor.advise(observed) ?? [])
    .find(({ advisor }) => advisor === "battle")?.recommendation;

  assert.deepEqual(recommendation, {
    kind: "choose-bag-item",
    targetItemId: 20,
    targetIndex: 1,
    objective: "restore-active-pokemon",
  });
});

test("restricted battle modes never open an unusable item menu", () => {
  const observed = observation({
    emulator: { mode: "battle" },
    playerMemory: {
      battleTypeFlags: (1 << 2) | (1 << 3) | (1 << 8),
      battle: {
        player: {
          species: 1,
          hp: 10,
          maxHp: 100,
          moves: [33],
          pp: [20],
          stats: { attack: 80, spAttack: 80 },
        },
        opponent: {
          species: 4,
          hp: 70,
          maxHp: 70,
          stats: { defense: 60, spDefense: 60 },
        },
      },
      trainer: {
        partyCount: 1,
        usablePartyCount: 1,
        party: [{ slot: 0, species: 1, hp: 10, maxHp: 100 }],
        bag: { items: [{ itemId: 19, quantity: 3 }] },
      },
      ui: { battle: { stage: "action", cursor: 1 } },
    },
  });
  const recommendation = createPolicyAdvisors({ mechanics })
    .flatMap((advisor) => advisor.advise(observed) ?? [])
    .find(({ advisor }) => advisor === "battle")?.recommendation;

  assert.equal(recommendation.targetCommand, "fight");
});

test("trainer battles use stocked Hyper Potions and Full Heals", () => {
  const recommend = ({ hp, status1, items }) => {
    const observed = observation({
      emulator: { mode: "battle" },
      playerMemory: {
        battleTypeFlags: (1 << 2) | (1 << 3),
        battle: {
          player: {
            species: 3,
            hp,
            maxHp: 100,
            status1,
            moves: [33],
            pp: [20],
            stats: { attack: 80, spAttack: 80 },
          },
          opponent: {
            species: 4,
            hp: 70,
            maxHp: 70,
            stats: { defense: 60, spDefense: 60 },
          },
        },
        trainer: {
          partyCount: 1,
          usablePartyCount: 1,
          party: [{ slot: 0, species: 3, hp, maxHp: 100, moves: [33] }],
          bag: { items },
        },
        ui: { battle: { stage: "action", cursor: 0 } },
      },
    });
    return createPolicyAdvisors({ mechanics })
      .flatMap((advisor) => advisor.advise(observed) ?? [])
      .find(({ advisor }) => advisor === "battle")?.recommendation;
  };

  assert.deepEqual(recommend({
    hp: 40,
    status1: 0,
    items: [{ itemId: 21, quantity: 8 }, { itemId: 23, quantity: 4 }],
  }), {
    kind: "choose-battle-command",
    targetCommand: "bag",
    objective: "restore-active-pokemon",
  });
  assert.deepEqual(recommend({
    hp: 80,
    status1: 64,
    items: [{ itemId: 21, quantity: 8 }, { itemId: 23, quantity: 4 }],
  }), {
    kind: "choose-battle-command",
    targetCommand: "bag",
    objective: "cure-active-status",
  });
});

test("trainer recovery heals before a live super-effective matchup can two-hit", () => {
  const threatMechanics = {
    ...mechanics,
    typeChart: [
      ...mechanics.typeChart,
      { attackingType: "TYPE_FIRE", defendingType: "TYPE_GRASS", multiplier: 20 },
      { attackingType: "TYPE_FLYING", defendingType: "TYPE_GRASS", multiplier: 20 },
    ],
  };
  const observed = observation({
    emulator: { mode: "battle" },
    playerMemory: {
      battleTypeFlags: (1 << 2) | (1 << 3),
      battle: {
        player: {
          species: 1,
          hp: 60,
          maxHp: 100,
          status1: 0,
          moves: [75, 79, 73, 15],
          pp: [20, 10, 10, 20],
          stats: { attack: 80, spAttack: 100 },
        },
        opponent: {
          species: 6,
          hp: 120,
          maxHp: 120,
          status1: 0,
          moves: [53, 17],
          pp: [15, 20],
          stats: { defense: 80, spDefense: 85 },
        },
      },
      trainer: {
        partyCount: 1,
        usablePartyCount: 1,
        party: [{ slot: 0, species: 1, hp: 60, maxHp: 100,
          moves: [75, 79, 73, 15] }],
        bag: { items: [{ itemId: 21, quantity: 8 }] },
      },
      ui: { battle: { stage: "action", cursor: 0 } },
    },
  });
  const recommendation = createPolicyAdvisors({ mechanics: threatMechanics })
    .flatMap((advisor) => advisor.advise(observed) ?? [])
    .find(({ advisor }) => advisor === "battle")?.recommendation;

  assert.deepEqual(recommendation, {
    kind: "choose-battle-command",
    targetCommand: "bag",
    objective: "restore-active-pokemon",
  });
});

test("damage-aware recovery conserves medicine when current HP survives the strongest known hit", () => {
  const observed = observation({
    emulator: { mode: "battle" },
    playerMemory: {
      battleTypeFlags: (1 << 2) | (1 << 3),
      battle: {
        player: {
          species: 1, level: 50, hp: 35, maxHp: 100, status1: 0,
          moves: [75], pp: [20],
          stats: { attack: 80, defense: 100, spAttack: 100, spDefense: 100 },
        },
        opponent: {
          species: 4, level: 20, hp: 70, maxHp: 70, status1: 0,
          moves: [33], pp: [20],
          stats: { attack: 30, defense: 60, spAttack: 30, spDefense: 60 },
        },
      },
      trainer: {
        partyCount: 1,
        usablePartyCount: 1,
        party: [{ slot: 0, species: 1, level: 50, hp: 35, maxHp: 100,
          moves: [75] }],
        bag: { items: [{ itemId: 22, quantity: 4 }] },
      },
      ui: { battle: { stage: "action", cursor: 0 } },
    },
  });

  const recommendation = createPolicyAdvisors({ mechanics })
    .flatMap((advisor) => advisor.advise(observed) ?? [])
    .find(({ advisor }) => advisor === "battle")?.recommendation;

  assert.equal(recommendation.targetCommand, "fight");
});

test("damage-aware recovery uses the smallest stocked item that restores one-hit safety", () => {
  const threatMechanics = {
    ...mechanics,
    typeChart: [
      ...mechanics.typeChart,
      { attackingType: "TYPE_FIRE", defendingType: "TYPE_GRASS", multiplier: 20 },
    ],
  };
  const observed = observation({
    emulator: { mode: "battle" },
    playerMemory: {
      battleTypeFlags: (1 << 2) | (1 << 3),
      battle: {
        player: {
          species: 1, level: 35, hp: 10, maxHp: 100, status1: 0,
          moves: [75], pp: [20],
          stats: { attack: 80, defense: 80, spAttack: 90, spDefense: 80 },
        },
        opponent: {
          species: 4, level: 30, hp: 70, maxHp: 70, status1: 0,
          moves: [53], pp: [15],
          stats: { attack: 60, defense: 60, spAttack: 70, spDefense: 60 },
        },
      },
      trainer: {
        partyCount: 1,
        usablePartyCount: 1,
        party: [{ slot: 0, species: 1, level: 35, hp: 10, maxHp: 100,
          moves: [75] }],
        bag: { items: [
          { itemId: 20, quantity: 1 },
          { itemId: 21, quantity: 1 },
          { itemId: 22, quantity: 1 },
          { itemId: 28, quantity: 1 },
        ] },
      },
      ui: { bag: { stage: "list", pocket: 0, index: 0 } },
    },
  });

  const recommendation = createPolicyAdvisors({ mechanics: threatMechanics })
    .flatMap((advisor) => advisor.advise(observed) ?? [])
    .find(({ advisor }) => advisor === "battle")?.recommendation;

  assert.deepEqual(recommendation, {
    kind: "choose-bag-item",
    targetItemId: 28,
    targetIndex: 3,
    objective: "restore-active-pokemon",
  });
});

test("the battle policy acknowledges a completed party item result", () => {
  const observed = observation({
    emulator: { mode: "battle", callback2: "CB2_UpdatePartyMenu" },
    playerMemory: {
      battleTypeFlags: (1 << 2) | (1 << 3),
      battle: {
        player: {
          species: 3,
          hp: 100,
          maxHp: 134,
          status1: 0,
          moves: [33],
          pp: [20],
          stats: { attack: 80, spAttack: 80 },
        },
        opponent: {
          species: 102,
          hp: 98,
          maxHp: 98,
          stats: { defense: 70, spDefense: 47 },
        },
      },
      trainer: {
        partyCount: 1,
        usablePartyCount: 1,
        party: [{ slot: 0, species: 3, hp: 100, maxHp: 134, moves: [33] }],
        bag: { items: [{ itemId: 23, quantity: 3 }] },
      },
      ui: {
        battle: null,
        party: { stage: "message", cursor: 0, selectedPartySlot: 0, itemId: 23 },
      },
    },
  });
  const advisors = createPolicyAdvisors({ mechanics });
  const recommendation = advisors
    .flatMap((advisor) => advisor.advise(observed) ?? [])
    .find(({ advisor }) => advisor === "battle")?.recommendation;

  assert.deepEqual(recommendation, { kind: "acknowledge-cartridge-prompt" });
  assert.deepEqual(mapRecommendation(recommendation, observed).buttons, ["a"]);
  assert.equal(createCentralPlayer({ advisors }).decide(observed).winner.advisor,
    "battle");
});

test("a free shift chooses the party member with the strongest proven matchup", () => {
  const campaignPlanner = { select: () => null };
  const party = [
    { slot: 0, species: 1, level: 50, hp: 140, maxHp: 140, moves: [33] },
    { slot: 1, species: 131, level: 50, hp: 200, maxHp: 200, moves: [57] },
  ];
  const base = {
    battle: {
      player: { species: 1, hp: 140, maxHp: 140 },
      opponent: { species: 59, hp: 0, maxHp: 100 },
      announcedOpponentName: "CHARMANDER",
    },
    trainer: { usablePartyCount: 2, party },
  };
  const recommend = (ui) => {
    const observed = observation({
      emulator: { mode: "battle" },
      playerMemory: { ...base, ui },
    });
    return createPolicyAdvisors({ mechanics, campaignPlanner })
      .flatMap((advisor) => advisor.advise(observed) ?? [])
      .find(({ advisor }) => advisor === "battle")?.recommendation;
  };

  assert.deepEqual(recommend({ choiceMenu: { cursor: 1 } }), {
    kind: "choose-menu-option",
    targetOption: "yes",
    targetPartySlot: 1,
    targetSpecies: 131,
    objective: "counter-announced-opponent",
  });
  assert.deepEqual(recommend({
    party: { stage: "choose-pokemon", cursor: 0 },
  }), {
    kind: "choose-party-member",
    targetPartySlot: 1,
    targetSpecies: 131,
    objective: "counter-announced-opponent",
  });
  assert.deepEqual(recommend({
    party: { stage: "selection-menu", cursor: 1, actionCursor: 0 },
    choiceMenu: { cursor: 0, selected: "shift" },
  }), {
    kind: "choose-menu-option",
    targetIndex: 0,
    objective: "confirm-battle-party-action",
  });
});

test("a safe super-effective counter can replace an overleveled neutral attacker", () => {
  const party = [
    {
      slot: 0, species: 6, level: 55, hp: 163, maxHp: 163,
      moves: [17], pp: [35], stats: { attack: 112, spAttack: 150 },
    },
    {
      slot: 1, species: 131, level: 42, hp: 170, maxHp: 170,
      moves: [57], pp: [15], stats: { attack: 85, spAttack: 80 },
    },
  ];
  const recommend = (ui) => {
    const observed = observation({
      emulator: { mode: "battle" },
      playerMemory: {
        battleTypeFlags: (1 << 2) | (1 << 3),
        battle: {
          playerPartySlot: 0,
          player: party[0],
          opponent: {
            species: 59, level: 40, hp: 0, maxHp: 100,
            stats: { defense: 43, spDefense: 50 },
          },
          announcedOpponentName: "CHARMANDER",
        },
        trainer: { usablePartyCount: 2, party },
        ui,
      },
    });
    return createPolicyAdvisors({ mechanics, campaignPlanner: { select: () => null } })
      .flatMap((advisor) => advisor.advise(observed) ?? [])
      .find(({ advisor }) => advisor === "battle")?.recommendation;
  };

  assert.equal(recommend({ choiceMenu: { cursor: 1 } })?.targetOption, "yes");
  assert.deepEqual(recommend({
    party: { stage: "choose-pokemon", cursor: 0 },
  }), {
    kind: "choose-party-member",
    targetPartySlot: 1,
    targetSpecies: 131,
    objective: "counter-announced-opponent",
  });
});

test("switch training bypasses a resisted planned escort for a suitable finisher", () => {
  const escortMechanics = {
    ...mechanics,
    typeChart: [
      ...mechanics.typeChart,
      { attackingType: "TYPE_GRASS", defendingType: "TYPE_FIRE", multiplier: 5 },
    ],
  };
  const storyObjective = {
    id: "next-rival",
    target: { kind: "trigger", map: "MAP_TRAINING_MEADOW", index: 0 },
    importantBattle: true,
  };
  const trainingObjective = {
    id: "train-battle-member",
    target: { kind: "encounter-zone", map: "MAP_TRAINING_MEADOW" },
    forObjective: storyObjective.id,
    trainingMethod: "switch",
    trainingPartySlot: 0,
    trainingSpecies: 25,
    escortPartySlot: 1,
    escortSpecies: 1,
  };
  const campaignPlanner = {
    select: () => storyObjective,
    selectTraining: () => trainingObjective,
  };
  const party = [
    { slot: 0, species: 25, level: 10, hp: 30, maxHp: 30,
      moves: [33], pp: [20] },
    { slot: 1, species: 1, level: 16, hp: 45, maxHp: 45,
      moves: [75], pp: [25] },
    { slot: 2, species: 131, level: 55, hp: 183, maxHp: 183,
      moves: [57], pp: [15] },
  ];
  const recommend = (ui) => {
    const observed = observation({
      emulator: { mode: "battle" },
      playerMemory: {
        map: { id: "MAP_TRAINING_MEADOW" },
        battleTypeFlags: 1 << 2,
        battle: {
          playerPartySlot: 0,
          sentPartyMasks: [0b000001, 0],
          player: {
            ...party[0],
            stats: { attack: 20, spAttack: 20 },
          },
          opponent: {
            species: 4, level: 14, hp: 35, maxHp: 35,
            stats: { defense: 20, spDefense: 20 },
          },
        },
        trainer: { partyCount: 3, usablePartyCount: 3, party },
        ui,
      },
    });
    return createPolicyAdvisors({ mechanics: escortMechanics, campaignPlanner })
      .flatMap((advisor) => advisor.advise(observed) ?? [])
      .find(({ advisor }) => advisor === "battle")?.recommendation;
  };

  assert.deepEqual(recommend({ battle: { stage: "action", cursor: 0 } }), {
    kind: "choose-battle-command",
    targetCommand: "pokemon",
    objective: "protect-training-member",
    targetPartySlot: 2,
  });
  assert.deepEqual(recommend({
    battle: null,
    party: { stage: "choose-pokemon", cursor: 0 },
  }), {
    kind: "choose-party-member",
    targetPartySlot: 2,
    targetSpecies: 131,
    objective: "protect-training-member",
  });

  party[1].hp = 10;
  assert.deepEqual(recommend({ battle: { stage: "action", cursor: 0 } }), {
    kind: "choose-battle-command",
    targetCommand: "pokemon",
    objective: "protect-training-member",
    targetPartySlot: 2,
  });
});

test("known enemy coverage prevents a superficially favorable type switch", () => {
  const coverageMechanics = {
    ...mechanics,
    typeChart: [
      ...mechanics.typeChart,
      { attackingType: "TYPE_FIRE", defendingType: "TYPE_WATER", multiplier: 5 },
      { attackingType: "TYPE_FIRE", defendingType: "TYPE_ICE", multiplier: 20 },
      { attackingType: "TYPE_GRASS", defendingType: "TYPE_FIRE", multiplier: 5 },
      { attackingType: "TYPE_GRASS", defendingType: "TYPE_FLYING", multiplier: 5 },
      { attackingType: "TYPE_GRASS", defendingType: "TYPE_WATER", multiplier: 20 },
    ],
  };
  const party = [
    {
      slot: 0, species: 6, level: 55, hp: 163, maxHp: 163,
      moves: [17], pp: [35], stats: { attack: 112, spAttack: 150 },
    },
    {
      slot: 1, species: 131, level: 42, hp: 170, maxHp: 170,
      moves: [57], pp: [15], stats: { attack: 85, spAttack: 80 },
    },
  ];
  const observed = observation({
    emulator: { mode: "battle" },
    playerMemory: {
      battleTypeFlags: (1 << 2) | (1 << 3),
      battle: {
        playerPartySlot: 0,
        player: party[0],
        opponent: {
          species: 4, level: 40, hp: 90, maxHp: 90,
          moves: [75], pp: [10],
          stats: { defense: 43, spDefense: 50 },
        },
      },
      trainer: { usablePartyCount: 2, party },
      ui: { battle: { stage: "action", cursor: 0 } },
    },
  });

  const recommendation = createPolicyAdvisors({
    mechanics: coverageMechanics,
    campaignPlanner: { select: () => null },
  }).flatMap((advisor) => advisor.advise(observed) ?? [])
    .find(({ advisor }) => advisor === "battle")?.recommendation;

  assert.deepEqual(recommendation, {
    kind: "choose-battle-command",
    targetCommand: "fight",
  });
});

test("a free shift fulfills pending switch training instead of spending a battle turn", () => {
  const storyObjective = {
    id: "silph-liberated",
    target: { kind: "map-arrival", map: "MAP_TARGET_BOSS", x: 0, y: 0 },
    importantBattle: true,
    minimumBattlePartySize: 6,
  };
  const trainingObjective = {
    id: "train-battle-member",
    target: { kind: "object", map: "MAP_SILPH_CO_7F", index: 1 },
    forObjective: storyObjective.id,
    trainingSource: "trainer",
    trainingMethod: "switch",
    trainingPartySlot: 1,
    trainer: { id: "silph-grunt", maximumLevel: 35 },
  };
  const campaignPlanner = {
    select: () => storyObjective,
    selectTraining: () => trainingObjective,
  };
  const party = [
    {
      slot: 0, species: 6, level: 55, hp: 150, maxHp: 163,
      moves: [17, 53], pp: [35, 15],
      stats: { attack: 112, spAttack: 150 },
    },
    {
      slot: 1, species: 131, level: 28, hp: 112, maxHp: 112,
      moves: [57], pp: [15], stats: { attack: 58, spAttack: 54 },
    },
  ];
  const observe = (ui, captureId = undefined, frame = undefined) =>
    observation({
      ...(captureId ? { captureId } : {}),
      ...(frame === undefined ? {} : { frame }),
      emulator: { mode: "battle" },
      playerMemory: {
        map: { id: "MAP_SILPH_CO_7F" },
        battleTypeFlags: (1 << 2) | (1 << 3),
        battle: {
          playerPartySlot: 0,
          player: party[0],
          opponent: {
            species: 59, level: 28, hp: 0, maxHp: 80,
            stats: { defense: 50, spDefense: 50 },
          },
          announcedOpponentName: "CHARMANDER",
          sentPartyMasks: [1, 0],
        },
        trainer: { usablePartyCount: 2, party, bag: { items: [] } },
        ui,
      },
    });
  const recommend = (ui) => {
    const observed = observe(ui);
    return createPolicyAdvisors({ mechanics, campaignPlanner })
      .flatMap((advisor) => advisor.advise(observed) ?? [])
      .find(({ advisor }) => advisor === "battle")?.recommendation;
  };

  assert.deepEqual(recommend({ choiceMenu: { cursor: 1 } }), {
    kind: "choose-menu-option",
    targetOption: "yes",
    targetPartySlot: 1,
    targetSpecies: 131,
    objective: "train-team-anchor",
  });
  assert.deepEqual(recommend({
    party: { stage: "choose-pokemon", cursor: 0 },
  }), {
    kind: "choose-party-member",
    targetPartySlot: 1,
    targetSpecies: 131,
    objective: "train-team-anchor",
  });

  const player = createCentralPlayer({
    advisors: createPolicyAdvisors({ mechanics, campaignPlanner }),
  });
  player.decide(observe(
    { choiceMenu: { cursor: 1 } },
    "free-shift-commit",
    100,
  ));
  assert.deepEqual(player.state().workflow && {
    kind: player.state().workflow.kind,
    targetPartySlot: player.state().workflow.targetPartySlot,
    targetSpecies: player.state().workflow.targetSpecies,
  }, {
    kind: "battle-party-selection",
    targetPartySlot: 1,
    targetSpecies: 131,
  });
  const firstPartyStep = player.decide(observe(
    { party: { stage: "choose-pokemon", cursor: 0, selectedPartySlot: 0 } },
    "free-shift-party",
    104,
  ));
  assert.equal(
    firstPartyStep.proposals.some(({ advisor }) => advisor === "battle"),
    false,
  );
  assert.equal(firstPartyStep.winner?.recommendation.targetPartySlot, 1);
});

test("a free shift retains an active trainee for the newly announced opponent", () => {
  const storyObjective = {
    id: "next-boss",
    target: { kind: "trigger", map: "MAP_SHIFT_TRAINING", index: 0 },
    importantBattle: true,
  };
  const campaignPlanner = {
    select: () => storyObjective,
    selectTraining: () => ({
      id: "train-team-anchor-with-trainer",
      target: { kind: "object", map: "MAP_SHIFT_TRAINING", index: 1 },
      forObjective: storyObjective.id,
      trainingSource: "trainer",
      trainingMethod: "direct",
      trainingPartySlot: 0,
      trainer: { id: 41, maximumLevel: 30 },
    }),
  };
  const party = [
    {
      slot: 0, species: 1, level: 28, hp: 80, maxHp: 80,
      moves: [33], pp: [20], stats: { attack: 50, spAttack: 50 },
    },
    {
      slot: 1, species: 131, level: 50, hp: 200, maxHp: 200,
      moves: [57], pp: [15], stats: { attack: 85, spAttack: 85 },
    },
  ];
  const recommend = (ui) => {
    const observed = observation({
      emulator: { mode: "battle" },
      playerMemory: {
        map: { id: "MAP_SHIFT_TRAINING" },
        battleTypeFlags: (1 << 2) | (1 << 3),
        battle: {
          playerPartySlot: 0,
          player: party[0],
          opponent: {
            species: 59, level: 28, hp: 0, maxHp: 80,
            stats: { defense: 50, spDefense: 50 },
          },
          announcedOpponentName: "CHARMANDER",
          sentPartyMasks: [0b000001, 0],
        },
        trainer: { usablePartyCount: 2, party, bag: { items: [] } },
        ui,
      },
    });
    return createPolicyAdvisors({ mechanics, campaignPlanner })
      .flatMap((advisor) => advisor.advise(observed) ?? [])
      .find(({ advisor }) => advisor === "battle")?.recommendation;
  };

  assert.deepEqual(recommend({ choiceMenu: { cursor: 1 } }), {
    kind: "choose-menu-option",
    targetOption: "no",
  });
  assert.deepEqual(recommend({
    party: {
      stage: "choose-pokemon",
      cursor: 0,
      cursorPokemon: { slot: 0, species: 1, hp: 80, maxHp: 80 },
    },
  }), {
    kind: "retain-active-pokemon",
    announcedOpponentName: "CHARMANDER",
    observedCursorSpecies: 1,
  });
});

test("a single-battle shift prompt ignores FireRed's stale player-right battler", () => {
  const observed = observation({
    emulator: { mode: "battle" },
    playerMemory: {
      battleTypeFlags: (1 << 2) | (1 << 3),
      activeBattler: 2,
      battle: {
        playerPartySlot: 0,
        battlerPartyIndexes: [0, 0, 1, 1],
        player: {
          battler: 0,
          species: 131,
          level: 35,
          hp: 140,
          maxHp: 140,
          moves: [57],
          pp: [15],
          stats: { attack: 80, spAttack: 90 },
        },
        opponent: { battler: 1, species: 59, hp: 0, maxHp: 100 },
        battlers: [
          { battler: 0, species: 131, level: 35, hp: 140, maxHp: 140,
            moves: [57], pp: [15], stats: { attack: 80, spAttack: 90 } },
          { battler: 1, species: 59, hp: 0, maxHp: 100 },
          { battler: 2, species: 1, level: 32, hp: 86, maxHp: 86,
            moves: [33], pp: [20], stats: { attack: 55, spAttack: 60 } },
          { battler: 3, species: 4, hp: 0, maxHp: 80 },
        ],
        announcedOpponentName: "CHARMANDER",
      },
      trainer: {
        usablePartyCount: 2,
        party: [
          { slot: 0, species: 131, level: 35, hp: 140, maxHp: 140,
            moves: [57], stats: { attack: 80, spAttack: 90 } },
          { slot: 1, species: 1, level: 32, hp: 86, maxHp: 86,
            moves: [33], stats: { attack: 55, spAttack: 60 } },
        ],
      },
      ui: { choiceMenu: { cursor: 0, selected: "yes" } },
    },
  });
  const recommendation = createPolicyAdvisors({ mechanics })
    .flatMap((advisor) => advisor.advise(observed) ?? [])
    .find(({ advisor }) => advisor === "battle")?.recommendation;

  assert.deepEqual(recommendation, {
    kind: "choose-menu-option",
    targetOption: "no",
  });
});

test("a resumed free-shift workflow cancels when its target is already active", () => {
  const observed = observation({
    emulator: { mode: "battle", callback2: "CB2_UpdatePartyMenu" },
    playerMemory: {
      battleTypeFlags: (1 << 2) | (1 << 3),
      activeBattler: 2,
      battle: {
        playerPartySlot: 0,
        battlerPartyIndexes: [0, 0, 1, 1],
        player: {
          battler: 0,
          species: 131,
          level: 35,
          hp: 20,
          maxHp: 140,
          moves: [57],
          pp: [15],
          status1: 64,
          stats: { attack: 80, spAttack: 90 },
        },
        opponent: { battler: 1, species: 59, hp: 0, maxHp: 100 },
        battlers: [
          { battler: 0, species: 131, level: 35, hp: 20, maxHp: 140,
            moves: [57], pp: [15], status1: 64,
            stats: { attack: 80, spAttack: 90 } },
          { battler: 1, species: 59, hp: 0, maxHp: 100 },
          { battler: 2, species: 1, level: 32, hp: 86, maxHp: 86,
            moves: [33], pp: [20], stats: { attack: 55, spAttack: 60 } },
          { battler: 3, species: 4, hp: 0, maxHp: 80 },
        ],
        announcedOpponentName: "CHARMANDER",
      },
      trainer: {
        usablePartyCount: 2,
        party: [
          { slot: 0, species: 131, level: 35, hp: 20, maxHp: 140,
            moves: [57], stats: { attack: 80, spAttack: 90 } },
          { slot: 1, species: 1, level: 32, hp: 86, maxHp: 86,
            moves: [33], stats: { attack: 55, spAttack: 60 } },
        ],
        bag: { items: [{ itemId: 19, quantity: 3 }] },
      },
      ui: {
        choiceMenu: { cursor: 0, selected: "shift" },
        party: {
          stage: "selection-menu",
          cursor: 0,
          selectedPartySlot: 0,
          action: "shift",
          actionCursor: 0,
          cursorPokemon: {
            slot: 0,
            species: 131,
            level: 35,
            hp: 20,
            maxHp: 140,
            moves: [57],
          },
        },
      },
    },
  });
  const player = createCentralPlayer({
    advisors: createPolicyAdvisors({ mechanics }),
    initialState: {
      sequence: 100,
      initialSramSha256: "sram",
      workflow: {
        schema: "master-red/control-workflow/v1",
        id: "battle-party-live-loop",
        kind: "battle-party-selection",
        objective: "counter-announced-opponent",
        targetPartySlot: 0,
        targetSpecies: 131,
        targetFingerprint: {
          species: 131,
          level: 35,
          maxHp: 140,
          moves: [57],
        },
        actingBattler: 0,
        sourceAdvisor: "battle",
        stage: "confirming-party-action",
        enteredPartyPicker: true,
        startedObservationId: "before-checkpoint",
        startedFrame: 40,
      },
    },
  });

  const decision = player.decide(observed);

  assert.equal(player.state().workflow, null);
  assert.equal(decision.winner?.recommendation.kind, "retain-active-pokemon");
  assert.deepEqual(decision.action.buttons, ["b"]);
});

test("a committed battle party workflow bypasses non-verifier policy recomputation", () => {
  let battleAdvisorCalls = 0;
  let verifierCalls = 0;
  const battleAdvisor = {
    id: "battle",
    advise(observed) {
      battleAdvisorCalls += 1;
      if (battleAdvisorCalls !== 1) return null;
      return {
        advisor: "battle",
        observationId: observed.captureId,
        recommendation: {
          kind: "choose-battle-command",
          targetCommand: "pokemon",
          targetPartySlot: 1,
          targetSpecies: 4,
          objective: "switch-to-safe-finisher",
        },
        confidence: 1,
        constraints: ["safe-reserve"],
        vetoes: [],
        evidenceRefs: ["cartridge:party-slot:1"],
      };
    },
  };
  const verifier = {
    id: "verifier",
    advise(observed) {
      verifierCalls += 1;
      return {
        advisor: "verifier",
        observationId: observed.captureId,
        recommendation: { kind: "permit-current-observation" },
        confidence: 1,
        constraints: [],
        vetoes: [],
        evidenceRefs: [`observation:${observed.captureId}`],
      };
    },
  };
  const party = [
    { slot: 0, species: 1, level: 20, hp: 50, maxHp: 50, moves: [33] },
    { slot: 1, species: 4, level: 30, hp: 80, maxHp: 80, moves: [53] },
  ];
  const battle = {
    playerPartySlot: 0,
    battlerPartyIndexes: [0, 0],
    player: { ...party[0] },
    opponent: { species: 7, level: 25, hp: 60, maxHp: 60 },
  };
  const player = createCentralPlayer({ advisors: [battleAdvisor, verifier] });

  const openParty = player.decide(observation({
    captureId: "fast-party-open",
    frame: 100,
    emulator: { mode: "battle", callback2: "BattleMainCB2" },
    playerMemory: {
      battleTypeFlags: (1 << 2) | (1 << 3),
      battle,
      trainer: { partyCount: 2, usablePartyCount: 2, party },
      ui: { battle: { stage: "action", cursor: 0 } },
    },
  }));
  assert.equal(openParty.winner?.recommendation.targetCommand, "pokemon");

  const chooseMember = player.decide(observation({
    captureId: "fast-party-choose",
    frame: 104,
    emulator: { mode: "battle", callback2: "CB2_UpdatePartyMenu" },
    playerMemory: {
      battleTypeFlags: (1 << 2) | (1 << 3),
      battle,
      trainer: { partyCount: 2, usablePartyCount: 2, party },
      ui: {
        party: {
          stage: "choose-pokemon",
          cursor: 0,
          selectedPartySlot: 0,
        },
      },
    },
  }));

  assert.deepEqual(chooseMember.winner?.recommendation, {
    kind: "choose-party-member",
    targetPartySlot: 1,
    targetSpecies: 4,
    objective: "switch-to-safe-finisher",
  });
  assert.equal(battleAdvisorCalls, 1);
  assert.equal(verifierCalls, 2);
});

test("ready informational prompts bypass strategic policy recomputation", () => {
  let strategicAdviceCalls = 0;
  let verifierCalls = 0;
  const advisors = createPolicyAdvisors({ mechanics }).map((advisor) => ({
    ...advisor,
    advise(observed) {
      if (advisor.id === "verifier") verifierCalls += 1;
      else strategicAdviceCalls += 1;
      return advisor.advise(observed);
    },
  }));
  const player = createCentralPlayer({ advisors });
  const prompts = [
    observation({
      captureId: "fast-battle-message",
      frame: 200,
      emulator: { mode: "battle", callback2: "BattleMainCB2" },
      playerMemory: {
        battle: { player: {}, opponent: {} },
        ui: { battle: { stage: "message", cursor: null, selected: null } },
      },
    }),
    observation({
      captureId: "fast-battle-level-up",
      frame: 230,
      emulator: { mode: "battle", callback2: "BattleMainCB2" },
      playerMemory: {
        battle: { player: {}, opponent: {} },
        ui: {
          battle: { stage: "level-up-stats", cursor: null, selected: null },
        },
      },
    }),
    observation({
      captureId: "fast-field-page",
      frame: 260,
      playerMemory: {
        ui: {
          fieldDialog: {
            type: "normal",
            stage: "awaiting-page",
            textPrinter: { active: true, state: 3, stateName: "scroll-prompt" },
          },
        },
      },
    }),
    observation({
      captureId: "fast-field-close",
      frame: 290,
      playerMemory: {
        ui: {
          fieldDialog: {
            type: "hidden",
            stage: "awaiting-close",
            textPrinter: { active: false, state: 0, stateName: "handle-character" },
          },
        },
      },
    }),
    observation({
      captureId: "fast-party-message",
      frame: 320,
      emulator: { mode: "party", callback2: "CB2_UpdatePartyMenu" },
      playerMemory: {
        ui: { party: { stage: "message", cursor: 0, selectedPartySlot: 0 } },
      },
    }),
    observation({
      captureId: "fast-move-learning-message",
      frame: 350,
      emulator: { mode: "party", callback2: "CB2_UpdatePartyMenu" },
      playerMemory: {
        ui: {
          moveLearning: {
            stage: "replace-explanation",
            partySlot: 0,
            moveId: 85,
            cursor: null,
            selected: null,
          },
        },
      },
    }),
    observation({
      captureId: "fast-level-up-page",
      frame: 380,
      emulator: { mode: "party", callback2: "CB2_UpdatePartyMenu" },
      playerMemory: {
        ui: { levelUp: { stage: "stats-page-1", partySlot: 0 } },
      },
    }),
    observation({
      captureId: "fast-evolution-message",
      frame: 410,
      emulator: { mode: "evolution", callback2: "CB2_EvolutionSceneUpdate" },
      playerMemory: {
        ui: { evolution: { stage: "complete-message", evolvedPartySlot: 0 } },
      },
    }),
    observation({
      captureId: "fast-special-animation-message",
      frame: 440,
      playerMemory: {
        ui: { specialAnimation: { stage: "message" } },
      },
    }),
    observation({
      captureId: "fast-blackout-message",
      frame: 470,
      playerMemory: {
        ui: { blackout: { stage: "message" } },
      },
    }),
    observation({
      captureId: "fast-mart-result",
      frame: 500,
      emulator: { mode: "mart", callback2: "CB2_BuyMenu" },
      playerMemory: {
        ui: { mart: { stage: "purchase-result" } },
      },
    }),
    observation({
      captureId: "fast-save-result",
      frame: 530,
      emulator: { mode: "start-menu", callback2: "CB2_Overworld" },
      playerMemory: {
        ui: { saveDialog: { stage: "success", cursor: null, selected: null } },
      },
    }),
    observation({
      captureId: "fast-pokedex-registration",
      frame: 560,
      emulator: { mode: "battle", callback2: "CB2_Pokedex" },
      playerMemory: {
        battle: { player: {}, opponent: {} },
        ui: { pokedexRegistration: { stage: "registered-entry" } },
      },
    }),
  ];

  for (const prompt of prompts) {
    const decision = player.decide(prompt);
    assert.equal(decision.winner?.recommendation.kind,
      "acknowledge-cartridge-prompt");
    assert.deepEqual(decision.action.buttons, ["a"]);
  }
  assert.equal(strategicAdviceCalls, 0);
  assert.equal(verifierCalls, prompts.length);
});

test("a single-battle Party action keeps the stale player-right reserve selectable", () => {
  const observed = observation({
    emulator: { mode: "battle", callback2: "CB2_UpdatePartyMenu" },
    playerMemory: {
      battleTypeFlags: (1 << 2) | (1 << 3),
      activeBattler: 2,
      battle: {
        playerPartySlot: 0,
        battlerPartyIndexes: [0, 0, 1, 1],
        player: { battler: 0, species: 131, hp: 140, maxHp: 140 },
        opponent: { battler: 1, species: 59, hp: 0, maxHp: 100 },
        battlers: [
          { battler: 0, species: 131, hp: 140, maxHp: 140 },
          { battler: 1, species: 59, hp: 0, maxHp: 100 },
          { battler: 2, species: 1, hp: 86, maxHp: 86 },
          { battler: 3, species: 4, hp: 0, maxHp: 80 },
        ],
        announcedOpponentName: "CHARMANDER",
      },
      trainer: {
        usablePartyCount: 2,
        party: [
          { slot: 0, species: 131, level: 35, hp: 140, maxHp: 140,
            moves: [57] },
          { slot: 1, species: 1, level: 32, hp: 86, maxHp: 86,
            moves: [33] },
        ],
      },
      ui: {
        choiceMenu: { cursor: 0, selected: "shift" },
        party: {
          stage: "selection-menu",
          cursor: 1,
          selectedPartySlot: 1,
          action: "shift",
          actionCursor: 0,
          cursorPokemon: { slot: 1, species: 1, hp: 86, maxHp: 86 },
        },
      },
    },
  });
  const recommendation = createPolicyAdvisors({ mechanics })
    .flatMap((advisor) => advisor.advise(observed) ?? [])
    .find(({ advisor }) => advisor === "battle")?.recommendation;

  assert.deepEqual(recommendation, {
    kind: "choose-menu-option",
    targetIndex: 0,
    objective: "confirm-battle-party-action",
  });
});

test("a pending battle switch closes another member's submenu before continuing its committed target", () => {
  const party = [
    {slot: 0, species: 1, level: 15, hp: 40, maxHp: 40, moves: [33]},
    {slot: 1, species: 131, level: 50, hp: 150, maxHp: 150, moves: [57]},
    {slot: 2, species: 34, level: 50, hp: 150, maxHp: 150, moves: [33]},
  ];
  const initialState = {sequence: 4, initialSramSha256: null, workflow: {
    schema: "master-red/control-workflow/v1", id: "battle-party-4", kind: "battle-party-selection",
    objective: "protect-training-member", targetPartySlot: 1, targetSpecies: 131,
    actingBattler: 0, sourceAdvisor: "battle", stage: "confirming-party-action", enteredPartyPicker: true,
  }};
  const player = createCentralPlayer({initialState, advisors: createPolicyAdvisors({mechanics}),
    campaignPlanner: {state: () => ({}), safetyCheck: o => o.emulator.inputReady
      ? null : {kind: "resample", reason: "hunt-battle-transition"}},
  });
  const observe = (ui, frame) => observation({captureId: `switch-submenu-${frame}`, frame,
    emulator: {mode: "battle", callback2: "CB2_UpdatePartyMenu"}, playerMemory: {
      trainer: {party, usablePartyCount: 3},
      battle: {player: party[0], playerPartySlot: 0, battlerPartyIndexes: [0, 0, 0, 0], opponent: {species: 22, hp: 90, maxHp: 90}},
      ui: {party: ui},
    }});
  const close = player.decide(observe({stage: "selection-menu", cursor: 2, selectedPartySlot: 2, actionCursor: 0}, 100));
  assert.deepEqual(close.action.buttons, ["b"]);
  assert.equal(player.state().workflow.targetPartySlot, 1);
  const move = player.decide(observe({stage: "choose-pokemon", cursor: 2}, 104));
  assert.deepEqual(move.action.buttons, ["up"]);
  const select = player.decide(observe({stage: "choose-pokemon", cursor: 1}, 108));
  assert.deepEqual(select.action.buttons, ["a"]);
  const transition = observe({stage: "selection-menu", cursor: 1, selectedPartySlot: 1, actionCursor: 0}, 110);
  transition.emulator.inputReady = false;
  assert.equal(player.decide(transition).reason, "hunt-battle-transition");
  assert.equal(player.state().workflow?.targetPartySlot, 1, "an input-readiness wait must preserve the committed switch");
  const confirm = player.decide(observe({stage: "selection-menu", cursor: 1, selectedPartySlot: 1, actionCursor: 0}, 112));
  assert.deepEqual(confirm.action.buttons, ["a"]);
});

test("party selection never sends list navigation into an open action submenu", () => {
  for (const mode of ["battle", "party"]) for (const cursor of [0, 1, 5]) {
    const action = mapRecommendation({kind: "choose-party-member", targetPartySlot: 1},
      observation({emulator: {mode}, playerMemory: {ui: {party: {stage: "selection-menu", cursor, selectedPartySlot: cursor, actionCursor: 0}}}}));
    assert.deepEqual(action.buttons, ["b"], `${mode} slot ${cursor}: first close the submenu`);
  }
});

test("a trainer matchup can switch through the action and party menus", () => {
  const party = [
    { slot: 0, species: 1, level: 50, hp: 140, maxHp: 140, moves: [33] },
    { slot: 1, species: 131, level: 50, hp: 200, maxHp: 200, moves: [57] },
  ];
  const battleState = {
    player: {
      species: 1, hp: 140, maxHp: 140, moves: [33], pp: [20],
      stats: { attack: 82, spAttack: 100 },
    },
    opponent: {
      species: 4, hp: 100, maxHp: 100,
      stats: { defense: 43, spDefense: 50 },
    },
  };
  const advise = (ui) => {
    const observed = observation({
      emulator: { mode: "battle" },
      playerMemory: {
        battleTypeFlags: (1 << 2) | (1 << 3),
        battle: battleState,
        trainer: { usablePartyCount: 2, party },
        ui,
      },
    });
    return createPolicyAdvisors({ mechanics })
      .flatMap((advisor) => advisor.advise(observed) ?? [])
      .find(({ advisor }) => advisor === "battle")?.recommendation;
  };

  assert.equal(advise({ battle: { stage: "action", cursor: 0 } }).targetCommand,
    "pokemon");
  assert.deepEqual(advise({
    party: { stage: "choose-pokemon", cursor: 0 }, battle: null,
  }), {
    kind: "choose-party-member",
    targetPartySlot: 1,
    targetSpecies: 131,
    objective: "improve-battle-matchup",
  });
});

test("an under-level coverage move cannot displace a proven high-level battler", () => {
  const psychicMechanics = {
    ...mechanics,
    moves: {
      ...mechanics.moves,
      34: { id: 34, name: "MOVE_BODY_SLAM", power: 85, accuracy: 100,
        effect: "EFFECT_PARALYZE_HIT", type: "TYPE_NORMAL" },
    },
    species: {
      ...mechanics.species,
      3: { id: 3, types: ["TYPE_GRASS", "TYPE_POISON"],
        baseAttack: 82, baseSpAttack: 100 },
      64: { id: 64, types: ["TYPE_PSYCHIC", "TYPE_PSYCHIC"],
        baseDefense: 30, baseSpDefense: 70 },
      131: { ...mechanics.species[131], baseDefense: 80, baseSpDefense: 95 },
    },
    typeChart: [
      ...mechanics.typeChart,
      { attackingType: "TYPE_PSYCHIC", defendingType: "TYPE_POISON",
        multiplier: 20 },
    ],
  };
  const observed = observation({
    emulator: { mode: "battle" },
    playerMemory: {
      battleTypeFlags: (1 << 2) | (1 << 3),
      battle: {
        player: { species: 3, level: 51, hp: 148, maxHp: 148,
          moves: [290], pp: [20], stats: { attack: 113, spAttack: 129 } },
        opponent: { species: 64, level: 38, hp: 80, maxHp: 80,
          stats: { defense: 30, spDefense: 70 } },
      },
      trainer: {
        usablePartyCount: 2,
        party: [
          { slot: 0, species: 3, level: 51, hp: 148, maxHp: 148,
            moves: [290], stats: { attack: 113, spAttack: 129 } },
          { slot: 1, species: 131, level: 26, hp: 109, maxHp: 109,
            moves: [34], stats: { attack: 52, spAttack: 58 } },
        ],
        bag: { items: [] },
      },
      ui: { battle: { stage: "action", cursor: 0 } },
    },
  });

  const recommendation = createPolicyAdvisors({ mechanics: psychicMechanics })
    .flatMap((advisor) => advisor.advise(observed) ?? [])
    .find(({ advisor }) => advisor === "battle")?.recommendation;

  assert.equal(recommendation.targetCommand, "fight");
});

test("recovery items are not burned on an outclassed active battler", () => {
  const psychicMechanics = {
    ...mechanics,
    moves: {
      ...mechanics.moves,
      34: { id: 34, name: "MOVE_BODY_SLAM", power: 85, accuracy: 100,
        effect: "EFFECT_PARALYZE_HIT", type: "TYPE_NORMAL" },
    },
    species: {
      ...mechanics.species,
      3: { id: 3, types: ["TYPE_GRASS", "TYPE_POISON"],
        baseAttack: 82, baseSpAttack: 100 },
      122: { id: 122, types: ["TYPE_PSYCHIC", "TYPE_PSYCHIC"],
        baseDefense: 65, baseSpDefense: 120 },
      131: { ...mechanics.species[131], baseDefense: 80, baseSpDefense: 95 },
    },
    typeChart: [
      ...mechanics.typeChart,
      { attackingType: "TYPE_PSYCHIC", defendingType: "TYPE_POISON",
        multiplier: 20 },
    ],
  };
  const observed = observation({
    emulator: { mode: "battle" },
    playerMemory: {
      battleTypeFlags: (1 << 2) | (1 << 3),
      battle: {
        player: { species: 131, level: 26, hp: 44, maxHp: 109,
          status1: 0, moves: [34], pp: [10],
          stats: { attack: 52, spAttack: 58 } },
        opponent: { species: 122, level: 37, hp: 80, maxHp: 80,
          stats: { defense: 65, spDefense: 120 } },
      },
      trainer: {
        usablePartyCount: 2,
        party: [
          { slot: 0, species: 131, level: 26, hp: 44, maxHp: 109,
            moves: [34], stats: { attack: 52, spAttack: 58 } },
          { slot: 1, species: 3, level: 51, hp: 148, maxHp: 148,
            moves: [290], stats: { attack: 113, spAttack: 129 } },
        ],
        bag: { items: [{ itemId: 21, quantity: 4 }] },
      },
      ui: { battle: { stage: "action", cursor: 0 } },
    },
  });

  const recommendation = createPolicyAdvisors({ mechanics: psychicMechanics })
    .flatMap((advisor) => advisor.advise(observed) ?? [])
    .find(({ advisor }) => advisor === "battle")?.recommendation;

  assert.deepEqual(recommendation, {
    kind: "choose-battle-command",
    targetCommand: "pokemon",
    objective: "protect-struggling-pokemon",
    targetPartySlot: 1,
  });
});

test("the battle policy reads the announced opponent and cursor Pokemon at a shift prompt", () => {
  const observed = observation({
    emulator: { mode: "battle" },
    playerMemory: {
      battle: {
        player: { species: 6, hp: 266, maxHp: 266 },
        opponent: { species: 65, hp: 0, maxHp: 147 },
        announcedOpponentName: "ARCANINE",
      },
      trainer: {
        usablePartyCount: 6,
        party: [{ slot: 0, species: 6, hp: 266, maxHp: 266 }],
      },
      ui: {
        party: {
          stage: "choose-pokemon",
          cursor: 0,
          cursorPokemon: { slot: 0, species: 6, hp: 266, maxHp: 266 },
        },
      },
    },
  });
  const proposals = createPolicyAdvisors({ mechanics }).flatMap((advisor) =>
    advisor.advise(observed) ?? []
  );
  const battle = proposals.find(({ advisor }) => advisor === "battle");
  assert.deepEqual(battle.recommendation, {
    kind: "retain-active-pokemon",
    announcedOpponentName: "ARCANINE",
    observedCursorSpecies: 6,
  });
});

test("the move-learning policy accepts an improvement and replaces the weakest move", () => {
  const observed = observation({
    emulator: { mode: "battle" },
    playerMemory: {
      trainer: {
        partyCount: 1,
        usablePartyCount: 1,
        party: [{
          slot: 0,
          species: 1,
          level: 15,
          hp: 38,
          maxHp: 38,
          moves: [33, 45, 73, 22],
        }],
      },
      ui: {
        moveLearning: {
          stage: "confirm-replace",
          partySlot: 0,
          moveId: 77,
          cursor: 0,
          selected: "yes",
        },
      },
    },
  });
  const advisors = createPolicyAdvisors({ mechanics });
  const atConfirmation = advisors.flatMap((advisor) => advisor.advise(observed) ?? [])
    .find(({ advisor }) => advisor === "quest");

  assert.deepEqual(atConfirmation.recommendation, {
    kind: "choose-menu-option",
    targetOption: "yes",
    objective: "learn-move-77",
  });

  observed.playerMemory.ui.moveLearning = {
    stage: "forget-move",
    partySlot: 0,
    moveId: 77,
    cursor: 0,
    selected: "move-1",
  };
  const atMoveList = advisors.flatMap((advisor) => advisor.advise(observed) ?? [])
    .find(({ advisor }) => advisor === "quest");
  assert.equal(atMoveList.recommendation.kind, "choose-move-to-forget");
  assert.equal(atMoveList.recommendation.targetMoveSlot, 1);
  assert.deepEqual(mapRecommendation(atMoveList.recommendation, observed).buttons, ["down"]);
});

test("a level-26 Mankey learns native Seismic Toss over Fury Swipes", () => {
  const moveMechanics = {
    species: { 56: { id: 56, types: ["TYPE_FIGHTING"] } },
    moves: {
      2: { id: 2, name: "MOVE_KARATE_CHOP", power: 50, accuracy: 100,
        type: "TYPE_FIGHTING", effect: "EFFECT_HIGH_CRITICAL" },
      10: { id: 10, name: "MOVE_SCRATCH", power: 40, accuracy: 100,
        type: "TYPE_NORMAL", effect: "EFFECT_HIT" },
      43: { id: 43, name: "MOVE_LEER", power: 0, accuracy: 100,
        type: "TYPE_NORMAL", effect: "EFFECT_DEFENSE_DOWN" },
      69: { id: 69, name: "MOVE_SEISMIC_TOSS", power: 1, accuracy: 100,
        type: "TYPE_FIGHTING", effect: "EFFECT_LEVEL_DAMAGE" },
      154: { id: 154, name: "MOVE_FURY_SWIPES", power: 18, accuracy: 80,
        type: "TYPE_NORMAL", effect: "EFFECT_MULTI_HIT" },
    },
  };
  const observed = observation({ emulator: { mode: "battle" }, playerMemory: {
    trainer: { partyCount: 1, usablePartyCount: 1, party: [{ slot: 0,
      species: 56, level: 26, hp: 65, maxHp: 65, moves: [10, 43, 154, 2],
      pp: [35, 30, 15, 25], stats: { attack: 50, defense: 35,
        spAttack: 30, spDefense: 35 } }] },
    ui: { moveLearning: { stage: "confirm-replace", partySlot: 0,
      moveId: 69, cursor: 0, selected: "yes" } },
  } });
  const recommend = () => createPolicyAdvisors({ mechanics: moveMechanics })
    .flatMap((advisor) => advisor.advise(observed) ?? [])
    .find(({ advisor }) => advisor === "quest")?.recommendation;

  assert.deepEqual(recommend(), { kind: "choose-menu-option", targetOption: "yes",
    objective: "learn-move-69" });
  observed.playerMemory.ui.moveLearning.stage = "forget-move";
  assert.deepEqual(recommend(), { kind: "choose-move-to-forget", targetMoveSlot: 2,
    learnedMoveId: 69 });
});

test("unsupported one-power effects are declined when new and protected when already known", () => {
  const moveMechanics = {
    species: { 56: { id: 56, types: ["TYPE_FIGHTING"] } },
    moves: {
      10: { id: 10, power: 40, accuracy: 100, type: "TYPE_NORMAL", effect: "EFFECT_HIT" },
      15: { id: 15, power: 50, accuracy: 95, type: "TYPE_NORMAL", effect: "EFFECT_HIT" },
      19: { id: 19, power: 70, accuracy: 95, type: "TYPE_FLYING", effect: "EFFECT_HIT" },
      57: { id: 57, power: 95, accuracy: 100, type: "TYPE_WATER", effect: "EFFECT_HIT" },
      67: { id: 67, power: 1, accuracy: 100, type: "TYPE_FIGHTING", effect: "EFFECT_LOW_KICK" },
    },
  };
  const observed = observation({ emulator: { mode: "battle" }, playerMemory: {
    trainer: { partyCount: 1, usablePartyCount: 1, party: [{ slot: 0,
      species: 56, level: 26, hp: 65, maxHp: 65, moves: [10, 15, 19, 57] }] },
    ui: { moveLearning: { stage: "confirm-replace", partySlot: 0,
      moveId: 67, cursor: 0, selected: "yes" } },
  } });
  const recommend = () => createPolicyAdvisors({ mechanics: moveMechanics })
    .flatMap((advisor) => advisor.advise(observed) ?? [])
    .find(({ advisor }) => advisor === "quest")?.recommendation;

  assert.equal(recommend().targetOption, "no");
  observed.playerMemory.trainer.party[0].moves = [67, 15, 19, 57];
  observed.playerMemory.ui.moveLearning.moveId = 10;
  assert.equal(recommend().targetOption, "no");
});

test("Lapras learns Ice Beam without attempting to forget Surf", () => {
  const iceBeamMechanics = {
    ...mechanics,
    moves: {
      ...mechanics.moves,
      34: { id: 34, name: "MOVE_BODY_SLAM", power: 85, accuracy: 100,
        effect: "EFFECT_PARALYZE_HIT", type: "TYPE_NORMAL" },
      58: { id: 58, name: "MOVE_ICE_BEAM", power: 95, accuracy: 100,
        effect: "EFFECT_FREEZE_HIT", type: "TYPE_ICE" },
      109: { id: 109, name: "MOVE_CONFUSE_RAY", power: 0, accuracy: 100,
        effect: "EFFECT_CONFUSE", type: "TYPE_GHOST" },
      195: { id: 195, name: "MOVE_PERISH_SONG", power: 0, accuracy: 0,
        effect: "EFFECT_PERISH_SONG", type: "TYPE_NORMAL" },
    },
  };
  const observed = observation({
    emulator: { mode: "battle" },
    playerMemory: {
      trainer: {
        partyCount: 2,
        usablePartyCount: 2,
        party: [
          { slot: 0, species: 131, level: 31, hp: 128, maxHp: 128,
            moves: [57, 34, 109, 195] },
          { slot: 1, species: 3, level: 60, hp: 149, maxHp: 173 },
        ],
      },
      ui: {
        moveLearning: {
          stage: "forget-move",
          partySlot: 0,
          moveId: 58,
          cursor: 0,
          selected: "move-1",
        },
      },
    },
  });
  const recommendation = createPolicyAdvisors({ mechanics: iceBeamMechanics })
    .flatMap((advisor) => advisor.advise(observed) ?? [])
    .find(({ advisor }) => advisor === "quest").recommendation;

  assert.deepEqual(recommendation, {
    kind: "choose-move-to-forget",
    targetMoveSlot: 3,
    learnedMoveId: 58,
  });
  assert.deepEqual(mapRecommendation(recommendation, observed).buttons, ["down"]);
});

test("a campaign coverage move replaces its explicitly planned attack", () => {
  const campaignPlanner = {
    select: () => ({
      id: "teach-secret-power",
      target: {
        kind: "teach-move",
        itemId: 331,
        moveId: 290,
        partySpecies: [1, 2, 3],
        replaceMoveId: 75,
      },
      completion: { kind: "party-knows-move", moveId: 290 },
    }),
  };
  const observed = observation({
    emulator: { mode: "party" },
    playerMemory: {
      trainer: {
        partyCount: 1,
        usablePartyCount: 1,
        party: [{
          slot: 0,
          species: 1,
          level: 46,
          hp: 130,
          maxHp: 130,
          moves: [75, 79, 73, 15],
        }],
      },
      ui: {
        moveLearning: {
          stage: "forget-move",
          partySlot: 0,
          moveId: 290,
          cursor: 1,
          selected: "move-2",
        },
      },
    },
  });
  const recommendation = createPolicyAdvisors({ mechanics, campaignPlanner })
    .flatMap((advisor) => advisor.advise(observed) ?? [])
    .find(({ advisor }) => advisor === "quest")?.recommendation;

  assert.deepEqual(recommendation, {
    kind: "choose-move-to-forget",
    targetMoveSlot: 0,
    learnedMoveId: 290,
  });
});

test("the quest policy drives an owned HM through Start, Bag, TM Case, and party selection", () => {
  const campaignPlanner = {
    select: () => ({
      id: "teach-cut",
      target: {
        kind: "teach-move",
        itemId: 339,
        moveId: 15,
        partySpecies: [46, 47],
      },
      completion: { kind: "party-knows-move", moveId: 15 },
    }),
  };
  const party = [{
    slot: 0,
    species: 46,
    level: 20,
    hp: 55,
    maxHp: 55,
    moves: [75, 79, 73, 33],
  }];
  const bagInventory = {
    keyItems: [{ itemId: 364, quantity: 1 }],
    tmhm: [{ itemId: 334, quantity: 1 }, { itemId: 339, quantity: 1 }],
  };
  const recommend = ({ mode = "overworld", ui = {} } = {}) => {
    const observed = observation({
      emulator: { mode },
      playerMemory: {
        trainer: { partyCount: 1, usablePartyCount: 1, party, bag: bagInventory },
        ui,
      },
    });
    return createPolicyAdvisors({ mechanics, campaignPlanner, teamPlan: createOriginsTeamPlan(1) })
      .flatMap((advisor) => advisor.advise(observed) ?? [])
      .find(({ advisor }) => advisor === "quest")?.recommendation;
  };

  assert.deepEqual(recommend(), {
    kind: "open-start-menu",
    objective: "teach-cut",
  });
  assert.deepEqual(recommend({
    mode: "start-menu",
    ui: { startMenu: { cursor: 0, order: ["pokedex", "pokemon", "bag"] } },
  }), {
    kind: "choose-start-menu-item",
    targetItem: "bag",
    targetIndex: 2,
    objective: "teach-cut",
  });
  assert.deepEqual(recommend({
    mode: "bag",
    ui: { bag: { stage: "list", pocket: 0, index: 0, selectedItemId: 13 } },
  }), {
    kind: "choose-bag-pocket",
    targetPocket: 1,
    objective: "teach-cut",
  });
  assert.deepEqual(recommend({
    mode: "bag",
    ui: { bag: { stage: "list", pocket: 1, index: 0, selectedItemId: 364 } },
  }), {
    kind: "choose-bag-item",
    targetItemId: 364,
    targetIndex: 0,
    objective: "teach-cut",
  });
  assert.deepEqual(recommend({
    mode: "bag",
    ui: { bag: { stage: "context", pocket: 1, contextCursor: 1,
      selectedItemId: 364, selectedAction: "register" } },
  }), {
    kind: "choose-bag-context-action",
    targetAction: "open",
    targetIndex: 0,
    objective: "teach-cut",
  });
  assert.deepEqual(recommend({
    mode: "bag",
    ui: { bag: { stage: "tm-case-list", pocket: 3, index: 0,
      selectedItemId: 334 } },
  }), {
    kind: "choose-tm-case-item",
    targetItemId: 339,
    targetIndex: 1,
    objective: "teach-cut",
  });
  assert.deepEqual(recommend({
    mode: "bag",
    ui: { bag: { stage: "tm-case-context", contextCursor: 2,
      selectedItemId: 339, selectedAction: "exit" } },
  }), {
    kind: "choose-bag-context-action",
    targetAction: "use",
    targetIndex: 0,
    objective: "teach-cut",
  });
  assert.deepEqual(recommend({
    mode: "overworld",
    ui: { choiceMenu: { cursor: 1, selected: "no" } },
  }), {
    kind: "choose-menu-option",
    targetOption: "yes",
    objective: "teach-cut",
  });
  assert.deepEqual(recommend({
    mode: "party",
    ui: { party: { stage: "choose-pokemon", cursor: 1, itemId: 339 } },
  }), {
    kind: "choose-party-member",
    targetPartySlot: 0,
    targetSpecies: 46,
    objective: "teach-cut",
  });
});

test("a highlighted recovery item cannot hijack an unrelated HM workflow", () => {
  const campaignPlanner = {
    select: () => ({
      id: "teach-cut",
      target: {
        kind: "teach-move",
        itemId: 339,
        moveId: 15,
        partySpecies: [46, 47],
      },
      completion: { kind: "party-knows-move", moveId: 15 },
    }),
  };
  const observed = observation({
    emulator: { mode: "bag", callback2: "CB2_BagMenuRun" },
    playerMemory: {
      trainer: {
        partyCount: 1,
        usablePartyCount: 1,
        party: [{
          slot: 0,
          species: 46,
          level: 20,
          hp: 50,
          maxHp: 100,
          moves: [33],
          pp: [20],
        }],
        bag: {
          items: [{ itemId: 22, quantity: 3 }],
          keyItems: [{ itemId: 364, quantity: 1 }],
          tmhm: [{ itemId: 339, quantity: 1 }],
        },
      },
      ui: {
        bag: {
          stage: "list",
          pocket: 0,
          index: 0,
          selectedItemId: 22,
        },
      },
    },
  });
  const advisors = createPolicyAdvisors({ mechanics, campaignPlanner, teamPlan: createOriginsTeamPlan(1) });
  const decision = createCentralPlayer({ advisors }).decide(observed);

  assert.equal(decision.winner?.advisor, "quest");
  assert.deepEqual(decision.winner?.recommendation, {
    kind: "choose-bag-pocket",
    targetPocket: 1,
    objective: "teach-cut",
  });
});

test("the quest policy drains a blocking field prompt before starting an item workflow", () => {
  const campaignPlanner = {
    select: () => ({
      id: "teach-cut",
      target: {
        kind: "teach-move",
        itemId: 339,
        moveId: 15,
        partySpecies: [46, 47],
      },
      completion: { kind: "party-knows-move", moveId: 15 },
    }),
  };
  const observed = observation({
    emulator: { mode: "overworld", callback2: "CB2_Overworld" },
    playerMemory: {
      scripts: {
        globalStatus: "running",
        globalMode: "native",
        globalNative: "WaitForAorBPress",
        fieldControlsLocked: true,
      },
      trainer: {
        partyCount: 1,
        usablePartyCount: 1,
        party: [{
          slot: 0,
          species: 47,
          level: 25,
          hp: 71,
          maxHp: 71,
          moves: [10, 78, 77, 141],
        }],
        bag: {
          keyItems: [{ itemId: 364, quantity: 1 }],
          tmhm: [{ itemId: 339, quantity: 1 }],
        },
      },
      ui: {
        fieldDialog: {
          type: "hidden",
          stage: "awaiting-close",
          textPrinter: { active: false, state: 0, stateName: "handle-character" },
        },
      },
    },
  });

  const recommendation = createPolicyAdvisors({ mechanics, campaignPlanner })
    .flatMap((advisor) => advisor.advise(observed) ?? [])
    .find(({ advisor }) => advisor === "quest")?.recommendation;

  assert.deepEqual(recommendation, { kind: "acknowledge-cartridge-prompt" });
  assert.deepEqual(mapRecommendation(recommendation, observed).buttons, ["a"]);
});

test("the quest policy closes an accidentally opened Pokemon summary", () => {
  const campaignPlanner = {
    select: () => ({
      id: "teach-flash-for-regional-mastery",
      target: {
        kind: "teach-move",
        itemId: 343,
        moveId: 148,
        partySpecies: [46, 47],
      },
      completion: { kind: "party-knows-move", moveId: 148 },
    }),
  };
  const observed = observation({
    emulator: { mode: "party", callback2: "CB2_RunPokemonSummaryScreen" },
    playerMemory: {
      trainer: {
        partyCount: 1,
        usablePartyCount: 1,
        party: [{
          slot: 0,
          species: 47,
          level: 27,
          hp: 76,
          maxHp: 76,
          moves: [10, 78, 147, 15],
        }],
        bag: {
          keyItems: [{ itemId: 364, quantity: 1 }],
          tmhm: [{ itemId: 343, quantity: 1 }],
        },
      },
      ui: {
        pokemonSummary: { stage: "info", partySlot: 0 },
      },
    },
  });

  const recommendation = createPolicyAdvisors({ mechanics, campaignPlanner })
    .flatMap((advisor) => advisor.advise(observed) ?? [])
    .find(({ advisor }) => advisor === "quest")?.recommendation;

  assert.deepEqual(recommendation, {
    kind: "close-menu",
    objective: "leave-pokemon-summary",
  });
  assert.deepEqual(mapRecommendation(recommendation, observed).buttons, ["b"]);
});

test("an HM workflow unwinds every unrelated field Party surface", () => {
  const campaignPlanner = {
    select: () => ({
      id: "teach-flash-for-regional-mastery",
      target: {
        kind: "teach-move",
        itemId: 343,
        moveId: 148,
        partySpecies: [46, 47],
      },
      completion: { kind: "party-knows-move", moveId: 148 },
    }),
  };
  const recommend = (partyUi) => {
    const observed = observation({
      emulator: { mode: "party", callback2: "CB2_UpdatePartyMenu" },
      playerMemory: {
        trainer: {
          partyCount: 1,
          usablePartyCount: 1,
          party: [{
            slot: 0,
            species: 47,
            level: 27,
            hp: 76,
            maxHp: 76,
            moves: [10, 78, 147, 15],
          }],
          bag: {
            keyItems: [{ itemId: 364, quantity: 1 }],
            tmhm: [{ itemId: 343, quantity: 1 }],
          },
        },
        ui: { party: partyUi },
      },
    });
    const advisors = createPolicyAdvisors({ mechanics, campaignPlanner, teamPlan: createOriginsTeamPlan(1) });
    const recommendation = advisors
      .flatMap((advisor) => advisor.advise(observed) ?? [])
      .find(({ advisor }) => advisor === "quest")?.recommendation;
    const decision = createCentralPlayer({ advisors }).decide(observed);
    return {
      recommendation,
      buttons: mapRecommendation(recommendation, observed).buttons,
      winner: decision.winner?.recommendation,
    };
  };

  for (const partyUi of [
    {
      stage: "selection-menu",
      cursor: 0,
      action: "field",
      actionCursor: 0,
      selectedAction: "summary",
    },
    { stage: "choose-pokemon", cursor: 0 },
    { stage: "choose-pokemon", cursor: 0, itemId: 339 },
  ]) {
    assert.deepEqual(recommend(partyUi), {
      recommendation: {
        kind: "cancel-conflicting-menu",
        objective: "restart-teach-flash-for-regional-mastery",
      },
      buttons: ["b"],
      winner: {
        kind: "cancel-conflicting-menu",
        objective: "restart-teach-flash-for-regional-mastery",
      },
    });
  }
});

test("menu recommendations map to one observed cursor movement or confirmation", () => {
  const observed = observation({ playerMemory: { ui: {
    startMenu: { cursor: 0 },
    bag: null,
  } } });
  assert.deepEqual(mapRecommendation({ kind: "open-start-menu" }, observed).buttons, ["start"]);
  assert.deepEqual(mapRecommendation({
    kind: "choose-start-menu-item", targetIndex: 2,
  }, observed).buttons, ["down"]);

  observed.playerMemory.ui.party = { actionCursor: 0 };
  assert.deepEqual(mapRecommendation({
    kind: "choose-party-action", targetIndex: 2,
  }, observed).buttons, ["down"]);

  observed.playerMemory.ui.bag = { pocket: 0, index: 0, contextCursor: 2 };
  assert.deepEqual(mapRecommendation({
    kind: "choose-bag-pocket", targetPocket: 1,
  }, observed).buttons, ["right"]);
  assert.deepEqual(mapRecommendation({
    kind: "choose-tm-case-item", targetIndex: 1,
  }, observed).buttons, ["down"]);
  assert.deepEqual(mapRecommendation({
    kind: "choose-bag-context-action", targetIndex: 0,
  }, observed).buttons, ["up"]);
});

test("the quest policy rotates a boxed strategic Pokemon through the PC safely", () => {
  const objective = {
    id: "ensure-fly-carrier-party",
    target: {
      kind: "party-roster",
      map: "MAP_CELADON_CITY_POKEMON_CENTER_1F",
      requiredFamilies: [[84, 85]],
    },
  };
  const campaignPlanner = { select: () => objective };
  const teamPlan = createOriginsTeamPlan(4);
  const fullParty = [
    { slot: 0, species: 5, level: 30, hp: 80, maxHp: 80, moves: [53] },
    { slot: 1, species: 46, level: 18, hp: 40, maxHp: 40, moves: [15] },
    { slot: 2, species: 19, level: 12, hp: 30, maxHp: 30, moves: [33] },
    { slot: 3, species: 16, level: 14, hp: 33, maxHp: 33, moves: [33] },
    { slot: 4, species: 52, level: 20, hp: 45, maxHp: 45, moves: [45] },
    { slot: 5, species: 43, level: 23, hp: 50, maxHp: 50, moves: [79] },
  ];
  const boxedDoduo = {
    currentBox: 2,
    boxCounts: [0, 0, 0, 1, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0],
    pokemon: [{ box: 3, slot: 7, species: 84, moves: [64], pp: [35] }],
  };
  const recommend = ({ uiStorage, party = fullParty, storage = boxedDoduo }) => {
    const observed = observation({
      emulator: { mode: "storage" },
      playerMemory: {
        map: { id: objective.target.map },
        trainer: {
          partyCount: party.length,
          usablePartyCount: party.filter(({ hp }) => Number(hp) > 0).length,
          party,
          storage,
        },
        ui: { storage: uiStorage },
      },
    });
    return {
      observed,
      recommendation: createPolicyAdvisors({
        mechanics,
        campaignPlanner,
        teamPlan,
      }).flatMap((advisor) => advisor.advise(observed) ?? [])
        .find(({ advisor }) => advisor === "quest")?.recommendation,
    };
  };

  let result = recommend({
    uiStorage: { stage: "pc-menu", option: 0, selected: "withdraw" },
  });
  assert.deepEqual(result.recommendation, {
    kind: "choose-storage-option",
    targetOption: "deposit",
    targetIndex: 1,
    objective: objective.id,
  });

  result = recommend({
    uiStorage: {
      stage: "storage-main",
      boxOption: "deposit",
      cursorArea: "party",
      cursorPosition: 0,
      currentBox: 2,
      depositBox: 0,
    },
  });
  assert.equal(result.recommendation.kind, "choose-storage-party-member");
  assert.equal(result.recommendation.targetPartySlot, 2);
  assert.deepEqual(mapRecommendation(result.recommendation, result.observed).buttons, ["down"]);

  result = recommend({
    uiStorage: {
      stage: "deposit-box",
      boxOption: "deposit",
      cursorArea: "party",
      cursorPosition: 2,
      currentBox: 2,
      depositBox: 0,
    },
  });
  assert.deepEqual(result.recommendation, {
    kind: "choose-storage-box",
    targetBox: 0,
    objective: objective.id,
  });
  assert.deepEqual(mapRecommendation(result.recommendation, result.observed).buttons, ["a"]);

  const partyWithSpace = fullParty.filter(({ slot }) => slot !== 2)
    .map((pokemon, slot) => ({ ...pokemon, slot }));
  result = recommend({
    party: partyWithSpace,
    uiStorage: {
      stage: "storage-main",
      boxOption: "deposit",
      cursorArea: "party",
      cursorPosition: 0,
      currentBox: 2,
    },
  });
  assert.equal(result.recommendation.kind, "exit-storage-mode");
  assert.deepEqual(mapRecommendation(result.recommendation, result.observed).buttons, ["b"]);

  result = recommend({
    party: partyWithSpace,
    uiStorage: {
      stage: "confirm-continue",
      option: 0,
      selected: "yes",
      boxOption: "deposit",
      cursorArea: "party",
      cursorPosition: 0,
      currentBox: 2,
    },
  });
  assert.deepEqual(result.recommendation, {
    kind: "choose-storage-continue",
    targetOption: "no",
    targetIndex: 1,
    objective: objective.id,
  });

  result = recommend({
    party: partyWithSpace,
    uiStorage: { stage: "pc-menu", option: 1, selected: "deposit" },
  });
  assert.equal(result.recommendation.kind, "choose-storage-option");
  assert.equal(result.recommendation.targetIndex, 0);

  result = recommend({
    party: partyWithSpace,
    uiStorage: {
      stage: "storage-main",
      boxOption: "withdraw",
      cursorArea: "box",
      cursorPosition: 0,
      currentBox: 2,
    },
  });
  assert.deepEqual(result.recommendation, {
    kind: "choose-storage-box-member",
    targetBox: 3,
    targetBoxSlot: 7,
    targetSpecies: 84,
    objective: objective.id,
  });
  assert.deepEqual(mapRecommendation(result.recommendation, result.observed).buttons, ["start"]);

  result.observed.playerMemory.ui.storage.cursorArea = "box-title";
  assert.deepEqual(mapRecommendation(result.recommendation, result.observed).buttons, ["right"]);
  result.observed.playerMemory.ui.storage.currentBox = 3;
  assert.deepEqual(mapRecommendation(result.recommendation, result.observed).buttons, ["down"]);
  result.observed.playerMemory.ui.storage.cursorArea = "box";
  result.observed.playerMemory.ui.storage.cursorPosition = 6;
  assert.deepEqual(mapRecommendation(result.recommendation, result.observed).buttons, ["right"]);

  result = recommend({
    party: partyWithSpace,
    uiStorage: {
      stage: "pokemon-menu",
      boxOption: "withdraw",
      cursorArea: "box",
      cursorPosition: 7,
      currentBox: 3,
    },
  });
  assert.deepEqual(result.recommendation, {
    kind: "confirm-storage-action",
    targetAction: "withdraw",
    targetSpecies: 84,
    objective: objective.id,
  });
  assert.deepEqual(mapRecommendation(result.recommendation, result.observed).buttons, ["a"]);
});

test("the quest policy enters Pokemon Storage for an unfinished roster objective", () => {
  const center = mapFromCollisionRows({
    id: "MAP_VERMILION_CITY_POKEMON_CENTER_1F",
    rows: [".......", "...#...", ".......", ".......", "......."],
    behaviors: { "3,1": "MB_PC" },
  });
  const campaignPlanner = { select: () => ({
    id: "ensure-cut-carrier-party",
    target: {
      kind: "party-roster",
      map: center.id,
      requiredFamilies: [[46, 47]],
    },
  }) };
  const observed = observation({
    emulator: { mode: "overworld" },
    playerMemory: {
      map: { id: center.id },
      position: { x: 3, y: 2 },
      avatar: { facing: "north" },
      trainer: {
        partyCount: 6,
        usablePartyCount: 6,
        party: [
          { slot: 0, species: 56, level: 26, hp: 47, maxHp: 60 },
          { slot: 1, species: 5, level: 30, hp: 83, maxHp: 83 },
          { slot: 2, species: 44, level: 31, hp: 73, maxHp: 84 },
          { slot: 3, species: 20, level: 27, hp: 58, maxHp: 73 },
          { slot: 4, species: 52, level: 26, hp: 48, maxHp: 60 },
          { slot: 5, species: 22, level: 26, hp: 62, maxHp: 72 },
        ],
        storage: {
          currentBox: 0,
          boxCounts: [1, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0],
          pokemon: [{ box: 0, slot: 0, species: 47, moves: [10, 78, 77, 141] }],
        },
      },
      ui: {
        choiceMenu: {
          cursor: 0,
          minCursor: 0,
          maxCursor: 3,
          columns: 0,
          rows: 0,
          selected: null,
        },
      },
    },
  });

  const recommendation = createPolicyAdvisors({
    mechanics,
    world: { maps: [center] },
    campaignPlanner,
    teamPlan: createOriginsTeamPlan(4),
  }).flatMap((advisor) => advisor.advise(observed) ?? [])
    .find(({ advisor }) => advisor === "quest")?.recommendation;

  assert.deepEqual(recommendation, {
    kind: "choose-menu-option",
    targetIndex: 0,
    objective: "ensure-cut-carrier-party",
  });
  assert.deepEqual(mapRecommendation(recommendation, observed).buttons, ["a"]);
});

test("the PC root menu closes before the following item workflow starts", () => {
  const center = mapFromCollisionRows({
    id: "MAP_VERMILION_CITY_POKEMON_CENTER_1F",
    rows: [".......", "...#...", ".......", ".......", "......."],
    behaviors: { "3,1": "MB_PC" },
  });
  const campaignPlanner = { select: () => ({
    id: "teach-cut",
    target: {
      kind: "teach-move",
      itemId: 339,
      moveId: 15,
      partySpecies: [46, 47],
    },
    completion: { kind: "party-knows-move", moveId: 15 },
  }) };
  const observed = observation({
    emulator: { mode: "overworld" },
    playerMemory: {
      map: { id: center.id },
      position: { x: 3, y: 2 },
      avatar: { facing: "north" },
      trainer: {
        partyCount: 1,
        usablePartyCount: 1,
        party: [{
          slot: 0,
          species: 47,
          level: 25,
          hp: 71,
          maxHp: 71,
          moves: [10, 78, 77, 141],
        }],
        bag: {
          keyItems: [{ itemId: 364, quantity: 1 }],
          tmhm: [{ itemId: 339, quantity: 1 }],
        },
      },
      ui: {
        fieldDialog: { stage: "awaiting-input" },
        choiceMenu: {
          cursor: 0,
          minCursor: 0,
          maxCursor: 3,
          columns: 0,
          rows: 0,
          selected: null,
        },
      },
    },
  });

  const recommendation = createPolicyAdvisors({
    mechanics,
    world: { maps: [center] },
    campaignPlanner,
    teamPlan: createOriginsTeamPlan(4),
  }).flatMap((advisor) => advisor.advise(observed) ?? [])
    .find(({ advisor }) => advisor === "quest")?.recommendation;

  assert.deepEqual(recommendation, {
    kind: "close-menu",
    objective: "turn-off-pc",
  });
  assert.deepEqual(mapRecommendation(recommendation, observed).buttons, ["b"]);
});

test("the quest policy logs off the PC root menu after a roster transaction", () => {
  const center = mapFromCollisionRows({
    id: "MAP_VERMILION_CITY_POKEMON_CENTER_1F",
    rows: [".......", "...#...", ".......", ".......", "......."],
    behaviors: { "3,1": "MB_PC" },
  });
  const campaignPlanner = { select: () => ({
    id: "rival-ss-anne",
    target: { kind: "trigger", map: "MAP_SSANNE_2F_CORRIDOR", index: 0 },
  }) };
  const observed = observation({
    emulator: { mode: "overworld" },
    playerMemory: {
      map: { id: center.id },
      position: { x: 3, y: 2 },
      avatar: { facing: "north" },
      trainer: {
        partyCount: 6,
        usablePartyCount: 6,
        party: [{ slot: 0, species: 5, level: 28, hp: 70, maxHp: 78 }],
      },
      ui: {
        choiceMenu: {
          cursor: 0,
          minCursor: 0,
          maxCursor: 3,
          columns: 0,
          rows: 0,
          selected: null,
        },
      },
    },
  });

  const recommendation = createPolicyAdvisors({
    mechanics,
    world: { maps: [center] },
    campaignPlanner,
    teamPlan: createOriginsTeamPlan(4),
  }).flatMap((advisor) => advisor.advise(observed) ?? [])
    .find(({ advisor }) => advisor === "quest")?.recommendation;

  assert.deepEqual(recommendation, {
    kind: "close-menu",
    objective: "turn-off-pc",
  });
  assert.deepEqual(mapRecommendation(recommendation, observed).buttons, ["b"]);
});

test("an important battle retains HM support while aligning its combat roster", () => {
  const center = mapFromCollisionRows({
    id: "MAP_FUCHSIA_CITY_POKEMON_CENTER_1F",
    rows: [".......", "...#...", ".......", ".......", "......."],
    behaviors: { "3,1": "MB_PC" },
  });
  const objective = {
    id: "badge-soul",
    target: { kind: "object", map: "MAP_FUCHSIA_CITY_GYM", index: 6 },
    importantBattle: true,
    minimumBattlePartySize: 6,
  };
  const campaignPlanner = { select: () => objective };
  const teamPlan = createOriginsTeamPlan(4);
  const party = [
    { slot: 0, species: 5, level: 40, hp: 100, maxHp: 100, moves: [53] },
    { slot: 1, species: 16, level: 38, hp: 90, maxHp: 90, moves: [17] },
    { slot: 2, species: 19, level: 37, hp: 88, maxHp: 88, moves: [33] },
    { slot: 3, species: 43, level: 39, hp: 92, maxHp: 92, moves: [75] },
    { slot: 4, species: 52, level: 38, hp: 91, maxHp: 91, moves: [33] },
    { slot: 5, species: 46, level: 25, hp: 70, maxHp: 70, moves: [15, 148, 249] },
  ];
  const storage = {
    currentBox: 0,
    boxCounts: [1, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0],
    pokemon: [{ box: 0, slot: 0, species: 131, moves: [57], pp: [15] }],
  };
  const recommend = (uiStorage) => {
    const observed = observation({
      emulator: { mode: "storage" },
      playerMemory: {
        map: { id: center.id },
        position: { x: 3, y: 2 },
        trainer: {
          partyCount: 6,
          usablePartyCount: 6,
          party,
          storage,
        },
        ui: { storage: uiStorage },
      },
    });
    return createPolicyAdvisors({
      mechanics,
      world: { maps: [center] },
      campaignPlanner,
      teamPlan,
    }).flatMap((advisor) => advisor.advise(observed) ?? [])
      .find(({ advisor }) => advisor === "quest")?.recommendation;
  };

  assert.deepEqual(recommend({ stage: "pc-menu", option: 0, selected: "withdraw" }), {
    kind: "choose-storage-option",
    targetOption: "deposit",
    targetIndex: 1,
    objective: "prepare-badge-soul-roster",
  });
  assert.deepEqual(recommend({
    stage: "storage-main",
    boxOption: "deposit",
    cursorArea: "party",
    cursorPosition: 0,
    currentBox: 0,
    depositBox: 0,
  }), {
    kind: "choose-storage-party-member",
    targetPartySlot: 2,
    targetSpecies: 19,
    objective: "prepare-badge-soul-roster",
  });
});

test("a necessary Cut carrier stays active when the Gym cannot be approached without it", () => {
  const center = mapFromCollisionRows({
    id: "MAP_VERMILION_CITY_POKEMON_CENTER_1F",
    rows: [".......", "...#...", ".......", ".......", "......."],
    behaviors: { "3,1": "MB_PC" },
  });
  const teamPlan = createOriginsTeamPlan(4);
  const objective = createOriginsCampaign(teamPlan).objectives.find(
    ({ id }) => id === "badge-thunder",
  );
  const campaignPlanner = { select: () => objective };
  const party = [
    { slot: 0, species: 5, level: 25, hp: 70, maxHp: 70, moves: [53] },
    { slot: 1, species: 16, level: 22, hp: 60, maxHp: 60, moves: [17] },
    { slot: 2, species: 19, level: 21, hp: 58, maxHp: 58, moves: [33] },
    { slot: 3, species: 43, level: 23, hp: 62, maxHp: 62, moves: [75] },
    { slot: 4, species: 52, level: 22, hp: 60, maxHp: 60, moves: [33] },
    { slot: 5, species: 46, level: 18, hp: 50, maxHp: 50, moves: [15, 148] },
  ];
  const observed = observation({
    emulator: { mode: "storage" },
    playerMemory: {
      map: { id: center.id },
      position: { x: 3, y: 2 },
      trainer: {
        partyCount: 6,
        usablePartyCount: 6,
        party,
        storage: {
          currentBox: 0,
          boxCounts: [1, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0],
          pokemon: [{ box: 0, slot: 0, species: 131, moves: [57], pp: [15] }],
        },
      },
      ui: { storage: { stage: "pc-menu", option: 0, selected: "withdraw" } },
    },
  });

  const recommend = (storageUi) => {
    observed.playerMemory.ui.storage = storageUi;
    return createPolicyAdvisors({
      mechanics,
      world: { maps: [center] },
      campaignPlanner,
      teamPlan,
    }).flatMap((advisor) => advisor.advise(observed) ?? [])
      .find(({ advisor }) => advisor === "quest")?.recommendation;
  };

  assert.deepEqual(recommend({
    stage: "pc-menu",
    option: 0,
    selected: "withdraw",
  }), {
    kind: "choose-storage-option",
    targetOption: "deposit",
    targetIndex: 1,
    objective: "prepare-badge-thunder-roster",
  });
  assert.deepEqual(recommend({
    stage: "storage-main",
    boxOption: "deposit",
    cursorArea: "party",
    cursorPosition: 0,
    currentBox: 0,
    depositBox: 0,
  }), {
    kind: "choose-storage-party-member",
    targetPartySlot: 2,
    targetSpecies: 19,
    objective: "prepare-badge-thunder-roster",
  });
});

test("important-battle roster filling chooses added coverage instead of PC order", () => {
  const center = mapFromCollisionRows({
    id: "MAP_SAFFRON_CITY_POKEMON_CENTER_1F",
    rows: [".......", "...#...", ".......", ".......", "......."],
    behaviors: { "3,1": "MB_PC" },
  });
  const campaignPlanner = { select: () => ({
    id: "rival-silph",
    target: { kind: "trigger", map: "MAP_SILPH_CO_7F", index: 0 },
    importantBattle: true,
    minimumBattlePartySize: 6,
  }) };
  const party = [
    { slot: 0, species: 4, level: 40, hp: 100, maxHp: 100, moves: [53] },
    { slot: 1, species: 1, level: 40, hp: 100, maxHp: 100, moves: [75] },
    { slot: 2, species: 4, level: 35, hp: 90, maxHp: 90, moves: [33] },
    { slot: 3, species: 1, level: 35, hp: 90, maxHp: 90, moves: [33] },
    { slot: 4, species: 4, level: 34, hp: 88, maxHp: 88, moves: [33] },
  ];
  const observed = observation({
    emulator: { mode: "storage" },
    playerMemory: {
      map: { id: center.id },
      position: { x: 3, y: 2 },
      trainer: {
        partyCount: 5,
        usablePartyCount: 5,
        party,
        storage: {
          currentBox: 0,
          boxCounts: [2, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0],
          pokemon: [
            { box: 0, slot: 0, species: 4, moves: [33], pp: [20] },
            { box: 0, slot: 1, species: 131, moves: [57], pp: [15] },
          ],
        },
      },
      ui: { storage: {
        stage: "storage-main",
        boxOption: "withdraw",
        cursorArea: "box",
        cursorPosition: 0,
        currentBox: 0,
      } },
    },
  });

  const recommendation = createPolicyAdvisors({
    mechanics,
    world: { maps: [center] },
    campaignPlanner,
    teamPlan: createOriginsTeamPlan(4),
  }).flatMap((advisor) => advisor.advise(observed) ?? [])
    .find(({ advisor }) => advisor === "quest")?.recommendation;

  assert.deepEqual(recommendation, {
    kind: "choose-storage-box-member",
    targetBox: 0,
    targetBoxSlot: 1,
    targetSpecies: 131,
    objective: "prepare-rival-silph-roster",
  });
});

test("the quest policy closes a completed item workflow instead of selecting party forever", () => {
  const campaignPlanner = {
    select: () => ({
      id: "next-route",
      target: { kind: "trigger", map: "MAP_ROUTE2", index: 0 },
      completion: { kind: "flag-set", id: 99 },
    }),
  };
  const observed = observation({
    emulator: { mode: "party" },
    playerMemory: {
      trainer: { partyCount: 1, usablePartyCount: 1,
        party: [{ slot: 0, species: 2, hp: 55, maxHp: 55, moves: [15] }] },
      ui: { party: { stage: "choose-pokemon", cursor: 0 } },
    },
  });
  const quest = createPolicyAdvisors({ mechanics, campaignPlanner })
    .flatMap((advisor) => advisor.advise(observed) ?? [])
    .find(({ advisor }) => advisor === "quest");
  assert.equal(quest.recommendation.kind, "close-menu");
  assert.deepEqual(mapRecommendation(quest.recommendation, observed).buttons, ["b"]);
});

test("a purchase objective closes the completed TM Case before navigating to the mart", () => {
  const campaignPlanner = {
    select: () => ({
      id: "silph-supplies",
      target: {
        kind: "purchase-items",
        map: "MAP_SAFFRON_CITY_MART",
        objectIndex: 0,
        items: [{ itemId: 19, stockIndex: 2, quantity: 8 }],
      },
    }),
  };
  const observed = observation({
    emulator: { mode: "bag" },
    playerMemory: {
      trainer: {
        money: 100000,
        bag: { tmhm: [{ itemId: 332, quantity: 1 }] },
        party: [{ slot: 0, species: 6, hp: 120, maxHp: 120,
          moves: [17, 53, 290, 163] }],
      },
      ui: { bag: { stage: "tm-case-list", pocket: 1, cursor: 0 } },
    },
  });

  const quest = createPolicyAdvisors({ mechanics, campaignPlanner })
    .flatMap((advisor) => advisor.advise(observed) ?? [])
    .find(({ advisor }) => advisor === "quest");

  assert.deepEqual(quest?.recommendation, {
    kind: "close-menu",
    objective: "silph-supplies",
  });
  assert.deepEqual(mapRecommendation(quest.recommendation, observed).buttons, ["b"]);
});

test("the quest policy refuses a different shop’s item and a mismatched quantity prompt", () => {
  const campaignPlanner={select:()=>({id:'hunt-balls',target:{kind:'purchase-items',map:'MAP_FUCHSIA_CITY_MART',objectIndex:0,items:[{itemId:2,stockIndex:0,quantity:30,unitPrice:1200}]}})};
  for (const mart of [
    {stage:'item-list',stock:[{itemId:4,price:200}]},
    {stage:'quantity',itemId:4,quantity:23,stock:[{itemId:2,price:1200}]},
    {stage:'confirm-purchase',itemId:4,quantity:23,stock:[{itemId:2,price:1200}]},
  ]) {
    const o=observation({emulator:{mode:'mart'},playerMemory:{trainer:{money:100000,bag:{pokeBalls:[]},party:[]},ui:{mart}}});
    const advice=createPolicyAdvisors({mechanics,campaignPlanner}).flatMap(a=>a.advise(o)??[]).find(a=>a.advisor==='quest');
    assert.equal(advice.recommendation.kind,'close-menu');
  }
});

test("the quest policy completes a multi-item League mart transaction", () => {
  const campaignPlanner = {
    select: () => ({
      id: "league-supplies",
      target: {
        kind: "purchase-items",
        map: "MAP_INDIGO_PLATEAU_POKEMON_CENTER_1F",
        objectIndex: 0,
        items: [
          { itemId: 19, stockIndex: 2, quantity: 8 },
          { itemId: 24, stockIndex: 4, quantity: 8 },
        ],
      },
    }),
  };
  const recommend = ({ mart, items = [] }) => {
    const observed = observation({
      emulator: { mode: "mart" },
      playerMemory: {
        trainer: { money: 100000, bag: { items }, party: [] },
        ui: { mart },
      },
    });
    const recommendation = createPolicyAdvisors({ mechanics, campaignPlanner })
      .flatMap((advisor) => advisor.advise(observed) ?? [])
      .find(({ advisor }) => advisor === "quest")?.recommendation;
    return { observed, recommendation };
  };

  let result = recommend({ mart: { stage: "shop-menu", cursor: 1 } });
  assert.equal(result.recommendation.kind, "choose-mart-menu-item");
  assert.deepEqual(mapRecommendation(result.recommendation, result.observed).buttons,
    ["up"]);

  result = recommend({ mart: { stage: "item-list", cursor: 1 } });
  assert.deepEqual(result.recommendation, {
    kind: "choose-mart-item",
    targetItemId: 19,
    targetIndex: 2,
    objective: "league-supplies",
  });
  assert.deepEqual(mapRecommendation(result.recommendation, result.observed).buttons,
    ["down"]);

  result = recommend({
    mart: { stage: "quantity", cursor: null, itemId: 19, quantity: 1 },
    items: [{ itemId: 19, quantity: 3 }],
  });
  assert.equal(result.recommendation.kind, "choose-mart-quantity");
  assert.equal(result.recommendation.targetQuantity, 5);
  assert.deepEqual(mapRecommendation(result.recommendation, result.observed).buttons,
    ["up"]);

  result = recommend({ mart: { stage: "confirm-purchase", cursor: 1 } });
  assert.equal(result.recommendation.kind, "choose-menu-option");
  assert.deepEqual(mapRecommendation(result.recommendation, result.observed).buttons,
    ["up"]);

  result = recommend({
    mart: { stage: "purchase-result", cursor: null },
    items: [{ itemId: 19, quantity: 8 }],
  });
  assert.equal(result.recommendation.kind, "acknowledge-cartridge-prompt");

  result = recommend({
    mart: { stage: "item-list", cursor: 2 },
    items: [{ itemId: 19, quantity: 8 }],
  });
  assert.equal(result.recommendation.targetItemId, 24);
  assert.equal(result.recommendation.targetIndex, 4);
});

test("the mart policy respects cartridge affordability and skips unaffordable stock", () => {
  const campaignPlanner = {
    select: () => ({
      id: "budgeted-supplies",
      target: {
        kind: "purchase-items",
        map: "MAP_CERULEAN_CITY_MART",
        objectIndex: 0,
        items: [
          { itemId: 22, stockIndex: 1, quantity: 4, unitPrice: 700 },
          { itemId: 14, stockIndex: 3, quantity: 2, unitPrice: 100 },
        ],
      },
    }),
  };
  const recommend = ({ mart, money, items = [] }) => {
    const observed = observation({
      emulator: { mode: "mart" },
      playerMemory: {
        trainer: { money, bag: { items }, party: [] },
        ui: { mart },
      },
    });
    return createPolicyAdvisors({ mechanics, campaignPlanner })
      .flatMap((advisor) => advisor.advise(observed) ?? [])
      .find(({ advisor }) => advisor === "quest")?.recommendation;
  };
  const stock = [
    { itemId: 22, price: 700 },
    { itemId: 14, price: 100 },
  ];

  assert.deepEqual(recommend({
    mart: {
      stage: "quantity",
      itemId: 22,
      quantity: 1,
      maximumQuantity: 2,
      stock,
    },
    money: 1964,
  }), {
    kind: "choose-mart-quantity",
    targetItemId: 22,
    targetQuantity: 2,
    objective: "budgeted-supplies",
  });

  assert.deepEqual(recommend({
    mart: { stage: "item-list", cursor: 1, stock },
    money: 200,
    items: [{ itemId: 22, quantity: 2 }],
  }), {
    kind: "choose-mart-item",
    targetItemId: 14,
    targetIndex: 3,
    objective: "budgeted-supplies",
  });

  assert.deepEqual(recommend({
    mart: { stage: "item-list", cursor: 1, stock },
    money: 50,
    items: [{ itemId: 22, quantity: 2 }],
  }), {
    kind: "close-menu",
    objective: "budgeted-supplies",
  });
});

test("the quest policy drains a completed mart transaction before navigating", () => {
  const campaignPlanner = {
    select: () => ({
      id: "rival-silph",
      target: { kind: "trigger", map: "MAP_SILPH_CO_7F", index: 0 },
      completion: { kind: "variable-at-least", id: 16476, value: 1 },
    }),
  };
  const recommend = (stage) => {
    const observed = observation({
      emulator: { mode: "modal", callback2: "CB2_BuyMenu" },
      playerMemory: {
        trainer: {
          money: 28920,
          bag: { items: [
            { itemId: 21, quantity: 8 },
            { itemId: 23, quantity: 4 },
          ] },
          party: [],
        },
        ui: { mart: { stage, cursor: null, selected: null } },
      },
    });
    const recommendation = createPolicyAdvisors({ mechanics, campaignPlanner })
      .flatMap((advisor) => advisor.advise(observed) ?? [])
      .find(({ advisor }) => advisor === "quest")?.recommendation;
    return { observed, recommendation };
  };

  let result = recommend("purchase-result");
  assert.equal(result.recommendation.kind, "acknowledge-cartridge-prompt");
  assert.deepEqual(mapRecommendation(result.recommendation, result.observed).buttons,
    ["a"]);

  result = recommend("item-list");
  assert.equal(result.recommendation.kind, "close-menu");
  assert.deepEqual(mapRecommendation(result.recommendation, result.observed).buttons,
    ["b"]);
});

test("the quest policy revives and heals the party between League rooms", () => {
  const campaignPlanner = {
    select: () => ({
      id: "restore-after-lorelei",
      target: { kind: "heal-with-items" },
      completion: { kind: "party-fully-healed" },
    }),
  };
  const party = [
    { slot: 0, species: 3, hp: 0, maxHp: 180 },
    { slot: 1, species: 131, hp: 80, maxHp: 220 },
  ];
  const bag = { items: [
    { itemId: 19, quantity: 8 },
    { itemId: 24, quantity: 8 },
  ] };
  const recommend = ({ mode = "overworld", ui = {} } = {}) => {
    const observed = observation({
      emulator: { mode },
      playerMemory: {
        trainer: { partyCount: 2, usablePartyCount: 1, party, bag },
        ui,
      },
    });
    return createPolicyAdvisors({ mechanics, campaignPlanner })
      .flatMap((advisor) => advisor.advise(observed) ?? [])
      .find(({ advisor }) => advisor === "quest")?.recommendation;
  };

  assert.equal(recommend().kind, "open-start-menu");
  assert.deepEqual(recommend({
    mode: "bag",
    ui: { bag: { stage: "list", pocket: 0, index: 0 } },
  }), {
    kind: "choose-bag-item",
    targetItemId: 24,
    targetIndex: 1,
    objective: "restore-after-lorelei",
  });
  assert.deepEqual(recommend({
    mode: "party",
    ui: { party: { stage: "choose-pokemon", cursor: 1, itemId: 24 } },
  }), {
    kind: "choose-party-member",
    targetPartySlot: 0,
    targetSpecies: 3,
    objective: "restore-after-lorelei",
  });
  assert.deepEqual(recommend({
    mode: "party",
    ui: { party: { stage: "message", cursor: 0 } },
  }), {
    kind: "acknowledge-cartridge-prompt",
    objective: "restore-after-lorelei",
  });

  party[0].hp = 90;
  assert.equal(recommend({
    mode: "party",
    ui: { party: { stage: "choose-pokemon", cursor: 0, itemId: 24 } },
  }).kind, "close-menu");
  assert.equal(recommend({
    mode: "party",
    ui: { party: { stage: "choose-pokemon", cursor: 0, itemId: 19 } },
  }).targetPartySlot, 1);
});

test("League recovery chooses medicine by condition instead of burning Full Restores", () => {
  const campaignPlanner = {
    select: () => ({
      id: "restore-after-agatha",
      target: { kind: "heal-with-items" },
      completion: { kind: "party-maximally-recovered" },
    }),
  };
  const recommend = ({ party, items }) => {
    const observed = observation({
      emulator: { mode: "bag" },
      playerMemory: {
        trainer: { partyCount: party.length, party, bag: { items } },
        ui: { bag: { stage: "list", pocket: 0, index: 0 } },
      },
    });
    return createPolicyAdvisors({ mechanics, campaignPlanner })
      .flatMap((advisor) => advisor.advise(observed) ?? [])
      .find(({ advisor }) => advisor === "quest")?.recommendation;
  };
  const medicines = [
    { itemId: 24, quantity: 4 },
    { itemId: 20, quantity: 4 },
    { itemId: 18, quantity: 4 },
    { itemId: 23, quantity: 4 },
    { itemId: 19, quantity: 4 },
  ];
  const member = {
    slot: 0,
    species: 131,
    hp: 100,
    maxHp: 200,
    status1: 0,
  };

  assert.equal(recommend({
    party: [{ ...member, hp: 0 }],
    items: medicines,
  }).targetItemId, 24);
  assert.equal(recommend({
    party: [member],
    items: medicines,
  }).targetItemId, 20);
  assert.equal(recommend({
    party: [{ ...member, hp: 200, status1: 64 }],
    items: medicines,
  }).targetItemId, 18);
  assert.equal(recommend({
    party: [{ ...member, status1: 64 }],
    items: medicines,
  }).targetItemId, 18);
});

test("League recovery heals living members and exits cleanly after Revives run out", () => {
  const campaignPlanner = {
    select: () => ({
      id: "restore-after-bruno",
      target: { kind: "heal-with-items" },
      completion: { kind: "party-maximally-recovered" },
    }),
  };
  const party = [
    { slot: 0, species: 123, hp: 0, maxHp: 142, status1: 0 },
    { slot: 1, species: 135, hp: 67, maxHp: 135, status1: 0 },
  ];
  const recommend = ({ items, ui }) => {
    const observed = observation({
      emulator: { mode: "bag" },
      playerMemory: {
        trainer: { partyCount: 2, usablePartyCount: 1, party, bag: { items } },
        ui,
      },
    });
    return createPolicyAdvisors({ mechanics, campaignPlanner })
      .flatMap((advisor) => advisor.advise(observed) ?? [])
      .find(({ advisor }) => advisor === "quest")?.recommendation;
  };

  assert.deepEqual(recommend({
    items: [{ itemId: 19, quantity: 4 }],
    ui: { bag: { stage: "list", pocket: 0, index: 0 } },
  }), {
    kind: "choose-bag-item",
    targetItemId: 19,
    targetIndex: 0,
    objective: "restore-after-bruno",
  });

  party[1].hp = party[1].maxHp;
  assert.deepEqual(recommend({
    items: [{ itemId: 19, quantity: 3 }],
    ui: { bag: { stage: "list", pocket: 0, index: 0 } },
  }), {
    kind: "close-menu",
    objective: "restore-after-bruno",
  });
});

test("the first-rival policy lowers the observed Attack stage twice before dealing damage", () => {
  const recommendationAt = (attackStage, moveState = {}) => {
    const observed = observation({
      emulator: { mode: "battle" },
      playerMemory: {
        map: { id: "MAP_PALLET_TOWN_PROFESSOR_OAKS_LAB" },
        storyState: {
          variables: {
            VAR_MAP_SCENE_PALLET_TOWN_PROFESSOR_OAKS_LAB: 3,
          },
          flags: {},
        },
        battle: {
          player: {
            species: 1,
            level: 5,
            hp: 19,
            maxHp: 19,
            moves: [33, 45, 0, 0],
            pp: [35, 40, 0, 0],
            moveState,
            stats: { attack: 11, spAttack: 12 },
          },
          opponent: {
            species: 4,
            level: 5,
            hp: 18,
            maxHp: 18,
            statStages: { attack: attackStage },
            stats: { defense: 9, spDefense: 10 },
          },
        },
        ui: { battle: { stage: "move", cursor: 0, selectedMoveId: 33 } },
      },
    });
    return createPolicyAdvisors({ mechanics, world: playersHouseWorld })
      .flatMap((advisor) => advisor.advise(observed) ?? [])
      .find(({ advisor }) => advisor === "battle")
      .recommendation;
  };

  assert.deepEqual(recommendationAt(6), {
    kind: "choose-battle-move",
    targetMoveId: 45,
    targetMoveSlot: 1,
    objective: "lower-first-rival-attack",
    observedAttackStage: 6,
    targetAttackStage: 4,
  });
  assert.equal(recommendationAt(5).targetMoveId, 45);
  assert.equal(recommendationAt(4).targetMoveId, 33);
  assert.equal(recommendationAt(6, {
    disabledMove: 45,
    disableTurns: 3,
  }).targetMoveId, 33);
});

test("the inventory policy diverts a critically hurt party to the nearest reachable nurse", () => {
  const recoveryWorld = { maps: [
    mapFromCollisionRows({
      id: "MAP_FOREST",
      rows: [".....", ".....", ".....", ".....", "....."],
      connections: [{ direction: "down", map: "MAP_CITY", offset: 0 }],
      properties: { allow_running: true },
    }),
    mapFromCollisionRows({
      id: "MAP_CITY",
      rows: [".....", ".....", "..#..", ".....", "....."],
      connections: [{ direction: "up", map: "MAP_FOREST", offset: 0 }],
      warpEvents: [{
        x: 2,
        y: 2,
        dest_map: "MAP_CITY_POKEMON_CENTER_1F",
        dest_warp_id: "1",
      }],
      behaviors: { "2,2": "MB_WARP_DOOR" },
    }),
    mapFromCollisionRows({
      id: "MAP_CITY_POKEMON_CENTER_1F",
      rows: [".....", ".....", ".....", ".....", "....."],
      warpEvents: [
        { x: 1, y: 4, dest_map: "MAP_CITY", dest_warp_id: "0" },
        { x: 2, y: 4, dest_map: "MAP_CITY", dest_warp_id: "0" },
        { x: 3, y: 4, dest_map: "MAP_CITY", dest_warp_id: "0" },
      ],
      objectEvents: [{
        x: 2,
        y: 1,
        local_id: "LOCALID_CITY_NURSE",
        script: "City_PokemonCenter_1F_EventScript_Nurse",
      }],
      behaviors: { "2,4": "MB_SOUTH_ARROW_WARP" },
    }),
  ] };
  const observed = observation({
    playerMemory: {
      map: { id: "MAP_FOREST" },
      position: { x: 2, y: 2 },
      avatar: { flags: 1, onFoot: true, surfing: false },
      storyState: { flagIds: { 2095: true } },
      trainer: {
        partyCount: 1,
        usablePartyCount: 1,
        party: [{ slot: 0, species: 1, level: 8, hp: 9, maxHp: 25 }],
      },
    },
  });

  const inventory = createPolicyAdvisors({ mechanics, world: recoveryWorld })
    .flatMap((advisor) => advisor.advise(observed) ?? [])
    .find(({ advisor }) => advisor === "inventory");

  assert.equal(inventory.recommendation.objective, "recover-party");
  assert.equal(inventory.recommendation.useRunningShoes, true);
  assert.equal(inventory.recommendation.targetMap, "MAP_CITY_POKEMON_CENTER_1F");
  assert.deepEqual(inventory.recommendation.transit, {
    kind: "connection",
    destinationMap: "MAP_CITY",
    direction: "south",
  });
  assert.ok(inventory.evidenceRefs.includes("cartridge:party-hp:9/25"));

  observed.playerMemory.trainer = {
    partyCount: 2,
    usablePartyCount: 1,
    party: [
      { slot: 0, species: 1, level: 40, hp: 300, maxHp: 300 },
      { slot: 1, species: 131, level: 40, hp: 0, maxHp: 100 },
    ],
  };
  const faintedRecovery = createPolicyAdvisors({ mechanics, world: recoveryWorld })
    .flatMap((advisor) => advisor.advise(observed) ?? [])
    .find(({ advisor }) => advisor === "inventory");
  assert.equal(faintedRecovery.recommendation.objective, "recover-party");
});

test("recovery navigation cannot cross an unready major-battle trigger", () => {
  const arenaId = "MAP_BOSS_GUARD_ARENA";
  const centerId = "MAP_BOSS_GUARD_POKEMON_CENTER_1F";
  const arena = mapFromCollisionRows({
    id: arenaId,
    rows: ["#######", "#.....#", "#.....#", "#.....#", "#######"],
    coordEvents: [{ x: 3, y: 2, script: "BossGuard_EventScript_Rival" }],
    warpEvents: [{ x: 5, y: 2, dest_map: centerId, dest_warp_id: 0 }],
    behaviors: { "5,2": "MB_LADDER" },
  });
  const center = mapFromCollisionRows({
    id: centerId,
    rows: ["#######", "#.....#", "#.....#", "#.....#", "#######"],
    warpEvents: [{ x: 1, y: 2, dest_map: arenaId, dest_warp_id: 0 }],
    objectEvents: [{
      x: 5,
      y: 2,
      local_id: "LOCALID_BOSS_GUARD_NURSE",
      script: "BossGuard_PokemonCenter_1F_EventScript_Nurse",
    }],
    behaviors: { "1,2": "MB_LADDER" },
  });
  const campaignPlanner = { select: () => ({
    id: "pending-rival",
    target: { kind: "trigger", map: arenaId, index: 0 },
    importantBattle: true,
    minimumBattlePartySize: 2,
  }) };
  const observed = observation({
    playerMemory: {
      map: { id: arenaId },
      position: { x: 1, y: 2 },
      trainer: {
        partyCount: 1,
        usablePartyCount: 1,
        party: [{ slot: 0, species: 6, level: 25, hp: 20, maxHp: 100 }],
      },
    },
  });

  const recommendation = createPolicyAdvisors({
    mechanics,
    world: { maps: [arena, center] },
    campaignPlanner,
  }).flatMap((advisor) => advisor.advise(observed) ?? [])
    .find(({ advisor }) => advisor === "inventory")?.recommendation;

  assert.equal(recommendation?.objective, "recover-party");
  assert.equal(recommendation?.direction, "south");
  assert.deepEqual(recommendation?.pathSegment, {
    direction: "south",
    steps: 1,
    endpoint: { map: arenaId, x: 1, y: 3 },
    continuationDirection: "east",
  });
});

test("training navigation cannot cross its pending major-battle trigger", () => {
  const mapId = "MAP_TRAINING_BOSS_GUARD";
  const map = mapFromCollisionRows({
    id: mapId,
    rows: ["#######", "#.....#", "#.....#", "#.....#", "#######"],
    coordEvents: [{ x: 3, y: 2, script: "TrainingBossGuard_EventScript_Rival" }],
    encounters: { "4,2": 1, "5,2": 1 },
    behaviors: { "4,2": "MB_TALL_GRASS", "5,2": "MB_TALL_GRASS" },
  });
  const storyObjective = {
    id: "pending-rival",
    target: { kind: "trigger", map: mapId, index: 0 },
    importantBattle: true,
    minimumBattlePartySize: 2,
  };
  const campaignPlanner = {
    select: () => storyObjective,
    selectTraining: () => ({
      id: "train-battle-member",
      target: { kind: "encounter-zone", map: mapId },
      forObjective: storyObjective.id,
      trainingPartySlot: 1,
      currentTeamAnchorLevel: 20,
      minimumTeamAnchorLevel: 30,
      encounter: { minimumWildLevel: 18, maximumWildLevel: 22 },
    }),
  };
  const observed = observation({
    playerMemory: {
      map: { id: mapId },
      position: { x: 1, y: 2 },
      trainer: {
        partyCount: 2,
        usablePartyCount: 2,
        party: [
          { slot: 0, species: 6, level: 35, hp: 110, maxHp: 110 },
          { slot: 1, species: 131, level: 20, hp: 90, maxHp: 90 },
        ],
      },
    },
  });

  const recommendation = createPolicyAdvisors({
    mechanics,
    world: { maps: [map] },
    campaignPlanner,
  }).flatMap((advisor) => advisor.advise(observed) ?? [])
    .find(({ advisor }) => advisor === "navigation")?.recommendation;

  assert.equal(recommendation?.objective, "train-battle-member");
  assert.equal(recommendation?.direction, "south");
});

test("passive training continues through the pending major-battle trigger", () => {
  const mapId = "MAP_PASSIVE_TRAINING_STORY";
  const map = mapFromCollisionRows({
    id: mapId,
    rows: ["#####", "#...#", "#####"],
    coordEvents: [{ x: 3, y: 1, script: "PassiveTraining_EventScript_Koga" }],
  });
  const storyObjective = {
    id: "badge-soul",
    target: { kind: "trigger", map: mapId, index: 0 },
    importantBattle: true,
  };
  const campaignPlanner = {
    select: () => storyObjective,
    selectTraining: () => ({
      id: "train-battle-member-through-story",
      trainingMode: "passive",
      trainingSource: "story",
      target: storyObjective.target,
      forObjective: storyObjective.id,
      trainingMethod: "switch",
      trainingPartySlot: 1,
      currentTeamAnchorLevel: 28,
      minimumTeamAnchorLevel: 43,
    }),
  };
  const observed = observation({
    playerMemory: {
      map: { id: mapId },
      position: { x: 1, y: 1 },
      trainer: {
        partyCount: 2,
        usablePartyCount: 2,
        party: [
          { slot: 0, species: 6, level: 58, hp: 171, maxHp: 171 },
          { slot: 1, species: 123, level: 28, hp: 78, maxHp: 78 },
        ],
      },
    },
  });

  const recommendation = createPolicyAdvisors({
    mechanics,
    world: { maps: [map] },
    campaignPlanner,
  }).flatMap((advisor) => advisor.advise(observed) ?? [])
    .find(({ advisor }) => advisor === "navigation")?.recommendation;

  assert.equal(recommendation?.objective, storyObjective.id);
  assert.equal(recommendation?.direction, "east");
});

test("roster preparation cannot cross its pending major-battle trigger", () => {
  const arenaId = "MAP_ROSTER_BOSS_GUARD";
  const centerId = "MAP_ROSTER_BOSS_GUARD_POKEMON_CENTER_1F";
  const arena = mapFromCollisionRows({
    id: arenaId,
    rows: ["#######", "#.....#", "#.....#", "#.....#", "#######"],
    coordEvents: [{ x: 3, y: 2, script: "RosterBossGuard_EventScript_Rival" }],
    warpEvents: [{ x: 5, y: 2, dest_map: centerId, dest_warp_id: 0 }],
    behaviors: { "5,2": "MB_LADDER" },
  });
  const center = mapFromCollisionRows({
    id: centerId,
    rows: ["#######", "#.....#", "#.....#", "#.....#", "#######"],
    warpEvents: [{ x: 1, y: 2, dest_map: arenaId, dest_warp_id: 0 }],
    behaviors: { "1,2": "MB_LADDER", "5,2": "MB_PC" },
  });
  const campaignPlanner = { select: () => ({
    id: "pending-rival",
    target: { kind: "trigger", map: arenaId, index: 0 },
    importantBattle: true,
    minimumBattlePartySize: 2,
  }) };
  const observed = observation({
    playerMemory: {
      map: { id: arenaId },
      position: { x: 1, y: 2 },
      trainer: {
        partyCount: 1,
        usablePartyCount: 1,
        party: [{ slot: 0, species: 6, level: 30, hp: 100, maxHp: 100 }],
        storage: {
          pokemon: [{ box: 0, slot: 0, species: 131, level: 30, moves: [57] }],
        },
      },
    },
  });

  const recommendation = createPolicyAdvisors({
    mechanics,
    world: { maps: [arena, center] },
    campaignPlanner,
  }).flatMap((advisor) => advisor.advise(observed) ?? [])
    .find(({ advisor }) => advisor === "navigation")?.recommendation;

  assert.equal(recommendation?.objective, "prepare-pending-rival-roster");
  assert.equal(recommendation?.direction, "south");
});

test("training preparation heals its core member and makes it the field lead", () => {
  const recoveryWorld = { maps: [
    mapFromCollisionRows({
      id: "MAP_TRAINING_MEADOW",
      rows: [".....", ".....", ".....", ".....", "....."],
      encounters: { "2,2": 1, "3,2": 1 },
      behaviors: { "2,2": "MB_TALL_GRASS", "3,2": "MB_TALL_GRASS" },
      connections: [{ direction: "down", map: "MAP_CITY", offset: 0 }],
    }),
    mapFromCollisionRows({
      id: "MAP_CITY",
      rows: [".....", ".....", "..#..", ".....", "....."],
      connections: [{ direction: "up", map: "MAP_TRAINING_MEADOW", offset: 0 }],
      warpEvents: [{
        x: 2,
        y: 2,
        dest_map: "MAP_CITY_POKEMON_CENTER_1F",
        dest_warp_id: "1",
      }],
      behaviors: { "2,2": "MB_WARP_DOOR" },
    }),
    mapFromCollisionRows({
      id: "MAP_CITY_POKEMON_CENTER_1F",
      rows: [".....", ".....", ".....", ".....", "....."],
      warpEvents: [
        { x: 1, y: 4, dest_map: "MAP_CITY", dest_warp_id: "0" },
        { x: 2, y: 4, dest_map: "MAP_CITY", dest_warp_id: "0" },
        { x: 3, y: 4, dest_map: "MAP_CITY", dest_warp_id: "0" },
      ],
      objectEvents: [{
        x: 2,
        y: 1,
        local_id: "LOCALID_CITY_NURSE",
        script: "City_PokemonCenter_1F_EventScript_Nurse",
      }],
      behaviors: { "2,4": "MB_SOUTH_ARROW_WARP" },
    }),
  ], wildEncounters: [{
    map: "MAP_TRAINING_MEADOW",
    land_mons: {
      encounter_rate: 20,
      mons: [{ min_level: 8, max_level: 12 }],
    },
  }] };
  const campaignPlanner = { select: () => ({
    id: "badge-volcano",
    target: { kind: "object", map: "MAP_BOSS", index: 0 },
    minimumCoreLevel: 45,
    coreSpecies: [131],
  }) };
  const trainingMechanics = {
    ...mechanics,
    moves: {
      ...mechanics.moves,
      15: { id: 15, power: 50, accuracy: 95, type: "TYPE_NORMAL" },
      70: { id: 70, power: 80, accuracy: 100, type: "TYPE_NORMAL" },
      235: { id: 235, power: 0, accuracy: 100, type: "TYPE_GRASS" },
    },
  };
  const party = [
    { slot: 0, species: 3, level: 60, hp: 170, maxHp: 173,
      moves: [290, 235, 70, 15], pp: [10, 5, 10, 20] },
    { slot: 1, species: 131, level: 10, hp: 20, maxHp: 100, moves: [57] },
  ];
  const recommend = ({ mode = "overworld", ui = {}, currentParty = party } = {}) => {
    const observed = observation({
      emulator: { mode },
      playerMemory: {
        map: { id: "MAP_TRAINING_MEADOW" },
        position: { x: 2, y: 2 },
        trainer: {
          partyCount: 2,
          usablePartyCount: 2,
          party: currentParty,
        },
        ui,
      },
    });
    return createPolicyAdvisors({
      mechanics: trainingMechanics,
      world: recoveryWorld,
      campaignPlanner,
    }).flatMap((advisor) => advisor.advise(observed) ?? [])
      .find(({ advisor }) => advisor === "inventory")?.recommendation;
  };

  assert.equal(recommend().objective, "recover-training-party");

  party[1].hp = 100;
  party[1].pp = [0];
  assert.equal(recommend().objective, "recover-training-party");
  party[1].pp = [15];
  party[0].pp = [0, 5, 0, 2];
  assert.equal(recommend().objective, "recover-training-party");
  party[0].pp = [10, 5, 10, 20];
  party[0].status1 = 64;
  assert.equal(recommend().objective, "recover-training-party");
  party[0].status1 = 0;
  assert.deepEqual(recommend(), {
    kind: "open-start-menu",
    objective: "lead-with-training-member",
  });
  assert.deepEqual(recommend({
    mode: "start-menu",
    ui: { startMenu: { cursor: 0, order: ["pokedex", "pokemon", "bag"] } },
  }), {
    kind: "choose-start-menu-item",
    targetItem: "pokemon",
    targetIndex: 1,
    objective: "lead-with-training-member",
  });
  const startMenuObservation = observation({
    emulator: { mode: "start-menu" },
    playerMemory: {
      map: { id: "MAP_TRAINING_MEADOW" },
      position: { x: 2, y: 2 },
      trainer: {
        partyCount: 2,
        usablePartyCount: 2,
        party,
      },
      ui: {
        startMenu: { cursor: 0, order: ["pokedex", "pokemon", "bag"] },
      },
    },
  });
  const centralDecision = createCentralPlayer({
    advisors: createPolicyAdvisors({
      mechanics: trainingMechanics,
      world: recoveryWorld,
      campaignPlanner,
    }),
  }).decide(startMenuObservation);
  assert.equal(centralDecision.winner.advisor, "inventory");
  assert.equal(
    centralDecision.winner.recommendation.kind,
    "choose-start-menu-item",
  );
  assert.deepEqual(recommend({
    mode: "party",
    ui: { party: { stage: "choose-pokemon", cursor: 0 } },
  }), {
    kind: "choose-party-member",
    targetPartySlot: 1,
    targetSpecies: 131,
    objective: "lead-with-training-member",
  });
  assert.deepEqual(recommend({
    mode: "party",
    ui: { party: {
      stage: "selection-menu",
      cursor: 1,
      actionCursor: 0,
      actions: ["summary", "surf", "switch", "item", "cancel"],
    } },
  }), {
    kind: "choose-party-action",
    targetAction: "switch",
    targetIndex: 2,
    objective: "lead-with-training-member",
  });
  assert.deepEqual(recommend({
    mode: "party",
    ui: { party: { stage: "choose-switch-target", cursor: 1 } },
  }), {
    kind: "choose-party-member",
    targetPartySlot: 0,
    targetSpecies: 3,
    objective: "lead-with-training-member",
  });
  const reordered = [
    { ...party[1], slot: 0 },
    { ...party[0], slot: 1 },
  ];
  assert.deepEqual(recommend({
    mode: "party",
    currentParty: reordered,
    ui: { party: { stage: "choose-pokemon", cursor: 0 } },
  }), {
    kind: "close-menu",
    objective: "lead-with-training-member",
  });
});

test("training preparation uses an owned status remedy before the next battle", () => {
  const map = mapFromCollisionRows({
    id: "MAP_STATUS_TRAINING",
    rows: [".....", ".....", "....."],
    encounters: { "1,1": 1, "2,1": 1 },
  });
  const storyObjective = {
    id: "next-boss",
    target: { kind: "trigger", map: "MAP_NEXT_BOSS", index: 0 },
    importantBattle: true,
  };
  const campaignPlanner = {
    select: () => storyObjective,
    selectTraining: () => ({
      id: "train-team-anchor",
      target: { kind: "encounter-zone", map: map.id },
      forObjective: storyObjective.id,
      trainingSource: "wild",
      trainingMethod: "direct",
      trainingPartySlot: 0,
      trainingSpecies: 1,
    }),
  };
  const party = [
    {
      slot: 0, species: 1, level: 30, hp: 90, maxHp: 90,
      status1: 0, moves: [33], pp: [20],
    },
    {
      slot: 1, species: 25, level: 45, hp: 120, maxHp: 120,
      status1: 64, moves: [85], pp: [15],
    },
  ];
  const recommend = ({ mode = "overworld", ui = {}, currentParty = party } = {}) => {
    const observed = observation({
      emulator: { mode },
      playerMemory: {
        map: { id: map.id },
        position: { x: 1, y: 1 },
        trainer: {
          partyCount: 2,
          usablePartyCount: 2,
          party: currentParty,
          bag: { items: [{ itemId: 18, quantity: 2 }] },
        },
        ui,
      },
    });
    return createPolicyAdvisors({
      mechanics,
      world: { maps: [map] },
      campaignPlanner,
    }).find(({ id }) => id === "inventory")
      ?.advise(observed)?.recommendation;
  };

  assert.deepEqual(recommend(), {
    kind: "open-start-menu",
    objective: "recover-training-status",
  });
  assert.deepEqual(recommend({
    mode: "start-menu",
    ui: { startMenu: { cursor: 0, order: ["pokedex", "pokemon", "bag"] } },
  }), {
    kind: "choose-start-menu-item",
    targetItem: "bag",
    targetIndex: 2,
    objective: "recover-training-status",
  });
  assert.deepEqual(recommend({
    mode: "bag",
    ui: { bag: { stage: "list", pocket: 0, index: 0 } },
  }), {
    kind: "choose-bag-item",
    targetItemId: 18,
    targetIndex: 0,
    objective: "recover-training-status",
  });
  assert.deepEqual(recommend({
    mode: "bag",
    ui: { bag: { stage: "context", selectedItemId: 18 } },
  }), {
    kind: "choose-bag-context-action",
    targetAction: "use",
    targetIndex: 0,
    objective: "recover-training-status",
  });
  assert.deepEqual(recommend({
    mode: "party",
    ui: { party: { stage: "choose-pokemon", cursor: 0, itemId: 18 } },
  }), {
    kind: "choose-party-member",
    targetPartySlot: 1,
    targetSpecies: 25,
    objective: "recover-training-status",
  });
  assert.deepEqual(recommend({
    mode: "party",
    ui: { party: { stage: "message", cursor: 1, itemId: 18 } },
  }), {
    kind: "acknowledge-cartridge-prompt",
    objective: "recover-training-status",
  });
  assert.deepEqual(recommend({
    mode: "party",
    currentParty: [party[0], { ...party[1], status1: 0 }],
    ui: { party: { stage: "choose-pokemon", cursor: 1, itemId: 18 } },
  }), {
    kind: "close-menu",
    objective: "recover-training-status",
  });
});

test("owned status recovery continues while traveling between training and the boss", () => {
  const trainingMap = mapFromCollisionRows({
    id: "MAP_STATUS_TRAINING",
    rows: [".....", ".....", "....."],
  });
  const city = mapFromCollisionRows({
    id: "MAP_STATUS_CITY",
    rows: [".....", ".....", "....."],
  });
  const storyObjective = {
    id: "next-boss",
    target: { kind: "trigger", map: "MAP_NEXT_BOSS", index: 0 },
    importantBattle: true,
  };
  const campaignPlanner = {
    select: () => storyObjective,
    selectTraining: () => ({
      id: "train-team-anchor",
      target: { kind: "encounter-zone", map: trainingMap.id },
      forObjective: storyObjective.id,
      trainingSource: "wild",
      trainingMethod: "direct",
      trainingPartySlot: 0,
      trainingSpecies: 22,
    }),
  };
  const observed = observation({
    emulator: { mode: "overworld" },
    playerMemory: {
      map: { id: city.id },
      position: { x: 1, y: 1 },
      trainer: {
        partyCount: 1,
        usablePartyCount: 1,
        party: [{
          slot: 0,
          species: 22,
          level: 27,
          hp: 66,
          maxHp: 73,
          status1: 64,
          moves: [64],
          pp: [28],
        }],
        bag: { items: [{ itemId: 18, quantity: 1 }] },
      },
    },
  });

  const advice = createPolicyAdvisors({
    mechanics,
    world: { maps: [trainingMap, city] },
    campaignPlanner,
  }).find(({ id }) => id === "inventory")?.advise(observed);

  assert.deepEqual(advice?.recommendation, {
    kind: "open-start-menu",
    objective: "recover-training-status",
  });
});

test("training recovery monitors the planner's balanced escort instead of the starter", () => {
  const storyObjective = {
    id: "badge-thunder",
    target: { kind: "object", map: "MAP_VERMILION_CITY_GYM", index: 0 },
    importantBattle: true,
  };
  const campaignPlanner = {
    select: () => storyObjective,
    selectTraining: () => ({
      id: "train-battle-member",
      target: { kind: "encounter-zone", map: "MAP_TRAINING_MEADOW" },
      forObjective: storyObjective.id,
      trainingPartySlot: 0,
      trainingSpecies: 50,
      escortPartySlot: 1,
      escortSpecies: 22,
    }),
  };
  const observed = observation({
    playerMemory: {
      map: { id: "MAP_TRAINING_MEADOW" },
      trainer: {
        partyCount: 3,
        usablePartyCount: 3,
        party: [
          { slot: 0, species: 50, level: 22, hp: 43, maxHp: 43,
            moves: [33], pp: [20] },
          { slot: 1, species: 22, level: 28, hp: 30, maxHp: 81,
            moves: [33], pp: [20] },
          { slot: 2, species: 9, level: 57, hp: 183, maxHp: 183,
            moves: [33], pp: [20] },
        ],
        bag: { items: [{ itemId: 22, quantity: 1 }] },
      },
    },
  });

  const recommendation = createPolicyAdvisors({ mechanics, campaignPlanner })
    .find(({ id }) => id === "inventory")
    .advise(observed)?.recommendation;

  assert.deepEqual(recommendation, {
    kind: "open-start-menu",
    objective: "recover-training-party-with-items",
  });
});

test("nearby free healer preserves owned medicine in town and an adjacent route", () => {
  const remoteRoute = mapFromCollisionRows({
    id: "MAP_MEDICINE_REMOTE_ROUTE",
    rows: [".....", ".....", ".....", ".....", "....."],
    connections: [{
      direction: "down",
      map: "MAP_MEDICINE_ADJACENT_ROUTE",
      offset: 0,
    }],
  });
  const adjacentRoute = mapFromCollisionRows({
    id: "MAP_MEDICINE_ADJACENT_ROUTE",
    rows: [".....", ".....", ".....", ".....", "....."],
    connections: [
      { direction: "up", map: remoteRoute.id, offset: 0 },
      { direction: "down", map: "MAP_MEDICINE_LOCAL_CITY", offset: 0 },
    ],
  });
  const city = mapFromCollisionRows({
    id: "MAP_MEDICINE_LOCAL_CITY",
    rows: [".....", ".....", "..##.", ".....", "....."],
    connections: [{ direction: "up", map: adjacentRoute.id, offset: 0 }],
    warpEvents: [
      {
        x: 2,
        y: 2,
        dest_map: "MAP_MEDICINE_LOCAL_CITY_POKEMON_CENTER_1F",
        dest_warp_id: "1",
      },
      {
        x: 3,
        y: 2,
        dest_map: "MAP_MEDICINE_LOCAL_CITY_MART",
        dest_warp_id: "0",
      },
    ],
    behaviors: { "2,2": "MB_WARP_DOOR", "3,2": "MB_WARP_DOOR" },
  });
  const center = mapFromCollisionRows({
    id: "MAP_MEDICINE_LOCAL_CITY_POKEMON_CENTER_1F",
    rows: [".....", ".....", ".....", ".....", "....."],
    warpEvents: [
      { x: 1, y: 4, dest_map: city.id, dest_warp_id: "0" },
      { x: 2, y: 4, dest_map: city.id, dest_warp_id: "0" },
      { x: 3, y: 4, dest_map: city.id, dest_warp_id: "0" },
    ],
    objectEvents: [{
      x: 2,
      y: 1,
      local_id: "LOCALID_MEDICINE_LOCAL_CITY_NURSE",
      script: "MedicineLocalCity_PokemonCenter_1F_EventScript_Nurse",
    }],
    behaviors: { "2,4": "MB_SOUTH_ARROW_WARP" },
  });
  const mart = mapFromCollisionRows({
    id: "MAP_MEDICINE_LOCAL_CITY_MART",
    rows: [".....", ".....", ".....", ".....", "....."],
    warpEvents: [{ x: 2, y: 4, dest_map: city.id, dest_warp_id: "1" }],
    behaviors: { "2,4": "MB_SOUTH_ARROW_WARP" },
  });
  const storyObjective = {
    id: "next-boss",
    target: { kind: "trigger", map: "MAP_NEXT_BOSS", index: 0 },
    importantBattle: true,
  };
  const campaignPlanner = {
    select: () => storyObjective,
    selectTraining: () => ({
      id: "train-team-anchor",
      target: { kind: "encounter-zone", map: remoteRoute.id },
      forObjective: storyObjective.id,
      trainingSource: "wild",
      trainingMethod: "direct",
      trainingPartySlot: 0,
      trainingSpecies: 22,
    }),
  };
  const world = { maps: [remoteRoute, adjacentRoute, city, center, mart] };
  const recommendAt = (map, { hp = 30, status1 = 0, items = [
    { itemId: 22, quantity: 1 },
  ] } = {}) => {
    const observed = observation({
      emulator: { mode: "overworld" },
      playerMemory: {
        map: { id: map.id },
        position: { x: 2, y: 3 },
        trainer: {
          partyCount: 1,
          usablePartyCount: 1,
          party: [{
            slot: 0,
            species: 22,
            level: 27,
            hp,
            maxHp: 73,
            status1,
            moves: [64],
            pp: [28],
          }],
          bag: { items },
        },
      },
    });
    return createPolicyAdvisors({ mechanics, world, campaignPlanner })
      .find(({ id }) => id === "inventory")?.advise(observed)?.recommendation;
  };

  for (const map of [mart, city, adjacentRoute]) {
    const recommendation = recommendAt(map);
    assert.equal(recommendation?.objective, "recover-training-party");
    assert.equal(recommendation?.targetMap, center.id);
    assert.notEqual(recommendation?.kind, "open-start-menu");
  }

  const statusRecommendation = recommendAt(mart, {
    hp: 73,
    status1: 64,
    items: [{ itemId: 14, quantity: 1 }],
  });
  assert.equal(statusRecommendation?.objective, "recover-training-party");
  assert.equal(statusRecommendation?.targetMap, center.id);
  assert.notEqual(statusRecommendation?.kind, "open-start-menu");
});

test("a source-derived S.S. Anne healer preserves medicine on the same map", () => {
  const cabin = mapFromCollisionRows({
    id: "MAP_SS_ANNE_1F_ROOM6",
    rows: [".....", ".....", ".....", ".....", "....."],
    objectEvents: [
      {
        x: 3,
        y: 2,
        script: "SSAnne_1F_Room6_EventScript_Woman",
      },
      { x: 4, y: 1, script: "SSAnne_1F_Room6_EventScript_Goal" },
    ],
  });
  const world = { maps: [cabin] };
  const story = { data: { scripts: [{
    label: "SSAnne_1F_Room6_EventScript_Woman",
    instructions: [
      { op: "msgbox", args: ["rest", "MSGBOX_YESNO"] },
      { op: "call", args: ["EventScript_OutOfCenterPartyHeal"] },
    ],
  }] } };
  const campaignPlanner = createCampaignPlanner({
    campaign: { objectives: [{
      id: "continue-voyage",
      target: { kind: "object", map: cabin.id, index: 1 },
      completion: { kind: "flag-set", id: 9998 },
    }] },
    world,
    story,
    mechanics,
  });
  const observed = observation({
    playerMemory: {
      map: { id: cabin.id },
      position: { x: 1, y: 2 },
      storyState: { flagIds: { 9998: false } },
      trainer: {
        partyCount: 1,
        usablePartyCount: 1,
        party: [{
          slot: 0,
          species: 6,
          level: 30,
          hp: 20,
          maxHp: 100,
          moves: [53],
          pp: [10],
        }],
        bag: { items: [{ itemId: 13, quantity: 4 }] },
      },
    },
  });

  const advice = createPolicyAdvisors({
    mechanics,
    world,
    campaignPlanner,
  }).find(({ id }) => id === "inventory").advise(observed);

  assert.equal(advice?.recommendation.kind, "move-toward");
  assert.equal(advice?.recommendation.targetMap, cabin.id);
  assert.deepEqual(advice?.recommendation.target, {
    kind: "object",
    index: 0,
    x: 3,
    y: 2,
    localId: null,
    script: "SSAnne_1F_Room6_EventScript_Woman",
  });
  assert.ok(advice?.constraints.includes("nearby-free-healer"));
  assert.ok(advice?.constraints.includes("preserve-field-medicine"));
});

test("owned medicine remains the recovery fallback beyond the local healer range", () => {
  const remoteRoute = mapFromCollisionRows({
    id: "MAP_REMOTE_MEDICINE_ROUTE",
    rows: [".....", ".....", ".....", ".....", "....."],
    connections: [{ direction: "down", map: "MAP_REMOTE_MEDICINE_LINK", offset: 0 }],
  });
  const linkRoute = mapFromCollisionRows({
    id: "MAP_REMOTE_MEDICINE_LINK",
    rows: [".....", ".....", ".....", ".....", "....."],
    connections: [
      { direction: "up", map: remoteRoute.id, offset: 0 },
      { direction: "down", map: "MAP_REMOTE_MEDICINE_CITY", offset: 0 },
    ],
  });
  const city = mapFromCollisionRows({
    id: "MAP_REMOTE_MEDICINE_CITY",
    rows: [".....", ".....", "..#..", ".....", "....."],
    connections: [{ direction: "up", map: linkRoute.id, offset: 0 }],
    warpEvents: [{
      x: 2,
      y: 2,
      dest_map: "MAP_REMOTE_MEDICINE_CITY_POKEMON_CENTER_1F",
      dest_warp_id: "1",
    }],
    behaviors: { "2,2": "MB_WARP_DOOR" },
  });
  const center = mapFromCollisionRows({
    id: "MAP_REMOTE_MEDICINE_CITY_POKEMON_CENTER_1F",
    rows: [".....", ".....", ".....", ".....", "....."],
    warpEvents: [
      { x: 1, y: 4, dest_map: city.id, dest_warp_id: "0" },
      { x: 2, y: 4, dest_map: city.id, dest_warp_id: "0" },
      { x: 3, y: 4, dest_map: city.id, dest_warp_id: "0" },
    ],
    objectEvents: [{
      x: 2,
      y: 1,
      script: "RemoteMedicineCity_PokemonCenter_1F_EventScript_Nurse",
    }],
    behaviors: { "2,4": "MB_SOUTH_ARROW_WARP" },
  });
  const storyObjective = {
    id: "next-boss",
    target: { kind: "trigger", map: "MAP_NEXT_BOSS", index: 0 },
    importantBattle: true,
  };
  const campaignPlanner = {
    select: () => storyObjective,
    selectTraining: () => ({
      id: "train-team-anchor",
      target: { kind: "encounter-zone", map: remoteRoute.id },
      forObjective: storyObjective.id,
      trainingSource: "wild",
      trainingMethod: "direct",
      trainingPartySlot: 0,
      trainingSpecies: 22,
    }),
  };
  const observed = observation({
    emulator: { mode: "overworld" },
    playerMemory: {
      map: { id: remoteRoute.id },
      position: { x: 2, y: 2 },
      trainer: {
        partyCount: 1,
        usablePartyCount: 1,
        party: [{
          slot: 0,
          species: 22,
          level: 27,
          hp: 30,
          maxHp: 73,
          status1: 0,
          moves: [64],
          pp: [28],
        }],
        bag: { items: [{ itemId: 22, quantity: 1 }] },
      },
    },
  });

  const recommendation = createPolicyAdvisors({
    mechanics,
    world: { maps: [remoteRoute, linkRoute, city, center] },
    campaignPlanner,
  }).find(({ id }) => id === "inventory")?.advise(observed)?.recommendation;

  assert.deepEqual(recommendation, {
    kind: "open-start-menu",
    objective: "recover-training-party-with-items",
  });
});

test("owned field medicine replaces a healing backtrack during boss preparation", () => {
  const trainingMap = mapFromCollisionRows({
    id: "MAP_MEDICINE_TRAINING",
    rows: [".....", ".....", "....."],
  });
  const city = mapFromCollisionRows({
    id: "MAP_MEDICINE_CITY",
    rows: [".....", ".....", "....."],
  });
  const storyObjective = {
    id: "next-boss",
    target: { kind: "trigger", map: "MAP_NEXT_BOSS", index: 0 },
    importantBattle: true,
  };
  const campaignPlanner = {
    select: () => storyObjective,
    selectTraining: () => ({
      id: "train-team-anchor",
      target: { kind: "encounter-zone", map: trainingMap.id },
      forObjective: storyObjective.id,
      trainingSource: "wild",
      trainingMethod: "direct",
      trainingPartySlot: 0,
      trainingSpecies: 22,
    }),
  };
  const observed = observation({
    emulator: { mode: "overworld" },
    playerMemory: {
      map: { id: city.id },
      position: { x: 1, y: 1 },
      trainer: {
        partyCount: 1,
        usablePartyCount: 1,
        party: [{
          slot: 0,
          species: 22,
          level: 27,
          hp: 30,
          maxHp: 73,
          status1: 0,
          moves: [64],
          pp: [28],
        }],
        bag: { items: [{ itemId: 22, quantity: 1 }] },
      },
    },
  });

  const advice = createPolicyAdvisors({
    mechanics,
    world: { maps: [trainingMap, city] },
    campaignPlanner,
  }).find(({ id }) => id === "inventory")?.advise(observed);

  assert.deepEqual(advice?.recommendation, {
    kind: "open-start-menu",
    objective: "recover-training-party-with-items",
  });

  const fullRestoreObserved = structuredClone(observed);
  fullRestoreObserved.emulator.mode = "bag";
  fullRestoreObserved.playerMemory.trainer.bag.items = [{
    itemId: 19,
    quantity: 1,
  }];
  fullRestoreObserved.playerMemory.ui = {
    bag: { stage: "context", selectedItemId: 19 },
  };
  const fullRestoreAdvice = createPolicyAdvisors({
    mechanics,
    world: { maps: [trainingMap, city] },
    campaignPlanner,
  }).find(({ id }) => id === "inventory")?.advise(fullRestoreObserved);
  assert.deepEqual(fullRestoreAdvice?.recommendation, {
    kind: "choose-bag-context-action",
    targetAction: "use",
    targetIndex: 0,
    objective: "recover-training-party-with-items",
  });

  const curedWithStatusItemUnderCursor = structuredClone(observed);
  curedWithStatusItemUnderCursor.emulator.mode = "bag";
  curedWithStatusItemUnderCursor.playerMemory.trainer.bag.items = [
    { itemId: 18, quantity: 1 },
    { itemId: 22, quantity: 1 },
  ];
  curedWithStatusItemUnderCursor.playerMemory.ui = {
    bag: {
      stage: "list",
      pocket: 0,
      index: 0,
      selectedItemId: 18,
    },
  };
  const nextMedicineAdvice = createPolicyAdvisors({
    mechanics,
    world: { maps: [trainingMap, city] },
    campaignPlanner,
  }).find(({ id }) => id === "inventory")?.advise(
    curedWithStatusItemUnderCursor,
  );
  assert.deepEqual(nextMedicineAdvice?.recommendation, {
    kind: "choose-bag-item",
    targetItemId: 22,
    targetIndex: 1,
    objective: "recover-training-party-with-items",
  });
});

test("training status recovery persists after leaving the training map", () => {
  const trainingMap = mapFromCollisionRows({
    id: "MAP_STATUS_TRAINING",
    rows: [".....", ".....", ".....", ".....", "....."],
    connections: [{ direction: "down", map: "MAP_STATUS_CITY", offset: 0 }],
  });
  const city = mapFromCollisionRows({
    id: "MAP_STATUS_CITY",
    rows: [".....", ".....", "..#..", ".....", "....."],
    connections: [{ direction: "up", map: trainingMap.id, offset: 0 }],
    warpEvents: [{
      x: 2,
      y: 2,
      dest_map: "MAP_STATUS_CITY_POKEMON_CENTER_1F",
      dest_warp_id: "1",
    }],
    behaviors: { "2,2": "MB_WARP_DOOR" },
  });
  const center = mapFromCollisionRows({
    id: "MAP_STATUS_CITY_POKEMON_CENTER_1F",
    rows: [".....", ".....", ".....", ".....", "....."],
    warpEvents: [
      { x: 1, y: 4, dest_map: city.id, dest_warp_id: "0" },
      { x: 2, y: 4, dest_map: city.id, dest_warp_id: "0" },
      { x: 3, y: 4, dest_map: city.id, dest_warp_id: "0" },
    ],
    objectEvents: [{
      x: 2,
      y: 1,
      local_id: "LOCALID_STATUS_CITY_NURSE",
      script: "StatusCity_PokemonCenter_1F_EventScript_Nurse",
    }],
    behaviors: { "2,4": "MB_SOUTH_ARROW_WARP" },
  });
  const storyObjective = {
    id: "badge-next",
    target: { kind: "object", map: "MAP_NEXT_GYM", index: 0 },
    importantBattle: true,
  };
  const campaignPlanner = {
    select: () => storyObjective,
    selectTraining: () => ({
      id: "train-battle-member",
      target: { kind: "encounter-zone", map: trainingMap.id },
      forObjective: storyObjective.id,
      trainingSource: "wild",
      trainingMethod: "direct",
      trainingPartySlot: 0,
      trainingSpecies: 22,
    }),
  };
  const party = [{
    slot: 0,
    species: 22,
    level: 27,
    hp: 66,
    maxHp: 73,
    status1: 64,
    moves: [64],
    pp: [28],
  }];
  const adviseAt = (map, position, currentParty = party) => {
    const observed = observation({
      playerMemory: {
        map: { id: map.id },
        position,
        trainer: {
          partyCount: currentParty.length,
          usablePartyCount: 1,
          party: currentParty,
          bag: { items: [] },
        },
      },
    });
    return createPolicyAdvisors({
      mechanics,
      world: { maps: [trainingMap, city, center] },
      campaignPlanner,
    }).find(({ id }) => id === "inventory")?.advise(observed) ?? null;
  };

  const cityAdvice = adviseAt(city, { x: 2, y: 3 });
  assert.equal(cityAdvice?.recommendation?.objective, "recover-training-party");
  assert.equal(
    cityAdvice?.recommendation?.targetMap,
    "MAP_STATUS_CITY_POKEMON_CENTER_1F",
  );

  const centerAdvice = adviseAt(center, { x: 2, y: 4 });
  assert.equal(centerAdvice?.recommendation?.objective, "recover-training-party");
  assert.equal(
    centerAdvice?.recommendation?.targetMap,
    "MAP_STATUS_CITY_POKEMON_CENTER_1F",
  );

  const recoveredAdvice = adviseAt(
    center,
    { x: 2, y: 2 },
    [{ ...party[0], hp: 73, status1: 0 }],
  );
  assert.notEqual(
    recoveredAdvice?.recommendation?.objective,
    "recover-training-party",
  );
});

test("passive story training makes the surplus member the field lead immediately", () => {
  const map = mapFromCollisionRows({
    id: "MAP_STORY_ROUTE",
    rows: [".....", ".....", "....."],
  });
  const storyObjective = {
    id: "badge-soul",
    target: { kind: "object", map: "MAP_FUCHSIA_CITY_GYM", index: 0 },
    importantBattle: true,
  };
  const campaignPlanner = {
    select: () => storyObjective,
    selectTraining: () => ({
      id: "train-battle-member-through-story",
      trainingMode: "passive",
      trainingSource: "story",
      target: storyObjective.target,
      forObjective: storyObjective.id,
      trainingMethod: "switch",
      trainingPartySlot: 1,
      trainingSpecies: 123,
      currentTeamAnchorLevel: 28,
      minimumTeamAnchorLevel: 43,
    }),
  };
  const observed = observation({
    emulator: { mode: "overworld" },
    playerMemory: {
      map: { id: map.id },
      position: { x: 1, y: 1 },
      trainer: {
        partyCount: 2,
        usablePartyCount: 2,
        party: [
          { slot: 0, species: 6, level: 58, hp: 171, maxHp: 171 },
          { slot: 1, species: 123, level: 28, hp: 78, maxHp: 78 },
        ],
      },
      ui: {},
    },
  });

  const advice = createPolicyAdvisors({
    mechanics,
    world: { maps: [map] },
    campaignPlanner,
  }).flatMap((advisor) => advisor.advise(observed) ?? [])
    .find(({ advisor }) => advisor === "inventory");
  const recommendation = advice?.recommendation;

  assert.deepEqual(recommendation, {
    kind: "open-start-menu",
    objective: "lead-with-training-member",
  });
  assert.ok(advice?.constraints.includes("story-progress-training"));
});

test("the central player resolves overworld transport conflicts by policy confidence", () => {
  const observed = observation();
  const advisor = ({ id, advisor, recommendation, confidence, constraints = [] }) => ({
    id,
    advise() {
      return {
        advisor,
        observationId: observed.captureId,
        recommendation,
        confidence,
        constraints,
        vetoes: [],
        evidenceRefs: [`test:${id}`],
      };
    },
  });
  const player = createCentralPlayer({
    advisors: [
      advisor({
        id: "badge-route",
        advisor: "navigation",
        recommendation: {
          kind: "traverse-directional-warp",
          direction: "south",
          objective: "badge-boulder",
        },
        confidence: 0.96,
      }),
      advisor({
        id: "critical-recovery",
        advisor: "inventory",
        recommendation: {
          kind: "move-toward",
          direction: "north",
          objective: "recover-party",
        },
        confidence: 0.99,
        constraints: ["critical-party-health"],
      }),
    ],
  });

  const decision = player.decide(observed);

  assert.equal(decision.winner.advisor, "inventory");
  assert.equal(decision.winner.recommendation.objective, "recover-party");
  assert.deepEqual(decision.action.buttons, ["up"]);
});

test("a blocking cartridge prompt is acknowledged before opening the Start menu", () => {
  const observed = observation({
    playerMemory: {
      scripts: {
        globalStatus: "running",
        globalMode: "native",
        globalNative: "WaitForAorBPress",
        fieldControlsLocked: true,
      },
      ui: {
        fieldDialog: {
          type: "hidden",
          stage: "awaiting-close",
          textPrinter: { active: false, state: 0, stateName: "handle-character" },
        },
      },
    },
  });
  const advisor = ({ id, recommendation, confidence }) => ({
    id,
    advise() {
      return {
        advisor: id,
        observationId: observed.captureId,
        recommendation,
        confidence,
        constraints: [],
        vetoes: [],
        evidenceRefs: [`test:${id}`],
      };
    },
  });
  const player = createCentralPlayer({
    advisors: [
      advisor({
        id: "quest",
        recommendation: { kind: "acknowledge-cartridge-prompt" },
        confidence: 0.98,
      }),
      advisor({
        id: "inventory",
        recommendation: {
          kind: "open-start-menu",
          objective: "lead-with-training-member",
        },
        confidence: 0.998,
      }),
    ],
  });

  const decision = player.decide(observed);

  assert.equal(decision.winner.advisor, "quest");
  assert.deepEqual(decision.winner.recommendation, {
    kind: "acknowledge-cartridge-prompt",
  });
  assert.deepEqual(decision.action.buttons, ["a"]);
});

test("navigation derives the first step on both floors from cartridge collision and warps", () => {
  const advisors = createPolicyAdvisors({ mechanics, world: playersHouseWorld });
  const navigationAt = (map, position) => {
    const observed = observation({ playerMemory: { map: { id: map }, position } });
    return advisors
      .flatMap((advisor) => advisor.advise(observed) ?? [])
      .find(({ advisor }) => advisor === "navigation");
  };

  const upstairs = navigationAt(
    "MAP_PALLET_TOWN_PLAYERS_HOUSE_2F",
    { x: 6, y: 6 },
  );
  assert.deepEqual(withoutLocomotionMetadata(upstairs.recommendation), {
    kind: "move-toward",
    direction: "east",
    pathSegment: {
      direction: "east",
      steps: 4,
      endpoint: {
        map: "MAP_PALLET_TOWN_PLAYERS_HOUSE_2F",
        x: 10,
        y: 6,
      },
    },
    objective: "leave-players-house",
    targetWarp: {
      x: 10,
      y: 2,
      destinationMap: "MAP_PALLET_TOWN_PLAYERS_HOUSE_1F",
    },
    remainingSteps: 8,
  });
  assert.ok(upstairs.evidenceRefs.includes(
    "cartridge:warp:MAP_PALLET_TOWN_PLAYERS_HOUSE_2F:10,2->MAP_PALLET_TOWN_PLAYERS_HOUSE_1F",
  ));

  const upstairsWarp = navigationAt(
    "MAP_PALLET_TOWN_PLAYERS_HOUSE_2F",
    { x: 10, y: 2 },
  );
  assert.deepEqual(upstairsWarp.recommendation, {
    kind: "traverse-directional-warp",
    direction: "west",
    objective: "leave-players-house",
    targetWarp: {
      x: 10,
      y: 2,
      destinationMap: "MAP_PALLET_TOWN_PLAYERS_HOUSE_1F",
    },
  });

  const downstairs = navigationAt(
    "MAP_PALLET_TOWN_PLAYERS_HOUSE_1F",
    { x: 10, y: 2 },
  );
  assert.equal(downstairs.recommendation.kind, "move-toward");
  assert.equal(downstairs.recommendation.direction, "south");
  assert.equal(downstairs.recommendation.objective, "leave-players-house");
  assert.deepEqual(
    { x: downstairs.recommendation.targetWarp.x, y: downstairs.recommendation.targetWarp.y },
    { x: 4, y: 8 },
  );
  assert.equal(downstairs.recommendation.targetWarp.destinationMap, "MAP_PALLET_TOWN");

  const exitWarp = navigationAt(
    "MAP_PALLET_TOWN_PLAYERS_HOUSE_1F",
    { x: 4, y: 8 },
  );
  assert.equal(exitWarp.recommendation.kind, "traverse-directional-warp");
  assert.equal(exitWarp.recommendation.direction, "south");
});

test("opening navigation serializes the complete route across the current area", () => {
  const observed = observation({
    playerMemory: {
      map: { id: "MAP_PALLET_TOWN_PLAYERS_HOUSE_2F" },
      position: { x: 6, y: 6 },
    },
  });
  const navigation = createPolicyAdvisors({ mechanics, world: playersHouseWorld })
    .flatMap((advisor) => advisor.advise(observed) ?? [])
    .find(({ advisor }) => advisor === "navigation");

  const { mapRevision, ...routePlan } = navigation.recommendation.routePlan;
  assert.match(mapRevision, /^[0-9a-f]{64}$/);
  assert.deepEqual(routePlan, {
    map: "MAP_PALLET_TOWN_PLAYERS_HOUSE_2F",
    origin: { x: 6, y: 6 },
    destination: { x: 10, y: 2 },
    steps: 8,
    segments: [
      { direction: "east", steps: 4, endpoint: { x: 10, y: 6 } },
      { direction: "north", steps: 4, endpoint: { x: 10, y: 2 } },
    ],
  });
  assert.ok(navigation.constraints.includes("preplanned-current-area-route"));
  assert.ok(navigation.constraints.includes("exact-waypoints-then-reobserve"));
  assert.equal(
    navigation.constraints.includes("one-bounded-step-then-reobserve"),
    false,
  );
});

test("opening route revisions cover the complete live current-area grid", () => {
  const map = playersHouseWorld.maps.find(
    ({ id }) => id === "MAP_PALLET_TOWN_PLAYERS_HOUSE_2F",
  );
  const observed = observation({
    playerMemory: {
      map: { id: map.id },
      mapGrid: {
        width: map.layout.width,
        height: map.layout.height,
        cells: map.layout.cells.map((cell) => ({ ...cell })),
      },
      position: { x: 6, y: 6 },
    },
  });
  const routeRevision = () => createPolicyAdvisors({
    mechanics,
    world: playersHouseWorld,
  }).flatMap((advisor) => advisor.advise(observed) ?? [])
    .find(({ advisor }) => advisor === "navigation")
    .recommendation.routePlan.mapRevision;

  const before = routeRevision();
  observed.playerMemory.mapGrid.cells = observed.playerMemory.mapGrid.cells.map(
    (cell) => cell.x === 2 && cell.y === 2
      ? { ...cell, collision: 1 }
      : cell,
  );
  const after = routeRevision();

  assert.match(before, /^[0-9a-f]{64}$/);
  assert.match(after, /^[0-9a-f]{64}$/);
  assert.notEqual(after, before);
});

test("navigation routes to Oak's scene-gated coordinate event, not the nearby sign trigger", () => {
  const observed = observation({
    playerMemory: {
      map: { id: "MAP_PALLET_TOWN" },
      position: { x: 6, y: 8 },
    },
  });
  const navigation = createPolicyAdvisors({ mechanics, world: playersHouseWorld })
    .flatMap((advisor) => advisor.advise(observed) ?? [])
    .find(({ advisor }) => advisor === "navigation");

  assert.deepEqual(withoutLocomotionMetadata(navigation.recommendation), {
    kind: "move-toward",
    direction: "south",
    objective: "meet-professor-oak",
    targetEvent: {
      x: 12,
      y: 1,
      script: "PalletTown_EventScript_OakTriggerLeft",
      condition: {
        variable: "VAR_MAP_SCENE_PALLET_TOWN_OAK",
        value: "0",
      },
    },
    remainingSteps: 15,
  });
  assert.ok(navigation.evidenceRefs.includes(
    "cartridge:coord-event:MAP_PALLET_TOWN:12,1:PalletTown_EventScript_OakTriggerLeft",
  ));
});

test("navigation ignores Oak's completed Pallet trigger and continues the campaign", () => {
  const observed = observation({
    playerMemory: {
      map: { id: "MAP_PALLET_TOWN" },
      position: { x: 12, y: 3 },
      trainer: {
        partyCount: 1,
        usablePartyCount: 1,
        party: [{ slot: 0, species: 1, hp: 21, maxHp: 21 }],
      },
      storyState: {
        variables: { VAR_MAP_SCENE_PALLET_TOWN_OAK: 1 },
        flags: {},
        variableIds: {},
        flagIds: {},
      },
    },
  });
  const navigation = createPolicyAdvisors({ mechanics, world: playersHouseWorld })
    .flatMap((advisor) => advisor.advise(observed) ?? [])
    .find(({ advisor }) => advisor === "navigation");

  assert.equal(navigation.recommendation.objective, "oak-parcel");
  assert.deepEqual(navigation.recommendation.transit, {
    kind: "connection",
    destinationMap: "MAP_ROUTE1",
    direction: "north",
  });
});

test("lab navigation approaches the cartridge object for the configured starter", () => {
  const observed = observation({
    playerMemory: {
      map: { id: "MAP_PALLET_TOWN_PROFESSOR_OAKS_LAB" },
      position: { x: 6, y: 4 },
      avatar: { facing: "north" },
      trainer: { partyCount: 0, usablePartyCount: 0, party: [] },
      storyState: {
        variables: {
          VAR_MAP_SCENE_PALLET_TOWN_PROFESSOR_OAKS_LAB: 2,
        },
        flags: {},
      },
    },
  });
  const navigation = createPolicyAdvisors({ mechanics, world: playersHouseWorld })
    .flatMap((advisor) => advisor.advise(observed) ?? [])
    .find(({ advisor }) => advisor === "navigation");

  assert.deepEqual(withoutLocomotionMetadata(navigation.recommendation), {
    kind: "move-toward",
    direction: "east",
    objective: "choose-bulbasaur",
    targetObject: {
      x: 8,
      y: 4,
      localId: "LOCALID_BULBASAUR_BALL",
      script: "PalletTown_ProfessorOaksLab_EventScript_BulbasaurBall",
    },
    remainingSteps: 1,
  });
});

test("the opening policy follows the seeded gender and official preset names", () => {
  const runProfile = createRunProfile(53);
  assert.deepEqual({
    gender: runProfile.gender,
    starter: runProfile.starter.name,
    playerName: runProfile.playerName,
    rivalName: runProfile.rivalName,
  }, {
    gender: "GIRL",
    starter: "SQUIRTLE",
    playerName: "OMI",
    rivalName: "KAZ",
  });

  const recommendationAt = (newGame) => {
    const observed = observation({
      emulator: { mode: "boot", callback2: "CB2_NewGameScene" },
      playerMemory: { ui: { newGame } },
    });
    return createPolicyAdvisors({ mechanics, runProfile })
      .flatMap((advisor) => advisor.advise(observed) ?? [])
      .find(({ advisor }) => advisor === "quest")?.recommendation;
  };

  const gender = recommendationAt({ stage: "choose-gender", cursor: 0 });
  assert.deepEqual(gender, {
    kind: "choose-new-game-option",
    targetIndex: 1,
    targetValue: "GIRL",
    objective: "choose-player-gender",
  });
  assert.deepEqual(
    mapRecommendation(gender, observation({
      playerMemory: { ui: { newGame: { stage: "choose-gender", cursor: 0 } } },
    })).buttons,
    ["down"],
  );

  const rival = recommendationAt({
    stage: "choose-rival-name",
    cursor: 0,
  });
  assert.equal(rival.targetIndex, 3);
  assert.equal(rival.targetValue, "KAZ");
  assert.notEqual(rival.targetIndex, 0);
});

test("the player naming keyboard enters only the selected official preset", () => {
  const runProfile = createRunProfile(53);
  const namingObservation = ({ text = "", page = 1, x = 0, y = 0, state = 2 }) =>
    observation({
      emulator: { mode: "boot", callback2: "CB2_NamingScreen" },
      playerMemory: {
        ui: {
          naming: {
            stage: "enter-player-preset",
            subject: "player",
            template: 0,
            state,
            inputReady: state === 2,
            text,
            page,
            cursor: { x, y },
          },
        },
      },
    });
  const observed = namingObservation({ text: "", x: 2, y: 2 });
  const quest = createPolicyAdvisors({ mechanics, runProfile })
    .flatMap((advisor) => advisor.advise(observed) ?? [])
    .find(({ advisor }) => advisor === "quest");

  assert.deepEqual(quest.recommendation, {
    kind: "enter-naming-screen-text",
    subject: "player",
    targetText: "OMI",
    objective: "enter-official-player-preset",
  });
  assert.deepEqual(mapRecommendation(quest.recommendation, observed).buttons, ["a"]);
  assert.deepEqual(
    mapRecommendation(
      quest.recommendation,
      namingObservation({ text: "O", x: 2, y: 2 }),
    ).buttons,
    ["left"],
  );
  assert.deepEqual(
    mapRecommendation(
      quest.recommendation,
      namingObservation({ text: "OMI", x: 2, y: 2 }),
    ).buttons,
    ["start"],
  );
  assert.deepEqual(
    mapRecommendation(
      quest.recommendation,
      namingObservation({ text: "OMI", x: 8, y: 2 }),
    ).buttons,
    ["a"],
  );
  assert.deepEqual(
    mapRecommendation(
      quest.recommendation,
      namingObservation({ text: "OMX", x: 4, y: 3 }),
    ).buttons,
    ["b"],
  );
  assert.deepEqual(
    mapRecommendation(
      quest.recommendation,
      namingObservation({ text: "", page: 2 }),
    ).buttons,
    ["select"],
  );
  assert.deepEqual(
    mapRecommendation(
      quest.recommendation,
      namingObservation({ text: "", state: 1 }),
    ).buttons,
    [],
  );
});

test("a nonblank Pokemon naming screen is fail-closed instead of typing A", () => {
  const observed = observation({
    emulator: { mode: "boot", callback2: "CB2_NamingScreen" },
    playerMemory: {
      ui: {
        newGame: null,
        naming: {
          stage: "nickname",
          subject: "pokemon",
          template: 2,
          state: 2,
          inputReady: true,
          text: "A",
          textIsBlank: false,
          page: 1,
          cursor: { x: 0, y: 0 },
        },
      },
    },
  });
  const quest = createPolicyAdvisors({ mechanics, runProfile: createRunProfile(0) })
    .flatMap((advisor) => advisor.advise(observed) ?? [])
    .find(({ advisor }) => advisor === "quest");

  assert.deepEqual(quest.recommendation, {
    kind: "withhold-unsafe-decision",
    reason: "unexpected-custom-naming-screen",
  });
  assert.deepEqual(mapRecommendation(quest.recommendation, observed).buttons, []);
});

test("an accidentally opened empty Pokemon naming keyboard preserves the species name", () => {
  for (const template of [2, 3]) for (const page of [0, 1, 2]) {
    const observed = observation({
      emulator: { mode: "boot", callback2: "CB2_NamingScreen" },
      playerMemory: { ui: { naming: {
        stage: "nickname", subject: "pokemon", template, state: 2,
        inputReady: true, text: "", textIsBlank: true, page,
        cursor: { x: 0, y: 0 },
      } } },
    });
    const recommendation = createPolicyAdvisors({ mechanics })
      .flatMap((advisor) => advisor.advise(observed) ?? [])
      .find(({ advisor }) => advisor === "quest")?.recommendation;
    assert.deepEqual(recommendation, {
      kind: "keep-pokemon-species-name", objective: "recover-empty-pokemon-nickname",
    });
    assert.deepEqual(mapRecommendation(recommendation, observed).buttons, ["start"]);
    observed.playerMemory.ui.naming.cursor = { x: page === 0 ? 6 : 8, y: 2 };
    assert.deepEqual(mapRecommendation(recommendation, observed).buttons, ["a"]);
    for (const patch of [
      { state: 1 }, { inputReady: false }, { textIsBlank: false },
      { textIsBlank: undefined }, { subject: "box", template: 1 },
      { subject: "rival", template: 4 }, { page: 3 }, { cursor: { x: 99, y: 2 } },
    ]) {
      const unsafe = observation({ emulator: observed.emulator, playerMemory: {
        ui: { naming: { ...observed.playerMemory.ui.naming, ...patch } },
      } });
      assert.deepEqual(mapRecommendation(recommendation, unsafe).buttons, [], JSON.stringify(patch));
    }
  }
});

test("the configured starter object and confirmation follow the run profile", () => {
  const runProfile = createRunProfile(53);
  const observed = observation({
    playerMemory: {
      map: { id: "MAP_PALLET_TOWN_PROFESSOR_OAKS_LAB" },
      position: { x: 6, y: 4 },
      avatar: { facing: "north" },
      trainer: { partyCount: 0, usablePartyCount: 0, party: [] },
      storyState: {
        variables: {
          VAR_MAP_SCENE_PALLET_TOWN_PROFESSOR_OAKS_LAB: 2,
        },
        flags: {},
      },
    },
  });
  const recommendations = () => createPolicyAdvisors({
    mechanics,
    world: playersHouseWorld,
    runProfile,
  }).flatMap((advisor) => advisor.advise(observed) ?? []);

  assert.deepEqual(
    withoutLocomotionMetadata(
      recommendations().find(({ advisor }) => advisor === "navigation").recommendation,
    ),
    {
      kind: "move-toward",
      direction: "south",
      objective: "choose-squirtle",
      targetObject: {
        x: 9,
        y: 4,
        localId: "LOCALID_SQUIRTLE_BALL",
        script: "PalletTown_ProfessorOaksLab_EventScript_SquirtleBall",
      },
      remainingSteps: 4,
    },
  );

  observed.playerMemory.ui = {
    choiceMenu: { cursor: 0, selected: "yes" },
    fieldDialog: { stage: "awaiting-input" },
  };
  assert.deepEqual(
    recommendations().find(({ advisor }) => advisor === "quest").recommendation,
    {
      kind: "choose-menu-option",
      targetOption: "yes",
      objective: "confirm-squirtle",
    },
  );
});

test("the delegator faces a starter object before interacting with it", () => {
  const recommendation = {
    kind: "interact-with-object",
    direction: "east",
    objective: "choose-bulbasaur",
  };
  const face = mapRecommendation(
    recommendation,
    observation({ playerMemory: { avatar: { facing: "north" } } }),
  );
  assert.deepEqual(
    { buttons: face.buttons, reason: face.reason },
    { buttons: ["right"], reason: "face-object" },
  );
  const interact = mapRecommendation(
    recommendation,
    observation({ playerMemory: { avatar: { facing: "east" } } }),
  );
  assert.deepEqual(
    { buttons: interact.buttons, reason: interact.reason },
    { buttons: ["a"], reason: "interact-with-object" },
  );
});

test("the quest policy confirms the starter while the party is empty", () => {
  const observed = observation({
    playerMemory: {
      map: { id: "MAP_PALLET_TOWN_PROFESSOR_OAKS_LAB" },
      trainer: { partyCount: 0, usablePartyCount: 0, party: [] },
      storyState: {
        variables: {
          VAR_MAP_SCENE_PALLET_TOWN_PROFESSOR_OAKS_LAB: 2,
        },
        flags: {},
      },
      ui: {
        fieldDialog: { stage: "awaiting-input" },
        choiceMenu: { cursor: 0, selected: "yes" },
      },
    },
  });
  const quest = createPolicyAdvisors({ mechanics, world: playersHouseWorld })
    .flatMap((advisor) => advisor.advise(observed) ?? [])
    .find(({ advisor }) => advisor === "quest");

  assert.deepEqual(quest.recommendation, {
    kind: "choose-menu-option",
    targetOption: "yes",
    objective: "confirm-bulbasaur",
  });
});

test("the quest policy declines the nickname after the starter joins the party", () => {
  const observed = observation({
    playerMemory: {
      map: { id: "MAP_PALLET_TOWN_PROFESSOR_OAKS_LAB" },
      trainer: {
        partyCount: 1,
        usablePartyCount: 1,
        party: [{ slot: 0, species: 1, hp: 20, maxHp: 20 }],
      },
      storyState: {
        variables: {
          VAR_MAP_SCENE_PALLET_TOWN_PROFESSOR_OAKS_LAB: 2,
        },
        flags: {},
      },
      ui: {
        fieldDialog: { stage: "awaiting-input" },
        choiceMenu: { cursor: 0, selected: "yes" },
      },
    },
  });
  const quest = createPolicyAdvisors({ mechanics, world: playersHouseWorld })
    .flatMap((advisor) => advisor.advise(observed) ?? [])
    .find(({ advisor }) => advisor === "quest");

  assert.deepEqual(quest.recommendation, {
    kind: "choose-menu-option",
    targetOption: "no",
    objective: "keep-starter-species-name",
  });
});

test("gift Pokemon nickname prompts are declined even after the campaign advances", () => {
  const teamPlan = createOriginsTeamPlan(7);
  const campaignPlanner = { select: () => ({
    id: "origins-thunder-stone",
    target: { kind: "purchase-items", map: "MAP_CELADON_CITY_DEPARTMENT_STORE_4F" },
  }) };
  const observed = observation({
    playerMemory: {
      map: { id: "MAP_CELADON_CITY_CONDOMINIUMS_ROOF_ROOM" },
      trainer: {
        partyCount: 2,
        usablePartyCount: 2,
        party: [
          { slot: 0, species: 7, hp: 50, maxHp: 50 },
          { slot: 1, species: 133, hp: 60, maxHp: 60 },
        ],
      },
      ui: {
        fieldDialog: { stage: "awaiting-input" },
        choiceMenu: { cursor: 0, selected: "yes" },
      },
    },
  });
  const recommendation = createPolicyAdvisors({
    mechanics,
    campaignPlanner,
    teamPlan,
  }).flatMap((advisor) => advisor.advise(observed) ?? [])
    .find(({ advisor }) => advisor === "quest")?.recommendation;

  assert.deepEqual(recommendation, {
    kind: "choose-menu-option",
    targetOption: "no",
    objective: "keep-gift-species-name",
  });
});

test("master-team Lapras gifts use the no-nickname policy with plural acquisition maps", () => {
  for (const seed of [2026090500, 2026090501, 2026090502, 2026090503]) {
    const teamPlan = createMasterTeamPlan(seed < 2026090502 ? 1 : 4, seed);
    const observed = observation({ playerMemory: {
      map: { id: "MAP_SILPH_CO_7F" },
      trainer: { party: [{ slot: 5, species: 131, hp: 100, maxHp: 100 }] },
      ui: { choiceMenu: { cursor: 0, selected: "yes" } },
    } });
    const recommendation = createPolicyAdvisors({ mechanics, teamPlan,
      campaignPlanner: { select: () => ({ id: "silph-giovanni",
        target: { kind: "interact-object", map: "MAP_SILPH_CO_11F", objectIndex: 1 } }) },
    }).flatMap((advisor) => advisor.advise(observed) ?? [])
      .find(({ advisor }) => advisor === "quest")?.recommendation;
    assert.deepEqual(recommendation, {
      kind: "choose-menu-option", targetOption: "no", objective: "keep-gift-species-name",
    }, String(seed));
    assert.deepEqual(mapRecommendation(recommendation, observed).buttons, ["down"]);
    observed.playerMemory.ui.choiceMenu = { cursor: 1, selected: "no" };
    assert.deepEqual(mapRecommendation(recommendation, observed).buttons, ["a"]);
  }
});

test("cartridge-identified nickname prompts are declined without a matching team or party slot", () => {
  const observed = observation({ playerMemory: {
    map: { id: "MAP_SILPH_CO_7F" },
    trainer: { party: [{ slot: 0, species: 7 }] },
    ui: { choiceMenu: { cursor: 0, selected: "yes", purpose: "pokemon-nickname" } },
  } });
  const recommendation = createPolicyAdvisors({ mechanics, teamPlan: null })
    .flatMap((advisor) => advisor.advise(observed) ?? [])
    .find(({ advisor }) => advisor === "quest")?.recommendation;
  assert.deepEqual(recommendation, {
    kind: "choose-menu-option", targetOption: "no", objective: "keep-pokemon-species-name",
  });
});

test("the team policy evolves Eevee with its purchased Thunder Stone", () => {
  const campaignPlanner = { select: () => ({
    id: "origins-jolteon-evolve",
    target: {
      kind: "evolve-with-item",
      itemId: 96,
      partySpecies: [133],
      targetSpecies: 135,
    },
  }) };
  const recommend = ({ mode = "overworld", ui = {} } = {}) => {
    const observed = observation({
      emulator: { mode },
      playerMemory: {
        trainer: {
          partyCount: 2,
          usablePartyCount: 2,
          party: [
            { slot: 0, species: 7, hp: 50, maxHp: 50 },
            { slot: 1, species: 133, hp: 60, maxHp: 60 },
          ],
          bag: {
            items: [{ itemId: 96, quantity: 1 }],
            keyItems: [],
            pokeBalls: [],
          },
        },
        ui,
      },
    });
    return createPolicyAdvisors({ mechanics, campaignPlanner })
      .flatMap((advisor) => advisor.advise(observed) ?? [])
      .find(({ advisor }) => advisor === "quest")?.recommendation;
  };

  assert.deepEqual(recommend(), {
    kind: "open-start-menu",
    objective: "origins-jolteon-evolve",
  });
  assert.deepEqual(recommend({
    mode: "start-menu",
    ui: { startMenu: { cursor: 0, order: ["pokedex", "pokemon", "bag"] } },
  }), {
    kind: "choose-start-menu-item",
    targetItem: "bag",
    targetIndex: 2,
    objective: "origins-jolteon-evolve",
  });
  assert.deepEqual(recommend({
    mode: "bag",
    ui: { bag: { stage: "list", pocket: 0, index: 0 } },
  }), {
    kind: "choose-bag-item",
    targetItemId: 96,
    targetIndex: 0,
    objective: "origins-jolteon-evolve",
  });
  assert.deepEqual(recommend({
    mode: "bag",
    ui: { bag: { stage: "context", selectedItemId: 96, contextCursor: 0 } },
  }), {
    kind: "choose-bag-context-action",
    targetAction: "use",
    targetIndex: 0,
    objective: "origins-jolteon-evolve",
  });
  assert.deepEqual(recommend({
    mode: "party",
    ui: { party: { stage: "choose-pokemon", cursor: 0 } },
  }), {
    kind: "choose-party-member",
    targetPartySlot: 1,
    targetSpecies: 133,
    objective: "origins-jolteon-evolve",
  });
});

test("the quest policy confirms an explicit campaign choice such as the Mt. Moon fossil", () => {
  const campaignPlanner = {
    select() {
      return {
        id: "mt-moon-fossil",
        target: { kind: "object", map: "MAP_MT_MOON_B2F", index: 1 },
        choice: "yes",
      };
    },
  };
  const observed = observation({
    playerMemory: {
      map: { id: "MAP_MT_MOON_B2F" },
      trainer: {
        partyCount: 1,
        usablePartyCount: 1,
        party: [{ slot: 0, species: 2, hp: 44, maxHp: 61 }],
      },
      ui: {
        fieldDialog: { stage: "awaiting-input" },
        choiceMenu: { cursor: 0, selected: "yes" },
      },
    },
  });

  const quest = createPolicyAdvisors({ mechanics, campaignPlanner })
    .flatMap((advisor) => advisor.advise(observed) ?? [])
    .find(({ advisor }) => advisor === "quest");

  assert.deepEqual(quest.recommendation, {
    kind: "choose-menu-option",
    targetOption: "yes",
    objective: "mt-moon-fossil",
  });
});

test("the quest policy navigates an indexed Rocket Hideout elevator choice", () => {
  const campaignPlanner = {
    select() {
      return {
        id: "rocket-hideout-door-grunt-left",
        target: { kind: "object", map: "MAP_ROCKET_HIDEOUT_B4F", index: 5 },
        choiceIndex: 2,
        choiceMaps: ["MAP_ROCKET_HIDEOUT_ELEVATOR"],
      };
    },
  };
  const observed = observation({
    playerMemory: {
      map: { id: "MAP_ROCKET_HIDEOUT_ELEVATOR" },
      trainer: {
        partyCount: 1,
        usablePartyCount: 1,
        party: [{ slot: 0, species: 2, hp: 44, maxHp: 61 }],
      },
      ui: {
        fieldDialog: { stage: "awaiting-input" },
        choiceMenu: { cursor: 0, maxCursor: 3 },
      },
    },
  });

  const quest = createPolicyAdvisors({ mechanics, campaignPlanner })
    .flatMap((advisor) => advisor.advise(observed) ?? [])
    .find(({ advisor }) => advisor === "quest");

  assert.deepEqual(quest.recommendation, {
    kind: "choose-menu-option",
    targetIndex: 2,
    objective: "rocket-hideout-door-grunt-left",
  });
  assert.deepEqual(
    mapRecommendation(quest.recommendation, observed).buttons,
    ["down"],
  );
  observed.playerMemory.ui.choiceMenu.cursor = 2;
  assert.deepEqual(
    mapRecommendation(quest.recommendation, observed).buttons,
    ["a"],
  );
});

test('a retained Tower mode selects the correct row at each native menu and rejects unknown shapes',()=>{
 const map='MAP_TRAINER_TOWER_LOBBY';
 const campaignPlanner={select:()=>({id:'tower-mode',target:{kind:'walk-to',map,x:9,y:7},choiceByRows:{3:0,5:2}})};
 for(const [rows,expected] of [[3,0],[5,2],[2,null]]){
  const o=observation({playerMemory:{map:{id:map},trainer:{partyCount:1,usablePartyCount:1,party:[{slot:0,species:2,hp:44,maxHp:61}]},ui:{fieldDialog:{stage:'awaiting-input'},choiceMenu:{cursor:0,minCursor:0,maxCursor:rows-1}}}});
  const result=createPolicyAdvisors({mechanics,campaignPlanner}).flatMap(a=>a.advise(o)??[]).find(p=>p.advisor==='quest').recommendation;
  if(expected===null)assert.equal(result.kind,'withhold-unsafe-decision');else assert.equal(result.targetIndex,expected);
 }
});

test("the quest policy selects Silph 1F for an objective outside the building", () => {
  const campaignPlanner = {
    select() {
      return {
        id: "silph-coverage-tm",
        target: {
          kind: "purchase-items",
          map: "MAP_CELADON_CITY_DEPARTMENT_STORE_2F",
          objectIndex: 2,
          items: [{ itemId: 331, stockIndex: 4, quantity: 1 }],
        },
      };
    },
  };
  const observed = observation({
    playerMemory: {
      map: { id: "MAP_SILPH_CO_ELEVATOR" },
      trainer: {
        partyCount: 1,
        usablePartyCount: 1,
        party: [{ slot: 0, species: 2, hp: 44, maxHp: 61 }],
      },
      ui: {
        fieldDialog: { stage: "awaiting-input" },
        choiceMenu: { cursor: 0, maxCursor: 11 },
      },
    },
  });

  const recommend = () => createPolicyAdvisors({ mechanics, campaignPlanner })
    .flatMap((advisor) => advisor.advise(observed) ?? [])
    .find(({ advisor }) => advisor === "quest")?.recommendation;

  assert.deepEqual(recommend(), {
    kind: "choose-menu-option",
    targetIndex: 10,
    objective: "silph-coverage-tm",
  });
  assert.deepEqual(mapRecommendation(recommend(), observed).buttons, ["down"]);
  observed.playerMemory.ui.choiceMenu.cursor = 10;
  assert.deepEqual(mapRecommendation(recommend(), observed).buttons, ["a"]);
});

test("a story choice cannot leak into an unrelated nurse transaction", () => {
  const campaignPlanner = { select: () => ({
    id: "gift-lapras",
    target: { kind: "object", map: "MAP_SILPH_CO_7F", index: 1 },
    choice: "no",
  }) };
  const recommend = (map) => {
    const observed = observation({
      playerMemory: {
        map: { id: map },
        trainer: { partyCount: 1, usablePartyCount: 1,
          party: [{ slot: 0, species: 1, hp: 20, maxHp: 40 }] },
        ui: { choiceMenu: { cursor: 1, selected: "no" } },
      },
    });
    return createPolicyAdvisors({ mechanics, campaignPlanner })
      .flatMap((advisor) => advisor.advise(observed) ?? [])
      .find(({ advisor }) => advisor === "quest")?.recommendation;
  };

  assert.equal(recommend("MAP_PEWTER_CITY_POKEMON_CENTER_1F").targetOption, "yes");
  assert.equal(recommend("MAP_SILPH_CO_7F").targetOption, "no");
});

test("lab scene three routes to the matching rival battle coordinate event", () => {
  const observed = observation({
    playerMemory: {
      map: { id: "MAP_PALLET_TOWN_PROFESSOR_OAKS_LAB" },
      position: { x: 7, y: 4 },
      avatar: { facing: "east" },
      trainer: {
        partyCount: 1,
        usablePartyCount: 1,
        party: [{ slot: 0, species: 1, hp: 20, maxHp: 20 }],
      },
      storyState: {
        variables: {
          VAR_MAP_SCENE_PALLET_TOWN_PROFESSOR_OAKS_LAB: 3,
        },
        flags: {},
      },
    },
  });
  const navigation = createPolicyAdvisors({ mechanics, world: playersHouseWorld })
    .flatMap((advisor) => advisor.advise(observed) ?? [])
    .find(({ advisor }) => advisor === "navigation");

  assert.deepEqual(withoutLocomotionMetadata(navigation.recommendation), {
    kind: "move-toward",
    direction: "south",
    pathSegment: {
      direction: "south",
      steps: 4,
      endpoint: {
        map: "MAP_PALLET_TOWN_PROFESSOR_OAKS_LAB",
        x: 7,
        y: 8,
      },
    },
    objective: "start-first-rival-battle",
    targetEvent: {
      x: 7,
      y: 8,
      script: "PalletTown_ProfessorOaksLab_EventScript_RivalBattleTriggerRight",
      condition: {
        variable: "VAR_MAP_SCENE_PALLET_TOWN_PROFESSOR_OAKS_LAB",
        value: "3",
      },
    },
    remainingSteps: 4,
  });
});

test("lab scene four continues toward the parcel instead of becoming a campaign boundary", () => {
  const observed = observation({
    playerMemory: {
      map: { id: "MAP_PALLET_TOWN_PROFESSOR_OAKS_LAB" },
      position: { x: 7, y: 7 },
      trainer: {
        partyCount: 1,
        usablePartyCount: 1,
        party: [{ slot: 0, species: 1, hp: 21, maxHp: 21 }],
      },
      storyState: {
        variables: {
          VAR_MAP_SCENE_PALLET_TOWN_PROFESSOR_OAKS_LAB: 4,
        },
        flags: {},
        variableIds: {},
        flagIds: {},
      },
    },
  });
  const navigation = createPolicyAdvisors({ mechanics, world: playersHouseWorld })
    .flatMap((advisor) => advisor.advise(observed) ?? [])
    .find(({ advisor }) => advisor === "navigation");

  assert.deepEqual(withoutLocomotionMetadata(navigation.recommendation), {
    kind: "move-toward",
    direction: "south",
    pathSegment: {
      direction: "south",
      steps: 5,
      endpoint: {
        map: "MAP_PALLET_TOWN_PROFESSOR_OAKS_LAB",
        x: 7,
        y: 12,
      },
      continuationDirection: "west",
    },
    objective: "oak-parcel",
    targetMap: "MAP_VIRIDIAN_CITY",
    transit: {
      kind: "warp",
      destinationMap: "MAP_PALLET_TOWN",
      x: 6,
      y: 12,
    },
    remainingSteps: 6,
  });
});

test("one central player rejects stale advice, rectifies conflicts, and alone maps input", () => {
  const observed = observation({
    emulator: { mode: "battle" },
    playerMemory: {
      battle: {
        player: {
          species: 6,
          moves: [17, 53, 83, 19],
          pp: [23, 1, 15, 15],
          stats: { attack: 195, spAttack: 230 },
        },
        opponent: { species: 59, stats: { defense: 128, spDefense: 117 } },
      },
      ui: { battle: { stage: "move", cursor: 1, selectedMoveId: 53 } },
    },
  });
  const stale = {
    id: "stale-navigation",
    advise() {
      return {
        advisor: "navigation",
        observationId: "old-capture",
        recommendation: { kind: "move-toward", direction: "north" },
        confidence: 1,
        constraints: [],
        vetoes: [],
        evidenceRefs: ["old-map"],
      };
    },
  };
  const player = createCentralPlayer({
    advisors: [...createPolicyAdvisors({ mechanics }), stale],
  });
  const decision = player.decide(observed);
  assert.equal(decision.kind, "act");
  assert.equal(decision.winner.advisor, "battle");
  assert.equal(decision.rejected.some(({ reason }) => reason === "stale-observation"), true);
  assert.deepEqual(decision.action.buttons, ["a"]);
  for (const proposal of decision.proposals) {
    assert.equal(JSON.stringify(proposal).includes("buttons"), false);
  }
});

test("the central player checkpoints the campaign planner frontier", () => {
  const campaignPlanner = {
    state() {
      return Object.freeze({
        schema: "master-red/campaign-planner-state/v1",
        completedThroughObjectiveId: "rocket-hideout-exit",
      });
    },
  };
  const player = createCentralPlayer({ campaignPlanner });

  assert.deepEqual(player.state().campaignPlanner, campaignPlanner.state());
});

test("the central executor produces an acknowledged edge and release", () => {
  const calls = [];
  const session = { step(buttons) { calls.push(buttons); } };
  const action = mapRecommendation(
    { kind: "choose-battle-move", targetMoveSlot: 2, targetMoveId: 351 },
    observation({ playerMemory: { ui: { battle: { stage: "move", cursor: 0 } } } }),
  );
  assert.deepEqual(action.buttons, ["down"]);
  executeCentralAction({ session, action });
  assert.deepEqual(calls, [["down"], []]);

  const running = mapRecommendation(
    { kind: "move-toward", direction: "east", useRunningShoes: true },
    observation(),
  );
  assert.deepEqual(
    {
      kind: running.kind,
      buttons: running.buttons,
      holdFrames: running.holdFrames,
      releaseFrames: running.releaseFrames,
      reason: running.reason,
    },
    {
      kind: "sustained-chord",
      buttons: ["b", "right"],
      holdFrames: 4,
      releaseFrames: 0,
      reason: "navigation-running",
    },
  );
  assert.throws(
    () => executeCentralAction({ session, action: running }),
    /sustained.*autonomous emulator/i,
  );

  const warp = mapRecommendation(
    { kind: "traverse-directional-warp", direction: "west" },
    observation(),
  );
  assert.deepEqual(
    { buttons: warp.buttons, reason: warp.reason },
    { buttons: ["left"], reason: "directional-warp" },
  );

  const connection = mapRecommendation(
    { kind: "traverse-map-connection", direction: "north" },
    observation(),
  );
  assert.deepEqual(connection, {
    kind: "sustained-chord",
    buttons: ["up"],
    holdFrames: 4,
    releaseFrames: 0,
    reason: "map-connection-walking",
    movementLease: {
      kind: "one-tile",
      origin: { map: "MAP_ROUTE1", x: 1, y: 1 },
      maximumFrames: 60,
    },
  });

  const door = mapRecommendation(
    { kind: "traverse-door-warp", direction: "north" },
    observation(),
  );
  assert.deepEqual(
    { buttons: door.buttons, reason: door.reason },
    { buttons: ["up"], reason: "door-warp" },
  );

  const preciseDoor = mapRecommendation(
    { kind: "traverse-door-warp", direction: "north", useRunningShoes: true },
    observation(),
  );
  assert.deepEqual(preciseDoor.buttons, ["up"]);

  const landedLadder = mapRecommendation(
    { kind: "reenter-map-warp", direction: "south" },
    observation(),
  );
  assert.deepEqual(
    { buttons: landedLadder.buttons, reason: landedLadder.reason },
    { buttons: ["down"], reason: "reenter-warp" },
  );

  const faceFieldMove = mapRecommendation(
    { kind: "use-field-move", fieldMove: "cut", direction: "north" },
    observation({ playerMemory: { avatar: { facing: "south" } } }),
  );
  assert.deepEqual(
    { buttons: faceFieldMove.buttons, reason: faceFieldMove.reason },
    { buttons: ["up"], reason: "face-field-obstacle" },
  );

  const activateFieldMove = mapRecommendation(
    { kind: "use-field-move", fieldMove: "cut", direction: "north" },
    observation({ playerMemory: { avatar: { facing: "north" } } }),
  );
  assert.deepEqual(
    { buttons: activateFieldMove.buttons, reason: activateFieldMove.reason },
    { buttons: ["a"], reason: "use-field-move" },
  );

  const activateBackground = mapRecommendation(
    { kind: "interact-with-background", direction: "east" },
    observation({ playerMemory: { avatar: { facing: "east" } } }),
  );
  assert.deepEqual(
    { buttons: activateBackground.buttons, reason: activateBackground.reason },
    { buttons: ["a"], reason: "interact-with-background" },
  );

  const confirmFieldMove = mapRecommendation(
    { kind: "use-field-move", fieldMove: "surf", direction: "north" },
    observation({
      playerMemory: {
        avatar: { facing: "north" },
        ui: { choiceMenu: { cursor: 1 } },
      },
    }),
  );
  assert.deepEqual(
    { buttons: confirmFieldMove.buttons, reason: confirmFieldMove.reason },
    { buttons: ["up"], reason: "confirm-field-move" },
  );

  const pushBoulder = mapRecommendation(
    { kind: "push-field-obstacle", fieldMove: "strength", direction: "north" },
    observation(),
  );
  assert.deepEqual(
    { buttons: pushBoulder.buttons, reason: pushBoulder.reason },
    { buttons: ["up"], reason: "push-field-obstacle" },
  );
});

for (const answer of ['yes','no']) test(`a pending field choice (${answer}) finishes before Fly and retains its goal across restart`,()=>{
  const objective={id:'continue-story',choice:answer,choiceMaps:['MAP_ROUTE23'],
    target:{kind:'object',map:'MAP_VERMILION_CITY_POKEMON_CENTER_1F',index:0}};
  const planner={select:()=>objective,selectCollection:()=>null,selectTraining:()=>null};
  const world={maps:[
    mapFromCollisionRows({id:'MAP_ROUTE23',rows:['.'],properties:{map_type:'MAP_TYPE_ROUTE',region_map_section:'MAPSEC_ROUTE_23'}}),
    mapFromCollisionRows({id:objective.target.map,rows:['.'],objectEvents:[{x:0,y:0}],
      properties:{map_type:'MAP_TYPE_INDOOR',region_map_section:'MAPSEC_VERMILION_CITY'}}),
  ]};
  const memory={map:{id:'MAP_ROUTE23'},position:{x:18,y:29},
    storyState:{flagIds:{2082:true,2197:true}},
    trainer:{partyCount:1,usablePartyCount:1,party:[{slot:0,species:6,level:50,hp:150,maxHp:150,moves:[19]}]}};
  const open=state=>createCentralPlayer({advisors:createPolicyAdvisors({mechanics,world,campaignPlanner:planner}),initialState:state});
  let player=open(),cursor=answer==='yes'?1:0;
  const pending=()=>observation({playerMemory:{...memory,scripts:{fieldControlsLocked:true},
    ui:{choiceMenu:{cursor,minCursor:0,maxCursor:1,selected:cursor===0?'yes':'no'}}}});
  let decision=player.decide(pending());
  assert.equal(decision.winner.recommendation.kind,'choose-menu-option');
  assert.equal(decision.winner.recommendation.targetOption,answer);
  assert.equal(decision.winner.recommendation.objective,objective.id);
  assert.deepEqual(decision.action.buttons,[answer==='yes'?'up':'down']);
  player=open(JSON.parse(JSON.stringify(player.state())));cursor=answer==='yes'?0:1;
  decision=player.decide(pending());assert.deepEqual(decision.action.buttons,['a']);
  const dialogue=observation({playerMemory:{...memory,scripts:{fieldControlsLocked:true},ui:{fieldDialog:{stage:'awaiting-close'}}}});
  assert.equal(player.decide(dialogue).winner.recommendation.kind,'acknowledge-cartridge-prompt');
  player=open(JSON.parse(JSON.stringify(player.state())));
  const next=player.decide(observation({playerMemory:{...memory,scripts:{fieldControlsLocked:false}}}));
  assert.equal(next.winner.recommendation.kind,'open-start-menu');
  assert.equal(next.winner.recommendation.objective,'fly-to-MAPSEC_VERMILION_CITY');
});

test("the bot flies from Route 23's isolated north landing to a visited campaign city", () => {
  const objective = {
    id: "vs-seeker",
    target: {
      kind: "object",
      map: "MAP_VERMILION_CITY_POKEMON_CENTER_1F",
      index: 4,
    },
  };
  const campaignPlanner = {
    select: () => objective,
    selectCollection: () => null,
    selectTraining: () => null,
  };
  const world = { maps: [
    mapFromCollisionRows({
      id: "MAP_ROUTE23",
      rows: ["."],
      properties: {
        map_type: "MAP_TYPE_ROUTE",
        region_map_section: "MAPSEC_ROUTE_23",
      },
    }),
    mapFromCollisionRows({
      id: "MAP_VERMILION_CITY_POKEMON_CENTER_1F",
      rows: ["."],
      objectEvents: Array.from({ length: 5 }, () => ({ x: 0, y: 0 })),
      properties: {
        map_type: "MAP_TYPE_INDOOR",
        region_map_section: "MAPSEC_VERMILION_CITY",
      },
    }),
  ] };
  const baseMemory = {
    map: { id: "MAP_ROUTE23" },
    position: { x: 18, y: 29 },
    storyState: { flagIds: { 2082: true, 2197: true } },
    trainer: {
      partyCount: 2,
      usablePartyCount: 2,
      party: [
        { slot: 0, species: 6, level: 68, hp: 190, maxHp: 199, moves: [53] },
        { slot: 1, species: 85, level: 60, hp: 151, maxHp: 151, moves: [19] },
      ],
    },
  };
  const questRecommendation = (state) => createPolicyAdvisors({
    mechanics,
    world,
    campaignPlanner,
  }).find(({ id }) => id === "quest").advise(state)?.recommendation;

  assert.deepEqual(questRecommendation(observation({
    playerMemory: baseMemory,
  })), {
    kind: "open-start-menu",
    objective: "fly-to-MAPSEC_VERMILION_CITY",
  });
  assert.deepEqual(questRecommendation(observation({
    emulator: { mode: "start-menu" },
    playerMemory: {
      ...baseMemory,
      ui: { startMenu: { cursor: 0, order: ["pokedex", "pokemon", "bag"] } },
    },
  })), {
    kind: "choose-start-menu-item",
    targetItem: "pokemon",
    targetIndex: 1,
    objective: "fly-to-MAPSEC_VERMILION_CITY",
  });
  assert.deepEqual(questRecommendation(observation({
    emulator: { mode: "party" },
    playerMemory: {
      ...baseMemory,
      ui: { party: { stage: "choose-pokemon", cursor: 0 } },
    },
  })), {
    kind: "choose-party-member",
    targetPartySlot: 1,
    targetSpecies: 85,
    objective: "fly-to-MAPSEC_VERMILION_CITY",
  });
  assert.deepEqual(questRecommendation(observation({
    emulator: { mode: "party" },
    playerMemory: {
      ...baseMemory,
      ui: {
        party: {
          stage: "selection-menu",
          cursor: 1,
          selectedPartySlot: 1,
          actionCursor: 0,
          actions: ["summary", "fly", "cancel"],
        },
      },
    },
  })), {
    kind: "choose-party-action",
    targetAction: "fly",
    targetIndex: 1,
    objective: "fly-to-MAPSEC_VERMILION_CITY",
  });

  const flyCursor = observation({
    emulator: { mode: "fly-map", callback2: "CB2_RegionMap" },
    playerMemory: {
      ...baseMemory,
      ui: {
        flyMap: {
          stage: "selection",
          cursor: { x: 2, y: 4 },
          selectedMapsec: 0,
          selectedMapsecType: 3,
          selectedDungeonType: 0,
        },
      },
    },
  });
  const moveCursor = questRecommendation(flyCursor);
  assert.deepEqual(moveCursor, {
    kind: "choose-fly-destination",
    targetMapSection: "MAPSEC_VERMILION_CITY",
    targetCursor: { x: 14, y: 9 },
    objective: "fly-to-MAPSEC_VERMILION_CITY",
  });
  assert.deepEqual(mapRecommendation(moveCursor, flyCursor).buttons, ["down"]);

  const atDestination = observation({
    emulator: { mode: "fly-map", callback2: "CB2_RegionMap" },
    playerMemory: {
      ...baseMemory,
      ui: {
        flyMap: {
          stage: "selection",
          cursor: { x: 14, y: 9 },
          selectedMapsec: 0,
          selectedMapsecType: 3,
          selectedDungeonType: 0,
        },
      },
    },
  });
  assert.deepEqual(mapRecommendation(
    questRecommendation(atDestination),
    atDestination,
  ).buttons, ["a"]);
});

test("the bot flies to the nearest visited staging city for a distant route objective", () => {
  const objective = {
    id: "exp-share-capture:MAP_ROUTE21_NORTH:114",
    target: { kind: "encounter-zone", map: "MAP_ROUTE21_NORTH" },
  };
  const campaignPlanner = {
    select: () => objective,
    selectCollection: () => null,
    selectTraining: () => null,
  };
  const routeMap = (id, connections) => mapFromCollisionRows({
    id,
    rows: ["."],
    connections,
    properties: {
      map_type: "MAP_TYPE_ROUTE",
      region_map_section: `MAPSEC_${id.slice(4)}`,
    },
  });
  const world = { maps: [
    routeMap("MAP_ROUTE17", [{ direction: "up", map: "MAP_ROUTE16" }]),
    routeMap("MAP_ROUTE16", [
      { direction: "down", map: "MAP_ROUTE17" },
      { direction: "right", map: "MAP_ROUTE15" },
    ]),
    routeMap("MAP_ROUTE15", [
      { direction: "left", map: "MAP_ROUTE16" },
      { direction: "right", map: "MAP_ROUTE14" },
    ]),
    routeMap("MAP_ROUTE14", [
      { direction: "left", map: "MAP_ROUTE15" },
      { direction: "right", map: "MAP_ROUTE21_NORTH" },
    ]),
    routeMap("MAP_ROUTE21_NORTH", [
      { direction: "left", map: "MAP_ROUTE14" },
      { direction: "up", map: "MAP_PALLET_TOWN" },
    ]),
    mapFromCollisionRows({
      id: "MAP_PALLET_TOWN",
      rows: ["."],
      connections: [{ direction: "down", map: "MAP_ROUTE21_NORTH" }],
      properties: {
        map_type: "MAP_TYPE_TOWN",
        region_map_section: "MAPSEC_PALLET_TOWN",
      },
    }),
  ] };
  const observed = observation({
    playerMemory: {
      map: { id: "MAP_ROUTE17" },
      position: { x: 0, y: 0 },
      storyState: { flagIds: { 2082: true, 2192: true } },
      trainer: {
        partyCount: 2,
        usablePartyCount: 2,
        party: [
          { slot: 0, species: 6, level: 68, hp: 190, maxHp: 199, moves: [53] },
          { slot: 1, species: 85, level: 60, hp: 151, maxHp: 151, moves: [19] },
        ],
      },
    },
  });

  const quest = createPolicyAdvisors({ mechanics, world, campaignPlanner })
    .find(({ id }) => id === "quest").advise(observed);
  assert.deepEqual(quest?.recommendation, {
    kind: "open-start-menu",
    objective: "fly-to-MAPSEC_PALLET_TOWN",
  });
});

test("Fly staging respects disconnected route regions instead of creating a fly-back loop", () => {
  const objective = {
    id: "exp-share-capture:MAP_SEAFOAM_TEST:86",
    target: { kind: "encounter-zone", map: "MAP_SEAFOAM_TEST" },
  };
  const campaignPlanner = {
    select: () => objective,
    selectCollection: () => null,
    selectTraining: () => null,
  };
  const routeMap = (id, connections, options = {}) => mapFromCollisionRows({
    id,
    rows: options.rows ?? ["."],
    connections,
    encounters: options.encounters ?? {},
    properties: {
      map_type: options.mapType ?? "MAP_TYPE_ROUTE",
      region_map_section: options.mapSection ?? `MAPSEC_${id.slice(4)}`,
    },
  });
  const world = { maps: [
    routeMap("MAP_ROUTE21_NORTH", [
      { direction: "down", map: "MAP_ROUTE21_SOUTH" },
      { direction: "right", map: "MAP_FLY_APPROACH" },
    ]),
    routeMap("MAP_ROUTE21_SOUTH", [
      { direction: "up", map: "MAP_ROUTE21_NORTH" },
      { direction: "down", map: "MAP_CINNABAR_ISLAND" },
    ]),
    routeMap("MAP_FLY_APPROACH", [
      { direction: "left", map: "MAP_ROUTE21_NORTH" },
      { direction: "right", map: "MAP_FUCHSIA_CITY" },
    ]),
    routeMap("MAP_CINNABAR_ISLAND", [
      { direction: "up", map: "MAP_ROUTE21_SOUTH" },
      { direction: "right", map: "MAP_ROUTE20" },
    ], {
      mapType: "MAP_TYPE_TOWN",
      mapSection: "MAPSEC_CINNABAR_ISLAND",
    }),
    routeMap("MAP_FUCHSIA_CITY", [
      { direction: "left", map: "MAP_FLY_APPROACH" },
      { direction: "down", map: "MAP_ROUTE19" },
    ], {
      mapType: "MAP_TYPE_CITY",
      mapSection: "MAPSEC_FUCHSIA_CITY",
    }),
    routeMap("MAP_ROUTE19", [
      { direction: "up", map: "MAP_FUCHSIA_CITY" },
      { direction: "left", map: "MAP_ROUTE20" },
    ]),
    routeMap("MAP_ROUTE20", [
      { direction: "left", map: "MAP_CINNABAR_ISLAND" },
      { direction: "right", map: "MAP_SEAFOAM_TEST" },
    ], { rows: [".#."] }),
    routeMap("MAP_SEAFOAM_TEST", [
      { direction: "left", map: "MAP_ROUTE20" },
    ], {
      rows: [".."],
      encounters: { "0,0": 1, "1,0": 1 },
    }),
  ] };
  const observed = observation({
    playerMemory: {
      map: { id: "MAP_ROUTE21_NORTH" },
      position: { x: 0, y: 0 },
      storyState: { flagIds: {
        2082: true,
        2199: true,
        2200: true,
      } },
      trainer: {
        partyCount: 2,
        usablePartyCount: 2,
        party: [
          { slot: 0, species: 6, level: 68, hp: 190, maxHp: 199, moves: [53] },
          { slot: 1, species: 85, level: 60, hp: 151, maxHp: 151, moves: [19] },
        ],
      },
    },
  });

  const quest = createPolicyAdvisors({ mechanics, world, campaignPlanner })
    .find(({ id }) => id === "quest").advise(observed);
  assert.deepEqual(quest?.recommendation, {
    kind: "open-start-menu",
    objective: "fly-to-MAPSEC_FUCHSIA_CITY",
  });
});

test("Fly staging follows blocking preparation instead of flying back toward the story boss", () => {
  const storyObjective = {
    id: "silph-liberated",
    target: { kind: "encounter-zone", map: "MAP_ROUTE21_NORTH" },
    importantBattle: true,
  };
  const trainingObjective = {
    id: "train-battle-member-with-vs-seeker",
    target: { kind: "encounter-zone", map: "MAP_ROUTE16" },
    trainingSource: "trainer",
    trainingPartySlot: 1,
    currentTeamAnchorLevel: 32,
    minimumTeamAnchorLevel: 43,
    forObjective: storyObjective.id,
    trainer: { id: 510, flagId: 1790, minimumLevel: 25, maximumLevel: 25 },
  };
  const campaignPlanner = {
    select: () => storyObjective,
    selectCollection: () => null,
    selectTraining: () => trainingObjective,
  };
  const routeMap = (id, connections, options = {}) => mapFromCollisionRows({
    id,
    rows: options.rows ?? ["."],
    connections,
    encounters: options.encounters ?? {},
    properties: {
      map_type: options.mapType ?? "MAP_TYPE_ROUTE",
      region_map_section: options.mapSection ?? `MAPSEC_${id.slice(4)}`,
    },
  });
  const world = { maps: [
    routeMap("MAP_ROUTE17", [{ direction: "up", map: "MAP_ROUTE16" }]),
    routeMap("MAP_ROUTE16", [
      { direction: "down", map: "MAP_ROUTE17" },
      { direction: "right", map: "MAP_ROUTE15" },
    ], { rows: [".."], encounters: { "0,0": 1, "1,0": 1 } }),
    routeMap("MAP_ROUTE15", [
      { direction: "left", map: "MAP_ROUTE16" },
      { direction: "right", map: "MAP_ROUTE14" },
    ]),
    routeMap("MAP_ROUTE14", [
      { direction: "left", map: "MAP_ROUTE15" },
      { direction: "right", map: "MAP_ROUTE21_NORTH" },
    ]),
    routeMap("MAP_ROUTE21_NORTH", [
      { direction: "left", map: "MAP_ROUTE14" },
      { direction: "up", map: "MAP_PALLET_TOWN" },
    ], { rows: [".."], encounters: { "0,0": 1, "1,0": 1 } }),
    routeMap("MAP_PALLET_TOWN", [
      { direction: "down", map: "MAP_ROUTE21_NORTH" },
    ], { mapType: "MAP_TYPE_TOWN", mapSection: "MAPSEC_PALLET_TOWN" }),
  ] };
  const observed = observation({
    playerMemory: {
      map: { id: "MAP_ROUTE17" },
      position: { x: 0, y: 0 },
      storyState: { flagIds: { 2082: true, 2192: true } },
      trainer: {
        partyCount: 2,
        usablePartyCount: 2,
        party: [
          { slot: 0, species: 9, level: 42, hp: 106, maxHp: 135, moves: [57] },
          { slot: 1, species: 22, level: 32, hp: 87, maxHp: 87, moves: [19] },
        ],
      },
    },
  });

  const quest = createPolicyAdvisors({ mechanics, world, campaignPlanner })
    .find(({ id }) => id === "quest").advise(observed);
  assert.notEqual(quest?.recommendation?.objective, "fly-to-MAPSEC_PALLET_TOWN");
});

test("Fly training advice identifies the trainer whose route it is starting", () => {
  const training = { id: "train-battle-member-with-vs-seeker", trainingSource: "vs-seeker",
    target: { kind: "map-arrival", map: "MAP_VERMILION_CITY", x: 1, y: 0 },
    trainer: { id: 630 }, forObjective: "silph-liberated", trainingPartySlot: 0,
    currentTeamAnchorLevel: 22, minimumTeamAnchorLevel: 43 };
  const story = { id: "silph-liberated", importantBattle: true, target: training.target };
  const world = { maps: [
    mapFromCollisionRows({ id: "MAP_ROUTE23", rows: ["."], properties: {
      map_type: "MAP_TYPE_ROUTE", region_map_section: "MAPSEC_ROUTE_23" } }),
    mapFromCollisionRows({ id: "MAP_VERMILION_CITY", rows: [".."], properties: {
      map_type: "MAP_TYPE_CITY", region_map_section: "MAPSEC_VERMILION_CITY" } }),
  ] };
  const observed = observation({ playerMemory: {
    map: { id: "MAP_ROUTE23" }, position: { x: 18, y: 29 },
    storyState: { flagIds: { 2082: true, 2197: true } },
    trainer: { partyCount: 1, usablePartyCount: 1,
      party: [{ slot: 0, species: 22, level: 22, hp: 60, maxHp: 60, moves: [19] }] },
  } });
  const planner = { select: () => story, selectCollection: () => null, selectTraining: () => training };
  const quest = createPolicyAdvisors({ world, mechanics, campaignPlanner: planner })
    .find(({ id }) => id === "quest").advise(observed);
  assert.equal(quest?.recommendation?.objective, "fly-to-MAPSEC_VERMILION_CITY");
  assert.ok(quest.evidenceRefs.includes("campaign:objective:train-battle-member-with-vs-seeker"));
  assert.ok(quest.evidenceRefs.includes("cartridge:trainer:630"));
});

test("Fly reaches an owned evolution's PC when its walking route is disconnected, including after restart", () => {
  const objective = { id: "withdraw-owned-evolution", identityEvolution: true,
    target: { kind: "map-arrival", map: "MAP_PALLET_TOWN", x: 0, y: 0 } };
  const planner = { select: () => objective, selectCollection: () => null, selectTraining: () => null };
  const world = { maps: [
    mapFromCollisionRows({ id: "MAP_VIRIDIAN_FOREST", rows: ["."], properties: {
      map_type: "MAP_TYPE_ROUTE", region_map_section: "MAPSEC_VIRIDIAN_FOREST" } }),
    mapFromCollisionRows({ id: "MAP_PALLET_TOWN", rows: ["."], properties: {
      map_type: "MAP_TYPE_TOWN", region_map_section: "MAPSEC_PALLET_TOWN" } }),
  ] };
  const memory = { map: { id: "MAP_VIRIDIAN_FOREST" }, position: { x: 0, y: 0 },
    storyState: { flagIds: { 2082: true, 2192: true } }, trainer: { partyCount: 1,
      usablePartyCount: 1, party: [{ slot: 0, species: 22, hp: 80, maxHp: 80, level: 40, moves: [19] }] } };
  const open = state => createCentralPlayer({ advisors: createPolicyAdvisors({
    world, mechanics, campaignPlanner: planner }), initialState: state });
  let player = open();
  const first = player.decide(observation({ playerMemory: memory }));
  assert.equal(first.winner.recommendation.objective, "fly-to-MAPSEC_PALLET_TOWN");
  assert.deepEqual(first.action.buttons, ["start"]);
  player = open(JSON.parse(JSON.stringify(player.state())));
  const menu = player.decide(observation({ emulator: { mode: "start-menu" },
    playerMemory: { ...memory, ui: { startMenu: { cursor: 1, order: ["pokedex", "pokemon", "bag"] } } } }));
  assert.equal(menu.winner.recommendation.targetItem, "pokemon");
  assert.deepEqual(menu.action.buttons, ["a"]);
  const landed = player.decide(observation({ playerMemory: { ...memory, map: { id: "MAP_PALLET_TOWN" } } }));
  assert.notEqual(landed.winner?.recommendation.objective, "fly-to-MAPSEC_PALLET_TOWN");
  for (const flags of [{ 2082: true, 2192: false }, { 2082: false, 2192: true }]) {
    const denied = open().decide(observation({ playerMemory: { ...memory, storyState: { flagIds: flags } } }));
    assert.notEqual(denied.winner?.recommendation.objective, "fly-to-MAPSEC_PALLET_TOWN");
  }
});

test("Fly transport never targets an unvisited campaign city", () => {
  const objective = {
    id: "vs-seeker",
    target: {
      kind: "object",
      map: "MAP_VERMILION_CITY_POKEMON_CENTER_1F",
      index: 4,
    },
  };
  const campaignPlanner = {
    select: () => objective,
    selectCollection: () => null,
    selectTraining: () => null,
  };
  const world = { maps: [mapFromCollisionRows({
    id: "MAP_VERMILION_CITY_POKEMON_CENTER_1F",
    rows: ["."],
    properties: { region_map_section: "MAPSEC_VERMILION_CITY" },
  })] };
  const observed = observation({
    playerMemory: {
      map: { id: "MAP_ROUTE23" },
      position: { x: 18, y: 29 },
      storyState: { flagIds: { 2082: true, 2197: false } },
      trainer: {
        partyCount: 1,
        usablePartyCount: 1,
        party: [{ slot: 0, species: 85, level: 60, hp: 151, moves: [19] }],
      },
    },
  });

  const quest = createPolicyAdvisors({ mechanics, world, campaignPlanner })
    .find(({ id }) => id === "quest").advise(observed);
  assert.notEqual(quest?.recommendation?.objective, "fly-to-MAPSEC_VERMILION_CITY");
});

test("running is leased to one observed tile instead of becoming an unlimited direction hold", () => {
  const action = mapRecommendation(
    { kind: "move-toward", direction: "east", useRunningShoes: true },
    observation({
      playerMemory: {
        map: { id: "MAP_ROUTE1" },
        position: { x: 7, y: 11 },
      },
    }),
  );

  assert.deepEqual(action.movementLease, {
    kind: "one-tile",
    origin: { map: "MAP_ROUTE1", x: 7, y: 11 },
    maximumFrames: 60,
  });
  assert.deepEqual(action.buttons, ["b", "right"]);
  assert.equal(action.releaseFrames, 0);
});

test("running rechecks a planned straightaway after the older two-tile burst", () => {
  const action = mapRecommendation(
    {
      kind: "move-toward",
      direction: "east",
      useRunningShoes: true,
      pathSegment: {
        direction: "east",
        steps: 5,
        endpoint: { map: "MAP_ROUTE1", x: 12, y: 11 },
        continuationDirection: "north",
      },
    },
    observation({
      playerMemory: {
        map: { id: "MAP_ROUTE1" },
        position: { x: 7, y: 11 },
      },
    }),
  );

  assert.deepEqual(action.movementLease, {
    kind: "route-segment",
    origin: { map: "MAP_ROUTE1", x: 7, y: 11 },
    target: { map: "MAP_ROUTE1", x: 9, y: 11 },
    maximumFrames: 108,
    stallFrames: 60,
  });
  assert.deepEqual(action.buttons, ["b", "right"]);
  assert.equal(action.releaseFrames, 0);
});

test("walking leases the complete current-map route instead of pulsing every tile", () => {
  const action = mapRecommendation(
    {
      kind: "move-toward",
      direction: "east",
      travelMode: "walk",
      routePlan: {
        map: "MAP_ROUTE_PLAN",
        mapRevision: "b".repeat(64),
        origin: { x: 1, y: 4 },
        destination: { x: 4, y: 2 },
        steps: 5,
        segments: [
          { direction: "east", steps: 3, endpoint: { x: 4, y: 4 } },
          { direction: "north", steps: 2, endpoint: { x: 4, y: 2 } },
        ],
      },
    },
    observation({
      playerMemory: {
        map: { id: "MAP_ROUTE_PLAN" },
        position: { x: 1, y: 4 },
      },
    }),
  );

  assert.deepEqual(action, {
    kind: "sustained-chord",
    buttons: ["right"],
    holdFrames: 4,
    releaseFrames: 0,
    reason: "navigation-walking",
    movementLease: {
      kind: "route-plan",
      origin: { map: "MAP_ROUTE_PLAN", x: 1, y: 4 },
      target: { map: "MAP_ROUTE_PLAN", x: 4, y: 2 },
      segments: [
        {
          direction: "east",
          target: { map: "MAP_ROUTE_PLAN", x: 4, y: 4 },
        },
        {
          direction: "north",
          target: { map: "MAP_ROUTE_PLAN", x: 4, y: 2 },
        },
      ],
      mapRevision: "b".repeat(64),
      maximumFrames: 180,
      stallFrames: 60,
    },
  });
});

test("ordinary bicycle movement uses an exact semantic stride off Cycling Road", () => {
  const action = mapRecommendation(
    {
      kind: "move-toward",
      direction: "west",
      travelMode: "bicycle",
    },
    observation({
      playerMemory: {
        map: { id: "MAP_ROUTE16" },
        position: { x: 20, y: 13 },
        avatar: { flags: 2, onFoot: false, surfing: false },
      },
    }),
  );

  assert.deepEqual(action, {
    kind: "sustained-chord",
    buttons: ["left"],
    holdFrames: 4,
    releaseFrames: 0,
    reason: "navigation-bicycle",
    movementLease: {
      kind: "one-tile",
      origin: { map: "MAP_ROUTE16", x: 20, y: 13 },
      maximumFrames: 60,
    },
  });
});

test("running across a map connection stops at the verified destination", () => {
  const action = mapRecommendation(
    {
      kind: "traverse-map-connection",
      direction: "north",
      useRunningShoes: true,
      transit: {
        kind: "connection",
        destinationMap: "MAP_ROUTE2",
        direction: "north",
      },
    },
    observation({
      playerMemory: {
        map: { id: "MAP_VIRIDIAN_CITY" },
        position: { x: 17, y: 0 },
      },
    }),
  );

  assert.deepEqual(action.movementLease, {
    kind: "map-connection",
    origin: { map: "MAP_VIRIDIAN_CITY", x: 17, y: 0 },
    destinationMap: "MAP_ROUTE2",
    maximumFrames: 180,
  });
  assert.deepEqual(action.buttons, ["b", "up"]);
  assert.equal(action.releaseFrames, 0);
});

test("a verified one-tile corner stops for a fresh observation", () => {
  const action = mapRecommendation(
    {
      kind: "move-toward",
      direction: "east",
      useRunningShoes: true,
      pathSegment: {
        direction: "east",
        steps: 1,
        endpoint: { map: "MAP_ROUTE1", x: 8, y: 11 },
        continuationDirection: "north",
      },
    },
    observation({
      playerMemory: {
        map: { id: "MAP_ROUTE1" },
        position: { x: 7, y: 11 },
      },
    }),
  );

  assert.deepEqual(action.movementLease, {
    kind: "one-tile",
    origin: { map: "MAP_ROUTE1", x: 7, y: 11 },
    maximumFrames: 60,
  });
});

test("a leased running stride is never renewed beyond its one-tile boundary", () => {
  const navigation = {
    id: "navigation",
    advise(observed) {
      if (observed.phase !== "stable") return null;
      return {
        advisor: "navigation",
        observationId: observed.captureId,
        recommendation: {
          kind: "move-toward",
          direction: "east",
          useRunningShoes: true,
          objective: "continuous-running-proof",
        },
        confidence: 1,
        constraints: ["safe-on-foot-running"],
        vetoes: [],
        evidenceRefs: [`cartridge:frame:${observed.frame}`],
      };
    },
  };
  const player = createCentralPlayer({ advisors: [navigation] });

  const start = player.decide(observation({ captureId: "run-1", frame: 100 }));
  const transition = player.decide(observation({
    captureId: "run-2",
    frame: 104,
    phase: "transition",
    phaseReasons: ["tile-transition"],
    emulator: { inputReady: false },
  }));

  assert.deepEqual(start.action, {
    kind: "sustained-chord",
    buttons: ["b", "right"],
    holdFrames: 4,
    releaseFrames: 0,
    reason: "navigation-running",
    movementLease: {
      kind: "one-tile",
      origin: { map: "MAP_ROUTE1", x: 1, y: 1 },
      maximumFrames: 60,
    },
  });
  assert.equal(transition.kind, "resample");
  assert.equal(transition.reason, "transition");
  assert.deepEqual(transition.action, {
    kind: "neutral",
    buttons: [],
    holdFrames: 8,
    releaseFrames: 8,
    reason: "resample-transition",
  });
});

test("the delegator permits only the exact retained chord that it already owns", () => {
  const navigation = {
    id: "navigation",
    advise(observed) {
      return {
        advisor: "navigation",
        observationId: observed.captureId,
        recommendation: {
          kind: "move-toward",
          direction: "north",
          useRunningShoes: true,
          objective: "retained-input-ownership-proof",
        },
        confidence: 1,
        constraints: ["safe-on-foot-running"],
        vetoes: [],
        evidenceRefs: [`cartridge:frame:${observed.frame}`],
      };
    },
  };
  const verifier = createPolicyAdvisors({ mechanics })
    .find(({ id }) => id === "verifier");
  const heldObservation = (captureId, frame, heldKeysRaw) => observation({
    captureId,
    frame,
    emulator: {
      inputReady: false,
      input: {
        heldKeysRaw,
        newKeysRaw: 0,
        heldKeys: heldKeysRaw,
        newKeys: 0,
      },
    },
  });

  const owned = createCentralPlayer({ advisors: [navigation, verifier] });
  owned.decide(observation({ captureId: "owned-1", frame: 400 }));
  const continued = owned.decide(heldObservation("owned-2", 404, 0x42));
  assert.equal(continued.kind, "act");
  assert.equal(continued.winner.advisor, "navigation");
  assert.equal(continued.action.kind, "sustained-chord");
  assert.deepEqual(continued.action.buttons, ["b", "up"]);
  assert.equal(
    continued.rejected.some(({ reason }) =>
      reason === "expected-retained-controller-input"
    ),
    true,
  );

  const mismatched = createCentralPlayer({ advisors: [navigation, verifier] });
  mismatched.decide(observation({ captureId: "mismatch-1", frame: 500 }));
  const mismatch = mismatched.decide(heldObservation("mismatch-2", 504, 0x82));
  assert.equal(mismatch.reason, "policy-veto");
  assert.equal(mismatch.action.kind, "neutral");

  const unowned = createCentralPlayer({ advisors: [navigation, verifier] });
  const stray = unowned.decide(heldObservation("stray-1", 600, 0x42));
  assert.equal(stray.reason, "policy-veto");
  assert.equal(stray.action.kind, "neutral");
});

test("the delegator does not claim a corner chord before reobserving", () => {
  const navigation = {
    id: "navigation",
    advise(observed) {
      const afterCorner = observed.captureId === "corner-owned-2";
      return {
        advisor: "navigation",
        observationId: observed.captureId,
        recommendation: {
          kind: "move-toward",
          direction: afterCorner ? "north" : "east",
          useRunningShoes: true,
          objective: "corner-retained-input-ownership-proof",
          ...(!afterCorner ? {
            pathSegment: {
              direction: "east",
              steps: 2,
              endpoint: { map: "MAP_ROUTE1", x: 3, y: 1 },
              continuationDirection: "north",
            },
          } : {}),
        },
        confidence: 1,
        constraints: ["safe-on-foot-running"],
        vetoes: [],
        evidenceRefs: [`cartridge:frame:${observed.frame}`],
      };
    },
  };
  const verifier = createPolicyAdvisors({ mechanics })
    .find(({ id }) => id === "verifier");
  const player = createCentralPlayer({ advisors: [navigation, verifier] });

  const start = player.decide(observation({
    captureId: "corner-owned-1",
    frame: 700,
    playerMemory: { position: { x: 1, y: 1 } },
  }));
  assert.equal(start.action.movementLease?.continuationButtons, undefined);

  const continued = player.decide(observation({
    captureId: "corner-owned-2",
    frame: 732,
    emulator: {
      inputReady: false,
      input: {
        heldKeysRaw: 0x42,
        newKeysRaw: 0,
        heldKeys: 0x42,
        newKeys: 0,
      },
    },
    playerMemory: { position: { x: 3, y: 1 } },
  }));

  assert.equal(continued.reason, "policy-veto");
  assert.equal(continued.action.kind, "neutral");
});

test("retained running releases for any transition beyond ordinary tile motion", () => {
  const navigation = {
    id: "navigation",
    advise(observed) {
      if (observed.phase !== "stable") return null;
      return {
        advisor: "navigation",
        observationId: observed.captureId,
        recommendation: {
          kind: "move-toward",
          direction: "north",
          useRunningShoes: true,
        },
        confidence: 1,
        constraints: [],
        vetoes: [],
        evidenceRefs: ["cartridge:running"],
      };
    },
  };
  const player = createCentralPlayer({ advisors: [navigation] });
  player.decide(observation({ captureId: "safe-1", frame: 200 }));

  const modal = player.decide(observation({
    captureId: "safe-2",
    frame: 204,
    phase: "transition",
    phaseReasons: ["callback-change", "tile-transition"],
    emulator: { inputReady: false },
  }));

  assert.deepEqual(modal.action, {
    kind: "neutral",
    buttons: [],
    holdFrames: 8,
    releaseFrames: 8,
    reason: "resample-transition",
  });
});

test("a tile transition never invents retained movement after a bounded menu edge", () => {
  const player = createCentralPlayer({ advisors: createPolicyAdvisors({ mechanics }) });
  const menu = player.decide(observation({
    captureId: "menu-1",
    frame: 300,
    playerMemory: { ui: { fieldDialog: { stage: "awaiting-page" } } },
  }));
  assert.equal(menu.action.kind, "bounded-edge");

  const transition = player.decide(observation({
    captureId: "menu-2",
    frame: 302,
    phase: "transition",
    phaseReasons: ["tile-transition"],
  }));
  assert.equal(transition.action.kind, "neutral");
  assert.deepEqual(transition.action.buttons, []);
});

test("transitions are neutral resamples and Hall of Fame is terminal", () => {
  const player = createCentralPlayer({ advisors: createPolicyAdvisors({ mechanics }) });
  const transitional = player.decide(observation({ phase: "transition" }));
  assert.equal(transitional.kind, "resample");
  assert.deepEqual(transitional.action.buttons, []);
  assert.equal(transitional.action.holdFrames, 8);
  assert.equal(transitional.action.releaseFrames, 8);

  player.decide(observation({ captureId: "before-hof", frame: 50 }));
  const savePending = player.decide(observation({
    captureId: "hof-save-pending",
    frame: 51,
    // Earlier ordinary saves differ from the opening SRAM but do not prove
    // that the Hall of Fame transaction has run.
    sram: { sha256: "ordinary-pre-league-save" },
    emulator: { mode: "hall-of-fame", callback2: "CB2_HofIdle" },
    playerMemory: {
      map: { id: "MAP_POKEMON_LEAGUE_HALL_OF_FAME" },
      activeTasks: [{ function: "Task_Hof_InitTeamSaveData" }],
    },
  }));
  assert.equal(savePending.kind, "resample");
  assert.equal(savePending.reason, "native-save-pending");

  const complete = player.decide(observation({
    captureId: "hof-save-complete",
    frame: 52,
    emulator: { mode: "hall-of-fame", callback2: "CB2_HofIdle" },
    sram: { sha256: "native-hall-save" },
    playerMemory: {
      map: { id: "MAP_POKEMON_LEAGUE_HALL_OF_FAME" },
      activeTasks: [{ function: "Task_Hof_DelayAfterSave" }],
    },
  }));
  assert.equal(complete.kind, "complete");
  assert.equal(complete.winner.recommendation.kind, "mission-complete");
});

test("the navigation policy keeps a concrete story objective ahead of optional items", () => {
  const map = {
    id: "MAP_COLLECTION_ROUTE",
    objectEvents: [{
      x: 2,
      y: 2,
      flag: "FLAG_HIDE_COLLECTION_POTION",
      graphics_id: "OBJ_EVENT_GFX_ITEM_BALL",
      script: "CollectionRoute_EventScript_Potion",
    }],
    backgroundEvents: [],
    coordEvents: [{ x: 4, y: 4, script: "Story_EventScript_Continue" }],
    warpEvents: [],
    connections: [],
    layout: {
      id: "LAYOUT_COLLECTION_ROUTE",
      width: 5,
      height: 5,
      blockDataSha256: "collection-route-fixture",
      cells: Array.from({ length: 25 }, (_, index) => ({
        x: index % 5,
        y: Math.floor(index / 5),
        collision: 0,
        elevation: 3,
        behaviorName: "MB_NORMAL",
        encounterType: 0,
      })),
    },
  };
  const world = { data: { maps: [map] } };
  const story = { data: {
    symbols: {
      flags: { FLAG_HIDE_COLLECTION_POTION: { value: 342 } },
      items: { ITEM_POTION: { value: 13 } },
    },
    scripts: [{
      label: "CollectionRoute_EventScript_Potion",
      instructions: [{ op: "finditem", args: ["ITEM_POTION"] }],
    }],
  } };
  const campaignPlanner = createCampaignPlanner({
    campaign: { objectives: [{
      id: "continue-story",
      target: { kind: "trigger", map: map.id, index: 0 },
      completion: { kind: "flag-set", id: 99 },
    }] },
    world,
    story,
  });
  const observed = observation({
    playerMemory: {
      map: { id: map.id },
      position: { x: 2, y: 3 },
      storyState: {
        variables: {},
        flags: { FLAG_HIDE_COLLECTION_POTION: false },
        variableIds: {},
        flagIds: { 99: false, 342: false },
      },
      trainer: {
        partyCount: 1,
        usablePartyCount: 1,
        party: [{ slot: 0, species: 1, level: 5, hp: 19, maxHp: 19, moves: [] }],
        bag: {},
      },
    },
  });

  const recommendation = createPolicyAdvisors({ world, campaignPlanner })
    .find(({ id }) => id === "navigation")
    .advise(observed)?.recommendation;

  assert.equal(recommendation?.objective, "continue-story");
  assert.equal(recommendation?.kind, "move-toward");
});

test("manual recovery defers the interrupted optional item objective", () => {
  const map = {
    id: "MAP_MANUAL_RECOVERY_ROUTE",
    objectEvents: [{
      x: 2,
      y: 2,
      flag: "FLAG_HIDE_MANUAL_RECOVERY_POTION",
      graphics_id: "OBJ_EVENT_GFX_ITEM_BALL",
      script: "ManualRecoveryRoute_EventScript_Potion",
    }],
    backgroundEvents: [],
    coordEvents: [],
    warpEvents: [],
    connections: [],
    layout: {
      id: "LAYOUT_MANUAL_RECOVERY_ROUTE",
      width: 5,
      height: 5,
      blockDataSha256: "manual-recovery-route-fixture",
      cells: Array.from({ length: 25 }, (_, index) => ({
        x: index % 5,
        y: Math.floor(index / 5),
        collision: 0,
        elevation: 3,
        behaviorName: "MB_NORMAL",
        encounterType: 0,
      })),
    },
  };
  const world = { data: { maps: [map] } };
  const story = { data: {
    symbols: {
      flags: { FLAG_HIDE_MANUAL_RECOVERY_POTION: { value: 342 } },
      items: { ITEM_POTION: { value: 13 } },
    },
    scripts: [{
      label: "ManualRecoveryRoute_EventScript_Potion",
      instructions: [{ op: "finditem", args: ["ITEM_POTION"] }],
    }],
  } };
  const campaignPlanner = createCampaignPlanner({
    campaign: { objectives: [] },
    world,
    story,
  });
  const observed = (captureId, frame, position) => observation({
    captureId,
    frame,
    playerMemory: {
      map: { id: map.id },
      position,
      storyState: {
        variables: {},
        flags: { FLAG_HIDE_MANUAL_RECOVERY_POTION: false },
        variableIds: {},
        flagIds: { 342: false },
      },
      trainer: {
        partyCount: 1,
        usablePartyCount: 1,
        party: [{ slot: 0, species: 1, level: 5, hp: 19, maxHp: 19, moves: [] }],
        bag: {},
      },
    },
  });
  const before = observed("before-manual-recovery", 42, { x: 2, y: 3 });
  const after = observed("after-manual-recovery", 100, { x: 4, y: 4 });
  const player = createCentralPlayer({
    advisors: createPolicyAdvisors({ world, campaignPlanner }),
  });

  const interrupted = player.decide(before);
  assert.equal(
    interrupted.winner?.recommendation?.objective,
    "collect:MAP_MANUAL_RECOVERY_ROUTE:visible:0",
  );
  player.resumeFromManual({
    handoff: {
      schema: "master-red/manual-control-handoff/v1",
      session: 1,
      startedFrame: 43,
      endedFrame: 99,
      inputEvents: [
        { frame: 50, buttons: ["right"] },
        { frame: 60, buttons: [] },
      ],
    },
    observation: after,
  });

  assert.equal(campaignPlanner.selectCollection(after), null);
  assert.notEqual(
    player.decide(after).winner?.recommendation?.objective,
    "collect:MAP_MANUAL_RECOVERY_ROUTE:visible:0",
  );
});

test("checkpoint restoration preserves a manually deferred optional objective", () => {
  const map = {
    id: "MAP_RESTORED_RECOVERY_ROUTE",
    objectEvents: [{
      x: 2,
      y: 2,
      flag: "FLAG_HIDE_RESTORED_RECOVERY_POTION",
      graphics_id: "OBJ_EVENT_GFX_ITEM_BALL",
      script: "RestoredRecoveryRoute_EventScript_Potion",
    }],
    backgroundEvents: [],
    coordEvents: [],
    warpEvents: [],
    connections: [],
    layout: {
      id: "LAYOUT_RESTORED_RECOVERY_ROUTE",
      width: 5,
      height: 5,
      blockDataSha256: "restored-recovery-route-fixture",
      cells: Array.from({ length: 25 }, (_, index) => ({
        x: index % 5,
        y: Math.floor(index / 5),
        collision: 0,
        elevation: 3,
        behaviorName: "MB_NORMAL",
        encounterType: 0,
      })),
    },
  };
  const world = { data: { maps: [map] } };
  const campaignPlanner = createCampaignPlanner({
    campaign: { objectives: [] },
    world,
    story: { data: {
      symbols: {
        flags: { FLAG_HIDE_RESTORED_RECOVERY_POTION: { value: 342 } },
        items: { ITEM_POTION: { value: 13 } },
      },
      scripts: [{
        label: "RestoredRecoveryRoute_EventScript_Potion",
        instructions: [{ op: "finditem", args: ["ITEM_POTION"] }],
      }],
    } },
  });
  const observed = observation({
    captureId: "restored-manual-recovery",
    frame: 100,
    playerMemory: {
      map: { id: map.id },
      position: { x: 2, y: 3 },
      storyState: {
        variables: {},
        flags: { FLAG_HIDE_RESTORED_RECOVERY_POTION: false },
        variableIds: {},
        flagIds: { 342: false },
      },
      trainer: {
        partyCount: 1,
        usablePartyCount: 1,
        party: [{ slot: 0, species: 1, level: 5, hp: 19, maxHp: 19, moves: [] }],
        bag: {},
      },
    },
  });

  createCentralPlayer({
    advisors: createPolicyAdvisors({ world, campaignPlanner }),
    initialState: {
      sequence: 1,
      initialSramSha256: "sram",
      workflow: null,
      manualControl: {
        sessionCount: 1,
        lastHandoff: {
          schema: "master-red/manual-control-handoff/v1",
          session: 1,
          startedFrame: 43,
          endedFrame: 99,
          inputEvents: [],
          finalObservationId: "restored-manual-recovery",
          finalFrame: 100,
          finalSramSha256: "sram",
          interruptedObjectiveId: "collect:MAP_RESTORED_RECOVERY_ROUTE:visible:0",
        },
      },
    },
  });

  assert.equal(campaignPlanner.selectCollection(observed), null);
});

test("the quest policy uses the Itemfinder while standing on an underfoot item", () => {
  const map = {
    id: "MAP_ITEMFINDER_ROUTE",
    objectEvents: [],
    backgroundEvents: [{
      x: 2,
      y: 2,
      elevation: 3,
      type: "hidden_item",
      flag: "FLAG_HIDDEN_ITEM_LEFTOVERS",
      item: "ITEM_LEFTOVERS",
      quantity: 1,
      underfoot: true,
    }],
    coordEvents: [],
    warpEvents: [],
    connections: [],
    layout: {
      id: "LAYOUT_ITEMFINDER_ROUTE",
      width: 5,
      height: 5,
      blockDataSha256: "itemfinder-route-fixture",
      cells: Array.from({ length: 25 }, (_, index) => ({
        x: index % 5,
        y: Math.floor(index / 5),
        collision: 0,
        elevation: 3,
        behaviorName: "MB_NORMAL",
        encounterType: 0,
      })),
    },
  };
  const world = { data: { maps: [map] } };
  const campaignPlanner = createCampaignPlanner({
    campaign: { objectives: [] },
    world,
    story: { data: {
      symbols: {
        flags: { FLAG_HIDDEN_ITEM_LEFTOVERS: { value: 1002 } },
        items: {
          ITEM_LEFTOVERS: { value: 200 },
          ITEM_ITEMFINDER: { value: 261 },
        },
      },
      scripts: [],
    } },
  });
  const recommend = ({ mode = "overworld", ui = {} } = {}) => {
    const observed = observation({
      emulator: { mode },
      playerMemory: {
        map: { id: map.id },
        position: { x: 2, y: 2 },
        storyState: {
          variables: {},
          flags: { FLAG_HIDDEN_ITEM_LEFTOVERS: false },
          variableIds: {},
          flagIds: { 1002: false },
        },
        trainer: {
          partyCount: 1,
          usablePartyCount: 1,
          party: [{ slot: 0, species: 1, level: 5, hp: 19, maxHp: 19 }],
          bag: { keyItems: [{ itemId: 261, quantity: 1 }] },
        },
        ui,
      },
    });
    return createPolicyAdvisors({ world, campaignPlanner })
      .find(({ id }) => id === "quest")
      .advise(observed)?.recommendation;
  };

  assert.deepEqual(recommend(), {
    kind: "open-start-menu",
    objective: "collect:MAP_ITEMFINDER_ROUTE:hidden:0",
  });
  assert.deepEqual(recommend({
    mode: "start-menu",
    ui: { startMenu: { cursor: 0, order: ["pokedex", "pokemon", "bag"] } },
  }), {
    kind: "choose-start-menu-item",
    targetItem: "bag",
    targetIndex: 2,
    objective: "collect:MAP_ITEMFINDER_ROUTE:hidden:0",
  });
  assert.deepEqual(recommend({
    mode: "bag",
    ui: { bag: { stage: "list", pocket: 0, index: 0, selectedItemId: 13 } },
  }), {
    kind: "choose-bag-pocket",
    targetPocket: 1,
    objective: "collect:MAP_ITEMFINDER_ROUTE:hidden:0",
  });
  assert.deepEqual(recommend({
    mode: "bag",
    ui: { bag: { stage: "list", pocket: 1, index: 0, selectedItemId: 261 } },
  }), {
    kind: "choose-bag-item",
    targetItemId: 261,
    targetIndex: 0,
    objective: "collect:MAP_ITEMFINDER_ROUTE:hidden:0",
  });
  assert.deepEqual(recommend({
    mode: "bag",
    ui: { bag: {
      stage: "context",
      pocket: 1,
      contextCursor: 1,
      selectedItemId: 261,
      selectedAction: "register",
    } },
  }), {
    kind: "choose-bag-context-action",
    targetAction: "use",
    targetIndex: 0,
    objective: "collect:MAP_ITEMFINDER_ROUTE:hidden:0",
  });
});

test("the quest policy faces water and uses the exact rod selected by coverage", () => {
  const map = mapFromCollisionRows({
    id: "MAP_ROUTE11",
    rows: ["....", "....", "...."],
    behaviors: {
      "1,0": "MB_OCEAN_WATER",
      "1,1": "MB_OCEAN_WATER",
      "1,2": "MB_OCEAN_WATER",
    },
  });
  const world = { maps: [map] };
  const objective = {
    id: "mastery-capture:MAP_ROUTE11:116",
    target: {
      kind: "fishing-zone",
      map: map.id,
      rodItemId: 263,
    },
    captureSpecies: [116],
    encounterMethod: "fishing",
    rodItemId: 263,
    regionalMastery: true,
  };
  const campaignPlanner = {
    select: () => objective,
    selectCollection: () => null,
    selectTraining: () => null,
  };
  const recommend = ({ mode = "overworld", facing = "south", ui = {} } = {}) => {
    const observed = observation({
      emulator: { mode },
      playerMemory: {
        map: { id: map.id },
        position: { x: 0, y: 1 },
        avatar: { facing, onFoot: true, surfing: false },
        storyState: { flagIds: { 2082: true } },
        trainer: {
          partyCount: 1,
          usablePartyCount: 1,
          party: [{ slot: 0, species: 5, level: 30, hp: 80, maxHp: 80 }],
          bag: {
            keyItems: [{ itemId: 263, quantity: 1 }],
            pokeBalls: [{ itemId: 4, quantity: 20 }],
          },
        },
        ui,
      },
    });
    return createPolicyAdvisors({ world, campaignPlanner })
      .find(({ id }) => id === "quest")
      .advise(observed)?.recommendation;
  };

  assert.deepEqual(recommend(), {
    kind: "face-fishing-water",
    direction: "east",
    objective: objective.id,
  });
  assert.deepEqual(recommend({ facing: "east" }), {
    kind: "open-start-menu",
    objective: objective.id,
  });
  assert.deepEqual(recommend({
    mode: "start-menu",
    facing: "east",
    ui: { startMenu: { cursor: 0, order: ["pokedex", "pokemon", "bag"] } },
  }), {
    kind: "choose-start-menu-item",
    targetItem: "bag",
    targetIndex: 2,
    objective: objective.id,
  });
  assert.deepEqual(recommend({
    mode: "bag",
    facing: "east",
    ui: { bag: { stage: "list", pocket: 0, index: 0 } },
  }), {
    kind: "choose-bag-pocket",
    targetPocket: 1,
    objective: objective.id,
  });
  assert.deepEqual(recommend({
    mode: "bag",
    facing: "east",
    ui: { bag: { stage: "list", pocket: 1, index: 0, selectedItemId: 263 } },
  }), {
    kind: "choose-bag-item",
    targetItemId: 263,
    targetIndex: 0,
    objective: objective.id,
  });
  assert.deepEqual(recommend({
    mode: "bag",
    facing: "east",
    ui: { bag: {
      stage: "context",
      pocket: 1,
      contextCursor: 1,
      selectedItemId: 263,
      selectedAction: "register",
    } },
  }), {
    kind: "choose-bag-context-action",
    targetAction: "use",
    targetIndex: 0,
    objective: objective.id,
  });
});

test("the quest policy activates a charged VS Seeker beside its rematch trainer", () => {
  const map = mapFromCollisionRows({
    id: "MAP_ROUTE11",
    rows: [".....", ".....", ".....", ".....", "....."],
    objectEvents: [{ x: 3, y: 2, trainer_type: "TRAINER_TYPE_NORMAL" }],
  });
  const world = { maps: [map] };
  const objective = {
    id: "train-battle-member-with-vs-seeker",
    target: { kind: "object", map: map.id, index: 0 },
    trainingSource: "vs-seeker",
    vsSeekerAction: "activate",
    trainer: { id: 42, baseId: 41, localId: 1, rematchTier: 1 },
  };
  const storyObjective = {
    id: "prepare-league",
    target: { kind: "object", map: map.id, index: 0 },
    minimumTeamAnchorLevel: 70,
  };
  const campaignPlanner = {
    select: () => storyObjective,
    selectCollection: () => null,
    selectTraining: () => objective,
  };
  const recommend = ({ mode = "overworld", ui = {}, objectEvents = [{localId:1,map:{id:map.id},current:{x:3,y:2}}] } = {}) => {
    const observed = observation({
      emulator: { mode },
      playerMemory: {
        map: { id: map.id },
        position: { x: 1, y: 2 },
        objectEvents,
        vsSeeker: {
          batterySteps: 100,
          responseClearSteps: 0,
          rematchEntries: Array(100).fill(0),
        },
        trainer: {
          partyCount: 1,
          usablePartyCount: 1,
          party: [{ slot: 0, species: 6, level: 50, hp: 150, maxHp: 150 }],
          bag: { keyItems: [{ itemId: 362, quantity: 1 }] },
        },
        ui,
      },
    });
    return createPolicyAdvisors({ world, campaignPlanner })
      .find(({ id }) => id === "quest")
      .advise(observed)?.recommendation;
  };

  assert.deepEqual(recommend(), {
    kind: "open-start-menu",
    objective: objective.id,
  });
  assert.deepEqual(recommend({
    mode: "start-menu",
    ui: { startMenu: { cursor: 0, order: ["pokedex", "pokemon", "bag"] } },
  }), {
    kind: "choose-start-menu-item",
    targetItem: "bag",
    targetIndex: 2,
    objective: objective.id,
  });
  assert.deepEqual(recommend({
    mode: "bag",
    ui: { bag: { stage: "list", pocket: 0, index: 0 } },
  }), {
    kind: "choose-bag-pocket",
    targetPocket: 1,
    objective: objective.id,
  });
  assert.deepEqual(recommend({
    mode: "bag",
    ui: { bag: { stage: "list", pocket: 1, index: 0, selectedItemId: 362 } },
  }), {
    kind: "choose-bag-item",
    targetItemId: 362,
    targetIndex: 0,
    objective: objective.id,
  });
  assert.deepEqual(recommend({
    mode: "bag",
    ui: { bag: {
      stage: "context",
      pocket: 1,
      contextCursor: 1,
      selectedItemId: 362,
      selectedAction: "register",
    } },
  }), {
    kind: "choose-bag-context-action",
    targetAction: "use",
    targetIndex: 0,
    objective: objective.id,
  });
  for (const objectEvents of [[],
    [{localId:1,map:{id:map.id},current:{x:9,y:2}}],
    [{localId:1,map:{id:map.id},current:{x:3,y:8}}],
    [{localId:1,map:{id:'MAP_OTHER'},current:{x:3,y:2}}]]) {
    assert.notEqual(recommend({objectEvents})?.kind,'open-start-menu');
    assert.notEqual(recommend({objectEvents,mode:'bag',ui:{bag:{stage:'context',selectedItemId:362}}})?.kind,
      'choose-bag-context-action','recheck active trainer visibility at item-use confirmation');
  }
});

test("the quest policy reaches the scored VS Seeker batch anchor before activating", () => {
  const map = mapFromCollisionRows({
    id: "MAP_BATCH_ROUTE",
    rows: [".....", ".....", ".....", ".....", "....."],
    objectEvents: [{ x: 3, y: 2, trainer_type: "TRAINER_TYPE_NORMAL" }],
  });
  const world = { maps: [map] };
  const objective = {
    id: "train-battle-member-with-vs-seeker",
    target: { kind: "vs-seeker-activation", map: map.id, x: 2, y: 2 },
    trainingSource: "vs-seeker",
    vsSeekerAction: "activate",
    trainer: { id: 42, baseId: 41, localId: 1, rematchTier: 1 },
    vsSeekerBatch: {
      responderCount: 1,
      localIds: [1],
      expectedExperience: 5000,
      expectedPayout: 1000,
    },
  };
  const storyObjective = {
    id: "prepare-league",
    target: { kind: "object", map: map.id, index: 0 },
    minimumTeamAnchorLevel: 70,
  };
  const campaignPlanner = {
    select: () => storyObjective,
    selectCollection: () => null,
    selectTraining: () => objective,
  };
  const recommend = (position, advisorId = "quest") =>
    createPolicyAdvisors({ world, campaignPlanner })
    .find(({ id }) => id === advisorId)
    .advise(observation({
      emulator: { mode: "overworld" },
      playerMemory: {
        map: { id: map.id },
        position,
        objectEvents: [{localId:1,map:{id:map.id},current:{x:3,y:2}}],
        vsSeeker: {
          batterySteps: 100,
          responseClearSteps: 0,
          rematchEntries: Array(100).fill(0),
        },
        trainer: {
          partyCount: 1,
          usablePartyCount: 1,
          party: [{ slot: 0, species: 6, level: 50, hp: 150, maxHp: 150 }],
          bag: { keyItems: [{ itemId: 362, quantity: 1 }] },
        },
        ui: {},
      },
    }))?.recommendation;

  const approach = recommend({ x: 1, y: 2 }, "navigation");
  assert.equal(approach?.kind, "move-toward");
  assert.equal(approach?.direction, "east");
  assert.equal(approach?.objective, objective.id);
  assert.deepEqual(approach?.target, {
    kind: "vs-seeker-activation",
    x: 2,
    y: 2,
  });
  assert.deepEqual(recommend({ x: 2, y: 2 }), {
    kind: "open-start-menu",
    objective: objective.id,
  });
});

test("a reached VS Seeker anchor keeps its activation command fresh and its trainer commitment", () => {
  const map = mapFromCollisionRows({
    id: "MAP_VS_INTENT_ROUTE",
    rows: [
      ".........................",
      ".........................",
      ".........................",
      ".........................",
      ".........................",
    ],
    objectEvents: [
      {
        x: 3,
        y: 2,
        trainer_type: "TRAINER_TYPE_NORMAL",
        script: "VsIntentRoute_EventScript_Ada",
      },
      {
        x: 22,
        y: 2,
        trainer_type: "TRAINER_TYPE_NORMAL",
        script: "VsIntentRoute_EventScript_Bea",
      },
    ],
  });
  const story = {
    symbols: { trainers: {
      TRAINER_ADA: { value: 41 },
      TRAINER_BEA: { value: 51 },
    } },
    scripts: [
      {
        label: "VsIntentRoute_EventScript_Ada",
        instructions: [{
          op: "trainerbattle_single",
          args: ["TRAINER_ADA", "intro", "defeat"],
        }],
      },
      {
        label: "VsIntentRoute_EventScript_Bea",
        instructions: [{
          op: "trainerbattle_single",
          args: ["TRAINER_BEA", "intro", "defeat"],
        }],
      },
    ],
  };
  const vsMechanics = {
    species: [{
      id: 96,
      name: "SPECIES_DROWZEE",
      expYield: 100,
    }],
    trainers: [
      {
        id: 41,
        name: "TRAINER_ADA",
        trainerName: "ADA",
        party: [{ lvl: 20, species: "SPECIES_DROWZEE" }],
      },
      {
        id: 42,
        name: "TRAINER_ADA_REMATCH",
        trainerName: "ADA",
        party: [
          { lvl: 35, species: "SPECIES_DROWZEE" },
          { lvl: 35, species: "SPECIES_DROWZEE" },
        ],
      },
      {
        id: 51,
        name: "TRAINER_BEA",
        trainerName: "BEA",
        party: [{ lvl: 20, species: "SPECIES_DROWZEE" }],
      },
      {
        id: 52,
        name: "TRAINER_BEA_REMATCH",
        trainerName: "BEA",
        party: [{ lvl: 35, species: "SPECIES_DROWZEE" }],
      },
    ],
    rematches: [
      {
        map: map.id,
        trainerNames: ["TRAINER_ADA", "TRAINER_ADA_REMATCH"],
        trainerIds: [41, 42],
      },
      {
        map: map.id,
        trainerNames: ["TRAINER_BEA", "TRAINER_BEA_REMATCH"],
        trainerIds: [51, 52],
      },
    ],
  };
  const planner = createCampaignPlanner({
    campaign: { objectives: [{
      id: "prepare-league",
      target: { kind: "object", map: map.id, index: 1 },
      completion: { kind: "flag-set", id: 9999 },
      minimumTeamAnchorLevel: 70,
    }] },
    world: { maps: [map] },
    story,
    mechanics: vsMechanics,
  });
  let cartridgeFrame = 100;
  const timedPlanner = {
    ...planner,
    selectTraining(...args) {
      // Model the observed desktop cost without a wall-clock-sensitive test.
      // One full search fits the safety window; an unnecessary fallback does not.
      cartridgeFrame += 80;
      return planner.selectTraining(...args);
    },
  };
  const player = createCentralPlayer({
    advisors: createPolicyAdvisors({
      mechanics: vsMechanics,
      world: { maps: [map] },
      campaignPlanner: timedPlanner,
    }),
    campaignPlanner: planner,
  });
  const observed = ({ captureId, frame, mode, ui }) => observation({
    captureId,
    frame,
    emulator: { mode },
    playerMemory: {
      map: { id: map.id },
      position: { x: 2, y: 2 },
      encounter: null,
      objectEvents: map.objectEvents.map((object,index)=>({localId:index+1,map:{id:map.id},current:{x:object.x,y:object.y}})),
      storyState: { flagIds: {
        658: true,
        [0x500 + 41]: true,
        [0x500 + 42]: false,
        [0x500 + 51]: true,
        [0x500 + 52]: false,
        9999: false,
      } },
      vsSeeker: {
        batterySteps: 100,
        responseClearSteps: 0,
        rematchEntries: Array(100).fill(0),
      },
      trainer: {
        partyCount: 1,
        usablePartyCount: 1,
        party: [{
          slot: 0,
          species: 6,
          level: 50,
          hp: 150,
          maxHp: 150,
          moves: [53],
        }],
        bag: { keyItems: [{ itemId: 362, quantity: 1 }] },
      },
      ui,
    },
  });

  const overworld = observed({
    captureId: "vs-intent-overworld",
    frame: 100,
    mode: "overworld",
    ui: {},
  });
  const storyObjective = planner.select(overworld);
  assert.equal(storyObjective?.id, "prepare-league");
  assert.equal(
    planner.selectTraining(overworld, storyObjective)?.trainer?.id,
    42,
    "the fixture must begin committed to the visible high-value rematch",
  );

  const open = player.decide(overworld);
  assert.equal(open.winner?.advisor, "quest", JSON.stringify(open, null, 2));
  assert.deepEqual(open.winner?.recommendation, {
    kind: "open-start-menu",
    objective: "train-team-anchor-with-vs-seeker",
  });
  assert.equal(actionPreconditionMatches(open.action.precondition, {
    ...overworld, frame: cartridgeFrame,
  }), true, "the activation command must reach the worker before its safety deadline");

  const chooseBag = player.decide(observed({
    captureId: "vs-intent-start-menu",
    frame: cartridgeFrame + 1,
    mode: "start-menu",
    ui: { startMenu: { cursor: 0, order: ["pokedex", "pokemon", "bag"] } },
  }));
  assert.deepEqual(chooseBag.winner?.recommendation, {
    kind: "choose-start-menu-item",
    targetItem: "bag",
    targetIndex: 2,
    objective: "train-team-anchor-with-vs-seeker",
  });
});

test("an unreachable VS Seeker anchor still routes to an accessible alternative", () => {
  const map = mapFromCollisionRows({
    id: "MAP_BLOCKED_BATCH_ROUTE",
    rows: ["..#..", "..#..", "..#..", "..#..", "..#.."],
    objectEvents: [{ x: 4, y: 2 }, { x: 1, y: 3 }],
  });
  const blocked = { id: "train-blocked-batch", trainingSource: "vs-seeker", trainer: { id: 42 },
    target: { kind: "vs-seeker-activation", map: map.id, x: 4, y: 1 } };
  const alternative = { id: "train-accessible-batch", trainingSource: "vs-seeker", trainer: { id: 52 },
    target: { kind: "vs-seeker-activation", map: map.id, x: 1, y: 2 } };
  const recommendation = createPolicyAdvisors({ world: { maps: [map] }, campaignPlanner: {
    select: () => ({ id: "prepare-boss", target: { kind: "object", map: map.id, index: 0 } }),
    selectTraining: (_observation, _objective, { excludedTrainerIds }) =>
      excludedTrainerIds.includes(42) ? alternative : blocked,
  } }).find(({ id }) => id === "navigation").advise(observation({ playerMemory: {
    map: { id: map.id }, position: { x: 0, y: 0 }, trainer: { partyCount: 1, party: [] },
  } }))?.recommendation;
  assert.equal(recommendation?.kind, "move-toward");
  assert.equal(recommendation?.objective, "train-accessible-batch");
  assert.deepEqual(recommendation?.target, { kind: "vs-seeker-activation", x: 1, y: 2 });
});

test('training navigation searches past multiple unreachable trainers without losing its parent objective', () => {
  const map=mapFromCollisionRows({id:'MAP_TRAINING_FALLBACKS',
    rows:['..#..','..#..','..#..','..#..','..#..']});
  const choices=[
    {id:'first',trainer:{id:42,baseId:41},x:4,y:1},
    {id:'second',trainer:{id:52,baseId:51},x:4,y:3},
    {id:'reachable',trainer:{id:62,baseId:61},x:1,y:3},
  ].map(({x,y,...choice})=>({...choice,forObjective:'next-badge',trainingSource:'vs-seeker',
    target:{kind:'vs-seeker-activation',map:map.id,x,y}}));
  const parent={id:'next-badge',target:{kind:'object',map:map.id,index:0}};
  let committed=null;
  const advisors=createPolicyAdvisors({world:{maps:[map]},campaignPlanner:{
    select:()=>parent,
    selectTraining:(_o,_objective,{excludedTrainerIds})=>choices.find(c=>
      !excludedTrainerIds.includes(c.trainer.id)&&!excludedTrainerIds.includes(c.trainer.baseId))??null,
    commitTrainingSelection:selection=>{committed=selection;},
  }});
  const o=observation({playerMemory:{map:{id:map.id},position:{x:0,y:0},
    trainer:{partyCount:1,party:[]}}});
  const nav=advisors.find(a=>a.id==='navigation'),winner=nav.advise(o);
  assert.equal(winner?.recommendation.kind,'move-toward');
  assert.equal(winner.recommendation.objective,'reachable');
  nav.observeDecision(o,{kind:'act',winner});
  assert.equal(committed?.trainer.id,62,'commit the route that actually won');
  assert.equal(committed?.forObjective,'next-badge');
  assert.equal(parent.id,'next-badge');
});

test('training fallback terminates when the planner repeats an excluded trainer', () => {
  const map=mapFromCollisionRows({id:'MAP_NO_TRAINING_EXIT',rows:['.#.','.#.','.#.']});
  let reads=0;
  const recommendation=createPolicyAdvisors({world:{maps:[map]},campaignPlanner:{
    select:()=>({id:'next-badge',target:{kind:'object',map:map.id,index:0}}),
    selectTraining:()=>{
      assert.ok(++reads<=3,'a repeated candidate cannot cause unbounded replanning');
      return {id:'blocked',trainingSource:'vs-seeker',trainer:{id:42},
        target:{kind:'vs-seeker-activation',map:map.id,x:2,y:1}};
    },
  }}).find(a=>a.id==='navigation').advise(observation({playerMemory:{
    map:{id:map.id},position:{x:0,y:0},trainer:{partyCount:1,party:[]},
  }}))?.recommendation;
  assert.equal(recommendation?.kind,'wait-for-supported-objective');
});

test("an active VS Seeker batch prefers a nearby free healer before the bag", () => {
  const route = mapFromCollisionRows({
    id: "MAP_VS_LOCAL_ROUTE",
    rows: [".....", ".....", ".....", ".....", "....."],
    connections: [{
      direction: "down",
      map: "MAP_VS_LOCAL_CITY",
      offset: 0,
    }],
    objectEvents: [{ x: 3, y: 2, trainer_type: "TRAINER_TYPE_NORMAL" }],
  });
  const city = mapFromCollisionRows({
    id: "MAP_VS_LOCAL_CITY",
    rows: [".....", ".....", "..#..", ".....", "....."],
    connections: [{ direction: "up", map: route.id, offset: 0 }],
    warpEvents: [{
      x: 2,
      y: 2,
      dest_map: "MAP_VS_LOCAL_CITY_POKEMON_CENTER_1F",
      dest_warp_id: "1",
    }],
    behaviors: { "2,2": "MB_WARP_DOOR" },
  });
  const center = mapFromCollisionRows({
    id: "MAP_VS_LOCAL_CITY_POKEMON_CENTER_1F",
    rows: [".....", ".....", ".....", ".....", "....."],
    warpEvents: [
      { x: 1, y: 4, dest_map: city.id, dest_warp_id: "0" },
      { x: 2, y: 4, dest_map: city.id, dest_warp_id: "0" },
      { x: 3, y: 4, dest_map: city.id, dest_warp_id: "0" },
    ],
    objectEvents: [{
      x: 2,
      y: 1,
      script: "VsLocalCity_PokemonCenter_1F_EventScript_Nurse",
    }],
    behaviors: { "2,4": "MB_SOUTH_ARROW_WARP" },
  });
  const storyObjective = {
    id: "prepare-league",
    target: { kind: "object", map: "MAP_INDIGO_PLATEAU", index: 0 },
    minimumTeamAnchorLevel: 70,
  };
  const trainingObjective = {
    id: "train-battle-member-with-vs-seeker",
    target: { kind: "object", map: route.id, index: 0 },
    trainingSource: "vs-seeker",
    vsSeekerAction: "battle",
    trainingPartySlot: 0,
    forObjective: storyObjective.id,
    trainer: { id: 42, baseId: 41, localId: 1, rematchTier: 1 },
  };
  const campaignPlanner = {
    select: () => storyObjective,
    selectTraining: () => trainingObjective,
  };
  const rematchEntries = Array(100).fill(0);
  rematchEntries[1] = 1;
  const recommend = ({ mode = "overworld", ui = {}, hp = 40, items = [{
    itemId: 13,
    quantity: 3,
  }] } = {}) => {
    const observed = observation({
      emulator: { mode },
      playerMemory: {
        map: { id: route.id },
        position: { x: 1, y: 2 },
        vsSeeker: {
          batterySteps: 0,
          responseClearSteps: 0,
          rematchEntries,
        },
        trainer: {
          partyCount: 1,
          usablePartyCount: 1,
          party: [{
            slot: 0,
            species: 6,
            level: 50,
            hp,
            maxHp: 100,
            moves: [53],
            pp: [10],
          }],
          bag: { items },
        },
        ui,
      },
    });
    return createPolicyAdvisors({
      mechanics,
      world: { maps: [route, city, center] },
      campaignPlanner,
    }).find(({ id }) => id === "inventory").advise(observed)?.recommendation;
  };

  const nearbyRecovery = recommend();
  assert.equal(nearbyRecovery?.objective, "recover-training-party");
  assert.equal(
    nearbyRecovery?.targetMap,
    "MAP_VS_LOCAL_CITY_POKEMON_CENTER_1F",
  );
  assert.notEqual(nearbyRecovery?.kind, "open-start-menu");
  assert.deepEqual(recommend({
    mode: "start-menu",
    ui: { startMenu: { cursor: 0, order: ["pokedex", "pokemon", "bag"] } },
  }), {
    kind: "choose-start-menu-item",
    targetItem: "bag",
    targetIndex: 2,
    objective: "recover-vs-seeker-party",
  });
  assert.deepEqual(recommend({
    mode: "bag",
    ui: { bag: { stage: "list", pocket: 0, index: 0 } },
  }), {
    kind: "choose-bag-item",
    targetItemId: 13,
    targetIndex: 0,
    objective: "recover-vs-seeker-party",
  });
  assert.deepEqual(recommend({
    mode: "bag",
    ui: { bag: { stage: "context", selectedItemId: 13 } },
  }), {
    kind: "choose-bag-context-action",
    targetAction: "use",
    targetIndex: 0,
    objective: "recover-vs-seeker-party",
  });
  assert.deepEqual(recommend({
    mode: "party",
    ui: { party: { stage: "choose-pokemon", itemId: 13 } },
  }), {
    kind: "choose-party-member",
    targetPartySlot: 0,
    targetSpecies: 6,
    objective: "recover-vs-seeker-party",
  });
  assert.deepEqual(recommend({
    mode: "party",
    hp: 80,
    ui: { party: { stage: "message", itemId: 13 } },
  }), {
    kind: "acknowledge-cartridge-prompt",
    objective: "recover-vs-seeker-party",
  });
  const centerFallback = recommend({ items: [] });
  assert.equal(centerFallback?.objective, "recover-training-party");
  assert.equal(centerFallback?.targetMap, center.id);
});

test("trade preparation cannot take over a medicine picker or an unrelated script's party menu", () => {
  const campaignPlanner = {
    select: () => ({ id: "master-mr-mime-trade", target: { kind: "in-game-trade", map: "MAP_ROUTE2_HOUSE",
      requestedSpecies: 63, receivedSpecies: 122 } }),
    selectCollection: () => null,
    selectTraining: () => null,
  };
  const party = [
    { slot: 0, species: 56, level: 22, hp: 0, maxHp: 51 },
    { slot: 1, species: 8, level: 29, hp: 36, maxHp: 82, moves: [55], pp: [20] },
    { slot: 2, species: 34, level: 24, hp: 76, maxHp: 76 },
    { slot: 3, species: 22, level: 23, hp: 70, maxHp: 70 },
    { slot: 4, species: 63, level: 10, hp: 27, maxHp: 27 },
  ];
  const advisors = createPolicyAdvisors({ mechanics, campaignPlanner });
  for (const [map, menuType, actionId, itemId] of [
    ["MAP_DIGLETTS_CAVE_B1F", 0, 3, 22],
    ["MAP_ROUTE2_HOUSE", 0, 3, 22],
    ["MAP_ROUTE2_HOUSE", 0, 14, 22],
    ["MAP_ROUTE2_HOUSE", 0, 0, undefined],
    ["MAP_ROUTE2_HOUSE", undefined, undefined, undefined],
    ["MAP_DIGLETTS_CAVE_B1F", 3, 11, undefined],
  ]) {
    const observed = observation({ emulator: { mode: "party" }, playerMemory: {
      map: { id: map }, trainer: { party, partyCount: 5, usablePartyCount: 4, bag: { items: [{ itemId: 22, quantity: 4 }] } },
      ui: { party: { stage: "choose-pokemon", cursor: 4, menuType, actionId, itemId } },
    } });
    assert.notEqual(advisors.find(({ id }) => id === "quest").advise(observed)?.recommendation.workflowKind, "in-game-trade");
    if (itemId === 22) {
      const decision = createCentralPlayer({ advisors }).decide(observed);
      assert.equal(decision.winner?.recommendation.targetPartySlot, 1);
      assert.equal(decision.winner?.advisor, "inventory");
    }
  }
});

test("a restored stale trade workflow releases bag and medicine menus", () => {
  const initialState = structuredClone(createCentralPlayer().state());
  initialState.workflow = { schema: "master-red/control-workflow/v1", id: "in-game-trade-74151",
    map: "MAP_ROUTE2_HOUSE",
    kind: "in-game-trade", objective: "master-mr-mime-trade", requestedSpecies: 63, receivedSpecies: 122,
    targetPartySlot: 4, sourceAdvisor: "quest", stage: "selecting-offer", enteredTrade: false,
    startedObservationId: "before-checkpoint", startedFrame: 1 };
  for (const [mode, ui] of [
    ["bag", { bag: { stage: "context", pocket: 0, selectedItemId: 22 } }],
    ["party", { party: { stage: "choose-pokemon", cursor: 4, menuType: 0, actionId: 3, itemId: 22 } }],
    ["party", { party: { stage: "message", cursor: 4, menuType: 0, actionId: 3, itemId: 22 } }],
  ]) {
    const player = createCentralPlayer({ initialState, advisors: createPolicyAdvisors({ mechanics }) });
    const decision = player.decide(observation({ emulator: { mode }, playerMemory: {
      map: { id: "MAP_DIGLETTS_CAVE_B1F" }, ui, trainer: { partyCount: 2, usablePartyCount: 2,
        party: [{ slot: 1, species: 8, level: 29, hp: 36, maxHp: 82 }, { slot: 4, species: 63, level: 10, hp: 27, maxHp: 27 }],
        bag: { items: [{ itemId: 22, quantity: 4 }] } },
    } }));
    assert.equal(player.state().workflow, null);
    assert.notEqual(decision.winner?.recommendation.objective, "master-mr-mime-trade");
    if (ui.party?.stage === "choose-pokemon") assert.equal(decision.winner?.recommendation.targetPartySlot, 1);
  }
});

test("the quest policy selects the requested species for an in-game trade", () => {
  const tradeObjective = {
    id: "master-mr-mime-trade",
    target: {
      kind: "in-game-trade",
      map: "MAP_ROUTE2_HOUSE",
      index: 1,
      requestedSpecies: 63,
      receivedSpecies: 122,
    },
  };
  const observed = observation({
    emulator: { mode: "party" },
    playerMemory: {
      map: { id: "MAP_ROUTE2_HOUSE" },
      trainer: {
        partyCount: 3,
        usablePartyCount: 3,
        party: [
          { slot: 0, species: 9, level: 28, hp: 90, maxHp: 90 },
          { slot: 1, species: 22, level: 25, hp: 70, maxHp: 70 },
          { slot: 2, species: 63, level: 12, hp: 30, maxHp: 30 },
        ],
      },
      ui: { party: { stage: "choose-pokemon", cursor: 0, menuType: 3, actionId: 11 } },
    },
  });
  const recommendation = createPolicyAdvisors({
    mechanics,
    campaignPlanner: {
      select: () => tradeObjective,
      selectCollection: () => null,
      selectTraining: () => null,
    },
  }).find(({ id }) => id === "quest").advise(observed)?.recommendation;

  assert.deepEqual(recommendation, {
    kind: "choose-party-member",
    targetPartySlot: 2,
    targetSpecies: 63,
    objective: tradeObjective.id,
    workflowKind: "in-game-trade",
    requestedSpecies: 63,
    receivedSpecies: 122,
  });
});

test("the central trade workflow survives animation and acknowledges only completion", () => {
  const tradeObjective = {
    id: "master-mr-mime-trade",
    target: {
      kind: "in-game-trade",
      map: "MAP_ROUTE2_HOUSE",
      index: 1,
      requestedSpecies: 63,
      receivedSpecies: 122,
    },
  };
  const campaignPlanner = {
    select: () => tradeObjective,
    selectCollection: () => null,
    selectTraining: () => null,
  };
  const player = createCentralPlayer({
    advisors: createPolicyAdvisors({ mechanics, campaignPlanner }),
  });
  const party = [
    { slot: 0, species: 9, level: 28, hp: 90, maxHp: 90 },
    { slot: 1, species: 22, level: 25, hp: 70, maxHp: 70 },
    { slot: 2, species: 63, level: 12, hp: 30, maxHp: 30 },
  ];
  const observed = ({ captureId, frame, phase = "stable", mode, ui, members = party }) =>
    observation({
      captureId,
      frame,
      phase,
      phaseReasons: phase === "stable" ? [] : ["in-game-trade-animation"],
      emulator: { mode, callback2: "CB2_InGameTrade" },
      playerMemory: {
        map: { id: "MAP_ROUTE2_HOUSE" },
        trainer: {
          partyCount: members.length,
          usablePartyCount: members.filter(({ hp }) => hp > 0).length,
          party: members,
        },
        ui,
      },
    });

  const selection = player.decide(observed({
    captureId: "trade-party-selection",
    frame: 200,
    mode: "party",
    ui: { party: { stage: "choose-pokemon", cursor: 0, menuType: 3, actionId: 11 } },
  }));
  assert.equal(selection.winner?.recommendation.kind, "choose-party-member");
  assert.equal(player.state().workflow?.kind, "in-game-trade");

  const animation = player.decide(observed({
    captureId: "trade-animation",
    frame: 201,
    phase: "transition",
    mode: "in-game-trade",
    ui: { inGameTrade: { stage: "animation", state: 70 } },
  }));
  assert.equal(animation.kind, "resample");
  assert.deepEqual(animation.action.buttons, []);
  assert.equal(player.state().workflow?.kind, "in-game-trade");

  const completion = player.decide(observed({
    captureId: "trade-completion",
    frame: 202,
    mode: "in-game-trade",
    ui: { inGameTrade: { stage: "completion", state: 71 } },
  }));
  assert.deepEqual(completion.winner?.recommendation, {
    kind: "acknowledge-cartridge-prompt",
    objective: tradeObjective.id,
  });
  assert.deepEqual(completion.action.buttons, ["a"]);

  player.decide(observed({
    captureId: "trade-finished",
    frame: 203,
    mode: "overworld",
    ui: {},
    members: [
      party[0],
      party[1],
      { slot: 2, species: 122, level: 12, hp: 30, maxHp: 30 },
    ],
  }));
  assert.equal(player.state().workflow, null);
});

test("a resumed trade completion recovers without an in-memory workflow", () => {
  const tradeObjective = {
    id: "master-mr-mime-trade",
    target: {
      kind: "in-game-trade",
      map: "MAP_ROUTE2_HOUSE",
      index: 1,
      requestedSpecies: 63,
      receivedSpecies: 122,
    },
  };
  const observed = observation({
    captureId: "resumed-trade-completion",
    emulator: { mode: "in-game-trade", callback2: "CB2_InGameTrade" },
    playerMemory: {
      map: { id: "MAP_ROUTE2_HOUSE" },
      trainer: {
        partyCount: 1,
        usablePartyCount: 1,
        party: [{ slot: 0, species: 63, level: 12, hp: 30, maxHp: 30 }],
      },
      ui: { inGameTrade: { stage: "completion", state: 71 } },
    },
  });
  const player = createCentralPlayer({
    advisors: createPolicyAdvisors({
      mechanics,
      campaignPlanner: {
        select: () => tradeObjective,
        selectCollection: () => null,
        selectTraining: () => null,
      },
    }),
  });

  const decision = player.decide(observed);
  assert.deepEqual(decision.winner?.recommendation, {
    kind: "acknowledge-cartridge-prompt",
    objective: tradeObjective.id,
    workflowKind: "in-game-trade",
    requestedSpecies: 63,
    receivedSpecies: 122,
  });
  assert.deepEqual(decision.action.buttons, ["a"]);
});

test("the quest policy moves EXP Share when its holder reaches the training floor", () => {
  const storyObjective = {
    id: "prepare-league",
    target: { kind: "object", map: "MAP_INDIGO_PLATEAU", index: 0 },
  };
  const trainingObjective = {
    id: "train-battle-member",
    target: { kind: "encounter-zone", map: "MAP_VICTORY_ROAD_2F" },
    trainingPartySlot: 2,
    expSharePartySlot: 1,
    forObjective: storyObjective.id,
  };
  const campaignPlanner = {
    select: () => storyObjective,
    selectCollection: () => null,
    selectTraining: () => trainingObjective,
  };
  const party = [
    { slot: 0, species: 6, level: 75, hp: 210, maxHp: 210, heldItem: 182 },
    { slot: 1, species: 131, level: 60, hp: 200, maxHp: 200, heldItem: 0 },
    { slot: 2, species: 135, level: 62, hp: 150, maxHp: 150, heldItem: 0 },
  ];
  const recommend = ({ mode = "overworld", ui = {}, currentParty = party } = {}) => {
    const observed = observation({
      emulator: { mode },
      playerMemory: {
        map: { id: "MAP_VICTORY_ROAD_2F" },
        trainer: {
          partyCount: party.length,
          usablePartyCount: party.length,
          party: currentParty,
          bag: { items: [] },
        },
        ui,
      },
    });
    return createPolicyAdvisors({ mechanics, campaignPlanner })
      .find(({ id }) => id === "quest")
      .advise(observed)?.recommendation;
  };

  assert.deepEqual(recommend(), {
    kind: "open-start-menu",
    objective: "move-exp-share-to-slot-1",
  });
  assert.deepEqual(recommend({
    mode: "start-menu",
    ui: { startMenu: { cursor: 0, order: ["pokedex", "pokemon", "bag"] } },
  }), {
    kind: "choose-start-menu-item",
    targetItem: "pokemon",
    targetIndex: 1,
    objective: "move-exp-share-to-slot-1",
  });
  assert.deepEqual(recommend({
    mode: "party",
    ui: { party: { stage: "choose-pokemon", cursor: 1 } },
  }), {
    kind: "choose-party-member",
    targetPartySlot: 0,
    targetSpecies: 6,
    objective: "move-exp-share-to-slot-1",
  });
  assert.deepEqual(recommend({
    mode: "party",
    ui: { party: {
      stage: "selection-menu",
      selectedPartySlot: 0,
      actions: ["summary", "switch", "item", "cancel"],
      actionCursor: 0,
    } },
  }), {
    kind: "choose-party-action",
    targetAction: "item",
    targetIndex: 2,
    objective: "move-exp-share-to-slot-1",
  });
  assert.deepEqual(recommend({
    mode: "party",
    ui: { party: {
      stage: "selection-menu",
      selectedPartySlot: 0,
      actions: ["give", "take-item", "cancel"],
      actionCursor: 0,
    } },
  }), {
    kind: "choose-party-action",
    targetAction: "take-item",
    targetIndex: 1,
    objective: "move-exp-share-to-slot-1",
  });
  const occupiedTargetParty = [
    party[0],
    { ...party[1], heldItem: 189 },
    party[2],
  ];
  assert.deepEqual(recommend({ currentParty: occupiedTargetParty }), {
    kind: "open-start-menu",
    objective: "move-exp-share-to-slot-1",
  });
  assert.deepEqual(recommend({
    mode: "party",
    currentParty: occupiedTargetParty,
    ui: { party: { stage: "choose-pokemon", cursor: 0 } },
  }), {
    kind: "choose-party-member",
    targetPartySlot: 1,
    targetSpecies: 131,
    objective: "move-exp-share-to-slot-1",
  });
});

test("the quest policy gives a collected type booster to a compatible battler", () => {
  const campaignPlanner = createCampaignPlanner({ campaign: { objectives: [] } });
  const baseParty = [
    {
      slot: 0,
      species: 6,
      level: 40,
      hp: 120,
      maxHp: 120,
      heldItem: 0,
      moves: [53, 17],
      stats: { speed: 100 },
    },
    {
      slot: 1,
      species: 131,
      level: 35,
      hp: 140,
      maxHp: 140,
      heldItem: 0,
      moves: [57],
      stats: { speed: 60 },
    },
  ];
  const recommend = ({
    mode = "overworld",
    ui = {},
    bag = { items: [{ itemId: 209, quantity: 1 }] },
    party = baseParty,
  } = {}) => {
    const observed = observation({
      emulator: { mode },
      playerMemory: {
        trainer: {
          partyCount: party.length,
          usablePartyCount: party.length,
          party,
          bag,
        },
        ui,
      },
    });
    return createPolicyAdvisors({ mechanics, campaignPlanner })
      .find(({ id }) => id === "quest")
      .advise(observed)?.recommendation;
  };

  assert.deepEqual(recommend(), {
    kind: "open-start-menu",
    objective: "equip-held-item-209-on-slot-1",
  });
  assert.deepEqual(recommend({
    mode: "start-menu",
    ui: { startMenu: { cursor: 0, order: ["pokedex", "pokemon", "bag"] } },
  }), {
    kind: "choose-start-menu-item",
    targetItem: "bag",
    targetIndex: 2,
    objective: "equip-held-item-209-on-slot-1",
  });
  assert.deepEqual(recommend({
    mode: "bag",
    ui: { bag: { stage: "list", pocket: 1, index: 0, selectedItemId: 261 } },
  }), {
    kind: "choose-bag-pocket",
    targetPocket: 0,
    objective: "equip-held-item-209-on-slot-1",
  });
  assert.deepEqual(recommend({
    mode: "bag",
    ui: { bag: { stage: "list", pocket: 0, index: 0, selectedItemId: 209 } },
  }), {
    kind: "choose-bag-item",
    targetItemId: 209,
    targetIndex: 0,
    objective: "equip-held-item-209-on-slot-1",
  });
  assert.deepEqual(recommend({
    mode: "bag",
    ui: { bag: {
      stage: "context",
      pocket: 0,
      contextCursor: 0,
      selectedItemId: 209,
      selectedAction: "use",
    } },
  }), {
    kind: "choose-bag-context-action",
    targetAction: "give",
    targetIndex: 1,
    objective: "equip-held-item-209-on-slot-1",
  });
  assert.deepEqual(recommend({
    mode: "party",
    ui: { party: { stage: "choose-pokemon", cursor: 0, itemId: 209 } },
  }), {
    kind: "choose-party-member",
    targetPartySlot: 1,
    targetSpecies: 131,
    objective: "equip-held-item-209-on-slot-1",
  });
  assert.deepEqual(recommend({
    mode: "party",
    bag: { items: [] },
    party: [baseParty[0], { ...baseParty[1], heldItem: 209 }],
    ui: { party: { stage: "message", cursor: 1, itemId: 209 } },
  }), {
    kind: "acknowledge-cartridge-prompt",
    objective: "confirm-held-item-209",
  });
});
test('PC withdrawal selects the requested shiny identity among identical species',()=>{
 const center=mapFromCollisionRows({id:'MAP_LAVENDER_TOWN_POKEMON_CENTER_1F',rows:['.......','...#...','.......'],behaviors:{'3,1':'MB_PC'}});
 const target={validity:'valid',box:0,slot:2,species:113,personality:123,otId:456,ivs:{},moves:[3],pp:[10]};
 const fingerprint=JSON.stringify([113,123,456,null,null,null,null,null,null]);
 const objective={id:'trade-exact-shiny',target:{kind:'party-roster',map:center.id,requiredFingerprints:[fingerprint]}};
 const o=observation({emulator:{mode:'storage'},playerMemory:{map:{id:center.id},position:{x:3,y:2},trainer:{party:[{slot:0,species:18,level:65,hp:100,maxHp:100,moves:[19]}],storage:{validity:'valid',boxCounts:[2,...Array(13).fill(0)],pokemon:[{...target,slot:0,personality:999},target]}},ui:{storage:{stage:'storage-main',boxOption:'withdraw',currentBox:0,cursorPosition:0}}}});
 const recommend=()=>createPolicyAdvisors({mechanics,world:{maps:[center]},campaignPlanner:{select:()=>objective}}).flatMap(a=>a.advise(o)??[]).find(p=>p.advisor==='quest')?.recommendation;
 assert.equal(recommend()?.targetBoxSlot,2);
 o.playerMemory.ui.storage.stage='pokemon-menu';
 assert.equal(recommend()?.kind,'cancel-storage-action');
 o.playerMemory.ui.storage.cursorPosition=2;
 assert.equal(recommend()?.targetAction,'withdraw');
});

test('native saving finishes before field healing can redirect the overlapping start menu', () => {
  const map = mapFromCollisionRows({id:'MAP_SAVE_PRIORITY',rows:['.....','.....','.....']});
  const objective = {id:'postgame-save',target:{kind:'save-game',map:map.id,saveVerified:false}};
  const campaignPlanner = {select:()=>objective,state:()=>({})};
  const party = [{slot:0,species:25,level:45,hp:20,maxHp:120,status1:64,moves:[85],pp:[0]}];
  const stages = [
    {mode:'overworld',ui:{},want:'open-start-menu'},
    {mode:'start-menu',ui:{startMenu:{cursor:4,order:['pokedex','pokemon','bag','player','save','option','exit']}},want:'choose-start-menu-item'},
    {mode:'start-menu',ui:{startMenu:{cursor:4,order:['pokedex','pokemon','bag','player','save','option','exit']},saveDialog:{stage:'confirm-save',cursor:0}},want:'choose-menu-option'},
    {mode:'start-menu',ui:{startMenu:{cursor:4,order:['pokedex','pokemon','bag','player','save','option','exit']},saveDialog:{stage:'confirm-overwrite',cursor:0}},want:'choose-menu-option'},
    {mode:'start-menu',ui:{startMenu:{cursor:4,order:['pokedex','pokemon','bag','player','save','option','exit']},saveDialog:{stage:'writing'}},want:'wait-for-supported-objective'},
    {mode:'start-menu',ui:{startMenu:{cursor:4,order:['pokedex','pokemon','bag','player','save','option','exit']},saveDialog:{stage:'success'}},verified:true,want:'acknowledge-cartridge-prompt'},
  ];
  for (const stage of stages) {
    objective.target.saveVerified = stage.verified === true;
    const o = observation({emulator:{mode:stage.mode},playerMemory:{map:{id:map.id},trainer:{usablePartyCount:1,party,bag:{items:[{itemId:18,quantity:2},{itemId:19,quantity:2}]}},ui:stage.ui}});
    const player = createCentralPlayer({advisors:createPolicyAdvisors({mechanics,world:{maps:[map]},campaignPlanner}),campaignPlanner,mechanics});
    const decision = player.decide(o);
    if (!stage.verified) assert.equal(decision.winner?.recommendation?.objective,'postgame-save',stage.ui.saveDialog?.stage??stage.mode);
    assert.equal(decision.winner?.recommendation?.kind,stage.want);
    if(stage.want==='choose-start-menu-item')assert.equal(decision.winner.recommendation.targetItem,'save');
  }
});

test('held-item preparation uses the Berry Pouch and species-specific boosts through native menus',()=>{
 const campaignPlanner=createCampaignPlanner({campaign:{objectives:[]}});
 const recommend=(item,pokemon,ui={},hasPouch=true)=>createPolicyAdvisors({mechanics,campaignPlanner}).find(a=>a.id==='quest').advise(observation({emulator:{mode:ui.bag?'bag':'overworld'},playerMemory:{trainer:{partyCount:1,usablePartyCount:1,party:[{slot:0,species:105,level:35,hp:100,maxHp:100,heldItem:0,moves:[1],...pokemon}],bag:{keyItems:hasPouch?[{itemId:365,quantity:1}]:[],items:item===224?[{itemId:item,quantity:1}]:[],berries:item===139?[{itemId:item,quantity:1}]:[]}},ui}}))?.recommendation;
 assert.equal(recommend(224,{})?.objective,'equip-held-item-224-on-slot-0');
 assert.equal(recommend(139,{})?.objective,'equip-held-item-139-on-slot-0');
 assert.notEqual(recommend(139,{},{},false)?.objective,'equip-held-item-139-on-slot-0');
 assert.equal(recommend(139,{}, {bag:{stage:'list',pocket:0,index:0}})?.targetPocket,1);
 assert.equal(recommend(139,{}, {bag:{stage:'berry-pouch-list',pocket:4,index:0,selectedItemId:139}})?.targetItemId,139);
 assert.equal(recommend(139,{}, {bag:{stage:'berry-pouch-context',pocket:4,index:0,selectedItemId:139,actions:['use','give','toss','exit']}})?.targetAction,'give');
 assert.notEqual(recommend(224,{species:6})?.objective,'equip-held-item-224-on-slot-0');
 assert.notEqual(recommend(139,{heldItem:195})?.objective,'equip-held-item-139-on-slot-0','preserve the existing item');
});
test('equipment avoids a disliked flavor berry and does not give attack berries to a special attacker',()=>{
 const campaignPlanner=createCampaignPlanner({campaign:{objectives:[]}});
 const recommend=(item,pokemon)=>createPolicyAdvisors({mechanics,campaignPlanner}).find(a=>a.id==='quest').advise(observation({emulator:{mode:'overworld'},playerMemory:{trainer:{partyCount:1,usablePartyCount:1,party:[{slot:0,species:25,level:35,hp:100,maxHp:100,heldItem:0,moves:[85],...pokemon}],bag:{keyItems:[{itemId:365,quantity:1}],berries:[{itemId:item,quantity:1}]}},ui:{}}}))?.recommendation;
 assert.notEqual(recommend(143,{natureId:5})?.objective,'equip-held-item-143-on-slot-0','Bold dislikes spicy Figy');
 assert.notEqual(recommend(143,{})?.objective,'equip-held-item-143-on-slot-0','unknown nature stays safe');
 assert.equal(recommend(143,{natureId:0})?.objective,'equip-held-item-143-on-slot-0','neutral Hardy can use Figy');
 assert.notEqual(recommend(168,{})?.objective,'equip-held-item-168-on-slot-0','Liechi needs physical offense');
});

function indoorFlyFixture() {
  const room = (id, destination, type = 'MAP_TYPE_INDOOR') => mapFromCollisionRows({
    id, rows: ['...', '...', '...'], properties: { map_type: type },
    behaviors: { '1,2': 'MB_SOUTH_ARROW_WARP' },
    warpEvents: [{ x: 1, y: 2, dest_map: destination, dest_warp_id: '0' }],
  });
  const world = { maps: [room('MAP_INDOOR_TEST', 'MAP_OUTSIDE_TEST'),
    room('MAP_OUTSIDE_TEST', 'MAP_INDOOR_TEST', 'MAP_TYPE_CITY'),
    mapFromCollisionRows({ id: 'MAP_PALLET_TOWN', rows: ['.'],
      properties: { map_type: 'MAP_TYPE_TOWN', region_map_section: 'MAPSEC_PALLET_TOWN' } })] };
  const objective = { id: 'return-to-oak', target: { kind: 'map-arrival', map: 'MAP_PALLET_TOWN', x: 0, y: 0 } };
  const memory = { map: { id: 'MAP_INDOOR_TEST' }, position: { x: 1, y: 0 },
    storyState: { flagIds: { 2082: true, 2192: true } },
    trainer: { partyCount: 1, usablePartyCount: 1, party: [{ slot: 0, species: 22, level: 40, hp: 80, maxHp: 80, moves: [19] }] } };
  const planner = { select: () => objective, selectCollection: () => null, selectTraining: () => null };
  const open = state => createCentralPlayer({ advisors: createPolicyAdvisors({ world, mechanics, campaignPlanner: planner }), initialState: state });
  return { world, objective, memory, open };
}

test('an indoor travel goal leaves through a reachable exit before Fly, including after restart', () => {
  const { memory, open } = indoorFlyFixture();
  let player = open();
  const first = player.decide(observation({ playerMemory: memory }));
  assert.equal(first.winner.recommendation.kind, 'move-toward');
  assert.equal(first.winner.recommendation.direction, 'south');
  assert.equal(first.winner.recommendation.objective, 'fly-to-MAPSEC_PALLET_TOWN-exit');
  player = open(JSON.parse(JSON.stringify(player.state())));
  const outside = player.decide(observation({ playerMemory: { ...memory, map: { id: 'MAP_OUTSIDE_TEST' } } }));
  assert.equal(outside.winner.recommendation.objective, 'fly-to-MAPSEC_PALLET_TOWN');
  assert.deepEqual(outside.action.buttons, ['start']);
});

for (const missing of ['badge', 'visited', 'move', 'exit']) test(`indoor Fly staging requires a verified ${missing}`, () => {
  const { world, memory, open } = indoorFlyFixture();
  if (missing === 'badge') memory.storyState.flagIds[2082] = false;
  if (missing === 'visited') memory.storyState.flagIds[2192] = false;
  if (missing === 'move') memory.trainer.party[0].moves = [64];
  if (missing === 'exit') world.maps[0].warpEvents = [];
  const result = open().decide(observation({ playerMemory: memory }));
  assert.notEqual(result.winner?.recommendation?.objective, 'fly-to-MAPSEC_PALLET_TOWN-exit');
});

test('indoor Fly staging preserves a local goal and a pending field choice', () => {
  const { objective, memory, open } = indoorFlyFixture();
  const waiting = open().decide(observation({ playerMemory: { ...memory,
    ui: { choiceMenu: { type: 'yes-no', cursor: 0, options: ['yes', 'no'] } } } }));
  assert.notEqual(waiting.winner?.recommendation?.objective, 'fly-to-MAPSEC_PALLET_TOWN-exit');
  objective.target = { kind: 'warp', map: memory.map.id, index: 0 };
  const local = open().decide(observation({ playerMemory: memory }));
  assert.equal(local.winner.recommendation.objective, 'return-to-oak');
});

test('indoor Fly staging finds an exit across multiple floors without choosing an unreachable exterior', () => {
  const { world, memory, open } = indoorFlyFixture();
  const lower = structuredClone(world.maps[0]); lower.id = 'MAP_LOWER_TEST';
  lower.warpEvents.push({ x: 0, y: 0, dest_map: 'MAP_INDOOR_TEST', dest_warp_id: '0' });
  lower.layout.cells.find(c => c.x === 0 && c.y === 0).behaviorName = 'MB_LADDER';
  world.maps[0].warpEvents[0] = { x: 1, y: 2, dest_map: lower.id, dest_warp_id: '1' };
  world.maps[1].warpEvents[0].dest_map = lower.id;
  world.maps.push(lower);
  const isolated = structuredClone(world.maps[1]); isolated.id = 'MAP_A_UNREACHABLE';
  world.maps.unshift(isolated);
  const first = open().decide(observation({ playerMemory: memory }));
  assert.equal(first.winner.recommendation.transit.destinationMap, lower.id);
  assert.equal(first.winner.recommendation.targetMap, 'MAP_OUTSIDE_TEST');
});

test('indoor Fly staging leaves a reachable walking route in control', () => {
  const { world, memory, open } = indoorFlyFixture();
  world.maps[1].connections = [{ direction: 'right', map: 'MAP_PALLET_TOWN', offset: 0 }];
  const first = open().decide(observation({ playerMemory: memory }));
  assert.equal(first.winner.recommendation.objective, 'return-to-oak');
  assert.equal(first.winner.recommendation.kind, 'move-toward');
});
