import assert from 'node:assert/strict';
import {createCampaignPlanner} from '../engine/firered/src/player/campaign.js';
import {createCentralPlayer} from '../engine/firered/src/player/delegator.js';
import {createPolicyAdvisors} from '../engine/firered/src/player/advisors.js';
import {createFireRedObserver} from '../engine/firered/src/evidence/fire-red-observer.js';

export function replayMajorBattle({session,saved,inputs}) {
  const {objective,teamPlan}=saved.metadata.replay;
  assert.equal(objective.id,'badge-cascade');
  const campaign={objectives:[objective,{id:'leave-defeated-gym',
    target:{kind:'warp',map:'MAP_CERULEAN_CITY_GYM',index:0},
    completion:{kind:'flag-set',id:2082}}]};
  const open=state=>{
    const planner=createCampaignPlanner({...inputs,mechanics:inputs.battle,teamPlan,campaign,
      initialState:state?.campaignPlanner});
    return {planner,player:createCentralPlayer({campaignPlanner:planner,mechanics:inputs.battle,initialState:state,
      advisors:createPolicyAdvisors({world:inputs.world,mechanics:inputs.battle,teamPlan,campaignPlanner:planner})})};
  };
  let {player,planner}=open(),restarted=false,grassAttacked=false;
  const observer=createFireRedObserver({session,...inputs,runId:'campaign-major-battle',storyWatch:planner.storyWatch()});
  const before=observer.capture();let after=before;
  assert.equal(before.playerMemory.battle.trainerId,415);
  assert.equal(before.playerMemory.battle.turn,0);
  assert.equal(before.playerMemory.battle.player.species,2);
  assert.equal(before.playerMemory.battle.player.hp,61);
  assert.equal(before.playerMemory.storyState.flagIds[2081],false);
  const trainingActions=new Set(['protect-training-member','train-team-anchor','safe-training-knockout']);
  for(let i=0;i<2400;i++) {
    after=observer.capture();
    const decision=player.decide(after),r=decision.winner?.recommendation;
    assert.notEqual(decision.kind,'blocked',decision.reason);
    assert.ok(!trainingActions.has(r?.objective),'XP training must never own a major-battle input');
    const m=after.playerMemory;
    if(m.battle?.player?.species===2&&r?.kind==='choose-battle-move'&&[75,22].includes(r.targetMoveId))grassAttacked=true;
    if(!restarted&&m.battle?.turn>=1&&m.ui.battle?.stage==='action') {
      ({player,planner}=open(JSON.parse(JSON.stringify(player.state()))));restarted=true;
    }
    const free=after.phase==='stable'&&after.emulator.mode==='overworld'&&!after.emulator.inBattle&&
      !Object.values(m.ui).some(Boolean);
    if(free&&m.map.id==='MAP_CERULEAN_CITY') {
      assert.equal(m.storyState.flagIds[2081],true,'win the Cascade Badge');
      assert.ok(grassAttacked,'Ivysaur actually used its Grass attacks');
      assert.ok(restarted,'continue the same battle across a controller restart');
      assert.ok(m.trainer.party.every(p=>p.hp>0),'the retained Misty case should not sacrifice any party member');
      assert.deepEqual(m.trainer.bag.items,before.playerMemory.trainer.bag.items,'avoid wasting the four Super Potions');
      const identities=o=>o.playerMemory.trainer.party.map(p=>[p.personality,p.otId]).sort();
      assert.deepEqual(identities(after),identities(before),'preserve the original party');
      assert.equal(planner.campaignStatus().activeObjective.id,'leave-defeated-gym','victory hands back to navigation');
      return {before,after};
    }
    const action=decision.action??{buttons:[],holdFrames:8};
    for(let n=0;n<(action.holdFrames??1);n++)session.step(action.buttons??[]);
    for(let n=0;n<(action.releaseFrames??0);n++)session.step([]);
  }
  throw Error('The native major battle did not finish and hand back to navigation.');
}
