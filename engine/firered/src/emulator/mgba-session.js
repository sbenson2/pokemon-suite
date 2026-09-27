import {NativeRfuPeripheral} from './native-rfu.js';

const READABLE_RANGES = [
  { start: 0x02000000, end: 0x02040000 },
  { start: 0x03000000, end: 0x03008000 },
  { start: 0x08000000, end: 0x0a000000 },
];

export const BUTTON_BITS = Object.freeze({
  a: 0,
  b: 1,
  select: 2,
  start: 3,
  right: 4,
  left: 5,
  up: 6,
  down: 7,
  r: 8,
  l: 9,
});

export function encodeButtons(buttons = []) {
  if (!Array.isArray(buttons)) {
    throw new TypeError("GBA buttons must be an array");
  }
  return buttons.reduce((mask, name) => {
    if (!Object.hasOwn(BUTTON_BITS, name)) {
      throw new TypeError(`unknown GBA button: ${name}`);
    }
    return mask | (1 << BUTTON_BITS[name]);
  }, 0);
}

function isReadableRange(address, bytes) {
  if (
    !Number.isSafeInteger(address) ||
    !Number.isSafeInteger(bytes) ||
    bytes <= 0 ||
    bytes > 65536
  ) {
    return false;
  }
  const end = address + bytes;
  return READABLE_RANGES.some(
    (range) => address >= range.start && end <= range.end,
  );
}

function allocateBytes(module, bytes) {
  const pointer = module._malloc(bytes.length);
  if (!pointer) {
    throw new Error(`mGBA could not allocate ${bytes.length} bytes`);
  }
  module.HEAPU8.set(bytes, pointer);
  return pointer;
}

class MgbaSession {
  #module;
  #booted = false;
  #closed = false;
  #audioPointer = 0;
  #audioSubscribers = new Set();
  #wireless = null;

  constructor(module, identity) {
    this.#module = module;
    this.identity = Object.freeze({ ...identity });
    module._mgbawasm_init();
    module._mgbawasm_set_log_level(0);
  }

  #assertOpen() {
    if (this.#closed) throw new Error("mGBA session is closed");
  }

  #assertBooted() {
    this.#assertOpen();
    if (!this.#booted) throw new Error("mGBA session is not booted");
  }

  boot(romBytes) {
    this.#assertOpen();
    if (!(romBytes instanceof Uint8Array) || romBytes.length === 0) {
      throw new TypeError("ROM must be a non-empty Uint8Array");
    }
    const pointer = allocateBytes(this.#module, romBytes);
    try {
      const loaded = this.#module._mgbawasm_load(
        pointer,
        romBytes.length,
        0,
        0,
        0,
        0,
        1,
      );
      if (!loaded) throw new Error("mGBA rejected the cartridge");
      if (this.#module._mgbawasm_platform() !== 0) {
        throw new Error("mGBA did not create a GBA core");
      }
      this.#booted = true;
      return this;
    } finally {
      this.#module._free(pointer);
    }
  }

  get platform() {
    this.#assertBooted();
    return this.#module._mgbawasm_platform() === 0 ? "gba" : "unknown";
  }

  get frame() {
    this.#assertBooted();
    return Number(this.#module._mgbawasm_frame_counter());
  }

  get stateSize() {
    this.#assertBooted();
    return Number(this.#module._mgbawasm_state_size());
  }

  releaseButtons() {
    this.#assertBooted();
    this.#module._mgbawasm_set_keys(0);
  }

  reset() {
    this.#assertBooted();
    if (typeof this.#module._mgbawasm_reset !== 'function') throw new Error('This core cannot cold-reset its native game.');
    this.releaseButtons();
    this.#module._mgbawasm_reset();
  }

  step(buttons = []) {
    this.#assertBooted();
    const mask = encodeButtons(buttons);
    this.#module._mgbawasm_set_keys(mask);
    this.#module._mgbawasm_run_frame();
    this.#wireless?.pump();
    this.#drainAudio();
    return this.frame;
  }

  attachWireless() {
    this.#assertBooted();
    return this.#wireless ??= new NativeRfuPeripheral(this.#module);
  }

  get audioFormat() {
    this.#assertBooted();
    const sampleRate = Number(this.#module._mgbawasm_sample_rate?.());
    return Number.isSafeInteger(sampleRate) && sampleRate > 0 && sampleRate <= 192000
      ? { sampleRate, channels: 2, format: "s16le" } : null;
  }

  subscribeAudio(subscriber) {
    this.#assertBooted();
    if (typeof subscriber !== "function") throw new TypeError("audio subscriber must be a function");
    this.#audioSubscribers.add(subscriber);
    return () => this.#audioSubscribers.delete(subscriber);
  }

  #drainAudio() {
    if (
      typeof this.#module._mgbawasm_audio_available !== "function" ||
      typeof this.#module._mgbawasm_read_audio !== "function"
    ) {
      return;
    }
    let available = Number(this.#module._mgbawasm_audio_available());
    if (available <= 0) return;
    if (!this.#audioPointer) {
      this.#audioPointer = this.#module._malloc(4096 * 4);
      if (!this.#audioPointer) throw new Error("mGBA could not allocate audio scratch memory");
    }
    while (available > 0) {
      const requested = Math.min(available, 4096);
      const read = Number(
        this.#module._mgbawasm_read_audio(this.#audioPointer, requested),
      );
      if (read <= 0) break;
      if (this.#audioSubscribers.size) {
        const pcm = this.#module.HEAPU8.slice(this.#audioPointer, this.#audioPointer + read * 4);
        for (const subscriber of this.#audioSubscribers) {
          // A disconnected spectator must never stop cartridge progression.
          try { subscriber(pcm); } catch { this.#audioSubscribers.delete(subscriber); }
        }
      }
      available -= read;
    }
  }

  saveState() {
    this.#assertBooted();
    const bytes = this.stateSize;
    if (!Number.isSafeInteger(bytes) || bytes <= 0) {
      throw new Error("mGBA reported an invalid state size");
    }
    const pointer = this.#module._malloc(bytes);
    if (!pointer) throw new Error(`mGBA could not allocate ${bytes} state bytes`);
    try {
      if (!this.#module._mgbawasm_state_save(pointer)) {
        throw new Error("mGBA failed to save whole-emulator state");
      }
      return this.#module.HEAPU8.slice(pointer, pointer + bytes);
    } finally {
      this.#module._free(pointer);
    }
  }

  loadState(bytes) {
    this.#assertBooted();
    if (!(bytes instanceof Uint8Array) || bytes.length !== this.stateSize) {
      throw new Error(
        `mGBA state must contain exactly ${this.stateSize} bytes`,
      );
    }
    const pointer = allocateBytes(this.#module, bytes);
    try {
      this.#module._mgbawasm_set_keys(0);
      if (!this.#module._mgbawasm_state_load(pointer)) {
        throw new Error("mGBA rejected whole-emulator state");
      }
      this.#module._mgbawasm_set_keys(0);
    } finally {
      this.#module._free(pointer);
    }
  }

  saveSram() {
    this.#assertBooted();
    const bytes = Number(this.#module._mgbawasm_sram_save());
    if (bytes < 0) throw new Error("mGBA reported an invalid SRAM size");
    if (bytes === 0) return new Uint8Array();
    const pointer = Number(this.#module._mgbawasm_sram_ptr());
    if (!pointer) throw new Error("mGBA returned no SRAM pointer");
    return this.#module.HEAPU8.slice(pointer, pointer + bytes);
  }

  loadSram(bytes) {
    this.#assertBooted();
    if (!(bytes instanceof Uint8Array) || bytes.length === 0) {
      throw new TypeError("SRAM must be a non-empty Uint8Array");
    }
    const pointer = allocateBytes(this.#module, bytes);
    try {
      if (!this.#module._mgbawasm_sram_load(pointer, bytes.length)) {
        throw new Error("mGBA rejected SRAM");
      }
    } finally {
      this.#module._free(pointer);
    }
  }

  readMemory(address, bytes) {
    this.#assertBooted();
    if (!isReadableRange(address, bytes)) {
      throw new RangeError("request is outside readable GBA memory");
    }
    const pointer = this.#module._malloc(bytes);
    if (!pointer) throw new Error(`mGBA could not allocate ${bytes} memory bytes`);
    try {
      if (this.#module._mgbawasm_read_memory(address, pointer, bytes) !== bytes) {
        throw new Error("mGBA memory read failed");
      }
      return this.#module.HEAPU8.slice(pointer, pointer + bytes);
    } finally {
      this.#module._free(pointer);
    }
  }

  videoFrame() {
    this.#assertBooted();
    if (
      typeof this.#module._mgbawasm_video_width !== "function" ||
      typeof this.#module._mgbawasm_video_height !== "function" ||
      typeof this.#module._mgbawasm_video_ptr !== "function"
    ) {
      throw new Error("mGBA build does not expose a video framebuffer");
    }
    const width = Number(this.#module._mgbawasm_video_width());
    const height = Number(this.#module._mgbawasm_video_height());
    const bytes = width * height * 4;
    const pointer = Number(this.#module._mgbawasm_video_ptr());
    if (
      !Number.isSafeInteger(width) ||
      !Number.isSafeInteger(height) ||
      width <= 0 ||
      height <= 0 ||
      width > 4096 ||
      height > 4096 ||
      !pointer ||
      pointer + bytes > this.#module.HEAPU8.length
    ) {
      throw new Error("mGBA exposed an invalid video framebuffer");
    }
    return {
      width,
      height,
      rgba: this.#module.HEAPU8.slice(pointer, pointer + bytes),
    };
  }

  close() {
    if (this.#closed) return;
    this.#audioSubscribers.clear();
    if (this.#audioPointer) this.#module._free(this.#audioPointer);
    this.#module._mgbawasm_set_keys?.(0);
    this.#module._mgbawasm_unload();
    this.#closed = true;
    this.#booted = false;
  }
}

export function createMgbaSession(module, identity = {}) {
  if (!module || typeof module._mgbawasm_load !== "function") {
    throw new TypeError("an initialized mGBA WebAssembly module is required");
  }
  return new MgbaSession(module, identity);
}
