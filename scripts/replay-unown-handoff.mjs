import assert from 'node:assert/strict';
import {spawn} from 'node:child_process';
import {mkdtempSync,readFileSync,writeFileSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join,resolve,dirname} from 'node:path';
import {fileURLToPath} from 'node:url';
import {setTimeout as sleep} from 'node:timers/promises';
import {SaveVault,atomicJson} from '../engine/firered/src/suite/save-vault.js';
import {createFireRedObserver} from '../engine/firered/src/evidence/fire-red-observer.js';
import {readPostgameEvidence,POSTGAME_WATCH} from '../engine/firered/src/suite/postgame-agenda.js';
import {selectUnownForm} from '../engine/firered/src/suite/postgame-collection-extras.js';
import {encounterFingerprint} from '../engine/firered/src/player/encounter-tracker.js';
import {unownForm} from '../engine/firered/src/evidence/unown-form.js';
import {continueNativeSaveAsync} from '../engine/firered/src/suite/native-cold-boot.js';

// Exercise the real worker's current-save handoff, form-specific hunt,
// reconstruction, native save, and selection of a different missing form.
export async function replayUnownHandoff({session,saved,inputs,cfg,fixture,corpusPath,createSession}){
 const root=mkdtempSync(join(tmpdir(),'suite-unown-handoff-')),game=join(root,'firered');
 const owner=saved.metadata.session.mission.id;
 const observer=createFireRedObserver({session,...inputs,runId:'unown-handoff-before',storyWatch:POSTGAME_WATCH});
 let raw=observer.capture();
 // A supported pause can retain a fade or freshly reconstructed observer.
 // Let only the copied emulator settle before reading its native inventory.
 for(let frame=0;raw.phase!=='stable'&&frame<240;frame++){session.step([]);raw=observer.capture();}
 const before={...raw,playerMemory:{...raw.playerMemory,postgameEvidence:readPostgameEvidence(session,inputs.runtime,raw)}};
 assert.equal(before.phase,'stable','start from a readable native checkpoint');
 const choice=selectUnownForm(before);assert.ok(choice,'this checkpoint must have an available missing Unown form');
 const record={id:'postgame-unown-native-handoff-'+choice.route.unownForm,request:choice.request,route:choice.route,postgameObjective:'unown-forms'};
 if(fixture.resumeUnownHunt){
  assert.equal(owner,record.id,'the retained worker must own this missing-form request');
  assert.equal(saved.metadata.session.mission.route.unownForm,choice.route.unownForm);
 }
 const basePath=resolve(dirname(corpusPath),fixture.baseCheckpoint),baseRecord=JSON.parse(readFileSync(basePath));
 const base=new SaveVault(dirname(basePath),baseRecord.identity).read(baseRecord);
 new SaveVault(join(game,'saves'),base.identity).write(base.state,base.sram,base.metadata);
 new SaveVault(join(game,'hunts',owner,'native-radio','saves'),saved.identity).write(saved.state,saved.sram,saved.metadata);
 atomicJson(join(game,'active-hunt.json'),{id:owner,nativeRadio:true});
 atomicJson(join(game,'bot-policy.json'),{enabled:true,consolePowered:true,awaitingCommand:false,mode:'postgame',runScope:'postgame'});
 if(saved.metadata.session.postgame?.agenda)atomicJson(join(game,'postgame-agenda.json'),saved.metadata.session.postgame.agenda);
 if(!fixture.resumeUnownHunt)atomicJson(join(game,'queued-hunt.json'),{record,runScope:'postgame',error:null});
 const config=join(root,'config.json');atomicJson(config,{directory:root,node:process.execPath,researchBots:fileURLToPath(new URL('../engine/shared',import.meta.url)),games:{firered:{...cfg,port:0,nativeRadio:{...cfg.nativeRadio,huntId:owner}}}});
 const fingerprints=o=>[...o.playerMemory.trainer.party,...o.playerMemory.trainer.storage.pokemon].filter(p=>p.validity==='valid').map(encounterFingerprint);
 const originalIds=fingerprints(before);
 let child,log='',restarted=false,started=false,last='',result,activationSession=null;
 const status=()=>{try{return JSON.parse(readFileSync(join(game,'status.json')));}catch{return null;}};
 const launch=()=>{
  const env={...process.env};delete env.POKEMON_SUITE_UPDATE_HOLD;delete env.POKEMON_SUITE_MANUAL_LAUNCH;
  child=spawn(process.execPath,[fileURLToPath(new URL('../engine/firered/src/suite/session-worker.js',import.meta.url)),config,'firered'],{env,stdio:['ignore','pipe','pipe']});
  for(const stream of [child.stdout,child.stderr])stream.on('data',b=>{log=(log+b).slice(-16000);});
 };
 const stop=async()=>{
  child.kill('SIGTERM');const code=await Promise.race([new Promise(resolve=>child.once('exit',resolve)),sleep(15000,null,{ref:false})]);assert.equal(code,0,log);child=null;
 };
 try{
  // The Unown hunt length varies with the host's real-time input pacing, so
  // the harness bounds the worker by observed progress rather than by a
  // wall-clock duration a loaded gate host can exhaust mid-capture. The wall
  // backstop only cleans up a hung child; gameplay deadlines are unchanged.
  launch();
  const wallBackstop=Date.now()+2400000,startDeadline=Date.now()+120000,stallDeadline=240000;
  let finished=null,progressFrame=-1,progressAt=Date.now();
  while(Date.now()<wallBackstop){
   assert.equal(child.exitCode,null,log);const s=status();
   const frame=Number(s?.frame);
   if(Number.isSafeInteger(frame)&&frame>progressFrame){progressFrame=frame;progressAt=Date.now();}
   assert.ok(Date.now()-progressAt<stallDeadline,'The Unown worker stopped advancing frames: '+log);
   if(s?.pid===child.pid){
    if(activationSession!==s.sessionId){
     // The seed is an explicitly paused user save. Exercise the supported
     // resume command instead of erasing its retained pause in metadata.
     activationSession=s.sessionId;
     atomicJson(join(game,'command.json'),{type:'set-bot',enabled:true,sessionId:s.sessionId,commandId:'unown-replay-resume-'+s.sessionId});
    }
    const trace=JSON.stringify([s.runId,s.state,s.phase,s.map,s.bot?.reason,s.mission?.phase]);
    if(trace!==last){console.log('# unown-handoff '+s.frame+' '+trace);last=trace;}
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
   assert.ok(started||progressFrame>=0||Date.now()<startDeadline,'The Unown request did not acquire the current save: '+log);
   await sleep(200);
  }
  assert.ok(finished,'The Unown hunt did not complete before the harness backstop (last progress frame '+progressFrame+'): '+log);
  await stop();assert.ok(restarted);
  const final=new SaveVault(join(game,'hunts',record.id,'native-radio','saves'),saved.identity).read();
  assert.deepEqual(final.metadata.campaign.record,saved.metadata.campaign.record);
  const capture=final.metadata.session.captureEvidence??final.metadata.session.player?.encounterSafety?.capture;
  assert.equal(capture?.nativeSaveVerified,true);assert.equal(unownForm(capture.pokemon),choice.route.unownForm);
  session.loadSram(final.sram);session.loadState(final.state);
  const afterRaw=createFireRedObserver({session,...inputs,runId:'unown-handoff-after',storyWatch:POSTGAME_WATCH}).capture();
  const after={...afterRaw,playerMemory:{...afterRaw.playerMemory,postgameEvidence:readPostgameEvidence(session,inputs.runtime,afterRaw)}};
  const cold=await createSession();
  try{
   cold.loadSram(final.sram);
   const reader=createFireRedObserver({session:cold,...inputs,runId:'unown-handoff-cold',storyWatch:POSTGAME_WATCH});
   const loaded=await continueNativeSaveAsync(cold,reader),ids=fingerprints(loaded);
   for(const fp of originalIds)assert.ok(ids.includes(fp),'cold Continue preserves every original Pokémon');
   assert.ok(ids.includes(capture.fingerprint));
   const evidence=readPostgameEvidence(cold,inputs.runtime,loaded);
   assert.ok(evidence.unownForms.includes(choice.route.unownForm));
   const next=selectUnownForm({...loaded,playerMemory:{...loaded.playerMemory,postgameEvidence:evidence}});
   assert.ok(next);assert.notEqual(next.route.unownForm,choice.route.unownForm,'next selection must move on from the saved form');
   result={status:'passed',form:choice.route.unownForm,nextForm:next.route.unownForm,originalIndividuals:originalIds.length,currentIndividuals:ids.length,restarted,coldContinue:true,frame:after.frame,lastProgressFrame:progressFrame};
   atomicJson(join(root,'result.json'),result);console.log('# unown verified '+JSON.stringify(result));
  }finally{cold.close();}
  return {before,after};
 }catch(error){
  atomicJson(join(root,'result.json'),{status:'failed',error:error.stack,started,restarted,latest:status()});throw error;
 }finally{
  if(child&&child.exitCode===null){child.kill('SIGTERM');await Promise.race([new Promise(resolve=>child.once('exit',resolve)),sleep(15000,null,{ref:false})]);if(child.exitCode===null)child.kill('SIGKILL');}
  writeFileSync(join(root,'worker-tail.log'),log);
  if(process.env.SUITE_REPLAY_KEEP==='1')console.log('# retained '+root);else rmSync(root,{recursive:true,force:true});
 }
}
