import assert from 'node:assert/strict';
import {spawn} from 'node:child_process';
import {mkdtempSync,readFileSync,writeFileSync,existsSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {dirname,join,resolve} from 'node:path';
import {fileURLToPath} from 'node:url';
import {setTimeout as sleep} from 'node:timers/promises';
import {SaveVault,atomicJson} from '../engine/firered/src/suite/save-vault.js';
import {createFireRedObserver} from '../engine/firered/src/evidence/fire-red-observer.js';
import {createPostgameController} from '../engine/firered/src/suite/postgame.js';
import {continueNativeSaveAsync} from '../engine/firered/src/suite/native-cold-boot.js';

const json=p=>JSON.parse(readFileSync(p));
const identity=p=>JSON.stringify([p.personality,p.otId,...Object.values(p.ivs)]);
const all=t=>[...t.party,...t.storage.pokemon].filter(p=>p.validity==='valid');

export async function replayDojoGift({session,saved,inputs,cfg,fixture,corpusPath,createSession}) {
 const source=resolve(dirname(corpusPath),fixture.checkpoint),sourceVault=new SaveVault(dirname(source),saved.identity);
 const anchor=sourceVault.read(saved.metadata.session.mission.rng.anchor);
 const basePath=resolve(dirname(corpusPath),fixture.baseCheckpoint),baseRecord=json(basePath);
 const base=new SaveVault(dirname(basePath),baseRecord.identity).read(baseRecord);
 const watch=createPostgameController({...inputs,mechanics:inputs.battle}).storyWatch();
 const observer=createFireRedObserver({session,...inputs,runId:'dojo-gift',observeRng:true,storyWatch:watch});
 const before=observer.capture(),originals=all(before.playerMemory.trainer).map(identity);
 session.loadSram(anchor.sram);session.loadState(anchor.state);const anchorFrame=observer.capture().frame;
 session.loadSram(saved.sram);session.loadState(saved.state);
 assert.equal(before.playerMemory.map.id,'MAP_SAFFRON_CITY_DOJO');
 assert.equal(before.playerMemory.ui.choiceMenu?.selected,'yes');
 assert.equal(saved.metadata.session.player.transactionRecovery.blocked.reason,'repeated-menu-transaction');
 let after=before;
 for(const entry of ['automatic','blocked','timed-anchor']) {
  const root=mkdtempSync(join(tmpdir(),'suite-dojo-gift-')),game=join(root,'firered');
  const metadata=structuredClone(saved.metadata),state=metadata.session,run=state.id;
  const vault=new SaveVault(join(game,'hunts',run,'native-radio','saves'),saved.identity);
  new SaveVault(join(game,'saves'),base.identity).write(base.state,base.sram,base.metadata);
  // The retained generation anchor is the exact state the production reset
  // already restored after rejecting its first ordinary Hitmonlee. Recreate
  // that reset's controller state to exercise the entire long timing wait.
  if(entry==='timed-anchor') {
   state.player=null;state.mission.status='paused';state.mission.reason=null;
   state.mission.lastFingerprint=null;state.mission.rng.target=null;
   state.mission.rng.attemptSeed=null;state.mission.rng.phase='waiting';
   metadata.frame=anchorFrame;
  }
  for(const a of [state.mission.anchor,state.mission.rng.anchor]) {
   const read=sourceVault.read(a);
   writeFileSync(join(vault.directory,a.statePath),read.state);
   writeFileSync(join(vault.directory,a.sramPath),read.sram);
  }
  vault.write(entry==='timed-anchor'?anchor.state:saved.state,entry==='timed-anchor'?anchor.sram:saved.sram,metadata);
  atomicJson(join(game,'active-hunt.json'),{id:run,nativeRadio:true});
  atomicJson(join(game,'bot-policy.json'),{enabled:entry==='automatic',consolePowered:entry==='automatic',awaitingCommand:false,mode:'postgame',runScope:'task'});
  const configPath=join(root,'config.json');
  atomicJson(configPath,{directory:root,node:process.execPath,researchBots:fileURLToPath(new URL('../engine/shared',import.meta.url)),games:{firered:{...cfg,port:0}}});
  let child=null,log='',sequence=0;
  const status=()=>{try{return json(join(game,'status.json'));}catch{return null;}};
  const start=()=>{
   const env={...process.env};delete env.POKEMON_SUITE_UPDATE_HOLD;delete env.POKEMON_SUITE_MANUAL_LAUNCH;
   child=spawn(process.execPath,[fileURLToPath(new URL('../engine/firered/src/suite/session-worker.js',import.meta.url)),configPath,'firered'],{env,stdio:['ignore','pipe','pipe']});
   for(const stream of [child.stdout,child.stderr])stream.on('data',b=>{log=(log+b).slice(-8000);});
  };
  const wait=async(predicate,label,ms=30000)=>{
   const until=Date.now()+ms;
   while(Date.now()<until){assert.equal(child.exitCode,null,'worker exited: '+log);const s=status();if(s&&predicate(s))return s;await sleep(20);}
   throw Error(label+': '+JSON.stringify({mission:status()?.mission,decision:status()?.decision,error:status()?.commandError,log}));
  };
  const command=async body=>{
   const commandId='dojo-'+(++sequence);atomicJson(join(game,'command.json'),{...body,commandId,sessionId:status().sessionId});
   if(body.type==='shutdown'){
    const exited=await Promise.race([new Promise(done=>child.once('exit',done)),sleep(15000,null,{ref:false})]);
    assert.equal(exited,0,'checkpoint shutdown');child=null;return;
   }
   const s=await wait(s=>s.lastCommand===commandId,'command '+body.type);assert.equal(s.commandError,null);return s;
  };
  const resume=retry=>command({type:'start',record:{id:run,request:state.request,route:state.mission.route},retryBlockedPolicy:retry,runScope:'task'});
  try {
   start();await wait(s=>s.pid===child.pid,'owner ready');
   if(entry==='automatic')await wait(s=>existsSync(join(game,'recovery.json'))&&['running','complete'].includes(s.mission?.state),'the completed campaign must yield recovery to its current mission',5000);
   else await resume(entry==='blocked');
   if(entry==='timed-anchor') {
    await wait(s=>{assert.notEqual(s.mission?.state,'blocked',s.mission?.reason);return s.decision?.reason==='waiting-for-shiny-rng'&&s.mission.rng.remainingAdvances>100;},'native timing wait');
    await command({type:'set-bot',enabled:false});const paused=status().frame;await sleep(300);assert.equal(status().frame,paused,'Stop owns the timed wait');
    await command({type:'shutdown'});const held=vault.read();
    assert.equal(held.metadata.session.mission.id,run);assert.equal(held.metadata.session.mission.protected,false);
    start();await wait(s=>s.pid===child.pid,'restarted owner');await resume(false);
   }
   const completed=await wait(s=>{
    assert.notEqual(s.mission?.state,'blocked',s.mission?.reason+' '+JSON.stringify(s.decision));
    return s.mission?.state==='complete';
   },'shiny gift and native save',180000);
   assert.equal(completed.mission.caught,1);assert.equal(completed.mission.rng.phase,'found');
   assert.equal(completed.mission.rng.lastResult.matched,true);
   assert.equal(completed.bot.awaitingCommand,true,'task completion yields to the next command');
   await command({type:'shutdown'});
   const final=vault.read(),receipt=final.metadata.session.captureEvidence;
   assert.equal(receipt.nativeSaveVerified,true);assert.equal(receipt.pokemon.species,106);assert.equal(receipt.pokemon.shiny,true);
   assert.equal(final.metadata.session.request.speciesId,106);assert.deepEqual(final.metadata.campaign.record,saved.metadata.campaign.record);
   if(entry==='blocked')assert.equal(final.metadata.qualification.interventions.length,saved.metadata.qualification.interventions.length+1,'the retained stop needs a recorded reviewed retry');
   if(entry==='automatic'){
    const recovery=json(join(game,'recovery.json'));
    assert.equal(recovery.current.huntId,run);assert.equal(recovery.current.attempt,1);
    assert.equal(recovery.current.status,'recovered');
   }
   session.loadSram(final.sram);session.loadState(final.state);after=observer.capture();
   assert.equal(after.playerMemory.storyState.flagIds[632],true);assert.ok(all(after.playerMemory.trainer).some(p=>identity(p)===identity(receipt.pokemon)));
   for(const id of originals)assert.ok(all(after.playerMemory.trainer).some(p=>identity(p)===id));
   const cold=await createSession();
   try {
    cold.loadSram(final.sram);const loaded=await continueNativeSaveAsync(cold,createFireRedObserver({session:cold,...inputs,runId:'dojo-cold',storyWatch:watch}));
    assert.equal(loaded.playerMemory.storyState.flagIds[632],true);
    assert.ok(all(loaded.playerMemory.trainer).some(p=>identity(p)===identity(receipt.pokemon)&&p.shiny));
    for(const id of originals)assert.ok(all(loaded.playerMemory.trainer).some(p=>identity(p)===id));
   }finally{cold.close();}
   console.log('# dojo '+JSON.stringify({entry,frame:after.frame,personality:receipt.pokemon.personality,shiny:true,nativeSaveVerified:true,coldContinueVerified:true}));
  }finally{
   if(child&&child.exitCode===null){child.kill('SIGTERM');await Promise.race([new Promise(done=>child.once('exit',done)),sleep(15000,null,{ref:false})]);if(child.exitCode===null)child.kill('SIGKILL');}
   if(process.env.SUITE_REPLAY_KEEP==='1')console.log('# retained private replay '+root);else rmSync(root,{recursive:true,force:true});
  }
 }
 return {before,after};
}
