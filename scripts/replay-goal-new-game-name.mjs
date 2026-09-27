import assert from 'node:assert/strict';
import {spawn} from 'node:child_process';
import {createServer} from 'node:net';
import {mkdtempSync,readFileSync,readdirSync,rmSync,writeFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {dirname,join,resolve} from 'node:path';
import {fileURLToPath} from 'node:url';
import {setTimeout as sleep} from 'node:timers/promises';
import {SaveVault,atomicJson} from '../engine/firered/src/suite/save-vault.js';
import {createFireRedObserver} from '../engine/firered/src/evidence/fire-red-observer.js';
import {PLAYER_PRESET_NAMES,RIVAL_PRESET_NAMES} from '../engine/firered/src/player/run-profile.js';

const json=p=>JSON.parse(readFileSync(p));
const port=()=>new Promise((done,fail)=>{const server=createServer();server.on('error',fail);server.listen(0,'127.0.0.1',()=>{const n=server.address().port;server.close(()=>done(n));});});

// Goal requests (G2). "New game as Nova with Squirtle, get me a shiny Mewtwo"
// when no save exists yet: the owner made a blank New save (no in-game save),
// so the goal supervisor must start a new save and its story campaign (the
// existing reviewed start-campaign flow, which backs up the current profile)
// and the New Game keyboard must type the chosen name, not a preset. The host
// side is the real GoalSupervisor (scripts/goal-supervisor-replay.py) over this
// isolated runtime; it only uses the Suite's controls. The replay ends in the
// player's bedroom, after the naming screen.
const NAME='Nova',BASE_LABEL='Replay previous save',BLANK_LABEL='Blank goal profile';
export async function replayGoalNewGameName({session,saved,inputs,cfg,fixture,corpusPath}){
 const owner=saved.metadata.session.id;
 const observer=createFireRedObserver({session,...inputs,runId:'goal-new-game-trainer-name'}),before=observer.capture();
 assert.equal(before.emulator.mode,'overworld');
 assert.notEqual(before.playerMemory.trainer.playerName,NAME,'the checkpoint trainer has another name');
 const root=mkdtempSync(join(tmpdir(),'suite-goal-name-')),game=join(root,'firered');
 const source=resolve(dirname(corpusPath),fixture.baseCheckpoint),baseRecord=json(source);
 const baseSave=new SaveVault(dirname(source),baseRecord.identity).read(baseRecord);
 new SaveVault(join(game,'saves'),baseSave.identity).write(baseSave.state,baseSave.sram,baseSave.metadata);
 new SaveVault(join(game,'hunts',owner,'native-radio','saves'),saved.identity).write(saved.state,saved.sram,saved.metadata);
 atomicJson(join(game,'active-hunt.json'),{id:owner,nativeRadio:true,label:BASE_LABEL});
 atomicJson(join(game,'bot-policy.json'),{enabled:true,mode:'postgame',consolePowered:true,runScope:'task',awaitingCommand:true});
 const worker=fileURLToPath(new URL('../engine/firered/src/suite/session-worker.js',import.meta.url));
 atomicJson(join(root,'config.json'),{schema:'pokemon-suite/config/v1',directory:root,node:process.execPath,worker,
  researchBots:fileURLToPath(new URL('../engine/shared',import.meta.url)),games:{firered:{...cfg,port:await port(),nativeRadio:{...cfg.nativeRadio,huntId:owner}}}});
 const env={...process.env};for(const key of ['POKEMON_SUITE_UPDATE_HOLD','POKEMON_SUITE_MANUAL_LAUNCH','POKEMON_SUITE_DESKTOP_NODE'])delete env[key];
 let child=null,driver=null,log='',driverLog='',sequence=0;
 const status=()=>{try{return json(join(game,'status.json'));}catch{return null;}};
 const goal=()=>{try{return json(join(root,'goals.json')).goals[0]??null;}catch{return null;}};
 const alive=()=>{if(child?.exitCode!==null)throw Error('Worker exited: '+log.slice(-3000));if(driver&&driver.exitCode!==null)throw Error('Goal supervisor exited: '+driverLog.slice(-3000));};
 const wait=async(predicate,label,{ms=60000,stallMs=0,progress=null}={})=>{
  const until=Date.now()+ms;let marker=null,markerAt=Date.now();
  while(Date.now()<until){
   alive();const s=status(),g=goal();if(s&&predicate(s,g))return s;
   if(progress){const next=progress(s,g);if(next!==marker){marker=next;markerAt=Date.now();}
    if(Date.now()-markerAt>stallMs)throw Error(label+` (no progress for ${stallMs}ms): `+JSON.stringify({map:s?.map,callback2:s?.callback2,bot:s?.bot,campaign:s?.campaign?{status:s.campaign.status,reason:s.campaign.reason}:null,goal:g?.progress})+' '+log.slice(-1500));}
   await sleep(100);
  }
  const s=status(),g=goal();throw Error(label+': '+JSON.stringify({map:s?.map,callback2:s?.callback2,commandError:s?.commandError,goal:g?.progress,lastError:g?.execution?.lastError})+' '+log.slice(-1500)+' '+driverLog.slice(-1500));
 };
 const command=async body=>{
  const commandId='goal-name-'+(++sequence);atomicJson(join(game,'command.json'),{...body,commandId,sessionId:status().sessionId});
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
  // Bot settings → New save: a blank profile with no in-game save yet.
  const blank=await command({type:'new-save',label:BLANK_LABEL});
  assert.equal(blank.newProfile,true,'the owner reports that no in-game save exists');
  // "new game as Nova with Squirtle, get me a shiny Mewtwo" (Goal v1, as the interpreter commits it).
  const request={schema:'pokemon-suite/farming-request/v1',game:'firered',speciesId:150,quantity:1,locationId:'any',shiny:'required',natures:[],gender:'any',abilityId:null,
   ball:{id:'any',requirement:'preferred'},minIvs:{},minDvs:{},encounterLevel:{min:1,max:100},finalLevel:null,moves:[],heldItemId:null,
   limits:{maxEncounters:1000,maxMinutes:240,minBalls:10,maxSpend:999999},afterCompletion:'stop-save'};
  writeFileSync(join(root,'goal-request.json'),JSON.stringify({schema:'pokemon-suite/goal/v1',source:{text:'new game as Nova with Squirtle, get me a shiny Mewtwo',via:'typed',interpreter:{parser:'deterministic',confidence:1}},
   game:'firered',save:{mode:'current-if-able',trainerName:NAME,starter:'squirtle',label:null},steps:[{kind:'farming',request}],then:'standing-goals',idempotencyKey:'replay-goal-trainer-name'}));
  driver=spawn(process.env.PYTHON??'python3',['-u',fileURLToPath(new URL('./goal-supervisor-replay.py',import.meta.url)),root,join(root,'goal-request.json')],
   {cwd:fileURLToPath(new URL('..',import.meta.url)),env,stdio:['ignore','pipe','pipe']});
  for(const stream of [driver.stdout,driver.stderr])stream.on('data',b=>{driverLog=(driverLog+b).slice(-12000);});
  // The supervisor chooses a new save (no save exists) and starts the reviewed campaign.
  const started=await wait((s,g)=>{
   if(g?.execution?.lastError)throw Error('The goal could not start its new game: '+g.execution.lastError);
   return g?.execution?.steps?.[0]?.campaignId&&s.campaign?.id===g.execution.steps[0].campaignId;},'the goal did not start a new save and campaign',{ms:180000});
  const g=goal(),run=g.execution.steps[0].campaignId;
  assert.equal(g.execution.save.decision,'new');assert.match(g.execution.save.reason,/No save exists/);
  assert.deepEqual(g.execution.plan.map(s=>s.kind),['campaign','farming']);
  assert.deepEqual({...g.execution.plan[0].settings,label:undefined},{label:undefined,afterCampaign:'postgame',starter:'squirtle',trainerName:NAME});
  assert.ok(g.execution.plan[0].settings.label.length<=50);
  const review=json(join(game,'run-previews',run+'.json'));
  assert.equal(review.started,true);assert.equal(review.record.settings.trainerName,NAME);
  assert.equal(review.record.runProfile.playerName,NAME);assert.equal(review.record.runProfile.starter.id,'squirtle');
  assert.equal(started.bot.runScope,'campaign');
  // The previous (blank) profile was backed up by the start-campaign flow.
  const labels=readdirSync(join(game,'save-profiles')).filter(n=>n.endsWith('.json')).map(n=>json(join(game,'save-profiles',n)).label).sort();
  assert.deepEqual(labels,[BLANK_LABEL,BASE_LABEL].sort(),'both earlier saves are backed up, nothing replaced');
  // New Game: gender, the naming keyboard, the rival preset, then the bedroom.
  let naming=false,namingSince=null;
  await wait(s=>{naming||=/NamingScreen/.test(s.callback2??'');assert.notEqual(s.campaign?.status,'blocked',s.campaign?.reason);
   // A keyboard that cannot finish the name must fail fast, not at the case timeout.
   if(/NamingScreen/.test(s.callback2??'')){namingSince??=Date.now();assert.ok(Date.now()-namingSince<240000,'the naming screen did not finish: '+JSON.stringify(s.decision));}else namingSince=null;
   // The intro ends in the bedroom and the owner walks out within seconds, so a
   // status poll can miss both the naming screen and the bedroom. Any overworld
   // map reached by the running campaign proves the intro finished; the name
   // itself is proven below from the saved cartridge (typed exactly, rival kept).
   return s.mode==='overworld'&&/^MAP_/.test(s.map??'')&&(naming||s.campaign?.status==='running');},'the New Game intro did not reach the overworld',
   {ms:1800000,stallMs:300000,progress:s=>JSON.stringify([s?.frame>>12,s?.callback2,s?.map])});
  assert.equal(goal().progress.phase,'campaign');
  driver.kill('SIGTERM');await Promise.race([new Promise(done=>driver.once('exit',done)),sleep(5000,null,{ref:false})]);driver=null;
  await command({type:'set-bot',enabled:false});
  await command({type:'shutdown'});
  const vault=new SaveVault(join(game,'hunts',run,'native-radio','saves'),saved.identity).read();
  session.loadSram(vault.sram);session.loadState(vault.state);after=observer.capture();
  const trainer=after.playerMemory.trainer;
  assert.equal(trainer.playerName,NAME,'the keyboard typed the chosen name exactly, in its case');
  assert.equal(trainer.rivalName,review.record.runProfile.rivalName,'the rival keeps its seeded preset');
  assert.ok(RIVAL_PRESET_NAMES.includes(trainer.rivalName));
  assert.ok(!Object.values(PLAYER_PRESET_NAMES).flat().includes(trainer.playerName));
  // The original save is untouched and restorable.
  const previous=readdirSync(join(game,'save-profiles')).filter(n=>n.endsWith('.json')).map(n=>json(join(game,'save-profiles',n))).find(r=>r.label===BASE_LABEL);
  const archived=new SaveVault(previous.directory,saved.identity).read(previous.source);
  assert.equal(archived.sram.equals(saved.sram),true,'the previous save is preserved byte for byte');
  const later=goal();assert.equal(later.execution.steps[1].status,'pending','the Mewtwo hunt waits for the Hall of Fame');assert.equal(later.execution.steps[1].requestId,undefined);
  console.log('# goal-new-game-trainer-name '+JSON.stringify({run,playerName:trainer.playerName,rival:trainer.rivalName??null,map:after.playerMemory.map.id,frames:after.frame,labels}));
 }finally{
  if(driver&&driver.exitCode===null)driver.kill('SIGKILL');
  if(child&&child.exitCode===null){child.kill('SIGTERM');await Promise.race([new Promise(done=>child.once('exit',done)),sleep(15000,null,{ref:false})]);if(child.exitCode===null)child.kill('SIGKILL');}
  if(process.env.SUITE_REPLAY_KEEP==='1')console.log('# retained private replay '+root);else rmSync(root,{recursive:true,force:true});
 }
 return {before,after};
}
