import assert from 'node:assert/strict';
import {spawn} from 'node:child_process';
import {createServer} from 'node:net';
import {mkdtempSync,mkdirSync,copyFileSync,readFileSync,readdirSync,existsSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {dirname,join,resolve} from 'node:path';
import {fileURLToPath} from 'node:url';
import {setTimeout as sleep} from 'node:timers/promises';
import {SaveVault,atomicJson,digest} from '../engine/firered/src/suite/save-vault.js';
import {createFireRedObserver} from '../engine/firered/src/evidence/fire-red-observer.js';
import {createPostgameController} from '../engine/firered/src/suite/postgame.js';
import {encounterFingerprint} from '../engine/firered/src/player/encounter-tracker.js';
import {sameEvolutionIndividual,verifyLocalEvolutionExchange} from '../engine/firered/src/suite/local-evolution.js';
import {continueNativeSave} from '../engine/firered/src/suite/native-cold-boot.js';
import {nationalSpeciesId} from '../engine/firered/src/evidence/gen3-national-species.js';
const json=p=>JSON.parse(readFileSync(p));
const holdings=t=>{assert.ok(t?.partyValidity==='valid'&&t.storage?.validity==='valid','the party and PC are readable');return {party:t.party.map(encounterFingerprint).sort(),storage:t.storage.pokemon.map(encounterFingerprint).sort()};};
const port=()=>new Promise((done,fail)=>{const server=createServer();server.on('error',fail);server.listen(0,'127.0.0.1',()=>{const n=server.address().port;server.close(()=>done(n));});});
const KINGS_ROCK=187,POLIWHIRL=61,POLITOED=186;
const bagCount=(t,id)=>Object.values(t.bag??{}).flat().reduce((n,i)=>n+(i?.itemId===id?Number(i.quantity)||0:0),0);

// Live October 4 (engine 125.1): with the FireRed partner ready, the main save
// finished with "1 waits for the FireRed partner game to be ready for its trade
// round trip: politoed". It owned no Poliwhirl, and its only King's Rock was
// held by the party Dragonite. From that exact save (an engine-125 exhausted
// record), with Flareon and Bellossom deferred, the national collection must:
// - entry: catch a plain spare Poliwhirl (the existing Super Rod spare hunt);
// - take the King's Rock from the Dragonite, withdraw the Poliwhirl and equip it;
// - completion: trade it to the FireRed partner (it evolves there), receive the
//   same individual back as Politoed, verify both native saves and link exits;
// - handoff: Politoed is registered and saved, the King's Rock is consumed, the
//   Dragonite holds nothing, and the partner is net zero.
// Two real FireRed owners plus the host coordinator; controller inputs only.
export async function replayPolitoedPartner({session,saved,inputs,cfg,partnerCfg,partnerRomBytes,createSession,fixture,corpusPath}){
 const owner=fixture.partnerOwner;
 assert.ok(owner&&partnerCfg?.title==='firered'&&partnerCfg.role==='partner'&&partnerRomBytes,'a Politoed replay needs its verified FireRed partner owner');
 const root=mkdtempSync(join(tmpdir(),'suite-politoed-partner-'));
 const children=new Map(),logs=new Map();let coordinator=null,coordinatorLog='';
 const source=resolve(dirname(corpusPath),fixture.baseCheckpoint),baseRecord=json(source),base=new SaveVault(dirname(source),baseRecord.identity).read(baseRecord);
 const bankPath=resolve(dirname(corpusPath),fixture.partnerCheckpoint),bankRecord=json(bankPath),bank=new SaveVault(dirname(bankPath),bankRecord.identity).read(bankRecord);
 const observer=createFireRedObserver({session,...inputs,runId:'politoed-partner'}),before=observer.capture(),t0=before.playerMemory.trainer;
 const everyone0=[...t0.party,...t0.storage.pokemon];
 assert.ok(!t0.pokedex.ownedSpecies.includes(POLITOED),'Politoed is missing at the stop');
 assert.ok(!everyone0.some(p=>nationalSpeciesId(p.species)===POLIWHIRL),'no Poliwhirl is owned at the stop');
 assert.equal(bagCount(t0,KINGS_ROCK),0,'no King’s Rock in the Bag');
 const holder=t0.party.find(p=>p.heldItem===KINGS_ROCK);
 assert.ok(holder&&holder.shiny===false,'a plain teammate holds the only King’s Rock');
 const shinies=everyone0.filter(p=>p.shiny).map(p=>({fp:encounterFingerprint(p),heldItem:p.heldItem,moves:JSON.stringify(p.moves)}));
 // The partner's own starting holdings, read from a throwaway copy of the bank.
 const partnerSession=await createSession();let partnerBefore;
 try{partnerSession.loadSram(bank.sram);partnerSession.loadState(bank.state);partnerBefore=createFireRedObserver({session:partnerSession,...inputs,runId:'politoed-partner-bank'}).capture();}
 finally{partnerSession.close();}
 const holdingsBefore=holdings(partnerBefore.playerMemory.trainer);
 assert.notEqual(partnerBefore.playerMemory.trainer.trainerId,t0.trainerId,'two distinct FireRed saves');
 // The live retained postgame state; Flareon and Bellossom keep ordinary retry records.
 const retained=structuredClone(saved.metadata.session.postgame);
 assert.ok(retained.agenda.workflows.dex.exhausted&&retained.agenda.workflows.dex.exhausted.workflows===undefined,'the live save carries the engine-125 exhausted record');
 retained.agenda.workflows.dex.failed??={};
 for(const id of fixture.defer??[])retained.agenda.workflows.dex.failed[id]={reason:'Deferred in this isolated Politoed replay.',attempts:1,retryAt:Date.parse('2100-01-01T00:00:00Z')};
 const controller=createPostgameController({...inputs,mechanics:inputs.battle,state:retained});
 const run='politoed-partner-regression';
 const vault=new SaveVault(join(root,'firered','hunts',run,'native-radio','saves'),saved.identity);
 new SaveVault(join(root,'firered','saves'),base.identity).write(base.state,base.sram,base.metadata);
 vault.write(saved.state,saved.sram,{frame:before.frame,postgame:controller.state()});
 atomicJson(join(root,'firered','active-hunt.json'),{id:run,manual:true,nativeRadio:true});
 atomicJson(join(root,'firered','bot-policy.json'),{enabled:false,consolePowered:false,awaitingCommand:false,mode:'postgame',runScope:'postgame'});
 const copy=join(root,'partner-bank-copy');mkdirSync(copy);
 for(const name of [bankRecord.statePath,bankRecord.sramPath])copyFileSync(join(dirname(bankPath),name),join(copy,name));
 const seed={stateFilePath:join(copy,bankRecord.statePath),sramFilePath:join(copy,bankRecord.sramPath),stateSha256:bankRecord.stateSha256,sramSha256:bankRecord.sramSha256,frame:bankRecord.metadata?.frame??0};
 mkdirSync(join(root,owner));
 atomicJson(join(root,owner,'bot-policy.json'),{enabled:true,consolePowered:true,awaitingCommand:true,mode:'evolution-partner',runScope:'task'});
 const {seed:_mainSeed,...mainCfg}=cfg;
 const config={schema:'pokemon-suite/config/v1',directory:root,node:process.execPath,researchBots:fileURLToPath(new URL('../engine/shared',import.meta.url)),
  games:{firered:{...cfg,port:await port()},[owner]:{...mainCfg,nativeRadio:{cartridge:partnerCfg.nativeRadio.cartridge,core:partnerCfg.nativeRadio.core},title:'firered',role:'partner',seed,port:await port()}}};
 atomicJson(join(root,'config.json'),config);
 const worker=fileURLToPath(new URL('../engine/firered/src/suite/session-worker.js',import.meta.url));
 const env={...process.env};for(const key of ['POKEMON_SUITE_UPDATE_HOLD','POKEMON_SUITE_MANUAL_LAUNCH','POKEMON_SUITE_DESKTOP_NODE'])delete env[key];
 const owners=['firered',owner];
 const status=game=>{try{return json(join(root,game,'status.json'));}catch{return null;}};
 const start=game=>{const child=spawn(process.execPath,[worker,join(root,'config.json'),game],{env,stdio:['ignore','pipe','pipe']});children.set(game,child);logs.set(game,'');for(const stream of [child.stdout,child.stderr])stream.on('data',b=>logs.set(game,(logs.get(game)+b).slice(-10000)));};
 const wait=async(test,message,ms=30000)=>{const at=Date.now();while(Date.now()-at<ms){for(const [game,c] of children)assert.equal(c.exitCode,null,game+' exited: '+logs.get(game));if(test())return;await sleep(250);}throw Error(message+' '+JSON.stringify(Object.fromEntries(owners.map(g=>[g,{frame:status(g)?.frame,objective:status(g)?.bot?.objective?.id,status:status(g)?.bot?.status,reason:status(g)?.bot?.reason,preparation:status(g)?.bot?.preparation?.phase,preparationReason:status(g)?.bot?.preparation?.reason,local:status(g)?.localEvolution?.phase,localReason:status(g)?.localEvolution?.reason,error:status(g)?.commandError}]))));};
 let sequence=0;
 const command=async(game,body)=>{const commandId='politoed-partner-test-'+(++sequence);atomicJson(join(root,game,'command.json'),{...body,commandId,sessionId:status(game).sessionId});await wait(()=>status(game)?.lastCommand===commandId,'Command not acknowledged: '+body.type);assert.equal(status(game).commandError,null);};
 const receipt=()=>{try{return readdirSync(join(root,'firered')).find(name=>/^acquisition-dex-partner-\d+-\d+-186\.json$/.test(name))??null;}catch{return null;}};
 try{
  for(const game of owners)start(game);
  await wait(()=>owners.every(g=>status(g)?.pid===children.get(g).pid),'Both FireRed owners must publish their real checkpoints',60000);
  coordinator=spawn(process.env.PYTHON??'python3',['-u','-c','import sys,time\nfrom pathlib import Path\nfrom pokemon_suite.pokemon_sessions import SuiteSessions\nfrom pokemon_suite.postgame_partner import PostgamePartners\np=PostgamePartners(SuiteSessions(Path(sys.argv[1])))\nwhile True:\n try:p.tick()\n except (OSError,ValueError,KeyError) as error:print(error,file=sys.stderr,flush=True)\n time.sleep(.5)',root],{cwd:fileURLToPath(new URL('..',import.meta.url)),env,stdio:['ignore','pipe','pipe']});
  coordinator.stderr.on('data',b=>{coordinatorLog=(coordinatorLog+b).slice(-20000);});
  const availability=()=>existsSync(join(root,'firered','partner-availability.json'))?json(join(root,'firered','partner-availability.json')):null;
  await wait(()=>availability()?.available&&availability().partners?.some(p=>p.owner===owner),'The FireRed partner must advertise availability',120000);
  await command('firered',{type:'set-bot',enabled:true});
  let last='',caught=null,taken=false,equipped=false;
  await wait(()=>{
   assert.equal(coordinator.exitCode,null,'coordinator failed: '+coordinatorLog);
   const fr=status('firered'),t=fr?.trainer??null;
   const trace=JSON.stringify([fr?.map,fr?.bot?.status,fr?.bot?.objective?.id??fr?.mission?.name,fr?.bot?.preparation?.phase,...owners.map(g=>[g,status(g)?.localEvolution?.phase,status(g)?.localEvolution?.leg])]);
   if(trace!==last){console.log('# politoed-partner '+fr?.frame+' '+trace);last=trace;}
   // A verified wait for the partner transfer publishes as blocked; only the exchange phases must not stop.
   for(const g of owners)assert.ok(!['waiting','paused'].includes(status(g)?.localEvolution?.phase),g+': '+status(g)?.localEvolution?.reason);
   const request=fr?.localEvolution?.requestId??fr?.bot?.preparation?.requestId;
   if(request)assert.match(String(request),/^dex-partner-\d+-\d+-186$/,'only the Politoed round trip uses the partner');
   return Boolean(receipt());
  },'Politoed did not finish its round trip with the FireRed partner',Number(fixture.timeoutMs??3600000));
  const requestId=receipt().replace(/^acquisition-|\.json$/g,'');
  const r=json(join(root,'firered',receipt()));
  assert.equal(r.nativeSaveVerified,true);assert.equal(nationalSpeciesId(r.pokemon.species),POLITOED);
  const pair=json(join(root,'evolution-pairs',requestId+'.json'));
  assert.equal(pair.phase,'complete');
  assert.equal(nationalSpeciesId(pair.reservation.source.species),POLIWHIRL,'a Poliwhirl left the main save');
  assert.equal(pair.reservation.source.heldItem,KINGS_ROCK,'holding the King’s Rock');
  assert.equal(pair.reservation.source.shiny,false);
  assert.ok(sameEvolutionIndividual(pair.reservation.source,r.pokemon),'the same individual came back');
  verifyLocalEvolutionExchange(pair.reservation,'outbound',pair.outbound);verifyLocalEvolutionExchange(pair.reservation,'return',pair.returned);
  assert.equal(nationalSpeciesId(pair.outbound.partner.pokemon.species),POLITOED,'Poliwhirl evolved in the partner FireRed');
  assert.deepEqual(pair.reservation.roles.partner,{owner,title:'firered',trainerId:partnerBefore.playerMemory.trainer.trainerId});
  await wait(()=>status(owner)?.bot?.preparation?.phase==='complete'&&status(owner)?.bot?.awaitingCommand===true,'The partner must verify its net-zero return and idle',120000);
  assert.equal(status(owner).bot.preparation.netZeroVerified,true);
  await command('firered',{type:'set-bot',enabled:false});
  await command(owner,{type:'set-bot',enabled:false});
  // The spare hunt moves the owner's save to that hunt's vault; read the active one.
  const active=json(join(root,'firered','active-hunt.json')).id;
  const final=(active===run?vault:new SaveVault(join(root,'firered','hunts',active,'native-radio','saves'),saved.identity)).read();
  session.loadSram(final.sram);session.loadState(final.state);
  const after=observer.capture(),trainer=after.playerMemory.trainer,everyone=[...trainer.party,...trainer.storage.pokemon];
  assert.ok(trainer.pokedex.ownedSpecies.includes(POLITOED),'Politoed is registered');
  assert.equal(everyone.filter(p=>sameEvolutionIndividual(r.pokemon,p)&&nationalSpeciesId(p.species)===POLITOED).length,1,'Politoed is owned as the same individual');
  assert.equal(bagCount(trainer,KINGS_ROCK),0,'the King’s Rock was consumed');
  const dragonite=everyone.find(p=>p.personality===holder.personality&&p.otId===holder.otId);
  assert.equal(dragonite?.heldItem,0,'the teammate gave up its King’s Rock');
  for(const p of everyone0)assert.equal(everyone.filter(q=>q.personality===p.personality&&q.otId===p.otId).length,1,'every original individual is kept');
  for(const s of shinies){const kept=everyone.find(p=>encounterFingerprint(p)===s.fp);assert.ok(kept&&kept.heldItem===s.heldItem&&JSON.stringify(kept.moves)===s.moves,'every shiny is unchanged');}
  const partnerVault=new SaveVault(join(root,owner,'saves'),bankRecord.identity),partnerFinal=partnerVault.read();
  const check=await createSession();
  try{
   check.loadSram(partnerFinal.sram);
   const cold=continueNativeSave(check,createFireRedObserver({session:check,...inputs,runId:'politoed-partner-final'}));
   assert.deepEqual(holdings(cold.playerMemory.trainer),holdingsBefore,'the partner holds exactly its original individuals again');
  }finally{check.close();}
  assert.equal(digest(readFileSync(resolve(dirname(bankPath),bankRecord.sramPath))),bankRecord.sramSha256,'the banked partner save is immutable');
  console.log('# politoed-partner verified '+JSON.stringify({requestId,frames:after.frame-before.frame,placeholder:pair.reservation.partner?.species,partnerTrainerId:partnerBefore.playerMemory.trainer.trainerId}));
  return {before,after};
 }finally{
  coordinator?.kill('SIGTERM');
  for(const [game,child] of children){if(child.exitCode!==null)continue;child.kill('SIGTERM');await Promise.race([new Promise(done=>child.once('exit',done)),sleep(15000)]);if(child.exitCode===null)child.kill('SIGKILL');}
  if(process.env.SUITE_REPLAY_KEEP==='1')console.log('# retained private replay '+root);else rmSync(root,{recursive:true,force:true});
 }
}
