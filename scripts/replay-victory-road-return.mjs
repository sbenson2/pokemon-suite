import assert from 'node:assert/strict';
import {createFireRedObserver} from '../engine/firered/src/evidence/fire-red-observer.js';
import {createCampaignPlanner} from '../engine/firered/src/player/campaign.js';
import {createCentralPlayer} from '../engine/firered/src/player/delegator.js';
import {createPolicyAdvisors} from '../engine/firered/src/player/advisors.js';

export function replayVictoryRoadReturn({session,saved,inputs}) {
  const original=saved.metadata.campaign;
  assert.equal(original.observedObjective.id,'elite-four-lorelei');
  // Retain the actual recorded destination while exercising the production
  // central player and navigation. The newer training selector can choose a
  // different location; that must not hide the historical navigation failure.
  const objective={id:'train-battle-member-with-vs-seeker',target:{kind:'object',map:'MAP_ROUTE20',index:0},deferOptionalDetours:true};
  let planner;
  const open=state=>{
    planner=createCampaignPlanner({...inputs,mechanics:inputs.battle,teamPlan:original.fieldTeamPlan,
      campaign:{objectives:[objective]},initialState:state?.campaignPlanner??null});
    return createCentralPlayer({campaignPlanner:planner,mechanics:inputs.battle,initialState:state??null,
      advisors:createPolicyAdvisors({world:inputs.world,mechanics:inputs.battle,campaignPlanner:planner,
        runProfile:original.record.runProfile,teamPlan:original.fieldTeamPlan})});
  };
  let controller=open();
  const watch=createCampaignPlanner({...inputs,mechanics:inputs.battle,teamPlan:original.fieldTeamPlan}).storyWatch();
  const observer=createFireRedObserver({session,...inputs,runId:'campaign-victory-road-return',storyWatch:watch});
  const before=observer.capture();
  assert.equal(before.frame,8553799);
  assert.equal(before.playerMemory.map.id,'MAP_ROUTE23');
  const identity=p=>JSON.stringify([p.otId,p.personality]);
  const identities=before.playerMemory.trainer.party.map(identity).sort();
  let entered=false,third=false,first=false,restarted=false,last='',lastFreeMap=null;
  const returnEntries=new Map();
  for(let i=0;i<7000;i++) {
    const after=observer.capture(),m=after.playerMemory,decision=controller.decide(after),state=controller.state();
    const r=decision.winner?.recommendation;
    assert.notEqual(decision.kind,'blocked',decision.reason);
    assert.notEqual(r?.kind,'wait-for-supported-objective','the retained training task must have an executable return route');
    assert.equal(planner.campaignStatus().activeObjective?.id,objective.id);
    const free=after.phase==='stable'&&after.emulator.mode==='overworld'&&!after.emulator.inBattle&&!Object.values(m.ui).some(Boolean);
    if(free&&m.map.id==='MAP_VICTORY_ROAD_2F') {
      entered=true;
      assert.notEqual(r?.victoryRoadPhase,'exit-north','do not return to the north doorway for a southbound training destination');
      if(lastFreeMap!==m.map.id&&((m.position.x===34&&m.position.y===9)||(m.position.x===3&&m.position.y===3))){
        const key=JSON.stringify(m.position),count=(returnEntries.get(key)??0)+1;returnEntries.set(key,count);
        assert.ok(count<=1,'do not repeat a 2F/3F return ladder after a reset gate blocks the southern path');
      }
    }
    if(free&&m.map.id==='MAP_VICTORY_ROAD_3F') {
      third=true;
      if(!restarted){controller=open(JSON.parse(JSON.stringify(state)));restarted=true;}
    }
    if(free&&m.map.id==='MAP_VICTORY_ROAD_1F')first=true;
    if(free)lastFreeMap=m.map.id;
    const trace=JSON.stringify([m.map.id,m.position,r?.kind,r?.objective,r?.victoryRoadPhase]);
    if(process.env.SUITE_REPLAY_TRACE==='1'&&trace!==last){console.log('# victory-road '+after.frame+' '+trace);last=trace;}
    if(free&&m.map.id==='MAP_ROUTE22') {
      assert.ok(entered&&third&&first&&restarted,'complete the reverse cave route and restart before the Kanto handoff');
      assert.equal(decision.kind,'act','normal Kanto navigation resumes');
      assert.equal(r?.targetMap,'MAP_ROUTE20','keep the original training destination');
      assert.deepEqual(m.trainer.party.map(identity).sort(),identities);
      assert.equal(after.sram.sha256,before.sram.sha256);
      return {before,after};
    }
    const action=decision.action??{buttons:[],holdFrames:8};
    for(let n=0;n<(action.holdFrames??1);n++)session.step(action.buttons??[]);
    for(let n=0;n<(action.releaseFrames??0);n++)session.step([]);
  }
  throw Error('Native Victory Road return did not finish the cave, restart and southbound training handoff.');
}
