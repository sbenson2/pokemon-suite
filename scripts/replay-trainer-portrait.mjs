import assert from 'node:assert/strict';
import {createFireRedObserver} from '../engine/firered/src/evidence/fire-red-observer.js';
import {createSpectatorStatus} from '../engine/firered/src/presentation/player-status.js';

export function replayTrainerPortrait({session,saved,inputs}) {
  const capture=()=>createFireRedObserver({session,...inputs,runId:'trainer-portrait'}).capture();
  const before=capture();
  assert.equal(before.playerMemory.trainer.gender,'GIRL','the preserved cartridge save owns the female character');
  assert.equal(createSpectatorStatus({observation:before}).trainer.gender,'GIRL','publish the observer string without numeric coercion');
  assert.equal(createSpectatorStatus({observation:before,runProfile:{gender:'BOY'}}).trainer.gender,'GIRL','the loaded character takes precedence over an old run profile');
  session.loadState(saved.state);
  const after=capture();
  assert.equal(createSpectatorStatus({observation:after}).trainer.gender,'GIRL','restoring the same save retains its portrait');
  assert.equal(after.frame,before.frame);
  assert.equal(after.sram.sha256,before.sram.sha256);
  assert.deepEqual(after.playerMemory.trainer.party,before.playerMemory.trainer.party);
  return {before,after};
}
