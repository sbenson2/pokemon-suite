import assert from 'node:assert/strict';
import {spawn} from 'node:child_process';
import {createServer} from 'node:net';
import {mkdtempSync,readFileSync,rmSync,writeFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {fileURLToPath} from 'node:url';
import {setTimeout as sleep} from 'node:timers/promises';
import {SaveVault,atomicJson} from '../engine/firered/src/suite/save-vault.js';
import {createFireRedObserver} from '../engine/firered/src/evidence/fire-red-observer.js';
import {presetNames} from '../engine/firered/src/player/run-profile.js';

const json=p=>JSON.parse(readFileSync(p));
const port=()=>new Promise((done,fail)=>{const server=createServer();server.on('error',fail);server.listen(0,'127.0.0.1',()=>{const n=server.address().port;server.close(()=>done(n));});});

// LeafGreen (build 124). The FRLG engine plays a new LeafGreen game: the
// verified LeafGreen rev 1 cartridge, its own pinned knowledge pack, the same
// session worker, observer and story campaign as FireRed. From a first-launch
// (power-on, no save) checkpoint, the host's reviewed campaign flow
// (pokemon_campaigns options, preview and start through the real SuiteSessions)
// commits a LeafGreen run; the owner starts a new save and the campaign plays
// the title screen, Oak's speech, gender, the naming keyboard, the rival preset
// menu, the bedroom, Pallet Town, Oak's lab (starter and the first rival
// battle) and walks onto Route 1. Only controller inputs are used.
//
// Seed 42 is a boy named LEAF (LeafGreen's second player preset) and rival
// preset row 3, which LeafGreen names KENE (FireRed's row 3 is KAZ), so the
// saved names prove the LeafGreen presets were used end to end.
const SEED=42,STARTER='bulbasaur',ROUTE='MAP_ROUTE1';
export async function replayLeafGreenNewGame({session,saved,inputs,cfg}){
 assert.equal(saved.identity.game,'leafgreen','a LeafGreen checkpoint');
 assert.equal(saved.metadata?.newProfile,true,'the checkpoint is a first launch with no in-game save');
 const observer=createFireRedObserver({session,...inputs,runId:'leafgreen-new-game'}),before=observer.capture();
 const root=mkdtempSync(join(tmpdir(),'suite-leafgreen-new-game-')),game=join(root,'leafgreen');
 new SaveVault(join(game,'saves'),saved.identity).write(saved.state,saved.sram,saved.metadata);
 const worker=fileURLToPath(new URL('../engine/firered/src/suite/session-worker.js',import.meta.url));
 atomicJson(join(root,'config.json'),{schema:'pokemon-suite/config/v1',directory:root,node:process.execPath,worker,
  researchBots:fileURLToPath(new URL('../engine/shared',import.meta.url)),games:{leafgreen:{...cfg,port:await port()}}});
 const env={...process.env};for(const key of ['POKEMON_SUITE_UPDATE_HOLD','POKEMON_SUITE_MANUAL_LAUNCH','POKEMON_SUITE_DESKTOP_NODE'])delete env[key];
 let child=null,log='',sequence=0;
 const status=()=>{try{return json(join(game,'status.json'));}catch{return null;}};
 const alive=()=>{if(child?.exitCode!==null)throw Error('Worker exited: '+log.slice(-3000));};
 const wait=async(predicate,label,{ms=60000,stallMs=0,progress=null}={})=>{
  const until=Date.now()+ms;let marker=null,markerAt=Date.now();
  while(Date.now()<until){
   alive();const s=status();if(s&&predicate(s))return s;
   if(progress){const next=progress(s);if(next!==marker){marker=next;markerAt=Date.now();}
    if(Date.now()-markerAt>stallMs)throw Error(label+` (no progress for ${stallMs}ms): `+JSON.stringify({map:s?.map,callback2:s?.callback2,bot:s?.bot,campaign:s?.campaign?{status:s.campaign.status,reason:s.campaign.reason,objective:s.campaign.objective}:null})+' '+log.slice(-1500));}
   await sleep(100);
  }
  const s=status();throw Error(label+': '+JSON.stringify({map:s?.map,callback2:s?.callback2,commandError:s?.commandError,campaign:s?.campaign?{status:s.campaign.status,reason:s.campaign.reason}:null})+' '+log.slice(-1500));
 };
 const command=async body=>{
  const commandId='leafgreen-'+(++sequence);atomicJson(join(game,'command.json'),{...body,commandId,sessionId:status().sessionId});
  if(body.type==='shutdown'){
   const exited=await Promise.race([new Promise(done=>child.once('exit',done)),sleep(20000,null,{ref:false})]);
   assert.equal(exited,0,'the worker must retire cleanly');child=null;return null;
  }
  const s=await wait(s=>s.lastCommand===commandId,'command '+body.type,{ms:120000});assert.equal(s.commandError,null,`${body.type}: ${s.commandError}`);return s;
 };
 // The real host campaign flow, as the Suite server runs it for this owner.
 const hostCampaign=settings=>new Promise((done,fail)=>{
  const path=join(root,'run-settings.json');writeFileSync(path,JSON.stringify(settings));
  const driver=spawn(process.env.PYTHON??'python3',['-u',fileURLToPath(new URL('./campaign-start-replay.py',import.meta.url)),root,'leafgreen',path],
   {cwd:fileURLToPath(new URL('..',import.meta.url)),env,stdio:['ignore','pipe','pipe']});
  let out='',err='';driver.stdout.on('data',b=>{out+=b;});driver.stderr.on('data',b=>{err+=b;});
  driver.once('exit',code=>code===0?done(JSON.parse(out.trim().split('\n').at(-1))):fail(Error(`The host campaign flow failed (${code}): ${err.slice(-2000)}`)));
 });
 let after;
 try{
  child=spawn(process.execPath,[worker,join(root,'config.json'),'leafgreen'],{env,stdio:['ignore','pipe','pipe']});
  for(const stream of [child.stdout,child.stderr])stream.on('data',b=>{log=(log+b).slice(-12000);});
  const first=await wait(s=>s.pid===child.pid,'the LeafGreen owner never published its status');
  assert.equal(first.game,'leafgreen');assert.equal(first.newProfile,true,'the owner reports that no in-game save exists');
  const settings={label:'LeafGreen replay',starter:STARTER,teamMode:'random',helpers:'allowed',afterCampaign:'wait',
   seedMode:'replay',seed:SEED,teamSeed:'hex:'+'6c'.repeat(32)};
  const host=await hostCampaign(settings);
  assert.equal(host.options.defaults.afterCampaign,'wait','a LeafGreen run waits after the League: its postgame is not implemented');
  assert.match(host.options.poolScope,/LeafGreen/);
  assert.ok(host.options.starters.every(s=>s.sprite.startsWith('./assets/pokedex/leafgreen/')));
  const run=host.preview.id;assert.equal(host.preview.game,'leafgreen');assert.equal(host.campaign?.id,run);
  const review=json(join(game,'run-previews',run+'.json'));
  assert.equal(review.started,true);assert.equal(review.record.game,'leafgreen');
  assert.equal(review.record.romSha1,'7862c67bdecbe21d1d69ce082ce34327e1c6ed5e');
  const profile=review.record.runProfile,names=presetNames('leafgreen');
  assert.deepEqual([profile.gender,profile.playerName,profile.rivalName,profile.rivalMenuRow,profile.starter.id],['BOY','LEAF','KENE',3,STARTER]);
  assert.equal(profile.rivalName,names.rival[profile.rivalMenuRow-1]);
  await wait(s=>s.campaign?.id===run&&s.bot?.runScope==='campaign','the reviewed LeafGreen campaign did not start');
  // Title screen, Oak's speech, naming, bedroom, Oak's lab and Route 1.
  let naming=false,lab=false,starter=false,progressGame=null;
  const reached=await wait(s=>{
   naming||=/NamingScreen/.test(s.callback2??'');
   assert.notEqual(s.campaign?.status,'blocked',s.campaign?.reason);
   progressGame??=s.gameProgress?.game??null;
   lab||=s.map==='MAP_PALLET_TOWN_PROFESSOR_OAKS_LAB';
   starter||=(s.observation?.party??[]).some(p=>[1,2,3].includes(p.species));
   return s.map===ROUTE&&starter&&s.mode==='overworld';},'the LeafGreen campaign did not reach Route 1 with its starter',
   {ms:2700000,stallMs:300000,progress:s=>JSON.stringify([s?.frame>>12,s?.callback2,s?.map])});
  assert.equal(progressGame,'leafgreen','the owner reports LeafGreen progress');
  // LeafGreen's own "catch all" goal (190 species) counts the registered starter.
  assert.equal(reached.gameProgress?.catchable?.text,'1 of 190 catchable in LeafGreen');
  assert.ok(lab,'the campaign played Oak’s lab');
  await command({type:'set-bot',enabled:false});
  await command({type:'shutdown'});
  const vault=new SaveVault(join(game,'hunts',run,'saves'),saved.identity).read();
  assert.equal(vault.metadata.campaign.record.id,run);
  session.loadSram(vault.sram);session.loadState(vault.state);after=observer.capture();
  const trainer=after.playerMemory.trainer;
  assert.equal(trainer.playerName,'LEAF','the keyboard typed LeafGreen’s preset');
  assert.equal(trainer.rivalName,'KENE','LeafGreen’s rival preset row 3');
  assert.equal(trainer.party[0].species,1,'the chosen starter leads the party');
  assert.ok(!Object.values(presetNames('firered').player).flat().includes(trainer.playerName));
  console.log('# leafgreen-new-game '+JSON.stringify({run,playerName:trainer.playerName,rival:trainer.rivalName,party:trainer.party.map(p=>[p.species,p.level]),
   map:after.playerMemory.map.id,reached:reached.map,naming,frames:after.frame}));
 }finally{
  if(child&&child.exitCode===null){child.kill('SIGTERM');await Promise.race([new Promise(done=>child.once('exit',done)),sleep(15000,null,{ref:false})]);if(child.exitCode===null)child.kill('SIGKILL');}
  if(process.env.SUITE_REPLAY_KEEP==='1')console.log('# retained private replay '+root);else rmSync(root,{recursive:true,force:true});
 }
 return {before,after};
}
