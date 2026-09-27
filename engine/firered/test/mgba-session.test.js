import assert from "node:assert/strict";
import test from "node:test";

import {
  BUTTON_BITS,
  createMgbaSession,
  encodeButtons,
} from "../src/emulator/mgba-session.js";

function fakeModule() {
  const heap = new Uint8Array(2_000_000);
  let nextPointer = 1024;
  let frame = 0;
  let keys = 0;
  let loaded = false;
  let unloaded = false;
  let coreState = Uint8Array.from([1, 2, 3, 4]);
  let sram = Uint8Array.from([5, 6, 7]);
  const video = Uint8Array.from([
    1, 2, 3, 255,
    4, 5, 6, 255,
  ]);
  const memory = new Map([
    [0x02000000, Uint8Array.from([9, 8, 7, 6])],
  ]);

  const mod = {
    HEAPU8: heap,
    calls: [],
    _malloc(size) {
      const pointer = nextPointer;
      nextPointer += size + 16;
      return pointer;
    },
    _free() {},
    _mgbawasm_init() {
      mod.calls.push(["init"]);
    },
    _mgbawasm_set_log_level(level) {
      mod.calls.push(["log", level]);
    },
    _mgbawasm_load(pointer, bytes, biosPointer, biosBytes, platform, model, skipBios) {
      loaded = bytes > 0;
      mod.calls.push([
        "load",
        heap.slice(pointer, pointer + bytes),
        biosPointer,
        biosBytes,
        platform,
        model,
        skipBios,
      ]);
      return loaded ? 1 : 0;
    },
    _mgbawasm_platform() {
      return loaded ? 0 : -1;
    },
    _mgbawasm_frame_counter() {
      return frame;
    },
    _mgbawasm_reset() {
      frame=0;coreState=Uint8Array.from([0,0,3,4]);
      mod.calls.push(['reset']);
    },
    _mgbawasm_set_keys(mask) {
      keys = mask;
      mod.calls.push(["keys", mask]);
    },
    _mgbawasm_run_frame() {
      frame += 1;
      coreState = Uint8Array.from([frame & 0xff, keys & 0xff, 3, 4]);
      mod.calls.push(["frame", keys]);
    },
    _mgbawasm_audio_available() {
      return 0;
    },
    _mgbawasm_read_audio() {
      return 0;
    },
    _mgbawasm_state_size() {
      return coreState.length;
    },
    _mgbawasm_state_save(pointer) {
      heap.set(coreState, pointer);
      return 1;
    },
    _mgbawasm_state_load(pointer) {
      coreState = heap.slice(pointer, pointer + coreState.length);
      frame = coreState[0];
      return 1;
    },
    _mgbawasm_sram_save() {
      const pointer = mod._malloc(sram.length);
      heap.set(sram, pointer);
      mod.sramPointer = pointer;
      return sram.length;
    },
    _mgbawasm_sram_ptr() {
      return mod.sramPointer;
    },
    _mgbawasm_sram_load(pointer, bytes) {
      sram = heap.slice(pointer, pointer + bytes);
      return 1;
    },
    _mgbawasm_read_memory(address, pointer, bytes) {
      const source = memory.get(address);
      if (!source || bytes > source.length) return 0;
      heap.set(source.subarray(0, bytes), pointer);
      return bytes;
    },
    _mgbawasm_video_width() {
      return 2;
    },
    _mgbawasm_video_height() {
      return 1;
    },
    _mgbawasm_video_ptr() {
      const pointer = mod._malloc(video.length);
      heap.set(video, pointer);
      return pointer;
    },
    _mgbawasm_unload() {
      unloaded = true;
      mod.calls.push(["unload"]);
    },
    get unloaded() {
      return unloaded;
    },
  };
  return mod;
}

test("button encoding is a complete GBA key mask", () => {
  assert.equal(BUTTON_BITS.a, 0);
  assert.equal(BUTTON_BITS.l, 9);
  assert.equal(encodeButtons(["a", "up", "l"]), 1 | (1 << 6) | (1 << 9));
  assert.throws(() => encodeButtons(["turbo"]), /unknown GBA button/i);
});

test("one session owns frame input, state, SRAM, and bounded memory access", () => {
  const module = fakeModule();
  const session = createMgbaSession(module, {
    mgbaCommit: "c".repeat(40),
    mgbaWasmSha256: "d".repeat(64),
  });

  session.boot(Uint8Array.from([10, 20, 30]));
  assert.equal(session.platform, "gba");
  assert.equal(session.step(["a", "right"]), 1);
  assert.equal(session.step([]), 2);
  session.releaseButtons();
  assert.equal(session.frame, 2, "releasing a paused controller must not advance the game");
  assert.deepEqual(module.calls.at(-1), ["keys", 0]);
  assert.deepEqual(
    module.calls.filter(([kind]) => kind === "frame"),
    [["frame", 17], ["frame", 0]],
  );

  const state = session.saveState();
  session.step(["b"]);
  session.loadState(state);
  assert.equal(session.frame, 2);

  assert.deepEqual(session.saveSram(), Uint8Array.from([5, 6, 7]));
  session.loadSram(Uint8Array.from([4, 3, 2]));
  assert.deepEqual(session.saveSram(), Uint8Array.from([4, 3, 2]));
  assert.deepEqual(
    session.readMemory(0x02000000, 4),
    Uint8Array.from([9, 8, 7, 6]),
  );
  assert.deepEqual(session.videoFrame(), {
    width: 2,
    height: 1,
    rgba: Uint8Array.from([
      1, 2, 3, 255,
      4, 5, 6, 255,
    ]),
  });
  assert.throws(() => session.readMemory(0x04000000, 4), /readable GBA memory/i);
  assert.throws(() => session.readMemory(0x02000000, 65537), /readable GBA memory/i);

  session.close();
  assert.equal(module.unloaded, true);
  assert.throws(() => session.step([]), /closed/i);
});

test("audio subscribers receive copied stereo PCM before the core reuses its scratch memory", () => {
  const module = fakeModule();
  module._mgbawasm_sample_rate = () => 32768;
  module._mgbawasm_audio_available = () => 2;
  module._mgbawasm_read_audio = (pointer) => {
    module.HEAPU8.set([1, 0, 255, 255, 2, 0, 254, 255], pointer);
    return 2;
  };
  const session = createMgbaSession(module).boot(new Uint8Array([1]));
  const chunks = [];
  assert.equal(typeof session.subscribeAudio, "function");
  assert.equal(session.audioFormat.sampleRate, 32768);
  const unsubscribe = session.subscribeAudio(chunk => chunks.push(chunk));
  session.step();
  module.HEAPU8.fill(0);
  assert.deepEqual([...chunks[0]], [1, 0, 255, 255, 2, 0, 254, 255]);
  unsubscribe();
  session.step();
  assert.equal(chunks.length, 1);
  session.close();
});

test('cold reset releases held inputs and retains native SRAM in the same session',()=>{
 const module=fakeModule(),session=createMgbaSession(module).boot(Uint8Array.of(1));
 session.loadSram(Uint8Array.of(91,82,73));session.step(['a']);
 assert.equal(typeof session.reset,'function');
 session.reset();
 assert.equal(session.frame,0);
 assert.deepEqual(session.saveSram(),Uint8Array.of(91,82,73));
 session.step();assert.deepEqual(module.calls.filter(([kind])=>kind==='frame').at(-1),['frame',0]);
 assert.deepEqual(module.calls.filter(([kind])=>kind==='reset'),[['reset']]);
 session.close();
});
