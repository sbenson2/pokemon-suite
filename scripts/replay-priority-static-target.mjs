import assert from 'node:assert/strict';
import {spawn} from 'node:child_process';
import {existsSync,mkdtempSync,readFileSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {dirname,join,resolve} from 'node:path';
import {fileURLToPath} from 'node:url';
import {setTimeout as sleep} from 'node:timers/promises';
import {SaveVault,atomicJson} from '../engine/firered/src/suite/save-vault.js';
import {createFireRedObserver} from '../engine/firered/src/evidence/fire-red-observer.js';
import {createCampaignPlanner} from '../engine/firered/src/player/campaign.js';
import {POSTGAME_WATCH} from '../engine/firered/src/suite/postgame-agenda.js';

// Goal requests (G1). The September 17 live save stands in the Saffron Dojo
// after the Hitmonlee gift: League, National Dex and Celio's link are done and
// all four static legendaries are unused. Its durable agenda has already
// reserved the fossil revival, and the fixed checklist would run it first.
// "Get me a shiny Mewtwo" arrives as postgame-goal with a priority target. The
// agenda must select Mewtwo ahead of every checklist entry, start the shiny
// static hunt under the request's own identity (keeping the save label), travel
// to Cerulean Cave B1F, save the pre-encounter anchor and reach the first
// encounter reset. No other checklist hunt may start first.
const REQUEST_ID='priority-mewtwo-replay';
const LABEL='Priority static replay';
export async function replayPriorityStaticTarget({session,saved,inputs,cfg,fixture,corpusPath}){
 const owner=saved.metadata.session.id,agenda=saved.metadata.session.postgame.agenda;
 assert.equal(saved.metadata.session.mission.status,'complete','the checkpoint holds the completed Dojo gift');
 assert.equal(agenda.enabled,true);assert.ok(agenda.hunts.fossils?.id,'the checklist already reserved the fossil revival');
 for(const id of ['mewtwo','articuno','zapdos','moltres'])assert.equal(agenda.entries.find(e=>e.id===id).status,'pending',id);
 const fossils=agenda.hunts.fossils.id;
 const base=createCampaignPlanner({...inputs,mechanics:inputs.battle}).storyWatch();
 const watch={...base,flags:[...new Set([...base.flags,...POSTGAME_WATCH.flags])],variables:[...new Set([...(base.variables??[]),...POSTGAME_WATCH.variables])]};
 const observer=createFireRedObserver({session,...inputs,runId:'priority-static-target',storyWatch:watch}),before=observer.capture();
 assert.equal(before.playerMemory.storyState.flagIds[700],false,'Mewtwo is unused');
 assert.equal(before.playerMemory.storyState.flagIds[2116],true,'Celio’s link is complete');
 const request={schema:'pokemon-suite/farming-request/v1',game:'firered',speciesId:150,quantity:1,locationId:'any',shiny:'required',natures:[],gender:'any',abilityId:null,
  ball:{id:'any',requirement:'preferred'},minIvs:{},minDvs:{},encounterLevel:{min:1,max:100},finalLevel:null,moves:[],heldItemId:null,
  limits:{maxEncounters:1000,maxMinutes:240,minBalls:10,maxSpend:999999},afterCompletion:'stop-save'};
 const root=mkdtempSync(join(tmpdir(),'suite-priority-static-')),game=join(root,'firered');
 const source=resolve(dirname(corpusPath),fixture.baseCheckpoint),baseRecord=JSON.parse(readFileSync(source));
 const baseSave=new SaveVault(dirname(source),baseRecord.identity).read(baseRecord);
 new SaveVault(join(game,'saves'),baseSave.identity).write(baseSave.state,baseSave.sram,baseSave.metadata);
 new SaveVault(join(game,'hunts',owner,'native-radio','saves'),saved.identity).write(saved.state,saved.sram,saved.metadata);
 atomicJson(join(game,'active-hunt.json'),{id:owner,nativeRadio:true,label:LABEL});
 // The user's owner is ready for commands (no automatic continuation first).
 atomicJson(join(game,'bot-policy.json'),{enabled:true,mode:'postgame',consolePowered:true,runScope:'postgame',awaitingCommand:true});
 atomicJson(join(game,'postgame-agenda.json'),agenda);
 const configPath=join(root,'config.json');
 atomicJson(configPath,{directory:root,node:process.execPath,researchBots:fileURLToPath(new URL('../engine/shared',import.meta.url)),games:{firered:{...cfg,port:0,nativeRadio:{...cfg.nativeRadio,huntId:owner}}}});
 let child=null,log='',sequence=0;
 const status=()=>{try{return JSON.parse(readFileSync(join(game,'status.json')));}catch{return null;}};
 const seen={missions:[],pending:[],objectives:[]};
 const note=(list,value)=>{if(value&&list.at(-1)!==value)list.push(value);};
 const observe=s=>{if(!s)return;note(seen.pending,s.pendingHunt?.id);if(s.mission?.id!==owner)note(seen.missions,s.mission?.id);if(s.phase==='postgame')note(seen.objectives,s.bot?.objective?.id);
  // Nothing but the priority target may be handed off or started.
  const other=[...seen.pending,...seen.missions].find(id=>id!==REQUEST_ID);
  assert.equal(other,undefined,`another checklist hunt started before the priority target: ${JSON.stringify(seen)}`);
  // The checklist's own hunt objectives (postgame-hunt-<entry>) never precede it.
  const hunt=seen.objectives.find(id=>/^postgame-hunt-/.test(id)&&id!=='postgame-hunt-mewtwo');
  assert.equal(hunt,undefined,`the agenda selected another entry first: ${JSON.stringify(seen)}`);};
 const wait=async(predicate,label,{ms=60000,stallMs=0,progress=null}={})=>{
  const until=Date.now()+ms;let marker=null,markerAt=Date.now();
  while(Date.now()<until){
   if(child.exitCode!==null)throw Error('Worker exited: '+log.slice(-3000));
   const s=status();observe(s);if(s&&predicate(s))return s;
   if(progress){const next=progress(s);if(next!==marker){marker=next;markerAt=Date.now();}
    if(Date.now()-markerAt>stallMs)throw Error(label+` (no progress for ${stallMs}ms): `+JSON.stringify({mission:s?.mission,bot:s?.bot,map:s?.map,decision:s?.decision,commandError:s?.commandError})+' '+log.slice(-2000));}
   await sleep(50);
  }
  const s=status();throw Error(label+': '+JSON.stringify({mission:s?.mission,bot:s?.bot,map:s?.map,commandError:s?.commandError,seen})+' '+log.slice(-2000));
 };
 const command=async body=>{
  const commandId='priority-'+(++sequence);atomicJson(join(game,'command.json'),{...body,commandId,sessionId:status().sessionId});
  if(body.type==='shutdown'){
   const exited=await Promise.race([new Promise(done=>child.once('exit',done)),sleep(20000,null,{ref:false})]);
   assert.equal(exited,0,'the worker must retire cleanly');child=null;return null;
  }
  const s=await wait(s=>s.lastCommand===commandId,'command '+body.type);assert.equal(s.commandError,null,s.commandError);return s;
 };
 let after;
 try{
  const env={...process.env};delete env.POKEMON_SUITE_UPDATE_HOLD;delete env.POKEMON_SUITE_MANUAL_LAUNCH;
  child=spawn(process.execPath,[fileURLToPath(new URL('../engine/firered/src/suite/session-worker.js',import.meta.url)),configPath,'firered'],{env,stdio:['ignore','pipe','pipe']});
  for(const stream of [child.stdout,child.stderr])stream.on('data',b=>{log=(log+b).slice(-12000);});
  const ready=await wait(s=>s.pid===child.pid,'the owner never published its status');
  assert.equal(ready.bot.awaitingCommand,true);assert.equal(ready.frame,before.frame);
  // G1 contract: postgame-goal carries the goal's priority target.
  await command({type:'postgame-goal',priorityTarget:{speciesId:150,shiny:'required',requestId:REQUEST_ID,request}});
  const selected=await wait(s=>s.pendingHunt?.id===REQUEST_ID||s.mission?.id===REQUEST_ID,'the agenda did not hand off the priority static hunt',{ms:120000});
  assert.equal(selected.postgame?.priorityTarget?.id,'mewtwo','the owner status reports the durable priority target');
  const started=await wait(s=>s.mission?.id===REQUEST_ID&&s.mission.state==='running','the priority static hunt did not start',{ms:120000});
  assert.equal(started.mission.method,'static');assert.equal(started.mission.name,'Mewtwo');assert.equal(started.mission.shiny,'required');
  const selection=JSON.parse(readFileSync(join(game,'active-hunt.json')));
  assert.deepEqual(selection,{id:REQUEST_ID,nativeRadio:true,label:LABEL},'the hunt keeps the save label');
  // Travel, supplies, the pre-encounter save and the first encounter reset.
  // Bounded by observed progress, not a fixed duration (see static timing).
  const reset=await wait(s=>{assert.notEqual(s.mission?.state,'blocked',s.mission?.reason);return s.mission?.id===REQUEST_ID&&(s.mission.resets>=1||s.mission.protected===true);},'the priority static hunt did not reach its first encounter',
   {ms:3600000,stallMs:300000,progress:s=>JSON.stringify([s?.map,s?.position,s?.mission?.phase,s?.mission?.resets,s?.mission?.encounters,s?.mission?.rng?.phase,s?.decision?.recommendation?.kind])});
  await command({type:'set-bot',enabled:false});
  await command({type:'shutdown'});
  const file=JSON.parse(readFileSync(join(game,'postgame-agenda.json')));
  assert.equal(file.priorityTarget?.id,'mewtwo','the durable agenda keeps the unfinished priority target');
  assert.equal(file.priorityTarget.requestId,REQUEST_ID);
  assert.equal(file.hunts.mewtwo.id,REQUEST_ID);assert.deepEqual(file.hunts.mewtwo.request,request);
  assert.equal(file.hunts.fossils.id,fossils,'the fossil reservation is untouched');
  assert.equal(existsSync(join(game,'hunts',fossils)),false,'the fossil hunt never started');
  const hunt=new SaveVault(join(game,'hunts',REQUEST_ID,'native-radio','saves'),saved.identity).read();
  const mission=hunt.metadata.session.mission;
  assert.equal(hunt.metadata.session.id,REQUEST_ID);assert.deepEqual(hunt.metadata.session.request,request);
  assert.equal(mission.postgameObjective,'mewtwo');assert.equal(mission.route.map,'MAP_CERULEAN_CAVE_B1F');
  assert.ok(mission.anchor||mission.rng?.anchor,'the pre-encounter anchor was saved');
  session.loadSram(hunt.sram);session.loadState(hunt.state);after=observer.capture();
  if(!mission.protected){
   assert.ok(mission.resets>=1);
   assert.equal(after.playerMemory.storyState.flagIds[700],false,'the reset preserves the unused encounter');
  }
  assert.equal(after.playerMemory.map.id,'MAP_CERULEAN_CAVE_B1F');
  console.log('# priority-static-target '+JSON.stringify({frames:after.frame-before.frame,map:after.playerMemory.map.id,resets:mission.resets,encounters:mission.encounters,protected:mission.protected===true,
   rng:mission.rng?{phase:mission.rng.phase,attempts:mission.rng.attempts,delay:mission.rng.delay}:null,seen,label:selection.label}));
 }finally{
  if(child&&child.exitCode===null){child.kill('SIGTERM');await Promise.race([new Promise(done=>child.once('exit',done)),sleep(15000,null,{ref:false})]);if(child.exitCode===null)child.kill('SIGKILL');}
  if(process.env.SUITE_REPLAY_KEEP==='1')console.log('# retained private replay '+root);else rmSync(root,{recursive:true,force:true});
 }
 return {before,after};
}
