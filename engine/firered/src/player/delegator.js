import {
  assertAdvisorProposal,
  assertAtomicObservation,
  routeObservation,
} from "../foundation.js";
import { encodeButtons } from "../emulator/mgba-session.js";
import { actionPrecondition } from "../emulator/action-precondition.js";
import { reservedPlayerPartySlots } from "./battle-legality.js";
import { createMovementRecovery } from "./movement-recovery.js";
import { createLimitCycleDetector } from "./limit-cycle.js";
import { createTransactionRecovery } from "./transaction-recovery.js";
import {battleMoveCursorStep,createMenuRouteRecovery} from './menu-navigation.js';
import { createEncounterSafety } from "./encounter-safety.js";
import { isInGameTradePartyMenu } from "./in-game-trade.js";
import { battleTapeFromEnvironment, recordBattleTurn } from "./battle-tape.js";

const RECOMMENDATION_PRIORITY = Object.freeze({
  "stop-for-review": 20_000,
  "mission-complete": 10_000,
  "retain-active-pokemon": 900,
  "cancel-battle-move-for-run": 890,
  // A source-identified incompatible modal must unwind before any advisor can
  // reinterpret its cursor as part of a different menu workflow.
  "cancel-conflicting-menu": 885,
  "choose-party-member": 880,
  "choose-party-action": 880,
  "confirm-battle-target": 870,
  "choose-battle-move": 860,
  "choose-battle-command": 850,
  "choose-safari-command": 850,
  "choose-move-to-forget": 840,
  "choose-pp-move": 840,
  // A policy selecting a concrete observed menu item owns that workflow step.
  // Generic cleanup may close a menu only when no targeted menu action exists.
  "close-menu": 825,
  "choose-start-menu-item": 830,
  "choose-fly-destination": 830,
  "choose-bag-context-action": 830,
  "choose-tm-case-item": 830,
  "choose-bag-item": 830,
  "choose-bag-pocket": 830,
  "choose-mart-menu-item": 830,
  "choose-mart-item": 830,
  "choose-mart-quantity": 830,
  "choose-storage-option": 830,
  "choose-storage-party-member": 830,
  "choose-storage-box": 830,
  "choose-storage-continue": 830,
  "choose-storage-box-member": 830,
  "confirm-storage-action": 830,
  "cancel-storage-action": 830,
  "exit-storage-mode": 830,
  "exit-storage": 830,
  "choose-storage-menu-action": 830,
  "confirm-storage-release": 830,
  "acknowledge-storage-message": 830,
  // A cartridge-owned A/B prompt must drain before field controls can accept
  // Start. Opening a new modal remains above ordinary overworld intent.
  "open-start-menu": 790,
  "choose-menu-option": 820,
  "choose-new-game-option": 820,
  "enter-naming-screen-text": 820,
  "keep-pokemon-species-name": 820,
  "acknowledge-cartridge-prompt": 800,
  "choose-default-cartridge-option": 780,
  // Overworld recommendations express policy intent; their transport primitive
  // must not decide which policy wins. Confidence resolves conflicts between
  // walking, interacting, and crossing a transition.
  "interact-with-object": 500,
  "interact-with-background": 500,
  "traverse-map-connection": 500,
  "traverse-door-warp": 500,
  "traverse-directional-warp": 500,
  "reenter-map-warp": 500,
  "traverse-ledge": 500,
  "use-field-move": 500,
  "face-fishing-water": 500,
  "face-direction": 500,
  "use-fishing-rod": 500,
  "push-field-obstacle": 500,
  "move-toward": 500,
  "wait-for-supported-objective": 10,
  "permit-current-observation": 0,
  "withhold-unsafe-decision": -1,
});

const CYCLING_ROAD_SLOPE_BEHAVIORS = new Set([
  "MB_CYCLING_ROAD_PULL_DOWN",
  "MB_CYCLING_ROAD_PULL_DOWN_GRASS",
]);
const CYCLING_ROAD_BRAKE_TRANSITION_REASONS = new Set([
  "battle-transition",
  "callback-change",
  "palette-fade",
  "tile-transition",
  "transient-callback",
]);
const BICYCLE_AVATAR_FLAGS = (1 << 1) | (1 << 2);

function cursorStep(from, to, columns = 2) {
  if (!Number.isSafeInteger(from) || !Number.isSafeInteger(to)) return null;
  const source = { x: from % columns, y: Math.floor(from / columns) };
  const target = { x: to % columns, y: Math.floor(to / columns) };
  if (source.y < target.y) return "down";
  if (source.y > target.y) return "up";
  if (source.x < target.x) return "right";
  if (source.x > target.x) return "left";
  return "a";
}

function cyclicCursorStep(from, to, size) {
  if (
    !Number.isSafeInteger(from) || !Number.isSafeInteger(to) ||
    !Number.isSafeInteger(size) || size <= 0
  ) return null;
  if (from === to) return "a";
  const right = (to - from + size) % size;
  const left = (from - to + size) % size;
  return right <= left ? "right" : "left";
}

function battleTargetStep(from, to) {
  if (!Number.isSafeInteger(from) || !Number.isSafeInteger(to)) return null;
  if (from === to) return "a";
  const identities = [0, 2, 3, 1];
  const source = identities.indexOf(from);
  const target = identities.indexOf(to);
  if (source < 0 || target < 0) return null;
  const right = (target - source + identities.length) % identities.length;
  const left = (source - target + identities.length) % identities.length;
  return right <= left ? "right" : "left";
}

const UPPERCASE_NAMING_KEYS = Object.freeze(Object.fromEntries(
  ["ABCDEF", "GHIJKL", "MNOPQRS", "TUVWXYZ"].flatMap((row, y) =>
    [...row].map((letter, x) => [letter, Object.freeze({ x, y })]),
  ),
));

function namingTextStep(naming, targetText) {
  if (!naming?.inputReady || naming.state !== 2 || !naming.cursor) return null;
  // Names are entered exactly, in their case: upper-case letters on page 1,
  // lower-case on page 2 (the official player presets are all upper case).
  const target = String(targetText ?? "");
  if (!/^[A-Za-z]+$/u.test(target) || target.length>(naming.subject==='pokemon'?10:7)) return null;
  const typed = String(naming.text ?? "");
  if (!target.startsWith(typed) || typed.length > target.length) return "b";
  const { x, y } = naming.cursor;
  if (!Number.isSafeInteger(x) || !Number.isSafeInteger(y)) return null;
  if (typed === target) return x === 8 && y === 2 ? "a" : "start";
  if(naming.page!==(/[a-z]/.test(target[typed.length])?2:1))return 'select';
  const destination = UPPERCASE_NAMING_KEYS[target[typed.length].toUpperCase()];
  if (y < destination.y) return "down";
  if (y > destination.y) return "up";
  if (x < destination.x) return "right";
  if (x > destination.x) return "left";
  return "a";
}

function keepPokemonSpeciesNameStep(naming) {
  if (naming?.subject !== "pokemon" || ![2, 3].includes(naming.template) ||
      !naming.inputReady || naming.state !== 2 || naming.textIsBlank !== true ||
      ![0, 1, 2].includes(naming.page)) return null;
  const { x, y } = naming.cursor ?? {};
  const okColumn = naming.page === 0 ? 6 : 8;
  if (!Number.isSafeInteger(x) || !Number.isSafeInteger(y) ||
      x < 0 || x > okColumn || y < 0 || y > 3) return null;
  // FireRed naming_screen.c: START selects OK; accepting an all-EOS/space
  // input leaves destBuffer untouched. B deletes characters; it cannot exit.
  return x === okColumn && y === 2 ? "a" : "start";
}

function bounded(buttons, reason, holdFrames = 1, releaseFrames = 1) {
  return Object.freeze({
    kind: buttons.length ? "bounded-edge" : "neutral",
    buttons: Object.freeze([...buttons]),
    holdFrames: Math.max(1, Math.min(8, holdFrames)),
    releaseFrames: Math.max(1, Math.min(8, releaseFrames)),
    reason,
  });
}

function sustained(buttons, reason, holdFrames = 4, movementLease = null) {
  return Object.freeze({
    kind: "sustained-chord",
    buttons: Object.freeze([...buttons]),
    holdFrames: Math.max(1, Math.min(8, holdFrames)),
    releaseFrames: 0,
    reason,
    ...(movementLease ? { movementLease: deepFreezeMovementLease(movementLease) } : {}),
  });
}

function deepFreezeMovementLease(lease) {
  return Object.freeze({
    ...lease,
    origin: Object.freeze({ ...lease.origin }),
    ...(lease.target ? { target: Object.freeze({ ...lease.target }) } : {}),
    ...(lease.segments ? {
      segments: Object.freeze(lease.segments.map((segment) => Object.freeze({
        ...segment,
        target: Object.freeze({ ...segment.target }),
      }))),
    } : {}),
    ...(lease.continuationButtons ? {
      continuationButtons: Object.freeze([...lease.continuationButtons]),
    } : {}),
    ...(lease.stopButtons ? {
      stopButtons: Object.freeze([...lease.stopButtons]),
    } : {}),
  });
}

function routePlanMovementLease(recommendation, observation) {
  const plan = recommendation?.routePlan;
  const map = observation.playerMemory?.map?.id;
  const { x, y } = observation.playerMemory?.position ?? {};
  if (
    plan?.map !== map ||
    !Number.isSafeInteger(x) || !Number.isSafeInteger(y) ||
    Number(plan?.origin?.x) !== x || Number(plan?.origin?.y) !== y ||
    !Array.isArray(plan?.segments) || plan.segments.length === 0 ||
    typeof plan?.mapRevision !== "string" ||
    !/^[0-9a-f]{64}$/.test(plan.mapRevision)
  ) return null;

  let cursor = { x, y };
  let steps = 0;
  const segments = [];
  for (const segment of plan.segments) {
    const vector = {
      north: { dx: 0, dy: -1 },
      south: { dx: 0, dy: 1 },
      west: { dx: -1, dy: 0 },
      east: { dx: 1, dy: 0 },
    }[segment?.direction];
    const segmentSteps = Number(segment?.steps);
    const endpoint = segment?.endpoint;
    if (
      !vector || !Number.isSafeInteger(segmentSteps) || segmentSteps < 1 ||
      !Number.isSafeInteger(endpoint?.x) || !Number.isSafeInteger(endpoint?.y) ||
      endpoint.x !== cursor.x + vector.dx * segmentSteps ||
      endpoint.y !== cursor.y + vector.dy * segmentSteps
    ) return null;
    cursor = { x: endpoint.x, y: endpoint.y };
    steps += segmentSteps;
    segments.push({
      direction: segment.direction,
      target: { map, x: cursor.x, y: cursor.y },
    });
  }
  if (
    steps !== Number(plan.steps) ||
    cursor.x !== Number(plan.destination?.x) ||
    cursor.y !== Number(plan.destination?.y) ||
    plan.segments[0].direction !== recommendation.direction
  ) return null;
  return {
    kind: "route-plan",
    origin: { map, x, y },
    target: { map, x: cursor.x, y: cursor.y },
    segments,
    mapRevision: plan.mapRevision,
    maximumFrames: Math.min(36000, Math.max(90, steps * 24 + 60)),
    stallFrames: 60,
  };
}

function oneTileMovementLease(observation) {
  const map = observation.playerMemory?.map?.id;
  const { x, y } = observation.playerMemory?.position ?? {};
  if (
    typeof map !== "string" || map === "" ||
    !Number.isSafeInteger(x) || !Number.isSafeInteger(y)
  ) return null;
  return {
    kind: "one-tile",
    origin: { map, x, y },
    maximumFrames: 60,
  };
}

function routeSegmentMovementLease(recommendation, observation, maximumSteps = 2) {
  const segment = recommendation?.pathSegment;
  const map = observation.playerMemory?.map?.id;
  const { x, y } = observation.playerMemory?.position ?? {};
  const endpoint = segment?.endpoint;
  const vector = {
    north: { dx: 0, dy: -1 },
    south: { dx: 0, dy: 1 },
    west: { dx: -1, dy: 0 },
    east: { dx: 1, dy: 0 },
  }[recommendation?.direction];
  const steps = Number(segment?.steps);
  if (
    !vector || segment?.direction !== recommendation.direction ||
    typeof map !== "string" || map === "" || endpoint?.map !== map ||
    !Number.isSafeInteger(x) || !Number.isSafeInteger(y) ||
    !Number.isSafeInteger(endpoint?.x) || !Number.isSafeInteger(endpoint?.y) ||
    !Number.isSafeInteger(steps) || steps < 1 ||
    endpoint.x !== x + vector.dx * steps ||
    endpoint.y !== y + vector.dy * steps
  ) return null;

  if (steps === 1) {
    return {
      kind: "one-tile",
      origin: { map, x, y },
      maximumFrames: 60,
    };
  }
  const leasedSteps = Math.min(maximumSteps, steps);
  return {
    kind: "route-segment",
    origin: { map, x, y },
    target: {
      map,
      x: x + vector.dx * leasedSteps,
      y: y + vector.dy * leasedSteps,
    },
    maximumFrames: Math.min(3600, Math.max(90, leasedSteps * 24 + 60)),
    stallFrames: 60,
  };
}

function mapConnectionMovementLease(recommendation, observation) {
  if (
    recommendation?.kind !== "traverse-map-connection" ||
    recommendation?.transit?.kind !== "connection" ||
    recommendation.transit.direction !== recommendation.direction
  ) return null;
  const originLease = oneTileMovementLease(observation);
  const destinationMap = recommendation.transit.destinationMap;
  if (
    !originLease || typeof destinationMap !== "string" ||
    destinationMap === "" || destinationMap === originLease.origin.map
  ) return null;
  return {
    kind: "map-connection",
    origin: originLease.origin,
    destinationMap,
    maximumFrames: 180,
  };
}

function matchesOwnedRetainedInput(observation, decision) {
  const action = decision?.action;
  const heldKeysRaw = observation.emulator?.input?.heldKeysRaw;
  const retainedButtons = action?.movementLease?.continuationButtons ??
    action?.buttons;
  // A cycling-road pull reports continuous tile transitions while the owned
  // chord is held; treat that exactly like an ordinary retained input so the
  // climb is not vetoed into a neutral release.
  const slopePull = cyclingRoadTransitionButtons(observation) !== null;
  return (
    action?.kind === "sustained-chord" &&
    (observation.phase === "stable" || slopePull) &&
    observation.emulator?.mode === "overworld" &&
    observation.emulator?.inputReady === false &&
    observation.playerMemory?.battle == null &&
    Number.isSafeInteger(heldKeysRaw) &&
    heldKeysRaw !== 0 &&
    (heldKeysRaw === encodeButtons(retainedButtons) ||
      (slopePull && Array.isArray(action.buttons) && action.buttons.length > 0 &&
        heldKeysRaw === encodeButtons(action.buttons)))
  );
}

function cyclingRoadTransitionButtons(observation) {
  const reasons = observation.phaseReasons;
  const memory = observation.playerMemory;
  const position = memory?.position;
  const avatarFlags = Number(memory?.avatar?.flags ?? 0);
  if (
    observation.phase !== "transition" ||
    observation.emulator?.mode !== "overworld" ||
    !Array.isArray(reasons) || reasons.length === 0 ||
    reasons.some((reason) => !CYCLING_ROAD_BRAKE_TRANSITION_REASONS.has(reason)) ||
    (avatarFlags & BICYCLE_AVATAR_FLAGS) === 0 ||
    !Number.isSafeInteger(position?.x) ||
    !Number.isSafeInteger(position?.y)
  ) return null;
  const currentCell = (memory?.mapGrid?.cells ?? []).find(({ x, y }) =>
    Number(x) === position.x && Number(y) === position.y
  );
  if (!CYCLING_ROAD_SLOPE_BEHAVIORS.has(currentCell?.behaviorName)) return null;
  return Object.freeze(["b"]);
}

// Continue an owned movement chord across a tile transition, or brake the
// bicycle on a cycling-road slope. Shared so a waiting task (an in-flight
// evolution, player task or acquisition) retains the same transition input the
// central player would issue itself; otherwise the slope pull carries the
// character away while the task waits with neutral input.
export function retainedTransitionAction(observation, lastDecision) {
  const isOrdinaryTileTransition =
    observation.phase === "transition" &&
    observation.phaseReasons?.length === 1 &&
    observation.phaseReasons[0] === "tile-transition";
  const action = lastDecision?.action;
  const heldKeysRaw = observation.emulator?.input?.heldKeysRaw;
  const holdsKeys = (buttons) =>
    Array.isArray(buttons) && buttons.length > 0 &&
    Number.isSafeInteger(heldKeysRaw) &&
    heldKeysRaw === encodeButtons(buttons);
  const movementLeaseContinuation = action?.movementLease?.continuationButtons;
  const continuesMovementLeaseTransition =
    isOrdinaryTileTransition &&
    action?.kind === "sustained-chord" &&
    holdsKeys(movementLeaseContinuation);
  const slopePull = cyclingRoadTransitionButtons(observation) !== null;
  // The cycling-road pull keeps an owned climb chord pressed until its lease
  // ends; otherwise the pull wins as soon as the chord is released.
  const continuesSlopeChord =
    isOrdinaryTileTransition &&
    slopePull &&
    !continuesMovementLeaseTransition &&
    action?.kind === "sustained-chord" &&
    holdsKeys(action.buttons);
  if (continuesMovementLeaseTransition || continuesSlopeChord) {
    return Object.freeze({
      reason: continuesMovementLeaseTransition
        ? "continuous-movement-lease-transition"
        : "continuous-slope-climb-transition",
      action: sustained(
        continuesMovementLeaseTransition
          ? movementLeaseContinuation
          : action.buttons,
        continuesMovementLeaseTransition
          ? "continue-movement-lease-tile-transition"
          : "continue-slope-climb-transition",
        action.holdFrames,
      ),
    });
  }
  const continuesOrdinaryTileMotion =
    isOrdinaryTileTransition &&
    action?.kind === "sustained-chord" &&
    !action.movementLease;
  if (continuesOrdinaryTileMotion) {
    return Object.freeze({
      reason: "continuous-tile-transition",
      action: sustained(action.buttons, "continue-running-tile-transition", action.holdFrames),
    });
  }
  if (!slopePull) return null;
  return Object.freeze({
    reason: "cycling-road-brake-transition",
    action: sustained(["b"], "hold-cycling-road-brake-transition"),
  });
}

function isVerifierVeto(candidate) {
  return candidate?.advisor === "verifier" &&
    candidate.recommendation?.kind === "withhold-unsafe-decision" &&
    candidate.vetoes.includes("all");
}

export function mapRecommendation(recommendation, observation) {
  const ui = observation.playerMemory?.ui ?? {};
  switch (recommendation?.kind) {
    case "mission-complete":
      return bounded([], "mission-complete");
    case "acknowledge-cartridge-prompt":
      return recommendation.cyclingRoadSlope === true
        ? sustained(
            ["b", "a"],
            "acknowledge-cartridge-prompt-cycling-road-slope",
          )
        : bounded(["a"], recommendation.kind);
    case "choose-default-cartridge-option":
      return bounded(["a"], recommendation.kind);
    case "choose-new-game-option": {
      const current = ui.newGame?.cursor;
      const target = recommendation.targetIndex;
      const button = !Number.isSafeInteger(current) || !Number.isSafeInteger(target)
        ? null
        : current < target
          ? "down"
          : current > target
            ? "up"
            : "a";
      return bounded(button ? [button] : [], "new-game-option");
    }
    case "enter-naming-screen-text": {
      const button = namingTextStep(ui.naming, recommendation.targetText);
      return bounded(button ? [button] : [], "naming-screen-text");
    }
    case "keep-pokemon-species-name": {
      const button = /NamingScreen/.test(observation.emulator?.callback2 ?? "")
        ? keepPokemonSpeciesNameStep(ui.naming) : null;
      return bounded(button ? [button] : [], "keep-pokemon-species-name");
    }
    case "retain-active-pokemon":
      return bounded(["b"], "decline-free-shift");
    case "cancel-battle-move-for-run":
      return bounded(["b"], "cancel-battle-move-for-run");
    case "choose-battle-command": {
      const target = { fight: 0, bag: 1, pokemon: 2, run: 3 }[
        recommendation.targetCommand
      ];
      const button = cursorStep(ui.battle?.cursor, target, 2);
      return bounded(button ? [button] : [], "battle-command");
    }
    case "choose-safari-command": {
      const button = cursorStep(
        ui.battle?.cursor,
        recommendation.targetIndex,
        2,
      );
      return bounded(button ? [button] : [], "safari-command");
    }
    case "choose-battle-move": {
      const observedStep=battleMoveCursorStep(recommendation,observation);
      const button = observedStep===undefined ? cursorStep(
        ui.battle?.cursor,
        recommendation.targetMoveSlot,
        2,
      ) : observedStep;
      return bounded(button ? [button] : [], "battle-move");
    }
    case "confirm-battle-target": {
      const button = battleTargetStep(
        ui.battle?.cursor,
        recommendation.targetBattler,
      );
      return bounded(button ? [button] : [], "battle-target");
    }
    case "choose-menu-option": {
      const target = Number.isSafeInteger(recommendation.targetIndex)
        ? recommendation.targetIndex
        : recommendation.targetOption === "yes" ? 0 : 1;
      // Party-menu Yes/No prompts (held-item switch, Mail to PC, lose Mail).
      const partyPrompt = /^confirm-/.test(ui.party?.stage ?? "") ? ui.party.cursor : null;
      const current = ui.choiceMenu?.cursor ?? ui.saveDialog?.cursor ??
        ui.moveLearning?.cursor ?? ui.mart?.cursor ?? partyPrompt ?? 0;
      const button = current === target ? "a" : current < target ? "down" : "up";
      return bounded([button], "menu-option");
    }
    case "choose-move-to-forget": {
      const button = cursorStep(
        ui.moveLearning?.cursor,
        recommendation.targetMoveSlot,
        1,
      );
      return bounded(button ? [button] : [], "move-to-forget");
    }
    case 'choose-pp-move': {
      const button=ui.party?.stage==='restore-pp-move'
        ? cursorStep(ui.party.cursor,recommendation.targetMoveSlot,1) : null;
      return bounded(button ? [button] : [],'restore-move-pp');
    }
    case "choose-party-member": {
      if (ui.party?.stage === "selection-menu") {
        return bounded(["b"], "close-party-action-before-selection");
      }
      const current = ui.party?.cursor;
      const target = recommendation.targetPartySlot;
      const button = !Number.isSafeInteger(current) || !Number.isSafeInteger(target)
        ? null
        : current < target
          ? "down"
          : current > target
            ? "up"
            : "a";
      return bounded(button ? [button] : [], "party-member");
    }
    case "choose-party-action": {
      const button = cursorStep(
        ui.party?.actionCursor,
        recommendation.targetIndex,
        1,
      );
      return bounded(button ? [button] : [], "party-action");
    }
    case "open-start-menu":
      return bounded(["start"], "open-start-menu");
    case "face-direction":
    case "face-fishing-water": {
      const button = {
        north: "up",
        south: "down",
        west: "left",
        east: "right",
      }[recommendation.direction];
      return bounded(button ? [button] : [], "face-fishing-water", 1, 1);
    }
    case "use-fishing-rod": {
      const button = {
        north: "up",
        south: "down",
        west: "left",
        east: "right",
      }[recommendation.direction];
      if (observation.playerMemory?.avatar?.facing !== recommendation.direction) {
        return bounded(button ? [button] : [], "face-fishing-water", 1, 1);
      }
      return bounded(["start"], "open-fishing-rod-menu");
    }
    case "cancel-conflicting-menu":
      return bounded(["b"], "cancel-conflicting-menu");
    case "close-menu":
      return bounded(["b"], "close-menu");
    case "choose-start-menu-item": {
      const button = cursorStep(
        ui.startMenu?.cursor,
        recommendation.targetIndex,
        1,
      );
      return bounded(button ? [button] : [], "start-menu-item");
    }
    case "choose-fly-destination": {
      const current = ui.flyMap?.cursor;
      const target = recommendation.targetCursor;
      const button = !Number.isSafeInteger(current?.x) ||
          !Number.isSafeInteger(current?.y) ||
          !Number.isSafeInteger(target?.x) ||
          !Number.isSafeInteger(target?.y)
        ? null
        : current.y < target.y
          ? "down"
          : current.y > target.y
            ? "up"
            : current.x < target.x
              ? "right"
              : current.x > target.x
                ? "left"
                : "a";
      return bounded(button ? [button] : [], "fly-map-destination");
    }
    case "choose-bag-pocket": {
      const current = ui.bag?.pocket;
      const target = recommendation.targetPocket;
      const button = !Number.isSafeInteger(current) || !Number.isSafeInteger(target)
        ? null
        : current === target
          ? "a"
          : current < target
            ? "right"
            : "left";
      return bounded(button ? [button] : [], "bag-pocket");
    }
    case "choose-bag-item":
    case "choose-tm-case-item": {
      const current = ui.bag?.index;
      const target = recommendation.targetIndex;
      const button = !Number.isSafeInteger(current) || !Number.isSafeInteger(target)
        ? null
        : current < target
          ? "down"
          : current > target
            ? "up"
            : "a";
      return bounded(
        button ? [button] : [],
        recommendation.kind === "choose-tm-case-item"
          ? "tm-case-item"
          : "bag-item",
      );
    }
    case "choose-bag-context-action": {
      const button = cursorStep(
        ui.bag?.contextCursor,
        recommendation.targetIndex,
        1,
      );
      return bounded(button ? [button] : [], "bag-context-action");
    }
    case "choose-mart-menu-item":
    case "choose-mart-item": {
      const current = ui.mart?.cursor;
      const target = recommendation.targetIndex;
      const button = !Number.isSafeInteger(current) || !Number.isSafeInteger(target)
        ? null
        : current < target
          ? "down"
          : current > target
            ? "up"
            : "a";
      return bounded(
        button ? [button] : [],
        recommendation.kind === "choose-mart-item" ? "mart-item" : "mart-menu-item",
      );
    }
    case "choose-mart-quantity": {
      const current = ui.mart?.quantity;
      const target = recommendation.targetQuantity;
      const button = !Number.isSafeInteger(current) || !Number.isSafeInteger(target)
        ? null
        : current < target
          ? "up"
          : current > target
            ? "down"
            : "a";
      return bounded(button ? [button] : [], "mart-quantity");
    }
    case "choose-storage-option": {
      const button = cursorStep(
        ui.storage?.option,
        recommendation.targetIndex,
        1,
      );
      return bounded(button ? [button] : [], "storage-option");
    }
    case "choose-storage-party-member": {
      const button = cursorStep(
        ui.storage?.cursorPosition,
        recommendation.targetPartySlot,
        1,
      );
      return bounded(button ? [button] : [], "storage-party-member");
    }
    case "choose-storage-box": {
      const button = cyclicCursorStep(
        ui.storage?.depositBox,
        recommendation.targetBox,
        14,
      );
      return bounded(button ? [button] : [], "storage-deposit-box");
    }
    case "choose-storage-continue": {
      const button = cursorStep(
        ui.storage?.option,
        recommendation.targetIndex,
        1,
      );
      return bounded(button ? [button] : [], "storage-continue");
    }
    case "choose-storage-box-member": {
      const storage = ui.storage ?? {};
      let button = null;
      if (storage.cursorArea === "party") {
        button = "right";
      } else if (storage.cursorArea === "buttons") {
        button = "up";
      } else if (storage.cursorArea === "box-title") {
        button = Number(storage.currentBox) === Number(recommendation.targetBox)
          ? "down"
          : cyclicCursorStep(
              storage.currentBox,
              recommendation.targetBox,
              14,
            );
      } else if (storage.cursorArea === "box") {
        button = Number(storage.currentBox) === Number(recommendation.targetBox)
          ? cursorStep(
              storage.cursorPosition,
              recommendation.targetBoxSlot,
              6,
            )
          : "start";
      }
      return bounded(button ? [button] : [], "storage-box-member");
    }
    case "confirm-storage-action":
      return bounded(["a"], "storage-action");
    case "choose-storage-menu-action": {
      // Move to the observed label, then choose it; a menu that no longer
      // lists that action at that row gets no input.
      const menu = ui.storage?.menu;
      const button = menu?.items?.[recommendation.targetIndex] === recommendation.targetAction
        ? cursorStep(menu.cursor, recommendation.targetIndex, 1)
        : null;
      return bounded(button ? [button] : [], "storage-menu-action");
    }
    case "confirm-storage-release": {
      const button = ui.storage?.stage === "release-confirm"
        ? cursorStep(ui.storage.option, recommendation.targetIndex, 1)
        : null;
      return bounded(button ? [button] : [], "storage-release-confirm");
    }
    case "acknowledge-storage-message":
      return bounded(["a"], "storage-message");
    case "cancel-storage-action":
      return bounded(["b"], "cancel-storage-action");
    case "exit-storage-mode":
      return bounded(["b"], "exit-storage-mode");
    case "exit-storage":
      return bounded(["b"], "exit-storage");
    case "interact-with-object":
    case "interact-with-background": {
      const button = {
        north: "up",
        south: "down",
        west: "left",
        east: "right",
      }[recommendation.direction];
      const cyclingRoadSlope = recommendation.cyclingRoadSlope === true;
      if (observation.playerMemory?.avatar?.facing !== recommendation.direction) {
        if (button && cyclingRoadSlope) {
          return sustained(
            ["b", button],
            "face-object-cycling-road-slope",
          );
        }
        return bounded(button ? [button] : [], "face-object");
      }
      if (cyclingRoadSlope) {
        return bounded(
          ["b", "a"],
          `${recommendation.kind}-cycling-road-slope`,
        );
      }
      return bounded(["a"], recommendation.kind);
    }
    case "use-field-move": {
      if (ui.choiceMenu) {
        const current = ui.choiceMenu.cursor ?? 0;
        return bounded([current === 0 ? "a" : "up"], "confirm-field-move");
      }
      const button = {
        north: "up",
        south: "down",
        west: "left",
        east: "right",
      }[recommendation.direction];
      const cyclingRoadSlope = recommendation.cyclingRoadSlope === true;
      if (observation.playerMemory?.avatar?.facing !== recommendation.direction) {
        if (button && cyclingRoadSlope) {
          return sustained(
            ["b", button],
            "face-field-obstacle-cycling-road-slope",
          );
        }
        return bounded(button ? [button] : [], "face-field-obstacle");
      }
      if (cyclingRoadSlope) {
        return sustained(
          ["b", button, "a"],
          "use-field-move-cycling-road-slope",
        );
      }
      return bounded(["a"], "use-field-move");
    }
    case "push-field-obstacle": {
      const button = {
        north: "up",
        south: "down",
        west: "left",
        east: "right",
      }[recommendation.direction];
      return bounded(button ? [button] : [], "push-field-obstacle", 4, 1);
    }
    case "move-toward":
    case "traverse-map-connection":
    case "traverse-door-warp":
    case "traverse-directional-warp":
    case "reenter-map-warp":
    case "traverse-ledge": {
      const button = {
        north: "up",
        south: "down",
        west: "left",
        east: "right",
      }[recommendation.direction];
      const reason = recommendation.kind === "traverse-directional-warp"
        ? "directional-warp"
        : recommendation.kind === "reenter-map-warp"
          ? "reenter-warp"
        : recommendation.kind === "traverse-ledge"
          ? "ledge"
        : recommendation.kind === "traverse-door-warp"
          ? "door-warp"
          : recommendation.kind === "traverse-map-connection"
            ? "map-connection"
            : "navigation";
      const running = recommendation.useRunningShoes === true &&
        ["move-toward", "traverse-map-connection"].includes(recommendation.kind);
      const cyclingRoadSlope =
        recommendation.cyclingRoadSlope === true &&
        ["move-toward", "traverse-map-connection"].includes(recommendation.kind);
      const routePlanLease = button
        ? routePlanMovementLease(recommendation, observation)
        : null;
      if (button && cyclingRoadSlope) {
        const movementLease =
          routePlanLease ??
          routeSegmentMovementLease(recommendation, observation, Infinity) ??
          oneTileMovementLease(observation);
        if (movementLease) {
          return sustained(
            ["b", button],
            `${reason}-cycling-road-slope`,
            4,
            {
              ...movementLease,
              // Brake at every endpoint, including short downhill approaches
              // to moving trainers. Neutral input would coast past the target.
              continuationButtons: ["b"],
              stopButtons: ["b"],
            },
          );
        }
      }
      if (button && routePlanLease) {
        const travelMode = recommendation.travelMode ?? (running ? "run" : "walk");
        const suffix = {
          run: "running",
          bicycle: "bicycle",
          surf: "surfing",
          walk: "walking",
        }[travelMode] ?? "walking";
        return sustained(
          travelMode === "run" ? ["b", button] : [button],
          `${reason}-${suffix}`,
          4,
          routePlanLease,
        );
      }
      if (button && running) {
        const movementLease =
          mapConnectionMovementLease(recommendation, observation) ??
          routeSegmentMovementLease(recommendation, observation) ??
          oneTileMovementLease(observation);
        if (movementLease) {
          return sustained(
            ["b", button],
            `${reason}-running`,
            4,
            movementLease,
          );
        }
      }
      if (
        button &&
        ["move-toward", "traverse-map-connection"].includes(recommendation.kind)
      ) {
        const movementLease =
          mapConnectionMovementLease(recommendation, observation) ??
          oneTileMovementLease(observation);
        if (movementLease) {
          const suffix = {
            bicycle: "bicycle",
            surf: "surfing",
            walk: "walking",
          }[recommendation.travelMode] ?? "walking";
          return sustained(
            [button],
            `${reason}-${suffix}`,
            4,
            movementLease,
          );
        }
      }
      return bounded(button ? [button] : [], reason, 4, 1);
    }
    default:
      return bounded([], recommendation?.kind ?? "no-recommendation");
  }
}

function flattenAdvice(advisor, observation) {
  const supplied = advisor.advise(observation);
  if (supplied === null || supplied === undefined) return [];
  return Array.isArray(supplied) ? supplied : [supplied];
}

function battlePartyWorkflowProposal(workflow, observation) {
  const partyUi = observation.playerMemory?.ui?.party;
  const battleUi = observation.playerMemory?.ui?.battle;
  if (
    workflow?.kind !== "battle-party-selection" ||
    observation.emulator?.mode !== "battle"
  ) {
    return null;
  }
  const recommendation = battleUi?.stage === "action" && !partyUi
    ? {
        kind: "choose-battle-command",
        targetCommand: "pokemon",
        targetPartySlot: workflow.targetPartySlot,
        targetSpecies: workflow.targetSpecies,
        objective: workflow.objective,
      }
    : partyUi?.stage === "choose-pokemon"
    ? {
        kind: "choose-party-member",
        targetPartySlot: workflow.targetPartySlot,
        targetSpecies: workflow.targetSpecies,
        objective: workflow.objective,
      }
    : partyUi?.stage === "selection-menu"
      ? Number(partyUi.selectedPartySlot) === workflow.targetPartySlot ? {
          kind: "choose-menu-option",
          targetIndex: 0,
          objective: workflow.objective,
        } : {
          kind: "cancel-conflicting-menu",
          objective: workflow.objective,
        }
      : null;
  if (!recommendation) return null;
  return {
    advisor: "verifier",
    observationId: observation.captureId,
    recommendation,
    confidence: 1,
    constraints: [
      "pending-central-workflow",
      partyUi ? `observed-party-${partyUi.stage}` : "observed-battle-action",
    ],
    vetoes: [],
    evidenceRefs: [
      `workflow:${workflow.id}`,
      `cartridge:party-slot:${workflow.targetPartySlot}`,
    ],
  };
}

function battlePartyTargetFingerprint(member) {
  if (!member || typeof member !== "object") return null;
  const species = Number(member.species);
  if (!Number.isSafeInteger(species) || species <= 0) return null;
  const level = Number(member.level);
  const maxHp = Number(member.maxHp);
  const moves = Array.isArray(member.moves)
    ? member.moves.map(Number).filter(Number.isSafeInteger)
    : null;
  return Object.freeze({
    species,
    ...(Number.isSafeInteger(member.personality) && Number.isSafeInteger(member.otId)
      ? { personality: member.personality, otId: member.otId } : {}),
    level: Number.isSafeInteger(level) ? level : null,
    maxHp: Number.isSafeInteger(maxHp) ? maxHp : null,
    moves: moves?.length ? Object.freeze(moves) : null,
  });
}

function matchesBattlePartyWorkflowTarget(member, workflow) {
  if (!member || Number(member.hp) <= 0) return false;
  if (
    workflow.targetSpecies !== null &&
    Number(member.species) !== Number(workflow.targetSpecies)
  ) {
    return false;
  }
  const fingerprint = workflow.targetFingerprint;
  if (!fingerprint) return true;
  if (Number(member.species) !== Number(fingerprint.species)) return false;
  if (Number.isSafeInteger(fingerprint.personality) && Number.isSafeInteger(fingerprint.otId)) {
    return member.personality === fingerprint.personality && member.otId === fingerprint.otId;
  }
  if (
    Number.isSafeInteger(fingerprint.level) &&
    Number(member.level) !== fingerprint.level
  ) {
    return false;
  }
  if (
    Number.isSafeInteger(fingerprint.maxHp) &&
    Number(member.maxHp) !== fingerprint.maxHp
  ) {
    return false;
  }
  if (Array.isArray(fingerprint.moves) && Array.isArray(member.moves)) {
    return fingerprint.moves.length === member.moves.length &&
      fingerprint.moves.every((move, slot) => Number(member.moves[slot]) === move);
  }
  return true;
}

function battlePartyWorkflowActor(observation, opensPartyPicker) {
  const battleUiBattler = Number(observation.playerMemory?.ui?.battle?.battler);
  if (opensPartyPicker && [0, 2].includes(battleUiBattler)) {
    return battleUiBattler;
  }
  const isDouble = (Number(observation.playerMemory?.battleTypeFlags) & 1) !== 0;
  const activeBattler = Number(observation.playerMemory?.activeBattler);
  return isDouble && [0, 2].includes(activeBattler) ? activeBattler : 0;
}

function battlePartyWorkflowFromWinner(winner, observation, sequence) {
  const recommendation = winner?.recommendation;
  const opensPartyFromBattleCommand =
    recommendation?.kind === "choose-battle-command" &&
    recommendation.targetCommand === "pokemon";
  const opensPartyFromFreeShift =
    recommendation?.kind === "choose-menu-option" &&
    recommendation.targetOption === "yes" &&
    Boolean(observation.playerMemory?.battle?.announcedOpponentName);
  const opensPartyPicker = opensPartyFromBattleCommand || opensPartyFromFreeShift;
  const selectsPartyMember =
    recommendation?.kind === "choose-party-member" &&
    observation.emulator?.mode === "battle";
  if (
    (!opensPartyPicker && !selectsPartyMember) ||
    !Number.isSafeInteger(recommendation.targetPartySlot)
  ) {
    return null;
  }
  const partyMember = (observation.playerMemory?.trainer?.party ?? []).find(
    ({ slot }) => Number(slot) === recommendation.targetPartySlot,
  );
  return Object.freeze({
    schema: "master-red/control-workflow/v1",
    id: `battle-party-${sequence}`,
    kind: "battle-party-selection",
    objective: recommendation.objective ?? "switch-party-member",
    targetPartySlot: recommendation.targetPartySlot,
    targetSpecies: recommendation.targetSpecies ?? partyMember?.species ?? null,
    targetFingerprint: battlePartyTargetFingerprint(partyMember),
    actingBattler: battlePartyWorkflowActor(observation, opensPartyPicker),
    sourceAdvisor: winner.advisor,
    stage: "opening-party-picker",
    enteredPartyPicker: false,
    startedObservationId: observation.captureId,
    startedFrame: observation.frame,
  });
}

function fieldMoveWorkflowFromWinner(winner, observation, sequence) {
  const recommendation = winner?.recommendation;
  if (recommendation?.kind !== "use-field-move") return null;
  return Object.freeze({
    schema: "master-red/control-workflow/v1",
    id: `field-move-${sequence}`,
    kind: "field-move-confirmation",
    objective: recommendation.objective ?? `use-${recommendation.fieldMove}`,
    fieldMove: recommendation.fieldMove,
    moveId: Number.isSafeInteger(Number(recommendation.moveId))
      ? Number(recommendation.moveId)
      : null,
    direction: recommendation.direction ?? null,
    sourceAdvisor: winner.advisor,
    stage: "opening-confirmation",
    enteredConfirmation: false,
    startedObservationId: observation.captureId,
    startedFrame: observation.frame,
  });
}

function inGameTradeWorkflowFromWinner(winner, observation, sequence) {
  const recommendation = winner?.recommendation;
  if (
    recommendation?.workflowKind !== "in-game-trade" ||
    !Number.isSafeInteger(Number(recommendation.requestedSpecies)) ||
    !Number.isSafeInteger(Number(recommendation.receivedSpecies))
  ) {
    return null;
  }
  const requestedSpecies = Number(recommendation.requestedSpecies);
  const receivedSpecies = Number(recommendation.receivedSpecies);
  const targetPartySlot = Number.isSafeInteger(recommendation.targetPartySlot)
    ? recommendation.targetPartySlot
    : (observation.playerMemory?.trainer?.party ?? []).find(
        ({ species }) => Number(species) === requestedSpecies,
      )?.slot;
  if (!Number.isSafeInteger(targetPartySlot)) return null;
  return Object.freeze({
    schema: "master-red/control-workflow/v1",
    id: `in-game-trade-${sequence}`,
    kind: "in-game-trade",
    map: observation.playerMemory?.map?.id,
    objective: recommendation.objective ?? "complete-in-game-trade",
    requestedSpecies,
    receivedSpecies,
    targetPartySlot,
    sourceAdvisor: winner.advisor,
    stage: "selecting-offer",
    enteredTrade: false,
    startedObservationId: observation.captureId,
    startedFrame: observation.frame,
  });
}

function reconcileBattlePartyWorkflow(workflow, observation) {
  if (workflow?.kind !== "battle-party-selection" || observation.phase !== "stable") {
    return workflow;
  }
  if (observation.emulator?.mode !== "battle") return null;
  const ui = observation.playerMemory?.ui ?? {};
  const battle = observation.playerMemory?.battle;
  const party = observation.playerMemory?.trainer?.party;
  if (Array.isArray(party)) {
    const target = party.find(({ slot }) => Number(slot) === workflow.targetPartySlot);
    if (!matchesBattlePartyWorkflowTarget(target, workflow)) {
      const relocatedTarget = party.find((member) =>
        matchesBattlePartyWorkflowTarget(member, workflow)
      );
      if (!relocatedTarget) return null;
      workflow = Object.freeze({
        ...workflow,
        targetPartySlot: Number(relocatedTarget.slot),
      });
    }
  }
  const actingBattler = [0, 2].includes(Number(workflow.actingBattler))
    ? Number(workflow.actingBattler)
    : 0;
  if (reservedPlayerPartySlots({
    battleTypeFlags: observation.playerMemory?.battleTypeFlags,
    battle,
    excludeBattler: actingBattler,
  }).has(workflow.targetPartySlot)) {
    return null;
  }
  const activeTarget = battle?.battlers?.[actingBattler] ??
    (actingBattler === 0 ? battle?.player : null);
  const activeTargetPartySlot = Number(
    battle?.battlerPartyIndexes?.[actingBattler] ??
      (actingBattler === 0 ? battle?.playerPartySlot : Number.NaN),
  );
  const activeTargetSpeciesMatches =
    workflow.targetSpecies === null ||
    Number(activeTarget?.species) === Number(workflow.targetSpecies);
  const activeTargetSlotMatches =
    Number.isSafeInteger(activeTargetPartySlot) &&
    activeTargetPartySlot === workflow.targetPartySlot;
  const hasNativeIdentity = Number.isSafeInteger(workflow.targetFingerprint?.personality) &&
    Number.isSafeInteger(workflow.targetFingerprint?.otId);
  // Native battlers do not expose personality/OT here. Their remapped party
  // index is authoritative; matching stats cannot prove a duplicate is active.
  // Retain the old fallback for legacy checkpoints without native identity.
  const targetIsActive =
    activeTargetSpeciesMatches &&
    (
      activeTargetSlotMatches || (!hasNativeIdentity && (
        !Number.isSafeInteger(activeTargetPartySlot) ||
        matchesBattlePartyWorkflowTarget(
          {
            ...activeTarget,
            hp: activeTarget?.hp ?? 1,
          },
          workflow,
        )
      ))
    ) &&
    (
      (!ui.party && Boolean(ui.battle)) ||
      (Boolean(ui.party) && activeTargetSlotMatches)
    );
  if (targetIsActive) return null;
  if (ui.party) {
    const stage = ui.party.stage === "choose-pokemon"
      ? "choosing-party-member"
      : ui.party.stage === "selection-menu"
        ? "confirming-party-action"
        : "party-message";
    if (workflow.enteredPartyPicker && workflow.stage === stage) return workflow;
    return Object.freeze({ ...workflow, stage, enteredPartyPicker: true });
  }
  if (ui.battle?.stage === "action" && workflow.enteredPartyPicker) return null;
  return workflow;
}

function reconcileFieldMoveWorkflow(workflow, observation) {
  if (workflow?.kind !== "field-move-confirmation" || observation.phase !== "stable") {
    return workflow;
  }
  if (observation.emulator?.mode !== "overworld") return null;
  const ui = observation.playerMemory?.ui ?? {};
  if (
    workflow.fieldMove === "surf" &&
    observation.playerMemory?.avatar?.surfing === true
  ) {
    return null;
  }
  if (ui.choiceMenu) {
    if (workflow.enteredConfirmation) return workflow;
    return Object.freeze({
      ...workflow,
      stage: "confirming-field-move",
      enteredConfirmation: true,
    });
  }
  if (ui.fieldDialog) return workflow;
  return null;
}

function partyOwnsSpecies(observation, species) {
  return (observation.playerMemory?.trainer?.party ?? []).some(
    (member) => Number(member.species) === Number(species),
  );
}

function reconcileInGameTradeWorkflow(workflow, observation) {
  if (workflow?.kind !== "in-game-trade") return workflow;
  const tradeUi = observation.playerMemory?.ui?.inGameTrade;
  if (observation.emulator?.mode === "in-game-trade") {
    const stage = tradeUi?.stage === "completion"
      ? "awaiting-completion"
      : "animating";
    if (workflow.enteredTrade && workflow.stage === stage) return workflow;
    return Object.freeze({ ...workflow, stage, enteredTrade: true });
  }
  if (observation.phase !== "stable") return workflow;
  if (partyOwnsSpecies(observation, workflow.receivedSpecies)) return null;
  if (isInGameTradePartyMenu(observation, workflow.map)) {
    return workflow;
  }
  // Once the callback has returned, a failed or cancelled transaction must be
  // replanned from cartridge state instead of retaining stale menu ownership.
  return null;
}

function fieldMoveWorkflowProposal(workflow, observation) {
  if (
    workflow?.kind !== "field-move-confirmation" ||
    observation.emulator?.mode !== "overworld" ||
    !observation.playerMemory?.ui?.choiceMenu
  ) {
    return null;
  }
  return {
    advisor: "verifier",
    observationId: observation.captureId,
    recommendation: {
      kind: "choose-menu-option",
      targetOption: "yes",
      objective: workflow.objective,
    },
    confidence: 1,
    constraints: [
      "pending-central-workflow",
      "field-move-confirmation-owns-prompt",
    ],
    vetoes: [],
    evidenceRefs: [
      `workflow:${workflow.id}`,
      `cartridge:field-move:${workflow.fieldMove}`,
    ],
  };
}

function inGameTradeWorkflowProposal(workflow, observation) {
  if (workflow?.kind !== "in-game-trade" || observation.phase !== "stable") {
    return null;
  }
  const ui = observation.playerMemory?.ui ?? {};
  let recommendation = null;
  if (
    observation.emulator?.mode === "in-game-trade" &&
    ui.inGameTrade?.stage === "completion"
  ) {
    recommendation = {
      kind: "acknowledge-cartridge-prompt",
      objective: workflow.objective,
    };
  } else if (isInGameTradePartyMenu(observation, workflow.map)) {
    if (ui.party?.stage === "choose-pokemon") {
      recommendation = {
        kind: "choose-party-member",
        targetPartySlot: workflow.targetPartySlot,
        targetSpecies: workflow.requestedSpecies,
        objective: workflow.objective,
      };
    } else if (ui.party?.stage === "message") {
      recommendation = {
        kind: "acknowledge-cartridge-prompt",
        objective: workflow.objective,
      };
    }
  }
  if (!recommendation) return null;
  return {
    advisor: "verifier",
    observationId: observation.captureId,
    recommendation,
    confidence: 1,
    constraints: [
      "pending-central-workflow",
      "source-backed-in-game-trade-state",
    ],
    vetoes: [],
    evidenceRefs: [
      `workflow:${workflow.id}`,
      `cartridge:trade-requested-species:${workflow.requestedSpecies}`,
      `cartridge:trade-received-species:${workflow.receivedSpecies}`,
    ],
  };
}

function observedActivePartySlot(observation) {
  const party = observation.playerMemory?.trainer?.party ?? [];
  const battle = observation.playerMemory?.battle;
  const reportedSlot = Number(battle?.playerPartySlot);
  const reportedMember = party.find(({ slot }) => Number(slot) === reportedSlot);
  if (
    reportedMember &&
    Number(reportedMember.species) === Number(battle?.player?.species)
  ) {
    return reportedSlot;
  }
  return party.find(({ species, hp }) =>
    Number(species) === Number(battle?.player?.species) &&
    Number(hp) === Number(battle?.player?.hp)
  )?.slot ?? party.find(({ species }) =>
    Number(species) === Number(battle?.player?.species)
  )?.slot ?? null;
}

function orphanedBattlePartyProposal(observation) {
  const partyUi = observation.playerMemory?.ui?.party;
  if (
    observation.emulator?.mode !== "battle" ||
    partyUi?.stage !== "choose-pokemon" ||
    partyUi.itemId
  ) {
    return null;
  }
  const battle = observation.playerMemory?.battle;
  const activePartySlot = observedActivePartySlot(observation);
  const unavailablePartySlots = reservedPlayerPartySlots({
    battleTypeFlags: observation.playerMemory?.battleTypeFlags,
    battle,
  });
  if (Number.isSafeInteger(activePartySlot)) {
    unavailablePartySlots.add(Number(activePartySlot));
  }
  if ((Number(observation.playerMemory?.battleTypeFlags) & 1) !== 0) {
    const absentBattlerFlags = Number(battle?.absentBattlerFlags ?? 0) >>> 0;
    for (const battler of [0, 2]) {
      if ((absentBattlerFlags & (1 << battler)) !== 0) continue;
      const partySlot = Number(battle?.battlerPartyIndexes?.[battler]);
      if (Number.isSafeInteger(partySlot)) unavailablePartySlots.add(partySlot);
    }
  }
  const target = [...(observation.playerMemory?.trainer?.party ?? [])]
    .filter(({ slot, hp }) =>
      !unavailablePartySlots.has(Number(slot)) && Number(hp) > 0
    )
    .sort((left, right) =>
      Number(right.level ?? 0) - Number(left.level ?? 0) ||
      Number(right.hp ?? 0) / Math.max(1, Number(right.maxHp ?? 0)) -
        Number(left.hp ?? 0) / Math.max(1, Number(left.maxHp ?? 0)) ||
      Number(right.hp ?? 0) - Number(left.hp ?? 0) ||
      Number(left.slot ?? 0) - Number(right.slot ?? 0)
    )[0] ?? null;
  if (!target) return null;
  return {
    advisor: "verifier",
    observationId: observation.captureId,
    recommendation: {
      kind: "choose-party-member",
      targetPartySlot: target.slot,
      targetSpecies: target.species,
      objective: "recover-orphaned-battle-party-selection",
    },
    confidence: 0.9,
    constraints: ["orphaned-battle-party-picker", "usable-reserve-member"],
    vetoes: [],
    evidenceRefs: [
      `cartridge:callback:${observation.emulator?.callback2 ?? "unknown"}`,
      `cartridge:party-slot:${target.slot}:species:${target.species}`,
    ],
  };
}

function restoredWorkflow(initialState) {
  const workflow = initialState?.workflow ?? null;
  if (workflow === null) return null;
  const commonValid =
    workflow?.schema === "master-red/control-workflow/v1" &&
    typeof workflow.id === "string" && workflow.id !== "";
  const battlePartyValid = workflow.kind === "battle-party-selection" &&
    Number.isSafeInteger(workflow.targetPartySlot) &&
    workflow.targetPartySlot >= 0 && workflow.targetPartySlot <= 5 &&
    (workflow.actingBattler === undefined ||
      [0, 2].includes(Number(workflow.actingBattler))) &&
    [null, "number"].includes(
      workflow.targetSpecies === null ? null : typeof workflow.targetSpecies,
    );
  const fieldMoveValid = workflow.kind === "field-move-confirmation" &&
    typeof workflow.objective === "string" && workflow.objective !== "" &&
    typeof workflow.fieldMove === "string" && workflow.fieldMove !== "" &&
    (workflow.moveId === null || Number.isSafeInteger(workflow.moveId)) &&
    (workflow.direction === null ||
      ["north", "south", "west", "east"].includes(workflow.direction)) &&
    typeof workflow.enteredConfirmation === "boolean" &&
    Number.isSafeInteger(workflow.startedFrame) && workflow.startedFrame >= 0;
  const inGameTradeValid = workflow.kind === "in-game-trade" &&
    typeof workflow.objective === "string" && workflow.objective !== "" &&
    Number.isSafeInteger(workflow.requestedSpecies) &&
    workflow.requestedSpecies > 0 &&
    Number.isSafeInteger(workflow.receivedSpecies) &&
    workflow.receivedSpecies > 0 &&
    Number.isSafeInteger(workflow.targetPartySlot) &&
    workflow.targetPartySlot >= 0 && workflow.targetPartySlot <= 5 &&
    typeof workflow.enteredTrade === "boolean" &&
    Number.isSafeInteger(workflow.startedFrame) && workflow.startedFrame >= 0;
  if (!commonValid || (!battlePartyValid && !fieldMoveValid && !inGameTradeValid)) {
    throw new TypeError("central player initial workflow is invalid");
  }
  return Object.freeze({ ...workflow });
}

function restoredManualControl(initialState) {
  const value = initialState?.manualControl ?? null;
  if (value === null) {
    return Object.freeze({ sessionCount: 0, lastHandoff: null });
  }
  if (
    !Number.isSafeInteger(value?.sessionCount) || value.sessionCount < 0 ||
    (value.lastHandoff !== null && typeof value.lastHandoff !== "object")
  ) {
    throw new TypeError("central player manual-control state is invalid");
  }
  return Object.freeze(structuredClone(value));
}

function observedManualHandoff(handoff, observation, interruptedObjectiveId = null) {
  if (
    handoff?.schema !== "master-red/manual-control-handoff/v1" ||
    !Number.isSafeInteger(handoff.session) || handoff.session <= 0 ||
    !Number.isSafeInteger(handoff.startedFrame) || handoff.startedFrame < 0 ||
    !Number.isSafeInteger(handoff.endedFrame) ||
    handoff.endedFrame < handoff.startedFrame ||
    !Array.isArray(handoff.inputEvents)
  ) {
    throw new TypeError("manual control handoff is invalid");
  }
  const inputEvents = handoff.inputEvents.map((event) => {
    if (
      !Number.isSafeInteger(event?.frame) ||
      event.frame < handoff.startedFrame || event.frame > handoff.endedFrame ||
      !Array.isArray(event.buttons)
    ) {
      throw new TypeError("manual control input event is invalid");
    }
    encodeButtons(event.buttons);
    return Object.freeze({
      frame: event.frame,
      buttons: Object.freeze([...event.buttons]),
    });
  });
  return Object.freeze({
    schema: handoff.schema,
    session: handoff.session,
    startedFrame: handoff.startedFrame,
    endedFrame: handoff.endedFrame,
    inputEvents: Object.freeze(inputEvents),
    finalObservationId: observation.captureId,
    finalFrame: observation.frame,
    finalSramSha256: observation.sram?.sha256 ?? null,
    ...(typeof interruptedObjectiveId === "string" && interruptedObjectiveId !== ""
      ? { interruptedObjectiveId }
      : {}),
  });
}

export function createCentralPlayer({
  advisors = [],
  initialState = null,
  campaignPlanner = null,
  huntConfig = null,
  resumeProtectedCapture = false,
  captureRequirements = null,
  mechanics = {},
  battleTape = battleTapeFromEnvironment(),
} = {}) {
  if (!Array.isArray(advisors) || advisors.some((advisor) =>
    typeof advisor?.advise !== "function" ||
    (advisor.advisePrompt !== undefined &&
      typeof advisor.advisePrompt !== "function") ||
    (advisor.observeManualRecovery !== undefined &&
      typeof advisor.observeManualRecovery !== "function")
  )) {
    throw new TypeError("central player requires advice-only policy objects");
  }
  if (initialState !== null && (
    typeof initialState !== "object" ||
    !Number.isSafeInteger(initialState.sequence) || initialState.sequence < 0 ||
    ![null, "string"].includes(
      initialState.initialSramSha256 === null
        ? null
        : typeof initialState.initialSramSha256,
    )
  )) {
    throw new TypeError("central player initial state is invalid");
  }
  if (campaignPlanner !== null && typeof campaignPlanner?.state !== "function") {
    throw new TypeError("central player campaign planner must expose state");
  }
  let sequence = initialState?.sequence ?? 0;
  let lastDecision = null;
  let rejectedActionFrame = initialState?.rejectedActionFrame ?? null;
  if (rejectedActionFrame !== null && (!Number.isSafeInteger(rejectedActionFrame) || rejectedActionFrame < 0)) {
    throw new TypeError('invalid rejected action evidence');
  }
  let initialSramSha256 = initialState?.initialSramSha256 ?? null;
  let workflow = restoredWorkflow(initialState);
  let manualControl = restoredManualControl(initialState);
  const movementRecovery = createMovementRecovery(initialState?.movementRecovery);
  const limitCycle = createLimitCycleDetector(initialState?.limitCycle);
  const transactionRecovery = createTransactionRecovery(initialState?.transactionRecovery);
  const menuRouteRecovery = createMenuRouteRecovery(initialState?.menuRouteRecovery);
  const encounterSafety = createEncounterSafety({ initialState: initialState?.encounterSafety, config: huntConfig, mechanics, resumeProtectedCapture, captureRequirements });
  const notifyManualRecovery = ({
    handoff,
    observation = null,
    interruptedDecision = null,
    interruptedObjectiveId = null,
  }) => {
    const recovery = Object.freeze({
      handoff,
      observation,
      interruptedDecision,
      interruptedObjectiveId,
    });
    for (const advisor of advisors) advisor.observeManualRecovery?.(recovery);
  };
  if (manualControl.lastHandoff?.interruptedObjectiveId) {
    notifyManualRecovery({
      handoff: manualControl.lastHandoff,
      interruptedObjectiveId: manualControl.lastHandoff.interruptedObjectiveId,
    });
  }
  const player = {
    observeExecution(update) {
      movementRecovery.observeExecution(update);
      menuRouteRecovery.observeExecution(update);
      if (update.execution?.interrupted === 'stale-observation') {
        rejectedActionFrame = Number.isSafeInteger(update.execution.endFrame)
          ? update.execution.endFrame : update.observation.frame;
      }
    },
    resumeFromManual({ handoff, observation } = {}) {
      assertAtomicObservation(observation);
      const interruptedDecision = lastDecision;
      const interruptedObjectiveId =
        interruptedDecision?.winner?.recommendation?.objective ?? null;
      const lastHandoff = observedManualHandoff(
        handoff,
        observation,
        interruptedObjectiveId,
      );
      workflow = null;
      movementRecovery.reset();
      limitCycle.reset();
      transactionRecovery.reset();
      menuRouteRecovery.reset();
      rejectedActionFrame = null;
      lastDecision = null;
      manualControl = Object.freeze({
        sessionCount: manualControl.sessionCount + 1,
        lastHandoff,
      });
      notifyManualRecovery({
        handoff: lastHandoff,
        observation,
        interruptedDecision,
        interruptedObjectiveId,
      });
      return manualControl;
    },
    decide(observation, { beforeAction } = {}) {
      assertAtomicObservation(observation);
      observation = limitCycle.observe(movementRecovery.observation(observation));
      menuRouteRecovery.observe(observation);
      sequence += 1;
      const encounterCheck = encounterSafety.inspect(observation);
      // Budgets continue observing battle time even when encounter handling owns
      // the next intention. A protected capture has its own stricter deadlines.
      const plannerCheck = campaignPlanner?.safetyCheck?.(observation);
      const safety = encounterSafety.state().capture ? encounterCheck : plannerCheck ?? encounterCheck;
      if (safety) {
        // A readiness wait suspends input, not the committed transaction.
        // Dropping the switch here lets strategy change its target between
        // opening a member's submenu and confirming the action.
        if (safety.kind !== "resample") workflow = null;
        const winner = safety.recommendation ? assertAdvisorProposal({ advisor: "verifier",
          observationId: observation.captureId, recommendation: safety.recommendation,
          confidence: 1, constraints: ["protected-encounter"], vetoes: [],
          evidenceRefs: ["cartridge:checked-pokemon-identity"] }) : null;
        lastDecision = Object.freeze({ sequence, kind: safety.kind, reason: safety.reason,
          observationId: observation.captureId, proposals: winner ? [winner] : [], rejected: [], winner,
          action: winner ? mapRecommendation(winner.recommendation, observation) : bounded([], safety.reason),
          protectedEncounter: encounterSafety.state().capture });
        lastDecision=menuRouteRecovery.adjust(observation,lastDecision);
        return lastDecision;
      }
      if (transactionRecovery.blocked()) {
        lastDecision = Object.freeze({ sequence, kind: "blocked", observationId: observation.captureId,
          reason: "repeated-menu-transaction", proposals: [], rejected: [], winner: null,
          action: bounded([], "safety-stop"), recovery: transactionRecovery.blocked() });
        return lastDecision;
      }
      const rejectedFrame = rejectedActionFrame;
      rejectedActionFrame = null;
      if (rejectedFrame !== null && observation.frame <= rejectedFrame) {
        // In frame-exact play a rejected command advances no game time. Drain
        // a bounded neutral interval instead of rejecting the same frame for
        // ever. Capture/review stops above retain priority and no goal is reset.
        lastDecision = Object.freeze({sequence,kind:'resample',observationId:observation.captureId,
          reason:'resample-after-stale-action',proposals:[],rejected:[],winner:null,
          action:bounded([], 'settle-after-stale-action', 2, 1)});
        return lastDecision;
      }
      initialSramSha256 ??= observation.sram?.sha256 ?? null;
      workflow = reconcileBattlePartyWorkflow(workflow, observation);
      workflow = reconcileFieldMoveWorkflow(workflow, observation);
      workflow = reconcileInGameTradeWorkflow(workflow, observation);
      const disposition = routeObservation(observation);
      if (disposition.kind === "resample") {
        const continuation = retainedTransitionAction(observation, lastDecision);
        lastDecision = Object.freeze({
          sequence,
          kind: "resample",
          observationId: observation.captureId,
          reason: continuation?.reason ?? disposition.reason,
          proposals: Object.freeze([]),
          rejected: Object.freeze([]),
          winner: null,
          action:
            continuation?.action ??
            bounded([], `resample-${disposition.reason}`, 8, 8),
        });
        return lastDecision;
      }

      const proposals = [];
      const rejected = [];
      const pendingWorkflowProposal =
        battlePartyWorkflowProposal(workflow, observation) ??
        fieldMoveWorkflowProposal(workflow, observation) ??
        inGameTradeWorkflowProposal(workflow, observation);
      const workflowProposal = pendingWorkflowProposal
        ? assertAdvisorProposal(pendingWorkflowProposal)
        : null;
      const promptProposals = [];
      if (!workflowProposal) {
        for (const advisor of advisors) {
          if (typeof advisor.advisePrompt !== "function") continue;
          for (const raw of flattenAdvice({
            advise: advisor.advisePrompt,
          }, observation)) {
            let candidate;
            try {
              candidate = assertAdvisorProposal(raw);
            } catch (error) {
              rejected.push({
                advisor: advisor.id ?? "unknown",
                reason: "invalid-prompt-contract",
                detail: error.message,
              });
              continue;
            }
            if (candidate.observationId !== observation.captureId) {
              rejected.push({
                advisor: candidate.advisor,
                reason: "stale-prompt-observation",
              });
              continue;
            }
            promptProposals.push(candidate);
          }
        }
      }
      const authoritativeProposals = workflowProposal
        ? [workflowProposal]
        : promptProposals;
      proposals.push(...authoritativeProposals);
      for (const advisor of advisors) {
        // A reconciled workflow or source-observed ready prompt already owns
        // this exact input. Re-running strategic policies cannot change its
        // winner, but the verifier must retain its ability to veto the frame.
        if (authoritativeProposals.length > 0 && advisor.id !== "verifier") {
          continue;
        }
        for (const raw of flattenAdvice(advisor, observation)) {
          let candidate;
          try {
            candidate = assertAdvisorProposal(raw);
          } catch (error) {
            rejected.push({ advisor: advisor.id ?? "unknown", reason: "invalid-contract",
              detail: error.message });
            continue;
          }
          if (candidate.observationId !== observation.captureId) {
            rejected.push({ advisor: candidate.advisor, reason: "stale-observation" });
            continue;
          }
          proposals.push(candidate);
        }
      }

      const expectedRetainedVerifierVeto = matchesOwnedRetainedInput(
        observation,
        lastDecision,
      )
        ? proposals.find(isVerifierVeto) ?? null
        : null;
      if (expectedRetainedVerifierVeto) {
        rejected.push({
          advisor: expectedRetainedVerifierVeto.advisor,
          reason: "expected-retained-controller-input",
          detail: "held cartridge keys exactly match the central player's retained chord",
        });
      }
      const veto = proposals.find((candidate) =>
        candidate !== expectedRetainedVerifierVeto &&
        candidate.vetoes.includes("all")
      );
      if (veto) {
        lastDecision = Object.freeze({
          sequence,
          kind: "resample",
          observationId: observation.captureId,
          reason: "policy-veto",
          proposals: Object.freeze(proposals),
          rejected: Object.freeze(rejected),
          winner: veto,
          action: bounded([], "policy-veto"),
        });
        return lastDecision;
      }

      let eligible = authoritativeProposals.length > 0
        ? [...authoritativeProposals]
        : proposals.filter(
            (candidate) =>
              candidate !== expectedRetainedVerifierVeto &&
              candidate.recommendation.kind !== "permit-current-observation",
          );
      if (eligible.length === 0) {
        const orphanedPartyProposal = orphanedBattlePartyProposal(observation);
        if (orphanedPartyProposal) {
          const candidate = assertAdvisorProposal(orphanedPartyProposal);
          proposals.push(candidate);
          eligible = [candidate];
        }
      }
      eligible.sort((left, right) =>
        (RECOMMENDATION_PRIORITY[right.recommendation.kind] ?? 100) -
          (RECOMMENDATION_PRIORITY[left.recommendation.kind] ?? 100) ||
        right.confidence - left.confidence ||
        left.advisor.localeCompare(right.advisor)
      );
      const winner = eligible[0] ?? null;
      if(winner?.recommendation.kind==='stop-for-review') {
        lastDecision=Object.freeze({sequence,kind:'blocked',observationId:observation.captureId,
          reason:winner.recommendation.reason,proposals:Object.freeze(proposals),rejected:Object.freeze(rejected),winner,
          action:bounded([],'preparation-stopped')});
        return lastDecision;
      }
      workflow ??=
        battlePartyWorkflowFromWinner(winner, observation, sequence) ??
        fieldMoveWorkflowFromWinner(winner, observation, sequence) ??
        inGameTradeWorkflowFromWinner(winner, observation, sequence);
      const complete = winner?.recommendation.kind === "mission-complete";
      if (complete) {
        const postSaveTask = (observation.playerMemory?.activeTasks ?? []).some(
          ({ function: name }) =>
            /^Task_Hof_(?:DelayAfterSave|StartDisplayingMons|DisplayMon|DisplayPlayer|ShowCongratulations)/.test(
              name ?? "",
            ),
        );
        // Any ordinary save changes the opening SRAM. Completion needs the
        // native Hall of Fame save transaction itself to have finished.
        if (!postSaveTask) {
          lastDecision = Object.freeze({
            sequence,
            kind: "resample",
            observationId: observation.captureId,
            reason: "native-save-pending",
            proposals: Object.freeze(proposals),
            rejected: Object.freeze([
              ...rejected,
              { advisor: winner.advisor, reason: "native-save-not-observed" },
            ]),
            winner,
            action: bounded([], "await-native-hall-save"),
          });
          return lastDecision;
        }
      }
      lastDecision = Object.freeze({
        sequence,
        kind: complete ? "complete" : winner ? "act" : "resample",
        observationId: observation.captureId,
        reason: complete ? "native-hall-of-fame" : winner ? "policy-resolution" : "no-advice",
        proposals: Object.freeze(proposals),
        rejected: Object.freeze(rejected),
        winner,
        action: mapRecommendation(winner?.recommendation, observation),
      });
      lastDecision=menuRouteRecovery.adjust(observation,lastDecision);
      // The execution owner may wait for a verified timing window instead of
      // submitting this input. Resolve that before recording a menu attempt.
      // Existing failure evidence stays intact; neither a wait nor a callback
      // can bypass the safety checks above or inject another controller input.
      if (lastDecision.kind === 'act' && lastDecision.action.buttons.length > 0 && beforeAction) {
        const deferred = beforeAction(lastDecision);
        if (deferred) {
          if (!['wait', 'stop'].includes(deferred.kind) || typeof deferred.reason !== 'string' || !deferred.reason ||
              Object.keys(deferred).some(key => !['kind', 'reason', 'holdFrames'].includes(key)) ||
              deferred.kind === 'wait' && (!Number.isSafeInteger(deferred.holdFrames) || deferred.holdFrames < 1 || deferred.holdFrames > 600)) {
            throw new TypeError('A deferred action requires a bounded neutral wait or stop.');
          }
          lastDecision = Object.freeze({...lastDecision,
            kind: deferred.kind === 'stop' ? 'blocked' : 'resample', reason: deferred.reason,
            action: Object.freeze({kind: 'neutral', buttons: Object.freeze([]),
              holdFrames: deferred.kind === 'wait' ? deferred.holdFrames : 1, releaseFrames: 0, reason: deferred.reason})});
          return lastDecision;
        }
      }
      const recovery = transactionRecovery.observe(observation, lastDecision);
      if (recovery) {
        workflow = null;
        const stopping = recovery.action === "stop";
        const reordered = recovery.reason === "complete-field-party-reorder";
        const recommendation = recovery.action === "unwind-menu"
          ? { kind: "cancel-conflicting-menu", objective: reordered ? "complete-field-party-reorder" : "recover-menu-transaction" }
          : null;
        lastDecision = Object.freeze({ ...lastDecision,
          kind: stopping ? "blocked" : recommendation ? "act" : "resample",
          reason: stopping ? "repeated-menu-transaction" : reordered ? "field-party-reorder-complete" : "menu-transaction-recovery",
          winner: recommendation ? { advisor: "verifier", observationId: observation.captureId,
            recommendation, confidence: 1, constraints: ["bounded-transaction-recovery"],
            vetoes: [], evidenceRefs: [`observation:${observation.captureId}`] } : null,
          action: recommendation ? mapRecommendation(recommendation, observation) : bounded([], "replan-stuck-transaction"),
          recovery,
        });
      }
      for (const advisor of advisors) advisor.observeDecision?.(observation, lastDecision);
      return lastDecision;
    },
    state() {
      return Object.freeze({
        schema: "master-red/central-player-state/v1",
        sequence,
        initialSramSha256,
        workflow,
        lastDecision,
        manualControl,
        movementRecovery: movementRecovery.state(),
        limitCycle: limitCycle.state(),
        transactionRecovery: transactionRecovery.state(),
        menuRouteRecovery: menuRouteRecovery.state(),
        ...(rejectedActionFrame !== null ? {rejectedActionFrame} : {}),
        encounterSafety: encounterSafety.state(),
        ...(campaignPlanner
          ? { campaignPlanner: campaignPlanner.state() }
          : {}),
      });
    },
  };
  return Object.freeze({ ...player, decide(observation, options) {
    // Input readiness is false while our previous chord is held too. Bind that
    // proven ownership before replacing lastDecision with the new intention.
    const retainedInput = matchesOwnedRetainedInput(observation, lastDecision);
    const decision = player.decide(observation, options);
    if (battleTape) recordBattleTurn(battleTape, observation, decision, mechanics);
    if (decision.action.buttons.length > 0 && Object.hasOwn(observation.playerMemory, "encounter")) {
      const precondition = actionPrecondition(observation, decision.action, {retainedInput});
      // A transition can retain verified field movement, but cannot begin a
      // fresh menu input. Neutral frames let the native animation finish even
      // when the emulator clock belongs exclusively to this controller.
      if (observation.phase !== 'stable' && !precondition.motion) {
        lastDecision = Object.freeze({...decision,action:bounded([], 'await-ready-action-contract', 8, 8)});
        return lastDecision;
      }
      lastDecision = Object.freeze({ ...decision,
        action: Object.freeze({ ...decision.action, precondition }) });
    }
    return lastDecision;
  } });
}

export function executeCentralAction({ session, action }) {
  if (!session || typeof session.step !== "function") {
    throw new TypeError("central action executor requires an emulator session");
  }
  if (!action || !Array.isArray(action.buttons)) {
    throw new TypeError("central action must be a mapped bounded action");
  }
  if (action.kind === "sustained-chord") {
    throw new TypeError(
      "sustained controller actions require the autonomous emulator",
    );
  }
  const holdFrames = Math.max(1, Math.min(8, Number(action.holdFrames) || 1));
  const releaseFrames = Math.max(1, Math.min(8, Number(action.releaseFrames) || 1));
  for (let index = 0; index < holdFrames; index += 1) {
    session.step(action.buttons);
  }
  for (let index = 0; index < releaseFrames; index += 1) session.step([]);
  return holdFrames + releaseFrames;
}

export async function executeCentralActionPaced({
  session,
  action,
  paceFrame = () => {},
}) {
  if (!session || typeof session.step !== "function") {
    throw new TypeError("central action executor requires an emulator session");
  }
  if (!action || !Array.isArray(action.buttons)) {
    throw new TypeError("central action must be a mapped bounded action");
  }
  if (action.kind === "sustained-chord") {
    throw new TypeError(
      "sustained controller actions require the autonomous emulator",
    );
  }
  if (typeof paceFrame !== "function") {
    throw new TypeError("central action frame pacer must be a function");
  }
  const holdFrames = Math.max(1, Math.min(8, Number(action.holdFrames) || 1));
  const releaseFrames = Math.max(1, Math.min(8, Number(action.releaseFrames) || 1));
  for (let index = 0; index < holdFrames; index += 1) {
    session.step(action.buttons);
    await paceFrame();
  }
  for (let index = 0; index < releaseFrames; index += 1) {
    session.step([]);
    await paceFrame();
  }
  return holdFrames + releaseFrames;
}
