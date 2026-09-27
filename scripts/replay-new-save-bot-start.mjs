import assert from 'node:assert/strict';
import {spawn} from 'node:child_process';
import {mkdtempSync,readFileSync,readdirSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {dirname,join,resolve} from 'node:path';
import {fileURLToPath} from 'node:url';
import {setTimeout as sleep} from 'node:timers/promises';
import {SaveVault,atomicJson} from '../engine/firered/src/suite/save-vault.js';
import {createFireRedObserver} from '../engine/firered/src/evidence/fire-red-observer.js';

// Goal requests (G1): a goal that needs "a new save" uses the manual New save
// profile. Before this build a manual new-save never marked the blank profile
// as new, so Start bot tried Continue on a cartridge with no save and failed.
// The owner must back up the current save under its own label, start the bot
// at New Game without writing a save, and a restored backup must Continue again.
const BASE_LABEL='Replay base save',NEW_LABEL='Fresh goal run';
export async function replayNewSaveBotStart({session,saved,inputs,cfg,fixture,corpusPath}){
 const owner=saved.metadata.session.id;
 const observer=createFireRedObserver({session,...inputs,runId:'new-save-bot-start'}),before=observer.capture();
 assert.equal(before.emulator.mode,'overworld');
 const root=mkdtempSync(join(tmpdir(),'suite-new-save-')),game=join(root,'firered');
 const source=resolve(dirname(corpusPath),fixture.baseCheckpoint),baseRecord=JSON.parse(readFileSync(source));
 const baseSave=new SaveVault(dirname(source),baseRecord.identity).read(baseRecord);
 new SaveVault(join(game,'saves'),baseSave.identity).write(baseSave.state,baseSave.sram,baseSave.metadata);
 new SaveVault(join(game,'hunts',owner,'native-radio','saves'),saved.identity).write(saved.state,saved.sram,saved.metadata);
 atomicJson(join(game,'active-hunt.json'),{id:owner,nativeRadio:true,label:BASE_LABEL});
 atomicJson(join(game,'bot-policy.json'),{enabled:true,mode:'postgame',consolePowered:true,runScope:'task',awaitingCommand:true});
 const configPath=join(root,'config.json');
 atomicJson(configPath,{directory:root,node:process.execPath,researchBots:fileURLToPath(new URL('../engine/shared',import.meta.url)),games:{firered:{...cfg,port:0,nativeRadio:{...cfg.nativeRadio,huntId:owner}}}});
 let child=null,log='',sequence=0;
 const status=()=>{try{return JSON.parse(readFileSync(join(game,'status.json')));}catch{return null;}};
 const wait=async(predicate,label,ms=60000)=>{
  const until=Date.now()+ms;
  while(Date.now()<until){if(child.exitCode!==null)throw Error('Worker exited: '+log.slice(-3000));const s=status();if(s&&predicate(s))return s;await sleep(50);}
  const s=status();throw Error(label+': '+JSON.stringify({bot:s?.bot,mode:s?.mode,callback2:s?.callback2,commandError:s?.commandError})+' '+log.slice(-2000));
 };
 const command=async body=>{
  const commandId='new-save-'+(++sequence);atomicJson(join(game,'command.json'),{...body,commandId,sessionId:status().sessionId});
  if(body.type==='shutdown'){
   const exited=await Promise.race([new Promise(done=>child.once('exit',done)),sleep(20000,null,{ref:false})]);
   assert.equal(exited,0,'the worker must retire cleanly');child=null;return null;
  }
  const s=await wait(s=>s.lastCommand===commandId,'command '+body.type,120000);
  assert.equal(s.commandError,null,`${body.type}: ${s.commandError}`);return s;
 };
 let after;
 try{
  const env={...process.env};delete env.POKEMON_SUITE_UPDATE_HOLD;delete env.POKEMON_SUITE_MANUAL_LAUNCH;
  child=spawn(process.execPath,[fileURLToPath(new URL('../engine/firered/src/suite/session-worker.js',import.meta.url)),configPath,'firered'],{env,stdio:['ignore','pipe','pipe']});
  for(const stream of [child.stdout,child.stderr])stream.on('data',b=>{log=(log+b).slice(-12000);});
  await wait(s=>s.pid===child.pid,'the owner never published its status');
  // Bot settings → New save.
  await command({type:'new-save',label:NEW_LABEL});
  const selection=JSON.parse(readFileSync(join(game,'active-hunt.json')));
  assert.equal(selection.manual,true);assert.equal(selection.label,NEW_LABEL);assert.match(selection.id,/^play-/);
  const profiles=readdirSync(join(game,'save-profiles')).filter(n=>n.endsWith('.json'));
  assert.equal(profiles.length,1,'the previous save is backed up once');
  const backup=JSON.parse(readFileSync(join(game,'save-profiles',profiles[0])));
  assert.equal(backup.label,BASE_LABEL,'the backup keeps the previous save’s label');
  // Start bot on the blank profile: New Game, not Continue.
  const ready=await command({type:'start-bot'});
  assert.equal(ready.bot.enabled,true);assert.equal(ready.bot.awaitingCommand,true);assert.equal(ready.state,'ready');
  assert.notEqual(ready.mode,'overworld','no save was continued');
  const blank=new SaveVault(join(game,'hunts',selection.id,'native-radio','saves'),saved.identity).read();
  assert.ok(blank.sram.every(b=>b===0xff),'no save was written on the blank profile');
  assert.equal(blank.metadata.newProfile,true,'the manual profile is recorded as new until the player saves');
  // Bot settings → restore the previous save: it Continues again.
  await command({type:'restore-save',profileId:backup.id});
  const restored=await command({type:'start-bot'});
  assert.equal(restored.bot.awaitingCommand,true);assert.equal(restored.mode,'overworld');
  assert.equal(restored.map,before.playerMemory.map.id);
  const continued=new SaveVault(join(game,'hunts',owner,'native-radio','saves'),saved.identity).read();
  assert.equal(continued.metadata.newProfile,false,'a restored save is not a New Game profile');
  assert.equal(continued.sram.equals(saved.sram),true,'restoring never rewrites the native save');
  assert.deepEqual(JSON.parse(readFileSync(join(game,'active-hunt.json'))),{id:owner,nativeRadio:true,label:BASE_LABEL});
  await command({type:'shutdown'});
  session.loadSram(continued.sram);session.loadState(continued.state);after=observer.capture();
  console.log('# new-save-bot-start '+JSON.stringify({newGameCallback:ready.callback2,newGameMode:ready.mode,restoredMap:restored.map,backupLabel:backup.label}));
 }finally{
  if(child&&child.exitCode===null){child.kill('SIGTERM');await Promise.race([new Promise(done=>child.once('exit',done)),sleep(15000,null,{ref:false})]);if(child.exitCode===null)child.kill('SIGKILL');}
  if(process.env.SUITE_REPLAY_KEEP==='1')console.log('# retained private replay '+root);else rmSync(root,{recursive:true,force:true});
 }
 return {before,after};
}
