import assert from 'node:assert/strict';
import {createCampaignController} from '../engine/firered/src/suite/campaign-run.js';
import {createFireRedObserver} from '../engine/firered/src/evidence/fire-red-observer.js';
import {createCampaignPlanner} from '../engine/firered/src/player/campaign.js';
import {createPolicyAdvisors} from '../engine/firered/src/player/advisors.js';

export function replayRechargeApproach({session,saved,inputs}) {
  const original=saved.metadata.campaign;
  assert.equal(original.state.reason,'no-meaningful-progress');
  const open=state=>createCampaignController({...inputs,mechanics:inputs.battle,
    record:original.record,state,clock:()=>0});
  let controller=open(original.state);
  const observer=createFireRedObserver({session,...inputs,runId:'campaign-recharge-approach',
    storyWatch:controller.storyWatch()});
  const before=observer.capture();
  assert.equal(before.playerMemory.avatar.surfing,true);
  assert.equal(before.playerMemory.vsSeeker.rematchEntries.some(n=>n>0),false);
  assert.equal(before.playerMemory.vsSeeker.batterySteps,14);
  const planner=createCampaignPlanner({...inputs,mechanics:inputs.battle,
    teamPlan:original.state.fieldTeamPlan,initialState:original.state.player.campaignPlanner});
  const navigation=createPolicyAdvisors({world:inputs.world,mechanics:inputs.battle,
    campaignPlanner:planner,runProfile:original.record.runProfile,teamPlan:original.state.fieldTeamPlan})
    .find(a=>a.id==='navigation').advise(before);
  assert.equal(navigation?.recommendation.kind,'move-toward','leave the native surfing position instead of waiting');
  controller.resume({retryBlockedPolicy:true});
  const identity=p=>JSON.stringify([p.otId,p.personality]);
  const initial=new Map(before.playerMemory.trainer.party.map(p=>[identity(p),p.experience]));
  let after=before,landRestart=false,activationRestart=false,charged=false,activated=false,battled=false,last='';
  for(let i=0;i<6000;i++) {
    after=observer.capture();
    const decision=controller.decide(after),state=controller.state(),r=decision.winner?.recommendation,m=after.playerMemory;
    assert.notEqual(decision.kind,'blocked',decision.reason);
    assert.notEqual(r?.kind,'wait-for-supported-objective','training must produce an executable route');
    assert.equal(state.objective?.id,'badge-earth','retain the eighth-badge objective');
    const free=after.phase==='stable'&&after.emulator.mode==='overworld'&&!after.emulator.inBattle&&!Object.values(m.ui).some(Boolean);
    if(free&&!m.avatar.surfing&&!landRestart) {
      controller=open(JSON.parse(JSON.stringify(state)));landRestart=true;
      assert.equal(controller.state().player.campaignPlanner.tasks.training?.member,original.state.task.member);
    }
    if(m.vsSeeker.batterySteps===100)charged=true;
    if(charged&&m.ui.bag&&!activationRestart) {
      controller=open(JSON.parse(JSON.stringify(state)));activationRestart=true;
    }
    if(charged&&m.vsSeeker.rematchEntries.some(n=>n>0))activated=true;
    if(activated&&after.emulator.inBattle)battled=true;
    const trace=JSON.stringify([after.emulator.mode,m.position,m.avatar.surfing,m.vsSeeker.batterySteps,r?.kind,r?.objective]);
    if(process.env.SUITE_REPLAY_TRACE==='1'&&trace!==last){console.log('# recharge '+after.frame+' '+trace);last=trace;}
    if(battled&&free&&!m.vsSeeker.rematchEntries.some(n=>n>0)) {
      assert.ok(landRestart&&activationRestart&&charged&&activated);
      assert.ok(m.trainer.party.some(p=>p.experience>initial.get(identity(p))),'earn native experience after recharging and reactivating');
      assert.deepEqual(m.trainer.party.map(identity).sort(),[...initial.keys()].sort());
      assert.deepEqual(controller.record,original.record,'preserve the random team and run commitment');
      assert.equal(after.sram.sha256,before.sram.sha256,'never rewrite the saved SRAM to recover navigation');
      return {before,after};
    }
    const action=decision.action??{buttons:[],holdFrames:8};
    for(let n=0;n<(action.holdFrames??1);n++)session.step(action.buttons??[]);
    for(let n=0;n<(action.releaseFrames??0);n++)session.step([]);
  }
  throw Error('Native recharge approach did not complete shore arrival, charging, activation, battle and handoff.');
}
