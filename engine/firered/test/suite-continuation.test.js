import test from 'node:test';
import assert from 'node:assert/strict';
const mod=await import('../src/suite/postgame.js').catch(e=>{if(e.code==='ERR_MODULE_NOT_FOUND')return {};throw e;});
test('persistent bot continues after a completed catch and remains off after the user stops it',()=>{
 assert.equal(typeof mod.canContinuePostgame,'function');
 const state={enabled:true,running:false,mission:{status:'complete',protected:true},wireless:{remotePlayers:0}};
 assert.equal(mod.canContinuePostgame(state),true);
 assert.equal(mod.canContinuePostgame({...state,enabled:false}),false);
 assert.equal(mod.canContinuePostgame({...state,mission:{status:'blocked',protected:true}}),false);
 assert.equal(mod.canContinuePostgame({...state,running:true}),false);
});
test('continuation waits for the complete trade handshake, native save and room exit',()=>{
 const state={enabled:true,running:false,mission:{status:'complete'},wireless:{remotePlayers:0}};
 const trade={phase:'complete',completion:{nativeSaveVerified:true,handshakeVerified:true}};
 assert.equal(mod.canContinuePostgame({...state,nativeTrade:trade}),true);
 for(const nativeTrade of [{...trade,phase:'retry-wait'},{...trade,phase:'saved-exit-incomplete'},{...trade,completion:{nativeSaveVerified:true}}])assert.equal(mod.canContinuePostgame({...state,nativeTrade}),false);
 assert.equal(mod.canContinuePostgame({...state,nativeTrade:trade,wireless:{remotePlayers:1}}),false);
});
test('only an interrupted recovery belonging to the actual hunt prevents postgame resume',()=>{
 const state={enabled:true,running:false,wireless:{remotePlayers:0},postgame:{agenda:{enabled:true}}};
 assert.equal(mod.canContinuePostgame(state),true,'two absent hunt IDs are not an interrupted recovery');
 assert.equal(mod.canContinuePostgame({...state,interruptedRecovery:{huntId:'previous-hunt'}}),true);
 const hunt={...state,mission:{id:'owned-hunt',status:'complete'}};
 assert.equal(mod.canContinuePostgame({...hunt,interruptedRecovery:{huntId:'owned-hunt'}}),false);
 assert.equal(mod.canContinuePostgame({...hunt,interruptedRecovery:{huntId:'previous-hunt'}}),true);
 assert.equal(mod.canContinuePostgame({...state,enabled:false}),false);
});
test('postgame planner watches all badge prerequisites and saves its active workflow for restart',()=>{
 assert.equal(typeof mod.createPostgameController,'function');
 const p=mod.createPostgameController({world:{data:{maps:[],wildEncounters:[]}},story:{data:{scripts:[]}},mechanics:{data:{species:[]}}});
 for(let flag=2080;flag<=2087;flag++)assert.ok(p.storyWatch().flags.includes(flag));
 assert.ok(p.storyWatch().flags.includes(2092));
 assert.equal(p.decide({phase:'transition',emulator:{inputReady:false},playerMemory:{storyState:null}}).kind,'resample');
 const s=p.state();assert.equal(s.schema,'pokemon-suite/postgame/v1');
 const restored=mod.createPostgameController({world:{data:{maps:[],wildEncounters:[]}},story:{data:{scripts:[]}},mechanics:{data:{species:[]}},state:s});
 assert.deepEqual(restored.state().planner,s.planner);
});

test('explicit postgame resume replans a stopped menu while retaining protected encounter evidence',()=>{
 const args={world:{data:{maps:[],wildEncounters:[]}},story:{data:{scripts:[]}},mechanics:{data:{species:[]}}};
 const p=mod.createPostgameController(args), safety={capture:{fingerprint:'reserved',nativeSaveVerified:false}};
 const restored=mod.createPostgameController({...args,state:{...p.state(),status:'waiting',reason:'repeated-menu-transaction',player:{sequence:7,initialSramSha256:'original',encounterSafety:safety,transactionRecovery:{blocked:{reason:'repeated-menu-transaction'}},movementRecovery:{blocked:true}}}});
 restored.resume();
 assert.deepEqual(restored.state().player.encounterSafety,safety);
 assert.equal(restored.state().player.transactionRecovery,null);
 assert.equal(restored.state().player.movementRecovery,null);
});

test('an external evolution prepares and natively saves its source party before waiting for the other game',()=>{
 const center='MAP_ONE_ISLAND_POKEMON_CENTER_1F',pokemon={validity:'valid',slot:0,species:133,personality:123,otId:456,shiny:true,isEgg:false,level:25,hp:70,maxHp:70,status1:0,moves:[33],pp:[35],ivs:{hp:1,attack:2,defense:3,speed:4,spAttack:5,spDefense:6}};
 const args={world:{data:{maps:[{id:center,objectEvents:[{script:'OneIsland_PokemonCenter_1F_EventScript_Nurse',x:7,y:2}],layout:{width:10,height:10,cells:[]}}],wildEncounters:[]}},story:{data:{scripts:[]}},mechanics:{data:{species:[],moves:[{id:33,pp:35}]}}};
 let p=mod.createPostgameController(args);p.beginEvolution({requestId:'umbreon',sourceId:'eevee',pokemon,steps:[{kind:'trade',fromGame:'firered',toGame:'emerald',speciesId:133}],request:{speciesId:197,shiny:'required'}});
 const state=p.state();state.preparation.nativeLinkSave={nativeSaveVerified:true};
 p=mod.createPostgameController({...args,state});
 const o={captureId:'transfer',frame:1,phase:'stable',phaseReasons:[],sram:{captureId:'transfer',frame:1,sha256:'before'},emulator:{captureId:'transfer',frame:1,mode:'overworld',inputReady:true,inBattle:false},playerMemory:{captureId:'transfer',frame:1,sha256:'memory',map:{id:center},position:{x:7,y:4},ui:{},gameStats:{savedGame:8},saveAttemptStatus:1,storyState:{flagIds:{2092:true,2112:true,2116:true}},trainer:{partyValidity:'valid',party:[pokemon],storage:{validity:'valid',pokemon:[]}}}};
 const decision=p.decide(o);
 assert.equal(p.state().preparation.tradePreparation.phase,'saving');
 assert.equal(p.state().objective.target.kind,'save-game');assert.notEqual(decision.kind,'blocked');
 const pcState=p.state();pcState.preparation.tradePreparation.phase='party';
 const inPc=mod.createPostgameController({...args,state:pcState});
 o.playerMemory.ui={storage:{stage:'choose-mode'}};o.playerMemory.trainer.party=[];
 inPc.decide(o);
 assert.equal(inPc.state().objective.target.kind,'party-roster');
 assert.equal(inPc.state().objective.target.map,center);
});
test('a requested hunt handoff waits for stable overworld and a saved capture instead of taking another travel step',()=>{
 const args={world:{data:{maps:[],wildEncounters:[]}},story:{data:{scripts:[]}},mechanics:{data:{species:[]}}};
 const p=mod.createPostgameController(args);
 assert.equal(typeof p.requestHandoff,'function');p.requestHandoff();
 const o={phase:'stable',emulator:{mode:'overworld',inBattle:false,inputReady:true},playerMemory:{ui:{},storyState:{flagIds:{2092:true}}}};
 assert.equal(p.decide(o).kind,'handoff');
 assert.equal(p.canYield({...o,emulator:{...o.emulator,inBattle:true}}),false);
 assert.equal(p.canYield({...o,playerMemory:{...o.playerMemory,ui:{saveDialog:{stage:'writing'}}}}),false);
 const unsafe=mod.createPostgameController({...args,state:{...p.state(),player:{encounterSafety:{capture:{nativeSaveVerified:false}}}}});
 unsafe.requestHandoff();assert.equal(unsafe.canYield(o),false);
});
test('postgame retries an ordinary target that fainted, while preserving shiny and ambiguous outcomes',()=>{
 assert.equal(typeof mod.canRetryPostgameCapture,'function');
 const pokemon={validity:'valid',species:130,personality:123,otId:456,shiny:false,ivs:{hp:1,attack:2,defense:3,speed:4,spAttack:5,spDefense:6}};
 const capture={pokemon,fingerprint:'[130,123,456,1,2,3,4,5,6]',caught:false,nativeSaveVerified:false};
 const observation={phase:'stable',emulator:{mode:'overworld',inBattle:false},playerMemory:{battleOutcome:1,trainer:{partyValidity:'valid',party:[],storage:{validity:'valid',pokemon:[]}}}};
 assert.equal(mod.canRetryPostgameCapture(capture,observation),true);
 assert.equal(mod.canRetryPostgameCapture({...capture,pokemon:{...pokemon,shiny:true}},observation),false);
 assert.equal(mod.canRetryPostgameCapture({...capture,caught:true},observation),false);
 assert.equal(mod.canRetryPostgameCapture(capture,{...observation,playerMemory:{...observation.playerMemory,battleOutcome:7}}),false);
 assert.equal(mod.canRetryPostgameCapture(capture,{...observation,playerMemory:{...observation.playerMemory,trainer:{...observation.playerMemory.trainer,storage:{validity:'unknown',pokemon:[]}}}}),false);
 assert.equal(mod.canRetryPostgameCapture(capture,{...observation,playerMemory:{...observation.playerMemory,trainer:{...observation.playerMemory.trainer,party:[pokemon]}}}),false);
});
test('a verified ordinary Abra teleport permits another encounter without discarding shiny or caught Pokémon',()=>{
 const pokemon={validity:'valid',species:63,personality:1454152434,otId:2161188857,shiny:false,ivs:{hp:2,attack:7,defense:12,speed:19,spAttack:21,spDefense:26}};
 const capture={pokemon,fingerprint:'[63,1454152434,2161188857,2,7,12,19,21,26]',caught:false};
 const o={phase:'stable',emulator:{mode:'overworld',inBattle:false},playerMemory:{battleOutcome:5,trainer:{partyValidity:'valid',party:[],storage:{validity:'valid',pokemon:[]}}}};
 assert.equal(mod.canRetryPostgameCapture(capture,o),true);
 assert.equal(mod.canRetryPostgameCapture({...capture,pokemon:{...pokemon,shiny:true}},o),false);
 assert.equal(mod.canRetryPostgameCapture({...capture,postCatch:{}},o),false);
 assert.equal(mod.canRetryPostgameCapture(capture,{...o,playerMemory:{...o.playerMemory,battleOutcome:6}}),true);
 for(const outcome of [0,2,3,4,7,8,9,10])assert.equal(mod.canRetryPostgameCapture(capture,{...o,playerMemory:{...o.playerMemory,battleOutcome:outcome}}),false);
 assert.equal(mod.canRetryPostgameCapture(capture,{...o,playerMemory:{...o.playerMemory,trainer:{...o.playerMemory.trainer,storage:{validity:'valid',pokemon:[pokemon]}}}}),false);
});

test('link preparation stops collecting optional Dex species after sixty, while still protecting shinies',()=>{
 const args={world:{data:{maps:[],wildEncounters:[]}},story:{data:{scripts:[]}},mechanics:{data:{species:[{id:4,types:['TYPE_FIRE']},{id:63,types:['TYPE_PSYCHIC']}],moves:[{id:33,effect:'EFFECT_HIT',power:35,type:'TYPE_NORMAL'}]}}};
 for(const shiny of [false,true]){
  const p=mod.createPostgameController(args);p.prepareAcquisition({requestId:'umbreon',kind:'national-dex'});
  const mon={validity:'valid',species:63,personality:123,otId:456,shiny,isEgg:false,ivs:{hp:1,attack:2,defense:3,speed:4,spAttack:5,spDefense:6}};
  const lead={validity:'valid',species:4,slot:0,hp:60,maxHp:60,level:20,stats:{defense:40,speed:60},moves:[33],pp:[35]};
  const id='dex-ready-'+shiny,o={captureId:id,frame:1,phase:'stable',phaseReasons:[],sram:{captureId:id,frame:1,sha256:'sram'},emulator:{captureId:id,frame:1,mode:'battle',inBattle:true,inputReady:true},playerMemory:{captureId:id,frame:1,sha256:'memory',map:{id:'MAP_ROUTE1'},position:{x:1,y:1},storyState:{flagIds:{2092:true}},battleTypeFlags:4,battleOutcome:0,ui:{battle:{stage:'action',cursor:0}},encounter:{kind:'wild',validity:'valid',pokemon:mon},trainer:{partyValidity:'valid',party:[lead],storage:{validity:'valid',pokemon:[],boxCounts:Array(14).fill(0)},bag:{pokeBalls:[{itemId:4,quantity:20}]},pokedex:{ownedSpecies:Array.from({length:60},(_,i)=>i+1)}},battle:{player:lead,opponent:{...mon,level:3,hp:12,maxHp:12,stats:{attack:8,speed:15},moves:[33],pp:[35],status1:0,status2:0,status3:0},turn:0}}};
  const d=p.decide(o);
  if(shiny){assert.ok(p.state().player.encounterSafety.capture);assert.notEqual(d.winner?.recommendation.targetCommand,'run');}
  else{assert.equal(p.state().player.encounterSafety.capture,null);assert.equal(d.winner?.recommendation.targetCommand,'run');}
 }
});
test('a qualified postgame catch clears only its old battle stop after exact ownership is verified',()=>{
 const args={world:{data:{maps:[],wildEncounters:[]}},story:{data:{scripts:[]}},mechanics:{data:{species:[]}}};
 const base=mod.createPostgameController(args),pokemon={validity:'valid',species:202,personality:1,otId:2,shiny:false,ivs:{hp:1,attack:2,defense:3,speed:4,spAttack:5,spDefense:6}},fingerprint='[202,1,2,1,2,3,4,5,6]';
 const p=mod.createPostgameController({...args,state:{...base.state(),status:'waiting',reason:'capture-battler-survival-unknown',player:{encounterSafety:{blocked:'capture-battler-survival-unknown',capture:{pokemon,fingerprint,caught:false}}}}});
 assert.equal(typeof p.resumeVerifiedCapture,'function');
 const o={emulator:{inBattle:false},playerMemory:{trainer:{partyValidity:'valid',party:[],storage:{validity:'valid',pokemon:[pokemon]}}}};
 assert.throws(()=>p.resumeVerifiedCapture(o,'different'));
 assert.throws(()=>p.resumeVerifiedCapture({...o,emulator:{inBattle:true}},fingerprint));
 p.resumeVerifiedCapture(o,fingerprint);assert.equal(p.state().player.encounterSafety.blocked,null);assert.equal(p.state().player.encounterSafety.capture.fingerprint,fingerprint);assert.equal(p.state().player.encounterSafety.capture.nativeSaveVerified,undefined);
});
