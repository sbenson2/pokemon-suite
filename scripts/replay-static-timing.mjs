import assert from 'node:assert/strict';
import {spawn} from 'node:child_process';
import {mkdtempSync,readFileSync,writeFileSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {dirname,join,resolve} from 'node:path';
import {fileURLToPath} from 'node:url';
import {setTimeout as sleep} from 'node:timers/promises';
import {SaveVault,atomicJson} from '../engine/firered/src/suite/save-vault.js';
import {createFireRedObserver} from '../engine/firered/src/evidence/fire-red-observer.js';
import {createCampaignPlanner} from '../engine/firered/src/player/campaign.js';
import {createSuiteMission} from '../engine/firered/src/suite/mission.js';
import {continueNativeSaveAsync} from '../engine/firered/src/suite/native-cold-boot.js';
const json=p=>JSON.parse(readFileSync(p));
const identity=p=>JSON.stringify([p.personality,p.otId,p.ivs]);
const all=o=>[...o.playerMemory.trainer.party,...o.playerMemory.trainer.storage.pokemon].filter(p=>p.validity==='valid');

export async function replayStaticTiming({session,saved,inputs,cfg,fixture,corpusPath,createSession}){
 const source=resolve(dirname(corpusPath),fixture.checkpoint),sourceVault=new SaveVault(dirname(source),saved.identity);
 const state=saved.metadata.session,mission=createSuiteMission({...inputs,mechanics:inputs.battle,id:state.id,request:state.request,state:state.mission});
 const base=createCampaignPlanner({...inputs,mechanics:inputs.battle}).storyWatch();
 const watch={...base,flags:[...base.flags,...mission.storyWatch().flags,mission.state.route.flag]};
 const observer=createFireRedObserver({session,...inputs,runId:'static-timing',observeRng:true,storyWatch:watch});
 const before=observer.capture(),originals=all(before).map(identity);
 assert.equal(mission.state.status,'blocked');assert.match(mission.state.reason,fixture.protectedCapture?/No first-ball timing passed qualification/:/timing could not be calibrated/);
 assert.equal(mission.nativeSpecies,144);assert.equal(before.playerMemory.encounter.pokemon.shiny,fixture.protectedCapture===true);
 const root=mkdtempSync(join(tmpdir(),'suite-static-timing-')),game=join(root,'firered'),run=state.id;
 const vault=new SaveVault(join(game,'hunts',run,'native-radio','saves'),saved.identity);
 const basePath=resolve(dirname(corpusPath),fixture.baseCheckpoint),baseRecord=json(basePath);
 const baseSave=new SaveVault(dirname(basePath),baseRecord.identity).read(baseRecord);
 new SaveVault(join(game,'saves'),baseSave.identity).write(baseSave.state,baseSave.sram,baseSave.metadata);
 for(const a of [state.mission.anchor,state.mission.rng.anchor]){
  const read=sourceVault.read(a);writeFileSync(join(vault.directory,a.statePath),read.state);writeFileSync(join(vault.directory,a.sramPath),read.sram);
 }
 vault.write(saved.state,saved.sram,saved.metadata);
 atomicJson(join(game,'active-hunt.json'),{id:run,nativeRadio:true});
 atomicJson(join(game,'bot-policy.json'),{enabled:false,consolePowered:true,awaitingCommand:false,mode:'postgame',runScope:'task'});
 const configPath=join(root,'config.json');
 atomicJson(configPath,{directory:root,node:process.execPath,researchBots:fileURLToPath(new URL('../engine/shared',import.meta.url)),games:{firered:{...cfg,port:0}}});
 let child=null,log='',sequence=0;
 const status=()=>{try{return json(join(game,'status.json'));}catch{return null;}};
 const start=()=>{
  const env={...process.env};delete env.POKEMON_SUITE_UPDATE_HOLD;delete env.POKEMON_SUITE_MANUAL_LAUNCH;
  child=spawn(process.execPath,[fileURLToPath(new URL('../engine/firered/src/suite/session-worker.js',import.meta.url)),configPath,'firered'],{env,stdio:['ignore','pipe','pipe']});
  for(const stream of [child.stdout,child.stderr])stream.on('data',b=>{log=(log+b).slice(-8000);});
 };
 const wait=async(predicate,label,options=30000)=>{
  const {ms=30000,progress=null,stallMs=0}=typeof options==='number'?{ms:options}:options;
  const until=Date.now()+ms;
  let marker=progress?progress(status()):null,markerAt=Date.now();
  while(Date.now()<until){assert.equal(child.exitCode,null,'worker exited: '+log);const s=status();if(s&&predicate(s))return s;
   if(progress){const next=progress(s);if(next!==marker){marker=next;markerAt=Date.now();}
    if(Date.now()-markerAt>stallMs)throw Error(label+' (no progress for '+stallMs+'ms): '+JSON.stringify({mission:status()?.mission,decision:status()?.decision,error:status()?.commandError,log}));}
   await sleep(20);}
  throw Error(label+': '+JSON.stringify({mission:status()?.mission,decision:status()?.decision,error:status()?.commandError,log}));
 };
 const command=async body=>{
  const commandId='static-'+(++sequence);atomicJson(join(game,'command.json'),{...body,commandId,sessionId:status().sessionId});
  if(body.type==='shutdown'){
   const exited=await Promise.race([new Promise(done=>child.once('exit',done)),sleep(15000,null,{ref:false})]);
   assert.equal(exited,0,'checkpoint shutdown');child=null;return;
  }
  const s=await wait(s=>s.lastCommand===commandId,'command '+body.type);assert.equal(s.commandError,null);return s;
 };
 const resume=retry=>command({type:'start',record:{id:run,request:state.request,route:state.mission.route},retryBlockedPolicy:retry,runScope:'task'});
 let after;
 try{
  start();await wait(s=>s.pid===child.pid,'owner ready');await resume(true);
  if(!fixture.protectedCapture){
  await wait(s=>{assert.notEqual(s.mission?.state,'blocked',s.mission?.reason);return s.decision?.reason==='waiting-for-shiny-rng'&&s.mission.rng.remainingAdvances>100;},'new generation boundary',60000);
  await command({type:'set-bot',enabled:false});const paused=status().frame;await sleep(150);assert.equal(status().frame,paused);
  await command({type:'shutdown'});
  const held=vault.read();assert.equal(held.metadata.session.id,run);assert.ok(held.metadata.session.mission.elapsedMs>=state.mission.elapsedMs);
  assert.equal(held.metadata.session.mission.rng.boundary,'object-interaction-v1');assert.ok(held.metadata.session.mission.rng.attempts>state.mission.rng.attempts);
  start();await wait(s=>s.pid===child.pid,'restarted owner');await resume(false);
  }
  // This includes a legendary battle and the existing bounded protected-capture
  // planner, which can qualify up to 256 bounded input sequences after PP depletion.
  // Bound the wait by observed trial progress (a stall limit) instead of a fixed
  // duration, so a loaded gate host cannot expire it mid-search; the wall limit
  // is only a cleanup backstop and no gameplay safety limit changes.
  const completed=await wait(s=>{assert.notEqual(s.mission?.state,'blocked',s.mission?.reason+' '+JSON.stringify(s.decision));return s.mission?.state==='complete';},'shiny legendary saved',
   {ms:2700000,stallMs:300000,progress:s=>JSON.stringify([s?.mission?.capturePlan?.phase??null,s?.mission?.capturePlan?.attempt??null,s?.mission?.rng?.attempts??null,s?.mission?.encounters??null,s?.frame??null])});
  if(fixture.protectedCapture){assert.equal(completed.mission.capturePlan.completed,true);assert.equal(completed.mission.capturePlan.verifiedRepeats,2);assert.ok(completed.mission.capturePlan.throws>=2&&completed.mission.capturePlan.throws<=3);}
  assert.equal(completed.mission.caught,1);assert.equal(completed.mission.rng.lastResult.matched,true);
  assert.equal(completed.bot.awaitingCommand,true);await command({type:'shutdown'});
  const final=vault.read(),receipt=final.metadata.session.captureEvidence;
  if(fixture.protectedCapture)assert.equal(identity(receipt.pokemon),identity(before.playerMemory.encounter.pokemon));
  assert.equal(receipt.nativeSaveVerified,true);assert.equal(receipt.pokemon.species,144);assert.equal(receipt.pokemon.shiny,true);
  assert.deepEqual(receipt,final.metadata.session.player.encounterSafety.capture,'completion persists the authoritative saved receipt');
  assert.deepEqual(final.metadata.campaign.record,saved.metadata.campaign.record);
  assert.ok(final.metadata.session.mission.elapsedMs>=state.mission.elapsedMs);
  assert.ok(final.metadata.session.mission.encounters>=state.mission.encounters);
  session.loadSram(final.sram);session.loadState(final.state);after=observer.capture();
  for(const id of originals)assert.ok(all(after).some(p=>identity(p)===id));
  const cold=await createSession();
  try{
   cold.loadSram(final.sram);const loaded=await continueNativeSaveAsync(cold,createFireRedObserver({session:cold,...inputs,runId:'static-cold',storyWatch:watch}));
   assert.equal(loaded.playerMemory.storyState.flagIds[702],true);assert.equal(loaded.playerMemory.storyState.flagIds[723],true);
   assert.ok(all(loaded).some(p=>identity(p)===identity(receipt.pokemon)&&p.shiny));
   for(const id of originals)assert.ok(all(loaded).some(p=>identity(p)===id));
  }finally{cold.close();}
  console.log('# static-timing '+JSON.stringify({frame:after.frame,personality:receipt.pokemon.personality,shiny:true,restartedTimingWait:!fixture.protectedCapture,protectedCaptureRecovery:fixture.protectedCapture===true,nativeSaveVerified:true,coldContinueVerified:true,budgetPreserved:true}));
 }finally{
  if(child&&child.exitCode===null){child.kill('SIGTERM');await Promise.race([new Promise(done=>child.once('exit',done)),sleep(15000,null,{ref:false})]);if(child.exitCode===null)child.kill('SIGKILL');}
  if(process.env.SUITE_REPLAY_KEEP==='1')console.log('# retained private replay '+root);else rmSync(root,{recursive:true,force:true});
 }
 return {before,after};
}
