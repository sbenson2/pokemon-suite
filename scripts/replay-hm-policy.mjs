import assert from 'node:assert/strict';
import {createPolicyAdvisors} from '../engine/firered/src/player/advisors.js';
import {createCentralPlayer} from '../engine/firered/src/player/delegator.js';
import {createCampaignController} from '../engine/firered/src/suite/campaign-run.js';
import {createFireRedObserver} from '../engine/firered/src/evidence/fire-red-observer.js';

export function replayHmPolicy({session,saved,inputs}) {
  const {record,state}=saved.metadata.campaign;
  const teamPlan=state.fieldTeamPlan;
  assert.equal(teamPlan.fieldPolicy,'utility-hms-v1');
  // Reproduce a pre-update assignment at the real HM party picker. The
  // checkpoint was reached using Start/Bag/TM Case inputs on the user's save.
  const objective={id:'teach-cut',target:{kind:'teach-move',itemId:339,moveId:15,partySpecies:[1,2,3]}};
  const planner={select:()=>objective,selectTraining:()=>null};
  const open=initialState=>createCentralPlayer({mechanics:inputs.battle,initialState,
    advisors:createPolicyAdvisors({...inputs,mechanics:inputs.battle,teamPlan,campaignPlanner:planner})});
  let player=open(),restarted=false,checkedRecipient=false;
  const controller=createCampaignController({...inputs,mechanics:inputs.battle,record,state});
  const observer=createFireRedObserver({session,...inputs,runId:'campaign-hm-policy',storyWatch:controller.storyWatch()});
  const before=observer.capture();let after=before;
  assert.equal(before.playerMemory.ui.party?.itemId,339);
  assert.equal(before.playerMemory.ui.party?.stage,'choose-pokemon');
  for(let i=0;i<300;i++) {
    after=observer.capture();
    const free=after.phase==='stable'&&after.emulator.mode==='overworld'&&!after.emulator.inBattle&&
      !Object.values(after.playerMemory.ui).some(Boolean);
    if(free) {
      assert.ok(restarted,'the cancellation survives a controller restart');
      assert.ok(checkedRecipient,'the native picker reached an actionable frame');
      assert.deepEqual(after.playerMemory.trainer.party,before.playerMemory.trainer.party,'no moves or party members changed');
      assert.deepEqual(after.playerMemory.trainer.bag,before.playerMemory.trainer.bag,'no items consumed');
      assert.equal(after.sram.sha256,before.sram.sha256,'no save edited');
      const next=controller.decide(after);
      assert.notEqual(next.kind,'blocked',next.reason);
      assert.notEqual(next.winner?.recommendation?.objective,'teach-cut','return to the retained story objective');
      assert.equal(controller.record.commitment,record.commitment);
      return {before,after};
    }
    const decision=player.decide(after),r=decision.winner?.recommendation;
    assert.notEqual(decision.kind,'blocked',decision.reason);
    if(!checkedRecipient && r) {
      assert.equal(r?.kind,'cancel-conflicting-menu','reject the legacy combat HM recipient before selecting it');
      assert.deepEqual(decision.action.buttons,['b']);
      checkedRecipient=true;
    }
    assert.notEqual(r?.kind,'choose-party-member','never commit the prohibited recipient');
    if(!restarted && after.playerMemory.ui.bag) {
      player=open(JSON.parse(JSON.stringify(player.state())));restarted=true;
    }
    const action=decision.action??{buttons:[],holdFrames:8};
    for(let n=0;n<(action.holdFrames??1);n++)session.step(action.buttons??[]);
    for(let n=0;n<(action.releaseFrames??0);n++)session.step([]);
  }
  throw Error('The restricted HM menu did not cancel and hand back to the campaign.');
}
