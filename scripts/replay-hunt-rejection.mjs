import assert from 'node:assert/strict';
import {spawn} from 'node:child_process';
import {mkdtempSync,readFileSync,rmSync,existsSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join,resolve,dirname} from 'node:path';
import {fileURLToPath} from 'node:url';
import {setTimeout as sleep} from 'node:timers/promises';
import {SaveVault,atomicJson} from '../engine/firered/src/suite/save-vault.js';
import {createFireRedObserver} from '../engine/firered/src/evidence/fire-red-observer.js';

export async function replayHuntRejection({session,saved,inputs,cfg,fixture,corpusPath}){
 const root=mkdtempSync(join(tmpdir(),'suite-hunt-rejection-')),game=join(root,'firered');
 const owner=saved.metadata.session.mission.id,postgame=saved.metadata.session.postgame;
 const record=postgame.agenda.hunts.snorlax;
 assert.ok(record?.id);assert.equal(postgame.deferredAcquisitions.length,1);
 const source=resolve(dirname(corpusPath),fixture.baseCheckpoint),baseRecord=JSON.parse(readFileSync(source));
 const base=new SaveVault(dirname(source),baseRecord.identity).read(baseRecord);
 new SaveVault(join(game,'saves'),base.identity).write(base.state,base.sram,base.metadata);
 const vault=new SaveVault(join(game,'hunts',owner,'native-radio','saves'),saved.identity);
 vault.write(saved.state,saved.sram,saved.metadata);
 atomicJson(join(game,'active-hunt.json'),{id:owner,nativeRadio:true});
 atomicJson(join(game,'bot-policy.json'),{enabled:true,consolePowered:true,awaitingCommand:false,mode:'postgame',runScope:'postgame'});
 // Restart at the real rejected handoff. Neither cartridge memory nor agenda
 // eligibility is modified to make an alternative succeed.
 atomicJson(join(game,'queued-hunt.json'),{record,runScope:'postgame',error:'This game has another hunt. Finish or explicitly archive it before starting a different request.'});
 const config=join(root,'config.json');atomicJson(config,{directory:root,node:process.execPath,researchBots:fileURLToPath(new URL('../engine/shared',import.meta.url)),games:{firered:{...cfg,port:0,nativeRadio:{...cfg.nativeRadio,huntId:owner}}}});
 const before=createFireRedObserver({session,...inputs,runId:'rejected-handoff'}).capture();
 let child,log='';
 const status=()=>{try{return JSON.parse(readFileSync(join(game,'status.json')));}catch{return null;}};
 try{
  const env={...process.env};delete env.POKEMON_SUITE_UPDATE_HOLD;delete env.POKEMON_SUITE_MANUAL_LAUNCH;
  child=spawn(process.execPath,[fileURLToPath(new URL('../engine/firered/src/suite/session-worker.js',import.meta.url)),config,'firered'],{env,stdio:['ignore','pipe','pipe']});
  for(const stream of [child.stdout,child.stderr])stream.on('data',b=>{log=(log+b).slice(-6000);});
  const until=Date.now()+90000;let moved=null;
  while(Date.now()<until){
   assert.equal(child.exitCode,null,log);
   const s=status();
   if(s&&s.frame>before.frame+100&&(s.map!==before.playerMemory.map.id||JSON.stringify(s.position)!==JSON.stringify(before.playerMemory.position))&&!s.commandError){moved=s;break;}
   await sleep(200);
  }
  assert.ok(moved,'A rejected automatic hunt must release its clean owner and make alternative progress: '+log);
  atomicJson(join(game,'command.json'),{type:'shutdown',sessionId:moved.sessionId,commandId:'rejection-replay-stop'});
  const code=await Promise.race([new Promise(resolve=>child.once('exit',resolve)),sleep(15000,null,{ref:false})]);assert.equal(code,0);child=null;
  const agenda=JSON.parse(readFileSync(join(game,'postgame-agenda.json')));
  assert.equal(agenda.failures.snorlax.attempts,(postgame.agenda.failures.snorlax?.attempts??0)+1);assert.match(agenda.failures.snorlax.reason,/another hunt/);
  assert.equal(agenda.hunts.snorlax,undefined);assert.equal(existsSync(join(game,'queued-hunt.json')),false);
  const final=vault.read(),state=final.metadata.session.postgame;
  const retained=state.acquisition??state.deferredAcquisitions[0]?.state;
  assert.equal(retained.requestId,postgame.deferredAcquisitions[0].state.requestId);
  assert.deepEqual(final.metadata.campaign.record,saved.metadata.campaign.record);
  assert.equal(final.metadata.session.mission.id,owner);
  session.loadSram(final.sram);session.loadState(final.state);
  const after=createFireRedObserver({session,...inputs,runId:'rejection-result'}).capture();
  console.log('# rejected-handoff '+JSON.stringify({frame:after.frame,map:after.playerMemory.map.id,position:after.playerMemory.position,requestId:retained.requestId,attempts:agenda.failures.snorlax.attempts}));
  return {before,after};
 }finally{
  if(child&&child.exitCode===null){child.kill('SIGTERM');await Promise.race([new Promise(resolve=>child.once('exit',resolve)),sleep(15000,null,{ref:false})]);if(child.exitCode===null)child.kill('SIGKILL');}
  rmSync(root,{recursive:true,force:true});
 }
}
