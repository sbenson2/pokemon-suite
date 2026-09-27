import assert from 'node:assert/strict';
import {createSuiteMission} from '../engine/firered/src/suite/mission.js';
import {createFireRedObserver} from '../engine/firered/src/evidence/fire-red-observer.js';
import {createCampaignPlanner} from '../engine/firered/src/player/campaign.js';
import {createPolicyAdvisors} from '../engine/firered/src/player/advisors.js';
import {createCentralPlayer} from '../engine/firered/src/player/delegator.js';
import {resolveFireRedTravel,LINK_QUEST_WATCH} from '../engine/firered/src/suite/fire-red-link-quest.js';
import {POSTGAME_WATCH} from '../engine/firered/src/suite/postgame-agenda.js';
import {continueNativeSaveAsync} from '../engine/firered/src/suite/native-cold-boot.js';

// Reproduce the live Articuno loop on an unmodified native checkpoint. Reach
// the encounter by solving the actual Strength puzzle, then save normally.
export async function replaySeafoamCurrent({session,saved,inputs,createSession}){
 const original=saved.metadata.session,open=state=>createSuiteMission({id:original.id,request:original.request,
  route:original.mission.route,...inputs,mechanics:inputs.battle,state});
 let mission=open(original.mission),objective;
 const base=createCampaignPlanner({...inputs,mechanics:inputs.battle});
 const planner={...base,select:()=>objective,selectCollection:()=>null,selectTraining:()=>null,selectBattleSquad:()=>[],
  campaignStatus:()=>({objective:objective?.id}),state:()=>({objective})};
 const playerFor=initialState=>createCentralPlayer({campaignPlanner:planner,initialState,mechanics:inputs.battle,
  advisors:createPolicyAdvisors({world:inputs.world,mechanics:inputs.battle,campaignPlanner:planner})});
 let player=playerFor(null);
 const watch={flags:[...base.storyWatch().flags,...POSTGAME_WATCH.flags,...LINK_QUEST_WATCH.flags,...mission.storyWatch().flags],
  variables:[...base.storyWatch().variables,...POSTGAME_WATCH.variables,...LINK_QUEST_WATCH.variables]};
 const observer=createFireRedObserver({session,...inputs,runId:'seafoam-current',storyWatch:watch});
 const before=observer.capture(),identity=p=>JSON.stringify([p.personality,p.otId,p.ivs]);
 const all=o=>[...o.playerMemory.trainer.party,...o.playerMemory.trainer.storage.pokemon].filter(p=>p.validity==='valid');
 const individuals=all(before).map(identity),campaign=structuredClone(saved.metadata.campaign.record);
 assert.equal(before.playerMemory.storyState.flagIds[723],false);
 let maps=[],last='',pushes=new Set(),restart=false,partialRestart=false,initialSave=before.sram.sha256,unsupported=0;
 for(let i=0;i<14000;i++){
  const o=observer.capture(),m=o.playerMemory;
  const free=o.phase==='stable'&&o.emulator.mode==='overworld'&&!o.emulator.inBattle&&!Object.values(m.ui??{}).some(Boolean);
  if(free){
   if(maps.at(-1)!==m.map.id)maps.push(m.map.id);
   assert.ok(maps.length<7||m.storyState.flagIds[723]===true,'repeated B3F/B4F crossings must solve the current instead of circling');
   if(m.storyState.flagIds[76]===false&&m.storyState.flagIds[77]===true&&!partialRestart){
    mission=open(structuredClone(mission.state));player=playerFor(structuredClone(player.state()));partialRestart=true;
   }
  }
  const next=mission.inspect(o);
  if(next.kind==='anchor'){
   assert.equal(m.storyState.flagIds[723],true);assert.equal(m.storyState.flagIds[76],false);assert.equal(m.storyState.flagIds[77],false);
   assert.equal(m.storyState.flagIds[702],false,'the legendary is still available for the normal shiny workflow');
   assert.equal(m.map.id,'MAP_SEAFOAM_ISLANDS_B4F');assert.ok(restart&&partialRestart);
   assert.ok(pushes.has(2)&&pushes.has(5),'both required native boulders were pushed');
   assert.notEqual(o.sram.sha256,initialSave);assert.ok(m.gameStats.savedGame>before.playerMemory.gameStats.savedGame);
   for(const id of individuals)assert.ok(all(o).some(p=>identity(p)===id));
   assert.deepEqual(saved.metadata.campaign.record,campaign);
   const cold=await createSession();
   try{cold.loadSram(session.saveSram());const obs=createFireRedObserver({session:cold,...inputs,runId:'seafoam-cold',storyWatch:watch});
    const loaded=await continueNativeSaveAsync(cold,obs);assert.equal(loaded.playerMemory.storyState.flagIds[723],true);
    for(const id of individuals)assert.ok(all(loaded).some(p=>identity(p)===id));
   }finally{cold.close();}
   console.log('# seafoam '+JSON.stringify({frame:o.frame,maps,pushes:[...pushes],restart,partialRestart,nativeSave:true}));
   return {before,after:o};
  }
  assert.ok(['policy','wait'].includes(next.kind),next.reason??next.kind);
  if(next.kind==='wait'){for(let f=0;f<8;f++)session.step([]);continue;}
  objective=resolveFireRedTravel(next.objective,o,inputs.world);
  const d=player.decide(o),r=d.winner?.recommendation;assert.notEqual(d.kind,'blocked',d.reason);
  unsupported=free&&r?.kind==='wait-for-supported-objective'?unsupported+1:0;
  assert.ok(unsupported<8,'the current puzzle needs an executable approach: '+JSON.stringify({phase:r?.seafoamPhase,position:m.position,objects:m.objectEvents}));
  if(r?.kind==='push-field-obstacle'){
   pushes.add(r.obstacle.index);
   if(!restart){mission=open(structuredClone(mission.state));player=playerFor(structuredClone(player.state()));restart=true;}
  }
  if(mission.beforeInteraction(o,d)){player=playerFor(null);continue;}
  const trace=JSON.stringify([m.map.id,m.position,r?.kind,r?.seafoamPhase,r?.obstacle,m.storyState.flagIds[76],m.storyState.flagIds[77],m.storyState.flagIds[723]]);
  if(process.env.SUITE_REPLAY_TRACE==='1'&&trace!==last){console.log('# seafoam-step '+o.frame+' '+trace);last=trace;}
  const a=d.action??{buttons:[],holdFrames:8};for(let n=0;n<(a.holdFrames??1);n++)session.step(a.buttons??[]);for(let n=0;n<(a.releaseFrames??0);n++)session.step([]);
 }
 throw Error('The Seafoam current was not solved and handed back to the native legendary save: '+last);
}
