import assert from 'node:assert/strict';
import {spawn} from 'node:child_process';
import {createServer} from 'node:net';
import {mkdtempSync,readFileSync,existsSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {dirname,join,resolve} from 'node:path';
import {fileURLToPath} from 'node:url';
import {setTimeout as sleep} from 'node:timers/promises';
import {SaveVault,atomicJson,digest} from '../engine/firered/src/suite/save-vault.js';
import {createFireRedObserver} from '../engine/firered/src/evidence/fire-red-observer.js';
import {createPostgameController} from '../engine/firered/src/suite/postgame.js';
import {encounterFingerprint} from '../engine/firered/src/player/encounter-tracker.js';
import {sameEvolutionIndividual,verifyLocalEvolutionExchange} from '../engine/firered/src/suite/local-evolution.js';
const json=p=>JSON.parse(readFileSync(p));
const port=()=>new Promise((done,fail)=>{const server=createServer();server.on('error',fail);server.listen(0,'127.0.0.1',()=>{const n=server.address().port;server.close(()=>done(n));});});

// September 23: the permanent team's Machoke (L93) could not reach Machamp. The
// automatic partner route takes only PC spares for missing Dex entries, and
// Machamp was needed by the team, not the Dex. From the live save after the Rare
// Candy supply, the ordinary postgame checklist with the Emerald partner ready
// must choose the teammate itself, trade it to Emerald, receive the same
// individual back as Machamp in the party, verify both native saves, and keep
// the other five members. Two actual owners and the host coordinator: no
// injected trade receipts, fabricated Pokémon or game-memory writes.
export async function replayTeamTradeEvolution({session,saved,inputs,cfg,partnerCfg,partnerRomBytes,fixture,corpusPath}){
 assert.ok(partnerCfg&&partnerRomBytes,'a paired replay needs the verified companion ROM');
 const root=mkdtempSync(join(tmpdir(),'suite-team-trade-evolution-'));
 const children=new Map(),logs=new Map();let coordinator=null;
 const source=resolve(dirname(corpusPath),fixture.baseCheckpoint),baseRecord=json(source),base=new SaveVault(dirname(source),baseRecord.identity).read(baseRecord);
 const peerPath=resolve(dirname(corpusPath),fixture.partnerCheckpoint),peerRecord=json(peerPath),peer=new SaveVault(dirname(peerPath),peerRecord.identity).read(peerRecord);
 const durable=json(resolve(dirname(corpusPath),fixture.durableAgenda));
 const observer=createFireRedObserver({session,...inputs,runId:'team-trade-evolution'}),before=observer.capture();
 const party=before.playerMemory.trainer.party,machoke=party.find(p=>p.species===67);
 assert.ok(machoke&&!machoke.shiny,'the permanent team carries its Machoke');
 assert.ok(durable.continuation.teamPlan.permanentFamilies.some(f=>f.includes(67)&&f.includes(68)));
 const requestId=`team-partner-${machoke.otId}-${machoke.personality}-68`;
 const others=party.filter(p=>p!==machoke).map(encounterFingerprint).sort();
 const controller=createPostgameController({...inputs,mechanics:inputs.battle,state:{schema:'pokemon-suite/postgame/v1',agenda:{...durable,active:null},preparation:{kind:'postgame',phase:'complete'}}});
 const run='team-trade-evolution-regression';
 const vault=new SaveVault(join(root,'firered','hunts',run,'native-radio','saves'),saved.identity);
 new SaveVault(join(root,'firered','saves'),base.identity).write(base.state,base.sram,base.metadata);
 vault.write(saved.state,saved.sram,{frame:before.frame,postgame:controller.state()});
 atomicJson(join(root,'firered','active-hunt.json'),{id:run,manual:true,nativeRadio:true});
 atomicJson(join(root,'firered','bot-policy.json'),{enabled:false,consolePowered:false,awaitingCommand:false,mode:'postgame',runScope:'postgame'});
 new SaveVault(join(root,'emerald','saves'),peer.identity).write(peer.state,peer.sram,peer.metadata);
 atomicJson(join(root,'emerald','bot-policy.json'),{enabled:true,consolePowered:true,awaitingCommand:true,mode:'evolution-partner',runScope:'task'});
 const config={schema:'pokemon-suite/config/v1',directory:root,node:process.execPath,researchBots:fileURLToPath(new URL('../engine/shared',import.meta.url)),games:{firered:{...cfg,port:await port()},emerald:{...partnerCfg,port:await port()}}};
 atomicJson(join(root,'config.json'),config);
 const worker=fileURLToPath(new URL('../engine/firered/src/suite/session-worker.js',import.meta.url));
 const env={...process.env};for(const key of ['POKEMON_SUITE_UPDATE_HOLD','POKEMON_SUITE_MANUAL_LAUNCH','POKEMON_SUITE_DESKTOP_NODE'])delete env[key];
 const status=game=>{try{return json(join(root,game,'status.json'));}catch{return null;}};
 const start=game=>{const workerEnv={...env,...(config.games[game].adapterData?{POKEMON_SUITE_ADAPTER_DATA:config.games[game].adapterData}:{})};const child=spawn(process.execPath,[worker,join(root,'config.json'),game],{env:workerEnv,stdio:['ignore','pipe','pipe']});children.set(game,child);logs.set(game,'');for(const stream of [child.stdout,child.stderr])stream.on('data',b=>logs.set(game,(logs.get(game)+b).slice(-10000)));};
 const wait=async(test,message,ms=30000)=>{const at=Date.now();while(Date.now()-at<ms){for(const [game,c] of children)assert.equal(c.exitCode,null,game+' exited: '+logs.get(game));if(test())return;await sleep(200);}throw Error(message+' '+JSON.stringify(Object.fromEntries(['firered','emerald'].map(g=>[g,{frame:status(g)?.frame,objective:status(g)?.bot?.objective?.id,reason:status(g)?.bot?.reason,preparation:status(g)?.bot?.preparation?.phase,local:status(g)?.localEvolution?.phase,error:status(g)?.commandError}]))));};
 let sequence=0;
 const command=async(game,body)=>{const commandId='team-test-'+(++sequence);atomicJson(join(root,game,'command.json'),{...body,commandId,sessionId:status(game).sessionId});await wait(()=>status(game)?.lastCommand===commandId,'Command not acknowledged: '+body.type);assert.equal(status(game).commandError,null);};
 try{
  for(const game of ['firered','emerald'])start(game);
  await wait(()=>['firered','emerald'].every(g=>status(g)?.pid===children.get(g).pid),'Both owners must publish their real checkpoints');
  coordinator=spawn(process.env.PYTHON??'python3',['-u','-c','import sys,time\nfrom pathlib import Path\nfrom pokemon_suite.pokemon_sessions import SuiteSessions\nfrom pokemon_suite.postgame_partner import PostgamePartners\np=PostgamePartners(SuiteSessions(Path(sys.argv[1])))\nwhile True:\n p.tick()\n time.sleep(.5)',root],{cwd:fileURLToPath(new URL('..',import.meta.url)),env,stdio:['ignore','pipe','pipe']});
  let coordinatorLog='';coordinator.stderr.on('data',b=>{coordinatorLog+=b;});
  await wait(()=>existsSync(join(root,'firered','partner-availability.json'))&&json(join(root,'firered','partner-availability.json')).available,'The native companion must advertise availability');
  await command('firered',{type:'set-bot',enabled:true});
  let last='',chosen=false;const receiptPath=join(root,'firered',`acquisition-${requestId}.json`);
  await wait(()=>{
   assert.equal(coordinator.exitCode,null,'coordinator failed: '+coordinatorLog);
   const fr=status('firered');
   const trace=JSON.stringify([fr?.bot?.objective?.id,...['firered','emerald'].map(g=>[g,status(g)?.bot?.preparation?.phase,status(g)?.localEvolution?.phase,status(g)?.localEvolution?.leg,status(g)?.localEvolution?.reason])]);
   if(trace!==last){console.log('# team-trade-evolution '+fr?.frame+' '+trace);last=trace;}
   const local=fr?.localEvolution?.requestId;
   if(local)assert.equal(local,requestId,'the teammate travels before any Dex spare');
   chosen||=local===requestId;
   for(const g of ['firered','emerald'])assert.ok(!['waiting','paused'].includes(status(g)?.localEvolution?.phase),g+': '+status(g)?.localEvolution?.reason);
   return existsSync(receiptPath);
  },'The teammate did not finish both exchanges and saves',720000);
  assert.ok(chosen,'the postgame checklist reserved the teammate for the exchange');
  const receipt=json(receiptPath);assert.equal(receipt.nativeSaveVerified,true);assert.equal(receipt.pokemon.species,68);assert.ok(sameEvolutionIndividual(machoke,receipt.pokemon));
  const pair=json(join(root,'evolution-pairs',requestId+'.json'));
  assert.equal(pair.phase,'complete');verifyLocalEvolutionExchange(pair.reservation,'outbound',pair.outbound);verifyLocalEvolutionExchange(pair.reservation,'return',pair.returned);
  await wait(()=>status('firered')?.postgame?.entries?.find(e=>e.id==='team-evolution')?.status==='complete','The checklist must record the evolved team',60000);
  await command('firered',{type:'set-bot',enabled:false});
  await command('emerald',{type:'set-bot',enabled:false});
  const final=vault.read();session.loadSram(final.sram);session.loadState(final.state);
  const after=observer.capture(),team=after.playerMemory.trainer.party;
  const machamp=team.find(p=>sameEvolutionIndividual(machoke,p));
  assert.equal(machamp?.species,68,'Machamp returns to the party as the same individual');
  assert.equal(machamp.heldItem,machoke.heldItem);
  assert.deepEqual(team.filter(p=>p!==machamp).map(encounterFingerprint).sort(),others,'the other five teammates are unchanged');
  assert.equal(digest(readFileSync(resolve(dirname(peerPath),peerRecord.sramPath))),peerRecord.sramSha256,'the original companion save is immutable');
  console.log('# team-trade-evolution verified '+JSON.stringify({requestId,level:machamp.level,friendship:machamp.friendship,slot:team.indexOf(machamp)}));
  return {before,after};
 }finally{
  coordinator?.kill('SIGTERM');
  for(const [game,child] of children){if(child.exitCode!==null)continue;child.kill('SIGTERM');await Promise.race([new Promise(done=>child.once('exit',done)),sleep(15000)]);if(child.exitCode===null)child.kill('SIGKILL');}
  if(process.env.SUITE_REPLAY_KEEP==='1')console.log('# retained private replay '+root);else rmSync(root,{recursive:true,force:true});
 }
}
