import { createServer } from "node:http";
import { constants as zlibConstants, createGzip, gzipSync } from "node:zlib";
import { streamLiveAudio } from "./live-audio.js";
import { createLatestFrameWriter } from "./live-video.js";

function immediate() {
  return new Promise((resolve) => setImmediate(resolve));
}

function pause(milliseconds) {
  return milliseconds > 0
    ? new Promise((resolve) => setTimeout(resolve, milliseconds))
    : immediate();
}

function compactControlHandoff(handoff, { update, execution } = {}) {
  const observation = handoff?.observation;
  const { observation: ignored, ...manual } = handoff;
  return Object.freeze({
    ...manual,
    finalObservation: Object.freeze({
      captureId: observation.captureId,
      frame: observation.frame,
      sramSha256: observation.sram?.sha256 ?? null,
      playerMemorySha256: observation.playerMemory?.sha256 ?? null,
    }),
    interruptedBotAction: Object.freeze({
      decisions: update?.decisions ?? null,
      observationId: update?.observation?.captureId ?? null,
      observationFrame: update?.observation?.frame ?? null,
      decisionSequence: update?.decision?.sequence ?? null,
      reason: update?.decision?.reason ?? null,
      winner: update?.decision?.winner ?? null,
      action: update?.decision?.action ?? null,
      execution: execution ?? null,
    }),
  });
}

export function shouldReportDecision(update, interval = 250) {
  const decisions = Number(update?.decisions);
  const decision = update?.decision;
  return (
    decision?.kind === "complete" ||
    (decision?.action?.buttons?.length ?? 0) > 0 ||
    (Number.isSafeInteger(decisions) && decisions > 0 && decisions % interval === 0)
  );
}

export function createDecisionReportGate({
  minimumIntervalMs = 250,
  clock = Date.now,
} = {}) {
  let lastReportAt = Number.NEGATIVE_INFINITY;
  return (update) => {
    if (!shouldReportDecision(update)) return false;
    if (update?.decision?.kind === "complete") return true;
    const now = Number(clock());
    if (now - lastReportAt < minimumIntervalMs) return false;
    lastReportAt = now;
    return true;
  };
}

export async function runContinuousPlayer({
  emulator,
  player,
  maxDecisions = Number.MAX_SAFE_INTEGER,
  onUpdate = () => {},
  shouldStop = () => false,
  yieldEvery = 32,
  manualControlPollMs = 50,
  performanceClock = () => performance.now(),
} = {}) {
  if (!emulator || typeof emulator.observe !== "function" ||
      typeof emulator.execute !== "function") {
    throw new TypeError("continuous player requires an autonomous emulator interface");
  }
  if (!player || typeof player.decide !== "function") {
    throw new TypeError("continuous player requires one central delegator");
  }
  if (maxDecisions !== null && (!Number.isSafeInteger(maxDecisions) || maxDecisions <= 0)) {
    throw new TypeError("maxDecisions must be a positive integer or null");
  }
  if (!Number.isFinite(manualControlPollMs) || manualControlPollMs < 0) {
    throw new TypeError("manualControlPollMs must be a non-negative number");
  }

  let decisions = 0;
  let atomicCaptureRaces = 0;
  let last = null;
  const performanceStartedAt = performanceClock();
  const counters = { submittedActions: 0, acceptedActions: 0, staleActions: 0, interruptedActions: 0, maxActionAgeFrames: 0 };
  let firstFrame = null, observedFrame = null, planningTotalMs = 0, planningMaxMs = 0;
  const performanceSnapshot = () => {
    const wallSeconds = Math.max(0, (performanceClock() - performanceStartedAt) / 1000);
    return Object.freeze({ ...counters, wallSeconds,
      observedFramesPerSecond: wallSeconds > 0 && firstFrame !== null && observedFrame >= firstFrame
        ? (observedFrame - firstFrame) / wallSeconds : null,
      planningMs: { mean: decisions ? planningTotalMs / decisions : 0, max: planningMaxMs } });
  };
  let controllerRetained = false;
  let controllerPaused = false;
  const preservedEncounters = new Set();
  let pendingControlHandoff = null;
  let updateFailure = null;
  let updateQueue = Promise.resolve();
  const enqueueUpdate = (update) => {
    updateQueue = updateQueue.then(async () => {
      if (updateFailure) return;
      try {
        await onUpdate(update);
      } catch (error) {
        updateFailure = error;
      }
    });
  };
  const drainUpdates = async () => {
    await updateQueue;
    if (updateFailure) throw updateFailure;
  };
  const releaseRetainedController = async () => {
    if (!controllerRetained) return;
    controllerRetained = false;
    await emulator.execute({
      kind: "neutral",
      buttons: [],
      holdFrames: 1,
      releaseFrames: 1,
      reason: "terminal-controller-release",
    });
  };
  const stopController = async (reason) => {
    if (controllerPaused) return;
    if (typeof emulator.pause === "function") {
      await emulator.pause(reason);
      controllerPaused = true;
      controllerRetained = false;
    } else await releaseRetainedController();
  };
  const awaitManualHandoff = async (interruption) => {
    if (
      typeof emulator.controlState !== "function" ||
      typeof emulator.takeControlHandoff !== "function" ||
      typeof player.resumeFromManual !== "function"
    ) {
      throw new Error("manual control requires control-state and player-resume interfaces");
    }
    while (!shouldStop()) {
      const control = await emulator.controlState();
      if (control?.mode === "bot") {
        const handoff = await emulator.takeControlHandoff();
        if (!handoff?.observation) {
          throw new Error("manual control ended without an atomic cartridge handoff");
        }
        player.resumeFromManual({ handoff, observation: handoff.observation });
        return compactControlHandoff(handoff, interruption);
      }
      if (control?.mode !== "manual") {
        throw new Error(`unknown emulator control mode: ${control?.mode ?? "missing"}`);
      }
      await pause(manualControlPollMs);
    }
    return null;
  };
  try {
    while ((maxDecisions === null || decisions < maxDecisions) && !shouldStop()) {
      const observation = await emulator.observe();
      if (Number.isSafeInteger(observation.frame)) { firstFrame ??= observation.frame; observedFrame = observation.frame; }
      const planningStartedAt = performanceClock();
      const decision = player.decide(observation);
      const planningMs = Math.max(0, performanceClock() - planningStartedAt);
      planningTotalMs += planningMs;
      planningMaxMs = Math.max(planningMaxMs, planningMs);
      decisions += 1;
      last = Object.freeze({
        decisions,
        atomicCaptureRaces,
        observation,
        decision,
        performance: performanceSnapshot(),
        ...(pendingControlHandoff
          ? { controlHandoff: pendingControlHandoff }
          : {}),
      });
      pendingControlHandoff = null;
      const terminal = ["complete", "blocked"].includes(decision.kind);
      if (terminal) await stopController(decision.reason ?? decision.kind);
      const protectedId = decision.protectedEncounter?.id ?? decision.protectedEncounter?.observationId;
      const firstProtected = protectedId && !preservedEncounters.has(protectedId);
      if (firstProtected) {
        // The rare valuable-encounter backup is a barrier, unlike ordinary
        // asynchronous telemetry. No ball, attack, or flee precedes this evidence.
        if (!terminal) await emulator.cancel?.("protected-encounter");
        controllerRetained = false;
        enqueueUpdate(last);
        await drainUpdates();
        preservedEncounters.add(protectedId);
      }
      const actionCompletion = terminal
        ? null
        : Promise.resolve(emulator.execute(decision.action)).then(
            (value) => ({ ok: true, value }),
            (error) => ({ ok: false, error }),
          );
      if (!firstProtected) enqueueUpdate(last);
      if (terminal) {
        await releaseRetainedController();
        await drainUpdates();
        return Object.freeze({ kind: decision.kind, ...last });
      }
      const actionResult = await actionCompletion;
      if (!actionResult.ok) {
        await releaseRetainedController().catch(() => {});
        throw actionResult.error;
      }
      if (decision.action?.buttons?.length) {
        counters.submittedActions++;
        if (actionResult.value?.interrupted === "stale-observation") counters.staleActions++;
        else if (actionResult.value?.interrupted) counters.interruptedActions++;
        else counters.acceptedActions++;
        if (Number.isSafeInteger(actionResult.value?.startFrame) && Number.isSafeInteger(observation.frame)) {
          counters.maxActionAgeFrames = Math.max(counters.maxActionAgeFrames, actionResult.value.startFrame - observation.frame);
        }
      }
      if (actionResult.value?.interrupted === "manual-control") {
        controllerRetained = false;
        pendingControlHandoff = await awaitManualHandoff({
          update: last,
          execution: actionResult.value,
        });
        if (shouldStop()) break;
        continue;
      }
      controllerRetained = decision.action.kind === "sustained-chord";
      player.observeExecution?.({ observation, decision, execution: actionResult.value });
      if (updateFailure) {
        await releaseRetainedController();
        await drainUpdates();
      }
      if (decisions % yieldEvery === 0) await immediate();
    }
    await stopController(shouldStop() ? "stopped" : "budget-exhausted");
    await drainUpdates();
    return Object.freeze({
      kind: shouldStop() ? "stopped" : "budget-exhausted",
      decisions,
      atomicCaptureRaces,
      observation: last?.observation ?? null,
      decision: last?.decision ?? null,
      performance: performanceSnapshot(),
    });
  } catch (error) {
    await stopController("controller-error").catch(() => {});
    throw error;
  }
}

const DEFAULT_DISPLAY_FRAMES_PER_SECOND = 60;
const FRAME_PACKET_HEADER_BYTES = 16;
const FRAME_PACKET_MAGIC = "MRF1";

function scheduleTimeout(callback, milliseconds) {
  const timer = setTimeout(callback, milliseconds);
  timer.unref?.();
  return timer;
}

function validateVideoFrame(frame) {
  if (
    !Number.isSafeInteger(frame?.width) ||
    !Number.isSafeInteger(frame?.height) ||
    frame.width <= 0 ||
    frame.height <= 0 ||
    frame.width > 4096 ||
    frame.height > 4096 ||
    !(frame.rgba instanceof Uint8Array) ||
    frame.rgba.byteLength !== frame.width * frame.height * 4
  ) {
    throw new Error("emulator exposed an invalid live video frame");
  }
}

export function createLiveFramePublisher({
  session,
  framesPerSecond = DEFAULT_DISPLAY_FRAMES_PER_SECOND,
  clock = () => performance.now(),
  schedule = scheduleTimeout,
  cancel = clearTimeout,
} = {}) {
  if (!session || typeof session.videoFrame !== "function") {
    throw new TypeError("live frame publisher requires an emulator framebuffer");
  }
  if (!Number.isFinite(framesPerSecond) || framesPerSecond <= 0 || framesPerSecond > 240) {
    throw new TypeError("live frame rate must be a number from 0 through 240");
  }
  if (typeof clock !== "function" || typeof schedule !== "function" || typeof cancel !== "function") {
    throw new TypeError("live frame publisher clock functions are required");
  }

  const interval = 1000 / framesPerSecond;
  const subscribers = new Set();
  let closed = false;
  let timer = null;
  let deadline = Number(clock());
  let fallbackSequence = 0;
  let publishedFrames = 0;
  let latestFrame = null;
  let latestError = null;

  const capture = () => {
    try {
      const frame = session.videoFrame();
      validateVideoFrame(frame);
      fallbackSequence += 1;
      const sourceFrame = Number.isSafeInteger(session.frame) && session.frame >= 0
        ? session.frame
        : fallbackSequence;
      latestFrame = {
        width: frame.width,
        height: frame.height,
        sequence: sourceFrame,
        rgba: Buffer.from(frame.rgba.buffer, frame.rgba.byteOffset, frame.rgba.byteLength),
      };
      latestError = null;
      publishedFrames += 1;
      for (const subscriber of subscribers) {
        try {
          subscriber(latestFrame);
        } catch {
          subscribers.delete(subscriber);
        }
      }
    } catch (error) {
      latestError = error;
    }
  };

  const scheduleNext = () => {
    if (closed) return;
    deadline += interval;
    const now = Number(clock());
    while (deadline <= now) deadline += interval;
    timer = schedule(tick, Math.max(0, deadline - now));
  };
  const tick = () => {
    if (closed) return;
    capture();
    scheduleNext();
  };

  capture();
  scheduleNext();

  return Object.freeze({
    latest: () => latestFrame,
    error: () => latestError,
    subscribe(subscriber) {
      if (typeof subscriber !== "function") {
        throw new TypeError("live frame subscriber must be a function");
      }
      if (closed) throw new Error("live frame publisher is closed");
      subscribers.add(subscriber);
      if (latestFrame) subscriber(latestFrame);
      return () => subscribers.delete(subscriber);
    },
    metrics: () => ({
      targetFramesPerSecond: framesPerSecond,
      publishedFrames,
      sourceFrame: latestFrame?.sequence ?? null,
      subscribers: subscribers.size,
    }),
    close() {
      if (closed) return;
      closed = true;
      if (timer !== null) cancel(timer);
      subscribers.clear();
    },
  });
}

function encodeFramePacket(frame) {
  const packet = Buffer.allocUnsafe(FRAME_PACKET_HEADER_BYTES + frame.rgba.length);
  packet.write(FRAME_PACKET_MAGIC, 0, 4, "ascii");
  packet.writeUInt16BE(frame.width, 4);
  packet.writeUInt16BE(frame.height, 6);
  packet.writeUInt32BE(frame.rgba.length, 8);
  packet.writeUInt32BE(frame.sequence % 0x1_0000_0000, 12);
  frame.rgba.copy(packet, FRAME_PACKET_HEADER_BYTES);
  return packet;
}

export function advanceAdaptivePlayback({
  queuedFrames,
  playbackCredit = 0,
} = {}) {
  if (!Number.isSafeInteger(queuedFrames) || queuedFrames < 0) {
    throw new TypeError("adaptive playback queuedFrames must be a non-negative integer");
  }
  if (!Number.isFinite(playbackCredit) || playbackCredit < 0 || playbackCredit >= 1) {
    throw new TypeError("adaptive playback credit must be between zero and one");
  }
  if (queuedFrames === 0) {
    return { consumeFrames: 0, playbackCredit: 0 };
  }
  const rate = queuedFrames < 4
    ? 0.75
    : queuedFrames < 8
      ? 0.9
      : queuedFrames > 18
        ? 1.1
        : 1;
  const availableCredit = playbackCredit + rate;
  const consumeFrames = Math.min(queuedFrames, Math.floor(availableCredit));
  return {
    consumeFrames,
    playbackCredit: availableCredit - consumeFrames,
  };
}

const VIEWER_HTML = `<!doctype html>
<html lang="en"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>MASTER RED · RESEARCH PLAYER</title>
<style>
  :root{color-scheme:dark;font-family:ui-monospace,SFMono-Regular,Menlo,monospace;--mint:#65ffc4;--panel:#07100de8}
  *{box-sizing:border-box}html,body{width:100%;height:100%;margin:0;background:#05070a;overflow:hidden}
  main{width:100%;height:100%;display:grid;place-items:center;position:relative}
  canvas{width:min(100vw,calc(100vh * 1.5));height:min(100vh,calc(100vw / 1.5));image-rendering:pixelated;background:#000}
  [hidden]{display:none!important}button{font:inherit;color:inherit;-webkit-tap-highlight-color:transparent}
  #trainer-card{position:absolute;left:14px;bottom:14px;max-width:calc(100% - 28px);padding:9px 10px;border:1px solid var(--mint);background:var(--panel);color:#dffff5;font-size:12px;line-height:1.45;box-shadow:0 0 20px #00bd7d33}
  #status-copy{white-space:pre-wrap}strong{color:var(--mint)}i{color:#91a39c;font-style:normal}
  .mode-button{margin-top:8px;padding:6px 10px;border:1px solid var(--mint);border-radius:3px;background:#10251e;color:var(--mint);cursor:pointer;font-weight:700;text-transform:uppercase;letter-spacing:.04em}
  .mode-button:hover,.mode-button:focus-visible{background:#16382d;outline:2px solid #fff;outline-offset:2px}
  #manual-controls{position:absolute;inset:auto 10px 10px;max-width:760px;margin:auto;padding:10px 12px 12px;border:1px solid #91a39c;border-radius:18px 18px 30px 18px;background:#17201eed;color:#f4fff9;box-shadow:0 8px 32px #000b;user-select:none;touch-action:none}
  .control-header{display:flex;align-items:center;justify-content:space-between;gap:14px;font-size:12px}.control-header .mode-button{margin:0}
  .gba-controls{display:grid;grid-template-columns:150px 1fr 150px;align-items:center;gap:16px;margin-top:10px}
  .dpad{display:grid;grid-template:repeat(3,44px)/repeat(3,44px);justify-content:center}.dpad button,.round-button,.shoulder{border:1px solid #56615d;background:#252c2a;box-shadow:inset 0 -3px #111,0 2px 5px #0008;cursor:pointer}
  .dpad button{border-radius:5px;font-size:19px}.dpad .up{grid-area:1/2}.dpad .left{grid-area:2/1}.dpad .center{grid-area:2/2;background:#1c2220;pointer-events:none}.dpad .right{grid-area:2/3}.dpad .down{grid-area:3/2}
  .system-buttons{display:flex;flex-wrap:wrap;justify-content:center;align-items:center;gap:8px 12px}.system-buttons button{min-width:68px;padding:7px 10px;border:1px solid #687570;border-radius:14px;background:#323b38;box-shadow:inset 0 -2px #121615;cursor:pointer;font-size:10px;text-transform:uppercase}.manual-hint{width:100%;text-align:center;color:#a8b8b2;font-size:10px}
  .action-buttons{display:flex;justify-content:center;gap:12px;transform:rotate(-12deg)}.round-button{width:58px;height:58px;border-radius:50%;background:#772c4b;color:#fff;font-size:18px;font-weight:800}.round-button span{display:block;transform:rotate(12deg)}
  .shoulders{position:absolute;left:15px;right:15px;top:42px;display:flex;justify-content:space-between;pointer-events:none}.shoulder{min-width:58px;padding:4px 13px;border-radius:10px;pointer-events:auto;color:#c9d7d2}
  [data-gba-button].pressed{transform:translateY(2px);box-shadow:inset 0 1px 4px #000;background:#48645a}.round-button.pressed{transform:rotate(-12deg) translateY(2px);background:#a64068}
  @media(max-width:560px){#manual-controls{inset:auto 5px 5px;padding:8px}.gba-controls{grid-template-columns:120px 1fr 120px;gap:5px}.dpad{grid-template:repeat(3,38px)/repeat(3,38px)}.round-button{width:50px;height:50px}.manual-hint{display:none}.system-buttons button{min-width:54px;padding:6px 7px}}
</style></head><body><main><canvas width="240" height="160"></canvas>
<aside id="trainer-card"><div id="status-copy"><strong>MASTER RED · RESEARCH PLAYER</strong>\n<i>connecting to the central player…</i></div><button id="take-control" class="mode-button" type="button">Play manually</button></aside>
<section id="manual-controls" aria-label="Game Boy Advance controls" hidden>
 <div class="control-header"><strong>MANUAL CONTROL · 1×</strong><button id="return-to-bot" class="mode-button" type="button">Return to bot</button></div>
 <div class="shoulders"><button class="shoulder" data-gba-button="l" type="button">L</button><button class="shoulder" data-gba-button="r" type="button">R</button></div>
 <div class="gba-controls">
  <div class="dpad" aria-label="Directional pad"><button class="up" data-gba-button="up" type="button" aria-label="Up">▲</button><button class="left" data-gba-button="left" type="button" aria-label="Left">◀</button><button class="center" type="button" tabindex="-1" aria-hidden="true"></button><button class="right" data-gba-button="right" type="button" aria-label="Right">▶</button><button class="down" data-gba-button="down" type="button" aria-label="Down">▼</button></div>
  <div class="system-buttons"><button data-gba-button="select" type="button">Select</button><button data-gba-button="start" type="button">Start</button><div class="manual-hint">Keyboard: arrows · Z/A · X/B · Enter/Start · Shift/Select</div></div>
  <div class="action-buttons"><button class="round-button" data-gba-button="b" type="button"><span>B</span></button><button class="round-button" data-gba-button="a" type="button"><span>A</span></button></div>
 </div>
</section></main>
<script>
${advanceAdaptivePlayback.toString()}
const canvas=document.querySelector('canvas');const context=canvas.getContext('2d',{alpha:false});
const trainerCard=document.querySelector('#trainer-card');const statusBox=document.querySelector('#status-copy');const manualControls=document.querySelector('#manual-controls');
const takeControlButton=document.querySelector('#take-control');const returnToBotButton=document.querySelector('#return-to-bot');const gbaButtons=[...document.querySelectorAll('[data-gba-button]')];
const FRAME_HEADER_BYTES=16;const DISPLAY_INTERVAL=1000/60;const START_BUFFER_FRAMES=12;const MAX_BUFFER_FRAMES=30;
const frameQueue=[];let buffered=new Uint8Array(0);let queuedSequence=-1;let playbackStarted=false;let playbackCredit=0;let lastPaintAt=0;let streamController=null;
let controlMode='bot';let controlQueue=Promise.resolve();const pointerButtons=new Map();const keyboardButtons=new Set();let lastSentButtons='';
const delay=milliseconds=>new Promise(resolve=>setTimeout(resolve,milliseconds));
function appendFrames(value){const joined=new Uint8Array(buffered.length+value.length);joined.set(buffered);joined.set(value,buffered.length);buffered=joined;
 while(buffered.length>=FRAME_HEADER_BYTES){if(buffered[0]!==77||buffered[1]!==82||buffered[2]!==70||buffered[3]!==49)throw new Error('invalid live frame stream');
  const view=new DataView(buffered.buffer,buffered.byteOffset,buffered.byteLength);const width=view.getUint16(4);const height=view.getUint16(6);const byteLength=view.getUint32(8);const sequence=view.getUint32(12);
  if(!width||!height||byteLength!==width*height*4)throw new Error('invalid live frame dimensions');const packetBytes=FRAME_HEADER_BYTES+byteLength;if(buffered.length<packetBytes)return;
  if(sequence!==queuedSequence){const rgba=new Uint8ClampedArray(byteLength);rgba.set(buffered.subarray(FRAME_HEADER_BYTES,packetBytes));frameQueue.push({width,height,rgba});queuedSequence=sequence;while(frameQueue.length>MAX_BUFFER_FRAMES)frameQueue.shift();}
  buffered=buffered.slice(packetBytes);
 }}
async function consumeFrames(response){if(!response.ok||!response.body)throw new Error('live frame stream unavailable');const reader=response.body.getReader();
 try{while(true){const next=await reader.read();if(next.done)throw new Error('live frame stream ended');appendFrames(next.value);}}
 finally{reader.releaseLock();}}
async function stream(){for(;;){if(document.hidden){await delay(100);continue;}try{streamController=new AbortController();const response=await fetch('/stream',{cache:'no-store',signal:streamController.signal});await consumeFrames(response);}catch(_){}finally{streamController=null;buffered=new Uint8Array(0);}await delay(100);}}
function paint(now){if(!lastPaintAt)lastPaintAt=now-DISPLAY_INTERVAL;if(now-lastPaintAt>=DISPLAY_INTERVAL-0.75){lastPaintAt=now-((now-lastPaintAt)%DISPLAY_INTERVAL);
 if(!playbackStarted&&frameQueue.length>=START_BUFFER_FRAMES){playbackStarted=true;playbackCredit=0;}if(playbackStarted&&frameQueue.length){const step=advanceAdaptivePlayback({queuedFrames:frameQueue.length,playbackCredit});playbackCredit=step.playbackCredit;let frame=null;for(let index=0;index<step.consumeFrames;index+=1)frame=frameQueue.shift();if(frame){if(canvas.width!==frame.width)canvas.width=frame.width;if(canvas.height!==frame.height)canvas.height=frame.height;context.putImageData(new ImageData(frame.rgba,frame.width,frame.height),0,0);}}if(playbackStarted&&!frameQueue.length){playbackStarted=false;playbackCredit=0;}}
 requestAnimationFrame(paint)}
document.addEventListener('visibilitychange',()=>{if(document.hidden){streamController?.abort();frameQueue.length=0;playbackStarted=false;playbackCredit=0;}});
function activeButtons(){return [...new Set([...pointerButtons.values(),...keyboardButtons])].sort()}
function showControlMode(mode){controlMode=mode;const manual=mode==='manual';trainerCard.hidden=manual;manualControls.hidden=!manual;if(!manual)releaseInputs();}
function enqueueControl(path,body){const request=controlQueue.catch(()=>{}).then(async()=>{const response=await fetch(path,{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify(body),cache:'no-store'});if(!response.ok)throw new Error((await response.json()).error||'control request failed');return response.json()});controlQueue=request;return request}
function renderPressed(buttons){const active=new Set(buttons);for(const button of gbaButtons)button.classList.toggle('pressed',active.has(button.dataset.gbaButton))}
function syncInputs(force=false){if(controlMode!=='manual')return;const buttons=activeButtons();const key=buttons.join('+');renderPressed(buttons);if(force||key!==lastSentButtons){lastSentButtons=key;enqueueControl('/control/input',{buttons}).catch(()=>{})}}
function releaseInputs(){pointerButtons.clear();keyboardButtons.clear();lastSentButtons='';renderPressed([]);if(controlMode==='manual')syncInputs(true)}
for(const button of gbaButtons){button.addEventListener('pointerdown',event=>{if(controlMode!=='manual')return;event.preventDefault();button.setPointerCapture?.(event.pointerId);pointerButtons.set(event.pointerId,button.dataset.gbaButton);syncInputs()});for(const type of ['pointerup','pointercancel'])button.addEventListener(type,event=>{pointerButtons.delete(event.pointerId);syncInputs()})}
const keyMap={ArrowUp:'up',ArrowDown:'down',ArrowLeft:'left',ArrowRight:'right',z:'a',Z:'a',x:'b',X:'b',Enter:'start',Shift:'select'};
document.addEventListener('keydown',event=>{const button=keyMap[event.key];if(controlMode!=='manual'||!button||event.target===returnToBotButton)return;event.preventDefault();keyboardButtons.add(button);syncInputs()});
document.addEventListener('keyup',event=>{const button=keyMap[event.key];if(!button)return;event.preventDefault();keyboardButtons.delete(button);syncInputs()});
takeControlButton.addEventListener('click',async()=>{takeControlButton.disabled=true;try{const value=await enqueueControl('/control/mode',{mode:'manual'});showControlMode(value.mode);syncInputs(true)}finally{takeControlButton.disabled=false}});
returnToBotButton.addEventListener('click',async()=>{returnToBotButton.disabled=true;try{releaseInputs();await controlQueue.catch(()=>{});const value=await enqueueControl('/control/mode',{mode:'bot'});showControlMode(value.mode)}finally{returnToBotButton.disabled=false}});
window.addEventListener('blur',releaseInputs);window.addEventListener('pagehide',()=>{if(controlMode==='manual')fetch('/control/input',{method:'POST',headers:{'content-type':'application/json'},body:'{"buttons":[]}',keepalive:true}).catch(()=>{})});
setInterval(()=>syncInputs(true),200);
async function status(){try{const value=await fetch('/status',{cache:'no-store'}).then(r=>r.json());
 takeControlButton.hidden=value.control?.viewOnly===true;
 if(value.control?.mode&&value.control.mode!==controlMode)showControlMode(value.control.mode);
 const where=value.map?value.map+(value.position?' @ '+value.position.x+','+value.position.y:''):'waiting for cartridge';
 const winner=value.winner?value.winner.advisor+' · '+value.winner.recommendation.kind:'neutral resample';
 const dex=Number.isSafeInteger(value.pokedexOwnedCount)?' · DEX '+value.pokedexOwnedCount+'/'+(value.pokedexSeenCount??'?'):'';
 statusBox.innerHTML='<strong>MASTER RED · RESEARCH PLAYER</strong>\\n'+where+' · '+(value.mode||'boot')+dex+'\\n'+winner+' · decision '+(value.decisions||0)+(value.complete?'\\n<strong>NATIVE HALL OF FAME COMPLETE</strong>':'');
 }catch(_){statusBox.innerHTML='<strong>MASTER RED · RESEARCH PLAYER</strong>\\n<i>waiting for the local player feed…</i>';}setTimeout(status,250)}
stream();requestAnimationFrame(paint);status();
</script></body></html>`;

const EMBEDDING_HEADERS = Object.freeze({
  "access-control-allow-origin": "*",
  "cross-origin-resource-policy": "cross-origin",
});
const LOOPBACK_CONTROL_HOSTS = new Set(["127.0.0.1", "localhost", "[::1]"]);

function hasTrustedControlOrigin(request) {
  const origin = request.headers.origin;
  if (origin === undefined) return true;
  try {
    const requestOrigin = new URL(`http://${request.headers.host ?? ""}`);
    const suppliedOrigin = new URL(String(origin));
    return suppliedOrigin.protocol === "http:" &&
      LOOPBACK_CONTROL_HOSTS.has(requestOrigin.hostname) &&
      suppliedOrigin.origin === requestOrigin.origin;
  } catch {
    return false;
  }
}

function sendJson(response, statusCode, value) {
  const body = Buffer.from(`${JSON.stringify(value)}\n`);
  response.writeHead(statusCode, {
    ...EMBEDDING_HEADERS,
    "cache-control": "no-store",
    "content-length": body.length,
    "content-type": "application/json; charset=utf-8",
  });
  response.end(body);
}

async function readJsonBody(request, maximumBytes = 4096) {
  const chunks = [];
  let bytes = 0;
  for await (const chunk of request) {
    bytes += chunk.length;
    if (bytes > maximumBytes) throw new Error("request body is too large");
    chunks.push(chunk);
  }
  if (chunks.length === 0) return {};
  try {
    return JSON.parse(Buffer.concat(chunks).toString("utf8"));
  } catch {
    throw new Error("request body must be valid JSON");
  }
}

export async function createLiveViewServer({
  session,
  audioSource = session,
  frameSource = null,
  control = null,
  getStatus = () => ({}),
  host = "127.0.0.1",
  port = 17339,
  framesPerSecond = DEFAULT_DISPLAY_FRAMES_PER_SECOND,
} = {}) {
  if (frameSource !== null && (
    typeof frameSource.latest !== "function" ||
    typeof frameSource.subscribe !== "function" ||
    typeof frameSource.metrics !== "function"
  )) {
    throw new TypeError("live view frameSource must publish emulator frames");
  }
  if (frameSource === null && (!session || typeof session.videoFrame !== "function")) {
    throw new TypeError("live view requires an emulator framebuffer or frame source");
  }
  if (control !== null && (
    typeof control.controlState !== "function" ||
    typeof control.setControlMode !== "function" ||
    typeof control.setManualButtons !== "function"
  )) {
    throw new TypeError("live view control requires an exclusive emulator control gate");
  }
  const ownsPublisher = frameSource === null;
  const publisher = frameSource ?? createLiveFramePublisher({ session, framesPerSecond });
  const compressedFrames = new WeakMap();
  const framePackets = new WeakMap();
  const openStreams = new Set();
  const audioFormat = audioSource?.audioFormat;
  const audio = audioFormat?.format === "s16le" && audioFormat.channels === 2
    && Number.isSafeInteger(audioFormat.sampleRate)
    && audioFormat.sampleRate >= 1000 && audioFormat.sampleRate <= 192000
    && typeof audioSource?.subscribeAudio === "function"
    ? { path: "/audio", ...audioFormat, tempo: 1 } : null;
  const server = createServer((request, response) => {
    if (request.method === "OPTIONS") {
      response.writeHead(204, {
        ...EMBEDDING_HEADERS,
        "access-control-allow-headers": "content-type",
        "access-control-allow-methods": "GET, POST, OPTIONS",
      });
      response.end();
      return;
    }
    const url = new URL(request.url ?? "/", `http://${host}:${port}`);
    if (request.method === "GET" && url.pathname === "/control") {
      sendJson(response, control ? 200 : 503, control
        ? control.controlState()
        : { error: "manual-control-unavailable" });
      return;
    }
    if (
      request.method === "POST" &&
      ["/control/mode", "/control/input"].includes(url.pathname)
    ) {
      void (async () => {
        if (!hasTrustedControlOrigin(request)) {
          sendJson(response, 403, { error: "untrusted-control-origin" });
          return;
        }
        if (!control) {
          sendJson(response, 503, { error: "manual-control-unavailable" });
          return;
        }
        try {
          const body = await readJsonBody(request);
          const state = url.pathname === "/control/mode"
            ? control.setControlMode(body.mode)
            : control.setManualButtons(body.buttons);
          sendJson(response, 200, state);
        } catch (error) {
          const statusCode = /requires manual control/i.test(error.message) ? 409 : 400;
          sendJson(response, statusCode, { error: error.message });
        }
      })();
      return;
    }
    if (request.method !== "GET") {
      sendJson(response, 405, { error: "method-not-allowed" });
      return;
    }
    if (url.pathname === "/health") {
      sendJson(response, 200, {
        ok: true,
        schema: "master-red/live-view/v1",
        stream: publisher.metrics(),
        audio,
      });
      return;
    }
    if (url.pathname === "/status") {
      sendJson(response, 200, getStatus());
      return;
    }
    if (url.pathname === "/audio") {
      if (!audio) {
        sendJson(response, 503, { error: "audio-unavailable" });
        return;
      }
      response.writeHead(200, {
        ...EMBEDDING_HEADERS,
        "cache-control": "no-store, no-transform",
        "content-type": "application/octet-stream",
        "x-accel-buffering": "no",
      });
      response.flushHeaders();
      const cleanup = streamLiveAudio({ response, source: audioSource,
        onClose: callback => openStreams.delete(callback) });
      openStreams.add(cleanup);
      return;
    }
    if (url.pathname === "/frame") {
      try {
        const frame = publisher.latest();
        if (!frame) throw publisher.error() ?? new Error("live framebuffer is not ready");
        const acceptsGzip = /(?:^|[,\s])gzip(?:[,\s]|$)/i.test(
          String(request.headers["accept-encoding"] ?? ""),
        );
        let body = frame.rgba;
        if (acceptsGzip) {
          body = compressedFrames.get(frame);
          if (!body) {
            body = gzipSync(frame.rgba, { level: 1 });
            compressedFrames.set(frame, body);
          }
        }
        response.writeHead(200, {
          ...EMBEDDING_HEADERS,
          "access-control-expose-headers": "x-frame-width, x-frame-height, x-frame-sequence",
          "cache-control": "no-store, no-transform",
          ...(acceptsGzip ? { "content-encoding": "gzip" } : {}),
          "content-length": body.length,
          "content-type": "application/octet-stream",
          "vary": "accept-encoding",
          "x-frame-width": frame.width,
          "x-frame-height": frame.height,
          "x-frame-sequence": frame.sequence,
        });
        response.end(body);
      } catch (error) {
        sendJson(response, 503, { error: error.message });
      }
      return;
    }
    if (url.pathname === "/stream") {
      response.socket?.setNoDelay(true);
      response.writeHead(200, {
        ...EMBEDDING_HEADERS,
        "cache-control": "no-store, no-transform",
        "content-encoding": "gzip",
        "content-type": "application/octet-stream",
        "x-accel-buffering": "no",
      });
      response.flushHeaders();
      const gzip = createGzip({ level: 1 });
      gzip.pipe(response);
      let cleaned = false;
      let unsubscribe = () => {};
      const writer = createLatestFrameWriter({output: response, write(frame, done) {
        let packet = framePackets.get(frame);
        if (!packet) { packet = encodeFramePacket(frame); framePackets.set(frame, packet); }
        gzip.write(packet);
        gzip.flush(zlibConstants.Z_SYNC_FLUSH, done);
      }});
      const cleanup = () => {
        if (cleaned) return;
        cleaned = true;
        openStreams.delete(cleanup);
        unsubscribe();
        writer.close();
        if (!gzip.destroyed) gzip.destroy();
        if (!response.destroyed) response.destroy();
      };
      response.once("close", cleanup);
      response.once("error", cleanup);
      gzip.once("error", (error) => {
        if (!response.destroyed) response.destroy(error);
        cleanup();
      });
      openStreams.add(cleanup);
      unsubscribe = publisher.subscribe(frame => writer.push(frame));
      return;
    }
    if (url.pathname === "/") {
      const body = Buffer.from(VIEWER_HTML);
      response.writeHead(200, {
        ...EMBEDDING_HEADERS,
        "cache-control": "no-store",
        "content-length": body.length,
        "content-type": "text/html; charset=utf-8",
      });
      response.end(body);
      return;
    }
    sendJson(response, 404, { error: "not-found" });
  });
  try {
    await new Promise((resolve, reject) => {
      server.once("error", reject);
      server.listen(port, host, () => {
        server.off("error", reject);
        resolve();
      });
    });
  } catch (error) {
    if (ownsPublisher) publisher.close();
    throw error;
  }
  const address = server.address();
  let closePromise = null;
  return Object.freeze({
    host,
    port: typeof address === "object" && address ? address.port : port,
    url: `http://${host}:${typeof address === "object" && address ? address.port : port}/`,
    close() {
      if (closePromise) return closePromise;
      if (ownsPublisher) publisher.close();
      for (const cleanup of [...openStreams]) cleanup();
      closePromise = new Promise((resolve, reject) =>
        server.close((error) => error ? reject(error) : resolve()));
      return closePromise;
    },
  });
}
