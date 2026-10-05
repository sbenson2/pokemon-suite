import assert from 'node:assert/strict';
import {spawn} from 'node:child_process';
import {mkdtempSync,readFileSync,rmSync,existsSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {dirname,join,resolve} from 'node:path';
import {fileURLToPath} from 'node:url';
import {setTimeout as sleep} from 'node:timers/promises';
import {SaveVault,atomicJson} from '../engine/firered/src/suite/save-vault.js';
import {createFireRedObserver} from '../engine/firered/src/evidence/fire-red-observer.js';
import {createPostgameController} from '../engine/firered/src/suite/postgame.js';
import {readPostgameEvidence} from '../engine/firered/src/suite/postgame-agenda.js';
import {encounterFingerprint} from '../engine/firered/src/player/encounter-tracker.js';
import {continueNativeSaveAsync} from '../engine/firered/src/suite/native-cold-boot.js';

const json=p=>JSON.parse(readFileSync(p));
const all=o=>[...o.playerMemory.trainer.party,...o.playerMemory.trainer.storage.pokemon].filter(p=>p.validity==='valid');
const identity=p=>JSON.stringify([p.species,p.personality,p.otId,p.ivs]);
const QWILFISH=211,KRABBY=98,KINGLER=99,SUPER_ROD=264,GOOD_ROD=263;

// Live September 28 (build 123): after a Switch trade the FireRed owner stood at
// the Lavender Pokémon Center 2F, "waiting": the National Dex entry found no
// executable work, although Krabby and Qwilfish are FireRed fishing catches.
// From that preserved checkpoint and its durable agenda:
// - entry: the retained owner's first decision is a fishing hunt for a missing
//   species with the rod its table slot needs, never another dependency wait;
// - the real session worker resumes the postgame, hands the hunt to its fishing
//   mission, collects a rod the save lacks from its giver (the Good Rod from the
//   Fuchsia City fishing guru's brother), restarts while fishing (an update
//   handoff), fishes until the target bites, catches it and saves in game (cold
//   Continue shows it, the rod and every other individual);
// - handoff: the checklist continues with the next National Dex work (Kingler
//   from the caught Krabby through the existing evolution path).
export async function replayNationalFishing({session,saved,inputs,cfg,fixture,corpusPath,createSession}){
 const s=saved.metadata.session,owner=s.id,retained=structuredClone(s.postgame);
 assert.equal(retained.status,'dependency');assert.match(retained.reason,/available source, route or compatible partner/);
 assert.equal(retained.agenda.failures['national-collection'].requiresStateChange,true,'the live owner parked the National Dex entry');
 const clock=Date.parse(saved.updatedAt);
 // Isolate the fishing catches: the other local routes (Bellossom, the trade
 // and breed routes, the trade evolutions) keep ordinary per-species retry
 // records, as the national-ember replay isolates Slugma. Each has its own case.
 const durable=json(resolve(dirname(corpusPath),fixture.durableAgenda));
 for(const agenda of [retained.agenda,durable]){
  const failed=((agenda.workflows??={}).dex??={}).failed??={};
  for(const id of [182,186,212,108,124,238,360,133,138])failed[id]={reason:'Deferred in this isolated fishing replay.',attempts:1,retryAt:Date.parse('2100-01-01T00:00:00Z')};
 }
 const controller=createPostgameController({...inputs,mechanics:inputs.battle,state:structuredClone(retained),clock:()=>clock});
 const observer=createFireRedObserver({session,...inputs,runId:'national-fishing',storyWatch:controller.storyWatch()});
 const capture=()=>{const raw=observer.capture();return {...raw,playerMemory:{...raw.playerMemory,postgameEvidence:readPostgameEvidence(session,inputs.runtime,raw)}};};
 const before=capture();
 assert.equal(before.playerMemory.map.id,'MAP_LAVENDER_TOWN_POKEMON_CENTER_2F');
 const owned=before.playerMemory.trainer.pokedex.ownedSpecies;
 assert.ok(!owned.includes(QWILFISH)&&!owned.includes(KRABBY),'Qwilfish and Krabby are missing');
 const bag=id=>Object.values(before.playerMemory.trainer.bag).flat().some(i=>i.itemId===id);
 assert.ok(bag(SUPER_ROD)&&!bag(GOOD_ROD),'this save holds only the Super Rod');
 const first=controller.decide(before);
 assert.equal(first.kind,'postgame-hunt',JSON.stringify({kind:first.kind,reason:first.reason}));
 assert.equal(first.route.method,'fishing');assert.ok([KRABBY,QWILFISH].includes(first.request.speciesId),'a missing fishing species');
 assert.equal(first.route.rodItemId,first.request.speciesId===KRABBY?GOOD_ROD:SUPER_ROD,'the rod whose table slots hold it');
 const target=first.request.speciesId,rod=first.route.rodItemId;
 const originals=all(before).map(identity);

 const root=mkdtempSync(join(tmpdir(),'suite-national-fishing-')),game=join(root,'firered');
 // The stock profile vault (the worker's initial save), as the Safari Dex case seeds it.
 const source=resolve(dirname(corpusPath),fixture.baseCheckpoint),baseRecord=json(source);
 const base=new SaveVault(dirname(source),baseRecord.identity).read(baseRecord);
 new SaveVault(join(game,'saves'),base.identity).write(base.state,base.sram,base.metadata);
 new SaveVault(join(game,'hunts',owner,'native-radio','saves'),saved.identity).write(saved.state,saved.sram,{...saved.metadata,session:{...s,postgame:retained}});
 atomicJson(join(game,'active-hunt.json'),{id:owner,nativeRadio:true});
 atomicJson(join(game,'bot-policy.json'),{enabled:true,mode:'postgame',consolePowered:true,runScope:'postgame',awaitingCommand:false});
 atomicJson(join(game,'postgame-agenda.json'),durable);
 const configPath=join(root,'config.json');
 atomicJson(configPath,{directory:root,node:process.execPath,researchBots:fileURLToPath(new URL('../engine/shared',import.meta.url)),games:{firered:{...cfg,port:0,nativeRadio:{...cfg.nativeRadio,huntId:owner}}}});
 const worker=fileURLToPath(new URL('../engine/firered/src/suite/session-worker.js',import.meta.url));
 let child=null,log='',last='';
 const status=()=>{try{return json(join(game,'status.json'));}catch{return null;}};
 const huntRoute=id=>{try{return json(join(game,'hunts',id,'native-radio','saves','current.json')).metadata.session.mission?.route??null;}catch{return null;}};
 const start=()=>{
  const env={...process.env};delete env.POKEMON_SUITE_UPDATE_HOLD;delete env.POKEMON_SUITE_MANUAL_LAUNCH;
  child=spawn(process.execPath,[worker,configPath,'firered'],{env,stdio:['ignore','pipe','pipe']});
  child.stdout.on('data',b=>{log=(log+b).slice(-12000);});child.stderr.on('data',b=>{log=(log+b).slice(-12000);});
 };
 const stopWorker=async()=>{if(child&&child.exitCode===null&&child.signalCode===null){child.kill('SIGTERM');await Promise.race([new Promise(done=>child.once('exit',done)),sleep(20000)]);if(child.exitCode===null&&child.signalCode===null)child.kill('SIGKILL');}child=null;};
 const waitFor=async(predicate,message,{ms,stallMs=ms,progress=x=>x?.frame}={})=>{
  const started=Date.now();let marker,markerAt=Date.now();
  while(Date.now()-started<ms){
   if(child.exitCode!==null)throw Error('Worker exited: '+log.slice(-2000));
   const x=status();
   if(x){
    const trace=JSON.stringify([x.mission?.id?.slice(0,48),x.mission?.state,x.mission?.phase,x.mission?.route,x.mission?.encounters,x.bot?.status,x.bot?.activity,x.map??x.observation?.map?.id]);
    if(trace!==last){console.log('# national-fishing '+x.frame+' '+trace);last=trace;}
    if(x.mission&&x.mission.id!==owner&&x.mission.state==='blocked')assert.fail('the hunt stopped: '+x.mission.reason);
   }
   if(x&&predicate(x))return x;
   const next=JSON.stringify(progress(x));if(next!==marker){marker=next;markerAt=Date.now();}
   if(Date.now()-markerAt>stallMs)break;
   await sleep(250);
  }
  const x=status();
  throw Error(message+'; '+JSON.stringify({frame:x?.frame,mission:x?.mission&&{id:x.mission.id,state:x.mission.state,phase:x.mission.phase,reason:x.mission.reason},bot:x?.bot&&{status:x.bot.status,reason:x.bot.reason},commandError:x?.commandError})+'; '+log.slice(-1500));
 };
 const fishing=x=>x?.mission&&x.mission.id!==owner&&x.mission.method==='fishing';
 try{
  start();
  await waitFor(x=>x.pid===child.pid,'owner ready',{ms:90000});
  // The worker resumes the checklist, which hands the fishing hunt to its
  // mission; a rod the save lacks is collected from its giver first.
  let collected=false;
  const hunting=await waitFor(x=>{collected||=fishing(x)&&x.mission.phase==='collecting-rod';
   return fishing(x)&&x.mission.speciesId===target&&x.mission.phase==='hunting'&&x.mission.state==='running';},'The fishing hunt did not reach its fishing spot',{ms:1800000,stallMs:240000});
  const hunt=hunting.mission.id;
  assert.equal(huntRoute(hunt)?.rodItemId,rod);
  assert.equal(collected,!bag(rod),'the hunt collected its rod exactly when the save lacked it');
  // Update handoff while fishing: an orderly stop, then the same hunt resumes.
  await stopWorker();start();
  await waitFor(x=>x.pid===child.pid&&x.mission?.id===hunt&&['running','complete'].includes(x.mission.state),'The fishing hunt did not resume after the restart',{ms:120000});
  const done=await waitFor(x=>x.mission?.id===hunt&&x.mission.state==='complete','The fishing target was not caught and saved',
   {ms:2400000,stallMs:300000,progress:x=>[x?.mission?.phase,x?.mission?.encounters,x?.frame]});
  assert.equal(done.mission.caught,1);assert.equal(done.mission.reason,'Caught, saved in game, and identity verified.');
  const receipt=new SaveVault(join(game,'hunts',hunt,'native-radio','saves'),saved.identity).read().metadata.session.captureEvidence;
  assert.equal(receipt.nativeSaveVerified,true);assert.equal(receipt.pokemon.species,target);assert.equal(receipt.fingerprint,encounterFingerprint(receipt.pokemon));
  // Handoff: the checklist continues with the next National Dex work: Kingler
  // from this Krabby (the existing level-up evolution), or the other fishing catch.
  const next=await waitFor(x=>x.bot?.activity==='postgame'&&(target===KRABBY?String(x.bot?.preparation?.requestId).endsWith(`-${receipt.pokemon.personality}-${KINGLER}`):fishing(x)&&x.mission.id!==hunt),
   'The checklist did not hand off the next National Dex work',{ms:600000,stallMs:240000});
  const handoff=target===KRABBY?{evolution:next.bot.preparation.requestId,objective:next.bot.objective?.id}:{hunt:next.mission.id,rod:huntRoute(next.mission.id)?.rodItemId};
  await stopWorker();
  // The verified save itself: a cold Continue has the Qwilfish and every original individual.
  const savedSram=readFileSync(join(game,'hunts',hunt,'native-radio','saves',`${receipt.savedSramSha256}.sav`));
  const cold=await createSession();let loaded;
  try{
   cold.loadSram(savedSram);loaded=await continueNativeSaveAsync(cold,createFireRedObserver({session:cold,...inputs,runId:'national-fishing-cold'}));
   assert.ok(all(loaded).some(p=>identity(p)===identity(receipt.pokemon)),'cold Continue contains the caught Pokémon');
   assert.ok(loaded.playerMemory.trainer.pokedex.ownedSpecies.includes(target),'the catch is registered');
   assert.ok(Object.values(loaded.playerMemory.trainer.bag).flat().some(i=>i.itemId===rod),'the rod is in the saved Bag');
   for(const id of originals)assert.ok(all(loaded).some(p=>identity(p)===id),'every original individual is kept');
  }finally{cold.close();}
  console.log('# national-fishing verified '+JSON.stringify({caught:{species:target,rod,rodCollected:collected,personality:receipt.pokemon.personality,shiny:receipt.pokemon.shiny,encounters:done.mission.encounters},
   completedFrame:done.frame,handoff,savedSram:receipt.savedSramSha256,originals:originals.length}));
  const final=new SaveVault(join(game,'hunts',hunt,'native-radio','saves'),saved.identity).read();
  session.loadSram(final.sram);session.loadState(final.state);
  return {before,after:observer.capture()};
 }finally{
  await stopWorker();
  if(process.env.SUITE_REPLAY_KEEP==='1')console.log('# retained private replay '+root);else rmSync(root,{recursive:true,force:true});
 }
}
