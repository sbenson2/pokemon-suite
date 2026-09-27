import assert from 'node:assert/strict';
import {spawn} from 'node:child_process';
import {mkdtempSync,readFileSync,writeFileSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {dirname,join,resolve} from 'node:path';
import {fileURLToPath} from 'node:url';
import {setTimeout as sleep} from 'node:timers/promises';
import {SaveVault,atomicJson} from '../engine/firered/src/suite/save-vault.js';
import {createPostgameController} from '../engine/firered/src/suite/postgame.js';
import {createFireRedObserver} from '../engine/firered/src/evidence/fire-red-observer.js';
import {readPostgameEvidence} from '../engine/firered/src/suite/postgame-agenda.js';
import {continueNativeSaveAsync} from '../engine/firered/src/suite/native-cold-boot.js';
import {encounterFingerprint} from '../engine/firered/src/player/encounter-tracker.js';

// Exercise the production process, supervised planner and connected video feed.
// The replay owns a copied save; commands never target the installed live game.
export async function replayIncomeChain({session,saved,inputs,cfg,fixture,corpusPath,createSession}){
 const root=mkdtempSync(join(tmpdir(),'suite-income-chain-')),game=join(root,'firered');
 const basePath=resolve(dirname(corpusPath),fixture.baseCheckpoint),baseRecord=JSON.parse(readFileSync(basePath));
 const base=new SaveVault(dirname(basePath),baseRecord.identity).read(baseRecord);
 new SaveVault(join(game,'saves'),base.identity).write(base.state,base.sram,base.metadata);
 const run=saved.metadata.session.mission.id,vault=new SaveVault(join(game,'hunts',run,'native-radio','saves'),saved.identity);
 vault.write(saved.state,saved.sram,saved.metadata);
 atomicJson(join(game,'active-hunt.json'),{id:run,nativeRadio:true});
 atomicJson(join(game,'bot-policy.json'),{enabled:false,consolePowered:false,awaitingCommand:false,mode:'postgame',runScope:'postgame'});
 const configPath=join(root,'config.json');
 atomicJson(configPath,{directory:root,node:process.execPath,researchBots:fileURLToPath(new URL('../engine/shared',import.meta.url)),games:{firered:{...cfg,port:0}}});
 const controller=createPostgameController({...inputs,mechanics:inputs.battle,state:saved.metadata.session.postgame});
 const observer=createFireRedObserver({session,...inputs,runId:'income-chain',storyWatch:controller.storyWatch()});
 const capture=()=>{const raw=observer.capture();return {...raw,playerMemory:{...raw.playerMemory,postgameEvidence:readPostgameEvidence(session,inputs.runtime,raw)}};};
 const before=capture(),ids=o=>[...o.playerMemory.trainer.party,...o.playerMemory.trainer.storage.pokemon].map(encounterFingerprint);
 const original=ids(before),initialCoins=before.playerMemory.postgameEvidence.acquisition.coins;
 let child=null,log='',url=null,commandSequence=0,streamController=null,streamTask=null,streamError=null,latest=null;
 const frameIntervals=[],changedIntervals=[];let lastPacket=null,lastChanged=null,previousPixels=null,packets=0,changedFrames=0;
 const status=()=>{try{return JSON.parse(readFileSync(join(game,'status.json')));}catch{return null;}};
 const waitFor=async(predicate,message,timeout=30000)=>{
  const until=Date.now()+timeout;while(Date.now()<until){if(child?.exitCode!==null)throw Error('Worker exited: '+log.slice(-3000));const s=status();if(s&&predicate(s))return s;await sleep(100);}
  throw Error(message+'; '+log.slice(-1800));
 };
 const start=()=>{
  url=null;const env={...process.env};delete env.POKEMON_SUITE_UPDATE_HOLD;delete env.POKEMON_SUITE_MANUAL_LAUNCH;
  child=spawn(process.execPath,[fileURLToPath(new URL('../engine/firered/src/suite/session-worker.js',import.meta.url)),configPath,'firered'],{env,stdio:['ignore','pipe','pipe']});
  const output=b=>{log=(log+b).slice(-20000);for(const line of log.split('\n'))try{const r=JSON.parse(line);if(r.event==='suite-session-ready')url=r.url;}catch{}};
  child.stdout.on('data',output);child.stderr.on('data',output);
 };
 const command=async body=>{
  const commandId='income-'+(++commandSequence);atomicJson(join(game,'command.json'),{...body,sessionId:status().sessionId,commandId});
  if(body.type!=='shutdown')return waitFor(s=>s.lastCommand===commandId,'Command not acknowledged: '+body.type);
  const code=await Promise.race([new Promise(r=>child.once('exit',r)),sleep(20000,'timeout',{ref:false})]);assert.equal(code,0,'worker must close cleanly');child=null;
 };
 const disconnect=async()=>{streamController?.abort();await streamTask?.catch(()=>{});streamController=null;streamTask=null;lastPacket=null;lastChanged=null;previousPixels=null;};
 const connect=()=>{
  streamController=new AbortController();streamTask=(async()=>{
   const response=await fetch(new URL('/stream',url),{signal:streamController.signal});assert.equal(response.status,200);let buffered=Buffer.alloc(0);
   for await(const chunk of response.body){buffered=Buffer.concat([buffered,chunk]);
    while(buffered.length>=16){const length=buffered.readUInt32BE(8);assert.equal(length,240*160*4);if(buffered.length<16+length)break;
     const now=performance.now(),pixels=buffered.subarray(16,16+length);packets++;
     if(lastPacket!==null)frameIntervals.push(now-lastPacket);lastPacket=now;
     if(!previousPixels||!pixels.equals(previousPixels)){changedFrames++;if(lastChanged!==null&&latest?.mode==='overworld'&&latest?.decision?.recommendation?.direction)changedIntervals.push(now-lastChanged);lastChanged=now;previousPixels=Buffer.from(pixels);}
     buffered=buffered.subarray(16+length);
    }
   }
  })();streamTask.catch(error=>{if(error.name!=='AbortError')streamError=error;});
 };
 let restartedBattle=false,restartedPurchase=false,earned=false,purchased=false,checkedFrame=null,after=null,lastPrint=0,errorSince=null;
 try{
  start();await waitFor(s=>s.pid===child.pid&&url,'Worker did not load retained income failure');connect();await command({type:'set-bot',enabled:true});
  const until=Date.now()+1200000;
  while(Date.now()<until){
   latest=status();assert.ok(child&&child.exitCode===null,'worker exited: '+log.slice(-1500));
   if(streamError)throw streamError;
   if(latest?.commandError){errorSince??=Date.now();if(Date.now()-errorSince>5000)throw Error(latest.commandError);}else errorSince=null;
   if(latest?.bot.status==='blocked')throw Error('Income chain blocked: '+latest.bot.reason);
   if(Date.now()-lastPrint>45000){console.log('# income-chain '+JSON.stringify({frame:latest?.frame,map:latest?.map,money:latest?.observation?.money,battles:latest?.spectator?.progress?.trainerBattles,objective:latest?.bot.objective?.id}));lastPrint=Date.now();}
   earned ||= latest?.spectator?.progress?.trainerBattles>before.playerMemory.gameStats.trainerBattles&&latest?.observation?.money>before.playerMemory.trainer.money;
   if(!restartedBattle&&latest?.mode==='battle'){
    await disconnect();await command({type:'shutdown'});start();await waitFor(s=>s.pid===child.pid&&url,'Battle restart failed');connect();restartedBattle=true;continue;
   }
   const record=vault.current();
   if(record&&record.metadata.frame!==checkedFrame){
    const checkpoint=vault.read(record);checkedFrame=record.metadata.frame;session.loadSram(checkpoint.sram);session.loadState(checkpoint.state);
    // Loading a different checkpoint invalidates the observer's previous
    // callback signature. Reobserve the same frame; never step the live owner.
    capture();const o=capture(),m=o.playerMemory;
    if(o.phase!=='stable'||m.trainer?.partyValidity!=='valid'||!m.postgameEvidence?.acquisition){await sleep(500);continue;}
    purchased ||= m.postgameEvidence.acquisition.coins>initialCoins;
    if(purchased&&!restartedPurchase){
     await disconnect();await command({type:'shutdown'});start();await waitFor(s=>s.pid===child.pid&&url,'Purchase restart failed');connect();restartedPurchase=true;continue;
    }
    const acquired=m.trainer.pokedex.ownedSpecies.includes(123)&&!before.playerMemory.trainer.pokedex.ownedSpecies.includes(123);
    if(earned&&purchased&&acquired&&m.gameStats.savedGame>before.playerMemory.gameStats.savedGame&&o.emulator.mode==='overworld'&&!o.emulator.inBattle){
     // The save counter can already exceed the baseline from an earlier save
     // while the post-purchase save is still being written; the requirement is
     // a native save that cold-continues with Scyther, so keep sampling until
     // one does (the overall deadline still applies).
     let coldScyther=false;
     const cold=await createSession();try{
      cold.loadSram(checkpoint.sram);const co=createFireRedObserver({session:cold,...inputs,runId:'income-chain-cold',storyWatch:controller.storyWatch()});const loaded=await continueNativeSaveAsync(cold,co);
      coldScyther=loaded.playerMemory.trainer.pokedex.ownedSpecies.includes(123);
      if(coldScyther)assert.ok(original.every(id=>ids(loaded).includes(id)),'original Pokémon preserved');
     }finally{cold.close();}
     if(!coldScyther){await sleep(500);continue;}
     after=o;break;
    }
   }
   await sleep(500);
  }
  assert.ok(after,'Income must fund a purchase, resume the prize acquisition and save it within twenty minutes');assert.ok(restartedBattle&&restartedPurchase);
  await disconnect();await command({type:'set-bot',enabled:false});await command({type:'shutdown'});
  const quantile=(values,q)=>[...values].sort((a,b)=>a-b)[Math.floor((values.length-1)*q)]??null;
  const performance={packets,changedFrames,packetP50:quantile(frameIntervals,.5),packetP95:quantile(frameIntervals,.95),movementChangeP95:quantile(changedIntervals,.95)};
  assert.ok(packets>100&&changedFrames>50,'connected viewer must receive changing native pictures');
  assert.ok(performance.packetP95<150,'planning must not routinely block the connected stream');
  assert.ok(changedIntervals.length>50&&performance.movementChangeP95<300,'moving pictures must advance, not only duplicate frame packets');
  atomicJson(join(root,'result.json'),{earned,purchased,restartedBattle,restartedPurchase,coldContinue:true,performance});console.log('# income-chain '+JSON.stringify({earned,purchased,restartedBattle,restartedPurchase,coldContinue:true,performance,frame:after.frame}));
  return {before,after};
 }finally{
  await disconnect();if(child&&child.exitCode===null){child.kill('SIGTERM');await Promise.race([new Promise(r=>child.once('exit',r)),sleep(15000,null,{ref:false})]);if(child.exitCode===null)child.kill('SIGKILL');}
  writeFileSync(join(root,'worker.log'),log);console.log('# retained income-chain '+root);
  // Retain failed native checkpoints as well as successful evidence.
 }
}
