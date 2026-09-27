import assert from 'node:assert/strict';
import {createSuiteMission} from '../engine/firered/src/suite/mission.js';
import {createFireRedObserver} from '../engine/firered/src/evidence/fire-red-observer.js';
import {createCampaignPlanner} from '../engine/firered/src/player/campaign.js';
import {createPolicyAdvisors} from '../engine/firered/src/player/advisors.js';
import {createCentralPlayer} from '../engine/firered/src/player/delegator.js';
import {LINK_QUEST_WATCH,resolveFireRedTravel} from '../engine/firered/src/suite/fire-red-link-quest.js';
import {POSTGAME_WATCH,readPostgameEvidence} from '../engine/firered/src/suite/postgame-agenda.js';

export function replayIslandFly({session,saved,inputs}) {
  const state=saved.metadata.session,request=structuredClone(state.request);
  const open=missionState=>createSuiteMission({id:state.id,request,...inputs,mechanics:inputs.battle,state:missionState});
  let mission=open(state.mission),objective;
  const basePlanner=createCampaignPlanner({...inputs,mechanics:inputs.battle});
  const planner={...basePlanner,select:()=>objective,selectCollection:()=>null,selectTraining:()=>null,
    selectBattleSquad:()=>[],campaignStatus:()=>({objective:objective?.id}),state:()=>({mission:state.id,objective})};
  const playerFor=initialState=>createCentralPlayer({campaignPlanner:planner,
    advisors:createPolicyAdvisors({world:inputs.world,mechanics:inputs.battle,campaignPlanner:planner}),
    initialState,mechanics:inputs.battle,huntConfig:mission.capturePolicy(),captureRequirements:mission.captureRequirements()});
  let player=playerFor(state.player);
  const observer=createFireRedObserver({session,...inputs,runId:'island-fly',observeRng:true,
    storyWatch:{flags:[...basePlanner.storyWatch().flags,...POSTGAME_WATCH.flags,...LINK_QUEST_WATCH.flags,...(mission.storyWatch?.().flags??[])],
      variables:[...POSTGAME_WATCH.variables,...LINK_QUEST_WATCH.variables]}});
  const capture=()=>{const o=observer.capture();return {...o,playerMemory:{...o.playerMemory,postgameEvidence:readPostgameEvidence(session,inputs.runtime,o)}};};
  const before=capture(),restarted=new Set();let last='',reachedMainland=false;
  const identity=p=>[p.personality,p.otId,p.species,p.moves];
  assert.equal(before.playerMemory.map.id,'MAP_FIVE_ISLAND');
  assert.equal(before.playerMemory.ui.flyMap?.stage,'selection');
  assert.equal(request.shiny,'required');assert.equal(request.speciesId,131);
  for(let i=0;i<4000;i++) {
    const after=capture(),m=after.playerMemory,next=mission.inspect(after);
    assert.equal(next.kind,'policy',next.reason);
    objective=resolveFireRedTravel(next.objective,after,inputs.world);
    const decision=player.decide(after);
    assert.notEqual(decision.kind,'blocked',decision.reason);
    if(i===0)assert.equal(decision.winner?.recommendation?.kind,'close-menu','exit the incompatible Fly region');
    const stage=m.map.id==='MAP_FIVE_ISLAND_HARBOR'&&m.ui.fieldDialog?'harbor':
      after.emulator.mode==='overworld'&&!Object.values(m.ui).some(Boolean)?'field':null;
    if(stage&&!restarted.has(stage)) {
      mission.checkpoint?.();mission=open(JSON.parse(JSON.stringify(mission.state)));
      player=playerFor(JSON.parse(JSON.stringify(player.state())));restarted.add(stage);
    }
    const trace=JSON.stringify([m.map.id,m.position,after.emulator.mode,objective?.id,decision.winner?.recommendation?.kind]);
    if(process.env.SUITE_REPLAY_TRACE==='1'&&trace!==last){console.log('# island-fly '+after.frame+' '+trace);last=trace;}
    const field=after.phase==='stable'&&after.emulator.mode==='overworld'&&!Object.values(m.ui).some(Boolean);
    if(m.map.id==='MAP_VERMILION_CITY'&&field)reachedMainland=true;
    if(reachedMainland&&field&&next.objective.target.map==='MAP_SILPH_CO_7F'&&!mission.state.fieldCare?.active) {
      assert.ok(restarted.has('field')&&restarted.has('harbor'),'retain the mission across menu exit and ferry dialogue restarts');
      assert.equal(mission.state.id,state.id);assert.deepEqual(mission.state.request??request,request);
      assert.equal(next.objective.target.map,'MAP_SILPH_CO_7F');
      assert.notEqual(decision.winner?.recommendation?.kind,'wait-for-supported-objective');
      assert.equal(decision.kind,'act');
      assert.deepEqual(m.trainer.party.map(identity),before.playerMemory.trainer.party.map(identity));
      assert.equal(after.sram.sha256,before.sram.sha256,'the trip must not replace the native save');
      return {before,after};
    }
    const action=decision.action??{buttons:[],holdFrames:8};
    for(let n=0;n<(action.holdFrames??1);n++)session.step(action.buttons??[]);
    for(let n=0;n<(action.releaseFrames??0);n++)session.step([]);
  }
  throw Error('The retained Lapras hunt did not exit Fly and return to Kanto by ferry.');
}
