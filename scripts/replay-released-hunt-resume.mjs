import assert from 'node:assert/strict';
import {spawn} from 'node:child_process';
import {mkdtempSync,readFileSync,rmSync,existsSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {dirname,join,resolve} from 'node:path';
import {fileURLToPath} from 'node:url';
import {setTimeout as sleep} from 'node:timers/promises';
import {SaveVault,atomicJson} from '../engine/firered/src/suite/save-vault.js';
import {createFireRedObserver} from '../engine/firered/src/evidence/fire-red-observer.js';

// Live September 23, 11:56: a Slugma hunt for the National Dex had exhausted its
// navigation recovery; the checklist deferred it and continued. The first
// automatic Emerald exchange (Kadabra → Alakazam) then paused the postgame and
// completed both trades and saves, but the still-attached blocked hunt and its
// needs-review recovery kept the postgame from resuming, so the exchange's final
// FireRed verification never ran. From that retained owner state, the worker must
// resume the checklist, verify and save the returned Alakazam, and leave the
// released hunt's review intact. A later retry of the deferred objective is a new
// hunt with its own recovery budget.
export async function replayReleasedHuntResume({session,saved,inputs,cfg,fixture,corpusPath}){
 const here=dirname(resolve(dirname(corpusPath),fixture.checkpoint)),file=name=>JSON.parse(readFileSync(join(here,name)));
 const s=saved.metadata.session,owner=s.id,requestId=s.postgame.dexEvolution.requestId;
 assert.equal(s.mission.status,'blocked');assert.equal(s.mission.postgameObjective,'national-collection');assert.equal(s.mission.protected,false);
 assert.equal(file('recovery.json').current.status,'needs-review');
 assert.equal(saved.metadata.localEvolution.phase,'complete','both exchanges and saves finished');
 assert.equal(s.postgame.dexEvolution.index,2,'only the FireRed verification remains');
 const root=mkdtempSync(join(tmpdir(),'suite-released-hunt-')),game=join(root,'firered');
 const source=resolve(dirname(corpusPath),fixture.baseCheckpoint),baseRecord=JSON.parse(readFileSync(source));
 const base=new SaveVault(dirname(source),baseRecord.identity).read(baseRecord);
 new SaveVault(join(game,'saves'),base.identity).write(base.state,base.sram,base.metadata);
 new SaveVault(join(game,'hunts',owner,'native-radio','saves'),saved.identity).write(saved.state,saved.sram,saved.metadata);
 for(const name of ['recovery.json','postgame-agenda.json','bot-policy.json','active-hunt.json'])atomicJson(join(game,name),file(name));
 const configPath=join(root,'config.json');
 atomicJson(configPath,{directory:root,node:process.execPath,researchBots:fileURLToPath(new URL('../engine/shared',import.meta.url)),games:{firered:{...cfg,port:0,nativeRadio:{...cfg.nativeRadio,huntId:owner}}}});
 const worker=fileURLToPath(new URL('../engine/firered/src/suite/session-worker.js',import.meta.url));
 const observer=createFireRedObserver({session,...inputs,runId:'released-hunt-resume'}),before=observer.capture();
 let child=null,log='',last='';
 const status=()=>{try{return JSON.parse(readFileSync(join(game,'status.json')));}catch{return null;}};
 const waitFor=async(predicate,message,timeout)=>{
  const started=Date.now();while(Date.now()-started<timeout){
   if(child.exitCode!==null)throw Error('Worker exited: '+log.slice(-2000));
   const x=status();
   if(x){const trace=JSON.stringify([x.phase,x.bot?.status,x.bot?.objective?.id,x.bot?.reason]);if(trace!==last){console.log('# released-hunt '+x.frame+' '+trace);last=trace;}}
   if(x&&predicate(x))return x;await sleep(200);
  }
  throw Error(message+'; '+JSON.stringify({frame:status()?.frame,bot:status()?.bot,commandError:status()?.commandError})+'; '+log.slice(-1000));
 };
 try{
  const env={...process.env};delete env.POKEMON_SUITE_UPDATE_HOLD;delete env.POKEMON_SUITE_MANUAL_LAUNCH;
  child=spawn(process.execPath,[worker,configPath,'firered'],{env,stdio:['ignore','pipe','pipe']});
  child.stdout.on('data',b=>{log=(log+b).slice(-10000);});child.stderr.on('data',b=>{log=(log+b).slice(-10000);});
  const receipt=join(game,`acquisition-${requestId}.json`);
  await waitFor(x=>x.pid===child.pid&&existsSync(receipt),'The postgame did not resume and verify the returned Alakazam',240000);
  const r=JSON.parse(readFileSync(receipt));assert.equal(r.nativeSaveVerified,true);assert.equal(r.pokemon.species,65);
  const active=await waitFor(x=>x.frame>before.frame+300&&x.bot?.status!=='blocked','The checklist did not continue after the verification',120000);
  assert.equal(active.commandError,null);
  const recovery=JSON.parse(readFileSync(join(game,'recovery.json'))),records=[...(recovery.history??[]),recovery.current].filter(h=>h?.huntId===owner);
  assert.equal(records.at(-1)?.status,'needs-review','the released hunt keeps its review and is not retried');
  assert.ok(active.mission?.id!==owner||active.mission?.state==='blocked','only a new hunt may retry the deferred objective');
  child.kill('SIGTERM');await Promise.race([new Promise(done=>child.once('exit',done)),sleep(15000)]);
  const current=JSON.parse(readFileSync(join(game,'active-hunt.json'))).id;
  const checkpoint=new SaveVault(join(game,'hunts',current,'native-radio','saves'),saved.identity).read();
  assert.ok(checkpoint.metadata.frame>before.frame);
  console.log('# released-hunt-resume verified '+JSON.stringify({requestId,frames:checkpoint.metadata.frame-before.frame}));
  session.loadSram(checkpoint.sram);session.loadState(checkpoint.state);
  return {before,after:observer.capture()};
 }finally{
  if(child&&child.exitCode===null&&child.signalCode===null){child.kill('SIGTERM');await Promise.race([new Promise(done=>child.once('exit',done)),sleep(15000)]);if(child.exitCode===null)child.kill('SIGKILL');}
  rmSync(root,{recursive:true,force:true});
 }
}
