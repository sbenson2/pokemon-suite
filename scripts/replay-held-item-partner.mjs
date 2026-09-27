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
import {selectOwnedPartnerEvolution,FireRedEvolutionTask} from '../engine/firered/src/suite/fire-red-evolution.js';
import {sameEvolutionIndividual,verifyLocalEvolutionExchange} from '../engine/firered/src/suite/local-evolution.js';
const json=p=>JSON.parse(readFileSync(p));
const port=()=>new Promise((done,fail)=>{const server=createServer();server.on('error',fail);server.listen(0,'127.0.0.1',()=>{const n=server.address().port;server.close(()=>done(n));});});
const metalCoat=o=>Object.values(o.playerMemory.trainer.bag??{}).flat().reduce((n,i)=>n+(i?.itemId===199?i.quantity:0),0);

// Live September 23: the first held-item partner route (boxed Onix, Metal Coat
// in the bag → Steelix) stopped at its first step because the equip step names
// no species. From the live save at that stop, the automatic route must
// withdraw Onix, give it the Metal Coat, trade it to the Emerald partner, receive
// the same individual back as Steelix with the coat consumed, and verify both
// native saves. Two actual owners and the host coordinator only.
export async function replayHeldItemPartner({session,saved,inputs,cfg,partnerCfg,partnerRomBytes,fixture,corpusPath}){
 assert.ok(partnerCfg&&partnerRomBytes,'a paired replay needs the verified companion ROM');
 const root=mkdtempSync(join(tmpdir(),'suite-held-item-partner-'));
 const children=new Map(),logs=new Map();let coordinator=null;
 const source=resolve(dirname(corpusPath),fixture.baseCheckpoint),baseRecord=json(source),base=new SaveVault(dirname(source),baseRecord.identity).read(baseRecord);
 const peerPath=resolve(dirname(corpusPath),fixture.partnerCheckpoint),peerRecord=json(peerPath),peer=new SaveVault(dirname(peerPath),peerRecord.identity).read(peerRecord);
 const durable=json(resolve(dirname(corpusPath),fixture.durableAgenda));
 const observer=createFireRedObserver({session,...inputs,runId:'held-item-partner'}),before=observer.capture();
 const route=selectOwnedPartnerEvolution({trainer:before.playerMemory.trainer,partnerAvailable:true});
 assert.equal(route?.request.speciesId,208,'the boxed Onix is routed to the missing Steelix entry');
 assert.equal(route.steps[0].kind,'equip-evolution-item');assert.ok(metalCoat(before)>=1);
 const controller=createPostgameController({...inputs,mechanics:inputs.battle,state:{schema:'pokemon-suite/postgame/v1',agenda:{...durable,active:null},dexEvolution:new FireRedEvolutionTask(route).state,preparation:{kind:'postgame',phase:'complete'}}});
 const run='held-item-partner-regression';
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
 const command=async(game,body)=>{const commandId='held-item-test-'+(++sequence);atomicJson(join(root,game,'command.json'),{...body,commandId,sessionId:status(game).sessionId});await wait(()=>status(game)?.lastCommand===commandId,'Command not acknowledged: '+body.type);assert.equal(status(game).commandError,null);};
 try{
  for(const game of ['firered','emerald'])start(game);
  await wait(()=>['firered','emerald'].every(g=>status(g)?.pid===children.get(g).pid),'Both owners must publish their real checkpoints');
  coordinator=spawn(process.env.PYTHON??'python3',['-u','-c','import sys,time\nfrom pathlib import Path\nfrom pokemon_suite.pokemon_sessions import SuiteSessions\nfrom pokemon_suite.postgame_partner import PostgamePartners\np=PostgamePartners(SuiteSessions(Path(sys.argv[1])))\nwhile True:\n p.tick()\n time.sleep(.5)',root],{cwd:fileURLToPath(new URL('..',import.meta.url)),env,stdio:['ignore','pipe','pipe']});
  let coordinatorLog='';coordinator.stderr.on('data',b=>{coordinatorLog+=b;});
  await wait(()=>existsSync(join(root,'firered','partner-availability.json'))&&json(join(root,'firered','partner-availability.json')).available,'The native companion must advertise availability');
  await command('firered',{type:'set-bot',enabled:true});
  let last='';const receiptPath=join(root,'firered',`acquisition-${route.requestId}.json`);
  await wait(()=>{
   assert.equal(coordinator.exitCode,null,'coordinator failed: '+coordinatorLog);
   const fr=status('firered');
   // Waiting for the partner to take the transfer is reported as a block by
   // design; any other block (such as the old step-0 source stop) fails fast.
   const transferWait=['waiting-for-transfer','preparing-transfer'].includes(fr?.bot?.preparation?.phase)||fr?.bot?.reason==='A separate compatible game must complete the native trade, both saves, and normal link exit.';
   if(fr?.bot?.status==='blocked'&&!transferWait)assert.fail(fr.bot.reason);
   const trace=JSON.stringify([fr?.bot?.objective?.id,...['firered','emerald'].map(g=>[g,status(g)?.bot?.preparation?.phase,status(g)?.localEvolution?.phase,status(g)?.localEvolution?.leg,status(g)?.localEvolution?.reason])]);
   if(trace!==last){console.log('# held-item-partner '+fr?.frame+' '+trace);last=trace;}
   for(const g of ['firered','emerald'])assert.ok(!['waiting','paused'].includes(status(g)?.localEvolution?.phase),g+': '+status(g)?.localEvolution?.reason);
   return existsSync(receiptPath);
  },'The held-item evolution did not finish both exchanges and saves',720000);
  const receipt=json(receiptPath);assert.equal(receipt.nativeSaveVerified,true);assert.equal(receipt.pokemon.species,208);assert.ok(sameEvolutionIndividual(route.pokemon,receipt.pokemon));
  const pair=json(join(root,'evolution-pairs',route.requestId+'.json'));
  assert.equal(pair.phase,'complete');verifyLocalEvolutionExchange(pair.reservation,'outbound',pair.outbound);verifyLocalEvolutionExchange(pair.reservation,'return',pair.returned);
  await command('firered',{type:'set-bot',enabled:false});
  await command('emerald',{type:'set-bot',enabled:false});
  const final=vault.read();session.loadSram(final.sram);session.loadState(final.state);
  const after=observer.capture(),all=[...after.playerMemory.trainer.party,...after.playerMemory.trainer.storage.pokemon];
  const steelix=all.find(p=>sameEvolutionIndividual(route.pokemon,p));
  assert.equal(steelix?.species,208,'the same individual returns as Steelix');
  assert.equal(steelix.heldItem,0,'the Metal Coat was consumed by the evolution');
  assert.equal(metalCoat(after),metalCoat(before)-1);
  assert.equal(digest(readFileSync(resolve(dirname(peerPath),peerRecord.sramPath))),peerRecord.sramSha256,'the original companion save is immutable');
  console.log('# held-item-partner verified '+JSON.stringify({requestId:route.requestId,level:steelix.level}));
  return {before,after};
 }finally{
  coordinator?.kill('SIGTERM');
  for(const [game,child] of children){if(child.exitCode!==null)continue;child.kill('SIGTERM');await Promise.race([new Promise(done=>child.once('exit',done)),sleep(15000)]);if(child.exitCode===null)child.kill('SIGKILL');}
  if(process.env.SUITE_REPLAY_KEEP==='1')console.log('# retained private replay '+root);else rmSync(root,{recursive:true,force:true});
 }
}
