import assert from 'node:assert/strict';
import {spawn} from 'node:child_process';
import {mkdtempSync,readFileSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {dirname,join,resolve} from 'node:path';
import {fileURLToPath} from 'node:url';
import {setTimeout as sleep} from 'node:timers/promises';
import {SaveVault,atomicJson} from '../engine/firered/src/suite/save-vault.js';
import {createFireRedObserver} from '../engine/firered/src/evidence/fire-red-observer.js';

// Live September 23: the first Mail-glitch Rare Candy supply ran as a player
// task. Its owner and checkpoint carry the task's own postgame state: the
// Mail-supply ledger and a disabled agenda without workflows. Restarting the
// postgame checklist from Bot settings built the new owner from that state and
// saved its empty agenda over the durable one, losing the League receipt, the
// record cycles and the retry deferrals, so a finished League rematch ran
// again. An app relaunch earlier that morning lost them the same way. The
// checklist must resume this campaign's durable agenda and keep the ledger;
// another campaign's durable agenda is never resumed.
export async function replayChecklistAgenda({session,saved,inputs,cfg,fixture,corpusPath}){
 const durable=JSON.parse(readFileSync(resolve(dirname(corpusPath),fixture.durableAgenda)));
 const task=saved.metadata.session.postgame,owner=saved.metadata.session.id;
 assert.equal(task.agenda.enabled,false,'the checkpoint holds the finished task’s disabled agenda');
 assert.equal(task.agenda.workflows,undefined);
 assert.equal(task.qmmLedger.receipts.length,1,'the checkpoint holds the Mail-supply receipt');
 assert.ok(durable.enabled&&durable.workflows.league.receipt&&durable.workflows.records,'the durable agenda holds workflows');
 assert.equal(durable.continuation.campaignId,saved.metadata.campaign.record.id,'the durable agenda belongs to this campaign');
 const source=resolve(dirname(corpusPath),fixture.baseCheckpoint),baseRecord=JSON.parse(readFileSync(source));
 const base=new SaveVault(dirname(source),baseRecord.identity).read(baseRecord);
 const worker=fileURLToPath(new URL('../engine/firered/src/suite/session-worker.js',import.meta.url));
 const observer=createFireRedObserver({session,...inputs,runId:'checklist-agenda'}),before=observer.capture();
 // Finish the task, choose Bot settings → Postgame checklist, then retire the owner.
 const checklist=async agenda=>{
  const root=mkdtempSync(join(tmpdir(),'suite-checklist-agenda-')),game=join(root,'firered');
  new SaveVault(join(game,'saves'),base.identity).write(base.state,base.sram,base.metadata);
  const vault=new SaveVault(join(game,'hunts',owner,'native-radio','saves'),saved.identity);
  vault.write(saved.state,saved.sram,saved.metadata);
  atomicJson(join(game,'active-hunt.json'),{id:owner,nativeRadio:true});
  atomicJson(join(game,'bot-policy.json'),{enabled:true,mode:'postgame',consolePowered:true,runScope:'task',awaitingCommand:true});
  atomicJson(join(game,'postgame-agenda.json'),agenda);
  const configPath=join(root,'config.json');
  atomicJson(configPath,{directory:root,node:process.execPath,researchBots:fileURLToPath(new URL('../engine/shared',import.meta.url)),games:{firered:{...cfg,port:0,nativeRadio:{...cfg.nativeRadio,huntId:owner}}}});
  let child=null,log='',commandSequence=0;
  const status=()=>{try{return JSON.parse(readFileSync(join(game,'status.json')));}catch{return null;}};
  const waitFor=async(predicate,message,timeout=30000)=>{
   const started=Date.now();while(Date.now()-started<timeout){
    if(child.exitCode!==null)throw Error('Worker exited: '+log.slice(-2000));
    const s=status();if(s&&predicate(s))return s;await sleep(100);
   }
   throw Error(message+'; '+JSON.stringify({frame:status()?.frame,bot:status()?.bot,commandError:status()?.commandError})+'; '+log.slice(-1000));
  };
  const command=async body=>{
   const commandId='checklist-'+(++commandSequence),s=status();
   atomicJson(join(game,'command.json'),{...body,sessionId:s.sessionId,commandId});
   if(body.type!=='shutdown')return waitFor(s=>s.lastCommand===commandId,'The worker did not acknowledge '+body.type);
   const exit=await Promise.race([new Promise(resolve=>child.once('exit',code=>resolve(code))),sleep(15000,null,{ref:false})]);
   assert.equal(exit,0,'the worker must retire cleanly');child=null;
  };
  try{
   const env={...process.env};delete env.POKEMON_SUITE_UPDATE_HOLD;delete env.POKEMON_SUITE_MANUAL_LAUNCH;
   child=spawn(process.execPath,[worker,configPath,'firered'],{env,stdio:['ignore','pipe','pipe']});
   child.stdout.on('data',b=>{log=(log+b).slice(-10000);});child.stderr.on('data',b=>{log=(log+b).slice(-10000);});
   const ready=await waitFor(s=>s.pid===child.pid,'The worker never published the finished task');
   assert.equal(ready.bot.awaitingCommand,true);assert.equal(ready.frame,before.frame);
   await command({type:'postgame-goal'});
   const active=await waitFor(s=>s.frame>before.frame+100&&s.phase==='postgame','The postgame checklist did not start');
   assert.equal(active.bot.runScope,'postgame');assert.equal(active.commandError,null);
   await command({type:'shutdown'});
   return {active,file:JSON.parse(readFileSync(join(game,'postgame-agenda.json'))),checkpoint:vault.read()};
  }finally{
   if(child&&child.exitCode===null&&child.signalCode===null){child.kill('SIGTERM');await Promise.race([new Promise(resolve=>child.once('exit',resolve)),sleep(15000)]);if(child.exitCode===null)child.kill('SIGKILL');}
   rmSync(root,{recursive:true,force:true});
  }
 };
 const workflows=agenda=>{
  assert.ok(agenda.workflows,'the checklist resumes the durable agenda workflows');
  assert.deepEqual(agenda.workflows.league.receipt,durable.workflows.league.receipt,'the League rematch receipt survives');
  assert.deepEqual(agenda.workflows.records['hall-sticker'].receipts,durable.workflows.records['hall-sticker'].receipts);
  assert.deepEqual(agenda.workflows.records['egg-sticker'].receipts,durable.workflows.records['egg-sticker'].receipts);
  assert.deepEqual(agenda.workflows.togepi,durable.workflows.togepi);
  assert.deepEqual(agenda.workflows.tower,durable.workflows.tower);
  assert.deepEqual(Object.keys(agenda.workflows.dex.failed).sort(),Object.keys(durable.workflows.dex.failed).sort(),'dex retry deferrals survive');
 };
 const foreign=await checklist({...durable,continuation:{...durable.continuation,campaignId:'run-00000000-0000-0000-0000-000000000000'}});
 assert.equal(foreign.active.postgame.workflows?.league?.receipt,undefined,'another campaign’s agenda is not resumed');
 assert.equal(foreign.active.postgame.workflows?.records,undefined);
 const {active,file,checkpoint}=await checklist(durable);
 workflows(active.postgame);
 assert.equal(active.postgame.entries.find(e=>e.id==='league-rematch').status,'complete','the finished League rematch is not repeated');
 assert.equal(file.enabled,true);workflows(file);
 assert.deepEqual(checkpoint.metadata.session.postgame.qmmLedger,task.qmmLedger,'the Mail-supply ledger survives');
 assert.equal(checkpoint.metadata.session.postgame.agenda.enabled,true);workflows(checkpoint.metadata.session.postgame.agenda);
 console.log('# checklist-agenda verified '+JSON.stringify({frames:checkpoint.metadata.frame-before.frame,workflows:Object.keys(file.workflows)}));
 session.loadSram(checkpoint.sram);session.loadState(checkpoint.state);
 return {before,after:observer.capture()};
}
