import assert from 'node:assert/strict';
import {spawn,spawnSync} from 'node:child_process';
import {mkdtempSync,mkdirSync,copyFileSync,readFileSync,existsSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {dirname,join,resolve} from 'node:path';
import {fileURLToPath} from 'node:url';
import {setTimeout as sleep} from 'node:timers/promises';
import {SaveVault,atomicJson,digest} from '../engine/firered/src/suite/save-vault.js';
import {createFireRedObserver} from '../engine/firered/src/evidence/fire-red-observer.js';
import {encounterFingerprint} from '../engine/firered/src/player/encounter-tracker.js';
import {nationalSpeciesId} from '../engine/firered/src/evidence/gen3-national-species.js';
import {continueNativeSaveAsync} from '../engine/firered/src/suite/native-cold-boot.js';

// build 126 (extra saves): helper owners run as real worker processes, the way
// the host starts them. Independent checks read the native saves afterwards.
const json=p=>JSON.parse(readFileSync(p));
const WORKER=fileURLToPath(new URL('../engine/firered/src/suite/session-worker.js',import.meta.url));
const CLI=fileURLToPath(new URL('../engine/firered/src/suite/campaign-config-cli.js',import.meta.url));
const SHARED=fileURLToPath(new URL('../engine/shared',import.meta.url));
// A helper copies the main owner's game inputs, without the main owner's hunt selection.
const helperGame=(cfg,extra)=>{const nativeRadio={...cfg.nativeRadio};delete nativeRadio.huntId;
 return {title:'firered',role:'helper',port:0,release:cfg.release,cartridge:cfg.cartridge,core:cfg.core,inputs:cfg.inputs,nativeRadio,...extra};};

function owner(root,key){
 const directory=join(root,key);let child=null,log='',sequence=0;
 const status=()=>{try{return json(join(directory,'status.json'));}catch{return null;}};
 const start=configPath=>{
  const env={...process.env};delete env.POKEMON_SUITE_UPDATE_HOLD;delete env.POKEMON_SUITE_MANUAL_LAUNCH;
  child=spawn(process.execPath,[WORKER,configPath,key],{env,stdio:['ignore','pipe','pipe']});
  for(const stream of [child.stdout,child.stderr])stream.on('data',b=>{log=(log+b).slice(-12000);});
 };
 const wait=async(predicate,label,ms=30000)=>{
  const until=Date.now()+ms;
  while(Date.now()<until){assert.equal(child.exitCode,null,`${key} worker exited: ${log}`);const s=status();if(s&&predicate(s))return s;await sleep(25);}
  throw Error(`${label}: `+JSON.stringify({state:status()?.state,mission:status()?.mission,bot:status()?.bot,error:status()?.commandError,log:log.slice(-3000)}));
 };
 const command=async body=>{
  const commandId=`${key}-${++sequence}`;atomicJson(join(directory,'command.json'),{...body,commandId,sessionId:status().sessionId});
  if(body.type==='shutdown'){
   const exited=await Promise.race([new Promise(done=>child.once('exit',done)),sleep(20000,null,{ref:false})]);
   assert.equal(exited,0,`${key} checkpoint shutdown`);child=null;return null;
  }
  const s=await wait(s=>s.lastCommand===commandId,`${key} command ${body.type}`);return s;
 };
 const stop=async()=>{if(child&&child.exitCode===null){child.kill('SIGTERM');await Promise.race([new Promise(done=>child.once('exit',done)),sleep(15000,null,{ref:false})]);if(child.exitCode===null)child.kill('SIGKILL');}};
 return {directory,status,start,wait,command,stop,log:()=>log};
}

// October 4 (live, 125.1): start-helper for the Dome Fossil helper failed with
// "The campaign preview belongs to another cartridge". The preview bound the
// main owner's peer-trade cartridge while the helper worker booted the stock
// cartridge. A helper now boots the same reviewed native link pair as a
// partner, and its preview names the helper owner: the run starts, and the
// helper's save carries the link pair's cartridge and core identity.
// A saved helper state, observed in a fresh session of the case's pinned pair.
async function observeSaved(createSession,inputs,directory,runId){
 const record=json(join(directory,'current.json')),saved=new SaveVault(directory,record.identity).read(record);
 const session=await createSession();
 try{session.loadSram(saved.sram);session.loadState(saved.state);return createFireRedObserver({session,...inputs,runId}).capture();}
 finally{session.close();}
}

export async function replayHelperStartCampaign({cfg,fixture,inputs,createSession}){
 assert.ok(cfg.nativeRadio?.cartridge&&cfg.nativeRadio.core&&cfg.nativeRadio.huntId,'the main owner runs its hunt on the native link pair');
 const root=mkdtempSync(join(tmpdir(),'suite-helper-start-')),key='firered-helper-1';
 const helper=owner(root,key);
 try{
  for(const name of ['firered',key])mkdirSync(join(root,name),{recursive:true});
  // The main owner's current hunt is a native-radio hunt, as on the live machine.
  atomicJson(join(root,'firered','active-hunt.json'),{id:cfg.nativeRadio.huntId,nativeRadio:true});
  const goal={kind:'fossil',fossil:'dome'};
  const configPath=join(root,'config.json');
  atomicJson(configPath,{directory:root,node:process.execPath,researchBots:SHARED,games:{firered:{...cfg,port:0},[key]:helperGame(cfg,{label:'Helper save 1 (Dome Fossil)',extraSaveHelper:{saveId:'helper-1',goal}})}});
  const settings={label:'Helper save 1 (Dome Fossil)',starter:'random',afterCampaign:'wait',helperGoal:goal,fossil:'dome'};
  const preview=spawnSync(process.execPath,[CLI,configPath],{input:JSON.stringify({game:'firered',action:'preview',settings,owner:key}),encoding:'utf8',timeout:120000});
  assert.equal(preview.status,0,preview.stderr);
  const review=JSON.parse(preview.stdout),runId=review.record.id;
  assert.equal(review.record.romSha1,cfg.nativeRadio.cartridge.sha1,'the helper previews on its link cartridge');
  helper.start(configPath);
  const ready=await helper.wait(s=>Boolean(s.sessionId)&&s.pid,'helper ready',60000);
  mkdirSync(join(helper.directory,'run-previews'),{recursive:true});
  atomicJson(join(helper.directory,'run-previews',`${runId}.json`),{...review,sessionId:ready.sessionId});
  const started=await helper.command({type:'start-campaign',previewId:runId});
  assert.equal(started.commandError,null,'the helper accepts its reviewed run');
  const frame=started.frame;
  const running=await helper.wait(s=>s.campaign?.id===runId&&s.frame>frame+600,'the helper campaign runs',120000);
  assert.equal(running.commandError,null);assert.notEqual(running.bot?.status,'blocked',running.bot?.reason);
  await helper.command({type:'shutdown'});
  const core=json(join(cfg.nativeRadio.core,'build-manifest.json')).mgba_wasm_sha256,identity={game:'firered',romSha1:cfg.nativeRadio.cartridge.sha1,coreSha256:core};
  assert.deepEqual(json(join(helper.directory,'saves','current.json')).identity,identity,'the helper booted its first save on the link pair');
  // The run continues in its own save folder (the active hunt), on the same pair.
  const active=json(join(helper.directory,'active-hunt.json'));
  const record=json(join(helper.directory,'hunts',active.id,...(active.nativeRadio?['native-radio']:[]),'saves','current.json'));
  assert.deepEqual(record.identity,identity,'the helper campaign save carries the link pair identity');
  assert.equal(record.metadata.campaign.record.id,runId);
  console.log('# helper-start-campaign '+JSON.stringify({runId,romSha1:record.identity.romSha1,coreSha256:record.identity.coreSha256,frame:record.metadata.frame}));
  const before=await observeSaved(createSession,inputs,join(helper.directory,'saves'),'helper-start-before');
  const after=await observeSaved(createSession,inputs,join(helper.directory,'hunts',active.id,...(active.nativeRadio?['native-radio']:[]),'saves'),'helper-start-after');
  return {before,after};
 }finally{
  await helper.stop();
  if(process.env.SUITE_REPLAY_KEEP==='1')console.log('# retained private replay '+root);else rmSync(root,{recursive:true,force:true});
 }
}

// The Fighting Dojo prize from an archived save (row `hitmon`). The archived
// FIRE save (TID 32589, Charmander start, post-League, saved in Pallet Town,
// Dojo prize unused) is copied into a helper owner, as the host seeds it. The
// helper runs the Dojo gift hunt for the Hitmonchan the main save lacks, then
// parks: the Hitmonchan and the Charizard it lends join the party, healed and
// saved in the Celadon Pokémon Center. The receipt grants only the Hitmonchan,
// and the parked save is ready to hand it over (a keep offer).
export async function replayHelperDojoPrize({cfg,saved,inputs,fixture,corpusPath,createSession}){
 const profileId=fixture.profileId,center='MAP_CELADON_CITY_POKEMON_CENTER_1F';
 const root=mkdtempSync(join(tmpdir(),'suite-helper-dojo-')),key='firered-helper-1';
 const helper=owner(root,key);
 try{
  const checkpoint=resolve(dirname(corpusPath),fixture.checkpoint),record=json(checkpoint);
  const seedDir=join(root,'seed');mkdirSync(seedDir);
  for(const name of [record.statePath,record.sramPath])copyFileSync(join(dirname(checkpoint),name),join(seedDir,name));
  const check=await createSession();let before;
  try{check.loadSram(saved.sram);before=await continueNativeSaveAsync(check,createFireRedObserver({session:check,...inputs,runId:'helper-dojo-before',storyWatch:{flags:[632,2092],variables:[]}}));}
  finally{check.close();}
  const t0=before.playerMemory.trainer;
  assert.equal(before.playerMemory.storyState.flagIds[2092],true,'post-League');assert.equal(before.playerMemory.storyState.flagIds[632],false,'the Dojo prize is unused');
  const charizard=[...t0.party,...t0.storage.pokemon].find(p=>nationalSpeciesId(p.species)===6&&!p.shiny);assert.ok(charizard,'the archived save holds its Charizard');
  assert.ok(![...t0.party,...t0.storage.pokemon].some(p=>[106,107].includes(nationalSpeciesId(p.species))),'no Hitmon yet');
  const {helperTaskHunt}=await import('../engine/firered/src/suite/extra-save-tasks.js');
  const hunt=helperTaskHunt({kind:'dojo-prize',speciesId:107,profileId});
  const configPath=join(root,'config.json');
  atomicJson(configPath,{directory:root,node:process.execPath,researchBots:SHARED,games:{firered:{...cfg,port:0},[key]:helperGame(cfg,{label:'FIRE',
   seed:{stateFilePath:join(seedDir,record.statePath),sramFilePath:join(seedDir,record.sramPath),stateSha256:record.stateSha256,sramSha256:record.sramSha256,frame:record.metadata?.frame??0},
   extraSaveSource:{profileId,lineage:String(t0.otId>>>0)},
   extraSaveHelper:{saveId:`park-${profileId}`,park:true,center,profileId,tasks:[{needId:'hitmon',kind:'dojo-prize',speciesId:107,hunt}]}})}});
  mkdirSync(helper.directory,{recursive:true});
  helper.start(configPath);
  await helper.wait(s=>Boolean(s.sessionId)&&s.pid,'helper ready',60000);
  // The worker refuses a hunt that is not one of its configured tasks.
  const refused=await helper.command({type:'start',record:{...hunt,request:{...hunt.request,shiny:'required'}},runScope:'task'});
  assert.match(refused.commandError??'',/helper FireRed save only plays/);
  await helper.command({type:'start',record:hunt,runScope:'task'});
  let last='';
  const done=await helper.wait(s=>{
   const trace=JSON.stringify([s.map,s.mission?.state,s.mission?.phase,s.decision?.reason]);if(trace!==last){console.log('# helper-dojo '+s.frame+' '+trace);last=trace;}
   assert.notEqual(s.mission?.state,'blocked',s.mission?.reason+' '+JSON.stringify(s.decision));
   return s.mission?.id===hunt.id&&s.mission.state==='complete';
  },'the Dojo prize hunt completes',Number(process.env.SUITE_HELPER_DOJO_MS??1500000));
  assert.equal(done.mission.caught,1);
  const park={id:`park-${profileId.slice(0,8)}`,kind:'park',map:center,goals:[{speciesId:107}],keep:[encounterFingerprint(charizard)]};
  await helper.command({type:'player-task',request:park});
  const receiptPath=join(helper.directory,`player-task-${park.id}.json`);
  await helper.wait(s=>{const trace=JSON.stringify([s.map,s.bot?.status,s.decision?.reason]);if(trace!==last){console.log('# helper-park '+s.frame+' '+trace);last=trace;}return existsSync(receiptPath);},'the helper parks',900000);
  const receipt=json(receiptPath);
  await helper.command({type:'shutdown'});
  assert.equal(receipt.nativeSaveVerified,true);assert.equal(receipt.center,center);assert.equal(receipt.grants.length,1);
  assert.equal(nationalSpeciesId(receipt.pokemon[0].species),107);assert.equal(receipt.pokemon[0].shiny,false);
  // Independent check: the helper's current native save continues in the Center with both in the party.
  const active=json(join(helper.directory,'active-hunt.json'));
  const vaultDir=join(helper.directory,'hunts',active.id,...(active.nativeRadio?['native-radio']:[]),'saves'),current=json(join(vaultDir,'current.json'));
  assert.equal(current.sramSha256,receipt.savedSramSha256,'the park receipt is the current native save');
  const final=new SaveVault(vaultDir,current.identity).read(current);
  const coldCheck=await createSession();let after;
  try{coldCheck.loadSram(final.sram);after=await continueNativeSaveAsync(coldCheck,createFireRedObserver({session:coldCheck,...inputs,runId:'helper-dojo-after',storyWatch:{flags:[632,2092],variables:[]}}));}
  finally{coldCheck.close();}
  const t=after.playerMemory.trainer,party=t.party.map(encounterFingerprint);
  assert.equal(after.playerMemory.map.id,center);assert.equal(after.playerMemory.storyState.flagIds[632],true);
  assert.ok(party.includes(receipt.grants[0]),'the granted Hitmonchan is in the saved party');
  assert.ok(party.includes(encounterFingerprint(charizard)),'the lent Charizard stays in the party');
  const before0=[...t0.party,...t0.storage.pokemon].map(encounterFingerprint).sort(),after0=[...t.party,...t.storage.pokemon].map(encounterFingerprint);
  assert.deepEqual(before0.filter(fp=>!after0.includes(fp)),[],'every original individual is kept');
  // The parked save is ready to hand over the Hitmonchan under a keep offer.
  const {inspectFireRedPartnerReadiness}=await import('../engine/firered/src/suite/firered-partner.js');
  const {emptyPartnerLedger}=await import('../engine/firered/src/suite/extra-save-exchange.js');
  const offer={schema:'pokemon-suite/extra-save-offer/v1',exchangeId:'extra-save-hitmon-1',mode:'keep',leg:'open',fingerprint:receipt.grants[0],expectSource:'[129,1,1,1,1,1,1,1,1]'};
  const ready=inspectFireRedPartnerReadiness({live:after,saved:after,world:inputs.world,owner:'firered-partner-2',requestId:'extra-save-hitmon-1-open',sramSha256:final.sramSha256??current.sramSha256,offer,ledger:emptyPartnerLedger(receipt.grants)});
  assert.equal(ready.phase,'ready-for-transfer',ready.reason);
  assert.equal(encounterFingerprint(ready.transferCandidate),receipt.grants[0]);
  console.log('# helper-dojo-prize '+JSON.stringify({frame:receipt.frame,grant:receipt.grants[0],center,party:t.party.map(p=>nationalSpeciesId(p.species))}));
  return {before,after};
 }finally{
  await helper.stop();
  if(process.env.SUITE_REPLAY_KEEP==='1')console.log('# retained private replay '+root);else rmSync(root,{recursive:true,force:true});
 }
}

// The hand-over (mode keep, row `hitmon`): the FireRed partner seeded from
// the parked helper save above is granted only its Hitmonchan. From the
// owner's Sept 27 main checkpoint, with every local checklist entry and the
// Charmander loan deferred, the main save's postgame takes the hitmon route:
// one native trade leg gives the partner an ordinary PC duplicate and brings
// the Hitmonchan, registered by the trade; the team is restored and saved.
// The partner keeps the duplicate, and its grant is spent. Two real FireRed
// owners plus the host coordinator; controller inputs only.
export async function replayExtraSaveKeep({session,saved,inputs,cfg,partnerCfg,createSession,fixture,corpusPath}){
 const {createServer}=await import('node:net');
 const {postgameChecklist}=await import('../engine/firered/src/suite/postgame-agenda.js');
 const {createPostgameController}=await import('../engine/firered/src/suite/postgame.js');
 const {verifyLocalEvolutionExchange}=await import('../engine/firered/src/suite/local-evolution.js');
 const {continueNativeSave}=await import('../engine/firered/src/suite/native-cold-boot.js');
 const port=()=>new Promise((done,fail)=>{const server=createServer();server.on('error',fail);server.listen(0,'127.0.0.1',()=>{const n=server.address().port;server.close(()=>done(n));});});
 const owner=fixture.partnerOwner,grant=fixture.grant;
 assert.ok(owner&&partnerCfg?.title==='firered'&&partnerCfg.role==='partner'&&/^\[107,/.test(grant??''),'a keep replay needs its verified FireRed partner and the granted Hitmonchan');
 const root=mkdtempSync(join(tmpdir(),'suite-extra-save-keep-')),children=new Map(),logs=new Map();let coordinator=null;
 const basePath=resolve(dirname(corpusPath),fixture.baseCheckpoint),baseRecord=json(basePath),base=new SaveVault(dirname(basePath),baseRecord.identity).read(baseRecord);
 const parkedPath=resolve(dirname(corpusPath),fixture.partnerCheckpoint),parkedRecord=json(parkedPath),parked=new SaveVault(dirname(parkedPath),parkedRecord.identity).read(parkedRecord);
 const observer=createFireRedObserver({session,...inputs,runId:'extra-save-keep'}),before=observer.capture(),t0=before.playerMemory.trainer;
 assert.equal(t0.pokedex.ownedSpecies.includes(107),false,'the main save starts without Hitmonchan');
 const holdings=t=>({party:t.party.map(encounterFingerprint).sort(),storage:t.storage.pokemon.map(encounterFingerprint).sort()});
 const check=await createSession();let partnerBefore;
 try{check.loadSram(parked.sram);partnerBefore=await continueNativeSaveAsync(check,createFireRedObserver({session:check,...inputs,runId:'extra-save-keep-partner-before'}));}
 finally{check.close();}
 assert.ok(partnerBefore.playerMemory.trainer.party.some(p=>encounterFingerprint(p)===grant),'the partner party holds the granted Hitmonchan');
 // Every local checklist entry and every other extra-save route waits, so only the hand-over can be chosen.
 const failures=Object.fromEntries(postgameChecklist(before,{},null).map(e=>[e.id,{retryAt:Date.now()+86400000,reason:'Deferred for the keep replay.'}]));
 const deferred=Object.fromEntries(['starter-charmander','starter-squirtle','starter-bulbasaur','fossil-dome','fossil-helix','roamer-raikou','roamer-suicune','roamer-entei'].map(id=>[id,{retryAt:Date.now()+86400000,reason:'Deferred for the keep replay.'}]));
 const controller=createPostgameController({...inputs,mechanics:inputs.battle,state:{schema:'pokemon-suite/postgame/v1',agenda:{schema:'pokemon-suite/postgame-agenda/v1',enabled:true,active:null,entries:[],failures,workflows:{extraSaves:{deferred}}},preparation:{kind:'postgame',phase:'complete'}}});
 const run='extra-save-keep-regression';
 const vault=new SaveVault(join(root,'firered','hunts',run,'native-radio','saves'),saved.identity);
 new SaveVault(join(root,'firered','saves'),base.identity).write(base.state,base.sram,base.metadata);
 vault.write(saved.state,saved.sram,{frame:before.frame,postgame:controller.state()});
 atomicJson(join(root,'firered','active-hunt.json'),{id:run,manual:true,nativeRadio:true});
 atomicJson(join(root,'firered','bot-policy.json'),{enabled:false,consolePowered:false,awaitingCommand:false,mode:'postgame',runScope:'postgame'});
 const copy=join(root,'partner-seed');mkdirSync(copy);
 for(const name of [parkedRecord.statePath,parkedRecord.sramPath])copyFileSync(join(dirname(parkedPath),name),join(copy,name));
 const seed={stateFilePath:join(copy,parkedRecord.statePath),sramFilePath:join(copy,parkedRecord.sramPath),stateSha256:parkedRecord.stateSha256,sramSha256:parkedRecord.sramSha256,frame:parkedRecord.metadata?.frame??0};
 mkdirSync(join(root,owner));
 atomicJson(join(root,owner,'bot-policy.json'),{enabled:true,consolePowered:true,awaitingCommand:true,mode:'evolution-partner',runScope:'task'});
 const {seed:_mainSeed,...mainCfg}=cfg;
 const config={schema:'pokemon-suite/config/v1',directory:root,node:process.execPath,researchBots:SHARED,
  games:{firered:{...cfg,port:await port()},[owner]:{...mainCfg,nativeRadio:{cartridge:partnerCfg.nativeRadio.cartridge,core:partnerCfg.nativeRadio.core},title:'firered',role:'partner',label:'FIRE',seed,
   extraSaveSource:{helperOwner:'firered-helper-1',profileId:fixture.profileId,lineage:String(partnerBefore.playerMemory.trainer.otId>>>0)},extraSaveGrants:[grant],port:await port()}}};
 atomicJson(join(root,'config.json'),config);
 const env={...process.env};for(const key of ['POKEMON_SUITE_UPDATE_HOLD','POKEMON_SUITE_MANUAL_LAUNCH','POKEMON_SUITE_DESKTOP_NODE'])delete env[key];
 const owners=['firered',owner];
 const status=game=>{try{return json(join(root,game,'status.json'));}catch{return null;}};
 const start=game=>{const child=spawn(process.execPath,[WORKER,join(root,'config.json'),game],{env,stdio:['ignore','pipe','pipe']});children.set(game,child);logs.set(game,'');for(const stream of [child.stdout,child.stderr])stream.on('data',b=>logs.set(game,(logs.get(game)+b).slice(-10000)));};
 const wait=async(test,message,ms=30000)=>{const at=Date.now();while(Date.now()-at<ms){for(const [game,c] of children)assert.equal(c.exitCode,null,game+' exited: '+logs.get(game));if(test())return;await sleep(250);}
  throw Error(message+' '+JSON.stringify(Object.fromEntries(owners.map(g=>[g,{frame:status(g)?.frame,map:status(g)?.map,bot:status(g)?.bot?.reason,local:status(g)?.localEvolution?.phase}]))));};
 let sequence=0;
 const command=async(game,body)=>{const commandId='extra-save-keep-test-'+(++sequence);atomicJson(join(root,game,'command.json'),{...body,commandId,sessionId:status(game).sessionId});await wait(()=>status(game)?.lastCommand===commandId,'Command not acknowledged: '+body.type);assert.equal(status(game).commandError,null);};
 const agenda=()=>{try{return json(join(root,'firered','postgame-agenda.json'));}catch{return null;}};
 try{
  for(const game of owners)start(game);
  await wait(()=>owners.every(g=>status(g)?.pid===children.get(g).pid),'Both FireRed owners must publish their real checkpoints',60000);
  await wait(()=>status(owner)?.extraSaveInventory?.source?.grants?.includes(grant),'The partner must publish its inventory with its grant',60000);
  coordinator=spawn(process.env.PYTHON??'python3',['-u','-c','import sys,time\nfrom pathlib import Path\nfrom pokemon_suite.pokemon_sessions import SuiteSessions\nfrom pokemon_suite.postgame_partner import PostgamePartners\np=PostgamePartners(SuiteSessions(Path(sys.argv[1])))\nwhile True:\n try:p.tick()\n except (OSError,ValueError,KeyError) as error:print(error,file=sys.stderr,flush=True)\n if p.extra_error:print(p.extra_error,file=sys.stderr,flush=True)\n time.sleep(.5)',root],{cwd:fileURLToPath(new URL('..',import.meta.url)),env,stdio:['ignore','pipe','pipe']});
  let coordinatorLog='';coordinator.stderr.on('data',b=>{coordinatorLog=(coordinatorLog+b).slice(-5000);});
  await wait(()=>existsSync(join(root,'firered','extra-save-sources.json'))&&json(join(root,'firered','extra-save-sources.json')).sources?.some(s=>s.source.owner===owner),'The host must publish the partner as an extra-save source '+coordinatorLog,60000);
  await command('firered',{type:'set-bot',enabled:true});
  let last='',sawRow=false;
  await wait(()=>{
   assert.equal(coordinator.exitCode,null,'coordinator failed: '+coordinatorLog);
   const fr=status('firered'),row=fr?.extraSaves?.find(r=>r.needId==='hitmon');
   sawRow||=row?.mode==='keep'&&row.status==='ready'&&row.save==='FIRE';
   const p=fr?.bot?.preparation;
   const trace=JSON.stringify([fr?.bot?.objective?.id,fr?.map,p?.kind,p?.phase,row?.status,...owners.map(g=>[g,status(g)?.localEvolution?.phase])]);
   if(trace!==last){console.log('# extra-save-keep '+fr?.frame+' '+trace);last=trace;}
   if(fr?.bot?.status==='blocked'&&!(p?.kind==='extra-save'&&['waiting-for-transfer','preparing-transfer'].includes(p.phase))&&!/Waiting for .* to hand over|A separate compatible game/.test(fr?.bot?.reason??''))assert.fail('main blocked: '+fr.bot.reason);
   for(const g of owners)assert.ok(!['waiting','paused'].includes(status(g)?.localEvolution?.phase),g+': '+status(g)?.localEvolution?.reason);
   assert.notEqual(status(owner)?.bot?.preparation?.phase,'waiting',`partner: ${status(owner)?.bot?.preparation?.reason}`);
   return (agenda()?.acquisitions??[]).some(r=>r.method==='extra-save'&&r.mode==='keep'&&r.nativeSaveVerified);
  },'The hand-over did not finish its leg and the final save',2400000);
  assert.ok(sawRow,'the host showed the ready hand-over route from FIRE');
  const receipt=agenda().acquisitions.find(r=>r.method==='extra-save'&&r.mode==='keep');
  assert.deepEqual(receipt.registered,[107]);assert.deepEqual(receipt.legs.map(l=>l.leg),['open']);assert.equal(receipt.fingerprint,grant);
  const pair=json(join(root,'evolution-pairs',`${receipt.requestId}-open.json`));
  assert.equal(pair.phase,'complete');assert.equal(pair.reservation.method,'single');assert.equal(pair.reservation.exchange.mode,'keep');verifyLocalEvolutionExchange(pair.reservation,'outbound',pair.outbound);
  // The partner status shows its ledger's grant count; the hand-over spends the only grant.
  await wait(()=>status(owner)?.bot?.awaitingCommand===true&&status(owner)?.extraSaveLedger?.grants===0&&status(owner)?.extraSaveLedger?.open===null,'The partner must spend its grant and idle',60000);
  await command('firered',{type:'set-bot',enabled:false});
  await command(owner,{type:'set-bot',enabled:false});
  const final=vault.read();session.loadSram(final.sram);session.loadState(final.state);
  const after=observer.capture(),t=after.playerMemory.trainer,all=[...t.party,...t.storage.pokemon];
  assert.ok(t.pokedex.ownedSpecies.includes(107),'the trade registered Hitmonchan');
  const hitmonchan=all.filter(p=>encounterFingerprint(p)===grant);assert.equal(hitmonchan.length,1,'the main save holds the Hitmonchan');
  const offered=receipt.legs[0].offered;assert.ok(!all.some(p=>encounterFingerprint(p)===offered),'the duplicate went to the partner');
  assert.deepEqual(t.party.map(encounterFingerprint).sort(),t0.party.map(encounterFingerprint).sort(),'the original team is back in the party');
  const partnerVault=new SaveVault(join(root,owner,'saves'),parkedRecord.identity),partnerFinal=partnerVault.read();
  const cold=await createSession();
  try{
   cold.loadSram(partnerFinal.sram);
   const p=continueNativeSave(cold,createFireRedObserver({session:cold,...inputs,runId:'extra-save-keep-partner-final'})),pt=p.playerMemory.trainer;
   const expected=holdings(partnerBefore.playerMemory.trainer);
   const now=holdings(pt);
   assert.deepEqual(now.storage,expected.storage,'the partner PC is unchanged');
   assert.deepEqual(now.party,[...expected.party.filter(fp=>fp!==grant),offered].sort(),'the partner holds exactly the duplicate in place of the Hitmonchan');
  }finally{cold.close();}
  assert.equal(digest(readFileSync(resolve(dirname(parkedPath),parkedRecord.sramPath))),parkedRecord.sramSha256,'the partner checkpoint is immutable');
  console.log('# extra-save-keep verified '+JSON.stringify({exchangeId:receipt.requestId,registered:receipt.registered,received:receipt.fingerprint,offered,frame:after.frame}));
  return {before,after};
 }finally{
  coordinator?.kill('SIGTERM');
  for(const [game,child] of children){if(child.exitCode!==null)continue;child.kill('SIGTERM');await Promise.race([new Promise(done=>child.once('exit',done)),sleep(15000)]);if(child.exitCode===null)child.kill('SIGKILL');}
  if(process.env.SUITE_REPLAY_KEEP==='1')console.log('# retained private replay '+root);else rmSync(root,{recursive:true,force:true});
 }
}

// The roaming-dog task (rows `roamer-raikou` / `roamer-suicune`) starts on an
// archived save. "Engine 50" (TID 3958, Squirtle start, post-League, 15 owned,
// no National Pokédex, Raikou not released) is copied into a helper owner, as
// the host seeds it. The helper accepts the Raikou hunt; RoamerMission verifies
// the starter, the League and the unreleased roamer, then its preparer works
// toward the National Pokédex. Bounded: the case passes once a new Pokédex
// entry is registered and natively saved with the roamer still unreleased. The
// full chain (60 owned, National Dex, Celio's link, release, pursuit, capture)
// is long-running live work, not part of this case.
export async function replayHelperRoamerPreparation({cfg,saved,inputs,fixture,corpusPath,createSession}){
 const {helperTaskHunt}=await import('../engine/firered/src/suite/extra-save-tasks.js');
 const profileId=fixture.profileId,species=fixture.speciesId??243,key='firered-helper-1';
 const root=mkdtempSync(join(tmpdir(),'suite-helper-roamer-')),helper=owner(root,key);
 try{
  const checkpoint=resolve(dirname(corpusPath),fixture.checkpoint),record=json(checkpoint);
  const seedDir=join(root,'seed');mkdirSync(seedDir);
  for(const name of [record.statePath,record.sramPath])copyFileSync(join(dirname(checkpoint),name),join(seedDir,name));
  const watch={flags:[2092,2112,2116],variables:[0x4031]};
  const check=await createSession();let before;
  try{check.loadSram(saved.sram);before=await continueNativeSaveAsync(check,createFireRedObserver({session:check,...inputs,runId:'helper-roamer-before',storyWatch:watch}));}
  finally{check.close();}
  const f0=before.playerMemory.storyState.flagIds,owned0=before.playerMemory.trainer.pokedex.ownedSpecies.length;
  assert.deepEqual([f0[2092],f0[2112],f0[2116]],[true,false,false],'post-League, no National Pokédex, roamer not released');
  assert.equal(before.playerMemory.storyState.variableIds[0x4031],species===243?1:2,'the starter that makes this roamer');
  const hunt=helperTaskHunt({kind:'roamer-capture',speciesId:species,profileId});
  const configPath=join(root,'config.json');
  atomicJson(configPath,{directory:root,node:process.execPath,researchBots:SHARED,games:{firered:{...cfg,port:0},[key]:helperGame(cfg,{label:fixture.label??'Archived FireRed save',
   seed:{stateFilePath:join(seedDir,record.statePath),sramFilePath:join(seedDir,record.sramPath),stateSha256:record.stateSha256,sramSha256:record.sramSha256,frame:record.metadata?.frame??0},
   extraSaveSource:{profileId,lineage:String(before.playerMemory.trainer.otId>>>0)},
   extraSaveHelper:{saveId:`park-${profileId}`,park:true,center:'MAP_CELADON_CITY_POKEMON_CENTER_1F',profileId,tasks:[{needId:species===243?'roamer-raikou':'roamer-suicune',kind:'roamer-capture',speciesId:species,hunt}]}})}});
  mkdirSync(helper.directory,{recursive:true});
  helper.start(configPath);
  await helper.wait(s=>Boolean(s.sessionId)&&s.pid,'helper ready',60000);
  const started=await helper.command({type:'start',record:hunt,runScope:'task'});
  assert.equal(started.commandError,null,started.commandError);
  let last='',maxOwned=owned0;
  const done=await helper.wait(s=>{
   const trace=JSON.stringify([s.map,s.mission?.state,s.mission?.phase,s.gameProgress?.ownedSpecies,s.decision?.reason]);if(trace!==last){console.log('# helper-roamer '+s.frame+' '+trace);last=trace;}
   assert.notEqual(s.mission?.state,'blocked',s.mission?.reason+' '+JSON.stringify(s.decision));
   assert.notEqual(s.gameProgress?.canLinkNationally,true,'this bounded case stops long before the release');
   maxOwned=Math.max(maxOwned,s.gameProgress?.ownedSpecies??0);
   // The new entry counts once its capture is acknowledged, i.e. natively saved (postgame acknowledgeCapture).
   return s.mission?.id===hunt.id&&s.mission.phase==='preparing'&&maxOwned>owned0&&(s.bot?.captures??0)>=1;
  },'the roamer preparation registers and saves a new Pokédex entry',Number(process.env.SUITE_HELPER_ROAMER_MS??1800000));
  assert.equal(done.mission.state,'running');
  await helper.command({type:'shutdown'});
  // Independent check: the helper's current native save (link pair identity) continues with the new entry.
  const active=json(join(helper.directory,'active-hunt.json'));
  const vaultDir=join(helper.directory,'hunts',active.id,...(active.nativeRadio?['native-radio']:[]),'saves'),current=json(join(vaultDir,'current.json'));
  const core=json(join(cfg.nativeRadio.core,'build-manifest.json')).mgba_wasm_sha256;
  assert.deepEqual(current.identity,{game:'firered',romSha1:cfg.nativeRadio.cartridge.sha1,coreSha256:core},'the helper plays on the link pair');
  const final=new SaveVault(vaultDir,current.identity).read(current);
  const cold=await createSession();let after;
  try{cold.loadSram(final.sram);after=await continueNativeSaveAsync(cold,createFireRedObserver({session:cold,...inputs,runId:'helper-roamer-after',storyWatch:watch}));}
  finally{cold.close();}
  const owned1=after.playerMemory.trainer.pokedex.ownedSpecies.length;
  assert.ok(owned1>owned0,`the native save registers new entries (${owned0} -> ${owned1})`);
  assert.equal(after.playerMemory.storyState.flagIds[2116],false,'the roamer is still unreleased');
  const ids=t=>[...t.party,...t.storage.pokemon].map(encounterFingerprint);
  assert.deepEqual(ids(before.playerMemory.trainer).filter(fp=>!ids(after.playerMemory.trainer).includes(fp)),[],'every original individual is kept');
  console.log('# helper-roamer-preparation '+JSON.stringify({species,owned0,owned1,frame:after.frame,map:after.playerMemory.map.id}));
  return {before,after};
 }finally{
  await helper.stop();
  if(process.env.SUITE_REPLAY_KEEP==='1')console.log('# retained private replay '+root);else rmSync(root,{recursive:true,force:true});
 }
}
