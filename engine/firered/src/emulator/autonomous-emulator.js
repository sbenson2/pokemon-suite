import { BUTTON_BITS } from "./mgba-session.js";
import { actionPreconditionMatches } from './action-precondition.js';

const DEFAULT_PRESENTATION_FRAMES_PER_SECOND = 59.7275;
const MANUAL_EMULATION_SPEED = 1;
const GBA_BUTTON_ORDER = Object.freeze(Object.keys(BUTTON_BITS));
const ROUTE_DIRECTION_BUTTONS = Object.freeze({
  north: "up",
  south: "down",
  west: "left",
  east: "right",
});
const ROUTE_BUTTONS = new Set(Object.values(ROUTE_DIRECTION_BUTTONS));

function scheduleTimeout(callback, milliseconds) {
  const timer = setTimeout(callback, milliseconds);
  timer.unref?.();
  return timer;
}

function validateFrame(frame) {
  if (
    !Number.isSafeInteger(frame?.width) || frame.width <= 0 ||
    !Number.isSafeInteger(frame?.height) || frame.height <= 0 ||
    !(frame.rgba instanceof Uint8Array) ||
    frame.rgba.byteLength !== frame.width * frame.height * 4
  ) {
    throw new Error("autonomous emulator received an invalid framebuffer");
  }
}

function samePosition(state, coordinate) {
  return state?.map === coordinate?.map &&
    state?.x === coordinate?.x && state?.y === coordinate?.y;
}

function distanceTo(position, target) {
  return Math.abs(position.x - target.x) + Math.abs(position.y - target.y);
}

function routeSegmentDiverged(lease, state) {
  const { origin, target } = lease;
  if (!Number.isSafeInteger(state?.x) || !Number.isSafeInteger(state?.y)) {
    return true;
  }
  if (origin.x !== target.x) {
    return state.y !== origin.y ||
      (target.x > origin.x
        ? state.x < origin.x || state.x > target.x
        : state.x > origin.x || state.x < target.x);
  }
  return state.x !== origin.x ||
    (target.y > origin.y
      ? state.y < origin.y || state.y > target.y
      : state.y > origin.y || state.y < target.y);
}

function routeButtons(buttons, direction) {
  return [
    ...buttons.filter((button) => !ROUTE_BUTTONS.has(button)),
    ROUTE_DIRECTION_BUTTONS[direction],
  ];
}

function validRoutePlan(lease, buttons) {
  if (
    lease?.kind !== "route-plan" ||
    !Array.isArray(lease.segments) || lease.segments.length === 0 ||
    lease.segments.length > 4096 ||
    typeof lease.mapRevision !== "string" ||
    !/^[0-9a-f]{64}$/.test(lease.mapRevision)
  ) return false;
  let origin = lease.origin;
  for (const segment of lease.segments) {
    const target = segment?.target;
    const direction = segment?.direction;
    const vector = {
      north: { dx: 0, dy: -1 },
      south: { dx: 0, dy: 1 },
      west: { dx: -1, dy: 0 },
      east: { dx: 1, dy: 0 },
    }[direction];
    const dx = Number(target?.x) - Number(origin?.x);
    const dy = Number(target?.y) - Number(origin?.y);
    if (
      !vector || target?.map !== origin?.map ||
      !Number.isSafeInteger(target?.x) || !Number.isSafeInteger(target?.y) ||
      (vector.dx === 0 ? dx !== 0 : Math.sign(dx) !== vector.dx) ||
      (vector.dy === 0 ? dy !== 0 : Math.sign(dy) !== vector.dy) ||
      Math.abs(dx) + Math.abs(dy) < 1
    ) return false;
    origin = target;
  }
  return samePosition(origin, lease.target) &&
    buttons.filter((button) => ROUTE_BUTTONS.has(button)).length === 1 &&
    buttons.includes(ROUTE_DIRECTION_BUTTONS[lease.segments[0].direction]);
}

function canonicalButtons(buttons) {
  if (!Array.isArray(buttons)) {
    throw new TypeError("manual GBA buttons must be an array");
  }
  const selected = new Set(buttons);
  for (const button of selected) {
    if (!Object.hasOwn(BUTTON_BITS, button)) {
      throw new TypeError(`unknown GBA button: ${button}`);
    }
  }
  return GBA_BUTTON_ORDER.filter((button) => selected.has(button));
}

function sameButtons(left, right) {
  return left.length === right.length &&
    left.every((button, index) => button === right[index]);
}

export function createAutonomousEmulator({
  session,
  emulationSpeed = 1,
  presentationFramesPerSecond = DEFAULT_PRESENTATION_FRAMES_PER_SECOND,
  videoFramesPerSecond = presentationFramesPerSecond,
  controllerState = null,
  actionObservation = null,
  startPaused = false,
  frameExact = false,
  botFrameInput = null,
  canAdvanceFrame = null,
  adaptiveTiming = false,
  manualInputTimeoutMs = 750,
  clock = () => performance.now(),
  schedule = scheduleTimeout,
  cancel = clearTimeout,
} = {}) {
  if (!session || typeof session.step !== "function" ||
      typeof session.videoFrame !== "function") {
    throw new TypeError("autonomous emulator requires a cartridge session");
  }
  if (!Number.isFinite(emulationSpeed) || emulationSpeed < 1 || emulationSpeed > 10) {
    throw new TypeError("emulation speed must be a number from 1 through 10");
  }
  if (typeof adaptiveTiming !== 'boolean') throw new TypeError('adaptive timing must be boolean');
  if (!Number.isFinite(presentationFramesPerSecond) ||
      presentationFramesPerSecond <= 0 || presentationFramesPerSecond > 240) {
    throw new TypeError("presentation frame rate must be a number from 0 through 240");
  }
  if (controllerState !== null && typeof controllerState !== "function") {
    throw new TypeError("controller state reader must be a function");
  }
  if (actionObservation !== null && typeof actionObservation !== 'function') throw new TypeError('action observation reader must be a function');
  if (botFrameInput !== null && typeof botFrameInput !== "function") throw new TypeError("native frame controller must be a function");
  if (canAdvanceFrame !== null && typeof canAdvanceFrame !== "function") throw new TypeError("frame availability reader must be a function");
  if (!Number.isFinite(videoFramesPerSecond) || videoFramesPerSecond <= 0 || videoFramesPerSecond > 240) {
    throw new TypeError("video frame rate must be a number from 0 through 240");
  }
  if (!Number.isFinite(manualInputTimeoutMs) || manualInputTimeoutMs < 25) {
    throw new TypeError("manual input timeout must be at least 25 milliseconds");
  }

  const interval = 1000 / presentationFramesPerSecond;
  const subscribers = new Set();
  let deadline = Number(clock());
  let timer = null;
  let closed = false;
  let paused = startPaused;
  let pauseReason = startPaused ? "inspection" : null;
  let emulationCredit = 0;
  let emulatedFrames = 0;
  let publishedFrames = 0;
  let nextVideoAt = Number.NEGATIVE_INFINITY;
  let latestFrame = null;
  let latestError = null;
  let activeAction = null;
  let retainedButtons = [];
  let retainedBoundary = null;
  let controlMode = "bot";
  let manualSessionCount = 0;
  let manualSession = null;
  let manualButtons = [];
  let lastManualInputAt = null;
  const pendingControlHandoffs = [];
  let governedSpeed = emulationSpeed;
  let budgetAt = Number(clock());
  let clockActive = false;
  let frameCostMs = 0;
  let lastGovernedAt = budgetAt;
  let lastMeasuredAt = budgetAt;
  let measuredFrames = 0;
  let achievedEmulationSpeed = 0;
  let cartridgeWorkMs = 0;
  let controllerWorkMs = 0;
  let videoWorkMs = 0;
  const startedAt = budgetAt;
  const effectiveSpeed = () => controlMode === 'manual' ? MANUAL_EMULATION_SPEED
    : adaptiveTiming ? Math.min(emulationSpeed, governedSpeed) : emulationSpeed;
  const hasClockOwner = () => !paused && (controlMode === 'manual' || !frameExact || activeAction !== null || botFrameInput !== null);
  const resetBudget = () => { budgetAt = Number(clock()); emulationCredit = 0; clockActive = false; };
  // A decision can arrive between display ticks. Wake the executor without
  // advancing a frame here; the ordinary input guards remain its only owner.
  const wake = () => {
    if (!adaptiveTiming || closed) return;
    if (timer !== null) cancel(timer);
    if (!clockActive) { budgetAt = Number(clock()); clockActive = hasClockOwner(); }
    timer = schedule(tick, emulationCredit >= 1 ? 0 : 4);
  };

  const currentFrame = () => Number.isSafeInteger(session.frame)
    ? session.frame
    : emulatedFrames;

  const manualTrajectorySample = (buttons) => {
    const state = controllerState?.() ?? null;
    return {
      frame: currentFrame(),
      buttons: [...buttons],
      state: state === null ? null : { ...state },
    };
  };

  const recordManualInput = (buttons) => {
    manualSession.inputEvents.push({ frame: currentFrame(), buttons: [...buttons] });
    manualSession.trajectory?.push(manualTrajectorySample(buttons));
  };

  const controlState = () => Object.freeze({
    schema: "master-red/control-state/v1",
    mode: controlMode,
    configuredEmulationSpeed: emulationSpeed,
    effectiveEmulationSpeed: effectiveSpeed(),
    ...(adaptiveTiming ? { adaptiveTiming: true, achievedEmulationSpeed: paused ? 0 : achievedEmulationSpeed,
      speedLimitReason: controlMode === 'manual' ? 'manual-play' : governedSpeed < emulationSpeed ? 'processor-headroom' : null } : {}),
    manualSessionCount,
    manualButtons: Object.freeze([...manualButtons]),
    ...(paused ? { paused: true, pauseReason } : {}),
  });

  const commandBoundary = () => {
    const state = controllerState?.();
    return state ? JSON.stringify([state.inBattle, state.callback2]) : null;
  };
  const interruptBotAction = (reason = "manual-control") => {
    retainedButtons = [];
    retainedBoundary = null;
    session.releaseButtons?.();
    if (!activeAction) return;
    const interrupted = activeAction;
    activeAction = null;
    interrupted.resolve({
      startFrame: interrupted.startFrame,
      endFrame: currentFrame(),
      holdFrames: interrupted.holdFrames,
      releaseFrames: interrupted.releaseFrames,
      interrupted: reason,
    });
  };

  const publish = () => {
    const now = Number(clock());
    if (now + 0.0001 < nextVideoAt) return;
    // Delivery has its own wall-clock cadence. Do not change simulation ticks,
    // input leases, or the number of cartridge frames advanced by each tick.
    nextVideoAt = Number.isFinite(nextVideoAt) && now - nextVideoAt < 1000 / videoFramesPerSecond
      ? nextVideoAt + 1000 / videoFramesPerSecond : now + 1000 / videoFramesPerSecond;
    const began = Number(clock());
    const video = session.videoFrame();
    validateFrame(video);
    latestFrame = {
      width: video.width,
      height: video.height,
      sequence: Number.isSafeInteger(session.frame) ? session.frame : emulatedFrames,
      rgba: Buffer.from(video.rgba.buffer, video.rgba.byteOffset, video.rgba.byteLength),
    };
    latestError = null;
    publishedFrames += 1;
    for (const subscriber of subscribers) subscriber(latestFrame);
    videoWorkMs += Math.max(0, Number(clock()) - began);
  };

  const scheduleNext = () => {
    if (closed) return;
    if (adaptiveTiming) {
      const now = Number(clock());
      const quantum = controlMode === 'manual' ? interval : 4;
      clockActive = hasClockOwner();
      timer = schedule(tick, clockActive ? Math.max(0, budgetAt + quantum - now)
        : Math.max(1, nextVideoAt - now));
      return;
    }
    deadline += interval;
    const now = Number(clock());
    if (now > deadline + interval * 5) deadline = now + interval;
    timer = schedule(tick, Math.max(0, deadline - now));
  };

  const tick = () => {
    if (closed) return;
    if (paused) { if (adaptiveTiming) resetBudget(); publish(); scheduleNext(); return; }
    const tickStarted = Number(clock()), firstFrame = emulatedFrames;
    try {
      if (
        controlMode === "manual" &&
        manualButtons.length > 0 &&
        Number(clock()) - lastManualInputAt >= manualInputTimeoutMs
      ) {
        manualButtons = [];
        recordManualInput([]);
      }
      const effectiveEmulationSpeed = effectiveSpeed();
      if (adaptiveTiming) {
        const elapsed = clockActive ? Math.max(0, tickStarted - budgetAt) : 0;
        // A stalled host gets a bounded slice, never a backlog of old input.
        emulationCredit = hasClockOwner() ? Math.min(effectiveEmulationSpeed * 2,
          emulationCredit + Math.min(elapsed, interval * 2) * presentationFramesPerSecond * effectiveEmulationSpeed / 1000) : 0;
        budgetAt = tickStarted;
      } else emulationCredit += effectiveEmulationSpeed;
      const steps = Math.floor(emulationCredit);
      if (!adaptiveTiming) emulationCredit -= steps;
      for (let index = 0; index < steps; index += 1) {
        if (adaptiveTiming && index > 0 && Number(clock()) - tickStarted >= 8) break;
        // The radio keeps servicing ACKs and heartbeats while its owner waits.
        // Leave the action intact and discard wall-clock credit for held frames.
        if (canAdvanceFrame && !canAdvanceFrame()) { resetBudget(); break; }
        // Timing-guided hunts own every cartridge frame, including idle time
        // between decisions. Manual play and ordinary autonomous play keep their clock.
        if (frameExact && controlMode === "bot" && !activeAction && !botFrameInput) break;
        if (retainedBoundary !== null && retainedBoundary !== commandBoundary()) interruptBotAction("cartridge-boundary-changed");
        let buttons = controlMode === "manual"
          ? manualButtons
          : activeAction
          ? activeAction.movementLease
            ? activeAction.releasing
              ? activeAction.completionButtons ?? []
              : activeAction.buttons
            : activeAction.remainingHold > 0
              ? activeAction.buttons
              : []
          : retainedButtons;
        if (controlMode === "bot" && botFrameInput) {
          buttons = botFrameInput();
          if (paused) break;
          if (buttons === null) { paused = true; pauseReason = "controller-wait"; break; }
          if (!Array.isArray(buttons) || buttons.some(button => typeof button !== "string")) throw new TypeError("native frame controller must return buttons or null");
        }
        const stepAt = Number(clock());
        session.step(buttons);
        cartridgeWorkMs += Math.max(0, Number(clock()) - stepAt);
        emulatedFrames += 1;
        if (adaptiveTiming) emulationCredit = Math.max(0, emulationCredit - 1);
        if (activeAction?.boundary !== null && activeAction?.boundary !== undefined && activeAction.boundary !== commandBoundary()) {
          interruptBotAction("cartridge-boundary-changed");
        }
        if (activeAction) {
          if (activeAction.movementLease) {
            activeAction.elapsedFrames += 1;
            if (activeAction.remainingHold > 0) activeAction.remainingHold -= 1;
            const state = controllerState();
            if (!activeAction.releasing) {
              const lease = activeAction.movementLease;
              const origin = lease.origin;
              if (state?.inBattle === true) {
                activeAction.releasing = true;
                activeAction.movementLeaseResult = "mode-changed";
              } else if (lease.kind === "one-tile") {
                const leftOrigin =
                  state?.mode !== "overworld" ||
                  state?.map !== origin.map ||
                  state?.x !== origin.x ||
                  state?.y !== origin.y;
                if (leftOrigin) {
                  activeAction.releasing = true;
                  activeAction.movementLeaseResult =
                    state?.mode === "overworld" && state?.map === origin.map
                      ? "position-changed"
                      : "mode-changed";
                  activeAction.completionButtons =
                    activeAction.movementLeaseResult === "position-changed" &&
                    lease.continuationButtons
                      ? [...lease.continuationButtons]
                      : null;
                } else if (activeAction.elapsedFrames >= lease.maximumFrames) {
                  activeAction.releasing = true;
                  activeAction.movementLeaseResult = "frame-limit";
                }
              } else if (lease.kind === "map-connection") {
                if (state?.inBattle === true) {
                  activeAction.releasing = true;
                  activeAction.movementLeaseResult = "mode-changed";
                } else if (
                  state?.mode === "overworld" &&
                  state?.map === lease.destinationMap
                ) {
                  activeAction.releasing = true;
                  activeAction.movementLeaseResult = "destination-reached";
                  activeAction.completionButtons = lease.continuationButtons
                    ? [...lease.continuationButtons]
                    : null;
                } else if (
                  state?.mode === "overworld" &&
                  state?.map !== origin.map
                ) {
                  activeAction.releasing = true;
                  activeAction.movementLeaseResult = "route-diverged";
                } else if (activeAction.elapsedFrames >= lease.maximumFrames) {
                  activeAction.releasing = true;
                  activeAction.movementLeaseResult = "frame-limit";
                }
              } else if (lease.kind === "route-plan") {
                if (state?.mode !== "overworld" || state?.map !== origin.map) {
                  activeAction.releasing = true;
                  activeAction.movementLeaseResult = "mode-changed";
                } else {
                  const segment = lease.segments[activeAction.routeSegmentIndex];
                  if (samePosition(state, segment.target)) {
                    const nextIndex = activeAction.routeSegmentIndex + 1;
                    const next = lease.segments[nextIndex];
                    if (next) {
                      activeAction.routeSegmentIndex = nextIndex;
                      activeAction.routeSegmentOrigin = { ...segment.target };
                      activeAction.buttons = routeButtons(
                        activeAction.buttons,
                        next.direction,
                      );
                      activeAction.bestLeasePosition = { ...segment.target };
                      activeAction.noProgressFrames = 0;
                    } else {
                      activeAction.releasing = true;
                      activeAction.movementLeaseResult = "target-reached";
                      activeAction.completionButtons = lease.continuationButtons
                        ? [...lease.continuationButtons]
                        : null;
                    }
                  } else if (routeSegmentDiverged({
                    origin: activeAction.routeSegmentOrigin,
                    target: segment.target,
                  }, state)) {
                    activeAction.releasing = true;
                    activeAction.movementLeaseResult = "route-diverged";
                  } else {
                    const best = activeAction.bestLeasePosition;
                    if (distanceTo(state, segment.target) < distanceTo(best, segment.target)) {
                      activeAction.bestLeasePosition = {
                        map: state.map,
                        x: state.x,
                        y: state.y,
                      };
                      activeAction.noProgressFrames = 0;
                    } else {
                      activeAction.noProgressFrames += 1;
                    }
                    if (activeAction.noProgressFrames >= lease.stallFrames) {
                      activeAction.releasing = true;
                      activeAction.movementLeaseResult = "stalled";
                    } else if (activeAction.elapsedFrames >= lease.maximumFrames) {
                      activeAction.releasing = true;
                      activeAction.movementLeaseResult = "frame-limit";
                    }
                  }
                }
              } else if (
                state?.mode !== "overworld" || state?.map !== origin.map
              ) {
                activeAction.releasing = true;
                activeAction.movementLeaseResult = "mode-changed";
              } else if (samePosition(state, lease.target)) {
                activeAction.releasing = true;
                activeAction.movementLeaseResult = "target-reached";
                activeAction.completionButtons = lease.continuationButtons
                  ? [...lease.continuationButtons]
                  : null;
              } else if (routeSegmentDiverged(lease, state)) {
                activeAction.releasing = true;
                activeAction.movementLeaseResult = "route-diverged";
              } else {
                const best = activeAction.bestLeasePosition;
                if (distanceTo(state, lease.target) < distanceTo(best, lease.target)) {
                  activeAction.bestLeasePosition = {
                    map: state.map,
                    x: state.x,
                    y: state.y,
                  };
                  activeAction.noProgressFrames = 0;
                } else {
                  activeAction.noProgressFrames += 1;
                }
                if (activeAction.noProgressFrames >= lease.stallFrames) {
                  activeAction.releasing = true;
                  activeAction.movementLeaseResult = "stalled";
                } else if (activeAction.elapsedFrames >= lease.maximumFrames) {
                  activeAction.releasing = true;
                  activeAction.movementLeaseResult = "frame-limit";
                }
              }
            }
            // Neutral input is movement on slopes. Hold the requested stop
            // input while settling/replanning, but only in the same field.
            if (activeAction.releasing && !activeAction.completionButtons &&
                activeAction.movementLeaseResult !== "mode-changed" &&
                state?.mode === "overworld" && state?.inBattle !== true &&
                state?.map === activeAction.movementLease.origin.map &&
                activeAction.movementLease.stopButtons) {
              activeAction.completionButtons = [...activeAction.movementLease.stopButtons];
            }
            if (
              activeAction.releasing &&
              activeAction.completionButtons &&
              (state?.mode !== "overworld" || state?.inBattle === true)
            ) {
              activeAction.completionButtons = null;
              activeAction.movementLeaseResult = "mode-changed";
            }
            if (
              activeAction.releasing &&
              (
                state?.mode !== "overworld" ||
                state?.tileTransitionState === 0 ||
                activeAction.elapsedFrames >=
                  activeAction.movementLease.maximumFrames + 60
              )
            ) {
              const completed = activeAction;
              // Coordinates change before the native movement animation ends.
              // Recheck arrival after settling: a slope may have carried the
              // player away while input was being released.
              if (completed.movementLeaseResult === "target-reached") {
                if (state?.mode !== "overworld" || state?.map !== completed.movementLease.target?.map) {
                  completed.movementLeaseResult = "mode-changed";
                  completed.completionButtons = null;
                } else if (!samePosition(state, completed.movementLease.target)) {
                  completed.movementLeaseResult = "route-diverged";
                }
              }
              activeAction = null;
              retainedButtons = completed.completionButtons
                ? [...completed.completionButtons]
                : [];
              retainedBoundary = retainedButtons.length > 0 ? commandBoundary() : null;
              completed.resolve({
                startFrame: completed.startFrame,
                endFrame: Number.isSafeInteger(session.frame)
                  ? session.frame
                  : emulatedFrames,
                holdFrames: completed.holdFrames,
                releaseFrames: completed.releaseFrames,
                movementLease: completed.movementLeaseResult,
                ...(retainedButtons.length > 0 ? { retained: true } : {}),
              });
            }
          } else {
            if (activeAction.remainingHold > 0) activeAction.remainingHold -= 1;
            else activeAction.remainingRelease -= 1;
          }
          if (
            activeAction && !activeAction.movementLease &&
            activeAction.remainingHold === 0 &&
            activeAction.remainingRelease === 0
          ) {
            const completed = activeAction;
            activeAction = null;
            if (completed.retained) {
              retainedButtons = [...completed.buttons];
              retainedBoundary = completed.boundary;
            }
            completed.resolve({
              startFrame: completed.startFrame,
              endFrame: Number.isSafeInteger(session.frame)
                ? session.frame
                : emulatedFrames,
              holdFrames: completed.holdFrames,
              releaseFrames: completed.releaseFrames,
              ...(completed.retained ? { retained: true } : {}),
            });
          }
        }
      }
      const advanced = emulatedFrames - firstFrame, workMs = Math.max(0, Number(clock()) - tickStarted);
      controllerWorkMs += Math.max(0, workMs);
      if (adaptiveTiming && advanced > 0 && controlMode === 'bot') {
        const cost = workMs / advanced;
        frameCostMs = frameCostMs ? frameCostMs * 0.9 + cost * 0.1 : cost;
        if (Number(clock()) - lastGovernedAt >= 500 && frameCostMs > 0) {
          const capacity = Math.max(1, Math.floor(0.85 * 1000 / frameCostMs / presentationFramesPerSecond * 4) / 4);
          if (capacity < governedSpeed - 0.25) governedSpeed = capacity;
          else if (capacity > governedSpeed + 0.5) governedSpeed = Math.min(emulationSpeed, governedSpeed + 0.5);
          governedSpeed = Math.min(emulationSpeed, governedSpeed);
          lastGovernedAt = Number(clock());
        }
      }
      const measuredAt = Number(clock());
      if (measuredAt - lastMeasuredAt >= 1000) {
        achievedEmulationSpeed = (emulatedFrames - measuredFrames) * 1000 / (measuredAt - lastMeasuredAt) / presentationFramesPerSecond;
        measuredFrames = emulatedFrames; lastMeasuredAt = measuredAt;
      }
      publish();
    } catch (error) {
      latestError = error;
      paused = true;
      pauseReason = "emulator-error";
      activeAction?.reject(error);
      activeAction = null;
      interruptBotAction("emulator-error");
    }
    scheduleNext();
  };

  publish();
  scheduleNext();

  return Object.freeze({
    latest: () => latestFrame,
    error: () => latestError,
    subscribe(subscriber) {
      if (typeof subscriber !== "function") {
        throw new TypeError("frame subscriber must be a function");
      }
      if (closed) throw new Error("autonomous emulator is closed");
      subscribers.add(subscriber);
      if (latestFrame) subscriber(latestFrame);
      return () => subscribers.delete(subscriber);
    },
    controlState,
    setEmulationSpeed(speed) {
      if (!Number.isFinite(speed) || speed < 1 || speed > 10) throw new TypeError('emulation speed must be a number from 1 through 10');
      if (closed) throw new Error('autonomous emulator is closed');
      emulationSpeed = speed; governedSpeed = Math.min(governedSpeed, speed);
      resetBudget(); wake();
      return controlState();
    },
    cancel(reason = "cancelled") {
      interruptBotAction(reason);
      return controlState();
    },
    pause(reason = "safety-stop") {
      interruptBotAction(reason);
      manualButtons = [];
      paused = true;
      pauseReason = reason;
      emulationCredit = 0;
      if (adaptiveTiming) resetBudget();
      return controlState();
    },
    setControlMode(mode) {
      if (paused) throw new Error("safety-paused emulator requires an explicit checkpoint resume");
      if (!["bot", "manual"].includes(mode)) {
        throw new TypeError("control mode must be bot or manual");
      }
      if (mode === controlMode) return controlState();
      emulationCredit = 0;
      if (adaptiveTiming) resetBudget();
      if (mode === "manual") {
        interruptBotAction();
        controlMode = "manual";
        manualSessionCount += 1;
        manualButtons = [];
        lastManualInputAt = Number(clock());
        manualSession = {
          session: manualSessionCount,
          startedFrame: currentFrame(),
          inputEvents: [],
          trajectory: controllerState ? [manualTrajectorySample([])] : null,
        };
      } else {
        if (manualButtons.length > 0) {
          manualButtons = [];
          recordManualInput([]);
        }
        pendingControlHandoffs.push(Object.freeze({
          schema: "master-red/manual-control-handoff/v1",
          session: manualSession.session,
          startedFrame: manualSession.startedFrame,
          endedFrame: currentFrame(),
          inputEvents: Object.freeze(manualSession.inputEvents.map((event) =>
            Object.freeze({ frame: event.frame, buttons: Object.freeze([...event.buttons]) })
          )),
          ...(manualSession.trajectory
            ? {
                trajectory: Object.freeze(manualSession.trajectory.map((sample) =>
                  Object.freeze({
                    frame: sample.frame,
                    buttons: Object.freeze([...sample.buttons]),
                    state: sample.state === null
                      ? null
                      : Object.freeze({ ...sample.state }),
                  })
                )),
              }
            : {}),
        }));
        manualSession = null;
        lastManualInputAt = null;
        controlMode = "bot";
      }
      wake();
      return controlState();
    },
    setManualButtons(buttons) {
      if (controlMode !== "manual") {
        throw new Error("manual input requires manual control");
      }
      const next = canonicalButtons(buttons);
      lastManualInputAt = Number(clock());
      if (!sameButtons(next, manualButtons)) {
        manualButtons = next;
        recordManualInput(manualButtons);
      }
      return controlState();
    },
    takeControlHandoff() {
      return pendingControlHandoffs.shift() ?? null;
    },
    execute(action) {
      if (closed) return Promise.reject(new Error("autonomous emulator is closed"));
      if (botFrameInput) return Promise.reject(new Error("This emulator already has a native frame controller"));
      if (paused) return Promise.resolve({ interrupted: "paused", startFrame: currentFrame(), endFrame: currentFrame() });
      if (controlMode === "manual" || pendingControlHandoffs.length > 0) {
        return Promise.resolve({
          startFrame: currentFrame(),
          endFrame: currentFrame(),
          holdFrames: Number(action?.holdFrames) || 0,
          releaseFrames: Number(action?.releaseFrames) || 0,
          interrupted: "manual-control",
        });
      }
      if (activeAction) {
        return Promise.reject(new Error("autonomous emulator already has an active command"));
      }
      // The Suite calls this executor directly; the IPC worker is not its only
      // caller. Enforce the contract here before queuing any cartridge input.
      if (action?.precondition && (!actionObservation ||
          !actionPreconditionMatches(action.precondition, actionObservation(), action))) {
        interruptBotAction('stale-observation');
        return Promise.resolve({interrupted:'stale-observation',startFrame:currentFrame(),endFrame:currentFrame()});
      }
      if (!action || !Array.isArray(action.buttons)) {
        return Promise.reject(new TypeError("controller command requires a button array"));
      }
      const retained = action.kind === "sustained-chord";
      const movementLease = action.movementLease ?? null;
      if (retained && action.buttons.length === 0) {
        return Promise.reject(new TypeError(
          "sustained controller command requires at least one button",
        ));
      }
      if (retained && Number(action.releaseFrames) !== 0) {
        return Promise.reject(new TypeError(
          "sustained controller command releaseFrames must be zero",
        ));
      }
      if (movementLease !== null) {
        const origin = movementLease?.origin;
        const target = movementLease?.target;
        const commonLeaseValid =
          retained && controllerState !== null &&
          typeof origin?.map === "string" && origin.map !== "" &&
          Number.isSafeInteger(origin?.x) && Number.isSafeInteger(origin?.y) &&
          Number.isSafeInteger(movementLease.maximumFrames);
        const oneTileLeaseValid =
          movementLease.kind === "one-tile" &&
          movementLease.maximumFrames >= 4 && movementLease.maximumFrames <= 600;
        const routeDistance = target && origin
          ? Math.abs(target.x - origin.x) + Math.abs(target.y - origin.y)
          : 0;
        const routeSegmentLeaseValid =
          movementLease.kind === "route-segment" &&
          target?.map === origin?.map &&
          Number.isSafeInteger(target?.x) && Number.isSafeInteger(target?.y) &&
          (target.x === origin?.x || target.y === origin?.y) &&
          routeDistance >= 2 &&
          movementLease.maximumFrames >= 4 && movementLease.maximumFrames <= 3600 &&
          Number.isSafeInteger(movementLease.stallFrames) &&
          movementLease.stallFrames >= 4 &&
          movementLease.stallFrames <= movementLease.maximumFrames;
        const routePlanLeaseValid =
          validRoutePlan(movementLease, action.buttons) &&
          movementLease.maximumFrames >= 4 &&
          movementLease.maximumFrames <= 36000 &&
          Number.isSafeInteger(movementLease.stallFrames) &&
          movementLease.stallFrames >= 4 &&
          movementLease.stallFrames <= movementLease.maximumFrames;
        const mapConnectionLeaseValid =
          movementLease.kind === "map-connection" &&
          typeof movementLease.destinationMap === "string" &&
          movementLease.destinationMap !== "" &&
          movementLease.destinationMap !== origin?.map &&
          movementLease.maximumFrames >= 4 &&
          movementLease.maximumFrames <= 600;
        const continuationButtonsValid =
          movementLease.continuationButtons === undefined || (
            ["one-tile", "route-segment", "route-plan", "map-connection"].includes(
              movementLease.kind,
            ) &&
            Array.isArray(movementLease.continuationButtons) &&
            movementLease.continuationButtons.length > 0 &&
            movementLease.continuationButtons.every((button) =>
              typeof button === "string" && button !== ""
            )
          );
        const stopButtonsValid = movementLease.stopButtons === undefined || (
          Array.isArray(movementLease.stopButtons) &&
          movementLease.stopButtons.length > 0 &&
          movementLease.stopButtons.every(button => Object.hasOwn(BUTTON_BITS, button))
        );
        if (
          !commonLeaseValid || (
            !oneTileLeaseValid &&
            !routeSegmentLeaseValid &&
            !routePlanLeaseValid &&
            !mapConnectionLeaseValid
          ) ||
          !continuationButtonsValid || !stopButtonsValid
        ) {
          return Promise.reject(new TypeError(
            "movement lease requires a valid sustained origin, target, and frame limits",
          ));
        }
      }
      const holdFrames = Math.max(1, Math.min(frameExact ? 600 : 8, Number(action.holdFrames) || 1));
      const releaseFrames = retained
        ? 0
        : frameExact ? Math.max(0, Math.min(600, Number(action.releaseFrames) || 0))
        : Math.max(1, Math.min(8, Number(action.releaseFrames) || 1));
      retainedButtons = [];
      retainedBoundary = null;
      return new Promise((resolve, reject) => {
        activeAction = {
          buttons: [...action.buttons],
          holdFrames,
          releaseFrames,
          remainingHold: holdFrames,
          remainingRelease: releaseFrames,
          retained: retained && movementLease === null,
          boundary: !movementLease && action.buttons.length > 0 ? commandBoundary() : null,
          movementLease,
          movementLeaseResult: null,
          elapsedFrames: 0,
          noProgressFrames: 0,
          bestLeasePosition: movementLease
            ? { ...movementLease.origin }
            : null,
          routeSegmentIndex: 0,
          routeSegmentOrigin: movementLease
            ? { ...movementLease.origin }
            : null,
          releasing: false,
          completionButtons: null,
          startFrame: Number.isSafeInteger(session.frame)
            ? session.frame
            : emulatedFrames,
          resolve,
          reject,
        };
        wake();
      });
    },
    metrics: () => ({
      targetPresentationFramesPerSecond: presentationFramesPerSecond,
      targetVideoFramesPerSecond: videoFramesPerSecond,
      targetEmulatedFramesPerSecond:
        presentationFramesPerSecond * emulationSpeed,
      emulationSpeed,
      ...(adaptiveTiming ? { effectiveEmulationSpeed: effectiveSpeed(),
        achievedEmulationSpeed: paused ? 0 : achievedEmulationSpeed,
        timing: { elapsedMs: Math.max(0, Number(clock()) - startedAt), cartridgeWorkMs, controllerWorkMs, videoWorkMs } } : {}),
      publishedFrames,
      emulatedFrames,
      sourceFrame: latestFrame?.sequence ?? null,
      subscribers: subscribers.size,
      busy: activeAction !== null,
      retainedButtons: [...retainedButtons],
    }),
    close() {
      if (closed) return;
      closed = true;
      if (timer !== null) cancel(timer);
      activeAction?.reject(new Error("autonomous emulator closed during a controller command"));
      activeAction = null;
      retainedButtons = [];
      retainedBoundary = null;
      session.releaseButtons?.();
      manualButtons = [];
      subscribers.clear();
    },
  });
}
