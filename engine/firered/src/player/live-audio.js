// Play contiguous slices at the core's sample rate. Fast-forward fills a slice
// early; excess samples are discarded until its 250ms playback window ends.
// Resampling the whole accelerated feed would also accelerate its music.
export function createNativeTempoAudio({ sampleRate }) {
  if (!Number.isSafeInteger(sampleRate) || sampleRate < 1000 || sampleRate > 192000) {
    throw new TypeError("invalid audio sample rate");
  }
  const framesPerWindow = Math.round(sampleRate / 4);
  const window = Buffer.alloc(framesPerWindow * 4);
  const fadeFrames = Math.max(1, Math.round(sampleRate * 0.005));
  let written = 0;
  let played = 0;
  let dropped = false;
  let fadeIn = false;
  return {
    push(bytes) {
      if (!(bytes instanceof Uint8Array) || bytes.byteLength % 4) {
        throw new TypeError("audio must contain complete s16le stereo frames");
      }
      written = Math.max(written, played);
      const count = Math.min(bytes.byteLength / 4, framesPerWindow - written);
      window.set(bytes.subarray(0, count * 4), written * 4);
      written += count;
      dropped ||= count * 4 < bytes.byteLength;
    },
    read(frames) {
      if (!Number.isSafeInteger(frames) || frames < 0 || frames > sampleRate) {
        throw new TypeError("audio read must be at most one second");
      }
      const output = Buffer.alloc(frames * 4);
      for (let i = 0; i < frames; i++) {
        if (played < written) {
          const gain = Math.min(1,
            fadeIn ? played / fadeFrames : 1,
            dropped ? (framesPerWindow - played - 1) / fadeFrames : 1);
          for (let channel = 0; channel < 2; channel++) {
            output.writeInt16LE(Math.round(window.readInt16LE(played * 4 + channel * 2) * gain),
              i * 4 + channel * 2);
          }
        }
        played++;
        if (played === framesPerWindow) {
          fadeIn = dropped;
          written = 0;
          played = 0;
          dropped = false;
        }
      }
      return output;
    },
  };
}

export function streamLiveAudio({ response, source, onClose }) {
  const { sampleRate } = source.audioFormat;
  const audio = createNativeTempoAudio({ sampleRate });
  let closed = false;
  let timer;
  let unsubscribe = () => {};
  const cleanup = () => {
    if (closed) return;
    closed = true;
    clearInterval(timer);
    unsubscribe();
    response.destroy();
    onClose(cleanup);
  };
  response.once("close", cleanup);
  response.once("error", cleanup);
  response.socket?.setNoDelay(true);
  unsubscribe = source.subscribeAudio(bytes => audio.push(bytes));
  const started = performance.now();
  let sentFrames = 0;
  timer = setInterval(() => {
    // Fractional sample counts carry across ticks, including 32768/65536 Hz.
    const due = Math.floor((performance.now() - started) * sampleRate / 1000);
    const frames = Math.min(due - sentFrames, Math.floor(sampleRate / 10));
    sentFrames = due;
    if (response.writableLength > sampleRate * 4 / 2) {
      cleanup(); // Slow viewers reconnect at the live edge instead of queuing.
      return;
    }
    if (frames > 0) response.write(audio.read(frames));
  }, 20);
  timer.unref?.();
  return cleanup;
}
