import assert from "node:assert/strict";
import test from "node:test";

import { createSpectatorStatus } from "../src/presentation/player-status.js";

test('trainer portrait follows the observed save character instead of numeric coercion or the planned character',()=>{
  for(const [gender,want] of [['GIRL','GIRL'],['BOY','BOY'],[1,'GIRL'],[0,'BOY']]){
    const observation={playerMemory:{trainer:{gender}}};
    for(const runProfile of [null,{gender:want==='GIRL'?'BOY':'GIRL'}]){
      assert.equal(createSpectatorStatus({observation,runProfile}).trainer.gender,want);
    }
  }
});

test('missing or invalid character evidence remains unknown on the trainer card',()=>{
  for(const gender of [null,undefined,2,'',false,'unknown']){
    assert.equal(createSpectatorStatus({observation:{playerMemory:{trainer:{gender}}},runProfile:{gender:'BOY'}}).trainer.gender,null);
  }
});

test('activity training context follows the committed individual across party positions',()=>{
  const observation={playerMemory:{trainer:{partyValidity:'valid',party:[
    {slot:0,species:131,personality:1,otId:8,level:43},
    {slot:4,species:102,nationalSpecies:102,personality:9,otId:8,level:27,experienceProgress:{remaining:1614}},
  ]}}};
  const campaignStatus={activeTask:{kind:'training',member:'[8,9]',minimumLevel:28,targetLevel:44,rotation:'one-level'}};
  const mechanics={species:[{id:102,name:'SPECIES_EXEGGCUTE'},{id:131,name:'SPECIES_LAPRAS'}]};
  const before=structuredClone({observation,campaignStatus});
  const read=()=>createSpectatorStatus({observation,campaignStatus,mechanics}).strategy.training;
  assert.equal(read()?.pokemon.name,'Exeggcute');assert.equal(read().pokemon.level,27);
  assert.equal(read().nextLevel,28);assert.equal(read().targetLevel,44);
  assert.deepEqual({observation,campaignStatus},before,'presentation must not change the observation or task');
  observation.playerMemory.trainer.party.reverse();assert.equal(read().pokemon.name,'Exeggcute');
  observation.playerMemory.trainer.partyValidity='invalid';assert.equal(read(),undefined);
});

test('activity battle context exposes observed opponents without inventing a damage estimate',()=>{
  const observation={phase:'stable',emulator:{inBattle:true},playerMemory:{trainer:{party:[]},battle:{
    player:{species:8,level:26,hp:34,maxHp:69,status1:0},opponent:{species:74,level:18,hp:40,maxHp:40,status1:0},
  }}};
  const mechanics={species:[{id:8,name:'SPECIES_WARTORTLE'},{id:74,name:'SPECIES_GEODUDE'}]};
  const battle=createSpectatorStatus({observation,mechanics}).strategy.battle;
  assert.equal(battle?.opponent.name,'Geodude');assert.equal(battle.player.hp,34);
  assert.equal(battle.expectedDamage,undefined);
  observation.emulator.inBattle=false;assert.equal(createSpectatorStatus({observation,mechanics}).strategy.battle,undefined);
});

test("research status projects the live cartridge into the AgentTV trainer card", () => {
  const spectator = createSpectatorStatus({
    observation: {
      playerMemory: {
        map: { id: "MAP_ROUTE5", group: 3, number: 20 },
        position: { x: 27, y: 5 },
        storyState: { flagIds: { 2080: true, 2081: true, 2082: false } },
        trainer: {
          playerName: "LEAF",
          gender: 1,
          money: 2345,
          playTime: { hours: 12, minutes: 34, seconds: 56, vblanks: 7 },
          pokedex: { ownedCount: 7, seenCount: 12 },
          party: [
            {
              slot: 0,
              species: 5,
              level: 23,
              hp: 45,
              maxHp: 60,
              status1: 64,
            },
            { slot: 1, species: 43, level: 21, hp: 54, maxHp: 54 },
          ],
        },
      },
    },
    runProfile: { gender: "GIRL", playerName: "LEAF" },
    mechanics: { data: { species: [
      { id: 5, name: "SPECIES_CHARMELEON" },
      { id: 43, name: "SPECIES_ODDISH" },
    ] } },
    collectionProgress: { provenMaps: 14 },
    decision: {
      winner: { recommendation: { objective: "badge-thunder" } },
    },
  });

  assert.deepEqual(spectator.map, {
    name: "Route 5", region: "Kanto", group: 3, number: 20, x: 27, y: 5,
  });
  assert.deepEqual(spectator.trainer, {
    name: "LEAF", gender: "GIRL", id: null, money: 2345,
    playTime: { hours: 12, minutes: 34, seconds: 56, vblanks: 7 },
    pokedex: { owned: 7, seen: 12 },
  });
  assert.deepEqual(spectator.party, [
    { lead: true, slot: 0, speciesName: "Charmeleon", level: 23, hp: 45, maxHp: 60, status: "PAR" },
    { lead: false, slot: 1, speciesName: "Oddish", level: 21, hp: 54, maxHp: 54, status: "OK" },
  ]);
  assert.deepEqual(
    spectator.badges.map(({ id, earned }) => [id, earned]),
    [
      ["boulder", true], ["cascade", true], ["thunder", false],
      ["rainbow", false], ["soul", false], ["marsh", false],
      ["volcano", false], ["earth", false],
    ],
  );
  assert.equal(spectator.progress.species, 7);
  assert.equal(spectator.progress.maps, 14);
  assert.equal(spectator.strategy.activeStoryGoal, "badge-thunder");
});

test("trainer-card status exposes the campaign decision and its causal evidence", () => {
  const spectator = createSpectatorStatus({
    observation: {
      playerMemory: {
        map: { id: "MAP_ROCKET_HIDEOUT_B1F" },
        position: { x: 12, y: 2 },
        trainer: { party: [] },
      },
    },
    campaignStatus: {
      completedThroughObjectiveId: "silph-supplies",
      activeObjective: {
        id: "rival-silph",
        target: { kind: "trigger", map: "MAP_SILPH_CO_7F", index: 0 },
        minimumTeamAnchorLevel: 48,
      },
    },
    decision: {
      sequence: 83,
      kind: "act",
      reason: "policy-resolution",
      winner: {
        advisor: "navigation",
        recommendation: {
          kind: "move-toward",
          direction: "west",
          objective: "train-battle-member-with-trainer",
          targetMap: "MAP_ROCKET_HIDEOUT_B1F",
          remainingSteps: 14,
        },
        confidence: 0.96,
        constraints: ["minimum-team-anchor-level", "trainer-first-training"],
        evidenceRefs: [
          "campaign:preparation-for:rival-silph",
          "cartridge:team-anchor-level:29/48",
          "cartridge:trainer:359",
        ],
      },
      action: {
        kind: "sustained-chord",
        buttons: ["b", "left"],
        reason: "navigation-running",
      },
    },
  });

  assert.deepEqual(spectator.strategy, {
    activeStoryGoal: "rival-silph",
    campaign: {
      completedThroughObjectiveId: "silph-supplies",
      activeObjective: {
        id: "rival-silph",
        target: { kind: "trigger", map: "MAP_SILPH_CO_7F", index: 0 },
        minimumTeamAnchorLevel: 48,
      },
    },
    decision: {
      sequence: 83,
      kind: "act",
      reason: "policy-resolution",
      advisor: "navigation",
      recommendation: {
        kind: "move-toward",
        direction: "west",
        objective: "train-battle-member-with-trainer",
        targetMap: "MAP_ROCKET_HIDEOUT_B1F",
        remainingSteps: 14,
      },
      action: { kind: "sustained-chord", reason: "navigation-running" },
      confidence: 0.96,
      constraints: ["minimum-team-anchor-level", "trainer-first-training"],
      evidenceRefs: [
        "campaign:preparation-for:rival-silph",
        "cartridge:team-anchor-level:29/48",
        "cartridge:trainer:359",
      ],
    },
  });
});
