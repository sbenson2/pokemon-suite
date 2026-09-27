// An atomic frame is internally coherent, but cartridge initialization/recap
// frames are not durable gameplay evidence. Reducers must not remember them.
export function isProgressObservation(observation) {
  return observation?.phase === "stable" &&
    typeof observation.emulator?.mode === "string" &&
    !["boot", "unknown"].includes(observation.emulator.mode) &&
    Boolean(observation.playerMemory?.map?.id) &&
    observation.playerMemory?.questLog?.playback !== true;
}
