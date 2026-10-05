import assert from 'node:assert/strict';
import {spawn} from 'node:child_process';
import {createServer} from 'node:net';
import {mkdtempSync,mkdirSync,copyFileSync,readFileSync,existsSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {dirname,join,resolve} from 'node:path';
import {fileURLToPath} from 'node:url';
import {setTimeout as sleep} from 'node:timers/promises';
import {SaveVault,atomicJson,digest} from '../engine/firered/src/suite/save-vault.js';
import {createFireRedObserver} from '../engine/firered/src/evidence/fire-red-observer.js';
import {createPostgameController} from '../engine/firered/src/suite/postgame.js';
import {postgameChecklist} from '../engine/firered/src/suite/postgame-agenda.js';
import {encounterFingerprint} from '../engine/firered/src/player/encounter-tracker.js';
import {verifyLocalEvolutionExchange} from '../engine/firered/src/suite/local-evolution.js';
import {continueNativeSave} from '../engine/firered/src/suite/native-cold-boot.js';
import {nationalSpeciesId} from '../engine/firered/src/evidence/gen3-national-species.js';
import {loanRestartPoint} from '../engine/firered/test-support/link-faults.js';
const json=p=>JSON.parse(readFileSync(p));
// Independent checks (not the code under test).
const holdings=t=>{assert.ok(t?.partyValidity==='valid'&&t.storage?.validity==='valid','party and PC are readable');return {party:t.party.map(encounterFingerprint).sort(),storage:t.storage.pokemon.map(encounterFingerprint).sort()};};
const port=()=>new Promise((done,fail)=>{const server=createServer();server.on('error',fail);server.listen(0,'127.0.0.1',()=>{const n=server.address().port;server.close(()=>done(n));});});

// September 28 (extra saves): the main FireRed save lacks the Squirtle line
// because it chose Bulbasaur. The FireRed partner (the owner's previous save,
// Squirtle start) holds a non-shiny Blastoise in its party. From the owner's
// Sept 27 Four Island checkpoint, with every local checklist entry waiting on a
// retry, the postgame must ask the extra-save plan (published by the host
// coordinator from the partner's own status), borrow the Blastoise for an
// ordinary PC duplicate, register it, breed a Squirtle Egg at the main save's
// own Day Care with its own Ditto, return the Blastoise before the Egg hatches,
// then hatch, restore the team and save. Two real FireRed owners plus the host
// coordinator; controller inputs only. The partner ends net zero.
// `resume`: native run 1 stopped mid-loan at the Day Care withdrawal menu (its
// list menu is not a stable field frame and the exchange waited instead of
// letting the Day Care task answer it). Both owners' native saves were
// preserved: the main save with its Egg and both parents still in the Day
// Care, the partner holding the main save's duplicate with its loan open. From
// there both owners restart, the main save withdraws both parents, returns the
// Blastoise, hatches the Egg and saves; the partner closes its loan net zero.
// `family`: the same loan for another starter line, e.g. the Charmander line from
// the archived FIRE save's Charizard once that save is parked in a linked Center.
// `restartAt: 'daycare-withdrawal'` (build 126): a fresh loan stops both owners
// (SIGTERM, which persists each owner) as the main save walks back to the Day
// Care for its parents after receiving the Egg, the point where native run 1
// stopped. Both owners restart from what they persisted and must finish the
// loan with the same invariants the preserved `-loan-resume` checkpoint checked.
export async function replayExtraSaveLoan({session,saved,inputs,cfg,partnerCfg,partnerRomBytes,createSession,fixture,corpusPath}){
 const owner=fixture.partnerOwner,resume=fixture.resume===true,restartAt=loanRestartPoint(fixture);
 const family=fixture.family??{needId:'starter-squirtle',subject:9,egg:7,species:[7,8,9]},partnerLabel=fixture.partnerLabel??'RED (partner)';
 assert.ok(owner&&partnerCfg?.title==='firered'&&partnerCfg.role==='partner'&&partnerRomBytes,'an extra-save replay needs its verified FireRed partner owner');
 const root=mkdtempSync(join(tmpdir(),'suite-extra-save-loan-'));
 const children=new Map(),logs=new Map();let coordinator=null;
 const source=resolve(dirname(corpusPath),fixture.baseCheckpoint),baseRecord=json(source),base=new SaveVault(dirname(source),baseRecord.identity).read(baseRecord);
 const bankPath=resolve(dirname(corpusPath),fixture.partnerCheckpoint),bankRecord=json(bankPath),bank=new SaveVault(dirname(bankPath),bankRecord.identity).read(bankRecord);
 const observer=createFireRedObserver({session,...inputs,runId:'extra-save-loan'}),before=observer.capture();
 const t0=before.playerMemory.trainer,owned0=new Set(t0.pokedex.ownedSpecies);
 const ledger0=resume?bankRecord.metadata?.extraSaveLedger?.open:null,exchange0=resume?saved.metadata?.postgame?.acquisition:null;
 if(resume){
  assert.equal(exchange0?.kind,'extra-save');assert.equal(exchange0.phase,'daycare','the main save stopped mid-loan');
  assert.equal(ledger0?.exchangeId,exchange0.requestId,'the partner holds the open loan for this exchange');
 }else assert.deepEqual(family.species.map(id=>owned0.has(id)),family.species.map(()=>false),'the main save starts without this starter line');
 const dittos=resume?[]:[...t0.party,...t0.storage.pokemon].filter(p=>p.species===132&&!p.shiny);
 if(!resume)assert.ok(dittos.length>=1,'the main save holds its own Ditto');
 const partnerSession=await createSession();let partnerBefore;
 try{partnerSession.loadSram(bank.sram);partnerSession.loadState(bank.state);partnerBefore=createFireRedObserver({session:partnerSession,...inputs,runId:'extra-save-loan-bank'}).capture();}
 finally{partnerSession.close();}
 // The partner's original individuals: the bank, or its loan's recorded holdings.
 const holdingsBefore=resume?ledger0.holdingsBefore:holdings(partnerBefore.playerMemory.trainer);
 const blastoise=resume?null:partnerBefore.playerMemory.trainer.party.find(p=>p.species===family.subject&&!p.shiny);
 const blastoiseFp=resume?ledger0.lent:encounterFingerprint(blastoise);
 if(!resume)assert.ok(blastoise&&!blastoise.shiny,'the partner party holds its non-shiny lent Pokémon');
 assert.notEqual(partnerBefore.playerMemory.trainer.trainerId,t0.trainerId,'two distinct FireRed saves');
 // Every local checklist entry waits on a retry, so only the extra-save plan can choose work.
 const failures=Object.fromEntries(postgameChecklist(before,{},null).map(e=>[e.id,{retryAt:Date.now()+86400000,reason:'Deferred for the extra-save replay.'}]));
 const controller=createPostgameController({...inputs,mechanics:inputs.battle,state:{schema:'pokemon-suite/postgame/v1',agenda:{schema:'pokemon-suite/postgame-agenda/v1',enabled:true,active:null,entries:[],failures,workflows:{}},preparation:{kind:'postgame',phase:'complete'}}});
 const run='extra-save-loan-regression';
 const vault=new SaveVault(join(root,'firered','hunts',run,'native-radio','saves'),saved.identity);
 new SaveVault(join(root,'firered','saves'),base.identity).write(base.state,base.sram,base.metadata);
 // A resumed main save keeps its own postgame (the exchange mid-loan); a fresh one gets the deferred checklist.
 vault.write(saved.state,saved.sram,resume?saved.metadata:{frame:before.frame,postgame:controller.state()});
 atomicJson(join(root,'firered','active-hunt.json'),{id:run,manual:true,nativeRadio:true});
 atomicJson(join(root,'firered','bot-policy.json'),{enabled:false,consolePowered:false,awaitingCommand:false,mode:'postgame',runScope:'postgame'});
 const copy=join(root,'partner-bank-copy');mkdirSync(copy);
 for(const name of [bankRecord.statePath,bankRecord.sramPath])copyFileSync(join(dirname(bankPath),name),join(copy,name));
 const seed={stateFilePath:join(copy,bankRecord.statePath),sramFilePath:join(copy,bankRecord.sramPath),stateSha256:bankRecord.stateSha256,sramSha256:bankRecord.sramSha256,frame:bankRecord.metadata?.frame??0};
 mkdirSync(join(root,owner));
 atomicJson(join(root,owner,'bot-policy.json'),{enabled:true,consolePowered:true,awaitingCommand:true,mode:'evolution-partner',runScope:'task'});
 // A resumed partner continues its own working copy, with its ledger (never a fresh seed).
 if(resume)new SaveVault(join(root,owner,'saves'),bankRecord.identity).write(bank.state,bank.sram,bank.metadata);
 const {seed:_mainSeed,...mainCfg}=cfg;
 const config={schema:'pokemon-suite/config/v1',directory:root,node:process.execPath,researchBots:fileURLToPath(new URL('../engine/shared',import.meta.url)),
  games:{firered:{...cfg,port:await port()},[owner]:{...mainCfg,nativeRadio:{cartridge:partnerCfg.nativeRadio.cartridge,core:partnerCfg.nativeRadio.core},title:'firered',role:'partner',label:partnerLabel,...(resume?{}:{seed}),port:await port()}}};
 atomicJson(join(root,'config.json'),config);
 const worker=fileURLToPath(new URL('../engine/firered/src/suite/session-worker.js',import.meta.url));
 const env={...process.env};for(const key of ['POKEMON_SUITE_UPDATE_HOLD','POKEMON_SUITE_MANUAL_LAUNCH','POKEMON_SUITE_DESKTOP_NODE'])delete env[key];
 const owners=['firered',owner];
 const status=game=>{try{return json(join(root,game,'status.json'));}catch{return null;}};
 const start=game=>{const workerEnv={...env,...(config.games[game].adapterData?{POKEMON_SUITE_ADAPTER_DATA:config.games[game].adapterData}:{})};const child=spawn(process.execPath,[worker,join(root,'config.json'),game],{env:workerEnv,stdio:['ignore','pipe','pipe']});children.set(game,child);logs.set(game,'');for(const stream of [child.stdout,child.stderr])stream.on('data',b=>logs.set(game,(logs.get(game)+b).slice(-10000)));};
 const wait=async(test,message,ms=30000)=>{const at=Date.now();while(Date.now()-at<ms){for(const [game,c] of children)assert.equal(c.exitCode,null,game+' exited: '+logs.get(game));if(test())return;await sleep(250);}throw Error(message+' '+JSON.stringify(Object.fromEntries(owners.map(g=>[g,{frame:status(g)?.frame,map:status(g)?.map,objective:status(g)?.bot?.objective?.id,reason:status(g)?.bot?.reason,preparation:status(g)?.bot?.preparation?.phase,preparationReason:status(g)?.bot?.preparation?.reason,local:status(g)?.localEvolution?.phase,localReason:status(g)?.localEvolution?.reason,extra:status(g)?.extraSaves?.find(r=>r.needId===family.needId),error:status(g)?.commandError}]))));};
 let sequence=0;
 const command=async(game,body)=>{const commandId='extra-save-loan-test-'+(++sequence);atomicJson(join(root,game,'command.json'),{...body,commandId,sessionId:status(game).sessionId});await wait(()=>status(game)?.lastCommand===commandId,'Command not acknowledged: '+body.type);assert.equal(status(game).commandError,null);};
 const agenda=()=>{try{return json(join(root,'firered','postgame-agenda.json'));}catch{return null;}};
 try{
  for(const game of owners)start(game);
  await wait(()=>owners.every(g=>status(g)?.pid===children.get(g).pid),'Both FireRed owners must publish their real checkpoints',60000);
  await wait(()=>status(owner)?.extraSaveInventory?.pokemon?.length>0,'The partner must publish its inventory',60000);
  if(resume)assert.equal(status(owner).extraSaveLedger?.open?.exchangeId,exchange0.requestId,'the restarted partner keeps its open loan');
  coordinator=spawn(process.env.PYTHON??'python3',['-u','-c','import sys,time\nfrom pathlib import Path\nfrom pokemon_suite.pokemon_sessions import SuiteSessions\nfrom pokemon_suite.postgame_partner import PostgamePartners\np=PostgamePartners(SuiteSessions(Path(sys.argv[1])))\nwhile True:\n try:p.tick()\n except (OSError,ValueError,KeyError) as error:print(error,file=sys.stderr,flush=True)\n if p.extra_error:print(p.extra_error,file=sys.stderr,flush=True)\n time.sleep(.5)',root],{cwd:fileURLToPath(new URL('..',import.meta.url)),env,stdio:['ignore','pipe','pipe']});
  let coordinatorLog='';coordinator.stderr.on('data',b=>{coordinatorLog=(coordinatorLog+b).slice(-5000);});
  if(!resume)await wait(()=>existsSync(join(root,'firered','extra-save-sources.json'))&&json(join(root,'firered','extra-save-sources.json')).sources?.some(s=>s.source.owner===owner),'The host must publish the partner as an extra-save source '+coordinatorLog,60000);
  await command('firered',{type:'set-bot',enabled:true});
  let last='',opened=null,closed=null,sawPlan=false,eggReceived=false,restartDue=false,restarted=null;
  const TRANSFER=/Waiting for .* to lend|Returning the borrowed|A separate compatible game/;
  const loanDone=()=>{
   assert.equal(coordinator.exitCode,null,'coordinator failed: '+coordinatorLog);
   const fr=status('firered'),row=fr?.extraSaves?.find(r=>r.needId===family.needId);
   // The restart point: back at the Day Care Woman for the parents after the Day Care Man handed over the Egg.
   if(restartAt&&!restarted){
    const objective=fr?.bot?.objective?.id??'';
    if(objective.endsWith('-daycare-FourIsland_EventScript_DaycareMan'))eggReceived=true;
    if(eggReceived&&fr?.map==='MAP_FOUR_ISLAND_POKEMON_DAY_CARE'&&objective.endsWith('-daycare-FourIsland_PokemonDayCare_EventScript_DaycareWoman')){restartDue=true;return true;}
   }
   sawPlan||=row?.mode==='borrow and return'&&row.save===partnerLabel;
   const p=fr?.bot?.preparation;
   const trace=JSON.stringify([fr?.bot?.objective?.id,fr?.map,p?.kind,p?.phase,row?.doing,...owners.map(g=>[g,status(g)?.localEvolution?.phase,status(g)?.localEvolution?.requestId])]);
   if(trace!==last){console.log('# extra-save-loan '+fr?.frame+' '+trace);last=trace;}
   if(fr?.bot?.status==='blocked'&&!(p?.kind==='extra-save'&&['waiting-for-transfer','preparing-transfer'].includes(p.phase))&&!TRANSFER.test(fr?.bot?.reason??''))assert.fail('main blocked: '+fr.bot.reason);
   for(const g of owners)assert.ok(!['waiting','paused'].includes(status(g)?.localEvolution?.phase),g+': '+status(g)?.localEvolution?.reason);
   assert.notEqual(status(owner)?.bot?.preparation?.phase,'waiting',`partner: ${status(owner)?.bot?.preparation?.reason}`);
   const local=fr?.localEvolution;
   if(local?.requestId?.endsWith('-open'))opened??=local.requestId;
   if(local?.requestId?.endsWith('-close'))closed??=local.requestId;
   return (agenda()?.acquisitions??[]).some(r=>r.method==='extra-save'&&r.mode==='loan'&&r.nativeSaveVerified);
  };
  // Stop both owners as the app would on quit, prove the mid-loan state they
  // persisted, start them again and let the loan finish.
  const restartOwners=async()=>{
   console.log('# extra-save-loan restart '+JSON.stringify({at:restartAt,frame:status('firered')?.frame,map:status('firered')?.map}));
   for(const game of owners)children.get(game).kill('SIGTERM');
   for(const game of owners){
    const child=children.get(game);
    if(child.exitCode===null&&child.signalCode===null)await Promise.race([new Promise(done=>child.once('exit',done)),sleep(60000)]);
    assert.ok(child.exitCode!==null||child.signalCode!==null,game+' stopped for the restart');
   }
   const exchange=json(join(root,'firered','hunts',run,'native-radio','saves','current.json')).metadata?.postgame?.acquisition;
   assert.equal(exchange?.kind,'extra-save');assert.equal(exchange.phase,'daycare','the main save stopped mid-loan');
   assert.ok(exchange.daycare?.egg,'the Egg was received before the restart');
   const ledger=json(join(root,owner,'saves','current.json')).metadata?.extraSaveLedger?.open;
   assert.equal(ledger?.exchangeId,exchange.requestId,'the partner holds the open loan for this exchange');
   for(const game of owners)start(game);
   await wait(()=>owners.every(g=>status(g)?.pid===children.get(g).pid),'Both FireRed owners must publish their real checkpoints',60000);
   await wait(()=>status(owner)?.extraSaveInventory?.pokemon?.length>0,'The partner must publish its inventory',60000);
   assert.equal(status(owner).extraSaveLedger?.open?.exchangeId,exchange.requestId,'the restarted partner keeps its open loan');
   await command('firered',{type:'set-bot',enabled:true});
   return {exchangeId:exchange.requestId,frame:status('firered')?.frame};
  };
  await wait(loanDone,'The loan did not finish both legs, the Egg and the final save',3600000);
  if(restartDue){
   restarted=await restartOwners();restartDue=false;
   await wait(loanDone,'The loan did not finish both legs, the Egg and the final save after the restart',3600000);
  }
  if(restartAt)assert.ok(restarted,'both owners restarted at the '+restartAt);
  if(!resume)assert.ok(sawPlan,'the host showed the loan route, its partner save and an unknown ETA');
  const receipt=(agenda().acquisitions).find(r=>r.method==='extra-save');
  assert.deepEqual(receipt.registered,[family.subject,family.egg],'the lent Pokémon registered by the trade, the Egg species by hatching');
  assert.deepEqual(receipt.legs.map(l=>l.leg),['open','close']);assert.equal(receipt.daycareSkipped,null);
  const exchangeId=receipt.requestId;
  for(const leg of resume?['close']:['open','close']){
   const pair=json(join(root,'evolution-pairs',`${exchangeId}-${leg}.json`));
   assert.equal(pair.phase,'complete');assert.equal(pair.reservation.method,'single');verifyLocalEvolutionExchange(pair.reservation,'outbound',pair.outbound);
   assert.deepEqual(pair.reservation.roles,{source:{owner:'firered',title:'firered',trainerId:t0.trainerId},partner:{owner,title:'firered',trainerId:partnerBefore.playerMemory.trainer.trainerId}});
  }
  if(!resume)assert.equal(opened,`${exchangeId}-open`);
  assert.equal(closed,`${exchangeId}-close`);
  await wait(()=>status(owner)?.extraSaveLedger?.open===null&&status(owner)?.bot?.awaitingCommand===true,'The partner must close its loan and idle',60000);
  await command('firered',{type:'set-bot',enabled:false});
  await command(owner,{type:'set-bot',enabled:false});
  const final=vault.read();session.loadSram(final.sram);session.loadState(final.state);
  const after=observer.capture(),t=after.playerMemory.trainer,all=[...t.party,...t.storage.pokemon];
  const owned=new Set(t.pokedex.ownedSpecies);
  assert.ok(owned.has(family.subject)&&owned.has(family.egg),'the Pokédex registers the lent species and the hatched one');
  assert.ok(!all.some(p=>encounterFingerprint(p)===blastoiseFp),'the lent Pokémon went back');
  const squirtle=all.find(p=>encounterFingerprint(p)===receipt.fingerprint);
  assert.equal(nationalSpeciesId(squirtle?.species),family.egg);assert.equal(squirtle.isEgg,false);assert.equal(squirtle.otId,t0.otId,'the hatchling is the main save\'s own');
  const legOpen=receipt.legs.find(l=>l.leg==='open');
  assert.equal(all.filter(p=>encounterFingerprint(p)===legOpen.offered).length,1,'the main save\'s duplicate came back');
  const ditto=resume?exchange0.route.breed.dittoFingerprint:encounterFingerprint(dittos[0]);
  assert.equal(all.filter(p=>encounterFingerprint(p)===ditto).length,1,'the Ditto stays');
  const originalParty=resume?exchange0.originalParty:t0.party.map(encounterFingerprint);
  assert.deepEqual(t.party.map(encounterFingerprint).sort(),[...originalParty].sort(),'the original team is back in the party');
  const partnerVault=new SaveVault(join(root,owner,'saves'),bankRecord.identity),partnerFinal=partnerVault.read();
  const check=await createSession();
  try{
   check.loadSram(partnerFinal.sram);
   const cold=continueNativeSave(check,createFireRedObserver({session:check,...inputs,runId:'extra-save-loan-partner-final'}));
   assert.deepEqual(holdings(cold.playerMemory.trainer),holdingsBefore,'the partner holds exactly its original individuals again');
   const back=cold.playerMemory.trainer.party.find(p=>encounterFingerprint(p)===blastoiseFp);
   assert.ok(back,'the lent Pokémon is back in the partner party');
  }finally{check.close();}
  assert.equal(digest(readFileSync(resolve(dirname(bankPath),bankRecord.sramPath))),bankRecord.sramSha256,'the partner checkpoint is immutable');
  if(restarted)assert.equal(restarted.exchangeId,exchangeId,'the restarted loan is the one that finished');
  console.log('# extra-save-loan verified '+JSON.stringify({exchangeId,registered:receipt.registered,hatched:receipt.fingerprint,frame:after.frame,...(restarted?{restartedAt:restartAt}:{})}));
  return {before,after};
 }finally{
  coordinator?.kill('SIGTERM');
  for(const [game,child] of children){if(child.exitCode!==null)continue;child.kill('SIGTERM');await Promise.race([new Promise(done=>child.once('exit',done)),sleep(15000)]);if(child.exitCode===null)child.kill('SIGKILL');}
  if(process.env.SUITE_REPLAY_KEEP==='1')console.log('# retained private replay '+root);else rmSync(root,{recursive:true,force:true});
 }
}
