import assert from 'node:assert/strict';
import {createPostgameController} from '../engine/firered/src/suite/postgame.js';
import {createFireRedObserver} from '../engine/firered/src/evidence/fire-red-observer.js';
import {encounterFingerprint} from '../engine/firered/src/player/encounter-tracker.js';

export function replayEffortTraining({session,inputs}) {
  const open=state=>createPostgameController({...inputs,mechanics:inputs.battle,state});
  let controller=open(),restarted=false,last='';
  const observer=createFireRedObserver({session,...inputs,runId:'ev-training',storyWatch:controller.storyWatch()});
  const before=observer.capture(),member=before.playerMemory.trainer.party[0],fingerprint=encounterFingerprint(member);
  assert.equal(member.species,4);assert.equal(member.evs.speed,3);
  const target={...member.evs,speed:member.evs.speed+1};
  controller.beginPlayerTask({id:'native-ev-training',kind:'ev-training',fingerprint,evs:target,ivRanges:{}});
  for(let i=0;i<6000;i++){
    const after=observer.capture();
    if(!restarted&&after.playerMemory.ui.battle?.stage==='move'){
      controller=open(JSON.parse(JSON.stringify(controller.state())));restarted=true;
    }
    const decision=controller.decide(after);
    if(process.env.SUITE_REPLAY_TRACE==='1'){
      const key=JSON.stringify([after.playerMemory.map.id,after.emulator.mode,controller.state().playerTask?.phase,decision.kind,decision.reason,decision.winner?.recommendation]);
      if(key!==last){console.log('# ev '+after.frame+' '+key);last=key;}
    }
    assert.notEqual(decision.kind,'blocked',decision.reason);
    if(decision.kind==='player-task-complete'){
      assert.ok(restarted,'the native move menu survived controller reconstruction');
      assert.equal(decision.receipt.fingerprint,fingerprint);
      assert.deepEqual(decision.receipt.evs,target);
      assert.equal(decision.receipt.nativeSaveVerified,true);
      assert.notEqual(after.sram.sha256,before.sram.sha256);
      assert.equal(after.playerMemory.gameStats.savedGame,before.playerMemory.gameStats.savedGame+1);
      assert.deepEqual(after.playerMemory.trainer.party.map(p=>[p.personality,p.otId]),before.playerMemory.trainer.party.map(p=>[p.personality,p.otId]));
      assert.equal(after.playerMemory.trainer.party[1].experience,before.playerMemory.trainer.party[1].experience);
      return {before,after};
    }
    const action=decision.action??{buttons:[],holdFrames:8};
    for(let n=0;n<(action.holdFrames??1);n++)session.step(action.buttons??[]);
    for(let n=0;n<(action.releaseFrames??0);n++)session.step([]);
  }
  throw Error('Native EV task did not complete a KO, exact readback, and in-game save.');
}
