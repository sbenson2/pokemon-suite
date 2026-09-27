import assert from 'node:assert/strict';
import {spawn} from 'node:child_process';
import {createServer} from 'node:net';
import {mkdtempSync,readFileSync,rmSync,writeFileSync,existsSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {dirname,join,resolve} from 'node:path';
import {fileURLToPath} from 'node:url';
import {setTimeout as sleep} from 'node:timers/promises';
import {SaveVault,atomicJson} from '../engine/firered/src/suite/save-vault.js';
import {createFireRedObserver} from '../engine/firered/src/evidence/fire-red-observer.js';
import {createCampaignPlanner} from '../engine/firered/src/player/campaign.js';
import {POSTGAME_WATCH,PostgameAgenda,readPostgameEvidence} from '../engine/firered/src/suite/postgame-agenda.js';

const json=p=>JSON.parse(readFileSync(p));
const port=()=>new Promise((done,fail)=>{const server=createServer();server.on('error',fail);server.listen(0,'127.0.0.1',()=>{const n=server.address().port;server.close(()=>done(n));});});

// Goal requests (G2), the handoff leg of "new game → Hall of Fame → target".
// A full campaign is too long for a gate, so this starts from the verified
// completed-campaign save (Hall of Fame entered, saved, playable postgame). The
// goal supervisor restarts with the goal's persisted state: it had started this
// campaign and queued a shiny Zapdos hunt after it. The owner continues into
// the postgame by itself (afterCampaign); the real supervisor must mark the
// campaign done, save the hunt request in the one request database and hand it
// to the running postgame as its priority target (postgame-goal +
// priorityTarget, the G1 contract). The agenda must hand off that hunt, under
// the request's own identity, before any checklist hunt.
const LABEL='Goal new save';
export async function replayGoalPostgameHandoff({session,saved,inputs,cfg,fixture,corpusPath}){
 const campaign=saved.metadata.campaign,run=campaign.record.id;
 assert.equal(campaign.state.status,'complete','the checkpoint holds a completed campaign');
 assert.equal(campaign.state.completion?.playablePostgame,true);
 const base=createCampaignPlanner({...inputs,mechanics:inputs.battle}).storyWatch();
 const watch={...base,flags:[...new Set([...base.flags,...POSTGAME_WATCH.flags,2092,703])],variables:[...new Set([...(base.variables??[]),...POSTGAME_WATCH.variables])]};
 const observer=createFireRedObserver({session,...inputs,runId:'goal-supervisor-postgame-handoff',storyWatch:watch}),before=observer.capture();
 assert.equal(before.playerMemory.storyState.flagIds[2092],true,'the Hall of Fame is entered');
 assert.equal(before.playerMemory.storyState.flagIds[703],false,'Zapdos is unused');
 const root=mkdtempSync(join(tmpdir(),'suite-goal-handoff-')),game=join(root,'firered');
 const source=resolve(dirname(corpusPath),fixture.baseCheckpoint),baseRecord=json(source);
 const baseSave=new SaveVault(dirname(source),baseRecord.identity).read(baseRecord);
 new SaveVault(join(game,'saves'),baseSave.identity).write(baseSave.state,baseSave.sram,baseSave.metadata);
 // The campaign's own save profile, exactly as start-campaign creates it.
 new SaveVault(join(game,'hunts',run,'native-radio','saves'),saved.identity).write(saved.state,saved.sram,saved.metadata);
 atomicJson(join(game,'active-hunt.json'),{id:run,manual:true,label:LABEL,nativeRadio:true});
 atomicJson(join(game,'bot-policy.json'),{enabled:true,mode:'campaign',consolePowered:true,runScope:'campaign',awaitingCommand:false});
 const worker=fileURLToPath(new URL('../engine/firered/src/suite/session-worker.js',import.meta.url));
 atomicJson(join(root,'config.json'),{schema:'pokemon-suite/config/v1',directory:root,node:process.execPath,worker,
  researchBots:fileURLToPath(new URL('../engine/shared',import.meta.url)),games:{firered:{...cfg,port:await port(),nativeRadio:{...cfg.nativeRadio,huntId:run}}}});
 const env={...process.env};for(const key of ['POKEMON_SUITE_UPDATE_HOLD','POKEMON_SUITE_MANUAL_LAUNCH','POKEMON_SUITE_DESKTOP_NODE'])delete env[key];
 let child=null,driver=null,log='',driverLog='',sequence=0;
 const status=()=>{try{return json(join(game,'status.json'));}catch{return null;}};
 const goal=()=>{try{return json(join(root,'goals.json')).goals[0]??null;}catch{return null;}};
 const seen={missions:[],pending:[],objectives:[]};
 const note=(list,value)=>{if(value&&list.at(-1)!==value)list.push(value);};
 let rid=null,handedOff=false;
 // From the moment the owner reports the goal's target, nothing else may start first.
 const observe=s=>{if(!s||!handedOff)return;note(seen.pending,s.pendingHunt?.id);note(seen.missions,s.mission?.id);if(s.phase==='postgame')note(seen.objectives,s.bot?.objective?.id);
  const other=[...seen.pending,...seen.missions].find(id=>id!==rid);
  assert.equal(other,undefined,`another hunt started before the goal's priority target: ${JSON.stringify(seen)}`);
  const hunt=seen.objectives.find(id=>/^postgame-hunt-/.test(id)&&id!=='postgame-hunt-zapdos');
  assert.equal(hunt,undefined,`the agenda selected another entry first: ${JSON.stringify(seen)}`);};
 const alive=()=>{if(child?.exitCode!==null)throw Error('Worker exited: '+log.slice(-3000));if(driver&&driver.exitCode!==null)throw Error('Goal supervisor exited: '+driverLog.slice(-3000));};
 const wait=async(predicate,label,{ms=60000,stallMs=0,progress=null}={})=>{
  const until=Date.now()+ms;let marker=null,markerAt=Date.now();
  while(Date.now()<until){
   alive();const s=status(),g=goal();observe(s);if(s&&predicate(s,g))return s;
   if(progress){const next=progress(s,g);if(next!==marker){marker=next;markerAt=Date.now();}
    if(Date.now()-markerAt>stallMs)throw Error(label+` (no progress for ${stallMs}ms): `+JSON.stringify({map:s?.map,mission:s?.mission,bot:s?.bot,goal:g?.progress,seen})+' '+log.slice(-1500));}
   await sleep(100);
  }
  const s=status(),g=goal();throw Error(label+': '+JSON.stringify({map:s?.map,bot:s?.bot,mission:s?.mission,priority:s?.postgame?.priorityTarget,commandError:s?.commandError,goal:g?.progress,lastError:g?.execution?.lastError,seen})+' '+log.slice(-1500)+' '+driverLog.slice(-1500));
 };
 const command=async body=>{
  const commandId='goal-handoff-'+(++sequence);atomicJson(join(game,'command.json'),{...body,commandId,sessionId:status().sessionId});
  if(body.type==='shutdown'){
   const exited=await Promise.race([new Promise(done=>child.once('exit',done)),sleep(20000,null,{ref:false})]);
   assert.equal(exited,0,'the worker must retire cleanly');child=null;return null;
  }
  const s=await wait(s=>s.lastCommand===commandId,'command '+body.type,{ms:120000});assert.equal(s.commandError,null,`${body.type}: ${s.commandError}`);return s;
 };
 let after;
 try{
  child=spawn(process.execPath,[worker,join(root,'config.json'),'firered'],{env,stdio:['ignore','pipe','pipe']});
  for(const stream of [child.stdout,child.stderr])stream.on('data',b=>{log=(log+b).slice(-12000);});
  await wait(s=>s.pid===child.pid,'the owner never published its status');
  // The completed campaign continues into the postgame by itself.
  const handed=await wait(s=>s.bot?.runScope==='postgame'&&s.campaign?.status==='complete','the completed campaign did not continue into the postgame',{ms:180000});
  assert.equal(handed.campaign.id,run);
  // The persisted goal: new save + campaign (already started) -> shiny Zapdos.
  const request={schema:'pokemon-suite/farming-request/v1',game:'firered',speciesId:145,quantity:1,locationId:'any',shiny:'required',natures:[],gender:'any',abilityId:null,
   ball:{id:'any',requirement:'preferred'},minIvs:{},minDvs:{},encounterLevel:{min:1,max:100},finalLevel:null,moves:[],heldItemId:null,
   limits:{maxEncounters:1000,maxMinutes:240,minBalls:10,maxSpend:999999},afterCompletion:'stop-save'};
  writeFileSync(join(root,'goal-request.json'),JSON.stringify({schema:'pokemon-suite/goal/v1',source:{text:'on a new save, get me a shiny Zapdos',via:'voice',interpreter:{parser:'deterministic',confidence:1}},
   game:'firered',save:{mode:'new',trainerName:null,starter:null,label:LABEL},steps:[{kind:'farming',request}],then:'standing-goals',idempotencyKey:'replay-goal-postgame-handoff'}));
  const startedAt=new Date(Date.now()-3600000).toISOString();
  writeFileSync(join(root,'goal-seed.json'),JSON.stringify({status:'running',execution:{save:{decision:'new',reason:'A new save was requested.',resolvedAt:startedAt},
   plan:[{kind:'campaign',settings:{label:LABEL,afterCampaign:'postgame'},implicit:true},{kind:'farming',request}],
   steps:[{status:'running',started:true,previewId:run,campaignId:run,startedAt},{status:'pending'}],before:{collection:null,runScope:'task',awaitingCommand:true}}}));
  driver=spawn(process.env.PYTHON??'python3',['-u',fileURLToPath(new URL('./goal-supervisor-replay.py',import.meta.url)),root,join(root,'goal-request.json'),join(root,'goal-seed.json')],
   {cwd:fileURLToPath(new URL('..',import.meta.url)),env,stdio:['ignore','pipe','pipe']});
  for(const stream of [driver.stdout,driver.stderr])stream.on('data',b=>{driverLog=(driverLog+b).slice(-12000);});
  // The supervisor marks the campaign done and hands the hunt to the postgame.
  const priority=await wait((s,g)=>{
   if(g?.execution?.lastError)throw Error('The goal could not hand off its hunt: '+g.execution.lastError);
   rid??=g?.execution?.steps?.[1]?.requestId??null;
   handedOff=Boolean(rid&&s.postgame?.priorityTarget?.requestId===rid);return handedOff;},'the supervisor did not hand the hunt to the postgame',{ms:180000});
  // The supervisor records the mode once the owner acknowledged the command.
  await wait((s,g)=>g?.execution?.steps?.[1]?.mode==='priority','the goal did not record the priority hand-off',{ms:30000});
  let g=goal();
  assert.equal(g.execution.steps[0].status,'done','the Hall of Fame completes the campaign step');
  assert.equal(g.execution.save.trainerId,priority.gameProgress.trainerId,'later steps are pinned to the new save');
  assert.equal(g.execution.steps[1].mode,'priority');
  assert.equal(priority.postgame.priorityTarget.id,'zapdos');assert.equal(priority.postgame.priorityTarget.shiny,'required');
  assert.deepEqual(priority.postgame.priorityTarget.request,request,'the saved request travels with the target');
  // Then the owner's postgame acts. Its care first plans a supply basket at the
  // League clerk priced to the cash reserve and catches National Dex species on
  // the way. Until G2b the first catch made the retained basket stale and care
  // stopped for review ("The retained supply basket exceeds the remaining
  // spending limit or cash reserve."): that stop now fails the case. The owner
  // must re-derive the basket (nothing bought) and keep travelling past Route 22
  // with the goal's target ('supply-trip'), or start the priority hunt under the
  // request's identity ('hunt-started'), or stop for another reason, which the
  // goal must report and never override ('postgame-stop'). On this save the trip
  // later spends every capture ball on National Dex captures and meets the
  // designed empty-ball capture stop in Victory Road (see NOTES), so the case
  // ends with 'supply-trip' once the stale-basket leg is proven.
  const past=new Set(['MAP_ROUTE23','MAP_VICTORY_ROAD_1F','MAP_VICTORY_ROAD_2F','MAP_VICTORY_ROAD_3F','MAP_INDIGO_PLATEAU_EXTERIOR','MAP_INDIGO_PLATEAU_POKEMON_CENTER_1F']);
  const retained=care=>care?.active?.kind==='shop'?care.active:care?.suspendedShopping??care?.deferredShopping?.task??null;
  let basket=null,lastRead=0;
  const outcome=await wait(s=>{
   if(s.mission?.id===rid&&s.mission.state==='running'||s.bot?.status==='blocked')return true;
   if(Date.now()-lastRead<1000)return false;lastRead=Date.now();
   try{basket=retained(json(join(game,'postgame-agenda.json')).fieldCare);}catch{basket=null;}
   return past.has(s.map)&&basket?.replanned>=1&&basket.observedSpent===0;
  },'neither the supply trip past Route 22, the priority hunt nor a postgame stop',
   // Progress also counts battle damage and catches (long capture battles on the supply trip).
   {ms:2700000,stallMs:300000,progress:s=>JSON.stringify([s?.map,s?.position,s?.mode,s?.observation?.party?.map(p=>p.hp),s?.spectator?.trainer?.pokedex?.owned,s?.bot?.objective?.id,s?.bot?.status,s?.observation?.money,s?.pendingHunt?.id,s?.mission?.id])});
  const hunted=outcome.mission?.id===rid,stopped=!hunted&&outcome.bot?.status==='blocked';
  const result=hunted?'hunt-started':stopped?'postgame-stop':'supply-trip';
  if(stopped){
   assert.notEqual(outcome.bot.reason,'The retained supply basket exceeds the remaining spending limit or cash reserve.',
    `the stale supply basket stopped the postgame: ${JSON.stringify({map:outcome.map,money:outcome.observation?.money,objective:outcome.bot?.objective})}`);
   assert.equal(seen.missions.length+seen.pending.length,0,'no hunt started before the stop');
   await wait((s,g)=>g?.progress?.phase==='attention','the goal did not report the postgame stop',{ms:60000});
   g=goal();assert.equal(g.status,'waiting');assert.ok(g.progress.detail.includes(outcome.bot.reason.replace(/\.$/,'')),g.progress.detail);
   await sleep(3000);assert.equal(goal().execution.steps[1].starts,1,'the stop is never overridden: the target was sent once');
  }else if(hunted){
   assert.equal(outcome.mission.method,'static');assert.equal(outcome.mission.name,'Zapdos');assert.equal(outcome.mission.shiny,'required');
   await wait((s,g)=>g?.progress?.phase==='hunting','the goal did not report the hunt',{ms:60000});
   g=goal();assert.equal(g.status,'running');assert.match(g.progress.detail,/Zapdos/);
  }else{
   // The owner still travels with the goal's target; nothing else started.
   assert.equal(seen.missions.length+seen.pending.length,0,'no hunt started during the supply trip');
   assert.equal(outcome.postgame?.priorityTarget?.requestId,rid,'the running postgame still holds the goal target');
   g=goal();assert.equal(g.status,'running');assert.equal(g.progress.phase,'postgame-priority');
   assert.equal(g.execution.steps[1].starts,1,'the target was sent once');
  }
  assert.ok(outcome.observation?.money>=10000,'the supply trip kept the cash reserve');
  driver.kill('SIGTERM');await Promise.race([new Promise(done=>driver.once('exit',done)),sleep(5000,null,{ref:false})]);driver=null;
  // Stop at a settled field (gate 109-02: a plain Stop left the stop-time
  // checkpoint mid-transition, so the stable-frame read below never settled).
  // The owner's own handoff boundary, the one software updates use, holds it at
  // its next stable overworld frame with no battle, menu, pending save or
  // unsaved capture; it then retires from there. Every check below is unchanged.
  await command({type:'prepare-update',updateId:'goal-handoff-settled-stop'});
  await wait(s=>s.runtime?.update?.held===true,'the owner never reached a settled field to stop',
   {ms:900000,stallMs:300000,progress:s=>JSON.stringify([s?.frame>>12,s?.map,s?.mode])});
  await command({type:'shutdown'});
  const agenda=json(join(game,'postgame-agenda.json'));
  assert.equal(agenda.priorityTarget?.requestId,rid,'the durable agenda keeps the goal target');
  assert.equal(agenda.priorityTarget.id,'zapdos');assert.deepEqual(agenda.priorityTarget.request,request);
  assert.equal(agenda.continuation?.campaignId,run,'the postgame continues the goal’s campaign');
  assert.equal(existsSync(join(root,'farming','requests.sqlite3')),true);
  const active=json(join(game,'active-hunt.json'));
  const final=new SaveVault(join(game,'hunts',active.id,'native-radio','saves'),saved.identity).read();
  if(hunted){
   assert.equal(active.id,rid);assert.equal(agenda.hunts?.zapdos?.id,rid);
   assert.equal(final.metadata.session.id,rid);assert.equal(final.metadata.session.mission.postgameObjective,'zapdos');
  }
  session.loadSram(final.sram);session.loadState(final.state);after=observer.capture();
  // Story flags are read from a stable frame (a paused owner can stop mid-transition).
  for(let n=0;n<600&&after.phase!=='stable';n++){session.step([]);after=observer.capture();}
  assert.equal(after.phase,'stable');
  assert.equal(after.playerMemory.storyState.flagIds[703],false,'the encounter is still unused');
  // Once care allows an objective, the durable agenda selects the goal's target
  // before every checklist entry (real engine selection on the saved state).
  const evidence={...after,playerMemory:{...after.playerMemory,postgameEvidence:readPostgameEvidence(session,inputs.runtime,after)}};
  const selection=new PostgameAgenda(agenda).select(evidence,Date.now(),{partnerAvailable:false});
  assert.equal(selection?.id,'zapdos','the priority target comes first');assert.equal(selection.priority,true);
  console.log('# goal-supervisor-postgame-handoff '+JSON.stringify({run,requestId:rid,outcome:result,reason:stopped?outcome.bot.reason:null,reachedMap:outcome.map,
   basket:basket?{cost:basket.cost,replanned:basket.replanned,observedSpent:basket.observedSpent,items:basket.objective.target.items}:null,
   map:after.playerMemory.map.id,frames:after.frame-before.frame,seen,goal:{status:g.status,phase:g.progress.phase}}));
 }finally{
  if(driver&&driver.exitCode===null)driver.kill('SIGKILL');
  if(child&&child.exitCode===null){child.kill('SIGTERM');await Promise.race([new Promise(done=>child.once('exit',done)),sleep(15000,null,{ref:false})]);if(child.exitCode===null)child.kill('SIGKILL');}
  if(process.env.SUITE_REPLAY_KEEP==='1')console.log('# retained private replay '+root);else rmSync(root,{recursive:true,force:true});
 }
 return {before,after};
}
