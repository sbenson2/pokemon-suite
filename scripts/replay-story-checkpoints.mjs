import assert from 'node:assert/strict';
import {createCampaignController} from '../engine/firered/src/suite/campaign-run.js';
import {createFireRedObserver} from '../engine/firered/src/evidence/fire-red-observer.js';

export function replayStoryRetry(options){return replayStoryCheckpoints({...options,reviewedRetry:true});}

export function replayStoryCheckpoints({session,saved,inputs,reviewedRetry=false}) {
  const original=saved.metadata.campaign;
  assert.equal(original.state.objective.id,'badge-marsh');
  const open=state=>createCampaignController({...inputs,mechanics:inputs.battle,record:original.record,state,clock:()=>0});
  let controller=open(original.state),restarted=false,leftTrigger=false;
  if(reviewedRetry){
    assert.equal(original.state.supervision.stopReason,'no-meaningful-progress');
    controller.resume();assert.equal(controller.state().supervision.stopReason,'no-meaningful-progress');
    controller.pause();controller.resume({retryBlockedPolicy:true});
    assert.equal(controller.state().supervision.reviewedRetries.length,(original.state.supervision.reviewedRetries?.length??0)+1);
    assert.equal(controller.state().supervision.elapsedMs,original.state.supervision.elapsedMs);
  }
  const observer=createFireRedObserver({session,...inputs,runId:'campaign-story-checkpoints',storyWatch:controller.storyWatch()});
  const before=observer.capture();
  assert.equal(before.playerMemory.map.id,'MAP_CINNABAR_ISLAND');
  assert.equal(before.playerMemory.storyState.flagIds[2085],false);
  assert.equal(before.playerMemory.storyState.flagIds[424],false);
  if(!reviewedRetry){
    // This historical checkpoint was still running after fourteen idle
    // minutes under the former fifteen-minute deadline. Migration must honor
    // the new five-minute limit, then require a recorded reviewed retry.
    const stopped=controller.decide(before),supervision=controller.state().supervision;
    assert.equal(stopped.kind,'blocked');assert.equal(stopped.reason,'no-meaningful-progress');
    assert.equal(supervision.progressTimeoutMs,300000);
    assert.equal(supervision.idleMs,original.state.supervision.idleMs);
    assert.equal(supervision.elapsedMs,original.state.supervision.elapsedMs);
    controller.resume({retryBlockedPolicy:true});
    assert.equal(controller.state().supervision.reviewedRetries.length,(original.state.supervision.reviewedRetries?.length??0)+1);
    assert.equal(controller.state().supervision.reviewedRetries.at(-1).idleMs,supervision.idleMs);
  }
  for(let i=0;i<1500;i++) {
    const after=observer.capture(),m=after.playerMemory,decision=controller.decide(after);
    assert.notEqual(decision.kind,'blocked',decision.reason);
    assert.equal(controller.state().objective.id,'badge-marsh','retain Sabrina while leaving Cinnabar');
    assert.equal(m.storyState.flagIds[2085],false,'navigation must not award the missing badge');
    assert.equal(m.storyState.flagIds[2086],false);
    if(m.map.id==='MAP_CINNABAR_ISLAND') {
      const onTrigger=m.position.x===20&&m.position.y===5;
      if(leftTrigger)assert.equal(onTrigger,false,'do not return to the locked-door scene');
      if(m.position.x!==20)leftTrigger=true;
      if(leftTrigger&&!restarted){controller=open(JSON.parse(JSON.stringify(controller.state())));restarted=true;}
    } else if(after.phase==='stable'&&after.emulator.mode==='overworld') {
      assert.equal(m.map.id,'MAP_ROUTE21_SOUTH','hand off to the actual route toward Saffron');
      const progress=controller.storyProgress(after);
      assert.equal(progress.current.id,'badge-marsh');assert.equal(progress.current.status,'current');
      assert.equal(progress.badges.earned,5);assert.equal(progress.badges.known,8);
      assert.deepEqual(progress.issues,[]);
      assert.ok(leftTrigger&&restarted);
      assert.equal(after.sram.sha256,before.sram.sha256);
      // Ordinary walking can increase friendship. All other party data must
      // survive this short, battle-free crossing unchanged.
      const withoutWalkingFriendship=party=>party.map(({friendship,...p})=>p);
      assert.deepEqual(withoutWalkingFriendship(m.trainer.party),withoutWalkingFriendship(before.playerMemory.trainer.party));
      assert.deepEqual(controller.record,original.record);
      return {before,after};
    }
    const action=decision.action??{buttons:[],holdFrames:8};
    for(let n=0;n<(action.holdFrames??1);n++)session.step(action.buttons??[]);
    for(let n=0;n<(action.releaseFrames??0);n++)session.step([]);
  }
  throw Error('The campaign did not leave the active story-trigger loop.');
}
