import assert from 'node:assert/strict';
import {setImmediate as yieldIO} from 'node:timers/promises';
import {createSuiteMission} from '../engine/firered/src/suite/mission.js';
import {createFireRedObserver} from '../engine/firered/src/evidence/fire-red-observer.js';
import {createCampaignPlanner} from '../engine/firered/src/player/campaign.js';
import {createPolicyAdvisors} from '../engine/firered/src/player/advisors.js';
import {createCentralPlayer} from '../engine/firered/src/player/delegator.js';
import {LINK_QUEST_WATCH,resolveFireRedTravel} from '../engine/firered/src/suite/fire-red-link-quest.js';
import {POSTGAME_WATCH,readPostgameEvidence} from '../engine/firered/src/suite/postgame-agenda.js';
import {selectNationalDexCapture} from '../engine/firered/src/suite/national-dex-agenda.js';
import {encounterFingerprint} from '../engine/firered/src/player/encounter-tracker.js';
import {observeNavigationCycle} from '../engine/firered/src/suite/navigation-cycle.js';

// Live September 23: the National Dex collection picked Slugma on Ruby Path B3F
// (the 100% table) fourteen times. B3F sits behind Strength boulders, and the
// cave door on the Mt. Ember exterior is opened by a map-load script, so every
// hunt stalled at One Island Harbor. From the retained live save (Celadon PC
// 2F), the real selector must choose a Slugma floor the entrance reaches, and
// the real hunt must travel ferry -> Kindle Road -> Mt. Ember -> Ruby Path 1F
// -> B1F -> B2F to an encounter cell (or meet Slugma on the way). Only controller
// inputs are used; other species are deferred through the agenda's own
// per-species retry records so the replay isolates Slugma's selection.
const SLUGMA=218,P='MAP_MT_EMBER_RUBY_PATH_';
const UNREACHABLE=[P+'B3F',P+'B1F_STAIRS',P+'B2F_STAIRS'];
const CHAIN=['MAP_ONE_ISLAND_HARBOR','MAP_ONE_ISLAND','MAP_ONE_ISLAND_KINDLE_ROAD','MAP_MT_EMBER_EXTERIOR',P+'1F',P+'B1F',P+'B2F'];

export async function replayNationalEmberHunt({session,saved,inputs,fixture}){
 const retained=saved.metadata.session;
 assert.equal(retained.mission?.route?.speciesId,SLUGMA,'start from the retained blocked Slugma hunt');
 assert.equal(retained.mission.route.map,P+'B3F');assert.equal(retained.mission.status,'blocked');
 const basePlanner=createCampaignPlanner({...inputs,mechanics:inputs.battle});
 const observer=createFireRedObserver({session,...inputs,runId:fixture.id,observeRng:true,
  storyWatch:{flags:[...basePlanner.storyWatch().flags,...POSTGAME_WATCH.flags,...LINK_QUEST_WATCH.flags],
   variables:[...POSTGAME_WATCH.variables,...LINK_QUEST_WATCH.variables]}});
 const capture=()=>{const o=observer.capture();return {...o,playerMemory:{...o.playerMemory,postgameEvidence:readPostgameEvidence(session,inputs.runtime,o)}};};
 observer.capture();const before=capture();
 assert.equal(before.playerMemory.storyState.variableIds[0x4076]>=4,true,'the Ruby Path door is open in this save');
 assert.ok(!before.playerMemory.trainer.pokedex.ownedSpecies.includes(SLUGMA),'Slugma is still missing');

 // Selection: the real selector against the native observation. Every other
 // species it prefers is deferred with an ordinary per-species retry record.
 const now=Date.now(),dex={failed:structuredClone(retained.postgame?.agenda?.workflows?.dex?.failed??{})},picks=[];
 let task=null;
 for(let i=0;i<400;i++){
  task=selectNationalDexCapture({o:before,world:inputs.world,mechanics:inputs.battle,state:dex,now});
  assert.ok(task,'the selector ran out of candidates before Slugma: '+JSON.stringify(picks));
  picks.push([task.request.speciesId,task.route.map]);
  assert.ok(!UNREACHABLE.includes(task.route.map),`the selector chose an unreachable floor: ${task.request.speciesId} ${task.route.map}`);
  if(task.request.speciesId===SLUGMA)break;
  dex.failed[task.request.speciesId]={retryAt:now+86400000,reason:'Other species are deferred in this isolated Slugma replay.'};dex.target=null;
 }
 assert.equal(task.request.speciesId,SLUGMA);
 assert.equal(task.route.map,P+'B2F','Slugma is hunted on the best reachable floor (B2F, 60%)');
 console.log('# ember-hunt selection '+JSON.stringify({deferred:picks.length-1,route:task.route}));

 const id='postgame-national-collection-ember-replay';
 const open=state=>createSuiteMission({id,request:task.request,route:task.route,state,world:inputs.world,story:inputs.story,mechanics:inputs.battle,fundingPlanner:basePlanner});
 let mission=open(null);mission.initialize(before);
 let objective;
 const planner={...basePlanner,select:()=>objective,selectCollection:()=>null,selectTraining:()=>null,
  selectBattleSquad:()=>[],campaignStatus:()=>({objective:objective?.id}),state:()=>({mission:id,objective})};
 const playerFor=initialState=>createCentralPlayer({campaignPlanner:planner,
  advisors:createPolicyAdvisors({world:inputs.world,mechanics:inputs.battle,campaignPlanner:planner}),
  initialState,mechanics:inputs.battle,huntConfig:mission.capturePolicy(),captureRequirements:mission.captureRequirements()});
 let player=playerFor(null);
 const individuals=o=>[...o.playerMemory.trainer.party,...o.playerMemory.trainer.storage.pokemon].filter(p=>p.validity==='valid').map(encounterFingerprint).sort();
 const original=individuals(before),visited=[],restarted=new Set();
 const b2f=inputs.world.data.maps.find(m=>m.id===P+'B2F');
 const grass=new Set(b2f.layout.cells.filter(c=>Number(c.collision)===0&&Number(c.encounterType)===1).map(c=>`${c.x},${c.y}`));
 const deadline=Date.now()+(fixture.minutes??30)*60000;let last='',after=before,waiting=null;
 for(let i=0;i<120000&&Date.now()<deadline;i++){
  after=capture();const m=after.playerMemory,map=m.map?.id;
  if(map&&visited.at(-1)!==map)visited.push(map);
  assert.ok(!UNREACHABLE.includes(map),'the hunt entered an unreachable floor: '+map);
  const field=after.phase==='stable'&&after.emulator.mode==='overworld'&&!after.emulator.inBattle&&!Object.values(m.ui??{}).some(Boolean);
  const next=mission.inspect(after);
  const trace=JSON.stringify([map,m.position,next.kind,next.objective?.id,mission.state.phase]);
  if(trace!==last&&(map!==JSON.parse(last||'[null]')[0]||process.env.SUITE_REPLAY_TRACE==='1'))console.log('# ember-hunt '+after.frame+' '+trace);
  last=trace;
  const slugma=after.emulator.inBattle&&m.encounter?.kind==='wild'&&m.encounter.pokemon?.species===SLUGMA;
  // Arrival: the player stands on a B2F encounter cell, or the hunt has handed
  // the reached B2F field to its hunting phase (the RNG land method).
  const arrived=field&&map===P+'B2F'&&(grass.has(`${m.position?.x},${m.position?.y}`)||next.kind==='rng'&&mission.state.phase==='hunting');
  if(slugma||arrived){
   const chain=CHAIN.slice(0,slugma?CHAIN.indexOf(map)+1:CHAIN.length),order=chain.map(step=>visited.indexOf(step));
   for(const [i,step] of chain.entries())assert.ok(order[i]>=0,'the route passed through '+step+': '+JSON.stringify(visited));
   assert.deepEqual([...order].sort((a,b)=>a-b),order,'the route reached the chain in order: '+JSON.stringify(visited));
   assert.ok(restarted.has('exterior'),'the hunt survived reconstruction on the Mt. Ember exterior');
   assert.deepEqual(individuals(after),original,'travel preserves every individual');
   assert.equal(m.gameStats.savedGame,before.playerMemory.gameStats.savedGame,'the trip does not write a native save');
   assert.equal(mission.state.route.map,P+'B2F');
   console.log('# ember-hunt verified '+JSON.stringify({result:slugma?'slugma-encounter':grass.has(`${m.position?.x},${m.position?.y}`)?'b2f-encounter-cell':'b2f-hunting-phase',
    map,position:m.position,phase:mission.state.phase,frames:after.frame-before.frame,visited}));
   return {before,after};
  }
  if(next.kind==='stop')assert.fail('the hunt stopped: '+next.reason);
  if(next.kind==='wait'){for(let n=0;n<8;n++)session.step([]);continue;}
  assert.ok(['policy','recommendation'].includes(next.kind),'unexpected hunt step before the encounter floor: '+JSON.stringify(next).slice(0,300));
  if(next.objective){
   // The worker's own stall detector ended every live attempt at One Island Harbor.
   const cycle=observeNavigationCycle({observation:after,objective:next.objective,state:mission.state.navigationWatch??={}});
   assert.equal(cycle,null,'the hunt stalled: '+JSON.stringify(cycle));
   objective=resolveFireRedTravel(next.objective,after,inputs.world);
  }
  // Rebuild the mission and player from their serialized state once at the
  // Mt. Ember exterior: the staged door route must be retained, not in-memory.
  if(field&&map==='MAP_MT_EMBER_EXTERIOR'&&!restarted.has('exterior')){
   mission.checkpoint?.();mission=open(JSON.parse(JSON.stringify(mission.state)));
   player=playerFor(JSON.parse(JSON.stringify(player.state())));restarted.add('exterior');
  }
  const decision=player.decide(after);
  assert.ok(!['blocked','complete'].includes(decision.kind),'the hunt player stopped: '+decision.reason+' at '+JSON.stringify([map,m.position,objective?.target]));
  // Kindle Road's walking Black Belts can close its one-tile crossings for a
  // few frames; the player waits them out. A route that stays unsupported (the
  // unfixed harbor stop) fails after 30 seconds of game time.
  if(decision.winner?.recommendation?.kind==='wait-for-supported-objective'){
   waiting??=after.frame;
   assert.ok(after.frame-waiting<=1800,'no supported route for 1800 frames: '+JSON.stringify({map,position:m.position,target:objective?.target}));
  }else waiting=null;
  const action=decision.action??{buttons:[],holdFrames:8};
  for(let n=0;n<(action.holdFrames??1);n++)session.step(action.buttons??[]);
  for(let n=0;n<(action.releaseFrames??0);n++)session.step([]);
  if(i%200===0)await yieldIO();
 }
 throw Error('The Slugma hunt did not reach a Ruby Path B2F encounter cell: '+JSON.stringify({map:after.playerMemory.map?.id,position:after.playerMemory.position,visited}));
}
