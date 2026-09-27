import test from 'node:test';
import assert from 'node:assert/strict';
import * as postgame from '../src/suite/postgame.js';
const mon=(species=9,id=100)=>({slot:0,species,personality:id,otId:10,validity:'valid',shiny:false,isEgg:false,hp:100,maxHp:100,status1:0,level:40,friendship:100,moves:[57],pp:[15],heldItem:0,ivs:{hp:1,attack:2,defense:3,speed:4,spAttack:5,spDefense:6}});
const o=()=>({phase:'stable',frame:100,emulator:{mode:'overworld',inBattle:false,inputReady:true,callback2:'CB2_Overworld'},sram:{sha256:'a'.repeat(64)},playerMemory:{map:{id:'MAP_CELADON_CITY'},ui:{},storyState:{flagIds:{2092:true,2112:true,2116:true,579:false}},gameStats:{savedGame:10},trainer:{partyValidity:'valid',party:[mon()],pokedex:{ownedSpecies:[9]},storage:{validity:'valid',pokemon:[],boxCounts:Array(14).fill(0)},money:210000,bag:{}},postgameEvidence:{acquisition:{coins:0,prompt:null,daycare:null,slots:null}}}});
const world={data:{maps:[
 ['MAP_CELADON_CITY_RESTAURANT','CeladonCity_Restaurant_EventScript_CoinCaseMan'],
 ['MAP_CELADON_CITY_GAME_CORNER','CeladonCity_GameCorner_EventScript_CoinsClerk'],
 ['MAP_CELADON_CITY_GAME_CORNER_PRIZE_ROOM','CeladonCity_GameCorner_PrizeRoom_EventScript_PrizeClerkMons'],
 ].map(([id,script])=>({id,objectEvents:[{script}],backgroundEvents:[{script:'CeladonCity_GameCorner_EventScript_SlotMachine1'}]}))}};
const create=(state=null,speciesId=137)=>postgame.createPostgameAcquisition?.({kind:'game-corner',requestId:'prize-'+speciesId,speciesId,state,world});

test('a retained acquisition uses the ferry without replacing its purchase destination',()=>{
 const obs=o(),m=obs.playerMemory;
 Object.assign(obs,{captureId:'acquisition-ferry',phaseReasons:[]});
 for(const part of [obs.emulator,obs.sram,m])Object.assign(part,{captureId:obs.captureId,frame:obs.frame});
 m.map.id='MAP_FOUR_ISLAND_HARBOR';m.position={x:5,y:4};
 m.storyState.flagIds[579]=true;m.storyState.variableIds={0x4076:5,0x4071:4,0x8005:0};
 m.ui={choiceMenu:{kind:'multichoice',cursor:3,maxCursor:4}};
 const args={world,story:{data:{scripts:[]}},mechanics:{data:{species:[]}}};
 let controller=postgame.createPostgameController(args);
 controller.beginAcquisition({kind:'game-corner',requestId:'retained-island-prize',speciesId:123});
 for(let i=0;i<2;i++){
  const decision=controller.decide(obs);
  assert.equal(decision.winner?.recommendation.objective,'sevii-sail-0');
  assert.equal(decision.winner.recommendation.targetIndex,0);
  assert.equal(controller.state().objective.target.map,'MAP_CELADON_CITY_GAME_CORNER');
  assert.equal(controller.state().acquisition.requestId,'retained-island-prize');
  controller=postgame.createPostgameController({...args,state:JSON.parse(JSON.stringify(controller.state()))});
 }
});

test('prize acquisition obtains the actual Coin Case before funding a purchase',()=>{
 const task=create(),next=task?.inspect(o());
 assert.equal(next?.objective?.target.map,'MAP_CELADON_CITY_RESTAURANT');
 assert.equal(next?.objective?.target.kind,'object');
});

test('coin funding observes the cap instead of repeatedly buying an impossible batch',()=>{
 for(const [coins,expected,option] of [[0,'policy',1],[9500,'policy',0],[9950,'policy',null],[9999,'policy',4]]){
  const task=create(),obs=o();obs.playerMemory.storyState.flagIds[579]=true;obs.playerMemory.postgameEvidence.acquisition.coins=coins;
  const d=task?.inspect(obs);assert.equal(d?.kind,expected);
  if(coins===9950)assert.equal(d.objective.target.kind,'background');
  else assert.equal(d.objective.choiceByRows[coins===9999?6:3],option);
 }
});

test('a retained coin purchase drains its dialogue before choosing another batch',()=>{
 let task=create();const obs=o();obs.playerMemory.map.id='MAP_CELADON_CITY_GAME_CORNER';obs.playerMemory.storyState.flagIds[579]=true;
 task.inspect(obs);task=create(task.state);
 obs.playerMemory.postgameEvidence.acquisition.coins=500;obs.playerMemory.trainer.money=200000;obs.playerMemory.ui.fieldDialog={ready:true};
 assert.equal(task.inspect(obs).objective.target.kind,'map');
 obs.playerMemory.ui={};assert.equal(task.inspect(obs).objective.choiceByRows[3],1);
 obs.playerMemory.postgameEvidence.acquisition.coins=1000;obs.playerMemory.trainer.money=195000;
 assert.equal(task.inspect(obs).kind,'stop','unexpected debit cannot silently certify the purchase');
});

test('a prize survives restart and requires its exact coin payment and a later native save',()=>{
 let task=create();const obs=o(),m=obs.playerMemory;m.map.id='MAP_CELADON_CITY_GAME_CORNER_PRIZE_ROOM';m.storyState.flagIds[579]=true;m.postgameEvidence.acquisition.coins=9999;
 assert.equal(task.inspect(obs).objective.choiceByRows[6],4);
 // An unrelated earlier save cannot certify the newly received prize.
 m.gameStats.savedGame=11;obs.sram.sha256='b'.repeat(64);m.saveAttemptStatus=1;
 const p={...mon(137,200),slot:1,level:26};m.trainer.party.push(p);m.trainer.pokedex.ownedSpecies.push(137);m.postgameEvidence.acquisition.coins=0;m.ui.choiceMenu={cursor:0,maxCursor:1};
 assert.equal(task.inspect(obs).recommendation?.targetOption,'no');task=create(task.state);
 m.ui={};assert.equal(task.inspect(obs).objective.target.kind,'save-game');
 task=create(task.state);m.gameStats.savedGame=12;obs.sram.sha256='c'.repeat(64);
 const d=task.inspect(obs);assert.equal(d.kind,'complete');assert.equal(d.receipt.nativeSaveVerified,true);assert.equal(d.receipt.pokemon.personality,200);assert.equal(d.receipt.coinsSpent,9999);
 assert.deepEqual(m.trainer.party[0],mon());
});

test('a received prize cannot complete without verified payment even if its Dex bit changed',()=>{
 const task=create(),obs=o(),m=obs.playerMemory;m.map.id='MAP_CELADON_CITY_GAME_CORNER_PRIZE_ROOM';m.storyState.flagIds[579]=true;m.postgameEvidence.acquisition.coins=9999;task.inspect(obs);
 m.trainer.party.push({...mon(137,200),slot:1});m.trainer.pokedex.ownedSpecies.push(137);
 assert.equal(task.inspect(obs).kind,'stop');
});

test('coin-cap recovery plays one-coin rounds and quits through the native confirmation',()=>{
 let task=create();const obs=o(),m=obs.playerMemory;obs.phase='transition';obs.emulator.callback2='CB2_RunSlotMachine';m.postgameEvidence.acquisition.coins=9950;
 m.postgameEvidence.acquisition.slots={task:'MainTask_SlotsGameLoop',stage:0,bet:0};
 assert.deepEqual(task.inspect(obs).action?.buttons,['down']);
 m.postgameEvidence.acquisition.coins=9949;m.postgameEvidence.acquisition.slots.bet=1;
 assert.deepEqual(task.inspect(obs).action?.buttons,['a'],'finish the paid round; do not quit and refund it');
 m.postgameEvidence.acquisition.slots.bet=0;
 assert.deepEqual(task.inspect(obs).action?.buttons,['b']);task=create(task.state);
 m.postgameEvidence.acquisition.slots={task:'MainTask_ConfirmExitGame',stage:2,bet:0};
 assert.deepEqual(task.inspect(obs).action?.buttons,['up']);assert.deepEqual(task.inspect(obs).action?.buttons,['a']);
});

test('postgame owns a received prize through restart, native save and receipt acknowledgement',()=>{
 const args={world,story:{data:{scripts:[]}},mechanics:{data:{species:[],moves:[]}}};
 let controller=postgame.createPostgameController(args);
 assert.equal(typeof controller.beginAcquisition,'function');
 controller.beginAcquisition({kind:'game-corner',requestId:'prize-137',speciesId:137});
 const obs=o(),m=obs.playerMemory;obs.captureId='acquisition-test';for(const key of ['emulator','screen','playerMemory','sram'])obs[key]={...obs[key],captureId:obs.captureId,frame:obs.frame};obs.playerMemory=m;Object.assign(m,{captureId:obs.captureId,frame:obs.frame});m.storyState.flagIds[579]=true;m.map.id='MAP_CELADON_CITY_GAME_CORNER_PRIZE_ROOM';m.postgameEvidence.acquisition.coins=9999;
 controller.decide(obs);
 m.trainer.party.push({...mon(137,200),slot:1});m.trainer.pokedex.ownedSpecies.push(137);m.postgameEvidence.acquisition.coins=0;m.ui.choiceMenu={cursor:0,maxCursor:1};
 assert.ok(controller.decide(obs).action);controller=postgame.createPostgameController({...args,state:controller.state()});
 m.ui={};assert.equal(controller.canYield(obs),false);controller.decide(obs);
 m.gameStats.savedGame++;m.saveAttemptStatus=1;obs.sram.sha256='b'.repeat(64);
 const d=controller.decide(obs);assert.equal(d.kind,'acquisition-saved');assert.equal(d.receipt.nativeSaveVerified,true);
 controller.acknowledgeAcquisition();assert.equal(controller.state().acquisition,null);assert.equal(controller.canYield(obs),true);
});

test('a reserved native acquisition cannot be discarded by another task or adventure',()=>{
 const args={world,story:{data:{scripts:[]}},mechanics:{data:{species:[],moves:[]}}};
 for(const change of [c=>c.beginAdventure(),c=>c.beginPlayerTask({id:'new-task',kind:'travel'}),c=>c.beginEvolution({requestId:'another'}),c=>c.preserveEvolutionSource()]){
  const controller=postgame.createPostgameController({...args,state:{schema:'pokemon-suite/postgame/v1',acquisition:{schema:'pokemon-suite/native-acquisition/v1',kind:'game-corner',requestId:'paid-prize',speciesId:137,phase:'saving',dirty:true}}});
  assert.throws(()=>change(controller),/reserved acquisition/);
  assert.equal(controller.state().acquisition.requestId,'paid-prize');
 }
});

test('a received prize with no readable save baseline stops without issuing repeated saves',()=>{
 const task=create(),obs=o(),m=obs.playerMemory;m.map.id='MAP_CELADON_CITY_GAME_CORNER_PRIZE_ROOM';m.storyState.flagIds[579]=true;m.postgameEvidence.acquisition.coins=9999;task.inspect(obs);
 m.trainer.party.push({...mon(137,200),slot:1});m.trainer.pokedex.ownedSpecies.push(137);m.postgameEvidence.acquisition.coins=0;delete m.gameStats.savedGame;
 assert.equal(task.inspect(obs).kind,'stop');assert.match(task.state.reason,/save baseline/);
});

test('an unavailable uncommitted acquisition defers and leaves other postgame work runnable',()=>{
 const args={world:{data:{maps:[]}},story:{data:{scripts:[]}},mechanics:{data:{species:[],moves:[]}}};
 const controller=postgame.createPostgameController({...args,state:{schema:'pokemon-suite/postgame/v1',agenda:{enabled:true,active:'game-corner',failures:{}},acquisition:{schema:'pokemon-suite/native-acquisition/v1',kind:'game-corner',requestId:'unstarted',speciesId:137,phase:'preparing'}}});
 const obs=o();obs.playerMemory.storyState.flagIds[2092]=true;obs.playerMemory.storyState.flagIds[579]=true;
 assert.equal(controller.decide(obs).kind,'resample');assert.equal(controller.state().acquisition,null);
 assert.ok(controller.state().agenda.failures['game-corner'].retryAt>0);
 assert.notEqual(controller.state().status,'waiting');
});

test('a prize script can finish creating its party member before the roster must verify',()=>{
 const task=create(),obs=o();obs.playerMemory.trainer.partyValidity='invalid';obs.playerMemory.ui.fieldDialog={ready:false};
 assert.equal(task.inspect(obs).kind,'wait');
 obs.playerMemory.ui={};assert.equal(task.inspect(obs).kind,'stop');
});

test('a partial coin purchase saves before suspension and retains its request across restart',()=>{
 let task=create({schema:'pokemon-suite/native-acquisition/v1',kind:'game-corner',requestId:'prize-137',speciesId:137,phase:'preparing',dirty:true,purchase:null});
 const obs=o(),m=obs.playerMemory;m.storyState.flagIds[579]=true;m.postgameEvidence.acquisition.coins=500;m.trainer.money=20;
 assert.equal(task.suspend?.('Funding route unavailable.',obs),true);
 assert.equal(task.inspect(obs).objective.target.kind,'save-game');assert.equal(task.state.dirty,true);
 task=create(JSON.parse(JSON.stringify(task.state)));
 assert.equal(task.inspect(obs).kind,'policy','a restart cannot certify an unfinished save');
 m.saveAttemptStatus=1;m.gameStats.savedGame++;obs.sram.sha256='b'.repeat(64);
 const d=task.inspect(obs);assert.equal(d.kind,'suspended');assert.equal(d.receipt.nativeSaveVerified,true);
 assert.equal(d.receipt.coins,500);assert.equal(d.receipt.money,20);assert.equal(task.state.requestId,'prize-137');assert.equal(task.state.dirty,false);
 assert.equal(task.state.receipt,undefined,'suspending currency is not receiving the prize');
});

test('suspension cannot abandon a purchase, prize, dialogue or unverifiable save',()=>{
 for(const extra of [{purchase:{quantity:500,coins:0,money:10000}},{prizeBaseline:{coins:9999,fingerprints:[]}},{received:'protected'},{phase:'slots'},{save:{counter:1,sha256:'old'}}]){
  const task=create({schema:'pokemon-suite/native-acquisition/v1',kind:'game-corner',requestId:'prize-137',speciesId:137,phase:'preparing',dirty:true,...extra});
  assert.equal(task.suspend?.('blocked',o()),false);
 }
 for(const change of [m=>{m.ui.fieldDialog={};},m=>{m.gameStats.savedGame=undefined;},m=>{m.trainer.storage.validity='invalid';}]){
  const task=create({schema:'pokemon-suite/native-acquisition/v1',kind:'game-corner',requestId:'prize-137',speciesId:137,phase:'preparing',dirty:true});const obs=o();change(obs.playerMemory);
  assert.equal(task.suspend?.('blocked',obs),false);
 }
});

test('a changed currency balance cannot certify a suspended acquisition',()=>{
 const task=create({schema:'pokemon-suite/native-acquisition/v1',kind:'game-corner',requestId:'prize-137',speciesId:137,phase:'preparing',dirty:true});const obs=o();
 assert.equal(task.suspend?.('blocked',obs),true);obs.playerMemory.trainer.money--;obs.playerMemory.gameStats.savedGame++;obs.playerMemory.saveAttemptStatus=1;obs.sram.sha256='b'.repeat(64);
 assert.equal(task.inspect(obs).kind,'stop');assert.equal(task.state.dirty,true);
});

test('an unavailable funding route saves and defers a dirty purchase without marking its prize complete',()=>{
 const args={world,story:{data:{scripts:[]}},mechanics:{data:{species:[],moves:[]}}};let now=1000;
 let controller=postgame.createPostgameController({...args,clock:()=>now,state:{schema:'pokemon-suite/postgame/v1',agenda:{enabled:true,active:'game-corner',failures:{}},acquisition:{schema:'pokemon-suite/native-acquisition/v1',kind:'game-corner',requestId:'partial-35',speciesId:35,phase:'preparing',dirty:true,purchase:null}}});
 const obs=o(),m=obs.playerMemory;m.storyState.flagIds[579]=true;m.postgameEvidence.acquisition.coins=50;m.trainer.money=0;m.trainer.bag={keyItems:[{itemId:362,quantity:1}]};obs.captureId='suspend';for(const part of [obs.sram,obs.emulator,m])Object.assign(part,{captureId:obs.captureId,frame:obs.frame});
 controller.decide(obs);assert.ok(controller.state().acquisition.suspension,'recoverable partial funds must enter a native save');
 controller=postgame.createPostgameController({...args,clock:()=>now,state:JSON.parse(JSON.stringify(controller.state()))});
 controller.decide(obs);assert.equal(controller.state().objective.target.kind,'save-game');assert.equal(controller.canYield(obs),false);
 m.gameStats.savedGame++;m.saveAttemptStatus=1;obs.sram.sha256='b'.repeat(64);now+=1000;
 const decision=controller.decide(obs);assert.equal(decision.kind,'resample');
 const after=controller.state();assert.equal(after.acquisition,null);assert.equal(after.deferredAcquisitions.length,1);
 assert.equal(after.deferredAcquisitions[0].state.requestId,'partial-35');assert.equal(after.deferredAcquisitions[0].state.dirty,false);
 assert.equal(after.deferredAcquisitions[0].state.receipt,undefined);assert.equal(m.postgameEvidence.acquisition.coins,50);assert.equal(controller.canYield(obs),true);
});

test('an unverified suspension save stops within its deadline and retains all ownership across restart',()=>{
 const args={world,story:{data:{scripts:[]}},mechanics:{data:{species:[],moves:[]}}};const obs=o(),m=obs.playerMemory;m.storyState.flagIds[579]=true;obs.captureId='timeout';for(const part of [obs.sram,obs.emulator,m])Object.assign(part,{captureId:obs.captureId,frame:obs.frame});
 const task=create({schema:'pokemon-suite/native-acquisition/v1',kind:'game-corner',requestId:'prize-137',speciesId:137,phase:'preparing',dirty:true});assert.equal(task.suspend('Route unavailable.',obs),true);
 let now=1000,c=postgame.createPostgameController({...args,clock:()=>now,state:{schema:'pokemon-suite/postgame/v1',acquisition:task.state}}),d;
 for(let i=0;i<=65;i++){now+=1000;if(i===30)c=postgame.createPostgameController({...args,clock:()=>now,state:JSON.parse(JSON.stringify(c.state()))});d=c.decide(obs);}
 assert.equal(d.kind,'blocked');assert.match(d.reason,/save.*verify/i);assert.equal(c.state().status,'waiting');assert.equal(c.state().acquisition.requestId,'prize-137');assert.equal(c.state().acquisition.dirty,true);assert.equal(c.state().deferredAcquisitions.length,0);
});

test('a rejected automatic hunt returns to its agenda and retains bounded failure history',()=>{
 const args={world,story:{data:{scripts:[]}},mechanics:{data:{species:[],moves:[]}}},obs=o();
 const record={id:'queued-snorlax',postgameObjective:'snorlax'};
 const c=postgame.createPostgameController({...args,clock:()=>1000,state:{schema:'pokemon-suite/postgame/v1',agenda:{enabled:true,active:'snorlax',failures:{},hunts:{snorlax:record}},objective:{id:'postgame-snorlax',target:{kind:'postgame-hunt'}}}});
 assert.equal(c.rejectHunt?.({...record,id:'different'},'Unavailable',obs),false);
 assert.equal(c.rejectHunt?.(record,'Executor unavailable for the retained save.',obs),true);
 assert.equal(c.state().agenda.failures.snorlax.attempts,1);assert.equal(c.state().agenda.hunts.snorlax,undefined);
 assert.equal(c.state().status,'recovering');assert.equal(c.state().objective,null);
 const protectedState={...c.state(),agenda:{enabled:true,active:'snorlax',failures:{},hunts:{snorlax:record}},acquisition:{schema:'pokemon-suite/native-acquisition/v1',kind:'game-corner',requestId:'owned',speciesId:35,phase:'preparing',dirty:true}};
 const held=postgame.createPostgameController({...args,state:protectedState});assert.equal(held.rejectHunt(record,'Unavailable',obs),false);assert.equal(held.state().acquisition.dirty,true);
});

test('suspended purchase identity survives the agenda-only continuation after another hunt',()=>{
 const args={world,story:{data:{scripts:[]}},mechanics:{data:{species:[],moves:[]}}};
 const retained={state:{schema:'pokemon-suite/native-acquisition/v1',kind:'game-corner',requestId:'original-partial',speciesId:35,phase:'preparing',dirty:false,suspension:{receipt:{nativeSaveVerified:true,coins:320,money:271}}},retryAt:1000};
 const first=postgame.createPostgameController({...args,state:{schema:'pokemon-suite/postgame/v1',agenda:{enabled:true},deferredAcquisitions:[retained]}});
 const next=postgame.createPostgameController({...args,clock:()=>2000,state:{schema:'pokemon-suite/postgame/v1',agenda:JSON.parse(JSON.stringify(first.state().agenda))}});
 assert.deepEqual(next.state().deferredAcquisitions,[retained]);
 next.beginAcquisition({kind:'game-corner',speciesId:35,requestId:'new-proposal'});assert.equal(next.state().acquisition.requestId,'original-partial');assert.equal(next.state().agenda.deferredAcquisitions.length,0);
});

test('timeout drains a committed coin purchase without beginning another debit before suspension',()=>{
 const obs=o();obs.playerMemory.storyState.flagIds[579]=true;obs.playerMemory.map.id='MAP_CELADON_CITY_GAME_CORNER';obs.playerMemory.trainer.money=200000;obs.playerMemory.postgameEvidence.acquisition.coins=500;
 const task=create({schema:'pokemon-suite/native-acquisition/v1',kind:'game-corner',requestId:'prize-137',speciesId:137,phase:'preparing',dirty:true,purchase:{coins:0,money:210000,quantity:500}});
 const d=task.inspect(obs,{yieldRequested:true});assert.equal(d.kind,'wait');assert.equal(task.state.purchase,null,'the verified old debit must finish without starting the next one');
 assert.equal(task.suspend('Funding deadline',obs),true);
});

test('timeout exits slots between paid rounds rather than placing another bet',()=>{
 const obs=o();obs.emulator.callback2='CB2_RunSlotMachine';obs.playerMemory.postgameEvidence.acquisition={coins:320,slots:{task:'MainTask_SlotsGameLoop',stage:0,bet:0}};
 const task=create({schema:'pokemon-suite/native-acquisition/v1',kind:'game-corner',requestId:'prize-137',speciesId:137,phase:'slots',dirty:true});
 const d=task.inspect(obs,{yieldRequested:true});assert.deepEqual(d.action.buttons,['b']);
});

test('a recovery request finishes the already paid slot round before choosing exit',()=>{
 const obs=o();obs.emulator.callback2='CB2_RunSlotMachine';obs.playerMemory.postgameEvidence.acquisition={coins:320,slots:{task:'MainTask_SlotsGameLoop',stage:0,bet:1}};
 const task=create({schema:'pokemon-suite/native-acquisition/v1',kind:'game-corner',requestId:'prize-137',speciesId:137,phase:'slots',dirty:true});
 assert.deepEqual(task.inspect(obs,{yieldRequested:true}).action.buttons,['a']);
 obs.playerMemory.postgameEvidence.acquisition.slots={task:'MainTask_SlotsGameLoop',stage:0,bet:0};
 assert.deepEqual(task.inspect(obs,{yieldRequested:true}).action.buttons,['b']);
 obs.playerMemory.postgameEvidence.acquisition.slots={task:'MainTask_ConfirmExitGame',stage:2};
 assert.deepEqual(task.inspect(obs,{yieldRequested:true}).action.buttons,['up']);assert.deepEqual(task.inspect(obs,{yieldRequested:true}).action.buttons,['a']);
});
