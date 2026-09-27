import assert from 'node:assert/strict';
import {createSuiteMission} from '../engine/firered/src/suite/mission.js';
import {createFireRedObserver} from '../engine/firered/src/evidence/fire-red-observer.js';
import {createCampaignPlanner} from '../engine/firered/src/player/campaign.js';
import {createPolicyAdvisors} from '../engine/firered/src/player/advisors.js';
import {createCentralPlayer} from '../engine/firered/src/player/delegator.js';
import {resolveFireRedTravel,LINK_QUEST_WATCH} from '../engine/firered/src/suite/fire-red-link-quest.js';
export async function replayMoltresRoute({session,saved,inputs}){
 const original=saved.metadata.session;
 const make=state=>createSuiteMission({id:original.id,request:original.request,state,...inputs,mechanics:inputs.battle});
 let mission=make(original.mission),objective,player;
 const base=createCampaignPlanner({...inputs,mechanics:inputs.battle});
 const planner={...base,select:()=>objective,selectCollection:()=>null,selectTraining:()=>null,selectBattleSquad:()=>[],campaignStatus:()=>({objective:objective?.id}),state:()=>({objective})};
 const reopen=state=>createCentralPlayer({campaignPlanner:planner,advisors:createPolicyAdvisors({world:inputs.world,mechanics:inputs.battle,campaignPlanner:planner}),mechanics:inputs.battle,initialState:state,huntConfig:mission.capturePolicy(),captureRequirements:mission.captureRequirements()});
 player=reopen(null);
 const observer=createFireRedObserver({session,...inputs,runId:'moltres-ascent',storyWatch:{flags:[...base.storyWatch().flags,...mission.storyWatch().flags,mission.state.route.flag,...LINK_QUEST_WATCH.flags],variables:LINK_QUEST_WATCH.variables}});
 const before=observer.capture(),restarted=new Set(),visited=new Set();let lastMap,lastObjective,unsupportedSince=null;
 for(let n=0;n<30000;n++){
  const o=observer.capture(),m=o.playerMemory;visited.add(m.map.id);
  const next=mission.inspect(o);assert.notEqual(next.kind,'stop',next.reason);
  if(next.objective)objective=resolveFireRedTravel(next.objective,o,inputs.world);
  const decision=player.decide(o);assert.notEqual(decision.kind,'blocked',decision.reason);
  if(lastMap!==m.map.id||lastObjective!==objective?.id){console.log('# ascent '+JSON.stringify({frame:o.frame,map:m.map.id,position:m.position,objective:objective?.id,kind:decision.winner?.recommendation?.kind}));lastMap=m.map.id;lastObjective=objective?.id;}
  const recommendation=decision.winner?.recommendation;
  if(recommendation?.kind==='wait-for-supported-objective'){unsupportedSince??=o.frame;assert.ok(o.frame-unsupportedSince<600,'Moltres has no supported route: '+JSON.stringify({map:m.map.id,position:m.position,objective}));}else unsupportedSince=null;
  if(recommendation?.kind==='push-field-obstacle'&&!restarted.has(m.map.id)){
   restarted.add(m.map.id);mission=make(JSON.parse(JSON.stringify(mission.state)));player=reopen(player.state());
  }
  if(recommendation?.kind==='interact-with-object'&&recommendation.objective==='hunt-moltres'){
   assert.equal(m.map.id,'MAP_MT_EMBER_SUMMIT');assert.equal(m.storyState.flagIds[701],false);
   assert.ok(restarted.has('MAP_MT_EMBER_EXTERIOR')&&restarted.has('MAP_MT_EMBER_SUMMIT'));
   assert.ok(visited.has('MAP_ONE_ISLAND_HARBOR'));
   assert.equal(o.sram.sha256,before.sram.sha256);assert.equal(mission.state.elapsedMs,original.mission.elapsedMs);
   assert.equal(mission.beforeInteraction(o,decision),true);assert.equal(mission.state.phase,'saving-anchor');
   const checkpoint=session.saveState();session.loadState(checkpoint);const after=observer.capture();
   assert.equal(after.playerMemory.map.id,'MAP_MT_EMBER_SUMMIT');
   return {before,after};
  }
  const action=decision.action??{buttons:[],holdFrames:8};
  for(let i=0;i<(action.holdFrames??1);i++)session.step(action.buttons??[]);
  for(let i=0;i<(action.releaseFrames??0);i++)session.step([]);
  if(n%100===0)await new Promise(r=>setImmediate(r));
 }
 throw Error('Moltres ascent exceeded the bounded native replay.');
}
