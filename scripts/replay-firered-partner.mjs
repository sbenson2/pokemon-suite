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
import {encounterFingerprint} from '../engine/firered/src/player/encounter-tracker.js';
import {sameEvolutionIndividual,verifyLocalEvolutionExchange} from '../engine/firered/src/suite/local-evolution.js';
import {continueNativeSave} from '../engine/firered/src/suite/native-cold-boot.js';
const json=p=>JSON.parse(readFileSync(p));
// Independent checks (not the code under test): the partner's individuals as
// sorted fingerprints, and the owner's placeholder rules.
const holdings=t=>{assert.ok(t?.partyValidity==='valid'&&t.storage?.validity==='valid','the partner party and PC are readable');return {party:t.party.map(encounterFingerprint).sort(),storage:t.storage.pokemon.map(encounterFingerprint).sort()};};
const LEGENDARY=new Set([144,145,146,150,151,243,244,245,249,250,251,377,378,379,380,381,382,383,384,385,386]);
const port=()=>new Promise((done,fail)=>{const server=createServer();server.on('error',fail);server.listen(0,'127.0.0.1',()=>{const n=server.address().port;server.close(()=>done(n));});});

// September 23: a second FireRed save serves trade evolutions as an invisible
// partner (Emerald can trade only after the National Dex and Celio's link).
// From the team-evolution checkpoint, with ONLY the FireRed partner configured,
// the ordinary postgame checklist must send the permanent Machoke to the
// partner (a working copy of the owner's banked shiny save), receive the same
// individual back as Machamp, verify both native saves and normal link exits,
// and leave the partner net zero with its ordinary placeholder back. Two real
// FireRed owners plus the host coordinator: controller inputs only.
// September 23 (gate 105): the partner's native RFU receive FIFO overflowed when
// one owner's emulation stalled while the other kept running. A case with
// `partnerStall` stops one owner's whole process (SIGSTOP, a scheduling stall:
// no input, no memory access) once both games reach the named callback on the
// named leg, then resumes it. `restarts: 0`: a stall shorter than the link
// heartbeat must complete without a retry, because the linked owners' frame
// clocks hold the running game. `restarts: 1`: a stall past the heartbeat ends
// the link before the exchange; both owners cold-boot, prove the original
// saves and the source retries the leg once.
export async function replayFireRedPartner({session,saved,inputs,cfg,partnerCfg,partnerRomBytes,createSession,fixture,corpusPath}){
 const owner=fixture.partnerOwner,stall=fixture.partnerStall??null;
 if(stall)assert.ok(['firered',owner].includes(stall.owner)&&/^CB2_\w+$/.test(stall.callback2)&&['outbound','return'].includes(stall.leg)&&Number.isInteger(stall.ms)&&(stall.restarts===0&&stall.ms>=500&&stall.ms<=3500||stall.restarts===1&&stall.ms>=5000&&stall.ms<=8000),'a partner stall names an owner, callback, leg and a bounded duration');
 assert.ok(owner&&partnerCfg?.title==='firered'&&partnerCfg.role==='partner'&&partnerRomBytes,'a FireRed partner replay needs its verified partner owner');
 const root=mkdtempSync(join(tmpdir(),'suite-firered-partner-'));
 const children=new Map(),logs=new Map();let coordinator=null;
 const source=resolve(dirname(corpusPath),fixture.baseCheckpoint),baseRecord=json(source),base=new SaveVault(dirname(source),baseRecord.identity).read(baseRecord);
 const bankPath=resolve(dirname(corpusPath),fixture.partnerCheckpoint),bankRecord=json(bankPath),bank=new SaveVault(dirname(bankPath),bankRecord.identity).read(bankRecord);
 const durable=json(resolve(dirname(corpusPath),fixture.durableAgenda));
 const observer=createFireRedObserver({session,...inputs,runId:'firered-partner'}),before=observer.capture();
 const party=before.playerMemory.trainer.party,machoke=party.find(p=>p.species===67);
 assert.ok(machoke&&!machoke.shiny,'the permanent team carries its Machoke');
 const requestId=`team-partner-${machoke.otId}-${machoke.personality}-68`;
 const others=party.filter(p=>p!==machoke).map(encounterFingerprint).sort();
 // The partner's own starting holdings, read from a throwaway copy of the bank.
 const partnerSession=await createSession();let partnerBefore;
 try{partnerSession.loadSram(bank.sram);partnerSession.loadState(bank.state);partnerBefore=createFireRedObserver({session:partnerSession,...inputs,runId:'firered-partner-bank'}).capture();}
 finally{partnerSession.close();}
 const holdingsBefore=holdings(partnerBefore.playerMemory.trainer);
 assert.notEqual(partnerBefore.playerMemory.trainer.trainerId,before.playerMemory.trainer.trainerId,'two distinct FireRed saves');
 const controller=createPostgameController({...inputs,mechanics:inputs.battle,state:{schema:'pokemon-suite/postgame/v1',agenda:{...durable,active:null},preparation:{kind:'postgame',phase:'complete'}}});
 const run='firered-partner-regression';
 const vault=new SaveVault(join(root,'firered','hunts',run,'native-radio','saves'),saved.identity);
 new SaveVault(join(root,'firered','saves'),base.identity).write(base.state,base.sram,base.metadata);
 vault.write(saved.state,saved.sram,{frame:before.frame,postgame:controller.state()});
 atomicJson(join(root,'firered','active-hunt.json'),{id:run,manual:true,nativeRadio:true});
 atomicJson(join(root,'firered','bot-policy.json'),{enabled:false,consolePowered:false,awaitingCommand:false,mode:'postgame',runScope:'postgame'});
 // The partner imports a temporary copy of the bank as its own working save,
 // through the same verified seed import the live partner owner uses.
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
 const start=game=>{const workerEnv={...env,...(config.games[game].adapterData?{POKEMON_SUITE_ADAPTER_DATA:config.games[game].adapterData}:{})};const child=spawn(process.execPath,[worker,join(root,'config.json'),game],{env:workerEnv,stdio:['ignore','pipe','pipe']});children.set(game,child);logs.set(game,'');for(const stream of [child.stdout,child.stderr])stream.on('data',b=>logs.set(game,(logs.get(game)+b).slice(-10000)));};
 const wait=async(test,message,ms=30000)=>{const at=Date.now();while(Date.now()-at<ms){for(const [game,c] of children)assert.equal(c.exitCode,null,game+' exited: '+logs.get(game));if(test())return;await sleep(200);}throw Error(message+' '+JSON.stringify(Object.fromEntries(owners.map(g=>[g,{frame:status(g)?.frame,objective:status(g)?.bot?.objective?.id,reason:status(g)?.bot?.reason,preparation:status(g)?.bot?.preparation?.phase,preparationReason:status(g)?.bot?.preparation?.reason,local:status(g)?.localEvolution?.phase,localReason:status(g)?.localEvolution?.reason,error:status(g)?.commandError}]))));};
 let sequence=0;
 const command=async(game,body)=>{const commandId='firered-partner-test-'+(++sequence);atomicJson(join(root,game,'command.json'),{...body,commandId,sessionId:status(game).sessionId});await wait(()=>status(game)?.lastCommand===commandId,'Command not acknowledged: '+body.type);assert.equal(status(game).commandError,null);};
 try{
  for(const game of owners)start(game);
  await wait(()=>owners.every(g=>status(g)?.pid===children.get(g).pid),'Both FireRed owners must publish their real checkpoints',60000);
  assert.deepEqual(owners.map(g=>[status(g).game,status(g).owner]),[['firered','firered'],['firered',owner]],'two FireRed owners, one title');
  assert.ok(existsSync(join(root,owner,'owner.lock'))&&existsSync(join(root,'firered','owner.lock')),'each owner holds its own run lock');
  assert.deepEqual(json(join(root,owner,'saves','current.json')).identity,bankRecord.identity,'the partner working copy keeps the FireRed save identity');
  // The host runs the coordinator as PostgamePartners._run does: a command the
  // partner has not acknowledged within its deadline (its cold-boot readiness
  // check is slow under load) is retried on a later tick, never fatal.
  coordinator=spawn(process.env.PYTHON??'python3',['-u','-c','import sys,time\nfrom pathlib import Path\nfrom pokemon_suite.pokemon_sessions import SuiteSessions\nfrom pokemon_suite.postgame_partner import PostgamePartners\np=PostgamePartners(SuiteSessions(Path(sys.argv[1])))\nwhile True:\n try:p.tick()\n except (OSError,ValueError,KeyError) as error:print(error,file=sys.stderr,flush=True)\n time.sleep(.5)',root],{cwd:fileURLToPath(new URL('..',import.meta.url)),env,stdio:['ignore','pipe','pipe']});
  let coordinatorLog='';coordinator.stderr.on('data',b=>{coordinatorLog+=b;});
  const availability=()=>existsSync(join(root,'firered','partner-availability.json'))?json(join(root,'firered','partner-availability.json')):null;
  await wait(()=>availability()?.available&&availability().partners?.some(p=>p.owner===owner),'The FireRed partner must advertise availability');
  assert.deepEqual(availability().partners,[{owner,title:'firered'}],'only the FireRed partner is available');
  await command('firered',{type:'set-bot',enabled:true});
  let last='',chosen=false,stalled=null;const receiptPath=join(root,'firered',`acquisition-${requestId}.json`);
  await wait(()=>{
   assert.equal(coordinator.exitCode,null,'coordinator failed: '+coordinatorLog);
   const fr=status('firered');
   const trace=JSON.stringify([fr?.bot?.objective?.id,...owners.map(g=>[g,status(g)?.bot?.preparation?.phase,status(g)?.localEvolution?.phase,status(g)?.localEvolution?.leg,status(g)?.localEvolution?.reason])]);
   if(trace!==last){console.log('# firered-partner '+fr?.frame+' '+trace);last=trace;}
   if(stall&&!stalled&&fr?.localEvolution?.leg===stall.leg&&owners.every(g=>status(g)?.callback2===stall.callback2)){
    const child=children.get(stall.owner);stalled={frame:fr.frame};child.kill('SIGSTOP');
    console.log('# firered-partner stalled '+JSON.stringify({...stall,frame:fr.frame}));
    setTimeout(()=>{if(child.exitCode===null)child.kill('SIGCONT');stalled.resumed=true;},stall.ms);
   }
   const local=fr?.localEvolution?.requestId;
   if(local)assert.equal(local,requestId,'the teammate travels to the FireRed partner');
   chosen||=local===requestId;
   for(const g of owners)assert.ok(!['waiting','paused'].includes(status(g)?.localEvolution?.phase),g+': '+status(g)?.localEvolution?.reason);
   assert.notEqual(status(owner)?.bot?.preparation?.phase,'waiting',`partner: ${status(owner)?.bot?.preparation?.reason}`);
   return existsSync(receiptPath);
  // A verified retry repeats the whole outbound leg (cold boot, Direct Corner, trade).
  },'The teammate did not finish both exchanges with the FireRed partner',stall?.restarts?1080000:720000);
  assert.ok(chosen,'the postgame checklist reserved the teammate for the exchange');
  if(stall)assert.ok(stalled?.resumed,'the owner stall was injected and released during the exchange');
  const receipt=json(receiptPath);assert.equal(receipt.nativeSaveVerified,true);assert.equal(receipt.pokemon.species,68);assert.ok(sameEvolutionIndividual(machoke,receipt.pokemon));
  const pair=json(join(root,'evolution-pairs',requestId+'.json'));
  assert.equal(pair.phase,'complete');
  if(stall)assert.equal(pair.restarts??0,stall.restarts,stall.restarts?'both owners proved the interrupted leg and retried it once':'the stalled owner was held by the linked frame clock, not restarted');
  assert.deepEqual(pair.reservation.roles,{source:{owner:'firered',title:'firered',trainerId:before.playerMemory.trainer.trainerId},partner:{owner,title:'firered',trainerId:partnerBefore.playerMemory.trainer.trainerId}});
  const placeholder=pair.reservation.partner;
  assert.ok(partnerBefore.playerMemory.trainer.party.some(p=>encounterFingerprint(p)===pair.reservation.partnerFingerprint),'the placeholder is the partner\'s own party member');
  assert.ok(placeholder.shiny===false&&placeholder.isEgg===false&&placeholder.heldItem===0&&!LEGENDARY.has(placeholder.species),'the placeholder is ordinary: not shiny, legendary, an egg or an item holder');
  verifyLocalEvolutionExchange(pair.reservation,'outbound',pair.outbound);verifyLocalEvolutionExchange(pair.reservation,'return',pair.returned);
  for(const leg of ['outbound','returned'])assert.deepEqual(Object.keys(pair[leg]).sort(),['partner','source'],'receipts are keyed by role');
  assert.equal(pair.outbound.partner.pokemon.species,68,'Machoke evolved in the partner FireRed');
  await wait(()=>status(owner)?.bot?.preparation?.phase==='complete'&&status(owner)?.bot?.awaitingCommand===true,'The partner must verify its net-zero return and idle',60000);
  assert.equal(status(owner).bot.preparation.netZeroVerified,true);
  await wait(()=>status('firered')?.postgame?.entries?.find(e=>e.id==='team-evolution')?.status==='complete','The checklist must record the evolved team',60000);
  await command('firered',{type:'set-bot',enabled:false});
  await command(owner,{type:'set-bot',enabled:false});
  const final=vault.read();session.loadSram(final.sram);session.loadState(final.state);
  const after=observer.capture(),team=after.playerMemory.trainer.party;
  const machamp=team.find(p=>sameEvolutionIndividual(machoke,p));
  assert.equal(machamp?.species,68,'Machamp returns to the party as the same individual');
  assert.equal(machamp.heldItem,machoke.heldItem);
  assert.deepEqual(team.filter(p=>p!==machamp).map(encounterFingerprint).sort(),others,'the other five teammates are unchanged');
  // The partner is net zero in its own native save: cold boot its final SRAM.
  const partnerVault=new SaveVault(join(root,owner,'saves'),bankRecord.identity),partnerFinal=partnerVault.read();
  const check=await createSession();
  try{
   check.loadSram(partnerFinal.sram);
   const cold=continueNativeSave(check,createFireRedObserver({session:check,...inputs,runId:'firered-partner-final'}));
   assert.deepEqual(holdings(cold.playerMemory.trainer),holdingsBefore,'the partner holds exactly its original individuals again');
   assert.ok(cold.playerMemory.trainer.party.some(p=>encounterFingerprint(p)===pair.reservation.partnerFingerprint),'the placeholder is back');
   assert.ok(!cold.playerMemory.trainer.party.concat(cold.playerMemory.trainer.storage.pokemon).some(p=>sameEvolutionIndividual(machoke,p)),'the partner kept nothing');
  }finally{check.close();}
  assert.equal(digest(readFileSync(resolve(dirname(bankPath),bankRecord.sramPath))),bankRecord.sramSha256,'the banked partner save is immutable');
  assert.equal(digest(readFileSync(resolve(dirname(bankPath),bankRecord.statePath))),bankRecord.stateSha256,'the banked partner state is immutable');
  console.log('# firered-partner verified '+JSON.stringify({requestId,level:machamp.level,slot:team.indexOf(machamp),placeholder:placeholder.species,partnerTrainerId:partnerBefore.playerMemory.trainer.trainerId}));
  return {before,after};
 }finally{
  for(const child of children.values())if(child.exitCode===null)child.kill('SIGCONT');
  coordinator?.kill('SIGTERM');
  for(const [game,child] of children){if(child.exitCode!==null)continue;child.kill('SIGTERM');await Promise.race([new Promise(done=>child.once('exit',done)),sleep(15000)]);if(child.exitCode===null)child.kill('SIGKILL');}
  if(process.env.SUITE_REPLAY_KEEP==='1')console.log('# retained private replay '+root);else rmSync(root,{recursive:true,force:true});
 }
}
