// Deterministic run profile: a seed fixes the unbiased gender/starter tickets
// through the shared rejection sampler so a run identity is reproducible.
import { createHash } from 'node:crypto';
import { drawUniformTicket } from '../../../shared/fair-choice.js';
import { chooseStarter, choosePlayerGender } from '../catalog.mjs';

export function createSeededByteStream(seed) {
  let counter = 0;
  let buffer = Buffer.alloc(0);
  let offset = 0;
  return () => {
    if (offset >= buffer.length) {
      buffer = createHash('sha256').update(`pokemon-research-emerald:${seed}:${counter}`).digest();
      counter += 1;
      offset = 0;
    }
    return buffer[offset++];
  };
}

export function createRunProfile({ runId, seed }) {
  const nextByte = createSeededByteStream(seed);
  const genderTicket = drawUniformTicket(2, nextByte);
  const starterTicket = drawUniformTicket(3, nextByte);
  return Object.freeze({
    schema: 'pokemon-research/emerald-run-profile/v1',
    runId, seed,
    tickets: Object.freeze({ genderTicket, starterTicket }),
    gender: choosePlayerGender(genderTicket),
    starter: chooseStarter(starterTicket),
    playerName: null,
    goal: 'first-hall-of-fame',
  });
}
