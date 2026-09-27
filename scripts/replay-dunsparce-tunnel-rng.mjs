import assert from 'node:assert/strict';
import {createSuiteMission} from '../engine/firered/src/suite/mission.js';
import {createFireRedObserver} from '../engine/firered/src/evidence/fire-red-observer.js';
import {createCampaignPlanner} from '../engine/firered/src/player/campaign.js';
import {createAutonomousEmulator} from '../engine/firered/src/emulator/autonomous-emulator.js';
import {LINK_QUEST_WATCH} from '../engine/firered/src/suite/fire-red-link-quest.js';
import {BALL_SHOP_WATCH} from '../engine/firered/src/suite/ball-supplies.js';
import {POSTGAME_WATCH,readPostgameEvidence} from '../engine/firered/src/suite/postgame-agenda.js';
import {selectNationalDexCapture} from '../engine/firered/src/suite/national-dex-agenda.js';
import {buildWildRngPlan,executeRngPlan} from '../engine/firered/src/rng/wild-search.js';
import {readSafariStatus} from '../engine/firered/src/suite/safari-mission.js';
import {encounterFingerprint} from '../engine/firered/src/player/encounter-tracker.js';
import {digest} from '../engine/firered/src/suite/save-vault.js';

// Live September 25-26: the National Dex collection hunted Dunsparce on Three
// Isle Port about 195 times. The Port's only land cells (the tall grass at
// x31-36, y6-8) are reached through the Dunsparce Tunnel, which the cartridge's
// ON_TRANSITION script digs out once the National Dex is enabled; the static
// knowledge keeps the walled layout. Every RNG trial waited at the harbor door
// until "RNG menu navigation exceeded its budget" (about two minutes with the
// owner held still), and the agenda retried the same hunt every few minutes.
// This case starts from hunt f4180987's own stop commit, whose state and SRAM
// are its RNG plan source (Three Isle Port 12,13, just off the ferry). The real
// selector must keep Dunsparce on the Port with an exact route to its grass,
// the real mission must hand the reached map to RNG planning, and the real
// planner must build a verified input plan in isolated trials observed with
// the worker's own trial watch (the campaign story watch alone). The owner then
// runs the plan through the worker's frame-exact executor: it must walk Port ->
// tunnel -> Port and meet a wild Dunsparce on a Port grass cell, never opening
// a menu inside the encounter-less tunnel, with every individual kept and no
// native save written. Only controller inputs are used.
const DUNSPARCE=206,PORT='MAP_THREE_ISLAND_PORT',TUNNEL='MAP_THREE_ISLAND_DUNSPARCE_TUNNEL';
const LIVE_STOP='RNG menu navigation exceeded its budget';

export async function replayDunsparceTunnelRng({session,saved,inputs,fixture,createSession}){
 const retained=saved.metadata.session;
 assert.equal(saved.metadata.reason,LIVE_STOP,'start from the live stop of this RNG plan source');
 assert.equal(retained.mission?.route?.speciesId,DUNSPARCE,'start from the retained Dunsparce hunt');
 assert.deepEqual([retained.mission.route.map,retained.mission.phase,retained.mission.status,retained.mission.reason],[PORT,'planning-rng','blocked',LIVE_STOP]);
 const basePlanner=createCampaignPlanner({...inputs,mechanics:inputs.battle});
 const open=state=>createSuiteMission({id:retained.id,request:retained.request,route:retained.mission.route,state,world:inputs.world,story:inputs.story,mechanics:inputs.battle,fundingPlanner:basePlanner});
 let mission=open(null);
 // The owner's observer for a hunt, as session-worker.js renewObserver builds it.
 const watch=basePlanner.storyWatch();
 const observer=createFireRedObserver({session,...inputs,runId:fixture.id,observeRng:true,storyWatch:{...watch,
  variables:[...new Set([...watch.variables,...LINK_QUEST_WATCH.variables,...BALL_SHOP_WATCH.variables,...POSTGAME_WATCH.variables])],
  flags:[...new Set([...watch.flags,...LINK_QUEST_WATCH.flags,...BALL_SHOP_WATCH.flags,...POSTGAME_WATCH.flags,...mission.storyWatch().flags,84,128,573,611,2092,2112,2116])]}});
 const capture=()=>{const o=observer.capture();return {...o,playerMemory:{...o.playerMemory,postgameEvidence:readPostgameEvidence(session,inputs.runtime,o)}};};
 const before=capture(),m=before.playerMemory;
 assert.equal(before.phase,'stable');
 assert.deepEqual([m.map.id,m.position.x,m.position.y],[PORT,12,13],'the ferry landing, west of the tunnel');
 assert.equal(m.storyState.flagIds[2112],true,'the National Dex is enabled in this save');
 assert.ok(!m.trainer.pokedex.ownedSpecies.includes(DUNSPARCE),'Dunsparce is still missing');
 assert.ok(m.trainer.party.some(p=>!p.isEgg&&p.moves?.includes(230)),'a Sweet Scent user is in the party');

 // Selection: the real selector on the native observation, once the retained
 // retry record for this table is due.
 const task=selectNationalDexCapture({o:before,world:inputs.world,mechanics:inputs.battle,state:{failed:{}}});
 assert.deepEqual([task?.request.speciesId,task?.route.map,task?.route.method],[DUNSPARCE,PORT,'wild-land'],'the selector keeps the Three Isle Port table');
 assert.deepEqual(task.request,retained.request,'the live hunt request');

 // Hand-off: the reached map starts RNG planning, as session-worker.js does. The
 // checkpoint was persisted after the live inspect passed its repaint check.
 mission.initialize(before);
 const next=mission.inspect(before);
 assert.equal(next.kind,'rng',JSON.stringify(next).slice(0,300));assert.equal(mission.state.phase,'hunting');
 // A restart rebuilds the hunt from its serialized state and hands off again.
 mission=open(JSON.parse(JSON.stringify(mission.state)));
 assert.equal(mission.inspect(before).kind,'rng','the rebuilt hunt hands the reached map to RNG planning');

 // Planning: isolated trials from the retained bytes, observed exactly like the
 // worker's trial observer (basePlanner.storyWatch() only).
 const source={stateSha256:saved.stateSha256,sramSha256:saved.sramSha256};
 const trials=[],started=Date.now();let reported='';
 let plan;
 try{
  plan=await buildWildRngPlan({game:'firered',area:mission.state.route.map,speciesId:mission.nativeSpecies,request:retained.request,source,profile:null,
   openTrial:async()=>{
    const check=await createSession();trials.push(check);check.loadSram(saved.sram);check.loadState(saved.state);
    const trial=createFireRedObserver({session:check,...inputs,observeRng:true,runId:'suite-rng-qualification',storyWatch:basePlanner.storyWatch()});
    return {session:check,observer:trial,inputs,commit:source,capture:()=>{const o=trial.capture();return {...o,playerMemory:{...o.playerMemory,safari:readSafariStatus(check,inputs.runtime,o.emulator.inBattle?o.playerMemory.battleTypeFlags:0)}};}};
   },onProgress:event=>{const line=JSON.stringify([event.method,event.phase]);if(line!==reported){reported=line;console.log('# dunsparce-tunnel-rng planning '+JSON.stringify(event).slice(0,240));}}});
 }finally{for(const trial of trials)trial.close();}
 console.log('# dunsparce-tunnel-rng plan '+JSON.stringify({method:plan.method,steps:plan.steps.length,frames:plan.estimatedFrames,trials:trials.length,ms:Date.now()-started}));
 assert.equal(plan.verified,true);assert.equal(plan.verifiedRepeats,2);assert.equal(plan.pokemon.species,DUNSPARCE);
 assert.equal(before.playerMemory.storyState.variableIds[0x404e],0x6258,'the owner observation proves the dug-out layout');
 // The worker persists the plan as JSON and executes the persisted plan.
 plan=JSON.parse(JSON.stringify(plan));

 // Execution on the owner's cartridge through the worker's frame-exact executor
 // (a hunt owns every frame; a held button stops when [inBattle, callback2]
 // changes). A virtual clock paces it; only the plan's inputs reach the game.
 let now=0,id=0;const jobs=new Map(),interrupts=[],visited=[];let where=null,tunnelMenus=0;
 const emulator=createAutonomousEmulator({session,emulationSpeed:10,frameExact:true,videoFramesPerSecond:1,
  clock:()=>now,schedule(callback,delay){const n=++id;jobs.set(n,{callback,at:now+delay});return n;},cancel:n=>jobs.delete(n),
  actionObservation:()=>capture(),controllerState:()=>observer.captureControllerState()});
 const observe=()=>{
  const o=capture(),map=o.playerMemory.map?.id,ui=o.playerMemory.ui??{};
  if(map&&visited.at(-1)!==map)visited.push(map);
  if(map===TUNNEL&&(ui.startMenu||ui.party||ui.bag))tunnelMenus++;
  if(!o.emulator.inBattle)where={map,...o.playerMemory.position};
  return o;
 };
 const execute=async action=>{
  let done=false,result,error;
  emulator.execute(action).then(value=>{result=value;done=true;},reason=>{error=reason;done=true;});
  for(let n=0;n<100000&&!done;n++){
   await Promise.resolve();if(done)break;
   const [key,job]=[...jobs].sort((a,b)=>a[1].at-b[1].at)[0]??[];
   assert.ok(job,'the guarded action remains scheduled');jobs.delete(key);now=job.at;job.callback();
  }
  assert.ok(done,'the guarded action finished');if(error)throw error;
  if(result?.interrupted)interrupts.push({frames:result.endFrame-result.startFrame,hold:action.holdFrames,buttons:action.buttons,reason:result.interrupted});
  return result;
 };
 let result;
 try{result=await executeRngPlan({plan,source,observe,execute});}finally{emulator.close();}
 const after=capture();
 assert.ok(['protected-target','protected-shiny'].includes(result.status),JSON.stringify({status:result.status,completed:result.completed,visited,interrupts}));
 assert.equal(result.pokemon.species,DUNSPARCE);assert.equal(encounterFingerprint(result.pokemon),encounterFingerprint(plan.pokemon));
 assert.ok(after.emulator.inBattle&&after.playerMemory.encounter?.pokemon?.species===DUNSPARCE,'the wild Dunsparce battle is live');
 assert.deepEqual(visited,[PORT,TUNNEL,PORT],'the inputs walked through the dug-out tunnel');
 assert.equal(tunnelMenus,0,'no menu opened inside the encounter-less tunnel');
 const cell=inputs.world.data.maps.find(x=>x.id===PORT).layout.cells.find(c=>c.x===where.x&&c.y===where.y);
 assert.equal(where.map,PORT);assert.deepEqual([cell?.encounterType,cell?.behaviorName],[1,'MB_TALL_GRASS'],'the encounter began on Three Isle Port grass: '+JSON.stringify(where));
 const individuals=o=>[...o.playerMemory.trainer.party,...o.playerMemory.trainer.storage.pokemon].filter(p=>p.validity==='valid').map(encounterFingerprint).sort();
 assert.deepEqual(individuals(after),individuals(before),'every individual is kept');
 assert.equal(after.playerMemory.gameStats.savedGame,before.playerMemory.gameStats.savedGame,'no native save');
 assert.equal(digest(Buffer.from(session.saveSram())),saved.sramSha256,'the native save is unchanged');
 console.log('# dunsparce-tunnel-rng verified '+JSON.stringify({status:result.status,method:plan.method,visited,encounter:where,level:result.pokemon.level,
  personality:result.pokemon.personality,frames:after.frame-before.frame,interrupts:interrupts.length}));
 return {before,after};
}
