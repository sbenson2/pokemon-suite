import assert from "node:assert/strict";
import test from "node:test";

import { createCentralPlayer } from "../src/player/delegator.js";

function battleObservation({
  captureId,
  frame,
  battleUi = null,
  partyUi = null,
  playerPartySlot = 0,
  playerSpecies = 46,
  party = [
    { slot: 0, species: 46, level: 8, hp: 13, maxHp: 25 },
    { slot: 1, species: 56, level: 9, hp: 12, maxHp: 27 },
    { slot: 2, species: 5, level: 21, hp: 34, maxHp: 61 },
  ],
} = {}) {
  return {
    captureId,
    frame,
    phase: "stable",
    phaseReasons: [],
    emulator: {
      captureId,
      frame,
      mode: "battle",
      inputReady: true,
      callback2: partyUi ? "CB2_UpdatePartyMenu" : "BattleMainCB2",
    },
    sram: { captureId, frame, sha256: "sram" },
    playerMemory: {
      captureId,
      frame,
      sha256: `memory-${frame}`,
      map: { id: "MAP_MT_MOON_B2F" },
      position: { x: 12, y: 26 },
      battleTypeFlags: 0,
      trainer: {
        partyCount: party.length,
        usablePartyCount: party.filter(({ hp }) => hp > 0).length,
        party,
      },
      battle: {
        playerPartySlot,
        player: { species: playerSpecies, level: 8, hp: 13, maxHp: 25 },
        opponent: { species: 41, level: 10, hp: 22, maxHp: 22 },
      },
      ui: {
        battle: battleUi,
        party: partyUi,
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
}

function oneShotSwitchAdvisor({ targetPartySlot = 2, targetSpecies = 5 } = {}) {
  let proposed = false;
  return {
    id: "training-switch",
    advise(observation) {
      if (proposed || observation.playerMemory.ui.battle?.stage !== "action") return null;
      proposed = true;
      return {
        advisor: "battle",
        observationId: observation.captureId,
        recommendation: {
          kind: "choose-battle-command",
          targetCommand: "pokemon",
          targetPartySlot,
          targetSpecies,
          objective: "protect-training-member",
        },
        confidence: 0.997,
        constraints: ["usable-escort-member"],
        vetoes: [],
        evidenceRefs: [`test:party-slot:${targetPartySlot}`],
      };
    },
  };
}

test("the central player carries a battle switch target into the party picker", () => {
  const player = createCentralPlayer({ advisors: [oneShotSwitchAdvisor()] });

  const commandDecision = player.decide(battleObservation({
    captureId: "battle-command",
    frame: 100,
    battleUi: { stage: "action", cursor: 2, selected: "pokemon" },
  }));
  assert.equal(commandDecision.winner.recommendation.targetPartySlot, 2);

  const partyDecision = player.decide(battleObservation({
    captureId: "party-picker",
    frame: 102,
    partyUi: { stage: "choose-pokemon", cursor: 0, selectedPartySlot: 0 },
  }));

  assert.deepEqual(partyDecision.winner?.recommendation, {
    kind: "choose-party-member",
    targetPartySlot: 2,
    targetSpecies: 5,
    objective: "protect-training-member",
  });
  assert.deepEqual(partyDecision.action.buttons, ["down"]);
});

test("the central player finishes opening the party picker after the originating policy stops", () => {
  const player = createCentralPlayer({ advisors: [oneShotSwitchAdvisor()] });
  const moved = player.decide(battleObservation({
    captureId: "battle-command-move",
    frame: 150,
    battleUi: { stage: "action", cursor: 0, selected: "fight" },
  }));
  assert.deepEqual(moved.action.buttons, ["down"]);

  const opened = player.decide(battleObservation({
    captureId: "battle-command-confirm",
    frame: 152,
    battleUi: { stage: "action", cursor: 2, selected: "pokemon" },
  }));

  assert.deepEqual(opened.winner?.recommendation, {
    kind: "choose-battle-command",
    targetCommand: "pokemon",
    targetPartySlot: 2,
    targetSpecies: 5,
    objective: "protect-training-member",
  });
  assert.deepEqual(opened.action.buttons, ["a"]);
});

test("the central player carries the switch workflow through party confirmation", () => {
  const player = createCentralPlayer({ advisors: [oneShotSwitchAdvisor()] });
  player.decide(battleObservation({
    captureId: "battle-command",
    frame: 200,
    battleUi: { stage: "action", cursor: 2, selected: "pokemon" },
  }));
  const selected = player.decide(battleObservation({
    captureId: "party-target",
    frame: 202,
    partyUi: { stage: "choose-pokemon", cursor: 2, selectedPartySlot: 2 },
  }));
  assert.deepEqual(selected.action.buttons, ["a"]);

  const confirmed = player.decide(battleObservation({
    captureId: "party-confirmation",
    frame: 204,
    partyUi: {
      stage: "selection-menu",
      cursor: 2,
      selectedPartySlot: 2,
      action: "shift",
      actionCursor: 0,
    },
  }));

  assert.deepEqual(confirmed.winner?.recommendation, {
    kind: "choose-menu-option",
    targetIndex: 0,
    objective: "protect-training-member",
  });
  assert.deepEqual(confirmed.action.buttons, ["a"]);
});

test("a pending battle switch transaction owns its submenu when policy retargets", () => {
  const advisor = {
    id: "retargeting-battle-policy",
    advise(observation) {
      const battleUi = observation.playerMemory.ui.battle;
      const partyUi = observation.playerMemory.ui.party;
      const recommendation = battleUi?.stage === "action"
        ? {
            kind: "choose-battle-command",
            targetCommand: "pokemon",
            targetPartySlot: 1,
            targetSpecies: 56,
            objective: "train-team-anchor",
          }
        : partyUi?.stage === "selection-menu"
          ? {
              kind: "choose-party-member",
              targetPartySlot: 2,
              targetSpecies: 5,
              objective: "protect-training-member",
            }
          : null;
      if (!recommendation) return null;
      return {
        advisor: "battle",
        observationId: observation.captureId,
        recommendation,
        confidence: 0.997,
        constraints: ["usable-party-member"],
        vetoes: [],
        evidenceRefs: ["test:retargeting-policy"],
      };
    },
  };
  const player = createCentralPlayer({ advisors: [advisor] });

  player.decide(battleObservation({
    captureId: "open-party-picker-for-mankey",
    frame: 230,
    battleUi: { stage: "action", cursor: 2, selected: "pokemon" },
  }));

  const confirmation = player.decide(battleObservation({
    captureId: "mankey-shift-submenu",
    frame: 232,
    partyUi: {
      stage: "selection-menu",
      cursor: 1,
      selectedPartySlot: 1,
      action: "shift",
      actionCursor: 0,
    },
  }));

  assert.equal(confirmation.winner.advisor, "verifier");
  assert.deepEqual(confirmation.winner.recommendation, {
    kind: "choose-menu-option",
    targetIndex: 0,
    objective: "train-team-anchor",
  });
  assert.deepEqual(confirmation.action.buttons, ["a"]);
  assert.equal(player.state().workflow.targetPartySlot, 1);
});

test("a pending battle switch follows its target across the party picker's temporary reorder", () => {
  const player = createCentralPlayer({
    advisors: [oneShotSwitchAdvisor({ targetPartySlot: 0, targetSpecies: 52 })],
  });
  player.decide(battleObservation({
    captureId: "open-party-picker-for-meowth",
    frame: 240,
    battleUi: { stage: "action", cursor: 2, selected: "pokemon" },
    playerPartySlot: 2,
    playerSpecies: 44,
    party: [
      { slot: 0, species: 52, level: 13, hp: 35, maxHp: 35 },
      { slot: 1, species: 5, level: 29, hp: 81, maxHp: 81 },
      { slot: 2, species: 44, level: 30, hp: 62, maxHp: 81 },
    ],
  }));

  const reorderedPicker = player.decide(battleObservation({
    captureId: "party-picker-reordered-around-active-gloom",
    frame: 242,
    partyUi: { stage: "choose-pokemon", cursor: 0, selectedPartySlot: 0 },
    playerPartySlot: 2,
    playerSpecies: 44,
    party: [
      { slot: 0, species: 44, level: 30, hp: 62, maxHp: 81 },
      { slot: 1, species: 52, level: 13, hp: 35, maxHp: 35 },
      { slot: 2, species: 5, level: 29, hp: 81, maxHp: 81 },
    ],
  }));

  assert.equal(reorderedPicker.winner.advisor, "verifier");
  assert.deepEqual(reorderedPicker.winner.recommendation, {
    kind: "choose-party-member",
    targetPartySlot: 1,
    targetSpecies: 52,
    objective: "protect-training-member",
  });
  assert.deepEqual(reorderedPicker.action.buttons, ["down"]);
  assert.equal(player.state().workflow.targetPartySlot, 1);
  assert.equal(player.state().workflow.targetSpecies, 52);
});

test("the central player abandons a rejected switch instead of reopening the party picker forever", () => {
  const player = createCentralPlayer({ advisors: [oneShotSwitchAdvisor()] });
  player.decide(battleObservation({
    captureId: "battle-command",
    frame: 250,
    battleUi: { stage: "action", cursor: 2, selected: "pokemon" },
  }));
  player.decide(battleObservation({
    captureId: "party-target",
    frame: 252,
    partyUi: { stage: "choose-pokemon", cursor: 2, selectedPartySlot: 2 },
  }));
  player.decide(battleObservation({
    captureId: "party-confirmation",
    frame: 254,
    partyUi: {
      stage: "selection-menu",
      cursor: 2,
      selectedPartySlot: 2,
      action: "shift",
      actionCursor: 0,
    },
  }));

  const rejected = player.decide(battleObservation({
    captureId: "switch-rejected",
    frame: 280,
    battleUi: { stage: "action", cursor: 0, selected: "fight" },
    playerPartySlot: 0,
    playerSpecies: 46,
  }));

  assert.equal(player.state().workflow, null);
  assert.equal(rejected.winner, null);
});

test("the central player completes a switch workflow only after observing its target active", () => {
  const player = createCentralPlayer({ advisors: [oneShotSwitchAdvisor()] });
  player.decide(battleObservation({
    captureId: "battle-command",
    frame: 300,
    battleUi: { stage: "action", cursor: 2, selected: "pokemon" },
  }));
  assert.equal(player.state().workflow.targetPartySlot, 2);

  player.decide(battleObservation({
    captureId: "switched-battler",
    frame: 330,
    battleUi: { stage: "action", cursor: 0, selected: "fight" },
    playerPartySlot: 2,
    playerSpecies: 5,
  }));

  assert.equal(player.state().workflow, null);
});

test("a player-right double-battle switch completes against the player-right battler", () => {
  const party = [
    { slot: 0, species: 44, level: 30, hp: 62, maxHp: 81 },
    { slot: 1, species: 5, level: 29, hp: 81, maxHp: 81 },
    { slot: 2, species: 20, level: 25, hp: 69, maxHp: 69 },
    { slot: 3, species: 52, level: 13, hp: 35, maxHp: 35 },
  ];
  const player = createCentralPlayer({
    advisors: [oneShotSwitchAdvisor({ targetPartySlot: 3, targetSpecies: 52 })],
  });
  const rightAction = battleObservation({
    captureId: "player-right-action",
    frame: 350,
    battleUi: { stage: "action", battler: 2, cursor: 2, selected: "pokemon" },
    playerPartySlot: 0,
    playerSpecies: 44,
    party,
  });
  rightAction.playerMemory.battle.battlers = [
    { battler: 0, species: 44, hp: 62, maxHp: 81 },
    { battler: 1, species: 95, hp: 40, maxHp: 40 },
    { battler: 2, species: 5, hp: 81, maxHp: 81 },
    { battler: 3, species: 7, hp: 40, maxHp: 40 },
  ];
  rightAction.playerMemory.battle.battlerPartyIndexes = [0, 0, 1, 0];
  player.decide(rightAction);

  assert.equal(player.state().workflow.actingBattler, 2);

  const switchedRight = battleObservation({
    captureId: "player-right-switched",
    frame: 352,
    battleUi: { stage: "action", battler: 0, cursor: 0, selected: "fight" },
    playerPartySlot: 0,
    playerSpecies: 44,
    party,
  });
  switchedRight.playerMemory.battle.battlers = [
    { battler: 0, species: 44, hp: 62, maxHp: 81 },
    { battler: 1, species: 95, hp: 40, maxHp: 40 },
    { battler: 2, species: 52, hp: 35, maxHp: 35 },
    { battler: 3, species: 7, hp: 40, maxHp: 40 },
  ];
  switchedRight.playerMemory.battle.battlerPartyIndexes = [0, 0, 3, 0];
  player.decide(switchedRight);

  assert.equal(player.state().workflow, null);
});

test("a resumed double-battle workflow abandons the partner's reserved switch", () => {
  const party = [
    { slot: 0, species: 44, level: 32, hp: 84, maxHp: 84 },
    { slot: 1, species: 53, level: 30, hp: 85, maxHp: 85 },
    { slot: 2, species: 6, level: 36, hp: 79, maxHp: 110 },
    { slot: 3, species: 57, level: 30, hp: 82, maxHp: 82 },
  ];
  const observed = battleObservation({
    captureId: "player-right-duplicate-reservation",
    frame: 390,
    partyUi: { stage: "choose-pokemon", cursor: 3, selectedPartySlot: 3 },
    playerPartySlot: 0,
    playerSpecies: 44,
    party,
  });
  observed.playerMemory.battleTypeFlags = (1 << 2) | (1 << 3) | (1 << 0);
  observed.playerMemory.battle.battlers = [
    { battler: 0, species: 44, hp: 84, maxHp: 84 },
    { battler: 1, species: 35, hp: 62, maxHp: 62 },
    { battler: 2, species: 53, hp: 85, maxHp: 85 },
    { battler: 3, species: 39, hp: 82, maxHp: 82 },
  ];
  observed.playerMemory.battle.battlerPartyIndexes = [0, 0, 1, 1];
  observed.playerMemory.battle.monToSwitchIntoIds = [3, 6, 6, 6];
  const player = createCentralPlayer({
    advisors: [],
    initialState: {
      sequence: 120,
      initialSramSha256: "sram",
      workflow: {
        schema: "master-red/control-workflow/v1",
        id: "battle-party-duplicate-double-switch",
        kind: "battle-party-selection",
        objective: "improve-battle-matchup",
        targetPartySlot: 3,
        targetSpecies: 57,
        targetFingerprint: null,
        actingBattler: 2,
        sourceAdvisor: "battle",
        stage: "party-message",
        enteredPartyPicker: true,
        startedObservationId: "before-checkpoint",
        startedFrame: 350,
      },
    },
  });

  const decision = player.decide(observed);

  assert.deepEqual(decision.winner?.recommendation, {
    kind: "choose-party-member",
    targetPartySlot: 2,
    targetSpecies: 6,
    objective: "recover-orphaned-battle-party-selection",
  });
  assert.equal(player.state().workflow.targetPartySlot, 2);
});

test("the central player cancels a switch workflow when the observed target is no longer usable", () => {
  const player = createCentralPlayer({ advisors: [oneShotSwitchAdvisor()] });
  player.decide(battleObservation({
    captureId: "battle-command",
    frame: 400,
    battleUi: { stage: "action", cursor: 2, selected: "pokemon" },
  }));

  const invalidated = player.decide(battleObservation({
    captureId: "party-target-fainted",
    frame: 402,
    partyUi: { stage: "choose-pokemon", cursor: 0, selectedPartySlot: 0 },
    party: [
      { slot: 0, species: 46, level: 8, hp: 13, maxHp: 25 },
      { slot: 1, species: 56, level: 9, hp: 12, maxHp: 27 },
      { slot: 2, species: 5, level: 21, hp: 0, maxHp: 61 },
    ],
  }));

  assert.notEqual(player.state().workflow?.targetPartySlot, 2);
  assert.notEqual(invalidated.winner?.recommendation.targetPartySlot, 2);
});

test("the central player recovers an orphaned battle party picker from cartridge state", () => {
  const player = createCentralPlayer({ advisors: [] });

  const recovered = player.decide(battleObservation({
    captureId: "resumed-party-picker",
    frame: 500,
    partyUi: { stage: "choose-pokemon", cursor: 0, selectedPartySlot: 0 },
  }));

  assert.deepEqual(recovered.winner?.recommendation, {
    kind: "choose-party-member",
    targetPartySlot: 2,
    targetSpecies: 5,
    objective: "recover-orphaned-battle-party-selection",
  });
  assert.deepEqual(recovered.action.buttons, ["down"]);
  assert.equal(player.state().workflow.targetPartySlot, 2);
});

test("orphan recovery never hijacks a battle item target picker", () => {
  const player = createCentralPlayer({ advisors: [] });

  const itemTarget = player.decide(battleObservation({
    captureId: "battle-item-target",
    frame: 600,
    partyUi: {
      stage: "choose-pokemon",
      cursor: 0,
      selectedPartySlot: 0,
      itemId: 19,
    },
  }));

  assert.equal(itemTarget.winner, null);
  assert.equal(player.state().workflow, null);
});

test("a checkpointed central workflow resumes with its original target", () => {
  const original = createCentralPlayer({
    advisors: [oneShotSwitchAdvisor({ targetPartySlot: 1, targetSpecies: 56 })],
  });
  original.decide(battleObservation({
    captureId: "before-checkpoint",
    frame: 700,
    battleUi: { stage: "action", cursor: 2, selected: "pokemon" },
  }));

  const resumed = createCentralPlayer({
    advisors: [],
    initialState: structuredClone(original.state()),
  });
  const decision = resumed.decide(battleObservation({
    captureId: "after-checkpoint",
    frame: 702,
    partyUi: { stage: "choose-pokemon", cursor: 0, selectedPartySlot: 0 },
  }));

  assert.equal(decision.winner?.recommendation.targetPartySlot, 1);
  assert.equal(resumed.state().workflow.targetSpecies, 56);
});

test("a manual handoff discards a stale central workflow before policy resumes", () => {
  const player = createCentralPlayer({ advisors: [oneShotSwitchAdvisor()] });
  player.decide(battleObservation({
    captureId: "before-manual-control",
    frame: 800,
    battleUi: { stage: "action", cursor: 2, selected: "pokemon" },
  }));
  assert.equal(player.state().workflow.targetPartySlot, 2);
  const observation = battleObservation({
    captureId: "after-manual-control",
    frame: 860,
    battleUi: { stage: "move", cursor: 0, selected: "move-1" },
  });

  player.resumeFromManual({
    handoff: {
      schema: "master-red/manual-control-handoff/v1",
      session: 1,
      startedFrame: 810,
      endedFrame: 860,
      inputEvents: [
        { frame: 812, buttons: ["a"] },
        { frame: 813, buttons: [] },
      ],
    },
    observation,
  });

  assert.equal(player.state().workflow, null);
  assert.equal(player.state().lastDecision, null);
  assert.deepEqual(player.state().manualControl, {
    sessionCount: 1,
    lastHandoff: {
      schema: "master-red/manual-control-handoff/v1",
      session: 1,
      startedFrame: 810,
      endedFrame: 860,
      inputEvents: [
        { frame: 812, buttons: ["a"] },
        { frame: 813, buttons: [] },
      ],
      finalObservationId: "after-manual-control",
      finalFrame: 860,
      finalSramSha256: "sram",
      interruptedObjectiveId: "protect-training-member",
    },
  });
});
