import assert from 'node:assert/strict';
import {spawn} from 'node:child_process';
import {mkdtempSync,readFileSync,writeFileSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {dirname,join,resolve} from 'node:path';
import {fileURLToPath} from 'node:url';
import {setTimeout as sleep} from 'node:timers/promises';
import {SaveVault,atomicJson} from '../engine/firered/src/suite/save-vault.js';
import {createFireRedObserver} from '../engine/firered/src/evidence/fire-red-observer.js';
import {createPostgameController} from '../engine/firered/src/suite/postgame.js';
import {continueNativeSaveAsync} from '../engine/firered/src/suite/native-cold-boot.js';
import {hiddenPower} from '../engine/firered/src/rng/target-traits.js';

const json=p=>JSON.parse(readFileSync(p));
const identity=p=>JSON.stringify([p.personality,p.otId,...Object.values(p.ivs)]);
const all=t=>[...t.party,...t.storage.pokemon].filter(p=>p.validity==='valid');

// The Saffron Dojo gift asked for as an ordinary Hitmonlee with a chosen Hidden
// Power type. From the retained pre-gift anchor the owner receives Hitmonlee,
// resets to the anchor whenever its IVs give another type, and saves the first
// one that matches. fixture.minRejections pins how many it must turn down on
// the way, so the case fails when the type is ignored.
export async function replayDojoGiftHiddenPower({session,saved,inputs,cfg,fixture,corpusPath,createSession}) {
 const wanted=fixture.hiddenPower;
 assert.ok(wanted?.type&&Number.isInteger(fixture.minRejections),'The case names its Hidden Power type and the rejections before it.');
 const source=resolve(dirname(corpusPath),fixture.checkpoint),sourceVault=new SaveVault(dirname(source),saved.identity);
 const anchor=sourceVault.read(saved.metadata.session.mission.rng.anchor);
 const basePath=resolve(dirname(corpusPath),fixture.baseCheckpoint),baseRecord=json(basePath);
 const base=new SaveVault(dirname(basePath),baseRecord.identity).read(baseRecord);
 const watch=createPostgameController({...inputs,mechanics:inputs.battle}).storyWatch();
 const observer=createFireRedObserver({session,...inputs,runId:'dojo-hidden-power',observeRng:true,storyWatch:watch});
 const before=observer.capture(),originals=all(before.playerMemory.trainer).map(identity);
 session.loadSram(anchor.sram);session.loadState(anchor.state);const anchorFrame=observer.capture().frame;
 session.loadSram(saved.sram);session.loadState(saved.state);
 assert.equal(before.playerMemory.map.id,'MAP_SAFFRON_CITY_DOJO');
 const root=mkdtempSync(join(tmpdir(),'suite-dojo-hidden-power-')),game=join(root,'firered');
 const metadata=structuredClone(saved.metadata),state=metadata.session,run=state.id;
 const vault=new SaveVault(join(game,'hunts',run,'native-radio','saves'),saved.identity);
 new SaveVault(join(game,'saves'),base.identity).write(base.state,base.sram,base.metadata);
 // An ordinary request has no shiny timing: every received Hitmonlee is judged
 // by its traits and a mismatch resets to the mission's pre-gift anchor.
 state.request={...state.request,shiny:'any',hiddenPower:{...wanted}};
 state.player=null;state.mission.status='paused';state.mission.reason=null;
 state.mission.lastFingerprint=null;state.mission.rng=null;metadata.frame=anchorFrame;
 Object.assign(state.mission,{encounters:0,resets:0,repeated:0,recent:[],elapsedMs:0});
 for(const a of [state.mission.anchor,saved.metadata.session.mission.rng.anchor]) {
  const read=sourceVault.read(a);
  writeFileSync(join(vault.directory,a.statePath),read.state);
  writeFileSync(join(vault.directory,a.sramPath),read.sram);
 }
 vault.write(anchor.state,anchor.sram,metadata);
 atomicJson(join(game,'active-hunt.json'),{id:run,nativeRadio:true});
 atomicJson(join(game,'bot-policy.json'),{enabled:false,consolePowered:false,awaitingCommand:false,mode:'postgame',runScope:'task'});
 const configPath=join(root,'config.json');
 atomicJson(configPath,{directory:root,node:process.execPath,researchBots:fileURLToPath(new URL('../engine/shared',import.meta.url)),games:{firered:{...cfg,port:0}}});
 let child=null,log='',sequence=0,after=before;
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
  const commandId='dojo-hp-'+(++sequence);atomicJson(join(game,'command.json'),{...body,commandId,sessionId:status().sessionId});
  if(body.type==='shutdown'){
   const exited=await Promise.race([new Promise(done=>child.once('exit',done)),sleep(15000,null,{ref:false})]);
   assert.equal(exited,0,'checkpoint shutdown');child=null;return;
  }
  const s=await wait(s=>s.lastCommand===commandId,'command '+body.type);assert.equal(s.commandError,null);return s;
 };
 try {
  start();await wait(s=>s.pid===child.pid,'owner ready');
  await command({type:'start',record:{id:run,request:state.request,route:state.mission.route},retryBlockedPolicy:false,runScope:'task'});
  const completed=await wait(s=>{
   assert.notEqual(s.mission?.state,'blocked',s.mission?.reason+' '+JSON.stringify(s.decision));
   return s.mission?.state==='complete';
  },'Hitmonlee with the requested Hidden Power and a native save',600000);
  assert.equal(completed.mission.caught,1);
  assert.equal(completed.bot.awaitingCommand,true,'task completion yields to the next command');
  await command({type:'shutdown'});
  const final=vault.read(),receipt=final.metadata.session.captureEvidence,mission=final.metadata.session.mission;
  assert.equal(receipt.nativeSaveVerified,true);assert.equal(receipt.pokemon.species,106);
  assert.equal(hiddenPower(receipt.pokemon.ivs)?.type,wanted.type,'the saved Hitmonlee has the requested Hidden Power');
  assert.ok(mission.encounters>fixture.minRejections,`it turned down ${mission.encounters-1} Hitmonlee of other types before this one`);
  assert.deepEqual(final.metadata.session.request.hiddenPower,wanted);
  assert.deepEqual(final.metadata.campaign.record,saved.metadata.campaign.record);
  session.loadSram(final.sram);session.loadState(final.state);after=observer.capture();
  assert.equal(after.playerMemory.storyState.flagIds[632],true);
  assert.ok(all(after.playerMemory.trainer).some(p=>identity(p)===identity(receipt.pokemon)));
  for(const id of originals)assert.ok(all(after.playerMemory.trainer).some(p=>identity(p)===id));
  const cold=await createSession();
  try {
   cold.loadSram(final.sram);const loaded=await continueNativeSaveAsync(cold,createFireRedObserver({session:cold,...inputs,runId:'dojo-hidden-power-cold',storyWatch:watch}));
   assert.ok(all(loaded.playerMemory.trainer).some(p=>identity(p)===identity(receipt.pokemon)&&hiddenPower(p.ivs)?.type===wanted.type));
   for(const id of originals)assert.ok(all(loaded.playerMemory.trainer).some(p=>identity(p)===id));
  }finally{cold.close();}
  console.log('# dojo-hidden-power '+JSON.stringify({frame:after.frame,personality:receipt.pokemon.personality,ivs:receipt.pokemon.ivs,
   hiddenPower:hiddenPower(receipt.pokemon.ivs),encounters:mission.encounters,nativeSaveVerified:true,coldContinueVerified:true}));
 }finally{
  if(child&&child.exitCode===null){child.kill('SIGTERM');await Promise.race([new Promise(done=>child.once('exit',done)),sleep(15000,null,{ref:false})]);if(child.exitCode===null)child.kill('SIGKILL');}
  if(process.env.SUITE_REPLAY_KEEP==='1')console.log('# retained private replay '+root);else rmSync(root,{recursive:true,force:true});
 }
 return {before,after};
}
