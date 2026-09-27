import assert from 'node:assert/strict';
import {spawn} from 'node:child_process';
import {mkdtempSync,readFileSync,rmSync,existsSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {dirname,join,resolve} from 'node:path';
import {fileURLToPath} from 'node:url';
import {setTimeout as sleep} from 'node:timers/promises';
import {SaveVault,atomicJson} from '../engine/firered/src/suite/save-vault.js';
import {createFireRedObserver} from '../engine/firered/src/evidence/fire-red-observer.js';
import {encounterFingerprint} from '../engine/firered/src/player/encounter-tracker.js';
import {continueNativeSaveAsync} from '../engine/firered/src/suite/native-cold-boot.js';

const json=p=>JSON.parse(readFileSync(p));
const identity=p=>JSON.stringify([p.species,p.personality,p.otId,p.ivs]);
const all=o=>[...o.playerMemory.trainer.party,...o.playerMemory.trainer.storage.pokemon].filter(p=>p.validity==='valid');

// Live September 24, build 108: the National Dex checklist hunted Nidoran♂ in the
// Safari Zone Center. RNG timing produced the exact target (non-shiny; the request
// accepts any shininess). The hunt protected it and saved the protected anchor, then
// the protected Safari capture refused it as "The protected encounter is unreadable"
// because it admitted only shinies. The owner stayed blocked inside the battle.
// - postgame-safari-dex-capture: from that retained owner state, restarted as an engine
//   install leaves it (stop-game turned the bot off), the owner must show the stop as
//   resumable without acting, then resume on the Bot switch (player task 'resume') and
//   catch the same individual.
// - postgame-safari-dex-entry: from the retained Safari field state of the same visit
//   (before the encounter; the hunt session restored to hunting), the interrupted hunt
//   resumes, RNG timing meets a requested target and the capture must admit it.
// Both catch only through the qualified Safari Ball plan, retire from the Safari, save
// natively (cold Continue shows the Pokémon) and hand back to the checklist.
export async function replaySafariDexCapture({session,saved,inputs,cfg,fixture,corpusPath,createSession}){
 const entry=fixture.target==='postgame-safari-dex-entry';
 const here=dirname(resolve(dirname(corpusPath),fixture.checkpoint)),file=name=>json(join(here,name));
 const record=json(resolve(dirname(corpusPath),fixture.checkpoint)),s=saved.metadata.session,owner=s.id;
 assert.equal(s.mission.method,'safari-land');assert.equal(s.mission.postgameObjective,'national-collection');
 assert.deepEqual(s.mission.captures,[]);assert.equal(s.captureEvidence,null);
 assert.equal(s.request.speciesId,32);assert.equal(s.request.shiny,'any');
 assert.equal(file('active-hunt.json').id,owner);assert.equal(file('postgame-agenda.json').hunts['national-collection'].id,owner);
 const policy=file('bot-policy.json');assert.equal(policy.enabled,true);assert.equal(policy.runScope,'postgame');
 const observer=createFireRedObserver({session,...inputs,runId:'safari-dex-capture'}),before=observer.capture();
 assert.equal(before.playerMemory.map.id,'MAP_SAFARI_ZONE_CENTER');
 assert.equal(before.playerMemory.trainer.pokedex.ownedSpecies.includes(32),false,'Nidoran♂ is not registered yet');
 let target=null;
 if(entry){
  assert.equal(s.mission.status,'running');assert.equal(s.mission.phase,'hunting');assert.equal(s.mission.protected,false);
  assert.equal(before.emulator.inBattle,false);
 }else{
  assert.equal(s.mission.status,'blocked');assert.equal(s.mission.reason,'The protected encounter is unreadable');assert.equal(s.mission.protected,true);
  assert.equal(s.mission.protectedAnchor.stateSha256,record.stateSha256,'the retained checkpoint is the protected anchor');
  assert.equal(s.mission.protectedAnchor.sramSha256,record.sramSha256);
  target=before.playerMemory.encounter?.pokemon;
  assert.equal(before.emulator.inBattle,true);assert.equal(before.playerMemory.battleTypeFlags,132);
  assert.equal(target?.validity,'valid');assert.equal(target.species,32);assert.equal(target.shiny,false);
  assert.equal(encounterFingerprint(target),s.mission.recent.at(-1),'the protected identity is the Pokémon in battle');
  assert.equal(all(before).filter(p=>encounterFingerprint(p)===encounterFingerprint(target)).length,0);
 }
 const originals=all(before).map(identity),party=before.playerMemory.trainer.party.map(identity);

 const root=mkdtempSync(join(tmpdir(),'suite-safari-dex-')),game=join(root,'firered');
 const source=resolve(dirname(corpusPath),fixture.baseCheckpoint),baseRecord=json(source);
 const base=new SaveVault(dirname(source),baseRecord.identity).read(baseRecord);
 new SaveVault(join(game,'saves'),base.identity).write(base.state,base.sram,base.metadata);
 const huntVault=new SaveVault(join(game,'hunts',owner,'native-radio','saves'),saved.identity);
 huntVault.write(saved.state,saved.sram,saved.metadata);
 for(const name of ['postgame-agenda.json','active-hunt.json','recovery.json','rng-profiles.json','bot-settings.json'])atomicJson(join(game,name),file(name));
 // The install's orderly stop-game switches the bot off (set-bot false) before the engine is replaced.
 atomicJson(join(game,'bot-policy.json'),entry?policy:{...policy,enabled:false,consolePowered:false});
 const configPath=join(root,'config.json');
 atomicJson(configPath,{directory:root,node:process.execPath,researchBots:fileURLToPath(new URL('../engine/shared',import.meta.url)),games:{firered:{...cfg,port:0,nativeRadio:{...cfg.nativeRadio,huntId:owner}}}});
 const worker=fileURLToPath(new URL('../engine/firered/src/suite/session-worker.js',import.meta.url));
 let child=null,log='',last='';
 const status=()=>{try{return json(join(game,'status.json'));}catch{return null;}};
 const waitFor=async(predicate,message,{ms,stallMs=ms,progress=x=>x?.frame}={})=>{
  const started=Date.now();let marker,markerAt=Date.now();
  while(Date.now()-started<ms){
   if(child.exitCode!==null)throw Error('Worker exited: '+log.slice(-2000));
   const x=status();
   if(x){
    const trace=JSON.stringify([x.mission?.id===owner?'target':x.mission?.id?.slice(0,40),x.mission?.state,x.mission?.phase,x.bot?.status,x.bot?.activity,x.map]);
    if(trace!==last){console.log('# safari-dex '+x.frame+' '+trace);last=trace;}
   }
   if(x&&predicate(x))return x;
   const next=JSON.stringify(progress(x));if(next!==marker){marker=next;markerAt=Date.now();}
   if(Date.now()-markerAt>stallMs)break;
   await sleep(200);
  }
  const x=status();
  throw Error(message+'; '+JSON.stringify({frame:x?.frame,mission:x?.mission&&{id:x.mission.id,state:x.mission.state,phase:x.mission.phase,reason:x.mission.reason,capturePlan:x.mission.capturePlan},bot:x?.bot,commandError:x?.commandError})+'; '+log.slice(-1500));
 };
 try{
  const env={...process.env};delete env.POKEMON_SUITE_UPDATE_HOLD;delete env.POKEMON_SUITE_MANUAL_LAUNCH;
  child=spawn(process.execPath,[worker,configPath,'firered'],{env,stdio:['ignore','pipe','pipe']});
  child.stdout.on('data',b=>{log=(log+b).slice(-10000);});child.stderr.on('data',b=>{log=(log+b).slice(-10000);});
  await waitFor(x=>x.pid===child.pid,'owner ready',{ms:60000});
  if(!entry){
   // Restarted with the bot off: the retained stop is resumable, and nothing acts on the game.
   const held=await waitFor(x=>x.mission?.id===owner&&x.mission.state==='paused','The retained Safari target stop is not resumable after restart',{ms:30000});
   assert.equal(held.bot.enabled,false);assert.equal(held.frame,before.frame);
   await sleep(1500);assert.equal(status().frame,before.frame,'no input before the owner resumes');
   const commandId='safari-dex-resume';
   atomicJson(join(game,'command.json'),{type:'set-bot',enabled:true,commandId,sessionId:held.sessionId});
   await waitFor(x=>x.lastCommand===commandId,'The Bot switch was not accepted',{ms:60000});
  }
  // The interrupted hunt (bot on) resumes by itself; the retained stop resumes on the Bot switch.
  const resumed=await waitFor(x=>x.mission?.id===owner&&['running','complete'].includes(x.mission.state),entry?'The interrupted Safari hunt did not resume':'The retained Safari target stop did not resume',{ms:60000,stallMs:60000});
  assert.equal(resumed.commandError,null);
  // Only the qualified Safari Ball plan acts; the hunt never blocks on its way to the verified save.
  const completed=await waitFor(x=>{
   if(x.mission?.id===owner)assert.notEqual(x.mission.state,'blocked',x.mission.reason+' '+JSON.stringify(x.decision));
   return x.mission?.id===owner&&x.mission.state==='complete';
  },'The Safari Nidoran♂ was not caught and saved',{ms:1800000,stallMs:300000,
   progress:x=>[x?.mission?.phase,x?.mission?.rng?.phase,x?.mission?.rng?.completed,x?.mission?.capturePlan?.attempt,x?.mission?.capturePlan?.completedSteps,x?.frame]});
  assert.equal(completed.mission.caught,1);assert.equal(completed.mission.reason,'Caught, saved in game, and identity verified.');
  assert.equal(completed.mission.encounters,1,'one Safari encounter, the requested target');
  assert.equal(completed.mission.capturePlan?.method,'timed-safari-ball');assert.equal(completed.mission.capturePlan.completed,true);
  assert.equal(completed.mission.capturePlan.verifiedRepeats,2);
  if(entry)assert.equal(completed.mission.rng?.lastResult?.matched,true,'RNG timing produced the planned encounter');
  // The checklist runs its next objective (a new hunt or other postgame work) from a free field, never blocked.
  const handoff=await waitFor(x=>{
   assert.notEqual(x.bot?.status,'blocked',x.bot?.reason);
   return x.bot?.mode==='postgame'&&x.bot?.activity==='postgame'&&x.bot?.status==='running'&&Boolean(x.bot?.objective?.id)&&x.frame>completed.frame+1200;
  },'The postgame checklist did not continue after the capture',{ms:600000,stallMs:180000});
  assert.equal(handoff.commandError,null);if(handoff.mission?.id===owner)assert.equal(handoff.mission.state,'complete','the saved hunt stays complete');
  child.kill('SIGTERM');await Promise.race([new Promise(done=>child.once('exit',done)),sleep(15000)]);
  const final=huntVault.read(),receipt=final.metadata.session.captureEvidence;
  assert.equal(final.metadata.session.mission.status,'complete');
  assert.equal(receipt.nativeSaveVerified,true);assert.equal(receipt.pokemon.species,32);assert.equal(receipt.pokemon.shiny,false);
  assert.equal(receipt.fingerprint,encounterFingerprint(receipt.pokemon));
  if(entry){
   assert.equal(receipt.pokemon.personality,completed.mission.rng.lastResult.observed,'the caught individual is the RNG-produced target');
   assert.equal(final.metadata.session.mission.recent.at(-1),receipt.fingerprint,'the caught individual is the protected encounter');
   target=receipt.pokemon;
  }else assert.equal(identity(receipt.pokemon),identity(target));
  const plan=json(join(game,`capture-plan-${owner}.json`));
  assert.equal(plan.schema,'pokemon-suite/safari-capture-plan/v1');assert.equal(plan.fingerprint,receipt.fingerprint);
  assert.equal(plan.verified,true);assert.equal(plan.verifiedRepeats,2);
  assert.ok(plan.steps.every(step=>step.buttons.every(b=>['a','b','up','down','left','right'].includes(b))),'controller inputs only');
  const archived=existsSync(join(game,`archived-${owner}.json`))?json(join(game,`archived-${owner}.json`)):null;
  if(archived){assert.equal(archived.mission.status,'complete');assert.equal(archived.mission.captures[0].fingerprint,receipt.fingerprint);}
  // The verified save itself: a cold Continue has the same Nidoran♂, registered as caught, and every original individual.
  const savedSram=readFileSync(join(game,'hunts',owner,'native-radio','saves',`${receipt.savedSramSha256}.sav`));
  const cold=await createSession();let loaded;
  try{
   cold.loadSram(savedSram);loaded=await continueNativeSaveAsync(cold,createFireRedObserver({session:cold,...inputs,runId:'safari-dex-cold'}));
   assert.equal(loaded.playerMemory.map.id,'MAP_FUCHSIA_CITY_SAFARI_ZONE_ENTRANCE','saved after retiring from the Safari Zone');
   assert.ok(all(loaded).some(p=>identity(p)===identity(target)&&p.shiny===false),'cold Continue contains the caught Nidoran♂');
   assert.ok(loaded.playerMemory.trainer.pokedex.ownedSpecies.includes(32),'Nidoran♂ is registered as caught');
   for(const id of originals)assert.ok(all(loaded).some(p=>identity(p)===id),'every original individual is kept');
   assert.deepEqual(loaded.playerMemory.trainer.party.map(identity),party,'the party is unchanged');
  }finally{cold.close();}
  console.log('# '+fixture.target+' verified '+JSON.stringify({personality:target.personality,rng:completed.mission.rng?.method??null,delay:plan.delay,steps:plan.steps.length,
   completedFrame:completed.frame,handoff:{frame:handoff.frame,objective:handoff.bot.objective.id,activity:handoff.bot.activity,map:handoff.map},
   savedSram:receipt.savedSramSha256,coldContinue:true,originals:originals.length}));
  session.loadSram(final.sram);session.loadState(final.state);
  return {before,after:observer.capture()};
 }finally{
  if(child&&child.exitCode===null&&child.signalCode===null){child.kill('SIGTERM');await Promise.race([new Promise(done=>child.once('exit',done)),sleep(15000)]);if(child.exitCode===null)child.kill('SIGKILL');}
  if(process.env.SUITE_REPLAY_KEEP==='1')console.log('# retained private replay '+root);else rmSync(root,{recursive:true,force:true});
 }
}
