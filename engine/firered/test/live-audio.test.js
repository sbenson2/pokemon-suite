import assert from 'node:assert/strict';
import test from 'node:test';
import { createNativeTempoAudio } from '../src/player/live-audio.js';

function tone(frames, offset = 0) {
  const pcm = Buffer.alloc(frames * 4);
  for (let i = 0; i < frames; i++) {
    const value = Math.round(12000 * Math.sin(2 * Math.PI * (i + offset) / 20));
    pcm.writeInt16LE(value, i * 4);
    pcm.writeInt16LE(-value, i * 4 + 2);
  }
  return pcm;
}

test('1x audio preserves every stereo sample across playback windows', () => {
  const audio = createNativeTempoAudio({ sampleRate: 1000 });
  const output = [];
  for (let i = 0; i < 100; i++) {
    audio.push(tone(10, i * 10));
    output.push(audio.read(10));
  }
  assert.deepEqual(Buffer.concat(output), tone(1000));
});

test('5x and 10x audio retain native pitch with bounded 250ms windows, not a growing backlog', () => {
  for (const speed of [5, 10]) {
    const audio = createNativeTempoAudio({ sampleRate: 1000 });
    for (let window = 0; window < 40; window++) {
      audio.push(tone(250 * speed));
      const output = audio.read(250);
      assert.equal(output.length, 1000);
      assert.deepEqual(output.subarray(40, 960), tone(250).subarray(40, 960));
      assert.equal(output.readInt16LE(996), 0, 'fade the cut to avoid a click');
    }
    assert.deepEqual(audio.read(250), Buffer.alloc(1000), 'old fast-forward audio is discarded');
  }
});

test('an underrun is silence and resuming audio never replays missed samples', () => {
  const audio = createNativeTempoAudio({ sampleRate: 1000 });
  assert.deepEqual(audio.read(20), Buffer.alloc(80));
  audio.push(tone(20));
  assert.deepEqual(audio.read(20), tone(20));
});
