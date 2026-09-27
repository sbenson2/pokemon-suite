import assert from 'node:assert/strict';
import {createCampaignController} from '../engine/firered/src/suite/campaign-run.js';
import {createFireRedObserver} from '../engine/firered/src/evidence/fire-red-observer.js';
import {captureSavePreview,createRestoredVideoSession} from '../engine/firered/src/suite/save-preview.js';
import {digest} from '../engine/firered/src/suite/save-vault.js';

export async function replayCompletionPreview({session,saved,inputs,createSession}) {
  const original=saved.metadata.campaign;
  assert.equal(original.state.status,'complete');
  assert.equal(original.state.completion.nativeHallOfFame.nativeSaveVerified,true);
  const controller=createCampaignController({...inputs,mechanics:inputs.battle,record:original.record,state:original.state});
  const observer=createFireRedObserver({session,...inputs,runId:'campaign-completion-preview',storyWatch:controller.storyWatch()});
  const before=observer.capture();
  // Legacy snapshots do not have display data. Paint this disposable emulator
  // once, then verify a new-format snapshot can reopen without any further input.
  session.step([]);
  const after=observer.capture(),state=session.saveState(),sram=session.saveSram();
  const originalPicture=Uint8Array.from(session.videoFrame().rgba);
  assert.ok(originalPicture.some(v=>v!==0));
  const preview=captureSavePreview({session,stateSha256:digest(state)});
  const checkpoint={stateSha256:digest(state),metadata:{frame:session.frame,preview}};
  const replica=await createSession();
  try{
    replica.loadSram(sram);replica.loadState(state);
    assert.ok(replica.videoFrame().rgba.every(v=>v===0),'reproduce the cold restored framebuffer');
    const display=createRestoredVideoSession({session:replica,checkpoint});
    const sramBefore=replica.saveSram(),nativeBefore=replica.saveState(),frame=replica.frame;
    for(let i=0;i<3;i++)assert.deepEqual(Uint8Array.from(display.videoFrame().rgba),originalPicture);
    assert.deepEqual(replica.saveState(),nativeBefore);
    assert.deepEqual(replica.saveSram(),sramBefore);
    assert.equal(replica.frame,frame,'restoring the picture never advances the cartridge');
    assert.deepEqual(controller.decide(after).action.buttons,[],'a completed campaign stays idle');
    assert.deepEqual(controller.state().completion,original.state.completion);
    replica.step([]);
    assert.deepEqual(display.videoFrame(),replica.videoFrame(),'native rendering takes over on the first real frame');
    assert.equal(after.sram.sha256,before.sram.sha256);
    return {before,after};
  }finally{replica.close();}
}
