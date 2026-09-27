const GBA_READABLE_RANGES = Object.freeze([
  Object.freeze({ start: 0x02000000, end: 0x02040000 }),
  Object.freeze({ start: 0x03000000, end: 0x03008000 }),
  Object.freeze({ start: 0x08000000, end: 0x0a000000 }),
]);

const GB_READABLE_RANGES = Object.freeze([
  Object.freeze({ start: 0x0000, end: 0x8000 }),
  Object.freeze({ start: 0xc000, end: 0xe000 }),
  Object.freeze({ start: 0xff80, end: 0x10000 }),
]);

const SYSTEMS = Object.freeze({
  auto: Object.freeze({ platform: -1, model: null }),
  gba: Object.freeze({ platform: 0, model: null }),
  gb: Object.freeze({ platform: 1, model: null }),
  gbc: Object.freeze({ platform: 1, model: "CGB" }),
});

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
  if (!Array.isArray(buttons)) throw new TypeError("buttons must be an array");
  return buttons.reduce((mask, button) => {
    if (!Object.hasOwn(BUTTON_BITS, button)) {
      throw new TypeError(`unknown handheld button: ${button}`);
    }
    return mask | (1 << BUTTON_BITS[button]);
  }, 0);
}

function allocateBytes(module, bytes) {
  const pointer = module._malloc(bytes.byteLength);
  if (!pointer) throw new Error(`mGBA could not allocate ${bytes.byteLength} bytes`);
  module.HEAPU8.set(bytes, pointer);
  return pointer;
}

function allocateString(module, value) {
  if (!value) return 0;
  const bytes = new TextEncoder().encode(`${value}\0`);
  return allocateBytes(module, bytes);
}

function inReadableRange(ranges, address, bytes) {
  if (
    !Number.isSafeInteger(address) || !Number.isSafeInteger(bytes) ||
    bytes <= 0 || bytes > 65536
  ) return false;
  const end = address + bytes;
  return ranges.some((range) => address >= range.start && end <= range.end);
}

class MultiSystemMgbaSession {
  #module;
  #requestedSystem;
  #booted = false;
  #closed = false;
  #audioPointer = 0;

  constructor(module, { system, identity }) {
    this.#module = module;
    this.#requestedSystem = system;
    this.identity = Object.freeze({ ...identity, system });
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
    if (!(romBytes instanceof Uint8Array) || romBytes.byteLength === 0) {
      throw new TypeError("ROM must be a non-empty Uint8Array");
    }
    const configuration = SYSTEMS[this.#requestedSystem];
    const romPointer = allocateBytes(this.#module, romBytes);
    const modelPointer = allocateString(this.#module, configuration.model);
    try {
      const loaded = this.#module._mgbawasm_load(
        romPointer,
        romBytes.byteLength,
        0,
        0,
        configuration.platform,
        modelPointer,
        1,
      );
      if (!loaded) throw new Error("mGBA rejected the cartridge");
      const actualPlatform = Number(this.#module._mgbawasm_platform());
      if (actualPlatform !== 0 && actualPlatform !== 1) {
        throw new Error("mGBA created an unsupported core");
      }
      if (configuration.platform >= 0 && actualPlatform !== configuration.platform) {
        throw new Error("mGBA created the wrong platform core");
      }
      this.#booted = true;
      return this;
    } finally {
      if (modelPointer) this.#module._free(modelPointer);
      this.#module._free(romPointer);
    }
  }

  get platform() {
    this.#assertBooted();
    if (this.#module._mgbawasm_platform() === 0) return "gba";
    return this.#requestedSystem === "gbc" ? "gbc" : "gb";
  }

  get frame() {
    this.#assertBooted();
    return Number(this.#module._mgbawasm_frame_counter());
  }

  get stateSize() {
    this.#assertBooted();
    return Number(this.#module._mgbawasm_state_size());
  }

  step(buttons = []) {
    this.#assertBooted();
    this.#module._mgbawasm_set_keys(encodeButtons(buttons));
    this.#module._mgbawasm_run_frame();
    this.#drainAudio();
    return this.frame;
  }

  #drainAudio() {
    if (
      typeof this.#module._mgbawasm_audio_available !== "function" ||
      typeof this.#module._mgbawasm_read_audio !== "function"
    ) return;
    let available = Number(this.#module._mgbawasm_audio_available());
    if (available <= 0) return;
    if (!this.#audioPointer) {
      this.#audioPointer = this.#module._malloc(4096 * 4);
      if (!this.#audioPointer) throw new Error("mGBA could not allocate audio scratch memory");
    }
    while (available > 0) {
      const read = Number(this.#module._mgbawasm_read_audio(
        this.#audioPointer,
        Math.min(available, 4096),
      ));
      if (read <= 0) break;
      available -= read;
    }
  }

  saveState() {
    this.#assertBooted();
    const size = this.stateSize;
    if (!Number.isSafeInteger(size) || size <= 0) {
      throw new Error("mGBA reported an invalid state size");
    }
    const pointer = this.#module._malloc(size);
    if (!pointer) throw new Error(`mGBA could not allocate ${size} state bytes`);
    try {
      if (!this.#module._mgbawasm_state_save(pointer)) {
        throw new Error("mGBA failed to save whole-emulator state");
      }
      return this.#module.HEAPU8.slice(pointer, pointer + size);
    } finally {
      this.#module._free(pointer);
    }
  }

  loadState(bytes) {
    this.#assertBooted();
    if (!(bytes instanceof Uint8Array) || bytes.byteLength !== this.stateSize) {
      throw new Error(`mGBA state must contain exactly ${this.stateSize} bytes`);
    }
    const pointer = allocateBytes(this.#module, bytes);
    try {
      this.#module._mgbawasm_set_keys(0);
      if (!this.#module._mgbawasm_state_load(pointer)) {
        throw new Error("mGBA rejected whole-emulator state");
      }
    } finally {
      this.#module._free(pointer);
    }
  }

  saveSram() {
    this.#assertBooted();
    const size = Number(this.#module._mgbawasm_sram_save());
    if (size < 0) throw new Error("mGBA reported an invalid SRAM size");
    if (size === 0) return new Uint8Array();
    const pointer = Number(this.#module._mgbawasm_sram_ptr());
    if (!pointer) throw new Error("mGBA returned no SRAM pointer");
    return this.#module.HEAPU8.slice(pointer, pointer + size);
  }

  loadSram(bytes) {
    this.#assertBooted();
    if (!(bytes instanceof Uint8Array) || bytes.byteLength === 0) {
      throw new TypeError("SRAM must be a non-empty Uint8Array");
    }
    const pointer = allocateBytes(this.#module, bytes);
    try {
      if (!this.#module._mgbawasm_sram_load(pointer, bytes.byteLength)) {
        throw new Error("mGBA rejected SRAM");
      }
    } finally {
      this.#module._free(pointer);
    }
  }

  readMemory(address, bytes) {
    this.#assertBooted();
    const gameBoy = this.#module._mgbawasm_platform() === 1;
    const ranges = gameBoy ? GB_READABLE_RANGES : GBA_READABLE_RANGES;
    if (!inReadableRange(ranges, address, bytes)) {
      throw new RangeError(
        `request is outside readable ${gameBoy ? "Game Boy" : "GBA"} memory`,
      );
    }
    if (typeof this.#module._mgbawasm_read_memory !== "function") {
      throw new Error("mGBA build does not expose the read-only memory bridge");
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

  readWramBank(bank, address, bytes) {
    this.#assertBooted();
    if (this.#module._mgbawasm_platform() !== 1) {
      throw new Error("banked WRAM reads are only available for Game Boy cartridges");
    }
    if (!Number.isSafeInteger(bank) || bank < 1 || bank > 7) {
      throw new RangeError("CGB WRAM bank must be an integer bank from 1 through 7");
    }
    if (!inReadableRange([{ start: 0xd000, end: 0xe000 }], address, bytes)) {
      throw new RangeError("request is outside CGB banked WRAM");
    }
    if (typeof this.#module._mgbawasm_read_memory_segment !== "function") {
      throw new Error("mGBA build does not expose the read-only banked-memory bridge");
    }
    const pointer = this.#module._malloc(bytes);
    if (!pointer) throw new Error(`mGBA could not allocate ${bytes} memory bytes`);
    try {
      if (this.#module._mgbawasm_read_memory_segment(address, bank, pointer, bytes) !== bytes) {
        throw new Error("mGBA banked WRAM read failed");
      }
      return this.#module.HEAPU8.slice(pointer, pointer + bytes);
    } finally {
      this.#module._free(pointer);
    }
  }

  videoFrame() {
    this.#assertBooted();
    const width = Number(this.#module._mgbawasm_video_width());
    const height = Number(this.#module._mgbawasm_video_height());
    const byteLength = width * height * 4;
    const pointer = Number(this.#module._mgbawasm_video_ptr());
    if (
      !Number.isSafeInteger(width) || !Number.isSafeInteger(height) ||
      width <= 0 || height <= 0 || width > 4096 || height > 4096 ||
      !pointer || pointer + byteLength > this.#module.HEAPU8.byteLength
    ) throw new Error("mGBA exposed an invalid video framebuffer");
    return {
      width,
      height,
      rgba: this.#module.HEAPU8.slice(pointer, pointer + byteLength),
    };
  }

  close() {
    if (this.#closed) return;
    if (this.#audioPointer) this.#module._free(this.#audioPointer);
    this.#module._mgbawasm_set_keys?.(0);
    this.#module._mgbawasm_unload();
    this.#closed = true;
    this.#booted = false;
  }
}

export function createMultiSystemMgbaSession(module, {
  system = "auto",
  identity = {},
} = {}) {
  if (!module || typeof module._mgbawasm_load !== "function") {
    throw new TypeError("an initialized mGBA WebAssembly module is required");
  }
  if (!Object.hasOwn(SYSTEMS, system)) {
    throw new TypeError(`unsupported mGBA system: ${system}`);
  }
  return new MultiSystemMgbaSession(module, { system, identity });
}
