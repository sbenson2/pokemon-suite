import assert from "node:assert/strict";
import test from "node:test";
import { campaignNavigationRecommendation, createCampaignPlanner } from "../src/player/campaign.js";

const FIRST_FLOOR = "MAP_VICTORY_ROAD_1F";
const SECOND_FLOOR = "MAP_VICTORY_ROAD_2F";
const DESTINATION = "MAP_INDIGO_PLATEAU_POKEMON_CENTER_1F";

function map(id, { width = 25, height = 22, warpEvents = [], objectEvents = [], behaviors = {} } = {}) {
  return {
    id,
    warpEvents,
    objectEvents,
    layout: {
      id: `LAYOUT_${id}`,
      width,
      height,
      cells: Array.from({ length: width * height }, (_, index) => ({
        x: index % width,
        y: Math.floor(index / width),
        collision: 0,
        elevation: 3,
        behaviorName: behaviors[`${index % width},${Math.floor(index / width)}`] ??
          (index === 16 * width + 20 ? "MB_LADDER" : "MB_NORMAL"),
      })),
    },
  };
}

function fixture({ switchValue = 0, boulder = { x: 7, y: 18 }, player = { x: 7, y: 17 } } = {}) {
  const firstFloor = map(FIRST_FLOOR, {
    warpEvents: [{ x: 20, y: 16, dest_map: SECOND_FLOOR, dest_warp_id: "0" }],
    objectEvents: Array.from({ length: 5 }, (_, index) => index === 4
      ? {
          x: 7,
          y: 18,
          graphics_id: "OBJ_EVENT_GFX_PUSHABLE_BOULDER",
          script: "EventScript_StrengthBoulder",
        }
      : { x: index, y: 0, script: `VictoryRoad_Filler_${index}` }),
  });
  const world = { maps: [
    firstFloor,
    map(SECOND_FLOOR),
    map(DESTINATION, {
      objectEvents: [{ x: 2, y: 2, script: "IndigoPlateau_EventScript_Mart" }],
    }),
  ] };
  const observation = {
    phase: "stable",
    emulator: { mode: "overworld" },
    playerMemory: {
      map: { id: FIRST_FLOOR },
      position: player,
      objectEvents: [{ localId: 5, current: boulder, previous: boulder }],
      storyState: {
        flags: {},
        flagIds: { 2053: true, 2083: true },
        variableIds: { 0x4064: switchValue },
      },
      trainer: { party: [{ slot: 0, species: 6, level: 55, hp: 180, moves: [70] }], bag: {} },
    },
  };
  const objective = {
    id: "stock-postgame-supplies",
    target: {
      kind: "purchase-items",
      map: DESTINATION,
      objectIndex: 0,
      items: [{ itemId: 2, quantity: 20, stockIndex: 0, unitPrice: 1200 }],
    },
  };
  return { world, observation, objective };
}

function navigate({ world, observation, objective }) {
  return campaignNavigationRecommendation({ world, observation, objective });
}

test("closed 1F north gate starts the authored switch push while retaining the destination", () => {
  const context = fixture();
  const recommendation = navigate(context);

  assert.equal(recommendation?.kind, "push-field-obstacle");
  assert.equal(recommendation?.direction, "south");
  assert.equal(recommendation?.obstacle?.index, 4);
  assert.equal(recommendation?.objective, context.objective.id);
  assert.equal(recommendation?.targetMap, DESTINATION);
  assert.equal(recommendation?.victoryRoadPhase, "open-first-floor-north-gate");
  const planner = createCampaignPlanner({ world: context.world, campaign: { objectives: [] } });
  assert.deepEqual(planner.routeMetrics(context.observation, context.objective.target), {
    transitions: 1,
    localSteps: 1,
  });
});

test("1F transit resumes the live switch position after a battle and reconstruction", () => {
  const context = fixture({ boulder: { x: 7, y: 19 }, player: { x: 6, y: 19 } });
  const afterBattle = navigate(context);
  const afterReconstruction = navigate({
    ...context,
    observation: structuredClone(context.observation),
    objective: structuredClone(context.objective),
  });

  for (const recommendation of [afterBattle, afterReconstruction]) {
    assert.equal(recommendation?.kind, "push-field-obstacle");
    assert.equal(recommendation?.direction, "east");
    assert.equal(recommendation?.obstacle?.index, 4);
    assert.equal(recommendation?.objective, context.objective.id);
    assert.equal(recommendation?.targetMap, DESTINATION);
  }
});

test("completed 1F switch hands the retained destination to the north ladder", () => {
  const context = fixture({ switchValue: 100 });
  const recommendation = navigate(context);

  assert.equal(recommendation?.target?.kind, "warp");
  assert.equal(recommendation?.target?.index, 0);
  assert.equal(recommendation?.transit?.destinationMap, SECOND_FLOOR);
  assert.equal(recommendation?.objective, context.objective.id);
  assert.equal(recommendation?.targetMap, DESTINATION);
});

test("planner route metrics report a reachable target and reject a disconnected one", () => {
  const reachable = map("MAP_METRICS_START", {
    width: 5,
    height: 5,
    objectEvents: [{ x: 2, y: 2, script: "Metrics_EventScript_Mart" }],
  });
  const disconnected = map("MAP_METRICS_DISCONNECTED", {
    width: 5,
    height: 5,
    objectEvents: [{ x: 2, y: 2, script: "Metrics_EventScript_Mart" }],
  });
  const world = { maps: [reachable, disconnected] };
  const observation = fixture().observation;
  observation.playerMemory.map.id = reachable.id;
  observation.playerMemory.position = { x: 0, y: 0 };
  observation.playerMemory.objectEvents = [];
  const planner = createCampaignPlanner({ world, campaign: { objectives: [] } });

  assert.deepEqual(planner.routeMetrics(observation, {
    kind: "object", map: reachable.id, index: 0,
  }), { transitions: 0, localSteps: 3 });
  assert.equal(planner.routeMetrics(observation, {
    kind: "object", map: disconnected.id, index: 0,
  }), null);
});

test("2F south landing returns toward a Kanto healer despite reset graph barriers", () => {
  const secondFloor = map(SECOND_FLOOR, {
    warpEvents: [{ x: 1, y: 9, dest_map: FIRST_FLOOR, dest_warp_id: "0" }],
    behaviors: { "1,9": "MB_LADDER" },
  });
  const healer = map("MAP_CELADON_CITY_POKEMON_CENTER_1F", {
    objectEvents: [{ x: 2, y: 2, script: "Celadon_EventScript_Nurse" }],
  });
  const context = fixture();
  context.world = { maps: [map(FIRST_FLOOR), secondFloor, healer] };
  context.observation.playerMemory.map.id = SECOND_FLOOR;
  context.observation.playerMemory.position = { x: 1, y: 9 };
  context.observation.playerMemory.objectEvents = [];
  context.objective = {
    id: "restore-postgame-party",
    target: { kind: "object", map: healer.id, index: 0 },
  };

  const recommendation = navigate(context);
  assert.equal(recommendation?.kind, "reenter-map-warp");
  assert.equal(recommendation?.transit?.destinationMap, FIRST_FLOOR);
  assert.equal(recommendation?.objective, context.objective.id);
  assert.equal(recommendation?.targetMap, healer.id);
});

test("closed 2F main switch opens before routing to the north exit", () => {
  const secondFloor = map(SECOND_FLOOR, {
    width: 51,
    objectEvents: Array.from({ length: 11 }, (_, index) => index === 10
      ? { x: 6, y: 17, graphics_id: "OBJ_EVENT_GFX_PUSHABLE_BOULDER",
          script: "EventScript_StrengthBoulder" }
      : { x: index, y: 0, script: `VictoryRoad_Filler_${index}` }),
  });
  const context = fixture();
  context.world = { maps: [secondFloor, map(DESTINATION)] };
  context.observation.playerMemory.map.id = SECOND_FLOOR;
  context.observation.playerMemory.position = { x: 7, y: 17 };
  context.observation.playerMemory.objectEvents = [{
    localId: 11,
    current: { x: 6, y: 17 },
    previous: { x: 6, y: 17 },
  }];
  context.observation.playerMemory.storyState.variableIds[0x4065] = 0;
  context.observation.playerMemory.storyState.variableIds[0x4066] = 0;

  const recommendation = navigate(context);
  assert.equal(recommendation?.kind, "push-field-obstacle");
  assert.equal(recommendation?.direction, "west");
  assert.equal(recommendation?.obstacle?.index, 10);
  assert.equal(recommendation?.victoryRoadPhase, "open-second-floor-main-gate");
  assert.equal(recommendation?.objective, context.objective.id);
  assert.equal(recommendation?.targetMap, DESTINATION);
});
