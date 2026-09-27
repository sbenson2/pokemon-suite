import assert from 'node:assert/strict';
import {createCampaignController} from '../engine/firered/src/suite/campaign-run.js';
import {createFireRedObserver} from '../engine/firered/src/evidence/fire-red-observer.js';

export function replaySeagallopReturn({session,saved,inputs}) {
  const original=saved.metadata.campaign;
  assert.equal(original.state.objective.id,'sevii-sail-one-island');
  assert.equal(original.state.supervision.stopReason,'no-meaningful-progress');
  const open=state=>createCampaignController({...inputs,mechanics:inputs.battle,record:original.record,state,clock:()=>0});
  let controller=open(original.state),restarted=false,visitedTwo=false,leftThree=false;
  controller.resume({retryBlockedPolicy:true});
  assert.equal(controller.state().supervision.reviewedRetries.length,(original.state.supervision.reviewedRetries?.length??0)+1);
  assert.equal(controller.state().supervision.elapsedMs,original.state.supervision.elapsedMs);
  const observer=createFireRedObserver({session,...inputs,runId:'campaign-seagallop-return',storyWatch:controller.storyWatch()});
  const before=observer.capture();
  assert.equal(before.playerMemory.map.id,'MAP_THREE_ISLAND_HARBOR');
  assert.equal(before.playerMemory.ui.fieldDialog.stage,'printing');
  assert.equal(before.playerMemory.storyState.flagIds[673],true);
  let lastMap=null;
  for(let i=0;i<4000;i++) {
    const after=observer.capture(),m=after.playerMemory,decision=controller.decide(after);
    const map=m.map.id;
    if(map!==lastMap){console.log('# ferry '+JSON.stringify({frame:after.frame,map,objective:controller.state().objective?.id}));lastMap=map;}
    assert.notEqual(decision.kind,'blocked',decision.reason);
    // The old bot already accepted Two Island. Finish that committed trip;
    // the next destination must be One, never another trip back to Three.
    if(map==='MAP_TWO_ISLAND_HARBOR')visitedTwo=true;
    if(map!=='MAP_THREE_ISLAND_HARBOR')leftThree=true;
    if(leftThree)assert.notEqual(map,'MAP_THREE_ISLAND_HARBOR','do not repeat the wrong-destination cycle');
    if(map==='MAP_TWO_ISLAND_HARBOR'&&m.ui.choiceMenu&&!restarted){
      assert.equal(controller.state().objective?.id,'sevii-sail-one-island');
      controller=open(JSON.parse(JSON.stringify(controller.state())));restarted=true;
    }
    if(map==='MAP_ONE_ISLAND'&&controller.state().objective?.id==='sevii-return-to-kanto'&&after.phase==='stable') {
      assert.ok(visitedTwo&&restarted,'complete departure and recover the destination menu across a restart');
      assert.equal(after.sram.sha256,before.sram.sha256);
      const withoutWalkingFriendship=party=>party.map(({friendship,...p})=>p);
      assert.deepEqual(withoutWalkingFriendship(m.trainer.party),withoutWalkingFriendship(before.playerMemory.trainer.party));
      assert.deepEqual(controller.record,original.record);
      return {before,after};
    }
    const action=decision.action??{buttons:[],holdFrames:8};
    for(let n=0;n<(action.holdFrames??1);n++)session.step(action.buttons??[]);
    for(let n=0;n<(action.releaseFrames??0);n++)session.step([]);
  }
  throw Error('The ferry did not reach One Island and hand back to the Bill return objective.');
}
