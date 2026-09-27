import assert from 'node:assert/strict';
import {spawn} from 'node:child_process';
import {mkdtempSync,readFileSync,writeFileSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {dirname,join,resolve} from 'node:path';
import {fileURLToPath} from 'node:url';
import {setTimeout as sleep} from 'node:timers/promises';
import {SaveVault,atomicJson} from '../engine/firered/src/suite/save-vault.js';
import {createFireRedObserver} from '../engine/firered/src/evidence/fire-red-observer.js';

export async function replayPostgameWorker({session,saved,inputs,cfg,fixture,corpusPath}){
 const root=mkdtempSync(join(tmpdir(),'suite-postgame-worker-')),game=join(root,'firered');
 const source=resolve(dirname(corpusPath),fixture.baseCheckpoint),record=JSON.parse(readFileSync(source));
 const base=new SaveVault(dirname(source),record.identity).read(record);
 new SaveVault(join(game,'saves'),base.identity).write(base.state,base.sram,base.metadata);
 const run=saved.metadata.campaign.record.id,vault=new SaveVault(join(game,'hunts',run,'native-radio','saves'),saved.identity);
 vault.write(saved.state,saved.sram,saved.metadata);
 atomicJson(join(game,'active-hunt.json'),{id:run,manual:true,nativeRadio:true});
 atomicJson(join(game,'bot-policy.json'),{enabled:false,consolePowered:false,awaitingCommand:false,mode:'postgame',runScope:'postgame'});
 const configPath=join(root,'config.json');
 const config={directory:root,node:process.execPath,researchBots:fileURLToPath(new URL('../engine/shared',import.meta.url)),games:{firered:{...cfg,port:0}}};
 atomicJson(configPath,config);
 const worker=fileURLToPath(new URL('../engine/firered/src/suite/session-worker.js',import.meta.url));
 const observer=createFireRedObserver({session,...inputs,runId:'postgame-worker-resume'}),before=observer.capture();
 let child=null,log='',commandSequence=0;
 const status=()=>{try{return JSON.parse(readFileSync(join(game,'status.json')));}catch{return null;}};
 const waitFor=async(predicate,message,timeout=20000)=>{
  const started=Date.now();while(Date.now()-started<timeout){
   if(child.exitCode!==null)throw Error('Worker exited: '+log.slice(-2000));
   const s=status();if(s&&predicate(s))return s;await sleep(100);
  }
  throw Error(message+'; '+JSON.stringify({frame:status()?.frame,bot:status()?.bot,commandError:status()?.commandError})+'; '+log.slice(-1000));
 };
 const start=()=>{
  const env={...process.env};delete env.POKEMON_SUITE_UPDATE_HOLD;delete env.POKEMON_SUITE_MANUAL_LAUNCH;
  child=spawn(process.execPath,[worker,configPath,'firered'],{env,stdio:['ignore','pipe','pipe']});
  child.stdout.on('data',b=>{log=(log+b).slice(-10000);});child.stderr.on('data',b=>{log=(log+b).slice(-10000);});
 };
 const command=async(body)=>{
  const commandId='replay-'+(++commandSequence),s=status();
  atomicJson(join(game,'command.json'),{...body,sessionId:s.sessionId,commandId});
  if(body.type!=='shutdown')return waitFor(s=>s.lastCommand===commandId,'The worker did not acknowledge '+body.type);
  const exit=await Promise.race([new Promise(resolve=>child.once('exit',code=>resolve(code))),sleep(15000,null,{ref:false})]);
  assert.equal(exit,0,'the worker must retire cleanly');child=null;
 };
 try{
  start();let first=await waitFor(s=>s.pid===child.pid,'The worker never published its retained checkpoint');
  assert.equal(first.frame,before.frame);assert.equal(first.bot.enabled,false);
  assert.equal(first.bot.objective.id,saved.metadata.postgame.objective.id);
  await command({type:'set-bot',enabled:true});
  let active=await waitFor(s=>s.frame>before.frame+100&&s.phase==='postgame','A campaign-only postgame owner did not resume without a hunt',10000);
  assert.equal(active.campaign.id,run);assert.equal(active.bot.runScope,'postgame');
  await command({type:'shutdown'});
  const checkpoint=vault.read();assert.deepEqual(checkpoint.metadata.campaign.record,saved.metadata.campaign.record);
  assert.equal(checkpoint.metadata.postgame.dexEvolution.requestId,saved.metadata.postgame.dexEvolution.requestId);
  start();active=await waitFor(s=>s.pid===child.pid&&s.frame>checkpoint.metadata.frame+100&&s.phase==='postgame','Enabled postgame did not resume after a worker restart');
  assert.equal(active.campaign.id,run);assert.equal(active.bot.enabled,true);
  const paused=await command({type:'set-bot',enabled:false});await sleep(1200);
  assert.equal(status().frame,paused.frame,'an explicit Stop remains authoritative');
  assert.equal(status().bot.enabled,false);
  await command({type:'shutdown'});
  const final=vault.read();assert.deepEqual(final.metadata.campaign.record,saved.metadata.campaign.record);
  assert.equal(final.metadata.postgame.dexEvolution.requestId,saved.metadata.postgame.dexEvolution.requestId);
  session.loadSram(final.sram);session.loadState(final.state);
  return {before,after:observer.capture()};
 }finally{
  if(child){child.kill('SIGTERM');await Promise.race([new Promise(resolve=>child.once('exit',resolve)),sleep(15000,null,{ref:false})]);if(child.exitCode===null)child.kill('SIGKILL');}
  rmSync(root,{recursive:true,force:true});
 }
}
