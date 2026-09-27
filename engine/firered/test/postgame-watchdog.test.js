import test from 'node:test';
import assert from 'node:assert/strict';
import {createPostgameController} from '../src/suite/postgame.js';
import {FireRedEvolutionTask} from '../src/suite/fire-red-evolution.js';

const args={world:{data:{maps:[],wildEncounters:[]}},story:{data:{scripts:[]}},mechanics:{data:{species:[]}}};
const weedle={validity:'valid',species:13,personality:123,otId:456,shiny:false,level:5,friendship:70,heldItem:0,
 moves:[40],pp:[35],ivs:{hp:20,attack:20,defense:20,speed:20,spAttack:20,spDefense:20}};
function setup(){
 const c=createPostgameController(args);c.beginAdventure();const state=c.state();
 state.dexEvolution=new FireRedEvolutionTask({requestId:'weedle',sourceId:'owned-national-dex',pokemon:weedle,
  steps:[{kind:'evolve',game:'firered',fromSpecies:13,speciesId:14},{kind:'verify',game:'firered',speciesId:14}],request:{speciesId:14,shiny:'any'}}).state;
 const o={captureId:'watch',frame:100,phase:'stable',phaseReasons:[],sram:{sha256:'before'},
  emulator:{mode:'overworld',inBattle:false,inputReady:true},playerMemory:{map:{id:'MAP_VIRIDIAN_FOREST'},position:{x:4,y:27},ui:{},
   storyState:{flagIds:{2092:true},variableIds:{}},gameStats:{savedGame:7},saveAttemptStatus:1,
   trainer:{partyValidity:'valid',party:[],usablePartyCount:0,pokedex:{ownedSpecies:[13]},bag:{},storage:{validity:'valid',pokemon:[weedle],boxCounts:[1,...Array(13).fill(0)]}}}};
 for(const part of [o.sram,o.emulator,o.playerMemory])Object.assign(part,{frame:o.frame,captureId:o.captureId});
 return {state,o};
}
test('a prerequisite evolution with no executable route yields to other work after five active minutes and retains its identity',()=>{
 let {state,o}=setup(),now=1000,c=createPostgameController({...args,state,clock:()=>now});
 c.decide(o);
 for(let i=1;i<=60;i++){
  now+=5000;o.playerMemory.position.x=i%2?4:5;o.playerMemory.storyState.variableIds[0x8000]=i;
  if(i===30)c=createPostgameController({...args,state:JSON.parse(JSON.stringify(c.state())),clock:()=>now});
  c.decide(o);
 }
 const after=c.state();
 assert.equal(after.dexEvolution,null,'a clean pre-evolution withdrawal can be deferred safely');
 assert.equal(after.deferredEvolutions.length,1);
 assert.deepEqual(after.deferredEvolutions[0].state.originalPokemon,weedle);
 assert.ok(after.deferredEvolutions[0].retryAt>now);
 c=createPostgameController({...args,state:JSON.parse(JSON.stringify(after)),clock:()=>now});
 c.decide(o);assert.equal(c.state().dexEvolution,null,'cooldown survives restart');
 now+=300001;c.decide(o);assert.equal(c.state().dexEvolution?.requestId,'weedle','same individual is retried after its cooldown');
});
test('real experience progress resets the timeout but a long pause does not consume five active minutes',()=>{
 const {state,o}=setup();let now=1000,c=createPostgameController({...args,state,clock:()=>now});c.decide(o);
 now+=3600000;c.decide(o);assert.ok(c.state().dexEvolution);
 for(let i=0;i<100;i++){now+=5000;o.playerMemory.trainer.storage.pokemon[0]={...weedle,experience:i};c.decide(o);}
 assert.ok(c.state().dexEvolution);assert.equal(c.state().deferredEvolutions.length,0);
});
test('an in-flight evolution or native save cannot be discarded by the watchdog',()=>{
 const {state,o}=setup();state.dexEvolution.dirty=true;
 let now=1000,c=createPostgameController({...args,state,clock:()=>now});c.decide(o);
 for(let i=0;i<65;i++){now+=5000;c.decide(o);}
 assert.equal(c.state().dexEvolution?.requestId,'weedle');
 assert.equal(c.state().deferredEvolutions.length,0);
 assert.match(c.state().watchdog.reason,/transaction|save/i);
});

function stalledLinkSetup(){
 const {o}=setup();o.playerMemory.map={id:'MAP_PEWTER_CITY_MUSEUM_1F'};o.playerMemory.position={x:0,y:1};
 o.playerMemory.storyState={flagIds:{2092:true,2112:true,2116:false,733:true,142:false,606:false},variableIds:{0x4076:5}};
 o.playerMemory.trainer.party=[{...weedle,species:116,slot:0,hp:30,maxHp:30,moves:[127],pp:[15]}];
 Object.assign(o.playerMemory.trainer,{usablePartyCount:1,partyCount:1,pokedex:{ownedSpecies:Array.from({length:60},(_,i)=>i+1)}});
 o.playerMemory.trainer.storage.pokemon=[];
 const map=(id,events=[])=>({id,properties:{},objectEvents:events,warpEvents:[],connections:[],layout:{id,width:4,height:3,cells:Array.from({length:12},(_,i)=>({x:i%4,y:Math.floor(i/4),collision:0,elevation:3,behaviorName:'MB_NORMAL'}))}});
 const inputs={...args,world:{data:{maps:[map('MAP_PEWTER_CITY_MUSEUM_1F',[{x:3,y:1,elevation:3,script:'PewterCity_Museum_1F_EventScript_OldAmberScientist'}]),map('MAP_FOUR_ISLAND_ICEFALL_CAVE_ENTRANCE')],wildEncounters:[]}}};
 const state={schema:'pokemon-suite/postgame/v1',agenda:{enabled:true,failures:{}},preparation:{kind:'postgame',phase:'sevii-link-quest',travelReady:true,nationalDexSave:{nativeLinkSave:{nativeSaveVerified:true}}}};
 return {o,inputs,state};
}

test('a stalled link prerequisite yields to executable side work and its rejection survives restart',()=>{
 const {o,inputs,state}=stalledLinkSetup();let now=1000,c=createPostgameController({...inputs,state,clock:()=>now});
 c.decide(o);assert.equal(c.state().objective.id,'sevii-reach-harbor-0');
 for(let i=0;i<60;i++){now+=5000;c.decide(o);}
 c=createPostgameController({...inputs,state:JSON.parse(JSON.stringify(c.state())),clock:()=>now});
 const next=c.decide(o);
 assert.equal(c.state().objective?.id,'postgame-old-amber-interact','the failed prerequisite must not immediately win selection again');
 assert.equal(next.winner?.recommendation?.kind,'move-toward','a different executable action is required');
 assert.ok(c.state().agenda.failures['sevii-link'].retryAt>now);
 assert.equal(c.state().preparation.phase,'sevii-link-quest','deferral cannot mark the quest complete');
 now+=300001;c.decide(o);assert.equal(c.state().objective.id,'postgame-save','switching back to the prerequisite retains the native save boundary');
 assert.equal(c.state().pendingObjective.id,'sevii-reach-harbor-0');
});

test('a prerequisite timeout with no available alternative exposes a retry dependency instead of selecting the same action',()=>{
 const {o,inputs,state}=stalledLinkSetup();o.playerMemory.storyState.flagIds[606]=true;
 // A completed prize set prevents a synthetic empty catalog from suggesting it.
 o.playerMemory.trainer.pokedex.ownedSpecies.push(63,35,147,123,137);
 let now=1000,c=createPostgameController({...inputs,state,clock:()=>now});c.decide(o);
 for(let i=0;i<60;i++){now+=5000;c.decide(o);}
 const d=c.decide(o);
 assert.equal(c.state().objective.target.kind,'await-postgame-dependency');
 assert.equal(c.state().status,'dependency');assert.ok(c.state().objective.retryAt>now);
 assert.equal(d.kind,'resample');assert.match(d.reason,/retry|cooling/i);
});

test('a stalled prerequisite cannot yield while its native milestone save is unverified',()=>{
 const {o,inputs,state}=stalledLinkSetup();
 state.preparation.nationalDexSave={linkSave:{counter:7,sha256:'before'}};
 let now=1000,c=createPostgameController({...inputs,state,clock:()=>now});c.decide(o);
 for(let i=0;i<65;i++){now+=5000;c.decide(o);}
 assert.equal(c.state().objective.id,'evolution-save-national-dex');
 assert.equal(c.state().objective.target.kind,'save-game');
 assert.equal(c.state().agenda.failures['sevii-link'],undefined);
 assert.match(c.state().watchdog.reason,/transaction|save/i);
});

test('a recovered National Dex upgrade is not suppressed by its previous route cooldown',()=>{
 const {o,inputs,state}=stalledLinkSetup();
 state.agenda.failures['national-dex']={retryAt:999999,reason:'Old route unavailable',attempts:1};
 const c=createPostgameController({...inputs,state,clock:()=>1000});c.decide(o);
 assert.equal(c.state().objective.id,'sevii-reach-harbor-0');
 assert.equal(c.state().objective.postgamePrerequisite,'sevii-link');
});

test('unsupported navigation has bounded retries that survive restart and expose the failed target',async()=>{
 const {observePostgameNavigation}=await import('../src/suite/postgame-watchdog.js');
 const {o}=setup(),objective={id:'fund-capture-supplies',target:{kind:'vs-seeker-activation',map:'MAP_ROUTE15',x:47,y:7}};
 const decision={winner:{recommendation:{kind:'wait-for-supported-objective',navigation:{status:'unsupported',reason:'No executable route.',target:objective.target}}}};
 let state={},result;const outcomes=[];
 for(let now=0;now<=35000;now+=1000){
  if(now===15000)state=JSON.parse(JSON.stringify(state));
  result=observePostgameNavigation?.(state,o,objective,decision,now);outcomes.push(result?.status);
 }
 assert.equal(result?.status,'failed');assert.deepEqual(result.target,objective.target);assert.ok(outcomes.includes('retry'));
 assert.equal(state.attempts,2,'re-observation cannot start unlimited retry budgets');
});

test('temporary game transitions and user pauses do not spend navigation deadlines',async()=>{
 const {observePostgameNavigation}=await import('../src/suite/postgame-watchdog.js');const {o}=setup();const state={},objective={id:'walk',target:{kind:'walk-to',map:'MAP_ROUTE15',x:2,y:3}};
 const decision={winner:{recommendation:{kind:'wait-for-supported-objective'}}};
 observePostgameNavigation?.(state,o,objective,decision,0);
 observePostgameNavigation?.(state,o,objective,decision,3600000);
 assert.equal(state.idleMs,5000,'a paused hour contributes at most one bounded active sample');
 o.phase='transition';for(let i=1;i<40;i++)observePostgameNavigation?.(state,o,objective,decision,3600000+i*1000);
 assert.equal(state.idleMs,5000);
 o.phase='stable';const moving={winner:{recommendation:{kind:'move-toward'}}};
 assert.equal(observePostgameNavigation?.(state,o,objective,moving,3650000)?.status,'action');assert.equal(state.idleMs,0);
});

test('missing policy advice consumes the same deadline instead of masquerading as progress',async()=>{
 const {observePostgameNavigation}=await import('../src/suite/postgame-watchdog.js');const {o}=setup();const state={},objective={id:'unsupported',target:{kind:'walk-to',map:'MAP_UNKNOWN',x:1,y:1}};
 let result;for(let now=0;now<=30000;now+=1000)result=observePostgameNavigation(state,o,objective,{kind:'resample',reason:'no-advice'},now);
 assert.equal(result.status,'failed');
});

test('funding receipts reset semantic timeout, but recharge cycles and frame ticks do not',async()=>{
 const {observePostgameProgress}=await import('../src/suite/postgame-watchdog.js');const {o}=setup();const state={};o.playerMemory.trainer.money=271;o.playerMemory.postgameEvidence={acquisition:{coins:320}};
 observePostgameProgress(state,o,'prize',0);
 for(let i=1;i<=59;i++)observePostgameProgress(state,o,'prize',i*5000);
 o.playerMemory.trainer.money=851;assert.equal(observePostgameProgress(state,o,'prize',300000),false);assert.equal(state.idleMs,0);
 for(let i=1;i<=59;i++)observePostgameProgress(state,o,'prize',300000+i*5000);
 o.playerMemory.postgameEvidence.acquisition.coins=370;assert.equal(observePostgameProgress(state,o,'prize',600000),false);assert.equal(state.idleMs,0);
 for(let i=1;i<=60;i++){o.frame++;o.playerMemory.vsSeeker={batterySteps:i%2?0:100};observePostgameProgress(state,o,'prize',600000+i*5000);}
 assert.equal(state.idleMs,300000,'repeated recharge/activation without a payout must still time out');
});

test('an unreadable transition cannot bypass the owner progress deadline',async()=>{
 const {observePostgameProgress}=await import('../src/suite/postgame-watchdog.js');const {o}=setup(),state={};observePostgameProgress(state,o,'prize',0);o.phase='transition';let result;
 for(let i=1;i<=60;i++)result=observePostgameProgress(state,o,'prize',i*5000);
 assert.equal(result,true);
});

test('boundary recovery retains its deadline across battles, dialogue, saves and restart',async()=>{
 const {observePostgameBoundary}=await import('../src/suite/postgame-watchdog.js');const {o}=setup();let state={},result;
 for(let i=0;i<=24;i++){
  if(i===10)state=JSON.parse(JSON.stringify(state));
  o.emulator.mode=i<8?'battle':'overworld';o.emulator.inBattle=i<8;o.playerMemory.ui=i<8?{}:i<16?{fieldDialog:true}:{saveDialog:true};
  result=observePostgameBoundary?.(state,o,'prize','Funding made no progress.',i*5000);
 }
 assert.equal(result?.status,'failed');assert.match(result.reason,/120|deadline/i);assert.equal(state.owner,'prize');
});

test('a paused hour does not exhaust a boundary drain deadline',async()=>{
 const {observePostgameBoundary}=await import('../src/suite/postgame-watchdog.js');const {o}=setup(),state={};
 observePostgameBoundary?.(state,o,'prize','No progress',0);const result=observePostgameBoundary?.(state,o,'prize','No progress',3600000);
 assert.equal(result?.status,'draining');assert.equal(result.remainingMs,115000);
});

test('a reserved deferred evolution survives an intervening hunt through the shared agenda',()=>{
 const {state}=setup();const deferred={state:state.dexEvolution,retryAt:10000,reason:'No supported route'};state.dexEvolution=null;state.deferredEvolutions=[deferred];
 const first=createPostgameController({...args,state});const next=createPostgameController({...args,state:{schema:'pokemon-suite/postgame/v1',agenda:JSON.parse(JSON.stringify(first.state().agenda))}});
 assert.deepEqual(next.state().deferredEvolutions,[deferred]);
});

test('an unverified milestone save drains under its original owner then blocks at the retained deadline',()=>{
 const {o,inputs,state}=stalledLinkSetup();state.preparation.nationalDexSave={linkSave:{counter:7,sha256:'before'}};
 let now=1000,c=createPostgameController({...inputs,state,clock:()=>now});let d=c.decide(o);
 for(let i=0;i<90;i++){now+=5000;if(i===70)c=createPostgameController({...inputs,state:JSON.parse(JSON.stringify(c.state())),clock:()=>now});d=c.decide(o);}
 assert.equal(d.kind,'blocked');assert.match(d.reason,/deadline/);assert.equal(c.state().agenda.failures['sevii-link'],undefined);
 assert.deepEqual(c.state().preparation.nationalDexSave.linkSave,{counter:7,sha256:'before'});
});

test('incidental walking friendship cannot keep a currency task alive without funding progress',async()=>{
 const {observePostgameProgress}=await import('../src/suite/postgame-watchdog.js');const {o}=setup(),state={};o.playerMemory.trainer.money=3563;o.playerMemory.postgameEvidence={acquisition:{coins:2520}};
 observePostgameProgress(state,o,'prize',0,'currency');let timedOut=false;
 for(let i=1;i<=60;i++){o.playerMemory.trainer.storage.pokemon[0].friendship++;o.playerMemory.trainer.storage.pokemon[0].experience=i*20;timedOut=observePostgameProgress(state,o,'prize',i*5000,'currency');}
 assert.equal(timedOut,true);
});

test('a controller restored directly into an unreadable transition still has a bounded owner clock',async()=>{
 const {observePostgameProgress}=await import('../src/suite/postgame-watchdog.js');const {o}=setup(),state={};o.phase='transition';let timedOut=false;
 for(let i=0;i<=60;i++)timedOut=observePostgameProgress(state,o,'prize',i*5000);
 assert.equal(timedOut,true);
});

test('ineffective field actions exhaust navigation recovery even when advice exists, across restart',async()=>{
 const {observePostgameNavigation}=await import('../src/suite/postgame-watchdog.js');
 for(const kind of ['use-field-move','interact-with-object','move-toward','push-field-obstacle']){
  const {o}=setup(),objective={id:'stock-postgame-supplies',target:{kind:'purchase-items',map:'MAP_INDIGO_PLATEAU_POKEMON_CENTER_1F'}};
  let state={},result;const outcomes=[];
  for(let now=0;now<=35000;now+=1000){
   if(now===15000)state=JSON.parse(JSON.stringify(state));
   o.frame++;o.playerMemory.storyState.variableIds[0x8004]=now;
   result=observePostgameNavigation(state,o,objective,{winner:{recommendation:{kind,direction:'west'}}},now);outcomes.push(result.status);
  }
  assert.equal(result.status,'failed',kind+' must require an observed result');assert.ok(outcomes.includes('retry'));
 }
});

test('observed movement refreshes an executable route but a changed recommendation alone does not',async()=>{
 const {observePostgameNavigation}=await import('../src/suite/postgame-watchdog.js');const {o}=setup(),state={},objective={id:'walk',target:{kind:'walk-to',map:'MAP_ROUTE15',x:2,y:3}};
 for(let now=0;now<=60000;now+=1000){o.playerMemory.position.x++;assert.equal(observePostgameNavigation(state,o,objective,{winner:{recommendation:{kind:'move-toward'}}},now).status,'action');}
 let result;for(let now=61000;now<=96000;now+=1000)result=observePostgameNavigation(state,o,objective,{winner:{recommendation:{kind:now%2000?'move-toward':'use-field-move'}}},now);
 assert.equal(result.status,'failed');
});

test('an ownerless native maintenance save has a retained deadline and cannot run forever',()=>{
 const {o}=setup();o.phase='transition';let now=0;
 const state={schema:'pokemon-suite/postgame/v1',agenda:{enabled:false},preparation:{kind:'postgame',phase:'complete'},objective:{id:'postgame-save',target:{kind:'save-game',map:o.playerMemory.map.id}},save:{count:7,sha256:'before',map:o.playerMemory.map.id}};
 let c=createPostgameController({...args,state,clock:()=>now}),d;
 for(let i=0;i<90;i++){
  now+=5000;d=c.decide(o);if(i===35)c=createPostgameController({...args,state:JSON.parse(JSON.stringify(c.state())),clock:()=>now});
  if(d.kind==='blocked')break;
 }
 assert.equal(d.kind,'blocked');assert.ok(c.state().save,'unverified save remains owned');assert.match(d.reason,/deadline|120.second/i);
});

test('ownerless maintenance routes cannot evade the semantic deadline by moving in a loop',()=>{
 for(const [id,kind] of [['stock-postgame-supplies','purchase-items'],['restore-postgame-party','object'],['restore-postgame-party-with-items','heal-with-items']]){
  const {o,inputs}=stalledLinkSetup();o.playerMemory.trainer.party[0].hp=30;o.playerMemory.storyState.flagIds[2116]=true;
  const objective={id,taskKind:'recovery',target:{kind,map:'MAP_MISSING_MART',items:[{itemId:2,quantity:30}]}};
  const state={schema:'pokemon-suite/postgame/v1',agenda:{enabled:true,active:null},preparation:{kind:'postgame',phase:'complete'},objective,
   fieldCare:{active:{kind:'shop',objective,cost:100}}};
  let now=0,c=createPostgameController({...inputs,state,clock:()=>now}),d;
  for(let i=0;i<100;i++){
   now+=5000;o.playerMemory.position.x=i%2;o.playerMemory.trainer.party[0].friendship=i;
   d=c.decide(o);if(i===25)c=createPostgameController({...inputs,state:JSON.parse(JSON.stringify(c.state())),clock:()=>now});
   if(d.kind==='blocked')break;
  }
  assert.equal(d.kind,'blocked',id+' must terminate a maintenance loop');assert.match(d.reason,/five active minutes|120.second.*deadline/);
 }
});

test('maintenance supervision leaves deliberate dependency waits available for later retry',()=>{
 const {o,inputs,state}=stalledLinkSetup();o.playerMemory.storyState.flagIds[606]=true;o.playerMemory.trainer.pokedex.ownedSpecies.push(63,35,147,123,137);
 let now=1000,c=createPostgameController({...inputs,state,clock:()=>now}),d;
 c.decide(o);for(let i=0;i<60;i++){now+=5000;c.decide(o);}c.decide(o);
 const held=c.state();assert.equal(held.objective.target.kind,'await-postgame-dependency');for(const f of Object.values(held.agenda.failures))f.retryAt=now+3600000;c=createPostgameController({...inputs,state:held,clock:()=>now});
 for(let i=0;i<80;i++){now+=5000;d=c.decide(o);assert.notEqual(d.kind,'blocked',d.reason);}
 assert.equal(c.state().status,'dependency');
});

test('currency supervision does not accept incidental saves, story variables or party reorder as income',async()=>{
 const {observePostgameProgress}=await import('../src/suite/postgame-watchdog.js');const {o}=setup(),state={};
 o.playerMemory.trainer.money=539;o.playerMemory.postgameEvidence={acquisition:{coins:3020}};
 observePostgameProgress(state,o,'prize',0,'currency');let timedOut;
 for(let i=1;i<=60;i++){
  o.playerMemory.gameStats.savedGame++;o.playerMemory.storyState.variableIds[0x4060]=i;
  timedOut=observePostgameProgress(state,o,'prize',i*5000,'currency');
 }
 assert.equal(timedOut,true,'funding requires currency, inventory or owned Pokémon progress');
});

test('repeated native saves cannot hide a postgame objective loop across controller restart',async()=>{
 const {observePostgameProgress}=await import('../src/suite/postgame-watchdog.js');
 for(const owner of ['trainer-tower','fame-checker','national-collection','unown-forms']){
  const {o}=setup();let state={},timedOut=false;
  o.playerMemory.storyState.variableIds[0x4082]=0;
  observePostgameProgress(state,o,owner,0);
  for(let i=1;i<=65;i++){
   o.frame+=100;
   o.playerMemory.position.x=i%2;
   o.playerMemory.storyState.variableIds[0x4082]=i%2;
   o.playerMemory.gameStats.savedGame++;
   if(i===30)state=JSON.parse(JSON.stringify(state));
   timedOut=observePostgameProgress(state,o,owner,i*5000);
  }
  assert.equal(timedOut,true,owner+' must require objective progress despite successful saves');
 }
});

test('new Tower floors and Fame facts refresh the deadline without requiring a save',async()=>{
 const {observePostgameProgress}=await import('../src/suite/postgame-watchdog.js');
 for(const owner of ['trainer-tower','fame-checker']){
  const {o}=setup(),state={};
  o.playerMemory.postgameEvidence={trainerTower:[{floorsCleared:0,receivedPrize:false}],fameChecker:[{person:0,entries:0}]};
  observePostgameProgress(state,o,owner,0);
  for(let i=1;i<=59;i++)observePostgameProgress(state,o,owner,i*5000);
  if(owner==='trainer-tower')o.playerMemory.postgameEvidence.trainerTower[0].floorsCleared=1;
  else o.playerMemory.postgameEvidence.fameChecker[0].entries=1;
  assert.equal(observePostgameProgress(state,o,owner,300000),false);
  assert.equal(state.idleMs,0,'the new native achievement must refresh the deadline');
  assert.equal(o.playerMemory.gameStats.savedGame,7,'achievement progress is distinct from saving');
 }
});

test('native League and hatch counters are meaningful record progress',async()=>{
 const {observePostgameProgress}=await import('../src/suite/postgame-watchdog.js');
 for(const [owner,counter] of [['hall-sticker','leagueEntries'],['egg-sticker','eggsHatched']]){
  const {o}=setup(),state={};o.playerMemory.gameStats[counter]=1;
  observePostgameProgress(state,o,owner,0);
  for(let i=1;i<=59;i++)observePostgameProgress(state,o,owner,i*5000);
  o.playerMemory.gameStats[counter]++;
  assert.equal(observePostgameProgress(state,o,owner,300000),false);assert.equal(state.idleMs,0);
 }
});

// The Dunsparce Tunnel fix reads VAR_NATIONAL_DEX (0x404E) in every postgame
// observation. A retained owner's first observation after that update had an
// evidence signature it had never seen, so the update alone renewed its
// five-minute budget and reported verified story progress.
const retainedStoryOwner=async(checkpoint)=>{
 const {observePostgameProgress}=await import('../src/suite/postgame-watchdog.js');
 const {o}=setup();let state={};
 o.playerMemory.storyState.variableIds={0x4060:1};
 observePostgameProgress(state,o,'national-collection',0);
 for(let i=1;i<=50;i++)observePostgameProgress(state,o,'national-collection',i*5000);
 state=JSON.parse(JSON.stringify(state));
 // A watchdog saved before this engine recorded no story ids.
 if(checkpoint==='legacy')delete state.storyIds;
 return {observePostgameProgress,o,state};
};

test('an update that watches another story value cannot renew a retained owner budget',async()=>{
 for(const checkpoint of ['current','legacy']){
  const {observePostgameProgress,o,state}=await retainedStoryOwner(checkpoint);
  o.playerMemory.storyState.variableIds={0x404e:0x6258,0x4060:1};
  if(checkpoint==='current')o.playerMemory.storyState.flagIds[2203]=true;
  assert.equal(observePostgameProgress(state,o,'national-collection',255000),false);
  assert.equal(state.idleMs,255000,checkpoint+': watching a value is not progress');
  assert.equal(state.verifiedStoryProgress,false,checkpoint+': watching a value is not story progress');
  let timedOut=false;
  for(let i=52;i<=60;i++)timedOut=observePostgameProgress(state,o,'national-collection',i*5000);
  assert.equal(timedOut,true,checkpoint+': the retained budget still runs out after five active minutes');
 }
});

test('story progress arriving with or after a newly watched value is still progress',async()=>{
 for(const checkpoint of ['current','legacy']){
  const {observePostgameProgress,o,state}=await retainedStoryOwner(checkpoint);
  // A watched value advances in the same observation that first reads VAR_NATIONAL_DEX.
  o.playerMemory.storyState.variableIds={0x404e:0,0x4060:2};
  observePostgameProgress(state,o,'national-collection',255000);
  assert.equal(state.idleMs,0,checkpoint+': the advanced value is progress');
  assert.equal(state.verifiedStoryProgress,true);
  for(let i=52;i<=100;i++)observePostgameProgress(state,o,'national-collection',i*5000);
  // Later the newly watched value itself changes (the National Dex is enabled).
  o.playerMemory.storyState.variableIds={0x404e:0x6258,0x4060:2};
  assert.equal(observePostgameProgress(state,o,'national-collection',505000),false);
  assert.equal(state.idleMs,0,checkpoint+': the newly watched value changing is progress');
 }
});

test('currency progress arriving with a newly watched value is still progress',async()=>{
 const {observePostgameProgress}=await import('../src/suite/postgame-watchdog.js');const {o}=setup(),state={};
 o.playerMemory.trainer.money=539;o.playerMemory.postgameEvidence={acquisition:{coins:3020}};
 for(let i=0;i<=50;i++)observePostgameProgress(state,o,'prize',i*5000,'currency');
 o.playerMemory.storyState.variableIds={...o.playerMemory.storyState.variableIds,[0x404e]:0x6258};
 o.playerMemory.postgameEvidence.acquisition.coins=3070;
 observePostgameProgress(state,o,'prize',255000,'currency');
 assert.equal(state.idleMs,0,'the paid coins are progress');
});

test('completed Sevii prerequisites cannot own retained shopping or renew its maintenance deadline',()=>{
 const {o,inputs,state}=stalledLinkSetup();o.playerMemory.storyState.flagIds[2116]=true;
 state.objective={id:'stock-postgame-supplies',taskKind:'recovery',target:{kind:'purchase-items',map:'MAP_MISSING_MART',items:[{itemId:2,quantity:30}]}};
 state.fieldCare={active:{kind:'shop',objective:state.objective,cost:100}};
 let now=1000,c=createPostgameController({...inputs,state,clock:()=>now});c.decide(o);
 assert.equal(c.state().watchdog.owner,'postgame-maintenance');
 assert.equal(c.state().agenda.failures?.['sevii-link'],undefined);
 const held=JSON.parse(JSON.stringify(c.state()));held.watchdog.idleMs=299000;
 c=createPostgameController({...inputs,state:held,clock:()=>now});now+=5000;
 const d=c.decide(o);
 assert.notEqual(c.state().watchdog.owner,'sevii-link');
 assert.equal(c.state().agenda.failures?.['sevii-link'],undefined);
 assert.ok(d.kind==='blocked'||c.state().fieldCare.deferredShopping,'exhausted maintenance must stop or defer its basket');
});

test('an exhausted supply route defers its basket without retrying completed prerequisites',()=>{
 const {o,inputs,state}=stalledLinkSetup();o.playerMemory.storyState.flagIds[2116]=true;
 state.objective={id:'stock-postgame-supplies',taskKind:'recovery',target:{kind:'purchase-items',map:'MAP_MISSING_MART',items:[{itemId:2,quantity:30,unitPrice:1200}]}};
 state.fieldCare={active:{kind:'shop',objective:state.objective,cost:36000}};
 state.watchdog={owner:'postgame-maintenance',idleMs:300000,lastAt:1000};
 const c=createPostgameController({...inputs,state,clock:()=>1000});c.decide(o);
 assert.ok(c.state().fieldCare.deferredShopping,'retain the failed basket for explicit recovery');
 assert.equal(c.state().fieldCare.active,null);
 assert.equal(c.state().fieldCare.routeFailures.MAP_MISSING_MART.attempts,1);
 assert.equal(c.state().watchdog.idleMs,300000,'deferral does not forgive the parent budget');
 assert.ok(c.state().save,'save boundary owns partial inventory before other work');
});

test('healing a suspended shopping trip and migrating its old owner preserve consumed time',()=>{
 const {o,inputs,state}=stalledLinkSetup();o.playerMemory.storyState.flagIds[2116]=true;
 const shop={kind:'shop',cost:36000,objective:{id:'stock-postgame-supplies',taskKind:'recovery',target:{kind:'purchase-items',map:'MAP_MISSING_MART',items:[{itemId:2,quantity:30,unitPrice:1200}]}}};
 state.objective={id:'restore-postgame-party-with-items',taskKind:'recovery',target:{kind:'heal-with-items',travel:true}};
 state.fieldCare={active:{kind:'items',objective:state.objective},suspendedShopping:shop};
 state.watchdog={owner:'sevii-link',idleMs:200000,lastAt:1000,seen:[]};
 o.playerMemory.ui={party:{stage:'message'}};
 let now=6000,c=createPostgameController({...inputs,state,clock:()=>now});c.decide(o);
 assert.equal(c.state().watchdog.owner,'postgame-maintenance');
 assert.ok(c.state().watchdog.idleMs>=200000,'legacy owner migration preserves consumed time');
 const held=JSON.parse(JSON.stringify(c.state()));
 o.playerMemory.trainer.bag.items=[{itemId:24,quantity:2}];now+=5000;
 c=createPostgameController({...inputs,state:held,clock:()=>now});c.decide(o);
 assert.ok(c.state().watchdog.idleMs>=205000,'medicine consumption does not reset shopping progress');
});

test('a native Victory Road switch advances retained shopping while medicine and saves do not',()=>{
 const {o,inputs,state}=stalledLinkSetup();o.playerMemory.storyState.flagIds[2116]=true;
 o.playerMemory.storyState.variableIds[0x4064]=0;
 const basket={kind:'shop',cost:36000,objective:{id:'stock-postgame-supplies',taskKind:'recovery',target:{kind:'purchase-items',map:'MAP_MISSING_MART',items:[{itemId:2,quantity:30,unitPrice:1200}]}}};
 state.objective={id:'restore-postgame-party-with-items',taskKind:'recovery',target:{kind:'heal-with-items',travel:true}};
 state.fieldCare={active:{kind:'items',objective:state.objective},suspendedShopping:basket};
 state.watchdog={owner:'postgame-maintenance',idleMs:220000,lastAt:1000,seen:[]};
 o.playerMemory.ui={party:{stage:'message'}};
 let now=1000,c=createPostgameController({...inputs,state,clock:()=>now});c.decide(o);
 const baseline=c.state().watchdog.idleMs;
 o.playerMemory.trainer.bag.items=[{itemId:24,quantity:2}];now+=5000;c.decide(o);
 assert.ok(c.state().watchdog.idleMs>=baseline+5000,'consuming medicine does not renew the shopping deadline');
 o.playerMemory.gameStats.savedGame++;now+=5000;c.decide(o);
 assert.ok(c.state().watchdog.idleMs>=baseline+10000,'repeated native saves do not renew the shopping deadline');
 o.playerMemory.storyState.variableIds[0x4064]=100;now+=5000;c.decide(o);
 assert.equal(c.state().watchdog.idleMs,0,'the completed switch is verified puzzle progress');
 c=createPostgameController({...inputs,state:JSON.parse(JSON.stringify(c.state())),clock:()=>now});
 o.playerMemory.storyState.variableIds[0x4064]=0;now+=5000;c.decide(o);
 assert.equal(c.state().watchdog.idleMs,5000,'a previously observed switch state cannot renew time');
 o.playerMemory.storyState.variableIds[0x4064]=100;now+=5000;c.decide(o);
 assert.equal(c.state().watchdog.idleMs,10000,'revisiting the completed switch cannot renew time');
});

test('a retained care budget stop cannot defer an unrelated collection owner',()=>{
 const {o,inputs,state}=stalledLinkSetup();o.playerMemory.storyState.flagIds[2116]=true;o.playerMemory.trainer.money=5000;
 state.agenda.active='national-collection';state.preparation.phase='complete';
 state.fieldCare={suspendedShopping:{kind:'shop',cost:36000,objective:{id:'stock-postgame-supplies',taskKind:'recovery',target:{kind:'purchase-items',map:'MAP_MISSING_MART',items:[{itemId:2,quantity:30,unitPrice:1200}]}}}};
 const c=createPostgameController({...inputs,state,clock:()=>1000}),d=c.decide(o);
 assert.equal(d.kind,'blocked');assert.match(d.reason,/spending limit|cash reserve/);
 assert.ok(c.state().fieldCare.suspendedShopping);assert.equal(c.state().agenda.failures?.['national-collection'],undefined);
});
