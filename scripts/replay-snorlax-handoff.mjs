import assert from 'node:assert/strict';
import {spawn} from 'node:child_process';
import {mkdtempSync,readFileSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join,resolve,dirname} from 'node:path';
import {fileURLToPath} from 'node:url';
import {setTimeout as sleep} from 'node:timers/promises';
import {SaveVault,atomicJson} from '../engine/firered/src/suite/save-vault.js';
import {createFireRedObserver} from '../engine/firered/src/evidence/fire-red-observer.js';
import {encounterFingerprint} from '../engine/firered/src/player/encounter-tracker.js';
import {postgameCaptureRequest} from '../engine/firered/src/suite/national-dex-agenda.js';
import {continueNativeSaveAsync} from '../engine/firered/src/suite/native-cold-boot.js';

export async function replaySnorlaxHandoff({session,saved,inputs,cfg,fixture,corpusPath,createSession}){
 const root=mkdtempSync(join(tmpdir(),'suite-snorlax-handoff-')),game=join(root,'firered');
 const owner=saved.metadata.session.mission.id,record=fixture.currentGame?
  {id:'postgame-snorlax-native-handoff',request:postgameCaptureRequest(143,{shiny:'required'}),route:{method:'snorlax'},postgameObjective:'snorlax'}:
  saved.metadata.session.postgame.agenda.hunts.snorlax;
 assert.ok(record?.postgameObjective==='snorlax');
 const basePath=resolve(dirname(corpusPath),fixture.baseCheckpoint),baseRecord=JSON.parse(readFileSync(basePath));
 const base=new SaveVault(dirname(basePath),baseRecord.identity).read(baseRecord);
 new SaveVault(join(game,'saves'),base.identity).write(base.state,base.sram,base.metadata);
 new SaveVault(join(game,'hunts',owner,'native-radio','saves'),saved.identity).write(saved.state,saved.sram,saved.metadata);
 atomicJson(join(game,'active-hunt.json'),{id:owner,nativeRadio:true});
 atomicJson(join(game,'bot-policy.json'),{enabled:true,consolePowered:true,awaitingCommand:false,mode:'postgame',runScope:'postgame'});
 atomicJson(join(game,'postgame-agenda.json'),saved.metadata.session.postgame.agenda);
 atomicJson(join(game,'queued-hunt.json'),{record,runScope:'postgame',error:null});
 const config=join(root,'config.json');atomicJson(config,{directory:root,node:process.execPath,researchBots:fileURLToPath(new URL('../engine/shared',import.meta.url)),games:{firered:{...cfg,port:0,nativeRadio:{...cfg.nativeRadio,huntId:owner}}}});
 const before=createFireRedObserver({session,...inputs,runId:'snorlax-handoff-before'}).capture();
 const fingerprints=o=>[...o.playerMemory.trainer.party,...o.playerMemory.trainer.storage.pokemon].map(encounterFingerprint);
 let child,log='',restarted=false,started=false,last='';
 const status=()=>{try{return JSON.parse(readFileSync(join(game,'status.json')));}catch{return null;}};
 const launch=()=>{
  const env={...process.env};delete env.POKEMON_SUITE_UPDATE_HOLD;delete env.POKEMON_SUITE_MANUAL_LAUNCH;
  child=spawn(process.execPath,[fileURLToPath(new URL('../engine/firered/src/suite/session-worker.js',import.meta.url)),config,'firered'],{env,stdio:['ignore','pipe','pipe']});
  for(const stream of [child.stdout,child.stderr])stream.on('data',b=>{log=(log+b).slice(-12000);});
 };
 const stop=async()=>{
  child.kill('SIGTERM');const code=await Promise.race([new Promise(resolve=>child.once('exit',resolve)),sleep(15000,null,{ref:false})]);assert.equal(code,0,log);child=null;
 };
 try{
  launch();const until=Date.now()+480000,startDeadline=Date.now()+30000;let finished=null;
  while(Date.now()<until){
   assert.equal(child.exitCode,null,log);const s=status();
   if(s){
    const trace=JSON.stringify([s.runId,s.state,s.phase,s.map,s.bot?.reason,s.mission?.phase]);
    if(trace!==last){console.log('# snorlax-handoff '+s.frame+' '+trace);last=trace;}
    assert.ok(!s.commandError,s.commandError);
    if(s.runId===record.id){
     started=true;
     assert.notEqual(s.state,'blocked',s.bot?.reason??s.mission?.reason);
     if(!restarted&&s.frame>before.frame+100){
      await stop();const p=new SaveVault(join(game,'hunts',record.id,'native-radio','saves'),saved.identity).read();
      assert.equal(p.metadata.session.mission.id,record.id);assert.ok(p.metadata.frame>=before.frame);
      launch();restarted=true;continue;
     }
     if(s.mission?.state==='complete'){finished=s;break;}
    }
   }
   assert.ok(started||Date.now()<startDeadline,'The automatic Snorlax request did not acquire the current save: '+log);
   await sleep(200);
  }
  assert.ok(finished,'Snorlax did not complete its protected capture and native save: '+log);
  await stop();assert.ok(restarted);
  const final=new SaveVault(join(game,'hunts',record.id,'native-radio','saves'),saved.identity).read();
  assert.deepEqual(final.metadata.campaign.record,saved.metadata.campaign.record);
  const capture=final.metadata.session.captureEvidence??final.metadata.session.player?.encounterSafety?.capture;
  assert.equal(capture?.nativeSaveVerified,true);assert.equal(capture.pokemon.species,143);assert.equal(capture.pokemon.shiny,true);
  session.loadSram(final.sram);session.loadState(final.state);
  const after=createFireRedObserver({session,...inputs,runId:'snorlax-handoff-after'}).capture();
  const retained=fingerprints(after);for(const fp of fingerprints(before))assert.ok(retained.includes(fp));
  assert.ok(after.playerMemory.trainer.pokedex.ownedSpecies.includes(143));
  assert.ok(after.playerMemory.gameStats.savedGame>before.playerMemory.gameStats.savedGame);
  const cold=await createSession();
  try{
   cold.loadSram(final.sram);
   const reader=createFireRedObserver({session:cold,...inputs,runId:'snorlax-handoff-cold'});
   const loaded=await continueNativeSaveAsync(cold,reader),identities=fingerprints(loaded);
   for(const fp of fingerprints(before))assert.ok(identities.includes(fp));
   assert.ok(identities.includes(capture.fingerprint),'cold Continue retains the captured Snorlax');
   assert.ok(loaded.playerMemory.trainer.pokedex.ownedSpecies.includes(143));
  }finally{cold.close();}
  return {before,after};
 }finally{
  if(child&&child.exitCode===null){child.kill('SIGTERM');await Promise.race([new Promise(resolve=>child.once('exit',resolve)),sleep(15000,null,{ref:false})]);if(child.exitCode===null)child.kill('SIGKILL');}
  if(process.env.SUITE_REPLAY_KEEP==='1')console.log('# retained '+root);else rmSync(root,{recursive:true,force:true});
 }
}
