// Read-only debugging snapshot for the pinned pokeemerald runtime.
// Layouts: include/{main,palette,task,global}.h at 5eff78649e7170a877b961ef0b3a13b81a16038.
const TASK_BYTES = 40;
const TRUCK_TASK = 0x080fb36c;

function read(reader, address, length) {
  const value = reader(address, length);
  if (!(value instanceof Uint8Array) || value.length < length) throw new RangeError(`cannot read 0x${address.toString(16)}`);
  return value;
}
function u16(value, offset = 0) { return value[offset] | (value[offset + 1] << 8); }
function u32(value, offset = 0) { return (value[offset] | value[offset + 1] << 8 | value[offset + 2] << 16 | value[offset + 3] << 24) >>> 0; }

export function readTruckBoundaryDiagnostic(readMemory, manifest) {
  const main = read(readMemory, manifest.gMain, 0x43c);
  const savePointer = u32(read(readMemory, manifest.gSaveBlock1Ptr, 4));
  const save = read(readMemory, savePointer, 8);
  const taskBytes = read(readMemory, manifest.gTasks, TASK_BYTES * 16);
  const activeTasks = [];
  for (let id = 0; id < 16; id += 1) {
    const offset = id * TASK_BYTES;
    if (taskBytes[offset + 4] !== 0) activeTasks.push(Object.freeze({ id, function: u32(taskBytes, offset), data: Object.freeze([u16(taskBytes, offset + 8), u16(taskBytes, offset + 10), u16(taskBytes, offset + 12), u16(taskBytes, offset + 14)]) }));
  }
  const fade = read(readMemory, manifest.gPaletteFade, 12);
  const fadeFields = u16(fade, 4);
  const fadeFlags = u16(fade, 8);
  const fadeActive = (u16(fade, 6) & 0x8000) !== 0; // include/palette.h: blendColor:15 then active:1 share the u16 at +6
  const fieldCallback = u32(read(readMemory, manifest.gFieldCallback, 4));
  const fieldCallback2 = u32(read(readMemory, manifest.gFieldCallback2, 4));
  return Object.freeze({ callback1: u32(main, 0), callback2: u32(main, 4), vblankCallback: u32(main, 0x0c), mainState: main[0x438], vblankCounter: u32(main, 0x20), fieldCallback, fieldCallback2, paletteFadeActive: fadeActive, paletteFade: Object.freeze({ delayCounter: fadeFields & 0x3f, y: (fadeFields >> 6) & 0x1f, targetY: (fadeFields >> 11) & 0x1f, active: fadeActive, bufferTransferDisabled: (fadeFlags & 0x80) !== 0, mode: (fadeFlags >> 8) & 3 }), map: Object.freeze({ group: save[4], number: save[5] }), position: Object.freeze({ x: u16(save, 0), y: u16(save, 2) }), activeTasks: Object.freeze(activeTasks), truckTaskActive: activeTasks.some(task => task.function === (TRUCK_TASK | 1)), });
}

export const TRUCK_SEQUENCE_EXPECTATION = Object.freeze({ task: TRUCK_TASK | 1, source: 'src/field_special_scene.c:185-257: Task_HandleTruckSequence advances state 0..5 and destroys itself after truck unload; it is created by ExecuteTruckSequence at lines 260-270.', expectedFrames: 'approximately 750 frames after ExecuteTruckSequence creates the task', });
