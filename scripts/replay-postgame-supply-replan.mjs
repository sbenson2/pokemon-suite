import assert from 'node:assert/strict';
import {spawn} from 'node:child_process';
import {createServer} from 'node:net';
import {mkdtempSync,readFileSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {dirname,join,resolve} from 'node:path';
import {fileURLToPath} from 'node:url';
import {setTimeout as sleep} from 'node:timers/promises';
import {SaveVault,atomicJson} from '../engine/firered/src/suite/save-vault.js';
import {createFireRedObserver} from '../engine/firered/src/evidence/fire-red-observer.js';
import {continueNativeSaveAsync} from '../engine/firered/src/suite/native-cold-boot.js';
import {createCampaignPlanner} from '../engine/firered/src/player/campaign.js';
import {POSTGAME_WATCH} from '../engine/firered/src/suite/postgame-agenda.js';

const json=p=>JSON.parse(readFileSync(p));
const port=()=>new Promise((done,fail)=>{const server=createServer();server.on('error',fail);server.listen(0,'127.0.0.1',()=>{const n=server.address().port;server.close(()=>done(n));});});
const count=(o,id)=>Object.values(o.playerMemory.trainer.bag??{}).flat().filter(i=>i.itemId===id).reduce((n,i)=>n+i.quantity,0);

// The automatic postgame after the Hall of Fame, with no goal and no
// supervisor (the control of goal-supervisor-postgame-handoff). On this
// completed-campaign save care plans its supply basket at the League clerk
// priced to the cash reserve (30,548 money, 7 Ultra Balls: 17 Ultra Balls =
// 20,400 of 20,548), then catches National Dex species on the way with those
// balls. The retained basket's absolute target then cost more than the reserve
// and the owner stopped for review ("The retained supply basket exceeds the
// remaining spending limit or cash reserve.") although nothing was bought.
// The basket must be re-derived from the current stock and money within the
// 10,000 reserve, and the owner must continue without stopping for it.
export async function replayPostgameSupplyReplan({session,saved,inputs,createSession,cfg,fixture,corpusPath}){
 const campaign=saved.metadata.campaign,run=campaign.record.id;
 assert.equal(campaign.state.status,'complete','the checkpoint holds a completed campaign');
 assert.equal(campaign.state.completion?.playablePostgame,true);
 const base=createCampaignPlanner({...inputs,mechanics:inputs.battle}).storyWatch();
 const watch={...base,flags:[...new Set([...base.flags,...POSTGAME_WATCH.flags,2092])],variables:[...new Set([...(base.variables??[]),...POSTGAME_WATCH.variables])]};
 const observer=createFireRedObserver({session,...inputs,runId:'postgame-supply-replan',storyWatch:watch}),before=observer.capture();
 assert.equal(before.playerMemory.storyState.flagIds[2092],true,'the Hall of Fame is entered');
 const startMoney=before.playerMemory.trainer.money,startUltra=count(before,2);
 assert.ok(startMoney>10000&&startUltra<30,'the save needs a supply basket and can fund one');
 const root=mkdtempSync(join(tmpdir(),'suite-supply-replan-')),game=join(root,'firered');
 const source=resolve(dirname(corpusPath),fixture.baseCheckpoint),baseRecord=json(source);
 const baseSave=new SaveVault(dirname(source),baseRecord.identity).read(baseRecord);
 new SaveVault(join(game,'saves'),baseSave.identity).write(baseSave.state,baseSave.sram,baseSave.metadata);
 new SaveVault(join(game,'hunts',run,'native-radio','saves'),saved.identity).write(saved.state,saved.sram,saved.metadata);
 atomicJson(join(game,'active-hunt.json'),{id:run,manual:true,label:'Supply basket control',nativeRadio:true});
 atomicJson(join(game,'bot-policy.json'),{enabled:true,mode:'campaign',consolePowered:true,runScope:'campaign',awaitingCommand:false});
 const worker=fileURLToPath(new URL('../engine/firered/src/suite/session-worker.js',import.meta.url));
 atomicJson(join(root,'config.json'),{schema:'pokemon-suite/config/v1',directory:root,node:process.execPath,worker,
  researchBots:fileURLToPath(new URL('../engine/shared',import.meta.url)),games:{firered:{...cfg,port:await port(),nativeRadio:{...cfg.nativeRadio,huntId:run}}}});
 const env={...process.env};for(const key of ['POKEMON_SUITE_UPDATE_HOLD','POKEMON_SUITE_MANUAL_LAUNCH','POKEMON_SUITE_DESKTOP_NODE'])delete env[key];
 let child=null,log='',sequence=0;
 const status=()=>{try{return json(join(game,'status.json'));}catch{return null;}};
 const agenda=()=>{try{return json(join(game,'postgame-agenda.json'));}catch{return null;}};
 const alive=()=>{if(child?.exitCode!==null)throw Error('Worker exited: '+log.slice(-3000));};
 // Evidence from the owner's status (about once a second) and its durable agenda (every 30 s).
 const seen={objectives:[],baskets:[],replanned:0,maps:[]};
 const note=(list,value)=>{if(value&&list.at(-1)!==value)list.push(value);};
 const observe=s=>{
  if(!s||s.bot?.runScope!=='postgame')return;
  note(seen.objectives,s.bot?.objective?.id);note(seen.maps,s.map);
  assert.notEqual(s.bot?.objective?.target?.kind,'stop-for-review',`care stopped for review: ${s.bot?.objective?.target?.reason} ${JSON.stringify({map:s.map,money:s.observation?.money,care:agenda()?.fieldCare})}`);
  if(s.bot?.objective?.id==='stock-postgame-supplies'){
   const basket=JSON.stringify({money:s.observation?.money,items:s.bot.objective.target.items.map(i=>[i.itemId,i.quantity])});
   if(seen.baskets.at(-1)!==basket)seen.baskets.push(basket);
  }
 };
 // Owner progress: travel, battle damage (a long capture battle), catches, task, status, money.
 const progress=s=>JSON.stringify([s?.map,s?.position,s?.mode,s?.observation?.party?.map(p=>p.hp),s?.spectator?.trainer?.pokedex?.owned,s?.bot?.objective?.id,s?.bot?.status,s?.observation?.money]);
 const wait=async(predicate,label,{ms=60000,stallMs=0,progress=null}={})=>{
  const until=Date.now()+ms;let marker=null,markerAt=Date.now();
  while(Date.now()<until){
   alive();const s=status();observe(s);if(s&&predicate(s))return s;
   if(s?.bot?.status==='blocked'&&s.bot.runScope==='postgame')throw Error(label+': the owner stopped: '+s.bot.reason+' '+JSON.stringify({map:s.map,money:s.observation?.money,objective:s.bot.objective,care:agenda()?.fieldCare,seen}));
   if(progress){const next=progress(s);if(next!==marker){marker=next;markerAt=Date.now();}
    if(Date.now()-markerAt>stallMs)throw Error(label+` (no progress for ${stallMs}ms): `+JSON.stringify({map:s?.map,bot:s?.bot,care:agenda()?.fieldCare,seen})+' '+log.slice(-1500));}
   await sleep(100);
  }
  const s=status();throw Error(label+': '+JSON.stringify({map:s?.map,bot:s?.bot,money:s?.observation?.money,care:agenda()?.fieldCare,seen})+' '+log.slice(-1500));
 };
 const command=async body=>{
  const commandId='supply-replan-'+(++sequence);atomicJson(join(game,'command.json'),{...body,commandId,sessionId:status().sessionId});
  if(body.type==='shutdown'){
   const exited=await Promise.race([new Promise(done=>child.once('exit',done)),sleep(20000,null,{ref:false})]);
   assert.equal(exited,0,'the worker must retire cleanly');child=null;return null;
  }
  const s=await wait(s=>s.lastCommand===commandId,'command '+body.type,{ms:120000});assert.equal(s.commandError,null,`${body.type}: ${s.commandError}`);return s;
 };
 let after;
 try{
  child=spawn(process.execPath,[worker,join(root,'config.json'),'firered'],{env,stdio:['ignore','pipe','pipe']});
  for(const stream of [child.stdout,child.stderr])stream.on('data',b=>{log=(log+b).slice(-12000);});
  await wait(s=>s.pid===child.pid,'the owner never published its status');
  const handed=await wait(s=>s.bot?.runScope==='postgame'&&s.campaign?.status==='complete','the completed campaign did not continue into the postgame',{ms:180000});
  assert.equal(handed.campaign.id,run);
  // Base behaviour: the first catch on Route 1/22 (one Ultra Ball) made the
  // retained basket exceed the reserve and the owner stopped for review with
  // nothing bought. Now the basket must be re-derived with nothing bought
  // (durable care state: replanned, observedSpent 0) and the owner must keep
  // travelling past Route 22 without any stop. The trip then continues toward
  // the Indigo Plateau clerk through Victory Road; on this save it later spends
  // every capture ball on National Dex captures and meets the designed
  // empty-ball capture stop (a separate, pre-existing behaviour, see NOTES), so
  // the case ends once the stale-basket leg is proven (or the basket is bought).
  const past=new Set(['MAP_ROUTE23','MAP_VICTORY_ROAD_1F','MAP_VICTORY_ROAD_2F','MAP_VICTORY_ROAD_3F','MAP_INDIGO_PLATEAU_EXTERIOR','MAP_INDIGO_PLATEAU_POKEMON_CENTER_1F']);
  const retained=care=>care?.active?.kind==='shop'?care.active:care?.suspendedShopping??care?.deferredShopping?.task??null;
  let care=null,lastRead=0;
  const reached=await wait(s=>{
   if(Date.now()-lastRead<1000)return false;lastRead=Date.now();
   care=agenda()?.fieldCare??null;const basket=retained(care);
   seen.replanned=Math.max(seen.replanned,basket?.replanned??0);
   return (care?.spent??0)>0||past.has(s.map)&&(basket?.replanned??0)>=1&&basket.observedSpent===0;
  },'the retained basket was not re-derived on the trip past Route 22',{ms:2700000,stallMs:300000,progress}); // stall = no movement, battle damage, catch, status or money change for 5 min
  assert.ok(seen.baskets.length>=1,'the owner planned a supply basket');
  const planned=JSON.parse(seen.baskets[0]),ultraTarget=b=>b.items.find(([id])=>id===2)?.[1];
  assert.equal(planned.money,startMoney);
  assert.ok(ultraTarget(planned)>startUltra,'the planned basket buys Ultra Balls');
  // The native trip went stale before anything was bought; the basket was re-derived instead.
  const rederived=seen.baskets.map(b=>JSON.parse(b)).filter(b=>b.money===planned.money&&ultraTarget(b)<ultraTarget(planned));
  assert.ok(seen.replanned>=1&&rederived.length>=1,`the retained basket was never re-derived on the way: ${JSON.stringify(seen)}`);
  // Stop at a settled field. A plain Stop pauses the owner wherever its last
  // decision left it: gate 106-01 stopped it in a Route 23 wild battle that
  // waits for input, so the stop-time checkpoint below never became stable.
  // The owner's own handoff boundary (the one software updates use) holds it
  // at its next stable overworld frame with no battle, menu, pending save or
  // unsaved capture/transaction and pauses it there; the owner then retires
  // from that frame. The checks below still read the stop-time state.
  await command({type:'prepare-update',updateId:'supply-replan-settled-stop'});
  const held=await wait(s=>s.runtime?.update?.held===true,'the owner never reached a settled field to stop',{ms:900000,stallMs:300000,progress});
  await command({type:'shutdown'});
  const durable=agenda().fieldCare,basket=retained(durable);
  const active=json(join(game,'active-hunt.json'));
  const final=new SaveVault(join(game,'hunts',active.id,'native-radio','saves'),saved.identity).read();
  session.loadSram(final.sram);session.loadState(final.state);after=observer.capture();
  for(let n=0;n<600&&after.phase!=='stable';n++){session.step([]);after=observer.capture();}
  assert.equal(after.phase,'stable');
  const money=after.playerMemory.trainer.money,ultra=count(after,2);
  assert.ok(money>=10000,`the cash reserve is kept on the cartridge: ${money}`);
  // The cartridge's in-game save keeps the reserve too: a cold Continue of the
  // final SRAM with ordinary Continue inputs, as the other replays verify saves.
  const cold=await createSession();let saved_=null;
  try{
   cold.loadSram(final.sram);
   saved_=await continueNativeSaveAsync(cold,createFireRedObserver({session:cold,...inputs,runId:'postgame-supply-replan-cold',storyWatch:watch}));
  }finally{cold.close();}
  assert.equal(saved_.playerMemory.storyState.flagIds[2092],true,'the cold Continue loads this completed save');
  assert.ok(saved_.playerMemory.trainer.money>=10000,`the cash reserve is kept in the in-game save: ${saved_.playerMemory.trainer.money}`);
  if((durable.spent??0)>0){
   // Bought: the durable spending is recorded and no basket is retained.
   assert.equal(basket,null,`the bought basket is not retained: ${JSON.stringify(durable)}`);
  }else{
   // Retained and re-derived: nothing bought, the plan is priced within the reserve.
   assert.ok(basket&&basket.replanned>=1&&basket.observedSpent===0,`the re-derived basket is retained unbought: ${JSON.stringify(durable)}`);
   assert.ok(basket.cost<=basket.lastObservedMoney-10000,`the re-derived basket fits the cash reserve: ${JSON.stringify({basket,money})}`);
   assert.ok(ultraTarget({items:basket.objective.target.items.map(i=>[i.itemId,i.quantity])})<ultraTarget(planned),'the re-derived target follows the thrown balls');
  }
  console.log('# postgame-supply-replan '+JSON.stringify({run,startMoney,startUltra,planned,baskets:seen.baskets.map(b=>JSON.parse(b)),replanned:seen.replanned,
   outcome:(durable.spent??0)>0?'bought':'re-derived',reachedMap:reached.map,spent:durable.spent??0,basket:basket?{cost:basket.cost,replanned:basket.replanned,observedSpent:basket.observedSpent,items:basket.objective.target.items}:null,
   money,ultra,savedMoney:saved_.playerMemory.trainer.money,savedUltra:count(saved_,2),heldAt:{frame:held.frame,map:held.map},objectives:seen.objectives.slice(0,40),maps:seen.maps,frames:after.frame-before.frame}));
 }finally{
  if(child&&child.exitCode===null){child.kill('SIGTERM');await Promise.race([new Promise(done=>child.once('exit',done)),sleep(15000,null,{ref:false})]);if(child.exitCode===null)child.kill('SIGKILL');}
  if(process.env.SUITE_REPLAY_KEEP==='1')console.log('# retained private replay '+root);else rmSync(root,{recursive:true,force:true});
 }
 return {before,after};
}
